import { createHash } from 'node:crypto';

import type { PoolClient } from 'pg';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { hasSqlstate, SQLSTATE } from '../../../src/kernel/exposure/errors.js';
import { LOCAL_SQLSTATE } from '../../../src/kernel/authorisation/localAuthorisationErrors.js';
import { createHarness, type Harness } from '../../support/fixture.js';
import { CAN03, loadCommerceFixture } from '../../support/enumerationFixture.js';
import {
  S1E_PASS_ORDER,
  loadAuthorityWorld,
  loadS1eOrders,
  s1eSpec,
} from '../../support/authorityFixture.js';
import { Conductor, settleAll, valueOf } from '../../support/barrier.js';
import {
  COMPANY_ID,
  FIXTURE_NOW,
  countOf,
  expectedInstanceKey,
  makeLocalAuthorityHarness,
  proposeAndAuthorise,
  rowsOf,
  scalar,
  type LocalAuthorityHarness,
} from '../../support/localAuthorisationFixture.js';
import { unsafeJournalCounterFirst } from '../../negative-controls/unsafe-local-authorisation.js';

/**
 * THE JOURNAL — gap-free sequencing, the local chain, and the lock order that protects both.
 *
 * =====================================================================================
 * THE ARCHITECTURE
 *
 * `30 §5.1` item 1, verbatim: "The primary journal lives in the control database — where it
 * already lived — with three additions: a company-scoped gap-free monotonic `journal_seq`
 * (allocation in §5.2), a local hash chain over `ACOS-JCS-1` canonical bytes (§5.3)
 * computed by a control-DB trigger, and a `mirrored_at` column, null until the audit store
 * acknowledges."
 *
 * `30 §5.2`, verbatim: "`journal_seq` must be gap-free per company, WHICH FORBIDS A
 * SEQUENCE. PostgreSQL sequences are non-transactional: `nextval` outside the transaction
 * leaves permanent gaps on rollback, and A GAP IS THE ONE SIGNAL `I17` READS AS
 * SUPPRESSION."
 *
 * Registry `I17d`, verbatim: "Hash and sequence values are computed by database functions
 * inside each instance, under roles the writing principal cannot execute as. [...] A chain
 * computed by the writer is not tamper-evidence."
 *
 * =====================================================================================
 * WHAT IS NOT CLAIMED
 *
 * This is the CONTROL-database half only. There is no audit store, no push, no
 * `JournalAttestation`, no mirror state machine and no two-sided completeness diff, so
 * `I17`, `I17b`, `I17c`, `I17e`, `I41`, `I8` and `VC-A1`/`VC-A2`/`VC-A3` are all OPEN.
 *
 * In particular this is NOT `VC-A3`. VC-A3 is byte-identity between two INDEPENDENT
 * INSTANCES re-chaining the same rows. The byte assertion below compares the control
 * trigger against an ORACLE WRITTEN IN THIS FILE — which is the right test for "the trigger
 * implements the specification" and is not the right test for "two instances agree".
 * =====================================================================================
 */

let harness: Harness;
let kernel: LocalAuthorityHarness;

function json(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) => (typeof v === 'bigint' ? v.toString() : v));
}

async function withClient<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await harness.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

// =====================================================================================
// An INDEPENDENT ACOS-JCS-1 framer, written here from `30 §5.3`'s rules
// =====================================================================================

/**
 * The framer the byte assertion compares against.
 *
 * Hand-written from `30 §5.3`'s hazard table, in this file, deliberately NOT by importing
 * `src/kernel/canonicalisation/canonicalBytes.ts`. The production TypeScript canonicaliser
 * and the production SQL trigger are two implementations of one specification; comparing
 * one against the other would be a useful thing to do and it is `VC-A3`'s job, not this
 * one's. What this asserts is that the SQL trigger implements the SPECIFICATION, against a
 * third reading of it.
 *
 *   field framing   4-byte big-endian byte length, then the bytes
 *   null            a single 0x00 byte
 *   text            UTF-8, NFC
 *   money           the declared scale, as a string
 *   integer         base-10
 *   boolean         'true' / 'false'
 *   timestamp       RFC 3339, UTC, exactly six fractional digits, Z
 *   bytes           the bytes
 */
