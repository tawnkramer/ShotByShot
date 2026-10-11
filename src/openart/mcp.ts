import { relayUrl } from '../comfy/client';
import { accessToken } from './auth';

/** A minimal MCP client (Streamable HTTP, JSON-RPC) for OpenArt's server, reached through the relay. */
export interface McpTool { name: string; title?: string; description?: string; inputSchema?: unknown; annotations?: { readOnlyHint?: boolean } }

const PROTOCOL = '2025-06-18';

export class OpenArtMcp {
  private session?: string;
  private nextId = 1;
  // The default calls the global fetch directly: as a method of this class it would throw "Illegal invocation".
  constructor(private readonly fetchImpl: typeof fetch = (input, init) => fetch(input, init)) {}

  private async post(body: object, expectReply: boolean): Promise<unknown> {
    const relay = await relayUrl();
    if (!relay) throw new Error('Set up the relay in Settings → ComfyUI Cloud first. OpenArt is reached through it too.');
    const headers: Record<string, string> = {
      Authorization: `Bearer ${await accessToken(this.fetchImpl)}`,
      'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'Mcp-Protocol-Version': PROTOCOL,
    };
    if (this.session) headers['Mcp-Session-Id'] = this.session;
    let res: Response;
    try {
      res = await this.fetchImpl(`${relay}/openart/mcp`, { method: 'POST', headers, body: JSON.stringify(body) });
    } catch (e) {
      throw new Error(`Couldn't reach OpenArt through the relay (${e instanceof Error ? e.message : String(e)}). Check the relay address and redeploy it if it predates OpenArt support.`);
    }
    if (res.status === 401) throw new Error('OpenArt rejected the sign-in. Sign in again in Settings.');
    this.session = res.headers.get('Mcp-Session-Id') ?? this.session;
    if (!expectReply) return undefined;
    const { message, text } = await readMessage(res);
    if (!res.ok && !message) throw new Error(`OpenArt returned an error (${res.status})${text.trim() ? `: ${text.trim().slice(0, 300)}` : '.'}`);
    const { result, error } = (message ?? {}) as { result?: unknown; error?: { message?: string } };
    if (error) throw new Error(`OpenArt: ${error.message ?? 'request failed'}`);
    return result;
  }

  private request(method: string, params?: object): Promise<unknown> {
    return this.post({ jsonrpc: '2.0', id: this.nextId++, method, ...(params ? { params } : {}) }, true);
  }

  private async connect(): Promise<void> {
    if (this.session !== undefined) return;
    await this.request('initialize', { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: 'ShotByShot', version: '1' } });
    this.session ??= '';
    await this.post({ jsonrpc: '2.0', method: 'notifications/initialized' }, false);
  }

  async listTools(): Promise<McpTool[]> {
    await this.connect();
    const tools: McpTool[] = [];
    let cursor: string | undefined;
    do {
      const page = await this.request('tools/list', cursor ? { cursor } : undefined) as { tools?: McpTool[]; nextCursor?: string };
      tools.push(...page.tools ?? []);
      cursor = page.nextCursor;
    } while (cursor);
    return tools;
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    await this.connect();
    return this.request('tools/call', { name, arguments: args });
  }
}

/** Reads one JSON-RPC message from a JSON body or an event stream. */
async function readMessage(res: Response): Promise<{ message: unknown; text: string }> {
  const text = await res.text();
  return { message: parseMessage(text, res.headers.get('Content-Type') ?? ''), text };
}

function parseMessage(text: string, type: string): unknown {
  if (!text.trim()) return undefined;
  if (type.includes('text/event-stream')) {
    const data = text.split(/\r?\n/).filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim());
    for (const chunk of data.reverse()) {
      try {
        const parsed = JSON.parse(chunk) as { id?: unknown };
        if (parsed.id !== undefined) return parsed;
      } catch { /* not JSON */ }
    }
    return undefined;
  }
  try { return JSON.parse(text); } catch { return undefined; }
}
