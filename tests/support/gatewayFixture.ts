import type { Pool } from '../../src/db/pool.js';
import type { EffectEnumerator } from '../../src/kernel/enumeration/enumerateEffects.js';
import { DispatchLeaseManager } from '../../src/kernel/gateway/dispatchLease.js';
import type { DispatchEnvironment } from '../../src/kernel/gateway/effectGateway.js';
import {
  createAdapterRegistry,
  type AdapterRegistry,
} from '../../src/kernel/gateway/adapterRegistry.js';
import type { ExternalEffectAdapter } from '../../src/kernel/gateway/adapterPort.js';
import { COMPANY_ID } from './fixture.js';
import { activeVerifiedControlArtifacts } from '../../src/kernel/controlArtifacts/registry.js';

/**
 * The three catalogue adapter identities the S1 closed catalogue names.
 *
 * `37 §2` S1: "exactly three classes: one REVERSIBLE, one COMPENSABLE, one IRRECOVERABLE,
 * **all against a mock adapter** — plus one rate-based class against a mock." `26 §5`
 * assigns each class's adapter, and `ACTION_CATALOGUE` transcribes the assignment:
 *
 *     campaign.pause      REVERSIBLE     mock_ads
 *     refund.create       COMPENSABLE    mock_processor
 *     fulfilment.reship   IRRECOVERABLE  mock_commerce
 *     campaign.budget.set COMPENSABLE    mock_ads      (rate class)
 *
 * These are the KEYS a registry must use, and `createAdapterRegistry` refuses any other —
 * which is `§8`'s substitution closed at construction time.
 */
export const ADAPTER_ADS = 'mock_ads';
export const ADAPTER_PROCESSOR = 'mock_processor';
export const ADAPTER_COMMERCE = 'mock_commerce';

/** Build a registry from mocks. The TEST-ONLY resolver `§8` permits. */
export function testRegistry(...adapters: readonly ExternalEffectAdapter[]): AdapterRegistry {
  return createAdapterRegistry(adapters);
}

/**
 * The `DispatchEnvironment` `25 §14.1`'s Epoch B needs — v1.3.5 (SER-01).
 *
 * =================================================================================
 * WHY THE HARNESS IS A STRUCTURAL PARAMETER AND NOT AN IMPORTED TYPE
 *
 * `OutboxHarness` lives in `outboxFixture.ts`, which imports THIS module. Naming the type
 * here would close a cycle, so the parameter is the structural shape this function actually
 * reads — the control pool and the kernel's enumerator — and nothing else.
 *
 * THE LEASE MANAGER IS BUILT PER CALL, ON PURPOSE. `25 §14.1` requires the dispatch lease to
 * be "a NEW PostgreSQL session", and `DispatchLeaseManager` checks a connection out of the
 * pool per acquisition. A manager shared across a test file is still one session per
 * acquisition, so building one per call costs nothing and keeps each scenario's Epoch B
 * independent of every other's.
 * =================================================================================
 */
export function dispatchEnv(
  h: { readonly control: Pool; readonly kernel: { readonly enumerator: EffectEnumerator } },
  ...adapters: readonly ExternalEffectAdapter[]
): DispatchEnvironment {
  return {
    control: h.control,
    registry: createAdapterRegistry(adapters),
    leases: new DispatchLeaseManager({ pool: h.control }),
    enumerator: h.kernel.enumerator,
    // `50 §3f`'s pre-live external-effect gate. The capability is a REQUIRED member of
    // `DispatchEnvironment`, so a fixture cannot build a dispatch path without one either —
    // which is the property `§51` of the S1K mandate asks for: a future real-adapter
    // composition must not be able to bypass it.
    controlArtifacts: activeVerifiedControlArtifacts(),
  };
}

/**
 * The same environment with a registry the caller already built.
 *
 * For the scenarios that keep a `registry` variable so a second dispatch can reuse the
 * identical adapter instance and its call counters.
 */
export function dispatchEnvWith(
  h: { readonly control: Pool; readonly kernel: { readonly enumerator: EffectEnumerator } },
  registry: AdapterRegistry,
): DispatchEnvironment {
  return {
    control: h.control,
    registry,
    leases: new DispatchLeaseManager({ pool: h.control }),
    enumerator: h.kernel.enumerator,
    // `50 §3f`'s pre-live external-effect gate. The capability is a REQUIRED member of
    // `DispatchEnvironment`, so a fixture cannot build a dispatch path without one either —
    // which is the property `§51` of the S1K mandate asks for: a future real-adapter
    // composition must not be able to bypass it.
    controlArtifacts: activeVerifiedControlArtifacts(),
  };
}

/**
 * S1J's raw-SQL readers.
 *
 * `§42` of the mandate wants "direct SQL before/after" for every scenario, and `§41`
 * forbids reading an expected value out of a production helper. So every reader here issues
 * its own `SELECT` on a fresh connection and returns strings at the column's declared
 * scale; none calls `readDispatchOutcome`, `processAdapterOutcome` or any other production
 * function, and none imports the production outcome policy.
 */

/** One `effect_dispatch_outcome` row, as raw SQL sees it. */
export interface RawOutcomeRow {
  readonly companyId: string;
  readonly idempotencyKey: string;
  readonly outboxId: string;
  readonly effectId: string;
  readonly authorisationId: string;
  readonly claimId: string;
  readonly adapter: string;
  readonly recoverability: string;
  readonly outcomeKind: string;
  readonly effectStatus: string;
  readonly providerReference: string | null;
  readonly rawResponseHash: string | null;
  readonly requiresUnmirroredTag: boolean;
  readonly unmirroredTagSent: boolean;
  readonly overrideId: string | null;
  readonly economicMovement: string;
  readonly journalSeq: bigint;
}

