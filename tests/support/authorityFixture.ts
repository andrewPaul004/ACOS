import { generateKeyPairSync, sign as signBytes, type KeyObject } from 'node:crypto';

import type { Client } from '../../src/db/pool.js';
import { delegationHopSigningBytes } from '../../src/kernel/authority/principal.js';
import { PreReservationAuthorityPipeline } from '../../src/kernel/authority/preReservation.js';
import { PolicyEngine } from '../../src/kernel/policy/policyEngine.js';
import { COMPANY_ID, type Harness } from './fixture.js';
import { parseProposedIntent } from '../../src/kernel/canonicalisation/intent.js';
import {
  CAN03,
  FIXTURE_NOW,
  PRINCIPAL_ID,
  TASK_ID,
  entityKeyFor,
  makeEnumerationHarness,
  makeSpec,
  rawIntent,
  type EnumerationHarness,
} from './enumerationFixture.js';

/**
 * The S1E authority fixtures — REAL ROWS IN REAL POSTGRESQL.
 *
 * Everything here is kernel-side authoritative state: principals, their Ed25519 keys, their
 * signed delegation chain, sessions, tasks, platform status, agent profiles, state facts,
 * contradiction links, grants, evidence and the autonomy ledger. It builds the world the
 * gates read. It is NOT an oracle: every EXPECTED value lives in the test that asserts it.
 *
 * ---------------------------------------------------------------------------------
 * FIGURES HERE ARE S1E IMPLEMENTATION FIXTURES, RECORDED AS SUCH
 *
 * `26 §4` prints the Grant record's fields and `51 §3.1` prints `refund.create`'s
 * per-action figure and window counts. Everything else below — the precondition the class
 * declares, the resource predicate, the autonomy key, the session lifetime — is declared by
 * S1E as a fixture and recorded in docs/implementation/S1E-owner-clarifications.md rather
 * than presented as a reading of the architecture.
 *
 * The chain shape is `26 §3`'s own: "its organisational depth is Owner → CEO → worker".
 * ---------------------------------------------------------------------------------
 */

export const OWNER_PRINCIPAL = 'principal:owner';
export const CEO_PRINCIPAL = 'principal:ceo';
/** The worker `26 §8`'s policy names. Same id the S1C enumeration fixtures already use. */
export const WORKER_PRINCIPAL = PRINCIPAL_ID;

export const WORKER_SESSION = 'session:S1E-worker-1';
export const WORKER_MODEL_BINDING = 'model:fixture-binding@1/prompt@1';
export const TASK_TYPE = 'support_case';

/** `26 §4`'s `autonomy_key_binding`. An S1E fixture identifier, not an architecture figure. */
export const AUTONOMY_KEY_BINDING = 'autonomy:support_case/refund.create/order';

export const REFUND_GRANT = 'grant:s1e:refund.create';

/** The precondition `refund.create` declares. S1E fixture decision S1E-C1. */
export const REFUND_PRECONDITION_KEY = 'order_payment_settled';
export const REFUND_PRECONDITION_PREDICATE = 'payment_settled';
export const REFUND_PRECONDITION_REQUIRED_VALUE = 'true';
/** The precondition fact id for an order. One per order the suite proposes against. */
export function preconditionFactId(orderId: string): string {
  return `fact:${orderId}:payment_settled`;
}

/** `51 §3.1`: `refund.create | $25.00 | 2 | 10 | INBOUND_ORIGINAL_INSTRUMENT | COMPENSABLE`. */
export const REFUND_GRANT_WINDOWS = ['W_DAY_REFUND', 'W_MONTH_REFUND'] as const;

export interface AuthoritySigner {
  readonly publicKey: KeyObject;
  readonly privateKey: KeyObject;
}

export function newAuthoritySigner(): AuthoritySigner {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return { publicKey, privateKey };
}

function spki(key: KeyObject): Buffer {
  return key.export({ format: 'der', type: 'spki' });
}

// =====================================================================================
// Writers
// =====================================================================================

