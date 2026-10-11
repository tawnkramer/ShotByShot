import { OPENAI_BASE, API_KEY_SETTING } from './openai';
import { getSetting, setSetting } from '../storage/db';

export const CHAT_MODEL_SETTING = 'openai.chatModel';

/** Preferred chat models, best first. The first one the key can use is picked automatically. */
export const PREFERRED_CHAT_MODELS = ['gpt-5-mini', 'gpt-5', 'gpt-4.1-mini', 'gpt-4.1', 'gpt-4o-mini', 'gpt-4o'];

export type ContentPart = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } };

export interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export type ChatMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string | ContentPart[] }
  | { role: 'assistant'; content: string | null; tool_calls?: ToolCall[] }
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

/** The chat model to use: the saved choice, or the first preferred model this key can use. */
export async function chatModel(apiKey: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  const saved = await getSetting<string>(CHAT_MODEL_SETTING);
  if (saved) return saved;
  try {
    const res = await fetchImpl(`${OPENAI_BASE}/models`, { headers: { Authorization: `Bearer ${apiKey}` } });
    if (res.ok) {
      const ids = new Set(((await res.json()) as { data?: { id: string }[] }).data?.map((m) => m.id) ?? []);
      const pick = PREFERRED_CHAT_MODELS.find((m) => ids.has(m));
      if (pick) {
        await setSetting(CHAT_MODEL_SETTING, pick);
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
}

/**
 * One chat completion, streamed. Text arrives through onText as it's
 * generated; tool calls are assembled from their fragments and returned.
 */
export async function streamChat(
  opts: { apiKey: string; model: string; messages: ChatMessage[]; tools?: ToolSpec[]; signal?: AbortSignal; onText?: (delta: string) => void },
  fetchImpl: typeof fetch = fetch,
): Promise<StreamResult> {
  let res: Response;
  try {
    res = await fetchImpl(`${OPENAI_BASE}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${opts.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: opts.model, messages: opts.messages, tools: opts.tools?.length ? opts.tools : undefined, stream: true }),
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
  const calls: { id: string; name: string; args: string }[] = [];

  const handle = (data: string) => {
    if (data === '[DONE]') return;
    let json: { choices?: { delta?: { content?: string; tool_calls?: { index: number; id?: string; function?: { name?: string; arguments?: string } }[] } }[] };
    try {
      json = JSON.parse(data);
    } catch {
      return;
    }
    const delta = json.choices?.[0]?.delta;
    if (!delta) return;
    if (delta.content) {
      content += delta.content;
      opts.onText?.(delta.content);
    }
    for (const tc of delta.tool_calls ?? []) {
      const c = (calls[tc.index] ??= { id: '', name: '', args: '' });
      if (tc.id) c.id = tc.id;
      if (tc.function?.name) c.name += tc.function.name;
      if (tc.function?.arguments) c.args += tc.function.arguments;
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

  return {
    content,
    toolCalls: calls.filter(Boolean).map((c, i) => ({ id: c.id || `call_${i}`, type: 'function' as const, function: { name: c.name, arguments: c.args || '{}' } })),
  };
}
