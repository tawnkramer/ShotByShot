import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { emptyHistory, runCommand, undo, type Command } from '../src/state/commands';
import { createProject, projectSchema, type Project } from '../src/state/schema';
import { importScript } from '../src/story/commands';
import { SAMPLE_SCRIPT } from '../src/story/sample';
import { addCharacters, updateCharacter } from '../src/characters/commands';
import { addObject, createStagesForScenes, IDENTITY } from '../src/staging/commands';
import { worldRect } from '../src/staging/placement';
import { captionAt, captionsFor, estimateDuration, lerpAngle, lerpCamera, sample, sampleActor } from '../src/shots/timing';
import { charactersInShot, effectiveShots, sceneLineOf, shotLines, speakersInShot, stageIdFor } from '../src/shots/setup';
import { dialogueSplitPoints, mergeWithNext, setActorKey, setCamera, setCameraFixed, setDuration, splitShot } from '../src/shots/commands';
import { applyCamera, cameraPosition, frameSubjects, lensToVFov, moveCamera, panCamera } from '../src/three/camera';

function project(): Project {
  let [p, h] = runCommand(createProject('T'), emptyHistory(), importScript(SAMPLE_SCRIPT));
  const cmds: Command[] = [addCharacters(['Maya', 'Dex'], ['maya', 'dex']), updateCharacter('maya', { sex: 'female', heightCm: 165 }), createStagesForScenes(p).command];
  for (const c of cmds) [p, h] = runCommand(p, h, c);
  return p;
}
const run = (p: Project, ...cmds: Command[]) => {
  let h = emptyHistory();
  for (const c of cmds) [p, h] = runCommand(p, h, c);
  return [p, h] as const;
};
const shotWith = (p: Project, text: string) => p.shots.find((s) => shotLines(p, s).some((l) => l.text.startsWith(text)))!;

describe('timing', () => {
  it('estimates duration from dialogue and action', () => {
    const p = project();
    const exchange = shotWith(p, "We're closed.");
    const d = estimateDuration(shotLines(p, exchange));
    expect(d).toBeGreaterThan(1.5);
    expect(d).toBeLessThan(5);
  });

  it('lays captions across the shot in order without overlap', () => {
    const p = project();
    const shot = shotWith(p, "We're closed.");
    const caps = captionsFor(shotLines(p, shot), 4);
    expect(caps.map((c) => c.speaker)).toEqual(['Maya', 'Dex']);
    expect(caps[0].inSec).toBeGreaterThan(0);
    expect(caps[0].outSec).toBeCloseTo(caps[1].inSec);
    expect(caps[1].outSec).toBeCloseTo(4);
    expect(captionAt(caps, 0.05)).toBeUndefined();
    expect(captionAt(caps, 3.9)?.speaker).toBe('Dex');
  });

  it('skips parentheticals in captions', () => {
    const p = project();
    const shot = shotWith(p, 'They found the boat');
    expect(captionsFor(shotLines(p, shot), 3).map((c) => c.text)).toEqual(['They found the boat, Maya. They found Ray.']);
  });

  it('interpolates angles the short way and distance in log space', () => {
    expect(lerpAngle(350, 10, 0.5)).toBeCloseTo(360);
    const a = { target: [0, 1, 0] as [number, number, number], azimuth: 0, elevation: 0, distance: 1, lens: 35, roll: 0 };
    const mid = lerpCamera(a, { ...a, distance: 4 }, 0.5);
    expect(mid.distance).toBeCloseTo(2);
  });

  it('samples tracks with easing and walks between distant keyframes', () => {
    const track = { mode: 'moving' as const, start: { position: [0, 0, 0] as [number, number, number], yaw: 0, pose: 'standing' as const }, end: { position: [4, 0, 0] as [number, number, number], yaw: 90, pose: 'sitting' as const }, easing: 'linear' as const };
    expect(sampleActor(track, 0.5).position[0]).toBeCloseTo(2);
    expect(sampleActor(track, 0.5).walkPhase).toBeDefined();
    expect(sampleActor(track, 1).pose).toBe('sitting');
    expect(sample({ mode: 'static', start: 1, easing: 'linear' }, 0.7, (a, b, u) => a + (b - a) * u)).toBe(1);
  });
});

