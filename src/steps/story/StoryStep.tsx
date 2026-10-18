import { useMemo, useState } from 'react';
import { useProjectStore } from '../../state/store';
import { LINE_TYPES, mediumOf, type BreakdownMode, type LineType } from '../../state/schema';
import { applyBreakdown, deleteLines, setLineTypes, toggleBreak } from '../../story/commands';
import { LOW_CONFIDENCE } from '../../story/classify';
import { ImportPanel } from './ImportPanel';
import { LineSheet } from './LineSheet';
import { ScriptLineRow } from './ScriptLineRow';
import { LINE_TYPE_INFO, nextType } from './lineTypes';
import { useChatUI } from '../../shell/chatUI';

const MODE_LABELS: Record<BreakdownMode, string> = { line: 'Per line', pair: 'Per 2 lines', mixed: 'Mixed', panels: 'Panels' };
/** Comics pack dialogue into panels instead of cutting on each speaker. */
const MODES = { film: ['line', 'pair', 'mixed'], comic: ['line', 'pair', 'panels'] } as const satisfies Record<string, readonly BreakdownMode[]>;

export function StoryStep() {
  const project = useProjectStore((s) => s.project)!;
  const dispatch = useProjectStore((s) => s.dispatch);
  const [replacing, setReplacing] = useState(false);
  const [sheetLine, setSheetLine] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string> | null>(null);

  const { script, shots } = project;

  // Where each shot starts, and which lines belong to a shot at all.
  const layout = useMemo(() => {
    const shotStart = new Map<string, { number: string; index: number }>();
    const shotOf = new Map<string, number>();
    shots.forEach((s, i) => {
      shotStart.set(s.lineIds[0], { number: s.number, index: i });
      for (const id of s.lineIds) shotOf.set(id, i);
    });
    return { shotStart, shotOf };
  }, [shots]);

  const reviewCount = useMemo(() => script.filter((l) => (l.confidence ?? 1) < LOW_CONFIDENCE).length, [script]);

  if (!script.length || replacing) {
    return (
      <>
        {replacing && (
          <div className="page-top">
            <button className="btn ghost" onClick={() => setReplacing(false)}>
              ‹ Keep current script
            </button>
            <p className="muted small">Importing replaces the current script and its shots. You can undo it.</p>
          </div>
        )}
        <ImportPanel
          onDone={() => {
            setReplacing(false);
            document.querySelector('.body')?.scrollTo(0, 0);
          }}
        />
      </>
    );
  }

  const toggleSelected = (id: string) =>
    setSelected((sel) => {
      const next = new Set(sel);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const bulk = (type: LineType) => {
    if (selected?.size) dispatch(setLineTypes([...selected], type));
    setSelected(null);
  };

  const sheet = sheetLine ? script.find((l) => l.id === sheetLine) : undefined;

  return (
    <div className="story">
      <div className="story-toolbar">
        {selected ? (
          <>
            <div className="row gap">
              <strong className="grow">{selected.size} selected</strong>
              <button className="btn ghost" onClick={() => setSelected(null)}>
                Cancel
              </button>
            </div>
            <div className="type-buttons">
              {LINE_TYPES.map((t) => (
                <button key={t} className={`chip type-${t}`} disabled={!selected.size} onClick={() => bulk(t)}>
                  {LINE_TYPE_INFO[t].short}
                </button>
              ))}
              <button
                className="chip danger"
                disabled={!selected.size}
                onClick={() => {
                  dispatch(deleteLines([...selected]));
                  setSelected(null);
                }}
              >
                Delete
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="segmented" role="radiogroup" aria-label="Shot breakdown">
              {MODES[mediumOf(project)].map((m) => (
                <button
                  key={m}
                  role="radio"
                  aria-checked={project.breakdownMode === m}
                  className={project.breakdownMode === m ? 'on' : ''}
                  onClick={() => dispatch(applyBreakdown(m))}
                >
                  {MODE_LABELS[m]}
                </button>
              ))}
            </div>
            <div className="row gap">
              <span className="muted small grow">
                {script.length} lines · {shots.length} {mediumOf(project) === 'comic' ? 'panels' : 'shots'}
                {reviewCount > 0 && <span className="review-count"> · {reviewCount} to check</span>}
              </span>
              <button className="btn ghost small-btn" onClick={() => useChatUI.getState().open('Check my line labels and fix any mistakes.')}>
                ✨ Check
              </button>
              <button className="btn ghost small-btn" onClick={() => setSelected(new Set())}>
                Select
              </button>
              <button className="btn ghost small-btn" onClick={() => setReplacing(true)}>
                Replace
              </button>
            </div>
          </>
        )}
      </div>

      <ol className="script" aria-label="Script">
        {script.map((line, i) => {
          const start = layout.shotStart.get(line.id);
          const shotIndex = layout.shotOf.get(line.id);
          const prevShot = i > 0 ? layout.shotOf.get(script[i - 1].id) : undefined;
          // A break can be toggled between two lines that are both in shots.
          const canToggle = shotIndex !== undefined && prevShot !== undefined && i > 0;
          return (
            <li key={line.id} className={shotIndex === undefined ? 'unshot' : `shot-${shotIndex % 2 ? 'odd' : 'even'}`}>
              {canToggle && (
                <button
                  className={`cut ${start ? 'on' : ''}`}
                  aria-label={start ? `Remove the cut before shot ${start.number}` : 'Add a cut here'}
                  onClick={() => dispatch(toggleBreak(line.id))}
                >
                  {start && <span className="cut-label">Shot {start.number}</span>}
                </button>
              )}
              {start && !canToggle && <div className="cut on static"><span className="cut-label">Shot {start.number}</span></div>}
              <ScriptLineRow
                line={line}
                selected={selected?.has(line.id)}
                selecting={!!selected}
                onChip={() => dispatch(setLineTypes([line.id], nextType(line.type)))}
                onTap={() => selected && toggleSelected(line.id)}
                onLongPress={() => (selected ? toggleSelected(line.id) : setSheetLine(line.id))}
              />
            </li>
          );
        })}
      </ol>

      {sheet && <LineSheet line={sheet} startsShot={layout.shotStart.has(sheet.id)} canCut={(layout.shotOf.get(sheet.id) ?? -1) >= 0 && sheet.id !== shots[0]?.lineIds[0]} onClose={() => setSheetLine(null)} />}
    </div>
  );
}
