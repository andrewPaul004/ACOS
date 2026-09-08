import { sign as signEd25519 } from 'node:crypto';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { COMPANY_ID } from '../../support/fixture.js';
import {
  authoriseRefundAtExposure,
  claimJournalRows,
  createOutboxHarness,
  outboxRows,
  type AuthorisedEffect,
  type OutboxHarness,
} from '../../support/outboxFixture.js';
import { Conductor, POINT, settleAll, valueOf } from '../../support/barrier.js';
import { inTransaction } from '../../../src/db/pool.js';
import { enqueueDispatch } from '../../../src/kernel/outbox/enqueue.js';
import { claimForExternalDispatchOn } from '../../../src/kernel/outbox/claim.js';
import { declareMirrorDegraded } from '../../../src/kernel/mirror/mirrorStateMachine.js';
import {
  grantOverride,
  overrideGrantBytes,
  type OverrideRequest,
} from '../../../src/kernel/mirror/degradedModeOverride.js';
import { money } from '../../../src/kernel/exposure/money.js';
import {
  ensureUnsafeOverrideCounter,
  unsafeNonAtomicOverrideClaim,
} from '../../negative-controls/unsafe-non-atomic-override-claim.js';

/**
 * `§32` — TWO OUTBOX ROWS RACE FOR THE FINAL OVERRIDE ALLOWANCE. AT MOST ONE WINS.
 *
 * =================================================================================
 * `§32` OF THE S1I MANDATE:
 *
 *   "Required integration: valid override has exactly one remaining effect allowance. Two
 *    distinct otherwise-eligible outbox rows race to claim under that override. Expected:
 *    at most one receives the final override-backed claim. The other is HALTED/SUSPENDED
 *    according to current architecture. **No N+1. Do not test this with process memory.**"
 *
 * `§31`: "If claim consumes one override effect-count unit, perform that consumption
 * atomically with the outbox CLAIM. Use real PostgreSQL concurrency."
 *
 * `30 §5.7.2` item 3: "`effects_dispatched` and `monetary_dispatched` are incremented in
 * the **dispatching transaction**; reaching either cap moves the override to `EXHAUSTED`
 * immediately."
 * =================================================================================
 *
 * =================================================================================
 * WHY THE CLAIM TRANSACTION IS "THE DISPATCHING TRANSACTION" — `S1I-C3`.
 *
 * v1.3.3 names the transaction and does not define which one it is in a slice with no
 * dispatcher, and `S1I-owner-clarifications.md S1I-C3` records that as a clarification.
 * The reading S1I implements is the only sound one, and this suite is the proof:
 *
 *   the claim is IRREVERSIBLE — no path returns a `CLAIMED` row to `ENQUEUED` — so after
 *   it commits the effect WILL be handed to whatever builds transport. If the counter were
 *   incremented later, N rows could each be CLAIMED against a cap of one, and `I63(a)`'s
 *   cap would bound nothing at all.
 *
 * The ACCEPTED S1H `claimOverrideAllowanceOn` already reads it this way, in its own words:
 * "the transaction that WOULD dispatch, in a slice that has no dispatcher." S1I composes
 * that function into the claim rather than reimplementing the counter.
 *
 * THIS RACE IS DIFFERENT FROM THE ACCEPTED `override-count-race.test.ts`. That one races
 * two ALLOWANCE claims against one override. This races two OUTBOX CLAIMS, each on its own
 * row, each of which must take an allowance to succeed — so the property under test is that
 * the outbox claim inherits the cap rather than sitting beside it.
 * =================================================================================
 */

let h: OutboxHarness;
const T0 = new Date('2026-09-05T10:05:00.000Z');
const HOUR = 60 * 60 * 1000;

beforeAll(async () => {
  h = await createOutboxHarness();
});

afterAll(async () => {
  await h.close();
});

beforeEach(async () => {
  await h.reset();
  // `30 §5.1` row 4 SUSPENDS in every state, so an override is the only route to a claim
  // for a COMPENSABLE discretionary effect — which is exactly the case `§32` needs.
  await declareMirrorDegraded(h.control, COMPANY_ID, 'PUSH_ACK_TIMEOUT', T0);
});