export async function insertPrincipal(
  client: Client,
  principal: {
    readonly principalId: string;
    readonly kind: string;
    readonly role: string;
    readonly modelBinding?: string | null;
    readonly status?: string;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO principal (company_id, principal_id, kind, role, model_binding, status)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [
      COMPANY_ID,
      principal.principalId,
      principal.kind,
      principal.role,
      principal.modelBinding ?? null,
      principal.status ?? 'ACTIVE',
    ],
  );
}

export async function insertPrincipalKey(
  client: Client,
  principalId: string,
  signer: AuthoritySigner,
): Promise<void> {
  await client.query(
    `INSERT INTO principal_key (company_id, principal_id, public_key) VALUES ($1,$2,$3)`,
    [COMPANY_ID, principalId, spki(signer.publicKey)],
  );
}

export async function insertSession(
  client: Client,
  session: {
    readonly sessionId: string;
    readonly principalId: string;
    readonly issuedAt?: Date;
    readonly expiresAt?: Date;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO principal_session (company_id, session_id, principal_id, issued_at, expires_at)
     VALUES ($1,$2,$3,$4,$5)`,
    [
      COMPANY_ID,
      session.sessionId,
      session.principalId,
      session.issuedAt ?? new Date(FIXTURE_NOW.getTime() - 60_000),
      session.expiresAt ?? new Date(FIXTURE_NOW.getTime() + 3_600_000),
    ],
  );
}

/**
 * Insert a delegation hop, signed with the DELEGATING principal's key over the same bytes
 * the verifier reads.
 *
 * `signWith` is deliberately a separate parameter from `delegatingPrincipalId`, so a test
 * can sign a hop with the WRONG key and prove the verifier notices. A helper that always
 * signed with the right key could not express the attack.
 */
export async function insertDelegationHop(
  client: Client,
  hop: {
    readonly principalId: string;
    readonly hopIndex: number;
    readonly delegatingPrincipalId: string;
    readonly grantedActionClasses: readonly string[];
    readonly signWith: AuthoritySigner;
    readonly corruptSignature?: boolean;
  },
): Promise<void> {
  const bytes = delegationHopSigningBytes({
    companyId: COMPANY_ID,
    principalId: hop.principalId,
    hopIndex: hop.hopIndex,
    delegatingPrincipalId: hop.delegatingPrincipalId,
    grantedActionClasses: hop.grantedActionClasses,
  });
  const signature = signBytes(null, bytes, hop.signWith.privateKey);
  if (hop.corruptSignature === true) signature[0] = (signature[0] ?? 0) ^ 0xff;
  await client.query(
    `INSERT INTO delegation_hop
       (company_id, principal_id, hop_index, delegating_principal_id, granted_action_classes, signature)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [
      COMPANY_ID,
      hop.principalId,
      hop.hopIndex,
      hop.delegatingPrincipalId,
      [...hop.grantedActionClasses],
      signature,
    ],
  );
}

export async function insertTask(
  client: Client,
  task: { readonly taskId: string; readonly taskType: string; readonly principalId: string },
): Promise<void> {
  await client.query(
    `INSERT INTO authority_task (company_id, task_id, task_type, principal_id) VALUES ($1,$2,$3,$4)`,
    [COMPANY_ID, task.taskId, task.taskType, task.principalId],
  );
}

export async function setPlatformStatus(
  client: Client,
  status: { readonly status?: string; readonly killSwitch?: boolean } = {},
): Promise<void> {
  await client.query(
    `INSERT INTO company_platform_status (company_id, status, kill_switch, updated_at)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (company_id) DO UPDATE SET status = EXCLUDED.status,
                                            kill_switch = EXCLUDED.kill_switch,
                                            updated_at = EXCLUDED.updated_at`,
    [COMPANY_ID, status.status ?? 'OPERATING', status.killSwitch ?? false, FIXTURE_NOW],
  );
}

export async function clearPlatformStatus(client: Client): Promise<void> {
  await client.query(`DELETE FROM company_platform_status WHERE company_id = $1`, [COMPANY_ID]);
}

