import { computed } from '../canonicalisation/brands.js';
import type { EffectCanonicaliser } from '../canonicalisation/canonicaliser.js';
import { deny } from '../canonicalisation/errors.js';
import type { ProposedIntent } from '../canonicalisation/intent.js';
import type { AuthoritativeGrantWindowContext } from '../canonicalisation/grantWindows.js';
import type {
  AuthoritativeCanonicalisationContext,
  CanonicalEffect,
  ResolvedPrincipal,
} from '../canonicalisation/types.js';
import type { KernelComputed } from '../canonicalisation/brands.js';
import type { Clock } from './clock.js';
import type { TaskContextSpec } from './contextSpec.js';
import type { HeldEntityLease } from './entityLease.js';
import type { EffectEnumerator } from './enumerateEffects.js';
import { findEnumerationRecord } from './enumerationRecord.js';
import { maxAgeSecondsFor } from './enumerationMaxAge.js';

/**
 * Step C′ — LIVE re-enumeration under the entity execution lease.
 *
 * `26 §7`'s C′ row, verbatim:
 *
 *   "The Effect Canonicaliser fetches authoritative state **under the entity advisory
 *    lock**, **re-enumerates** the permissible effects for `(action_class, resource)`,
 *    resolves `selector.option_id` against the **live** set, computes exposure […] **v1.2
 *    denials:** `SELECTOR_STALE` if the `option_id` is absent from the live set;
 *    `SELECTOR_ENUMERATION_STALE` if `enumeration_id.computed_at` exceeds the class's
 *    `max_age`; `SELECTOR_MALFORMED` if the pair does not parse; `NOT_CANONICALISABLE` if
 *    no constructor is registered for the class. **The kernel never substitutes another
 *    option** (I53)."
 *
 * Registry `I53`, verbatim: "No effect is dispatched whose `selector.option_id` was absent
 * from the enumeration computed under the step-C′ entity advisory lock."
 *
 * ---------------------------------------------------------------------------------
 * THE CALLER CANNOT HAND THIS BOUNDARY AN OPTION
 *
 * The S1C mandate: "The caller must not be able to hand C′ some different option after the
 * live set has been resolved."
 *
 * `canonicaliseUnderLease` takes the intent, the task `context_spec`, the kernel-owned
 * non-state context and a HELD lease. It takes NO option parameter, has no overload and has
 * no optional argument. The option is FOUND in the live set by the selector's own content
 * address, or the call denies.
 *
 * That is the difference between S1B and S1C stated as a type. S1B's
 * `EffectCanonicaliser.canonicalise(intent, context, option)` compares the model's
 * `option_id` against an authoritative option its CALLER supplied — which the S1B result
 * calls "necessary and not sufficient". This boundary supplies it from the live
 * re-enumeration instead.
 *
 * ---------------------------------------------------------------------------------
 * THE S1B CORE IS PRESERVED, NOT WEAKENED
 *
 * `EffectCanonicaliser` is called unchanged, with its types unwidened and its checks and
 * denial ordering intact. Its own `option_id` recomputation still runs and is now a
 * redundancy rather than the whole guarantee. Live option resolution sits AROUND the
 * accepted core rather than inside it.
 * ---------------------------------------------------------------------------------
 */

export interface LiveSelectorOptions {
  readonly enumerator: EffectEnumerator;
  readonly canonicaliser: EffectCanonicaliser;
  readonly clock: Clock;
}

/**
 * The kernel-owned context fields that are NOT derived from the resource's own state.
 *
 * Everything a canonicalisation needs which the enumeration cannot produce: the principal
 * the gateway resolved, the digest of the assembled context, the authorisation reference,
 * and the windows the matching grants reference.
 *
 * `resource`, `ledgerCurrency`, `customerNovelty`, `retainedProcessingFee` and
 * `enumerationRef` are DELIBERATELY ABSENT. Each is derived below from the live read or from
 * the kernel's own enumeration record, so no caller can supply one. A caller able to pass a
 * retained fee alongside a live-enumerated option could pair the right option with the wrong
 * economics — `26 §2.1.1`'s defect through a side door.
 */
