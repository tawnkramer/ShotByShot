import * as THREE from 'three';
import type { ActorKey, Character, Joint } from '../state/schema';
import { applyPose, buildSkeleton } from '../three/mannequin';

/** Points on the figure that can be located: the joints, plus the head (its center), mouth, nose tip, ears, wrists and ankles. */
export type BodyPoint = Joint | 'head' | 'mouth' | 'noseTip' | 'earL' | 'earR' | 'wristL' | 'wristR' | 'ankleL' | 'ankleR';
export const BODY_POINTS: BodyPoint[] = [
  'pelvis', 'spine', 'neck', 'head', 'mouth', 'noseTip', 'earL', 'earR',
  'shoulderL', 'elbowL', 'wristL', 'shoulderR', 'elbowR', 'wristR',
  'hipL', 'kneeL', 'ankleL', 'hipR', 'kneeR', 'ankleR',
];

type C = Pick<Character, 'heightCm' | 'sex' | 'build'>;

/** One skeleton per body shape, reposed for each call: building one is the costly part. */
const skeletons = new Map<string, THREE.Group>();

function skeletonFor(c: C): THREE.Group {
  const id = `${c.heightCm}|${c.sex}|${c.build}`;
  let s = skeletons.get(id);
  if (!s) {
    if (skeletons.size > 32) skeletons.clear();
    skeletons.set(id, (s = buildSkeleton(c)));
  }
  return s;
}

/**
 * Where each body point is for a character posed as in `key`, in world
 * metres, with the body's feet at `base` (from `bodyPosition`) and turned by
 * the key's yaw. Same proportions and angles as the drawn mannequin, without
 * building or drawing it.
 */
export function bodyPoints(c: C, key: Pick<ActorKey, 'pose' | 'joints' | 'yaw'>, base: [number, number, number]): Record<BodyPoint, [number, number, number]> {
  const root = skeletonFor(c);
  applyPose(root, c, key.pose, key.joints);
  root.position.set(...base);
  root.rotation.set(0, THREE.MathUtils.degToRad(key.yaw), 0);
  root.updateMatrixWorld(true);
  const v = new THREE.Vector3();
  const out = {} as Record<BodyPoint, [number, number, number]>;
  for (const name of BODY_POINTS) {
    root.getObjectByName(name)!.getWorldPosition(v);
    out[name] = [v.x, v.y, v.z];
  }
  return out;
}
