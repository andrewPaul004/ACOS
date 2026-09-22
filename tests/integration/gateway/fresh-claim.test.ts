import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { COMPANY_ID } from '../../support/fixture.js';
import {
  S1I_NOW,
  authorisePause,
  createOutboxHarness,
  outboxRows,
  type AuthorisedEffect,
  type OutboxHarness,
} from '../../support/outboxFixture.js';
import {
  ADAPTER_ADS,
  dispatchEnv,
  dispatchEnvWith,
  rawOutcomeRows,
  testRegistry,
} from '../../support/gatewayFixture.js';
import { createMockAdapter, returnedOutcome } from '../../support/mockAdapter.js';
import { enqueueDispatch } from '../../../src/kernel/outbox/enqueue.js';
import { dispatchAuthorisedEffect } from '../../../src/kernel/gateway/effectGateway.js';
import {
  consumeFreshDispatchCapability,
  liveCapabilityCount,
  mintFreshDispatchCapability,
  readDispatchAttestation,
  type DispatchAttestation,
  type FreshDispatchCapability,
} from '../../../src/kernel/gateway/dispatchCapability.js';
import { processAdapterOutcome } from '../../../src/kernel/gateway/outcomeTransaction.js';
import {
  unsafeDispatchAllClaimed,
  unsafeDispatchClaimed,
} from '../../negative-controls/unsafe-dispatch-claimed.js';

/**
 * `§5`, `§23`, `§24` — ONLY A FRESH CLAIM CAN INVOKE AN ADAPTER.
 *
 * =================================================================================
 * THE PROPERTY, AND THE ONE FAILURE `§50` SAYS IS FATAL
 *
 * `§50`: "FAIL if restart can dispatch a stale CLAIMED row or a money unknown can become
 * blindly retryable."
 *
 * `§24`'s fixture, run for real:
 *
 *   1. claim succeeds and returns fresh in-memory dispatch capability;
 *   2. process dies;
 *   3. capability disappears;
 *   4. persisted row remains CLAIMED;
 *   5. restart;
 *   6. no API can reconstruct the capability;
 *   7. adapter invocation count remains unchanged.
 *
 * `§23` IS THE ARCHITECTURE REVIEW BEHIND IT, AND ITS ANSWER IS "REMAIN `CLAIMED`". For a
 * restart that finds only `CLAIMED` with no durable outcome, v1.3.4 declares no automatic
 * transition: `25 §7` (OBX-01) says the row "is never the subject of a retry that
 * re-claims" and gives it no timeout, lease, expiry or reclaim; `35 §12.3` says "On
 * recovery, ACOS does not know whether the message was accepted"; and `I9` — "no effect is
 * in a non-terminal state past its SLA" — is the DETECTOR that it is still sitting there,
 * escalating "with the effect's reconciliation history attached". So production leaves it
 * `CLAIMED`, escalation is `I9`'s scheduled job (not built here), and NOTHING transitions
 * it by elapsed time. `S1J-result.md §11` records this as the declared answer rather than
 * an inference.
 * =================================================================================
 */

let h: OutboxHarness;
const NOW = S1I_NOW;

beforeAll(async () => {
  h = await createOutboxHarness();
});

afterAll(async () => {
  await h.close();
});

beforeEach(async () => {
  await h.reset();
});

async function enqueuedPause(tag: string): Promise<AuthorisedEffect> {
  const effect = await authorisePause(h, { resourceId: `CMP-${tag}` });
  const outcome = await enqueueDispatch(h.control, {
    companyId: COMPANY_ID,
    effectId: effect.effectId,
    outboxId: `outbox:${tag}`,
    payloadCanonicalBytes: effect.payloadCanonicalBytes,
    now: NOW,
  });
  expect(outcome.kind).toBe('ENQUEUED');
  return effect;
}

