import { useState } from 'react';
import type { CameraState, Project, Shot } from '../../state/schema';
import { useProjectStore } from '../../state/store';
import { aspectOf, subjectsFor, type EffectiveShot } from '../../shots/setup';
import { resetCamera, setCamera, setCameraFixed } from '../../shots/commands';
import { frameSubjects, SHOT_SIZES, type ShotSize } from '../../three/camera';
import { Slider } from '../staging/fields';

interface Props {
  project: Project;
  shot: Shot;
  eff: EffectiveShot;
  editKey: 'start' | 'end';
  /** The camera at the keyframe being edited (including an in-progress gesture). */
  current: CameraState;
}

const SIZES: ShotSize[] = ['EWS', 'WS', 'MS', 'MCU', 'CU', 'ECU'];

export function CameraPanel({ project, shot, eff, editKey, current }: Props) {
  const dispatch = useProjectStore((s) => s.dispatch);
  const [subject, setSubject] = useState<string | null>(null);
  const moving = eff.camera.mode === 'moving';
  const key = moving ? editKey : 'start';
  const set = (patch: Partial<CameraState>, mergeKey?: string) => dispatch(setCamera(shot.id, key, { ...current, ...patch }, mergeKey));
  const mk = (name: string) => `cam:${shot.id}:${key}:${name}`;

  const frame = (size: ShotSize) => {
    const subjects = subjectsFor(project, eff.setup, subject ? [subject] : undefined);
    // Keep the current angle so changing size feels like zooming, not jumping.
    dispatch(setCamera(shot.id, key, frameSubjects(subjects, size, aspectOf(project), { azimuth: current.azimuth, elevation: current.elevation, lens: current.lens })));
  };

  return (
    <div className="inspector">
      <div className="segmented" role="radiogroup" aria-label="Camera movement">
        <button role="radio" aria-checked={!moving} className={!moving ? 'on' : ''} onClick={() => moving && dispatch(setCameraFixed(shot.id))}>
          Fixed
        </button>
        <button role="radio" aria-checked={moving} className={moving ? 'on' : ''} onClick={() => !moving && dispatch(setCamera(shot.id, 'end', { ...eff.camera.start }))}>
          Moving
        </button>
      </div>
      {moving && <p className="muted small">The camera moves from its Start to its End framing. Pick Start or End above the tabs, then frame the shot.</p>}

      <div className="field">
        <span>Frame</span>
        {eff.setup.actors.length > 0 && (
          <div className="type-buttons">
            <button className={`chip tag ${subject === null ? 'current-tag' : ''}`} onClick={() => setSubject(null)}>
              Everyone
            </button>
            {eff.setup.actors.map((a) => {
              const c = project.characters.find((x) => x.id === a.characterId);
              return c ? (
                <button key={c.id} className={`chip tag ${subject === c.id ? 'current-tag' : ''}`} onClick={() => setSubject(c.id)}>
                  {c.name}
                </button>
              ) : null;
            })}
          </div>
        )}
        <div className="size-buttons">
          {SIZES.map((s) => (
            <button key={s} className="btn small-btn" title={SHOT_SIZES[s].label} onClick={() => frame(s)}>
              {s}
            </button>
          ))}
        </div>
      </div>

      <Slider label="Lens" value={Math.log(current.lens)} min={Math.log(12)} max={Math.log(200)} step={0.01} format={(v) => `${Math.round(Math.exp(v))} mm`} onChange={(v) => set({ lens: Math.round(Math.exp(v)) }, mk('lens'))} />
      <Slider label="Distance" value={Math.log(current.distance)} min={Math.log(0.3)} max={Math.log(40)} step={0.01} format={(v) => `${Math.exp(v).toFixed(1)} m`} onChange={(v) => set({ distance: Math.exp(v) }, mk('dist'))} />
      <Slider label="Orbit" value={wrap(current.azimuth)} min={-180} max={180} step={1} format={(v) => `${Math.round(v)}°`} onChange={(v) => set({ azimuth: v }, mk('az'))} />
      <Slider label="Tilt" value={current.elevation} min={-60} max={80} step={1} format={(v) => `${Math.round(v)}°`} onChange={(v) => set({ elevation: v }, mk('el'))} />
      <Slider label="Height" value={current.target[1]} min={0} max={3} step={0.01} format={(v) => `${v.toFixed(2)} m`} onChange={(v) => set({ target: [current.target[0], v, current.target[2]] }, mk('h'))} />
      <Slider label="Roll" value={current.roll} min={-45} max={45} step={1} format={(v) => `${Math.round(v)}°`} onChange={(v) => set({ roll: v }, mk('roll'))} />

      {shot.camera && (
        <button className="btn" onClick={() => dispatch(resetCamera(shot.id))}>
          Automatic camera
        </button>
      )}
    </div>
  );
}

function wrap(deg: number): number {
  return ((((deg + 180) % 360) + 360) % 360) - 180;
}
