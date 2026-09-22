import { inTransaction, type Client, type Pool } from '../../db/pool.js';
import type { Recoverability } from '../canonicalisation/actionCatalogue.js';
import {
  applyIrrecoverablePresumption,
  readBoundReservationWindows,
  releaseIrrecoverableReservation,
  releaseMonetaryReservation,
  type BoundReservationWindow,
} from '../exposure/ledger.js';
import { acquireMoneyPathLocks } from '../exposure/lockOrder.js';
import { withSerialisationRetry } from '../exposure/retry.js';
import {
  readDispatchAttestation,
  type DispatchAttestation,
  type DispatchIdentity,
} from './dispatchCapability.js';
import {
  movesLedger,
  outcomePolicyFor,
  type EconomicMovement,
  type PostDispatchEffectStatus,
  type UndeclaredPolicyReason,
} from './outcomePolicy.js';
import type { AdapterOutcomeKind } from './adapterPort.js';

/**
 * THE LOCAL OUTCOME TRANSACTION — `§20` OF THE S1J MANDATE, COMPLETED BY v1.3.5.
 *
 * =================================================================================
 * ONE TRANSACTION, AND EXACTLY WHAT IS IN IT
 *
 * "All local consequences of ONE adapter result must commit atomically where architecture
 *  requires. [...] Use ONE PostgreSQL transaction for mutually dependent local state."
 *
 * `25 §10.1` names the contents for the irrecoverable case and requires them to share a
 * commit point, verbatim:
 *
 *   "It is `reserved → presumed` for every bound window instance, performed **exactly once**
 *    per outbox identity, **in the same serializable local transaction as the effect state,
 *    the outbox outcome state, the outcome journal row and the claim/outcome evidence.**"
 *
 * The contents, and the architecture that puts each one there:
 *
 *   the outcome row          `effect_dispatch_outcome`, carrying the post-dispatch effect
 *                            status. `0012`'s header records why it is a separate row: a
 *                            column on `dispatch_outbox` would need a second transition out
 *                            of `CLAIMED`, and `25 §7` OBX-01 admits none.
 *
 *   the journal row          `DISPATCH_OUTCOME`. `23 §6` B8 — "no effect originating in
 *                            reasoning can occur that is not recorded" — read one step
 *                            past the claim.
 *
 *   the MIE ledger           `25 §10.1`'s PRESUME row, or its confirmed-not-sent RELEASE
 *                            row. WRITTEN HERE, in this transaction, on every bound window
 *                            instance. This is what v1.3.5 added and what the accepted S1J
 *                            returned PARTIAL for.
 *
 *   the money reservation    RELEASED on `NOT_SENT_CONFIRMED` and on nothing else
 *                            (`25 §7.2`). On every other branch NOT WRITTEN — `35 §4`:
 *                            "The exposure reservation **remains held**. It is not released
 *                            on timeout". Holding is the absence of a write.
 *
 *   the outbox row           NOT WRITTEN, ON ANY BRANCH. `0010`'s trigger refuses every
 *                            UPDATE to a `CLAIMED` row, and `25 §7.1`'s "**ONCE A ROW IS
 *                            `CLAIMED`, THE SAME OUTBOX IDENTITY IS NEVER RETRIED OR
 *                            REDISPATCHED, ON ANY OUTCOME**" is therefore true because
 *                            nothing here touches it.
 * =================================================================================
 *
 * =================================================================================
 * THE ISOLATION IS CHOSEN BY THE MOVEMENT, AND ASSERTED AT THE CONNECTION
 *
 * `33 §6` scopes the serialisable requirement to the exposure ledger, "the only table with
 * a serialisable-isolation requirement", and `25 §10.1` requires the PRESUME row to be in a
 * "serializable local transaction". So:
 *
 *   moves the ledger   SERIALIZABLE, with `30 §5.2`'s lock order and bounded `40001` retry
 *   moves nothing      READ COMMITTED, exactly as the ACCEPTED S1J outcome transaction
 *
 * READ COMMITTED IS RETAINED FOR THE NON-MOVING BRANCHES DELIBERATELY, for the reason the
 * accepted implementation gave: "at `REPEATABLE READ` the loser of a race would raise
 * `40001` instead of reading the committed prior outcome, which converts a determinate
 * answer into a retryable error." A branch that moves no ledger term has no write skew to
 * prevent, and a determinate `alreadyResolved` is worth more than an isolation level it
 * does not need.
 *
 * `33 §6`, verbatim, on why the assertion exists at all: "isolation is set and asserted at
 * the connection", because "@transaction at default isolation silently reintroduces write
 * skew on the SUM". `assertSerialisable` below is that assertion, and it is the same one
 * the accepted S1F local-authorisation transaction makes.
 * =================================================================================
 *
 * =================================================================================
 * THE LOCK ORDER — `30 §5.2`, AND `30 §5.1`'s OWN BLOCK FOR THIS TRANSACTION
 *
 * `30 §5.1` (v1.3.5) prints the outcome transaction's locks:
 *
 *     BEGIN
 *       SELECT ... FOR UPDATE on window_balance rows, ascending window_id   -- §5.2, where
 *                                         -- the outcome moves the MIE ledger (25 §10.1)
 *       SELECT ... FOR UPDATE on journal_counter(company_id)                -- last
 *       outcome row + journal row (DISPATCH_OUTCOME) + the declared ledger movement
 *     COMMIT
 *
 * and states the rule: "**The outcome transaction takes the money-path lock order where —
 * and only where — it moves the ledger.** [...] **There is one lock order in the system and
 * the outcome transaction obeys it.** An outcome reaching an awaiting-verification or
 * outcome-unknown state moves no ledger term and takes no balance lock."
 *
 * The implemented order is therefore:
 *
 *   1. window_balance rows      FOR UPDATE, ascending (window_id, window_instance_key)
 *                               — ONLY where the movement is non-`NONE`
 *   2. standing_window_exposure — not touched. No standing term moves on any outcome.
 *   3. dispatch_outbox row      FOR UPDATE      — `30 §5.2`'s "everything else"
 *   4. journal_counter          FOR UPDATE, LAST, inside `emit_dispatch_outcome`
 *
 * NO INVERSION EXISTS AGAINST EITHER OTHER WRITER. The S1I claim transaction takes
 * `dispatch_outbox` then the counter and never takes `window_balance`; the S1F authorising
 * transaction takes `window_balance` then the counter and never takes `dispatch_outbox`.
 * So no cycle is constructible, and `40P01` from this path remains an INVARIANT DEFECT that
 * `retry.ts` propagates rather than retries (S1A-H2).
 * =================================================================================
 *
 * =================================================================================
 * `§25` — TWO OUTCOME-PROCESSING TRANSACTIONS FOR ONE ATTEMPT, AND THE MIE HALF OF IT
 *
 * "At most one may perform state/economic movement. The second must observe prior
 *  terminal/unresolved state; return deterministic prior result or deny; never
 *  double-realise money; **never double-consume MIE**; never create duplicate journal
 *  authority."
 *
 * THREE MECHANISMS, AND THE LATER ONES SURVIVE THE EARLIER ONES BEING WRONG:
 *
 *   1. `SELECT ... FOR UPDATE` on the outbox row. A second transaction BLOCKS there until
 *      the first commits, then reads the committed outcome row and returns it as
 *      `alreadyResolved` — HAVING MOVED NOTHING, because the prior-outcome check happens
 *      before any ledger statement.
 *
 *   2. `effect_dispatch_outcome`'s PRIMARY KEY on `(company_id, idempotency_key)`. If a
 *      path ever reached the INSERT without the lock — which is precisely what
 *      `tests/negative-controls/unsafe-read-then-write-outcome.ts` does — the database
 *      refuses the duplicate, and because the INSERT shares this transaction with the
 *      ledger movement, the refusal rolls the movement back too.
 *
 *   3. `0002`'s `window_balance_irrecoverable_non_negative` CHECK. A second PRESUME for the
 *      same effect would drive `reserved_irrecoverable` below zero on a window holding one
 *      unit, and the database refuses it. `36 §0`'s single-mechanism rule, honoured three
 *      times over — and the third is the one that would catch a bug in the first two.
 * =================================================================================
 */

