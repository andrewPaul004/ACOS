/**
 * THE FRESH-CLAIM DISPATCH CAPABILITY, AND THE INVOCATION ATTESTATION.
 *
 * =================================================================================
 * THE PROPERTY THIS FILE EXISTS TO HAVE — `§5` OF THE S1J MANDATE
 *
 * "The production dispatch path must distinguish
 *
 *      'I just successfully acquired this claim in this live execution'
 *
 *  from
 *
 *      'the database contains some old row whose state is CLAIMED.'
 *
 *  A persisted CLAIMED row by itself must NOT be enough to initiate transport. Otherwise a
 *  process restart after claim COMMIT → crash before HTTP could simply find the CLAIMED
 *  row and dispatch it anyway, destroying the no-blind-retry guarantee."
 *
 * AND IT IS THE ARCHITECTURE'S OWN REQUIREMENT, NOT ONLY THE MANDATE'S. `25 §7`, on the
 * declared state machine (v1.3.4, OBX-01):
 *
 *     "**`CLAIMED` HAS NO TIMEOUT, NO LEASE, NO EXPIRY AND NO RECLAIM.** [...] A row whose
 *      claim is followed by an uncertain outcome is the subject of `§5`'s
 *      recoverability-keyed unknown-outcome policy and `§8`'s reconciliation. **It is
 *      never the subject of a retry that re-claims.**"
 *
 * `25 §7` also says why a persisted `CLAIMED` row is not self-authorising: "an *incomplete*
 * step is not a checkpointed step, so a crash after the request leaves and before the
 * outcome commits is exactly the case the guarantee is silent about". A `CLAIMED` row after
 * a process loss is INTENTIONALLY AMBIGUOUS — `35 §12.3`: "On recovery, ACOS does not know
 * whether the message was accepted" — and a mechanism that dispatched from it would be
 * resolving that ambiguity by assumption.
 *
 * `37 §2` S1's forbidden shape, stated in the S1J mandate `§23` as a rule: "Do NOT build
 * `on startup, dispatch all CLAIMED rows`. That is forbidden." This file is what makes that
 * shape unbuildable rather than merely unbuilt.
 * =================================================================================
 *
 * =================================================================================
 * THE MECHANISM, AND WHY EACH PART IS NECESSARY
 *
 * A capability is an OPAQUE FROZEN OBJECT WITH NO OWN DATA. Everything about it lives in a
 * module-private `Map` keyed by the object itself. So:
 *
 *   minted only by the claim step   `mintFreshDispatchCapability` is called from exactly
 *                                   one production site — `effectGateway.ts`, immediately
 *                                   after `claimForExternalDispatch` returns `CLAIMED` —
 *                                   and `no-real-transport-boundary.test.ts` asserts that
 *                                   call site against a hand-authored list.
 *
 *   bound to one identity           The record carries company, effect, outbox, claim and
 *                                   idempotency identity, and `consume` compares all five.
 *                                   A capability for effect A cannot dispatch effect B.
 *
 *   usable at most once             `consume` DELETES the entry before returning it. A
 *                                   second use finds nothing and is refused.
 *
 *   not serializable                No own enumerable properties, and `toJSON` THROWS. A
 *                                   capability cannot be put in a worker result, a model
 *                                   tool response, a queue message or a log line.
 *
 *   not reconstructable from a row  There is no exported function anywhere that takes an
 *                                   outbox row, an `outboxId`, a `claimId` or any other
 *                                   persisted value and returns a capability. Reading a
 *                                   `CLAIMED` row produces a row.
 *
 *   not accepted from input         A fabricated object — an object literal, a
 *                                   `JSON.parse` result, a structurally identical clone —
 *                                   is not a key in the private `Map` and is refused.
 *
 *   lost on process death           The `Map` is process memory. It is not persisted, not
 *                                   replicated, not cached and not derivable, so a
 *                                   restarted process holds none.
 * =================================================================================
 *
 * =================================================================================
 * WHAT THIS IS NOT
 *
 * IT IS NOT AN AUTHORITY OPERAND. No dispatch decision is made here: `30 §5.1` item 4's
 * classification happens inside the ACCEPTED S1I claim transaction, against current state,
 * before any capability exists. A capability says only "this exact claim was acquired by
 * this execution"; it says nothing about whether the claim should have been granted.
 *
 * IT IS NOT A LEASE, AND IT IS NOT `25 §14`'s ENTITY LEASE. It grants no exclusion, blocks
 * nobody, and has no lifetime beyond the continuation that holds it. The exclusion is the
 * committed `CLAIMED` row, in the database, as `I36` requires.
 * =================================================================================
 */

/**
 * What a capability is bound to. Every member is read from the COMMITTED claim.
 *
 * There is deliberately no `adapter`, no `payload` and no `recoverability` here: those are
 * read again from committed state when the envelope is built and when the outcome is
 * processed, so a capability cannot carry a stale or altered copy of them.
 */
