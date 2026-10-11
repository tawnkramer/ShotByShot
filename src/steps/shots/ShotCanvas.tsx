import { useEffect, useMemo, useRef, type MutableRefObject } from 'react';
import * as THREE from 'three';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Grid, OrbitControls, TransformControls } from '@react-three/drei';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import type { CameraState, Project } from '../../state/schema';
import { ShotRig, type RigId } from '../../three/shotRig';
import { applyCamera, cameraPosition } from '../../three/camera';

export interface ShotCanvasProps {
  project: Project;
  shotId: string;
  rig: ShotRig;
  aspect: number;
  /** Progress through the shot, 0..1. Advanced here while playing. */
  timeRef: MutableRefObject<number>;
  /** Bumped by the parent whenever time changes outside playback. */
  timeVersion: number;
  playing: boolean;
  durationSec: number;
  onTick: (u: number) => void;
  onEnded: () => void;
  view: 'shot' | 'free';
  /** Camera while a gesture is in progress, before it's committed. */
  liveCamera: CameraState | null;
  selectable: boolean;
  selected: RigId | null;
  onSelect: (id: RigId | null) => void;
  gizmo: 'translate' | 'rotate';
  onGizmoEnd: (id: RigId, object: THREE.Object3D) => void;
}

export function ShotCanvas(props: ShotCanvasProps) {
  return (
    <Canvas
      className="viewport-canvas"
      shadows="percentage"
      dpr={[1, 2]}
      frameloop={props.playing ? 'always' : 'demand'}
      gl={{ preserveDrawingBuffer: true, antialias: true }}
      camera={{ fov: 40, near: 0.05, far: 500, position: [4, 3, 6] }}
      onPointerMissed={(e) => e.type === 'click' && props.selectable && props.onSelect(null)}
    >
      <color attach="background" args={['#2b2b30']} />
      <hemisphereLight args={['#ffffff', '#55555c', 1.1]} />
      <directionalLight
        position={[6, 10, 5]}
        intensity={1.6}
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-camera-left={-12}
        shadow-camera-right={12}
        shadow-camera-top={12}
        shadow-camera-bottom={-12}
        shadow-bias={-0.0005}
      />
      <mesh rotation-x={-Math.PI / 2} receiveShadow>
        <planeGeometry args={[200, 200]} />
        <shadowMaterial opacity={0.25} />
      </mesh>
      {props.view === 'free' && <Grid args={[40, 40]} cellSize={0.5} sectionSize={2} cellColor="#45454c" sectionColor="#5c5c66" fadeDistance={35} infiniteGrid position={[0, 0.001, 0]} />}
      <RigScene {...props} />
    </Canvas>
  );
}

const THROTTLE_MS = 60;

function RigScene({ project, shotId, rig, aspect, timeRef, timeVersion, playing, durationSec, onTick, onEnded, view, liveCamera, selectable, selected, onSelect, gizmo, onGizmoEnd }: ShotCanvasProps) {
  const invalidate = useThree((s) => s.invalidate);
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const controls = useThree((s) => s.controls) as unknown as OrbitControlsImpl | null;
  const dragging = useRef(false);
  const lastTick = useRef(0);
  const ended = useRef(false);

  // A stand-in for the shot camera, drawn in the free view.
  const shotCam = useMemo(() => new THREE.PerspectiveCamera(40, aspect, 0.1, 2), [aspect]);
  const helper = useMemo(() => {
    const h = new THREE.CameraHelper(shotCam);
    (h.material as THREE.LineBasicMaterial).color = new THREE.Color('#f2b84b');
    return h;
  }, [shotCam]);

  useEffect(() => {
    rig.onChange = invalidate;
    rig.sync(project, shotId);
    invalidate();
  }, [rig, project, shotId, invalidate]);

  useEffect(() => {
    ended.current = false;
    invalidate();
  }, [timeVersion, liveCamera, view, selected, playing, invalidate]);

  // Entering the free view: start from where the shot camera is, orbiting its target.
  useEffect(() => {
    if (view !== 'free' || !controls) return;
    const state = rig.setTime(timeRef.current);
    if (!state) return;
    const pos = cameraPosition({ ...state, distance: state.distance + 3, elevation: Math.max(state.elevation, 20) });
    camera.position.copy(pos);
    camera.fov = 45;
    camera.updateProjectionMatrix();
    controls.target.set(...state.target);
    controls.update();
    invalidate();
  }, [view, controls]); // eslint-disable-line react-hooks/exhaustive-deps

  useFrame((_, delta) => {
    let u = timeRef.current;
    if (playing) {
      u = Math.min(1, u + delta / Math.max(0.1, durationSec));
      timeRef.current = u;
      const now = performance.now();
      if (now - lastTick.current > THROTTLE_MS || u >= 1) {
        lastTick.current = now;
        onTick(u);
      }
      if (u >= 1 && !ended.current) {
        ended.current = true;
        onEnded();
      }
    }
    const state = rig.setTime(u, dragging.current ? selected : null);
    const cam = liveCamera ?? state;
    if (!cam) return;
    applyCamera(shotCam, cam, aspect);
    shotCam.far = Math.min(2, cam.distance * 0.6);
    shotCam.updateProjectionMatrix();
    shotCam.updateMatrixWorld();
    helper.update();
    if (view === 'shot') applyCamera(camera, cam, aspect);
  });

  const target = selected && selectable ? rig.object(selected) : undefined;
  const isActor = selected?.startsWith('actor:');

  return (
    <>
      <primitive
        object={rig.root}
        onClick={(e: { delta: number; object: THREE.Object3D; stopPropagation: () => void }) => {
          if (!selectable || e.delta > 6) return;
          e.stopPropagation();
          onSelect(rig.idOf(e.object) ?? null);
        }}
      />
      {view === 'free' && <primitive object={helper} />}
      {view === 'free' && <OrbitControls makeDefault enableDamping={false} maxPolarAngle={Math.PI / 2 - 0.02} minDistance={0.3} maxDistance={80} />}
      {target && <SelectionBox object={target} />}
      {target && (
        <TransformControls
          object={target}
          mode={gizmo}
          size={1}
          translationSnap={0.05}
          rotationSnap={THREE.MathUtils.degToRad(15)}
          showX={gizmo === 'translate'}
          showZ={gizmo === 'translate'}
          // Characters stay on the floor; props and set pieces can be lifted.
          showY={gizmo === 'rotate' || (gizmo === 'translate' && !isActor)}
          onMouseDown={() => {
            dragging.current = true;
          }}
          onMouseUp={() => {
            dragging.current = false;
            if (selected) onGizmoEnd(selected, target);
          }}
        />
      )}
    </>
  );
}

function SelectionBox({ object }: { object: THREE.Object3D }) {
  const scene = useThree((s) => s.scene);
  const ref = useRef<THREE.BoxHelper | null>(null);
  useFrame(() => ref.current?.update());
  useEffect(() => {
    const helper = new THREE.BoxHelper(object, 0xf2b84b);
    (helper.material as THREE.LineBasicMaterial).depthTest = false;
    helper.renderOrder = 10;
    scene.add(helper);
    ref.current = helper;
    return () => {
      ref.current = null;
      scene.remove(helper);
      helper.geometry.dispose();
      (helper.material as THREE.Material).dispose();
    };
  }, [object, scene]);
  return null;
}
