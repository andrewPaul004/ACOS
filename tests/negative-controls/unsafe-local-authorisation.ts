import type { Client } from '../../src/db/pool.js';
import { inTransaction } from '../../src/db/pool.js';
import { toDb, type Money } from '../../src/kernel/exposure/money.js';
import { hasSqlstate, SQLSTATE } from '../../src/kernel/exposure/errors.js';

/**
 * THE MANDATORY VULNERABLE NEGATIVE CONTROLS for S1F, isolated.
 *
 * TEST-ONLY. Nothing under `src/` imports this file, and
 * `tests/negative-controls/local-authorisation-controls.test.ts` asserts that by reading the
 * source tree.
 *
 * =====================================================================================
 * WHY THEY EXIST
 *
 * `36 §0`'s oracle discipline and `46 R1`: "a test that calls the same function twice
 * proves nothing." The S1F mandate states the same requirement in its own terms:
 *
 *   "At least the economically load-bearing controls must actually show the vulnerable
 *    implementation behaving incorrectly. Tests that merely assert production returns an
 *    enum are insufficient."
 *
 * A suite that only asserted `WINDOW_EXHAUSTED` on an exhausted window would be compatible
 * with an implementation that denied everything, reserved the wrong quantity against the
 * right window, or reserved the right quantity against one of two windows. Each function
 * below is the SAME transaction with exactly ONE thing wrong, and the paired case asserts
 * the two implementations DISAGREE on one fixture.
 *
 * PRODUCTION IS NOT WEAKENED TO ACCOMMODATE ANY OF THEM. No seam was opened, no field was
 * made settable and no check was made overridable. Each is a whole second writer living in
 * `tests/`, and that duplication is the point.
 *
 * Everything DOWNSTREAM of the one changed expression is production: the same real
 * PostgreSQL, the same `window_balance` table, the same `i3_commitment_guard` trigger, the
 * same `exposure_reservation` constraints. The only variable is the named defect.
 * =====================================================================================
 */

export interface UnsafeWindowTarget {
  readonly windowId: string;
  readonly windowInstanceKey: string;
}

export interface UnsafeReservationSpec {
  readonly companyId: string;
  readonly authorisationId: string;
  readonly reservationId: string;
  readonly actionClass: string;
  readonly resourceRef: string;
  readonly vendorAmount: Money;
  readonly totalExposure: Money;
  readonly windows: readonly UnsafeWindowTarget[];
  readonly at: Date;
  readonly countUnits: bigint;
}

export type UnsafeOutcome = 'COMMITTED' | 'WINDOW_EXHAUSTED';

/** Translate the production trigger's refusal, and nothing else. */
function classify(error: unknown): never | 'WINDOW_EXHAUSTED' {
  if (hasSqlstate(error, SQLSTATE.I3_WINDOW_EXHAUSTED)) return 'WINDOW_EXHAUSTED';
  throw error;
}

async function reserveAgainst(
  tx: Client,
  spec: UnsafeReservationSpec,
  amount: Money,
  windows: readonly UnsafeWindowTarget[],
): Promise<void> {
  await tx.query(
    `INSERT INTO exposure_reservation (
       reservation_id, company_id, authorisation_id, action_class, resource_ref,
       amount, vendor_amount, forward_integral, is_rate_class, created_at)
     VALUES ($1,$2,$3,$4,$5,$6::NUMERIC,$7::NUMERIC,NULL,false,$8)`,
    [
      spec.reservationId,
      spec.companyId,
      spec.authorisationId,
      spec.actionClass,
      spec.resourceRef,
      toDb(amount),
      toDb(spec.vendorAmount),
      spec.at,
    ],
  );
  for (const window of windows) {
    await tx.query(
      `INSERT INTO reservation_window_instance
         (reservation_id, company_id, window_id, window_instance_key, amount)
       VALUES ($1,$2,$3,$4,$5::NUMERIC)`,
      [
        spec.reservationId,
        spec.companyId,
        window.windowId,
        window.windowInstanceKey,
        toDb(amount),
      ],
    );
    await tx.query(
      `UPDATE window_balance
          SET reserved_monetary = reserved_monetary + $4::NUMERIC,
              reserved_count    = reserved_count + $5::BIGINT
        WHERE company_id = $1 AND window_id = $2 AND window_instance_key = $3`,
      [
        spec.companyId,
        window.windowId,
        window.windowInstanceKey,
        toDb(amount),
        spec.countUnits.toString(),
      ],
    );
  }
}

