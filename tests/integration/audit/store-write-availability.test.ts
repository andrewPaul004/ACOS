import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { COMPANY_ID } from '../../support/fixture.js';
import { createMirrorHarness, type MirrorHarness } from '../../support/mirrorFixture.js';
import {
  auditIncidents,
  sha256,
  tamperStructuredField,
  transportRecordFor,
} from '../../support/replicationFixture.js';
import {
  unsafeErrorMapper,
  unsafeOpenEndedSqlstateMapper,
  unsafeOutcomeMapper,
} from '../../negative-controls/unsafe-store-write-classifier.js';
import {
  EXPLICITLY_EXCLUDED_SQLSTATES,
  MAPPED_STORE_WRITE_SQLSTATES,
  classifyStoreWriteError,
} from '../../../src/audit/storeWriteAvailability.js';
import { observeStall } from '../../../src/audit/mirrorInputStall.js';
import { emitAttestation } from '../../../src/replication/attestation.js';
import type {
  AuditIngestOutcome,
  JournalTransportRecord,
} from '../../../src/audit/transport/journalRecord.js';

/**
 * `30 §5.7.1a` — `STORE_WRITE_REJECTED`'s CLOSED AUDIT-OWNED DERIVATION, AGAINST TWO REAL
 * POSTGRESQL INSTANCES. v1.3.3, `S1H-C8` CLOSED.
 *
 * =================================================================================
 * WHAT WAS NOT DERIVED, AND WHY.
 *
 * `30 §5.7.1` declared `reason enum { …, STORE_WRITE_REJECTED }` and no derivation. The one
 * reading a reader reaches for — insert-quota saturation — is EXPLICITLY FORBIDDEN as a mode
 * change by `§5.1` item 5 and by `§5.6`'s reachability table. So S1H never returned the
 * member and reported the leg PARTIAL (`S1H-C8`); `§42` forbids inventing the rule.
 *
 * `§5.7.1a` declares it: a closed TEN-CONDITION predicate over one semantic failure class,
 * `AUDIT_STORE_WRITE_UNAVAILABLE`, with the concrete PostgreSQL mapping left to the
 * implementation as a closed enumeration that FAILS CLOSED on unknown errors.
 * =================================================================================
 *
 * =================================================================================
 * THE FIVE CONTROLS `§8` REQUIRES, AND THE ONE THAT MATTERS MOST.
 *
 *   A  quota saturation          unsafe corroborates; production: incident only
 *   B  sequence collision        unsafe corroborates; production: security incident
 *   C  canonical/hash mismatch   unsafe corroborates; production: integrity incident
 *   D  unknown database error    unsafe corroborates; production: UNKNOWN, fail closed
 *   E  GENUINE availability failure — PRODUCTION DOES DERIVE THE CAUSE
 *
 * E is mandatory: "This positive control is mandatory so the safe implementation is not
 * simply 'never emit it.'" Without it, A-D would be satisfied by a function that returns
 * `UNKNOWN` unconditionally, which is what S1H already shipped and what `§5.7.1a` was
 * written to replace.
 * =================================================================================
 *
 * =================================================================================
 * HOW E IS DRIVEN, AND WHY THE INJECTION IS LEGITIMATE.
 *
 * A real disk-full or I/O failure cannot be produced from a test suite. What CAN be produced
 * is the exact SQLSTATE PostgreSQL raises for one, at the exact point in the ingest path
 * where a real one would arrive: a trigger on `audit_journal` that raises `53100`.
 *
 * THE TRIGGER'S NAME AND TIMING ARE THE WHOLE POINT. It is `zzz_inject_disk_full`, a BEFORE
 * INSERT trigger, and PostgreSQL fires same-timing triggers in NAME ORDER — so it runs AFTER
 * `audit_journal_chain`, which is the trigger that performs `§5.7.1a` conjuncts 4, 5 and 8
 * (canonical reconstruction, the hash checks, the insert quota). The injected failure
 * therefore arrives strictly after every validity condition has PASSED, which is the
 * ordering the predicate requires, and the suite asserts that ordering rather than assuming
 * it: with the trigger installed, a MALFORMED row still produces `AUDIT_CANONICAL_MISMATCH`
 * and NO observation, because the chain trigger raises first.
 *
 * `36 §14` permits exactly this kind of seam, and it lives in this file rather than in
 * `src/`: `no-dispatch-boundary.test.ts` asserts that no `src/` file imports from `tests/`.
 * =================================================================================
 */

