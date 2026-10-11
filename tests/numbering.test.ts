import { describe, expect, it } from 'vitest';
import { emptyHistory, runCommand, type Command } from '../src/state/commands';
import { createProject, projectSchema, type Project, type ScriptLine, type Shot } from '../src/state/schema';
import { classifyScript, parseSceneHeading } from '../src/story/classify';
import { breakdownScript } from '../src/story/breakdown';
import { renumber, slateSuffix } from '../src/story/numbering';
import { importScript, setShotNumbering } from '../src/story/commands';
import { mergeWithNext, splitShot } from '../src/shots/commands';
import { upgradeLoaded } from '../src/state/store';

const SCRIPT = 'INT. CAFE - DAY\n\nA.\n\nB.\n\nC.\n\nEXT. STREET - DAY\n\nD.\n\nE.';
const load = (text: string): ScriptLine[] =>
  classifyScript(text).map((l, i) => ({ id: `l${i}`, index: i, text: l.text, type: l.type, ...(l.sceneNumber ? { sceneNumber: l.sceneNumber } : {}) }));
let n = 0;
const id = () => `s${n++}`;
const numbers = (shots: Shot[]) => shots.map((s) => s.number);
const run = (p: Project, ...cmds: Command[]) => {
  let h = emptyHistory();
  for (const c of cmds) [p, h] = runCommand(p, h, c);
  return p;
};

describe('shot numbering styles', () => {
  const lines = load(SCRIPT);
  const shots = breakdownScript(lines, 'line', id);

  it('defaults to scene.shot', () => {
    expect(numbers(shots)).toEqual(['1.1', '1.2', '1.3', '2.1', '2.2']);
  });

  it('numbers slate style with no letter on the first setup', () => {
    expect(numbers(renumber(lines, shots, 'slate'))).toEqual(['1', '1A', '1B', '2', '2A']);
  });

  it('skips I and O in slate letters', () => {
    const letters = Array.from({ length: 26 }, (_, i) => slateSuffix(i));
    expect(letters).not.toContain('I');
    expect(letters).not.toContain('O');
    expect(letters.slice(0, 10)).toEqual(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'J', 'K']);
    expect(slateSuffix(24)).toBe('AA');
  });

  it('numbers sequentially through the film', () => {
    expect(numbers(renumber(lines, shots, 'sequential'))).toEqual(['1', '2', '3', '4', '5']);
  });

  it('gives previs/VFX codes in tens', () => {
    expect(numbers(renumber(lines, shots.map((s) => ({ ...s, number: '' })), 'vfx'))).toEqual(['SQ010_SH0010', 'SQ010_SH0020', 'SQ010_SH0030', 'SQ020_SH0010', 'SQ020_SH0020']);
  });
});

describe('VFX numbers stay put', () => {
  function project() {
    return run(createProject('T'), setShotNumbering('vfx'), importScript(SCRIPT));
  }

  it('fills the gap when a shot is split', () => {
    const p = project();
    expect(numbers(p.shots).every((x) => /^SQ0[12]0_SH00[1-9]0$/.test(x))).toBe(true);
    const wide = run(createProject('T'), setShotNumbering('vfx'), { label: 'mode', apply: (d) => void (d.breakdownMode = 'pair') }, importScript(SCRIPT));
    const target = wide.shots.find((s) => s.lineIds.length > 1)!;
    const split = run(wide, splitShot(target.id, [target.lineIds.at(-1)!]));
    const before = numbers(wide.shots);
    const after = numbers(split.shots);
    expect(after.length).toBe(before.length + 1);
    for (const num of before) expect(after).toContain(num);
    const i = split.shots.findIndex((s) => s.id === target.id);
    expect(after[i + 1]).toMatch(/^SQ0[12]0_SH00[1-9]5$/);
  });

  it('leaves a gap when shots are merged', () => {
    const p = run(createProject('T'), setShotNumbering('vfx'), { label: 'mode', apply: (d) => void (d.breakdownMode = 'line') }, importScript(SCRIPT));
    const merged = run(p, mergeWithNext(p.shots[0].id));
    expect(numbers(merged.shots)).toEqual(['SQ010_SH0010', 'SQ010_SH0030', 'SQ020_SH0010', 'SQ020_SH0020']);
  });
});

describe('scene numbers from the script', () => {
  it('reads leading and trailing numbers and Fountain #numbers#', () => {
    expect(parseSceneHeading('12 INT. CAFE - DAY 12')).toEqual({ heading: 'INT. CAFE - DAY', sceneNumber: '12' });
    expect(parseSceneHeading('12A. EXT. STREET - NIGHT')).toEqual({ heading: 'EXT. STREET - NIGHT', sceneNumber: '12A' });
    expect(parseSceneHeading('INT. CAFE - DAY #7B#')).toEqual({ heading: 'INT. CAFE - DAY', sceneNumber: '7B' });
    expect(parseSceneHeading('INT. CAFE - DAY 2')).toEqual({ heading: 'INT. CAFE - DAY 2' });
    expect(parseSceneHeading('12 angry men walk in.')).toBeNull();
  });

  it('uses script scene numbers and continues counting after them', () => {
    const lines = load('12 INT. CAFE - DAY 12\n\nA.\n\nB.\n\nEXT. STREET - DAY\n\nC.\n\n20A EXT. PARK - DAY 20A\n\nD.');
    expect(numbers(breakdownScript(lines, 'line', id))).toEqual(['12.1', '12.2', '13.1', '20A.1']);
  });
});

describe('older projects', () => {
  it('get scene.shot numbering when opened', () => {
    const p = run(createProject('Old'), importScript(SCRIPT));
    const old = { ...p, shots: p.shots.map((s, i) => ({ ...s, number: `1${'ABCD'[i]}` })) } as Record<string, unknown>;
    delete old.shotNumbering;
    const up = upgradeLoaded(old as unknown as Project);
    expect(up.shotNumbering).toBe('scene.shot');
    expect(up.shots).toHaveLength(p.shots.length);
    expect(numbers(up.shots).every((x) => /^[12]\.\d$/.test(x))).toBe(true);
    expect(up.shots[0].number).toBe('1.1');
    expect(() => projectSchema.parse(up)).not.toThrow();
  });
});
