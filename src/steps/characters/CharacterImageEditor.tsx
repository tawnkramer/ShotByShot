import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { API_KEY_SETTING } from '../../ai/openai';
import { setStageImage } from '../../staging/commands';
import { updateCharacter } from '../../characters/commands';
import { characterImagePrompt, DEFAULT_IMAGE_MODEL, generateCharacterImage, generateStageImage, IMAGE_MODELS, type ImageQuality } from '../../images/generate';
import { useBlobUrl } from '../../images/useBlobUrl';
import { Overlay } from '../../shell/Overlay';
import { saveFile } from '../../shell/download';
import { newId, type Character, type Stage } from '../../state/schema';
import { useProjectStore } from '../../state/store';
import { getBlob, getSetting, putBlob } from '../../storage/db';
import { safeFileName } from '../../storage/projectFile';

export function CharacterImageEditor({ character, onClose }: { character: Character; onClose: () => void }) {
  return <ConceptImageEditor subject={character} defaultPrompt={characterImagePrompt(character)} kind="character" onClose={onClose} />;
}

export function ConceptImageEditor({ subject: c, defaultPrompt, kind, reference, onClose }: {
  subject: Character | Stage; defaultPrompt: string; kind: 'character' | 'stage'; reference?: Blob; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const promptInput = useRef<HTMLTextAreaElement>(null);
  const [editingPrompt, setEditingPrompt] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const pending = useRef(false);
  const projectId = useRef(useProjectStore.getState().project?.id).current;
  const [prompt, setPrompt] = useState(c.image?.prompt ?? defaultPrompt);
  const [model, setModel] = useState<string>(c.image?.model ?? DEFAULT_IMAGE_MODEL);
  const [quality, setQuality] = useState<ImageQuality>('medium');
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState<{ blob: Blob; prompt: string; model: string }>();
  const [draftUrl, setDraftUrl] = useState<string>();
  const [referenceUrl, setReferenceUrl] = useState<string>();
  useEffect(() => {
    if (!reference) return;
    const url = URL.createObjectURL(reference); setReferenceUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [reference]);
  const savedUrl = useBlobUrl(c.image?.blob);
  const [hasKey, setHasKey] = useState<boolean>();
  useEffect(() => {
    dialog.current?.showModal();
    const vv = window.visualViewport;
    const fitScreen = () => {
      dialog.current?.style.setProperty('--image-editor-height', `${vv?.height ?? window.innerHeight}px`);
      dialog.current?.style.setProperty('--image-editor-top', `${vv?.offsetTop ?? 0}px`);
    };
    fitScreen();
    vv?.addEventListener('resize', fitScreen);
    vv?.addEventListener('scroll', fitScreen);
    window.addEventListener('resize', fitScreen);
    void getSetting<string>(API_KEY_SETTING).then((key) => setHasKey(Boolean(key))).catch(() => setHasKey(false));
    return () => {
      controller.current?.abort();
      vv?.removeEventListener('resize', fitScreen);
      vv?.removeEventListener('scroll', fitScreen);
      window.removeEventListener('resize', fitScreen);
    };
  }, []);
  useEffect(() => {
    if (!draft) return;
    const url = URL.createObjectURL(draft.blob);
    setDraftUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [draft]);

  const generate = async () => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true); setError('');
    const abort = new AbortController();
    controller.current = abort;
    try {
      const apiKey = await getSetting<string>(API_KEY_SETTING);
      if (!apiKey) { setHasKey(false); throw new Error('Add your OpenAI API key in Settings first.'); }
      const options = { apiKey, prompt, model, quality, signal: abort.signal };
      if (kind === 'stage' && !reference) throw new Error('Capture a stage preview before generating.');
      const blob = await (kind === 'stage' ? generateStageImage({ ...options, reference: reference! }) : generateCharacterImage(options));
      if (!abort.signal.aborted) setDraft({ blob, prompt, model });
    } catch (e) {
      if (!abort.signal.aborted) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (controller.current === abort) { pending.current = false; setBusy(false); }
    }
  };
  const save = async () => {
    if (!draft || pending.current) return;
    pending.current = true; setBusy(true); setSaving(true); setError('');
    try {
      const blob = `${kind}-image-${newId()}`;
      await putBlob(blob, draft.blob);
      const store = useProjectStore.getState();
      if (!store.project || store.project.id !== projectId || !store.project[kind === 'stage' ? 'stages' : 'characters'].some((x) => x.id === c.id)) throw new Error(`This ${kind} is no longer open. Download the image to keep it.`);
      const guidanceBlob = reference ? `stage-guidance-${newId()}` : undefined;
      if (guidanceBlob && reference) await putBlob(guidanceBlob, reference);
      const image = { blob, prompt: draft.prompt, model: draft.model, createdAt: Date.now(), guidanceBlob };
      store.dispatch(kind === 'stage' ? setStageImage(c.id, image) : updateCharacter(c.id, { image }));
      await store.flush();
      if (useProjectStore.getState().saving === 'error') throw new Error('Could not save the project. Download the image as a backup.');
      onClose();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { pending.current = false; setBusy(false); setSaving(false); }
  };
  const download = async () => {
    try {
      const blob = draft?.blob ?? (c.image ? await getBlob(c.image.blob) : undefined);
      if (!blob) throw new Error('This image is missing from browser storage.');
      await saveFile(blob, `${safeFileName(c.name)}.png`, 'image/png');
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };
  return <Overlay>
    <dialog ref={dialog} className={`character-image-dialog${editingPrompt ? ' editing-prompt' : ''}`} aria-labelledby="character-image-title" onCancel={(e) => { e.preventDefault(); if (editingPrompt) { promptInput.current?.blur(); setEditingPrompt(false); } else if (!saving) onClose(); }}>
      <header className="row gap image-editor-head">
        <div className="grow"><h2 id="character-image-title">{editingPrompt ? 'Edit image prompt' : `${c.name} · ${kind === 'stage' ? 'Stage' : 'Character'} image`}</h2>{!editingPrompt && <span className="small muted">Concept artwork</span>}</div>
        {editingPrompt ? <button className="btn primary" onClick={() => { promptInput.current?.blur(); setEditingPrompt(false); }}>Done</button> : <button className="btn ghost" disabled={saving} onClick={onClose} autoFocus>Close</button>}
      </header>
      <div className="image-editor-body">
        <div className="image-editor-preview">
          {draftUrl || savedUrl ? <img src={draftUrl || savedUrl} alt={`Concept artwork for ${c.name}`} /> : <p className="muted">Your image will appear here.</p>}
        </div>
        <div className="image-editor-controls">
          {referenceUrl && <figure className="stage-image-guidance"><img src={referenceUrl} alt="Greyscale stage preview used as guidance" /><figcaption className="small muted">Current 3D view · sent with your prompt</figcaption></figure>}
          <label className="field image-prompt-field"><span>Image prompt</span><textarea ref={promptInput} onFocus={() => setEditingPrompt(true)} rows={7} maxLength={32000} value={prompt} disabled={busy} onChange={(e) => setPrompt(e.target.value)} /></label>
          <button className="btn ghost" disabled={busy} onClick={() => setPrompt(defaultPrompt)}>Reset from {kind} details</button>
          <div className="row gap">
            <label className="field grow"><span>Model</span><select value={model} disabled={busy} onChange={(e) => setModel(e.target.value)}>{[...new Set([...IMAGE_MODELS, model])].map((m) => <option key={m}>{m}</option>)}</select></label>
            <label className="field"><span>Quality</span><select value={quality} disabled={busy} onChange={(e) => setQuality(e.target.value as ImageQuality)}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></label>
          </div>
          <p className="small muted">Creates one {kind === 'stage' ? 'landscape' : 'portrait'} image using your OpenAI key. API charges apply. This artwork is separate from the 3D {kind === 'stage' ? 'stage' : 'mannequin'}.</p>
          {hasKey === false && <Link className="btn" to="/settings" onClick={onClose}>Add key in Settings</Link>}
          {error && <p className="error small" role="alert">{error}</p>}
          <p className="small muted" role="status">{busy ? 'Working… This can take a few minutes. Keep this page open.' : draft ? `Preview ready. Use image to save it to this ${kind}.` : ''}</p>
          <button className="btn primary" disabled={busy || !prompt.trim() || hasKey === false} onClick={() => void generate()}>{busy ? 'Working…' : draft || c.image ? 'Generate another image' : 'Generate image'}</button>
          {busy && !saving && <button className="btn" onClick={() => { controller.current?.abort(); controller.current = null; pending.current = false; setBusy(false); }}>Cancel request</button>}
          <div className="row gap">
            {draft && <button className="btn primary grow" disabled={busy} onClick={() => void save()}>Use image</button>}
            {(draft || c.image) && <button className="btn grow" disabled={busy} onClick={() => void download()}>Download</button>}
          </div>
        </div>
      </div>
    </dialog>
  </Overlay>;
}
