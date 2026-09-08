import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { COMPANY_ID } from '../../support/fixture.js';
import {
  REFUND_TASK_ID,
  S1I_NOW,
  authorisePause,
  authoriseRefund,
  bindTaskToCase,
  claimJournalRows,
  createOutboxHarness,
  openLiveClock,
  type OutboxHarness,
} from '../../support/outboxFixture.js';
import { auditRows } from '../../support/replicationFixture.js';
import {
  frameField,
  oracleCanonicalBytes,
  outboxClaimedFields,
  type OutboxClaimedRow,
} from '../../support/jcs1Oracle.js';
import { enqueueDispatch } from '../../../src/kernel/outbox/enqueue.js';
import { claimForExternalDispatch } from '../../../src/kernel/outbox/claim.js';

/**
 * `S1I-C4` RESOLVED, AND MADE NORMATIVE — THE DECLARED CLAIM-ROW FIELD ORDER.
 * v1.3.4 (JCS-02), `30 §5.3a`.
 *
 * =================================================================================
 * WHAT CHANGED, AND WHY IT IS NOT COSMETIC.
 *
 * `30 §5.3` has always required a hashed row's column order to be *"Fixed, declared per
 * row kind, **in the specification**"*. **The specification declared an order for no row
 * kind at all** — every order in service was a convention agreed between two independently
 * written triggers, with no artifact either could be judged against. `S1I-C4` recorded that
 * for `acos.journal.outbox_claimed.v1` and resolved it as an implementation declaration in
 * `S1I-contract.md §5`, following S1H's precedent.
 *
 * `30 §5.3a` is now that specification. Both planes transcribe **it**, and
 * `tests/support/jcs1Oracle.ts` is a hand-authored third reading of the same table.
 *
 * BECAUSE `ACOS-JCS-1` FRAMES A ROW AS A CONCATENATION OF LENGTH-PREFIXED FIELDS, THE
 * ORDER IS PART OF THE HASH. Two conforming implementations that disagree on it produce a
 * permanent silent chain divergence — the exact hazard `§5.3` exists to close.
 * =================================================================================
 *
 * =================================================================================
 * `§16` OF THE OWNER-RESOLUTION MANDATE:
 *
 *   "control and audit implementations use the same declared semantic order
 *    independently; third oracle uses the specification; **no shared canonicalisation
 *    helper defeats independence; field order cannot depend on object/Map insertion
 *    order.** Add a seeded negative architecture control that swaps two claim-row fields
 *    and causes the consistency/VC-A3-style check to fail."
 *
 * **THE SEEDED SWAP IS THE POINT OF THIS SUITE.** `outbox-journal-rows.test.ts` already
 * asserts that the three readings agree. Agreement is necessary and not sufficient: a
 * membership check — "every declared field is present" — passes a transposition. So the
 * control here TRANSPOSES two adjacent fields of the oracle's own order, leaving every
 * field present and the row well-formed, and requires the bytes to diverge.
 * =================================================================================
 */

let h: OutboxHarness;
const NOW = S1I_NOW;
const DAY = 24 * 60 * 60 * 1000;
const CASE = 'case:CS-ORDER';

beforeAll(async () => {
  h = await createOutboxHarness();
});

afterAll(async () => {
  await h.close();
});

beforeEach(async () => {
  await h.reset();
});

/**
 * `30 §5.3a`'s twenty field names, IN ORDER, TRANSCRIBED BY HAND INTO THIS FILE.
 *
 * A SECOND transcription, deliberately: `jcs1Oracle.ts` holds the third reading of the
 * VALUES and this holds a reading of the ORDER, so the numbering and the sequence can be
 * asserted without either being derived from the other. Neither is read from `src/`.
 */
