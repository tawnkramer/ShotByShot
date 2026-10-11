import { newId } from '../state/schema';
import { getSetting } from '../storage/db';
import type { AssetReference, WorkflowGraph } from './workflow';

/**
 * Minimal Comfy API v2 client for the browser. The key is the user's own and
 * is only sent to cloud.comfy.org, or to the user's own relay in front of it.
 * Signed output URLs are fetched without it.
 *
 * Comfy Cloud's REST API sends no CORS headers, so a browser needs a relay
 * (relay/, a Cloudflare Worker) that forwards requests and adds them.
 */
export const COMFY_BASE = 'https://cloud.comfy.org';
export const COMFY_KEY_SETTING = 'comfy.apiKey';
export const COMFY_RELAY_SETTING = 'comfy.relayUrl';

/** Cleans up a pasted relay address; throws when it isn't a usable https URL. */
export function normalizeRelayUrl(input: string): string {
  const text = input.trim();
  let url: URL;
  try { url = new URL(/^[a-z]+:\/\//i.test(text) ? text : `https://${text}`); } catch { throw new Error('That relay address is not a valid URL.'); }
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) throw new Error('The relay address must start with https://.');
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
}

async function relayUrl(): Promise<string | undefined> {
  return (await getSetting<string>(COMFY_RELAY_SETTING).catch(() => undefined)) || undefined;
}

/** Where to send a request for a Comfy Cloud or signed storage URL, given the relay in use. */
export function routeUrl(url: string, relay?: string): string {
  if (!relay) return url;
  const target = new URL(url, COMFY_BASE);
  return target.origin === COMFY_BASE ? `${relay}${target.pathname}${target.search}` : `${relay}/storage?url=${encodeURIComponent(target.toString())}`;
}

export type JobStatus = 'queued' | 'running' | 'succeeded' | 'canceling' | 'canceled' | 'failed' | 'expired';
export interface ComfyJob {
  id: string;
  status: JobStatus;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  queue_position: number | null;
  progress: { value: number; message?: string | null; current_node_class?: string | null } | null;
  outputs: { node_id: string; name: string; type: string; content_type: string; id: string }[];
  error: { code: string; message: string; node_id?: string | null; class_type?: string | null } | null;
  metrics?: Record<string, number | null>;
  urls: { self: string; cancel: string };
}
interface ComfyAsset { id: string; hash: string | null; file_path?: string | null; url: string }

const auth = (key: string) => ({ Authorization: `Bearer ${key}` });
const UNREACHABLE = "Couldn't reach Comfy Cloud. Check your connection and your relay address in Settings → ComfyUI Cloud.";
const NO_RELAY = "Couldn't reach Comfy Cloud. Browsers need a relay to reach it: set one up in Settings → ComfyUI Cloud.";

async function call(key: string, path: string, init: RequestInit, fetchImpl: typeof fetch): Promise<Response> {
  if (!key.trim()) throw new Error('Add your Comfy Cloud API key in Settings first.');
  const url = new URL(path, COMFY_BASE);
  // Never send the key to a host other than Comfy's, even if a response links elsewhere.
  if (url.origin !== COMFY_BASE) throw new Error('Comfy Cloud returned an unexpected link.');
  const relay = await relayUrl();
  let res: Response;
  try {
    res = await fetchImpl(routeUrl(url.toString(), relay), { ...init, headers: { ...auth(key), ...init.headers } });
  } catch (e) {
    if (init.signal?.aborted) throw e;
    throw new Error(relay ? UNREACHABLE : NO_RELAY);
  }
  if (!res.ok) throw new Error(await errorMessage(res));
  return res;
}

async function errorMessage(res: Response): Promise<string> {
  const body = await res.json().catch(() => null) as { error?: { code?: string; message?: string; details?: unknown } } | null;
  const { code, message, details } = body?.error ?? {};
  if (res.status === 401) return 'Comfy Cloud rejected the API key. Update it in Settings.';
  if (res.status === 402 || code === 'insufficient_credits') return 'Your Comfy Cloud account is out of credits.';
  if (res.status === 429) return 'Comfy Cloud is busy or your subscription is inactive. Try again later.';
  if (code === 'invalid_workflow' && details) return `Comfy Cloud rejected the workflow: ${message ?? ''} ${nodeErrors(details)}`.trim();
  return message || `Comfy Cloud returned an error (${res.status}).`;
}

function nodeErrors(details: unknown): string {
  const text = JSON.stringify(details);
  return text.length > 400 ? `${text.slice(0, 400)}…` : text;
}

export interface KeyCheck { ok: boolean; reachable: boolean; message: string }

/** A lookup of a job that can't exist: 404 means the key was accepted. */
export async function testComfyKey(key: string, fetchImpl: typeof fetch = fetch): Promise<KeyCheck> {
  const relay = await relayUrl();
  let res: Response;
  try {
    res = await fetchImpl(routeUrl(`${COMFY_BASE}/api/v2/jobs/00000000-0000-4000-8000-000000000000`, relay), { headers: auth(key) });
  } catch {
    return { ok: false, reachable: false, message: relay ? UNREACHABLE : NO_RELAY };
  }
  if (res.status === 401 || res.status === 403) return { ok: false, reachable: true, message: 'Comfy Cloud rejected this key.' };
  if (res.status === 404 || res.ok) return { ok: true, reachable: true, message: 'Key works.' };
  return { ok: false, reachable: true, message: await errorMessage(res) };
}

export async function uploadAsset(key: string, data: Blob, fileName: string, signal?: AbortSignal, fetchImpl: typeof fetch = fetch): Promise<AssetReference> {
  const form = new FormData();
  // Comfy reads the form as a stream and rejects a file that arrives before its content_type.
  form.append('content_type', data.type || 'application/octet-stream');
  form.append('file_path', fileName);
  form.append('tags', JSON.stringify(['input']));
  form.append('file', data, fileName);
  const res = await call(key, '/api/v2/assets', { method: 'POST', body: form, signal, headers: { 'Idempotency-Key': newId() } }, fetchImpl);
  const asset = await res.json() as ComfyAsset;
  return { __type: 'core/ASSET', info: { id: asset.id, ...(asset.hash ? { hash: asset.hash } : {}), file_path: asset.file_path ?? fileName } };
}

export async function submitJob(key: string, workflow: WorkflowGraph, signal?: AbortSignal, fetchImpl: typeof fetch = fetch): Promise<ComfyJob> {
  const res = await call(key, '/api/v2/jobs', {
    method: 'POST', signal,
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': newId() },
    // Partner nodes (hosted video models and the like) bill through the same key.
    body: JSON.stringify({ workflow, extra_data: { api_key_comfy_org: key } }),
  }, fetchImpl);
  return res.json() as Promise<ComfyJob>;
}

export async function getJob(key: string, job: Pick<ComfyJob, 'id' | 'urls'>, signal?: AbortSignal, fetchImpl: typeof fetch = fetch): Promise<ComfyJob> {
  return (await call(key, job.urls?.self ?? `/api/v2/jobs/${job.id}`, { signal }, fetchImpl)).json() as Promise<ComfyJob>;
}

export async function cancelJob(key: string, job: Pick<ComfyJob, 'id' | 'urls'>, fetchImpl: typeof fetch = fetch): Promise<void> {
  await call(key, job.urls?.cancel ?? `/api/v2/jobs/${job.id}/cancel`, { method: 'POST' }, fetchImpl);
}

const TERMINAL: JobStatus[] = ['succeeded', 'canceled', 'failed', 'expired'];

/** Polls until the job finishes. Aborting the signal cancels the job on Comfy Cloud so it stops billing. */
export async function waitForJob(key: string, job: ComfyJob, { signal, onUpdate, intervalMs = 3000 }: { signal?: AbortSignal; onUpdate?: (job: ComfyJob) => void; intervalMs?: number } = {}, fetchImpl: typeof fetch = fetch): Promise<ComfyJob> {
  const onAbort = () => void cancelJob(key, job, fetchImpl).catch(() => {});
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    let current = job;
    while (!TERMINAL.includes(current.status)) {
      await sleep(intervalMs, signal);
      current = await getJob(key, current, signal, fetchImpl);
      onUpdate?.(current);
    }
    if (current.status === 'failed') throw new Error(`Comfy Cloud couldn't finish: ${current.error?.message ?? 'the workflow failed'}${current.error?.class_type ? ` (${current.error.class_type})` : ''}.`);
    if (current.status === 'canceled') throw new Error('The job was canceled on Comfy Cloud.');
    if (current.status === 'expired') throw new Error('The job expired on Comfy Cloud before it finished.');
    return current;
  } finally {
    signal?.removeEventListener('abort', onAbort);
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason); }, { once: true });
  });
}

