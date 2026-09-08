import { createHash } from 'node:crypto';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { COMPANY_ID } from '../support/fixture.js';
import {
  authorisePause,
  authoriseReship,
  createOutboxHarness,
  outboxRowCount,
  outboxRows,
  type AuthorisedEffect,
  type OutboxHarness,
} from '../support/outboxFixture.js';
import { Conductor, POINT, settleAll, valueOf } from '../support/barrier.js';
import { inTransaction } from '../../src/db/pool.js';
import { enqueueDispatch } from '../../src/kernel/outbox/enqueue.js';
import { claimForExternalDispatch } from '../../src/kernel/outbox/claim.js';
import { declareMirrorDegraded } from '../../src/kernel/mirror/mirrorStateMachine.js';
import { mintCorrelationTag } from '../../src/kernel/outbox/correlationTag.js';
import {
  ensureUnsafeOutbox,
  unsafeApplicationOnlyEnqueue,
  unsafeCallerSuppliedRecoverabilityEnqueue,
  unsafeMutateEnqueuedRow,
  unsafeOutboxRowCount,
} from './unsafe-outbox-enqueue.js';
import {
  ensureUnsafeBypassLedger,
  unsafeBypassClaimCount,
  unsafeForceClaim,
  unsafeFullHaltBlindClaim,
} from './unsafe-force-claim.js';

/**
 * `§37` — THE REQUIRED NEGATIVE CONTROLS THAT DO NOT LIVE BESIDE THEIR PROPERTY.
 *
 * =================================================================================
 * `§37` ENUMERATES TEN CONTROLS. FOUR ARE HERE; SIX ARE IN THE SUITE THAT ASSERTS THE
 * PROPERTY THEY DISCRIMINATE, WHICH IS WHERE A REVIEWER LOOKS FOR THEM:
 *
 *   1  application-only duplicate enqueue          HERE
 *   2  claim as SELECT-then-UPDATE                 `outbox-claim.test.ts`
 *   3  CLAIMED reclaimable after a timeout         `outbox-immutability.test.ts`
 *   4  payload reconstructed from live state       `payload-mutation-attack.test.ts`
 *   5  caller-supplied recoverability              HERE
 *   6  eligibility trusted from enqueue time       `outbox-claim-eligibility.test.ts`
 *   7  full-halt ignored at claim                  HERE
 *   8  override final count raced non-atomically   `override-backed-claim-race.test.ts`
 *   9  caller changes correlation tag/payload      HERE
 *  10  claim bypass skipping the S1H classifier    HERE
 *
 * EVERY ONE DISCRIMINATES, and each case below asserts BOTH sides: the unsafe outcome AND
 * the production outcome under identical inputs. `36 §0`: a control that cannot fail proves
 * nothing, and `§38`'s rule generalises — an unsafe path that accidentally behaves safely
 * makes its test invalid rather than passing.
 * =================================================================================
 */

let h: OutboxHarness;
const NOW = new Date('2026-09-05T10:05:00.000Z');

beforeAll(async () => {
  h = await createOutboxHarness();
});

afterAll(async () => {
  await h.close();
});

beforeEach(async () => {
  await h.reset();
});

async function enqueuedPause(resourceId: string): Promise<AuthorisedEffect> {
  const effect = await authorisePause(h, { resourceId });
  const outcome = await enqueueDispatch(h.control, {
    companyId: COMPANY_ID,
    effectId: effect.effectId,
    outboxId: `outbox:${resourceId}`,
    payloadCanonicalBytes: effect.payloadCanonicalBytes,
    now: NOW,
  });
  expect(outcome.kind).toBe('ENQUEUED');
  return effect;
}

