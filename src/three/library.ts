import * as THREE from 'three';
import type { LibraryItem, PrimitiveShape } from '../state/schema';
import { glassMaterial, greyMaterial } from './materials';

/**
 * Procedural grey-box models. Units are meters, Y is up, the origin is on the
 * floor at the object's center, and the "front" of an object faces +Z.
 */

export interface ParamDef {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  default: number;
}

export interface ItemDef {
  label: string;
  params: ParamDef[];
  build: (p: Record<string, number>) => THREE.Group;
}

const P = (key: string, label: string, def: number, min: number, max: number, step = 0.05): ParamDef => ({ key, label, default: def, min, max, step });

function part(geometry: THREE.BufferGeometry, shade: number, x = 0, y = 0, z = 0): THREE.Mesh {
  const mesh = new THREE.Mesh(geometry, greyMaterial(shade));
  mesh.position.set(x, y, z);
  mesh.userData.shade = shade;
  return mesh;
}

/** A box whose bottom sits at `y`. */
function box(w: number, h: number, d: number, shade: number, x = 0, y = 0, z = 0): THREE.Mesh {
  return part(new THREE.BoxGeometry(w, h, d), shade, x, y + h / 2, z);
}

function cyl(rTop: number, rBottom: number, h: number, shade: number, x = 0, y = 0, z = 0, segments = 20): THREE.Mesh {
  return part(new THREE.CylinderGeometry(rTop, rBottom, h, segments), shade, x, y + h / 2, z);
}

function group(...children: THREE.Object3D[]): THREE.Group {
  const g = new THREE.Group();
  g.add(...children);
  return g;
}

function glass(mesh: THREE.Mesh): THREE.Mesh {
  mesh.material = glassMaterial();
  mesh.userData.glass = true;
  mesh.castShadow = false;
  return mesh;
}

export const LIBRARY: Record<LibraryItem, ItemDef> = {
  table: {
    label: 'Table',
    params: [P('width', 'Width', 1.4, 0.4, 4), P('depth', 'Depth', 0.8, 0.4, 2), P('height', 'Height', 0.75, 0.4, 1.2)],
    build: ({ width: w, depth: d, height: h }) => {
      const top = 0.04;
      const leg = 0.06;
      const lx = w / 2 - leg, lz = d / 2 - leg;
      return group(
        box(w, top, d, 0.78, 0, h - top),
        ...[[-lx, -lz], [lx, -lz], [-lx, lz], [lx, lz]].map(([x, z]) => box(leg, h - top, leg, 0.55, x, 0, z)),
      );
    },
  },
  chair: {
    label: 'Chair',
    params: [P('seatHeight', 'Seat height', 0.45, 0.3, 0.8)],
    build: ({ seatHeight: h }) => {
      const s = 0.45, leg = 0.04, seat = 0.04, l = s / 2 - leg / 2;
      return group(
        box(s, seat, s, 0.72, 0, h - seat),
        ...[[-l, -l], [l, -l], [-l, l], [l, l]].map(([x, z]) => box(leg, h - seat, leg, 0.5, x, 0, z)),
        box(s, 0.45, 0.04, 0.68, 0, h, -s / 2 + 0.02),
      );
    },
  },
  door: {
    label: 'Door',
    params: [P('width', 'Width', 0.9, 0.6, 2), P('height', 'Height', 2.1, 1.8, 3)],
    build: ({ width: w, height: h }) => {
      const f = 0.06, depth = 0.14;
      return group(
        box(f, h + f, depth, 0.85, -w / 2 - f / 2),
        box(f, h + f, depth, 0.85, w / 2 + f / 2),
        box(w + 2 * f, f, depth, 0.85, 0, h),
        box(w, h, 0.04, 0.62),
        part(new THREE.SphereGeometry(0.035, 12, 8), 0.3, w / 2 - 0.1, 1.0, 0.05),
      );
    },
  },
  window: {
    label: 'Window',
    params: [P('width', 'Width', 1.2, 0.4, 4), P('height', 'Height', 1.2, 0.4, 2.5), P('sill', 'Sill height', 0.9, 0, 2)],
    build: ({ width: w, height: h, sill }) => {
      const f = 0.06, depth = 0.12;
      return group(
        box(w + 2 * f, f, depth + 0.06, 0.85, 0, sill - f, 0.03),
        box(w + 2 * f, f, depth, 0.85, 0, sill + h),
        box(f, h, depth, 0.85, -w / 2 - f / 2, sill),
        box(f, h, depth, 0.85, w / 2 + f / 2, sill),
        box(0.03, h, 0.04, 0.85, 0, sill),
        glass(box(w, h, 0.01, 0.9, 0, sill)),
      );
    },
  },
  bar: {
    label: 'Bar',
    params: [P('length', 'Length', 3, 1, 10, 0.1), P('height', 'Height', 1.05, 0.8, 1.3)],
    build: ({ length: l, height: h }) => {
      const d = 0.6, top = 0.05;
      const rail = part(new THREE.CylinderGeometry(0.02, 0.02, l, 12), 0.35, 0, 0.2, d / 2);
      rail.rotation.z = Math.PI / 2;
      return group(box(l, h - top, d - 0.1, 0.5, 0, 0, -0.05), box(l + 0.1, top, d + 0.1, 0.8, 0, h - top), rail);
    },
  },
  stool: {
    label: 'Bar stool',
    params: [P('height', 'Seat height', 0.75, 0.45, 0.9)],
    build: ({ height: h }) =>
      group(cyl(0.2, 0.2, 0.02, 0.4), cyl(0.025, 0.025, h - 0.05, 0.45, 0, 0.02), cyl(0.18, 0.18, 0.05, 0.75, 0, h - 0.05), cyl(0.15, 0.15, 0.015, 0.4, 0, 0.3)),
  },
  bottle: {
    label: 'Bottle',
    params: [P('height', 'Height', 0.3, 0.15, 0.5, 0.01)],
    build: ({ height: h }) => {
      const r = h * 0.12;
      const pts = [
        [0, 0], [r, 0], [r, h * 0.62], [r * 0.4, h * 0.78], [r * 0.32, h * 0.98], [r * 0.38, h], [0, h],
      ].map(([x, y]) => new THREE.Vector2(x, y));
      return group(part(new THREE.LatheGeometry(pts, 16), 0.35));
    },
  },
  mug: {
    label: 'Mug',
    params: [],
    build: () => {
      const handle = part(new THREE.TorusGeometry(0.03, 0.008, 8, 16, Math.PI), 0.8, 0.045, 0.05, 0);
      handle.rotation.z = -Math.PI / 2;
      return group(cyl(0.04, 0.038, 0.1, 0.8), handle);
    },
  },
  wall: {
    label: 'Wall',
    params: [P('width', 'Width', 4, 0.5, 20, 0.1), P('height', 'Height', 2.8, 1, 6, 0.1)],
    build: ({ width: w, height: h }) => group(box(w, h, 0.12, 0.82)),
  },
  room: {
    label: 'Room',
    params: [P('width', 'Width', 6, 2, 30, 0.5), P('depth', 'Depth', 5, 2, 30, 0.5), P('height', 'Height', 2.8, 2, 8, 0.1)],
    build: ({ width: w, depth: d, height: h }) => {
      const t = 0.12;
      const floor = part(new THREE.PlaneGeometry(w, d), 0.6, 0, 0.002, 0);
      floor.rotation.x = -Math.PI / 2;
      floor.userData.floor = true;
      // Open at the front (+Z) so the camera can see in.
      return group(floor, box(w, h, t, 0.82, 0, 0, -d / 2 - t / 2), box(t, h, d, 0.78, -w / 2 - t / 2), box(t, h, d, 0.78, w / 2 + t / 2));
    },
  },
};

