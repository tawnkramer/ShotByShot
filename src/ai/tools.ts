import { z } from 'zod';
import type { Command } from '../state/commands';
import {
  AGE_BANDS, BUILDS, BREAKDOWN_MODES, COMPOSITE_SHAPES, LIBRARY_ITEMS, LINE_TYPES, POSES, PRIMITIVE_SHAPES, PROP_ITEMS, SEXES, STEPS,
  newId, type ActorKey, type CameraState, type ObjectSource, type Project, type Shot, type Stage, type Step,
} from '../state/schema';
import { applyBreakdown, editLineText, setLineTypes } from '../story/commands';
import { isFrontMatter, numberShots } from '../story/breakdown';
import { addObject, createStage, quatFromDegrees, eulerDegrees, removeObject, updateObject, placeProp } from '../staging/commands';
import { addCharacters, updateCharacter, type CharacterPatch } from '../characters/commands';
import { OPENAI_VOICES } from '../audio/voices';
import { addProp, updateProp } from '../props/commands';
import { addActor, addShotProp, mergeWithNext, setBlocking, removeActor, setActorKey, setCamera, setCameraFixed, setDuration, setShotPropKey, setShotStage, splitShot } from '../shots/commands';
import { aspectOf, effectiveShot, effectiveShots, poseHeight, sceneLineOf, shotLines, subjectsFor, type EffectiveShot } from '../shots/setup';
import { isContainer, objectExtent, worldRect, type Rect } from '../staging/placement';
import { SHEET_MOMENTS, type SheetMoment, type SheetView } from '../export/contactSheet';
import { skillById, skillsFor } from './skills';
import { cameraPosition, frameSubjects, lensToVFov, moveCamera, SHOT_SIZES, turnCamera, type ShotSize, type Subject } from '../three/camera';
import { bodyPosition, isGround } from '../shots/body';
import { checkCoverage, describeCoverage, formatFindings, lineSide, viewBlocker } from '../shots/coverage';
import { keyOf } from '../shots/timing';
import { linesNeedingAudio } from '../audio/clips';
import { useAudioJob } from '../audio/job';
import { LIBRARY } from '../three/library';


/** What a tool can see and do. Everything it changes goes through `dispatch`, so it can be undone. */
export interface ToolContext {
  project: () => Project;
  dispatch: (cmd: Command) => void;
  step: Step;
  shotId?: string;
  stageId: () => string | undefined;
  setStage: (id: string) => void;
  navigate: (path: string) => void;
  /** A JPEG data URL of the current 3D view, after it has redrawn. */
  snapshot: () => Promise<string | null>;
  /** Images to show the model after this round of tool calls. */
  attachImage: (dataUrl: string, caption: string) => void;
  /** Loads a skill for the rest of the turn. */
  setSkill?: (id: string) => void;
  /** Renders shots offscreen into one contact sheet (JPEG data URL): a row per shot, a column per moment. */
  renderSheet?: (shotIds: string[], moments: SheetMoment[], view: SheetView) => Promise<string | null>;
}

export interface Tool {
  name: string;
  description: string;
  schema: z.ZodType;
  run: (args: never, ctx: ToolContext) => string | Promise<string>;
}

function tool<S extends z.ZodType>(name: string, description: string, schema: S, run: (args: z.infer<S>, ctx: ToolContext) => string | Promise<string>): Tool {
  return { name, description, schema, run: run as Tool['run'] };
}

const num = z.number();
const yawDesc = 'Facing in degrees: 0 faces the front of the stage (+Z), 90 faces +X, -90 faces -X, 180 faces the back.';
const liftDesc = 'Extra height in meters (default 0). Rarely needed: people stand on the top of boxes, cylinders and planes (platforms, piers, steps) under them, and sit at the seat height of chairs and stools, automatically.';

// ---------- helpers ----------

const byName = <T extends { name: string }>(list: T[], name: string) => list.find((x) => x.name.toLowerCase() === name.trim().toLowerCase());

function currentStage(ctx: ToolContext, name?: string): Stage {
  const p = ctx.project();
  if (name) {
    const s = byName(p.stages, name);
    if (!s) throw new Error(`No stage named "${name}". Stages: ${p.stages.map((x) => x.name).join(', ') || 'none'}.`);
    return s;
  }
  const s = p.stages.find((x) => x.id === ctx.stageId()) ?? p.stages[0];
  if (!s) throw new Error('There are no stages yet. Create one first.');
  return s;
}

function shotByNumber(p: Project, number: string): Shot {
  const s = p.shots.find((x) => x.number.toLowerCase() === number.trim().toLowerCase());
  if (!s) throw new Error(`No shot ${number}.`);
  return s;
}

function lineId(p: Project, n: number): string {
  const l = p.script[n - 1];
  if (!l) throw new Error(`There is no line ${n} (the script has ${p.script.length}).`);
  return l.id;
}

function editorShot(ctx: ToolContext): Shot {
  const p = ctx.project();
  const s = ctx.shotId && p.shots.find((x) => x.id === ctx.shotId);
  if (!s) throw new Error('Open a shot first (open_shot).');
  return s;
}

function yawToward(from: [number, number, number], to: [number, number, number]): number {
  return Math.round((Math.atan2(to[0] - from[0], to[2] - from[2]) * 180) / Math.PI);
}

/** Where a named thing is in the shot (character start/end or stage object). */
function positionOf(p: Project, shot: Shot, name: string, at: 'start' | 'end'): [number, number, number] | null {
  const eff = effectiveShot(p, shot.id);
  if (!eff) return null;
  const c = byName(p.characters, name);
  const a = c && eff.setup.actors.find((x) => x.characterId === c.id);
  if (a) return keyOf(a.motion, at).position;
  const stage = p.stages.find((s) => s.id === eff.stageId);
  const o = stage && byName(stage.objects, name);
  return o ? eff.setup.stageOverrides[o.id]?.position ?? o.transform.position : null;
}

function sourceFrom(o: { item?: string; shape?: string; size?: Record<string, number> }): ObjectSource {
  if (o.item) return { kind: 'library', item: o.item as (typeof LIBRARY_ITEMS)[number], params: o.size };
  if (o.shape) return { kind: 'primitive', shape: o.shape as (typeof PRIMITIVE_SHAPES)[number], params: o.size };
  throw new Error('Each object needs an item or a shape.');
}

// ---------- shared ----------

const goToStep = tool('go_to_step', 'Switch the app to another workflow step.', z.object({ step: z.enum(STEPS) }), (a, ctx) => {
  ctx.navigate(`/p/${ctx.project().id}/${a.step}`);
  return `Opened ${a.step}. Its tools are available on your next message.`;
});

const openShot = tool('open_shot', 'Open a shot in the shot editor by its number exactly as listed.', z.object({ number: z.string() }), (a, ctx) => {
  const s = shotByNumber(ctx.project(), a.number);
  ctx.navigate(`/p/${ctx.project().id}/shots/${s.id}`);
  return `Opened shot ${s.number}. Shot tools are available on your next message.`;
});

const snapshot = tool('snapshot', 'Look at the current 3D view to check your work. The image is shown to you after this call.', z.object({}), async (_a, ctx) => {
  const img = await ctx.snapshot();
  if (!img) return 'No 3D view is visible right now.';
  ctx.attachImage(img, 'Snapshot of the current view.');
  return 'Snapshot taken; it follows as an image.';
});

// ---------- story ----------

