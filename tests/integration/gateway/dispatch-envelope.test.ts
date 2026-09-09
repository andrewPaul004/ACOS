import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { COMPANY_ID } from '../../support/fixture.js';
import {
  REFUND_TASK_ID,
  S1I_NOW,
  authoriseRefund,
  bindTaskToCase,
  createOutboxHarness,
  mutateOrderLineRemaining,
  openLiveClock,
  outboxRows,
  reconstructRefundPayload,
  type AuthorisedEffect,
  type OutboxHarness,
} from '../../support/outboxFixture.js';
import {
  ADAPTER_PROCESSOR,
  persistedCorrelationTag,
  persistedPayloadHex,
  rawOutcomeRows,
  testRegistry,
} from '../../support/gatewayFixture.js';
import { createMockAdapter, returnedOutcome } from '../../support/mockAdapter.js';
import { enqueueDispatch } from '../../../src/kernel/outbox/enqueue.js';
import { dispatchAuthorisedEffect } from '../../../src/kernel/gateway/effectGateway.js';
import { buildDispatchEnvelope } from '../../../src/kernel/gateway/dispatchEnvelope.js';
import {
  unsafeMapperDroppingCorrelationTag,
  unsafeMapperDroppingUnmirroredTag,
  unsafeReconstructedEnvelope,
} from '../../negative-controls/unsafe-dispatch-envelope.js';

/**
 * `§10`, `§11`, `§32` — THE EXACT PERSISTED PAYLOAD, THE TAG, AND IMMUTABILITY.
 *
 * =================================================================================
 * `§10`'s REQUIRED MUTATION REGRESSION, VERBATIM
 *
 *   "Authorise/enqueue. Mutate authoritative business state. Claim+mock-dispatch. Mock
 *    receives the original persisted payload. Retain S1I's vulnerable live-reconstruction
 *    control."
 *
 * `25 §7` is why: "The effect key is deterministic, not random. This is the whole point. A
 * crash between journaling and adapter invocation, followed by a restart, must regenerate
 * the *same* key so the adapter's own idempotency (or the reconciler's lookup) recognises
 * it. A UUID minted at attempt time provides no protection against exactly the failure that
 * matters." S1I applied the same reasoning to the payload by PERSISTING it rather than
 * promising to recompute it.
 * =================================================================================
 */

let h: OutboxHarness;
const NOW = S1I_NOW;
const DAY = 24 * 60 * 60 * 1000;
const CASE = 'case:CS-ENVELOPE';

beforeAll(async () => {
  h = await createOutboxHarness();
});

afterAll(async () => {
  await h.close();
});

beforeEach(async () => {
  await h.reset();
  await bindTaskToCase(h.control, REFUND_TASK_ID, CASE);
});

/** A row-3-eligible COMPENSABLE refund, enqueued, with a live clock on its own case. */
async function enqueuedRefund(tag: string): Promise<AuthorisedEffect> {
  const effect = await authoriseRefund(h, { authorisationRef: `auth:AR-ENV-${tag}` });
  const outcome = await enqueueDispatch(h.control, {
    companyId: COMPANY_ID,
    effectId: effect.effectId,
    outboxId: `outbox:${tag}`,
    payloadCanonicalBytes: effect.payloadCanonicalBytes,
    now: NOW,
  });
  expect(outcome.kind).toBe('ENQUEUED');
  await openLiveClock(h.control, {
    caseRef: CASE,
    clockId: `clock:${tag}`,
    deadlineAt: new Date(NOW.getTime() + 7 * DAY),
  });
  return effect;
}

function processorMock(events?: string[]) {
  return createMockAdapter({
    adapterId: ADAPTER_PROCESSOR,
    resolutionCapabilities: ['IDEMPOTENCY_HEADER'],
    outcome: returnedOutcome(),
    ...(events === undefined ? {} : { events }),
  });
}