let h: MirrorHarness;

const T0 = new Date('2026-03-01T12:00:00.000Z');
/** Past `k × cadence`, so the attestation channel is also stalled and both reasons could hold. */
const STALLED_AT = new Date(T0.getTime() + 20 * 60 * 1000);

beforeAll(async () => {
  h = await createMirrorHarness();
});

afterAll(async () => {
  await h.close();
});

beforeEach(async () => {
  await h.reset();
});

async function storeWriteFailures(): Promise<
  readonly { readonly failureClass: string; readonly sqlstate: string }[]
> {
  const client = await h.auditOwner.connect();
  try {
    const rows = await client.query<{ failure_class: string; sqlstate: string }>(
      `SELECT failure_class, sqlstate FROM audit_store_write_failure
        WHERE company_id = $1 ORDER BY failure_id`,
      [COMPANY_ID],
    );
    return rows.rows.map((r) => ({ failureClass: r.failure_class, sqlstate: r.sqlstate }));
  } finally {
    client.release();
  }
}

/** Install the fault injection. See the header: the name orders it AFTER the chain trigger. */
async function injectStoreWriteFailure(sqlstate: string): Promise<void> {
  // `USING ERRCODE` takes a string EXPRESSION, so the code must be single-quoted; a
  // double-quoted one is an identifier and PostgreSQL raises `42703` instead, which would
  // make every case below pass for the wrong reason. The pattern check keeps the
  // interpolation safe and is asserted rather than assumed.
  if (!/^[0-9A-Z]{5}$/.test(sqlstate)) throw new Error(`not a SQLSTATE: ${sqlstate}`);
  const client = await h.auditOwner.connect();
  try {
    await client.query(`
      CREATE OR REPLACE FUNCTION zzz_inject_store_write_failure() RETURNS TRIGGER
      LANGUAGE plpgsql AS $fn$
      BEGIN
        RAISE EXCEPTION 'injected storage failure'
          USING ERRCODE = '${sqlstate}';
      END;
      $fn$;
    `);
    await client.query(`
      CREATE TRIGGER zzz_inject_disk_full
        BEFORE INSERT ON audit_journal
        FOR EACH ROW EXECUTE FUNCTION zzz_inject_store_write_failure();
    `);
  } finally {
    client.release();
  }
}

/** Push one attestation row through the real replication path. */
async function pushOneRow(at: Date): Promise<AuditIngestOutcome> {
  const seq = await emitAttestation(h.control, COMPANY_ID, at);
  const record = await transportRecordFor(h.replication, seq);
  return h.replication.ingress.ingest(record);
}

async function saturateQuota(): Promise<void> {
  const owner = await h.auditOwner.connect();
  try {
    // The accepted expression of saturation, from `vc-a2d-signal-authenticity.test.ts`:
    // `audit_quota_within_bound` forbids `inserted_rows > max_rows`, so the ceiling is
    // pulled DOWN TO the rows already inserted.
    await owner.query(
      `INSERT INTO audit_insert_quota (principal_name, window_start, max_rows, inserted_rows)
       VALUES ('acos_audit_replication', date_trunc('hour', now()), 0, 0)
       ON CONFLICT (principal_name, window_start)
         DO UPDATE SET max_rows = audit_insert_quota.inserted_rows`,
    );
  } finally {
    owner.release();
  }
}