const setTypes = tool(
  'set_line_types',
  'Relabel script lines. Lines are numbered from 1 as shown in the context.',
  z.object({ changes: z.array(z.object({ line: z.int().positive(), type: z.enum(LINE_TYPES) })).min(1) }),
  (a, ctx) => {
    const p = ctx.project();
    const groups = new Map<string, string[]>();
    for (const c of a.changes) groups.set(c.type, [...(groups.get(c.type) ?? []), lineId(p, c.line)]);
    for (const [type, ids] of groups) ctx.dispatch(setLineTypes(ids, type as (typeof LINE_TYPES)[number]));
    return `Relabelled ${a.changes.length} lines.`;
  },
);

const setShotBreaks = tool(
  'set_shot_breaks',
  'Replace the shot breakdown. Give the line number where each shot starts, in order. A shot runs until the next start. Title and description lines are never in shots. Shots whose lines are unchanged keep their setups.',
  z.object({ starts: z.array(z.int().positive()).min(1) }),
  (a, ctx) => {
    const p = ctx.project();
    const starts = [...new Set(a.starts)].sort((x, y) => x - y);
    for (const n of starts) lineId(p, n);
    const existing = new Map(p.shots.map((s) => [s.lineIds.join(','), s]));
    const shots: Shot[] = [];
    starts.forEach((start, i) => {
      const end = starts[i + 1] ?? p.script.length + 1;
      const ids = p.script.slice(start - 1, end - 1).filter((l) => !isFrontMatter(l)).map((l) => l.id);
      if (!ids.length) return;
      shots.push(existing.get(ids.join(',')) ?? { id: newId(), number: '', lineIds: ids });
    });
    ctx.dispatch({ label: 'Set shot breaks', apply: (d) => void (d.shots = numberShots(d.script, shots, d.shotNumbering) as typeof d.shots) });
    return `Now ${shots.length} shots: ${ctx.project().shots.map((s) => s.number).join(', ')}.`;
  },
);

const breakdownMode = tool('use_breakdown_mode', 'Re-run a rule-based breakdown: one shot per line, per two lines, or mixed.', z.object({ mode: z.enum(BREAKDOWN_MODES) }), (a, ctx) => {
  ctx.dispatch(applyBreakdown(a.mode));
  return `Broke the script down with "${a.mode}": ${ctx.project().shots.length} shots.`;
});

const editLine = tool('edit_line', "Change a script line's text.", z.object({ line: z.int().positive(), text: z.string().min(1) }), (a, ctx) => {
  ctx.dispatch(editLineText(lineId(ctx.project(), a.line), a.text));
  return `Line ${a.line} updated.`;
});

// ---------- staging ----------

const objectSpec = z.object({
  item: z.enum(LIBRARY_ITEMS).optional().describe('A library item.'),
  shape: z.enum(PRIMITIVE_SHAPES).optional().describe('Or a basic shape.'),
  prop: z.string().optional().describe("Or the name of one of the project's props."),
  name: z.string().optional(),
  x: num.describe('Meters; +X is to the right when looking from the front.'),
  z: num.describe('Meters; +Z is toward the front of the stage, -Z toward the back.'),
  y: num.optional().describe('Height of the base above the floor, e.g. 0.75 for something on a table.'),
  yaw: num.optional().describe(yawDesc),
  scale: num.positive().optional(),
  size: z.record(z.string(), num).optional().describe('Size parameters for the item, in meters (see the library list).'),
});

const createStageTool = tool(
  'create_stage',
  'Create a stage (a set) and switch to it. Optionally link it to scene heading lines.',
  z.object({ name: z.string().min(1), scene_lines: z.array(z.int().positive()).optional() }),
  (a, ctx) => {
    const id = newId();
    const p = ctx.project();
    ctx.dispatch(createStage(a.name, (a.scene_lines ?? []).map((n) => lineId(p, n)), id));
    ctx.setStage(id);
    return `Created stage "${a.name}" and switched to it.`;
  },
);

const selectStage = tool('select_stage', 'Switch to another stage.', z.object({ name: z.string() }), (a, ctx) => {
  const s = currentStage(ctx, a.name);
  ctx.setStage(s.id);
  return `Switched to "${s.name}".`;
});

const addObjects = tool(
  'add_objects',
  'Add set pieces, props or shapes to a stage. Put several in one call. A room is a floor plus back and side walls, centered at x=0, z=0.',
  z.object({ stage: z.string().optional(), objects: z.array(objectSpec).min(1) }),
  (a, ctx) => {
    const stage = currentStage(ctx, a.stage);
    const names: string[] = [];
    for (const o of a.objects) {
      if (o.prop) {
        const prop = byName(ctx.project().props, o.prop);
        if (!prop) throw new Error(`No prop named "${o.prop}".`);
        const id = newId();
        ctx.dispatch(placeProp(stage.id, prop, [o.x, o.y ?? 0, o.z], id));
        if (o.yaw) ctx.dispatch(updateObject(stage.id, id, { transform: { rotation: quatFromDegrees([0, o.yaw, 0]) } }));
        names.push(prop.name);
        continue;
      }
      const source = sourceFrom(o);
      const s = o.scale ?? 1;
      ctx.dispatch(addObject(stage.id, source, { position: [o.x, o.y ?? 0, o.z], rotation: quatFromDegrees([0, o.yaw ?? 0, 0]), scale: [s, s, s] }, newId(), o.name));
      names.push(o.name ?? (o.item ? LIBRARY[o.item].label : o.shape!));
    }
    const added = currentStage(ctx, stage.name).objects.slice(-a.objects.length).map((o) => o.name);
    return `Added to "${stage.name}": ${added.join(', ')}.`;
  },
);

const updateObjects = tool(
  'update_objects',
  'Move, turn, resize, rename or reshade objects on a stage, by name. Only give the fields to change.',
  z.object({
    stage: z.string().optional(),
    updates: z.array(z.object({ name: z.string(), new_name: z.string().optional(), x: num.optional(), y: num.optional(), z: num.optional(), yaw: num.optional(), scale: num.positive().optional(), size: z.record(z.string(), num).optional(), shade: z.number().min(0).max(1).optional() })).min(1),
  }),
  (a, ctx) => {
    const stage = currentStage(ctx, a.stage);
    for (const u of a.updates) {
      const o = byName(currentStage(ctx, stage.name).objects, u.name);
      if (!o) throw new Error(`No object named "${u.name}" on "${stage.name}".`);
      const [x, y, zz] = o.transform.position;
      const rot = eulerDegrees(o.transform);
      ctx.dispatch(
        updateObject(stage.id, o.id, {
          name: u.new_name,
          grey: u.shade,
          params: u.size,
          transform: {
            position: [u.x ?? x, u.y ?? y, u.z ?? zz],
            ...(u.yaw !== undefined ? { rotation: quatFromDegrees([rot[0], u.yaw, rot[2]]) } : {}),
            ...(u.scale !== undefined ? { scale: [u.scale, u.scale, u.scale] as [number, number, number] } : {}),
          },
        }),
      );
    }
    return `Updated ${a.updates.length} objects.`;
  },
);

const removeObjects = tool('remove_objects', 'Remove objects from a stage by name.', z.object({ stage: z.string().optional(), names: z.array(z.string()).min(1) }), (a, ctx) => {
  const stage = currentStage(ctx, a.stage);
  const missing: string[] = [];
  for (const n of a.names) {
    const o = byName(currentStage(ctx, stage.name).objects, n);
    if (o) ctx.dispatch(removeObject(stage.id, o.id));
    else missing.push(n);
  }
  return missing.length ? `Removed the rest; not found: ${missing.join(', ')}.` : `Removed ${a.names.length} objects.`;
});