export const OUTCOME_REFUSALS = [
  /**
   * The handle is not an attestation this process minted.
   *
   * `§34`: "No worker/model surface may [...] submit adapter outcome; select outcome". A
   * caller cannot fabricate one, cannot deserialise one, and cannot obtain one by reading
   * any row. An outcome with no live attestation is a caller ASSERTING what an adapter
   * said, and it is refused before any read.
   */
  'ATTESTATION_NOT_LIVE',
  /** The attestation was minted for a different claim than the one presented. */
  'ATTESTATION_IDENTITY_MISMATCH',
  /** No outbox row for this identity. Unreachable through the gateway. */
  'OUTBOX_ROW_NOT_FOUND',
  /**
   * The row is not `CLAIMED`. Unreachable through the gateway, which processes an outcome
   * only for a claim its own transaction committed, and kept because the schema's
   * `dispatch_outcome_agrees_with_claim` trigger would refuse the INSERT anyway: a refusal
   * with a reason beats a constraint violation with a stack trace.
   */
  'OUTBOX_ROW_NOT_CLAIMED',
  /**
   * `25 §7.1`'s taxonomy declares no local state for this outcome kind.
   *
   * The ONLY member that reaches it is `ADAPTER_FAILED`, and v1.3.5 declares that it
   * reaches none: "Retained for diagnostics only. **It carries no local outcome policy and
   * reaches no local state.**" NOTHING IS WRITTEN — no outcome row, no journal row, no
   * ledger movement — and the claim stays committed and non-reclaimable, so the
   * no-re-dispatch property is unaffected.
   */
  'OUTCOME_POLICY_UNDECLARED',
  /**
   * An IRRECOVERABLE effect whose committed reservation holds no irrecoverable unit —
   * v1.3.5 (MIE-01), FAIL-CLOSED.
   *
   * `25 §10.1` makes the PRESUME row a movement of units that step R reserved: "`reserved
   * -= units`, `presumed += units`". An effect with no reserved unit has nothing to move,
   * and moving one anyway would either drive `reserved_irrecoverable` negative — refused by
   * `0002`'s CHECK — or create a `presumed` unit with no authorising reservation behind it,
   * which is the shape `phase2-v1.3.5-errata.md §1` calls "there was no unit to consume".
   *
   * REFUSING IS THE SAFE DIRECTION AND IT DOES NOT WEAKEN THE NO-DISPATCH PROPERTY. The
   * claim stays committed and the row stays non-reclaimable, so the effect is exactly where
   * a crash between claim and outcome leaves it: `I9`'s detector's subject. What is refused
   * is the ACCOUNTING, and an accounting that cannot be performed correctly must not be
   * performed approximately.
   */
  'MIE_UNITS_NOT_RESERVED',
] as const;

