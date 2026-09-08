import type { Pool } from '../db/pool.js';
import type { CorroborationReason } from '../kernel/mirror/mirrorState.js';
import type { SignalWire } from '../kernel/mirror/corroborationSignal.js';
import type {
  CorroborationSignalSource,
  SignalFetch,
} from '../kernel/mirror/signalSource.js';

/**
 * `30 §5.7.1` — THE FETCH, CONTROL SIDE. S1H.
 *
 * =================================================================================
 * WHY THIS FILE IS IN `src/replication/` AND NOT IN `src/kernel/mirror/`
 *
 * `src/replication/journalPusher.ts` is the control plane's WRITE direction into the audit
 * plane. This is its READ direction. Both are cross-plane transport owned by the control
 * plane, both hold an audit-store credential, and `local-authorisation-boundary.test.ts`
 * already exempts this directory from the "no audit-plane connection outside src/audit and
 * src/replication" rule for exactly that reason.
 *
 * The kernel declares the PORT (`src/kernel/mirror/signalSource.ts`) and this file is the
 * ADAPTER, which is the layering `src/kernel/canonicalisation/ports/reservationHandoff.ts`
 * established: the state machine cannot name a connection, and a test can substitute a
 * partition without patching a module.
 * =================================================================================
 *
 * =================================================================================
 * WHAT IS BUILT AND WHAT IS NOT, STATED PRECISELY.
 *
 * `30 §5.7.1` declares an HTTPS `GET /audit/v1/mirror-input-stall?company_id=…` on the
 * audit plane's own host, authenticated with a read-only bearer credential scoped to that
 * endpoint. The repository harness provisions two PostgreSQL servers; it does not
 * provision an HTTPS host, a TLS certificate or a bearer-token issuer, and `§5.7.1`'s
 * Provisioning note puts the endpoint outside the S1 build: "The signing key and the read
 * endpoint are part of audit separation, not part of the S1 build, and `62 §7` authorises
 * provisioning them now."
 *
 * SO THE HTTP ENDPOINT IS NOT BUILT AND `S1H-result.md §5` REPORTS IT OPEN.
 *
 * WHAT IS BUILT is every property of the path that the S1 gate turns on, because `37` S1
 * requires "the corroboration-signal contract INCLUDING THE REACHABILITY ASSERTIONS
 * (VC-A2d)":
 *
 *   PULL ONLY            one method, and it reads. The audit plane never initiates.
 *   A DISTINCT CREDENTIAL `acos_audit_signal_reader`, not the replication role.
 *   NO WRITE PATH        that role holds SELECT on two tables and nothing else (`A0002`).
 *   A SEVERABLE PATH     it is a connection to the audit server, so a partition is a real
 *                        partition rather than a mocked branch.
 *   FAIL CLOSED          every failure returns `UNAVAILABLE`, and nothing here throws.
 * =================================================================================
 */

interface SignalRow {
  readonly signal_id: string;
  readonly company_id: string;
  readonly observed_at: Date;
  readonly interval_start: Date;
  readonly last_attestation_seq: string;
  readonly last_attestation_received_at: Date | null;
  readonly reason: string;
  readonly expires_at: Date;
  readonly audit_instance_id: string;
  readonly signature: Buffer;
}

/**
 * `GET /audit/v1/mirror-input-stall?company_id=…`, as the read this harness can perform.
 *
 * `signed_bytes` IS DELIBERATELY NOT SELECTED. `30 §5.7.1` says the signature is "over
 * `ACOS-JCS-1` canonical bytes of the fields above", and `corroborationSignal.ts` builds
 * those bytes on this side from the structured fields. Fetching the audit plane's own byte
 * string and verifying against it would verify a signature over the signer's assertion
 * rather than over the fields — the same defect `30 §5.9` names one level up.
 *
 * The ordering takes the NEWEST issuance. `§5.7.1`, Issuance: the signal is "re-issued
 * every `attestation_cadence` (5 minutes) for as long as the condition holds, each issuance
 * carrying a fresh `signal_id` and `observed_at`", so the newest is the one that can be
 * fresh. An older issuance of the same interval is a replay candidate and the freshness rule
 * plus `mirror_corroboration`'s uniqueness refuse it.
 */
