import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { useProjectStore } from '../src/state/store';
import { useChatUI } from '../src/shell/chatUI';
import { matchSkill } from '../src/ai/skills';
import { coldCoffee } from './fixtures/coldCoffee';

vi.mock('../src/shots/thumbnail', () => ({ renderShotThumbnail: async () => null }));
vi.mock('../src/ai/agent', () => ({ runTurn: vi.fn(async () => 'Planned the camera.'), captureView: vi.fn(), prepareImage: vi.fn() }));
const { ShotsStep } = await import('../src/steps/shots/ShotsStep');

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
let root: ReturnType<typeof createRoot>;
let host: HTMLDivElement;
afterEach(async () => { if (root) await act(async () => root.unmount()); host?.remove(); });

it('asks the assistant to plan the blocking or the camera, as if typed', async () => {
  useProjectStore.setState({ project: coldCoffee() });
  useChatUI.setState({ expanded: false, pending: null, running: false });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<MemoryRouter><ShotsStep /></MemoryRouter>));
  const button = (label: string) => [...host.querySelectorAll('button')].find((b) => b.textContent === label)!;
  await act(async () => button('Plan blocking').click());
  expect(useChatUI.getState()).toMatchObject({ pending: 'Plan the blocking.', expanded: true });
  await act(async () => button('Plan cameras').click());
  expect(useChatUI.getState().pending).toBe('Plan the camera.');
  // Both requests load the Shot by Shot skill.
  for (const text of ['Plan the blocking.', 'Plan the camera.']) expect(matchSkill(text, 'shots')?.id).toBe('shot_by_shot');
  // While the assistant works, the buttons wait.
  await act(async () => useChatUI.setState({ running: true }));
  expect(button('Plan blocking').disabled).toBe(true);
  expect(button('Plan cameras').disabled).toBe(true);
});

it('sends a request from a button through the chat, like a typed one', async () => {
  const { IDBFactory } = await import('fake-indexeddb');
  const { resetDbForTests, setSetting } = await import('../src/storage/db');
  const { API_KEY_SETTING } = await import('../src/ai/openai');
  globalThis.indexedDB = new IDBFactory();
  resetDbForTests();
  await setSetting(API_KEY_SETTING, 'sk-test');
  const { runTurn } = await import('../src/ai/agent');
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  Element.prototype.scrollIntoView ??= () => {};
  const { ChatBar } = await import('../src/shell/ChatBar');
  const project = coldCoffee();
  useProjectStore.setState({ project });
  useChatUI.setState({ expanded: false, pending: null, running: false, draft: '' });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<MemoryRouter><ChatBar step="shots" projectId={project.id} /></MemoryRouter>));
  await act(async () => { useChatUI.getState().submit('Plan the camera.'); });
  await vi.waitFor(() => expect(runTurn).toHaveBeenCalled(), { timeout: 2000 });
  await act(async () => new Promise((r) => setTimeout(r, 50)));
  expect(runTurn).toHaveBeenCalledWith(expect.objectContaining({ text: 'Plan the camera.', step: 'shots' }));
  expect(useChatUI.getState()).toMatchObject({ pending: null, running: false });
  expect(document.body.textContent).toMatch(/Planned the camera\./);
  vi.unstubAllGlobals();
});
