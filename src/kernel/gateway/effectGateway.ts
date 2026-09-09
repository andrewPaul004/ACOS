import type { Pool } from '../../db/pool.js';
import { claimForExternalDispatch } from '../outbox/claim.js';
import type { ClaimRefusal } from '../outbox/outboxState.js';
import type { AdapterOutcome, DispatchEnvelope } from './adapterPort.js';
import {
  resolveAdapterFor,
  type AdapterRegistry,
  type AdapterResolutionRefusal,
} from './adapterRegistry.js';
import {
  consumeFreshDispatchCapability,
  mintDispatchAttestation,
  mintFreshDispatchCapability,
  revokeFreshDispatchCapability,
  type CapabilityRefusal,
  type DispatchAttestation,
  type DispatchIdentity,
} from './dispatchCapability.js';
import { buildDispatchEnvelope, type EnvelopeRefusal } from './dispatchEnvelope.js';
import type { UndeclaredPolicyReason } from './outcomePolicy.js';
import {
  processAdapterOutcome,
  type DispatchOutcomeRecord,
  type OutcomeRefusal,
} from './outcomeTransaction.js';

/**
 * THE EFFECT GATEWAY'S DISPATCH COMPOSITION. THE SOLE PRODUCTION EXTERNAL-EFFECT PATH.
 *
 * =================================================================================
 * WHAT THE ARCHITECTURE SAYS THIS COMPONENT IS
 *
 * `33 §1`: "Every external state change passes through one deterministic chokepoint, the
 * Effect Gateway." `24 §3` K4: "The deterministic chokepoint for every external effect
 * originating in AI reasoning (`23 §5`)". `48 §1` sharpens the claim into the only form
 * that is worth anything:
 *
 *     "***'The only permitted path'* is a policy. *'The only capable path'* is an
 *      architecture.** v1.0 established the first and claimed the second."
 *
 * `48 §4` item 1 names the mechanism: "One vendor-HTTP client per adapter. No ad-hoc HTTP
 * construction anywhere in the codebase." At S1J there is no vendor-HTTP client at all, so
 * the property to hold is the narrower one `36 §7` states: "Every adapter method is
 * reachable **only** through the Effect Gateway. Verified by a static check that no adapter
 * method is exported to any other caller."
 *
 * `no-real-transport-boundary.test.ts` is that static check, and it asserts:
 *
 *   - this file is the ONLY production file that calls `.dispatch(` on an adapter;
 *   - this file is the ONLY production file that mints a fresh-claim capability;
 *   - this file is the ONLY production file that mints a dispatch attestation;
 *   - no production file imports the deterministic mock, and no production file imports
 *     anything from `tests/`;
 *   - `src/` contains no `ExternalEffectAdapter` implementation at all.
 * =================================================================================
 *
 * =================================================================================
 * `30 §5.1` ITEM 3'S ORDERING BLOCK, COMPLETED — AND `§6` OF THE MANDATE
 *
 * `25 §7` (v1.3.4, OBX-03) prints the whole arrow chain:
 *
 *     "current claim-time authority evaluation → **exclusive durable claim** → COMMIT →
 *      transport"
 *
 * and adds the sentence that puts the call outside the transaction: "**This does not place
 * the HTTP request inside the database transaction.** The transaction commits and *then*
 * transport runs; `§7`'s own sentence — the row transitions to `CLAIMED` *'in a committed
 * transaction **before** the HTTP call'* — is what puts the call outside it."
 *
 * THE ORDER IS STRUCTURAL IN THIS FUNCTION, NOT CHECKED BY IT. `claimForExternalDispatch`
 * opens its own connection, runs `BEGIN`, evaluates `30 §5.1` item 4 against current state,
 * writes the journal row and the claim, and issues `COMMIT` before its promise resolves. So
 * the `await` on line one of step 1 IS the commit barrier, and step 4's invocation is
 * unreachable until it has passed. There is no branch, no flag and no configuration that
 * reorders them, and:
 *
 *   - no adapter is invoked before the claim commits;
 *   - no adapter is invoked inside the claim transaction — this function holds no client
 *     and cannot pass one to an adapter;
 *   - there is no distributed transaction across the database and the adapter;
 *   - and there is no path that invokes an adapter and then claims.
 *
 * `§6`'s "direct event-order instrumentation" is the optional `events` observer: the gateway
 * emits `CLAIM_COMMITTED`, the deterministic mock pushes `MOCK_ADAPTER_INVOKED` into the
 * same log, and `gateway-composition.test.ts` asserts the first always precedes the second.
 * =================================================================================
 *
 * =================================================================================
 * WHAT A WORKER SEES — `§34`
 *
 * "No worker/model surface may: obtain adapter instance; call adapter port; supply fresh
 *  claim capability; submit adapter outcome; select outcome; mutate outbox."
 *
 * A worker-facing caller of this function supplies FOUR SCALARS and a registry that was
 * built at process wiring time. It does not supply an adapter, an adapter identity, a
 * payload, a correlation tag, a recoverability, an outcome, a capability, an attestation or
 * an eligibility operand — none of those is a parameter. What it receives back is a
 * `GatewayResult` whose refusal arms carry a declared category and no near-miss detail
 * beyond the declared refusal strings, which is `26 §7`'s coarse-denial rule ("A model that
 * learns 'denied: amount exceeded by $3' has been handed a probing oracle") applied to the
 * dispatch stage.
 *
 * THE CAPABILITY AND THE ATTESTATION NEVER LEAVE THIS FUNCTION. Both are minted, used and
 * dropped inside one call. Neither is a field of `GatewayResult`, so there is no worker
 * surface they could reach even by accident, and both throw on `toJSON`.
 * =================================================================================
 */

