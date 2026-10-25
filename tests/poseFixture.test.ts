import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import warrior from './fixtures/pose/warrior.json';
import type { DetectedPerson } from '../src/pose/landmarks';
import { solvePose, uprightCamera } from '../src/pose/solvePose';
import { matchPhoto } from '../src/pose/solveCamera';
import { bodyPoints } from '../src/pose/skeleton';
import type { Build, Sex } from '../src/state/schema';

/**
 * What MediaPipe really found in a photo (recorded by tests/pose.live.test.ts):
 * a man in Warrior II on a beach, torso to the camera, arms out level, his
 * right knee bent over his right foot (left of the photo), his left leg
 * straight back, head turned to his right. The horizon is level.
 */
const person = warrior.person as unknown as DetectedPerson;
const body = { heightCm: 175, sex: 'male' as Sex, build: 'average' as Build };
const bend = (j: [number, number, number] | undefined) => Math.abs(j![0]);

describe('a real photo: Warrior II', () => {
  it('reads the pose', () => {
    const m = solvePose(person, uprightCamera(person))!;
    expect(m.pose).toBe('standing');
    expect(bend(m.joints.kneeR)).toBeGreaterThan(60);
    expect(bend(m.joints.kneeL)).toBeLessThan(30);
    const p = bodyPoints(body, { pose: m.pose, joints: m.joints, yaw: 0 }, [0, 0, 0]);
    // Arms out level: wrists near shoulder height and well out to the sides.
    for (const s of ['L', 'R'] as const) {
      expect(Math.abs(p[`wrist${s}`][1] - p[`shoulder${s}`][1])).toBeLessThan(0.15);
      expect(Math.abs(p[`wrist${s}`][0] - p[`shoulder${s}`][0])).toBeGreaterThan(0.45);
    }
    // Feet wide apart; head turned toward his right (−X). MediaPipe's face points only show
    // about a third of the turn the photo has, so this checks the way it turns, not how far.
    expect(new THREE.Vector3(...p.ankleL).distanceTo(new THREE.Vector3(...p.ankleR))).toBeGreaterThan(0.9);
    expect(p.noseTip[0]).toBeLessThan(p.head[0]);
  });

  it('reads a level camera from the body', () => {
    const up = uprightCamera(person);
    expect(Math.abs(up.cameraRoll)).toBeLessThan(3);
    expect(Math.abs(up.cameraTilt)).toBeLessThan(15);
  });

  it('places a believable camera that lines the character up with the photo', () => {
    const r = matchPhoto({
      person, photo: { width: warrior.width, height: warrior.height }, character: body,
      key: { position: [0, 0, 0], yaw: 0, pose: 'standing' }, base: () => [0, 0, 0], aspect: 16 / 9, matchPose: true, matchCamera: true,
    })!;
    expect(r.warnings).toEqual([]);
    expect(r.error!).toBeLessThan(0.05);
    expect(r.camera!.lens).toBeGreaterThan(20);
    expect(r.camera!.lens).toBeLessThan(70);
    expect(Math.abs(r.camera!.roll)).toBeLessThan(3);
    expect(Math.abs(r.camera!.elevation)).toBeLessThan(15);
  });
});
