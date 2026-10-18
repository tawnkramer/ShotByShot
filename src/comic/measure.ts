import type { Project } from '../state/schema';
import type { AutoOptions } from './auto';
import { canvasMeasurer } from './draw';
import { defaultLetteringFont, ensureFonts } from './fonts';
import type { TextMeasurer } from './layout';

/** Rough widths for when there's no canvas to measure with. */
export const roughMeasure: TextMeasurer = (text, font) => text.length * font.px * 0.55;

/**
 * What automatic lettering needs to size balloons outside the editor: the
 * default font, loaded, and a canvas to measure text with.
 */
export async function letteringMeasure(project: Project): Promise<AutoOptions> {
  const fallbackFont = await defaultLetteringFont().catch(() => undefined);
  const fonts = [fallbackFont, project.lettering?.speech?.font, project.lettering?.caption?.font].filter((f): f is string => Boolean(f));
  await ensureFonts(fonts).catch(() => {});
  let ctx: CanvasRenderingContext2D | null = null;
  try { ctx = document.createElement('canvas').getContext('2d'); } catch { ctx = null; }
  return { measure: ctx ? canvasMeasurer(ctx) : roughMeasure, fallbackFont };
}
