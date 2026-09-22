import { generateKeyPairSync, type KeyObject } from 'node:crypto';

import type { Client } from '../../src/db/pool.js';
import { parseProposedIntent } from '../../src/kernel/canonicalisation/intent.js';
import type { HeldEntityLease } from '../../src/kernel/enumeration/entityLease.js';
import { Ed25519DecisionSigner } from '../../src/kernel/authorisation/decisionSignature.js';
import type {
  LocalAuthorisationOptions,
  LocalAuthorisationRequestFacts,
  RateClassFacts,
} from '../../src/kernel/authorisation/localAuthorisation.js';
import { commitLocalAuthorisation } from '../../src/kernel/authorisation/localAuthorisation.js';
import type { LocalAuthorisationOutcome } from '../../src/kernel/authorisation/localAuthorisationResult.js';
import type { LocalCommitPoint } from '../../src/kernel/authorisation/localAuthorisationErrors.js';
import { money, type Money } from '../../src/kernel/exposure/money.js';
import { GOOGLE_ADS, standingCap } from '../../src/kernel/exposure/standingCap.js';
import { instanceFor, type WindowInstance } from '../../src/kernel/exposure/windowInstance.js';
import {
  makeAuthorityHarness,
  nonAuthorityContext,
  s1eSpec,
  workerSession,
  type AuthorityHarness,
} from './authorityFixture.js';
import { entityKeyFor, FIXTURE_NOW, makeSpec, rawIntent } from './enumerationFixture.js';
import { COMPANY_ID, COMPANY_TZ, RATE_GRANT, windowPeriod, type Harness } from './fixture.js';

/**
 * The S1F test fixture.
 *
 * =====================================================================================
 * NO SELF-VALIDATING ORACLE
 *
 * Nothing in this file computes an EXPECTED value with production code. In particular:
 *
 *   - the expected reservation amounts are HAND-AUTHORED decimal strings with a source
 *     reference (`S1F_EXPECTED`), never `totalExposure()` or `authoritativeCost.ts`;
 *   - the expected window set is a HAND-AUTHORED list of window ids, never
 *     `resolveWindowRefs` or `referencedWindows.ts`;
 *   - the expected lock order is a HAND-AUTHORED array, never `declaredOrder`;
 *   - the expected `journal_seq` values are hand-authored integers;
 *   - every read-back of committed state goes through DIRECT SQL below, never through a
 *     production reader.
 *
 * `standingCap` IS used, and only to BUILD the rate-class input the transaction is given —
 * it is production input, not a production oracle. The rate-class EXPECTED figures
 * ($186.00 and $12.00) are hand-authored from `26 §2.1.3`'s worked January example, exactly
 * as accepted VC-S7 authored them.
 * =====================================================================================
 */

// =====================================================================================
// The hand-authored expected economics
// =====================================================================================

/**
 * The figures every S1F money assertion is written against, hand-authored.
 *
 * `S1E_PASS_ORDER`: $9.41 vendor + $0.59 retained fee = $10.00 total exposure. The sum is
 * arithmetic a reader can check, and the two operands are the fixture's own declared
 * `lineRemaining` and `retainedFee` columns.
 *
 * `S1E_OVER_CAP_ORDER`: VC-C1's construction, preserved verbatim as the S1F mandate
 * requires — $25.00 + $1.03 = $26.03, against a $25.00 per-action bound.
 */
export const S1F_EXPECTED = Object.freeze({
  pass: Object.freeze({
    vendorAmount: '9.41',
    retainedFee: '0.59',
    totalExposure: '10.00',
  }),
  vcC1: Object.freeze({
    vendorAmount: '25.00',
    retainedFee: '1.03',
    totalExposure: '26.03',
    perActionMax: '25.00',
  }),
  /**
   * `26 §2.1.3`'s worked January example, transcribed:
   *   standing_cap(W_MONTH_ADSPEND:2026-01) = $6.00 x max(31, 30.4) = $186.00
   *   standing_cap(W_DAY_ADSPEND:2026-01-01) = $6.00 x 2.0          = $12.00
   */
  rate: Object.freeze({
    totalExposure: '0.00',
    reservationAmount: '0.00',
    monthForwardIntegral: '186.00',
    dayForwardIntegral: '12.00',
  }),
});

