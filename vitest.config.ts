import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts', 'spikes/**/*.test.ts'],
    globalSetup: ['tests/support/globalSetup.ts'],
    // The concurrency tests coordinate two real Postgres backends through in-process
    // barriers. Running files in parallel would let two tests contend for the same
    // window_balance row and turn a deterministic interleaving into a flaky one.
    fileParallelism: false,
    sequence: { concurrent: false },
    testTimeout: 60_000,
    hookTimeout: 120_000,
    reporters: ['verbose'],
  },
});
