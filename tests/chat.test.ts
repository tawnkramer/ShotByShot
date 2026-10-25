import { beforeEach, describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { AUTO_CHAT_MODEL_SETTING, CHAT_MODEL_SETTING, PREFERRED_CHAT_MODELS, chatModel, streamChat, toResponsesInput, type ChatMessage } from '../src/ai/chat';
import { getSetting, resetDbForTests, setSetting } from '../src/storage/db';

function sse(events: object[]): Response {
  const body = events.map((e) => `event: ${(e as { type: string }).type}\ndata: ${JSON.stringify(e)}\n\n`).join('');
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

describe('streamChat', () => {
  it('streams text, returns whole tool calls and keeps reasoning', async () => {
    let sent: Record<string, unknown> = {};
    const fake = (async (url: string, init: RequestInit) => {
      expect(url).toMatch(/\/v1\/responses$/);
      sent = JSON.parse(init.body as string);
      return sse([
        { type: 'response.created' },
        { type: 'response.output_item.done', item: { type: 'reasoning', id: 'rs_1', encrypted_content: 'xyz' } },
        { type: 'response.output_text.delta', delta: 'Adding ' },
        { type: 'response.output_text.delta', delta: 'a bar.' },
        { type: 'response.function_call_arguments.delta', delta: '{"obj' },
        { type: 'response.output_item.done', item: { type: 'function_call', call_id: 'c1', name: 'add_objects', arguments: '{"objects":[]}' } },
        { type: 'response.output_item.done', item: { type: 'function_call', call_id: 'c2', name: 'snapshot', arguments: '' } },
        { type: 'response.completed' },
      ]);
    }) as unknown as typeof fetch;
    const seen: string[] = [];
    const tools = [{ type: 'function' as const, function: { name: 'snapshot', description: 'Look', parameters: { type: 'object' } } }];
    const r = await streamChat({ apiKey: 'k', model: 'gpt-5.5', messages: [{ role: 'system', content: 'Be brief.' }], tools, onText: (t) => seen.push(t) }, fake);
    expect(r.content).toBe('Adding a bar.');
    expect(seen).toEqual(['Adding ', 'a bar.']);
    expect(r.toolCalls.map((c) => [c.id, c.function.name, c.function.arguments])).toEqual([
      ['c1', 'add_objects', '{"objects":[]}'],
      ['c2', 'snapshot', '{}'],
    ]);
    expect(r.reasoning).toEqual([{ type: 'reasoning', id: 'rs_1', encrypted_content: 'xyz' }]);
    expect(sent).toMatchObject({ model: 'gpt-5.5', instructions: 'Be brief.', stream: true, store: false, include: ['reasoning.encrypted_content'], tools: [{ type: 'function', name: 'snapshot', strict: false }] });
  });

  it('turns HTTP errors and failed responses into readable messages', async () => {
    const denied = (async () => new Response(JSON.stringify({ error: { message: 'nope' } }), { status: 401 })) as unknown as typeof fetch;
    await expect(streamChat({ apiKey: 'k', model: 'm', messages: [] }, denied)).rejects.toThrow(/rejected the API key/);
    const failed = (async () => sse([{ type: 'response.failed', response: { error: { message: 'Overloaded.' } } }])) as unknown as typeof fetch;
    await expect(streamChat({ apiKey: 'k', model: 'm', messages: [] }, failed)).rejects.toThrow(/Overloaded\./);
    const codeOnly = (async () => sse([{ type: 'response.failed', response: { status: 'failed', error: { code: 'server_error' } } }])) as unknown as typeof fetch;
    await expect(streamChat({ apiKey: 'k', model: 'm', messages: [] }, codeOnly)).rejects.toThrow('OpenAI error: the response failed (server_error).');
    const nested = (async () => sse([{ type: 'error', error: { message: 'Invalid schema for function.', code: 'invalid_function_parameters' } }])) as unknown as typeof fetch;
    await expect(streamChat({ apiKey: 'k', model: 'm', messages: [] }, nested)).rejects.toThrow('OpenAI error: Invalid schema for function. (invalid_function_parameters)');
    const unreachable = (async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch;
    await expect(streamChat({ apiKey: 'k', model: 'm', messages: [] }, unreachable)).rejects.toThrow("Couldn't reach OpenAI (Failed to fetch). Check your connection.");
  });
});

describe('toResponsesInput', () => {
  it('turns the chat history into instructions and items, reasoning before the calls it led to', () => {
    const messages: ChatMessage[] = [
      { role: 'system', content: 'Rules.' },
      { role: 'user', content: 'Hi' },
      { role: 'assistant', content: 'Looking.', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'snapshot', arguments: '{}' } }], reasoning: [{ type: 'reasoning', id: 'rs_1' }] },
      { role: 'tool', tool_call_id: 'c1', content: 'Snapshot taken.' },
      { role: 'user', content: [{ type: 'text', text: 'Snapshot.' }, { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,AA' } }] },
    ];
    expect(toResponsesInput(messages)).toEqual({
      instructions: 'Rules.',
      input: [
        { role: 'user', content: [{ type: 'input_text', text: 'Hi' }] },
        { type: 'reasoning', id: 'rs_1' },
        { role: 'assistant', content: [{ type: 'output_text', text: 'Looking.' }] },
        { type: 'function_call', call_id: 'c1', name: 'snapshot', arguments: '{}' },
        { type: 'function_call_output', call_id: 'c1', output: 'Snapshot taken.' },
        { role: 'user', content: [{ type: 'input_text', text: 'Snapshot.' }, { type: 'input_image', image_url: 'data:image/jpeg;base64,AA' }] },
      ],
    });
  });
});

describe('chatModel', () => {
  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory();
    resetDbForTests();
  });

  const models = (ids: string[]) => (async () => new Response(JSON.stringify({ data: ids.map((id) => ({ id })) }), { status: 200 })) as unknown as typeof fetch;

  it('picks the best preferred model the key has, without saving it as the user choice', async () => {
    expect(PREFERRED_CHAT_MODELS[0]).toBe('gpt-5.5');
    expect(await chatModel('k', models(['gpt-4o', 'gpt-5.5', 'gpt-5-mini']))).toBe('gpt-5.5');
    expect(await getSetting(CHAT_MODEL_SETTING)).toBeUndefined();
    expect(await getSetting(AUTO_CHAT_MODEL_SETTING)).toMatchObject({ model: 'gpt-5.5' });
    // Cached: no second lookup.
    expect(await chatModel('k', models([]))).toBe('gpt-5.5');
  });

  it('uses the user choice, but treats an old automatic pick as automatic once', async () => {
    await setSetting(CHAT_MODEL_SETTING, 'gpt-6.1-sol');
    expect(await chatModel('k', models(['gpt-5.5']))).toBe('gpt-6.1-sol');
    await setSetting(CHAT_MODEL_SETTING, 'gpt-5-mini');
    expect(await chatModel('k', models(['gpt-5.5', 'gpt-5-mini']))).toBe('gpt-5.5');
    // Picking it again afterwards sticks.
    await setSetting(CHAT_MODEL_SETTING, 'gpt-5-mini');
    expect(await chatModel('k', models(['gpt-5.5', 'gpt-5-mini']))).toBe('gpt-5-mini');
  });
});
