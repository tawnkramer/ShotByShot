import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { coverOf, movePage, pageName, pageOrder, pagesOf, resetPageOrder, setCover, setLeftOut } from '../src/comic/pages';
import { emptyHistory, runCommand, undo, type Command } from '../src/state/commands';
import { createProject, migrateProject, type Project } from '../src/state/schema';
import { useProjectStore } from '../src/state/store';
import { PagesStep } from '../src/steps/pages/PagesStep';

vi.mock('../src/shots/thumbnail', () => ({ renderShotThumbnail: vi.fn(async () => 'previs:thumbnail') }));
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

function book(n = 4): Project {
  const p = createProject('Book', 'comic');
  for (let i = 1; i <= n; i++) p.shots.push({ id: `p${i}`, number: String(i), lineIds: [`l${i}`] });
  return p;
}
const run = (p: Project, ...cmds: Command[]) => cmds.reduce(([proj, h], c) => runCommand(proj, h, c), [p, emptyHistory()] as ReturnType<typeof runCommand>);

describe('pages', () => {
  it('start in panel order, one panel per page', () => {
    const p = book();
    expect(pagesOf(p)).toEqual([{ shotId: 'p1', number: 1 }, { shotId: 'p2', number: 2 }, { shotId: 'p3', number: 3 }, { shotId: 'p4', number: 4 }]);
    expect(coverOf(p)).toBe('p1');
    expect([pageName(1), pageName(12)]).toEqual(['Page01', 'Page12']);
  });

  it('reorder, leave out and choose a cover, all undoable', () => {
    const [p, h] = run(book(), movePage('p3', -1), setLeftOut('p4', true), setCover('p3'));
    expect(pagesOf(p).map((x) => x.shotId)).toEqual(['p1', 'p3', 'p2']);
    expect(coverOf(p)).toBe('p3');
    expect(undo(p, h)[0].comic?.coverId).toBeUndefined();
    const [back] = run(p, resetPageOrder(), setLeftOut('p4', false));
    expect(pagesOf(back).map((x) => x.shotId)).toEqual(['p1', 'p2', 'p3', 'p4']);
  });

  it('keep reordered pages when panels are added or removed', () => {
    const [p] = run(book(), movePage('p1', 1));
    expect(pageOrder(p)).toEqual(['p2', 'p1', 'p3', 'p4']);
    // A new panel after p3 (e.g. a split) lands right after it; deleted panels disappear.
    const changed = { ...p, shots: [...p.shots.slice(0, 3), { id: 'p3b', number: '3B', lineIds: ['x'] }, p.shots[3]].filter((s) => s.id !== 'p2') };
    expect(pageOrder(changed)).toEqual(['p1', 'p3', 'p3b', 'p4']);
  });

  it('fall back to the first page when the cover is left out', () => {
    const [p] = run(book(), setCover('p2'), setLeftOut('p2', true));
    expect(coverOf(p)).toBe('p1');
  });

  it('survive a project file round trip', () => {
    const [p] = run(book(), movePage('p2', 1), setCover('p3'), setLeftOut('p1', true));
    expect(migrateProject(JSON.parse(JSON.stringify(p))).comic).toEqual(p.comic);
  });
});

describe('Pages step', () => {
  let root: ReturnType<typeof createRoot>, host: HTMLDivElement;
  afterEach(async () => { if (root) await act(async () => root.unmount()); host?.remove(); await useProjectStore.getState().close(); });

  it('lists pages, reorders them, and reads them through', async () => {
    useProjectStore.getState().open(book(3));
    host = document.createElement('div'); document.body.append(host); root = createRoot(host);
    await act(async () => root.render(<MemoryRouter><PagesStep /></MemoryRouter>));
    const titles = () => [...host.querySelectorAll('.page-info strong')].map((e) => e.textContent);
    expect(titles()).toEqual(['Page01', 'Page02', 'Page03']);
    expect(host.querySelector('.page-card .badge')?.textContent).toBe('Cover');
    const cardButton = (card: number, label: string) => [...host.querySelectorAll('.page-card')[card].querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === label || b.getAttribute('aria-label') === label)!;
    await act(async () => cardButton(2, 'Earlier').click());
    expect(useProjectStore.getState().project!.comic?.pageOrder).toEqual(['p1', 'p3', 'p2']);
    await act(async () => cardButton(0, 'Leave out').click());
    expect(titles()).toEqual(['Left out', 'Page01', 'Page02']);
    await act(async () => [...host.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === 'Read')!.click());
    const head = () => document.querySelector('.reader-head strong')?.textContent;
    expect(head()).toBe('Page01 · 1 of 2');
    await act(async () => [...document.querySelectorAll<HTMLButtonElement>('.reader-foot button')].find((b) => b.textContent === 'Next ›')!.click());
    expect(head()).toBe('Page02 · 2 of 2');
    await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' })); });
    expect(head()).toBe('Page01 · 1 of 2');
  });
});
