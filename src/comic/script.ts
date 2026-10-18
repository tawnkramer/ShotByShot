import type { Project, ScriptLine, Shot } from '../state/schema';
import { speakerOf } from '../story/classify';
import type { LetterKind } from './model';

/** One character's uninterrupted run of dialogue: the text for one balloon. */
export interface Speech {
  /** The first dialogue line; balloons made from it remember it. */
  lineId: string;
  speaker?: string;
  text: string;
  /** Balloon kind from the cue and parentheticals: (whispers), (V.O.), … */
  kind: LetterKind;
  /** (O.S.) and the like: the speaker is heard but not seen. */
  offPanel?: boolean;
}

const isParenthetical = (text: string) => /^\(.*\)$/.test(text.trim());

const WHISPER = /\b(whisper\w*|quietly|softly|hushed|murmur\w*|under (?:his|her|their|my) breath|sotto voce)\b/i;
const SHOUT = /\b(shout\w*|yell\w*|scream\w*|bellow\w*|roar\w*|screech\w*)\b/i;
const THOUGHT = /\b(thinks?|thinking|thought|to (?:himself|herself|themselves|myself))\b/i;
const DEVICE = /\b(phone|radio|intercom|walkie|speaker ?phone|on (?:the )?tv|over (?:the )?(?:speaker|pa)|filtered|recording|voicemail)\b/i;
const OFF = /\((?:O\.?S\.?|O\.?C\.?|OFF(?: ?SCREEN| ?CAMERA)?)\)/i;
const VO = /\(V\.?O\.?\)/i;

/** The balloon kind for a speech, from its cue ("LEO (V.O.)"), its parentheticals and its text. */
export function speechKind(cue: string, notes: string[], text: string): { kind: LetterKind; offPanel?: boolean } {
  const all = notes.join(' ');
  if (DEVICE.test(all) || DEVICE.test(cue)) return { kind: 'electronic' };
  // A voice-over that isn't a device is narration: a caption box.
  if (VO.test(cue)) return { kind: 'caption' };
  if (THOUGHT.test(all)) return { kind: 'thought' };
  if (WHISPER.test(all)) return { kind: 'whisper' };
  const letters = text.replace(/[^A-Za-z]/g, '');
  if (SHOUT.test(all) || (letters.length >= 3 && letters === letters.toUpperCase() && /!/.test(text))) return { kind: 'shout' };
  return OFF.test(cue) ? { kind: 'speech', offPanel: true } : { kind: 'speech' };
}

/** Speeches in script order. Parentheticals like "(beat)" are left out of the text. */
export function speechesIn(lines: ScriptLine[], speakers: Map<string, string>, cues = cuesOf(lines)): Speech[] {
  const out: (Speech & { notes: string[]; cue: string })[] = [];
  let current: (typeof out)[number] | undefined;
  let notes: string[] = [];
  for (const l of lines) {
    if (l.type !== 'dialogue') { current = undefined; notes = []; continue; }
    if (isParenthetical(l.text)) { (current?.notes ?? notes).push(l.text); continue; }
    const speaker = speakers.get(l.id);
    if (current && current.speaker === speaker) current.text = `${current.text} ${l.text.trim()}`;
    else {
      out.push((current = { lineId: l.id, speaker, text: l.text.trim(), kind: 'speech', notes, cue: cues.get(l.id) ?? '' }));
      notes = [];
    }
  }
  return out.map(({ notes: n, cue, ...s }) => ({ ...s, ...speechKind(cue, n, s.text) }));
}

/** The cue line ("MAYA (V.O.)") each dialogue line belongs to. */
function cuesOf(lines: ScriptLine[]): Map<string, string> {
  const map = new Map<string, string>();
  let cue: string | undefined;
  for (const l of lines) {
    if (l.type === 'character') cue = l.text;
    else if (l.type === 'dialogue' && cue) map.set(l.id, cue);
    else cue = undefined;
  }
  return map;
}

/** The dialogue in a panel, and the rest of its scene's dialogue. */
export function letteringSpeeches(project: Project, shot: Shot): { panel: Speech[]; scene: Speech[] } {
  const speakers = speakerOf(project.script);
  const cues = cuesOf(project.script);
  const inShot = new Set(shot.lineIds);
  const first = project.script.findIndex((l) => l.id === shot.lineIds[0]);
  let start = first;
  while (start > 0 && project.script[start].type !== 'scene') start--;
  let end = Math.max(first, 0);
  while (end < project.script.length && (end === start || project.script[end].type !== 'scene')) end++;
  const panel = speechesIn(project.script.filter((l) => inShot.has(l.id)), speakers, cues);
  const scene = speechesIn(project.script.slice(Math.max(start, 0), end).filter((l) => !inShot.has(l.id)), speakers, cues);
  return { panel, scene };
}
