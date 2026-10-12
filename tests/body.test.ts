import { describe, expect, it, vi } from 'vitest';
import { emptyHistory, runCommand, type Command, type History } from '../src/state/commands';
import { addObject, quatFromDegrees } from '../src/staging/commands';
import { runTool, toolsFor, type ToolContext } from '../src/ai/tools';
import { seatAt, bodyPosition } from '../src/shots/body';
import { effectiveShot, subjectsFor } from '../src/shots/setup';
import { checkCoverage } from '../src/shots/coverage';
import { coldCoffee } from './fixtures/coldCoffee';

/** The cafe with a bar stool by the counter, and Ben on it in shot 1.3. */
async function onStool(pose = 'sitting', at: { x: number; z: number; yaw?: number } = { x: 1.5, z: -0.6, yaw: 0 }) {
  let p = coldCoffee();
  let h: History = emptyHistory();
  const run = (c: Command) => void ([p, h] = runCommand(p, h, c));
  run(addObject(p.stages[0].id, { kind: 'library', item: 'stool' }, { position: [1.5, 0, -0.6], rotation: quatFromDegrees([0, 0, 0]), scale: [1, 1, 1] }, undefined, 'Stool 1'));
  const ctx = { project: () => p, dispatch: run, step: 'shots', stageId: () => undefined, setStage: vi.fn(), navigate: vi.fn(), snapshot: async () => null, attachImage: vi.fn() } as ToolContext;
  const r = await runTool(toolsFor('shots', false), 'block_shots', JSON.stringify({ shots: [{ number: '1.3', actors: [{ name: 'Ben', start: { ...at, pose } }] }] }), ctx);
  const shot = p.shots.find((s) => s.number === '1.3')!;
  const eff = effectiveShot(p, shot.id)!;
  const stage = p.stages.find((s) => s.id === eff.stageId);
  const ben = p.characters.find((c) => c.name === 'Ben')!;
  return { p, r, eff, stage, ben, key: eff.setup.actors[0].motion.start, ctx };
}

describe('seats', () => {
  it('seats someone on a bar stool: raised to its seat, weight over its center', async () => {
    const { r, eff, stage, ben, key } = await onStool('sitting', { x: 1.55, z: -0.55, yaw: 90 });
    expect(r).not.toMatch(/inside Stool|no chair or stool/);
    expect(seatAt(stage, eff.setup.stageOverrides, 1.55, -0.55)?.top).toBeCloseTo(0.75);
    const [x, y, z] = bodyPosition(stage, eff.setup.stageOverrides, ben, key);
    // Ben (182 cm) rests his thighs at about 0.52 m on a chair, so a 0.75 m stool lifts him about 0.23 m.
    expect(y).toBeCloseTo(0.23, 1);
    // Facing +X, his hips settle 0.2 thigh (8.6 cm) behind the stool's center so his weight is over it.
    expect(x).toBeCloseTo(1.5 - 0.2 * 0.235 * 1.82, 3);
    expect(z).toBeCloseTo(-0.6, 3);
  });

  it('leaves chairs, standing people and anyone away from a seat alone', async () => {
    for (const [pose, at] of [['sitting', { x: -1.48, z: -0.55 }], ['standing', { x: 1.5, z: -0.6 }], ['sitting', { x: 0.5, z: 1 }]] as const) {
      const t = await onStool(pose, at);
      expect(bodyPosition(t.stage, t.eff.setup.stageOverrides, t.ben, t.key)).toEqual([at.x, 0, at.z]);
    }
  });

  it('frames and checks people at their seat height', async () => {
    const { p, eff, ctx } = await onStool();
    const [s] = subjectsFor(p, eff.setup, undefined, eff.stageId);
    expect(s.position[1]).toBeCloseTo(0.23, 1);
    expect(s.position[2]).toBeCloseTo(-0.6 - 0.2 * 0.235 * 1.82, 3); // facing +Z, settled back toward -Z
    await runTool(toolsFor('shots', false), 'cover_shots', JSON.stringify({ shots: [{ number: '1.3', subjects: ['Ben'], size: 'CU' }] }), ctx);
    const cam = effectiveShot(ctx.project(), p.shots.find((x) => x.number === '1.3')!.id)!.camera.start;
    // A closeup aims near the eyes: lift + 0.9 of a seated head height (1.82 × 0.79).
    expect(cam.target[1]).toBeCloseTo(0.23 + 0.9 * 1.82 * 0.79, 1);
    const c = checkCoverage(ctx.project(), [p.shots.find((x) => x.number === '1.3')!.id]).shots[0];
    expect([c.kind, c.size]).toEqual(['single', 'CU']);
  });

  it('lets the assistant raise someone onto something that is not a seat', async () => {
    const { ctx } = await onStool();
    await runTool(toolsFor('shots', false), 'block_shots', JSON.stringify({ shots: [{ number: '1.3', actors: [{ name: 'Ben', start: { x: 0.5, z: 1, y: 0.4, pose: 'standing' } }] }] }), ctx);
    const p = ctx.project();
    expect(effectiveShot(p, p.shots.find((x) => x.number === '1.3')!.id)!.setup.actors[0].motion.start.position).toEqual([0.5, 0.4, 1]);
  });
});

