import * as THREE from 'three';
import type { Project, Shot, Character } from '../state/schema';
import { effectiveShot, shotLines } from '../shots/setup';
import { getBlob } from '../storage/db';
import { CHARACTER_IMAGE_PRESENTATION, characterImagePrompt } from './generate';

export interface ShotCapture { blob: Blob; characterIds: string[]; progress: number; stageObjectIds?: string[]; framing?: {characterId:string;screenX:number;screenY:number}[] }
export interface ShotReference { blob: string; name: string; kind: 'stage' | 'character'; characterId?: string; data: Blob }

/** Includes partially framed actors, excluding actors behind the camera or fully hidden by set geometry. */
export function charactersInFrame(root: THREE.Object3D, camera: THREE.PerspectiveCamera): string[] {
  return visibleRigIds(root, camera, 'actor:');
}

export function stageObjectsInFrame(root: THREE.Object3D, camera: THREE.PerspectiveCamera): string[] {
  return visibleRigIds(root, camera, 'stage:');
}

function visibleRigIds(root: THREE.Object3D, camera: THREE.PerspectiveCamera, prefix: string): string[] {
  root.updateMatrixWorld(true); camera.updateMatrixWorld(true);
  const frustum = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
  const candidates = root.children.filter((o) => o.visible && String(o.userData.rigId).startsWith(prefix) && frustum.intersectsBox(new THREE.Box3().setFromObject(o)));
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
  // Screen rays catch large room surfaces whose center and vertices are outside the frame.
  const screenVisible = new Set<THREE.Object3D>();
  for (let x = -1; x <= 1; x += 0.25) for (let y = -1; y <= 1; y += 0.25) {
    ray.setFromCamera(new THREE.Vector2(x, y), camera);
    const hit = ray.intersectObjects(meshes, false)[0]?.object;
    for (let o: THREE.Object3D | null | undefined = hit; o; o = o.parent) {
      if (candidates.includes(o)) { screenVisible.add(o); break; }
    }
  }
  return candidates.filter((actor) => {
    if (screenVisible.has(actor)) return true;
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
  }).map((o) => String(o.userData.rigId).slice(prefix.length));
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

export const SHOT_COMPOSITION_GUIDANCE = [
  'Use Image 1, the greyscale previs, as the strongest guide for camera angle, perspective, framing, and composition. Match its viewpoint and the visible placement of scene elements closely.',
  'Include only scene details visible from this camera angle. Do not introduce objects, windows, doors, or other architectural elements from elsewhere in the stage or reference images, and do not move off-screen elements into view.',
  'Appearance references and scene descriptions describe the larger setting; they do not change what the shot camera can see. Light may come from off-screen windows or fixtures. Respect any specified light-source positions and directions without relocating their sources into the frame. When lighting is unspecified, infer consistent illumination from the references without adding unseen architecture.',
  'Keep the aspect ratio of the greyscale preview and the same frame boundaries. Do not reframe, widen the view, or crop differently to show more of the scene.',
  'The mannequin poses and actions are rough blocking only. Follow written direction for changes to pose, gesture, expression, interaction, and action while preserving the established camera framing and composition unless a camera change is explicitly requested.',
].join('\n');

export function shotImagePrompt(project: Project, shot: Shot, capture: ShotCapture, references: ShotReference[], additional: string): string {
  const eff = effectiveShot(project, shot.id)!;
  const stage = project.stages.find((s) => s.id === eff.stageId);
  const characters = capture.characterIds.map((id) => project.characters.find((c) => c.id === id)).filter((c): c is Character => Boolean(c));
  return [
    `Create a cinematic illustrated frame for shot ${shot.number}.`,
    'Image 1 is a rough greyscale previs approximation for camera framing, perspective, and composition, not an exact depiction of the final pose or action. Use its spatial layout as a guide. Replace mannequins with the referenced characters and interpret their anatomy and movement naturally. Written story context and additional direction take precedence over the previs for poses, gestures, expressions, interactions, and on-screen actions. Apply requested changes even when they differ from the mannequin blocking; retain the camera framing and composition where compatible with those changes. Do not copy neutral reference backgrounds into the scene. No labels, captions, text, grid lines, or editing handles. The descriptions below are appearance notes: ignore their original generation instructions about neutral backgrounds, standing poses, or excluding people.',
    SHOT_COMPOSITION_GUIDANCE,
    `Preview aspect ratio: ${project.aspect}.`,
    ...references.map((r, i) => `Image ${i + 2} is the ${r.kind} appearance reference for ${r.name}. Use it for ${r.kind === 'stage' ? 'set design, materials, colors, lighting, and atmosphere' : 'identity, face, hair, clothing, and proportions'}.`),
    stage?.image?.prompt ? `Stage description (${stage.name}): ${stage.image.prompt.replace(/(?:^|\n)Stage objects:[^\n]*/g, '').trim()}` : stage ? `Location: ${stage.name}.` : '',
    stage && capture.stageObjectIds?.length ? `Stage objects visible in this frame: ${stage.objects.filter((o) => capture.stageObjectIds!.includes(o.id)).map((o) => o.name).join(', ')}.` : '',
    ...(capture.framing ?? []).map((f) => `${characters.find((c) => c.id === f.characterId)?.name ?? f.characterId} is centered approximately ${Math.round(f.screenX * 100)}% from the left and ${Math.round(f.screenY * 100)}% from the top of Image 1.`),
    ...characters.map((c) => `Character description (${c.name}): ${(c.image?.prompt ?? characterImagePrompt(c)).replaceAll(CHARACTER_IMAGE_PRESENTATION, '').replaceAll(`Create a full-body character concept illustration of ${c.name}.`, '').trim()}`),
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
