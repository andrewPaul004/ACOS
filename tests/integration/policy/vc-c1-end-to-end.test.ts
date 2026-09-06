import type { PoolClient } from 'pg';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { toDb } from '../../../src/kernel/exposure/money.js';
import { parseProposedIntent } from '../../../src/kernel/canonicalisation/intent.js';
import { CanonicalisationDenied } from '../../../src/kernel/canonicalisation/errors.js';
import { AuthorisationPipeline } from '../../../src/kernel/policy/authorise.js';
import { PolicyEngine } from '../../../src/kernel/policy/policyEngine.js';
import { loadPolicyArtifacts } from '../../../src/kernel/policy/policyArtifacts.js';
import { PER_ACTION_POLICY_ID } from '../../../src/kernel/policy/policyArtifacts.js';
import { projectPolicyDecisionToWorker } from '../../../src/kernel/policy/workerFacingPolicyDenial.js';
import { createHarness, COMPANY_ID, type Harness } from '../../support/fixture.js';
import {
  entityKeyFor,
  kernelContext,
  makeEnumerationHarness,
  makeSpec,
  rawIntent,
  type EnumerationHarness,
} from '../../support/enumerationFixture.js';

/**
 * VC-C1, END TO END, ON REAL POSTGRES.
 *
 * The unit suites evaluate real Cedar over canonical effects the S1B canonicaliser produced
 * from fixture inputs. This one starts from authoritative RECORD-grade rows in a real
 * database and runs the whole accepted pipeline:
 *
 *   authoritative commerce state
 *     -> S1C `enumerate_effects` under the `25 §14` entity execution lease
 *     -> S1C step C′ live re-enumeration and content-addressed selector resolution
 *     -> S1B Effect Canonicaliser  (vendor $25.00 + retained $1.03 = total $26.03)
 *     -> S1D deterministic Cedar request construction
 *     -> S1D real Cedar
 *     -> DENY: PER_ACTION
 *
 * It exists because `36 §4` item 1 is explicit that a policy proof is worthless if the
 * request is built from the wrong object: *"If `exposure` is populated with the unit price
 * instead of the line total, every policy is satisfied and the limit is wrong by a factor of
 * the quantity."* The only way to rule that out is to start from the state and finish at the
 * decision, which is what happens below.
 *
 * `AuthorisationPipeline` is the production seam, so the effect the policy sees is the one
 * C′ produced and there is no caller-visible object between them.
 */

/**
 * The VC-C1 order, in authoritative state.
 *
 * `36 §2`: "a $25.00 line refund with a $1.03 retained fee computes `total_exposure = $26.03`
 * and **denies `PER_ACTION`** against a $25.00 cap."
 *
 * The enumeration takes `min(line.refundable_remaining, transaction.refundable_remaining)`,
 * so both are $25.00 and the enumerated option's amount is $25.00 — the architecture's
 * figure, arrived at from rows rather than asserted into a fixture object.
 */
const VC_C1 = Object.freeze({
  orderId: 'ORD-VCC1',
  resourceRef: 'order:ORD-VCC1',
  lineId: 'line:ORD-VCC1:1',
  parentTransactionId: 'txn:CH-VCC1',
  instrument: 'original',
  lineRemaining: '25.00',
  transactionRemaining: '25.00',
  retainedFee: '1.03',
  feeSourceRef: 'record:processor_settlement_terms:mock_processor:ORD-VCC1',
  currency: 'USD',
  customerNovelty: 'RETURNING',
} as const);

/** The same shape, under the cap, so the permitting path is exercised from state too. */
const UNDER_CAP = Object.freeze({
  orderId: 'ORD-UNDER',
  resourceRef: 'order:ORD-UNDER',
  lineId: 'line:ORD-UNDER:1',
  parentTransactionId: 'txn:CH-UNDER',
  instrument: 'original',
  lineRemaining: '23.97',
  transactionRemaining: '23.97',
  retainedFee: '1.03',
  feeSourceRef: 'record:processor_settlement_terms:mock_processor:ORD-UNDER',
  currency: 'USD',
  customerNovelty: 'RETURNING',
} as const);

type Fixture = typeof VC_C1 | typeof UNDER_CAP;

/**
 * S1D's own loader.
 *
 * The accepted S1C `loadCommerceFixture` is deliberately NOT extended: accepted tests assert
 * cardinalities over the orders it loads, and adding one would change what those tests
 * observe. This inserts only what S1D needs, into the same schema, on the same client.
 */
