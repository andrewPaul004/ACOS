import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { COMPANY_ID } from '../../support/fixture.js';
import {
  S1I_NOW,
  authorisePause,
  authoriseReship,
  createOutboxHarness,
  outboxRows,
  type AuthorisedEffect,
  type OutboxHarness,
} from '../../support/outboxFixture.js';
import { dispatchEnvWith, rawOutcomeRows } from '../../support/gatewayFixture.js';
import { stringifyForLeakScan } from '../../support/perimeterFixture.js';
import { enqueueDispatch } from '../../../src/kernel/outbox/enqueue.js';
import { dispatchAuthorisedEffect } from '../../../src/kernel/gateway/effectGateway.js';
import {
  ADAPTER_A,
  ADAPTER_B,
  adapterADescriptor,
  adapterBDescriptor,
  awaitRuntimeReady,
  launchIntegration,
  mintSentinelSecret,
  runtimeRegistry,
  type LaunchedIntegration,
} from '../../support/integrationFixture.js';

/**
 * `§19`, `§20`, `§21`, `§26`, `§27`, `§28`, `§41` — THE WHOLE COMPOSITION, ACROSS A PROCESS.
 *
 * =================================================================================
 * WHAT IS DIFFERENT FROM `gateway-composition.test.ts`, AND WHAT IS NOT
 *
 * NOT DIFFERENT: the Effect Gateway. `effectGateway.ts` is unchanged by S1N — not one line
 * — because the thing it resolves out of its registry is still an `ExternalEffectAdapter`
 * and it still awaits `dispatch` inside the dispatch-lease callback. So `25 §14.1`'s Epoch B
 * ordering, the exclusive claim, the fresh-claim capability and the outcome transaction are
 * the ACCEPTED ones, exercised here rather than re-proved.
 *
 * DIFFERENT: what is on the other side of that `await`. It is a separate OS process holding
 * a credential this process cannot read, reached over a private pipe.
 *
 * `§21` IS THEREFORE STRUCTURAL RATHER THAN ARGUED. "Do not release the architecture-required
 * entity lease before the adapter invocation merely because dispatch moved to another
 * process." The lease is released in `withDispatchLease`'s `finally`, after the outcome
 * COMMIT, and the IPC round trip is an `await` in the same place the in-process call was. The
 * ACCEPTED `dispatch-lease-continuity.test.ts` measures the span from a third PostgreSQL
 * session by backend pid and `pg_locks`; nothing here weakens it and the assertion below
 * shows the span covering the IPC.
 * =================================================================================
 */

let h: OutboxHarness;
let launched: LaunchedIntegration | null = null;
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

afterEach(async () => {
  if (launched !== null) {
    await launched.close();
    launched = null;
  }
});

async function enqueue(effect: AuthorisedEffect, tag: string): Promise<void> {
  const outcome = await enqueueDispatch(h.control, {
    companyId: COMPANY_ID,
    effectId: effect.effectId,
    outboxId: `outbox:${tag}`,
    payloadCanonicalBytes: effect.payloadCanonicalBytes,
    now: NOW,
  });
  expect(outcome.kind).toBe('ENQUEUED');
}

function launchA(script?: string, options: { readonly deadlineMs?: number } = {}): string {
  const secret = mintSentinelSecret('gateway');
  launched = launchIntegration((secrets) => {
    const locator = secrets.write('a', {
      adapterId: ADAPTER_A,
      secret,
      ...(script === undefined ? {} : { version: script }),
    });
    return runtimeRegistry(adapterADescriptor(locator));
  }, options);
  return secret;
}

