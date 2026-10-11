import { newId, POSES, type Project, type Shot } from '../../state/schema';
import { useProjectStore } from '../../state/store';
import type { EffectiveShot } from '../../shots/setup';
import { addActor, addShotProp, removeActor, removeShotProp, setActorKey, setActorStill, setShotStage, setStageOverride } from '../../shots/commands';
import { keyOf } from '../../shots/timing';
import type { RigId } from '../../three/shotRig';

const POSE_LABEL = { standing: 'Standing', sitting: 'Sitting', walking: 'Walking', leaning: 'Leaning', lying: 'Lying' } as const;

interface Props {
  project: Project;
  shot: Shot;
  eff: EffectiveShot;
  editKey: 'start' | 'end';
  selected: RigId | null;
  onSelect: (id: RigId | null) => void;
}

export function BlockingPanel({ project, shot, eff, editKey, selected, onSelect }: Props) {
  const dispatch = useProjectStore((s) => s.dispatch);
  const inShot = new Set(eff.setup.actors.map((a) => a.characterId));
  const available = project.characters.filter((c) => !inShot.has(c.id));
  const stage = project.stages.find((s) => s.id === eff.stageId);
  const selectedStageObj = selected?.startsWith('stage:') ? stage?.objects.find((o) => `stage:${o.id}` === selected) : undefined;
  const override = selectedStageObj ? eff.setup.stageOverrides[selectedStageObj.id] : undefined;

  // New things go near the people already in the shot.
  const anchor = eff.setup.actors[0]?.motion.start.position ?? [0, 0, 0];

  return (
    <div className="inspector">
      <p className="muted small">
        {editKey === 'start'
          ? 'Tap someone or something in the frame to move it. Switch to End to make it move during the shot.'
          : 'Editing the END of the shot. Moving something here makes it travel from its Start position.'}
      </p>

      <label className="field">
        <span>Stage</span>
        <select value={eff.stageId ?? ''} onChange={(e) => dispatch(setShotStage(shot.id, e.target.value))}>
          {!eff.stageId && <option value="">No stage</option>}
          {project.stages.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>

      {selectedStageObj && (
        <div className="panel">
          <strong>{selectedStageObj.name}</strong>
          <p className="muted small">Changes here apply to this shot only.</p>
          <label className="row gap">
            <input type="checkbox" checked={!!override?.hidden} onChange={(e) => dispatch(setStageOverride(shot.id, selectedStageObj.id, { hidden: e.target.checked }))} />
            <span>Hide in this shot</span>
          </label>
          {override && (
            <button className="btn small-btn" onClick={() => dispatch(setStageOverride(shot.id, selectedStageObj.id, null))}>
              Reset to stage
            </button>
          )}
        </div>
      )}

      <div className="field">
        <span>Characters</span>
        {eff.setup.actors.length === 0 && <p className="muted small">No one in this shot yet.</p>}
        <ul className="cast-list">
          {eff.setup.actors.map((a) => {
            const c = project.characters.find((x) => x.id === a.characterId);
            if (!c) return null;
            const id: RigId = `actor:${c.id}`;
            const key = keyOf(a.motion, editKey);
            return (
              <li key={c.id} className={selected === id ? 'on' : ''}>
                <button className="cast-name" onClick={() => onSelect(selected === id ? null : id)}>
                  {c.tint && <span className="tint-dot" style={{ background: c.tint }} />}
                  {c.name}
                  {a.motion.mode === 'moving' && <span className="badge">moves</span>}
                </button>
                <select aria-label={`${c.name} pose`} value={key.pose} onChange={(e) => dispatch(setActorKey(shot.id, c.id, editKey, { pose: e.target.value as (typeof POSES)[number] }))}>
                  {POSES.map((p) => (
                    <option key={p} value={p}>
                      {POSE_LABEL[p]}
                    </option>
                  ))}
                </select>
                {a.motion.mode === 'moving' && (
                  <button className="link-btn" onClick={() => dispatch(setActorStill(shot.id, c.id))}>
                    Stay still
                  </button>
                )}
                <button className="btn ghost icon small-icon" aria-label={`Remove ${c.name}`} onClick={() => dispatch(removeActor(shot.id, c.id))}>
                  ×
                </button>
              </li>
            );
          })}
        </ul>
        {available.length > 0 && (
          <div className="type-buttons">
            {available.map((c) => (
              <button
                key={c.id}
                className="chip tag"
                onClick={() => {
                  dispatch(addActor(shot.id, c.id, { position: [anchor[0] + 1, 0, anchor[2] + 0.5], yaw: 0 }));
                  onSelect(`actor:${c.id}`);
                }}
              >
                + {c.name}
              </button>
            ))}
          </div>
        )}
        {project.characters.length === 0 && <p className="muted small">Add characters in the Characters step.</p>}
      </div>

      <div className="field">
        <span>Props</span>
        <ul className="cast-list">
          {eff.setup.props.map((sp) => {
            const prop = project.props.find((x) => x.id === sp.propId);
            if (!prop) return null;
            const id: RigId = `prop:${sp.id}`;
            return (
              <li key={sp.id} className={selected === id ? 'on' : ''}>
                <button className="cast-name" onClick={() => onSelect(selected === id ? null : id)}>
                  {prop.name}
                  {sp.motion.mode === 'moving' && <span className="badge">moves</span>}
                </button>
                <button className="btn ghost icon small-icon" aria-label={`Remove ${prop.name}`} onClick={() => dispatch(removeShotProp(shot.id, sp.id))}>
                  ×
                </button>
              </li>
            );
          })}
        </ul>
        {project.props.length > 0 ? (
          <div className="type-buttons">
            {project.props.map((p) => (
              <button
                key={p.id}
                className="chip tag"
                onClick={() => {
                  const id = newId();
                  dispatch(addShotProp(shot.id, p.id, { position: [anchor[0] + 0.4, 0, anchor[2] + 0.6], yaw: 0 }, id));
                  onSelect(`prop:${id}`);
                }}
              >
                + {p.name}
              </button>
            ))}
          </div>
        ) : (
          <p className="muted small">Add props in the Props step.</p>
        )}
      </div>
    </div>
  );
}
