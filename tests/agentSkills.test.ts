import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { emptyHistory, runCommand, undo, type Command, type History } from '../src/state/commands';
import type { Project } from '../src/state/schema';
import { resetDbForTests, setSetting } from '../src/storage/db';
import { CHAT_MODEL_SETTING } from '../src/ai/chat';
import { MAX_ROUNDS, runTurn } from '../src/ai/agent';
import { runTool, toolsFor, type ToolContext } from '../src/ai/tools';
import { describeScene, systemPrompt } from '../src/ai/context';
import { matchSkill, skillById } from '../src/ai/skills';
import { effectiveShot } from '../src/shots/setup';
import { sheetLayout } from '../src/export/contactSheet';
import { coldCoffee } from './fixtures/coldCoffee';
import { responseStream, type ResponsesBody } from './fixtures/openaiStub';

function harness(p: Project, opts: { shotId?: string } = {}) {
  let project = p;
  let history: History = emptyHistory();
  const ctx: ToolContext = {
    project: () => project,
    dispatch: (cmd: Command) => void ([project, history] = runCommand(project, history, { ...cmd, tag: 'turn' })),
    step: 'shots',
    shotId: opts.shotId,
    stageId: () => project.stages[0]?.id,
    setStage: vi.fn(),
    navigate: vi.fn(),
    snapshot: async () => null,
    attachImage: vi.fn(),
    setSkill: vi.fn(),
    renderSheet: vi.fn(async () => 'data:image/jpeg;base64,AAAA'),
  };
  return {
    ctx,
    get: () => project,
    undoTurn: () => {
      while (history.past.at(-1)?.tag === 'turn') [project, history] = undo(project, history);
    },
  };
}

const shotId = (p: Project, n: string) => p.shots.find((s) => s.number === n)!.id;
const actorsOf = (p: Project, n: string) => {
  const eff = effectiveShot(p, shotId(p, n))!;
  return Object.fromEntries(eff.setup.actors.map((a) => [p.characters.find((c) => c.id === a.characterId)!.name, a.motion]));
};

/** Nora at the back chair facing the front chair; Ben comes in the door and sits opposite. */
const OPENING = {
  shots: [
    { number: '1.1', actors: [{ name: 'Nora', start: { x: -1.5, z: -1.85, pose: 'sitting', face: 'Front chair' } }], props: [{ prop: "Nora's mug", x: -1.6, z: -1.35, y: 0.75 }, { prop: "Ben's mug", x: -1.4, z: -1.05, y: 0.75 }] },
    {
      number: '1.2',
      actors: [
        { name: 'Nora', start: { x: -1.5, z: -1.85, pose: 'sitting', face: 'Front chair' } },
        { name: 'Ben', start: { x: 2.4, z: 1, pose: 'walking', yaw: -90 }, end: { x: -1.5, z: -0.55, pose: 'sitting', face: 'Nora' } },
      ],
    },
  ],
};

describe('skills', () => {
  it('loads Shot by Shot from a matching request in the shots step only', () => {
    expect(matchSkill('Block the scene.', 'shots')?.id).toBe('shot_by_shot');
    expect(matchSkill('Please stage these shots', 'shots')?.id).toBe('shot_by_shot');
    expect(matchSkill('Block the scene.', 'staging')).toBeUndefined();
    expect(matchSkill('Frame a close-up', 'shots')).toBeUndefined();
  });

  it('adds the skill text and the whole scene to the prompt when loaded', () => {
    const p = coldCoffee();
    const plain = systemPrompt(p, 'shots', {});
    expect(plain).not.toMatch(/Scene detail/);
    const prompt = systemPrompt(p, 'shots', { skill: 'shot_by_shot' });
    expect(prompt).toContain(skillById('shot_by_shot')!.text);
    expect(prompt).toMatch(/SCENE: INT\. CORNER CAFE - MORNING/);
    expect(prompt).toMatch(/Shot 1\.5 .*\n {2}BEN: You said we needed to talk\.\n {2}NORA: \(quietly\)\n {2}NORA: I took the job\. In Lisbon\./);
    expect(prompt).toMatch(/Back chair \(chair.*footprint x/);
    expect(prompt).toMatch(/Stage "Street" objects/);
    expect(prompt).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/);
  });

  it('starts the scene detail at the open shot and marks it', () => {
    const p = coldCoffee();
    const text = describeScene(p, { shotId: shotId(p, '3.1') });
    expect(text).not.toMatch(/Shot 1\.1/);
    expect(text).toMatch(/Shot 3\.1 .*\(open\)/);
  });

  it('offers use_skill, block_shots and render_shots in the shots step, in and out of the editor', async () => {
    for (const inEditor of [false, true]) {
      const names = toolsFor('shots', inEditor).map((t) => t.name);
      expect(names).toEqual(expect.arrayContaining(['use_skill', 'block_shots', 'render_shots']));
    }
    expect(toolsFor('staging', false).map((t) => t.name)).not.toContain('use_skill');
    const h = harness(coldCoffee());
    expect(await runTool(toolsFor('shots', false), 'use_skill', JSON.stringify({ id: 'shot_by_shot' }), h.ctx)).toMatch(/Loaded Shot by Shot/);
    expect(h.ctx.setSkill).toHaveBeenCalledWith('shot_by_shot');
  });
});

