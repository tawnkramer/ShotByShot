import type { HeadSpot } from './heads';

/**
 * Automatic placement of balloons and captions on a panel. Pure geometry:
 * the caller measures each item and projects the heads.
 *
 * Internally everything is in panel-height units (x runs 0..aspect, y runs
 * 0..1) so distances mean the same across and down; results are 0..1 of
 * the panel's width and height like the rest of the lettering.
 */

export interface PlaceItem {
  id: string;
  /** Size as fractions of the panel's width and height. */
  w: number;
  h: number;
  caption?: boolean;
  /** The speaker's head, when they're in the shot (in frame or not). */
  speaker?: HeadSpot;
}

/** Lettering that stays where it is (pinned by hand), as center and size in 0..1. */
export interface Fixed { x: number; y: number; w: number; h: number }

export interface Placement { x: number; y: number; tail?: { x: number; y: number } }

interface Box { x0: number; y0: number; x1: number; y1: number }

const MARGIN = 0.025;
const GAP = 0.012;
const COLS = 15, ROWS = 13;

/** The part of a head (and a little hair and chin) that lettering must not cover. */
export function faceBox(h: HeadSpot, aspect: number): Box {
  const x = h.x * aspect;
  return { x0: x - h.r * 1.25, y0: h.y - h.r * 1.4, x1: x + h.r * 1.25, y1: h.y + h.r * 1.5 };
}

function bodyBox(h: HeadSpot, aspect: number): Box {
  const x = h.x * aspect;
  return { x0: x - h.r * 1.8, y0: h.y + h.r * 1.5, x1: x + h.r * 1.8, y1: 1 };
}

function overlap(a: Box, b: Box): number {
  const w = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
  const h = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
  return w > 0 && h > 0 ? w * h : 0;
}

const area = (b: Box) => (b.x1 - b.x0) * (b.y1 - b.y0);
const grow = (b: Box, d: number): Box => ({ x0: b.x0 - d, y0: b.y0 - d, x1: b.x1 + d, y1: b.y1 + d });

/** Distance from a point to the nearest point of a box (0 inside). */
function distTo(b: Box, x: number, y: number): number {
  const dx = Math.max(b.x0 - x, 0, x - b.x1), dy = Math.max(b.y0 - y, 0, y - b.y1);
  return Math.hypot(dx, dy);
}

/**
 * Places items in order (the order they're read). Each goes where it
 * covers no face, overlaps nothing already placed, reads after the one
 * before it (lower, or to its right on the same row), sits high in the
 * panel and close above its speaker.
 */
