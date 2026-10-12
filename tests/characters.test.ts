import { describe, expect, it } from 'vitest';
import { emptyHistory, runCommand } from '../src/state/commands';
import { createProject } from '../src/state/schema';
import { importScript } from '../src/story/commands';
import { SAMPLE_SCRIPT } from '../src/story/sample';
import { addCharacters, deleteCharacter, displayName, firstLineOf, heightLabel, namesFromScript, updateCharacter } from '../src/characters/commands';
import { synthesizeSpeech } from '../src/audio/tts';

describe('characters', () => {
  const [p] = runCommand(createProject('T'), emptyHistory(), importScript(SAMPLE_SCRIPT));

  it('finds names in the script, most lines first', () => {
    expect(namesFromScript(p)).toEqual(['Dex', 'Maya']); // Dex has four lines to Maya's three
    expect(displayName("MR. O'BRIEN (V.O.)")).toBe("Mr. O'Brien");
  });

  it('adds characters with distinct tints and voices, skipping existing names', () => {
    const [q] = runCommand(p, emptyHistory(), addCharacters(['Maya', 'Dex'], ['m', 'd']));
    expect(q.characters.map((c) => c.name)).toEqual(['Maya', 'Dex']);
    expect(q.characters[0].tint).not.toBe(q.characters[1].tint);
    expect(q.characters[0].voice.voiceId).not.toBe(q.characters[1].voice.voiceId);
    expect(namesFromScript(q)).toEqual([]);
  });

  it('picks a fitting voice when sex changes', () => {
    let [q, h] = runCommand(p, emptyHistory(), addCharacters(['Maya'], ['m']));
    [q, h] = runCommand(q, h, updateCharacter('m', { sex: 'female' }));
    expect(['coral', 'nova', 'shimmer', 'sage']).toContain(q.characters[0].voice.voiceId);
    [q] = runCommand(q, h, updateCharacter('m', { tint: undefined }));
    expect('tint' in q.characters[0]).toBe(false);
  });

  it('finds the first spoken line for previews', () => {
    const [q] = runCommand(p, emptyHistory(), addCharacters(['Dex'], ['d']));
    expect(firstLineOf(q, q.characters[0])).toBe('Door says open.');
  });

  it('deletes characters', () => {
    let [q, h] = runCommand(p, emptyHistory(), addCharacters(['Maya'], ['m']));
    [q, h] = runCommand(q, h, deleteCharacter('m'));
    expect(q.characters).toHaveLength(0);
  });

  it('formats heights in metric and imperial', () => {
    expect(heightLabel(178)).toBe('178 cm · 5′10″');
  });
});

describe('speech', () => {
  it('sends voice, speed and instructions to OpenAI', async () => {
    let sent: { url: string; body: Record<string, unknown> } | undefined;
    const fake = (async (url: string, init: RequestInit) => {
      sent = { url, body: JSON.parse(init.body as string) };
      return new Response('mp3', { status: 200 });
    }) as unknown as typeof fetch;
    await synthesizeSpeech({ apiKey: 'k', model: 'gpt-4o-mini-tts', voice: { provider: 'openai', voiceId: 'coral', speed: 1.1, instructions: 'tired' }, text: 'Hi' }, fake);
    expect(sent!.url).toMatch(/audio\/speech$/);
    expect(sent!.body).toMatchObject({ voice: 'coral', speed: 1.1, input: 'Hi', instructions: 'tired' });
  });

  it('explains auth errors', async () => {
    const fake = (async () => new Response('{}', { status: 401 })) as unknown as typeof fetch;
    await expect(synthesizeSpeech({ apiKey: 'k', model: 'm', voice: { provider: 'openai', voiceId: 'x', speed: 1 }, text: 'Hi' }, fake)).rejects.toThrow(/API key/);
  });
});
