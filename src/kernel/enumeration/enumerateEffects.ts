import { isActionClass, type ActionClass } from '../canonicalisation/actionCatalogue.js';
import type { ConstructorVersionResolver } from '../canonicalisation/constructorVersion.js';
import { deny } from '../canonicalisation/errors.js';
import type { ConstructorRegistry } from '../canonicalisation/registry.js';
import { computeOptionId } from '../canonicalisation/optionDigest.js';
import type { Client } from '../../db/pool.js';
import type { Clock } from './clock.js';
import {
  admitsResource,
  projectOptionDescription,
  type OptionDescriptionField,
  type TaskContextSpec,
} from './contextSpec.js';
import type { HeldEntityLease } from './entityLease.js';
import type { EnumeratedOption, EnumeratedOptionSet } from './enumeratedOptionSet.js';
import { computeEnumerationId, insertEnumerationRecord } from './enumerationRecord.js';
import type { AuthoritativeResourceState, EnumeratedAuthoritativeOption, ResourceResolutionFailure } from './port.js';

/**
 * `enumerate_effects(action_class, resource_ref)` — the READ the model needs.
 *
 * `26 §2.0.1`, the property table, verbatim:
 *
 *   | Capability kind | **READ.** It creates no effect, reserves nothing and dispatches
 *   |                   nothing. |
 *   | Field visibility | Governed by the task's `context_spec`. **No field appears in any
 *   |                   option `description` that the `context_spec` does not admit**
 *   |                   (`I52`) […] |
 *   | Resource scope  | `resource_ref` must resolve to a RECORD-grade entity inside the
 *   |                   task's `context_spec` scope […] |
 *
 * ---------------------------------------------------------------------------------
 * THE CORE CARRIES NO PER-CLASS BRANCH
 *
 * This file imports no refund module, names no commerce table, and mentions
 * `refund.create` nowhere. State resolution and enumeration reach it through the
 * registered constructor's `liveEnumerator` (`port.ts`), and option identity reaches it
 * through the registration's `computeSemanticOptionDigest` — the same path
 * `EffectCanonicaliser` uses, so there is exactly one refund digest in the tree and exactly
 * one definition of "the live set".
 *
 * That is S1B.2 finding 6's discipline applied to the enumeration: adding a class adds a
 * registration, not an edit here.
 * ---------------------------------------------------------------------------------
 */

export interface EnumerateEffectsOptions {
  readonly registry: ConstructorRegistry;
  readonly versions: ConstructorVersionResolver;
  readonly clock: Clock;
}

/**
 * The internal result. The model-facing projection is `modelFacingOptionSet` below.
 *
 * `26 §2.0.1`'s resource-scope row says an out-of-scope reference "denies"; `36 §2` VC-C2
 * says it "returns an **empty set** rather than a denial that leaks existence". Those are
 * the same requirement stated from two sides, and VC-C2 states the EXTERNAL behaviour, which
 * is the one a worker observes. So the set is empty and `failure` records which condition it
 * was — for the audit/event layer, never for the worker.
 */
export interface EnumerationOutcome {
  readonly set: EnumeratedOptionSet;
  /**
   * Null on a normal enumeration, INCLUDING one that legitimately has no options.
   *
   * A resource in scope with nothing currently refundable and a resource the task may not
   * see return the SAME model-facing value — an empty set. They differ only here.
   */
  readonly internalFailure: ResourceResolutionFailure | null;
  /**
   * The kernel-side options, in the same order as `set.options`.
   *
   * Never returned to a worker. Present so a caller inside the kernel (and the S1C tests)
   * can relate a model-facing `option_id` back to the authoritative option it addresses
   * without re-enumerating.
   */
  readonly authoritative: readonly EnumeratedAuthoritativeOption[];
  /**
   * The resolved authoritative resource, or null where nothing resolved.
   *
   * Kernel-side. The C′ boundary builds its `AuthoritativeCanonicalisationContext` from
   * this, so the ledger currency, the customer novelty and the resource itself all come
   * from the live read rather than from any caller.
   */
  readonly resourceState: AuthoritativeResourceState | null;
}

export interface EnumerateEffectsRequest {
  readonly actionClass: string;
  readonly resourceRef: string;
  readonly spec: TaskContextSpec;
}

export class EffectEnumerator {
  readonly #registry: ConstructorRegistry;
  readonly #versions: ConstructorVersionResolver;
  readonly #clock: Clock;

  constructor(options: EnumerateEffectsOptions) {
    this.#registry = options.registry;
    this.#versions = options.versions;
    this.#clock = options.clock;
  }

  /**
   * Enumerate, and RECORD the enumeration.
   *
   * The record is written on the lease's client, so the enumeration and its record are one
   * consistent act. See `enumerationRecord.ts` for why the record exists and for the
   * explicit statement that it is not the VC-C2 READ journal.
   */
  async enumerate(
    lease: HeldEntityLease,
    request: EnumerateEffectsRequest,
  ): Promise<EnumerationOutcome> {
    lease.assertHeld();
    return this.#enumerate(lease.client, request, true);
  }

