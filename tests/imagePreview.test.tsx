import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { ZoomableImage } from '../src/images/ImagePreview';

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
let root: ReturnType<typeof createRoot>;
let host: HTMLDivElement;
afterEach(async () => { if (root) await act(async () => root.unmount()); host?.remove(); vi.restoreAllMocks(); });

it('opens a full-screen viewer, supports zoom, pan, pinch, fit, and closes back to the image', async () => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: function (this: HTMLDialogElement) { this.setAttribute('open', ''); } });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<ZoomableImage src="blob:art" alt="Mug artwork" />));
  await act(async () => host.querySelector('button')!.click());
  const dialog = document.querySelector('dialog')!;
  expect(dialog.open).toBe(true);
  const surface = dialog.querySelector<HTMLDivElement>('.image-preview-surface')!;
  const img = dialog.querySelector('img')!;
  const button = (label: string) => dialog.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!;
  await act(async () => button('Zoom in').click());
  expect(img.style.transform).toContain('scale(1.5)');
  await act(async () => surface.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })));
  expect(img.style.transform).toContain('translate(40px');
  await act(async () => [...dialog.querySelectorAll('button')].find(b => b.textContent === 'Fit')!.click());
  expect(img.style.transform).toBe('translate(0px, 0px) scale(1)');
  surface.setPointerCapture = vi.fn();
  const pointer = async (type: string, id: number, x: number) => act(async () => {
    const event = new Event(type, { bubbles: true });
    Object.assign(event, { pointerId: id, clientX: x, clientY: 0, button: 0 });
    surface.dispatchEvent(event);
  });
  await pointer('pointerdown', 1, 0);
  await pointer('pointerdown', 2, 100);
  await pointer('pointermove', 2, 200);
  expect(img.style.transform).toContain('scale(2)');
  await pointer('pointerup', 2, 200);
  await pointer('pointermove', 1, 30);
  expect(img.style.transform).toContain('translate(30px');
  await pointer('pointercancel', 1, 30);
  await act(async () => surface.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, cancelable: true })));
  expect(img.style.transform).not.toContain('scale(2)');
  await act(async () => button('Close image preview').click());
  expect(document.querySelector('dialog')).toBeNull();
  expect(host.querySelector('img')?.src).toBe('blob:art');
  await act(async () => host.querySelector('button')!.click());
  await act(async () => document.querySelector('dialog')!.dispatchEvent(new Event('cancel', { cancelable: true })));
  expect(document.querySelector('dialog')).toBeNull();
});
