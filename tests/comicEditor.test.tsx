import { act, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { ShotEditor } from '../src/steps/shots/ShotEditor';
import { createProject } from '../src/state/schema';
import { useProjectStore } from '../src/state/store';
import type { ShotCanvasProps } from '../src/steps/shots/ShotCanvas';

vi.mock('../src/steps/shots/ShotCanvas', () => ({ ShotCanvas: (p: ShotCanvasProps) => {
  useEffect(() => { p.onCaptureReady?.(async () => ({ blob: new Blob(['frame'], { type: 'image/png' }), characterIds: [], progress: 0 })); return () => p.onCaptureReady?.(null); }, [p.onCaptureReady]);
  return <div data-testid="canvas" data-aspect={String(p.aspect)} />;
} }));
vi.mock('../src/shots/thumbnail', () => ({ renderShotThumbnail: vi.fn(async () => 'previs:thumbnail') }));
vi.mock('../src/steps/shots/CameraPad', () => ({ CameraPad: () => <div data-testid="camera-pad" /> }));
vi.mock('../src/steps/shots/BlockingPanel', () => ({ BlockingPanel: () => <div data-testid="blocking" /> }));
vi.mock('../src/steps/common/AudioPanel', () => ({ AudioPanel: () => <div data-testid="audio" /> }));
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
let root: ReturnType<typeof createRoot>, host: HTMLDivElement;
afterEach(async () => { if (root) await act(async () => root.unmount()); host?.remove(); await useProjectStore.getState().close(); });

async function open(medium: 'film' | 'comic') {
  const project = createProject('Editor', medium);
  project.script.push({ id: 'l', index: 0, type: 'action', text: 'Rain on the window.' });
  project.shots.push({ id: 'p', number: '1', lineIds: ['l'] });
  useProjectStore.getState().open(project);
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<MemoryRouter><ShotEditor shotId="p" /></MemoryRouter>));
}
const tab = (name: string) => [...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((t) => t.textContent === name)!;
const buttons = (sel: string) => [...host.querySelectorAll<HTMLButtonElement>(sel)].map((b) => b.textContent);

it('edits a comic panel as one frozen moment with its own shape', async () => {
  await open('comic');
  expect(host.querySelector('.timeline')).toBeNull();
  expect(host.querySelector('[data-testid="audio"]')).toBeNull();
  await act(async () => tab('Camera').click());
  expect(host.querySelector('[aria-label="Camera movement"]')).toBeNull();
  expect(host.querySelector('[data-testid="canvas"]')?.getAttribute('data-aspect')).toBe(String(4 / 3));
  const tall = [...host.querySelectorAll<HTMLButtonElement>('[aria-label="Panel shape"] button')].find((b) => b.textContent === 'Tall 3:4')!;
  await act(async () => tall.click());
  expect(useProjectStore.getState().project!.shots[0].panel).toEqual({ shape: '3:4' });
  expect(host.querySelector('[data-testid="canvas"]')?.getAttribute('data-aspect')).toBe(String(3 / 4));
  await act(async () => tab('Image').click());
  expect(buttons('.shot-image-panel > button')).toEqual(['Generate or Upload Image', 'Add Lettering']);
});

it('keeps the film tools in film projects', async () => {
  await open('film');
  expect(host.querySelector('.timeline')).not.toBeNull();
  expect(host.querySelector('[data-testid="audio"]')).not.toBeNull();
  await act(async () => tab('Camera').click());
  expect(host.querySelector('[aria-label="Camera movement"]')).not.toBeNull();
  expect(host.querySelector('[aria-label="Panel shape"]')).toBeNull();
});
