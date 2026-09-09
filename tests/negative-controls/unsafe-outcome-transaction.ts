import { inTransaction, type Pool } from '../../src/db/pool.js';

/**
 * TEST-ONLY. TWO DEFECTIVE OUTCOME-TRANSACTION DESIGNS — `§40` ITEMS 12 AND `§25`.
 *
 * =================================================================================
 * CONTROL A — NON-ATOMIC: THE JOURNAL ROW AND THE STATE ROW IN TWO TRANSACTIONS
 *
 * `§20`: "All local consequences of ONE adapter result must commit atomically where
 * architecture requires. [...] A crash must not persist [...] journal outcome without
 * matching local state."
 *
 * `23 §6` B8 is the source: "commit the authorisation, the effect row, the reservation, the
 * state transition **and the journal row in one transaction**". `30 §5.2`'s gap rule is why
 * it matters at the journal end — a gap in the sequence has "exactly one interpretation",
 * suppression — and a journal row committed alone is not a gap but something worse: a
 * durable, chained, audit-mirrored assertion that an outcome was resolved, with no local
 * state resolving it.
 *
 * `unsafeSplitOutcomeCommit` commits the journal row FIRST, in its own transaction, and
 * then the state row in a second one. Between them the control plane's own chain says the
 * dispatch resolved and its own tables say nothing did — and if the process dies in that
 * window, it says so permanently. `30 §5.5` item 9 is explicit that a row of this class has
 * NO detector: "Rows describing anything with no vendor counterpart [...] have no detector
 * at all, under any mechanism in this architecture."
 *
 * PRODUCTION USES ONE TRANSACTION, and `outcome-atomicity.test.ts` kills inside it at both
 * points to prove neither half survives alone.
 * =================================================================================
 *
 * =================================================================================
 * CONTROL B — READ-THEN-WRITE WITHOUT THE ROW LOCK (`§25`)
 *
 * `§25`: "Race two outcome-processing transactions for the same mock attempt. At most one
 * may perform state/economic movement."
 *
 * `unsafeReadThenWriteOutcome` checks for an existing outcome row and then inserts, with no
 * `SELECT ... FOR UPDATE` on the outbox row between the two. It is the same shape
 * `tests/negative-controls/unsafe-select-then-update-claim.ts` exhibits for the ACCEPTED
 * S1I claim, one stage later, and `36 §14`'s targeted interleaving is what exposes it: both
 * transactions read "no outcome", both proceed, and the second INSERT is where the truth
 * comes out.
 *
 * WHAT DISCRIMINATES IT IS NOT THE OUTCOME — IT IS WHICH MECHANISM REFUSED. Production's
 * loser BLOCKS on the row lock, then reads the committed outcome and returns it as
 * `alreadyResolved`, which is a determinate answer. This control's loser reaches the INSERT
 * and is stopped by `effect_dispatch_outcome`'s PRIMARY KEY — a `unique_violation` that
 * aborts its transaction. Both end with one outcome row, and that is `36 §0`'s point about
 * single-mechanism properties: the key is the second mechanism, it holds when the first is
 * absent, and a control that shows the key doing the work is showing that the lock was
 * missing.
 *
 * The returned value says which happened, so the test can assert the DIFFERENCE rather than
 * only the row count.
 * =================================================================================
 */

export type UnsafeSplitResult =
  | { readonly kind: 'BOTH_COMMITTED'; readonly journalSeq: bigint }
  | {
      readonly kind: 'JOURNAL_ONLY';
      readonly journalSeq: bigint;
      readonly failure: string;
    };

/**
 * Commit the `DISPATCH_OUTCOME` journal row in one transaction and the state row in
 * another, with an injectable kill point between them.
 */
export async function unsafeSplitOutcomeCommit(
  control: Pool,
  input: {
    readonly companyId: string;
    readonly idempotencyKey: string;
    readonly outcomeKind: string;
    readonly effectStatus: string;
    readonly now: Date;
  },
  killBetween?: () => Promise<void>,
): Promise<UnsafeSplitResult> {
  const client = await control.connect();
  try {
    const snapshot = await client.query<{
      outbox_id: string;
      claim_id: string;
      correlation_tag: string;
      effect_id: string;
      authorisation_id: string;
      action_class: string;
      resource_ref: string;
      dispatch_payload_hash: string;
      adapter: string;
      recoverability: string;
      claim_requires_unmirrored_tag: boolean;
      claim_override_id: string | null;
    }>(
      `SELECT outbox_id, claim_id, correlation_tag, effect_id, authorisation_id,
              action_class, resource_ref, dispatch_payload_hash, adapter, recoverability,
              claim_requires_unmirrored_tag, claim_override_id
         FROM dispatch_outbox
        WHERE company_id = $1 AND idempotency_key = $2 AND status = 'CLAIMED'`,
      [input.companyId, input.idempotencyKey],
    );
    const row = snapshot.rows[0];
    if (row === undefined) throw new Error('no claimed outbox row for the unsafe split');

    // TRANSACTION ONE: the journal row, alone.
    const journalSeq = await inTransaction(client, 'READ COMMITTED', async (tx) => {
      const emitted = await tx.query<{ emit_dispatch_outcome: string }>(
        `SELECT emit_dispatch_outcome($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
                                      $13, $14, $15, $16)`,
        [
          input.companyId,
          row.outbox_id,
          row.claim_id,
          row.correlation_tag,
          row.effect_id,
          row.authorisation_id,
          input.idempotencyKey,
          row.action_class,
          row.resource_ref,
          row.dispatch_payload_hash,
          row.adapter,
          input.outcomeKind,
          input.effectStatus,
          row.claim_requires_unmirrored_tag,
          row.claim_override_id,
          input.now,
        ],
      );
      return BigInt(emitted.rows[0]!.emit_dispatch_outcome);
    });

    // THE WINDOW. A crash here leaves a chained journal row with no local state.
    if (killBetween !== undefined) {
      try {
        await killBetween();
      } catch (error) {
        return {
          kind: 'JOURNAL_ONLY',
          journalSeq,
          failure: error instanceof Error ? error.message : String(error),
        };
      }
    }

    // TRANSACTION TWO: the state row.
    await inTransaction(client, 'READ COMMITTED', async (tx) => {
      await tx.query(
        `INSERT INTO effect_dispatch_outcome (
            company_id, idempotency_key, outbox_id, effect_id, authorisation_id, claim_id,
            adapter, recoverability, outcome_kind, effect_status,
            provider_reference, raw_response_hash,
            requires_unmirrored_tag, unmirrored_tag_sent, override_id,
            economic_movement, invoked_at, outcome_at, journal_seq)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NULL, NULL, $11, $11, $12,
                  'NONE', $13, $13, $14)`,
        [
          input.companyId,
          input.idempotencyKey,
          row.outbox_id,
          row.effect_id,
          row.authorisation_id,
          row.claim_id,
          row.adapter,
          row.recoverability,
          input.outcomeKind,
          input.effectStatus,
          row.claim_requires_unmirrored_tag,
          row.claim_override_id,
          input.now,
          journalSeq.toString(),
        ],
      );
    });
    return { kind: 'BOTH_COMMITTED', journalSeq };
  } finally {
    client.release();
  }
}

