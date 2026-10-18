import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { saveFile } from '../shell/download';
import { mediumOf, newId, type Shot } from '../state/schema';
import { useProjectStore } from '../state/store';
import { safeFileName } from '../storage/projectFile';
import { addLetter, duplicateLetter, raiseLetter, removeLetter, setLettering, setLetteringDefault, styleLetter, updateLetter } from './commands';
import { autoLetter, letteringWarnings, placePanel, speechElement, type AutoOptions } from './auto';
import { canvasMeasurer, drawLettering } from './draw';
import { BUILTIN_FONTS, defaultLetteringFont, ensureFonts, listUserFonts } from './fonts';
import { hitTest, layoutLetter, type LetterLayout, type TextMeasurer } from './layout';
import { BALLOON_KINDS, isBalloon, KIND_LABELS, resolveStyle, type LetterElement, type LetterKind } from './model';
import { letteringSpeeches, type Speech } from './script';

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
  const project = useProjectStore((s) => s.project);
  const speeches = useMemo(() => project ? letteringSpeeches(project, shot) : { panel: [], scene: [] }, [project?.script, shot.lineIds]); // eslint-disable-line react-hooks/exhaustive-deps
  const [wholeScene, setWholeScene] = useState(false);
  const [art, setArt] = useState<Art>();
  const [fallbackFont, setFallbackFont] = useState<string>();
  const [userFonts, setUserFonts] = useState<string[]>([]);
  const [fontTick, setFontTick] = useState(0);
  const [selectedId, setSelectedId] = useState<string>();
  const [editingText, setEditingText] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [tailDir, setTailDir] = useState<number>();
  const drag = useRef<{ id: string; mode: 'move' | 'tail' | 'rotate'; dir: number; dx: number; dy: number; moved: boolean; wasSelected: boolean; raise?: boolean } | null>(null);

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
  const familyKey = [...new Set([...styles.map((s) => s.font), ...(fallbackFont ? [fallbackFont] : [])])].sort().join('|');
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

  const placed = new Set(lettering.map((e) => e.lineId).filter(Boolean));
  const nextSpeech = speeches.panel.find((s) => !placed.has(s.lineId));

  // Automatic placement measures with the fonts the lettering will be drawn in.
  const autoOpts = (): AutoOptions => ({ measure: measurer(), fallbackFont });

  const add = (kind: LetterKind, speech?: Speech) => {
    if (speech && project) {
      // From the script: placed around the characters, tail on the speaker.
      const el = speechElement(project, speech);
      dispatch(setLettering(shot.id, placePanel(project, shot, [...lettering, el], autoOpts()), el.kind === 'caption' ? 'Add caption' : 'Add balloon'));
      setSelectedId(el.id);
      setEditingText(false);
      return;
    }
    const el: LetterElement = kind === 'caption' || kind === 'sfx'
      ? { id: newId(), kind, text: '', x: 0.5, y: kind === 'sfx' ? 0.5 : 0.08 }
      : { id: newId(), kind, text: '', x: 0.5, y: 0.22, tail: { x: 0.5, y: 0.42 } };
    dispatch(addLetter(shot.id, el));
    setSelectedId(el.id);
    setEditingText(true);
  };

  const letterPanel = () => {
    if (!project) return;
    dispatch(setLettering(shot.id, autoLetter(project, shot, autoOpts()), 'Letter panel'));
    setSelectedId(undefined);
  };

  const warnings = useMemo(() => project && art ? letteringWarnings(project, shot, { measure: measurer(), fallbackFont }) : [],
    [project, shot, art, fallbackFont, fontTick]); // eslint-disable-line react-hooks/exhaustive-deps

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

  const onRotateDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!selected) return;
    e.stopPropagation();
    drag.current = { id: selected.el.id, mode: 'rotate', dir: 1, dx: 0, dy: 0, moved: false, wasSelected: true };
    surface.current?.setPointerCapture?.(e.pointerId);
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const p = toPanel(e);
    d.moved = true;
    if (d.mode === 'rotate') {
      // The handle sits above the center, so straight up is no turn. Snaps to 5°, and to level near 0°.
      const el = lettering.find((x) => x.id === d.id);
      const r = surface.current!.getBoundingClientRect();
      if (!el) return;
      const deg = (Math.atan2(e.clientY - (r.top + el.y * r.height), e.clientX - (r.left + el.x * r.width)) * 180) / Math.PI + 90;
      let snapped = Math.round(normalizeDeg(deg) / 5) * 5;
      if (Math.abs(snapped) <= 5) snapped = 0;
      dispatch(updateLetter(shot.id, d.id, { rotation: snapped || undefined }, 'Turn text', `letter-rotate:${d.id}`));
      return;
    }
    if (d.mode === 'move') {
      // Whatever is picked up comes to the front.
      if (d.raise) { d.raise = false; dispatch(raiseLetter(shot.id, d.id, `letter-move:${d.id}`)); }
      // Moving by hand pins it: automatic placement leaves it alone from now on.
      dispatch(updateLetter(shot.id, d.id, { x: clamp01(p.x + d.dx), y: clamp01(p.y + d.dy), auto: undefined }, 'Move lettering', `letter-move:${d.id}`));
    } else {
      const offset = d.dir * HANDLE_OFFSET_PX / p.h;
      dispatch(updateLetter(shot.id, d.id, { tail: { x: clamp01(p.x), y: clamp01(p.y - offset) }, auto: undefined }, 'Aim tail', `letter-tail:${d.id}`));
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
          <button className="btn" onClick={() => add('speech', nextSpeech)} disabled={!art} title={nextSpeech ? `Adds ${nextSpeech.speaker ?? 'the next line'}: “${nextSpeech.text}”` : undefined}>+ Balloon</button>
          <button className="btn" onClick={() => add('caption')} disabled={!art}>+ Caption</button>
          <button className="btn" onClick={() => add('sfx')} disabled={!art} title="Sound effect or title: letters with no balloon">+ Text</button>
          <button className="btn" onClick={letterPanel} disabled={!art} title="Adds the panel's dialogue and places every balloon you haven't moved by hand around the characters">Auto letter</button>
          <button className="btn" onClick={() => void exportPng()} disabled={!art || saving}>{saving ? 'Saving…' : 'Save PNG'}</button>
        </div>
      </header>
      <div className="lettering-stage" onPointerDown={(e) => { if (e.target === e.currentTarget) setSelectedId(undefined); }}>
        {art && (
          <div ref={surface} className="lettering-art" style={{ aspectRatio: `${art.width} / ${art.height}`, width: `min(100cqw, calc(100cqh * ${art.width / art.height}))` }}
            onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
            data-testid="lettering-art">
            <canvas ref={canvas} width={art.width} height={art.height} aria-label={`${unit} ${shot.number} with lettering`} role="img" />
            {selected && <Selection layout={selected} width={art.width} height={art.height} dir={tailDir} onTailDown={onTailDown} onRotateDown={onRotateDown} />}
          </div>
        )}
        {!art && !error && <p className="muted">Opening art…</p>}
        {lettering.length === 0 && art && <p className="lettering-hint small muted">Add a balloon, caption or text, then drag it into place.</p>}
      </div>
      {error && <p className="error small lettering-error" role="alert">{error}</p>}
      {!sel && art && warnings.length > 0 && (
        <ul className="lettering-warnings" aria-label="Lettering problems">
          {warnings.map((w) => <li key={w.message} className="small">⚠ {w.message}</li>)}
        </ul>
      )}
      {!sel && art && (speeches.panel.length > 0 || speeches.scene.length > 0) && (
        <div className="lettering-script" aria-label="Dialogue to letter">
          <div className="row gap small muted">
            <span className="grow">{wholeScene ? 'Dialogue in this scene' : 'Dialogue in this panel'} · tap a line to add its balloon</span>
            {speeches.scene.length > 0 && <button className="link-btn" onClick={() => setWholeScene((w) => !w)}>{wholeScene ? 'This panel only' : 'Whole scene'}</button>}
          </div>
          <div className="lettering-lines">
            {[...speeches.panel, ...(wholeScene ? speeches.scene : [])].map((s) => (
              <button key={s.lineId} className={`btn lettering-line${placed.has(s.lineId) ? ' placed' : ''}`} onClick={() => add('speech', s)} title={placed.has(s.lineId) ? 'Already lettered; tap to add it again' : undefined}>
                <span>{placed.has(s.lineId) && <span aria-label="lettered">✓ </span>}{s.speaker && <strong>{s.speaker}</strong>}{s.speaker && ' '}{s.text}</span>
              </button>
            ))}
            {!speeches.panel.length && !wholeScene && <span className="small muted">No dialogue in this panel.</span>}
          </div>
        </div>
      )}
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
          {isBalloon(sel.kind) && <>
            <select aria-label="Balloon kind" value={sel.kind} onChange={(e) => dispatch(updateLetter(shot.id, sel.id, { kind: e.target.value as LetterKind }, 'Change balloon kind'))}>
              {BALLOON_KINDS.map((k) => <option key={k} value={k}>{KIND_LABELS[k]}</option>)}
            </select>
            {(sel.kind === 'speech' || sel.kind === 'whisper' || sel.kind === 'electronic') && <button className="btn" onClick={() => restyle({ shape: selStyle.shape === 'oval' ? 'rounded' : 'oval' })}>{selStyle.shape === 'oval' ? 'Oval' : 'Rounded'}</button>}
            <button className="btn" onClick={() => dispatch(updateLetter(shot.id, sel.id, { tail: sel.tail ? undefined : { x: sel.x, y: Math.min(1, sel.y + 0.2) } }, sel.tail ? 'Remove tail' : 'Add tail'))}>{sel.tail ? 'No tail' : 'Tail'}</button>
          </>}
          {sel.kind === 'sfx' && <>
            <label className="lettering-color" title="Text colour"><input type="color" aria-label="Text colour" value={hexColor(selStyle.ink)} onChange={(e) => restyle({ ink: e.target.value }, 'ink')} /></label>
            <select aria-label="Outline" value={OUTLINES.reduce((best, o) => (Math.abs(o.width - selStyle.outline) < Math.abs(best.width - selStyle.outline) ? o : best)).width} onChange={(e) => restyle({ outline: Number(e.target.value) })}>
              {OUTLINES.map((o) => <option key={o.width} value={o.width}>{o.label}</option>)}
            </select>
            {selStyle.outline > 0 && <label className="lettering-color" title="Outline colour"><input type="color" aria-label="Outline colour" value={hexColor(selStyle.outlineColor)} onChange={(e) => restyle({ outlineColor: e.target.value }, 'outline-color')} /></label>}
            <button className={`btn${selStyle.shadow > 0 ? ' primary' : ''}`} aria-pressed={selStyle.shadow > 0} onClick={() => restyle({ shadow: selStyle.shadow > 0 ? 0 : 6 })}>Shadow</button>
            {selStyle.shadow > 0 && <label className="lettering-color" title="Shadow colour"><input type="color" aria-label="Shadow colour" value={hexColor(selStyle.shadowColor)} onChange={(e) => restyle({ shadowColor: e.target.value }, 'shadow-color')} /></label>}
            <button className="btn" aria-label="Level" title="Drag the round handle above the text to turn it; tap here to level it" onClick={() => dispatch(updateLetter(shot.id, sel.id, { rotation: undefined }, 'Level text'))}>↻ {Math.round(sel.rotation ?? 0)}°</button>
          </>}
          <button className="btn" onClick={() => {
            // The copy goes just below the original (one box height), so repeats stack instead of overlapping.
            const id = newId();
            const dy = selected && art ? Math.min(0.3, selected.box.h / art.height + 0.02) : 0.05;
            dispatch(duplicateLetter(shot.id, sel.id, id, { dx: 0.03, dy }));
            setSelectedId(id);
          }}>Duplicate</button>
          <button className="btn" title="Use this look for every balloon or caption in the project" disabled={!sel.style} onClick={() => sel.style && dispatch(setLetteringDefault(sel.kind, sel.style))}>Make default</button>
          <button className="btn danger" onClick={() => dispatch(removeLetter(shot.id, sel.id))}>Delete</button>
        </div>
      )}
      {sel && editingText && (
        <div className="lettering-text-sheet">
          <textarea autoFocus rows={3} aria-label={isBalloon(sel.kind) ? 'Balloon text' : sel.kind === 'sfx' ? 'Text' : 'Caption text'} placeholder={isBalloon(sel.kind) ? 'What they say…' : sel.kind === 'sfx' ? 'BLAM!, KNOCK KNOCK, or a title…' : 'Caption…'} value={sel.text} maxLength={4000}
            onChange={(e) => dispatch(updateLetter(shot.id, sel.id, { text: e.target.value }, 'Edit lettering text', `letter-text:${sel.id}`))} />
          <div className="row gap">
            <span className="small muted grow">{sel.kind === 'sfx' ? 'Lines break only where you type them.' : `Your line breaks are kept. Without any, lines are shaped to fit the ${isBalloon(sel.kind) ? 'balloon' : 'caption'}.`}</span>
            <button className="btn primary" onClick={finishText}>Done</button>
          </div>
        </div>
      )}
    </dialog>
  );
}

