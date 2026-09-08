import { randomUUID } from 'node:crypto';

import { inTransaction, type Client, type Pool } from '../../db/pool.js';
import { fromDb, type Money } from '../exposure/money.js';
import { isClockBearingOn, selectEvidentiaryClockOn } from '../clocks/statutoryClock.js';
import { activeOverrideOn, claimOverrideAllowanceOn } from '../mirror/degradedModeOverride.js';
import { classifyDispatchPrecedence, type PrecedenceDecision } from '../mirror/dispatchPrecedence.js';
import { mirrorDispatchOperandsOn } from '../mirror/mirrorStateMachine.js';
import type { ActionClass, Recoverability } from '../canonicalisation/actionCatalogue.js';
import {
  OUTBOX_COLUMNS,
  toOutboxRow,
  type ClaimRefusal,
  type ClaimingRow,
  type OutboxDbRow,
  type OutboxRow,
} from './outboxState.js';

/**
 * THE EXCLUSIVE DURABLE CLAIM. The strongest thing S1I does, and the last thing it does.
 *
 * =================================================================================
 * THE PROPERTY, IN THE ARCHITECTURE'S WORDS
 *
 * `25 §7`: "The row transitions to `CLAIMED` in a committed transaction **before** the
 * HTTP call, and a `CLAIMED` row is never re-dispatched by any path — including recovery,
 * including a fork, including a manual replay."
 *
 * Registry `I36`: "No outbox row transitions from `CLAIMED` to a second dispatch, by any
 * path. | Control | **DB (state machine constraint)** | Dispatch refused."
 *
 * THE ENFORCEMENT IS THE DATABASE, NOT THIS FILE. `0010`'s
 * `dispatch_outbox_state_machine` trigger refuses every UPDATE to a `CLAIMED` row and
 * every transition that is not `ENQUEUED` → `CLAIMED`. This function is the trusted
 * SERVICE that decides whether the one permitted transition may happen; if it were
 * deleted, the schema would still refuse a second claim.
 * =================================================================================
 *
 * =================================================================================
 * WHERE THIS FUNCTION STOPS. IT DOES NOT DISPATCH AND CANNOT.
 *
 * It returns a claim. `30 §5.1` item 3's ordering block has one more arrow after the one
 * this function serves — "dispatch, per (4)" — and S1I commits the claim and stops.
 *
 * There is no HTTP client, no adapter import, no vendor SDK, no credential and no endpoint
 * in this file or anywhere under `src/kernel/outbox/`.
 * `tests/integration/outbox/no-transport-boundary.test.ts` asserts each as an absence over
 * the whole of `src/`, and `§47`: S1I DOES NOT PROVIDE EXTERNAL EXACTLY-ONCE.
 * =================================================================================
 *
 * =================================================================================
 * ELIGIBILITY IS RE-EVALUATED HERE, AGAINST CURRENT STATE — `§13`, `§14`, `§33`.
 *
 * "An outbox row existing does NOT mean it can still be claimed." Between enqueue and
 * claim the mirror state can degrade or recover, a declaration can age past
 * `audit_unreachable_full_halt_threshold`, an override can be granted, expire, exhaust or
 * be revoked, and a clock can open or close. So every operand `30 §5.1` item 4 reads is
 * read HERE, INSIDE THIS TRANSACTION, FROM THE AUTHORITATIVE TABLES:
 *
 *   mirrorState, unreachableSince   `mirrorDispatchOperandsOn` — `mirror_declaration` and
 *                                   `mirror_corroboration`, read as a coherent pair.
 *   actionClass, recoverability     the committed `effect` row.
 *   totalExposure                   the committed `authorisation` row.
 *   hasRecordedApproval             the `approval` table.
 *   activeOverride                  `activeOverrideOn` — `degraded_mode_override`.
 *   now                             the caller's instant, which for the money path is the
 *                                   control database clock (`36 §6`).
 *
 * NONE OF THEM IS A PARAMETER OF THIS FUNCTION, AND NONE IS READ FROM THE OUTBOX ROW. The
 * outbox table has no eligibility column for a caller to have written one into — `0010`
 * adds none, deliberately — so `§14`'s attack ("unsafe implementation trusts
 * `eligible_at_enqueue = true`") has no field to trust. The vulnerable control that does
 * trust one is `tests/negative-controls/unsafe-stale-eligibility.ts` and it is TEST-ONLY.
 *
 * AND THE CLASSIFIER IS THE ACCEPTED S1H ONE. `§13`: "Do not create an alternate dispatch
 * precedence implementation." `classifyDispatchPrecedence` is imported, not reimplemented,
 * and `no-transport-boundary.test.ts` asserts `src/kernel/outbox/` contains no ordered row
 * evaluation of its own.
 * =================================================================================
 */

