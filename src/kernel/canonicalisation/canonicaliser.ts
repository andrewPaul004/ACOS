import { toDb } from '../exposure/money.js';
import { computed } from './brands.js';
import { canonicalHash, hex } from './canonicalBytes.js';
import { ConstructorVersionResolver } from './constructorVersion.js';
import { deny } from './errors.js';
import { permittedFieldsOf, type ProposedIntent } from './intent.js';
import { intentHash } from './lineage.js';
import { computeOptionId, refundSemanticOptionDigest } from './optionDigest.js';
import type { ConstructorRegistry } from './registry.js';
import type {
  AuthoritativeCanonicalisationContext,
  AuthorizationRequest,
  CanonicalEffect,
  DispatchPayload,
  Exposure,
  SelectedAuthoritativeOption,
} from './types.js';

/**
 * The Effect Canonicaliser (`23 §5.2`), step C′ of `26 §7`.
 *
 * ADR-021's decision, verbatim, is the specification this implements:
 *
 *   "A deterministic component inside K4, positioned between schema validation and policy
 *    evaluation. Per action class it holds a versioned constructor that:
 *      1. fetches authoritative state itself, under the entity advisory lock (25 §14);
 *      2. enumerates the permissible effects for (action_class, resource);
 *      3. accepts the model's selector as an index into that enumeration and rejects
 *         anything else;
 *      4. computes exposure from the selected option, including per-class cost components
 *         [...];
 *      5. converts to the single ledger currency at a RECORD-grade FX rate [...];
 *      6. computes vendor parameters, counterparty identity and novelty, customer_novelty
 *         and recoverability;
 *      7. emits the AuthorizationRequest and the exact dispatch_payload together, hashed
 *         together."
 *
 * ---------------------------------------------------------------------------------
 * WHAT S1B IMPLEMENTS OF THAT LIST, AND WHAT IT DOES NOT
 *
 * Implemented: 3 (as a content-address check, see below), 4, 6 for this class, and 7.
 *
 * NOT implemented, and the S1B contract says so rather than implying otherwise:
 *   1. the entity advisory lock — the state arrives as a resolved authoritative input;
 *   2. enumeration — `enumerate_effects` is the next increment, with I52's context_spec
 *      projection, the quota, and the journal row;
 *   5. FX — the MVP is single-currency and `26 §11.2` excludes cross-currency classes.
 *
 * So step 3 here is NOT the C′ live-set resolution. It is the weaker, necessary check that
 * the model's `option_id` equals the one recomputed from the AUTHORITATIVE selected
 * option. `SELECTOR_STALE` and `I53`'s no-substitution rule belong to the increment that
 * re-enumerates under the lock; emitting them here would claim a check nobody performed.
 * See docs/implementation/S1B-owner-clarifications.md S1B-C7.
 * ---------------------------------------------------------------------------------
 */

export interface EffectCanonicaliserOptions {
  readonly registry: ConstructorRegistry;
  readonly versions: ConstructorVersionResolver;
}

export class EffectCanonicaliser {
  readonly #registry: ConstructorRegistry;
  readonly #versions: ConstructorVersionResolver;

  constructor(options: EffectCanonicaliserOptions) {
    this.#registry = options.registry;
    this.#versions = options.versions;
  }

  /**
   * Step C′. Emits the `AuthorizationRequest` and the `DispatchPayload` together.
   *
   * Denies, in `26 §7`'s order: `NOT_CANONICALISABLE` (no constructor, or an unverifiable
   * constructor version) before `SELECTOR_INVALID` (the option identity does not match).
   */
  canonicalise(
    intent: ProposedIntent,
    context: AuthoritativeCanonicalisationContext,
    option: SelectedAuthoritativeOption,
  ): CanonicalEffect {
    // --- step C2 -----------------------------------------------------------------------
    const registered = this.#registry.get(intent.actionClass);
    if (registered === undefined) {
      deny(
        'NOT_CANONICALISABLE',
        'NO_REGISTERED_CONSTRUCTOR',
        `no constructor registered for ${intent.actionClass}`,
      );
    }

    // --- I61: the version must resolve to a signed record BEFORE the body runs ---------
    const constructorVersion = this.#versions.resolve(
      registered.constructorId,
      intent.actionClass,
    );

    // --- the authoritative inputs must describe this intent -----------------------------
    if (option.actionClass !== intent.actionClass) {
      deny(
        'SELECTOR_INVALID',
        'OPTION_ACTION_CLASS_MISMATCH',
        'the authoritative option is for another action class',
      );
    }
    if (option.resourceId !== context.resource.resourceId) {
      deny(
        'SELECTOR_INVALID',
        'OPTION_RESOURCE_MISMATCH',
        'the authoritative option is for another resource',
      );
    }
    if (intent.selector.enumerationId !== context.enumerationRef.enumerationId) {
      deny(
        'SELECTOR_INVALID',
        'OPTION_ID_MISMATCH',
        'the selector names an enumeration other than the one resolved',
      );
    }

    // Step 3 in the weaker S1B form: the model's option_id must equal the one recomputed
    // from the authoritative option. `26 §2.2`: option_id = H(action_class ‖ resource_id ‖
    // semantic_option_digest).
    const recomputedOptionId = computeOptionId(
      intent.actionClass,
      option.resourceId,
      refundSemanticOptionDigest(option),
    );
    if (intent.selector.optionId !== recomputedOptionId) {
      deny(
        'SELECTOR_INVALID',
        'OPTION_ID_MISMATCH',
        'the selector does not content-address the authoritative option',
      );
    }

