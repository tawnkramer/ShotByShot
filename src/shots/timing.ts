import type { ActorKey, CameraState, Keyframed, Placement, ScriptLine } from '../state/schema';
import { speakerOf } from '../story/classify';

export const WORDS_PER_SEC = 2.7;
const LINE_PAD = 0.4;
const ACTION_SEC = 2;
export const MIN_SHOT_SEC = 1.5;
const LEAD_IN = 0.3;

const words = (s: string) => s.split(/\s+/).filter(Boolean).length;
const isParenthetical = (s: string) => /^\(.*\)$/.test(s.trim());

/** Seconds a shot needs: dialogue at a natural pace, a couple of seconds per action line. */
export function estimateDuration(lines: ScriptLine[]): number {
  let sec = 0;
  for (const l of lines) {
    if (l.type === 'dialogue' && !isParenthetical(l.text)) sec += words(l.text) / WORDS_PER_SEC + LINE_PAD;
    else if (l.type === 'action') sec += Math.min(4, Math.max(ACTION_SEC, words(l.text) / 6));
  }
  return Math.max(MIN_SHOT_SEC, Math.round(sec * 10) / 10);
}

export interface Caption {
  lineId: string;
  speaker?: string;
  text: string;
  inSec: number;
  outSec: number;
  /** Spoken audio for this line, when generated. */
  audioBlob?: string;
}

export type ClipMap = Map<string, { blob: string; durationSec: number }>;

const CLIP_GAP = 0.25;
const TAIL = 0.4;

/** True when any spoken line in the shot has audio, so timing follows the clips. */
function voiced(lines: ScriptLine[], clips?: ClipMap): boolean {
  return !!clips && lines.some((l) => l.type === 'dialogue' && !isParenthetical(l.text) && clips.has(l.id));
}

/** How long a spoken line takes: its clip, or an estimate when it hasn't been voiced. */
function lineSec(l: ScriptLine, clips: ClipMap): number {
  const clip = clips.get(l.id);
  return clip ? clip.durationSec : words(l.text) / WORDS_PER_SEC + LINE_PAD - CLIP_GAP;
}

/**
 * Seconds a shot needs. With audio, dialogue takes as long as the clips (plus
 * small gaps, and an estimate for any line not voiced yet); otherwise it's
 * estimated from word count.
 */
export function autoDuration(lines: ScriptLine[], clips?: ClipMap): number {
  if (!voiced(lines, clips)) return estimateDuration(lines);
  let sec = LEAD_IN + TAIL;
  for (const l of lines) {
    if (l.type === 'dialogue' && !isParenthetical(l.text)) sec += lineSec(l, clips!) + CLIP_GAP;
    else if (l.type === 'action') sec += Math.min(4, Math.max(ACTION_SEC, words(l.text) / 6));
  }
  return Math.max(MIN_SHOT_SEC, Math.round(sec * 10) / 10);
}

/**
 * Caption timing. With audio, each caption lasts exactly as long as its clip,
 * one after another (unvoiced lines get an estimate and stay silent);
 * otherwise lines share the shot by word count.
 */
export function shotCaptions(lines: ScriptLine[], durationSec: number, clips?: ClipMap): Caption[] {
  if (!voiced(lines, clips)) return captionsFor(lines, durationSec);
  const speakers = speakerOf(lines);
  const out: Caption[] = [];
  let t = Math.min(LEAD_IN, durationSec * 0.1);
  for (const l of lines) {
    if (l.type !== 'dialogue' || isParenthetical(l.text)) continue;
    const sec = lineSec(l, clips!);
    const name = speakers.get(l.id);
    out.push({ lineId: l.id, speaker: name ? titleCase(name) : undefined, text: l.text, inSec: t, outSec: t + sec, audioBlob: clips!.get(l.id)?.blob });
    t += sec + CLIP_GAP;
  }
  return out;
}

/**
 * Lays dialogue out across the shot: a short lead-in, then each line for a
 * share of the remaining time proportional to its length. Parentheticals
 * ("(quietly)") are direction, not captions.
 */
