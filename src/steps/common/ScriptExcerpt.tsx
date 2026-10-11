import type { ScriptLine } from '../../state/schema';

const isParenthetical = (l: ScriptLine) => l.type === 'dialogue' && /^\(.*\)$/.test(l.text.trim());

/** A shot's script lines laid out like a screenplay page. Spans so it can sit inside a button. */
export function ScriptExcerpt({ lines }: { lines: ScriptLine[] }) {
  return (
    <span className="script-excerpt">
      {lines.map((l) => (
        <span key={l.id} className={`sx sx-${isParenthetical(l) ? 'paren' : l.type}`}>
          {l.text}
        </span>
      ))}
    </span>
  );
}
