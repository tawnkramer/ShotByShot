import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import fixture from './fixtures/minimax_h3_i2v.json';
import { ShotVideoEditor, VIDEO_WORKFLOW_SETTING } from '../src/video/ShotVideoEditor';
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
  const minimax = importWorkflow(JSON.stringify(fixture), 'MiniMax H3.json', 'video');
  await saveWorkflows([minimax]);
  await setSetting(VIDEO_WORKFLOW_SETTING, minimax.id);
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
  await vi.waitFor(async () => { await settle(); expect(document.querySelector('select')?.value).toBe(minimax.id); });
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
  expect(dialog.textContent).toContain('This run took 90 s.');
  // The finished video opens full screen, with Download and Close.
  const viewer = document.querySelector<HTMLDialogElement>('dialog.image-preview-dialog')!;
  expect(viewer.querySelector('video')?.getAttribute('src')).toBe('blob:test');
  expect([...viewer.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Download', 'Close']);
  await act(async () => [...viewer.querySelectorAll('button')].find((b) => b.textContent === 'Close')!.click());
  expect(document.querySelector('dialog.image-preview-dialog')).toBeNull();

  await act(async () => [...dialog.querySelectorAll('button')].find((b) => b.textContent === 'Use video')!.click());
  await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
  const video = useProjectStore.getState().project!.shots[0].video!;
  expect(video).toMatchObject({ workflow: 'MiniMax H3', additionalPrompt: 'Slow and tense.' });
  expect(await getBlob(video.blob)).toBeDefined();
});

