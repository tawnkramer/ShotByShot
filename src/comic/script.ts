import type { Project, ScriptLine, Shot } from '../state/schema';
import { speakerOf } from '../story/classify';

/** One character's uninterrupted run of dialogue: the text for one balloon. */
export interface Speech {
  /** The first dialogue line; balloons made from it remember it. */
  lineId: string;
  speaker?: string;
  text: string;
}

const isParenthetical = (text: string) => /^\(.*\)$/.test(text.trim());

/** Speeches in script order. Parentheticals like "(beat)" are left out of the text. */
export function speechesIn(lines: ScriptLine[], speakers: Map<string, string>): Speech[] {
  const out: Speech[] = [];
  let current: Speech | undefined;
  for (const l of lines) {
    if (l.type === 'character') { current = undefined; continue; }
    if (l.type !== 'dialogue') { current = undefined; continue; }
    if (isParenthetical(l.text)) continue;
    const speaker = speakers.get(l.id);
    if (current && current.speaker === speaker) current.text = `${current.text} ${l.text.trim()}`;
    else out.push((current = { lineId: l.id, speaker, text: l.text.trim() }));
  }
  return out;
}

/** The dialogue in a panel, and the rest of its scene's dialogue. */
export function letteringSpeeches(project: Project, shot: Shot): { panel: Speech[]; scene: Speech[] } {
  const speakers = speakerOf(project.script);
  const inShot = new Set(shot.lineIds);
  const first = project.script.findIndex((l) => l.id === shot.lineIds[0]);
  let start = first;
  while (start > 0 && project.script[start].type !== 'scene') start--;
  let end = Math.max(first, 0);
  while (end < project.script.length && (end === start || project.script[end].type !== 'scene')) end++;
  const panel = speechesIn(project.script.filter((l) => inShot.has(l.id)), speakers);
  const scene = speechesIn(project.script.slice(Math.max(start, 0), end).filter((l) => !inShot.has(l.id)), speakers);
  return { panel, scene };
}
