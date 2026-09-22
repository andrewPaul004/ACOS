import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { COMPANY_ID } from '../../support/fixture.js';
import {
  RESHIP_WINDOWS,
  S1I_NOW,
  authoriseReship,
  createOutboxHarness,
  outboxRows,
  type OutboxHarness,
} from '../../support/outboxFixture.js';
import { ADAPTER_COMMERCE, dispatchEnv, rawOutcomeRows } from '../../support/gatewayFixture.js';
import { createMockAdapter, returnedOutcome } from '../../support/mockAdapter.js';
import { mieRows } from '../../negative-controls/unsafe-mie-movements.js';
import { enqueueDispatch } from '../../../src/kernel/outbox/enqueue.js';
import { dispatchAuthorisedEffect } from '../../../src/kernel/gateway/effectGateway.js';
import {
  DispatchLeaseManager,
  entityKeyForResourceRef,
} from '../../../src/kernel/gateway/dispatchLease.js';
import { revalidateAuthorisedEffectUnderLease } from '../../../src/kernel/gateway/dispatchRevalidation.js';

/**
 * `§27`, `§28`, `§29` — DISPATCH-TIME REVALIDATION, AND WHAT A STALE EFFECT DOES NOT DO.
 *
 * =================================================================================
 * `25 §14.1`, VERBATIM, AND IT IS THE WHOLE SPECIFICATION
 *
 *   "**DISPATCH-TIME REVALIDATION IS MANDATORY, AND A CLAIM MAY NOT OCCUR BEFORE IT.**
 *
 *    Under the dispatch lease and **before** the claim, the **originally authorised effect**
 *    is revalidated against **current authoritative resource state**, using the original
 *    `action_class`, the original resource identity, the original enumeration/option identity
 *    and the original constructor/version identity. [...]
 *
 *    **THE QUESTION IS ONLY WHETHER THE ORIGINALLY AUTHORISED EFFECT IS STILL A VALID CURRENT
 *    EFFECT.** No new payload is constructed. No different option is substituted."
 *
 * and, for the refusal:
 *
 *   "**If the originally authorised option or effect is no longer valid, the claim is
 *    REFUSED.** Nothing is dispatched and nothing is substituted. **The economic reservation
 *    remains held**, pending the cancellation and expiry paths declared elsewhere; leaving it
 *    held is the safe direction, and **no release semantics are invented at this boundary.**"
 *
 * THE PRECISE REASONS ARE INTERNAL AND THE DENIAL IS COARSE. This suite reads the precise
 * reason by calling the revalidator directly — which only the kernel can do, because it takes
 * a `HeldDispatchLease` — and separately asserts that the gateway's result carries one coarse
 * literal and no near-miss detail. `26 §2.2`: "A model that learns 'denied: amount exceeded by
 * $3' has been handed a probing oracle."
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

async function enqueuedReship(suffix: string): Promise<{
  readonly idempotencyKey: string;
  readonly resourceRef: string;
  readonly resourceId: string;
}> {
  const resourceId = `ORD-REVAL-${suffix}`;
  const effect = await authoriseReship(h, { resourceId });
  await enqueueDispatch(h.control, {
    companyId: COMPANY_ID,
    effectId: effect.effectId,
    outboxId: `outbox:${effect.idempotencyKey}`,
    payloadCanonicalBytes: effect.payloadCanonicalBytes,
    now: NOW,
  });
  return { idempotencyKey: effect.idempotencyKey, resourceRef: `order:${resourceId}`, resourceId };
}

function commerceMock() {
  return createMockAdapter({
    adapterId: ADAPTER_COMMERCE,
    resolutionCapabilities: ['IDEMPOTENCY_HEADER', 'DELIVERY_EVENT_WEBHOOK'],
    outcome: returnedOutcome(),
  });
}

/** Run the revalidator under a real dispatch lease, and return its PRECISE answer. */
async function revalidate(idempotencyKey: string, resourceRef: string) {
  const manager = new DispatchLeaseManager({ pool: h.control });
  return manager.withDispatchLease(
    entityKeyForResourceRef(COMPANY_ID, resourceRef),
    (lease) =>
      revalidateAuthorisedEffectUnderLease(lease, h.kernel.enumerator, {
        companyId: COMPANY_ID,
        idempotencyKey,
      }),
  );
}

