import * as THREE from 'three';
import { JOINTS, type Build, type Character, type Joint, type JointAngles, type PoseId, type Sex } from '../state/schema';
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

export type { Joint };

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
  /** Elbow to wrist. */
  wrist: number;
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
    wrist: 0.146 * H,
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
  return marker(name, x, y, z);
}

/** An empty named point on the frame. */
function marker(name: string, x = 0, y = 0, z = 0): THREE.Group {
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

/** Length of the torso from the spine joint to the base of the neck. */
const torsoLength = (p: Proportions) => p.torso * 0.88;

/**
 * The jointed frame of the figure with no meshes: the joints, plus the head,
 * mouth, nose tip, ears, wrists and ankles as markers. The mannequin is built on it, and
 * joint positions can be read from it without drawing anything.
 */
export function buildSkeleton(c: Pick<Character, 'heightCm' | 'sex' | 'build'>): THREE.Group {
  const p = proportions(c);
  const torsoLen = torsoLength(p);
  const root = new THREE.Group();
  root.name = 'mannequin';
  const body = new THREE.Group();
  root.add(body);
  const pelvis = joint('pelvis', 0, p.hipY, 0);
  body.add(pelvis);
  const spine = joint('spine', 0, p.torso * 0.12, 0);
  pelvis.add(spine);
  const neck = joint('neck', 0, torsoLen, 0);
  spine.add(neck);
  const head = marker('head', 0, p.neck + p.headR * 0.95, 0);
  neck.add(head);
  head.add(marker('mouth', 0, -p.headR * 0.7, p.headR * 0.8), marker('noseTip', 0, -p.headR * 0.08, p.headR * 1.1));
  head.add(marker('earL', p.headR * 0.9, 0, 0), marker('earR', -p.headR * 0.9, 0, 0));
  for (const [side, s] of [['L', 1], ['R', -1]] as const) {
    const shoulder = joint(`shoulder${side}`, s * p.shoulderHalf, torsoLen * 0.93, 0);
    spine.add(shoulder);
    const elbow = joint(`elbow${side}`, 0, -p.upperArm, 0);
    shoulder.add(elbow);
    elbow.add(marker(`wrist${side}`, 0, -p.wrist, 0));
    const hip = joint(`hip${side}`, s * p.hipHalf, 0, 0);
    pelvis.add(hip);
    const knee = joint(`knee${side}`, 0, -p.thigh, 0);
    hip.add(knee);
    knee.add(marker(`ankle${side}`, 0, -p.shin, 0));
  }
  return root;
}

export function buildMannequin(c: Pick<Character, 'heightCm' | 'sex' | 'build' | 'tint'>, pose: PoseId = 'standing', joints?: JointAngles): THREE.Group {
  const p = proportions(c);
  const root = buildSkeleton(c);
  const at = (name: string) => root.getObjectByName(name)!;

  // Pelvis and torso
  const hips = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 10), greyMaterial(BODY));
  hips.scale.set(p.pelvisW / 2, p.torso * 0.22, p.torsoD / 2);
  hips.position.y = p.torso * 0.06;
  hips.userData.shade = BODY;
  at('pelvis').add(hips);

  const chest = new THREE.Mesh(new THREE.CapsuleGeometry(1, 1, 4, 16), greyMaterial(BODY));
  // A capsule of radius 1 and length 1 is 3 units tall; scale it into a torso.
  const torsoLen = torsoLength(p);
  chest.scale.set(p.torsoW / 2, torsoLen / 3, p.torsoD / 2);
  chest.position.y = torsoLen / 2;
  chest.name = 'chest';
  chest.userData.shade = BODY;
  at('spine').add(chest);

  // Neck and head
  const neckMesh = new THREE.Mesh(new THREE.CylinderGeometry(p.headR * 0.42, p.headR * 0.5, p.neck, 10), greyMaterial(SKIN));
  neckMesh.position.y = p.neck / 2;
  neckMesh.userData.shade = SKIN;
  at('neck').add(neckMesh);
  const head = at('head');
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

  // Arms and legs
  for (const side of ['L', 'R'] as const) {
    at(`shoulder${side}`).add(ball(p.limbR * 1.45, BODY), capsule(p.limbR * 1.05, p.upperArm, BODY));
    at(`elbow${side}`).add(ball(p.limbR * 0.98, SKIN), capsule(p.limbR * 0.9, p.forearm, SKIN));
    at(`hip${side}`).add(ball(p.limbR * 1.4, LEGS), capsule(p.limbR * 1.35, p.thigh, LEGS));
    const knee = at(`knee${side}`);
    knee.add(ball(p.limbR * 1.2, LEGS), capsule(p.limbR * 1.1, p.shin, LEGS));
    const foot = new THREE.Mesh(new THREE.BoxGeometry(p.limbR * 2.2, p.foot, p.height * 0.15), greyMaterial(0.35));
    foot.position.set(0, -p.foot / 2, p.height * 0.045);
    foot.userData.shade = 0.35;
    at(`ankle${side}`).add(foot);
  }

  applyPose(root, c, pose, joints);

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

