import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { generateGeminiImage, geminiAspectRatio, geminiImageModels, GEMINI_IMAGE_MODELS } from '../src/images/gemini';
import { GEMINI_TTS_MODEL_SETTING, geminiSpeechPrompt, geminiTtsModel, synthesizeGeminiSpeech } from '../src/audio/gemini';
import { GEMINI_MODELS_SETTING } from '../src/ai/gemini';
import { generateDialogue } from '../src/audio/generate';
import { linesNeedingAudio } from '../src/audio/clips';
import { suggestVoice } from '../src/audio/voices';
import { emptyHistory, runCommand } from '../src/state/commands';
import { createProject, type Project } from '../src/state/schema';
import { importScript } from '../src/story/commands';
import { SAMPLE_SCRIPT } from '../src/story/sample';
import { addCharacters, updateCharacter } from '../src/characters/commands';
import { resetDbForTests, setSetting } from '../src/storage/db';

vi.mock('../src/audio/player', () => ({ decodeDuration: async () => 1.5 }));

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  resetDbForTests();
});

const b64 = (bytes: number[]) => btoa(String.fromCharCode(...bytes));
const reply = (parts: object[], finishReason = 'STOP') => new Response(JSON.stringify({ candidates: [{ content: { role: 'model', parts }, finishReason }] }), { status: 200 });

describe('Gemini images', () => {
  it('sends the prompt and references, and returns the image', async () => {
    let url = '';
    let body: { contents: { parts: Record<string, unknown>[] }[]; generationConfig: Record<string, unknown> } | undefined;
    const fake = (async (u: string, init: RequestInit) => {
      url = u;
      body = JSON.parse(init.body as string);
      return reply([{ text: 'Here you go.' }, { inlineData: { mimeType: 'image/png', data: b64([1, 2, 3]) } }]);
    }) as unknown as typeof fetch;
    const preview = new Blob([new Uint8Array([9, 9])], { type: 'image/png' });
    const img = await generateGeminiImage({ apiKey: 'AIza', model: 'gemini-3-pro-image', prompt: 'A diner', aspect: 16 / 9, quality: 'high', references: [preview] }, fake);
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-image:generateContent');
    expect(body!.contents[0].parts).toEqual([{ text: 'A diner' }, { inlineData: { mimeType: 'image/png', data: b64([9, 9]) } }]);
    expect(body!.generationConfig).toEqual({ responseModalities: ['TEXT', 'IMAGE'], imageConfig: { aspectRatio: '16:9', imageSize: '2K' } });
    expect(img.type).toBe('image/png');
    expect([...new Uint8Array(await img.arrayBuffer())]).toEqual([1, 2, 3]);
  });

  it('explains when no image comes back, and checks the reference limit', async () => {
    const refused = (async () => reply([{ text: 'I can’t make that image.' }])) as unknown as typeof fetch;
    await expect(generateGeminiImage({ apiKey: 'k', model: 'gemini-3-pro-image', prompt: 'x', aspect: 1 }, refused)).rejects.toThrow('Gemini returned no image: I can’t make that image.');
    const four = Array.from({ length: 4 }, () => new Blob(['x'], { type: 'image/png' }));
    await expect(generateGeminiImage({ apiKey: 'k', model: 'gemini-2.5-flash-image', prompt: 'x', aspect: 1, references: four }, refused)).rejects.toThrow(/at most 3 images/);
    const badKey = (async () => new Response(JSON.stringify({ error: { message: 'API key not valid.' } }), { status: 400 })) as unknown as typeof fetch;
    await expect(generateGeminiImage({ apiKey: 'k', model: 'gemini-3-pro-image', prompt: 'x', aspect: 1 }, badKey)).rejects.toThrow(/rejected the Gemini API key/);
  });

  it('picks the nearest supported aspect ratio', () => {
    expect(geminiAspectRatio(1)).toBe('1:1');
    expect(geminiAspectRatio(2 / 3)).toBe('2:3');
    expect(geminiAspectRatio(1.85)).toBe('16:9');
    expect(geminiAspectRatio(2.39)).toBe('21:9');
    expect(geminiAspectRatio(9 / 16)).toBe('9:16');
  });

  it("lists the key's image models newest first, or the built-in ones", async () => {
    expect(await geminiImageModels()).toEqual(GEMINI_IMAGE_MODELS);
    await setSetting(GEMINI_MODELS_SETTING, ['gemini-3.5-flash', 'gemini-2.5-flash-image', 'gemini-3.1-flash-lite-image', 'gemini-3.1-flash-image', 'gemini-3-pro-image', 'gemini-3.8-flash-tts']);
    expect(await geminiImageModels()).toEqual(['gemini-3.1-flash-image', 'gemini-3.1-flash-lite-image', 'gemini-3-pro-image', 'gemini-2.5-flash-image']);
  });
});

