import { useMemo } from 'react';
import type { Project, Stage } from '../../state/schema';
import { useProjectStore } from '../../state/store';
import { createStage, createStagesForScenes, deleteStage, duplicateStage, renameStage, scenesByLocation } from '../../staging/commands';
import { newId } from '../../state/schema';

function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="sheet" role="dialog" aria-label={title}>
        <div className="sheet-head">
          <strong>{title}</strong>
          <button className="btn ghost" onClick={onClose}>
            Close
          </button>
        </div>
        {children}
      </div>
    </>
  );
}

/** Locations from the script's scene headings that have no stage yet. */
export function useUnstagedLocations(project: Project) {
  return useMemo(() => {
    const used = new Set(project.stages.flatMap((s) => s.sceneLineIds));
    return [...scenesByLocation(project.script)]
      .map(([name, ids]) => ({ name, ids: ids.filter((id) => !used.has(id)) }))
      .filter((l) => l.ids.length);
  }, [project.script, project.stages]);
}

export function NewStageSheet({ onCreated, onClose }: { onCreated: (id: string) => void; onClose: () => void }) {
  const project = useProjectStore((s) => s.project)!;
  const dispatch = useProjectStore((s) => s.dispatch);
  const locations = useUnstagedLocations(project);

  const make = (name: string, ids: string[]) => {
    const id = newId();
    dispatch(createStage(name, ids, id));
    onCreated(id);
  };

  return (
    <Sheet title="New stage" onClose={onClose}>
      {locations.length > 0 && (
        <div className="field">
          <span>From the script</span>
          {locations.length > 1 && (
            <button
              className="btn primary"
              onClick={() => {
                const { command, ids } = createStagesForScenes(project);
                dispatch(command);
                if (ids[0]) onCreated(ids[0]);
              }}
            >
              Create all {locations.length} locations
            </button>
          )}
          <div className="tile-grid">
            {locations.map((l) => (
              <button key={l.name} className="tile" onClick={() => make(l.name, l.ids)}>
                {l.name}
                <span className="muted small">{l.ids.length > 1 ? `${l.ids.length} scenes` : '1 scene'}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      <button
        className="btn"
        onClick={() => {
          const name = window.prompt('Stage name', `Stage ${project.stages.length + 1}`);
          if (name?.trim()) make(name.trim(), []);
        }}
      >
        Blank stage…
      </button>
    </Sheet>
  );
}

export function StageActionsSheet({ stage, onSelect, onClose }: { stage: Stage; onSelect: (id: string | null) => void; onClose: () => void }) {
  const project = useProjectStore((s) => s.project)!;
  const dispatch = useProjectStore((s) => s.dispatch);
  const scenes = project.script.filter((l) => stage.sceneLineIds.includes(l.id));
  const shotsUsing = project.shots.filter((s) => s.stageId === stage.id).length;

  return (
    <Sheet title={stage.name} onClose={onClose}>
      <label className="field">
        <span>Name</span>
        <input
          defaultValue={stage.name}
          onBlur={(e) => {
            const name = e.target.value.trim();
            if (name && name !== stage.name) dispatch(renameStage(stage.id, name));
          }}
        />
      </label>
      <div className="field">
        <span>Scenes</span>
        {scenes.length ? (
          <ul className="plain small">
            {scenes.map((l) => (
              <li key={l.id}>{l.text}</li>
            ))}
          </ul>
        ) : (
          <p className="muted small">Not linked to a scene heading.</p>
        )}
      </div>
      <div className="row gap">
        <button
          className="btn grow"
          onClick={() => {
            const id = newId();
            dispatch(duplicateStage(stage.id, id));
            onSelect(id);
            onClose();
          }}
        >
          Duplicate
        </button>
        <button
          className="btn danger grow"
          onClick={() => {
            const warn = shotsUsing ? ` ${shotsUsing} shots use it.` : '';
            if (!window.confirm(`Delete stage "${stage.name}"?${warn} You can undo this.`)) return;
            dispatch(deleteStage(stage.id));
            onSelect(null);
            onClose();
          }}
        >
          Delete
        </button>
      </div>
    </Sheet>
  );
}
