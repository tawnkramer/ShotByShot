import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import fixture from './fixtures/minimax_h3_i2v.json';
import { ShotVideoEditor } from '../src/video/ShotVideoEditor';
import { importWorkflow, saveWorkflows } from '../src/comfy/settings';
import { COMFY_KEY_SETTING } from '../src/comfy/client';
import { createProject } from '../src/state/schema';
import { useProjectStore } from '../src/state/store';
import { getBlob, putBlob, setSetting } from '../src/storage/db';

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  host?.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals();
  await useProjectStore.getState().close();
});
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });

it('fills the workflow from the shot, runs it on Comfy Cloud, and saves the video', async () => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: function (this: HTMLDialogElement) { this.setAttribute('open', ''); } });
  // The client builds request URLs, so only the object URL helpers are replaced.
  URL.createObjectURL = vi.fn(() => 'blob:test'); URL.revokeObjectURL = vi.fn();
  await setSetting(COMFY_KEY_SETTING, 'comfy-key');
  await saveWorkflows([importWorkflow(JSON.stringify(fixture), 'MiniMax H3.json', 'video')]);
  await putBlob('shot-art', new Blob(['art'], { type: 'image/png' }));
  const p = createProject('Video UI');
  p.script.push({ id: 'line', index: 0, type: 'action', text: 'The door opens.' });
  p.shots.push({ id: 'shot', number: '2.1', lineIds: ['line'], image: { blob: 'shot-art', prompt: 'p', model: 'm', createdAt: 1 } });
  useProjectStore.getState().open(p);

  const job = { id: 'j', status: 'queued', created_at: '', started_at: '2026-10-11T00:00:00Z', completed_at: '2026-10-11T00:01:30Z', queue_position: 1, progress: null, outputs: [], error: null, urls: { self: '/api/v2/jobs/j', cancel: '/api/v2/jobs/j/cancel' } };
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/api/v2/assets')) return json({ id: 'in', hash: null, file_path: 'shot-114.png', url: '' }, 201);
    if (url.endsWith('/api/v2/jobs')) return json(job, 201);
    if (url.endsWith('/api/v2/jobs/j')) return json({ ...job, status: 'succeeded', outputs: [{ node_id: '92', name: 'out.mp4', type: 'video', content_type: 'video/mp4', id: 'out' }] });
    if (url.endsWith('/api/v2/assets/out')) return json({ id: 'out', hash: null, url: 'https://storage.example/out.mp4' });
    if (url === 'https://storage.example/out.mp4') return new Response('video-bytes');
    throw new Error(`unexpected ${url} ${init?.method}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  vi.useFakeTimers({ shouldAdvanceTime: true });

  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  const onClose = vi.fn();
  await act(async () => root.render(<MemoryRouter><ShotVideoEditor project={p} shot={p.shots[0]} onClose={onClose} /></MemoryRouter>));
  await vi.waitFor(async () => { await settle(); expect(document.querySelector('select')?.textContent).toContain('MiniMax H3'); });
  const dialog = document.querySelector('dialog')!;
  const slot = dialog.querySelector<HTMLSelectElement>('.video-slot select')!;
  expect(slot.value).toBe('shot-image');
  expect(dialog.querySelector('.video-slot')?.textContent).toContain('Picture 1 · Load Image #114');
  expect(dialog.querySelector('details.generated-image-prompt')?.hasAttribute('open')).toBe(false);
  expect(dialog.querySelector('details pre')?.textContent).toContain('<Picture 1> is the illustrated start frame of the shot.');
  expect(dialog.textContent).toContain('Cost estimate unavailable');

  const textarea = dialog.querySelector('textarea')!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, 'Slow and tense.'); textarea.dispatchEvent(new Event('input', { bubbles: true })); });
  expect(useProjectStore.getState().project!.shots[0].videoPrompt).toBe('Slow and tense.');

  const generate = [...dialog.querySelectorAll('button')].find((b) => b.textContent === 'Generate video')!;
  await act(async () => generate.click());
  await vi.waitFor(async () => { await act(async () => { await vi.advanceTimersByTimeAsync(3500); }); expect([...dialog.querySelectorAll('button')].some((b) => b.textContent === 'Use video')).toBe(true); });
  vi.useRealTimers();

  const submitted = JSON.parse(fetchMock.mock.calls.find(([url]) => url.endsWith('/api/v2/jobs'))![1]!.body as string);
  expect(submitted.workflow['114'].inputs.image).toEqual({ __type: 'core/ASSET', info: { id: 'in', file_path: 'shot-114.png' } });
  expect(submitted.workflow['105:104'].inputs.prompt).toMatch(/Slow and tense\.$/);
  expect(submitted.workflow['105:104'].inputs.width).toBeGreaterThan(submitted.workflow['105:104'].inputs.height);
  expect(fetchMock.mock.calls.find(([url]) => url.startsWith('https://storage.example'))![1]).toEqual({ signal: expect.any(AbortSignal) });
  expect(dialog.textContent).toContain('this run took 90 s');

  await act(async () => [...dialog.querySelectorAll('button')].find((b) => b.textContent === 'Use video')!.click());
  await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
  const video = useProjectStore.getState().project!.shots[0].video!;
  expect(video).toMatchObject({ workflow: 'MiniMax H3', additionalPrompt: 'Slow and tense.' });
  expect(await getBlob(video.blob)).toBeDefined();
});
