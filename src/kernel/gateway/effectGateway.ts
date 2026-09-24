import type { Pool } from '../../db/pool.js';
import type { VerifiedControlArtifactBundle } from '../controlArtifacts/bundle.js';
import type { EffectEnumerator } from '../enumeration/enumerateEffects.js';
import { withSerialisationRetry } from '../exposure/retry.js';
import { claimForExternalDispatchOn } from '../outbox/claim.js';
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
import { DispatchLeaseManager, entityKeyForResourceRef } from './dispatchLease.js';
import { revalidateAuthorisedEffectUnderLease } from './dispatchRevalidation.js';
import type { UndeclaredPolicyReason } from './outcomePolicy.js';
import {
  outcomeIsolationFor,
  processAdapterOutcomeOnClient,
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
 * `25 §14.1`'s TWO EPOCHS — WHAT v1.3.5 CHANGED ABOUT THIS FILE
 *
 * The accepted S1J composition ran `claim → invoke → outcome` with NO ENTITY LOCK HELD at
 * any point, because `25 §14`'s single propose→authorise→execute span was not achievable
 * across `25 §7`'s own asynchronous outbox and no artifact declared a replacement.
 * `phase2-v1.3.5-errata.md §2` (SER-01) declares the replacement, and this file implements
 * its second epoch end to end:
 *
 *     acquire the DISPATCH LEASE   →  revalidate  →  claim  →  COMMIT  →  adapter  →
 *       outcome transaction  →  COMMIT  →  release the dispatch lease
 *
 * TWO OBLIGATIONS ARE NEW AND BOTH ARE MANDATORY: the entity advisory lock is REACQUIRED on
 * a new session and held across all seven steps, and the originally authorised effect is
 * REVALIDATED against current authoritative state BEFORE the claim. `30 §5.1`: "A claim
 * that occurs before revalidation is a defect of this class, and a revalidation performed
 * outside the dispatch lease proves nothing."
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
 * THE ORDER IS STRUCTURAL IN THIS FUNCTION, NOT CHECKED BY IT. `claimForExternalDispatchOn`
 * runs `BEGIN` ON THE DISPATCH LEASE'S OWN CONNECTION, evaluates `30 §5.1` item 4 against
 * current state, writes the journal row and the claim, and issues `COMMIT` before its
 * promise resolves. So the `await` on the claim IS the commit barrier, and the invocation is
 * unreachable until it has passed. The connection is the lease's because `25 §14.1` requires
 * the claim to commit INSIDE Epoch B, and a session-scoped advisory lock covers only its own
 * session's transactions. There is no branch, no flag and no configuration that
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
 * A worker-facing caller of this function supplies FOUR SCALARS and an ENVIRONMENT that was
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

/**
 * THE DISPATCH ENVIRONMENT — Epoch B's four collaborators, wired at process start.
 *
 * =================================================================================
 * WHY THE SIGNATURE CHANGED, AND WHAT IT BUYS
 *
 * The accepted S1J gateway took `(control, registry, input, options)`. `25 §14.1` adds two
 * obligations that cannot be met from those four values:
 *
 *   the DISPATCH LEASE      a session-scoped advisory lock on the effect's entity, acquired
 *                           before anything else and held through the outcome COMMIT
 *   the REVALIDATION        a live re-enumeration of the CURRENT permissible effects
 *
 * Both need collaborators — a lease manager and the accepted enumeration core — and
 * `25 §14.1` makes both MANDATORY. So they are REQUIRED MEMBERS of the environment rather
 * than optional members of the options bag: an options bag with a required member is a
 * required argument wearing a disguise, and a gateway that could be constructed without a
 * revalidator would be a gateway with a code path that skips a mandatory check.
 *
 * `no-real-transport-boundary.test.ts` asserts the exported surface against a hand-authored
 * list, so the shape is checked rather than described.
 *
 * IT IS STILL NOT A WORKER SURFACE. A worker-facing caller supplies FOUR SCALARS in `input`
 * and nothing else; the environment is built at process wiring time from components the
 * kernel owns. It does not supply an adapter, an adapter identity, a payload, a correlation
 * tag, a recoverability, an outcome, a capability, an attestation, an eligibility operand, a
 * lock key, a context spec or an option id — none of those is a parameter anywhere on this
 * path.
 * =================================================================================
 */
export interface DispatchEnvironment {
  readonly control: Pool;
  readonly registry: AdapterRegistry;
  /**
   * `50 §3f`'s PRE-LIVE EXTERNAL-EFFECT GATE — v1.3.6, and it is a REQUIRED field.
   *
   * `50 §3f`, the pre-authority / pre-claim gate, verbatim: "**external claim and dispatch
   * cannot proceed if the verified bundle is unavailable or invalid.**"
   *
   * The capability is a required member of the environment rather than something this
   * module fetches, so the dependency is TYPE-LEVEL: a composition that wired a real
   * adapter into this gateway could not construct a `DispatchEnvironment` without holding a
   * bundle that `50 §3f` occasion 1 or 2 produced, and the bundle cannot be manufactured
   * (`controlArtifacts/bundle.ts`). `§51` of the S1K mandate: "A future real-adapter
   * composition must not be able to bypass this."
   *
   * It is also the bundle the dispatch path READS its catalogue authority from — the
   * adapter and recoverability the envelope is checked against — so the gate is not a token
   * carried beside the decision but the source of it.
   */
  readonly controlArtifacts: VerifiedControlArtifactBundle;
  /** `25 §14.1` Epoch B. NEVER an `EntityLeaseManager` handed in as "the lease". */
  readonly leases: DispatchLeaseManager;
  /** The ACCEPTED S1C enumeration core, for `25 §14.1`'s live re-enumeration. */
  readonly enumerator: EffectEnumerator;
}

/** `§6`'s ordering instrumentation. Diagnostic only; no decision reads one. */
export const GATEWAY_EVENTS = [
  /** `25 §14.1` Epoch B step 0. The entity lock, on a NEW session. */
  'DISPATCH_LEASE_ACQUIRED',
  /** `25 §14.1` Epoch B step 1, and `30 §5.1`'s "never before it". */
  'REVALIDATED',
  'CLAIM_COMMITTED',
  'CAPABILITY_MINTED',
  'ADAPTER_RESOLVED',
  'ENVELOPE_BUILT',
  'CAPABILITY_CONSUMED',
  'ADAPTER_RETURNED',
  'ATTESTATION_MINTED',
  'OUTCOME_COMMITTED',
  /** Epoch B ends. Emitted after the outcome COMMIT and never before it. */
  'DISPATCH_LEASE_RELEASED',
] as const;

export type GatewayEvent = (typeof GATEWAY_EVENTS)[number];

export type GatewayResult =
  | {
      /**
       * THE NAME IS `OUTCOME_RESOLVED`, NOT `DISPATCHED` — DELIBERATELY.
       *
       * The ACCEPTED `no-transport-boundary.test.ts` asserts that the literal
       * `'DISPATCHED'` appears nowhere in `src/`, because `§41` of the S1I mandate forbids
       * blurring `CLAIMED` with a dispatched state. That assertion is UNAMENDED, and this
       * arm is named for what it reports: one adapter invocation produced a typed outcome
       * and the local consequence of it is committed. It does not report that a provider
       * accepted, that the world changed, or that anything was verified.
       */
      readonly kind: 'OUTCOME_RESOLVED';
      readonly record: DispatchOutcomeRecord;
      /** `§6`: the claim's own journal sequence, so a test can order the two rows. */
      readonly claimJournalSeq: bigint;
      /**
       * `25 §10.1`'s "every applicable MIE window instance", as a value.
       *
       * Empty where the outcome moved no ledger term. Present so "every, not the first"
       * is asserted against the gateway's own report rather than inferred from balances.
       */
      readonly movedWindows: readonly {
        readonly windowId: string;
        readonly windowInstanceKey: string;
      }[];
    }
  | {
      /**
       * `25 §14.1`'s stale-effect refusal. THE COARSE ONE, AND IT IS THE ONLY ONE.
       *
       * `25 §14.1`: "**If the originally authorised option or effect is no longer valid,
       * the claim is REFUSED.** Nothing is dispatched and nothing is substituted. **The
       * economic reservation remains held**, pending the cancellation and expiry paths
       * declared elsewhere; leaving it held is the safe direction, and no release semantics
       * are invented at this boundary. The stale reason is recorded internally and the
       * denial returned to any model-facing caller is coarse, under `26 §2.2`'s probing
       * rule."
       *
       * SO THERE IS ONE REASON LITERAL AND ONE FIXED DETAIL STRING. Every member of
       * `DispatchStaleReason` — "the option is gone", "the resource is gone", "the
       * constructor moved", "the enumeration is gone" — collapses to this, exactly as
       * `workerFacingDenial.ts` collapses the four selector codes to one `SELECTOR`
       * category. Distinguishing them would hand a dispatch-capable caller an existence
       * oracle over the resource, which is the attack `26 §2.2` and `36 §2` VC-C2 close at
       * the enumeration boundary and which does not become safe one epoch later.
       *
       * The precise reason is available to the KERNEL from
       * `revalidateAuthorisedEffectUnderLease`, which the focused suite calls directly.
       */
      readonly kind: 'REVALIDATION_REFUSED';
      readonly reason: 'DISPATCH_EFFECT_STALE';
      readonly detail: string;
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
   * TEST-ONLY. KILL POINT 0 — inside Epoch B, after the dispatch lease is held and after
   * revalidation passed, before the claim transaction opens.
   *
   * The interleaving point `30 §5.1`'s "no ACOS-authorised entity mutation can intervene"
   * is proved at: a competitor session attempts a legitimate mutation requiring the same
   * entity lock while this hook blocks, and must not obtain it until Epoch B ends.
   */
  readonly afterRevalidation?: () => Promise<void>;
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
  /** TEST-ONLY. Inside the outcome transaction, after the balance locks, before the movement. */
  readonly beforeLedgerMovement?: () => Promise<void>;
  /** TEST-ONLY. Inside the outcome transaction, after the movement, before the journal row. */
  readonly afterLedgerMovement?: () => Promise<void>;
  /** TEST-ONLY. Inside the outcome transaction, after the journal row, before the outcome row. */
  readonly afterJournalRow?: () => Promise<void>;
  /** TEST-ONLY. Inside the outcome transaction, after every write, before its COMMIT. */
  readonly beforeOutcomeCommit?: () => Promise<void>;
  /** TEST-ONLY. KILL POINT 5 — after the outcome transaction committed, lease still held. */
  readonly afterOutcomeCommit?: () => Promise<void>;
}

/**
 * Claim one authorised effect and hand it to its trusted adapter. THE WHOLE COMPOSITION.
 *
 * =================================================================================
 * EPOCH B, END TO END — `25 §14.1` AND `30 §5.1`'s ORDERING BLOCK
 *
 * `30 §5.1` prints the order this function implements, and it is implemented in exactly
 * this order with no branch, flag or configuration that reorders it:
 *
 *     acquire the DISPATCH LEASE            -- a NEW session, held through the outcome COMMIT
 *       dispatch-time revalidation          -- refuse if the authorised effect is stale
 *       BEGIN … claim … COMMIT              -- the exclusive durable claim
 *       adapter invocation                  -- outside every transaction
 *       BEGIN … outcome + journal + ledger movement … COMMIT
 *     release the dispatch lease
 *
 * THE ORDER IS STRUCTURAL, NOT CHECKED. Steps 2 and 3 are `await`s inside the lease
 * callback, and the claim is unreachable until revalidation has resolved because it is the
 * next statement. `30 §5.1`: "**A claim that occurs before revalidation is a defect of this
 * class**, and **a revalidation performed outside the dispatch lease proves nothing**."
 * Both are closed here by construction:
 *
 *   - `revalidateAuthorisedEffectUnderLease` takes a `HeldDispatchLease` and calls
 *     `assertHeld` twice, so it CANNOT be called outside the lease;
 *   - nothing between the lease acquisition and the release releases or reacquires it.
 *
 * BOTH TRANSACTIONS RUN ON THE LEASE'S OWN CLIENT. The lease is a SESSION-level advisory
 * lock living in one connection; a transaction opened on a different pooled connection
 * would be a transaction the lock does not cover. `claimForExternalDispatchOn` and
 * `processAdapterOutcomeOnClient` both take a client for exactly this reason, and
 * `dispatch-lease-continuity.test.ts` measures it from a THIRD session by backend pid and
 * `pg_locks` rather than by an application boolean.
 * =================================================================================
 *
 * =================================================================================
 * WHAT HAPPENS IF THE INVOCATION THROWS, AND WHY IT IS NOT A RETRY
 *
 * An adapter that throws rather than returning a typed outcome has told the kernel nothing.
 * The throw propagates: no outcome row, no journal row, no ledger movement, and the claim
 * still committed. So the effect is exactly where a crash between claim and outcome leaves
 * it — a `CLAIMED` row with no durable outcome, which is `§23`'s intentionally ambiguous
 * state and `I9`'s detector's subject.
 *
 * THE GATEWAY DOES NOT CATCH IT AND CONVERT IT TO `OUTCOME_UNKNOWN`, AND IT ESPECIALLY DOES
 * NOT CONVERT IT TO `NOT_SENT_CONFIRMED`. `25 §7.2`: the confirmed-not-sent classification
 * "may be returned only by a trusted adapter, and only where the adapter can positively
 * establish from its own control flow or from typed provider semantics that NO EXTERNAL
 * WRITE CROSSED THE TRANSPORT BOUNDARY", and a thrown exception establishes nothing.
 * `tests/negative-controls/unsafe-false-not-sent.ts` is the discriminating control: a mock
 * that crosses its own acceptance point and THEN throws, mapped by an unsafe mapper to
 * `NOT_SENT_CONFIRMED`, releases a commitment for an effect that may have happened.
 * =================================================================================
 */
export async function dispatchAuthorisedEffect(
  env: DispatchEnvironment,
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
  // THE ENTITY KEY, READ BEFORE THE LEASE — AND IT IS AN IDENTITY, NOT STATE.
  //
  // `25 §14.1` requires "the **same architecture entity advisory-lock key** for the
  // effect's resource", and the key is derived from the committed `resource_ref`. That ref
  // must therefore be read before the lock can be taken, which is unavoidable and is safe:
  // `resource_ref` is on an append-only row and is immutable from the instant S1F committed
  // it. What is read here decides WHICH LOCK TO TAKE; every value that decides whether to
  // DISPATCH is read after the lock, under it.
  // ---------------------------------------------------------------------------------
  const located = await env.control.query<{ resource_ref: string }>(
    `SELECT resource_ref FROM dispatch_outbox
      WHERE company_id = $1 AND idempotency_key = $2`,
    [input.companyId, input.idempotencyKey],
  );
  const resourceRef = located.rows[0]?.resource_ref;
  if (resourceRef === undefined) {
    // The same refusal the claim service would give, reached one step earlier because there
    // is no entity to lock. Coarse, and identical in shape to the claim's own.
    return {
      kind: 'CLAIM_REFUSED',
      reason: 'OUTBOX_ROW_NOT_FOUND',
      detail: `no outbox row for ${input.companyId}/${input.idempotencyKey}`,
    };
  }
  const entityKey = entityKeyForResourceRef(input.companyId, resourceRef);

  // ---------------------------------------------------------------------------------
  // EPOCH B OPENS. `25 §14.1`: a NEW PostgreSQL session, held continuously, released only
  // after the outcome COMMIT. `withDispatchLease`'s `finally` is what makes "released
  // always happens" true on every exit — a refusal, a throw, a hook that kills the process
  // path — and the database releases it on connection loss, which is the crash case.
  // ---------------------------------------------------------------------------------
  return env.leases.withDispatchLease(entityKey, async (lease) => {
    emit('DISPATCH_LEASE_ACQUIRED');
    try {
      // -----------------------------------------------------------------------------
      // STEP 1 — DISPATCH-TIME REVALIDATION. MANDATORY, AND BEFORE THE CLAIM.
      // -----------------------------------------------------------------------------
      const revalidation = await revalidateAuthorisedEffectUnderLease(lease, env.enumerator, {
        companyId: input.companyId,
        idempotencyKey: input.idempotencyKey,
      });
      if (revalidation.kind === 'STALE') {
        // NOTHING IS CLAIMED, NOTHING IS INVOKED, NOTHING IS SUBSTITUTED, AND NOTHING IS
        // RELEASED. `25 §14.1`: "The economic reservation remains held [...] no release
        // semantics are invented at this boundary." The reservation is untouched because no
        // statement here touches it, which is the strongest implementation of "held".
        return {
          kind: 'REVALIDATION_REFUSED',
          reason: 'DISPATCH_EFFECT_STALE',
          // ONE FIXED SENTENCE. It carries no option id, no resource state, no count and
          // no near-miss — `26 §2.2`'s probing rule at the dispatch boundary.
          detail:
            'the originally authorised effect is not a valid current effect; the claim is ' +
            'refused and the commitment remains held (25 §14.1)',
        };
      }
      emit('REVALIDATED');
      if (hooks?.afterRevalidation !== undefined) await hooks.afterRevalidation();

      // -----------------------------------------------------------------------------
      // STEP 2 — THE CLAIM. `25 §7`: "in a committed transaction BEFORE the HTTP call."
      //
      // The ACCEPTED S1I service, IMPORTED and not reimplemented — no eligibility
      // evaluation, no override allowance, no clock derivation and no state write happens
      // in this file. It runs ON THE LEASE'S CLIENT so the claim commits inside Epoch B.
      // -----------------------------------------------------------------------------
      const claimed = await withSerialisationRetry(
        lease.client,
        (tx) =>
          claimForExternalDispatchOn(
            tx,
            {
              companyId: input.companyId,
              idempotencyKey: input.idempotencyKey,
              claimedBy: input.dispatchedBy,
              now: input.now,
            },
            hooks?.afterClaimLock === undefined ? undefined : { afterLock: hooks.afterClaimLock },
          ),
        { isolation: 'READ COMMITTED' },
      );
      if (claimed.value.kind === 'REFUSED') {
        return {
          kind: 'CLAIM_REFUSED',
          reason: claimed.value.reason,
          detail: claimed.value.detail,
        };
      }
      const claim = claimed.value;
      // The promise resolved, so `inTransaction` has issued COMMIT. Everything below this
      // line is after the claim is durable and visible to a separate connection.
      emit('CLAIM_COMMITTED');

      // -----------------------------------------------------------------------------
      // STEP 3 — THE FRESH-CLAIM CAPABILITY. THE ONLY MINT SITE IN `src/`.
      //
      // `§5`, AND `25 §14.1` DOES NOT REPLACE IT. "a persisted `CLAIMED` row is not enough
      // to reach step 5, and after this process dies there is no way back to this line."
      // The dispatch lease serialises ENTITY STATE; the fresh capability proves THIS
      // PROCESS owns the live successful claim continuation. Both are required, and
      // `dispatch-lease-crash.test.ts` is the regression that an old `CLAIMED` row plus a
      // newly acquired dispatch lease still cannot dispatch.
      // -----------------------------------------------------------------------------
      const built = buildDispatchEnvelope(claim.claim.row, env.controlArtifacts);
      if (built.kind === 'REFUSED') {
        return { kind: 'ENVELOPE_REFUSED', reason: built.reason, detail: built.detail };
      }
      const capability = mintFreshDispatchCapability(built.identity, input.now);
      emit('CAPABILITY_MINTED');
      emit('ENVELOPE_BUILT');

      /*
       * THE CAPABILITY DOES NOT OUTLIVE THIS CALL, ON ANY PATH — `§5`, `§24`.
       *
       * `consume` already deletes the entry, so the revoke is a no-op on the success path;
       * what it closes is every OTHER exit — a refused resolution, a refused envelope, a
       * hook that throws at a kill point, an adapter that throws instead of returning a
       * typed outcome, a failed outcome transaction.
       */
      try {
        if (hooks?.afterClaimCommit !== undefined) await hooks.afterClaimCommit();

        // ---------------------------------------------------------------------------
        // STEP 4 — TRUSTED CLOSED ADAPTER RESOLUTION, AND EM6 ELIGIBILITY, BEFORE INVOCATION.
        // ---------------------------------------------------------------------------
        const resolution = resolveAdapterFor(env.registry, {
          adapter: built.envelope.adapter,
          recoverability: built.envelope.recoverability,
        });
        if (resolution.kind === 'REFUSED') {
          // The `finally` revokes; the claim stays committed and non-reclaimable (`I36`).
          return {
            kind: 'ADAPTER_REFUSED',
            reason: resolution.reason,
            detail: resolution.detail,
          };
        }
        emit('ADAPTER_RESOLVED');

        // ---------------------------------------------------------------------------
        // STEP 5 — THE INVOCATION. THE ONLY `.dispatch(` CALL SITE IN `src/`.
        //
        // The capability is spent BEFORE the call rather than after it: one spent
        // afterwards would still be live during the call, and an adapter that re-entered
        // the gateway could use it.
        // ---------------------------------------------------------------------------
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
          // adapter did with it.
          unmirroredTagSent: envelope.requiresUnmirroredTag,
          invokedAt: input.now,
          outcomeKind: outcome.kind,
          providerReference:
            outcome.kind === 'ADAPTER_RETURNED' ? outcome.providerReference : null,
          rawResponseHash: outcome.kind === 'ADAPTER_RETURNED' ? outcome.rawResponseHash : null,
        });
        emit('ATTESTATION_MINTED');

        if (hooks?.afterAdapterReturned !== undefined) {
          await hooks.afterAdapterReturned({ attestation, identity: built.identity });
        }

        // ---------------------------------------------------------------------------
        // STEP 6/7 — THE LOCAL OUTCOME TRANSACTION, ON THE LEASE'S CLIENT.
        //
        // SERIALIZABLE where `25 §10.1`'s movement runs, READ COMMITTED where none does.
        // The isolation is decided from the AUTHORITATIVE recoverability and the TYPED
        // outcome, and the decision is re-made inside the transaction under the row lock.
        // ---------------------------------------------------------------------------
        const isolation = await outcomeIsolationFor(env.control, built.identity, outcome.kind);
        const resolved = await processAdapterOutcomeOnClient(
          lease.client,
          isolation,
          { attestation, identity: built.identity, now: input.now },
          {
            ...(hooks?.afterOutcomeLock === undefined
              ? {}
              : { afterLock: hooks.afterOutcomeLock }),
            ...(hooks?.beforeLedgerMovement === undefined
              ? {}
              : { beforeLedgerMovement: hooks.beforeLedgerMovement }),
            ...(hooks?.afterLedgerMovement === undefined
              ? {}
              : { afterLedgerMovement: hooks.afterLedgerMovement }),
            ...(hooks?.afterJournalRow === undefined
              ? {}
              : { afterJournalRow: hooks.afterJournalRow }),
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
          claimJournalSeq: claim.claim.journalSeq,
          movedWindows: resolved.movedWindows,
        };
      } finally {
        revokeFreshDispatchCapability(capability);
      }
    } finally {
      // `25 §14.1`: released only AFTER the outcome COMMIT. This emit is inside the lease
      // callback's `finally`, so the event is always the last one and a test asserting the
      // full order proves the span rather than assuming it.
      emit('DISPATCH_LEASE_RELEASED');
    }
  });
}
