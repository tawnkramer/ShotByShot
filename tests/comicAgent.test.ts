import { describe, expect, it, vi } from 'vitest';
import { emptyHistory, runCommand, type Command, type History } from '../src/state/commands';
import { createProject, type Project } from '../src/state/schema';
import { importScript } from '../src/story/commands';
import { SAMPLE_SCRIPT } from '../src/story/sample';
import { addCharacters } from '../src/characters/commands';
import { runTool, toolsFor, toolSpecs, type ToolContext } from '../src/ai/tools';
import { systemPrompt } from '../src/ai/context';
import { suggestionsFor } from '../src/ai/suggestions';
import { pagesOf, coverOf } from '../src/comic/pages';

function harness(p: Project, opts: { shotId?: string } = {}) {
  let project = p;
  let history: History = emptyHistory();
  const actions: string[] = [];
  const ctx: ToolContext = {
    project: () => project,
    dispatch: (cmd: Command) => { [project, history] = runCommand(project, history, cmd); actions.push(cmd.label); },
    step: 'shots', shotId: opts.shotId, stageId: () => undefined, setStage: () => {}, navigate: vi.fn(), snapshot: async () => null, attachImage: vi.fn(),
  };
  return { ctx, get: () => project, actions, history: () => history };
}

function comic(): Project {
  let [p, h] = runCommand(createProject('Last Call', 'comic'), emptyHistory(), importScript(SAMPLE_SCRIPT));
  [p] = runCommand(p, h, addCharacters(['Maya', 'Dex'], ['maya', 'dex']));
  return p;
}
const panelWith = (p: Project, text: string) => p.shots.find((s) => s.lineIds.some((id) => p.script.find((l) => l.id === id)?.text === text))!;
const names = (tools: { name: string }[]) => tools.map((t) => t.name);

describe('comic assistant tools', () => {
  it('are offered in comic projects only, without the film-only tools', () => {
    const film = createProject('F'), book = createProject('C', 'comic');
    expect(names(toolsFor('shots', true, film))).toEqual(expect.arrayContaining(['camera_mode', 'set_duration']));
    expect(names(toolsFor('shots', true, film))).not.toContain('letter_panels');
    const editor = names(toolsFor('shots', true, book));
    expect(editor).toEqual(expect.arrayContaining(['letter_panels', 'edit_lettering', 'rewrite_dialogue', 'check_lettering', 'arrange_pages', 'view_pages']));
    expect(editor).not.toContain('camera_mode');
    expect(editor).not.toContain('set_duration');
    expect(names(toolsFor('shots', false, book))).not.toContain('voice_dialogue');
    expect(names(toolsFor('pages', false, book))).toContain('arrange_pages');
    for (const spec of toolSpecs(toolsFor('pages', false, book))) expect(spec.function.parameters.type).toBe('object');
  });

  it('letter every panel, then edit, rewrite and check the lettering', async () => {
    const h = harness(comic());
    const tools = toolsFor('shots', false, h.get());
    expect(await runTool(tools, 'letter_panels', '{}', h.ctx)).toMatch(/^Lettered panels /);
    const panel = panelWith(h.get(), "We're closed.");
    const lettered = h.get().shots.find((s) => s.id === panel.id)!.lettering!;
    expect(lettered.map((e) => e.text)).toEqual(["We're closed.", 'Door says open.', "Door's a liar."]);
    expect(await runTool(tools, 'letter_panels', '{}', h.ctx)).toMatch(/already has lettering/);

    const edited = await runTool(tools, 'edit_lettering', JSON.stringify({ panel: panel.number, changes: [{ balloon: 3, kind: 'shout', text: "DOOR'S A LIAR!" }, { balloon: 1, remove: true }], add: [{ text: 'Psst.', kind: 'whisper', speaker: 'Dex' }] }), h.ctx);
    expect(edited).toMatch(/now has 3/);
    const after = h.get().shots.find((s) => s.id === panel.id)!.lettering!;
    expect(after.map((e) => [e.kind, e.text])).toEqual([['speech', 'Door says open.'], ['shout', "DOOR'S A LIAR!"], ['whisper', 'Psst.']]);
    expect(after[2].targetCharacterId).toBe('dex');
    expect(await runTool(tools, 'edit_lettering', JSON.stringify({ panel: panel.number, changes: [{ balloon: 9, remove: true }] }), h.ctx)).toMatch(/^Error: .*no 9/);

    const line = h.get().script.findIndex((l) => l.text === 'Door says open.') + 1;
    expect(await runTool(tools, 'rewrite_dialogue', JSON.stringify({ line, text: 'Sign says open.' }), h.ctx)).toMatch(/updated the balloon in panel/);
    expect(h.get().script[line - 1].text).toBe('Sign says open.');
    expect(h.get().shots.find((s) => s.id === panel.id)!.lettering![0].text).toBe('Sign says open.');
    expect(await runTool(tools, 'rewrite_dialogue', JSON.stringify({ line: 1, text: 'x' }), h.ctx)).toMatch(/not dialogue/);

    const report = await runTool(tools, 'check_lettering', '{}', h.ctx);
    // The removed balloon's line is reported as not lettered.
    expect(report).toMatch(new RegExp(`Panel ${panel.number}: 1 speech not lettered \\(MAYA: "We're closed."\\)`));
  });

  it('arrange pages: order, leave out, cover', async () => {
    const h = harness(comic());
    const tools = toolsFor('pages', false, h.get());
    const [one, two, three] = h.get().shots.map((s) => s.number);
    const out = await runTool(tools, 'arrange_pages', JSON.stringify({ order: [three, one], leave_out: [two], cover: three }), h.ctx);
    expect(out).toMatch(new RegExp(`^${h.get().shots.length - 1} pages: Page01=panel ${three}, Page02=panel ${one},`));
    expect(pagesOf(h.get()).map((p) => p.shotId).slice(0, 2)).toEqual([h.get().shots[2].id, h.get().shots[0].id]);
    expect(coverOf(h.get())).toBe(h.get().shots[2].id);
    await runTool(tools, 'arrange_pages', JSON.stringify({ put_back: [two] }), h.ctx);
    expect(h.get().comic?.leftOut).toBeUndefined();
    expect(h.actions).toEqual(['Arrange pages', 'Arrange pages']);
  });

  it('tells the model about panels, lettering and pages', async () => {
    const h = harness(comic());
    await runTool(toolsFor('shots', false, h.get()), 'letter_panels', '{}', h.ctx);
    const p = h.get();
    const panel = panelWith(p, "We're closed.");
    const editor = systemPrompt(p, 'shots', { shotId: panel.id });
    expect(editor).toMatch(/This project is a COMIC/);
    expect(editor).toMatch(/Lettering on panel \d+ .*\n1\. speech, to Maya, auto, at [\d.]+,[\d.]+: "We're closed\."/);
    const pages = systemPrompt(p, 'pages', {});
    expect(pages).toMatch(/Pages: Page01=panel 1, Page02=panel 2/);
    expect(pages).toMatch(/\n\d+ \[no stage, 3 lettered\]/);
    expect(suggestionsFor('shots', p, false)).toContain('Letter every panel.');
  });
});
