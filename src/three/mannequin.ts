import * as THREE from 'three';
import type { Build, Character, PoseId, Sex } from '../state/schema';
import { greyMaterial } from './materials';

/**
 * A simple jointed figure. Units are meters, feet on the floor at the origin,
 * facing +Z. Proportions follow standard anthropometric ratios of height.
 *
 * Joints are nested groups (pelvis → spine → chest → neck → head, chest →
 * shoulder → elbow, pelvis → hip → knee), so a pose is a set of joint
 * rotations. A limb hangs along -Y from its joint. The character's left is
 * +X. Positive X rotation swings a limb backward; positive Z on the left
 * side swings it outward.
 */

export type Joint =
  | 'pelvis' | 'spine' | 'neck'
  | 'shoulderL' | 'elbowL' | 'shoulderR' | 'elbowR'
  | 'hipL' | 'kneeL' | 'hipR' | 'kneeR';

type Rot = [number, number, number];
interface Pose {
  joints: Partial<Record<Joint, Rot>>;
  /** Pelvis height as a fraction of the standing hip height. */
  pelvisHeight?: (h: Proportions) => number;
  root?: { rotation?: Rot; lift?: (h: Proportions) => number };
}

export interface Proportions {
  height: number;
  hipY: number;
  thigh: number;
  shin: number;
  foot: number;
  torso: number;
  neck: number;
  headR: number;
  upperArm: number;
  forearm: number;
  shoulderHalf: number;
  hipHalf: number;
  limbR: number;
  torsoW: number;
  torsoD: number;
  pelvisW: number;
}

const SEX_SHAPE: Record<Sex, { shoulders: number; hips: number; pelvis: number }> = {
  male: { shoulders: 0.129, hips: 0.05, pelvis: 0.1 },
  female: { shoulders: 0.112, hips: 0.058, pelvis: 0.112 },
  other: { shoulders: 0.12, hips: 0.054, pelvis: 0.106 },
};
const BUILD_SCALE: Record<Build, number> = { slim: 0.85, average: 1, heavy: 1.28 };

export function proportions(c: Pick<Character, 'heightCm' | 'sex' | 'build'>): Proportions {
  const H = c.heightCm / 100;
  const shape = SEX_SHAPE[c.sex];
  const b = BUILD_SCALE[c.build];
  return {
    height: H,
    hipY: 0.52 * H,
    thigh: 0.235 * H,
    shin: 0.245 * H,
    foot: 0.04 * H,
    torso: 0.818 * H - 0.52 * H,
    neck: 0.052 * H,
    headR: 0.065 * H,
    upperArm: 0.186 * H,
    forearm: 0.146 * H + 0.06 * H, // includes the hand
    shoulderHalf: shape.shoulders * H,
    hipHalf: shape.hips * H,
    limbR: 0.024 * H * b,
    torsoW: shape.shoulders * H * 1.7 * Math.sqrt(b),
    torsoD: 0.11 * H * b,
    pelvisW: shape.pelvis * H * 2 * Math.sqrt(b),
  };
}

const deg = THREE.MathUtils.degToRad;

export const POSE_DEFS: Record<PoseId, Pose> = {
  standing: {
    joints: { shoulderL: [0, 0, deg(6)], shoulderR: [0, 0, deg(-6)], elbowL: [deg(-8), 0, 0], elbowR: [deg(-8), 0, 0] },
  },
  walking: {
    joints: {
      hipL: [deg(-24), 0, 0], kneeL: [deg(10), 0, 0], hipR: [deg(18), 0, 0], kneeR: [deg(30), 0, 0],
      shoulderL: [deg(18), 0, deg(6)], shoulderR: [deg(-20), 0, deg(-6)], elbowL: [deg(-10), 0, 0], elbowR: [deg(-25), 0, 0],
    },
  },
  sitting: {
    joints: {
      hipL: [deg(-90), 0, deg(3)], kneeL: [deg(90), 0, 0], hipR: [deg(-90), 0, deg(-3)], kneeR: [deg(90), 0, 0],
      shoulderL: [deg(-10), 0, deg(6)], shoulderR: [deg(-10), 0, deg(-6)], elbowL: [deg(-55), 0, 0], elbowR: [deg(-55), 0, 0],
    },
    // Thighs level at knee height, shins down to the floor.
    pelvisHeight: (p) => p.shin + p.foot + p.limbR,
  },
  leaning: {
    joints: {
      spine: [deg(-6), 0, deg(3)], hipR: [deg(-8), 0, deg(4)], kneeR: [deg(16), 0, 0], hipL: [deg(4), 0, 0],
      shoulderL: [deg(-35), 0, deg(-12)], shoulderR: [deg(-35), 0, deg(12)], elbowL: [deg(-80), deg(30), 0], elbowR: [deg(-80), deg(-30), 0],
    },
  },
  lying: {
    joints: { shoulderL: [0, 0, deg(10)], shoulderR: [0, 0, deg(-10)] },
    // On the back, head toward -Z, face up.
    root: { rotation: [deg(-90), 0, 0], lift: (p) => p.torsoD / 2 },
  },
};

