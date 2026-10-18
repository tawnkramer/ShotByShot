import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { saveFile } from '../shell/download';
import { mediumOf, newId, type Shot } from '../state/schema';
import { useProjectStore } from '../state/store';
import { safeFileName } from '../storage/projectFile';
import { addLetter, raiseLetter, removeLetter, setLetteringDefault, styleLetter, updateLetter } from './commands';
import { canvasMeasurer, drawLettering } from './draw';
import { BUILTIN_FONTS, defaultLetteringFont, ensureFonts, listUserFonts } from './fonts';
import { hitTest, layoutLetter, type LetterLayout, type TextMeasurer } from './layout';
import { resolveStyle, type LetterElement, type LetterKind } from './model';

const EMPTY: LetterElement[] = [];
/** The tail handle sits this far from the tip so a finger doesn't hide what it points at. */
const HANDLE_OFFSET_PX = 56;
const MIN_SIZE = 8, MAX_SIZE = 120;

interface Art { image?: CanvasImageSource; width: number; height: number }

/** Rough widths for when there's no canvas to measure with (tests). */
const roughMeasure: TextMeasurer = (text, font) => text.length * font.px * 0.55;

let measureCtx: CanvasRenderingContext2D | null | undefined;
function measurer(): TextMeasurer {
  if (measureCtx === undefined) {
    try { measureCtx = document.createElement('canvas').getContext('2d'); } catch { measureCtx = null; }
  }
  return measureCtx ? canvasMeasurer(measureCtx) : roughMeasure;
}

/**
 * Speech balloons and captions over a shot's art: tap + to add, drag to
 * move, drag the round handle to aim a tail, and save a lettered PNG.
 */
