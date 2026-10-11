import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { emptyHistory, runCommand, type Command, type History } from '../src/state/commands';
import { createProject, type Project } from '../src/state/schema';
import { importScript } from '../src/story/commands';
import { SAMPLE_SCRIPT } from '../src/story/sample';
import { addCharacters } from '../src/characters/commands';
import { createStagesForScenes } from '../src/staging/commands';
import { resetDbForTests, setSetting } from '../src/storage/db';
import { API_KEY_SETTING } from '../src/ai/openai';
import { CHAT_MODEL_SETTING } from '../src/ai/chat';
import { runTurn } from '../src/ai/agent';
import { runTool, toolsFor, toolSpecs, type ToolContext } from '../src/ai/tools';
import { systemPrompt } from '../src/ai/context';
import { effectiveShot } from '../src/shots/setup';

/** A tiny in-memory project store the tools can act on. */
function harness(p: Project, opts: { shotId?: string } = {}) {
  let project = p;
  let history: History = emptyHistory();
  let stageId = p.stages[0]?.id;
  const actions: string[] = [];
  const ctx: ToolContext = {
    project: () => project,
    dispatch: (cmd: Command) => {
      [project, history] = runCommand(project, history, cmd);
      actions.push(cmd.label);
    },
    step: 'staging',
    shotId: opts.shotId,
    stageId: () => stageId,
    setStage: (id) => (stageId = id),
    navigate: vi.fn(),
    snapshot: async () => null,
    attachImage: vi.fn(),
  };
  return { ctx, get: () => project, actions, history: () => history };
}

function sample(): Project {
  let [p, h] = runCommand(createProject('T'), emptyHistory(), importScript(SAMPLE_SCRIPT));
  [p, h] = runCommand(p, h, addCharacters(['Maya', 'Dex'], ['maya', 'dex']));
  [p] = runCommand(p, h, createStagesForScenes(p).command);
  return p;
}

