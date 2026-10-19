/// <reference types="vitest/config" />
import { defineConfig } from 'vite';

// Database tests: the Supabase migrations in a real PostgreSQL. They need a
// running cluster, so they run through `npm run test:db` (which starts one)
// rather than `npm test`.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.db.test.ts'],
    testTimeout: 30000,
    fileParallelism: false,
  },
});
