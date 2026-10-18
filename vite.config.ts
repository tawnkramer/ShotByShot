/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { execSync } from 'node:child_process';

// Shown in Settings so you can tell which build is running.
function commit(): string {
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return 'dev';
  }
}

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
  "connect-src 'self' blob: data: https://api.openai.com https://cloud.comfy.org https://storage.googleapis.com https://*.workers.dev",
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

export default defineConfig({
  base: '/ShotByShot/',
  define: { __APP_BUILD__: JSON.stringify({ commit: commit(), time: new Date().toISOString() }) },
  plugins: [
    react(),
    cspMeta(),
    VitePWA({
      // New workers take over at once; the app shows its own "new version" banner (shell/UpdateBanner.tsx).
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['icon.svg'],
      // Draco decoders load on demand when a compressed model is imported.
      // Lettering fonts are precached (Latin only) so lettering works offline.
      workbox: { globPatterns: ['**/*.{js,css,html}', '**/*-latin-*.woff2'], skipWaiting: true, clientsClaim: true, globIgnores: ['**/draco_*'], maximumFileSizeToCacheInBytes: 4 * 1024 * 1024 },
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
  },
});
