import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Grid, OrbitControls, TransformControls } from '@react-three/drei';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import type { Stage, Transform } from '../../state/schema';
import { useStagingUI } from '../../staging/uiStore';
import { PreviewCapture } from '../../images/PreviewCapture';
import { StageObjectView } from './StageObjectView';

interface Props {
  stage: Stage;
  onCaptureReady?: (capture: (() => Promise<Blob>) | null) => void;
  onTransformEnd: (objectId: string, transform: Transform) => void;
}

export function StageViewport({ stage, onTransformEnd, onCaptureReady }: Props) {
  return (
    <Canvas
      className="viewport-canvas"
      shadows="percentage"
      dpr={[1, 2]}
      frameloop="demand"
      camera={{ position: [5, 4, 7], fov: 45, near: 0.05, far: 500 }}
      gl={{ preserveDrawingBuffer: true, antialias: true }}
      onPointerMissed={(e) => e.type === 'click' && useStagingUI.getState().select(null)}
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
      <PreviewCapture onReady={onCaptureReady} />
      <Ground />
      <Grid args={[40, 40]} cellSize={0.5} sectionSize={2} cellColor="#45454c" sectionColor="#5c5c66" fadeDistance={35} infiniteGrid position={[0, 0.001, 0]} />
      <Scene stage={stage} onTransformEnd={onTransformEnd} />
    </Canvas>
  );
}

function Ground() {
  return (
    <mesh rotation-x={-Math.PI / 2} receiveShadow>
      <planeGeometry args={[200, 200]} />
      <shadowMaterial opacity={0.25} />
    </mesh>
  );
}

function Scene({ stage, onTransformEnd }: Props) {
  const selectedId = useStagingUI((s) => s.selectedId);
  const mode = useStagingUI((s) => s.mode);
  const snap = useStagingUI((s) => s.snap);
  const select = useStagingUI((s) => s.select);
  const invalidate = useThree((s) => s.invalidate);
  const orbit = useRef<OrbitControlsImpl>(null);
  const [target, setTarget] = useState<THREE.Group | null>(null);
  const refs = useRef(new Map<string, THREE.Group>());
  const selected = stage.objects.find((o) => o.id === selectedId);

  useEffect(() => {
    setTarget(selectedId ? refs.current.get(selectedId) ?? null : null);
    invalidate();
  }, [selectedId, stage.objects, invalidate]);

  return (
    <>
      <OrbitControls ref={orbit} makeDefault enableDamping={false} maxPolarAngle={Math.PI / 2 - 0.02} minDistance={0.5} maxDistance={80} target={[0, 0.8, 0]} />
      {stage.objects.map((o) => (
        <StageObjectView
          key={o.id}
          object={o}
          ref={(g) => {
            if (g) refs.current.set(o.id, g);
            else refs.current.delete(o.id);
          }}
          onSelect={(e) => {
            e.stopPropagation();
            // Ignore taps that ended a camera drag.
            if (e.delta > 6) return;
            select(o.id);
          }}
        />
      ))}
      {target && selected && <SelectionBox object={target} />}
      {target && selected && (
        <group userData={{ excludeFromImage: true }}><TransformControls
          object={target}
          mode={mode}
          size={1.1}
          translationSnap={snap ? 0.1 : null}
          rotationSnap={snap ? THREE.MathUtils.degToRad(15) : null}
          scaleSnap={snap ? 0.1 : null}
          // Rotation on the floor plane covers most blocking; tilt is in the inspector.
          showX={mode !== 'rotate'}
          showZ={mode !== 'rotate'}
          onMouseUp={() => {
            const g = target;
            if (mode === 'translate' && g.position.y < 0) g.position.y = 0;
            onTransformEnd(selected.id, {
              position: g.position.toArray() as Transform['position'],
              rotation: g.quaternion.toArray() as Transform['rotation'],
              scale: g.scale.toArray() as Transform['scale'],
            });
          }}
        /></group>
      )}
    </>
  );
}

/** An accent-colored box around the selected object. Follows it while dragging. */
function SelectionBox({ object }: { object: THREE.Object3D }) {
  const scene = useThree((s) => s.scene);
  const helperRef = useRef<THREE.BoxHelper | null>(null);
  useFrame(() => helperRef.current?.update());
  useEffect(() => {
    const helper = new THREE.BoxHelper(object, 0xf2b84b);
    helper.userData.excludeFromImage = true;
    helper.renderOrder = 10;
    (helper.material as THREE.LineBasicMaterial).depthTest = false;
    scene.add(helper);
    helperRef.current = helper;
    return () => {
      helperRef.current = null;
      scene.remove(helper);
      helper.geometry.dispose();
      (helper.material as THREE.Material).dispose();
    };
  }, [object, scene]);
  return null;
}
