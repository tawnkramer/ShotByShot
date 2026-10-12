import * as THREE from 'three';
import type { CameraState } from '../state/schema';

const SENSOR_W = 36; // full-frame width in mm

/** Vertical field of view in degrees for a focal length, given the frame's aspect (w/h). */
export function lensToVFov(lens: number, aspect: number): number {
  const hfov = 2 * Math.atan(SENSOR_W / 2 / lens);
  return THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(hfov / 2) / aspect));
}

/** Camera position for an orbit state. */
export function cameraPosition(s: CameraState): THREE.Vector3 {
  const az = THREE.MathUtils.degToRad(s.azimuth);
  const el = THREE.MathUtils.degToRad(s.elevation);
  return new THREE.Vector3(
    s.target[0] + s.distance * Math.sin(az) * Math.cos(el),
    s.target[1] + s.distance * Math.sin(el),
    s.target[2] + s.distance * Math.cos(az) * Math.cos(el),
  );
}

export function applyCamera(camera: THREE.PerspectiveCamera, s: CameraState, aspect: number): void {
  camera.position.copy(cameraPosition(s));
  camera.up.set(0, 1, 0);
  camera.lookAt(new THREE.Vector3(...s.target));
  if (s.roll) camera.rotateZ(THREE.MathUtils.degToRad(s.roll));
  camera.fov = lensToVFov(s.lens, aspect);
  camera.aspect = aspect;
  camera.near = Math.max(0.02, s.distance / 200);
  camera.far = 500;
  camera.updateProjectionMatrix();
}

/** Moves the target in the camera's screen plane (two-finger pan). dx/dy are fractions of the frame. */
export function panCamera(s: CameraState, dx: number, dy: number, aspect: number): CameraState {
  const cam = new THREE.PerspectiveCamera();
  applyCamera(cam, s, aspect);
  const vfov = THREE.MathUtils.degToRad(lensToVFov(s.lens, aspect));
  const h = 2 * s.distance * Math.tan(vfov / 2);
  const right = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion).multiplyScalar(-dx * h * aspect);
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(cam.quaternion).multiplyScalar(dy * h);
  const t = new THREE.Vector3(...s.target).add(right).add(up);
  return { ...s, target: [t.x, Math.max(0, t.y), t.z] };
}

/**
 * Moves the whole camera (position and aim together) relative to where it
 * faces: `right` trucks sideways, `forward` dollies along the ground, `up`
 * cranes. In metres.
 */
export function moveCamera(s: CameraState, move: { right?: number; forward?: number; up?: number }): CameraState {
  const az = THREE.MathUtils.degToRad(s.azimuth);
  const r = move.right ?? 0, f = move.forward ?? 0, u = move.up ?? 0;
  const x = s.target[0] + Math.cos(az) * r - Math.sin(az) * f;
  const z = s.target[2] - Math.sin(az) * r - Math.cos(az) * f;
  return { ...s, target: [x, Math.max(0, s.target[1] + u), z] };
}

/**
 * Turns the camera where it stands, as on a tripod head: `pan` turns right
 * (+) or left, `tilt` aims up (+) or down. In degrees.
 */
export function turnCamera(s: CameraState, turn: { pan?: number; tilt?: number }): CameraState {
  const p = cameraPosition(s);
  const azimuth = s.azimuth - (turn.pan ?? 0);
  const elevation = Math.max(-80, Math.min(85, s.elevation - (turn.tilt ?? 0)));
  const az = THREE.MathUtils.degToRad(azimuth);
  const el = THREE.MathUtils.degToRad(elevation);
  const target: [number, number, number] = [
    p.x - s.distance * Math.sin(az) * Math.cos(el),
    p.y - s.distance * Math.sin(el),
    p.z - s.distance * Math.cos(az) * Math.cos(el),
  ];
  return { ...s, azimuth, elevation, target };
}

export const SHOT_SIZES = {
  EWS: { label: 'Extreme wide', center: 0.5, extent: 3.2 },
  WS: { label: 'Wide', center: 0.5, extent: 1.25 },
  MS: { label: 'Medium', center: 0.72, extent: 0.6 },
  MCU: { label: 'Medium close', center: 0.82, extent: 0.38 },
  CU: { label: 'Close-up', center: 0.9, extent: 0.24 },
  ECU: { label: 'Extreme close', center: 0.93, extent: 0.1 },
} as const;
export type ShotSize = keyof typeof SHOT_SIZES;

export interface Subject {
  position: [number, number, number];
  height: number;
  yaw: number;
}

/**
 * A camera that frames subjects at a shot size, looking from `azimuth`
 * (defaults to straight on to the first subject's face). Heights are used to
 * pick what part of the body fills the frame.
 */
export function frameSubjects(subjects: Subject[], size: ShotSize, aspect: number, opts: { azimuth?: number; elevation?: number; lens?: number } = {}): CameraState {
  const lens = opts.lens ?? (size === 'EWS' || size === 'WS' ? 28 : 50);
  const elevation = opts.elevation ?? (size === 'EWS' ? 12 : 3);
  const def = SHOT_SIZES[size];
  if (!subjects.length) return { target: [0, 1.2, 0], azimuth: opts.azimuth ?? 0, elevation: 15, distance: 7, lens: 24, roll: 0 };
  const h = Math.max(...subjects.map((s) => s.height));
  // People raised off the floor (on a bar stool) are framed from where they are.
  const base = Math.max(...subjects.map((s) => s.position[1]));
  const xs = subjects.map((s) => s.position[0]);
  const zs = subjects.map((s) => s.position[2]);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cz = (Math.min(...zs) + Math.max(...zs)) / 2;
  const azimuth = opts.azimuth ?? subjects[0].yaw;
  // Spread of the group across the frame, seen from the camera direction.
  const az = THREE.MathUtils.degToRad(azimuth);
  const across = subjects.map((s) => (s.position[0] - cx) * Math.cos(az) - (s.position[2] - cz) * Math.sin(az));
  const spread = Math.max(...across) - Math.min(...across) + 0.6;
  const vfov = THREE.MathUtils.degToRad(lensToVFov(lens, aspect));
  const needV = (def.extent * h) / 2 / Math.tan(vfov / 2);
  const needH = spread / 2 / (Math.tan(vfov / 2) * aspect);
  return {
    target: [cx, base + def.center * h, cz],
    azimuth,
    elevation,
    distance: Math.max(0.3, needV, size === 'CU' || size === 'ECU' ? 0 : needH),
    lens,
    roll: 0,
  };
}
