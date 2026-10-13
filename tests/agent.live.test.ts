// @vitest-environment node
/**
 * Asks the real assistant to block the Cold Coffee scene, then plan its camera, with real renders
 * for render_shots (headless Chromium via tests/live/browser.ts). Skipped
 * unless LIVE_AGENT and OPENAI_API_KEY or GEMINI_API_KEY are set; the run is billed to that key.
 *   LIVE_AGENT=1 OPENAI_API_KEY=sk-… npx vitest run tests/agent.live.test.ts
 *   LIVE_AGENT=1 GEMINI_API_KEY=AIza… npx vitest run tests/agent.live.test.ts
 * LIVE_MODEL picks the chat model (default: the app's automatic choice).
 * LIVE_PROMPT is the requests, separated by "|". Contact sheets and a log go to live-output/.
 */
import 'fake-indexeddb/auto';
import { expect, it } from 'vitest';
import { emptyHistory, runCommand, type History } from '../src/state/commands';
import type { Project } from '../src/state/schema';
import { setSetting } from '../src/storage/db';
import { CHAT_MODEL_SETTING } from '../src/ai/chat';
import { assistantModel, runTurn } from '../src/ai/agent';
import { describeScene } from '../src/ai/context';
import { checkCoverage, formatFindings } from '../src/shots/coverage';
import { coldCoffee } from './fixtures/coldCoffee';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { openBrowserSheet, saveDataUrl } from './live/browser';

const openaiKey = process.env.LIVE_AGENT ? process.env.OPENAI_API_KEY : undefined;
const geminiKey = process.env.LIVE_AGENT ? process.env.GEMINI_API_KEY : undefined;
const key = openaiKey || geminiKey;
const OUT = process.env.LIVE_OUT ?? 'live-output';

/** Vitest hides a passing test's console, so the run also goes to a log file. */
function log(text: string) {
  console.log(text);
  appendFileSync(`${OUT}/log.txt`, text + '\n');
}

it.skipIf(!key)('stages and shoots the Cold Coffee scene', async () => {
  if (process.env.LIVE_MODEL) await setSetting(CHAT_MODEL_SETTING, process.env.LIVE_MODEL);
  mkdirSync(OUT, { recursive: true });
  writeFileSync(`${OUT}/log.txt`, '');
  let p: Project = coldCoffee();
  let h: History = emptyHistory();
  const sheet = await openBrowserSheet();
  let sheets = 0;
  const history: { role: 'user' | 'assistant'; text: string }[] = [];
  // Review sheets of every shot, six at a time.
  const review = async (prefix: string, view: 'camera' | 'overhead') => {
    for (let i = 0; i < p.shots.length; i += 6) {
      const url = await sheet.render(p, p.shots.slice(i, i + 6).map((s) => s.id), ['start', 'end'], view);
      if (url) await saveDataUrl(url, `${OUT}/${prefix}-${i / 6 + 1}.jpg`);
    }
  };
  try {
    log(`Model: ${(await assistantModel({ openai: openaiKey, gemini: geminiKey })).model}`);
    // One turn per prompt, like the user asking in the chat: block, review, then the camera.
    for (const text of (process.env.LIVE_PROMPT ?? 'Block the scene.|Plan the camera.').split('|')) {
      const started = Date.now();
      const before = h.past.length;
      log(`\n===== ${text}`);
      const reply = await runTurn({
        text,
        history,
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
        apiKey: openaiKey,
        geminiApiKey: geminiKey,
      });
      history.push({ role: 'user', text }, { role: 'assistant', text: reply });
      log(`\nReply (${Math.round((Date.now() - started) / 1000)} s, ${h.past.length - before} changes):\n${reply}`);
      const camera = /camera|cover|shoot/i.test(text);
      await review(camera ? 'camera' : 'blocking', camera ? 'camera' : 'overhead');
    }
    log('\n' + describeScene(p, {}).split('Stage "')[0]);
    log('\nFinal check:\n' + formatFindings(checkCoverage(p).findings));
    expect(h.past.length).toBeGreaterThan(0);
  } finally {
    await sheet.close();
  }
}, 30 * 60_000);
