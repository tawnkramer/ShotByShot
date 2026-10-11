import { useEffect } from 'react';
import * as THREE from 'three';
import { useThree } from '@react-three/fiber';

export type CaptureReady = (capture: (() => Promise<Blob>) | null) => void;

export function PreviewCapture({ onReady }: { onReady?: CaptureReady }) {
  const { gl, scene, camera, invalidate } = useThree();
  useEffect(() => {
    onReady?.(() => new Promise<Blob>((resolve, reject) => {
      const hidden: THREE.Object3D[] = [];
      scene.traverse((o) => { if (o.visible && o.userData.excludeFromImage) { hidden.push(o); o.visible = false; } });
      try {
        gl.render(scene, camera);
        gl.domElement.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Could not capture the 3D preview.')), 'image/png');
      } catch { reject(new Error('Could not capture the 3D preview. Try again after models finish loading.')); }
      finally { hidden.forEach((o) => { o.visible = true; }); invalidate(); }
    }));
    return () => onReady?.(null);
  }, [gl, scene, camera, invalidate, onReady]);
  return null;
}
