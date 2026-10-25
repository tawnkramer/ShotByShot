import { ImagePreview, ZoomableImage } from './ImagePreview';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { API_KEY_SETTING } from '../ai/openai';
import { setShotImage } from '../shots/commands';
import { setStageImage } from '../staging/commands';
import { updateProp } from '../props/commands';
import { updateCharacter } from '../characters/commands';
import { DEFAULT_IMAGE_MODEL, generateCharacterImage, generateStageImage, generatePropImage, generateShotImage, shotImageSize, IMAGE_MODELS, type ImageQuality } from './generate';
import { estimateImageCost, formatImageCost } from './cost';
import { useBlobUrl } from './useBlobUrl';
import { Overlay } from '../shell/Overlay';
import { pickFile, saveFile } from '../shell/download';
import { prepareUpload, UPLOAD_MODEL } from './upload';
import { newId, type Character } from '../state/schema';
import { useProjectStore } from '../state/store';
import { getBlob, getSetting, putBlob, setSetting } from '../storage/db';
import { safeFileName } from '../storage/projectFile';
import { COMFY_KEY_SETTING } from '../comfy/client';
import { listWorkflows, type ComfyWorkflow } from '../comfy/settings';
import { asPng, placeImages, runWorkflow } from '../comfy/run';
import { GEMINI_KEY_SETTING } from '../ai/gemini';
import { GEMINI_IMAGE_MODELS, generateGeminiImage, geminiAspectRatio, geminiImageModels, isGeminiImageModel } from './gemini';

export const IMAGE_PREFERENCES_SETTING = 'image-generation-preferences';
/** Model values for imported Comfy workflows: `comfy:<workflow id>`. */
const COMFY_PREFIX = 'comfy:';