it('defaults to Seedance 2.5, sends every chosen reference and shows its price', async () => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: function (this: HTMLDialogElement) { this.setAttribute('open', ''); } });
  URL.createObjectURL = vi.fn(() => 'blob:test'); URL.revokeObjectURL = vi.fn();
  await setSetting(COMFY_KEY_SETTING, 'comfy-key');
  await saveWorkflows([]);
  await setSetting(VIDEO_WORKFLOW_SETTING, 'gone');
  await putBlob('shot-art', new Blob(['art'], { type: 'image/png' }));
  await putBlob('ana-art', new Blob(['ana'], { type: 'image/png' }));
  await putBlob('line-audio', new Blob(['mp3'], { type: 'audio/mpeg' }));
  const p = createProject('Seedance UI');
  p.aspect = '16:9';
  p.characters.push({ id: 'ana', name: 'Ana', sex: 'female', heightCm: 165, build: 'slim', attributes: [], voice: { provider: 'openai', voiceId: 'alloy', speed: 1 }, image: { blob: 'ana-art', prompt: 'Ana', model: 'm', createdAt: 1 } });
  p.script.push({ id: 'line', index: 0, type: 'dialogue', text: 'You came.', speakerId: 'ana' });
  p.shots.push({ id: 'shot', number: '3.1', lineIds: ['line'], durationSec: 1.2, durationLocked: true, image: { blob: 'shot-art', prompt: 'p', model: 'm', createdAt: 1 },
    setup: { actors: [{ characterId: 'ana', motion: { mode: 'static', start: { position: [0, 0, 0], yaw: 0, pose: 'standing' }, easing: 'linear' } }], props: [], stageOverrides: {} } });
  useProjectStore.getState().open(p);

  const uploads: string[] = [];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/api/v2/assets')) { const name = (init!.body as FormData).get('file_path') as string; uploads.push(name); return json({ id: name, hash: null, file_path: name, url: '' }, 201); }
    if (url.endsWith('/api/v2/jobs')) return json({ id: 'j', status: 'failed', error: { code: 'x', message: 'stop here' }, outputs: [], urls: { self: '/api/v2/jobs/j', cancel: '/api/v2/jobs/j/cancel' } }, 201);
    throw new Error(`unexpected ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);

  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<MemoryRouter><ShotVideoEditor project={p} shot={p.shots[0]} onClose={vi.fn()} /></MemoryRouter>));
  await vi.waitFor(async () => { await settle(); expect(document.querySelector('select')?.value).toBe('builtin:seedance-2.5-reference'); });
  const dialog = document.querySelector('dialog')!;
  const legends = [...dialog.querySelectorAll('.video-group legend')].map((l) => l.textContent);
  expect(legends).toEqual(['Reference images · 2 of up to 30', 'Reference videos · 0 of up to 10', 'Reference audio · 0 of up to 10']);
  // A 1.2 s shot is too short to send as a reference video, and runs at Seedance's 4 s minimum.
  expect(dialog.textContent).toContain('Duration: 4 s. The shot is 1.2 s');
  expect(dialog.querySelector('details pre')?.textContent).toContain('Image 1 is the illustrated start frame of the shot.');
  expect(dialog.querySelector('details pre')?.textContent).toContain('<Subject 1> is Ana from Image 2');
  // 720p 16:9 for 4 s: floor(900 * 97) / 1000 * 0.015301
  expect(dialog.textContent).toContain(`Estimated cost: $${(Math.floor(900 * 97) / 1000 * 0.015301).toFixed(2)} USD`);

  // Unchecking every visual reference blocks the run.
  for (const box of [...dialog.querySelectorAll<HTMLInputElement>('.video-group input[type=checkbox]')].filter((b) => b.checked)) await act(async () => box.click());
  expect(dialog.textContent).toContain('Choose at least one reference image or video.');
  expect([...dialog.querySelectorAll('button')].find((b) => b.textContent === 'Generate video')!.disabled).toBe(true);
  await act(async () => dialog.querySelector<HTMLInputElement>('.video-group input[type=checkbox]')!.click());

  await act(async () => [...dialog.querySelectorAll('button')].find((b) => b.textContent === 'Generate video')!.click());
  await vi.waitFor(async () => { await settle(); expect(dialog.querySelector('[role=alert]')?.textContent).toContain('stop here'); });
  expect(uploads).toEqual(['shot-1.png']);
  const submitted = JSON.parse(fetchMock.mock.calls.find(([url]) => url.endsWith('/api/v2/jobs'))![1]!.body as string).workflow;
  const node = submitted['24'].inputs;
  expect(node).toMatchObject({ 'model.duration': 4, 'model.ratio': '16:9' });
  expect(submitted[node['model.reference_images.image_1'][0]]).toMatchObject({ class_type: 'LoadImage', inputs: { image: { info: { id: 'shot-1.png' } } } });
  expect(node['model.prompt']).toContain('Image 1 is the illustrated start frame');
});

it('offers Seedance on OpenArt once signed in and shows OpenArt’s quote', async () => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: function (this: HTMLDialogElement) { this.setAttribute('open', ''); } });
  URL.createObjectURL = vi.fn(() => 'blob:test'); URL.revokeObjectURL = vi.fn();
  const { OPENART_TOKEN_SETTING } = await import('../src/openart/auth');
  const { COMFY_RELAY_SETTING } = await import('../src/comfy/client');
  await setSetting(COMFY_RELAY_SETTING, 'https://relay.example');
  await setSetting(OPENART_TOKEN_SETTING, { access: 't' });
  await setSetting(VIDEO_WORKFLOW_SETTING, 'openart:byte-plus-seedance-2-5');
  await putBlob('shot-art', new Blob(['art'], { type: 'image/png' }));
  const p = createProject('OpenArt UI');
  p.script.push({ id: 'line', index: 0, type: 'action', text: 'The door opens.' });
  p.shots.push({ id: 'shot', number: '3', lineIds: ['line'], image: { blob: 'shot-art', prompt: 'p', model: 'm', createdAt: 1 } });
  useProjectStore.getState().open(p);
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(init.body as string) as { id?: number; method: string; params?: { name: string } };
    const result = body.params?.name === 'openart_model_cost' ? { structuredContent: { balance: 4000, items: [{ totalCredits: 420, affordable: true }] } } : {};
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result }), { headers: { 'Content-Type': 'application/json' } });
  }));
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<MemoryRouter><ShotVideoEditor project={p} shot={p.shots[0]} onClose={vi.fn()} /></MemoryRouter>));
  await vi.waitFor(async () => { await settle(); expect(document.querySelector('select')?.value).toBe('openart:byte-plus-seedance-2-5'); });
  const dialog = document.querySelector('dialog')!;
  expect([...dialog.querySelectorAll('optgroup')].map((g) => g.label)).toContain('OpenArt (your credits)');
  expect(dialog.querySelector('legend')?.textContent).toContain('Reference images · 1 of up to 9');
  await vi.waitFor(async () => { await settle(); expect(dialog.textContent).toContain('Cost: 420 OpenArt credits'); });
  expect(dialog.textContent).toContain('Your balance: 4000 credits');
  expect(dialog.textContent).not.toContain('Add Comfy key');
});
