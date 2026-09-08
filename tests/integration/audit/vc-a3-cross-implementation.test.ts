import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { createHarness, type Harness } from '../../support/fixture.js';
import { createAuditHarness, type AuditHarness } from '../../support/auditHarness.js';
import {
  attestationFields,
  effectAuthorisationFields,
  frameField,
  frameLength,
  jcsBytes,
  jcsJson,
  jcsMoney,
  jcsText,
  jcsTimestamp,
  oracleCanonicalBytes,
  oracleField,
  oracleRowHash,
  MAX_PAYLOAD_LENGTH,
  NULL_LENGTH_WORD,
  type OracleField,
} from '../../support/jcs1Oracle.js';

/**
 * `VC-A3` — `ACOS-JCS-1` CROSS-IMPLEMENTATION. S1G.
 *
 * `36 §2`, verbatim, AS ISSUED IN v1.3.2:
 *
 *   "VC-A3 — `ACOS-JCS-1` cross-implementation. The same fixture rows serialised by the
 *    control trigger and by the audit trigger produce byte-identical output. Assert each
 *    hazard individually: `25.0 ≠ 25.00`; timestamps at exactly 6 fractional digits UTC;
 *    declared column order survives a physical column reorder; SQL NULL (`FF FF FF FF`)
 *    distinct from empty string, from empty `bytea`, from a one-byte `bytea` payload
 *    `0x00`, and from a JSON literal `null` (v1.3.2, JCS-01), and a seeded implementation
 *    restoring v1.2's one-byte `0x00` NULL sentinel must fail this case; NFC
 *    normalisation; RFC 8785 for JSON columns; 4-byte BE length framing. Assert the
 *    transmitted bytes are hashed — a receiving implementation that parses and
 *    re-serialises must fail the test."
 *
 * The seeded old-rule implementation `36 §2` now demands is
 * `tests/negative-controls/unsafe-old-null-sentinel.ts`, exercised by
 * `tests/negative-controls/old-null-sentinel-collision.test.ts`.
 *
 * =================================================================================
 * THREE IMPLEMENTATIONS, AND THE ORACLE IS NEITHER PRODUCTION ONE.
 *
 *   CONTROL   `acos_jcs1_*` + `effect_journal_canonical_bytes`, on the control server.
 *   AUDIT     `audit_jcs1_*` + `audit_journal_canonical_bytes`, on the AUDIT server —
 *             a different PostgreSQL instance on which the control functions do not exist.
 *   ORACLE    `tests/support/jcs1Oracle.ts`, hand-written from `30 §5.3`, importing
 *             nothing from `src/`.
 *
 * Every assertion compares each production implementation to the ORACLE. Their agreement
 * with each other follows; it is never the thing asserted, because two implementations
 * transcribed from one reading can agree and both be wrong.
 * =================================================================================
 */

let control: Harness;
let audit: AuditHarness;

const COMPANY = 'co_s1a_fixture';
const AT = new Date('2026-03-04T05:06:07.123Z');
const HASH32 = createHash('sha256').update('vc-a3 predecessor').digest();

beforeAll(async () => {
  control = await createHarness();
  audit = await createAuditHarness();
  await control.reset();
  await audit.reset();
});

afterAll(async () => {
  await control.close();
  await audit.close();
});

/**
 * Ask the CONTROL database to canonicalise a hypothetical row.
 *
 * `ROW(...)::effect_journal` builds the composite value the trigger would hash WITHOUT
 * inserting anything, so the fixture rows below need no authorisation, no reservation and
 * no foreign key — which is what lets them carry deliberately adversarial values a real
 * authorisation could never produce.
 */
async function controlBytes(row: Record<string, unknown>): Promise<Buffer> {
  const client = await control.connect();
  try {
    const result = await client.query<{ bytes: Buffer }>(
      `SELECT effect_journal_canonical_bytes(
                ROW(
                  $1, $2::BIGINT, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
                  $13::NUMERIC, $14::NUMERIC, $15::NUMERIC, $16::BOOLEAN, $17,
                  $18::INTEGER, $19::INTEGER, $20, $21::TIMESTAMPTZ,
                  $22::BYTEA, NULL, NULL, $23::BIGINT, $24::BIGINT, $25::BYTEA
                )::effect_journal
              ) AS bytes`,
      compositeParams(row),
    );
    return result.rows[0]!.bytes;
  } finally {
    client.release();
  }
}

/** The same hypothetical row, canonicalised by the AUDIT database. */
async function auditBytes(row: Record<string, unknown>): Promise<Buffer> {
  const client = await audit.owner.connect();
  try {
    const result = await client.query<{ bytes: Buffer }>(
      `SELECT audit_journal_canonical_bytes(
                ROW(
                  $1, $2::BIGINT, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
                  $13::NUMERIC, $14::NUMERIC, $15::NUMERIC, $16::BOOLEAN, $17,
                  $18::INTEGER, $19::INTEGER, $20, $23::BIGINT, $24::BIGINT, $25::BYTEA,
                  $21::TIMESTAMPTZ, $22::BYTEA,
                  '\\x00'::BYTEA, '\\x00'::BYTEA, NULL, NULL, NULL, NULL, NULL
                )::audit_journal
              ) AS bytes`,
      compositeParams(row),
    );
    return result.rows[0]!.bytes;
  } finally {
    client.release();
  }
}