    // --- construct ----------------------------------------------------------------------
    const constructed = registered.construct({
      permitted: permittedFieldsOf(intent),
      context,
      option,
    });

    assertI18aAndI18c(context, constructed.exposure, constructed.dispatchPayload);

    const dispatchPayload = constructed.dispatchPayload;

    const request: AuthorizationRequest = {
      principal: context.principal,

      // The four fields I21 permits to cross, and no others.
      ...permittedFieldsOf(intent),

      resource: context.resource,
      selectedOption: computed(constructed.selectedOption),
      enumerationRef: context.enumerationRef,
      constructorVersion: computed(constructorVersion),
      parameters: computed(constructed.parameters),
      exposure: computed(constructed.exposure),
      recoverability: computed(context.catalogueEntry.recoverability),
      valueDirection: computed(context.catalogueEntry.valueDirection),
      counterparty: constructed.counterparty === null ? null : computed(constructed.counterparty),
      customerNovelty:
        constructed.customerNovelty === null ? null : computed(constructed.customerNovelty),
      channel: constructed.channel === null ? null : computed(constructed.channel),
      communicationExposure:
        constructed.communicationExposure === null
          ? null
          : computed(constructed.communicationExposure),
      windowRefs: computed(constructed.windowRefs),
      evidenceRefs: computed(constructed.evidenceRefs),
      contextDigest: context.contextDigest,
      // Lineage only. Commits to `rationale`; see lineage.ts and S1B-C1.
      intentHash: computed(intentHash(intent)),
      // `26 §2.1`: "binds this request to exactly one dispatch payload".
      dispatchPayloadHash: computed(dispatchPayloadHash(dispatchPayload)),
    };

    return { request, dispatchPayload };
  }
}

/**
 * The dispatch payload's canonical bytes, in declared field order.
 *
 * `26 §2.1`: the request and the payload are "emitted together and hashed together", and
 * `dispatch_payload_hash` is the field that binds them. Because the hash is taken over a
 * DECLARED field order rather than the object's own key order, an edit that reorders the
 * literal in `refundCreate.ts` cannot move it — which is the property
 * tests/canonicalisation/hash-binding.test.ts asserts directly.
 */
export function dispatchPayloadCanonicalHash(payload: DispatchPayload): Buffer {
  return canonicalHash('acos.dispatch_payload.v1', [
    { kind: 'text', value: payload.adapter },
    { kind: 'text', value: payload.method },
    { kind: 'json', value: { ...payload.vendorParameters } },
    { kind: 'text', value: payload.idempotencyKey },
    { kind: 'money', value: payload.monetaryEffect },
    { kind: 'text', value: payload.preconditionToken },
    { kind: 'text', value: payload.authorisationRef },
  ]);
}

export function dispatchPayloadHash(payload: DispatchPayload): string {
  return hex(dispatchPayloadCanonicalHash(payload));
}

/**
 * `I18a` and `I18c`, asserted by the kernel at construction time.
 *
 * Registry `I18a` and `I18c` on-violation column, verbatim, for both: "Critical incident.
 * The action class is suspended pending investigation." A canonicaliser that emitted a
 * violating pair would be handing policy an operand the invariants say cannot exist, so
 * this throws rather than denying: it is an internal defect, not a model-reachable
 * condition, and no `ProposedIntent` can cause it.
 *
 * `I18b` is NOT asserted here. It is an equality against `reservation.amount`, and S1B
 * takes no reservation — see `ports/reservationHandoff.ts` for the construction half.
 * `I18d` is a settlement assertion and there is no settlement path in S1B.
 */
function assertI18aAndI18c(
  context: AuthoritativeCanonicalisationContext,
  exposure: Exposure,
  payload: DispatchPayload,
): void {
  const carriesMoney = context.catalogueEntry.carriesVendorMonetaryField;

  // I18a, both branches.
  if (carriesMoney) {
    if (exposure.vendorAmount === null || payload.monetaryEffect === null) {
      throw new Error('I18a: a money-carrying class emitted a null vendor_amount or monetary_effect');
    }
    if (payload.monetaryEffect !== exposure.vendorAmount) {
      throw new Error(
        `I18a: dispatch monetary_effect ${toDb(payload.monetaryEffect)} != vendor_amount ${toDb(exposure.vendorAmount)}`,
      );
    }
  } else if (exposure.vendorAmount !== null || payload.monetaryEffect !== null) {
    throw new Error('I18a: a class carrying no vendor monetary field emitted a non-null amount');
  }

  // I18c, with the catalogue-declared equality carve-out.
  if (exposure.vendorAmount !== null) {
    if (exposure.totalExposure < exposure.vendorAmount) {
      throw new Error(
        `I18c: total_exposure ${toDb(exposure.totalExposure)} < vendor_amount ${toDb(exposure.vendorAmount)}`,
      );
    }
    if (
      !context.catalogueEntry.costComponentFree &&
      exposure.totalExposure === exposure.vendorAmount
    ) {
      // This is the retained-fee escape VC-C1 exists to detect, caught at the kernel as
      // well as by the independent fixture. `26 §2.1.1`: "a developer resolving the
      // contradiction by driving cost_components to zero silently restores the v1.0 defect
      // R1 exists to close."
      throw new Error(
        `I18c: total_exposure equals vendor_amount for ${context.catalogueEntry.actionClass}, which the catalogue does not declare cost-component-free`,
      );
    }
  }
}