/**
 * The windows the S1E refund grant references, hand-authored.
 *
 * `authorityFixture.ts` declares `REFUND_GRANT_WINDOWS` for the grant it INSERTS. This list
 * is written out again here as the EXPECTATION, so a test comparing the committed
 * `authorisation_window_instance` rows against it is not comparing the production
 * resolution against the production insert.
 */
export const EXPECTED_REFUND_WINDOWS: readonly string[] = ['W_DAY_REFUND', 'W_MONTH_REFUND'];

/** The rate grant's windows, hand-authored from `51 §3.2`. */
export const EXPECTED_RATE_WINDOWS: readonly string[] = ['W_DAY_ADSPEND', 'W_MONTH_ADSPEND'];

// =====================================================================================
// The signer
// =====================================================================================

export interface DecisionKeyPair {
  readonly privateKey: KeyObject;
  readonly publicKey: KeyObject;
  readonly signer: Ed25519DecisionSigner;
  readonly keyId: string;
}

/**
 * A throwaway Ed25519 pair for the decision signature.
 *
 * NO KEY MANAGEMENT, exactly as accepted S1B does for `ConstructorVersionRecord`. `50 §2`'s
 * owner-signing obligation (O4) is OPEN and nothing here claims otherwise.
 */
export function newDecisionSigner(keyId = 'key:s1f-test-decision-1'): DecisionKeyPair {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  return {
    privateKey,
    publicKey,
    signer: new Ed25519DecisionSigner(privateKey, keyId),
    keyId,
  };
}

// =====================================================================================
// The harness
// =====================================================================================

export interface LocalAuthorityHarness extends AuthorityHarness {
  readonly decisionKeys: DecisionKeyPair;
  commitOptions(
    overrides?: {
      readonly at?: (point: LocalCommitPoint) => Promise<void>;
      readonly maxAttempts?: number;
    },
  ): LocalAuthorisationOptions;
}

export function makeLocalAuthorityHarness(
  harness: Harness,
  options: Parameters<typeof makeAuthorityHarness>[1] = {},
): LocalAuthorityHarness {
  const authority = makeAuthorityHarness(harness, options);
  const decisionKeys = newDecisionSigner();
  return {
    ...authority,
    decisionKeys,
    commitOptions(overrides = {}) {
      return {
        clock: authority.clock,
        signer: decisionKeys.signer,
        lineage: {
          // The lineage the S1F outcome carries is the S1E lineage plus the local trace.
          // These three are placeholders on the DIRECT-commit path only; the pipeline path
          // carries the real ones through `authoriseLocallyUnderLease`.
          policyVersion: 'fixture:policy-version',
          constructorVersion: RATE_CONSTRUCTOR_VERSION,
          determiningPolicies: [],
          stepsEvaluated: [],
        },
        ...(overrides.at === undefined ? {} : { at: overrides.at }),
        ...(overrides.maxAttempts === undefined ? {} : { maxAttempts: overrides.maxAttempts }),
      };
    },
  };
}

// =====================================================================================
// The pipeline path — `26 §7` D through W, one lease
// =====================================================================================

let refCounter = 0;

/** A fresh kernel-allocated authorisation reference. `26 §2.1`'s gateway allocation. */
export function freshAuthorisationRef(): string {
  refCounter += 1;
  return `auth:AR-S1F-${String(refCounter).padStart(4, '0')}`;
}

