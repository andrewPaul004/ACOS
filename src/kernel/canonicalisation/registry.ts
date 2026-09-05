import type { Money } from '../exposure/money.js';
import type { ActionCatalogueEntry, ActionClass } from './actionCatalogue.js';
import type { PermittedIntentFields } from './intent.js';
import type {
  AuthoritativeCanonicalisationContext,
  Counterparty,
  ComputedParameters,
  CustomerNovelty,
  DispatchPayload,
  Exposure,
  RecordedSelectedOption,
  SelectedAuthoritativeOption,
} from './types.js';

/**
 * The constructor registry, keyed by closed `action_class`.
 *
 * `26 §7` step C2, verbatim:
 *
 *   "Registered canonical constructor for this class?" -> no ->
 *   "DENY: NOT_CANONICALISABLE — class not autonomy-eligible"
 *
 * ADR-021, verbatim:
 *
 *   "Where an action class cannot be deterministically canonicalised, it is not eligible
 *    for autonomous execution — the same disqualifier logic 25 §7 applies to idempotency."
 *
 * `26 §11.2`'s exclusion table, last row, verbatim:
 *
 *   "Any class with no registered constructor | DENY: NOT_CANONICALISABLE at step C2 | §7"
 *
 * ---------------------------------------------------------------------------------
 * NO FALLBACK, AND NO DYNAMIC INTERPRETATION
 *
 * There is no default constructor. A lookup miss denies; it does not degrade to a generic
 * path. And a constructor cannot dynamically interpret arbitrary fields, because its input
 * type is closed: three properties, none of which is the raw intent and none of which is
 * `rationale`. Adding a class is a catalogue entry plus a constructor plus a signed
 * `ConstructorVersionRecord` — the friction ADR-006 calls intentional.
 *
 * The framework is generic over the closed catalogue and builds no vendor abstraction. A
 * later constructor plugs into `EffectConstructor` without any change here, and without
 * widening the input type, which is what keeps `I21` from eroding as the catalogue grows.
 * ---------------------------------------------------------------------------------
 */

/**
 * Everything a constructor produces. The canonicaliser core assembles the
 * `AuthorizationRequest` around it; the constructor owns the class-specific computation.
 */
export interface ConstructedEffect {
  readonly selectedOption: RecordedSelectedOption;
  readonly parameters: ComputedParameters;
  readonly exposure: Exposure;
  readonly counterparty: Counterparty | null;
  readonly customerNovelty: CustomerNovelty | null;
  readonly channel: string | null;
  readonly communicationExposure: Money | null;
  readonly windowRefs: readonly string[];
  readonly evidenceRefs: readonly string[];
  readonly dispatchPayload: DispatchPayload;
}

/**
 * A constructor's input. Three separate properties, deliberately not merged.
 *
 * There is no `rationale` here and no `ProposedIntent` here. A constructor physically
 * cannot read the fifth field, and `I21`'s four permitted fields arrive carrying the
 * `PermittedIntentField` brand so that "this came from the model" stays visible in types.
 */
export interface ConstructorInput {
  readonly permitted: PermittedIntentFields;
  readonly context: AuthoritativeCanonicalisationContext;
  readonly option: SelectedAuthoritativeOption;
  /**
   * The class's row from the CLOSED action catalogue — S1B.2, finding 1B.
   *
   * Read by the canonicaliser as `ACTION_CATALOGUE[intent.actionClass]` after `action_class`
   * has passed the closed-catalogue check, never supplied by the caller. There is no
   * catalogue entry on `AuthoritativeCanonicalisationContext` any more, so a caller cannot
   * hand a `refund.create` request another class's recoverability, value_direction, adapter
   * or method.
   */
  readonly catalogueEntry: ActionCatalogueEntry;
}

export type EffectConstructor = (input: ConstructorInput) => ConstructedEffect;

/**
 * ---------------------------------------------------------------------------------
 * THE REGISTERED CONSTRUCTOR OWNS PER-CLASS OPTION IDENTITY — S1B.2, finding 6
 *
 * `26 §2.2`, verbatim: "Declared per class in the action catalogue, and a change to any
 * digest definition is a semantic constructor bump". The original S1B core called
 * `refundSemanticOptionDigest` directly, so adding a second class meant editing the
 * canonicaliser — which contradicts the S1B contract's own statement that the closed
 * catalogue plus a registered constructor IS the extension point.
 *
 * So the per-class operations hang off the registration:
 *
 *   computeSemanticOptionDigest   `26 §2.2`'s per-class digest. The core content-addresses
 *                                 the selector against it and never names a class.
 *   assertInputCohesion           the per-class authoritative-input checks, run BEFORE
 *                                 construction so nothing is emitted from contradictory
 *                                 inputs (S1B.2 findings 1C and 1D).
 *
 * `EffectCanonicaliser` imports no per-class digest function and carries no per-class
 * branch; a class with no registration still denies `NOT_CANONICALISABLE` at step C2, and
 * there is still no generic fallback.
 * ---------------------------------------------------------------------------------
 */
export interface RegisteredConstructor {
  readonly actionClass: ActionClass;
  /** Resolved against a signed `ConstructorVersionRecord` before the body runs (`I61`). */
  readonly constructorId: string;
  /**
   * `26 §2.2`'s `semantic_option_digest` for THIS class, over the authoritative option.
   *
   * The definition lives with the constructor that computes the effect, because the two
   * must move together: `26 §2.1.2` makes a digest change semantic by definition.
   */
  readonly computeSemanticOptionDigest: (option: SelectedAuthoritativeOption) => Buffer;
  /**
   * Per-class cohesion of the authoritative inputs, asserted before construction.
   *
   * Fails closed. A contradiction between two kernel-owned inputs throws — no
   * `ProposedIntent` can produce one, so it is an internal defect. A contradiction between
   * a permitted intent field and the authoritative option denies, because the model can
   * produce that pair.
   */
  readonly assertInputCohesion: (input: ConstructorInput) => void;
  readonly construct: EffectConstructor;
}

export class ConstructorRegistry {
  readonly #byClass: ReadonlyMap<ActionClass, RegisteredConstructor>;

  constructor(constructors: readonly RegisteredConstructor[]) {
    const map = new Map<ActionClass, RegisteredConstructor>();
    for (const entry of constructors) {
      if (map.has(entry.actionClass)) {
        // Two constructors for one class means the dispatched amount depends on
        // registration order. That is a build defect, not a runtime condition.
        throw new Error(`duplicate constructor registered for ${entry.actionClass}`);
      }
      map.set(entry.actionClass, entry);
    }
    this.#byClass = map;
  }

  /** `undefined` on a miss. The caller denies; this class never substitutes. */
  get(actionClass: ActionClass): RegisteredConstructor | undefined {
    return this.#byClass.get(actionClass);
  }

  registeredClasses(): readonly ActionClass[] {
    return [...this.#byClass.keys()];
  }
}
