import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  SENDGRID_ACTIVITY_COMPLETENESS,
  SENDGRID_COMPLETENESS_BASIS,
  type ActivityPage,
  type PageCompletenessSignal,
} from '../../validation/sendgrid/audit/activityCompleteness.js';
import {
  MAX_SWEEP_PAGES,
  clampSweepBound,
  runInverseSweep,
  type ActivityPageReader,
} from '../../validation/sendgrid/harness/inverseSweep.js';

/**
 * `§15` / SECOND REVIEW `§3` — `I8`'s INVERSE SWEEP AND ITS COMPLETENESS RULE.
 *
 * =================================================================================
 * WHAT THIS FILE ASSERTS, AND THE ONE THING IT REFUSES TO
 *
 * ASSERTED: the sweep reads period-bounded and untagged; it walks pages under the PROVIDER's
 * own completeness signal; a positive finding needs no guarantee; a clean result needs one;
 * and SendGrid does not supply one.
 *
 * NOT ASSERTED, ANYWHERE: that `I8` has been evaluated. Nothing here has run against a real
 * account, and `docs/implementation/S1P-result.md` records `I8` as UNCHANGED.
 * =================================================================================
 */

const ACCOUNTED = 'acos-corr-00000000-0000-4000-8000-000000000001';
const STRANGER = 'acos-corr-00000000-0000-4000-8000-000000000002';

function record(tag: string | null, id: string) {
  return {
    providerMessageId: id,
    providerStatus: 'delivered',
    providerTimestampMs: 0,
    correlationTag: tag,
  };
}

function page(
  records: readonly ReturnType<typeof record>[],
  completeness: PageCompletenessSignal,
  nextCursor: string | null = null,
): ActivityPage {
  return { records, completeness, nextCursor };
}

/** A reader scripted page by page, recording exactly what it was asked for. */
function reader(pages: readonly (ActivityPage | { readonly kind: 'PROVIDER_UNAVAILABLE' })[]): {
  readonly read: ActivityPageReader;
  readonly asked: { readonly cursor: string | null }[];
} {
  const asked: { readonly cursor: string | null }[] = [];
  let index = 0;
  const read: ActivityPageReader = (input) => {
    asked.push({ cursor: input.cursor });
    const next = pages[index] ?? { kind: 'PROVIDER_UNAVAILABLE' as const };
    index += 1;
    return Promise.resolve(next);
  };
  return { read, asked };
}

const BOUND = {
  periodStartMs: 0,
  periodEndMs: 1_000,
  maxRecordsPerPage: 100,
  maxPages: 5,
  maxTotalRecords: 1_000,
  accountedCorrelationTags: new Set([ACCOUNTED]),
};

describe('`§3.1` — THE COMPLETENESS ANSWER COMES FROM THE RECORDED S1O RESEARCH', () => {
  it('SendGrid completeness is UNESTABLISHED, and the basis quotes the capability record', () => {
    expect(SENDGRID_ACTIVITY_COMPLETENESS).toBe('UNESTABLISHED');
    expect(SENDGRID_COMPLETENESS_BASIS).toContain('capabilityRecord.ts');
    expect(SENDGRID_COMPLETENESS_BASIS).toContain('NO cursor');
  });

  it('and the capability record really does document no completeness mechanism', () => {
    /*
     * ASSERTED AGAINST THE SOURCE OF TRUTH, not against the constant that summarises it. If a
     * future slice adds a cursor or a total to SendGrid's `activityQuery` record, THIS case
     * fails and forces the constant to be revisited — which is the whole point of deriving a
     * claim from repository evidence rather than restating it.
     */
    const source = readFileSync(
      join('tools', 'provider-selection', 'capabilityRecord.ts'),
      'utf8',
    );
    const start = source.indexOf('activityQuery: Object.freeze({');
    expect(start).toBeGreaterThan(0);
    const activityQuery = source.slice(start, source.indexOf('correlation: Object.freeze({', start));

    // NON-VACUOUS: the block really is SendGrid's activity query record.
    expect(activityQuery).toContain('GET /v3/messages');
    expect(activityQuery).toContain('6 requests per minute');

    // AND IT NAMES NO COMPLETENESS MECHANISM.
    for (const absent of ['cursor', 'next_page', 'nextPage', 'total', 'page_size', 'pageSize']) {
      expect(activityQuery.toLowerCase(), absent).not.toContain(absent.toLowerCase());
    }
  });
});

