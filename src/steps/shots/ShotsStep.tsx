import { useBlobUrl } from '../../images/useBlobUrl';
import { useLetteredUrl } from '../../comic/preview';
import { letterEmptyPanels } from '../../comic/batch';
import { setLetteringMany } from '../../comic/commands';
import { Overlay } from '../../shell/Overlay';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useProjectStore } from '../../state/store';
import { mediumOf, type Project, type Shot } from '../../state/schema';
import { effectiveShots, shotLines } from '../../shots/setup';
import { ScriptExcerpt } from '../common/ScriptExcerpt';
import { renderShotThumbnail } from '../../shots/thumbnail';
import { dialogueSplitPoints, mergeWithNext, splitShot } from '../../shots/commands';
import { useLongPress } from '../../shell/useLongPress';
import { frameAspect } from '../../shots/setup';
import { AudioPanel } from '../common/AudioPanel';
import { useChatUI } from '../../shell/chatUI';

export function ShotsStep() {
  const project = useProjectStore((s) => s.project)!;
  const navigate = useNavigate();
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [splitting, setSplitting] = useState<string | null>(null);
  const eff = useMemo(() => effectiveShots(project), [project]);
  // Ask the assistant to stage or shoot the whole scene, as if typed in the chat.
  const submit = useChatUI((s) => s.submit);
  const running = useChatUI((s) => s.running);
  const totalSec = useMemo(() => [...eff.values()].reduce((a, e) => a + e.durationSec, 0), [eff]);

  // Coming back from the editor: scroll the edited shot into view.
  useEffect(() => {
    const id = decodeURIComponent(window.location.hash.split('#').pop() ?? '');
    if (id) document.getElementById(`shot-${id}`)?.scrollIntoView({ block: 'center' });
  }, []);

  const comic = mediumOf(project) === 'comic';
  const unit = comic ? 'panel' : 'shot';
  const dispatch = useProjectStore((s) => s.dispatch);
  const [lettering, setLettering] = useState<string>();
  const letterAll = async () => {
    setLettering('Lettering…');
    try {
      const byShot = await letterEmptyPanels(useProjectStore.getState().project!);
      if (byShot.size) dispatch(setLetteringMany(byShot));
      setLettering(byShot.size ? `Lettered ${byShot.size} panel${byShot.size === 1 ? '' : 's'}. Open one to adjust it.` : 'Every panel with dialogue is already lettered.');
    } catch (e) {
      setLettering(e instanceof Error ? e.message : String(e));
    }
  };
  if (!project.shots.length) {
    return (
      <div className="page empty">
        <p>No {unit}s yet.</p>
        <p className="muted small">Import a script in Story to break it into {unit}s.</p>
      </div>
    );
  }

  const menuShot = project.shots.find((s) => s.id === menuFor);
  const splitShotObj = project.shots.find((s) => s.id === splitting);

  return (
    <div className="page shots-page">
      <p className="muted small">
        {comic
          ? `${project.shots.length} panels · Tap a panel to edit it. Press and hold to merge or split.`
          : `${project.shots.length} shots · ${formatTime(totalSec)} · Tap a shot to edit it. Press and hold to merge or split.`}
      </p>
      <div className="row plan-row">
        <button className="btn" disabled={running} onClick={() => submit('Plan the blocking.')}>
          Plan blocking
        </button>
        <button className="btn" disabled={running} onClick={() => submit('Plan the camera.')}>
          Plan cameras
        </button>
        {comic && <button className="btn" disabled={lettering === 'Lettering…'} onClick={() => void letterAll()}>
          Letter all panels
        </button>}
      </div>
      {lettering && <p className="muted small" role="status">{lettering}</p>}
      {!comic && <AudioPanel project={project} />}
      <ol className="shot-list">
        {project.shots.map((shot) => (
          <li key={shot.id} id={`shot-${shot.id}`}>
            <ShotCard project={project} shot={shot} onOpen={() => navigate(`/p/${project.id}/shots/${shot.id}`)} onMenu={() => setMenuFor(shot.id)} />
          </li>
        ))}
      </ol>
      {menuShot && (
        <ShotMenu
          project={project}
          shot={menuShot}
          onClose={() => setMenuFor(null)}
          onEdit={() => navigate(`/p/${project.id}/shots/${menuShot.id}`)}
          onSplit={() => {
            setMenuFor(null);
            setSplitting(menuShot.id);
          }}
        />
      )}
      {splitShotObj && <SplitSheet project={project} shot={splitShotObj} onClose={() => setSplitting(null)} />}
    </div>
  );
}

export function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return m ? `${m}:${String(s).padStart(2, '0')}` : `${sec.toFixed(1)} s`;
}

function useVisible<T extends Element>(): [React.RefObject<T | null>, boolean] {
  const ref = useRef<T>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || visible) return;
    if (!('IntersectionObserver' in window)) return setVisible(true);
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && setVisible(true), { rootMargin: '300px' });
    io.observe(el);
    return () => io.disconnect();
  }, [visible]);
  return [ref, visible];
}

