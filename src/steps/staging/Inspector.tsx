import type { Stage, StageObject } from '../../state/schema';
import { useProjectStore } from '../../state/store';
import { eulerDegrees, quatFromDegrees, round, updateObject, type ObjectPatch } from '../../staging/commands';
import { isParamSource, paramDefFor, resolveParams } from '../../three/library';
import { NumberField, Slider } from './fields';

export function Inspector({ stage, object }: { stage: Stage; object: StageObject }) {
  const dispatch = useProjectStore((s) => s.dispatch);
  const update = (patch: ObjectPatch, label: string, mergeKey?: string) => dispatch(updateObject(stage.id, object.id, patch, label, mergeKey));
  const { position, scale } = object.transform;
  const rot = eulerDegrees(object.transform);
  const def = paramDefFor(object.source);
  const params = def && isParamSource(object.source) ? resolveParams(def, object.source.params) : {};
  const uniform = scale[0] === scale[1] && scale[1] === scale[2];

  const setPos = (i: number, v: number) => {
    const p = [...position] as typeof position;
    p[i] = v;
    update({ transform: { position: p } }, 'Move object');
  };
  const setRot = (i: number, v: number) => {
    const r = [...rot] as typeof rot;
    r[i] = v;
    update({ transform: { rotation: quatFromDegrees(r) } }, 'Rotate object');
  };
  const setScale = (i: number | 'all', v: number) => {
    const s = i === 'all' ? ([v, v, v] as typeof scale) : (scale.map((x, j) => (j === i ? v : x)) as typeof scale);
    update({ transform: { scale: s } }, 'Scale object');
  };

  return (
    <div className="inspector">
      <label className="field">
        <span>Name</span>
        <input
          key={object.id}
          defaultValue={object.name}
          onBlur={(e) => {
            const name = e.target.value.trim();
            if (name && name !== object.name) update({ name }, 'Rename object');
          }}
        />
      </label>

      <div className="field">
        <span>Position (m)</span>
        <div className="num-row">
          {(['X', 'Y', 'Z'] as const).map((axis, i) => (
            <NumberField key={axis} label={axis} value={position[i]} onCommit={(v) => setPos(i, v)} />
          ))}
        </div>
      </div>

      <div className="field">
        <span>Rotation (°)</span>
        <div className="num-row">
          {(['X', 'Y', 'Z'] as const).map((axis, i) => (
            <NumberField key={axis} label={axis} value={rot[i]} step={15} digits={1} onCommit={(v) => setRot(i, v)} />
          ))}
        </div>
      </div>

      <div className="field">
        <span>Scale</span>
        <div className="num-row">
          {uniform ? (
            <NumberField label="All" value={scale[0]} min={0.01} onCommit={(v) => setScale('all', v)} />
          ) : (
            (['X', 'Y', 'Z'] as const).map((axis, i) => <NumberField key={axis} label={axis} value={scale[i]} min={0.01} onCommit={(v) => setScale(i, v)} />)
          )}
          {!uniform && (
            <button className="btn small-btn" onClick={() => setScale('all', round((scale[0] + scale[1] + scale[2]) / 3, 2))}>
              Even
            </button>
          )}
        </div>
      </div>

      {def && def.params.length > 0 && (
        <div className="field">
          <span>Size</span>
          {def.params.map((p) => (
            <Slider
              key={p.key}
              label={p.label}
              value={params[p.key]}
              min={p.min}
              max={p.max}
              step={p.step}
              format={(v) => `${round(v, 2)} m`}
              onChange={(v) => update({ params: { [p.key]: v } }, `Change ${p.label.toLowerCase()}`, `param:${object.id}:${p.key}`)}
            />
          ))}
        </div>
      )}

      <div className="field">
        <span className="row">
          <span className="grow">Shade</span>
          {object.grey !== undefined && (
            <button className="link-btn" onClick={() => update({ grey: undefined }, 'Reset shade')}>
              Reset
            </button>
          )}
        </span>
        <input
          type="range"
          className="shade-range"
          min={0.05}
          max={0.95}
          step={0.05}
          value={object.grey ?? 0.7}
          onChange={(e) => update({ grey: Number(e.target.value) }, 'Change shade', `grey:${object.id}`)}
        />
      </div>
    </div>
  );
}