/**
 * `30 §5.1` row 3's operand, DERIVED — v1.3.4 (CSB-01), `30 §9.2.4`, `I65`.
 *
 * =================================================================================
 * WHAT THIS REPLACED, AND WHY THE REPLACEMENT IS NOT A RELAXATION
 *
 * S1I shipped this function taking NO ARGUMENTS and returning `false`, because
 * `S1I-C1` found that v1.3.3 declared no binding from an effect to a `case_ref` and row
 * 3's operand is keyed on one. That was the fail-closed stop `§51` of the S1I mandate
 * directs, not a design.
 *
 * `30 §9.2` now declares the binding, and `30 §9.2.4` declares the derivation:
 *
 *     "**`clock_bearing` is derived at the decision instant from CURRENT authoritative
 *      clock state.** It is never read from an enqueue-time boolean, never persisted as
 *      authority, and never accepted as a parameter. **The effect supplies exactly one
 *      thing: its immutable authoritative `case_ref`.**"
 *
 * So the operand is now TRUE where a legitimate qualifying clock exists, and row 3 is
 * reachable. What has not changed is that no caller can cause it: the binding is
 * kernel-derived by `0011`'s `effect_derive_case_ref` trigger, immutable under
 * `effect_append_only`, and read HERE from the committed `effect` row.
 * =================================================================================
 *
 * =================================================================================
 * THE SIGNATURE IS THE SECURITY PROPERTY. READ IT BEFORE THE BODY.
 *
 *   caseRef: string | null   — NOT a `case_ref` the caller chose. The ONLY value passed
 *                              here is `effect.case_ref`, read from the committed row in
 *                              the operand query below, in this transaction.
 *
 * There is no `clockBearing` parameter, no `clockId` parameter, no `preferClock` option
 * and no candidate list. `30 §9.2.1`: "a `case_ref` parameter on a claim surface is a
 * defect of the same class as a caller-supplied `clockBearing` boolean" — and
 * `claimForExternalDispatch`'s own input type has neither. `no-transport-boundary.test.ts`
 * asserts the exported surface against a hand-authored list, and
 * `tests/negative-controls/unsafe-caller-case-ref.ts` is the TEST-ONLY classifier that
 * takes one, as `§8` of the S1I owner-resolution mandate requires.
 *
 * THE ATTACK IT CLOSES, in `30 §9.2`'s words: "a model that can make the kernel look up
 * the WRONG clock obtains the exemption without needing to create one." `I56` closed
 * clock CREATION. This closes clock SELECTION.
 * =================================================================================
 *
 * =================================================================================
 * THE NULL CASE PERFORMS NO QUERY, WHICH IS THE POINT
 *
 * `30 §9.2.3`: "**A NULL `case_ref` never means 'search for any clock that fits.'** There
 * is no global clock search, no nearest-case match, no fallback and no heuristic. Absence
 * of a binding is a determinate `false`, not a query."
 *
 * The early return below IS that rule. It is not an optimisation and must not be
 * "simplified" into a query with a nullable predicate: a `WHERE case_ref = NULL` matches
 * nothing in SQL today, but a later edit to that predicate is one character away from
 * matching everything, and the shape that cannot go wrong is the shape that never asks.
 * =================================================================================
 *
 * =================================================================================
 * CURRENT STATE, BOTH DIRECTIONS, AND FAIL-CLOSED
 *
 * `isClockBearingOn` is the ACCEPTED S1H function and is imported rather than
 * reimplemented — `§13` of the S1I mandate: "Do not create an alternate dispatch
 * precedence implementation", and the same rule applies to its operands. It reads
 * `closed_at IS NULL AND deadline_at > now` joined to a RECORD-grade retained artifact,
 * so:
 *
 *   - a clock that OPENS between enqueue and claim makes row 3 apply;
 *   - a clock that CLOSES or EXPIRES makes row 3 stop applying;
 *   - a citation that ceases to resolve reads as NOT clock-bearing — fail closed, which
 *     is `I56`'s "a clock with an unresolvable `source_record_ref` is a critical
 *     incident" read in the safe direction;
 *   - a process restart changes none of the three, because nothing is cached anywhere.
 *
 * `outbox-claim-clock.test.ts` asserts all four.
 * =================================================================================
 */
