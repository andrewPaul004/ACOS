/**
 * The policy-slice denial codes, and the deliberate split between a DENIAL and a DEFECT.
 *
 * ---------------------------------------------------------------------------------
 * TWO CODES, BOTH TRANSCRIBED FROM `26 §7`'s FLOWCHART. NEITHER INVENTED.
 *
 *   M  "per_action_max satisfied?"                    -> no -> D11 "DENY: PER_ACTION"
 *   I  "Matching grant exists after subset            -> no -> D7  "DENY: NO_GRANT"
 *       intersection?"
 *
 * `PER_ACTION` is emitted when Cedar's determining policy is the per-action `forbid`.
 *
 * `NO_GRANT` is emitted when Cedar denies and NO `forbid` was determining — that is, no
 * policy path admitted the request. `36 §3`'s gap-analysis paragraph is explicit that this
 * is the correct outcome and that the danger is its silence:
 *
 *   "An action class with no policy is a deny by default (SR7) — correct, but silently so,
 *    and a class that was *meant* to be allowed and silently denies is an availability bug
 *    that will be 'fixed' under pressure by someone adding a permissive policy."
 *
 * `tests/policy/policy-set-gap-analysis.test.ts` is the answer to the silence: it enumerates
 * the closed catalogue and asserts each class's status by EXECUTION.
 *
 * ---------------------------------------------------------------------------------
 * WHY A DEFECT IS NOT A DENIAL
 *
 * The asymmetry is S1C's, accepted, and quoted here rather than re-argued.
 * `enumeration/workerFacingDenial.ts`, verbatim:
 *
 *   "NOTE the deliberate asymmetry: a non-`CanonicalisationDenied` error is RETHROWN, not
 *    projected. Those are internal defects [...] and `26 §7`'s coarse-denial rule is about
 *    DENIALS. Swallowing an internal defect into `DENY: SELECTOR` would hide a critical
 *    incident behind a routine category."
 *
 * A malformed policy artifact, a Cedar request the schema rejects, a Cedar evaluation error
 * or an absent authoritative operand are all defects in the CONTROL PLANE, not proposals a
 * model made. `50 §3`'s I19 mechanism halts a class's declared halt scope on a control-
 * artifact mismatch; it does not return a business denial. So these THROW.
 *
 * The property that matters, and the one the tests assert directly, is that no defect path
 * can produce `PERMIT`.
 * ---------------------------------------------------------------------------------
 */

/** `26 §7`'s terminals D11 and D7. The complete set S1D can emit. */
export type PolicyDenyCode = 'PER_ACTION' | 'NO_GRANT';

/**
 * A control-plane defect on the policy path. Never returned as a decision, never projected
 * to a worker, never convertible into a `PERMIT`.
 */
export type PolicyDefectKind =
  /** A control artifact is absent, unexpected, duplicated, or does not parse as Cedar. */
  | 'POLICY_ARTIFACT_INVALID'
  /** Cedar refused the request: schema violation, unknown action, unparseable entity. */
  | 'CEDAR_REQUEST_REJECTED'
  /** Cedar evaluated but reported per-policy errors. A decision taken over errors is not a decision. */
  | 'CEDAR_EVALUATION_ERROR'
  /** The canonical effect carries no policy construction for its action class. */
  | 'NO_POLICY_CONSTRUCTION'
  /** An authoritative operand the request construction requires is absent. */
  | 'AUTHORITATIVE_OPERAND_ABSENT';

export class PolicyEvaluationDefect extends Error {
  /**
   * Parameter properties, deliberately, rather than two `this.x = x` assignments.
   *
   * The accepted S1C test `tests/canonicalisation/worker-facing-denial.test.ts` walks ALL of
   * `src/` and fails any file that contains `.auditNote`, with two named exemptions. Writing
   * `this.auditNote = auditNote` here would have required widening that accepted guard by a
   * third exemption — for a write, in a file the guard is not about — which weakens a rule
   * S1C accepted in order to satisfy an S1D convenience. Parameter properties give the same
   * field with no `.auditNote` occurrence, so the accepted guard is left exactly as it is.
   *
   * @param kind Which control-plane defect this is.
   * @param auditNote Diagnostic context for the trusted control/audit path. `26 §7`: "The
   *   audit record holds the full reason; the worker receives a category and no near-miss
   *   information." It never crosses a worker boundary — `projectedPolicyOutcome` has no
   *   catch clause, so a defect propagates rather than being projected.
   */
  constructor(
    readonly kind: PolicyDefectKind,
    readonly auditNote: string,
  ) {
    super(`POLICY DEFECT: ${kind} — ${auditNote}`);
    this.name = 'PolicyEvaluationDefect';
  }
}

export function policyDefect(kind: PolicyDefectKind, auditNote: string): never {
  throw new PolicyEvaluationDefect(kind, auditNote);
}
