import { isBalloon, type LetterElement, type LetterStyle } from './model';
import { hasLineBreaks, manualLines, wrapBalanced, wrapBroken, wrapOval } from './wrap';

/**
 * Where a balloon or caption and its text go on a panel of a given size, in
 * pixels. Pure, so the editor, hit testing and export share it and tests
 * can run it with a fake text measurer.
 */

export interface FontSpec { family: string; px: number; bold: boolean; italic: boolean }
export type TextMeasurer = (text: string, font: FontSpec) => number;
export interface Point { x: number; y: number }
export interface Rect { x: number; y: number; w: number; h: number }

export interface LetterLayout {
  el: LetterElement;
  style: LetterStyle;
  font: FontSpec;
  dropCapFont: FontSpec;
  lineHeight: number;
  lines: string[];
  /** Outer bounds of the balloon or caption, top-left origin. */
  box: Rect;
  /** cloud (thought) and burst (shout) are drawn around the same ellipse as oval. */
  shape: 'oval' | 'rounded' | 'box' | 'cloud' | 'burst';
  cornerRadius: number;
  stroke: number;
  tail?: { tip: Point; base: [Point, Point] };
}

/** The first letter of a drop-capped line is this much larger. */
export const DROP_CAP_SCALE = 1.07;
const LINE_HEIGHT = 1.3;
/** How far a tail tip is kept outside its balloon, in thousandths of the panel width. */
const TAIL_CLEARANCE = 17;
const CORNER_RADIUS = 17;

