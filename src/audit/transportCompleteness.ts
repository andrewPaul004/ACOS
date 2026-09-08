import type { Client, Pool } from '../db/pool.js';

/**
 * `I17` and `I17e`, evaluated FROM THE AUDIT PLANE'S OWN HOLDINGS. S1G.
 *
 * =================================================================================
 * THE CLAIM THIS MODULE IS PERMITTED TO MAKE, IN THE ARCHITECTURE'S OWN WORDS
 *
 * `I17` — TRANSPORT completeness, and the word is load-bearing:
 *
 *   "For every `journal_seq` the audit store holds there is exactly one audit row whose
 *    `row_hash` matches the transmitted canonical bytes; the audit store's `journal_seq`
 *    set is gap-free per company; and the set is consistent with the latest received
 *    `JournalAttestation` — its `max_journal_seq` and `count(DISTINCT journal_seq)` agree
 *    with the audit store's holdings."
 *
 * `I17e` — and note what its own text refuses to claim:
 *
 *   "Continuity of the attestation channel, and internal consistency and completeness of
 *    the latest attested prefix. [...] THIS INVARIANT DOES NOT ASSERT THAT
 *    `max_journal_seq` EQUALS THE TRUE CONTROL-JOURNAL MAXIMUM, AND IT CANNOT."
 *
 * `30 §5.9`: "Does not prove completeness. Omission leaves no trace." And `§5.5` case 2b:
 * a control plane that suppresses rows AND freezes its attested prefix to match is "not
 * detectable by any transport check", ever. `vc-a1d-adversarial-attester.test.ts` is the
 * MANDATORY negative control that proves this module stays silent in that case, and a run
 * in which it fires is a test failure.
 *
 * =================================================================================
 * NO CONTROL-DATABASE READ. THE PARAMETER IS AN AUDIT POOL AND THERE IS NO SECOND ONE.
 *
 * `24 §3` K11's declared inputs contain no control-database read, and `30 §5.4` states
 * why the audit plane "by construction cannot" have one: "R10 removed the replica
 * deliberately."
 *
 * Every operand below comes from `audit_journal` — rows this store received and
 * independently verified — and from the attestation rows inside it. Nothing here knows
 * the control journal's true maximum, its head, its `mirrored_at`, or whether an effect
 * exists. `plane-independence.test.ts` runs this evaluator with the control database
 * unreachable and asserts every check still works.
 * =================================================================================
 */

/**
 * The declared bound, restated on the audit side so the evaluator does not import a
 * control-plane module to learn it.
 *
 * `30 §5.4`: `attestation_cadence = 5 minutes`, `k = 3`. The two planes agree on the
 * value because both transcribe `30 §5.4`, not because one reads the other, and
 * `plane-independence.test.ts` asserts the equality as a property of the two constants.
 */
export const ATTESTATION_STALL_BOUND_MS = 15 * 60 * 1000;

/**
 * The findings the audit plane's detectors can produce. `24 §3` K11 owns all of them.
 *
 * S1G declared the first three. S1H adds `ATTESTATION_DIVERGENCE`, registry `I17f(b)`'s
 * detector, written by `attestationDivergence.ts`. The union lives here rather than beside
 * that module because `recordFindings` is the single write path to `audit_incident` and a
 * second `AuditFinding` shape would be a second write path.
 */
export type AuditFindingKind =
  | 'AUDIT_COMPLETENESS_GAP'
  | 'ATTESTATION_INCONSISTENT'
  | 'ATTESTATION_STALL'
  | 'ATTESTATION_DIVERGENCE';

export interface AuditFinding {
  readonly kind: AuditFindingKind;
  readonly severity: 'INFO' | 'CRITICAL';
  readonly companyId: string;
  readonly detail: Readonly<Record<string, unknown>>;
}

export interface TransportCompletenessReport {
  readonly companyId: string;
  /** Every `journal_seq` this store holds, ascending. Audit-side truth, nothing else. */
  readonly heldSequences: readonly bigint[];
  /** Sequences absent from `1..max(held)`. `30 §5.5` case 1's detector. */
  readonly gaps: readonly bigint[];
  readonly latestAttestation: HeldAttestation | null;
  readonly findings: readonly AuditFinding[];
}

