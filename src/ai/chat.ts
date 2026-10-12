import { OPENAI_BASE, API_KEY_SETTING } from './openai';
import { deleteSetting, getSetting, setSetting } from '../storage/db';

/** The model the user picked in Settings; unset means automatic. */
export const CHAT_MODEL_SETTING = 'openai.chatModel';
/** The automatic choice for the current key and list, so it isn't looked up on every message. */
export const AUTO_CHAT_MODEL_SETTING = 'openai.chatModel.auto';

/** Chat models, best first. The first one the key can use is picked automatically. */
export const PREFERRED_CHAT_MODELS = ['gpt-5.5', 'gpt-6.1-sol', 'gpt-5.4', 'gpt-5.2', 'gpt-5.1', 'gpt-5', 'gpt-5-mini', 'gpt-4.1', 'gpt-4o'];
/**
 * Older builds saved their automatic pick as if the user had chosen it.
 * Those values are treated as automatic so installs move to the better default.
 */
const OLD_AUTOMATIC = ['gpt-5-mini', 'gpt-5', 'gpt-4.1-mini', 'gpt-4.1', 'gpt-4o-mini', 'gpt-4o'];
const OLD_AUTOMATIC_MIGRATED = 'openai.chatModel.migrated';

export type ContentPart = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } };

export interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export type ChatMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string | ContentPart[] }
  | { role: 'assistant'; content: string | null; tool_calls?: ToolCall[]; reasoning?: unknown[] }
  | { role: 'tool'; tool_call_id: string; content: string };