// ---------- characters ----------

const characterFields = {
  sex: z.enum(SEXES).optional(),
  height_cm: z.number().min(80).max(230).optional(),
  build: z.enum(BUILDS).optional(),
  age: z.enum(AGE_BANDS).optional(),
  notes: z.array(z.string()).optional(),
  voice: z.enum(OPENAI_VOICES).optional(),
  voice_speed: z.number().min(0.5).max(2).optional(),
  voice_style: z.string().optional().describe('Speaking style, e.g. "gravelly, tired".'),
};

function characterPatch(p: Project, name: string, a: { sex?: string; height_cm?: number; build?: string; age?: string; notes?: string[]; voice?: string; voice_speed?: number; voice_style?: string }): CharacterPatch {
  const c = byName(p.characters, name);
  const patch: CharacterPatch = {};
  if (a.sex) patch.sex = a.sex as CharacterPatch['sex'];
  if (a.height_cm) patch.heightCm = a.height_cm;
  if (a.build) patch.build = a.build as CharacterPatch['build'];
  if (a.age) patch.ageBand = a.age as CharacterPatch['ageBand'];
  if (a.notes) patch.attributes = a.notes;
  if (c && (a.voice || a.voice_speed || a.voice_style !== undefined)) {
    patch.voice = { ...c.voice, provider: 'openai', voiceId: a.voice ?? c.voice.voiceId, speed: a.voice_speed ?? c.voice.speed, instructions: a.voice_style ?? c.voice.instructions };
  }
  return patch;
}

const addCharactersTool = tool(
  'add_characters',
  'Add characters (or update them if the name exists).',
  z.object({ characters: z.array(z.object({ name: z.string().min(1), ...characterFields })).min(1) }),
  (a, ctx) => {
    for (const c of a.characters) {
      if (!byName(ctx.project().characters, c.name)) ctx.dispatch(addCharacters([c.name]));
      const id = byName(ctx.project().characters, c.name)!.id;
      // Sex first so its automatic voice choice can be overridden by an explicit voice.
      if (c.sex) ctx.dispatch(updateCharacter(id, { sex: c.sex }));
      const patch = characterPatch(ctx.project(), c.name, { ...c, sex: undefined });
      if (Object.keys(patch).length) ctx.dispatch(updateCharacter(id, patch));
    }
    return `Characters now: ${ctx.project().characters.map((c) => c.name).join(', ')}.`;
  },
);

const updateCharacterTool = tool('update_character', 'Change a character.', z.object({ name: z.string(), new_name: z.string().optional(), ...characterFields }), (a, ctx) => {
  const c = byName(ctx.project().characters, a.name);
  if (!c) throw new Error(`No character named "${a.name}".`);
  if (a.sex) ctx.dispatch(updateCharacter(c.id, { sex: a.sex }));
  const patch = characterPatch(ctx.project(), a.name, { ...a, sex: undefined });
  if (a.new_name) patch.name = a.new_name;
  if (Object.keys(patch).length) ctx.dispatch(updateCharacter(c.id, patch));
  return `Updated ${a.new_name ?? c.name}.`;
});

// ---------- props ----------

const addPropsTool = tool('add_props', 'Add library props to the project.', z.object({ props: z.array(z.object({ item: z.enum(PROP_ITEMS), name: z.string().optional() })).min(1) }), (a, ctx) => {
  for (const pr of a.props) ctx.dispatch(addProp({ kind: 'library', item: pr.item }, pr.name));
  return `Props now: ${ctx.project().props.map((x) => x.name).join(', ')}.`;
});

const part = z.object({
  shape: z.enum(COMPOSITE_SHAPES),
  size: z.tuple([num.positive(), num.positive(), num.positive()]).describe('Full size in meters [x, y, z]. Cylinder/cone/sphere: x and z are diameters, y is height. Torus lies flat: x/z outer diameter, y tube thickness.'),
  position: z.tuple([num, num, num]).describe('Center of the part in meters. +Y up, +Z is the front of the prop.'),
  rotation: z.tuple([num, num, num]).optional().describe('Degrees about X, Y, Z.'),
  shade: z.number().min(0).max(1).optional().describe('0 black … 1 white.'),
});

const modelProp = tool(
  'model_prop',
  'Build a prop from simple shapes (or replace the shapes of an existing prop with the same name). Use real-world sizes in meters. The model is set on the floor automatically. 3–30 parts is typical.',
  z.object({ name: z.string().min(1), parts: z.array(part).min(1).max(60), scale: num.positive().optional() }),
  (a, ctx) => {
    const nodes = a.parts.map((x) => ({ shape: x.shape, size: x.size, position: x.position, rotation: x.rotation, grey: x.shade }));
    const existing = byName(ctx.project().props, a.name);
    if (existing) {
      ctx.dispatch({
        label: `Remodel ${a.name}`,
        apply: (d) => {
          const pr = d.props.find((x) => x.id === existing.id);
          if (pr) pr.source = { kind: 'composite', nodes };
        },
      });
    } else ctx.dispatch(addProp({ kind: 'composite', nodes }, a.name));
    if (a.scale) ctx.dispatch(updateProp(byName(ctx.project().props, a.name)!.id, { defaultScale: a.scale }));
    return `${existing ? 'Remodelled' : 'Modelled'} "${a.name}" from ${nodes.length} parts.`;
  },
);

// ---------- shots ----------

const at = z.enum(['start', 'end']).optional().describe('Keyframe. Placing at "end" makes it move during the shot. Default start.');

const placeCharacters = tool(
  'place_characters',
  'Place characters in the open shot (adding them if needed). Use face to turn toward another character or object by name. People stand on platforms (boxes, cylinders, planes) and sit on chairs and bar stools at the right height automatically.',
  z.object({
    placements: z.array(z.object({ name: z.string(), x: num.optional(), z: num.optional(), y: num.optional().describe(liftDesc), yaw: num.optional().describe(yawDesc), face: z.string().optional(), pose: z.enum(POSES).optional(), at })).min(1),
  }),
  (a, ctx) => {
    const shot = editorShot(ctx);
    for (const pl of a.placements) {
      const c = byName(ctx.project().characters, pl.name);
      if (!c) throw new Error(`No character named "${pl.name}".`);
      const which = pl.at ?? 'start';
      const eff = effectiveShot(ctx.project(), shot.id)!;
      if (!eff.setup.actors.some((x) => x.characterId === c.id)) ctx.dispatch(addActor(shot.id, c.id, { position: [pl.x ?? 0, 0, pl.z ?? 0], yaw: pl.yaw ?? 0 }));
      const cur = keyOf(effectiveShot(ctx.project(), shot.id)!.setup.actors.find((x) => x.characterId === c.id)!.motion, which);
      const position: [number, number, number] = [pl.x ?? cur.position[0], pl.y ?? cur.position[1], pl.z ?? cur.position[2]];
      let yaw = pl.yaw ?? cur.yaw;
      if (pl.face) {
        const target = positionOf(ctx.project(), shot, pl.face, which);
        if (!target) throw new Error(`Can't find "${pl.face}" to face.`);
        yaw = yawToward(position, target);
      }
      ctx.dispatch(setActorKey(shot.id, c.id, which, { position, yaw, ...(pl.pose ? { pose: pl.pose } : {}) }));
    }
    return `Placed ${a.placements.map((x) => x.name).join(', ')}.`;
  },
);

