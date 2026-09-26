import type { AuditReadOutcome } from './plane/auditReadClient.js';

/**
 * `§14` — THE AUDIT FINDING IS DERIVED INDEPENDENTLY, AND THIS FILE IS WHERE THAT IS TRUE.
 *
 * =================================================================================
 * THE SENTENCE BEING IMPLEMENTED
 *
 * `§14`: "**Do not make audit verification depend on a control-plane `verified=true`.**"
 *
 * `30 §5.4` already states the structural form of the same rule for the mirror: "The audit
 * plane has no independent reading of [the control journal's true maximum] AND BY
 * CONSTRUCTION CANNOT: R10 removed the replica deliberately, and `24 §3` K11's DECLARED
 * INPUTS CONTAIN NO CONTROL-DATABASE READ."
 *
 * The provider-read plane's version is the same shape with the operands swapped: the audit
 * plane HAS an independent reading — that is what the reader runtime is for — and what it
 * must not do is give the control plane's belief a vote in the comparison.
 *
 * =================================================================================
 * HOW A TYPE ENFORCES IT
 *
 * `deriveIndependentFinding` takes exactly two operands:
 *
 *   1. `AuditReadOutcome` — what the PROVIDER said, through the reader process, unmapped.
 *   2. `AuditExpectation` — what the AUDIT PLANE expected, derived from AUDIT-PLANE state.
 *
 * There is no third parameter, and `AuditExpectation` has no member a control-plane verdict
 * could occupy: no `verified`, no `controlOutcome`, no `dispatchOutcome`, no
 * `adapterResult`, no `authorisationRef`. **A caller holding a control-plane
 * `verified=true` has nowhere to put it.**
 *
 * That is the whole mechanism, and it is deliberately not a check. A runtime check that
 * refused a control-plane operand would be a check somebody could remove;
 * `unsafeControlTrustingFinding` in the negative-control suite is the version that DOES take
 * the control-plane outcome and agree with it, and the discrimination is that it produces
 * `CORROBORATED` on a fabricated control result where this function produces `DIVERGENT`.
 *
 * =================================================================================
 * AND `I8`'s OWN RULE IS PRESERVED: SILENCE IS NOT AGREEMENT
 *
 * `26` and `48`'s inverse-sweep logic turn on the direction of the read: the audit plane
 * enumerates what the PROVIDER holds and asks whether ACOS accounted for it, which is why a
 * read that returned nothing must never be reported as "the provider holds nothing".
 *
 * `AuditReadOutcome` keeps those two facts apart — `NO_EVIDENCE` and `EVIDENCE` with zero
 * records are different values — and this function maps them to different findings:
 * `READ_INCONCLUSIVE` and `PROVIDER_HAS_NO_RECORD`. A function that collapsed them would
 * turn every provider outage into a clean bill of health, which is exactly the failure
 * `48 §3.7` names for the anchor: "an attacker's first move against anchoring is to stop it."
 * =================================================================================
 */

/**
 * What the AUDIT PLANE expected to find at the provider, derived from AUDIT-PLANE state.
 *
 * `30 §5.4`'s discipline applied to the inputs: every member here is something the audit
 * plane can know from its own store — the mirrored effect's correlation tag and the period
 * it was dispatched in — and nothing here is something only the control plane knows.
 *
 * **`correlationTag` IS NOT A CONTROL-PLANE VERDICT.** It is an identifier minted at enqueue
 * and mirrored into the audit store through the transport the audit plane already verifies
 * end to end; `48`'s v1.3 note forbids PARAMETERISING the vendor read by an ACOS tag set,
 * and this is the other direction — the audit plane holds a tag it expects to FIND, and the
 * read that looks for it is still period-bounded.
 */
export interface AuditExpectation {
  /** The correlation tag the audit plane's own mirrored row carries. */
  readonly correlationTag: string;
  /** Whether the audit plane's own state says a dispatch was CLAIMED in this period. */
  readonly auditStateExpectsProviderRecord: boolean;
}

/**
 * The closed finding set. Five members, and every one is a statement about EVIDENCE.
 *
 * Note what is absent: there is no `VERIFIED`, and that is deliberate. `I36`'s verification
 * leg needs a provider's accepted count against ACOS's own claim count, and S1O produces no
 * such comparison because it performs no real provider read. What this function produces is
 * the comparison SHAPE, and a later slice supplies real operands.
 */
export const AUDIT_FINDINGS = [
  /** The provider holds a record carrying the expected tag, and the audit plane expected one. */
  'CORROBORATED',
  /** The provider holds a record the audit plane did NOT expect. `I8`'s inverse sweep. */
  'UNACCOUNTED_PROVIDER_RECORD',
  /** The audit plane expected a record and the provider holds none. */
  'MISSING_PROVIDER_RECORD',
  /** Neither side has a record. Agreement, and the weakest kind. */
  'PROVIDER_HAS_NO_RECORD',
  /** The read did not happen. **NOT agreement**, and never reported as one. */
  'READ_INCONCLUSIVE',
] as const;

export type AuditFinding = (typeof AUDIT_FINDINGS)[number];

export interface IndependentFinding {
  readonly finding: AuditFinding;
  /** How many provider records carried the expected tag. Evidence, not a verdict. */
  readonly matchingRecordCount: number;
  /**
   * The provider's own status words for the matching records, verbatim and unmapped.
   *
   * UNMAPPED is the point. A mapping from provider words to ACOS outcome classes would be a
   * place the audit plane's answer could be made to agree with the control plane's
   * vocabulary, and `30 §5.7`'s rule against string classification applies: the audit plane
   * records what the provider said and leaves the interpretation to the slice that has an
   * oracle.
   */
  readonly providerStatuses: readonly string[];
}

/**
 * Derive one finding from provider evidence and an audit-plane expectation.
 *
 * TWO OPERANDS, AND NEITHER IS A CONTROL-PLANE BELIEF. See this file's header.
 */
export function deriveIndependentFinding(
  outcome: AuditReadOutcome,
  expectation: AuditExpectation,
): IndependentFinding {
  if (outcome.kind === 'NO_EVIDENCE') {
    // THE READ DID NOT HAPPEN. This is not agreement and is not a record count of zero.
    return Object.freeze({
      finding: 'READ_INCONCLUSIVE',
      matchingRecordCount: 0,
      providerStatuses: Object.freeze([]),
    });
  }

  const matching = outcome.records.filter(
    (record) => record.correlationTag === expectation.correlationTag,
  );
  const providerStatuses = Object.freeze(matching.map((record) => record.providerStatus));

  if (matching.length > 0) {
    return Object.freeze({
      finding: expectation.auditStateExpectsProviderRecord
        ? 'CORROBORATED'
        : // `I8`'s inverse sweep: the provider acted and the audit plane's own state does
          // not account for it. The most serious of the five, and reachable only because
          // the read was period-bounded rather than tag-bounded — a tag-bounded read would
          // only ever find what ACOS already knew to look for.
          'UNACCOUNTED_PROVIDER_RECORD',
      matchingRecordCount: matching.length,
      providerStatuses,
    });
  }

  return Object.freeze({
    finding: expectation.auditStateExpectsProviderRecord
      ? 'MISSING_PROVIDER_RECORD'
      : 'PROVIDER_HAS_NO_RECORD',
    matchingRecordCount: 0,
    providerStatuses,
  });
}
