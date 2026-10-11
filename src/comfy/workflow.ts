/**
 * Reads an API-format ComfyUI workflow ("Export (API)") to find what the app
 * can fill in: loader nodes for media, the prompt text, duration, seed and
 * output size. Binding returns a new graph; the imported one is never changed.
 */

export const WORKFLOW_CATEGORIES = ['image', 'edit', 'tts', 'video'] as const;
export type WorkflowCategory = (typeof WORKFLOW_CATEGORIES)[number];
export const CATEGORY_LABELS: Record<WorkflowCategory, string> = { image: 'Image generation', edit: 'Image editing', tts: 'Text to speech', video: 'Image to video' };
/** The output each category is expected to produce. */
export const CATEGORY_OUTPUT: Record<WorkflowCategory, MediaKind> = { image: 'image', edit: 'image', tts: 'audio', video: 'video' };

export type MediaKind = 'image' | 'audio' | 'video';
type Link = [string, number];
interface ApiNode { class_type: string; inputs: Record<string, unknown>; _meta?: { title?: string } }
export type WorkflowGraph = Record<string, ApiNode>;

export interface InputRef { nodeId: string; input: string }
export interface MediaSlot extends InputRef { kind: MediaKind; title: string }
export interface PromptTarget extends InputRef { title: string; length: number }
export interface SizeTarget { nodeId: string; pixels: number; multiple: number }

export interface WorkflowAnalysis {
  slots: MediaSlot[];
  prompts: PromptTarget[];
  durations: InputRef[];
  seeds: InputRef[];
  sizes: SizeTarget[];
  outputs: MediaKind[];
}

/** Parses exported JSON, rejecting the UI ("Save") format with a fix the user can follow. */
export function parseWorkflow(text: string): WorkflowGraph {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { throw new Error('This file is not valid JSON.'); }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('This file is not a ComfyUI workflow.');
  const obj = raw as Record<string, unknown>;
  if (Array.isArray(obj.nodes) && 'links' in obj) throw new Error('This is the editor format. In ComfyUI, use Workflow → Export (API) and import that file.');
  const nodes = Object.entries(obj);
  if (!nodes.length || !nodes.every(([, n]) => isNode(n))) throw new Error('This file is not an API-format ComfyUI workflow.');
  return obj as WorkflowGraph;
}

function isNode(n: unknown): n is ApiNode {
  return Boolean(n && typeof n === 'object' && typeof (n as ApiNode).class_type === 'string' && (n as ApiNode).inputs && typeof (n as ApiNode).inputs === 'object');
}

const isLink = (v: unknown): v is Link => Array.isArray(v) && v.length === 2 && typeof v[0] === 'string' && typeof v[1] === 'number';
const title = (graph: WorkflowGraph, id: string) => graph[id]._meta?.title || graph[id].class_type;
/** Natural order, so "9" sorts before "10" and "105:9" before "105:10". */
const byId = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });

const MEDIA_FIELDS = ['image', 'audio', 'video', 'file'];
function loaderKind(classType: string): MediaKind | undefined {
  if (/mask/i.test(classType)) return undefined;
  if (/Load(Image)/i.test(classType)) return 'image';
  if (/Load(Audio)/i.test(classType)) return 'audio';
  if (/Load(Video)/i.test(classType)) return 'video';
}
function outputKind(classType: string): MediaKind | undefined {
  if (/Save(Video|WEBM|AnimatedWEBP|AnimatedPNG)|VideoCombine/i.test(classType)) return 'video';
  if (/(Save|Preview)Audio/i.test(classType)) return 'audio';
  if (/(Save|Preview)Image/i.test(classType)) return 'image';
}

const PROMPT_INPUT = /^(prompt|text|positive|positive_prompt|text_g|caption|lyrics|transcript)$|prompt$/i;

export function analyzeWorkflow(graph: WorkflowGraph): WorkflowAnalysis {
  const ids = Object.keys(graph).sort(byId);
  // Text encoders feeding a sampler's negative input hold the negative prompt.
  const negative = new Set<string>();
  for (const id of ids) for (const [k, v] of Object.entries(graph[id].inputs)) if (/negative/i.test(k) && isLink(v)) negative.add(v[0]);
  const analysis: WorkflowAnalysis = { slots: [], prompts: [], durations: [], seeds: [], sizes: [], outputs: [] };
  for (const id of ids) {
    const node = graph[id];
    const name = title(graph, id);
    const media = loaderKind(node.class_type);
    if (media) {
      const input = MEDIA_FIELDS.find((f) => typeof node.inputs[f] === 'string');
      if (input) analysis.slots.push({ nodeId: id, input, kind: media, title: name });
      continue;
    }
    const out = outputKind(node.class_type);
    if (out && !analysis.outputs.includes(out)) analysis.outputs.push(out);
    for (const [k, v] of Object.entries(node.inputs)) {
      if (typeof v === 'string' && !negative.has(id) && !/negative/i.test(name) && !/negative/i.test(k)
        && (PROMPT_INPUT.test(k) || (k === 'value' && /PrimitiveString/i.test(node.class_type) && /prompt/i.test(name)))) {
        analysis.prompts.push({ nodeId: id, input: k, title: name, length: v.length });
      }
      if (typeof v === 'number' && /^(noise_)?seed$/i.test(k)) analysis.seeds.push({ nodeId: id, input: k });
      if (typeof v === 'number' && (/^(duration|seconds|duration_seconds)$/i.test(k) || (k === 'value' && /Primitive(Float|Int)/i.test(node.class_type) && /duration|seconds/i.test(name)))) {
        analysis.durations.push({ nodeId: id, input: k });
      }
    }
    const { width, height } = node.inputs;
    if (width !== undefined && height !== undefined && (isLink(width) || typeof width === 'number') && (isLink(height) || typeof height === 'number')) {
      analysis.sizes.push(sizeTarget(graph, id, width, height));
    }
  }
  return analysis;
}

