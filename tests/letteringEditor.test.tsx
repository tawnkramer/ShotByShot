import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { LetteringEditor } from '../src/comic/LetteringEditor';
import { createProject } from '../src/state/schema';
import { useProjectStore } from '../src/state/store';

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
let root: ReturnType<typeof createRoot>, host: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 800, height: 600, close() {} })));
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  host?.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  await useProjectStore.getState().close();
});

const letters = () => useProjectStore.getState().project!.shots[0].lettering;
const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === label || b.getAttribute('aria-label') === label)!;
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

function type(el: HTMLTextAreaElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

function pointer(target: Element, type: string, x: number, y: number) {
  target.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: x, clientY: y }));
}

async function open() {
  const project = createProject('Comic');
  project.shots.push({ id: 's', number: '1.1', lineIds: ['l'] });
  useProjectStore.getState().open(project);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  const onClose = vi.fn();
  await act(async () => root.render(<LetteringEditor shot={project.shots[0]} art={new Blob(['png'])} artLabel="shot image" onClose={onClose} />));
  await settle();
  return onClose;
}

it('adds a balloon, takes its text, restyles and deletes it', async () => {
  await open();
  expect(document.querySelector('canvas')?.getAttribute('width')).toBe('800');
  await act(async () => button('+ Balloon').click());
  expect(letters()).toHaveLength(1);
  expect(letters()![0]).toMatchObject({ kind: 'speech', text: '', tail: { x: 0.5 } });
  const text = document.querySelector<HTMLTextAreaElement>('.lettering-text-sheet textarea')!;
  await act(async () => type(text, 'Where were you last night?'));
  expect(letters()![0].text).toBe('Where were you last night?');
  await act(async () => button('Done').click());
  expect(document.querySelector('.lettering-text-sheet')).toBeNull();
  expect(document.querySelector('[role="toolbar"]')).not.toBeNull();
  await act(async () => button('Larger text').click());
  expect(letters()![0].style).toEqual({ size: 29 });
  await act(async () => button('Oval').click());
  expect(letters()![0].style?.shape).toBe('rounded');
  await act(async () => button('No tail').click());
  expect(letters()![0].tail).toBeUndefined();
  await act(async () => button('Make default').click());
  expect(useProjectStore.getState().project!.lettering?.speech).toEqual({ size: 29, shape: 'rounded' });
  expect(letters()![0].style).toBeUndefined();
  await act(async () => button('Delete').click());
  expect(letters()).toBeUndefined();
});

it("seeds balloons from the panel's dialogue", async () => {
  const project = createProject('Comic');
  project.script = [
    { id: 'c1', index: 0, type: 'character', text: 'MAYA' }, { id: 'd1', index: 1, type: 'dialogue', text: 'You came back.' },
    { id: 'c2', index: 2, type: 'character', text: 'LEO' }, { id: 'd2', index: 3, type: 'dialogue', text: 'I never left.' },
  ];
  project.shots.push({ id: 's', number: '1', lineIds: ['c1', 'd1', 'c2', 'd2'] });
  useProjectStore.getState().open(project);
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<LetteringEditor shot={project.shots[0]} art={new Blob(['png'])} artLabel="shot image" onClose={() => {}} />));
  await settle();
  const lines = () => [...document.querySelectorAll<HTMLButtonElement>('.lettering-line')];
  expect(lines().map((b) => b.textContent)).toEqual(['MAYA You came back.', 'LEO I never left.']);
  await act(async () => button('+ Balloon').click());
  expect(letters()![0]).toMatchObject({ text: 'You came back.', lineId: 'd1' });
  // Seeded balloons don't open the keyboard; deselect to see the lines again.
  expect(document.querySelector('.lettering-text-sheet')).toBeNull();
  await act(async () => { document.querySelector<HTMLElement>('.lettering-stage')!.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true })); });
  expect(lines()[0].classList.contains('placed')).toBe(true);
  await act(async () => lines()[1].click());
  expect(letters()!.map((e) => e.text)).toEqual(['You came back.', 'I never left.']);
  // Read in order: the second is lower, or to the right on the same row.
  const [a, b] = letters()!;
  expect(b.y > a.y + 0.01 || (Math.abs(b.y - a.y) <= 0.01 && b.x > a.x)).toBe(true);
});

