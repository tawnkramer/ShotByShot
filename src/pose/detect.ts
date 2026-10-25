import type { PoseLandmarker } from '@mediapipe/tasks-vision';
import type { DetectedPerson } from './landmarks';

/**
 * Finds people in a photo with MediaPipe Pose Landmarker, running in the
 * browser. The library, its WASM runtime (served at mediapipe/wasm/, see
 * vite.config.ts) and the model (public/mediapipe/) load the first time this
 * is called. Nothing is sent anywhere.
 */

/** People found in a photo, biggest first, each with its outline box (fractions of the photo). */
export interface FoundPerson extends DetectedPerson {
  box: { x: number; y: number; w: number; h: number };
}

const MAX_PEOPLE = 4;
let landmarker: Promise<PoseLandmarker> | undefined;

async function create(): Promise<PoseLandmarker> {
  const { PoseLandmarker } = await import('@mediapipe/tasks-vision');
  const base = `${import.meta.env.BASE_URL}mediapipe`;
  const simd = await simdSupported();
  const fileset = {
    wasmLoaderPath: `${base}/wasm/vision_wasm${simd ? '' : '_nosimd'}_internal.js`,
    wasmBinaryPath: `${base}/wasm/vision_wasm${simd ? '' : '_nosimd'}_internal.wasm`,
  };
  const options = (delegate: 'GPU' | 'CPU') => ({
    baseOptions: { modelAssetPath: `${base}/pose_landmarker_full.task`, delegate },
    runningMode: 'IMAGE' as const,
    numPoses: MAX_PEOPLE,
  });
  try {
    return await PoseLandmarker.createFromOptions(fileset, options('GPU'));
  } catch {
    // No WebGL2 (or it failed): the CPU is slower but fine for one photo.
    return PoseLandmarker.createFromOptions(fileset, options('CPU'));
  }
}

/** Loads the detector ahead of time (e.g. when the dialog opens). Failures surface from `findPeople`. */
export function preloadDetector(): void {
  landmarker ??= create();
  landmarker.catch(() => (landmarker = undefined));
}

export async function findPeople(image: ImageBitmap | HTMLImageElement | HTMLCanvasElement): Promise<FoundPerson[]> {
  landmarker ??= create();
  let detector: PoseLandmarker;
  try {
    detector = await landmarker;
  } catch (err) {
    landmarker = undefined;
    throw new Error(`Couldn't load pose detection. ${err instanceof Error ? err.message : ''}`.trim());
  }
  const result = detector.detect(image);
  const people: FoundPerson[] = result.landmarks.map((points, i) => {
    const xs = points.map((p) => p.x), ys = points.map((p) => p.y);
    const x = Math.max(0, Math.min(...xs)), y = Math.max(0, Math.min(...ys));
    return {
      image: points.map((p) => ({ x: p.x, y: p.y, visibility: p.visibility ?? 1 })),
      world: (result.worldLandmarks[i] ?? []).map((p) => [p.x, p.y, p.z] as [number, number, number]),
      box: { x, y, w: Math.min(1, Math.max(...xs)) - x, h: Math.min(1, Math.max(...ys)) - y },
    };
  });
  return people.sort((a, b) => b.box.w * b.box.h - a.box.w * a.box.h);
}

/** WebAssembly SIMD (every current browser; older Safari lacks it). */
async function simdSupported(): Promise<boolean> {
  // A tiny module using one SIMD instruction.
  const bytes = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]);
  return WebAssembly.validate(bytes);
}
