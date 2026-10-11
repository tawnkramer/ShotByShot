import { expect, it } from 'vitest';
import { estimateImageCost } from '../src/images/cost';
import { shotImageSize } from '../src/images/generate';

it('matches published legacy output prices and adds approximate prompt cost', () => {
  expect(estimateImageCost('gpt-image-1.5', 'medium', '1024x1536', 'abcd')).toMatchObject({output:0.05,text:0.000005,subtotal:0.050005});
  expect(estimateImageCost('gpt-image-1-mini', 'high', '1024x1024', '')?.output).toBe(0.036);
  expect(estimateImageCost('unknown', 'high', '1024x1024', '')).toBeUndefined();
});
it('matches the official 2.5 calculator and uses the submitted shot size', () => {
  expect(estimateImageCost('gpt-image-2.5-flare', 'low', '1024x1024', '')?.output).toBeCloseTo(0.00588);
  expect(estimateImageCost('gpt-image-2.5-sunburst', 'medium', '1024x1024', '')?.output).toBeCloseTo(0.01317);
  expect(shotImageSize(9/16, 'gpt-image-2.5-flare')).toBe('864x1536');
  expect(shotImageSize(9/16, 'gpt-image-1.5')).toBe('1024x1536');
});
