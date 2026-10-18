import * as THREE from 'three';
import type { Project, Shot } from '../state/schema';
import { effectiveShot, frameAspect, subjectsFor } from '../shots/setup';
import { applyCamera } from '../three/camera';

/** Where a character's head is in a panel, in 0..1 of the panel (y down). */
export interface HeadSpot {
  characterId: string;
  /** Center of the head. */
  x: number;
  y: number;
  /** Where a tail should point. */
  mouth: { x: number; y: number };
  /** Head radius as a fraction of the panel height. */
  r: number;
  /** Within the frame and in front of the camera. */
  inFrame: boolean;
}

/** Head center and mouth, as fractions of standing height above the feet. */
const HEAD = 0.93, MOUTH = 0.885, HEAD_RADIUS_M = 0.13;

/**
 * Projects every character in the panel through its camera. Pure math on
 * the shot's start keys: no rendering, so it's cheap enough to run for a
 * whole book.
 */
export function panelHeads(project: Project, shot: Shot): HeadSpot[] {
  const eff = effectiveShot(project, shot.id);
  if (!eff) return [];
  const aspect = frameAspect(project, shot);
  const camera = new THREE.PerspectiveCamera();
  applyCamera(camera, eff.camera.start, aspect);
  camera.updateMatrixWorld();
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
  const subjects = subjectsFor(project, eff.setup, undefined, eff.stageId);
  return eff.setup.actors.map((a, i) => {
    const s = subjects[i];
    const head = new THREE.Vector3(s.position[0], s.position[1] + s.height * HEAD, s.position[2]);
    const mouth = new THREE.Vector3(s.position[0], s.position[1] + s.height * MOUTH, s.position[2]);
    const edge = head.clone().addScaledVector(up, HEAD_RADIUS_M);
    const view = head.clone().applyMatrix4(camera.matrixWorldInverse);
    const [h, m, e] = [head, mouth, edge].map((v) => toPanel(v.clone().project(camera)));
    const inFront = view.z < 0;
    return {
      characterId: a.characterId,
      x: h.x, y: h.y,
      mouth: m,
      r: inFront ? Math.hypot(e.x * aspect - h.x * aspect, e.y - h.y) : 0,
      inFrame: inFront && h.x >= 0 && h.x <= 1 && h.y >= 0 && h.y <= 1,
    };
  });
}

function toPanel(ndc: THREE.Vector3): { x: number; y: number } {
  return { x: (ndc.x + 1) / 2, y: (1 - ndc.y) / 2 };
}
