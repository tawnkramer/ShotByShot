import { downloadOutput, runSeconds, submitJob, uploadAsset, waitForJob, type ComfyJob } from './client';
import type { ComfyWorkflow } from './settings';
import { analyzeWorkflow, bindWorkflow, groupKey, randomSeed, slotKey, type AssetReference, type MediaKind, type MediaSlot, type ReferenceGroup } from './workflow';

/** One file to send, placed in a fixed input or appended to a reference group. */
export interface RunInput { slot?: MediaSlot; group?: ReferenceGroup; data: Blob; fileName: string; label: string }

export interface RunOptions {
  key: string;
  workflow: ComfyWorkflow;
  inputs: RunInput[];
  prompt?: string;
  durationSec?: number;
  aspect?: number;
  /** The output kind to return. */
  output: MediaKind;
  signal?: AbortSignal;
  onStatus?: (text: string) => void;
}

/** Uploads inputs, fills and submits the workflow, waits, and downloads its first output of the wanted kind. */
export async function runWorkflow({ key, workflow, inputs, prompt, durationSec, aspect, output, signal, onStatus }: RunOptions): Promise<{ blob: Blob; job: ComfyJob; seconds?: number }> {
  const analysis = analyzeWorkflow(workflow.graph);
  const media = new Map<string, AssetReference>();
  // Every group is rebound, so references left in the export (including empty loaders) never reach the job.
  const references = new Map<string, AssetReference[]>(analysis.groups.map((g) => [groupKey(g), []]));
  for (const input of inputs) {
    onStatus?.(`Uploading ${input.label}…`);
    const ref = await uploadAsset(key, input.data, input.fileName, signal);
    if (input.slot) media.set(slotKey(input.slot), ref);
    else if (input.group) references.get(groupKey(input.group))?.push(ref);
  }
  const graph = bindWorkflow(workflow.graph, analysis, { media, references, prompt, promptTarget: workflow.promptTarget, durationSec, seed: randomSeed(), aspect });
  onStatus?.('Submitting…');
  const job = await submitJob(key, graph, signal);
  const done = await waitForJob(key, job, { signal, onUpdate: (j) => onStatus?.(describeJob(j)) });
  const found = done.outputs.find((o) => o.type === output) ?? done.outputs.find((o) => o.content_type.startsWith(`${output}/`));
  if (!found) throw new Error(`The workflow finished without ${output === 'audio' ? 'an audio' : `a ${output}`} output. Check that it ends in a Save ${output === 'image' ? 'Image' : output === 'video' ? 'Video' : 'Audio'} node.`);
  onStatus?.(`Downloading ${output}…`);
  const blob = await downloadOutput(key, found.id, signal);
  return { blob: blob.type ? blob : new Blob([blob], { type: found.content_type }), job: done, seconds: runSeconds(done) };
}

export function describeJob(job: ComfyJob): string {
  if (job.status === 'queued') return job.queue_position != null ? `Queued (position ${job.queue_position})…` : 'Queued…';
  if (job.status === 'canceling') return 'Canceling…';
  const pct = job.progress ? ` ${Math.round(job.progress.value * 100)}%` : '';
  return `Generating${pct}${job.progress?.message ? ` · ${job.progress.message}` : ''}… Keep this page open.`;
}

/** Puts images into a workflow's fixed image inputs in order, then into its image reference list. */
export function placeImages(workflow: ComfyWorkflow, images: Omit<RunInput, 'slot' | 'group'>[]): RunInput[] {
  const analysis = analyzeWorkflow(workflow.graph);
  const slots = analysis.slots.filter((s) => s.kind === 'image');
  const others = analysis.slots.filter((s) => s.kind !== 'image');
  if (others.length) throw new Error(`${workflow.name} also needs ${others.map((s) => s.kind).join(' and ')} input, which image generation can't provide.`);
  if (images.length < slots.length) throw new Error(`${workflow.name} needs ${slots.length} input image${slots.length === 1 ? '' : 's'}, but only ${images.length} ${images.length === 1 ? 'is' : 'are'} available here.`);
  const group = analysis.groups.find((g) => g.kind === 'image');
  return [
    ...slots.map((slot, i) => ({ ...images[i], slot })),
    ...(group ? images.slice(slots.length, slots.length + group.max).map((image) => ({ ...image, group })) : []),
  ];
}

/** Comfy may save JPEG or WebP; the app stores and re-sends artwork as PNG. */
export async function asPng(blob: Blob): Promise<Blob> {
  if (blob.type === 'image/png' || typeof createImageBitmap !== 'function') return blob;
  try {
    const bitmap = await createImageBitmap(blob);
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width; canvas.height = bitmap.height;
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0);
    return await new Promise((resolve, reject) => canvas.toBlob((b) => b ? resolve(b) : reject(new Error('encode')), 'image/png'));
  } catch {
    return blob;
  }
}
