import type { ActorKey, CameraState, Project, ScriptLine, Shot, ShotCamera, ShotSetup, Stage } from '../state/schema';
import { freeSpotFor, type Rect } from '../staging/placement';
import { ASPECT_RATIOS } from '../state/schema';
import { cueName, speakerOf } from '../story/classify';
import { frameSubjects, type ShotSize, type Subject } from '../three/camera';
import { autoDuration, shotCaptions, type Caption } from './timing';
import { validClips } from '../audio/clips';

export function aspectOf(project: Project): number {
  return ASPECT_RATIOS.find((a) => a.id === project.aspect)!.ratio;
}

export function shotLines(project: Project, shot: Shot): ScriptLine[] {
  const ids = new Set(shot.lineIds);
  return project.script.filter((l) => ids.has(l.id));
}

/** The scene heading a shot belongs to. */
export function sceneLineOf(project: Project, shot: Shot): ScriptLine | undefined {
  let scene: ScriptLine | undefined;
  for (const l of project.script) {
    if (l.type === 'scene') scene = l;
    if (l.id === shot.lineIds[0]) return scene;
  }
  return scene;
}

export function stageIdFor(project: Project, shot: Shot): string | undefined {
  if (shot.stageId && project.stages.some((s) => s.id === shot.stageId)) return shot.stageId;
  const scene = sceneLineOf(project, shot);
  const linked = scene && project.stages.find((s) => s.sceneLineIds.includes(scene.id));
  return (linked ?? project.stages[0])?.id;
}

