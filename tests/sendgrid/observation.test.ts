import { describe, expect, it } from 'vitest';

import type { ProviderEvidenceRecord } from '../../src/audit/provider/protocol/readWire.js';
import { mintCorrelationTag } from '../../src/kernel/outbox/correlationTag.js';
import {
  MAX_OBSERVATION_ATTEMPTS,
  MAX_OBSERVATION_DURATION_MS,
  MAX_STABILISATION_OBSERVATIONS,
  MIN_OBSERVATION_INTERVAL_MS,
  MIN_STABILISATION_OBSERVATIONS,
  clampObservationBound,
  observeCorrelation,
  type ObservationBound,
  type ObservationDeps,
} from '../../validation/sendgrid/harness/observation.js';
import { buildActivityQuery } from '../../validation/sendgrid/audit/providerReadClient.js';
import { FIXTURE_VISIBILITY_BOUND } from '../../validation/sendgrid/harness/visibilityBound.js';
import { normaliseActivityRecords } from '../../validation/sendgrid/audit/activityRecords.js';

/**
 * `§8.4`, `§12` — BOUNDED OBSERVATION, AND THE THINGS IT REFUSES TO CONCLUDE.
 *
 * Every case below drives the loop with an INJECTED read and an INJECTED clock, so the whole
 * file runs in microseconds and never reaches a provider. The deps object has two data
 * members and a read; there is no send in scope, which is the property `§8.4` is about.
 */

const TAG = mintCorrelationTag();
const PERIOD_START = Date.UTC(2026, 8, 27, 0, 0, 0);
const PERIOD_END = PERIOD_START + 60 * 60 * 1000;

function bound(overrides: Partial<ObservationBound> = {}): ObservationBound {
  return {
    correlationTag: TAG,
    periodStartMs: PERIOD_START,
    periodEndMs: PERIOD_END,
    maxAttempts: 4,
    intervalMs: MIN_OBSERVATION_INTERVAL_MS,
    maxDurationMs: 5 * 60 * 1000,
    maxRecords: 50,
    /*
     * CORRECTION 10 — the stabilisation depth is part of the BOUND, and the default is the
     * declared minimum. Every case below that expects an OBSERVED outcome must therefore leave
     * the loop enough attempts to complete the window, which is itself the point: a bound that
     * cannot stabilise does not produce a count.
     */
    stabilisationObservations: MIN_STABILISATION_OBSERVATIONS,
    /*
     * `§4.4` — THE OFFLINE SUITE RUNS UNDER THE **FIXTURE** BOUND, AND SAYS SO.
     *
     * Deterministic fixture timing is permitted for offline evidence and must be labelled
     * as such. The LIVE bound is `UNESTABLISHED` for SendGrid, and
     * `tests/sendgrid/live-finality.test.ts` is where that case is driven.
     */
    visibilityBound: FIXTURE_VISIBILITY_BOUND,
    lastPossibleWriteAtMs: 0,
    ...overrides,
  };
}

/**
 * Unwrap a normalisation that MUST be valid, failing loudly otherwise.
 *
 * DEFECT 2 made the normaliser return a discriminated result, and a test that silently
 * treated a `MALFORMED` as an empty list would be the very confusion the defect was about.
 */
function valid(
  result: ReturnType<typeof normaliseActivityRecords>,
): readonly { readonly providerMessageId: string; readonly correlationTag: string | null }[] {
  if (result.kind !== 'VALID') {
    throw new Error(`expected a VALID normalisation, got MALFORMED:${result.reason}`);
  }
  return result.records;
}

function record(tag: string | null, id: string): ProviderEvidenceRecord {
  return {
    providerMessageId: id,
    providerStatus: 'delivered',
    providerTimestampMs: PERIOD_START + 1000,
    correlationTag: tag,
  };
}

