import { describe, expect, it } from 'vitest';
import { emptyHistory, runCommand } from '../src/state/commands';
import { createProject } from '../src/state/schema';
import { importScript } from '../src/story/commands';
import { setDuration } from '../src/shots/commands';
import { buildSequence, locate, startOf } from '../src/shots/sequence';

function project() {
  let [p, h] = runCommand(createProject('T'), emptyHistory(), importScript('A runs.\n\nB jumps.\n\nC falls.'));
  [p, h] = runCommand(p, h, setDuration(p.shots[0].id, 2));
  [p, h] = runCommand(p, h, setDuration(p.shots[1].id, 3));
  [p] = runCommand(p, h, setDuration(p.shots[2].id, 1));
  return p;
}

describe('sequence', () => {
  it('lays shots end to end', () => {
    const seq = buildSequence(project());
    expect(seq.items.map((i) => i.start)).toEqual([0, 2, 5]);
    expect(seq.total).toBe(6);
  });

  it('locates the shot and progress at a time', () => {
    const seq = buildSequence(project());
    expect(locate(seq, 0)).toEqual({ index: 0, u: 0 });
    expect(locate(seq, 1)).toEqual({ index: 0, u: 0.5 });
    expect(locate(seq, 2)).toEqual({ index: 1, u: 0 });
    expect(locate(seq, 5.5)).toEqual({ index: 2, u: 0.5 });
    expect(locate(seq, 99)).toEqual({ index: 2, u: 1 });
    expect(locate(seq, -1)).toEqual({ index: 0, u: 0 });
  });

  it('finds a shot start', () => {
    const p = project();
    expect(startOf(buildSequence(p), p.shots[2].id)).toBe(5);
  });

  it('handles an empty project', () => {
    expect(locate(buildSequence(createProject('E')), 3).index).toBe(-1);
  });
});
