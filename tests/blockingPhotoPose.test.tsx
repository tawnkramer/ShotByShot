import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it } from 'vitest';
import { BlockingPanel } from '../src/steps/shots/BlockingPanel';
import { emptyHistory, runCommand, type Command } from '../src/state/commands';
import { createProject, type Project } from '../src/state/schema';
import { useProjectStore } from '../src/state/store';
import { importScript } from '../src/story/commands';
import { addCharacters } from '../src/characters/commands';
import { createStagesForScenes } from '../src/staging/commands';
import { setActorKey } from '../src/shots/commands';
import { effectiveShot } from '../src/shots/setup';

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
let root: ReturnType<typeof createRoot>, host: HTMLDivElement;
afterEach(async () => { if (root) await act(async () => root.unmount()); host?.remove(); await useProjectStore.getState().close(); });

function project(): Project {
  let [p, h] = runCommand(createProject('T'), emptyHistory(), importScript('INT. ROOM - DAY\n\nMAYA\nHi.'));
  const cmds: Command[] = [addCharacters(['Maya'], ['maya']), createStagesForScenes(p).command];
  for (const c of cmds) [p, h] = runCommand(p, h, c);
  return runCommand(p, h, setActorKey(p.shots[0].id, 'maya', 'start', { joints: { neck: [20, 0, 0] } }))[0];
}

async function render() {
  const p = useProjectStore.getState().project!;
  const shot = p.shots[0];
  await act(async () => root.render(<BlockingPanel project={p} shot={shot} eff={effectiveShot(p, shot.id)!} editKey="start" selected={null} onSelect={() => {}} />));
}
const clear = () => [...host.querySelectorAll('button')].find((b) => b.textContent === 'Clear photo pose');

it('offers to clear a photo pose, and clearing goes back to the preset', async () => {
  useProjectStore.getState().open(project());
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await render();
  expect(clear()).toBeDefined();
  await act(async () => clear()!.click());
  const p = useProjectStore.getState().project!;
  expect(effectiveShot(p, p.shots[0].id)!.setup.actors[0].motion.start).not.toHaveProperty('joints');
  await render();
  expect(clear()).toBeUndefined();
});
