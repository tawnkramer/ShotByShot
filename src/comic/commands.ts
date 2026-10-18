import type { Draft } from 'immer';
import type { Command } from '../state/commands';
import type { Project } from '../state/schema';
import type { LetterElement, LetterKind, LetterStyle } from './model';

function letters(d: Draft<Project>, shotId: string): Draft<LetterElement>[] | undefined {
  const shot = d.shots.find((s) => s.id === shotId);
  if (!shot) return undefined;
  shot.lettering ??= [];
  return shot.lettering;
}

export function addLetter(shotId: string, el: LetterElement): Command {
  return {
    label: el.kind === 'speech' ? 'Add balloon' : 'Add caption',
    apply: (d) => { letters(d, shotId)?.push(el); },
  };
}

/**
 * Changes one balloon or caption. Pass a mergeKey for continuous edits
 * (dragging, typing) so they become one undo step.
 */
export function updateLetter(shotId: string, id: string, patch: Partial<Omit<LetterElement, 'id' | 'kind'>>, label = 'Edit lettering', mergeKey?: string): Command {
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
    label: kind === 'speech' ? 'Set balloon style' : 'Set caption style',
    apply: (d) => {
      d.lettering ??= {};
      d.lettering[kind] = { ...d.lettering[kind], ...style };
      for (const shot of d.shots) for (const el of shot.lettering ?? []) {
        if (el.kind !== kind || !el.style) continue;
        for (const key of Object.keys(style) as (keyof LetterStyle)[]) delete el.style[key];
        if (!Object.keys(el.style).length) delete el.style;
      }
    },
  };
}
