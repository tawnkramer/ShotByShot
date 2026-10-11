import { useEffect, useMemo, useRef, type MutableRefObject } from 'react';
import * as THREE from 'three';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import type { Project } from '../../state/schema';
import { ShotRig } from '../../three/shotRig';
import { applyCamera } from '../../three/camera';
import { locate, type Sequence } from '../../shots/sequence';

interface Props {
  project: Project;
  seq: Sequence;
  aspect: number;
  /** Seconds into the film. Advanced here while playing. */
  timeRef: MutableRefObject<number>;
  timeVersion: number;
  playing: boolean;
  loop: boolean;
  onTick: (t: number) => void;
  onEnded: () => void;
}

export function PrevisCanvas(props: Props) {
  return (
    <Canvas
      className="viewport-canvas"
      shadows="percentage"
      dpr={[1, 2]}
      frameloop={props.playing ? 'always' : 'demand'}
      gl={{ preserveDrawingBuffer: true, antialias: true }}
      camera={{ fov: 40, near: 0.05, far: 500 }}
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
      <Player {...props} />
    </Canvas>
  );
}

const THROTTLE_MS = 60;

/** Plays the sequence: one rig, re-synced whenever playback crosses into another shot. */
function Player({ project, seq, aspect, timeRef, timeVersion, playing, loop, onTick, onEnded }: Props) {
  const invalidate = useThree((s) => s.invalidate);
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const rig = useMemo(() => new ShotRig(), []);
  const current = useRef<{ shotId: string; project: Project } | null>(null);
  const lastTick = useRef(0);

  useEffect(() => {
    rig.onChange = invalidate;
    return () => rig.dispose();
  }, [rig, invalidate]);

  useEffect(() => {
    invalidate();
  }, [timeVersion, project, playing, invalidate]);

  useFrame((_, delta) => {
    if (!seq.items.length) return;
    let t = timeRef.current;
    if (playing) {
      t += Math.min(delta, 0.1);
      if (t >= seq.total) {
        if (loop) t = 0;
        else {
          t = seq.total;
          onEnded();
        }
      }
      timeRef.current = t;
      const now = performance.now();
      if (now - lastTick.current > THROTTLE_MS) {
        lastTick.current = now;
        onTick(t);
      }
    }
    const { index, u } = locate(seq, t);
    const shotId = seq.items[index].shotId;
    if (current.current?.shotId !== shotId || current.current.project !== project) {
      rig.sync(project, shotId);
      current.current = { shotId, project };
    }
    const cam = rig.setTime(u);
    if (cam) applyCamera(camera, cam, aspect);
  });

  return <primitive object={rig.root} />;
}
