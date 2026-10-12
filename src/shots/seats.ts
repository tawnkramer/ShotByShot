import type { ActorKey, Character, Stage, StageOverride } from '../state/schema';
import { LIBRARY, resolveParams } from '../three/library';
import { POSE_DEFS, proportions } from '../three/mannequin';
import { worldRect } from '../staging/placement';

/** Library items people sit on, and the param that sets the seat's height. */
const SEATS: Record<string, string> = { chair: 'seatHeight', stool: 'height' };
/** How far from a seat's footprint someone still counts as sitting on it (m). */
const REACH = 0.1;

/** The seat under a sitting character: the top of the nearest chair or stool whose footprint they're on. */
export function seatTop(stage: Stage | undefined, overrides: Record<string, StageOverride>, x: number, z: number): number | undefined {
  let best: { top: number; d: number } | undefined;
  for (const o of stage?.objects ?? []) {
    if (o.source.kind !== 'library' || !(o.source.item in SEATS) || overrides[o.id]?.hidden) continue;
    const pos = overrides[o.id]?.position ?? o.transform.position;
    const r = worldRect({ source: o.source, transform: { ...o.transform, position: pos } });
    if (x < r.minX - REACH || x > r.maxX + REACH || z < r.minZ - REACH || z > r.maxZ + REACH) continue;
    const top = pos[1] + resolveParams(LIBRARY[o.source.item], o.source.params)[SEATS[o.source.item]] * o.transform.scale[1];
    const d = Math.hypot(x - pos[0], z - pos[2]);
    if (!best || d < best.d) best = { top, d };
  }
  return best?.top;
}

/**
 * How far to raise a sitting character so their thighs rest on the seat
 * they're on. The sitting pose is built for an ordinary chair, so a bar stool
 * needs a lift; never lowered (feet stay on the floor).
 */
export function seatLift(stage: Stage | undefined, overrides: Record<string, StageOverride>, c: Pick<Character, 'heightCm' | 'sex' | 'build'> | undefined, key: Pick<ActorKey, 'position' | 'pose'>): number {
  if (key.pose !== 'sitting' || !c) return 0;
  const top = seatTop(stage, overrides, key.position[0], key.position[2]);
  if (top === undefined) return 0;
  const p = proportions(c);
  const thighs = POSE_DEFS.sitting.pelvisHeight!(p) - p.limbR;
  const lift = top - thighs;
  return lift > 0.02 ? lift : 0;
}
