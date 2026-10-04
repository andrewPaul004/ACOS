import type { CorrelationObservation } from '../../../src/audit/providerEvidence/evidenceReader.js';
import {
  MAX_OBSERVATION_ATTEMPTS,
  MAX_OBSERVATION_DURATION_MS,
  MAX_STABILISATION_OBSERVATIONS,
  MIN_STABILISATION_OBSERVATIONS,
  type ObservationAttempt,
  type ObservationResult,
} from './observation.js';
import type { InverseSweepResult } from './inverseSweep.js';
import { boundSettlesLiveAbsence, settlingIntervalMs, type VisibilityBound } from './visibilityBound.js';

/**
 * `SIGNED_PROVIDER_PUSH` OBSERVATION FOR THE S1P HARNESS — ADR-027, `50 §2h`.
 *
 * =================================================================================
 * THE SAME ORACLE CONTRACT, A DIFFERENT EVIDENCE SOURCE, AND NO PROVIDER CALL
 *
 * Under `SIGNED_PROVIDER_PUSH` the provider's accepted-message evidence arrives at the audit
 * plane's ingress and is durably recorded in the audit store. This module reads THAT STORE,
 * through a port, and nothing else. It does not call `/v3/messages`, does not read Email
 * Activity, holds no SendGrid read key and holds no SendGrid anything: `SignedPushEvidencePort`
 * has one member, a query against local evidence.
 *
 * **BOUNDED, AND IT NEVER SENDS.** The loop's only callable is the port and the injected delay.
 * There is nothing in scope to resend with.
 *
 * =================================================================================
 * HOW PUSH EVIDENCE MAPS ONTO THE ACCEPTED `ObservationResult`
 *
 *   two or more distinct message ids   `I36` EXCESS. The count is REPORTED at once, whatever the
 *                                      window or the incompleteness, because seeing a second
 *                                      message proves it exists (ADR-027 decision 6). The
 *                                      accepted `verdictFor` then FAILS the row.
 *   known-incomplete evidence          NO trustworthy count: `providerAcceptedCount: null`, so a
 *                                      row resting on it is UNRESOLVED. A readable sibling of a
 *                                      malformed event never becomes a count of one.
 *   one id, window completed           the count is reported; the no-duplicate conclusion is
 *                                      still withheld unless the bound settles absence — and the
 *                                      live push bound is UNESTABLISHED.
 *   nothing observed                   `NOT_OBSERVED_WITHIN_BOUND`. Never "not sent".
 * =================================================================================
 */

/**
 * What the harness may ask the audit store under push evidence: one correlation's observation
 * (`I36`), and the bounded `I8` inverse observation. Both are reads of LOCAL authenticated
 * evidence through the evaluator role; neither reaches the provider.
 */
export interface SignedPushEvidencePort extends SignedPushInversePort {
  readonly observe: (input: {
    readonly correlationTag: string;
    readonly periodStartMs: number;
    readonly periodEndMs: number;
  }) => Promise<CorrelationObservation>;
}

/**
 * THE LIVE PUSH VISIBILITY BOUND. `UNESTABLISHED`, and for a stated reason.
 *
 * A valid signature proves a payload came from the provider and nothing about whether every
 * event arrived. The provider documents no exactly-once or complete-delivery guarantee for its
 * event stream, its documented redelivery period is a statement about FAILED deliveries rather
 * than about generated events, and no empirical characterisation exists.
 */
export const SIGNED_PUSH_LIVE_VISIBILITY_BOUND: VisibilityBound = Object.freeze({
  kind: 'UNESTABLISHED' as const,
  why:
    'SIGNED PROVIDER PUSH (ADR-027): authentication is not completeness. No exactly-once or ' +
    'complete-delivery guarantee is documented for the provider event stream, the documented ' +
    'redelivery period bounds FAILED deliveries only, and no empirical completeness ' +
    'characterisation exists. The count may be observed; an absence-based PASS may not.',
});

