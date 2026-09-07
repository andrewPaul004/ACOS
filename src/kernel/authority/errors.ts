import type { AuthorityStep } from './steps.js';

/**
 * `26 §7`'s denial terminals for the steps S1E implements, and the internal reasons behind
 * them.
 *
 * ---------------------------------------------------------------------------------
 * TWO LEVELS, AND THE SEPARATION IS THE WHOLE POINT
 *
 * `26 §7`, verbatim:
 *
 *   "**Denial detail returned to the model is coarse.** The audit record holds the full
 *    reason; the worker receives a category and no near-miss information. A model that
 *    learns 'denied: amount exceeded by $3' has been handed a probing oracle."
 *
 * `AuthorityDenyCode` is the CATEGORY — one of `26 §7`'s own terminals, and the only thing
 * `workerFacingAuthorityDenial.ts` will project. `AuthorityDenyDetail` is the internal
 * reason, for the audit record, and no S1E code path renders one to a worker.
 *
 * The distinction is load-bearing at step D, step F and step I in particular, where the
 * several internal reasons must be indistinguishable to a proposer:
 *
 *   D — "no such session", "session expired", "principal suspended", "hop signature
 *       invalid", "depth 4", "chain not contiguous" all return PRINCIPAL. A proposer that
 *       could tell "your session expired" from "your chain is too deep" learns the shape of
 *       the identity substrate.
 *
 *   F — "kill switch engaged", "company suspended" and "NO AUTHORITATIVE STATUS ROW" all
 *       return PLATFORM_SUSPENDED. The third especially: an attacker who could distinguish
 *       a missing status from an engaged kill switch would know whether deleting the row is
 *       a productive attack.
 *
 *   I — "no grant", "grant expired", "resource out of scope", "class not in the delegated
 *       subset" all return NO_GRANT, which is the terminal `26 §7` declares (D7).
 * ---------------------------------------------------------------------------------
 */

/**
 * The terminals, transcribed from `26 §7`'s flowchart for steps D–N.
 *
 * D3 PRINCIPAL · D4 PROHIBITED · D5 PLATFORM_SUSPENDED · D6 PRECONDITION or STALE ·
 * DH1 PRECONDITION_CONTRADICTED · DH2 PRECONDITION_DELEGATED · D7 NO_GRANT ·
 * D8 RECOVERABILITY · D9 NOVEL_COUNTERPARTY · D10 EVIDENCE · D12 DENY or ESCALATE.
 *
 * `PRECONDITION_UNCORROBORATED` is not on the flowchart; it is registry `I27`'s declared
 * on-violation terminal, verbatim: "`DENY: PRECONDITION_UNCORROBORATED`", enforced at
 * POLICY. It belongs to step H, alongside D6.
 *
 * `PER_ACTION` (D11) is DELIBERATELY ABSENT from this union. It is step M's terminal, it is
 * produced by the accepted S1D `PolicyEngine`, and duplicating it here would create a second
 * place that can say `PER_ACTION` without Cedar having run.
 */
export type AuthorityDenyCode =
  | 'PRINCIPAL'
  | 'PROHIBITED'
  | 'PLATFORM_SUSPENDED'
  | 'PRECONDITION'
  | 'STALE'
  | 'PRECONDITION_CONTRADICTED'
  | 'PRECONDITION_DELEGATED'
  | 'PRECONDITION_UNCORROBORATED'
  | 'NO_GRANT'
  | 'RECOVERABILITY'
  | 'NOVEL_COUNTERPARTY'
  | 'EVIDENCE'
  | 'UTTERANCE';

/**
 * The internal reason. AUDIT PATH ONLY.
 *
 * Every member names a condition a kernel engineer would want in an incident report and
 * that a proposer must never receive. `tests/authority/worker-facing-authority-denial.test.ts`
 * asserts there is no field on the worker-facing type in which one could be placed.
 */
