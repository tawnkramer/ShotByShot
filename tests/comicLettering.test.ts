import { describe, expect, it } from 'vitest';
import { manualLines, ovalProfile, wrapBalanced, wrapOval } from '../src/comic/wrap';
import { clearTip, hitTest, layoutLetter, tailBase, type TextMeasurer } from '../src/comic/layout';
import { BUILTIN_STYLES, resolveStyle, type LetterElement } from '../src/comic/model';
import { fontFamilyName } from '../src/comic/fonts';
import { addLetter, raiseLetter, removeLetter, setLetteringDefault, styleLetter, updateLetter } from '../src/comic/commands';
import { emptyHistory, runCommand, undo } from '../src/state/commands';
import { createProject, projectSchema, type Project } from '../src/state/schema';

/** Every character is 10 units wide. */
const mono = (t: string) => t.length * 10;
const monoFont: TextMeasurer = (t, f) => t.length * f.px * 0.5;

const SPEECH = 'I told you we should have taken the other road, but you never listen to me when it matters';
const ovalOpts = { minLines: 2, maxLines: 7, maxWidth: 300, minWidth: 150, edgeTightness: 0.58 };

describe('wrapOval', () => {
  it('keeps a few words on one line', () => {
    expect(wrapOval('  Get   down!  ', mono, ovalOpts)).toEqual(['Get down!']);
    expect(wrapOval('', mono, ovalOpts)).toEqual([]);
  });

  it('keeps every word, in order, and within the widest line', () => {
    const lines = wrapOval(SPEECH, mono, ovalOpts);
    expect(lines.join(' ')).toBe(SPEECH);
    expect(lines.length).toBeGreaterThanOrEqual(2);
    expect(lines.length).toBeLessThanOrEqual(7);
    for (const line of lines) expect(mono(line)).toBeLessThanOrEqual(300 * 1.01);
  });

  it('shapes a balloon: top and bottom lines no wider than the middle', () => {
    const lines = wrapOval(SPEECH, mono, ovalOpts);
    const widths = lines.map(mono);
    const middle = Math.max(...widths.slice(1, -1));
    expect(widths[0]).toBeLessThanOrEqual(middle);
    expect(widths.at(-1)!).toBeLessThanOrEqual(middle);
  });

  it('widens a little rather than drop words that cannot fit', () => {
    const lines = wrapOval(SPEECH, mono, { ...ovalOpts, maxLines: 2 });
    expect(lines.join(' ')).toBe(SPEECH);
  });

  it('profiles an oval: narrow edges, widest in the middle', () => {
    const p = ovalProfile(5, 300, 150, 0.58);
    expect(p[2]).toBeCloseTo(300);
    expect(p[0]).toBeLessThan(p[1]);
    expect(p[0]).toBeCloseTo(p[4]);
    expect(Math.min(...p)).toBeGreaterThanOrEqual(150);
  });
});

describe('wrapBalanced', () => {
  it('uses the fewest lines and evens them out', () => {
    const text = 'Meanwhile, across town, the rain kept falling';
    const lines = wrapBalanced(text, mono, 300);
    expect(lines.join(' ')).toBe(text);
    expect(lines).toHaveLength(2);
    const [a, b] = lines.map(mono);
    expect(Math.abs(a - b)).toBeLessThan(100);
  });

  it('manual lines keep the typed breaks', () => {
    expect(manualLines('\nOne\n  two words \n\n')).toEqual(['One', 'two words']);
  });
});

const balloon = (extra: Partial<LetterElement> = {}): LetterElement => ({ id: 'b', kind: 'speech', text: SPEECH, x: 0.5, y: 0.3, tail: { x: 0.3, y: 0.8 }, ...extra });

