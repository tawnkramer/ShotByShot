import { current, isDraft, type Draft } from 'immer';
import type { Command } from '../state/commands';
import { newId, type ActorKey, type CameraState, type Placement, type Project, type Shot, type StageOverride } from '../state/schema';
import { numberShots, toggleBreakBefore } from '../story/breakdown';
import { effectiveShot, shotLines } from './setup';
import { withKey } from './timing';

type Which = 'start' | 'end';

/** A plain copy of a value that may or may not be an Immer draft (new objects in this edit aren't). */
const plain = <T,>(x: T): T => (isDraft(x) ? (current(x as Draft<T>) as T) : x);

/**
 * Makes the shot's derived setup, camera and stage explicit so edits have
 * something to change. Called at the start of every shot command.
 */
function ensure(d: Draft<Project>, shotId: string): Draft<Shot> | undefined {
  const shot = d.shots.find((s) => s.id === shotId);
  if (!shot) return undefined;
  if (!shot.setup || !shot.camera || !shot.stageId) {
    const eff = effectiveShot(current(d) as Project, shotId);
    if (eff) {
      shot.setup ??= structuredClone(eff.setup);
      shot.camera ??= structuredClone(eff.camera);
      if (!shot.stageId && eff.stageId) shot.stageId = eff.stageId;
    }
  }
  return shot;
}

function shotCommand(label: string, shotId: string, fn: (shot: Draft<Shot>, d: Draft<Project>) => void, mergeKey?: string): Command {
  return {
    label,
    mergeKey,
    apply: (d) => {
      const shot = ensure(d, shotId);
      if (shot) fn(shot, d);
    },
  };
}

export function setShotStage(shotId: string, stageId: string): Command {
  return shotCommand('Change stage', shotId, (s) => {
    s.stageId = stageId;
    s.setup!.stageOverrides = {};
  });
}

export function addActor(shotId: string, characterId: string, at: Placement): Command {
  return shotCommand('Add character to shot', shotId, (s) => {
    if (s.setup!.actors.some((a) => a.characterId === characterId)) return;
    s.setup!.actors.push({ characterId, motion: { mode: 'static', start: { ...at, pose: 'standing' }, easing: 'easeInOut' } });
  });
}

export function removeActor(shotId: string, characterId: string): Command {
  return shotCommand('Remove character from shot', shotId, (s) => {
    s.setup!.actors = s.setup!.actors.filter((a) => a.characterId !== characterId);
  });
}

/** Changes one keyframe of a character. Editing End on a still character makes them move. */
export function setActorKey(shotId: string, characterId: string, which: Which, patch: Partial<ActorKey>, mergeKey?: string): Command {
  return shotCommand('Move character', shotId, (s) => {
    const a = s.setup!.actors.find((x) => x.characterId === characterId);
    if (!a) return;
    const base = which === 'end' ? (a.motion.end ?? a.motion.start) : a.motion.start;
    a.motion = withKey(plain(a.motion), which, { ...plain(base), ...patch } as ActorKey);
  }, mergeKey);
}

export function setActorStill(shotId: string, characterId: string): Command {
  return shotCommand('Stop character moving', shotId, (s) => {
    const a = s.setup!.actors.find((x) => x.characterId === characterId);
    if (!a) return;
    a.motion.mode = 'static';
    delete a.motion.end;
  });
}

export function addShotProp(shotId: string, propId: string, at: Placement, id = newId()): Command {
  return shotCommand('Add prop to shot', shotId, (s) => {
    s.setup!.props.push({ id, propId, motion: { mode: 'static', start: at, easing: 'easeInOut' } });
  });
}

export function removeShotProp(shotId: string, id: string): Command {
  return shotCommand('Remove prop from shot', shotId, (s) => {
    s.setup!.props = s.setup!.props.filter((p) => p.id !== id);
  });
}

export function setShotPropKey(shotId: string, id: string, which: Which, patch: Partial<Placement>): Command {
  return shotCommand('Move prop', shotId, (s) => {
    const p = s.setup!.props.find((x) => x.id === id);
    if (!p) return;
    const base = which === 'end' ? (p.motion.end ?? p.motion.start) : p.motion.start;
    p.motion = withKey(plain(p.motion), which, { ...plain(base), ...patch });
  });
}