/** `§6`'s ordering instrumentation. Diagnostic only; no decision reads one. */
export const GATEWAY_EVENTS = [
  'CLAIM_COMMITTED',
  'CAPABILITY_MINTED',
  'ADAPTER_RESOLVED',
  'ENVELOPE_BUILT',
  'CAPABILITY_CONSUMED',
  'ADAPTER_RETURNED',
  'ATTESTATION_MINTED',
  'OUTCOME_COMMITTED',
] as const;

export type GatewayEvent = (typeof GATEWAY_EVENTS)[number];

export type GatewayResult =
  | {
      /**
       * THE NAME IS `OUTCOME_RESOLVED`, NOT `DISPATCHED` — DELIBERATELY.
       *
       * The ACCEPTED `no-transport-boundary.test.ts` asserts that the literal
       * `'DISPATCHED'` appears nowhere in `src/`, because `§41` of the S1I mandate forbids
       * blurring `CLAIMED` with a dispatched state and v1.3.4 declares no `DISPATCHED`
       * state for anything. That assertion is UNAMENDED by S1J, and this arm is named for
       * what it reports: one adapter invocation produced a typed outcome and the local
       * consequence of it is committed. It does not report that a provider accepted, that
       * the world changed, or that anything was verified.
       */
      readonly kind: 'OUTCOME_RESOLVED';
      readonly record: DispatchOutcomeRecord;
      /** `§6`: the claim's own journal sequence, so a test can order the two rows. */
      readonly claimJournalSeq: bigint;
    }
  | { readonly kind: 'CLAIM_REFUSED'; readonly reason: ClaimRefusal; readonly detail: string }
  | {
      readonly kind: 'ADAPTER_REFUSED';
      readonly reason: AdapterResolutionRefusal;
      readonly detail: string;
    }
  | {
      readonly kind: 'ENVELOPE_REFUSED';
      readonly reason: EnvelopeRefusal;
      readonly detail: string;
    }
  | {
      readonly kind: 'CAPABILITY_REFUSED';
      readonly reason: CapabilityRefusal;
      readonly detail: string;
    }
  | {
      readonly kind: 'OUTCOME_REFUSED';
      readonly reason: OutcomeRefusal;
      readonly detail: string;
      readonly undeclared?: UndeclaredPolicyReason;
    };