describe('`§10` — THE MOCK RECEIVES THE PERSISTED PAYLOAD, NOT A RECONSTRUCTION', () => {
  it('the mutation regression: business state moves, the dispatched bytes do not', async () => {
    const effect = await enqueuedRefund('mutation');
    const persistedBefore = await persistedPayloadHex(h.control, effect.idempotencyKey);

    // MUTATE THE AUTHORITATIVE BUSINESS STATE, between enqueue and dispatch. `$10.00`
    // becomes `$3.00`, so the constructor would now compute a different refund.
    await mutateOrderLineRemaining(h.control, '3.00');

    // And prove the mutation is real by re-running C′ and seeing DIFFERENT bytes. This is
    // the discriminator's other half: if reconstruction produced the same bytes, the test
    // would prove nothing.
    const reconstructed = await reconstructRefundPayload(h, `auth:AR-ENV-mutation`);
    expect(reconstructed.toString('hex')).not.toBe(persistedBefore);

    const mock = processorMock();
    const result = await dispatchAuthorisedEffect(h.control, testRegistry(mock), {
      companyId: COMPANY_ID,
      idempotencyKey: effect.idempotencyKey,
      dispatchedBy: 'worker:mutation',
      now: NOW,
    });
    expect(result.kind).toBe('OUTCOME_RESOLVED');

    // THE PRODUCTION ANSWER: the ORIGINAL persisted bytes.
    expect(mock.observed).toHaveLength(1);
    expect(mock.observed[0]!.payloadHex).toBe(persistedBefore);
    expect(mock.observed[0]!.payloadHex).toBe(effect.payloadCanonicalBytes.toString('hex'));
    // And the persisted row itself never moved: `0010`'s trigger admits no UPDATE to a
    // `CLAIMED` row, so the bytes on disk are still the authorised ones.
    expect(await persistedPayloadHex(h.control, effect.idempotencyKey)).toBe(persistedBefore);
  });

  it('THE DISCRIMINATOR — `§40` item 4: the unsafe envelope carries the reconstruction', async () => {
    const effect = await enqueuedRefund('recon');
    const persisted = await persistedPayloadHex(h.control, effect.idempotencyKey);
    await mutateOrderLineRemaining(h.control, '3.00');
    const reconstructed = await reconstructRefundPayload(h, `auth:AR-ENV-recon`);

    // Build the production envelope from the committed row, then apply the defect.
    const mock = processorMock();
    await dispatchAuthorisedEffect(h.control, testRegistry(mock), {
      companyId: COMPANY_ID,
      idempotencyKey: effect.idempotencyKey,
      dispatchedBy: 'worker:recon',
      now: NOW,
    });
    const production = mock.observed[0]!;

    const row = (await outboxRows(h.control))[0]!;
    const built = buildDispatchEnvelope(row);
    expect(built.kind).toBe('BUILT');
    if (built.kind !== 'BUILT') return;
    const unsafeEnvelope = unsafeReconstructedEnvelope(built.envelope, reconstructed);

    // PRODUCTION dispatched the persisted bytes; the unsafe envelope carries the rebuilt
    // ones, and the two differ. The hash on the envelope still claims the persisted
    // payload, so the unsafe path also DISAGREES WITH ITS OWN HASH — which is the shape a
    // reviewer would have to notice, because nothing on the dispatch path checks it.
    expect(production.payloadHex).toBe(persisted);
    expect(unsafeEnvelope.payloadCanonicalBytes.toString('hex')).toBe(
      reconstructed.toString('hex'),
    );
    expect(unsafeEnvelope.payloadCanonicalBytes.toString('hex')).not.toBe(
      production.payloadHex,
    );
    expect(unsafeEnvelope.dispatchPayloadHash).toBe(built.envelope.dispatchPayloadHash);
  });
});

