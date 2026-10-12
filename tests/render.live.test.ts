// @vitest-environment node
/**
 * Renders the Cold Coffee opening through the app's renderer in headless
 * Chromium and writes the contact sheet, to check render_shots by eye.
 *   LIVE_RENDER=1 npx vitest run tests/render.live.test.ts
 */
import 'fake-indexeddb/auto';
import { expect, it } from 'vitest';
import { emptyHistory, runCommand } from '../src/state/commands';
import { setCamera } from '../src/shots/commands';
import { runTool, toolsFor, type ToolContext } from '../src/ai/tools';
import { coldCoffee } from './fixtures/coldCoffee';
import { openBrowserSheet, saveDataUrl } from './live/browser';

it.skipIf(!process.env.LIVE_RENDER)('renders a contact sheet in a real browser', async () => {
  let p = coldCoffee();
  let h = emptyHistory();
  const ctx = {
    project: () => p, dispatch: (c) => void ([p, h] = runCommand(p, h, c)), step: 'shots',
    stageId: () => undefined, setStage: () => {}, navigate: () => {}, snapshot: async () => null, attachImage: () => {},
  } as ToolContext;
  const opening = {
    shots: [
      { number: '1.1', actors: [{ name: 'Nora', start: { x: -1.5, z: -1.85, pose: 'sitting', face: 'Front chair' } }], props: [{ prop: "Nora's mug", x: -1.6, z: -1.35, y: 0.75 }, { prop: "Ben's mug", x: -1.4, z: -1.05, y: 0.75 }] },
      { number: '1.2', actors: [{ name: 'Nora', start: { x: -1.5, z: -1.85, pose: 'sitting', face: 'Front chair' } }, { name: 'Ben', start: { x: 2.4, z: 1, pose: 'walking', yaw: -90 }, end: { x: -1.5, z: -0.55, pose: 'sitting', face: 'Nora' } }] },
    ],
  };
  console.log(await runTool(toolsFor('shots', false), 'block_shots', JSON.stringify(opening), ctx));
  // A wide from the front for 1.2 so the walk to the table is visible.
  const two = p.shots.find((s) => s.number === '1.2')!;
  [p, h] = runCommand(p, h, setCamera(two.id, 'start', { target: [0, 1, -0.5], azimuth: 0, elevation: 10, distance: 6.5, lens: 24, roll: 0 }));
  const sheet = await openBrowserSheet();
  try {
    const ids = p.shots.slice(0, 4).map((s) => s.id);
    const url = await sheet.render(p, ids, ['start', 'middle', 'end']);
    expect(url).toMatch(/^data:image\/jpeg;base64,/);
    const out = process.env.LIVE_OUT ?? 'live-output/render-sheet.jpg';
    await saveDataUrl(url!, out);
    const over = await sheet.render(p, ids, ['start', 'end'], 'overhead');
    await saveDataUrl(over!, out.replace(/(\.\w+)$/, '-overhead$1'));
  } finally {
    await sheet.close();
  }
}, 180_000);
