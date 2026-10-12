import { describe, expect, it, vi } from 'vitest';
import { emptyHistory, runCommand, type Command, type History } from '../src/state/commands';
import { addObject, quatFromDegrees } from '../src/staging/commands';
import { runTool, toolsFor, type ToolContext } from '../src/ai/tools';
import { seatLift, seatTop } from '../src/shots/seats';
import { effectiveShot, subjectsFor } from '../src/shots/setup';
import { checkCoverage } from '../src/shots/coverage';
import { coldCoffee } from './fixtures/coldCoffee';

/** The cafe with a bar stool by the counter, and Ben on it in shot 1.3. */
async function onStool(pose = 'sitting', at = { x: 1.5, z: -0.6 }) {
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
  it('raises someone sitting on a bar stool so they sit on its seat', async () => {
    const { r, eff, stage, ben, key } = await onStool();
    expect(r).not.toMatch(/inside Stool|no chair or stool/);
    expect(seatTop(stage, eff.setup.stageOverrides, 1.5, -0.6)).toBeCloseTo(0.75);
    // Ben (182 cm) rests his thighs at about 0.52 m on a chair, so a 0.75 m stool lifts him about 0.23 m.
    expect(seatLift(stage, eff.setup.stageOverrides, ben, key)).toBeCloseTo(0.23, 1);
  });

  it('leaves chairs, standing people and anyone away from a seat alone', async () => {
    const chair = await onStool('sitting', { x: -1.5, z: -0.55 });
    expect(seatLift(chair.stage, chair.eff.setup.stageOverrides, chair.ben, chair.key)).toBe(0);
    const standing = await onStool('standing');
    expect(seatLift(standing.stage, standing.eff.setup.stageOverrides, standing.ben, standing.key)).toBe(0);
    const away = await onStool('sitting', { x: 0.5, z: 1 });
    expect(seatLift(away.stage, away.eff.setup.stageOverrides, away.ben, away.key)).toBe(0);
  });

  it('frames and checks people at their seat height', async () => {
    const { p, eff, ctx } = await onStool();
    const [s] = subjectsFor(p, eff.setup, undefined, eff.stageId);
    expect(s.position[1]).toBeCloseTo(0.23, 1);
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
