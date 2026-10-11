import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Project } from '../../state/schema';
import { linesNeedingAudio, spokenLines } from '../../audio/clips';
import { useAudioJob } from '../../audio/job';

interface Props {
  project: Project;
  /** Limit to these line ids (e.g. one shot). */
  lineIds?: string[];
  compact?: boolean;
}

/** Dialogue audio status, with a button to voice whatever is missing. */
export function AudioPanel({ project, lineIds, compact }: Props) {
  const navigate = useNavigate();
  const job = useAudioJob();
  const scope = useMemo(() => (lineIds ? new Set(lineIds) : null), [lineIds]);
  const { lines: all, unassigned } = useMemo(() => spokenLines(project), [project]);
  const lines = scope ? all.filter((s) => scope.has(s.line.id)) : all;
  const needed = useMemo(() => linesNeedingAudio(project).filter((s) => !scope || scope.has(s.line.id)), [project, scope]);

  if (!lines.length && !(unassigned && !scope)) return null;
  const voiced = lines.length - needed.length;
  const keyMissing = job.error?.includes('API key');

  return (
    <section className={`audio-panel ${compact ? 'compact' : 'panel'}`}>
      <div className="row gap">
        <span className="grow small">
          <strong>Dialogue audio</strong>{' '}
          <span className="muted">
            {voiced} of {lines.length} {lines.length === 1 ? 'line' : 'lines'} voiced
          </span>
        </span>
        {job.running ? (
          <button className="btn small-btn" onClick={job.cancel}>
            Cancel
          </button>
        ) : (
          needed.length > 0 && (
            <button className="btn small-btn primary" onClick={() => void job.start(needed)}>
              Voice {needed.length} {needed.length === 1 ? 'line' : 'lines'}
            </button>
          )
        )}
      </div>
      {job.running && (
        <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={job.total} aria-valuenow={job.done}>
          <span style={{ width: `${(job.done / Math.max(1, job.total)) * 100}%` }} />
        </div>
      )}
      {!compact && !job.running && needed.length > 0 && (
        <p className="muted small">Uses your OpenAI key: one request per line, with each character's voice. Shots then time themselves to the audio.</p>
      )}
      {!scope && unassigned > 0 && <p className="muted small">{unassigned} lines are spoken by names that aren't characters yet, so they stay silent. Add them in Characters.</p>}
      {job.error && (
        <p className="error small">
          {job.error}{' '}
          {keyMissing && (
            <button className="link-btn" onClick={() => navigate('/settings')}>
              Open Settings
            </button>
          )}
        </p>
      )}
    </section>
  );
}
