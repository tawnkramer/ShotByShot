import { afterEach, describe, expect, it, vi } from 'vitest';
import relay from '../relay/src/index';
import { COMFY_RELAY_SETTING, normalizeRelayUrl, routeUrl, testComfyKey } from '../src/comfy/client';
import { deleteSetting, setSetting } from '../src/storage/db';

const APP = 'https://tawnkramer.github.io';
const env = { ALLOWED_ORIGINS: `${APP},http://localhost:5173` };
const RELAY = 'https://shotbyshot-comfy-relay.me.workers.dev';

describe('Comfy relay worker', () => {
  it('answers preflights for the app and refuses other sites', async () => {
    const pre = await relay.fetch(new Request(`${RELAY}/api/v2/jobs`, { method: 'OPTIONS', headers: { Origin: APP } }), env);
    expect(pre.status).toBe(204);
    expect(pre.headers.get('Access-Control-Allow-Origin')).toBe(APP);
    expect(pre.headers.get('Access-Control-Allow-Headers')).toMatch(/authorization/);
    const other = await relay.fetch(new Request(`${RELAY}/api/v2/jobs`, { headers: { Origin: 'https://evil.example' } }), env);
    expect(other.status).toBe(403);
  });

  it('forwards API calls to Comfy with the key and adds CORS headers', async () => {
    const fetchImpl = vi.fn(async (_url: string, _init: RequestInit) => new Response('{"id":"j"}', { status: 201, headers: { 'Content-Type': 'application/json', 'Set-Cookie': 'x=1' } }));
    const res = await relay.fetch(new Request(`${RELAY}/api/v2/jobs?x=1`, { method: 'POST', body: '{}', headers: { Origin: APP, Authorization: 'Bearer k', Cookie: 'c=1', 'Content-Type': 'application/json' } }), env, undefined, fetchImpl as never);
    expect(res.status).toBe(201);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(APP);
    expect(res.headers.get('Set-Cookie')).toBeNull();
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://cloud.comfy.org/api/v2/jobs?x=1');
    const headers = init.headers as Headers;
    expect(headers.get('authorization')).toBe('Bearer k');
    expect(headers.get('cookie')).toBeNull();
    expect(headers.get('origin')).toBeNull();
  });

  it('fetches only signed storage URLs, without the key', async () => {
    const fetchImpl = vi.fn(async (_url: string, _init: RequestInit) => new Response('png'));
    const signed = 'https://storage.googleapis.com/comfy-cloud-assets/a.png?sig=1';
    const res = await relay.fetch(new Request(`${RELAY}/storage?url=${encodeURIComponent(signed)}`, { headers: { Origin: APP, Authorization: 'Bearer k' } }), env, undefined, fetchImpl as never);
    expect(await res.text()).toBe('png');
    expect(fetchImpl.mock.calls[0][0]).toBe(signed);
    expect((fetchImpl.mock.calls[0][1].headers as Headers).get('authorization')).toBeNull();
    const bad = await relay.fetch(new Request(`${RELAY}/storage?url=${encodeURIComponent('https://evil.example/x')}`, { headers: { Origin: APP } }), env, undefined, fetchImpl as never);
    expect(bad.status).toBe(400);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe('Comfy client with a relay', () => {
  afterEach(() => deleteSetting(COMFY_RELAY_SETTING));

  it('cleans up pasted relay addresses', () => {
    expect(normalizeRelayUrl(' shotbyshot-comfy-relay.me.workers.dev/ ')).toBe(RELAY);
    expect(() => normalizeRelayUrl('http://example.com')).toThrow(/https/);
    expect(normalizeRelayUrl('http://localhost:8787')).toBe('http://localhost:8787');
  });

  it('routes Comfy and storage URLs through the relay', () => {
    expect(routeUrl('https://cloud.comfy.org/api/v2/jobs/1', RELAY)).toBe(`${RELAY}/api/v2/jobs/1`);
    expect(routeUrl('/api/v2/jobs/1?a=b', RELAY)).toBe(`${RELAY}/api/v2/jobs/1?a=b`);
    expect(routeUrl('https://storage.googleapis.com/b/a.png?s=1', RELAY)).toBe(`${RELAY}/storage?url=${encodeURIComponent('https://storage.googleapis.com/b/a.png?s=1')}`);
    expect(routeUrl('https://cloud.comfy.org/api/v2/jobs/1')).toBe('https://cloud.comfy.org/api/v2/jobs/1');
  });

  it('sends requests to the saved relay and points to setup when there is none', async () => {
    await setSetting(COMFY_RELAY_SETTING, RELAY);
    const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) => new Response('', { status: 404 }));
    expect((await testComfyKey('k', fetchImpl as never)).ok).toBe(true);
    expect(fetchImpl.mock.calls[0][0]).toMatch(new RegExp(`^${RELAY}/api/v2/jobs/`));
    await deleteSetting(COMFY_RELAY_SETTING);
    expect((await testComfyKey('k', async () => { throw new TypeError('cors'); })).message).toMatch(/relay/);
  });
});
