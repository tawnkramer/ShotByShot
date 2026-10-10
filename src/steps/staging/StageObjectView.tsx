import { forwardRef, useEffect, useMemo, useState } from 'react';
import * as THREE from 'three';
import type { ThreeEvent } from '@react-three/fiber';
import { useThree } from '@react-three/fiber';
import type { StageObject } from '../../state/schema';
import { buildStatic } from '../../three/library';
import { loadAsset } from '../../three/assets';
import { applyGrey, disposeObject } from '../../three/materials';

interface Props {
  object: StageObject;
  onSelect?: (e: ThreeEvent<MouseEvent>) => void;
}

/** Placeholder shown while a model loads or if it can't be loaded. */
function placeholder(): THREE.Group {
  const g = new THREE.Group();
  const m = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), new THREE.MeshBasicMaterial({ color: 0x777777, wireframe: true }));
  m.position.y = 0.25;
  g.add(m);
  return g;
}

/** Builds the model for a stage object. Rebuilt only when its source changes. */
function useModel(object: StageObject): THREE.Object3D {
  const invalidate = useThree((s) => s.invalidate);
  const sourceKey = JSON.stringify(object.source);
  const built = useMemo(() => (object.source.kind === 'asset' ? null : buildStatic(object.source)), [sourceKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const [asset, setAsset] = useState<THREE.Object3D | null>(null);

  useEffect(() => {
    if (object.source.kind !== 'asset') return;
    let cancelled = false;
    setAsset(null);
    loadAsset(object.source.blob, object.source.format).then(
      (o) => !cancelled && setAsset(o),
      (err) => console.warn('Model failed to load', err),
    );
    return () => {
      cancelled = true;
    };
  }, [sourceKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(
    () => () => {
      if (built) disposeObject(built);
    },
    [built],
  );

  const model = useMemo(() => built ?? asset ?? placeholder(), [built, asset]);
  useEffect(() => {
    applyGrey(model, object.grey);
    invalidate();
  }, [model, object.grey, invalidate]);
  return model;
}

export const StageObjectView = forwardRef<THREE.Group, Props>(function StageObjectView({ object, onSelect }, ref) {
  const model = useModel(object);
  const { position, rotation, scale } = object.transform;
  return (
    <group ref={ref} name={object.id} position={position} quaternion={rotation} scale={scale} onClick={onSelect} userData={{ objectId: object.id }}>
      <primitive object={model} />
    </group>
  );
});
