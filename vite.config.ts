/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  server: {
    host: '0.0.0.0',
    port: 3000,
    // AI Studio sets DISABLE_HMR=true in its preview: live reload there
    // refreshes the page whenever files change or its connection drops,
    // which wipes whatever someone is typing.
    hmr: process.env.DISABLE_HMR !== 'true',
  },
  plugins: [
    react(),
    VitePWA({
      // A new version waits until the person taps "Update" (or reopens the
      // app), so the page never reloads in the middle of entering something.
      registerType: 'prompt',
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        // Firebase's sign-in pages and the server's config file must come from the network, never the app shell.
        navigateFallbackDenylist: [/^\/__\//],
      },
      includeAssets: ['icon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Financial OS',
        short_name: 'Financial OS',
        description: 'See when money comes in, when it goes out, and spot shortfalls before they happen.',
        theme_color: '#1c1c1e',
        background_color: '#1c1c1e',
        display: 'standalone',
        start_url: '.',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml' },
        ],
      },
    }),
  ],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
    // Security rule tests need the Firestore emulator (`npm run test:rules`);
    // database tests need PostgreSQL (`npm run test:db`); Supabase and browser
    // tests need a local stack (`npm run test:supabase`, `npm run e2e:supabase`).
    exclude: ['**/node_modules/**', '**/dist/**', '**/*.rules.test.ts', '**/*.db.test.ts', '**/*.supabase.test.ts', '**/*.e2e.test.ts'],
  },
});
