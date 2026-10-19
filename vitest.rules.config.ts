/// <reference types="vitest/config" />
import { defineConfig } from 'vite';

// Firestore security rule tests. They need the Firestore emulator, so they run
// through `npm run test:rules` (which starts it) rather than `npm test`.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.rules.test.ts'],
    testTimeout: 20000,
    fileParallelism: false,
  },
});
