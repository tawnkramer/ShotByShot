import { describe, expect, it } from 'vitest';
import { emptyHistory, redo, runCommand, undo } from '../src/state/commands';
import { createProject } from '../src/state/schema';

describe('command bus', () => {
  it('applies, undoes and redoes a command', () => {
    const p0 = createProject('A');
    const [p1, h1] = runCommand(p0, emptyHistory(), { label: 'Rename', apply: (d) => void (d.name = 'B') });
    expect(p1.name).toBe('B');
    expect(h1.past).toHaveLength(1);

    const [p2, h2] = undo(p1, h1);
    expect(p2.name).toBe('A');
    expect(h2.future).toHaveLength(1);

    const [p3, h3] = redo(p2, h2);
    expect(p3.name).toBe('B');
    expect(h3.past).toHaveLength(1);
    expect(h3.future).toHaveLength(0);
  });

  it('ignores commands that change nothing', () => {
    const p0 = createProject('A');
    const h0 = emptyHistory();
    const [p1, h1] = runCommand(p0, h0, { label: 'Noop', apply: (d) => void (d.name = 'A') });
    expect(p1).toBe(p0);
    expect(h1).toBe(h0);
  });

  it('clears redo history after a new command', () => {
    const p0 = createProject('A');
    let [p, h] = runCommand(p0, emptyHistory(), { label: 'x', apply: (d) => void (d.fps = 25) });
    [p, h] = undo(p, h);
    [p, h] = runCommand(p, h, { label: 'y', apply: (d) => void (d.fps = 30) });
    expect(h.future).toHaveLength(0);
    expect(p.fps).toBe(30);
  });
});
