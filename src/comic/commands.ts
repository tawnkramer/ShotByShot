import type { Draft } from 'immer';
import type { Command } from '../state/commands';
import type { Project } from '../state/schema';
import { defaultsKey, type LetterElement, type LetterKind, type LetterStyle } from './model';

function letters(d: Draft<Project>, shotId: string): Draft<LetterElement>[] | undefined {
  const shot = d.shots.find((s) => s.id === shotId);
  if (!shot) return undefined;
  shot.lettering ??= [];
  return shot.lettering;
}

export function addLetter(shotId: string, el: LetterElement): Command {
  return {
    label: el.kind === 'caption' ? 'Add caption' : 'Add balloon',
    apply: (d) => { letters(d, shotId)?.push(el); },
  };
}

/**
 * Changes one balloon or caption. Pass a mergeKey for continuous edits
 * (dragging, typing) so they become one undo step.
 */
export function updateLetter(shotId: string, id: string, patch: Partial<Omit<LetterElement, 'id'>>, label = 'Edit lettering', mergeKey?: string): Command {
  return {
    label,
    mergeKey,
    apply: (d) => {
      const el = letters(d, shotId)?.find((e) => e.id === id);
      if (!el) return;
      for (const [key, value] of Object.entries(patch) as [keyof typeof patch, unknown][]) {
        if (value === undefined) delete el[key];
        else (el as Record<string, unknown>)[key] = value;
      }
    },
  };
}

/** Changes style overrides on one element; undefined removes an override. */
export function styleLetter(shotId: string, id: string, style: Partial<LetterStyle>, mergeKey?: string): Command {
  return {
    label: 'Style lettering',
    mergeKey,
    apply: (d) => {
      const el = letters(d, shotId)?.find((e) => e.id === id);
      if (!el) return;
      const next = { ...el.style };
      for (const [key, value] of Object.entries(style)) {
        if (value === undefined) delete next[key as keyof LetterStyle];
        else (next as Record<string, unknown>)[key] = value;
      }
      if (Object.keys(next).length) el.style = next;
      else delete el.style;
    },
  };
}

export function removeLetter(shotId: string, id: string): Command {
  return {
    label: 'Delete lettering',
    apply: (d) => {
      const shot = d.shots.find((s) => s.id === shotId);
      if (!shot?.lettering) return;
      shot.lettering = shot.lettering.filter((e) => e.id !== id);
      if (!shot.lettering.length) delete shot.lettering;
    },
  };
}

/** Replaces a panel's lettering in one step, e.g. after placing it automatically. */
export function setLettering(shotId: string, lettering: LetterElement[], label = 'Letter panel'): Command {
  return {
    label,
    apply: (d) => {
      const shot = d.shots.find((s) => s.id === shotId);
      if (!shot) return;
      if (lettering.length) shot.lettering = lettering;
      else delete shot.lettering;
    },
  };
}

/** Letters several panels at once, as one undo step. */
export function setLetteringMany(byShot: Map<string, LetterElement[]>, label = 'Letter panels'): Command {
  return {
    label,
    apply: (d) => {
      for (const shot of d.shots) {
        const lettering = byShot.get(shot.id);
        if (lettering) shot.lettering = lettering;
      }
    },
  };
}

/** Moves an element to the top (drawn last), e.g. when it's picked up. */
export function raiseLetter(shotId: string, id: string, mergeKey?: string): Command {
  return {
    label: 'Bring to front',
    mergeKey,
    apply: (d) => {
      const list = letters(d, shotId);
      const i = list?.findIndex((e) => e.id === id) ?? -1;
      if (!list || i < 0 || i === list.length - 1) return;
      list.push(...list.splice(i, 1));
    },
  };
}

/**
 * Makes an element's look the project default for its kind, and clears the
 * same overrides from every other element of that kind so the whole book
 * follows the new default.
 */
export function setLetteringDefault(kind: LetterKind, style: Partial<LetterStyle>): Command {
  return {
    label: kind === 'caption' ? 'Set caption style' : 'Set balloon style',
    apply: (d) => {
      // All kinds of balloon share one project style.
      const key = defaultsKey(kind);
      d.lettering ??= {};
      d.lettering[key] = { ...d.lettering[key], ...style };
      for (const shot of d.shots) for (const el of shot.lettering ?? []) {
        if (defaultsKey(el.kind) !== key || !el.style) continue;
        for (const key of Object.keys(style) as (keyof LetterStyle)[]) delete el.style[key];
        if (!Object.keys(el.style).length) delete el.style;
      }
    },
  };
}

/**
 * Copies a balloon, caption or text a little down and to the right, e.g.
 * for a repeated sound effect. The copy is placed by hand (not automatic)
 * and isn't tied to a script line.
 */
export function duplicateLetter(shotId: string, id: string, newId: string, offset = { dx: 0.05, dy: 0.05 }): Command {
  return {
    label: 'Duplicate lettering',
    apply: (d) => {
      const list = letters(d, shotId);
      const el = list?.find((e) => e.id === id);
      if (!list || !el) return;
      const sx = (v: number) => Math.min(0.97, v + offset.dx), sy = (v: number) => Math.min(0.97, v + offset.dy);
      const copy: LetterElement = { ...JSON.parse(JSON.stringify(el)), id: newId, x: sx(el.x), y: sy(el.y) };
      if (copy.tail) copy.tail = { x: sx(copy.tail.x), y: sy(copy.tail.y) };
      delete copy.auto;
      delete copy.lineId;
      list.push(copy);
    },
  };
}