describe('`§37` ITEM 1 — APPLICATION-ONLY DUPLICATE PREVENTION', () => {
  it('the unsafe path creates TWO rows for one intended effect; production creates ONE', async () => {
    const effect = await authorisePause(h, { resourceId: 'CMP-APP-ONLY' });
    await ensureUnsafeOutbox(h.control);

    const conductor = new Conductor();
    const a = conductor.participant('A');
    const b = conductor.participant('B');

    const unsafe = async (who: typeof a, outboxId: string): Promise<string> => {
      const client = await h.control.connect();
      try {
        return await inTransaction(client, 'READ COMMITTED', (tx) =>
          unsafeApplicationOnlyEnqueue(tx, {
            companyId: COMPANY_ID,
            effectId: effect.effectId,
            idempotencyKey: effect.idempotencyKey,
            outboxId,
            recoverability: effect.recoverability,
            dispatchPayloadHash: effect.dispatchPayloadHash,
            payloadCanonicalBytes: effect.payloadCanonicalBytes,
            correlationTag: mintCorrelationTag(),
            now: NOW,
            afterLookup: async () => { await who.at(POINT.AFTER_UNLOCKED_READ); },
          }),
        );
      } finally {
        client.release();
      }
    };

    const running = settleAll([() => unsafe(a, 'unsafe:1'), () => unsafe(b, 'unsafe:2')]);
    await conductor.until('A', POINT.AFTER_UNLOCKED_READ);
    await conductor.until('B', POINT.AFTER_UNLOCKED_READ);
    conductor.release('A', POINT.AFTER_UNLOCKED_READ);
    conductor.release('B', POINT.AFTER_UNLOCKED_READ);

    const outcomes = (await running).map((r) => valueOf(r));
    // EXACTLY TWO. The application lookup was kept and it did not help.
    expect(outcomes.filter((o) => o === 'ENQUEUED')).toHaveLength(2);
    expect(await unsafeOutboxRowCount(h.control, COMPANY_ID, effect.idempotencyKey)).toBe(2);

    // PRODUCTION, under the same interleaving, is `outbox-enqueue.test.ts`'s own case; the
    // sequential form is asserted here so both outcomes appear side by side.
    const first = await enqueueDispatch(h.control, {
      companyId: COMPANY_ID,
      effectId: effect.effectId,
      outboxId: 'outbox:prod-1',
      payloadCanonicalBytes: effect.payloadCanonicalBytes,
      now: NOW,
    });
    const second = await enqueueDispatch(h.control, {
      companyId: COMPANY_ID,
      effectId: effect.effectId,
      outboxId: 'outbox:prod-2',
      payloadCanonicalBytes: effect.payloadCanonicalBytes,
      now: NOW,
    });
    expect(first.kind).toBe('ENQUEUED');
    expect(second.kind).toBe('ALREADY_ENQUEUED');
    expect(await outboxRowCount(h.control)).toBe(1);
  });
});

describe('`§37` ITEM 5 / `§12` — CALLER-SUPPLIED RECOVERABILITY', () => {
  it('the unsafe path stores REVERSIBLE for an IRRECOVERABLE action; production stores IRRECOVERABLE', async () => {
    /*
     * `§12`'s required fixture, verbatim: "real action = IRRECOVERABLE; caller claims
     * REVERSIBLE. Unsafe path accepts altered policy class. Production preserves
     * IRRECOVERABLE. Must discriminate."
     */
    const effect = await authoriseReship(h, { resourceId: 'ORD-RELABEL' });
    expect(effect.recoverability).toBe('IRRECOVERABLE');
    await ensureUnsafeOutbox(h.control);

    // THE UNSAFE PATH accepts the caller's claim.
    const stored = await unsafeCallerSuppliedRecoverabilityEnqueue(h.control, {
      companyId: COMPANY_ID,
      effectId: effect.effectId,
      idempotencyKey: effect.idempotencyKey,
      recoverability: 'REVERSIBLE',
      dispatchPayloadHash: effect.dispatchPayloadHash,
      payloadCanonicalBytes: effect.payloadCanonicalBytes,
      now: NOW,
    });
    expect(stored).toBe('REVERSIBLE');

    // PRODUCTION has no parameter to accept, and derives the value in SQL from `effect`.
    const outcome = await enqueueDispatch(h.control, {
      companyId: COMPANY_ID,
      effectId: effect.effectId,
      outboxId: 'outbox:relabel',
      payloadCanonicalBytes: effect.payloadCanonicalBytes,
      now: NOW,
    });
    expect(outcome.kind).toBe('ENQUEUED');
    expect((await outboxRows(h.control))[0]!.recoverability).toBe('IRRECOVERABLE');

    /*
     * AND THE CONSEQUENCE, WHICH IS WHY THE PROPERTY MATTERS. `30 §5.1` row 1 halts every
     * IRRECOVERABLE effect in every mirror state (`22 §3.1`: Halt/Halt/Halt). A relabelled
     * row would reach row 5 and be claimed. The production row is refused at row 1.
     */
    const claim = await claimForExternalDispatch(h.control, {
      companyId: COMPANY_ID,
      idempotencyKey: effect.idempotencyKey,
      claimedBy: 'worker:relabel',
      now: NOW,
    });
    expect(claim.kind).toBe('REFUSED');
    if (claim.kind === 'REFUSED') {
      expect(claim.reason).toBe('PRE_DISPATCH_HALTED');
      expect(claim.decision?.matchedRow).toBe(1);
    }
    expect((await outboxRows(h.control))[0]!.status).toBe('ENQUEUED');
  });

  it('and the DATABASE refuses a relabelled row even on a direct INSERT', async () => {
    // The composite foreign key to `effect (... recoverability ...)` is the enforcement.
    const effect = await authoriseReship(h, { resourceId: 'ORD-RELABEL-SQL' });
    const client = await h.control.connect();
    try {
      await expect(
        client.query(
          `INSERT INTO dispatch_outbox (
             company_id, idempotency_key, outbox_id, effect_id, authorisation_id,
             action_class, recoverability, adapter, resource_ref, effect_status,
             dispatch_payload_hash, payload_canonical_bytes, correlation_tag,
             status, enqueued_at
           )
           SELECT e.company_id, e.idempotency_key, 'outbox:sql-relabel', e.effect_id,
                  e.authorisation_id, e.action_class, 'REVERSIBLE', e.adapter,
                  e.resource_ref, e.status, a.dispatch_payload_hash, $2::BYTEA,
                  'acos-corr-sql-relabel', 'ENQUEUED', $3
             FROM effect e JOIN authorisation a ON a.authorisation_id = e.authorisation_id
            WHERE e.effect_id = $1`,
          [effect.effectId, effect.payloadCanonicalBytes, NOW],
        ),
      ).rejects.toThrow(/violates foreign key|effect_outbox_identity/i);
    } finally {
      client.release();
    }
    expect(await outboxRowCount(h.control)).toBe(0);
  });
});

