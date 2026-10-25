import { z } from 'zod';
import { letterElementSchema, letteringDefaultsSchema } from '../comic/model';

export const SCHEMA_VERSION = 1;

export const STEPS = ['story', 'staging', 'characters', 'props', 'shots', 'pages', 'previs', 'export'] as const;
export type Step = (typeof STEPS)[number];

export const MEDIA = ['film', 'comic'] as const;
export type Medium = (typeof MEDIA)[number];

const FILM_STEPS: readonly Step[] = ['story', 'staging', 'characters', 'props', 'shots', 'previs', 'export'];
/** Comics have no timeline, sound or video: panels go onto pages instead. */
const COMIC_STEPS: readonly Step[] = ['story', 'staging', 'characters', 'props', 'shots', 'pages', 'export'];

/** Projects saved before comics existed have no medium: they're films. */
export function mediumOf(project: Pick<Project, 'medium'>): Medium {
  return project.medium === 'comic' ? 'comic' : 'film';
}

export function stepsFor(project: Pick<Project, 'medium'>): readonly Step[] {
  return mediumOf(project) === 'comic' ? COMIC_STEPS : FILM_STEPS;
}

export function stepLabel(step: Step, project?: Pick<Project, 'medium'>): string {
  return step === 'shots' && project && mediumOf(project) === 'comic' ? 'Panels' : STEP_LABELS[step];
}

export const STEP_LABELS: Record<Step, string> = {
  story: 'Story',
  staging: 'Staging',
  characters: 'Characters',
  props: 'Props',
  shots: 'Shots',
  pages: 'Pages',
  previs: 'Previs',
  export: 'Export',
};

export const ASPECT_RATIOS = [
  { id: '2.39:1', label: 'Scope 2.39:1', ratio: 2.39 },
  { id: '2.20:1', label: '70mm 2.20:1', ratio: 2.2 },
  { id: '2.00:1', label: 'Univisium 2.00:1', ratio: 2.0 },
  { id: '1.85:1', label: 'Flat 1.85:1', ratio: 1.85 },
  { id: '1.66:1', label: 'European 1.66:1', ratio: 1.66 },
  { id: '1.43:1', label: 'IMAX 1.43:1', ratio: 1.43 },
  { id: '1.37:1', label: 'Academy 1.37:1', ratio: 1.375 },
  { id: '4:3', label: 'TV 4:3', ratio: 4 / 3 },
  { id: '16:9', label: 'HD / YouTube 16:9', ratio: 16 / 9 },
  { id: '9:16', label: 'YouTube Short 9:16', ratio: 9 / 16 },
  { id: '1:1', label: 'Square 1:1', ratio: 1 },
  { id: '3:4', label: 'Tall 3:4', ratio: 3 / 4 },
] as const;
export type AspectRatioId = (typeof ASPECT_RATIOS)[number]['id'];
const aspectIds = ASPECT_RATIOS.map((a) => a.id) as [AspectRatioId, ...AspectRatioId[]];

/** Panel shapes offered in comic projects, widest first. */
export const PANEL_SHAPES: { id: AspectRatioId; label: string }[] = [
  { id: '2.00:1', label: 'Wide 2:1' },
  { id: '16:9', label: 'Wide 16:9' },
  { id: '4:3', label: 'Standard 4:3' },
  { id: '1:1', label: 'Square' },
  { id: '3:4', label: 'Tall 3:4' },
  { id: '9:16', label: 'Tall 9:16' },
];

export const LINE_TYPES = ['title', 'description', 'character', 'dialogue', 'action', 'scene', 'camera'] as const;

const vec3 = z.tuple([z.number(), z.number(), z.number()]);
const quat = z.tuple([z.number(), z.number(), z.number(), z.number()]);
export const transformSchema = z.object({ position: vec3, rotation: quat, scale: vec3 });

export const scriptLineSchema = z.object({
  id: z.string(),
  index: z.number().int(),
  text: z.string(),
  type: z.enum(LINE_TYPES),
  confidence: z.number().optional(),
  speakerId: z.string().optional(),
  sceneId: z.string().optional(),
  /** The script's own number for a scene heading, e.g. "12" or "12A". */
  sceneNumber: z.string().optional(),
});