function capsule(radius: number, length: number, shade: number): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.CapsuleGeometry(radius, Math.max(0.001, length - 2 * radius), 4, 10), greyMaterial(shade));
  m.position.y = -length / 2;
  m.userData.shade = shade;
  return m;
}

/** A ball at a joint, so limbs read as connected. */
function ball(radius: number, shade: number): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.SphereGeometry(radius, 12, 8), greyMaterial(shade));
  m.userData.shade = shade;
  return m;
}

function joint(name: Joint, x = 0, y = 0, z = 0): THREE.Group {
  const g = new THREE.Group();
  g.name = name;
  g.position.set(x, y, z);
  return g;
}

let darkMat: THREE.MeshStandardMaterial | undefined;
function dark(): THREE.MeshStandardMaterial {
  darkMat ??= Object.assign(new THREE.MeshStandardMaterial({ color: 0x18181b, roughness: 0.5 }), { userData: { shared: true } });
  return darkMat;
}

const SKIN = 0.78;
const BODY = 0.62;
const LEGS = 0.5;

export function buildMannequin(c: Pick<Character, 'heightCm' | 'sex' | 'build' | 'tint'>, pose: PoseId = 'standing'): THREE.Group {
  const p = proportions(c);
  const root = new THREE.Group();
  root.name = 'mannequin';
  const body = new THREE.Group();
  root.add(body);

  // Pelvis and torso
  const pelvis = joint('pelvis', 0, p.hipY, 0);
  body.add(pelvis);
  const hips = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 10), greyMaterial(BODY));
  hips.scale.set(p.pelvisW / 2, p.torso * 0.22, p.torsoD / 2);
  hips.position.y = p.torso * 0.06;
  hips.userData.shade = BODY;
  pelvis.add(hips);

  const spine = joint('spine', 0, p.torso * 0.12, 0);
  pelvis.add(spine);
  const chest = new THREE.Mesh(new THREE.CapsuleGeometry(1, 1, 4, 16), greyMaterial(BODY));
  // A capsule of radius 1 and length 1 is 3 units tall; scale it into a torso.
  const torsoLen = p.torso * 0.88;
  chest.scale.set(p.torsoW / 2, torsoLen / 3, p.torsoD / 2);
  chest.position.y = torsoLen / 2;
  chest.userData.shade = BODY;
  spine.add(chest);

  // Neck and head
  const neck = joint('neck', 0, torsoLen, 0);
  spine.add(neck);
  const neckMesh = new THREE.Mesh(new THREE.CylinderGeometry(p.headR * 0.42, p.headR * 0.5, p.neck, 10), greyMaterial(SKIN));
  neckMesh.position.y = p.neck / 2;
  neckMesh.userData.shade = SKIN;
  neck.add(neckMesh);
  const head = new THREE.Group();
  head.name = 'head';
  head.position.y = p.neck + p.headR * 0.95;
  neck.add(head);
  const skull = new THREE.Mesh(new THREE.SphereGeometry(p.headR, 20, 14), greyMaterial(SKIN));
  skull.scale.set(0.9, 1.12, 1);
  skull.userData.shade = SKIN;
  head.add(skull);
  // Eyes and nose make facing obvious at a glance.
  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(p.headR * 0.16, 10, 8), dark());
    eye.position.set(side * p.headR * 0.36, p.headR * 0.18, p.headR * 0.86);
    eye.name = 'eye';
    head.add(eye);
  }
  const nose = new THREE.Mesh(new THREE.SphereGeometry(p.headR * 0.17, 10, 8), greyMaterial(SKIN - 0.08));
  nose.position.set(0, -p.headR * 0.08, p.headR * 1.0);
  nose.scale.set(0.8, 1, 1.2);
  nose.name = 'nose';
  nose.userData.shade = SKIN - 0.08;
  head.add(nose);

  // Arms
  const shoulderY = torsoLen * 0.93;
  for (const [side, s] of [['L', 1], ['R', -1]] as const) {
    const shoulder = joint(`shoulder${side}`, s * p.shoulderHalf, shoulderY, 0);
    spine.add(shoulder);
    shoulder.add(ball(p.limbR * 1.45, BODY), capsule(p.limbR * 1.05, p.upperArm, BODY));
    const elbow = joint(`elbow${side}`, 0, -p.upperArm, 0);
    shoulder.add(elbow);
    elbow.add(ball(p.limbR * 0.98, SKIN), capsule(p.limbR * 0.9, p.forearm, SKIN));
  }

  // Legs
  for (const [side, s] of [['L', 1], ['R', -1]] as const) {
    const hip = joint(`hip${side}`, s * p.hipHalf, 0, 0);
    pelvis.add(hip);
    hip.add(ball(p.limbR * 1.4, LEGS), capsule(p.limbR * 1.35, p.thigh, LEGS));
    const knee = joint(`knee${side}`, 0, -p.thigh, 0);
    hip.add(knee);
    knee.add(ball(p.limbR * 1.2, LEGS), capsule(p.limbR * 1.1, p.shin, LEGS));
    const foot = new THREE.Mesh(new THREE.BoxGeometry(p.limbR * 2.2, p.foot, p.height * 0.15), greyMaterial(0.35));
    foot.position.set(0, -p.shin - p.foot / 2, p.height * 0.045);
    foot.userData.shade = 0.35;
    knee.add(foot);
  }

  applyPose(root, c, pose);

  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) {
      m.castShadow = true;
      m.receiveShadow = true;
    }
  });

  if (c.tint) root.add(baseMarker(c.tint, p));
  return root;
}

