import { Overlay } from '../../shell/Overlay';
import { useState } from 'react';
import { LINE_TYPES, type ScriptLine } from '../../state/schema';
import { useProjectStore } from '../../state/store';
import { deleteLines, editLineText, setLineTypes, toggleBreak } from '../../story/commands';
import { LINE_TYPE_INFO } from './lineTypes';

interface Props {
  line: ScriptLine;
  startsShot: boolean;
  canCut: boolean;
  onClose: () => void;
}

export function LineSheet({ line, startsShot, canCut, onClose }: Props) {
  const dispatch = useProjectStore((s) => s.dispatch);
  const [text, setText] = useState(line.text);

  const close = () => {
    const t = text.trim();
    if (t && t !== line.text) dispatch(editLineText(line.id, t));
    onClose();
  };

  return (
    <Overlay>
      <div className="scrim" onClick={close} />
      <div className="sheet" role="dialog" aria-label="Edit line">
        <div className="sheet-head">
          <strong>Line</strong>
          <button className="btn ghost" onClick={close}>
            Done
          </button>
        </div>
        <div className="type-buttons">
          {LINE_TYPES.map((t) => (
            <button
              key={t}
              className={`chip type-${t} ${line.type === t ? 'current' : ''}`}
              aria-pressed={line.type === t}
              onClick={() => dispatch(setLineTypes([line.id], t))}
            >
              {LINE_TYPE_INFO[t].label}
            </button>
          ))}
        </div>
        <textarea className="line-edit" value={text} onChange={(e) => setText(e.target.value)} />
        <div className="row gap">
          {canCut && (
            <button className="btn grow" onClick={() => dispatch(toggleBreak(line.id))}>
              {startsShot ? 'Join with shot above' : 'Start a new shot here'}
            </button>
          )}
          <button
            className="btn danger"
            onClick={() => {
              dispatch(deleteLines([line.id]));
              onClose();
            }}
          >
            Delete line
          </button>
        </div>
      </div>
    </Overlay>
  );
}