export function LetteringEditor({ shot: initial, art: artBlob, artLabel, onClose }: { shot: Shot; art: Blob; artLabel: string; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const surface = useRef<HTMLDivElement>(null);
  const dispatch = useProjectStore((s) => s.dispatch);
  const shot = useProjectStore((s) => s.project?.shots.find((x) => x.id === initial.id)) ?? initial;
  const defaults = useProjectStore((s) => s.project?.lettering);
  const lettering = shot.lettering ?? EMPTY;
  const unit = useProjectStore((s) => s.project && mediumOf(s.project) === 'comic') ? 'Panel' : 'Shot';
  const [art, setArt] = useState<Art>();
  const [fallbackFont, setFallbackFont] = useState<string>();
  const [userFonts, setUserFonts] = useState<string[]>([]);
  const [fontTick, setFontTick] = useState(0);
  const [selectedId, setSelectedId] = useState<string>();
  const [editingText, setEditingText] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [tailDir, setTailDir] = useState<number>();
  const drag = useRef<{ id: string; mode: 'move' | 'tail'; dir: number; dx: number; dy: number; moved: boolean; wasSelected: boolean; raise?: boolean } | null>(null);

  useEffect(() => {
    const d = dialog.current;
    if (d && !d.open) d.showModal?.();
    const vv = window.visualViewport;
    const fit = () => {
      d?.style.setProperty('--image-editor-height', `${vv?.height ?? window.innerHeight}px`);
      d?.style.setProperty('--image-editor-top', `${vv?.offsetTop ?? 0}px`);
    };
    fit();
    vv?.addEventListener('resize', fit);
    window.addEventListener('resize', fit);
    return () => { vv?.removeEventListener('resize', fit); window.removeEventListener('resize', fit); };
  }, []);

  useEffect(() => {
    let active = true;
    void loadArt(artBlob).then((a) => { if (active) setArt(a); }).catch(() => { if (active) setError('Could not open the art for lettering.'); });
    return () => { active = false; };
  }, [artBlob]);

  useEffect(() => {
    let active = true;
    void defaultLetteringFont().then((f) => { if (active) setFallbackFont(f); }).catch(() => { if (active) setFallbackFont(undefined); });
    void listUserFonts().then((fonts) => { if (active) setUserFonts(fonts.map((f) => f.family)); }).catch(() => {});
    const bump = () => setFontTick((t) => t + 1);
    document.fonts?.addEventListener?.('loadingdone', bump);
    return () => { active = false; document.fonts?.removeEventListener?.('loadingdone', bump); };
  }, []);

  const styles = useMemo(() => lettering.map((el) => resolveStyle(el, defaults, fallbackFont)), [lettering, defaults, fallbackFont]);
  const familyKey = [...new Set(styles.map((s) => s.font))].sort().join('|');
  useEffect(() => {
    let active = true;
    void ensureFonts(familyKey ? familyKey.split('|') : []).then(() => { if (active) setFontTick((t) => t + 1); });
    return () => { active = false; };
  }, [familyKey]);

  const layouts = useMemo(() => {
    if (!art) return [];
    const measure = measurer();
    return lettering.map((el, i) => layoutLetter(el, styles[i], art.width, art.height, measure));
    // fontTick: re-measure once fonts finish loading.
  }, [art, lettering, styles, fontTick]);

  useEffect(() => {
    const c = canvas.current;
    const ctx = art && c ? safeContext(c) : null;
    if (!art || !ctx) return;
    ctx.clearRect(0, 0, art.width, art.height);
    if (art.image) ctx.drawImage(art.image, 0, 0, art.width, art.height);
    drawLettering(ctx, layouts);
  }, [art, layouts]);

  const selected = layouts.find((l) => l.el.id === selectedId);
  useEffect(() => { if (selectedId && !lettering.some((e) => e.id === selectedId)) { setSelectedId(undefined); setEditingText(false); } }, [lettering, selectedId]);

  const add = (kind: LetterKind) => {
    const el: LetterElement = kind === 'speech'
      ? { id: newId(), kind, text: '', x: 0.5, y: 0.22, tail: { x: 0.5, y: 0.42 } }
      : { id: newId(), kind, text: '', x: 0.5, y: 0.08 };
    dispatch(addLetter(shot.id, el));
    setSelectedId(el.id);
    setEditingText(true);
  };

  const finishText = () => {
    setEditingText(false);
    const el = lettering.find((e) => e.id === selectedId);
    if (el && !el.text.trim()) dispatch(removeLetter(shot.id, el.id));
  };

  const toPanel = (e: { clientX: number; clientY: number }) => {
    const r = surface.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) / (r.width || 1), y: (e.clientY - r.top) / (r.height || 1), h: r.height || 1 };
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!art || editingText) return;
    const p = toPanel(e);
    const hit = hitTest(layouts, { x: p.x * art.width, y: p.y * art.height });
    if (!hit) { setSelectedId(undefined); return; }
    drag.current = { id: hit.el.id, mode: 'move', dir: 1, dx: hit.el.x - p.x, dy: hit.el.y - p.y, moved: false, wasSelected: hit.el.id === selectedId, raise: hit !== layouts.at(-1) };
    setSelectedId(hit.el.id);
    surface.current?.setPointerCapture?.(e.pointerId);
  };

  const onTailDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!selected?.tail) return;
    e.stopPropagation();
    const dir = handleOffset(selected);
    drag.current = { id: selected.el.id, mode: 'tail', dir, dx: 0, dy: 0, moved: false, wasSelected: true };
    setTailDir(dir);
    surface.current?.setPointerCapture?.(e.pointerId);
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const p = toPanel(e);
    d.moved = true;
    if (d.mode === 'move') {
      // Whatever is picked up comes to the front.
      if (d.raise) { d.raise = false; dispatch(raiseLetter(shot.id, d.id, `letter-move:${d.id}`)); }
      dispatch(updateLetter(shot.id, d.id, { x: clamp01(p.x + d.dx), y: clamp01(p.y + d.dy) }, 'Move lettering', `letter-move:${d.id}`));
    } else {
      const offset = d.dir * HANDLE_OFFSET_PX / p.h;
      dispatch(updateLetter(shot.id, d.id, { tail: { x: clamp01(p.x), y: clamp01(p.y - offset) } }, 'Aim tail', `letter-tail:${d.id}`));
    }
  };

  const onPointerUp = () => {
    const d = drag.current;
    drag.current = null;
    setTailDir(undefined);
    // Tapping an element that was already selected edits its text.
    if (d && d.mode === 'move' && !d.moved && d.wasSelected) setEditingText(true);
  };

  const exportPng = async () => {
    if (!art) return;
    setSaving(true); setError('');
    try {
      const c = document.createElement('canvas');
      c.width = art.width; c.height = art.height;
      const ctx = safeContext(c);
      if (!ctx) throw new Error('This browser cannot draw the image.');
      if (art.image) ctx.drawImage(art.image, 0, 0, art.width, art.height);
      drawLettering(ctx, lettering.map((el, i) => layoutLetter(el, styles[i], art.width, art.height, canvasMeasurer(ctx))));
      const blob = await new Promise<Blob | null>((resolve) => c.toBlob(resolve, 'image/png'));
      if (!blob) throw new Error('Could not make the PNG.');
      await saveFile(blob, `${safeFileName(`${unit} ${shot.number}`)}_lettered.png`, 'image/png');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const sel = selected?.el;
  const selStyle = selected?.style;
  const fonts = [...BUILTIN_FONTS.map((f) => ({ family: f.family, label: f.label })), ...userFonts.map((f) => ({ family: f, label: f }))];
  if (selStyle && !fonts.some((f) => f.family === selStyle.font)) fonts.push({ family: selStyle.font, label: `${selStyle.font} (not on this device)` });
  const restyle = (patch: Parameters<typeof styleLetter>[2], key?: string) => sel && dispatch(styleLetter(shot.id, sel.id, patch, key && `letter-${key}:${sel.id}`));

  return (
    <dialog ref={dialog} className="character-image-dialog lettering-dialog" aria-labelledby="lettering-title" onCancel={(e) => { e.preventDefault(); if (editingText) finishText(); else onClose(); }}>
      <header className="image-editor-head lettering-head">
        <div className="row gap">
          <div className="grow"><h2 id="lettering-title">{unit} {shot.number} · Lettering</h2><span className="small muted">On the {artLabel}</span></div>
          <button className="btn ghost" onClick={onClose}>Close</button>
        </div>
        <div className="lettering-actions">
          <button className="btn" onClick={() => add('speech')} disabled={!art}>+ Balloon</button>
          <button className="btn" onClick={() => add('caption')} disabled={!art}>+ Caption</button>
          <button className="btn" onClick={() => void exportPng()} disabled={!art || saving}>{saving ? 'Saving…' : 'Save PNG'}</button>
        </div>
      </header>
      <div className="lettering-stage" onPointerDown={(e) => { if (e.target === e.currentTarget) setSelectedId(undefined); }}>
        {art && (
          <div ref={surface} className="lettering-art" style={{ aspectRatio: `${art.width} / ${art.height}`, width: `min(100cqw, calc(100cqh * ${art.width / art.height}))` }}
            onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
            data-testid="lettering-art">
            <canvas ref={canvas} width={art.width} height={art.height} aria-label={`${unit} ${shot.number} with lettering`} role="img" />
            {selected && <Selection layout={selected} width={art.width} height={art.height} dir={tailDir} onTailDown={onTailDown} />}
          </div>
        )}
        {!art && !error && <p className="muted">Opening art…</p>}
        {lettering.length === 0 && art && <p className="lettering-hint small muted">Add a balloon or caption, then drag it into place.</p>}
      </div>
      {error && <p className="error small lettering-error" role="alert">{error}</p>}
      {sel && selStyle && !editingText && (
        <div className="lettering-tools" role="toolbar" aria-label="Selected lettering">
          <button className="btn" onClick={() => setEditingText(true)}>Edit text</button>
          <button className="btn" aria-label="Smaller text" onClick={() => restyle({ size: Math.max(MIN_SIZE, selStyle.size - 2) }, 'size')}>A−</button>
          <button className="btn" aria-label="Larger text" onClick={() => restyle({ size: Math.min(MAX_SIZE, selStyle.size + 2) }, 'size')}>A+</button>
          <button className={`btn${selStyle.bold ? ' primary' : ''}`} aria-pressed={selStyle.bold} onClick={() => restyle({ bold: !selStyle.bold })}><b>B</b></button>
          <button className={`btn${selStyle.italic ? ' primary' : ''}`} aria-pressed={selStyle.italic} onClick={() => restyle({ italic: !selStyle.italic })}><i>I</i></button>
          <select aria-label="Font" value={selStyle.font} onChange={(e) => restyle({ font: e.target.value })}>
            {fonts.map((f) => <option key={f.family} value={f.family}>{f.label}</option>)}
          </select>
          {sel.kind === 'speech' && <>
            <button className="btn" onClick={() => restyle({ shape: selStyle.shape === 'oval' ? 'rounded' : 'oval' })}>{selStyle.shape === 'oval' ? 'Oval' : 'Rounded'}</button>
            <button className="btn" onClick={() => dispatch(updateLetter(shot.id, sel.id, { tail: sel.tail ? undefined : { x: sel.x, y: Math.min(1, sel.y + 0.2) } }, sel.tail ? 'Remove tail' : 'Add tail'))}>{sel.tail ? 'No tail' : 'Tail'}</button>
          </>}
          <button className="btn" title="Use this look for every balloon or caption in the project" disabled={!sel.style} onClick={() => sel.style && dispatch(setLetteringDefault(sel.kind, sel.style))}>Make default</button>
          <button className="btn danger" onClick={() => dispatch(removeLetter(shot.id, sel.id))}>Delete</button>
        </div>
      )}
      {sel && editingText && (
        <div className="lettering-text-sheet">
          <textarea autoFocus rows={3} aria-label={sel.kind === 'speech' ? 'Balloon text' : 'Caption text'} placeholder={sel.kind === 'speech' ? 'What they say…' : 'Caption…'} value={sel.text} maxLength={4000}
            onChange={(e) => dispatch(updateLetter(shot.id, sel.id, { text: e.target.value }, 'Edit lettering text', `letter-text:${sel.id}`))} />
          <div className="row gap">
            <label className="row gap small grow"><input type="checkbox" checked={sel.autoWrap !== false} onChange={(e) => dispatch(updateLetter(shot.id, sel.id, { autoWrap: e.target.checked ? undefined : false }))} /> Shape lines automatically</label>
            <button className="btn primary" onClick={finishText}>Done</button>
          </div>
        </div>
      )}
    </dialog>
  );
}

function Selection({ layout, width, height, dir, onTailDown }: { layout: LetterLayout; width: number; height: number; dir?: number; onTailDown: (e: ReactPointerEvent<HTMLDivElement>) => void }) {
  const { box, tail } = layout;
  const pct = (v: number, of: number) => `${(v / of) * 100}%`;
  const below = dir ?? handleOffset(layout);
  return <>
    <div className={`lettering-selection${layout.shape === 'oval' ? ' oval' : ''}`} style={{ left: pct(box.x, width), top: pct(box.y, height), width: pct(box.w, width), height: pct(box.h, height) }} />
    {tail && <>
      <div className="lettering-tail-link" style={{ left: pct(tail.tip.x, width), top: pct(tail.tip.y, height), height: HANDLE_OFFSET_PX, transform: below > 0 ? undefined : 'translateY(-100%)' }} />
      <div className="lettering-tail-handle" role="button" aria-label="Drag to aim the tail" onPointerDown={onTailDown}
        style={{ left: pct(tail.tip.x, width), top: `calc(${pct(tail.tip.y, height)} + ${below * HANDLE_OFFSET_PX}px)` }} />
    </>}
  </>;
}

/** +1 puts the tail handle below the tip; tips near the bottom get it above instead. */
function handleOffset(layout: LetterLayout | undefined): number {
  return (layout?.el.tail?.y ?? 0) > 0.8 ? -1 : 1;
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

function safeContext(c: HTMLCanvasElement): CanvasRenderingContext2D | null {
  try { return c.getContext('2d'); } catch { return null; }
}

async function loadArt(blob: Blob): Promise<Art> {
  if (typeof createImageBitmap === 'function') {
    const image = await createImageBitmap(blob);
    return { image, width: image.width, height: image.height };
  }
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return { image: img, width: img.naturalWidth, height: img.naturalHeight };
  } finally {
    URL.revokeObjectURL(url);
  }
}
