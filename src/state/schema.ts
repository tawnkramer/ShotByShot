import { z } from 'zod';

export const SCHEMA_VERSION = 1;

export const STEPS = ['story', 'staging', 'characters', 'props', 'shots', 'previs', 'export'] as const;
export type Step = (typeof STEPS)[number];

export const STEP_LABELS: Record<Step, string> = {
  story: 'Story',
  staging: 'Staging',
  characters: 'Characters',
  props: 'Props',
  shots: 'Shots',
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
] as const;
export type AspectRatioId = (typeof ASPECT_RATIOS)[number]['id'];
const aspectIds = ASPECT_RATIOS.map((a) => a.id) as [AspectRatioId, ...AspectRatioId[]];

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
});

// Later milestones fill in stages, characters and props. Until their schemas
// exist, they are kept as opaque records so files round-trip intact.
const looseRecord = z.record(z.string(), z.unknown());

export const BREAKDOWN_MODES = ['line', 'pair', 'mixed'] as const;
export type BreakdownMode = (typeof BREAKDOWN_MODES)[number];

/** A shot covers a contiguous run of script lines. Later milestones add setup, camera and timing. */
export const shotSchema = z.looseObject({
  id: z.string(),
  number: z.string(),
  lineIds: z.array(z.string()).min(1),
});

export const projectSchema = z.object({
  schemaVersion: z.number().int(),
  id: z.string(),
  name: z.string(),
  aspect: z.enum(aspectIds),
  fps: z.number().int().positive(),
  step: z.enum(STEPS),
  script: z.array(scriptLineSchema),
  breakdownMode: z.enum(BREAKDOWN_MODES).default('mixed'),
  shots: z.array(shotSchema),
  stages: z.array(looseRecord),
  characters: z.array(looseRecord),
  props: z.array(looseRecord),
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

export function createProject(name: string): Project {
  const now = Date.now();
  return {
    schemaVersion: SCHEMA_VERSION,
    id: newId(),
    name,
    aspect: '2.39:1',
    fps: 24,
    step: 'story',
    script: [],
    breakdownMode: 'mixed',
    shots: [],
    stages: [],
    characters: [],
    props: [],
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
