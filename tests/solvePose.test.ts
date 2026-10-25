import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { Build, JointAngles, PoseId, Sex } from '../src/state/schema';
import { bodyPoints, type BodyPoint } from '../src/pose/skeleton';
import { LANDMARK_COUNT, LM, type DetectedPerson, type LandmarkName, type Vec3 } from '../src/pose/landmarks';
import { solvePose } from '../src/pose/solvePose';
import { buildMannequin } from '../src/three/mannequin';
import { applyCamera } from '../src/three/camera';

const body = { heightCm: 172, sex: 'female' as Sex, build: 'average' as Build };
const ORIGIN: Vec3 = [0, 0, 0];
const POINT_OF: Record<LandmarkName, BodyPoint> = {
  nose: 'noseTip', earL: 'earL', earR: 'earR',
  shoulderL: 'shoulderL', shoulderR: 'shoulderR', elbowL: 'elbowL', elbowR: 'elbowR', wristL: 'wristL', wristR: 'wristR',
  hipL: 'hipL', hipR: 'hipR', kneeL: 'kneeL', kneeR: 'kneeR', ankleL: 'ankleL', ankleR: 'ankleR',
};

interface Pose { pose: PoseId; joints: JointAngles; yaw: number }
interface Camera { tilt?: number; roll?: number; scale?: number; noise?: number; hidden?: LandmarkName[] }

/** What MediaPipe would report for the mannequin in this pose, seen by a camera on +Z looking toward -Z. */
function detect(k: Pose, cam: Camera = {}): DetectedPerson {
  const pts = bodyPoints(body, k, ORIGIN);
  const mid = new THREE.Vector3(...pts.hipL).add(new THREE.Vector3(...pts.hipR)).multiplyScalar(0.5);
  const toCam = new THREE.Matrix4()
    .makeRotationX(-THREE.MathUtils.degToRad(cam.tilt ?? 0))
    .multiply(new THREE.Matrix4().makeRotationZ(THREE.MathUtils.degToRad(cam.roll ?? 0)))
    .invert();
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 2;
  const world: Vec3[] = Array.from({ length: LANDMARK_COUNT }, () => [0, 0, 0]);
  const image = Array.from({ length: LANDMARK_COUNT }, () => ({ x: 0, y: 0, visibility: 0 }));
  for (const [name, point] of Object.entries(POINT_OF) as [LandmarkName, BodyPoint][]) {
    const p = new THREE.Vector3(...pts[point]).sub(mid).applyMatrix4(toCam).multiplyScalar(cam.scale ?? 1);
    const n = cam.noise ?? 0;
    world[LM[name]] = [p.x + n * rand(), -p.y + n * rand(), -p.z + n * rand()];
    image[LM[name]].visibility = cam.hidden?.includes(name) ? 0.1 : 0.99;
  }
  return { image, world };
}

/** Every point of the re-posed body against the original, with both centred between the hips (m). */
function worstMiss(a: Pose, b: Pose, only?: BodyPoint[]): number {
  const pa = bodyPoints(body, a, ORIGIN), pb = bodyPoints(body, b, ORIGIN);
  const mid = (p: typeof pa) => new THREE.Vector3(...p.hipL).add(new THREE.Vector3(...p.hipR)).multiplyScalar(0.5);
  const ma = mid(pa), mb = mid(pb);
  let worst = 0;
  for (const k of only ?? (Object.keys(pa) as BodyPoint[])) {
    const da = new THREE.Vector3(...pa[k]).sub(ma), db = new THREE.Vector3(...pb[k]).sub(mb);
    worst = Math.max(worst, da.distanceTo(db));
  }
  return worst;
}

function roundTrip(k: Pose, cam: Camera = {}) {
  const m = solvePose(detect(k, cam), { cameraTilt: cam.tilt, cameraRoll: cam.roll })!;
  expect(m).not.toBeNull();
  return { m, back: { pose: m.pose, joints: m.joints, yaw: m.facing } };
}

const yawDiff = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);

