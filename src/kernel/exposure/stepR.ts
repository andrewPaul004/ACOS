import type { Client } from '../../db/pool.js';
import { asDenial } from './errors.js';
import { applyReservation } from './ledger.js';
import { acquireMoneyPathLocks, allocateJournalSeq } from './lockOrder.js';
import { isZero, toDb, ZERO, type Money } from './money.js';
import type { WindowInstance } from './windowInstance.js';

/**
 * Step R — Reserve.
 *
 * `26 §7`'s step R row, as restated by v1.3.1 erratum 1 (E1 / TB-03), verbatim:
 *
 *   "Ordinary, non-rate class. Reserves exposure.total_exposure into the ordinary
 *    reservation term — I3 term 1 — against every named window instance the matching
 *    grants reference, taking each window_balance row SELECT … FOR UPDATE in ascending
 *    window_id and then the journal counter (30 §5.2's declared lock order), and fails
 *    if any lacks headroom.
 *
 *    Rate class. exposure.total_exposure is 0.00 (§2.1.3), so step R creates a real
 *    zero-amount reservation row — reservation.amount == exposure.total_exposure ==
 *    0.00, satisfying I2 without a carve-out and I18b exactly — and in the same
 *    transaction creates the StandingAuthorization, its StandingRevocationAuthority
 *    (I55) and the standing_window_exposure rows whose forward_monetary enters I3 term
 *    2. forward_integral is never the ordinary reservation amount. The transaction still
 *    locks and re-checks every referenced window instance in the declared order before
 *    committing, and denies WINDOW_EXHAUSTED if any lacks headroom under the four-term
 *    guard."
 *
 * The two branches share no verb, deliberately. `phase2-v1.3.1-errata.md §1` records
 * that a shared verb is exactly how TB-03 was reintroduced into the sequence
 * specification, and E1 forbids any passage that describes `forward_integral` as the
 * ordinary reservation amount. The same rule is applied to the code.
 *
 * S1A SCOPE. The exposure block arrives here as a parameter. `26 §2.1` requires it to be
 * computed by the Effect Canonicaliser under a versioned constructor, and S1A does not
 * build the canonicaliser — the S1A mandate excludes it and
 * `phase2-v1.3-implementation-brief.md §2` is explicit: "Do not start with the
 * canonicaliser." Fixtures supply the block instead, which also makes VC-S7's assertions
 * independent of any production constructor.
 */

export interface ExposureBlock {
  /** NULL where the dispatched vendor request carries no monetary field (I18a). */
  readonly vendorAmount: Money | null;
  /** I18b binds this to reservation.amount exactly, with no tolerance. */
  readonly totalExposure: Money;
  /**
   * `26 §2.1`: for rate classes, "the ENTIRE economic exposure and it is carried by I3
   * term 2, never by the reservation."
   */
  readonly forwardIntegral: Money | null;
}

export interface WindowTarget {
  readonly instance: WindowInstance;
  /** Count-ledger units this commitment consumes against the instance. */
  readonly countUnits: bigint;
}

export interface OrdinaryReservationRequest {
  readonly companyId: string;
  readonly authorisationId: string;
  readonly reservationId: string;
  readonly actionClass: string;
  readonly resourceRef: string;
  readonly exposure: ExposureBlock;
  readonly windows: readonly WindowTarget[];
  readonly at: Date;
  readonly participatesInJournal?: boolean;
}

export interface StandingWindowTarget extends WindowTarget {
  /** `standing_cap(s, w)`, computed by standingCap.ts from `51 §3.2`'s formula. */
  readonly standingCap: Money;
  /** `24 §3.1`'s in-scope rule, decided by the caller from the interval. */
  readonly instanceInScope: boolean;
}

export interface RateClassAuthorisationRequest {
  readonly companyId: string;
  readonly authorisationId: string;
  readonly reservationId: string;
  readonly actionClass: string;
  readonly resourceRef: string;
  readonly exposure: ExposureBlock;
  readonly standingAuthorizationId: string;
  readonly revocationAuthorityId: string;
  readonly revocationEffectClass: string;
  readonly adapter: string;
  readonly rateAmount: Money;
  readonly rateCurrency: string;
  readonly ratePeriod: string;
  readonly createdAt: Date;
  readonly expiresAt: Date;
  readonly cessationGraceHours: number;
  readonly windows: readonly StandingWindowTarget[];
  readonly participatesInJournal?: boolean;
}