async function demoteResource(resourceRef: string): Promise<void> {
  const client = await h.control.connect();
  try {
    await client.query(
      `UPDATE commerce_order SET grade = 'OBSERVATION'
        WHERE company_id = $1 AND resource_ref = $2`,
      [COMPANY_ID, resourceRef],
    );
  } finally {
    client.release();
  }
}

describe('`§27` — A CURRENT EFFECT REVALIDATES, AND THE CHECK IS NOT VACUOUS', () => {
  it('an unmutated authorised effect is VALID, and reports its original identity', async () => {
    const effect = await enqueuedReship('valid');
    const result = await revalidate(effect.idempotencyKey, effect.resourceRef);
    expect(result.kind).toBe('VALID');
    if (result.kind !== 'VALID') return;
    // The ORIGINAL identity, echoed. Never a substitute and never a candidate — `25 §14.1`:
    // "No different option is substituted."
    expect(result.actionClass).toBe('fulfilment.reship');
    expect(result.resourceRef).toBe(effect.resourceRef);
    expect(result.optionId).toMatch(/^[0-9a-f]{64}$/);
    expect(result.enumerationId).toMatch(/^[0-9a-f]{64}$/);
  });

  it('and it CANNOT be called without a held lease — `30 §5.1`', async () => {
    /*
     * "**A revalidation performed outside the dispatch lease proves nothing**, because the
     * state it read could be mutated before the claim commits."
     *
     * The signature is the enforcement: `revalidateAuthorisedEffectUnderLease` takes a
     * `HeldDispatchLease`, which only `DispatchLeaseManager` mints, and it calls `assertHeld`
     * before its first read and again against the full entity key. A released lease throws.
     */
    const effect = await enqueuedReship('released');
    const manager = new DispatchLeaseManager({ pool: h.control });
    const key = entityKeyForResourceRef(COMPANY_ID, effect.resourceRef);

    let escaped: Parameters<typeof revalidateAuthorisedEffectUnderLease>[0] | null = null;
    await manager.withDispatchLease(key, async (lease) => {
      escaped = lease;
    });
    // The lease has been released by the `finally`. Using it now throws rather than reading.
    await expect(
      revalidateAuthorisedEffectUnderLease(escaped!, h.kernel.enumerator, {
        companyId: COMPANY_ID,
        idempotencyKey: effect.idempotencyKey,
      }),
    ).rejects.toThrow(/released|25 §14\.1/);
  });
});