export type OutcomeRefusal = (typeof OUTCOME_REFUSALS)[number];

/** One committed `effect_dispatch_outcome` row, as the readers see it. */
export interface DispatchOutcomeRecord {
  readonly companyId: string;
  readonly idempotencyKey: string;
  readonly outboxId: string;
  readonly effectId: string;
  readonly authorisationId: string;
  readonly claimId: string;
  readonly adapter: string;
  readonly recoverability: Recoverability;
  readonly outcomeKind: AdapterOutcomeKind;
  readonly effectStatus: PostDispatchEffectStatus;
  readonly providerReference: string | null;
  readonly rawResponseHash: string | null;
  readonly requiresUnmirroredTag: boolean;
  readonly unmirroredTagSent: boolean;
  readonly overrideId: string | null;
  readonly economicMovement: EconomicMovement;
  readonly invokedAt: Date;
  readonly outcomeAt: Date;
  readonly journalSeq: bigint;
}

export type OutcomeResult =
  | {
      readonly kind: 'RESOLVED';
      readonly record: DispatchOutcomeRecord;
      /**
       * TRUE when this transaction found a committed outcome and wrote nothing.
       *
       * `§25`: "return deterministic prior result or deny". The prior result is returned,
       * which is `26 §7` load-bearing property 8's shape — "a duplicate proposal returns
       * the prior result" — applied one stage later. AND NO LEDGER TERM MOVED: the check
       * runs under the outbox row lock and before every ledger statement, which is the
       * "never double-consume MIE" half of `§25`.
       */
      readonly alreadyResolved: boolean;
      /**
       * The window instances this outcome's ledger movement touched, in the declared lock
       * order. EMPTY where the movement was `NONE` and empty on `alreadyResolved`.
       *
       * Present so `25 §10.1`'s "against **every** applicable MIE window instance — not the
       * first, not a primary, not the most permissive" is a value a test asserts rather than
       * a claim about the body.
       */
      readonly movedWindows: readonly { readonly windowId: string; readonly windowInstanceKey: string }[];
    }
  | {
      readonly kind: 'REFUSED';
      readonly reason: OutcomeRefusal;
      readonly detail: string;
      /** Present only for `OUTCOME_POLICY_UNDECLARED`. */
      readonly undeclared?: UndeclaredPolicyReason;
    };

interface OutcomeDbRow {
  readonly company_id: string;
  readonly idempotency_key: string;
  readonly outbox_id: string;
  readonly effect_id: string;
  readonly authorisation_id: string;
  readonly claim_id: string;
  readonly adapter: string;
  readonly recoverability: string;
  readonly outcome_kind: string;
  readonly effect_status: string;
  readonly provider_reference: string | null;
  readonly raw_response_hash: string | null;
  readonly requires_unmirrored_tag: boolean;
  readonly unmirrored_tag_sent: boolean;
  readonly override_id: string | null;
  readonly economic_movement: string;
  readonly invoked_at: Date;
  readonly outcome_at: Date;
  readonly journal_seq: string;
}

const OUTCOME_COLUMNS = `company_id, idempotency_key, outbox_id, effect_id,
       authorisation_id, claim_id, adapter, recoverability, outcome_kind, effect_status,
       provider_reference, raw_response_hash, requires_unmirrored_tag,
       unmirrored_tag_sent, override_id, economic_movement, invoked_at, outcome_at,
       journal_seq`;

