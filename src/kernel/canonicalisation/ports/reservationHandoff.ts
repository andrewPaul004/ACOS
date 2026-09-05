import { toDb, type Money } from '../../exposure/money.js';
import type { AuthorizationRequest } from '../types.js';

/**
 * The boundary at which a later gateway transaction hands exposure to the reservation
 * layer. A PORT, not a wiring.
 *
 * `26 §2.1.1` `I18b`, verbatim:
 *
 *   "reservation.amount == exposure.total_exposure, exactly, always, no tolerance."
 *
 * `26 §7` step R, verbatim, for an ordinary non-rate class:
 *
 *   "Reserves exposure.total_exposure into the ordinary reservation term — I3 term 1 —
 *    against every named window instance the matching grants reference, taking each
 *    window_balance row SELECT … FOR UPDATE in ascending window_id and then the journal
 *    counter [...], and fails if any lacks headroom."
 *
 * ---------------------------------------------------------------------------------
 * WHY THIS IS A PORT AND NOT A CALL
 *
 * S1B proves `model intent -> authoritative construction`. It does NOT prove
 * `authoritative construction -> policy -> reservation -> decision`, and wiring the
 * reservation transaction here would be claiming the second arrow on the strength of the
 * first.
 *
 * So this module states the quantity that WILL be offered and asserts the `I18b` equality
 * at the boundary. It takes no lock, opens no transaction, writes no `window_balance` row
 * and imports nothing from `src/kernel/exposure/` except the `Money` type and its
 * renderer. The accepted S1A exposure ledger is untouched by S1B.
 *
 * For the VC-C1 fixture the offered amount is $26.03 — the total exposure, never the
 * $25.00 the vendor sees.
 * ---------------------------------------------------------------------------------
 */
export interface ExposureReservationOffer {
  /** `== request.exposure.totalExposure`, by `I18b`. */
  readonly offeredAmount: Money;
  readonly currency: string;
  /** Every named window instance the reservation will be taken against. */
  readonly windowRefs: readonly string[];
}

export function offerForReservation(request: AuthorizationRequest): ExposureReservationOffer {
  const exposure = request.exposure;
  const offer: ExposureReservationOffer = {
    offeredAmount: exposure.totalExposure,
    currency: exposure.currency,
    windowRefs: request.windowRefs,
  };
  if (offer.offeredAmount !== exposure.totalExposure) {
    // Unreachable as written, and deliberately still here: it is the single line a future
    // edit would have to delete in order to offer anything other than total_exposure, and
    // `I18b`'s on-violation column reads "Critical incident. Class suspended."
    throw new Error(
      `I18b: the offered amount ${toDb(offer.offeredAmount)} is not exposure.total_exposure ${toDb(exposure.totalExposure)}`,
    );
  }
  return offer;
}
