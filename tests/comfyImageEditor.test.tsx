import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import qwen from './fixtures/qwen_image_2_1_t2i.json';
import { ConceptImageEditor, IMAGE_PREFERENCES_SETTING } from '../src/images/ConceptImageEditor';
import { importWorkflow, saveWorkflows } from '../src/comfy/settings';
import { COMFY_KEY_SETTING } from '../src/comfy/client';
import { createProject } from '../src/state/schema';
import { newCharacter } from '../src/characters/commands';
import { useProjectStore } from '../src/state/store';
import { deleteSetting, setSetting } from '../src/storage/db';

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  host?.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals();
  await useProjectStore.getState().close();
});
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

it('generates a character image with an imported Comfy text-to-image workflow', async () => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: function (this: HTMLDialogElement) { this.setAttribute('open', ''); } });
  URL.createObjectURL = vi.fn(() => 'blob:test'); URL.revokeObjectURL = vi.fn();
  vi.stubGlobal('visualViewport', Object.assign(new EventTarget(), { height: 844, offsetTop: 0 }));
  const workflow = importWorkflow(JSON.stringify(qwen), 'Qwen Image 2.1.json', 'image');
  await saveWorkflows([workflow]);
  await setSetting(COMFY_KEY_SETTING, 'comfy-key');
  await setSetting(IMAGE_PREFERENCES_SETTING, { model: `comfy:${workflow.id}`, quality: 'medium' });
  const p = createProject('Comfy image'); p.characters.push(newCharacter('Ben', [], 'ben'));
  useProjectStore.getState().open(p);

  const job = { id: 'j', status: 'queued', created_at: '', started_at: null, completed_at: null, queue_position: 0, progress: null, outputs: [], error: null, urls: { self: '/api/v2/jobs/j', cancel: '/api/v2/jobs/j/cancel' } };
  const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => {
    if (url.endsWith('/api/v2/jobs')) return json(job, 201);
    if (url.endsWith('/api/v2/jobs/j')) return json({ ...job, status: 'succeeded', outputs: [{ node_id: '461', name: 'q.png', type: 'image', content_type: 'image/png', id: 'out' }] });
    if (url.endsWith('/api/v2/assets/out')) return json({ id: 'out', hash: null, url: 'https://storage.example/q.png' });
    if (url === 'https://storage.example/q.png') return new Response('png', { headers: { 'Content-Type': 'image/png' } });
    throw new Error(`unexpected ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  vi.useFakeTimers({ shouldAdvanceTime: true });

  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<MemoryRouter><ConceptImageEditor subject={p.characters[0]} kind="character" defaultPrompt="Ben, a tall detective." onClose={vi.fn()} /></MemoryRouter>));
  await vi.waitFor(async () => { await act(async () => { await vi.advanceTimersByTimeAsync(10); }); expect(document.querySelector('select')?.value).toBe(`comfy:${workflow.id}`); });
  const dialog = document.querySelector('dialog')!;
  expect(dialog.querySelector('optgroup')?.label).toBe('ComfyUI Cloud');
  expect(dialog.querySelectorAll('select')).toHaveLength(1); // no OpenAI quality choice
  expect(dialog.textContent).toContain('using your Comfy Cloud key');

  await act(async () => [...dialog.querySelectorAll('button')].find((b) => b.textContent === 'Generate image')!.click());
  await vi.waitFor(async () => { await act(async () => { await vi.advanceTimersByTimeAsync(3500); }); expect([...dialog.querySelectorAll('button')].some((b) => b.textContent === 'Use image')).toBe(true); });
  vi.useRealTimers();
  const submitted = JSON.parse(fetchMock.mock.calls.find(([url]) => url.endsWith('/api/v2/jobs'))![1]!.body as string).workflow;
  expect(submitted['459:474'].inputs.on_false).toBe('Ben, a tall detective.');
  // Portrait character art at the workflow's 1 MP budget.
  expect(submitted['459:456'].inputs).toMatchObject({ width: 816, height: 1224 });
});

it('offers the built-in Qwen workflow for props once a Comfy key is saved', async () => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: function (this: HTMLDialogElement) { this.setAttribute('open', ''); } });
  URL.createObjectURL = vi.fn(() => 'blob:test'); URL.revokeObjectURL = vi.fn();
  vi.stubGlobal('visualViewport', Object.assign(new EventTarget(), { height: 844, offsetTop: 0 }));
  const p = createProject('Comfy prop'); p.characters.push(newCharacter('Ben', [], 'ben'));
  useProjectStore.getState().open(p);
  const options = async () => {
    host = document.createElement('div'); document.body.append(host); root = createRoot(host);
    await act(async () => root.render(<MemoryRouter><ConceptImageEditor subject={p.characters[0]} kind="prop" defaultPrompt="A brass key." reference={new Blob(['png'], { type: 'image/png' })} onClose={vi.fn()} /></MemoryRouter>));
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    const labels = [...document.querySelectorAll('option')].map((o) => o.textContent);
    await act(async () => root.unmount()); host.remove();
    return labels;
  };
  await deleteSetting(COMFY_KEY_SETTING); await saveWorkflows([]);
  expect(await options()).not.toContain('Qwen Image 2.1 (prompt only)');
  await setSetting(COMFY_KEY_SETTING, 'comfy-key');
  expect(await options()).toContain('Qwen Image 2.1 (prompt only)');
});
