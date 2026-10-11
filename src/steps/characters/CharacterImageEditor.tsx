import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { API_KEY_SETTING } from '../../ai/openai';
import { updateCharacter } from '../../characters/commands';
import { characterImagePrompt, DEFAULT_IMAGE_MODEL, generateCharacterImage, IMAGE_MODELS, type ImageQuality } from '../../images/generate';
import { useBlobUrl } from '../../images/useBlobUrl';
import { Overlay } from '../../shell/Overlay';
import { saveFile } from '../../shell/download';
import { newId, type Character } from '../../state/schema';
import { useProjectStore } from '../../state/store';
import { getBlob, getSetting, putBlob } from '../../storage/db';
import { safeFileName } from '../../storage/projectFile';

export function CharacterImageEditor({ character: c, onClose }: { character: Character; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const controller = useRef<AbortController | null>(null);
  const pending = useRef(false);
  const projectId = useRef(useProjectStore.getState().project?.id).current;
  const [prompt, setPrompt] = useState(c.image?.prompt ?? characterImagePrompt(c));
  const [model, setModel] = useState<string>(c.image?.model ?? DEFAULT_IMAGE_MODEL);
  const [quality, setQuality] = useState<ImageQuality>('medium');
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState<{ blob: Blob; prompt: string; model: string }>();
  const [draftUrl, setDraftUrl] = useState<string>();
  const savedUrl = useBlobUrl(c.image?.blob);
  const [hasKey, setHasKey] = useState<boolean>();
  useEffect(() => {
    dialog.current?.showModal();
    void getSetting<string>(API_KEY_SETTING).then((key) => setHasKey(Boolean(key))).catch(() => setHasKey(false));
    return () => { controller.current?.abort(); };
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
      const blob = await generateCharacterImage({ apiKey, prompt, model, quality, signal: abort.signal });
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
      const blob = `character-image-${newId()}`;
      await putBlob(blob, draft.blob);
      const store = useProjectStore.getState();
      if (!store.project || store.project.id !== projectId || !store.project.characters.some((x) => x.id === c.id)) throw new Error('This character is no longer open. Download the image to keep it.');
      store.dispatch(updateCharacter(c.id, { image: { blob, prompt: draft.prompt, model: draft.model, createdAt: Date.now() } }));
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
    <dialog ref={dialog} className="character-image-dialog" aria-labelledby="character-image-title" onCancel={(e) => { e.preventDefault(); if (!saving) onClose(); }}>
      <header className="row gap image-editor-head">
        <div className="grow"><h2 id="character-image-title">{c.name} · Character image</h2><span className="small muted">Concept artwork</span></div>
        <button className="btn ghost" disabled={saving} onClick={onClose} autoFocus>Close</button>
      </header>
      <div className="image-editor-body">
        <div className="image-editor-preview">
          {draftUrl || savedUrl ? <img src={draftUrl || savedUrl} alt={`Concept artwork for ${c.name}`} /> : <p className="muted">Your character image will appear here.</p>}
        </div>
        <div className="image-editor-controls">
          <label className="field"><span>Image prompt</span><textarea rows={7} maxLength={32000} value={prompt} disabled={busy} onChange={(e) => setPrompt(e.target.value)} /></label>
          <button className="btn ghost" disabled={busy} onClick={() => setPrompt(characterImagePrompt(c))}>Reset from character details</button>
          <div className="row gap">
            <label className="field grow"><span>Model</span><select value={model} disabled={busy} onChange={(e) => setModel(e.target.value)}>{[...new Set([...IMAGE_MODELS, model])].map((m) => <option key={m}>{m}</option>)}</select></label>
            <label className="field"><span>Quality</span><select value={quality} disabled={busy} onChange={(e) => setQuality(e.target.value as ImageQuality)}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></label>
          </div>
          <p className="small muted">Creates one portrait image using your OpenAI key. API charges apply. This artwork is separate from the 3D mannequin.</p>
          {hasKey === false && <Link className="btn" to="/settings" onClick={onClose}>Add key in Settings</Link>}
          {error && <p className="error small" role="alert">{error}</p>}
          <p className="small muted" role="status">{busy ? 'Working… This can take a few minutes. Keep this page open.' : draft ? 'Preview ready. Use image to save it to this character.' : ''}</p>
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
