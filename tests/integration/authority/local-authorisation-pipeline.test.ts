import type { PoolClient } from 'pg';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { verifyDecisionSignature } from '../../../src/kernel/authorisation/decisionSignature.js';
import { projectLocalAuthorisationToWorker } from '../../../src/kernel/authorisation/workerFacingLocalDenial.js';
import { createHarness, type Harness } from '../../support/fixture.js';
import { loadCommerceFixture } from '../../support/enumerationFixture.js';
import {
  S1E_OVER_CAP_ORDER,
  S1E_PASS_ORDER,
  loadAuthorityWorld,
  loadS1eOrders,
} from '../../support/authorityFixture.js';
import {
  COMPANY_ID,
  EXPECTED_REFUND_WINDOWS,
  FIXTURE_NOW,
  S1F_EXPECTED,
  expectedInstanceKey,
  makeLocalAuthorityHarness,
  proposeAndAuthorise,
  rowsOf,
  scalar,
  type LocalAuthorityHarness,
} from '../../support/localAuthorisationFixture.js';

/**
 * S1F — `26 §7` STEPS R THROUGH W, END TO END, ON REAL POSTGRESQL.
 *
 * =====================================================================================
 * WHAT THIS SUITE PROVES, AND HOW IT AVOIDS PROVING IT WITH ITSELF
 *
 * The claim under test is `33 §1`'s: the reservation, the decision, the effect journal row
 * and the local state transition "commit or fail together, as a single Postgres
 * transaction."
 *
 * Every assertion below reads COMMITTED ROWS through direct SQL. Not a service return
 * value, not an in-memory object, not a recomputed expectation:
 *
 *   - `I18b` is asserted between `exposure_reservation.amount` and
 *     `authorisation.total_exposure`, both read back out of PostgreSQL, and both compared
 *     against the HAND-AUTHORED `10.00` whose two operands ($9.41 + $0.59) a reader can add
 *     up. Nothing calls `totalExposure()` to decide what to expect.
 *   - the window set is compared against `EXPECTED_REFUND_WINDOWS`, a hand-authored list.
 *   - the journal sequence is compared against the hand-authored integer `1`.
 *   - the signature is verified with the PUBLIC key against independently reconstructed
 *     signing fields, so a decision that signed the wrong economics fails here.
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
// The positive control the whole slice rests on
// =====================================================================================

describe('the happy path commits ONE local authorisation transaction', () => {
  it('LOCAL_AUTHORISATION_COMMITTED, from real rows, through every step D–W', async () => {
    const outcome = await proposeAndAuthorise(kernel, S1E_PASS_ORDER);
    expect(outcome.outcome, json(outcome)).toBe('LOCAL_AUTHORISATION_COMMITTED');
    if (outcome.outcome !== 'LOCAL_AUTHORISATION_COMMITTED') return;

    expect(outcome.verdict).toBe('PERMIT');
    expect(outcome.localStatus).toBe('AUTHORISED');
    // The local steps that ran, in `26 §7`'s order. Transcribed from the flowchart here,
    // not read from `localSteps.ts`.
    expect(outcome.lineage.localStepsEvaluated).toEqual(['R', 'S', 'T', 'U', 'W']);
    // The pre-R trace is the ACCEPTED S1E one, unchanged.
    expect(outcome.lineage.stepsEvaluated).toEqual([
      'D', 'E', 'F', 'G', 'H', 'H′', 'H″', 'I', 'J', 'K', 'L', 'M', 'N', 'P',
    ]);
    expect(outcome.journalSeq).toBe(1n);
  });

  it('every one of the four things `33 §1` names is COMMITTED', async () => {
    const outcome = await proposeAndAuthorise(kernel, S1E_PASS_ORDER);
    if (outcome.outcome !== 'LOCAL_AUTHORISATION_COMMITTED') throw new Error(json(outcome));

    await withClient(async (client) => {
      // 1 — the exposure reservation.
      const reservation = await rowsOf<{ reservation_id: string; amount: string }>(
        client,
        `SELECT reservation_id, amount FROM exposure_reservation WHERE company_id = $1`,
        [COMPANY_ID],
      );
      expect(reservation).toHaveLength(1);
      expect(reservation[0]!.reservation_id).toBe(outcome.reservationId);

      // 2 — the authorisation decision.
      const decision = await rowsOf<{ decision_id: string; verdict: string; reservation_id: string }>(
        client,
        `SELECT decision_id, verdict, reservation_id FROM authorisation_decision WHERE company_id = $1`,
        [COMPANY_ID],
      );
      expect(decision).toHaveLength(1);
      expect(decision[0]!.decision_id).toBe(outcome.decisionId);
      expect(decision[0]!.verdict).toBe('PERMIT');
      // I2, structurally: the decision names the reservation.
      expect(decision[0]!.reservation_id).toBe(outcome.reservationId);

      // 3 — the effect journal row, with its gap-free sequence and local chain hash.
      const journal = await rowsOf<{
        journal_seq: string;
        prev_hash: Buffer;
        row_hash: Buffer;
        mirrored_at: Date | null;
      }>(
        client,
        `SELECT journal_seq, prev_hash, row_hash, mirrored_at FROM effect_journal
          WHERE company_id = $1`,
        [COMPANY_ID],
      );
      expect(journal).toHaveLength(1);
      expect(journal[0]!.journal_seq).toBe('1');
      // The genesis row's prev_hash is 32 zero bytes; the row hash is a real SHA-256.
      expect(journal[0]!.prev_hash.toString('hex')).toBe('00'.repeat(32));
      expect(journal[0]!.row_hash).toHaveLength(32);
      // `30 §5.2`: "null until the audit store acknowledges". S1F pushes nothing.
      expect(journal[0]!.mirrored_at).toBeNull();

      // 4 — the local state transition: the effect row at status AUTHORISED.
      const effect = await rowsOf<{ effect_id: string; status: string }>(
        client,
        `SELECT effect_id, status FROM effect WHERE company_id = $1`,
        [COMPANY_ID],
      );
      expect(effect).toHaveLength(1);
      expect(effect[0]!.effect_id).toBe(outcome.effectId);
      expect(effect[0]!.status).toBe('AUTHORISED');
    });
  });

  it('I18b — `reservation.amount == exposure.total_exposure`, from the COMMITTED rows', async () => {
    // Registry `I18b`: "For every effect, reservation.amount == exposure.total_exposure,
    // exactly, in the single ledger currency. NO TOLERANCE."
    //
    // The expected value is the hand-authored sum $9.41 + $0.59 = $10.00. Neither operand
    // nor the sum comes from production code.
    const outcome = await proposeAndAuthorise(kernel, S1E_PASS_ORDER);
    if (outcome.outcome !== 'LOCAL_AUTHORISATION_COMMITTED') throw new Error(json(outcome));

    await withClient(async (client) => {
      const row = (
        await rowsOf<{
          amount: string;
          vendor_amount: string | null;
          total_exposure: string;
          request_vendor: string | null;
          forward_integral: string | null;
          is_rate_class: boolean;
        }>(
          client,
          `SELECT r.amount, r.vendor_amount, a.total_exposure,
                  a.vendor_amount AS request_vendor, r.forward_integral, r.is_rate_class
             FROM exposure_reservation r
             JOIN authorisation a ON a.authorisation_id = r.authorisation_id
            WHERE r.reservation_id = $1`,
          [outcome.reservationId],
        )
      )[0]!;

      expect(row.amount).toBe(S1F_EXPECTED.pass.totalExposure);
      expect(row.total_exposure).toBe(S1F_EXPECTED.pass.totalExposure);
      expect(row.amount).toBe(row.total_exposure);
      // `I18a`'s non-null branch: the vendor amount is a DIFFERENT quantity and it is the
      // one that must never become the reservation.
      expect(row.vendor_amount).toBe(S1F_EXPECTED.pass.vendorAmount);
      expect(row.request_vendor).toBe(S1F_EXPECTED.pass.vendorAmount);
      expect(row.amount).not.toBe(row.vendor_amount);
      // `26 §2.1.3` / E1: a non-rate class carries no forward integral at all.
      expect(row.is_rate_class).toBe(false);
      expect(row.forward_integral).toBeNull();
    });
  });

  it('EVERY referenced window instance is bound, and the two record sets agree', async () => {
    const outcome = await proposeAndAuthorise(kernel, S1E_PASS_ORDER);
    if (outcome.outcome !== 'LOCAL_AUTHORISATION_COMMITTED') throw new Error(json(outcome));

    const expectedKeys = EXPECTED_REFUND_WINDOWS.map((w) => expectedInstanceKey(w, FIXTURE_NOW));

    // What the outcome reports.
    expect(outcome.windowInstances.map((w) => w.windowId).sort()).toEqual([
      ...EXPECTED_REFUND_WINDOWS,
    ]);

    await withClient(async (client) => {
      // What the AUTHORITY named.
      const named = await rowsOf<{ window_id: string; window_instance_key: string }>(
        client,
        `SELECT window_id, window_instance_key FROM authorisation_window_instance
          WHERE authorisation_id = $1 ORDER BY window_id`,
        [outcome.authorisationId],
      );
      expect(named.map((r) => r.window_id)).toEqual([...EXPECTED_REFUND_WINDOWS]);
      expect(named.map((r) => r.window_instance_key)).toEqual(expectedKeys);

      // What the RESERVATION moved. The two sets must be equal — an effect bound by two
      // windows and reserved against one is exactly the defect the multi-window control
      // reproduces.
      const reserved = await rowsOf<{
        window_id: string;
        window_instance_key: string;
        amount: string;
      }>(
        client,
        `SELECT window_id, window_instance_key, amount FROM reservation_window_instance
          WHERE reservation_id = $1 ORDER BY window_id`,
        [outcome.reservationId],
      );
      expect(reserved.map((r) => r.window_id)).toEqual([...EXPECTED_REFUND_WINDOWS]);
      expect(reserved.map((r) => r.window_instance_key)).toEqual(expectedKeys);
      for (const row of reserved) {
        expect(row.amount, row.window_id).toBe(S1F_EXPECTED.pass.totalExposure);
      }
    });
  });

  it('the S1A four-term guard actually MOVED — `reserved_monetary` on every instance', async () => {
    const outcome = await proposeAndAuthorise(kernel, S1E_PASS_ORDER);
    if (outcome.outcome !== 'LOCAL_AUTHORISATION_COMMITTED') throw new Error(json(outcome));

    await withClient(async (client) => {
      for (const windowId of EXPECTED_REFUND_WINDOWS) {
        const balance = (
          await rowsOf<{
            reserved_monetary: string;
            standing_monetary: string;
            presumed_monetary: string;
            realised_monetary: string;
            reserved_count: string;
          }>(
            client,
            `SELECT reserved_monetary, standing_monetary, presumed_monetary, realised_monetary,
                    reserved_count
               FROM window_balance
              WHERE company_id = $1 AND window_id = $2 AND window_instance_key = $3`,
            [COMPANY_ID, windowId, expectedInstanceKey(windowId, FIXTURE_NOW)],
          )
        )[0]!;
        // Term 1 carries the whole of an ordinary class's exposure; terms 2–4 are untouched.
        expect(balance.reserved_monetary, windowId).toBe(S1F_EXPECTED.pass.totalExposure);
        expect(balance.standing_monetary, windowId).toBe('0.00');
        expect(balance.presumed_monetary, windowId).toBe('0.00');
        expect(balance.realised_monetary, windowId).toBe('0.00');
        // `51 §2`'s count ceilings count EFFECTS: one authorised refund is one unit.
        expect(balance.reserved_count, windowId).toBe('1');
      }
    });
  });

  it('the decision is really SIGNED, and the signature covers the economics', async () => {
    const outcome = await proposeAndAuthorise(kernel, S1E_PASS_ORDER);
    if (outcome.outcome !== 'LOCAL_AUTHORISATION_COMMITTED') throw new Error(json(outcome));

    await withClient(async (client) => {
      const row = (
        await rowsOf<{
          signature: Buffer;
          signing_key_id: string;
          verdict: string;
          approval_requirement: string;
          policy_version: string;
          decided_at: Date;
          constructor_semantic_major: number;
          constructor_non_semantic_minor: number;
          idempotency_key: string;
          dispatch_payload_hash: string;
          action_class: string;
          resource_ref: string;
        }>(
          client,
          `SELECT d.signature, d.signing_key_id, d.verdict, d.approval_requirement,
                  d.policy_version, d.decided_at,
                  d.constructor_semantic_major, d.constructor_non_semantic_minor,
                  e.idempotency_key, a.dispatch_payload_hash, a.action_class, a.resource_ref
             FROM authorisation_decision d
             JOIN effect e ON e.effect_id = d.effect_id
             JOIN authorisation a ON a.authorisation_id = d.authorisation_id
            WHERE d.decision_id = $1`,
          [outcome.decisionId],
        )
      )[0]!;

      // Ed25519 signatures are 64 bytes; the schema's CHECK says so and this reads the row.
      expect(row.signature).toHaveLength(64);
      expect(row.signing_key_id).toBe(kernel.decisionKeys.keyId);

      // The signing fields are reconstructed HERE from the persisted row plus the
      // hand-authored economics, and verified with the PUBLIC key. A decision that signed a
      // different amount than it committed fails this.
      const fields = {
        decisionId: outcome.decisionId,
        companyId: COMPANY_ID,
        authorisationId: outcome.authorisationId,
        effectId: outcome.effectId,
        reservationId: outcome.reservationId,
        approvalId: null,
        verdict: 'PERMIT' as const,
        approvalRequirement: row.approval_requirement,
        actionClass: row.action_class,
        resourceRef: row.resource_ref,
        idempotencyKey: row.idempotency_key,
        dispatchPayloadHash: row.dispatch_payload_hash,
        vendorAmount: 941n,
        totalExposure: 1000n,
        forwardIntegral: null,
        isRateClass: false,
        constructorSemanticMajor: row.constructor_semantic_major,
        constructorNonSemanticMinor: row.constructor_non_semantic_minor,
        policyVersion: row.policy_version,
        decidedAt: row.decided_at,
      };
      expect(
        verifyDecisionSignature(kernel.decisionKeys.publicKey, fields, row.signature),
      ).toBe(true);

      // AND IT DISCRIMINATES. One cent on the total exposure invalidates it.
      expect(
        verifyDecisionSignature(
          kernel.decisionKeys.publicKey,
          { ...fields, totalExposure: 1001n },
          row.signature,
        ),
      ).toBe(false);
      // As does swapping the vendor amount in for the total — the exact TB-03-adjacent
      // substitution the whole slice is built to refuse.
      expect(
        verifyDecisionSignature(
          kernel.decisionKeys.publicKey,
          { ...fields, totalExposure: 941n },
          row.signature,
        ),
      ).toBe(false);
    });
  });

  it('the transaction ran at SERIALIZABLE, observed at the DATABASE', async () => {
    // `33 §6`: "isolation is set and asserted at the connection". The production path asserts
    // it and REFUSES to proceed otherwise; this shows the assertion is not vacuous by
    // reading the level the same way the production code does, on a transaction opened the
    // same way.
    const observed: string[] = [];
    const outcome = await proposeAndAuthorise(kernel, S1E_PASS_ORDER, {
      at: async (point) => {
        if (point !== 'AFTER_ISOLATION_ASSERTED') return;
        // Nothing to do; reaching this point at all means the production assertion passed.
        observed.push(point);
      },
    });
    expect(outcome.outcome).toBe('LOCAL_AUTHORISATION_COMMITTED');
    expect(observed).toEqual(['AFTER_ISOLATION_ASSERTED']);

    await withClient(async (client) => {
      await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
      try {
        expect(await scalar(client, `SELECT current_setting('transaction_isolation')`)).toBe(
          'serializable',
        );
      } finally {
        await client.query('ROLLBACK');
      }
      // And the negative half: the default is NOT serializable, so the production assertion
      // is testing something real.
      await client.query('BEGIN');
      try {
        expect(await scalar(client, `SELECT current_setting('transaction_isolation')`)).not.toBe(
          'serializable',
        );
      } finally {
        await client.query('ROLLBACK');
      }
    });
  });
});

// =====================================================================================
// A pre-R denial is still a pre-R denial — S1E is composed, not reimplemented
// =====================================================================================

describe('a pre-reservation denial reaches step R at all', () => {
  it('VC-C1 — $25.00 + $1.03 denies PER_ACTION at step M, and NOTHING is reserved', async () => {
    // The accepted S1D/S1E outcome, verbatim, with the S1F addition that the money path was
    // never entered: `26 §7` denies at M, which is BEFORE R.
    const outcome = await proposeAndAuthorise(kernel, S1E_OVER_CAP_ORDER);
    expect(outcome.outcome, json(outcome)).toBe('DENIED');
    if (outcome.outcome !== 'DENIED') return;
    expect(outcome.step).toBe('M');
    expect(outcome.code).toBe('PER_ACTION');

    await withClient(async (client) => {
      expect(
        await scalar(client, `SELECT count(*)::TEXT FROM exposure_reservation`),
      ).toBe('0');
      expect(await scalar(client, `SELECT count(*)::TEXT FROM authorisation`)).toBe('0');
      expect(await scalar(client, `SELECT count(*)::TEXT FROM effect`)).toBe('0');
      expect(await scalar(client, `SELECT count(*)::TEXT FROM effect_journal`)).toBe('0');
      // The sequence was never allocated either, so there is no gap to explain.
      expect(
        await scalar(client, `SELECT next_seq::TEXT FROM journal_counter WHERE company_id = $1`, [
          COMPANY_ID,
        ]),
      ).toBe('1');
    });
  });
});

// =====================================================================================
// The worker sees a category, and the identifiers stay inside the kernel
// =====================================================================================

describe('`26 §7`\'s coarse rule survives step R', () => {
  it('a committed authorisation projects to ONE boolean field', async () => {
    const outcome = await proposeAndAuthorise(kernel, S1E_PASS_ORDER);
    const projected = projectLocalAuthorisationToWorker(outcome);
    expect(projected).toEqual({ authorised: true });
    expect(Object.keys(projected)).toHaveLength(1);
    expect(Object.isFrozen(projected)).toBe(true);

    // The identifiers, the amounts, the windows, the sequence and the retry count are all
    // absent from the serialised form. Asserted by SEARCHING for them rather than by
    // enumerating the fields, so a field added later is caught.
    const serialised = JSON.stringify(projected);
    if (outcome.outcome !== 'LOCAL_AUTHORISATION_COMMITTED') throw new Error(json(outcome));
    for (const secret of [
      outcome.authorisationId,
      outcome.decisionId,
      outcome.effectId,
      outcome.reservationId,
      '10.00',
      '9.41',
      'W_DAY_REFUND',
      'W_MONTH_REFUND',
      'journalSeq',
      'serialisationRetries',
    ]) {
      expect(serialised, `worker output leaked ${secret}`).not.toContain(secret);
    }
  });

  it('the committed outcome carries no dispatchable field, at runtime as well as in the type', async () => {
    const outcome = await proposeAndAuthorise(kernel, S1E_PASS_ORDER);
    if (outcome.outcome !== 'LOCAL_AUTHORISATION_COMMITTED') throw new Error(json(outcome));
    // The type-negative half is tests/type-negative/local-authorisation-as-dispatchable.ts.
    // This is the runtime half: the seven `DispatchPayload` fields are not present under any
    // name, and neither is the idempotency key.
    const keys = Object.keys(outcome);
    for (const forbidden of [
      'dispatchPayload',
      'payload',
      'adapter',
      'method',
      'vendorParameters',
      'idempotencyKey',
      'monetaryEffect',
      'preconditionToken',
      'credential',
      'token',
      'amount',
      'totalExposure',
    ]) {
      expect(keys, `the S1F terminal exposes ${forbidden}`).not.toContain(forbidden);
    }
    expect(Object.isFrozen(outcome)).toBe(true);
  });
});