/** Characters who speak in the shot, then characters named in its action lines. */
export function charactersInShot(project: Project, shot: Shot): string[] {
  const lines = shotLines(project, shot);
  const byName = new Map(project.characters.map((c) => [c.name.toUpperCase(), c.id]));
  const ids: string[] = [];
  const add = (id?: string) => id && !ids.includes(id) && ids.push(id);
  for (const l of lines) if (l.type === 'character') add(byName.get(cueName(l.text)));
  for (const l of lines) {
    if (l.type !== 'action') continue;
    for (const c of project.characters) if (new RegExp(`\\b${escapeRe(c.name)}\\b`, 'i').test(l.text)) add(c.id);
  }
  return ids;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Speakers of the shot's dialogue, in order of first line. */
export function speakersInShot(project: Project, shot: Shot): string[] {
  const lines = shotLines(project, shot);
  const byName = new Map(project.characters.map((c) => [c.name.toUpperCase(), c.id]));
  const out: string[] = [];
  for (const name of speakerOf(lines).values()) {
    const id = byName.get(name);
    if (id && !out.includes(id)) out.push(id);
  }
  return out;
}

const still = (k: ActorKey) => ({ mode: 'static' as const, start: k, easing: 'easeInOut' as const });

const PERSON = { hx: 0.3, hz: 0.3 };

function personRect(p: [number, number, number]): Rect {
  return { minX: p[0] - PERSON.hx, maxX: p[0] + PERSON.hx, minZ: p[2] - PERSON.hz, maxZ: p[2] + PERSON.hz };
}

/**
 * Places characters who aren't in the setup yet, clear of the set: two
 * newcomers face each other; others join beside whoever is there, facing
 * the front of the stage (+Z).
 */
function placeNew(existing: ShotSetup['actors'], ids: string[], stage?: Stage): ShotSetup['actors'] {
  const out = [...existing];
  const missing = ids.filter((id) => !out.some((a) => a.characterId === id));
  if (!missing.length) return out;
  if (!out.length && missing.length === 2) {
    // A pair 1.2 m apart needs about 1.8 × 0.7 m of floor.
    const [x, , z] = freeSpotFor(stage, { hx: 0.9, hz: 0.35 });
    return [
      { characterId: missing[0], motion: still({ position: [x - 0.6, 0, z], yaw: 90, pose: 'standing' }) },
      { characterId: missing[1], motion: still({ position: [x + 0.6, 0, z], yaw: -90, pose: 'standing' }) },
    ];
  }
  for (const id of missing) {
    const others = out.map((a) => a.motion.start.position);
    const cx = others.length ? others.reduce((s, p) => s + p[0], 0) / others.length : 0;
    const cz = others.length ? others.reduce((s, p) => s + p[2], 0) / others.length : 0;
    const position = freeSpotFor(stage, PERSON, [cx, cz], others.map(personRect));
    // Turn slightly toward the group, but stay open to the front.
    const yaw = others.length ? Math.max(-45, Math.min(45, (Math.atan2(cx - position[0], 1.5) * 180) / Math.PI)) : 0;
    out.push({ characterId: id, motion: still({ position, yaw: Math.round(yaw), pose: 'standing' }) });
  }
  return out;
}

/** Freezes everyone where the previous shot left them. */
function carryOver(setup: ShotSetup): ShotSetup {
  return {
    actors: setup.actors.map((a) => ({ characterId: a.characterId, motion: still(a.motion.mode === 'moving' && a.motion.end ? a.motion.end : a.motion.start) })),
    props: setup.props.map((p) => ({ ...p, motion: { mode: 'static', start: p.motion.mode === 'moving' && p.motion.end ? p.motion.end : p.motion.start, easing: p.motion.easing } })),
    stageOverrides: structuredClone(setup.stageOverrides),
  };
}

export function subjectsFor(project: Project, setup: ShotSetup, ids?: string[]): Subject[] {
  return setup.actors
    .filter((a) => !ids || ids.includes(a.characterId))
    .map((a) => {
      const c = project.characters.find((x) => x.id === a.characterId);
      const k = a.motion.start;
      const h = (c?.heightCm ?? 172) / 100;
      return { position: k.position, yaw: k.yaw, height: k.pose === 'sitting' ? h * 0.72 : k.pose === 'lying' ? 0.4 : h };
    });
}

/** A sensible first camera: on the speaker if one person talks, otherwise everyone. */
export function autoCamera(project: Project, shot: Shot, setup: ShotSetup): CameraState {
  const aspect = aspectOf(project);
  const speakers = speakersInShot(project, shot).filter((id) => setup.actors.some((a) => a.characterId === id));
  if (speakers.length === 1 && setup.actors.length > 1) {
    const [s] = subjectsFor(project, setup, speakers);
    // Slightly off-axis so it reads as shot / reverse-shot.
    return frameSubjects([s], 'MCU', aspect, { azimuth: s.yaw + 25 });
  }
  const all = subjectsFor(project, setup);
  if (!all.length) return frameSubjects([], 'EWS', aspect);
  const size: ShotSize = all.length === 1 ? 'MS' : 'WS';
  // Face the group from the stage's front (+Z) unless everyone is turned away.
  const azimuth = all.length === 2 && Math.abs(Math.abs(all[0].yaw - all[1].yaw) - 180) < 30 ? 0 : all.length === 1 ? all[0].yaw : 0;
  return frameSubjects(all, size, aspect, { azimuth });
}

export interface EffectiveShot {
  stageId?: string;
  setup: ShotSetup;
  camera: ShotCamera;
  durationSec: number;
}

const cache = new WeakMap<Project, Map<string, EffectiveShot>>();
const clipCache = new WeakMap<Project, ReturnType<typeof validClips>>();

function clipsOf(project: Project) {
  let c = clipCache.get(project);
  if (!c) clipCache.set(project, (c = validClips(project)));
  return c;
}

/** Captions for a shot, timed to its audio when its lines have been voiced. */
export function captionsOf(project: Project, shot: Shot, durationSec: number): Caption[] {
  return shotCaptions(shotLines(project, shot), durationSec, clipsOf(project));
}

/**
 * Every shot's setup, camera and duration: what's saved, or a default that
 * carries characters over from the previous shot on the same stage.
 */
export function effectiveShots(project: Project): Map<string, EffectiveShot> {
  const hit = cache.get(project);
  if (hit) return hit;
  const map = new Map<string, EffectiveShot>();
  const lastOnStage = new Map<string, ShotSetup>();
  for (const shot of project.shots) {
    const stageId = stageIdFor(project, shot);
    let setup = shot.setup;
    if (!setup) {
      const prev = stageId ? lastOnStage.get(stageId) : undefined;
      const base = prev ? carryOver(prev) : { actors: [], props: [], stageOverrides: {} };
      const stage = project.stages.find((s) => s.id === stageId);
      setup = { ...base, actors: placeNew(base.actors, charactersInShot(project, shot), stage) };
    }
    if (stageId) lastOnStage.set(stageId, setup);
    const camera: ShotCamera = shot.camera ?? { mode: 'static', start: autoCamera(project, shot, setup), easing: 'easeInOut' };
    const durationSec = shot.durationLocked && shot.durationSec ? shot.durationSec : autoDuration(shotLines(project, shot), clipsOf(project));
    map.set(shot.id, { stageId, setup, camera, durationSec });
  }
  cache.set(project, map);
  return map;
}

export function effectiveShot(project: Project, shotId: string): EffectiveShot | undefined {
  return effectiveShots(project).get(shotId);
}

/** The line that best describes a shot: its first spoken line or action, never a parenthetical. */
export function summaryLine(project: Project, shot: Shot): string {
  const lines = shotLines(project, shot);
  const l = lines.find((x) => (x.type === 'dialogue' && !/^\(.*\)$/.test(x.text.trim())) || x.type === 'action') ?? lines[0];
  return l?.text ?? '';
}
