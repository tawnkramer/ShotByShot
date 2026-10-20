import * as THREE from 'three';
import type { ActorKey, CameraState, Character } from '../state/schema';
import { applyCamera, cameraPosition, lensToVFov } from '../three/camera';
import { LM, MIN_VISIBILITY, type DetectedPerson, type LandmarkName, type Vec3 } from './landmarks';
import { leastSquares } from './lm';
import { bodyPoints, type BodyPoint } from './skeleton';
import { solvePose, uprightCamera, type PoseMatch } from './solvePose';

/** The mannequin point that sits where each detected point is. */
export const LANDMARK_POINT: Record<LandmarkName, BodyPoint> = {
  nose: 'noseTip', earL: 'earL', earR: 'earR',
  shoulderL: 'shoulderL', shoulderR: 'shoulderR', elbowL: 'elbowL', elbowR: 'elbowR', wristL: 'wristL', wristR: 'wristR',
  hipL: 'hipL', hipR: 'hipR', kneeL: 'kneeL', kneeR: 'kneeR', ankleL: 'ankleL', ankleR: 'ankleR',
};

/** The part of a photo used for the shot: fractions of the photo's width and height. */
export interface Crop {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A 35 mm-equivalent lens is defined on the diagonal of a 36 × 24 mm frame. */
const FULL_FRAME_DIAGONAL = Math.hypot(36, 24);
/** Lens assumed when the photo doesn't say (35 mm equivalent): a typical phone or kit-zoom view. */
export const DEFAULT_PHOTO_LENS = 35;
/** How strongly an unknown lens is held near the default (per unit of log lens, in frame heights). */
const LENS_PULL = 0.02;
/** Fewer points than this in the frame can't place a camera reliably. */
const MIN_POINTS = 6;
/** Mean miss above this (fraction of the frame height) is a rough match. */
const ROUGH = 0.03;
/** A person shorter than this in the frame (fraction of its height) is too small to match well. */
const SMALL = 0.15;

/**
 * The biggest part of the photo with the shot's aspect (w/h), as near the
 * centre of `around` (fractions of the photo) as it fits.
 */
export function cropToAspect(width: number, height: number, aspect: number, around: [number, number] = [0.5, 0.5]): Crop {
  const photoAspect = width / height;
  const w = photoAspect > aspect ? aspect / photoAspect : 1;
  const h = photoAspect > aspect ? 1 : photoAspect / aspect;
  const clamp = (c: number, size: number) => Math.min(1 - size, Math.max(0, c - size / 2));
  return { x: clamp(around[0], w), y: clamp(around[1], h), w, h };
}

/**
 * A photo's 35 mm-equivalent lens as a shot lens (full-frame width across the
 * shot's frame) for a crop of `cropW` of the photo's width.
 */
export function shotLensFromPhoto(lens35: number, photoAspect: number, cropW: number): number {
  const width = (FULL_FRAME_DIAGONAL * photoAspect) / Math.hypot(photoAspect, 1);
  const tanHalf = ((width / 2) / lens35) * cropW;
  return 18 / tanHalf;
}

/** A detected point in the shot's frame: 0..1 across and down the crop. */
interface Seen {
  point: BodyPoint;
  u: number;
  v: number;
}

/** Visible detected points that fall inside the crop, in its coordinates. */
export function pointsInCrop(person: DetectedPerson, crop: Crop): Seen[] {
  const out: Seen[] = [];
  for (const [name, point] of Object.entries(LANDMARK_POINT) as [LandmarkName, BodyPoint][]) {
    const p = person.image[LM[name]];
    if (!p || p.visibility < MIN_VISIBILITY) continue;
    const u = (p.x - crop.x) / crop.w, v = (p.y - crop.y) / crop.h;
    if (u >= -0.01 && u <= 1.01 && v >= -0.01 && v <= 1.01) out.push({ point, u, v });
  }
  return out;
}

export interface CameraFit {
  camera: CameraState;
  /** Mean miss between the photo's points and the posed character's, as a fraction of the frame height. */
  error: number;
}

/** The camera from its position, view direction (as orbit azimuth and elevation), roll and lens, aimed at `depth` metres away. */
function stateFrom([x, y, z, azimuth, elevation, roll, logLens]: number[], depth: number): CameraState {
  const az = THREE.MathUtils.degToRad(azimuth), el = THREE.MathUtils.degToRad(elevation);
  const dir = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
  const target = new THREE.Vector3(x, y, z).addScaledVector(dir, -depth);
  return { target: [target.x, target.y, target.z], azimuth, elevation, distance: depth, lens: Math.exp(logLens), roll };
}

/**
 * Finds the camera that sees the posed character's points where the photo
 * shows the person's. `start` is a camera to begin from (roughly facing the
 * right side of the body). With `lens` the lens is fixed; otherwise it is
 * fitted, held near `lensGuess`.
 */
export function fitCamera(
  points: Record<BodyPoint, Vec3>,
  seen: Seen[],
  aspect: number,
  start: CameraState,
  lens: { fixed?: number; guess: number },
): CameraFit {
  const world = seen.map((s) => new THREE.Vector3(...points[s.point]));
  const centre = world.reduce((a, b) => a.add(b), new THREE.Vector3()).multiplyScalar(1 / Math.max(1, world.length));
  const cam = new THREE.PerspectiveCamera();
  const v = new THREE.Vector3();
  const pos0 = cameraPosition(start);
  const p0 = [pos0.x, pos0.y, pos0.z, start.azimuth, start.elevation, start.roll, Math.log(lens.fixed ?? start.lens)];
  const free = lens.fixed === undefined;
  const params = (q: number[]) => (free ? q : [...q, p0[6]]);
  const misses = (q: number[]): number[] => {
    const full = params(q);
    const depth = Math.max(0.3, new THREE.Vector3(full[0], full[1], full[2]).distanceTo(centre));
    applyCamera(cam, stateFrom(full, depth), aspect);
    cam.updateMatrixWorld(true);
    const out: number[] = [];
    world.forEach((w, i) => {
      v.copy(w).applyMatrix4(cam.matrixWorldInverse);
      if (v.z > -cam.near) {
        out.push(1, 1);
        return;
      }
      v.applyMatrix4(cam.projectionMatrix);
      // In frame heights both ways, so a miss across counts the same as one up or down.
      out.push((((v.x + 1) / 2 - seen[i].u) * aspect), ((1 - v.y) / 2 - seen[i].v));
    });
    if (free) out.push(LENS_PULL * (full[6] - Math.log(lens.guess)));
    return out;
  };
  const steps = [1e-4, 1e-4, 1e-4, 1e-3, 1e-3, 1e-3, 1e-4];
  const fit = leastSquares(misses, free ? p0 : p0.slice(0, 6), free ? steps : steps.slice(0, 6), { iterations: 200 });
  const full = params(fit.params);
  const pos = new THREE.Vector3(full[0], full[1], full[2]);
  const camera = stateFrom(full, Math.max(0.3, pos.distanceTo(centre)));
  camera.azimuth = ((((camera.azimuth + 180) % 360) + 360) % 360) - 180;
  camera.elevation = Math.max(-89, Math.min(89, camera.elevation));
  camera.lens = Math.max(8, Math.min(400, camera.lens));
  // Mean miss over the points only (not the lens pull).
  const r = misses(fit.params);
  let sum = 0;
  for (let i = 0; i < seen.length; i++) sum += Math.hypot(r[2 * i], r[2 * i + 1]);
  return { camera, error: sum / Math.max(1, seen.length) };
}

export interface MatchRequest {
  person: DetectedPerson;
  /** The photo's size in pixels, and its 35 mm-equivalent lens if EXIF had one. */
  photo: { width: number; height: number; lens35?: number };
  character: Pick<Character, 'heightCm' | 'sex' | 'build'>;
  /** The character's key being matched: position and yaw stay. */
  key: ActorKey;
  /** Where the body's feet go for a key (from `bodyPosition`: seats and platforms lift it). */
  base: (key: ActorKey) => Vec3;
  /** The shot frame's aspect (w/h). */
  aspect: number;
  matchPose: boolean;
  matchCamera: boolean;
  /** A shot lens (mm) to use instead of the photo's: the lens slider. */
  lens?: number;
}

export interface MatchResult {
  /** The key with the matched pose (unchanged unless `matchPose`). */
  key: ActorKey;
  /** The matched camera, when asked for and it could be placed. */
  camera?: CameraState;
  /** The part of the photo the shot shows. */
  crop: Crop;
  /** Mean miss of the camera match, as a fraction of the frame height. */
  error?: number;
  /** Why the match may be rough, for the preview. */
  warnings: string[];
}

/**
 * Matches a shot to a photo: the character's pose, the camera, or both. The
 * character never moves; the camera comes to it. Which way is up in the
 * photo is taken from the body (`uprightCamera`); the pose is solved with
 * that, the camera fitted to the posed character, and the pose solved once
 * more with the fitted camera. Returns null when the photo doesn't show the
 * shoulders and hips.
 */
export function matchPhoto(req: MatchRequest): MatchResult | null {
  const crop = cropToAspect(req.photo.width, req.photo.height, req.aspect, centreOf(req.person));
  const photoAspect = req.photo.width / req.photo.height;
  const withPose = (m: PoseMatch): ActorKey => ({ ...req.key, pose: m.pose, joints: m.joints });

  // Which way is up in the photo comes from the body (see uprightCamera), whatever the shot camera is doing.
  const upright = uprightCamera(req.person);
  let m = solvePose(req.person, upright);
  if (!m) return null;
  if (!req.matchCamera) return { key: withPose(m), crop, warnings: [] };

  const seen = pointsInCrop(req.person, crop);
  const warnings: string[] = [];
  if (seen.length < MIN_POINTS) {
    warnings.push('Too little of the body is in the frame to place the camera.');
    return { key: req.matchPose ? withPose(m) : req.key, crop, warnings };
  }
  const guess = shotLensFromPhoto(req.photo.lens35 ?? DEFAULT_PHOTO_LENS, photoAspect, crop.w);
  const fixed = req.lens ?? (req.photo.lens35 ? guess : undefined);
  let fit: CameraFit | undefined;
  // Perspective in the photo can nudge the tilt the body gave; the pose follows it once.
  for (let round = 0; round < 2; round++) {
    const posed = withPose(m);
    const points = bodyPoints(req.character, posed, req.base(posed));
    const start = fit?.camera ?? { ...startCamera(points, seen, posed.yaw - m.facing, req.aspect, fixed ?? guess), elevation: upright.cameraTilt, roll: upright.cameraRoll };
    fit = fitCamera(points, seen, req.aspect, start, { fixed, guess });
    if (round === 0) m = solvePose(req.person, { cameraTilt: fit.camera.elevation, cameraRoll: fit.camera.roll }) ?? m;
  }
  const height = Math.max(...seen.map((s) => s.v)) - Math.min(...seen.map((s) => s.v));
  if (height < SMALL) warnings.push('The person is small in the photo, so the camera match is rough.');
  if (fit!.error > ROUGH) warnings.push("The photo's body doesn't line up well with the character; the camera match is rough.");
  return { key: req.matchPose ? withPose(m) : req.key, camera: fit!.camera, crop, error: fit!.error, warnings };
}

/** Middle of the person's visible points in the photo, so the crop keeps them. */
function centreOf(person: DetectedPerson): [number, number] {
  const pts = Object.values(LM).map((i) => person.image[i]).filter((p) => p && p.visibility >= MIN_VISIBILITY);
  if (!pts.length) return [0.5, 0.5];
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
}

/**
 * A first guess: from `azimuth`, level, far enough back that the body's
 * points span as much of the frame's height as they do in the photo.
 */
function startCamera(points: Record<BodyPoint, Vec3>, seen: Seen[], azimuth: number, aspect: number, lens: number): CameraState {
  const world = seen.map((s) => points[s.point]);
  const ys = world.map((p) => p[1]);
  const centre = world.reduce<Vec3>((a, p) => [a[0] + p[0] / world.length, a[1] + p[1] / world.length, a[2] + p[2] / world.length], [0, 0, 0]);
  const span = Math.max(0.2, Math.max(...ys) - Math.min(...ys));
  const vs = seen.map((s) => s.v);
  const frac = Math.max(0.05, Math.max(...vs) - Math.min(...vs));
  const vfov = THREE.MathUtils.degToRad(lensToVFov(lens, aspect));
  const distance = span / frac / (2 * Math.tan(vfov / 2));
  return { target: centre, azimuth, elevation: 0, distance, lens, roll: 0 };
}
