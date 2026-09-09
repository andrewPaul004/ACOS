import type { Pool } from '../../src/db/pool.js';
import type {
  AdapterOutcome,
  DispatchEnvelope,
  ExternalEffectAdapter,
} from '../../src/kernel/gateway/adapterPort.js';

/**
 * TEST-ONLY. `dispatchClaimed(outboxId)` — THE CONTROL `§5` AND `§40` ITEM 1 REQUIRE.
 *
 * =================================================================================
 * `§5` OF THE S1J MANDATE, VERBATIM
 *
 *   "Required negative control:
 *
 *    Unsafe production-like function: `dispatchClaimed(outboxId)` loads any persisted
 *    CLAIMED row and invokes the adapter.
 *
 *    Fixture: 1. claim commits; 2. process dies before adapter invocation; 3. process
 *    restarts; 4. unsafe path dispatches from persisted CLAIMED; 5. production refuses
 *    because no fresh capability exists.
 *
 *    Must discriminate."
 * =================================================================================
 *
 * =================================================================================
 * WHY THIS IS THE MOST DANGEROUS SHAPE IN THE SLICE, AND WHY IT LOOKS REASONABLE
 *
 * Read it on its own terms and it looks like careful recovery code: it refuses anything
 * that is not `CLAIMED`, it refuses a row that already has an outcome, it hands the
 * adapter the PERSISTED payload and the PERSISTED correlation tag, and it never
 * re-claims — the outbox row is untouched. Every check `25 §7`'s state machine talks about
 * passes.
 *
 * AND IT DUPLICATES AN IRRECOVERABLE SEND. `35 §12.3` is the walkthrough: "The HTTP request
 * leaves; the process dies before the response is recorded. On recovery, ACOS does not know
 * whether the message was accepted." A `CLAIMED` row with no outcome is that state exactly,
 * and it is ambiguous in BOTH directions — the request may have left and been accepted, or
 * it may never have left at all. This function resolves the ambiguity by assuming the
 * second, and `25 §7`'s own words are why it may not: a `CLAIMED` row "is never
 * re-dispatched by any path — including recovery, including a fork, including a manual
 * replay."
 *
 * So the discriminator is NOT a state check that this function is missing. It is that
 * production carries a process-local fresh-claim capability which this function cannot
 * obtain, cannot reconstruct from the row it just read, and cannot receive from a caller —
 * and which does not survive the restart that makes this function look necessary.
 * =================================================================================
 */

interface ClaimedRow {
  readonly company_id: string;
  readonly idempotency_key: string;
  readonly outbox_id: string;
  readonly claim_id: string;
  readonly effect_id: string;
  readonly authorisation_id: string;
  readonly action_class: string;
  readonly resource_ref: string;
  readonly recoverability: string;
  readonly adapter: string;
  readonly dispatch_payload_hash: string;
  readonly payload_canonical_bytes: Buffer;
  readonly correlation_tag: string;
  readonly claim_requires_unmirrored_tag: boolean;
  readonly claim_override_id: string | null;
}

export type UnsafeDispatchResult =
  | { readonly kind: 'DISPATCHED'; readonly outcome: AdapterOutcome }
  | { readonly kind: 'NOTHING_TO_DISPATCH' };

/**
 * Load a persisted `CLAIMED` row by its outbox id and invoke the adapter from it.
 *
 * NO CAPABILITY, NO ATTESTATION, NO FRESHNESS. The only inputs are a pool, a string a
 * caller chose, and an adapter a caller chose — which is also `§40` item 3's defect, in the
 * same function, because a recovery path that reads its target from a parameter has no
 * reason to resolve its adapter from the catalogue either.
 */
export async function unsafeDispatchClaimed(
  control: Pool,
  outboxId: string,
  adapter: ExternalEffectAdapter,
): Promise<UnsafeDispatchResult> {
  const client = await control.connect();
  try {
    const result = await client.query<ClaimedRow>(
      `SELECT company_id, idempotency_key, outbox_id, claim_id, effect_id,
              authorisation_id, action_class, resource_ref, recoverability, adapter,
              dispatch_payload_hash, payload_canonical_bytes, correlation_tag,
              claim_requires_unmirrored_tag, claim_override_id
         FROM dispatch_outbox
        WHERE outbox_id = $1 AND status = 'CLAIMED'`,
      [outboxId],
    );
    const row = result.rows[0];
    if (row === undefined) return { kind: 'NOTHING_TO_DISPATCH' };

    // It even declines to double-dispatch something it can SEE an outcome for, which is
    // what makes it plausible: the case it gets wrong is the case with no local outcome,
    // and that is the only case a crash produces.
    const settled = await client.query<{ n: string }>(
      `SELECT count(*)::TEXT AS n FROM effect_dispatch_outcome
        WHERE company_id = $1 AND idempotency_key = $2`,
      [row.company_id, row.idempotency_key],
    );
    if (Number(settled.rows[0]!.n) > 0) return { kind: 'NOTHING_TO_DISPATCH' };

    const envelope = {
      companyId: row.company_id,
      outboxId: row.outbox_id,
      claimId: row.claim_id,
      effectId: row.effect_id,
      authorisationId: row.authorisation_id,
      idempotencyKey: row.idempotency_key,
      actionClass: row.action_class,
      resourceRef: row.resource_ref,
      recoverability: row.recoverability,
      adapter: row.adapter,
      method: 'unsafeRecoveredMethod',
      dispatchPayloadHash: row.dispatch_payload_hash,
      payloadCanonicalBytes: row.payload_canonical_bytes,
      correlationTag: row.correlation_tag,
      requiresUnmirroredTag: row.claim_requires_unmirrored_tag,
      overrideId: row.claim_override_id,
    } as unknown as DispatchEnvelope;

    const outcome = await adapter.dispatch(envelope);
    return { kind: 'DISPATCHED', outcome };
  } finally {
    client.release();
  }
}

/**
 * The forbidden startup sweep, as `§23` names it: "Do NOT build `on startup, dispatch all
 * CLAIMED rows`. That is forbidden."
 *
 * `§40` item 11's control — "crash after mock acceptance leads to second invocation" — is
 * this function run after a dispatch whose adapter was accepted and whose outcome never
 * committed. It sweeps every `CLAIMED` row with no outcome and re-invokes, so the second
 * invocation count is what discriminates it from production, which sweeps nothing because
 * no production module has a scheduler at all.
 */
export async function unsafeDispatchAllClaimed(
  control: Pool,
  companyId: string,
  adapter: ExternalEffectAdapter,
): Promise<number> {
  const client = await control.connect();
  let ids: string[];
  try {
    const result = await client.query<{ outbox_id: string }>(
      `SELECT o.outbox_id
         FROM dispatch_outbox o
         LEFT JOIN effect_dispatch_outcome d
           ON d.company_id = o.company_id AND d.idempotency_key = o.idempotency_key
        WHERE o.company_id = $1 AND o.status = 'CLAIMED' AND d.outbox_id IS NULL
        ORDER BY o.outbox_id`,
      [companyId],
    );
    ids = result.rows.map((r) => r.outbox_id);
  } finally {
    client.release();
  }
  let dispatched = 0;
  for (const id of ids) {
    const outcome = await unsafeDispatchClaimed(control, id, adapter);
    if (outcome.kind === 'DISPATCHED') dispatched += 1;
  }
  return dispatched;
}