const removeCharacters = tool('remove_characters', 'Take characters out of the open shot.', z.object({ names: z.array(z.string()).min(1) }), (a, ctx) => {
  const shot = editorShot(ctx);
  for (const n of a.names) {
    const c = byName(ctx.project().characters, n);
    if (c) ctx.dispatch(removeActor(shot.id, c.id));
  }
  return `Removed ${a.names.join(', ')} from the shot.`;
});

const placeShotProps = tool(
  'place_props',
  "Place the project's props in the open shot (adding them if needed). y lifts a prop, e.g. onto a table top.",
  z.object({ placements: z.array(z.object({ prop: z.string(), x: num, z: num, y: num.optional(), yaw: num.optional(), at })).min(1) }),
  (a, ctx) => {
    const shot = editorShot(ctx);
    for (const pl of a.placements) {
      const prop = byName(ctx.project().props, pl.prop);
      if (!prop) throw new Error(`No prop named "${pl.prop}".`);
      const eff = effectiveShot(ctx.project(), shot.id)!;
      const placement = { position: [pl.x, pl.y ?? 0, pl.z] as [number, number, number], yaw: pl.yaw ?? 0 };
      const existing = eff.setup.props.find((x) => x.propId === prop.id);
      if (existing) ctx.dispatch(setShotPropKey(shot.id, existing.id, pl.at ?? 'start', placement));
      else ctx.dispatch(addShotProp(shot.id, prop.id, placement));
    }
    return `Placed ${a.placements.map((x) => x.prop).join(', ')}.`;
  },
);

const frameCamera = tool(
  'frame_camera',
  `Frame the open shot's camera on characters at a shot size. Sizes: ${Object.entries(SHOT_SIZES).map(([k, v]) => `${k} (${v.label})`).join(', ')}.`,
  z.object({
    size: z.enum(Object.keys(SHOT_SIZES) as [ShotSize, ...ShotSize[]]),
    subjects: z.array(z.string()).optional().describe('Character names; default everyone in the shot.'),
    angle: num.optional().describe("Degrees around the first subject from where they face: 0 straight on, 30 off to their left, -30 to their right, 150 over their shoulder from behind."),
    height: z.enum(['eye', 'high', 'low']).optional(),
    lens: z.number().min(12).max(200).optional().describe('Focal length in mm (full frame).'),
    at,
  }),
  (a, ctx) => {
    const shot = editorShot(ctx);
    const p = ctx.project();
    const eff = effectiveShot(p, shot.id)!;
    const ids = a.subjects?.map((n) => {
      const c = byName(p.characters, n);
      if (!c) throw new Error(`No character named "${n}".`);
      return c.id;
    });
    const subjects = subjectsFor(p, eff.setup, ids, eff.stageId);
    if (!subjects.length) throw new Error('Nobody to frame: add characters to the shot first.');
    const elevation = a.height === 'high' ? 25 : a.height === 'low' ? -12 : undefined;
    const cam = frameSubjects(subjects, a.size, aspectOf(p), { azimuth: subjects[0].yaw + (a.angle ?? 0), elevation, lens: a.lens });
    ctx.dispatch(setCamera(shot.id, a.at ?? 'start', cam));
    return `Camera: ${a.size} on ${a.subjects?.join(' and ') ?? 'everyone'}, ${Math.round(cam.lens)} mm at ${cam.distance.toFixed(1)} m.`;
  },
);

const setCameraTool = tool(
  'set_camera',
  'Adjust the open shot camera directly. Only give fields to change. Absolute settings apply first, then the relative moves (truck, dolly, crane, pan, tilt) from there.',
  z.object({
    arc: num.optional().describe('Degrees around the target; 0 = camera at the front (+Z) looking back.'),
    angle: num.optional().describe('Degrees above (+, high angle) or below (-, low angle) the target.'),
    distance: num.positive().optional(),
    lens: z.number().min(12).max(200).optional(),
    height: num.optional().describe('Height of the point the camera looks at, in meters.'),
    target: z.tuple([num, num, num]).optional(),
    dutch: num.optional().describe('Dutch angle (roll) in degrees.'),
    truck: num.optional().describe('Slide the camera right (+) or left (-), in meters, without turning it.'),
    dolly: num.optional().describe('Push in (+) or pull out (-) along the ground, in meters, without turning.'),
    crane: num.optional().describe('Raise (+) or lower (-) the camera, in meters, without turning.'),
    pan: num.optional().describe('Turn the camera right (+) or left (-) where it stands, in degrees.'),
    tilt: num.optional().describe('Aim the camera up (+) or down (-) where it stands, in degrees.'),
    at,
  }),
  (a, ctx) => {
    const shot = editorShot(ctx);
    const eff = effectiveShot(ctx.project(), shot.id)!;
    const cur = keyOf(eff.camera, a.at ?? 'start');
    const target: [number, number, number] = a.target ?? [cur.target[0], a.height ?? cur.target[1], cur.target[2]];
    let next: CameraState = {
      target,
      azimuth: a.arc ?? cur.azimuth,
      elevation: Math.max(-80, Math.min(85, a.angle ?? cur.elevation)),
      distance: a.distance ?? cur.distance,
      lens: a.lens ?? cur.lens,
      roll: a.dutch ?? cur.roll,
    };
    if (a.truck || a.dolly || a.crane) next = moveCamera(next, { right: a.truck, forward: a.dolly, up: a.crane });
    if (a.pan || a.tilt) next = turnCamera(next, { pan: a.pan, tilt: a.tilt });
    ctx.dispatch(setCamera(shot.id, a.at ?? 'start', next));
    return 'Camera updated.';
  },
);

const cameraMode = tool('camera_mode', 'Make the open shot camera fixed, or moving (from its start framing to its end framing).', z.object({ mode: z.enum(['fixed', 'moving']) }), (a, ctx) => {
  const shot = editorShot(ctx);
  if (a.mode === 'fixed') ctx.dispatch(setCameraFixed(shot.id));
  else ctx.dispatch(setCamera(shot.id, 'end', { ...effectiveShot(ctx.project(), shot.id)!.camera.start }));
  return a.mode === 'fixed' ? 'Camera is fixed.' : 'Camera now moves; set its end framing with at: "end".';
});

const durationTool = tool('set_duration', 'Set the open shot length in seconds, or null for automatic.', z.object({ seconds: z.number().positive().nullable() }), (a, ctx) => {
  ctx.dispatch(setDuration(editorShot(ctx).id, a.seconds));
  return a.seconds ? `Shot is ${a.seconds} s.` : 'Shot length is automatic.';
});

const shotStage = tool('set_shot_stage', 'Use a different stage for a shot (the open one by default).', z.object({ stage: z.string(), shot: z.string().optional() }), (a, ctx) => {
  const p = ctx.project();
  const shot = a.shot ? shotByNumber(p, a.shot) : editorShot(ctx);
  ctx.dispatch(setShotStage(shot.id, currentStage(ctx, a.stage).id));
  return `Shot ${shot.number} now uses "${a.stage}".`;
});

const mergeTool = tool('merge_shots', 'Merge a shot with the one after it.', z.object({ number: z.string() }), (a, ctx) => {
  ctx.dispatch(mergeWithNext(shotByNumber(ctx.project(), a.number).id));
  return `Merged. Shots: ${ctx.project().shots.map((s) => s.number).join(', ')}.`;
});