/**
 * Enumerate under one lease, then run `26 §7` D–W under a SECOND lease on ONE connection.
 *
 * Two leases is the accepted S1E/S1C shape — `26 §2.0.1` makes `enumerate_effects` a READ
 * the model performs first — and the S1F span is the second lease: every gate, step R and
 * the commit all happen inside it, on `lease.client`.
 */
/**
 * The only two fields the S1F span needs from an order fixture.
 *
 * Deliberately structural rather than the accepted `S1eOrder` union: the idempotency suite
 * runs the span against the ACCEPTED S1C `CAN03` order to obtain a SEMANTICALLY DISTINCT
 * effect, and a union of the two S1E orders cannot express that. Nothing else about the
 * order reaches this function — the economics come from C′, from authoritative state.
 */
export interface OrderRef {
  readonly orderId: string;
  readonly resourceRef: string;
}

export async function proposeAndAuthorise(
  kernel: LocalAuthorityHarness,
  order: OrderRef,
  options: {
    readonly sessionId?: string;
    readonly spec?: ReturnType<typeof makeSpec>;
    readonly reasonCode?: string;
    readonly authorisationRef?: string;
    readonly at?: (point: LocalCommitPoint) => Promise<void>;
    readonly maxAttempts?: number;
    readonly barrier?: () => Promise<void>;
    readonly observe?: (lease: HeldEntityLease) => Promise<void>;
  } = {},
): Promise<LocalAuthorisationOutcome> {
  const spec = options.spec ?? s1eSpec();
  const key = entityKeyFor(order.orderId);
  const read = await kernel.leases.withEntityLease(key, async (lease) => {
    const outcome = await kernel.enumerator.enumerate(lease, {
      actionClass: 'refund.create',
      resourceRef: order.resourceRef,
      spec,
    });
    return {
      enumerationId: outcome.set.enumerationId,
      optionId: outcome.set.options[0]?.optionId ?? '',
    };
  });
  const intent = parseProposedIntent(
    rawIntent({
      resourceRef: order.resourceRef,
      enumerationId: read.enumerationId,
      optionId: read.optionId,
      ...(options.reasonCode === undefined ? {} : { reasonCode: options.reasonCode }),
    }),
  );
  const supplied = {
    ...nonAuthorityContext(),
    authorisationRef: options.authorisationRef ?? freshAuthorisationRef(),
  };
  return kernel.leases.withEntityLease(key, async (lease) => {
    const outcome = await kernel.pipeline.authoriseLocallyUnderLease(
      lease,
      workerSession(options.sessionId),
      intent,
      spec,
      supplied,
      kernel.commitOptions({
        ...(options.at === undefined ? {} : { at: options.at }),
        ...(options.maxAttempts === undefined ? {} : { maxAttempts: options.maxAttempts }),
      }),
      options.barrier,
    );
    if (options.observe !== undefined) await options.observe(lease);
    return outcome;
  });
}

// =====================================================================================
// The rate-class path
// =====================================================================================

/**
 * `campaign.budget.set` reaches step R with a KERNEL-SUPPLIED exposure block, not through
 * C′.
 *
 * WHY, stated plainly. `26 §7` step C2 denies `NOT_CANONICALISABLE` for any class with no
 * registered constructor, and no constructor is registered for `campaign.budget.set`:
 * building one is a per-class commerce state model, a per-class enumerator and a per-class
 * semantic option digest, which is canonicaliser work for a new class and is excluded from
 * the S1F mandate. The class IS in the closed catalogue (`actionCatalogue.ts`, `rateBased:
 * true`), so nothing about it is invented here.
 *
 * What S1F therefore proves for the rate branch is the property S1F is about: that the
 * zero-amount reservation, the `StandingAuthorization`, its `StandingRevocationAuthority`,
 * the `standing_window_exposure` rows, the effect, the signed decision and the journal row
 * commit or fail TOGETHER. It does not prove that a rate class traverses C′, and the S1F
 * result says so. This is the same boundary accepted VC-S7 drew.
 */
