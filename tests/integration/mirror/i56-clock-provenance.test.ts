import { createHash } from 'node:crypto';
import { money } from '../../../src/kernel/exposure/money.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { COMPANY_ID } from '../../support/fixture.js';
import { createMirrorHarness, type MirrorHarness } from '../../support/mirrorFixture.js';
import {
  SOURCE_RECORD_KINDS,
  STATUTES,
  createStatutoryClock,
  isClockBearing,
  retainSourceRecord,
} from '../../../src/kernel/clocks/statutoryClock.js';
import { classifyDispatchPrecedence } from '../../../src/kernel/mirror/dispatchPrecedence.js';

/**
 * `I56` — A MODEL CLASSIFICATION CAN ROUTE A CASE; IT CAN NEVER CREATE A CLOCK.
 *
 * =================================================================================
 * WHY THIS IS A SECURITY TEST AND NOT A COMPLIANCE ONE
 *
 * `30 §9.1`: "`§5.1`'s precedence row 3 privileges clock-bearing COMPENSABLE effects over
 * the mirror, so **the statutory clock is a lever on the audit plane** and its provenance is
 * a security property rather than a compliance detail. [...] Without this, a model that can
 * cause a clock to exist can manufacture the row-3 exemption it wants. With it, and with
 * `§5.6`'s inversion, **both ends of the lever are closed**."
 *
 * `36 §9` VC-A2: "`I56`: a clock cannot be created on an OBSERVATION- or CLAIM-grade fact."
 *
 * Registry `I56`'s own test statement: "**A triage worker classifying every case as a refund
 * request must create ZERO live clocks.** Assert each declared kind resolves and that an
 * unbacked clock cannot be inserted."
 * =================================================================================
 */

let h: MirrorHarness;