function toRecord(row: OutcomeDbRow): DispatchOutcomeRecord {
  return {
    companyId: row.company_id,
    idempotencyKey: row.idempotency_key,
    outboxId: row.outbox_id,
    effectId: row.effect_id,
    authorisationId: row.authorisation_id,
    claimId: row.claim_id,
    adapter: row.adapter,
    recoverability: row.recoverability as Recoverability,
    outcomeKind: row.outcome_kind as AdapterOutcomeKind,
    effectStatus: row.effect_status as PostDispatchEffectStatus,
    providerReference: row.provider_reference,
    rawResponseHash: row.raw_response_hash,
    requiresUnmirroredTag: row.requires_unmirrored_tag,
    unmirroredTagSent: row.unmirrored_tag_sent,
    overrideId: row.override_id,
    economicMovement: row.economic_movement as EconomicMovement,
    invokedAt: row.invoked_at,
    outcomeAt: row.outcome_at,
    journalSeq: BigInt(row.journal_seq),
  };
}

/** Read a committed outcome, without locking. For observers and assertions. */
export async function readDispatchOutcome(
  control: Pool,
  companyId: string,
  idempotencyKey: string,
): Promise<DispatchOutcomeRecord | null> {
  const result = await control.query<OutcomeDbRow>(
    `SELECT ${OUTCOME_COLUMNS} FROM effect_dispatch_outcome
      WHERE company_id = $1 AND idempotency_key = $2`,
    [companyId, idempotencyKey],
  );
  const row = result.rows[0];
  return row === undefined ? null : toRecord(row);
}

interface OutcomeOperandRow {
  readonly status: string;
  readonly effect_recoverability: Recoverability;
  readonly effect_id: string;
  readonly authorisation_id: string;
  readonly claim_id: string | null;
  readonly adapter: string;
  readonly action_class: string;
  readonly resource_ref: string;
  readonly dispatch_payload_hash: string;
  readonly correlation_tag: string;
  readonly claim_requires_unmirrored_tag: boolean | null;
  readonly claim_override_id: string | null;
}

/**
 * The authoritative recoverability, read OUTSIDE any lock, to choose the isolation level.
 *
 * =================================================================================
 * WHY AN UNLOCKED PRE-READ IS SOUND HERE, AND WHY IT DECIDES NOTHING
 *
 * The isolation level must be chosen before `BEGIN`, so something must be known before the
 * transaction opens. What is read here is `effect.recoverability`, and the `effect` table
 * carries `0007`'s `acos_append_only` trigger: the value is immutable from the instant the
 * S1F transaction committed it. An immutable value read without a lock is the same value a
 * locked read would return.
 *
 * AND IT IS NOT THE AUTHORITY OPERAND. `processAdapterOutcomeOn` reads recoverability AGAIN,
 * inside the transaction, under the outbox row lock, and decides the policy from THAT read.
 * This pre-read only picks an isolation level; a wrong answer here would produce a
 * transaction that is more strictly isolated than it needed to be, or one that asserts
 * SERIALIZABLE and refuses — never one that moves a ledger term it should not have.
 * =================================================================================
 */
export async function outcomeIsolationFor(
  control: Pool,
  identity: DispatchIdentity,
  outcomeKind: AdapterOutcomeKind,
): Promise<'SERIALIZABLE' | 'READ COMMITTED'> {
  const result = await control.query<{ recoverability: Recoverability }>(
    `SELECT e.recoverability
       FROM dispatch_outbox o
       JOIN effect e ON e.effect_id = o.effect_id AND e.company_id = o.company_id
      WHERE o.company_id = $1 AND o.idempotency_key = $2`,
    [identity.companyId, identity.idempotencyKey],
  );
  const recoverability = result.rows[0]?.recoverability;
  if (recoverability === undefined) return 'READ COMMITTED';
  const policy = outcomePolicyFor(recoverability, outcomeKind);
  return policy.kind === 'RESOLVE' && movesLedger(policy.economicMovement)
    ? 'SERIALIZABLE'
    : 'READ COMMITTED';
}

/**
 * `33 §6`'s connection-level assertion, for the branches that move the ledger.
 *
 * "isolation is set and asserted at the connection", because "@transaction at default
 * isolation silently reintroduces write skew on the SUM". The same assertion the accepted
 * S1F local-authorisation transaction makes, at the one other place a ledger term moves.
 */
async function assertSerialisable(client: Client, movement: EconomicMovement): Promise<void> {
  const isolation = await client.query<{ level: string }>(
    `SELECT current_setting('transaction_isolation') AS level`,
  );
  const level = isolation.rows[0]?.level ?? 'unknown';
  if (level !== 'serializable') {
    throw new Error(
      `an outcome transaction performing ${movement} requires SERIALIZABLE isolation ` +
        `(33 §6, 25 §10.1); the connection reports ${level}`,
    );
  }
}