export interface DispatchHooks {
  /**
   * TEST-ONLY. Inside the claim transaction, after the row lock. KILL POINT 1 — "before
   * claim commits". Passed straight through to the ACCEPTED S1I claim service.
   */
  readonly afterClaimLock?: () => Promise<void>;
  /** TEST-ONLY. KILL POINT 2 — after claim COMMIT, before any adapter is invoked. */
  readonly afterClaimCommit?: () => Promise<void>;
  /**
   * TEST-ONLY. KILL POINT 4 — after the adapter returned, before the outcome transaction.
   *
   * It RECEIVES THE ATTESTATION for the invocation that just happened, because `§25`'s race
   * needs two outcome-processing transactions for ONE mock attempt and the attestation is
   * the only honest way to have one: it is minted by the invocation and cannot be
   * fabricated. Handing it to a hook keeps the second processing an equally real
   * processing of the same attempt rather than a second invocation.
   *
   * Production passes no hooks at all, and `no-real-transport-boundary.test.ts` asserts no
   * production caller supplies one.
   */
  readonly afterAdapterReturned?: (attempt: {
    readonly attestation: DispatchAttestation;
    readonly identity: DispatchIdentity;
  }) => Promise<void>;
  /** TEST-ONLY. Inside the outcome transaction, after the row lock, before any write. */
  readonly afterOutcomeLock?: () => Promise<void>;
  /** TEST-ONLY. Inside the outcome transaction, after both writes, before its COMMIT. */
  readonly beforeOutcomeCommit?: () => Promise<void>;
  /** TEST-ONLY. KILL POINT 5 — after the outcome transaction committed. */
  readonly afterOutcomeCommit?: () => Promise<void>;
}

/**
 * Claim one authorised effect and hand it to its trusted adapter. THE WHOLE COMPOSITION.
 *
 * =================================================================================
 * THE STEPS, AND THE ONE-WAY DOORS BETWEEN THEM
 *
 *   1. CLAIM. The ACCEPTED S1I `claimForExternalDispatch`, imported and not reimplemented.
 *      It evaluates `30 §5.1` item 4 against CURRENT state, takes the exclusive claim, and
 *      COMMITS. A refusal ends the call with nothing written and nothing invoked.
 *
 *   2. MINT. The fresh-claim capability, for the claim that just committed IN THIS
 *      EXECUTION. `§5`: a persisted `CLAIMED` row is not enough to reach step 4, and after
 *      this process dies there is no way back to this line.
 *
 *   3. RESOLVE AND BUILD. The trusted adapter, from the identity the committed row carries
 *      (`§8`), with `25 §7`'s EM6 eligibility checked BEFORE invocation (`§13`); and the
 *      frozen envelope, from the persisted payload snapshot (`§10`), the persisted
 *      correlation tag (`§11`) and the claim's degraded-state requirement (`§12`).
 *
 *      EVERY REFUSAL HERE REVOKES THE CAPABILITY. The claim stays committed and
 *      non-reclaimable — `I36` — and what is discarded is the permission to invoke, so no
 *      later line in this process can pick it up.
 *
 *   4. INVOKE. `consumeFreshDispatchCapability` first, so the capability is spent BEFORE
 *      the call rather than after it: a capability spent afterwards would still be live
 *      during the call, and an adapter that re-entered the gateway could use it. Then, and
 *      only then, `adapter.dispatch(envelope)`.
 *
 *   5. ATTEST AND RESOLVE LOCALLY. The typed outcome is attested in-process and handed to
 *      `processAdapterOutcome`, which reads every authority operand from committed state
 *      and commits the outcome row and its journal row atomically.
 * =================================================================================
 *
 * =================================================================================
 * WHAT HAPPENS IF STEP 4 THROWS, AND WHY IT IS NOT A RETRY
 *
 * An adapter that throws rather than returning a typed outcome has told the kernel nothing.
 * The throw propagates: no outcome row, no journal row, no ledger movement, and the claim
 * still committed. So the effect is exactly where a crash between claim and outcome leaves
 * it — a `CLAIMED` row with no durable outcome, which is `§23`'s intentionally ambiguous
 * state and `I9`'s detector's subject.
 *
 * THE GATEWAY DOES NOT CATCH IT AND CONVERT IT TO `OUTCOME_UNKNOWN`. That would be the
 * gateway deciding what the adapter's failure MEANT, and `§14` puts that decision in the
 * adapter, which is a TCB member (`49 §3.1`). An adapter that knows its call was ambiguous
 * returns `OUTCOME_UNKNOWN`; one that knows it failed returns `ADAPTER_FAILED`; one that
 * throws has abdicated, and the safe reading of an abdication is "unknown, unresolved,
 * never re-dispatched", which is what the committed claim already guarantees.
 * =================================================================================
 */