export function captionsFor(lines: ScriptLine[], durationSec: number): Caption[] {
  const speakers = speakerOf(lines);
  const spoken = lines.filter((l) => l.type === 'dialogue' && !isParenthetical(l.text));
  if (!spoken.length) return [];
  const weights = spoken.map((l) => words(l.text) / WORDS_PER_SEC + LINE_PAD);
  const total = weights.reduce((a, b) => a + b, 0);
  const lead = Math.min(LEAD_IN, durationSec * 0.1);
  const scale = (durationSec - lead) / total;
  let t = lead;
  return spoken.map((l, i) => {
    const inSec = t;
    t += weights[i] * scale;
    const name = speakers.get(l.id);
    return { lineId: l.id, speaker: name ? titleCase(name) : undefined, text: l.text, inSec, outSec: t };
  });
}

function titleCase(s: string): string {
  return s.toLowerCase().replace(/(^|[\s'.-])(\p{L})/gu, (_, a: string, b: string) => a + b.toUpperCase());
}

export function captionAt(captions: Caption[], t: number): Caption | undefined {
  return captions.find((c) => t >= c.inSec && t < c.outSec);
}

// --- Interpolation ---

export function ease(u: number, easing: 'linear' | 'easeInOut'): number {
  const x = Math.min(1, Math.max(0, u));
  return easing === 'linear' ? x : x * x * (3 - 2 * x);
}

const lerp = (a: number, b: number, u: number) => a + (b - a) * u;

/** Interpolates angles in degrees the short way round. */
export function lerpAngle(a: number, b: number, u: number): number {
  const d = ((((b - a) % 360) + 540) % 360) - 180;
  return a + d * u;
}

const lerpVec = (a: [number, number, number], b: [number, number, number], u: number): [number, number, number] => [lerp(a[0], b[0], u), lerp(a[1], b[1], u), lerp(a[2], b[2], u)];

export function lerpCamera(a: CameraState, b: CameraState, u: number): CameraState {
  return {
    target: lerpVec(a.target, b.target, u),
    azimuth: lerpAngle(a.azimuth, b.azimuth, u),
    elevation: lerp(a.elevation, b.elevation, u),
    // Dolly moves feel even in log space.
    distance: Math.exp(lerp(Math.log(a.distance), Math.log(b.distance), u)),
    lens: Math.exp(lerp(Math.log(a.lens), Math.log(b.lens), u)),
    roll: lerp(a.roll, b.roll, u),
  };
}

export function lerpPlacement<T extends Placement>(a: T, b: T, u: number): Placement {
  return { position: lerpVec(a.position, b.position, u), yaw: lerpAngle(a.yaw, b.yaw, u) };
}

/** The value of a keyframed track at progress u (0..1 through the shot). */
export function sample<T>(track: Keyframed<T>, u: number, lerpFn: (a: T, b: T, u: number) => T): T {
  if (track.mode === 'static' || !track.end) return track.start;
  return lerpFn(track.start, track.end, ease(u, track.easing));
}

export interface ActorFrame extends Placement {
  pose: ActorKey['pose'];
  joints?: ActorKey['joints'];
  /** 0..1 phase of the walk cycle while walking between keyframes, else undefined. */
  walkPhase?: number;
}

const STRIDE_M = 1.4; // one full cycle (two steps)

export function sampleActor(track: Keyframed<ActorKey>, u: number): ActorFrame {
  if (track.mode === 'static' || !track.end) return { ...track.start };
  const e = ease(u, track.easing);
  const p = lerpPlacement(track.start, track.end, e);
  const dist = Math.hypot(track.end.position[0] - track.start.position[0], track.end.position[2] - track.start.position[2]);
  if (dist > 0.3 && u > 0 && u < 1) {
    // Walk while covering ground, with the cycle tied to distance so feet don't slide much.
    return { ...p, pose: 'standing', walkPhase: ((dist * e) / STRIDE_M) % 1 };
  }
  const k = u < 0.5 ? track.start : track.end;
  return { ...p, pose: k.pose, ...(k.joints ? { joints: k.joints } : {}) };
}

/** Same as `track` but with one keyframe replaced; editing End on a static track makes it move. */
export function withKey<T>(track: Keyframed<T>, which: 'start' | 'end', value: T): Keyframed<T> {
  if (which === 'start') return { ...track, start: value };
  return { ...track, mode: 'moving', end: value };
}

/** The keyframe being edited, falling back to start for static tracks. */
export function keyOf<T>(track: Keyframed<T>, which: 'start' | 'end'): T {
  return which === 'end' && track.end ? track.end : track.start;
}
