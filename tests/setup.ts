import 'fake-indexeddb/auto';

/**
 * Tests must never reach a real service: a stray request to OpenAI, Gemini
 * or Comfy Cloud is a billed call (and a picture in someone's Comfy history).
 * Requests to other hosts fail with a clear error unless a live test was
 * asked for. Tests stub fetch (vi.stubGlobal) to fake responses.
 */
const LIVE = Boolean(process.env.LIVE_AGENT || process.env.LIVE_COMFY || process.env.LIVE_RENDER || process.env.LIVE_POSE);
const realFetch = globalThis.fetch;

export function isOffline(url: string): boolean {
  if (!/^https?:\/\//i.test(url)) return true;
  const host = new URL(url).hostname;
  return host === 'localhost' || host === '127.0.0.1' || host === '::1';
}

if (!LIVE && realFetch) {
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (!isOffline(url)) return Promise.reject(new Error(`Tests may not reach ${new URL(url).host}. Stub fetch in the test, or run a live test with LIVE_* set.`));
    return realFetch(input, init);
  }) as typeof fetch;
}