export interface ReservationResult {
  readonly verdict: 'PERMIT';
  readonly reservationId: string;
  readonly journalSeq: bigint | null;
}

/**
 * Step R, ordinary non-rate branch. Reserves `total_exposure` into I3 term 1.
 *
 * The caller owns the transaction. This function assumes it is inside one and does not
 * open, commit or roll back — `26 §2.1.3` and `24 §3` K5 both turn on exactly which
 * writes share a commit point, so that boundary belongs to the caller and is visible at
 * the call site.
 */
export async function reserveOrdinary(
  client: Client,
  request: OrdinaryReservationRequest,
): Promise<ReservationResult> {
  if (request.exposure.forwardIntegral !== null) {
    // `26 §2.1`: forward_integral is a rate-class field. A non-rate class carrying one
    // would be the TB-03 shape arriving from the other direction.
    throw new Error(
      'a non-rate class carries no forward_integral (26 §2.1, 26 §2.1.3); ' +
        'this is a construction defect, not a denial',
    );
  }

  await acquireMoneyPathLocks(client, {
    companyId: request.companyId,
    windowInstances: request.windows.map((w) => ({
      windowId: w.instance.windowId,
      windowInstanceKey: w.instance.key,
    })),
    includeStandingRows: false,
    includeJournalCounter: request.participatesInJournal ?? false,
  });

  await client.query(
    `INSERT INTO exposure_reservation (
       reservation_id, company_id, authorisation_id, action_class, resource_ref,
       amount, vendor_amount, forward_integral, is_rate_class, created_at)
     VALUES ($1, $2, $3, $4, $5, $6::NUMERIC, $7::NUMERIC, NULL, false, $8)`,
    [
      request.reservationId,
      request.companyId,
      request.authorisationId,
      request.actionClass,
      request.resourceRef,
      toDb(request.exposure.totalExposure),
      request.exposure.vendorAmount === null ? null : toDb(request.exposure.vendorAmount),
      request.at,
    ],
  );

  try {
    for (const target of request.windows) {
      await client.query(
        `INSERT INTO reservation_window_instance
           (reservation_id, company_id, window_id, window_instance_key, amount)
         VALUES ($1, $2, $3, $4, $5::NUMERIC)`,
        [
          request.reservationId,
          request.companyId,
          target.instance.windowId,
          target.instance.key,
          toDb(request.exposure.totalExposure),
        ],
      );
      await applyReservation(
        client,
        request.companyId,
        target.instance.windowId,
        target.instance.key,
        request.exposure.totalExposure,
        target.countUnits,
      );
    }
  } catch (error) {
    asDenial(error);
  }

  const journalSeq = (request.participatesInJournal ?? false)
    ? await allocateJournalSeq(client, request.companyId)
    : null;

  return { verdict: 'PERMIT', reservationId: request.reservationId, journalSeq };
}

/**
 * Step R, rate branch. One transaction; the zero-amount reservation row and the
 * standing_window_exposure rows commit together.
 *
 * `26 §2.1.3`, verbatim: "The zero-amount reservation row and the
 * standing_window_exposure row are written in one transaction, under the window_balance
 * FOR UPDATE lock taken first in the declared order, and the commitment guard evaluates
 * the four-term sum once, after both. There is no interval in which the standing term is
 * absent and the reservation is zero."
 */
