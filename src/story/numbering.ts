import type { ScriptLine, Shot } from '../state/schema';

export const SHOT_NUMBERINGS = ['scene.shot', 'slate', 'vfx', 'sequential'] as const;
export type ShotNumbering = (typeof SHOT_NUMBERINGS)[number];

export const NUMBERING_INFO: Record<ShotNumbering, { label: string; example: string; note: string }> = {
  'scene.shot': { label: 'Scene.shot', example: '12.1, 12.2, 12.3', note: 'Clear and common on shot lists and storyboards.' },
  slate: { label: 'Slate', example: '12, 12A, 12B', note: 'US slate style. I and O are skipped so they aren’t misread as 1 and 0.' },
  vfx: { label: 'Previs / VFX', example: 'SQ120_SH0010, SH0020', note: 'Counts in tens. Merging or splitting fills the gaps (SH0015) instead of renumbering.' },
  sequential: { label: 'Sequential', example: '1, 2, 3', note: 'One running number for the whole film.' },
};

/** Scene label for each line: the script's own scene number when given, otherwise a running count. */
export function sceneLabels(lines: ScriptLine[]): { labelOf: Map<string, string>; ordinalOf: Map<string, number>; hasScenes: boolean } {
  const labelOf = new Map<string, string>();
  const ordinalOf = new Map<string, number>();
  let label = '1';
  let ordinal = 0;
  let count = 0;
  for (const l of lines) {
    if (l.type === 'scene') {
      ordinal++;
      if (l.sceneNumber) {
        label = l.sceneNumber;
        const n = parseInt(l.sceneNumber, 10);
        if (Number.isFinite(n)) count = n;
      } else label = String(++count);
    }
    labelOf.set(l.id, label);
    ordinalOf.set(l.id, Math.max(1, ordinal));
  }
  return { labelOf, ordinalOf, hasScenes: ordinal > 0 };
}

/** Slate suffixes without I and O: A…H, J…N, P…Z, then AA, AB… */
const SLATE_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
export function slateSuffix(n: number): string {
  let s = '';
  n += 1;
  while (n > 0) {
    const r = (n - 1) % SLATE_LETTERS.length;
    s = SLATE_LETTERS[r] + s;
    n = Math.floor((n - 1) / SLATE_LETTERS.length);
  }
  return s;
}

const VFX_RE = /^SQ(\d{3,})_SH(\d{4,})$/;
const pad = (n: number, w: number) => String(n).padStart(w, '0');

/**
 * VFX shot numbers within one sequence. Shots keep their numbers when they
 * still fit in order; new shots take a number in the gap between neighbors
 * (SH0015 between SH0010 and SH0020). If there's no room, the sequence is
 * renumbered in tens.
 */
function vfxNumbers(current: string[], seq: number): number[] {
  const parsed = current.map((c) => {
    const m = VFX_RE.exec(c);
    return m && Number(m[1]) === seq ? Number(m[2]) : null;
  });
  // Keep numbers that are still in increasing order.
  const kept: (number | null)[] = [];
  let last = 0;
  for (const v of parsed) {
    if (v !== null && v > last) {
      kept.push(v);
      last = v;
    } else kept.push(null);
  }
  const out = [...kept];
  let i = 0;
  while (i < out.length) {
    if (out[i] !== null) {
      i++;
      continue;
    }
    let j = i;
    while (j < out.length && out[j] === null) j++;
    const a = i > 0 ? out[i - 1]! : 0;
    const b = j < out.length ? out[j]! : Infinity;
    const m = j - i;
    if (b === Infinity) for (let k = 0; k < m; k++) out[i + k] = a + 10 * (k + 1);
    else {
      const step = Math.floor((b - a) / (m + 1));
      if (step < 1) return current.map((_, k) => 10 * (k + 1));
      for (let k = 0; k < m; k++) out[i + k] = a + step * (k + 1);
    }
    i = j;
  }
  return out as number[];
}

/** Gives every shot its number in the chosen style. Returns the same shot objects where nothing changed. */
export function renumber<T extends Shot>(lines: ScriptLine[], shots: T[], style: ShotNumbering = 'scene.shot'): T[] {
  const { labelOf, ordinalOf, hasScenes } = sceneLabels(lines);
  const numbers: string[] = new Array(shots.length);
  if (style === 'sequential' || !hasScenes) {
    shots.forEach((_, i) => (numbers[i] = String(i + 1)));
  } else {
    // Group consecutive shots by the scene of their first line.
    let start = 0;
    while (start < shots.length) {
      const scene = labelOf.get(shots[start].lineIds[0]) ?? '1';
      const ordinal = ordinalOf.get(shots[start].lineIds[0]) ?? 1;
      let end = start;
      while (end < shots.length && (labelOf.get(shots[end].lineIds[0]) ?? '1') === scene && (ordinalOf.get(shots[end].lineIds[0]) ?? 1) === ordinal) end++;
      const group = shots.slice(start, end);
      if (style === 'scene.shot') group.forEach((_, k) => (numbers[start + k] = `${scene}.${k + 1}`));
      else if (style === 'slate') group.forEach((_, k) => (numbers[start + k] = k === 0 ? scene : `${scene}${slateSuffix(k - 1)}`));
      else {
        const seq = ordinal * 10;
        vfxNumbers(group.map((s) => s.number), seq).forEach((n, k) => (numbers[start + k] = `SQ${pad(seq, 3)}_SH${pad(n, 4)}`));
      }
      start = end;
    }
  }
  return shots.map((s, i) => (s.number === numbers[i] ? s : { ...s, number: numbers[i] }));
}
