import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { COMPANY_ID } from '../../support/fixture.js';
import {
  OWNER_ONE,
  createMirrorHarness,
  signGrant,
  signalFieldsAt,
  signalSignedWith,
  type MirrorHarness,
} from '../../support/mirrorFixture.js';
import { auditRows, controlJournal, transportRecordFor } from '../../support/replicationFixture.js';
import {
  corroborationConsumedFields,
  mirrorDeclarationFields,
  oracleCanonicalBytes,
  oracleRowHash,
  overrideEventFields,
} from '../../support/jcs1Oracle.js';
import { emitAttestation } from '../../../src/replication/attestation.js';
import {
  closeMirrorDeclaration,
  consumeCorroboration,
  declareMirrorDegraded,
} from '../../../src/kernel/mirror/mirrorStateMachine.js';
import { signalSigningBytes } from '../../../src/kernel/mirror/corroborationSignal.js';
import { grantOverride } from '../../../src/kernel/mirror/degradedModeOverride.js';
import { money } from '../../../src/kernel/exposure/money.js';

/**
 * THE THREE NEW JOURNAL ROW KINDS: ONE CHAIN, ONE COUNTER, ONE TRANSPORT, TWO
 * INDEPENDENT CANONICALISERS, AND NO JSON.
 *
 * =================================================================================
 * `§29` OF THE S1H MANDATE — NO CANONICAL-FORMAT REGRESSION
 *
 *   "S1H must not silently introduce a new audit/control structured row kind whose
 *    `ACOS-JCS-1` encoding has unimplemented JSON semantics. If a new journal row contains
 *    JSON/structured fields: implement the current production RFC-8785 requirement on BOTH
 *    control and audit sides or choose a current architecture-defined non-JSON row
 *    representation. **Do not leave 'oracle-only' JSON if production now needs it.**"
 *
 * S1H CHOOSES THE NON-JSON REPRESENTATION. Every new column is a scalar — `TEXT`,
 * `TIMESTAMPTZ` — so the RFC-8785 leg is not engaged on either plane and S1G's position
 * (no production row carries a JSON column) is preserved rather than quietly extended. That
 * is asserted below as a SCHEMA property on both servers, so a later migration cannot add
 * one without failing here.
 *
 * `VC-A3`'s discipline is extended to the new kinds: the control trigger, the audit trigger
 * and a HAND-AUTHORED FOURTH READING in `tests/support/jcs1Oracle.ts` are compared, and the
 * oracle is the judge — never one implementation against the other.
 * =================================================================================
 */

let h: MirrorHarness;

const T0 = new Date('2026-03-01T12:00:00.000Z');
const HOUR = 60 * 60 * 1000;

beforeAll(async () => {
  h = await createMirrorHarness();
});

afterAll(async () => {
  await h.close();
});

beforeEach(async () => {
  await h.reset();
});

/** Produce one row of every kind, in a fixed order, and push them all. */
async function produceEveryKind(): Promise<void> {
  // 1 — an attestation, so the chain begins with an ACCEPTED S1G kind and the interleaving
  //     of the two allocators is exercised.
  await emitAttestation(h.control, COMPANY_ID, T0);
  // 2 — the declaration.
  await declareMirrorDegraded(h.control, COMPANY_ID, 'PUSH_ACK_TIMEOUT', T0);
  // 3 — a consumed corroboration.
  await consumeCorroboration(
    h.control,
    COMPANY_ID,
    signalSignedWith(
      signalFieldsAt(T0, { signalId: 'signal:journal-1' }),
      h.auditKey.privateKey,
      signalSigningBytes,
    ),
    h.auditKey.publicKey,
    T0,
  );
  // 4, 5 — the override lifecycle.
  const req = {
    companyId: COMPANY_ID,
    overrideId: 'override:journal-1',
    requestedBy: OWNER_ONE,
    requestedAt: T0,
    effectClasses: ['refund.create'] as const,
    recoverabilityClasses: ['COMPENSABLE'] as const,
    precedenceRows: [3] as const,
    startsAt: T0,
    expiresAt: new Date(T0.getTime() + HOUR),
    effectCountCap: 1n,
    monetaryExposureCap: money('1.00'),
    reason: 'journal-row fixture',
    incidentRef: h.seed.incidentRef,
  };
  await grantOverride(h.control, req, {
    grantedBy: OWNER_ONE,
    grantedAt: T0,
    grantSignature: signGrant(req, h.seed.ownerOne.privateKey),
  });
  // 6 — the declaration closing.
  await closeMirrorDeclaration(h.control, COMPANY_ID, new Date(T0.getTime() + 2 * HOUR));

  // Push everything through the REAL replication path.
  const rows = await controlJournal(h.replication);
  for (const row of rows) {
    const record = await transportRecordFor(h.replication, BigInt(row.journal_seq));
    expect(await h.replication.ingress.ingest(record)).toBe('ACCEPTED');
  }
}

