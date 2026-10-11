import { describe, expect, it, vi } from 'vitest';
import { characterImagePrompt, generateCharacterImage } from '../src/images/generate';
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