async function loadPolicyFixture(client: PoolClient): Promise<void> {
  for (const order of [VC_C1, UNDER_CAP]) {
    await client.query(
      `INSERT INTO commerce_order (company_id, order_id, resource_ref, grade, currency, customer_novelty)
       VALUES ($1,$2,$3,'RECORD',$4,$5)`,
      [COMPANY_ID, order.orderId, order.resourceRef, order.currency, order.customerNovelty],
    );
    await client.query(
      `INSERT INTO commerce_order_line (company_id, order_id, line_id, refundable_remaining)
       VALUES ($1,$2,$3,$4::NUMERIC)`,
      [COMPANY_ID, order.orderId, order.lineId, order.lineRemaining],
    );
    await client.query(
      `INSERT INTO commerce_parent_transaction
         (company_id, order_id, parent_transaction_id, instrument, refundable_remaining)
       VALUES ($1,$2,$3,$4,$5::NUMERIC)`,
      [
        COMPANY_ID,
        order.orderId,
        order.parentTransactionId,
        order.instrument,
        order.transactionRemaining,
      ],
    );
    await client.query(
      `INSERT INTO commerce_refund_retained_fee
         (company_id, order_id, line_id, parent_transaction_id, amount, currency, source_ref)
       VALUES ($1,$2,$3,$4,$5::NUMERIC,$6,$7)`,
      [
        COMPANY_ID,
        order.orderId,
        order.lineId,
        order.parentTransactionId,
        order.retainedFee,
        order.currency,
        order.feeSourceRef,
      ],
    );
  }
}

let harness: Harness;
let kernel: EnumerationHarness;
let pipeline: AuthorisationPipeline;

const artifacts = loadPolicyArtifacts();

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
    await loadPolicyFixture(client);
  } finally {
    client.release();
  }
  kernel = makeEnumerationHarness(harness);
  pipeline = new AuthorisationPipeline({
    liveSelector: kernel.liveSelector,
    policyEngine: new PolicyEngine(artifacts),
  });
});

const spec = (): ReturnType<typeof makeSpec> =>
  makeSpec({ admittedResourceRefs: [VC_C1.resourceRef, UNDER_CAP.resourceRef] });

/** Enumerate under the lease, then authorise the sole option, in one lease each. */
async function authoriseSoleOption(
  order: Fixture,
): Promise<Awaited<ReturnType<AuthorisationPipeline['authoriseUnderLease']>>> {
  const key = entityKeyFor(order.orderId);
  const { enumerationId, optionId } = await kernel.leases.withEntityLease(key, async (lease) => {
    const outcome = await kernel.enumerator.enumerate(lease, {
      actionClass: 'refund.create',
      resourceRef: order.resourceRef,
      spec: spec(),
    });
    expect(outcome.set.options).toHaveLength(1);
    return { enumerationId: outcome.set.enumerationId, optionId: outcome.set.options[0]!.optionId };
  });

  const intent = parseProposedIntent(
    rawIntent({ resourceRef: order.resourceRef, enumerationId, optionId }),
  );
  return kernel.leases.withEntityLease(key, (lease) =>
    pipeline.authoriseUnderLease(lease, intent, spec(), kernelContext()),
  );
}

describe('VC-C1 from authoritative state to DENY: PER_ACTION', () => {
  it('the enumeration offers exactly the $25.00 option, read from real rows', async () => {
    const key = entityKeyFor(VC_C1.orderId);
    const set = await kernel.leases.withEntityLease(key, async (lease) =>
      (
        await kernel.enumerator.enumerate(lease, {
          actionClass: 'refund.create',
          resourceRef: VC_C1.resourceRef,
          spec: spec(),
        })
      ).set,
    );
    expect(set.options).toHaveLength(1);
    expect(set.options[0]!.description).toContain('amount=25.00');
  });

  it('C′ canonicalises $25.00 vendor / $1.03 retained / $26.03 total, from those rows', async () => {
    const { effect } = await authoriseSoleOption(VC_C1);
    expect(toDb(effect.request.exposure.vendorAmount!)).toBe('25.00');
    expect(toDb(effect.request.exposure.costComponents[0]!.amount)).toBe('1.03');
    expect(effect.request.exposure.costComponents[0]!.sourceRef).toBe(VC_C1.feeSourceRef);
    expect(toDb(effect.request.exposure.totalExposure)).toBe('26.03');
    // I18a: the DISPATCHED money is the vendor amount, not the exposure.
    expect(toDb(effect.dispatchPayload.monetaryEffect!)).toBe('25.00');
  });

  it('AND CEDAR DENIES PER_ACTION — the denial half of VC-C1, end to end', async () => {
    const { decision } = await authoriseSoleOption(VC_C1);
    expect(decision.decision).toBe('DENY');
    expect(decision.decision === 'DENY' && decision.code).toBe('PER_ACTION');
    expect(decision.lineage.determiningPolicies).toEqual([PER_ACTION_POLICY_ID]);
  });

  it('the decision is bound to the effect C′ produced — one call, no gap', async () => {
    // `26 §7` C′: "Everything downstream of C′ evaluates kernel-computed operands only."
    // The pipeline returns the decision AND the effect it was taken over, together, after
    // the fact — there is no point at which a caller held the effect first.
    const outcome = await authoriseSoleOption(VC_C1);
    expect(Object.isFrozen(outcome)).toBe(true);
    expect(Object.keys(outcome).sort()).toEqual(['decision', 'effect']);
    expect(outcome.effect.request.selectedOption.actionClass).toBe('refund.create');
    // The selected option is the LIVE one, resolved by content address under the lease.
    expect(outcome.effect.request.selectedOption.lineId).toBe(VC_C1.lineId);
    expect(outcome.effect.request.selectedOption.parentTransactionId).toBe(
      VC_C1.parentTransactionId,
    );
  });

  it('and the worker sees only the coarse category', async () => {
    const { decision } = await authoriseSoleOption(VC_C1);
    expect(projectPolicyDecisionToWorker(decision)).toEqual({ deny: 'PER_ACTION' });
  });

  it('every decision carries `26 §11`’s policy_version and constructor_version', async () => {
    const { decision, effect } = await authoriseSoleOption(VC_C1);
    expect(decision.lineage.policyVersion).toBe(artifacts.policyVersion);
    expect(decision.lineage.constructorVersion).toEqual(effect.request.constructorVersion);
  });
});