/**
 * DEFECT 1 — the reservation quantity is `vendor_amount` instead of `total_exposure`.
 *
 * `26 §2.1.1`, the rule being broken, verbatim:
 *
 *   "**And the consequence that matters most: no policy cap intended to bound economic loss
 *    may compare only against `vendor_amount`.**"
 *
 * Registry `I18b`, verbatim: "For every effect, `reservation.amount ==
 * exposure.total_exposure`, exactly, in the single ledger currency. **No tolerance.**"
 *
 * ONE EXPRESSION DIFFERS from the production step R:
 *
 *   production   amount = exposure.total_exposure
 *   unsafe       amount = exposure.vendor_amount
 *
 * The retained fee is money that does not come back. Reserving without it under-reserves
 * every refund by exactly the fee, forever, and the window's ceiling stops bounding the
 * loss it was signed to bound.
 */
export async function unsafeReserveVendorAmount(
  client: Client,
  spec: UnsafeReservationSpec,
): Promise<UnsafeOutcome> {
  try {
    await inTransaction(client, 'SERIALIZABLE', async (tx) => {
      // THE DEFECT: `spec.vendorAmount`, where production passes `spec.totalExposure`.
      await reserveAgainst(tx, spec, spec.vendorAmount, spec.windows);
    });
    return 'COMMITTED';
  } catch (error) {
    return classify(error);
  }
}

/**
 * DEFECT 2 — only ONE of the referenced windows is checked.
 *
 * `26 §7` step R, verbatim: reserves "against **every** named window instance the matching
 * grants reference [...] and fails if **any** lacks headroom."
 *
 * The accepted S1E owner ruling (S1E-C4): "window sets compose by UNION and step R must
 * reserve against every referenced applicable window."
 *
 * ONE EXPRESSION DIFFERS:
 *
 *   production   for (const window of every referenced instance)
 *   unsafe       for (const window of [the one named by `checkOnly`])
 *
 * `checkOnly` is a parameter so the SAME defect can be demonstrated in both directions —
 * with the day window passing and the month window exhausted, and with the roles reversed.
 * A hard-coded "first window" defect would only be visible in one of the two, and the S1F
 * mandate requires both.
 */
export async function unsafeReserveSingleWindow(
  client: Client,
  spec: UnsafeReservationSpec,
  checkOnly: string,
): Promise<UnsafeOutcome> {
  const only = spec.windows.filter((w) => w.windowId === checkOnly);
  if (only.length !== 1) {
    throw new Error(`the control needs exactly one window named ${checkOnly}`);
  }
  try {
    await inTransaction(client, 'SERIALIZABLE', async (tx) => {
      // THE DEFECT: one window, where production reserves against every one of them.
      await reserveAgainst(tx, spec, spec.totalExposure, only);
    });
    return 'COMMITTED';
  } catch (error) {
    return classify(error);
  }
}

export interface UnsafeRateSpec {
  readonly companyId: string;
  readonly authorisationId: string;
  readonly reservationId: string;
  readonly standingAuthorizationId: string;
  readonly revocationAuthorityId: string;
  readonly actionClass: string;
  readonly resourceRef: string;
  readonly revocationEffectClass: string;
  readonly adapter: string;
  readonly rateAmount: Money;
  readonly rateCurrency: string;
  readonly ratePeriod: string;
  readonly forwardIntegral: Money;
  readonly at: Date;
  readonly expiresAt: Date;
  readonly cessationGraceHours: number;
  readonly windows: readonly (UnsafeWindowTarget & { readonly standingCap: Money })[];
}

async function insertStandingPair(tx: Client, spec: UnsafeRateSpec): Promise<void> {
  await tx.query(
    `INSERT INTO standing_revocation_authority (
       revocation_authority_id, company_id, standing_authorization_id,
       action_class_selector, resource_selector, per_action_max_monetary,
       expires_at, created_by)
     VALUES ($1,$2,$3,$4,$5,0.00,$6,'KERNEL')`,
    [
      spec.revocationAuthorityId,
      spec.companyId,
      spec.standingAuthorizationId,
      spec.revocationEffectClass,
      spec.resourceRef,
      new Date(spec.expiresAt.getTime() + spec.cessationGraceHours * 3_600_000),
    ],
  );
  await tx.query(
    `INSERT INTO standing_authorization (
       standing_authorization_id, company_id, action_class, resource_ref, adapter,
       rate_amount, rate_currency, rate_period,
       created_at, expires_at, cessation_grace_hours,
       revocation_effect_class, revocation_authority_id, status)
     VALUES ($1,$2,$3,$4,$5,$6::NUMERIC,$7,$8,$9,$10,$11,$12,$13,'LIVE')`,
    [
      spec.standingAuthorizationId,
      spec.companyId,
      spec.actionClass,
      spec.resourceRef,
      spec.adapter,
      toDb(spec.rateAmount),
      spec.rateCurrency,
      spec.ratePeriod,
      spec.at,
      spec.expiresAt,
      spec.cessationGraceHours,
      spec.revocationEffectClass,
      spec.revocationAuthorityId,
    ],
  );
}

