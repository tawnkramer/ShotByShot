/**
 * Renders contact sheets for node-side live tests: starts the Vite dev server,
 * opens tests/live/sheet.html in headless Chromium, and renders there.
 */
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import type { Project } from '../../src/state/schema';
import type { SheetMoment, SheetView } from '../../src/export/contactSheet';

/** The bits of Playwright used here (it's not a project dependency). */
interface Page {
  on(event: 'pageerror', fn: (e: Error) => void): void;
  goto(url: string): Promise<unknown>;
  waitForFunction(fn: () => boolean, arg: undefined, opts: { timeout: number }): Promise<unknown>;
  evaluate<R, A>(fn: (arg: A) => R | Promise<R>, arg: A): Promise<R>;
}
interface Playwright {
  chromium: { launch(opts: { executablePath?: string; args?: string[] }): Promise<{ newPage(): Promise<Page>; close(): Promise<void> }> };
}

async function loadPlaywright(): Promise<Playwright> {
  try {
    return (await import(/* @vite-ignore */ 'playwright' as string)) as Playwright;
  } catch {
    // Not a project dependency: fall back to a global install.
    const root = execSync('npm root -g').toString().trim();
    return createRequire(`${root}/`)('playwright') as Playwright;
  }
}

export interface BrowserSheet {
  render: (project: Project, shotIds: string[], moments: SheetMoment[], view?: SheetView) => Promise<string | null>;
  close: () => Promise<void>;
}

export async function openBrowserSheet(): Promise<BrowserSheet> {
  const { createServer } = await import('vite');
  const server = await createServer({ server: { port: 0, host: '127.0.0.1' }, logLevel: 'error' });
  await server.listen();
  const url = server.resolvedUrls!.local[0];
  const { chromium } = await loadPlaywright();
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.error('[sheet page]', e.message));
  await page.goto(`${url}tests/live/sheet.html`);
  await page.waitForFunction(() => document.title === 'ready', undefined, { timeout: 60_000 });
  return {
    render: (project, shotIds, moments, view = 'camera') => page.evaluate(([p, ids, m, v]) => window.renderSheet(p, ids, m, v), [project, shotIds, moments, view] as [Project, string[], SheetMoment[], SheetView]),
    close: async () => {
      await browser.close();
      await server.close();
    },
  };
}

/** Writes a JPEG data URL to a file. */
export async function saveDataUrl(dataUrl: string, path: string): Promise<void> {
  const { writeFileSync, mkdirSync } = await import('node:fs');
  const { dirname } = await import('node:path');
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, Buffer.from(dataUrl.split(',')[1], 'base64'));
}
