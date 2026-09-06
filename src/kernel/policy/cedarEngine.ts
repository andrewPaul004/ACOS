import * as cedar from '@cedar-policy/cedar-wasm/nodejs';

import { policyDefect } from './errors.js';
import { describeErrors, type LoadedPolicyArtifacts } from './policyArtifacts.js';
import type { CedarRequest } from './cedarRequest.js';

/**
 * The real Cedar evaluator, linked in-process.
 *
 * ADR-005's decision, verbatim: "**Cedar (Apache-2.0) linked in-process**, with
 * `cedar-policy-symcc` (in the `cedar-policy/cedar` repository) running the properties P1,
 * P2, P3, P4, P4a, P5, P5a, P6 and P7 from `26 §11` in CI. OPA is the named fallback."
 *
 * `32 §…`: "Cedar is linked in-process as a library"; "Cedar in-process means policy
 * evaluation costs microseconds, so evaluating on *every* effect — including cheap ones — is
 * free, which keeps the chokepoint honest."
 *
 * ADR-005's wording-tension paragraph, which is the one that matters for EM2:
 *
 *   "Cedar here is in-process **to the control plane**, which is a different process from
 *    every model runtime. The boundary EM2 requires is between the policy engine and the
 *    *model*, and it holds: workers are separate sandboxed processes with no credentials, no
 *    policy-engine access, and one write capability."
 *
 * ---------------------------------------------------------------------------------
 * THIS IS THE REAL ENGINE
 *
 * `@cedar-policy/cedar-wasm` is the Cedar project's own WASM binding, published from
 * `cedar-policy/cedar` under Apache-2.0. `31 §…` names Cedar v4.11.0 as the evaluated
 * version and the pinned binding is `4.11.2` — the same minor line. `cedar.getCedarVersion()`
 * is asserted against the pin in `tests/policy/cedar-runtime.test.ts`, so "we are running
 * real Cedar" is a checked fact rather than a claim about a dependency name.
 *
 * `cedar-policy-symcc` is NOT used and is NOT installed. `22` DP3 and `45 §3` defer the
 * symbolic gate past S1, recorded as an amendment to `11 E6` under `28 §9.2`.
 *
 * ---------------------------------------------------------------------------------
 * FAIL CLOSED, IN FOUR PLACES
 *
 *   1. `type: "failure"`        Cedar refused the request — an unknown action, a context
 *                               attribute the schema does not declare, an entity that does
 *                               not typecheck. DEFECT. Never a decision.
 *   2. `diagnostics.errors`     Cedar evaluated but a policy errored. A decision taken over
 *                               an errored policy set is not a decision. DEFECT, on PERMIT
 *                               as well as on DENY — a permit reached while some forbid
 *                               failed to evaluate is the most dangerous outcome available.
 *   3. `validateRequest: true`  the request is typechecked against the schema before any
 *                               policy runs, so an operand of the wrong type cannot be
 *                               silently coerced.
 *   4. anything not "allow"     the only path to PERMIT is the literal decision `"allow"`.
 *                               There is no default, no fallthrough and no `?? 'allow'`.
 * ---------------------------------------------------------------------------------
 */

/** `31 §…` names Cedar v4.11.0; the binding is pinned to that minor line. */
export const PINNED_CEDAR_VERSION = '4.11.2';

export interface CedarEvaluation {
  readonly decision: 'allow' | 'deny';
  /** `diagnostics.reason` — the policies that determined the outcome. Audit path only. */
  readonly determiningPolicies: readonly string[];
}

/** The Cedar runtime version actually linked into this process. */
export function linkedCedarVersion(): string {
  return cedar.getCedarVersion();
}

/**
 * Evaluate one request against one loaded policy set, with the real engine.
 *
 * Throws `PolicyEvaluationDefect` on every abnormal path. Returns a decision only when Cedar
 * returned one cleanly.
 */
export function evaluateWithCedar(
  artifacts: LoadedPolicyArtifacts,
  request: CedarRequest,
): CedarEvaluation {
  const answer = cedar.isAuthorized({
    principal: request.principal,
    action: request.action,
    resource: request.resource,
    // The cast is the boundary between our closed `CedarValue` union and the binding's
    // structurally identical `CedarValueJson`. It widens nothing a caller controls: the
    // whole object was built by `cedarRequest.ts` from the canonical effect.
    context: request.context as Record<string, cedar.CedarValueJson>,
    entities: request.entities as unknown as cedar.Entities,
    schema: artifacts.schema,
    // (3) — typecheck the request against the schema before any policy runs.
    validateRequest: true,
    policies: { staticPolicies: artifacts.staticPolicies },
  });

  // (1)
  if (answer.type !== 'success') {
    return policyDefect(
      'CEDAR_REQUEST_REJECTED',
      `Cedar refused the request: ${describeErrors(answer.errors)}`,
    );
  }

  const response = answer.response;

  // (2) — checked BEFORE the decision is read, and on both outcomes.
  if (response.diagnostics.errors.length > 0) {
    return policyDefect(
      'CEDAR_EVALUATION_ERROR',
      `Cedar reported policy errors (decision was ${response.decision}): ${response.diagnostics.errors
        .map((error) => `${error.policyId}: ${error.error.message}`)
        .sort()
        .join(' | ')}`,
    );
  }

  // (4) — `"allow"` or `"deny"`, and nothing else is a decision.
  if (response.decision !== 'allow' && response.decision !== 'deny') {
    return policyDefect(
      'CEDAR_EVALUATION_ERROR',
      `Cedar returned an unrecognised decision ${JSON.stringify(response.decision)}`,
    );
  }

  return {
    decision: response.decision,
    determiningPolicies: Object.freeze([...response.diagnostics.reason].sort()),
  };
}