describe('`§37` ITEM 7 — FULL HALT IGNORED AT CLAIM', () => {
  it('the unsafe evaluator dispatches a REVERSIBLE effect six hours into the stall; production halts', async () => {
    const effect = await enqueuedPause('CMP-BLIND-HALT');
    await declareMirrorDegraded(h.control, COMPANY_ID, 'PUSH_ACK_TIMEOUT', NOW);
    // Six hours — twelve times `51 §3.8`'s declared `PT30M`.
    const deepInStall = new Date(NOW.getTime() + 6 * 60 * 60 * 1000);

    // THE UNSAFE EVALUATOR reads the state, reads the declaration's age, and applies item
    // 4 without item 5's posture.
    const blind = await unsafeFullHaltBlindClaim(h.control, {
      companyId: COMPANY_ID,
      idempotencyKey: effect.idempotencyKey,
      recoverability: 'REVERSIBLE',
      now: deepInStall,
    });
    expect(blind).toBe('DISPATCH_ELIGIBLE');

    // PRODUCTION halts. `30 §5.1` item 5: "halts ALL classes including REVERSIBLE — the
    // point at which the company stops."
    const production = await claimForExternalDispatch(h.control, {
      companyId: COMPANY_ID,
      idempotencyKey: effect.idempotencyKey,
      claimedBy: 'worker:deep-stall',
      now: deepInStall,
    });
    expect(production.kind).toBe('REFUSED');
    if (production.kind === 'REFUSED') {
      expect(production.reason).toBe('PRE_DISPATCH_HALTED');
      // `30 §5.1a`: the posture is REPORTED so a reader can see WHY a REVERSIBLE effect
      // halted — at row 5 with the posture, not at row 1.
      expect(production.decision?.matchedRow).toBe(5);
      expect(production.decision?.fullHaltPosture).toBe(true);
      expect(production.decision?.haltedByFullHaltPosture).toBe(true);
    }
    expect((await outboxRows(h.control))[0]!.status).toBe('ENQUEUED');
  });

  it('and the same effect IS claimable one millisecond before the threshold', async () => {
    // The boundary, from the other side, so the previous case is not passing because
    // nothing was ever claimable.
    const effect = await enqueuedPause('CMP-BLIND-HALT-UNDER');
    await declareMirrorDegraded(h.control, COMPANY_ID, 'PUSH_ACK_TIMEOUT', NOW);
    const justUnder = new Date(NOW.getTime() + 30 * 60_000 - 1);
    const claim = await claimForExternalDispatch(h.control, {
      companyId: COMPANY_ID,
      idempotencyKey: effect.idempotencyKey,
      claimedBy: 'worker:just-under',
      now: justUnder,
    });
    expect(claim.kind).toBe('CLAIMED');
    if (claim.kind === 'CLAIMED') {
      expect(claim.claim.decision.fullHaltPosture).toBe(false);
    }
  });
});