export interface PushObservationBound {
  readonly correlationTag: string;
  readonly periodStartMs: number;
  readonly periodEndMs: number;
  readonly maxAttempts: number;
  readonly intervalMs: number;
  readonly maxDurationMs: number;
  readonly stabilisationObservations: number;
  readonly visibilityBound: VisibilityBound;
  readonly lastPossibleWriteAtMs: number;
}

export interface PushObservationDeps {
  readonly port: SignedPushEvidencePort;
  readonly delay: (ms: number) => Promise<void>;
  readonly now: () => number;
}

/** Clamp into the declared ceilings. The local store has no provider rate limit to respect. */
function clamp(bound: PushObservationBound): PushObservationBound {
  return Object.freeze({
    ...bound,
    maxAttempts: Math.max(1, Math.min(bound.maxAttempts, MAX_OBSERVATION_ATTEMPTS)),
    intervalMs: Math.max(0, bound.intervalMs),
    maxDurationMs: Math.max(1, Math.min(bound.maxDurationMs, MAX_OBSERVATION_DURATION_MS)),
    stabilisationObservations: Math.max(
      MIN_STABILISATION_OBSERVATIONS,
      Math.min(bound.stabilisationObservations, MAX_STABILISATION_OBSERVATIONS),
    ),
  });
}

/**
 * Observe ONE correlation in the audit store's push evidence. Discovery, then stabilisation,
 * exactly as the read-mode oracle does — with incompleteness withholding the count and an
 * excess reporting it immediately.
 */
export async function observePushCorrelation(
  deps: PushObservationDeps,
  rawBound: PushObservationBound,
): Promise<ObservationResult> {
  const bound = clamp(rawBound);
  const startedAt = deps.now();
  const attempts: ObservationAttempt[] = [];
  const messageIds = new Set<string>();
  let discovered = false;
  let incomplete = false;
  let outstanding = bound.stabilisationObservations;

  const result = (
    outcome: ObservationResult['outcome'],
    count: number | null,
    settled: boolean,
  ): ObservationResult =>
    Object.freeze({
      outcome,
      correlationTag: bound.correlationTag,
      attempts: Object.freeze([...attempts]),
      providerAcceptedCount: count,
      providerMessageIds: Object.freeze([...messageIds].sort()),
      stabilisationObservationsOutstanding: outcome === 'PROVIDER_ACTIVITY_OBSERVED' ? 0 : Math.max(outstanding, 0),
      settlingIntervalCompleted: settled,
      visibilityBoundKind: bound.visibilityBound.kind,
    });

  for (let attempt = 1; attempt <= bound.maxAttempts; attempt += 1) {
    const attemptStart = deps.now();
    if (attempt > 1) {
      if (attemptStart - startedAt + bound.intervalMs > bound.maxDurationMs) break;
      await deps.delay(bound.intervalMs);
    }
    const phase = discovered ? ('STABILISATION' as const) : ('DISCOVERY' as const);
    const observation = await deps.port.observe({
      correlationTag: bound.correlationTag,
      periodStartMs: bound.periodStartMs,
      periodEndMs: bound.periodEndMs,
    });
    for (const id of observation.providerMessageIds) messageIds.add(id);
    incomplete = incomplete || observation.knownIncomplete;

    if (!discovered) {
      if (messageIds.size > 0) discovered = true;
    } else {
      outstanding -= 1;
    }

    attempts.push(
      Object.freeze({
        attempt,
        startedAtMs: attemptStart,
        operation: 'AUDIT_STORE_PUSH_EVIDENCE_QUERY' as const,
        // The audit store ANSWERED. Push evidence has no provider-unavailable reading: a
        // provider that stopped posting looks like silence, which is why silence settles nothing.
        result: 'EVIDENCE' as const,
        phase,
        matchingRecords: observation.observedAcceptedCount,
        recordCount: observation.observedAcceptedCount,
        distinctMessageIdsSoFar: messageIds.size,
      }),
    );

    // ADR-027 decision 6 — an EXCESS needs no completeness guarantee. Report it now.
    if (messageIds.size >= 2) {
      return result('PROVIDER_ACTIVITY_OBSERVED', messageIds.size, false);
    }

    const settled =
      bound.visibilityBound.kind === 'FIXTURE_DETERMINISTIC' ||
      (boundSettlesLiveAbsence(bound.visibilityBound) &&
        attemptStart - bound.lastPossibleWriteAtMs >= settlingIntervalMs(bound.visibilityBound));

    if (discovered && outstanding <= 0) {
      // KNOWN-INCOMPLETE EVIDENCE NEVER YIELDS A TRUSTED COUNT.
      if (incomplete) return result('STABILISATION_UNRESOLVED', null, false);
      if (settled || !boundSettlesLiveAbsence(bound.visibilityBound)) {
        return result('PROVIDER_ACTIVITY_OBSERVED', messageIds.size, settled && !incomplete);
      }
    }
  }

  if (discovered) return result('STABILISATION_UNRESOLVED', null, false);
  // NOTHING OBSERVED. Zero only when nothing known to be incomplete could have hidden it.
  return result('NOT_OBSERVED_WITHIN_BOUND', incomplete ? null : 0, false);
}

