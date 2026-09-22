import type { ActionClass, Recoverability } from '../canonicalisation/actionCatalogue.js';

/**
 * THE EXTERNAL-EFFECT ADAPTER PORT. A CONTRACT, AND NOT ONE IMPLEMENTATION.
 *
 * =================================================================================
 * WHAT THIS FILE IS AND IS NOT
 *
 * `24 §3` K4's Outputs: "adapter invocation with that payload **verbatim**". `33 §1`:
 * each adapter "receives the kernel's `dispatch_payload` verbatim and does not reinterpret
 * intent into vendor parameters". `49 §3.1`: adapters are TCB MEMBERS.
 *
 * This file declares the boundary those three sentences describe. IT CONTAINS NO ADAPTER.
 *
 * `§7` of the S1J mandate: "Implement the minimum production adapter PORT / Effect Gateway
 * boundary required by architecture. Do NOT implement a real adapter. The deterministic
 * mock implementation belongs under test/support or another explicitly non-production test
 * location."
 *
 * There is no `fetch`, no HTTP client, no vendor SDK, no credential, no token, no endpoint
 * and no vendor name anywhere in this directory, and
 * `tests/integration/gateway/no-real-transport-boundary.test.ts` asserts each as an
 * absence over the whole of `src/` and over this directory in particular.
 * =================================================================================
 */

/**
 * `25 §7`'s EM6 capability criterion, as a closed set of primitives.
 *
 * `25 §7`, the declaration this type exists to make checkable, verbatim:
 *
 *   "**Second, ESP selection becomes an EM6 criterion.** A provider offering **neither an
 *    idempotency header nor a delivery-event webhook nor a queryable message log** cannot
 *    serve an IRRECOVERABLE class. That is this section's own disqualifier applied where it
 *    belongs, and it is a **vendor-selection constraint** rather than an engineering
 *    problem."
 *
 * The three members are that sentence's three disjuncts and nothing else. `25 §7`'s
 * earlier paragraph gives the reason each counts: the effect key "is deterministic, not
 * random [...] so the adapter's own idempotency (or the reconciler's lookup) recognises
 * it", and `25 §10`'s IRRECOVERABLE branch resolves `PRESUMED_EXECUTED` "from the
 * provider's delivery event matched on the correlation tag".
 *
 * THIS IS TRUSTED ADAPTER METADATA AND NOT A PROVIDER CLAIM. An adapter DECLARING
 * `IDEMPOTENCY_HEADER` asserts that its own implementation honours an externally supplied
 * key; `36 §7` requires that assertion to be MEASURED against a vendor sandbox —
 * "measure the `@idempotent` directive's key scope and deduplication window empirically
 * rather than trusting the annotation" — and S1J measures nothing, because there is no
 * vendor. A capability declared by the deterministic mock is a TEST FIXTURE.
 */
export const ADAPTER_RESOLUTION_CAPABILITIES = [
  'IDEMPOTENCY_HEADER',
  'DELIVERY_EVENT_WEBHOOK',
  'QUERYABLE_MESSAGE_LOG',
] as const;

export type AdapterResolutionCapability = (typeof ADAPTER_RESOLUTION_CAPABILITIES)[number];

/**
 * The frozen dispatch envelope one adapter invocation receives.
 *
 * =================================================================================
 * EVERY FIELD COMES FROM COMMITTED STATE. NOTHING IS RECONSTRUCTED — `§10`.
 *
 * `§10` of the mandate: "The adapter receives the exact payload snapshot persisted by S1I.
 * Do not reconstruct from current resource state; do not re-run enumeration; do not query
 * current order state to rebuild it; do not use model rationale; do not run constructor
 * again to produce possibly different dispatch bytes."
 *
 * `dispatchEnvelope.ts` builds this from ONE committed `dispatch_outbox` row and from the
 * claim that row already carries. There is no constructor call, no enumeration, no live
 * resource read and no canonicaliser invocation on the dispatch path, and
 * `no-real-transport-boundary.test.ts` asserts the gateway directory imports none of them.
 * =================================================================================
 *
 * =================================================================================
 * THERE IS NO ECONOMIC FIELD ON THIS TYPE — `§33`.
 *
 * No exposure, no reservation amount, no retained fee, no MIE limit, no window ceiling and
 * no approval threshold. `26 §1` Corollary 3: "the request must be built by the ceiling's
 * enforcer, not by its subject", and an adapter is a subject of the ceiling. The
 * monetary content of the request, where the class has one, is inside
 * `payloadCanonicalBytes` — the bytes the canonicaliser emitted and the authorisation
 * hash-bound — and is not separately readable or separately writable here.
 * =================================================================================
 */
