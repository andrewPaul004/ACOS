import { createHash, generateKeyPairSync, randomUUID, type KeyObject } from 'node:crypto';

import type { Client, Pool } from '../../src/db/pool.js';
import { COMPANY_ID } from './fixture.js';
import { fixtureEnumerationConstructor } from './fixtureEnumerator.js';
import {
  REFUND_VERSION_1_0,
  newTestSigner,
  signConstructorVersion,
} from './canonicalisationFixture.js';
import { refundCreateConstructor } from '../../src/kernel/canonicalisation/constructors/refundCreate.js';
import { createReplicationFixture, type ReplicationFixture } from './replicationFixture.js';
import {
  S1E_PASS_ORDER,
  insertPrincipalKey,
  loadAuthorityWorld,
  loadS1eOrders,
  s1eSpec,
  type AuthoritySigner,
} from './authorityFixture.js';
import {
  makeLocalAuthorityHarness,
  proposeAndAuthorise,
  type LocalAuthorityHarness,
} from './localAuthorisationFixture.js';
import {
  FIXTURE_NOW,
  entityKeyFor,
  kernelContext,
  loadCommerceFixture,
  rawIntent,
} from './enumerationFixture.js';
import {
  createStatutoryClock,
  retainSourceRecord,
  type Statute,
} from '../../src/kernel/clocks/statutoryClock.js';
import { parseProposedIntent } from '../../src/kernel/canonicalisation/intent.js';
import { dispatchPayloadCanonicalBytes } from '../../src/kernel/canonicalisation/canonicaliser.js';
import { commitLocalAuthorisation } from '../../src/kernel/authorisation/localAuthorisation.js';
import type { LocalAuthorisationRequestFacts } from '../../src/kernel/authorisation/localAuthorisation.js';
import { money, type Money } from '../../src/kernel/exposure/money.js';
import {
  OUTBOX_COLUMNS,
  toOutboxRow,
  type OutboxDbRow,
  type OutboxRow,
} from '../../src/kernel/outbox/outboxState.js';

/**
 * THE S1I FIXTURE.
 *
 * =================================================================================
 * NO SELF-VALIDATING ORACLE — `36 §0`, and the S1I-specific forms of the rule.
 *
 * Nothing in this file computes an EXPECTED value with the code under test. In particular:
 *
 *   - no expected outbox row, status, correlation tag, claim id or matched row is produced
 *     here. Every one lives in the test that asserts it.
 *   - every read-back of committed outbox state goes through the DIRECT SQL below, never
 *     through `src/kernel/outbox/`'s own readers. A test that read the row through
 *     `readByEffect` and asserted `readByEffect`'s answer would prove nothing.
 *   - the expected `ACOS-JCS-1` bytes for the new `OUTBOX_CLAIMED` journal kind are in
 *     `jcs1Oracle.ts`, hand-authored, importing nothing from `src/`.
 *   - the precedence EXPECTATIONS are the accepted `mirrorPrecedenceTable.ts` oracle's,
 *     not `classifyDispatchPrecedence`'s output.
 *
 * WHAT IS USED FROM `src/` AND WHY THAT IS INPUT RATHER THAN ORACLE:
 * `dispatchPayloadCanonicalBytes` and `canonicaliseUnderLease`. They PRODUCE the payload
 * a caller offers to the enqueue — production input, exactly as `standingCap` is production
 * input in the accepted S1F fixture. The enqueue then decides whether to accept it by
 * comparing against the COMMITTED authorised hash, which is the property under test.
 * =================================================================================
 *
 * =================================================================================
 * WHY THE HARNE§ IS THE DUAL-PLANE ONE.
 *
 * S1I adds a journal row kind, and `I17` is a two-sided diff. So the claim's journal row
 * has to reach the audit store, be re-chained there under the audit plane's own trigger,
 * and canonicalise identically — which needs two real PostgreSQL servers, the accepted S1G
 * replication fixture, and the accepted S1H mirror state on top of the accepted S1E/S1F
 * authority world.
 *
 * THE OWNER PRINCIPAL IS THE AUTHORITY WORLD'S. `loadAuthorityWorld` registers
 * `principal:owner` with a real Ed25519 key, and `loadMirrorFixture` would register the
 * same id again. So this fixture loads the authority world and reuses ITS owner signer for
 * `30 §5.7.2`'s override grants — one owner, one registered key, which is also `51 §3.6`'s
 * honest MVP position: "at MVP exactly one OWNER-tier principal is registered, so overrides
 * 2 and 3 are structurally unavailable."
 * =================================================================================
 */

