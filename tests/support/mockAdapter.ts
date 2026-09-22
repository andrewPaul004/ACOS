import type {
  AdapterOutcome,
  AdapterResolutionCapability,
  DispatchEnvelope,
  ExternalEffectAdapter,
  NotSentBasis,
} from '../../src/kernel/gateway/adapterPort.js';

/**
 * THE DETERMINISTIC IN-PROCESS MOCK ADAPTER. TEST-ONLY, AND NOT A PROVIDER.
 *
 * =================================================================================
 * WHY IT LIVES HERE AND NOT IN `src/`
 *
 * `§7` of the S1J mandate: "Do NOT implement a real adapter. The deterministic mock
 * implementation belongs under test/support or another explicitly non-production test
 * location."
 *
 * `37 §2` S1 independently puts the mock here: its closed catalogue has "exactly three
 * classes: one REVERSIBLE, one COMPENSABLE, one IRRECOVERABLE, **all against a mock
 * adapter** — plus one rate-based class against a mock". So a mock at this stage is
 * architecture, and a mock in `src/` would be a second production write path, which is
 * what `48 §1` says the perimeter exists to make impossible.
 *
 * `no-real-transport-boundary.test.ts` asserts that no file under `src/` imports this
 * module and that `src/` contains no `ExternalEffectAdapter` implementation.
 * =================================================================================
 *
 * =================================================================================
 * IT IS IN-PROCESS. NO SOCKET, NO LOCALHOST SERVER, NO PORT.
 *
 * `§7`: "The mock is in-process. No socket. No localhost fake HTTP server. This slice is
 * testing kernel semantics, not networking." So `dispatch` is a plain async function that
 * consults a programmed table and returns. There is no `fetch`, no `http`, no `net`, no
 * listener and no URL anywhere in this file.
 * =================================================================================
 *
 * =================================================================================
 * IT IMPORTS NO PRODUCTION POLICY — `§41`
 *
 * "Forbidden: [...] adapter mock importing production outcome classifier to decide what it
 *  returns."
 *
 * This file imports exactly ONE production module — `adapterPort.js` — and imports only
 * TYPES from it. It does not import `outcomePolicy.ts`, `outcomeTransaction.ts`,
 * `effectGateway.ts`, `adapterRegistry.ts`, `actionCatalogue.ts` or anything under
 * `src/kernel/outbox/`. What it returns is what the TEST programmed it to return, decided
 * by hand at the call site, and never derived from production's own answer.
 * =================================================================================
 *
 * =================================================================================
 * WHAT ITS COUNTERS PROVE, AND WHAT THEY DO NOT — `§29`, `§30`
 *
 * `callCount` and `acceptedCount` are the mock's own instrumentation, and they prove
 * ACOS-SIDE properties: that no recovery path invoked an adapter a second time for an
 * already-claimed effect, that a restart after a claim invoked nothing at all, that a
 * refused resolution invoked nothing.
 *
 * THEY ARE NOT A PROVIDER ACCEPTED COUNT. `I36`'s verification leg requires "the six kill
 * points of `44 §5.2` against a **real ESP sandbox**, measured by the provider's own
 * accepted count" (`37 §2`, SEQ-01), and `I20` requires "Σ provider-reported accepted
 * messages per window", reconciled by the audit plane from its own ESP read credential.
 * There is no provider here and no audit-plane vendor credential, so:
 *
 *   - `I36`'s real-provider validation stays OPEN;
 *   - `I20` stays OPEN;
 *   - no test in this repository may compare `acceptedCount` to a reserved unit count and
 *     call either closed.
 *
 * `35 §12.3` says it in one line: "the kill-point tests must run against a real ESP sandbox
 * (VAL-04) — **a mock with a naive idempotency implementation passes while the vendor would
 * not**."
 * =================================================================================
 */