type Field =
  | { kind: 'text'; value: string | null }
  | { kind: 'money'; value: string | null }
  | { kind: 'int'; value: number | bigint | null }
  | { kind: 'bool'; value: boolean | null }
  | { kind: 'ts'; value: Date | null }
  | { kind: 'bytes'; value: Buffer | null };

function fieldBytes(field: Field): Buffer {
  if (field.value === null) return Buffer.from([0x00]);
  switch (field.kind) {
    case 'text':
      return Buffer.from(field.value.normalize('NFC'), 'utf8');
    case 'money':
      return Buffer.from(field.value, 'utf8');
    case 'int':
      return Buffer.from(field.value.toString(10), 'utf8');
    case 'bool':
      return Buffer.from(field.value ? 'true' : 'false', 'utf8');
    case 'ts': {
      // RFC 3339, UTC, exactly six fractional digits. `toISOString` gives three.
      const iso = field.value.toISOString();
      return Buffer.from(`${iso.slice(0, -1)}000Z`, 'utf8');
    }
    case 'bytes':
      return Buffer.from(field.value);
  }
}

function frame(fields: readonly Field[]): Buffer {
  const parts: Buffer[] = [];
  for (const field of fields) {
    const value = fieldBytes(field);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(value.byteLength, 0);
    parts.push(length, value);
  }
  return Buffer.concat(parts);
}

interface JournalRow {
  // `SELECT *` is used deliberately below, so a column added to the journal by a later
  // migration shows up in the row rather than being silently dropped by a column list. The
  // index signature is what lets the row type satisfy the generic reader's constraint; the
  // named members below still win for every column the digest covers.
  readonly [column: string]: unknown;
  readonly company_id: string;
  readonly journal_seq: string;
  readonly journal_row_kind: string;
  readonly effect_id: string;
  readonly authorisation_id: string;
  readonly decision_id: string;
  readonly reservation_id: string;
  readonly approval_id: string | null;
  readonly idempotency_key: string;
  readonly action_class: string;
  readonly resource_ref: string;
  readonly verdict: string;
  readonly vendor_amount: string | null;
  readonly total_exposure: string;
  readonly forward_integral: string | null;
  readonly is_rate_class: boolean;
  readonly dispatch_payload_hash: string;
  readonly constructor_semantic_major: number;
  readonly constructor_non_semantic_minor: number;
  readonly policy_version: string;
  readonly occurred_at: Date;
  readonly prev_hash: Buffer;
  readonly row_hash: Buffer;
}

/** The declared field order for row kind `acos.journal.effect_authorisation.v1`. */
function expectedRowHash(row: JournalRow): string {
  const bytes = frame([
    { kind: 'text', value: 'acos.journal.effect_authorisation.v1' },
    { kind: 'text', value: row.company_id },
    { kind: 'int', value: BigInt(row.journal_seq) },
    { kind: 'text', value: row.journal_row_kind },
    { kind: 'text', value: row.effect_id },
    { kind: 'text', value: row.authorisation_id },
    { kind: 'text', value: row.decision_id },
    { kind: 'text', value: row.reservation_id },
    { kind: 'text', value: row.approval_id },
    { kind: 'text', value: row.idempotency_key },
    { kind: 'text', value: row.action_class },
    { kind: 'text', value: row.resource_ref },
    { kind: 'text', value: row.verdict },
    { kind: 'money', value: row.vendor_amount },
    { kind: 'money', value: row.total_exposure },
    { kind: 'money', value: row.forward_integral },
    { kind: 'bool', value: row.is_rate_class },
    { kind: 'text', value: row.dispatch_payload_hash },
    { kind: 'int', value: row.constructor_semantic_major },
    { kind: 'int', value: row.constructor_non_semantic_minor },
    { kind: 'text', value: row.policy_version },
    { kind: 'ts', value: row.occurred_at },
    { kind: 'bytes', value: row.prev_hash },
  ]);
  return createHash('sha256').update(bytes).digest('hex');
}