/**
 * Sets joint rotations for a pose. Joints not named by the pose return to
 * rest. `joints` (degrees) replace the pose's angles for the joints they
 * name, e.g. a pose matched from a photo; the pose still sets the body's
 * height and lie. A standing body with its own leg angles (a crouch, a
 * kneel) is lowered or raised so its lowest foot or knee is on the floor.
 */
export function applyPose(root: THREE.Object3D, c: Pick<Character, 'heightCm' | 'sex' | 'build'>, pose: PoseId, joints?: JointAngles): void {
  const p = proportions(c);
  const def = POSE_DEFS[pose];
  const body = root.children[0];
  root.traverse((o) => {
    if ((o.name as Joint) in JOINT_SET) {
      const own = joints?.[o.name as Joint];
      const r = own ? own.map(deg) : (def.joints[o.name as Joint] ?? [0, 0, 0]);
      o.rotation.set(r[0], r[1], r[2]);
    }
  });
  const pelvis = root.getObjectByName('pelvis')!;
  pelvis.position.y = def.pelvisHeight ? def.pelvisHeight(p) : p.hipY;
  body.rotation.set(...(def.root?.rotation ?? [0, 0, 0]));
  body.position.set(0, def.root?.lift?.(p) ?? 0, 0);
  for (const side of ['L', 'R']) root.getObjectByName(`ankle${side}`)?.rotation.set(0, 0, 0);
  if (joints && !def.pelvisHeight && !def.root) settleOnFloor(root, pelvis, p);
}

/** How far a foot turns at the ankle to stay flat. */
const ANKLE_MAX = deg(60);

/**
 * Turns the feet flat to the body (as far as an ankle can), then moves the
 * pelvis up or down so the lowest ankle (over its foot) or knee touches the
 * floor.
 */
function settleOnFloor(root: THREE.Object3D, pelvis: THREE.Object3D, p: Proportions): void {
  root.updateMatrixWorld(true);
  const body = root.children[0];
  for (const side of ['L', 'R']) {
    const ankle = root.getObjectByName(`ankle${side}`)!;
    // The shin's turn relative to the body, undone at the ankle.
    const shin = body.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(ankle.parent!.getWorldQuaternion(new THREE.Quaternion()));
    const flat = shin.invert();
    const turn = 2 * Math.acos(Math.min(1, Math.abs(flat.w)));
    if (turn > ANKLE_MAX) flat.slerp(new THREE.Quaternion(), 1 - ANKLE_MAX / turn);
    ankle.quaternion.copy(flat);
  }
  root.updateMatrixWorld(true);
  const v = new THREE.Vector3();
  const height = (name: string) => root.worldToLocal(root.getObjectByName(name)!.getWorldPosition(v)).y;
  const gap = Math.min(height('ankleL') - p.foot, height('ankleR') - p.foot, height('kneeL') - p.limbR * 1.2, height('kneeR') - p.limbR * 1.2);
  pelvis.position.y -= gap;
}

const JOINT_SET = Object.fromEntries(JOINTS.map((j) => [j, true])) as Record<Joint, true>;

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

/**
 * A simple walk: legs and arms swing in opposition, the back knee bends.
 * `phase` runs 0..1 over one full cycle (two steps).
 */
export function applyWalkCycle(root: THREE.Object3D, c: Pick<Character, 'heightCm' | 'sex' | 'build'>, phase: number): void {
  applyPose(root, c, 'standing');
  const s = Math.sin(phase * Math.PI * 2);
  const set = (name: Joint, x: number) => {
    const j = root.getObjectByName(name);
    if (j) j.rotation.x = deg(x);
  };
  set('hipL', -26 * s);
  set('hipR', 26 * s);
  set('kneeL', 32 * Math.max(0, s) + 6);
  set('kneeR', 32 * Math.max(0, -s) + 6);
  set('shoulderL', 20 * s);
  set('shoulderR', -20 * s);
  set('elbowL', -12);
  set('elbowR', -12);
  // A little bob: the body is lowest mid-stride.
  const pelvis = root.getObjectByName('pelvis');
  if (pelvis) pelvis.position.y -= Math.abs(s) * 0.012 * (c.heightCm / 100);
}
