import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePanelPicture } from '../../comic/picture';
import { coverOf, movePage, pageName, pageOrder, pagesOf, resetPageOrder, setCover, setLeftOut } from '../../comic/pages';
import type { Project, Shot } from '../../state/schema';
import { useProjectStore } from '../../state/store';
import { useVisible } from '../shots/ShotsStep';

/** Comic pages: one panel per page, in order, with a cover and a read-through. */
export function PagesStep() {
  const project = useProjectStore((s) => s.project)!;
  const dispatch = useProjectStore((s) => s.dispatch);
  const navigate = useNavigate();
  const [reading, setReading] = useState<number | null>(null);
  const order = pageOrder(project);
  const pages = pagesOf(project);
  const numberOf = new Map(pages.map((p) => [p.shotId, p.number]));
  const cover = coverOf(project);
  const leftOut = new Set(project.comic?.leftOut ?? []);
  const unlettered = pages.filter((p) => !project.shots.find((s) => s.id === p.shotId)?.lettering?.length).length;
  const noArt = pages.filter((p) => !project.shots.find((s) => s.id === p.shotId)?.image).length;

  if (!project.shots.length) {
    return (
      <div className="page empty">
        <p>No panels yet.</p>
        <p className="muted small">Import a script in Story to break it into panels.</p>
      </div>
    );
  }

  return (
    <div className="page pages-page">
      <p className="muted small">
        {pages.length} {pages.length === 1 ? 'page' : 'pages'} · one panel per page
        {noArt > 0 && ` · ${noArt} still previs`}
        {unlettered > 0 && ` · ${unlettered} without lettering`}
      </p>
      {pages.length > 99 && <p className="error small">Pages are named Page01–Page99; more than 99 won't sort correctly on the comic site.</p>}
      <div className="row gap">
        <button className="btn primary" disabled={!pages.length} onClick={() => setReading(0)}>Read</button>
        {project.comic?.pageOrder && <button className="btn" onClick={() => dispatch(resetPageOrder())}>Back to panel order</button>}
      </div>
      <ol className="page-list">
        {order.map((id, i) => {
          const shot = project.shots.find((s) => s.id === id)!;
          const n = numberOf.get(id);
          return (
            <li key={id}>
              <PageCard project={project} shot={shot} number={n} cover={id === cover} out={leftOut.has(id)}
                onOpen={() => (n ? setReading(n - 1) : navigate(`/p/${project.id}/shots/${id}`))}
                onEdit={() => navigate(`/p/${project.id}/shots/${id}`)}
                onUp={i > 0 ? () => dispatch(movePage(id, -1)) : undefined}
                onDown={i < order.length - 1 ? () => dispatch(movePage(id, 1)) : undefined}
                onCover={() => dispatch(setCover(id))}
                onLeaveOut={(out) => dispatch(setLeftOut(id, out))} />
            </li>
          );
        })}
      </ol>
      {reading !== null && pages.length > 0 && (
        <Reader project={project} start={Math.min(reading, pages.length - 1)} onClose={() => setReading(null)}
          onEdit={(shotId) => { setReading(null); navigate(`/p/${project.id}/shots/${shotId}`); }} />
      )}
    </div>
  );
}

function PageCard({ project, shot, number, cover, out, onOpen, onEdit, onUp, onDown, onCover, onLeaveOut }: {
  project: Project; shot: Shot; number?: number; cover: boolean; out: boolean;
  onOpen: () => void; onEdit: () => void; onUp?: () => void; onDown?: () => void; onCover: () => void; onLeaveOut: (out: boolean) => void;
}) {
  const [ref, visible] = useVisible<HTMLDivElement>();
  const { url, artwork } = usePanelPicture(project, shot, visible);
  return (
    <div ref={ref} className={`page-card${out ? ' left-out' : ''}`}>
      <button className="page-thumb" onClick={onOpen} aria-label={number ? `Read from ${pageName(number)}` : `Panel ${shot.number}`}>
        {url ? <img src={url} alt="" draggable={false} /> : <span className="muted small">…</span>}
      </button>
      <div className="page-info">
        <div className="row gap">
          <strong className="grow">{number ? pageName(number) : 'Left out'}</strong>
          {cover && <span className="badge key">Cover</span>}
        </div>
        <span className="muted small">
          Panel {shot.number}{!artwork && ' · previs'}{shot.lettering?.length ? '' : ' · no lettering'}
        </span>
        <div className="page-actions">
          <button className="btn icon" aria-label="Earlier" disabled={!onUp} onClick={onUp}>↑</button>
          <button className="btn icon" aria-label="Later" disabled={!onDown} onClick={onDown}>↓</button>
          {!out && !cover && <button className="btn small-btn" onClick={onCover}>Make cover</button>}
          <button className="btn small-btn" onClick={() => onLeaveOut(!out)}>{out ? 'Put back' : 'Leave out'}</button>
          <button className="btn small-btn ghost" onClick={onEdit}>Edit</button>
        </div>
      </div>
    </div>
  );
}

/** Full-screen read-through: swipe, tap the sides, or use the arrow keys. */
function Reader({ project, start, onClose, onEdit }: { project: Project; start: number; onClose: () => void; onEdit: (shotId: string) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const pages = pagesOf(project);
  const [index, setIndex] = useState(start);
  const page = pages[Math.min(index, pages.length - 1)];
  const shot = project.shots.find((s) => s.id === page.shotId)!;
  const { url } = usePanelPicture(project, shot, true, 1600);
  const swipe = useRef<{ x: number; y: number } | null>(null);
  const go = (by: number) => setIndex((i) => Math.max(0, Math.min(pages.length - 1, i + by)));

  useEffect(() => {
    const d = dialog.current;
    if (d && !d.open) d.showModal?.();
    const key = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); go(1); }
      if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const down = (e: ReactPointerEvent) => { swipe.current = { x: e.clientX, y: e.clientY }; };
  const up = (e: ReactPointerEvent<HTMLDivElement>) => {
    const s = swipe.current;
    swipe.current = null;
    if (!s) return;
    const dx = e.clientX - s.x, dy = e.clientY - s.y;
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) return go(dx < 0 ? 1 : -1);
    // A tap: the left third goes back, anywhere else goes on.
    const r = e.currentTarget.getBoundingClientRect();
    if (Math.abs(dx) < 10 && Math.abs(dy) < 10) go(e.clientX - r.left < r.width / 3 ? -1 : 1);
  };

  return (
    <dialog ref={dialog} className="reader-dialog" aria-label="Read the comic" onCancel={(e) => { e.preventDefault(); onClose(); }}>
      <header className="row gap reader-head">
        <strong className="grow">{pageName(page.number)} <span className="muted small">· {page.number} of {pages.length}</span></strong>
        <button className="btn ghost" onClick={() => onEdit(shot.id)}>Edit panel</button>
        <button className="btn ghost" onClick={onClose}>Close</button>
      </header>
      <div className="reader-page" onPointerDown={down} onPointerUp={up} data-testid="reader-page">
        {url ? <img src={url} alt={`${pageName(page.number)}, panel ${shot.number}`} draggable={false} /> : <p className="muted">Drawing page…</p>}
      </div>
      <footer className="row gap reader-foot">
        <button className="btn" disabled={index === 0} onClick={() => go(-1)}>‹ Previous</button>
        <span className="grow" />
        <button className="btn" disabled={index >= pages.length - 1} onClick={() => go(1)}>Next ›</button>
      </footer>
    </dialog>
  );
}
