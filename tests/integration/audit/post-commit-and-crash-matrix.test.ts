import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createPool } from '../../../src/db/pool.js';
import { auditIngress } from '../../../src/audit/ingress.js';
import { JournalPusher } from '../../../src/replication/journalPusher.js';
import { emitAttestation } from '../../../src/replication/attestation.js';
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
  auditRows,
  controlJournal,
  createReplicationFixture,
  transportRecordFor,
  type ReplicationFixture,
} from '../../support/replicationFixture.js';

/**
 * POST-COMMIT ONLY, THE CRASH MATRIX, AND THE DURABLE BACKLOG. S1G.
 *
 * =================================================================================
 * `30 §5.1`, THE SENTENCE THIS FILE EXISTS TO ENFORCE
 *
 *   "Cross-database atomicity is not attempted, because it does not exist. What replaces
 *    it is a gap-free local sequence the audit store can prove it has all of. A missing
 *    `journal_seq` has exactly one interpretation."
 *
 * And the ordering block it appears in puts the push strictly AFTER `COMMIT`.
 *
 * THE PROPERTY THAT MATTERS MOST, stated once: an audit failure of ANY kind, at ANY point,
 * must NEVER remove a committed local authorisation. Every case below asserts it.
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
});

async function authoriseTwo(): Promise<void> {
  const spec = s1eSpec({ admittedResourceRefs: [S1E_PASS_ORDER.resourceRef, CAN03.resourceRef] });
  await proposeAndAuthorise(kernel, S1E_PASS_ORDER, { spec });
  await proposeAndAuthorise(kernel, CAN03, { spec });
}

/** The state of BOTH stores, read directly, at whatever point a test has reached. */
async function snapshot(): Promise<{
  controlRows: number;
  auditRows: number;
  mirrored: (Date | null)[];
  effects: number;
  reservations: number;
}> {
  const control = await controlJournal(fixture);
  const held = await auditRows(fixture);
  const client = await fixture.control.connect();
  try {
    const effects = await client.query<{ n: string }>(`SELECT count(*) AS n FROM effect`);
    const reservations = await client.query<{ n: string }>(
      `SELECT count(*) AS n FROM exposure_reservation`,
    );
    return {
      controlRows: control.length,
      auditRows: held.length,
      mirrored: control.map((r) => r.mirrored_at),
      effects: Number(effects.rows[0]!.n),
      reservations: Number(reservations.rows[0]!.n),
    };
  } finally {
    client.release();
  }
}

// =====================================================================================
// The ordering itself.
// =====================================================================================