function ShotCard({ project, shot, onOpen, onMenu }: { project: Project; shot: Shot; onOpen: () => void; onMenu: () => void }) {
  const eff = effectiveShots(project).get(shot.id)!;
  const [ref, visible] = useVisible<HTMLButtonElement>();
  const artwork = useBlobUrl(shot.image?.blob);
  const [thumb, setThumb] = useState<string | null>(null);
  const press = useLongPress(onMenu, onOpen);
  const picture = useLetteredUrl(artwork || thumb || undefined, shot.lettering, project.lettering, 960);

  useEffect(() => {
    if (!visible || artwork) return;
    let cancelled = false;
    void renderShotThumbnail(project, shot.id).then((u) => !cancelled && u && setThumb(u));
    return () => {
      cancelled = true;
    };
  }, [visible, project, shot.id, artwork]);

  const stage = project.stages.find((s) => s.id === eff.stageId);
  const names = eff.setup.actors.map((a) => project.characters.find((c) => c.id === a.characterId)?.name).filter(Boolean);
  const lines = shotLines(project, shot);
  const moving = eff.camera.mode === 'moving';
  const comic = mediumOf(project) === 'comic';
  const aspect = frameAspect(project, shot);
  // Tall frames (9:16) sit beside the script instead of filling the screen above it.
  const portrait = aspect < 1;

  return (
    <button ref={ref} className={`shot-card ${portrait ? 'portrait' : ''}`} {...press}>
      <span className={`shot-thumb${artwork ? ' artwork' : ''}`} style={{ aspectRatio: String(aspect) }}>
        {picture ? <img src={picture} alt="" draggable={false} /> : <span className="muted small">{stage ? '' : 'No stage yet'}</span>}
        <span className="shot-number">{shot.number}</span>
        {comic ? shot.lettering?.length ? <span className="shot-duration">{shot.lettering.length} lettered</span> : null : <span className="shot-duration">{eff.durationSec.toFixed(1)} s</span>}
      </span>
      <span className="shot-info">
        <span className="shot-meta small">
          <strong>{stage?.name ?? 'No stage'}</strong>
          {!comic && <span className="muted">{moving ? 'Moving camera' : 'Fixed camera'}</span>}
        </span>
        {names.length > 0 && <span className="muted small">{names.join(', ')}</span>}
        <ScriptExcerpt lines={lines} />
      </span>
    </button>
  );
}

function ShotMenu({ project, shot, onClose, onEdit, onSplit }: { project: Project; shot: Shot; onClose: () => void; onEdit: () => void; onSplit: () => void }) {
  const dispatch = useProjectStore((s) => s.dispatch);
  const i = project.shots.findIndex((s) => s.id === shot.id);
  const next = project.shots[i + 1];
  const Unit = mediumOf(project) === 'comic' ? 'Panel' : 'Shot';
  const unit = Unit.toLowerCase();
  return (
    <Overlay>
      <div className="scrim" onClick={onClose} />
      <div className="sheet" role="dialog" aria-label={`${Unit} ${shot.number}`}>
        <div className="sheet-head">
          <strong>{Unit} {shot.number}</strong>
          <button className="btn ghost" onClick={onClose}>
            Close
          </button>
        </div>
        <button className="btn" onClick={onEdit}>
          Edit {unit}
        </button>
        <button
          className="btn"
          disabled={!next}
          onClick={() => {
            dispatch(mergeWithNext(shot.id));
            onClose();
          }}
        >
          {next ? `Merge with ${unit} ${next.number} below` : `Merge with ${unit} below`}
        </button>
        <button className="btn" disabled={shot.lineIds.length < 2} onClick={onSplit}>
          Split {unit}…
        </button>
      </div>
    </Overlay>
  );
}

function SplitSheet({ project, shot, onClose }: { project: Project; shot: Shot; onClose: () => void }) {
  const dispatch = useProjectStore((s) => s.dispatch);
  const lines = shotLines(project, shot);
  const [cuts, setCuts] = useState(() => new Set(dialogueSplitPoints(project, shot)));
  const unit = mediumOf(project) === 'comic' ? 'panel' : 'shot';
  const toggle = (id: string) =>
    setCuts((c) => {
      const n = new Set(c);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  return (
    <Overlay>
      <div className="scrim" onClick={onClose} />
      <div className="sheet" role="dialog" aria-label={`Split ${unit}`}>
        <div className="sheet-head">
          <strong>Split {unit} {shot.number}</strong>
          <button className="btn ghost" onClick={onClose}>
            Cancel
          </button>
        </div>
        <p className="muted small">Cuts are suggested before each new speaker. Tap between lines to add or remove a cut.</p>
        <ol className="split-lines">
          {lines.map((l, i) => (
            <li key={l.id}>
              {i > 0 && (
                <button className={`cut ${cuts.has(l.id) ? 'on' : ''}`} aria-label={cuts.has(l.id) ? 'Remove cut' : 'Cut here'} onClick={() => toggle(l.id)}>
                  {cuts.has(l.id) && <span className="cut-label">Cut</span>}
                </button>
              )}
              <div className={`line line-${l.type}`}>
                <span className="line-text">{l.text}</span>
              </div>
            </li>
          ))}
        </ol>
        <button
          className="btn primary"
          disabled={!cuts.size}
          onClick={() => {
            dispatch(splitShot(shot.id, [...cuts]));
            onClose();
          }}
        >
          {cuts.size ? `Split into ${cuts.size + 1} ${unit}s` : 'Choose where to cut'}
        </button>
      </div>
    </Overlay>
  );
}