describe('layoutLetter', () => {
  it('scales with the panel: the same lettering at twice the size is exactly twice as big', () => {
    const style = resolveStyle(balloon());
    const small = layoutLetter(balloon(), style, 1000, 600, monoFont);
    const big = layoutLetter(balloon(), style, 2000, 1200, monoFont);
    expect(big.lines).toEqual(small.lines);
    expect(big.box.w).toBeCloseTo(small.box.w * 2);
    expect(big.box.h).toBeCloseTo(small.box.h * 2);
    expect(big.box.x).toBeCloseTo(small.box.x * 2);
    expect(big.tail!.tip.y).toBeCloseTo(small.tail!.tip.y * 2);
  });

  it('centers on its position', () => {
    const l = layoutLetter(balloon(), resolveStyle(balloon()), 1000, 600, monoFont);
    expect(l.box.x + l.box.w / 2).toBeCloseTo(500);
    expect(l.box.y + l.box.h / 2).toBeCloseTo(180);
  });

  it('captions are boxes without tails; manual text keeps its lines', () => {
    const caption: LetterElement = { id: 'c', kind: 'caption', text: 'Later.\nMuch later.', x: 0.5, y: 0.1, autoWrap: false, tail: { x: 0, y: 0 } };
    const l = layoutLetter(caption, resolveStyle(caption), 1000, 1000, monoFont);
    expect(l.shape).toBe('box');
    expect(l.tail).toBeUndefined();
    expect(l.lines).toEqual(['Later.', 'Much later.']);
  });

  it('puts the tail base on the oval outline, inset by the stroke', () => {
    const l = layoutLetter(balloon(), resolveStyle(balloon()), 1000, 600, monoFont);
    const { box } = l, a = box.w / 2, b = box.h / 2, cx = box.x + a, cy = box.y + b;
    for (const p of l.tail!.base) {
      const r = ((p.x - cx) / a) ** 2 + ((p.y - cy) / b) ** 2;
      expect(r).toBeGreaterThan(0.9);
      expect(r).toBeLessThanOrEqual(1);
    }
    // The base straddles the line from the center to the tip.
    const [p1, p2] = l.tail!.base;
    expect(Math.hypot(p1.x - p2.x, p1.y - p2.y)).toBeGreaterThan(0);
  });
});

describe('tails', () => {
  const box = { x: 100, y: 100, w: 200, h: 100 };
  it('pushes a tip that ends up inside the balloon back outside', () => {
    const tip = clearTip(box, 'oval', { x: 210, y: 160 }, 10);
    expect(((tip.x - 200) / 100) ** 2 + ((tip.y - 150) / 50) ** 2).toBeGreaterThan(1);
    expect(clearTip(box, 'oval', { x: 200, y: 400 }, 10)).toEqual({ x: 200, y: 400 });
    expect(clearTip(box, 'rounded', { x: 290, y: 150 }, 10)).toEqual({ x: 310, y: 150 });
  });

  it('starts a box tail on the side facing the tip', () => {
    const [a, b] = tailBase(box, 'rounded', { x: 200, y: 400 }, 12, 0);
    expect(a.y).toBeCloseTo(200);
    expect(b.y).toBeCloseTo(200);
    expect(Math.abs(a.x - b.x)).toBeCloseTo(24);
  });

  it('hit-tests the topmost element', () => {
    const style = resolveStyle(balloon());
    const under = layoutLetter(balloon({ id: 'under' }), style, 1000, 600, monoFont);
    const over = layoutLetter(balloon({ id: 'over' }), style, 1000, 600, monoFont);
    expect(hitTest([under, over], { x: 500, y: 180 })?.el.id).toBe('over');
    expect(hitTest([under, over], { x: 5, y: 590 })).toBeUndefined();
  });
});

describe('styles', () => {
  it('layers built-in, project defaults and element overrides', () => {
    const el = balloon({ style: { size: 40 } });
    const s = resolveStyle(el, { speech: { bold: true, size: 30 } }, 'CCWildWords');
    expect(s).toMatchObject({ size: 40, bold: true, font: 'CCWildWords', shape: 'oval' });
    expect(resolveStyle(el, { speech: { font: 'Bangers' } }, 'CCWildWords').font).toBe('Bangers');
    expect(resolveStyle({ kind: 'caption' }).fill).toBe(BUILTIN_STYLES.caption.fill);
  });
});

