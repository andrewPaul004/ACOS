import type { Client } from '../../src/db/pool.js';
import { computed } from '../../src/kernel/canonicalisation/brands.js';
import { EffectCanonicaliser } from '../../src/kernel/canonicalisation/canonicaliser.js';
import { ConstructorRegistry } from '../../src/kernel/canonicalisation/registry.js';
import type { RegisteredConstructor } from '../../src/kernel/canonicalisation/registry.js';
import {
  ConstructorVersionResolver,
  type ConstructorVersionRecord,
} from '../../src/kernel/canonicalisation/constructorVersion.js';
import { refundCreateConstructor } from '../../src/kernel/canonicalisation/constructors/refundCreate.js';
import type { ReasonCodeScope } from '../../src/kernel/canonicalisation/actionCatalogue.js';
import { FixedClock } from '../../src/kernel/enumeration/clock.js';
import type { TaskContextSpec } from '../../src/kernel/enumeration/contextSpec.js';
import { EntityLeaseManager, type EntityKey } from '../../src/kernel/enumeration/entityLease.js';
import { EffectEnumerator } from '../../src/kernel/enumeration/enumerateEffects.js';
import {
  LiveSelectorCanonicaliser,
  type KernelSuppliedContext,
} from '../../src/kernel/enumeration/liveSelector.js';
import { COMPANY_ID, type Harness } from './fixture.js';
import {
  newTestSigner,
  signConstructorVersion,
  REFUND_VERSION_1_0,
  type TestSigner,
} from './canonicalisationFixture.js';

/**
 * The S1C enumeration fixtures.
 *
 * This file builds KERNEL-SIDE authoritative state — real rows in real PostgreSQL — and the
 * component graph the S1C tests drive. It is not an oracle: every expected VALUE lives in
 * the test that asserts it or in `canonicalisationOracle.ts`, which imports nothing from
 * `src/`.
 *
 * Every figure below is an **S1C implementation fixture**, recorded in
 * docs/implementation/S1C-owner-clarifications.md. In particular the retained-fee amounts
 * are hand-authored AMOUNTS with source references, never derived — S1B-C3a, verbatim:
 * "An implementation may not invent an economic rule because the rule reproduces a fixture."
 */

// =====================================================================================
// The VC-C3 / CAN-03 reordering fixture
// =====================================================================================

/**
 * `36 §2` VC-C3, verbatim:
 *
 *   "The reordering fixture, directly: order 123 with refundable lines
 *    `[A: $10.00, B: $20.00]`; the worker selects A's `option_id`; a concurrent partial
 *    refund exhausts A; step C′ re-enumerates."
 *
 * and `26 §2.0.1`'s narrative of the same scenario, verbatim:
 *
 *   "order 123 carries refundable lines `[A: $10.00, B: $20.00]`; the model reads the
 *    enumeration and submits index 0 for line A; a concurrent partial refund exhausts line
 *    A; step C′ re-enumerates to `[B: $20.00]`; index 0 is valid and denotes B; the kernel
 *    computes $20.00, every policy check passes, and **a refund of line B dispatches**"
 *
 * The two lines are named so that A SORTS BEFORE B, deliberately: under the positional
 * negative control, index 0 must denote A before the mutation and B after it. If the sort
 * put B first the ordinal would happen to stay correct and the negative control would not
 * discriminate.
 */
