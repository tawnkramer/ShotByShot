import { describe, expect, it } from 'vitest';
import { streamChat } from '../src/ai/chat';

function sse(chunks: object[]): Response {
  const body = chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join('') + 'data: [DONE]\n\n';
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
  it('streams text and assembles tool call fragments', async () => {
    const fake = (async () =>
      sse([
        { choices: [{ delta: { content: 'Adding ' } }] },
        { choices: [{ delta: { content: 'a bar.' } }] },
        { choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'add_objects', arguments: '{"obj' } }] } }] },
        { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'ects":[]}' } }] } }] },
        { choices: [{ delta: { tool_calls: [{ index: 1, id: 'c2', function: { name: 'snapshot', arguments: '{}' } }] } }] },
      ])) as unknown as typeof fetch;
    const seen: string[] = [];
    const r = await streamChat({ apiKey: 'k', model: 'm', messages: [], onText: (t) => seen.push(t) }, fake);
    expect(r.content).toBe('Adding a bar.');
    expect(seen).toEqual(['Adding ', 'a bar.']);
    expect(r.toolCalls.map((c) => [c.id, c.function.name, c.function.arguments])).toEqual([
      ['c1', 'add_objects', '{"objects":[]}'],
      ['c2', 'snapshot', '{}'],
    ]);
  });

  it('turns HTTP errors into readable messages', async () => {
    const fake = (async () => new Response(JSON.stringify({ error: { message: 'nope' } }), { status: 401 })) as unknown as typeof fetch;
    await expect(streamChat({ apiKey: 'k', model: 'm', messages: [] }, fake)).rejects.toThrow(/rejected the API key/);
  });
});