describe('Gemini speech', () => {
  it('asks for the voice and wraps the PCM it returns as WAV', async () => {
    let body: { contents: { parts: { text: string }[] }[]; generationConfig: Record<string, unknown> } | undefined;
    const fake = (async (_u: string, init: RequestInit) => {
      body = JSON.parse(init.body as string);
      return reply([{ inlineData: { mimeType: 'audio/L16;codec=pcm;rate=24000', data: b64([1, 0, 2, 0]) } }]);
    }) as unknown as typeof fetch;
    const wav = await synthesizeGeminiSpeech({ apiKey: 'k', model: 'gemini-3.8-flash-tts', voice: { provider: 'gemini', voiceId: 'Kore', speed: 1 }, text: 'Hi.' }, fake);
    expect(body!.generationConfig).toEqual({ responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } } });
    expect(body!.contents[0].parts[0].text).toBe('Hi.');
    expect(wav.type).toBe('audio/wav');
    const view = new DataView(await wav.arrayBuffer());
    expect(String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3))).toBe('RIFF');
    expect(view.getUint32(24, true)).toBe(24000);
    expect(view.getUint16(34, true)).toBe(16);
    expect(view.getUint32(40, true)).toBe(4);
    expect(wav.size).toBe(48);
  });

  it('puts style and pace ahead of the line', () => {
    expect(geminiSpeechPrompt('Go.', { speed: 1, instructions: 'gravelly, tired' })).toBe('Say this line with the following delivery (gravelly, tired). Speak only the line itself:\nGo.');
    expect(geminiSpeechPrompt('Go.', { speed: 1.3 })).toBe('Say this line with the following delivery (a little faster than normal). Speak only the line itself:\nGo.');
    expect(geminiSpeechPrompt('Go.', { speed: 1 })).toBe('Go.');
  });

  it('uses the chosen speech model, else the newest stable one the key has', async () => {
    await setSetting(GEMINI_MODELS_SETTING, ['gemini-3.1-flash-tts-preview', 'gemini-3.8-flash-lite-tts', 'gemini-3.8-flash-tts']);
    expect(await geminiTtsModel()).toBe('gemini-3.8-flash-tts');
    await setSetting(GEMINI_TTS_MODEL_SETTING, 'gemini-3.1-flash-tts-preview');
    expect(await geminiTtsModel()).toBe('gemini-3.1-flash-tts-preview');
  });
});

describe('voicing dialogue with both providers', () => {
  function sample(): Project {
    let [p, h] = runCommand(createProject('T'), emptyHistory(), importScript(SAMPLE_SCRIPT));
    [p, h] = runCommand(p, h, addCharacters(['Maya', 'Dex'], ['maya', 'dex']));
    const maya = p.characters.find((c) => c.name === 'Maya')!;
    [p] = runCommand(p, h, updateCharacter(maya.id, { voice: { provider: 'gemini', voiceId: 'Kore', speed: 1 } }));
    return p;
  }

  it('sends each line to its voice provider', async () => {
    const p = sample();
    const hosts: string[] = [];
    const fake = (async (u: string) => {
      hosts.push(new URL(u).host);
      return u.includes('googleapis')
        ? reply([{ inlineData: { mimeType: 'audio/L16;codec=pcm;rate=24000', data: b64([0, 0]) } }])
        : new Response('mp3', { status: 200 });
    }) as unknown as typeof fetch;
    vi.stubGlobal('fetch', fake);
    const clips: { lineId: string; blob: string }[] = [];
    const lines = linesNeedingAudio(p);
    const { done, error } = await generateDialogue(p, { apiKey: 'sk', model: 'gpt-4o-mini-tts', gemini: { apiKey: 'AIza', model: 'gemini-3.8-flash-tts' }, onBatch: (c) => clips.push(...c) }, lines);
    vi.unstubAllGlobals();
    expect(error).toBeUndefined();
    expect(done).toBe(lines.length);
    const mayaLines = new Set(lines.filter((l) => l.character.name === 'Maya').map((l) => l.line.id));
    expect(mayaLines.size).toBeGreaterThan(0);
    for (const c of clips) expect(c.blob.startsWith('tts-wav-')).toBe(mayaLines.has(c.lineId));
    expect(hosts.filter((h) => h === 'generativelanguage.googleapis.com').length).toBe(mayaLines.size);
  });

  it('says which key a voice needs', async () => {
    const p = sample();
    const lines = linesNeedingAudio(p).filter((l) => l.character.name === 'Maya').slice(0, 1);
    const { error } = await generateDialogue(p, { apiKey: 'sk', model: 'm' }, lines);
    expect(error?.message).toBe('Maya has a Gemini voice. Add your Gemini API key in Settings to voice them.');
  });

  it('suggests Gemini voices for Gemini characters', () => {
    expect(suggestVoice('female', ['Kore'], 'gemini')).toEqual({ provider: 'gemini', voiceId: 'Aoede', speed: 1 });
  });
});