describe('`§11` — THE CORRELATION TAG CROSSES THE PORT UNCHANGED', () => {
  it('identical to the outbox value, immutable, and not mintable by the adapter', async () => {
    const effect = await enqueuedRefund('tag');
    const persistedTag = await persistedCorrelationTag(h.control, effect.idempotencyKey);
    // `25 §7` / ADR-026 item 1: minted locally, before the claim, and provider-visible.
    expect(persistedTag).toMatch(/^acos-corr-/);

    const mock = processorMock();
    await dispatchAuthorisedEffect(h.control, testRegistry(mock), {
      companyId: COMPANY_ID,
      idempotencyKey: effect.idempotencyKey,
      dispatchedBy: 'worker:tag',
      now: NOW,
    });

    expect(mock.observed[0]!.correlationTag).toBe(persistedTag);
    // The tag on the row is unchanged after the dispatch — the adapter observed it and had
    // no way to write it.
    expect(await persistedCorrelationTag(h.control, effect.idempotencyKey)).toBe(persistedTag);
    // AND IT IS ON THE OUTCOME'S JOURNAL ROW, so a later delivery event has something in
    // the audit plane's own copy to match on (`35 §12.3`).
    const outcome = (await rawOutcomeRows(h.control))[0]!;
    expect(outcome.outboxId).toBe(`outbox:tag`);
  });

  it('a restart before the claim does not mint a second tag', async () => {
    /*
     * `§11`: "survives restart prior to claim [...] retry/recovery does not mint a second
     * value." The tag is minted by the ENQUEUE and persisted; a dispatch attempt that
     * happens minutes or hours later reads the same column.
     */
    const effect = await enqueuedRefund('tag-restart');
    const tagAtEnqueue = await persistedCorrelationTag(h.control, effect.idempotencyKey);

    const mock = processorMock();
    await dispatchAuthorisedEffect(h.control, testRegistry(mock), {
      companyId: COMPANY_ID,
      idempotencyKey: effect.idempotencyKey,
      dispatchedBy: 'worker:tag-restart',
      // Six hours later, a different process, a different clock reading.
      now: new Date(NOW.getTime() + 6 * 60 * 60 * 1000),
    });
    expect(mock.observed[0]!.correlationTag).toBe(tagAtEnqueue);
  });

  it('THE DISCRIMINATOR — `§40` item 5: the unsafe mapper blanks it', async () => {
    const effect = await enqueuedRefund('tag-drop');
    const mock = processorMock();
    await dispatchAuthorisedEffect(h.control, testRegistry(mock), {
      companyId: COMPANY_ID,
      idempotencyKey: effect.idempotencyKey,
      dispatchedBy: 'worker:tag-drop',
      now: NOW,
    });
    const row = (await outboxRows(h.control))[0]!;
    const built = buildDispatchEnvelope(row);
    expect(built.kind).toBe('BUILT');
    if (built.kind !== 'BUILT') return;

    expect(mock.observed[0]!.correlationTag).toBe(built.envelope.correlationTag);
    expect(unsafeMapperDroppingCorrelationTag(built.envelope).correlationTag).toBe('');
  });
});

