import { describe, expect, it, vi } from 'vitest';
import { emptyHistory, runCommand, type Command, type History } from '../src/state/commands';
import type { Project } from '../src/state/schema';
import { runTool, toolsFor, type ToolContext } from '../src/ai/tools';
import { checkCoverage, lineSide, viewBlocker } from '../src/shots/coverage';
import { effectiveShot } from '../src/shots/setup';
import { cameraPosition } from '../src/three/camera';
import { coldCoffee } from './fixtures/coldCoffee';
import { CAFE_BLOCKING, CAFE_COVERAGE } from './fixtures/cafePlan';

function harness() {
  let project = coldCoffee();
  let history: History = emptyHistory();
  const ctx = {
    project: () => project,
    dispatch: (cmd: Command) => void ([project, history] = runCommand(project, history, cmd)),
    step: 'shots', stageId: () => undefined, setStage: vi.fn(), navigate: vi.fn(), snapshot: async () => null, attachImage: vi.fn(),
  } as ToolContext;
  const tools = toolsFor('shots', false);
  const call = (name: string, args: object) => runTool(tools, name, JSON.stringify(args), ctx);
  return { get: () => project, call };
}

async function planned() {
  const h = harness();
  expect(await h.call('block_shots', CAFE_BLOCKING)).toMatch(/No problems found/);
  const r = await h.call('cover_shots', CAFE_COVERAGE);
  return { ...h, report: r };
}

/** Recover one shot with a different framing, keeping the plan's line. */
const recover = (h: Awaited<ReturnType<typeof planned>>, shot: object) => h.call('cover_shots', { line: CAFE_COVERAGE.line, shots: [shot] });

const ids = (p: Project, from: string, to: string) => {
  const i = p.shots.findIndex((s) => s.number === from), j = p.shots.findIndex((s) => s.number === to);
  return p.shots.slice(i, j + 1).map((s) => s.id);
};
const opening = (p: Project) => checkCoverage(p, ids(p, '1.1', '1.11'));
const camPos = (p: Project, n: string) => cameraPosition(effectiveShot(p, p.shots.find((s) => s.number === n)!.id)!.camera.start);

describe('lineSide', () => {
  it('is positive on the left of a→b, negative on the right, zero on the line', () => {
    // Looking from the origin toward +X, -Z is on the left.
    expect(lineSide([0, 0, 0], [1, 0, 0], [0.5, 0, -2])).toBeCloseTo(2);
    expect(lineSide([0, 0, 0], [1, 0, 0], [0.5, 0, 1])).toBeCloseTo(-1);
    expect(lineSide([0, 0, 0], [1, 0, 0], [3, 0, 0])).toBeCloseTo(0);
  });
});

