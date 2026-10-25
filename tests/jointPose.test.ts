import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { emptyHistory, runCommand, undo, type Command } from '../src/state/commands';
import { actorKeySchema, createProject, type Build, type JointAngles, type Project, type Sex } from '../src/state/schema';
import { importScript } from '../src/story/commands';
import { addCharacters } from '../src/characters/commands';
import { createStagesForScenes } from '../src/staging/commands';
import { setActorKey } from '../src/shots/commands';
import { effectiveShot } from '../src/shots/setup';
import { sampleActor } from '../src/shots/timing';
import { ShotRig } from '../src/three/shotRig';
import { applyPose, buildMannequin } from '../src/three/mannequin';
import { BODY_POINTS, bodyPoints } from '../src/pose/skeleton';
import { panelHeads } from '../src/comic/heads';
import { decodeProjectFile, encodeProjectJson } from '../src/storage/projectFile';
import { strToU8 } from 'fflate';

const body = { heightCm: 175, sex: 'other' as Sex, build: 'average' as Build };
/** Bent forward at the hips, head down, right arm raised, left knee up. */
const CROUCH: JointAngles = { pelvis: [40, 0, 0], neck: [30, 10, 0], shoulderR: [-150, 0, -10], elbowR: [-30, 0, 0], hipL: [-80, 0, 0], kneeL: [90, 0, 0] };

function setup(): [Project, string] {
  let [p, h] = runCommand(createProject('T'), emptyHistory(), importScript('INT. ROOM - DAY\n\nMAYA\nHi.'));
  const cmds: Command[] = [addCharacters(['Maya'], ['maya']), createStagesForScenes(p).command];
  for (const c of cmds) [p, h] = runCommand(p, h, c);
  return [p, p.shots[0].id];
}
const startKey = (p: Project, shotId: string) => effectiveShot(p, shotId)!.setup.actors[0].motion.start;
const worldOf = (root: THREE.Object3D, name: string) => {
  root.updateMatrixWorld(true);
  return root.getObjectByName(name)!.getWorldPosition(new THREE.Vector3());
};

describe('joint poses', () => {
  it('the schema takes joint angles and rejects unknown joints', () => {
    const k = { position: [0, 0, 0], yaw: 0, pose: 'standing' };
    expect(actorKeySchema.parse({ ...k, joints: CROUCH }).joints).toEqual(CROUCH);
    expect(actorKeySchema.parse(k).joints).toBeUndefined();
    expect(() => actorKeySchema.parse({ ...k, joints: { wristL: [0, 0, 0] } })).toThrow();
  });

  it('joint angles replace the preset for the joints they name, in degrees', () => {
    const m = buildMannequin(body, 'standing', { elbowL: [-90, 0, 0] });
    expect(m.getObjectByName('elbowL')!.rotation.x).toBeCloseTo(-Math.PI / 2);
    // Not named: the preset's angle.
    expect(m.getObjectByName('shoulderL')!.rotation.z).toBeCloseTo(THREE.MathUtils.degToRad(6));
    // Back to the plain preset.
    applyPose(m, body, 'standing');
    expect(m.getObjectByName('elbowL')!.rotation.x).toBeCloseTo(THREE.MathUtils.degToRad(-8));
  });

  it('body points match the drawn mannequin', () => {
    const base: [number, number, number] = [1, 0.2, -2];
    const key = { pose: 'standing' as const, joints: CROUCH, yaw: 35 };
    const pts = bodyPoints(body, key, base);
    const m = buildMannequin(body, key.pose, key.joints);
    m.position.set(...base);
    m.rotation.set(0, THREE.MathUtils.degToRad(key.yaw), 0);
    for (const name of BODY_POINTS) {
      const w = worldOf(m, name);
      expect(Math.hypot(w.x - pts[name][0], w.y - pts[name][1], w.z - pts[name][2]), name).toBeLessThan(1e-6);
    }
    // Bending forward brings the head down and forward (+Z turned by the yaw).
    const standing = bodyPoints(body, { pose: 'standing', yaw: 35 }, base);
    expect(pts.head[1]).toBeLessThan(standing.head[1] - 0.2);
    const fwd = [Math.sin(THREE.MathUtils.degToRad(35)), Math.cos(THREE.MathUtils.degToRad(35))];
    const ahead = (q: [number, number, number]) => (q[0] - base[0]) * fwd[0] + (q[2] - base[2]) * fwd[1];
    expect(ahead(pts.head)).toBeGreaterThan(ahead(standing.head) + 0.2);
    // Raised right arm: the wrist is above the head.
    expect(pts.wristR[1]).toBeGreaterThan(pts.head[1]);
  });

  it('a shot renders, saves and undoes a joint pose', () => {
    const [p0, shotId] = setup();
    let [p, h] = runCommand(p0, emptyHistory(), setActorKey(shotId, 'maya', 'start', { joints: CROUCH }));
    expect(startKey(p, shotId).joints).toEqual(CROUCH);

    const rig = new ShotRig();
    rig.sync(p, shotId);
    rig.setTime(0);
    expect(rig.object('actor:maya')!.getObjectByName('pelvis')!.rotation.x).toBeCloseTo(THREE.MathUtils.degToRad(40));

    const reloaded = decodeProjectFile(strToU8(encodeProjectJson(p))).project;
    expect(startKey(reloaded, shotId).joints).toEqual(CROUCH);

    [p, h] = undo(p, h);
    expect(startKey(p, shotId).joints).toBeUndefined();
    rig.sync(p, shotId);
    rig.setTime(0);
    expect(rig.object('actor:maya')!.getObjectByName('pelvis')!.rotation.x).toBeCloseTo(0);
  });

  it('moving keeps the pose, a new preset pose or Clear drops it', () => {
    const [p0, shotId] = setup();
    let [p] = runCommand(p0, emptyHistory(), setActorKey(shotId, 'maya', 'start', { joints: CROUCH }));
    [p] = runCommand(p, emptyHistory(), setActorKey(shotId, 'maya', 'start', { position: [1, 0, 1] }));
    expect(startKey(p, shotId).joints).toEqual(CROUCH);
    const [sitting] = runCommand(p, emptyHistory(), setActorKey(shotId, 'maya', 'start', { pose: 'sitting' }));
    expect(startKey(sitting, shotId)).not.toHaveProperty('joints');
    const [cleared] = runCommand(p, emptyHistory(), setActorKey(shotId, 'maya', 'start', { joints: undefined }));
    expect(startKey(cleared, shotId)).not.toHaveProperty('joints');
  });

  it('a still character holds the pose through the shot', () => {
    const track = { mode: 'static' as const, start: { position: [0, 0, 0] as [number, number, number], yaw: 0, pose: 'standing' as const, joints: CROUCH }, easing: 'linear' as const };
    expect(sampleActor(track, 0.5).joints).toEqual(CROUCH);
  });

  it('comic heads follow the posed head', () => {
    const [p0, shotId] = setup();
    const [before] = panelHeads(p0, p0.shots[0]);
    const [p] = runCommand(p0, emptyHistory(), setActorKey(shotId, 'maya', 'start', { joints: CROUCH }));
    const [after] = panelHeads(p, p.shots[0]);
    // Bent over: the head is lower in the frame.
    expect(after.y).toBeGreaterThan(before.y + 0.05);
    expect(after.mouth.y).toBeGreaterThan(after.y);
  });
});