export type AuthorityDenyDetail =
  // --- step D ---------------------------------------------------------------------------
  | 'SESSION_UNKNOWN'
  | 'SESSION_EXPIRED'
  | 'PRINCIPAL_SUSPENDED'
  | 'PRINCIPAL_NOT_ON_TASK'
  | 'DELEGATION_DEPTH_EXCEEDED'
  | 'DELEGATION_CHAIN_NOT_CONTIGUOUS'
  | 'DELEGATION_HOP_SIGNATURE_INVALID'
  | 'DELEGATION_HOP_KEY_ABSENT'
  | 'DELEGATION_SUBSET_WIDENED'
  // --- step E ---------------------------------------------------------------------------
  | 'CATEGORICALLY_PROHIBITED_CLASS'
  // --- step F ---------------------------------------------------------------------------
  | 'PLATFORM_STATUS_ABSENT'
  | 'PLATFORM_STATUS_NOT_OPERATING'
  | 'KILL_SWITCH_ENGAGED'
  | 'AGENT_PROFILE_CAPABILITY_ABSENT'
  | 'AGENT_PROFILE_CAPABILITY_SUSPENDED'
  // --- steps G / H ----------------------------------------------------------------------
  | 'PRECONDITION_FACT_ABSENT'
  | 'PRECONDITION_GRADE_NOT_GATING'
  | 'PRECONDITION_VALUE_MISMATCH'
  | 'PRECONDITION_PAST_MAX_AGE'
  | 'PRECONDITION_OBSERVATION_SINGLE_ADAPTER'
  // --- step H′ --------------------------------------------------------------------------
  | 'PRECONDITION_IN_OPEN_CONTRADICTION'
  // --- step H″ --------------------------------------------------------------------------
  | 'PRECONDITION_DELEGATED_GRADE_ON_GATED_CLASS'
  // --- step I ---------------------------------------------------------------------------
  | 'NO_ACTIVE_GRANT'
  | 'GRANT_EXPIRED'
  | 'GRANT_PRINCIPAL_SELECTOR_MISMATCH'
  | 'GRANT_ACTION_CLASS_NOT_SELECTED'
  | 'GRANT_RESOURCE_SELECTOR_MISMATCH'
  | 'GRANT_OUTSIDE_DELEGATED_SUBSET'
  | 'GRANT_MISSING_MONTH_WINDOW'
  | 'GRANT_WINDOW_REFS_DIVERGE_FROM_REQUEST'
  // --- step J ---------------------------------------------------------------------------
  | 'RECOVERABILITY_ABOVE_GRANT_MAX'
  // --- step K ---------------------------------------------------------------------------
  | 'COUNTERPARTY_NOVELTY_ABOVE_GRANT_MAX'
  | 'COUNTERPARTY_ABSENT_ON_OUTBOUND_CLASS'
  | 'COUNTERPARTY_PRESENT_ON_NON_OUTBOUND_CLASS'
  | 'GRANT_PERMITS_NO_COUNTERPARTY'
  // --- step L ---------------------------------------------------------------------------
  | 'EVIDENCE_SET_ABSENT'
  | 'EVIDENCE_INSUFFICIENT_INDEPENDENT_SOURCES'
  | 'EVIDENCE_SOURCE_TIER_TOO_LOW'
  | 'EVIDENCE_PAST_MAX_AGE'
  | 'EVIDENCE_COVERAGE_INCOMPLETE'
  // --- step P ---------------------------------------------------------------------------
  | 'UTTERANCE_POLICY_NOT_IMPLEMENTED';

/**
 * A denial raised by one of S1E's own gates.
 *
 * It carries the STEP as well as the code, because `26 §19`-style ordering questions —
 * "which gate actually determined this?" — cannot be answered from the category alone:
 * step H and step H′ both concern preconditions and only one of them fired.
 */
/**
 * The fields are PARAMETER PROPERTIES rather than assigned members, deliberately.
 *
 * The accepted rule in `tests/canonicalisation/worker-facing-denial.test.ts` — "nothing in
 * `src/` returns `.auditNote` … outward" — is enforced by searching the source for the
 * `.auditNote` form. A constructor body writing `this.auditNote = auditNote` matches it, and
 * the honest options were to widen the accepted rule's exemption list or to stop writing the
 * form. S1E takes the second: the rule stays exactly as S1B wrote it, and this class carries
 * the note without ever naming it after a dot.
 */
export class AuthorityDenied extends Error {
  constructor(
    readonly step: AuthorityStep,
    readonly code: AuthorityDenyCode,
    readonly detail: AuthorityDenyDetail,
    /** Free-text audit context. Never returned to a worker, and never on the outcome record. */
    readonly auditNote: string,
  ) {
    super(`DENY: ${code} at step ${step} (${detail}) — ${auditNote}`);
    this.name = 'AuthorityDenied';
  }
}

export function denyAuthority(
  step: AuthorityStep,
  code: AuthorityDenyCode,
  detail: AuthorityDenyDetail,
  auditNote: string,
): never {
  throw new AuthorityDenied(step, code, detail, auditNote);
}

/**
 * A control-plane defect, NOT a denial.
 *
 * The same asymmetry S1C and S1D drew. A malformed authoritative row, a catalogue and a
 * grant that disagree about a class's shape, or a canonical effect whose operands contradict
 * the catalogue are not proposals a worker can retry — they are conditions registry `I19`'s
 * mechanism halts on. Reporting one as `DENY: NO_GRANT` would tell a worker to try something
 * else while the authority substrate was broken.
 */
export class AuthorityDefect extends Error {
  readonly step: AuthorityStep;

  constructor(step: AuthorityStep, message: string) {
    super(`AUTHORITY DEFECT at step ${step}: ${message}`);
    this.name = 'AuthorityDefect';
    this.step = step;
  }
}

export function authorityDefect(step: AuthorityStep, message: string): never {
  throw new AuthorityDefect(step, message);
}