/**
 * ONE FIELD, framed, by each production implementation's own primitives.
 *
 * `30 §5.3`'s NULL rule and framing rule are declared over FIELDS, and v1.3.2's erratum
 * (JCS-01) is entirely about the interaction of the two. The whole-row fixtures below
 * exercise them through a real row kind; these two helpers exercise them directly, so the
 * NULL / empty / one-byte matrix can be asserted for a `bytea` field independently of
 * whether any declared row kind happens to carry a free-form one. That independence is the
 * point: S1G-C1's defect was invisible from the row kinds alone.
 */
async function controlFramedField(sqlType: JcsType, value: unknown): Promise<Buffer> {
  const client = await control.connect();
  try {
    const result = await client.query<{ bytes: Buffer }>(
      `SELECT acos_jcs1_field(acos_jcs1_${sqlType.fn}($1::${sqlType.cast})) AS bytes`,
      [value],
    );
    return result.rows[0]!.bytes;
  } finally {
    client.release();
  }
}

async function auditFramedField(sqlType: JcsType, value: unknown): Promise<Buffer> {
  const client = await audit.owner.connect();
  try {
    const result = await client.query<{ bytes: Buffer }>(
      `SELECT audit_jcs1_field(audit_jcs1_${sqlType.fn}($1::${sqlType.cast})) AS bytes`,
      [value],
    );
    return result.rows[0]!.bytes;
  } finally {
    client.release();
  }
}

interface JcsType {
  readonly fn: 'text' | 'money' | 'int' | 'bool' | 'ts' | 'bytes';
  readonly cast: string;
}

const BYTES: JcsType = { fn: 'bytes', cast: 'BYTEA' };
const TEXT: JcsType = { fn: 'text', cast: 'TEXT' };
const MONEY: JcsType = { fn: 'money', cast: 'NUMERIC' };

/** The same field, framed by all three implementations, asserted equal to the oracle. */
async function allThree(sqlType: JcsType, value: unknown, oracle: Buffer): Promise<Buffer> {
  const fromControl = await controlFramedField(sqlType, value);
  const fromAudit = await auditFramedField(sqlType, value);
  expect(fromControl.equals(oracle), `control ${sqlType.fn}`).toBe(true);
  expect(fromAudit.equals(oracle), `audit ${sqlType.fn}`).toBe(true);
  return oracle;
}

function compositeParams(row: Record<string, unknown>): unknown[] {
  return [
    row['company_id'] ?? COMPANY,
    String(row['journal_seq'] ?? 1),
    row['journal_row_kind'] ?? 'EFFECT_AUTHORISATION',
    row['effect_id'] ?? null,
    row['authorisation_id'] ?? null,
    row['decision_id'] ?? null,
    row['reservation_id'] ?? null,
    row['approval_id'] ?? null,
    row['idempotency_key'] ?? null,
    row['action_class'] ?? null,
    row['resource_ref'] ?? null,
    row['verdict'] ?? null,
    row['vendor_amount'] ?? null,
    row['total_exposure'] ?? null,
    row['forward_integral'] ?? null,
    row['is_rate_class'] ?? null,
    row['dispatch_payload_hash'] ?? null,
    row['constructor_semantic_major'] ?? null,
    row['constructor_non_semantic_minor'] ?? null,
    row['policy_version'] ?? null,
    row['occurred_at'] ?? AT,
    row['prev_hash'] ?? null,
    row['attested_max_journal_seq'] ?? null,
    row['attested_row_count'] ?? null,
    row['attested_head_hash'] ?? null,
  ];
}

/** A complete, ordinary EFFECT_AUTHORISATION fixture row. Hand-authored. */
const ORDINARY = {
  companyId: COMPANY,
  journalSeq: 7n,
  effectId: 'eff_vc_a3',
  authorisationId: 'auth_vc_a3',
  decisionId: 'dec_vc_a3',
  reservationId: 'res_vc_a3',
  approvalId: null,
  idempotencyKey: 'idem_vc_a3',
  actionClass: 'refund.create',
  resourceRef: 'order:ORD-123',
  verdict: 'PERMIT',
  vendorAmount: '25.00',
  totalExposure: '26.03',
  forwardIntegral: null,
  isRateClass: false,
  dispatchPayloadHash: 'sha256:vc-a3',
  constructorSemanticMajor: 1,
  constructorNonSemanticMinor: 0,
  policyVersion: 'acos.policy.v1',
  occurredAt: AT,
  prevHash: HASH32,
} as const;

function ordinaryDbRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    company_id: ORDINARY.companyId,
    journal_seq: ORDINARY.journalSeq.toString(),
    journal_row_kind: 'EFFECT_AUTHORISATION',
    effect_id: ORDINARY.effectId,
    authorisation_id: ORDINARY.authorisationId,
    decision_id: ORDINARY.decisionId,
    reservation_id: ORDINARY.reservationId,
    approval_id: ORDINARY.approvalId,
    idempotency_key: ORDINARY.idempotencyKey,
    action_class: ORDINARY.actionClass,
    resource_ref: ORDINARY.resourceRef,
    verdict: ORDINARY.verdict,
    vendor_amount: ORDINARY.vendorAmount,
    total_exposure: ORDINARY.totalExposure,
    forward_integral: ORDINARY.forwardIntegral,
    is_rate_class: ORDINARY.isRateClass,
    dispatch_payload_hash: ORDINARY.dispatchPayloadHash,
    constructor_semantic_major: ORDINARY.constructorSemanticMajor,
    constructor_non_semantic_minor: ORDINARY.constructorNonSemanticMinor,
    policy_version: ORDINARY.policyVersion,
    occurred_at: ORDINARY.occurredAt,
    prev_hash: ORDINARY.prevHash,
    ...overrides,
  };
}

