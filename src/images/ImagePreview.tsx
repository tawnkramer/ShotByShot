import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { Overlay } from '../shell/Overlay';

type View = { scale: number; x: number; y: number };
const FIT: View = { scale: 1, x: 0, y: 0 };

/** A full-screen image viewer shared by generated artwork and reference snapshots. */
export function ImagePreview({ src, alt, onClose }: { src: string; alt: string; onClose: () => void }) {
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
  useEffect(() => {
    dialog.current?.showModal();
    const vv = window.visualViewport;
    const fit = () => {
      dialog.current?.style.setProperty('--preview-height', `${vv?.height ?? window.innerHeight}px`);
      dialog.current?.style.setProperty('--preview-top', `${vv?.offsetTop ?? 0}px`);
    };
    fit(); vv?.addEventListener('resize', fit); vv?.addEventListener('scroll', fit); window.addEventListener('resize', fit);
    return () => { vv?.removeEventListener('resize', fit); vv?.removeEventListener('scroll', fit); window.removeEventListener('resize', fit); };
  }, []);
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
    <header className="image-preview-header"><span className="small muted">Pinch to zoom · drag to pan</span><button className="btn" autoFocus onClick={onClose} aria-label="Close image preview">Close</button></header>
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

export function ZoomableImage({ src, alt, className = '' }: { src: string; alt: string; className?: string }) {
  const [open, setOpen] = useState(false);
  return <><button className={`image-preview-trigger ${className}`} aria-label={`Enlarge ${alt}`} onClick={() => setOpen(true)}><img src={src} alt={alt} /></button>{open && <ImagePreview src={src} alt={alt} onClose={() => setOpen(false)} />}</>;
}
