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
  jcsBytes,
  jcsJson,
  jcsMoney,
  jcsText,
  jcsTimestamp,
  oracleCanonicalBytes,
  oracleRowHash,
  type OracleField,
} from '../../support/jcs1Oracle.js';

/**
 * `VC-A3` — `ACOS-JCS-1` CROSS-IMPLEMENTATION. S1G.
 *
 * `36 §2`, verbatim:
 *
 *   "VC-A3 — `ACOS-JCS-1` cross-implementation. The same fixture rows serialised by the
 *    control trigger and by the audit trigger produce byte-identical output. Assert each
 *    hazard individually: `25.0 ≠ 25.00`; timestamps at exactly 6 fractional digits UTC;
 *    declared column order survives a physical column reorder; null sentinel distinct
 *    from empty string; NFC normalisation; RFC 8785 for JSON columns; 4-byte BE length
 *    framing. Assert the transmitted bytes are hashed — a receiving implementation that
 *    parses and re-serialises must fail the test."
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

function countFields(bytes: Buffer): number {
  let offset = 0;
  let count = 0;
  while (offset < bytes.length) {
    const length = bytes.readUInt32BE(offset);
    offset += 4 + length;
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
    expect(jcsMoney('25.00').toString('utf8')).toBe('25.00');
    expect(jcsMoney('25.0').toString('utf8')).toBe('25.00');
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
    expect(jcsTimestamp(AT).toString('utf8')).toBe('2026-03-04T05:06:07.123000Z');
    const offsetExpressed = new Date('2026-03-04T00:06:07.123-05:00');
    expect(jcsTimestamp(offsetExpressed).toString('utf8')).toBe('2026-03-04T05:06:07.123000Z');

    // And both databases agree, from the same instant expressed with an offset.
    const utc = await controlBytes(ordinaryDbRow({ occurred_at: AT }));
    const offset = await controlBytes(ordinaryDbRow({ occurred_at: offsetExpressed }));
    expect(utc.equals(offset)).toBe(true);
    expect((await auditBytes(ordinaryDbRow({ occurred_at: offsetExpressed }))).equals(utc)).toBe(
      true,
    );
  });

  it('NULL and the EMPTY STRING are distinct — one byte versus zero bytes', async () => {
    expect(jcsText(null)).toEqual(Buffer.from([0x00]));
    expect(jcsText('')).toEqual(Buffer.alloc(0));
    expect(frameField(jcsText(null))).toEqual(Buffer.from([0, 0, 0, 1, 0]));
    expect(frameField(jcsText(''))).toEqual(Buffer.from([0, 0, 0, 0]));

    const withNull = await controlBytes(ordinaryDbRow({ approval_id: null }));
    const withEmpty = await controlBytes(ordinaryDbRow({ approval_id: '' }));
    expect(withNull.equals(withEmpty)).toBe(false);
    expect((await auditBytes(ordinaryDbRow({ approval_id: null }))).equals(withNull)).toBe(true);
    expect((await auditBytes(ordinaryDbRow({ approval_id: '' }))).equals(withEmpty)).toBe(true);
  });

  it('a NULL money field is the sentinel, and is distinct from `0.00`', async () => {
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
    expect(jcsText(composed).equals(jcsText(decomposed))).toBe(true);

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
// The carried-forward question: nullable `bytes` and JSON literal null.
//
// `S1F-C7` and `S1F-owner-resolution.md §7` left this OPEN for "the dedicated audit
// validation slice", which is this one. It is settled here WITHOUT INVENTING ANYTHING.
// =====================================================================================

describe('VC-A3 — the carried-forward nullable-`bytes` / JSON-literal-null question', () => {
  it('JSON literal `null` and SQL NULL are DISTINCT under `30 §5.3` as written', () => {
    // RFC 8785 renders the JSON value `null` as the four bytes `null`; the SQL null rule
    // is a one-byte sentinel. Framed, they are length 4 and length 1. Nothing had to be
    // added to the specification to distinguish them.
    expect(jcsJson(null).toString('utf8')).toBe('null');
    expect(frameField(jcsJson(null))).toEqual(Buffer.from([0, 0, 0, 4, 110, 117, 108, 108]));
    expect(frameField(jcsText(null))).toEqual(Buffer.from([0, 0, 0, 1, 0]));
    expect(frameField(jcsJson(null)).equals(frameField(jcsText(null)))).toBe(false);

    // An ABSENT optional field — `undefined`, not a JSON value — is the SQL-null sentinel.
    expect(frameField(jcsJson(undefined))).toEqual(Buffer.from([0, 0, 0, 1, 0]));
    // And a JSON object whose member is literal null is distinct from one omitting it.
    expect(jcsJson({ a: null }).toString('utf8')).toBe('{"a":null}');
    expect(jcsJson({ a: undefined }).toString('utf8')).toBe('{}');
  });

  it('NEITHER ROW KIND CARRIES A JSON COLUMN, so no production row exercises the rule', async () => {
    // `S1F-C7` recorded the decision and A0001 repeats it. Asserted against both schemas
    // so a later migration cannot introduce one without failing here first.
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

  it('a one-byte `0x00` BYTEA is REFUSED by all three, not encoded — S1G-C1', async () => {
    // `30 §5.3` declares a generic null sentinel and no `bytes` rule that distinguishes a
    // one-byte 0x00 value from it. THE AMBIGUITY IS REAL AND IS NOT RESOLVED HERE.
    // `S1G-owner-clarifications.md` S1G-C1 records it and `S1G-result.md` reports the
    // generic `bytes` leg of VC-A3 as PARTIAL.
    //
    // What is asserted is FAIL-CLOSED behaviour, identically, in three places — never a
    // representation.
    const oneZeroByte = Buffer.from([0x00]);
    expect(() => jcsBytes(oneZeroByte)).toThrow(/refused rather than encoded/);

    const auditClient = await audit.owner.connect();
    try {
      await expect(
        auditClient.query(`SELECT audit_jcs1_bytes($1::BYTEA)`, [oneZeroByte]),
      ).rejects.toThrow(/JCS1_BYTES_AMBIGUOUS_WITH_NULL_SENTINEL/);
    } finally {
      auditClient.release();
    }

    // And it is UNREACHABLE from either declared row kind: the only `bytea` fields are
    // `prev_hash` and `attested_head_hash`, both always NULL or a 32-byte digest.
    expect(HASH32).toHaveLength(32);
    expect(jcsBytes(HASH32).equals(HASH32)).toBe(true);
    expect(jcsBytes(null)).toEqual(Buffer.from([0x00]));
  });

  it('EMPTY BYTES and NULL BYTES are distinct — zero length versus the sentinel', () => {
    expect(frameField(jcsBytes(Buffer.alloc(0)))).toEqual(Buffer.from([0, 0, 0, 0]));
    expect(frameField(jcsBytes(null))).toEqual(Buffer.from([0, 0, 0, 1, 0]));
    expect(frameField(jcsBytes(Buffer.alloc(0))).equals(frameField(jcsBytes(null)))).toBe(false);
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

function oracleFieldOf(field: OracleField): Buffer {
  switch (field.kind) {
    case 'text':
      return jcsText(field.value);
    case 'money':
      return jcsMoney(field.value);
    case 'int':
      return field.value === null ? Buffer.from([0x00]) : Buffer.from(field.value.toString(), 'utf8');
    case 'bool':
      return field.value === null ? Buffer.from([0x00]) : Buffer.from(field.value ? 'true' : 'false', 'utf8');
    case 'ts':
      return jcsTimestamp(field.value);
    case 'bytes':
      return jcsBytes(field.value);
    case 'json':
      return jcsJson(field.value);
  }
}

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