const DECLARED_ORDER: readonly string[] = [
  'acos.journal.outbox_claimed.v1',
  'company_id',
  'journal_seq',
  'OUTBOX_CLAIMED',
  'outbox_id',
  'outbox_claim_id',
  'outbox_correlation_tag',
  'effect_id',
  'authorisation_id',
  'idempotency_key',
  'action_class',
  'resource_ref',
  'dispatch_payload_hash',
  'outbox_matched_row',
  'outbox_mirror_state',
  'outbox_requires_unmirrored_tag',
  'override_id',
  'outbox_claim_clock_ref',
  'occurred_at',
  'prev_hash',
];

/** Read the control trigger's own bytes. */
async function controlBytes(journalSeq: bigint): Promise<Buffer> {
  const client = await h.control.connect();
  try {
    const result = await client.query<{ bytes: Buffer }>(
      `SELECT effect_journal_canonical_bytes(j.*) AS bytes
         FROM effect_journal j
        WHERE j.company_id = $1 AND j.journal_seq = $2`,
      [COMPANY_ID, journalSeq.toString()],
    );
    return result.rows[0]!.bytes;
  } finally {
    client.release();
  }
}

/** Read the AUDIT trigger's own bytes, on the other server. */
async function auditBytes(journalSeq: bigint): Promise<Buffer> {
  const client = await h.auditEvaluator.connect();
  try {
    const result = await client.query<{ bytes: Buffer }>(
      `SELECT audit_journal_canonical_bytes(j.*) AS bytes
         FROM audit_journal j
        WHERE j.company_id = $1 AND j.journal_seq = $2`,
      [COMPANY_ID, journalSeq.toString()],
    );
    return result.rows[0]!.bytes;
  } finally {
    client.release();
  }
}

/** A row-3 claim, so field 18 is NON-NULL and the swap has real bytes to move. */
async function clockBearingClaim(): Promise<OutboxClaimedRow> {
  await bindTaskToCase(h.control, REFUND_TASK_ID, CASE);
  await openLiveClock(h.control, {
    caseRef: CASE,
    clockId: 'clock:order',
    deadlineAt: new Date(NOW.getTime() + 5 * DAY),
  });
  const effect = await authoriseRefund(h);
  expect(
    (
      await enqueueDispatch(h.control, {
        companyId: COMPANY_ID,
        effectId: effect.effectId,
        outboxId: 'outbox:order',
        payloadCanonicalBytes: effect.payloadCanonicalBytes,
        now: NOW,
      })
    ).kind,
  ).toBe('ENQUEUED');
  const claim = await claimForExternalDispatch(h.control, {
    companyId: COMPANY_ID,
    idempotencyKey: effect.idempotencyKey,
    claimedBy: 'worker:order',
    now: NOW,
  });
  expect(claim.kind).toBe('CLAIMED');
  if (claim.kind === 'CLAIMED') expect(claim.claim.matchedRow).toBe(3);

  const entry = (await claimJournalRows(h.control))[0]!;
  expect(entry.matchedRow).toBe(3);
  expect(entry.claimClockRef).toBe('clock:order');
  return {
    companyId: COMPANY_ID,
    journalSeq: entry.journalSeq,
    outboxId: entry.outboxId,
    claimId: entry.claimId,
    correlationTag: entry.correlationTag,
    effectId: entry.effectId,
    authorisationId: entry.authorisationId,
    idempotencyKey: entry.idempotencyKey,
    actionClass: entry.actionClass,
    resourceRef: entry.resourceRef,
    dispatchPayloadHash: entry.dispatchPayloadHash,
    matchedRow: entry.matchedRow,
    mirrorState: entry.mirrorState,
    requiresUnmirroredTag: entry.requiresUnmirroredTag,
    overrideId: entry.overrideId,
    claimClockRef: entry.claimClockRef,
    occurredAt: entry.occurredAt,
    prevHash: entry.prevHash,
  };
}

