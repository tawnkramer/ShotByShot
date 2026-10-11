import type { WorkflowGraph } from './workflow';

export interface CostEstimate { min: number; max: number }

/**
 * Partner-node prices for a bound workflow, in USD. Ported from the price
 * badges in ComfyUI's comfy_api_nodes/nodes_bytedance.py (checked 2026-10-11);
 * update alongside them. GPU time for other nodes isn't priced in advance.
 */
export function estimateWorkflowCost(graph: WorkflowGraph): CostEstimate | undefined {
  let total: CostEstimate | undefined;
  for (const node of Object.values(graph)) {
    const cost = /^ByteDance2/.test(node.class_type) ? seedance2(node.inputs) : undefined;
    if (cost) total = { min: (total?.min ?? 0) + cost.min, max: (total?.max ?? 0) + cost.max };
  }
  return total;
}

function seedance2(inputs: Record<string, unknown>): CostEstimate | undefined {
  const model = inputs.model, res = inputs['model.resolution'], ratio = inputs['model.ratio'], dur = inputs['model.duration'];
  const auto = inputs['model.task_type'] === 'edit' || inputs['model.video_editing'] === true;
  const hasVideo = Object.keys(inputs).some((k) => k.startsWith('model.reference_videos.'));
  if (typeof model !== 'string' || typeof res !== 'string' || (!auto && typeof dur !== 'number')) return undefined;
  const d = dur as number;
  if (model.includes('2.5')) {
    const is480 = res === '480p', is1080 = res === '1080p';
    const perFrame = ratio === '1:1' ? (is480 ? 400 : is1080 ? 2025 : 900)
      : ratio === '4:3' || ratio === '3:4' ? (is480 ? 411.25 : is1080 ? 2028 : 905.6719)
      : ratio === '21:9' ? (is480 ? 418.5 : is1080 ? 2037.9648 : 904.3945)
      : (is480 ? 400.3125 : is1080 ? 2025 : 900);
    const price = is1080 ? (hasVideo ? 0.01001 : 0.016731) : (hasVideo ? 0.009152 : 0.015301);
    const costFor = (s: number) => Math.floor(perFrame * (24 * s + 1)) / 1000 * price;
    return { min: costFor(auto ? 4 : d), max: costFor((auto ? 30 : d) + (hasVideo ? 30 : 0)) };
  }
  const rate = res === '4k' ? 195200 : res === '1080p' ? 48800 : res === '720p' ? 21600 : 10044;
  const lower = model.toLowerCase();
  if (hasVideo) {
    const videoPrice = res === '4k' ? 0.003432 : res === '1080p' ? 0.006721 : lower.includes('mini') ? 0.003003 : lower.includes('fast') ? 0.004719 : 0.006149;
    return { min: Math.ceil(d * 5 / 3) * rate * videoPrice / 1000, max: (15 + d) * rate * videoPrice / 1000 };
  }
  const price = res === '4k' ? 0.00572 : res === '1080p' ? 0.011011 : lower.includes('mini') ? 0.005005 : lower.includes('fast') ? 0.008008 : 0.01001;
  const usd = d * rate * price / 1000;
  return { min: usd, max: usd };
}

export function formatCost({ min, max }: CostEstimate): string {
  return Math.abs(max - min) < 0.005 ? `$${min.toFixed(2)} USD` : `$${min.toFixed(2)}–$${max.toFixed(2)} USD`;
}
