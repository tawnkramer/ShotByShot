import { useEffect, useRef, useState } from 'react';
import type { Project, Shot } from '../../state/schema';
import { useProjectStore } from '../../state/store';
import { setShotImagePrompt } from '../../shots/commands';
import { aspectOf } from '../../shots/setup';
import { ConceptImageEditor } from '../../images/ConceptImageEditor';
import { shotImagePrompt, shotReferences, type ShotCapture, type ShotReference } from '../../images/shotImages';

type Bundle = {capture:ShotCapture; references:ShotReference[]; project:Project; shot:Shot};
export function ShotImagePanel({ project, shot, capture }: {project:Project;shot:Shot;capture: (() => Promise<ShotCapture>) | null}) {
  const dispatch = useProjectStore((s) => s.dispatch);
  const [bundle, setBundle] = useState<Bundle>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const prepare = async () => {
    if (!capture || busy) return;
    setBusy(true); setError('');
    try {
      const frame = await capture();
      const references = await shotReferences(project, shot, frame.characterIds);
      if (mounted.current) setBundle({capture:frame,references,project,shot});
    } catch (e) { if (mounted.current) setError(e instanceof Error ? e.message : String(e)); }
    finally { if (mounted.current) setBusy(false); }
  };
  const changePrompt = (value:string) => dispatch(setShotImagePrompt(shot.id,value));
  return <div className="inspector shot-image-panel">
    <button className="btn primary" disabled={!capture || busy} onClick={() => void prepare()}>{busy ? 'Preparing references…' : 'Generate Shot Image'}</button>
    {error && <p className="error small" role="alert">{error}</p>}
    {bundle && <ConceptImageEditor subject={{id:shot.id,name:`Shot ${shot.number}`,image:shot.image}} kind="shot" defaultPrompt={shot.imagePrompt ?? ''} reference={bundle.capture.blob} references={bundle.references} imageContext={{frameProgress:bundle.capture.progress,aspect:aspectOf(bundle.project)}} buildPrompt={(extra) => shotImagePrompt(bundle.project,bundle.shot,bundle.capture,bundle.references,extra)} onPromptChange={changePrompt} onClose={() => setBundle(undefined)} />}
  </div>;
}
