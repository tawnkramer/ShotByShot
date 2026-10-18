import { describe, expect, it } from 'vitest';
import { speechKind, letteringSpeeches } from '../src/comic/script';
import { panelHeads } from '../src/comic/heads';
import { coveredFaces, faceBox, placeLettering } from '../src/comic/place';
import { autoLetter, letteringWarnings, placePanel } from '../src/comic/auto';
import type { TextMeasurer } from '../src/comic/layout';
import { createProject, type Project } from '../src/state/schema';
import type { HeadSpot } from '../src/comic/heads';

const measure: TextMeasurer = (t, f) => t.length * f.px * 0.5;

describe('balloon kinds from the script', () => {
  it.each([
    ['MAYA', ['(whispers)'], 'Over here.', 'whisper'],
    ['MAYA', ['(shouting)'], 'Run.', 'shout'],
    ['MAYA', [], 'GET DOWN!', 'shout'],
    ['MAYA', ['(thinking)'], 'He is lying.', 'thought'],
    ['LEO (V.O.)', ['(on phone)'], 'Where are you?', 'electronic'],
    ['LEO (V.O.)', [], 'It was the summer everything changed.', 'caption'],
    ['MAYA', ['(beat)'], 'Fine.', 'speech'],
  ])('%s %j "%s" → %s', (cue, notes, text, kind) => {
    expect(speechKind(cue, notes, text).kind).toBe(kind);
  });

  it('marks off-screen speakers', () => {
    expect(speechKind('LEO (O.S.)', [], 'Hello?')).toEqual({ kind: 'speech', offPanel: true });
  });

  it('reads parentheticals before and inside a speech', () => {
    const p = createProject('k', 'comic');
    p.script = [
      { id: 'c', index: 0, type: 'character', text: 'MAYA' }, { id: 'n', index: 1, type: 'dialogue', text: '(whispering)' },
      { id: 'd', index: 2, type: 'dialogue', text: 'Not now.' },
    ];
    p.shots = [{ id: 's', number: '1', lineIds: ['c', 'n', 'd'] }];
    expect(letteringSpeeches(p, p.shots[0]).panel[0]).toMatchObject({ kind: 'whisper', text: 'Not now.', speaker: 'MAYA' });
  });
});

/** Maya and Leo talking, framed by the automatic camera. */
function twoHander(): Project {
  const p = createProject('Two', 'comic');
  const voice = { provider: 'browser' as const, voiceId: 'x', speed: 1 };
  p.characters = [
    { id: 'maya', name: 'Maya', sex: 'female', heightCm: 168, build: 'average', attributes: [], voice },
    { id: 'leo', name: 'Leo', sex: 'male', heightCm: 182, build: 'average', attributes: [], voice },
  ];
  p.script = [
    { id: 'c1', index: 0, type: 'character', text: 'MAYA' }, { id: 'd1', index: 1, type: 'dialogue', text: 'You came back. I figured you would be halfway to Portland by now.' },
    { id: 'c2', index: 2, type: 'character', text: 'LEO' }, { id: 'd2', index: 3, type: 'dialogue', text: 'I forgot my hat.' },
  ];
  p.shots = [{
    id: 's', number: '1', lineIds: ['c1', 'd1', 'c2', 'd2'],
    setup: {
      actors: [
        { characterId: 'maya', motion: { mode: 'static', easing: 'linear', start: { position: [-0.7, 0, 0], yaw: 90, pose: 'standing' } } },
        { characterId: 'leo', motion: { mode: 'static', easing: 'linear', start: { position: [0.7, 0, 0], yaw: -90, pose: 'standing' } } },
      ],
      props: [], stageOverrides: {},
    },
    camera: { mode: 'static', easing: 'linear', start: { target: [0, 1.2, 0], azimuth: 0, elevation: 5, distance: 6, lens: 35, roll: 0 } },
  }];
  return p;
}

describe('heads', () => {
  it('projects each character into the panel: left to right, in frame, at head height', () => {
    const p = twoHander();
    const [maya, leo] = panelHeads(p, p.shots[0]);
    expect(maya.inFrame && leo.inFrame).toBe(true);
    expect(maya.x).toBeLessThan(0.5);
    expect(leo.x).toBeGreaterThan(0.5);
    // Taller Leo's head is higher in the frame; mouths sit just under the head centers.
    expect(leo.y).toBeLessThan(maya.y);
    expect(maya.mouth.y).toBeGreaterThan(maya.y);
    expect(maya.r).toBeGreaterThan(0.01);
  });

  it('knows when someone is behind the camera', () => {
    const p = twoHander();
    p.shots[0].setup!.actors[0].motion.start.position = [0, 0, 10];
    expect(panelHeads(p, p.shots[0])[0].inFrame).toBe(false);
  });
});