export async function clockBearingAtClaim(
  client: Client,
  input: {
    readonly companyId: string;
    /** `effect.case_ref`, read from the committed row. Never a caller's value. */
    readonly caseRef: string | null;
    readonly now: Date;
  },
): Promise<boolean> {
  if (input.caseRef === null) return false;
  return isClockBearingOn(client, input.companyId, input.caseRef, input.now);
}

/** What a successful claim hands back. It is a RECORD, not a permission to send. */
export interface AcquiredClaim {
  readonly row: OutboxRow;
  /** `30 §5.1` item 4's matched row, as the classifier decided it at claim time. */
  readonly matchedRow: ClaimingRow;
  /** `30 §5.6`'s state at the instant of the claim. */
  readonly mirrorState: string;
  /** `30 §5.7.2` item 5 / `36 §6`. A REQUIREMENT carried forward, not a tag on anything. */
  readonly requiresUnmirroredTag: boolean;
  /** `30 §5.7.2` item 5's `override_id`, or null when no override was needed. */
  readonly overrideId: string | null;
  /**
   * `30 §9.2.5`'s evidentiary clock — the live statutory obligation that made row 3 the
   * reason this claim was permitted. NULL at every other matched row.
   *
   * v1.3.4 (CSB-01). It exists so a later audit can answer "which live statutory
   * obligation justified this?" and it is selected by the claim, never supplied.
   */
  readonly claimClockRef: string | null;
  /** The `OUTBOX_CLAIMED` journal row's sequence. `23 §6` B8. */
  readonly journalSeq: bigint;
  /** The full classifier decision, for the audit trail and for the tests. */
  readonly decision: PrecedenceDecision;
}

export type ClaimResult =
  | { readonly kind: 'CLAIMED'; readonly claim: AcquiredClaim }
  | {
      readonly kind: 'REFUSED';
      readonly reason: ClaimRefusal;
      readonly detail: string;
      /** Present when the classifier ran. Absent for `OUTBOX_ROW_NOT_FOUND`. */
      readonly decision?: PrecedenceDecision;
    };

interface ClaimOperandRow {
  readonly action_class: ActionClass;
  readonly recoverability: Recoverability;
  readonly total_exposure: string;
  readonly has_recorded_approval: boolean;
  /**
   * `effect.case_ref` — v1.3.4 (CSB-01), `30 §9.2`. Kernel-derived at INSERT by `0011`'s
   * `effect_derive_case_ref` trigger from the authoritative task, immutable under
   * `effect_append_only`, and read here from the committed row. NOT from the outbox row:
   * the outbox carries no case column, because a second copy is a second place the
   * binding could disagree with itself.
   */
  readonly case_ref: string | null;
}