export interface DispatchIdentity {
  readonly companyId: string;
  readonly idempotencyKey: string;
  readonly outboxId: string;
  readonly effectId: string;
  readonly claimId: string;
}

export function dispatchIdentityEquals(a: DispatchIdentity, b: DispatchIdentity): boolean {
  return (
    a.companyId === b.companyId &&
    a.idempotencyKey === b.idempotencyKey &&
    a.outboxId === b.outboxId &&
    a.effectId === b.effectId &&
    a.claimId === b.claimId
  );
}

/**
 * The opaque capability handle.
 *
 * The private symbol brand means no object literal, no `JSON.parse` result and no
 * structural clone inhabits this type, so `§5`'s "not accepted from user/model input" is a
 * TYPE property as well as a runtime one. `tests/type-negative/fabricated-capability.ts`
 * is the compile-negative fixture.
 */
declare const FRESH_DISPATCH_CAPABILITY: unique symbol;

export interface FreshDispatchCapability {
  readonly [FRESH_DISPATCH_CAPABILITY]: true;
}

/**
 * The opaque attestation that a trusted adapter WAS invoked in this execution and returned
 * this typed outcome.
 *
 * It exists for the same reason the capability does, one step later: the outcome
 * transaction must be able to distinguish "an adapter I invoked told me this" from "a
 * caller told me an adapter said this". `§34`: "No worker/model surface may [...] submit
 * adapter outcome; select outcome; mutate outbox."
 *
 * IT IS DELIBERATELY NOT SINGLE-USE. A local outcome transaction can legitimately be
 * retried — a `40001` serialisation failure, a connection loss before `COMMIT` — and the
 * SAME invocation's outcome must be presentable again, because re-invoking the adapter to
 * obtain a fresh attestation is precisely the duplicate `I36` forbids. `§25`'s
 * double-processing race is decided by the outbox row lock and by
 * `effect_dispatch_outcome`'s primary key, not by consuming a token.
 */
declare const DISPATCH_ATTESTATION: unique symbol;

export interface DispatchAttestation {
  readonly [DISPATCH_ATTESTATION]: true;
}

interface CapabilityRecord {
  readonly identity: DispatchIdentity;
  readonly mintedAt: Date;
}

export interface DispatchAttestationRecord {
  readonly identity: DispatchIdentity;
  readonly adapterId: string;
  readonly requiresUnmirroredTag: boolean;
  readonly unmirroredTagSent: boolean;
  readonly invokedAt: Date;
  readonly outcomeKind: string;
  readonly providerReference: string | null;
  readonly rawResponseHash: string | null;
}

/**
 * THE TWO PRIVATE REGISTRIES. Process memory, and nothing else.
 *
 * Not exported, not reachable, not enumerable from outside this module. A `Map` rather
 * than a `WeakMap` so `liveCapabilityCount()` can report a leak — a capability that was
 * minted and neither consumed nor revoked is a dispatch path that abandoned an acquired
 * claim, which is worth being able to see in a test.
 */
const CAPABILITIES = new Map<FreshDispatchCapability, CapabilityRecord>();
const ATTESTATIONS = new Map<DispatchAttestation, DispatchAttestationRecord>();

function opaqueHandle<T>(): T {
  // No own enumerable properties, so `JSON.stringify` of a container holding one leaks
  // nothing; `toJSON` throws, so serialising it directly is an error rather than a quiet
  // `{}`. Frozen, so nothing can be attached to it later and read back out.
  const handle = {
    toJSON(): never {
      throw new Error(
        'a dispatch capability or attestation is not serialisable: it is process-local ' +
          'authority to continue one live execution and must never reach a caller, a ' +
          'model, a queue, a log or a database (§5, §34)',
      );
    },
  };
  Object.defineProperty(handle, 'toJSON', { enumerable: false });
  return Object.freeze(handle) as T;
}

/**
 * Mint a capability for a claim THAT HAS JUST COMMITTED IN THIS EXECUTION.
 *
 * EXACTLY ONE PRODUCTION CALL SITE, and it is the point of the whole file:
 * `effectGateway.ts`, on the line after `claimForExternalDispatch` resolves `CLAIMED`.
 * `no-real-transport-boundary.test.ts` asserts the call-site list by hand, exactly as
 * `no-transport-boundary.test.ts` asserts `classifyDispatchPrecedence`'s single caller.
 *
 * THIS FUNCTION CANNOT VERIFY THE CLAIM ITSELF, AND MUST NOT PRETEND TO. It takes an
 * identity, not a database connection, and it performs no read: a version that re-read the
 * row to "confirm" the claim would be exactly the mechanism `§5` forbids — a function that
 * turns a persisted `CLAIMED` row into a dispatch permission. The freshness comes from
 * WHERE it is called, which is why the single-call-site assertion is a test and not a
 * comment.
 */
