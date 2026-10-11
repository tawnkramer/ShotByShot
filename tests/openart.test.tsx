import { afterEach, describe, expect, it, vi } from 'vitest';
import relay from '../relay/src/index';
import { COMFY_RELAY_SETTING } from '../src/comfy/client';
import { accessToken, beginSignIn, finishSignIn, isSignInCallback, OPENART_TOKEN_SETTING } from '../src/openart/auth';
import { OpenArtMcp } from '../src/openart/mcp';
import { deleteSetting, getSetting, setSetting } from '../src/storage/db';

const APP = 'https://tawnkramer.github.io';
const RELAY = 'https://shotbyshot.me.workers.dev';
const loc = { origin: APP, pathname: '/ShotByShot/' };
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });

describe('relay OpenArt routes', () => {
  const env = { ALLOWED_ORIGINS: APP };
  it('forwards MCP calls with the token and exposes the session header', async () => {
    const fetchImpl = vi.fn(async (_url: string, _init: RequestInit) => json({}, 200, { 'Mcp-Session-Id': 's1' }));
    const res = await relay.fetch(new Request(`${RELAY}/openart/mcp`, { method: 'POST', body: '{}', headers: { Origin: APP, Authorization: 'Bearer t', 'Mcp-Session-Id': 's0' } }), env, undefined, fetchImpl as never);
    expect(fetchImpl.mock.calls[0][0]).toBe('https://mcp.openart.ai/mcp');
    const sent = fetchImpl.mock.calls[0][1].headers as Headers;
    expect([sent.get('authorization'), sent.get('mcp-session-id')]).toEqual(['Bearer t', 's0']);
    expect(res.headers.get('Mcp-Session-Id')).toBe('s1');
    expect(res.headers.get('Access-Control-Expose-Headers')).toMatch(/Mcp-Session-Id/);
  });
  it('forwards only the OAuth register, token and revoke steps', async () => {
    const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) => json({}));
    await relay.fetch(new Request(`${RELAY}/openart/oauth/token`, { method: 'POST', body: 'a=b', headers: { Origin: APP } }), env, undefined, fetchImpl as never);
    expect(fetchImpl.mock.calls[0][0]).toBe('https://openart.ai/suite/api/auth/oauth/token');
    const other = await relay.fetch(new Request(`${RELAY}/openart/oauth/authorize`, { method: 'POST', headers: { Origin: APP } }), env, undefined, fetchImpl as never);
    expect(other.status).toBe(404);
  });
});

describe('Sign in with OpenArt', () => {
  afterEach(async () => { await deleteSetting(COMFY_RELAY_SETTING); await deleteSetting(OPENART_TOKEN_SETTING); sessionStorage.clear(); });

  it('needs the relay', async () => {
    await expect(beginSignIn(vi.fn() as never, loc)).rejects.toThrow(/relay/);
  });

  it('registers once, signs in with PKCE and stores the token', async () => {
    await setSetting(COMFY_RELAY_SETTING, RELAY);
    const fetchImpl = vi.fn(async (url: string, _init?: RequestInit) => url.endsWith('/register') ? json({ client_id: 'c1' }, 201) : json({ access_token: 'a1', refresh_token: 'r1', expires_in: 3600 }));
    const url = new URL(await beginSignIn(fetchImpl as never, loc));
    expect(url.origin + url.pathname).toBe('https://openart.ai/suite/api/auth/oauth/authorize');
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ client_id: 'c1', redirect_uri: `${APP}/ShotByShot/`, code_challenge_method: 'S256', response_type: 'code' });
    const register = JSON.parse(fetchImpl.mock.calls[0][1]!.body as string);
    expect(register).toMatchObject({ redirect_uris: [`${APP}/ShotByShot/`], token_endpoint_auth_method: 'none' });

    const search = `?code=xyz&state=${url.searchParams.get('state')}`;
    expect(isSignInCallback(search)).toBe(true);
    expect(await finishSignIn(search, fetchImpl as never)).toBeUndefined();
    const token = new URLSearchParams(fetchImpl.mock.calls[1][1]!.body as string);
    expect(fetchImpl.mock.calls[1][0]).toBe(`${RELAY}/openart/oauth/token`);
    expect(Object.fromEntries(token)).toMatchObject({ grant_type: 'authorization_code', code: 'xyz', client_id: 'c1' });
    expect(token.get('code_verifier')).toMatch(/^[\w-]{43,}$/);
    expect(await getSetting(OPENART_TOKEN_SETTING)).toMatchObject({ access: 'a1', refresh: 'r1' });

    // A second sign-in reuses the registered client.
    await beginSignIn(fetchImpl as never, loc);
    expect(fetchImpl.mock.calls.filter(([u]) => u.endsWith('/register'))).toHaveLength(1);
  });

  it('rejects a callback with the wrong state', async () => {
    await setSetting(COMFY_RELAY_SETTING, RELAY);
    await beginSignIn(vi.fn(async () => json({ client_id: 'c1' })) as never, loc);
    expect(await finishSignIn('?code=x&state=nope')).toMatch(/expired|another tab/);
  });

  it('refreshes an expiring token', async () => {
    await setSetting(COMFY_RELAY_SETTING, RELAY);
    await setSetting(OPENART_TOKEN_SETTING, { access: 'old', refresh: 'r1', expiresAt: Date.now() + 1000 });
    const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) => json({ access_token: 'new', expires_in: 3600 }));
    expect(await accessToken(fetchImpl as never)).toBe('new');
    expect(await getSetting(OPENART_TOKEN_SETTING)).toMatchObject({ access: 'new', refresh: 'r1' });
  });
});

