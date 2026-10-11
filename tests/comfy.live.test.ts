// @vitest-environment node
/**
 * Runs a real workflow on Comfy Cloud with the app's own client and binder.
 * Skipped unless COMFY_API_KEY is set; the run is billed to that account.
 *   COMFY_API_KEY=comfyui-… npx vitest run tests/comfy.live.test.ts
 * COMFY_WORKFLOW points at another API-format text-to-image export.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { testComfyKey } from '../src/comfy/client';
import { runWorkflow } from '../src/comfy/run';
import { parseWorkflow } from '../src/comfy/workflow';

const key = process.env.COMFY_API_KEY;

it.skipIf(!key)('generates an image on Comfy Cloud', async () => {
  expect(await testComfyKey(key!)).toMatchObject({ ok: true });
  const path = process.env.COMFY_WORKFLOW ?? new URL('./fixtures/qwen_image_2_1_t2i.json', import.meta.url).pathname;
  const graph = parseWorkflow(readFileSync(path, 'utf8'));
  const { blob, job, seconds } = await runWorkflow({
    key: key!, workflow: { id: 'live', name: 'live', category: 'image', graph, importedAt: 0 },
    inputs: [], prompt: 'A red lighthouse on a rocky coast at dusk, soft painterly illustration.', aspect: 3 / 2, output: 'image',
    onStatus: (s) => console.log(s),
  });
  const out = process.env.COMFY_OUT ?? 'comfy-live-output.png';
  writeFileSync(out, Buffer.from(await blob.arrayBuffer()));
  console.log(`Job ${job.id} succeeded in ${seconds ?? '?'} s; wrote ${blob.size} bytes (${blob.type}) to ${out}`);
  expect(blob.size).toBeGreaterThan(1000);
}, 15 * 60_000);