// =====================================================================================
// THE MAPPING IS CLOSED, AND THE TWO TRANSCRIPTIONS AGREE
// =====================================================================================

describe('`30 §5.7.1a` — the PostgreSQL mapping is a CLOSED enumeration', () => {
  it('exactly three SQLSTATEs map, and each is justified at the point of implementation', () => {
    // `§6`: "The PostgreSQL-specific mapping must be closed, explicitly documented, tested,
    // fail-closed for unknown SQLSTATE/error classes."
    expect([...MAPPED_STORE_WRITE_SQLSTATES].sort()).toEqual(['25006', '53100', '58030']);
  });

  it('and the application mapping is the mapping the AUDIT STORE enforces', async () => {
    // The SQL handler in `A0004` is an INDEPENDENT transcription of the same three codes, and
    // a drift between it and `storeWriteAvailability.ts` would be a silent widening or
    // narrowing. Read out of `pg_get_functiondef` rather than out of the migration file, so
    // the assertion is against what is DEPLOYED.
    const client = await h.auditOwner.connect();
    try {
      const def = await client.query<{ src: string }>(
        `SELECT pg_get_functiondef(p.oid) AS src
           FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE p.proname = 'audit_ingest_journal_row' AND n.nspname = 'public'`,
      );
      const src = def.rows[0]!.src;
      // Slice AFTER the quota handler, so `ACS18` — which is `I17c`'s quota code and is
      // excluded by name — is not counted as a mapped one.
      const quotaAt = src.indexOf("WHEN sqlstate 'ACS18'");
      expect(quotaAt).toBeGreaterThan(0);
      const handler = src.slice(quotaAt + "WHEN sqlstate 'ACS18'".length);
      for (const code of MAPPED_STORE_WRITE_SQLSTATES) {
        expect(handler, `${code} must be handled by the deployed function`).toContain(
          `sqlstate '${code}'`,
        );
      }
      // And no OTHER code is handled into the class. Every `sqlstate 'x'` after the quota
      // handler is one of the three.
      const handled = [...handler.matchAll(/sqlstate '([^']+)'/g)].map((m) => m[1]!);
      expect([...new Set(handled)].sort()).toEqual([...MAPPED_STORE_WRITE_SQLSTATES].sort());
    } finally {
      client.release();
    }
  });

  it('every explicitly-excluded SQLSTATE is UNKNOWN', () => {
    // The exclusion list is illustrative of the reasoning; the MECHANISM is the allowlist.
    // Asserted member by member so a future edit to either list is a failure.
    for (const code of EXPLICITLY_EXCLUDED_SQLSTATES) {
      expect(classifyStoreWriteError({ code }), code).toBe('UNKNOWN');
    }
    // And the two lists are disjoint, which is what makes the assertion above meaningful.
    for (const code of MAPPED_STORE_WRITE_SQLSTATES) {
      expect(EXPLICITLY_EXCLUDED_SQLSTATES).not.toContain(code);
    }
  });

  it('and the classifier FAILS CLOSED on everything else, by construction', () => {
    // `§6`: "fail-closed for unknown SQLSTATE/error classes." The default is `UNKNOWN` and
    // the mapped set is a literal allowlist, so a code nobody enumerated is refused.
    for (const code of ['99999', 'XX000', '', 'ACS99', '53101', '58031', '25007']) {
      expect(classifyStoreWriteError({ code }), code).toBe('UNKNOWN');
    }
    // Nothing is read from the message: a classifier that matched on text would be one a
    // payload could influence.
    expect(
      classifyStoreWriteError({ code: 'XX000', message: 'disk full 53100 io_error 58030' }),
    ).toBe('UNKNOWN');
    // And a non-error throw, an error with no code, and a non-string code are all UNKNOWN.
    for (const thrown of [null, undefined, 'a string', 42, {}, { code: 53100 }, new Error('x')]) {
      expect(classifyStoreWriteError(thrown)).toBe('UNKNOWN');
    }
  });
});