interface OutcomeSqlRow {
  readonly company_id: string;
  readonly idempotency_key: string;
  readonly outbox_id: string;
  readonly effect_id: string;
  readonly authorisation_id: string;
  readonly claim_id: string;
  readonly adapter: string;
  readonly recoverability: string;
  readonly outcome_kind: string;
  readonly effect_status: string;
  readonly provider_reference: string | null;
  readonly raw_response_hash: string | null;
  readonly requires_unmirrored_tag: boolean;
  readonly unmirrored_tag_sent: boolean;
  readonly override_id: string | null;
  readonly economic_movement: string;
  readonly journal_seq: string;
}

export async function rawOutcomeRows(control: Pool): Promise<readonly RawOutcomeRow[]> {
  const client = await control.connect();
  try {
    const result = await client.query<OutcomeSqlRow>(
      `SELECT company_id, idempotency_key, outbox_id, effect_id, authorisation_id,
              claim_id, adapter, recoverability, outcome_kind, effect_status,
              provider_reference, raw_response_hash, requires_unmirrored_tag,
              unmirrored_tag_sent, override_id, economic_movement, journal_seq::TEXT
         FROM effect_dispatch_outcome
        WHERE company_id = $1
        ORDER BY journal_seq`,
      [COMPANY_ID],
    );
    return result.rows.map((r) => ({
      companyId: r.company_id,
      idempotencyKey: r.idempotency_key,
      outboxId: r.outbox_id,
      effectId: r.effect_id,
      authorisationId: r.authorisation_id,
      claimId: r.claim_id,
      adapter: r.adapter,
      recoverability: r.recoverability,
      outcomeKind: r.outcome_kind,
      effectStatus: r.effect_status,
      providerReference: r.provider_reference,
      rawResponseHash: r.raw_response_hash,
      requiresUnmirroredTag: r.requires_unmirrored_tag,
      unmirroredTagSent: r.unmirrored_tag_sent,
      overrideId: r.override_id,
      economicMovement: r.economic_movement,
      journalSeq: BigInt(r.journal_seq),
    }));
  } finally {
    client.release();
  }
}

export async function rawOutcomeRowCount(control: Pool): Promise<number> {
  const client = await control.connect();
  try {
    const result = await client.query<{ n: string }>(
      `SELECT count(*)::TEXT AS n FROM effect_dispatch_outcome WHERE company_id = $1`,
      [COMPANY_ID],
    );
    return Number(result.rows[0]!.n);
  } finally {
    client.release();
  }
}

/** Every `DISPATCH_OUTCOME` journal row, read with raw SQL. */
export interface OutcomeJournalRow {
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
  readonly adapter: string;
  readonly outcomeKind: string;
  readonly effectStatus: string;
  readonly requiresUnmirroredTag: boolean;
  readonly overrideId: string | null;
  readonly occurredAt: Date;
  readonly prevHash: Buffer | null;
  readonly rowHash: Buffer;
}

export async function outcomeJournalRows(control: Pool): Promise<readonly OutcomeJournalRow[]> {
  const client = await control.connect();
  try {
    const result = await client.query<Record<string, unknown>>(
      `SELECT journal_seq::TEXT AS journal_seq, outbox_id, outbox_claim_id,
              outbox_correlation_tag, effect_id, authorisation_id, idempotency_key,
              action_class, resource_ref, dispatch_payload_hash,
              dispatch_adapter, dispatch_outcome_kind, dispatch_effect_status,
              outbox_requires_unmirrored_tag, override_id, occurred_at, prev_hash, row_hash
         FROM effect_journal
        WHERE company_id = $1 AND journal_row_kind = 'DISPATCH_OUTCOME'
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
      adapter: r['dispatch_adapter'] as string,
      outcomeKind: r['dispatch_outcome_kind'] as string,
      effectStatus: r['dispatch_effect_status'] as string,
      requiresUnmirroredTag: r['outbox_requires_unmirrored_tag'] as boolean,
      overrideId: (r['override_id'] as string | null) ?? null,
      occurredAt: r['occurred_at'] as Date,
      prevHash: (r['prev_hash'] as Buffer | null) ?? null,
      rowHash: r['row_hash'] as Buffer,
    }));
  } finally {
    client.release();
  }
}

/**
 * The payload bytes the outbox row actually holds, as hex.
 *
 * `§10`'s assertion reads the PERSISTED bytes here and compares them to what the mock
 * observed, so neither side of the comparison comes from the production envelope builder.
 */
export async function persistedPayloadHex(
  control: Pool,
  idempotencyKey: string,
): Promise<string> {
  const client = await control.connect();
  try {
    const result = await client.query<{ hex: string }>(
      `SELECT encode(payload_canonical_bytes, 'hex') AS hex FROM dispatch_outbox
        WHERE company_id = $1 AND idempotency_key = $2`,
      [COMPANY_ID, idempotencyKey],
    );
    const row = result.rows[0];
    if (row === undefined) throw new Error(`no outbox row for ${idempotencyKey}`);
    return row.hex;
  } finally {
    client.release();
  }
}

/** The persisted correlation tag, read with raw SQL. `§11`. */
export async function persistedCorrelationTag(
  control: Pool,
  idempotencyKey: string,
): Promise<string> {
  const client = await control.connect();
  try {
    const result = await client.query<{ correlation_tag: string }>(
      `SELECT correlation_tag FROM dispatch_outbox
        WHERE company_id = $1 AND idempotency_key = $2`,
      [COMPANY_ID, idempotencyKey],
    );
    const row = result.rows[0];
    if (row === undefined) throw new Error(`no outbox row for ${idempotencyKey}`);
    return row.correlation_tag;
  } finally {
    client.release();
  }
}