/** CSS font shorthand, with fallbacks for a font that isn't on this device. */
export function cssFont(f: FontSpec): string {
  const family = f.family.replace(/["\\]/g, '');
  return `${f.italic ? 'italic ' : ''}${f.bold ? 'bold ' : ''}${f.px}px "${family}", "Comic Neue", "Comic Sans MS", cursive`;
}

export function layoutLetter(el: LetterElement, style: LetterStyle, width: number, height: number, measure: TextMeasurer): LetterLayout {
  const u = width / 1000;
  const font: FontSpec = { family: style.font, px: style.size * u, bold: style.bold, italic: style.italic };
  const dropCapFont: FontSpec = { ...font, px: font.px * DROP_CAP_SCALE };
  const m = (t: string) => measure(t, font);
  // Line breaks the user typed always stand; only unbroken text is shaped automatically.
  const lines = el.autoWrap === false
    ? manualLines(el.text)
    : hasLineBreaks(el.text)
      ? wrapBroken(el.text, m, style.maxWidth * width)
      : isBalloon(el.kind)
      ? wrapOval(el.text, m, { minLines: style.minLines, maxLines: style.maxLines, maxWidth: style.maxWidth * width, minWidth: style.minWidth * width, edgeTightness: style.edgeTightness })
      : wrapBalanced(el.text, m, style.maxWidth * width);
  const lineWidth = (line: string, i: number) => i === 0 && style.dropCap && line.length > 1
    ? measure(line[0], dropCapFont) + m(line.slice(1))
    : m(line);
  const lineHeight = font.px * LINE_HEIGHT;
  const textW = lines.length ? Math.max(...lines.map(lineWidth)) : font.px * 4;
  const textH = Math.max(1, lines.length) * lineHeight;
  const pad = style.padding * u;
  const shape = el.kind === 'caption' ? 'box' : el.kind === 'thought' ? 'cloud' : el.kind === 'shout' ? 'burst' : style.shape;
  // Same proportions as the original editor: ovals need more room at the sides.
  const round = isRound(shape);
  const w = round ? textW + pad * 2 : textW + pad;
  const h = round ? textH + pad * 1.3 : textH + pad;
  const box = { x: el.x * width - w / 2, y: el.y * height - h / 2, w, h };
  const stroke = style.stroke * u;
  const layout: LetterLayout = {
    el, style, font, dropCapFont, lineHeight, lines, box, shape, stroke,
    cornerRadius: shape === 'rounded' ? Math.min(CORNER_RADIUS * u, w / 2, h / 2) : 0,
  };
  if (isBalloon(el.kind) && el.tail) {
    const tip = clearTip(box, shape, { x: el.tail.x * width, y: el.tail.y * height }, TAIL_CLEARANCE * u);
    layout.tail = { tip, base: tailBase(box, shape, tip, style.tailWidth * u, stroke) };
  }
  return layout;
}

/** Shapes laid out around an ellipse. */
export function isRound(shape: LetterLayout['shape']): boolean {
  return shape === 'oval' || shape === 'cloud' || shape === 'burst';
}

/** Keeps a tail tip outside its balloon, pushing it out past the edge if it ended up inside. */
export function clearTip(box: Rect, shape: LetterLayout['shape'], tip: Point, margin: number): Point {
  const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
  if (isRound(shape)) {
    const a = box.w / 2, b = box.h / 2;
    const dx = tip.x - cx, dy = tip.y - cy;
    if ((dx * dx) / (a * a) + (dy * dy) / (b * b) >= 1.2) return tip;
    const angle = Math.atan2(dy, dx);
    return { x: cx + Math.cos(angle) * (a + margin), y: cy + Math.sin(angle) * (b + margin) };
  }
  if (tip.x <= box.x || tip.x >= box.x + box.w || tip.y <= box.y || tip.y >= box.y + box.h) return tip;
  const left = tip.x - box.x, right = box.x + box.w - tip.x, top = tip.y - box.y, bottom = box.y + box.h - tip.y;
  const nearest = Math.min(left, right, top, bottom);
  if (nearest === left) return { x: box.x - margin, y: tip.y };
  if (nearest === right) return { x: box.x + box.w + margin, y: tip.y };
  if (nearest === top) return { x: tip.x, y: box.y - margin };
  return { x: tip.x, y: box.y + box.h + margin };
}

/**
 * The two points where a tail meets the balloon. They sit on the outline,
 * pulled in by most of the stroke width so the white tail hides the
 * outline between them.
 */
export function tailBase(box: Rect, shape: LetterLayout['shape'], tip: Point, halfWidth: number, stroke: number): [Point, Point] {
  const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
  const angle = Math.atan2(tip.y - cy, tip.x - cx);
  const inset = stroke * 0.7;
  if (isRound(shape)) {
    const a = box.w / 2, b = box.h / 2;
    const offset = Math.atan2(halfWidth, Math.hypot(tip.x - cx, tip.y - cy));
    const onEllipse = (theta: number): Point => {
      const t = Math.atan2(a * Math.sin(theta), b * Math.cos(theta));
      return {
        x: cx + a * Math.cos(t) - Math.cos(theta) * inset,
        y: cy + b * Math.sin(t) - Math.sin(theta) * inset,
      };
    };
    return [onEllipse(angle + offset), onEllipse(angle - offset)];
  }
  const cos = Math.cos(angle), sin = Math.sin(angle);
  let sx: number, sy: number;
  if (Math.abs(cos) > Math.abs(sin)) {
    sx = cos > 0 ? box.x + box.w : box.x;
    sy = cy + (sx - cx) * Math.tan(angle);
  } else {
    sy = sin > 0 ? box.y + box.h : box.y;
    sx = cx + (sy - cy) / Math.tan(angle);
  }
  sx -= cos * inset;
  sy -= sin * inset;
  const px = Math.cos(angle + Math.PI / 2) * halfWidth, py = Math.sin(angle + Math.PI / 2) * halfWidth;
  return [{ x: sx + px, y: sy + py }, { x: sx - px, y: sy - py }];
}

/** The topmost element under a point. */
export function hitTest(layouts: LetterLayout[], p: Point): LetterLayout | undefined {
  for (let i = layouts.length - 1; i >= 0; i--) {
    const { box } = layouts[i];
    if (p.x >= box.x && p.x <= box.x + box.w && p.y >= box.y && p.y <= box.y + box.h) return layouts[i];
  }
  return undefined;
}
