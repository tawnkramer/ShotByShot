import { useEffect, useRef, useState, type PointerEvent, type RefObject } from 'react';
import { Overlay } from '../shell/Overlay';
import { saveFile } from '../shell/download';
import { safeFileName } from '../storage/projectFile';

type View = { scale: number; x: number; y: number };
const FIT: View = { scale: 1, x: 0, y: 0 };

const EXTENSION: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'video/mp4': 'mp4', 'video/webm': 'webm' };

/** Saves what a preview shows, under its name. Sources are blob: or data: URLs the app made. */
export async function downloadPreview(src: string, name: string, fallbackType: string): Promise<void> {
  const blob = await (await fetch(src)).blob();
  const type = blob.type || fallbackType;
  await saveFile(blob, `${safeFileName(name)}.${EXTENSION[type] ?? fallbackType.split('/')[1]}`, type);
}

/** A fresh render's choices: Use saves it, Discard throws it away. Both close the viewer. */
export interface DraftActions { onUse: () => void; onDiscard: () => void }

/** Header shared by the full-screen viewers: a hint, then Download and Close, or Discard and Use for a fresh render. */
function PreviewHeader({ hint, label, onDownload, onClose, draft }: { hint: string; label: string; onDownload: () => Promise<void>; onClose: () => void; draft?: DraftActions }) {
  const [error, setError] = useState('');
  return <header className="image-preview-header">
    <span className="small muted grow">{error ? <span className="error" role="alert">{error}</span> : hint}</span>
    <button className="btn" onClick={() => { setError(''); void onDownload().catch((e) => setError(e instanceof Error ? e.message : String(e))); }}>Download</button>
    {draft ? <>
      <button className="btn" onClick={draft.onDiscard} aria-label={`Discard this ${label}`}>Discard</button>
      <button className="btn primary" autoFocus onClick={draft.onUse} aria-label={`Use this ${label}`}>Use</button>
    </> : <button className="btn" autoFocus onClick={onClose} aria-label={`Close ${label} preview`}>Close</button>}
  </header>;
}

/** Keeps a full-screen dialog sized to the visible viewport (mobile keyboards and toolbars shrink it). */
function useFullScreen(dialog: RefObject<HTMLDialogElement | null>) {
  useEffect(() => {
    dialog.current?.showModal();
    const vv = window.visualViewport;
    const fit = () => {
      dialog.current?.style.setProperty('--preview-height', `${vv?.height ?? window.innerHeight}px`);
      dialog.current?.style.setProperty('--preview-top', `${vv?.offsetTop ?? 0}px`);
    };
    fit(); vv?.addEventListener('resize', fit); vv?.addEventListener('scroll', fit); window.addEventListener('resize', fit);
    return () => { vv?.removeEventListener('resize', fit); vv?.removeEventListener('scroll', fit); window.removeEventListener('resize', fit); };
  }, [dialog]);
}

