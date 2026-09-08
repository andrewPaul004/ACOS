/**
 * NEGATIVE — no caller-supplied authority reaches the outbox, and a CLAIM is not a DISPATCH.
 *
 * =================================================================================
 * WHY THIS IS A COMPILE-TIME FIXTURE AND NOT A RUNTIME CHECK.
 *
 * `§12` of the S1I mandate: "Do not allow a caller or model to say `recoverability =
 * REVERSIBLE` for an IRRECOVERABLE action." `§11`: "caller cannot override [the correlation
 * tag]." `§13`: "Do not trust an eligibility value stored by the caller."
 *
 * A runtime rejection asserts that one call was refused. THE ABSENCE OF THE FIELD asserts
 * that no call can be made — which is `26 §1` Corollary 3's form of the property ("the
 * request must be built by the ceiling's enforcer, not by its subject") and the same
 * discipline `I21`'s type boundary already applies to `ProposedIntent`.
 *
 * `tests/negative-controls/outbox-controls.test.ts` is the runtime half: it exhibits an
 * enqueue that DOES take a `recoverability` parameter and shows what it stores.
 * =================================================================================
 */

import type { Pool } from '../../src/db/pool.js';
import { enqueueDispatch } from '../../src/kernel/outbox/enqueue.js';
import { claimForExternalDispatch } from '../../src/kernel/outbox/claim.js';
import type { AcquiredClaim } from '../../src/kernel/outbox/claim.js';
import type { DispatchPayload } from '../../src/kernel/canonicalisation/types.js';

declare const control: Pool;
declare const now: Date;
declare const claim: AcquiredClaim;

// =====================================================================================
// `§12` — RECOVERABILITY IS NOT AN ENQUEUE PARAMETER
// =====================================================================================

// EXPECT_ERROR: `26 §5` assigns recoverability "per action class in the catalogue, not per
// request, and never by a model". The enqueue derives it in SQL from the committed `effect`
// row, so there is no field to put a claim in.
export const relabelled = enqueueDispatch(control, {
  companyId: 'co',
  effectId: 'effect:1',
  outboxId: 'outbox:1',
  payloadCanonicalBytes: Buffer.alloc(0),
  now,
  recoverability: 'REVERSIBLE', // EXPECT_ERROR TS2353
});

// EXPECT_ERROR: `§11` — the correlation tag is minted by trusted code and persisted once.
export const taggedByCaller = enqueueDispatch(control, {
  companyId: 'co',
  effectId: 'effect:1',
  outboxId: 'outbox:1',
  payloadCanonicalBytes: Buffer.alloc(0),
  now,
  correlationTag: 'acos-corr-chosen-by-the-caller', // EXPECT_ERROR TS2353
});

// EXPECT_ERROR: `26 §2.1` binds the request to exactly one payload by hash, and the outbox
// reads that hash from the committed authorisation. A caller-supplied hash would let the
// bytes and the authority disagree.
export const hashedByCaller = enqueueDispatch(control, {
  companyId: 'co',
  effectId: 'effect:1',
  outboxId: 'outbox:1',
  payloadCanonicalBytes: Buffer.alloc(0),
  now,
  dispatchPayloadHash: 'deadbeef', // EXPECT_ERROR TS2353
});

// =====================================================================================
// `§13` — ELIGIBILITY IS NOT A CLAIM PARAMETER
// =====================================================================================

// EXPECT_ERROR: `§13` — "Do not trust an eligibility value stored by the caller." The claim
// derives every operand of `30 §5.1` item 4 inside its own transaction.
export const preDecided = claimForExternalDispatch(control, {
  companyId: 'co',
  idempotencyKey: 'idem:1',
  claimedBy: 'worker:1',
  now,
  eligible: true, // EXPECT_ERROR TS2353
});

// EXPECT_ERROR: nor is the mirror state, which `30 §5.6` derives from durable declarations.
export const stateSupplied = claimForExternalDispatch(control, {
  companyId: 'co',
  idempotencyKey: 'idem:1',
  claimedBy: 'worker:1',
  now,
  mirrorState: 'NORMAL', // EXPECT_ERROR TS2353
});

// EXPECT_ERROR: nor the override. `30 §5.7.2` makes it kernel state read under a row lock.
export const overrideSupplied = claimForExternalDispatch(control, {
  companyId: 'co',
  idempotencyKey: 'idem:1',
  claimedBy: 'worker:1',
  now,
  overrideId: 'override:chosen', // EXPECT_ERROR TS2353
});

// =====================================================================================
// `§3` AND `§41` — A CLAIM IS NOT A DISPATCH
// =====================================================================================

/**
 * What a future adapter boundary would demand — `26 §2.1`'s `DispatchPayload`, verbatim:
 *
 *   DispatchPayload {
 *     adapter, method, vendor_parameters, idempotency_key,
 *     monetary_effect, precondition_token, authorisation_ref
 *   }
 */
interface DispatchableClaim {
  readonly outboxId: string;
  readonly dispatchPayload: DispatchPayload;
}

// EXPECT_ERROR: an `AcquiredClaim` carries the payload's BYTES and its HASH, and not one of
// `DispatchPayload`'s seven structured fields. `§3`: "The strongest S1I terminal state is
// `CLAIMED_FOR_EXTERNAL_DISPATCH`. It does NOT mean request sent."
export const dispatchable: DispatchableClaim = claim; // EXPECT_ERROR TS2739

// EXPECT_ERROR: and there is no adapter, endpoint or vendor field on it to read.
export const endpoint: string = claim.row.adapterEndpoint; // EXPECT_ERROR TS2339