describe('`30 §5.7.1a` — the derivation window is `attestation_cadence × k`, not a new quantity', () => {
  it('the audit store declares it as 15 minutes', async () => {
    const client = await h.auditOwner.connect();
    try {
      const w = await client.query<{ window: string }>(
        `SELECT audit_store_write_failure_window()::TEXT AS window`,
      );
      expect(w.rows[0]!.window).toBe('00:15:00');
      // And it equals `cadence × k`, computed rather than asserted.
      const arithmetic = await client.query<{ same: boolean }>(
        `SELECT audit_store_write_failure_window()
                = (INTERVAL '5 minutes' * 3) AS same`,
      );
      expect(arithmetic.rows[0]!.same).toBe(true);
    } finally {
      client.release();
    }
  });
});

// =====================================================================================
// `§8` E — THE MANDATORY POSITIVE CONTROL
// =====================================================================================

describe('`§8` E — A GENUINE STORE-WRITE AVAILABILITY FAILURE DOES DERIVE THE CAUSE', () => {
  beforeEach(async () => {
    await injectStoreWriteFailure('53100');
  });

  it('the ingest outcome is `AUDIT_STORE_WRITE_UNAVAILABLE`, and the row is NOT stored', async () => {
    const outcome = await pushOneRow(T0);
    expect(outcome).toBe('AUDIT_STORE_WRITE_UNAVAILABLE');

    const client = await h.auditOwner.connect();
    try {
      const rows = await client.query<{ n: string }>(
        'SELECT count(*) AS n FROM audit_journal WHERE company_id = $1',
        [COMPANY_ID],
      );
      expect(rows.rows[0]!.n).toBe('0');
    } finally {
      client.release();
    }
  });

  it('the AUDIT PLANE records its own observation, and an incident with it', async () => {
    await pushOneRow(T0);
    const failures = await storeWriteFailures();
    expect(failures).toHaveLength(1);
    expect(failures[0]!.failureClass).toBe('AUDIT_STORE_WRITE_UNAVAILABLE');
    expect(failures[0]!.sqlstate).toBe('53100');

    // `§5.7.1a`: the derivation is ADDITIONAL to the incident, not a replacement for it.
    const incidents = await auditIncidents(h.replication);
    expect(incidents.map((i) => i.kind)).toContain('AUDIT_STORE_WRITE_UNAVAILABLE');
  });

  it('and `observeStall` DERIVES `STORE_WRITE_REJECTED` from it', async () => {
    // THE POSITIVE CONTROL. Without this the four negative controls below would be satisfied
    // by "never emit it", which is what S1H shipped.
    await pushOneRow(T0);
    const observation = await observeStall(h.auditEvaluator, COMPANY_ID, T0);
    expect(observation).not.toBeNull();
    expect(observation!.reason).toBe('STORE_WRITE_REJECTED');
    expect(observation!.detail).toContain('53100');
  });

  it('and the other two mapped codes derive it too', async () => {
    // Driven separately, because a mapping asserted only for the code the suite happens to
    // inject is a mapping with one tested member.
    for (const code of ['58030', '25006']) {
      await h.reset();
      await injectStoreWriteFailure(code);
      const outcome = await pushOneRow(T0);
      expect(outcome, code).toBe('AUDIT_STORE_WRITE_UNAVAILABLE');
      const observation = await observeStall(h.auditEvaluator, COMPANY_ID, T0);
      expect(observation?.reason, code).toBe('STORE_WRITE_REJECTED');
    }
  });

  it('the observation AGES OUT — an old failure is not a condition that holds now', async () => {
    await pushOneRow(T0);
    // Inside the 15-minute window: derived.
    expect((await observeStall(h.auditEvaluator, COMPANY_ID, T0))?.reason).toBe(
      'STORE_WRITE_REJECTED',
    );
    // The window is measured from the audit store's own `clock_timestamp()` on the
    // observation row, so "an hour ago" is expressed by evaluating an hour in the future.
    const later = new Date(Date.now() + 60 * 60 * 1000);
    const stale = await observeStall(h.auditEvaluator, COMPANY_ID, later);
    expect(stale?.reason).not.toBe('STORE_WRITE_REJECTED');
  });

  it('and the two reasons resolve the SAME state — the choice carries no authority', async () => {
    // `§5.7.1a`: a `STORE_WRITE_REJECTED` signal "confers exactly what `ATTESTATION_STALL`
    // confers and nothing more". `resolveMirrorState` never reads `reason`, and this is the
    // behavioural statement of that: the signal's reason is diagnostic.
    await pushOneRow(T0);
    const withFailure = await observeStall(h.auditEvaluator, COMPANY_ID, T0);
    expect(withFailure!.reason).toBe('STORE_WRITE_REJECTED');
    // The same observation's OTHER fields are the attestation channel's, unchanged — so the
    // signal a caller would sign is identical except for the reason and the detail.
    expect(withFailure!.companyId).toBe(COMPANY_ID);
    expect(withFailure!.observedAt.getTime()).toBe(T0.getTime());
  });
});

