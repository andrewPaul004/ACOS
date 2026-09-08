import { generateKeyPairSync, sign as signEd25519, type KeyObject } from 'node:crypto';

import type { Client, Pool } from '../../src/db/pool.js';
import { createAuditSignalReaderPool } from '../../src/audit/db/auditPool.js';
import { COMPANY_ID } from './fixture.js';
import { createReplicationFixture, type ReplicationFixture } from './replicationFixture.js';
import {
  overrideGrantBytes,
  type OverrideRequest,
} from '../../src/kernel/mirror/degradedModeOverride.js';
import type { SignalWire } from '../../src/kernel/mirror/corroborationSignal.js';
import { SIGNAL_MAX_AGE_MS } from '../../src/kernel/mirror/mirrorState.js';

/**
 * The S1H MIRROR fixture.
 *
 * =================================================================================
 * WHAT IS SEEDED, AND WHERE EACH VALUE COMES FROM
 *
 *   OWNER PRINCIPALS   `26 §3`'s `kind = 'OWNER'`, with real Ed25519 keys in
 *                      `principal_key`. `51 §3.6`'s honest consequence is that MVP
 *                      registers exactly ONE, so the fixture seeds one by default and the
 *                      second-approver tests register a second EXPLICITLY — which keeps
 *                      "overrides 2 and 3 are structurally unavailable" a real default
 *                      rather than a case the fixture papers over.
 *
 *   AN OPEN INCIDENT   `30 §5.7.2`: `incident_ref` is "NOT NULL FK — the open incident it
 *                      responds to". The ACCEPTED S1A `incident` table.
 *
 *   A RETAINED RECORD  `I56`'s `PROCESSOR_DISPUTE_WEBHOOK` kind, so a clock can be created
 *                      by citing it. `§25` of the mandate: "Seed retained authoritative
 *                      RECORD fixtures."
 *
 *   AN AUDIT KEYPAIR   `30 §5.7.1`: "an Ed25519 key generated on and never leaving the
 *                      audit-plane host. The control plane holds only the public key."
 *                      Generated here because `§5.7.1`'s Provisioning note puts real key
 *                      management outside S1. The private half is handed ONLY to
 *                      `src/audit/mirrorInputStall.ts`; the public half ONLY to the
 *                      control-side verifier.
 * =================================================================================
 */

export const OWNER_ONE = 'principal:owner';
export const OWNER_TWO = 'principal:owner-second';
export const NOT_AN_OWNER = 'principal:worker-ai';

/** `30 §5.7.1`'s `audit_instance_id`. An S1H fixture identifier. */
export const AUDIT_INSTANCE_ID = 'audit-instance:s1h-fixture';

export interface Keypair {
  readonly publicKey: KeyObject;
  readonly privateKey: KeyObject;
}

export function newKeypair(): Keypair {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return { publicKey, privateKey };
}

function spki(key: KeyObject): Buffer {
  return key.export({ format: 'der', type: 'spki' });
}

export interface MirrorFixture {
  readonly incidentRef: bigint;
  readonly ownerOne: Keypair;
  /** Registered only when `registerSecondOwner` is called. */
  readonly ownerTwo: Keypair;
  readonly sourceRecordId: string;
}

/**
 * Seed the control-side mirror fixture on top of `loadFixture`.
 *
 * `registerSecondOwner` defaults to FALSE. `51 §3.6`: "at MVP exactly one OWNER-tier
 * principal is registered, so overrides 2 and 3 are **structurally unavailable** until a
 * second approver is registered — which makes the practically available escape 24 hours, 5
 * effects and $50.00." A fixture that registered two by default would hide that.
 */