/**
 * DEFECT 3 — the rate class puts `forward_integral` into the ORDINARY reservation amount.
 *
 * This is TB-03, and `phase2-v1.3.1-errata.md §1` calls it "the blocking erratum". Verbatim:
 *
 *   "Read literally that places the forward integral in `I3` **term 1** while the
 *    `StandingAuthorization` places the same money in term 2. Because
 *    `W_MONTH_ADSPEND.max_monetary` equals `standing_cap` exactly, the double count denies
 *    the first `campaign.budget.set` the company ever attempts."
 *
 * ONE EXPRESSION DIFFERS:
 *
 *   production   amount = 0.00, forward_integral into standing_window_exposure only
 *   unsafe       amount = forward_integral, and the standing row is still written
 *
 * `is_rate_class` is written as FALSE here, because 0004's `rate_class_zero_reservation`
 * CHECK would refuse the row otherwise — which is itself the finding: the accepted S1A
 * schema already makes the literal TB-03 shape unrepresentable, and the only way to write
 * it is to lie about the class. The control does exactly that, so the defect it reproduces
 * is the one an implementer would actually have produced.
 */
export async function unsafeRateReservesForwardIntegral(
  client: Client,
  spec: UnsafeRateSpec,
): Promise<UnsafeOutcome> {
  try {
    await inTransaction(client, 'SERIALIZABLE', async (tx) => {
      await insertStandingPair(tx, spec);
      await tx.query(
        `INSERT INTO exposure_reservation (
           reservation_id, company_id, authorisation_id, action_class, resource_ref,
           amount, vendor_amount, forward_integral, is_rate_class, created_at)
         VALUES ($1,$2,$3,$4,$5,$6::NUMERIC,NULL,NULL,false,$7)`,
        [
          spec.reservationId,
          spec.companyId,
          spec.authorisationId,
          spec.actionClass,
          spec.resourceRef,
          // THE DEFECT: the forward integral as I3 term 1.
          toDb(spec.forwardIntegral),
          spec.at,
        ],
      );
      for (const window of spec.windows) {
        await tx.query(
          `INSERT INTO reservation_window_instance
             (reservation_id, company_id, window_id, window_instance_key, amount)
           VALUES ($1,$2,$3,$4,$5::NUMERIC)`,
          [
            spec.reservationId,
            spec.companyId,
            window.windowId,
            window.windowInstanceKey,
            toDb(window.standingCap),
          ],
        );
        await tx.query(
          `UPDATE window_balance
              SET reserved_monetary = reserved_monetary + $4::NUMERIC
            WHERE company_id = $1 AND window_id = $2 AND window_instance_key = $3`,
          [spec.companyId, window.windowId, window.windowInstanceKey, toDb(window.standingCap)],
        );
        // And the standing row too — which is the DOUBLE COUNT: the same money in I3
        // term 1 and I3 term 2 at once.
        await tx.query(
          `INSERT INTO standing_window_exposure (
             standing_authorization_id, window_id, window_instance_key, company_id,
             standing_cap_monetary, realised_monetary, instance_in_scope)
           VALUES ($1,$2,$3,$4,$5::NUMERIC,0.00,true)`,
          [
            spec.standingAuthorizationId,
            window.windowId,
            window.windowInstanceKey,
            spec.companyId,
            toDb(window.standingCap),
          ],
        );
      }
    });
    return 'COMMITTED';
  } catch (error) {
    return classify(error);
  }
}

