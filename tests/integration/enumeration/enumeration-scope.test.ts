import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { modelFacingOptionSet } from '../../../src/kernel/enumeration/enumerateEffects.js';
import type { EnumerationOutcome } from '../../../src/kernel/enumeration/enumerateEffects.js';
import { createHarness, type Harness } from '../../support/fixture.js';
import {
  CAN03,
  CLAIM_GRADE_ORDER,
  OTHER_ORDER,
  entityKeyFor,
  loadCommerceFixture,
  makeEnumerationHarness,
  makeSpec,
  type EnumerationHarness,
} from '../../support/enumerationFixture.js';

/**
 * VC-C2's external behaviour: an unenumerable resource must not become an existence oracle.
 *
 * `36 §2` VC-C2, verbatim:
 *
 *   "a resource outside the `context_spec` returns an **empty set** rather than a denial
 *    that leaks existence"
 *
 * `24 §3` K4, on what AI may not do: "Enumerate outside the resource set its `context_spec`
 * admits."
 *
 * ---------------------------------------------------------------------------------
 * THE TEST THAT MATTERS IS THE INDISTINGUISHABILITY ONE
 *
 * Asserting "out of scope returns empty" alone is weak: an implementation that returned an
 * empty set for out-of-scope and a DIFFERENT empty-ish thing for absent would pass it and
 * still leak. So the assertions below compare the three failures against EACH OTHER and
 * against a legitimately-empty in-scope resource, on the model-facing value.
 * ---------------------------------------------------------------------------------
 */

let harness: Harness;
let kernel: EnumerationHarness;

beforeAll(async () => {
  harness = await createHarness();
});

afterAll(async () => {
  await harness.close();
});

beforeEach(async () => {
  await harness.reset();
  const client = await harness.connect();
  try {
    await loadCommerceFixture(client);
  } finally {
    client.release();
  }
  kernel = makeEnumerationHarness(harness);
});

async function enumerate(
  resourceRef: string,
  admitted?: readonly string[],
): Promise<EnumerationOutcome> {
  return kernel.leases.withEntityLease(entityKeyFor('probe'), (lease) =>
    kernel.enumerator.enumerate(lease, {
      actionClass: 'refund.create',
      resourceRef,
      spec: admitted === undefined ? makeSpec() : makeSpec({ admittedResourceRefs: admitted }),
    }),
  );
}