describe('`§24` — THE CRASH BETWEEN CLAIM COMMIT AND INVOCATION', () => {
  it('the whole fixture: crash, restart, no reconstruction, invocation count unchanged', async () => {
    const effect = await enqueuedPause('fresh-crash');
    const mock = createMockAdapter({
      adapterId: ADAPTER_ADS,
      resolutionCapabilities: ['IDEMPOTENCY_HEADER'],
      outcome: returnedOutcome(),
    });
    const registry = testRegistry(mock);

    // STEP 1 AND 2. The claim commits, then the process dies — modelled as a throw at the
    // kill point `§22` item 2 names: "after claim commits, before mock invocation".
    await expect(
      dispatchAuthorisedEffect(
        dispatchEnvWith(h, registry),
        
        {
          companyId: COMPANY_ID,
          idempotencyKey: effect.idempotencyKey,
          dispatchedBy: 'worker:crash',
          now: NOW,
        },
        {
          hooks: {
            afterClaimCommit: () => Promise.reject(new Error('SIGKILL after claim COMMIT')),
          },
        },
      ),
    ).rejects.toThrow('SIGKILL after claim COMMIT');

    // STEP 3. The capability is gone. Not leaked, not parked, not recoverable.
    expect(liveCapabilityCount()).toBe(0);

    // STEP 4. The row is durably `CLAIMED`, and no outcome exists.
    const afterCrash = (await outboxRows(h.control))[0]!;
    expect(afterCrash.status).toBe('CLAIMED');
    expect(afterCrash.claimId).not.toBeNull();
    expect(await rawOutcomeRows(h.control)).toHaveLength(0);

    // AND THE MOCK WAS NEVER INVOKED. The crash is before the invocation, so `§22` item
    // 2's row of the matrix reads: 0 calls, 0 accepted.
    expect(mock.callCount).toBe(0);
    expect(mock.acceptedCount).toBe(0);

    // STEPS 5 AND 6. "Restart": the same production entry point, called again. It is the
    // ONLY production dispatch surface, and it refuses — because the claim it would need is
    // already taken and `25 §7` admits no second transition into `CLAIMED`.
    const afterRestart = await dispatchAuthorisedEffect(dispatchEnvWith(h, registry),  {
      companyId: COMPANY_ID,
      idempotencyKey: effect.idempotencyKey,
      dispatchedBy: 'worker:restarted',
      now: new Date(NOW.getTime() + 60 * 60 * 1000),
    });
    expect(afterRestart.kind).toBe('CLAIM_REFUSED');
    if (afterRestart.kind === 'CLAIM_REFUSED') {
      expect(afterRestart.reason).toBe('ALREADY_CLAIMED');
    }

    // STEP 7. Unchanged.
    expect(mock.callCount).toBe(0);
    expect(mock.acceptedCount).toBe(0);
    expect(await rawOutcomeRows(h.control)).toHaveLength(0);
  });

  it('THE DISCRIMINATOR — `§40` item 1: the unsafe path dispatches the same row', async () => {
    /*
     * `§5`: "Must discriminate."
     *
     * Same fixture, same database state, same mock. The only difference is which function
     * is asked to dispatch, and that is the whole finding: a persisted `CLAIMED` row
     * contains everything a plausible recovery path needs, and production still refuses
     * because the ONE thing it also needs is not in the database.
     */
    const effect = await enqueuedPause('fresh-discriminate');
    const mock = createMockAdapter({
      adapterId: ADAPTER_ADS,
      resolutionCapabilities: ['IDEMPOTENCY_HEADER'],
      outcome: returnedOutcome(),
    });

    await expect(
      dispatchAuthorisedEffect(
        dispatchEnv(h,
        mock),
        {
          companyId: COMPANY_ID,
          idempotencyKey: effect.idempotencyKey,
          dispatchedBy: 'worker:crash',
          now: NOW,
        },
        { hooks: { afterClaimCommit: () => Promise.reject(new Error('crash')) } },
      ),
    ).rejects.toThrow('crash');
    expect(mock.callCount).toBe(0);

    // PRODUCTION, after the restart: refused.
    const production = await dispatchAuthorisedEffect(dispatchEnv(h, mock), {
      companyId: COMPANY_ID,
      idempotencyKey: effect.idempotencyKey,
      dispatchedBy: 'worker:restarted',
      now: NOW,
    });
    expect(production.kind).toBe('CLAIM_REFUSED');
    expect(mock.callCount).toBe(0);

    // UNSAFE, on the same row: DISPATCHED.
    const unsafe = await unsafeDispatchClaimed(h.control, 'outbox:fresh-discriminate', mock);
    expect(unsafe.kind).toBe('DISPATCHED');
    expect(mock.callCount).toBe(1);
    expect(mock.acceptedCount).toBe(1);

    // And the forbidden startup sweep dispatches it again, unboundedly, because nothing
    // about the row ever stops being sweepable. `§23`: "Do NOT build `on startup, dispatch
    // all CLAIMED rows`. That is forbidden."
    const swept = await unsafeDispatchAllClaimed(h.control, COMPANY_ID, mock);
    expect(swept).toBe(1);
    expect(mock.callCount).toBe(2);
  });

  it('and production has NO scheduler, poller or sweep to be the unsafe path', async () => {
    /*
     * The absence is asserted over the source in `no-real-transport-boundary.test.ts`. Here
     * it is asserted behaviourally: with two orphaned `CLAIMED` rows in the database and a
     * registry holding a working adapter, nothing happens unless someone calls the gateway
     * for a specific effect, and the gateway then refuses.
     */
    const first = await enqueuedPause('orphan-1');
    const second = await enqueuedPause('orphan-2');
    const mock = createMockAdapter({
      adapterId: ADAPTER_ADS,
      resolutionCapabilities: ['IDEMPOTENCY_HEADER'],
      outcome: returnedOutcome(),
    });
    const registry = testRegistry(mock);

    for (const effect of [first, second]) {
      await expect(
        dispatchAuthorisedEffect(
          dispatchEnvWith(h, registry),
          
          {
            companyId: COMPANY_ID,
            idempotencyKey: effect.idempotencyKey,
            dispatchedBy: 'worker:crash',
            now: NOW,
          },
          { hooks: { afterClaimCommit: () => Promise.reject(new Error('crash')) } },
        ),
      ).rejects.toThrow('crash');
    }

    const rows = await outboxRows(h.control);
    expect(rows.map((r) => r.status)).toEqual(['CLAIMED', 'CLAIMED']);
    expect(mock.callCount).toBe(0);
    expect(await rawOutcomeRows(h.control)).toHaveLength(0);
    expect(liveCapabilityCount()).toBe(0);
  });
});

