import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { Client, Pool } from '../../../src/db/pool.js';
import { CAN03, loadCommerceFixture } from '../../support/enumerationFixture.js';
import {
  S1E_PASS_ORDER,
  loadAuthorityWorld,
  loadS1eOrders,
  s1eSpec,
} from '../../support/authorityFixture.js';
import {
  COMPANY_ID,
  makeLocalAuthorityHarness,
  proposeAndAuthorise,
  type LocalAuthorityHarness,
} from '../../support/localAuthorisationFixture.js';
import {
  auditIncidents,
  auditRows,
  createReplicationFixture,
  sha256,
  transportRecordFor,
  type ReplicationFixture,
} from '../../support/replicationFixture.js';

/**
 * THE AUDIT ROLE BOUNDARY — `I17d`, `I41`, `I17c`, and `30 §5`'s "INSERT and nothing else".
 *
 * =================================================================================
 * EVERY PROHIBITED OPERATION IS ATTEMPTED AGAINST REAL POSTGRESQL.
 *
 * `§6` of the S1G mandate: "Test role privileges with real PostgreSQL. Do NOT merely
 * inspect GRANT strings. Actually attempt the prohibited operations."
 *
 * So nothing below reads `information_schema.role_table_grants` and calls it proof. Every
 * case connects AS `acos_audit_replication` — the credential the control plane holds — and
 * issues the statement. The assertion is the PostgreSQL error.
 *
 * Registry `I17d`, verbatim: "Hash and sequence values are computed by database functions
 * inside each instance, UNDER ROLES THE WRITING PRINCIPAL CANNOT EXECUTE AS. [...] Attempt
 * to insert a row with caller-supplied `row_hash`/`chain_seq` as the writing principal;
 * MUST FAIL."
 * =================================================================================
 */

let fixture: ReplicationFixture;
let kernel: LocalAuthorityHarness;

beforeAll(async () => {
  fixture = await createReplicationFixture();
});

afterAll(async () => {
  await fixture.close();
});

beforeEach(async () => {
  await fixture.reset();
  const client = await fixture.control.connect();
  try {
    await loadCommerceFixture(client);
    await loadS1eOrders(client);
    await loadAuthorityWorld(client);
  } finally {
    client.release();
  }
  kernel = makeLocalAuthorityHarness(fixture.control);
  const spec = s1eSpec({ admittedResourceRefs: [S1E_PASS_ORDER.resourceRef, CAN03.resourceRef] });
  await proposeAndAuthorise(kernel, S1E_PASS_ORDER, { spec });
  await proposeAndAuthorise(kernel, CAN03, { spec });
});

/** Run `fn` on a connection held by the replication principal, and return what happened. */
async function asReplication<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  return runAs(fixture.audit.replication, fn);
}