export interface KernelSuppliedContext {
  readonly companyId: string;
  readonly principal: KernelComputed<ResolvedPrincipal>;
  readonly grantWindows: AuthoritativeGrantWindowContext;
  readonly contextDigest: string;
  readonly authorisationRef: string;
}

export class LiveSelectorCanonicaliser {
  readonly #enumerator: EffectEnumerator;
  readonly #canonicaliser: EffectCanonicaliser;
  readonly #clock: Clock;

  constructor(options: LiveSelectorOptions) {
    this.#enumerator = options.enumerator;
    this.#canonicaliser = options.canonicaliser;
    this.#clock = options.clock;
  }

  /**
   * Canonicalise `intent` against the LIVE option set, under a held entity execution lease.
   *
   * Denies, and never substitutes.
   */
  async canonicaliseUnderLease(
    lease: HeldEntityLease,
    intent: ProposedIntent,
    spec: TaskContextSpec,
    supplied: KernelSuppliedContext,
  ): Promise<CanonicalEffect> {
    // --- 0. the lease must be HELD ------------------------------------------------------
    //
    // `25 §14`: the advisory lock is on `(company_id, entity_type, entity_id)`. The
    // company half is checkable now; the entity id is not known until the enumeration
    // record resolves it, and the full key is asserted at step 4 before any option is read.
    lease.assertHeld();
    if (lease.key.companyId !== supplied.companyId) {
      throw new Error(
        `the entity execution lease is for company ${lease.key.companyId}, not ${supplied.companyId}`,
      );
    }

    // --- 1. the enumeration the selector NAMES ------------------------------------------
    //
    // `26 §2.0.1`: `enumeration_id` "names one EnumeratedOptionSet the kernel computed".
    // One, and a specific one — so it is looked up in kernel state rather than trusted.
    const record = await findEnumerationRecord(
      lease.client,
      supplied.companyId,
      intent.selector.enumerationId,
    );
    if (record === null) {
      deny(
        'SELECTOR_INVALID',
        'ENUMERATION_UNKNOWN',
        'the selector names an enumeration the kernel did not compute',
      );
    }

    // --- 2. the enumeration must BELONG to this proposal ---------------------------------
    //
    // Without these checks the `enumeration_id` half of the content-addressed pair carries
    // no information: a model could pair an enumeration taken against order A with an
    // `option_id` computed for order B, and the pair would be exactly as strong as the
    // `option_id` alone. Each field is compared against a value the KERNEL holds — task and
    // principal from the `context_spec`, class and ref from the intent's `I21` fields.
    if (
      record.taskId !== spec.taskId ||
      record.principalId !== spec.principalId ||
      record.actionClass !== intent.actionClass ||
      record.resourceRef !== intent.resourceRef
    ) {
      deny(
        'SELECTOR_INVALID',
        'ENUMERATION_BINDING_MISMATCH',
        'the named enumeration was not computed for this task, principal, action class and resource',
      );
    }

    // --- 3. the class's max_age -----------------------------------------------------------
    //
    // `26 §7` C′: "`SELECTOR_ENUMERATION_STALE` if `enumeration_id.computed_at` exceeds the
    // class's `max_age`". `now` is the INJECTED clock; `computed_at` is the kernel's own
    // record, never a model-supplied figure (`26 §1` Corollary 3).
    //
    // The enumeration is NOT silently reissued. The mandate forbids it, and so does the
    // reason behind it: reissuing would let a model hold one stale reading of the world
    // indefinitely while the kernel quietly refreshed the timestamp under it.
    const ageMs = this.#clock.now().getTime() - record.computedAt.getTime();
    const maxAgeMs = maxAgeSecondsFor(intent.actionClass) * 1000;
    if (ageMs > maxAgeMs) {
      deny(
        'SELECTOR_ENUMERATION_STALE',
        'ENUMERATION_PAST_MAX_AGE',
        `enumeration age ${String(ageMs)}ms exceeds the ${String(maxAgeMs)}ms max_age for ${intent.actionClass}`,
      );
    }

    // --- 4. resolve the resource AGAIN, and re-enumerate the LIVE set ---------------------
    //
    // Both happen inside `reEnumerate`, on the LEASE'S CLIENT, so `25 §14`'s "fetches
    // authoritative state under the entity advisory lock" is a property of the call rather
    // than of the call site's ordering. No new `enumeration_id` is minted.
    const live = await this.#enumerator.reEnumerate(lease, {
      actionClass: intent.actionClass,
      resourceRef: intent.resourceRef,
      spec,
    });

    // The FULL lock key, now that the resource id is known. An enumeration produced while
    // holding a lease for a DIFFERENT entity is not an enumeration under the lock.
    lease.assertHeld({
      companyId: supplied.companyId,
      entityType: lease.key.entityType,
      entityId: record.resourceId,
    });

    const resourceState = live.resourceState;
    if (resourceState === null) {
      // The resource resolved when the enumeration was taken and does not now — it was
      // deleted, demoted below RECORD grade, or moved out of the task's scope. The live set
      // is empty, so the `option_id` is absent from it, and `26 §7` C′ names that denial.
      // Reporting WHY would hand the worker exactly the existence oracle VC-C2 closes.
      deny(
        'SELECTOR_STALE',
        'OPTION_ABSENT_FROM_LIVE_SET',
        `the resource no longer resolves to enumerable RECORD-grade state (${live.internalFailure ?? 'UNKNOWN'})`,
      );
    }

    // --- 5. locate the EXACT option_id in the live set -------------------------------------
    //
    // `26 §7` C′: "`SELECTOR_STALE` if the `option_id` is absent from the live set". `I53`.
    //
    // The index is DISCOVERED BY the content address in this statement and discarded
    // immediately; it is not an input, is never returned, and nothing outside this function
    // observes it. That is the opposite of a positional selector, and the mandatory negative
    // control in `tests/negative-controls/unsafe-positional-selector.ts` is what makes the
    // difference visible rather than asserted.
    const index = live.set.options.findIndex(
      (option) => option.optionId === intent.selector.optionId,
    );
    if (index < 0) {
      // NO SUBSTITUTION. Not the nearest option, not the first option, not "the option now
      // at the position this one used to occupy". `53 §1`'s CAN-03 is exactly the case where
      // a plausible substitute is sitting right there, and the kernel declines it.
      deny(
        'SELECTOR_STALE',
        'OPTION_ABSENT_FROM_LIVE_SET',
        'the selected option_id is absent from the enumeration computed under the C′ entity lock',
      );
    }
    const modelFacing = live.set.options[index]!;
    const found = live.authoritative[index]!;

    // --- 5a. the option the MODEL actually read ------------------------------------------
    //
    // Taken from the kernel's RECORD of the enumeration, not from the live re-projection.
    // `26 §2.1` requires the request to record "the enumerated option whose `option_id` the
    // selector names, **with its full description**", and "the enumerated option" means the
    // one that was returned — not one rebuilt at C′ from whatever the task's `context_spec`
    // says by now.
    //
    // Without this the equality in step 9 would be a recomputation compared against itself:
    // both sides would come from the same `projectOptionDescription` call over the same live
    // option and the same spec, and a `context_spec` that changed between the READ and C′
    // would move BOTH halves together and silently record a description the model never saw.
    const recorded = record.options.find(
      (option) => option.optionId === intent.selector.optionId,
    );
    if (recorded === undefined) {
      // The `option_id` is live but was not in the enumeration the selector names. The model
      // is addressing an option it did not read — possibly one it constructed, possibly one
      // from another enumeration. The live set cannot vouch for it.
      deny(
        'SELECTOR_INVALID',
        'OPTION_NOT_IN_NAMED_ENUMERATION',
        'the selected option_id is live but was not returned by the enumeration the selector names',
      );
    }

    // --- 6. assemble the authoritative context from LIVE STATE ONLY ------------------------
    //
    // `26 §2.1`: "every field below is kernel-computed". The resource, the ledger currency,
    // the customer novelty and the retained fee come from the live re-enumeration; the
    // `enumeration_ref` comes from the kernel's own record; the remaining four come from the
    // kernel-supplied context. None comes from `ProposedIntent`.
    const context: AuthoritativeCanonicalisationContext = {
      companyId: computed(supplied.companyId),
      taskId: computed(spec.taskId),
      principal: supplied.principal,
      resource: computed(resourceState.resource),
      // `26 §2.1`: "enumeration_ref — the enumeration_id and its computed_at, for lineage".
      // The id the MODEL named, and the `computed_at` the KERNEL recorded for it.
      enumerationRef: computed({
        enumerationId: record.enumerationId,
        computedAt: record.computedAt,
      }),
      ledgerCurrency: computed(resourceState.ledgerCurrency),
      retainedProcessingFee:
        found.retainedProcessingFee === null ? null : computed(found.retainedProcessingFee),
      grantWindows: computed(supplied.grantWindows),
      customerNovelty:
        resourceState.customerNovelty === null ? null : computed(resourceState.customerNovelty),
      contextDigest: computed(supplied.contextDigest),
      authorisationRef: computed(supplied.authorisationRef),
      // `I52`: the projection the description was produced by. One spec, one projection.
      contextSpec: computed(spec),
    };

    // --- 7. canonicalise with the EXACT live option found ----------------------------------
    //
    // The accepted S1B core, unchanged. It recomputes `option_id` from this option and
    // compares it against the selector again — a redundancy on the money path, left in
    // deliberately, because it is cheap and its absence would be discovered late.
    const effect = this.#canonicaliser.canonicalise(intent, context, found.option);

    // --- 8. I53, ASSERTED rather than assumed -----------------------------------------------
    //
    // Registry `I53`'s on-violation column: "A dispatched effect whose `option_id` is not in
    // the journaled C′ enumeration is a **critical incident**." So this THROWS rather than
    // denying: no `ProposedIntent` can produce it, and a mismatch means the boundary and the
    // core disagree about option identity — a defect, not a proposal.
    if (effect.request.selectedOption.optionId !== intent.selector.optionId) {
      throw new Error(
        `I53: the canonicalised option_id ${effect.request.selectedOption.optionId} is not the selected ${intent.selector.optionId}`,
      );
    }

    // --- 9. the recorded description IS THE ONE THE MODEL SAW --------------------------------
    //
    // `26 §2.1`: `selected_option` is "the enumerated option whose `option_id` the selector
    // names, **with its full description**".
    //
    // THREE strings must agree, and they have three different provenances, which is what
    // makes this an assertion rather than a tautology:
    //
    //   effect.request.selectedOption.description   built by the CONSTRUCTOR, through the
    //                                               shared projection over the live option
    //   modelFacing.description                     the LIVE re-enumeration's projection
    //   recorded.description                        the string the model ACTUALLY READ,
    //                                               from the kernel's enumeration record
    //
    // The first two share inputs, so their agreement is by construction and catches only an
    // ad-hoc description reintroduced in a constructor. The THIRD is the real check: it is a
    // value stored before the model ever proposed, so a `context_spec` that changed between
    // the READ and C′ — narrowing or widening what the task may see — moves the first two
    // together and separates them from this one.
    //
    // It THROWS rather than denying. `context_spec`s are control artifacts (`23 §5` B9) and
    // `I52`'s on-violation column calls a description carrying an out-of-scope field "a
    // security incident"; a description that does not match what was shown is the same class
    // of event and no `ProposedIntent` can cause it.
    if (
      effect.request.selectedOption.description !== modelFacing.description ||
      effect.request.selectedOption.description !== recorded.description
    ) {
      throw new Error(
        'I52: the recorded selected-option description is not the projected description the model was shown',
      );
    }

    return effect;
  }
}
