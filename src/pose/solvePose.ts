import * as THREE from 'three';
import type { Joint, JointAngles } from '../state/schema';
import { POSE_DEFS, proportions } from '../three/mannequin';
import { LM, MIN_VISIBILITY, type DetectedPerson, type LandmarkName } from './landmarks';

/** The preset a matched pose is built on: seating, platforms and framing read it. */
export type MatchedPreset = 'standing' | 'sitting' | 'lying';

export interface PoseMatch {
  pose: MatchedPreset;
  /** Angles for the joints the photo shows (degrees); the rest keep the preset's. */
  joints: JointAngles;
  /**
   * The body's yaw (degrees) seen from the photo's camera, as if the camera
   * sat on +Z looking toward -Z: 0 faces the camera, 90 faces the camera's
   * right… (+X), 180 faces away.
   */
  facing: number;
}

export interface PoseSolveOptions {
  /** How far the photo's camera looks down (degrees, + down). Taken as level when unknown. */
  cameraTilt?: number;
  /** The photo camera's roll (degrees), as `CameraState.roll`. */
  cameraRoll?: number;
}

type V = THREE.Vector3;
const v = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const RAD = THREE.MathUtils.radToDeg;
const UP = v(0, 1, 0);
const DOWN = v(0, -1, 0);

/** Below this bend (degrees), an elbow or knee counts as straight and gives no twist. */
const STRAIGHT = 8;
/** Elbows and knees bend one way only, and only so far. */
const ELBOW_MAX = 150;
const KNEE_MAX = 160;
/**
 * Torso this far from upright reads as lying down. Sitting: thighs this far
 * from hanging, knees bent, and shins near hanging (a crouch has level
 * thighs too, but its shins slope).
 */
const LYING = 55;
const SITTING_THIGH = 55;
const SITTING_KNEE = 50;
const SITTING_SHIN = 35;

/** Where the head pivots, in the figure's own proportions (all are fractions of height, so any height will do). */
const NECK = (() => {
  const p = proportions({ heightCm: 170, sex: 'other', build: 'average' });
  const torsoLen = p.torso * 0.88;
  // Mid-shoulders to the neck pivot, and the pivot to the head's centre, along the spine.
  return { lift: torsoLen * 0.07, length: p.neck + p.headR * 0.95 };
})();

/** A rotation as a matrix whose columns are the given axes. */
const basis = (x: V, y: V, z: V) => new THREE.Matrix4().makeBasis(x, y, z);
const apply = (m: THREE.Matrix4, d: V) => d.clone().transformDirection(m);
const relative = (parent: THREE.Matrix4, child: THREE.Matrix4) => parent.clone().transpose().multiply(child);
const toDegrees = (m: THREE.Matrix4): [number, number, number] => {
  const e = new THREE.Euler().setFromRotationMatrix(m, 'XYZ');
  return [RAD(e.x), RAD(e.y), RAD(e.z)];
};
/** A rotation from XYZ Euler angles in radians. */
const fromEuler = ([x, y, z]: readonly number[] = [0, 0, 0]) => new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(x, y, z, 'XYZ'));
const fromDegrees = (r: [number, number, number]) => fromEuler(r.map(THREE.MathUtils.degToRad));
/** The part of `a` square to the unit vector `n`. */
const square = (a: V, n: V) => a.clone().addScaledVector(n, -a.dot(n));
const angle = (a: V, b: V) => RAD(a.angleTo(b));

/**
 * Turns a person found in a photo into joint angles for the mannequin. Only
 * bone directions are used, so the person's size doesn't matter. Joints the
 * photo doesn't show keep the preset's angles. A forward bend of the torso
 * goes to the pelvis; the spine takes the turn of the shoulders against the
 * hips.
 *
 * Returns null when the shoulders and hips can't all be seen.
 */
