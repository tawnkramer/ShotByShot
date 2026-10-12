import { describe, expect, it } from 'vitest';
import { emptyHistory, runCommand, type Command } from '../src/state/commands';
import { createProject, type Project } from '../src/state/schema';
import { importScript } from '../src/story/commands';
import { SAMPLE_SCRIPT } from '../src/story/sample';
import { addCharacters } from '../src/characters/commands';
import { linesNeedingAudio } from '../src/audio/clips';
import { setDialogueAudio } from '../src/audio/commands';
import { setCamera, setDuration } from '../src/shots/commands';
import { effectiveShots } from '../src/shots/setup';
import { buildSequence } from '../src/shots/sequence';
import { frameSize, wrap } from '../src/export/render';
import { filmCues } from '../src/export/audioMix';
import { shotMoves, stillName } from '../src/export/exportVideo';

const run = (p: Project, ...cmds: Command[]) => {
  let h = emptyHistory();
  for (const c of cmds) [p, h] = runCommand(p, h, c);
  return p;
};

describe('frame size', () => {
  it('uses the long side and keeps both sides even', () => {
    expect(frameSize(16 / 9, '1080')).toEqual({ width: 1920, height: 1080 });
    expect(frameSize(2.39, '1080')).toEqual({ width: 1920, height: 804 });
    expect(frameSize(9 / 16, '720')).toEqual({ width: 720, height: 1280 });
    const { width, height } = frameSize(1.375, '720');
    expect(width % 2 + height % 2).toBe(0);
  });
});

describe('caption wrapping', () => {
  const measure = { measureText: (s: string) => ({ width: s.length * 10 }) as TextMetrics };
  it('wraps on word boundaries within the width', () => {
    expect(wrap(measure, 'Ten years I told everyone he just left.', 150)).toEqual(['Ten years I', 'told everyone', 'he just left.']);
    expect(wrap(measure, 'Short.', 150)).toEqual(['Short.']);
  });
});

describe('stills', () => {
  it('names files by shot number', () => {
    expect(stillName('12.3', 'start')).toBe('S12.3_start.png');
    expect(stillName('12A', 'end')).toBe('S12A_end.png');
    expect(stillName('SQ010_SH0020', 'start')).toBe('SQ010_SH0020_start.png');
  });

  it('knows which shots move', () => {
    const p = run(createProject('T'), importScript('A runs.\n\nB jumps.'));
    expect(shotMoves(p, p.shots[0].id)).toBe(false);
    const cam = effectiveShots(p).get(p.shots[0].id)!.camera.start;
    const q = run(p, setCamera(p.shots[0].id, 'end', { ...cam, distance: cam.distance * 2 }));
    expect(shotMoves(q, q.shots[0].id)).toBe(true);
  });
});

describe('film dialogue cues', () => {
  it('places each voiced line at its shot start plus its caption time', () => {
    let p = run(createProject('T'), importScript(SAMPLE_SCRIPT), addCharacters(['Maya', 'Dex'], ['maya', 'dex']));
    p = run(p, setDialogueAudio(linesNeedingAudio(p).map((s) => ({ lineId: s.line.id, sig: s.sig, blob: `b-${s.line.id}`, durationSec: 1 }))));
    const cues = filmCues(p);
    expect(cues).toHaveLength(7);
    const seq = buildSequence(p);
    expect(cues.every((c, i) => i === 0 || c.at > cues[i - 1].at)).toBe(true);
    expect(cues.at(-1)!.at).toBeLessThan(seq.total);
  });

  it('cuts lines that start after a shortened shot ends', () => {
    let p = run(createProject('T'), importScript('INT. ROOM - DAY\n\nMAYA\nOne.\n\nDEX\nTwo.'), addCharacters(['Maya', 'Dex']));
    p = run(p, setDialogueAudio(linesNeedingAudio(p).map((s) => ({ lineId: s.line.id, sig: s.sig, blob: `b-${s.line.id}`, durationSec: 2 }))));
    expect(filmCues(p)).toHaveLength(2);
    p = run(p, setDuration(p.shots[0].id, 1));
    expect(filmCues(p)).toHaveLength(1);
  });
});
