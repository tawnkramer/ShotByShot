/** Dialogue voices from Gemini's speech models, with the user's own Gemini key. */
import { geminiGenerate, savedGeminiModels, sortByVersion } from '../ai/gemini';
import { getSetting } from '../storage/db';
import type { Sex, Voice } from '../state/schema';

/** The Gemini speech model picked in Settings; unset means the newest one the key has. */
export const GEMINI_TTS_MODEL_SETTING = 'gemini.ttsModel';
/** Used until the key's own model list has been read in Settings. */
export const GEMINI_TTS_MODELS = ['gemini-3.8-flash-tts', 'gemini-3.1-flash-tts-preview', 'gemini-2.5-flash-preview-tts'];

/** Gemini's prebuilt voices and the character Google gives each. */
export const GEMINI_VOICES = {
  Zephyr: 'Bright', Puck: 'Upbeat', Charon: 'Informative', Kore: 'Firm', Fenrir: 'Excitable', Leda: 'Youthful',
  Orus: 'Firm', Aoede: 'Breezy', Callirrhoe: 'Easy-going', Autonoe: 'Bright', Enceladus: 'Breathy', Iapetus: 'Clear',
  Umbriel: 'Easy-going', Algieba: 'Smooth', Despina: 'Smooth', Erinome: 'Clear', Algenib: 'Gravelly', Rasalgethi: 'Informative',
  Laomedeia: 'Upbeat', Achernar: 'Soft', Alnilam: 'Firm', Schedar: 'Even', Gacrux: 'Mature', Pulcherrima: 'Forward',
  Achird: 'Friendly', Zubenelgenubi: 'Casual', Vindemiatrix: 'Gentle', Sadachbia: 'Lively', Sadaltager: 'Knowledgeable', Sulafat: 'Warm',
} as const;
export const GEMINI_VOICE_NAMES = Object.keys(GEMINI_VOICES) as (keyof typeof GEMINI_VOICES)[];

/** Voices that tend to suit each kind of character, for suggestions. */
export const GEMINI_VOICES_BY_SEX: Record<Sex, string[]> = {
  female: ['Kore', 'Aoede', 'Leda', 'Sulafat', 'Despina', 'Gacrux', 'Achernar', 'Zephyr'],
  male: ['Charon', 'Puck', 'Orus', 'Algenib', 'Iapetus', 'Fenrir', 'Schedar', 'Achird'],
  other: ['Zephyr', 'Umbriel', 'Callirrhoe', 'Enceladus'],
};

/** The speech model to use: the one picked in Settings, else the newest stable one the key lists. */
export async function geminiTtsModel(): Promise<string> {
  const chosen = await getSetting<string>(GEMINI_TTS_MODEL_SETTING).catch(() => undefined);
  if (chosen) return chosen;
  const models = await geminiTtsModels();
  return models.find((m) => !/preview|lite/.test(m)) ?? models[0];
}

/** The Gemini speech models this key can use, newest first. */
export async function geminiTtsModels(): Promise<string[]> {
  const ids = (await savedGeminiModels())?.filter((id) => /tts/.test(id));
  return ids?.length ? sortByVersion(ids) : GEMINI_TTS_MODELS;
}

/** Gemini has no speed setting, so the pace goes into the directions. */
function pace(speed: number): string | undefined {
  if (speed >= 1.6) return 'very fast';
  if (speed >= 1.15) return 'a little faster than normal';
  if (speed <= 0.65) return 'very slowly';
  if (speed <= 0.88) return 'a little slower than normal';
  return undefined;
}

/** The text Gemini reads, with the speaking style and pace as directions ahead of the line. */
export function geminiSpeechPrompt(text: string, voice: Pick<Voice, 'speed' | 'instructions'>): string {
  const notes = [voice.instructions?.trim(), pace(voice.speed)].filter(Boolean);
  return notes.length ? `Say this line with the following delivery (${notes.join('; ')}). Speak only the line itself:\n${text}` : text;
}

/** Wraps 16-bit little-endian PCM in a WAV header so browsers can play and decode it. */
export function pcmToWav(pcm: Uint8Array<ArrayBuffer>, sampleRate: number, channels = 1): Blob {
  const header = new DataView(new ArrayBuffer(44));
  const ascii = (at: number, s: string) => [...s].forEach((c, i) => header.setUint8(at + i, c.charCodeAt(0)));
  ascii(0, 'RIFF');
  header.setUint32(4, 36 + pcm.length, true);
  ascii(8, 'WAVEfmt ');
  header.setUint32(16, 16, true);
  header.setUint16(20, 1, true);
  header.setUint16(22, channels, true);
  header.setUint32(24, sampleRate, true);
  header.setUint32(28, sampleRate * channels * 2, true);
  header.setUint16(32, channels * 2, true);
  header.setUint16(34, 16, true);
  ascii(36, 'data');
  header.setUint32(40, pcm.length, true);
  return new Blob([header.buffer, pcm], { type: 'audio/wav' });
}

/** Speaks one line with a Gemini voice. Returns WAV audio. */
export async function synthesizeGeminiSpeech(
  { apiKey, model, voice, text, signal }: { apiKey: string; model: string; voice: Voice; text: string; signal?: AbortSignal },
  fetchImpl: typeof fetch = fetch,
): Promise<Blob> {
  const { parts, finishReason, blockReason } = await geminiGenerate(
    {
      apiKey,
      model,
      what: 'Speech',
      signal,
      body: {
        contents: [{ role: 'user', parts: [{ text: geminiSpeechPrompt(text, voice) }] }],
        generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice.voiceId } } } },
      },
    },
    fetchImpl,
  );
  if (blockReason) throw new Error(`Gemini blocked this line (${blockReason}).`);
  const audio = parts.find((p) => p.inlineData?.mimeType.startsWith('audio/'))?.inlineData;
  if (!audio) throw new Error(`Gemini returned no audio${finishReason && finishReason !== 'STOP' ? ` (${finishReason})` : ''}. Try again.`);
  const bytes = Uint8Array.from(atob(audio.data), (c) => c.charCodeAt(0));
  // Speech arrives as raw PCM ("audio/L16;codec=pcm;rate=24000"); anything else is already a playable file.
  if (/^audio\/(l16|pcm)/i.test(audio.mimeType)) {
    const rate = Number(/rate=(\d+)/.exec(audio.mimeType)?.[1]) || 24000;
    const channels = Number(/channels=(\d+)/.exec(audio.mimeType)?.[1]) || 1;
    return pcmToWav(bytes, rate, channels);
  }
  return new Blob([bytes], { type: audio.mimeType });
}