describe('OpenArt MCP client', () => {
  afterEach(async () => { await deleteSetting(COMFY_RELAY_SETTING); await deleteSetting(OPENART_TOKEN_SETTING); });
  it('initializes a session and lists tools from an event stream', async () => {
    await setSetting(COMFY_RELAY_SETTING, RELAY);
    await setSetting(OPENART_TOKEN_SETTING, { access: 't' });
    const sse = (body: unknown) => new Response(`event: message\ndata: ${JSON.stringify(body)}\n\n`, { headers: { 'Content-Type': 'text/event-stream', 'Mcp-Session-Id': 's1' } });
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      const msg = JSON.parse(init.body as string);
      if (msg.method === 'initialize') return sse({ jsonrpc: '2.0', id: msg.id, result: {} });
      if (msg.method === 'tools/list') return sse({ jsonrpc: '2.0', id: msg.id, result: { tools: [{ name: 'generate_video' }] } });
      return new Response(null, { status: 202 });
    });
    expect(await new OpenArtMcp(fetchImpl as never).listTools()).toEqual([{ name: 'generate_video' }]);
    expect(fetchImpl.mock.calls.map(([u]) => u)).toEqual([`${RELAY}/openart/mcp`, `${RELAY}/openart/mcp`, `${RELAY}/openart/mcp`]);
    expect((fetchImpl.mock.calls[2][1].headers as Record<string, string>)['Mcp-Session-Id']).toBe('s1');
    expect((fetchImpl.mock.calls[2][1].headers as Record<string, string>).Authorization).toBe('Bearer t');
  });
});

it('calls the global fetch without binding it to the client', async () => {
  const { OpenArtMcp } = await import('../src/openart/mcp');
  const { OPENART_TOKEN_SETTING } = await import('../src/openart/auth');
  const { COMFY_RELAY_SETTING } = await import('../src/comfy/client');
  const { setSetting } = await import('../src/storage/db');
  await setSetting(COMFY_RELAY_SETTING, 'https://relay.example');
  await setSetting(OPENART_TOKEN_SETTING, { access: 't' });
  const strict = vi.fn(function (this: unknown) {
    if (this !== undefined && this !== globalThis) throw new TypeError("Failed to execute 'fetch' on 'Window': Illegal invocation");
    return Promise.resolve(new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { tools: [] } }), { headers: { 'Content-Type': 'application/json' } }));
  });
  vi.stubGlobal('fetch', strict);
  await expect(new OpenArtMcp().listTools()).resolves.toEqual([]);
  vi.unstubAllGlobals();
});

it('runs a read-only OpenArt tool from Settings and shows the result', async () => {
  const { act } = await import('react');
  const { createRoot } = await import('react-dom/client');
  const { OpenArtSettings } = await import('../src/openart/OpenArtSettings');
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  await setSetting(COMFY_RELAY_SETTING, 'https://relay.example');
  await setSetting(OPENART_TOKEN_SETTING, { access: 't' });
  const calls: { method: string; params?: { name?: string } }[] = [];
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(init.body as string) as { id?: number; method: string; params?: { name?: string } };
    calls.push(body);
    const result = body.method === 'tools/list'
      ? { tools: [{ name: 'openart_model_list', annotations: { readOnlyHint: true } }, { name: 'openart_generate_video', annotations: { readOnlyHint: false } }] }
      : body.method === 'tools/call' ? { structuredContent: { models: [{ id: 'seedance' }] } } : {};
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result }), { headers: { 'Content-Type': 'application/json' } });
  }));
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(<OpenArtSettings />));
  await vi.waitFor(() => expect(host.textContent).toContain('Show tools'));
  await act(async () => [...host.querySelectorAll('button')].find((b) => b.textContent === 'Show tools')!.click());
  await vi.waitFor(() => expect(host.textContent).toContain('2 OpenArt tools'));
  // Only the read-only tool gets a Run button.
  expect([...host.querySelectorAll('button')].filter((b) => b.textContent === 'Run')).toHaveLength(1);
  await act(async () => [...host.querySelectorAll('button')].find((b) => b.textContent === 'Run')!.click());
  await vi.waitFor(() => expect(host.textContent).toContain('"seedance"'));
  expect(calls.at(-1)).toMatchObject({ method: 'tools/call', params: { name: 'openart_model_list' } });
  await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals();
});