export function ConceptImageEditor({ subject: c, defaultPrompt, kind, reference, references = [], imageContext, buildPrompt, onPromptChange, onClose }: {
  subject: { id: string; name: string; image?: Character['image'] }; defaultPrompt: string; kind: 'character' | 'stage' | 'prop' | 'shot'; reference?: Blob;
  references?: {blob:string;name:string;kind:'stage'|'character';characterId?:string;data:Blob}[];
  imageContext?: Pick<NonNullable<Character['image']>, 'frameProgress' | 'aspect'>;
  buildPrompt?: (additional: string) => string; onPromptChange?: (value: string) => void; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const promptInput = useRef<HTMLTextAreaElement>(null);
  const [editingPrompt, setEditingPrompt] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const pending = useRef(false);
  const projectId = useRef(useProjectStore.getState().project?.id).current;
  const [prompt, setPrompt] = useState(kind === 'shot' ? defaultPrompt : c.image?.prompt ?? defaultPrompt);
  const [model, setModel] = useState<string>(c.image?.model && c.image.model !== UPLOAD_MODEL ? c.image.model : DEFAULT_IMAGE_MODEL);
  const [quality, setQuality] = useState<ImageQuality>('medium');
  const [preferencesReady, setPreferencesReady] = useState(false);
  useEffect(() => {
    let active = true;
    void getSetting<{ model?: string; quality?: ImageQuality }>(IMAGE_PREFERENCES_SETTING).then((saved) => {
      if (!active) return;
      if (saved?.model && (IMAGE_MODELS.includes(saved.model as typeof IMAGE_MODELS[number]) || saved.model.startsWith(COMFY_PREFIX) || isGeminiImageModel(saved.model))) setModel(saved.model);
      if (saved?.quality && ['low', 'medium', 'high'].includes(saved.quality)) setQuality(saved.quality);
    }).catch(() => {}).finally(() => { if (active) setPreferencesReady(true); });
    return () => { active = false; };
  }, []);
  const choosePreferences = (nextModel: string, nextQuality: ImageQuality) => {
    setModel(nextModel); setQuality(nextQuality);
    void setSetting(IMAGE_PREFERENCES_SETTING, { model: nextModel, quality: nextQuality }).catch(() => setError('Could not remember image preferences in browser storage.'));
  };
  // Comfy workflows: text-to-image for characters, image editing where a 3D preview guides the result.
  const [comfyWorkflows, setComfyWorkflows] = useState<ComfyWorkflow[]>([]);
  const comfy = model.startsWith(COMFY_PREFIX) ? comfyWorkflows.find((w) => COMFY_PREFIX + w.id === model) : undefined;
  const gemini = isGeminiImageModel(model);
  const [geminiModels, setGeminiModels] = useState<string[]>(GEMINI_IMAGE_MODELS);
  const provider = comfy ? 'Comfy Cloud' : gemini ? 'Gemini' : 'OpenAI';
  const [status, setStatus] = useState('');
  const size = kind === 'shot' ? shotImageSize(imageContext?.aspect ?? 1, model) : kind === 'prop' ? '1024x1024' : kind === 'stage' ? '1536x1024' : '1024x1536';
  const aspect = kind === 'shot' ? imageContext?.aspect ?? 1 : kind === 'prop' ? 1 : kind === 'stage' ? 3 / 2 : 2 / 3;
  const estimate = comfy || gemini ? undefined : estimateImageCost(model, quality, size, buildPrompt ? buildPrompt(prompt) : prompt);
  const referenceCount = reference ? 1 + references.length : 0;
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState<{ blob: Blob; prompt: string; model: string; additionalPrompt: string }>();
  const [draftUrl, setDraftUrl] = useState<string>();
  const [referenceUrl, setReferenceUrl] = useState<string>();
  useEffect(() => {
    if (!reference) return;
    const url = URL.createObjectURL(reference); setReferenceUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [reference]);
  const [preview, setPreview] = useState(false);
  const savedUrl = useBlobUrl(c.image?.blob);
  const [keys, setKeys] = useState<{ openai?: boolean; comfy?: boolean; gemini?: boolean }>({});
  const hasKey = model.startsWith(COMFY_PREFIX) ? keys.comfy : gemini ? keys.gemini : keys.openai;
  // Built-in workflows are offered once a Comfy key is saved; imported ones always show.
  const shownComfy = comfyWorkflows.filter((w) => !w.builtin || keys.comfy || COMFY_PREFIX + w.id === model);
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
    void Promise.all([getSetting<string>(API_KEY_SETTING), getSetting<string>(COMFY_KEY_SETTING), getSetting<string>(GEMINI_KEY_SETTING)])
      .then(([openai, comfyKey, geminiKey]) => setKeys({ openai: Boolean(openai), comfy: Boolean(comfyKey), gemini: Boolean(geminiKey) })).catch(() => setKeys({ openai: false, comfy: false, gemini: false }));
    void geminiImageModels().then(setGeminiModels).catch(() => {});
    // Characters have no input image; elsewhere editing workflows take the 3D preview, and text-to-image ones work from the prompt alone.
    void (kind === 'character' ? listWorkflows('image', true) : Promise.all([listWorkflows('edit', true), listWorkflows('image', true)]).then((lists) => lists.flat()))
      .then(setComfyWorkflows).catch(() => {});
    return () => {
      controller.current?.abort();
      vv?.removeEventListener('resize', fitScreen);
      vv?.removeEventListener('scroll', fitScreen);
      window.removeEventListener('resize', fitScreen);
    };
  }, []);
  useEffect(() => {
    if (!draft) { setDraftUrl(undefined); return; }
    const url = URL.createObjectURL(draft.blob);
    setDraftUrl(url); setPreview(true);
    return () => URL.revokeObjectURL(url);
  }, [draft]);

  const generate = async () => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true); setError('');
    const abort = new AbortController();
    controller.current = abort;
    try {
      const renderedPrompt = buildPrompt ? buildPrompt(prompt) : prompt;
      if (model.startsWith(COMFY_PREFIX)) {
        if (!comfy) throw new Error('This Comfy workflow is no longer imported. Choose another model.');
        const comfyKey = await getSetting<string>(COMFY_KEY_SETTING);
        if (!comfyKey) { setKeys((k) => ({ ...k, comfy: false })); throw new Error('Add your Comfy Cloud API key in Settings first.'); }
        const images = [
          ...(reference ? [{ data: reference, label: '3D preview', fileName: `${kind}-preview.png` }] : []),
          ...references.map((r, i) => ({ data: r.data, label: r.name, fileName: `reference-${i + 2}.png` })),
        ];
        const [width, height] = size.split('x').map(Number);
        const { blob } = await runWorkflow({ key: comfyKey, workflow: comfy, inputs: placeImages(comfy, images), prompt: renderedPrompt, aspect: kind === 'shot' ? imageContext?.aspect ?? width / height : width / height, output: 'image', signal: abort.signal, onStatus: setStatus });
        if (!abort.signal.aborted) setDraft({ blob: await asPng(blob), prompt: renderedPrompt, model, additionalPrompt: prompt });
        return;
      }
      if (kind !== 'character' && !reference) throw new Error('Capture a 3D preview before generating.');
      if (gemini) {
        const geminiKey = await getSetting<string>(GEMINI_KEY_SETTING);
        if (!geminiKey) { setKeys((k) => ({ ...k, gemini: false })); throw new Error('Add your Gemini API key in Settings first.'); }
        const images = reference ? [reference, ...references.map((r) => r.data)] : [];
        const blob = await generateGeminiImage({ apiKey: geminiKey, model, prompt: renderedPrompt, aspect, quality, references: images, signal: abort.signal });
        if (!abort.signal.aborted) setDraft({ blob: await asPng(blob), prompt: renderedPrompt, model, additionalPrompt: prompt });
        return;
      }
      const apiKey = await getSetting<string>(API_KEY_SETTING);
      if (!apiKey) { setKeys((k) => ({ ...k, openai: false })); throw new Error('Add your OpenAI API key in Settings first.'); }
      const options = { apiKey, prompt: renderedPrompt, model, quality, signal: abort.signal };
      const blob = await (kind === 'shot' ? generateShotImage({ ...options, reference: reference!, referenceImages: references.map((r) => r.data), aspect: imageContext?.aspect ?? 1 }) : kind === 'prop' ? generatePropImage({ ...options, reference: reference! }) : kind === 'stage' ? generateStageImage({ ...options, reference: reference! }) : generateCharacterImage(options));
      if (!abort.signal.aborted) setDraft({ blob, prompt: renderedPrompt, model, additionalPrompt: prompt });
    } catch (e) {
      if (!abort.signal.aborted) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (controller.current === abort) { pending.current = false; setBusy(false); setStatus(''); }
    }
  };
  // An image from the user's own device: previewed like a generated one, then saved with Use image.
  const upload = async () => {
    const file = await pickFile('image/*');
    if (!file) return;
    setError('');
    try {
      setDraft({ blob: await prepareUpload(file), prompt: '', model: UPLOAD_MODEL, additionalPrompt: '' });
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };
  const save = async () => {
    if (!draft || pending.current) return;
    const uploaded = draft.model === UPLOAD_MODEL;
    pending.current = true; setBusy(true); setSaving(true); setError('');
    try {
      const blob = `${kind}-image-${newId()}`;
      await putBlob(blob, draft.blob);
      const store = useProjectStore.getState();
      if (!store.project || store.project.id !== projectId || !store.project[kind === 'shot' ? 'shots' : kind === 'stage' ? 'stages' : kind === 'prop' ? 'props' : 'characters'].some((x) => x.id === c.id)) throw new Error(`This ${kind} is no longer open. Download the image to keep it.`);
      // Uploads weren't made from the 3D view, so it isn't kept as their guidance.
      const guidanceBlob = reference && !uploaded ? `${kind}-guidance-${newId()}` : undefined;
      if (guidanceBlob && reference) await putBlob(guidanceBlob, reference);
      const image = { blob, prompt: draft.prompt, model: draft.model, createdAt: Date.now(), guidanceBlob, ...(kind === 'shot' ? { ...imageContext, additionalPrompt: draft.additionalPrompt, ...(uploaded ? {} : { referenceImages: references.map(({data: _data, ...ref}) => ref) }) } : {}) };
      store.dispatch(kind === 'shot' ? setShotImage(c.id, image) : kind === 'stage' ? setStageImage(c.id, image) : kind === 'prop' ? updateProp(c.id, { image }) : updateCharacter(c.id, { image }));
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
        <div className="grow"><h2 id="character-image-title">{editingPrompt ? 'Edit image prompt' : `${c.name} · ${kind === 'shot' ? 'Shot' : kind === 'stage' ? 'Stage' : kind === 'prop' ? 'Prop' : 'Character'} image`}</h2>{!editingPrompt && <span className="small muted">Concept artwork</span>}</div>
        {editingPrompt ? <button className="btn primary" onClick={() => { promptInput.current?.blur(); setEditingPrompt(false); }}>Done</button> : <button className="btn ghost" disabled={saving} onClick={onClose} autoFocus>Close</button>}
      </header>
      <div className="image-editor-body">
        <div className="image-editor-preview">
          {draftUrl || savedUrl ? <ZoomableImage src={(draftUrl || savedUrl)!} alt={`Concept artwork for ${c.name}`} /> : <p className="muted">Your image will appear here.</p>}
        </div>
        <div className="image-editor-controls">
          {referenceUrl && <figure className="stage-image-guidance"><ZoomableImage src={referenceUrl} alt={`Greyscale ${kind} preview used as guidance`} /><figcaption className="small muted">Current 3D view · sent with your prompt</figcaption></figure>}
          {references.map((r) => <ReferenceThumbnail key={r.blob + (r.characterId ?? '')} reference={r} />)}
          {kind === 'shot' && buildPrompt && <details className="generated-image-prompt">
            <summary>Generated prompt</summary>
            <pre>{buildPrompt('')}</pre>
          </details>}
          <label className="field image-prompt-field"><span>{kind === 'shot' ? 'Additional prompt' : 'Image prompt'}</span><textarea ref={promptInput} onFocus={() => setEditingPrompt(true)} rows={7} maxLength={32000} value={prompt} disabled={busy} onChange={(e) => { setPrompt(e.target.value); onPromptChange?.(e.target.value); }} /></label>
          <button className="btn ghost" disabled={busy} onClick={() => { setPrompt(defaultPrompt); onPromptChange?.(defaultPrompt); }}>Reset from {kind} details</button>
          <div className="row gap">
            <label className="field grow"><span>Model</span><select value={model} disabled={busy || !preferencesReady} onChange={(e) => choosePreferences(e.target.value, quality)}>
              {[...new Set([...IMAGE_MODELS, ...(model.startsWith(COMFY_PREFIX) || gemini ? [] : [model])])].map((m) => <option key={m}>{m}</option>)}
              {(keys.gemini || gemini) && <optgroup label="Google Gemini">{[...new Set([...geminiModels, ...(gemini ? [model] : [])])].map((m) => <option key={m} value={m}>{m}</option>)}</optgroup>}
              {shownComfy.length > 0 && <optgroup label="ComfyUI Cloud">{shownComfy.map((w) => <option key={w.id} value={COMFY_PREFIX + w.id}>{w.name}{kind !== 'character' && w.category === 'image' ? ' (prompt only)' : ''}</option>)}</optgroup>}
              {model.startsWith(COMFY_PREFIX) && !comfy && <option value={model}>Comfy workflow (not imported)</option>}
            </select></label>
            {!comfy && <label className="field"><span>Quality</span><select value={quality} disabled={busy || !preferencesReady} onChange={(e) => choosePreferences(model, e.target.value as ImageQuality)}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></label>}
          </div>
          <p className="small muted">Creates one {kind === 'shot' ? 'shot' : kind === 'stage' ? 'landscape' : kind === 'prop' ? 'square' : 'portrait'} image using your {provider} key. {comfy ? 'Comfy Cloud charges apply.' : 'API charges apply.'} This artwork is separate from the 3D {kind === 'shot' ? 'scene' : kind === 'stage' ? 'stage' : kind === 'prop' ? 'model' : 'mannequin'}.</p>
          {hasKey === false && <Link className="btn" to="/settings" onClick={onClose}>Add key in Settings</Link>}
          {error && <p className="error small" role="alert">{error}</p>}
          <p className="small muted" role="status">{busy ? status || 'Working… This can take a few minutes. Keep this page open.' : draft ? `${draft.model === UPLOAD_MODEL ? 'Your image is ready' : 'Preview ready'}. Use image to save it to this ${kind}.` : ''}</p>
          <div className="small" aria-live="polite">
            {comfy ? <><strong>Cost estimate unavailable</strong><p className="muted">{size.replace('x', '×')} aspect · one image. Comfy Cloud bills GPU run time on your plan.</p></> : gemini ? <><strong>Cost estimate unavailable for Gemini</strong><p className="muted">{geminiAspectRatio(aspect)} · one image{quality === 'high' ? ' at 2K' : ''}{referenceCount ? ` · ${referenceCount} reference image${referenceCount === 1 ? '' : 's'}` : ''}. Billed per image on your Google AI Studio account. <a href="https://ai.google.dev/gemini-api/docs/pricing" target="_blank" rel="noreferrer">Pricing</a></p></> : <><strong>{estimate ? `Estimated ${referenceCount ? 'output + prompt' : 'cost'}: ${formatImageCost(estimate.subtotal)}` : 'Cost estimate unavailable for this model'}</strong>
            <p className="muted">{size} · one image. {referenceCount > 0 && estimate ? `${referenceCount} reference image${referenceCount === 1 ? '' : 's'} billed additionally at $${estimate.imageRate} per million image input tokens; excluded from this estimate. ` : ''}Approximate, not a guaranteed charge. <a href="https://developers.openai.com/api/docs/guides/image-generation#cost-and-latency" target="_blank" rel="noreferrer">Pricing</a></p></>}
          </div>
          <button className="btn primary" disabled={busy || !preferencesReady || (kind !== 'shot' && !prompt.trim()) || hasKey === false} onClick={() => void generate()}>{busy ? 'Working…' : draft || c.image ? 'Generate another image' : 'Generate image'}</button>
          <button className="btn" disabled={busy} onClick={() => void upload()}>Upload image</button>
          {busy && !saving && <button className="btn" onClick={() => { controller.current?.abort(); controller.current = null; pending.current = false; setBusy(false); }}>Cancel request</button>}
          <div className="row gap">
            {draft && <button className="btn primary grow" disabled={busy} onClick={() => void save()}>Use image</button>}
            {(draft || c.image) && <button className="btn grow" disabled={busy} onClick={() => void download()}>Download</button>}
          </div>
        </div>
      </div>
    </dialog>
    {preview && draftUrl && <ImagePreview src={draftUrl} alt={`Concept artwork for ${c.name}`} onClose={() => setPreview(false)}
      draft={{ onUse: () => { setPreview(false); void save(); }, onDiscard: () => { setPreview(false); setDraft(undefined); } }} />}
  </Overlay>;
}

function ReferenceThumbnail({ reference }: {reference: {blob:string;name:string;kind:string}}) {
  const src = useBlobUrl(reference.blob);
  return <figure className="stage-image-guidance">{src && <ZoomableImage src={src} alt={`${reference.name} ${reference.kind} reference`} />}<figcaption className="small muted">{reference.name} · {reference.kind} reference</figcaption></figure>;
}