describe('5 — an out-of-scope resource does not leak its existence', () => {
  it('an EXISTING order outside the context_spec returns an EMPTY SET, not a denial', async () => {
    // The order exists, is RECORD grade and has two refundable lines. The only thing wrong
    // is that this task's `context_spec` does not admit it.
    const outcome = await enumerate(CAN03.resourceRef, [OTHER_ORDER.resourceRef]);
    expect(outcome.set.options).toEqual([]);
    expect(outcome.internalFailure).toBe('OUT_OF_CONTEXT_SPEC_SCOPE');
  });

  it('an ABSENT resource returns the same empty set', async () => {
    const outcome = await enumerate('order:ORD-DOES-NOT-EXIST', ['order:ORD-DOES-NOT-EXIST']);
    expect(outcome.set.options).toEqual([]);
    expect(outcome.internalFailure).toBe('RESOURCE_ABSENT');
  });

  it('a NON-RECORD-grade resource returns the same empty set', async () => {
    // `26 §8`: `resource.grade == "RECORD"`. The CLAIM-grade order has a refundable line, a
    // parent transaction and a fee record — everything but the grade — so an empty set here
    // is the grade check and not an accidentally empty order.
    const outcome = await enumerate(CLAIM_GRADE_ORDER.resourceRef);
    expect(outcome.set.options).toEqual([]);
    expect(outcome.internalFailure).toBe('RESOURCE_NOT_RECORD_GRADE');
  });

  it('THE DISCRIMINATOR — for ONE resource_ref, every condition returns the identical set', async () => {
    // ---------------------------------------------------------------------------------
    // This is the assertion that actually closes the oracle, and it caught a real leak.
    //
    // Comparing two DIFFERENT resource_refs proves nothing: the model chose them, so of
    // course it can tell them apart. The property VC-C2 needs is that for ONE reference the
    // model cannot tell WHICH of the four conditions it is in —
    //
    //   in scope, RECORD grade, nothing currently refundable   (a legitimate empty set)
    //   in scope, RECORD grade, but absent
    //   in scope, present, but NOT RECORD grade
    //   out of the task's context_spec scope entirely
    //
    // An earlier implementation failed this: the refusal path substituted empty strings for
    // the fields it could not resolve, so every refusal shared one `enumeration_id` while a
    // legitimate empty enumeration got a per-resource one. Two probes and a comparison
    // recovered existence. The repair is in `enumerateEffects.ts#empty` and in
    // `computeEnumerationId`.
    //
    // The same order is driven through all four conditions below, so nothing but the
    // condition varies.
    // ---------------------------------------------------------------------------------
    const ref = OTHER_ORDER.resourceRef;

    const exhaust = async (sql: string, params: readonly unknown[]): Promise<void> => {
      const client = await harness.connect();
      try {
        await client.query(sql, [...params]);
      } finally {
        client.release();
      }
    };

    // (a) out of scope — the order exists and is fully refundable.
    const outOfScope = modelFacingOptionSet(await enumerate(ref, ['order:ORD-SOMETHING-ELSE']));

    // (b) in scope, RECORD grade, nothing refundable.
    await exhaust(`UPDATE commerce_order_line SET refundable_remaining = 0 WHERE order_id = $1`, [
      OTHER_ORDER.orderId,
    ]);
    const legitimatelyEmpty = modelFacingOptionSet(await enumerate(ref));

    // (c) in scope, present, NOT RECORD grade.
    await exhaust(`UPDATE commerce_order SET grade = 'CLAIM' WHERE order_id = $1`, [
      OTHER_ORDER.orderId,
    ]);
    const notRecordGrade = modelFacingOptionSet(await enumerate(ref));

    // (d) in scope, absent.
    await exhaust(`DELETE FROM commerce_refund_retained_fee WHERE order_id = $1`, [
      OTHER_ORDER.orderId,
    ]);
    await exhaust(`DELETE FROM commerce_order_line WHERE order_id = $1`, [OTHER_ORDER.orderId]);
    await exhaust(`DELETE FROM commerce_parent_transaction WHERE order_id = $1`, [
      OTHER_ORDER.orderId,
    ]);
    await exhaust(`DELETE FROM commerce_order WHERE order_id = $1`, [OTHER_ORDER.orderId]);
    const absent = modelFacingOptionSet(await enumerate(ref));

    for (const [name, set] of [
      ['legitimately empty', legitimatelyEmpty],
      ['not RECORD grade', notRecordGrade],
      ['absent', absent],
    ] as const) {
      expect(set.options, name).toEqual([]);
      expect(set.enumerationId, `${name} is distinguishable from out-of-scope`).toBe(
        outOfScope.enumerationId,
      );
      expect(set.constructorVersion, name).toEqual(outOfScope.constructorVersion);
      expect(set.computedAt.toISOString(), name).toBe(outOfScope.computedAt.toISOString());
    }
  });

  it('the model-facing set has no field that could carry the internal reason', async () => {
    // `26 §2.0.1` declares four fields. The projection cannot smuggle `internalFailure`
    // through, because `EnumeratedOptionSet` has nowhere to put it.
    const outcome = await enumerate(CAN03.resourceRef, ['order:ORD-999']);
    const modelFacing = modelFacingOptionSet(outcome);
    expect(Object.keys(modelFacing).sort()).toEqual([
      'computedAt',
      'constructorVersion',
      'enumerationId',
      'options',
    ]);
    expect(JSON.stringify(modelFacing)).not.toContain('OUT_OF_CONTEXT_SPEC_SCOPE');
    expect(JSON.stringify(modelFacing)).not.toContain('ORDER_EXISTS');
  });

  it('no enumeration_record row is written for an unenumerable resource', async () => {
    await enumerate(CAN03.resourceRef, ['order:ORD-999']);
    const client = await harness.connect();
    try {
      const rows = await client.query('SELECT 1 FROM enumeration_record');
      expect(rows.rowCount).toBe(0);
    } finally {
      client.release();
    }
  });
});

describe('13 — the RECORD-grade requirement is real', () => {
  it('promoting the CLAIM-grade order to RECORD makes it enumerable', async () => {
    // The control for the grade test above: change ONLY the grade and the same resource now
    // enumerates. Without this, an empty set from a CLAIM-grade order could be any of a
    // dozen unrelated causes.
    const before = await enumerate(CLAIM_GRADE_ORDER.resourceRef);
    expect(before.set.options).toEqual([]);

    const client = await harness.connect();
    try {
      await client.query(`UPDATE commerce_order SET grade = 'RECORD' WHERE order_id = $1`, [
        CLAIM_GRADE_ORDER.orderId,
      ]);
    } finally {
      client.release();
    }

    const after = await enumerate(CLAIM_GRADE_ORDER.resourceRef);
    expect(after.set.options).toHaveLength(1);
    expect(after.internalFailure).toBeNull();
  });

  it('OBSERVATION and DECISION_DELEGATED grades are equally unenumerable', async () => {
    for (const grade of ['OBSERVATION', 'DECISION_DELEGATED']) {
      const client = await harness.connect();
      try {
        await client.query(`UPDATE commerce_order SET grade = $2 WHERE order_id = $1`, [
          CLAIM_GRADE_ORDER.orderId,
          grade,
        ]);
      } finally {
        client.release();
      }
      const outcome = await enumerate(CLAIM_GRADE_ORDER.resourceRef);
      expect(outcome.set.options, `grade ${grade}`).toEqual([]);
      expect(outcome.internalFailure).toBe('RESOURCE_NOT_RECORD_GRADE');
    }
  });
});
