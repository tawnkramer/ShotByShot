import { beforeEach, describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { AUTO_GEMINI_MODEL_SETTING, GEMINI_KEY_SETTING, PREFERRED_GEMINI_MODELS, geminiChatModel, streamGeminiChat, testGeminiKey, toGeminiContents } from '../src/ai/gemini';
import { CHAT_MODEL_SETTING, type ChatMessage } from '../src/ai/chat';
import { API_KEY_SETTING } from '../src/ai/openai';
import { assistantModel } from '../src/ai/agent';
import { getSetting, resetDbForTests, setSetting } from '../src/storage/db';

function sse(chunks: object[]): Response {
  const body = chunks.map((c) => `data: ${JSON.stringify(c)}\r\n\r\n`).join('');
  // Split mid-line to make sure partial chunks are reassembled.
  const mid = Math.floor(body.length / 2);
  const stream = new ReadableStream({
    start(ctrl) {
      ctrl.enqueue(new TextEncoder().encode(body.slice(0, mid)));
      ctrl.enqueue(new TextEncoder().encode(body.slice(mid)));
      ctrl.close();
    },
  });
  return new Response(stream, { status: 200 });
}

const parts = (...p: object[]) => ({ candidates: [{ content: { role: 'model', parts: p } }] });

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  resetDbForTests();
});

describe('streamGeminiChat', () => {
  it('streams text, returns whole tool calls with their signatures and skips thoughts', async () => {
    let url = '';
    let init: RequestInit = {};
    const fake = (async (u: string, i: RequestInit) => {
      url = u;
      init = i;
      return sse([
        parts({ text: 'thinking…', thought: true }),
        parts({ text: 'Adding ' }),
        parts({ text: 'a bar.' }),
        parts({ functionCall: { name: 'add_objects', args: { objects: [] } }, thoughtSignature: 'sig1' }, { functionCall: { id: 'g2', name: 'snapshot' } }),
        { candidates: [{ content: { role: 'model', parts: [] }, finishReason: 'STOP' }] },
      ]);
    }) as unknown as typeof fetch;
    const seen: string[] = [];
    const tools = [{ type: 'function' as const, function: { name: 'snapshot', description: 'Look', parameters: { type: 'object', additionalProperties: false } } }];
    const r = await streamGeminiChat({ apiKey: 'AIza-k', model: 'gemini-3.5-flash', messages: [{ role: 'system', content: 'Be brief.' }, { role: 'user', content: 'Hi' }], tools, onText: (t) => seen.push(t) }, fake);
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:streamGenerateContent?alt=sse');
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe('AIza-k');
    expect(r.content).toBe('Adding a bar.');
    expect(seen).toEqual(['Adding ', 'a bar.']);
    expect(r.toolCalls).toEqual([
      { id: 'gemini-local-0', type: 'function', function: { name: 'add_objects', arguments: '{"objects":[]}' }, thoughtSignature: 'sig1' },
      { id: 'g2', type: 'function', function: { name: 'snapshot', arguments: '{}' } },
    ]);
    expect(JSON.parse(init.body as string)).toEqual({
      systemInstruction: { parts: [{ text: 'Be brief.' }] },
      contents: [{ role: 'user', parts: [{ text: 'Hi' }] }],
      tools: [{ functionDeclarations: [{ name: 'snapshot', description: 'Look', parametersJsonSchema: { type: 'object', additionalProperties: false } }] }],
    });
  });

  it('keeps the signature on a text answer', async () => {
    const fake = (async () => sse([parts({ text: 'Done.' }), parts({ text: '', thoughtSignature: 'sigT' })])) as unknown as typeof fetch;
    const r = await streamGeminiChat({ apiKey: 'k', model: 'gemini-3.5-flash', messages: [] }, fake);
    expect(r.reasoning).toEqual([{ type: 'gemini_signature', signature: 'sigT' }]);
  });

  it('turns HTTP errors, blocks and early stops into readable messages', async () => {
    const badKey = (async () => new Response(JSON.stringify({ error: { message: 'API key not valid. Please pass a valid API key.' } }), { status: 400 })) as unknown as typeof fetch;
    await expect(streamGeminiChat({ apiKey: 'k', model: 'm', messages: [] }, badKey)).rejects.toThrow(/rejected the Gemini API key/);
    const quota = (async () => new Response('{}', { status: 429 })) as unknown as typeof fetch;
    await expect(streamGeminiChat({ apiKey: 'k', model: 'm', messages: [] }, quota)).rejects.toThrow(/quota/);
    const blocked = (async () => sse([{ promptFeedback: { blockReason: 'SAFETY' } }])) as unknown as typeof fetch;
    await expect(streamGeminiChat({ apiKey: 'k', model: 'm', messages: [] }, blocked)).rejects.toThrow(/blocked the request \(SAFETY\)/);
    const malformed = (async () => sse([{ candidates: [{ finishReason: 'MALFORMED_FUNCTION_CALL' }] }])) as unknown as typeof fetch;
    await expect(streamGeminiChat({ apiKey: 'k', model: 'm', messages: [] }, malformed)).rejects.toThrow(/stopped early \(MALFORMED_FUNCTION_CALL\)/);
  });
});

