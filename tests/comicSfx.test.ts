import { describe, expect, it } from 'vitest';
import { hitTest, layoutLetter, type TextMeasurer } from '../src/comic/layout';
import { drawLetter } from '../src/comic/draw';
import { resolveStyle, type LetterElement } from '../src/comic/model';
import { duplicateLetter } from '../src/comic/commands';
import { emptyHistory, runCommand } from '../src/state/commands';
import { createProject, migrateProject } from '../src/state/schema';
import { runTool, toolsFor, type ToolContext } from '../src/ai/tools';

const measure: TextMeasurer = (t, f) => t.length * f.px * 0.5;
const sfx = (extra: Partial<LetterElement> = {}): LetterElement => ({ id: 's', kind: 'sfx', text: 'KNOCK KNOCK KNOCK', x: 0.5, y: 0.5, ...extra });

describe('sound effects and titles', () => {
  it('keep their display font and break lines only where typed', () => {
    const style = resolveStyle(sfx(), undefined, 'CCWildWords');
    expect(style).toMatchObject({ font: 'Bangers', outline: 7, shadow: 0, ink: '#ffd21f' });
    const one = layoutLetter(sfx(), style, 1000, 1000, measure);
    expect(one.lines).toEqual(['KNOCK KNOCK KNOCK']);
    expect(one.shape).toBe('text');
    expect(one.tail).toBeUndefined();
    expect(layoutLetter(sfx({ text: 'KNOCK\nKNOCK' }), style, 1000, 1000, measure).lines).toEqual(['KNOCK', 'KNOCK']);
    // The box holds the letters plus outline and shadow.
    const shadowed = layoutLetter(sfx(), { ...style, shadow: 6 }, 1000, 1000, measure);
    expect(shadowed.box.w - one.box.w).toBeCloseTo(12);
  });

  it('turn about their center, and are hit where the turned letters are', () => {
    const style = resolveStyle(sfx());
    const flat = layoutLetter(sfx({ text: 'WHAM' }), style, 1000, 1000, measure);
    const turned = layoutLetter(sfx({ text: 'WHAM', rotation: 90 }), style, 1000, 1000, measure);
    expect(turned.rotation).toBeCloseTo(Math.PI / 2);
    // A point along the unturned width, outside the turned (now tall) box.
    const side = { x: 500 + flat.box.w / 2 - 5, y: 500 };
    expect(hitTest([flat], side)).toBe(flat);
    expect(hitTest([turned], side)).toBeUndefined();
    expect(hitTest([turned], { x: 500, y: 500 + flat.box.w / 2 - 5 })).toBe(turned);
  });

  it('draw the shadow, then the outline, then the letters', () => {
    const calls: string[] = [];
    const ctx = new Proxy({} as Record<string, unknown>, {
      get: (t, k: string) => (k in t ? t[k] : (...args: unknown[]) => { calls.push(`${k}:${k.endsWith('Text') ? `${String(t.fillStyle ?? '')}|${String(t.strokeStyle ?? '')}` : ''}`); void args; }),
      set: (t, k: string, v) => { t[k] = v; return true; },
    }) as unknown as CanvasRenderingContext2D;
    const style = { ...resolveStyle(sfx()), shadow: 6, shadowColor: '#111111', outlineColor: '#000000', ink: '#ff0000' };
    drawLetter(ctx, layoutLetter(sfx({ text: 'BLAM', rotation: -15 }), style, 1000, 1000, measure));
    const text = calls.filter((c) => c.includes('Text'));
    expect(text).toEqual([
      'strokeText:#111111|#111111', 'fillText:#111111|#111111',
      'strokeText:#111111|#000000',
      'fillText:#ff0000|#000000',
    ]);
    expect(calls.some((c) => c.startsWith('rotate'))).toBe(true);
  });

  it('duplicate into a hand-placed copy, a little down and right', () => {
    const p = createProject('C', 'comic');
    p.shots.push({ id: 'p', number: '1', lineIds: ['l'], lettering: [sfx({ id: 'a', rotation: 20, style: { ink: '#00ff00' } }), { id: 'b', kind: 'speech', text: 'Hi', x: 0.3, y: 0.2, tail: { x: 0.3, y: 0.5 }, auto: true, lineId: 'l' }] });
    let [next] = runCommand(p, emptyHistory(), duplicateLetter('p', 'a', 'a2'));
    [next] = runCommand(next, emptyHistory(), duplicateLetter('p', 'b', 'b2'));
    const [, , a2, b2] = next.shots[0].lettering!;
    expect(a2).toMatchObject({ id: 'a2', kind: 'sfx', rotation: 20, style: { ink: '#00ff00' }, x: 0.55, y: 0.55 });
    expect(b2).toMatchObject({ id: 'b2', x: 0.35, tail: { x: 0.35, y: 0.55 } });
    expect(b2.auto).toBeUndefined();
    expect(b2.lineId).toBeUndefined();
    expect(migrateProject(JSON.parse(JSON.stringify(next))).shots[0].lettering).toEqual(next.shots[0].lettering);
  });

  it('can be added and styled by the assistant', async () => {
    let project = createProject('C', 'comic');
    project.shots.push({ id: 'p', number: '1', lineIds: ['l'] });
    const ctx = { project: () => project, dispatch: (c: Parameters<ToolContext['dispatch']>[0]) => { [project] = runCommand(project, emptyHistory(), c); } } as unknown as ToolContext;
    const tools = toolsFor('shots', true, project);
    await runTool(tools, 'edit_lettering', JSON.stringify({ panel: '1', add: [{ kind: 'sfx', text: 'CRASH!', x: 0.7, y: 0.3, rotation: -12 }] }), ctx);
    await runTool(tools, 'edit_lettering', JSON.stringify({ panel: '1', changes: [{ balloon: 1, color: '#ff3300', outline: 12, shadow: 6, font: 'Permanent Marker' }] }), ctx);
    expect(project.shots[0].lettering![0]).toMatchObject({ kind: 'sfx', text: 'CRASH!', x: 0.7, y: 0.3, rotation: -12, style: { ink: '#ff3300', outline: 12, shadow: 6, font: 'Permanent Marker' } });
    expect(project.shots[0].lettering![0].tail).toBeUndefined();
  });
});
