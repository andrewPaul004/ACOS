import type { Pool } from '../../src/db/pool.js';
import { claimForExternalDispatch } from '../../src/kernel/outbox/claim.js';
import type { ClaimResult } from '../../src/kernel/outbox/claim.js';
import type { AdapterRegistry } from '../../src/kernel/gateway/adapterRegistry.js';
import { resolveAdapterFor } from '../../src/kernel/gateway/adapterRegistry.js';
import { buildDispatchEnvelope } from '../../src/kernel/gateway/dispatchEnvelope.js';
import type { AdapterOutcome } from '../../src/kernel/gateway/adapterPort.js';
import { activeVerifiedControlArtifacts } from '../../src/kernel/controlArtifacts/registry.js';

/**
 * TEST-ONLY. THE TWO EPOCH-B DEFECTS `25 §14.1` EXISTS TO PREVENT — `§29`, `§32`.
 *
 * =================================================================================
 * CONTROL A — DISPATCH THAT TRUSTS ENQUEUE-TIME VALIDITY (`§29`)
 *
 * `25 §14.1`: "**DISPATCH-TIME REVALIDATION IS MANDATORY, AND A CLAIM MAY NOT OCCUR BEFORE
 * IT.**" `30 §5.1`: "**A claim that occurs before revalidation is a defect of this class.**"
 *
 * `unsafeDispatchWithoutRevalidation` below is that defect, and it is worth being precise
 * about why it looks reasonable. Every input it uses is authoritative and immutable: the
 * committed effect, the persisted canonical payload, the correlation tag, the claim's own
 * eligibility evaluation against CURRENT mirror state. It re-evaluates `30 §5.1` item 4
 * properly. What it does not do is ask whether the AUTHORISED OPTION is still a permissible
 * effect — and between the authorising COMMIT and the claim there is an arbitrarily long,
 * deliberately lock-free gap in which the world moves.
 *
 * `25 §14`'s own words are the property being lost: the second item "does not proceed on
 * stale state". A dispatch that trusts enqueue-time validity proceeds on state that was
 * true when the row was enqueued and may not be true now.
 *
 * THE ATTACK THE TEST BUILDS AROUND IT — `§29`'s five steps: enumerate and canonicalise
 * option A; authorise; let Epoch A release; mutate the authoritative resource so A is no
 * longer valid; attempt dispatch. The control claims and invokes; production refuses the
 * claim with ZERO adapter invocations.
 *
 * IT ALSO HOLDS NO ENTITY LOCK, which is the second half of the same defect. The accepted
 * S1J composition did exactly this — it is the shape SER-01 corrected — so this control is
 * a faithful reproduction of the previous implementation rather than a straw man.
 * =================================================================================
 */
export interface UnsafeDispatchResult {
  readonly claim: ClaimResult;
  readonly invoked: boolean;
  readonly outcome: AdapterOutcome | null;
}

export async function unsafeDispatchWithoutRevalidation(
  control: Pool,
  registry: AdapterRegistry,
  input: {
    readonly companyId: string;
    readonly idempotencyKey: string;
    readonly dispatchedBy: string;
    readonly now: Date;
  },
): Promise<UnsafeDispatchResult> {
  // NO DISPATCH LEASE, AND NO REVALIDATION. Straight to the claim.
  const claim = await claimForExternalDispatch(control, {
    companyId: input.companyId,
    idempotencyKey: input.idempotencyKey,
    claimedBy: input.dispatchedBy,
    now: input.now,
  });
  if (claim.kind === 'REFUSED') return { claim, invoked: false, outcome: null };

  const built = buildDispatchEnvelope(claim.claim.row, activeVerifiedControlArtifacts());
  if (built.kind === 'REFUSED') return { claim, invoked: false, outcome: null };

  const resolution = resolveAdapterFor(registry, {
    adapter: built.envelope.adapter,
    recoverability: built.envelope.recoverability,
  });
  if (resolution.kind === 'REFUSED') return { claim, invoked: false, outcome: null };

  // THE INVOCATION. A stale effect has now crossed the port.
  const outcome = await resolution.adapter.dispatch(built.envelope);
  return { claim, invoked: true, outcome };
}

