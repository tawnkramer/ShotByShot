import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useProjectStore } from '../../state/store';
import { buildSequence, locate } from '../../shots/sequence';
import { aspectOf, captionsOf, effectiveShots, shotLines, summaryLine } from '../../shots/setup';
import { captionAt } from '../../shots/timing';
import { formatTime } from '../shots/ShotsStep';
import { PrevisCanvas } from './PrevisCanvas';
import { AudioPanel } from '../common/AudioPanel';
import { ScriptExcerpt } from '../common/ScriptExcerpt';
import { audioContext, DialoguePlayer, loadBuffer, type Cue } from '../../audio/player';

export function PrevisStep() {
  const project = useProjectStore((s) => s.project)!;
  const navigate = useNavigate();
  const [search] = useSearchParams();
  const seq = useMemo(() => buildSequence(project), [project]);
  const aspect = aspectOf(project);

  const initial = Math.min(Number(search.get('t')) || 0, seq.total);
  const timeRef = useRef(initial);
  const [t, setT] = useState(initial);
  const [timeVersion, setTimeVersion] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [loop, setLoop] = useState(false);

  const seek = (next: number) => {
    const clamped = Math.min(Math.max(0, next), seq.total);
    timeRef.current = clamped;
    setT(clamped);
    setTimeVersion((v) => v + 1);
  };

  const { index, u } = locate(seq, t);
  const item = seq.items[index];
  const shot = item && project.shots.find((s) => s.id === item.shotId);
  const eff = shot && effectiveShots(project).get(shot.id);
  const lines = useMemo(() => (shot ? shotLines(project, shot) : []), [project, shot]);
  const caption = eff && shot ? captionAt(captionsOf(project, shot, eff.durationSec), u * eff.durationSec) : undefined;

  // Dialogue for the whole film, on the film's timeline.
  const cues = useMemo(() => {
    const out: Cue[] = [];
    const eff = effectiveShots(project);
    for (const it of seq.items) {
      const s = project.shots.find((x) => x.id === it.shotId);
      const e = eff.get(it.shotId);
      if (!s || !e) continue;
      for (const c of captionsOf(project, s, e.durationSec)) if (c.audioBlob && c.inSec < e.durationSec) out.push({ blob: c.audioBlob, at: it.start + c.inSec });
    }
    return out;
  }, [project, seq]);
  const player = useMemo(() => new DialoguePlayer(), []);
  useEffect(() => {
    for (const c of cues.slice(0, 12)) void loadBuffer(c.blob);
  }, [cues]);
  useEffect(() => {
    if (playing) void player.start(cues, timeRef.current);
    else player.stop();
  }, [playing]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => player.stop(), [player]);
  const lastT = useRef(initial);
  const onTick = (next: number) => {
    // Looping back to the start: restart the dialogue too.
    if (playing && next < lastT.current - 0.5) void player.start(cues, next);
    lastT.current = next;
    setT(next);
  };

  // Space toggles play on desktop.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || (e.target as HTMLElement).closest('input, textarea, select')) return;
      e.preventDefault();
      setPlaying((p) => !p);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // While playing, follow the current shot in the list; when paused, show its details at the top.
  const listRef = useRef<HTMLOListElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (playing) listRef.current?.querySelector('.on')?.scrollIntoView({ block: 'nearest' });
    else panelRef.current?.scrollTo({ top: 0 });
  }, [index, playing]);

  if (!seq.items.length) {
    return (
      <div className="page empty">
        <p>Nothing to play yet.</p>
        <p className="muted small">Import a script in Story to create shots.</p>
      </div>
    );
  }

  const play = () => {
    if (playing) return setPlaying(false);
    audioContext(); // unlock audio during the tap (iOS)
    if (timeRef.current >= seq.total) seek(0);
    setPlaying(true);
  };
  const step = (dir: -1 | 1) => {
    setPlaying(false);
    // Back goes to the start of this shot first, like a video player.
    const target = dir < 0 && u > 0.05 ? item.start : seq.items[Math.min(seq.items.length - 1, Math.max(0, index + dir))].start;
    seek(target);
  };
  const stage = eff && project.stages.find((s) => s.id === eff.stageId);
  const cast = eff?.setup.actors.map((a) => project.characters.find((c) => c.id === a.characterId)?.name).filter(Boolean) ?? [];

  return (
    <div className="previs">
      <div className="frame-wrap">
        <div className="frame" style={{ aspectRatio: String(aspect), width: `min(100%, calc(42dvh * ${aspect}))` }} onClick={play}>
          <PrevisCanvas
            project={project}
            seq={seq}
            aspect={aspect}
            timeRef={timeRef}
            timeVersion={timeVersion}
            playing={playing}
            loop={loop}
            onTick={onTick}
            onEnded={() => {
              setPlaying(false);
              setT(seq.total);
            }}
          />
          {caption && (
            <div className="caption">
              {caption.speaker && <span className="caption-speaker">{caption.speaker}</span>}
              <span>{caption.text}</span>
            </div>
          )}
          <div className="frame-badges">
            <span className="badge">{item.number}</span>
          </div>
        </div>
      </div>

      <div className="transport">
        <Scrubber seq={seq} t={t} onSeek={(v) => {
          setPlaying(false);
          seek(v);
        }} />
        <div className="row gap transport-buttons">
          <button className="btn icon" aria-label="Previous shot" onClick={() => step(-1)}>
            ⏮
          </button>
          <button className="btn icon play" aria-label={playing ? 'Pause' : 'Play'} onClick={play}>
            {playing ? '❚❚' : '▶'}
          </button>
          <button className="btn icon" aria-label="Next shot" onClick={() => step(1)}>
            ⏭
          </button>
          <span className="time small grow">
            {formatClock(t)} / {formatClock(seq.total)}
          </span>
          <button className={`btn small-btn ${loop ? 'on-accent' : ''}`} aria-pressed={loop} onClick={() => setLoop((l) => !l)}>
            Loop
          </button>
        </div>
      </div>

      <div className="split-panel" ref={panelRef}>
        <AudioPanel project={project} compact />
        {!playing && shot && (
          <section className="panel shot-info-panel">
            <div className="row gap">
              <strong className="grow">
                Shot {shot.number} · {stage?.name ?? 'No stage'}
              </strong>
              <span className="muted small">{eff!.durationSec.toFixed(1)} s</span>
            </div>
            {cast.length > 0 && <span className="muted small">{cast.join(', ')}</span>}
            <div className="info-lines">
              <ScriptExcerpt lines={lines} />
            </div>
            <button className="btn primary" onClick={() => navigate(`/p/${project.id}/shots/${shot.id}?from=previs&t=${t.toFixed(2)}`)}>
              Edit shot {shot.number}
            </button>
          </section>
        )}
        <ol className="previs-list" ref={listRef}>
          {seq.items.map((it, i) => (
            <li key={it.shotId} className={i === index ? 'on' : ''}>
              <button
                onClick={() => {
                  setPlaying(false);
                  seek(it.start);
                }}
              >
                <span className="badge">{it.number}</span>
                <span className="grow previs-list-text">{summaryLine(project, project.shots.find((x) => x.id === it.shotId)!)}</span>
                <span className="muted small">{formatTime(it.duration)}</span>
              </button>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

function formatClock(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
}

/** A scrub bar with a tick and number at each cut. Drag anywhere on it. */
function Scrubber({ seq, t, onSeek }: { seq: ReturnType<typeof buildSequence>; t: number; onSeek: (t: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const at = (clientX: number) => {
    const r = ref.current!.getBoundingClientRect();
    return (Math.min(Math.max(0, clientX - r.left), r.width) / r.width) * seq.total;
  };
  const pct = (v: number) => `${(v / seq.total) * 100}%`;
  // Only label cuts with room for a number.
  const minGap = seq.total * 0.06;
  let lastLabel = -Infinity;
  return (
    <div
      ref={ref}
      className="scrubber"
      role="slider"
      aria-label="Film time"
      aria-valuemin={0}
      aria-valuemax={Math.round(seq.total)}
      aria-valuenow={Math.round(t)}
      tabIndex={0}
      onPointerDown={(e) => {
        dragging.current = true;
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        onSeek(at(e.clientX));
      }}
      onPointerMove={(e) => dragging.current && onSeek(at(e.clientX))}
      onPointerUp={() => (dragging.current = false)}
      onPointerCancel={() => (dragging.current = false)}
      onKeyDown={(e) => {
        if (e.key === 'ArrowRight') onSeek(t + 1);
        if (e.key === 'ArrowLeft') onSeek(t - 1);
      }}
    >
      <div className="scrub-labels">
        {seq.items.map((it) => {
          if (it.start - lastLabel < minGap) return null;
          lastLabel = it.start;
          return (
            <span key={it.shotId} style={{ left: pct(it.start) }}>
              {it.number}
            </span>
          );
        })}
      </div>
      <div className="scrub-track">
        {seq.items.map((it, i) => (
          <span key={it.shotId} className={`scrub-shot ${i % 2 ? 'odd' : ''}`} style={{ left: pct(it.start), width: pct(it.duration) }} />
        ))}
        <span className="scrub-fill" style={{ width: pct(t) }} />
        <span className="scrub-head" style={{ left: pct(t) }} />
      </div>
    </div>
  );
}