/** One recorded observation of what actually crossed the port. */
export interface ObservedDispatch {
  readonly companyId: string;
  readonly outboxId: string;
  readonly claimId: string;
  readonly effectId: string;
  readonly authorisationId: string;
  readonly idempotencyKey: string;
  readonly actionClass: string;
  readonly resourceRef: string;
  readonly recoverability: string;
  readonly adapter: string;
  readonly method: string;
  readonly dispatchPayloadHash: string;
  /** Hex of the bytes the adapter actually received. `§10`'s persisted-payload assertion. */
  readonly payloadHex: string;
  /** `§11`. The tag as observed, never as minted here. */
  readonly correlationTag: string;
  /** `§12`. The requirement as it crossed the port. */
  readonly requiresUnmirroredTag: boolean;
  readonly overrideId: string | null;
}

export interface MockAdapterOptions {
  /** MUST be a catalogue adapter identity, or `createAdapterRegistry` refuses it (`§8`). */
  readonly adapterId: string;
  /**
   * `25 §7`'s EM6 primitives this mock ADVERTISES.
   *
   * `§13`: "The MOCK may advertise architecture-defined capabilities for testing. Do NOT
   * claim a real provider has that capability." An empty array is the required negative
   * control: an IRRECOVERABLE effect against an adapter advertising none must be refused
   * before invocation.
   */
  readonly resolutionCapabilities: readonly AdapterResolutionCapability[];
  /**
   * What to return. A value, or a function of the envelope — hand-authored at the call
   * site, never computed from production policy.
   */
  readonly outcome: AdapterOutcome | ((envelope: DispatchEnvelope) => AdapterOutcome);
  /** A shared ordering log. The mock pushes `MOCK_ADAPTER_INVOKED` into it (`§6`). */
  readonly events?: string[];
  /**
   * KILL POINT 3 — `§22` item 3: "after mock invocation/request acceptance point, before
   * outcome known".
   *
   * Called AFTER `acceptedCount` has been incremented and BEFORE the outcome is returned,
   * so a hook that throws reproduces exactly the crash the architecture cares about: the
   * request may have been accepted and the outcome never reached the kernel.
   */
  readonly afterAccepted?: () => Promise<void>;
  /**
   * `§32`'s ALIAS ATTACK. When true the mock tries to mutate everything it received.
   *
   * It writes into the payload buffer it was handed and attempts to assign to the
   * envelope's correlation tag, effect identity, recoverability, unmirrored requirement and
   * override. Every attempt is recorded in `mutationAttempts` and the envelope is read back
   * afterwards, so the test can assert that nothing the adapter did changed what a second
   * reader sees.
   */
  readonly attemptMutation?: boolean;
  /**
   * `25 §7.2`'s FIRST ADMISSIBLE BASIS, AS A REAL CONTROL-FLOW BRANCH — v1.3.5 (OBX-05).
   *
   * =================================================================================
   * WHY THIS IS A SEPARATE FLAG AND NOT JUST A PROGRAMMED OUTCOME
   *
   * `25 §7.2`: `NOT_SENT_CONFIRMED` "may be returned only by a trusted adapter, and only
   * where the adapter can positively establish **from its own control flow** or from typed
   * provider semantics that NO EXTERNAL WRITE CROSSED THE TRANSPORT BOUNDARY". The admissible
   * basis it names first is "a failure raised **before** the external request was opened or
   * sent".
   *
   * An adapter could be PROGRAMMED to return `NOT_SENT_CONFIRMED` through `outcome`, and that
   * would prove only that the kernel handles the literal. What `§17` of the continuation
   * mandate asks for is "a deterministic genuine pre-send failure producing this result" —
   * an adapter whose CONTROL FLOW never reached its own send point.
   *
   * SO THIS FLAG RETURNS EARLY, BEFORE `acceptedCount` IS INCREMENTED. The counter is the
   * observable that separates an honest confirmed-non-send from a false one:
   *
   *   genuine pre-send failure   callCount 1, acceptedCount 0  → NOT_SENT_CONFIRMED is TRUE
   *   escaped, then failed       callCount 1, acceptedCount 1  → NOT_SENT_CONFIRMED is a LIE
   *
   * `tests/negative-controls/unsafe-not-sent-mapping.ts` is the second row, and
   * `not-sent-vs-unknown.test.ts` asserts the discrimination as a comparison of the two
   * counters rather than as a claim about intent.
   * =================================================================================
   */
  readonly failBeforeSend?: NotSentBasis;
}