export async function insertAgentProfileCapability(
  client: Client,
  capability: {
    readonly principalId: string;
    readonly actionClass: string;
    readonly status?: string;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO agent_profile_capability (company_id, principal_id, action_class, status)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (company_id, principal_id, action_class)
       DO UPDATE SET status = EXCLUDED.status`,
    [COMPANY_ID, capability.principalId, capability.actionClass, capability.status ?? 'ENABLED'],
  );
}

export async function insertPrecondition(
  client: Client,
  precondition: {
    readonly actionClass: string;
    readonly key: string;
    readonly subjectTemplate: string;
    readonly predicate: string;
    readonly requiredValue: string;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO action_class_precondition
       (company_id, action_class, precondition_key, subject_template, predicate, required_value)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [
      COMPANY_ID,
      precondition.actionClass,
      precondition.key,
      precondition.subjectTemplate,
      precondition.predicate,
      precondition.requiredValue,
    ],
  );
}

/**
 * Insert a state fact.
 *
 * NOTE what this function CANNOT do: it has no `grade` parameter. The column is
 * `GENERATED ALWAYS`, so PostgreSQL rejects a supplied value outright — which is the point
 * of `I5` and is asserted directly by the suite. A test that wants a particular grade sets
 * the WRITER, exactly as `24 §5` requires.
 */
export async function insertStateFact(
  client: Client,
  fact: {
    readonly factId: string;
    readonly subject: string;
    readonly predicate: string;
    readonly value: string;
    readonly writerKind: string;
    readonly writerPrincipalId?: string | null;
    readonly promoterRule?: string | null;
    readonly derivationSpec?: string | null;
    readonly decisionAuthority?: string | null;
    readonly sourceAdapter?: string | null;
    readonly corroboratingSource?: string | null;
    readonly observedAt?: Date;
    readonly recordedAt?: Date;
    readonly maxAgeSeconds?: number;
    readonly stalenessPolicy?: string;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO state_fact
       (company_id, fact_id, subject, predicate, value, writer_kind, writer_principal_id,
        promoter_rule, derivation_spec, decision_authority, source_adapter, corroborating_source,
        observed_at, recorded_at, max_age_seconds, staleness_policy)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
    [
      COMPANY_ID,
      fact.factId,
      fact.subject,
      fact.predicate,
      fact.value,
      fact.writerKind,
      fact.writerPrincipalId ?? null,
      fact.promoterRule ?? null,
      fact.derivationSpec ?? null,
      fact.decisionAuthority ?? null,
      fact.sourceAdapter ?? null,
      fact.corroboratingSource ?? null,
      fact.observedAt ?? new Date(FIXTURE_NOW.getTime() - 60_000),
      fact.recordedAt ?? new Date(FIXTURE_NOW.getTime() - 60_000),
      fact.maxAgeSeconds ?? 86_400,
      fact.stalenessPolicy ?? 'BLOCK',
    ],
  );
}

export async function insertContradiction(
  client: Client,
  link: {
    readonly linkId: string;
    readonly factA: string;
    readonly factB: string;
    readonly status?: string;
    readonly rule?: string;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO contradiction_link
       (company_id, link_id, fact_a_id, fact_b_id, detected_by_rule, status, detected_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [
      COMPANY_ID,
      link.linkId,
      link.factA,
      link.factB,
      link.rule ?? 'same_subject_predicate_incompatible_value_v1',
      link.status ?? 'OPEN',
      FIXTURE_NOW,
    ],
  );
}

export interface GrantFixture {
  readonly grantId: string;
  readonly actionClasses: readonly string[];
  readonly windows: readonly string[];
  readonly principalRole?: string | null;
  readonly principalKind?: string | null;
  readonly principalModelBinding?: string | null;
  readonly resourceType?: string;
  readonly resourcePredicate?: string;
  readonly recoverabilityMax?: string;
  readonly counterpartyNoveltyMax?: string | null;
  readonly perActionMaxMonetary?: string | null;
  readonly evidenceMinSources?: number | null;
  readonly evidenceMaxTier?: number | null;
  readonly evidenceMaxAgeDays?: number | null;
  readonly approvalRequirement?: string;
  readonly autonomyKeyBinding?: string;
  readonly gateClassOnPermit?: string;
  readonly status?: string;
  readonly expiresAt?: Date;
  readonly standingRequired?: boolean;
}

export async function insertGrant(client: Client, grant: GrantFixture): Promise<void> {
  await client.query(
    `INSERT INTO authority_grant
       (company_id, grant_id, version, status, created_by, created_at, expires_at,
        principal_kind, principal_role, principal_model_binding,
        resource_type, resource_predicate, counterparty_novelty_max, recoverability_max,
        per_action_max_monetary, standing_required,
        evidence_min_sources, evidence_max_tier, evidence_max_age_days,
        approval_requirement, autonomy_key_binding, gate_class_on_permit)
     VALUES ($1,$2,1,$3,'owner',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::NUMERIC,$14,$15,$16,$17,$18,$19,$20)`,
    [
      COMPANY_ID,
      grant.grantId,
      grant.status ?? 'ACTIVE',
      new Date(FIXTURE_NOW.getTime() - 86_400_000),
      grant.expiresAt ?? new Date(FIXTURE_NOW.getTime() + 30 * 86_400_000),
      grant.principalKind ?? null,
      grant.principalRole ?? 'support_reasoner',
      grant.principalModelBinding ?? null,
      grant.resourceType ?? 'order',
      grant.resourcePredicate ?? 'ANY',
      grant.counterpartyNoveltyMax ?? null,
      grant.recoverabilityMax ?? 'COMPENSABLE',
      grant.perActionMaxMonetary ?? '25.00',
      grant.standingRequired ?? false,
      grant.evidenceMinSources ?? null,
      grant.evidenceMaxTier ?? null,
      grant.evidenceMaxAgeDays ?? null,
      grant.approvalRequirement ?? 'NONE',
      grant.autonomyKeyBinding ?? AUTONOMY_KEY_BINDING,
      grant.gateClassOnPermit ?? 'UNGATED_LOGGED',
    ],
  );
  for (const actionClass of grant.actionClasses) {
    await client.query(
      `INSERT INTO authority_grant_action_class (company_id, grant_id, action_class)
       VALUES ($1,$2,$3)`,
      [COMPANY_ID, grant.grantId, actionClass],
    );
  }
  for (const windowId of grant.windows) {
    await client.query(
      `INSERT INTO authority_grant_window (company_id, grant_id, window_id) VALUES ($1,$2,$3)`,
      [COMPANY_ID, grant.grantId, windowId],
    );
  }
}

export async function insertAutonomyEntry(
  client: Client,
  entry: {
    readonly taskType?: string;
    readonly actionClass?: string;
    readonly modelBinding?: string;
    readonly resourceClass?: string;
    readonly level?: string;
    readonly observations?: number;
    readonly policyViolations?: number;
    readonly escalationMisses?: number;
    readonly probationUntil?: Date | null;
  } = {},
): Promise<void> {
  await client.query(
    `INSERT INTO autonomy_ledger_entry
       (company_id, task_type, action_class, model_binding, resource_class,
        level, granted_at, observations, policy_violations, escalation_misses, probation_until)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [
      COMPANY_ID,
      entry.taskType ?? TASK_TYPE,
      entry.actionClass ?? 'refund.create',
      entry.modelBinding ?? WORKER_MODEL_BINDING,
      entry.resourceClass ?? 'order',
      entry.level ?? 'L3_OPERATIONAL',
      new Date(FIXTURE_NOW.getTime() - 30 * 86_400_000),
      entry.observations ?? 500,
      entry.policyViolations ?? 0,
      entry.escalationMisses ?? 0,
      entry.probationUntil ?? null,
    ],
  );
}

