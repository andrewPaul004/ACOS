import type {
  AdapterOutcome,
  DispatchEnvelope,
  ExternalEffectAdapter,
} from '../../src/kernel/gateway/adapterPort.js';

/**
 * TEST-ONLY. THE FALSE `NOT_SENT_CONFIRMED`, AND THE GENERIC-FAILURE RETRY — `§20`, `§21`.
 *
 * =================================================================================
 * `§20`'s ATTACK, AND WHY IT IS THE MIRROR IMAGE OF THE ONE `35 §4` ALREADY NAMED
 *
 * `35 §4`'s rule is famous inside this codebase: "conflating 'failed' with 'unknown' is what
 * produces double execution." `25 §7.2` names its mirror image and it is the subject of this
 * file:
 *
 *   "There was no state for a failure a trusted adapter *knows* did not leave the process,
 *    and `35 §4`'s own rule [...] has a mirror image the artifacts did not name: **labelling
 *    a possible escape as a confirmed non-send would release a commitment for an effect that
 *    happened.**"
 *
 * So the two errors are symmetric and their costs are not:
 *
 *   failed-as-unknown   → the effect is retried → DOUBLE EXECUTION
 *   unknown-as-not-sent → the commitment is released → the ceiling stops bounding the
 *                         effect that already happened, and the freed headroom funds another
 *
 * `unsafeMapExceptionToNotSent` below is the second. It is an ADAPTER-SIDE mapper — the
 * layer `25 §7.2` puts the classification in — and it decides from the fact that an
 * exception was thrown, which establishes nothing at all about whether the write escaped.
 * =================================================================================
 *
 * =================================================================================
 * WHAT MAKES THE DISCRIMINATION REAL RATHER THAN STIPULATED
 *
 * The mock crosses its own acceptance point BEFORE throwing — `mockAdapter.ts`'s
 * `afterAccepted` hook runs "AFTER `acceptedCount` has been incremented and BEFORE the
 * outcome is returned, so a hook that throws reproduces exactly the crash the architecture
 * cares about: the request may have been accepted and the outcome never reached the kernel."
 *
 * So `acceptedCount === 1` is an observed fact about what the adapter did, and it is the
 * fact that makes `NOT_SENT_CONFIRMED` a LIE rather than a debatable reading. A test asserts
 * it on both sides:
 *
 *   UNSAFE:     acceptedCount 1, outcome NOT_SENT_CONFIRMED, commitment RELEASED
 *   PRODUCTION: acceptedCount 1, outcome OUTCOME_UNKNOWN,    commitment HELD (money) or
 *               reserved → presumed (IRRECOVERABLE)
 *
 * And the honest adapter's counterpart — `escapedThenThrewAdapter` versus a genuine pre-send
 * failure — differ in exactly that counter, which is why `mockAdapter.ts`'s pre-send failure
 * path increments nothing.
 * =================================================================================
 */

/** What an unsafe mapper produced, with the fact that refutes it recorded beside it. */
export interface UnsafeMapping {
  readonly outcome: AdapterOutcome;
  /** Whether the adapter had already crossed its own acceptance point when it decided. */
  readonly hadAccepted: boolean;
}

/**
 * THE UNSAFE MAPPER. An exception becomes a confirmed non-send.
 *
 * `25 §7.2` forbids exactly this twice over: the classification "may be returned only by a
 * trusted adapter, and only where the adapter can positively establish **from its own
 * control flow or from typed provider semantics** that NO EXTERNAL WRITE CROSSED THE
 * TRANSPORT BOUNDARY", and "**THE CLASSIFICATION MAY NOT BE MADE FROM ARBITRARY
 * ERROR-MESSAGE STRINGS.**"
 *
 * This function has both defects: it reads a thrown value, and it reads its message. Note
 * that the production `AdapterOutcome` type has no field in which the message could travel,
 * so the string cannot even reach the kernel — the damage is done entirely inside the mapper,
 * which is precisely why `25 §7.2` puts the rule on the ADAPTER rather than on the kernel.
 */
export function unsafeMapExceptionToNotSent(
  error: unknown,
  hadAccepted: boolean,
): UnsafeMapping {
  const message = error instanceof Error ? error.message : String(error);
  // The reasoning a real implementation would have written, and every step of it is wrong:
  // "the send threw, so it did not send" ignores that a throw AFTER the write is
  // indistinguishable from a throw before it without the adapter's own control flow.
  const looksLikeFailure =
    message.includes('failed') || message.includes('refused') || message.includes('error');
  return {
    outcome: looksLikeFailure
      ? { kind: 'NOT_SENT_CONFIRMED', basis: 'PRE_SEND_FAILURE' }
      : { kind: 'OUTCOME_UNKNOWN', reason: 'AMBIGUOUS' },
    hadAccepted,
  };
}

/**
 * An adapter that CROSSES ITS ACCEPTANCE POINT AND THEN FAILS, mapping the failure unsafely.
 *
 * The composition `§20` asks for, as one object the gateway can be handed. `callCount` and
 * `acceptedCount` are its own instrumentation and both reach 1, so a test can state the
 * discrimination as a comparison of two dispatches of the SAME shape rather than as a claim
 * about intent.
 */
