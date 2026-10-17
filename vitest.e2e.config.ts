/// <reference types="vitest/config" />
import { defineConfig } from 'vite';

// Browser tests of built copies of the app (`npm run e2e:supabase`, which
// builds and serves them first).
export default defineConfig({
  test: {
    environment: 'node',
    include: ['e2e/**/*.e2e.test.ts'],
    testTimeout: 120000,
    hookTimeout: 60000,
    fileParallelism: false,
  },
});
