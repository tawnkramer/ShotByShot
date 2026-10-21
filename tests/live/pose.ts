/**
 * A page for the live pose test: runs the app's MediaPipe detection on a
 * photo in a real browser, then draws the matched mannequin over the photo,
 * driven from node by tests/pose.live.test.ts.
 */
import { findPeople } from '../../src/pose/detect';
import { matchPhoto } from '../../src/pose/solveCamera';
import { bodyPoints } from '../../src/pose/skeleton';
import { applyCamera } from '../../src/three/camera';
import { PerspectiveCamera, Vector3 } from 'three';
import type { Build, Sex } from '../../src/state/schema';

import './pose-types';

const load = (url: string) => new Promise<HTMLImageElement>((resolve, reject) => {
  const img = new Image();
  img.onload = () => resolve(img);
  img.onerror = reject;
  img.src = url;
});

window.detectPhoto = async (url) => {
  const img = await load(url);
  return { width: img.naturalWidth, height: img.naturalHeight, people: await findPeople(img) };
};

const BONES = [['shoulderL', 'shoulderR'], ['hipL', 'hipR'], ['shoulderL', 'hipL'], ['shoulderR', 'hipR'], ['shoulderL', 'elbowL'], ['elbowL', 'wristL'], ['shoulderR', 'elbowR'], ['elbowR', 'wristR'], ['hipL', 'kneeL'], ['kneeL', 'ankleL'], ['hipR', 'kneeR'], ['kneeR', 'ankleR'], ['neck', 'head'], ['head', 'noseTip']] as const;

window.drawMatch = async (url, person, aspect) => {
  const img = await load(url);
  const character = { heightCm: 175, sex: 'male' as Sex, build: 'average' as Build };
  const result = matchPhoto({
    person, photo: { width: img.naturalWidth, height: img.naturalHeight }, character,
    key: { position: [0, 0, 0], yaw: 0, pose: 'standing' }, base: () => [0, 0, 0], aspect, matchPose: true, matchCamera: true,
  });
  const H = 720, W = Math.round(H * aspect);
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  const crop = result!.crop;
  ctx.drawImage(img, crop.x * img.naturalWidth, crop.y * img.naturalHeight, crop.w * img.naturalWidth, crop.h * img.naturalHeight, 0, 0, W, H);
  // Detected points (red; left side filled) in the crop.
  for (const [i, p] of person.image.entries()) {
    if (i > 28 || p.visibility < 0.5) continue;
    ctx.fillStyle = i % 2 ? '#ff3b30' : '#ffcc00';
    ctx.beginPath();
    ctx.arc(((p.x - crop.x) / crop.w) * W, ((p.y - crop.y) / crop.h) * H, 5, 0, Math.PI * 2);
    ctx.fill();
  }
  // The matched mannequin through the matched camera (blue; left limbs thicker).
  if (result?.camera) {
    const cam = new PerspectiveCamera();
    applyCamera(cam, result.camera, aspect);
    cam.updateMatrixWorld(true);
    const pts = bodyPoints(character, result.key, [0, 0, 0]);
    const at = (n: keyof typeof pts) => {
      const v = new Vector3(...pts[n]).project(cam);
      return [((v.x + 1) / 2) * W, ((1 - v.y) / 2) * H];
    };
    for (const [a, b] of BONES) {
      ctx.strokeStyle = '#0a84ff';
      ctx.lineWidth = a.endsWith('L') || b.endsWith('L') ? 6 : 3;
      ctx.beginPath();
      ctx.moveTo(...(at(a) as [number, number]));
      ctx.lineTo(...(at(b) as [number, number]));
      ctx.stroke();
    }
  }
  return { image: canvas.toDataURL('image/jpeg', 0.9), result };
};

document.title = 'ready';
