import { describe, expect, it } from 'vitest';
import { emptyHistory, runCommand, type Command } from '../src/state/commands';
import { createProject, type Project } from '../src/state/schema';
import { importScript } from '../src/story/commands';
import { addCharacters } from '../src/characters/commands';
import { addObject, createStagesForScenes, IDENTITY } from '../src/staging/commands';
import { addProp } from '../src/props/commands';
import { addShotProp, setActorKey, setStageOverride } from '../src/shots/commands';
import { ShotRig } from '../src/three/shotRig';
import { shotThumbKey } from '../src/shots/thumbnail';

function setup(): [Project, string] {
  let [p, h] = runCommand(createProject('T'), emptyHistory(), importScript('INT. ROOM - DAY\n\nMAYA\nHi.\n\nDEX\nHey.'));
  const cmds: Command[] = [addCharacters(['Maya', 'Dex'], ['maya', 'dex']), createStagesForScenes(p).command];
  for (const c of cmds) [p, h] = runCommand(p, h, c);
  const stageId = p.stages[0].id;
  [p, h] = runCommand(p, h, addObject(stageId, { kind: 'library', item: 'table' }, IDENTITY, 'tbl'));
  [p, h] = runCommand(p, h, addProp({ kind: 'library', item: 'glass' }, 'Glass', 'glass'));
  return [p, p.shots[0].id];
}

describe('ShotRig', () => {
  it('builds the stage, characters and props for a shot', () => {
    const [p0, shotId] = setup();
    const [p] = runCommand(p0, emptyHistory(), addShotProp(shotId, 'glass', { position: [0, 0.75, 0], yaw: 0 }, 'sp'));
    const rig = new ShotRig();
    rig.sync(p, shotId);
    expect(rig.object('stage:tbl')).toBeDefined();
    expect(rig.object('actor:maya')).toBeDefined();
    expect(rig.object('prop:sp')).toBeDefined();
    const cam = rig.setTime(0);
    expect(cam).not.toBeNull();
    expect(rig.object('prop:sp')!.position.y).toBeCloseTo(0.75);
  });

  it('moves characters along their keyframes and walks between', () => {
    const [p0, shotId] = setup();
    const [p] = runCommand(p0, emptyHistory(), setActorKey(shotId, 'maya', 'end', { position: [-3, 0, 0] }));
    const rig = new ShotRig();
    rig.sync(p, shotId);
    rig.setTime(0);
    const start = rig.object('actor:maya')!.position.x;
    rig.setTime(1);
    expect(rig.object('actor:maya')!.position.x).toBeCloseTo(-3);
    rig.setTime(0.5);
    const mid = rig.object('actor:maya')!.position.x;
    expect(mid).toBeLessThan(start);
    expect(mid).toBeGreaterThan(-3);
  });

  it('applies per-shot stage changes and reuses unchanged objects', () => {
    const [p0, shotId] = setup();
    const rig = new ShotRig();
    rig.sync(p0, shotId);
    const table = rig.object('stage:tbl');
    const [p] = runCommand(p0, emptyHistory(), setStageOverride(shotId, 'tbl', { position: [2, 0, 0], hidden: true }));
    rig.sync(p, shotId);
    expect(rig.object('stage:tbl')).toBe(table);
    expect(table!.position.x).toBe(2);
    expect(table!.visible).toBe(false);
  });

  it('finds the rig id from any child mesh', () => {
    const [p, shotId] = setup();
    const rig = new ShotRig();
    rig.sync(p, shotId);
    const head = rig.object('actor:dex')!.getObjectByName('head')!;
    expect(rig.idOf(head)).toBe('actor:dex');
  });

  it('changes the thumbnail key when the shot changes', () => {
    const [p0, shotId] = setup();
    const [p] = runCommand(p0, emptyHistory(), setActorKey(shotId, 'maya', 'start', { yaw: 10 }));
    expect(shotThumbKey(p, shotId)).not.toBe(shotThumbKey(p0, shotId));
  });
});
