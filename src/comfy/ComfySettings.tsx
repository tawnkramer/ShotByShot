import { useEffect, useState } from 'react';
import { deleteSetting, getSetting, setSetting } from '../storage/db';
import { pickFile } from '../shell/download';
import { COMFY_KEY_SETTING, COMFY_RELAY_SETTING, normalizeRelayUrl, testComfyKey, type KeyCheck } from './client';
import { BUILTIN_WORKFLOWS, importWorkflow, listWorkflows, saveWorkflows, type ComfyWorkflow } from './settings';
import { analyzeWorkflow, CATEGORY_LABELS, CATEGORY_OUTPUT, defaultPromptTarget, describeAnalysis, slotKey, WORKFLOW_CATEGORIES, type WorkflowCategory } from './workflow';

export const COMFY_KEY_PAGE = 'https://platform.comfy.org/profile/home';
/** Copies this repo into the user's own GitHub and Cloudflare accounts and deploys the relay Worker (wrangler.jsonc). */
export const RELAY_DEPLOY_URL = 'https://deploy.workers.cloudflare.com/?url=https://github.com/tawnkramer/ShotByShot';

export function ComfySettings() {
  const [key, setKey] = useState('');
  const [savedKey, setSavedKey] = useState<string>();
  const [check, setCheck] = useState<KeyCheck | null>(null);
  const [testing, setTesting] = useState(false);
  const [workflows, setWorkflows] = useState<ComfyWorkflow[]>([]);
  const [error, setError] = useState('');
  const [relay, setRelay] = useState('');
  const [savedRelay, setSavedRelay] = useState<string>();
  const [relayError, setRelayError] = useState('');

  useEffect(() => {
    void getSetting<string>(COMFY_KEY_SETTING).then(setSavedKey);
    void getSetting<string>(COMFY_RELAY_SETTING).then(setSavedRelay);
    void listWorkflows().then(setWorkflows);
  }, []);

  const storeKey = async (k: string) => {
    await setSetting(COMFY_KEY_SETTING, k);
    setSavedKey(k); setKey('');
  };
  const saveKey = async () => {
    const k = key.trim();
    if (!k) return;
    setTesting(true);
    const result = await testComfyKey(k);
    setTesting(false); setCheck(result);
    if (result.ok) await storeKey(k);
  };
  const saveRelay = async () => {
    try {
      const url = normalizeRelayUrl(relay);
      await setSetting(COMFY_RELAY_SETTING, url);
      setSavedRelay(url); setRelay(''); setRelayError(''); setCheck(null);
    } catch (e) { setRelayError(e instanceof Error ? e.message : String(e)); }
  };
  const update = async (next: ComfyWorkflow[]) => {
    setWorkflows(next);
    try { await saveWorkflows(next); } catch { setError('Could not save workflows in browser storage.'); }
  };
  const add = async (category: WorkflowCategory) => {
    setError('');
    const file = await pickFile('application/json,.json');
    if (!file) return;
    try {
      await update([...workflows, importWorkflow(await file.text(), file.name, category)]);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };

  return <section className="panel">
    <h2>ComfyUI Cloud</h2>
    <p className="muted small">
      Run your own ComfyUI workflows on Comfy Cloud, for example to turn a shot into video. The API key is stored only in this browser,
      is sent only to your relay and cloud.comfy.org, and is never included in project files. Running workflows needs an active Comfy Cloud subscription.
    </p>
    <h3 className="comfy-step">1. Relay</h3>
    <p className="muted small">
      Comfy Cloud doesn't accept requests from web pages directly, so the app talks to it through a small relay you run for free on
      Cloudflare. It forwards each request to cloud.comfy.org and stores nothing. Set it up once, then paste its address here. It looks
      like <code>https://shotbyshot.your-name.workers.dev</code>.
    </p>
    {savedRelay ? <div className="row gap">
      <code className="grow">{savedRelay}</code>
      <button className="btn danger" onClick={async () => { await deleteSetting(COMFY_RELAY_SETTING); setSavedRelay(undefined); setCheck(null); }}>Remove</button>
    </div> : <>
      <a className="btn primary" href={RELAY_DEPLOY_URL} target="_blank" rel="noreferrer">Set up relay on Cloudflare</a>
      <form className="row gap" onSubmit={(e) => { e.preventDefault(); void saveRelay(); }}>
        <input className="grow" type="text" inputMode="url" autoComplete="off" placeholder="Relay address" aria-label="Relay address" value={relay} onChange={(e) => setRelay(e.target.value)} />
        <button className="btn" disabled={!relay.trim()}>Save</button>
      </form>
    </>}
    {relayError && <p className="error small" role="alert">{relayError}</p>}
    <h3 className="comfy-step">2. API key</h3>
    {savedKey ? <div className="row gap">
      <code className="grow">{savedKey.length <= 8 ? '••••' : `${savedKey.slice(0, 3)}…${savedKey.slice(-4)}`}</code>
      <button className="btn" disabled={testing} onClick={async () => { setTesting(true); setCheck(await testComfyKey(savedKey)); setTesting(false); }}>Test</button>
      <button className="btn danger" onClick={async () => { await deleteSetting(COMFY_KEY_SETTING); setSavedKey(undefined); setCheck(null); }}>Forget</button>
    </div> : <form className="row gap" onSubmit={(e) => { e.preventDefault(); void saveKey(); }}>
      <input className="grow" type="password" autoComplete="off" placeholder="Comfy API key" aria-label="Comfy API key" value={key} onChange={(e) => setKey(e.target.value)} />
      <button className="btn primary" disabled={!key.trim() || testing}>{testing ? 'Checking…' : 'Save'}</button>
    </form>}
    {check && <p className={check.ok ? 'ok small' : 'error small'}>{check.message}</p>}
    {check && !check.reachable && !savedKey && key.trim() && <button className="btn" onClick={() => void storeKey(key.trim())}>Save without checking</button>}
    {!savedKey && <a className="btn" href={COMFY_KEY_PAGE} target="_blank" rel="noreferrer">Get an API key</a>}
    <p className="muted small">Create a key in your <a href={COMFY_KEY_PAGE} target="_blank" rel="noreferrer">Comfy platform profile</a>. Import workflows exported from ComfyUI with Workflow → Export (API).</p>
    {WORKFLOW_CATEGORIES.map((category) => <div key={category} className="comfy-category">
      <div className="row gap"><h3 className="grow">{CATEGORY_LABELS[category]}</h3><button className="btn" onClick={() => void add(category)}>Import JSON</button></div>
      {BUILTIN_WORKFLOWS.filter((w) => w.category === category).map((w) => <WorkflowRow key={w.id} workflow={w} onChange={() => {}} onRemove={() => {}} />)}
      {workflows.filter((w) => w.category === category).map((w) => <WorkflowRow key={w.id} workflow={w}
        onChange={(next) => void update(workflows.map((x) => x.id === w.id ? next : x))}
        onRemove={() => void update(workflows.filter((x) => x.id !== w.id))} />)}
      {![...BUILTIN_WORKFLOWS, ...workflows].some((w) => w.category === category) && <p className="muted small">No workflows imported.</p>}
    </div>)}
    {error && <p className="error small" role="alert">{error}</p>}
  </section>;
}

function WorkflowRow({ workflow: w, onChange, onRemove }: { workflow: ComfyWorkflow; onChange: (w: ComfyWorkflow) => void; onRemove: () => void }) {
  const analysis = analyzeWorkflow(w.graph);
  const target = w.promptTarget ?? defaultPromptTarget(analysis);
  const expected = CATEGORY_OUTPUT[w.category];
  return <div className="comfy-workflow">
    {w.builtin ? <strong>{w.name} <span className="muted small">· built in</span></strong> : <div className="row gap">
      <input className="grow" aria-label="Workflow name" defaultValue={w.name} onBlur={(e) => { const name = e.target.value.trim(); if (name && name !== w.name) onChange({ ...w, name }); }} />
      <button className="btn danger" onClick={onRemove}>Remove</button>
    </div>}
    {w.builtin && <p className="small muted">A Comfy partner node: runs bill Comfy credits at the price shown before you generate.</p>}
    <p className="small muted">{describeAnalysis(analysis)}</p>
    {!analysis.outputs.includes(expected) && <p className="error small">No {expected} output node found. Add a Save {expected === 'audio' ? 'Audio' : expected === 'video' ? 'Video' : 'Image'} node and export again.</p>}
    {w.builtin ? null : analysis.prompts.length > 0 ? <label className="field"><span>Prompt input</span>
      <select value={target ? slotKey(target) : ''} onChange={(e) => onChange({ ...w, promptTarget: analysis.prompts.find((p) => slotKey(p) === e.target.value) })}>
        {analysis.prompts.map((p) => <option key={slotKey(p)} value={slotKey(p)}>{p.title} › {p.input} (#{p.nodeId})</option>)}
      </select>
    </label> : <p className="small muted">No prompt input found; prompts will not be sent.</p>}
  </div>;
}
