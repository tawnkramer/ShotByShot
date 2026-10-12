import { useState } from 'react';
import { useProjectStore } from '../../state/store';
import { importScript } from '../../story/commands';
import { SAMPLE_SCRIPTS } from '../../story/sample';
import { pickFile } from '../../shell/download';

const MAX_BYTES = 5 * 1024 * 1024;

export function ImportPanel({ onDone }: { onDone?: () => void }) {
  const dispatch = useProjectStore((s) => s.dispatch);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);

  const use = (t: string) => {
    if (!t.trim()) return;
    dispatch(importScript(t));
    onDone?.();
  };

  const fromFile = async () => {
    setError(null);
    const file = await pickFile('.txt,.fountain,.text,text/plain');
    if (!file) return;
    if (file.size > MAX_BYTES) return setError('That file is too large for a script (over 5 MB).');
    const content = await file.text();
    if (content.includes('\u0000')) return setError('That doesn\'t look like a text file. Export the script as plain text first.');
    use(content);
  };

  return (
    <div className="page">
      <section className="panel">
        <h2>Import a script</h2>
        <p className="muted small">
          Plain text works best, laid out like a screenplay: scene headings (INT. / EXT.), character names in capitals
          above their lines, and action in between. <code className="inline">NAME: line</code> style also works.
        </p>
        <button className="btn primary" onClick={fromFile}>
          Choose text file…
        </button>
        {error && <p className="error small">{error}</p>}
      </section>
      <section className="panel">
        <h2>Or paste it</h2>
        <textarea
          className="script-paste"
          placeholder={'INT. BAR - NIGHT\n\nMAYA\nWe\'re closed.'}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <button className="btn" disabled={!text.trim()} onClick={() => use(text)}>
          Use this text
        </button>
      </section>
      <section className="panel">
        <h2>Or try a sample</h2>
        <div className="row sample-row">
          {SAMPLE_SCRIPTS.map((s) => (
            <button key={s.title} className="btn" onClick={() => use(s.text)}>
              {s.title}
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