describe('`30 §5.3a` — THE DECLARED ORDER IS TWENTY FIELDS, AND FIELD 18 IS THE CLOCK', () => {
  it('the oracle emits exactly twenty fields, in the declared sequence', async () => {
    const row = await clockBearingClaim();
    const fields = outboxClaimedFields(row);
    expect(fields).toHaveLength(DECLARED_ORDER.length);
    expect(fields).toHaveLength(20);

    // Field 18 is the clock, between `override_id` (17) and `occurred_at` (19). Positional,
    // because that is what the specification declares and what the hash depends on.
    expect(DECLARED_ORDER[17]).toBe('outbox_claim_clock_ref');
    expect(fields[17]).toEqual({ kind: 'text', value: 'clock:order' });
    expect(fields[16]).toEqual({ kind: 'text', value: null });
    expect(fields[18]!.kind).toBe('ts');
  });

  it('all three readings agree on a row-3 claim carrying a NON-NULL clock', async () => {
    /*
     * The control trigger (`0011`), the audit trigger (`A0006`) and the hand-authored
     * oracle. `36 §0`: neither plane is compared to the other — BOTH are compared to the
     * oracle.
     */
    const row = await clockBearingClaim();
    const expected = oracleCanonicalBytes(outboxClaimedFields(row));

    expect((await controlBytes(row.journalSeq)).equals(expected)).toBe(true);

    // The row has to reach the audit store for the second reading to exist at all.
    const run = await h.replication.pusher().pushPending(COMPANY_ID, 100);
    for (const pushed of run.pushed) expect(pushed.outcome).toBe('ACCEPTED');
    const mirrored = await auditRows(h.replication);
    expect(mirrored.some((r) => r.journal_row_kind === 'OUTBOX_CLAIMED')).toBe(true);
    expect((await auditBytes(row.journalSeq)).equals(expected)).toBe(true);
  });

  it('and on a claim whose clock is ABSENT — two adjacent NULLs, framed and not padded', async () => {
    /*
     * A row-5 `campaign.pause` claim carries NULL at BOTH field 17 (`override_id`) and
     * field 18 (`outbox_claim_clock_ref`).
     *
     * `30 §5.3a`: "the two adjacent NULLs are eight bytes of reserved word and no payload —
     * which is exactly the case a sentinel-byte encoding would have collapsed." v1.3.2's
     * withdrawn one-byte `0x00` sentinel would have written ten bytes here and made this
     * row collide with one carrying two one-byte values.
     */
    const effect = await authorisePause(h, { resourceId: 'CMP-ORDER-NULL' });
    await enqueueDispatch(h.control, {
      companyId: COMPANY_ID,
      effectId: effect.effectId,
      outboxId: 'outbox:order-null',
      payloadCanonicalBytes: effect.payloadCanonicalBytes,
      now: NOW,
    });
    const claim = await claimForExternalDispatch(h.control, {
      companyId: COMPANY_ID,
      idempotencyKey: effect.idempotencyKey,
      claimedBy: 'worker:order-null',
      now: NOW,
    });
    expect(claim.kind).toBe('CLAIMED');

    const entry = (await claimJournalRows(h.control))[0]!;
    expect(entry.matchedRow).toBe(5);
    expect(entry.overrideId).toBeNull();
    expect(entry.claimClockRef).toBeNull();

    const fields = outboxClaimedFields({
      companyId: COMPANY_ID,
      journalSeq: entry.journalSeq,
      outboxId: entry.outboxId,
      claimId: entry.claimId,
      correlationTag: entry.correlationTag,
      effectId: entry.effectId,
      authorisationId: entry.authorisationId,
      idempotencyKey: entry.idempotencyKey,
      actionClass: entry.actionClass,
      resourceRef: entry.resourceRef,
      dispatchPayloadHash: entry.dispatchPayloadHash,
      matchedRow: entry.matchedRow,
      mirrorState: entry.mirrorState,
      requiresUnmirroredTag: entry.requiresUnmirroredTag,
      overrideId: entry.overrideId,
      claimClockRef: entry.claimClockRef,
      occurredAt: entry.occurredAt,
      prevHash: entry.prevHash,
    });
    const expected = oracleCanonicalBytes(fields);
    expect((await controlBytes(entry.journalSeq)).equals(expected)).toBe(true);

    // EIGHT BYTES of reserved word, adjacent, and nothing between them.
    // `frameField(null)` IS the reserved word — the oracle's own encoder, not a literal.
    const twoNulls = Buffer.concat([frameField(null), frameField(null)]);
    expect(twoNulls).toHaveLength(8);
    expect(expected.includes(twoNulls)).toBe(true);
  });
});

