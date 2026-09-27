import {
  REQUIRED_CAPABILITIES,
  type CapabilityFinding,
  type ProviderCapabilityRecord,
  type RequiredCapability,
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

/* ================================================================================
 * S1O CORRECTION — VULNERABLE CONTROLS 16 AND 17
 *
 * Both are defects the FIRST S1O CANDIDATE ACTUALLY HAD. That is worth stating plainly:
 * these are not hypothetical unsafe implementations invented to give the production rule
 * something to beat, they are the code that was written and the record that was recorded,
 * preserved so the corrected rule has a real thing to discriminate against.
 * ============================================================================== */

/**
 * CONTROL 16 — A PROVIDER SELECTED ON CAPABILITIES THAT DO NOT COMPOSE.
 *
 * =================================================================================
 * THE CONJUNCTION IS TRUE AND THE SYSTEM DOES NOT WORK
 *
 * `§19` lists five capabilities and the original rule checked each independently. Each term
 * may be true of a DIFFERENT configuration of the same provider:
 *
 *     NON_PRODUCTION_TEST_PATH     "the provider has a sandbox mode"          true
 *     QUERYABLE_PROVIDER_EVIDENCE  "the provider has an activity query API"   true
 *     conjunction                                                             true
 *     the sandbox mode             documented to generate NO activity events
 *
 * A provider can therefore pass on the strength of two facts that never hold at the same
 * time, and the `I36` oracle has no environment to run in. `36 §7`'s requirement that vendor
 * properties be MEASURED against a sandbox is unsatisfiable when the sandbox is the thing
 * that removes the measurement.
 *
 * This function is the original rule, preserved: it takes the five findings and asks nothing
 * about whether the declared test path can carry the declared evidence. Production's
 * `isSelectable` applies `evidencePathIncompatibility` as well, and the discrimination is a
 * record whose sandbox is `producesQueryableActivity: false` AND whose validation path
 * enables it: this one selects it, production refuses that path.
 * =================================================================================
 */
export function unsafeSelectOnIndependentCapabilities(
  records: readonly ProviderCapabilityRecord[],
): ProviderCapabilityRecord | null {
  for (const record of records) {
    const byCapability = new Map(record.findings.map((f) => [f.capability, f] as const));
    // THE VIOLATION: five independent lookups, and no question about whether the path the
    // fifth one names can produce the evidence the fourth one describes.
    const allDocumented = REQUIRED_CAPABILITIES.every(
      (capability) => byCapability.get(capability)?.status === 'DOCUMENTED',
    );
    if (allDocumented) return record;
  }
  return null;
}

/**
 * A record whose safe test mode is documented to suppress its own evidence surface.
 *
 * SendGrid's real shape before the correction was applied — five `DOCUMENTED` findings, an
 * activity API, and a sandbox mode that generates no Email Activity — with the validation
 * path still pointed at that sandbox. Control 16's input.
 */
export function recordWhoseSandboxSuppressesEvidence(
  base: ProviderCapabilityRecord,
): ProviderCapabilityRecord {
  return {
    ...base,
    provider: 'synthetic_evidence_suppressing_sandbox',
    sandbox: { ...base.sandbox, producesQueryableActivity: false },
    nonProductionValidationPath: {
      ...base.nonProductionValidationPath,
      mechanism: 'the provider sandbox flag',
      sandboxModeEnabled: true,
      producesQueryableActivity: false,
    },
  };
}

/**
 * CONTROL 17 — A DOCUMENTED NEGATIVE CARRIED AS AN OPEN QUESTION.
 *
 * =================================================================================
 * `null` IS NOT A NEUTRAL ANSWER WHEN THE DOCUMENTATION HAS ONE
 *
 * `CAPABILITY_STATUSES` keeps `ABSENT` and `UNRESOLVED` apart deliberately, because
 * collapsing them is the guess `§24` forbids. The first S1O candidate made the OPPOSITE
 * error on the sandbox row: it recorded `producesQueryableActivity: null` and carried
 * "whether a sandbox-mode send produces a queryable Email Activity record" as an
 * account-validation item, when the official Sandbox Mode page states the negative outright.
 *
 * **AN UNRESOLVED ITEM NOBODY CAN CLOSE IS WORSE THAN A WRONG ONE.** It postpones a decision
 * that has already been made, it leaves the evidence-compatibility question unanswerable, and
 * it let the readiness token describe a sandbox environment that cannot produce evidence.
 *
 * This function is the optimistic reading: `null` is treated as "not yet a problem", so a
 * record carrying it is admitted and its pending list is presented as ordinary account work.
 * Production's `evidencePathIncompatibility` refuses `null` explicitly — an unresolved
 * evidence path is not an established one — and the corrected SendGrid record carries
 * `false` with the documentation reference and moves the item into
 * `resolvedDocumentedNegatives`.
 * =================================================================================
 */
export function unsafeTreatsNullSandboxEvidenceAsPending(
  record: ProviderCapabilityRecord,
): boolean {
  // THE VIOLATION: `null` read as "an account will settle this later", on a row where the
  // provider's own documentation already settled it.
  return record.sandbox.producesQueryableActivity !== false;
}

/** A record carrying the pre-correction `null` on a row the documentation settles. */
export function recordWithUnresolvedSandboxEvidence(
  base: ProviderCapabilityRecord,
): ProviderCapabilityRecord {
  return {
    ...base,
    provider: 'synthetic_null_sandbox_evidence',
    sandbox: { ...base.sandbox, producesQueryableActivity: null },
    nonProductionValidationPath: {
      ...base.nonProductionValidationPath,
      sandboxModeEnabled: true,
      producesQueryableActivity: null,
    },
    resolvedDocumentedNegatives: [],
    unresolvedAccountItems: [
      ...base.unresolvedAccountItems,
      'CAPABILITY DOCUMENTED — ACCOUNT VALIDATION PENDING: whether a sandbox-mode send ' +
        'produces a record the activity query returns',
    ],
  };
}
