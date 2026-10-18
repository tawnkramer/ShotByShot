import { z } from 'zod';

/**
 * Comic lettering: speech balloons and caption boxes laid over a panel's art.
 *
 * Everything is stored relative to the panel so lettering survives replacing
 * the art or exporting at another size: positions are 0..1 of the panel's
 * width and height, and lengths (font size, padding, stroke, tail width) are
 * in thousandths of the panel width.
 */

export const LETTER_KINDS = ['speech', 'caption', 'thought', 'whisper', 'shout', 'electronic'] as const;
export type LetterKind = (typeof LETTER_KINDS)[number];
/** Kinds drawn as balloons (with a tail toward the speaker); captions are boxes. */
export const BALLOON_KINDS = ['speech', 'thought', 'whisper', 'shout', 'electronic'] as const satisfies readonly LetterKind[];
export const isBalloon = (kind: LetterKind) => kind !== 'caption';
export const KIND_LABELS: Record<LetterKind, string> = {
  speech: 'Speech', thought: 'Thought', whisper: 'Whisper', shout: 'Shout', electronic: 'Phone / radio', caption: 'Caption',
};

export const BALLOON_SHAPES = ['oval', 'rounded'] as const;
export type BalloonShape = (typeof BALLOON_SHAPES)[number];

export const letterStyleSchema = z.object({
  /** Font family name: a bundled font or one added in Settings. */
  font: z.string(),
  size: z.number().min(4).max(200),
  bold: z.boolean(),
  italic: z.boolean(),
  /** First letter a little larger. */
  dropCap: z.boolean(),
  padding: z.number().min(0).max(200),
  stroke: z.number().min(0).max(30),
  shape: z.enum(BALLOON_SHAPES),
  fill: z.string(),
  ink: z.string(),
  /** Widest line, as a fraction of the panel width. */
  maxWidth: z.number().min(0.05).max(1),
  /** Narrowest line an oval is shaped to, as a fraction of the panel width. */
  minWidth: z.number().min(0.02).max(1),
  /** Higher makes the top and bottom lines of an oval narrower. */
  edgeTightness: z.number().min(0.1).max(1.2),
  minLines: z.number().int().min(1).max(20),
  maxLines: z.number().int().min(1).max(20),
  /** Half the width of a tail where it meets the balloon. */
  tailWidth: z.number().min(1).max(100),
});
export type LetterStyle = z.infer<typeof letterStyleSchema>;

export const letterElementSchema = z.object({
  id: z.string(),
  kind: z.enum(LETTER_KINDS),
  text: z.string().max(4000),
  /** Center of the balloon or caption, 0..1 of the panel. */
  x: z.number(),
  y: z.number(),
  /** Balloons only: where the tail points, 0..1 of the panel. Absent = no tail. */
  tail: z.object({ x: z.number(), y: z.number() }).optional(),
  /** The tail aims at this character's mouth when lettering is placed automatically. */
  targetCharacterId: z.string().optional(),
  /** Placed automatically, so re-placing may move it. Moving it by hand pins it (false). */
  auto: z.boolean().optional(),
  /** The script line the text was taken from. The text is a copy and can be edited freely. */
  lineId: z.string().optional(),
  /** Wrap the text to a balloon shape (default; typed line breaks always stand). Off: only typed breaks. */
  autoWrap: z.boolean().optional(),
  /** Overrides on top of the project's style for this kind. */
  style: letterStyleSchema.partial().optional(),
});
export type LetterElement = z.infer<typeof letterElementSchema>;

/** Project-wide lettering defaults, per kind, on top of the built-in ones. */
export const letteringDefaultsSchema = z.object({
  speech: letterStyleSchema.partial().optional(),
  caption: letterStyleSchema.partial().optional(),
});
export type LetteringDefaults = z.infer<typeof letteringDefaultsSchema>;

export const DEFAULT_FONT = 'Comic Neue';

/**
 * Starting values, matching the original comic text editor at a typical
 * 1200 px wide panel (32 px text, 50 px balloon padding, 3 px rule).
 */
const SPEECH: LetterStyle = {
  font: DEFAULT_FONT, size: 27, bold: false, italic: false, dropCap: true,
  padding: 42, stroke: 2.5, shape: 'oval', fill: '#ffffff', ink: '#000000',
  maxWidth: 0.38, minWidth: 0.22, edgeTightness: 0.58, minLines: 2, maxLines: 7, tailWidth: 12,
};

export const BUILTIN_STYLES: Record<LetterKind, LetterStyle> = {
  speech: SPEECH,
  thought: { ...SPEECH, padding: 52, italic: true },
  whisper: { ...SPEECH, ink: '#3a3a3a' },
  shout: { ...SPEECH, size: 31, bold: true, padding: 60, stroke: 3 },
  electronic: SPEECH,
  caption: {
    font: DEFAULT_FONT, size: 27, bold: false, italic: false, dropCap: true,
    padding: 25, stroke: 2.5, shape: 'rounded', fill: '#f4e4a6', ink: '#000000',
    maxWidth: 0.45, minWidth: 0.1, edgeTightness: 0.58, minLines: 1, maxLines: 10, tailWidth: 12,
  },
};

/** The style an element is drawn with: built-in, then project defaults, then its own overrides. */
export function resolveStyle(el: Pick<LetterElement, 'kind' | 'style'>, defaults?: LetteringDefaults, fallbackFont?: string): LetterStyle {
  const base = { ...BUILTIN_STYLES[el.kind], ...(fallbackFont ? { font: fallbackFont } : {}) };
  // Every kind of balloon shares the project's balloon style; the kind's own look stays on top where it differs.
  const project = defined(defaults?.[defaultsKey(el.kind)]);
  const own = el.kind === 'speech' || el.kind === 'caption' ? {} : kindLook(el.kind, project);
  return { ...base, ...project, ...own, ...defined(el.style) };
}

/** Which project defaults a kind uses. */
export function defaultsKey(kind: LetterKind): 'speech' | 'caption' {
  return kind === 'caption' ? 'caption' : 'speech';
}

/** What makes a kind look like itself, kept even when the project's balloon style changes size or weight. */
function kindLook(kind: LetterKind, project: Partial<LetterStyle>): Partial<LetterStyle> {
  if (kind === 'shout') return { bold: true, size: Math.round((project.size ?? SPEECH.size) * 1.15) };
  if (kind === 'thought') return { italic: true };
  return {};
}

function defined<T extends object>(o: T | undefined): Partial<T> {
  if (!o) return {};
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}
