import * as THREE from 'three';
import { useEffect, useState } from 'react';
import { disposeObject } from './materials';

/**
 * One offscreen renderer for every thumbnail in the app. Phones allow only a
 * handful of live WebGL contexts, so lists show images, not canvases.
 */

let renderer: THREE.WebGLRenderer | null = null;
let scene: THREE.Scene;
let camera: THREE.PerspectiveCamera;
let queue: Promise<unknown> = Promise.resolve();
const cache = new Map<string, string>();

function setup(): boolean {
  if (renderer) return true;
  try {
    const canvas = document.createElement('canvas');
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  } catch {
    return false;
  }
  renderer.shadowMap.enabled = true;
  scene = new THREE.Scene();
  scene.background = new THREE.Color('#2b2b30');
  scene.add(new THREE.HemisphereLight(0xffffff, 0x55555c, 1.2));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(3, 6, 5);
  scene.add(sun);
  camera = new THREE.PerspectiveCamera(30, 1, 0.05, 200);
  return true;
}

export interface ThumbnailOptions {
  width?: number;
  height?: number;
  /** Degrees around the object, 0 = straight on from the front (+Z). */
  azimuth?: number;
  elevation?: number;
}

/** Renders a freshly built object framed to fit, then disposes it. Returns an object URL, cached by `key`. */
export function renderThumbnail(key: string, build: () => THREE.Object3D, opts: ThumbnailOptions = {}): Promise<string | null> {
  const hit = cache.get(key);
  if (hit) return Promise.resolve(hit);
  const job = queue.then(async () => {
    if (!setup() || !renderer) return null;
    const { width = 240, height = 240, azimuth = 25, elevation = 12 } = opts;
    const object = build();
    scene.add(object);
    object.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(object);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    camera.aspect = width / height;
    const vFov = THREE.MathUtils.degToRad(camera.fov);
    const fitH = size.y / 2 / Math.tan(vFov / 2);
    const fitW = Math.max(size.x, size.z) / 2 / (Math.tan(vFov / 2) * camera.aspect);
    const dist = Math.max(fitH, fitW) * 1.25 + Math.max(size.x, size.z) / 2;
    const az = THREE.MathUtils.degToRad(azimuth), el = THREE.MathUtils.degToRad(elevation);
    camera.position.set(center.x + dist * Math.sin(az) * Math.cos(el), center.y + dist * Math.sin(el), center.z + dist * Math.cos(az) * Math.cos(el));
    camera.lookAt(center);
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.setSize(width, height, false);
    renderer.render(scene, camera);
    scene.remove(object);
    disposeObject(object);
    const blob = await new Promise<Blob | null>((resolve) => renderer!.domElement.toBlob(resolve, 'image/png'));
    if (!blob) return null;
    const url = URL.createObjectURL(blob);
    cache.set(key, url);
    return url;
  });
  queue = job.catch(() => null);
  return job;
}

export function useThumbnail(key: string, build: () => THREE.Object3D, opts?: ThumbnailOptions): string | null {
  const [url, setUrl] = useState<string | null>(() => cache.get(key) ?? null);
  useEffect(() => {
    let cancelled = false;
    void renderThumbnail(key, build, opts).then((u) => !cancelled && setUrl(u));
    return () => {
      cancelled = true;
    };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return url;
}
