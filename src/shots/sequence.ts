import type { Project } from '../state/schema';
import { effectiveShots } from './setup';

export interface SequenceItem {
  shotId: string;
  number: string;
  /** Seconds from the start of the film. */
  start: number;
  duration: number;
}

export interface Sequence {
  items: SequenceItem[];
  total: number;
}

const cache = new WeakMap<Project, Sequence>();

/** All shots laid end to end. */
export function buildSequence(project: Project): Sequence {
  const hit = cache.get(project);
  if (hit) return hit;
  const eff = effectiveShots(project);
  let t = 0;
  const items = project.shots.map((s) => {
    const duration = eff.get(s.id)?.durationSec ?? 1;
    const item = { shotId: s.id, number: s.number, start: t, duration };
    t += duration;
    return item;
  });
  const seq = { items, total: t };
  cache.set(project, seq);
  return seq;
}

/** Which shot is on screen at time t, and how far through it (0..1). */
export function locate(seq: Sequence, t: number): { index: number; u: number } {
  const { items } = seq;
  if (!items.length) return { index: -1, u: 0 };
  const time = Math.min(Math.max(0, t), seq.total);
  let lo = 0, hi = items.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (items[mid].start <= time) lo = mid;
    else hi = mid - 1;
  }
  const it = items[lo];
  return { index: lo, u: Math.min(1, (time - it.start) / it.duration) };
}

export function startOf(seq: Sequence, shotId: string): number {
  return seq.items.find((i) => i.shotId === shotId)?.start ?? 0;
}