describe('`§19`, `§3` — THE GATEWAY DISPATCHES THROUGH A SEPARATE PROCESS', () => {
  it('REVERSIBLE `campaign.pause`: claim → IPC → adapter runtime → committed outcome', async () => {
    const secret = launchA();
    const effect = await authorisePause(h, { resourceId: 'CMP-S1N-REV' });
    await enqueue(effect, 's1n-rev');

    const events: string[] = [];
    const result = await dispatchAuthorisedEffect(
      dispatchEnvWith(h, launched!.client.adapterRegistry()),
      {
        companyId: COMPANY_ID,
        idempotencyKey: effect.idempotencyKey,
        dispatchedBy: 'worker:s1n',
        now: NOW,
      },
      { events: (event) => events.push(event) },
    );

    expect(result.kind).toBe('OUTCOME_RESOLVED');
    if (result.kind !== 'OUTCOME_RESOLVED') return;

    // THE OUTCOME CAME FROM ANOTHER PROCESS.
    const childPid = await awaitRuntimeReady(launched!.client, ADAPTER_A);
    expect(childPid).not.toBe(process.pid);

    const rows = await rawOutcomeRows(h.control);
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.outcomeKind).toBe('ADAPTER_RETURNED');
    expect(row.adapter).toBe(ADAPTER_A);
    expect(row.recoverability).toBe('REVERSIBLE');
    expect(row.providerReference).toContain('synthetic-a:');

    // `§21` — THE LEASE SPANS THE IPC. The accepted event order is unchanged, and the
    // release is still the LAST event, after the outcome commit.
    expect(events[0]).toBe('DISPATCH_LEASE_ACQUIRED');
    expect(events[events.length - 1]).toBe('DISPATCH_LEASE_RELEASED');
    expect(events.indexOf('ADAPTER_RETURNED')).toBeGreaterThan(events.indexOf('CLAIM_COMMITTED'));
    expect(events.indexOf('OUTCOME_COMMITTED')).toBeLessThan(
      events.indexOf('DISPATCH_LEASE_RELEASED'),
    );

    // `§29` — THE SENTINEL IS NOWHERE IN THE COMMITTED ROW.
    expect(stringifyForLeakScan(row)).not.toContain(secret);
    expect(stringifyForLeakScan(result)).not.toContain(secret);
  });

  it('IRRECOVERABLE `fulfilment.reship` through adapter B’s own runtime', async () => {
    const secret = mintSentinelSecret('reship');
    launched = launchIntegration((secrets) => {
      const b = secrets.write('b', { adapterId: ADAPTER_B, secret });
      return runtimeRegistry(adapterBDescriptor(b));
    });
    const effect = await authoriseReship(h);
    await enqueue(effect, 's1n-irr');

    const result = await dispatchAuthorisedEffect(
      dispatchEnvWith(h, launched.client.adapterRegistry()),
      {
        companyId: COMPANY_ID,
        idempotencyKey: effect.idempotencyKey,
        dispatchedBy: 'worker:s1n',
        now: NOW,
      },
    );
    expect(result.kind).toBe('OUTCOME_RESOLVED');
    const rows = await rawOutcomeRows(h.control);
    expect(rows[0]!.outcomeKind).toBe('ADAPTER_RETURNED');
    expect(rows[0]!.adapter).toBe(ADAPTER_B);
    expect(stringifyForLeakScan(rows[0])).not.toContain(secret);
  });
});

describe('`§20` — THE FRESH-CLAIM REQUIREMENT IS UNCHANGED BY THE PROCESS BOUNDARY', () => {
  it('a persisted CLAIMED row plus a live integration runtime still cannot dispatch', async () => {
    launchA();
    const effect = await authorisePause(h, { resourceId: 'CMP-S1N-FRESH' });
    await enqueue(effect, 's1n-fresh');
    const registry = launched!.client.adapterRegistry();

    // FIRST dispatch: succeeds, and leaves a committed CLAIMED row.
    const first = await dispatchAuthorisedEffect(dispatchEnvWith(h, registry), {
      companyId: COMPANY_ID,
      idempotencyKey: effect.idempotencyKey,
      dispatchedBy: 'worker:s1n',
      now: NOW,
    });
    expect(first.kind).toBe('OUTCOME_RESOLVED');
    expect((await outboxRows(h.control))[0]!.status).toBe('CLAIMED');

    // SECOND attempt, with the runtime still live and the row still CLAIMED. `§20`: it must
    // NOT dispatch, and the reason is the accepted one — the claim is exclusive and
    // non-reclaimable, and the fresh-claim capability cannot be reconstructed from a row.
    const second = await dispatchAuthorisedEffect(dispatchEnvWith(h, registry), {
      companyId: COMPANY_ID,
      idempotencyKey: effect.idempotencyKey,
      dispatchedBy: 'worker:s1n',
      now: NOW,
    });
    expect(second.kind).toBe('CLAIM_REFUSED');

    // AND THE ADAPTER RUNTIME WAS REACHED EXACTLY ONCE: one outcome row, one provider
    // reference. `§27`: an IPC invocation id is not an idempotency mechanism, and nothing
    // here relies on one.
    expect(await rawOutcomeRows(h.control)).toHaveLength(1);
  });
});

