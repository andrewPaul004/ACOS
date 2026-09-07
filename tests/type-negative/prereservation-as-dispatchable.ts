/**
 * NEGATIVE — an S1E pass is not a dispatchable authorisation, and the type says so.
 *
 * The S1E mandate: "Do not expose a token/object that an adapter or future executor could
 * reasonably interpret as final authorisation. […] **S1E PASS CANNOT BE DISPATCHED.**"
 *
 * `26 §2.1`, on what an adapter consumes, verbatim:
 *
 *   DispatchPayload {                       // built by the kernel, consumed verbatim by the
 *     adapter, method, vendor_parameters, idempotency_key,   // adapter
 *     monetary_effect, precondition_token, authorisation_ref
 *   }
 *
 * `PreReservationQualified` carries NONE of those fields. The pipeline holds the payload —
 * C′ emits it with the request and hashes them together — and does not hand it out, so what
 * crosses the boundary has nothing an adapter could call a vendor with.
 *
 * The runtime half is in `tests/integration/authority/pre-reservation-pipeline.test.ts`
 * ("AND THE RESULT IS NOT DISPATCHABLE"). This is the stronger half: a future executor that
 * tried to consume an S1E result as a dispatchable authorisation does not compile.
 */

import type { DispatchPayload } from '../../src/kernel/canonicalisation/types.js';
import type {
  PreReservationApprovalRequired,
  PreReservationQualified,
} from '../../src/kernel/authority/preReservationResult.js';

declare const qualified: PreReservationQualified;
declare const approvalRequired: PreReservationApprovalRequired;

/** What a future adapter boundary would demand. */
interface DispatchableAuthorisation {
  readonly authorisationId: string;
  readonly reservationId: string;
  readonly dispatchPayload: DispatchPayload;
}

// EXPECT_ERROR: a pre-reservation pass carries no authorisation, no reservation and no payload.
export const dispatchable: DispatchableAuthorisation = qualified; // EXPECT_ERROR TS2739

// EXPECT_ERROR: and there is no payload field to reach for. TypeScript suggests
// `dispatchPayloadHash` instead, which is exactly the boundary: the HASH crosses, the
// payload does not.
export const payload: DispatchPayload = qualified.dispatchPayload; // EXPECT_ERROR TS2551

// EXPECT_ERROR: nor a reservation the sequence never took.
export const reservation: string = qualified.reservationId; // EXPECT_ERROR TS2339

// EXPECT_ERROR: nor an approval, which `26 §12` owns and S1E does not implement.
export const approval: string = approvalRequired.approvalId; // EXPECT_ERROR TS2339

// EXPECT_ERROR: the verdict word is a literal type; it cannot be restamped as an authorisation.
export const restamped: 'AUTHORISED' = qualified.outcome; // EXPECT_ERROR TS2322