it('drops a caption left empty', async () => {
  await open();
  await act(async () => button('+ Caption').click());
  expect(letters()).toHaveLength(1);
  await act(async () => button('Done').click());
  expect(letters()).toBeUndefined();
});

it('drags a balloon as one undo step, and aims its tail', async () => {
  await open();
  await act(async () => button('+ Balloon').click());
  await act(async () => type(document.querySelector<HTMLTextAreaElement>('.lettering-text-sheet textarea')!, 'Hey!'));
  await act(async () => button('Done').click());
  const art = document.querySelector('[data-testid="lettering-art"]')!;
  vi.spyOn(art, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600, x: 0, y: 0, toJSON() {} });
  const before = useProjectStore.getState().history.past.length;
  await act(async () => {
    pointer(art, 'pointerdown', 400, 132);
    pointer(art, 'pointermove', 440, 150);
    pointer(art, 'pointermove', 480, 162);
    pointer(art, 'pointerup', 480, 162);
  });
  expect(letters()![0].x).toBeCloseTo(0.6);
  expect(letters()![0].y).toBeCloseTo(0.27);
  expect(useProjectStore.getState().history.past.length).toBe(before + 1);
  const handle = document.querySelector('.lettering-tail-handle')!;
  await act(async () => {
    pointer(handle, 'pointerdown', 400, 300);
    pointer(art, 'pointermove', 200, 456);
    pointer(art, 'pointerup', 200, 456);
  });
  // The handle sits 56 px below the tip, so the tip lands above the finger.
  expect(letters()![0].tail!.x).toBeCloseTo(0.25);
  expect(letters()![0].tail!.y).toBeCloseTo(400 / 600);
});

it('auto letters the panel, and moving a balloon by hand pins it', async () => {
  const project = createProject('Comic', 'comic');
  const voice = { provider: 'browser' as const, voiceId: 'x', speed: 1 };
  project.characters = [
    { id: 'maya', name: 'Maya', sex: 'female', heightCm: 168, build: 'average', attributes: [], voice },
    { id: 'leo', name: 'Leo', sex: 'male', heightCm: 182, build: 'average', attributes: [], voice },
  ];
  project.script = [
    { id: 'c1', index: 0, type: 'character', text: 'MAYA' }, { id: 'd1', index: 1, type: 'dialogue', text: 'You came back.' },
    { id: 'c2', index: 2, type: 'character', text: 'LEO' }, { id: 'n', index: 3, type: 'dialogue', text: '(whispers)' }, { id: 'd2', index: 4, type: 'dialogue', text: 'Keep it down.' },
  ];
  project.shots.push({ id: 's', number: '1', lineIds: ['c1', 'd1', 'c2', 'n', 'd2'] });
  useProjectStore.getState().open(project);
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<LetteringEditor shot={project.shots[0]} art={new Blob(['png'])} artLabel="previs frame" onClose={() => {}} />));
  await settle();
  await act(async () => button('Auto letter').click());
  expect(letters()!.map((e) => [e.kind, e.text, e.targetCharacterId, e.auto])).toEqual([
    ['speech', 'You came back.', 'maya', true],
    ['whisper', 'Keep it down.', 'leo', true],
  ]);
  const first = letters()![0];
  const art = document.querySelector('[data-testid="lettering-art"]')!;
  vi.spyOn(art, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600, x: 0, y: 0, toJSON() {} });
  await act(async () => {
    pointer(art, 'pointerdown', first.x * 800, first.y * 600);
    pointer(art, 'pointermove', first.x * 800 + 20, first.y * 600 + 10);
    pointer(art, 'pointerup', first.x * 800 + 20, first.y * 600 + 10);
  });
  const moved = letters()!.find((e) => e.id === first.id)!;
  expect(moved.auto).toBeUndefined();
  // Auto letter again: the pinned balloon stays where it was put.
  await act(async () => button('Auto letter').click());
  expect(letters()!.find((e) => e.id === first.id)).toMatchObject({ x: moved.x, y: moved.y });
  expect(letters()).toHaveLength(2);
});