/**
 * Claim one outbox row, inside the caller's transaction.
 *
 * =================================================================================
 * THE EXCLUSION MECHANISM, AND WHY IT IS NOT A MUTEX.
 *
 * `SELECT ... FOR UPDATE` on the outbox row, then a re-read of `status` UNDER THAT LOCK,
 * then the `UPDATE`. In PostgreSQL a second transaction reaching the same row's
 * `FOR UPDATE` BLOCKS until the first commits or rolls back, and then sees the row as the
 * first left it — so the loser reads `status = 'CLAIMED'` and returns `ALREADY_CLAIMED`.
 *
 * `§17` of the mandate forbids the alternatives explicitly and none is present: no
 * JavaScript mutex, no process singleton, no in-memory lock and no reliance on the test
 * being sequential. The exclusion is a row lock in a real database, and
 * `outbox-claim.test.ts` races two separate connections through an injected barrier —
 * `36 §14`'s "targeted interleaving with injected delays, plus a negative control", with
 * `tests/negative-controls/unsafe-select-then-update-claim.ts` as the control that returns
 * two claims under the same interleaving.
 *
 * `READ COMMITTED` IS SUFFICIENT AND IS THE CORRECT CHOICE. At `REPEATABLE READ` or
 * `SERIALIZABLE` the loser's `FOR UPDATE` would raise `40001` instead of reading the new
 * row version, which is also safe but converts a determinate `ALREADY_CLAIMED` into a
 * retryable error that a caller must then interpret. `33 §6` scopes the serialisable
 * requirement to the exposure ledger — "the only table with a serialisable-isolation
 * requirement" — and the claim moves no money.
 *
 * THE EXCLUSIVITY DOES NOT DEPEND ON `claim_id` — `§43`. What makes the claim exclusive is
 * the outbox row's own identity, `(company_id, idempotency_key)`, which is `25 §7`'s
 * deterministic effect idempotency key. `claim_id` is a LABEL on the one claim that
 * happened, minted after the exclusion has already been decided; a retry that lost the
 * race mints nothing and writes nothing.
 * =================================================================================
 *
 * =================================================================================
 * THE LOCK ORDER — `30 §5.2`, as resolved once in `src/kernel/exposure/lockOrder.ts`.
 *
 *   1. window_balance            — not touched. The claim moves no money (`§29`).
 *   2. standing_window_exposure  — not touched.
 *   3. dispatch_outbox row       FOR UPDATE
 *   4. degraded_mode_override    FOR UPDATE, inside `claimOverrideAllowanceOn`
 *   5. journal_counter           FOR UPDATE, last, inside the emitting SQL functions
 *
 * Steps 3 and 4 are `30 §5.2`'s "everything else", taken in a declared total order, and
 * step 5 is the counter LAST — the reading `lockOrder.ts` records as the resolution of
 * `30 §5.2`'s own internal contradiction, and the same order the ACCEPTED S1H
 * `claimOverrideAllowanceOn` already takes. No inversion against the S1F authorising
 * transaction exists, because that transaction never touches `dispatch_outbox`.
 * =================================================================================
 */
