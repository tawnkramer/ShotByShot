import type { Command } from '../state/commands';
import type { Project } from '../state/schema';

/** One page of the book. For now every page holds one panel. */
export interface Page { shotId: string; number: number }

/**
 * Panels in page order. Reordered pages keep their order; panels added
 * since go right after the panel before them in panel order (or first).
 * Panels that no longer exist are dropped.
 */
export function pageOrder(project: Project): string[] {
  const panels = project.shots.map((s) => s.id);
  const stored = project.comic?.pageOrder;
  if (!stored) return panels;
  const exists = new Set(panels);
  const order = stored.filter((id) => exists.has(id));
  const placed = new Set(order);
  panels.forEach((id, i) => {
    if (placed.has(id)) return;
    const before = panels.slice(0, i).reverse().find((p) => placed.has(p));
    order.splice(before ? order.indexOf(before) + 1 : 0, 0, id);
    placed.add(id);
  });
  return order;
}

/** The book's pages, numbered from 1, without the panels left out. */
export function pagesOf(project: Project): Page[] {
  const out = new Set(project.comic?.leftOut ?? []);
  return pageOrder(project).filter((id) => !out.has(id)).map((shotId, i) => ({ shotId, number: i + 1 }));
}

/** The cover panel: the chosen one if it's still in the book, else the first page. */
export function coverOf(project: Project): string | undefined {
  const pages = pagesOf(project);
  const chosen = project.comic?.coverId;
  return pages.some((p) => p.shotId === chosen) ? chosen : pages[0]?.shotId;
}

/** "Page01" … "Page99": the file names the comic site expects. */
export function pageName(n: number): string {
  return `Page${String(n).padStart(2, '0')}`;
}

/** Moves a panel's page earlier (-1) or later (+1) among all pages. */
export function movePage(shotId: string, by: -1 | 1): Command {
  return {
    label: by < 0 ? 'Move page earlier' : 'Move page later',
    apply: (d) => {
      const order = pageOrder(d as Project);
      const i = order.indexOf(shotId), j = i + by;
      if (i < 0 || j < 0 || j >= order.length) return;
      [order[i], order[j]] = [order[j], order[i]];
      d.comic = { ...d.comic, pageOrder: order };
    },
  };
}

export function resetPageOrder(): Command {
  return {
    label: 'Pages in panel order',
    apply: (d) => {
      if (!d.comic) return;
      delete d.comic.pageOrder;
    },
  };
}

export function setLeftOut(shotId: string, leftOut: boolean): Command {
  return {
    label: leftOut ? 'Leave panel out' : 'Put panel back',
    apply: (d) => {
      const list = new Set(d.comic?.leftOut ?? []);
      if (leftOut) list.add(shotId);
      else list.delete(shotId);
      d.comic = { ...d.comic, leftOut: [...list] };
      if (!d.comic.leftOut!.length) delete d.comic.leftOut;
    },
  };
}

export function setCover(shotId: string): Command {
  return { label: 'Choose cover', apply: (d) => { d.comic = { ...d.comic, coverId: shotId }; } };
}