export interface MockAdapter extends ExternalEffectAdapter {
  /** How many times `dispatch` was entered. */
  readonly callCount: number;
  /**
   * How many times the mock reached its own acceptance point — i.e. past the point at
   * which a real request would have left. NOT a provider accepted count (`§29`).
   */
  readonly acceptedCount: number;
  readonly observed: readonly ObservedDispatch[];
  /** What `attemptMutation` tried, and whether the runtime let it. */
  readonly mutationAttempts: readonly { readonly field: string; readonly threw: boolean }[];
  reset(): void;
}

export function createMockAdapter(options: MockAdapterOptions): MockAdapter {
  let callCount = 0;
  let acceptedCount = 0;
  const observed: ObservedDispatch[] = [];
  const mutationAttempts: { field: string; threw: boolean }[] = [];

  const tryMutate = (field: string, mutate: () => void): void => {
    try {
      mutate();
      mutationAttempts.push({ field, threw: false });
    } catch {
      mutationAttempts.push({ field, threw: true });
    }
  };

  const adapter: MockAdapter = {
    adapterId: options.adapterId,
    resolutionCapabilities: Object.freeze([...options.resolutionCapabilities]),
    get callCount(): number {
      return callCount;
    },
    get acceptedCount(): number {
      return acceptedCount;
    },
    get observed(): readonly ObservedDispatch[] {
      return observed;
    },
    get mutationAttempts(): readonly { readonly field: string; readonly threw: boolean }[] {
      return mutationAttempts;
    },
    reset(): void {
      callCount = 0;
      acceptedCount = 0;
      observed.length = 0;
      mutationAttempts.length = 0;
    },
    async dispatch(envelope: DispatchEnvelope): Promise<AdapterOutcome> {
      callCount += 1;
      options.events?.push('MOCK_ADAPTER_INVOKED');

      // Record what actually crossed the port, BEFORE any mutation attempt, so the
      // observation is of what the gateway handed over.
      observed.push({
        companyId: envelope.companyId,
        outboxId: envelope.outboxId,
        claimId: envelope.claimId,
        effectId: envelope.effectId,
        authorisationId: envelope.authorisationId,
        idempotencyKey: envelope.idempotencyKey,
        actionClass: envelope.actionClass,
        resourceRef: envelope.resourceRef,
        recoverability: envelope.recoverability,
        adapter: envelope.adapter,
        method: envelope.method,
        dispatchPayloadHash: envelope.dispatchPayloadHash,
        payloadHex: envelope.payloadCanonicalBytes.toString('hex'),
        correlationTag: envelope.correlationTag,
        requiresUnmirroredTag: envelope.requiresUnmirroredTag,
        overrideId: envelope.overrideId,
      });

      if (options.attemptMutation === true) {
        // The buffer the adapter was handed. Writing into it must not change what the next
        // reader gets, because every read returns a fresh copy of a private snapshot.
        const handed = envelope.payloadCanonicalBytes;
        tryMutate('payloadCanonicalBytes[0]', () => {
          handed[0] = (handed[0]! ^ 0xff) & 0xff;
        });
        // The scalars. `Object.freeze` on the envelope makes each of these throw in a
        // module (strict mode is implicit in ESM), which is the property being asserted.
        const mutable = envelope as unknown as Record<string, unknown>;
        tryMutate('correlationTag', () => {
          mutable['correlationTag'] = 'tag:forged-by-adapter';
        });
        tryMutate('effectId', () => {
          mutable['effectId'] = 'effect:forged-by-adapter';
        });
        tryMutate('recoverability', () => {
          mutable['recoverability'] = 'REVERSIBLE';
        });
        tryMutate('requiresUnmirroredTag', () => {
          mutable['requiresUnmirroredTag'] = false;
        });
        tryMutate('overrideId', () => {
          mutable['overrideId'] = null;
        });
        tryMutate('dispatchPayloadHash', () => {
          mutable['dispatchPayloadHash'] = '0'.repeat(64);
        });
      }

      // ==============================================================================
      // THE PRE-SEND FAILURE BRANCH — `25 §7.2`, AND IT RETURNS BEFORE THE ACCEPTANCE POINT.
      //
      // "a failure raised **before** the external request was opened or sent". The adapter
      // establishes the basis from ITS OWN CONTROL FLOW: it has not reached the line below,
      // so no request can have left, and `acceptedCount` stays where it was.
      //
      // This is the ONLY honest source of `NOT_SENT_CONFIRMED` in this file. There is no path
      // that reaches the acceptance point and then returns it, because that is the lie
      // `25 §7.2` exists to make unrepresentable and
      // `tests/negative-controls/unsafe-not-sent-mapping.ts` is where it lives instead.
      // ==============================================================================
      if (options.failBeforeSend !== undefined) {
        options.events?.push('MOCK_ADAPTER_FAILED_BEFORE_SEND');
        return { kind: 'NOT_SENT_CONFIRMED', basis: options.failBeforeSend };
      }

      // THE ACCEPTANCE POINT. Past here, a real request would have left the process.
      acceptedCount += 1;
      options.events?.push('MOCK_ADAPTER_ACCEPTED');

      if (options.afterAccepted !== undefined) await options.afterAccepted();

      const outcome =
        typeof options.outcome === 'function' ? options.outcome(envelope) : options.outcome;
      options.events?.push('MOCK_ADAPTER_RETURNED');
      return outcome;
    },
  };
  return adapter;
}