export function setStageOverride(shotId: string, objectId: string, patch: StageOverride | null): Command {
  return shotCommand(patch ? 'Change set for this shot' : 'Reset to stage', shotId, (s) => {
    if (!patch) delete s.setup!.stageOverrides[objectId];
    else s.setup!.stageOverrides[objectId] = { ...s.setup!.stageOverrides[objectId], ...patch };
  });
}

/** Sets the camera at a keyframe. Setting End on a fixed camera makes it animated. */
export function setCamera(shotId: string, which: Which, state: CameraState, mergeKey?: string): Command {
  return shotCommand('Move camera', shotId, (s) => {
    s.camera = withKey(plain(s.camera!), which, state);
  }, mergeKey);
}

export function setCameraFixed(shotId: string): Command {
  return shotCommand('Fixed camera', shotId, (s) => {
    s.camera!.mode = 'static';
    delete s.camera!.end;
  });
}

export function setDuration(shotId: string, sec: number | null): Command {
  return {
    label: sec === null ? 'Automatic duration' : 'Change duration',
    apply: (d) => {
      const s = d.shots.find((x) => x.id === shotId);
      if (!s) return;
      if (sec === null) {
        delete s.durationLocked;
        delete s.durationSec;
      } else {
        s.durationSec = Math.max(0.5, Math.round(sec * 10) / 10);
        s.durationLocked = true;
      }
    },
  };
}

/** Joins a shot with the one after it. The first shot's setup and camera win. */
export function mergeWithNext(shotId: string): Command {
  return {
    label: 'Merge shots',
    apply: (d) => {
      const i = d.shots.findIndex((s) => s.id === shotId);
      if (i < 0 || i >= d.shots.length - 1) return;
      ensure(d, shotId);
      const [a, b] = [d.shots[i], d.shots[i + 1]];
      a.lineIds.push(...b.lineIds);
      if (a.durationLocked && b.durationLocked) a.durationSec = (a.durationSec ?? 0) + (b.durationSec ?? 0);
      else {
        delete a.durationLocked;
        delete a.durationSec;
      }
      d.shots.splice(i + 1, 1);
      d.shots = numberShots(current(d.script), current(d.shots), d.shotNumbering) as Draft<Shot>[];
    },
  };
}

/** Splits a shot before each of the given lines. New shots copy the setup and camera. */
export function splitShot(shotId: string, beforeLineIds: string[]): Command {
  return {
    label: 'Split shot',
    apply: (d) => {
      ensure(d, shotId);
      let shots = current(d.shots) as Shot[];
      for (const lineId of beforeLineIds) {
        const owner = shots.find((s) => s.lineIds.includes(lineId));
        if (!owner || owner.lineIds[0] === lineId) continue;
        shots = toggleBreakBefore(shots, lineId, newId);
      }
      // Durations were for the whole shot; let the pieces re-estimate.
      const script = current(d.script) as Project['script'];
      shots = shots.map((s) => (beforeLineIds.some((l) => s.lineIds.includes(l)) || s.id === shotId ? { ...s, durationLocked: undefined, durationSec: undefined } : s));
      d.shots = numberShots(script, shots.map(stripUndefined), d.shotNumbering) as Draft<Shot>[];
    },
  };
}

function stripUndefined<T extends object>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
}

/** Lines in a shot where a split makes sense: before each speech after the first. */
export function dialogueSplitPoints(project: Project, shot: Shot): string[] {
  const lines = shotLines(project, shot);
  const points: string[] = [];
  lines.forEach((l, i) => {
    if (i === 0) return;
    const prev = lines[i - 1];
    if (l.type === 'character' || (l.type === 'action' && prev.type !== 'action') || (l.type === 'dialogue' && prev.type !== 'character' && prev.type !== 'dialogue')) points.push(l.id);
  });
  return points;
}


/** Goes back to the automatic camera. */
export function resetCamera(shotId: string): Command {
  return {
    label: 'Automatic camera',
    apply: (d) => {
      const s = d.shots.find((x) => x.id === shotId);
      if (s) delete s.camera;
    },
  };
}