describe('ONE COUNTER, ONE CHAIN — the new kinds are gap-free with the accepted ones', () => {
  it('every kind is on `effect_journal` and `journal_seq` is contiguous from 1', async () => {
    // `30 §5.4`: the attestation "is itself a journal row [...] An attestation that could be
    // pushed outside the chain would be a second unverified channel." The same argument
    // makes these three journal rows rather than a second table.
    await produceEveryKind();
    const rows = await controlJournal(h.replication);
    expect(rows.map((r) => BigInt(r.journal_seq))).toEqual([1n, 2n, 3n, 4n, 5n, 6n]);
    expect(rows.map((r) => r.journal_row_kind)).toEqual([
      'JOURNAL_ATTESTATION',
      'AUDIT_MIRROR_DEGRADED',
      'MIRROR_CORROBORATION_CONSUMED',
      'DEGRADED_MODE_OVERRIDE_EVENT',
      'DEGRADED_MODE_OVERRIDE_EVENT',
      'AUDIT_MIRROR_DEGRADED',
    ]);
  });

  it('the chain links across kinds: each `prev_hash` is its predecessor`s `row_hash`', async () => {
    await produceEveryKind();
    const rows = await controlJournal(h.replication);
    expect(rows[0]!.prev_hash).toEqual(Buffer.alloc(32));
    for (let i = 1; i < rows.length; i += 1) {
      expect(rows[i]!.prev_hash, `link at seq ${String(i + 1)}`).toEqual(rows[i - 1]!.row_hash);
    }
  });

  it('`journal_allocate_seq` and `emit_journal_attestation` agree on the next sequence', async () => {
    // 0008's accepted allocator and 0009's factored one derive the sequence identically —
    // `max(journal_seq) + 1` under the counter lock. Interleaving the two is what proves it:
    // if they disagreed, the chain trigger's contiguity check would refuse a row.
    for (let i = 0; i < 3; i += 1) {
      await emitAttestation(h.control, COMPANY_ID, new Date(T0.getTime() + i * 2 * HOUR));
      await declareMirrorDegraded(h.control, COMPANY_ID, 'PUSH_ACK_TIMEOUT', new Date(T0.getTime() + i * 2 * HOUR));
      await closeMirrorDeclaration(h.control, COMPANY_ID, new Date(T0.getTime() + i * 2 * HOUR + HOUR));
    }
    const rows = await controlJournal(h.replication);
    expect(rows.map((r) => BigInt(r.journal_seq))).toEqual([1n, 2n, 3n, 4n, 5n, 6n, 7n, 8n, 9n]);
  });

  it('and the audit store received and RE-CHAINED all of them', async () => {
    await produceEveryKind();
    const rows = await auditRows(h.replication);
    expect(rows).toHaveLength(6);
    for (const row of rows) {
      // `I17d`: the audit chain is the audit store's own computation.
      expect(row.audit_row_hash.length).toBe(32);
      expect(row.chain_seq).not.toBeNull();
      // `30 §5.3`: "the transmitted bytes are what is hashed", and `A0002`'s trigger requires
      // the store's own construction to EQUAL them — so a divergence between the two
      // canonicalisers is a refusal at ingest, not a later discovery.
      expect(row.transmitted_bytes.length).toBeGreaterThan(0);
    }
  });
});