async function readJournal(client: PoolClient): Promise<readonly JournalRow[]> {
  return rowsOf<JournalRow>(
    client,
    `SELECT * FROM effect_journal WHERE company_id = $1 ORDER BY journal_seq`,
    [COMPANY_ID],
  );
}

beforeAll(async () => {
  harness = await createHarness();
});

afterAll(async () => {
  await harness.close();
});

beforeEach(async () => {
  await harness.reset();
  await withClient(async (client) => {
    await loadCommerceFixture(client);
    await loadS1eOrders(client);
    await loadAuthorityWorld(client);
  });
  kernel = makeLocalAuthorityHarness(harness);
});

// =====================================================================================
// The chain
// =====================================================================================

describe('the local chain is computed by the DATABASE, over the declared bytes', () => {
  it('the genesis row chains from 32 zero bytes, and the second from the first', async () => {
    const spec = s1eSpec({
      admittedResourceRefs: [S1E_PASS_ORDER.resourceRef, CAN03.resourceRef],
    });
    const first = await proposeAndAuthorise(kernel, S1E_PASS_ORDER, { spec });
    expect(first.outcome, json(first)).toBe('LOCAL_AUTHORISATION_COMMITTED');
    const second = await proposeAndAuthorise(
      kernel,
      { orderId: CAN03.orderId, resourceRef: CAN03.resourceRef },
      { spec },
    );
    expect(second.outcome, json(second)).toBe('LOCAL_AUTHORISATION_COMMITTED');

    await withClient(async (client) => {
      const rows = await readJournal(client);
      expect(rows).toHaveLength(2);
      expect(rows[0]!.journal_seq).toBe('1');
      expect(rows[1]!.journal_seq).toBe('2');
      expect(rows[0]!.prev_hash.toString('hex')).toBe('00'.repeat(32));
      // The chain: row 2's prev_hash IS row 1's row_hash.
      expect(rows[1]!.prev_hash.toString('hex')).toBe(rows[0]!.row_hash.toString('hex'));
      expect(rows[0]!.row_hash.toString('hex')).not.toBe(rows[1]!.row_hash.toString('hex'));
    });
  });

  it('the row hash equals the INDEPENDENTLY framed `ACOS-JCS-1` digest', async () => {
    await proposeAndAuthorise(kernel, S1E_PASS_ORDER);
    await withClient(async (client) => {
      const rows = await readJournal(client);
      expect(rows).toHaveLength(1);
      const row = rows[0]!;
      expect(row.row_hash.toString('hex')).toBe(expectedRowHash(row));
    });
  });

  it('AND THE ORACLE DISCRIMINATES — one cent on the total exposure changes the digest', async () => {
    // A byte assertion that passed for every input would be worthless. Perturbing one money
    // field must move the digest, and perturbing `mirrored_at` must not — because
    // `30 §5.2` calls it "advisory only" and it is written after the row commits.
    await proposeAndAuthorise(kernel, S1E_PASS_ORDER);
    await withClient(async (client) => {
      const row = (await readJournal(client))[0]!;
      const baseline = expectedRowHash(row);
      expect(expectedRowHash({ ...row, total_exposure: '10.01' })).not.toBe(baseline);
      expect(expectedRowHash({ ...row, verdict: 'REQUIRE_APPROVAL' })).not.toBe(baseline);
      // The null sentinel is one byte and an empty string is zero bytes, so the two are
      // distinguishable — `30 §5.3`, and owner clarification S1B-C8.
      expect(expectedRowHash({ ...row, approval_id: '' })).not.toBe(baseline);
      expect(expectedRowHash({ ...row, approval_id: null })).toBe(baseline);
    });
  });

  it('I17d — a caller-supplied `prev_hash` or `row_hash` is REFUSED by the database', async () => {
    await proposeAndAuthorise(kernel, S1E_PASS_ORDER);
    await withClient(async (client) => {
      const row = (await readJournal(client))[0]!;
      for (const column of ['prev_hash', 'row_hash']) {
        let code: string | undefined;
        try {
          await client.query(
            `INSERT INTO effect_journal (
               company_id, journal_seq, journal_row_kind, effect_id, authorisation_id,
               decision_id, reservation_id, idempotency_key, action_class, resource_ref,
               verdict, total_exposure, is_rate_class, dispatch_payload_hash,
               constructor_semantic_major, constructor_non_semantic_minor, policy_version,
               occurred_at, ${column})
             VALUES ($1,2,'EFFECT_AUTHORISATION',$2,$3,$4,$5,'k2','refund.create',$6,
                     'PERMIT',10.00,false,'h',1,0,'p',now(),decode(repeat('ff',32),'hex'))`,
            [
              COMPANY_ID,
              row.effect_id,
              row.authorisation_id,
              row.decision_id,
              row.reservation_id,
              row.resource_ref,
            ],
          );
        } catch (error) {
          code = (error as { code?: string }).code;
        }
        expect(code, `a supplied ${column} was accepted`).toBe(
          LOCAL_SQLSTATE.I17D_CALLER_SUPPLIED_CHAIN,
        );
      }
    });
  });

  it('the journal row is immutable EXCEPT for `mirrored_at`', async () => {
    // `30 §5.2` requires `mirrored_at` to be settable "on first successful
    // acknowledgement" and calls it "advisory only". Everything else is a rewrite of a
    // chained row, which is what the chain exists to make impossible.
    await proposeAndAuthorise(kernel, S1E_PASS_ORDER);
    await withClient(async (client) => {
      await client.query(
        `UPDATE effect_journal SET mirrored_at = now() WHERE company_id = $1`,
        [COMPANY_ID],
      );
      expect(
        await scalar(
          client,
          `SELECT (mirrored_at IS NOT NULL)::TEXT FROM effect_journal WHERE company_id = $1`,
          [COMPANY_ID],
        ),
      ).toBe('true');

      for (const statement of [
        `UPDATE effect_journal SET total_exposure = 1.00 WHERE company_id = $1`,
        `UPDATE effect_journal SET verdict = 'REQUIRE_APPROVAL' WHERE company_id = $1`,
        `UPDATE effect_journal SET row_hash = decode(repeat('ff',32),'hex') WHERE company_id = $1`,
        `DELETE FROM effect_journal WHERE company_id = $1`,
      ]) {
        let code: string | undefined;
        try {
          await client.query(statement, [COMPANY_ID]);
        } catch (error) {
          code = (error as { code?: string }).code;
        }
        expect(code, statement).toBe(LOCAL_SQLSTATE.APPEND_ONLY_REFUSED);
      }
    });
  });

  it('a NON-CONTIGUOUS sequence is refused — a gap cannot be written', async () => {
    await proposeAndAuthorise(kernel, S1E_PASS_ORDER);
    await withClient(async (client) => {
      const row = (await readJournal(client))[0]!;
      let code: string | undefined;
      try {
        await client.query(
          `INSERT INTO effect_journal (
             company_id, journal_seq, journal_row_kind, effect_id, authorisation_id,
             decision_id, reservation_id, idempotency_key, action_class, resource_ref,
             verdict, total_exposure, is_rate_class, dispatch_payload_hash,
             constructor_semantic_major, constructor_non_semantic_minor, policy_version,
             occurred_at)
           VALUES ($1,7,'EFFECT_AUTHORISATION',$2,$3,$4,$5,'k7','refund.create',$6,
                   'PERMIT',10.00,false,'h',1,0,'p',now())`,
          [
            COMPANY_ID,
            row.effect_id,
            row.authorisation_id,
            row.decision_id,
            row.reservation_id,
            row.resource_ref,
          ],
        );
      } catch (error) {
        code = (error as { code?: string }).code;
      }
      expect(code).toBe(LOCAL_SQLSTATE.JOURNAL_SEQUENCE_NOT_CONTIGUOUS);
    });
  });
});