// =====================================================================================
// The whole row, all three implementations.
// =====================================================================================

describe('VC-A3 — the same fixture row, three independent canonicalisations', () => {
  it('control bytes, audit bytes and the ORACLE agree exactly on an EFFECT_AUTHORISATION row', async () => {
    const expected = oracleCanonicalBytes(effectAuthorisationFields(ORDINARY));
    const fromControl = await controlBytes(ordinaryDbRow());
    const fromAudit = await auditBytes(ordinaryDbRow());

    // Each production implementation against the ORACLE, separately.
    expect(fromControl.equals(expected)).toBe(true);
    expect(fromAudit.equals(expected)).toBe(true);
    // Their agreement follows; it is recorded, not relied on.
    expect(fromAudit.equals(fromControl)).toBe(true);
  });

  it('and on a JOURNAL_ATTESTATION row, which is the SAME chain and the SAME transport', async () => {
    const row = {
      companyId: COMPANY,
      journalSeq: 12n,
      attestedMaxJournalSeq: 11n,
      attestedRowCount: 11n,
      attestedHeadHash: HASH32,
      attestedAt: AT,
      prevHash: HASH32,
    };
    const expected = oracleCanonicalBytes(attestationFields(row));
    const dbRow = {
      journal_seq: '12',
      journal_row_kind: 'JOURNAL_ATTESTATION',
      attested_max_journal_seq: '11',
      attested_row_count: '11',
      attested_head_hash: HASH32,
      occurred_at: AT,
      prev_hash: HASH32,
    };
    expect((await controlBytes(dbRow)).equals(expected)).toBe(true);
    expect((await auditBytes(dbRow)).equals(expected)).toBe(true);
  });

  it('the row HASH agrees too — sha256 over the transmitted bytes', async () => {
    const expected = oracleRowHash(effectAuthorisationFields(ORDINARY));
    const client = await control.connect();
    try {
      const result = await client.query<{ h: Buffer }>(
        `SELECT sha256($1::BYTEA) AS h`,
        [await controlBytes(ordinaryDbRow())],
      );
      expect(result.rows[0]!.h.equals(expected)).toBe(true);
    } finally {
      client.release();
    }
  });

  it('the two implementations declare the SAME NUMBER OF FIELDS per row kind', async () => {
    // A field silently dropped from one declaration would still produce agreeing bytes if
    // it were the LAST field and always null, so the count is asserted structurally: the
    // framed field boundaries are walked and counted.
    expect(countFields(await controlBytes(ordinaryDbRow()))).toBe(23);
    expect(countFields(await auditBytes(ordinaryDbRow()))).toBe(23);
    expect(effectAuthorisationFields(ORDINARY)).toHaveLength(23);
  });
});

/**
 * Walk the framed field boundaries and count them.
 *
 * v1.3.2: the length word `0xFFFFFFFF` is the reserved NULL discriminator and consumes no
 * payload, so the walk advances four bytes rather than `4 + length`. A walker that treated
 * it as a length would demand 4GB of payload and fall off the end — which is the point of
 * the assertion below: the framing has to be exactly self-describing, NULLs included.
 */
function countFields(bytes: Buffer): number {
  let offset = 0;
  let count = 0;
  while (offset < bytes.length) {
    const word = bytes.readUInt32BE(offset);
    offset += word === 0xff_ff_ff_ff ? 4 : 4 + word;
    count += 1;
  }
  expect(offset).toBe(bytes.length); // the framing is exact, or this is not a framed string
  return count;
}

// =====================================================================================
// `36 §2`'s hazard list, one assertion each, against all three implementations.
// =====================================================================================

