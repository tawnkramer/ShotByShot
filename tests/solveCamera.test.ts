import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { ActorKey, Build, CameraState, JointAngles, Sex } from '../src/state/schema';
import { applyCamera, cameraPosition, lensToVFov } from '../src/three/camera';
import { bodyPoints, type BodyPoint } from '../src/pose/skeleton';
import { LANDMARK_COUNT, LM, type DetectedPerson, type LandmarkName, type Vec3 } from '../src/pose/landmarks';
import { cropToAspect, fitCamera, LANDMARK_POINT, matchPhoto, pointsInCrop, shotLensFromPhoto } from '../src/pose/solveCamera';
import { leastSquares } from '../src/pose/lm';
import { uprightCamera } from '../src/pose/solvePose';
import { lens35FromJpeg } from '../src/pose/exif';

const body = { heightCm: 178, sex: 'male' as Sex, build: 'average' as Build };
const BASE: Vec3 = [1, 0, -0.5];
const REACH: JointAngles = {
  pelvis: [8, 0, 3], spine: [0, 20, 0], neck: [15, -25, 0],
  shoulderL: [-70, 20, 30], elbowL: [-60, 0, 0], shoulderR: [-150, 0, -10], elbowR: [-30, 0, 0],
  hipL: [-30, 10, 8], kneeL: [40, 0, 0], hipR: [10, -5, -6], kneeR: [20, 0, 0],
};
const KEY: ActorKey = { position: BASE, yaw: 30, pose: 'standing', joints: REACH };
/** Standing straight (feet under the shoulders), turned at the waist, arms and head posed. */
const UPRIGHT: ActorKey = { ...KEY, joints: { ...REACH, pelvis: [0, 0, 0], hipL: [0, 0, 6], kneeL: [0, 0, 0], hipR: [0, 0, -6], kneeR: [0, 0, 0] } };

/** The 35 mm-equivalent lens of a photo taken with a shot lens on a frame of this aspect. */
const lens35Of = (lens: number, aspect: number) => ((Math.hypot(36, 24) * aspect) / Math.hypot(aspect, 1)) / 2 / (18 / lens);

/** What MediaPipe would report for a photo of `key` taken with `cam` on a frame of `aspect`. */
function photograph(key: ActorKey, cam: CameraState, aspect: number, opts: { hide?: (p: THREE.Vector3, name: LandmarkName) => boolean } = {}): DetectedPerson {
  const camera = new THREE.PerspectiveCamera();
  applyCamera(camera, cam, aspect);
  camera.updateMatrixWorld(true);
  const pts = bodyPoints(body, key, BASE);
  const mid = new THREE.Vector3(...pts.hipL).add(new THREE.Vector3(...pts.hipR)).multiplyScalar(0.5).applyMatrix4(camera.matrixWorldInverse);
  const world: Vec3[] = Array.from({ length: LANDMARK_COUNT }, () => [0, 0, 0]);
  const image = Array.from({ length: LANDMARK_COUNT }, () => ({ x: 0, y: 0, visibility: 0 }));
  for (const [name, point] of Object.entries(LANDMARK_POINT) as [LandmarkName, BodyPoint][]) {
    const w = new THREE.Vector3(...pts[point]);
    const c = w.clone().applyMatrix4(camera.matrixWorldInverse);
    world[LM[name]] = [c.x - mid.x, -(c.y - mid.y), -(c.z - mid.z)];
    const ndc = w.clone().project(camera);
    image[LM[name]] = { x: (ndc.x + 1) / 2, y: (1 - ndc.y) / 2, visibility: opts.hide?.(w, name) ? 0.05 : 0.98 };
  }
  return { image, world };
}

const request = (person: DetectedPerson, photoAspect: number, extra: Partial<Parameters<typeof matchPhoto>[0]> = {}) => ({
  person,
  photo: { width: 1000 * photoAspect, height: 1000 },
  character: body,
  key: { position: BASE, yaw: 30, pose: 'standing' as const },
  base: () => BASE,
  aspect: 16 / 9,
  matchPose: true,
  matchCamera: true,
  ...extra,
});

