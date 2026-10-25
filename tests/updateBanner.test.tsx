import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';

// The plugin's virtual module, replaced so the test can play the part of the new service worker.
const registered: { onNeedReload?: () => void } = {};
vi.mock('virtual:pwa-register/react', async () => {
  const { useState } = await import('react');
  return {
    useRegisterSW: (options: { onNeedReload?: () => void }) => {
      registered.onNeedReload = options.onNeedReload;
      return { needRefresh: useState(false), offlineReady: useState(false), updateServiceWorker: async () => {} };
    },
  };
});
const { UpdateBanner } = await import('../src/shell/UpdateBanner');

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
let root: ReturnType<typeof createRoot> | undefined;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
});

it('keeps the banner up when a new version takes over, instead of reloading on its own', async () => {
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(<UpdateBanner />));
  expect(host.textContent).toBe('');
  // Without onNeedReload the plugin calls location.reload() here, and the banner only flashes.
  expect(registered.onNeedReload).toBeTypeOf('function');
  await act(async () => registered.onNeedReload!());
  expect(host.textContent).toContain('New version available');
  host.remove();
});