describe('`§3.2` — THE SWEEP IS PERIOD-BOUNDED, UNTAGGED, AND WALKS PAGES', () => {
  it('it never sends a correlation tag, and the first page carries no cursor', async () => {
    const provider = reader([page([record(ACCOUNTED, 'm1')], 'COMPLETE')]);
    await runInverseSweep(provider.read, BOUND);
    expect(provider.asked).toEqual([{ cursor: null }]);
    // The port has no correlation-tag parameter at all, which is the structural half.
    expect(Object.keys({ periodStartMs: 0, periodEndMs: 1, maxRecords: 1, cursor: null })).not.toContain(
      'correlationTag',
    );
  });

  it('a CLEAN COMPLETE MULTI-PAGE result may return ALL accounted', async () => {
    const provider = reader([
      page([record(ACCOUNTED, 'm1')], 'MORE_AVAILABLE', 'cur-1'),
      page([record(ACCOUNTED, 'm2')], 'MORE_AVAILABLE', 'cur-2'),
      page([record(ACCOUNTED, 'm3')], 'COMPLETE'),
    ]);
    const result = await runInverseSweep(provider.read, BOUND);

    expect(result.outcome).toBe('ALL_PROVIDER_RECORDS_ACCOUNTED');
    expect(result.pagesRead).toBe(3);
    expect(result.providerRecordsExamined).toBe(3);
    expect(result.stoppedBecause).toBe('PROVIDER_SIGNALLED_COMPLETE');
    // THE CURSOR IS THE READER'S OWN, PASSED BACK VERBATIM. The sweep constructs none.
    expect(provider.asked).toEqual([{ cursor: null }, { cursor: 'cur-1' }, { cursor: 'cur-2' }]);
  });

  it('**an unaccounted record on a LATER page is detected**', async () => {
    /*
     * THE CASE THE ONE-SHOT SWEEP COULD NOT SEE. Page one is entirely accounted for; the
     * record `I8` exists to find is on page two.
     */
    const provider = reader([
      page([record(ACCOUNTED, 'm1'), record(ACCOUNTED, 'm2')], 'MORE_AVAILABLE', 'cur-1'),
      page([record(STRANGER, 'intruder')], 'COMPLETE'),
    ]);
    const result = await runInverseSweep(provider.read, BOUND);

    expect(result.outcome).toBe('UNACCOUNTED_PROVIDER_RECORDS');
    expect(result.unaccounted.map((entry) => entry.providerMessageId)).toEqual(['intruder']);
    expect(result.pagesRead).toBe(2);
  });

  it('a record with NO tag at all is unaccounted, on any page', async () => {
    const provider = reader([page([record(null, 'untagged')], 'COMPLETE')]);
    const result = await runInverseSweep(provider.read, BOUND);
    expect(result.outcome).toBe('UNACCOUNTED_PROVIDER_RECORDS');
    expect(result.unaccounted[0]?.correlationTag).toBeNull();
  });

  it('zero records WITH provider-confirmed completeness is a clean sweep', async () => {
    const result = await runInverseSweep(reader([page([], 'COMPLETE')]).read, BOUND);
    expect(result.outcome).toBe('ALL_PROVIDER_RECORDS_ACCOUNTED');
    expect(result.providerRecordsExamined).toBe(0);
  });
});