  /**
   * Re-enumerate the LIVE set under a held lease, WITHOUT writing a new record.
   *
   * This is step C′'s re-enumeration. It must not mint a new `enumeration_id`: the selector
   * names the enumeration the model actually read, and issuing a fresh one at C′ is the
   * "silently reissue the enumeration" the S1C mandate forbids under §9.
   */
  async reEnumerate(
    lease: HeldEntityLease,
    request: EnumerateEffectsRequest,
  ): Promise<EnumerationOutcome> {
    lease.assertHeld();
    return this.#enumerate(lease.client, request, false);
  }

  async #enumerate(
    client: Client,
    request: EnumerateEffectsRequest,
    record: boolean,
  ): Promise<EnumerationOutcome> {
    const { spec } = request;

    // --- 1. the CLOSED action class ----------------------------------------------------
    // `26 §7` step C: "action_class in closed catalogue?" -> no -> "DENY: UNKNOWN_ACTION".
    // This is not an existence question about a resource, so it denies rather than
    // returning empty: the catalogue is a published control artifact (`23 §5` B9) and a
    // model learning that `refund.creat` is not a class learns nothing about the company.
    if (!isActionClass(request.actionClass)) {
      deny(
        'UNKNOWN_ACTION',
        'ACTION_CLASS_NOT_IN_CATALOGUE',
        'action_class is not in the catalogue',
      );
    }
    const actionClass: ActionClass = request.actionClass;

    // --- 2. a REGISTERED constructor ---------------------------------------------------
    // `26 §7` step C2 and `26 §11.2`'s exclusion table: "Any class with no registered
    // constructor | DENY: NOT_CANONICALISABLE at step C2". A class ACOS cannot canonicalise
    // is a class it must not enumerate either — offering options for an effect that can
    // never be constructed is an invitation to propose one.
    const registered = this.#registry.get(actionClass);
    if (registered === undefined) {
      deny(
        'NOT_CANONICALISABLE',
        'NO_REGISTERED_CONSTRUCTOR',
        `no constructor registered for ${actionClass}`,
      );
    }

    // --- 3. the VERIFIED constructor version, before any state is read ------------------
    // `I61`: "Every AuthorizationRequest, AuthorizationDecision, journal row and approval
    // binding records a constructor_version resolving to a signed ConstructorVersionRecord."
    // `26 §2.0.1` puts `constructor_version` on the EnumeratedOptionSet too, so the READ
    // resolves and verifies it exactly as C′ does — and denies NOT_CANONICALISABLE if it
    // cannot, rather than enumerating under an unverifiable constructor.
    const constructorVersion = this.#versions.resolve(registered.constructorId, actionClass);

    // --- 4. the context_spec RESOURCE SCOPE, before any query --------------------------
    //
    // `24 §3` K4, on what AI may not do: "Enumerate outside the resource set its
    // context_spec admits."
    //
    // Checked BEFORE the database is touched, deliberately. A query issued against an
    // out-of-scope resource is observable in time even when its result is discarded, and a
    // timing-distinguishable empty set is a weaker version of the oracle the empty set
    // exists to close.
    if (!admitsResource(spec, request.resourceRef)) {
      return this.#empty(spec, actionClass, request.resourceRef, constructorVersion, 'OUT_OF_CONTEXT_SPEC_SCOPE');
    }

    // --- 5. resolve the resource from AUTHORITATIVE state -------------------------------
    const resolution = await registered.liveEnumerator.resolveResource(
      client,
      spec.companyId,
      request.resourceRef,
    );
    if (!resolution.ok) {
      // `36 §2` VC-C2: "an empty set rather than a denial that leaks existence". ABSENT and
      // NOT_RECORD_GRADE join OUT_OF_SCOPE here because distinguishing any PAIR of the three
      // rebuilds the oracle — see `port.ts`.
      return this.#empty(spec, actionClass, request.resourceRef, constructorVersion, resolution.failure);
    }
    const state: AuthoritativeResourceState = resolution.state;

    // --- 6. enumerate the CURRENT permissible effects -----------------------------------
    const authoritative = await registered.liveEnumerator.enumerate(
      client,
      spec.companyId,
      state,
      spec,
    );

    // --- 7. option identity, through the REGISTERED constructor -------------------------
    // `26 §2.2`: option_id = H(action_class ‖ resource_id ‖ semantic_option_digest). The
    // same call `EffectCanonicaliser` makes, so the enumeration and C′ cannot disagree about
    // what an option's identity is.
    //
    // --- 8. the description, through the ONE context_spec projection --------------------
    // `I52`. `optionDescriptionFields` is declared by the constructor; the filter and the
    // rendering are `contextSpec.ts`'s, so a class cannot render past the filter.
    const options: EnumeratedOption[] = authoritative.map((entry) => ({
      optionId: computeOptionId(
        actionClass,
        entry.option.resourceId,
        registered.computeSemanticOptionDigest(entry.option),
      ),
      description: projectOptionDescription(
        spec,
        actionClass,
        registered.optionDescriptionFields(entry.option),
      ),
    }));

    // --- 9. computed_at, from the INJECTED clock ----------------------------------------
    const computedAt = this.#clock.now();

    // --- 10. the opaque enumeration_id ---------------------------------------------------
    const enumerationId = computeEnumerationId({
      companyId: spec.companyId,
      taskId: spec.taskId,
      principalId: spec.principalId,
      actionClass,
      resourceRef: request.resourceRef,
      computedAt,
      constructorVersion,
      options,
    });

    if (record) {
      await insertEnumerationRecord(client, {
        companyId: spec.companyId,
        enumerationId,
        taskId: spec.taskId,
        principalId: spec.principalId,
        actionClass,
        resourceRef: request.resourceRef,
        resourceId: state.resource.resourceId,
        computedAt,
        constructorId: constructorVersion.constructorId,
        constructorSemanticMajor: constructorVersion.semanticMajor,
        constructorNonSemanticMinor: constructorVersion.nonSemanticMinor,
        constructorRecordHash: constructorVersion.recordHash,
        options,
        // `25 §14.1` (v1.3.5, SER-01). The scope this set was computed under, so the
        // dispatch-time re-enumeration one epoch later runs under the SAME one and no
        // dispatch surface needs a `context_spec` parameter.
        contextSpec: spec,
      });
    }

    return {
      set: { enumerationId, computedAt, constructorVersion, options },
      internalFailure: null,
      authoritative,
      resourceState: state,
    };
  }

  /**
   * The candidate description fields for one authoritative option, through its registration.
   *
   * Exposed so the C′ boundary can re-project a description with the SAME function the
   * enumeration used. It carries no class branch: the registration supplies the fields and
   * `contextSpec.ts` supplies the filter.
   */
  optionDescriptionFieldsFor(
    actionClass: ActionClass,
    option: EnumeratedAuthoritativeOption['option'],
  ): readonly OptionDescriptionField[] {
    const registered = this.#registry.get(actionClass);
    if (registered === undefined) {
      deny(
        'NOT_CANONICALISABLE',
        'NO_REGISTERED_CONSTRUCTOR',
        `no constructor registered for ${actionClass}`,
      );
    }
    return registered.optionDescriptionFields(option);
  }

  /**
   * The empty set an unenumerable resource produces.
   *
   * ---------------------------------------------------------------------------------
   * IT IS BYTE-IDENTICAL TO A LEGITIMATELY EMPTY ENUMERATION, AND THAT IS THE POINT
   *
   * `36 §2` VC-C2: "an **empty set** rather than a denial that leaks existence". An empty
   * list is not sufficient on its own — every OTHER field of the returned set must also be
   * what an in-scope, RECORD-grade resource with nothing currently refundable would have
   * produced. Otherwise the identifier becomes the oracle the list no longer is.
   *
   * S1C found exactly that by test. An earlier version substituted empty strings for the
   * fields it could not resolve, which gave every refusal ONE shared `enumeration_id`
   * while a legitimate empty enumeration got a per-resource one — so a prober could
   * separate "exists, in scope, nothing refundable" from "out of scope, absent, or not
   * RECORD grade" by comparing two ids. The repair was to drop the resolved `resource_id`
   * from the id's preimage (see `computeEnumerationId`) and to build the refusal id from
   * the SAME real inputs the success path uses.
   *
   * So this path takes the real company, task, principal, class and `resource_ref`, a real
   * `computed_at` and the real verified `constructor_version`, over an empty option list.
   * Nothing here is a sentinel.
   *
   * No `enumeration_record` row is written. There is nothing to resolve later: an empty set
   * contains no `option_id`, so no selector can ever address it, and a C′ that cannot find
   * the id denies on the enumeration lookup — with the same coarse `DENY: SELECTOR` the
   * worker receives for every other selector failure.
   * ---------------------------------------------------------------------------------
   */
  #empty(
    spec: TaskContextSpec,
    actionClass: ActionClass,
    resourceRef: string,
    constructorVersion: EnumeratedOptionSet['constructorVersion'],
    failure: ResourceResolutionFailure,
  ): EnumerationOutcome {
    const computedAt = this.#clock.now();
    return {
      set: {
        enumerationId: computeEnumerationId({
          companyId: spec.companyId,
          taskId: spec.taskId,
          principalId: spec.principalId,
          actionClass,
          resourceRef,
          computedAt,
          constructorVersion,
          options: [],
        }),
        computedAt,
        constructorVersion,
        options: [],
      },
      internalFailure: failure,
      authoritative: [],
      resourceState: null,
    };
  }
}

/**
 * The MODEL-FACING projection of an enumeration.
 *
 * The one value a worker receives. `internalFailure` and `authoritative` do not cross this
 * boundary, and there is no field on `EnumeratedOptionSet` that could carry them.
 *
 * `26 §2.0.1`: the returned set is `{ enumeration_id, computed_at, constructor_version,
 * options[{ option_id, description }] }` and nothing else.
 */
export function modelFacingOptionSet(outcome: EnumerationOutcome): EnumeratedOptionSet {
  return outcome.set;
}