export async function claimForExternalDispatchOn(
  client: Client,
  input: {
    readonly companyId: string;
    readonly idempotencyKey: string;
    readonly claimedBy: string;
    readonly now: Date;
  },
  hooks?: {
    /** TEST-ONLY interleaving point, after the row lock and before the decision. */
    readonly afterLock?: () => Promise<void>;
  },
): Promise<ClaimResult> {
  const locked = await client.query<OutboxDbRow>(
    `SELECT ${OUTBOX_COLUMNS} FROM dispatch_outbox
      WHERE company_id = $1 AND idempotency_key = $2
      FOR UPDATE`,
    [input.companyId, input.idempotencyKey],
  );
  const dbRow = locked.rows[0];
  if (dbRow === undefined) {
    return {
      kind: 'REFUSED',
      reason: 'OUTBOX_ROW_NOT_FOUND',
      detail: `no outbox row for ${input.companyId}/${input.idempotencyKey}`,
    };
  }

  // The interleaving point. A HOOK rather than a sleep, because `36 §14` requires the race
  // to be constructed rather than hoped for. Production passes none, and
  // `no-transport-boundary.test.ts` asserts no production caller supplies one.
  if (hooks?.afterLock !== undefined) await hooks.afterLock();

  const row = toOutboxRow(dbRow);

  // `25 §7` / `I36`, checked under the row lock. THE DETERMINISTIC ALREADY-CLAIMED
  // OUTCOME — the loser of a race, a restarted process, the same worker asking twice, a
  // manual replay. There is no elapsed time and no parameter that changes this answer.
  if (row.status === 'CLAIMED') {
    return {
      kind: 'REFUSED',
      reason: 'ALREADY_CLAIMED',
      detail:
        `outbox row ${row.outboxId} was claimed at ${String(row.claimedAt?.toISOString())} ` +
        `under claim ${String(row.claimId)}; a CLAIMED row is never re-dispatched by any ` +
        'path (25 §7, I36)',
    };
  }

  // ---------------------------------------------------------------------------------
  // THE OPERANDS. Every one from an authoritative table, in this transaction.
  // ---------------------------------------------------------------------------------
  const operandRow = await client.query<ClaimOperandRow>(
    `SELECT e.action_class,
            e.recoverability,
            e.case_ref,
            a.total_exposure,
            (ap.approval_id IS NOT NULL) AS has_recorded_approval
       FROM effect e
       JOIN authorisation a ON a.authorisation_id = e.authorisation_id
       LEFT JOIN approval  ap ON ap.authorisation_id = e.authorisation_id
      WHERE e.effect_id = $1 AND e.company_id = $2`,
    [row.effectId, row.companyId],
  );
  const operands = operandRow.rows[0];
  if (operands === undefined) {
    // Unreachable: the outbox row's composite foreign key to `effect` guarantees the row
    // exists, and `effect` is append-only. An assertion, not a fallback.
    throw new Error(
      `outbox row ${row.outboxId} references effect ${row.effectId}, which did not resolve`,
    );
  }

  const mirror = await mirrorDispatchOperandsOn(client, row.companyId, input.now);
  const override = await activeOverrideOn(client, row.companyId, input.now);
  const totalExposure: Money = fromDb(operands.total_exposure);
  const clockBearing = await clockBearingAtClaim(client, {
    companyId: row.companyId,
    caseRef: operands.case_ref,
    now: input.now,
  });

  const decision = classifyDispatchPrecedence({
    mirrorState: mirror.mirrorState,
    actionClass: operands.action_class,
    recoverability: operands.recoverability,
    // `30 §5.1` row 3's operand, DERIVED from the effect's OWN immutable case binding
    // against CURRENT clock state, in this transaction. v1.3.4 (CSB-01), `30 §9.2.4`.
    // `S1I-C1`'s hard-coded `false` is gone; what replaced it takes no caller value.
    clockBearing,
    totalExposure,
    // Structurally `false` at S1I: `approval` rows are created only for an
    // `AWAITING_APPROVAL` effect (0007), only an `AUTHORISED` effect can be enqueued
    // (`dispatch_outbox_effect_is_authorised`), and `26 §12`'s resume that would turn the
    // first into the second is unbuilt. Read from the table anyway, so the operand is
    // correct by construction rather than by an argument about what cannot happen.
    hasRecordedApproval: operands.has_recorded_approval,
    activeOverride: override,
    unreachableSince: mirror.unreachableSince,
    now: input.now,
  });

  if (decision.disposition === 'HALT') {
    return {
      kind: 'REFUSED',
      reason: 'PRE_DISPATCH_HALTED',
      detail: decision.explanation,
      decision,
    };
  }
  if (decision.disposition === 'SUSPEND') {
    // NOTHING IS WRITTEN. `§14`'s reverse case: the row stays `ENQUEUED` and becomes
    // claimable again if every current prerequisite is later satisfied. The outbox does not
    // inherit a degraded-state classification.
    return {
      kind: 'REFUSED',
      reason: 'PRE_DISPATCH_SUSPENDED',
      detail: decision.explanation,
      decision,
    };
  }

  // ---------------------------------------------------------------------------------
  // `DISPATCH_ELIGIBLE`. `matchedRow` is 1, 3, 4 or 5.
  //
  // ROW 2 IS THE ONLY IMPOSSIBLE ONE: `22 §3.1` prints it Halt in every state and
  // `30 §5.1` item 5 makes it unreachable by override.
  //
  // ROW 1 BECAME POSSIBLE AT v1.3.4 (IRN-01, `30 §5.1b`) — in `NORMAL` only. The second
  // assertion below is what makes that narrow: a row-1 claim in a degraded state would
  // mean the classifier's state qualification had been lost, and `30 §5.1b` is explicit
  // that the correction touches `NORMAL` and nothing else.
  //
  // Both are ASSERTIONS the classifier already guarantees, not fallbacks. A fallback here
  // would be a second dispatch rule, which `§13` of the S1I mandate forbids.
  // ---------------------------------------------------------------------------------
  const matchedRow = decision.matchedRow;
  if (matchedRow === 2) {
    throw new Error(
      'classifier returned DISPATCH_ELIGIBLE at row 2, which 30 §5.1 item 4 row 2, item 5 ' +
        'and 22 §3.1 make impossible in every mirror state',
    );
  }
  if (matchedRow === 1 && mirror.mirrorState !== 'NORMAL') {
    throw new Error(
      `classifier returned DISPATCH_ELIGIBLE at row 1 in ${mirror.mirrorState}; 30 §5.1b ` +
        'makes row 1 eligible in NORMAL only and halted in both degraded states',
    );
  }

  // ---------------------------------------------------------------------------------
  // THE EVIDENTIARY CLOCK — `30 §9.2.5`, v1.3.4 (CSB-01), `I65`.
  //
  // "Where row 3 is the reason a dispatch decision resolved permissively, the selected
  //  `clock_ref` is persisted as evidence on that decision, so that a later audit can
  //  answer: which live statutory obligation justified this?"
  //
  // ONLY AT ROW 3, AND ONLY WHEN ROW 3 IS THE REASON. `30 §9.2.5`: "Where row 3 is not
  // the reason, the field is NULL or absent per the declared schema." `0011`'s
  // `dispatch_outbox_clock_evidence_is_row_3` CHECK is the biconditional that makes the
  // two agree, so a bug here is a constraint violation rather than a quiet wrong answer.
  //
  // THE SELECTION IS DETERMINISTIC AND IS NOT THIS FUNCTION'S. `selectEvidentiaryClockOn`
  // orders by earliest `deadline_at` then ascending `clock_id`, over the SAME qualifying
  // set `clockBearingAtClaim` counted — `30 §9.2.5`: "The selection does not change the
  // boolean." Nothing here re-decides eligibility; it names the clock behind an answer
  // already given.
  //
  // A NON-NULL `caseRef` IS GUARANTEED HERE. `matchedRow === 3` implies `clockBearing`
  // was true, which implies `operands.case_ref` was non-null — a NULL binding returns
  // `false` without a query. The narrowing below is that implication written down; the
  // throw is an assertion, not a fallback.
  // ---------------------------------------------------------------------------------
  let claimClockRef: string | null = null;
  if (matchedRow === 3) {
    if (operands.case_ref === null) {
      throw new Error(
        `classifier matched row 3 for effect ${row.effectId}, which carries no case ` +
          'binding; row 3 requires a live clock and a case-less effect is never ' +
          'clock-bearing (30 §9.2.3, §9.2.4)',
      );
    }
    const evidence = await selectEvidentiaryClockOn(
      client,
      row.companyId,
      operands.case_ref,
      input.now,
    );
    if (evidence === null) {
      // Unreachable: the same qualifying set was non-empty a few statements ago, in this
      // transaction, at this instant. An assertion for the same reason the operand
      // resolution below is one.
      throw new Error(
        `row 3 matched for effect ${row.effectId} on case ${operands.case_ref} but no ` +
          'qualifying live clock could be selected as evidence (30 §9.2.5)',
      );
    }
    claimClockRef = evidence.clockRef;
  }

  // ---------------------------------------------------------------------------------
  // THE OVERRIDE ALLOWANCE, TAKEN ATOMICALLY WITH THE CLAIM — `§31`, `§32`.
  //
  // `30 §5.7.2` item 3: "`effects_dispatched` and `monetary_dispatched` are incremented in
  // the dispatching transaction; reaching either cap moves the override to `EXHAUSTED`
  // immediately."
  //
  // THE CLAIM TRANSACTION IS THAT TRANSACTION, and it is the only candidate. The claim is
  // irreversible — no path returns a `CLAIMED` row to `ENQUEUED` — so after this commits
  // the effect WILL be handed to transport by whatever builds transport. If the counter
  // were incremented later, N rows could each be claimed against a cap of one and the
  // cap would bound nothing; `I63(a)`'s purpose requires the consumption to happen where
  // the commitment happens. `S1I-C3` records that v1.3.3 names "the dispatching
  // transaction" without defining which transaction that is in a slice with no dispatcher,
  // and that the ACCEPTED S1H `claimOverrideAllowanceOn` already reads it this way — its
  // own comment: "the transaction that WOULD dispatch, in a slice that has no dispatcher."
  //
  // `claimOverrideAllowanceOn` is IMPORTED, not reimplemented. It takes the override row
  // `FOR UPDATE`, checks `I63(a)`'s time box and both caps, checks `I63(b)`'s rolling
  // aggregate, journals `ALLOWANCE_TAKEN` and lets the database's own trigger derive
  // `EXHAUSTED`. `§32`'s race is therefore decided by a row lock on the override in the
  // same transaction as the row lock on the outbox.
  // ---------------------------------------------------------------------------------
  if (decision.overrideId !== null) {
    const allowance = await claimOverrideAllowanceOn(
      client,
      row.companyId,
      decision.overrideId,
      totalExposure,
      input.now,
    );
    if (allowance.kind === 'REFUSED') {
      return {
        kind: 'REFUSED',
        reason: 'OVERRIDE_ALLOWANCE_REFUSED',
        detail: allowance.reason,
        decision,
      };
    }
  }

  // `23 §6` B8: no effect reaches the outside without a committed record. The claim is the
  // last local record before one could, so it is journaled BEFORE the row is marked — in
  // the same transaction, so the two are one durable fact.
  const claimId = `claim:${randomUUID()}`;
  const emitted = await client.query<{ emit_outbox_claimed: string }>(
    `SELECT emit_outbox_claimed($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
                                $14, $15, $16)`,
    [
      row.companyId,
      row.outboxId,
      claimId,
      row.correlationTag,
      row.effectId,
      row.authorisationId,
      row.idempotencyKey,
      row.actionClass,
      row.resourceRef,
      row.dispatchPayloadHash,
      matchedRow,
      mirror.mirrorState,
      decision.requiresUnmirroredTag,
      decision.overrideId,
      // Field 18 of `30 §5.3a`'s declared order, between `override_id` and `occurred_at`.
      claimClockRef,
      input.now,
    ],
  );

  const claimed = await client.query<OutboxDbRow>(
    `UPDATE dispatch_outbox
        SET status = 'CLAIMED',
            claim_id = $3,
            claimed_at = $4,
            claimed_by = $5,
            claim_matched_row = $6,
            claim_mirror_state = $7,
            claim_requires_unmirrored_tag = $8,
            claim_override_id = $9,
            claim_clock_ref = $10
      WHERE company_id = $1 AND idempotency_key = $2 AND status = 'ENQUEUED'
      RETURNING ${OUTBOX_COLUMNS}`,
    [
      input.companyId,
      input.idempotencyKey,
      claimId,
      input.now,
      input.claimedBy,
      matchedRow,
      mirror.mirrorState,
      decision.requiresUnmirroredTag,
      decision.overrideId,
      claimClockRef,
    ],
  );
  const updated = claimed.rows[0];
  if (updated === undefined) {
    // `AND status = 'ENQUEUED'` matched nothing while this transaction holds the row lock.
    // Not reachable, and it is deliberately a THROW rather than a refusal: reaching it
    // would mean the row lock did not exclude, which is the one property this function
    // exists to have, and a silent refusal would hide it.
    throw new Error(
      `the claim UPDATE matched no ENQUEUED row for ${input.companyId}/` +
        `${input.idempotencyKey} while holding its row lock`,
    );
  }

  return {
    kind: 'CLAIMED',
    claim: {
      row: toOutboxRow(updated),
      matchedRow,
      mirrorState: mirror.mirrorState,
      requiresUnmirroredTag: decision.requiresUnmirroredTag,
      overrideId: decision.overrideId,
      claimClockRef,
      journalSeq: BigInt(emitted.rows[0]!.emit_outbox_claimed),
      decision,
    },
  };
}