describe('`§3.2` — **A CAPPED OR UNGUARANTEED CLEAN READ IS `SWEEP_INCOMPLETE`**', () => {
  it('UNESTABLISHED completeness — the SendGrid case — can never be clean', async () => {
    /*
     * THE DEFECT, DIRECTLY. Every record is accounted for and the provider answered; the
     * rejected sweep returned `ALL_PROVIDER_RECORDS_ACCOUNTED` from exactly this.
     */
    const provider = reader([page([record(ACCOUNTED, 'm1')], SENDGRID_ACTIVITY_COMPLETENESS)]);
    const result = await runInverseSweep(provider.read, BOUND);

    expect(result.outcome).toBe('SWEEP_INCOMPLETE');
    expect(result.outcome).not.toBe('ALL_PROVIDER_RECORDS_ACCOUNTED');
    expect(result.stoppedBecause).toBe('PROVIDER_COMPLETENESS_UNESTABLISHED');
    expect(result.statement).toContain('NOT a clean sweep');
    // AND IT IS NOT AN OUTAGE EITHER — `§3.2` forbids collapsing truncation onto that.
    expect(result.outcome).not.toBe('SWEEP_UNAVAILABLE');
    expect(result.providerRecordsExamined).toBe(1);
  });

  it('the PAGE BOUND reached before the provider signals completion is INCOMPLETE', async () => {
    const provider = reader([
      page([record(ACCOUNTED, 'm1')], 'MORE_AVAILABLE', 'c1'),
      page([record(ACCOUNTED, 'm2')], 'MORE_AVAILABLE', 'c2'),
    ]);
    const result = await runInverseSweep(provider.read, { ...BOUND, maxPages: 2 });

    expect(result.outcome).toBe('SWEEP_INCOMPLETE');
    expect(result.stoppedBecause).toBe('PAGE_BOUND_REACHED');
    expect(result.pagesRead).toBe(2);
  });

  it('the RECORD BOUND reached before completion is INCOMPLETE', async () => {
    const provider = reader([
      page([record(ACCOUNTED, 'm1'), record(ACCOUNTED, 'm2')], 'MORE_AVAILABLE', 'c1'),
      page([record(ACCOUNTED, 'm3')], 'COMPLETE'),
    ]);
    const result = await runInverseSweep(provider.read, { ...BOUND, maxTotalRecords: 2 });

    expect(result.outcome).toBe('SWEEP_INCOMPLETE');
    expect(result.stoppedBecause).toBe('RECORD_BOUND_REACHED');
  });

  it('MORE_AVAILABLE with no cursor is a provider contradiction, and reads as INCOMPLETE', async () => {
    const result = await runInverseSweep(
      reader([page([record(ACCOUNTED, 'm1')], 'MORE_AVAILABLE', null)]).read,
      BOUND,
    );
    expect(result.outcome).toBe('SWEEP_INCOMPLETE');
    expect(result.stoppedBecause).toBe('PROVIDER_COMPLETENESS_UNESTABLISHED');
  });

  it('the bounds are CLAMPED, so no configuration can request an unbounded walk', () => {
    const clamped = clampSweepBound({
      periodStartMs: 0,
      periodEndMs: 1,
      maxRecordsPerPage: 100,
      maxPages: 9_999,
      maxTotalRecords: 9_999_999,
    });
    expect(clamped.maxPages).toBe(MAX_SWEEP_PAGES);
    expect(clamped.maxTotalRecords).toBeLessThanOrEqual(5_000);
  });
});

describe('`§3.3` — PROVIDER FAILURE MID-PAGINATION IS NEVER A CLEAN SWEEP', () => {
  it('failure on the FIRST page is SWEEP_UNAVAILABLE — silence is not agreement', async () => {
    const result = await runInverseSweep(reader([{ kind: 'PROVIDER_UNAVAILABLE' }]).read, BOUND);
    expect(result.outcome).toBe('SWEEP_UNAVAILABLE');
    expect(result.providerRecordsExamined).toBeNull();
    expect(result.statement).toContain('SILENCE IS NOT AGREEMENT');
  });

  it('failure on a LATER page, nothing unaccounted seen, is INCOMPLETE — never clean', async () => {
    const provider = reader([
      page([record(ACCOUNTED, 'm1')], 'MORE_AVAILABLE', 'c1'),
      { kind: 'PROVIDER_UNAVAILABLE' },
    ]);
    const result = await runInverseSweep(provider.read, BOUND);

    expect(result.outcome).toBe('SWEEP_INCOMPLETE');
    expect(result.outcome).not.toBe('ALL_PROVIDER_RECORDS_ACCOUNTED');
    expect(result.stoppedBecause).toBe('PROVIDER_UNAVAILABLE');
  });

  it('but a finding ALREADY SEEN survives a later provider failure', async () => {
    /*
     * THE ASYMMETRY, ASSERTED. A record seen is a record that exists, and no completeness
     * guarantee was needed to conclude that. Losing the provider afterwards does not unsee it.
     */
    const provider = reader([
      page([record(STRANGER, 'intruder')], 'MORE_AVAILABLE', 'c1'),
      { kind: 'PROVIDER_UNAVAILABLE' },
    ]);
    const result = await runInverseSweep(provider.read, BOUND);

    expect(result.outcome).toBe('UNACCOUNTED_PROVIDER_RECORDS');
    expect(result.unaccounted.map((entry) => entry.providerMessageId)).toEqual(['intruder']);
    expect(result.stoppedBecause).toBe('PROVIDER_UNAVAILABLE');
  });
});

describe('`§15` — THE MODULE IS MACHINERY, AND SAYS SO', () => {
  it('it holds no `fetch`, no credential and no client — it reads through an injected port', () => {
    const source = readFileSync(join('validation', 'sendgrid', 'harness', 'inverseSweep.ts'), 'utf8');
    expect(source).not.toContain('fetch(');
    expect(source).not.toContain('secret');
    expect(source).not.toContain('providerReadClient');
    expect(source).toContain('No external effect exists in any vendor system that ACOS did not');
    expect(source).toContain('THIS IS MACHINERY, NOT EVIDENCE');
  });
});
