import { describe, expect, it } from 'vitest';
import { createProject } from '../src/state/schema';
import { cameraDescription, defaultAssignments, defaultReferences, mediaOptions, referenceTags, videoPrompt } from '../src/video/shotVideo';
import type { MediaSlot } from '../src/comfy/workflow';

function project() {
  const p = createProject('Video');
  p.characters.push({ id: 'ana', name: 'Ana', sex: 'female', heightCm: 165, build: 'slim', attributes: ['red coat'], voice: { provider: 'openai', voiceId: 'alloy', speed: 1 }, image: { blob: 'ana-art', prompt: 'Ana in a red coat', model: 'm', createdAt: 1 } });
  p.script.push({ id: 'l1', index: 0, type: 'action', text: 'Ana waits at the bus stop.' }, { id: 'l2', index: 1, type: 'dialogue', text: 'You came.', speakerId: 'ana' });
  p.shots.push({ id: 's', number: '1.1', lineIds: ['l1', 'l2'], image: { blob: 'shot-art', prompt: 'p', model: 'm', createdAt: 1 },
    setup: { actors: [{ characterId: 'ana', motion: { mode: 'static', start: { position: [0, 0, 0], yaw: 0, pose: 'standing' }, easing: 'linear' } }], props: [], stageOverrides: {} } });
  return p;
}
const slot = (nodeId: string, kind: MediaSlot['kind']): MediaSlot => ({ nodeId, input: kind === 'video' ? 'file' : kind, kind, title: 'Load' });

describe('shot video', () => {
  it('suggests the shot image first, then characters, and the previs clip for video inputs', () => {
    const p = project();
    const options = mediaOptions(p, p.shots[0], { blob: new Blob(['f']), characterIds: [] });
    expect(options.map((o) => o.id)).toEqual(['shot-image', 'previs-frame', 'character:ana', 'previs-clip']);
    const slots = [slot('1', 'image'), slot('2', 'image'), slot('3', 'video')];
    expect([...defaultAssignments(slots, options).values()]).toEqual(['shot-image', 'previs-frame', 'previs-clip']);
    expect(referenceTags(['image', 'image', 'video', 'image'], 'picture')).toEqual(['<Picture 1>', '<Picture 2>', '<Video 1>', '<Picture 3>']);
    expect(referenceTags(['image', 'audio', 'image'], 'reference')).toEqual(['Image 1', 'Audio 1', 'Image 2']);
    const groups = (['image', 'video'] as const).map((kind) => ({ nodeId: '24', kind, prefix: `model.reference_${kind}s.${kind}_`, max: 9, title: 'Seedance' }));
    expect([...defaultReferences(groups, options, 3).values()]).toEqual([['shot-image', 'character:ana'], ['previs-clip']]);
    expect([...defaultReferences(groups, options, 1.2).values()]).toEqual([['shot-image', 'character:ana'], []]);
  });

  it("offers the shot's current video as an opt-in reference video", () => {
    const p = project();
    p.shots[0].video = { blob: 'take-1', prompt: 'p', workflow: 'w', createdAt: 1 };
    const options = mediaOptions(p, p.shots[0]);
    expect(options.filter((o) => o.kind === 'video').map((o) => [o.id, o.blobKey])).toEqual([['previs-clip', undefined], ['shot-video', 'take-1']]);
    const groups = [{ nodeId: '24', kind: 'video' as const, prefix: 'v', max: 9, title: 'Seedance' }];
    expect([...defaultReferences(groups, options, 3).values()]).toEqual([['previs-clip']]);
  });

  it('builds a prompt that names each reference, the subjects, camera and direction', () => {
    const p = project();
    const options = mediaOptions(p, p.shots[0]);
    const text = videoPrompt(p, p.shots[0], [{ tag: '<Picture 1>', option: options[0] }, { tag: '<Picture 2>', option: options[1] }], 'Rain starts.');
    expect(text).toContain('<Picture 1> is the illustrated start frame of the shot.');
    expect(text).toContain('<Subject 1> is Ana from <Picture 2>: Ana in a red coat');
    expect(text).toContain('Ana waits at the bus stop.');
    expect(text).toContain('Locked-off camera');
    expect(text).toContain('audio:\nVoices and natural sound effects only. No music, no score, no soundtrack.');
    expect(text).toMatch(/additional direction \(highest priority\):\nRain starts\.$/);
  });

  it('describes camera moves', () => {
    const start = { target: [0, 1, 0] as [number, number, number], azimuth: 0, elevation: 0, distance: 4, lens: 35, roll: 0 };
    expect(cameraDescription({ mode: 'moving', start, end: { ...start, distance: 2, azimuth: 30 }, easing: 'linear' })).toMatch(/^Smooth push in, orbit right about 30°/);
  });
});
