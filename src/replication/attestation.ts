import type { Client, Pool } from '../db/pool.js';
import { inTransaction } from '../db/pool.js';

/**
 * `30 §5.4`'s `JournalAttestation`, emitted by the CONTROL plane. S1G.
 *
 * =================================================================================
 * THE DECLARED OPERANDS, AND WHERE EACH COMES FROM
 *
 * `30 §5.4`, and registry `I17e`'s operand block, which declares all three:
 *
 *   attestation_cadence = 5 minutes   CONFIGURED
 *   k                   = 3           CONFIGURED
 *   anchor interval     = 60 minutes  (I17b — NOT implemented at S1G)
 *
 * "k = 3. Three consecutively missed attestations raise `ATTESTATION_STALL`, bounding
 * undetected silence at 15 minutes. k=3 rather than k=1 because a single missed 5-minute
 * push is ordinary network weather."
 *
 * The values are transcribed from `30 §5.4` and NOT from any remediation document.
 * `phase2-v1.3-invariant-registry.md` `I17e` restates them and `30 §5.10` adds the three
 * relationships that bind — the fastest irrecoverable dispatch path, `I17f`'s 15-minute
 * evaluation interval, and `I8`'s sweep cadence — none of which S1G may relax.
 *
 * =================================================================================
 * THE ATTESTATION IS A REAL JOURNAL ROW ON THE REAL CHAIN AND THE REAL PATH
 *
 * `30 §5.4`: "It is itself a journal row, so it is chained, mirrored and anchored like
 * everything else. An attestation that could be pushed outside the chain would be a
 * second unverified channel."
 *
 * So `emit` calls `emit_journal_attestation`, which takes the SAME `journal_counter`
 * under the SAME `FOR UPDATE`, inserts into the SAME `effect_journal`, is chained by the
 * SAME `effect_journal_chain` trigger, and is picked up by the SAME
 * `mirrored_at IS NULL` backlog the authorisation rows use. There is no attestation
 * table, no attestation queue and no attestation endpoint.
 *
 * =================================================================================
 * WHAT THIS IS NOT
 *
 * It is not a scheduler. `emitAttestationIfDue` answers "is one due at this instant, and
 * if so emit it" from AUTHORITATIVE STATE — the last attestation row in the journal —
 * against a clock the caller supplies. Runtime orchestration is `37` S6's audit-plane
 * scheduler and DBOS's business, and building one here to call a five-line primitive
 * would be the general scheduler this slice must not build.
 *
 * A supplied clock is also what lets the S1G suite assert a 15-minute bound without a
 * 15-minute test. `36 §6`'s clock rule puts the authoritative instant on the database;
 * the parameter here is the CALLER's reading of it, and `attestation-cadence.test.ts`
 * asserts the two agree.
 */

/** `30 §5.4`, CONFIGURED. */
export const ATTESTATION_CADENCE_MS = 5 * 60 * 1000;

/** `30 §5.4`, CONFIGURED. Three consecutive misses. */
export const ATTESTATION_K = 3;

/** `k × cadence`. `30 §5.4`: "bounding undetected silence at 15 minutes." */
export const ATTESTATION_STALL_BOUND_MS = ATTESTATION_CADENCE_MS * ATTESTATION_K;

export interface AttestationEmitted {
  readonly emitted: true;
  readonly journalSeq: bigint;
  readonly attestedAt: Date;
}

export interface AttestationNotDue {
  readonly emitted: false;
  readonly lastAttestedAt: Date;
  readonly nextDueAt: Date;
}

export type AttestationOutcome = AttestationEmitted | AttestationNotDue;

async function lastAttestationAt(client: Client, companyId: string): Promise<Date | null> {
  const result = await client.query<{ occurred_at: Date }>(
    `SELECT occurred_at FROM effect_journal
      WHERE company_id = $1 AND journal_row_kind = 'JOURNAL_ATTESTATION'
      ORDER BY journal_seq DESC LIMIT 1`,
    [companyId],
  );
  return result.rows[0]?.occurred_at ?? null;
}

/**
 * Emit one attestation, unconditionally, in its own control transaction.
 *
 * "Emitted whether or not any journal row was produced in the interval — the empty
 * attestation is the entire point."
 */
export async function emitAttestation(
  control: Pool,
  companyId: string,
  attestedAt: Date,
): Promise<bigint> {
  const client = await control.connect();
  try {
    return await inTransaction(client, 'READ COMMITTED', async (tx) => {
      const result = await tx.query<{ emit_journal_attestation: string }>(
        'SELECT emit_journal_attestation($1, $2)',
        [companyId, attestedAt],
      );
      return BigInt(result.rows[0]!.emit_journal_attestation);
    });
  } finally {
    client.release();
  }
}

/**
 * Emit if `attestation_cadence` has elapsed since the last attestation row.
 *
 * A company that has never attested is due immediately: the first attestation is what
 * starts the channel `I17e` measures continuity of, and treating "never" as "not yet due"
 * would make silence indistinguishable from idleness for one cadence — the exact
 * confusion `§5.4` exists to remove.
 */
export async function emitAttestationIfDue(
  control: Pool,
  companyId: string,
  now: Date,
): Promise<AttestationOutcome> {
  const client = await control.connect();
  let last: Date | null;
  try {
    last = await lastAttestationAt(client, companyId);
  } finally {
    client.release();
  }

  if (last !== null) {
    const nextDueAt = new Date(last.getTime() + ATTESTATION_CADENCE_MS);
    if (now.getTime() < nextDueAt.getTime()) {
      return { emitted: false, lastAttestedAt: last, nextDueAt };
    }
  }

  const journalSeq = await emitAttestation(control, companyId, now);
  return { emitted: true, journalSeq, attestedAt: now };
}
