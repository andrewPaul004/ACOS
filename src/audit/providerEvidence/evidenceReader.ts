import type { Pool } from '../../db/pool.js';

/**
 * THE PROVIDER-EVIDENCE OBSERVATION API — `I36`, `I20`, `I8` UNDER `SIGNED_PROVIDER_PUSH`.
 *
 * =================================================================================
 * IT READS THE LOCAL AUDIT STORE AND NOTHING ELSE
 *
 * Every function here is a SELECT against the `A0009` tables, run as the audit plane's own
 * evaluator role. There is no provider client, no `/v3/messages`, no Email Activity read, no
 * credential and no write: push evidence arrives at the ingress, and this module only reads what
 * the ingress durably recorded. Polling it can never resend anything, because there is nothing
 * in its scope to send with.
 *
 * =================================================================================
 * AUTHENTICATION IS NOT COMPLETENESS — ADR-027 DECISION 6
 *
 * "A signature proves one payload came from the provider. It proves nothing about whether every
 * event the provider generated arrived." So every answer below carries
 * `completenessEstablished: false`, as a LITERAL TYPE: there is no code path in this module that
 * can produce `true`, because v1.3.8 establishes no empirical completeness bound and claims none.
 *
 *   two or more distinct message identities   I36 EXCESS — duplicate-send evidence, a FAIL
 *                                             immediately, with no completeness precondition;
 *   exactly one                               an OBSERVATION, never an absence-based PASS;
 *   zero                                      an OBSERVATION, never `NOT_SENT_CONFIRMED`.
 *
 * Quiet polling, one received event and the provider's 24-hour retry horizon are none of them
 * a completeness guarantee, and nothing here counts polls, events or horizons toward one.
 *
 * =================================================================================
 * INCOMPLETENESS IS CHANNEL-WIDE OVER THE QUERIED RECEIPT INTERVAL
 *
 * An INCOMPLETE observation is a batch the audit plane could not fully read — so it cannot know
 * WHICH correlations that batch carried. Any INCOMPLETE observation received in the queried
 * interval therefore marks EVERY correlation queried over that interval `knownIncomplete`. An
 * `sg_event_id` inconsistency taints the two correlations it names whatever the interval.
 * =================================================================================
 */

/** The receipt interval a question is asked over. ACOS received-at, inclusive bounds. */
export interface ReceiptInterval {
  readonly receivedFrom: Date;
  readonly receivedTo: Date;
}

/** `I36` under push evidence, for ONE correlation. */
export const PUSH_I36_READINGS = [
  /** Two or more distinct provider message ids under one correlation. FAIL immediately. */
  'EXCESS_DUPLICATE_SEND_EVIDENCE',
  /** Exactly one observed. Observation only — never an absence-based PASS. */
  'ONE_OBSERVED_NOT_FINAL',
  /** None observed. Observation only — NEVER `NOT_SENT_CONFIRMED`. */
  'NONE_OBSERVED_NOT_FINAL',
] as const;

export type PushI36Reading = (typeof PUSH_I36_READINGS)[number];

export interface CorrelationObservation {
  readonly provider: string;
  readonly correlationTag: string;
  /** Distinct `sg_message_id` values among COMPLETE accepted-class evidence, sorted. */
  readonly providerMessageIds: readonly string[];
  /** `providerMessageIds.length`. The OBSERVED count, never a final one. */
  readonly observedAcceptedCount: number;
  /** Whether any evidence that could bear on this correlation is known to be incomplete. */
  readonly knownIncomplete: boolean;
  /** The closed reasons behind `knownIncomplete`, deduplicated and sorted. */
  readonly incompleteReasons: readonly string[];
  /** ADR-027 decision 6. A literal: nothing in this module can establish completeness. */
  readonly completenessEstablished: false;
  readonly i36: PushI36Reading;
}

