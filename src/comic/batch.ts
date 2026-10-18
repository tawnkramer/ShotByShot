import type { Project } from '../state/schema';
import { autoLetter } from './auto';
import { letteringMeasure } from './measure';
import type { LetterElement } from './model';
import { letteringSpeeches } from './script';

/**
 * Letters panels from the script. By default every panel that has dialogue
 * and no lettering yet; with `shotIds`, those panels, re-placing their
 * automatic lettering too. Returns the new lettering by panel.
 */
export async function letterPanels(project: Project, shotIds?: string[]): Promise<Map<string, LetterElement[]>> {
  const opts = await letteringMeasure(project);
  const out = new Map<string, LetterElement[]>();
  for (const shot of project.shots) {
    if (shotIds ? !shotIds.includes(shot.id) : shot.lettering?.length) continue;
    if (!letteringSpeeches(project, shot).panel.length && !shot.lettering?.length) continue;
    out.set(shot.id, autoLetter(project, shot, opts));
  }
  return out;
}

/** Letters every panel that has dialogue and no lettering yet. */
export function letterEmptyPanels(project: Project): Promise<Map<string, LetterElement[]>> {
  return letterPanels(project);
}
