/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite';
import { configDefaults } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { execSync } from 'node:child_process';
import { createReadStream, readFileSync } from 'node:fs';

// Shown in Settings so you can tell which build is running.
function commit(): string {
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return 'dev';
  }
}

/** A live test was asked for by name; see tests/*.live.test.ts. */
const LIVE = Boolean(process.env.LIVE_AGENT || process.env.LIVE_COMFY || process.env.LIVE_RENDER || process.env.LIVE_POSE);

// GitHub Pages can't set response headers, so the Content Security Policy is a
// <meta> tag. It is only added to production builds because the dev server
// injects inline scripts for hot reload.
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' blob: data:",
  "media-src 'self' blob: data:",
  "font-src 'self'",
  "worker-src 'self' blob:",
  // Comfy Cloud serves outputs from short-lived signed storage URLs. Browsers reach it through
  // the user's own relay (relay/), deployed as a Cloudflare Worker on workers.dev.
  "connect-src 'self' blob: data: https://api.openai.com https://generativelanguage.googleapis.com https://cloud.comfy.org https://storage.googleapis.com https://*.workers.dev",
  "object-src 'none'",
  "base-uri 'self'",
].join('; ');

function cspMeta(): Plugin {
  return {
    name: 'csp-meta',
    apply: 'build',
    transformIndexHtml: () => [
      { tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: CSP }, injectTo: 'head-prepend' },
    ],
  };
}

/**
 * MediaPipe's WASM runtime for pose detection (Match photo), served from the
 * package rather than kept in the repo: at /mediapipe/wasm/ in dev, emitted
 * there in builds. The model itself is in public/mediapipe/. Both load only
 * when Match photo opens.
 */
const MEDIAPIPE_WASM = ['vision_wasm_internal.js', 'vision_wasm_internal.wasm', 'vision_wasm_nosimd_internal.js', 'vision_wasm_nosimd_internal.wasm'];
const mediapipeWasm = (name: string) => new URL(`./node_modules/@mediapipe/tasks-vision/wasm/${name}`, import.meta.url);

function mediapipeAssets(): Plugin {
  return {
    name: 'mediapipe-assets',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const name = /\/mediapipe\/wasm\/([\w.]+)$/.exec(req.url?.split('?')[0] ?? '')?.[1];
        if (!name || !MEDIAPIPE_WASM.includes(name)) return next();
        res.setHeader('Content-Type', name.endsWith('.wasm') ? 'application/wasm' : 'text/javascript');
        createReadStream(mediapipeWasm(name)).pipe(res);
      });
    },
    generateBundle() {
      for (const name of MEDIAPIPE_WASM) this.emitFile({ type: 'asset', fileName: `mediapipe/wasm/${name}`, source: readFileSync(mediapipeWasm(name)) });
    },
  };
}

export default defineConfig({
  base: '/ShotByShot/',
  define: { __APP_BUILD__: JSON.stringify({ commit: commit(), time: new Date().toISOString() }) },
  plugins: [
    react(),
    cspMeta(),
    mediapipeAssets(),
    VitePWA({
      // New workers take over at once; the app shows its own "new version" banner (shell/UpdateBanner.tsx).
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['icon.svg'],
      // Draco decoders load on demand when a compressed model is imported.
      // Lettering fonts are precached (Latin only) so lettering works offline.
      // Pose detection (~30 MB) is cached the first time Match photo is used, not up front.
      workbox: {
        globPatterns: ['**/*.{js,css,html}', '**/*-latin-*.woff2'],
        skipWaiting: true,
        clientsClaim: true,
        globIgnores: ['**/draco_*', '**/mediapipe/**'],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        runtimeCaching: [{ urlPattern: /\/mediapipe\//, handler: 'CacheFirst', options: { cacheName: 'mediapipe', expiration: { maxEntries: 8 } } }],
      },
      manifest: {
        name: 'ShotByShot',
        short_name: 'ShotByShot',
        description: 'Shot breakdown and previs',
        theme_color: '#141416',
        background_color: '#141416',
        display: 'standalone',
        orientation: 'portrait',
        icons: [{ src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' }],
      },
    }),
  ],
  test: {
    environment: 'jsdom',
    setupFiles: ['tests/setup.ts'],
    // Live tests call real, billed services (OpenAI, Gemini, Comfy Cloud). They never run in a
    // plain `npm test`, even when API keys are in the environment: set LIVE_AGENT, LIVE_COMFY or
    // LIVE_RENDER to run one on purpose (see each file).
    exclude: [...configDefaults.exclude, ...(LIVE ? [] : ['tests/**/*.live.test.ts'])],
  },
});
