// @vitest-environment node
/**
 * Runs the app's MediaPipe pose detection on a real photo in headless
 * Chromium, records what it found as a fixture for the normal tests
 * (tests/fixtures/pose/), and draws the matched mannequin over the photo to
 * check by eye. Free: everything runs locally; it only downloads the photo.
 *   LIVE_POSE=1 npx vitest run tests/pose.live.test.ts
 */
import { expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { saveDataUrl } from './live/browser';
import './live/pose-types';

/** Photos from MediaPipe's own test assets. */
const PHOTOS = { warrior: 'https://storage.googleapis.com/mediapipe-assets/pose.jpg' };

it.skipIf(!process.env.LIVE_POSE)('detects and matches poses in real photos', async () => {
  const { createServer } = await import('vite');
  const server = await createServer({ server: { port: 0, host: '127.0.0.1' }, logLevel: 'error' });
  await server.listen();
  const root = execSync('npm root -g').toString().trim();
  const { chromium } = createRequire(`${root}/`)('playwright');
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  try {
    const page = await browser.newPage();
    page.on('pageerror', (e: Error) => console.error('[pose page]', e.message));
    page.on('console', (m: { text(): string }) => console.log('[pose page]', m.text()));
    await page.goto(`${server.resolvedUrls!.local[0]}tests/live/pose.html`);
    await page.waitForFunction(() => document.title === 'ready', undefined, { timeout: 60_000 });
    for (const [name, url] of Object.entries(PHOTOS)) {
      const bytes = Buffer.from(await (await fetch(url)).arrayBuffer());
      const dataUrl = `data:image/jpeg;base64,${bytes.toString('base64')}`;
      const found: Awaited<ReturnType<typeof window.detectPhoto>> = await page.evaluate((u: string) => window.detectPhoto(u), dataUrl);
      expect(found.people.length, name).toBeGreaterThan(0);
      mkdirSync('tests/fixtures/pose', { recursive: true });
      // Rounded: millimetres and thousandths are plenty, and keep the fixture small.
      const round = (x: number) => Math.round(x * 1000) / 1000;
      const person = found.people[0];
      const fixture = { source: url, width: found.width, height: found.height, person: { image: person.image.map((p) => ({ x: round(p.x), y: round(p.y), visibility: round(p.visibility) })), world: person.world.map((p) => p.map(round)), box: person.box } };
      writeFileSync(`tests/fixtures/pose/${name}.json`, JSON.stringify(fixture) + '\n');
      const drawn = await page.evaluate(([u, p]: [string, typeof person]) => window.drawMatch(u, p, 16 / 9), [dataUrl, person] as [string, typeof person]);
      console.log(name, JSON.stringify({ pose: drawn.result?.key.pose, joints: drawn.result?.key.joints, camera: drawn.result?.camera, error: drawn.result?.error, warnings: drawn.result?.warnings }));
      await saveDataUrl(drawn.image, `${process.env.LIVE_OUT ?? 'live-output'}/pose-${name}.jpg`);
    }
  } finally {
    await browser.close();
    await server.close();
  }
}, 180_000);