export interface OutcomeHooks {
  /** TEST-ONLY interleaving point, after the row lock and before any write. */
  readonly afterLock?: () => Promise<void>;
  /** TEST-ONLY kill point — after the balance locks, before the ledger movement. */
  readonly beforeLedgerMovement?: () => Promise<void>;
  /** TEST-ONLY kill point — after the ledger movement, before the journal row. */
  readonly afterLedgerMovement?: () => Promise<void>;
  /** TEST-ONLY kill point — after the journal sequence, before the outcome row. */
  readonly afterJournalRow?: () => Promise<void>;
  /** TEST-ONLY kill point, after every write and before the caller's COMMIT. */
  readonly beforeReturn?: () => Promise<void>;
}

/**
 * Process one adapter outcome, inside the caller's transaction.
 *
 * =================================================================================
 * EVERY AUTHORITY OPERAND IS READ HERE, FROM AN AUTHORITATIVE TABLE, IN THIS TRANSACTION
 *
 * `recoverability` COMES FROM THE COMMITTED `effect` ROW AND FROM NOWHERE ELSE — `§17`.
 * Not from the attestation, not from the envelope the adapter was handed, not from a
 * parameter. `26 §5`: "Assigned per action class in the catalogue, not per request, and
 * never by a model." The query below joins `effect` explicitly rather than trusting
 * `dispatch_outbox.recoverability`, even though `0010`'s composite foreign key already
 * makes the two equal.
 *
 * `irrecoverable_units` COMES FROM THE COMMITTED `reservation_window_instance` ROWS AND
 * FROM NOWHERE ELSE. Not from the catalogue at the outcome instant, not from a parameter,
 * not from the adapter. `25 §10.1`'s PRESUME row moves the units THAT WERE RESERVED, and
 * those rows are append-only as of `0013` — so a catalogue edited during the asynchronous
 * gap cannot change how many units a committed reservation moves, in either direction.
 *
 * The correlation tag, the payload hash, the action class, the resource, the adapter, the
 * degraded-state requirement and the override are read from the same committed rows. The
 * ONLY values this function takes from the attestation are the ones an adapter is the
 * authority for: which typed outcome it returned, when it was invoked, and its two inert
 * opaque references.
 * =================================================================================
 */
