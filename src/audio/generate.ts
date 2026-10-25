import type { Project } from '../state/schema';
import { putBlob } from '../storage/db';
import { hashKey } from '../util/hash';
import { linesNeedingAudio, type SpokenLine } from './clips';
import type { GeneratedClip } from './commands';
import { synthesizeSpeech } from './tts';
import { synthesizeGeminiSpeech } from './gemini';
import { decodeDuration } from './player';

export interface GenerateOptions {
  /** OpenAI key and speech model, for lines spoken with OpenAI voices. */
  apiKey?: string;
  model: string;
  /** Gemini key and speech model, for lines spoken with Gemini voices. */
  gemini?: { apiKey: string; model: string };
  signal?: AbortSignal;
  onProgress?: (done: number, total: number) => void;
  /** Saves each batch as it finishes, so a cancel or error keeps what's done. */
  onBatch?: (clips: GeneratedClip[]) => void;
  concurrency?: number;
}

/** Voices every line that needs it. Returns how many succeeded and the first error, if any. */
export async function generateDialogue(project: Project, opts: GenerateOptions, lines: SpokenLine[] = linesNeedingAudio(project)): Promise<{ done: number; error?: Error }> {
  const total = lines.length;
  let done = 0;
  let next = 0;
  let error: Error | undefined;
  const pending: GeneratedClip[] = [];
  const flush = () => {
    if (pending.length) opts.onBatch?.(pending.splice(0));
  };
  opts.onProgress?.(0, total);

  const worker = async () => {
    while (next < lines.length && !error && !opts.signal?.aborted) {
      const s = lines[next++];
      try {
        const voice = { ...s.voice, instructions: s.instructions };
        const name = s.character.name;
        let audio: Blob;
        let blob: string;
        if (voice.provider === 'gemini') {
          if (!opts.gemini) throw new Error(`${name} has a Gemini voice. Add your Gemini API key in Settings to voice them.`);
          audio = await synthesizeGeminiSpeech({ ...opts.gemini, voice, text: s.line.text, signal: opts.signal });
          // "wav" in the key tells shot videos the clip is WAV, not MP3.
          blob = `tts-wav-${hashKey(`${opts.gemini.model}|${s.sig}`)}`;
        } else {
          if (!opts.apiKey) throw new Error(`${name} has an OpenAI voice. Add your OpenAI API key in Settings, or pick a Gemini voice.`);
          audio = await synthesizeSpeech({ apiKey: opts.apiKey, model: opts.model, voice, text: s.line.text, signal: opts.signal });
          blob = `tts-${hashKey(`${opts.model}|${s.sig}`)}`;
        }
        const durationSec = await decodeDuration(audio);
        await putBlob(blob, audio);
        pending.push({ lineId: s.line.id, sig: s.sig, blob, durationSec });
        done++;
        opts.onProgress?.(done, total);
        if (pending.length >= 4) flush();
      } catch (e) {
        if ((e as Error).name === 'AbortError') break;
        error = e instanceof Error ? e : new Error(String(e));
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(opts.concurrency ?? 3, total) }, worker));
  flush();
  return { done, error };
}
