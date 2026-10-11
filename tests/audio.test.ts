import { describe, expect, it } from 'vitest';
import { emptyHistory, runCommand, type Command } from '../src/state/commands';
import { createProject, projectSchema, type Project } from '../src/state/schema';
import { importScript } from '../src/story/commands';
import { SAMPLE_SCRIPT } from '../src/story/sample';
import { addCharacters, updateCharacter } from '../src/characters/commands';
import { linesNeedingAudio, spokenLines, validClips } from '../src/audio/clips';
import { setDialogueAudio } from '../src/audio/commands';
import { autoDuration, shotCaptions } from '../src/shots/timing';
import { effectiveShots, shotLines } from '../src/shots/setup';
import { buildSequence } from '../src/shots/sequence';

function project(): Project {
  let [p, h] = runCommand(createProject('T'), emptyHistory(), importScript(SAMPLE_SCRIPT));
  [p, h] = runCommand(p, h, addCharacters(['Maya', 'Dex'], ['maya', 'dex']));
  return p;
}
const run = (p: Project, ...cmds: Command[]) => {
  let h = emptyHistory();
  for (const c of cmds) [p, h] = runCommand(p, h, c);
  return p;
};
/** Pretend every line was voiced with a clip of the given length. */
function voiceAll(p: Project, sec = 1): Project {
  return run(p, setDialogueAudio(linesNeedingAudio(p).map((s) => ({ lineId: s.line.id, sig: s.sig, blob: `b-${s.line.id}`, durationSec: sec }))));
}

describe('spoken lines', () => {
  it('pairs dialogue with its character and folds parentheticals into delivery', () => {
    const { lines, unassigned } = spokenLines(project());
    expect(unassigned).toBe(0);
    expect(lines.map((l) => l.character.name)).toEqual(['Maya', 'Dex', 'Maya', 'Dex', 'Dex', 'Maya']);
    const quiet = lines.find((l) => l.line.text.startsWith('They found the boat'))!;
    expect(quiet.instructions).toBe('Deliver this quietly.');
    expect(lines.some((l) => l.line.text === '(quietly)')).toBe(false);
  });

  it('counts lines whose speaker has no character', () => {
    const [p] = runCommand(createProject('T'), emptyHistory(), importScript(SAMPLE_SCRIPT));
    expect(spokenLines(p).unassigned).toBe(6);
  });

  it('marks clips stale when the voice or text changes', () => {
    let p = voiceAll(project());
    expect(linesNeedingAudio(p)).toHaveLength(0);
    p = run(p, updateCharacter('dex', { voice: { provider: 'openai', voiceId: 'onyx', speed: 1.2 } }));
    expect(linesNeedingAudio(p).map((s) => s.character.name)).toEqual(['Dex', 'Dex', 'Dex']);
    expect(validClips(p).size).toBe(3);
  });

  it('keeps the project valid and drops audio for deleted lines', () => {
    const p = voiceAll(project());
    expect(() => projectSchema.parse(p)).not.toThrow();
    const q = run({ ...p, script: p.script.slice(0, 10) }, setDialogueAudio([]));
    expect(Object.keys(q.audio).every((id) => q.script.some((l) => l.id === id))).toBe(true);
  });
});

describe('audio-driven timing', () => {
  it('fits shot length and captions to the clips', () => {
    const p = voiceAll(project(), 2);
    const shot = p.shots.find((s) => shotLines(p, s).some((l) => l.text === "We're closed."))!;
    const lines = shotLines(p, shot);
    const clips = validClips(p);
    const dur = autoDuration(lines, clips);
    expect(dur).toBeCloseTo(0.3 + 2 * (2 + 0.25) + 0.4, 1);
    const caps = shotCaptions(lines, dur, clips);
    expect(caps.map((c) => [c.inSec, c.outSec])).toEqual([[0.3, 2.3], [2.55, 4.55]]);
    expect(caps[0].audioBlob).toMatch(/^b-/);
    expect(effectiveShots(p).get(shot.id)!.durationSec).toBe(dur);
  });

  it('falls back to word-count timing when any line is unvoiced', () => {
    const p = project();
    const shot = p.shots.find((s) => shotLines(p, s).some((l) => l.text === "We're closed."))!;
    expect(shotCaptions(shotLines(p, shot), 4, validClips(p))[0].audioBlob).toBeUndefined();
  });

  it('changes the film length when audio arrives', () => {
    const p = project();
    expect(buildSequence(voiceAll(p, 3)).total).toBeGreaterThan(buildSequence(p).total);
  });
});
