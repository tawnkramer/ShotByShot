import { useEffect, useState } from 'react';
import { getSetting } from '../storage/db';
import { beginSignIn, OPENART_TOKEN_SETTING, pendingSignIn, signOut, type OpenArtToken } from './auth';
import { OpenArtMcp, type McpTool } from './mcp';

export function OpenArtSettings() {
  const [signedIn, setSignedIn] = useState<boolean>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string }>();
  const [tools, setTools] = useState<McpTool[]>();
  const [args, setArgs] = useState<Record<string, string>>({});
  const [output, setOutput] = useState<{ tool: string; text: string }>();

  useEffect(() => {
    let live = true;
    void (async () => {
      if (pendingSignIn) {
        setBusy(true);
        const error = await pendingSignIn;
        if (!live) return;
        setBusy(false);
        setMessage(error ? { ok: false, text: error } : { ok: true, text: 'Signed in with OpenArt.' });
      }
      const token = await getSetting<OpenArtToken>(OPENART_TOKEN_SETTING);
      if (live) setSignedIn(Boolean(token));
    })();
    return () => { live = false; };
  }, []);

  const signIn = async () => {
    setBusy(true); setMessage(undefined);
    try {
      window.location.assign(await beginSignIn());
    } catch (e) {
      setBusy(false);
      setMessage({ ok: false, text: e instanceof Error ? e.message : String(e) });
    }
  };
  const loadTools = async () => {
    setBusy(true); setMessage(undefined);
    try {
      setTools(await new OpenArtMcp().listTools());
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally { setBusy(false); }
  };
  const run = async (tool: string, args: string) => {
    let parsed: Record<string, unknown>;
    try { parsed = args.trim() ? JSON.parse(args) as Record<string, unknown> : {}; } catch { setOutput({ tool, text: 'The arguments are not valid JSON.' }); return; }
    setOutput({ tool, text: 'Running…' });
    try {
      setOutput({ tool, text: JSON.stringify(await new OpenArtMcp().callTool(tool, parsed), null, 2) });
    } catch (e) {
      setOutput({ tool, text: e instanceof Error ? e.message : String(e) });
    }
  };
  const copyTools = () => void navigator.clipboard?.writeText(JSON.stringify(tools, null, 2)).then(() => setMessage({ ok: true, text: 'Copied the tool list.' }));

  return <section className="panel">
    <h2>OpenArt</h2>
    <p className="muted small">
      Use your OpenArt account and credits. Sign-in goes through OpenArt's own page; the app keeps the sign-in only in this browser and
      reaches OpenArt through the relay set up under ComfyUI Cloud.
    </p>
    {signedIn ? <div className="row gap">
      <span className="grow ok small">Signed in.</span>
      <button className="btn" disabled={busy} onClick={() => void loadTools()}>{busy ? 'Loading…' : 'Show tools'}</button>
      <button className="btn danger" disabled={busy} onClick={async () => { await signOut(); setSignedIn(false); setTools(undefined); }}>Sign out</button>
    </div> : <button className="btn primary" disabled={busy || signedIn === undefined} onClick={() => void signIn()}>{busy ? 'Signing in…' : 'Sign in with OpenArt'}</button>}
    {message && <p className={message.ok ? 'ok small' : 'error small'} role={message.ok ? undefined : 'alert'}>{message.text}</p>}
    {tools && <div className="comfy-category">
      <div className="row gap"><h3 className="grow">{tools.length} OpenArt tool{tools.length === 1 ? '' : 's'}</h3><button className="btn" onClick={copyTools}>Copy list</button></div>
      {tools.map((t) => <details key={t.name} className="comfy-workflow">
        <summary><strong>{t.title ?? t.name}</strong> <span className="muted small">{t.name}</span></summary>
        {t.description && <p className="small muted">{t.description}</p>}
        <pre className="small">{JSON.stringify(t.inputSchema, null, 2)}</pre>
        {/* Only tools OpenArt marks read-only can be tried here, so nothing spends credits. */}
        {t.annotations?.readOnlyHint && <div className="field">
          <label className="field"><span>Arguments (JSON)</span>
            <textarea rows={2} value={args[t.name] ?? '{}'} onChange={(e) => setArgs({ ...args, [t.name]: e.target.value })} />
          </label>
          <div className="row gap">
            <button className="btn" onClick={() => void run(t.name, args[t.name] ?? '{}')}>Run</button>
            {output?.tool === t.name && <button className="btn" onClick={() => void navigator.clipboard?.writeText(output.text).then(() => setMessage({ ok: true, text: 'Copied the result.' }))}>Copy result</button>}
          </div>
          {output?.tool === t.name && <pre className="small">{output.text}</pre>}
        </div>}
      </details>)}
    </div>}
  </section>;
}