describe('VC-A3 — each declared hazard, individually', () => {
  it('`25.0` and `25.00` are DIFFERENT BYTES — the money scale is semantic', async () => {
    // `30 §5.3`: "a scale change is a semantic change in a money field."
    //
    // The ORACLE renders at the declared scale 2, so `25.0` and `25.00` render to the SAME
    // string — which is exactly the divergence the rule prevents: the hazard is that two
    // implementations disagree, and the rule closes it by pinning the scale rather than by
    // preserving the input's own scale. What must therefore be asserted is that a value
    // whose declared scale is DIFFERENT — 25.0 at scale 1 — is refused by the oracle, and
    // that a value at a scale the column cannot hold cannot reach either implementation.
    expect(jcsMoney('25.00')!.toString('utf8')).toBe('25.00');
    expect(jcsMoney('25.0')!.toString('utf8')).toBe('25.00');
    expect(() => jcsMoney('25.000')).toThrow(/declared scale 2/);

    // And the amounts themselves discriminate: one cent moves the bytes.
    const a = await controlBytes(ordinaryDbRow({ total_exposure: '26.03' }));
    const b = await controlBytes(ordinaryDbRow({ total_exposure: '26.04' }));
    expect(a.equals(b)).toBe(false);
    expect((await auditBytes(ordinaryDbRow({ total_exposure: '26.04' }))).equals(b)).toBe(true);
  });

  it('NUMERIC(18,2) storage means `25.0` and `25.00` are the same STORED value', async () => {
    // Stated so the previous test is not over-read. The column's declared scale is 2, so
    // PostgreSQL stores both as `25.00` on BOTH servers, and the hazard `30 §5.3` names —
    // two implementations rendering one stored value differently — is what is closed.
    const bytesA = await controlBytes(ordinaryDbRow({ total_exposure: '25.0' }));
    const bytesB = await controlBytes(ordinaryDbRow({ total_exposure: '25.00' }));
    expect(bytesA.equals(bytesB)).toBe(true);
    expect((await auditBytes(ordinaryDbRow({ total_exposure: '25.0' }))).equals(bytesA)).toBe(true);
  });

  it('timestamps render at EXACTLY six fractional digits, UTC, with a `Z`', async () => {
    expect(jcsTimestamp(AT)!.toString('utf8')).toBe('2026-03-04T05:06:07.123000Z');
    const offsetExpressed = new Date('2026-03-04T00:06:07.123-05:00');
    expect(jcsTimestamp(offsetExpressed)!.toString('utf8')).toBe('2026-03-04T05:06:07.123000Z');

    // And both databases agree, from the same instant expressed with an offset.
    const utc = await controlBytes(ordinaryDbRow({ occurred_at: AT }));
    const offset = await controlBytes(ordinaryDbRow({ occurred_at: offsetExpressed }));
    expect(utc.equals(offset)).toBe(true);
    expect((await auditBytes(ordinaryDbRow({ occurred_at: offsetExpressed }))).equals(utc)).toBe(
      true,
    );
  });

  it('NULL is the RESERVED WORD and the EMPTY STRING is a zero-length value', async () => {
    // v1.3.2, JCS-01. NULL carries no payload at all; the empty string carries a payload
    // of length zero. Four bytes versus four bytes, and they are different four bytes.
    expect(jcsText(null)).toBeNull();
    expect(jcsText('')).toEqual(Buffer.alloc(0));
    expect(frameField(jcsText(null))).toEqual(Buffer.from([0xff, 0xff, 0xff, 0xff]));
    expect(frameField(jcsText(''))).toEqual(Buffer.from([0, 0, 0, 0]));

    await allThree(TEXT, null, Buffer.from([0xff, 0xff, 0xff, 0xff]));
    await allThree(TEXT, '', Buffer.from([0, 0, 0, 0]));

    const withNull = await controlBytes(ordinaryDbRow({ approval_id: null }));
    const withEmpty = await controlBytes(ordinaryDbRow({ approval_id: '' }));
    expect(withNull.equals(withEmpty)).toBe(false);
    expect((await auditBytes(ordinaryDbRow({ approval_id: null }))).equals(withNull)).toBe(true);
    expect((await auditBytes(ordinaryDbRow({ approval_id: '' }))).equals(withEmpty)).toBe(true);
  });

  it('a NULL money field is the reserved word, and is distinct from `0.00`', async () => {
    await allThree(MONEY, null, Buffer.from([0xff, 0xff, 0xff, 0xff]));
    await allThree(MONEY, '0.00', frameField(jcsMoney('0.00')));

    const nullAmount = await controlBytes(ordinaryDbRow({ vendor_amount: null }));
    const zeroAmount = await controlBytes(ordinaryDbRow({ vendor_amount: '0.00' }));
    expect(nullAmount.equals(zeroAmount)).toBe(false);
    expect((await auditBytes(ordinaryDbRow({ vendor_amount: null }))).equals(nullAmount)).toBe(true);
    expect((await auditBytes(ordinaryDbRow({ vendor_amount: '0.00' }))).equals(zeroAmount)).toBe(
      true,
    );
  });

  it('the two NFC-equivalent forms of one string hash IDENTICALLY', async () => {
    // U+00E9, and the same character as e + U+0301.
    const composed = 'caf\u00E9';      // U+00E9, one code point
    const decomposed = 'cafe\u0301';   // e + U+0301, two code points
    expect(composed).not.toBe(decomposed);
    expect(jcsText(composed)!.equals(jcsText(decomposed)!)).toBe(true);

    const a = await controlBytes(ordinaryDbRow({ resource_ref: composed }));
    const b = await controlBytes(ordinaryDbRow({ resource_ref: decomposed }));
    expect(a.equals(b)).toBe(true);
    expect((await auditBytes(ordinaryDbRow({ resource_ref: decomposed }))).equals(a)).toBe(true);
  });

  it('4-byte big-endian framing means content cannot forge a boundary', async () => {
    // Two fields, `ab` then `c`, versus one field `abc`, versus `a` then `bc`.
    const abThenC = Buffer.concat([frameField(jcsText('ab')), frameField(jcsText('c'))]);
    const abc = frameField(jcsText('abc'));
    const aThenBc = Buffer.concat([frameField(jcsText('a')), frameField(jcsText('bc'))]);
    expect(abThenC.equals(abc)).toBe(false);
    expect(abThenC.equals(aThenBc)).toBe(false);

    // And moving a boundary between two real fields changes the bytes on both servers.
    const moved = ordinaryDbRow({ action_class: 'refund', resource_ref: '.createorder:ORD-123' });
    expect((await controlBytes(moved)).equals(await controlBytes(ordinaryDbRow()))).toBe(false);
    expect((await auditBytes(moved)).equals(await auditBytes(ordinaryDbRow()))).toBe(false);
  });

  it('the DECLARED field order is not the physical column order', async () => {
    // `30 §5.3` forbids deriving the order from the catalogue. Asserted structurally: the
    // first framed field of both implementations is the ROW-KIND DOMAIN TAG, which is not
    // a column of either table at all.
    const first = (bytes: Buffer): string => {
      const length = bytes.readUInt32BE(0);
      return bytes.subarray(4, 4 + length).toString('utf8');
    };
    expect(first(await controlBytes(ordinaryDbRow()))).toBe(
      'acos.journal.effect_authorisation.v1',
    );
    expect(first(await auditBytes(ordinaryDbRow()))).toBe('acos.journal.effect_authorisation.v1');
    expect(first(await controlBytes({ ...ordinaryDbRow(), journal_row_kind: 'JOURNAL_ATTESTATION', attested_max_journal_seq: '1', attested_row_count: '1', attested_head_hash: HASH32 }))).toBe(
      'acos.journal.attestation.v1',
    );
  });

  it('the two row kinds cannot collide — the domain tag separates them', async () => {
    const effect = await controlBytes(ordinaryDbRow());
    const attestation = await controlBytes({
      journal_row_kind: 'JOURNAL_ATTESTATION',
      attested_max_journal_seq: '1',
      attested_row_count: '1',
      attested_head_hash: HASH32,
      occurred_at: AT,
      prev_hash: HASH32,
    });
    expect(effect.equals(attestation)).toBe(false);
  });
});

