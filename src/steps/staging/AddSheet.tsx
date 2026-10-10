import { useState } from 'react';
import { LIBRARY_ITEMS, PRIMITIVE_SHAPES, type ObjectSource } from '../../state/schema';
import { LIBRARY, PRIMITIVES } from '../../three/library';
import { importModelFile } from '../../three/assets';
import { pickFile } from '../../shell/download';

interface Props {
  onAdd: (source: ObjectSource) => void;
  onClose: () => void;
}

export function AddSheet({ onAdd, onClose }: Props) {
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
      <div className="sheet" role="dialog" aria-label="Add to stage">
        <div className="sheet-head">
          <strong>Add to stage</strong>
          <button className="btn ghost" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="field">
          <span>Set pieces</span>
          <div className="tile-grid">
            {LIBRARY_ITEMS.map((item) => (
              <button key={item} className="tile" onClick={() => onAdd({ kind: 'library', item })}>
                {LIBRARY[item].label}
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <span>Shapes</span>
          <div className="tile-grid">
            {PRIMITIVE_SHAPES.map((shape) => (
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
