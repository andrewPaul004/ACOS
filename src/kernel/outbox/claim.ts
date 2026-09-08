import { randomUUID } from 'node:crypto';

import { inTransaction, type Client, type Pool } from '../../db/pool.js';
import { fromDb, type Money } from '../exposure/money.js';
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
 * `30 §5.1` row 3's operand, and THE ONE LEG S1I REPORTS PARTIAL — `S1I-C1`.
 *
 * =================================================================================
 * WHAT ROW 3 NEEDS, AND WHAT v1.3.3 DOES NOT DECLARE.
 *
 * Row 3 matches on "Clock-bearing (a live statutory clock citing a RECORD-grade fact,
 * `§9.1`) and `recoverability == COMPENSABLE`". `30 §9.1` gives the clock's shape:
 *
 *   Clock { id, statute, case_ref, started_at, deadline_at, source_record_ref }
 *
 * The accepted `isClockBearingOn` answers "is there a live RECORD-backed clock for THIS
 * `case_ref`". SO THE OPERAND IS KEYED ON `case_ref`.
 *
 * **v1.3.3 DECLARES NO BINDING FROM AN EFFECT TO A `case_ref`.** Not in `30 §9.1`, not in
 * `26 §5`, not in `26 §2.1`'s `AuthorizationRequest` field list, not in `24 §3` K10, and
 * not in `24 §4`'s ERD. `case_ref` is a free identifier in the clock table and nothing
 * relates it to an `effect`, an `authorisation`, a `resource_ref` or a `task_id`.
 *
 * WHY THAT MATTERS EXACTLY HERE, AND WHY IT IS NOT COSMETIC. Row 3 is the ONLY relaxation
 * in the architecture — `30 §9.1`: "the statutory clock is a lever on the audit plane and
 * its provenance is a security property rather than a compliance detail." A COMPENSABLE
 * discretionary effect suspends at row 4; the SAME effect, declared clock-bearing,
 * DISPATCHES at row 3 in `NORMAL` and `CORROBORATED_DEGRADED`. So a claim-time
 * `case_ref` chosen by the caller — or guessed by the kernel from `resource_ref` — would be
 * precisely the lever `30 §9.1` exists to close: "a model that can cause a clock to exist
 * can manufacture the row-3 exemption it wants", and a model that can cause the kernel to
 * LOOK UP THE WRONG CLOCK obtains the same exemption without needing to create one.
 *
 * S1H did not surface this because `classifyDispatchPrecedence` is pure and its tests hand
 * it the operand directly. S1I is the first slice that must DERIVE it from state.
 *
 * `§51` OF THE S1I MANDATE: "Stop and return PARTIAL rather than guessing if v1.3.3 does
 * not specify a required load-bearing point such as [...] claim-time approval/mirror
 * revalidation." This is that stop, taken in the fail-closed direction: the operand is
 * `false`, so no claim is ever made at row 3, a COMPENSABLE effect falls to row 4 and
 * SUSPENDS unless an in-scope override restores it, and no relaxation is obtained that the
 * architecture has not authorised.
 *
 * `docs/implementation/S1I-owner-clarifications.md` `S1I-C1` records the gap and the two
 * candidate resolutions. `docs/implementation/S1I-result.md §9` reports the row-3
 * claim-time leg PARTIAL.
 *
 * THE FUNCTION TAKES NO ARGUMENTS AND RETURNS A CONSTANT, ON PURPOSE. A parameter would be
 * the escape hatch; a lookup keyed on a guessed `case_ref` would be the lever. Neither
 * exists.
 * =================================================================================
 */
export function clockBearingAtClaim(): boolean {
  return false;
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

  const decision = classifyDispatchPrecedence({
    mirrorState: mirror.mirrorState,
    actionClass: operands.action_class,
    recoverability: operands.recoverability,
    // `S1I-C1`. The row-3 operand v1.3.3 declares no binding for, read in the fail-closed
    // direction. See `clockBearingAtClaim` above.
    clockBearing: clockBearingAtClaim(),
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

  // `DISPATCH_ELIGIBLE`. `matchedRow` is 3, 4 or 5 — rows 1 and 2 halt in every state
  // (`22 §3.1`) and are unreachable by override (`30 §5.1` item 5), so the narrowing below
  // is an assertion the classifier already guarantees.
  const matchedRow = decision.matchedRow;
  if (matchedRow !== 3 && matchedRow !== 4 && matchedRow !== 5) {
    throw new Error(
      `classifier returned DISPATCH_ELIGIBLE at row ${String(matchedRow)}, which 30 §5.1 ` +
        'item 4 and 22 §3.1 make impossible',
    );
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
                                $14, $15)`,
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
            claim_override_id = $9
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
