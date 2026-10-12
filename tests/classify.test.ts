import { describe, expect, it } from 'vitest';
import { classifyScript, speakerOf } from '../src/story/classify';
import { SAMPLE_SCRIPT } from '../src/story/sample';

const types = (text: string) => classifyScript(text).map((l) => `${l.type}:${l.text}`);

describe('classifyScript', () => {
  it('labels a standard screenplay', () => {
    const lines = classifyScript(SAMPLE_SCRIPT);
    const byText = (t: string) => lines.find((l) => l.text.startsWith(t))!.type;
    expect(byText('Title: Last Call')).toBe('title');
    expect(byText('Author:')).toBe('description');
    expect(byText('INT. DOCKSIDE BAR')).toBe('scene');
    expect(byText('EXT. DOCKS')).toBe('scene');
    expect(byText('Rain streaks')).toBe('action');
    expect(byText('MAYA (40s')).toBe('action');
    expect(byText("We're closed.")).toBe('dialogue');
    expect(byText('(quietly)')).toBe('dialogue');
    expect(byText('CLOSE ON the envelope')).toBe('camera');
    expect(byText('Dex puts his hand')).toBe('action');
    expect(byText('We all wanted that.')).toBe('dialogue');
    expect(byText('Maya turns, and they hug.')).toBe('action');
    expect(lines.filter((l) => l.type === 'character').map((l) => l.text)).toEqual([
      'MAYA', 'DEX', 'MAYA', 'DEX', 'DEX', 'MAYA', 'DEX',
    ]);
  });

  it('labels a transition', () => {
    expect(types('He runs.\n\nCUT TO:\n\nShe sleeps.')[1]).toBe('camera:CUT TO:');
  });

  it('recognizes a camera direction followed by description', () => {
    expect(types('Ben sits.\n\nCLOSE ON the envelope. A house key inside.')[1]).toBe('camera:CLOSE ON the envelope. A house key inside.');
    expect(types('Ben sits.\n\nClose on the envelope.')[1]).toBe('action:Close on the envelope.');
  });

  it('splits inline "NAME: line" dialogue', () => {
    expect(types('SAM: Get down!\nAlex ducks.')).toEqual(['character:SAM', 'dialogue:Get down!', 'action:Alex ducks.']);
    expect(types('Sam (V.O.): I remember.')).toEqual(['character:SAM (V.O.)', 'dialogue:I remember.']);
  });

  it('treats text without scene headings as story, not a title page', () => {
    expect(types('A man walks in.\nHe sits.')).toEqual(['action:A man walks in.', 'action:He sits.']);
  });

  it('honours Fountain forced elements', () => {
    expect(types('.FLASHBACK\n@McCLANE\nYippee.\n> SMASH TO BLACK\n!SCREAMS')).toEqual([
      'scene:FLASHBACK', 'character:McCLANE', 'dialogue:Yippee.', 'camera:SMASH TO BLACK', 'action:SCREAMS',
    ]);
  });

  it('flags an all-caps beat with low confidence', () => {
    const [line] = classifyScript('Something happens.\nBANG!');
    expect(line.type).toBe('action');
    const bang = classifyScript('Something happens.\nBANG!')[1];
    expect(bang.type).toBe('action');
    expect(bang.confidence).toBeLessThan(0.6);
  });
});

describe('speakerOf', () => {
  it('maps dialogue to the preceding cue', () => {
    const lines = classifyScript('SAM (O.S.)\nHello.\n(beat)\nAnyone?\n\nShe waits.').map((l, i) => ({ ...l, id: String(i) }));
    const map = speakerOf(lines);
    expect(map.get('1')).toBe('SAM');
    expect(map.get('3')).toBe('SAM');
    expect(map.has('4')).toBe(false);
  });
});