export function solvePose(person: DetectedPerson, opts: PoseSolveOptions = {}): PoseMatch | null {
  // MediaPipe's camera axes (x right, y down, z away) to a level world (y up), camera looking toward -Z.
  const cam = new THREE.Matrix4()
    .makeRotationX(-THREE.MathUtils.degToRad(opts.cameraTilt ?? 0))
    .multiply(new THREE.Matrix4().makeRotationZ(THREE.MathUtils.degToRad(opts.cameraRoll ?? 0)));
  const seen = (n: LandmarkName) => (person.image[LM[n]]?.visibility ?? 0) >= MIN_VISIBILITY && !!person.world[LM[n]];
  const at = (n: LandmarkName): V => {
    const [x, y, z] = person.world[LM[n]];
    return v(x, -y, -z).applyMatrix4(cam);
  };
  if (!(['shoulderL', 'shoulderR', 'hipL', 'hipR'] as const).every(seen)) return null;

  const midHip = at('hipL').add(at('hipR')).multiplyScalar(0.5);
  const midShoulder = at('shoulderL').add(at('shoulderR')).multiplyScalar(0.5);
  const torsoUp = midShoulder.clone().sub(midHip).normalize();

  // Pelvis: across the hips (the body's left is +X), up the torso, forward = X × Y.
  const px = square(at('hipL').sub(at('hipR')), torsoUp).normalize();
  const pelvisWorld = basis(px, torsoUp, px.clone().cross(torsoUp));

  const legs = (['L', 'R'] as const).filter((s) => seen(`hip${s}`) && seen(`knee${s}`) && seen(`ankle${s}`));
  const sits = (s: 'L' | 'R') => {
    const thigh = at(`knee${s}`).sub(at(`hip${s}`)), shin = at(`ankle${s}`).sub(at(`knee${s}`));
    return angle(thigh, DOWN) > SITTING_THIGH && angle(thigh, shin) > SITTING_KNEE && angle(shin, DOWN) < SITTING_SHIN;
  };
  const pose: MatchedPreset =
    angle(torsoUp, UP) > LYING
      ? 'lying'
      : legs.length > 0 && legs.every(sits)
        ? 'sitting'
        : 'standing';

  // The yaw that leaves the pelvis least to do, given the preset's lie (lying turns the body onto its back).
  const lie = fromEuler(POSE_DEFS[pose].root?.rotation);
  const m = pelvisWorld.clone().multiply(lie.clone().transpose()).elements; // column-major
  const yaw = Math.atan2(m[8] - m[2], m[0] + m[10]);
  const rootWorld = new THREE.Matrix4().makeRotationY(yaw).multiply(lie);

  const joints: JointAngles = {};
  const set = (j: Joint, parent: THREE.Matrix4, world: THREE.Matrix4) => {
    const r = toDegrees(relative(parent, world));
    joints[j] = r;
    return parent.clone().multiply(fromDegrees(r));
  };
  const pelvis = set('pelvis', rootWorld, pelvisWorld);

  // Spine: the shoulder line's turn against the hips, about the torso.
  const sx = square(at('shoulderL').sub(at('shoulderR')), torsoUp).normalize();
  const spine = set('spine', pelvis, basis(sx, torsoUp, sx.clone().cross(torsoUp)));

  // Neck: from where the head pivots to its centre (between the ears), facing the nose.
  const ears = (['earL', 'earR'] as const).filter(seen);
  if (ears.length === 2 && seen('nose')) {
    const head = at('earL').add(at('earR')).multiplyScalar(0.5);
    const d = head.clone().sub(midShoulder).normalize();
    // Head = shoulders + lift·up + length·u, with u a unit vector along d once the lift is taken off.
    const spineUp = apply(spine, UP);
    const lift = spineUp.clone().multiplyScalar(NECK.lift);
    const dl = d.dot(lift);
    const t = dl + Math.sqrt(Math.max(0, dl * dl - lift.lengthSq() + NECK.length ** 2));
    const ny = d.clone().multiplyScalar(t).sub(lift).normalize();
    const nz = square(at('nose').sub(head), ny);
    if (nz.lengthSq() > 1e-8) {
      nz.normalize();
      set('neck', spine, basis(ny.clone().cross(nz), ny, nz));
    }
  }

  // Limbs hang along -Y from their joint. Elbows bend the forearm toward the joint's +Z, knees the shin toward -Z.
  const limb = (upper: Joint, lower: Joint, parent: THREE.Matrix4, a: LandmarkName, b: LandmarkName, c: LandmarkName, bendsBack: boolean, max: number) => {
    if (!seen(a) || !seen(b)) return;
    const d1 = at(b).sub(at(a)).normalize();
    const d2 = seen(c) ? at(c).sub(at(b)).normalize() : undefined;
    const bend = d2 ? Math.min(max, angle(d1, d2)) : 0;
    const across = d2 ? square(d2, d1) : v();
    let world: THREE.Matrix4;
    if (d2 && bend >= STRAIGHT && across.lengthSq() > 1e-8) {
      const y = d1.clone().negate();
      const z = across.normalize().multiplyScalar(bendsBack ? -1 : 1);
      world = basis(y.clone().cross(z), y, z);
    } else {
      // Straight (or the far end unseen): the smallest swing from hanging, no twist.
      const q = new THREE.Quaternion().setFromUnitVectors(apply(parent, DOWN), d1);
      world = new THREE.Matrix4().makeRotationFromQuaternion(q).multiply(parent);
    }
    set(upper, parent, world);
    if (d2) joints[lower] = [bend < STRAIGHT ? 0 : bendsBack ? bend : -bend, 0, 0];
  };
  limb('shoulderL', 'elbowL', spine, 'shoulderL', 'elbowL', 'wristL', false, ELBOW_MAX);
  limb('shoulderR', 'elbowR', spine, 'shoulderR', 'elbowR', 'wristR', false, ELBOW_MAX);
  limb('hipL', 'kneeL', pelvis, 'hipL', 'kneeL', 'ankleL', true, KNEE_MAX);
  limb('hipR', 'kneeR', pelvis, 'hipR', 'kneeR', 'ankleR', true, KNEE_MAX);

  return { pose, joints, facing: RAD(yaw) };
}
