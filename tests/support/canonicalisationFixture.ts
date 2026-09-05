import { generateKeyPairSync, sign as signBytes, type KeyObject } from 'node:crypto';

import { money, type Money } from '../../src/kernel/exposure/money.js';
import { computed } from '../../src/kernel/canonicalisation/brands.js';
import {
  ACTION_CATALOGUE,
  type ProcessorFeeSchedule,
  type ReasonCode,
  type ReasonCodeScope,
} from '../../src/kernel/canonicalisation/actionCatalogue.js';
import {
  ConstructorVersionResolver,
  constructorVersionSigningBytes,
  type ConstructorVersionRecord,
} from '../../src/kernel/canonicalisation/constructorVersion.js';
import { EffectCanonicaliser } from '../../src/kernel/canonicalisation/canonicaliser.js';
import {
  ConstructorRegistry,
  type RegisteredConstructor,
} from '../../src/kernel/canonicalisation/registry.js';
import {
  REFUND_CREATE_CONSTRUCTOR_ID,
  refundCreateConstructor,
} from '../../src/kernel/canonicalisation/constructors/refundCreate.js';
import {
  computeOptionId,
  refundSemanticOptionDigest,
} from '../../src/kernel/canonicalisation/optionDigest.js';
import type {
  AuthoritativeCanonicalisationContext,
  SelectedAuthoritativeRefundOption,
} from '../../src/kernel/canonicalisation/types.js';

import { VC_C1, VC_C1_ORDER, VC_C1_SEMANTIC_OPTION_FIELDS } from './canonicalisationOracle.js';

/**
 * Kernel-side fixtures for the S1B canonicalisation suite.
 *
 * This file builds the KERNEL'S OWN INPUTS — the authoritative context and the selected
 * authoritative option — so it legitimately imports `src/`. It is not the oracle. The
 * oracle is `canonicalisationOracle.ts`, which imports nothing from `src/` and holds every
 * expected value.
 *
 * Test keys only. `26 §2.1.2` and `50 §2` class 19 make constructors owner-signed control
 * artifacts; S1B verifies real Ed25519 signatures and builds no key management, per the
 * S1B contract §4.2.
 */

export interface TestSigner {
  readonly publicKey: KeyObject;
  readonly privateKey: KeyObject;
}

export function newTestSigner(): TestSigner {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return { publicKey, privateKey };
}

export interface UnsignedConstructorVersion {
  readonly constructorId: string;
  readonly actionClass: string;
  readonly semanticMajor: number;
  readonly nonSemanticMinor: number;
  readonly changedFields: readonly string[];
  readonly semanticChange: boolean;
  readonly signedAt: Date;
}

/** Sign a record with a test key, over the same canonical bytes the verifier reads. */
export function signConstructorVersion(
  signer: TestSigner,
  record: UnsignedConstructorVersion,
): ConstructorVersionRecord {
  return {
    ...record,
    signature: signBytes(null, constructorVersionSigningBytes(record), signer.privateKey),
  };
}

/** The `refund.create` version record the S1B fixtures canonicalise under. */
export const REFUND_VERSION_1_0: UnsignedConstructorVersion = Object.freeze({
  constructorId: REFUND_CREATE_CONSTRUCTOR_ID,
  actionClass: 'refund.create',
  semanticMajor: 1,
  nonSemanticMinor: 0,
  changedFields: Object.freeze([]),
  semanticChange: false,
  signedAt: new Date('2026-09-05T00:00:00.000Z'),
});

/**
 * The processor's published fee schedule as an authoritative RECORD-grade input.
 * Owner clarification S1B-C3. 2.9% + $0.30.
 */
export const FIXTURE_FEE_SCHEDULE: ProcessorFeeSchedule = Object.freeze({
  scheduleRef: 'record:processor_fee_schedule:mock_processor:2026-01',
  percentageNumerator: VC_C1.feePercentNumerator,
  percentageDenominator: VC_C1.feePercentDenominator,
  fixed: money('0.30'),
  currency: 'USD',
});

export const FIXTURE_ENUMERATION_ID = 'enum:2026-09-05T10:00:00Z:ORD-123:refund.create';

export interface ContextOverrides {
  readonly taskId?: string;
  readonly authorisationRef?: string;
  readonly enumerationId?: string;
  readonly actionClass?: keyof typeof ACTION_CATALOGUE;
  readonly feeSchedule?: ProcessorFeeSchedule;
}