export interface HeldAttestation {
  readonly journalSeq: bigint;
  readonly attestedMaxJournalSeq: bigint;
  readonly attestedRowCount: bigint;
  readonly attestedHeadHash: Buffer;
  readonly attestedAt: Date;
}

interface HoldingRow {
  readonly journal_seq: string;
  readonly journal_row_kind: string;
  readonly claimed_row_hash: Buffer;
  readonly attested_max_journal_seq: string | null;
  readonly attested_row_count: string | null;
  readonly attested_head_hash: Buffer | null;
  readonly occurred_at: Date;
}

async function readHoldings(client: Client, companyId: string): Promise<readonly HoldingRow[]> {
  const result = await client.query<HoldingRow>(
    `SELECT journal_seq, journal_row_kind, claimed_row_hash,
            attested_max_journal_seq, attested_row_count, attested_head_hash, occurred_at
       FROM audit_journal
      WHERE company_id = $1
      ORDER BY journal_seq`,
    [companyId],
  );
  return result.rows;
}

/**
 * Evaluate `I17` and `I17e` at instant `now`.
 *
 * `now` is a parameter because `36 §6`'s clock rule makes the evaluating instant an
 * operand, and because a 15-minute bound asserted by a 15-minute sleep is a test that
 * nobody runs. The controlled clock changes nothing about the check: the same comparison
 * against the same holdings.
 */
