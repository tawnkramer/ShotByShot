import { OPENAI_BASE } from '../ai/openai';
import type { Voice } from '../state/schema';

export const TTS_MODEL_SETTING = 'openai.ttsModel';
export const DEFAULT_TTS_MODEL = 'gpt-4o-mini-tts';

export interface SpeechRequest {
  apiKey: string;
  model: string;
  voice: Voice;
  text: string;
  signal?: AbortSignal;
}

/** Calls OpenAI's speech endpoint. Returns MP3 audio. */
export async function synthesizeSpeech({ apiKey, model, voice, text, signal }: SpeechRequest, fetchImpl: typeof fetch = fetch): Promise<Blob> {
  const body: Record<string, unknown> = { model, voice: voice.voiceId, input: text, speed: voice.speed, response_format: 'mp3' };
  // Only the newer speech models accept style instructions.
  if (voice.instructions?.trim() && !/^tts-1/.test(model)) body.instructions = voice.instructions.trim();
  const res = await fetchImpl(`${OPENAI_BASE}/audio/speech`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) {
    let detail = '';
    try {
      detail = ((await res.json()) as { error?: { message?: string } }).error?.message ?? '';
    } catch {
      /* not JSON */
    }
    if (res.status === 401) throw new Error('OpenAI rejected the API key.');
    if (res.status === 429) throw new Error('OpenAI rate limit or quota reached.');
    throw new Error(`Speech failed (${res.status})${detail ? `: ${detail}` : '.'}`);
  }
  return res.blob();
}

let current: HTMLAudioElement | null = null;

export async function playBlob(blob: Blob): Promise<void> {
  stopPlayback();
  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);
  current = audio;
  audio.onended = () => URL.revokeObjectURL(url);
  await audio.play();
}

/** The browser's built-in voice. Used for previews when there's no API key. */
export function speakWithBrowser(text: string, voice: Voice, sex: 'female' | 'male' | 'other'): boolean {
  if (!('speechSynthesis' in window)) return false;
  stopPlayback();
  const u = new SpeechSynthesisUtterance(text);
  u.rate = voice.speed;
  u.pitch = sex === 'female' ? 1.15 : sex === 'male' ? 0.85 : 1;
  speechSynthesis.speak(u);
  return true;
}

export function stopPlayback(): void {
  current?.pause();
  current = null;
  if ('speechSynthesis' in window) speechSynthesis.cancel();
}