/** A deps object with a scripted read, a counted delay and a monotonic fake clock. */
function deps(script: readonly ('EMPTY' | 'UNAVAILABLE' | 'MATCH' | 'UNRELATED')[]): {
  readonly deps: ObservationDeps;
  readonly delays: number[];
  readonly reads: number;
} {
  const delays: number[] = [];
  let clock = 0;
  let reads = 0;
  const state = {
    deps: {
      read: (): Promise<
        | {
            readonly kind: 'EVIDENCE';
            readonly records: readonly ProviderEvidenceRecord[];
            readonly recordCount: number;
          }
        | { readonly kind: 'PROVIDER_UNAVAILABLE' }
      > => {
        const step = script[Math.min(reads, script.length - 1)] ?? 'EMPTY';
        reads += 1;
        state.reads = reads;
        if (step === 'UNAVAILABLE') return Promise.resolve({ kind: 'PROVIDER_UNAVAILABLE' });
        if (step === 'MATCH') {
          return Promise.resolve({
            kind: 'EVIDENCE',
            records: [record(TAG, 'msg-1')],
            recordCount: 1,
          });
        }
        if (step === 'UNRELATED') {
          return Promise.resolve({
            kind: 'EVIDENCE',
            records: [record('acos-corr-00000000-0000-4000-8000-00000000dead', 'other')],
            recordCount: 1,
          });
        }
        return Promise.resolve({ kind: 'EVIDENCE', records: [], recordCount: 0 });
      },
      delay: (ms: number): Promise<void> => {
        delays.push(ms);
        clock += ms;
        return Promise.resolve();
      },
      now: (): number => clock,
    },
    delays,
    reads: 0,
  };
  return state;
}

describe('`§8.4` — THE LOOP IS BOUNDED, IN BOTH DIMENSIONS', () => {
  it('it stops at `maxAttempts` and never reads again', async () => {
    const harness = deps(['EMPTY']);
    const result = await observeCorrelation(harness.deps, bound({ maxAttempts: 3 }));
    expect(result.outcome).toBe('NOT_OBSERVED_WITHIN_BOUND');
    expect(result.attempts).toHaveLength(3);
    expect(harness.reads).toBe(3);
  });

  it('it stops on the DURATION bound even with attempts remaining', async () => {
    const harness = deps(['EMPTY']);
    // One interval fits inside 12s; a second would not, so the loop ends after attempt 2.
    const result = await observeCorrelation(
      harness.deps,
      bound({ maxAttempts: 10, maxDurationMs: MIN_OBSERVATION_INTERVAL_MS + 2_000 }),
    );
    expect(result.attempts.length).toBeLessThan(10);
    expect(result.outcome).toBe('NOT_OBSERVED_WITHIN_BOUND');
  });

  it('a configured interval below the published rate limit is CLAMPED UP', () => {
    // S1O recorded 6 requests per minute; the floor is derived from it, never chosen.
    expect(MIN_OBSERVATION_INTERVAL_MS).toBe(10_000);
    const clamped = clampObservationBound(bound({ intervalMs: 5 }));
    expect(clamped.intervalMs).toBe(MIN_OBSERVATION_INTERVAL_MS);
  });

  it('an unbounded-looking configuration is CLAMPED DOWN to the declared ceilings', () => {
    const clamped = clampObservationBound(
      bound({ maxAttempts: 10_000, maxDurationMs: Number.MAX_SAFE_INTEGER }),
    );
    expect(clamped.maxAttempts).toBe(MAX_OBSERVATION_ATTEMPTS);
    expect(clamped.maxDurationMs).toBe(MAX_OBSERVATION_DURATION_MS);
  });

  it('the delay between attempts is DETERMINISTIC — same value every time, no jitter', async () => {
    const harness = deps(['EMPTY']);
    await observeCorrelation(harness.deps, bound({ maxAttempts: 4 }));
    expect(new Set(harness.delays).size).toBe(1);
    expect(harness.delays[0]).toBe(MIN_OBSERVATION_INTERVAL_MS);
  });
});

