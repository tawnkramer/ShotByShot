import { cssFont, type LetterLayout } from './layout';

/**
 * Draws laid-out lettering with Canvas 2D. Used by the lettering editor and
 * by export, so what you see is what you save.
 */
export function drawLettering(ctx: CanvasRenderingContext2D, layouts: LetterLayout[]): void {
  for (const l of layouts) drawLetter(ctx, l);
}

export function drawLetter(ctx: CanvasRenderingContext2D, l: LetterLayout): void {
  const { box, style, stroke } = l;
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.beginPath();
  if (l.shape === 'oval') ctx.ellipse(box.x + box.w / 2, box.y + box.h / 2, box.w / 2, box.h / 2, 0, 0, Math.PI * 2);
  else if (l.shape === 'rounded') roundedRect(ctx, box.x, box.y, box.w, box.h, l.cornerRadius);
  else ctx.rect(box.x, box.y, box.w, box.h);
  ctx.closePath();
  ctx.fillStyle = style.fill;
  ctx.fill();
  if (stroke > 0) {
    ctx.strokeStyle = style.ink;
    ctx.lineWidth = stroke;
    ctx.stroke();
  }
  if (l.tail) {
    const [a, b] = l.tail.base, tip = l.tail.tip;
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
  drawText(ctx, l);
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
