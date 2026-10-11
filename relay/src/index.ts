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
 *   /openart/media?url=<url>   → OpenArt's presigned upload URLs (PUT) and generated media (GET), on media hosts only
 */
export const COMFY_ORIGIN = 'https://cloud.comfy.org';
export const OPENART_MCP = 'https://mcp.openart.ai/mcp';
const OPENART_OAUTH = 'https://openart.ai/suite/api/auth/oauth/';
const OAUTH_STEPS = ['register', 'token', 'revoke'];
const STORAGE_HOSTS = ['storage.googleapis.com'];
/** Hosts OpenArt uploads to and serves results from: its own domains and the cloud storage behind presigned URLs. */
const OPENART_MEDIA_SUFFIXES = ['.openart.ai', '.googleapis.com', '.amazonaws.com', '.r2.cloudflarestorage.com', '.cloudfront.net'];
export function isOpenArtMediaHost(host: string): boolean {
  return host === 'openart.ai' || OPENART_MEDIA_SUFFIXES.some((suffix) => host.endsWith(suffix));
}
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
    } else if (url.pathname === '/openart/media') {
      try { target = new URL(url.searchParams.get('url') ?? ''); } catch { return text('Missing media URL.', 400, origin); }
      if (target.protocol !== 'https:' || !isOpenArtMediaHost(target.hostname) || !['GET', 'PUT'].includes(request.method)) return text(`Not an OpenArt media URL (${target.hostname}).`, 400, origin);
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
    // Storage and media URLs are presigned; never send the key or token there.
    const sendsCredentials = !['/storage', '/openart/media'].includes(url.pathname) && CREDENTIAL_ORIGINS.includes(target.origin);
    for (const name of FORWARDED) {
      const value = request.headers.get(name);
      if (value && !(name === 'authorization' && !sendsCredentials)) headers.set(name, value);
    }
    const hasBody = !['GET', 'HEAD'].includes(request.method);
    // Buffer the body: a streamed one can't be replayed if the service answers with a redirect.
    const body = hasBody ? await request.arrayBuffer() : undefined;
    let upstream: Response;
    try {
      upstream = await fetchImpl(target.toString(), { method: request.method, headers, body, redirect: 'follow' });
    } catch (e) {
      // Answer with CORS headers so the app can show what went wrong instead of a bare network error.
      return text(`The relay couldn't reach ${target.host}: ${e instanceof Error ? e.message : String(e)}`, 502, origin);
    }
    const out = new Headers(upstream.headers);
    // The body is already decoded here, so drop headers that describe the encoded one.
    for (const name of ['set-cookie', 'content-encoding', 'content-length']) out.delete(name);
    for (const [k, v] of Object.entries(corsBase(origin))) out.set(k, v);
    // Statuses like 204 must not carry a body, even an empty stream.
    const empty = [101, 204, 205, 304].includes(upstream.status) || request.method === 'HEAD';
    return new Response(empty ? null : upstream.body, { status: upstream.status, statusText: upstream.statusText, headers: out });
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