export const PRIMITIVES: Record<PrimitiveShape, ItemDef> = {
  box: {
    label: 'Box',
    params: [P('width', 'Width', 1, 0.05, 20), P('height', 'Height', 1, 0.05, 20), P('depth', 'Depth', 1, 0.05, 20)],
    build: ({ width, height, depth }) => group(box(width, height, depth, 0.7)),
  },
  cylinder: {
    label: 'Cylinder',
    params: [P('radius', 'Radius', 0.5, 0.02, 10), P('height', 'Height', 1, 0.02, 20)],
    build: ({ radius, height }) => group(cyl(radius, radius, height, 0.7, 0, 0, 0, 24)),
  },
  sphere: {
    label: 'Sphere',
    params: [P('radius', 'Radius', 0.5, 0.02, 10)],
    build: ({ radius }) => group(part(new THREE.SphereGeometry(radius, 24, 16), 0.7, 0, radius)),
  },
  cone: {
    label: 'Cone',
    params: [P('radius', 'Radius', 0.5, 0.02, 10), P('height', 'Height', 1, 0.02, 20)],
    build: ({ radius, height }) => group(cyl(0, radius, height, 0.7, 0, 0, 0, 24)),
  },
  plane: {
    label: 'Floor',
    params: [P('width', 'Width', 4, 0.1, 50, 0.1), P('depth', 'Depth', 4, 0.1, 50, 0.1)],
    build: ({ width, depth }) => {
      const m = part(new THREE.PlaneGeometry(width, depth), 0.6, 0, 0.002);
      m.rotation.x = -Math.PI / 2;
      m.userData.floor = true;
      return group(m);
    },
  },
};

export function itemDef(source: { kind: 'library'; item: LibraryItem } | { kind: 'primitive'; shape: PrimitiveShape }): ItemDef {
  return source.kind === 'library' ? LIBRARY[source.item] : PRIMITIVES[source.shape];
}

export function resolveParams(def: ItemDef, params?: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of def.params) {
    const v = params?.[p.key];
    out[p.key] = typeof v === 'number' && Number.isFinite(v) ? Math.min(p.max, Math.max(p.min, v)) : p.default;
  }
  return out;
}

/** Builds a library item or primitive with shadows set up. */
export function buildItem(source: Parameters<typeof itemDef>[0] & { params?: Record<string, number> }): THREE.Group {
  const def = itemDef(source);
  const g = def.build(resolveParams(def, source.params));
  g.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.castShadow = !m.userData.glass && !m.userData.floor;
    m.receiveShadow = true;
    // Floors don't take taps, so tapping the ground clears the selection
    // instead of selecting the room. Rooms are picked by their walls or the list.
    if (m.userData.floor) m.raycast = () => {};
  });
  return g;
}
