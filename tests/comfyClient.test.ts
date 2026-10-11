import { describe, expect, it, vi } from 'vitest';
import { downloadOutput, submitJob, testComfyKey, uploadAsset, waitForJob, type ComfyJob } from '../src/comfy/client';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const job = (status: ComfyJob['status'], extra: Partial<ComfyJob> = {}): ComfyJob => ({
  id: 'job-1', status, created_at: '', started_at: '2026-10-11T00:00:00Z', completed_at: null, queue_position: null, progress: null, outputs: [], error: null,
  urls: { self: '/api/v2/jobs/job-1', cancel: '/api/v2/jobs/job-1/cancel' }, ...extra,
});

describe('Comfy Cloud client', () => {
  it('checks a key with a lookup that can only 404', async () => {
    const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) => new Response('', { status: 404 }));
    expect((await testComfyKey('k', fetchImpl as never)).ok).toBe(true);
    expect(fetchImpl.mock.calls[0][1]).toMatchObject({ headers: { Authorization: 'Bearer k' } });
    expect(await testComfyKey('k', async () => new Response('', { status: 401 }))).toMatchObject({ ok: false, reachable: true });
    expect(await testComfyKey('k', async () => { throw new TypeError('cors'); })).toMatchObject({ ok: false, reachable: false });
  });

  it('uploads inputs as assets and returns a workflow reference', async () => {
    const fetchImpl = vi.fn(async (_url: string, _init: RequestInit) => json({ id: 'a1', hash: 'blake3:ab', file_path: 'shot.png', url: 'x' }, 201));
    const ref = await uploadAsset('k', new Blob(['png'], { type: 'image/png' }), 'shot.png', undefined, fetchImpl as never);
    expect(ref).toEqual({ __type: 'core/ASSET', info: { id: 'a1', hash: 'blake3:ab', file_path: 'shot.png' } });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://cloud.comfy.org/api/v2/assets');
    const form = init.body as FormData;
    expect(form.get('content_type')).toBe('image/png');
    expect(form.get('file_path')).toBe('shot.png');
    // Comfy rejects a file sent before its content_type, and tags that aren't a JSON array.
    expect([...form.keys()]).toEqual(['content_type', 'file_path', 'tags', 'file']);
    expect(form.get('tags')).toBe('["input"]');
  });

  it('submits workflows and explains rejected ones', async () => {
    const fetchImpl = vi.fn(async (_url: string, _init: RequestInit) => json(job('queued'), 201));
    await submitJob('k', { 1: { class_type: 'X', inputs: {} } }, undefined, fetchImpl as never);
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body as string);
    expect(body).toEqual({ workflow: { 1: { class_type: 'X', inputs: {} } }, extra_data: { api_key_comfy_org: 'k' } });
    await expect(submitJob('k', {}, undefined, async () => json({ error: { code: 'insufficient_credits', message: 'x' } }, 402))).rejects.toThrow(/out of credits/);
    await expect(submitJob('k', {}, undefined, async () => json({ error: { code: 'invalid_workflow', message: 'Bad graph', details: { 114: 'missing' } } }, 422))).rejects.toThrow(/Bad graph.*114/);
  });

  it('polls until the job finishes and reports failures', async () => {
    const updates: string[] = [];
    const fetchImpl = vi.fn().mockResolvedValueOnce(json(job('running'))).mockResolvedValueOnce(json(job('succeeded', { completed_at: '2026-10-11T00:01:00Z' })));
    const done = await waitForJob('k', job('queued'), { intervalMs: 1, onUpdate: (j) => updates.push(j.status) }, fetchImpl);
    expect(done.status).toBe('succeeded');
    expect(updates).toEqual(['running', 'succeeded']);
    expect(fetchImpl.mock.calls[0][0]).toBe('https://cloud.comfy.org/api/v2/jobs/job-1');
    const failed = vi.fn(async () => json(job('failed', { error: { code: 'oom', message: 'Out of GPU memory', class_type: 'SamplerCustomAdvanced' } })));
    await expect(waitForJob('k', job('queued'), { intervalMs: 1 }, failed)).rejects.toThrow('Out of GPU memory (SamplerCustomAdvanced)');
  });

  it('cancels the job on Comfy Cloud when the user aborts', async () => {
    const abort = new AbortController();
    const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) => json(job('running')));
    const waiting = waitForJob('k', job('running'), { signal: abort.signal, intervalMs: 50 }, fetchImpl as never);
    abort.abort();
    await expect(waiting).rejects.toBeDefined();
    // The cancel is sent in the background once the relay setting is read.
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledWith('https://cloud.comfy.org/api/v2/jobs/job-1/cancel', expect.objectContaining({ method: 'POST' })));
  });

  it('never sends the key to other hosts', async () => {
    const fetchImpl = vi.fn(async () => json(job('running')));
    await expect(waitForJob('k', job('running', { urls: { self: 'https://evil.example/jobs/1', cancel: '' } }), { intervalMs: 1 }, fetchImpl)).rejects.toThrow(/unexpected link/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('downloads outputs from the signed URL without the key', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(json({ id: 'out', hash: null, url: 'https://storage.example/signed?sig=1' }))
      .mockResolvedValueOnce(new Response('mp4', { headers: { 'Content-Type': 'video/mp4' } }));
    const blob = await downloadOutput('k', 'out', undefined, fetchImpl);
    expect(await blob.text()).toBe('mp4');
    expect(fetchImpl.mock.calls[0][0]).toBe('https://cloud.comfy.org/api/v2/assets/out');
    expect(fetchImpl.mock.calls[1]).toEqual(['https://storage.example/signed?sig=1', { signal: undefined }]);
  });
});