export interface DispatchEnvelope {
  readonly companyId: string;
  readonly outboxId: string;
  readonly claimId: string;
  readonly effectId: string;
  readonly authorisationId: string;
  /** `25 §7`'s deterministic effect key. Regenerated identically after a restart. */
  readonly idempotencyKey: string;
  readonly actionClass: ActionClass;
  readonly resourceRef: string;
  /**
   * `26 §5`: catalogue-assigned, never per request and never by a model. It is HERE so an
   * adapter can refuse work it is not eligible for, and it is NOT an input the adapter can
   * change: `outcome.ts` reads recoverability from the committed `effect` row and never
   * from anything an adapter returned (`§17`).
   */
  readonly recoverability: Recoverability;
  /** The catalogue's adapter identity and method. `§8`: never a caller's choice. */
  readonly adapter: string;
  readonly method: string;
  /** The hash the authorisation committed, and which the outbox row's bytes satisfy. */
  readonly dispatchPayloadHash: string;
  /**
   * THE PERSISTED CANONICAL PAYLOAD. A FRESH COPY ON EVERY ACCESS — `§32`.
   *
   * A `Buffer` cannot be frozen against element writes, so this is a GETTER that returns a
   * new copy of an immutable snapshot held in a closure. An adapter that mutates what it
   * receives mutates only its own copy: the persisted row is untouched, and the next
   * reader — another adapter, the outcome transaction, a test — sees the original bytes.
   *
   * `§32`'s required alias attack is `dispatch-envelope.test.ts`, and there is no mutable
   * alias to the outbox row anywhere on this path.
   */
  readonly payloadCanonicalBytes: Buffer;
  /**
   * `25 §7` / ADR-026 item 1's "provider-visible correlation tag".
   *
   * MINTED BEFORE THE CLAIM AND CARRIED ACROSS THE PORT UNCHANGED — `§11`. The adapter
   * observes it; it may not mint one, replace one or omit one. Which provider field
   * carries it is per-adapter and is deliberately not decided here (`§7`: no
   * vendor-specific header may be invented), so there is no `correlationHeaderName`.
   */
  readonly correlationTag: string;
  /**
   * `30 §5.7.2` item 5 / `36 §6` — THE REQUIREMENT, CROSSING THE PORT — `§12`.
   *
   * "Every dispatch under it is tagged `DISPATCHED_UNMIRRORED` and carries `override_id`."
   * The claim recorded whether this dispatch requires the tag; the gateway puts the
   * requirement on the envelope; and `0012`'s
   * `dispatch_outcome_unmirrored_tag_not_suppressed` CHECK makes an outcome row that
   * dropped it unwritable. `§12`: "The adapter may not suppress it."
   */
  readonly requiresUnmirroredTag: boolean;
  /** `30 §5.7.2` item 5's specific authority, or null where no override was needed. */
  readonly overrideId: string | null;
}