describe('`§12` — "NOT VISIBLE YET" IS NEVER "NEVER SENT"', () => {
  it('exhausting the bound yields NOT_OBSERVED_WITHIN_BOUND, and that is not a negative', async () => {
    const harness = deps(['EMPTY']);
    const result = await observeCorrelation(harness.deps, bound());
    expect(result.outcome).toBe('NOT_OBSERVED_WITHIN_BOUND');
    // The provider WAS reached, so a count of zero is a real reading.
    expect(result.providerAcceptedCount).toBe(0);
    // And there is no outcome member that could say the message was never sent.
    expect(JSON.stringify(result)).not.toMatch(/NOT_SENT|NEVER_SENT|CONFIRMED_ABSENT/);
  });

  it('an UNREACHED provider yields `null`, never a count of zero', async () => {
    const harness = deps(['UNAVAILABLE']);
    const result = await observeCorrelation(harness.deps, bound());
    expect(result.outcome).toBe('PROVIDER_UNAVAILABLE_THROUGHOUT');
    expect(result.providerAcceptedCount).toBeNull();
  });

  it('a record the provider returned for ANOTHER correlation does not count', async () => {
    /*
     * A period-bounded read legitimately returns other traffic — `I8`'s inverse sweep depends
     * on it — and counting it would make every scenario's accepted count the account's
     * volume. The loop filters on the tag the PROVIDER echoed.
     */
    const harness = deps(['UNRELATED']);
    const result = await observeCorrelation(harness.deps, bound({ maxAttempts: 2 }));
    expect(result.outcome).toBe('NOT_OBSERVED_WITHIN_BOUND');
    expect(result.providerAcceptedCount).toBe(0);
    expect(result.providerMessageIds).toEqual([]);
  });

  it('a matching record STARTS the stabilisation window; the count is final only after it', async () => {
    /*
     * CORRECTION 10, IN ONE READ COUNT.
     *
     * The rejected loop returned on attempt 3, the moment the tag first appeared. This one
     * continues for `MIN_STABILISATION_OBSERVATIONS` FURTHER successful observations, so it
     * reads five times — and those two extra reads are exactly the window in which a late
     * duplicate would have become visible.
     */
    const harness = deps(['EMPTY', 'EMPTY', 'MATCH', 'MATCH', 'MATCH']);
    const result = await observeCorrelation(harness.deps, bound({ maxAttempts: 6 }));
    expect(result.outcome).toBe('PROVIDER_ACTIVITY_OBSERVED');
    expect(result.providerAcceptedCount).toBe(1);
    expect(result.providerMessageIds).toEqual(['msg-1']);
    expect(harness.reads).toBe(3 + MIN_STABILISATION_OBSERVATIONS);
    expect(result.stabilisationObservationsOutstanding).toBe(0);
  });

  it('`§10.1` — a bound that expires MID-STABILISATION yields UNRESOLVED and NO count', async () => {
    // The tag appeared, and the loop ran out of attempts before the window closed.
    const harness = deps(['MATCH', 'MATCH']);
    const result = await observeCorrelation(harness.deps, bound({ maxAttempts: 2 }));
    expect(result.outcome).toBe('STABILISATION_UNRESOLVED');
    // A LOWER BOUND survives as evidence; the COUNT does not, because it is not final.
    expect(result.providerMessageIds).toEqual(['msg-1']);
    expect(result.providerAcceptedCount).toBeNull();
    expect(result.stabilisationObservationsOutstanding).toBeGreaterThan(0);
  });

  it('`§10.1` — losing the provider DURING stabilisation also yields UNRESOLVED', async () => {
    /*
     * The discriminating case `§19` item 11 names. The first sighting succeeded; every read
     * afterwards failed. A failed read does not discharge an owed observation, so the window
     * never closes and the loop refuses to report a count it cannot trust.
     */
    const harness = deps(['MATCH', 'UNAVAILABLE', 'UNAVAILABLE', 'UNAVAILABLE']);
    const result = await observeCorrelation(harness.deps, bound({ maxAttempts: 4 }));
    expect(result.outcome).toBe('STABILISATION_UNRESOLVED');
    expect(result.providerAcceptedCount).toBeNull();
    expect(result.attempts.filter((attempt) => attempt.phase === 'STABILISATION')).toHaveLength(3);
  });

  it('the stabilisation depth is CLAMPED UP, so no configuration restores stop-on-first', () => {
    for (const requested of [0, 1, -5]) {
      expect(clampObservationBound(bound({ stabilisationObservations: requested })).stabilisationObservations).toBe(
        MIN_STABILISATION_OBSERVATIONS,
      );
    }
    expect(
      clampObservationBound(bound({ stabilisationObservations: 999 })).stabilisationObservations,
    ).toBe(MAX_STABILISATION_OBSERVATIONS);
  });
});

