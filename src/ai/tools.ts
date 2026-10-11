import { z } from 'zod';
import type { Command } from '../state/commands';
import {
  AGE_BANDS, BUILDS, BREAKDOWN_MODES, COMPOSITE_SHAPES, LIBRARY_ITEMS, LINE_TYPES, POSES, PRIMITIVE_SHAPES, PROP_ITEMS, SEXES, STEPS,
  newId, type ObjectSource, type Project, type Shot, type Stage, type Step,
} from '../state/schema';
import { applyBreakdown, editLineText, setLineTypes } from '../story/commands';
import { isFrontMatter, numberShots } from '../story/breakdown';
import { addObject, createStage, quatFromDegrees, eulerDegrees, removeObject, updateObject, placeProp } from '../staging/commands';
import { addCharacters, updateCharacter, type CharacterPatch } from '../characters/commands';
import { OPENAI_VOICES } from '../audio/voices';
import { addProp, updateProp } from '../props/commands';
import { addActor, addShotProp, mergeWithNext, removeActor, setActorKey, setCamera, setCameraFixed, setDuration, setShotPropKey, setShotStage, splitShot } from '../shots/commands';
import { aspectOf, effectiveShot, subjectsFor } from '../shots/setup';
import { frameSubjects, SHOT_SIZES, type ShotSize } from '../three/camera';
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
  'Place characters in the open shot (adding them if needed). Use face to turn toward another character or object by name.',
  z.object({
    placements: z.array(z.object({ name: z.string(), x: num.optional(), z: num.optional(), yaw: num.optional().describe(yawDesc), face: z.string().optional(), pose: z.enum(POSES).optional(), at })).min(1),
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
      const position: [number, number, number] = [pl.x ?? cur.position[0], 0, pl.z ?? cur.position[2]];
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
    const subjects = subjectsFor(p, eff.setup, ids);
    if (!subjects.length) throw new Error('Nobody to frame: add characters to the shot first.');
    const elevation = a.height === 'high' ? 25 : a.height === 'low' ? -12 : undefined;
    const cam = frameSubjects(subjects, a.size, aspectOf(p), { azimuth: subjects[0].yaw + (a.angle ?? 0), elevation, lens: a.lens });
    ctx.dispatch(setCamera(shot.id, a.at ?? 'start', cam));
    return `Camera: ${a.size} on ${a.subjects?.join(' and ') ?? 'everyone'}, ${Math.round(cam.lens)} mm at ${cam.distance.toFixed(1)} m.`;
  },
);

const setCameraTool = tool(
  'set_camera',
  'Adjust the open shot camera directly. Only give fields to change.',
  z.object({
    orbit: num.optional().describe('Degrees around the target; 0 = camera at the front (+Z) looking back.'),
    tilt: num.optional().describe('Degrees above (+) or below (-) the target.'),
    distance: num.positive().optional(),
    lens: z.number().min(12).max(200).optional(),
    height: num.optional().describe('Height of the point the camera looks at, in meters.'),
    target: z.tuple([num, num, num]).optional(),
    roll: num.optional(),
    at,
  }),
  (a, ctx) => {
    const shot = editorShot(ctx);
    const eff = effectiveShot(ctx.project(), shot.id)!;
    const cur = keyOf(eff.camera, a.at ?? 'start');
    const target: [number, number, number] = a.target ?? [cur.target[0], a.height ?? cur.target[1], cur.target[2]];
    ctx.dispatch(
      setCamera(shot.id, a.at ?? 'start', {
        target,
        azimuth: a.orbit ?? cur.azimuth,
        elevation: Math.max(-80, Math.min(85, a.tilt ?? cur.elevation)),
        distance: a.distance ?? cur.distance,
        lens: a.lens ?? cur.lens,
        roll: a.roll ?? cur.roll,
      }),
    );
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
      return inShotEditor
        ? [...SHARED, placeCharacters, removeCharacters, placeShotProps, frameCamera, setCameraTool, cameraMode, durationTool, shotStage, voiceTool, snapshot]
        : [...SHARED, ...SHOT_LIST];
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