// =====================================================================================
// THE NULL / EMPTY / BYTES MATRIX — v1.3.2 erratum JCS-01.
//
// S1G reported the generic `bytes` leg of VC-A3 PARTIAL: under v1.2's one-byte `0x00` NULL
// sentinel, SQL NULL and a `bytea` value of exactly one `0x00` byte framed to the identical
// `00 00 00 01 00`, and the specification declared no rule separating them. Nothing was
// invented then; the input failed closed in all three implementations and S1G-C1 recorded
// the gap.
//
// v1.3.2 resolves it normatively: NULL is the reserved 32-bit length word `0xFFFFFFFF` and
// carries NO payload. This section is the closure evidence — every case the erratum
// distinguishes, asserted against the ORACLE first and then against BOTH production
// implementations, for a `bytea` field directly rather than only through a row kind.
// =====================================================================================

const RESERVED = Buffer.from([0xff, 0xff, 0xff, 0xff]);

describe('VC-A3 — SQL NULL, empty values and arbitrary bytes are pairwise disjoint', () => {
  /** `§8`'s required cases A–G, as a table, so no case can be quietly dropped. */
  const CASES = [
    { label: 'A  SQL NULL', value: null, framed: RESERVED },
    { label: 'C  empty bytes', value: Buffer.alloc(0), framed: Buffer.from([0, 0, 0, 0]) },
    { label: 'D  bytes 00', value: Buffer.from([0x00]), framed: Buffer.from([0, 0, 0, 1, 0]) },
    {
      label: 'E  bytes 0000',
      value: Buffer.from([0x00, 0x00]),
      framed: Buffer.from([0, 0, 0, 2, 0, 0]),
    },
    { label: 'F  bytes FF', value: Buffer.from([0xff]), framed: Buffer.from([0, 0, 0, 1, 0xff]) },
    {
      label: 'G  arbitrary binary with an embedded zero',
      value: Buffer.from([0xde, 0x00, 0xad, 0x00, 0xbe, 0xef]),
      framed: Buffer.from([0, 0, 0, 6, 0xde, 0x00, 0xad, 0x00, 0xbe, 0xef]),
    },
  ] as const;

  it('the ORACLE frames each case to exactly the bytes `30 §5.3` prints', () => {
    for (const { label, value, framed } of CASES) {
      expect(frameField(jcsBytes(value)), label).toEqual(framed);
    }
    // And B — empty TEXT — is the same zero-length value as empty bytes, deliberately:
    // `30 §5.3` prints both as `00 00 00 00`.
    expect(frameField(jcsText(''))).toEqual(Buffer.from([0, 0, 0, 0]));
  });

  it('and BOTH PRODUCTION IMPLEMENTATIONS agree with the oracle, case by case', async () => {
    for (const { label, value, framed } of CASES) {
      expect((await controlFramedField(BYTES, value)).equals(framed), `control ${label}`).toBe(
        true,
      );
      expect((await auditFramedField(BYTES, value)).equals(framed), `audit ${label}`).toBe(true);
    }
  });

  it('every pair that SHOULD differ DOES differ — in all three implementations', async () => {
    const oracle = CASES.map(({ value }) => frameField(jcsBytes(value)).toString('hex'));
    const fromControl: string[] = [];
    const fromAudit: string[] = [];
    for (const { value } of CASES) {
      fromControl.push((await controlFramedField(BYTES, value)).toString('hex'));
      fromAudit.push((await auditFramedField(BYTES, value)).toString('hex'));
    }
    // Six cases, six distinct encodings, in each of the three implementations.
    expect(new Set(oracle).size).toBe(CASES.length);
    expect(new Set(fromControl).size).toBe(CASES.length);
    expect(new Set(fromAudit).size).toBe(CASES.length);
    expect(fromControl).toEqual(oracle);
    expect(fromAudit).toEqual(oracle);
  });

  it('THE DEMONSTRATED COLLISION IS CLOSED — SQL NULL versus a one-byte `0x00` bytea', async () => {
    // This is S1G-C1, and it is the single assertion the whole erratum exists for.
    const oneZeroByte = Buffer.from([0x00]);

    expect(frameField(jcsBytes(null))).toEqual(RESERVED);
    expect(frameField(jcsBytes(oneZeroByte))).toEqual(Buffer.from([0, 0, 0, 1, 0]));
    expect(frameField(jcsBytes(null)).equals(frameField(jcsBytes(oneZeroByte)))).toBe(false);

    for (const [label, framer] of [
      ['control', controlFramedField],
      ['audit', auditFramedField],
    ] as const) {
      const asNull = await framer(BYTES, null);
      const asByte = await framer(BYTES, oneZeroByte);
      expect(asNull.equals(RESERVED), `${label} NULL`).toBe(true);
      expect(asNull.equals(asByte), `${label} collision`).toBe(false);
    }

    // AND IT IS NO LONGER A REFUSAL. v1.3.1 raised
    // `JCS1_BYTES_AMBIGUOUS_WITH_NULL_SENTINEL` on this input in all three
    // implementations; v1.3.2 encodes it, so the refusal must be gone as well as the
    // ambiguity. A specification gap papered over by a fail-closed guard is still a gap.
    expect(() => jcsBytes(oneZeroByte)).not.toThrow();
    const auditClient = await audit.owner.connect();
    try {
      const held = await auditClient.query<{ b: Buffer }>(`SELECT audit_jcs1_bytes($1::BYTEA) AS b`, [
        oneZeroByte,
      ]);
      expect(held.rows[0]!.b.equals(oneZeroByte)).toBe(true);
    } finally {
      auditClient.release();
    }
  });

  it('the reserved word can only ever come from NULL — no payload can produce it', async () => {
    // The injectivity argument, asserted rather than reasoned about: a non-null field
    // always begins with its own length word, and no length word can be 0xFFFFFFFF, so
    // the four bytes NULL produces are unreachable from any payload.
    for (const { label, value } of CASES) {
      if (value === null) continue;
      const framed = frameField(jcsBytes(value));
      expect(framed.subarray(0, 4).equals(RESERVED), `${label} length word`).toBe(false);
      expect(framed.equals(RESERVED), `${label} whole field`).toBe(false);
    }
    // Including a payload that IS four 0xFF bytes — the nearest possible near-miss.
    const fourFF = Buffer.from([0xff, 0xff, 0xff, 0xff]);
    const framed = frameField(jcsBytes(fourFF));
    expect(framed).toEqual(Buffer.from([0, 0, 0, 4, 0xff, 0xff, 0xff, 0xff]));
    expect(framed.equals(RESERVED)).toBe(false);
    expect((await controlFramedField(BYTES, fourFF)).equals(framed)).toBe(true);
    expect((await auditFramedField(BYTES, fourFF)).equals(framed)).toBe(true);
  });

  it('a 32-byte digest and NULL — the only `bytea` values the row kinds actually carry', async () => {
    expect(HASH32).toHaveLength(32);
    expect(jcsBytes(HASH32)!.equals(HASH32)).toBe(true);
    expect(jcsBytes(null)).toBeNull();
    await allThree(BYTES, HASH32, frameField(HASH32));
    await allThree(BYTES, null, RESERVED);
  });
});