describe('`§32` — THE ENVELOPE IS IMMUTABLE, AND HOLDS NO ALIAS TO THE ROW', () => {
  it('the alias attack: an adapter that mutates everything changes nothing', async () => {
    const effect = await enqueuedRefund('alias');
    const persisted = await persistedPayloadHex(h.control, effect.idempotencyKey);
    const persistedTag = await persistedCorrelationTag(h.control, effect.idempotencyKey);

    const attacker = createMockAdapter({
      adapterId: ADAPTER_PROCESSOR,
      resolutionCapabilities: ['IDEMPOTENCY_HEADER'],
      outcome: returnedOutcome(),
      attemptMutation: true,
    });
    const result = await dispatchAuthorisedEffect(h.control, testRegistry(attacker), {
      companyId: COMPANY_ID,
      idempotencyKey: effect.idempotencyKey,
      dispatchedBy: 'worker:alias',
      now: NOW,
    });
    expect(result.kind).toBe('OUTCOME_RESOLVED');

    // It tried all seven fields `§32` names.
    expect(attacker.mutationAttempts.map((m) => m.field)).toEqual([
      'payloadCanonicalBytes[0]',
      'correlationTag',
      'effectId',
      'recoverability',
      'requiresUnmirroredTag',
      'overrideId',
      'dispatchPayloadHash',
    ]);

    // EVERY SCALAR THREW. `Object.freeze` plus ESM strict mode makes the assignment an
    // error rather than a silent no-op, so a mutating adapter fails loudly in its own
    // process rather than quietly succeeding in ours.
    for (const attempt of attacker.mutationAttempts.slice(1)) {
      expect(attempt.threw, attempt.field).toBe(true);
    }

    // THE BYTES ARE THE EXCEPTION, AND THE INTERESTING CASE. A `Buffer` cannot be frozen
    // against element writes, so the write SUCCEEDS — into a fresh copy the getter made for
    // that call. Nothing downstream sees it.
    expect(attacker.mutationAttempts[0]!.threw).toBe(false);
    expect(await persistedPayloadHex(h.control, effect.idempotencyKey)).toBe(persisted);
    expect(await persistedCorrelationTag(h.control, effect.idempotencyKey)).toBe(persistedTag);

    // And what a SECOND reader sees is the original. This is `§32`'s "the request another
    // adapter would see", asserted directly.
    const row = (await outboxRows(h.control))[0]!;
    const rebuilt = buildDispatchEnvelope(row);
    expect(rebuilt.kind).toBe('BUILT');
    if (rebuilt.kind !== 'BUILT') return;
    expect(rebuilt.envelope.payloadCanonicalBytes.toString('hex')).toBe(persisted);
    expect(rebuilt.envelope.correlationTag).toBe(persistedTag);
  });

  it('every read of the payload returns an independent copy', async () => {
    const effect = await enqueuedRefund('copies');
    const mock = processorMock();
    await dispatchAuthorisedEffect(h.control, testRegistry(mock), {
      companyId: COMPANY_ID,
      idempotencyKey: effect.idempotencyKey,
      dispatchedBy: 'worker:copies',
      now: NOW,
    });
    const row = (await outboxRows(h.control))[0]!;
    const built = buildDispatchEnvelope(row);
    if (built.kind !== 'BUILT') throw new Error('envelope did not build');

    const first = built.envelope.payloadCanonicalBytes;
    const second = built.envelope.payloadCanonicalBytes;
    // Equal in content, distinct in identity: no shared mutable memory.
    expect(first.equals(second)).toBe(true);
    expect(first).not.toBe(second);
    first[0] = (first[0]! ^ 0xff) & 0xff;
    expect(built.envelope.payloadCanonicalBytes.equals(second)).toBe(true);
  });

  it('and the envelope carries no mutable alias to the `pg` row buffer either', async () => {
    const effect = await enqueuedRefund('no-alias');
    const rows = await outboxRows(h.control);
    const row = rows[0]!;
    const built = buildDispatchEnvelope({ ...row, status: 'CLAIMED', claimId: 'claim:x' });
    // Not claimed in the database, so the build refuses — which is itself the point of the
    // `ROW_NOT_CLAIMED` refusal, and is asserted below. Claim it properly first.
    expect(built.kind).toBe('BUILT');
    const mock = processorMock();
    await dispatchAuthorisedEffect(h.control, testRegistry(mock), {
      companyId: COMPANY_ID,
      idempotencyKey: effect.idempotencyKey,
      dispatchedBy: 'worker:no-alias',
      now: NOW,
    });
    const claimedRow = (await outboxRows(h.control))[0]!;
    const rebuilt = buildDispatchEnvelope(claimedRow);
    if (rebuilt.kind !== 'BUILT') throw new Error('envelope did not build');
    // Mutating the ROW's buffer does not change the envelope's snapshot.
    const before = rebuilt.envelope.payloadCanonicalBytes.toString('hex');
    claimedRow.payloadCanonicalBytes[0] = (claimedRow.payloadCanonicalBytes[0]! ^ 0xff) & 0xff;
    expect(rebuilt.envelope.payloadCanonicalBytes.toString('hex')).toBe(before);
  });

  it('an unclaimed row cannot produce an envelope at all', async () => {
    const effect = await enqueuedRefund('unclaimed');
    expect(effect.idempotencyKey).toBeTruthy();
    const row = (await outboxRows(h.control))[0]!;
    expect(row.status).toBe('ENQUEUED');
    const built = buildDispatchEnvelope(row);
    expect(built.kind).toBe('REFUSED');
    if (built.kind === 'REFUSED') expect(built.reason).toBe('ROW_NOT_CLAIMED');
  });
});

describe('`§12` — THE UNMIRRORED REQUIREMENT IS CARRIED, AND CANNOT BE SUPPRESSED', () => {
  it('THE DISCRIMINATOR — `§40` item 6: the unsafe mapper clears it', async () => {
    const effect = await enqueuedRefund('unmirrored-drop');
    const mock = processorMock();
    await dispatchAuthorisedEffect(h.control, testRegistry(mock), {
      companyId: COMPANY_ID,
      idempotencyKey: effect.idempotencyKey,
      dispatchedBy: 'worker:unmirrored-drop',
      now: NOW,
    });
    const row = (await outboxRows(h.control))[0]!;
    const built = buildDispatchEnvelope(row);
    if (built.kind !== 'BUILT') throw new Error('envelope did not build');

    const dropped = unsafeMapperDroppingUnmirroredTag(built.envelope);
    expect(dropped.requiresUnmirroredTag).toBe(false);
    expect(dropped.overrideId).toBeNull();
    // Production's envelope carries whatever the CLAIM recorded, in both directions, and
    // `outcome-unmirrored.test.ts` is where the degraded-state case asserts the `true`
    // direction all the way to the committed row and the journal.
    expect(built.envelope.requiresUnmirroredTag).toBe(row.claimRequiresUnmirroredTag);
  });
});
