import { newId, type Project, type Shot } from '../state/schema';
import { frameAspect } from '../shots/setup';
import { panelHeads } from './heads';
import { layoutLetter, type TextMeasurer } from './layout';
import { isBalloon, resolveStyle, type LetterElement } from './model';
import { placeLettering, type Fixed, type PlaceItem } from './place';
import { letteringSpeeches, type Speech } from './script';

/** A new, automatically placed balloon (or caption, for narration) for a speech. */
export function speechElement(project: Project, speech: Speech): LetterElement {
  const character = speech.speaker ? project.characters.find((c) => c.name.toUpperCase() === speech.speaker) : undefined;
  return {
    id: newId(), kind: speech.kind, text: speech.text, lineId: speech.lineId, x: 0.5, y: 0.5, auto: true,
    ...(character && !speech.offPanel ? { targetCharacterId: character.id } : {}),
  };
}

export interface AutoOptions { measure: TextMeasurer; fallbackFont?: string; rtl?: boolean }

/** Sizes as fractions of the panel, from the real text layout. */
function sizeOf(project: Project, el: LetterElement, aspect: number, opts: AutoOptions): { w: number; h: number } {
  const W = 1000, H = W / aspect;
  const { box } = layoutLetter({ ...el, tail: undefined }, resolveStyle(el, project.lettering, opts.fallbackFont), W, H, opts.measure);
  return { w: box.w / W, h: box.h / H };
}

/**
 * Places a panel's automatic lettering. Elements moved by hand (auto not
 * true) stay put and are avoided; automatic ones are placed in script
 * order around the characters' heads, with tails aimed at their speakers.
 */
export function placePanel(project: Project, shot: Shot, lettering: LetterElement[], opts: AutoOptions): LetterElement[] {
  const aspect = frameAspect(project, shot);
  const heads = panelHeads(project, shot);
  const order = new Map(project.script.map((l, i) => [l.id, i]));
  const autos = lettering.filter((e) => e.auto).sort((a, b) => (order.get(a.lineId ?? '') ?? 1e9) - (order.get(b.lineId ?? '') ?? 1e9));
  const fixed: Fixed[] = lettering.filter((e) => !e.auto).map((e) => ({ x: e.x, y: e.y, ...sizeOf(project, e, aspect, opts) }));
  const items: PlaceItem[] = autos.map((e) => ({
    id: e.id, ...sizeOf(project, e, aspect, opts),
    caption: !isBalloon(e.kind),
    speaker: heads.find((h) => h.characterId === e.targetCharacterId),
  }));
  const placed = placeLettering(items, heads, aspect, fixed, { rtl: opts.rtl });
  // Keep the panel's drawing order, with automatic ones in reading order.
  const byId = new Map(lettering.map((e) => [e.id, e]));
  const pinned = lettering.filter((e) => !e.auto);
  return [...pinned, ...autos].map((e) => {
    const p = placed.get(e.id);
    if (!p) return byId.get(e.id)!;
    const next: LetterElement = { ...e, x: p.x, y: p.y };
    if (p.tail) next.tail = p.tail;
    else delete next.tail;
    return next;
  });
}

/**
 * Letters a panel from its script: adds a balloon for every speech that
 * doesn't have one yet, then places all the automatic ones.
 */
export function autoLetter(project: Project, shot: Shot, opts: AutoOptions): LetterElement[] {
  const current = shot.lettering ?? [];
  const placed = new Set(current.map((e) => e.lineId).filter(Boolean));
  const added = letteringSpeeches(project, shot).panel.filter((s) => !placed.has(s.lineId)).map((s) => speechElement(project, s));
  return placePanel(project, shot, [...current, ...added], opts);
}

export interface LetteringWarning { kind: 'crowded'; message: string }

/**
 * Too much text for the panel. Covering part of someone is sometimes what
 * the panel needs, so that isn't flagged; automatic placement still avoids faces.
 */
export function letteringWarnings(project: Project, shot: Shot, opts: AutoOptions): LetteringWarning[] {
  const lettering = shot.lettering ?? [];
  if (!lettering.length) return [];
  const aspect = frameAspect(project, shot);
  const boxes = lettering.map((e) => ({ x: e.x, y: e.y, ...sizeOf(project, e, aspect, opts) }));
  const out: LetteringWarning[] = [];
  const covered = boxes.reduce((n, b) => n + b.w * b.h, 0);
  if (covered > 0.45) out.push({ kind: 'crowded', message: 'Lettering fills almost half the panel. Split the panel or shorten the lines.' });
  return out;
}