const splitTool = tool('split_shot', 'Split a shot before the given line numbers.', z.object({ number: z.string(), before_lines: z.array(z.int().positive()).min(1) }), (a, ctx) => {
  const p = ctx.project();
  ctx.dispatch(splitShot(shotByNumber(p, a.number).id, a.before_lines.map((n) => lineId(p, n))));
  return `Split. Shots: ${ctx.project().shots.map((s) => s.number).join(', ')}.`;
});

const voiceTool = tool('voice_dialogue', "Generate spoken audio for every dialogue line that doesn't have it yet, using each character's voice.", z.object({}), (_a, ctx) => {
  const lines = linesNeedingAudio(ctx.project());
  if (!lines.length) return 'All dialogue is already voiced.';
  void useAudioJob.getState().start(lines);
  return `Started voicing ${lines.length} lines; progress shows in the Dialogue audio panel.`;
});


// ---------- skills ----------

function useSkillTool(step: Step): Tool | null {
  const skills = skillsFor(step);
  if (!skills.length) return null;
  return tool(
    'use_skill',
    `Load a skill's instructions (and the context it needs) for the rest of this reply. Skills: ${skills.map((s) => `${s.id}: ${s.description}`).join(' ')}`,
    z.object({ id: z.enum(skills.map((s) => s.id) as [string, ...string[]]) }),
    (a, ctx) => {
      const skill = skillById(a.id)!;
      ctx.setSkill?.(skill.id);
      return `Loaded ${skill.title}. Its instructions and the scene detail are now in the system prompt; follow them.`;
    },
  );
}

// ---------- whole-scene shots ----------

const keySpec = z.object({
  x: num.optional(),
  z: num.optional(),
  y: num.optional().describe(liftDesc),
  yaw: num.optional().describe(yawDesc),
  face: z.string().optional().describe('Turn toward a character in this shot, a stage object, or a prop in the shot, by name. Overrides yaw.'),
  pose: z.enum(POSES).optional(),
});

/** Things on the stage in this shot, with overrides (moved or hidden objects) applied. */
function obstaclesOf(stage: Stage | undefined, overrides: Record<string, { position?: [number, number, number]; hidden?: boolean }>) {
  return (stage?.objects ?? [])
    .filter((o) => !overrides[o.id]?.hidden)
    .map((o) => ({ o, rect: worldRect({ source: o.source, transform: { ...o.transform, position: overrides[o.id]?.position ?? o.transform.position } }) }));
}

const SEATS = new Set(['chair', 'stool']);
const isSeat = (o: Stage['objects'][number]) => o.source.kind === 'library' && SEATS.has(o.source.item);
const inside = (x: number, z: number, r: Rect, pad = 0) => x > r.minX - pad && x < r.maxX + pad && z > r.minZ - pad && z < r.maxZ + pad;
const BODY = 0.15;
const SEAT_REACH = 0.6;
const CONTINUITY_M = 0.5;
/** Action that moves someone during the shot. ("Sits" is left out: it usually describes a state.) */
const MOVES = /\b(walks?|walking|enters?|arrives?|leaves?|exits?|stands up|stands(?=[,.])|gets up|rises|retreats?|hurries|hurry|runs?|crosses|steps?|approach(?:es)?|drops into|sits down|turns away|goes)\b/i;