export const SET_ITEMS = ['table', 'chair', 'door', 'window', 'bar', 'stool', 'wall', 'room'] as const;
export const PROP_ITEMS = ['bottle', 'mug', 'glass', 'phone', 'envelope', 'book', 'briefcase', 'bag', 'laptop', 'lamp', 'pistol', 'knife'] as const;
export const LIBRARY_ITEMS = [...SET_ITEMS, ...PROP_ITEMS] as const;
export const COMPOSITE_SHAPES = ['box', 'cylinder', 'sphere', 'cone', 'torus'] as const;
export const PRIMITIVE_SHAPES = ['box', 'cylinder', 'sphere', 'cone', 'plane'] as const;
export type LibraryItem = (typeof LIBRARY_ITEMS)[number];
export type PrimitiveShape = (typeof PRIMITIVE_SHAPES)[number];

const params = z.record(z.string(), z.number()).optional();

/**
 * One part of a composite model (how the assistant models props). Sizes are
 * full extents in meters: box w/h/d; cylinder, cone and sphere use x/z as
 * diameters and y as height; a torus lies flat with x/z as outer diameter and
 * y as tube thickness. Position is the part's center; rotation is in degrees.
 */
export const compositeNodeSchema = z.object({
  shape: z.enum(COMPOSITE_SHAPES),
  size: z.tuple([z.number().positive(), z.number().positive(), z.number().positive()]),
  position: z.tuple([z.number(), z.number(), z.number()]),
  rotation: z.tuple([z.number(), z.number(), z.number()]).optional(),
  grey: z.number().min(0).max(1).optional(),
});
export type CompositeNode = z.infer<typeof compositeNodeSchema>;
export const objectSourceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('library'), item: z.enum(LIBRARY_ITEMS), params }),
  z.object({ kind: z.literal('primitive'), shape: z.enum(PRIMITIVE_SHAPES), params }),
  z.object({ kind: z.literal('asset'), blob: z.string(), format: z.enum(['obj', 'gltf', 'glb']), fileName: z.string().optional() }),
  z.object({ kind: z.literal('composite'), nodes: z.array(compositeNodeSchema).min(1).max(200) }),
]);
export type ParamSource = Extract<ObjectSource, { kind: 'library' | 'primitive' }>;
export type ObjectSource = z.infer<typeof objectSourceSchema>;

export const stageObjectSchema = z.object({
  id: z.string(),
  name: z.string(),
  transform: transformSchema,
  source: objectSourceSchema,
  /** 0 (black) .. 1 (white). Overrides the item's own shades. */
  grey: z.number().min(0).max(1).optional(),
  /** Set when the object was placed from the project's prop library. */
  propId: z.string().optional(),
});
export type StageObject = z.infer<typeof stageObjectSchema>;

const conceptImageSchema = z.object({
  blob: z.string(), prompt: z.string(), model: z.string(), createdAt: z.number(),
  guidanceBlob: z.string().optional(),
  referenceImages: z.array(z.object({
    blob: z.string(), name: z.string(), kind: z.enum(['stage', 'character']), characterId: z.string().optional(),
  })).optional(),
  frameProgress: z.number().min(0).max(1).optional(),
  aspect: z.number().positive().optional(),
  additionalPrompt: z.string().optional(),
});

const shotVideoSchema = z.object({
  blob: z.string(), prompt: z.string(), additionalPrompt: z.string().optional(),
  /** Name of the ComfyUI workflow that produced it. */
  workflow: z.string(), createdAt: z.number(),
});
export type ShotVideo = z.infer<typeof shotVideoSchema>;

export const stageSchema = z.object({
  id: z.string(),
  name: z.string(),
  sceneLineIds: z.array(z.string()),
  objects: z.array(stageObjectSchema),
  image: conceptImageSchema.optional(),
});
export type Stage = z.infer<typeof stageSchema>;
export type Transform = z.infer<typeof transformSchema>;

export const SEXES = ['female', 'male', 'other'] as const;
export const BUILDS = ['slim', 'average', 'heavy'] as const;
export const AGE_BANDS = ['child', 'teen', '20s', '30s', '40s', '50s', '60s', '70+'] as const;
export const POSES = ['standing', 'sitting', 'walking', 'leaning', 'lying'] as const;
export type Sex = (typeof SEXES)[number];
export type Build = (typeof BUILDS)[number];
export type PoseId = (typeof POSES)[number];

export const voiceSchema = z.object({
  provider: z.enum(['openai', 'browser']),
  voiceId: z.string(),
  speed: z.number().min(0.25).max(4),
  /** Speaking style, e.g. "gravelly, tired". */
  instructions: z.string().optional(),
});

