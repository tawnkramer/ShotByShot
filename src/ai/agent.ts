import type { Command } from '../state/commands';
import type { Project, Step } from '../state/schema';
import { apiKey, chatModel, streamChat, type ChatMessage, type ContentPart } from './chat';
import { runTool, toolsFor, toolSpecs, type ToolContext } from './tools';
import { systemPrompt } from './context';
import { matchSkill, skillById } from './skills';
import { renderContactSheet } from '../export/contactSheet';

export const MAX_ROUNDS = 8;

export interface TurnOptions {
  text: string;
  image?: string;
  /** Earlier user/assistant messages in this project, oldest first. */
  history: { role: 'user' | 'assistant'; text: string }[];
  step: Step;
  shotId?: string;
  getProject: () => Project;
  dispatch: (cmd: Command) => void;
  stageId: () => string | undefined;
  setStage: (id: string) => void;
  navigate: (path: string) => void;
  snapshot: () => Promise<string | null>;
  signal?: AbortSignal;
  onText?: (delta: string) => void;
  onAction?: (label: string) => void;
  /** Every tool call and what it returned. */
  onTool?: (name: string, args: string, result: string) => void;
  /** Renders a contact sheet of shots; defaults to an offscreen WebGL render. */
  renderSheet?: ToolContext['renderSheet'];
  /** Overrides the key saved in Settings (for tests run outside the browser). */
  apiKey?: string;
}

/**
 * One assistant turn: ask the model, run any tools it calls, feed back the
 * results (and snapshots), and repeat until it answers in words.
 */
export async function runTurn(o: TurnOptions): Promise<string> {
  const key = o.apiKey ?? (await apiKey());
  if (!key) throw new Error('Add your OpenAI API key in Settings to use the assistant.');
  const model = await chatModel(key);
  const tools = toolsFor(o.step, !!o.shotId);
  const specs = toolSpecs(tools);
  const pendingImages: { url: string; caption: string }[] = [];
  // A request that clearly asks for a skill loads it up front; the model can also load one with use_skill.
  let skill = matchSkill(o.text, o.step)?.id;
  const ctx: ToolContext = {
    project: o.getProject,
    dispatch: (cmd) => {
      o.dispatch(cmd);
      o.onAction?.(cmd.label);
    },
    step: o.step,
    shotId: o.shotId,
    stageId: o.stageId,
    setStage: o.setStage,
    navigate: o.navigate,
    snapshot: o.snapshot,
    attachImage: (url, caption) => pendingImages.push({ url, caption }),
    setSkill: (id) => (skill = id),
    renderSheet: o.renderSheet ?? ((ids, moments, view) => renderContactSheet(o.getProject(), ids, moments, { view })),
  };
  const maxRounds = () => (skill && skillById(skill)?.maxRounds) || MAX_ROUNDS;

  const userContent: ContentPart[] = [{ type: 'text', text: o.text }];
  if (o.image) userContent.push({ type: 'image_url', image_url: { url: o.image } });
  const messages: ChatMessage[] = [
    { role: 'system', content: '' },
    ...o.history.map((m) => ({ role: m.role, content: m.text }) as ChatMessage),
    { role: 'user', content: o.image ? userContent : o.text },
  ];

  const replies: string[] = [];
  for (let round = 0; round < maxRounds(); round++) {
    // Refresh the state each round so the model sees the effect of its own changes.
    messages[0] = { role: 'system', content: systemPrompt(o.getProject(), o.step, { shotId: o.shotId, stageId: o.stageId(), skill }) };
    const res = await streamChat({ apiKey: key, model, messages, tools: specs, signal: o.signal, onText: o.onText });
    if (res.content) replies.push(res.content);
    messages.push({ role: 'assistant', content: res.content || null, tool_calls: res.toolCalls.length ? res.toolCalls : undefined });
    if (!res.toolCalls.length) return replies.join('\n\n').trim();
    for (const call of res.toolCalls) {
      const result = await runTool(tools, call.function.name, call.function.arguments, ctx);
      o.onTool?.(call.function.name, call.function.arguments, result);
      messages.push({ role: 'tool', tool_call_id: call.id, content: result });
    }
    if (pendingImages.length) {
      messages.push({ role: 'user', content: pendingImages.splice(0).flatMap((im) => [{ type: 'text' as const, text: im.caption }, { type: 'image_url' as const, image_url: { url: im.url } }]) });
    }
    if (o.signal?.aborted) break;
  }
  return replies.join('\n\n').trim() || 'Done.';
}

/** Captures the visible 3D view as a JPEG, waiting for it to redraw first. */
export async function captureView(maxSize = 768): Promise<string | null> {
  for (let i = 0; i < 3; i++) await new Promise((r) => requestAnimationFrame(() => r(null)));
  const canvas = document.querySelector<HTMLCanvasElement>('.frame canvas, .viewport canvas');
  if (!canvas || !canvas.width) return null;
  const scale = Math.min(1, maxSize / Math.max(canvas.width, canvas.height));
  const out = document.createElement('canvas');
  out.width = Math.round(canvas.width * scale);
  out.height = Math.round(canvas.height * scale);
  out.getContext('2d')!.drawImage(canvas, 0, 0, out.width, out.height);
  return out.toDataURL('image/jpeg', 0.75);
}

/** Shrinks a photo for upload (the model doesn't need more than ~1 MP). */
export async function prepareImage(file: File, maxSize = 1280): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bitmap.width * scale);
  c.height = Math.round(bitmap.height * scale);
  c.getContext('2d')!.drawImage(bitmap, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.82);
}
