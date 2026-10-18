import { Overlay } from './Overlay';
import { ASPECT_RATIOS, mediumOf, PANEL_SHAPES, type AspectRatioId, type Medium } from '../state/schema';
import { useProjectStore } from '../state/store';
import { NUMBERING_INFO, SHOT_NUMBERINGS } from '../story/numbering';
import { setShotNumbering } from '../story/commands';

const FPS_OPTIONS = [24, 25, 30];

export function ProjectSettingsSheet({ onClose }: { onClose: () => void }) {
  const project = useProjectStore((s) => s.project)!;
  const dispatch = useProjectStore((s) => s.dispatch);
  const comic = mediumOf(project) === 'comic';
  // Comics choose among panel shapes; films among film and video frames.
  const shapes = comic ? PANEL_SHAPES.map((p) => ({ id: p.id, label: p.label, ratio: ASPECT_RATIOS.find((a) => a.id === p.id)!.ratio })) : ASPECT_RATIOS.filter((a) => a.id !== '1:1' && a.id !== '3:4');
  const setMedium = (m: Medium) => dispatch({
    label: m === 'comic' ? 'Make a comic' : 'Make a film',
    // Film-only data (motion, timing, audio) is kept, just hidden, so switching back loses nothing.
    apply: (d) => { if (m === 'comic') d.medium = 'comic'; else delete d.medium; },
  });

  return (
    <Overlay>
      <div className="scrim" onClick={onClose} />
      <div className="sheet" role="dialog" aria-label="Project settings">
        <div className="sheet-head">
          <strong>Project settings</strong>
          <button className="btn ghost" onClick={onClose}>
            Close
          </button>
        </div>
        <label className="field">
          <span>Name</span>
          <input
            defaultValue={project.name}
            onBlur={(e) => {
              const name = e.target.value.trim();
              if (name && name !== project.name) dispatch({ label: 'Rename project', apply: (d) => void (d.name = name) });
            }}
          />
        </label>
        <div className="field">
          <span>Kind</span>
          <div className="segmented" role="radiogroup" aria-label="Kind of project">
            {(['film', 'comic'] as const).map((m) => (
              <button key={m} role="radio" aria-checked={mediumOf(project) === m} className={mediumOf(project) === m ? 'on' : ''} onClick={() => mediumOf(project) !== m && setMedium(m)}>
                {m === 'film' ? 'Film' : 'Comic'}
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <span>{comic ? 'Default panel shape' : 'Aspect ratio'}</span>
          <div className="aspect-grid">
            {shapes.map((a) => (
              <button
                key={a.id}
                className={`aspect-option ${project.aspect === a.id ? 'selected' : ''}`}
                aria-pressed={project.aspect === a.id}
                onClick={() => dispatch({ label: 'Change aspect ratio', apply: (d) => void (d.aspect = a.id as AspectRatioId) })}
              >
                <span className="aspect-box">
                  <span className="aspect-swatch" style={swatchSize(a.ratio)} />
                </span>
                <span className="small">{a.label}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <span>Shot numbers</span>
          <div className="numbering-options">
            {SHOT_NUMBERINGS.map((n) => (
              <button
                key={n}
                className={`numbering-option ${project.shotNumbering === n ? 'selected' : ''}`}
                aria-pressed={project.shotNumbering === n}
                onClick={() => project.shotNumbering !== n && dispatch(setShotNumbering(n))}
              >
                <strong>{NUMBERING_INFO[n].label}</strong>
                <span className="mono small">{NUMBERING_INFO[n].example}</span>
                <span className="muted small">{NUMBERING_INFO[n].note}</span>
              </button>
            ))}
          </div>
          <p className="muted small">Numbered scene headings in the script (like “12 INT. CAFE - DAY 12”) are used as scene numbers.</p>
        </div>
        {!comic && <label className="field">
          <span>Frame rate</span>
          <select
            value={project.fps}
            onChange={(e) => dispatch({ label: 'Change frame rate', apply: (d) => void (d.fps = Number(e.target.value)) })}
          >
            {FPS_OPTIONS.map((f) => (
              <option key={f} value={f}>
                {f} fps
              </option>
            ))}
          </select>
        </label>}
      </div>
    </Overlay>
  );
}

/** Fits a swatch of the given ratio inside a 64×36 box. */
function swatchSize(ratio: number) {
  const [maxW, maxH] = [64, 36];
  return ratio >= maxW / maxH ? { width: maxW, height: maxW / ratio } : { width: maxH * ratio, height: maxH };
}