export const characterSchema = z.object({
  id: z.string(),
  name: z.string(),
  sex: z.enum(SEXES),
  heightCm: z.number().min(50).max(250),
  build: z.enum(BUILDS),
  ageBand: z.enum(AGE_BANDS).optional(),
  attributes: z.array(z.string()),
  /** Color that tells characters apart in the grey world, e.g. "#6aa6ff". */
  tint: z.string().optional(),
  voice: voiceSchema,
  /** Generated concept artwork, stored with the project's binary assets. */
  image: conceptImageSchema.optional(),
});
export type Character = z.infer<typeof characterSchema>;
export type Voice = z.infer<typeof voiceSchema>;

export const propSchema = z.object({
  image: conceptImageSchema.optional(),
  id: z.string(),
  name: z.string(),
  source: objectSourceSchema,
  /** Uniform scale applied when the prop is placed. */
  defaultScale: z.number().positive(),
  grey: z.number().min(0).max(1).optional(),
});
export type Prop = z.infer<typeof propSchema>;

export const BREAKDOWN_MODES = ['line', 'pair', 'mixed', 'panels'] as const;
export type BreakdownMode = (typeof BREAKDOWN_MODES)[number];

/** Where something is in a shot: on the floor plane, turned about Y (degrees; 0 faces +Z). */
export const placementSchema = z.object({ position: vec3, yaw: z.number() });
/** The mannequin's joints, parent before child. */
export const JOINTS = ['pelvis', 'spine', 'neck', 'shoulderL', 'elbowL', 'shoulderR', 'elbowR', 'hipL', 'kneeL', 'hipR', 'kneeR'] as const;
export type Joint = (typeof JOINTS)[number];
/** Joint rotations in degrees (XYZ), e.g. a pose matched from a photo. Joints not listed keep the preset's angles. */
export const jointAnglesSchema = z.partialRecord(z.enum(JOINTS), vec3);
export type JointAngles = z.infer<typeof jointAnglesSchema>;
export const actorKeySchema = placementSchema.extend({ pose: z.enum(POSES), joints: jointAnglesSchema.optional() });
export type Placement = z.infer<typeof placementSchema>;
export type ActorKey = z.infer<typeof actorKeySchema>;

export const EASINGS = ['linear', 'easeInOut'] as const;
function keyframed<T extends z.ZodType>(key: T) {
  return z.object({
    /** 'static' holds `start` for the whole shot; 'moving' goes from `start` to `end`. */
    mode: z.enum(['static', 'moving']),
    start: key,
    end: key.optional(),
    easing: z.enum(EASINGS),
  });
}

/**
 * Shot camera, orbiting a target point. Azimuth 0 puts the camera on the +Z
 * side looking toward -Z; positive elevation is above the target. Lens is a
 * full-frame (36 mm wide) focal length.
 */
export const cameraStateSchema = z.object({
  target: vec3,
  azimuth: z.number(),
  elevation: z.number().min(-89).max(89),
  distance: z.number().positive(),
  lens: z.number().min(8).max(400),
  roll: z.number(),
});
export type CameraState = z.infer<typeof cameraStateSchema>;

export const shotActorSchema = z.object({
  characterId: z.string(),
  motion: keyframed(actorKeySchema),
});
export const shotPropSchema = z.object({
  id: z.string(),
  propId: z.string(),
  motion: keyframed(placementSchema),
});
export const stageOverrideSchema = z.object({
  position: vec3.optional(),
  rotation: quat.optional(),
  scale: vec3.optional(),
  hidden: z.boolean().optional(),
});
export const shotSetupSchema = z.object({
  actors: z.array(shotActorSchema),
  props: z.array(shotPropSchema),
  /** Per-shot changes to stage objects, keyed by stage object id. */
  stageOverrides: z.record(z.string(), stageOverrideSchema),
});
export type ShotActor = z.infer<typeof shotActorSchema>;
export type ShotProp = z.infer<typeof shotPropSchema>;
export type StageOverride = z.infer<typeof stageOverrideSchema>;
export type ShotSetup = z.infer<typeof shotSetupSchema>;
export type ShotCamera = z.infer<ReturnType<typeof keyframed<typeof cameraStateSchema>>>;
export type Keyframed<T> = { mode: 'static' | 'moving'; start: T; end?: T; easing: (typeof EASINGS)[number] };

/**
 * A shot covers a contiguous run of script lines. Setup, camera and duration
 * are filled in the first time the shot is edited; until then they're derived
 * (see shots/setup.ts).
 */