describe('cover_shots and check_coverage on the cafe', () => {
  it('covers the opening with no errors or warnings', async () => {
    const h = await planned();
    expect(h.report).toMatch(/^Covered shots 1\.1, 1\.2, .*1\.11\./);
    const { shots, findings } = opening(h.get());
    expect(findings.filter((f) => f.severity !== 'info')).toEqual([]);
    const at = (n: string) => shots.find((s) => s.number === n)!;
    const name = (id?: string) => h.get().characters.find((c) => c.id === id)?.name;
    expect([at('1.3').kind, name(at('1.3').subject)]).toEqual(['ots', 'Ben']);
    expect([at('1.4').kind, at('1.4').size]).toEqual(['single', 'MCU']);
    expect([at('1.8').size, at('1.8').lens]).toEqual(['CU', 85]);
    expect(at('1.9').kind).toBe('group');
    expect(at('1.10').kind).toBe('insert');
    expect(at('1.2').moving).toBe(true);
    // Every shot with both leads is on one side of the line.
    expect(new Set(shots.filter((s) => s.side !== undefined && s.kind !== 'insert').map((s) => s.side))).toEqual(new Set([-1]));
  });

  it('keeps singles of both leads on the chosen side of the room', async () => {
    const h = await planned();
    // Nora (z -1.85) looks at Ben (z -0.55): her left is +X, away from the wall at x = -3.
    for (const n of ['1.4', '1.7', '1.8', '1.11']) expect(camPos(h.get(), n).x).toBeGreaterThan(-1.5);
    await recover(h, { number: '1.7', subjects: ['Nora'], size: 'MCU', angle: 35 });
    expect(camPos(h.get(), '1.7').x).toBeGreaterThan(-1.5);
  });

  it('flags a camera that crosses the line (C1)', async () => {
    const h = await planned();
    await h.call('cover_shots', { line: { ...CAFE_COVERAGE.line, side: 'right' }, shots: [{ number: '1.7', subjects: ['Nora'], size: 'MCU', angle: 35 }] });
    const c1 = opening(h.get()).findings.filter((f) => f.rule === 'C1');
    // Over the line and back again.
    expect(c1.map((f) => [f.at, f.severity])).toEqual([['1.6→1.7', 'error'], ['1.7→1.8', 'error']]);
  });

  it('allows a crossing after an insert (C2)', async () => {
    const h = await planned();
    await h.call('cover_shots', { line: { ...CAFE_COVERAGE.line, side: 'right' }, shots: [{ number: '1.11', subjects: ['Nora'], size: 'CU', angle: 25, lens: 85 }] });
    expect(opening(h.get()).findings.filter((f) => f.rule === 'C1')).toEqual([]);
  });

  it('flags a jump cut (C4) and a cut that changes one thing (C3)', async () => {
    const h = await planned();
    await recover(h, { number: '1.7', subjects: ['Ben'], size: 'MCU', angle: 30 });
    expect(opening(h.get()).findings).toContainEqual(expect.objectContaining({ at: '1.6→1.7', rule: 'C4', severity: 'error' }));
    await recover(h, { number: '1.6', subjects: ['Ben'], size: 'MS', angle: 35 });
    await recover(h, { number: '1.7', subjects: ['Ben'], size: 'CU', angle: 35 });
    const f = opening(h.get()).findings.find((x) => x.at === '1.6→1.7');
    expect(f).toMatchObject({ rule: 'C3', severity: 'warning', message: expect.stringMatching(/^only size changes/) });
  });

  it('notes mismatched reverses (C7) and long lenses on wide shots (C11)', async () => {
    const h = await planned();
    await recover(h, { number: '1.1', subjects: ['Nora'], size: 'WS', lens: 85 });
    await recover(h, { number: '1.7', subjects: ['Nora'], size: 'MCU', angle: 35, lens: 85 });
    const { findings } = opening(h.get());
    expect(findings).toContainEqual(expect.objectContaining({ at: '1.1', rule: 'C11', severity: 'info' }));
    expect(findings).toContainEqual(expect.objectContaining({ at: '1.6/1.7', rule: 'C7', message: expect.stringMatching(/lens 50\/85 mm/) }));
  });

  it('pulls a camera in front of a wall, and reports one it cannot fix', async () => {
    const h = await planned();
    const p = h.get();
    const eff = effectiveShot(p, p.shots.find((s) => s.number === '1.3')!.id)!;
    // The over-the-shoulder from behind Nora would be outside the back wall; cover_shots brought it in.
    expect(viewBlocker(p, eff, eff.camera.start)).toBeUndefined();
    expect(eff.camera.start.lens).toBeLessThan(50);
    expect(viewBlocker(p, eff, { ...eff.camera.start, azimuth: 180, distance: 4 })).toBe('the back wall of Cafe');
    expect(viewBlocker(p, eff, { ...eff.camera.start, azimuth: 0, distance: 6 })).toBeUndefined(); // the front is open
  });

  it('reports what each shot shows, and checks names first', async () => {
    const h = await planned();
    expect(await h.call('check_coverage', { shots: ['1.3'] })).toMatch(/^1\.1: WS single on Nora[\s\S]*1\.3: MS on Ben over Nora, right of Ben→Nora[\s\S]*Coverage check:/);
    const before = h.get();
    expect(await h.call('cover_shots', { shots: [{ number: '1.4', subjects: ['Ben'], size: 'CU' }, { number: '1.1', subjects: ['Ben'], size: 'CU' }] })).toMatch(/^Error: Shot 1\.1: "Ben" isn't in the shot/);
    expect(await h.call('cover_shots', { shots: [{ number: '1.10', subjects: [], size: 'CU' }] })).toMatch(/give subjects, or "on" for an insert/);
    expect(h.get()).toBe(before);
  });
});
