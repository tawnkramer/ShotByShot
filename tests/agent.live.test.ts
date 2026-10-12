// @vitest-environment node
/**
 * Asks the real assistant to block the Cold Coffee scene, with real renders
 * for render_shots (headless Chromium via tests/live/browser.ts). Skipped
 * unless LIVE_AGENT and OPENAI_API_KEY are set; the run is billed to that key.
 *   LIVE_AGENT=1 OPENAI_API_KEY=sk-… npx vitest run tests/agent.live.test.ts
 * LIVE_MODEL picks the chat model (default: the app's automatic choice).
 * Contact sheets are written to live-output/.
 */
import 'fake-indexeddb/auto';
import { expect, it } from 'vitest';
import { emptyHistory, runCommand, type History } from '../src/state/commands';
import type { Project } from '../src/state/schema';
import { setSetting } from '../src/storage/db';
import { CHAT_MODEL_SETTING } from '../src/ai/chat';
import { runTurn } from '../src/ai/agent';
import { describeScene } from '../src/ai/context';
import { coldCoffee } from './fixtures/coldCoffee';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { openBrowserSheet, saveDataUrl } from './live/browser';

const key = process.env.LIVE_AGENT ? process.env.OPENAI_API_KEY : undefined;
const OUT = process.env.LIVE_OUT ?? 'live-output';

/** Vitest hides a passing test's console, so the run also goes to a log file. */
function log(text: string) {
  console.log(text);
  appendFileSync(`${OUT}/log.txt`, text + '\n');
}

it.skipIf(!key)('blocks the Cold Coffee scene', async () => {
  if (process.env.LIVE_MODEL) await setSetting(CHAT_MODEL_SETTING, process.env.LIVE_MODEL);
  mkdirSync(OUT, { recursive: true });
  writeFileSync(`${OUT}/log.txt`, '');
  let p: Project = coldCoffee();
  let h: History = emptyHistory();
  const sheet = await openBrowserSheet();
  let sheets = 0;
  try {
    const started = Date.now();
    const reply = await runTurn({
      text: process.env.LIVE_PROMPT ?? 'Block the scene.',
      history: [],
      step: 'shots',
      getProject: () => p,
      dispatch: (cmd) => void ([p, h] = runCommand(p, h, { ...cmd, source: 'ai', tag: 'live' })),
      stageId: () => p.stages[0]?.id,
      setStage: () => {},
      navigate: (path) => console.log('navigate', path),
      snapshot: async () => null,
      renderSheet: async (ids, moments, view) => {
        const url = await sheet.render(p, ids, moments, view);
        if (url) await saveDataUrl(url, `${OUT}/agent-sheet-${++sheets}.jpg`);
        return url;
      },
      onTool: (name, args, result) => log(`\n>>> ${name} ${args}\n<<< ${result}`),
      apiKey: key,
    });
    log(`\nReply (${Math.round((Date.now() - started) / 1000)} s, ${h.past.length} changes):\n${reply}`);
    log('\n' + describeScene(p, {}).split('Stage "')[0]);
    // Review sheets of every shot at its end, six at a time.
    for (let i = 0; i < p.shots.length; i += 6) {
      const url = await sheet.render(p, p.shots.slice(i, i + 6).map((s) => s.id), ['start', 'end'], 'overhead');
      if (url) await saveDataUrl(url, `${OUT}/blocking-${i / 6 + 1}.jpg`);
    }
    expect(h.past.length).toBeGreaterThan(0);
  } finally {
    await sheet.close();
  }
}, 20 * 60_000);
