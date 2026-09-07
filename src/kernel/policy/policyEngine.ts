import type { CanonicalEffect } from '../canonicalisation/types.js';
import { buildCedarRequest, type CedarRequest } from './cedarRequest.js';
import { evaluateWithCedar } from './cedarEngine.js';
import { resolveDenialCategory } from './denialCategory.js';
import { policyDefect } from './errors.js';
import { loadPolicyArtifacts, type LoadedPolicyArtifacts } from './policyArtifacts.js';
import type { PolicyDecision, PolicyDecisionLineage } from './decision.js';

/**
 * K3 — the Policy & Authority Engine, for `26 §7` step M and the `§8` grant.
 *
 * `33 §…`, the capability table row, verbatim:
 *
 *   "| `authority` | K3 Policy & Authority Engine | Cedar evaluation, the 10-step sequence
 *    in `26 §7` |"
 *
 * S1D implements the Cedar-evaluation half for one class and two of the eighteen terminals.
 * `decision.ts` explains at length why the result is called a `PolicyDecision` and not an
 * `AuthorizationDecision`.
 *
 * ---------------------------------------------------------------------------------
 * THE PUBLIC SURFACE IS ONE METHOD TAKING ONE ARGUMENT
 *
 * `evaluate(effect: CanonicalEffect): PolicyDecision`.
 *
 * No limit parameter, no grant parameter, no window parameter, no company parameter, no
 * context map, no options bag, no overload and no optional argument. Every operand Cedar
 * sees is read off the one canonical effect by `cedarRequest.ts`.
 *
 * That is the answer to five of the mandate's authority-channel attacks at once, and it is
 * structural: the attacks do not fail a check, they have no argument position.
 *
 * `31 §…` records the reason the boundary is this narrow rather than accidental: "the engine
 * sits behind a `PolicyEngine` interface with one method", so replacing Cedar with OPA under
 * the named fallback changes this file and nothing above it.
 *
 * ---------------------------------------------------------------------------------
 * ARTIFACTS ARE LOADED ONCE, AT CONSTRUCTION
 *
 * `26 §11`: "No runtime editing, no admin UI that mutates rules, no model in the path."
 * Loading per evaluation would make a mid-flight edit to a control artifact take
 * effect silently between two decisions in the same workflow. Loading once means an artifact
 * change requires a control-plane deploy, which is exactly what ADR-005 says it costs:
 * "In-process linkage means a policy-engine upgrade is a control-plane deploy."
 *
 * The load is fail-closed. An absent, malformed, unexpected or duplicate artifact throws at
 * construction, so a control plane with a broken policy set does not start rather than
 * starting permissive.
 * ---------------------------------------------------------------------------------
 */
export class PolicyEngine {
  readonly #artifacts: LoadedPolicyArtifacts;

  /**
   * @param artifacts Pre-loaded artifacts. Defaults to the deployed set. Tests pass a
   *   different root to exercise the fail-closed loader; there is no production path that
   *   substitutes one, and no runtime setter.
   */
  constructor(artifacts: LoadedPolicyArtifacts = loadPolicyArtifacts()) {
    this.#artifacts = artifacts;
  }

  /** `26 §11`'s `policy_version` for the artifacts this engine is running. */
  get policyVersion(): string {
    return this.#artifacts.policyVersion;
  }

  /**
   * Evaluate the canonical effect against the policy set.
   *
   * Returns `PERMIT` only when the real Cedar engine returned `allow` with no policy errors.
   * Every other outcome is a `DENY` under a `26 §7` terminal, or a thrown
   * `PolicyEvaluationDefect`. There is no third result and no default.
   */
  evaluate(effect: CanonicalEffect): PolicyDecision {
    const request: CedarRequest = buildCedarRequest(effect);
    const evaluation = evaluateWithCedar(this.#artifacts, request);

    const lineage: PolicyDecisionLineage = Object.freeze({
      policyVersion: this.#artifacts.policyVersion,
      // `26 §11`: "Every AuthorizationDecision records policy_version AND
      // constructor_version [...] the *inputs* are constructed by a versioned constructor".
      constructorVersion: effect.request.constructorVersion,
      determiningPolicies: evaluation.determiningPolicies,
    });

    if (evaluation.decision === 'allow') {
      return Object.freeze({ decision: 'PERMIT' as const, lineage });
    }

    const category = resolveDenialCategory(evaluation.determiningPolicies);
    if (category.code === null) {
      // A `forbid` fired that `denialCategory.ts` has no registered terminal for. Reporting
      // it under the nearest code would tell a worker something untrue about which control
      // stopped it, and defaulting to the coarsest code would hide a deployed policy nobody
      // mapped. It is a control-artifact defect, and `50 §3`'s I19 mechanism halts rather
      // than degrading.
      return policyDefect(
        'POLICY_ARTIFACT_INVALID',
        `Cedar denied on policies with no registered denial terminal: ${category.unregistered.join(', ')}`,
      );
    }

    return Object.freeze({
      decision: 'DENY' as const,
      code: category.code,
      lineage,
      // Audit path only. `26 §7`: "The audit record holds the full reason; the worker
      // receives a category and no near-miss information." NO AMOUNT APPEARS HERE — not the
      // exposure, not the limit, not the difference. A note reading "exceeded by $1.03" is
      // the probing oracle `26 §7` names, and the safest way not to leak it through a future
      // refactor is never to compute it.
      auditNote: `Cedar denied ${effect.request.actionClass} on ${
        evaluation.determiningPolicies.length === 0
          ? 'no satisfied permit'
          : evaluation.determiningPolicies.join(', ')
      }`,
    });
  }
}