export const CAN03 = Object.freeze({
  orderId: 'ORD-123',
  resourceRef: 'order:ORD-123',

  lineA: 'line:ORD-123:A',
  lineB: 'line:ORD-123:B',
  /** `36 §2` VC-C3: "A: $10.00". */
  lineAAmount: '10.00',
  /** `36 §2` VC-C3: "B: $20.00". */
  lineBAmount: '20.00',

  /**
   * One parent transaction, with headroom for either line.
   *
   * `26 §8`: the enumeration is two-dimensional over `(line, parent_transaction)`. One
   * transaction keeps the CAN-03 fixture exactly as `36 §2` prints it — two options, one per
   * line — while the dimensionality itself is exercised separately by
   * `TWO_BY_TWO` below, which is what would catch an implementation that quietly enumerated
   * over lines alone.
   */
  parentTransactionId: 'txn:CH-9001',
  instrument: 'original',
  parentTransactionRemaining: '30.00',

  /**
   * Hand-authored authoritative retained fees — S1B-C3a, S1C-C2.
   *
   * AMOUNTS with source references. There is no rate here, no percentage and no rounding
   * rule, and nothing in the S1C tree derives one. Deliberately DIFFERENT for the two lines
   * so a test cannot pass by accident against an implementation that reads the wrong row.
   */
  feeA: '0.59',
  feeB: '0.88',
  feeSourceRef: 'record:processor_settlement_terms:mock_processor:ORD-123',

  currency: 'USD',
  customerNovelty: 'RETURNING' as const,
} as const);

/** A second in-scope order, so "empty" and "out of scope" can be told apart in tests. */
export const OTHER_ORDER = Object.freeze({
  orderId: 'ORD-777',
  resourceRef: 'order:ORD-777',
  lineId: 'line:ORD-777:1',
  parentTransactionId: 'txn:CH-7771',
  instrument: 'original',
  amount: '5.00',
  fee: '0.45',
  currency: 'USD',
} as const);

/** A CLAIM-grade order. `26 §8`: `resource.grade == "RECORD"`. */
export const CLAIM_GRADE_ORDER = Object.freeze({
  orderId: 'ORD-CLAIM',
  resourceRef: 'order:ORD-CLAIM',
  currency: 'USD',
} as const);

/**
 * A 2×2 order — two lines and two parent transactions on different instruments.
 *
 * `26 §8`: "The refund enumeration is two-dimensional over `(line, parent_transaction)`".
 * The CAN-03 fixture has one transaction, so on its own it cannot distinguish a
 * two-dimensional enumeration from a one-dimensional one over lines. This one can: it must
 * produce FOUR options, and the two options for a given line must differ only in the
 * transaction and instrument — and therefore have different `option_id`s.
 */
export const TWO_BY_TWO = Object.freeze({
  orderId: 'ORD-2X2',
  resourceRef: 'order:ORD-2X2',
  lines: ['line:ORD-2X2:1', 'line:ORD-2X2:2'] as const,
  transactions: [
    { id: 'txn:CH-2X2-A', instrument: 'original', remaining: '100.00' },
    { id: 'txn:CH-2X2-B', instrument: 'store_credit', remaining: '100.00' },
  ] as const,
  lineAmount: '7.00',
  fee: '0.50',
  currency: 'USD',
} as const);

export const TASK_ID = 'task:T-S1C-1';
export const PRINCIPAL_ID = 'principal:support_reasoner:1';

/** The entity key `25 §14` declares: `(company_id, entity_type, entity_id)`. */
export function entityKeyFor(orderId: string): EntityKey {
  return { companyId: COMPANY_ID, entityType: 'order', entityId: orderId };
}

/**
 * The S1C task `context_spec` — S1C-C3 and S1C-C5.
 *
 * The admitted description-field set is a FIXTURE. `26 §2.0.1` requires the projection
 * filter and enumerates no field set; S1C declares one and records it as an implementation
 * fixture rather than as a reading of the architecture.
 */
export const ADMITTED_DESCRIPTION_FIELDS: readonly string[] = [
  'amount',
  'currency',
  'line',
  'parent_transaction',
  'instrument',
  'refundable_remaining',
];