describe('`§16` — THE SEEDED SWAP, AND WHY A MEMBERSHIP CHECK WOULD NOT CATCH IT', () => {
  /**
   * THE SEEDED CONTROL. It transposes two ADJACENT fields of the declared order and
   * changes nothing else.
   *
   * ADJACENT AND SAME-TYPED ON PURPOSE. `effect_id` (8) and `authorisation_id` (9) are both
   * `text` and both non-null, so the swap does not change the field count, the type
   * sequence, the total byte length or any framing word. **Only the CONTENT ORDER moves**,
   * which is precisely the divergence class `30 §5.3` was written to prevent and precisely
   * what a "every declared field is present" check cannot see.
   */
  function swappedFields(row: OutboxClaimedRow): ReturnType<typeof outboxClaimedFields> {
    const fields = [...outboxClaimedFields(row)];
    const eight = fields[7]!;
    const nine = fields[8]!;
    fields[7] = nine;
    fields[8] = eight;
    return fields;
  }

  it('a transposition of fields 8 and 9 produces DIFFERENT BYTES, at the SAME LENGTH', async () => {
    const row = await clockBearingClaim();
    const declared = oracleCanonicalBytes(outboxClaimedFields(row));
    const swapped = oracleCanonicalBytes(swappedFields(row));

    // Same length, same field count, same types — and DIFFERENT BYTES.
    expect(swapped).toHaveLength(declared.length);
    expect(swapped.equals(declared)).toBe(false);

    // A MEMBERSHIP CHECK WOULD PASS. Stated as an assertion so the reason this suite is
    // positional rather than set-based is itself proved, not just claimed.
    const key = (f: { kind: string; value: unknown }): string =>
      `${f.kind}:${
        typeof f.value === 'bigint'
          ? f.value.toString()
          : Buffer.isBuffer(f.value)
            ? f.value.toString('hex')
            : f.value instanceof Date
              ? f.value.toISOString()
              : String(f.value)
      }`;
    const declaredSet = new Set(outboxClaimedFields(row).map(key));
    const swappedSet = new Set(swappedFields(row).map(key));
    expect(swappedSet).toEqual(declaredSet);
  });

  it('and BOTH production planes reject the swapped bytes — the VC-A3-style check fails', async () => {
    /*
     * The discrimination `§16` requires: the seeded order must FAIL against each
     * independently-written implementation, not merely differ from the oracle.
     */
    const row = await clockBearingClaim();
    const swapped = oracleCanonicalBytes(swappedFields(row));

    expect((await controlBytes(row.journalSeq)).equals(swapped)).toBe(false);

    const run = await h.replication.pusher().pushPending(COMPANY_ID, 100);
    for (const pushed of run.pushed) expect(pushed.outcome).toBe('ACCEPTED');
    expect((await auditBytes(row.journalSeq)).equals(swapped)).toBe(false);

    // And the two planes still agree with EACH OTHER through the oracle, so the failure
    // above is the seed and not a pre-existing divergence.
    const declared = oracleCanonicalBytes(outboxClaimedFields(row));
    expect((await controlBytes(row.journalSeq)).equals(declared)).toBe(true);
    expect((await auditBytes(row.journalSeq)).equals(declared)).toBe(true);
  });

  it('a swap of the two NULLABLE fields also diverges, so the seed is not a type artefact', async () => {
    /*
     * Fields 17 and 18 are both nullable text. On a row-3 claim one is NULL and the other
     * is not, so transposing them moves a reserved word past a payload — a different shape
     * of the same defect, and one that a length-only check would also miss.
     */
    const row = await clockBearingClaim();
    const fields = [...outboxClaimedFields(row)];
    const seventeen = fields[16]!;
    const eighteen = fields[17]!;
    fields[16] = eighteen;
    fields[17] = seventeen;

    const declared = oracleCanonicalBytes(outboxClaimedFields(row));
    const swapped = oracleCanonicalBytes(fields);
    expect(swapped).toHaveLength(declared.length);
    expect(swapped.equals(declared)).toBe(false);
    expect((await controlBytes(row.journalSeq)).equals(swapped)).toBe(false);
  });
});

