import { useEffect, useRef, useState } from 'react';
import { canvasMeasurer, drawLettering } from './draw';
import { defaultLetteringFont, ensureFonts } from './fonts';
import { layoutLetter } from './layout';
import { resolveStyle, type LetterElement, type LetteringDefaults } from './model';

/**
 * Lettering shown outside the editor: baked onto the shot image (and
 * thumbnails), or drawn over the live 3D frame. The project keeps the
 * lettering as data; these are only pictures of it.
 */

/** Resolves every element's style once its fonts can be measured. */
async function readyStyles(lettering: LetterElement[], defaults?: LetteringDefaults) {
  const fallback = await defaultLetteringFont().catch(() => undefined);
  const styles = lettering.map((el) => resolveStyle(el, defaults, fallback));
  await ensureFonts(styles.map((s) => s.font));
  return styles;
}

function drawOn(ctx: CanvasRenderingContext2D, width: number, height: number, lettering: LetterElement[], styles: ReturnType<typeof resolveStyle>[]) {
  const measure = canvasMeasurer(ctx);
  drawLettering(ctx, lettering.map((el, i) => layoutLetter(el, styles[i], width, height, measure)));
}

/**
 * An image URL with the lettering drawn on it, or the original URL when
 * there's no lettering (or nothing to draw with). Redraws when either changes.
 */
export function useLetteredUrl(src: string | undefined, lettering: LetterElement[] | undefined, defaults?: LetteringDefaults, maxWidth = 1600): string | undefined {
  const [result, setResult] = useState<{ src: string; key: string; url: string }>();
  const key = lettering?.length ? JSON.stringify([lettering, defaults, maxWidth]) : '';
  useEffect(() => {
    if (!src || !key) return;
    let active = true;
    let url: string | undefined;
    void (async () => {
      const img = new Image();
      img.src = src;
      await img.decode();
      const scale = Math.min(1, maxWidth / img.naturalWidth);
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.naturalWidth * scale);
      canvas.height = Math.round(img.naturalHeight * scale);
      const ctx = canvas.getContext('2d');
      if (!ctx || !active) return;
      const styles = await readyStyles(lettering!, defaults);
      if (!active) return;
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      drawOn(ctx, canvas.width, canvas.height, lettering!, styles);
      const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.9));
      if (!blob || !active) return;
      url = URL.createObjectURL(blob);
      setResult({ src, key, url });
    })().catch(() => {});
    return () => { active = false; if (url) URL.revokeObjectURL(url); };
  }, [src, key]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!src || !key) return src;
  // Until the lettered picture is ready, show the plain one.
  return result && result.src === src && result.key === key ? result.url : src;
}

/** Lettering drawn over whatever is under it (the 3D frame), filling its parent. */
export function LetteringOverlay({ lettering, defaults }: { lettering: LetterElement[]; defaults?: LetteringDefaults }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState<{ w: number; h: number }>();
  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const measure = () => {
      const r = c.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      if (r.width && r.height) setSize({ w: Math.round(r.width * dpr), h: Math.round(r.height * dpr) });
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(c);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    const c = canvas.current;
    if (!c || !size) return;
    let active = true;
    void readyStyles(lettering, defaults).then((styles) => {
      const ctx = active ? c.getContext('2d') : null;
      if (!ctx) return;
      c.width = size.w;
      c.height = size.h;
      drawOn(ctx, size.w, size.h, lettering, styles);
    }).catch(() => {});
    return () => { active = false; };
  }, [lettering, defaults, size]);
  return <canvas ref={canvas} className="lettering-overlay" aria-hidden="true" />;
}