const T0 = new Date('2026-03-01T12:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;

beforeAll(async () => {
  h = await createMirrorHarness();
});

afterAll(async () => {
  await h.close();
});

beforeEach(async () => {
  await h.reset();
});

function digest(of: string): Buffer {
  return createHash('sha256').update(of).digest();
}

describe('EACH DECLARED KIND RESOLVES AND CAN START A CLOCK', () => {
  it('all four `I56` kinds, each backing a clock', async () => {
    // `I56`: "a RECORD-grade artifact of a declared kind — a processor dispute webhook, a
    // retained raw inbound message with its content hash, a carrier or regulator record, or a
    // signed owner action."
    expect([...SOURCE_RECORD_KINDS]).toEqual([
      'PROCESSOR_DISPUTE_WEBHOOK',
      'RETAINED_RAW_INBOUND_MESSAGE',
      'CARRIER_OR_REGULATOR_RECORD',
      'SIGNED_OWNER_ACTION',
    ]);

    for (const [index, kind] of SOURCE_RECORD_KINDS.entries()) {
      const recordId = `record:${kind}`;
      await retainSourceRecord(h.control, {
        companyId: COMPANY_ID,
        sourceRecordId: recordId,
        kind,
        contentHash: digest(recordId),
        externalRef: `external:${kind}`,
        receivedAt: T0,
      });
      await createStatutoryClock(h.control, {
        companyId: COMPANY_ID,
        clockId: `clock:${kind}`,
        statute: 'FTC_7_WORKING_DAYS',
        caseRef: `case:${String(index)}`,
        startedAt: T0,
        deadlineAt: new Date(T0.getTime() + 7 * DAY),
        sourceRecordId: recordId,
      });
      expect(await isClockBearing(h.control, COMPANY_ID, `case:${String(index)}`, T0)).toBe(true);
    }
  });

  it('and `24 §3` K10s statutes are the closed set', async () => {
    // "GDPR 72h / 1 month, CCPA 45d, FTC 30d and 7 working days".
    expect([...STATUTES]).toEqual([
      'GDPR_ART_33_72H',
      'GDPR_ART_12_3_ONE_MONTH',
      'CCPA_45D',
      'FTC_30D',
      'FTC_7_WORKING_DAYS',
    ]);
    const client = await h.control.connect();
    try {
      await expect(
        client.query(
          `INSERT INTO statutory_clock
             (company_id, clock_id, statute, case_ref, started_at, deadline_at,
              source_record_ref)
           VALUES ($1,'clock:invented','MY_OWN_STATUTE','case:x',$2,$3,$4)`,
          [COMPANY_ID, T0, new Date(T0.getTime() + DAY), h.seed.sourceRecordId],
        ),
      ).rejects.toThrow(/statutory_clock_statute_declared/);
    } finally {
      client.release();
    }
  });
});

describe('A CLOCK CANNOT BE CREATED WITHOUT A RESOLVING RECORD-GRADE CITATION', () => {
  it('an unresolvable `source_record_ref` is refused by the APPLICATION', async () => {
    await expect(
      createStatutoryClock(h.control, {
        companyId: COMPANY_ID,
        clockId: 'clock:unbacked',
        statute: 'FTC_7_WORKING_DAYS',
        caseRef: 'case:unbacked',
        startedAt: T0,
        deadlineAt: new Date(T0.getTime() + 7 * DAY),
        sourceRecordId: 'record:does-not-exist',
      }),
    ).rejects.toThrow(/I56_SOURCE_RECORD_DOES_NOT_RESOLVE/);
  });

  it('and by the DATABASE, on a direct INSERT — registry `I56`s declared enforcement', async () => {
    // Registry `I56` enforcement: "DB (not-null + FK to the retained artifact) + RUNTIME
    // (deterministic detector)". BOTH, and each is exercised on its own.
    const client = await h.control.connect();
    try {
      await expect(
        client.query(
          `INSERT INTO statutory_clock
             (company_id, clock_id, statute, case_ref, started_at, deadline_at,
              source_record_ref)
           VALUES ($1,'clock:sql','FTC_7_WORKING_DAYS','case:sql',$2,$3,'record:nope')`,
          [COMPANY_ID, T0, new Date(T0.getTime() + DAY)],
        ),
      ).rejects.toThrow(/statutory_clock_company_id_source_record_ref_fkey|foreign key/);

      // NOT NULL, so the citation cannot simply be omitted.
      await expect(
        client.query(
          `INSERT INTO statutory_clock
             (company_id, clock_id, statute, case_ref, started_at, deadline_at,
              source_record_ref)
           VALUES ($1,'clock:null','FTC_7_WORKING_DAYS','case:null',$2,$3,NULL)`,
          [COMPANY_ID, T0, new Date(T0.getTime() + DAY)],
        ),
      ).rejects.toThrow(/source_record_ref/);
    } finally {
      client.release();
    }
  });

  it('NO OBSERVATION, NO CLAIM and NO `DECISION_DELEGATED` fact is storable as a source', async () => {
    // `30 §9.1`: "**No OBSERVATION, no CLAIM, no `DECISION_DELEGATED` fact may start a
    // clock**, and no model-authored summary may."
    //
    // The structural form: `retained_source_record` admits `provenance = 'RECORD'` and
    // nothing else, so a lesser grade has no row shape to occupy rather than failing a check
    // somewhere downstream.
    const client = await h.control.connect();
    try {
      for (const grade of ['OBSERVATION', 'CLAIM', 'DECISION_DELEGATED', 'DECISION_OWNER']) {
        await expect(
          client.query(
            `INSERT INTO retained_source_record
               (company_id, source_record_id, kind, provenance, content_hash, external_ref,
                received_at)
             VALUES ($1,$2,'RETAINED_RAW_INBOUND_MESSAGE',$3,$4,'external',$5)`,
            [COMPANY_ID, `record:${grade}`, grade, digest(grade), T0],
          ),
        ).rejects.toThrow(/retained_source_record_is_record_grade/);
      }
    } finally {
      client.release();
    }
  });

  it('an UNDECLARED source kind is refused', async () => {
    const client = await h.control.connect();
    try {
      await expect(
        client.query(
          `INSERT INTO retained_source_record
             (company_id, source_record_id, kind, provenance, content_hash, external_ref,
              received_at)
           VALUES ($1,'record:model-summary','MODEL_AUTHORED_SUMMARY','RECORD',$2,'x',$3)`,
          [COMPANY_ID, digest('summary'), T0],
        ),
      ).rejects.toThrow(/retained_source_record_kind_declared/);
    } finally {
      client.release();
    }
  });

  it('a retained record is IMMUTABLE — the citation cannot be repointed after the fact', async () => {
    // `I26`: "every RECORD-grade fact resolves to a retained vendor response with a matching
    // content hash". A mutable retained record would make the hash a formality.
    const client = await h.control.connect();
    try {
      await expect(
        client.query(
          `UPDATE retained_source_record SET content_hash = $2 WHERE company_id = $1`,
          [COMPANY_ID, digest('rewritten')],
        ),
      ).rejects.toThrow(/APPEND_ONLY_TABLE_retained_source_record/);
      await expect(
        client.query('DELETE FROM retained_source_record WHERE company_id = $1', [COMPANY_ID]),
      ).rejects.toThrow(/APPEND_ONLY_TABLE_retained_source_record/);
    } finally {
      client.release();
    }
  });

  it('and the content hash must be a real 32-byte digest', async () => {
    const client = await h.control.connect();
    try {
      await expect(
        client.query(
          `INSERT INTO retained_source_record
             (company_id, source_record_id, kind, provenance, content_hash, external_ref,
              received_at)
           VALUES ($1,'record:short','SIGNED_OWNER_ACTION','RECORD',$2,'x',$3)`,
          [COMPANY_ID, Buffer.alloc(4), T0],
        ),
      ).rejects.toThrow(/retained_source_record_hash_length/);
    } finally {
      client.release();
    }
  });
});

describe('THE NEGATIVE CONTROL — A TRIAGE WORKER THAT CLASSIFIES EVERYTHING AS A CLOCK', () => {
  it('creates ZERO live clocks', async () => {
    // Registry `I56`'s own test: "A triage worker classifying every case as a refund request
    // must create **zero** live clocks."
    //
    // THE POINT IS THAT CLASSIFICATION IS NOT AN ARGUMENT. `createStatutoryClock` takes a
    // `sourceRecordId` and nothing that could stand in for one — no `reason`, no
    // `classification`, no `confidence`, no `statuteGuess`. So the worker below can produce
    // whatever it likes and there is no call it can make.
    interface TriageOutput {
      readonly caseRef: string;
      readonly classification: 'REFUND_REQUEST_WITH_FTC_CLOCK';
      readonly confidence: number;
      readonly rationale: string;
      readonly urgency: 'URGENT';
      readonly hasClock: true;
      readonly statute: 'FTC_7_WORKING_DAYS';
      readonly deadline: string;
    }

    const triaged: TriageOutput[] = Array.from({ length: 50 }, (_, i) => ({
      caseRef: `case:model-${String(i)}`,
      classification: 'REFUND_REQUEST_WITH_FTC_CLOCK',
      confidence: 0.99,
      rationale: 'the customer sounds upset and mentioned a chargeback and the FTC',
      urgency: 'URGENT',
      hasClock: true,
      statute: 'FTC_7_WORKING_DAYS',
      deadline: new Date(T0.getTime() + 7 * DAY).toISOString(),
    }));

    // The worker's output is DATA. There is no path from it to a clock: every field above is
    // either absent from `ClockCreation` or is a value the record must independently supply.
    for (const item of triaged) {
      await expect(
        createStatutoryClock(h.control, {
          companyId: COMPANY_ID,
          clockId: `clock:${item.caseRef}`,
          statute: item.statute,
          caseRef: item.caseRef,
          startedAt: T0,
          deadlineAt: new Date(item.deadline),
          // The ONLY provenance argument, and the model has no retained artifact to name.
          // Inventing an id is what it CAN do, and it resolves to nothing.
          sourceRecordId: `record:invented-by-model-${item.caseRef}`,
        }),
      ).rejects.toThrow(/I56_SOURCE_RECORD_DOES_NOT_RESOLVE/);
    }

    const client = await h.control.connect();
    try {
      const clocks = await client.query<{ n: string }>(
        `SELECT count(*)::TEXT AS n FROM statutory_clock WHERE company_id = $1`,
        [COMPANY_ID],
      );
      expect(clocks.rows[0]!.n).toBe('0');
    } finally {
      client.release();
    }

    // AND NOTHING IS CLOCK-BEARING, so precedence row 3 is unreachable for every case the
    // model classified — which is `30 §9.1`'s "the clock cannot be fabricated".
    for (const item of triaged.slice(0, 5)) {
      expect(await isClockBearing(h.control, COMPANY_ID, item.caseRef, T0)).toBe(false);
    }
  });

  it('and the row-3 relaxation is therefore unreachable for a model-classified case', async () => {
    const clockBearing = await isClockBearing(h.control, COMPANY_ID, 'case:model-0', T0);
    expect(clockBearing).toBe(false);
    const decision = classifyDispatchPrecedence({
      mirrorState: 'UNCORROBORATED_STALL',
      actionClass: 'refund.create',
      recoverability: 'COMPENSABLE',
      clockBearing,
      // v1.3.3: below `51 §3.7`'s `$20.00` floor, so row 2 cannot intercept and the case
      // still falls to row 4 — which is what this assertion is about.
      totalExposure: money('19.99'),
      hasRecordedApproval: true,
      activeOverride: null,
      unreachableSince: new Date(T0.getTime() - 60_000),
      now: T0,
    });
    // Row 4, not row 3 — the discretionary COMPENSABLE row, which suspends in every state.
    expect(decision.matchedRow).toBe(4);
    expect(decision.disposition).toBe('SUSPEND');
  });
});

describe('LIVENESS — a clock past its deadline or closed is NOT clock-bearing', () => {
  beforeEach(async () => {
    await createStatutoryClock(h.control, {
      companyId: COMPANY_ID,
      clockId: 'clock:live',
      statute: 'FTC_7_WORKING_DAYS',
      caseRef: 'case:live',
      startedAt: T0,
      deadlineAt: new Date(T0.getTime() + 7 * DAY),
      sourceRecordId: h.seed.sourceRecordId,
    });
  });

  it('inside the deadline it IS clock-bearing', async () => {
    expect(await isClockBearing(h.control, COMPANY_ID, 'case:live', T0)).toBe(true);
    expect(
      await isClockBearing(h.control, COMPANY_ID, 'case:live', new Date(T0.getTime() + 7 * DAY - 1)),
    ).toBe(true);
  });

  it('AT and PAST the deadline it is NOT', async () => {
    // `30 §5.1` row 3 reads "a **live** statutory clock". A deadline that has passed is a
    // breach, not a reason to relax the mirror — and treating it as live would let an expired
    // obligation buy an indefinite relaxation.
    expect(
      await isClockBearing(h.control, COMPANY_ID, 'case:live', new Date(T0.getTime() + 7 * DAY)),
    ).toBe(false);
    expect(
      await isClockBearing(h.control, COMPANY_ID, 'case:live', new Date(T0.getTime() + 8 * DAY)),
    ).toBe(false);
  });

  it('a CLOSED clock is not clock-bearing', async () => {
    const client = await h.control.connect();
    try {
      await client.query(
        `UPDATE statutory_clock SET closed_at = $2 WHERE company_id = $1 AND clock_id = 'clock:live'`,
        [COMPANY_ID, T0],
      );
    } finally {
      client.release();
    }
    expect(await isClockBearing(h.control, COMPANY_ID, 'case:live', T0)).toBe(false);
  });

  it('a clock whose deadline precedes its start cannot exist', async () => {
    const client = await h.control.connect();
    try {
      await expect(
        client.query(
          `INSERT INTO statutory_clock
             (company_id, clock_id, statute, case_ref, started_at, deadline_at,
              source_record_ref)
           VALUES ($1,'clock:backwards','FTC_30D','case:backwards',$2,$3,$4)`,
          [COMPANY_ID, T0, new Date(T0.getTime() - 1), h.seed.sourceRecordId],
        ),
      ).rejects.toThrow(/statutory_clock_deadline_after_start/);
    } finally {
      client.release();
    }
  });
});

describe('WHAT IS DEFERRED, AND THE CITATION FOR IT — TA-08', () => {
  it('TWO live clocks on one `(case_ref, statute)` are currently ADMITTED, by design', async () => {
    // `phase2-v1.3-lower-severity-register.md` TA-08 schedules "at most one live clock per
    // `(case_ref, statute)`", the duplicate-content collapse rule and the per-window anomaly
    // bound as **LATER MVP SLICE (S5)**, and says in the same row: "`I56`'s schema leg is S1
    // and is unaffected; the bound is about live clocks, which land at S5."
    //
    // `§42` of the S1H mandate forbids inventing a rule the architecture defers. This test
    // therefore asserts the CURRENT behaviour and names the deferral, so the residual is
    // recorded in the suite rather than only in a document. `S1H-result.md §9` reports it.
    for (const id of ['clock:dup-a', 'clock:dup-b']) {
      await createStatutoryClock(h.control, {
        companyId: COMPANY_ID,
        clockId: id,
        statute: 'FTC_7_WORKING_DAYS',
        caseRef: 'case:duplicated',
        startedAt: T0,
        deadlineAt: new Date(T0.getTime() + 7 * DAY),
        sourceRecordId: h.seed.sourceRecordId,
      });
    }
    const client = await h.control.connect();
    try {
      const rows = await client.query<{ n: string }>(
        `SELECT count(*)::TEXT AS n FROM statutory_clock
          WHERE company_id = $1 AND case_ref = 'case:duplicated' AND closed_at IS NULL`,
        [COMPANY_ID],
      );
      // TWO. The uniqueness rule is S5's, not S1's, and pretending otherwise would be a
      // claim the architecture does not make.
      expect(rows.rows[0]!.n).toBe('2');
    } finally {
      client.release();
    }

    // WHAT IS BOUNDED EVEN SO: both clocks cite the SAME retained RECORD, and neither could
    // exist without one. TA-08's own words: "Loss is bounded by `I3` throughout
    // (`W_DAY_REFUND` $50.00 / 2), so this is an auditability finding of AUD-06's class, not
    // a money finding."
    const client2 = await h.control.connect();
    try {
      const cited = await client2.query<{ source_record_ref: string }>(
        `SELECT DISTINCT source_record_ref FROM statutory_clock
          WHERE company_id = $1 AND case_ref = 'case:duplicated'`,
        [COMPANY_ID],
      );
      expect(cited.rows).toHaveLength(1);
      expect(cited.rows[0]!.source_record_ref).toBe(h.seed.sourceRecordId);
    } finally {
      client2.release();
    }
  });
});
