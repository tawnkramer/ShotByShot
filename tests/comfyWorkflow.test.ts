import { describe, expect, it } from 'vitest';
import fixture from './fixtures/minimax_h3_i2v.json';
import seedanceFixture from './fixtures/seedance25_r2v.json';
import seedanceMulti from './fixtures/seedance25_r2v_multi.json';
import { estimateWorkflowCost, formatCost } from '../src/comfy/cost';
import { analyzeWorkflow, bindWorkflow, boundDuration, closestRatio, defaultPromptTarget, describeAnalysis, groupKey, parseWorkflow, sizeForAspect, type AssetReference } from '../src/comfy/workflow';

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
    expect(a.durations).toEqual([{ nodeId: '105:111', input: 'value', integer: false }]);
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

describe('Seedance 2.5 reference workflow', () => {
  const seedance = () => parseWorkflow(JSON.stringify(seedanceFixture));

  it('exposes image, video and audio reference lists with Seedance 2.5 limits', () => {
    const a = analyzeWorkflow(seedance());
    expect(a.slots).toEqual([]);
    expect(a.groups.map((g) => [g.kind, g.prefix, g.max])).toEqual([
      ['image', 'model.reference_images.image_', 30], ['video', 'model.reference_videos.video_', 10], ['audio', 'model.reference_audios.audio_', 10]]);
    expect(defaultPromptTarget(a)).toMatchObject({ nodeId: '24', input: 'model.prompt' });
    expect(a.durations).toEqual([{ nodeId: '24', input: 'model.duration', integer: true, min: 4, max: 30 }]);
    expect(a.seeds).toEqual([{ nodeId: '24', input: 'seed' }]);
    expect(a.ratios).toEqual([{ nodeId: '24', input: 'model.ratio' }]);
    expect(describeAnalysis(a)).toBe('Inputs: references up to 30 images, 10 videos, 10 audio clips. Outputs: video.');
  });

  it('replaces the exported reference with one loader per chosen file', () => {
    const graph = seedance();
    const a = analyzeWorkflow(graph);
    const ref = (id: string): AssetReference => ({ __type: 'core/ASSET', info: { id } });
    const [images, videos, audios] = a.groups.map(groupKey);
    const bound = bindWorkflow(graph, a, {
      references: new Map([[images, [ref('i1'), ref('i2')]], [videos, [ref('v1')]], [audios, [ref('a1')]]]),
      prompt: 'Image 1 is the shot.', durationSec: 2.3, seed: 5, aspect: 2.39,
    });
    expect(bound['12']).toBeUndefined();
    const node = bound['24'].inputs;
    expect(Object.keys(node).filter((k) => k.includes('reference_')).sort()).toEqual([
      'model.reference_audios.audio_1', 'model.reference_images.image_1', 'model.reference_images.image_2', 'model.reference_videos.video_1']);
    const loader = (k: string) => bound[(node[k] as [string, number])[0]];
    expect(loader('model.reference_images.image_2')).toMatchObject({ class_type: 'LoadImage', inputs: { image: ref('i2') } });
    expect(loader('model.reference_videos.video_1')).toMatchObject({ class_type: 'LoadVideo', inputs: { file: ref('v1') } });
    expect(loader('model.reference_audios.audio_1')).toMatchObject({ class_type: 'LoadAudio', inputs: { audio: ref('a1') } });
    expect(node).toMatchObject({ 'model.prompt': 'Image 1 is the shot.', 'model.duration': 4, seed: 5, 'model.ratio': '21:9' });
    expect(boundDuration(a.durations[0], 7.4)).toBe(8);
    expect(boundDuration(a.durations[0], 45)).toBe(30);
    expect(() => bindWorkflow(graph, a, { references: new Map([[images, Array.from({ length: 31 }, (_, i) => ref(String(i)))]]) })).toThrow(/at most 30/);
  });

  it('picks the closest supported ratio', () => {
    expect(closestRatio(16 / 9)).toBe('16:9');
    expect(closestRatio(1.85)).toBe('16:9');
    expect(closestRatio(1.375)).toBe('4:3');
    expect(closestRatio(9 / 16)).toBe('9:16');
  });

  it('estimates Seedance prices from ComfyUI\'s published formula', () => {
    const graph = seedance();
    const a = analyzeWorkflow(graph);
    const [images, videos] = a.groups.map(groupKey);
    // 720p 16:9, 5 s, no reference video: floor(900 * 121) / 1000 * 0.015301
    const still = estimateWorkflowCost(bindWorkflow(graph, a, { references: new Map([[images, ['x']]]), durationSec: 5, aspect: 16 / 9 }))!;
    expect(still.min).toBeCloseTo(1.66627, 4);
    expect(still.max).toBe(still.min);
    expect(formatCost(still)).toBe('$1.67 USD');
    // A reference video changes the rate and adds up to 30 s of input to the range.
    const withVideo = estimateWorkflowCost(bindWorkflow(graph, a, { references: new Map([[images, ['x']], [videos, ['y']]]), durationSec: 5, aspect: 16 / 9 }))!;
    expect(withVideo.min).toBeCloseTo(Math.floor(900 * 121) / 1000 * 0.009152, 6);
    expect(withVideo.max).toBeCloseTo(Math.floor(900 * (24 * 35 + 1)) / 1000 * 0.009152, 6);
    expect(estimateWorkflowCost(minimax())).toBeUndefined();
  });
});

it('rewires a Seedance export with three images, a video and two audio clips', () => {
  const graph = parseWorkflow(JSON.stringify(seedanceMulti));
  const a = analyzeWorkflow(graph);
  expect(a.slots).toEqual([]);
  expect(a.groups.map((g) => g.kind)).toEqual(['image', 'video', 'audio']);
  const ref = (id: string): AssetReference => ({ __type: 'core/ASSET', info: { id } });
  const [images, videos, audios] = a.groups.map(groupKey);
  const bound = bindWorkflow(graph, a, { references: new Map([[images, [ref('i1')]], [videos, [ref('v1')]], [audios, []]]) });
  // Every exported loader is replaced, including the empty ones.
  for (const id of ['12', '1787498335737822', '3698026308920578', '1910581294304698', '823549616093337', '2349925732512186']) expect(bound[id]).toBeUndefined();
  const node = bound['24'].inputs;
  expect(Object.keys(node).filter((k) => k.includes('reference_')).sort()).toEqual(['model.reference_images.image_1', 'model.reference_videos.video_1']);
  expect(bound[(node['model.reference_videos.video_1'] as [string, number])[0]]).toMatchObject({ class_type: 'LoadVideo', inputs: { file: ref('v1') } });
  // A group left out of the binding keeps what the export connected.
  const untouched = bindWorkflow(graph, a, { references: new Map([[images, [ref('i1')]]]) });
  expect(untouched['24'].inputs['model.reference_audios.audio_2']).toEqual(['823549616093337', 0]);
});

it('treats an empty standalone loader as a fixed input', () => {
  const a = analyzeWorkflow(parseWorkflow(JSON.stringify({ 1: { class_type: 'LoadAudio', inputs: { audio: null } }, 2: { class_type: 'SaveAudio', inputs: { audio: ['1', 0] } } })));
  expect(a.slots).toEqual([{ nodeId: '1', input: 'audio', kind: 'audio', title: 'LoadAudio' }]);
});
