/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// Served from GitHub Pages at https://leftoverjacksons.github.io/cascadeFinance/
const base = '/cascadeFinance/';

export default defineConfig({
  base,
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'Cascade Finance',
        short_name: 'Cascade',
        description: 'Household finance tracking',
        theme_color: '#0f5d6e',
        background_color: '#ffffff',
        display: 'standalone',
        start_url: base,
        scope: base,
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Never cache Supabase API traffic; financial data must always be fresh.
        navigateFallbackDenylist: [/^\/rest\//, /^\/auth\//, /^\/storage\//],
        // The desktop dashboard grid is loaded only on wide screens; don't make
        // phones pre-download it. Desktops cache it the first time it loads.
        globIgnores: ['**/Workspace-*'],
        runtimeCaching: [
          {
            urlPattern: /\/assets\/Workspace-[^/]+\.(js|css)$/,
            handler: 'CacheFirst',
            options: { cacheName: 'desktop-workspace', expiration: { maxEntries: 8 } },
          },
        ],
      },
    }),
  ],
  test: {
    include: ['src/**/*.test.ts'],
  },
});
