import { strFromU8, unzipSync } from 'fflate';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildPdf } from '../src/comic/pdf';
import { comicsJsonEntry, defaultSlug, exportComic, publishOf } from '../src/comic/exportComic';
import { createProject, type Project } from '../src/state/schema';
import { putBlob } from '../src/storage/db';

vi.mock('../src/export/render', () => ({
  FilmRenderer: class {
    canvas = { width: 1, height: 1 };
    constructor(_p: unknown, public width: number, public height: number) {}
    async renderShot() {}
    dispose() {}
  },
}));

describe('PDF', () => {
  it('has one page per image, a valid xref and the JPEG bytes as-is', () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 1, 2, 3, 0xff, 0xd9]);
    const pdf = buildPdf([{ jpeg, width: 1600, height: 1200 }, { jpeg, width: 1600, height: 2000 }], 'Strip (1)');
    const text = new TextDecoder('latin1').decode(pdf);
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text).toContain('/Count 2');
    expect(text).toContain('/MediaBox [0 0 612 459]');
    expect(text).toContain('/MediaBox [0 0 612 765]');
    expect(text).toContain('/Title (Strip \\(1\\))');
    // Every xref offset points at its object.
    const xref = Number(text.match(/startxref\n(\d+)/)![1]);
    const rows = text.slice(xref).split('\n').slice(3).filter((r) => r.endsWith(' n '));
    rows.forEach((row, i) => expect(text.slice(Number(row.slice(0, 10)), Number(row.slice(0, 10)) + 10)).toMatch(new RegExp(`^${i + 1} 0 obj`)));
    expect(pdf.indexOf(0xd8)).toBeGreaterThan(0);
  });
});

describe('comic site details', () => {
  it('derive a slug, title and tags until they are set', () => {
    const p = createProject('Complicated - 07: Rain!', 'comic');
    expect(defaultSlug(p.name)).toBe('complicated_07_rain');
    expect(publishOf(p)).toEqual({ slug: 'complicated_07_rain', title: 'Complicated - 07: Rain!', tags: ['new'] });
    p.comic = { publish: { slug: 'com_07', tags: ['romance', 'drama'] } };
    expect(comicsJsonEntry(p, 18)).toEqual({ slug: 'com_07', title: 'Complicated - 07: Rain!', cover: '/comics/com_07/cover.jpg', pages: 18, tags: ['romance', 'drama'] });
  });
});

describe('exportComic', () => {
  let project: Project;
  beforeEach(async () => {
    project = createProject('Strip', 'comic');
    project.shots = [
      { id: 'a', number: '1', lineIds: ['l1'], image: { blob: 'art-a', prompt: '', model: 'm', createdAt: 1 } },
      { id: 'b', number: '2', lineIds: ['l2'] },
      { id: 'c', number: '3', lineIds: ['l3'] },
    ];
    project.comic = { coverId: 'b', leftOut: ['c'], publish: { slug: 'strip_01' } };
    await putBlob('art-a', new Blob(['art']));
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 1600, height: 1000 })));
    const ctx = { fillRect() {}, drawImage() {}, fillStyle: '' };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (this: HTMLCanvasElement, cb: BlobCallback) {
      cb(new Blob([new Uint8Array([0xff, 0xd8, this.width % 256, 0xff, 0xd9])], { type: 'image/jpeg' }));
    });
  });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
  const unzip = async (blob: Blob) => unzipSync(new Uint8Array(await blob.arrayBuffer()));

  it('saves Page01… and the cover, leaving out what was left out', async () => {
    const progress = vi.fn();
    const out = await exportComic(project, 'pages', { width: 1200, format: 'jpeg', letteredCover: false }, progress);
    expect(out.name).toBe('strip_pages.zip');
    expect(Object.keys(await unzip(out.blob)).sort()).toEqual(['Page01.jpg', 'Page02.jpg', 'cover.jpg']);
    expect(progress).toHaveBeenLastCalledWith({ done: 3, total: 3 });
  });

  it('lays out the site package with the comics.json entry', async () => {
    const out = await exportComic(project, 'site', { width: 1200, format: 'jpeg', letteredCover: false }, () => {});
    const files = await unzip(out.blob);
    expect(Object.keys(files).sort()).toEqual(['README.txt', 'comics-entry.json', 'comics/strip_01/Page01.jpg', 'comics/strip_01/Page02.jpg', 'comics/strip_01/cover.jpg']);
    expect(JSON.parse(strFromU8(files['comics-entry.json']))).toEqual({ slug: 'strip_01', title: 'Strip', cover: '/comics/strip_01/cover.jpg', pages: 2, tags: ['new'] });
  });

  it('makes a PDF of the cover and pages', async () => {
    const out = await exportComic(project, 'pdf', { width: 1200, format: 'png', letteredCover: true }, () => {});
    expect(out.blob.type).toBe('application/pdf');
    expect(new TextDecoder('latin1').decode(new Uint8Array(await out.blob.arrayBuffer()))).toContain('/Count 3');
  });

  it('stops when cancelled', async () => {
    const abort = new AbortController();
    abort.abort();
    await expect(exportComic(project, 'pages', { width: 1200, format: 'jpeg', letteredCover: false }, () => {}, abort.signal)).rejects.toThrow('cancelled');
  });
});