export function unsafeFalseNotSentAdapter(options: {
  readonly adapterId: string;
  readonly resolutionCapabilities: readonly ExternalEffectAdapter['resolutionCapabilities'][number][];
  readonly events?: string[];
}): ExternalEffectAdapter & { readonly acceptedCount: number; readonly callCount: number } {
  let callCount = 0;
  let acceptedCount = 0;
  return {
    adapterId: options.adapterId,
    resolutionCapabilities: Object.freeze([...options.resolutionCapabilities]),
    get callCount(): number {
      return callCount;
    },
    get acceptedCount(): number {
      return acceptedCount;
    },
    async dispatch(_envelope: DispatchEnvelope): Promise<AdapterOutcome> {
      callCount += 1;
      options.events?.push('UNSAFE_ADAPTER_INVOKED');
      // THE WRITE ESCAPES. Past this line a real request has left the process.
      acceptedCount += 1;
      options.events?.push('UNSAFE_ADAPTER_ACCEPTED');
      const thrown = new Error('provider connection refused after send');
      const mapped = unsafeMapExceptionToNotSent(thrown, true);
      return mapped.outcome;
    },
  };
}

/**
 * `§21` — THE GENERIC-FAILURE RETRY, AS THE STATE MACHINE v1.3.5 CORRECTED.
 *
 * `24 §3` K4 as issued: "On **adapter failure**, bounded retry with jitter against the same
 * idempotency key, then dead-letter to an Incident." `25 §7` OBX-01 as issued: "**no
 * transition out of `CLAIMED`, and no second transition into it**." The two are
 * incompatible, and v1.3.5 (OBX-04) resolves it in OBX-01's favour:
 *
 *   "K4's *'bounded retry against the same idempotency key'* is corrected to **no retry**:
 *    it applies to retryable workflow and internal failures that occur **before** an
 *    external-effect claim, and **a claimed external-effect identity is not retryable.**"
 *
 * THIS FUNCTION IS THE UNCORRECTED READING, and it is a DATABASE operation rather than an
 * application one on purpose: the only way to actually requeue a claimed row is to defeat
 * `0010`'s `dispatch_outbox_transitions` trigger, so the control must disable it. That is
 * itself the proof — a production code path CANNOT do this, because the trigger refuses
 * every UPDATE to a `CLAIMED` row and no production statement disables a trigger.
 *
 * The discrimination a test asserts:
 *
 *   UNSAFE:     the row returns to `ENQUEUED`, is claimed a second time, and the adapter is
 *               invoked TWICE for one authorised effect — `I36`'s violation, observed.
 *   PRODUCTION: the second claim is refused `ALREADY_CLAIMED` and `callCount` stays at 1.
 */
export async function unsafeRequeueClaimedRow(
  control: import('../../src/db/pool.js').Pool,
  companyId: string,
  idempotencyKey: string,
): Promise<void> {
  const client = await control.connect();
  try {
    // Disabling the trigger is the admission that this is impossible through the schema.
    await client.query('ALTER TABLE dispatch_outbox DISABLE TRIGGER dispatch_outbox_transitions');
    // AND IT HAS TO DEFEAT A SECOND, INDEPENDENT CONTROL AND DESTROY THE RECORD OF THE FIRST
    // OUTCOME — which is itself part of the harm rather than an inconvenience of the fixture.
    //
    // `0012`'s eight-column foreign key binds the outcome row to the claim, so clearing
    // `claim_id` is refused while any outcome remembers it; and `effect_dispatch_outcome` is
    // APPEND-ONLY, so the outcome cannot be deleted either. A retry of a claimed identity is
    // therefore reachable only by disabling TWO triggers and erasing the durable record of
    // the attempt being retried — which is `23 §6` B8's "no effect originating in reasoning
    // can occur that is not recorded", read backwards.
    await client.query(
      'ALTER TABLE effect_dispatch_outcome DISABLE TRIGGER effect_dispatch_outcome_append_only',
    );
    await client.query(
      `DELETE FROM effect_dispatch_outcome WHERE company_id = $1 AND idempotency_key = $2`,
      [companyId, idempotencyKey],
    );
    await client.query(
      `UPDATE dispatch_outbox
          SET status = 'ENQUEUED',
              claim_id = NULL, claimed_at = NULL, claimed_by = NULL,
              claim_matched_row = NULL, claim_mirror_state = NULL,
              claim_requires_unmirrored_tag = NULL, claim_override_id = NULL,
              claim_clock_ref = NULL
        WHERE company_id = $1 AND idempotency_key = $2`,
      [companyId, idempotencyKey],
    );
  } finally {
    await client
      .query('ALTER TABLE dispatch_outbox ENABLE TRIGGER dispatch_outbox_transitions')
      .catch(() => undefined);
    await client
      .query(
        'ALTER TABLE effect_dispatch_outcome ENABLE TRIGGER effect_dispatch_outcome_append_only',
      )
      .catch(() => undefined);
    client.release();
  }
}
