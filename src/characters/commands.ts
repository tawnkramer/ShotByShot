import type { Command } from '../state/commands';
import { newId, type Character, type Project } from '../state/schema';
import { cueName } from '../story/classify';
import { suggestVoice } from '../audio/voices';

export const TINTS = ['#6aa6ff', '#f2b84b', '#4fc1b0', '#ff8fb8', '#b48cff', '#ff9a5c', '#9bd35a', '#e6e6e6'];

/** "MAYA" → "Maya", "MR. O'BRIEN" → "Mr. O'Brien" */
export function displayName(cue: string): string {
  return cueName(cue)
    .toLowerCase()
    .replace(/(^|[\s'.-])(\p{L})/gu, (_, sep: string, ch: string) => sep + ch.toUpperCase());
}

/** Character names from the script's cues that don't have a character yet, most lines first. */
export function namesFromScript(project: Project): string[] {
  const have = new Set(project.characters.map((c) => c.name.toUpperCase()));
  const counts = new Map<string, number>();
  for (const l of project.script) {
    if (l.type !== 'character') continue;
    const name = cueName(l.text);
    if (!name || have.has(name)) continue;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1]).map(([n]) => displayName(n));
}

export function newCharacter(name: string, existing: Character[], id = newId()): Character {
  return {
    id,
    name,
    sex: 'other',
    heightCm: 172,
    build: 'average',
    attributes: [],
    tint: TINTS[existing.length % TINTS.length],
    voice: suggestVoice('other', existing.map((c) => c.voice.voiceId)),
  };
}

export function addCharacters(names: string[], ids: string[] = names.map(() => newId())): Command {
  return {
    label: names.length > 1 ? `Add ${names.length} characters` : `Add ${names[0]}`,
    apply: (d) => {
      names.forEach((name, i) => d.characters.push(newCharacter(name, d.characters, ids[i])));
    },
  };
}

export type CharacterPatch = Partial<Omit<Character, 'id'>>;

export function updateCharacter(id: string, patch: CharacterPatch, mergeKey?: string): Command {
  return {
    label: 'Edit character',
    mergeKey,
    apply: (d) => {
      const c = d.characters.find((x) => x.id === id);
      if (!c) return;
      for (const [k, v] of Object.entries(patch)) {
        if (v === undefined) delete (c as Record<string, unknown>)[k];
        else (c as Record<string, unknown>)[k] = v;
      }
      // A new sex gets a fitting voice unless the voice was chosen by hand for this sex already.
      if (patch.sex && !patch.voice) {
        const others = d.characters.filter((x) => x.id !== id).map((x) => x.voice.voiceId);
        c.voice = { ...suggestVoice(patch.sex, others, c.voice.provider === 'gemini' ? 'gemini' : 'openai'), speed: c.voice.speed, instructions: c.voice.instructions };
      }
    },
  };
}

export function deleteCharacter(id: string): Command {
  return {
    label: 'Delete character',
    apply: (d) => {
      d.characters = d.characters.filter((c) => c.id !== id);
      for (const l of d.script) if (l.speakerId === id) delete l.speakerId;
    },
  };
}

/** The first line this character speaks, for voice previews. */
export function firstLineOf(project: Project, character: Character): string | undefined {
  const name = character.name.toUpperCase();
  let speaking = false;
  for (const l of project.script) {
    if (l.type === 'character') speaking = cueName(l.text) === name;
    else if (l.type === 'dialogue' && speaking && !/^\(.*\)$/.test(l.text.trim())) return l.text;
    else if (l.type !== 'dialogue') speaking = false;
  }
  return undefined;
}

export function heightLabel(cm: number): string {
  const totalIn = Math.round(cm / 2.54);
  return `${Math.round(cm)} cm · ${Math.floor(totalIn / 12)}′${totalIn % 12}″`;
}
