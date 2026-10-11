import type { ImageQuality } from './generate';

// Standard USD rates checked 2026-10-11. Update alongside OpenAI pricing changes.
// https://developers.openai.com/api/docs/guides/image-generation
// 2.5 output formula matches the official page's image token calculator.
export function estimateImageCost(model: string, quality: ImageQuality, size: string, prompt: string) {
  const [width, height] = size.split('x').map(Number);
  if (!width || !height) return undefined;
  let output: number;
  let textRate = 5;
  let imageRate = 8;
  if (model === 'gpt-image-1.5' || model === 'gpt-image-1-mini') {
    const square = width === height;
    const prices = model === 'gpt-image-1.5'
      ? { low: [0.009, 0.013], medium: [0.034, 0.05], high: [0.133, 0.2] }
      : { low: [0.005, 0.006], medium: [0.011, 0.015], high: [0.036, 0.052] };
    output = prices[quality][square ? 0 : 1];
    if (model === 'gpt-image-1-mini') { textRate = 2; imageRate = 2.5; }
  } else if (model === 'gpt-image-2.5-flare' || model === 'gpt-image-2.5-sunburst') {
    const longTokens = { low: 16, medium: 24, high: 48 }[quality];
    const short = longTokens * Math.min(width, height) / Math.max(width, height);
    const floor = Math.floor(short);
    // The official calculator uses round-to-even for halfway values.
    const shortTokens = short - floor === 0.5 ? floor + floor % 2 : Math.round(short);
    const tokens = Math.ceil(longTokens * shortTokens * (2_000_000 + width * height) / 4_000_000);
    output = tokens * 30 / 1_000_000;
  } else return undefined;
  // Approximate text tokenization; image input usage is not available before submission.
  const text = Math.ceil(prompt.length / 4) * textRate / 1_000_000;
  return { output, text, subtotal: output + text, imageRate };
}

export function formatImageCost(usd: number): string {
  return `$${usd.toFixed(3)} USD`;
}
