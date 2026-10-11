import { OPENAI_BASE } from '../ai/openai';
import type { Character, Stage } from '../state/schema';

export const IMAGE_MODELS = ['gpt-image-1.5', 'gpt-image-1-mini', 'gpt-image-2.5-flare', 'gpt-image-2.5-sunburst'] as const;
export const DEFAULT_IMAGE_MODEL = IMAGE_MODELS[0];
export type ImageQuality = 'low' | 'medium' | 'high';

export function characterImagePrompt(c: Character): string {
  return [
    `Create a full-body character concept illustration of ${c.name}.`,
    `Character details: ${c.sex}, ${c.heightCm} cm tall, ${c.build} build${c.ageBand ? `, age ${c.ageBand}` : ''}.`,
    c.attributes.length ? `Appearance and notes: ${c.attributes.join('; ')}.` : '',
    'Show the entire character, including feet, in a relaxed standing pose against a simple neutral background. No labels or text. Soft illustrative style, clear face and clothing details.',
  ].filter(Boolean).join('\n');
}

export async function generateCharacterImage(
  { apiKey, prompt, model = DEFAULT_IMAGE_MODEL, quality = 'medium', signal, reference }: {
    apiKey: string; prompt: string; model?: string; quality?: ImageQuality; signal?: AbortSignal; reference?: Blob;
  }, fetchImpl: typeof fetch = fetch,
): Promise<Blob> {
  if (!apiKey.trim()) throw new Error('Add your OpenAI API key in Settings first.');
  if (!prompt.trim()) throw new Error('Describe the image you want to create.');
  if (prompt.length > 32000) throw new Error('The prompt is too long (maximum 32,000 characters).');
  if (reference && (!reference.size || reference.type !== 'image/png')) throw new Error('Capture a stage preview before generating.');
  const form = reference ? new FormData() : undefined;
  if (form && reference) {
    form.append('image[]', reference, 'stage-preview.png');
    for (const [key, value] of Object.entries({ model, prompt, quality, size: '1536x1024', n: '1', output_format: 'png' })) form.append(key, value);
  }
  let res: Response;
  try {
    res = await fetchImpl(`${OPENAI_BASE}/images/${reference ? 'edits' : 'generations'}`, {
      method: 'POST', signal,
      headers: { Authorization: `Bearer ${apiKey}`, ...(reference ? {} : { 'Content-Type': 'application/json' }) },
      body: form ?? JSON.stringify({ model, prompt, quality, size: '1024x1536', n: 1, output_format: 'png' }),
    });
  } catch (e) {
    if (signal?.aborted) throw e;
    throw new Error("Couldn't reach OpenAI. Check your connection and try again.");
  }
  const body = await res.json().catch(() => null) as { error?: { message?: string }; data?: { b64_json?: string }[] } | null;
  if (!res.ok) {
    if (res.status === 401) throw new Error('OpenAI rejected the API key. Update it in Settings.');
    if (res.status === 429) throw new Error('OpenAI is rate-limited or your account is out of quota. Check your API billing and try later.');
    throw new Error(body?.error?.message || `OpenAI returned an error (${res.status}).`);
  }
  const encoded = body?.data?.[0]?.b64_json;
  if (!encoded) throw new Error('OpenAI returned no image. Try again.');
  try {
    const bytes = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0));
    return new Blob([bytes], { type: 'image/png' });
  } catch {
    throw new Error('OpenAI returned an unreadable image. Try again.');
  }
}

export function generateStageImage(options: Parameters<typeof generateCharacterImage>[0] & { reference: Blob }, fetchImpl: typeof fetch = fetch): Promise<Blob> {
  if (!options.reference) return Promise.reject(new Error('Capture a stage preview before generating.'));
  return generateCharacterImage(options, fetchImpl);
}

export function stageImagePrompt(stage: Stage): string {
  return [
    `Create a detailed cinematic concept illustration of ${stage.name}.`,
    'Use the supplied greyscale stage preview as spatial guidance. Preserve its camera angle, perspective, room shape, and placement and proportions of furniture and props. Add convincing materials, colors, lighting, and atmosphere. No labels, text, people, grid lines, or editing handles.',
    stage.objects.length ? `Stage objects: ${stage.objects.map((o) => o.name).join(', ')}.` : '',
  ].filter(Boolean).join('\n');
}