/**
 * DEFECT 4 — the zero-amount reservation row is OMITTED for a rate class.
 *
 * `26 §2.1.3`, verbatim: "**The declared model: a rate-setting action class is a documented
 * zero-monetary-reservation class.** Not a zero-*exposure* exemption — **the row exists**, so
 * `I2` is satisfied without a carve-out."
 *
 * Registry `I2`, verbatim: "Every `AuthorizationDecision` with verdict PERMIT has a
 * `Reservation`, or belongs to a documented zero-exposure action class. [...] **v1.2: the
 * `StandingRevocationAuthority` path creates a zero-amount reservation row, so it is not an
 * exemption.**"
 *
 * ONE STATEMENT IS MISSING: the `exposure_reservation` insert. Everything else — the
 * standing authorisation, its revocation authority, the standing window rows — is written.
 * The arithmetic still works, which is exactly why the omission is tempting; what breaks is
 * `I2`, and after S1F it breaks at the DATABASE, because `authorisation_decision.reservation_id`
 * is NOT NULL with a foreign key.
 */
export async function unsafeRateOmitsReservationRow(
  client: Client,
  spec: UnsafeRateSpec,
): Promise<UnsafeOutcome> {
  try {
    await inTransaction(client, 'SERIALIZABLE', async (tx) => {
      await insertStandingPair(tx, spec);
      // THE DEFECT: no exposure_reservation insert at all.
      for (const window of spec.windows) {
        await tx.query(
          `INSERT INTO standing_window_exposure (
             standing_authorization_id, window_id, window_instance_key, company_id,
             standing_cap_monetary, realised_monetary, instance_in_scope)
           VALUES ($1,$2,$3,$4,$5::NUMERIC,0.00,true)`,
          [
            spec.standingAuthorizationId,
            window.windowId,
            window.windowInstanceKey,
            spec.companyId,
            toDb(window.standingCap),
          ],
        );
      }
    });
    return 'COMMITTED';
  } catch (error) {
    return classify(error);
  }
}

/**
 * DEFECT 5 — the reservation and the decision commit in SEPARATE transactions.
 *
 * `33 §1`, the property being broken, verbatim: "The exposure reservation, the authorisation
 * decision, the effect journal row with its gap-free sequence and local chain hash, and the
 * resulting state transition **commit or fail together, as a single Postgres transaction.**"
 *
 * TWO `inTransaction` CALLS where production has one. The success path is
 * indistinguishable from production's — same rows, same values, same return — and that is
 * the finding: the ONLY observable difference is what a crash between them leaves behind.
 * `failBetween` is how the test causes that crash.
 */
export async function unsafeTwoTransactionCommit(
  client: Client,
  spec: UnsafeReservationSpec,
  decision: {
    readonly decisionId: string;
    readonly effectId: string;
    readonly idempotencyKey: string;
    readonly adapter: string;
    readonly recoverability: string;
    readonly principalId: string;
    readonly sessionId: string;
    readonly taskId: string;
    readonly resourceId: string;
  },
  failBetween: boolean,
): Promise<UnsafeOutcome> {
  // TRANSACTION ONE — the authorisation row and the reservation.
  await inTransaction(client, 'SERIALIZABLE', async (tx) => {
    await tx.query(
      `INSERT INTO authorisation (
         authorisation_id, company_id, principal_id, session_id, task_id,
         action_class, resource_ref, resource_id,
         dispatch_payload_hash, intent_hash, context_digest,
         constructor_id, constructor_semantic_major, constructor_non_semantic_minor,
         policy_version, vendor_amount, total_exposure, forward_integral, is_rate_class,
         recoverability, value_direction, autonomy_level, gate_class, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'h','h','h','c',1,0,'p',
               $9::NUMERIC,$10::NUMERIC,NULL,false,$11,'INBOUND_ORIGINAL_INSTRUMENT',
               'L3_OPERATIONAL','UNGATED_LOGGED',$12)`,
      [
        spec.authorisationId,
        spec.companyId,
        decision.principalId,
        decision.sessionId,
        decision.taskId,
        spec.actionClass,
        spec.resourceRef,
        decision.resourceId,
        toDb(spec.vendorAmount),
        toDb(spec.totalExposure),
        decision.recoverability,
        spec.at,
      ],
    );
    await reserveAgainst(tx, spec, spec.totalExposure, spec.windows);
  });

  // THE CRASH the two-transaction shape admits and the one-transaction shape cannot.
  if (failBetween) return 'COMMITTED';

  // TRANSACTION TWO — the effect, the decision and the journal row.
  await inTransaction(client, 'SERIALIZABLE', async (tx) => {
    await tx.query(
      `INSERT INTO effect (
         company_id, idempotency_key, effect_id, authorisation_id,
         action_class, resource_ref, adapter, recoverability, gate_class, status, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'UNGATED_LOGGED','AUTHORISED',$9)`,
      [
        spec.companyId,
        decision.idempotencyKey,
        decision.effectId,
        spec.authorisationId,
        spec.actionClass,
        spec.resourceRef,
        decision.adapter,
        decision.recoverability,
        spec.at,
      ],
    );
    await tx.query(
      `INSERT INTO authorisation_decision (
         decision_id, company_id, authorisation_id, effect_id, reservation_id,
         approval_id, verdict, approval_requirement,
         constructor_semantic_major, constructor_non_semantic_minor, policy_version,
         decided_at, signed_bytes_hash, signature, signing_key_id)
       VALUES ($1,$2,$3,$4,$5,NULL,'PERMIT','NONE',1,0,'p',$6,'h',
               decode(repeat('00',64),'hex'),'k')`,
      [
        decision.decisionId,
        spec.companyId,
        spec.authorisationId,
        decision.effectId,
        spec.reservationId,
        spec.at,
      ],
    );
  });
  return 'COMMITTED';
}

