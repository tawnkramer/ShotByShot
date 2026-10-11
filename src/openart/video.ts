import { relayUrl } from '../comfy/client';
import { closestRatio, type MediaKind } from '../comfy/workflow';
import { OpenArtMcp } from './mcp';

/**
 * Seedance through OpenArt's MCP server, paid with the user's OpenArt credits.
 * References are uploaded to presigned URLs, the job is submitted with
 * openart_generate_video (element2video) and polled with openart_creation_get.
 * Presigned uploads and results go through the relay's /openart/media route.
 */
export interface OpenArtVideoModel { id: string; name: string }
export const OPENART_VIDEO_MODELS: OpenArtVideoModel[] = [
  { id: 'byte-plus-seedance-2-5', name: 'Seedance 2.5' },
  { id: 'byte-plus-seedance-2-fast', name: 'Seedance 2.0 Fast' },
  { id: 'byte-plus-seedance-2-mini', name: 'Seedance 2.0 Mini' },
];
export const OPENART_MODE = 'element2video';
/** Seedance's reference limits and duration range on OpenArt. */
export const OPENART_LIMITS: Record<MediaKind, number> = { image: 9, video: 3, audio: 3 };
export const OPENART_DURATION = { min: 4, max: 30 };
export const OPENART_RESOLUTIONS = ['480p', '720p', '1080p'] as const;
export type OpenArtResolution = (typeof OPENART_RESOLUTIONS)[number];

