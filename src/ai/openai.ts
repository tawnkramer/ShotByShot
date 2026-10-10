/** Minimal OpenAI client for the browser. The key is the user's own and is only sent to api.openai.com. */

export const OPENAI_BASE = 'https://api.openai.com/v1';
export const API_KEY_SETTING = 'openai.apiKey';

export interface KeyCheck {
  ok: boolean;
  message: string;
  models?: string[];
}

export async function testOpenAIKey(key: string, fetchImpl: typeof fetch = fetch): Promise<KeyCheck> {
  let res: Response;
  try {
    res = await fetchImpl(`${OPENAI_BASE}/models`, { headers: { Authorization: `Bearer ${key}` } });
  } catch {
    return { ok: false, message: 'Couldn\'t reach OpenAI. Check your connection.' };
  }
  if (res.status === 401) return { ok: false, message: 'OpenAI rejected this key.' };
  if (res.status === 429) return { ok: false, message: 'The key works, but it is rate-limited or out of quota.' };
  if (!res.ok) return { ok: false, message: `OpenAI returned an error (${res.status}).` };
  const body = (await res.json()) as { data?: { id: string }[] };
  const models = (body.data ?? []).map((m) => m.id).sort();
  return { ok: true, message: `Key works. ${models.length} models available.`, models };
}