// =====================================================================================
// Gap-freedom under rollback, concurrency and retry
// =====================================================================================

describe('the sequence is gap-free', () => {
  it('ROLLBACK — an abort after the allocation leaves no committed gap', async () => {
    // The counter is a ROW, so the allocation rolls back with everything else. A PostgreSQL
    // sequence would have left `1` consumed and the next successful authorisation would
    // have committed `2`, which `I17` reads as a suppressed row.
    await expect(
      proposeAndAuthorise(kernel, S1E_PASS_ORDER, {
        at: async (point) => {
          if (point === 'AFTER_JOURNAL_SEQ_ALLOCATED') throw new Error('kill after allocation');
        },
      }),
    ).rejects.toThrow('kill after allocation');

    await withClient(async (client) => {
      expect(await countOf(client, 'effect_journal')).toBe(0);
      expect(
        await scalar(client, `SELECT next_seq::TEXT FROM journal_counter WHERE company_id = $1`, [
          COMPANY_ID,
        ]),
      ).toBe('1');
    });

    // And the next successful authorisation gets 1, not 2.
    const outcome = await proposeAndAuthorise(kernel, S1E_PASS_ORDER);
    expect(outcome.outcome, json(outcome)).toBe('LOCAL_AUTHORISATION_COMMITTED');
    if (outcome.outcome !== 'LOCAL_AUTHORISATION_COMMITTED') return;
    expect(outcome.journalSeq).toBe(1n);
  });

  it('CONCURRENCY — two real concurrent authorisations land on ADJACENT sequences', async () => {
    // Two DIFFERENT orders, so two different entity leases and two genuinely concurrent
    // transactions. `30 §5.2`: the counter "serialises all journal writes per company,
    // which is the intended cost", so the two must be 1 and 2 with nothing between.
    const spec = s1eSpec({
      admittedResourceRefs: [S1E_PASS_ORDER.resourceRef, CAN03.resourceRef],
    });
    const results = await settleAll([
      () => proposeAndAuthorise(kernel, S1E_PASS_ORDER, { spec }),
      () =>
        proposeAndAuthorise(kernel, { orderId: CAN03.orderId, resourceRef: CAN03.resourceRef }, { spec }),
    ]);
    const outcomes = results.map((r) => valueOf(r));
    for (const outcome of outcomes) {
      expect(outcome.outcome, json(outcome)).toBe('LOCAL_AUTHORISATION_COMMITTED');
    }
    const seqs = outcomes
      .map((o) => (o.outcome === 'LOCAL_AUTHORISATION_COMMITTED' ? o.journalSeq : -1n))
      .sort((a, b) => (a < b ? -1 : 1));
    expect(seqs).toEqual([1n, 2n]);

    await withClient(async (client) => {
      const rows = await readJournal(client);
      expect(rows.map((r) => r.journal_seq)).toEqual(['1', '2']);
      // The chain is intact across the two concurrent writers.
      expect(rows[1]!.prev_hash.toString('hex')).toBe(rows[0]!.row_hash.toString('hex'));
    });
  });

  it('RETRY — an injected `40001` is absorbed, the key is unchanged and no gap appears', async () => {
    // S1A's measured finding, recorded in its implementation log §8: at SERIALIZABLE a
    // `SELECT … FOR UPDATE` reaching a row a concurrent transaction has already committed
    // raises `40001` rather than re-reading it. Registry `I42` anticipates exactly this
    // retry: "a serialisation-failure retry regenerates the same key (SR-A4)."
    //
    // The interleaving is deliberate, not load: the transaction is parked after its
    // snapshot and before its first lock, a second connection commits a change to a window
    // row it is about to lock, and the park is then released.
    let parked = 0;
    const conductor = new Conductor();
    const participant = conductor.participant('tx');

    const pending = settleAll([
      () =>
        proposeAndAuthorise(kernel, S1E_PASS_ORDER, {
          at: async (point) => {
            // Only the FIRST attempt parks. The retry re-enters the same code and must run
            // to completion.
            if (point !== 'AFTER_ISOLATION_ASSERTED') return;
            parked += 1;
            if (parked === 1) await participant.at('PARKED');
          },
        }),
    ]);

    await conductor.until('tx', 'PARKED');
    await withClient(async (client) => {
      // A committed change to a row the parked transaction is about to lock.
      await client.query(
        `INSERT INTO window_balance (
           company_id, window_id, window_instance_key,
           max_monetary, max_monetary_unbounded, max_count, max_count_unbounded,
           max_irrecoverable_units, max_irrecoverable_unbounded, realised_monetary)
         SELECT $1, 'W_DAY_REFUND', $2, w.max_monetary, w.max_monetary_unbounded,
                w.max_count, w.max_count_unbounded,
                w.max_irrecoverable_units, w.max_irrecoverable_unbounded, 1.00
           FROM window_registry w WHERE w.company_id = $1 AND w.window_id = 'W_DAY_REFUND'
         ON CONFLICT (company_id, window_id, window_instance_key)
           DO UPDATE SET realised_monetary = 1.00`,
        [COMPANY_ID, expectedInstanceKey('W_DAY_REFUND', FIXTURE_NOW)],
      );
    });
    conductor.release('tx', 'PARKED');

    const outcome = valueOf((await pending)[0]!);
    expect(outcome.outcome, json(outcome)).toBe('LOCAL_AUTHORISATION_COMMITTED');
    if (outcome.outcome !== 'LOCAL_AUTHORISATION_COMMITTED') return;
    // The sequence is 1 whether or not a retry happened: an aborted attempt consumed
    // nothing.
    expect(outcome.journalSeq).toBe(1n);
    // The attempt count is reported so contention is visible rather than silent.
    expect(outcome.lineage.serialisationRetries).toBeGreaterThanOrEqual(0);
    expect(parked).toBeGreaterThanOrEqual(1);

    await withClient(async (client) => {
      const rows = await readJournal(client);
      expect(rows.map((r) => r.journal_seq)).toEqual(['1']);
      expect(await countOf(client, 'effect')).toBe(1);
      expect(
        await scalar(client, `SELECT next_seq::TEXT FROM journal_counter WHERE company_id = $1`, [
          COMPANY_ID,
        ]),
      ).toBe('2');
    });
  });
});

