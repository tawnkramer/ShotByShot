import { describe, expect, it, vi } from 'vitest';
import { characterImagePrompt, generateCharacterImage, generateStageImage, stageImagePrompt } from '../src/images/generate';
import { setStageImage } from '../src/staging/commands';
import { newCharacter, updateCharacter } from '../src/characters/commands';
import { createProject, migrateProject } from '../src/state/schema';
import { encodeProjectZip, decodeProjectFile } from '../src/storage/projectFile';
import { referencedBlobKeys } from '../src/storage/projectIO';
import { emptyHistory, runCommand, undo } from '../src/state/commands';

describe('character image generation', () => {
  it('sends one portrait request to OpenAI and decodes its PNG bytes', async () => {
    const fake = vi.fn(async () => new Response(JSON.stringify({ data: [{ b64_json: 'AQID' }] })));
    const abort = new AbortController();
    const image = await generateCharacterImage({ apiKey: 'test-key', prompt: 'Ben', signal: abort.signal }, fake as typeof fetch);
    const [url, options] = fake.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.openai.com/v1/images/generations');
    expect(options.signal).toBe(abort.signal);
    expect(JSON.parse(options.body as string)).toMatchObject({ n: 1, size: '1024x1536', output_format: 'png' });
    expect(image.type).toBe('image/png');
    expect(image.size).toBe(3);
  });
  it('reports authentication, billing and missing-image errors', async () => {
    for (const [status, expected] of [[401, /rejected/], [429, /quota/], [403, /verification required/]] as const) {
      await expect(generateCharacterImage({ apiKey: 'k', prompt: 'Ben' }, (async () => new Response(JSON.stringify({ error: { message: 'verification required' } }), { status })) as typeof fetch)).rejects.toThrow(expected);
    }
    await expect(generateCharacterImage({ apiKey: 'k', prompt: 'Ben' }, (async () => new Response('{}')) as typeof fetch)).rejects.toThrow(/no image/);
  });
  it('does not make a request without a key or prompt', async () => {
    const fake = vi.fn();
    await expect(generateCharacterImage({ apiKey: '', prompt: 'Ben' }, fake)).rejects.toThrow(/Settings/);
    await expect(generateCharacterImage({ apiKey: 'k', prompt: ' ' }, fake)).rejects.toThrow(/Describe/);
    expect(fake).not.toHaveBeenCalled();
  });
  it('uses age, build and appearance notes in the editable prompt', () => {
    const c = { ...newCharacter('Ben', [], 'ben'), sex: 'male' as const, ageBand: '30s' as const, attributes: ['black hair', 'red jacket'] };
    expect(characterImagePrompt(c)).toMatch(/Ben.*\n.*male.*172.*average.*30s.*\n.*black hair; red jacket/);
  });
  it('preserves image metadata and asset through project export/import and undo', () => {
    const p = createProject('Images'); p.characters.push(newCharacter('Ben', [], 'ben'));
    const image = { blob: 'art1', prompt: 'Ben in a jacket', model: 'gpt-image-1.5', createdAt: 123 };
    const [next, history] = runCommand(p, emptyHistory(), updateCharacter('ben', { image }));
    const decoded = decodeProjectFile(encodeProjectZip({ project: next, assets: new Map([['art1', new Uint8Array([1, 2, 3])]]) }));
    expect(decoded.project.characters[0].image).toEqual(image);
    expect(decoded.assets.get('art1')).toEqual(new Uint8Array([1, 2, 3]));
    expect(referencedBlobKeys(next)).toContain('art1');
    expect(undo(next, history)[0].characters[0].image).toBeUndefined();
    expect(migrateProject(p).characters[0].image).toBeUndefined();
  });
});

describe('stage images', () => {
  it('uploads the exact stage snapshot and prompt as a multipart image edit', async () => {
    const reference = new Blob(['snapshot'], { type: 'image/png' });
    const fake = vi.fn(async () => new Response(JSON.stringify({ data: [{ b64_json: 'AQID' }] })));
    const signal = new AbortController().signal;
    const result = await generateStageImage({ apiKey: 'key', prompt: 'Warm cafe', reference, signal }, fake as typeof fetch);
    const [url, options] = fake.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.openai.com/v1/images/edits');
    expect(options.signal).toBe(signal);
    expect(options.headers).toEqual({ Authorization: 'Bearer key' });
    const form = options.body as FormData;
    expect(form.get('prompt')).toBe('Warm cafe');
    expect(form.get('size')).toBe('1536x1024');
    expect(form.get('n')).toBe('1');
    const uploaded = form.get('image[]') as File;
    expect(uploaded.name).toBe('stage-preview.png');
    expect(uploaded.type).toBe('image/png');
    expect(uploaded.size).toBe(reference.size);
    expect(result.size).toBe(3);
  });
  it('round-trips artwork and reference assets and supports undo', () => {
    const p = createProject('Stage');
    p.stages.push({ id: 'stage', name: 'Cafe', sceneLineIds: [], objects: [] });
    const image = { blob: 'art', guidanceBlob: 'reference', prompt: 'Warm cafe', model: 'gpt-image-1.5', createdAt: 123 };
    const [next, history] = runCommand(p, emptyHistory(), setStageImage('stage', image));
    expect(referencedBlobKeys(next).sort()).toEqual(['art', 'reference']);
    const decoded = decodeProjectFile(encodeProjectZip({ project: next, assets: new Map([['art', new Uint8Array([1])], ['reference', new Uint8Array([2])]]) }));
    expect(decoded.project.stages[0].image).toEqual(image);
    expect(decoded.assets.size).toBe(2);
    expect(undo(next, history)[0].stages[0].image).toBeUndefined();
    expect(stageImagePrompt(p.stages[0])).toMatch(/Cafe.*\n.*camera angle/);
  });
});