/** The audit store's `I8` inverse observation, as the port to the evaluator role exposes it. */
export interface SignedPushInversePort {
  readonly inverse: (input: {
    readonly periodStartMs: number;
    readonly periodEndMs: number;
    readonly accountedCorrelationTags: ReadonlySet<string>;
  }) => Promise<{
    readonly outcome: 'UNACCOUNTED_PROVIDER_ACTIVITY' | 'NO_UNACCOUNTED_ACTIVITY_SEEN_PERIOD_INCOMPLETE';
    readonly examinedEvents: number;
    readonly unaccounted: readonly {
      readonly sgMessageId: string;
      readonly correlationTag: string;
      readonly eventClass: string;
    }[];
  }>;
}

/**
 * `I8` under push evidence, in the harness's accepted `InverseSweepResult` shape.
 *
 * A positive finding is `UNACCOUNTED_PROVIDER_RECORDS` immediately. Anything else is
 * `SWEEP_INCOMPLETE` — NEVER `ALL_PROVIDER_RECORDS_ACCOUNTED`, because push evidence has no
 * completeness signal and a quiet channel is not a clean one.
 */
export async function runPushInverseObservation(
  port: SignedPushInversePort,
  input: {
    readonly periodStartMs: number;
    readonly periodEndMs: number;
    readonly accountedCorrelationTags: ReadonlySet<string>;
  },
): Promise<InverseSweepResult> {
  const observed = await port.inverse(input);
  if (observed.outcome === 'UNACCOUNTED_PROVIDER_ACTIVITY') {
    return Object.freeze({
      outcome: 'UNACCOUNTED_PROVIDER_RECORDS' as const,
      providerRecordsExamined: observed.examinedEvents,
      pagesRead: 1,
      stoppedBecause: 'PROVIDER_COMPLETENESS_UNESTABLISHED' as const,
      unaccounted: Object.freeze(
        observed.unaccounted.map((entry) =>
          Object.freeze({
            providerMessageId: entry.sgMessageId,
            correlationTag: entry.correlationTag,
            providerStatus: entry.eventClass,
          }),
        ),
      ),
      statement:
        `the audit store holds ${String(observed.unaccounted.length)} authenticated accepted ` +
        'event(s) in this period that ACOS did not account for. A record SEEN needs no ' +
        'completeness guarantee, so this I8 finding stands immediately',
    });
  }
  return Object.freeze({
    outcome: 'SWEEP_INCOMPLETE' as const,
    providerRecordsExamined: observed.examinedEvents,
    pagesRead: 1,
    stoppedBecause: 'PROVIDER_COMPLETENESS_UNESTABLISHED' as const,
    unaccounted: Object.freeze([]),
    statement:
      `nothing unaccounted was seen across ${String(observed.examinedEvents)} authenticated ` +
      'event(s), but signed push evidence carries no completeness signal: a quiet channel is ' +
      'not a clean one, and I8 is not evaluated on it',
  });
}