/**
 * THE TYPED ADAPTER OUTCOME. THE ONLY THING AN ADAPTER TELLS THE KERNEL — `§14`.
 *
 * =================================================================================
 * THE TAXONOMY IS THE ARCHITECTURE'S, AND ITS THIRD MEMBER IS DELIBERATELY UNRESOLVABLE
 *
 * `25 §5`'s lifecycle names the adapter's two informative results as edge labels:
 *
 *     EXECUTING --> VERIFYING: adapter returned
 *     EXECUTING --> ATTEMPT_UNRESOLVED: timeout / ambiguous
 *
 * and `24 §3` K4's Failure behaviour names the same two plus one more: "On **adapter
 * failure**, bounded retry with jitter against the same idempotency key, then dead-letter
 * to an Incident. On **ambiguous outcome**, status by recoverability class".
 *
 *   `ADAPTER_RETURNED`   `25 §5`'s "adapter returned". The call completed and the adapter
 *                        holds a response. IT IS NOT EVIDENCE THAT THE WORLD CHANGED —
 *                        `25 §5`: "A 200 from an API is not evidence that the world
 *                        changed. Verification is an independent read-back."
 *
 *   `OUTCOME_UNKNOWN`    `25 §5`'s "timeout / ambiguous", and `35 §4`'s state:
 *                        "conflating 'failed' with 'unknown' is what produces double
 *                        execution."
 *
 *   `NOT_SENT_CONFIRMED` v1.3.5 (OBX-05), `25 §7.2`. THE ANSWER TO `§19`'s CONDITIONAL —
 *                        "If no immediate known-not-sent state exists, do not invent one."
 *                        The accepted S1J did not invent one; v1.3.5 declares one, and
 *                        this is it. It "may be returned only by a trusted adapter, and
 *                        only where the adapter can positively establish from its own
 *                        control flow or from typed provider semantics that NO EXTERNAL
 *                        WRITE CROSSED THE TRANSPORT BOUNDARY."
 *
 *   `ADAPTER_FAILED`     K4's "adapter failure". IT IS IN THIS UNION AND, BY v1.3.5's OWN
 *                        DECLARATION, HAS NO LOCAL OUTCOME POLICY AND REACHES NO LOCAL
 *                        STATE. `25 §7.1`: "Retained for diagnostics only [...] because a
 *                        failure the adapter cannot classify as confirmed-not-sent is a
 *                        failure whose request may have escaped." That is no longer an
 *                        open architecture question (`S1J-C2` is resolved): K4's retry is
 *                        CORRECTED to pre-claim workflow failures, and an adapter that
 *                        genuinely knows nothing escaped now has `NOT_SENT_CONFIRMED` to
 *                        say so with. `outcomePolicy.ts` returns `UNDECLARED` for it and
 *                        the outcome transaction writes nothing.
 * =================================================================================
 *
 * =================================================================================
 * THE TWO-BY-TWO THIS TAXONOMY IS ACTUALLY ABOUT — `25 §7.2` AND `35 §4`
 *
 * `35 §4`'s rule and its mirror image, which `25 §7.2` names:
 *
 *   "conflating 'failed' with 'unknown' is what produces double execution"
 *   — and labelling a possible escape as a confirmed non-send "would release a commitment
 *     for an effect that happened."
 *
 * So the discriminating question is never "did the call succeed?" but "COULD THE WRITE
 * HAVE ESCAPED?", and the taxonomy answers exactly that:
 *
 *   escaped, and the adapter has a response       `ADAPTER_RETURNED`
 *   MAY have escaped                              `OUTCOME_UNKNOWN`
 *   PROVABLY did not escape                       `NOT_SENT_CONFIRMED`
 *   unclassifiable, so MAY have escaped           `ADAPTER_FAILED` (no state)
 *
 * `25 §7.2`: "**Anything for which the request MAY have escaped is `OUTCOME_UNKNOWN`.**"
 * =================================================================================
 *
 * =================================================================================
 * WHAT AN ADAPTER MAY NOT PUT IN AN OUTCOME — `§17`, `§33`
 *
 * There is no `recoverability` member, no `effectStatus` member, no `exposure`, no
 * `amount`, no `mieUnits`, no `irrecoverableUnits`, no `releaseCommitment` and no
 * `redispatch` member. `51 §2.3` puts the unit count in the catalogue and `25 §7.2` puts
 * the release decision in the kernel's policy table, so neither is expressible here. An adapter reports WHAT HAPPENED TO
 * ITS CALL. The economic and policy consequences are the kernel's, read from committed
 * state inside the outcome transaction.
 *
 * `providerReference` and `rawResponseHash` are the only adapter-supplied values that
 * persist, and both are inert: an opaque string and a hex digest. `36 §7` / `I26`: "A
 * compromised adapter must produce a well-formed VENDOR RESPONSE, not a well-formed ACOS
 * FACT." Nothing parsed out of a response body is authority for anything here.
 * =================================================================================
 */
/**
 * The two admissible bases for `NOT_SENT_CONFIRMED` — `25 §7.2`, transcribed.
 *
 * A CLOSED SET OF TWO, and neither is derived from a message. `36 §2`'s discipline about
 * closed enums over string classification applies with unusual force here, because this is
 * the ONE outcome that RELEASES a commitment: every other member of the taxonomy either
 * holds it or moves it between terms.
 */
export const NOT_SENT_BASES = [
  /** "a failure raised **before** the external request was opened or sent". */
  'PRE_SEND_FAILURE',
  /**
   * "a provider rejection whose declared adapter contract guarantees no external mutation
   * occurred".
   *
   * S1J HAS NO PROVIDER AND THEREFORE NO SUCH CONTRACT. The member is declared because the
   * taxonomy is the architecture's and a partial transcription of a closed set is a set
   * with rows nobody wrote; the deterministic mock exercises `PRE_SEND_FAILURE`, which is
   * the basis a mock can honestly establish. Nothing in `src/` asserts that any real
   * provider offers such a guarantee — `36 §7` requires that to be MEASURED against a
   * sandbox, and S1J measures nothing.
   */
  'PROVIDER_REJECTED_NO_MUTATION',
] as const;

export type NotSentBasis = (typeof NOT_SENT_BASES)[number];