/** How far apart two cameras stand (m) and how far apart they look (degrees). */
function cameraGap(a: CameraState, b: CameraState) {
  const look = (s: CameraState) => new THREE.Vector3(...s.target).sub(cameraPosition(s)).normalize();
  return { place: cameraPosition(a).distanceTo(cameraPosition(b)), aim: THREE.MathUtils.radToDeg(look(a).angleTo(look(b))) };
}

describe('least squares', () => {
  it('fits a curve', () => {
    const xs = [0, 1, 2, 3, 4, 5];
    const ys = xs.map((x) => 2.5 * Math.exp(-0.4 * x) + 0.7);
    const { params } = leastSquares((p) => xs.map((x, i) => p[0] * Math.exp(-p[1] * x) + p[2] - ys[i]), [1, 1, 0], [1e-6, 1e-6, 1e-6]);
    expect(params[0]).toBeCloseTo(2.5, 4);
    expect(params[1]).toBeCloseTo(0.4, 4);
    expect(params[2]).toBeCloseTo(0.7, 4);
  });
});

describe('photo lens', () => {
  /** A JPEG header with an EXIF block holding FocalLengthIn35mmFilm. */
  function jpeg(lens: number, little: boolean): Uint8Array {
    const t: number[] = [];
    const u16 = (n: number) => (little ? t.push(n & 255, n >> 8) : t.push(n >> 8, n & 255));
    const u32 = (n: number) => (little ? t.push(n & 255, (n >> 8) & 255, (n >> 16) & 255, n >>> 24) : t.push(n >>> 24, (n >> 16) & 255, (n >> 8) & 255, n & 255));
    t.push(...(little ? [0x49, 0x49] : [0x4d, 0x4d])); u16(42); u32(8);
    // IFD0 at 8: one entry, the Exif IFD pointer.
    u16(1); u16(0x8769); u16(4); u32(1); u32(26); u32(0);
    // Exif IFD at 26: an unrelated tag, then the 35 mm lens.
    u16(2); u16(0x829a); u16(5); u32(1); u32(0); u16(0xa405); u16(3); u32(1); u16(lens); u16(0); u32(0);
    const app1 = [...'Exif\0\0'].map((c) => c.charCodeAt(0)).concat(t);
    const len = app1.length + 2;
    return new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xe1, len >> 8, len & 255, ...app1, 0xff, 0xda, 0, 2]);
  }

  it('reads the 35 mm lens from EXIF, either byte order', () => {
    expect(lens35FromJpeg(jpeg(26, true))).toBe(26);
    expect(lens35FromJpeg(jpeg(77, false))).toBe(77);
    expect(lens35FromJpeg(new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0, 2]))).toBeUndefined();
    expect(lens35FromJpeg(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBeUndefined();
  });

  it('turns a photo lens into the same view in the shot', () => {
    // A 3:2 photo is the full frame: same lens.
    expect(shotLensFromPhoto(50, 1.5, 1)).toBeCloseTo(50, 6);
    // Cropping half its width doubles the lens.
    expect(shotLensFromPhoto(50, 1.5, 0.5)).toBeCloseTo(100, 6);
    expect(shotLensFromPhoto(lens35Of(40, 4 / 3), 4 / 3, 1)).toBeCloseTo(40, 6);
  });

  it('crops to the shot aspect around the person', () => {
    expect(cropToAspect(4000, 3000, 16 / 9)).toEqual({ x: 0, y: expect.closeTo(0.125, 6), w: 1, h: expect.closeTo(0.75, 6) });
    const tall = cropToAspect(3000, 4000, 16 / 9, [0.5, 0.1]);
    expect(tall.y).toBe(0);
    expect(tall.h).toBeCloseTo(0.75 / (16 / 9), 6);
    const wide = cropToAspect(2100, 900, 16 / 9, [0.9, 0.5]);
    expect(wide.x + wide.w).toBeCloseTo(1, 6);
  });
});