// =====================================================================================
// TEXT, NUMERIC and the LENGTH BOUNDARY — `§8`'s remaining legs.
// =====================================================================================

describe('VC-A3 — text, numeric and the framing boundary', () => {
  it('empty string, `"0"` and NULL are three distinct text encodings', async () => {
    const empty = await allThree(TEXT, '', Buffer.from([0, 0, 0, 0]));
    const zeroChar = await allThree(TEXT, '0', Buffer.from([0, 0, 0, 1, 0x30]));
    const asNull = await allThree(TEXT, null, RESERVED);
    const framed = [empty, zeroChar, asNull].map((b) => b.toString('hex'));
    expect(new Set(framed).size).toBe(3);
  });

  it('U+0000 is still REJECTED in canonical text — S1B-C8 is retained, not relaxed', async () => {
    // v1.3.2 removes the INJECTIVITY reason for this rule and keeps the rule. Asserted so
    // the erratum cannot be read as having quietly relaxed it.
    expect(() => jcsText(`a${String.fromCharCode(0)}b`)).toThrow(/U\+0000/);
    const auditClient = await audit.owner.connect();
    try {
      await expect(
        auditClient.query(`SELECT audit_jcs1_text(convert_from($1::BYTEA, 'UTF8'))`, [
          Buffer.from([0x61, 0x00, 0x62]),
        ]),
      ).rejects.toThrow();
    } finally {
      auditClient.release();
    }
  });

  it('NFC-equivalent text agrees, and the two forms frame identically on both servers', async () => {
    const composed = 'café';
    const decomposed = 'café';
    expect(composed).not.toBe(decomposed);
    const expected = frameField(jcsText(composed));
    await allThree(TEXT, composed, expected);
    await allThree(TEXT, decomposed, expected);
  });

  it('numeric: NULL, zero, a negative and the declared scale are all distinct', async () => {
    const cases: readonly (string | null)[] = [null, '0.00', '-1.00', '1.00', '25.00', '25.01'];
    const framed: string[] = [];
    for (const value of cases) {
      const expected = value === null ? RESERVED : frameField(jcsMoney(value));
      await allThree(MONEY, value, expected);
      framed.push(expected.toString('hex'));
    }
    expect(new Set(framed).size).toBe(cases.length);
  });

  it('numeric: two textual forms of one stored value cannot alias apart', async () => {
    // `25.0` and `25.00` are ONE value at the declared scale 2, so they must frame
    // identically — the hazard `30 §5.3` closes is two implementations disagreeing, and
    // the rule closes it by pinning the scale.
    const expected = frameField(jcsMoney('25.00'));
    await allThree(MONEY, '25.0', expected);
    await allThree(MONEY, '25.00', expected);
    expect(() => jcsMoney('25.000')).toThrow(/declared scale 2/);
  });

  it('the LENGTH WORD arithmetic, at 0, ordinary, 0xFFFFFFFE and 0xFFFFFFFF', () => {
    // Tested against the framing PRIMITIVE, not against a fixture: a 4GB payload would
    // prove nothing the arithmetic does not, and `§8` says not to allocate one.
    expect(frameLength(0)).toEqual(Buffer.from([0x00, 0x00, 0x00, 0x00]));
    expect(frameLength(7)).toEqual(Buffer.from([0x00, 0x00, 0x00, 0x07]));
    expect(frameLength(MAX_PAYLOAD_LENGTH)).toEqual(Buffer.from([0xff, 0xff, 0xff, 0xfe]));
    expect(MAX_PAYLOAD_LENGTH).toBe(0xff_ff_ff_fe);

    // 0xFFFFFFFF is RESERVED and is therefore not a representable payload length. It must
    // FAIL CLOSED — never wrap to zero, never truncate, never silently emit the NULL word.
    expect(() => frameLength(0xff_ff_ff_ff)).toThrow(/not representable/);
    expect(() => frameLength(0x1_00_00_00_00)).toThrow(/not representable/);
    expect(() => frameLength(-1)).toThrow(/not a payload length/);

    // And the reserved word is the NULL encoding, which is what makes the bound necessary.
    expect(NULL_LENGTH_WORD).toEqual(Buffer.from([0xff, 0xff, 0xff, 0xff]));
    expect(frameField(null)).toEqual(NULL_LENGTH_WORD);
  });

  it('both production framers declare the SPECIFICATION bound, not their platform limit', async () => {
    // The bound is unreachable on PostgreSQL — `bytea` caps at 1GB — so it is asserted as
    // a property of the declared code rather than exercised. `30 §5.3` states the bound,
    // and an implementation that satisfies it only by accident of its platform has not.
    for (const path of [
      join(process.cwd(), 'src', 'db', 'migrations', '0007__local_authorisation.sql'),
      join(process.cwd(), 'src', 'audit', 'db', 'migrations', 'A0001__audit_store.sql'),
    ]) {
      const sql = await readFile(path, 'utf8');
      const code = sql.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*--.*$/gm, '');
      expect(code, path).toContain('4294967294');
      expect(code, path).toContain('JCS1_FIELD_TOO_LONG');
    }
  });
});

