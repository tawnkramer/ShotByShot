import { useMemo, useState } from 'react';
import { useProjectStore } from '../../state/store';
import { newId, type Character } from '../../state/schema';
import { addCharacters, heightLabel, namesFromScript } from '../../characters/commands';
import { buildMannequin } from '../../three/mannequin';
import { useThumbnail } from '../../three/thumbnails';
import { CharacterEditor } from './CharacterEditor';

const SEX_LABEL = { female: 'Female', male: 'Male', other: 'Other' } as const;

export function CharactersStep() {
  const project = useProjectStore((s) => s.project)!;
  const dispatch = useProjectStore((s) => s.dispatch);
  const [editing, setEditing] = useState<string | null>(null);
  const fromScript = useMemo(() => namesFromScript(project), [project]);

  const current = project.characters.find((c) => c.id === editing);
  if (current) return <CharacterEditor character={current} onBack={() => setEditing(null)} />;

  const addNew = () => {
    const name = window.prompt('Character name', '');
    if (!name?.trim()) return;
    const id = newId();
    dispatch(addCharacters([name.trim()], [id]));
    setEditing(id);
  };

  return (
    <div className="page">
      {fromScript.length > 0 && (
        <section className="panel">
          <h2>From the script</h2>
          <p className="muted small">{fromScript.join(', ')}</p>
          <button className="btn primary" onClick={() => dispatch(addCharacters(fromScript))}>
            Add {fromScript.length === 1 ? fromScript[0] : `all ${fromScript.length}`}
          </button>
        </section>
      )}
      {project.characters.length === 0 && fromScript.length === 0 && (
        <div className="empty">
          <p>No characters yet.</p>
          <p className="muted small">Characters appear as simple mannequins with eyes and a nose, so you can see which way they face.</p>
        </div>
      )}
      <ul className="char-grid">
        {project.characters.map((c) => (
          <li key={c.id}>
            <CharacterCard character={c} onOpen={() => setEditing(c.id)} />
          </li>
        ))}
      </ul>
      <button className="btn" onClick={addNew}>
        + New character
      </button>
    </div>
  );
}

function CharacterCard({ character: c, onOpen }: { character: Character; onOpen: () => void }) {
  const key = `char:${c.heightCm}:${c.sex}:${c.build}:${c.tint ?? ''}`;
  const thumb = useThumbnail(key, () => buildMannequin(c), { width: 200, height: 260, azimuth: 30 });
  return (
    <button className="char-card" onClick={onOpen}>
      <span className="char-thumb">{thumb ? <img src={thumb} alt="" /> : null}</span>
      <span className="char-info">
        <span className="row gap">
          {c.tint && <span className="tint-dot" style={{ background: c.tint }} />}
          <strong className="grow">{c.name}</strong>
        </span>
        <span className="muted small">
          {SEX_LABEL[c.sex]} · {heightLabel(c.heightCm).split(' · ')[0]} · {c.build}
        </span>
        <span className="muted small">Voice: {c.voice.voiceId}</span>
      </span>
    </button>
  );
}