export async function evaluateTransportCompleteness(
  audit: Pool,
  companyId: string,
  now: Date,
): Promise<TransportCompletenessReport> {
  const client = await audit.connect();
  let holdings: readonly HoldingRow[];
  try {
    holdings = await readHoldings(client, companyId);
  } finally {
    client.release();
  }

  const heldSequences = holdings.map((r) => BigInt(r.journal_seq));
  const held = new Set(heldSequences.map(String));
  const findings: AuditFinding[] = [];

  // ------------------------------------------------------------------------------
  // `I17` — gap-freedom over what this store holds.
  //
  // `30 §5.1`: "What replaces [cross-database atomicity] is a gap-free local sequence the
  // audit store can prove it has all of. A missing `journal_seq` has exactly one
  // interpretation." `§5.5` case 1: the store receives 1, 2, 4 and 3 is the finding.
  //
  // The scan runs to `max(held)` and NOT past it, because past it there is nothing to
  // compare against — a tail this store has not received is indistinguishable from a
  // control journal that has not advanced, and `§5.4` is explicit that the audit plane has
  // no independent reading of the true maximum. THE TAIL IS THE ATTESTATION'S JOB, below.
  // ------------------------------------------------------------------------------
  const gaps: bigint[] = [];
  if (heldSequences.length > 0) {
    const max = heldSequences[heldSequences.length - 1]!;
    for (let s = 1n; s <= max; s += 1n) {
      if (!held.has(s.toString())) gaps.push(s);
    }
  }
  if (gaps.length > 0) {
    findings.push({
      kind: 'AUDIT_COMPLETENESS_GAP',
      severity: 'CRITICAL',
      companyId,
      detail: {
        missing: gaps.map(String),
        reason: 'a missing journal_seq below the highest held sequence (30 §5.1)',
      },
    });
  }

  // ------------------------------------------------------------------------------
  // `I17e` — the attestation channel, and the latest attested prefix.
  // ------------------------------------------------------------------------------
  const attestations = holdings.filter((r) => r.journal_row_kind === 'JOURNAL_ATTESTATION');
  const latest = attestations[attestations.length - 1];
  const latestAttestation: HeldAttestation | null =
    latest === undefined
      ? null
      : {
          journalSeq: BigInt(latest.journal_seq),
          attestedMaxJournalSeq: BigInt(latest.attested_max_journal_seq!),
          attestedRowCount: BigInt(latest.attested_row_count!),
          attestedHeadHash: latest.attested_head_hash!,
          attestedAt: latest.occurred_at,
        };

  if (latestAttestation !== null) {
    // "for every attestation received, the audit plane verifies every
    //  `journal_seq ≤ max_journal_seq` is present" — the TAIL check, and the one that
    //  catches `§5.5` case 2a: an honest attester reporting a maximum this store has not
    //  received in full.
    const missingBelowAttested: bigint[] = [];
    for (let s = 1n; s <= latestAttestation.attestedMaxJournalSeq; s += 1n) {
      if (!held.has(s.toString())) missingBelowAttested.push(s);
    }

    // "`row_count` agrees" — `count(DISTINCT journal_seq)`, per `30 §5.2`, so a benign
    // re-push cannot make an honest attester look like a liar.
    const heldAtOrBelow = heldSequences.filter(
      (s) => s <= latestAttestation.attestedMaxJournalSeq,
    ).length;

    // "and the independently recomputed `head_hash` matches".
    //
    // The head is the row this store holds at the attested maximum, and the hash compared
    // is the one THIS STORE computed for that row at ingest — `audit_journal_chain`
    // refused it unless the store's own canonicalisation of the structured fields produced
    // it. So this comparison is against an independently recomputed value, not against a
    // number the control plane sent for this purpose.
    const headRow = holdings.find(
      (r) => BigInt(r.journal_seq) === latestAttestation.attestedMaxJournalSeq,
    );
    const headMatches =
      latestAttestation.attestedMaxJournalSeq === 0n
        ? latestAttestation.attestedHeadHash.every((b) => b === 0)
        : headRow !== undefined &&
          headRow.claimed_row_hash.equals(latestAttestation.attestedHeadHash);

    if (
      missingBelowAttested.length > 0 ||
      BigInt(heldAtOrBelow) !== latestAttestation.attestedRowCount ||
      !headMatches
    ) {
      findings.push({
        kind: 'ATTESTATION_INCONSISTENT',
        severity: 'CRITICAL',
        companyId,
        detail: {
          attestedMaxJournalSeq: latestAttestation.attestedMaxJournalSeq.toString(),
          attestedRowCount: latestAttestation.attestedRowCount.toString(),
          heldRowCountAtOrBelowAttestedMax: heldAtOrBelow,
          missingBelowAttestedMax: missingBelowAttested.map(String),
          headHashMatches: headMatches,
        },
      });
    }
  }

  // ------------------------------------------------------------------------------
  // `ATTESTATION_STALL` — `k × cadence` since the newest attestation THIS STORE RECEIVED.
  //
  // `30 §5.4`: "Three consecutively missed attestations raise `ATTESTATION_STALL`,
  // bounding undetected silence at 15 minutes." `30 §5.7`, on why this one cannot be
  // forged: "Absence of expected attestations (k=3) | audit-internal observation | No. It
  // is an absence observed by the other party."
  //
  // A company with no attestation at all is NOT stalled — there is no channel to have
  // stopped, and firing here would raise a critical finding on every store from the moment
  // it is created.
  // ------------------------------------------------------------------------------
  if (latestAttestation !== null) {
    const elapsed = now.getTime() - latestAttestation.attestedAt.getTime();
    if (elapsed > ATTESTATION_STALL_BOUND_MS) {
      findings.push({
        kind: 'ATTESTATION_STALL',
        severity: 'CRITICAL',
        companyId,
        detail: {
          lastAttestedAt: latestAttestation.attestedAt.toISOString(),
          elapsedMs: elapsed,
          boundMs: ATTESTATION_STALL_BOUND_MS,
        },
      });
    }
  }

  return { companyId, heldSequences, gaps, latestAttestation, findings };
}

/**
 * Persist findings as audit-plane incidents.
 *
 * Separate from evaluation so a caller can evaluate without writing, which is what the
 * negative controls need: `VC-A1d` asserts that NOTHING is produced, and a detector that
 * could only be observed through its side effects would make "produced nothing" hard to
 * distinguish from "was not run".
 *
 * The connection must be the EVALUATOR's. The replication principal holds nothing at all
 * on `audit_incident`, so the control plane cannot write a finding about itself, cannot
 * read one, and cannot delete one.
 */
export async function recordFindings(
  audit: Pool,
  findings: readonly AuditFinding[],
): Promise<number> {
  if (findings.length === 0) return 0;
  const client = await audit.connect();
  try {
    let written = 0;
    for (const finding of findings) {
      await client.query(
        `INSERT INTO audit_incident (company_id, kind, severity, detail)
         VALUES ($1, $2, $3, $4)`,
        [finding.companyId, finding.kind, finding.severity, JSON.stringify(finding.detail)],
      );
      written += 1;
    }
    return written;
  } finally {
    client.release();
  }
}
