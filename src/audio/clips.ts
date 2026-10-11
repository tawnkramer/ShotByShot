import type { Character, Project, ScriptLine, Voice } from '../state/schema';
import { cueName } from '../story/classify';
import { hashKey } from '../util/hash';

const isParenthetical = (s: string) => /^\(.*\)$/.test(s.trim());

export interface SpokenLine {
  line: ScriptLine;
  character: Character;
  voice: Voice;
  /** Delivery for this line: the character's style plus any parenthetical before it. */
  instructions?: string;
  /** Changes whenever anything that affects the audio changes. */
  sig: string;
}

/** Every dialogue line with the character who speaks it. Lines whose speaker isn't a character are skipped. */
export function spokenLines(project: Project): { lines: SpokenLine[]; unassigned: number } {
  const byName = new Map(project.characters.map((c) => [c.name.toUpperCase(), c]));
  const lines: SpokenLine[] = [];
  let unassigned = 0;
  let speaker: Character | undefined | null = null;
  let direction: string | undefined;
  for (const l of project.script) {
    if (l.type === 'character') {
      speaker = byName.get(cueName(l.text));
      direction = undefined;
      continue;
    }
    if (l.type !== 'dialogue') {
      speaker = null;
      continue;
    }
    if (isParenthetical(l.text)) {
      direction = l.text.trim().slice(1, -1);
      continue;
    }
    if (!speaker) {
      unassigned++;
      continue;
    }
    const v = speaker.voice;
    const instructions = [v.instructions?.trim(), direction && `Deliver this ${direction}.`].filter(Boolean).join(' ') || undefined;
    lines.push({ line: l, character: speaker, voice: v, instructions, sig: hashKey(JSON.stringify([v.provider, v.voiceId, v.speed, instructions ?? '', l.text])) });
    direction = undefined;
  }
  return { lines, unassigned };
}

/** Lines whose audio is missing or out of date. */
export function linesNeedingAudio(project: Project): SpokenLine[] {
  return spokenLines(project).lines.filter((s) => project.audio[s.line.id]?.sig !== s.sig);
}

/** Current, valid clips by line id. */
export function validClips(project: Project): Map<string, { blob: string; durationSec: number }> {
  const out = new Map<string, { blob: string; durationSec: number }>();
  for (const s of spokenLines(project).lines) {
    const clip = project.audio[s.line.id];
    if (clip?.sig === s.sig) out.set(s.line.id, clip);
  }
  return out;
}
