import * as THREE from 'three';

const cache = new Map<number, THREE.MeshStandardMaterial>();

/** Shared matte grey material. Shade 0 = black, 1 = white (quantized to 1%). */
export function greyMaterial(shade: number): THREE.MeshStandardMaterial {
  const key = Math.round(Math.min(1, Math.max(0, shade)) * 100);
  let m = cache.get(key);
  if (!m) {
    const v = key / 100;
    m = new THREE.MeshStandardMaterial({ color: new THREE.Color(v, v, v).convertSRGBToLinear(), roughness: 0.85, metalness: 0 });
    m.userData.shared = true;
    cache.set(key, m);
  }
  return m;
}

/** Glass-like grey for windows and bottles: lighter and see-through. */
let glass: THREE.MeshStandardMaterial | undefined;
export function glassMaterial(): THREE.MeshStandardMaterial {
  glass ??= Object.assign(new THREE.MeshStandardMaterial({ color: 0xd8d8d8, roughness: 0.2, transparent: true, opacity: 0.35, depthWrite: false }), {
    userData: { shared: true },
  });
  return glass;
}

/** Applies a single shade to every mesh under `root`, keeping glass parts see-through. */
export function applyGrey(root: THREE.Object3D, shade: number | undefined): void {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    if (mesh.userData.defaultShade === undefined) mesh.userData.defaultShade = mesh.userData.shade ?? 0.7;
    if (mesh.userData.glass) return;
    mesh.material = greyMaterial(shade ?? mesh.userData.defaultShade);
  });
}

/** Frees geometry (but not shared materials) under `root`. */
export function disposeObject(root: THREE.Object3D): void {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || mesh.userData.cachedAsset) return;
    mesh.geometry?.dispose();
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) if (m && !m.userData?.shared) m.dispose();
  });
}
