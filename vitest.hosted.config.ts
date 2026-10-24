/// <reference types="vitest/config" />
import { defineConfig } from 'vite';

// The focused hosted verification (roadmap F3) against the approved hosted
// test project. Run through `npm run test:hosted`, which checks the project
// (allowlist, exact address, marker) and the disposable identities first.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.hosted.test.ts'],
    testTimeout: 30000,
    fileParallelism: false,
  },
});
