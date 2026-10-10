import { useEffect, useState } from 'react';
import { useProjectStore } from '../../state/store';
import { newId, type ObjectSource, type Prop, type Stage, type Transform } from '../../state/schema';
import { freeSpot } from '../../staging/placement';
import { addObject, duplicateObject, IDENTITY, placeProp, removeObject, updateObject } from '../../staging/commands';
import { useStagingUI, type GizmoMode } from '../../staging/uiStore';
import { useLongPress } from '../../shell/useLongPress';
import { StageViewport } from './StageViewport';
import { Inspector } from './Inspector';
import { AddSheet } from './AddSheet';
import { NewStageSheet, StageActionsSheet, useUnstagedLocations } from './StageSheets';
import { createStagesForScenes } from '../../staging/commands';

const MODES: { mode: GizmoMode; label: string }[] = [
  { mode: 'translate', label: 'Move' },
  { mode: 'rotate', label: 'Rotate' },
  { mode: 'scale', label: 'Scale' },
];

export function StagingStep() {
  const project = useProjectStore((s) => s.project)!;
  const dispatch = useProjectStore((s) => s.dispatch);
  const { stageId, selectedId, mode, snap, setStage, select, setMode, toggleSnap } = useStagingUI();
  const [sheet, setSheet] = useState<'add' | 'new' | 'actions' | null>(null);
  const locations = useUnstagedLocations(project);

  const stage = project.stages.find((s) => s.id === stageId) ?? project.stages[0];
  useEffect(() => {
    if (stage && stage.id !== stageId) setStage(stage.id);
  }, [stage, stageId, setStage]);

  const selected = stage?.objects.find((o) => o.id === selectedId);

  if (!stage) {
    return (
      <div className="page">
        <section className="panel">
          <h2>Build your first stage</h2>
          <p className="muted small">
            A stage is a grey-box set: walls, furniture, and props blocked out in 3D. Shots in the same location share a
            stage.
          </p>
          {locations.length > 0 && (
            <button
              className="btn primary"
              onClick={() => {
                const { command, ids } = createStagesForScenes(project);
                dispatch(command);
                setStage(ids[0] ?? null);
              }}
            >
              Create {locations.length === 1 ? `"${locations[0].name}"` : `${locations.length} stages`} from the script
            </button>
          )}
          <button className="btn" onClick={() => setSheet('new')}>
            New stage…
          </button>
        </section>
        {sheet === 'new' && <NewStageSheet onCreated={(id) => setStage(id)} onClose={() => setSheet(null)} />}
      </div>
    );
  }

  const add = (source: ObjectSource) => {
    const id = newId();
    const position = freeSpot(stage, source);
    dispatch(addObject(stage.id, source, { ...IDENTITY, position }, id));
    select(id);
    setSheet(null);
  };

  const addProp = (prop: Prop) => {
    const id = newId();
    dispatch(placeProp(stage.id, prop, freeSpot(stage, prop.source), id));
    select(id);
    setSheet(null);
  };

  const onTransformEnd = (objectId: string, transform: Transform) => dispatch(updateObject(stage.id, objectId, { transform }, 'Move object'));

  return (
    <div className="split">
      <StageChips stages={project.stages} current={stage.id} onPick={setStage} onLongPress={() => setSheet('actions')} onNew={() => setSheet('new')} />
      <div className="viewport">
        <StageViewport stage={stage} onTransformEnd={onTransformEnd} />
        <div className="viewport-toolbar">
          <button className={`btn primary ${selected ? 'icon' : ''}`} aria-label="Add" onClick={() => setSheet('add')}>
            {selected ? '+' : '+ Add'}
          </button>
          {selected && (
            <>
              <div className="segmented compact">
                {MODES.map((m) => (
                  <button key={m.mode} className={mode === m.mode ? 'on' : ''} aria-pressed={mode === m.mode} onClick={() => setMode(m.mode)}>
                    {m.label}
                  </button>
                ))}
              </div>
              <button
                className="btn icon"
                aria-label="Duplicate"
                title="Duplicate"
                onClick={() => {
                  const id = newId();
                  dispatch(duplicateObject(stage.id, selected.id, id));
                  select(id);
                }}
              >
                ⧉
              </button>
              <button
                className="btn icon danger"
                aria-label="Delete"
                title="Delete"
                onClick={() => {
                  dispatch(removeObject(stage.id, selected.id));
                  select(null);
                }}
              >
                🗑
              </button>
            </>
          )}
          <button className={`btn icon snap ${snap ? 'on' : ''}`} aria-pressed={snap} aria-label="Snap" title="Snap to grid" onClick={toggleSnap}>
            #
          </button>
        </div>
      </div>
      <div className="split-panel">
        {selected ? (
          <>
            <div className="row gap panel-head">
              <button className="btn ghost small-btn" onClick={() => select(null)}>
                ‹ All objects
              </button>
            </div>
            <Inspector stage={stage} object={selected} />
          </>
        ) : (
          <ObjectList stage={stage} onPick={select} onAdd={() => setSheet('add')} />
        )}
      </div>
      {sheet === 'add' && <AddSheet onAdd={add} projectProps={project.props} onAddProp={addProp} onClose={() => setSheet(null)} />}
      {sheet === 'new' && <NewStageSheet onCreated={(id) => { setStage(id); setSheet(null); }} onClose={() => setSheet(null)} />}
      {sheet === 'actions' && <StageActionsSheet stage={stage} onSelect={setStage} onClose={() => setSheet(null)} />}
    </div>
  );
}

function StageChips({ stages, current, onPick, onLongPress, onNew }: { stages: Stage[]; current: string; onPick: (id: string) => void; onLongPress: () => void; onNew: () => void }) {
  return (
    <div className="stage-chips" role="tablist" aria-label="Stages">
      {stages.map((s) => (
        <StageChip key={s.id} stage={s} active={s.id === current} onPick={() => onPick(s.id)} onLongPress={() => { onPick(s.id); onLongPress(); }} />
      ))}
      <button className="stage-chip add" aria-label="New stage" onClick={onNew}>
        +
      </button>
    </div>
  );
}

function StageChip({ stage, active, onPick, onLongPress }: { stage: Stage; active: boolean; onPick: () => void; onLongPress: () => void }) {
  const press = useLongPress(onLongPress, () => (active ? onLongPress() : onPick()));
  return (
    <button role="tab" aria-selected={active} className={`stage-chip ${active ? 'on' : ''}`} {...press}>
      {stage.name}
      {active && <span className="chip-caret">⌄</span>}
    </button>
  );
}

function ObjectList({ stage, onPick, onAdd }: { stage: Stage; onPick: (id: string) => void; onAdd: () => void }) {
  if (!stage.objects.length) {
    return (
      <div className="empty">
        <p>This stage is empty.</p>
        <p className="muted small">Add a room, furniture, or your own models. Tap an object to move, rotate, or scale it.</p>
        <button className="btn primary" onClick={onAdd}>
          + Add
        </button>
      </div>
    );
  }
  return (
    <ul className="object-list">
      {stage.objects.map((o) => (
        <li key={o.id}>
          <button onClick={() => onPick(o.id)}>
            <span className="grow">{o.name}</span>
            <span className="muted small">{o.transform.position.map((v) => v.toFixed(1)).join(', ')}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
