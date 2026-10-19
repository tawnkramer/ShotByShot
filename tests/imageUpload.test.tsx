import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { prepareUpload, UPLOAD_MODEL } from '../src/images/upload';
import { createProject } from '../src/state/schema';
import { newCharacter } from '../src/characters/commands';
import { useProjectStore } from '../src/state/store';
import { getBlob } from '../src/storage/db';

const picked = vi.hoisted(() => ({ file: null as File | null }));
vi.mock('../src/shell/download', () => ({ pickFile: vi.fn(async () => picked.file), saveFile: vi.fn() }));
import { ConceptImageEditor } from '../src/images/ConceptImageEditor';

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
let root: ReturnType<typeof createRoot> | undefined, host: HTMLDivElement | undefined;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  host?.remove(); root = undefined; host = undefined;
  vi.restoreAllMocks(); vi.unstubAllGlobals();
  await useProjectStore.getState().close();
});

const bitmap = (width: number, height: number) => vi.fn(async () => ({ width, height, close() {} }));

describe('prepareUpload', () => {
  it('keeps a small JPEG, PNG or WebP as it is', async () => {
    vi.stubGlobal('createImageBitmap', bitmap(1600, 1200));
    const file = new File(['jpeg'], 'maya.jpg', { type: 'image/jpeg' });
    expect(await prepareUpload(file)).toBe(file);
  });

  it('scales big photos down to 2048 px on the long side', async () => {
    vi.stubGlobal('createImageBitmap', bitmap(4032, 3024));
    const sizes: number[][] = [];
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: () => {} } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (this: HTMLCanvasElement, cb: BlobCallback, type?: string) {
      sizes.push([this.width, this.height]);
      cb(new Blob(['small'], { type }));
    });
    const out = await prepareUpload(new File(['huge'], 'IMG_0001.jpg', { type: 'image/jpeg' }));
    expect(sizes).toEqual([[2048, 1536]]);
    expect(out.type).toBe('image/jpeg');
  });

  it('turns other formats into JPEG, and refuses what it cannot open', async () => {
    vi.stubGlobal('createImageBitmap', bitmap(800, 600));
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: () => {} } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((cb: BlobCallback, type?: string) => cb(new Blob(['x'], { type })));
    expect((await prepareUpload(new File(['gif'], 'a.gif', { type: 'image/gif' }))).type).toBe('image/jpeg');
    await expect(prepareUpload(new File(['%PDF'], 'a.pdf', { type: 'application/pdf' }))).rejects.toThrow("isn't an image");
    vi.stubGlobal('createImageBitmap', vi.fn(async () => { throw new Error('decode'); }));
    await expect(prepareUpload(new File(['?'], 'a.heic', { type: 'image/heic' }))).rejects.toThrow("can't open that image");
  });
});

describe('uploading in the image editor', () => {
  it.each(['character', 'prop', 'shot'] as const)('saves an uploaded %s image, no API key needed', async (kind) => {
    Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: function (this: HTMLDialogElement) { this.setAttribute('open', ''); } });
    vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:test'), revokeObjectURL: vi.fn() });
    vi.stubGlobal('visualViewport', Object.assign(new EventTarget(), { height: 844, offsetTop: 0 }));
    vi.stubGlobal('createImageBitmap', bitmap(1200, 900));
    picked.file = new File(['my art'], 'art.png', { type: 'image/png' });
    const p = createProject('Upload');
    p.characters.push(newCharacter('Maya', [], 'maya'));
    p.props.push({ id: 'prop', name: 'Mug', source: { kind: 'library', item: 'mug' }, defaultScale: 1 });
    p.shots.push({ id: 'shot', number: '1.1', lineIds: ['l'] });
    useProjectStore.getState().open(p);
    host = document.createElement('div'); document.body.append(host);
    root = createRoot(host);
    const onClose = vi.fn();
    const subject = kind === 'character' ? p.characters[0] : kind === 'prop' ? p.props[0] : { id: 'shot', name: 'Shot 1.1' };
    await act(async () => root!.render(<MemoryRouter><ConceptImageEditor subject={subject} kind={kind} defaultPrompt="x" reference={kind === 'character' ? undefined : new Blob(['3d'])}
      references={kind === 'shot' ? [{ blob: 'ref', name: 'Maya', kind: 'character', characterId: 'maya', data: new Blob(['r']) }] : []}
      imageContext={kind === 'shot' ? { frameProgress: 0, aspect: 4 / 3 } : undefined} onClose={onClose} /></MemoryRouter>));
    const button = (t: string) => [...document.querySelectorAll<HTMLButtonElement>('dialog button')].find((b) => b.textContent === t)!;
    expect(button('Upload image').disabled).toBe(false);
    await act(async () => button('Upload image').click());
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(document.querySelector('[role="status"]')?.textContent).toContain('Your image is ready');
    // Nothing is saved until Use image.
    const item = () => { const pr = useProjectStore.getState().project!; return kind === 'character' ? pr.characters[0] : kind === 'prop' ? pr.props[0] : pr.shots[0]; };
    expect(item().image).toBeUndefined();
    await act(async () => button('Use image').click());
    await vi.waitFor(async () => { await act(async () => { await new Promise((r) => setTimeout(r, 5)); }); expect(onClose).toHaveBeenCalled(); });
    const image = item().image!;
    expect(image).toMatchObject({ model: UPLOAD_MODEL, prompt: '' });
    expect(image.guidanceBlob).toBeUndefined();
    expect(image.referenceImages).toBeUndefined();
    expect(await getBlob(image.blob)).toBeDefined();
    expect(onClose).toHaveBeenCalled();
  });
});
