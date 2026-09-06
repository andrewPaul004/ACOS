import type { ProposedIntent } from '../canonicalisation/intent.js';
import type { TaskContextSpec } from '../enumeration/contextSpec.js';
import type { HeldEntityLease } from '../enumeration/entityLease.js';
import type {
  KernelSuppliedContext,
  LiveSelectorCanonicaliser,
} from '../enumeration/liveSelector.js';
import type { PolicyDecision } from './decision.js';
import type { PolicyEngine } from './policyEngine.js';

/**
 * C′ and step M, in ONE call, with no caller-visible object between them.
 *
 * ---------------------------------------------------------------------------------
 * WHY THIS EXISTS RATHER THAN LETTING A CALLER DO THE TWO STEPS
 *
 * `26 §7`'s C′ row, verbatim: "**Everything downstream of C′ evaluates kernel-computed
 * operands only.**"
 *
 * A caller that held the `CanonicalEffect` and then passed it to `PolicyEngine.evaluate`
 * would satisfy that sentence in intent and leave a gap in fact: between the two statements
 * the effect is an ordinary JavaScript object in caller scope. TypeScript's `readonly`
 * prevents the assignment at compile time and prevents nothing at runtime, so the honest
 * defence is to remove the gap rather than to document it.
 *
 * `authoriseUnderLease` therefore returns the DECISION and the effect together, AFTER the
 * decision has been taken. The effect a caller receives is the one the decision was taken
 * over and cannot be anything else, because it never existed anywhere a caller could reach
 * before the evaluation happened.
 *
 * That is also the direct answer to "is the policy decision tied to the canonical effect
 * produced after S1C selector revalidation, rather than a separately reconstructed
 * model-facing object?" — there is exactly one construction, inside this call, and no other
 * production path reaches `PolicyEngine.evaluate`.
 *
 * ---------------------------------------------------------------------------------
 * WHAT THIS IS NOT
 *
 * It is not `26 §7`. Steps D, E, F, G, H, H′, H″, I, J, K, L, N, R, S and T–W are absent,
 * and their absence is listed in `docs/implementation/S1D-contract.md §5.2`. In particular
 * NOTHING IS RESERVED and no window is consulted: a `PERMIT` here does not authorise a
 * dispatch, and `26 §7` step R stands between the two.
 *
 * The lease is the caller's, exactly as it is for `canonicaliseUnderLease`. S1D does not
 * claim the complete propose→authorise→execute lock span, because the later stages that
 * would have to be inside it do not exist — the same limitation S1C recorded, unchanged.
 * ---------------------------------------------------------------------------------
 */

export interface AuthorisationPipelineOptions {
  readonly liveSelector: LiveSelectorCanonicaliser;
  readonly policyEngine: PolicyEngine;
}

export interface StepMOutcome {
  readonly decision: PolicyDecision;
  /**
   * The canonical effect the decision was taken over.
   *
   * Returned for the audit path and for the dispatch path that a later slice adds. It is
   * handed over AFTER the decision, so it is a record of what was evaluated rather than an
   * input a caller could still change.
   */
  readonly effect: Awaited<ReturnType<LiveSelectorCanonicaliser['canonicaliseUnderLease']>>;
}

export class AuthorisationPipeline {
  readonly #liveSelector: LiveSelectorCanonicaliser;
  readonly #policyEngine: PolicyEngine;

  constructor(options: AuthorisationPipelineOptions) {
    this.#liveSelector = options.liveSelector;
    this.#policyEngine = options.policyEngine;
  }

  /**
   * Canonicalise under the held lease, then evaluate the policy set over the result.
   *
   * Denials from C′ propagate as `CanonicalisationDenied` exactly as they do today — S1D
   * changes no S1C denial and adds no step between the schema check and C′.
   */
  async authoriseUnderLease(
    lease: HeldEntityLease,
    intent: ProposedIntent,
    spec: TaskContextSpec,
    supplied: KernelSuppliedContext,
  ): Promise<StepMOutcome> {
    const effect = await this.#liveSelector.canonicaliseUnderLease(lease, intent, spec, supplied);
    const decision = this.#policyEngine.evaluate(effect);
    return Object.freeze({ decision, effect });
  }
}
