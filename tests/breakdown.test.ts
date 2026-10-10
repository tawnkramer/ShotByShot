import { describe, expect, it } from 'vitest';
import { classifyScript } from '../src/story/classify';
import { breakdownScript, letterIndex, numberShots, reconcileShots, toBeats, toggleBreakBefore } from '../src/story/breakdown';
import { SAMPLE_SCRIPT } from '../src/story/sample';
import type { ScriptLine } from '../src/state/schema';

function load(text: string): ScriptLine[] {
  return classifyScript(text).map((l, i) => ({ id: `l${i}`, index: i, text: l.text, type: l.type }));
}
let n = 0;
const id = () => `s${n++}`;
const texts = (lines: ScriptLine[], ids: string[]) => ids.map((i) => lines.find((l) => l.id === i)!.text);

describe('toBeats', () => {
  it('groups a speech and attaches scene headings', () => {
    const lines = load('INT. ROOM - DAY\n\nSAM\nHi.\n(beat)\nBye.\n\nShe leaves.');
    const beats = toBeats(lines);
    expect(beats.map((b) => b.kind)).toEqual(['speech', 'action']);
    expect(beats[0].sceneStart).toBe(true);
    expect(texts(lines, beats[0].lineIds)).toEqual(['INT. ROOM - DAY', 'SAM', 'Hi.', '(beat)', 'Bye.']);
    expect(beats[0].words).toBe(2);
  });
});

describe('breakdownScript', () => {
  const lines = load(SAMPLE_SCRIPT);

  it('covers every non-front-matter line exactly once, in order', () => {
    for (const mode of ['line', 'pair', 'mixed'] as const) {
      const shots = breakdownScript(lines, mode, id);
      const covered = shots.flatMap((s) => s.lineIds);
      const expected = lines.filter((l) => l.type !== 'title' && l.type !== 'description').map((l) => l.id);
      expect(covered).toEqual(expected);
    }
  });

  it('never crosses a scene heading', () => {
    for (const mode of ['line', 'pair', 'mixed'] as const) {
      for (const shot of breakdownScript(lines, mode, id)) {
        const sceneIdx = shot.lineIds.findIndex((i) => lines.find((l) => l.id === i)!.type === 'scene');
        expect(sceneIdx === -1 || sceneIdx === 0).toBe(true);
      }
    }
  });

  it('produces fewer shots per line < mixed-ish < pair', () => {
    const count = (m: 'line' | 'pair' | 'mixed') => breakdownScript(lines, m, id).length;
    expect(count('line')).toBeGreaterThan(count('pair'));
    expect(count('line')).toBeGreaterThan(count('mixed'));
  });

  it('mixed mode plays a quick exchange as one shot', () => {
    const ls = load('INT. BAR - NIGHT\n\nMAYA\nWe\'re closed.\n\nDEX\nDoor says open.\n\nMAYA\nDoor\'s a liar.');
    const shots = breakdownScript(ls, 'mixed', id);
    expect(shots.map((s) => texts(ls, s.lineIds).filter((t) => t !== 'MAYA' && t !== 'DEX'))).toEqual([
      ['INT. BAR - NIGHT', "We're closed.", 'Door says open.'],
      ["Door's a liar."],
    ]);
  });

  it('numbers shots by scene', () => {
    const shots = breakdownScript(lines, 'line', id);
    expect(shots[0].number).toBe('1A');
    expect(shots[1].number).toBe('1B');
    expect(shots.some((s) => s.number === '2A')).toBe(true);
    expect(shots.at(-1)!.number).toBe('3A');
  });

  it('numbers sequentially without scene headings', () => {
    const ls = load('He runs.\nShe follows.');
    expect(breakdownScript(ls, 'line', id).map((s) => s.number)).toEqual(['1', '2']);
  });
});

describe('camera lines and transitions', () => {
  it('attaches a camera heading to the next beat', () => {
    const ls = load('Sam waits.\n\nANGLE ON MAYA\n\nShe turns.\n\nShe smiles.');
    const shots = breakdownScript(ls, 'pair', id);
    expect(shots.map((s) => texts(ls, s.lineIds))).toEqual([['Sam waits.'], ['ANGLE ON MAYA', 'She turns.', 'She smiles.']]);
  });

  it('makes a descriptive camera line its own shot', () => {
    const ls = load('CLOSE ON the envelope. A police seal.\n\nDEX\nThey found Ray.');
    const shots = breakdownScript(ls, 'pair', id);
    expect(shots).toHaveLength(2);
    expect(texts(ls, shots[0].lineIds)).toEqual(['CLOSE ON the envelope. A police seal.']);
  });

  it('ends the previous shot with a transition', () => {
    const ls = load('He runs.\n\nCUT TO:\n\nShe sleeps.');
    const shots = breakdownScript(ls, 'pair', id);
    expect(shots.map((s) => texts(ls, s.lineIds))).toEqual([['He runs.', 'CUT TO:'], ['She sleeps.']]);
  });

  it('leads with FADE IN: at the top', () => {
    const ls = load('FADE IN:\n\nINT. ROOM - DAY\n\nQuiet.');
    expect(breakdownScript(ls, 'line', id).map((s) => texts(ls, s.lineIds))).toEqual([['FADE IN:', 'INT. ROOM - DAY', 'Quiet.']]);
  });
});

describe('toggleBreakBefore', () => {
  const lines = load('A.\nB.\nC.');
  const one = numberShots(lines, [{ id: 'x', number: '', lineIds: ['l0', 'l1', 'l2'], extra: 1 }]);

  it('splits a shot and copies its data', () => {
    const split = toggleBreakBefore(one, 'l1', () => 'y');
    expect(split.map((s) => s.lineIds)).toEqual([['l0'], ['l1', 'l2']]);
    expect(split[1].id).toBe('y');
    expect(split[1].extra).toBe(1);
  });

  it('merges back into the previous shot', () => {
    const split = toggleBreakBefore(one, 'l1', () => 'y');
    const merged = toggleBreakBefore(split, 'l1', () => 'z');
    expect(merged.map((s) => [s.id, s.lineIds])).toEqual([['x', ['l0', 'l1', 'l2']]]);
  });

  it('does nothing before the first line', () => {
    expect(toggleBreakBefore(one, 'l0', id)).toBe(one);
  });
});

describe('reconcileShots', () => {
  it('drops deleted lines and empty shots', () => {
    const lines = load('A.\nB.\nC.');
    const shots = [
      { id: 'a', number: '1', lineIds: ['l0'] },
      { id: 'b', number: '2', lineIds: ['l1', 'l2'] },
    ];
    const result = reconcileShots(lines.filter((l) => l.id !== 'l0'), shots);
    expect(result).toEqual([{ id: 'b', number: '1', lineIds: ['l1', 'l2'] }]);
  });
});

describe('letterIndex', () => {
  it('counts like spreadsheet columns', () => {
    expect([0, 1, 25, 26, 27].map(letterIndex)).toEqual(['A', 'B', 'Z', 'AA', 'AB']);
  });
});
