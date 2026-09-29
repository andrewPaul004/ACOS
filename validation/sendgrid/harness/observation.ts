import type {
  ProviderEvidenceRecord,
  ProviderReadOperation,
} from '../../../src/audit/provider/protocol/readWire.js';
import { SENDGRID_ACTIVITY_REQUESTS_PER_MINUTE } from '../audit/activityRecords.js';
import {
  boundSettlesLiveAbsence,
  settlingIntervalMs,
  type VisibilityBound,
} from './visibilityBound.js';

/**
 * `§8.4`, `§10` — BOUNDED OBSERVATION, AND THE `I36` ACCEPTED-COUNT ORACLE. IT WAITS, AND IT
 * NEVER SENDS.
 *
 * =================================================================================
 * THE ONE SENTENCE THIS WHOLE MODULE EXISTS TO MAKE STRUCTURALLY TRUE
 *
 * `§8.4`: "The poller may wait for provider visibility. **The poller may NEVER resend.**"
 *
 * And the way it is made true is not a rule this module follows. It is the shape of its
 * argument: `ObservationDeps.read` is a function from a read QUERY to a read RESULT, and
 * there is no second function, no adapter, no registry, no gateway entry point and no
 * dispatch identity anywhere in this file's scope. **There is nothing here to resend WITH.**
 *
 * =================================================================================
 * CORRECTION 10 — THE ORACLE MUST BE ABLE TO SEE A **SECOND** MESSAGE
 *
 * The rejected loop returned on the FIRST attempt that saw a matching record, and its own
 * comment admitted the consequence: "a duplicate that appeared later would not be seen by
 * THIS loop." The review's finding is that this cannot be the `I36` oracle, and it is right
 * for a reason worth stating plainly.
 *
 * `I36` asks whether a recovery path produced a SECOND provider-accepted message. Email
 * Activity is eventually consistent — two messages accepted moments apart do not become
 * visible at the same moment — so a loop that stops the instant it sees ONE is a loop whose
 * answer to "were there two?" is always "I saw one". It would report
 * `providerAcceptedCount: 1` for a genuine duplicate. The oracle would pass the exact
 * condition it exists to exclude.
 *
 * SO OBSERVATION IS NOW TWO PHASES:
 *
 *   DISCOVERY      poll until the correlation first becomes visible, or the bound expires.
 *                  Unchanged in every respect from the accepted loop.
 *   STABILISATION  after the first sighting, keep querying THE SAME CORRELATION for a fixed
 *                  number of FURTHER SUCCESSFUL OBSERVATIONS, accumulating DISTINCT provider
 *                  message ids across all of them. Only then is the count final.
 *
 * `providerAcceptedCount` is therefore the count after a window in which a late second
 * message had a bounded, deterministic opportunity to appear — and
 * `tests/sendgrid/observation.test.ts` drives exactly that case: attempt 3 shows one message,
 * attempt 4 shows two, and the oracle returns 2.
 *
 * **IT IS STILL BOUNDED, AND IT STILL NEVER RESENDS.** Stabilisation consumes the same
 * attempt and duration bounds as discovery; there is no second budget and no extension. A
 * run that cannot complete its stabilisation observations ends `STABILISATION_UNRESOLVED`
 * with **`providerAcceptedCount: null`** — `§10.1`: "If provider availability is lost during
 * the stabilization period such that the final count cannot be trusted: UNRESOLVED not PASS."
 *
 * =================================================================================
 * "NOT VISIBLE YET" IS NOT "NEVER SENT", AND THE RESULT TYPE REFUSES TO SAY IT IS
 *
 * `§8.4`: "never treat 'not visible yet' as permission to resend"; "preserve unknown outcome
 * when the evidence is genuinely insufficient". `§12`: "no conversion of uncertainty into
 * `NOT_SENT_CONFIRMED`".
 *
 * So the exhausted case is `NOT_OBSERVED_WITHIN_BOUND` and its own documentation says what it
 * is not. There is no `NOT_SENT`, no `NEVER_SENT` and no `CONFIRMED_ABSENT` member of
 * `ObservationOutcome`, because Email Activity latency and an unsent message produce the
 * same reading and no number of attempts distinguishes them.
 *
 * =================================================================================
 * THE BOUND IS TWO BOUNDS, AND EITHER ENDS IT
 *
 * `§8.4` requires "explicit maximum duration AND/OR maximum attempts". Both are carried, both
 * are checked, and the loop ends on whichever comes first. The delay is DETERMINISTIC — a
 * fixed interval, not an exponential backoff with jitter — because the evidence has to say
 * when each attempt happened and a reviewer has to be able to check the spacing against the
 * provider's published rate limit.
 *
 * That limit is S1O's own recorded figure: 6 requests per minute on the Email Activity API.
 * `MIN_OBSERVATION_INTERVAL_MS` is derived from it rather than guessed, and the loop refuses
 * a configured interval below it — a poller that trips a documented 429 is a poller whose
 * empty readings are about the rate limit rather than about the message.
 * =================================================================================
 */