export const RATE_CONSTRUCTOR_VERSION = Object.freeze({
  constructorId: 'constructor:campaign.budget.set:fixture',
  actionClass: 'campaign.budget.set' as const,
  semanticMajor: 1,
  nonSemanticMinor: 0,
  semanticChange: false,
  changedFields: [] as const,
  signedAt: new Date('2026-01-01T00:00:00.000Z'),
  recordHash: 'fixture:rate-constructor-record-hash',
});

export const RATE_RESOURCE_REF = 'campaign:CMP-S1F-1';

export function rateFacts(
  overrides: {
    readonly authorisationRef?: string;
    readonly forwardIntegral?: Money;
    readonly windowRefs?: readonly string[];
    readonly approvalRequirement?: string;
  } = {},
): LocalAuthorisationRequestFacts {
  return {
    companyId: COMPANY_ID,
    sessionId: 'session:S1F-kernel',
    taskId: 'task:T-S1F-rate',
    principalId: 'principal:support_reasoner:1',
    authorisationRef: overrides.authorisationRef ?? freshAuthorisationRef(),
    actionClass: RATE_GRANT.actionClass,
    resourceRef: RATE_RESOURCE_REF,
    resourceId: 'CMP-S1F-1',
    dispatchPayloadHash: 'fixture:rate-dispatch-payload-hash',
    intentHash: 'fixture:rate-intent-hash',
    contextDigest: 'fixture:rate-context-digest',
    constructorVersion: RATE_CONSTRUCTOR_VERSION,
    policyVersion: 'fixture:policy-version',
    exposure: {
      // `26 §2.1.3`'s field table: vendor_amount NULL, total_exposure 0.00.
      vendorAmount: null,
      totalExposure: money('0.00'),
      // The WHOLE economic exposure, and it is a SEPARATE field. The per-instance figure
      // the standing rows carry is `standing_cap`; this is the block's own record of the
      // forward integral, hand-authored from `26 §2.1.3`'s January month figure.
      forwardIntegral: overrides.forwardIntegral ?? money(S1F_EXPECTED.rate.monthForwardIntegral),
    },
    recoverability: 'COMPENSABLE',
    valueDirection: 'OUTBOUND_TO_COUNTERPARTY',
    adapter: RATE_GRANT.adapter,
    idempotencyKey: `idem:rate:${overrides.authorisationRef ?? String(refCounter)}`,
    windowRefs: overrides.windowRefs ?? [...RATE_GRANT.windows],
    approvalRequirement: overrides.approvalRequirement ?? 'NONE',
    autonomyLevel: 'L3',
    gateClass: 'UNGATED_LOGGED',
    // Accepted VC-S7's figure. Both ad-spend windows declare `max_count` UNBOUNDED
    // (`51 §2`), so the count ledger does not bind a rate class either way.
    countUnits: 0n,
    // `25 §14.1`'s revalidation identity. NULL for the rate branch, which never traverses
    // C′ (`26 §7` step C2 — no registered constructor for `campaign.budget.set`), so it has
    // no enumeration and no option. `dispatchRevalidation.ts` refuses to dispatch an effect
    // whose identity is absent; a rate class is never dispatched at S1J and the accepted
    // S1F suites assert only its authorisation.
    enumerationId: null,
    optionId: null,
  };
}

/** The rate extension: `51 §3.2`'s single rate grant, and `standing_cap` per instance. */
export function rateExtension(
  at: Date,
  options: { readonly liveInstances?: readonly string[] } = {},
): RateClassFacts {
  return {
    revocationEffectClass: RATE_GRANT.revocationEffectClass,
    rateAmount: money(RATE_GRANT.rateAmount),
    rateCurrency: RATE_GRANT.rateCurrency,
    ratePeriod: RATE_GRANT.ratePeriod,
    expiresAt: new Date(at.getTime() + 30 * 86_400_000),
    // `24 §3.1`: "cessation_grace is 72 hours, CONFIGURED".
    cessationGraceHours: 72,
    standingCapFor(instance: WindowInstance) {
      return {
        standingCap: standingCap(
          money(RATE_GRANT.rateAmount),
          windowPeriod(instance.windowId),
          instance,
          GOOGLE_ADS,
        ),
        instanceInScope:
          options.liveInstances === undefined
            ? true
            : options.liveInstances.includes(instance.windowId),
      };
    },
  };
}