describe('tools', () => {
  it('produces valid JSON schemas for every step', () => {
    for (const step of ['story', 'staging', 'characters', 'props', 'shots', 'previs', 'export'] as const) {
      for (const spec of toolSpecs(toolsFor(step, step === 'shots'))) {
        expect(spec.function.parameters.type).toBe('object');
      }
    }
  });

  it('adds, updates and removes stage objects by name', async () => {
    const h = harness(sample());
    const tools = toolsFor('staging', false);
    const r1 = await runTool(tools, 'add_objects', JSON.stringify({ objects: [{ item: 'room', x: 0, z: 0, size: { width: 8 } }, { item: 'bar', x: 0, z: -1.5 }, { item: 'stool', x: -1, z: -0.9 }, { item: 'stool', x: 1, z: -0.9 }] }), h.ctx);
    expect(r1).toMatch(/Room, Bar, Bar stool, Bar stool 2/);
    const stage = h.get().stages[0];
    expect(stage.objects).toHaveLength(4);
    expect(stage.objects[0].source).toMatchObject({ item: 'room', params: { width: 8 } });
    await runTool(tools, 'update_objects', JSON.stringify({ updates: [{ name: 'bar', yaw: 90, x: 2 }] }), h.ctx);
    const bar = h.get().stages[0].objects[1];
    expect(bar.transform.position).toEqual([2, 0, -1.5]);
    expect(await runTool(tools, 'remove_objects', JSON.stringify({ names: ['Bar stool 2', 'Piano'] }), h.ctx)).toMatch(/not found: Piano/);
    expect(h.get().stages[0].objects).toHaveLength(3);
  });

  it('reports bad arguments so the model can retry', async () => {
    const h = harness(sample());
    const tools = toolsFor('staging', false);
    expect(await runTool(tools, 'add_objects', JSON.stringify({ objects: [{ item: 'spaceship', x: 0, z: 0 }] }), h.ctx)).toMatch(/^Error: invalid arguments/);
    expect(await runTool(tools, 'add_objects', '{oops', h.ctx)).toMatch(/not valid JSON/);
    expect(await runTool(tools, 'model_prop', '{}', h.ctx)).toMatch(/no tool called model_prop/);
  });

  it('relabels lines and rebuilds shot breaks', async () => {
    const h = harness(sample());
    const tools = toolsFor('story', false);
    await runTool(tools, 'set_line_types', JSON.stringify({ changes: [{ line: 5, type: 'camera' }] }), h.ctx);
    expect(h.get().script[4].type).toBe('camera');
    const r = await runTool(tools, 'set_shot_breaks', JSON.stringify({ starts: [3, 10, 20] }), h.ctx);
    expect(r).toMatch(/3 shots/);
    expect(h.get().shots[0].lineIds[0]).toBe(h.get().script[2].id);
  });

  it('models a prop from parts and remodels it by name', async () => {
    const h = harness(sample());
    const tools = toolsFor('props', false);
    const parts = [{ shape: 'box', size: [0.2, 0.1, 0.15], position: [0, 0.05, 0] }, { shape: 'cylinder', size: [0.03, 0.15, 0.03], position: [0, 0.17, 0] }];
    expect(await runTool(tools, 'model_prop', JSON.stringify({ name: 'Rotary phone', parts }), h.ctx)).toMatch(/Modelled/);
    expect(await runTool(tools, 'model_prop', JSON.stringify({ name: 'rotary phone', parts: parts.slice(0, 1) }), h.ctx)).toMatch(/Remodelled/);
    const prop = h.get().props[0];
    expect(prop.source.kind === 'composite' && prop.source.nodes).toHaveLength(1);
  });

  it('blocks characters, faces them, and frames the camera in a shot', async () => {
    const p = sample();
    const shot = p.shots.find((s) => s.lineIds.some((id) => p.script.find((l) => l.id === id)?.text === "We're closed."))!;
    const h = harness(p, { shotId: shot.id });
    const tools = toolsFor('shots', true);
    await runTool(tools, 'place_characters', JSON.stringify({ placements: [{ name: 'Maya', x: -1, z: 0 }, { name: 'Dex', x: 1, z: 0, face: 'Maya' }, { name: 'Maya', face: 'Dex' }] }), h.ctx);
    const eff = effectiveShot(h.get(), shot.id)!;
    const dex = eff.setup.actors.find((a) => a.characterId === 'dex')!.motion.start;
    const maya = eff.setup.actors.find((a) => a.characterId === 'maya')!.motion.start;
    expect(dex.yaw).toBe(-90);
    expect(maya.yaw).toBe(90);
    expect(await runTool(tools, 'frame_camera', JSON.stringify({ size: 'CU', subjects: ['Dex'], angle: 20 }), h.ctx)).toMatch(/CU on Dex/);
    expect(effectiveShot(h.get(), shot.id)!.camera.start.azimuth).toBe(-70);
    await runTool(tools, 'place_characters', JSON.stringify({ placements: [{ name: 'Dex', x: 3, z: 1, at: 'end' }] }), h.ctx);
    expect(effectiveShot(h.get(), shot.id)!.setup.actors.find((a) => a.characterId === 'dex')!.motion.mode).toBe('moving');
  });

  it('describes the current state compactly by name', () => {
    const p = sample();
    const prompt = systemPrompt(p, 'story', {});
    expect(prompt).toMatch(/^.*ShotByShot/);
    expect(prompt).toMatch(/\n\d+ \[dialogue\] Door's a liar\./);
    expect(prompt).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/); // no internal ids
  });
});

describe('agent loop', () => {
  beforeEach(async () => {
    globalThis.indexedDB = new IDBFactory();
    resetDbForTests();
    await setSetting(API_KEY_SETTING, 'sk-test');
    await setSetting(CHAT_MODEL_SETTING, 'test-model');
  });

  it('runs tool calls, feeds back results, and returns the final reply', async () => {
    const replies = [
      { tool_calls: [{ index: 0, id: 'c1', function: { name: 'add_objects', arguments: JSON.stringify({ objects: [{ item: 'table', x: 0, z: 0 }] }) } }] },
      { content: 'Added a table in the middle.' },
    ];
    const bodies: { messages: { role: string; content: unknown }[]; model: string }[] = [];
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(init.body as string));
      const delta = replies.shift()!;
      return new Response(`data: ${JSON.stringify({ choices: [{ delta }] })}\n\ndata: [DONE]\n\n`, { status: 200 });
    });
    const h = harness(sample());
    const reply = await runTurn({
      text: 'Put a table in the middle',
      history: [],
      step: 'staging',
      getProject: h.ctx.project,
      dispatch: h.ctx.dispatch,
      stageId: h.ctx.stageId,
      setStage: h.ctx.setStage,
      navigate: h.ctx.navigate,
      snapshot: h.ctx.snapshot,
    });
    vi.unstubAllGlobals();
    expect(reply).toBe('Added a table in the middle.');
    expect(h.get().stages[0].objects.map((o) => o.name)).toEqual(['Table']);
    expect(bodies[0].model).toBe('test-model');
    const toolMsg = bodies[1].messages.find((m) => m.role === 'tool');
    expect(toolMsg?.content).toMatch(/Added to "Dockside Bar": Table/);
    // The second request's system prompt already shows the table.
    expect(bodies[1].messages[0].content).toMatch(/- Table \(table/);
  });
});
