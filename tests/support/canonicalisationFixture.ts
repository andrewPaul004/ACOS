import { generateKeyPairSync, sign as signBytes, type KeyObject } from 'node:crypto';

import { money, type Money } from '../../src/kernel/exposure/money.js';
import { computed } from '../../src/kernel/canonicalisation/brands.js';
import type {
  ReasonCode,
  ReasonCodeScope,
} from '../../src/kernel/canonicalisation/actionCatalogue.js';
import type { AuthoritativeRetainedFee } from '../../src/kernel/canonicalisation/authoritativeCost.js';
import type { AuthoritativeGrantWindowContext } from '../../src/kernel/canonicalisation/grantWindows.js';
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
import { computeOptionId } from '../../src/kernel/canonicalisation/optionDigest.js';
import { refundSemanticOptionDigest } from '../../src/kernel/canonicalisation/constructors/refundCreate.js';
import type {
  AuthoritativeCanonicalisationContext,
  ResolvedResource,
  SelectedAuthoritativeRefundOption,
} from '../../src/kernel/canonicalisation/types.js';

import {
  VC_C1,
  VC_C1_EXPECTED_WINDOW_REFS,
  VC_C1_ORDER,
  VC_C1_REASON_CODE,
  VC_C1_SEMANTIC_OPTION_FIELDS,
  formatMinor,
} from './canonicalisationOracle.js';

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
 * The authoritative retained processing fee, as an AMOUNT — owner clarification S1B-C3a.
 *
 * $1.03, hand-authored in the oracle and carried here as the kernel-owned authoritative
 * input. There is no schedule, no rate and no formula anywhere in the S1B tree: the fixture
 * states the figure the architecture prints, and the constructor adds it.
 *
 * A later adapter/state-ingestion slice populates this same field from a real processor
 * record. That slice, not S1B, selects a fee model.
 */
export const FIXTURE_RETAINED_FEE: AuthoritativeRetainedFee = Object.freeze({
  amount: money(formatMinor(VC_C1.authoritativeRetainedFeeMinor)),
  sourceRef: 'record:processor_settlement_terms:mock_processor:ORD-123',
  currency: 'USD',
});

/**
 * The authoritative grant/window-resolution boundary — owner clarification S1B-C5a.
 *
 * Fixture-supplied, kernel-side, never model-supplied and never inferred from `rationale`.
 * `resolvedBy` says in as many words that this is a fixture and not a grant resolution, so
 * an audit reader cannot mistake it for one.
 */
export const FIXTURE_GRANT_WINDOWS: AuthoritativeGrantWindowContext = Object.freeze({
  windowRefs: VC_C1_EXPECTED_WINDOW_REFS,
  resolvedBy: 'fixture:s1b-authoritative-grant-window-context',
});

export const FIXTURE_ENUMERATION_ID = 'enum:2026-09-05T10:00:00Z:ORD-123:refund.create';

export interface ContextOverrides {
  readonly taskId?: string;
  readonly authorisationRef?: string;
  readonly enumerationId?: string;
  /** The authoritative retained fee. Pass `null` to model a class that carries none. */
  readonly retainedProcessingFee?: AuthoritativeRetainedFee | null;
  readonly grantWindows?: AuthoritativeGrantWindowContext;
  /**
   * The RESOLVED resource. S1B.2 finding 1A's cohesion case corrupts exactly one of its
   * fields, so the override takes the whole record rather than a convenience field.
   */
  readonly resource?: ResolvedResource;
  /** `26 §2.1`: "the single ledger currency". Varied by finding 1C's cohesion case. */
  readonly ledgerCurrency?: string;
}

/**
 * The authoritative context. Every field kernel-owned; none of it reaches the model.
 *
 * S1B.2 finding 1B: there is NO `catalogueEntry` here any more, and no override that could
 * supply one. The canonicaliser reads the closed catalogue itself. A test that wanted to
 * give a `refund.create` request another class's recoverability, value_direction, adapter or
 * method has nothing to pass — which is the structural form of the repair.
 */
export function makeContext(overrides: ContextOverrides = {}): AuthoritativeCanonicalisationContext {
  return {
    companyId: computed('company:ACME'),
    taskId: computed(overrides.taskId ?? 'task:T-4471'),
    principal: computed({
      id: 'principal:support_reasoner:1',
      kind: 'AGENT' as const,
      delegationDepth: 1,
    }),
    resource: computed(
      overrides.resource ?? {
        resourceRef: VC_C1_ORDER.resourceRef,
        resourceId: VC_C1_ORDER.resourceId,
        grade: 'RECORD' as const,
      },
    ),
    enumerationRef: computed({
      enumerationId: overrides.enumerationId ?? FIXTURE_ENUMERATION_ID,
      computedAt: new Date('2026-09-05T10:00:00.000Z'),
    }),
    ledgerCurrency: computed(overrides.ledgerCurrency ?? 'USD'),
    retainedProcessingFee:
      overrides.retainedProcessingFee === null
        ? null
        : computed(overrides.retainedProcessingFee ?? FIXTURE_RETAINED_FEE),
    grantWindows: computed(overrides.grantWindows ?? FIXTURE_GRANT_WINDOWS),
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
  readonly resourceId?: string;
  /**
   * Current authoritative policy state — `26 §8`'s `line_refundable_remaining`.
   *
   * S1B.2 finding 2's discriminating pair varies ONLY this: the recorded selected option
   * must move and `option_id` must not.
   */
  readonly lineRefundableRemaining?: Money;
  /** The option's own currency. Varied by finding 1C's cohesion case. */
  readonly currency?: string;
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
    lineRefundableRemaining: computed(
      overrides.lineRefundableRemaining ??
        money(formatMinor(VC_C1_ORDER.lineRefundableRemainingMinor)),
    ),
    // S1B.2 finding 3: there is no `destinationInstrumentRef` to supply. The destination is
    // the RECORD-grade parent transaction's own instrument, content-addressed by
    // `parentTransactionId` and `instrument`, both of which ARE option-identity members.
    currency: computed(overrides.currency ?? 'USD'),
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
    reason_code: overrides.reasonCode ?? VC_C1_REASON_CODE,
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