export function placeLettering(items: PlaceItem[], heads: HeadSpot[], aspect: number, fixed: Fixed[] = [], opts: { rtl?: boolean } = {}): Map<string, Placement> {
  const faces = heads.filter((h) => h.r > 0).map((h) => faceBox(h, aspect));
  const bodies = heads.filter((h) => h.inFrame).map((h) => bodyBox(h, aspect));
  const taken: Box[] = fixed.map((f) => ({ x0: (f.x - f.w / 2) * aspect, y0: f.y - f.h / 2, x1: (f.x + f.w / 2) * aspect, y1: f.y + f.h / 2 }));
  const out = new Map<string, Placement>();
  let prev: Box | undefined;
  const dir = opts.rtl ? -1 : 1;

  for (const item of items) {
    const w = Math.min(item.w * aspect, aspect - 2 * MARGIN), h = Math.min(item.h, 1 - 2 * MARGIN);
    let best: { box: Box; score: number } | undefined;
    for (let i = 0; i < COLS; i++) for (let j = 0; j < ROWS; j++) {
      const cx = MARGIN + w / 2 + ((aspect - 2 * MARGIN - w) * i) / (COLS - 1);
      const cy = MARGIN + h / 2 + ((1 - 2 * MARGIN - h) * j) / (ROWS - 1);
      const box = { x0: cx - w / 2, y0: cy - h / 2, x1: cx + w / 2, y1: cy + h / 2 };
      const a = area(box);
      let score = 0;
      for (const f of faces) score += (overlap(box, f) / Math.min(a, area(f))) * 400;
      for (const b of bodies) score += (overlap(box, b) / a) * 30;
      for (const t of taken) score += (overlap(grow(box, GAP), t) / Math.min(a, area(t))) * 600;
      // Reading order: below the previous one, or beside it (after it) on the same row.
      if (prev) {
        const sameRow = cy < prev.y1 && cy > prev.y0;
        if (sameRow) score += (dir * (cx - (prev.x0 + prev.x1) / 2) < 0 ? 20 : 0);
        else if (cy < (prev.y0 + prev.y1) / 2) score += 20 + 40 * ((prev.y0 + prev.y1) / 2 - cy);
      }
      // High in the panel; the first one near the start of the line.
      score += (item.caption ? 18 : 5) * cy;
      if (!prev || item.caption) score += 2.5 * (opts.rtl ? aspect - cx : cx) / aspect;
      const s = item.speaker;
      if (s && !item.caption) {
        const mx = s.mouth.x * aspect, my = s.mouth.y;
        score += 4 * distTo(box, Math.min(aspect, Math.max(0, mx)), Math.min(1, Math.max(0, my)));
        // Balloons sit above their speaker's mouth, not below it.
        if (box.y1 > my - s.r * 1.4) score += 25 * (box.y1 - (my - s.r * 1.4));
      }
      if (!best || score < best.score) best = { box, score };
    }
    const box = best!.box;
    taken.push(box);
    prev = box;
    const cx = (box.x0 + box.x1) / 2, cy = (box.y0 + box.y1) / 2;
    const placement: Placement = { x: cx / aspect, y: cy };
    if (!item.caption) placement.tail = tailFor(box, item.speaker, aspect);
    out.set(item.id, placement);
  }
  return out;
}

/** Where the tail points: just above the speaker's mouth, to the panel's edge toward them, or to the nearest side. */
function tailFor(box: Box, s: HeadSpot | undefined, aspect: number): { x: number; y: number } {
  const cx = (box.x0 + box.x1) / 2, cy = (box.y0 + box.y1) / 2;
  if (s?.inFrame) {
    const mx = s.mouth.x * aspect, my = s.mouth.y;
    const dx = cx - mx, dy = cy - my, len = Math.hypot(dx, dy) || 1;
    // Stop a little short of the mouth.
    const stop = Math.min(s.r * 1.7, len * 0.5);
    return { x: (mx + (dx / len) * stop) / aspect, y: my + (dy / len) * stop };
  }
  if (s && s.r > 0) {
    // In the shot but out of frame: to the edge in their direction.
    return edgeToward(cx, cy, s.x * aspect, s.y, aspect);
  }
  // Off panel (O.S.) or not in the shot: the nearest side.
  const left = cx < aspect / 2;
  return { x: left ? 0 : 1, y: Math.min(1, box.y1 + (box.y1 - box.y0) * 0.6) };
}

function edgeToward(cx: number, cy: number, tx: number, ty: number, aspect: number): { x: number; y: number } {
  const dx = tx - cx, dy = ty - cy;
  let t = Infinity;
  if (dx > 0) t = Math.min(t, (aspect - cx) / dx);
  if (dx < 0) t = Math.min(t, -cx / dx);
  if (dy > 0) t = Math.min(t, (1 - cy) / dy);
  if (dy < 0) t = Math.min(t, -cy / dy);
  if (!Number.isFinite(t)) return { x: cx / aspect, y: 1 };
  return { x: (cx + dx * t) / aspect, y: cy + dy * t };
}

/** Lettering boxes that cover a face, by character, for warnings. */
export function coveredFaces(boxes: Fixed[], heads: HeadSpot[], aspect: number): string[] {
  const out: string[] = [];
  for (const h of heads) {
    if (!h.inFrame) continue;
    const f = faceBox(h, aspect);
    const covered = boxes.some((b) => overlap({ x0: (b.x - b.w / 2) * aspect, y0: b.y - b.h / 2, x1: (b.x + b.w / 2) * aspect, y1: b.y + b.h / 2 }, f) > area(f) * 0.15);
    if (covered) out.push(h.characterId);
  }
  return out;
}