describe('placeLettering', () => {
  const head = (id: string, x: number, y: number): HeadSpot => ({ characterId: id, x, y, mouth: { x, y: y + 0.03 }, r: 0.06, inFrame: true });
  const heads = [head('a', 0.3, 0.55), head('b', 0.7, 0.5)];

  it('keeps balloons off faces and each other, in reading order, above their speakers', () => {
    const placed = placeLettering([
      { id: '1', w: 0.3, h: 0.18, speaker: heads[0] },
      { id: '2', w: 0.25, h: 0.15, speaker: heads[1] },
    ], heads, 4 / 3);
    const one = placed.get('1')!, two = placed.get('2')!;
    const boxes = [{ ...one, w: 0.3, h: 0.18 }, { ...two, w: 0.25, h: 0.15 }];
    expect(coveredFaces(boxes, heads, 4 / 3)).toEqual([]);
    expect(Math.abs(one.x - two.x) * 4 / 3 > (0.3 + 0.25) * 4 / 3 / 2 || Math.abs(one.y - two.y) > (0.18 + 0.15) / 2).toBe(true);
    // Read first: higher, or on the left of the same row.
    expect(one.y <= two.y || one.x < two.x).toBe(true);
    expect(one.y + 0.09).toBeLessThan(heads[0].y);
    // Tails stop just short of each speaker's mouth.
    expect(Math.hypot((one.tail!.x - 0.3) * 4 / 3, one.tail!.y - 0.58)).toBeLessThan(0.15);
    expect(Math.hypot((two.tail!.x - 0.7) * 4 / 3, two.tail!.y - 0.53)).toBeLessThan(0.15);
  });

  it('puts captions along the top without tails, and avoids pinned lettering', () => {
    const placed = placeLettering([{ id: 'c', w: 0.4, h: 0.1, caption: true }], heads, 4 / 3, [{ x: 0.25, y: 0.08, w: 0.4, h: 0.12 }]);
    const c = placed.get('c')!;
    expect(c.tail).toBeUndefined();
    expect(c.y).toBeLessThan(0.3);
    expect(c.x).toBeGreaterThan(0.45);
  });

  it("points an unseen speaker's tail at the panel edge", () => {
    const c = placeLettering([{ id: 'x', w: 0.2, h: 0.12 }], [], 1).get('x')!;
    expect([0, 1]).toContain(c.tail!.x);
  });

  it('measures faces in panel-height units', () => {
    const f = faceBox(heads[0], 2);
    expect(f.x0).toBeCloseTo(0.6 - 0.075);
  });
});

describe('autoLetter', () => {
  it('letters a panel from its script with tails on the right people, avoiding their faces', () => {
    const p = twoHander();
    const lettering = autoLetter(p, p.shots[0], { measure });
    expect(lettering.map((e) => [e.text.slice(0, 12), e.targetCharacterId, e.auto])).toEqual([
      ['You came bac', 'maya', true], ['I forgot my ', 'leo', true],
    ]);
    const [maya, leo] = panelHeads(p, p.shots[0]);
    expect(Math.abs(lettering[0].tail!.x - maya.x)).toBeLessThan(Math.abs(lettering[0].tail!.x - leo.x));
    expect(Math.abs(lettering[1].tail!.x - leo.x)).toBeLessThan(Math.abs(lettering[1].tail!.x - maya.x));
    const shot = { ...p.shots[0], lettering };
    expect(letteringWarnings(p, shot, { measure })).toEqual([]);
  });

  it("re-places only what wasn't moved by hand, and adds only what's missing", () => {
    const p = twoHander();
    const first = autoLetter(p, p.shots[0], { measure });
    const pinned = { ...first[0], x: 0.12, y: 0.9, auto: undefined };
    p.shots[0].lettering = [pinned, first[1]];
    const again = autoLetter(p, p.shots[0], { measure });
    expect(again).toHaveLength(2);
    expect(again.find((e) => e.id === pinned.id)).toMatchObject({ x: 0.12, y: 0.9 });
  });

  it('warns when lettering covers a face', () => {
    const p = twoHander();
    const [maya] = panelHeads(p, p.shots[0]);
    const shot = { ...p.shots[0], lettering: placePanel(p, p.shots[0], [], { measure }).concat([{ id: 'z', kind: 'speech', text: 'Covering you up', x: maya.x, y: maya.y }]) };
    expect(letteringWarnings(p, shot, { measure }).map((w) => w.kind)).toContain('face');
  });
});