/** 60_000 / 6 = 10_000ms. Derived from the published limit, never chosen. */
export const MIN_OBSERVATION_INTERVAL_MS = Math.ceil(
  60_000 / SENDGRID_ACTIVITY_REQUESTS_PER_MINUTE,
);

/** A hard ceiling on attempts, across BOTH phases. A bound is a bound. */
export const MAX_OBSERVATION_ATTEMPTS = 12;

/** A hard ceiling on wall-clock duration, for the same reason. */
export const MAX_OBSERVATION_DURATION_MS = 10 * 60 * 1000;

/**
 * How many FURTHER SUCCESSFUL observations must follow the first sighting before a count is
 * final. The declared minimum, and the default.
 *
 * TWO rather than one. One further observation is a single sample of a feed that has already
 * proved it lags; two consecutive agreeing observations, at the published rate-limit spacing,
 * is the smallest window in which a late duplicate has more than one chance to appear. It is
 * a DECLARED S1P FIXTURE DECISION and not an architecture-derived figure — no accepted
 * deliverable states a stabilisation depth — and it is recorded as one in
 * `docs/implementation/S1P-owner-clarifications.md`.
 */
export const MIN_STABILISATION_OBSERVATIONS = 2;

/** And a ceiling, so a mis-configured depth cannot consume the whole attempt budget. */
export const MAX_STABILISATION_OBSERVATIONS = 6;

/** What ONE observation attempt recorded. Evidence, and it is kept whatever the outcome. */
export interface ObservationAttempt {
  readonly attempt: number;
  readonly startedAtMs: number;
  readonly operation: ProviderReadOperation;
  /** How the audit read ended. The provider's own answer, unmapped. */
  readonly result: 'EVIDENCE' | 'PROVIDER_UNAVAILABLE';
  /** Which phase this attempt belonged to. Evidence a reviewer can check the window against. */
  readonly phase: 'DISCOVERY' | 'STABILISATION';
  /** Records whose correlation tag the PROVIDER echoed. Never records the matcher wrote. */
  readonly matchingRecords: number;
  /** The provider's own total for the period, which may exceed the records returned. */
  readonly recordCount: number;
  /** Distinct provider message ids accumulated up to and including this attempt. */
  readonly distinctMessageIdsSoFar: number;
}

export const OBSERVATION_OUTCOMES = [
  /**
   * The correlation became visible AND the stabilisation window completed.
   *
   * THE ONLY OUTCOME THAT YIELDS A FINAL `providerAcceptedCount`.
   */
  'PROVIDER_ACTIVITY_OBSERVED',
  /**
   * The correlation became visible and the stabilisation window did NOT complete — the
   * attempt or duration bound expired first, or the provider stopped answering.
   *
   * **THE COUNT IS NOT FINAL AND IS NOT REPORTED.** `§10.1`. What was seen is still carried
   * in `providerMessageIds` as a LOWER BOUND, because records that were observed were
   * observed; what is withheld is the claim that nothing more would have appeared.
   */
  'STABILISATION_UNRESOLVED',
  /**
   * The bound was reached with no matching record.
   *
   * **THIS IS NOT EVIDENCE THAT NOTHING WAS SENT.** Email Activity latency, a missing
   * entitlement, a correlation field that did not round-trip and a message that never left
   * all read identically here. `§12`: uncertainty stays uncertainty.
   */
  'NOT_OBSERVED_WITHIN_BOUND',
  /** Every attempt failed to reach the provider. Evidence about the network, not the message. */
  'PROVIDER_UNAVAILABLE_THROUGHOUT',
] as const;

export type ObservationOutcome = (typeof OBSERVATION_OUTCOMES)[number];

