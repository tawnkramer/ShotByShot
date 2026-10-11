import { afterEach, expect, it, vi } from 'vitest';
import relay from '../relay/src/index';
import { COMFY_RELAY_SETTING } from '../src/comfy/client';
import { OPENART_TOKEN_SETTING } from '../src/openart/auth';
import { openArtAspect, openArtDuration, runOpenArtVideo } from '../src/openart/video';
import { setSetting } from '../src/storage/db';

const APP = 'https://tawnkramer.github.io';
const RELAY = 'https://relay.example';
afterEach(() => vi.restoreAllMocks());

it('fits Seedance on OpenArt to whole seconds and its aspect choices', () => {
  expect(openArtDuration(2.2)).toBe(4);
  expect(openArtDuration(6.3)).toBe(7);
  expect(openArtDuration(40)).toBe(30);
  expect(openArtAspect(16 / 9)).toBe('16:9');
  expect(openArtAspect(2.39)).toBe('21:9');
});

it('uploads references, generates with element2video, polls and downloads the video', async () => {
  await setSetting(COMFY_RELAY_SETTING, RELAY);
  await setSetting(OPENART_TOKEN_SETTING, { access: 't' });
  const toolCalls: { name: string; arguments: Record<string, unknown> }[] = [];
  const media: { method: string; url: string; auth: string | null }[] = [];
  let polls = 0;
  const reply = (id: unknown, structuredContent: unknown) => new Response(JSON.stringify({ jsonrpc: '2.0', id, result: { structuredContent } }), { headers: { 'Content-Type': 'application/json' } });
  const fetchImpl = vi.fn(async (url: string, init: RequestInit = {}) => {
    if (url.startsWith(`${RELAY}/openart/media`)) {
      const target = new URL(url).searchParams.get('url')!;
      media.push({ method: init.method ?? 'GET', url: target, auth: new Headers(init.headers).get('Authorization') });
      return target.includes('result') ? new Response('mp4', { headers: { 'Content-Type': 'video/mp4' } }) : new Response(null, { status: 200 });
    }
    const body = JSON.parse(init.body as string) as { id?: number; method: string; params: { name: string; arguments: Record<string, unknown> } };
    if (body.method !== 'tools/call') return reply(body.id, {});
    const { name, arguments: args } = body.params;
    toolCalls.push({ name, arguments: args });
    if (name === 'openart_upload_sign') return reply(body.id, { uploadId: `u-${args.label}`, signURL: `https://bucket.s3.amazonaws.com/${args.filename}?sig=1`, accessURL: `https://cdn.openart.ai/${args.filename}` });
    if (name === 'openart_upload_metadata_get') return reply(body.id, { visualReference: { type: args.mediaType, id: args.uploadId, url: args.mediaUrl, label: 'x' } });
    if (name === 'openart_generate_video') return reply(body.id, { status: 'PENDING', historyId: 'h1', pollAfterSeconds: 5 });
    if (name === 'openart_creation_get') return reply(body.id, ++polls < 2 ? { status: 'RUNNING', historyId: 'h1' } : { status: 'COMPLETED', historyId: 'h1', creditsCharged: 300, resources: [{ id: 'r', url: 'https://cdn.openart.ai/result.mp4', mediaType: 'video' }] });
    throw new Error(`unexpected ${name}`);
  });
  const sleep = vi.fn(async () => {});
  const result = await runOpenArtVideo({
    model: 'byte-plus-seedance-2-5', prompt: 'Image 1 is Ben.', durationSec: 5.5, aspect: 16 / 9, resolution: '720p', generateAudio: true,
    inputs: [{ kind: 'image', label: 'Image 1', fileName: 'shot-1.png', data: new Blob(['png'], { type: 'image/png' }) }, { kind: 'video', label: 'Video 1', fileName: 'previs-2.mp4', data: new Blob(['mp4'], { type: 'video/mp4' }) }],
    fetchImpl: fetchImpl as never, sleep,
  });
  expect(await result.blob.text()).toBe('mp4');
  expect(result.credits).toBe(300);
  expect(media.map((m) => m.method)).toEqual(['PUT', 'PUT', 'GET']);
  expect(media.every((m) => m.auth === null)).toBe(true);
  const generate = toolCalls.find((c) => c.name === 'openart_generate_video')!.arguments;
  expect(generate).toMatchObject({ model: 'byte-plus-seedance-2-5', mode: 'element2video', params: { duration: 6, aspectRatio: '16:9', resolution: '720p', generateAudio: true, prompt: 'Image 1 is Ben.' } });
  expect((generate.params as { visualReferences: { label: string; type: string }[] }).visualReferences).toEqual([
    { type: 'image', id: 'u-Image 1', url: 'https://cdn.openart.ai/shot-1.png', label: 'Image 1' },
    { type: 'video', id: 'u-Video 1', url: 'https://cdn.openart.ai/previs-2.mp4', label: 'Video 1' },
  ]);
  expect(sleep).toHaveBeenCalledTimes(2);
});

it('reports a failed generation with OpenArt’s reason', async () => {
  await setSetting(COMFY_RELAY_SETTING, RELAY);
  await setSetting(OPENART_TOKEN_SETTING, { access: 't' });
  const fetchImpl = vi.fn(async (_url: string, init: RequestInit = {}) => {
    const body = JSON.parse(init.body as string) as { id?: number; method: string; params: { name: string } };
    const result = body.method !== 'tools/call' ? {} : body.params.name === 'openart_generate_video'
      ? { structuredContent: { status: 'FAILED', historyId: 'h', error: 'content policy' } }
      : { isError: true, content: [{ type: 'text', text: 'nope' }] };
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result }), { headers: { 'Content-Type': 'application/json' } });
  });
  await expect(runOpenArtVideo({ model: 'm', prompt: 'p', durationSec: 5, resolution: '480p', generateAudio: false, inputs: [], fetchImpl: fetchImpl as never, sleep: async () => {} }))
    .rejects.toThrow("OpenArt couldn't generate the video: content policy.");
});

it('relays OpenArt media only to media hosts and never forwards the token', async () => {
  const env = { ALLOWED_ORIGINS: APP };
  const seen: { url: string; auth: string | null; method?: string }[] = [];
  const fetchImpl = vi.fn(async (url: string, init: RequestInit) => { seen.push({ url, auth: new Headers(init.headers).get('authorization'), method: init.method }); return new Response('ok'); });
  const put = await relay.fetch(new Request(`${RELAY}/openart/media?url=${encodeURIComponent('https://bucket.s3.amazonaws.com/a.png?sig=1')}`, { method: 'PUT', body: 'png', headers: { Origin: APP, Authorization: 'Bearer t', 'Content-Type': 'image/png' } }), env, undefined, fetchImpl as never);
  expect(put.status).toBe(200);
  expect(seen[0]).toEqual({ url: 'https://bucket.s3.amazonaws.com/a.png?sig=1', auth: null, method: 'PUT' });
  const other = await relay.fetch(new Request(`${RELAY}/openart/media?url=${encodeURIComponent('https://evil.example/x')}`, { headers: { Origin: APP } }), env, undefined, fetchImpl as never);
  expect(other.status).toBe(400);
  expect(await other.text()).toContain('evil.example');
  expect(seen).toHaveLength(1);
});