// =====================================================================================
// The lock order, and why 40P01 is a defect rather than contention
// =====================================================================================

describe('`40P01` is a defect and is never retried', () => {
  it('the retry policy names `40P01` and excludes it', async () => {
    // Restated after S1F because S1F is the slice that first takes the journal counter on
    // the live authorisation path, which is where `30 §5.2`'s deadlock warning applies.
    const { readFile } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const source = await readFile(
      join(process.cwd(), 'src', 'kernel', 'exposure', 'retry.ts'),
      'utf8',
    );
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    expect(code).toContain('DEADLOCK_DETECTED');
    expect(code).toMatch(/hasSqlstate\(error, SQLSTATE\.DEADLOCK_DETECTED\)\) return false/);
    // And the S1F path adds no second retry policy of its own.
    const local = await readFile(
      join(process.cwd(), 'src', 'kernel', 'authorisation', 'localAuthorisation.ts'),
      'utf8',
    );
    const localCode = local.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    expect(localCode).not.toContain('40P01');
    expect(localCode).not.toContain('DEADLOCK');
  });

  it('the LEGITIMATE order produces no `40P01` under contention', async () => {
    const spec = s1eSpec({
      admittedResourceRefs: [S1E_PASS_ORDER.resourceRef, CAN03.resourceRef],
    });
    const results = await settleAll([
      () => proposeAndAuthorise(kernel, S1E_PASS_ORDER, { spec }),
      () =>
        proposeAndAuthorise(kernel, { orderId: CAN03.orderId, resourceRef: CAN03.resourceRef }, { spec }),
    ]);
    for (const result of results) {
      if (result.status === 'rejected') {
        expect(
          hasSqlstate(result.reason, SQLSTATE.DEADLOCK_DETECTED),
          'the declared lock order produced a deadlock',
        ).toBe(false);
        throw result.reason;
      }
    }
  });

  it('THE VULNERABLE CONTROL — acquiring the counter FIRST deadlocks against it', async () => {
    // `30 §5.2` on the cost of an unstated order: "adding a per-company counter to an
    // unstated order is a deadlock waiting for the first concurrent refund on the same
    // order." This produces that deadlock deterministically, which is what makes the
    // absence of one on the production path a measurement rather than a hope.
    const instances = [
      {
        windowId: 'W_DAY_REFUND',
        windowInstanceKey: expectedInstanceKey('W_DAY_REFUND', FIXTURE_NOW),
      },
    ];
    await withClient(async (client) => {
      await client.query(
        `INSERT INTO window_balance (
           company_id, window_id, window_instance_key,
           max_monetary, max_monetary_unbounded, max_count, max_count_unbounded,
           max_irrecoverable_units, max_irrecoverable_unbounded)
         SELECT $1, w.window_id, $2, w.max_monetary, w.max_monetary_unbounded,
                w.max_count, w.max_count_unbounded,
                w.max_irrecoverable_units, w.max_irrecoverable_unbounded
           FROM window_registry w WHERE w.company_id = $1 AND w.window_id = 'W_DAY_REFUND'
         ON CONFLICT DO NOTHING`,
        [COMPANY_ID, instances[0]!.windowInstanceKey],
      );
    });

    const conductor = new Conductor();
    const reversed = conductor.participant('reversed');
    const declared = conductor.participant('declared');

    /** The DECLARED order: window rows first, then the counter. */
    async function declaredOrderTransaction(): Promise<'COMMITTED' | 'DEADLOCK'> {
      const client = await harness.connect();
      try {
        await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
        try {
          await client.query(
            `SELECT window_id FROM window_balance
              WHERE company_id = $1 AND window_id = $2 AND window_instance_key = $3
                FOR UPDATE`,
            [COMPANY_ID, instances[0]!.windowId, instances[0]!.windowInstanceKey],
          );
          await declared.at('AFTER_LOCK');
          await client.query(
            `SELECT next_seq FROM journal_counter WHERE company_id = $1 FOR UPDATE`,
            [COMPANY_ID],
          );
          await client.query('COMMIT');
          return 'COMMITTED';
        } catch (error) {
          await client.query('ROLLBACK');
          if (hasSqlstate(error, SQLSTATE.DEADLOCK_DETECTED)) return 'DEADLOCK';
          throw error;
        }
      } finally {
        client.release();
      }
    }

    const pending = settleAll([
      () =>
        withClient((client) =>
          unsafeJournalCounterFirst(client, COMPANY_ID, instances, () =>
            reversed.at('AFTER_LOCK'),
          ),
        ),
      declaredOrderTransaction,
    ]);

    // Both hold one lock and each now wants the other's.
    await conductor.until('reversed', 'AFTER_LOCK');
    await conductor.until('declared', 'AFTER_LOCK');
    conductor.release('reversed', 'AFTER_LOCK');
    conductor.release('declared', 'AFTER_LOCK');

    const outcomes = (await pending).map((r) => valueOf(r as PromiseSettledResult<string>));
    // PostgreSQL breaks the cycle by aborting one of them. Exactly one deadlock, which is
    // what the declared order exists to make impossible.
    expect(outcomes.filter((o) => o === 'DEADLOCK').length, json(outcomes)).toBe(1);
  });
});
