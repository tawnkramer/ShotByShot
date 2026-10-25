/** Concept images from Gemini's image models ("Nano Banana"), with the user's own Gemini key. */
import { geminiGenerate, savedGeminiModels, sortByVersion } from '../ai/gemini';
import type { ImageQuality } from './generate';

/** Offered until the key's own model list has been read in Settings. */
export const GEMINI_IMAGE_MODELS = ['gemini-3-pro-image', 'gemini-3.1-flash-image', 'gemini-2.5-flash-image'];

export const isGeminiImageModel = (model: string) => /^(gemini-|nano-banana)/.test(model);

/** The Gemini image models this key can use, newest first. */
export async function geminiImageModels(): Promise<string[]> {
  const ids = (await savedGeminiModels())?.filter((id) => /image|nano-banana/.test(id) && !/imagen/.test(id));
  return ids?.length ? sortByVersion(ids) : GEMINI_IMAGE_MODELS;
}

/** Aspect ratios Gemini's image models accept. */
const RATIOS = ['1:1', '2:3', '3:2', '3:4', '4:3', '9:16', '16:9', '21:9'];

/** The supported ratio closest to `aspect` (width / height). */
export function geminiAspectRatio(aspect: number): string {
  const dist = (r: string) => {
    const [w, h] = r.split(':').map(Number);
    return Math.abs(Math.log(w / h / aspect));
  };
  return RATIOS.reduce((best, r) => (dist(r) < dist(best) ? r : best));
}

/** How many input images a model takes, counting the 3D preview. */
export function maxGeminiReferences(model: string): number {
  return /2\.5-flash-image/.test(model) ? 3 : 14;
}

async function inline(blob: Blob): Promise<{ inlineData: { mimeType: string; data: string } }> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { inlineData: { mimeType: blob.type || 'image/png', data: btoa(binary) } };
}

/**
 * One image from a Gemini image model. Reference images (the 3D preview
 * first) go in with the prompt. High quality asks for a 2K image where the
 * model offers sizes.
 */
export async function generateGeminiImage(
  { apiKey, model, prompt, aspect, quality = 'medium', references = [], signal }: {
    apiKey: string; model: string; prompt: string; aspect: number; quality?: ImageQuality; references?: Blob[]; signal?: AbortSignal;
  },
  fetchImpl: typeof fetch = fetch,
): Promise<Blob> {
  if (!apiKey.trim()) throw new Error('Add your Gemini API key in Settings first.');
  if (!prompt.trim()) throw new Error('Describe the image you want to create.');
  const max = maxGeminiReferences(model);
  if (references.length > max) throw new Error(`${model} takes at most ${max} images including the 3D preview. Remove some references or choose another model.`);
  const sized = quality === 'high' && !/2\.5-flash-image/.test(model);
  const { parts, finishReason, blockReason } = await geminiGenerate(
    {
      apiKey,
      model,
      what: 'Image generation',
      signal,
      body: {
        contents: [{ role: 'user', parts: [{ text: prompt }, ...(await Promise.all(references.map(inline)))] }],
        generationConfig: { responseModalities: ['TEXT', 'IMAGE'], imageConfig: { aspectRatio: geminiAspectRatio(aspect), ...(sized ? { imageSize: '2K' } : {}) } },
      },
    },
    fetchImpl,
  );
  if (blockReason) throw new Error(`Gemini blocked this prompt (${blockReason}). Try rewording it.`);
  const image = parts.find((p) => p.inlineData?.mimeType.startsWith('image/'))?.inlineData;
  if (!image) {
    const said = parts.map((p) => (p.thought ? '' : p.text ?? '')).join(' ').trim();
    throw new Error(said ? `Gemini returned no image: ${said.slice(0, 300)}` : `Gemini returned no image${finishReason && finishReason !== 'STOP' ? ` (${finishReason})` : ''}. Try again.`);
  }
  try {
    const bytes = Uint8Array.from(atob(image.data), (c) => c.charCodeAt(0));
    return new Blob([bytes], { type: image.mimeType });
  } catch {
    throw new Error('Gemini returned an unreadable image. Try again.');
  }
}