/** `hex(sha256(bytes))`, read straight from `node:crypto` rather than from `src/`. */
function sha256Hex(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export const OWNER_PRINCIPAL_ID = 'principal:owner';

/** The instant the S1I suites work at. Fixed; nothing sleeps. */
export const S1I_NOW = FIXTURE_NOW;

export interface OutboxSeed {
  /** `30 §5.7.2`: `incident_ref` is "NOT NULL FK — the open incident it responds to". */
  readonly incidentRef: bigint;
  /** The registered OWNER-tier key, for override grant signatures. */
  readonly ownerSigner: AuthoritySigner;
}

export interface OutboxHarness {
  readonly replication: ReplicationFixture;
  readonly control: Pool;
  readonly auditOwner: Pool;
  readonly auditEvaluator: Pool;
  /** The audit plane's own Ed25519 key. `30 §5.7.1`: the control plane holds the public half. */
  readonly auditKey: { readonly publicKey: KeyObject; readonly privateKey: KeyObject };
  kernel: LocalAuthorityHarness;
  seed: OutboxSeed;
  reset(): Promise<void>;
  close(): Promise<void>;
}

export async function createOutboxHarness(): Promise<OutboxHarness> {
  const replication = await createReplicationFixture();
  const auditPair = generateKeyPairSync('ed25519');
  // ONE constructor-version signer for the harness, so the records registered below and the
  // resolver the kernel is built with share a public key.
  const signer = newTestSigner();

  let seed: OutboxSeed | null = null;
  let kernel: LocalAuthorityHarness | null = null;

  const harness: OutboxHarness = {
    replication,
    control: replication.control.pool,
    auditOwner: replication.audit.owner,
    auditEvaluator: replication.audit.evaluator,
    auditKey: { publicKey: auditPair.publicKey, privateKey: auditPair.privateKey },
    get kernel(): LocalAuthorityHarness {
      if (kernel === null) throw new Error('call reset() before reading the kernel');
      return kernel;
    },
    set kernel(value: LocalAuthorityHarness) {
      kernel = value;
    },
    get seed(): OutboxSeed {
      if (seed === null) throw new Error('call reset() before reading the seed');
      return seed;
    },
    set seed(value: OutboxSeed) {
      seed = value;
    },
    async reset() {
      await replication.reset();
      const client = await replication.control.connect();
      try {
        // The ACCEPTED S1C commerce projection and the ACCEPTED S1E orders, then the S1E
        // authority world. The same three calls, in the same order, as the accepted S1F
        // suites' own `beforeEach`.
        await loadCommerceFixture(client);
        await loadS1eOrders(client);
        const world = await loadAuthorityWorld(client);
        const incident = await client.query<{ incident_id: string }>(
          `INSERT INTO incident (company_id, incident_type, incident_path, severity, detail)
           VALUES ($1, 'AUDIT_MIRROR_DEGRADED', 'SECURITY', 'CRITICAL',
                   'S1I fixture: the open incident an override responds to (30 §5.7.2)')
           RETURNING incident_id`,
          [COMPANY_ID],
        );
        // The two fixture resources `campaign.pause` and `fulfilment.reship` enumerate
        // against. `commerce_order.resource_ref` is free-form and UNIQUE, so one row per
        // fixture resource is all the authoritative state those classes need — and
        // demoting `grade` away from RECORD is how a gap-mutation test makes an authorised
        // effect stale. See `fixtureEnumerator.ts`.
        await client.query(
          `INSERT INTO commerce_order
             (company_id, order_id, resource_ref, grade, currency, customer_novelty)
           VALUES ($1, $2, $3, 'RECORD', 'USD', 'RETURNING'),
                  ($1, $4, $5, 'RECORD', 'USD', 'RETURNING')
           ON CONFLICT (company_id, order_id) DO NOTHING`,
          [
            COMPANY_ID,
            PAUSE_RESOURCE_ID,
            `campaign:${PAUSE_RESOURCE_ID}`,
            RESHIP_RESOURCE_ID,
            `order:${RESHIP_RESOURCE_ID}`,
          ],
        );
        seed = {
          incidentRef: BigInt(incident.rows[0]!.incident_id),
          ownerSigner: world.ownerSigner,
        };
      } finally {
        client.release();
      }
      kernel = makeLocalAuthorityHarness(replication.control, {
        at: S1I_NOW,
        // `25 §14.1` (v1.3.5, SER-01) makes dispatch revalidation MANDATORY, and it
        // revalidates the ORIGINAL enumeration/option identity. `campaign.pause` and
        // `fulfilment.reship` have no production constructor, so the accepted fixtures
        // authorised them with no enumeration at all — half of C′ stood in for, and half
        // missing. `fixtureEnumerator.ts` supplies the missing half, TEST-ONLY, so those two
        // classes revalidate through the production `EffectEnumerator` exactly as a refund
        // does. Production's catalogue is untouched and still registers ONE constructor.
        constructors: [
          refundCreateConstructor,
          fixtureEnumerationConstructor('campaign.pause', PAUSE_CONSTRUCTOR_VERSION.constructorId),
          fixtureEnumerationConstructor(
            'fulfilment.reship',
            RESHIP_CONSTRUCTOR_VERSION.constructorId,
          ),
        ],
        records: [
          signConstructorVersion(signer, REFUND_VERSION_1_0),
          signConstructorVersion(signer, {
            constructorId: PAUSE_CONSTRUCTOR_VERSION.constructorId,
            actionClass: 'campaign.pause',
            semanticMajor: PAUSE_CONSTRUCTOR_VERSION.semanticMajor,
            nonSemanticMinor: PAUSE_CONSTRUCTOR_VERSION.nonSemanticMinor,
            changedFields: [],
            semanticChange: false,
            signedAt: PAUSE_CONSTRUCTOR_VERSION.signedAt,
          }),
          signConstructorVersion(signer, {
            constructorId: RESHIP_CONSTRUCTOR_VERSION.constructorId,
            actionClass: 'fulfilment.reship',
            semanticMajor: RESHIP_CONSTRUCTOR_VERSION.semanticMajor,
            nonSemanticMinor: RESHIP_CONSTRUCTOR_VERSION.nonSemanticMinor,
            changedFields: [],
            semanticChange: false,
            signedAt: RESHIP_CONSTRUCTOR_VERSION.signedAt,
          }),
        ],
        signer,
      });
    },
    async close() {
      await replication.close();
    },
  };
  return harness;
}

/** Register a SECOND OWNER-tier principal with a DISTINCT key. `30 §5.7.2` item 9. */
export const SECOND_OWNER_ID = 'principal:owner-second';

export async function registerSecondOwner(
  client: Client,
  signer: AuthoritySigner,
): Promise<void> {
  await client.query(
    `INSERT INTO principal (company_id, principal_id, kind, role, model_binding, status)
     VALUES ($1, $2, 'OWNER', 'owner-deputy', NULL, 'ACTIVE')`,
    [COMPANY_ID, SECOND_OWNER_ID],
  );
  await insertPrincipalKey(client, SECOND_OWNER_ID, signer);
}

// =====================================================================================
// AUTHORISED EFFECTS, AND THE PAYLOAD BYTES THAT BELONG TO EACH
// =====================================================================================

export interface AuthorisedEffect {
  readonly effectId: string;
  readonly authorisationId: string;
  readonly idempotencyKey: string;
  readonly actionClass: string;
  readonly recoverability: string;
  readonly dispatchPayloadHash: string;
  /**
   * The canonical bytes of the payload the authorisation bound.
   *
   * OBTAINED BY RE-RUNNING THE REGISTERED CONSTRUCTOR, which is precisely the
   * reconstruction `§27` permits: the enqueue accepts these bytes only because they hash
   * to the committed `dispatchPayloadHash`, and `payloadHashDiverges` below produces the
   * case where they do not.
   */
  readonly payloadCanonicalBytes: Buffer;
  readonly totalExposure: Money;
}

/**
 * Authorise one `refund.create` through the ACCEPTED S1F pipeline, then reconstruct its
 * dispatch payload.
 *
 * `refund.create` is COMPENSABLE (`26 §5`) and the S1E pass order's total exposure is
 * $10.00 — BELOW `51 §3.7`'s $20.00 degraded-mode approval floor — so with `clockBearing`
 * false at claim time it classifies at `30 §5.1` ROW 4 and SUSPENDS unless an in-scope
 * override restores it. That is the shape `§31` and `§32` of the mandate need.
 */
export async function authoriseRefund(
  h: OutboxHarness,
  options: { readonly authorisationRef?: string; readonly sessionId?: string } = {},
): Promise<AuthorisedEffect> {
  const authorisationRef = options.authorisationRef ?? `auth:AR-S1I-${randomUUID()}`;
  const outcome = await proposeAndAuthorise(
    h.kernel,
    { orderId: S1E_PASS_ORDER.orderId, resourceRef: S1E_PASS_ORDER.resourceRef },
    { authorisationRef, ...(options.sessionId === undefined ? {} : { sessionId: options.sessionId }) },
  );
  if (outcome.outcome !== 'LOCAL_AUTHORISATION_COMMITTED') {
    throw new Error(`the S1F pipeline did not commit: ${outcome.outcome}`);
  }

  const bytes = await reconstructRefundPayload(h, authorisationRef);
  const committed = await readAuthorisation(h.control, outcome.authorisationId);

  return {
    effectId: outcome.effectId,
    authorisationId: outcome.authorisationId,
    idempotencyKey: committed.idempotencyKey,
    actionClass: 'refund.create',
    recoverability: 'COMPENSABLE',
    dispatchPayloadHash: committed.dispatchPayloadHash,
    payloadCanonicalBytes: bytes,
    totalExposure: money(committed.totalExposure),
  };
}

/**
 * Re-run C′ for the S1E pass order and return the payload's canonical bytes.
 *
 * The SAME `authorisationRef` is passed, because `26 §2.1` puts `authorisation_ref` in the
 * `dispatch_payload` — a different reference is a different payload and a different hash,
 * which is exactly the drift the enqueue's hash check exists to catch.
 */
export async function reconstructRefundPayload(
  h: OutboxHarness,
  authorisationRef: string,
): Promise<Buffer> {
  const key = entityKeyFor(S1E_PASS_ORDER.orderId);
  const spec = s1eSpec();
  const read = await h.kernel.leases.withEntityLease(key, async (lease) => {
    const enumerated = await h.kernel.enumerator.enumerate(lease, {
      actionClass: 'refund.create',
      resourceRef: S1E_PASS_ORDER.resourceRef,
      spec,
    });
    return {
      enumerationId: enumerated.set.enumerationId,
      optionId: enumerated.set.options[0]?.optionId ?? '',
    };
  });
  const intent = parseProposedIntent(
    rawIntent({
      resourceRef: S1E_PASS_ORDER.resourceRef,
      enumerationId: read.enumerationId,
      optionId: read.optionId,
    }),
  );
  return h.kernel.leases.withEntityLease(key, async (lease) => {
    // `kernelContext` is the ACCEPTED S1C kernel-supplied context. Only `authorisationRef`
    // reaches the DISPATCH PAYLOAD (`26 §2.1`); `principal`, `grantWindows` and
    // `contextDigest` reach the `AuthorizationRequest` and not the payload, so the
    // reconstruction is byte-identical to the pipeline's for the same order and reference.
    const effect = await h.kernel.liveSelector.canonicaliseUnderLease(
      lease,
      intent,
      spec,
      kernelContext({ authorisationRef }),
    );
    return dispatchPayloadCanonicalBytes(effect.dispatchPayload);
  });
}

// =====================================================================================
// THE REVERSIBLE CLA§ — `30 §5.1` ROW 5
// =====================================================================================

/**
 * `campaign.pause`: REVERSIBLE, zero exposure, and the ONLY class in `37` S1's closed
 * catalogue that reaches `DISPATCH_ELIGIBLE` with no override.
 *
 * `26 §5`: "campaign.pause | REVERSIBLE". `26 §11.2` row 6: "Out of scope — zero exposure,
 * REVERSIBLE", `value_direction` NONE.
 *
 * ---------------------------------------------------------------------------------
 * WHY IT USES THE DIRECT COMMIT PATH AND NOT C′.
 *
 * The ACCEPTED constructor registry holds ONE constructor — `refundCreate` — and `26 §7`
 * step C2 denies `NOT_CANONICALISABLE` for a class with none. Building a `campaign.pause`
 * constructor is per-class canonicaliser work and is not S1I's mandate.
 *
 * This is the SAME boundary the accepted S1F fixture drew for the rate class, in its own
 * words: "What S1F therefore proves for the rate branch is the property S1F is about [...]
 * It does not prove that a rate class traverses C′, and the S1F result says so."
 * `S1I-result.md §6` says so for this class.
 *
 * The payload IS a real `DispatchPayload` canonicalised by the production
 * `dispatchPayloadCanonicalBytes`, and the hash on the authorisation row IS its digest — so
 * the payload↔hash binding S1I is about is exercised for real, which is what matters here.
 * ---------------------------------------------------------------------------------
 */
export const PAUSE_RESOURCE_REF = 'campaign:CMP-S1I-PAUSE';
export const PAUSE_RESOURCE_ID = 'CMP-S1I-PAUSE';

export const PAUSE_CONSTRUCTOR_VERSION = Object.freeze({
  constructorId: 'constructor:campaign.pause:fixture',
  actionClass: 'campaign.pause' as const,
  semanticMajor: 1,
  nonSemanticMinor: 0,
  semanticChange: false,
  changedFields: [] as const,
  signedAt: new Date('2026-01-01T00:00:00.000Z'),
  recordHash: 'fixture:pause-constructor-record-hash',
});

/** `51 §2`'s monthly ungated count window. `campaign.pause` moves no money. */
export const PAUSE_WINDOWS: readonly string[] = ['W_MONTH_UNGATED'];

interface PausePayloadInput {
  readonly authorisationRef: string;
  readonly idempotencyKey: string;
  readonly resourceId: string;
}

/**
 * The kernel-computed `campaign.pause` dispatch payload, hand-authored field by field.
 *
 * Hand-authored because there is no constructor for this class; every field is a value a
 * constructor WOULD compute, and none is model-supplied. It is canonicalised by the
 * production `dispatchPayloadCanonicalBytes`, so the bytes and the hash are the real thing.
 */
export function pauseDispatchPayloadBytes(input: PausePayloadInput): Buffer {
  return dispatchPayloadCanonicalBytes({
    adapter: 'mock_ads' as never,
    method: 'campaignPause' as never,
    vendorParameters: Object.freeze({ campaign_id: input.resourceId }) as never,
    idempotencyKey: input.idempotencyKey as never,
    // `26 §11.2` row 6 / `I18a`'s null branch: this class's vendor request carries no
    // monetary field at all, so `monetary_effect` IS NULL.
    monetaryEffect: null,
    preconditionToken: null,
    authorisationRef: input.authorisationRef as never,
  });
}

/**
 * Enumerate one fixture class for real, and return the identity `25 §14.1` revalidates.
 *
 * =================================================================================
 * WHY THE FIXTURE ENUMERATES INSTEAD OF WRITING AN `enumeration_record` BY HAND
 *
 * A hand-written row could carry any `option_id`, including one the live enumeration would
 * never produce — and then the dispatch-time revalidation would fail for every effect, or
 * (worse) a test could make it pass by writing whatever the enumerator happens to compute.
 * Either way the check under test would be testing the fixture.
 *
 * So this runs the PRODUCTION `EffectEnumerator` under a REAL entity lease, against the
 * fixture's `commerce_order` row, through `fixtureEnumerator.ts`'s registered constructor.
 * The `option_id` is content-addressed by `26 §2.2`'s own rule and the `enumeration_id` by
 * `computeEnumerationId`, exactly as they are for a refund. The record it writes is the
 * record the dispatch path later looks up.
 *
 * THE SPEC IS THE ONE THE RECORD PERSISTS. `admittedResourceRefs` carries this resource and
 * nothing else, so a later re-enumeration cannot widen its own scope — which is the property
 * `contextSpec.ts`'s serialisation header exists to protect.
 * =================================================================================
 */
async function enumerateFixtureIdentity(
  h: OutboxHarness,
  actionClass: 'campaign.pause' | 'fulfilment.reship',
  resourceRef: string,
  entityType: string,
  entityId: string,
  taskId: string,
): Promise<{ readonly enumerationId: string; readonly optionId: string }> {
  // The fixture resource this class enumerates against, materialised on demand.
  //
  // Tests name their own resource ids so each scenario is a DISTINCT semantic effect, so the
  // row cannot be seeded once in `reset()`. `ON CONFLICT DO NOTHING` makes it idempotent, and
  // it is written OUTSIDE the lease for the reason the accepted `ledger.ts` gives about
  // `ensureWindowInstance`: materialisation is not an authority read.
  const seedClient = await h.control.connect();
  try {
    await seedClient.query(
      `INSERT INTO commerce_order
         (company_id, order_id, resource_ref, grade, currency, customer_novelty)
       VALUES ($1, $2, $3, 'RECORD', 'USD', 'RETURNING')
       ON CONFLICT (company_id, order_id) DO NOTHING`,
      [COMPANY_ID, entityId, resourceRef],
    );
  } finally {
    seedClient.release();
  }

  return h.kernel.leases.withEntityLease(
    { companyId: COMPANY_ID, entityType, entityId },
    async (lease) => {
      const outcome = await h.kernel.enumerator.enumerate(lease, {
        actionClass,
        resourceRef,
        spec: {
          companyId: COMPANY_ID,
          taskId,
          principalId: 'principal:support_reasoner:1',
          admittedResourceRefs: new Set([resourceRef]),
          admittedDescriptionFields: {},
          reasonCodeScope: 'GOODS_FAULT',
        },
      });
      const optionId = outcome.set.options[0]?.optionId;
      if (optionId === undefined) {
        throw new Error(
          `the fixture enumerator returned no option for ${resourceRef}; 25 §14.1 needs an ` +
            'enumeration/option identity for the dispatch path to revalidate against',
        );
      }
      return { enumerationId: outcome.set.enumerationId, optionId };
    },
  );
}

export function pauseFacts(input: {
  readonly authorisationRef: string;
  readonly resourceId?: string;
  readonly dispatchPayloadHash: string;
  readonly idempotencyKey: string;
  /** `25 §14.1`'s revalidation identity, from a REAL enumeration. */
  readonly enumerationId: string;
  readonly optionId: string;
}): LocalAuthorisationRequestFacts {
  return {
    companyId: COMPANY_ID,
    sessionId: 'session:S1I-kernel',
    taskId: 'task:T-S1I-pause',
    principalId: 'principal:support_reasoner:1',
    authorisationRef: input.authorisationRef,
    actionClass: 'campaign.pause',
    resourceRef: `campaign:${input.resourceId ?? PAUSE_RESOURCE_ID}`,
    resourceId: input.resourceId ?? PAUSE_RESOURCE_ID,
    dispatchPayloadHash: input.dispatchPayloadHash,
    intentHash: 'fixture:pause-intent-hash',
    contextDigest: 'fixture:pause-context-digest',
    constructorVersion: PAUSE_CONSTRUCTOR_VERSION,
    policyVersion: 'fixture:policy-version',
    exposure: {
      // `26 §11.2` row 6: zero exposure, no vendor monetary field.
      vendorAmount: null,
      totalExposure: money('0.00'),
      // A non-rate class carries NO forward integral (`26 §2.1`, and
      // `commitLocalAuthorisation` throws on one).
      forwardIntegral: null,
    },
    recoverability: 'REVERSIBLE',
    valueDirection: 'NONE',
    adapter: 'mock_ads',
    idempotencyKey: input.idempotencyKey,
    windowRefs: [...PAUSE_WINDOWS],
    approvalRequirement: 'NONE',
    autonomyLevel: 'L3',
    gateClass: 'UNGATED_LOGGED',
    countUnits: 1n,
    // `25 §14.1`'s revalidation identity, from the enumeration this fixture actually ran.
    enumerationId: input.enumerationId,
    optionId: input.optionId,
  };
}

/**
 * Authorise one `campaign.pause` and return it with its payload bytes.
 *
 * `§7` of the mandate wants two DISTINCT effects. `resourceId` and `taskSuffix` make each
 * call a different semantic effect identity, so the second is genuinely a second intent
 * rather than a duplicate of the first.
 */
export async function authorisePause(
  h: OutboxHarness,
  options: { readonly resourceId?: string; readonly authorisationRef?: string } = {},
): Promise<AuthorisedEffect> {
  const resourceId = options.resourceId ?? PAUSE_RESOURCE_ID;
  const authorisationRef = options.authorisationRef ?? `auth:AR-S1I-PAUSE-${randomUUID()}`;
  const idempotencyKey = `idem:campaign.pause:${resourceId}:${authorisationRef}`;
  const bytes = pauseDispatchPayloadBytes({ authorisationRef, idempotencyKey, resourceId });
  const dispatchPayloadHash = sha256Hex(bytes);

  // `25 §14.1`. The enumeration this effect is authorised against, taken for real before
  // the authorisation and looked up again at dispatch time by the revalidation.
  const identity = await enumerateFixtureIdentity(
    h,
    'campaign.pause',
    `campaign:${resourceId}`,
    'campaign',
    resourceId,
    'task:T-S1I-pause',
  );
  const facts = pauseFacts({
    authorisationRef,
    resourceId,
    dispatchPayloadHash,
    idempotencyKey,
    ...identity,
  });
  const outcome = await h.kernel.leases.withEntityLease(
    { companyId: COMPANY_ID, entityType: 'campaign', entityId: resourceId },
    (lease) =>
      commitLocalAuthorisation(lease, { kind: 'ORDINARY', facts }, h.kernel.commitOptions()),
  );
  if (outcome.outcome !== 'LOCAL_AUTHORISATION_COMMITTED') {
    throw new Error(`campaign.pause did not commit: ${outcome.outcome}`);
  }

  return {
    effectId: outcome.effectId,
    authorisationId: outcome.authorisationId,
    idempotencyKey,
    actionClass: 'campaign.pause',
    recoverability: 'REVERSIBLE',
    dispatchPayloadHash,
    payloadCanonicalBytes: bytes,
    totalExposure: money('0.00'),
  };
}

// =====================================================================================
// THE IRRECOVERABLE CLA§ — `30 §5.1` ROW 1
// =====================================================================================

/**
 * `fulfilment.reship`: IRRECOVERABLE and discretionary (`26 §5`).
 *
 * ---------------------------------------------------------------------------------
 * WHY THIS CLA§ CAN NEVER BE CLAIMED, AND WHY THE FIXTURE BUILDS IT ANYWAY.
 *
 * `30 §5.1` item 4 row 1: "`recoverability == IRRECOVERABLE` | **Halt.** No send, no
 * reship, no public post, no address edit." `22 §3.1`'s state table prints row 1 as
 * **Halt / Halt / Halt** across `NORMAL`, `UNCORROBORATED_STALL` and
 * `CORROBORATED_DEGRADED`, and item 5 makes it unreachable by override: "An override
 * restores precedence rows 3 and 4 only, never rows 1 or 2." `51 §3.6` makes
 * `recoverability_classes[] subset of {COMPENSABLE, REVERSIBLE}` a DATABASE CHECK.
 *
 * So under v1.3.3 as issued, an IRRECOVERABLE effect is NEVER dispatch-eligible - in any
 * mirror state, with or without an owner override. `§15` of the mandate requires the claim
 * to be tested for "all current recoverability classes", and this is the class whose
 * answer is always no. `outbox-claim-eligibility.test.ts` asserts it in all three states
 * and under a valid override, and `S1I-result.md §9` records the consequence: the class
 * the outbox exists for (ADR-026 is titled "Irrecoverable dispatch goes through an
 * ACOS-owned outbox") cannot reach a claim at all at S1 scope.
 *
 * `total_exposure` IS `0.00`, and that is `26 §5`'s own accounting: "Count remains the
 * **gating** control; `MIE_cost` - an `[ESTIMATE]`-graded sum of class unit costs - enters
 * the **disclosed** ceiling." A reship's COGS and freight are a disclosed estimate, not a
 * reservation, so the exposure block declares no monetary amount and `I18a`'s null branch
 * applies exactly as it does for the rate class.
 * ---------------------------------------------------------------------------------
 */
export const RESHIP_RESOURCE_ID = 'ORD-S1I-RESHIP';

export const RESHIP_CONSTRUCTOR_VERSION = Object.freeze({
  constructorId: 'constructor:fulfilment.reship:fixture',
  actionClass: 'fulfilment.reship' as const,
  semanticMajor: 1,
  nonSemanticMinor: 0,
  semanticChange: false,
  changedFields: [] as const,
  signedAt: new Date('2026-01-01T00:00:00.000Z'),
  recordHash: 'fixture:reship-constructor-record-hash',
});

/** `51 §2`'s MIE windows: monetary UNBOUNDED, count bounded, irrecoverable bounded. */
export const RESHIP_WINDOWS: readonly string[] = ['W_DAY_MIE', 'W_MONTH_MIE'];

export function reshipDispatchPayloadBytes(input: {
  readonly authorisationRef: string;
  readonly idempotencyKey: string;
  readonly resourceId: string;
}): Buffer {
  return dispatchPayloadCanonicalBytes({
    adapter: 'mock_commerce' as never,
    method: 'fulfilmentReship' as never,
    vendorParameters: Object.freeze({ order_id: input.resourceId }) as never,
    idempotencyKey: input.idempotencyKey as never,
    // `26 §2.1.1` names this class as the one whose vendor request "contains no money
    // field at all", which is `I18a`'s null branch.
    monetaryEffect: null,
    preconditionToken: null,
    authorisationRef: input.authorisationRef as never,
  });
}

export async function authoriseReship(
  h: OutboxHarness,
  options: { readonly resourceId?: string; readonly taskId?: string } = {},
): Promise<AuthorisedEffect> {
  const resourceId = options.resourceId ?? RESHIP_RESOURCE_ID;
  const authorisationRef = `auth:AR-S1I-RESHIP-${randomUUID()}`;
  const idempotencyKey = `idem:fulfilment.reship:${resourceId}:${authorisationRef}`;
  const bytes = reshipDispatchPayloadBytes({ authorisationRef, idempotencyKey, resourceId });
  const dispatchPayloadHash = sha256Hex(bytes);

  // `25 §14.1`. THE IRRECOVERABLE CLASS'S OWN ENUMERATION. This is the identity
  // `dispatch-gap-revalidation.test.ts` invalidates by demoting the resource's grade, and
  // the one every `PRESUMED_EXECUTED` scenario revalidates before it can claim.
  const reshipIdentity = await enumerateFixtureIdentity(
    h,
    'fulfilment.reship',
    `order:${resourceId}`,
    'order',
    resourceId,
    options.taskId ?? 'task:T-S1I-reship',
  );

  const facts: LocalAuthorisationRequestFacts = {
    companyId: COMPANY_ID,
    sessionId: 'session:S1I-kernel',
    taskId: options.taskId ?? 'task:T-S1I-reship',
    principalId: 'principal:support_reasoner:1',
    authorisationRef,
    actionClass: 'fulfilment.reship',
    resourceRef: `order:${resourceId}`,
    resourceId,
    dispatchPayloadHash,
    intentHash: 'fixture:reship-intent-hash',
    contextDigest: 'fixture:reship-context-digest',
    constructorVersion: RESHIP_CONSTRUCTOR_VERSION,
    policyVersion: 'fixture:policy-version',
    exposure: { vendorAmount: null, totalExposure: money('0.00'), forwardIntegral: null },
    recoverability: 'IRRECOVERABLE',
    valueDirection: 'OUTBOUND_GOODS_TO_ADDRESS',
    adapter: 'mock_commerce',
    idempotencyKey,
    windowRefs: [...RESHIP_WINDOWS],
    approvalRequirement: 'NONE',
    autonomyLevel: 'L3',
    gateClass: 'UNGATED_LOGGED',
    countUnits: 1n,
    enumerationId: reshipIdentity.enumerationId,
    optionId: reshipIdentity.optionId,
  };

  const outcome = await h.kernel.leases.withEntityLease(
    { companyId: COMPANY_ID, entityType: 'order', entityId: resourceId },
    (lease) =>
      commitLocalAuthorisation(lease, { kind: 'ORDINARY', facts }, h.kernel.commitOptions()),
  );
  if (outcome.outcome !== 'LOCAL_AUTHORISATION_COMMITTED') {
    throw new Error(`fulfilment.reship did not commit: ${outcome.outcome}`);
  }

  return {
    effectId: outcome.effectId,
    authorisationId: outcome.authorisationId,
    idempotencyKey,
    actionClass: 'fulfilment.reship',
    recoverability: 'IRRECOVERABLE',
    dispatchPayloadHash,
    payloadCanonicalBytes: bytes,
    totalExposure: money('0.00'),
  };
}

// =====================================================================================
// AN ABOVE-FLOOR COMPENSABLE EFFECT — `30 §5.1` ROW 2
// =====================================================================================

const ABOVE_FLOOR_CONSTRUCTOR_VERSION = Object.freeze({
  constructorId: 'constructor:refund.create:above-floor-fixture',
  actionClass: 'refund.create' as const,
  semanticMajor: 1,
  nonSemanticMinor: 0,
  semanticChange: false,
  changedFields: [] as const,
  signedAt: new Date('2026-01-01T00:00:00.000Z'),
  recordHash: 'fixture:above-floor-constructor-record-hash',
});

/**
 * A COMPENSABLE `refund.create` effect at a CHOSEN `total_exposure`.
 *
 * `30 §5.1a`'s reachable band is `$20.01 ... $25.00`, and `§15` of the mandate needs row
 * 2 to be reachable so its HALT can be asserted. The S1E pass order's exposure is $10.00,
 * so the band needs its own effect, and the direct-commit path is how a fixture reaches it:
 * `refund.create`'s constructor computes exposure from live order state and a fixture may
 * not invent an economic rule in order to move it (S1B-C3a).
 *
 * The caller passes the amount so the test can choose `$20.00` (NOT above - the comparison
 * is strict) and `$20.01` (above) and assert the boundary rather than one side of it.
 */
export async function authoriseRefundAtExposure(
  h: OutboxHarness,
  totalExposure: string,
): Promise<AuthorisedEffect> {
  const resourceId = `ORD-S1I-FLOOR-${randomUUID().slice(0, 8)}`;
  const authorisationRef = `auth:AR-S1I-FLOOR-${randomUUID()}`;
  const idempotencyKey = `idem:refund.create:${resourceId}:${authorisationRef}`;
  const bytes = dispatchPayloadCanonicalBytes({
    adapter: 'mock_processor' as never,
    method: 'refundCreate' as never,
    vendorParameters: Object.freeze({
      parent_transaction_id: `txn:${resourceId}`,
      line_id: `line:${resourceId}:1`,
      amount: totalExposure,
      currency: 'USD',
      instrument: 'original',
    }) as never,
    idempotencyKey: idempotencyKey as never,
    monetaryEffect: money(totalExposure) as never,
    preconditionToken: null,
    authorisationRef: authorisationRef as never,
  });
  const dispatchPayloadHash = sha256Hex(bytes);

  const facts: LocalAuthorisationRequestFacts = {
    companyId: COMPANY_ID,
    sessionId: 'session:S1I-kernel',
    taskId: 'task:T-S1I-above-floor',
    principalId: 'principal:support_reasoner:1',
    authorisationRef,
    actionClass: 'refund.create',
    resourceRef: `order:${resourceId}`,
    resourceId,
    dispatchPayloadHash,
    intentHash: 'fixture:above-floor-intent-hash',
    contextDigest: 'fixture:above-floor-context-digest',
    constructorVersion: ABOVE_FLOOR_CONSTRUCTOR_VERSION,
    policyVersion: 'fixture:policy-version',
    exposure: {
      vendorAmount: money(totalExposure),
      totalExposure: money(totalExposure),
      forwardIntegral: null,
    },
    recoverability: 'COMPENSABLE',
    valueDirection: 'INBOUND_ORIGINAL_INSTRUMENT',
    adapter: 'mock_processor',
    idempotencyKey,
    windowRefs: ['W_DAY_REFUND', 'W_MONTH_REFUND'],
    approvalRequirement: 'NONE',
    autonomyLevel: 'L3',
    gateClass: 'UNGATED_LOGGED',
    countUnits: 1n,
    // `25 §14.1`. NULL, and deliberately: this fixture exists for `30 §5.1` item 4's
    // APPROVAL-FLOOR row and its effect is never dispatched, only claim-evaluated. An
    // effect with no revalidation identity is refused at the dispatch boundary, which is
    // the correct answer for one that has no enumeration behind it.
    enumerationId: null,
    optionId: null,
  };

  const outcome = await h.kernel.leases.withEntityLease(
    { companyId: COMPANY_ID, entityType: 'order', entityId: resourceId },
    (lease) =>
      commitLocalAuthorisation(lease, { kind: 'ORDINARY', facts }, h.kernel.commitOptions()),
  );
  if (outcome.outcome !== 'LOCAL_AUTHORISATION_COMMITTED') {
    throw new Error(`the above-floor refund did not commit: ${outcome.outcome}`);
  }
  return {
    effectId: outcome.effectId,
    authorisationId: outcome.authorisationId,
    idempotencyKey,
    actionClass: 'refund.create',
    recoverability: 'COMPENSABLE',
    dispatchPayloadHash,
    payloadCanonicalBytes: bytes,
    totalExposure: money(totalExposure),
  };
}

// =====================================================================================
// DIRECT SQL. Every S1I assertion about committed state comes through here.
// =====================================================================================

export interface AuthorisationSnapshot {
  readonly idempotencyKey: string;
  readonly dispatchPayloadHash: string;
  readonly totalExposure: string;
}

export async function readAuthorisation(
  control: Pool,
  authorisationId: string,
): Promise<AuthorisationSnapshot> {
  const client = await control.connect();
  try {
    const result = await client.query<{
      idempotency_key: string;
      dispatch_payload_hash: string;
      total_exposure: string;
    }>(
      `SELECT e.idempotency_key, a.dispatch_payload_hash, a.total_exposure
         FROM authorisation a
         JOIN effect e ON e.authorisation_id = a.authorisation_id
        WHERE a.authorisation_id = $1`,
      [authorisationId],
    );
    const row = result.rows[0];
    if (row === undefined) throw new Error(`no authorisation ${authorisationId}`);
    return {
      idempotencyKey: row.idempotency_key,
      dispatchPayloadHash: row.dispatch_payload_hash,
      totalExposure: row.total_exposure,
    };
  } finally {
    client.release();
  }
}

/** Every outbox row for the company, read with raw SQL on a fresh connection. */
export async function outboxRows(control: Pool): Promise<readonly OutboxRow[]> {
  const client = await control.connect();
  try {
    const result = await client.query<OutboxDbRow>(
      `SELECT ${OUTBOX_COLUMNS} FROM dispatch_outbox
        WHERE company_id = $1 ORDER BY enqueued_at, outbox_id`,
      [COMPANY_ID],
    );
    return result.rows.map(toOutboxRow);
  } finally {
    client.release();
  }
}

export async function outboxRowCount(control: Pool): Promise<number> {
  const client = await control.connect();
  try {
    const result = await client.query<{ n: string }>(
      `SELECT count(*)::TEXT AS n FROM dispatch_outbox WHERE company_id = $1`,
      [COMPANY_ID],
    );
    return Number(result.rows[0]!.n);
  } finally {
    client.release();
  }
}

/**
 * The economic state `§28` and `§29` require to be unchanged by enqueue and by claim.
 *
 * READ AS ONE SNAPSHOT so a before/after comparison is a single `toEqual`. Every quantity
 * is a string at the column's declared scale — `30 §5.3`: "25.0 and 25.00 are different
 * bytes, deliberately" — and none is converted to a JavaScript number anywhere.
 */
export interface EconomicSnapshot {
  readonly reservations: readonly Record<string, string | null>[];
  readonly balances: readonly Record<string, string>[];
  readonly standing: readonly Record<string, string>[];
  readonly authorisations: readonly Record<string, string | null>[];
  readonly decisions: readonly Record<string, string>[];
  readonly effects: readonly Record<string, string>[];
}

export async function economicSnapshot(control: Pool): Promise<EconomicSnapshot> {
  const client = await control.connect();
  try {
    const q = async <T extends Record<string, unknown>>(sql: string): Promise<readonly T[]> =>
      (await client.query<T>(sql, [COMPANY_ID])).rows;
    return {
      reservations: (await q(
        `SELECT reservation_id, authorisation_id, action_class, amount::TEXT,
                vendor_amount::TEXT, forward_integral::TEXT, is_rate_class::TEXT
           FROM exposure_reservation WHERE company_id = $1
          ORDER BY reservation_id`,
      )) as readonly Record<string, string | null>[],
      balances: (await q(
        `SELECT window_id, window_instance_key, reserved_monetary::TEXT,
                standing_monetary::TEXT, presumed_monetary::TEXT, realised_monetary::TEXT,
                reserved_count::TEXT, standing_count::TEXT, presumed_count::TEXT,
                realised_count::TEXT, reserved_irrecoverable::TEXT,
                presumed_irrecoverable::TEXT, realised_irrecoverable::TEXT
           FROM window_balance WHERE company_id = $1
          ORDER BY window_id, window_instance_key`,
      )) as readonly Record<string, string>[],
      standing: (await q(
        `SELECT standing_authorization_id, window_id, window_instance_key,
                standing_cap_monetary::TEXT, realised_monetary::TEXT,
                forward_monetary::TEXT, instance_in_scope::TEXT
           FROM standing_window_exposure WHERE company_id = $1
          ORDER BY standing_authorization_id, window_id, window_instance_key`,
      )) as readonly Record<string, string>[],
      authorisations: (await q(
        `SELECT authorisation_id, total_exposure::TEXT, vendor_amount::TEXT,
                forward_integral::TEXT, recoverability, gate_class
           FROM authorisation WHERE company_id = $1 ORDER BY authorisation_id`,
      )) as readonly Record<string, string | null>[],
      decisions: (await q(
        `SELECT decision_id, verdict FROM authorisation_decision
          WHERE company_id = $1 ORDER BY decision_id`,
      )) as readonly Record<string, string>[],
      effects: (await q(
        `SELECT effect_id, status, recoverability FROM effect
          WHERE company_id = $1 ORDER BY effect_id`,
      )) as readonly Record<string, string>[],
    };
  } finally {
    client.release();
  }
}

/** Mutate the order line's refundable remaining. `§10`'s "mutate underlying source state". */
export async function mutateOrderLineRemaining(
  control: Pool,
  newRemaining: string,
): Promise<void> {
  const client = await control.connect();
  try {
    await client.query(
      `UPDATE commerce_order_line SET refundable_remaining = $3::NUMERIC
        WHERE company_id = $1 AND line_id = $2`,
      [COMPANY_ID, S1E_PASS_ORDER.lineId, newRemaining],
    );
    await client.query(
      `UPDATE commerce_parent_transaction SET refundable_remaining = $3::NUMERIC
        WHERE company_id = $1 AND parent_transaction_id = $2`,
      [COMPANY_ID, S1E_PASS_ORDER.parentTransactionId, newRemaining],
    );
  } finally {
    client.release();
  }
}

/** Every `OUTBOX_CLAIMED` journal row, read with raw SQL. */
export interface ClaimJournalRow {
  readonly journalSeq: bigint;
  readonly outboxId: string;
  readonly claimId: string;
  readonly correlationTag: string;
  readonly effectId: string;
  readonly authorisationId: string;
  readonly idempotencyKey: string;
  readonly actionClass: string;
  readonly resourceRef: string;
  readonly dispatchPayloadHash: string;
  readonly matchedRow: number;
  readonly mirrorState: string;
  readonly requiresUnmirroredTag: boolean;
  readonly overrideId: string | null;
  /** `30 §5.3a` field 18, v1.3.4 (CSB-01). */
  readonly claimClockRef: string | null;
  readonly occurredAt: Date;
  readonly prevHash: Buffer | null;
  readonly rowHash: Buffer;
}

export async function claimJournalRows(control: Pool): Promise<readonly ClaimJournalRow[]> {
  const client = await control.connect();
  try {
    const result = await client.query<Record<string, unknown>>(
      `SELECT journal_seq, outbox_id, outbox_claim_id, outbox_correlation_tag, effect_id,
              authorisation_id, idempotency_key, action_class, resource_ref,
              dispatch_payload_hash, outbox_matched_row, outbox_mirror_state,
              outbox_requires_unmirrored_tag, override_id, outbox_claim_clock_ref,
              occurred_at, prev_hash, row_hash
         FROM effect_journal
        WHERE company_id = $1 AND journal_row_kind = 'OUTBOX_CLAIMED'
        ORDER BY journal_seq`,
      [COMPANY_ID],
    );
    return result.rows.map((r) => ({
      journalSeq: BigInt(r['journal_seq'] as string),
      outboxId: r['outbox_id'] as string,
      claimId: r['outbox_claim_id'] as string,
      correlationTag: r['outbox_correlation_tag'] as string,
      effectId: r['effect_id'] as string,
      authorisationId: r['authorisation_id'] as string,
      idempotencyKey: r['idempotency_key'] as string,
      actionClass: r['action_class'] as string,
      resourceRef: r['resource_ref'] as string,
      dispatchPayloadHash: r['dispatch_payload_hash'] as string,
      matchedRow: r['outbox_matched_row'] as number,
      mirrorState: r['outbox_mirror_state'] as string,
      requiresUnmirroredTag: r['outbox_requires_unmirrored_tag'] as boolean,
      overrideId: r['override_id'] as string | null,
      claimClockRef: r['outbox_claim_clock_ref'] as string | null,
      occurredAt: r['occurred_at'] as Date,
      prevHash: r['prev_hash'] as Buffer | null,
      rowHash: r['row_hash'] as Buffer,
    }));
  } finally {
    client.release();
  }
}

// =====================================================================================
// THE EFFECT→CASE BINDING AND ITS CLOCKS — v1.3.4 (CSB-01), `30 §9.2`
// =====================================================================================

/**
 * `24 §3` K7's task-level case binding, seeded.
 *
 * =================================================================================
 * THIS IS THE ONLY WAY A CASE ENTERS THE SYSTEM IN THESE SUITES, AND THAT IS THE POINT.
 *
 * `30 §9.2.1`: "For a case-associated effect, `case_ref` is inherited from the
 * authoritative originating task [...] It MUST NOT come from any of: `ProposedIntent`;
 * `rationale`; the dispatch payload; a free-text reason; a model classification; a
 * caller-supplied claim-time argument; inference from a customer identifier; inference
 * from a similar order; or an arbitrary resource lookup selected at claim time."
 *
 * So the fixture writes `authority_task.case_ref` — kernel state, `24 §3` K7 — and then
 * runs the ORDINARY accepted S1F pipeline. Nothing in `authoriseRefund`,
 * `authorisePause`, `authoriseReship` or `commitLocalAuthorisation` takes a case, and
 * `0011`'s `effect_derive_case_ref` trigger is what puts it on the effect.
 *
 * A fixture that wrote `effect.case_ref` directly would be proving that an INSERT works.
 * `effect-case-binding.test.ts` does exactly that ONCE, as an attack, and asserts the
 * trigger discards the supplied value.
 * =================================================================================
 *
 * `24 §3` K7's own listed sources are "an ingress case, an escalation, a
 * `RemedyObligation`'s preserved lineage". None of those three subsystems exists at S1 —
 * `37` S2 builds ingress and `26 §12`'s resume is unbuilt — so at S1I these are SEEDED,
 * exactly as `retainSourceRecord`'s RECORD artifacts are seeded for `I56`.
 */
export async function bindTaskToCase(
  control: Pool,
  taskId: string,
  caseRef: string | null,
): Promise<void> {
  const client = await control.connect();
  try {
    const updated = await client.query(
      `UPDATE authority_task SET case_ref = $3
        WHERE company_id = $1 AND task_id = $2`,
      [COMPANY_ID, taskId, caseRef],
    );
    if (updated.rowCount !== 1) {
      throw new Error(
        `no authority_task ${taskId} for ${COMPANY_ID}; seed the task before binding a case`,
      );
    }
  } finally {
    client.release();
  }
}

/**
 * The `authority_task` the ACCEPTED S1F refund pipeline runs under.
 *
 * `authorityFixture.ts` seeds exactly one task and `proposeAndAuthorise` uses it, so this
 * is the task whose `case_ref` a refund effect inherits. Re-exported by name rather than
 * duplicated, so a fixture change moves both.
 */
export { TASK_ID as REFUND_TASK_ID } from './enumerationFixture.js';

/** Read the committed `effect.case_ref` with raw SQL. Never through `src/`. */
export async function effectCaseRef(
  control: Pool,
  effectId: string,
): Promise<string | null> {
  const client = await control.connect();
  try {
    const result = await client.query<{ case_ref: string | null }>(
      `SELECT case_ref FROM effect WHERE company_id = $1 AND effect_id = $2`,
      [COMPANY_ID, effectId],
    );
    if (result.rows[0] === undefined) throw new Error(`no effect ${effectId}`);
    return result.rows[0].case_ref;
  } finally {
    client.release();
  }
}

/** Read the committed `dispatch_outbox.claim_clock_ref` with raw SQL. */
export async function claimClockRefOf(
  control: Pool,
  idempotencyKey: string,
): Promise<string | null> {
  const client = await control.connect();
  try {
    const result = await client.query<{ claim_clock_ref: string | null }>(
      `SELECT claim_clock_ref FROM dispatch_outbox
        WHERE company_id = $1 AND idempotency_key = $2`,
      [COMPANY_ID, idempotencyKey],
    );
    if (result.rows[0] === undefined) throw new Error(`no outbox row for ${idempotencyKey}`);
    return result.rows[0].claim_clock_ref;
  } finally {
    client.release();
  }
}

/**
 * Open a live statutory clock on a case, through the ACCEPTED `I56` path.
 *
 * `createStatutoryClock` is production and takes a `sourceRecordId` that must resolve to a
 * retained RECORD-grade artifact — `I56`: "A model classification can route a case; it can
 * never create a clock." This helper retains the artifact and then creates the clock, so
 * every clock in these suites has real provenance and none is inserted directly.
 */
export async function openLiveClock(
  control: Pool,
  input: {
    readonly caseRef: string;
    readonly clockId: string;
    readonly deadlineAt: Date;
    readonly statute?: Statute;
    readonly startedAt?: Date;
  },
): Promise<void> {
  const sourceRecordId = `record:${input.clockId}`;
  await retainSourceRecord(control, {
    companyId: COMPANY_ID,
    sourceRecordId,
    kind: 'PROCESSOR_DISPUTE_WEBHOOK',
    contentHash: createHash('sha256').update(input.clockId).digest(),
    externalRef: `external:${input.clockId}`,
    receivedAt: input.startedAt ?? S1I_NOW,
  });
  await createStatutoryClock(control, {
    companyId: COMPANY_ID,
    clockId: input.clockId,
    statute: input.statute ?? 'FTC_7_WORKING_DAYS',
    caseRef: input.caseRef,
    startedAt: input.startedAt ?? S1I_NOW,
    deadlineAt: input.deadlineAt,
    sourceRecordId,
  });
}

/**
 * Close a live clock. `30 §9.2.4`: "a clock that closes, expires, or whose citation ceases
 * to resolve, between enqueue and the decision makes row 3 stop applying."
 *
 * `statutory_clock` is not append-only — `0009` installs no such trigger on it, because a
 * clock's whole purpose is to close — so this is an ordinary UPDATE and not an attack.
 */
export async function closeClock(control: Pool, clockId: string, at: Date): Promise<void> {
  const client = await control.connect();
  try {
    await client.query(
      `UPDATE statutory_clock SET closed_at = $3
        WHERE company_id = $1 AND clock_id = $2`,
      [COMPANY_ID, clockId, at],
    );
  } finally {
    client.release();
  }
}

/**
 * Seed an `authority_task` carrying a case, for suites that need TWO cases at once.
 *
 * =================================================================================
 * WHY A SECOND TASK IS REQUIRED RATHER THAN A SECOND CASE ON ONE TASK.
 *
 * `25 §7`'s effect idempotency key is `H(task_id ‖ action_class ‖ resource_id ‖
 * semantic_param_digest)`. Two effects of one action class on one resource under one task
 * are THE SAME EFFECT — `I42` returns the prior result rather than creating a second row —
 * so a fixture cannot produce two differently-cased effects from one task even in
 * principle.
 *
 * **That is `30 §9.2.6`'s idempotency argument, observed rather than asserted:** "`case_ref`
 * is a function of `task_id`, so two effects with different case bindings necessarily carry
 * different `task_id`s and already have different keys." A fixture that needs two cases
 * needs two tasks, and the reason it needs two tasks is the reason the key is unchanged.
 * =================================================================================
 */
export async function seedTaskWithCase(
  control: Pool,
  task: {
    readonly taskId: string;
    readonly caseRef: string | null;
    readonly principalId?: string;
    readonly taskType?: string;
  },
): Promise<void> {
  const client = await control.connect();
  try {
    await client.query(
      `INSERT INTO authority_task (company_id, task_id, task_type, principal_id, case_ref)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        COMPANY_ID,
        task.taskId,
        task.taskType ?? 'support.refund',
        task.principalId ?? 'principal:support_reasoner:1',
        task.caseRef,
      ],
    );
  } finally {
    client.release();
  }
}

/**
 * Clone a committed `authorisation` under a NEW id, keeping its `task_id`.
 *
 * ONLY FOR THE `I64` DERIVATION ATTACK. `effect.authorisation_id` is UNIQUE (`24 §3` K5 /
 * `I31`), so an attacker attempting to insert an effect with a chosen `case_ref` needs an
 * authorisation that has no effect yet — otherwise the unique constraint refuses the row
 * before `effect_derive_case_ref` can run, and the test would prove `I31` rather than
 * `I64`.
 *
 * `authorisation` is append-only for UPDATE and DELETE; INSERT is how it is written, so
 * this is an ordinary insert and not a schema bypass.
 */
export async function cloneAuthorisation(
  control: Pool,
  sourceAuthorisationId: string,
  newAuthorisationId: string,
): Promise<void> {
  const client = await control.connect();
  try {
    await client.query(
      `INSERT INTO authorisation
       SELECT $3 AS authorisation_id, company_id, principal_id, session_id, task_id,
              action_class, resource_ref, resource_id, dispatch_payload_hash, intent_hash,
              context_digest, constructor_id, constructor_semantic_major,
              constructor_non_semantic_minor, policy_version, vendor_amount,
              total_exposure, forward_integral, is_rate_class, recoverability,
              value_direction, autonomy_level, gate_class, created_at
         FROM authorisation
        WHERE company_id = $1 AND authorisation_id = $2`,
      [COMPANY_ID, sourceAuthorisationId, newAuthorisationId],
    );
  } finally {
    client.release();
  }
}