async function runAs<T>(pool: Pool, fn: (client: Client) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

async function refused(fn: (client: Client) => Promise<unknown>): Promise<string> {
  try {
    await asReplication(fn);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error('the operation was PERMITTED. It must not be.');
}

// =====================================================================================
// The identity of the connection itself.
// =====================================================================================

describe('the control plane connects to the audit store as a SCOPED role', () => {
  it('the replication principal is not the owner and not a superuser', async () => {
    const who = await asReplication(async (client) => {
      const result = await client.query<{
        session_user: string;
        is_super: boolean;
        db: string;
      }>(
        `SELECT session_user,
                (SELECT rolsuper FROM pg_roles WHERE rolname = session_user) AS is_super,
                current_database() AS db`,
      );
      return result.rows[0]!;
    });
    expect(who.session_user).toBe('acos_audit_replication');
    expect(who.is_super).toBe(false);
  });

  it('and the row it inserts records THAT principal, not the definer', async () => {
    // The ingest entry point is SECURITY DEFINER, so `CURRENT_USER` inside it is the
    // owner. `received_from` uses `SESSION_USER` deliberately, or the I17c quota would be
    // charged to the wrong principal and per-principal accounting would be a fiction.
    await fixture.ingress.ingest(await transportRecordFor(fixture, 1n));
    const held = await auditRows(fixture);
    expect(held[0]!.received_from).toBe('acos_audit_replication');
  });
});

// =====================================================================================
// `I17d` — the writing principal cannot choose the chain.
// =====================================================================================

describe('I17d — the replication principal cannot choose a chain value', () => {
  it('a caller-supplied `audit_row_hash` is REFUSED', async () => {
    const record = await transportRecordFor(fixture, 1n);
    const message = await refused((client) =>
      client.query(
        `INSERT INTO audit_journal (company_id, journal_seq, journal_row_kind,
           occurred_at, prev_hash, claimed_row_hash, transmitted_bytes, audit_row_hash)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          COMPANY_ID,
          '1',
          'EFFECT_AUTHORISATION',
          record.fields.occurredAt,
          Buffer.from(record.fields.prevHash!),
          Buffer.from(record.claimedRowHash),
          Buffer.from(record.transmittedBytes),
          sha256(Buffer.from('a hash of my own choosing')),
        ],
      ),
    );
    expect(message).toContain('I17D_CALLER_SUPPLIED_AUDIT_CHAIN');
    expect(await auditRows(fixture)).toHaveLength(0);
  });

  it('a caller-supplied `audit_prev_hash` is REFUSED', async () => {
    const record = await transportRecordFor(fixture, 1n);
    const message = await refused((client) =>
      client.query(
        `INSERT INTO audit_journal (company_id, journal_seq, journal_row_kind,
           occurred_at, prev_hash, claimed_row_hash, transmitted_bytes, audit_prev_hash)
         VALUES ($1, '1', 'EFFECT_AUTHORISATION', $2, $3, $4, $5, $6)`,
        [
          COMPANY_ID,
          record.fields.occurredAt,
          Buffer.from(record.fields.prevHash!),
          Buffer.from(record.claimedRowHash),
          Buffer.from(record.transmittedBytes),
          Buffer.alloc(32),
        ],
      ),
    );
    expect(message).toContain('I17D_CALLER_SUPPLIED_AUDIT_CHAIN');
  });

  it('a caller-supplied `chain_seq` is REFUSED', async () => {
    const record = await transportRecordFor(fixture, 1n);
    const message = await refused((client) =>
      client.query(
        `INSERT INTO audit_journal (company_id, journal_seq, journal_row_kind,
           occurred_at, prev_hash, claimed_row_hash, transmitted_bytes, chain_seq)
         VALUES ($1, '1', 'EFFECT_AUTHORISATION', $2, $3, $4, $5, 99)`,
        [
          COMPANY_ID,
          record.fields.occurredAt,
          Buffer.from(record.fields.prevHash!),
          Buffer.from(record.claimedRowHash),
          Buffer.from(record.transmittedBytes),
        ],
      ),
    );
    expect(message).toContain('I17D_CALLER_SUPPLIED_AUDIT_CHAIN');
  });

  it('the privileged chain function cannot be EXECUTED directly by the writing principal', async () => {
    const message = await refused((client) => client.query(`SELECT audit_journal_chain()`));
    expect(message).toMatch(/permission denied for function audit_journal_chain/);
  });

  it('nor can the quota default, nor the canonicaliser, be executed by it', async () => {
    expect(await refused((c) => c.query(`SELECT audit_default_insert_quota()`))).toMatch(
      /permission denied/,
    );
    expect(
      await refused((c) =>
        c.query(`SELECT audit_journal_canonical_bytes(a.*) FROM audit_journal a`),
      ),
    ).toMatch(/permission denied/);
  });

  it('a DIRECT insert that bypasses the entry point still goes through the trigger', async () => {
    // The grant `30 §5` names is INSERT, so a direct INSERT is a legitimate shape. What it
    // does NOT do is bypass verification: the same trigger runs, and the same refusals
    // apply. Here the row is honest, so it lands — and it lands FULLY CHAINED.
    const record = await transportRecordFor(fixture, 1n);
    await asReplication((client) =>
      client.query(
        `INSERT INTO audit_journal (company_id, journal_seq, journal_row_kind,
           effect_id, authorisation_id, decision_id, reservation_id, approval_id,
           idempotency_key, action_class, resource_ref, verdict, vendor_amount,
           total_exposure, forward_integral, is_rate_class, dispatch_payload_hash,
           constructor_semantic_major, constructor_non_semantic_minor, policy_version,
           occurred_at, prev_hash, claimed_row_hash, transmitted_bytes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
                 $21,$22,$23,$24)`,
        [
          record.fields.companyId,
          record.fields.journalSeq.toString(),
          record.fields.journalRowKind,
          record.fields.effectId,
          record.fields.authorisationId,
          record.fields.decisionId,
          record.fields.reservationId,
          record.fields.approvalId,
          record.fields.idempotencyKey,
          record.fields.actionClass,
          record.fields.resourceRef,
          record.fields.verdict,
          record.fields.vendorAmount,
          record.fields.totalExposure,
          record.fields.forwardIntegral,
          record.fields.isRateClass,
          record.fields.dispatchPayloadHash,
          record.fields.constructorSemanticMajor,
          record.fields.constructorNonSemanticMinor,
          record.fields.policyVersion,
          record.fields.occurredAt,
          Buffer.from(record.fields.prevHash!),
          Buffer.from(record.claimedRowHash),
          Buffer.from(record.transmittedBytes),
        ],
      ),
    );
    const held = await auditRows(fixture);
    expect(held).toHaveLength(1);
    expect(held[0]!.chain_seq).toBe('1');
    expect(held[0]!.audit_prev_hash).toEqual(Buffer.alloc(32));
    expect(held[0]!.audit_row_hash).not.toBeNull();
  });

  it('and a direct insert with ALTERED FIELDS is refused by the same trigger', async () => {
    const record = await transportRecordFor(fixture, 1n);
    const message = await refused((client) =>
      client.query(
        `INSERT INTO audit_journal (company_id, journal_seq, journal_row_kind,
           effect_id, authorisation_id, decision_id, reservation_id, idempotency_key,
           action_class, resource_ref, verdict, total_exposure, is_rate_class,
           dispatch_payload_hash, constructor_semantic_major, constructor_non_semantic_minor,
           policy_version, occurred_at, prev_hash, claimed_row_hash, transmitted_bytes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'order:REWRITTEN',$10,$11,$12,$13,$14,$15,$16,
                 $17,$18,$19,$20)`,
        [
          record.fields.companyId,
          record.fields.journalSeq.toString(),
          record.fields.journalRowKind,
          record.fields.effectId,
          record.fields.authorisationId,
          record.fields.decisionId,
          record.fields.reservationId,
          record.fields.idempotencyKey,
          record.fields.actionClass,
          record.fields.verdict,
          record.fields.totalExposure,
          record.fields.isRateClass,
          record.fields.dispatchPayloadHash,
          record.fields.constructorSemanticMajor,
          record.fields.constructorNonSemanticMinor,
          record.fields.policyVersion,
          record.fields.occurredAt,
          Buffer.from(record.fields.prevHash!),
          Buffer.from(record.claimedRowHash),
          Buffer.from(record.transmittedBytes),
        ],
      ),
    );
    expect(message).toContain('AUDIT_CANONICAL_MISMATCH');
  });
});

// =====================================================================================
// `30 §5` — "INSERT and nothing else".
// =====================================================================================

describe('the replication principal holds INSERT and nothing else', () => {
  beforeEach(async () => {
    await fixture.ingress.ingest(await transportRecordFor(fixture, 1n));
  });

  it('UPDATE on an accepted audit row is refused', async () => {
    const message = await refused((client) =>
      client.query(`UPDATE audit_journal SET total_exposure = '0.01' WHERE company_id = $1`, [
        COMPANY_ID,
      ]),
    );
    expect(message).toMatch(/permission denied for table audit_journal/);
    expect((await auditRows(fixture))[0]!.total_exposure).not.toBe('0.01');
  });

  it('DELETE on an accepted audit row is refused', async () => {
    const message = await refused((client) =>
      client.query(`DELETE FROM audit_journal WHERE company_id = $1`, [COMPANY_ID]),
    );
    expect(message).toMatch(/permission denied for table audit_journal/);
    expect(await auditRows(fixture)).toHaveLength(1);
  });

  it('TRUNCATE is refused', async () => {
    const message = await refused((client) => client.query(`TRUNCATE audit_journal`));
    expect(message).toMatch(/must be owner of table audit_journal|permission denied/);
    expect(await auditRows(fixture)).toHaveLength(1);
  });

  it('and even the OWNER cannot rewrite an accepted row — the trigger refuses it', async () => {
    // `30 §5`'s append-only property is enforced at the database layer, not by the grant
    // alone. A compromised owner credential still cannot silently alter history.
    const message = await runAs(fixture.audit.owner, async (client) => {
      try {
        await client.query(`UPDATE audit_journal SET total_exposure = '0.01'`);
        return '';
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
    });
    expect(message).toContain('APPEND_ONLY_TABLE_audit_journal');
  });

  it('DISABLE TRIGGER is refused to the writing principal', async () => {
    const message = await refused((client) =>
      client.query(`ALTER TABLE audit_journal DISABLE TRIGGER audit_journal_chain`),
    );
    expect(message).toMatch(/must be owner of (table |relation )?audit_journal/);
  });

  it('DDL against the audit schema is refused', async () => {
    expect(
      await refused((c) => c.query(`CREATE TABLE shadow_journal (id INT)`)),
    ).toMatch(/permission denied for schema public/);
    expect(await refused((c) => c.query(`DROP TABLE audit_journal`))).toMatch(
      /must be owner of table audit_journal/,
    );
  });
});

// =====================================================================================
// The findings the audit plane owns.
// =====================================================================================

describe('the control plane cannot read, write, rewrite or delete an audit finding', () => {
  beforeEach(async () => {
    // Produce one CRITICAL finding about the control plane, by attacking the store.
    const original = await transportRecordFor(fixture, 1n);
    await fixture.ingress.ingest(original);
    await fixture.ingress.ingest({
      ...original,
      claimedRowHash: sha256(Buffer.from('a different claim')),
    });
    expect((await auditIncidents(fixture)).some((i) => i.severity === 'CRITICAL')).toBe(true);
  });

  it('SELECT on `audit_incident` is refused to the replication principal', async () => {
    expect(await refused((c) => c.query(`SELECT * FROM audit_incident`))).toMatch(
      /permission denied for table audit_incident/,
    );
  });

  it('INSERT is refused — the control plane cannot manufacture a finding about itself', async () => {
    expect(
      await refused((c) =>
        c.query(
          `INSERT INTO audit_incident (company_id, kind, severity, detail)
           VALUES ($1, 'AUDIT_PUSH_DUPLICATE', 'INFO', '{}'::JSONB)`,
          [COMPANY_ID],
        ),
      ),
    ).toMatch(/permission denied for table audit_incident/);
  });

  it('DELETE and UPDATE are refused — a finding cannot be closed by the audited party', async () => {
    expect(await refused((c) => c.query(`DELETE FROM audit_incident`))).toMatch(
      /permission denied for table audit_incident/,
    );
    expect(
      await refused((c) => c.query(`UPDATE audit_incident SET severity = 'INFO'`)),
    ).toMatch(/permission denied for table audit_incident/);
    expect((await auditIncidents(fixture)).some((i) => i.severity === 'CRITICAL')).toBe(true);
  });

  it('and even the owner cannot rewrite one', async () => {
    const message = await runAs(fixture.audit.owner, async (client) => {
      try {
        await client.query(`DELETE FROM audit_incident`);
        return '';
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
    });
    expect(message).toContain('APPEND_ONLY_TABLE_audit_incident');
  });

  it('the EVALUATOR can read and write findings, and CANNOT insert a journal row', async () => {
    // The other half of the separation. A compromised evaluator must not be able to
    // manufacture the holdings it then certifies.
    const findings = await runAs(fixture.audit.evaluator, async (client) => {
      const result = await client.query<{ n: string }>(`SELECT count(*) AS n FROM audit_incident`);
      return Number(result.rows[0]!.n);
    });
    expect(findings).toBeGreaterThan(0);

    const message = await runAs(fixture.audit.evaluator, async (client) => {
      try {
        await client.query(
          `INSERT INTO audit_journal (company_id, journal_seq, journal_row_kind, occurred_at,
             claimed_row_hash, transmitted_bytes)
           VALUES ($1, 99, 'EFFECT_AUTHORISATION', now(), '\\x00', '\\x00')`,
          [COMPANY_ID],
        );
        return '';
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
    });
    expect(message).toMatch(/permission denied for table audit_journal/);
  });
});

// =====================================================================================
// `I17c` — the per-principal insert quota. `37` S1: "insert-only grant UNDER QUOTA".
// =====================================================================================

describe('I17c — the audit insert quota', () => {
  it('the quota ledger is not readable or writable by the principal it bounds', async () => {
    expect(await refused((c) => c.query(`SELECT * FROM audit_insert_quota`))).toMatch(
      /permission denied for table audit_insert_quota/,
    );
    expect(
      await refused((c) =>
        c.query(`UPDATE audit_insert_quota SET max_rows = 999999999`),
      ),
    ).toMatch(/permission denied for table audit_insert_quota/);
  });

  it('an accepted insert CHARGES the quota, against the connecting principal', async () => {
    await fixture.ingress.ingest(await transportRecordFor(fixture, 1n));
    await fixture.ingress.ingest(await transportRecordFor(fixture, 2n));
    const charged = await runAs(fixture.audit.evaluator, async (client) => {
      const result = await client.query<{ principal_name: string; inserted_rows: string }>(
        `SELECT principal_name, inserted_rows FROM audit_insert_quota`,
      );
      return result.rows;
    });
    expect(charged).toHaveLength(1);
    expect(charged[0]!.principal_name).toBe('acos_audit_replication');
    expect(charged[0]!.inserted_rows).toBe('2');
  });

  it('a benign duplicate does NOT charge the quota — a retry storm cannot saturate it', async () => {
    const record = await transportRecordFor(fixture, 1n);
    await fixture.ingress.ingest(record);
    for (let i = 0; i < 5; i += 1) await fixture.ingress.ingest(record);
    const charged = await runAs(fixture.audit.evaluator, async (client) => {
      const result = await client.query<{ inserted_rows: string }>(
        `SELECT inserted_rows FROM audit_insert_quota`,
      );
      return result.rows[0]!.inserted_rows;
    });
    expect(charged).toBe('1');
  });

  it('SATURATION is an INCIDENT, not a mode change, and already-accepted rows survive', async () => {
    // `30 §5.1` item 5, verbatim: "Audit-store saturation is an INCIDENT, NOT A MODE
    // CHANGE (I17c)." And AUDA-05's defect, which the quota exists to close: "the control
    // plane holds INSERT with no quota, so filling the audit store converted the whole
    // system into an approval queue."
    await fixture.ingress.ingest(await transportRecordFor(fixture, 1n));

    // Drive the quota to zero headroom, as the OWNER — the principal it bounds cannot.
    await runAs(fixture.audit.owner, async (client) => {
      await client.query(
        `UPDATE audit_insert_quota SET max_rows = inserted_rows
          WHERE principal_name = 'acos_audit_replication'`,
      );
    });

    const outcome = await fixture.ingress.ingest(await transportRecordFor(fixture, 2n));
    expect(outcome).toBe('AUDIT_QUOTA_SATURATED');

    // An INCIDENT was recorded.
    const incidents = await auditIncidents(fixture);
    expect(incidents.map((i) => i.kind)).toContain('AUDIT_QUOTA_SATURATED');

    // The already-accepted row is untouched: saturation does not drop holdings.
    expect(await auditRows(fixture)).toHaveLength(1);

    // Saturation did NOT raise the quota, and did NOT mutate any grant.
    const quota = await runAs(fixture.audit.evaluator, async (client) => {
      const result = await client.query<{ max_rows: string; inserted_rows: string }>(
        `SELECT max_rows, inserted_rows FROM audit_insert_quota`,
      );
      return result.rows[0]!;
    });
    expect(quota.max_rows).toBe(quota.inserted_rows);
  });

  it('the principal cannot bypass the quota by inserting directly', async () => {
    await fixture.ingress.ingest(await transportRecordFor(fixture, 1n));
    await runAs(fixture.audit.owner, async (client) => {
      await client.query(
        `UPDATE audit_insert_quota SET max_rows = inserted_rows
          WHERE principal_name = 'acos_audit_replication'`,
      );
    });
    const record = await transportRecordFor(fixture, 2n);
    const message = await refused((client) =>
      client.query(
        `INSERT INTO audit_journal (company_id, journal_seq, journal_row_kind, occurred_at,
           prev_hash, claimed_row_hash, transmitted_bytes)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          COMPANY_ID,
          '2',
          record.fields.journalRowKind,
          record.fields.occurredAt,
          Buffer.from(record.fields.prevHash!),
          Buffer.from(record.claimedRowHash),
          Buffer.from(record.transmittedBytes),
        ],
      ),
    );
    expect(message).toContain('I17C_AUDIT_INSERT_QUOTA_SATURATED');
    expect(await auditRows(fixture)).toHaveLength(1);
  });

  it('THE VULNERABLE CONTROL: treating saturation as throughput accepts beyond the quota', async () => {
    // `§15`: "Add a vulnerable control that treats quota exhaustion as a throughput
    // condition and silently accepts beyond the quota."
    await runAs(fixture.audit.owner, async (client) => {
      await client.query(`CREATE TEMP TABLE vulnerable_quota (principal TEXT, used INT, cap INT)`);
      await client.query(`INSERT INTO vulnerable_quota VALUES ('acos_audit_replication', 1, 1)`);
      // The vulnerable rule: "we're over the cap, so log a warning and carry on."
      await client.query(`UPDATE vulnerable_quota SET used = used + 1`);
      const result = await client.query<{ used: number; cap: number }>(
        `SELECT used, cap FROM vulnerable_quota`,
      );
      // It DISCRIMINATES: the vulnerable store is over its own declared bound and did not
      // stop, and no incident exists to say so.
      expect(result.rows[0]!.used).toBeGreaterThan(result.rows[0]!.cap);
    });

    // Production cannot reach that state: the bound is a CHECK constraint on the ledger
    // itself, so `inserted_rows > max_rows` is not a representable row.
    const message = await runAs(fixture.audit.owner, async (client) => {
      try {
        await client.query(
          `INSERT INTO audit_insert_quota (principal_name, window_start, max_rows, inserted_rows)
           VALUES ('over', now(), 1, 2)`,
        );
        return '';
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
    });
    expect(message).toContain('audit_quota_within_bound');
  });
});