describe('`§5` — THE CAPABILITY ITSELF', () => {
  it('is single-use: a second consumption of the same handle is refused', () => {
    const identity = {
      companyId: COMPANY_ID,
      idempotencyKey: 'idem:cap-1',
      outboxId: 'outbox:cap-1',
      effectId: 'effect:cap-1',
      claimId: 'claim:cap-1',
    };
    const capability = mintFreshDispatchCapability(identity, NOW);
    expect(consumeFreshDispatchCapability(capability, identity).kind).toBe('CAPABILITY_CONSUMED');
    const second = consumeFreshDispatchCapability(capability, identity);
    expect(second.kind).toBe('REFUSED');
    if (second.kind === 'REFUSED') expect(second.reason).toBe('CAPABILITY_NOT_LIVE');
    expect(liveCapabilityCount()).toBe(0);
  });

  it('is bound to one identity: a capability for effect A cannot dispatch effect B', () => {
    const a = {
      companyId: COMPANY_ID,
      idempotencyKey: 'idem:A',
      outboxId: 'outbox:A',
      effectId: 'effect:A',
      claimId: 'claim:A',
    };
    const b = { ...a, idempotencyKey: 'idem:B', outboxId: 'outbox:B', effectId: 'effect:B' };
    const capability = mintFreshDispatchCapability(a, NOW);
    const wrong = consumeFreshDispatchCapability(capability, b);
    expect(wrong.kind).toBe('REFUSED');
    if (wrong.kind === 'REFUSED') expect(wrong.reason).toBe('CAPABILITY_IDENTITY_MISMATCH');
    // AND IT IS BURNED. A mismatched use does not leave it live for a third attempt.
    expect(consumeFreshDispatchCapability(capability, a).kind).toBe('REFUSED');
    expect(liveCapabilityCount()).toBe(0);
  });

  it('cannot be fabricated, cloned or round-tripped through JSON', () => {
    /*
     * `§5`: "not reconstructable by loading a CLAIMED row; not accepted from user/model
     * input". The TYPE half is `tests/type-negative/gateway-caller-supplied-authority.ts`;
     * this is the RUNTIME half, because a JavaScript caller with a cast can present
     * anything.
     */
    const identity = {
      companyId: COMPANY_ID,
      idempotencyKey: 'idem:forge',
      outboxId: 'outbox:forge',
      effectId: 'effect:forge',
      claimId: 'claim:forge',
    };
    const real = mintFreshDispatchCapability(identity, NOW);

    // An object literal.
    const fabricated = {} as unknown as FreshDispatchCapability;
    expect(consumeFreshDispatchCapability(fabricated, identity).kind).toBe('REFUSED');

    // A structural clone of the real handle.
    const cloned = { ...real } as unknown as FreshDispatchCapability;
    expect(consumeFreshDispatchCapability(cloned, identity).kind).toBe('REFUSED');

    // A JSON round trip. It cannot even be serialised: `toJSON` throws rather than quietly
    // producing `{}`, so a capability cannot reach a log line, a queue message or a worker
    // result by accident.
    expect(() => JSON.stringify(real)).toThrow(/not serialisable/);

    // And the real one still works, so the refusals above were about the handles and not
    // about the registry having been emptied.
    expect(consumeFreshDispatchCapability(real, identity).kind).toBe('CAPABILITY_CONSUMED');
  });

  it('carries no readable data, so nothing can be recovered from a captured handle', () => {
    const identity = {
      companyId: COMPANY_ID,
      idempotencyKey: 'idem:opaque',
      outboxId: 'outbox:opaque',
      effectId: 'effect:opaque',
      claimId: 'claim:opaque',
    };
    const capability = mintFreshDispatchCapability(identity, NOW);
    // No own enumerable properties: the identity lives in the module-private map.
    expect(Object.keys(capability)).toEqual([]);
    expect(Object.getOwnPropertyNames(capability)).toEqual(['toJSON']);
    expect(Object.isFrozen(capability)).toBe(true);
    consumeFreshDispatchCapability(capability, identity);
  });
});