describe('P6 reachability from authoritative state — the under-cap order PERMITS', () => {
  it('$23.97 + $1.03 = $25.00 permits, at the limit, through the whole pipeline', async () => {
    const { decision, effect } = await authoriseSoleOption(UNDER_CAP);
    expect(toDb(effect.request.exposure.totalExposure)).toBe('25.00');
    expect(decision.decision).toBe('PERMIT');
    expect(decision.lineage.determiningPolicies).toEqual(['acos.refund.create.grant']);
  });

  it('so the suite is not certifying an outage — both outcomes are reachable from real rows', async () => {
    expect((await authoriseSoleOption(UNDER_CAP)).decision.decision).toBe('PERMIT');
    expect((await authoriseSoleOption(VC_C1)).decision.decision).toBe('DENY');
  });
});

describe('the S1C selector guarantees still hold ahead of the policy step', () => {
  it('a stale option_id denies SELECTOR_STALE and never reaches policy', async () => {
    // `26 §7` C′ and `I53`. Enumerate, then exhaust the line under a concurrent write, then
    // authorise: the option must be absent from the live set and the kernel must not
    // substitute. If S1D had moved option resolution, this would have started permitting.
    const key = entityKeyFor(VC_C1.orderId);
    const { enumerationId, optionId } = await kernel.leases.withEntityLease(key, async (lease) => {
      const outcome = await kernel.enumerator.enumerate(lease, {
        actionClass: 'refund.create',
        resourceRef: VC_C1.resourceRef,
        spec: spec(),
      });
      return {
        enumerationId: outcome.set.enumerationId,
        optionId: outcome.set.options[0]!.optionId,
      };
    });

    const client = await harness.connect();
    try {
      await client.query(
        `UPDATE commerce_order_line SET refundable_remaining = 0
          WHERE company_id = $1 AND order_id = $2 AND line_id = $3`,
        [COMPANY_ID, VC_C1.orderId, VC_C1.lineId],
      );
    } finally {
      client.release();
    }

    const intent = parseProposedIntent(
      rawIntent({ resourceRef: VC_C1.resourceRef, enumerationId, optionId }),
    );
    const error = await kernel.leases
      .withEntityLease(key, (lease) =>
        pipeline.authoriseUnderLease(lease, intent, spec(), kernelContext()),
      )
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(CanonicalisationDenied);
    expect((error as CanonicalisationDenied).code).toBe('SELECTOR_STALE');
  });

  it('a principal in another role denies NO_GRANT — from real state, through real Cedar', async () => {
    const key = entityKeyFor(UNDER_CAP.orderId);
    const { enumerationId, optionId } = await kernel.leases.withEntityLease(key, async (lease) => {
      const outcome = await kernel.enumerator.enumerate(lease, {
        actionClass: 'refund.create',
        resourceRef: UNDER_CAP.resourceRef,
        spec: spec(),
      });
      return {
        enumerationId: outcome.set.enumerationId,
        optionId: outcome.set.options[0]!.optionId,
      };
    });
    const intent = parseProposedIntent(
      rawIntent({ resourceRef: UNDER_CAP.resourceRef, enumerationId, optionId }),
    );
    const { decision } = await kernel.leases.withEntityLease(key, (lease) =>
      pipeline.authoriseUnderLease(
        lease,
        intent,
        spec(),
        kernelContext({ principalRole: 'market_researcher' }),
      ),
    );
    expect(decision.decision === 'DENY' && decision.code).toBe('NO_GRANT');
  });
});