function i36Reading(count: number): PushI36Reading {
  if (count >= 2) return 'EXCESS_DUPLICATE_SEND_EVIDENCE';
  if (count === 1) return 'ONE_OBSERVED_NOT_FINAL';
  return 'NONE_OBSERVED_NOT_FINAL';
}

async function incompleteReasonsIn(
  pool: Pool,
  provider: string,
  interval: ReceiptInterval,
): Promise<string[]> {
  const result = await pool.query<{ incomplete_reason: string }>(
    `SELECT DISTINCT incomplete_reason
       FROM provider_evidence_observation
      WHERE provider = $1 AND status = 'INCOMPLETE'
        AND received_at BETWEEN $2 AND $3
      ORDER BY incomplete_reason`,
    [provider, interval.receivedFrom, interval.receivedTo],
  );
  return result.rows.map((row) => row.incomplete_reason);
}

/**
 * `I36`'s push-mode operand for ONE correlation: `COUNT(DISTINCT sg_message_id)` among
 * authenticated, COMPLETE, accepted-class evidence carrying it.
 *
 * NOT the event count, the callback count, the POST count, the HTTP 2xx count or the
 * pre-deduplication count. Event rows exist only for COMPLETE observations and only once per
 * `sg_event_id`, so this reads deduplicated evidence by construction, and the join to a
 * COMPLETE observation is asserted again here rather than assumed.
 */
export async function observeCorrelation(
  pool: Pool,
  input: ReceiptInterval & {
    readonly provider: string;
    readonly correlationTag: string;
    readonly acceptedEventClasses: readonly string[];
  },
): Promise<CorrelationObservation> {
  const messages = await pool.query<{ sg_message_id: string }>(
    `SELECT DISTINCT e.sg_message_id
       FROM provider_evidence_event e
       JOIN provider_evidence_observation o ON o.observation_id = e.observation_id
      WHERE e.provider = $1
        AND e.acos_correlation_tag = $2
        AND e.event_class = ANY($3::TEXT[])
        AND o.status = 'COMPLETE'
        AND e.received_at BETWEEN $4 AND $5
      ORDER BY e.sg_message_id`,
    [
      input.provider,
      input.correlationTag,
      [...input.acceptedEventClasses],
      input.receivedFrom,
      input.receivedTo,
    ],
  );
  const reasons = new Set(await incompleteReasonsIn(pool, input.provider, input));
  /*
   * DELIBERATELY NOT INTERVAL-BOUNDED: AN IDENTITY INCONSISTENCY TAINTS THE CORRELATION FOR
   * ITS LIFETIME.
   *
   * The COUNT above reads only events RECEIVED inside the caller's interval (both endpoints
   * inclusive), so evidence from another run can never enter this one's numerator. An
   * inconsistency is different in kind: it says the provider presented two different
   * identities for one `sg_event_id`, so NO count for a correlation it touches can be trusted,
   * whenever it was recorded. Restricting it to the interval could only ever turn an untrusted
   * reading into a trusted one — the direction this module never moves in.
   */
  const inconsistent = await pool.query<{ n: string }>(
    `SELECT COUNT(*)::TEXT AS n
       FROM provider_evidence_inconsistency
      WHERE provider = $1
        AND (recorded_correlation_tag = $2 OR presented_correlation_tag = $2)`,
    [input.provider, input.correlationTag],
  );
  if (Number(inconsistent.rows[0]?.n ?? '0') > 0) reasons.add('EVENT_IDENTITY_INCONSISTENT');

  const ids = messages.rows.map((row) => row.sg_message_id);
  return Object.freeze({
    provider: input.provider,
    correlationTag: input.correlationTag,
    providerMessageIds: Object.freeze(ids),
    observedAcceptedCount: ids.length,
    knownIncomplete: reasons.size > 0,
    incompleteReasons: Object.freeze([...reasons].sort()),
    completenessEstablished: false as const,
    i36: i36Reading(ids.length),
  });
}

