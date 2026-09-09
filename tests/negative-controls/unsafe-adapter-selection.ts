import type { Pool } from '../../src/db/pool.js';
import type {
  AdapterOutcome,
  DispatchEnvelope,
  ExternalEffectAdapter,
} from '../../src/kernel/gateway/adapterPort.js';

/**
 * TEST-ONLY. TWO DEFECTIVE ADAPTER-SELECTION DESIGNS — `§40` ITEMS 3 AND (VIA `§13`) 13.
 *
 * =================================================================================
 * CONTROL A — THE CALLER CHOOSES THE ADAPTER (`§8`, `§40` item 3)
 *
 * `§8`: "Do not accept `adapter` or `adapterId` as a caller/model-provided execution
 * authority. Adapter selection derives from the accepted closed catalogue / persisted
 * effect metadata. Model cannot select a different adapter at dispatch time."
 *
 * `§8`'s required attack: "authorised effect says adapter A; attacker/caller requests mock
 * adapter B with different semantics."
 *
 * `unsafeDispatchWithChosenAdapter` takes the adapter as a PARAMETER and invokes it for
 * whatever effect the caller names. Everything else about it is correct — it reads the
 * persisted payload, the persisted tag, the committed recoverability — which is what makes
 * it a useful control: the ONLY defect is one parameter, and the defect is total.
 *
 * WHAT IT COSTS. `26 §5` assigns the adapter per action class "in the catalogue, not per
 * request, and never by a model", and `49 §3.1` makes adapters TCB members. An adapter
 * chosen at dispatch time is a TCB member chosen by the subject of the control: a caller
 * that can name the adapter can route a refund's dispatch payload to a component with
 * different semantics, different credentials and a different perimeter row (`48 §2`), while
 * every authorisation, reservation and journal row still reads correctly.
 *
 * PRODUCTION HAS NO SUCH PARAMETER, so the attack is unrepresentable rather than refused:
 * `dispatchAuthorisedEffect` takes a REGISTRY and looks the adapter up by the identity the
 * committed row carries. Installing adapter B under key B changes nothing.
 * =================================================================================
 *
 * =================================================================================
 * CONTROL B — EM6 ELIGIBILITY IGNORED (`§13`, `§40` item 13)
 *
 * `25 §7`: "A provider offering neither an idempotency header nor a delivery-event webhook
 * nor a queryable message log **cannot serve an IRRECOVERABLE class**."
 *
 * `unsafeDispatchIgnoringCapabilities` resolves the adapter from the CATALOGUE correctly —
 * so control A's defect is absent — and simply never checks `resolutionCapabilities`. It
 * dispatches an IRRECOVERABLE effect to an adapter advertising none.
 *
 * WHAT IT COSTS. It is the DUP-01 hole reopened. `25 §7`'s whole reason for existing is
 * that "`26 §5` classifies `email.send` as IRRECOVERABLE, most ESPs offer no idempotency
 * header, and where a message log exists it is eventually consistent — so the rule as
 * written **excludes autonomous email sending**". The outbox was built so the rule could be
 * satisfied rather than relaxed, and `25 §10`'s IRRECOVERABLE unknown branch RESOLVES from
 * "the provider's delivery event matched on the correlation tag". An adapter with no
 * delivery event, no queryable log and no idempotency header leaves `PRESUMED_EXECUTED`
 * permanently unresolvable, so the effect can never reach `VERIFIED` or `NEVER_SENT` and
 * `I20` has nothing to reconcile against.
 * =================================================================================
 */

interface OutboxSnapshot {
  readonly company_id: string;
  readonly idempotency_key: string;
  readonly outbox_id: string;
  readonly claim_id: string | null;
  readonly effect_id: string;
  readonly authorisation_id: string;
  readonly action_class: string;
  readonly resource_ref: string;
  readonly recoverability: string;
  readonly adapter: string;
  readonly dispatch_payload_hash: string;
  readonly payload_canonical_bytes: Buffer;
  readonly correlation_tag: string;
  readonly claim_requires_unmirrored_tag: boolean | null;
  readonly claim_override_id: string | null;
}

async function snapshot(
  control: Pool,
  companyId: string,
  idempotencyKey: string,
): Promise<OutboxSnapshot | undefined> {
  const client = await control.connect();
  try {
    const result = await client.query<OutboxSnapshot>(
      `SELECT company_id, idempotency_key, outbox_id, claim_id, effect_id,
              authorisation_id, action_class, resource_ref, recoverability, adapter,
              dispatch_payload_hash, payload_canonical_bytes, correlation_tag,
              claim_requires_unmirrored_tag, claim_override_id
         FROM dispatch_outbox
        WHERE company_id = $1 AND idempotency_key = $2`,
      [companyId, idempotencyKey],
    );
    return result.rows[0];
  } finally {
    client.release();
  }
}

function envelopeOf(row: OutboxSnapshot, method: string): DispatchEnvelope {
  return {
    companyId: row.company_id,
    outboxId: row.outbox_id,
    claimId: row.claim_id ?? 'claim:unsafe-none',
    effectId: row.effect_id,
    authorisationId: row.authorisation_id,
    idempotencyKey: row.idempotency_key,
    actionClass: row.action_class,
    resourceRef: row.resource_ref,
    recoverability: row.recoverability,
    adapter: row.adapter,
    method,
    dispatchPayloadHash: row.dispatch_payload_hash,
    payloadCanonicalBytes: row.payload_canonical_bytes,
    correlationTag: row.correlation_tag,
    requiresUnmirroredTag: row.claim_requires_unmirrored_tag ?? false,
    overrideId: row.claim_override_id,
  } as unknown as DispatchEnvelope;
}

/** CONTROL A. The adapter is a parameter, so the caller decides who executes. */
export async function unsafeDispatchWithChosenAdapter(
  control: Pool,
  input: { readonly companyId: string; readonly idempotencyKey: string },
  chosenAdapter: ExternalEffectAdapter,
): Promise<AdapterOutcome | null> {
  const row = await snapshot(control, input.companyId, input.idempotencyKey);
  if (row === undefined) return null;
  return chosenAdapter.dispatch(envelopeOf(row, 'unsafeCallerChosenMethod'));
}

/** CONTROL B. The catalogue chooses the adapter; nothing checks EM6 eligibility. */
export async function unsafeDispatchIgnoringCapabilities(
  control: Pool,
  input: { readonly companyId: string; readonly idempotencyKey: string },
  registry: readonly ExternalEffectAdapter[],
): Promise<AdapterOutcome | null> {
  const row = await snapshot(control, input.companyId, input.idempotencyKey);
  if (row === undefined) return null;
  const adapter = registry.find((a) => a.adapterId === row.adapter);
  if (adapter === undefined) return null;
  // `25 §7`'s EM6 criterion is simply not consulted. `adapter.resolutionCapabilities` is
  // right there on the object and nothing reads it.
  return adapter.dispatch(envelopeOf(row, 'unsafeIneligibleMethod'));
}