export async function authoriseRateClass(
  client: Client,
  request: RateClassAuthorisationRequest,
): Promise<ReservationResult> {
  if (!isZero(request.exposure.totalExposure)) {
    // `26 §2.1.3`'s field table. Not a denial: a rate class whose total_exposure is not
    // 0.00 has been constructed wrongly, and softening that into WINDOW_EXHAUSTED would
    // hide the defect behind a plausible denial.
    throw new Error(
      `a rate class has total_exposure = 0.00 (26 §2.1.3); got ` +
        `${toDb(request.exposure.totalExposure)}`,
    );
  }
  if (request.exposure.vendorAmount !== null) {
    throw new Error('a rate class has vendor_amount = NULL (26 §2.1.3, I18a null branch)');
  }

  // 1. Locks, in the declared order, taken FIRST.
  await acquireMoneyPathLocks(client, {
    companyId: request.companyId,
    windowInstances: request.windows.map((w) => ({
      windowId: w.instance.windowId,
      windowInstanceKey: w.instance.key,
    })),
    includeStandingRows: true,
    includeJournalCounter: request.participatesInJournal ?? false,
  });

  // 2. The StandingRevocationAuthority. `24 §3` K5 / I55: "Created by the kernel
  //    atomically with the StandingAuthorization, so one cannot exist without the
  //    other." S1A creates the row and none of its dispatch path.
  await client.query(
    `INSERT INTO standing_revocation_authority (
       revocation_authority_id, company_id, standing_authorization_id,
       action_class_selector, resource_selector, per_action_max_monetary,
       expires_at, created_by)
     VALUES ($1, $2, $3, $4, $5, 0.00, $6, 'KERNEL')`,
    [
      request.revocationAuthorityId,
      request.companyId,
      request.standingAuthorizationId,
      request.revocationEffectClass,
      request.resourceRef,
      new Date(
        request.expiresAt.getTime() + request.cessationGraceHours * 3_600_000,
      ),
    ],
  );

  // 3. The StandingAuthorization.
  await client.query(
    `INSERT INTO standing_authorization (
       standing_authorization_id, company_id, action_class, resource_ref, adapter,
       rate_amount, rate_currency, rate_period,
       created_at, expires_at, cessation_grace_hours,
       revocation_effect_class, revocation_authority_id, status)
     VALUES ($1, $2, $3, $4, $5, $6::NUMERIC, $7, $8, $9, $10, $11, $12, $13, 'LIVE')`,
    [
      request.standingAuthorizationId,
      request.companyId,
      request.actionClass,
      request.resourceRef,
      request.adapter,
      toDb(request.rateAmount),
      request.rateCurrency,
      request.ratePeriod,
      request.createdAt,
      request.expiresAt,
      request.cessationGraceHours,
      request.revocationEffectClass,
      request.revocationAuthorityId,
    ],
  );

  // 4. The REAL zero-amount reservation row. I2 is satisfied without a carve-out;
  //    I18b holds exactly at 0.00. `forward_integral` is recorded on the row as a
  //    SEPARATE field — `phase2-v1.3.1-errata.md §1`: "a separate field that is not a
  //    component of total_exposure".
  await client.query(
    `INSERT INTO exposure_reservation (
       reservation_id, company_id, authorisation_id, action_class, resource_ref,
       amount, vendor_amount, forward_integral, is_rate_class, created_at)
     VALUES ($1, $2, $3, $4, $5, 0.00, NULL, $6::NUMERIC, true, $7)`,
    [
      request.reservationId,
      request.companyId,
      request.authorisationId,
      request.actionClass,
      request.resourceRef,
      request.exposure.forwardIntegral === null
        ? null
        : toDb(request.exposure.forwardIntegral),
      request.createdAt,
    ],
  );

  try {
    for (const target of request.windows) {
      // The zero-amount reservation is real state against every referenced instance.
      await client.query(
        `INSERT INTO reservation_window_instance
           (reservation_id, company_id, window_id, window_instance_key, amount)
         VALUES ($1, $2, $3, $4, 0.00)`,
        [
          request.reservationId,
          request.companyId,
          target.instance.windowId,
          target.instance.key,
        ],
      );
      // reserved_monetary moves by 0.00; the count ledger still moves, because a rate
      // class is a governed action and `51 §2`'s count ceilings still bind it.
      await applyReservation(
        client,
        request.companyId,
        target.instance.windowId,
        target.instance.key,
        ZERO,
        target.countUnits,
      );

      // 5. The standing_window_exposure row. Its generated forward_monetary is summed
      //    into window_balance.standing_monetary by the sync trigger IN THIS STATEMENT,
      //    so the four-term guard sees the standing term before this transaction can
      //    commit. This is I3 term 2, and it is the whole of the rate class's economic
      //    exposure.
      await client.query(
        `INSERT INTO standing_window_exposure (
           standing_authorization_id, window_id, window_instance_key, company_id,
           standing_cap_monetary, realised_monetary, instance_in_scope)
         VALUES ($1, $2, $3, $4, $5::NUMERIC, 0.00, $6)`,
        [
          request.standingAuthorizationId,
          target.instance.windowId,
          target.instance.key,
          request.companyId,
          toDb(target.standingCap),
          target.instanceInScope,
        ],
      );
    }
  } catch (error) {
    asDenial(error);
  }

  const journalSeq = (request.participatesInJournal ?? false)
    ? await allocateJournalSeq(client, request.companyId)
    : null;

  return { verdict: 'PERMIT', reservationId: request.reservationId, journalSeq };
}