describe('the push happens strictly AFTER the S1F commit', () => {
  it('a committed authorisation exists in the control database BEFORE any audit row does', async () => {
    let auditRowsAtCommit = -1;
    await authoriseTwo();

    // At this instant the S1F transaction has committed and NO push has run.
    const afterCommit = await snapshot();
    expect(afterCommit.controlRows).toBe(2);
    expect(afterCommit.auditRows).toBe(0);
    expect(afterCommit.effects).toBe(2);

    const pusher = fixture.pusher({
      async afterCommitBeforePush(seq) {
        // The FIRST row only: by the time the second is pushed the store legitimately
        // holds the first, and the property under test is about the ordering of the very
        // first audit write against a commit that already happened.
        if (seq === 1n) auditRowsAtCommit = (await auditRows(fixture)).length;
      },
    });
    await pusher.pushPending(COMPANY_ID);
    expect(auditRowsAtCommit).toBe(0);
    expect((await snapshot()).auditRows).toBe(2);
  });

  it('THE VULNERABLE CONTROL: attempting audit insertion inside the control transaction', async () => {
    // `§13` requires a TEST-ONLY implementation that tries to make the two stores atomic,
    // and a demonstration of why the claim cannot be made.
    //
    // The attempt: open a control transaction, insert into the AUDIT store on its own
    // connection, then ROLL THE CONTROL TRANSACTION BACK. If cross-database atomicity
    // existed, the audit row would vanish with it.
    await authoriseTwo();
    const record = await transportRecordFor(fixture, 1n);

    const controlClient = await fixture.control.connect();
    try {
      await controlClient.query('BEGIN');
      await controlClient.query(
        `UPDATE effect_journal SET mirrored_at = now()
          WHERE company_id = $1 AND journal_seq = 1`,
        [COMPANY_ID],
      );
      // The "enlisted" audit write — on a DIFFERENT server, in its OWN transaction.
      await fixture.ingress.ingest(record);
      await controlClient.query('ROLLBACK');
    } finally {
      controlClient.release();
    }

    // The control write is gone. The audit write is NOT. There is no atom here, and no
    // amount of wrapper code can make one — which is exactly `30 §5.1`'s "it does not
    // exist", demonstrated rather than asserted.
    const control = await controlJournal(fixture);
    expect(control[0]!.mirrored_at).toBeNull();
    expect(await auditRows(fixture)).toHaveLength(1);
  });

  it('the production pusher never opens a control transaction around an audit call', async () => {
    const source = await readFile(
      join(process.cwd(), 'src', 'replication', 'journalPusher.ts'),
      'utf8',
    );
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    // No transaction control at all on the control side of the pusher: the backlog read is
    // a single statement and the advisory update is a single statement.
    expect(code).not.toContain('BEGIN');
    expect(code).not.toContain('inTransaction');
    expect(code).not.toContain('COMMIT');
    expect(code).not.toContain('ROLLBACK');
    // And no two-phase commit anywhere in the slice.
    expect(code).not.toContain('PREPARE TRANSACTION');
  });

  it('no module in the slice attempts a distributed transaction', async () => {
    for (const file of [
      join('src', 'replication', 'journalPusher.ts'),
      join('src', 'replication', 'attestation.ts'),
      join('src', 'audit', 'ingress.ts'),
      join('src', 'audit', 'transportCompleteness.ts'),
    ]) {
      const source = await readFile(join(process.cwd(), file), 'utf8');
      expect(source, file).not.toContain('PREPARE TRANSACTION');
      expect(source, file).not.toContain('COMMIT PREPARED');
      expect(source, file).not.toContain('2PC');
    }
  });
});

// =====================================================================================
// `§13` and `§27` — the kill points, one at a time.
// =====================================================================================

