import { bootstrapControlArtifactAuthority } from '../../src/kernel/controlArtifacts/registry.js';

import { defaultControlArtifactFixture } from './controlArtifactFixture.js';

/**
 * `50 §3f` OCCASION 1, RUN ONCE PER TEST WORKER.
 *
 * =================================================================================
 * WHY EVERY TEST FILE NEEDS THIS, AND WHY THAT IS THE POINT RATHER THAN A NUISANCE
 *
 * `50 §3f`: "**Before the kernel becomes READY** [...] **On any failure the kernel FAILS
 * CLOSED BEFORE ANY AUTHORITY EXECUTION.** It does not become READY, it does not serve a
 * degraded subset, and it does not admit a single effect."
 *
 * After this slice the action catalogue, the degraded-mode configuration, the Cedar policy
 * set and the `ACOS-JCS-1` canonicaliser all resolve through the active verified bundle. A
 * test file that did not bootstrap would therefore fail on its first authority call — which
 * is the correct behaviour and is asserted deliberately in
 * `tests/controlArtifacts/bootstrap-gate.test.ts`. Every OTHER test file needs a running
 * kernel, so it bootstraps here, exactly as a deployment would.
 *
 * THE PACKAGE IS THE REPOSITORY'S OWN ARTIFACT BYTES. Only the keys and the manifest are
 * test-only, so a test that reads `irrecoverable_units` or the approval floor reads the
 * value production will run.
 *
 * A test that needs the kernel NOT to be ready, or needs a different package, builds its own
 * fixture and uses `vi.resetModules()` to obtain a fresh registry — the active bundle lives
 * in module-private state, so a fresh module graph is a fresh, unbootstrapped kernel.
 * =================================================================================
 */
bootstrapControlArtifactAuthority({
  configurationSource: defaultControlArtifactFixture().controlEnv,
});
