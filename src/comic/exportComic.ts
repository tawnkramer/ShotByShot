import { zipSync } from 'fflate';
import { FilmRenderer } from '../export/render';
import { getBlob } from '../storage/db';
import { frameAspect } from '../shots/setup';
import type { Project, Shot } from '../state/schema';
import { canvasMeasurer, drawLettering } from './draw';
import { defaultLetteringFont, ensureFonts } from './fonts';
import { layoutLetter } from './layout';
import { resolveStyle } from './model';
import { coverOf, pageName, pagesOf } from './pages';
import { buildPdf, type PdfImage } from './pdf';

export type ComicOutput = 'pages' | 'pdf' | 'site';
export interface ComicExportOptions {
  /** Width of every page image, in pixels. */
  width: number;
  format: 'jpeg' | 'png';
  /** Draw the cover panel's lettering on the cover too. */
  letteredCover: boolean;
}
export interface ComicProgress { done: number; total: number }
export class ComicExportCancelled extends Error {
  constructor() { super('Export cancelled.'); }
}

export interface Publish { slug: string; title: string; tags: string[] }

/** A safe folder name for the comic site, from the project name. */
export function defaultSlug(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'comic';
}

export function publishOf(project: Project): Publish {
  const p = project.comic?.publish;
  return { slug: p?.slug || defaultSlug(project.name), title: p?.title || project.name, tags: p?.tags ?? ['new'] };
}

/** The entry for the site's comics.json. */
export function comicsJsonEntry(project: Project, pages = pagesOf(project).length, ext = 'jpg') {
  const { slug, title, tags } = publishOf(project);
  return { slug, title, cover: `/comics/${slug}/cover.${ext}`, pages, tags };
}

/**
 * Draws panels as pages: the panel's image (or a previs render until it
 * has one) at the export width, with its lettering. One 3D renderer per
 * panel shape, made only if some panel needs it.
 */
export class PageRenderer {
  private renderers = new Map<number, FilmRenderer>();
  private fallbackFont?: string;
  constructor(private project: Project, private width: number) {}

  async ready(): Promise<void> {
    this.fallbackFont = await defaultLetteringFont().catch(() => undefined);
    const fonts = this.project.shots.flatMap((s) => (s.lettering ?? []).map((el) => resolveStyle(el, this.project.lettering, this.fallbackFont).font));
    await ensureFonts([...fonts, ...(this.fallbackFont ? [this.fallbackFont] : [])]);
  }

  async render(shot: Shot, opts: { lettering: boolean; type: string; quality?: number }): Promise<{ blob: Blob; width: number; height: number }> {
    const source = await this.source(shot);
    const width = this.width, height = Math.round(width / source.aspect);
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('This browser cannot draw the pages.');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(source.image, 0, 0, width, height);
    if (opts.lettering && shot.lettering?.length) {
      const measure = canvasMeasurer(ctx);
      drawLettering(ctx, shot.lettering.map((el) => layoutLetter(el, resolveStyle(el, this.project.lettering, this.fallbackFont), width, height, measure)));
    }
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, opts.type, opts.quality));
    if (!blob) throw new Error(`Could not encode panel ${shot.number}.`);
    return { blob, width, height };
  }

  private async source(shot: Shot): Promise<{ image: CanvasImageSource; aspect: number }> {
    const art = shot.image ? await getBlob(shot.image.blob) : undefined;
    if (art) {
      const bitmap = await createImageBitmap(art);
      return { image: bitmap, aspect: bitmap.width / bitmap.height };
    }
    const aspect = frameAspect(this.project, shot);
    let r = this.renderers.get(aspect);
    if (!r) {
      r = new FilmRenderer(this.project, this.width, Math.round(this.width / aspect), { captions: false, shotNumbers: false, aspect });
      this.renderers.set(aspect, r);
    }
    await r.renderShot(shot.id, 0);
    return { image: r.canvas, aspect };
  }

  dispose(): void {
    for (const r of this.renderers.values()) r.dispose();
  }
}

/**
 * Exports the comic. 'pages' is a zip of Page01.jpg… and cover.jpg; 'site'
 * is the same under comics/<slug>/ plus the comics.json entry; 'pdf' is the
 * cover then every page.
 */
export async function exportComic(project: Project, output: ComicOutput, opts: ComicExportOptions, onProgress: (p: ComicProgress) => void, signal?: AbortSignal): Promise<{ blob: Blob; name: string }> {
  const pages = pagesOf(project);
  if (!pages.length) throw new Error('There are no pages to export.');
  const coverId = coverOf(project)!;
  const shot = (id: string) => project.shots.find((s) => s.id === id)!;
  // PDFs embed JPEG as-is; PNG is only offered for image files.
  const format = output === 'pdf' ? 'jpeg' : opts.format;
  const type = format === 'png' ? 'image/png' : 'image/jpeg';
  const ext = format === 'png' ? 'png' : 'jpg';
  const renderer = new PageRenderer(project, opts.width);
  const total = pages.length + 1;
  const files: { name: string; data: Uint8Array; width: number; height: number }[] = [];
  try {
    await renderer.ready();
    const jobs = [{ name: `cover.${ext}`, shotId: coverId, lettering: opts.letteredCover }, ...pages.map((p) => ({ name: `${pageName(p.number)}.${ext}`, shotId: p.shotId, lettering: true }))];
    for (const [i, job] of jobs.entries()) {
      if (signal?.aborted) throw new ComicExportCancelled();
      const page = await renderer.render(shot(job.shotId), { lettering: job.lettering, type, quality: 0.92 });
      files.push({ name: job.name, data: new Uint8Array(await page.blob.arrayBuffer()), width: page.width, height: page.height });
      onProgress({ done: i + 1, total });
    }
  } finally {
    renderer.dispose();
  }
  const base = defaultSlug(project.name);
  if (output === 'pdf') {
    const images: PdfImage[] = files.map((f) => ({ jpeg: f.data, width: f.width, height: f.height }));
    return { blob: new Blob([buildPdf(images, project.name) as BlobPart], { type: 'application/pdf' }), name: `${base}.pdf` };
  }
  const zip: Record<string, Uint8Array> = {};
  if (output === 'pages') {
    for (const f of files) zip[f.name] = f.data;
    return { blob: new Blob([zipSync(zip, { level: 0 }) as BlobPart], { type: 'application/zip' }), name: `${base}_pages.zip` };
  }
  const { slug } = publishOf(project);
  for (const f of files) zip[`comics/${slug}/${f.name}`] = f.data;
  const entry = comicsJsonEntry(project, pages.length, ext);
  zip['comics-entry.json'] = new TextEncoder().encode(`${JSON.stringify(entry, null, 4)}\n`);
  zip['README.txt'] = new TextEncoder().encode(
    `Upload the comics/${slug}/ folder to your site's comics/ folder, then add the entry in\ncomics-entry.json to the list in your site's comics.json.\n`,
  );
  return { blob: new Blob([zipSync(zip, { level: 0 }) as BlobPart], { type: 'application/zip' }), name: `${slug}_site.zip` };
}
