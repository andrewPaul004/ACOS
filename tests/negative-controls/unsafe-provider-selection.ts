import type {
  CapabilityFinding,
  ProviderCapabilityRecord,
  RequiredCapability,
} from '../../tools/provider-selection/capabilityRecord.js';

/**
 * S1O VULNERABLE CONTROLS 10–12 — PROVIDER SELECTION.
 *
 * **TEST-ONLY. NOTHING HERE IS PRODUCTION CODE.**
 *
 * =================================================================================
 * `§29` OF THE S1O MANDATE, ITEMS 10–12
 *
 *   10. provider selected despite audit key carrying send scope
 *   11. provider selected without query evidence
 *   12. provider selected from marketing text rather than official capability evidence
 *
 * These three are different in kind from controls 1–9. Those are defects in RUNNING CODE;
 * these are defects in a DECISION, and the thing that makes a decision auditable is that its
 * inputs are typed and its rule is a function rather than a paragraph. That is why
 * `capabilityRecord.ts` carries `blockingFindings` and `selectProvider` at all: a selection
 * rule written only in prose cannot have a negative control.
 * =================================================================================
 */

/**
 * CONTROL 10 — A PROVIDER SELECTED DESPITE AN AUDIT KEY THAT CAN SEND.
 *
 * =================================================================================
 * WHY THIS IS THE DEFECT S1M ALREADY FOUND, ARRIVING A SECOND TIME
 *
 * S1M's blocker C, verbatim from `S1M-result.md`: "Postmark publishes no read-only API
 * credential, so `36 §13`'s replica-read test is unsatisfiable and `48 §2` row 13's
 * read-only exemption is not earned."
 *
 * The tempting move is to select anyway and record the gap — the provider is otherwise
 * excellent, the query works, the correlation works, and the missing property is one test
 * rather than a feature. **`§26` forbids exactly that**: "Do NOT weaken `I8` / `36 §13`."
 *
 * This function implements the tempting move as a rule: it treats an audit credential's
 * send capability as a note rather than a disqualifier. The discrimination is that it
 * SELECTS a record whose `AUDIT_READ_ONLY_CREDENTIAL` finding is `ABSENT`, and production's
 * `blockingFindings` reports that finding and `selectProvider` returns `null`.
 * =================================================================================
 */
export function unsafeSelectIgnoringAuditWriteCapability(
  records: readonly ProviderCapabilityRecord[],
): ProviderCapabilityRecord | null {
  const IGNORED: RequiredCapability = 'AUDIT_READ_ONLY_CREDENTIAL';
  for (const record of records) {
    const byCapability = new Map(record.findings.map((f) => [f.capability, f] as const));
    const blocking = [...byCapability.values()].filter(
      // THE VIOLATION: the audit credential's independence is downgraded to an advisory.
      (finding) => finding.capability !== IGNORED && finding.status !== 'DOCUMENTED',
    );
    if (blocking.length === 0) return record;
  }
  return null;
}

/**
 * CONTROL 11 — A PROVIDER SELECTED WITHOUT QUERY EVIDENCE.
 *
 * =================================================================================
 * WHY A MISSING ROW IS THE SHAPE THIS TAKES
 *
 * `§19` is a CONJUNCTION over a closed list, and the way a conjunction fails silently is
 * that one of its terms is never evaluated. A selection rule written as "reject any finding
 * whose status is not DOCUMENTED" looks complete and is not: a capability with NO FINDING AT
 * ALL passes, because there is nothing to reject.
 *
 * That is not a contrived defect. It is what happens when a capability record is written
 * before a capability is investigated and the row is added "later".
 *
 * Production's `blockingFindings` iterates `REQUIRED_CAPABILITIES` — the closed list — and
 * synthesises an `UNRESOLVED` finding for a capability with no row. This one iterates the
 * findings that happen to be present.
 * =================================================================================
 */
export function unsafeSelectOverPresentFindingsOnly(
  records: readonly ProviderCapabilityRecord[],
): ProviderCapabilityRecord | null {
  for (const record of records) {
    // THE VIOLATION: the iteration is over what was RECORDED, not over what is REQUIRED.
    const blocking = record.findings.filter((finding) => finding.status !== 'DOCUMENTED');
    if (blocking.length === 0) return record;
  }
  return null;
}

/**
 * CONTROL 12 — A PROVIDER SELECTED FROM MARKETING TEXT.
 *
 * =================================================================================
 * `§25`'s ONE-LINE PROHIBITION, AND WHY IT NEEDS A MECHANISM
 *
 * `§25`: "**No marketing prose.**" `§18`: the review must use "OFFICIAL provider
 * documentation". `§24`: "If provider docs leave a load-bearing permission ambiguous: S1O
 * returns PARTIAL rather than guessing."
 *
 * A record can satisfy every structural check and still rest on a vendor's landing page,
 * because a landing page will say a provider offers granular API keys and detailed analytics
 * — both true, neither a statement about which scopes exist or which endpoint a role reaches.
 *
 * This function accepts a finding whose `reference` is any URL at all. Production's control
 * is the `basis`/`reference` pair plus `capability-record.test.ts`'s assertion that every
 * reference is an official developer-documentation path, and the discrimination is a record
 * citing a marketing page: this one selects it, production's assertion rejects it.
 *
 * **AND THE HARDER HALF, STATED HONESTLY.** No code can tell a documentation URL from a
 * marketing one in general. What this control discriminates is the SHAPE — a reference that
 * is not under the provider's documented developer path — and the rest is a reviewer's job.
 * `capabilityRecord.ts` makes that job possible by keeping `basis`, `reference` and
 * `evidence` on every row instead of collapsing them into a verdict.
 * =================================================================================
 */
export function unsafeAcceptsAnyReference(finding: CapabilityFinding): boolean {
  // THE VIOLATION: any non-empty reference counts as evidence.
  return finding.reference.length > 0;
}

/** A record that is complete except for the audit credential. `§26`'s Postmark shape. */
export function recordWithSendCapableAuditKey(
  base: ProviderCapabilityRecord,
): ProviderCapabilityRecord {
  return {
    ...base,
    provider: 'synthetic_send_capable_audit',
    auditReadCredentialScope: { ...base.auditReadCredentialScope, sendCapable: true },
    findings: base.findings.map((finding) =>
      finding.capability === 'AUDIT_READ_ONLY_CREDENTIAL'
        ? {
            ...finding,
            status: 'ABSENT' as const,
            evidence:
              'every API credential able to read the required message log is also able to ' +
              'submit a send',
          }
        : finding,
    ),
  };
}

/** A record with the query-evidence row simply absent. Control 11's input. */
export function recordWithMissingQueryFinding(
  base: ProviderCapabilityRecord,
): ProviderCapabilityRecord {
  return {
    ...base,
    provider: 'synthetic_no_query_row',
    findings: base.findings.filter(
      (finding) => finding.capability !== 'QUERYABLE_PROVIDER_EVIDENCE',
    ),
  };
}
