import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { buildMannequin } from '../src/three/mannequin';
import { POSES, type Build, type Sex } from '../src/state/schema';

const base = { heightCm: 175, sex: 'other' as Sex, build: 'average' as Build };
const bounds = (o: THREE.Object3D) => {
  o.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(o);
};
const worldPos = (root: THREE.Object3D, name: string) => {
  root.updateMatrixWorld(true);
  return root.getObjectByName(name)!.getWorldPosition(new THREE.Vector3());
};

describe('mannequin', () => {
  it('matches the character height and stands on the floor', () => {
    for (const heightCm of [120, 160, 175, 200]) {
      const b = bounds(buildMannequin({ ...base, heightCm }));
      expect(b.max.y).toBeCloseTo(heightCm / 100, 1);
      expect(Math.abs(b.min.y)).toBeLessThan(0.02);
    }
  });

  it('faces +Z: nose and eyes are in front of the head', () => {
    const m = buildMannequin(base);
    const head = worldPos(m, 'head');
    expect(worldPos(m, 'nose').z).toBeGreaterThan(head.z + 0.05);
  });

  it('has its left side at +X', () => {
    const m = buildMannequin(base);
    expect(worldPos(m, 'shoulderL').x).toBeGreaterThan(0);
    expect(worldPos(m, 'hipR').x).toBeLessThan(0);
  });

  it('gives men wider shoulders and heavier builds more girth', () => {
    const w = (sex: Sex, build: Build = 'average') => {
      const b = bounds(buildMannequin({ ...base, sex, build }).getObjectByName('chest')!);
      return b.max.x - b.min.x;
    };
    expect(w('male')).toBeGreaterThan(w('female'));
    expect(w('other', 'heavy')).toBeGreaterThan(w('other', 'slim'));
  });

  it('poses change the silhouette but keep the body on or above the floor', () => {
    const standing = bounds(buildMannequin(base, 'standing'));
    for (const pose of POSES) {
      const b = bounds(buildMannequin(base, pose));
      expect(b.min.y, pose).toBeGreaterThan(-0.05);
      if (pose === 'sitting') expect(b.max.y).toBeLessThan(standing.max.y - 0.2);
      if (pose === 'lying') expect(b.max.y).toBeLessThan(0.5);
    }
  });

  it('sitting puts the knees at about seat height with feet on the floor', () => {
    const m = buildMannequin(base, 'sitting');
    const knee = worldPos(m, 'kneeL');
    expect(knee.y).toBeGreaterThan(0.4);
    expect(knee.y).toBeLessThan(0.6);
    expect(knee.z).toBeGreaterThan(0.3); // thighs point forward
  });

  it('adds a floor marker only when tinted', () => {
    expect(buildMannequin(base).getObjectByName('marker')).toBeUndefined();
    expect(buildMannequin({ ...base, tint: '#6aa6ff' }).getObjectByName('marker')).toBeDefined();
  });
});
