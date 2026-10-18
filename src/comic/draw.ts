import { cssFont, type LetterLayout } from './layout';

/**
 * Draws laid-out lettering with Canvas 2D. Used by the lettering editor and
 * by export, so what you see is what you save.
 */
export function drawLettering(ctx: CanvasRenderingContext2D, layouts: LetterLayout[]): void {
  for (const l of layouts) drawLetter(ctx, l);
}

export function drawLetter(ctx: CanvasRenderingContext2D, l: LetterLayout): void {
  if (l.shape === 'text') return drawFreeText(ctx, l);
  const { style, stroke } = l;
  const kind = l.el.kind;
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  // Whispers are drawn with a dashed rule.
  const dash = kind === 'whisper' && stroke > 0 ? [stroke * 3, stroke * 2.2] : [];
  ctx.setLineDash?.(dash);
  outline(ctx, l);
  ctx.fillStyle = style.fill;
  ctx.fill();
  if (stroke > 0) {
    ctx.strokeStyle = style.ink;
    ctx.lineWidth = stroke;
    ctx.stroke();
  }
  if (l.tail) {
    const [a, b] = l.tail.base, tip = l.tail.tip;
    if (kind === 'thought') thoughtTrail(ctx, l);
    else if (kind === 'electronic') zigzag(ctx, l);
    else {
      // Fill first so the tail covers the outline where it joins, then stroke only its two sides.
      ctx.beginPath();
      ctx.moveTo(a.x, a.y); ctx.lineTo(tip.x, tip.y); ctx.lineTo(b.x, b.y);
      ctx.closePath();
      ctx.fillStyle = style.fill;
      ctx.fill();
      if (stroke > 0) {
        ctx.beginPath();
        ctx.moveTo(a.x, a.y); ctx.lineTo(tip.x, tip.y); ctx.lineTo(b.x, b.y);
        ctx.strokeStyle = style.ink;
        ctx.lineWidth = stroke;
        ctx.stroke();
      }
    }
  }
  ctx.setLineDash?.([]);
  drawText(ctx, l);
  ctx.restore();
}

function outline(ctx: CanvasRenderingContext2D, l: LetterLayout): void {
  const { box } = l;
  const cx = box.x + box.w / 2, cy = box.y + box.h / 2, a = box.w / 2, b = box.h / 2;
  ctx.beginPath();
  if (l.shape === 'oval') ctx.ellipse(cx, cy, a, b, 0, 0, Math.PI * 2);
  else if (l.shape === 'rounded') roundedRect(ctx, box.x, box.y, box.w, box.h, l.cornerRadius);
  else if (l.shape === 'cloud') {
    // Scallops around the ellipse, bulging outward.
    const n = Math.max(8, Math.round((Math.PI * (a + b)) / (Math.min(a, b) * 0.55)));
    const at = (t: number, k: number) => ({ x: cx + Math.cos(t) * a * k, y: cy + Math.sin(t) * b * k });
    const start = at(0, 0.93);
    ctx.moveTo(start.x, start.y);
    for (let i = 0; i < n; i++) {
      const t0 = (i / n) * Math.PI * 2, t1 = ((i + 1) / n) * Math.PI * 2;
      const c = at((t0 + t1) / 2, 1.16), p = at(t1, 0.93);
      ctx.quadraticCurveTo(c.x, c.y, p.x, p.y);
    }
  } else if (l.shape === 'burst') {
    // Spikes of uneven length, the same every time for the same balloon.
    const n = 18;
    for (let i = 0; i <= n * 2; i++) {
      const t = (i / (n * 2)) * Math.PI * 2;
      const k = i % 2 ? 1.2 + 0.1 * Math.sin(i * 2.7) : 0.9;
      const x = cx + Math.cos(t) * a * k, y = cy + Math.sin(t) * b * k;
      if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
    }
  } else ctx.rect(box.x, box.y, box.w, box.h);
  ctx.closePath();
}

/** A thought's trail: shrinking bubbles from the cloud toward the thinker. */
function thoughtTrail(ctx: CanvasRenderingContext2D, l: LetterLayout): void {
  const [a, b] = l.tail!.base, tip = l.tail!.tip;
  const start = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  // Panel units per style unit, from the font size.
  const r0 = l.style.tailWidth * (l.font.px / l.style.size) * 0.9;
  [[0.3, 1], [0.62, 0.65], [0.9, 0.38]].forEach(([t, k]) => {
    ctx.beginPath();
    ctx.ellipse(start.x + (tip.x - start.x) * t, start.y + (tip.y - start.y) * t, r0 * k, r0 * k * 0.8, 0, 0, Math.PI * 2);
    ctx.fillStyle = l.style.fill;
    ctx.fill();
    if (l.stroke > 0) { ctx.strokeStyle = l.style.ink; ctx.lineWidth = l.stroke; ctx.stroke(); }
  });
}