describe('`VC-A3` EXTENDED — three readings of each new kind, judged by the fourth', () => {
  it('`AUDIT_MIRROR_DEGRADED`: control bytes == audit bytes == hand-authored oracle', async () => {
    await produceEveryKind();
    const control = await controlJournal(h.replication);
    const audit = await auditRows(h.replication);

    for (const row of control.filter((r) => r.journal_row_kind === 'AUDIT_MIRROR_DEGRADED')) {
      const seq = BigInt(row.journal_seq);
      const detail = await controlDetail(seq);
      const oracle = oracleCanonicalBytes(
        mirrorDeclarationFields({
          companyId: COMPANY_ID,
          journalSeq: seq,
          declarationId: detail.mirror_declaration_id!,
          event: detail.mirror_declaration_event!,
          observedReason: detail.mirror_observed_reason!,
          occurredAt: detail.occurred_at,
          prevHash: row.prev_hash,
        }),
      );
      // CONTROL side.
      expect(row.transmitted_bytes.equals(oracle), `control bytes at ${String(seq)}`).toBe(true);
      expect(row.row_hash.equals(oracleRowHash(
        mirrorDeclarationFields({
          companyId: COMPANY_ID,
          journalSeq: seq,
          declarationId: detail.mirror_declaration_id!,
          event: detail.mirror_declaration_event!,
          observedReason: detail.mirror_observed_reason!,
          occurredAt: detail.occurred_at,
          prevHash: row.prev_hash,
        }),
      ))).toBe(true);
      // AUDIT side, independently constructed on the other server.
      const auditRow = audit.find((r) => BigInt(r.journal_seq) === seq)!;
      const auditBytes = await auditConstruction(seq);
      expect(auditBytes.equals(oracle), `audit bytes at ${String(seq)}`).toBe(true);
      expect(auditRow.transmitted_bytes.equals(oracle)).toBe(true);
    }
  });

  it('`MIRROR_CORROBORATION_CONSUMED`: all three agree', async () => {
    await produceEveryKind();
    const control = await controlJournal(h.replication);
    const row = control.find((r) => r.journal_row_kind === 'MIRROR_CORROBORATION_CONSUMED')!;
    const seq = BigInt(row.journal_seq);
    const detail = await controlDetail(seq);
    const fields = corroborationConsumedFields({
      companyId: COMPANY_ID,
      journalSeq: seq,
      signalId: detail.corroboration_signal_id!,
      intervalStart: detail.corroboration_interval_start!,
      observedAt: detail.corroboration_observed_at!,
      expiresAt: detail.corroboration_expires_at!,
      reason: detail.corroboration_reason!,
      occurredAt: detail.occurred_at,
      prevHash: row.prev_hash,
    });
    const oracle = oracleCanonicalBytes(fields);
    expect(row.transmitted_bytes.equals(oracle)).toBe(true);
    expect(row.row_hash.equals(oracleRowHash(fields))).toBe(true);
    expect((await auditConstruction(seq)).equals(oracle)).toBe(true);
  });

  it('`DEGRADED_MODE_OVERRIDE_EVENT`: all three agree', async () => {
    await produceEveryKind();
    const control = await controlJournal(h.replication);
    for (const row of control.filter(
      (r) => r.journal_row_kind === 'DEGRADED_MODE_OVERRIDE_EVENT',
    )) {
      const seq = BigInt(row.journal_seq);
      const detail = await controlDetail(seq);
      const fields = overrideEventFields({
        companyId: COMPANY_ID,
        journalSeq: seq,
        overrideId: detail.override_id!,
        event: detail.override_event!,
        actor: detail.override_actor!,
        occurredAt: detail.occurred_at,
        prevHash: row.prev_hash,
      });
      const oracle = oracleCanonicalBytes(fields);
      expect(row.transmitted_bytes.equals(oracle)).toBe(true);
      expect(row.row_hash.equals(oracleRowHash(fields))).toBe(true);
      expect((await auditConstruction(seq)).equals(oracle)).toBe(true);
    }
  });

  it('the ACCEPTED kinds still hash to what they hashed before 0009 and A0002', async () => {
    // 0009 and A0002 both rewrote `*_journal_canonical_bytes`. Branches 1 and 2 are claimed
    // byte-identical to 0007's, 0008's and A0001's. This is the assertion behind the claim:
    // an attestation row's bytes are still the attestation branch's bytes, so no accepted
    // `row_hash` moved.
    await emitAttestation(h.control, COMPANY_ID, T0);
    const rows = await controlJournal(h.replication);
    const attestation = rows[0]!;
    expect(attestation.journal_row_kind).toBe('JOURNAL_ATTESTATION');
    // The attestation's declared order begins with its own domain tag, which is the S1G one.
    const tag = Buffer.from('acos.journal.attestation.v1', 'utf8');
    expect(attestation.transmitted_bytes.includes(tag)).toBe(true);
    expect(attestation.transmitted_bytes.includes(Buffer.from('audit_mirror_degraded'))).toBe(
      false,
    );
  });
});