function sizeTarget(graph: WorkflowGraph, id: string, width: number | Link, height: number | Link): SizeTarget {
  if (typeof width === 'number' && typeof height === 'number') return { nodeId: id, pixels: width * height, multiple: 16 };
  // Linked size, e.g. from a resolution selector: keep its pixel budget and rounding.
  const source = graph[(isLink(width) ? width : height as Link)[0]]?.inputs ?? {};
  const megapixels = typeof source.megapixels === 'number' ? source.megapixels : 0.5;
  const multiple = [source.multiple, source.resolution_steps, source.divisible_by].find((m): m is number => typeof m === 'number' && m > 0) ?? 16;
  return { nodeId: id, pixels: megapixels * 1_000_000, multiple };
}

/** The prompt input used by default: the longest existing positive prompt, which is the main one in most workflows. */
export function defaultPromptTarget(analysis: WorkflowAnalysis): PromptTarget | undefined {
  return [...analysis.prompts].sort((a, b) => b.length - a.length)[0];
}

export function sizeForAspect(aspect: number, pixels: number, multiple: number): { width: number; height: number } {
  const round = (n: number) => Math.max(multiple, Math.round(n / multiple) * multiple);
  return { width: round(Math.sqrt(pixels * aspect)), height: round(Math.sqrt(pixels / aspect)) };
}

/** A reference to an uploaded Comfy asset, substituted into a loader's file input. */
export interface AssetReference { __type: 'core/ASSET'; info: { id: string; hash?: string; file_path?: string } }

export interface Binding {
  prompt?: string;
  promptTarget?: InputRef;
  media?: Map<string, AssetReference | string>;
  durationSec?: number;
  seed?: number;
  aspect?: number;
}

export const slotKey = (s: InputRef) => `${s.nodeId}.${s.input}`;

export function bindWorkflow(graph: WorkflowGraph, analysis: WorkflowAnalysis, binding: Binding): WorkflowGraph {
  const out = structuredClone(graph);
  const set = (ref: InputRef, value: unknown) => { if (out[ref.nodeId]) out[ref.nodeId].inputs[ref.input] = value; };
  for (const slot of analysis.slots) {
    const value = binding.media?.get(slotKey(slot));
    if (value === undefined) throw new Error(`Choose media for ${slot.title}.`);
    set(slot, value);
  }
  if (binding.prompt !== undefined) {
    const chosen = binding.promptTarget && analysis.prompts.find((p) => slotKey(p) === slotKey(binding.promptTarget!));
    const target = chosen ?? defaultPromptTarget(analysis);
    if (!target) throw new Error('This workflow has no prompt input.');
    set(target, binding.prompt);
  }
  if (binding.durationSec !== undefined) {
    for (const d of analysis.durations) set(d, /Int/i.test(graph[d.nodeId].class_type) ? Math.max(1, Math.round(binding.durationSec)) : Math.round(binding.durationSec * 100) / 100);
  }
  if (binding.seed !== undefined) for (const s of analysis.seeds) set(s, binding.seed);
  if (binding.aspect) {
    for (const s of analysis.sizes) {
      const { width, height } = sizeForAspect(binding.aspect, s.pixels, s.multiple);
      set({ nodeId: s.nodeId, input: 'width' }, width); set({ nodeId: s.nodeId, input: 'height' }, height);
    }
  }
  return out;
}

export function describeAnalysis(a: WorkflowAnalysis): string {
  const count = (kind: MediaKind, label: string) => {
    const n = a.slots.filter((s) => s.kind === kind).length;
    return n ? `${n} ${label}${n === 1 ? '' : 's'}` : '';
  };
  const inputs = [count('image', 'image'), count('audio', 'audio clip'), count('video', 'video clip')].filter(Boolean).join(', ') || 'no media';
  return `Inputs: ${inputs}. Outputs: ${a.outputs.join(', ') || 'none found'}.`;
}

export function randomSeed(): number {
  return Math.floor(Math.random() * 2 ** 48);
}