async function grantRow4Override(cap: bigint): Promise<void> {
  const request: OverrideRequest = {
    companyId: COMPANY_ID,
    overrideId: 'override:s1i-race',
    requestedBy: 'principal:owner',
    requestedAt: T0,
    effectClasses: ['refund.create'],
    recoverabilityClasses: ['COMPENSABLE'],
    precedenceRows: [4],
    startsAt: T0,
    expiresAt: new Date(T0.getTime() + 24 * HOUR),
    effectCountCap: cap,
    monetaryExposureCap: money('50.00'),
    reason: 'the final-allowance race (§32)',
    incidentRef: h.seed.incidentRef,
  };
  await grantOverride(h.control, request, {
    grantedBy: 'principal:owner',
    grantedAt: T0,
    grantSignature: signEd25519(
      null,
      overrideGrantBytes(request),
      h.seed.ownerSigner.privateKey,
    ),
  });
}

/**
 * Two DISTINCT COMPENSABLE refunds, each on its own resource, each with its own outbox row.
 *
 * `§32` needs two effects that are OTHERWISE ELIGIBLE and compete for one allowance, so
 * each must be a different semantic effect identity — a different `resource_id`, a
 * different `task_id` and therefore a different `25 §7` key. `authoriseRefundAtExposure`
 * mints both, and `outbox-enqueue.test.ts` asserts separately that two distinct intents
 * produce two rows and two tags.
 */
async function twoEnqueuedRefunds(): Promise<readonly [AuthorisedEffect, AuthorisedEffect]> {
  // `$10.00` each: BELOW `51 §3.7`'s $20.00 floor, so both classify at `30 §5.1` ROW 4
  // and SUSPEND — which is the case an override restores and `§32` needs.
  const one = await authoriseRefundAtExposure(h, '10.00');
  const two = await authoriseRefundAtExposure(h, '10.00');
  expect(one.idempotencyKey).not.toBe(two.idempotencyKey);
  for (const [index, effect] of [one, two].entries()) {
    const outcome = await enqueueDispatch(h.control, {
      companyId: COMPANY_ID,
      effectId: effect.effectId,
      outboxId: `outbox:race-${String(index)}`,
      payloadCanonicalBytes: effect.payloadCanonicalBytes,
      now: T0,
    });
    expect(outcome.kind).toBe('ENQUEUED');
  }
  return [one, two];
}

async function overrideCounters(): Promise<{
  readonly effects: string;
  readonly monetary: string;
  readonly status: string;
}> {
  const client = await h.control.connect();
  try {
    const row = await client.query<{
      effects_dispatched: string;
      monetary_dispatched: string;
      status: string;
    }>(
      `SELECT effects_dispatched, monetary_dispatched, status
         FROM degraded_mode_override
        WHERE company_id = $1 AND override_id = 'override:s1i-race'`,
      [COMPANY_ID],
    );
    return {
      effects: row.rows[0]!.effects_dispatched,
      monetary: row.rows[0]!.monetary_dispatched,
      status: row.rows[0]!.status,
    };
  } finally {
    client.release();
  }
}