describe('`§28`, `§29` — A GAP MUTATION MAKES THE EFFECT STALE, AND THE CLAIM IS REFUSED', () => {
  it('the resource stops resolving: STALE, precisely, with the internal reason recorded', async () => {
    const effect = await enqueuedReship('stale-resource');
    expect((await revalidate(effect.idempotencyKey, effect.resourceRef)).kind).toBe('VALID');

    // THE MUTATION, in the lock-free gap. `26 §8`: "resource.grade == 'RECORD'", so a demoted
    // resource no longer resolves to enumerable state and the live set is empty.
    await demoteResource(effect.resourceRef);

    const stale = await revalidate(effect.idempotencyKey, effect.resourceRef);
    expect(stale.kind).toBe('STALE');
    if (stale.kind !== 'STALE') return;
    // The INTERNAL reason is precise — `§28`: "Record precise internal reason."
    expect(stale.reason).toBe('RESOURCE_NO_LONGER_RESOLVES');
  });

  it('the dispatch refuses BEFORE the claim: nothing claimed, nothing invoked, nothing held back', async () => {
    const effect = await enqueuedReship('refused');
    const mieBefore = (await mieRows(h.control, COMPANY_ID)).filter((r) =>
      RESHIP_WINDOWS.includes(r.windowId),
    );
    await demoteResource(effect.resourceRef);

    const mock = commerceMock();
    const result = await dispatchAuthorisedEffect(dispatchEnv(h, mock), {
      companyId: COMPANY_ID,
      idempotencyKey: effect.idempotencyKey,
      dispatchedBy: 'worker:stale',
      now: NOW,
    });

    // THE COARSE DENIAL — one literal, and a detail with no near-miss in it.
    expect(result.kind).toBe('REVALIDATION_REFUSED');
    if (result.kind !== 'REVALIDATION_REFUSED') return;
    expect(result.reason).toBe('DISPATCH_EFFECT_STALE');
    // `§28` / `26 §2.2`: the precise internal reason must NOT be in the model-facing answer.
    expect(result.detail).not.toContain('RESOURCE_NO_LONGER_RESOLVES');
    expect(result.detail).not.toContain('OPTION_ABSENT_FROM_LIVE_SET');
    expect(JSON.stringify(result)).not.toContain('optionId');

    // NOTHING CLAIMED — `30 §5.1`: the refusal precedes the claim's `BEGIN`.
    expect((await outboxRows(h.control))[0]!.status).toBe('ENQUEUED');
    // NOTHING DISPATCHED, AND NOTHING SUBSTITUTED.
    expect(mock.callCount).toBe(0);
    expect(mock.observed).toHaveLength(0);
    expect(await rawOutcomeRows(h.control)).toHaveLength(0);

    // THE COMMITMENT REMAINS HELD. `25 §14.1`: "leaving it held is the safe direction, and no
    // release semantics are invented at this boundary." The reserved unit is untouched, which
    // is the strongest implementation of "held" — no statement ran against it.
    const mieAfter = (await mieRows(h.control, COMPANY_ID)).filter((r) =>
      RESHIP_WINDOWS.includes(r.windowId),
    );
    expect(mieAfter).toEqual(mieBefore);
    for (const row of mieAfter) expect(row.reservedIrrecoverable, row.windowId).toBe('1');
  });

  it('an effect whose enumeration was never recorded is STALE, not a pass — fail closed', async () => {
    /*
     * `25 §14.1` names the enumeration/option identity as an operand. An effect that carries
     * none cannot be revalidated, and an unrevalidatable effect must not be dispatched.
     *
     * `51 §2.3`'s rule generalises: "**NO IMPLICIT DEFAULT MAY WIDEN AUTHORITY.**"
     */
    const effect = await enqueuedReship('no-identity');
    const client = await h.control.connect();
    try {
      // THE AUTHORISATION ITSELF CANNOT BE EDITED, and that is worth stating: `0007`'s
      // `acos_append_only` trigger refuses every UPDATE to it, so the persisted
      // enumeration/option identity is immutable from the instant S1F committed it.
      await expect(
        client.query(
          `UPDATE authorisation SET enumeration_id = NULL WHERE company_id = $1`,
          [COMPANY_ID],
        ),
      ).rejects.toThrow(/APPEND_ONLY_TABLE_authorisation/);

      // So the reachable form of "no identity" is the other half of the pair: an enumeration
      // recorded with no persisted task scope, which `25 §14.1`'s re-enumeration cannot run
      // under. Rows written before `0013` are exactly this shape.
      await client.query(
        `UPDATE enumeration_record SET context_spec = NULL WHERE company_id = $1`,
        [COMPANY_ID],
      );
    } finally {
      client.release();
    }

    const stale = await revalidate(effect.idempotencyKey, effect.resourceRef);
    expect(stale.kind).toBe('STALE');
    if (stale.kind !== 'STALE') return;
    expect(stale.reason).toBe('REVALIDATION_IDENTITY_ABSENT');

    const mock = commerceMock();
    const result = await dispatchAuthorisedEffect(dispatchEnv(h, mock), {
      companyId: COMPANY_ID,
      idempotencyKey: effect.idempotencyKey,
      dispatchedBy: 'worker:no-identity',
      now: NOW,
    });
    expect(result.kind).toBe('REVALIDATION_REFUSED');
    expect(mock.callCount).toBe(0);
    expect((await outboxRows(h.control))[0]!.status).toBe('ENQUEUED');
  });

  it('an effect whose enumeration record vanished is STALE too', async () => {
    const effect = await enqueuedReship('no-record');
    const client = await h.control.connect();
    try {
      await client.query(`DELETE FROM enumeration_record WHERE company_id = $1`, [COMPANY_ID]);
    } finally {
      client.release();
    }
    const stale = await revalidate(effect.idempotencyKey, effect.resourceRef);
    expect(stale.kind).toBe('STALE');
    if (stale.kind === 'STALE') expect(stale.reason).toBe('ENUMERATION_RECORD_ABSENT');
  });

  it('an effect whose constructor version moved is STALE — `25 §14.1`s fourth operand', async () => {
    /*
     * "using the original `action_class`, the original resource identity, the original
     * enumeration/option identity and **the original constructor/version identity**."
     *
     * A set enumerated under a different constructor version is not comparable to the
     * authorised one, and comparing them anyway would be the substitution the section forbids.
     * Checked BEFORE any live read, so a version change short-circuits the enumeration.
     */
    const effect = await enqueuedReship('version');
    const client = await h.control.connect();
    try {
      // The AUTHORISATION is append-only, so the divergence is introduced on the other side
      // of the comparison — the kernel's own enumeration record. Either direction is the same
      // fact: the set was enumerated under a version the authorisation did not use.
      await client.query(
        `UPDATE enumeration_record
            SET constructor_semantic_major = constructor_semantic_major + 1
          WHERE company_id = $1`,
        [COMPANY_ID],
      );
    } finally {
      client.release();
    }
    const stale = await revalidate(effect.idempotencyKey, effect.resourceRef);
    expect(stale.kind).toBe('STALE');
    if (stale.kind === 'STALE') expect(stale.reason).toBe('CONSTRUCTOR_VERSION_CHANGED');
  });

  it('an enumeration bound to a DIFFERENT resource is STALE — `26 §2.0.1` one epoch later', async () => {
    /*
     * "Without these checks the `enumeration_id` half of the content-addressed pair carries no
     * information: a model could pair an enumeration taken against order A with an `option_id`
     * computed for order B." The accepted C′ check, applied at the dispatch boundary.
     */
    const effect = await enqueuedReship('binding');
    const client = await h.control.connect();
    try {
      await client.query(
        `UPDATE enumeration_record SET resource_id = 'ORD-SOMETHING-ELSE'
          WHERE company_id = $1`,
        [COMPANY_ID],
      );
    } finally {
      client.release();
    }
    const stale = await revalidate(effect.idempotencyKey, effect.resourceRef);
    expect(stale.kind).toBe('STALE');
    if (stale.kind === 'STALE') expect(stale.reason).toBe('ENUMERATION_BINDING_MISMATCH');
  });
});

