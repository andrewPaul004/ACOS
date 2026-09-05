import type { Money } from '../exposure/money.js';
import type { ActionClass } from './actionCatalogue.js';
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
}

export type EffectConstructor = (input: ConstructorInput) => ConstructedEffect;

export interface RegisteredConstructor {
  readonly actionClass: ActionClass;
  /** Resolved against a signed `ConstructorVersionRecord` before the body runs (`I61`). */
  readonly constructorId: string;
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
