/// <reference types="vitest/config" />
import { defineConfig } from 'vite';

// Integration tests against a local Supabase stack (`supabase start`): real
// Auth, API gateway and PostgREST. Run through `npm run test:supabase`, which
// checks the stack is local before running them.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.supabase.test.ts'],
    testTimeout: 30000,
    fileParallelism: false,
  },
});