export function makeSpec(
  overrides: {
    readonly admittedResourceRefs?: readonly string[];
    readonly admittedDescriptionFields?: readonly string[] | null;
    readonly reasonCodeScope?: ReasonCodeScope;
    readonly taskId?: string;
    readonly principalId?: string;
  } = {},
): TaskContextSpec {
  return {
    companyId: COMPANY_ID,
    taskId: overrides.taskId ?? TASK_ID,
    principalId: overrides.principalId ?? PRINCIPAL_ID,
    admittedResourceRefs: new Set(
      overrides.admittedResourceRefs ?? [
        CAN03.resourceRef,
        OTHER_ORDER.resourceRef,
        TWO_BY_TWO.resourceRef,
        CLAIM_GRADE_ORDER.resourceRef,
      ],
    ),
    admittedDescriptionFields:
      overrides.admittedDescriptionFields === null
        ? {}
        : {
            'refund.create': new Set(
              overrides.admittedDescriptionFields ?? ADMITTED_DESCRIPTION_FIELDS,
            ),
          },
    // S1C-C5. `GOODS_FAULT` is the scope of `CUSTOMER_REPORTED_DAMAGE`, the fixture reason
    // code, so S1B's reason-code-scope cohesion check passes on the happy path.
    reasonCodeScope: overrides.reasonCodeScope ?? 'GOODS_FAULT',
  };
}

// =====================================================================================
// Loading the authoritative state
// =====================================================================================