describe('commands', () => {
  const setup = () => {
    const project = createProject('Comic');
    project.shots.push({ id: 's', number: '1', lineIds: ['l'] });
    return project;
  };
  const run = (p: Project, ...cmds: Parameters<typeof runCommand>[2][]) => {
    let state: [Project, ReturnType<typeof emptyHistory>] = [p, emptyHistory()];
    for (const c of cmds) state = runCommand(state[0], state[1], c);
    return state;
  };

  it('adds, edits, restyles, raises and deletes, all undoable', () => {
    const [p1, h1] = run(setup(),
      addLetter('s', balloon({ id: 'a' })),
      addLetter('s', { id: 'c', kind: 'caption', text: 'Later', x: 0.5, y: 0.1 }),
      updateLetter('s', 'a', { text: 'Hi!', tail: undefined }),
      styleLetter('s', 'a', { size: 33, bold: true }),
      styleLetter('s', 'a', { bold: undefined }),
      raiseLetter('s', 'a'),
    );
    const letters = p1.shots[0].lettering!;
    expect(letters.map((e) => e.id)).toEqual(['c', 'a']);
    expect(letters[1]).toMatchObject({ text: 'Hi!', style: { size: 33 } });
    expect(letters[1].tail).toBeUndefined();
    expect(letters[1].style).not.toHaveProperty('bold');
    const [p2] = run(p1, removeLetter('s', 'a'), removeLetter('s', 'c'));
    expect(p2.shots[0].lettering).toBeUndefined();
    const [back] = undo(p1, h1);
    expect(back.shots[0].lettering!.map((e) => e.id)).toEqual(['a', 'c']);
  });

  it('merges a drag into one undo step', () => {
    const [p, h] = run(setup(), addLetter('s', balloon({ id: 'a' })),
      updateLetter('s', 'a', { x: 0.1 }, 'Move', 'move:a'),
      updateLetter('s', 'a', { x: 0.2 }, 'Move', 'move:a'));
    expect(h.past).toHaveLength(2);
    expect(undo(p, h)[0].shots[0].lettering![0].x).toBe(0.5);
  });

  it('makes a style the project default and drops the same overrides elsewhere', () => {
    const [p] = run(setup(),
      addLetter('s', balloon({ id: 'a', style: { font: 'Bangers', size: 30 } })),
      addLetter('s', balloon({ id: 'b', style: { font: 'Permanent Marker' } })),
      setLetteringDefault('speech', { font: 'Bangers', size: 30 }));
    expect(p.lettering?.speech).toEqual({ font: 'Bangers', size: 30 });
    expect(p.shots[0].lettering!.every((e) => !e.style)).toBe(true);
  });

  it('survives a project file round trip', () => {
    const [p] = run(setup(), addLetter('s', balloon({ id: 'a', style: { size: 30 } })), setLetteringDefault('caption', { bold: true }));
    const parsed = projectSchema.parse(JSON.parse(JSON.stringify(p)));
    expect(parsed.shots[0].lettering).toEqual(p.shots[0].lettering);
    expect(parsed.lettering).toEqual({ caption: { bold: true } });
  });
});

describe('fontFamilyName', () => {
  /** A minimal font file with just a name table. */
  function fontWithNames(names: { platform: number; id: number; text: string }[]): ArrayBuffer {
    const encoded = names.map((n) => n.platform === 1 ? [...n.text].map((c) => c.charCodeAt(0)) : [...n.text].flatMap((c) => [0, c.charCodeAt(0)]));
    const storage = encoded.reduce((s, e) => s + e.length, 0);
    const nameOffset = 12 + 16;
    const headerLen = 6 + names.length * 12;
    const buf = new ArrayBuffer(nameOffset + headerLen + storage);
    const v = new DataView(buf);
    v.setUint32(0, 0x00010000); v.setUint16(4, 1);
    [...'name'].forEach((c, i) => v.setUint8(12 + i, c.charCodeAt(0)));
    v.setUint32(12 + 8, nameOffset);
    v.setUint16(nameOffset + 2, names.length);
    v.setUint16(nameOffset + 4, headerLen);
    let off = 0;
    names.forEach((n, i) => {
      const rec = nameOffset + 6 + i * 12;
      v.setUint16(rec, n.platform); v.setUint16(rec + 6, n.id);
      v.setUint16(rec + 8, encoded[i].length); v.setUint16(rec + 10, off);
      encoded[i].forEach((b, k) => v.setUint8(nameOffset + headerLen + off + k, b));
      off += encoded[i].length;
    });
    return buf;
  }

  it('reads the family name, preferring the typographic family and Windows names', () => {
    expect(fontFamilyName(fontWithNames([{ platform: 1, id: 1, text: 'CCWildWords' }]))).toBe('CCWildWords');
    expect(fontFamilyName(fontWithNames([{ platform: 1, id: 1, text: 'Mac Name' }, { platform: 3, id: 1, text: 'Win Name' }]))).toBe('Win Name');
    expect(fontFamilyName(fontWithNames([{ platform: 3, id: 1, text: 'Family' }, { platform: 3, id: 16, text: 'Typo Family' }]))).toBe('Typo Family');
  });

  it('gives up quietly on files that are not fonts', () => {
    expect(fontFamilyName(new ArrayBuffer(3))).toBeUndefined();
    expect(fontFamilyName(new TextEncoder().encode('not a font at all, really').buffer)).toBeUndefined();
  });
});