export async function loadMirrorFixture(
  client: Client,
  options?: { readonly registerSecondOwner?: boolean },
): Promise<MirrorFixture> {
  const ownerOne = newKeypair();
  const ownerTwo = newKeypair();

  await client.query(
    `INSERT INTO principal (company_id, principal_id, kind, role, model_binding, status)
     VALUES ($1, $2, 'OWNER', 'owner', NULL, 'ACTIVE')`,
    [COMPANY_ID, OWNER_ONE],
  );
  await client.query(
    `INSERT INTO principal_key (company_id, principal_id, public_key) VALUES ($1,$2,$3)`,
    [COMPANY_ID, OWNER_ONE, spki(ownerOne.publicKey)],
  );

  // `26 §3`'s `AI_ROLE`. Present so `vc-a2e-override.test.ts` can attempt an override grant
  // as a non-owner and be refused, rather than asserting the refusal against an absent row.
  await client.query(
    `INSERT INTO principal (company_id, principal_id, kind, role, model_binding, status)
     VALUES ($1, $2, 'AI_ROLE', 'support_reasoner', 'model:fixture@1/prompt@1', 'ACTIVE')`,
    [COMPANY_ID, NOT_AN_OWNER],
  );
  await client.query(
    `INSERT INTO principal_key (company_id, principal_id, public_key) VALUES ($1,$2,$3)`,
    [COMPANY_ID, NOT_AN_OWNER, spki(newKeypair().publicKey)],
  );

  if (options?.registerSecondOwner === true) {
    await registerSecondOwner(client, ownerTwo);
  }

  const incident = await client.query<{ incident_id: string }>(
    `INSERT INTO incident (company_id, incident_type, incident_path, severity, detail)
     VALUES ($1, 'AUDIT_MIRROR_DEGRADED', 'SECURITY', 'CRITICAL',
             'S1H fixture: the open incident an override responds to (30 §5.7.2)')
     RETURNING incident_id`,
    [COMPANY_ID],
  );

  const sourceRecordId = 'record:processor-dispute:s1h-1';
  await client.query(
    `INSERT INTO retained_source_record
       (company_id, source_record_id, kind, provenance, content_hash, external_ref,
        received_at)
     VALUES ($1, $2, 'PROCESSOR_DISPUTE_WEBHOOK', 'RECORD', $3,
             'stripe:evt_s1h_fixture_1', '2026-01-01T00:00:00Z')`,
    [COMPANY_ID, sourceRecordId, Buffer.alloc(32, 7)],
  );

  return {
    incidentRef: BigInt(incident.rows[0]!.incident_id),
    ownerOne,
    ownerTwo,
    sourceRecordId,
  };
}

/** Register the second OWNER-tier principal, with a DISTINCT registered key. */
export async function registerSecondOwner(client: Client, ownerTwo: Keypair): Promise<void> {
  await client.query(
    `INSERT INTO principal (company_id, principal_id, kind, role, model_binding, status)
     VALUES ($1, $2, 'OWNER', 'owner-deputy', NULL, 'ACTIVE')`,
    [COMPANY_ID, OWNER_TWO],
  );
  await client.query(
    `INSERT INTO principal_key (company_id, principal_id, public_key) VALUES ($1,$2,$3)`,
    [COMPANY_ID, OWNER_TWO, spki(ownerTwo.publicKey)],
  );
}

/**
 * Register a THIRD principal that shares OWNER_ONE's registered key.
 *
 * `§20` of the mandate: a second approver "cannot be the same credential identity under
 * another display name". This is that attack, and `0009`'s
 * `OVERRIDE_SECOND_APPROVER_SHARES_CREDENTIAL` trigger is what refuses it.
 */
export const OWNER_ALIAS = 'principal:owner-alias';

export async function registerOwnerAlias(client: Client, ownerOne: Keypair): Promise<void> {
  await client.query(
    `INSERT INTO principal (company_id, principal_id, kind, role, model_binding, status)
     VALUES ($1, $2, 'OWNER', 'owner-alias', NULL, 'ACTIVE')`,
    [COMPANY_ID, OWNER_ALIAS],
  );
  await client.query(
    `INSERT INTO principal_key (company_id, principal_id, public_key) VALUES ($1,$2,$3)`,
    [COMPANY_ID, OWNER_ALIAS, spki(ownerOne.publicKey)],
  );
}