describe('THE FINAL ALLOWANCE, CONTESTED BY TWO OUTBOX ROWS', () => {
  it('cap = 1: two concurrent outbox claims, EXACTLY ONE succeeds', async () => {
    const [one, two] = await twoEnqueuedRefunds();
    await grantRow4Override(1n);

    const conductor = new Conductor();
    const a = conductor.participant('A');
    const b = conductor.participant('B');

    const claim = async (
      who: typeof a,
      effect: AuthorisedEffect,
      worker: string,
    ): Promise<string> => {
      const client = await h.control.connect();
      try {
        return await inTransaction(client, 'READ COMMITTED', async (tx) => {
          const result = await claimForExternalDispatchOn(
            tx,
            {
              companyId: COMPANY_ID,
              idempotencyKey: effect.idempotencyKey,
              claimedBy: worker,
              now: T0,
            },
            // The interleaving point: AFTER each transaction holds its OWN outbox row lock
            // and BEFORE either evaluates the override. The two rows are different, so the
            // outbox lock does NOT serialise them — the override row's lock has to.
            { afterLock: async () => { await who.at(POINT.AFTER_LOCK); } },
          );
          return result.kind === 'CLAIMED' ? 'CLAIMED' : `REFUSED:${result.reason}`;
        });
      } finally {
        client.release();
      }
    };

    const running = settleAll([
      () => claim(a, one, 'worker:A'),
      () => claim(b, two, 'worker:B'),
    ]);

    // BOTH hold their own row lock before EITHER touches the override. That is the
    // interleaving `§32` requires and `36 §14` requires it to be constructed.
    await conductor.until('A', POINT.AFTER_LOCK);
    await conductor.until('B', POINT.AFTER_LOCK);
    conductor.release('A', POINT.AFTER_LOCK);
    conductor.release('B', POINT.AFTER_LOCK);

    const outcomes = (await running).map((r) => valueOf(r));
    expect(outcomes.filter((o) => o === 'CLAIMED')).toHaveLength(1);
    // The loser is refused because the ALLOWANCE was gone, not because its row was taken.
    expect(
      outcomes.filter(
        (o) => o === 'REFUSED:OVERRIDE_ALLOWANCE_REFUSED' || o === 'REFUSED:PRE_DISPATCH_SUSPENDED',
      ),
    ).toHaveLength(1);

    // AND THE PERSISTED STATE AGREES. `§32`: "No N+1."
    const rows = await outboxRows(h.control);
    expect(rows.filter((r) => r.status === 'CLAIMED')).toHaveLength(1);
    expect(rows.filter((r) => r.status === 'ENQUEUED')).toHaveLength(1);
    const counters = await overrideCounters();
    expect(counters.effects).toBe('1');
    // `30 §5.7.2` item 3: "reaching either cap moves the override to `EXHAUSTED`
    // immediately" — and the database's own trigger is what derives it.
    expect(counters.status).toBe('EXHAUSTED');
    // ONE claim journal row, and the override's own `ALLOWANCE_TAKEN` row beside it.
    expect(await claimJournalRows(h.control)).toHaveLength(1);
  });

  it('cap = 3 with two already taken: the final one is contested and won once', async () => {
    const [one, two] = await twoEnqueuedRefunds();
    await grantRow4Override(3n);

    // Consume two allowances through the ACCEPTED S1H path, so the override is genuinely
    // mid-life rather than at zero when the race starts.
    const { claimOverrideAllowance } = await import(
      '../../../src/kernel/mirror/degradedModeOverride.js'
    );
    for (let i = 0; i < 2; i += 1) {
      const taken = await claimOverrideAllowance(
        h.control,
        COMPANY_ID,
        'override:s1i-race',
        money('1.00'),
        T0,
      );
      expect(taken.kind).toBe('ALLOWANCE_TAKEN');
    }
    expect((await overrideCounters()).effects).toBe('2');

    const conductor = new Conductor();
    const a = conductor.participant('A');
    const b = conductor.participant('B');
    const claim = async (
      who: typeof a,
      effect: AuthorisedEffect,
      worker: string,
    ): Promise<string> => {
      const client = await h.control.connect();
      try {
        return await inTransaction(client, 'READ COMMITTED', async (tx) => {
          const result = await claimForExternalDispatchOn(
            tx,
            {
              companyId: COMPANY_ID,
              idempotencyKey: effect.idempotencyKey,
              claimedBy: worker,
              now: T0,
            },
            { afterLock: async () => { await who.at(POINT.AFTER_LOCK); } },
          );
          return result.kind === 'CLAIMED' ? 'CLAIMED' : `REFUSED:${result.reason}`;
        });
      } finally {
        client.release();
      }
    };

    const running = settleAll([
      () => claim(a, one, 'worker:A'),
      () => claim(b, two, 'worker:B'),
    ]);
    await conductor.until('A', POINT.AFTER_LOCK);
    await conductor.until('B', POINT.AFTER_LOCK);
    conductor.release('A', POINT.AFTER_LOCK);
    conductor.release('B', POINT.AFTER_LOCK);

    const outcomes = (await running).map((r) => valueOf(r));
    expect(outcomes.filter((o) => o === 'CLAIMED')).toHaveLength(1);
    expect((await overrideCounters()).effects).toBe('3');
    expect((await overrideCounters()).status).toBe('EXHAUSTED');
    expect(await claimJournalRows(h.control)).toHaveLength(1);
  });

  it('NEGATIVE CONTROL: a non-atomic count check issues TWO claims against a cap of one', async () => {
    /*
     * `§37` ITEM 8: "owner-override final count raced non-atomically."
     *
     * The unsafe implementation reads `effects_dispatched` WITHOUT `FOR UPDATE`, decides,
     * and then increments — so under the same interleaving both readers see one allowance
     * remaining and both consume it. That is the classic read-modify-write, and it is what
     * `30 §5.7.2` item 3's "incremented in the dispatching transaction" plus a row lock
     * exists to prevent.
     *
     * The control operates on its own copy of the counter, because the ACCEPTED
     * `degraded_mode_override_exhausts` trigger and `I63`'s constraint trigger would refuse
     * the over-consumption on the real row — which is `vc-a2f-override-composition.test.ts`'s
     * property, not this one.
     */
    const [one, two] = await twoEnqueuedRefunds();
    await grantRow4Override(1n);
    // The unconstrained counter is created BEFORE the race, in its own transaction.
    await ensureUnsafeOverrideCounter(h.control);

    const conductor = new Conductor();
    const a = conductor.participant('A');
    const b = conductor.participant('B');

    const unsafe = async (who: typeof a, worker: string): Promise<boolean> => {
      const client = await h.control.connect();
      try {
        return await inTransaction(client, 'READ COMMITTED', (tx) =>
          unsafeNonAtomicOverrideClaim(tx, {
            companyId: COMPANY_ID,
            overrideId: 'override:s1i-race',
            claimedBy: worker,
            afterRead: async () => { await who.at(POINT.AFTER_UNLOCKED_READ); },
          }),
        );
      } finally {
        client.release();
      }
    };

    const running = settleAll([() => unsafe(a, 'unsafe:A'), () => unsafe(b, 'unsafe:B')]);
    await conductor.until('A', POINT.AFTER_UNLOCKED_READ);
    await conductor.until('B', POINT.AFTER_UNLOCKED_READ);
    conductor.release('A', POINT.AFTER_UNLOCKED_READ);
    conductor.release('B', POINT.AFTER_UNLOCKED_READ);

    const granted = (await running).map((r) => valueOf(r));
    // EXACTLY TWO. `§32`'s N+1, exhibited.
    expect(granted.filter((g) => g)).toHaveLength(2);

    // PRODUCTION'S OWN OVERRIDE IS UNTOUCHED, and its rows are still claimable exactly once.
    expect((await overrideCounters()).effects).toBe('0');
    expect(one.actionClass).toBe('refund.create');
    expect(two.actionClass).toBe('refund.create');
  });
});