/** A phone or radio voice: a lightning-bolt tail. */
function zigzag(ctx: CanvasRenderingContext2D, l: LetterLayout): void {
  const [a, b] = l.tail!.base, tip = l.tail!.tip;
  const start = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const dx = tip.x - start.x, dy = tip.y - start.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len, ny = dx / len;
  const amp = Math.min(len * 0.18, Math.hypot(a.x - b.x, a.y - b.y) * 0.6);
  ctx.beginPath();
  ctx.moveTo(start.x, start.y);
  [[0.3, 1], [0.55, -1], [0.8, 1]].forEach(([t, side]) => ctx.lineTo(start.x + dx * t + nx * amp * side, start.y + dy * t + ny * amp * side));
  ctx.lineTo(tip.x, tip.y);
  ctx.strokeStyle = l.style.ink;
  ctx.lineWidth = Math.max(1, l.stroke * 1.3);
  ctx.stroke();
}

/**
 * Sound effects and titles: letters with no balloon, turned about their
 * center, with an optional drop shadow and outline under the fill.
 */
function drawFreeText(ctx: CanvasRenderingContext2D, l: LetterLayout): void {
  const { box, lines, lineHeight, style, rotation } = l;
  const u = l.font.px / style.size;
  const outline = style.outline * u, shadow = style.shadow * u;
  ctx.save();
  ctx.translate(box.x + box.w / 2, box.y + box.h / 2);
  if (rotation) ctx.rotate(rotation);
  ctx.font = cssFont(l.font);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.miterLimit = 2;
  const top = -(lines.length * lineHeight) / 2;
  const at = (i: number) => top + (i + 0.5) * lineHeight;
  if (shadow > 0) {
    // Down and to the right on the page, however the text is turned.
    const c = Math.cos(-rotation), s = Math.sin(-rotation);
    const ox = shadow * c - shadow * s, oy = shadow * s + shadow * c;
    ctx.fillStyle = ctx.strokeStyle = style.shadowColor;
    ctx.lineWidth = outline * 2;
    lines.forEach((line, i) => {
      if (outline > 0) ctx.strokeText(line, ox, at(i) + oy);
      ctx.fillText(line, ox, at(i) + oy);
    });
  }
  if (outline > 0) {
    // Stroked at twice the width: the inner half is covered by the fill.
    ctx.strokeStyle = style.outlineColor;
    ctx.lineWidth = outline * 2;
    lines.forEach((line, i) => ctx.strokeText(line, 0, at(i)));
  }
  ctx.fillStyle = style.ink;
  lines.forEach((line, i) => ctx.fillText(line, 0, at(i)));
  ctx.restore();
}

function drawText(ctx: CanvasRenderingContext2D, l: LetterLayout): void {
  const { box, lines, lineHeight, style } = l;
  ctx.fillStyle = style.ink;
  ctx.textBaseline = 'middle';
  const top = box.y + (box.h - lines.length * lineHeight) / 2;
  const cx = box.x + box.w / 2;
  lines.forEach((line, i) => {
    const y = top + (i + 0.5) * lineHeight;
    if (i === 0 && style.dropCap && line.length > 1) {
      ctx.font = cssFont(l.dropCapFont);
      const capW = ctx.measureText(line[0]).width;
      ctx.font = cssFont(l.font);
      const restW = ctx.measureText(line.slice(1)).width;
      const left = cx - (capW + restW) / 2;
      ctx.textAlign = 'left';
      ctx.font = cssFont(l.dropCapFont);
      ctx.fillText(line[0], left, y);
      ctx.font = cssFont(l.font);
      ctx.fillText(line.slice(1), left + capW, y);
    } else {
      ctx.font = cssFont(l.font);
      ctx.textAlign = 'center';
      ctx.fillText(line, cx, y);
    }
  });
}

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
}

/** A measurer backed by a canvas context, for layoutLetter. */
export function canvasMeasurer(ctx: CanvasRenderingContext2D): (text: string, font: Parameters<typeof cssFont>[0]) => number {
  return (text, font) => {
    ctx.font = cssFont(font);
    return ctx.measureText(text).width;
  };
}
