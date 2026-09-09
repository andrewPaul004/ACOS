import { inTransaction, type Client, type Pool } from '../../db/pool.js';
import type { Recoverability } from '../canonicalisation/actionCatalogue.js';
import {
  readDispatchAttestation,
  type DispatchAttestation,
  type DispatchIdentity,
} from './dispatchCapability.js';
import {
  outcomePolicyFor,
  type EconomicMovement,
  type PostDispatchEffectStatus,
  type UndeclaredPolicyReason,
} from './outcomePolicy.js';
import type { AdapterOutcomeKind } from './adapterPort.js';

/**
 * THE LOCAL OUTCOME TRANSACTION — `§20` OF THE S1J MANDATE.
 *
 * =================================================================================
 * ONE TRANSACTION, AND EXACTLY WHAT IS IN IT
 *
 * "All local consequences of ONE adapter result must commit atomically where architecture
 *  requires. [...] Use ONE PostgreSQL transaction for mutually dependent local state."
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
 *                            past the claim: the claim was the last record before an
 *                            effect could leave, this is the first after one may have.
 *
 *   the outbox row           NOT WRITTEN. `0010`'s trigger refuses every UPDATE to a
 *                            `CLAIMED` row, and `§26` — "every outcome branch remains
 *                            non-reclaimable" — is therefore true because nothing here
 *                            touches it.
 *
 *   the reservation          NOT WRITTEN. `35 §4`: "The exposure reservation **remains
 *                            held**. It is not released on timeout". Holding is the
 *                            absence of a write, so the strongest implementation of it is
 *                            an absent statement — and `economic-state.test.ts` asserts
 *                            the ledger rows byte for byte across the transaction.
 *
 *   the MIE ledger           NOT WRITTEN, AND THE SLICE IS PARTIAL BECAUSE OF IT. See
 *                            `outcomePolicy.ts`'s `IRRECOVERABLE_UNKNOWN_MIE_TRANSITION_
 *                            UNDECLARED` and `S1J-C1`.
 *
 * SO THE TRANSACTION MOVES NO MONEY AND NO COUNT, AND THAT IS AN ARCHITECTURE RESULT
 * RATHER THAN A SIMPLIFICATION. `§43`'s conditional — "IF outcome-state transactions touch
 * money/MIE rows: assert SERIALIZABLE where current architecture requires it" — does not
 * fire, and `33 §6` scopes the serialisable requirement to the exposure ledger, "the only
 * table with a serialisable-isolation requirement". `READ COMMITTED` with the outbox row
 * lock is therefore the correct isolation, for the same reason the ACCEPTED S1I claim uses
 * it: at `REPEATABLE READ` the loser of a race would raise `40001` instead of reading the
 * committed prior outcome, which converts a determinate answer into a retryable error.
 * =================================================================================
 *
 * =================================================================================
 * THE LOCK ORDER — `30 §5.2`, AS RESOLVED IN `src/kernel/exposure/lockOrder.ts`
 *
 *   1. window_balance            — not touched. No money moves.
 *   2. standing_window_exposure  — not touched.
 *   3. dispatch_outbox row       FOR UPDATE
 *   4. journal_counter           FOR UPDATE, LAST, inside `emit_dispatch_outcome`
 *
 * Two locks, in the declared total order, with the counter last. No inversion against the
 * S1I claim transaction exists because that transaction takes the same two in the same
 * order, and none against the S1F authorising transaction because that one never touches
 * `dispatch_outbox`. `§21`: there is no second money-path lock discipline here, because
 * there is no money-path lock here at all.
 * =================================================================================
 *
 * =================================================================================
 * `§25` — TWO OUTCOME-PROCESSING TRANSACTIONS FOR ONE ATTEMPT
 *
 * "At most one may perform state/economic movement. The second must observe prior
 *  terminal/unresolved state; return deterministic prior result or deny; never
 *  double-realise money; never double-consume MIE; never create duplicate journal
 *  authority."
 *
 * TWO MECHANISMS, AND THE SECOND SURVIVES THE FIRST BEING WRONG:
 *
 *   1. `SELECT ... FOR UPDATE` on the outbox row. A second transaction BLOCKS there until
 *      the first commits, then reads the committed outcome row and returns it as
 *      `alreadyResolved`. No second journal row, no second outcome row.
 *
 *   2. `effect_dispatch_outcome`'s PRIMARY KEY on `(company_id, idempotency_key)`. If a
 *      path ever reached the INSERT without the lock — which is precisely what
 *      `tests/negative-controls/unsafe-read-then-write-outcome.ts` does — the database
 *      refuses the duplicate. `36 §0`'s single-mechanism rule, honoured.
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
   * `25 §10`'s table has no declared row for this `(recoverability, outcome kind)` pair, or
   * the row it has requires a ledger movement v1.3.4 does not define.
   *
   * NOTHING IS WRITTEN. No outcome row, no journal row, no ledger movement — and the claim
   * stays committed and non-reclaimable, so the no-re-dispatch property is unaffected.
   * `outcomePolicy.ts`'s `UNDECLARED_POLICY_REASONS` name which artifact leaves each case
   * open (`S1J-C1`, `S1J-C2`), and `§47` of the mandate is why this is a refusal rather
   * than a best guess.
   */
  'OUTCOME_POLICY_UNDECLARED',
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
       * the prior result" — applied one stage later.
       */
      readonly alreadyResolved: boolean;
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
 * makes the two equal: the point of `§17`'s attack is that the authoritative source is
 * the effect, and reading it says so at the call site.
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
  hooks?: {
    /** TEST-ONLY interleaving point, after the row lock and before any write. */
    readonly afterLock?: () => Promise<void>;
    /** TEST-ONLY kill point, after both writes and before the caller's COMMIT. */
    readonly beforeReturn?: () => Promise<void>;
  },
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

  // Step 3 of the lock order. The exclusion for `§25`'s race.
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
  // Read UNDER THE ROW LOCK, so a concurrent writer has either committed and is visible or
  // has not started.
  const existing = await client.query<OutcomeDbRow>(
    `SELECT ${OUTCOME_COLUMNS} FROM effect_dispatch_outcome
      WHERE company_id = $1 AND idempotency_key = $2`,
    [input.identity.companyId, input.identity.idempotencyKey],
  );
  const prior = existing.rows[0];
  if (prior !== undefined) {
    return { kind: 'RESOLVED', record: toRecord(prior), alreadyResolved: true };
  }

  // `25 §10`'s table, over the AUTHORITATIVE recoverability and the TYPED outcome.
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

  // `23 §6` B8. Journaled BEFORE the outcome row is written, in the same transaction, so
  // the two are one durable fact — the ordering the ACCEPTED S1I claim uses, for the same
  // reason: the record must not be able to lag the state it records.
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

  return { kind: 'RESOLVED', record: toRecord(inserted.rows[0]!), alreadyResolved: false };
}

/**
 * Process one adapter outcome in its own transaction.
 *
 * `READ COMMITTED`, for the reason the header gives: this transaction moves no money, and
 * a determinate `alreadyResolved` beats a retryable `40001` for the loser of a race.
 */
export async function processAdapterOutcome(
  control: Pool,
  input: {
    readonly attestation: DispatchAttestation;
    readonly identity: DispatchIdentity;
    readonly now: Date;
  },
  hooks?: {
    readonly afterLock?: () => Promise<void>;
    readonly beforeReturn?: () => Promise<void>;
  },
): Promise<OutcomeResult> {
  const client = await control.connect();
  try {
    return await inTransaction(client, 'READ COMMITTED', (tx) =>
      processAdapterOutcomeOn(tx, input, hooks),
    );
  } finally {
    client.release();
  }
}
