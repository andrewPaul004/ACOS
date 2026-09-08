import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { PoolClient } from 'pg';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { projectLocalAuthorisationToWorker } from '../../../src/kernel/authorisation/workerFacingLocalDenial.js';
import { hasSqlstate } from '../../../src/kernel/exposure/errors.js';
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
  EXPECTED_REFUND_WINDOWS,
  FIXTURE_NOW,
  S1F_EXPECTED,
  countOf,
  expectedInstanceKey,
  makeLocalAuthorityHarness,
  proposeAndAuthorise,
  rowsOf,
  scalar,
  type LocalAuthorityHarness,
} from '../../support/localAuthorisationFixture.js';
import { unsafeDuplicateCheckBySelect } from '../../negative-controls/unsafe-local-authorisation.js';
import { money } from '../../../src/kernel/exposure/money.js';

/**
 * LOCAL IDEMPOTENCY — `26 §7` steps T–V, and registry `I42`'s DATABASE half.
 *
 * =====================================================================================
 * WHAT IS CLAIMED, AND WHAT IS NOT
 *
 * `25 §7`'s table declares FOUR idempotency layers. S1F closes ONE of them:
 *
 *   ingress          platform event id                        — S2, not built
 *   work item        (trigger_ref, task_type)                  — not built
 *   EFFECT           H(task_id ‖ class ‖ resource ‖ digest)     — **THIS SLICE**
 *   outbox claim     the same key, unique, claimed pre-dispatch — not built (I36)
 *
 * So what this suite proves is that a duplicate proposal cannot create a second EFFECT ROW
 * and cannot consume exposure twice IN THIS DATABASE. It does not prove external
 * exactly-once, and no assertion here claims it: `25 §7` is explicit that duplicate
 * prevention at the dispatch boundary "rests on vendor idempotency, a vendor query, or the
 * outbox claim", none of which exists after S1F.
 *
 * =====================================================================================
 * THE ARCHITECTURE MAPPING, RECORDED
 *
 * `26 §7` places the check at T–V — AFTER step R — and property 8 says why: "so a duplicate
 * proposal returns the prior result and the reservation is released rather than
 * double-counted."
 *
 * `33 §6` places the enforcement in the SCHEMA: "`effects` primary key includes the
 * idempotency key with a unique constraint (I42), so a duplicate proposal cannot create a
 * second row even if every layer above it fails."
 *
 * Registry `I42`'s enforcement column is "DB (unique constraint)" and its test column
 * requires: "assert `journal_seq` is not an input to the key, so a serialisation-failure
 * retry regenerates the same key (SR-A4)."
 *
 * `I42` is therefore IN SCOPE for S1F: the transaction that reserves is the transaction the
 * unique constraint lives in.
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

async function preloadRealised(
  client: PoolClient,
  windowId: string,
  realised: string,
): Promise<void> {
  const key = expectedInstanceKey(windowId, FIXTURE_NOW);
  await client.query(
    `INSERT INTO window_balance (
       company_id, window_id, window_instance_key,
       max_monetary, max_monetary_unbounded, max_count, max_count_unbounded,
       max_irrecoverable_units, max_irrecoverable_unbounded, realised_monetary)
     SELECT $1, $2, $3, w.max_monetary, w.max_monetary_unbounded,
            w.max_count, w.max_count_unbounded,
            w.max_irrecoverable_units, w.max_irrecoverable_unbounded, $4::NUMERIC
       FROM window_registry w WHERE w.company_id = $1 AND w.window_id = $2
     ON CONFLICT (company_id, window_id, window_instance_key)
       DO UPDATE SET realised_monetary = $4::NUMERIC`,
    [COMPANY_ID, windowId, key, realised],
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
// The key itself
// =====================================================================================

describe('the key is deterministic and `journal_seq` is not one of its inputs', () => {
  it('SR-A4 — no clock, no random source and no sequence read reaches the key function', async () => {
    // `24 §3` K4: the key is "never a random UUID, and never including `journal_seq`, which
    // is allocated after the key is computed". The ACCEPTED S1B suite asserts the source
    // property; this restates it after S1F introduced a sequence ALLOCATOR next door, which
    // is exactly when the temptation `30 §5.2` warns about ("the sequence is new and the
    // temptation is obvious") arrives.
    const source = await readFile(
      join(process.cwd(), 'src', 'kernel', 'canonicalisation', 'idempotency.ts'),
      'utf8',
    );
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    for (const forbidden of [
      'journal_seq',
      'journalSeq',
      'journal_counter',
      'allocateJournalSeq',
      'Date.now',
      'new Date',
      'randomUUID',
      'randomBytes',
      'Math.random',
      'attempt',
      'retry',
    ]) {
      expect(code, `idempotency.ts reads ${forbidden}`).not.toContain(forbidden);
    }
  });

  it('the SAME intent submitted twice produces the SAME key — read from the committed rows', async () => {
    const first = await proposeAndAuthorise(kernel, S1E_PASS_ORDER);
    expect(first.outcome, json(first)).toBe('LOCAL_AUTHORISATION_COMMITTED');
    if (first.outcome !== 'LOCAL_AUTHORISATION_COMMITTED') return;

    const key = await withClient((client) =>
      scalar(client, `SELECT idempotency_key FROM effect WHERE effect_id = $1`, [first.effectId]),
    );
    expect(key).not.toBeNull();

    // The second submission carries a DIFFERENT kernel-allocated authorisation reference —
    // so a different authorisation id, a different reservation id and a different effect id
    // are all attempted — and still collides, because the key is a function of the INTENT
    // and not of the attempt.
    const second = await proposeAndAuthorise(kernel, S1E_PASS_ORDER);
    expect(second.outcome, json(second)).toBe('DUPLICATE_PRIOR_RESULT');
    if (second.outcome !== 'DUPLICATE_PRIOR_RESULT') return;
    expect(second.priorEffectId).toBe(first.effectId);
    expect(second.priorAuthorisationId).toBe(first.authorisationId);
    expect(second.priorDecisionId).toBe(first.decisionId);
    expect(second.priorReservationId).toBe(first.reservationId);
    expect(second.priorJournalSeq).toBe(1n);
    // Step V ran; step W did not.
    expect(second.lineage.localStepsEvaluated).toEqual(['R', 'S', 'T', 'U', 'V']);
  });

  it('a SEMANTICALLY DISTINCT effect does NOT collide', async () => {
    // A different resource is a different `resource_id` and a different
    // `semantic_param_digest`, so a different key. Without this the suite would be
    // compatible with a key that collided for everything.
    const spec = s1eSpec({
      admittedResourceRefs: [S1E_PASS_ORDER.resourceRef, CAN03.resourceRef],
    });
    const first = await proposeAndAuthorise(kernel, S1E_PASS_ORDER, { spec });
    expect(first.outcome, json(first)).toBe('LOCAL_AUTHORISATION_COMMITTED');

    const other = await proposeAndAuthorise(
      kernel,
      // CAN03 is the ACCEPTED S1C order; `loadAuthorityWorld` seeds its precondition fact.
      { ...S1E_PASS_ORDER, orderId: CAN03.orderId, resourceRef: CAN03.resourceRef },
      { spec },
    );
    expect(other.outcome, json(other)).toBe('LOCAL_AUTHORISATION_COMMITTED');
    if (other.outcome !== 'LOCAL_AUTHORISATION_COMMITTED') return;
    // Two effects, two reservations, two journal rows with ADJACENT sequences.
    expect(other.journalSeq).toBe(2n);
    await withClient(async (client) => {
      expect(await countOf(client, 'effect')).toBe(2);
      expect(await countOf(client, 'exposure_reservation')).toBe(2);
      expect(await countOf(client, 'effect_journal')).toBe(2);
      const keys = await rowsOf<{ idempotency_key: string }>(
        client,
        `SELECT idempotency_key FROM effect WHERE company_id = $1`,
        [COMPANY_ID],
      );
      expect(new Set(keys.map((r) => r.idempotency_key)).size).toBe(2);
    });
  });
});

// =====================================================================================
// A duplicate cannot consume exposure twice
// =====================================================================================

describe('a duplicate does not double-consume exposure', () => {
  it('after the duplicate, `reserved_monetary` is still ONE exposure on every window', async () => {
    await proposeAndAuthorise(kernel, S1E_PASS_ORDER);
    const duplicate = await proposeAndAuthorise(kernel, S1E_PASS_ORDER);
    expect(duplicate.outcome, json(duplicate)).toBe('DUPLICATE_PRIOR_RESULT');

    await withClient(async (client) => {
      for (const windowId of EXPECTED_REFUND_WINDOWS) {
        expect(
          await scalar(
            client,
            `SELECT reserved_monetary FROM window_balance
              WHERE company_id = $1 AND window_id = $2`,
            [COMPANY_ID, windowId],
          ),
          windowId,
        ).toBe(S1F_EXPECTED.pass.totalExposure);
      }
      // Exactly one of everything, and the counter advanced exactly once.
      expect(await countOf(client, 'exposure_reservation')).toBe(1);
      expect(await countOf(client, 'reservation_window_instance')).toBe(2);
      expect(await countOf(client, 'authorisation')).toBe(1);
      expect(await countOf(client, 'authorisation_decision')).toBe(1);
      expect(await countOf(client, 'effect_journal')).toBe(1);
      expect(
        await scalar(client, `SELECT next_seq::TEXT FROM journal_counter WHERE company_id = $1`, [
          COMPANY_ID,
        ]),
      ).toBe('2');
    });
  });

  it('the duplicate attempt left NO authorisation row of its own', async () => {
    // The release is the whole attempt, not only the reservation: the duplicate's own
    // authorisation row and its window-instance rows go back with it. Otherwise a duplicate
    // would accumulate stranded authorisations that no decision and no reservation names.
    const first = await proposeAndAuthorise(kernel, S1E_PASS_ORDER);
    if (first.outcome !== 'LOCAL_AUTHORISATION_COMMITTED') throw new Error(json(first));
    await proposeAndAuthorise(kernel, S1E_PASS_ORDER);
    await withClient(async (client) => {
      const rows = await rowsOf<{ authorisation_id: string }>(
        client,
        `SELECT authorisation_id FROM authorisation WHERE company_id = $1`,
        [COMPANY_ID],
      );
      expect(rows.map((r) => r.authorisation_id)).toEqual([first.authorisationId]);
      expect(await countOf(client, 'authorisation_window_instance')).toBe(2);
    });
  });

  it('R PRECEDES T — a duplicate that ALSO lacks headroom denies WINDOW_EXHAUSTED', async () => {
    // `26 §7` property 8 puts the idempotency check after the reservation. So when both
    // conditions hold, the WINDOW is the determining one. An implementation that checked the
    // key first would return the prior result here, which is a different answer and a
    // different audit record.
    await proposeAndAuthorise(kernel, S1E_PASS_ORDER);
    await withClient(async (client) => {
      // Drive the day window to the point where the duplicate's own attempt cannot reserve:
      // $50.00 ceiling, $10.00 already reserved by the first authorisation, so $40.00
      // realised leaves nothing for a second $10.00.
      await preloadRealised(client, 'W_DAY_REFUND', '40.00');
    });
    const duplicate = await proposeAndAuthorise(kernel, S1E_PASS_ORDER);
    expect(duplicate.outcome, json(duplicate)).toBe('LOCAL_AUTHORISATION_DENIED');
    if (duplicate.outcome !== 'LOCAL_AUTHORISATION_DENIED') return;
    expect(duplicate.step).toBe('R');
    expect(duplicate.code).toBe('WINDOW_EXHAUSTED');
    // Step T was never reached, and the trace says so.
    expect(duplicate.lineage.localStepsEvaluated).toEqual(['R']);
  });
});

// =====================================================================================
// Concurrency — the constraint decides, not a read
// =====================================================================================

describe('two concurrent attempts on one key', () => {
  it('the ENTITY LEASE serialises them, and the second returns the prior result', async () => {
    // `25 §14`: "Second item waits or defers; it does not proceed on stale state." Both
    // proposals name the same order, so the second blocks on the advisory lock until the
    // first has committed — which is the architecture working, not the test avoiding the
    // race.
    const [a, b] = await Promise.all([
      proposeAndAuthorise(kernel, S1E_PASS_ORDER),
      proposeAndAuthorise(kernel, S1E_PASS_ORDER),
    ]);
    const outcomes = [a!.outcome, b!.outcome].sort();
    expect(outcomes, json([a, b])).toEqual([
      'DUPLICATE_PRIOR_RESULT',
      'LOCAL_AUTHORISATION_COMMITTED',
    ]);
    await withClient(async (client) => {
      expect(await countOf(client, 'effect')).toBe(1);
      expect(await countOf(client, 'exposure_reservation')).toBe(1);
    });
  });

  it('AND THE CONSTRAINT IS THE BACKSTOP — two raw concurrent inserts, one 23505', async () => {
    // The lease is a control-plane discipline; the constraint is a database fact. `33 §6`
    // requires the second "even if every layer above it fails", so it is tested with the
    // lease bypassed entirely: two raw connections, the same key, no advisory lock.
    const committed = await proposeAndAuthorise(kernel, S1E_PASS_ORDER);
    if (committed.outcome !== 'LOCAL_AUTHORISATION_COMMITTED') throw new Error(json(committed));
    const key = (await withClient((client) =>
      scalar(client, `SELECT idempotency_key FROM effect WHERE effect_id = $1`, [
        committed.effectId,
      ]),
    ))!;

    const attempt = async (suffix: string): Promise<'INSERTED' | 'DUPLICATE'> => {
      const client = await harness.connect();
      try {
        await client.query(
          `INSERT INTO authorisation (
             authorisation_id, company_id, principal_id, session_id, task_id,
             action_class, resource_ref, resource_id,
             dispatch_payload_hash, intent_hash, context_digest,
             constructor_id, constructor_semantic_major, constructor_non_semantic_minor,
             policy_version, vendor_amount, total_exposure, forward_integral, is_rate_class,
             recoverability, value_direction, autonomy_level, gate_class, created_at)
           SELECT $1, company_id, principal_id, session_id, task_id,
                  action_class, resource_ref, resource_id,
                  dispatch_payload_hash, intent_hash, context_digest,
                  constructor_id, constructor_semantic_major, constructor_non_semantic_minor,
                  policy_version, vendor_amount, total_exposure, forward_integral, is_rate_class,
                  recoverability, value_direction, autonomy_level, gate_class, created_at
             FROM authorisation WHERE authorisation_id = $2`,
          [`auth:raw-${suffix}`, committed.authorisationId],
        );
        await client.query(
          `INSERT INTO effect (
             company_id, idempotency_key, effect_id, authorisation_id,
             action_class, resource_ref, adapter, recoverability, gate_class, status, created_at)
           VALUES ($1,$2,$3,$4,'refund.create',$5,'mock_processor','COMPENSABLE',
                   'UNGATED_LOGGED','AUTHORISED',now())`,
          [
            COMPANY_ID,
            key,
            `effect:raw-${suffix}`,
            `auth:raw-${suffix}`,
            S1E_PASS_ORDER.resourceRef,
          ],
        );
        return 'INSERTED';
      } catch (error) {
        if (hasSqlstate(error, LOCAL_SQLSTATE.UNIQUE_VIOLATION)) return 'DUPLICATE';
        throw error;
      } finally {
        client.release();
      }
    };

    const results = await settleAll([() => attempt('a'), () => attempt('b')]);
    const values = results.map((r) => valueOf(r as PromiseSettledResult<string>));
    // The first committed effect already holds the key, so BOTH raw attempts are duplicates.
    expect(values).toEqual(['DUPLICATE', 'DUPLICATE']);
    await withClient(async (client) => {
      expect(await countOf(client, 'effect')).toBe(1);
    });
  });
});

describe('THE VULNERABLE CONTROL — a duplicate check by SELECT instead of by the key', () => {
  it('two interleaved attempts BOTH reserve, and the same intent consumes exposure twice', async () => {
    // `33 §6` requires the constraint to hold "even if every layer above it fails". This is
    // what a read-then-write check costs: two transactions pass the SELECT, and at
    // SERIALIZABLE nothing forces either to abort because they conflict on nothing they
    // read — so the same intent takes headroom twice.
    await withClient(async (client) => {
      await preloadRealised(client, 'W_DAY_REFUND', '0.00');
      await preloadRealised(client, 'W_MONTH_REFUND', '0.00');
    });

    const conductor = new Conductor();
    const a = conductor.participant('a');
    const b = conductor.participant('b');
    const KEY = 'idem:unsafe-duplicate';

    function spec(id: string) {
      return {
        companyId: COMPANY_ID,
        authorisationId: `auth:unsafe-dup-${id}`,
        reservationId: `reservation:unsafe-dup-${id}`,
        actionClass: 'refund.create',
        resourceRef: S1E_PASS_ORDER.resourceRef,
        vendorAmount: money(S1F_EXPECTED.pass.vendorAmount),
        totalExposure: money(S1F_EXPECTED.pass.totalExposure),
        // Each attempt touches ONE window, and a DIFFERENT one, so the two transactions
        // conflict on nothing and SERIALIZABLE has no reason to abort either. That is the
        // shape a read-then-write duplicate check actually fails in.
        windows: [
          {
            windowId: id === 'a' ? 'W_DAY_REFUND' : 'W_MONTH_REFUND',
            windowInstanceKey: expectedInstanceKey(
              id === 'a' ? 'W_DAY_REFUND' : 'W_MONTH_REFUND',
              FIXTURE_NOW,
            ),
          },
        ],
        at: FIXTURE_NOW,
        countUnits: 0n,
      };
    }

    const run = async (id: string, participant: { at: (p: string) => Promise<void> }) => {
      const client = await harness.connect();
      try {
        return await unsafeDuplicateCheckBySelect(client, spec(id), KEY, () =>
          participant.at('AFTER_UNLOCKED_READ'),
        );
      } finally {
        client.release();
      }
    };

    const pending = settleAll([() => run('a', a), () => run('b', b)]);
    // Both have read, neither has written. Release them in order.
    await conductor.until('a', 'AFTER_UNLOCKED_READ');
    await conductor.until('b', 'AFTER_UNLOCKED_READ');
    conductor.release('a', 'AFTER_UNLOCKED_READ');
    conductor.release('b', 'AFTER_UNLOCKED_READ');
    const results = await pending;
    const values = results.map((r) => valueOf(r as PromiseSettledResult<string>));

    // VULNERABLE — both committed. Neither saw the other's effect row, because neither
    // wrote one.
    expect(values.sort()).toEqual(['COMMITTED', 'COMMITTED']);
    await withClient(async (client) => {
      // Two reservations for ONE logical intent.
      expect(await countOf(client, 'exposure_reservation')).toBe(2);
      expect(
        await scalar(
          client,
          `SELECT sum(amount)::TEXT FROM reservation_window_instance WHERE company_id = $1`,
          [COMPANY_ID],
        ),
      ).toBe('20.00');
      // Clean up before production runs.
      await client.query(`DELETE FROM reservation_window_instance`);
      await client.query(`DELETE FROM exposure_reservation`);
      await client.query(
        `UPDATE window_balance SET reserved_monetary = 0.00, reserved_count = 0
          WHERE company_id = $1`,
        [COMPANY_ID],
      );
    });

    // PRODUCTION — the same intent twice, and exposure moves exactly once.
    await proposeAndAuthorise(kernel, S1E_PASS_ORDER);
    const second = await proposeAndAuthorise(kernel, S1E_PASS_ORDER);
    expect(second.outcome).toBe('DUPLICATE_PRIOR_RESULT');
    await withClient(async (client) => {
      expect(await countOf(client, 'exposure_reservation')).toBe(1);
      expect(
        await scalar(
          client,
          `SELECT sum(amount)::TEXT FROM reservation_window_instance WHERE company_id = $1`,
          [COMPANY_ID],
        ),
      ).toBe('20.00'); // $10.00 against each of the two windows — ONE exposure, twice bound.
    });

    // THE TEST DISCRIMINATES: two reservation ROWS under the control, one under production.
  });
});

// =====================================================================================
// The worker learns nothing from a duplicate
// =====================================================================================

describe('a duplicate projects to a category with no prior-effect detail', () => {
  it('`{ alreadyActed: true }`, and nothing about the prior effect', async () => {
    await proposeAndAuthorise(kernel, S1E_PASS_ORDER);
    const duplicate = await proposeAndAuthorise(kernel, S1E_PASS_ORDER);
    if (duplicate.outcome !== 'DUPLICATE_PRIOR_RESULT') throw new Error(json(duplicate));

    const projected = projectLocalAuthorisationToWorker(duplicate);
    expect(projected).toEqual({ alreadyActed: true });
    expect(Object.keys(projected)).toHaveLength(1);

    const serialised = JSON.stringify(projected);
    for (const secret of [
      duplicate.priorEffectId,
      duplicate.priorAuthorisationId,
      duplicate.priorStatus,
      'AUTHORISED',
      'journalSeq',
    ]) {
      expect(serialised, `leaked ${secret}`).not.toContain(secret);
    }
  });
});