// =====================================================================================
// `§8` A — QUOTA SATURATION. THE ONE THE ARCHITECTURE FORBIDS BY NAME.
// =====================================================================================

describe('`§8` A — AUDIT QUOTA SATURATION IS INCIDENT-ONLY AND NEVER CHANGES MIRROR MODE', () => {
  beforeEach(async () => {
    await saturateQuota();
  });

  it('PRODUCTION: the outcome is `AUDIT_QUOTA_SATURATED`, and NO observation is recorded', async () => {
    const outcome = await pushOneRow(new Date(STALLED_AT.getTime() + 1000));
    expect(outcome).toBe('AUDIT_QUOTA_SATURATED');
    // `§5.7.1a` conjunct 8: "audit insertion quota is available". Failed, so the class is
    // not derived and the observation table is empty.
    expect(await storeWriteFailures()).toHaveLength(0);
  });

  it('PRODUCTION: and it is an INCIDENT — `I17c`, unchanged by v1.3.3', async () => {
    await pushOneRow(new Date(STALLED_AT.getTime() + 1000));
    const incidents = await auditIncidents(h.replication);
    expect(incidents.map((i) => i.kind)).toContain('AUDIT_QUOTA_SATURATED');
    expect(incidents.map((i) => i.kind)).not.toContain('AUDIT_STORE_WRITE_UNAVAILABLE');
  });

  it('PRODUCTION: `observeStall` NEVER reports `STORE_WRITE_REJECTED` from a saturated quota', async () => {
    // THE DIRECT REGRESSION ASSERTION `§7` ASKS FOR, on the sentence it asks for it on:
    // "AUDIT QUOTA SATURATION REMAINS INCIDENT-ONLY AND MUST NEVER CHANGE MIRROR MODE."
    await pushOneRow(new Date(STALLED_AT.getTime() + 1000));
    const observation = await observeStall(h.auditEvaluator, COMPANY_ID, STALLED_AT);
    expect(observation?.reason).not.toBe('STORE_WRITE_REJECTED');
    // Whatever the observation IS, it is a fact about the attestation channel or nothing at
    // all — never about the quota. Stated as the closed alternative rather than as one
    // value, because with the quota saturated from the start no attestation ever reached
    // this store, so `evaluateTransportCompleteness` has no holdings to find a stall in and
    // legitimately returns no finding. Both outcomes are "the quota bought no relaxation".
    expect(observation === null || observation.reason === 'ATTESTATION_STALL').toBe(true);
  });

  it('UNSAFE: the generic outcome mapper corroborates degraded mode from it', async () => {
    const outcome = await pushOneRow(new Date(STALLED_AT.getTime() + 1000));
    expect(unsafeOutcomeMapper(outcome)).toBe('AUDIT_STORE_WRITE_UNAVAILABLE');
  });

  it('THE DISCRIMINATION, as one assertion', async () => {
    const outcome = await pushOneRow(new Date(STALLED_AT.getTime() + 1000));
    const unsafe = unsafeOutcomeMapper(outcome);
    const production = await storeWriteFailures();
    expect(unsafe).toBe('AUDIT_STORE_WRITE_UNAVAILABLE');
    expect(production).toHaveLength(0);
    expect((await observeStall(h.auditEvaluator, COMPANY_ID, STALLED_AT))?.reason).not.toBe(
      'STORE_WRITE_REJECTED',
    );
  });
});

