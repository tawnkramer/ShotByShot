/**
 * Cloudflare Worker that forwards the ShotByShot web app's requests to Comfy Cloud and OpenArt and adds
 * the CORS headers those services don't send. It keeps nothing: the Comfy API key or OpenArt token
 * arrives with each request and goes only to that service. Outputs are fetched from signed storage URLs,
 * which carry no credentials.
 *
 *   /api/...                   → https://cloud.comfy.org/api/...
 *   /storage?url=<url>         → a signed https://storage.googleapis.com/... URL
 *   /openart/mcp               → https://mcp.openart.ai/mcp
 *   /openart/oauth/<step>      → https://openart.ai/suite/api/auth/oauth/<step> (register, token, revoke)
 */
export const COMFY_ORIGIN = 'https://cloud.comfy.org';
export const OPENART_MCP = 'https://mcp.openart.ai/mcp';
const OPENART_OAUTH = 'https://openart.ai/suite/api/auth/oauth/';
const OAUTH_STEPS = ['register', 'token', 'revoke'];
const STORAGE_HOSTS = ['storage.googleapis.com'];
const FORWARDED = ['authorization', 'content-type', 'idempotency-key', 'x-api-key', 'accept', 'range', 'mcp-session-id', 'mcp-protocol-version', 'last-event-id'];
/** Hosts that may receive the Authorization header. */
const CREDENTIAL_ORIGINS = [COMFY_ORIGIN, new URL(OPENART_MCP).origin, new URL(OPENART_OAUTH).origin];

export interface Env { ALLOWED_ORIGINS?: string }

export default {
  async fetch(request: Request, env: Env, _ctx?: unknown, fetchImpl: typeof fetch = fetch): Promise<Response> {
    const origin = request.headers.get('Origin');
    const allowed = (env.ALLOWED_ORIGINS ?? '').split(',').map((o) => o.trim()).filter(Boolean);
    if (!origin || !(allowed.includes(origin) || allowed.includes('*'))) return text('This relay only serves the ShotByShot app.', 403, null);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(origin) });

    const url = new URL(request.url);
    let target: URL;
    if (url.pathname === '/storage') {
      try { target = new URL(url.searchParams.get('url') ?? ''); } catch { return text('Missing storage URL.', 400, origin); }
      if (target.protocol !== 'https:' || !STORAGE_HOSTS.includes(target.host) || request.method !== 'GET') return text('Not a Comfy storage URL.', 400, origin);
    } else if (url.pathname.startsWith('/api/')) {
      target = new URL(url.pathname + url.search, COMFY_ORIGIN);
    } else if (url.pathname === '/openart/mcp') {
      target = new URL(OPENART_MCP + url.search);
    } else if (url.pathname.startsWith('/openart/oauth/') && OAUTH_STEPS.includes(url.pathname.slice('/openart/oauth/'.length)) && request.method === 'POST') {
      target = new URL(url.pathname.slice('/openart/oauth/'.length), OPENART_OAUTH);
    } else {
      return text('ShotByShot relay is running.', url.pathname === '/' ? 200 : 404, origin);
    }

    const headers = new Headers();
    // Storage URLs are signed; never send the key there.
    for (const name of FORWARDED) {
      const value = request.headers.get(name);
      if (value && !(name === 'authorization' && !CREDENTIAL_ORIGINS.includes(target.origin))) headers.set(name, value);
    }
    const hasBody = !['GET', 'HEAD'].includes(request.method);
    const upstream = await fetchImpl(target.toString(), { method: request.method, headers, body: hasBody ? request.body : undefined, redirect: 'follow', ...(hasBody ? { duplex: 'half' } : {}) } as RequestInit);
    const out = new Headers(upstream.headers);
    // The body is already decoded here, so drop headers that describe the encoded one.
    for (const name of ['set-cookie', 'content-encoding', 'content-length']) out.delete(name);
    for (const [k, v] of Object.entries(corsBase(origin))) out.set(k, v);
    return new Response(upstream.body, { status: upstream.status, statusText: upstream.statusText, headers: out });
  },
};

function corsBase(origin: string): Record<string, string> {
  return { 'Access-Control-Allow-Origin': origin, Vary: 'Origin', 'Access-Control-Expose-Headers': 'Content-Type, Content-Length, Content-Disposition, Mcp-Session-Id, WWW-Authenticate' };
}

function cors(origin: string): Record<string, string> {
  return {
    ...corsBase(origin),
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': FORWARDED.join(', '),
    'Access-Control-Max-Age': '86400',
  };
}

function text(body: string, status: number, origin: string | null): Response {
  return new Response(body, { status, headers: { 'Content-Type': 'text/plain', ...(origin ? corsBase(origin) : {}) } });
}
