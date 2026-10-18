import { useEffect, useState } from 'react';
import { pickFile } from '../shell/download';
import { addUserFont, listUserFonts, registerUserFonts, removeUserFont, type UserFont } from './fonts';

/** Settings section for lettering fonts the user owns, like Wild Words. */
export function LetteringFontsSettings() {
  const [fonts, setFonts] = useState<UserFont[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string }>();
  const refresh = () => listUserFonts().then((list) => { setFonts(list); void registerUserFonts().catch(() => {}); }).catch(() => setFonts([]));
  useEffect(() => { void refresh(); }, []);

  const add = async () => {
    const file = await pickFile('.ttf,.otf,.woff,.woff2,font/ttf,font/otf,font/woff,font/woff2');
    if (!file) return;
    setBusy(true); setMessage(undefined);
    try {
      const font = await addUserFont(file);
      setMessage({ ok: true, text: `Added ${font.family}.` });
      await refresh();
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error && e.message ? e.message : 'That file could not be used as a font.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel">
      <h2>Lettering fonts</h2>
      <p className="muted small">
        Add comic lettering fonts you're licensed to use, such as Wild Words. They stay in this browser and are never
        included in project files. The first one is used for new balloons and captions; Comic Neue and a few other free
        fonts are always available.
      </p>
      {fonts.map((f) => (
        <div className="row gap" key={f.family}>
          <span className="grow"><span style={{ fontFamily: `"${f.family}", cursive` }}>{f.family}</span> <span className="muted small">· {f.fileName}</span></span>
          <button className="btn danger" onClick={async () => { await removeUserFont(f.family); await refresh(); }}>Remove</button>
        </div>
      ))}
      <button className="btn" disabled={busy} onClick={() => void add()}>{busy ? 'Adding…' : 'Add font'}</button>
      {message && <p className={`${message.ok ? 'ok' : 'error'} small`}>{message.text}</p>}
    </section>
  );
}