/**
 * WHAT ESTABLISHES THAT PUSH EVIDENCE IS COMPLETE ENOUGH FOR AN EXACT `I20` NUMERATOR.
 *
 * Today there is exactly one member, and it establishes nothing: a valid signature is not
 * completeness, the provider documents no complete-delivery guarantee for its event stream, and
 * no empirical characterisation exists. A future, separately reviewed characterisation would
 * be a NEW member carrying its own evidence — added to this union, never inferred from the
 * absence of an incomplete observation.
 */
export type PushCompletenessBasis = {
  readonly kind: 'UNESTABLISHED';
  readonly why: string;
};

export const PUSH_COMPLETENESS_UNESTABLISHED: PushCompletenessBasis = Object.freeze({
  kind: 'UNESTABLISHED' as const,
  why:
    'ADR-027: authentication is not completeness, no complete-delivery guarantee is documented ' +
    'for the provider event stream, and no empirical completeness characterisation exists',
});

/** Whether a completeness basis permits an EXACT numerator. No current member does. */
export function completenessEstablishedBy(basis: PushCompletenessBasis): boolean {
  switch (basis.kind) {
    case 'UNESTABLISHED':
      return false;
  }
}

/** `I20`'s provider-side operand over a correlation set. */
export interface I20ProviderOperand {
  readonly provider: string;
  /**
   * Distinct authenticated accepted-class message identities OBSERVED across the set: a LOWER
   * BOUND. It may prove an excess over the basis; it is never the numerator.
   */
  readonly observedDistinctAcceptedMessages: number;
  /**
   * THE EXACT NUMERATOR, or `null`. `null` whenever any included observation is known
   * incomplete OR the completeness basis does not establish completeness — which, today, is
   * always. An unmeasured operand is not a zero, and an observed count is not an exact one.
   */
  readonly exactAcceptedMessageNumerator: number | null;
  readonly unresolved: boolean;
  readonly completenessBasis: PushCompletenessBasis;
  readonly perCorrelation: readonly CorrelationObservation[];
  readonly completenessEstablished: boolean;
}

/**
 * `I20`'s numerator under push evidence: distinct authenticated accepted-class message
 * identities over the relevant correlation set. UNRESOLVED when any included observation is
 * incomplete. The DENOMINATOR is not this module's: it remains the immutable historical
 * reservation basis, read from the control plane by the harness and never substituted.
 */
export async function i20ProviderOperand(
  pool: Pool,
  input: ReceiptInterval & {
    readonly provider: string;
    readonly correlationTags: readonly string[];
    readonly acceptedEventClasses: readonly string[];
    /** Defaults to, and today can only be, `PUSH_COMPLETENESS_UNESTABLISHED`. */
    readonly completenessBasis?: PushCompletenessBasis;
  },
): Promise<I20ProviderOperand> {
  const completenessBasis = input.completenessBasis ?? PUSH_COMPLETENESS_UNESTABLISHED;
  const perCorrelation: CorrelationObservation[] = [];
  const messageIds = new Set<string>();
  for (const correlationTag of input.correlationTags) {
    const observation = await observeCorrelation(pool, { ...input, correlationTag });
    perCorrelation.push(observation);
    for (const id of observation.providerMessageIds) messageIds.add(id);
  }
  const incomplete = perCorrelation.some((observation) => observation.knownIncomplete);
  const established = completenessEstablishedBy(completenessBasis);
  const unresolved = incomplete || !established;
  return Object.freeze({
    provider: input.provider,
    observedDistinctAcceptedMessages: messageIds.size,
    exactAcceptedMessageNumerator: unresolved ? null : messageIds.size,
    unresolved,
    completenessBasis,
    perCorrelation: Object.freeze(perCorrelation),
    completenessEstablished: established,
  });
}

/** One authenticated accepted-class event the audit plane cannot account for. */
export interface UnaccountedProviderActivity {
  readonly sgEventId: string;
  readonly sgMessageId: string;
  readonly correlationTag: string;
  readonly eventClass: string;
}