export interface ToolSpec {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export class ChatError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

/** The user's pick from Settings, if any. */
export async function chosenChatModel(): Promise<string | undefined> {
  const saved = await getSetting<string>(CHAT_MODEL_SETTING);
  if (saved && OLD_AUTOMATIC.includes(saved) && !(await getSetting<boolean>(OLD_AUTOMATIC_MIGRATED))) {
    await deleteSetting(CHAT_MODEL_SETTING);
    await setSetting(OLD_AUTOMATIC_MIGRATED, true);
    return undefined;
  }
  return saved || undefined;
}

/** The chat model to use: the user's pick, or the first preferred model this key can use. */
export async function chatModel(apiKey: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  const chosen = await chosenChatModel();
  if (chosen) return chosen;
  const list = PREFERRED_CHAT_MODELS.join(',');
  const cached = await getSetting<{ list: string; model: string }>(AUTO_CHAT_MODEL_SETTING);
  if (cached?.list === list) return cached.model;
  try {
    const res = await fetchImpl(`${OPENAI_BASE}/models`, { headers: { Authorization: `Bearer ${apiKey}` } });
    if (res.ok) {
      const ids = new Set(((await res.json()) as { data?: { id: string }[] }).data?.map((m) => m.id) ?? []);
      const pick = PREFERRED_CHAT_MODELS.find((m) => ids.has(m));
      if (pick) {
        await setSetting(AUTO_CHAT_MODEL_SETTING, { list, model: pick });
        return pick;
      }
    }
  } catch {
    /* fall through */
  }
  return PREFERRED_CHAT_MODELS[0];
}

export async function apiKey(): Promise<string | undefined> {
  return getSetting<string>(API_KEY_SETTING);
}

export interface StreamResult {
  content: string;
  toolCalls: ToolCall[];
  /** The model's reasoning (encrypted), to send back with the next request. */
  reasoning: unknown[];
}

/** Models that reason, so their reasoning is carried from one round to the next. */
const reasons = (model: string) => /^(o\d|gpt-5|gpt-6)/.test(model);

/** The chat history as Responses API input: instructions plus items. */
export function toResponsesInput(messages: ChatMessage[]): { instructions: string; input: unknown[] } {
  let instructions = '';
  const input: unknown[] = [];
  for (const m of messages) {
    if (m.role === 'system') instructions = m.content;
    else if (m.role === 'user') {
      const parts = typeof m.content === 'string' ? [{ type: 'text' as const, text: m.content }] : m.content;
      input.push({ role: 'user', content: parts.map((p) => (p.type === 'text' ? { type: 'input_text', text: p.text } : { type: 'input_image', image_url: p.image_url.url })) });
    } else if (m.role === 'assistant') {
      input.push(...(m.reasoning ?? []));
      if (m.content) input.push({ role: 'assistant', content: [{ type: 'output_text', text: m.content }] });
      for (const c of m.tool_calls ?? []) input.push({ type: 'function_call', call_id: c.id, name: c.function.name, arguments: c.function.arguments });
    } else input.push({ type: 'function_call_output', call_id: m.tool_call_id, output: m.content });
  }
  return { instructions, input };
}

type StreamEvent = {
  type: string;
  delta?: string;
  item?: { type: string; call_id?: string; name?: string; arguments?: string };
  message?: string;
  response?: { error?: { message?: string }; incomplete_details?: { reason?: string } };
};

/**
 * One model response, streamed (OpenAI Responses API). Text arrives through
 * onText as it's generated; tool calls come back whole. Nothing is stored on
 * OpenAI's side: the whole history is sent each time.
 */
export async function streamChat(
  opts: { apiKey: string; model: string; messages: ChatMessage[]; tools?: ToolSpec[]; signal?: AbortSignal; onText?: (delta: string) => void },
  fetchImpl: typeof fetch = fetch,
): Promise<StreamResult> {
  const { instructions, input } = toResponsesInput(opts.messages);
  let res: Response;
  try {
    res = await fetchImpl(`${OPENAI_BASE}/responses`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${opts.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: opts.model,
        instructions: instructions || undefined,
        input,
        tools: opts.tools?.length ? opts.tools.map((t) => ({ type: 'function', name: t.function.name, description: t.function.description, parameters: t.function.parameters, strict: false })) : undefined,
        stream: true,
        store: false,
        include: reasons(opts.model) ? ['reasoning.encrypted_content'] : undefined,
      }),
      signal: opts.signal,
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new ChatError("Couldn't reach OpenAI. Check your connection.");
  }
  if (!res.ok || !res.body) {
    let detail = '';
    try {
      detail = ((await res.json()) as { error?: { message?: string } }).error?.message ?? '';
    } catch {
      /* not JSON */
    }
    if (res.status === 401) throw new ChatError('OpenAI rejected the API key. Check it in Settings.', 401);
    if (res.status === 429) throw new ChatError('OpenAI rate limit or quota reached. Try again in a moment.', 429);
    if (res.status === 404) throw new ChatError(`The model isn't available to this key${detail ? `: ${detail}` : '.'} Pick another in Settings.`, 404);
    throw new ChatError(`OpenAI error (${res.status})${detail ? `: ${detail}` : '.'}`, res.status);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';
  const toolCalls: ToolCall[] = [];
  const reasoning: unknown[] = [];

  const handle = (data: string) => {
    if (data === '[DONE]') return;
    let ev: StreamEvent;
    try {
      ev = JSON.parse(data);
    } catch {
      return;
    }
    if (ev.type === 'response.output_text.delta' && ev.delta) {
      content += ev.delta;
      opts.onText?.(ev.delta);
    } else if (ev.type === 'response.output_item.done' && ev.item) {
      const it = ev.item;
      if (it.type === 'function_call') toolCalls.push({ id: it.call_id || `call_${toolCalls.length}`, type: 'function', function: { name: it.name ?? '', arguments: it.arguments || '{}' } });
      else if (it.type === 'reasoning') reasoning.push(it);
    } else if (ev.type === 'error' || ev.type === 'response.failed') {
      throw new ChatError(`OpenAI error: ${ev.message ?? ev.response?.error?.message ?? 'the response failed.'}`);
    } else if (ev.type === 'response.incomplete' && !content && !toolCalls.length) {
      throw new ChatError(`OpenAI stopped early (${ev.response?.incomplete_details?.reason ?? 'incomplete'}).`);
    }
  };

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (line.startsWith('data:')) handle(line.slice(5).trim());
    }
  }
  if (buffer.trim().startsWith('data:')) handle(buffer.trim().slice(5).trim());
  return { content, toolCalls, reasoning };
}