const OUTLINES = [{ width: 0, label: 'No outline' }, { width: 4, label: 'Thin outline' }, { width: 7, label: 'Outline' }, { width: 12, label: 'Thick outline' }];

/** Color inputs need #rrggbb. */
function hexColor(c: string): string {
  return /^#[0-9a-f]{6}$/i.test(c) ? c : /^#[0-9a-f]{3}$/i.test(c) ? `#${[...c.slice(1)].map((x) => x + x).join('')}` : '#000000';
}

function normalizeDeg(d: number): number {
  return ((((d + 180) % 360) + 360) % 360) - 180;
}

function Selection({ layout, width, height, dir, onTailDown, onRotateDown }: { layout: LetterLayout; width: number; height: number; dir?: number; onTailDown: (e: ReactPointerEvent<HTMLDivElement>) => void; onRotateDown: (e: ReactPointerEvent<HTMLDivElement>) => void }) {
  const { box, tail } = layout;
  const pct = (v: number, of: number) => `${(v / of) * 100}%`;
  const below = dir ?? handleOffset(layout);
  if (layout.shape === 'text') {
    // Turned with the text; the round handle above turns it.
    return (
      <div className="lettering-selection-turn" style={{ left: pct(box.x, width), top: pct(box.y, height), width: pct(box.w, width), height: pct(box.h, height), transform: `rotate(${layout.rotation}rad)` }}>
        <div className="lettering-selection" style={{ inset: 0 }} />
        <div className="lettering-rotate-link" />
        <div className="lettering-rotate-handle" role="button" aria-label="Drag to turn the text" onPointerDown={onRotateDown} />
      </div>
    );
  }
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
