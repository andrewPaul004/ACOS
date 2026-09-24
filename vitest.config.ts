import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts', 'spikes/**/*.test.ts'],
    globalSetup: ['tests/support/globalSetup.ts'],
    // `50 §3f` occasion 1, per worker. After S1K the action catalogue, the degraded-mode
    // configuration, the Cedar policy set and the `ACOS-JCS-1` canonicaliser all resolve
    // through the active verified control-artifact bundle, so a test file without one has an
    // unbootstrapped kernel — which is correct behaviour and is asserted deliberately by
    // `tests/controlArtifacts/bootstrap-gate.test.ts`. Every other file needs a READY kernel.
    setupFiles: ['tests/support/controlArtifactSetup.ts'],
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
