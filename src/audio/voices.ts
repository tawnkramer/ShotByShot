import type { Sex, Voice } from '../state/schema';
import { GEMINI_VOICES_BY_SEX } from './gemini';

/** OpenAI text-to-speech voices. */
export const OPENAI_VOICES = ['alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'nova', 'onyx', 'sage', 'shimmer', 'verse'] as const;

const BY_SEX: Record<Sex, string[]> = {
  female: ['coral', 'nova', 'shimmer', 'sage'],
  male: ['onyx', 'ash', 'echo', 'ballad'],
  other: ['alloy', 'verse', 'fable'],
};

/** Picks a voice from the provider that suits the character and isn't already used, if possible. */
export function suggestVoice(sex: Sex, used: string[], provider: 'openai' | 'gemini' = 'openai'): Voice {
  const options = (provider === 'gemini' ? GEMINI_VOICES_BY_SEX : BY_SEX)[sex];
  const voiceId = options.find((v) => !used.includes(v)) ?? options[used.length % options.length];
  return { provider, voiceId, speed: 1 };
}
