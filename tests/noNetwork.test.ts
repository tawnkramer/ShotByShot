import { describe, expect, it } from 'vitest';
import { submitJob, testComfyKey } from '../src/comfy/client';

/**
 * The plain test run must not be able to call paid services, even with API
 * keys in the environment. (A live Comfy test used to run whenever
 * COMFY_API_KEY was set, queueing a real image job on every `npm test`.)
 */
describe('tests are offline', () => {
  it('refuse requests to Comfy Cloud, OpenAI and Gemini', async () => {
    for (const url of ['https://cloud.comfy.org/api/v2/jobs', 'https://api.openai.com/v1/models', 'https://generativelanguage.googleapis.com/v1beta/models']) {
      await expect(fetch(url)).rejects.toThrow(/Tests may not reach/);
    }
  });

  it("stop the app's own Comfy client before it submits a job", async () => {
    await expect(submitJob('comfyui-real-looking-key', { 1: { class_type: 'X', inputs: {} } })).rejects.toThrow(/reach/i);
    expect((await testComfyKey('comfyui-real-looking-key')).ok).toBe(false);
  });

  it('leave live tests out unless one is asked for', async () => {
    const { default: config } = await import('../vite.config');
    const exclude = (config as { test?: { exclude?: string[] } }).test?.exclude ?? [];
    expect(exclude).toContain('tests/**/*.live.test.ts');
  });
});