describe('the crash matrix — every boundary, against both real databases', () => {
  it('1. after the local COMMIT, before the push', async () => {
    await authoriseTwo();
    const pusher = fixture.pusher({
      afterCommitBeforePush() {
        throw new Error('KILL: after commit, before push');
      },
    });
    await expect(pusher.pushPending(COMPANY_ID)).rejects.toThrow('KILL');

    const state = await snapshot();
    expect(state.controlRows).toBe(2); // the authorisation SURVIVES
    expect(state.effects).toBe(2);
    expect(state.auditRows).toBe(0);
    expect(state.mirrored).toEqual([null, null]);

    // And it is fully recoverable: a new pusher finishes the work.
    await fixture.pusher().pushPending(COMPANY_ID);
    expect((await snapshot()).auditRows).toBe(2);
  });

  it('2. the audit store is UNREACHABLE before the insert', async () => {
    await authoriseTwo();
    // A pool pointed at a port nothing is listening on. Real connection failure, not a
    // stub: the audit plane is genuinely absent.
    const unreachable = createPool({
      connectionString: 'postgres://acos:acos_local_dev@127.0.0.1:1/acos_audit',
      max: 1,
      applicationName: 'acos-s1g-unreachable',
    });
    const pusher = new JournalPusher(fixture.control.pool, auditIngress(unreachable));
    await expect(pusher.pushPending(COMPANY_ID)).rejects.toThrow();
    await unreachable.end();

    const state = await snapshot();
    // THE LOCAL AUTHORISATION IS DURABLE WITH THE AUDIT PLANE ENTIRELY ABSENT.
    expect(state.controlRows).toBe(2);
    expect(state.effects).toBe(2);
    expect(state.reservations).toBe(2);
    expect(state.auditRows).toBe(0);
  });

  it('3. the audit transaction begins and then aborts', async () => {
    await authoriseTwo();
    const record = await transportRecordFor(fixture, 1n);
    const client = await fixture.audit.replication.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `SELECT audit_ingest_journal_row($1,$2::BIGINT,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,
           $13::NUMERIC,$14::NUMERIC,$15::NUMERIC,$16::BOOLEAN,$17,$18::INTEGER,$19::INTEGER,
           $20,$21::BIGINT,$22::BIGINT,$23::BYTEA,$24::TIMESTAMPTZ,$25::BYTEA,$26::BYTEA,$27::BYTEA)`,
        bindRecord(record),
      );
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }

    // The audit store holds nothing, the control plane is untouched, and the row is still
    // in the backlog.
    expect(await auditRows(fixture)).toHaveLength(0);
    expect((await snapshot()).controlRows).toBe(2);
    const run = await fixture.pusher().pushPending(COMPANY_ID);
    expect(run.pushed.map((p) => p.outcome)).toEqual(['ACCEPTED', 'ACCEPTED']);
  });

  it('4. the audit COMMITS and the ACK is lost — no duplicate on retry', async () => {
    await authoriseTwo();
    let dropped = false;
    const pusher = fixture.pusher({
      afterIngestBeforeAck(seq) {
        if (seq === 1n && !dropped) {
          dropped = true;
          throw new Error('KILL: ack lost');
        }
      },
    });
    await expect(pusher.pushPending(COMPANY_ID)).rejects.toThrow('KILL');

    expect(await auditRows(fixture)).toHaveLength(1);
    expect((await controlJournal(fixture))[0]!.mirrored_at).toBeNull();

    await fixture.pusher().pushPending(COMPANY_ID);
    // Two rows total, not three. The chain advanced exactly twice.
    const held = await auditRows(fixture);
    expect(held).toHaveLength(2);
    expect(held.map((r) => r.chain_seq)).toEqual(['1', '2']);
  });

  it('6. the control plane crashes before `mirrored_at`, and recovery is clean', async () => {
    await authoriseTwo();
    const pusher = fixture.pusher({
      afterAckBeforeMirroredAt(seq) {
        if (seq === 1n) throw new Error('KILL: before mirrored_at');
      },
    });
    await expect(pusher.pushPending(COMPANY_ID)).rejects.toThrow('KILL');

    const control = await controlJournal(fixture);
    expect(control[0]!.mirrored_at).toBeNull(); // apparently unmirrored
    expect(await auditRows(fixture)).toHaveLength(1); // but the audit store HAS it

    // `§12`'s required sequence: re-push, benign duplicate, advisory timestamp recorded,
    // no critical incident, no duplicate chain row.
    const run = await fixture.pusher().pushPending(COMPANY_ID);
    expect(run.pushed[0]!.outcome).toBe('AUDIT_PUSH_DUPLICATE');
    expect((await controlJournal(fixture))[0]!.mirrored_at).not.toBeNull();
    expect(await auditRows(fixture)).toHaveLength(2);
  });

  it('7. `mirrored_at` fails PERMANENTLY, and the audit invariant stays evaluable', async () => {
    await authoriseTwo();
    // The advisory update is refused for good — modelled by revoking the control plane's
    // ability to perform it, via the journal's own immutability trigger on a value that is
    // not `mirrored_at`. Here the simpler and more honest model: the pusher's update
    // matches zero rows because the column is already set by something else.
    const client = await fixture.control.connect();
    try {
      await client.query(
        `UPDATE effect_journal SET mirrored_at = now() WHERE company_id = $1`,
        [COMPANY_ID],
      );
    } finally {
      client.release();
    }

    // The control plane now believes BOTH rows are mirrored. NOTHING IS.
    expect(await auditRows(fixture)).toHaveLength(0);
    const run = await fixture.pusher().pushPending(COMPANY_ID);
    expect(run.pushed).toEqual([]); // the backlog is empty, because the column lied

    // AND THE AUDIT INVARIANT IS STILL EVALUABLE, because it never reads that column: the
    // audit store simply holds nothing, which `vc-a1-transport-loss.test.ts` shows the
    // attestation check detecting. `mirrored_at` moved nothing about correctness.
    expect(await auditRows(fixture)).toHaveLength(0);
  });
});

// =====================================================================================
// `§14` — the durable backlog survives the pusher.
// =====================================================================================

