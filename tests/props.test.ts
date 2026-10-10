import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { emptyHistory, runCommand } from '../src/state/commands';
import { createProject, projectSchema } from '../src/state/schema';
import { importScript } from '../src/story/commands';
import { SAMPLE_SCRIPT } from '../src/story/sample';
import { addProp, deleteProp, suggestProps, updateProp } from '../src/props/commands';
import { createStage, placeProp } from '../src/staging/commands';
import { buildComposite, buildStatic } from '../src/three/library';

describe('props', () => {
  const [base] = runCommand(createProject('T'), emptyHistory(), importScript(SAMPLE_SCRIPT));

  it('suggests props mentioned in action lines', () => {
    const items = suggestProps(base).map((s) => s.item);
    expect(items).toEqual(expect.arrayContaining(['envelope', 'glass']));
    expect(suggestProps(base).find((s) => s.item === 'envelope')!.mentions).toBe(3);
  });

  it('stops suggesting props that are already in the project', () => {
    const [p] = runCommand(base, emptyHistory(), addProp({ kind: 'library', item: 'envelope' }));
    expect(suggestProps(p).map((s) => s.item)).not.toContain('envelope');
  });

  it('adds, renames, scales and deletes props with unique names', () => {
    let [p, h] = runCommand(base, emptyHistory(), addProp({ kind: 'library', item: 'glass' }, undefined, 'g1'));
    [p, h] = runCommand(p, h, addProp({ kind: 'library', item: 'glass' }, undefined, 'g2'));
    expect(p.props.map((x) => x.name)).toEqual(['Glass', 'Glass 2']);
    [p, h] = runCommand(p, h, updateProp('g1', { name: 'Whiskey glass', defaultScale: 1.2 }));
    expect(p.props[0]).toMatchObject({ name: 'Whiskey glass', defaultScale: 1.2 });
    [p, h] = runCommand(p, h, deleteProp('g2'));
    expect(p.props).toHaveLength(1);
  });

  it('places a prop on a stage with its scale and a link back', () => {
    let [p, h] = runCommand(base, emptyHistory(), addProp({ kind: 'library', item: 'phone' }, 'Burner', 'ph'));
    [p, h] = runCommand(p, h, updateProp('ph', { defaultScale: 2, grey: 0.2 }));
    [p, h] = runCommand(p, h, createStage('Bar', [], 'st'));
    [p, h] = runCommand(p, h, placeProp('st', p.props[0], [1, 0, 1], 'o1'));
    expect(p.stages[0].objects[0]).toMatchObject({ name: 'Burner', propId: 'ph', grey: 0.2, transform: { scale: [2, 2, 2], position: [1, 0, 1] } });
    [p] = runCommand(p, h, deleteProp('ph'));
    expect(p.stages[0].objects[0].propId).toBeUndefined();
    // Still a valid project after all that.
    expect(() => projectSchema.parse(p)).not.toThrow();
  });
});

describe('composite models', () => {
  it('builds shapes at their sizes and sets the result on the floor', () => {
    const g = buildComposite([
      { shape: 'cylinder', size: [0.1, 0.2, 0.1], position: [0, 0.1, 0] },
      { shape: 'torus', size: [0.08, 0.015, 0.08], position: [0.07, 0.1, 0], rotation: [90, 0, 0] },
    ]);
    g.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(g);
    expect(box.min.y).toBeCloseTo(0, 5);
    expect(box.max.y).toBeCloseTo(0.2, 2);
    expect(box.max.x).toBeGreaterThan(0.1);
  });

  it('builds through the common entry point', () => {
    const g = buildStatic({ kind: 'composite', nodes: [{ shape: 'box', size: [1, 2, 3], position: [0, 5, 0] }] });
    const size = new THREE.Box3().setFromObject(g).getSize(new THREE.Vector3());
    expect(size.toArray().map((v) => Math.round(v))).toEqual([1, 2, 3]);
  });

  it('rejects invalid composites when loading a project', () => {
    const p = createProject('T');
    const bad = { ...p, props: [{ id: 'x', name: 'X', defaultScale: 1, source: { kind: 'composite', nodes: [] } }] };
    expect(() => projectSchema.parse(bad)).toThrow();
  });
});
