import { describe, expect, it } from 'vitest';

import {
  normaliseActivityRecords,
  toProviderReadResult,
  type SendGridReadResponse,
} from '../../validation/sendgrid/audit/activityRecords.js';
import { observeCorrelation } from '../../validation/sendgrid/harness/observation.js';
import { MIN_STABILISATION_OBSERVATIONS } from '../../validation/sendgrid/harness/observation.js';
import { FIXTURE_VISIBILITY_BOUND } from '../../validation/sendgrid/harness/visibilityBound.js';

/**
 * SECOND REVIEW, DEFECT 2 — **A MALFORMED 2XX IS NOT EVIDENCE, AND A VALID ZERO IS.**
 *
 * =================================================================================
 * `§2.4`'s FIVE REQUIRED NEGATIVE CONTROLS, AND THE ONE THAT MATTERS MOST
 *
 * The first four are shape checks. The fifth is the reason the defect was a blocker:
 *
 *     "malformed duplicate cannot permit an I36 PASS"
 *
 * The rejected normaliser DROPPED an unreadable record and returned the rest, so a provider
 * answer carrying a real duplicate — one readable record and one malformed one — produced a
 * count of ONE. That is exactly the count a non-duplicated send produces, so the oracle would
 * have certified the condition `I36` exists to exclude, with every local assertion passing.
 *
 * The last case below drives that end to end through the real observation loop.
 * =================================================================================
 */

const TAG = 'acos-corr-00000000-0000-4000-8000-0000000000ff';

function readable(msgId: string, tag: string | null): Record<string, unknown> {
  return {
    msg_id: msgId,
    status: 'delivered',
    last_event_time: '2026-09-27T00:10:00Z',
    ...(tag === null ? {} : { categories: [tag] }),
  };
}

/** The client mapping `§2.3` requires: a structurally invalid 2xx is `UNREADABLE_RESPONSE`. */
function clientResponseFor(payload: unknown): SendGridReadResponse {
  const normalised = normaliseActivityRecords(payload, TAG);
  return normalised.kind === 'MALFORMED'
    ? { kind: 'UNREADABLE_RESPONSE', httpStatus: 200 }
    : { kind: 'ANSWERED', httpStatus: 200, records: normalised.records };
}

describe('`§2.4` — THE FOUR SHAPE CONTROLS', () => {
  it('HTTP 200 + `{}` -> NON-EVIDENCE', () => {
    const response = clientResponseFor({});
    expect(response.kind).toBe('UNREADABLE_RESPONSE');
    expect(toProviderReadResult(response, 'MESSAGE_ACTIVITY_SEARCH').kind).toBe(
      'PROVIDER_UNAVAILABLE',
    );
  });

  it('HTTP 200 + `{ messages: "wrong" }` -> NON-EVIDENCE', () => {
    const response = clientResponseFor({ messages: 'wrong' });
    expect(response.kind).toBe('UNREADABLE_RESPONSE');
    expect(toProviderReadResult(response, 'MESSAGE_ACTIVITY_SEARCH').kind).toBe(
      'PROVIDER_UNAVAILABLE',
    );
  });

  it('HTTP 200 + one valid record + one malformed record -> NON-EVIDENCE, **NOT count 1**', () => {
    const payload = {
      messages: [readable('valid-1', TAG), { msg_id: 'malformed id', status: 'delivered' }],
    };
    const response = clientResponseFor(payload);
    expect(response.kind).toBe('UNREADABLE_RESPONSE');

    const result = toProviderReadResult(response, 'MESSAGE_ACTIVITY_SEARCH');
    expect(result.kind).toBe('PROVIDER_UNAVAILABLE');
    /*
     * THE ASSERTION THE REJECTED BEHAVIOUR WOULD HAVE FAILED.
     *
     * There is no `recordCount` to inspect, because there is no evidence. Had the normaliser
     * dropped the malformed entry, this would have been `EVIDENCE` with `recordCount: 1`.
     */
    expect(result).not.toHaveProperty('recordCount');
  });

  it('HTTP 200 + `{ messages: [] }` -> LEGITIMATE EVIDENCE with count 0', () => {
    const response = clientResponseFor({ messages: [] });
    expect(response.kind).toBe('ANSWERED');

    const result = toProviderReadResult(response, 'MESSAGE_ACTIVITY_SEARCH');
    expect(result.kind).toBe('EVIDENCE');
    if (result.kind !== 'EVIDENCE') return;
    // A VALID ZERO. The provider answered, the shape was right, and the array was empty.
    expect(result.recordCount).toBe(0);
    expect(result.records).toEqual([]);
  });
});