describe('block_shots', () => {
  it('blocks several shots, faces people, moves them, and places props', async () => {
    const h = harness(coldCoffee());
    const r = await runTool(toolsFor('shots', false), 'block_shots', JSON.stringify(OPENING), h.ctx);
    expect(r).toMatch(/^Blocked shots 1\.1, 1\.2\. No problems found\./);
    const p = h.get();
    const one = actorsOf(p, '1.1');
    expect(Object.keys(one)).toEqual(['Nora']);
    expect(one.Nora.start).toEqual({ position: [-1.5, 0, -1.85], yaw: 0, pose: 'sitting' });
    const two = actorsOf(p, '1.2');
    expect(two.Ben.mode).toBe('moving');
    expect(two.Ben.end).toEqual({ position: [-1.5, 0, -0.55], yaw: 180, pose: 'sitting' });
    expect(effectiveShot(p, shotId(p, '1.1'))!.setup.props).toHaveLength(2);
    // Later shots carry over where 1.2 left everyone.
    const three = actorsOf(p, '1.3');
    expect(three.Ben.start).toEqual(two.Ben.end);
    expect(three.Nora.start).toEqual(two.Nora.start);
  });

  it('takes out anyone not listed', async () => {
    const h = harness(coldCoffee());
    const tools = toolsFor('shots', false);
    await runTool(tools, 'block_shots', JSON.stringify(OPENING), h.ctx);
    await runTool(tools, 'block_shots', JSON.stringify({ shots: [{ number: '3.1', actors: [{ name: 'Nora', start: { x: -1.5, z: -1.85, pose: 'sitting' } }] }] }), h.ctx);
    expect(Object.keys(actorsOf(h.get(), '3.1'))).toEqual(['Nora']);
  });

  it('lets people stand in a doorway', async () => {
    const h = harness(coldCoffee());
    const r = await runTool(toolsFor('shots', false), 'block_shots', JSON.stringify({ shots: [{ number: '1.2', actors: [{ name: 'Ben', start: { x: 2.9, z: 1, pose: 'walking' }, end: { x: 2, z: 1 } }] }] }), h.ctx);
    expect(r).not.toMatch(/inside Door/);
  });

  it('warns about furniture, seats, overlaps, the room and continuity', async () => {
    const h = harness(coldCoffee());
    const tools = toolsFor('shots', false);
    await runTool(tools, 'block_shots', JSON.stringify(OPENING), h.ctx);
    const r = await runTool(tools, 'block_shots', JSON.stringify({
      shots: [{
        number: '1.3',
        actors: [
          { name: 'Nora', start: { x: -1.5, z: -1.2, pose: 'standing' } },
          { name: 'Ben', start: { x: 0, z: 0, pose: 'sitting' } },
          { name: 'Barista', start: { x: 0.2, z: 0.1 } },
        ],
      }, { number: '1.4', actors: [{ name: 'Nora', start: { x: 5, z: 0 } }] }],
    }), h.ctx);
    expect(r).toMatch(/Warnings:/);
    expect(r).toMatch(/Shot 1\.3: .*Nora is inside Table/);
    expect(r).toMatch(/Ben sits \(x=0 z=0\) with no chair or stool there/);
    expect(r).toMatch(/Ben and Barista overlap/);
    expect(r).toMatch(/Nora starts 0\.7 m, standing not sitting, from where shot 1\.2 left them/);
    expect(r).toMatch(/Shot 1\.4: Nora is outside Cafe/);
    // Sitting in a chair is not "inside" it.
    expect(r).not.toMatch(/inside (Back|Front) chair/);
  });

  it('warns when the action moves someone the blocking leaves still', async () => {
    const h = harness(coldCoffee());
    const tools = toolsFor('shots', false);
    await runTool(tools, 'block_shots', JSON.stringify(OPENING), h.ctx);
    const seated = [{ name: 'Nora', start: { x: -1.5, z: -1.85, pose: 'sitting' } }, { name: 'Ben', start: { x: -1.5, z: -0.55, pose: 'sitting' } }];
    const r = await runTool(tools, 'block_shots', JSON.stringify({ shots: [{ number: '1.16', actors: seated }, { number: '2.1', actors: [{ name: 'Ben', start: { x: 0, z: 0 } }] }, { number: '3.1', actors: [seated[0]] }] }), h.ctx);
    expect(r).toMatch(/Shot 1\.16: "Ben stands, leaves the key on the table, and walks out into the rain\." but Ben doesn't move/);
    expect(r).toMatch(/Shot 2\.1: .*"He turns up his collar and walks away\." but nobody moves/);
    expect(r).not.toMatch(/Shot 3\.1/); // "Nora sits alone" is a state, not a move
    // Movement is checked per sentence: the barista retreats, Ben only stares.
    const r2 = await runTool(tools, 'block_shots', JSON.stringify({ shots: [{ number: '1.14', actors: [...seated, { name: 'Barista', start: { x: -0.6, z: -1.2 }, end: { x: 1.5, z: -2.2 } }] }] }), h.ctx);
    expect(r2).not.toMatch(/doesn't move/);
    const ok = await runTool(tools, 'block_shots', JSON.stringify({ shots: [{ number: '1.16', actors: [seated[0], { ...seated[1], end: { x: 2.6, z: 1, pose: 'walking' } }] }] }), h.ctx);
    expect(ok).not.toMatch(/doesn't move/);
  });

  it('checks every name before changing anything', async () => {
    const h = harness(coldCoffee());
    const before = h.get();
    const r = await runTool(toolsFor('shots', false), 'block_shots', JSON.stringify({ shots: [OPENING.shots[0], { number: '1.2', actors: [{ name: 'Marcus', start: { x: 0, z: 0 } }] }] }), h.ctx);
    expect(r).toMatch(/^Error: No character named "Marcus"/);
    expect(h.get()).toBe(before);
    expect(await runTool(toolsFor('shots', false), 'block_shots', JSON.stringify({ shots: [{ number: '9.9', actors: [] }] }), h.ctx)).toMatch(/No shot 9\.9/);
  });

  it('faces props, and rejects a call with an unknown face target without changing anything', async () => {
    const h = harness(coldCoffee());
    const tools = toolsFor('shots', false);
    await runTool(tools, 'block_shots', JSON.stringify(OPENING), h.ctx);
    const r = await runTool(tools, 'block_shots', JSON.stringify({ shots: [{ number: '1.10', actors: [{ name: 'Ben', start: { x: -1.5, z: -0.55, pose: 'sitting', face: 'envelope' } }], props: [{ prop: 'Envelope', x: -2, z: -0.55, y: 0.75 }] }] }), h.ctx);
    expect(r).toMatch(/^Blocked shots 1\.10/);
    expect(actorsOf(h.get(), '1.10').Ben.start.yaw).toBe(-90);
    const before = h.get();
    const bad = await runTool(tools, 'block_shots', JSON.stringify({ shots: [OPENING.shots[0], { number: '1.3', actors: [{ name: 'Ben', start: { face: 'Coffee pot' } }] }] }), h.ctx);
    expect(bad).toMatch(/^Error: Shot 1\.3: can't find "Coffee pot" to face\. Nothing was changed\. Choose from: Ben, Cafe, .*Nora's mug/);
    expect(h.get()).toBe(before);
  });

  it('switches a shot to another stage', async () => {
    const h = harness(coldCoffee());
    await runTool(toolsFor('shots', false), 'block_shots', JSON.stringify({ shots: [{ number: '1.1', stage: 'Street', actors: [{ name: 'Ben', start: { x: 0, z: 0 } }] }] }), h.ctx);
    const p = h.get();
    expect(p.stages.find((s) => s.id === effectiveShot(p, shotId(p, '1.1'))!.stageId)!.name).toBe('Street');
  });

  it('is undone as one turn', async () => {
    const h = harness(coldCoffee());
    const before = h.get();
    await runTool(toolsFor('shots', false), 'block_shots', JSON.stringify(OPENING), h.ctx);
    h.undoTurn();
    expect(h.get().shots).toEqual(before.shots);
  });
});

describe('render_shots', () => {
  it('renders a contact sheet and shows it to the model', async () => {
    const h = harness(coldCoffee());
    const r = await runTool(toolsFor('shots', false), 'render_shots', JSON.stringify({ shots: ['1.1', '1.2'], at: 'end' }), h.ctx);
    expect(r).toMatch(/Rendered shots 1\.1, 1\.2/);
    const p = h.get();
    expect(h.ctx.renderSheet).toHaveBeenCalledWith([shotId(p, '1.1'), shotId(p, '1.2')], ['end'], 'camera');
    expect(h.ctx.attachImage).toHaveBeenCalledWith('data:image/jpeg;base64,AAAA', expect.stringMatching(/Rows: shots 1\.1, 1\.2.*Columns: end/));
  });

  it('caps a sheet at six shots', async () => {
    const h = harness(coldCoffee());
    const r = await runTool(toolsFor('shots', false), 'render_shots', JSON.stringify({ shots: ['1.1', '1.2', '1.3', '1.4', '1.5', '1.6', '1.7'] }), h.ctx);
    expect(r).toMatch(/^Error: invalid arguments/);
  });

  it('lays out a row per shot and a column per moment', () => {
    const l = sheetLayout(2, 3, 384, 2.39);
    expect(l.frame).toEqual({ width: 384, height: 160 });
    expect(l.cells[1][2]).toEqual({ x: 4 + 2 * 388, y: 22 + 164 });
    expect(l.width).toBe(4 + 3 * 388);
    expect(l.height).toBe(22 + 2 * 164);
  });
});

describe('agent loop with a skill', () => {
  beforeEach(async () => {
    globalThis.indexedDB = new IDBFactory();
    resetDbForTests();
    await setSetting(CHAT_MODEL_SETTING, 'test-model');
  });

  it('loads the skill from the request and allows more rounds', async () => {
    const rounds = MAX_ROUNDS + 4;
    const bodies: ResponsesBody[] = [];
    let n = 0;
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(init.body as string));
      return responseStream(++n < rounds
        ? { tool_calls: [{ id: `c${n}`, function: { name: 'block_shots', arguments: JSON.stringify(OPENING) } }] }
        : { content: 'Blocked the opening.' });
    });
    const h = harness(coldCoffee());
    const reply = await runTurn({
      text: 'Block the scene.',
      history: [],
      step: 'shots',
      getProject: h.ctx.project,
      dispatch: h.ctx.dispatch,
      stageId: h.ctx.stageId,
      setStage: h.ctx.setStage,
      navigate: h.ctx.navigate,
      snapshot: h.ctx.snapshot,
      renderSheet: h.ctx.renderSheet,
      apiKey: 'sk-test',
    });
    vi.unstubAllGlobals();
    expect(reply).toBe('Blocked the opening.');
    expect(bodies).toHaveLength(rounds);
    expect(bodies[0].instructions).toMatch(/SKILL: SHOT BY SHOT[\s\S]*Scene detail/);
    expect(actorsOf(h.get(), '1.2').Ben.mode).toBe('moving');
  });

  it('loads a skill the model asks for in the same turn', async () => {
    const replies = [
      { tool_calls: [{ id: 'c1', function: { name: 'use_skill', arguments: JSON.stringify({ id: 'shot_by_shot' }) } }] },
      { content: 'Ready.' },
    ];
    const bodies: ResponsesBody[] = [];
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(init.body as string));
      return responseStream(replies.shift()!);
    });
    const h = harness(coldCoffee());
    await runTurn({
      text: 'Can you put everyone where they belong for the cafe?',
      history: [], step: 'shots', getProject: h.ctx.project, dispatch: h.ctx.dispatch, stageId: h.ctx.stageId,
      setStage: h.ctx.setStage, navigate: h.ctx.navigate, snapshot: h.ctx.snapshot, apiKey: 'sk-test',
    });
    vi.unstubAllGlobals();
    expect(bodies[0].instructions).not.toMatch(/SKILL: SHOT BY SHOT/);
    expect(bodies[1].instructions).toMatch(/SKILL: SHOT BY SHOT/);
  });
});
