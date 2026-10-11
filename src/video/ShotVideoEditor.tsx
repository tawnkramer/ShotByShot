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
import { VideoPreview } from '../images/ImagePreview';
import { COMFY_KEY_SETTING } from '../comfy/client';
import { runWorkflow, type RunInput } from '../comfy/run';
import { listWorkflows, type ComfyWorkflow } from '../comfy/settings';
import { analyzeWorkflow, bindWorkflow, boundDuration, groupKey, slotKey, type MediaKind, type MediaSlot, type ReferenceGroup, type WorkflowAnalysis } from '../comfy/workflow';
import { estimateWorkflowCost, formatCost } from '../comfy/cost';
import { OPENART_TOKEN_SETTING } from '../openart/auth';
import { OPENART_DURATION, OPENART_LIMITS, OPENART_RESOLUTIONS, OPENART_VIDEO_MODELS, openArtVideoCost, runOpenArtVideo, type OpenArtResolution } from '../openart/video';
import { defaultAssignments, defaultReferences, mediaOptions, referenceTags, optionData, PREVIS_CLIP, renderPrevisClip, videoPrompt, type MediaOption } from './shotVideo';

export const VIDEO_WORKFLOW_SETTING = 'comfy.videoWorkflow';
const OPENART_PREFIX = 'openart:';

/** Seedance on OpenArt takes lists of image, video and audio references, a whole-second duration and an aspect ratio. */
const OPENART_ANALYSIS: WorkflowAnalysis = {
  slots: [], prompts: [], seeds: [], sizes: [], outputs: ['video'],
  groups: (['image', 'video', 'audio'] as const).map((kind) => ({ nodeId: 'openart', kind, prefix: kind, max: OPENART_LIMITS[kind], title: 'Seedance' })),
  durations: [{ nodeId: 'openart', input: 'duration', ...OPENART_DURATION, integer: true }],
  ratios: [{ nodeId: 'openart', input: 'aspectRatio' }],
};