// =====================================================================================
// `§8` B — SEQUENCE COLLISION
// =====================================================================================

describe('`§8` B — A CONFLICTING SEQUENCE IS A SECURITY INCIDENT, NOT A STORE REJECTION', () => {
  async function collide(): Promise<AuditIngestOutcome> {
    const seq = await emitAttestation(h.control, COMPANY_ID, T0);
    const record = await transportRecordFor(h.replication, seq);
    expect(await h.replication.ingress.ingest(record)).toBe('ACCEPTED');
    // A DIFFERENT row claiming the same sequence. `30 §5.2`: "Conflict, DIFFERING row_hash |
    // Reject. Emit `AUDIT_SEQUENCE_COLLISION` at CRITICAL." The claimed hash differs, so the
    // pre-read classifies it as a conflict rather than as a benign duplicate.
    const conflicting: JournalTransportRecord = {
      ...record,
      claimedRowHash: sha256(Buffer.concat([Buffer.from(record.claimedRowHash), Buffer.of(1)])),
    };
    return h.replication.ingress.ingest(conflicting);
  }

  it('PRODUCTION: `AUDIT_SEQUENCE_COLLISION`, no observation, no derivation', async () => {
    expect(await collide()).toBe('AUDIT_SEQUENCE_COLLISION');
    expect(await storeWriteFailures()).toHaveLength(0);
    const incidents = await auditIncidents(h.replication);
    expect(incidents.map((i) => i.kind)).toContain('AUDIT_SEQUENCE_COLLISION');
    const observation = await observeStall(h.auditEvaluator, COMPANY_ID, STALLED_AT);
    expect(observation?.reason).not.toBe('STORE_WRITE_REJECTED');
  });

  it('UNSAFE: the generic outcome mapper corroborates from it', async () => {
    expect(unsafeOutcomeMapper(await collide())).toBe('AUDIT_STORE_WRITE_UNAVAILABLE');
  });

  it('and a BENIGN duplicate is neither — `§5.7.1a` conjunct 7', async () => {
    const seq = await emitAttestation(h.control, COMPANY_ID, T0);
    const record = await transportRecordFor(h.replication, seq);
    expect(await h.replication.ingress.ingest(record)).toBe('ACCEPTED');
    expect(await h.replication.ingress.ingest(record)).toBe('AUDIT_PUSH_DUPLICATE');
    expect(await storeWriteFailures()).toHaveLength(0);
  });
});

// =====================================================================================
// `§8` C — CANONICAL / HASH MISMATCH
// =====================================================================================

