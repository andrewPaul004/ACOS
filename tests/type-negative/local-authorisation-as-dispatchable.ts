/**
 * NEGATIVE — a COMMITTED local authorisation is still not a dispatchable one.
 *
 * S1E's boundary was easy to state: the result carried no authorisation and no reservation,
 * so there was nothing to dispatch. S1F's is the harder case, and it is the one that
 * matters. After S1F there IS a committed authorisation, a signed decision, a real
 * reservation and a journal row — genuine local authority — and the type must still refuse
 * to be read as permission to reach a vendor.
 *
 * The S1F mandate: "Do not make the terminal return shape equivalent to an adapter request.
 * Prefer returning identifiers/state [...] rather than the credential-bearing/vendor-ready
 * payload. [...] No code in S1F should perform transport."
 *
 * `26 §2.1`, on what an adapter consumes, verbatim:
 *
 *   DispatchPayload {                       // built by the kernel, consumed verbatim by the
 *     adapter, method, vendor_parameters, idempotency_key,   // adapter
 *     monetary_effect, precondition_token, authorisation_ref
 *   }
 *
 * `LocalAuthorisationCommitted` carries NONE of those seven fields. Not even the
 * idempotency key, which `26 §7` step T mints INSIDE the transaction and which is the one
 * field a holder could carry to a vendor and reuse.
 *
 * The runtime half is in
 * `tests/integration/authority/local-authorisation-pipeline.test.ts`. This is the stronger
 * half: an executor that tried to dispatch an S1F result does not compile.
 */

import type { DispatchPayload } from '../../src/kernel/canonicalisation/types.js';
import type {
  LocalAuthorisationCommitted,
  LocalAuthorisationDuplicate,
  LocalAuthorisationPendingApproval,
} from '../../src/kernel/authorisation/localAuthorisationResult.js';

declare const committed: LocalAuthorisationCommitted;
declare const pending: LocalAuthorisationPendingApproval;
declare const duplicate: LocalAuthorisationDuplicate;

/** What a future adapter boundary would demand. */
interface DispatchableEffect {
  readonly effectId: string;
  readonly reservationId: string;
  readonly dispatchPayload: DispatchPayload;
}

// EXPECT_ERROR: a committed local authorisation carries no payload, so it cannot be one.
export const dispatchable: DispatchableEffect = committed; // EXPECT_ERROR TS2741

// EXPECT_ERROR: and there is no payload field to reach for.
export const payload: DispatchPayload = committed.dispatchPayload; // EXPECT_ERROR TS2339

// EXPECT_ERROR: nor the idempotency key. `26 §7` step T mints it inside the transaction and
// nothing outside the kernel needs it before the outbox (`25 §7` layer 4) exists.
export const key: string = committed.idempotencyKey; // EXPECT_ERROR TS2339

// EXPECT_ERROR: nor the adapter, which is `24 §3` K4's effect-row field and not the
// caller's.
export const adapter: string = committed.adapter; // EXPECT_ERROR TS2339

// EXPECT_ERROR: nor the vendor-visible amount. `I18a`'s monetary_effect lives on the
// payload; only `total_exposure` is authority, and it is not on this record either.
export const monetary: string = committed.monetaryEffect; // EXPECT_ERROR TS2339

// EXPECT_ERROR: the local status is a literal type; it cannot be restamped as dispatched.
export const restamped: 'DISPATCHED' = committed.localStatus; // EXPECT_ERROR TS2322

// EXPECT_ERROR: a PENDING approval is not an authorisation to act. `26 §12`: "Never
// auto-approve on timeout" — and never read a pending tier as a permit.
export const pendingAsPermit: 'PERMIT' = pending.verdict; // EXPECT_ERROR TS2322

// EXPECT_ERROR: step V returns the PRIOR result and mints no new authority, so there is no
// fresh reservation on it to dispatch against.
export const duplicateReservation: string = duplicate.reservationId; // EXPECT_ERROR TS2339