describe('`§8.4`, `§19` — THE LOOP HAS NOTHING TO RESEND WITH', () => {
  it('`ObservationDeps` carries exactly `read`, `delay` and `now`', async () => {
    /*
     * A STRUCTURAL assertion rather than a behavioural one. The loop cannot send because the
     * only capability in its scope is a read, and this enumerates the scope.
     */
    const harness = deps(['MATCH']);
    expect(Object.keys(harness.deps).sort()).toEqual(['delay', 'now', 'read']);
    const result = await observeCorrelation(harness.deps, bound());
    expect(result.outcome).toBe('PROVIDER_ACTIVITY_OBSERVED');
  });

  it('every attempt uses MESSAGE_ACTIVITY_SEARCH — it never escalates to another operation', async () => {
    const harness = deps(['EMPTY']);
    const result = await observeCorrelation(harness.deps, bound({ maxAttempts: 4 }));
    for (const attempt of result.attempts) {
      expect(attempt.operation).toBe('MESSAGE_ACTIVITY_SEARCH');
    }
  });
});

describe('`§8.2` — THE ACTIVITY QUERY AND ITS NORMALISATION ARE BOUNDED AND PURE', () => {
  it('the query is period-bounded ALWAYS, and narrowed by the tag only when one is given', () => {
    const withTag = buildActivityQuery({
      correlationTag: TAG,
      periodStartMs: PERIOD_START,
      periodEndMs: PERIOD_END,
      limit: 10,
    });
    expect(withTag).toContain('last_event_time BETWEEN');
    expect(withTag).toContain(`Contains(categories,"${TAG}")`);

    const withoutTag = buildActivityQuery({
      correlationTag: null,
      periodStartMs: PERIOD_START,
      periodEndMs: PERIOD_END,
      limit: 10,
    });
    // `48`'s v1.3 note: a correlation tag NARROWS a period-bounded read, never replaces it.
    expect(withoutTag).toContain('last_event_time BETWEEN');
    expect(withoutTag).not.toContain('categories');
  });

  it('the normaliser ECHOES the tag only when the provider returned it', () => {
    const echoed = valid(
      normaliseActivityRecords(
        {
          messages: [
            { msg_id: 'a1', status: 'delivered', last_event_time: '2026-09-27T00:10:00Z', categories: [TAG] },
          ],
        },
        TAG,
      ),
    );
    expect(echoed[0]?.correlationTag).toBe(TAG);

    /*
     * THE DISCRIMINATING CASE: the provider returned a record with NO categories. A
     * normaliser that copied the REQUESTED tag would make the observation loop correlation
     * self-fulfilling, so the answer must be `null`.
     *
     * AND IT MUST STILL BE `VALID`. `§2.2` of the second review: "Do not require a
     * correlation tag to exist merely for I8; an honestly returned record with no correlation
     * tag remains an unaccounted record." A missing `categories` is an OPTIONAL field absent,
     * not a malformed answer.
     */
    const notEchoed = valid(
      normaliseActivityRecords(
        {
          messages: [{ msg_id: 'a2', status: 'delivered', last_event_time: '2026-09-27T00:10:00Z' }],
        },
        TAG,
      ),
    );
    expect(notEchoed[0]?.correlationTag).toBeNull();
  });

  it('DEFECT 2 — a record the normaliser cannot read makes the WHOLE QUERY non-evidence', () => {
    /*
     * =================================================================================
     * THIS CASE REPLACES ONE THAT ASSERTED THE OPPOSITE, AND `45 §3` REQUIRES THAT SAID OUT
     * LOUD.
     *
     * It read "a record the normaliser cannot read is DROPPED rather than guessed at", and
     * asserted that a six-entry payload with one readable record normalised to exactly that
     * one record. The second independent review rejected the behaviour:
     *
     *     "provider returned two records / one parses / second is malformed / answer is NOT
     *      'accepted count = 1'. Answer is: provider evidence incomplete/unreadable and the
     *      I36 row is UNRESOLVED."
     *
     * The old assertion was internally consistent and dangerous: dropping the unreadable
     * record produces a count of ONE, which is exactly the count a NON-duplicated send
     * produces, so a malformed duplicate could certify the condition `I36` exists to exclude.
     * =================================================================================
     */
    const result = normaliseActivityRecords(
      {
        messages: [
          { msg_id: 'ok', status: 'processed', last_event_time: '2026-09-27T00:10:00Z' },
          { msg_id: 'bad id with spaces', status: 'processed', last_event_time: '2026-09-27T00:10:00Z' },
        ],
      },
      null,
    );
    expect(result.kind).toBe('MALFORMED');
    if (result.kind !== 'MALFORMED') return;
    expect(result.reason).toBe('MESSAGE_ID_INVALID');
    // THE DIAGNOSTIC IS NOT A COUNT: one entry had been read, and it is NOT reported as one.
    expect(result.entriesReadBeforeDefect).toBe(1);
    expect(Object.keys(result)).not.toContain('records');
  });

  it('DEFECT 2 — each required field, alone, makes the query unreadable', () => {
    const cases: readonly (readonly [string, unknown, string])[] = [
      ['bad message id', { msg_id: 'bad id', status: 'ok', last_event_time: '2026-09-27T00:10:00Z' }, 'MESSAGE_ID_INVALID'],
      ['absent status', { msg_id: 'a', last_event_time: '2026-09-27T00:10:00Z' }, 'STATUS_INVALID'],
      ['empty status', { msg_id: 'a', status: '', last_event_time: '2026-09-27T00:10:00Z' }, 'STATUS_INVALID'],
      ['absent timestamp', { msg_id: 'a', status: 'ok' }, 'TIMESTAMP_INVALID'],
      ['unparseable timestamp', { msg_id: 'a', status: 'ok', last_event_time: 'not a date' }, 'TIMESTAMP_INVALID'],
      ['non-object entry', null, 'ENTRY_NOT_AN_OBJECT'],
      ['string entry', 'nonsense', 'ENTRY_NOT_AN_OBJECT'],
    ];
    for (const [label, entry, reason] of cases) {
      const result = normaliseActivityRecords({ messages: [entry] }, null);
      expect(result.kind, label).toBe('MALFORMED');
      if (result.kind !== 'MALFORMED') continue;
      expect(result.reason, label).toBe(reason);
    }
  });

  it('NO RECIPIENT ADDRESS SURVIVES NORMALISATION, even when the provider sent one', () => {
    const records = valid(
      normaliseActivityRecords(
      {
        messages: [
          {
            msg_id: 'ok',
            status: 'delivered',
            last_event_time: '2026-09-27T00:10:00Z',
            to_email: 'someone@real.example.com',
            from_email: 'sender@nonprod.example.test',
            subject: 'whatever',
          },
        ],
      },
      null,
      ),
    );
    expect(JSON.stringify(records)).not.toContain('real.example.com');
    expect(JSON.stringify(records)).not.toContain('to_email');
    expect(Object.keys(records[0] ?? {}).sort()).toEqual([
      'correlationTag',
      'providerMessageId',
      'providerStatus',
      'providerTimestampMs',
    ]);
  });

  it('DEFECT 2 — a payload that is not an activity response is MALFORMED, not empty', () => {
    /*
     * ALSO A REPLACEMENT, AND ALSO SAID OUT LOUD. This case read "yields no records at all"
     * and asserted `[]` for every one of these shapes — which `reader.ts` then turned into
     * `EVIDENCE` with `recordCount: 0`. A 2xx carrying `{}` is not an observation that the
     * account holds nothing.
     */
    const shapes: readonly (readonly [string, unknown, string])[] = [
      ['null', null, 'PAYLOAD_NOT_AN_OBJECT'],
      ['undefined', undefined, 'PAYLOAD_NOT_AN_OBJECT'],
      ['number', 42, 'PAYLOAD_NOT_AN_OBJECT'],
      ['string', 'string', 'PAYLOAD_NOT_AN_OBJECT'],
      ['array', [], 'PAYLOAD_NOT_AN_OBJECT'],
      ['empty object', {}, 'MESSAGES_NOT_AN_ARRAY'],
      ['messages not an array', { messages: 'no' }, 'MESSAGES_NOT_AN_ARRAY'],
    ];
    for (const [label, payload, reason] of shapes) {
      const result = normaliseActivityRecords(payload, null);
      expect(result.kind, label).toBe('MALFORMED');
      if (result.kind !== 'MALFORMED') continue;
      expect(result.reason, label).toBe(reason);
    }
  });

  it('DEFECT 2 — a VALID ZERO is different from every malformation, and IS evidence', () => {
    /*
     * The one shape that legitimately means "the provider answered and held nothing": the
     * top-level object is present, `messages` is a real array, and it is empty. `I36`s
     * zero-expectation rows read exactly this.
     */
    const result = normaliseActivityRecords({ messages: [] }, TAG);
    expect(result.kind).toBe('VALID');
    if (result.kind !== 'VALID') return;
    expect(result.records).toEqual([]);
  });
});