export type UnsafeRaceOutcome =
  | { readonly kind: 'INSERTED' }
  | { readonly kind: 'SAW_PRIOR' }
  | { readonly kind: 'REFUSED_BY_KEY'; readonly sqlstate: string };

/**
 * Read-then-write, with no row lock, and an injectable interleaving point between the two.
 *
 * Production's equivalent takes `SELECT ... FOR UPDATE` on the outbox row before the read,
 * so a concurrent transaction blocks. This one does not, so two callers can both pass the
 * existence check.
 */
export async function unsafeReadThenWriteOutcome(
  control: Pool,
  input: {
    readonly companyId: string;
    readonly idempotencyKey: string;
    readonly outcomeKind: string;
    readonly effectStatus: string;
    readonly now: Date;
  },
  betweenReadAndWrite?: () => Promise<void>,
): Promise<UnsafeRaceOutcome> {
  const client = await control.connect();
  try {
    return await inTransaction(client, 'READ COMMITTED', async (tx) => {
      // NO `FOR UPDATE`. This is the defect.
      const existing = await tx.query<{ n: string }>(
        `SELECT count(*)::TEXT AS n FROM effect_dispatch_outcome
          WHERE company_id = $1 AND idempotency_key = $2`,
        [input.companyId, input.idempotencyKey],
      );
      if (Number(existing.rows[0]!.n) > 0) return { kind: 'SAW_PRIOR' as const };

      if (betweenReadAndWrite !== undefined) await betweenReadAndWrite();

      const row = await tx.query<{
        outbox_id: string;
        claim_id: string;
        correlation_tag: string;
        effect_id: string;
        authorisation_id: string;
        action_class: string;
        resource_ref: string;
        dispatch_payload_hash: string;
        adapter: string;
        recoverability: string;
        claim_requires_unmirrored_tag: boolean;
        claim_override_id: string | null;
      }>(
        `SELECT outbox_id, claim_id, correlation_tag, effect_id, authorisation_id,
                action_class, resource_ref, dispatch_payload_hash, adapter, recoverability,
                claim_requires_unmirrored_tag, claim_override_id
           FROM dispatch_outbox
          WHERE company_id = $1 AND idempotency_key = $2`,
        [input.companyId, input.idempotencyKey],
      );
      const o = row.rows[0];
      if (o === undefined) throw new Error('no outbox row for the unsafe race');

      try {
        const emitted = await tx.query<{ emit_dispatch_outcome: string }>(
          `SELECT emit_dispatch_outcome($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
                                        $13, $14, $15, $16)`,
          [
            input.companyId,
            o.outbox_id,
            o.claim_id,
            o.correlation_tag,
            o.effect_id,
            o.authorisation_id,
            input.idempotencyKey,
            o.action_class,
            o.resource_ref,
            o.dispatch_payload_hash,
            o.adapter,
            input.outcomeKind,
            input.effectStatus,
            o.claim_requires_unmirrored_tag,
            o.claim_override_id,
            input.now,
          ],
        );
        await tx.query(
          `INSERT INTO effect_dispatch_outcome (
              company_id, idempotency_key, outbox_id, effect_id, authorisation_id, claim_id,
              adapter, recoverability, outcome_kind, effect_status,
              provider_reference, raw_response_hash,
              requires_unmirrored_tag, unmirrored_tag_sent, override_id,
              economic_movement, invoked_at, outcome_at, journal_seq)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NULL, NULL, $11, $11, $12,
                    'NONE', $13, $13, $14)`,
          [
            input.companyId,
            input.idempotencyKey,
            o.outbox_id,
            o.effect_id,
            o.authorisation_id,
            o.claim_id,
            o.adapter,
            o.recoverability,
            input.outcomeKind,
            input.effectStatus,
            o.claim_requires_unmirrored_tag,
            o.claim_override_id,
            input.now,
            BigInt(emitted.rows[0]!.emit_dispatch_outcome).toString(),
          ],
        );
        return { kind: 'INSERTED' as const };
      } catch (error) {
        const sqlstate =
          typeof error === 'object' && error !== null && 'code' in error
            ? String((error as { code: unknown }).code)
            : 'unknown';
        return { kind: 'REFUSED_BY_KEY' as const, sqlstate };
      }
    });
  } finally {
    client.release();
  }
}