const FETCH_SQL = `
  SELECT signal_id, company_id, observed_at, interval_start,
         last_attestation_seq, last_attestation_received_at,
         reason, expires_at, audit_instance_id, signature
    FROM audit_mirror_input_stall_signal
   WHERE company_id = $1
   ORDER BY observed_at DESC, signal_id DESC
   LIMIT 1`;

/**
 * The pull client.
 *
 * `pool` must be built from `auditSignalReaderUrl()`. The type cannot enforce which role a
 * pool authenticated as, so `audit-signal-ownership.test.ts` asserts the property where it
 * is real — at the database, by attempting every write as that role — rather than here,
 * where it could only be a comment.
 */
export function postgresCorroborationSource(pool: Pool): CorroborationSignalSource {
  return {
    async fetchCurrent(companyId: string): Promise<SignalFetch> {
      try {
        const client = await pool.connect();
        try {
          const result = await client.query<SignalRow>(FETCH_SQL, [companyId]);
          const row = result.rows[0];
          if (row === undefined) return { kind: 'NONE' };
          return { kind: 'SIGNAL', signal: toWire(row) };
        } finally {
          client.release();
        }
      } catch (error) {
        // `30 §5.6`: in a partition, an audit-store outage or an audit-host outage,
        // `CORROBORATED_DEGRADED` is UNREACHABLE. This is the only place that decision is
        // taken, and it is taken by returning a value rather than by throwing — a thrown
        // error would let a caller's `catch` choose what an unreachable audit plane means.
        return {
          kind: 'UNAVAILABLE',
          detail: `the audit plane's read path is unreachable: ${String(error)}`,
        };
      }
    },
  };
}

/**
 * Row → wire. No canonicalisation, no verification, no interpretation.
 *
 * BIGINT arrives as a string (`src/db/pool.ts` asserts that `pg` does not parse it to a
 * number) and becomes a `bigint`. `reason` is carried across as the declared enum WITHOUT
 * being validated here: `verifyCorroborationSignal` refuses an undeclared reason with
 * `SIGNAL_REASON_UNDECLARED`, and validating in two places would let a future edit relax
 * one of them while the other kept the test green.
 */
function toWire(row: SignalRow): SignalWire {
  return {
    signalId: row.signal_id,
    companyId: row.company_id,
    observedAt: row.observed_at,
    intervalStart: row.interval_start,
    lastAttestationSeq: BigInt(row.last_attestation_seq),
    lastAttestationReceivedAt: row.last_attestation_received_at,
    reason: row.reason as CorroborationReason,
    expiresAt: row.expires_at,
    auditInstanceId: row.audit_instance_id,
    signature: row.signature,
  };
}

/**
 * The severed path, as a source. `30 §5.6` row 1: "Network partition between the planes |
 * [audit can observe] Yes | [can publish] Yes | [control can fetch] **No — the fetch path
 * is the severed path** | `CORROBORATED_DEGRADED` reachable? **No.** Stays
 * `UNCORROBORATED_STALL`".
 *
 * Exported from `src/` rather than written in a test file because `VC-A2d` requires
 * asserting the reachability table DIRECTLY, and the partition case must be the same code
 * path production takes when a connection fails — not a test double that returns a
 * different shape. `signal-transport-fail-closed.test.ts` also exercises the real thing, by
 * pointing a real pool at a closed port; this exists so the partition can additionally be
 * injected at a chosen instant without waiting for a TCP timeout.
 */
export function partitionedCorroborationSource(detail: string): CorroborationSignalSource {
  return {
    fetchCurrent(): Promise<SignalFetch> {
      return Promise.resolve({ kind: 'UNAVAILABLE', detail });
    },
  };
}
