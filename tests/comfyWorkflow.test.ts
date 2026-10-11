import { describe, expect, it } from 'vitest';
import fixture from './fixtures/minimax_h3_i2v.json';
import { analyzeWorkflow, bindWorkflow, defaultPromptTarget, parseWorkflow, sizeForAspect, type AssetReference } from '../src/comfy/workflow';

const minimax = () => parseWorkflow(JSON.stringify(fixture));
const asset: AssetReference = { __type: 'core/ASSET', info: { id: 'asset-1', file_path: 'shot-114.png' } };

describe('ComfyUI workflow analysis', () => {
  it('rejects the editor format with export instructions', () => {
    expect(() => parseWorkflow(JSON.stringify({ nodes: [], links: [] }))).toThrow(/Export \(API\)/);
    expect(() => parseWorkflow('not json')).toThrow(/not valid JSON/);
    expect(() => parseWorkflow(JSON.stringify({ 1: { inputs: {} } }))).toThrow(/API-format/);
  });

  it('finds the inputs the MiniMax H3 image-to-video workflow exposes', () => {
    const a = analyzeWorkflow(minimax());
    expect(a.slots).toEqual([{ nodeId: '114', input: 'image', kind: 'image', title: 'Load Image' }]);
    expect(defaultPromptTarget(a)).toMatchObject({ nodeId: '105:104', input: 'prompt' });
    expect(a.durations).toEqual([{ nodeId: '105:111', input: 'value' }]);
    expect(a.seeds).toEqual([{ nodeId: '105:15', input: 'noise_seed' }]);
    expect(a.sizes).toEqual([{ nodeId: '105:104', pixels: 400_000, multiple: 32 }]);
    expect(a.outputs).toEqual(['video']);
  });

  it('binds media, prompt, duration, seed and project aspect without changing the import', () => {
    const graph = minimax();
    const before = JSON.stringify(graph);
    const a = analyzeWorkflow(graph);
    const bound = bindWorkflow(graph, a, { media: new Map([['114.image', asset]]), prompt: 'Shot 1', durationSec: 4.25, seed: 7, aspect: 2.39 });
    expect(JSON.stringify(graph)).toBe(before);
    expect(bound['114'].inputs.image).toEqual(asset);
    expect(bound['105:104'].inputs.prompt).toBe('Shot 1');
    expect(bound['105:111'].inputs.value).toBe(4.25);
    expect(bound['105:15'].inputs.noise_seed).toBe(7);
    expect(bound['105:104'].inputs).toMatchObject(sizeForAspect(2.39, 400_000, 32));
    expect(bound['105:104'].inputs.first_frame).toEqual(['114', 0]);
    expect(() => bindWorkflow(graph, a, { media: new Map() })).toThrow(/Choose media for Load Image/);
  });

  it('skips negative prompts and finds audio and video loaders', () => {
    const graph = parseWorkflow(JSON.stringify({
      1: { class_type: 'CLIPTextEncode', inputs: { text: 'blurry, low quality, watermark, extra fingers' } },
      2: { class_type: 'CLIPTextEncode', inputs: { text: 'a cat' } },
      3: { class_type: 'KSampler', inputs: { seed: 1, positive: ['2', 0], negative: ['1', 0] } },
      4: { class_type: 'LoadAudio', inputs: { audio: 'a.mp3' } },
      5: { class_type: 'LoadVideo', inputs: { file: 'v.mp4' } },
      6: { class_type: 'EmptyLatentImage', inputs: { width: 1024, height: 1024, batch_size: 1 } },
      7: { class_type: 'SaveImage', inputs: { images: ['3', 0], filename_prefix: 'x' } },
    }));
    const a = analyzeWorkflow(graph);
    expect(a.prompts.map((p) => p.nodeId)).toEqual(['2']);
    expect(a.slots.map((s) => [s.kind, s.input])).toEqual([['audio', 'audio'], ['video', 'file']]);
    expect(a.sizes).toEqual([{ nodeId: '6', pixels: 1024 * 1024, multiple: 16 }]);
    expect(a.outputs).toEqual(['image']);
  });

  it('rounds sizes to the workflow multiple while keeping the pixel budget', () => {
    expect(sizeForAspect(16 / 9, 400_000, 32)).toEqual({ width: 832, height: 480 });
    expect(sizeForAspect(9 / 16, 400_000, 32)).toEqual({ width: 480, height: 832 });
  });
});