/** Action sentences that move someone the blocking leaves still. */
function movementProblems(p: Project, shot: Shot, actors: { characterId: string; motion: { mode: string } }[]): string[] {
  const out: string[] = [];
  const sentences = shotLines(p, shot).filter((l) => l.type === 'action').flatMap((l) => l.text.match(/[^.!?]+[.!?]*/g) ?? []).map((t) => t.trim());
  for (const text of sentences) {
    if (!MOVES.test(text)) continue;
    const quote = `"${text.length > 70 ? `${text.slice(0, 67)}…` : text}"`;
    const named = p.characters.filter((c) => new RegExp(`\\b${c.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(text));
    if (!named.length) {
      if (!actors.some((a) => a.motion.mode === 'moving')) out.push(`${quote} but nobody moves.`);
      continue;
    }
    for (const c of named) {
      const a = actors.find((x) => x.characterId === c.id);
      if (a && a.motion.mode !== 'moving') out.push(`${quote} but ${c.name} doesn't move (give them an end key).`);
    }
  }
  return out;
}

/** Problems with a character's key on this stage: inside furniture, outside the room, sitting on nothing. */
function keyProblems(name: string, k: { position: [number, number, number]; pose: string }, obstacles: ReturnType<typeof obstaclesOf>): string[] {
  const [x, , z] = k.position;
  const out: string[] = [];
  const at = `(x=${Math.round(x * 100) / 100} z=${Math.round(z * 100) / 100})`;
  for (const { o, rect } of obstacles) {
    if (isContainer(o.source)) {
      if (o.source.kind === 'library' && o.source.item === 'room' && !inside(x, z, rect)) out.push(`${name} is outside ${o.name} ${at}.`);
      continue;
    }
    // Seats are for sitting in, doorways for walking through, and platforms for standing on.
    if ((k.pose === 'sitting' && isSeat(o)) || (o.source.kind === 'library' && o.source.item === 'door')) continue;
    if (isGround(o)) continue;
    if (inside(x, z, rect, k.pose === 'sitting' || k.pose === 'lying' ? 0 : BODY)) out.push(`${name} is inside ${o.name} ${at}.`);
  }
  if (k.pose === 'sitting') {
    const seats = obstacles.filter(({ o }) => isSeat(o));
    if (seats.length && !seats.some(({ rect }) => inside(x, z, rect, SEAT_REACH))) out.push(`${name} sits ${at} with no chair or stool there.`);
  }
  return out;
}

const blockShots = tool(
  'block_shots',
  'Block several shots at once (no shot needs to be open). For each shot, list EVERYONE in it with a start key, and an end key only if they move during the shot; anyone not listed is taken out of that shot. Missing x/z/pose in an end key come from the start. Returns warnings to check.',
  z.object({
    shots: z.array(z.object({
      number: z.string(),
      stage: z.string().optional().describe('Switch this shot to another stage, by name.'),
      actors: z.array(z.object({ name: z.string(), start: keySpec, end: keySpec.optional() })),
      props: z.array(z.object({
        prop: z.string(), x: num, z: num, y: num.optional().describe('Height, e.g. 0.75 on a table.'), yaw: num.optional(),
        end: z.object({ x: num.optional(), z: num.optional(), y: num.optional(), yaw: num.optional() }).optional(),
      })).optional().describe('Props to place; props not listed stay as they are.'),
    })).min(1),
  }),
  (a, ctx) => {
    const p0 = ctx.project();
    // Check every name before changing anything.
    const plan = a.shots.map((s) => {
      const shot = shotByNumber(p0, s.number);
      const stage = s.stage ? currentStage(ctx, s.stage) : undefined;
      const actors = s.actors.map((x) => {
        const c = byName(p0.characters, x.name);
        if (!c) throw new Error(`No character named "${x.name}". Characters: ${p0.characters.map((y) => y.name).join(', ')}.`);
        return { c, spec: x };
      });
      const props = (s.props ?? []).map((x) => {
        const prop = byName(p0.props, x.prop);
        if (!prop) throw new Error(`No prop named "${x.prop}". Props: ${p0.props.map((y) => y.name).join(', ') || 'none'}.`);
        return { prop, spec: x };
      });
      return { shot, stage, actors, props };
    });
    // Facing targets too: characters in the shot, things on its stage, props in it.
    const eff0 = effectiveShots(p0);
    const listedProps = new Set<string>();
    for (const { shot, stage, actors, props } of plan) {
      for (const x of props) listedProps.add(x.prop.id);
      const e = eff0.get(shot.id)!;
      const objects = (stage ?? p0.stages.find((x) => x.id === e.stageId))?.objects ?? [];
      const propNames = p0.props.filter((x) => listedProps.has(x.id) || e.setup.props.some((y) => y.propId === x.id)).map((x) => x.name);
      const names = [...actors.map((x) => x.c.name), ...objects.map((o) => o.name), ...propNames];
      for (const { spec } of actors) {
        for (const face of [spec.start.face, spec.end?.face]) {
          if (face && !names.some((n) => n.toLowerCase() === face.trim().toLowerCase())) throw new Error(`Shot ${shot.number}: can't find "${face}" to face. Nothing was changed. Choose from: ${names.join(', ')}.`);
        }
      }
    }

    for (const { shot, stage, actors, props } of plan) {
      if (stage) ctx.dispatch(setShotStage(shot.id, stage.id));
      const eff = effectiveShot(ctx.project(), shot.id)!;
      const st = ctx.project().stages.find((x) => x.id === eff.stageId);
      const prev = (id: string) => eff.setup.actors.find((x) => x.characterId === id)?.motion.start;
      const keys = actors.map(({ c, spec }) => {
        const before = prev(c.id);
        const start: ActorKey = {
          position: [spec.start.x ?? before?.position[0] ?? 0, spec.start.y ?? before?.position[1] ?? 0, spec.start.z ?? before?.position[2] ?? 0],
          yaw: spec.start.yaw ?? before?.yaw ?? 0,
          pose: spec.start.pose ?? before?.pose ?? 'standing',
        };
        const end: ActorKey | undefined = spec.end && {
          position: [spec.end.x ?? start.position[0], spec.end.y ?? start.position[1], spec.end.z ?? start.position[2]],
          yaw: spec.end.yaw ?? start.yaw,
          pose: spec.end.pose ?? start.pose,
        };
        return { c, spec, start, end };
      });
      for (const { prop, spec } of props) {
        const placed = effectiveShot(ctx.project(), shot.id)!.setup.props.find((x) => x.propId === prop.id);
        const start = { position: [spec.x, spec.y ?? 0, spec.z] as [number, number, number], yaw: spec.yaw ?? 0 };
        if (placed) ctx.dispatch(setShotPropKey(shot.id, placed.id, 'start', start));
        else ctx.dispatch(addShotProp(shot.id, prop.id, start));
        if (spec.end) {
          const id = effectiveShot(ctx.project(), shot.id)!.setup.props.find((x) => x.propId === prop.id)!.id;
          ctx.dispatch(setShotPropKey(shot.id, id, 'end', { position: [spec.end.x ?? spec.x, spec.end.y ?? spec.y ?? 0, spec.end.z ?? spec.z], yaw: spec.end.yaw ?? start.yaw }));
        }
      }
      // Facing resolves against this shot's new positions, then the stage, then its props.
      const target = (name: string, which: 'start' | 'end'): [number, number, number] => {
        const other = keys.find((k) => k.c.name.toLowerCase() === name.trim().toLowerCase());
        if (other) return (which === 'end' ? other.end ?? other.start : other.start).position;
        const o = st && byName(st.objects, name);
        if (o) return eff.setup.stageOverrides[o.id]?.position ?? o.transform.position;
        const prop = byName(ctx.project().props, name);
        const placed = prop && effectiveShot(ctx.project(), shot.id)!.setup.props.find((x) => x.propId === prop.id);
        if (placed) return keyOf(placed.motion, which).position;
        throw new Error(`Shot ${shot.number}: can't find "${name}" to face.`);
      };
      for (const k of keys) {
        if (k.spec.start.face) k.start.yaw = yawToward(k.start.position, target(k.spec.start.face, 'start'));
        if (k.end && k.spec.end?.face) k.end.yaw = yawToward(k.end.position, target(k.spec.end.face, 'end'));
      }
      ctx.dispatch(setBlocking(shot.id, keys.map((k) => ({ characterId: k.c.id, start: k.start, end: k.end }))));
    }

    // Check the result, including continuity with the shot before on the same stage.
    const p = ctx.project();
    const all = effectiveShots(p);
    const warnings: string[] = [];
    for (const { shot } of plan) {
      const eff = all.get(shot.id)!;
      const stage = p.stages.find((x) => x.id === eff.stageId);
      const obstacles = obstaclesOf(stage, eff.setup.stageOverrides);
      const idx = p.shots.findIndex((x) => x.id === shot.id);
      const before = p.shots.slice(0, idx).reverse().find((x) => all.get(x.id)!.stageId === eff.stageId);
      const prevActors = before ? all.get(before.id)!.setup.actors : [];
      const name = (id: string) => p.characters.find((c) => c.id === id)?.name ?? '?';
      const problems: string[] = [];
      for (const actor of eff.setup.actors) {
        const n = name(actor.characterId);
        problems.push(...keyProblems(n, actor.motion.start, obstacles));
        if (actor.motion.mode === 'moving' && actor.motion.end) problems.push(...keyProblems(`${n} (end)`, actor.motion.end, obstacles));
        const was = prevActors.find((x) => x.characterId === actor.characterId);
        if (was) {
          const last = keyOf(was.motion, 'end');
          const d = Math.hypot(last.position[0] - actor.motion.start.position[0], last.position[2] - actor.motion.start.position[2]);
          // Walking into a shot standing (or the reverse) isn't a jump; sitting down off screen is.
          const posture = (pose: string) => (pose === 'walking' ? 'standing' : pose);
          if (d > CONTINUITY_M || posture(last.pose) !== posture(actor.motion.start.pose)) problems.push(`${n} starts ${d.toFixed(1)} m${posture(last.pose) !== posture(actor.motion.start.pose) ? `, ${actor.motion.start.pose} not ${last.pose},` : ''} from where shot ${before!.number} left them; fine only if the script moves them between shots.`);
        }
      }
      problems.push(...movementProblems(p, shot, eff.setup.actors));
      for (const [i, x] of eff.setup.actors.entries()) {
        for (const y of eff.setup.actors.slice(i + 1)) {
          const [ax, , az] = x.motion.start.position, [bx, , bz] = y.motion.start.position;
          if (Math.hypot(ax - bx, az - bz) < 0.45) problems.push(`${name(x.characterId)} and ${name(y.characterId)} overlap.`);
        }
      }
      if (problems.length) warnings.push(`Shot ${shot.number}: ${problems.join(' ')}`);
    }
    const done = `Blocked shots ${plan.map((x) => x.shot.number).join(', ')}.`;
    return warnings.length ? `${done}\nWarnings:\n${warnings.join('\n')}` : `${done} No problems found.`;
  },
);

// ---------- whole-scene camera ----------

const sizeEnum = z.enum(Object.keys(SHOT_SIZES) as [ShotSize, ...ShotSize[]]);
const heightEnum = z.enum(['eye', 'high', 'low']);
const lineSpec = z.object({
  from: z.string().describe('A character; or, for a walk, a character or the thing they walk to or from.'),
  to: z.string(),
  side: z.enum(['left', 'right']).describe('Which side of the line the camera stays on, as seen standing at "from" looking at "to".'),
});
const framingSpec = {
  subjects: z.array(z.string()).describe('Characters the shot is on, main one first. Empty for an insert (then give "on").'),
  on: z.string().optional().describe('For an insert: a prop in the shot or a stage object to frame.'),
  over: z.string().optional().describe('Over-the-shoulder: the character in the foreground, seen from behind.'),
  size: sizeEnum,
  angle: num.optional().describe('Degrees off straight-on, toward the line side (singles default 20; over-the-shoulder 15; two-shots 0 = square to the line).'),
  height: heightEnum.optional(),
  lens: z.number().min(12).max(200).optional().describe('mm; default 28 for WS/EWS, 50 otherwise.'),
};

/** Where characters are at a keyframe of the shot, as framing subjects. */
function subjectsAt(p: Project, eff: EffectiveShot, ids: string[], which: 'start' | 'end'): Subject[] {
  return ids.map((id) => {
    const a = eff.setup.actors.find((x) => x.characterId === id)!;
    const k = keyOf(a.motion, which);
    const c = p.characters.find((x) => x.id === id);
    return { position: bodyPosition(p.stages.find((s) => s.id === eff.stageId), eff.setup.stageOverrides, c, k), yaw: k.yaw, height: poseHeight(c?.heightCm, k.pose) };
  });
}

const bearing = (from: [number, number, number], to: [number, number, number]) => (Math.atan2(to[0] - from[0], to[2] - from[2]) * 180) / Math.PI;
/** How much of the frame an insert's object fills, by size. */
const INSERT_FILL: Record<ShotSize, number> = { ECU: 0.8, CU: 0.45, MCU: 0.3, MS: 0.18, WS: 0.07, EWS: 0.03 };

type Framing = { subjects: string[]; on?: string; over?: string; size: ShotSize; angle?: number; height?: 'eye' | 'high' | 'low'; lens?: number };

/**
 * Brings a camera that would sit behind a wall in front of it, widening the
 * lens to keep the framing. Gives up below 16 mm.
 */
function clearWalls(p: Project, eff: EffectiveShot, cam: CameraState): CameraState {
  if (!viewBlocker(p, eff, cam)) return cam;
  for (let d = cam.distance - 0.1; d >= 0.4; d -= 0.1) {
    const lens = (cam.lens * d) / cam.distance;
    if (lens < 16) break;
    const next = { ...cam, distance: d, lens };
    if (!viewBlocker(p, eff, next)) return next;
  }
  return cam;
}

/** A camera for one framing at one keyframe, kept on the chosen side of the line and inside the set. */
function frameShot(p: Project, eff: EffectiveShot, shotNumber: string, f: Framing, which: 'start' | 'end', line?: { from: string; to: string; side: 'left' | 'right' }): CameraState {
  return clearWalls(p, eff, frameUnclipped(p, eff, shotNumber, f, which, line));
}

function frameUnclipped(p: Project, eff: EffectiveShot, shotNumber: string, f: Framing, which: 'start' | 'end', line?: { from: string; to: string; side: 'left' | 'right' }): CameraState {
  const aspect = aspectOf(p);
  const charId = (n: string) => {
    const c = byName(p.characters, n);
    if (!c || !eff.setup.actors.some((a) => a.characterId === c.id)) throw new Error(`Shot ${shotNumber}: "${n}" isn't in the shot. Block them first.`);
    return c.id;
  };
  const ids = f.subjects.map(charId);
  const subjects = subjectsAt(p, eff, ids, which);
  // The line runs between two characters in the shot, or a character and a thing (a door, a prop) for a walk.
  const lineEnd = (n: string): [number, number, number] | undefined => {
    const c = byName(p.characters, n);
    if (c) return eff.setup.actors.some((a) => a.characterId === c.id) ? subjectsAt(p, eff, [c.id], which)[0].position : undefined;
    const prop = byName(p.props, n);
    const placed = prop && eff.setup.props.find((x) => x.propId === prop.id);
    if (placed) return keyOf(placed.motion, which).position;
    const o = byName(p.stages.find((x) => x.id === eff.stageId)?.objects ?? [], n);
    if (o) return eff.setup.stageOverrides[o.id]?.position ?? o.transform.position;
    if (!prop) throw new Error(`Shot ${shotNumber}: the line names "${n}", which isn't a character, prop or object on this stage.`);
    return undefined;
  };
  const ends = line && [lineEnd(line.from), lineEnd(line.to)];
  // It applies when both ends are in the shot.
  const linePts = ends?.every(Boolean) ? (ends as [[number, number, number], [number, number, number]]) : undefined;
  const want = line?.side === 'left' ? 1 : -1;
  // Of two candidate cameras, the one on the chosen side (or the first without a line).
  const pick = (a: CameraState, b: CameraState) => {
    if (!linePts) return a;
    const sa = lineSide(linePts[0], linePts[1], cameraPosition(a).toArray() as [number, number, number]);
    const sb = lineSide(linePts[0], linePts[1], cameraPosition(b).toArray() as [number, number, number]);
    return sa * want >= sb * want ? a : b;
  };
  const elevation = f.height === 'high' ? 25 : f.height === 'low' ? -12 : undefined;

  if (!subjects.length) {
    if (!f.on) throw new Error(`Shot ${shotNumber}: give subjects, or "on" for an insert.`);
    const prop = byName(p.props, f.on);
    const placed = prop && eff.setup.props.find((x) => x.propId === prop.id);
    const stage = p.stages.find((x) => x.id === eff.stageId);
    const o = stage && byName(stage.objects, f.on);
    const at = placed ? keyOf(placed.motion, which).position : o ? eff.setup.stageOverrides[o.id]?.position ?? o.transform.position : null;
    if (!at) throw new Error(`Shot ${shotNumber}: can't find "${f.on}" to frame. Place the prop in the shot first.`);
    // Size the frame to the object as seen: its width against the frame's width, its height (tilted) against the frame's height.
    const ext = objectExtent(placed ? prop!.source : o!.source);
    const scale = placed ? prop!.defaultScale : o!.transform.scale[0];
    const across = Math.max(2 * ext.hx, 2 * ext.hz) * scale, tall = ext.h * scale;
    const elevation = f.height === 'eye' ? 10 : f.height === 'low' ? 0 : 35;
    const el = (elevation * Math.PI) / 180;
    const lens = f.lens ?? 50;
    const tanV = Math.tan(((lensToVFov(lens, aspect) * Math.PI) / 180) / 2);
    const fill = INSERT_FILL[f.size];
    const distance = Math.max(0.15, across / fill / (2 * tanV * aspect), (across * Math.sin(el) + tall * Math.cos(el)) / fill / (2 * tanV));
    const base = linePts ? bearing(linePts[0], linePts[1]) + 90 : 0;
    const make = (az: number): CameraState => ({ target: [at[0], at[1] + tall / 2, at[2]], azimuth: az + (f.angle ?? 0), elevation, distance, lens, roll: 0 });
    return pick(make(base), make(base + 180));
  }

  const opts = { elevation, lens: f.lens };
  const main = subjects[0];
  if (f.over) {
    const fg = subjectsAt(p, eff, [charId(f.over)], which)[0];
    const base = bearing(main.position, fg.position);
    const off = f.angle ?? 15;
    const make = (az: number) => {
      const cam = frameSubjects([main], f.size, aspect, { ...opts, azimuth: az });
      // Stay behind the foreground shoulder: back off and lengthen the lens to keep the size.
      const behind = Math.hypot(fg.position[0] - main.position[0], fg.position[2] - main.position[2]) + 0.6;
      return cam.distance >= behind ? cam : { ...cam, distance: behind, lens: Math.min(135, cam.lens * (behind / cam.distance)) };
    };
    return pick(make(base + off), make(base - off));
  }
  if (subjects.length === 1) {
    const off = f.angle ?? 20;
    return pick(frameSubjects(subjects, f.size, aspect, { ...opts, azimuth: main.yaw + off }), frameSubjects(subjects, f.size, aspect, { ...opts, azimuth: main.yaw - off }));
  }
  const base = linePts ? bearing(linePts[0], linePts[1]) + 90 : 0;
  const make = (az: number) => frameSubjects(subjects, f.size, aspect, { ...opts, azimuth: az + (f.angle ?? 0) });
  return pick(make(base), make(base + 180));
}

/** The coverage report for the scenes of the given shots. */
function coverageReport(p: Project, shots: Shot[], focus?: Set<string>): string {
  const scenes = new Set(shots.map((s) => sceneLineOf(p, s)?.id));
  const inScenes = p.shots.filter((s) => scenes.has(sceneLineOf(p, s)?.id));
  const { shots: cov, findings } = checkCoverage(p, inScenes.map((s) => s.id));
  const lines = cov.filter((c) => !focus || focus.has(c.shotId)).map((c) => `${c.number}: ${describeCoverage(p, c)}`);
  const numbers = new Set(p.shots.filter((s) => focus?.has(s.id)).map((s) => s.number));
  const relevant = findings.filter((f) => !focus || f.at.split(/[→/]/).some((n) => numbers.has(n)));
  return `${lines.join('\n')}\n${relevant.length ? `Coverage check:\n${formatFindings(relevant)}` : 'Coverage check: no problems.'}`;
}

const coverShots = tool(
  'cover_shots',
  'Set the camera of several shots at once (no shot needs to be open). Give the line of action and the side the camera keeps; angles then always lean toward that side, so the camera never crosses by accident. "end" makes the camera move to a second framing during the shot (people are framed where they are at the end). Returns what each shot shows and a coverage check (line, two-element rule, jump cuts, matched reverses, lenses).',
  z.object({
    line: lineSpec.optional().describe('The line of action for every shot in this call (override per shot).'),
    shots: z.array(z.object({ number: z.string(), line: lineSpec.optional(), ...framingSpec, end: z.object(framingSpec).partial().optional() })).min(1),
  }),
  (a, ctx) => {
    const p = ctx.project();
    // Work everything out before changing anything.
    const cams = a.shots.map((s) => {
      const shot = shotByNumber(p, s.number);
      const eff = effectiveShot(p, shot.id)!;
      const line = s.line ?? a.line;
      const start = frameShot(p, eff, shot.number, s, 'start', line);
      const end = s.end && frameShot(p, eff, shot.number, { ...s, ...s.end, subjects: s.end.subjects ?? s.subjects }, 'end', line);
      return { shot, start, end };
    });
    for (const c of cams) {
      ctx.dispatch(setCamera(c.shot.id, 'start', c.start));
      if (c.end) ctx.dispatch(setCamera(c.shot.id, 'end', c.end));
      else ctx.dispatch(setCameraFixed(c.shot.id));
    }
    return `Covered shots ${cams.map((c) => c.shot.number).join(', ')}.\n${coverageReport(ctx.project(), cams.map((c) => c.shot), new Set(cams.map((c) => c.shot.id)))}`;
  },
);

const checkCoverageTool = tool(
  'check_coverage',
  'Check the cameras of a scene against film grammar: line of action (C1), at least two changes per cut (C3), jump cuts (C4), matched reverses (C7), lens by size (C11). Also says what each shot shows. Default: every shot.',
  z.object({ shots: z.array(z.string()).optional().describe('Shot numbers; their whole scenes are checked.') }),
  (a, ctx) => {
    const p = ctx.project();
    const shots = a.shots?.length ? a.shots.map((n) => shotByNumber(p, n)) : p.shots;
    return coverageReport(p, shots);
  },
);

export const MAX_SHEET_SHOTS = 6;

const renderShots = tool(
  'render_shots',
  `Render shots through their cameras into one contact sheet and look at it: a row per shot, a column per moment (start, middle, end). At most ${MAX_SHEET_SHOTS} shots per call; render in batches after a pass, not after every change.`,
  z.object({
    shots: z.array(z.string()).min(1).max(MAX_SHEET_SHOTS),
    at: z.enum(['start', 'middle', 'end', 'all']).optional().describe('Which moments; default all. "end" is enough for shots where nobody moves.'),
    view: z.enum(['camera', 'overhead']).optional().describe('"camera" (default) looks through each shot\'s camera; "overhead" looks down on the whole set from the front, best for checking blocking.'),
  }),
  async (a, ctx) => {
    if (!ctx.renderSheet) return 'Rendering is not available here.';
    const p = ctx.project();
    const shots = a.shots.map((n) => shotByNumber(p, n));
    const moments: SheetMoment[] = !a.at || a.at === 'all' ? [...SHEET_MOMENTS] : [a.at];
    const view = a.view ?? 'camera';
    const img = await ctx.renderSheet(shots.map((s) => s.id), moments, view);
    if (!img) return 'Could not render (no WebGL).';
    const numbers = shots.map((s) => s.number).join(', ');
    ctx.attachImage(img, `Contact sheet${view === 'overhead' ? ', overhead view from the front of the set (+Z at the bottom, -X on the left)' : ''}. Rows: shots ${numbers} (top to bottom, number in the corner). Columns: ${moments.join(', ')}.`);
    return `Rendered shots ${numbers}; the sheet follows as an image.`;
  },
);

// ---------- per step ----------

const SHARED = [goToStep, openShot];
const SHOT_LIST = [mergeTool, splitTool, shotStage, voiceTool];

export function toolsFor(step: Step, inShotEditor: boolean): Tool[] {
  switch (step) {
    case 'story':
      return [...SHARED, setTypes, setShotBreaks, breakdownMode, editLine];
    case 'staging':
      return [...SHARED, createStageTool, selectStage, addObjects, updateObjects, removeObjects, snapshot];
    case 'characters':
      return [...SHARED, addCharactersTool, updateCharacterTool, voiceTool];
    case 'props':
      return [...SHARED, addPropsTool, modelProp];
    case 'shots':
      return [
        ...SHARED,
        ...(inShotEditor ? [placeCharacters, removeCharacters, placeShotProps, frameCamera, setCameraTool, cameraMode, durationTool, shotStage, voiceTool, snapshot] : SHOT_LIST),
        ...[useSkillTool(step)].filter((t): t is Tool => !!t),
        blockShots,
        coverShots,
        checkCoverageTool,
        renderShots,
      ];
    default:
      return [...SHARED, ...SHOT_LIST];
  }
}

export function toolSpecs(tools: Tool[]) {
  return tools.map((t) => ({
    type: 'function' as const,
    function: { name: t.name, description: t.description, parameters: z.toJSONSchema(t.schema) as Record<string, unknown> },
  }));
}

/** Runs one tool call. Errors come back as text so the model can correct itself. */
export async function runTool(tools: Tool[], name: string, rawArgs: string, ctx: ToolContext): Promise<string> {
  const t = tools.find((x) => x.name === name);
  if (!t) return `Error: no tool called ${name} here.`;
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawArgs || '{}');
  } catch {
    return 'Error: the arguments were not valid JSON.';
  }
  const result = t.schema.safeParse(parsed);
  if (!result.success) return `Error: invalid arguments: ${result.error.issues.map((i) => `${i.path.join('.') || 'args'}: ${i.message}`).join('; ')}`;
  try {
    return await t.run(result.data as never, ctx);
  } catch (e) {
    return `Error: ${e instanceof Error ? e.message : String(e)}`;
  }
}

