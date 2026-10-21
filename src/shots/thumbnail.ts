import * as THREE from 'three';
import type { Project } from '../state/schema';
import { ShotRig } from '../three/shotRig';
import { applyCamera } from '../three/camera';
import { hashKey, renderView } from '../three/thumbnails';
import { effectiveShot, frameAspect } from './setup';

/** Everything that affects how a shot's first frame looks. */
export function shotThumbKey(project: Project, shotId: string): string {
  const eff = effectiveShot(project, shotId);
  if (!eff) return `shot:none:${shotId}`;
  const stage = project.stages.find((s) => s.id === eff.stageId);
  const chars = eff.setup.actors.map((a) => project.characters.find((c) => c.id === a.characterId));
  const props = eff.setup.props.map((p) => project.props.find((x) => x.id === p.propId));
  return `shot:${hashKey(JSON.stringify([frameAspect(project, project.shots.find((s) => s.id === shotId)), eff.setup, eff.camera.start, stage?.objects, chars, props]))}`;
}

export function renderShotThumbnail(project: Project, shotId: string, width = 480): Promise<string | null> {
  const aspect = frameAspect(project, project.shots.find((s) => s.id === shotId));
  const height = Math.round(width / aspect);
  return renderView(
    shotThumbKey(project, shotId),
    async () => {
      const rig = new ShotRig();
      rig.sync(project, shotId);
      await rig.ready();
      const cam = new THREE.PerspectiveCamera();
      const state = rig.setTime(0);
      if (state) applyCamera(cam, state, aspect);
      const object = new THREE.Group();
      object.add(rig.root, ...lights());
      return { object, camera: cam, cleanup: () => rig.dispose() };
    },
    { width, height },
  );
}

/** The shot at its start or end key, e.g. to preview a change before it's made. */
export function renderShotAt(project: Project, shotId: string, which: 'start' | 'end', width = 480): Promise<string | null> {
  const aspect = frameAspect(project, project.shots.find((s) => s.id === shotId));
  const eff = effectiveShot(project, shotId);
  const key = `shot-at:${hashKey(JSON.stringify([shotThumbKey(project, shotId), which, eff?.camera]))}`;
  return renderView(
    key,
    async () => {
      const rig = new ShotRig();
      rig.sync(project, shotId);
      await rig.ready();
      const cam = new THREE.PerspectiveCamera();
      const state = rig.setTime(which === 'start' ? 0 : 1);
      if (state) applyCamera(cam, state, aspect);
      const object = new THREE.Group();
      object.add(rig.root, ...lights());
      return { object, camera: cam, cleanup: () => rig.dispose() };
    },
    { width, height: Math.round(width / aspect) },
  );
}

/** The same lighting as the live views. */
export function lights(): THREE.Object3D[] {
  const hemi = new THREE.HemisphereLight(0xffffff, 0x55555c, 1.1);
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(6, 10, 5);
  return [hemi, sun];
}
