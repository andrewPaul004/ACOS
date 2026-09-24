import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  CLASS_2_BUNDLE_PATH,
  assemblePolicySetBundle,
} from '../../tools/control-artifacts/assemblePolicySet.js';
import { verifiedPolicySet } from '../../src/kernel/controlArtifacts/bundle.js';
import { activeVerifiedControlArtifacts } from '../../src/kernel/controlArtifacts/registry.js';

/**
 * THE DRIFT ALARM between the AUTHORED `.cedar` sources and the DEPLOYED class-2 bundle.
 *
 * =================================================================================
 * WHAT THIS IS, AND — MORE IMPORTANTLY — WHAT IT IS NOT
 *
 * `50 §2e` makes the deployed artifact "the Cedar schema file and every `.cedar` policy
 * source file, in **one immutable byte object**", hashed by `§3c` over its exact bytes. The
 * `.cedar` files under `src/kernel/policy/artifacts/` are where a policy is AUTHORED and
 * reviewed; `artifacts/control/class-02.policy-set.json` is what a release SHIPS.
 *
 * **THIS IS NOT A SECOND AUTHORITY SOURCE.** `50 §3c` forbids exactly that: "A signed
 * control artifact and a separate hard-coded production literal may not both be authority
 * sources, with equality asserted only in a test". After S1K nothing under `src/` reads the
 * `.cedar` files at all — `policyArtifacts.ts` has no filesystem — so they are not an
 * authority source that this test is propping up. They are the review surface, and this is
 * an alarm that fires when a reviewer edits one and forgets to re-assemble.
 *
 * The distinction is checkable rather than asserted: if the `.cedar` files were still an
 * authority source, `policyArtifacts.ts` would import `node:fs`, and
 * `tests/policy/policy-artifacts.test.ts` asserts it does not.
 * =================================================================================
 */

describe('the deployed class-2 bundle is what the authored sources assemble to', () => {
  it('re-assembling the bundle reproduces the checked-in bytes exactly', () => {
    expect(assemblePolicySetBundle().equals(readFileSync(CLASS_2_BUNDLE_PATH))).toBe(true);
  });

  it('assembly is DETERMINISTIC — two runs over one tree produce identical bytes', () => {
    // A release has to be reproducible, or the owner signs bytes the next build cannot
    // recreate. The sorted id order and the fixed indent are what make that true.
    expect(assemblePolicySetBundle().equals(assemblePolicySetBundle())).toBe(true);
  });

  it('and the VERIFIED bundle carries the same schema and sources', () => {
    const assembled = JSON.parse(assemblePolicySetBundle().toString('utf8')) as {
      schema: string;
      policies: { id: string; source: string }[];
    };
    const verified = verifiedPolicySet(activeVerifiedControlArtifacts());
    expect(verified.schema).toBe(assembled.schema);
    expect([...verified.policyIds]).toEqual(assembled.policies.map((policy) => policy.id));
    for (const policy of assembled.policies) {
      expect(verified.staticPolicies[policy.id]).toBe(policy.source);
    }
  });
});