export interface ObservationResult {
  readonly outcome: ObservationOutcome;
  readonly correlationTag: string;
  readonly attempts: readonly ObservationAttempt[];
  /**
   * `§10` — THE PROVIDER-SIDE ACCEPTED-MESSAGE COUNT FOR THIS CORRELATION.
   *
   * The number of DISTINCT provider message ids the provider returned carrying this tag,
   * measured AFTER the stabilisation window. It is the `I36` oracle's operand and it is NOT
   * a local invocation count, a mock count, an HTTP client call count or an ACOS log count —
   * those are counted elsewhere and compared against this, never substituted for it.
   *
   * **`null` UNLESS `PROVIDER_ACTIVITY_OBSERVED`.** A count from an incomplete window is not
   * a count of what the provider accepted; it is a count of what had become visible when the
   * loop ran out, and treating the two as the same is the defect correction 10 closes.
   */
  readonly providerAcceptedCount: number | null;
  /**
   * The distinct provider message ids observed, in any phase. Evidence, and a LOWER BOUND on
   * the accepted count even when `providerAcceptedCount` is `null`.
   */
  readonly providerMessageIds: readonly string[];
  /** How many stabilisation observations were still owed when the loop ended. `0` on a pass. */
  readonly stabilisationObservationsOutstanding: number;
  /**
   * `§4.3` — WHETHER THE EVIDENCE-BACKED SETTLING INTERVAL ACTUALLY COMPLETED.
   *
   * `true` only when the bound can settle an absence AND the interval had elapsed since the
   * last possible write by the time the final successful observation was taken. `false` for
   * an `UNESTABLISHED` bound, always — which is SendGrid today.
   */
  readonly settlingIntervalCompleted: boolean;
  /** Which kind of bound this observation ran under. Carried into evidence (`§4.4`). */
  readonly visibilityBoundKind: VisibilityBound['kind'];
}

/** The read the loop drives, and the delay it waits with. THERE IS NO THIRD MEMBER. */
export interface ObservationDeps {
  /**
   * One period-bounded, correlation-narrowed audit read.
   *
   * The result type is the ACCEPTED audit plane's, so what this loop can learn is exactly
   * what `48 §3.6`'s read-only boundary can produce. There is no richer channel.
   *
   * **A FAILED PROVIDER QUERY ARRIVES HERE AS `PROVIDER_UNAVAILABLE`, NOT AS EVIDENCE OF
   * ZERO.** That is correction 9, enforced one layer down in `audit/reader.ts`, and this
   * loop depends on it: an `EVIDENCE` result with no records means the provider answered and
   * held nothing for this tag YET, which is a different fact from a refused query and is
   * treated differently by both phases below.
   */
  readonly read: (query: {
    readonly operation: ProviderReadOperation;
    /**
     * `string | null`, matching the ACCEPTED `ProviderReadQuery` exactly.
     *
     * The observation loop always passes a TAG — it is asking whether the provider accepted a
     * specific message. `null` is what `I8`'s INVERSE SWEEP passes (`inverseSweep.ts`), and the
     * port is typed for both because both go through the SAME audit IPC and neither may have a
     * capability the other lacks. `48`'s v1.3 note keeps the read period-bounded either way.
     */
    readonly correlationTag: string | null;
    readonly periodStartMs: number;
    readonly periodEndMs: number;
    readonly maxRecords: number;
  }) => Promise<
    | {
        readonly kind: 'EVIDENCE';
        readonly records: readonly ProviderEvidenceRecord[];
        readonly recordCount: number;
      }
    | { readonly kind: 'PROVIDER_UNAVAILABLE' }
  >;
  /** Injected so the suite can drive the loop without waiting. Deterministic either way. */
  readonly delay: (ms: number) => Promise<void>;
  /** Injected for the same reason. Never used to decide anything but the bound. */
  readonly now: () => number;
}

export interface ObservationBound {
  readonly correlationTag: string;
  readonly periodStartMs: number;
  readonly periodEndMs: number;
  readonly maxAttempts: number;
  readonly intervalMs: number;
  readonly maxDurationMs: number;
  readonly maxRecords: number;
  /**
   * How many further SUCCESSFUL observations must follow the first sighting.
   *
   * Clamped up to `MIN_STABILISATION_OBSERVATIONS` and down to
   * `MAX_STABILISATION_OBSERVATIONS`, so no configuration can reduce the oracle to the
   * stop-on-first behaviour correction 10 removed.
   *
   * **THIS IS DEFENCE IN DEPTH AND NO LONGER LOAD-BEARING ON ITS OWN.** Second review `§4.3`:
   * a live final count requires the samples AND the visibility interval below.
   */
  readonly stabilisationObservations: number;
  /**
   * `§4.1` — WHAT MAKES "NO LATER RECORD APPEARED" MEAN ANYTHING.
   *
   * `FIXTURE_DETERMINISTIC` offline; `UNESTABLISHED` for SendGrid today, which observes the
   * count and withholds the no-duplicate conclusion; `MEASURED_INTERVAL` once an
   * evidence-backed bound exists.
   */
  readonly visibilityBound: VisibilityBound;
  /**
   * `§4.2` — THE INSTANT OF THE LAST POSSIBLE WRITE IN THIS SCENARIO.
   *
   * The settling interval runs from HERE, not from the first sighting. `§4.2`: "Any live
   * stabilization interval must begin relative to the last possible write in that scenario,
   * including the recovery/re-entry attempt being tested." A window that closed before the
   * recovery ran would certify a duplicate that had not been given time to appear.
   */
  readonly lastPossibleWriteAtMs: number;
}