/** Sign an override grant as an owner. Real Ed25519 over the grant's `ACOS-JCS-1` bytes. */
export function signGrant(request: OverrideRequest, key: KeyObject): Buffer {
  return signEd25519(null, overrideGrantBytes(request), key);
}

// =====================================================================================
// SIGNAL FIXTURES
// =====================================================================================

/**
 * Build a `SignalWire` and sign it with the given key, over the CONTROL-SIDE construction.
 *
 * =================================================================================
 * WHY THE FIXTURE SIGNER USES THE CONTROL-SIDE BYTE BUILDER, AND WHY THAT IS NOT
 * SELF-VALIDATION.
 *
 * `§39` forbids "testing signature by calling the same signer/verifier function as both
 * oracle sides". The signature MECHANISM's correctness is not what these fixtures test —
 * `corroboration-signal-cross-implementation.test.ts` tests that, against the audit
 * database's independent SQL construction AND a hand-authored fourth reading in
 * `jcs1Oracle.ts`.
 *
 * What these fixtures test is the CONTRACT: what the verifier does with an artifact that is
 * unsigned, wrongly signed, stale, replayed, for another company, or tampered after signing.
 * Every one of those is a property of the verifier's DECISION, and a fixture that could not
 * produce a validly signed artifact could not construct the negative cases at all — a
 * "modified timestamp after signing" fixture needs a signature that was valid before the
 * modification.
 *
 * The genuinely end-to-end path — the audit database canonicalises, the audit process
 * signs, the control plane fetches and verifies against its own construction — is exercised
 * by `vc-a2d-signal-authenticity.test.ts`, which uses `src/audit/mirrorInputStall.ts` and
 * never this helper.
 * =================================================================================
 */
export function signalSignedWith(
  fields: Omit<SignalWire, 'signature'>,
  key: KeyObject,
  bytesOf: (signal: SignalWire) => Buffer,
): SignalWire {
  const unsigned: SignalWire = { ...fields, signature: Buffer.alloc(64) };
  return { ...fields, signature: signEd25519(null, bytesOf(unsigned), key) };
}

/** A well-formed signal at `observedAt`, with `expires_at = observed_at + max_age`. */
export function signalFieldsAt(
  observedAt: Date,
  options?: {
    readonly signalId?: string;
    readonly companyId?: string;
    readonly intervalStart?: Date;
    readonly reason?: SignalWire['reason'];
    readonly lastAttestationSeq?: bigint;
    readonly lastAttestationReceivedAt?: Date | null;
  },
): Omit<SignalWire, 'signature'> {
  return {
    signalId: options?.signalId ?? 'signal:s1h-fixture-1',
    companyId: options?.companyId ?? COMPANY_ID,
    observedAt,
    intervalStart: options?.intervalStart ?? new Date(observedAt.getTime() - 60_000),
    lastAttestationSeq: options?.lastAttestationSeq ?? 42n,
    lastAttestationReceivedAt:
      options?.lastAttestationReceivedAt === undefined
        ? new Date(observedAt.getTime() - 16 * 60_000)
        : options.lastAttestationReceivedAt,
    reason: options?.reason ?? 'ATTESTATION_STALL',
    // `30 §5.7.1`: "`expires_at` — `observed_at + max_age`", `max_age` = 5 minutes.
    expiresAt: new Date(observedAt.getTime() + SIGNAL_MAX_AGE_MS),
    auditInstanceId: AUDIT_INSTANCE_ID,
  };
}

/** Read every journal row of the given kinds, for the journal assertions. */
export async function journalRowsOfKind(
  pool: Pool,
  companyId: string,
  kind: string,
): Promise<
  readonly {
    journalSeq: bigint;
    rowHash: Buffer;
    prevHash: Buffer | null;
    occurredAt: Date;
    declarationId: string | null;
    declarationEvent: string | null;
    observedReason: string | null;
    signalId: string | null;
    overrideId: string | null;
    overrideEvent: string | null;
    overrideActor: string | null;
    intervalStart: Date | null;
    observedAt: Date | null;
    expiresAt: Date | null;
    reason: string | null;
  }[]
