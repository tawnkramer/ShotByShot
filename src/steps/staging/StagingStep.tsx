import { useCallback, useEffect, useRef, useState } from 'react';
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

import { ConceptImageEditor } from '../../images/ConceptImageEditor';
import { stageImagePrompt } from '../../images/generate';
import { useBlobUrl } from '../../images/useBlobUrl';

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
  // A brief notice when snapping is toggled; the key restarts the fade on every tap.
  const [flash, setFlash] = useState<{ text: string; key: number } | null>(null);
  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 1300);
    return () => clearTimeout(t);
  }, [flash]);
  const locations = useUnstagedLocations(project);

  const stage = project.stages.find((s) => s.id === stageId) ?? project.stages[0];
  useEffect(() => {
    if (stage && stage.id !== stageId) setStage(stage.id);
  }, [stage, stageId, setStage]);

  const capture = useRef<(() => Promise<Blob>) | null>(null);
  const onCaptureReady = useCallback((fn: (() => Promise<Blob>) | null) => { capture.current = fn; }, []);
  const [reference, setReference] = useState<Blob>();
  const [capturing, setCapturing] = useState(false);
  const [captureError, setCaptureError] = useState('');
  const [showImage, setShowImage] = useState(true);
  const artwork = useBlobUrl(stage?.image?.blob);
  useEffect(() => { setShowImage(true); setReference(undefined); setCaptureError(''); }, [stage?.id]);
  useEffect(() => { setShowImage(true); }, [stage?.image?.blob]);
  const showingImage = showImage && Boolean(artwork);
  const openImage = async () => {
    if (capturing || !capture.current || !stage) return;
    const id = stage.id;
    setCapturing(true); setCaptureError('');
    try {
      const blob = await capture.current();
      if (useStagingUI.getState().stageId === id) setReference(blob);
    } catch (e) { setCaptureError(e instanceof Error ? e.message : String(e)); }
    finally { setCapturing(false); }
  };

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
        <div className={`stage-render-layer${showingImage ? ' covered' : ''}`}>
          <StageViewport key={stage.id} stage={stage} onTransformEnd={onTransformEnd} onCaptureReady={onCaptureReady} />
        </div>
        {showingImage && <img className="character-artwork" src={artwork} alt={`Concept artwork for ${stage.name}`} />}
        {artwork && <button className="btn character-view-toggle" onClick={() => setShowImage(!showingImage)}>{showingImage ? '3D stage' : 'Stage image'}</button>}
        {flash && (
          <div key={flash.key} className="viewport-flash" role="status">
            {flash.text}
          </div>
        )}
        <div className="viewport-toolbar" hidden={showingImage}>
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
          <button
            className={`btn icon snap ${snap ? 'on' : ''}`}
            aria-pressed={snap}
            aria-label={snap ? 'Snap on' : 'Snap off'}
            onClick={() => {
              toggleSnap();
              setFlash({ text: snap ? 'Snap off' : 'Snap on', key: Date.now() });
            }}
          >
            #
          </button>
        </div>
      </div>
      <div className="split-panel">
        <div className="stage-image-action"><button className="btn" disabled={capturing} onClick={() => void openImage()}>{capturing ? 'Capturing preview…' : stage.image ? 'View / generate stage image' : 'Generate stage image'}</button>
        <p className="small muted">Uses the current 3D view as guidance. Frame your stage before generating.</p>
        {captureError && <p role="alert" className="error small">{captureError}</p>}</div>
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
          <ObjectList stage={stage} onPick={(id) => { setShowImage(false); select(id); }} onAdd={() => setSheet('add')} />
        )}
      </div>
      {reference && <ConceptImageEditor key={stage.id} subject={stage} kind="stage" defaultPrompt={stageImagePrompt(stage)} reference={reference} onClose={() => setReference(undefined)} />}
      {sheet === 'add'  && <AddSheet onAdd={add} projectProps={project.props} onAddProp={addProp} onClose={() => setSheet(null)} />}
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