describe('toGeminiContents', () => {
  it('sends calls back with their signatures and groups their results', () => {
    const messages: ChatMessage[] = [
      { role: 'system', content: 'Sys' },
      { role: 'user', content: [{ type: 'text', text: 'Look' }, { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,QUJD' } }] },
      {
        role: 'assistant',
        content: 'Checking.',
        tool_calls: [
          { id: 'gemini-local-0', type: 'function', function: { name: 'snapshot', arguments: '' }, thoughtSignature: 'sig1' },
          { id: 'g2', type: 'function', function: { name: 'list', arguments: '{"a":1}' } },
        ],
      },
      { role: 'tool', tool_call_id: 'gemini-local-0', content: 'ok' },
      { role: 'tool', tool_call_id: 'g2', content: '[]' },
      { role: 'user', content: [{ type: 'text', text: 'Snapshot.' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,WFla' } }] },
      { role: 'assistant', content: 'Done.', reasoning: [{ type: 'gemini_signature', signature: 'sigT' }] },
    ];
    expect(toGeminiContents(messages)).toEqual({
      systemInstruction: { parts: [{ text: 'Sys' }] },
      contents: [
        { role: 'user', parts: [{ text: 'Look' }, { inlineData: { mimeType: 'image/jpeg', data: 'QUJD' } }] },
        {
          role: 'model',
          parts: [
            { text: 'Checking.' },
            { functionCall: { name: 'snapshot', args: {} }, thoughtSignature: 'sig1' },
            { functionCall: { id: 'g2', name: 'list', args: { a: 1 } } },
          ],
        },
        {
          role: 'user',
          parts: [
            { functionResponse: { name: 'snapshot', response: { result: 'ok' } } },
            { functionResponse: { id: 'g2', name: 'list', response: { result: '[]' } } },
          ],
        },
        { role: 'user', parts: [{ text: 'Snapshot.' }, { inlineData: { mimeType: 'image/png', data: 'WFla' } }] },
        { role: 'model', parts: [{ text: 'Done.', thoughtSignature: 'sigT' }] },
      ],
    });
  });
});

describe('Gemini keys and models', () => {
  const models = (names: string[]) =>
    (async () => new Response(JSON.stringify({ models: names.map((n) => ({ name: `models/${n}`, supportedGenerationMethods: ['generateContent'] })) }), { status: 200 })) as unknown as typeof fetch;

  it('tests a key by listing its chat models', async () => {
    const ok = await testGeminiKey('k', models(['gemini-2.5-flash', 'gemini-3.5-flash']));
    expect(ok).toEqual({ ok: true, message: 'Key works. 2 models available.', models: ['gemini-2.5-flash', 'gemini-3.5-flash'] });
    const bad = await testGeminiKey('k', (async () => new Response(JSON.stringify({ error: { message: 'API key not valid.' } }), { status: 400 })) as unknown as typeof fetch);
    expect(bad).toMatchObject({ ok: false, message: 'Google rejected this key.' });
  });

  it('picks the best preferred model the key can use and remembers it', async () => {
    expect(await geminiChatModel('k', models(['gemini-2.5-pro', 'gemini-3-flash-preview']))).toBe('gemini-3-flash-preview');
    expect(await getSetting(AUTO_GEMINI_MODEL_SETTING)).toEqual({ list: PREFERRED_GEMINI_MODELS.join(','), model: 'gemini-3-flash-preview' });
  });

  it('routes the assistant to the provider of the chosen model, or OpenAI first when automatic', async () => {
    const none = models([]);
    await expect(assistantModel({}, none)).rejects.toThrow(/Add an OpenAI or Gemini API key/);
    await setSetting(GEMINI_KEY_SETTING, 'AIza');
    expect(await assistantModel({}, none)).toEqual({ provider: 'gemini', key: 'AIza', model: PREFERRED_GEMINI_MODELS[0] });
    await setSetting(API_KEY_SETTING, 'sk');
    expect((await assistantModel({}, none)).provider).toBe('openai');
    await setSetting(CHAT_MODEL_SETTING, 'gemini-2.5-pro');
    expect(await assistantModel({}, none)).toEqual({ provider: 'gemini', key: 'AIza', model: 'gemini-2.5-pro' });
    await expect(assistantModel({ gemini: '' }, none)).rejects.toThrow(/Add your Gemini API key in Settings to use gemini-2.5-pro/);
  });
});