export function ShotVideoEditor({ project, shot, previsFrame, onClose }: { project: Project; shot: Shot; previsFrame?: { blob: Blob; characterIds: string[] }; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const controller = useRef<AbortController | null>(null);
  const dispatch = useProjectStore((s) => s.dispatch);
  const [workflows, setWorkflows] = useState<ComfyWorkflow[]>();
  const [workflowId, setWorkflowId] = useState('');
  const [hasKey, setHasKey] = useState<boolean>();
  const [openArt, setOpenArt] = useState(false);
  const [resolution, setResolution] = useState<OpenArtResolution>('720p');
  const [generateAudio, setGenerateAudio] = useState(true);
  const [openArtCost, setOpenArtCost] = useState<{ credits: number; balance?: number; affordable?: boolean } | null>();
  const [prompt, setPrompt] = useState(shot.videoPrompt ?? '');
  const [matchAspect, setMatchAspect] = useState(true);
  const [assigned, setAssigned] = useState<Map<string, string>>(new Map());
  const [references, setReferences] = useState<Map<string, string[]>>(new Map());
  const [previsClip, setPrevisClip] = useState<Blob>();
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [draft, setDraft] = useState<{ blob: Blob; prompt: string; workflow: string; seconds?: number; credits?: number }>();
  const draftUrl = useObjectUrl(draft?.blob);
  const [fullScreen, setFullScreen] = useState(false);

  useEffect(() => {
    dialog.current?.showModal();
    void getSetting<string>(COMFY_KEY_SETTING).then((k) => setHasKey(Boolean(k))).catch(() => setHasKey(false));
    void Promise.all([listWorkflows('video', true), getSetting<string>(VIDEO_WORKFLOW_SETTING), getSetting(OPENART_TOKEN_SETTING).catch(() => undefined)]).then(([list, last, token]) => {
      setWorkflows(list);
      setOpenArt(Boolean(token));
      const openArtLast = token && OPENART_VIDEO_MODELS.some((m) => `${OPENART_PREFIX}${m.id}` === last) ? last : undefined;
      setWorkflowId(openArtLast ?? list.find((w) => w.id === last)?.id ?? list[0]?.id ?? (token ? `${OPENART_PREFIX}${OPENART_VIDEO_MODELS[0].id}` : ''));
    }).catch(() => setWorkflows([]));
    return () => controller.current?.abort();
  }, []);

  const openArtModel = OPENART_VIDEO_MODELS.find((m) => `${OPENART_PREFIX}${m.id}` === workflowId);
  const workflow = workflows?.find((w) => w.id === workflowId);
  const analysis = useMemo(() => openArtModel ? OPENART_ANALYSIS : workflow && analyzeWorkflow(workflow.graph), [workflow, openArtModel]);
  const options = useMemo(() => {
    const list = mediaOptions(project, shot, previsFrame);
    return list.map((o) => o.id === PREVIS_CLIP && previsClip ? { ...o, data: previsClip } : o);
  }, [project, shot, previsFrame, previsClip]);
  const eff = effectiveShot(project, shot.id)!;
  useEffect(() => {
    if (!analysis) return;
    setAssigned(defaultAssignments(analysis.slots, options));
    setReferences(defaultReferences(analysis.groups, options, eff.durationSec));
  }, [analysis]); // eslint-disable-line react-hooks/exhaustive-deps
  // Fixed inputs first, then each reference list, in the order they're submitted.
  const placements: { kind: MediaKind; optionId?: string; slot?: MediaSlot; group?: ReferenceGroup }[] = [
    ...(analysis?.slots ?? []).map((slot) => ({ kind: slot.kind, optionId: assigned.get(slotKey(slot)), slot })),
    ...(analysis?.groups ?? []).flatMap((group) => (references.get(groupKey(group)) ?? []).map((optionId) => ({ kind: group.kind, optionId, group }))),
  ];
  const tagList = referenceTags(placements.map((p) => p.kind), analysis?.groups.length ? 'reference' : 'picture');
  const inputs = placements.flatMap((p, i) => {
    const option = options.find((o) => o.id === p.optionId);
    return option ? [{ ...p, option, tag: tagList[i] }] : [];
  });
  const slotTag = (slot: MediaSlot) => tagList[placements.findIndex((p) => p.slot === slot)];
  const generated = videoPrompt(project, shot, inputs, '');
  const full = videoPrompt(project, shot, inputs, prompt);
  const durationTarget = analysis?.durations[0];
  const runSecondsFor = durationTarget ? boundDuration(durationTarget, eff.durationSec) : undefined;
  const estimate = useMemo(() => {
    if (!workflow || !analysis || openArtModel) return undefined;
    try {
      return estimateWorkflowCost(bindWorkflow(workflow.graph, analysis, {
        media: new Map(analysis.slots.map((s) => [slotKey(s), 'estimate'])),
        references: new Map(analysis.groups.map((g) => [groupKey(g), references.get(groupKey(g)) ?? []])),
        durationSec: eff.durationSec, aspect: matchAspect ? aspectOf(project) : undefined,
      }));
    } catch { return undefined; }
  }, [workflow, analysis, references, eff.durationSec, matchAspect, project, openArtModel]);
  useEffect(() => {
    if (!openArtModel) return;
    let live = true;
    setOpenArtCost(undefined);
    void openArtVideoCost(openArtModel.id, eff.durationSec, resolution, generateAudio, matchAspect ? aspectOf(project) : undefined)
      .then((c) => { if (live) setOpenArtCost(c ?? null); }, () => { if (live) setOpenArtCost(null); });
    return () => { live = false; };
  }, [openArtModel, eff.durationSec, resolution, generateAudio, matchAspect, project]);
  const missing = analysis?.slots.filter((s) => !assigned.has(slotKey(s))) ?? [];
  // Seedance needs at least one visual reference.
  const needsReference = Boolean(analysis?.groups.length && !analysis.slots.length && !inputs.some((i) => i.group && i.kind !== 'audio'));

  const chooseWorkflow = (id: string) => {
    setWorkflowId(id);
    void setSetting(VIDEO_WORKFLOW_SETTING, id).catch(() => {});
  };
  const changePrompt = (value: string) => { setPrompt(value); dispatch(setShotVideoPrompt(shot.id, value)); };

  const generate = async () => {
    if ((!workflow && !openArtModel) || !analysis || busy) return;
    const abort = new AbortController();
    controller.current = abort;
    setBusy(true); setError(''); setDraft(undefined);
    try {
      const key = openArtModel ? undefined : await getSetting<string>(COMFY_KEY_SETTING);
      if (!openArtModel && !key) { setHasKey(false); throw new Error('Add your Comfy Cloud API key in Settings first.'); }
      if (missing.length) throw new Error(`Choose media for ${missing.map((s) => s.title).join(', ')}.`);
      if (needsReference) throw new Error('Choose at least one reference image or video.');
      const files: RunInput[] = [];
      let clip = previsClip;
      for (const [i, { slot, group, option }] of inputs.entries()) {
        if (option.id === PREVIS_CLIP && !clip) {
          setStatus('Rendering previs clip…');
          clip = await renderPrevisClip(project, shot.id, abort.signal);
          setPrevisClip(clip);
        }
        files.push({ slot, group, label: option.label, fileName: uniqueName(option, i), data: option.id === PREVIS_CLIP ? clip! : await optionData(option) });
      }
      const aspect = matchAspect ? aspectOf(project) : undefined;
      if (openArtModel) {
        const { blob, credits } = await runOpenArtVideo({
          model: openArtModel.id, inputs: inputs.map(({ kind, tag }, i) => ({ kind, label: tag, fileName: files[i].fileName, data: files[i].data })),
          prompt: full, durationSec: eff.durationSec, aspect, resolution, generateAudio, signal: abort.signal, onStatus: setStatus,
        });
        if (!abort.signal.aborted) { setDraft({ blob, prompt: full, workflow: `OpenArt · ${openArtModel.name}`, credits }); setFullScreen(true); }
      } else {
        const { blob, seconds } = await runWorkflow({ key: key!, workflow: workflow!, inputs: files, prompt: full, durationSec: eff.durationSec, aspect, output: 'video', signal: abort.signal, onStatus: setStatus });
        if (!abort.signal.aborted) { setDraft({ blob: new Blob([blob], { type: blob.type.startsWith('video/') ? blob.type : 'video/mp4' }), prompt: full, workflow: workflow!.name, seconds }); setFullScreen(true); }
      }
      setStatus('');
    } catch (e) {
      if (!abort.signal.aborted) { setError(e instanceof Error ? e.message : String(e)); setStatus(''); }
    } finally {
      if (controller.current === abort) { controller.current = null; setBusy(false); }
    }
  };
  const cancel = () => {
    controller.current?.abort(); controller.current = null; setBusy(false);
    setStatus(openArtModel ? 'Stopped waiting. OpenArt may still finish the video; it will be in your OpenArt history.' : 'Canceled. Comfy Cloud was asked to stop the job.');
  };

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

  return <Overlay>
    <dialog ref={dialog} className="character-image-dialog shot-video-dialog" aria-labelledby="shot-video-title" onCancel={(e) => { e.preventDefault(); if (!saving) onClose(); }}>
      <header className="row gap image-editor-head">
        <div className="grow"><h2 id="shot-video-title">Shot {shot.number} · Video</h2><span className="small muted">{openArtModel ? 'OpenArt' : 'ComfyUI Cloud'}</span></div>
        <button className="btn ghost" disabled={saving} onClick={onClose} autoFocus>Close</button>
      </header>
      <div className="image-editor-body">
        <div className="image-editor-controls">
          {workflows && !workflows.length && !openArt ? <>
            <p className="small">Import an image-to-video workflow (API format) under ComfyUI Cloud in Settings to generate shot videos.</p>
            <Link className="btn" to="/settings" onClick={onClose}>Open Settings</Link>
          </> : <label className="field"><span>Workflow</span>
            <select value={workflowId} disabled={busy} onChange={(e) => chooseWorkflow(e.target.value)}>
              {openArt ? <>
                <optgroup label="ComfyUI Cloud">{workflows?.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</optgroup>
                <optgroup label="OpenArt (your credits)">{OPENART_VIDEO_MODELS.map((m) => <option key={m.id} value={`${OPENART_PREFIX}${m.id}`}>{m.name}</option>)}</optgroup>
              </> : workflows?.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </label>}
          {analysis && <>
            {analysis.slots.length === 0 && analysis.groups.length === 0 && <p className="small muted">This workflow has no Load Image, Load Audio or Load Video nodes, so it only receives the prompt.</p>}
            {analysis.slots.map((slot) => <SlotPicker key={slotKey(slot)} slot={slot} tag={slotTag(slot)} options={options.filter((o) => o.kind === slot.kind)} value={assigned.get(slotKey(slot)) ?? ''} disabled={busy}
              onChange={(id) => setAssigned((prev) => { const next = new Map(prev); if (id) next.set(slotKey(slot), id); else next.delete(slotKey(slot)); return next; })} />)}
            {analysis.groups.map((group) => <ReferencePicker key={groupKey(group)} group={group} options={options.filter((o) => o.kind === group.kind)} chosen={references.get(groupKey(group)) ?? []} disabled={busy}
              onChange={(ids) => setReferences((prev) => new Map(prev).set(groupKey(group), ids))} />)}
            {needsReference && <p className="small error">Choose at least one reference image or video.</p>}
            {openArtModel && <div className="row gap small">
              <label className="field grow"><span>Resolution</span>
                <select value={resolution} disabled={busy} onChange={(e) => setResolution(e.target.value as OpenArtResolution)}>{OPENART_RESOLUTIONS.map((r) => <option key={r}>{r}</option>)}</select>
              </label>
              <label className="row gap"><input type="checkbox" checked={generateAudio} disabled={busy} onChange={(e) => setGenerateAudio(e.target.checked)} /> Generate audio</label>
            </div>}
            {![...analysis.slots, ...analysis.groups].some((s) => s.kind === 'video') && <p className="small muted">To send the previs clip as a camera-motion reference, add a Load Video node to the workflow and import it again.</p>}
            {analysis.sizes.length + analysis.ratios.length > 0 && <label className="row gap small"><input type="checkbox" checked={matchAspect} disabled={busy} onChange={(e) => setMatchAspect(e.target.checked)} /> Match the project's {project.aspect} aspect ratio</label>}
            <p className="small muted">{!durationTarget ? `Shot length ${eff.durationSec.toFixed(1)} s · this workflow sets its own length.`
              : Math.abs((runSecondsFor ?? 0) - eff.durationSec) < 0.05 ? `Duration: ${eff.durationSec.toFixed(1)} s (shot length).`
              : `Duration: ${runSecondsFor} s. The shot is ${eff.durationSec.toFixed(1)} s; this workflow takes ${durationTarget.integer ? 'whole seconds' : 'its own range'}${durationTarget.min !== undefined ? `, ${durationTarget.min}–${durationTarget.max} s` : ''}. Trim in your editor.`}</p>
            <details className="generated-image-prompt"><summary>Generated prompt</summary><pre>{generated}</pre></details>
            <label className="field image-prompt-field"><span>Additional prompt</span><textarea rows={5} maxLength={32000} value={prompt} disabled={busy} onChange={(e) => changePrompt(e.target.value)} /></label>
            {openArtModel ? <div className="small" aria-live="polite">
              <strong>{openArtCost ? `Cost: ${openArtCost.credits} OpenArt credits` : openArtCost === null ? 'Cost unavailable' : 'Checking cost…'}</strong>
              <p className="muted">{openArtCost?.balance !== undefined ? `Your balance: ${openArtCost.balance} credits${openArtCost.affordable === false ? '. Not enough for this video' : ''}. ` : ''}Quoted by OpenArt for these settings.{draft?.credits !== undefined ? ` This run used ${draft.credits} credits.` : ''}</p>
            </div> : <div className="small" aria-live="polite">
              <strong>{estimate ? `Estimated cost: ${formatCost(estimate)}` : 'Cost estimate unavailable'}</strong>
              <p className="muted">{estimate ? 'Partner-node price in Comfy credits, from ComfyUI\'s published rates. Approximate, not a guaranteed charge.' : 'Comfy Cloud bills GPU run time on your plan.'}{draft?.seconds ? ` This run took ${Math.round(draft.seconds)} s.` : ''}</p>
            </div>}
          </>}
          {hasKey === false && !openArtModel && <Link className="btn" to="/settings" onClick={onClose}>Add Comfy key in Settings</Link>}
          {error && <p className="error small" role="alert">{error}</p>}
          <p className="small muted" role="status">{busy ? status || 'Working…' : draft ? 'Preview ready. Use video to save it to this shot.' : status}</p>
          <button className="btn primary" disabled={busy || !analysis || (hasKey === false && !openArtModel) || missing.length > 0 || needsReference} onClick={() => void generate()}>{busy ? 'Working…' : draft || shot.video ? 'Generate another video' : 'Generate video'}</button>
          {busy && <button className="btn" onClick={cancel}>Cancel job</button>}
          <div className="row gap">
            {draft && <button className="btn primary grow" disabled={busy || saving} onClick={() => void save()}>Use video</button>}
            {(draft || shot.video) && <button className="btn grow" disabled={busy} onClick={() => void download()}>Download</button>}
            {draftUrl && <button className="btn grow" onClick={() => setFullScreen(true)}>Play preview</button>}
          </div>
        </div>
      </div>
    </dialog>
    {fullScreen && draftUrl && <VideoPreview src={draftUrl} label={`Shot ${shot.number} video`} fileName={`Shot ${shot.number}`} onClose={() => setFullScreen(false)}
      draft={{ onUse: () => { setFullScreen(false); void save(); }, onDiscard: () => { setFullScreen(false); setDraft(undefined); } }} />}
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

function uniqueName(option: MediaOption, index: number): string {
  const [base, ext] = option.fileName.split('.');
  return `${base}-${index + 1}.${ext}`;
}

function ReferencePicker({ group, options, chosen, disabled, onChange }: { group: ReferenceGroup; options: MediaOption[]; chosen: string[]; disabled: boolean; onChange: (ids: string[]) => void }) {
  const noun = group.kind === 'audio' ? 'audio' : `${group.kind}s`;
  return <fieldset className="video-group">
    <legend className="small">Reference {noun} · {chosen.length} of up to {group.max}</legend>
    {options.map((o) => {
      const on = chosen.includes(o.id);
      return <label key={o.id} className="video-group-item">
        <input type="checkbox" checked={on} disabled={disabled || (!on && chosen.length >= group.max)}
          onChange={() => onChange(on ? chosen.filter((id) => id !== o.id) : options.map((x) => x.id).filter((id) => id === o.id || chosen.includes(id)))} />
        <span className="grow">{o.label}</span>
        {on && <MediaPreview option={o} />}
      </label>;
    })}
    {!options.length && <p className="small muted">No {noun} in this shot yet{group.kind === 'audio' ? '. Generate dialogue voices first' : ''}.</p>}
  </fieldset>;
}
