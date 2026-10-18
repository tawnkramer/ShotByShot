import { z } from 'zod';

/**
 * Comic lettering: speech balloons and caption boxes laid over a panel's art.
 *
 * Everything is stored relative to the panel so lettering survives replacing
 * the art or exporting at another size: positions are 0..1 of the panel's
 * width and height, and lengths (font size, padding, stroke, tail width) are
 * in thousandths of the panel width.
 */

export const LETTER_KINDS = ['speech', 'caption'] as const;
export type LetterKind = (typeof LETTER_KINDS)[number];

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
  /** Speech only: where the tail points, 0..1 of the panel. Absent = no tail. */
  tail: z.object({ x: z.number(), y: z.number() }).optional(),
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
export const BUILTIN_STYLES: Record<LetterKind, LetterStyle> = {
  speech: {
    font: DEFAULT_FONT, size: 27, bold: false, italic: false, dropCap: true,
    padding: 42, stroke: 2.5, shape: 'oval', fill: '#ffffff', ink: '#000000',
    maxWidth: 0.38, minWidth: 0.22, edgeTightness: 0.58, minLines: 2, maxLines: 7, tailWidth: 12,
  },
  caption: {
    font: DEFAULT_FONT, size: 27, bold: false, italic: false, dropCap: true,
    padding: 25, stroke: 2.5, shape: 'rounded', fill: '#f4e4a6', ink: '#000000',
    maxWidth: 0.45, minWidth: 0.1, edgeTightness: 0.58, minLines: 1, maxLines: 10, tailWidth: 12,
  },
};

/** The style an element is drawn with: built-in, then project defaults, then its own overrides. */
export function resolveStyle(el: Pick<LetterElement, 'kind' | 'style'>, defaults?: LetteringDefaults, fallbackFont?: string): LetterStyle {
  const base = { ...BUILTIN_STYLES[el.kind], ...(fallbackFont ? { font: fallbackFont } : {}) };
  return { ...base, ...defined(defaults?.[el.kind]), ...defined(el.style) };
}

function defined<T extends object>(o: T | undefined): Partial<T> {
  if (!o) return {};
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}
