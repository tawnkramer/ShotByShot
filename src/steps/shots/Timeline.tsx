import { NumberField } from '../staging/fields';

interface Props {
  u: number;
  durationSec: number;
  locked: boolean;
  playing: boolean;
  editKey: 'start' | 'end';
  showKeys: boolean;
  onPlay: () => void;
  onScrub: (u: number) => void;
  onKey: (k: 'start' | 'end') => void;
  onDuration: (sec: number | null) => void;
}

export function Timeline({ u, durationSec, locked, playing, editKey, showKeys, onPlay, onScrub, onKey, onDuration }: Props) {
  return (
    <div className="timeline">
      <div className="row gap">
        <button className="btn icon play" aria-label={playing ? 'Pause' : 'Play'} onClick={onPlay}>
          {playing ? '❚❚' : '▶'}
        </button>
        <input className="grow scrub" type="range" min={0} max={1} step={0.001} value={u} aria-label="Time" onChange={(e) => onScrub(Number(e.target.value))} />
        <span className="time small">
          {(u * durationSec).toFixed(1)} / {durationSec.toFixed(1)} s
        </span>
      </div>
      <div className="row gap">
        {showKeys ? (
          <div className="segmented compact keys" role="radiogroup" aria-label="Keyframe">
            {(['start', 'end'] as const).map((k) => (
              <button key={k} role="radio" aria-checked={editKey === k} className={editKey === k ? 'on' : ''} onClick={() => onKey(k)}>
                {k === 'start' ? 'Start' : 'End'}
              </button>
            ))}
          </div>
        ) : (
          <span className="muted small grow">Fixed camera</span>
        )}
        <span className="grow" />
        <div className="duration">
          <NumberField label="Length" value={durationSec} step={0.5} min={0.5} max={600} digits={1} onCommit={(v) => onDuration(v)} />
          {locked && (
            <button className="link-btn" onClick={() => onDuration(null)}>
              Auto
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
