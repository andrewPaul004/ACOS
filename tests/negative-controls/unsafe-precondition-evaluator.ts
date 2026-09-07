import type { Client } from '../../src/db/pool.js';
import type { FetchedPrecondition } from '../../src/kernel/authority/preconditions.js';

/**
 * INTENTIONALLY VULNERABLE — TEST ONLY. NEVER IMPORTED FROM `src/`.
 *
 * `26 §7` steps H and H′, with the two defects the architecture wrote them to close.
 *
 * ---------------------------------------------------------------------------------
 * DEFECT 1 — THE GRADE IS TRUSTED RATHER THAN GATED
 *
 * `24 §5`'s table gives one column the value of the whole grade lattice: "May it be a policy
 * precondition?" RECORD yes, OBSERVATION yes with a registered spec, DECISION_OWNER yes,
 * everything else NO. `I6`: "No policy precondition is evaluated against a `CLAIM`-grade
 * fact."
 *
 * `unsafeEvaluateGrade` below checks the fact's VALUE and ignores its grade entirely. That is
 * the plausible bug rather than a strawman: the value check is the one that looks like the
 * business rule, and a developer who has just written it has no visible reason to add a
 * second condition about who wrote the row. It is also the exact shape of MOA-10 — a
 * model-authored fact reaching a gate.
 *
 * ---------------------------------------------------------------------------------
 * DEFECT 2 — THE CONTRADICTION CHECK IS ABSENT
 *
 * `24 §15`, on why `26 §7` gained step H′ at all: "v1.0 blocked contradicted evidence at the
 * Decision Registry only, **which left the effect path open**: a fact in an open
 * contradiction could still be fetched as a policy precondition and satisfy a check."
 *
 * `unsafeEvaluateContradictions` is that v1.0 behaviour: it does nothing. The worked case
 * `24 §15` names — "a refund proceeding on the commerce projection while a conflicting
 * processor record is open" — is precisely the fixture the discriminating test builds.
 *
 * ---------------------------------------------------------------------------------
 * `fetch` IS NOT REIMPLEMENTED
 *
 * Both functions take the preconditions the PRODUCTION fetcher returned, so the fixture the
 * two implementations disagree about is identical in every respect except the check itself.
 * A control that also re-fetched could differ for a second reason and would stop
 * discriminating.
 */

/** DEFECT 1. Checks the value; ignores RECORD/OBSERVATION/DECISION_OWNER entirely. */
export function unsafeEvaluateGrade(preconditions: readonly FetchedPrecondition[]): void {
  for (const precondition of preconditions) {
    if (precondition.value !== precondition.requiredValue) {
      throw new Error(`unsafe: precondition ${precondition.preconditionKey} does not hold`);
    }
  }
}

/** DEFECT 2. The v1.0 behaviour: contradictions gate the Decision Registry, not the effect. */
export function unsafeEvaluateContradictions(
  _client: Client,
  _companyId: string,
  _preconditions: readonly FetchedPrecondition[],
): Promise<void> {
  return Promise.resolve();
}
