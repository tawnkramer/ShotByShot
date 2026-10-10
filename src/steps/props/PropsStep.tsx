import { useMemo, useState } from 'react';
import { useProjectStore } from '../../state/store';
import { newId, type ObjectSource, type Prop } from '../../state/schema';
import { addProp, suggestProps } from '../../props/commands';
import { LIBRARY } from '../../three/library';
import { buildSource } from '../../three/assets';
import { applyGrey } from '../../three/materials';
import { useThumbnail } from '../../three/thumbnails';
import { AddSheet } from '../staging/AddSheet';
import { PropEditor } from './PropEditor';

export function PropsStep() {
  const project = useProjectStore((s) => s.project)!;
  const dispatch = useProjectStore((s) => s.dispatch);
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const suggestions = useMemo(() => suggestProps(project), [project]);

  const current = project.props.find((p) => p.id === editing);
  if (current) return <PropEditor prop={current} onBack={() => setEditing(null)} />;

  const add = (source: ObjectSource) => {
    const id = newId();
    dispatch(addProp(source, undefined, id));
    setAdding(false);
    setEditing(id);
  };

  return (
    <div className="page">
      {suggestions.length > 0 && (
        <section className="panel">
          <h2>Mentioned in the script</h2>
          <div className="suggestions">
            {suggestions.map((s) => (
              <button key={s.item} className="suggestion" title={s.example} onClick={() => dispatch(addProp({ kind: 'library', item: s.item }))}>
                <strong>+ {LIBRARY[s.item].label}</strong>
                <span className="muted small">{s.mentions > 1 ? `${s.mentions} mentions` : `“${s.example.slice(0, 48)}${s.example.length > 48 ? '…' : ''}”`}</span>
              </button>
            ))}
          </div>
          {suggestions.length > 1 && (
            <button
              className="btn"
              onClick={() => {
                for (const s of suggestions) dispatch(addProp({ kind: 'library', item: s.item }));
              }}
            >
              Add all {suggestions.length}
            </button>
          )}
        </section>
      )}

      {project.props.length === 0 && suggestions.length === 0 && (
        <div className="empty">
          <p>No props yet.</p>
          <p className="muted small">Props are the things characters handle: a glass, a phone, an envelope. Add them here to reuse them on any stage or shot.</p>
        </div>
      )}

      <ul className="char-grid">
        {project.props.map((p) => (
          <li key={p.id}>
            <PropCard prop={p} onOpen={() => setEditing(p.id)} />
          </li>
        ))}
      </ul>

      <div className="row gap">
        <button className="btn primary grow" onClick={() => setAdding(true)}>
          + Add prop
        </button>
        <button className="btn grow" disabled title="Arrives with the assistant">
          Model with AI
        </button>
      </div>
      <p className="muted small">Soon you'll be able to describe a prop in the chat ("a vintage rotary phone") and the assistant will build it from simple shapes.</p>

      {adding && <AddSheet title="Add prop" propsOnly onAdd={add} onClose={() => setAdding(false)} />}
    </div>
  );
}

export function propThumbKey(p: Prop): string {
  return `prop:${JSON.stringify(p.source)}:${p.grey ?? ''}`;
}

function PropCard({ prop: p, onOpen }: { prop: Prop; onOpen: () => void }) {
  const thumb = useThumbnail(propThumbKey(p), async () => {
    const o = await buildSource(p.source);
    applyGrey(o, p.grey);
    return o;
  }, { width: 220, height: 220, azimuth: 35, elevation: 25 });
  return (
    <button className="char-card" onClick={onOpen}>
      <span className="char-thumb square">{thumb ? <img src={thumb} alt="" /> : null}</span>
      <span className="char-info">
        <strong>{p.name}</strong>
        <span className="muted small">{p.source.kind === 'asset' ? 'Imported model' : p.source.kind === 'composite' ? 'Custom' : 'Library'}{p.defaultScale !== 1 ? ` · ×${p.defaultScale}` : ''}</span>
      </span>
    </button>
  );
}
