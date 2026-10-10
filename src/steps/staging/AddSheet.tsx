import { useState } from 'react';
import { PRIMITIVE_SHAPES, PROP_ITEMS, SET_ITEMS, type ObjectSource, type Prop } from '../../state/schema';
import { LIBRARY, PRIMITIVES } from '../../three/library';
import { importModelFile } from '../../three/assets';
import { pickFile } from '../../shell/download';

interface Props {
  title?: string;
  onAdd: (source: ObjectSource) => void;
  onClose: () => void;
  /** The project's own props, listed first when given. */
  projectProps?: Prop[];
  onAddProp?: (prop: Prop) => void;
  /** Hide set pieces (for the Props step). */
  propsOnly?: boolean;
}

export function AddSheet({ title = 'Add to stage', onAdd, onClose, projectProps, onAddProp, propsOnly }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const importModel = async () => {
    setError(null);
    const file = await pickFile('.obj,.gltf,.glb,model/gltf-binary,model/gltf+json');
    if (!file) return;
    setBusy(true);
    try {
      const { blob, format } = await importModelFile(file);
      onAdd({ kind: 'asset', blob, format, fileName: file.name });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

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
        {projectProps && projectProps.length > 0 && onAddProp && (
          <div className="field">
            <span>Your props</span>
            <div className="tile-grid">
              {projectProps.map((p) => (
                <button key={p.id} className="tile" onClick={() => onAddProp(p)}>
                  {p.name}
                </button>
              ))}
            </div>
          </div>
        )}
        {!propsOnly && (
          <div className="field">
            <span>Set pieces</span>
            <div className="tile-grid">
              {SET_ITEMS.map((item) => (
                <button key={item} className="tile" onClick={() => onAdd({ kind: 'library', item })}>
                  {LIBRARY[item].label}
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="field">
          <span>{propsOnly ? 'Library' : 'Props'}</span>
          <div className="tile-grid">
            {PROP_ITEMS.map((item) => (
              <button key={item} className="tile" onClick={() => onAdd({ kind: 'library', item })}>
                {LIBRARY[item].label}
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <span>Shapes</span>
          <div className="tile-grid">
            {PRIMITIVE_SHAPES.filter((s) => !propsOnly || s !== 'plane').map((shape) => (
              <button key={shape} className="tile" onClick={() => onAdd({ kind: 'primitive', shape })}>
                {PRIMITIVES[shape].label}
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <span>Your own model</span>
          <button className="btn" disabled={busy} onClick={importModel}>
            {busy ? 'Importing…' : 'Import OBJ, glTF, or GLB…'}
          </button>
          {error && <p className="error small">{error}</p>}
          <p className="muted small">Models are turned grey, set on the floor, and scaled to meters if they look like centimeters.</p>
        </div>
      </div>
    </>
  );
}
