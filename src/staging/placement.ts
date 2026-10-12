import * as THREE from 'three';
import type { ObjectSource, Stage, StageObject, Transform } from '../state/schema';
import { buildStatic } from '../three/library';
import { disposeObject } from '../three/materials';

/** Half-width (x) and half-depth (z) of an object's footprint, before rotation. */
type Extent = { hx: number; hz: number };

const cache = new Map<string, Extent & { h: number }>();

/** Footprint plus height, before rotation and scale. */
export function objectExtent(source: ObjectSource): Extent & { h: number } {
  if (source.kind === 'asset') return { hx: 0.5, hz: 0.5, h: 1 };
  const key = JSON.stringify(source);
  let e = cache.get(key);
  if (!e) {
    const g = buildStatic(source);
    const box = new THREE.Box3().setFromObject(g);
    disposeObject(g);
    e = { hx: Math.max(0.05, (box.max.x - box.min.x) / 2), hz: Math.max(0.05, (box.max.z - box.min.z) / 2), h: Math.max(0.01, box.max.y) };
    cache.set(key, e);
  }
  return e;
}

export function footprint(source: ObjectSource): Extent {
  const { hx, hz } = objectExtent(source);
  return { hx, hz };
}

/** Rooms, walls and floors are things you place objects inside or against, not obstacles. */
export function isContainer(source: ObjectSource): boolean {
  return (source.kind === 'library' && (source.item === 'room' || source.item === 'wall')) || (source.kind === 'primitive' && source.shape === 'plane');
}

/** Axis-aligned footprint in world space, accounting for scale and rotation about Y. */
export function worldRect(o: Pick<StageObject, 'source' | 'transform'>) {
  const { hx, hz } = footprint(o.source);
  const [sx, , sz] = o.transform.scale;
  const yaw = new THREE.Euler().setFromQuaternion(new THREE.Quaternion().fromArray(o.transform.rotation), 'YXZ').y;
  const c = Math.abs(Math.cos(yaw)), s = Math.abs(Math.sin(yaw));
  const ex = hx * sx * c + hz * sz * s;
  const ez = hx * sx * s + hz * sz * c;
  const [x, , z] = o.transform.position;
  return { minX: x - ex, maxX: x + ex, minZ: z - ez, maxZ: z + ez };
}

const GAP = 0.15;
const STEP = 0.5;

/**
 * The nearest free spot to the middle of the stage for a new object, searching
 * outward in rings so it doesn't land inside anything already there.
 */
export function freeSpot(stage: Stage, source: ObjectSource): Transform['position'] {
  if (isContainer(source)) return [0, 0, 0];
  return freeSpotFor(stage, footprint(source));
}

export type Rect = ReturnType<typeof worldRect>;

/** A clear spot for a footprint of half-size hx × hz, searching outward from `center`. */
export function freeSpotFor(stage: Stage | undefined, { hx, hz }: Extent, center: [number, number] = [0, 0], extra: Rect[] = []): Transform['position'] {
  const obstacles = [...(stage?.objects ?? []).filter((o) => !isContainer(o.source)).map(worldRect), ...extra];
  for (let ring = 0; ring <= 20; ring++) {
    for (let i = -ring; i <= ring; i++) {
      for (let j = -ring; j <= ring; j++) {
        if (Math.max(Math.abs(i), Math.abs(j)) !== ring) continue;
        const x = center[0] + i * STEP, z = center[1] + j * STEP;
        const clear = obstacles.every(
          (r) => x + hx + GAP <= r.minX || x - hx - GAP >= r.maxX || z + hz + GAP <= r.minZ || z - hz - GAP >= r.maxZ,
        );
        if (clear) return [x, 0, z];
      }
    }
  }
  return [center[0], 0, center[1]];
}
