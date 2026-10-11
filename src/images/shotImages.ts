import * as THREE from 'three';
import type { Project, Shot, Character } from '../state/schema';
import { effectiveShot, shotLines } from '../shots/setup';
import { getBlob } from '../storage/db';
import { characterImagePrompt } from './generate';

export interface ShotCapture { blob: Blob; characterIds: string[]; progress: number; framing?: {characterId:string;screenX:number;screenY:number}[] }
export interface ShotReference { blob: string; name: string; kind: 'stage' | 'character'; characterId?: string; data: Blob }

/** Includes partially framed actors, excluding actors behind the camera or fully hidden by set geometry. */
export function charactersInFrame(root: THREE.Object3D, camera: THREE.PerspectiveCamera): string[] {
  root.updateMatrixWorld(true); camera.updateMatrixWorld(true);
  const frustum = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
  const candidates = root.children.filter((o) => o.visible && String(o.userData.rigId).startsWith('actor:') && frustum.intersectsBox(new THREE.Box3().setFromObject(o)));
  const meshes: THREE.Mesh[] = [];
  root.traverseVisible((o) => { if (o instanceof THREE.Mesh) meshes.push(o); });
  const ray = new THREE.Raycaster();
  ray.near = camera.near; ray.far = camera.far;
  const visibleAt = (point: THREE.Vector3, actor: THREE.Object3D) => {
    const screen = point.project(camera);
    if (Math.abs(screen.x) > 1 || Math.abs(screen.y) > 1 || Math.abs(screen.z) > 1) return false;
    ray.setFromCamera(new THREE.Vector2(screen.x, screen.y), camera);
    const hit = ray.intersectObjects(meshes, false)[0]?.object;
    for (let o: THREE.Object3D | null | undefined = hit; o; o = o.parent) if (o === actor) return true;
    return false;
  };
  return candidates.filter((actor) => {
    let visible = false;
    actor.traverseVisible((o) => {
      if (visible || !(o instanceof THREE.Mesh)) return;
      const positions = o.geometry.getAttribute('position');
      if (!positions) return;
      const center = new THREE.Box3().setFromObject(o).getCenter(new THREE.Vector3());
      if (visibleAt(center, actor)) { visible = true; return; }
      // Surface samples catch a head or limb visible around an occluding object.
      const step = Math.max(1, Math.floor(positions.count / 16));
      for (let i = 0; i < positions.count; i += step) {
        if (visibleAt(new THREE.Vector3().fromBufferAttribute(positions, i).applyMatrix4(o.matrixWorld), actor)) { visible = true; break; }
      }
    });
    return visible;
  }).map((o) => String(o.userData.rigId).slice(6));
}

export async function shotReferences(project: Project, shot: Shot, characterIds: string[]): Promise<ShotReference[]> {
  const stage = project.stages.find((s) => s.id === effectiveShot(project, shot.id)?.stageId);
  const refs: Omit<ShotReference, 'data'>[] = [];
  if (stage?.image) refs.push({blob:stage.image.blob,name:stage.name,kind:'stage'});
  for (const id of [...new Set(characterIds)]) {
    const c = project.characters.find((c) => c.id === id);
    if (c?.image) refs.push({blob:c.image.blob,name:c.name,kind:'character',characterId:id});
  }
  if (refs.length > 15) throw new Error('This frame has too many references. Use at most 14 character images plus one stage image.');
  return Promise.all(refs.map(async (ref) => {
    const data = await getBlob(ref.blob);
    if (!data) throw new Error(`The saved image for ${ref.name} is missing. Regenerate it before rendering this shot.`);
    // Project imports can restore blobs without their original MIME type.
    return {...ref,data: new Blob([data], {type:'image/png'})};
  }));
}

export function shotImagePrompt(project: Project, shot: Shot, capture: ShotCapture, references: ShotReference[], additional: string): string {
  const eff = effectiveShot(project, shot.id)!;
  const stage = project.stages.find((s) => s.id === eff.stageId);
  const characters = capture.characterIds.map((id) => project.characters.find((c) => c.id === id)).filter((c): c is Character => Boolean(c));
  return [
    `Create a cinematic illustrated frame for shot ${shot.number}.`,
    'Image 1 is a rough greyscale previs approximation for camera framing, perspective, and composition, not an exact depiction of the final pose or action. Use its spatial layout as a guide. Replace mannequins with the referenced characters and interpret their anatomy and movement naturally. Written story context and additional direction take precedence over the previs for poses, gestures, expressions, interactions, and on-screen actions. Apply requested changes even when they differ from the mannequin blocking; retain the camera framing and composition where compatible with those changes. Do not copy neutral reference backgrounds into the scene. No labels, captions, text, grid lines, or editing handles. The descriptions below are appearance notes: ignore their original generation instructions about neutral backgrounds, standing poses, or excluding people.',
    ...references.map((r, i) => `Image ${i + 2} is the ${r.kind} appearance reference for ${r.name}. Use it for ${r.kind === 'stage' ? 'set design, materials, colors, lighting, and atmosphere' : 'identity, face, hair, clothing, and proportions'}.`),
    stage?.image?.prompt ? `Stage description (${stage.name}): ${stage.image.prompt}` : stage ? `Location: ${stage.name}.` : '',
    ...(capture.framing ?? []).map((f) => `${characters.find((c) => c.id === f.characterId)?.name ?? f.characterId} is centered approximately ${Math.round(f.screenX * 100)}% from the left and ${Math.round(f.screenY * 100)}% from the top of Image 1.`),
    ...characters.map((c) => `Character description (${c.name}): ${c.image?.prompt ?? characterImagePrompt(c)}`),
    `Story context: ${shotLines(project, shot).map((l) => l.text).join('\n')}`,
    `Moment: ${(capture.progress * eff.durationSec).toFixed(2)} seconds into a ${eff.durationSec.toFixed(2)} second shot.`,
    additional.trim() ? `Additional direction (highest priority for modifications to pose and action): ${additional.trim()}` : '',
  ].filter(Boolean).join('\n\n');
}

export function greyscalePixels(data: Uint8ClampedArray): void {
  for (let i = 0; i < data.length; i += 4) {
    const grey = Math.round(0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]);
    data[i] = grey; data[i + 1] = grey; data[i + 2] = grey;
  }
}

export function greyscaleSnapshot(source: HTMLCanvasElement): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = source.width; canvas.height = source.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return Promise.reject(new Error('Could not capture the shot preview.'));
  ctx.drawImage(source, 0, 0);
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
  greyscalePixels(pixels.data); ctx.putImageData(pixels, 0, 0);
  return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Could not capture the shot preview.')), 'image/png'));
}
