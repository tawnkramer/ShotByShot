import { ZoomableImage } from '../../images/ImagePreview';
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { Canvas } from '@react-three/fiber';
import { Grid, OrbitControls } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import type { Prop } from '../../state/schema';
import { useProjectStore } from '../../state/store';
import { deleteProp, updateProp, type PropPatch } from '../../props/commands';
import { placeProp } from '../../staging/commands';
import { freeSpot } from '../../staging/placement';
import { isParamSource, paramDefFor, resolveParams } from '../../three/library';
import { buildSource } from '../../three/assets';
import { applyGrey, disposeObject } from '../../three/materials';
import { buildMannequin } from '../../three/mannequin';
import { round } from '../../staging/commands';
import { Slider } from '../staging/fields';

import { ConceptImageEditor } from '../../images/ConceptImageEditor';
import { PreviewCapture, type CaptureReady } from '../../images/PreviewCapture';
import { propImagePrompt } from '../../images/generate';
import { useBlobUrl } from '../../images/useBlobUrl';

export function PropEditor({ prop: p, onBack }: { prop: Prop; onBack: () => void }) {
  const project = useProjectStore((s) => s.project)!;
  const dispatch = useProjectStore((s) => s.dispatch);
  const [person, setPerson] = useState(false);
  const [size, setSize] = useState<THREE.Vector3 | null>(null);
  const [placed, setPlaced] = useState<string | null>(null);
  const capture = useRef<(() => Promise<Blob>) | null>(null);
  const onCaptureReady = useCallback<CaptureReady>((fn) => { capture.current = fn; setReady(Boolean(fn)); }, []);
  const [ready, setReady] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [reference, setReference] = useState<Blob>();
  const [error, setError] = useState('');
  const [showImage, setShowImage] = useState(true);
  const artwork = useBlobUrl(p.image?.blob);
  const showingImage = showImage && Boolean(artwork);
  useEffect(() => { setShowImage(true); }, [p.id, p.image?.blob]);
  const openImage = async () => {
    if (!capture.current || capturing) return;
    setCapturing(true); setError('');
    try { setReference(await capture.current()); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setCapturing(false); }
  };
  const update = (patch: PropPatch, mergeKey?: string) => dispatch(updateProp(p.id, patch, mergeKey));
  const def = paramDefFor(p.source);
  const params = def && isParamSource(p.source) ? resolveParams(def, p.source.params) : {};

  const sizeText = size ? `${fmt(size.x * p.defaultScale)} × ${fmt(size.y * p.defaultScale)} × ${fmt(size.z * p.defaultScale)}` : '';

  return (
    <div className="split">
      <div className="viewport">
        <div className={`stage-render-layer${showingImage ? ' covered' : ''}`}>
          <PropView prop={p} person={person} onSize={setSize} onCaptureReady={onCaptureReady} />
        </div>
        {showingImage && <ZoomableImage className="character-artwork" src={artwork!} alt={`Concept artwork for ${p.name}`} />}
        {artwork && <button className="btn character-view-toggle" onClick={() => setShowImage(!showingImage)}>{showingImage ? '3D prop' : 'Prop image'}</button>}
        {sizeText && <div className="viewport-badge">{sizeText}</div>}
        <div className="viewport-toolbar" hidden={showingImage}>
          <button className={`btn ${person ? 'on' : ''}`} aria-pressed={person} onClick={() => setPerson((x) => !x)}>
            {person ? 'Hide person' : 'Person for scale'}
          </button>
        </div>
      </div>
      <div className="split-panel">
        <div className="row gap panel-head">
          <button className="btn ghost small-btn" onClick={onBack}>
            ‹ All props
          </button>
        </div>
        <div className="inspector">
          <button className="btn" disabled={!ready || capturing} onClick={() => void openImage()}>{capturing ? 'Capturing preview…' : p.image ? 'Prop image…' : 'Generate or upload image'}</button>
          <p className="small muted">Uses the current 3D view as guidance. Frame your prop before generating.</p>
          {error && <p className="error small" role="alert">{error}</p>}
          <label className="field">
            <span>Name</span>
            <input
              key={p.id}
              defaultValue={p.name}
              onBlur={(e) => {
                const name = e.target.value.trim();
                if (name && name !== p.name) update({ name });
              }}
            />
          </label>
          <Slider label="Scale" value={p.defaultScale} min={0.1} max={5} step={0.05} format={(v) => `×${v.toFixed(2)}`} onChange={(defaultScale) => update({ defaultScale }, `scale:${p.id}`)} />
          {def && def.params.length > 0 && (
            <div className="field">
              <span>Size</span>
              {def.params.map((d) => (
                <Slider key={d.key} label={d.label} value={params[d.key]} min={d.min} max={d.max} step={d.step} format={(v) => `${round(v, 3)} m`} onChange={(v) => update({ params: { [d.key]: v } }, `param:${p.id}:${d.key}`)} />
              ))}
            </div>
          )}
          <div className="field">
            <span className="row">
              <span className="grow">Shade</span>
              {p.grey !== undefined && (
                <button className="link-btn" onClick={() => update({ grey: undefined })}>
                  Reset
                </button>
              )}
            </span>
            <input type="range" className="shade-range" min={0.05} max={0.95} step={0.05} value={p.grey ?? 0.7} onChange={(e) => update({ grey: Number(e.target.value) }, `grey:${p.id}`)} />
          </div>

          {project.stages.length > 0 && (
            <div className="field">
              <span>Place on a stage</span>
              <div className="type-buttons">
                {project.stages.map((s) => (
                  <button
                    key={s.id}
                    className="chip tag"
                    onClick={() => {
                      dispatch(placeProp(s.id, p, freeSpot(s, p.source)));
                      setPlaced(s.name);
                    }}
                  >
                    + {s.name}
                  </button>
                ))}
              </div>
              {placed && <p className="ok small">Added to {placed}. Move it into place in Staging.</p>}
            </div>
          )}

          <button
            className="btn danger"
            onClick={() => {
              if (!window.confirm(`Delete ${p.name} from the prop list? Copies already on stages stay. You can undo this.`)) return;
              dispatch(deleteProp(p.id));
              onBack();
            }}
          >
            Delete prop
          </button>
        </div>
      </div>
      {reference && <ConceptImageEditor subject={p} kind="prop" defaultPrompt={propImagePrompt(p)} reference={reference} onClose={() => setReference(undefined)} />}
    </div>
  );
}