/** Every joint set, so nothing comes from a preset. Elbows and knees bent enough to fix the limb's twist. */
const REACH: JointAngles = {
  pelvis: [12, 0, 4], spine: [0, 25, 0], neck: [20, -30, 5],
  shoulderL: [-70, 20, 30], elbowL: [-60, 0, 0], shoulderR: [-150, 0, -10], elbowR: [-30, 0, 0],
  hipL: [-30, 10, 8], kneeL: [40, 0, 0], hipR: [10, -5, -6], kneeR: [20, 0, 0],
};
const CROUCH: JointAngles = {
  pelvis: [35, 0, 0], spine: [0, -10, 0], neck: [-20, 0, 0],
  shoulderL: [-40, 0, 15], elbowL: [-90, 0, 0], shoulderR: [-40, 0, -15], elbowR: [-90, 0, 0],
  hipL: [-120, 0, 10], kneeL: [130, 0, 0], hipR: [-110, 0, -10], kneeR: [120, 0, 0],
};

describe('solvePose', () => {
  it('recovers a pose seen from the front, turned and from behind', () => {
    for (const yaw of [0, 70, -120, 180]) {
      const k = { pose: 'standing' as const, joints: REACH, yaw };
      const { m, back } = roundTrip(k);
      expect(m.pose, `yaw ${yaw}`).toBe('standing');
      expect(yawDiff(m.facing, yaw), `yaw ${yaw}`).toBeLessThan(1);
      expect(worstMiss(k, back), `yaw ${yaw}`).toBeLessThan(0.005);
    }
  });

  it('allows for a camera that looks down and rolls', () => {
    const k = { pose: 'standing' as const, joints: REACH, yaw: 30 };
    const { m, back } = roundTrip(k, { tilt: 25, roll: 6 });
    expect(yawDiff(m.facing, 30)).toBeLessThan(1);
    expect(worstMiss(k, back)).toBeLessThan(0.005);
  });

  it('ignores the size of the person in the photo', () => {
    const k = { pose: 'standing' as const, joints: REACH, yaw: 40 };
    expect(worstMiss(k, roundTrip(k, { scale: 1.2 }).back)).toBeLessThan(0.005);
    expect(worstMiss(k, roundTrip(k, { scale: 0.6 }).back)).toBeLessThan(0.005);
  });

  it('copes with detector noise', () => {
    const k = { pose: 'standing' as const, joints: REACH, yaw: -20 };
    expect(worstMiss(k, roundTrip(k, { noise: 0.01 }).back)).toBeLessThan(0.08);
  });

  it('reads a crouch as standing and keeps it on the floor', () => {
    const k = { pose: 'standing' as const, joints: CROUCH, yaw: 0 };
    const { m, back } = roundTrip(k);
    expect(m.pose).toBe('standing');
    expect(worstMiss(k, back)).toBeLessThan(0.005);
    const b = new THREE.Box3().setFromObject(buildMannequin(body, m.pose, m.joints));
    expect(Math.abs(b.min.y)).toBeLessThan(0.03);
    expect(b.max.y).toBeLessThan(1.4);
  });

  it('reads sitting and lying', () => {
    const sit = { pose: 'standing' as const, joints: { hipL: [-90, 0, 3], kneeL: [90, 0, 0], hipR: [-90, 0, -3], kneeR: [90, 0, 0], shoulderL: [-10, 0, 6], shoulderR: [-10, 0, -6], elbowL: [-55, 0, 0], elbowR: [-55, 0, 0] } as JointAngles, yaw: 20 };
    const s = roundTrip(sit);
    expect(s.m.pose).toBe('sitting');
    expect(worstMiss(sit, s.back)).toBeLessThan(0.005);

    const lie = { pose: 'lying' as const, joints: { shoulderL: [0, 0, 40], shoulderR: [0, 0, -40], elbowL: [-30, 0, 0], elbowR: [-30, 0, 0], kneeL: [20, 0, 0], kneeR: [20, 0, 0] } as JointAngles, yaw: 90 };
    const l = roundTrip(lie, { tilt: 30 });
    expect(l.m.pose).toBe('lying');
    expect(yawDiff(l.m.facing, 90)).toBeLessThan(1);
    expect(worstMiss(lie, l.back)).toBeLessThan(0.005);
  });

  it('leaves joints the photo does not show to the preset', () => {
    const k = { pose: 'standing' as const, joints: REACH, yaw: 0 };
    const m = solvePose(detect(k, { hidden: ['kneeL', 'kneeR', 'ankleL', 'ankleR', 'wristR'] }))!;
    expect(m.joints).not.toHaveProperty('hipL');
    expect(m.joints).not.toHaveProperty('kneeL');
    expect(m.joints).not.toHaveProperty('elbowR');
    // The upper arm still points where it did.
    expect(m.joints).toHaveProperty('shoulderR');
    const back = { pose: m.pose, joints: m.joints, yaw: m.facing };
    expect(worstMiss(k, back, ['elbowR', 'elbowL', 'wristL', 'head'])).toBeLessThan(0.005);
  });

  it("matches the shot camera's tilt and roll, and facing is the body's turn from the camera's arc", () => {
    const k = { pose: 'standing' as const, joints: REACH, yaw: 50 };
    const camera = new THREE.PerspectiveCamera();
    applyCamera(camera, { target: [0, 1, 0], azimuth: 20, elevation: 25, distance: 4, lens: 35, roll: 4 }, 1.5);
    camera.updateMatrixWorld(true);
    const pts = bodyPoints(body, k, ORIGIN);
    const mid = new THREE.Vector3(...pts.hipL).add(new THREE.Vector3(...pts.hipR)).multiplyScalar(0.5).applyMatrix4(camera.matrixWorldInverse);
    const world: Vec3[] = Array.from({ length: LANDMARK_COUNT }, () => [0, 0, 0]);
    const image = Array.from({ length: LANDMARK_COUNT }, () => ({ x: 0, y: 0, visibility: 0 }));
    for (const [name, point] of Object.entries(POINT_OF) as [LandmarkName, BodyPoint][]) {
      const c = new THREE.Vector3(...pts[point]).applyMatrix4(camera.matrixWorldInverse).sub(mid);
      world[LM[name]] = [c.x, -c.y, -c.z];
      image[LM[name]].visibility = 0.99;
    }
    // Looking down at the target from 25° up: the camera is tilted 25° down.
    const m = solvePose({ image, world }, { cameraTilt: 25, cameraRoll: 4 })!;
    expect(yawDiff(m.facing, 50 - 20)).toBeLessThan(1);
    expect(worstMiss(k, { pose: m.pose, joints: m.joints, yaw: 50 })).toBeLessThan(0.005);
  });

  it('gives up without both shoulders and hips', () => {
    const k = { pose: 'standing' as const, joints: REACH, yaw: 0 };
    expect(solvePose(detect(k, { hidden: ['hipL'] }))).toBeNull();
  });

  it('reads left and right as MediaPipe reports them', () => {
    // Facing the camera, the person's left side is on the right of the photo (+x), and their raised left hand is up (−y).
    const world: Vec3[] = Array.from({ length: LANDMARK_COUNT }, () => [0, 0, 0]);
    const put = (n: LandmarkName, p: Vec3) => (world[LM[n]] = p);
    put('hipL', [0.1, 0, 0]); put('hipR', [-0.1, 0, 0]);
    put('shoulderL', [0.18, -0.5, 0]); put('shoulderR', [-0.18, -0.5, 0]);
    put('elbowL', [0.25, -0.8, 0]); put('wristL', [0.25, -1.05, 0]);
    put('elbowR', [-0.2, -0.22, 0]); put('wristR', [-0.2, 0.02, 0]);
    const image = Array.from({ length: LANDMARK_COUNT }, (_, i) => ({ x: 0, y: 0, visibility: i >= 11 && i <= 16 || i === 23 || i === 24 ? 0.99 : 0 }));
    const m = solvePose({ image, world })!;
    expect(yawDiff(m.facing, 0)).toBeLessThan(1);
    const pts = bodyPoints(body, { pose: m.pose, joints: m.joints, yaw: 0 }, ORIGIN);
    expect(pts.wristL[1]).toBeGreaterThan(pts.head[1]);
    expect(pts.wristL[0]).toBeGreaterThan(0);
    expect(pts.wristR[1]).toBeLessThan(pts.pelvis[1] + 0.1);
  });
});