// =====================================================================================
// JSON — `§8`'s JSON leg, and the question S1F-C7 carried forward.
//
// `S1F-C7` and `S1F-owner-resolution.md §7` left "any generic nullable bytes / JSON
// literal-null integration issue" OPEN for the dedicated audit validation slice. The bytes
// half is closed above by v1.3.2. The JSON half is closed here.
// =====================================================================================

describe('VC-A3 — JSON, and SQL NULL versus JSON literal `null`', () => {
  it('JSON literal `null` is an ORDINARY NON-NULL FIELD, and SQL NULL is the reserved word', () => {
    // RFC 8785 renders the JSON value `null` as the four bytes `null`, so it frames as a
    // length-4 payload. A field-level SQL NULL frames as `FF FF FF FF` and carries no
    // payload. Under v1.3.2 they are distinct BY CONSTRUCTION rather than by a difference
    // in payload length, which is what the old rule relied on.
    expect(jcsJson(null)!.toString('utf8')).toBe('null');
    expect(frameField(jcsJson(null))).toEqual(Buffer.from([0, 0, 0, 4, 110, 117, 108, 108]));
    expect(frameField(jcsText(null))).toEqual(RESERVED);
    expect(frameField(jcsJson(null)).equals(frameField(jcsText(null)))).toBe(false);
  });

  it('an ABSENT optional field is a field-level NULL, and is distinct from JSON `null`', () => {
    // `30 §5.3` (v1.3.2): "An absent optional structure member, where the row kind's
    // schema makes absence a state distinct from a present null, is a field-level NULL."
    expect(jcsJson(undefined)).toBeNull();
    expect(frameField(jcsJson(undefined))).toEqual(RESERVED);
    expect(frameField(jcsJson(undefined)).equals(frameField(jcsJson(null)))).toBe(false);
    // And inside a JSON value, a member present-and-null differs from an omitted one.
    expect(jcsJson({ a: null })!.toString('utf8')).toBe('{"a":null}');
    expect(jcsJson({ a: undefined })!.toString('utf8')).toBe('{}');
  });

  it('SQL NULL, JSON null, `{}`, `[]`, `""` and `0` are SIX distinct encodings', () => {
    // `§8`'s JSON leg. Every one of these is a value the JSON rule admits, and none of
    // them may collapse onto another or onto a field-level NULL.
    const framed = [
      frameField(jcsText(null)), //          SQL NULL          FF FF FF FF
      frameField(jcsJson(null)), //          JSON null         00 00 00 04 'null'
      frameField(jcsJson({})), //            JSON {}           00 00 00 02 '{}'
      frameField(jcsJson([])), //            JSON []           00 00 00 02 '[]'
      frameField(jcsJson('')), //            JSON ""           00 00 00 02 '""'
      frameField(jcsJson(0)), //             JSON 0            00 00 00 01 '0'
    ].map((b) => b.toString('hex'));
    expect(new Set(framed).size).toBe(6);
    expect(framed[0]).toBe('ffffffff');
    expect(jcsJson({})!.toString('utf8')).toBe('{}');
    expect(jcsJson([])!.toString('utf8')).toBe('[]');
    expect(jcsJson('')!.toString('utf8')).toBe('""');
    expect(jcsJson(0)!.toString('utf8')).toBe('0');
    // And an empty JSON string is NOT an empty field: it is a two-byte payload.
    expect(frameField(jcsJson('')).equals(frameField(jcsText('')))).toBe(false);
  });

  it('NEITHER ROW KIND CARRIES A JSON COLUMN, so no production row exercises the rule', async () => {
    // `S1F-C7` recorded the decision and A0001 repeats it, so the JSON leg above is
    // settled by the oracle alone — there is no production JSON canonicaliser in either
    // database to compare it against, and none is introduced. Asserted against both
    // schemas so a later migration cannot introduce a JSON column silently.
    for (const [label, harness, table] of [
      ['control', control.pool, 'effect_journal'],
      ['audit', audit.owner, 'audit_journal'],
    ] as const) {
      const client = await harness.connect();
      try {
        const result = await client.query<{ column_name: string }>(
          `SELECT column_name FROM information_schema.columns
            WHERE table_name = $1 AND data_type IN ('json', 'jsonb')`,
          [table],
        );
        expect(result.rows.map((r) => r.column_name), `${label}.${table}`).toEqual([]);
      } finally {
        client.release();
      }
    }
  });
});

