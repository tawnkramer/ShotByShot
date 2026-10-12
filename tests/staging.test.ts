import { describe, expect, it } from 'vitest';
import { emptyHistory, runCommand, undo } from '../src/state/commands';
import { createProject, type Project, type Stage } from '../src/state/schema';
import { addObject, createStage, createStagesForScenes, deleteStage, duplicateObject, eulerDegrees, IDENTITY, quatFromDegrees, removeObject, stageNameFromScene, uniqueName, updateObject } from '../src/staging/commands';
import { freeSpot, worldRect } from '../src/staging/placement';
import { importScript } from '../src/story/commands';
import { SAMPLE_SCRIPT } from '../src/story/sample';
import { LIBRARY, PRIMITIVES, buildItem } from '../src/three/library';
import { unitScale } from '../src/three/assets';
import * as THREE from 'three';

function run(p: Project, ...cmds: Parameters<typeof runCommand>[2][]) {
  let h = emptyHistory();
  for (const c of cmds) [p, h] = runCommand(p, h, c);
  return [p, h] as const;
}

describe('stage names', () => {
  it('derives a location name from a scene heading', () => {
    expect(stageNameFromScene('INT. DOCKSIDE BAR - NIGHT')).toBe('Dockside Bar');
    expect(stageNameFromScene('EXT. DOCKS - CONTINUOUS')).toBe('Docks');
    expect(stageNameFromScene('INT./EXT. CAR – MOVING')).toBe('Car');
  });

  it('numbers duplicate names', () => {
    expect(uniqueName([{ name: 'Chair' }, { name: 'Chair 2' }], 'Chair')).toBe('Chair 3');
    expect(uniqueName([], 'Chair')).toBe('Chair');
  });
});

describe('stage commands', () => {
  it('creates one stage per location, sharing repeated locations', () => {
    // The sample plus a return to the bar, so one location has two scenes.
    const [p] = run(createProject('T'), importScript(`${SAMPLE_SCRIPT}\nINT. DOCKSIDE BAR - LATER\n\nThe bar is dark.\n`));
    const { command, ids } = createStagesForScenes(p);
    const [q] = run(p, command);
    expect(q.stages.map((s) => s.name)).toEqual(['Dockside Bar', 'Docks']);
    expect(q.stages[0].sceneLineIds).toHaveLength(2);
    expect(ids).toHaveLength(2);
    // Running again creates nothing new.
    const again = createStagesForScenes(q);
    expect(again.ids).toHaveLength(0);
  });

  it('adds, edits, duplicates, removes and undoes objects', () => {
    const [p, h] = run(createProject('T'), createStage('Bar', [], 'st'), addObject('st', { kind: 'library', item: 'chair' }, IDENTITY, 'c1'));
    expect(p.stages[0].objects[0].name).toBe('Chair');
    const [p2] = runCommand(p, h, updateObject('st', 'c1', { transform: { position: [1, 0, 2] }, params: { seatHeight: 0.5 }, grey: 0.3 }));
    const chair = p2.stages[0].objects[0];
    expect(chair.transform.position).toEqual([1, 0, 2]);
    expect(chair.grey).toBe(0.3);
    expect(chair.source.kind === 'library' && chair.source.params?.seatHeight).toBe(0.5);
    const [p3] = run(p2, duplicateObject('st', 'c1', 'c2'));
    expect(p3.stages[0].objects[1]).toMatchObject({ id: 'c2', name: 'Chair 2', transform: { position: [1.5, 0, 2.5] } });
    const [p4, h4] = run(p3, removeObject('st', 'c1'));
    expect(p4.stages[0].objects.map((o) => o.id)).toEqual(['c2']);
    expect(undo(p4, h4)[0].stages[0].objects).toHaveLength(2);
  });

  it('unlinks shots from a deleted stage', () => {
    const [p] = run(createProject('T'), importScript('A.'), createStage('Bar', [], 'st'));
    const withShot = { ...p, shots: p.shots.map((s) => ({ ...s, stageId: 'st' })) };
    const [q] = run(withShot, deleteStage('st'));
    expect(q.stages).toHaveLength(0);
    expect(q.shots[0].stageId).toBeUndefined();
  });
});

describe('rotation helpers', () => {
  it('round-trips degrees through quaternions', () => {
    const t = { ...IDENTITY, rotation: quatFromDegrees([0, 90, 0]) };
    expect(eulerDegrees(t)).toEqual([0, 90, 0]);
  });
});

describe('library', () => {
  it('builds every item sitting on the floor with sensible size', () => {
    for (const [key, def] of [...Object.entries(LIBRARY), ...Object.entries(PRIMITIVES)]) {
      const source = key in LIBRARY ? { kind: 'library' as const, item: key as keyof typeof LIBRARY } : { kind: 'primitive' as const, shape: key as keyof typeof PRIMITIVES };
      const g = buildItem(source);
      const box = new THREE.Box3().setFromObject(g);
      expect(box.isEmpty(), def.label).toBe(false);
      expect(box.min.y, def.label).toBeGreaterThanOrEqual(-0.001);
      expect(box.max.y, def.label).toBeLessThan(10);
    }
  });

  it('clamps parameters to their range', () => {
    const g = buildItem({ kind: 'library', item: 'table', params: { width: 99 } });
    const box = new THREE.Box3().setFromObject(g);
    expect(box.max.x - box.min.x).toBeCloseTo(4, 1);
  });
});

describe('placement', () => {
  const stage = (objects: Stage['objects']): Stage => ({ id: 's', name: 'S', sceneLineIds: [], objects });

  it('puts rooms at the origin and other objects clear of obstacles', () => {
    const bar = { id: 'b', name: 'Bar', transform: IDENTITY, source: { kind: 'library' as const, item: 'bar' as const } };
    const room = { id: 'r', name: 'Room', transform: IDENTITY, source: { kind: 'library' as const, item: 'room' as const } };
    const s = stage([room, bar]);
    expect(freeSpot(s, { kind: 'library', item: 'room' })).toEqual([0, 0, 0]);
    const spot = freeSpot(s, { kind: 'library', item: 'stool' });
    const stool = worldRect({ source: { kind: 'library', item: 'stool' }, transform: { ...IDENTITY, position: spot } });
    const b = worldRect(bar);
    const overlaps = stool.maxX > b.minX && stool.minX < b.maxX && stool.maxZ > b.minZ && stool.minZ < b.maxZ;
    expect(overlaps).toBe(false);
  });

  it('accounts for rotation', () => {
    const rotated = worldRect({ source: { kind: 'library', item: 'bar' }, transform: { ...IDENTITY, rotation: quatFromDegrees([0, 90, 0]) } });
    expect(rotated.maxZ - rotated.minZ).toBeGreaterThan(rotated.maxX - rotated.minX);
  });
});

describe('model units', () => {
  it('guesses centimeters and millimeters', () => {
    expect(unitScale(180)).toBe(0.01);
    expect(unitScale(1800 * 2)).toBe(0.001);
    expect(unitScale(1.8)).toBe(1);
  });
});
