import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { DRACO_GLTF_CONFIG, DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { getBlob, putBlob } from '../storage/db';
import { applyGrey } from './materials';
import { buildStatic } from './library';
import type { ObjectSource } from '../state/schema';

export type AssetFormat = 'obj' | 'gltf' | 'glb';

export const MAX_MODEL_BYTES = 50 * 1024 * 1024;

export function formatOf(fileName: string): AssetFormat | null {
  const ext = fileName.toLowerCase().split('.').pop();
  return ext === 'obj' || ext === 'gltf' || ext === 'glb' ? ext : null;
}

/** Content hash used as the blob key, so the same model is stored once. */
export async function hashBytes(data: ArrayBuffer): Promise<string> {
  if (crypto.subtle) {
    const digest = await crypto.subtle.digest('SHA-256', data);
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  // crypto.subtle is missing on insecure origins (phone on the dev server); FNV-1a is enough for dedupe there.
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  const bytes = new Uint8Array(data);
  for (let i = 0; i < bytes.length; i++) {
    h1 = Math.imul(h1 ^ bytes[i], 16777619);
    h2 = Math.imul(h2 ^ bytes[(i * 7) % bytes.length], 2246822507);
  }
  return `fnv${(h1 >>> 0).toString(16)}${(h2 >>> 0).toString(16)}${bytes.length.toString(16)}`;
}

let dracoLoader: DRACOLoader | undefined;
function gltfLoader(): GLTFLoader {
  const loader = new GLTFLoader();
  // The decoder ships in the bundle (same origin), which the CSP requires.
  dracoLoader ??= new DRACOLoader().setDecoderPath(DRACO_GLTF_CONFIG);
  loader.setDRACOLoader(dracoLoader);
  loader.setMeshoptDecoder(MeshoptDecoder);
  return loader;
}

/** Parses a model file into a grey, normalized Object3D. */
export async function parseModel(data: ArrayBuffer, format: AssetFormat): Promise<THREE.Object3D> {
  let root: THREE.Object3D;
  if (format === 'obj') {
    root = new OBJLoader().parse(new TextDecoder().decode(data));
  } else {
    const gltf = await gltfLoader().parseAsync(data, '');
    root = gltf.scene;
  }
  return normalizeModel(root);
}

/**
 * Makes an imported model usable on a stage: grey materials, shadows, sitting
 * on the floor, centered, and at a plausible real-world size. Models wildly
 * larger than a building are assumed to be in centimeters (or millimeters),
 * and tiny ones in kilometers or similar.
 */
export function normalizeModel(root: THREE.Object3D): THREE.Object3D {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.userData.shade = 0.7;
    // Copies share this geometry with the cached original; never dispose it.
    m.userData.cachedAsset = true;
    m.castShadow = true;
    m.receiveShadow = true;
    // Without normals, lit materials render black.
    if (!m.geometry.getAttribute('normal')) m.geometry.computeVertexNormals();
  });
  applyGrey(root, undefined);

  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  const factor = unitScale(Math.max(size.x, size.y, size.z));
  const center = box.getCenter(new THREE.Vector3());

  const wrapper = new THREE.Group();
  root.position.set(-center.x, -box.min.y, -center.z);
  wrapper.add(root);
  wrapper.scale.setScalar(factor);
  const outer = new THREE.Group();
  outer.add(wrapper);
  return outer;
}

export function unitScale(maxDimension: number): number {
  if (!Number.isFinite(maxDimension) || maxDimension <= 0) return 1;
  if (maxDimension > 2000) return 0.001; // millimeters
  if (maxDimension > 40) return 0.01; // centimeters
  if (maxDimension < 0.02) return 1 / maxDimension; // tiny: make it about 1 m
  return 1;
}

/** Stores an imported file and returns its blob key. Parses it first so bad files fail early. */
export async function importModelFile(file: File): Promise<{ blob: string; format: AssetFormat }> {
  const format = formatOf(file.name);
  if (!format) throw new Error('Choose an .obj, .gltf, or .glb file.');
  if (file.size > MAX_MODEL_BYTES) throw new Error('That model is over 50 MB. Simplify it before importing.');
  const data = await file.arrayBuffer();
  try {
    await parseModel(data.slice(0), format);
  } catch (err) {
    const hint = format === 'gltf' ? ' A .gltf must have its textures and buffers embedded; .glb files always work.' : '';
    throw new Error(`Couldn't read that model.${hint}`, { cause: err });
  }
  const key = await hashBytes(data);
  await putBlob(key, new Blob([data]));
  return { blob: key, format };
}

const loaded = new Map<string, Promise<THREE.Object3D>>();

/** Loads a stored model once and returns a fresh copy for each use. */
export async function loadAsset(blob: string, format: AssetFormat): Promise<THREE.Object3D> {
  let p = loaded.get(blob);
  if (!p) {
    p = (async () => {
      const stored = await getBlob(blob);
      if (!stored) throw new Error('This model is missing from storage.');
      return parseModel(await stored.arrayBuffer(), format);
    })();
    loaded.set(blob, p);
    p.catch(() => loaded.delete(blob));
  }
  return (await p).clone(true);
}

/** Builds any object source, loading imported models from storage. */
export async function buildSource(source: ObjectSource): Promise<THREE.Object3D> {
  if (source.kind === 'asset') return loadAsset(source.blob, source.format);
  return buildStatic(source);
}