> {
  const client = await pool.connect();
  try {
    const result = await client.query<Record<string, unknown>>(
      `SELECT journal_seq, row_hash, prev_hash, occurred_at,
              mirror_declaration_id, mirror_declaration_event, mirror_observed_reason,
              corroboration_signal_id, corroboration_interval_start,
              corroboration_observed_at, corroboration_expires_at, corroboration_reason,
              override_id, override_event, override_actor
         FROM effect_journal
        WHERE company_id = $1 AND journal_row_kind = $2
        ORDER BY journal_seq`,
      [companyId, kind],
    );
    return result.rows.map((r) => ({
      journalSeq: BigInt(r['journal_seq'] as string),
      rowHash: r['row_hash'] as Buffer,
      prevHash: r['prev_hash'] as Buffer | null,
      occurredAt: r['occurred_at'] as Date,
      declarationId: r['mirror_declaration_id'] as string | null,
      declarationEvent: r['mirror_declaration_event'] as string | null,
      observedReason: r['mirror_observed_reason'] as string | null,
      signalId: r['corroboration_signal_id'] as string | null,
      overrideId: r['override_id'] as string | null,
      overrideEvent: r['override_event'] as string | null,
      overrideActor: r['override_actor'] as string | null,
      intervalStart: r['corroboration_interval_start'] as Date | null,
      observedAt: r['corroboration_observed_at'] as Date | null,
      expiresAt: r['corroboration_expires_at'] as Date | null,
      reason: r['corroboration_reason'] as string | null,
    }));
  } finally {
    client.release();
  }
}

// =====================================================================================
// THE DUAL-PLANE MIRROR HARNESS
// =====================================================================================

/**
 * `createReplicationFixture` plus the S1H control-side seed and an audit-plane keypair.
 *
 * TWO REAL POSTGRESQL SERVERS, as S1G established, and `plane-independence.test.ts`
 * asserts the distinctness against `pg_control_system()` rather than against two URL
 * strings. `A0001`'s own note still stands and is not weakened here: two containers on one
 * machine are NOT `30 §5`'s "different provider or, at minimum, a separate account with a
 * separate payment method and separate operator credentials", and `S1H-result.md` reports
 * that leg OPEN exactly as `S1G-result.md` did.
 */
export interface MirrorHarness {
  readonly replication: ReplicationFixture;
  readonly control: Pool;
  readonly auditOwner: Pool;
  readonly auditEvaluator: Pool;
  readonly auditReader: Pool;
  readonly auditKey: Keypair;
  seed: MirrorFixture;
  reset(options?: { readonly registerSecondOwner?: boolean }): Promise<void>;
  close(): Promise<void>;
}

export async function createMirrorHarness(): Promise<MirrorHarness> {
  const replication = await createReplicationFixture();
  const readerPool = createAuditSignalReaderPool();
  const auditKey = newKeypair();
  let seed: MirrorFixture | null = null;

  const harness: MirrorHarness = {
    replication,
    control: replication.control.pool,
    auditOwner: replication.audit.owner,
    auditEvaluator: replication.audit.evaluator,
    auditReader: readerPool,
    auditKey,
    get seed(): MirrorFixture {
      if (seed === null) throw new Error('call reset() before reading the seed');
      return seed;
    },
    set seed(value: MirrorFixture) {
      seed = value;
    },
    async reset(options?: { readonly registerSecondOwner?: boolean }) {
      await replication.reset();
      const client = await replication.control.connect();
      try {
        seed = await loadMirrorFixture(client, options);
      } finally {
        client.release();
      }
    },
    async close() {
      await readerPool.end();
      await replication.close();
    },
  };
  return harness;
}