export interface OpenArtInput { kind: MediaKind; label: string; fileName: string; data: Blob }
export interface OpenArtVideoRequest {
  model: string;
  inputs: OpenArtInput[];
  prompt: string;
  durationSec: number;
  aspect?: number;
  resolution: OpenArtResolution;
  generateAudio: boolean;
  signal?: AbortSignal;
  onStatus?: (text: string) => void;
  /** For tests. */
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

interface VisualReference { type: string; id: string; url: string; label: string }
interface Creation {
  status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED' | 'STILL_RUNNING';
  historyId: string;
  pollAfterSeconds?: number;
  creditsCharged?: number;
  error?: string;
  errorDisplayCode?: string;
  warning?: string;
  resources?: { url: string; mediaType: string; status?: string; error?: string }[];
}

export function openArtDuration(seconds: number): number {
  return Math.min(OPENART_DURATION.max, Math.max(OPENART_DURATION.min, Math.ceil(seconds - 0.05)));
}

/** Seedance's aspect choices, closest to the project's. */
export function openArtAspect(aspect?: number): string {
  return aspect ? closestRatio(aspect) : '16:9';
}

/** Through the relay: OpenArt's upload and result hosts send no CORS headers for this app. */
async function mediaUrl(url: string): Promise<string> {
  const relay = await relayUrl();
  if (!relay) throw new Error('Set up the relay in Settings → ComfyUI Cloud first. OpenArt is reached through it too.');
  return `${relay}/openart/media?url=${encodeURIComponent(url)}`;
}

async function send(url: string, init: RequestInit, what: string, fetchImpl: typeof fetch): Promise<Response> {
  let res: Response;
  try { res = await fetchImpl(await mediaUrl(url), init); } catch (e) {
    if (init.signal?.aborted) throw e;
    throw new Error(`Couldn't ${what} through the relay (${new URL(url).hostname}). Redeploy the relay if it predates OpenArt video support.`);
  }
  if (!res.ok) throw new Error(`Couldn't ${what}: ${(await res.text().catch(() => '')).trim().slice(0, 200) || `error ${res.status}`}`);
  return res;
}

async function upload(mcp: OpenArtMcp, input: OpenArtInput, fetchImpl: typeof fetch, signal?: AbortSignal): Promise<VisualReference> {
  const contentType = input.data.type || (input.kind === 'image' ? 'image/png' : input.kind === 'audio' ? 'audio/mpeg' : 'video/mp4');
  const signed = await mcp.tool<{ uploadId: string; signURL: string; accessURL: string }>('openart_upload_sign', {
    mediaType: input.kind, filename: input.fileName, size: input.data.size, contentType, label: input.label, purpose: 'create-video',
  });
  await send(signed.signURL, { method: 'PUT', headers: { 'Content-Type': contentType }, body: input.data, signal }, `upload ${input.label} to OpenArt`, fetchImpl);
  const meta = await mcp.tool<{ visualReference?: VisualReference }>('openart_upload_metadata_get', {
    mediaUrl: signed.accessURL, mediaType: input.kind, uploadId: signed.uploadId, label: input.label,
  });
  if (!meta.visualReference) throw new Error(`OpenArt did not accept ${input.label}.`);
  // The prompt names references by these labels.
  return { ...meta.visualReference, label: input.label };
}

/** Uploads the references, generates the video and downloads it. */
export async function runOpenArtVideo(req: OpenArtVideoRequest): Promise<{ blob: Blob; credits?: number; historyId: string }> {
  const fetchImpl = req.fetchImpl ?? ((input, init) => fetch(input, init));
  const sleep = req.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const mcp = new OpenArtMcp(fetchImpl);
  const aborted = () => { if (req.signal?.aborted) throw req.signal.reason ?? new DOMException('Aborted', 'AbortError'); };
  const visualReferences: VisualReference[] = [];
  for (const input of req.inputs) {
    aborted();
    req.onStatus?.(`Uploading ${input.label} to OpenArt…`);
    visualReferences.push(await upload(mcp, input, fetchImpl, req.signal));
  }
  aborted();
  req.onStatus?.('Submitting to OpenArt…');
  let creation = await mcp.tool<Creation>('openart_generate_video', {
    model: req.model, mode: OPENART_MODE,
    params: {
      prompt: req.prompt, duration: openArtDuration(req.durationSec), aspectRatio: openArtAspect(req.aspect),
      resolution: req.resolution, generateAudio: req.generateAudio, videoCount: 1, visualReferences,
    },
  });
  const started = Date.now();
  while (!['COMPLETED', 'FAILED', 'CANCELLED'].includes(creation.status)) {
    req.onStatus?.(`Generating on OpenArt (${Math.round((Date.now() - started) / 1000)} s)… Keep this page open.`);
    await sleep(Math.max(3, creation.pollAfterSeconds ?? 5) * 1000);
    aborted();
    creation = { ...creation, ...await mcp.tool<Creation>('openart_creation_get', { historyId: creation.historyId }) };
  }
  if (creation.status !== 'COMPLETED') throw new Error(creation.status === 'CANCELLED' ? 'OpenArt canceled the generation.' : `OpenArt couldn't generate the video: ${creation.error ?? creation.errorDisplayCode ?? 'unknown error'}.`);
  const video = creation.resources?.find((r) => r.mediaType === 'video' && r.url);
  if (!video) throw new Error(creation.warning ?? 'OpenArt finished without a video.');
  req.onStatus?.('Downloading video…');
  const res = await send(video.url, { signal: req.signal }, 'download the video from OpenArt', fetchImpl);
  const blob = await res.blob();
  return { blob: blob.type.startsWith('video/') ? blob : new Blob([blob], { type: 'video/mp4' }), credits: creation.creditsCharged, historyId: creation.historyId };
}

/** Credits for one job with these settings, or undefined when OpenArt can't price it. */
export async function openArtVideoCost(model: string, durationSec: number, resolution: OpenArtResolution, generateAudio: boolean, aspect?: number): Promise<{ credits: number; balance?: number; affordable?: boolean } | undefined> {
  const quote = await new OpenArtMcp().tool<{ balance?: number; items: { totalCredits: number; affordable?: boolean }[] }>('openart_model_cost', {
    model, mode: OPENART_MODE, params: { duration: openArtDuration(durationSec), resolution, generateAudio, aspectRatio: openArtAspect(aspect) },
  });
  const item = quote.items[0];
  return item ? { credits: item.totalCredits, balance: quote.balance, affordable: item.affordable } : undefined;
}
