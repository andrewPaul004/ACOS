/**
 * NEGATIVE — neither `window_refs` nor the retained fee can be supplied by anything the
 * model touched. S1B.1, clarifications S1B-C3a and S1B-C5a.
 *
 * `26 §2.1`: `window_refs[]  // every named window the matching grants reference`, and
 * every field of the `AuthorizationRequest` block is "kernel-computed".
 *
 * `24 §3` K4, on what AI may not do, verbatim: "Supply an exposure figure, a vendor
 * parameter, a monetary value, a counterparty, a value_direction, a recoverability class,
 * or any field of the dispatched request."
 *
 * At the wire boundary the parser rejects both — `window_refs` on a `ProposedIntent` denies
 * `MALFORMED / EXTRA_FIELD`. Here the same impossibility is enforced by the type, so a code
 * path that somehow obtained a model-chosen window list or a model-chosen amount still
 * cannot write either into an authority position.
 */

import { money, type Money } from '../../src/kernel/exposure/money.js';
import type { AuthoritativeRetainedFee } from '../../src/kernel/canonicalisation/authoritativeCost.js';
import type { AuthoritativeGrantWindowContext } from '../../src/kernel/canonicalisation/grantWindows.js';
import type {
  AuthoritativeCanonicalisationContext,
  AuthorizationRequest,
} from '../../src/kernel/canonicalisation/types.js';

/** Whatever a compromised model managed to smuggle through. Plain values, not computed. */
const modelChosenWindows: readonly string[] = ['W_QUARTER_TREASURY'];
const modelChosenFee: Money = money('0.00');

// EXPECT_ERROR: readonly string[] is not assignable to KernelComputed<readonly string[]>.
export const windows: Pick<AuthorizationRequest, 'windowRefs'> = {
  windowRefs: modelChosenWindows, // EXPECT_ERROR TS2322
};

// EXPECT_ERROR: a plain AuthoritativeGrantWindowContext is not KernelComputed.
const grantWindows: AuthoritativeGrantWindowContext = {
  windowRefs: modelChosenWindows,
  resolvedBy: 'the model said so',
};
export const context: Pick<AuthoritativeCanonicalisationContext, 'grantWindows'> = {
  grantWindows, // EXPECT_ERROR TS2322
};

// EXPECT_ERROR: a plain AuthoritativeRetainedFee is not KernelComputed either — the fee is
// authoritative state, and a model-reachable zero is precisely the retained-fee escape.
const fee: AuthoritativeRetainedFee = {
  amount: modelChosenFee,
  sourceRef: 'the model said so',
  currency: 'USD',
};
export const cost: Pick<AuthoritativeCanonicalisationContext, 'retainedProcessingFee'> = {
  retainedProcessingFee: fee, // EXPECT_ERROR TS2322
};