describe('`§34` — AN OUTCOME CANNOT BE SUBMITTED WITHOUT AN ATTESTATION', () => {
  it('a fabricated attestation reads as absent and the outcome transaction refuses', async () => {
    /*
     * The runtime half of `§34`'s "submit adapter outcome". A caller that has read the
     * outbox row, knows the claim id and wants the effect marked resolved has everything
     * except an attestation — and an attestation is minted only by an invocation this
     * process performed.
     */
    const effect = await enqueuedPause('attest');
    const mock = createMockAdapter({
      adapterId: ADAPTER_ADS,
      resolutionCapabilities: ['IDEMPOTENCY_HEADER'],
      outcome: returnedOutcome(),
    });
    // Claim it (and crash before invocation), so the row is CLAIMED and outcome-less.
    await expect(
      dispatchAuthorisedEffect(
        dispatchEnv(h,
        mock),
        {
          companyId: COMPANY_ID,
          idempotencyKey: effect.idempotencyKey,
          dispatchedBy: 'worker:crash',
          now: NOW,
        },
        { hooks: { afterClaimCommit: () => Promise.reject(new Error('crash')) } },
      ),
    ).rejects.toThrow('crash');

    const row = (await outboxRows(h.control))[0]!;
    const fabricated = {} as unknown as DispatchAttestation;
    expect(readDispatchAttestation(fabricated)).toBeUndefined();

    const result = await processAdapterOutcome(h.control, {
      attestation: fabricated,
      identity: {
        companyId: COMPANY_ID,
        idempotencyKey: effect.idempotencyKey,
        outboxId: row.outboxId,
        effectId: row.effectId,
        claimId: row.claimId!,
      },
      now: NOW,
    });
    expect(result.kind).toBe('REFUSED');
    if (result.kind === 'REFUSED') expect(result.reason).toBe('ATTESTATION_NOT_LIVE');
    expect(await rawOutcomeRows(h.control)).toHaveLength(0);
  });
});
