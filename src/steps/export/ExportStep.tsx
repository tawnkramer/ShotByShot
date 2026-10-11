import { useEffect, useMemo, useRef, useState } from 'react';
import { useProjectStore } from '../../state/store';
import { aspectOf } from '../../shots/setup';
import { buildSequence } from '../../shots/sequence';
import { spokenLines, validClips } from '../../audio/clips';
import { frameSize, type Resolution } from '../../export/render';
import { ExportCancelled, exportStills, exportVideo, probe, shotMoves, type Capabilities, type Progress } from '../../export/exportVideo';
import { saveFile } from '../../shell/download';
import { exportProjectFile } from '../../storage/projectIO';
import { safeFileName } from '../../storage/projectFile';
import { AudioPanel } from '../common/AudioPanel';

const CODEC_NAMES: Record<string, string> = { avc: 'H.264', hevc: 'HEVC', vp9: 'VP9', av1: 'AV1', aac: 'AAC', opus: 'Opus' };

interface Result {
  kind: 'video' | 'stills';
  blob: Blob;
  url: string;
  name: string;
  note?: string;
}

export function ExportStep() {
  const project = useProjectStore((s) => s.project)!;
  const seq = useMemo(() => buildSequence(project), [project]);
  const aspect = aspectOf(project);
  const [resolution, setResolution] = useState<Resolution>('1080');
  const [fps, setFps] = useState(project.fps);
  const [captions, setCaptions] = useState(true);
  const [shotNumbers, setShotNumbers] = useState(false);
  const [audio, setAudio] = useState(true);
  const [includeEnd, setIncludeEnd] = useState(true);
  const [caps, setCaps] = useState<Capabilities | null>(null);
  const [busy, setBusy] = useState<'video' | 'stills' | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const controller = useRef<AbortController | null>(null);

  const size = frameSize(aspect, resolution);
  const frames = Math.ceil(seq.total * fps);
  const voiced = useMemo(() => validClips(project).size, [project]);
  const spoken = useMemo(() => spokenLines(project).lines.length, [project]);
  const movingShots = useMemo(() => project.shots.filter((s) => shotMoves(project, s.id)).length, [project]);

  useEffect(() => {
    let cancelled = false;
    setCaps(null);
    void probe(size.width, size.height, fps).then((c) => !cancelled && setCaps(c));
    return () => {
      cancelled = true;
    };
  }, [size.width, size.height, fps]);

  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => () => void (result && URL.revokeObjectURL(result.url)), [result]);

  if (!seq.items.length) {
    return (
      <div className="page empty">
        <p>Nothing to export yet.</p>
        <p className="muted small">Import a script in Story to create shots.</p>
      </div>
    );
  }

  const run = async (kind: 'video' | 'stills') => {
    setError(null);
    setResult(null);
    setBusy(kind);
    controller.current = new AbortController();
    const base = safeFileName(project.name);
    try {
      if (kind === 'video') {
        const { blob, codecs } = await exportVideo(project, { resolution, fps, captions, shotNumbers, audio }, setProgress, controller.current.signal);
        const notes = [];
        if (codecs.video !== 'avc') notes.push(`Encoded as ${CODEC_NAMES[codecs.video!] ?? codecs.video}; some players (like QuickTime) may not open it.`);
        if (audio && voiced && !codecs.audio) notes.push("This browser can't encode audio, so the video is silent.");
        setResult({ kind, blob, url: URL.createObjectURL(blob), name: `${base}.mp4`, note: notes.join(' ') || undefined });
      } else {
        const blob = await exportStills(project, { resolution, includeEnd }, setProgress, controller.current.signal);
        setResult({ kind, blob, url: URL.createObjectURL(blob), name: `${base}_stills.zip` });
      }
    } catch (e) {
      if (!(e instanceof ExportCancelled)) setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
      setProgress(null);
      controller.current = null;
    }
  };

  const pct = progress ? Math.round((progress.done / Math.max(1, progress.total)) * 100) : 0;

  return (
    <div className="page export-page">
      <section className="panel">
        <h2>Video</h2>
        <div className="field">
          <span>Resolution</span>
          <div className="segmented">
            {(['720', '1080'] as const).map((r) => (
              <button key={r} className={resolution === r ? 'on' : ''} aria-pressed={resolution === r} onClick={() => setResolution(r)} disabled={!!busy}>
                {r}p
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <span>Frame rate</span>
          <div className="segmented">
            {[24, 25, 30].map((f) => (
              <button key={f} className={fps === f ? 'on' : ''} aria-pressed={fps === f} onClick={() => setFps(f)} disabled={!!busy}>
                {f} fps
              </button>
            ))}
          </div>
        </div>
        <label className="row gap check-row">
          <input type="checkbox" checked={captions} onChange={(e) => setCaptions(e.target.checked)} disabled={!!busy} />
          <span>Burn in dialogue captions</span>
        </label>
        <label className="row gap check-row">
          <input type="checkbox" checked={shotNumbers} onChange={(e) => setShotNumbers(e.target.checked)} disabled={!!busy} />
          <span>Show shot numbers</span>
        </label>
        <label className="row gap check-row">
          <input type="checkbox" checked={audio && voiced > 0} onChange={(e) => setAudio(e.target.checked)} disabled={!!busy || voiced === 0} />
          <span>
            Dialogue audio{' '}
            <span className="muted small">{spoken === 0 ? '(no dialogue)' : voiced === 0 ? '(no lines voiced yet)' : `(${voiced} of ${spoken} lines voiced)`}</span>
          </span>
        </label>
        <p className="muted small">
          {size.width}×{size.height} · {fps} fps · {formatDuration(seq.total)} · {frames} frames
          {caps && (caps.video ? ` · ${CODEC_NAMES[caps.video] ?? caps.video}${caps.audio ? ` + ${CODEC_NAMES[caps.audio] ?? caps.audio}` : ''}` : '')}
        </p>
        {caps && !caps.video && <p className="error small">This browser can't encode video. Try a recent Chrome, Edge or Safari (iOS 16.4 or later).</p>}
        {caps?.video && caps.video !== 'avc' && <p className="muted small">H.264 isn't available here, so the video will be {CODEC_NAMES[caps.video]}. It plays in browsers but may not open in QuickTime.</p>}
        <button className="btn primary" disabled={!!busy || (caps !== null && !caps.video)} onClick={() => void run('video')}>
          Export MP4
        </button>
      </section>

      {spoken > voiced && <AudioPanel project={project} />}

      <section className="panel">
        <h2>Stills</h2>
        <p className="muted small">A PNG of the first frame of each shot, named like S01A_start.png, at the resolution above.</p>
        <label className="row gap check-row">
          <input type="checkbox" checked={includeEnd} onChange={(e) => setIncludeEnd(e.target.checked)} disabled={!!busy} />
          <span>
            Also the last frame of shots that move <span className="muted small">({movingShots} of {project.shots.length})</span>
          </span>
        </label>
        <button className="btn" disabled={!!busy} onClick={() => void run('stills')}>
          Export stills (.zip)
        </button>
      </section>

      {busy && (
        <section className="panel">
          <div className="row gap">
            <strong className="grow">
              {progress?.phase ?? 'Preparing'}… {progress?.phase === 'Rendering' ? `${progress.done} / ${progress.total}` : ''}
            </strong>
            <button className="btn small-btn" onClick={() => controller.current?.abort()}>
              Cancel
            </button>
          </div>
          <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
            <span style={{ width: `${pct}%` }} />
          </div>
          <p className="muted small">Keep this screen open. Rendering runs on this device and can take a while for long films.</p>
        </section>
      )}

      {error && <p className="error">{error}</p>}

      {result && (
        <section className="panel">
          <h2>{result.kind === 'video' ? 'Your previs' : 'Your stills'}</h2>
          {result.kind === 'video' && <video className="export-preview" src={result.url} controls playsInline style={{ aspectRatio: String(aspect) }} />}
          <p className="muted small">
            {result.name} · {(result.blob.size / 1024 / 1024).toFixed(1)} MB
          </p>
          {result.note && <p className="muted small">{result.note}</p>}
          <button className="btn primary" onClick={() => void saveFile(result.blob, result.name, result.blob.type)}>
            Save {result.kind === 'video' ? 'video' : 'zip'}
          </button>
        </section>
      )}

      <section className="panel">
        <h2>Project</h2>
        <p className="muted small">Save the whole project, including models and dialogue audio, to open it on another device or keep a backup.</p>
        <button className="btn" onClick={() => void exportProjectFile(project)}>
          Save project file
        </button>
      </section>
    </div>
  );
}

function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}