export async function processAdapterOutcomeOn(
  client: Client,
  input: {
    readonly attestation: DispatchAttestation;
    readonly identity: DispatchIdentity;
    readonly now: Date;
  },
  hooks?: OutcomeHooks,
): Promise<OutcomeResult> {
  const attested = readDispatchAttestation(input.attestation);
  if (attested === undefined) {
    return {
      kind: 'REFUSED',
      reason: 'ATTESTATION_NOT_LIVE',
      detail:
        'no live dispatch attestation for this handle: no adapter invocation in this ' +
        'process produced it (§34)',
    };
  }
  if (
    attested.identity.companyId !== input.identity.companyId ||
    attested.identity.idempotencyKey !== input.identity.idempotencyKey ||
    attested.identity.outboxId !== input.identity.outboxId ||
    attested.identity.effectId !== input.identity.effectId ||
    attested.identity.claimId !== input.identity.claimId
  ) {
    return {
      kind: 'REFUSED',
      reason: 'ATTESTATION_IDENTITY_MISMATCH',
      detail:
        `the attestation was minted for outbox ${attested.identity.outboxId} and was ` +
        `presented for outbox ${input.identity.outboxId}`,
    };
  }

  // ---------------------------------------------------------------------------------
  // THE OPERANDS AND THE BOUND WINDOWS, READ BEFORE THE LOCKS ARE TAKEN.
  //
  // Both reads are of IMMUTABLE committed rows — `effect` and `authorisation` carry
  // `acos_append_only`, and `0013` makes `reservation_window_instance` append-only — so
  // reading them before step 1 of the lock order cannot observe a value that a locked read
  // would contradict. What the reads decide is WHICH ROWS TO LOCK, and `30 §5.2`'s order
  // cannot be obeyed without first knowing that.
  //
  // This is the same shape the accepted S1F transaction uses: `resolveReferencedWindowInstances`
  // and `ensureWindowInstance` both run BEFORE `acquireMoneyPathLocks`, and the accepted
  // `ledger.ts` says why in those words — "deliberately NOT a lock acquisition: it runs
  // before the declared lock order is entered".
  // ---------------------------------------------------------------------------------
  const preRead = await client.query<{
    recoverability: Recoverability;
    authorisation_id: string;
  }>(
    `SELECT e.recoverability, e.authorisation_id
       FROM dispatch_outbox o
       JOIN effect e ON e.effect_id = o.effect_id AND e.company_id = o.company_id
      WHERE o.company_id = $1 AND o.idempotency_key = $2`,
    [input.identity.companyId, input.identity.idempotencyKey],
  );
  const pre = preRead.rows[0];
  if (pre === undefined) {
    return {
      kind: 'REFUSED',
      reason: 'OUTBOX_ROW_NOT_FOUND',
      detail: `no outbox row for ${input.identity.companyId}/${input.identity.idempotencyKey}`,
    };
  }

  const provisional = outcomePolicyFor(
    pre.recoverability,
    attested.outcomeKind as AdapterOutcomeKind,
  );
  const willMoveLedger =
    provisional.kind === 'RESOLVE' && movesLedger(provisional.economicMovement);

  let bound: readonly BoundReservationWindow[] = [];
  if (willMoveLedger) {
    bound = await readBoundReservationWindows(
      client,
      input.identity.companyId,
      pre.authorisation_id,
    );
    // `33 §6` / `25 §10.1`. Asserted before the first balance lock, so a misconfigured
    // caller fails before it holds anything.
    await assertSerialisable(client, provisional.economicMovement);

    // STEP 1 OF `30 §5.2` — the balance rows, FOR UPDATE, in the declared total order.
    // `acquireMoneyPathLocks` is the SINGLE acquisition site in `src/`, imported and not
    // reimplemented, and `tests/integration/exposure/lock-order.test.ts` reads the source
    // tree and fails if a second one appears.
    await acquireMoneyPathLocks(client, {
      companyId: input.identity.companyId,
      windowInstances: bound.map((w) => ({
        windowId: w.windowId,
        windowInstanceKey: w.windowInstanceKey,
      })),
      // No standing term moves on any outcome — `25 §10.1`'s five transitions touch
      // `reserved`, `presumed` and `realised` only, and the irrecoverable ledger has no
      // standing column at all (`24 §3` K5's printed schema).
      includeStandingRows: false,
      // The counter is allocated LAST, inside `emit_dispatch_outcome`, beside the journal
      // row it numbers. Taking it here would hold the most contended row across the
      // outcome's whole evaluation, which `30 §5.2` names as the reason it is last.
      includeJournalCounter: false,
    });
  }

  // STEP 3 OF THE LOCK ORDER. The exclusion for `§25`'s race.
  const locked = await client.query<OutcomeOperandRow>(
    `SELECT o.status,
            e.recoverability AS effect_recoverability,
            o.effect_id, o.authorisation_id, o.claim_id, o.adapter,
            o.action_class, o.resource_ref, o.dispatch_payload_hash, o.correlation_tag,
            o.claim_requires_unmirrored_tag, o.claim_override_id
       FROM dispatch_outbox o
       JOIN effect e ON e.effect_id = o.effect_id AND e.company_id = o.company_id
      WHERE o.company_id = $1 AND o.idempotency_key = $2
      FOR UPDATE OF o`,
    [input.identity.companyId, input.identity.idempotencyKey],
  );
  const operands = locked.rows[0];
  if (operands === undefined) {
    return {
      kind: 'REFUSED',
      reason: 'OUTBOX_ROW_NOT_FOUND',
      detail: `no outbox row for ${input.identity.companyId}/${input.identity.idempotencyKey}`,
    };
  }

  // The interleaving point. A HOOK rather than a sleep, because `36 §14` requires the race
  // to be constructed rather than hoped for. Production passes none.
  if (hooks?.afterLock !== undefined) await hooks.afterLock();

  if (operands.status !== 'CLAIMED' || operands.claim_id === null) {
    return {
      kind: 'REFUSED',
      reason: 'OUTBOX_ROW_NOT_CLAIMED',
      detail:
        `outbox row ${input.identity.outboxId} is ${operands.status}; an outcome requires ` +
        'a committed claim (25 §7, 30 §5.1 item 3)',
    };
  }

  // `§25`'s second transaction, and the idempotent re-entry of `§18` and `§22` point 6.
  //
  // READ UNDER THE ROW LOCK AND BEFORE EVERY LEDGER STATEMENT, so a concurrent writer has
  // either committed and is visible or has not started — and so the loser of the race
  // returns the prior result HAVING MOVED NO UNIT. This is the "never double-consume MIE"
  // half of `§25`, and `mie-outcome-duplicate.test.ts` asserts the balance rows are
  // byte-identical across the second processing.
  const existing = await client.query<OutcomeDbRow>(
    `SELECT ${OUTCOME_COLUMNS} FROM effect_dispatch_outcome
      WHERE company_id = $1 AND idempotency_key = $2`,
    [input.identity.companyId, input.identity.idempotencyKey],
  );
  const prior = existing.rows[0];
  if (prior !== undefined) {
    return {
      kind: 'RESOLVED',
      record: toRecord(prior),
      alreadyResolved: true,
      movedWindows: [],
    };
  }

  // `25 §7.1`'s table, over the AUTHORITATIVE recoverability and the TYPED outcome.
  const policy = outcomePolicyFor(
    operands.effect_recoverability,
    attested.outcomeKind as AdapterOutcomeKind,
  );
  if (policy.kind === 'UNDECLARED') {
    return {
      kind: 'REFUSED',
      reason: 'OUTCOME_POLICY_UNDECLARED',
      detail: policy.detail,
      undeclared: policy.reason,
    };
  }

  // ---------------------------------------------------------------------------------
  // THE DECLARED LEDGER MOVEMENT — `25 §10.1` and `25 §7.2`.
  //
  // AGAINST EVERY BOUND WINDOW INSTANCE, in the declared lock order, and never against a
  // primary or a first match. The set is the immutable one step R committed.
  // ---------------------------------------------------------------------------------
  const movedWindows: { windowId: string; windowInstanceKey: string }[] = [];
  if (movesLedger(policy.economicMovement)) {
    if (hooks?.beforeLedgerMovement !== undefined) await hooks.beforeLedgerMovement();

    const totalUnits = bound.reduce((sum, w) => sum + w.irrecoverableUnits, 0n);
    if (operands.effect_recoverability === 'IRRECOVERABLE' && totalUnits === 0n) {
      return {
        kind: 'REFUSED',
        reason: 'MIE_UNITS_NOT_RESERVED',
        detail:
          `effect ${operands.effect_id} is IRRECOVERABLE and its committed reservation ` +
          'holds no irrecoverable unit; 25 §10.1 moves units that step R reserved and ' +
          'there is nothing to move',
      };
    }

    for (const window of bound) {
      switch (policy.economicMovement) {
        case 'MIE_RESERVED_TO_PRESUMED':
          await applyIrrecoverablePresumption(
            client,
            input.identity.companyId,
            window.windowId,
            window.windowInstanceKey,
            window.irrecoverableUnits,
          );
          break;
        case 'MIE_RESERVED_RELEASED':
          await releaseIrrecoverableReservation(
            client,
            input.identity.companyId,
            window.windowId,
            window.windowInstanceKey,
            window.irrecoverableUnits,
          );
          break;
        case 'RESERVATION_RELEASED':
          // `25 §7.2`'s money branch. The same two terms step R moved, by the same
          // amounts, on the same instances. `26 §7` property 8's release, performed
          // against a COMMITTED reservation for the first time in this codebase — see
          // `ledger.ts`'s `releaseMonetaryReservation` header and the S1J owner
          // clarification it cites.
          await releaseMonetaryReservation(
            client,
            input.identity.companyId,
            window.windowId,
            window.windowInstanceKey,
            window.amount,
            // The count units step R consumed against this instance. One authorised
            // effect is one unit against `I3`'s count ledger (`51 §2`), which is the
            // figure the accepted `preReservation.ts` seals into the facts.
            1n,
          );
          break;
        case 'NONE':
          // Unreachable: `movesLedger` excluded it. An assertion, not a fallback.
          throw new Error('a NONE movement reached the ledger branch');
      }
      movedWindows.push({
        windowId: window.windowId,
        windowInstanceKey: window.windowInstanceKey,
      });
    }

    // The reservation row is stamped in the SAME transaction, so `I3` term 1 stays
    // reconstructable as the sum over UNRELEASED reservations and a released reservation is
    // identifiable afterwards. `0013`'s `reservation_release_is_paired` CHECK and its
    // no-unrelease trigger are what make the stamp one-way.
    if (
      policy.economicMovement === 'RESERVATION_RELEASED' ||
      policy.economicMovement === 'MIE_RESERVED_RELEASED'
    ) {
      await client.query(
        `UPDATE exposure_reservation
            SET released_at = $2, released_reason = 'DISPATCH_NOT_SENT_CONFIRMED'
          WHERE authorisation_id = $1 AND released_at IS NULL`,
        [operands.authorisation_id, input.now],
      );
    }

    if (hooks?.afterLedgerMovement !== undefined) await hooks.afterLedgerMovement();
  }

  // `23 §6` B8. Journaled BEFORE the outcome row is written, in the same transaction, so
  // the two are one durable fact — the ordering the ACCEPTED S1I claim uses, for the same
  // reason: the record must not be able to lag the state it records.
  //
  // `emit_dispatch_outcome` takes `journal_counter` FOR UPDATE, which is step 4 and LAST.
  const emitted = await client.query<{ emit_dispatch_outcome: string }>(
    `SELECT emit_dispatch_outcome($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
                                  $14, $15, $16)`,
    [
      input.identity.companyId,
      input.identity.outboxId,
      operands.claim_id,
      operands.correlation_tag,
      operands.effect_id,
      operands.authorisation_id,
      input.identity.idempotencyKey,
      operands.action_class,
      operands.resource_ref,
      operands.dispatch_payload_hash,
      operands.adapter,
      attested.outcomeKind,
      policy.effectStatus,
      operands.claim_requires_unmirrored_tag,
      operands.claim_override_id,
      input.now,
    ],
  );
  const journalSeq = emitted.rows[0]!.emit_dispatch_outcome;
  if (hooks?.afterJournalRow !== undefined) await hooks.afterJournalRow();

  const inserted = await client.query<OutcomeDbRow>(
    `INSERT INTO effect_dispatch_outcome (
        company_id, idempotency_key, outbox_id, effect_id, authorisation_id, claim_id,
        adapter, recoverability, outcome_kind, effect_status,
        provider_reference, raw_response_hash,
        requires_unmirrored_tag, unmirrored_tag_sent, override_id,
        economic_movement, invoked_at, outcome_at, journal_seq)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17,
              $18, $19)
      RETURNING ${OUTCOME_COLUMNS}`,
    [
      input.identity.companyId,
      input.identity.idempotencyKey,
      input.identity.outboxId,
      operands.effect_id,
      operands.authorisation_id,
      operands.claim_id,
      operands.adapter,
      operands.effect_recoverability,
      attested.outcomeKind,
      policy.effectStatus,
      attested.providerReference,
      attested.rawResponseHash,
      operands.claim_requires_unmirrored_tag,
      // `§12`. What the GATEWAY put on the envelope, which `0012`'s CHECK requires to equal
      // the claim's requirement. An adapter or mapper that dropped it cannot commit.
      attested.unmirroredTagSent,
      operands.claim_override_id,
      policy.economicMovement,
      attested.invokedAt,
      input.now,
      journalSeq,
    ],
  );

  if (hooks?.beforeReturn !== undefined) await hooks.beforeReturn();

  return {
    kind: 'RESOLVED',
    record: toRecord(inserted.rows[0]!),
    alreadyResolved: false,
    movedWindows,
  };
}