export async function dispatchAuthorisedEffect(
  control: Pool,
  registry: AdapterRegistry,
  input: {
    readonly companyId: string;
    readonly idempotencyKey: string;
    /** The dispatching worker's identity, for the audit trail. Not an authority operand. */
    readonly dispatchedBy: string;
    readonly now: Date;
  },
  options?: {
    readonly hooks?: DispatchHooks;
    /** `§6`'s ordering instrumentation. Diagnostic; production passes none. */
    readonly events?: (event: GatewayEvent) => void;
  },
): Promise<GatewayResult> {
  const emit = (event: GatewayEvent): void => options?.events?.(event);
  const hooks = options?.hooks;

  // ---------------------------------------------------------------------------------
  // STEP 1 — THE CLAIM. `25 §7`: "in a committed transaction BEFORE the HTTP call."
  //
  // The ACCEPTED S1I service, IMPORTED. `§13` of the S1I mandate — "Do not create an
  // alternate dispatch precedence implementation" — applies to the whole claim, and this
  // function reimplements none of it: no eligibility evaluation, no override allowance, no
  // clock derivation and no state write happens here.
  // ---------------------------------------------------------------------------------
  const claimed = await claimForExternalDispatch(
    control,
    {
      companyId: input.companyId,
      idempotencyKey: input.idempotencyKey,
      claimedBy: input.dispatchedBy,
      now: input.now,
    },
    hooks?.afterClaimLock === undefined ? undefined : { afterLock: hooks.afterClaimLock },
  );
  if (claimed.kind === 'REFUSED') {
    return { kind: 'CLAIM_REFUSED', reason: claimed.reason, detail: claimed.detail };
  }
  // The promise resolved, so `inTransaction` has issued COMMIT. Everything below this line
  // is after the claim is durable and visible to a separate connection.
  emit('CLAIM_COMMITTED');

  // ---------------------------------------------------------------------------------
  // STEP 2 — THE FRESH-CLAIM CAPABILITY. THE ONLY MINT SITE IN `src/`.
  // ---------------------------------------------------------------------------------
  const built = buildDispatchEnvelope(claimed.claim.row);
  if (built.kind === 'REFUSED') {
    return { kind: 'ENVELOPE_REFUSED', reason: built.reason, detail: built.detail };
  }
  const capability = mintFreshDispatchCapability(built.identity, input.now);
  emit('CAPABILITY_MINTED');
  emit('ENVELOPE_BUILT');

  /*
   * THE CAPABILITY DOES NOT OUTLIVE THIS CALL, ON ANY PATH — `§5`, `§24`.
   *
   * Everything from here on runs inside a `try` whose `finally` revokes. `consume` already
   * deletes the entry, so the revoke is a no-op on the success path; what it closes is
   * every OTHER exit — a refused resolution, a refused envelope, a hook that throws at a
   * kill point, an adapter that throws instead of returning a typed outcome, a failed
   * outcome transaction.
   *
   * Without it, a crash between the claim's COMMIT and the invocation would leave a LIVE
   * capability in this process's memory, and a later line in the same process could pick it
   * up and dispatch — which is `§5`'s defect with a shorter reach. `fresh-claim.test.ts`
   * asserts `liveCapabilityCount()` returns to zero after each of those exits.
   */
  try {
    if (hooks?.afterClaimCommit !== undefined) await hooks.afterClaimCommit();

    // ---------------------------------------------------------------------------------
    // STEP 3 — TRUSTED CLOSED ADAPTER RESOLUTION, AND EM6 ELIGIBILITY. BEFORE INVOCATION.
    // ---------------------------------------------------------------------------------
    const resolution = resolveAdapterFor(registry, {
      adapter: built.envelope.adapter,
      recoverability: built.envelope.recoverability,
    });
    if (resolution.kind === 'REFUSED') {
      // The `finally` revokes; the claim stays committed and non-reclaimable (`I36`).
      return { kind: 'ADAPTER_REFUSED', reason: resolution.reason, detail: resolution.detail };
    }
    emit('ADAPTER_RESOLVED');

    // ---------------------------------------------------------------------------------
    // STEP 4 — THE INVOCATION. THE ONLY `.dispatch(` CALL SITE IN `src/`.
    // ---------------------------------------------------------------------------------
    const consumption = consumeFreshDispatchCapability(capability, built.identity);
    if (consumption.kind === 'REFUSED') {
      return {
        kind: 'CAPABILITY_REFUSED',
        reason: consumption.reason,
        detail: consumption.detail,
      };
    }
    emit('CAPABILITY_CONSUMED');

    const envelope: DispatchEnvelope = built.envelope;
    const outcome: AdapterOutcome = await resolution.adapter.dispatch(envelope);
    emit('ADAPTER_RETURNED');

    const attestation = mintDispatchAttestation({
      identity: built.identity,
      adapterId: resolution.adapter.adapterId,
      requiresUnmirroredTag: envelope.requiresUnmirroredTag,
      // `§12`: what the GATEWAY put on the envelope, recorded independently of what the
      // adapter did with it. `0012`'s CHECK requires it to equal the claim's requirement, so
      // a mapper that dropped the tag cannot produce a committed outcome row.
      unmirroredTagSent: envelope.requiresUnmirroredTag,
      invokedAt: input.now,
      outcomeKind: outcome.kind,
      providerReference: outcome.kind === 'ADAPTER_RETURNED' ? outcome.providerReference : null,
      rawResponseHash: outcome.kind === 'ADAPTER_RETURNED' ? outcome.rawResponseHash : null,
    });
    emit('ATTESTATION_MINTED');

    if (hooks?.afterAdapterReturned !== undefined) {
      await hooks.afterAdapterReturned({ attestation, identity: built.identity });
    }

    // ---------------------------------------------------------------------------------
    // STEP 5 — THE LOCAL OUTCOME TRANSACTION.
    // ---------------------------------------------------------------------------------
    const resolved = await processAdapterOutcome(
      control,
      { attestation, identity: built.identity, now: input.now },
      {
        ...(hooks?.afterOutcomeLock === undefined ? {} : { afterLock: hooks.afterOutcomeLock }),
        ...(hooks?.beforeOutcomeCommit === undefined
          ? {}
          : { beforeReturn: hooks.beforeOutcomeCommit }),
      },
    );
    if (resolved.kind === 'REFUSED') {
      return {
        kind: 'OUTCOME_REFUSED',
        reason: resolved.reason,
        detail: resolved.detail,
        ...(resolved.undeclared === undefined ? {} : { undeclared: resolved.undeclared }),
      };
    }
    emit('OUTCOME_COMMITTED');

    if (hooks?.afterOutcomeCommit !== undefined) await hooks.afterOutcomeCommit();

    return {
      kind: 'OUTCOME_RESOLVED',
      record: resolved.record,
      claimJournalSeq: claimed.claim.journalSeq,
    };
  } finally {
    revokeFreshDispatchCapability(capability);
  }
}