/** Clamp a configured bound into the declared ceilings. A bound is a bound. */
export function clampObservationBound(bound: ObservationBound): ObservationBound {
  // `visibilityBound` and `lastPossibleWriteAtMs` are EVIDENCE OPERANDS, not budgets, so they
  // are carried through unclamped: there is no safe direction in which to adjust a provider
  // guarantee or the instant of a write that already happened.
  return Object.freeze({
    ...bound,
    maxAttempts: Math.max(1, Math.min(bound.maxAttempts, MAX_OBSERVATION_ATTEMPTS)),
    intervalMs: Math.max(bound.intervalMs, MIN_OBSERVATION_INTERVAL_MS),
    maxDurationMs: Math.max(1, Math.min(bound.maxDurationMs, MAX_OBSERVATION_DURATION_MS)),
    stabilisationObservations: Math.max(
      MIN_STABILISATION_OBSERVATIONS,
      Math.min(bound.stabilisationObservations, MAX_STABILISATION_OBSERVATIONS),
    ),
  });
}

/**
 * Poll one correlation through DISCOVERY and STABILISATION, and return the `I36` oracle's
 * operand or an honest refusal to supply one.
 *
 * `MESSAGE_ACTIVITY_SEARCH` on every attempt: the operation is a CONSTANT in this function,
 * so there is no attempt at which the loop could escalate to a different operation, and
 * `MESSAGE_ACTIVITY_COUNT` is not used because a count without ids cannot tell a reviewer
 * WHICH messages were accepted — and cannot be de-duplicated across attempts, which
 * stabilisation requires.
 */