/** Sets joint rotations for a pose. Joints not named by the pose return to rest. */
export function applyPose(root: THREE.Object3D, c: Pick<Character, 'heightCm' | 'sex' | 'build'>, pose: PoseId): void {
  const p = proportions(c);
  const def = POSE_DEFS[pose];
  const body = root.children[0];
  root.traverse((o) => {
    if ((o.name as Joint) in JOINT_SET) {
      const r = def.joints[o.name as Joint] ?? [0, 0, 0];
      o.rotation.set(r[0], r[1], r[2]);
    }
  });
  const pelvis = root.getObjectByName('pelvis')!;
  pelvis.position.y = def.pelvisHeight ? def.pelvisHeight(p) : p.hipY;
  body.rotation.set(...(def.root?.rotation ?? [0, 0, 0]));
  body.position.set(0, def.root?.lift?.(p) ?? 0, 0);
}

const JOINT_SET: Record<Joint, true> = {
  pelvis: true, spine: true, neck: true, shoulderL: true, elbowL: true, shoulderR: true, elbowR: true, hipL: true, kneeL: true, hipR: true, kneeR: true,
};

/** A colored ring on the floor with a notch toward the front. */
function baseMarker(tint: string, p: Proportions): THREE.Group {
  const g = new THREE.Group();
  g.name = 'marker';
  const mat = new THREE.MeshBasicMaterial({ color: tint, transparent: true, opacity: 0.85, depthWrite: false });
  const r = Math.max(0.25, p.height * 0.17);
  const ring = new THREE.Mesh(new THREE.RingGeometry(r * 0.86, r, 40), mat);
  ring.rotation.x = -Math.PI / 2;
  const notch = new THREE.Mesh(new THREE.CircleGeometry(r * 0.16, 3), mat);
  notch.rotation.set(-Math.PI / 2, 0, Math.PI / 2);
  notch.position.z = r * 1.12;
  g.add(ring, notch);
  g.position.y = 0.004;
  return g;
}
