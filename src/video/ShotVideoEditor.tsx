import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Overlay } from '../shell/Overlay';
import { saveFile } from '../shell/download';
import { newId, type Project, type Shot } from '../state/schema';
import { useProjectStore } from '../state/store';
import { getBlob, getSetting, putBlob, setSetting } from '../storage/db';
import { safeFileName } from '../storage/projectFile';
import { aspectOf, effectiveShot } from '../shots/setup';
import { setShotVideo, setShotVideoPrompt } from '../shots/commands';
import { useBlobUrl } from '../images/useBlobUrl';
import { COMFY_KEY_SETTING, downloadOutput, runSeconds, submitJob, uploadAsset, waitForJob, type ComfyJob } from '../comfy/client';
import { listWorkflows, type ComfyWorkflow } from '../comfy/settings';
import { analyzeWorkflow, bindWorkflow, randomSeed, slotKey, type AssetReference, type MediaSlot } from '../comfy/workflow';
import { defaultAssignments, mediaOptions, mediaTags, optionData, PREVIS_CLIP, renderPrevisClip, videoPrompt, type MediaOption } from './shotVideo';

export const VIDEO_WORKFLOW_SETTING = 'comfy.videoWorkflow';

export function ShotVideoEditor({ project, shot, previsFrame, onClose }: { project: Project; shot: Shot; previsFrame?: { blob: Blob; characterIds: string[] }; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const controller = useRef<AbortController | null>(null);
  const dispatch = useProjectStore((s) => s.dispatch);
  const [workflows, setWorkflows] = useState<ComfyWorkflow[]>();
  const [workflowId, setWorkflowId] = useState('');
  const [hasKey, setHasKey] = useState<boolean>();
  const [prompt, setPrompt] = useState(shot.videoPrompt ?? '');
  const [matchAspect, setMatchAspect] = useState(true);
  const [assigned, setAssigned] = useState<Map<string, string>>(new Map());
  const [previsClip, setPrevisClip] = useState<Blob>();
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [draft, setDraft] = useState<{ blob: Blob; prompt: string; workflow: string; seconds?: number }>();
  const draftUrl = useObjectUrl(draft?.blob);
  const savedUrl = useBlobUrl(shot.video?.blob);

  useEffect(() => {
    dialog.current?.showModal();
    void getSetting<string>(COMFY_KEY_SETTING).then((k) => setHasKey(Boolean(k))).catch(() => setHasKey(false));
    void Promise.all([listWorkflows('video'), getSetting<string>(VIDEO_WORKFLOW_SETTING)]).then(([list, last]) => {
      setWorkflows(list);
      setWorkflowId(list.find((w) => w.id === last)?.id ?? list[0]?.id ?? '');
    }).catch(() => setWorkflows([]));
    return () => controller.current?.abort();
  }, []);

  const workflow = workflows?.find((w) => w.id === workflowId);
  const analysis = useMemo(() => workflow && analyzeWorkflow(workflow.graph), [workflow]);
  const options = useMemo(() => {
    const list = mediaOptions(project, shot, previsFrame);
    return list.map((o) => o.id === PREVIS_CLIP && previsClip ? { ...o, data: previsClip } : o);
  }, [project, shot, previsFrame, previsClip]);
  useEffect(() => { if (analysis) setAssigned(defaultAssignments(analysis.slots, options)); }, [analysis]); // eslint-disable-line react-hooks/exhaustive-deps
  const tags = useMemo(() => mediaTags(analysis?.slots ?? []), [analysis]);
  const inputs = (analysis?.slots ?? []).flatMap((slot) => {
    const option = options.find((o) => o.id === assigned.get(slotKey(slot)));
    return option ? [{ slot, option, tag: tags.get(slotKey(slot))! }] : [];
  });
  const generated = videoPrompt(project, shot, inputs, '');
  const full = videoPrompt(project, shot, inputs, prompt);
  const eff = effectiveShot(project, shot.id)!;
  const missing = analysis?.slots.filter((s) => !assigned.has(slotKey(s))) ?? [];

  const chooseWorkflow = (id: string) => {
    setWorkflowId(id);
    void setSetting(VIDEO_WORKFLOW_SETTING, id).catch(() => {});
  };
  const changePrompt = (value: string) => { setPrompt(value); dispatch(setShotVideoPrompt(shot.id, value)); };

  const generate = async () => {
    if (!workflow || !analysis || busy) return;
    const abort = new AbortController();
    controller.current = abort;
    setBusy(true); setError(''); setDraft(undefined);
    try {
      const key = await getSetting<string>(COMFY_KEY_SETTING);
      if (!key) { setHasKey(false); throw new Error('Add your Comfy Cloud API key in Settings first.'); }
      if (missing.length) throw new Error(`Choose media for ${missing.map((s) => s.title).join(', ')}.`);
      const media = new Map<string, AssetReference>();
      let clip = previsClip;
      for (const { slot, option } of inputs) {
        if (option.id === PREVIS_CLIP && !clip) {
          setStatus('Rendering previs clip…');
          clip = await renderPrevisClip(project, shot.id, abort.signal);
          setPrevisClip(clip);
        }
        const data = option.id === PREVIS_CLIP ? clip! : await optionData(option);
        setStatus(`Uploading ${option.label}…`);
        media.set(slotKey(slot), await uploadAsset(key, data, uniqueName(option, slot), abort.signal));
      }
      const graph = bindWorkflow(workflow.graph, analysis, {
        media, prompt: full, promptTarget: workflow.promptTarget, durationSec: eff.durationSec, seed: randomSeed(),
        aspect: matchAspect ? aspectOf(project) : undefined,
      });
      setStatus('Submitting…');
      const job = await submitJob(key, graph, abort.signal);
      const done = await waitForJob(key, job, { signal: abort.signal, onUpdate: (j) => setStatus(describeJob(j)) });
      const output = done.outputs.find((o) => o.type === 'video') ?? done.outputs.find((o) => o.content_type.startsWith('video/'));
      if (!output) throw new Error('The workflow finished without a video output. Check that it ends in a Save Video node.');
      setStatus('Downloading video…');
      const blob = await downloadOutput(key, output.id, abort.signal);
      if (!abort.signal.aborted) setDraft({ blob: new Blob([blob], { type: blob.type.startsWith('video/') ? blob.type : 'video/mp4' }), prompt: full, workflow: workflow.name, seconds: runSeconds(done) });
      setStatus('');
    } catch (e) {
      if (!abort.signal.aborted) { setError(e instanceof Error ? e.message : String(e)); setStatus(''); }
    } finally {
      if (controller.current === abort) { controller.current = null; setBusy(false); }
    }
  };
  const cancel = () => { controller.current?.abort(); controller.current = null; setBusy(false); setStatus('Canceled. Comfy Cloud was asked to stop the job.'); };

  const save = async () => {
    if (!draft || saving) return;
    setSaving(true); setError('');
    try {
      const blob = `shot-video-${newId()}`;
      await putBlob(blob, draft.blob);
      const store = useProjectStore.getState();
      if (store.project?.id !== project.id || !store.project.shots.some((s) => s.id === shot.id)) throw new Error('This shot is no longer open. Download the video to keep it.');
      store.dispatch(setShotVideo(shot.id, { blob, prompt: draft.prompt, additionalPrompt: prompt, workflow: draft.workflow, createdAt: Date.now() }));
      await store.flush();
      if (useProjectStore.getState().saving === 'error') throw new Error('Could not save the project. Download the video as a backup.');
      onClose();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setSaving(false); }
  };
  const download = async () => {
    try {
      const blob = draft?.blob ?? (shot.video ? await getBlob(shot.video.blob) : undefined);
      if (!blob) throw new Error('This video is missing from browser storage.');
      await saveFile(blob, `${safeFileName(`Shot ${shot.number}`)}.mp4`, 'video/mp4');
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };

  const shown = draftUrl ?? savedUrl;
  return <Overlay>
    <dialog ref={dialog} className="character-image-dialog shot-video-dialog" aria-labelledby="shot-video-title" onCancel={(e) => { e.preventDefault(); if (!saving) onClose(); }}>
      <header className="row gap image-editor-head">
        <div className="grow"><h2 id="shot-video-title">Shot {shot.number} · Video</h2><span className="small muted">ComfyUI Cloud</span></div>
        <button className="btn ghost" disabled={saving} onClick={onClose} autoFocus>Close</button>
      </header>
      <div className="image-editor-body">
        <div className="image-editor-preview">
          {shown ? <video src={shown} controls playsInline loop aria-label={`Video for shot ${shot.number}`} /> : <p className="muted">Your video will appear here.</p>}
        </div>
        <div className="image-editor-controls">
          {workflows && !workflows.length ? <>
            <p className="small">Import an image-to-video workflow (API format) under ComfyUI Cloud in Settings to generate shot videos.</p>
            <Link className="btn" to="/settings" onClick={onClose}>Open Settings</Link>
          </> : <label className="field"><span>Workflow</span>
            <select value={workflowId} disabled={busy} onChange={(e) => chooseWorkflow(e.target.value)}>{workflows?.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select>
          </label>}
          {analysis && <>
            {analysis.slots.length === 0 && <p className="small muted">This workflow has no Load Image, Load Audio or Load Video nodes, so it only receives the prompt.</p>}
            {analysis.slots.map((slot) => <SlotPicker key={slotKey(slot)} slot={slot} tag={tags.get(slotKey(slot))!} options={options.filter((o) => o.kind === slot.kind)} value={assigned.get(slotKey(slot)) ?? ''} disabled={busy}
              onChange={(id) => setAssigned((prev) => { const next = new Map(prev); if (id) next.set(slotKey(slot), id); else next.delete(slotKey(slot)); return next; })} />)}
            {!analysis.slots.some((s) => s.kind === 'video') && <p className="small muted">To send the previs clip as a camera-motion reference, add a Load Video node to the workflow and import it again.</p>}
            {analysis.sizes.length > 0 && <label className="row gap small"><input type="checkbox" checked={matchAspect} disabled={busy} onChange={(e) => setMatchAspect(e.target.checked)} /> Match the project's {project.aspect} aspect ratio</label>}
            <p className="small muted">Duration: {eff.durationSec.toFixed(1)} s (shot length){analysis.durations.length ? '' : ' · this workflow sets its own length'}.</p>
            <details className="generated-image-prompt"><summary>Generated prompt</summary><pre>{generated}</pre></details>
            <label className="field image-prompt-field"><span>Additional prompt</span><textarea rows={5} maxLength={32000} value={prompt} disabled={busy} onChange={(e) => changePrompt(e.target.value)} /></label>
            <p className="small muted">Cost estimate unavailable. Comfy Cloud bills by GPU run time on your plan{draft?.seconds ? `; this run took ${Math.round(draft.seconds)} s` : ''}. Partner nodes bill credits separately.</p>
          </>}
          {hasKey === false && <Link className="btn" to="/settings" onClick={onClose}>Add Comfy key in Settings</Link>}
          {error && <p className="error small" role="alert">{error}</p>}
          <p className="small muted" role="status">{busy ? status || 'Working…' : draft ? 'Preview ready. Use video to save it to this shot.' : status}</p>
          <button className="btn primary" disabled={busy || !analysis || hasKey === false || missing.length > 0} onClick={() => void generate()}>{busy ? 'Working…' : draft || shot.video ? 'Generate another video' : 'Generate video'}</button>
          {busy && <button className="btn" onClick={cancel}>Cancel job</button>}
          <div className="row gap">
            {draft && <button className="btn primary grow" disabled={busy || saving} onClick={() => void save()}>Use video</button>}
            {(draft || shot.video) && <button className="btn grow" disabled={busy} onClick={() => void download()}>Download</button>}
          </div>
        </div>
      </div>
    </dialog>
  </Overlay>;
}

function SlotPicker({ slot, tag, options, value, disabled, onChange }: { slot: MediaSlot; tag: string; options: MediaOption[]; value: string; disabled: boolean; onChange: (id: string) => void }) {
  const option = options.find((o) => o.id === value);
  return <div className="video-slot">
    <label className="field"><span>{tag.slice(1, -1)} · {slot.title} #{slot.nodeId}</span>
      <select value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
        <option value="">Choose {slot.kind}…</option>
        {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
      </select>
    </label>
    {option && <MediaPreview option={option} />}
    {!options.length && <p className="small muted">No {slot.kind} in this shot yet{slot.kind === 'audio' ? '. Generate dialogue voices first' : ''}.</p>}
  </div>;
}

function MediaPreview({ option }: { option: MediaOption }) {
  const stored = useBlobUrl(option.blobKey);
  const local = useObjectUrl(option.data);
  const src = local ?? stored;
  if (option.id === PREVIS_CLIP && !src) return <p className="small muted">Rendered from the previs when you generate.</p>;
  if (!src) return null;
  return option.kind === 'image' ? <img className="video-slot-media" src={src} alt={option.label} />
    : option.kind === 'audio' ? <audio src={src} controls /> : <video className="video-slot-media" src={src} controls muted playsInline />;
}

function useObjectUrl(blob?: Blob): string | undefined {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    if (!blob) { setUrl(undefined); return; }
    const next = URL.createObjectURL(blob);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [blob]);
  return url;
}

function uniqueName(option: MediaOption, slot: MediaSlot): string {
  const [base, ext] = option.fileName.split('.');
  return `${base}-${slot.nodeId.replace(/\W/g, '_')}.${ext}`;
}

function describeJob(job: ComfyJob): string {
  if (job.status === 'queued') return job.queue_position != null ? `Queued (position ${job.queue_position})…` : 'Queued…';
  if (job.status === 'canceling') return 'Canceling…';
  const pct = job.progress ? ` ${Math.round(job.progress.value * 100)}%` : '';
  return `Generating${pct}${job.progress?.message ? ` · ${job.progress.message}` : ''}… This can take several minutes. Keep this page open.`;
}