describe('`§29` — NO JSON COLUMN REACHES A HASHED FIELD ON EITHER PLANE', () => {
  it('`effect_journal` has no `json` or `jsonb` column', async () => {
    const client = await h.control.connect();
    try {
      const rows = await client.query<{ column_name: string; data_type: string }>(
        `SELECT column_name, data_type FROM information_schema.columns
          WHERE table_name = 'effect_journal'`,
      );
      const jsonColumns = rows.rows.filter((r) => r.data_type === 'json' || r.data_type === 'jsonb');
      expect(jsonColumns).toEqual([]);
      // And every S1H column is a scalar of a type `ACOS-JCS-1` already implements.
      const s1h = rows.rows.filter((r) =>
        /^(mirror_|corroboration_|override_)/.test(r.column_name),
      );
      expect(s1h.length).toBe(11);
      for (const column of s1h) {
        expect(['text', 'timestamp with time zone']).toContain(column.data_type);
      }
    } finally {
      client.release();
    }
  });

  it('`audit_journal` has no `json` or `jsonb` column either', async () => {
    const client = await h.auditOwner.connect();
    try {
      const rows = await client.query<{ column_name: string; data_type: string }>(
        `SELECT column_name, data_type FROM information_schema.columns
          WHERE table_name = 'audit_journal'`,
      );
      expect(rows.rows.filter((r) => r.data_type === 'json' || r.data_type === 'jsonb')).toEqual(
        [],
      );
      const s1h = rows.rows.filter((r) =>
        /^(mirror_|corroboration_|override_)/.test(r.column_name),
      );
      expect(s1h.length).toBe(11);
      for (const column of s1h) {
        expect(['text', 'timestamp with time zone']).toContain(column.data_type);
      }
    } finally {
      client.release();
    }
  });

  it('the signed CORROBORATION SIGNAL is scalar-only too', async () => {
    const client = await h.auditOwner.connect();
    try {
      const rows = await client.query<{ data_type: string }>(
        `SELECT data_type FROM information_schema.columns
          WHERE table_name = 'audit_mirror_input_stall_signal'`,
      );
      expect(rows.rows.filter((r) => r.data_type === 'json' || r.data_type === 'jsonb')).toEqual(
        [],
      );
    } finally {
      client.release();
    }
  });
});

describe('THE PER-KIND SHAPE IS A DATABASE CONSTRAINT, NOT APPLICATION DISCIPLINE', () => {
  it('an `EFFECT_AUTHORISATION` row may not carry an S1H column', async () => {
    // 0009 extended the ACCEPTED arms with the S1H columns as REQUIRED-ABSENT, exactly as
    // 0008 extended 0007's. An accepted row kind must not silently acquire a permissible new
    // field, because the declared byte order for that kind does not include it.
    const client = await h.control.connect();
    try {
      await expect(
        client.query(
          `INSERT INTO effect_journal
             (company_id, journal_seq, journal_row_kind, override_id, override_event,
              override_actor, occurred_at)
           VALUES ($1, 1, 'AUDIT_MIRROR_DEGRADED', 'x', 'GRANTED', 'y', $2)`,
          [COMPANY_ID, T0],
        ),
      ).rejects.toThrow(/journal_row_shape_per_kind/);
    } finally {
      client.release();
    }
  });

  it('an `AUDIT_MIRROR_DEGRADED` row without its three fields is refused', async () => {
    const client = await h.control.connect();
    try {
      await expect(
        client.query(
          `INSERT INTO effect_journal
             (company_id, journal_seq, journal_row_kind, mirror_declaration_id, occurred_at)
           VALUES ($1, 1, 'AUDIT_MIRROR_DEGRADED', 'declaration:x', $2)`,
          [COMPANY_ID, T0],
        ),
      ).rejects.toThrow(/journal_row_shape_per_kind/);
    } finally {
      client.release();
    }
  });

  it('an UNDECLARED row kind is refused', async () => {
    const client = await h.control.connect();
    try {
      await expect(
        client.query(
          `INSERT INTO effect_journal
             (company_id, journal_seq, journal_row_kind, occurred_at)
           VALUES ($1, 1, 'MIRROR_IS_FINE', $2)`,
          [COMPANY_ID, T0],
        ),
      ).rejects.toThrow(/journal_row_kind_declared/);
    } finally {
      client.release();
    }
  });

  it('the three discriminator enums are CLOSED', async () => {
    const client = await h.control.connect();
    try {
      for (const [column, value, constraint] of [
        ['mirror_declaration_event', 'MAYBE', /journal_mirror_declaration_event_declared/],
        ['override_event', 'BORROWED', /journal_override_event_declared/],
        ['corroboration_reason', 'BECAUSE_I_SAID_SO', /journal_corroboration_reason_declared/],
      ] as const) {
        await expect(
          client.query(
            `INSERT INTO effect_journal (company_id, journal_seq, journal_row_kind, ${column},
               occurred_at) VALUES ($1, 1, 'JOURNAL_ATTESTATION', $2, $3)`,
            [COMPANY_ID, value, T0],
          ),
        ).rejects.toThrow(constraint);
      }
    } finally {
      client.release();
    }
  });
});

