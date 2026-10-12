import type { ActorKey, Character, Stage, StageOverride } from '../state/schema';
import { LIBRARY, PRIMITIVES, resolveParams } from '../three/library';
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

/** Primitive shapes people stand on (platforms, piers, steps), and the param that sets their height (none: flat). */
const GROUND: Record<string, string | null> = { box: 'height', cylinder: 'height', plane: null };
/** Anything taller than this is an obstacle, not something to stand on (m). */
const MAX_GROUND = 1.5;

/** Height of a platform-like shape's top, if people can stand on it. */
function groundTop(o: Stage['objects'][number], overrides: Record<string, StageOverride>): number | undefined {
  if (o.source.kind !== 'primitive' || !(o.source.shape in GROUND) || overrides[o.id]?.hidden) return undefined;
  const pos = overrides[o.id]?.position ?? o.transform.position;
  const param = GROUND[o.source.shape];
  const t = pos[1] + (param ? resolveParams(PRIMITIVES[o.source.shape], o.source.params)[param] * o.transform.scale[1] : 0);
  return t <= MAX_GROUND ? t : undefined;
}

/** Whether people stand on this object rather than walk around it. */
export function isGround(o: Stage['objects'][number]): boolean {
  return groundTop(o, {}) !== undefined;
}

/** Height of the floor at (x, z): the top of the highest platform-like shape there, or 0. */
export function groundAt(stage: Stage | undefined, overrides: Record<string, StageOverride>, x: number, z: number): number {
  let top = 0;
  for (const o of stage?.objects ?? []) {
    const t = groundTop(o, overrides);
    if (t === undefined || t <= top) continue;
    const r = worldRect({ source: o.source, transform: { ...o.transform, position: overrides[o.id]?.position ?? o.transform.position } });
    if (x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ) top = t;
  }
  return top;
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
 * Where a character's body goes for a keyframe. Everyone stands on the floor
 * under them: a platform, pier or step built from a box, cylinder or plane
 * raises them to its top. Someone sitting on a chair or stool is raised so
 * their thighs rest on its seat (the sitting pose is built for an ordinary
 * chair; never lowered, so feet stay on the floor), and on a stool they settle
 * with their weight over its center: hips a little back, legs forward.
 * Heights given in the key add on top.
 */
export function bodyPosition(stage: Stage | undefined, overrides: Record<string, StageOverride>, c: Pick<Character, 'heightCm' | 'sex' | 'build'> | undefined, key: Pick<ActorKey, 'position' | 'pose' | 'yaw'>): [number, number, number] {
  const [x, y, z] = key.position;
  const floor = y + groundAt(stage, overrides, x, z);
  const seat = key.pose === 'sitting' && c ? seatAt(stage, overrides, x, z) : undefined;
  if (!seat || !c) return [x, floor, z];
  const p = proportions(c);
  const lift = seat.top - (POSE_DEFS.sitting.pelvisHeight!(p) - p.limbR);
  const up = y + (lift > 0.02 ? lift : 0);
  if (seat.item !== 'stool') return [x, up, z];
  const yaw = (key.yaw * Math.PI) / 180;
  const back = BALANCE * p.thigh;
  return [seat.x - Math.sin(yaw) * back, up, seat.z - Math.cos(yaw) * back];
}