describe('`§37` ITEM 9 — THE CALLER CHANGES THE PAYLOAD OR THE TAG AFTER ENQUEUE', () => {
  it('the unsafe row accepts both; the production row refuses both', async () => {
    const effect = await enqueuedPause('CMP-POST-MUTATE');
    await ensureUnsafeOutbox(h.control);
    await unsafeCallerSuppliedRecoverabilityEnqueue(h.control, {
      companyId: COMPANY_ID,
      effectId: effect.effectId,
      idempotencyKey: effect.idempotencyKey,
      recoverability: effect.recoverability,
      dispatchPayloadHash: effect.dispatchPayloadHash,
      payloadCanonicalBytes: effect.payloadCanonicalBytes,
      now: NOW,
    });

    const substituted = Buffer.from('a payload nobody authorised');
    const after = await unsafeMutateEnqueuedRow(h.control, {
      companyId: COMPANY_ID,
      idempotencyKey: effect.idempotencyKey,
      newPayload: substituted,
      newCorrelationTag: 'acos-corr-substituted',
    });
    // THE UNSAFE ROW NOW CARRIES A PAYLOAD THAT DOES NOT HASH TO ITS OWN STORED HASH.
    expect(after.payload.equals(substituted)).toBe(true);
    expect(after.correlationTag).toBe('acos-corr-substituted');
    expect(createHash('sha256').update(after.payload).digest('hex')).not.toBe(
      effect.dispatchPayloadHash,
    );

    // PRODUCTION refuses both, and the refusals name the mechanism.
    const client = await h.control.connect();
    try {
      await expect(
        client.query(
          `UPDATE dispatch_outbox SET payload_canonical_bytes = $3
            WHERE company_id = $1 AND idempotency_key = $2`,
          [COMPANY_ID, effect.idempotencyKey, substituted],
        ),
      ).rejects.toThrow(/OUTBOX_IDENTITY_IMMUTABLE|OUTBOX_TRANSITION_UNDECLARED|dispatch_outbox_payload_binds_hash/);
      await expect(
        client.query(
          `UPDATE dispatch_outbox SET correlation_tag = 'acos-corr-substituted'
            WHERE company_id = $1 AND idempotency_key = $2`,
          [COMPANY_ID, effect.idempotencyKey],
        ),
      ).rejects.toThrow(/OUTBOX_IDENTITY_IMMUTABLE|OUTBOX_TRANSITION_UNDECLARED/);
    } finally {
      client.release();
    }
    const row = (await outboxRows(h.control))[0]!;
    expect(row.payloadCanonicalBytes.equals(effect.payloadCanonicalBytes)).toBe(true);
    expect(row.correlationTag).toMatch(/^acos-corr-/);
    expect(row.correlationTag).not.toBe('acos-corr-substituted');
  });
});

describe('`§37` ITEM 10 / `§30` — A CLAIM BYPASS', () => {
  it('`forceClaim` claims a HALTED effect; the production surface refuses it', async () => {
    const effect = await authoriseReship(h, { resourceId: 'ORD-BYPASS' });
    await enqueueDispatch(h.control, {
      companyId: COMPANY_ID,
      effectId: effect.effectId,
      outboxId: 'outbox:bypass-irrecoverable',
      payloadCanonicalBytes: effect.payloadCanonicalBytes,
      now: NOW,
    });
    await ensureUnsafeBypassLedger(h.control);

    // THE BYPASS. An IRRECOVERABLE effect — `30 §5.1` row 1, Halt in every state — claimed
    // with no evaluation of any kind.
    const forced = await unsafeForceClaim(h.control, {
      companyId: COMPANY_ID,
      idempotencyKey: effect.idempotencyKey,
      claimId: 'claim:forced',
    });
    expect(forced).toBe('CLAIMED');
    expect(await unsafeBypassClaimCount(h.control, COMPANY_ID, effect.idempotencyKey)).toBe(1);

    // THE PRODUCTION SURFACE. `§30`: "call the most public claim surface while effect is
    // HALTED. Expected: no claim."
    const production = await claimForExternalDispatch(h.control, {
      companyId: COMPANY_ID,
      idempotencyKey: effect.idempotencyKey,
      claimedBy: 'worker:bypass-attempt',
      now: NOW,
    });
    expect(production.kind).toBe('REFUSED');
    if (production.kind === 'REFUSED') {
      expect(production.reason).toBe('PRE_DISPATCH_HALTED');
      expect(production.decision?.matchedRow).toBe(1);
      // And there is no owner escape to offer: `30 §5.1` item 5 makes rows 1 and 2
      // unreachable by override.
      expect(production.decision?.ownerOverrideAvailable).toBe(false);
    }
    expect((await outboxRows(h.control))[0]!.status).toBe('ENQUEUED');
  });
});
