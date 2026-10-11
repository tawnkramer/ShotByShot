import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { useProjectStore } from '../../state/store';
import type { CameraState, Transform } from '../../state/schema';
import { aspectOf, captionsOf, effectiveShot } from '../../shots/setup';
import { captionAt, keyOf } from '../../shots/timing';
import { setActorKey, setCamera, setDuration, setShotPropKey, setStageOverride } from '../../shots/commands';
import { ShotRig, type RigId } from '../../three/shotRig';
import { ShotCanvas } from './ShotCanvas';
import { CameraPad } from './CameraPad';
import { Timeline } from './Timeline';
import { BlockingPanel } from './BlockingPanel';
import { CameraPanel } from './CameraPanel';
import { AudioPanel } from '../common/AudioPanel';
import { audioContext, DialoguePlayer, loadBuffer } from '../../audio/player';

type Mode = 'blocking' | 'camera';

export function ShotEditor({ shotId }: { shotId: string }) {
  const project = useProjectStore((s) => s.project)!;
  const dispatch = useProjectStore((s) => s.dispatch);
  const shot = project.shots.find((s) => s.id === shotId)!;
  const eff = effectiveShot(project, shotId)!;
  const aspect = aspectOf(project);
  const rig = useMemo(() => new ShotRig(), []);
  useEffect(() => () => rig.dispose(), [rig]);

  const [mode, setMode] = useState<Mode>('blocking');
  const [view, setView] = useState<'shot' | 'free'>('shot');
  const [editKey, setEditKey] = useState<'start' | 'end'>('start');
  const [playing, setPlaying] = useState(false);
  const [u, setU] = useState(0);
  const timeRef = useRef(0);
  const [timeVersion, setTimeVersion] = useState(0);
  const [selected, setSelected] = useState<RigId | null>(null);
  const [gizmo, setGizmo] = useState<'translate' | 'rotate'>('translate');
  const [liveCamera, setLiveCamera] = useState<CameraState | null>(null);

  const seek = (next: number) => {
    timeRef.current = next;
    setU(next);
    setTimeVersion((v) => v + 1);
  };
  const goToKey = (k: 'start' | 'end') => {
    setEditKey(k);
    setPlaying(false);
    seek(k === 'start' ? 0 : 1);
  };

  const camMoving = eff.camera.mode === 'moving';
  const camKey = camMoving ? editKey : 'start';
  const keyCamera = keyOf(eff.camera, camKey);
  const shownCamera = liveCamera ?? keyCamera;

  const captions = useMemo(() => captionsOf(project, shot, eff.durationSec), [project, shot, eff.durationSec]);
  const caption = captionAt(captions, u * eff.durationSec);

  // Dialogue audio follows play/pause; clips are decoded ahead so playback starts promptly.
  const player = useMemo(() => new DialoguePlayer(), []);
  const cues = useMemo(() => captions.flatMap((c) => (c.audioBlob ? [{ blob: c.audioBlob, at: c.inSec }] : [])), [captions]);
  useEffect(() => {
    for (const c of cues) void loadBuffer(c.blob);
  }, [cues]);
  useEffect(() => {
    if (playing) void player.start(cues, timeRef.current * eff.durationSec);
    else player.stop();
  }, [playing]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => player.stop(), [player]);

  const onGizmoEnd = (id: RigId, obj: THREE.Object3D) => {
    // Edits apply to the keyframe being edited; show that moment.
    seek(editKey === 'start' ? 0 : 1);
    const position = obj.position.toArray().map((v) => Math.round(v * 1000) / 1000) as [number, number, number];
    const yaw = Math.round(THREE.MathUtils.radToDeg(new THREE.Euler().setFromQuaternion(obj.quaternion, 'YXZ').y) * 10) / 10;
    if (id.startsWith('actor:')) dispatch(setActorKey(shotId, id.slice(6), editKey, { position: [position[0], 0, position[2]], yaw }));
    else if (id.startsWith('prop:')) dispatch(setShotPropKey(shotId, id.slice(5), editKey, { position, yaw }));
    else if (id.startsWith('stage:')) {
      dispatch(setStageOverride(shotId, id.slice(6), { position, rotation: obj.quaternion.toArray() as Transform['rotation'], scale: obj.scale.toArray() as Transform['scale'] }));
    }
  };

  const blocking = mode === 'blocking';
  const useShotView = !blocking || view === 'shot' || playing;

  return (
    <div className="shot-editor">
      <div className="frame-wrap">
        <div className="frame" style={{ aspectRatio: String(aspect), width: `min(100%, calc(40dvh * ${aspect}))` }}>
          <ShotCanvas
            project={project}
            shotId={shotId}
            rig={rig}
            aspect={aspect}
            timeRef={timeRef}
            timeVersion={timeVersion}
            playing={playing}
            durationSec={eff.durationSec}
            onTick={setU}
            onEnded={() => setPlaying(false)}
            view={useShotView ? 'shot' : 'free'}
            liveCamera={liveCamera}
            selectable={blocking && !playing}
            selected={blocking ? selected : null}
            onSelect={setSelected}
            gizmo={gizmo}
            onGizmoEnd={onGizmoEnd}
          />
          {!blocking && !playing && (
            <CameraPad
              base={keyCamera}
              aspect={aspect}
              onLive={(s) => {
                if (timeRef.current !== (camKey === 'start' ? 0 : 1)) seek(camKey === 'start' ? 0 : 1);
                setLiveCamera(s);
              }}
              onCommit={(s) => {
                dispatch(setCamera(shotId, camKey, s));
                setLiveCamera(null);
              }}
            />
          )}
          {caption && (
            <div className="caption">
              {caption.speaker && <span className="caption-speaker">{caption.speaker}</span>}
              <span>{caption.text}</span>
            </div>
          )}
          <div className="frame-badges">
            <span className="badge">{shot.number}</span>
            {!playing && (blocking || camMoving) && <span className="badge key">{editKey === 'start' ? 'Start' : 'End'}</span>}
          </div>
          {blocking && !playing && (
            <div className="frame-tools">
              <button className="btn small-btn" onClick={() => setView((v) => (v === 'shot' ? 'free' : 'shot'))}>
                {view === 'shot' ? 'Free view' : 'Shot view'}
              </button>
              {selected && (
                <div className="segmented compact">
                  <button className={gizmo === 'translate' ? 'on' : ''} onClick={() => setGizmo('translate')}>
                    Move
                  </button>
                  <button className={gizmo === 'rotate' ? 'on' : ''} onClick={() => setGizmo('rotate')}>
                    Turn
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <Timeline
        u={u}
        durationSec={eff.durationSec}
        locked={!!shot.durationLocked}
        playing={playing}
        editKey={editKey}
        showKeys={blocking || camMoving}
        onPlay={() => {
          if (playing) return setPlaying(false);
          audioContext(); // unlock audio during the tap (iOS)
          if (timeRef.current >= 1) seek(0);
          setPlaying(true);
        }}
        onScrub={(v) => {
          setPlaying(false);
          seek(v);
        }}
        onKey={goToKey}
        onDuration={(sec) => dispatch(setDuration(shotId, sec))}
      />

      <div className="mode-tabs segmented" role="tablist">
        <button role="tab" aria-selected={blocking} className={blocking ? 'on' : ''} onClick={() => setMode('blocking')}>
          Blocking
        </button>
        <button
          role="tab"
          aria-selected={!blocking}
          className={!blocking ? 'on' : ''}
          onClick={() => {
            setMode('camera');
            setPlaying(false);
            seek(camKey === 'start' ? 0 : 1);
          }}
        >
          Camera
        </button>
      </div>

      <div className="split-panel">
        <AudioPanel project={project} lineIds={shot.lineIds} compact />
        {blocking ? (
          <BlockingPanel project={project} shot={shot} eff={eff} editKey={editKey} selected={selected} onSelect={setSelected} />
        ) : (
          <CameraPanel project={project} shot={shot} eff={eff} editKey={editKey} current={shownCamera} />
        )}
      </div>
    </div>
  );
}