describe('`§8` C — A CANONICAL OR HASH MISMATCH IS AN INTEGRITY INCIDENT', () => {
  async function malformed(): Promise<AuditIngestOutcome> {
    const seq = await emitAttestation(h.control, COMPANY_ID, T0);
    const record = await transportRecordFor(h.replication, seq);
    // The STRUCTURED field is changed and the transmitted bytes are not, so the audit
    // store's own `ACOS-JCS-1` recomputation from the structured columns disagrees with the
    // bytes that were sent. `I17`/`I41`, and `30 §5.3`: "the transmitted bytes are what is
    // hashed".
    const tampered = tamperStructuredField(
      record,
      { attestedRowCount: (record.fields.attestedRowCount ?? 0n) + 7n },
      Buffer.from(record.transmittedBytes),
    );
    return h.replication.ingress.ingest(tampered);
  }

  it('PRODUCTION: `AUDIT_CANONICAL_MISMATCH`, no observation, no derivation', async () => {
    const outcome = await malformed();
    expect(outcome).toBe('AUDIT_CANONICAL_MISMATCH');
    expect(await storeWriteFailures()).toHaveLength(0);
    const observation = await observeStall(h.auditEvaluator, COMPANY_ID, STALLED_AT);
    expect(observation?.reason).not.toBe('STORE_WRITE_REJECTED');
  });

  it('UNSAFE: the generic outcome mapper corroborates from it', async () => {
    expect(unsafeOutcomeMapper(await malformed())).toBe('AUDIT_STORE_WRITE_UNAVAILABLE');
  });

  it('AND THE ORDERING HOLDS UNDER THE INJECTION — the integrity check runs FIRST', async () => {
    // THE SHARPEST ASSERTION IN THIS FILE. With the store-write failure ALSO injected, a
    // malformed row must still produce `AUDIT_CANONICAL_MISMATCH` and NO observation —
    // because `audit_journal_chain` is a BEFORE INSERT trigger and fires before the injected
    // one. That is `§5.7.1a`'s conjunct ordering, asserted against real PostgreSQL rather
    // than argued from the source.
    await injectStoreWriteFailure('53100');
    const outcome = await malformed();
    expect(outcome).toBe('AUDIT_CANONICAL_MISMATCH');
    expect(await storeWriteFailures()).toHaveLength(0);
    expect((await observeStall(h.auditEvaluator, COMPANY_ID, T0))?.reason).not.toBe(
      'STORE_WRITE_REJECTED',
    );
  });

  it('and so does the QUOTA check — conjunct 8 before conjunct 10', async () => {
    // Same argument for the quota: the trigger that raises `ACS18` is the same BEFORE INSERT
    // trigger, so a saturated quota wins over an injected storage failure.
    await saturateQuota();
    await injectStoreWriteFailure('53100');
    const outcome = await pushOneRow(new Date(STALLED_AT.getTime() + 1000));
    expect(outcome).toBe('AUDIT_QUOTA_SATURATED');
    expect(await storeWriteFailures()).toHaveLength(0);
  });
});

// =====================================================================================
// `§8` D — UNKNOWN DATABASE ERROR
// =====================================================================================

describe('`§8` D — AN UNKNOWN DATABASE ERROR IS UNKNOWN, AND FAILS CLOSED', () => {
  it('PRODUCTION: an unenumerated SQLSTATE propagates and derives NOTHING', async () => {
    // `53200` (out_of_memory) is in the same PostgreSQL class as `53100` and is deliberately
    // NOT mapped: it is a server-process resource failure, not the storage layer being
    // unavailable for writes. So it is not handled, it propagates, and no observation exists.
    await injectStoreWriteFailure('53200');
    await expect(pushOneRow(T0)).rejects.toThrow();
    expect(await storeWriteFailures()).toHaveLength(0);
    expect((await observeStall(h.auditEvaluator, COMPANY_ID, T0))?.reason).not.toBe(
      'STORE_WRITE_REJECTED',
    );
  });

  it('PRODUCTION: and so does a wholly unknown code', async () => {
    await injectStoreWriteFailure('XX000');
    await expect(pushOneRow(T0)).rejects.toThrow();
    expect(await storeWriteFailures()).toHaveLength(0);
  });

  it('PRODUCTION: the TypeScript classifier says UNKNOWN for the propagated error', async () => {
    await injectStoreWriteFailure('53200');
    let thrown: unknown = null;
    try {
      await pushOneRow(T0);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).not.toBeNull();
    expect(classifyStoreWriteError(thrown)).toBe('UNKNOWN');
  });

  it('UNSAFE: both generic error mappers corroborate from it', async () => {
    await injectStoreWriteFailure('53200');
    let thrown: unknown = null;
    try {
      await pushOneRow(T0);
    } catch (error) {
      thrown = error;
    }
    // The no-list mapper.
    expect(unsafeErrorMapper(thrown)).toBe('AUDIT_STORE_WRITE_UNAVAILABLE');
    // And the fail-OPEN-on-class mapper, which is the subtler defect: it reads the SQLSTATE
    // and still admits `53200`, `40001`, `08006` and `25xxx` wholesale.
    expect(unsafeOpenEndedSqlstateMapper(thrown)).toBe('AUDIT_STORE_WRITE_UNAVAILABLE');
    expect(unsafeOpenEndedSqlstateMapper({ code: '40001' })).toBe(
      'AUDIT_STORE_WRITE_UNAVAILABLE',
    );
    expect(classifyStoreWriteError({ code: '40001' })).toBe('UNKNOWN');
  });
});