export async function observeCorrelation(
  deps: ObservationDeps,
  rawBound: ObservationBound,
): Promise<ObservationResult> {
  const bound = clampObservationBound(rawBound);
  const startedAt = deps.now();
  const attempts: ObservationAttempt[] = [];
  const messageIds = new Set<string>();
  let reachedProvider = false;
  let discovered = false;
  /** Successful observations still owed AFTER the first sighting. */
  let outstanding = bound.stabilisationObservations;

  for (let attempt = 1; attempt <= bound.maxAttempts; attempt += 1) {
    const attemptStart = deps.now();
    if (attempt > 1) {
      // THE DEADLINE IS CHECKED BEFORE THE WAIT, so the loop cannot sleep past its own bound.
      if (attemptStart - startedAt + bound.intervalMs > bound.maxDurationMs) break;
      await deps.delay(bound.intervalMs);
    }

    const phase = discovered ? ('STABILISATION' as const) : ('DISCOVERY' as const);
    const result = await deps.read({
      operation: 'MESSAGE_ACTIVITY_SEARCH',
      correlationTag: bound.correlationTag,
      periodStartMs: bound.periodStartMs,
      periodEndMs: bound.periodEndMs,
      maxRecords: bound.maxRecords,
    });

    if (result.kind === 'PROVIDER_UNAVAILABLE') {
      /*
       * A FAILED READ CONSUMES AN ATTEMPT AND SETTLES NOTHING — IN EITHER PHASE.
       *
       * It does not discharge a stabilisation observation, so a provider that stops
       * answering after the first sighting cannot be mistaken for a stable count: the loop
       * runs out its budget still owing observations and ends `STABILISATION_UNRESOLVED`.
       * `§10.1`, and the case `tests/sendgrid/observation.test.ts` drives directly.
       */
      attempts.push(
        Object.freeze({
          attempt,
          startedAtMs: attemptStart,
          operation: 'MESSAGE_ACTIVITY_SEARCH' as const,
          result: 'PROVIDER_UNAVAILABLE' as const,
          phase,
          matchingRecords: 0,
          recordCount: 0,
          distinctMessageIdsSoFar: messageIds.size,
        }),
      );
      continue;
    }

    reachedProvider = true;
    /*
     * A RECORD COUNTS ONLY IF THE PROVIDER ECHOED THE TAG.
     *
     * The audit reader sets `correlationTag` from the provider's own `categories` array and
     * leaves it `null` when the provider carried none, so this filter is reading the
     * provider's answer rather than the question. A period-bounded read legitimately returns
     * records about other correlations — `I8`'s inverse sweep depends on that — and counting
     * them here would make every scenario's accepted count the account's traffic.
     */
    const matching = result.records.filter(
      (record) => record.correlationTag === bound.correlationTag,
    );
    for (const record of matching) messageIds.add(record.providerMessageId);

    if (!discovered) {
      // DISCOVERY. A successful read with no match leaves the phase unchanged; the first
      // match opens the stabilisation window and does NOT itself discharge one of it.
      if (matching.length > 0) discovered = true;
    } else {
      // STABILISATION. A SUCCESSFUL read discharges one owed observation, whether or not it
      // added a new id — the point of the window is elapsed, observed time, not new records.
      outstanding -= 1;
    }

    attempts.push(
      Object.freeze({
        attempt,
        startedAtMs: attemptStart,
        operation: 'MESSAGE_ACTIVITY_SEARCH' as const,
        result: 'EVIDENCE' as const,
        phase,
        matchingRecords: matching.length,
        recordCount: result.recordCount,
        distinctMessageIdsSoFar: messageIds.size,
      }),
    );

    /*
     * `§4.3` — THE LOOP MAY ONLY FINISH WHEN **BOTH** CONDITIONS HOLD.
     *
     *   SAMPLES   the owed stabilisation observations are discharged;
     *   INTERVAL  the evidence-backed settling interval has elapsed SINCE THE LAST POSSIBLE
     *             WRITE (`§4.2`), measured at the instant of THIS successful observation.
     *
     * For a `FIXTURE_DETERMINISTIC` bound the interval is zero and settled, because the
     * simulated account is a file this process controls. For an `UNESTABLISHED` bound the
     * interval is zero but `settled` is FALSE — the loop still finishes and still reports the
     * count, and `settlingIntervalCompleted: false` is what stops a no-duplicate conclusion
     * downstream. The count is observed; only the ABSENCE claim is withheld.
     */
    const settled =
      bound.visibilityBound.kind === 'FIXTURE_DETERMINISTIC' ||
      (boundSettlesLiveAbsence(bound.visibilityBound) &&
        attemptStart - bound.lastPossibleWriteAtMs >= settlingIntervalMs(bound.visibilityBound));

    if (discovered && outstanding <= 0 && (settled || !boundSettlesLiveAbsence(bound.visibilityBound))) {
      return Object.freeze({
        outcome: 'PROVIDER_ACTIVITY_OBSERVED' as const,
        correlationTag: bound.correlationTag,
        attempts: Object.freeze([...attempts]),
        providerAcceptedCount: messageIds.size,
        providerMessageIds: Object.freeze([...messageIds].sort()),
        stabilisationObservationsOutstanding: 0,
        settlingIntervalCompleted: settled,
        visibilityBoundKind: bound.visibilityBound.kind,
      });
    }
  }

  return Object.freeze({
    outcome: discovered
      ? ('STABILISATION_UNRESOLVED' as const)
      : reachedProvider
        ? ('NOT_OBSERVED_WITHIN_BOUND' as const)
        : ('PROVIDER_UNAVAILABLE_THROUGHOUT' as const),
    correlationTag: bound.correlationTag,
    attempts: Object.freeze([...attempts]),
    /*
     * A COUNT IS REPORTED ONLY WHEN THE WINDOW COMPLETED — WHICH, ON THIS RETURN, IT NEVER
     * DID.
     *
     * `NOT_OBSERVED_WITHIN_BOUND` still reports ZERO when a read actually reached the
     * provider, because that is the accepted meaning of the row and `KILL_POINT_ROWS`'s
     * zero-expectation scenarios read it: the provider answered, repeatedly, and held nothing
     * for this tag. Its conclusion limit — bounded non-observation is not proof of
     * never-sent — is carried in `KILL_POINT_CONCLUSION_LIMITS` and applied by the driver.
     *
     * `STABILISATION_UNRESOLVED` reports `null`: something WAS accepted and the final number
     * is exactly what could not be established.
     */
    providerAcceptedCount: discovered ? null : reachedProvider ? 0 : null,
    providerMessageIds: Object.freeze([...messageIds].sort()),
    stabilisationObservationsOutstanding: discovered ? Math.max(outstanding, 0) : 0,
    /*
     * A RUN THAT REACHED THIS RETURN DID NOT COMPLETE ITS WINDOW.
     *
     * Either it never discovered the correlation, or it ran out of budget mid-stabilisation,
     * or a `MEASURED_INTERVAL` bound was still open. None of them settles an absence.
     */
    settlingIntervalCompleted: false,
    visibilityBoundKind: bound.visibilityBound.kind,
  });
}
