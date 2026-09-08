import type { Pool } from '../db/pool.js';
import { recordFindings, type AuditFinding } from './transportCompleteness.js';

/**
 * `I17f(b)` — `ATTESTATION_DIVERGENCE`, EVALUATED FROM THE AUDIT PLANE'S OWN HOLDINGS. S1H.
 *
 * =================================================================================
 * REGISTRY `I17f`, VERBATIM, AND THE CLASSIFICATION MATTERS
 *
 *   "**(b) DETECTOR** (reclassified v1.3, TA-09). An audit-plane `MIRROR_INPUT_STALL` with
 *    no corresponding journaled control-plane `AUDIT_MIRROR_DEGRADED` declaration raises
 *    `ATTESTATION_DIVERGENCE` at CRITICAL."
 *
 * `30 §5.6`: "(b) an audit-observed stall with no journaled control declaration raises
 * `ATTESTATION_DIVERGENCE` at CRITICAL — a **detector**, restated as one in v1.3 **because
 * its violation raises the condition that satisfies it** (TA-09)."
 *
 * A DETECTOR, NOT AN INVARIANT. So this module does not refuse anything and nothing halts
 * on it. It writes a finding. `S1H-test-matrix.md` records that distinction, and
 * `i17f-attestation-divergence.test.ts` asserts that no authority changes when it fires —
 * because an invariant that was implemented as a refusal here would halt the company every
 * time the push path went down, which is the condition it exists to report.
 * =================================================================================
 *
 * =================================================================================
 * WHAT IT CANNOT DISTINGUISH, AND WHY THE FINDING SAYS SO
 *
 * `30 §5.7`, on the declaration's channel:
 *
 *   | Control plane | `AUDIT_MIRROR_DEGRADED` journal row — the declaration itself |
 *   | control → audit, **over the push path whose failure it declares** | **Yes, in both
 *   | directions.** It can be emitted falsely, and **its non-arrival is definitionally
 *   | indistinguishable from the condition it declares.** That indistinguishability is
 *   | `I17f(b)`'s subject and is why (b) is a detector rather than an invariant.
 *
 * So the finding this module writes CLAIMS NO ATTRIBUTION. A control plane that declared
 * honestly and could not push, and a control plane that never declared, produce the same
 * audit-side observation. `§13` of the S1H mandate: "Do not claim incident attribution
 * distinguishes attack from network failure if architecture does not." It does not, the
 * finding's `detail` says it does not, and the test asserts that the detail says it.
 * =================================================================================
 *
 * ---------------------------------------------------------------------------------
 * `I17f(a)` AND `I17f(c)` ARE NOT HERE, AND THE REASON IS THAT THEIR OPERANDS DO NOT EXIST.
 *
 * (a) "No effect carries `DISPATCHED_UNMIRRORED` without a concurrent audit-plane
 *     `MIRROR_INPUT_STALL` interval covering its dispatch timestamp."
 * (c) "Every effect whose dispatch timestamp falls inside an audit-plane-published
 *     `MIRROR_INPUT_STALL` interval carries `DISPATCHED_UNMIRRORED` on its mirrored row."
 *
 * Both quantify over DISPATCHED EFFECTS. S1H dispatches nothing, there is no dispatch
 * timestamp on any row in either database, and no `DISPATCHED_UNMIRRORED` tag exists to
 * find. An evaluator over an empty population would pass vacuously and prove nothing, and
 * `§35` of the S1H mandate forbids the alternative: "do NOT manufacture fake `DISPATCHED`
 * rows merely to claim the invariant closed."
 *
 * So (a) and (c) are OPEN, `S1H-result.md §10` says so clause by clause, and this module
 * implements the one clause whose operands both exist: the published intervals, which the
 * audit plane owns, and the declaration rows, which arrive through the mirror.
 * ---------------------------------------------------------------------------------
 */

export interface DivergenceReport {
  readonly companyId: string;
  /** Intervals this store published. Audit-owned; the control plane cannot write them. */
  readonly publishedIntervals: readonly { intervalId: string; start: Date; end: Date | null }[];
  /** `AUDIT_MIRROR_DEGRADED` rows that REACHED the mirror. Absence is the whole subject. */
  readonly receivedDeclarations: readonly {
    declarationId: string;
    event: string;
    occurredAt: Date;
  }[];
  readonly findings: readonly AuditFinding[];
}

interface IntervalRow {
  readonly interval_id: string;
  readonly interval_start: Date;
  readonly interval_end: Date | null;
}

