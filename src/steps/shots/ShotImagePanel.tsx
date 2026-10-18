import { useEffect, useRef, useState } from 'react';
import type { Project, Shot } from '../../state/schema';
import { useProjectStore } from '../../state/store';
import { setShotImagePrompt } from '../../shots/commands';
import { aspectOf } from '../../shots/setup';
import { ConceptImageEditor } from '../../images/ConceptImageEditor';
import { useBlobUrl } from '../../images/useBlobUrl';
import { shotImagePrompt, shotReferences, type ShotCapture, type ShotReference } from '../../images/shotImages';
import { ShotVideoEditor } from '../../video/ShotVideoEditor';
import { LetteringEditor } from '../../comic/LetteringEditor';
import { getBlob } from '../../storage/db';

type Bundle = {kind:'image'|'video'; capture:ShotCapture; references:ShotReference[]; project:Project; shot:Shot};
export function ShotImagePanel({ project, shot, capture }: {project:Project;shot:Shot;capture: (() => Promise<ShotCapture>) | null}) {
  const dispatch = useProjectStore((s) => s.dispatch);
  const [bundle, setBundle] = useState<Bundle>();
  const [busy, setBusy] = useState<'image'|'video'|'lettering'>();
  const [lettering, setLettering] = useState<{art:Blob;label:string}>();
  const [error, setError] = useState('');
  const mounted = useRef(true);
  const video = useBlobUrl(shot.video?.blob);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const prepare = async (kind: 'image'|'video') => {
    if (!capture || busy) return;
    setBusy(kind); setError('');
    try {
      const frame = await capture();
      const references = kind === 'image' ? await shotReferences(project, shot, frame.characterIds) : [];
      if (mounted.current) setBundle({kind,capture:frame,references,project,shot});
    } catch (e) { if (mounted.current) setError(e instanceof Error ? e.message : String(e)); }
    finally { if (mounted.current) setBusy(undefined); }
  };
  // Lettering goes on the shot image, or on the previs frame until there is one.
  const openLettering = async () => {
    if (busy) return;
    setBusy('lettering'); setError('');
    try {
      const saved = shot.image ? await getBlob(shot.image.blob) : undefined;
      if (shot.image && !saved) throw new Error('The shot image is missing from this browser.');
      if (!saved && !capture) throw new Error('The shot view is not ready yet.');
      const art = saved ?? (await capture!()).blob;
      if (mounted.current) setLettering({art,label:saved ? 'shot image' : 'previs frame'});
    } catch (e) { if (mounted.current) setError(e instanceof Error ? e.message : String(e)); }
    finally { if (mounted.current) setBusy(undefined); }
  };
  const letterCount = shot.lettering?.length ?? 0;
  const changePrompt = (value:string) => dispatch(setShotImagePrompt(shot.id,value));
  return <div className="inspector shot-image-panel">
    <button className="btn primary" disabled={!capture || Boolean(busy)} onClick={() => void prepare('image')}>{busy === 'image' ? 'Preparing references…' : 'Generate Shot Image'}</button>
    <button className="btn" disabled={!capture || Boolean(busy)} onClick={() => void prepare('video')}>{busy === 'video' ? 'Preparing…' : 'Generate Shot Video'}</button>
    <button className="btn" disabled={(!capture && !shot.image) || Boolean(busy)} onClick={() => void openLettering()}>{busy === 'lettering' ? 'Opening…' : letterCount ? `Edit Lettering (${letterCount})` : 'Add Lettering'}</button>
    {video && <video className="shot-video-inline" src={video} controls playsInline aria-label={`Video for shot ${shot.number}`} />}
    {error && <p className="error small" role="alert">{error}</p>}
    {bundle?.kind === 'image' && <ConceptImageEditor subject={{id:shot.id,name:`Shot ${shot.number}`,image:shot.image}} kind="shot" defaultPrompt={shot.imagePrompt ?? ''} reference={bundle.capture.blob} references={bundle.references} imageContext={{frameProgress:bundle.capture.progress,aspect:aspectOf(bundle.project)}} buildPrompt={(extra) => shotImagePrompt(bundle.project,bundle.shot,bundle.capture,bundle.references,extra)} onPromptChange={changePrompt} onClose={() => setBundle(undefined)} />}
    {lettering && <LetteringEditor shot={shot} art={lettering.art} artLabel={lettering.label} onClose={() => setLettering(undefined)} />}
    {bundle?.kind === 'video' && <ShotVideoEditor project={bundle.project} shot={shot} previsFrame={{blob:bundle.capture.blob,characterIds:bundle.capture.characterIds}} onClose={() => setBundle(undefined)} />}
  </div>;
}
