/** Minimal Google Gemini client for the browser. The key is the user's own and is only sent to generativelanguage.googleapis.com. */
import { ChatError, type ChatMessage, type StreamResult, type ToolCall, type ToolSpec } from './chat';
import type { KeyCheck } from './openai';
import { getSetting, setSetting } from '../storage/db';

export const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';
export const GEMINI_KEY_SETTING = 'gemini.apiKey';
/** The automatic Gemini choice for the current key and list. */
export const AUTO_GEMINI_MODEL_SETTING = 'gemini.chatModel.auto';

/** Gemini chat models, best first. The first one the key can use is picked automatically. */
export const PREFERRED_GEMINI_MODELS = ['gemini-3.5-flash', 'gemini-3.1-pro-preview', 'gemini-3-pro-preview', 'gemini-3-flash-preview', 'gemini-2.5-pro', 'gemini-2.5-flash'];

/** Ids made up for calls Gemini returned without one; they are not sent back. */
const LOCAL_ID = 'gemini-local-';

export const isGeminiModel = (model: string) => /^gemini-/.test(model);

export async function geminiApiKey(): Promise<string | undefined> {
  return getSetting<string>(GEMINI_KEY_SETTING);
}

/** The ids of models this key can chat with, without the "models/" prefix. */
async function listModels(key: string, fetchImpl: typeof fetch): Promise<Response | string[]> {
  const ids: string[] = [];
  let page = '';
  for (let i = 0; i < 5; i++) {
    const res = await fetchImpl(`${GEMINI_BASE}/models?pageSize=1000${page ? `&pageToken=${encodeURIComponent(page)}` : ''}`, { headers: { 'x-goog-api-key': key } });
    if (!res.ok) return res;
    const body = (await res.json()) as { models?: { name: string; supportedGenerationMethods?: string[] }[]; nextPageToken?: string };
    for (const m of body.models ?? []) if (!m.supportedGenerationMethods || m.supportedGenerationMethods.includes('generateContent')) ids.push(m.name.replace(/^models\//, ''));
    if (!body.nextPageToken) break;
    page = body.nextPageToken;
  }
  return ids.sort();
}

export async function testGeminiKey(key: string, fetchImpl: typeof fetch = fetch): Promise<KeyCheck> {
  let result: Response | string[];
  try {
    result = await listModels(key, fetchImpl);
  } catch {
    return { ok: false, message: "Couldn't reach Google. Check your connection." };
  }
  if (Array.isArray(result)) return { ok: true, message: `Key works. ${result.length} models available.`, models: result };
  const detail = await errorDetail(result);
  if (keyRejected(result.status, detail)) return { ok: false, message: 'Google rejected this key.' };
  if (result.status === 429) return { ok: false, message: 'The key works, but it is rate-limited or out of quota.' };
  return { ok: false, message: `Google returned an error (${result.status}).` };
}

/** The first preferred Gemini model this key can use. */
export async function geminiChatModel(key: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  const list = PREFERRED_GEMINI_MODELS.join(',');
  const cached = await getSetting<{ list: string; model: string }>(AUTO_GEMINI_MODEL_SETTING);
  if (cached?.list === list) return cached.model;
  try {
    const ids = await listModels(key, fetchImpl);
    if (Array.isArray(ids)) {
      const pick = PREFERRED_GEMINI_MODELS.find((m) => ids.includes(m));
      if (pick) {
        await setSetting(AUTO_GEMINI_MODEL_SETTING, { list, model: pick });
        return pick;
      }
    }
  } catch {
    /* fall through */
  }
  return PREFERRED_GEMINI_MODELS[0];
}

type Part = {
  text?: string;
  thought?: boolean;
  thoughtSignature?: string;
  inlineData?: { mimeType: string; data: string };
  functionCall?: { id?: string; name: string; args?: Record<string, unknown> };
  functionResponse?: { id?: string; name: string; response: Record<string, unknown> };
};
type Content = { role: 'user' | 'model'; parts: Part[] };

/** A reasoning entry that carries the signature Gemini put on a text answer. */
type SignatureItem = { type: 'gemini_signature'; signature: string };

function imagePart(url: string): Part {
  const m = /^data:([^;,]+);base64,(.*)$/s.exec(url);
  if (!m) return { text: `[image: ${url}]` };
  return { inlineData: { mimeType: m[1], data: m[2] } };
}

/** The chat history as a Gemini request: system instruction plus contents. */
export function toGeminiContents(messages: ChatMessage[]): { systemInstruction?: { parts: Part[] }; contents: Content[] } {
  let system = '';
  const contents: Content[] = [];
  const names = new Map<string, string>();
  for (const m of messages) {
    if (m.role === 'system') system = m.content;
    else if (m.role === 'user') {
      const parts = typeof m.content === 'string' ? [{ text: m.content }] : m.content.map((p) => (p.type === 'text' ? { text: p.text } : imagePart(p.image_url.url)));
      contents.push({ role: 'user', parts });
    } else if (m.role === 'assistant') {
      const parts: Part[] = [];
      const signature = (m.reasoning ?? []).find((r): r is SignatureItem => (r as SignatureItem)?.type === 'gemini_signature')?.signature;
      if (m.content) parts.push({ text: m.content, ...(signature ? { thoughtSignature: signature } : {}) });
      for (const c of m.tool_calls ?? []) {
        names.set(c.id, c.function.name);
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(c.function.arguments || '{}');
        } catch {
          /* send no arguments */
        }
        parts.push({ functionCall: { ...(c.id.startsWith(LOCAL_ID) ? {} : { id: c.id }), name: c.function.name, args }, ...(c.thoughtSignature ? { thoughtSignature: c.thoughtSignature } : {}) });
      }
      if (parts.length) contents.push({ role: 'model', parts });
    } else {
      // Results of one round's calls go back together in a single turn.
      const part: Part = { functionResponse: { ...(m.tool_call_id.startsWith(LOCAL_ID) ? {} : { id: m.tool_call_id }), name: names.get(m.tool_call_id) ?? 'unknown', response: { result: m.content } } };
      const last = contents[contents.length - 1];
      if (last?.role === 'user' && last.parts.every((p) => p.functionResponse)) last.parts.push(part);
      else contents.push({ role: 'user', parts: [part] });
    }
  }
  return { systemInstruction: system ? { parts: [{ text: system }] } : undefined, contents };
}

async function errorDetail(res: Response): Promise<string> {
  try {
    return ((await res.json()) as { error?: { message?: string } }).error?.message ?? '';
  } catch {
    return '';
  }
}

/** Google answers a bad key with 400 ("API key not valid") or 403, not 401. */
const keyRejected = (status: number, detail: string) => status === 401 || status === 403 || (status === 400 && /api key/i.test(detail));

type StreamChunk = {
  candidates?: { content?: { parts?: Part[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
  error?: { message?: string };
};

const STOPPED = ['SAFETY', 'RECITATION', 'PROHIBITED_CONTENT', 'BLOCKLIST', 'SPII', 'MALFORMED_FUNCTION_CALL', 'UNEXPECTED_TOOL_CALL', 'OTHER'];

/**
 * One model response, streamed (Gemini streamGenerateContent). Text arrives
 * through onText as it's generated; tool calls come back whole. The model's
 * thought signatures come back on the tool calls and in `reasoning`, to be
 * sent with the next request as Gemini requires.
 */
export async function streamGeminiChat(
  opts: { apiKey: string; model: string; messages: ChatMessage[]; tools?: ToolSpec[]; signal?: AbortSignal; onText?: (delta: string) => void },
  fetchImpl: typeof fetch = fetch,
): Promise<StreamResult> {
  const { systemInstruction, contents } = toGeminiContents(opts.messages);
  let res: Response;
  try {
    res = await fetchImpl(`${GEMINI_BASE}/models/${encodeURIComponent(opts.model)}:streamGenerateContent?alt=sse`, {
      method: 'POST',
      headers: { 'x-goog-api-key': opts.apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction,
        contents,
        tools: opts.tools?.length
          ? [{ functionDeclarations: opts.tools.map((t) => ({ name: t.function.name, description: t.function.description, parametersJsonSchema: t.function.parameters })) }]
          : undefined,
      }),
      signal: opts.signal,
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new ChatError("Couldn't reach Google Gemini. Check your connection.");
  }
  if (!res.ok || !res.body) {
    const detail = await errorDetail(res);
    if (keyRejected(res.status, detail)) throw new ChatError('Google rejected the Gemini API key. Check it in Settings.', res.status);
    if (res.status === 429) throw new ChatError('Gemini rate limit or quota reached. Try again in a moment.', 429);
    if (res.status === 404) throw new ChatError(`The model isn't available to this key${detail ? `: ${detail}` : '.'} Pick another in Settings.`, 404);
    throw new ChatError(`Gemini error (${res.status})${detail ? `: ${detail}` : '.'}`, res.status);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';
  let signature: string | undefined;
  let stopped: string | undefined;
  const toolCalls: ToolCall[] = [];

  const handle = (data: string) => {
    let chunk: StreamChunk;
    try {
      chunk = JSON.parse(data);
    } catch {
      return;
    }
    if (chunk.error) throw new ChatError(`Gemini error: ${chunk.error.message ?? 'the response failed.'}`);
    if (chunk.promptFeedback?.blockReason) throw new ChatError(`Gemini blocked the request (${chunk.promptFeedback.blockReason}).`);
    const cand = chunk.candidates?.[0];
    for (const p of cand?.content?.parts ?? []) {
      if (p.functionCall) {
        toolCalls.push({
          id: p.functionCall.id || `${LOCAL_ID}${toolCalls.length}`,
          type: 'function',
          function: { name: p.functionCall.name, arguments: JSON.stringify(p.functionCall.args ?? {}) },
          ...(p.thoughtSignature ? { thoughtSignature: p.thoughtSignature } : {}),
        });
        continue;
      }
      if (p.thoughtSignature) signature = p.thoughtSignature;
      if (p.text && !p.thought) {
        content += p.text;
        opts.onText?.(p.text);
      }
    }
    if (cand?.finishReason && STOPPED.includes(cand.finishReason)) stopped = cand.finishReason;
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
  if (stopped && !content && !toolCalls.length) throw new ChatError(`Gemini stopped early (${stopped}).`);
  return { content, toolCalls, reasoning: signature ? [{ type: 'gemini_signature', signature } satisfies SignatureItem] : [] };
}