/** The authoritative context. Every field kernel-owned; none of it reaches the model. */
export function makeContext(overrides: ContextOverrides = {}): AuthoritativeCanonicalisationContext {
  const actionClass = overrides.actionClass ?? 'refund.create';
  return {
    companyId: computed('company:ACME'),
    taskId: computed(overrides.taskId ?? 'task:T-4471'),
    principal: computed({
      id: 'principal:support_reasoner:1',
      kind: 'AGENT' as const,
      delegationDepth: 1,
    }),
    resource: computed({
      resourceRef: VC_C1_ORDER.resourceRef,
      resourceId: VC_C1_ORDER.resourceId,
      grade: 'RECORD' as const,
    }),
    enumerationRef: computed({
      enumerationId: overrides.enumerationId ?? FIXTURE_ENUMERATION_ID,
      computedAt: new Date('2026-09-05T10:00:00.000Z'),
    }),
    catalogueEntry: computed(ACTION_CATALOGUE[actionClass]),
    ledgerCurrency: computed('USD'),
    feeSchedule: computed(overrides.feeSchedule ?? FIXTURE_FEE_SCHEDULE),
    customerNovelty: computed(VC_C1_ORDER.customerNovelty),
    contextDigest: computed('ctxdigest:8f21c0d4'),
    authorisationRef: computed(overrides.authorisationRef ?? 'auth:AR-0001'),
  };
}

export interface OptionOverrides {
  readonly lineId?: string;
  readonly parentTransactionId?: string;
  readonly amount?: Money;
  readonly instrument?: string;
  readonly reasonCodeScope?: ReasonCodeScope;
  readonly destinationInstrumentRef?: string;
  readonly resourceId?: string;
}

/** The selected authoritative option. The model chose its IDENTITY and nothing else. */
export function makeRefundOption(
  overrides: OptionOverrides = {},
): SelectedAuthoritativeRefundOption {
  return {
    actionClass: computed('refund.create' as const),
    resourceId: computed(overrides.resourceId ?? VC_C1_ORDER.resourceId),
    lineId: computed(overrides.lineId ?? VC_C1_SEMANTIC_OPTION_FIELDS.lineId),
    parentTransactionId: computed(
      overrides.parentTransactionId ?? VC_C1_SEMANTIC_OPTION_FIELDS.parentTransactionId,
    ),
    amount: computed(overrides.amount ?? money('25.00')),
    instrument: computed(overrides.instrument ?? VC_C1_SEMANTIC_OPTION_FIELDS.instrument),
    reasonCodeScope: computed(
      overrides.reasonCodeScope ?? VC_C1_SEMANTIC_OPTION_FIELDS.reasonCodeScope,
    ),
    lineRefundableRemaining: computed(money('40.00')),
    destinationInstrumentRef: computed(
      overrides.destinationInstrumentRef ?? VC_C1_ORDER.destinationInstrumentRef,
    ),
    currency: computed('USD'),
  };
}

/** The `option_id` a well-behaved model would have read out of the enumeration. */
export function optionIdFor(option: SelectedAuthoritativeRefundOption): string {
  return computeOptionId('refund.create', option.resourceId, refundSemanticOptionDigest(option));
}

export interface RawIntentOverrides {
  readonly actionClass?: string;
  readonly resourceRef?: string;
  readonly enumerationId?: string;
  readonly optionId?: string;
  readonly reasonCode?: ReasonCode | string;
  readonly rationale?: string;
}

/** The wire form of a well-formed intent for the VC-C1 option. */
export function makeRawIntent(
  option: SelectedAuthoritativeRefundOption,
  overrides: RawIntentOverrides = {},
): Record<string, unknown> {
  return {
    action_class: overrides.actionClass ?? 'refund.create',
    resource_ref: overrides.resourceRef ?? VC_C1_ORDER.resourceRef,
    selector: {
      enumeration_id: overrides.enumerationId ?? FIXTURE_ENUMERATION_ID,
      option_id: overrides.optionId ?? optionIdFor(option),
    },
    reason_code: overrides.reasonCode ?? 'CUSTOMER_REPORTED_DAMAGE',
    rationale: overrides.rationale ?? 'Customer photographed a cracked panel on arrival.',
  };
}

export interface CanonicaliserHarness {
  readonly signer: TestSigner;
  readonly canonicaliser: EffectCanonicaliser;
  readonly versions: ConstructorVersionResolver;
}

/** The default harness: one registered constructor, one validly signed version record. */
export function makeCanonicaliser(
  options: {
    readonly signer?: TestSigner;
    readonly records?: readonly ConstructorVersionRecord[];
    readonly registerRefund?: boolean;
    /** Test-only: substitute the registered constructor set, e.g. the negative control. */
    readonly constructors?: readonly RegisteredConstructor[];
  } = {},
): CanonicaliserHarness {
  const signer = options.signer ?? newTestSigner();
  const records =
    options.records ?? ([signConstructorVersion(signer, REFUND_VERSION_1_0)] as const);
  const versions = new ConstructorVersionResolver(signer.publicKey, [...records]);
  const registry = new ConstructorRegistry(
    options.constructors !== undefined
      ? [...options.constructors]
      : options.registerRefund === false
        ? []
        : [refundCreateConstructor],
  );
  return { signer, versions, canonicaliser: new EffectCanonicaliser({ registry, versions }) };
}