/** Downloads an output by asking for its signed URL, so the key is never sent to the storage host. */
export async function downloadOutput(key: string, assetId: string, signal?: AbortSignal, fetchImpl: typeof fetch = fetch): Promise<Blob> {
  const asset = await (await call(key, `/api/v2/assets/${assetId}`, { signal }, fetchImpl)).json() as ComfyAsset;
  let res: Response;
  try {
    res = await fetchImpl(routeUrl(asset.url, await relayUrl()), { signal });
  } catch (e) {
    if (signal?.aborted) throw e;
    throw new Error(`Comfy Cloud finished, but the browser couldn't download the result from ${hostOf(asset.url)}. Try again.`);
  }
  if (!res.ok) throw new Error(`Couldn't download the result (${res.status}).`);
  return res.blob();
}

function hostOf(url: string): string {
  try { return new URL(url, COMFY_BASE).host; } catch { return 'its storage'; }
}

/** Seconds the job spent running, when Comfy reports start and finish times. */
export function runSeconds(job: ComfyJob): number | undefined {
  if (!job.started_at || !job.completed_at) return undefined;
  const ms = Date.parse(job.completed_at) - Date.parse(job.started_at);
  return Number.isFinite(ms) && ms >= 0 ? ms / 1000 : undefined;
}
