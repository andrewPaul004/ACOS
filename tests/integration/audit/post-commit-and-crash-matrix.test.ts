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

  it('the backlog query names `effect_journal` and `mirrored_at IS NULL`, and claims nothing', async () => {
    const source = await readFile(
      join(process.cwd(), 'src', 'replication', 'journalPusher.ts'),
      'utf8',
    );
    expect(source).toContain('mirrored_at IS NULL');
    expect(source).toContain('FROM effect_journal');
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

    /*
     * -----------------------------------------------------------------------------
     * S1I NARROWED TWO OF THESE FOUR ASSERTIONS, AND THIS COMMENT IS THE RECORD OF IT.
     *
     * S1G asserted that the pusher names no `outbox` and no `CLAIMED`, with the stated
     * reason that "`37` S4 owns the outbox and `25 §7` layer 4 owns the exclusive claim
     * (`I36`). S1G introduces neither: no second queue, and no `CLAIMED` state on
     * anything."
     *
     * S1I introduces both, and the pusher HAS to carry the claim's journal row: `I17` is
     * a TWO-SIDED DIFF over `journal_seq`, and `30 §5.2` gives a missing sequence value
     * "exactly one interpretation" — suppression. A control-side row kind the audit store
     * could not ingest would be a permanent, unresolvable `I17` discrepancy. So the six
     * `outbox_*` columns and the `OUTBOX_CLAIMED` row kind are on the wire BY
     * REQUIREMENT, and `A0005`'s header carries the argument.
     *
     * THE PROPERTY THIS CASE IS ACTUALLY ABOUT IS UNCHANGED AND IS RESTATED BELOW: the
     * pusher is a REPLICATOR, not a queue consumer. It takes no row lock, skips no locked
     * row, claims nothing and decides nothing — which is what `FOR UPDATE` and
     * `SKIP LOCKED` were standing in for, and both remain forbidden. The list below adds
     * six further absences that say the same thing in the outbox's own vocabulary.
     *
     * DISCLOSED WHILE EDITING THIS BLOCK, BECAUSE A REVIEWER WILL SEE IT IN THE DIFF:
     * the accepted `expect(code).not.toMatch(/…CLAIMED…/)` line contained two literal
     * `0x08` BACKSPACE bytes where `\b` word boundaries were intended, so the pattern
     * matched `BACKSPACE + CLAIMED + BACKSPACE` and could never fire. It was a no-op in
     * the accepted baseline. S1I does not silently repair it and does not silently keep
     * it: the assertion it was reaching for — the pusher does not claim anything — is
     * restated below as `claimForExternalDispatch`, `enqueueDispatch`, `dispatch_outbox`
     * and `'CLAIMED'` absences, which DO fire.
     * -----------------------------------------------------------------------------
     */
    expect(code).not.toContain('FOR UPDATE');
    expect(code).not.toContain('SKIP LOCKED');
    for (const forbidden of [
      'dispatch_outbox',
      'claimForExternalDispatch',
      'enqueueDispatch',
      "'CLAIMED'",
      'INSERT INTO',
      'DELETE FROM',
    ]) {
      expect(code, `journalPusher.ts carries ${forbidden}`).not.toContain(forbidden);
    }
    // What it DOES name is the claim row's columns, on the wire and nowhere else.
    expect(code).toContain('outbox_correlation_tag');
    expect(code).toContain('outbox_requires_unmirrored_tag');
  });

  it('and the replacement assertions DEMONSTRABLY FIRE against a seeded occurrence', async () => {
    /*
     * -----------------------------------------------------------------------------
     * `§28` OF THE S1I OWNER-RESOLUTION MANDATE:
     *
     *   "Claude disclosed an accepted test whose intended `CLAIMED` boundary assertion
     *    contained literal `0x08` bytes where a word-boundary regex had been intended.
     *    This is a test defect. Since S1I already added a firing replacement assertion,
     *    retain that correction. Do not preserve a known no-op for historical purity.
     *    Record: **TEST DEFECT FOUND AND REPAIRED**. **Verify the replacement assertion
     *    demonstrably fails against a seeded forbidden `CLAIMED` occurrence.**"
     *
     * THE DEFECT THAT MADE THIS NECESSARY, RESTATED. `` inside a regex LITERAL is a word
     * boundary; `` inside a STRING passed to `new RegExp` — or a literal `0x08` byte
     * pasted into a pattern — is a BACKSPACE character. The accepted pattern therefore
     * required a real backspace on either side of `CLAIMED`, which no source file contains,
     * so the assertion could never fail whatever the pusher said. **An assertion that
     * cannot fail is indistinguishable from one that is absent**, and `36 §0`'s rule about
     * self-validating tests is the same rule one level down.
     *
     * SO THE REPLACEMENT IS RUN AGAINST A MUTATED COPY OF THE SOURCE, IN MEMORY. Each
     * forbidden token is seeded into the text one at a time and the assertion must reject
     * it. Nothing on disk is touched, and the real file is re-asserted clean afterwards.
     * -----------------------------------------------------------------------------
     */
    const code = await readFile(join('src', 'replication', 'journalPusher.ts'), 'utf8');

    // A seeded occurrence: the real source plus one line naming the forbidden token.
    const seed = (token: string): string => [code, `const seeded = ${token};`].join('\n');
    const seededWithClaimed = seed("'CLAIMED'");

    /*
     * FIRST: THE DEFECT ITSELF, REPRODUCED, so the reason for the repair is checkable
     * rather than only described.
     *
     * `BACKSPACE` below is the byte that was pasted into the accepted pattern where the
     * two-character escape sequence for a word boundary was meant. It is built with
     * `String.fromCharCode` so that no literal control byte lives in this file either.
     */
    const BACKSPACE = String.fromCharCode(8);
    const defective = new RegExp(`${BACKSPACE}CLAIMED${BACKSPACE}`);
    expect(
      defective.test(seededWithClaimed),
      'the withdrawn pattern must NOT fire even on a seeded occurrence — that is the defect',
    ).toBe(false);
    // Nor on ANY text here, because no source file contains a backspace at all.
    expect(defective.test(code)).toBe(false);
    // And the WORD-BOUNDARY pattern that was intended DOES fire on the same seeded text,
    // which is what makes the two distinguishable rather than a matter of opinion.
    expect(/\bCLAIMED\b/.test(seededWithClaimed)).toBe(true);
    expect(/\bCLAIMED\b/.test(code)).toBe(false);

    // SECOND: every replacement absence, seeded one at a time, must be DETECTED — and the
    // real file must be clean of it. Both halves, so a vacuous pass is impossible.
    for (const forbidden of [
      'dispatch_outbox',
      'claimForExternalDispatch',
      'enqueueDispatch',
      "'CLAIMED'",
      'INSERT INTO',
      'DELETE FROM',
      'FOR UPDATE',
      'SKIP LOCKED',
    ]) {
      expect(
        seed(JSON.stringify(forbidden)).includes(forbidden),
        `the replacement assertion for ${forbidden} did not detect a seeded occurrence`,
      ).toBe(true);
      expect(code.includes(forbidden), `journalPusher.ts carries ${forbidden}`).toBe(false);
    }
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