describe('the retry source is PostgreSQL, not an in-memory queue', () => {
  it('a destroyed and recreated pusher rediscovers its work and finishes without duplicates', async () => {
    await authoriseTwo();
    await emitAttestation(fixture.control.pool, COMPANY_ID, new Date('2026-01-05T00:05:00Z'));
    await emitAttestation(fixture.control.pool, COMPANY_ID, new Date('2026-01-05T00:10:00Z'));
    expect((await controlJournal(fixture))).toHaveLength(4);

    // Replicate a PREFIX only, then throw the pusher away entirely.
    let first: JournalPusher | null = fixture.pusher({
      afterMirroredAt(seq) {
        if (seq === 2n) throw new Error('PROCESS DIES');
      },
    });
    await expect(first.pushPending(COMPANY_ID)).rejects.toThrow('PROCESS DIES');
    first = null;
    expect(await auditRows(fixture)).toHaveLength(2);

    // A COMPLETELY NEW pusher, with no memory of anything, on new pools.
    const control = createPool({
      connectionString: fixture.control.url,
      max: 4,
      applicationName: 'acos-s1g-restarted',
    });
    const auditPool = createPool({
      connectionString: fixture.audit.url.replace(
        '//acos:acos_local_dev@',
        '//acos_audit_replication:acos_audit_repl_dev@',
      ),
      max: 4,
      applicationName: 'acos-s1g-restarted-audit',
    });
    try {
      const restarted = new JournalPusher(control, auditIngress(auditPool));
      const run = await restarted.pushPending(COMPANY_ID);
      // It found EXACTLY the unacknowledged remainder, from durable state.
      expect(run.pushed.map((p) => p.journalSeq)).toEqual([3n, 4n]);
      expect(run.pushed.map((p) => p.outcome)).toEqual(['ACCEPTED', 'ACCEPTED']);
    } finally {
      await control.end();
      await auditPool.end();
    }

    const held = await auditRows(fixture);
    expect(held.map((r) => r.journal_seq)).toEqual(['1', '2', '3', '4']);
    expect(held.map((r) => r.chain_seq)).toEqual(['1', '2', '3', '4']);
  });

  it('the backlog query names `effect_journal` and `mirrored_at IS NULL`, and no outbox exists', async () => {
    const source = await readFile(
      join(process.cwd(), 'src', 'replication', 'journalPusher.ts'),
      'utf8',
    );
    expect(source).toContain('mirrored_at IS NULL');
    expect(source).toContain('FROM effect_journal');
    // `37` S4 owns the outbox and `25 §7` layer 4 owns the exclusive claim (`I36`). S1G
    // introduces neither: no second queue, and no `CLAIMED` state on anything.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    expect(code.toLowerCase()).not.toContain('outbox');
    expect(code).not.toMatch(/CLAIMED/);
    expect(code).not.toContain('FOR UPDATE');
    expect(code).not.toContain('SKIP LOCKED');
  });
});

function bindRecord(record: Awaited<ReturnType<typeof transportRecordFor>>): unknown[] {
  const f = record.fields;
  return [
    f.companyId,
    f.journalSeq.toString(),
    f.journalRowKind,
    f.effectId,
    f.authorisationId,
    f.decisionId,
    f.reservationId,
    f.approvalId,
    f.idempotencyKey,
    f.actionClass,
    f.resourceRef,
    f.verdict,
    f.vendorAmount,
    f.totalExposure,
    f.forwardIntegral,
    f.isRateClass,
    f.dispatchPayloadHash,
    f.constructorSemanticMajor,
    f.constructorNonSemanticMinor,
    f.policyVersion,
    f.attestedMaxJournalSeq === null ? null : f.attestedMaxJournalSeq.toString(),
    f.attestedRowCount === null ? null : f.attestedRowCount.toString(),
    f.attestedHeadHash === null ? null : Buffer.from(f.attestedHeadHash),
    f.occurredAt,
    f.prevHash === null ? null : Buffer.from(f.prevHash),
    Buffer.from(record.claimedRowHash),
    Buffer.from(record.transmittedBytes),
  ];
}
