/**
 * A person found in a photo, in MediaPipe Pose Landmarker's terms. Kept as
 * our own type so only the detector needs to know about MediaPipe.
 */
export type Vec3 = [number, number, number];

export interface DetectedPerson {
  /** 33 points as fractions of the photo (x right, y down), with how sure the detector is each one is visible. */
  image: { x: number; y: number; visibility: number }[];
  /** The same 33 points in metres, centred between the hips, in the camera's axes: x right, y down, z away from the camera. */
  world: Vec3[];
}

/** Indexes of the points we use, out of MediaPipe's 33. Left and right are the person's own. */
export const LM = {
  nose: 0,
  earL: 7, earR: 8,
  shoulderL: 11, shoulderR: 12,
  elbowL: 13, elbowR: 14,
  wristL: 15, wristR: 16,
  hipL: 23, hipR: 24,
  kneeL: 25, kneeR: 26,
  ankleL: 27, ankleR: 28,
} as const;
export type LandmarkName = keyof typeof LM;

export const LANDMARK_COUNT = 33;

/** Below this, a point is treated as not seen (hidden or out of frame). */
export const MIN_VISIBILITY = 0.5;