/**
 * Claim in its own transaction. THE ONLY PUBLIC CLAIM SURFACE.
 *
 * =================================================================================
 * THE CLAIM IS COMMITTED BEFORE IT IS RETURNED — `§18`.
 *
 * `inTransaction` issues `COMMIT` before its promise resolves, so by the time a caller
 * holds an `AcquiredClaim` the row is durably `CLAIMED` and a SEPARATE CONNECTION can see
 * it. `25 §7`: the transition happens "in a committed transaction **before** the HTTP
 * call".
 *
 * There is no uncommitted claim token anywhere in this module: the only value that names a
 * claim, `claim_id`, is minted inside the transaction that persists it and is returned only
 * after that transaction commits. `outbox-claim.test.ts` asserts the
 * visibility from a second pool connection.
 *
 * `§30` — THERE IS NO BYPASS. This module exports no `forceClaim`, no
 * `markClaimed`, no `claimWithoutEvaluation` and no options object with an eligibility
 * escape. `claimForExternalDispatchOn` performs the classification unconditionally: it is
 * not behind a flag, and the only additional parameter is a TEST-ONLY interleaving hook
 * that cannot skip a check because it runs before every check.
 * `no-transport-boundary.test.ts` asserts the exported surface of this directory against a
 * hand-authored list, and `tests/negative-controls/unsafe-force-claim.ts` is the bypass
 * that `§37` item 10 requires as a discriminating control.
 * =================================================================================
 */
export async function claimForExternalDispatch(
  control: Pool,
  input: {
    readonly companyId: string;
    readonly idempotencyKey: string;
    readonly claimedBy: string;
    readonly now: Date;
  },
  hooks?: { readonly afterLock?: () => Promise<void> },
): Promise<ClaimResult> {
  const client = await control.connect();
  try {
    return await inTransaction(client, 'READ COMMITTED', (tx) =>
      claimForExternalDispatchOn(tx, input, hooks),
    );
  } finally {
    client.release();
  }
}
