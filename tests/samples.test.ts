import { describe, expect, it } from 'vitest';
import { emptyHistory, runCommand } from '../src/state/commands';
import { createProject } from '../src/state/schema';
import { importScript } from '../src/story/commands';
import { SAMPLE_SCRIPTS, WRONG_CAR_SCRIPT } from '../src/story/sample';
import { namesFromScript } from '../src/characters/commands';

const load = (text: string) => runCommand(createProject('T'), emptyHistory(), importScript(text))[0];

describe('sample scripts', () => {
  it('each imports with scenes, speakers and shots', () => {
    expect(SAMPLE_SCRIPTS.map((s) => s.title)).toEqual(['Last Call', 'Wrong Car']);
    for (const s of SAMPLE_SCRIPTS) {
      const p = load(s.text);
      expect(p.script.some((l) => l.type === 'scene')).toBe(true);
      expect(namesFromScript(p).length).toBeGreaterThanOrEqual(2);
      expect(p.shots.length).toBeGreaterThan(5);
    }
  });

  it('reads Wrong Car as six scenes with Dana, Jesse and the clerk', () => {
    const p = load(WRONG_CAR_SCRIPT);
    expect(p.script.filter((l) => l.type === 'scene').map((l) => l.text)).toEqual([
      'EXT. GAS STATION - NIGHT', 'INT. SILVER HATCHBACK - MOVING', 'INT. GAS STATION - CONTINUOUS',
      'EXT. GAS STATION - CONTINUOUS', 'INT. GAS STATION - CONTINUOUS', 'EXT. GAS STATION - CONTINUOUS',
    ]);
    expect(namesFromScript(p)).toEqual(['Dana', 'Jesse', 'Clerk']);
    expect(p.script.find((l) => l.text === '(pointing at Dana)')?.type).toBe('dialogue');
    // The baby is a surprise: nothing mentions her before Jesse looks in the mirror.
    const reveal = p.script.findIndex((l) => l.text.startsWith('A baby carrier'));
    expect(p.script.slice(0, reveal).some((l) => /baby|lily|carrier|back seat/i.test(l.text) && !/sneeze/i.test(l.text))).toBe(false);
  });
});