/**
 * DEFECT 6 — the journal counter is acquired FIRST, and the window rows afterwards.
 *
 * `30 §5.2`, the declared order, verbatim:
 *
 *   "**1. `window_balance` rows, `FOR UPDATE`, ascending `window_id`. 2.
 *    `journal_counter(company_id)`, `FOR UPDATE`. 3. Everything else.**"
 *
 * and, on why the counter is last, verbatim: "The counter is taken **last** because it is
 * the most contended and holding it across the balance checks would serialise every company
 * operation behind the slowest one."
 *
 * `30 §5.2` also names the consequence of an unstated order: "adding a per-company counter
 * to an unstated order is a deadlock waiting for the first concurrent refund on the same
 * order."
 *
 * ONE ORDERING DIFFERS: the counter is locked before the balance rows. Run against a
 * concurrent transaction taking the DECLARED order, the two cycle and PostgreSQL raises
 * `40P01`.
 */
export async function unsafeJournalCounterFirst(
  client: Client,
  companyId: string,
  windows: readonly UnsafeWindowTarget[],
  betweenLocks: () => Promise<void>,
): Promise<'COMMITTED' | 'DEADLOCK'> {
  try {
    await inTransaction(client, 'SERIALIZABLE', async (tx) => {
      // THE DEFECT: the counter FIRST.
      await tx.query(`SELECT next_seq FROM journal_counter WHERE company_id = $1 FOR UPDATE`, [
        companyId,
      ]);
      await betweenLocks();
      for (const window of windows) {
        await tx.query(
          `SELECT window_id FROM window_balance
            WHERE company_id = $1 AND window_id = $2 AND window_instance_key = $3
              FOR UPDATE`,
          [companyId, window.windowId, window.windowInstanceKey],
        );
      }
    });
    return 'COMMITTED';
  } catch (error) {
    if (hasSqlstate(error, SQLSTATE.DEADLOCK_DETECTED)) return 'DEADLOCK';
    throw error;
  }
}

/**
 * DEFECT 7 — a duplicate is detected by a SELECT instead of by the unique constraint.
 *
 * `33 §6`, verbatim: "`effects` primary key includes the idempotency key with a unique
 * constraint (I42), **so a duplicate proposal cannot create a second row even if every
 * layer above it fails.**"
 *
 * ONE MECHANISM DIFFERS:
 *
 *   production   INSERT, and let the primary key decide
 *   unsafe       SELECT first; if absent, reserve and INSERT
 *
 * Sequentially the two are indistinguishable. Concurrently they are not: two transactions
 * can both pass the SELECT, and at `SERIALIZABLE` on DIFFERENT window rows nothing forces
 * either to abort — so both reserve, and the same intent consumes exposure twice.
 * `betweenCheckAndInsert` is the interleaving point.
 */
export async function unsafeDuplicateCheckBySelect(
  client: Client,
  spec: UnsafeReservationSpec,
  idempotencyKey: string,
  betweenCheckAndInsert: () => Promise<void>,
): Promise<'COMMITTED' | 'DUPLICATE' | 'WINDOW_EXHAUSTED'> {
  try {
    return await inTransaction(client, 'SERIALIZABLE', async (tx) => {
      // THE DEFECT: a read-then-write check.
      const seen = await tx.query(
        `SELECT 1 FROM effect WHERE company_id = $1 AND idempotency_key = $2`,
        [spec.companyId, idempotencyKey],
      );
      await betweenCheckAndInsert();
      if (seen.rows.length > 0) return 'DUPLICATE';
      await reserveAgainst(tx, spec, spec.totalExposure, spec.windows);
      return 'COMMITTED';
    });
  } catch (error) {
    return classify(error);
  }
}