describe('default setup', () => {
  it('finds the stage, speakers and named characters for a shot', () => {
    const p = project();
    const shot = shotWith(p, "We're closed.");
    expect(sceneLineOf(p, shot)?.text).toBe('INT. DOCKSIDE BAR - NIGHT');
    expect(p.stages.find((s) => s.id === stageIdFor(p, shot))?.name).toBe('Dockside Bar');
    expect(speakersInShot(p, shot)).toEqual(['maya', 'dex']);
    expect(charactersInShot(p, shotWith(p, 'Dex slides onto'))).toEqual(['dex']);
  });

  it('places two speakers who first appear together facing each other', () => {
    let [p] = run(createProject('T'), importScript('INT. ROOM - DAY\n\nMAYA\nHi.\n\nDEX\nHey.'));
    [p] = run(p, addCharacters(['Maya', 'Dex'], ['maya', 'dex']), createStagesForScenes(p).command);
    const [a, b] = effectiveShots(p).get(p.shots[0].id)!.setup.actors.map((x) => x.motion.start);
    expect(a.yaw).toBe(90);
    expect(b.yaw).toBe(-90);
  });

  it('places characters clear of set pieces', () => {
    let [p] = run(createProject('T'), importScript('INT. BAR - NIGHT\n\nMAYA\nHi.\n\nDEX\nHey.'));
    [p] = run(p, addCharacters(['Maya', 'Dex'], ['maya', 'dex']), createStagesForScenes(p).command);
    [p] = run(p, addObject(p.stages[0].id, { kind: 'library', item: 'bar' }, IDENTITY, 'bar'));
    const bar = worldRect(p.stages[0].objects[0]);
    for (const a of effectiveShots(p).get(p.shots[0].id)!.setup.actors) {
      const [x, , z] = a.motion.start.position;
      const inside = x > bar.minX - 0.3 && x < bar.maxX + 0.3 && z > bar.minZ - 0.3 && z < bar.maxZ + 0.3;
      expect(inside).toBe(false);
    }
  });

  it('carries characters into later shots on the same stage', () => {
    const p = project();
    const eff = effectiveShots(p);
    const exchange = eff.get(shotWith(p, "We're closed.").id)!;
    expect(exchange.setup.actors.map((x) => x.characterId).sort()).toEqual(['dex', 'maya']);
    const later = eff.get(shotWith(p, "Door's a liar.").id)!;
    expect(later.setup.actors).toEqual(exchange.setup.actors);
  });

  it('points the camera at a lone speaker from in front of them', () => {
    const p = project();
    const eff = effectiveShots(p).get(shotWith(p, "Door's a liar.").id)!;
    const maya = eff.setup.actors.find((a) => a.characterId === 'maya')!.motion.start;
    const cam = eff.camera.start;
    const pos = cameraPosition(cam);
    const facing = new THREE.Vector3(Math.sin((maya.yaw * Math.PI) / 180), 0, Math.cos((maya.yaw * Math.PI) / 180));
    const toCam = pos.clone().sub(new THREE.Vector3(...maya.position)).setY(0).normalize();
    expect(facing.dot(toCam)).toBeGreaterThan(0.7);
  });

  it('keeps every shot valid when the defaults are made explicit', () => {
    const p = project();
    const [q] = run(p, setDuration(p.shots[0].id, 3), setCamera(p.shots[1].id, 'start', effectiveShots(p).get(p.shots[1].id)!.camera.start));
    expect(() => projectSchema.parse(q)).not.toThrow();
    expect(q.shots[1].setup).toBeDefined();
    expect(q.shots[1].stageId).toBeDefined();
  });
});