describe('`§16` — INDEPENDENCE, AND NO INSERTION ORDER', () => {
  it('neither migration reads the other, and neither reads a shared canonicalisation helper', async () => {
    /*
     * `30 §5.3a`: "Neither may read the other, and **neither may read a shared
     * canonicalisation helper that would make agreement automatic** — agreement two
     * implementations obtain from one source is not a cross-implementation check."
     *
     * Asserted over the migration SOURCE, because the property is about how the two files
     * were written and not about what they compute.
     */
    const { readFileSync } = await import('node:fs');
    const control = readFileSync('src/db/migrations/0011__effect_case_binding.sql', 'utf8');
    const audit = readFileSync(
      'src/audit/db/migrations/A0006__claim_clock_evidence.sql',
      'utf8',
    );

    // The control plane's helpers are `acos_jcs1_*`; the audit plane's are `audit_jcs1_*`.
    // Neither names the other's, so there is no shared helper to agree through.
    expect(control).toContain('acos_jcs1_field');
    expect(control).not.toContain('audit_jcs1_field');
    expect(audit).toContain('audit_jcs1_field');
    expect(audit).not.toContain('acos_jcs1_field');

    // And neither file executes the other: no cross-plane function call, no import, no
    // dblink, no foreign table.
    for (const [name, source] of [
      ['0011', control],
      ['A0006', audit],
    ] as const) {
      for (const forbidden of ['dblink', 'postgres_fdw', 'CREATE SERVER', 'IMPORT FOREIGN']) {
        expect(source, `${name} must not reach the other plane via ${forbidden}`).not.toContain(
          forbidden,
        );
      }
    }
  });

  it('the order does not depend on insertion order: it is positional in every reading', async () => {
    /*
     * `30 §5.3a`: "The order may not depend on an object's or a map's insertion order in
     * any implementation."
     *
     * BOTH TRIGGERS ARE POSITIONAL CONCATENATIONS written field by field, and the ORACLE
     * returns an ARRAY. So the assertion is that the oracle's output is index-addressed and
     * that reordering the ROW OBJECT's keys — the one place a map could leak in — changes
     * nothing.
     */
    const row = await clockBearingClaim();
    const declared = oracleCanonicalBytes(outboxClaimedFields(row));

    // The same values, with the object's keys in a deliberately different insertion order.
    const reordered: OutboxClaimedRow = {
      prevHash: row.prevHash,
      occurredAt: row.occurredAt,
      claimClockRef: row.claimClockRef,
      overrideId: row.overrideId,
      requiresUnmirroredTag: row.requiresUnmirroredTag,
      mirrorState: row.mirrorState,
      matchedRow: row.matchedRow,
      dispatchPayloadHash: row.dispatchPayloadHash,
      resourceRef: row.resourceRef,
      actionClass: row.actionClass,
      idempotencyKey: row.idempotencyKey,
      authorisationId: row.authorisationId,
      effectId: row.effectId,
      correlationTag: row.correlationTag,
      claimId: row.claimId,
      outboxId: row.outboxId,
      journalSeq: row.journalSeq,
      companyId: row.companyId,
    };
    expect(Object.keys(reordered)).not.toEqual(Object.keys(row));
    expect(oracleCanonicalBytes(outboxClaimedFields(reordered)).equals(declared)).toBe(true);

    // And the control trigger, which reads a composite row rather than an object, agrees.
    expect((await controlBytes(row.journalSeq)).equals(declared)).toBe(true);
  });
});