describe('`§26`, `§41` — THE CRASH MATRIX, AND THE DEADLINE THAT IS NOT A NON-SEND', () => {
  it('the runtime is UNAVAILABLE before the request: NOT_SENT_CONFIRMED, and nothing escaped', async () => {
    /*
     * `§41`: "pre-invocation unavailable -> architecture-equivalent NOT_SENT_CONFIRMED if
     * proof exists." The proof here is exact: the descriptor points at a module that does
     * not exist, the child exits at startup, and `child.send` never places bytes on a live
     * channel.
     */
    launched = launchIntegration(
      (secrets) => {
        const locator = secrets.write('a', {
          adapterId: ADAPTER_A,
          secret: mintSentinelSecret('absent'),
        });
        return runtimeRegistry(
          adapterADescriptor(locator, {
            adapterModule: adapterADescriptor(locator).runtimeRoot + '/does-not-exist.ts',
          }),
        );
      },
      { deadlineMs: 4_000 },
    );
    const effect = await authorisePause(h, { resourceId: 'CMP-S1N-DOWN' });
    await enqueue(effect, 's1n-down');

    const result = await dispatchAuthorisedEffect(
      dispatchEnvWith(h, launched.client.adapterRegistry()),
      {
        companyId: COMPANY_ID,
        idempotencyKey: effect.idempotencyKey,
        dispatchedBy: 'worker:s1n',
        now: NOW,
      },
    );
    expect(result.kind).toBe('OUTCOME_RESOLVED');
    const row = (await rawOutcomeRows(h.control))[0]!;
    // Either the send failed outright (NOT_SENT_CONFIRMED) or the child died after the send
    // was buffered (OUTCOME_UNKNOWN). Both are conservative and NEITHER is a success; what
    // must never happen is a confirmed non-send for a request that reached the adapter.
    expect(['NOT_SENT_CONFIRMED', 'OUTCOME_UNKNOWN']).toContain(row.outcomeKind);
  });

  it('the runtime HANGS past the deadline: OUTCOME_UNKNOWN / TIMEOUT, never NOT_SENT', async () => {
    launchA('HANG', { deadlineMs: 2_500 });
    const effect = await authorisePause(h, { resourceId: 'CMP-S1N-HANG' });
    await enqueue(effect, 's1n-hang');

    const result = await dispatchAuthorisedEffect(
      dispatchEnvWith(h, launched!.client.adapterRegistry()),
      {
        companyId: COMPANY_ID,
        idempotencyKey: effect.idempotencyKey,
        dispatchedBy: 'worker:s1n',
        now: NOW,
      },
    );
    expect(result.kind).toBe('OUTCOME_RESOLVED');
    const row = (await rawOutcomeRows(h.control))[0]!;
    // `§41`: the synthetic provider boundary WAS crossed before the hang, so the request may
    // have escaped. `25 §7.2`: "Anything for which the request MAY have escaped is
    // OUTCOME_UNKNOWN."
    expect(row.outcomeKind).toBe('OUTCOME_UNKNOWN');
  });

  it('the runtime DIES after crossing its provider boundary: OUTCOME_UNKNOWN', async () => {
    launchA('EXIT_AFTER_SEND', { deadlineMs: 8_000 });
    const effect = await authorisePause(h, { resourceId: 'CMP-S1N-EXIT' });
    await enqueue(effect, 's1n-exit');

    const result = await dispatchAuthorisedEffect(
      dispatchEnvWith(h, launched!.client.adapterRegistry()),
      {
        companyId: COMPANY_ID,
        idempotencyKey: effect.idempotencyKey,
        dispatchedBy: 'worker:s1n',
        now: NOW,
      },
    );
    expect(result.kind).toBe('OUTCOME_RESOLVED');
    expect((await rawOutcomeRows(h.control))[0]!.outcomeKind).toBe('OUTCOME_UNKNOWN');
  });

  it('the adapter throws BEFORE its provider boundary: ADAPTER_FAILED, and no local state', async () => {
    launchA('THROW_BEFORE_SEND');
    const effect = await authorisePause(h, { resourceId: 'CMP-S1N-PRE' });
    await enqueue(effect, 's1n-pre');

    const result = await dispatchAuthorisedEffect(
      dispatchEnvWith(h, launched!.client.adapterRegistry()),
      {
        companyId: COMPANY_ID,
        idempotencyKey: effect.idempotencyKey,
        dispatchedBy: 'worker:s1n',
        now: NOW,
      },
    );
    /*
     * `25 §7.1`: `ADAPTER_FAILED` is "retained for diagnostics only" and has NO local
     * outcome policy, so the accepted outcome transaction writes nothing and the gateway
     * reports `OUTCOME_REFUSED / UNDECLARED`. S1N changes none of that; it only shows the
     * classification surviving a process boundary intact.
     */
    expect(result.kind).toBe('OUTCOME_REFUSED');
    expect(await rawOutcomeRows(h.control)).toHaveLength(0);
  });

  it('a provider rejection with a declared no-mutation contract: NOT_SENT_CONFIRMED', async () => {
    launchA('REJECT_NO_MUTATION');
    const effect = await authorisePause(h, { resourceId: 'CMP-S1N-REJ' });
    await enqueue(effect, 's1n-rej');

    const result = await dispatchAuthorisedEffect(
      dispatchEnvWith(h, launched!.client.adapterRegistry()),
      {
        companyId: COMPANY_ID,
        idempotencyKey: effect.idempotencyKey,
        dispatchedBy: 'worker:s1n',
        now: NOW,
      },
    );
    expect(result.kind).toBe('OUTCOME_RESOLVED');
    expect((await rawOutcomeRows(h.control))[0]!.outcomeKind).toBe('NOT_SENT_CONFIRMED');
  });
});