export type AdapterOutcome =
  | {
      readonly kind: 'ADAPTER_RETURNED';
      /** Opaque, adapter-supplied, non-authoritative. May be null. */
      readonly providerReference: string | null;
      /** A 64-character lowercase hex digest of the retained raw response, or null. */
      readonly rawResponseHash: string | null;
    }
  | {
      readonly kind: 'OUTCOME_UNKNOWN';
      /** `25 §5`'s own two words for this edge. Diagnostic, never an authority operand. */
      readonly reason: 'TIMEOUT' | 'AMBIGUOUS';
    }
  | {
      /**
       * `25 §7.2`, v1.3.5 (OBX-05). POSITIVE TRUSTED-ADAPTER PROOF OF NON-TRANSMISSION.
       *
       * =============================================================================
       * `basis` IS A CLOSED TYPED ENUM AND NOT AN ERROR MESSAGE — THE LOAD-BEARING FIELD
       *
       * `25 §7.2`: "**THE CLASSIFICATION MAY NOT BE MADE FROM ARBITRARY ERROR-MESSAGE
       * STRINGS.** `30 §5.7`'s rule against string-classified causes applies here for the
       * same reason: a string is a vendor's prose, and an economic release decided by
       * prose is a release decided by the vendor's changelog."
       *
       * So this member carries no `message`, no `error`, no `code` and no `detail` — there
       * is nowhere on it to put a string an adapter parsed. What it carries is one value
       * from a two-member enum, and each member is one of the two bases `25 §7.2` declares
       * admissible, verbatim:
       *
       *   `PRE_SEND_FAILURE`             "a failure raised **before** the external request
       *                                  was opened or sent"
       *   `PROVIDER_REJECTED_NO_MUTATION` "a provider rejection whose declared adapter
       *                                  contract guarantees no external mutation occurred"
       *
       * A TIMEOUT, A CONNECTION RESET AFTER SEND, AN UNKNOWN PROVIDER ERROR AND A GENERIC
       * EXCEPTION ARE NONE OF THESE, and each is `OUTCOME_UNKNOWN`. An adapter that cannot
       * place its failure in one of the two members has not established anything, and
       * `25 §7.2`'s "anything for which the request MAY have escaped" applies.
       *
       * THE ENUM IS NOT AN AUTHORITY OPERAND EITHER. `outcomePolicyFor` takes the outcome
       * KIND and the recoverability and nothing else, so which basis an adapter declared
       * changes no local state and moves no ledger term — it is evidence for the audit
       * trail and for a later provider reconciliation, not an input to the decision.
       * =============================================================================
       *
       * =============================================================================
       * THE ADAPTER IS TRUSTED, AND THAT IS A TCB CLAIM RATHER THAN A COMFORT
       *
       * `49 §3.1` makes adapters TCB MEMBERS, and `25 §7.2` scopes this outcome to "a
       * trusted adapter". A compromised adapter returning this falsely releases a
       * commitment for an effect that may have happened — which is precisely why
       * `tests/negative-controls/unsafe-false-not-sent.ts` exists and why the mock's
       * genuine pre-send failure path increments NO acceptance counter: the discrimination
       * is between an adapter that never reached its own send point and one that did.
       * =============================================================================
       */
      readonly kind: 'NOT_SENT_CONFIRMED';
      readonly basis: NotSentBasis;
    }
  | {
      readonly kind: 'ADAPTER_FAILED';
      /** Diagnostic only. `§14`: never inspected to decide an economic outcome. */
      readonly failureClass: string;
    };

export const ADAPTER_OUTCOME_KINDS = [
  'ADAPTER_RETURNED',
  'OUTCOME_UNKNOWN',
  'NOT_SENT_CONFIRMED',
  'ADAPTER_FAILED',
] as const;

export type AdapterOutcomeKind = (typeof ADAPTER_OUTCOME_KINDS)[number];

/**
 * ONE TRUSTED ADAPTER. THE PORT, WITH NO IMPLEMENTATION IN `src/`.
 *
 * `adapterId` MUST equal the catalogue's `adapter` for every class it serves, and
 * `adapterRegistry.ts` refuses a registration where it does not. That is what makes `§8`'s
 * substitution attack unrepresentable: the gateway looks the adapter up BY THE IDENTITY THE
 * COMMITTED EFFECT CARRIES, so an adapter registered under a different identity is simply
 * never consulted for this effect.
 *
 * `dispatch` RECEIVES A FROZEN ENVELOPE AND RETURNS A TYPED OUTCOME. It receives no client,
 * no credential, no configuration and no callback into the kernel, and it cannot open a
 * transaction: the outcome transaction runs AFTER `dispatch` resolves, in the gateway.
 */
export interface ExternalEffectAdapter {
  /** The catalogue's adapter identity. `26 §5`'s execution metadata. */
  readonly adapterId: string;
  /**
   * `25 §7`'s EM6 criterion. Declared per adapter, checked against the effect's
   * recoverability BEFORE invocation by `adapterRegistry.resolveAdapterFor`.
   */
  readonly resolutionCapabilities: readonly AdapterResolutionCapability[];
  dispatch(envelope: DispatchEnvelope): Promise<AdapterOutcome>;
}