/** A full-screen image viewer shared by generated artwork and reference snapshots. */
export function ImagePreview({ src, alt, fileName, onClose, draft }: { src: string; alt: string; fileName?: string; onClose: () => void; draft?: DraftActions }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const surface = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View>(FIT);
  const current = useRef<View>(FIT);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const apply = (next: View) => {
    const scale = Math.max(1, Math.min(8, next.scale));
    current.current = scale === 1 ? FIT : { ...next, scale };
    setView(current.current);
  };
  const zoom = (factor: number, x = 0, y = 0) => {
    const old = current.current;
    const scale = Math.max(1, Math.min(8, old.scale * factor));
    const ratio = scale / old.scale;
    apply({ scale, x: x - (x - old.x) * ratio, y: y - (y - old.y) * ratio });
  };
  useFullScreen(dialog);
  // A non-passive listener prevents wheel zoom from scrolling the page underneath.
  useEffect(() => {
    const node = surface.current;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = node!.getBoundingClientRect();
      zoom(Math.exp(-e.deltaY * 0.002), e.clientX - rect.left - rect.width / 2, e.clientY - rect.top - rect.height / 2);
    };
    node?.addEventListener('wheel', wheel, { passive: false });
    return () => node?.removeEventListener('wheel', wheel);
  }, []);
  const point = (e: { clientX: number; clientY: number }) => {
    const rect = surface.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left - rect.width / 2, y: e.clientY - rect.top - rect.height / 2 };
  };
  const move = (e: PointerEvent<HTMLDivElement>) => {
    const old = [...pointers.current.values()];
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, point(e));
    const next = [...pointers.current.values()];
    const v = current.current;
    if (old.length >= 2) {
      const center = (p: typeof old) => ({ x: (p[0].x + p[1].x) / 2, y: (p[0].y + p[1].y) / 2 });
      const distance = (p: typeof old) => Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y);
      const before = center(old), after = center(next);
      const scale = Math.max(1, Math.min(8, v.scale * distance(next) / Math.max(1, distance(old))));
      const ratio = scale / v.scale;
      apply({ scale, x: after.x - (before.x - v.x) * ratio, y: after.y - (before.y - v.y) * ratio });
    } else apply({ ...v, x: v.x + next[0].x - old[0].x, y: v.y + next[0].y - old[0].y });
  };
  return <Overlay><dialog ref={dialog} className="image-preview-dialog" aria-label={alt} onCancel={(e) => { e.preventDefault(); onClose(); }}>
    <PreviewHeader hint="Pinch to zoom · drag to pan" label="image" onDownload={() => downloadPreview(src, fileName ?? alt, 'image/png')} onClose={onClose} draft={draft} />
    <div ref={surface} className="image-preview-surface" tabIndex={0} aria-label="Zoomable image" onKeyDown={(e) => {
      if (e.key === '+' || e.key === '=') { e.preventDefault(); zoom(1.5); }
      else if (e.key === '-') { e.preventDefault(); zoom(1 / 1.5); }
      else if (e.key === '0') apply(FIT);
      else if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) { e.preventDefault(); const v = current.current; apply({ ...v, x: v.x + (e.key === 'ArrowLeft' ? 40 : e.key === 'ArrowRight' ? -40 : 0), y: v.y + (e.key === 'ArrowUp' ? 40 : e.key === 'ArrowDown' ? -40 : 0) }); }
    }} onPointerDown={(e) => { if (e.button !== 0) return; e.currentTarget.setPointerCapture(e.pointerId); pointers.current.set(e.pointerId, point(e)); }} onPointerMove={move} onPointerUp={(e) => pointers.current.delete(e.pointerId)} onPointerCancel={(e) => pointers.current.delete(e.pointerId)} onLostPointerCapture={(e) => pointers.current.delete(e.pointerId)} onDoubleClick={(e) => { const p = point(e); current.current.scale > 1 ? apply(FIT) : zoom(2, p.x, p.y); }}>
      <img src={src} alt={alt} draggable={false} style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }} />
    </div>
    <footer className="image-preview-tools"><button className="btn" aria-label="Zoom out" disabled={view.scale <= 1} onClick={() => zoom(1 / 1.5)}>−</button><button className="btn" onClick={() => apply(FIT)}>Fit</button><span className="small" aria-live="polite">{Math.round(view.scale * 100)}%</span><button className="btn" aria-label="Zoom in" disabled={view.scale >= 8} onClick={() => zoom(1.5)}>+</button></footer>
  </dialog></Overlay>;
}

export function ZoomableImage({ src, alt, fileName, className = '' }: { src: string; alt: string; fileName?: string; className?: string }) {
  const [open, setOpen] = useState(false);
  return <><button className={`image-preview-trigger ${className}`} aria-label={`Enlarge ${alt}`} onClick={() => setOpen(true)}><img src={src} alt={alt} /></button>{open && <ImagePreview src={src} alt={alt} fileName={fileName} onClose={() => setOpen(false)} />}</>;
}

/** A full-screen video player with Download and Close, or Discard and Use for a fresh render. */
export function VideoPreview({ src, label, fileName, onClose, draft }: { src: string; label: string; fileName: string; onClose: () => void; draft?: DraftActions }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useFullScreen(dialog);
  return <Overlay><dialog ref={dialog} className="image-preview-dialog" aria-label={label} onCancel={(e) => { e.preventDefault(); onClose(); }}>
    <PreviewHeader hint={label} label="video" onDownload={() => downloadPreview(src, fileName, 'video/mp4')} onClose={onClose} draft={draft} />
    <div className="image-preview-surface video-preview-surface"><video src={src} controls autoPlay playsInline loop aria-label={label} /></div>
  </dialog></Overlay>;
}