export const PUSH_I8_OUTCOMES = [
  /** A POSITIVE finding. Valid immediately; needs no completeness guarantee. */
  'UNACCOUNTED_PROVIDER_ACTIVITY',
  /**
   * Nothing unaccounted was seen. NOT a clean period: ADR-027 decision 6 and `I8`'s v1.3.8
   * restatement — a period with no unaccounted event is INCOMPLETE rather than clean, until
   * completeness is established externally.
   */
  'NO_UNACCOUNTED_ACTIVITY_SEEN_PERIOD_INCOMPLETE',
] as const;

export type PushI8Outcome = (typeof PUSH_I8_OUTCOMES)[number];

export interface PushInverseObservation {
  readonly outcome: PushI8Outcome;
  readonly provider: string;
  readonly examinedEvents: number;
  readonly unaccounted: readonly UnaccountedProviderActivity[];
  /** INCOMPLETE observations in the interval. They make nothing cleaner; they are reported. */
  readonly incompleteObservations: number;
  readonly completenessEstablished: false;
}

/**
 * `I8`'s push-mode inverse observation over a BOUNDED receipt interval.
 *
 * Every authenticated accepted-class event in the interval whose correlation is not in the
 * accounted set is UNACCOUNTED PROVIDER ACTIVITY — a positive finding immediately. The converse
 * does not hold, and the outcome type has NO clean member: the best this function can say is
 * that nothing unaccounted was seen and the period remains incomplete.
 *
 * It finds; it does not act. No effect, authorisation, enqueue or dispatch is reachable from
 * here, and a finding is a value returned to the audit plane's caller.
 */
export async function pushInverseObservation(
  pool: Pool,
  input: ReceiptInterval & {
    readonly provider: string;
    readonly accountedCorrelationTags: ReadonlySet<string>;
    readonly acceptedEventClasses: readonly string[];
  },
): Promise<PushInverseObservation> {
  const events = await pool.query<{
    sg_event_id: string;
    sg_message_id: string;
    acos_correlation_tag: string;
    event_class: string;
  }>(
    `SELECT e.sg_event_id, e.sg_message_id, e.acos_correlation_tag, e.event_class
       FROM provider_evidence_event e
       JOIN provider_evidence_observation o ON o.observation_id = e.observation_id
      WHERE e.provider = $1
        AND e.event_class = ANY($2::TEXT[])
        AND o.status = 'COMPLETE'
        AND e.received_at BETWEEN $3 AND $4
      ORDER BY e.sg_event_id`,
    [input.provider, [...input.acceptedEventClasses], input.receivedFrom, input.receivedTo],
  );
  const unaccounted = events.rows
    .filter((row) => !input.accountedCorrelationTags.has(row.acos_correlation_tag))
    .map((row) =>
      Object.freeze({
        sgEventId: row.sg_event_id,
        sgMessageId: row.sg_message_id,
        correlationTag: row.acos_correlation_tag,
        eventClass: row.event_class,
      }),
    );
  const incomplete = await pool.query<{ n: string }>(
    `SELECT COUNT(*)::TEXT AS n FROM provider_evidence_observation
      WHERE provider = $1 AND status = 'INCOMPLETE' AND received_at BETWEEN $2 AND $3`,
    [input.provider, input.receivedFrom, input.receivedTo],
  );
  return Object.freeze({
    outcome:
      unaccounted.length > 0
        ? ('UNACCOUNTED_PROVIDER_ACTIVITY' as const)
        : ('NO_UNACCOUNTED_ACTIVITY_SEEN_PERIOD_INCOMPLETE' as const),
    provider: input.provider,
    examinedEvents: events.rows.length,
    unaccounted: Object.freeze(unaccounted),
    incompleteObservations: Number(incomplete.rows[0]?.n ?? '0'),
    completenessEstablished: false as const,
  });
}