async function insertOrder(
  client: Client,
  order: { orderId: string; resourceRef: string; grade: string; currency: string; novelty: string },
): Promise<void> {
  await client.query(
    `INSERT INTO commerce_order (company_id, order_id, resource_ref, grade, currency, customer_novelty)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [COMPANY_ID, order.orderId, order.resourceRef, order.grade, order.currency, order.novelty],
  );
}

async function insertLine(
  client: Client,
  orderId: string,
  lineId: string,
  remaining: string,
): Promise<void> {
  await client.query(
    `INSERT INTO commerce_order_line (company_id, order_id, line_id, refundable_remaining)
     VALUES ($1,$2,$3,$4::NUMERIC)`,
    [COMPANY_ID, orderId, lineId, remaining],
  );
}

async function insertTransaction(
  client: Client,
  orderId: string,
  transactionId: string,
  instrument: string,
  remaining: string,
): Promise<void> {
  await client.query(
    `INSERT INTO commerce_parent_transaction
       (company_id, order_id, parent_transaction_id, instrument, refundable_remaining)
     VALUES ($1,$2,$3,$4,$5::NUMERIC)`,
    [COMPANY_ID, orderId, transactionId, instrument, remaining],
  );
}

async function insertFee(
  client: Client,
  orderId: string,
  lineId: string,
  transactionId: string,
  amount: string,
  currency: string,
  sourceRef: string,
): Promise<void> {
  await client.query(
    `INSERT INTO commerce_refund_retained_fee
       (company_id, order_id, line_id, parent_transaction_id, amount, currency, source_ref)
     VALUES ($1,$2,$3,$4,$5::NUMERIC,$6,$7)`,
    [COMPANY_ID, orderId, lineId, transactionId, amount, currency, sourceRef],
  );
}

/** Load every S1C commerce fixture into a freshly migrated database. */
export async function loadCommerceFixture(client: Client): Promise<void> {
  // --- the CAN-03 order ---------------------------------------------------------------
  await insertOrder(client, {
    orderId: CAN03.orderId,
    resourceRef: CAN03.resourceRef,
    grade: 'RECORD',
    currency: CAN03.currency,
    novelty: CAN03.customerNovelty,
  });
  await insertLine(client, CAN03.orderId, CAN03.lineA, CAN03.lineAAmount);
  await insertLine(client, CAN03.orderId, CAN03.lineB, CAN03.lineBAmount);
  await insertTransaction(
    client,
    CAN03.orderId,
    CAN03.parentTransactionId,
    CAN03.instrument,
    CAN03.parentTransactionRemaining,
  );
  await insertFee(
    client,
    CAN03.orderId,
    CAN03.lineA,
    CAN03.parentTransactionId,
    CAN03.feeA,
    CAN03.currency,
    CAN03.feeSourceRef,
  );
  await insertFee(
    client,
    CAN03.orderId,
    CAN03.lineB,
    CAN03.parentTransactionId,
    CAN03.feeB,
    CAN03.currency,
    CAN03.feeSourceRef,
  );

  // --- a second in-scope order ----------------------------------------------------------
  await insertOrder(client, {
    orderId: OTHER_ORDER.orderId,
    resourceRef: OTHER_ORDER.resourceRef,
    grade: 'RECORD',
    currency: OTHER_ORDER.currency,
    novelty: 'NEW',
  });
  await insertLine(client, OTHER_ORDER.orderId, OTHER_ORDER.lineId, OTHER_ORDER.amount);
  await insertTransaction(
    client,
    OTHER_ORDER.orderId,
    OTHER_ORDER.parentTransactionId,
    OTHER_ORDER.instrument,
    OTHER_ORDER.amount,
  );
  await insertFee(
    client,
    OTHER_ORDER.orderId,
    OTHER_ORDER.lineId,
    OTHER_ORDER.parentTransactionId,
    OTHER_ORDER.fee,
    OTHER_ORDER.currency,
    'record:processor_settlement_terms:mock_processor:ORD-777',
  );

  // --- a CLAIM-grade order --------------------------------------------------------------
  //
  // It carries a fully refundable line and transaction. That is the point: everything about
  // it is enumerable EXCEPT its grade, so a test that gets an empty set from it is observing
  // the grade check and not an accidentally empty order.
  await insertOrder(client, {
    orderId: CLAIM_GRADE_ORDER.orderId,
    resourceRef: CLAIM_GRADE_ORDER.resourceRef,
    grade: 'CLAIM',
    currency: CLAIM_GRADE_ORDER.currency,
    novelty: 'NEW',
  });
  await insertLine(client, CLAIM_GRADE_ORDER.orderId, 'line:ORD-CLAIM:1', '9.00');
  await insertTransaction(client, CLAIM_GRADE_ORDER.orderId, 'txn:CH-CLAIM', 'original', '9.00');
  await insertFee(
    client,
    CLAIM_GRADE_ORDER.orderId,
    'line:ORD-CLAIM:1',
    'txn:CH-CLAIM',
    '0.40',
    CLAIM_GRADE_ORDER.currency,
    'record:processor_settlement_terms:mock_processor:ORD-CLAIM',
  );

  // --- the 2x2 dimensionality order -----------------------------------------------------
  await insertOrder(client, {
    orderId: TWO_BY_TWO.orderId,
    resourceRef: TWO_BY_TWO.resourceRef,
    grade: 'RECORD',
    currency: TWO_BY_TWO.currency,
    novelty: 'RETURNING',
  });
  for (const lineId of TWO_BY_TWO.lines) {
    await insertLine(client, TWO_BY_TWO.orderId, lineId, TWO_BY_TWO.lineAmount);
  }
  for (const transaction of TWO_BY_TWO.transactions) {
    await insertTransaction(
      client,
      TWO_BY_TWO.orderId,
      transaction.id,
      transaction.instrument,
      transaction.remaining,
    );
    for (const lineId of TWO_BY_TWO.lines) {
      await insertFee(
        client,
        TWO_BY_TWO.orderId,
        lineId,
        transaction.id,
        TWO_BY_TWO.fee,
        TWO_BY_TWO.currency,
        'record:processor_settlement_terms:mock_processor:ORD-2X2',
      );
    }
  }
}

/**
 * The concurrent partial refund `36 §2` VC-C3 injects: line A is exhausted.
 *
 * A real UPDATE against the authoritative row, committed by a DIFFERENT connection from the
 * one the lease holds — so the mutation is genuinely concurrent state change and not the
 * test rewriting its own snapshot.
 */
export async function exhaustLineA(client: Client): Promise<void> {
  const result = await client.query(
    `UPDATE commerce_order_line
        SET refundable_remaining = 0
      WHERE company_id = $1 AND order_id = $2 AND line_id = $3`,
    [COMPANY_ID, CAN03.orderId, CAN03.lineA],
  );
  if (result.rowCount !== 1) {
    throw new Error(`the CAN-03 mutation updated ${String(result.rowCount)} rows, not 1`);
  }
}

// =====================================================================================
// The component graph
// =====================================================================================

export interface EnumerationHarness {
  readonly signer: TestSigner;
  readonly clock: FixedClock;
  readonly leases: EntityLeaseManager;
  readonly enumerator: EffectEnumerator;
  readonly canonicaliser: EffectCanonicaliser;
  readonly liveSelector: LiveSelectorCanonicaliser;
  readonly registry: ConstructorRegistry;
  readonly versions: ConstructorVersionResolver;
}

/** The instant the S1C fixtures enumerate at. Arbitrary and fixed; nothing sleeps. */
export const FIXTURE_NOW = new Date('2026-09-05T10:00:00.000Z');

export function makeEnumerationHarness(
  harness: Harness,
  options: {
    readonly signer?: TestSigner;
    readonly records?: readonly ConstructorVersionRecord[];
    readonly constructors?: readonly RegisteredConstructor[];
    readonly at?: Date;
  } = {},
): EnumerationHarness {
  const signer = options.signer ?? newTestSigner();
  const records = options.records ?? [signConstructorVersion(signer, REFUND_VERSION_1_0)];
  const versions = new ConstructorVersionResolver(signer.publicKey, [...records]);
  const registry = new ConstructorRegistry(
    options.constructors !== undefined ? [...options.constructors] : [refundCreateConstructor],
  );
  const clock = new FixedClock(options.at ?? FIXTURE_NOW);
  const leases = new EntityLeaseManager({ pool: harness.pool });
  const enumerator = new EffectEnumerator({ registry, versions, clock });
  const canonicaliser = new EffectCanonicaliser({ registry, versions });
  const liveSelector = new LiveSelectorCanonicaliser({ enumerator, canonicaliser, clock });
  return { signer, clock, leases, enumerator, canonicaliser, liveSelector, registry, versions };
}

/**
 * The kernel-supplied half of the canonicalisation context.
 *
 * Note what is NOT here and cannot be passed: the resource, the ledger currency, the
 * customer novelty, the retained fee and the `enumeration_ref`. Every one of those is
 * derived by the live boundary from authoritative state or from the kernel's own enumeration
 * record, so no test — and no future caller — can pair a live-enumerated option with
 * economics from somewhere else.
 */
export function kernelContext(
  overrides: { readonly authorisationRef?: string; readonly principalRole?: string } = {},
): KernelSuppliedContext {
  return {
    companyId: COMPANY_ID,
    principal: computed({
      id: PRINCIPAL_ID,
      kind: 'AGENT' as const,
      // `26 §3`'s declared `Principal.role`; `26 §8` reads it as
      // `principal in Role::"support_reasoner"`. S1D.
      role: overrides.principalRole ?? 'support_reasoner',
      delegationDepth: 1,
    }),
    grantWindows: {
      windowRefs: ['W_DAY_REFUND', 'W_MONTH_REFUND'],
      resolvedBy: 'fixture:s1c-authoritative-grant-window-context',
    },
    contextDigest: 'ctxdigest:s1c-0001',
    authorisationRef: overrides.authorisationRef ?? 'auth:AR-S1C-0001',
  };
}

/** The wire form of a well-formed S1C intent. */
export function rawIntent(overrides: {
  readonly actionClass?: string;
  readonly resourceRef?: string;
  readonly enumerationId?: string;
  readonly optionId?: string;
  readonly reasonCode?: string;
  readonly rationale?: string;
}): Record<string, unknown> {
  return {
    action_class: overrides.actionClass ?? 'refund.create',
    resource_ref: overrides.resourceRef ?? CAN03.resourceRef,
    selector: {
      enumeration_id: overrides.enumerationId ?? '',
      option_id: overrides.optionId ?? '',
    },
    reason_code: overrides.reasonCode ?? 'CUSTOMER_REPORTED_DAMAGE',
    rationale: overrides.rationale ?? 'Customer photographed a cracked panel on arrival.',
  };
}