describe('shot commands', () => {
  it('editing End makes a character move; undo restores the derived setup', () => {
    const p = project();
    const shot = shotWith(p, "We're closed.");
    const [q, h] = run(p, setActorKey(shot.id, 'maya', 'end', { position: [-2, 0, 1] }));
    const maya = q.shots.find((s) => s.id === shot.id)!.setup!.actors.find((a) => a.characterId === 'maya')!;
    expect(maya.motion.mode).toBe('moving');
    expect(maya.motion.end!.position).toEqual([-2, 0, 1]);
    expect(maya.motion.start.position).toEqual(effectiveShots(p).get(shot.id)!.setup.actors.find((a) => a.characterId === 'maya')!.motion.start.position);
    const [back] = undo(q, h);
    expect(back.shots.find((s) => s.id === shot.id)!.setup).toBeUndefined();
  });

  it('animates and fixes the camera', () => {
    const p = project();
    const id = p.shots[0].id;
    const cam = effectiveShots(p).get(id)!.camera.start;
    let [q] = run(p, setCamera(id, 'end', { ...cam, distance: cam.distance / 2 }));
    expect(q.shots[0].camera!.mode).toBe('moving');
    [q] = run(q, setCameraFixed(id));
    expect(q.shots[0].camera!.mode).toBe('static');
    expect(q.shots[0].camera!.end).toBeUndefined();
  });

  it('merges with the next shot and renumbers', () => {
    const p = project();
    const [q] = run(p, mergeWithNext(p.shots[0].id));
    expect(q.shots).toHaveLength(p.shots.length - 1);
    expect(q.shots[0].lineIds).toEqual([...p.shots[0].lineIds, ...p.shots[1].lineIds]);
    expect(q.shots[1].number).toBe('1.2');
  });

  it('splits a shot by dialogue, copying its setup', () => {
    const p = project();
    const shot = shotWith(p, "We're closed.");
    const points = dialogueSplitPoints(p, shot);
    expect(points).toHaveLength(1);
    const [q] = run(p, setDuration(shot.id, 6), splitShot(shot.id, points));
    expect(q.shots).toHaveLength(p.shots.length + 1);
    const i = q.shots.findIndex((s) => s.id === shot.id);
    expect(q.shots[i + 1].setup).toEqual(q.shots[i].setup);
    expect(q.shots[i].durationLocked).toBeUndefined();
    expect(() => projectSchema.parse(q)).not.toThrow();
  });
});

describe('camera math', () => {
  it('converts lens to field of view', () => {
    expect(lensToVFov(36, 1)).toBeCloseTo(53.13, 1);
    expect(lensToVFov(50, 16 / 9)).toBeLessThan(lensToVFov(50, 9 / 16));
  });

  it('places and aims the camera from its orbit state', () => {
    const s = { target: [0, 1, 0] as [number, number, number], azimuth: 90, elevation: 0, distance: 3, lens: 35, roll: 0 };
    const cam = new THREE.PerspectiveCamera();
    applyCamera(cam, s, 16 / 9);
    expect(cam.position.x).toBeCloseTo(3);
    const dir = cam.getWorldDirection(new THREE.Vector3());
    expect(dir.x).toBeCloseTo(-1);
  });

  it('frames closer for tighter shot sizes', () => {
    const subj = [{ position: [0, 0, 0] as [number, number, number], height: 1.75, yaw: 0 }];
    const ws = frameSubjects(subj, 'WS', 16 / 9);
    const cu = frameSubjects(subj, 'CU', 16 / 9);
    expect(cu.distance).toBeLessThan(ws.distance);
    expect(cu.target[1]).toBeGreaterThan(ws.target[1]);
  });

  it('pans the target sideways in screen space', () => {
    const s = { target: [0, 1, 0] as [number, number, number], azimuth: 0, elevation: 0, distance: 3, lens: 35, roll: 0 };
    const moved = panCamera(s, 0.1, 0, 16 / 9);
    expect(Math.abs(moved.target[0])).toBeGreaterThan(0.1);
    expect(moved.target[2]).toBeCloseTo(0);
  });
});

describe('camera moves', () => {
  const s = { target: [0, 1.5, 0] as [number, number, number], azimuth: 30, elevation: 10, distance: 4, lens: 35, roll: 0 };
  const view = (c: typeof s) => {
    const cam = new THREE.PerspectiveCamera();
    applyCamera(cam, c, 16 / 9);
    return cam;
  };

  it('pans, dollies and cranes without turning the camera', () => {
    const before = view(s);
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(before.quaternion).setY(0).normalize();
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(before.quaternion);
    const cases: [Parameters<typeof moveCamera>[1], THREE.Vector3][] = [
      [{ right: 1 }, right],
      [{ forward: 1 }, fwd],
      [{ up: 0.5 }, new THREE.Vector3(0, 0.5, 0)],
    ];
    for (const [move, expected] of cases) {
      const after = view(moveCamera(s, move));
      expect(after.position.clone().sub(before.position).distanceTo(expected)).toBeLessThan(1e-6);
      expect(after.quaternion.angleTo(before.quaternion)).toBeLessThan(1e-6);
    }
  });

  it('keeps the aim above the floor when craning down', () => {
    expect(moveCamera(s, { up: -5 }).target[1]).toBe(0);
  });
});