describe('`§2.4` — A MALFORMED DUPLICATE CANNOT PERMIT AN `I36` PASS', () => {
  it('two accepted messages, one unreadable: the oracle reports NO COUNT, never 1', async () => {
    /*
     * THE PROVIDER GENUINELY HOLDS TWO ACCEPTED MESSAGES for this correlation. The second is
     * returned with an unusable `msg_id`, which is the realistic failure: a field the client
     * cannot read, on a record that really exists.
     *
     * The rejected pipeline would have dropped it and reported ONE — indistinguishable from a
     * correctly non-duplicated send, and therefore an `I36` PASS on a duplicate.
     */
    const duplicatePayload = {
      messages: [readable('real-1', TAG), { ...readable('real-2', TAG), msg_id: 'bad id' }],
    };

    const result = await observeCorrelation(
      {
        read: () =>
          Promise.resolve(
            toProviderReadResult(clientResponseFor(duplicatePayload), 'MESSAGE_ACTIVITY_SEARCH'),
          ),
        delay: () => Promise.resolve(),
        now: () => 0,
      },
      {
        correlationTag: TAG,
        periodStartMs: 0,
        periodEndMs: 1_000,
        maxAttempts: 4,
        intervalMs: 10_000,
        maxDurationMs: 600_000,
        maxRecords: 50,
        stabilisationObservations: MIN_STABILISATION_OBSERVATIONS,
        visibilityBound: FIXTURE_VISIBILITY_BOUND,
        lastPossibleWriteAtMs: 0,
      },
    );

    // EVERY read was non-evidence, so the provider was never reached in the evidentiary sense.
    expect(result.outcome).toBe('PROVIDER_UNAVAILABLE_THROUGHOUT');
    // **NOT 1.** The count is withheld entirely, so no row can pass on it.
    expect(result.providerAcceptedCount).toBeNull();
    expect(result.providerAcceptedCount).not.toBe(1);
  });

  it('and the SAME two messages, both readable, are correctly counted as TWO', async () => {
    /*
     * NON-VACUOUS. The previous case must fail because the answer was UNREADABLE, not because
     * the loop cannot count to two. Same duplicate, both records well-formed.
     */
    const readablePayload = { messages: [readable('real-1', TAG), readable('real-2', TAG)] };

    const result = await observeCorrelation(
      {
        read: () =>
          Promise.resolve(
            toProviderReadResult(clientResponseFor(readablePayload), 'MESSAGE_ACTIVITY_SEARCH'),
          ),
        delay: () => Promise.resolve(),
        now: () => 0,
      },
      {
        correlationTag: TAG,
        periodStartMs: 0,
        periodEndMs: 1_000,
        maxAttempts: 6,
        intervalMs: 10_000,
        maxDurationMs: 600_000,
        maxRecords: 50,
        stabilisationObservations: MIN_STABILISATION_OBSERVATIONS,
        visibilityBound: FIXTURE_VISIBILITY_BOUND,
        lastPossibleWriteAtMs: 0,
      },
    );

    expect(result.outcome).toBe('PROVIDER_ACTIVITY_OBSERVED');
    expect(result.providerAcceptedCount).toBe(2);
  });
});

describe('THE INVERSE SWEEP READS THE PROVIDER\'S OWN TAG, NOT THE ABSENCE OF A QUESTION', () => {
  /*
   * A DEFECT THE SECOND REVIEW'S BLOCKER 1 UNCOVERED, AND THE REGRESSION GUARD FOR IT.
   *
   * `normaliseActivityRecords` echoes a correlation tag only when the provider's own
   * `categories` array carried it — the guard that stops a narrowed read from being a
   * self-fulfilling match. The rejected form short-circuited on `expectedCorrelationTag`
   * being non-null, so an INVERSE SWEEP, which by definition supplies no tag, received
   * `correlationTag: null` on EVERY record.
   *
   * `runInverseSweep` reads `null` as UNACCOUNTED. So the sweep reported every message in
   * the account as an `I8` control violation — including the ones ACOS had itself just sent
   * and tagged. It stayed invisible for exactly as long as no entry point could run a sweep.
   */
  const OTHER = 'acos-corr-00000000-0000-4000-8000-0000000000aa';

  it('a sweep read reports the ACOS tag each record actually carried', () => {
    // The SWEEP supplies NO tag. That is the whole difference from a narrowed read.
    const response = normaliseActivityRecords(
      { messages: [readable('ours-1', TAG), readable('ours-2', OTHER)] },
      null,
    );
    expect(response.kind).toBe('VALID');
    if (response.kind !== 'VALID') return;

    // **THE ASSERTION THE REJECTED FORM FAILS**: two nulls instead of two tags.
    expect(response.records.map((record) => record.correlationTag)).toEqual([TAG, OTHER]);
  });

  it('a record with NO ACOS tag still reports `null`, which is `I8`s finding', () => {
    const response = normaliseActivityRecords(
      {
        messages: [
          readable('theirs', null),
          { ...readable('marketing', null), categories: ['newsletter'] },
        ],
      },
      null,
    );
    expect(response.kind).toBe('VALID');
    if (response.kind !== 'VALID') return;
    /*
     * NON-VACUOUS IN THE OTHER DIRECTION. The fix must not make every record accounted for:
     * a message the harness did not send carries no ACOS correlation tag, and reporting it
     * as unaccounted is the whole purpose of the sweep.
     */
    expect(response.records.map((record) => record.correlationTag)).toEqual([null, null]);
  });

  it('a record carrying TWO ACOS tags is ambiguous, and reports `null` rather than guessing', () => {
    const response = normaliseActivityRecords(
      { messages: [{ ...readable('ambiguous', null), categories: [TAG, OTHER] }] },
      null,
    );
    expect(response.kind).toBe('VALID');
    if (response.kind !== 'VALID') return;
    // Resolving it by array position would attribute a message to a correlation on the
    // strength of the provider's ordering. The reviewer sees the ambiguity instead.
    expect(response.records[0]?.correlationTag).toBeNull();
  });

  it('a NARROWED read is unchanged: the tag is echoed only when the provider carried it', () => {
    // The original guard, still exactly as strict. A record tagged for another correlation
    // must not answer this correlation's question.
    const normalised = normaliseActivityRecords(
      { messages: [readable('ours-2', OTHER)] },
      TAG,
    );
    expect(normalised.kind).toBe('VALID');
    if (normalised.kind !== 'VALID') return;
    expect(normalised.records[0]?.correlationTag).toBeNull();
  });
});
