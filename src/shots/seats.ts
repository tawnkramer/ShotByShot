import type { ActorKey, Character, Stage, StageOverride } from '../state/schema';
import { LIBRARY, resolveParams } from '../three/library';
import { POSE_DEFS, proportions } from '../three/mannequin';
import { worldRect } from '../staging/placement';

/** Library items people sit on, and the param that sets the seat's height. */
const SEATS: Record<string, string> = { chair: 'seatHeight', stool: 'height' };
/** How far from a seat's footprint someone still counts as sitting on it (m). */
const REACH = 0.1;
/**
 * A seated body's center of mass is about this far ahead of the hips, in
 * thigh lengths (torso over the hips, thighs at mid-thigh, shins at the knee).
 */
const BALANCE = 0.2;

interface Seat {
  item: string;
  /** Center of the seat on the floor. */
  x: number;
  z: number;
  top: number;
}

/** The chair or stool whose footprint (x, z) is on, nearest first. */
export function seatAt(stage: Stage | undefined, overrides: Record<string, StageOverride>, x: number, z: number): Seat | undefined {
  let best: (Seat & { d: number }) | undefined;
  for (const o of stage?.objects ?? []) {
    if (o.source.kind !== 'library' || !(o.source.item in SEATS) || overrides[o.id]?.hidden) continue;
    const pos = overrides[o.id]?.position ?? o.transform.position;
    const r = worldRect({ source: o.source, transform: { ...o.transform, position: pos } });
    if (x < r.minX - REACH || x > r.maxX + REACH || z < r.minZ - REACH || z > r.maxZ + REACH) continue;
    const top = pos[1] + resolveParams(LIBRARY[o.source.item], o.source.params)[SEATS[o.source.item]] * o.transform.scale[1];
    const d = Math.hypot(x - pos[0], z - pos[2]);
    if (!best || d < best.d) best = { item: o.source.item, x: pos[0], z: pos[2], top, d };
  }
  return best;
}

/**
 * Where a character's body goes for a keyframe. Someone sitting on a seat is
 * raised so their thighs rest on it (the sitting pose is built for an
 * ordinary chair; never lowered, so feet stay on the floor). On a stool they
 * also settle onto it with their weight over its center: hips a little back
 * from the middle, legs forward. Everyone else stays where the key says.
 */
export function seatedPosition(stage: Stage | undefined, overrides: Record<string, StageOverride>, c: Pick<Character, 'heightCm' | 'sex' | 'build'> | undefined, key: Pick<ActorKey, 'position' | 'pose' | 'yaw'>): [number, number, number] {
  const [x, y, z] = key.position;
  if (key.pose !== 'sitting' || !c) return [x, y, z];
  const seat = seatAt(stage, overrides, x, z);
  if (!seat) return [x, y, z];
  const p = proportions(c);
  const lift = seat.top - (POSE_DEFS.sitting.pelvisHeight!(p) - p.limbR);
  const up = y + (lift > 0.02 ? lift : 0);
  if (seat.item !== 'stool') return [x, up, z];
  const yaw = (key.yaw * Math.PI) / 180;
  const back = BALANCE * p.thigh;
  return [seat.x - Math.sin(yaw) * back, up, seat.z - Math.cos(yaw) * back];
}