function fmt(m: number): string {
  return m < 1 ? `${Math.round(m * 100)} cm` : `${m.toFixed(2)} m`;
}

function PropView({ prop, person, onSize, onCaptureReady }: { prop: Prop; person: boolean; onSize: (s: THREE.Vector3) => void; onCaptureReady: CaptureReady }) {
  return (
    <Canvas gl={{ preserveDrawingBuffer: true, antialias: true }} className="viewport-canvas" shadows="percentage" dpr={[1, 2]} frameloop="demand" camera={{ position: [1.2, 1, 1.6], fov: 35, near: 0.01 }}>
      <color attach="background" args={['#2b2b30']} />
      <hemisphereLight args={['#ffffff', '#55555c', 1.1]} />
      <directionalLight position={[3, 6, 4]} intensity={1.6} castShadow shadow-mapSize={[1024, 1024]} />
      <mesh rotation-x={-Math.PI / 2} receiveShadow>
        <planeGeometry args={[40, 40]} />
        <shadowMaterial opacity={0.25} />
      </mesh>
      <Grid args={[10, 10]} cellSize={0.1} sectionSize={1} cellColor="#45454c" sectionColor="#5c5c66" fadeDistance={8} infiniteGrid position={[0, 0.0005, 0]} />
      <Suspense fallback={null}>
        <PropModel prop={prop} person={person} onSize={onSize} onCaptureReady={onCaptureReady} />
        {person && <group userData={{ excludeFromImage: true }}><Person /></group>}
      </Suspense>
      <OrbitControls makeDefault maxPolarAngle={Math.PI / 2 - 0.02} />
    </Canvas>
  );
}

const PERSON_POS: [number, number, number] = [0.6, 0, -0.2];
const PERSON_BOX = new THREE.Box3(new THREE.Vector3(0.35, 0, -0.35), new THREE.Vector3(0.85, 1.75, -0.05));

/** Points the camera at `box` from a fixed three-quarter view above, close enough to fill the frame. */
function useFrame3q(box: THREE.Box3 | null) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const controls = useThree((s) => s.controls) as unknown as OrbitControlsImpl | null;
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    if (!box || box.isEmpty()) return;
    const center = box.getCenter(new THREE.Vector3());
    const radius = Math.max(0.05, box.getSize(new THREE.Vector3()).length() / 2);
    const dist = (radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2))) * 1.1;
    const dir = new THREE.Vector3(Math.sin(0.6), 0.55, Math.cos(0.6)).normalize();
    camera.position.copy(center).addScaledVector(dir, dist);
    camera.near = Math.max(0.005, dist / 100);
    camera.far = dist * 100;
    camera.updateProjectionMatrix();
    if (controls) {
      controls.target.copy(center);
      controls.update();
    } else {
      camera.lookAt(center);
    }
    invalidate();
  }, [box, camera, controls, invalidate]);
}

function PropModel({ prop, person, onSize, onCaptureReady }: { prop: Prop; person: boolean; onSize: (s: THREE.Vector3) => void; onCaptureReady: CaptureReady }) {
  const [model, setModel] = useState<THREE.Object3D | null>(null);
  const sourceKey = JSON.stringify(prop.source);
  useEffect(() => {
    setModel(null);
    let cancelled = false;
    let built: THREE.Object3D | null = null;
    void buildSource(prop.source).then((o) => {
      if (cancelled) return disposeObject(o);
      built = o;
      setModel(o);
      onSize(new THREE.Box3().setFromObject(o).getSize(new THREE.Vector3()));
    });
    return () => {
      cancelled = true;
      if (built) disposeObject(built);
    };
  }, [sourceKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (model) applyGrey(model, prop.grey);
  }, [model, prop.grey]);
  // The model loads after the view mounts, so frame it once it's there.
  const frameBox = useMemo(() => {
    if (!model) return null;
    const b = new THREE.Box3().setFromObject(model);
    b.min.multiplyScalar(prop.defaultScale);
    b.max.multiplyScalar(prop.defaultScale);
    return person ? b.union(PERSON_BOX) : b;
  }, [model, prop.defaultScale, person]);
  useFrame3q(frameBox);
  if (!model) return null;
  const s = prop.defaultScale;
  return <><primitive object={model} scale={[s, s, s]} /><PreviewCapture onReady={onCaptureReady} /></>;
}

/** A neutral 175 cm figure beside the prop. */
function Person() {
  const [m] = useState(() => buildMannequin({ heightCm: 175, sex: 'other', build: 'average' }));
  useEffect(() => () => disposeObject(m), [m]);
  return <primitive object={m} position={PERSON_POS} />;
}
