import type { ConstructorVersionIdentity } from '../canonicalisation/constructorVersion.js';
import type { PolicyDenyCode } from './errors.js';

/**
 * The outcome of `26 §7` step M and the `§8` grant. NOT an `AuthorizationDecision`.
 *
 * ---------------------------------------------------------------------------------
 * WHY THE TYPE IS CALLED A POLICY DECISION AND NOT AN AUTHORISATION
 *
 * `26 §7`'s sequence has eighteen denial terminals and S1D occupies two of them. A `PERMIT`
 * below means: the Cedar policy set, evaluated over the canonical effect, admitted this
 * request. It does NOT mean the principal chain was verified (step D), that no categorical
 * prohibition applies (step E), that the preconditions were fetched and graded (steps G–H″),
 * that a matching grant was intersected (step I), that evidence requirements were met (step
 * L), that the autonomy ledger permits the key (step N), or — most consequentially — that
 * any window has headroom (step R).
 *
 * `26 §7` step W is where a signed `AuthorizationDecision` is emitted, and S1D does not
 * reach it. Naming this type `AuthorizationDecision` would have been the single most
 * misleading thing S1D could put in the tree, because a later slice would then have found
 * the name already taken by something that proves far less.
 * ---------------------------------------------------------------------------------
 */

export interface PolicyDecisionLineage {
  /**
   * `26 §11`, verbatim: "Every `AuthorizationDecision` records `policy_version` **and
   * `constructor_version`**". Both are here, on every decision, permit and deny alike.
   *
   * `policyVersion` is the content hash over the Cedar schema and the whole policy set —
   * see `policyArtifacts.ts`. It is what makes `26 §11`'s reproducibility claim checkable:
   * "same inputs, same `policy_version`, same `constructor_version`, same verdict, forever."
   */
  readonly policyVersion: string;
  readonly constructorVersion: ConstructorVersionIdentity;
  /**
   * The Cedar policy ids that determined the decision.
   *
   * AUDIT-PATH ONLY. `26 §7`: "The audit record holds the full reason; the worker receives a
   * category and no near-miss information." `workerFacingPolicyDenial.ts` is the only
   * boundary a worker sees and it carries no field this could be placed in.
   */
  readonly determiningPolicies: readonly string[];
}

export interface PolicyPermit {
  readonly decision: 'PERMIT';
  readonly lineage: PolicyDecisionLineage;
}

export interface PolicyDeny {
  readonly decision: 'DENY';
  /** `26 §7`'s terminal. `PER_ACTION` (D11) or `NO_GRANT` (D7). */
  readonly code: PolicyDenyCode;
  readonly lineage: PolicyDecisionLineage;
  /** Free-text audit context. Never returned to a worker; see `workerFacingPolicyDenial.ts`. */
  readonly auditNote: string;
}

export type PolicyDecision = PolicyPermit | PolicyDeny;