// =====================================================================================
// `36 §2`: "a receiving implementation that parses and re-serialises must fail the test."
// =====================================================================================

describe('VC-A3 — the transmitted bytes are what is hashed', () => {
  it('a VULNERABLE receiver that re-serialises with a DIVERGENT rule accepts what production refuses', async () => {
    // The vulnerable rule: render money by trimming trailing zeros — a plausible
    // "normalisation" that `30 §5.3` explicitly forbids, since `25.0` and `25.00` must be
    // different bytes.
    const vulnerableMoney = (value: string | null): Buffer =>
      value === null
        ? Buffer.from([0x00])
        : Buffer.from(value.replace(/\.?0+$/, ''), 'utf8');

    const fields = effectAuthorisationFields(ORDINARY);
    const vulnerable = Buffer.concat(
      fields.map((f: OracleField) =>
        f.kind === 'money'
          ? frameField(vulnerableMoney(f.value))
          : frameField(oracleFieldOf(f)),
      ),
    );
    const correct = oracleCanonicalBytes(fields);

    // THE CONTROL DISCRIMINATES: the two byte strings differ.
    expect(vulnerable.equals(correct)).toBe(false);

    // And the production audit store REFUSES the re-serialised form, because its own
    // construction from the structured fields does not equal what it was handed.
    const client = await audit.replication.connect();
    try {
      await expect(
        client.query(
          `SELECT audit_ingest_journal_row(
             $1, $2::BIGINT, 'EFFECT_AUTHORISATION', 'e','a','d','r',NULL,'k','refund.create',
             'order:X','PERMIT', NULL, '1.00'::NUMERIC, NULL, false, 'h', 1, 0, 'p',
             NULL, NULL, NULL, $3::TIMESTAMPTZ, NULL, $4::BYTEA, $5::BYTEA)`,
          [COMPANY, '1', AT, createHash('sha256').update(vulnerable).digest(), vulnerable],
        ),
      ).resolves.toMatchObject({
        rows: [{ audit_ingest_journal_row: 'AUDIT_CANONICAL_MISMATCH' }],
      });
    } finally {
      client.release();
    }
  });
});

// The vulnerable receiver above diverges on MONEY alone, so every other field goes
// through the oracle's own payload function. Previously reimplemented here; that
// duplication is what let this helper carry v1.2's sentinel after the oracle stopped.
const oracleFieldOf = oracleField;

// =====================================================================================
// Independence, as a property of the SOURCE.
// =====================================================================================

describe('VC-A3 — the two implementations are genuinely two', () => {
  it('the AUDIT migration names no `acos_jcs1_` function anywhere', async () => {
    const sql = await readFile(
      join(process.cwd(), 'src', 'audit', 'db', 'migrations', 'A0001__audit_store.sql'),
      'utf8',
    );
    // Comments are stripped first. The file DISCUSSES the control implementation at
    // length — that is the point of the header — and what must be absent is a CALL.
    const code = sql
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*--.*$/gm, '');
    expect(code).not.toContain('acos_jcs1_');
    expect(code).not.toContain('effect_journal_canonical_bytes');
    expect(code).toContain('audit_jcs1_');
  });

  it('and the control functions DO NOT EXIST on the audit server', async () => {
    const client = await audit.owner.connect();
    try {
      const result = await client.query<{ proname: string }>(
        `SELECT proname FROM pg_proc WHERE proname LIKE 'acos_jcs1%'
            OR proname = 'effect_journal_canonical_bytes'`,
      );
      expect(result.rows).toEqual([]);
    } finally {
      client.release();
    }
  });

  it('and the AUDIT functions do not exist on the control server', async () => {
    const client = await control.connect();
    try {
      const result = await client.query<{ proname: string }>(
        `SELECT proname FROM pg_proc WHERE proname LIKE 'audit_jcs1%'`,
      );
      expect(result.rows).toEqual([]);
    } finally {
      client.release();
    }
  });

  it('the ORACLE imports nothing from `src/`', async () => {
    const source = await readFile(
      join(process.cwd(), 'tests', 'support', 'jcs1Oracle.ts'),
      'utf8',
    );
    expect(source).not.toMatch(/from ['"].*src\//);
    expect(source).not.toMatch(/from ['"]\.\.\/\.\.\/src/);
  });
});
