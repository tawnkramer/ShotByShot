import { memo } from 'react';
import type { ScriptLine } from '../../state/schema';
import { LOW_CONFIDENCE } from '../../story/classify';
import { useLongPress } from '../../shell/useLongPress';
import { LINE_TYPE_INFO } from './lineTypes';

interface Props {
  line: ScriptLine;
  selecting: boolean;
  selected?: boolean;
  onChip: () => void;
  onTap: () => void;
  onLongPress: () => void;
}

export const ScriptLineRow = memo(function ScriptLineRow({ line, selecting, selected, onChip, onTap, onLongPress }: Props) {
  const press = useLongPress(onLongPress, onTap);
  const unsure = (line.confidence ?? 1) < LOW_CONFIDENCE;
  return (
    <div className={`line line-${line.type} ${unsure ? 'unsure' : ''} ${selected ? 'selected' : ''}`} {...press}>
      {selecting ? (
        <span className={`check ${selected ? 'on' : ''}`} aria-hidden />
      ) : (
        <button
          className={`chip type-${line.type}`}
          aria-label={`${LINE_TYPE_INFO[line.type].label}. Tap to change.`}
          onPointerDown={(e) => e.stopPropagation()}
          onPointerUp={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.stopPropagation()}
          onClick={onChip}
        >
          {LINE_TYPE_INFO[line.type].short}
        </button>
      )}
      <span className="line-text">{line.text}</span>
    </div>
  );
});