/**
 * Process one adapter outcome in its own transaction, ON A GIVEN CLIENT.
 *
 * THE CLIENT MATTERS AND IS NOT AN OPTIMISATION. `25 §14.1` requires Epoch B's dispatch
 * lease to be held continuously "across [...] **6. local adapter-outcome transaction → 7.
 * OUTCOME COMMIT**", and the lease is a SESSION-level advisory lock living in one
 * connection. A transaction opened on a different pooled connection would be a transaction
 * the lock does not cover, so `effectGateway.ts` passes the lease's own client here.
 *
 * The isolation is the movement's — SERIALIZABLE where a ledger term moves, READ COMMITTED
 * where none does — and the `40001` retry is the accepted bounded one, which propagates
 * `40P01` immediately because a deadlock on this path is an invariant defect (S1A-H2).
 */
export async function processAdapterOutcomeOnClient(
  client: Client,
  isolation: 'SERIALIZABLE' | 'READ COMMITTED',
  input: {
    readonly attestation: DispatchAttestation;
    readonly identity: DispatchIdentity;
    readonly now: Date;
  },
  hooks?: OutcomeHooks,
): Promise<OutcomeResult> {
  if (isolation === 'READ COMMITTED') {
    return inTransaction(client, 'READ COMMITTED', (tx) =>
      processAdapterOutcomeOn(tx, input, hooks),
    );
  }
  const retried = await withSerialisationRetry(
    client,
    (tx) => processAdapterOutcomeOn(tx, input, hooks),
    { isolation: 'SERIALIZABLE' },
  );
  return retried.value;
}

/**
 * Process one adapter outcome in its own transaction, on a pooled connection.
 *
 * Retained for callers outside Epoch B — tests that process a second outcome for `§25`'s
 * race, and the accepted suites. The gateway does NOT use it: it must run on the dispatch
 * lease's connection.
 */
export async function processAdapterOutcome(
  control: Pool,
  input: {
    readonly attestation: DispatchAttestation;
    readonly identity: DispatchIdentity;
    readonly now: Date;
  },
  hooks?: OutcomeHooks,
): Promise<OutcomeResult> {
  const attested = readDispatchAttestation(input.attestation);
  const isolation =
    attested === undefined
      ? ('READ COMMITTED' as const)
      : await outcomeIsolationFor(
          control,
          input.identity,
          attested.outcomeKind as AdapterOutcomeKind,
        );
  const client = await control.connect();
  try {
    return await processAdapterOutcomeOnClient(client, isolation, input, hooks);
  } finally {
    client.release();
  }
}