describe('camera fit', () => {
  const SHOTS: [string, CameraState][] = [
    ['wide', { target: [1, 1, -0.5], azimuth: 20, elevation: 8, distance: 7, lens: 28, roll: 0 }],
    ['medium', { target: [1.1, 1.3, -0.4], azimuth: 45, elevation: 3, distance: 3, lens: 50, roll: 0 }],
    ['low angle', { target: [1, 1.2, -0.5], azimuth: -10, elevation: -25, distance: 3.5, lens: 35, roll: 0 }],
    ['high angle', { target: [0.8, 0.9, -0.6], azimuth: 70, elevation: 40, distance: 4, lens: 35, roll: 0 }],
    ['rolled', { target: [1, 1.1, -0.5], azimuth: 15, elevation: 10, distance: 4, lens: 40, roll: 8 }],
    ['from behind', { target: [1, 1.1, -0.5], azimuth: 200, elevation: 12, distance: 4, lens: 35, roll: 0 }],
  ];

  it('finds the camera when the pose and lens are known', () => {
    const aspect = 16 / 9;
    const pts = bodyPoints(body, KEY, BASE);
    for (const [name, truth] of SHOTS) {
      const seen = pointsInCrop(photograph(KEY, truth, aspect), { x: 0, y: 0, w: 1, h: 1 });
      const start = { ...truth, azimuth: truth.azimuth + 20, elevation: 0, distance: truth.distance * 1.4, roll: 0 };
      const fit = fitCamera(pts, seen, aspect, start, { fixed: truth.lens, guess: truth.lens });
      const gap = cameraGap(fit.camera, truth);
      expect(fit.error, name).toBeLessThan(1e-4);
      expect(gap.place, name).toBeLessThan(0.02);
      expect(gap.aim, name).toBeLessThan(0.2);
      expect(fit.camera.roll, name).toBeCloseTo(truth.roll, 1);
    }
  });

  it('matches pose and camera together from a photo', () => {
    const truth: CameraState = { target: [1.1, 1.2, -0.4], azimuth: 50, elevation: 15, distance: 3.2, lens: 40, roll: 3 };
    const photo = photograph(UPRIGHT, truth, 16 / 9);
    const r = matchPhoto(request(photo, 16 / 9, { photo: { width: 1600, height: 900, lens35: lens35Of(40, 16 / 9) } }))!;
    expect(r.warnings).toEqual([]);
    expect(r.error!).toBeLessThan(0.002);
    const gap = cameraGap(r.camera!, truth);
    expect(gap.place).toBeLessThan(0.05);
    expect(gap.aim).toBeLessThan(1);
    expect(r.camera!.lens).toBeCloseTo(40, 3);
    // The character keeps its place and turn, and takes the pose.
    expect(r.key.position).toEqual(BASE);
    expect(r.key.yaw).toBe(30);
    expect(r.key.joints).toBeDefined();
  });

  it('crops a photo of another shape to the shot', () => {
    const truth: CameraState = { target: [1, 1.1, -0.5], azimuth: 25, elevation: 6, distance: 5, lens: 35, roll: 0 };
    // A 4:3 photo matched to a 16:9 shot: the shot keeps its full width, so the same lens.
    const r = matchPhoto(request(photograph(UPRIGHT, truth, 4 / 3), 4 / 3, { photo: { width: 4000, height: 3000, lens35: lens35Of(35, 4 / 3) } }))!;
    expect(r.crop.w).toBe(1);
    expect(r.camera!.lens).toBeCloseTo(35, 3);
    expect(r.error!).toBeLessThan(0.01);
    // Same place. The crop is centred on the person, not the photo, so the aim moves by the crop's offset.
    const gap = cameraGap(r.camera!, truth);
    expect(gap.place).toBeLessThan(0.1);
    const offset = THREE.MathUtils.radToDeg(Math.atan(Math.abs(r.crop.y + r.crop.h / 2 - 0.5) * 2 * Math.tan(THREE.MathUtils.degToRad(lensToVFov(35, 4 / 3)) / 2)));
    expect(Math.abs(gap.aim - offset)).toBeLessThan(1);
  });

  it('fits an unknown lens from where the body points fall', () => {
    const truth: CameraState = { target: [1.1, 1.0, -0.4], azimuth: 35, elevation: 10, distance: 3, lens: 32, roll: 0 };
    const r = matchPhoto(request(photograph(UPRIGHT, truth, 16 / 9), 16 / 9))!;
    expect(r.error!).toBeLessThan(0.005);
    expect(Math.abs(r.camera!.lens - 32)).toBeLessThan(6);
    expect(cameraGap(r.camera!, truth).aim).toBeLessThan(3);
  });

  it('uses the lens slider over the photo', () => {
    const truth: CameraState = { target: [1, 1.2, -0.5], azimuth: 10, elevation: 5, distance: 4, lens: 35, roll: 0 };
    const r = matchPhoto(request(photograph(UPRIGHT, truth, 16 / 9), 16 / 9, { lens: 70 }))!;
    expect(r.camera!.lens).toBeCloseTo(70, 6);
    // Twice the lens: about twice as far back to frame the body the same.
    expect(cameraPosition(r.camera!).distanceTo(new THREE.Vector3(...truth.target))).toBeGreaterThan(6);
  });

  it('places the camera from a person cut off at the waist', () => {
    const truth: CameraState = { target: [1.05, 1.45, -0.45], azimuth: 30, elevation: 0, distance: 1.6, lens: 50, roll: 0 };
    const photo = photograph(UPRIGHT, truth, 16 / 9, { hide: (p) => p.y < 0.8 });
    const r = matchPhoto(request(photo, 16 / 9, { photo: { width: 1600, height: 900, lens35: lens35Of(50, 16 / 9) } }))!;
    expect(r.camera).toBeDefined();
    expect(r.key.joints).not.toHaveProperty('kneeL');
    const gap = cameraGap(r.camera!, truth);
    expect(gap.place).toBeLessThan(0.1);
    expect(gap.aim).toBeLessThan(2);
  });

  it('keeps the camera when only the pose is matched, and warns when too little shows', () => {
    const truth: CameraState = { target: [1, 1.1, -0.5], azimuth: 0, elevation: 10, distance: 4, lens: 35, roll: 0 };
    const photo = photograph(UPRIGHT, truth, 16 / 9);
    const poseOnly = matchPhoto(request(photo, 16 / 9, { matchCamera: false }))!;
    expect(poseOnly.camera).toBeUndefined();
    expect(poseOnly.key.joints).toBeDefined();

    const cameraOnly = matchPhoto(request(photo, 16 / 9, { matchPose: false }))!;
    expect(cameraOnly.key).not.toHaveProperty('joints');
    expect(cameraOnly.camera).toBeDefined();

    const shoulders = photograph(UPRIGHT, truth, 16 / 9, { hide: (_, name) => !['shoulderL', 'shoulderR', 'hipL', 'hipR', 'nose'].includes(name) });
    const thin = matchPhoto(request(shoulders, 16 / 9))!;
    expect(thin.camera).toBeUndefined();
    expect(thin.warnings[0]).toMatch(/too little/i);
  });

  it('a leaning body tips the camera instead, by about as much as the lean', () => {
    const truth: CameraState = { target: [1.1, 1.2, -0.4], azimuth: 50, elevation: 15, distance: 3.2, lens: 40, roll: 0 };
    const r = matchPhoto(request(photograph(KEY, truth, 16 / 9), 16 / 9, { photo: { width: 1600, height: 900, lens35: lens35Of(40, 16 / 9) } }))!;
    // Still lines up in the frame.
    expect(r.error!).toBeLessThan(0.01);
    expect(cameraGap(r.camera!, truth).aim).toBeLessThan(15);
  });
});

describe('which way is up', () => {
  it('reads the camera tilt and roll from a standing body', () => {
    const p = photograph(UPRIGHT, { target: [1, 1, -0.5], azimuth: 40, elevation: 25, distance: 4, lens: 35, roll: 5 }, 16 / 9);
    const up = uprightCamera(p);
    expect(up.cameraTilt).toBeCloseTo(25, 0);
    expect(up.cameraRoll).toBeCloseTo(5, 0);
    const low = uprightCamera(photograph(UPRIGHT, { target: [1, 1.4, -0.5], azimuth: -30, elevation: -20, distance: 3, lens: 35, roll: 0 }, 16 / 9));
    expect(low.cameraTilt).toBeCloseTo(-20, 0);
  });

  it('reads someone lying down as chest up', () => {
    const lying: ActorKey = { position: BASE, yaw: 0, pose: 'lying', joints: { shoulderL: [0, 0, 30], shoulderR: [0, 0, -30] } };
    const up = uprightCamera(photograph(lying, { target: [1, 0.2, -1], azimuth: 90, elevation: 35, distance: 4, lens: 35, roll: 0 }, 16 / 9));
    expect(up.cameraTilt).toBeCloseTo(35, 0);
  });
});