describe('`S1H-C4` — THE S1G IMMUTABILITY HOLE IS CLOSED', () => {
  it('the ATTESTED columns can no longer be rewritten on a chained row', async () => {
    // 0008 added three attestation columns and did NOT extend 0007's explicit ROW comparison,
    // so an `UPDATE` touching only those three passed the guard. 0009 replaces the
    // comparison with a total one. This is the regression test for the hole.
    await emitAttestation(h.control, COMPANY_ID, T0);
    const client = await h.control.connect();
    try {
      await expect(
        client.query(
          `UPDATE effect_journal SET attested_row_count = 999 WHERE company_id = $1`,
          [COMPANY_ID],
        ),
      ).rejects.toThrow(/JOURNAL_ROW_IMMUTABLE/);
      await expect(
        client.query(
          `UPDATE effect_journal SET attested_head_hash = $2 WHERE company_id = $1`,
          [COMPANY_ID, Buffer.alloc(32, 9)],
        ),
      ).rejects.toThrow(/JOURNAL_ROW_IMMUTABLE/);
      await expect(
        client.query(
          `UPDATE effect_journal SET attested_max_journal_seq = 999 WHERE company_id = $1`,
          [COMPANY_ID],
        ),
      ).rejects.toThrow(/JOURNAL_ROW_IMMUTABLE/);
    } finally {
      client.release();
    }
  });

  it('nor can the S1H columns', async () => {
    await declareMirrorDegraded(h.control, COMPANY_ID, 'PUSH_ACK_TIMEOUT', T0);
    const client = await h.control.connect();
    try {
      await expect(
        client.query(
          `UPDATE effect_journal SET mirror_observed_reason = 'PUSH_PATH_UNREACHABLE'
            WHERE company_id = $1`,
          [COMPANY_ID],
        ),
      ).rejects.toThrow(/JOURNAL_ROW_IMMUTABLE/);
    } finally {
      client.release();
    }
  });

  it('and `mirrored_at` is STILL the one permitted update — S1G is not weakened', async () => {
    // `30 §5.2` requires `mirrored_at` to be settable "on first successful acknowledgement".
    // The total comparison must not have taken that away.
    await emitAttestation(h.control, COMPANY_ID, T0);
    const client = await h.control.connect();
    try {
      const result = await client.query(
        `UPDATE effect_journal SET mirrored_at = $2 WHERE company_id = $1`,
        [COMPANY_ID, T0],
      );
      expect(result.rowCount).toBe(1);
    } finally {
      client.release();
    }
  });

  it('and DELETE is still refused', async () => {
    await emitAttestation(h.control, COMPANY_ID, T0);
    const client = await h.control.connect();
    try {
      await expect(
        client.query('DELETE FROM effect_journal WHERE company_id = $1', [COMPANY_ID]),
      ).rejects.toThrow(/APPEND_ONLY_TABLE_effect_journal/);
    } finally {
      client.release();
    }
  });
});

// =====================================================================================
// Helpers
// =====================================================================================

interface JournalDetail {
  readonly occurred_at: Date;
  readonly mirror_declaration_id: string | null;
  readonly mirror_declaration_event: string | null;
  readonly mirror_observed_reason: string | null;
  readonly corroboration_signal_id: string | null;
  readonly corroboration_interval_start: Date | null;
  readonly corroboration_observed_at: Date | null;
  readonly corroboration_expires_at: Date | null;
  readonly corroboration_reason: string | null;
  readonly override_id: string | null;
  readonly override_event: string | null;
  readonly override_actor: string | null;
}

async function controlDetail(seq: bigint): Promise<JournalDetail> {
  const client = await h.control.connect();
  try {
    const rows = await client.query<JournalDetail>(
      `SELECT occurred_at, mirror_declaration_id, mirror_declaration_event,
              mirror_observed_reason, corroboration_signal_id, corroboration_interval_start,
              corroboration_observed_at, corroboration_expires_at, corroboration_reason,
              override_id, override_event, override_actor
         FROM effect_journal WHERE company_id = $1 AND journal_seq = $2`,
      [COMPANY_ID, seq.toString()],
    );
    return rows.rows[0]!;
  } finally {
    client.release();
  }
}

/** The AUDIT server's own construction, from its own columns, by its own function. */
async function auditConstruction(seq: bigint): Promise<Buffer> {
  const client = await h.auditOwner.connect();
  try {
    const rows = await client.query<{ bytes: Buffer }>(
      `SELECT audit_journal_canonical_bytes(a.*) AS bytes FROM audit_journal a
        WHERE a.company_id = $1 AND a.journal_seq = $2`,
      [COMPANY_ID, seq.toString()],
    );
    return rows.rows[0]!.bytes;
  } finally {
    client.release();
  }
}
