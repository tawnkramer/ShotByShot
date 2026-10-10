import type { BreakdownMode, ScriptLine, Shot } from '../state/schema';
import { cueName, isCameraHeading, isTransition } from './classify';

/** Lines that never belong to a shot. */
export function isFrontMatter(l: Pick<ScriptLine, 'type'>): boolean {
  return l.type === 'title' || l.type === 'description';
}

/**
 * A beat is the smallest piece a shot can be built from: one action line, one
 * speech (cue + its dialogue lines), or a camera line. Scene headings attach to
 * the beat that follows them.
 */
export interface Beat {
  kind: 'action' | 'speech' | 'camera';
  lineIds: string[];
  speaker?: string;
  words: number;
  /** First beat of a scene (a scene heading is included in lineIds). */
  sceneStart: boolean;
  /** Includes a camera heading that directs this beat ("ANGLE ON MAYA"). */
  directed?: boolean;
  /** Ends with a transition ("CUT TO:"), so the next beat starts a new shot. */
  endsShot?: boolean;
}

const wordCount = (s: string) => s.split(/\s+/).filter(Boolean).length;

export function toBeats(lines: ScriptLine[]): Beat[] {
  const beats: Beat[] = [];
  // Lines waiting to lead the next beat: scene headings and camera headings.
  let lead: string[] = [];
  let leadScene = false;
  let leadCamera = false;
  let speech: Beat | null = null;

  const flushSpeech = () => {
    if (speech) beats.push(speech);
    speech = null;
  };
  const startBeat = (kind: Beat['kind'], ids: string[], extra: Partial<Beat> = {}): Beat => {
    const beat: Beat = { kind, lineIds: [...lead, ...ids], words: 0, sceneStart: leadScene, directed: leadCamera, ...extra };
    lead = [];
    leadScene = false;
    leadCamera = false;
    return beat;
  };

  for (const l of lines) {
    if (isFrontMatter(l)) continue;
    if (l.type === 'scene') {
      flushSpeech();
      lead.push(l.id);
      leadScene = true;
      continue;
    }
    if (l.type === 'camera' && isTransition(l.text)) {
      flushSpeech();
      const last = beats[beats.length - 1];
      if (last && !lead.length) {
        last.lineIds.push(l.id);
        last.endsShot = true;
      } else {
        lead.push(l.id); // e.g. FADE IN: at the top
      }
      continue;
    }
    if (l.type === 'camera' && isCameraHeading(l.text)) {
      flushSpeech();
      lead.push(l.id);
      leadCamera = true;
      continue;
    }
    if (l.type === 'character') {
      flushSpeech();
      speech = startBeat('speech', [l.id], { speaker: cueName(l.text) });
      continue;
    }
    if (l.type === 'dialogue') {
      speech ??= startBeat('speech', []);
      speech.lineIds.push(l.id);
      if (!/^\(.*\)$/.test(l.text.trim())) speech.words += wordCount(l.text);
      continue;
    }
    flushSpeech();
    beats.push(startBeat(l.type === 'camera' ? 'camera' : 'action', [l.id], { words: wordCount(l.text) }));
  }
  flushSpeech();
  // Trailing headings with nothing after them still get a shot.
  if (lead.length) beats.push(startBeat('action', []));
  return beats;
}

const SHORT_SPEECH_WORDS = 8;

/**
 * Groups beats into shots. Shots never cross a scene heading, and a camera
 * line always starts a new shot.
 */
export function groupBeats(beats: Beat[], mode: BreakdownMode): Beat[][] {
  const shots: Beat[][] = [];
  let current: Beat[] = [];
  const close = () => {
    if (current.length) shots.push(current);
    current = [];
  };

  for (const beat of beats) {
    const prev = current[current.length - 1];
    if (beat.sceneStart || beat.directed || beat.kind === 'camera' || prev?.endsShot || prev?.kind === 'camera') close();
    if (current.length && !fits(current, beat, mode)) close();
    current.push(beat);
  }
  close();
  return shots;
}

