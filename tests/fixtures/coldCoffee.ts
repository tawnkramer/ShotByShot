import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { emptyHistory, runCommand, type Command, type History } from '../../src/state/commands';
import { createProject, type ObjectSource, type Project } from '../../src/state/schema';
import { importScript } from '../../src/story/commands';
import { addCharacters, updateCharacter } from '../../src/characters/commands';
import { addObject, createStage, createStagesForScenes, quatFromDegrees } from '../../src/staging/commands';
import { setShotStage } from '../../src/shots/commands';
import { addProp } from '../../src/props/commands';

export const COLD_COFFEE = readFileSync(resolve(process.cwd(), 'samples/cold_coffee.txt'), 'utf8');

/**
 * The Cold Coffee sample with its characters, props and a furnished cafe:
 * a 6 × 5 m room, a table for two under the back window, and the door on
 * the right wall. The street outside is a wall with the cafe window.
 */
export function coldCoffee(): Project {
  let p = createProject('Cold Coffee');
  let h: History = emptyHistory();
  const run = (cmd: Command) => ([p, h] = runCommand(p, h, cmd));
  run(importScript(COLD_COFFEE));
  run(addCharacters(['Nora', 'Ben', 'Barista']));
  const [nora, ben, barista] = p.characters;
  run(updateCharacter(nora.id, { sex: 'female', heightCm: 168 }));
  run(updateCharacter(ben.id, { sex: 'male', heightCm: 182 }));
  run(updateCharacter(barista.id, { sex: 'female', heightCm: 163 }));
  run(createStagesForScenes(p).command);
  const lib = (item: string, params?: Record<string, number>) => ({ kind: 'library', item, params }) as ObjectSource;
  const put = (stageId: string, source: ObjectSource, name: string, x: number, z: number, yaw = 0, y = 0) =>
    run(addObject(stageId, source, { position: [x, y, z], rotation: quatFromDegrees([0, yaw, 0]), scale: [1, 1, 1] }, undefined, name));
  const inside = p.stages.find((s) => /^int/i.test(s.name)) ?? p.stages[0];
  put(inside.id, lib('room', { width: 6, depth: 5 }), 'Cafe', 0, 0);
  put(inside.id, lib('window', { width: 2 }), 'Window', -1.5, -2.44);
  put(inside.id, lib('table', { width: 0.8, depth: 0.8 }), 'Table', -1.5, -1.2);
  put(inside.id, lib('chair'), 'Back chair', -1.5, -1.85);
  put(inside.id, lib('chair'), 'Front chair', -1.5, -0.55, 180);
  put(inside.id, lib('door'), 'Door', 2.94, 1, -90);
  put(inside.id, lib('bar', { length: 2.5 }), 'Counter', 1.5, -1.4);
  // Both cafe scenes share a location, so the street gets its own stage.
  run(createStage('Street', []));
  const street = p.stages.at(-1)!;
  put(street.id, lib('wall', { width: 8 }), 'Cafe front', 0, -1.5);
  put(street.id, lib('window', { width: 2 }), 'Cafe window', -1, -1.38);
  put(street.id, lib('door'), 'Cafe door', 1.5, -1.38);
  const ext = p.shots.find((s) => s.number === '2.1')!;
  run(setShotStage(ext.id, street.id));
  run(addProp(lib('mug'), 'Nora\'s mug'));
  run(addProp(lib('mug'), 'Ben\'s mug'));
  run(addProp(lib('envelope'), 'Envelope'));
  return p;
}
