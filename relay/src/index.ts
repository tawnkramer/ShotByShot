/**
 * Cloudflare Worker that forwards the ShotByShot web app's requests to Comfy Cloud and adds the CORS
 * headers Comfy doesn't send. It keeps nothing: the Comfy API key arrives with each request and goes
 * only to cloud.comfy.org. Outputs are fetched from Comfy's signed storage URLs, which carry no key.
 *
 *   /api/...            → https://cloud.comfy.org/api/...
 *   /storage?url=<url>  → a signed https://storage.googleapis.com/... URL
 */
export const COMFY_ORIGIN = 'https://cloud.comfy.org';
const STORAGE_HOSTS = ['storage.googleapis.com'];
const FORWARDED = ['authorization', 'content-type', 'idempotency-key', 'x-api-key', 'accept', 'range'];

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
    } else {
      return text('ShotByShot Comfy relay is running.', url.pathname === '/' ? 200 : 404, origin);
    }

    const headers = new Headers();
    // Storage URLs are signed; never send the key there.
    for (const name of FORWARDED) {
      const value = request.headers.get(name);
      if (value && !(target.origin !== COMFY_ORIGIN && name === 'authorization')) headers.set(name, value);
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
  return { 'Access-Control-Allow-Origin': origin, Vary: 'Origin', 'Access-Control-Expose-Headers': 'Content-Type, Content-Length, Content-Disposition' };
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