export function mintFreshDispatchCapability(
  identity: DispatchIdentity,
  mintedAt: Date,
): FreshDispatchCapability {
  const handle = opaqueHandle<FreshDispatchCapability>();
  CAPABILITIES.set(handle, { identity: Object.freeze({ ...identity }), mintedAt });
  return handle;
}

export const CAPABILITY_REFUSALS = [
  /** Not a live capability: never minted here, already consumed, or lost to a restart. */
  'CAPABILITY_NOT_LIVE',
  /** Live, but minted for a different claim. `§5`: bound to exact identity. */
  'CAPABILITY_IDENTITY_MISMATCH',
] as const;

export type CapabilityRefusal = (typeof CAPABILITY_REFUSALS)[number];

/**
 * THE SUCCESS ARM IS `CAPABILITY_CONSUMED`, NOT `CONSUMED` — DELIBERATELY.
 *
 * The ACCEPTED `local-authorisation-boundary.test.ts` asserts that the literal `'CONSUMED'`
 * appears nowhere in `src/`, because `26 §12.2`'s `Approval` state machine has a `CONSUMED`
 * state and `26 §12`'s approval resume is DEFERRED — so the literal's absence is how that
 * deferral is held. That assertion is UNAMENDED by S1J, and a capability consumption has
 * nothing to do with an approval: naming it `CONSUMED` would have made an unrelated
 * mechanism look like the resume path arriving.
 */
export type CapabilityConsumption =
  | { readonly kind: 'CAPABILITY_CONSUMED'; readonly mintedAt: Date }
  | { readonly kind: 'REFUSED'; readonly reason: CapabilityRefusal; readonly detail: string };

/**
 * Consume a capability for one intended invocation. AT MOST ONCE, EVER.
 *
 * The delete happens BEFORE the identity comparison returns, so even a mismatched second
 * use cannot leave the entry live for a third attempt: an identity mismatch is a defect in
 * the calling path and the safe response is to burn the capability, not to hand it back.
 */
export function consumeFreshDispatchCapability(
  capability: FreshDispatchCapability,
  identity: DispatchIdentity,
): CapabilityConsumption {
  const record = CAPABILITIES.get(capability);
  if (record === undefined) {
    return {
      kind: 'REFUSED',
      reason: 'CAPABILITY_NOT_LIVE',
      detail:
        'no live fresh-claim capability for this handle: it was never minted in this ' +
        'process, has already been used, or was lost when the process that acquired the ' +
        'claim died (§5, §24)',
    };
  }
  CAPABILITIES.delete(capability);
  if (!dispatchIdentityEquals(record.identity, identity)) {
    return {
      kind: 'REFUSED',
      reason: 'CAPABILITY_IDENTITY_MISMATCH',
      detail:
        `the capability was minted for outbox ${record.identity.outboxId} under claim ` +
        `${record.identity.claimId} and was presented for outbox ${identity.outboxId} ` +
        `under claim ${identity.claimId}`,
    };
  }
  return { kind: 'CAPABILITY_CONSUMED', mintedAt: record.mintedAt };
}

/**
 * Discard a capability without invoking anything.
 *
 * The gateway calls this on every path that acquires a claim and then declines to invoke —
 * an unregistered adapter, an ineligible adapter. The claim stays committed and
 * non-reclaimable, as `I36` requires; what is discarded is the permission to invoke, so a
 * later line in the same process cannot pick it up.
 */
export function revokeFreshDispatchCapability(capability: FreshDispatchCapability): void {
  CAPABILITIES.delete(capability);
}

/** How many capabilities are live in this process. For assertions, and for leak detection. */
export function liveCapabilityCount(): number {
  return CAPABILITIES.size;
}

/**
 * Record that a trusted adapter was invoked and returned this typed outcome.
 *
 * EXACTLY ONE PRODUCTION CALL SITE — `effectGateway.ts`, on the line after `adapter.
 * dispatch` resolves. Asserted by hand in `no-real-transport-boundary.test.ts`.
 */
export function mintDispatchAttestation(record: DispatchAttestationRecord): DispatchAttestation {
  const handle = opaqueHandle<DispatchAttestation>();
  ATTESTATIONS.set(handle, Object.freeze({ ...record }));
  return handle;
}

/**
 * Read an attestation. Returns `undefined` for anything this process did not mint.
 *
 * This is how `outcomeTransaction.ts` obtains the outcome kind it persists, and it is the
 * reason a caller cannot submit an outcome: a fabricated handle reads as `undefined` and
 * the outcome transaction refuses.
 */
export function readDispatchAttestation(
  attestation: DispatchAttestation,
): DispatchAttestationRecord | undefined {
  return ATTESTATIONS.get(attestation);
}

/** For assertions. Attestations are not consumed, so this only grows within one process. */
export function liveAttestationCount(): number {
  return ATTESTATIONS.size;
}
