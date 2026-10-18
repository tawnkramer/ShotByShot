/**
 * Line breaking for balloons and captions, ported from the comic text
 * editor. Widths are in whatever unit `measure` returns (canvas pixels in
 * the app, a fixed width per character in tests).
 */

export type Measure = (text: string) => number;

export interface OvalWrapOptions {
  minLines: number;
  maxLines: number;
  /** Widest line allowed (the middle of the oval). */
  maxWidth: number;
  /** Width the top and bottom lines are shaped toward. */
  minWidth: number;
  /** Higher makes the edge lines narrower. */
  edgeTightness: number;
}

interface Candidate { lines: string[]; overflow: boolean; widths: number[]; score: number }

export function normalizeText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Breaks text into lines that make a rounded balloon: wider in the middle,
 * narrower at the top and bottom. Tries every line count in range, scores
 * each (lines ~90 % full, short edge lines, fewer lines), then nudges words
 * between neighbouring lines while that improves the score.
 */
export function wrapOval(text: string, measure: Measure, opts: OvalWrapOptions): string[] {
  const clean = normalizeText(text);
  if (!clean) return [];
  const words = clean.split(' ');
  // A few words read best on one line.
  if (words.length <= 4) return [clean];
  const minWidth = Math.min(opts.minWidth, opts.maxWidth * 0.85);
  const minLines = Math.max(1, Math.min(opts.minLines, opts.maxLines));
  let best: Candidate | null = null;
  for (let n = minLines; n <= opts.maxLines; n++) {
    const candidate = wrapToProfile(words, measure, ovalProfile(n, opts.maxWidth, minWidth, opts.edgeTightness));
    if (candidate.overflow) continue;
    candidate.score = score(candidate, measure);
    if (!best || candidate.score < best.score) best = candidate;
  }
  if (!best) {
    // Nothing fits: allow a little extra width rather than dropping words.
    const candidate = wrapToProfile(words, measure, ovalProfile(opts.maxLines, opts.maxWidth * 1.15, minWidth, opts.edgeTightness));
    if (candidate.overflow) return wrapGreedy(words, measure, opts.maxWidth * 1.15);
    candidate.score = score(candidate, measure) + 50;
    best = candidate;
  }
  return rebalance(best, measure).lines;
}

/** Line widths for an n-line oval: a sine curve from the edges to the middle. */
export function ovalProfile(n: number, maxWidth: number, minWidth: number, edgeTightness: number): number[] {
  const tight = Math.max(0.1, Math.min(1.2, edgeTightness || 0.58));
  return Array.from({ length: n }, (_, i) => {
    const s = Math.pow(Math.sin(((i + 0.5) / n) * Math.PI), tight);
    return minWidth + (maxWidth - minWidth) * s;
  });
}

function wrapToProfile(words: string[], measure: Measure, widths: number[]): Candidate {
  const lines: string[] = [];
  let next = 0;
  for (let i = 0; i < widths.length && next < words.length; i++) {
    // Every line takes at least one word.
    let line = words[next++];
    while (next < words.length) {
      const longer = `${line} ${words[next]}`;
      if (measure(longer) > widths[i]) break;
      line = longer;
      next++;
    }
    lines.push(line);
  }
  return { lines, overflow: next < words.length, widths, score: 0 };
}

function score(c: Candidate, measure: Measure): number {
  if (c.overflow) return 1e9;
  let penalty = 0;
  c.lines.forEach((line, i) => {
    const ratio = measure(line) / c.widths[i];
    if (ratio > 1) penalty += 2000 * (ratio - 1);
    // Lines about 90 % full.
    penalty += 50 * Math.abs(ratio - 0.9);
    // Short first and last lines keep the balloon round.
    const edge = i === 0 || i === c.lines.length - 1;
    if (edge && ratio > 0.82) penalty += 35 * (ratio - 0.82);
  });
  // Softly prefer fewer lines (no tall, skinny balloons).
  return penalty + c.lines.length * 2.5;
}

function rebalance(best: Candidate, measure: Measure): Candidate {
  let current = best;
  for (let attempt = 0; attempt < 10; attempt++) {
    let improved = false;
    for (let i = 0; i < current.lines.length - 1 && !improved; i++) {
      const a = current.lines[i].split(' ');
      const b = current.lines[i + 1].split(' ');
      const moves: [string, string][] = [];
      if (b.length > 1) moves.push([`${a.join(' ')} ${b[0]}`, b.slice(1).join(' ')]);
      if (a.length > 1) moves.push([a.slice(0, -1).join(' '), `${a.at(-1)} ${b.join(' ')}`]);
      for (const [lineA, lineB] of moves) {
        const lines = [...current.lines];
        lines[i] = lineA;
        lines[i + 1] = lineB;
        if (lines.some((l, k) => measure(l) > current.widths[k] * 1.01)) continue;
        const candidate = { ...current, lines, score: 0 };
        candidate.score = score(candidate, measure);
        if (candidate.score < current.score) {
          current = candidate;
          improved = true;
          break;
        }
      }
    }
    if (!improved) break;
  }
  return current;
}

function wrapGreedy(words: string[], measure: Measure, maxWidth: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const longer = line ? `${line} ${word}` : word;
    if (line && measure(longer) > maxWidth) {
      lines.push(line);
      line = word;
    } else line = longer;
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * Breaks text into a rectangular block: the fewest lines that fit maxWidth,
 * then the narrowest width that still needs no more lines, so lines come
 * out about even instead of one long line and a short tail.
 */
export function wrapBalanced(text: string, measure: Measure, maxWidth: number): string[] {
  const clean = normalizeText(text);
  if (!clean) return [];
  const words = clean.split(' ');
  const lines = wrapGreedy(words, measure, maxWidth);
  if (lines.length <= 1) return lines;
  let lo = Math.max(...words.map(measure));
  let hi = maxWidth;
  for (let i = 0; i < 20 && hi - lo > 0.5; i++) {
    const mid = (lo + hi) / 2;
    if (wrapGreedy(words, measure, mid).length <= lines.length) hi = mid;
    else lo = mid;
  }
  return wrapGreedy(words, measure, hi);
}

export function hasLineBreaks(text: string): boolean {
  return text.trim().includes('\n');
}

/**
 * Text the user broke into lines: every typed break stands (blank lines
 * too), and a line only wraps further if it's wider than maxWidth.
 */
export function wrapBroken(text: string, measure: Measure, maxWidth: number): string[] {
  return manualLines(text).flatMap((line) => (line ? wrapBalanced(line, measure, maxWidth) : ['']));
}

/** Lines exactly as typed: newlines break, nothing else. */
export function manualLines(text: string): string[] {
  const lines = text.split('\n').map((l) => l.trim());
  while (lines.length && !lines.at(-1)) lines.pop();
  while (lines.length && !lines[0]) lines.shift();
  return lines;
}
