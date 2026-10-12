/**
 * Test-only: serves the app's Chat Completions requests through the
 * Responses API, for models that only allow tools with reasoning there.
 * Reasoning items are carried between rounds (store: false, encrypted).
 */
type Msg = { role: string; content: unknown; tool_calls?: { id: string; function: { name: string; arguments: string } }[]; tool_call_id?: string };
type Part = { type: string; text?: string; image_url?: { url: string } };

export function responsesFetch(real: typeof fetch, effort: string): typeof fetch {
  const reasoningAfter = new Map<string, unknown[]>();
  return async (url, init) => {
    if (!String(url).endsWith('/chat/completions') || typeof init?.body !== 'string') return real(url, init);
    const body = JSON.parse(init.body) as { model: string; messages: Msg[]; tools?: { function: { name: string; description: string; parameters: unknown } }[] };
    const input: unknown[] = [];
    let instructions = '';
    for (const m of body.messages) {
      if (m.role === 'system') instructions = String(m.content);
      else if (m.role === 'user') {
        const parts = typeof m.content === 'string' ? [{ type: 'text', text: m.content }] : (m.content as Part[]);
        input.push({ role: 'user', content: parts.map((p) => (p.type === 'text' ? { type: 'input_text', text: p.text } : { type: 'input_image', image_url: p.image_url!.url })) });
      } else if (m.role === 'assistant') {
        if (m.tool_calls?.length) input.push(...(reasoningAfter.get(m.tool_calls[0].id) ?? []));
        if (m.content) input.push({ role: 'assistant', content: [{ type: 'output_text', text: String(m.content) }] });
        for (const c of m.tool_calls ?? []) input.push({ type: 'function_call', call_id: c.id, name: c.function.name, arguments: c.function.arguments });
      } else if (m.role === 'tool') input.push({ type: 'function_call_output', call_id: m.tool_call_id, output: String(m.content) });
    }
    const res = await real('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: init.headers,
      signal: init.signal,
      body: JSON.stringify({
        model: body.model, instructions, input, store: false, include: ['reasoning.encrypted_content'], reasoning: { effort },
        tools: body.tools?.map((t) => ({ type: 'function', name: t.function.name, description: t.function.description, parameters: t.function.parameters, strict: false })),
      }),
    });
    if (!res.ok) return res;
    const out = (await res.json()) as { output: { type: string; content?: { type: string; text: string }[]; call_id?: string; name?: string; arguments?: string }[] };
    const text = out.output.filter((o) => o.type === 'message').flatMap((o) => o.content ?? []).filter((c) => c.type === 'output_text').map((c) => c.text).join('');
    const calls = out.output.filter((o) => o.type === 'function_call');
    if (calls.length) reasoningAfter.set(calls[0].call_id!, out.output.filter((o) => o.type === 'reasoning'));
    const delta = { content: text || undefined, tool_calls: calls.length ? calls.map((c, index) => ({ index, id: c.call_id, function: { name: c.name, arguments: c.arguments } })) : undefined };
    return new Response(`data: ${JSON.stringify({ choices: [{ delta }] })}\n\ndata: [DONE]\n\n`, { status: 200 });
  };
}
