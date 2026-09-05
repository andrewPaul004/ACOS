import type { ConstructorVersionIdentity } from '../canonicalisation/constructorVersion.js';

/**
 * `EnumeratedOptionSet` — the model-facing result of `enumerate_effects`.
 *
 * `26 §2.0.1`, verbatim:
 *
 *   enumerate_effects(action_class, resource_ref)
 *     → EnumeratedOptionSet {
 *           enumeration_id            // opaque, journaled
 *           computed_at               // for the class's max_age check at C′
 *           constructor_version       // the constructor that produced this set
 *           options [ {
 *               option_id             // = H(action_class ‖ resource_id ‖ semantic_option_digest)
 *               description           // projected through the task's context_spec — see I52
 *           } ]
 *       }
 *
 * ---------------------------------------------------------------------------------
 * TWO FIELDS PER OPTION, AND NOT THREE
 *
 * An option carries `option_id` and `description`. It carries no amount, no line id, no
 * transaction id, no instrument, no refundable remaining and no fee — those are on the
 * kernel-side `SelectedAuthoritativeRefundOption`, which the model never sees. Anything the
 * model is entitled to know about an option reaches it THROUGH the `context_spec`
 * projection into `description` (`I52`), so there is exactly one field-visibility control
 * and exactly one place it is enforced.
 *
 * `24 §3` K4's version of the same structure additionally prints `action_class`,
 * `resource_ref` and `max_age`. S1C returns `26 §2.0.1`'s narrower shape — the one the S1C
 * mandate declares — and holds `max_age` kernel-side, which is strictly less information at
 * the boundary. Recorded as S1C-C7.
 * ---------------------------------------------------------------------------------
 */
export interface EnumeratedOption {
  /** `26 §2.2`: `H(action_class ‖ resource_id ‖ semantic_option_digest)`. */
  readonly optionId: string;
  /** `I52`: projected through the task's `context_spec`. See `contextSpec.ts`. */
  readonly description: string;
}

export interface EnumeratedOptionSet {
  /** Opaque to the model. Content-addressed; the preimage is S1C-C6. */
  readonly enumerationId: string;
  /** `26 §2.0.1`: "for the class's max_age check at C′". From the injected clock. */
  readonly computedAt: Date;
  /** `26 §2.0.1`, `I61`: the VERIFIED constructor version that produced this set. */
  readonly constructorVersion: ConstructorVersionIdentity;
  readonly options: readonly EnumeratedOption[];
}
