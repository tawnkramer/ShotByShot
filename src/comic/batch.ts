import type { Project } from '../state/schema';
import { autoLetter } from './auto';
import { canvasMeasurer } from './draw';
import { defaultLetteringFont, ensureFonts } from './fonts';
import type { LetterElement } from './model';
import { letteringSpeeches } from './script';

/**
 * Letters every panel that has dialogue and no lettering yet. Panels
 * already lettered are left alone. Returns the new lettering by panel.
 */
export async function letterEmptyPanels(project: Project): Promise<Map<string, LetterElement[]>> {
  const fallbackFont = await defaultLetteringFont().catch(() => undefined);
  const fonts = [fallbackFont, project.lettering?.speech?.font, project.lettering?.caption?.font].filter((f): f is string => Boolean(f));
  await ensureFonts(fonts);
  const ctx = document.createElement('canvas').getContext('2d');
  if (!ctx) throw new Error('This browser cannot measure text.');
  const measure = canvasMeasurer(ctx);
  const out = new Map<string, LetterElement[]>();
  for (const shot of project.shots) {
    if (shot.lettering?.length || !letteringSpeeches(project, shot).panel.length) continue;
    out.set(shot.id, autoLetter(project, shot, { measure, fallbackFont }));
  }
  return out;
}