interface DeclarationRow {
  readonly mirror_declaration_id: string;
  readonly mirror_declaration_event: string;
  readonly occurred_at: Date;
}

/**
 * Evaluate `I17f(b)` at instant `now`.
 *
 * THE MATCHING RULE, and it is deliberately generous to the control plane. An interval is
 * CORROBORATED BY A DECLARATION when an `OPENED` declaration row reached the mirror whose
 * `occurred_at` is not after the interval's end — that is, the control plane declared the
 * condition at some point at or before the interval closed. The generosity is on purpose:
 * `30 §5.4` establishes that the audit plane cannot know the control journal's true maximum,
 * so a declaration row still in flight is indistinguishable from one never written, and a
 * strict "declared before the interval opened" rule would fire on ordinary push latency —
 * which is the crying-wolf failure `30 §5.4` gives as the reason for `k = 3`.
 *
 * `now` is a parameter for the reason `evaluateTransportCompleteness`'s is: `36 §6`'s clock
 * rule makes the evaluating instant an operand, and a bound asserted by sleeping is a bound
 * nobody tests.
 */
export async function evaluateAttestationDivergence(
  audit: Pool,
  companyId: string,
  now: Date,
): Promise<DivergenceReport> {
  const client = await audit.connect();
  let intervals: readonly IntervalRow[];
  let declarations: readonly DeclarationRow[];
  try {
    intervals = (
      await client.query<IntervalRow>(
        `SELECT interval_id, interval_start, interval_end
           FROM audit_mirror_stall_interval
          WHERE company_id = $1 ORDER BY interval_start`,
        [companyId],
      )
    ).rows;
    declarations = (
      await client.query<DeclarationRow>(
        `SELECT mirror_declaration_id, mirror_declaration_event, occurred_at
           FROM audit_journal
          WHERE company_id = $1 AND journal_row_kind = 'AUDIT_MIRROR_DEGRADED'
          ORDER BY journal_seq`,
        [companyId],
      )
    ).rows;
  } finally {
    client.release();
  }

  const findings: AuditFinding[] = [];
  for (const interval of intervals) {
    const end = interval.interval_end ?? now;
    const corroborating = declarations.find(
      (d) => d.mirror_declaration_event === 'OPENED' && d.occurred_at.getTime() <= end.getTime(),
    );
    if (corroborating !== undefined) continue;

    findings.push({
      kind: 'ATTESTATION_DIVERGENCE',
      severity: 'CRITICAL',
      companyId,
      detail: {
        intervalId: interval.interval_id,
        intervalStart: interval.interval_start.toISOString(),
        intervalEnd: interval.interval_end?.toISOString() ?? null,
        receivedDeclarationCount: declarations.length,
        // `30 §5.7`: the declaration travels "over the push path whose failure it declares",
        // and "its non-arrival is definitionally indistinguishable from the condition it
        // declares." The finding therefore states the ambiguity rather than resolving it, and
        // `i17f-attestation-divergence.test.ts` asserts this text is present.
        attribution:
          'NONE. This audit plane published a MIRROR_INPUT_STALL and holds no ' +
          'AUDIT_MIRROR_DEGRADED declaration covering it. A control plane that declared ' +
          'honestly and could not push, and a control plane that never declared, produce ' +
          'this same observation — 30 §5.7 states the indistinguishability and I17f(b) is a ' +
          'DETECTOR for exactly that reason (TA-09).',
        clause: 'I17f(b)',
      },
    });
  }

  return {
    companyId,
    publishedIntervals: intervals.map((i) => ({
      intervalId: i.interval_id,
      start: i.interval_start,
      end: i.interval_end,
    })),
    receivedDeclarations: declarations.map((d) => ({
      declarationId: d.mirror_declaration_id,
      event: d.mirror_declaration_event,
      occurredAt: d.occurred_at,
    })),
    findings,
  };
}

/**
 * Evaluate and persist. Separate, for the reason `recordFindings` is separate from
 * `evaluateTransportCompleteness`: a negative control must be able to assert that NOTHING
 * was produced, and a detector observable only through its side effects makes "produced
 * nothing" indistinguishable from "was not run".
 */
export async function evaluateAndRecordDivergence(
  audit: Pool,
  companyId: string,
  now: Date,
): Promise<DivergenceReport> {
  const report = await evaluateAttestationDivergence(audit, companyId, now);
  await recordFindings(audit, report.findings);
  return report;
}