/**
 * =================================================================================
 * CONTROL B — AN OLD `CLAIMED` ROW PLUS A NEWLY ACQUIRED DISPATCH LEASE (`§32`)
 *
 * `25 §14.1`: "**Reacquiring the dispatch lease is not a recovery mechanism**, and OBX-01's
 * no-reclaim rule is unaffected by the lease's lifetime." And, one sentence earlier: "the
 * row remains `CLAIMED`, the fresh claim capability is gone, and **no restart may acquire a
 * dispatch lease for the purpose of redispatching that row.**"
 *
 * THE DEFECT THIS ENCODES IS A PLAUSIBLE MISREADING OF SER-01 ITSELF. Someone who has just
 * implemented Epoch B might reason: the lease is what serialises the entity, the previous
 * holder crashed and the database released it, so acquiring it again restores the right to
 * proceed. It does not. The lease serialises ENTITY STATE; the FRESH CLAIM CAPABILITY proves
 * this process owns the live successful claim continuation, and only a claim that committed
 * IN THIS EXECUTION mints one.
 *
 * `unsafeDispatchOnPersistedClaim` is that misreading: it reads the persisted `CLAIMED` row,
 * builds an envelope from it and invokes — without a capability, and without a claim of its
 * own. It reaches the adapter because nothing in ITS path stops it, and production does not
 * reach the adapter because the capability is minted at exactly one line in `src/` and that
 * line is downstream of a successful claim.
 *
 * The discrimination a test asserts after a simulated restart:
 *
 *   UNSAFE:     one adapter invocation for a row that was already claimed and dispatched.
 *   PRODUCTION: `CLAIM_REFUSED / ALREADY_CLAIMED`, and `callCount` unchanged.
 * =================================================================================
 */
export async function unsafeDispatchOnPersistedClaim(
  control: Pool,
  registry: AdapterRegistry,
  input: { readonly companyId: string; readonly idempotencyKey: string },
): Promise<{ readonly invoked: boolean; readonly outcome: AdapterOutcome | null }> {
  const client = await control.connect();
  try {
    const row = await client.query<Record<string, unknown>>(
      `SELECT company_id, idempotency_key, outbox_id, effect_id, authorisation_id,
              action_class, recoverability, adapter, resource_ref, dispatch_payload_hash,
              payload_canonical_bytes, correlation_tag, status, enqueued_at,
              claim_id, claimed_at, claimed_by, claim_matched_row, claim_mirror_state,
              claim_requires_unmirrored_tag, claim_override_id, claim_clock_ref
         FROM dispatch_outbox
        WHERE company_id = $1 AND idempotency_key = $2`,
      [input.companyId, input.idempotencyKey],
    );
    const dbRow = row.rows[0];
    if (dbRow === undefined) return { invoked: false, outcome: null };

    // The persisted row, rebuilt into the shape the envelope builder takes. NO CAPABILITY IS
    // MINTED and no claim is attempted — this is the whole point of the control.
    const claiming = {
      companyId: dbRow['company_id'] as string,
      idempotencyKey: dbRow['idempotency_key'] as string,
      outboxId: dbRow['outbox_id'] as string,
      effectId: dbRow['effect_id'] as string,
      authorisationId: dbRow['authorisation_id'] as string,
      actionClass: dbRow['action_class'] as string,
      recoverability: dbRow['recoverability'] as string,
      adapter: dbRow['adapter'] as string,
      resourceRef: dbRow['resource_ref'] as string,
      dispatchPayloadHash: dbRow['dispatch_payload_hash'] as string,
      payloadCanonicalBytes: dbRow['payload_canonical_bytes'] as Buffer,
      correlationTag: dbRow['correlation_tag'] as string,
      status: dbRow['status'] as string,
      enqueuedAt: dbRow['enqueued_at'] as Date,
      claimId: dbRow['claim_id'] as string | null,
      claimedAt: dbRow['claimed_at'] as Date | null,
      claimedBy: dbRow['claimed_by'] as string | null,
      claimMatchedRow: dbRow['claim_matched_row'] as number | null,
      claimMirrorState: dbRow['claim_mirror_state'] as string | null,
      claimRequiresUnmirroredTag: dbRow['claim_requires_unmirrored_tag'] as boolean | null,
      claimOverrideId: dbRow['claim_override_id'] as string | null,
      claimClockRef: dbRow['claim_clock_ref'] as string | null,
    };

    const built = buildDispatchEnvelope(claiming as never, activeVerifiedControlArtifacts());
    if (built.kind === 'REFUSED') return { invoked: false, outcome: null };

    const resolution = resolveAdapterFor(registry, {
      adapter: built.envelope.adapter,
      recoverability: built.envelope.recoverability,
    });
    if (resolution.kind === 'REFUSED') return { invoked: false, outcome: null };

    const outcome = await resolution.adapter.dispatch(built.envelope);
    return { invoked: true, outcome };
  } finally {
    client.release();
  }
}
