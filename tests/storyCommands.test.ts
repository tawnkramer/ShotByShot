import { describe, expect, it } from 'vitest';
import { emptyHistory, runCommand, undo } from '../src/state/commands';
import { createProject } from '../src/state/schema';
import { applyBreakdown, deleteLines, importScript, setLineTypes, toggleBreak } from '../src/story/commands';
import { SAMPLE_SCRIPT } from '../src/story/sample';

function withSample() {
  return runCommand(createProject('T'), emptyHistory(), importScript(SAMPLE_SCRIPT));
}

describe('story commands', () => {
  it('imports and breaks down in one undoable step', () => {
    const [p, h] = withSample();
    expect(p.script.length).toBeGreaterThan(20);
    expect(p.shots.length).toBeGreaterThan(5);
    const [back] = undo(p, h);
    expect(back.script).toHaveLength(0);
    expect(back.shots).toHaveLength(0);
  });

  it('toggles a cut inside a draft', () => {
    const [p, h] = withSample();
    const second = p.shots[0].lineIds[1];
    const [cut] = runCommand(p, h, toggleBreak(second));
    expect(cut.shots).toHaveLength(p.shots.length + 1);
    expect(cut.shots[1].lineIds[0]).toBe(second);
    expect(cut.shots.map((s) => s.number).slice(0, 3)).toEqual(['1.1', '1.2', '1.3']);
  });

  it('switches breakdown mode', () => {
    const [p, h] = withSample();
    const [perLine] = runCommand(p, h, applyBreakdown('line'));
    expect(perLine.breakdownMode).toBe('line');
    expect(perLine.shots.length).toBeGreaterThan(p.shots.length);
  });

  it('adds lines relabelled out of front matter to a shot', () => {
    const [p, h] = withSample();
    const author = p.script.find((l) => l.type === 'description')!;
    const [next] = runCommand(p, h, setLineTypes([author.id], 'action'));
    expect(next.shots[0].lineIds[0]).toBe(author.id);
    expect(next.script.find((l) => l.id === author.id)!.confidence).toBe(1);
  });

  it('deletes lines and drops empty shots', () => {
    const [p, h] = withSample();
    const last = p.shots.at(-1)!;
    const [next] = runCommand(p, h, deleteLines(last.lineIds));
    expect(next.shots).toHaveLength(p.shots.length - 1);
    expect(next.script.map((l) => l.index)).toEqual(next.script.map((_, i) => i));
  });
});