describe('`§27` — REVALIDATION CONSTRUCTS NOTHING AND SUBSTITUTES NOTHING', () => {
  it('the persisted payload is byte-identical after a revalidation, valid or stale', async () => {
    /*
     * `25 §14.1`: "**The persisted payload remains the exact authorised payload**, and
     * revalidation neither reads it as a candidate nor replaces it."
     *
     * The return type already makes a substitution unrepresentable — `VALID` carries no
     * payload and `STALE` carries no candidate — so this asserts the other half: the row on
     * disk is untouched by the act of revalidating, on both branches.
     */
    const effect = await enqueuedReship('no-construct');
    const client = await h.control.connect();
    const readPayload = async (): Promise<string> => {
      const r = await client.query<{ hex: string }>(
        `SELECT encode(payload_canonical_bytes, 'hex') AS hex FROM dispatch_outbox
          WHERE company_id = $1 AND idempotency_key = $2`,
        [COMPANY_ID, effect.idempotencyKey],
      );
      return r.rows[0]!.hex;
    };
    try {
      const before = await readPayload();
      expect((await revalidate(effect.idempotencyKey, effect.resourceRef)).kind).toBe('VALID');
      expect(await readPayload()).toBe(before);

      await demoteResource(effect.resourceRef);
      expect((await revalidate(effect.idempotencyKey, effect.resourceRef)).kind).toBe('STALE');
      expect(await readPayload()).toBe(before);
    } finally {
      client.release();
    }
  });

  it('and revalidating does NOT mint a new enumeration record', async () => {
    /*
     * `reEnumerate` is the ACCEPTED S1C re-enumeration and its header states the rule: it
     * "must not mint a new `enumeration_id`: the selector names the enumeration the model
     * actually read, and issuing a fresh one at C′ is the 'silently reissue the enumeration'
     * the S1C mandate forbids". The same applies one epoch later, for the same reason.
     */
    const effect = await enqueuedReship('no-mint');
    const client = await h.control.connect();
    const count = async (): Promise<number> => {
      const r = await client.query<{ n: string }>(
        `SELECT count(*)::TEXT AS n FROM enumeration_record WHERE company_id = $1`,
        [COMPANY_ID],
      );
      return Number(r.rows[0]!.n);
    };
    try {
      const before = await count();
      await revalidate(effect.idempotencyKey, effect.resourceRef);
      await revalidate(effect.idempotencyKey, effect.resourceRef);
      expect(await count()).toBe(before);
    } finally {
      client.release();
    }
  });
});