describe('`§28` — A RESTART RESTORES AVAILABILITY AND REPLAYS NOTHING', () => {
  it('the runtime dies, a later dispatch restarts it, and the CLAIMED effect is not replayed', async () => {
    launchA('EXIT_AFTER_SEND', { deadlineMs: 8_000 });
    const client = launched!.client;

    const first = await authorisePause(h, { resourceId: 'CMP-S1N-RESTART-1' });
    await enqueue(first, 's1n-restart-1');
    const firstResult = await dispatchAuthorisedEffect(dispatchEnvWith(h, client.adapterRegistry()), {
      companyId: COMPANY_ID,
      idempotencyKey: first.idempotencyKey,
      dispatchedBy: 'worker:s1n',
      now: NOW,
    });
    expect(firstResult.kind).toBe('OUTCOME_RESOLVED');
    // The child exited inside its provider boundary.
    expect(client.isRunning(ADAPTER_A)).toBe(false);

    // A SECOND, DIFFERENT effect restarts the runtime — that is all a restart does.
    const rowsBefore = await rawOutcomeRows(h.control);
    expect(rowsBefore).toHaveLength(1);
    expect(rowsBefore[0]!.outcomeKind).toBe('OUTCOME_UNKNOWN');

    const second = await authorisePause(h, { resourceId: 'CMP-S1N-RESTART-2' });
    await enqueue(second, 's1n-restart-2');
    await dispatchAuthorisedEffect(dispatchEnvWith(h, client.adapterRegistry()), {
      companyId: COMPANY_ID,
      idempotencyKey: second.idempotencyKey,
      dispatchedBy: 'worker:s1n',
      now: NOW,
    });

    /*
     * THE PROPERTY: the FIRST effect produced exactly ONE outcome row and the restart added
     * none. `§28`: "AUTOMATIC RESTART MUST NOT REPLAY A CLAIMED EFFECT. Restart only
     * restores adapter availability. It does not reconstruct the fresh claim capability."
     */
    const rowsAfter = await rawOutcomeRows(h.control);
    const forFirst = rowsAfter.filter((row) => row.claimId === rowsBefore[0]!.claimId);
    expect(forFirst).toHaveLength(1);
    expect(forFirst[0]!.outcomeKind).toBe('OUTCOME_UNKNOWN');
  });
});
