import type { Client } from '../../db/pool.js';
import type { AuthoritativeRetainedFee } from '../canonicalisation/authoritativeCost.js';
import type {
  CustomerNovelty,
  ResolvedResource,
  SelectedAuthoritativeOption,
} from '../canonicalisation/types.js';
import type { TaskContextSpec } from './contextSpec.js';

/**
 * The port a registered constructor implements so the ENUMERATION CORE stays class-agnostic.
 *
 * `24 §3` K4, on the Effect Canonicaliser's versioned constructor, verbatim, items 1 and 2:
 *
 *   "1. fetches the authoritative state itself, under the existing entity advisory lock
 *       (25 §14);
 *    2. **enumerates** the permissible effects for (action_class, resource) — for a refund,
 *       the refundable line items and the remaining maximum per item; for a budget change,
 *       the permitted absolute values given the current budget and the increase rule; for
 *       an address edit, the permitted address sources;"
 *
 * Three different state models, three different enumeration rules, one core. So state
 * resolution and enumeration hang off the REGISTRATION, exactly as S1B.2 finding 6 hung the
 * per-class `semantic_option_digest` and the per-class cohesion checks off it:
 *
 *   "That is what makes the closed catalogue plus a registered constructor a real extension
 *    point. Before the move, `EffectCanonicaliser` imported the refund digest directly, so a
 *    second money-bearing class would have required editing the canonicaliser core — the
 *    per-class branch the S1B contract says must not exist."
 *
 * `enumerateEffects.ts` and `liveSelector.ts` therefore contain no `refund.create` branch,
 * import no refund module, and name no commerce table. Adding a second class adds one of
 * these; it does not edit either of them.
 */

/**
 * Why a `resource_ref` did not resolve to something enumerable.
 *
 * ---------------------------------------------------------------------------------
 * INTERNAL ONLY. ALL THREE PRODUCE THE SAME EXTERNAL BEHAVIOUR.
 *
 * `36 §2` VC-C2, verbatim: "a resource outside the `context_spec` returns an **empty set**
 * rather than a denial that leaks existence."
 *
 * S1C applies that to all three, because distinguishing any PAIR of them rebuilds the
 * oracle: "out of scope" versus "absent" tells the model that order 999 exists, and "out of
 * scope" versus "not RECORD grade" tells it the same thing with one more step. The values
 * below exist so the later audit/journal layer can record which it was — `26 §2.0.1`:
 * "Internally the audit/event layer may retain the detailed reason."
 * ---------------------------------------------------------------------------------
 */
export type ResourceResolutionFailure =
  | 'OUT_OF_CONTEXT_SPEC_SCOPE'
  | 'RESOURCE_ABSENT'
  | 'RESOURCE_NOT_RECORD_GRADE';

/**
 * The authoritative resource, resolved.
 *
 * Every field here is a field of `AuthoritativeCanonicalisationContext`, deliberately: the
 * live C′ boundary assembles that context from THIS, so a value cannot enter canonicalisation
 * from anywhere but authoritative state.
 */
export interface AuthoritativeResourceState {
  readonly resource: ResolvedResource;
  /** `26 §2.1`: "the single ledger currency". */
  readonly ledgerCurrency: string;
  /** `26 §2.1`: "the payer of the original transaction, NOT a counterparty". */
  readonly customerNovelty: CustomerNovelty | null;
}

export type ResourceResolution =
  | { readonly ok: true; readonly state: AuthoritativeResourceState }
  | { readonly ok: false; readonly failure: ResourceResolutionFailure };

/**
 * One enumerated option, kernel-side.
 *
 * The `option` is S1B's own `SelectedAuthoritativeOption` — unchanged and unwidened — so the
 * live boundary hands the accepted canonicaliser core a value it already accepted, and there
 * is no second "enumerated option" model that could drift from the one the constructor
 * consumes.
 *
 * `retainedProcessingFee` mirrors the context field of the same name and travels WITH the
 * option rather than being read again at C′. `26 §2.1.1`: "no policy cap intended to bound
 * economic loss may compare only against `vendor_amount`" — the fee is what makes the two
 * differ, so re-deriving it later would let the enumerated option and the canonicalised
 * effect carry different economics. Null for a class the catalogue declares
 * cost-component-free.
 */
export interface EnumeratedAuthoritativeOption {
  readonly option: SelectedAuthoritativeOption;
  readonly retainedProcessingFee: AuthoritativeRetainedFee | null;
}

/**
 * The per-class state-resolution and enumeration implementation.
 *
 * Both methods take the CLIENT the entity execution lease holds. `25 §14` requires the read
 * to happen under the advisory lock, and passing the connection explicitly is what makes
 * that a property of the call rather than of a convention about pools.
 */
export interface LiveEnumerator {
  /**
   * Resolve `resource_ref` to RECORD-grade authoritative state, or say why not.
   *
   * The `context_spec` scope check happens in the CORE, before this is called, so an
   * out-of-scope reference never becomes a database query. That ordering matters: a
   * timing-observable query against a resource the task may not see is a weaker form of the
   * oracle the empty set exists to close.
   */
  readonly resolveResource: (
    client: Client,
    companyId: string,
    resourceRef: string,
  ) => Promise<ResourceResolution>;

  /**
   * Enumerate the currently permissible effects for `(action_class, resource)`.
   *
   * Called once by `enumerate_effects` and AGAIN at C′ under the entity lease. Both call
   * sites reach the same function, so "the live set" is one definition, not two that must be
   * kept in step.
   */
  readonly enumerate: (
    client: Client,
    companyId: string,
    state: AuthoritativeResourceState,
    spec: TaskContextSpec,
  ) => Promise<readonly EnumeratedAuthoritativeOption[]>;
}