describe('platforms', () => {
  /** The cafe with a 0.4 m platform at the front, a raised plane beside it and a 3 m pillar. */
  async function onPlatform(at: { x: number; z: number }, pose = 'standing') {
    let p = coldCoffee();
    let h: History = emptyHistory();
    const run = (c: Command) => void ([p, h] = runCommand(p, h, c));
    const put = (shape: 'box' | 'plane' | 'cylinder', params: Record<string, number>, pos: [number, number, number], name: string) =>
      run(addObject(p.stages[0].id, { kind: 'primitive', shape, params }, { position: pos, rotation: quatFromDegrees([0, 0, 0]), scale: [1, 1, 1] }, undefined, name));
    put('box', { width: 2, height: 0.4, depth: 1 }, [0, 0, 1.5], 'Platform');
    put('plane', { width: 1, depth: 1 }, [2, 0.6, 1.5], 'Ledge');
    put('cylinder', { radius: 0.2, height: 3 }, [-2, 0, 1.5], 'Pillar');
    const ctx = { project: () => p, dispatch: run, step: 'shots', stageId: () => undefined, setStage: vi.fn(), navigate: vi.fn(), snapshot: async () => null, attachImage: vi.fn() } as ToolContext;
    const r = await runTool(toolsFor('shots', false), 'block_shots', JSON.stringify({ shots: [{ number: '1.3', actors: [{ name: 'Ben', start: { ...at, pose } }] }] }), ctx);
    const eff = effectiveShot(p, p.shots.find((s) => s.number === '1.3')!.id)!;
    const stage = p.stages.find((s) => s.id === eff.stageId);
    const ben = p.characters.find((c) => c.name === 'Ben')!;
    return { r, at: bodyPosition(stage, eff.setup.stageOverrides, ben, eff.setup.actors[0].motion.start) };
  }

  it('stands people on the top of a box or plane under them', async () => {
    const box = await onPlatform({ x: 0.3, z: 1.4 });
    expect(box.at).toEqual([0.3, 0.4, 1.4]);
    expect(box.r).not.toMatch(/inside Platform/);
    expect((await onPlatform({ x: 2, z: 1.5 })).at).toEqual([2, 0.6, 1.5]);
    expect((await onPlatform({ x: 0.3, z: 1.4 }, 'sitting')).at[1]).toBeCloseTo(0.4);
    expect((await onPlatform({ x: 0.5, z: 0.5 })).at).toEqual([0.5, 0, 0.5]);
  });

  it('treats tall shapes as obstacles, not floors', async () => {
    const pillar = await onPlatform({ x: -2, z: 1.5 });
    expect(pillar.at).toEqual([-2, 0, 1.5]);
    expect(pillar.r).toMatch(/Ben is inside Pillar/);
  });
});
