/** A canned OpenAI Responses stream: optional text, then tool calls, as the API sends them. */
export function responseStream(reply: { content?: string; tool_calls?: { id: string; function: { name: string; arguments: string } }[]; reasoning?: unknown[] }): Response {
  const events: object[] = [{ type: 'response.created' }];
  for (const r of reply.reasoning ?? []) events.push({ type: 'response.output_item.done', item: r });
  if (reply.content) {
    events.push({ type: 'response.output_text.delta', delta: reply.content });
    events.push({ type: 'response.output_item.done', item: { type: 'message', content: [{ type: 'output_text', text: reply.content }] } });
  }
  for (const c of reply.tool_calls ?? []) events.push({ type: 'response.output_item.done', item: { type: 'function_call', call_id: c.id, name: c.function.name, arguments: c.function.arguments } });
  events.push({ type: 'response.completed' });
  return new Response(events.map((e) => `event: ${(e as { type: string }).type}\ndata: ${JSON.stringify(e)}\n\n`).join(''), { status: 200 });
}

/** A request body as the app sends it to /v1/responses. */
export interface ResponsesBody {
  model: string;
  instructions: string;
  input: { role?: string; type?: string; content?: unknown; output?: string; call_id?: string }[];
}