// =====================================================================================
// THE DERIVATION IS AUDIT-OWNED
// =====================================================================================

describe('the observation is AUDIT-OWNED — the control plane cannot reach it', () => {
  it('the replication principal can neither read, write nor record one', async () => {
    const client = await h.replication.audit.replication.connect();
    try {
      const who = await client.query<{ me: string }>('SELECT current_user AS me');
      expect(who.rows[0]!.me).toBe('acos_audit_replication');

      for (const sql of [
        'SELECT * FROM audit_store_write_failure',
        `INSERT INTO audit_store_write_failure
           (company_id, journal_seq, failure_class, sqlstate)
         VALUES ('x', 1, 'AUDIT_STORE_WRITE_UNAVAILABLE', '53100')`,
        'UPDATE audit_store_write_failure SET sqlstate = $$x$$',
        'DELETE FROM audit_store_write_failure',
        `SELECT audit_record_store_write_failure('x', 1, 'AUDIT_STORE_WRITE_UNAVAILABLE', '53100')`,
      ]) {
        await expect(client.query(sql), sql).rejects.toThrow();
      }
    } finally {
      client.release();
    }
  });

  it('and neither can the corroboration FETCH credential', async () => {
    const client = await h.auditReader.connect();
    try {
      await expect(client.query('SELECT * FROM audit_store_write_failure')).rejects.toThrow();
    } finally {
      client.release();
    }
  });

  it('the recorder REFUSES any class but the declared one', async () => {
    // The only write path, and it validates. So there is no argument through which a quota
    // saturation, a collision or a canonical mismatch could be recorded as a store failure.
    const client = await h.auditOwner.connect();
    try {
      for (const bogus of ['AUDIT_QUOTA_SATURATED', 'AUDIT_SEQUENCE_COLLISION', 'ANYTHING']) {
        await expect(
          client.query(`SELECT audit_record_store_write_failure($1, 1, $2, '53100')`, [
            COMPANY_ID,
            bogus,
          ]),
          bogus,
        ).rejects.toThrow(/STORE_WRITE_FAILURE_CLASS_NOT_DECLARED/);
      }
    } finally {
      client.release();
    }
  });

  it('and the observation table is APPEND-ONLY', async () => {
    await injectStoreWriteFailure('53100');
    await pushOneRow(T0);
    expect(await storeWriteFailures()).toHaveLength(1);

    const client = await h.auditOwner.connect();
    try {
      // `§5.7.1a` makes this the derivation's only operand, so a deletable row would be a
      // deletable corroboration basis.
      await expect(
        client.query('UPDATE audit_store_write_failure SET sqlstate = $1', ['58030']),
      ).rejects.toThrow(/APPEND_ONLY_TABLE_audit_store_write_failure/);
      await expect(client.query('DELETE FROM audit_store_write_failure')).rejects.toThrow(
        /APPEND_ONLY_TABLE_audit_store_write_failure/,
      );
    } finally {
      client.release();
    }
    expect(await storeWriteFailures()).toHaveLength(1);
  });
});