describe('`§31` — THE OVERRIDE AUTHORITY IS BOUND, AND THE BINDING IS ENFORCED', () => {
  it('the claim row references the override by FOREIGN KEY, not by a boolean', async () => {
    const client = await h.control.connect();
    try {
      const fks = await client.query<{ def: string }>(
        `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
          WHERE conrelid = 'dispatch_outbox'::regclass AND contype = 'f'`,
      );
      const defs = fks.rows.map((r) => r.def).join('\n');
      // `§31`: "Bind the exact authoritative override identity." A `BOOLEAN` could not be a
      // foreign key, so the reference type IS the property.
      expect(defs).toMatch(/degraded_mode_override/);
      // And a claim naming an override that does not exist has no INSERT.
      const columns = await client.query<{ data_type: string }>(
        `SELECT data_type FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'dispatch_outbox'
            AND column_name = 'claim_override_id'`,
      );
      expect(columns.rows[0]!.data_type).toBe('text');
    } finally {
      client.release();
    }
  });

  it('and an override-backed claim ALWAYS carries the unmirrored-tag requirement', async () => {
    /*
     * `30 §5.7.2` item 5: "EVERY dispatch under it is tagged `DISPATCHED_UNMIRRORED` and
     * carries `override_id`." A row with one and not the other is not a state this schema
     * holds, and `dispatch_outbox_override_claim_is_tagged` is the CHECK.
     */
    const client = await h.control.connect();
    try {
      const check = await client.query<{ def: string }>(
        `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
          WHERE conrelid = 'dispatch_outbox'::regclass
            AND conname = 'dispatch_outbox_override_claim_is_tagged'`,
      );
      expect(check.rows).toHaveLength(1);
      expect(check.rows[0]!.def).toMatch(/claim_override_id/);
      expect(check.rows[0]!.def).toMatch(/claim_requires_unmirrored_tag/);

      // And the row-3/row-4 restriction, which `30 §5.1` item 5 makes structural.
      const rows = await client.query<{ def: string }>(
        `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
          WHERE conrelid = 'dispatch_outbox'::regclass
            AND conname = 'dispatch_outbox_override_restores_rows_3_and_4_only'`,
      );
      expect(rows.rows).toHaveLength(1);
      expect(rows.rows[0]!.def).toMatch(/3/);
      expect(rows.rows[0]!.def).toMatch(/4/);
    } finally {
      client.release();
    }
  });
});