/** `25 §5`'s "adapter returned", with two inert opaque references. */
export function returnedOutcome(providerReference: string | null = 'mock:ref-1'): AdapterOutcome {
  return {
    kind: 'ADAPTER_RETURNED',
    providerReference,
    // A hand-authored 64-hex digest. Inert: nothing reads it as authority.
    rawResponseHash: 'a'.repeat(64),
  };
}

/** `25 §5`'s "timeout / ambiguous", and `35 §4`'s unknown. */
export function unknownOutcome(reason: 'TIMEOUT' | 'AMBIGUOUS' = 'TIMEOUT'): AdapterOutcome {
  return { kind: 'OUTCOME_UNKNOWN', reason };
}

/**
 * `25 §7.1`'s `ADAPTER_FAILED`. Retained for diagnostics; it reaches no local state.
 *
 * v1.3.5 CORRECTED WHAT THIS MEANS. v1.3.4 declared a RESPONSE for it — "bounded retry with
 * jitter against the same idempotency key" — and no state, and the response contradicted
 * OBX-01. `25 §7.1` scopes the retry to pre-claim workflow failures and declares that this
 * kind "carries no local outcome policy and reaches no local state".
 */
export function failedOutcome(failureClass = 'MOCK_REJECTED'): AdapterOutcome {
  return { kind: 'ADAPTER_FAILED', failureClass };
}

/**
 * `25 §7.2`'s `NOT_SENT_CONFIRMED`, as a programmed value.
 *
 * USE `failBeforeSend` INSTEAD WHERE THE POINT IS THE PROOF. This helper is for the cases
 * where the subject is the KERNEL's handling of the literal — the C4 matrix, the release, the
 * terminal state — and the adapter's own basis is not what is under test. Where the subject
 * IS the basis, `failBeforeSend` returns before the acceptance point and the counter shows it.
 */
export function notSentOutcome(
  basis: NotSentBasis = 'PRE_SEND_FAILURE',
): AdapterOutcome {
  return { kind: 'NOT_SENT_CONFIRMED', basis };
}