function fits(current: Beat[], beat: Beat, mode: BreakdownMode): boolean {
  const prev = current[current.length - 1];
  switch (mode) {
    case 'line':
      return false;
    case 'pair':
      return current.length < 2;
    case 'mixed':
      // Action sequences cut fast: one beat per shot.
      if (beat.kind === 'action' || prev.kind === 'action') {
        // Exception: the establishing beat of a scene can carry one short action line.
        return current.length === 1 && prev.sceneStart && prev.kind === 'action' && beat.kind === 'action' && beat.words <= 12;
      }
      // Dialogue: the same speaker continuing stays in the shot; a quick
      // exchange of short lines plays as a two-shot; otherwise cut on speaker.
      if (beat.speaker && beat.speaker === prev.speaker) return true;
      if (current.length < 2 && prev.words <= SHORT_SPEECH_WORDS && beat.words <= SHORT_SPEECH_WORDS) return true;
      return false;
  }
}

/** Builds new shots from scratch for the whole script. */
export function breakdownScript(lines: ScriptLine[], mode: BreakdownMode, newId: () => string): Shot[] {
  const shots = groupBeats(toBeats(lines), mode).map((group) => ({
    id: newId(),
    number: '',
    lineIds: group.flatMap((b) => b.lineIds),
  }));
  return numberShots(lines, shots);
}

/**
 * Shot numbers: "12" when the script has no scene headings, otherwise scene
 * number + letter ("3A", "3B").
 */
export function numberShots<T extends Shot>(lines: ScriptLine[], shots: T[]): T[] {
  const sceneOfLine = new Map<string, number>();
  let scene = 0;
  for (const l of lines) {
    if (l.type === 'scene') scene++;
    sceneOfLine.set(l.id, scene);
  }
  const hasScenes = scene > 0;
  const counters = new Map<number, number>();
  return shots.map((shot, i) => {
    let number: string;
    if (!hasScenes) number = String(i + 1);
    else {
      const s = Math.max(1, sceneOfLine.get(shot.lineIds[0]) ?? 1);
      const n = counters.get(s) ?? 0;
      counters.set(s, n + 1);
      number = `${s}${letterIndex(n)}`;
    }
    return shot.number === number ? shot : { ...shot, number };
  });
}

/** 0 → A, 25 → Z, 26 → AA */
export function letterIndex(n: number): string {
  let s = '';
  n += 1;
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/**
 * Adds or removes a shot break before `lineId`.
 * - If the line starts a shot, that shot is merged into the one before it.
 * - Otherwise the shot containing the line is split there.
 * Lines not yet in any shot are ignored.
 */
export function toggleBreakBefore(shots: Shot[], lineId: string, newId: () => string): Shot[] {
  const idx = shots.findIndex((s) => s.lineIds.includes(lineId));
  if (idx < 0) return shots;
  const shot = shots[idx];
  const pos = shot.lineIds.indexOf(lineId);
  if (pos === 0) {
    if (idx === 0) return shots;
    const prev = shots[idx - 1];
    const merged = { ...prev, lineIds: [...prev.lineIds, ...shot.lineIds] };
    return [...shots.slice(0, idx - 1), merged, ...shots.slice(idx + 1)];
  }
  const head = { ...shot, lineIds: shot.lineIds.slice(0, pos) };
  const tail = { ...structuredClone(shot), id: newId(), lineIds: shot.lineIds.slice(pos) };
  return [...shots.slice(0, idx), head, tail, ...shots.slice(idx + 1)];
}

/**
 * Keeps shots consistent after script lines change: drops ids of deleted lines,
 * removes empty shots, and keeps each shot's lines in script order.
 */
export function reconcileShots(lines: ScriptLine[], shots: Shot[]): Shot[] {
  const order = new Map(lines.map((l, i) => [l.id, i]));
  const result: Shot[] = [];
  for (const s of shots) {
    const ids = s.lineIds.filter((id) => order.has(id)).sort((a, b) => order.get(a)! - order.get(b)!);
    if (ids.length) result.push(ids.length === s.lineIds.length && ids.every((id, i) => id === s.lineIds[i]) ? s : { ...s, lineIds: ids });
  }
  return numberShots(lines, result);
}
