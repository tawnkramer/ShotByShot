import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import warrior from './fixtures/pose/warrior.json';
import { MatchPhotoSheet } from '../src/steps/shots/MatchPhotoSheet';
import { emptyHistory, runCommand, type Command } from '../src/state/commands';
import { createProject, type Project } from '../src/state/schema';
import { useProjectStore } from '../src/state/store';
import { importScript } from '../src/story/commands';
import { addCharacters } from '../src/characters/commands';
import { createStagesForScenes } from '../src/staging/commands';
import { effectiveShot } from '../src/shots/setup';
import type { FoundPerson } from '../src/pose/detect';

const found = vi.hoisted(() => ({ people: [] as unknown[] }));
vi.mock('../src/pose/detect', () => ({ findPeople: vi.fn(async () => found.people), preloadDetector: vi.fn() }));
vi.mock('../src/shell/download', () => ({ pickFile: vi.fn(async () => new File(['x'], 'beach.jpg', { type: 'image/jpeg' })), saveFile: vi.fn() }));
vi.mock('../src/shots/thumbnail', () => ({ renderShotAt: vi.fn(async () => 'blob:preview') }));

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
let root: ReturnType<typeof createRoot>, host: HTMLDivElement;
const person = warrior.person as unknown as FoundPerson;
beforeEach(() => {
  vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: warrior.width, height: warrior.height, close: () => {} })));
  URL.createObjectURL = vi.fn(() => 'blob:photo');
  URL.revokeObjectURL = vi.fn();
  found.people = [person];
});
afterEach(async () => { if (root) await act(async () => root.unmount()); host?.remove(); vi.unstubAllGlobals(); await useProjectStore.getState().close(); });

function project(): Project {
  let [p, h] = runCommand(createProject('T'), emptyHistory(), importScript('INT. BEACH - DAY\n\nMAYA\nHi.\n\nDEX\nHey.'));
  const cmds: Command[] = [addCharacters(['Maya', 'Dex'], ['maya', 'dex']), createStagesForScenes(p).command];
  for (const c of cmds) [p, h] = runCommand(p, h, c);
  return p;
}
const shotNow = () => {
  const p = useProjectStore.getState().project!;
  return effectiveShot(p, p.shots[0].id)!;
};
const button = (text: string) => [...document.querySelectorAll('button')].find((b) => b.textContent === text);
const settle = async () => { for (let i = 0; i < 5; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };

async function open(characterId: string | null = 'dex') {
  useProjectStore.getState().open(project());
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  const p = useProjectStore.getState().project!;
  const onClose = vi.fn();
  await act(async () => root.render(<MatchPhotoSheet project={p} shot={p.shots[0]} eff={effectiveShot(p, p.shots[0].id)!} editKey="start" characterId={characterId} onClose={onClose} />));
  return onClose;
}

it('poses the selected character and frames the camera from a photo, as one undo', async () => {
  const onClose = await open('dex');
  const before = shotNow();
  await act(async () => button('Choose a photo')!.click());
  await settle();
  // The selected character is the one matched; a preview with the photo over it.
  expect((document.querySelector('select') as HTMLSelectElement).value).toBe('dex');
  expect(document.querySelector('.match-preview img')?.getAttribute('src')).toBe('blob:preview');
  expect(document.querySelector('.match-photo-layer')).not.toBeNull();
  // No EXIF lens: the estimate can be changed.
  expect(document.querySelector('input[aria-label="Lens"]')).not.toBeNull();

  await act(async () => button('Apply')!.click());
  expect(onClose).toHaveBeenCalled();
  const after = shotNow();
  const dex = after.setup.actors.find((a) => a.characterId === 'dex')!.motion.start;
  expect(dex.joints?.kneeR).toBeDefined();
  // The character stays put; the camera moves.
  expect(dex.position).toEqual(before.setup.actors.find((a) => a.characterId === 'dex')!.motion.start.position);
  expect(after.camera.start).not.toEqual(before.camera.start);

  await act(async () => useProjectStore.getState().undo());
  const undone = shotNow();
  expect(undone.setup.actors.find((a) => a.characterId === 'dex')!.motion.start.joints).toBeUndefined();
  expect(undone.camera.start).toEqual(before.camera.start);
});

it('can match only the pose, and lets you pick who in the photo', async () => {
  found.people = [person, { ...person, box: { x: 0.05, y: 0.1, w: 0.2, h: 0.5 } }];
  await open('maya');
  const before = shotNow();
  await act(async () => button('Choose a photo')!.click());
  await settle();
  const people = document.querySelectorAll<HTMLButtonElement>('.photo-people button');
  expect(people).toHaveLength(2);
  expect(people[0].getAttribute('aria-pressed')).toBe('true');
  await act(async () => people[1].click());
  expect(people[1].getAttribute('aria-pressed')).toBe('true');
  const cameraBox = [...document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')][1];
  await act(async () => cameraBox.click());
  expect(document.querySelector('input[aria-label="Lens"]')).toBeNull();
  await act(async () => button('Apply')!.click());
  const after = shotNow();
  expect(after.setup.actors.find((a) => a.characterId === 'maya')!.motion.start.joints).toBeDefined();
  expect(after.camera.start).toEqual(before.camera.start);
});

it('says when no one is in the photo', async () => {
  found.people = [];
  await open();
  await act(async () => button('Choose a photo')!.click());
  await settle();
  expect(document.querySelector('.error')?.textContent).toMatch(/No one found/);
  expect(button('Apply')).toBeUndefined();
});
