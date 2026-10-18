import { describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { classifyScript } from '../src/story/classify';
import { breakdownScript, PANEL_MAX_WORDS } from '../src/story/breakdown';
import { createProject, mediumOf, migrateProject, stepLabel, stepsFor, STEPS, type ScriptLine } from '../src/state/schema';
import { frameAspect } from '../src/shots/setup';
import { setPanelShape } from '../src/shots/commands';
import { emptyHistory, runCommand, undo } from '../src/state/commands';
import { ProjectsHome } from '../src/steps/ProjectsHome';
import { listProjects, loadProject } from '../src/storage/db';

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

describe('comic projects', () => {
  it('start with comic defaults and a shorter step list', () => {
    const comic = createProject('Strip', 'comic');
    expect(comic).toMatchObject({ medium: 'comic', aspect: '4:3', breakdownMode: 'panels', shotNumbering: 'sequential' });
    expect(stepsFor(comic)).toEqual(['story', 'staging', 'characters', 'props', 'shots', 'pages']);
    expect(stepLabel('shots', comic)).toBe('Panels');
    const film = createProject('Film');
    expect(film.medium).toBeUndefined();
    expect(mediumOf(film)).toBe('film');
    expect(stepsFor(film)).toEqual(STEPS.filter((s) => s !== 'pages'));
    expect(stepLabel('shots', film)).toBe('Shots');
  });

  it('keep their kind through a project file; older files are films', () => {
    expect(migrateProject(JSON.parse(JSON.stringify(createProject('Strip', 'comic')))).medium).toBe('comic');
    const old = JSON.parse(JSON.stringify(createProject('Old')));
    delete old.medium;
    expect(mediumOf(migrateProject(old))).toBe('film');
  });

  it('give each panel its own shape; films ignore it', () => {
    const comic = createProject('Strip', 'comic');
    comic.shots.push({ id: 'p', number: '1', lineIds: ['l'] });
    expect(frameAspect(comic, comic.shots[0])).toBeCloseTo(4 / 3);
    const [shaped, history] = runCommand(comic, emptyHistory(), setPanelShape('p', '3:4'));
    expect(shaped.shots[0].panel).toEqual({ shape: '3:4' });
    expect(frameAspect(shaped, shaped.shots[0])).toBeCloseTo(3 / 4);
    expect(frameAspect({ ...shaped, medium: undefined }, shaped.shots[0])).toBeCloseTo(4 / 3);
    const [cleared] = runCommand(shaped, history, setPanelShape('p', undefined));
    expect(cleared.shots[0].panel).toBeUndefined();
    expect(undo(shaped, history)[0].shots[0].panel).toBeUndefined();
  });
});

describe('panel breakdown', () => {
  const load = (text: string): ScriptLine[] => classifyScript(text).map((l, i) => ({ id: `l${i}`, index: i, text: l.text, type: l.type }));
  let n = 0;
  const id = () => `p${n++}`;
  const texts = (lines: ScriptLine[], ids: string[]) => ids.map((i) => lines.find((l) => l.id === i)!.text);

  it('packs a quick exchange into one panel, up to three balloons', () => {
    const lines = load('INT. KITCHEN - NIGHT\n\nMAYA\nYou came back.\n\nLEO\nI never left.\n\nMAYA\nLiar.\n\nLEO\nFine. I left.');
    const panels = breakdownScript(lines, 'panels', id, 'sequential');
    expect(panels).toHaveLength(2);
    expect(texts(lines, panels[0].lineIds)).toEqual(['INT. KITCHEN - NIGHT', 'MAYA', 'You came back.', 'LEO', 'I never left.', 'MAYA', 'Liar.']);
    expect(texts(lines, panels[1].lineIds)).toEqual(['LEO', 'Fine. I left.']);
    expect(panels.map((p) => p.number)).toEqual(['1', '2']);
  });

  it('starts a new panel for a third speaker, too many words, or action', () => {
    const long = Array.from({ length: PANEL_MAX_WORDS }, () => 'word').join(' ');
    const lines = load(`INT. ROOM - DAY\n\nMAYA\nHi.\n\nLEO\nHey.\n\nSAM\nMorning.\n\nMAYA\n${long}\n\nLEO\nOkay.\n\nShe slams the door.`);
    const panels = breakdownScript(lines, 'panels', id, 'sequential').map((p) => texts(lines, p.lineIds));
    expect(panels[0]).toEqual(['INT. ROOM - DAY', 'MAYA', 'Hi.', 'LEO', 'Hey.']);
    expect(panels[1]).toEqual(['SAM', 'Morning.']);
    expect(panels[2][0]).toBe('MAYA');
    expect(panels.at(-1)).toEqual(['She slams the door.']);
  });
});

describe('New project', () => {
  it('asks film or comic', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => root.render(<MemoryRouter><ProjectsHome /></MemoryRouter>));
    const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === label)!;
    await act(async () => button('New project').click());
    const name = document.querySelector<HTMLInputElement>('.sheet input')!;
    expect(name.placeholder).toBe('Untitled film');
    await act(async () => button('Comic').click());
    expect(button('Comic').getAttribute('aria-checked')).toBe('true');
    expect(name.placeholder).toBe('Untitled comic');
    await act(async () => button('Create').click());
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    const summary = (await listProjects()).find((p) => p.name === 'Untitled comic')!;
    expect(summary.medium).toBe('comic');
    expect((await loadProject(summary.id))?.breakdownMode).toBe('panels');
    await act(async () => root.unmount());
    host.remove();
  });
});