export const shotSchema = z.looseObject({
  image: conceptImageSchema.optional(),
  imagePrompt: z.string().max(32000).optional(),
  /** Generated video for the shot, stored with the project's binary assets. */
  video: shotVideoSchema.optional(),
  videoPrompt: z.string().max(32000).optional(),
  id: z.string(),
  number: z.string(),
  lineIds: z.array(z.string()).min(1),
  stageId: z.string().optional(),
  setup: shotSetupSchema.optional(),
  camera: keyframed(cameraStateSchema).optional(),
  durationSec: z.number().positive().optional(),
  /** Set when the duration was typed in, so it isn't re-estimated. */
  durationLocked: z.boolean().optional(),
  /** Comic lettering over the shot's art, in drawing order. */
  lettering: z.array(letterElementSchema).optional(),
  /** Comic projects: this panel's shape, if not the project's default. */
  panel: z.object({ shape: z.enum(aspectIds).optional() }).optional(),
});

export const projectSchema = z.object({
  schemaVersion: z.number().int(),
  id: z.string(),
  name: z.string(),
  /** Film or comic. Older projects have none and are films. */
  medium: z.enum(MEDIA).optional(),
  /** Film: the frame. Comic: the default panel shape. */
  aspect: z.enum(aspectIds),
  fps: z.number().int().positive(),
  step: z.enum(STEPS),
  script: z.array(scriptLineSchema),
  breakdownMode: z.enum(BREAKDOWN_MODES).default('mixed'),
  shotNumbering: z.enum(['scene.shot', 'slate', 'vfx', 'sequential']).default('scene.shot'),
  shots: z.array(shotSchema),
  stages: z.array(stageSchema),
  characters: z.array(characterSchema),
  props: z.array(propSchema),
  /** Spoken dialogue, by script line id. Valid while `sig` matches the line's current voice and text. */
  audio: z.record(z.string(), z.object({ sig: z.string(), blob: z.string(), durationSec: z.number().positive() })).default({}),
  /** Comic projects: how panels become pages (one panel per page for now). */
  comic: z.object({
    /** Panel ids in page order, once pages have been reordered; panels not listed follow their panel order. */
    pageOrder: z.array(z.string()).optional(),
    /** Panels left out of the book. */
    leftOut: z.array(z.string()).optional(),
    /** The panel used for the cover; default the first page. */
    coverId: z.string().optional(),
    /** How the comic appears on the user's comic site (its comics.json entry). */
    publish: z.object({ slug: z.string().optional(), title: z.string().optional(), tags: z.array(z.string()).optional() }).optional(),
  }).optional(),
  /** Lettering style defaults for this project, per kind. */
  lettering: letteringDefaultsSchema.optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

export type Project = z.infer<typeof projectSchema>;
export type ScriptLine = z.infer<typeof scriptLineSchema>;
export type LineType = ScriptLine['type'];
export type Shot = z.infer<typeof shotSchema>;

export function newId(): string {
  // randomUUID only exists in secure contexts; phones testing the dev server over
  // plain http on the local network don't have it.
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export function createProject(name: string, medium: Medium = 'film'): Project {
  const now = Date.now();
  const comic = medium === 'comic';
  return {
    schemaVersion: SCHEMA_VERSION,
    id: newId(),
    name,
    ...(comic ? { medium } : {}),
    aspect: comic ? '4:3' : '2.39:1',
    fps: 24,
    step: 'story',
    script: [],
    breakdownMode: comic ? 'panels' : 'mixed',
    shotNumbering: comic ? 'sequential' : 'scene.shot',
    shots: [],
    stages: [],
    characters: [],
    props: [],
    audio: {},
    createdAt: now,
    updatedAt: now,
  };
}

/** Upgrades an older project object to the current schema, then validates it. */
export function migrateProject(raw: unknown): Project {
  if (typeof raw !== 'object' || raw === null) throw new Error('Not a ShotByShot project.');
  const data = { ...(raw as Record<string, unknown>) };
  const version = typeof data.schemaVersion === 'number' ? data.schemaVersion : 0;
  if (version > SCHEMA_VERSION) {
    throw new Error('This project was saved by a newer version of ShotByShot. Reload the app to update it.');
  }
  // Future migrations go here: if (version < 2) { ... }
  data.schemaVersion = SCHEMA_VERSION;
  return projectSchema.parse(data);
}