export async function insertEvidenceSource(
  client: Client,
  source: {
    readonly sourceId: string;
    readonly registrableDomain: string;
    readonly ownerEntity?: string | null;
    readonly tier: number;
    readonly vendorInterest?: boolean;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO evidence_source
       (company_id, source_id, registrable_domain, owner_entity, tier, vendor_interest)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [
      COMPANY_ID,
      source.sourceId,
      source.registrableDomain,
      source.ownerEntity ?? null,
      source.tier,
      source.vendorInterest ?? false,
    ],
  );
}

export async function insertEvidenceItem(
  client: Client,
  item: {
    readonly itemId: string;
    readonly sourceId: string;
    readonly accessStatus?: string;
    readonly fetchAt?: Date;
    readonly citesItemId?: string | null;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO evidence_item
       (company_id, evidence_item_id, source_id, url, fetch_at, content_hash, access_status, cites_item_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      COMPANY_ID,
      item.itemId,
      item.sourceId,
      `https://${item.sourceId}/evidence`,
      item.fetchAt ?? new Date(FIXTURE_NOW.getTime() - 86_400_000),
      `hash:${item.itemId}`,
      item.accessStatus ?? 'OK',
      item.citesItemId ?? null,
    ],
  );
}

export async function bindEvidenceSet(
  client: Client,
  binding: {
    readonly evidenceSetId: string;
    readonly itemIds: readonly string[];
    readonly loadBearingItemId?: string;
    readonly taskId?: string;
    readonly actionClass?: string;
    readonly resourceId?: string;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO evidence_set (company_id, evidence_set_id, frozen_hash, frozen_at)
     VALUES ($1,$2,$3,$4)`,
    [COMPANY_ID, binding.evidenceSetId, `frozen:${binding.evidenceSetId}`, FIXTURE_NOW],
  );
  for (const itemId of binding.itemIds) {
    await client.query(
      `INSERT INTO evidence_set_item (company_id, evidence_set_id, evidence_item_id, load_bearing)
       VALUES ($1,$2,$3,$4)`,
      [COMPANY_ID, binding.evidenceSetId, itemId, itemId === binding.loadBearingItemId],
    );
  }
  await client.query(
    `INSERT INTO action_evidence_binding
       (company_id, task_id, action_class, resource_id, evidence_set_id)
     VALUES ($1,$2,$3,$4,$5)`,
    [
      COMPANY_ID,
      binding.taskId ?? TASK_ID,
      binding.actionClass ?? 'refund.create',
      binding.resourceId ?? CAN03.orderId,
      binding.evidenceSetId,
    ],
  );
}

// =====================================================================================
// The happy-path world
// =====================================================================================

export interface AuthorityWorld {
  readonly ownerSigner: AuthoritySigner;
  readonly ceoSigner: AuthoritySigner;
}

/**
 * Load the state in which a `refund.create` proposal passes every S1E gate.
 *
 * Each test then breaks EXACTLY ONE thing and asserts the gate it expects. That is what
 * makes the suite discriminating: a fixture that had to be assembled per test would let a
 * denial pass for a reason nobody chose.
 *
 * The chain is `26 §3`'s "Owner → CEO → worker", depth 2, narrowing at the second hop from
 * `{refund.create, campaign.pause}` to `{refund.create}`.
 */
export async function loadAuthorityWorld(client: Client): Promise<AuthorityWorld> {
  const ownerSigner = newAuthoritySigner();
  const ceoSigner = newAuthoritySigner();

  await insertPrincipal(client, {
    principalId: OWNER_PRINCIPAL,
    kind: 'OWNER',
    role: 'owner',
  });
  await insertPrincipal(client, {
    principalId: CEO_PRINCIPAL,
    kind: 'AI_ROLE',
    role: 'ceo',
    modelBinding: 'model:ceo-binding@1/prompt@1',
  });
  await insertPrincipal(client, {
    principalId: WORKER_PRINCIPAL,
    kind: 'AI_ROLE',
    role: 'support_reasoner',
    modelBinding: WORKER_MODEL_BINDING,
  });

  await insertPrincipalKey(client, OWNER_PRINCIPAL, ownerSigner);
  await insertPrincipalKey(client, CEO_PRINCIPAL, ceoSigner);

  await insertDelegationHop(client, {
    principalId: WORKER_PRINCIPAL,
    hopIndex: 1,
    delegatingPrincipalId: OWNER_PRINCIPAL,
    grantedActionClasses: ['refund.create', 'campaign.pause'],
    signWith: ownerSigner,
  });
  await insertDelegationHop(client, {
    principalId: WORKER_PRINCIPAL,
    hopIndex: 2,
    delegatingPrincipalId: CEO_PRINCIPAL,
    grantedActionClasses: ['refund.create'],
    signWith: ceoSigner,
  });

  await insertSession(client, { sessionId: WORKER_SESSION, principalId: WORKER_PRINCIPAL });
  await insertTask(client, {
    taskId: TASK_ID,
    taskType: TASK_TYPE,
    principalId: WORKER_PRINCIPAL,
  });

  await setPlatformStatus(client);
  await insertAgentProfileCapability(client, {
    principalId: WORKER_PRINCIPAL,
    actionClass: 'refund.create',
  });

  await insertPrecondition(client, {
    actionClass: 'refund.create',
    key: REFUND_PRECONDITION_KEY,
    subjectTemplate: '{resource_ref}',
    predicate: REFUND_PRECONDITION_PREDICATE,
    requiredValue: REFUND_PRECONDITION_REQUIRED_VALUE,
  });
  // `24 §5` v1.1 R6: a PARSER-written fact is RECORD grade. The grade is DERIVED — this
  // fixture chooses the WRITER, never the grade, because the column is GENERATED ALWAYS and
  // PostgreSQL refuses a supplied one.
  for (const resourceRef of [
    CAN03.resourceRef,
    S1E_PASS_ORDER.resourceRef,
    S1E_OVER_CAP_ORDER.resourceRef,
  ]) {
    await insertStateFact(client, {
      factId: preconditionFactId(resourceRef.slice('order:'.length)),
      subject: resourceRef,
      predicate: REFUND_PRECONDITION_PREDICATE,
      value: REFUND_PRECONDITION_REQUIRED_VALUE,
      writerKind: 'PARSER',
      sourceAdapter: 'mock_processor',
    });
  }

  await insertGrant(client, {
    grantId: REFUND_GRANT,
    actionClasses: ['refund.create'],
    windows: [...REFUND_GRANT_WINDOWS],
  });

  await insertAutonomyEntry(client);

  return { ownerSigner, ceoSigner };
}

// =====================================================================================
// The component graph
// =====================================================================================

export interface AuthorityHarness extends EnumerationHarness {
  readonly policyEngine: PolicyEngine;
  readonly pipeline: PreReservationAuthorityPipeline;
}

export function makeAuthorityHarness(
  harness: Harness,
  options: Parameters<typeof makeEnumerationHarness>[1] = {},
): AuthorityHarness {
  const enumeration = makeEnumerationHarness(harness, options);
  const policyEngine = new PolicyEngine();
  const pipeline = new PreReservationAuthorityPipeline({
    liveSelector: enumeration.liveSelector,
    policyEngine,
    clock: enumeration.clock,
  });
  return { ...enumeration, policyEngine, pipeline };
}

/** The one identity input the pipeline takes. */
export function workerSession(sessionId: string = WORKER_SESSION): {
  readonly companyId: string;
  readonly sessionId: string;
} {
  return { companyId: COMPANY_ID, sessionId };
}

/** The two lineage fields that are NOT authority operands. */
export function nonAuthorityContext(): {
  readonly contextDigest: string;
  readonly authorisationRef: string;
} {
  return { contextDigest: 'ctxdigest:s1e-0001', authorisationRef: 'auth:AR-S1E-0001' };
}

// =====================================================================================
// The S1E commerce orders, and the one call a test makes
// =====================================================================================

/**
 * An order whose sole option is UNDER the `51 §3.1` cap, so the whole sequence can reach
 * `PRE_RESERVATION_PASS`.
 *
 * $9.41 vendor + $0.59 retained = $10.00 total exposure, against a $25.00 per-action bound.
 * The figures are hand-authored AMOUNTS with a source reference — S1B-C3a: "An implementation
 * may not invent an economic rule because the rule reproduces a fixture."
 */
export const S1E_PASS_ORDER = Object.freeze({
  orderId: 'ORD-S1E-PASS',
  resourceRef: 'order:ORD-S1E-PASS',
  lineId: 'line:ORD-S1E-PASS:1',
  parentTransactionId: 'txn:CH-S1E-PASS',
  instrument: 'original',
  lineRemaining: '9.41',
  transactionRemaining: '9.41',
  retainedFee: '0.59',
  feeSourceRef: 'record:processor_settlement_terms:mock_processor:ORD-S1E-PASS',
  currency: 'USD',
  customerNovelty: 'RETURNING',
} as const);

/**
 * VC-C1's shape again: $25.00 vendor + $1.03 retained = $26.03, over the $25.00 bound.
 *
 * It exists so S1E can assert the case `36 §2` VC-C1 names FROM THE OTHER SIDE — a proposal
 * that passes every gate D through L and is then denied by the accepted S1D Cedar decision at
 * step M.
 */
export const S1E_OVER_CAP_ORDER = Object.freeze({
  orderId: 'ORD-S1E-OVER',
  resourceRef: 'order:ORD-S1E-OVER',
  lineId: 'line:ORD-S1E-OVER:1',
  parentTransactionId: 'txn:CH-S1E-OVER',
  instrument: 'original',
  lineRemaining: '25.00',
  transactionRemaining: '25.00',
  retainedFee: '1.03',
  feeSourceRef: 'record:processor_settlement_terms:mock_processor:ORD-S1E-OVER',
  currency: 'USD',
  customerNovelty: 'RETURNING',
} as const);

export type S1eOrder = typeof S1E_PASS_ORDER | typeof S1E_OVER_CAP_ORDER;

/**
 * Load the two S1E orders.
 *
 * The accepted S1C `loadCommerceFixture` is deliberately NOT extended — accepted tests assert
 * cardinalities over the orders it loads — and this is the same discipline S1D's own loader
 * applied.
 */
export async function loadS1eOrders(client: Client): Promise<void> {
  for (const order of [S1E_PASS_ORDER, S1E_OVER_CAP_ORDER]) {
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
      [COMPANY_ID, order.orderId, order.parentTransactionId, order.instrument, order.transactionRemaining],
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

/** The task `context_spec`, admitting the two S1E orders. */
export function s1eSpec(
  overrides: Parameters<typeof makeSpec>[0] = {},
): ReturnType<typeof makeSpec> {
  return makeSpec({
    admittedResourceRefs: [S1E_PASS_ORDER.resourceRef, S1E_OVER_CAP_ORDER.resourceRef],
    ...overrides,
  });
}

/**
 * The whole S1E path for one order, in two leases: enumerate, then propose.
 *
 * `26 §2.0.1` makes `enumerate_effects` a READ the model performs first; the proposal then
 * names the enumeration by id. Two leases is the honest shape — the model's read and its
 * proposal are separate acts — and it is also what makes the S1C staleness and reordering
 * guarantees meaningful.
 */
export async function proposeUnderLease(
  kernel: AuthorityHarness,
  order: S1eOrder,
  options: {
    readonly sessionId?: string;
    readonly spec?: ReturnType<typeof makeSpec>;
    readonly reasonCode?: string;
    readonly barrier?: () => Promise<void>;
  } = {},
): Promise<import('../../src/kernel/authority/preReservationResult.js').PreReservationOutcome> {
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
  return kernel.leases.withEntityLease(key, (lease) =>
    kernel.pipeline.evaluateUnderLease(
      lease,
      workerSession(options.sessionId),
      intent,
      spec,
      nonAuthorityContext(),
      options.barrier,
    ),
  );
}
