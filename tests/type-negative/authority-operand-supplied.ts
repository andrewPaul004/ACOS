/**
 * NEGATIVE — no caller can supply a `26 §7` authority operand to the pre-reservation pipeline.
 *
 * `26 §1` Corollary 3, verbatim: "the request must be built by the ceiling's enforcer, not by
 * its subject. […] **A limit evaluated against a figure the model supplied is not a limit.**"
 *
 * `26 §2.1`, on the principal: "resolved, signed, chain-verified — **stamped by the kernel,
 * never a parameter**."
 *
 * Four attacks, and none of them is REJECTED at runtime — each fails to typecheck, because
 * the field it needs does not exist:
 *
 *   1. assert a principal on the identity input
 *   2. pass a principal or a grant-window set through the pipeline's context
 *   3. hand the pipeline a generic bag alongside its named parameters
 *   4. write a grade onto a fetched precondition before it is graded
 */

import type { RuntimeSessionRef } from '../../src/kernel/authority/principal.js';
import type { KernelNonAuthorityContext } from '../../src/kernel/authority/preReservation.js';
import type { FetchedPrecondition } from '../../src/kernel/authority/preconditions.js';

declare const session: RuntimeSessionRef;
declare const precondition: FetchedPrecondition;

// EXPECT_ERROR: the identity input names a SESSION. There is no principal field on it.
export const spoofed: RuntimeSessionRef = {
  ...session,
  principalId: 'principal:support_reasoner:1', // EXPECT_ERROR TS2353
};

// EXPECT_ERROR: the pipeline's context carries lineage only — no principal.
export const withPrincipal: KernelNonAuthorityContext = {
  contextDigest: 'ctx',
  authorisationRef: 'auth',
  principal: { id: 'principal:owner', kind: 'OWNER', role: 'owner' }, // EXPECT_ERROR TS2353
};

// EXPECT_ERROR: nor a grant-window set. `26 §2.1` derives it from the matching grants.
export const withWindows: KernelNonAuthorityContext = {
  contextDigest: 'ctx',
  authorisationRef: 'auth',
  grantWindows: { windowRefs: ['W_MONTH_ADSPEND'], resolvedBy: 'caller' }, // EXPECT_ERROR TS2353
};

// EXPECT_ERROR: and no generic bag. `26 §2.3`: "The engine reads no prose."
export const withBag: KernelNonAuthorityContext = {
  contextDigest: 'ctx',
  authorisationRef: 'auth',
  metadata: { grade: 'RECORD', platformStatus: 'OPERATING' }, // EXPECT_ERROR TS2353
};

// EXPECT_ERROR: a fetched precondition's grade is read-only — it is the database's answer.
export function forgeGrade(): void {
  precondition.grade = 'RECORD'; // EXPECT_ERROR TS2540
}