export async function authoriseRateLocally(
  kernel: LocalAuthorityHarness,
  at: Date,
  options: {
    readonly facts?: LocalAuthorisationRequestFacts;
    readonly at?: (point: LocalCommitPoint) => Promise<void>;
  } = {},
): Promise<LocalAuthorisationOutcome> {
  const facts = options.facts ?? rateFacts();
  return kernel.leases.withEntityLease(
    { companyId: COMPANY_ID, entityType: 'campaign', entityId: facts.resourceId },
    (lease) =>
      commitLocalAuthorisation(
        lease,
        { kind: 'RATE', facts, rate: rateExtension(at) },
        kernel.commitOptions({ ...(options.at === undefined ? {} : { at: options.at }) }),
      ),
  );
}

// =====================================================================================
// Direct SQL readers. Every S1F assertion about committed state comes through these.
// =====================================================================================

export interface ReservationRow {
  readonly reservation_id: string;
  readonly authorisation_id: string;
  readonly amount: string;
  readonly vendor_amount: string | null;
  readonly forward_integral: string | null;
  readonly is_rate_class: boolean;
}

export async function readReservations(client: Client): Promise<readonly ReservationRow[]> {
  const result = await client.query<ReservationRow>(
    `SELECT reservation_id, authorisation_id, amount, vendor_amount, forward_integral,
            is_rate_class
       FROM exposure_reservation
      WHERE company_id = $1
      ORDER BY reservation_id`,
    [COMPANY_ID],
  );
  return result.rows;
}

export async function countOf(client: Client, table: string): Promise<number> {
  // The table name is a literal from the call site, never user input; parameterising an
  // identifier is not possible in SQL and the alternative is a hand-written query per table.
  const result = await client.query<{ n: string }>(`SELECT count(*)::TEXT AS n FROM ${table}`);
  return Number(result.rows[0]!.n);
}

export async function scalar(client: Client, sql: string, params: unknown[] = []): Promise<string | null> {
  const result = await client.query<Record<string, string | null>>(sql, params);
  const row = result.rows[0];
  if (row === undefined) return null;
  return Object.values(row)[0] ?? null;
}

export async function rowsOf<T extends Record<string, unknown>>(
  client: Client,
  sql: string,
  params: unknown[] = [],
): Promise<readonly T[]> {
  const result = await client.query<T>(sql, params);
  return result.rows;
}

/** Every table the local authorisation transaction writes, for a "nothing persisted" sweep. */
export const S1F_TABLES: readonly string[] = [
  'authorisation',
  'authorisation_window_instance',
  'effect',
  'approval',
  'authorisation_decision',
  'effect_journal',
  'exposure_reservation',
  'reservation_window_instance',
  'standing_authorization',
  'standing_revocation_authority',
  'standing_window_exposure',
];

/** The hand-authored instance key for a fixture window at a given instant. */
export function expectedInstanceKey(windowId: string, at: Date): string {
  // `instanceFor` is used to BUILD the key, and the key's SHAPE is asserted independently in
  // the accepted S1A suite (`W_MONTH_ADSPEND:2026-01`). Reproducing the calendar arithmetic
  // here would be a second window-instance implementation, which is worse than reusing the
  // accepted one for a value that is not itself the property under test.
  return instanceFor(windowId, windowPeriod(windowId), at, COMPANY_TZ).key;
}

export { COMPANY_ID, COMPANY_TZ, FIXTURE_NOW, RATE_GRANT };
