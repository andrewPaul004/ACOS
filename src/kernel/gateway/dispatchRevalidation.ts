import type { EffectEnumerator } from '../enumeration/enumerateEffects.js';
import { findEnumerationRecord } from '../enumeration/enumerationRecord.js';
import { entityKeyForResourceRef, underlyingLeaseFor, type HeldDispatchLease } from './dispatchLease.js';

/**
 * DISPATCH-TIME REVALIDATION. `25 §14.1`, v1.3.5 (SER-01, S1J-C6).
 *
 * =================================================================================
 * THE DECLARATION, VERBATIM, AND IT IS THE WHOLE SPECIFICATION OF THIS FILE
 *
 * `25 §14.1`: "**DISPATCH-TIME REVALIDATION IS MANDATORY, AND A CLAIM MAY NOT OCCUR BEFORE
 * IT.**
 *
 *   Under the dispatch lease and **before** the claim, the **originally authorised effect**
 *   is revalidated against **current authoritative resource state**, using the original
 *   `action_class`, the original resource identity, the original enumeration/option identity
 *   and the original constructor/version identity. This is the **equivalent of step C′'s
 *   content-addressed non-substitution check**, performed one epoch later, and `I53` [...]
 *   is the invariant it discharges at the dispatch boundary.
 *
 *   **THE QUESTION IS ONLY WHETHER THE ORIGINALLY AUTHORISED EFFECT IS STILL A VALID CURRENT
 *   EFFECT.** No new payload is constructed. No different option is substituted. **The
 *   persisted payload remains the exact authorised payload**, and revalidation neither reads
 *   it as a candidate nor replaces it."
 *
 * `30 §5.1`'s ordering block places it, and names the two ways to get it wrong:
 *
 *   "**A claim that occurs before revalidation is a defect of this class**, and **a
 *    revalidation performed outside the dispatch lease proves nothing**, because the state
 *    it read could be mutated before the claim commits."
 * =================================================================================
 *
 * =================================================================================
 * WHAT THIS FUNCTION CANNOT DO, AS A PROPERTY OF ITS SIGNATURE AND ITS RETURN TYPE
 *
 * It returns `VALID` or `STALE`. There is no arm carrying an option, a payload, a hash, a
 * substitute, a candidate list or a "closest match", so `25 §14.1`'s three prohibitions —
 * no new payload, no substituted option, no rebuilt dispatch bytes — are properties of the
 * type rather than of a review of the body.
 *
 * IT DOES NOT CALL THE CANONICALISER. `liveSelector.ts`'s `canonicaliseUnderLease` is C′ and
 * it CONSTRUCTS a `CanonicalEffect`; calling it here would produce exactly the "recanonicalise
 * a new dispatch payload" the mandate's `§27` forbids, even if the result were discarded.
 * What runs instead is `EffectEnumerator.reEnumerate` — the accepted S1C re-enumeration,
 * which mints no `enumeration_id`, writes no row and produces no effect — followed by a
 * membership test on the ORIGINAL `option_id`.
 *
 * `tests/integration/gateway/no-real-transport-boundary.test.ts` asserts that the gateway
 * directory imports no constructor and no canonicaliser, and that assertion is UNAMENDED by
 * this file: `reEnumerate` reaches the registered constructor's enumerator through the
 * accepted enumeration core, which is where the per-class knowledge already lives.
 * =================================================================================
 *
 * =================================================================================
 * THE `max_age` CHECK IS DELIBERATELY NOT PERFORMED HERE, AND THAT IS NOT AN OMISSION
 *
 * C′ performs two staleness checks (`26 §7`): `SELECTOR_ENUMERATION_STALE` if the
 * enumeration's `computed_at` exceeds the class's `max_age`, and `SELECTOR_STALE` if the
 * `option_id` is absent from the live set. `25 §14.1` names ONLY the second kind of question
 * for the dispatch boundary — "whether the originally authorised effect is still a valid
 * current effect" — and `I53` is the invariant it cites, which is the live-set clause.
 *
 * Applying `max_age` here would refuse EVERY dispatch: `25 §7`'s outbox exists so a row may
 * be claimed "later, after a restart, possibly by a different worker", and any such delay
 * exceeds an enumeration `max_age` measured in minutes. A check that refuses every input is
 * not a control, and enforcing it would delete the mechanism `25 §7` exists to provide.
 *
 * What replaces it is stronger and is what the architecture actually asks for: the option is
 * re-checked against the LIVE set at the dispatch instant, so an enumeration's age is
 * irrelevant — what matters is whether the world still admits the effect NOW.
 * =================================================================================
 *
 * =================================================================================
 * COARSE OUTWARD, PRECISE INWARD — `§28` AND `26 §2.2`
 *
 * "Use coarse external denial. Record precise internal reason."
 *
 * `DispatchStaleReason` below is the PRECISE internal reason and it is returned to the
 * KERNEL — `effectGateway.ts` collapses every member of it to one refusal literal with a
 * fixed detail string, exactly as `workerFacingDenial.ts` collapses the four selector codes
 * to one `SELECTOR` category, and for the same reason `26 §7` gives: "A model that learns
 * 'denied: amount exceeded by $3' has been handed a probing oracle." Distinguishing
 * "your option is gone" from "the resource is gone" at the dispatch boundary would hand a
 * dispatch-capable caller an existence oracle over the resource.
 * =================================================================================
 */

/**
 * Why the originally authorised effect is no longer a valid current effect.
 *
 * INTERNAL. Every member collapses to one coarse literal at the gateway boundary.
 */
export const DISPATCH_STALE_REASONS = [
  /** No committed outbox row, or its effect/authorisation did not resolve. */
  'AUTHORISED_EFFECT_NOT_FOUND',
  /**
   * The authorisation carries no enumeration/option identity, or its enumeration carries no
   * persisted task scope.
   *
   * FAIL-CLOSED, AND NOT A PASS. `25 §14.1` makes the revalidation MANDATORY, so an effect
   * whose original identity cannot be recovered is an effect that cannot be revalidated —
   * and an unrevalidatable effect must not be dispatched. `51 §2.3`'s rule about undeclared
   * catalogue dimensions applies to an absent identity for the same reason: "no implicit
   * default may widen authority".
   *
   * The rate branch reaches this arm by construction: it never traverses C′ (`26 §7` step
   * C2, no registered constructor for `campaign.budget.set`), so it has no enumeration and
   * no option. That is the correct answer for it — a class ACOS cannot revalidate is a class
   * it must not dispatch under `25 §14.1` — and it is recorded in the S1J owner resolution.
   */
  'REVALIDATION_IDENTITY_ABSENT',
  /** The named enumeration is no longer in kernel state. */
  'ENUMERATION_RECORD_ABSENT',
  /**
   * The named enumeration was not computed for this effect's class, resource ref or resolved
   * resource id. The `26 §2.0.1` binding check, one epoch later.
   */
  'ENUMERATION_BINDING_MISMATCH',
  /**
   * `25 §14.1`'s "original constructor/version identity". The class is now enumerated under a
   * different constructor version than the one that authorised the effect, so the live set
   * is not comparable to the authorised one.
   */
  'CONSTRUCTOR_VERSION_CHANGED',
  /**
   * The resource no longer resolves to enumerable RECORD-grade state. `26 §7` C′'s
   * `OPTION_ABSENT_FROM_LIVE_SET` case, reached through an empty live set.
   */
  'RESOURCE_NO_LONGER_RESOLVES',
  /**
   * `I53`, at the dispatch boundary: "no effect is dispatched whose `selector.option_id` was
   * absent from the live enumeration."
   *
   * THE DISCRIMINATING CASE. `dispatch-gap-revalidation.test.ts` mutates the authoritative
   * resource during the asynchronous gap so the authorised option is no longer permissible,
   * and asserts that production refuses the claim with ZERO adapter invocations while the
   * vulnerable control — which trusts enqueue-time validity — claims and invokes.
   */
  'OPTION_ABSENT_FROM_LIVE_SET',
] as const;

export type DispatchStaleReason = (typeof DISPATCH_STALE_REASONS)[number];

export type DispatchRevalidation =
  | {
      readonly kind: 'VALID';
      /** Echoed for the audit trail. Never a substitute and never a candidate. */
      readonly actionClass: string;
      readonly resourceRef: string;
      readonly optionId: string;
      readonly enumerationId: string;
    }
  | { readonly kind: 'STALE'; readonly reason: DispatchStaleReason; readonly detail: string };

interface RevalidationIdentityRow {
  readonly action_class: string;
  readonly resource_ref: string;
  readonly resource_id: string;
  readonly enumeration_id: string | null;
  readonly option_id: string | null;
  readonly constructor_id: string;
  readonly constructor_semantic_major: number;
  readonly constructor_non_semantic_minor: number;
}

/**
 * Revalidate the ORIGINALLY AUTHORISED effect against CURRENT authoritative state.
 *
 * =================================================================================
 * EVERY IDENTITY OPERAND IS READ FROM COMMITTED IMMUTABLE STATE, ON THE LEASE'S CLIENT
 *
 * The `dispatch_outbox` row is append-only past `CLAIMED`, `effect` and `authorisation`
 * carry `acos_append_only` triggers, and `enumeration_record` is written once with
 * `ON CONFLICT DO NOTHING` under a content-addressed key. So the "original" half of the
 * comparison cannot have moved, and the only moving part is the live enumeration — which is
 * the half that is SUPPOSED to move.
 *
 * Every query runs on `lease.client`, the connection holding the Epoch-B session lock, so
 * `30 §5.1`'s "a revalidation performed outside the dispatch lease proves nothing" is a
 * property of the call rather than of the call site's ordering. `assertHeld` is called
 * first, and again against the full entity key once the resource ref is known.
 * =================================================================================
 */
export async function revalidateAuthorisedEffectUnderLease(
  lease: HeldDispatchLease,
  enumerator: EffectEnumerator,
  identity: { readonly companyId: string; readonly idempotencyKey: string },
): Promise<DispatchRevalidation> {
  lease.assertHeld();

  // --- 1. the ORIGINAL identity, from committed rows ------------------------------------
  const found = await lease.client.query<RevalidationIdentityRow>(
    `SELECT o.action_class,
            o.resource_ref,
            a.resource_id,
            a.enumeration_id,
            a.option_id,
            a.constructor_id,
            a.constructor_semantic_major,
            a.constructor_non_semantic_minor
       FROM dispatch_outbox o
       JOIN effect e        ON e.effect_id = o.effect_id AND e.company_id = o.company_id
       JOIN authorisation a ON a.authorisation_id = e.authorisation_id
      WHERE o.company_id = $1 AND o.idempotency_key = $2`,
    [identity.companyId, identity.idempotencyKey],
  );
  const original = found.rows[0];
  if (original === undefined) {
    return {
      kind: 'STALE',
      reason: 'AUTHORISED_EFFECT_NOT_FOUND',
      detail: `no committed outbox row for ${identity.companyId}/${identity.idempotencyKey}`,
    };
  }

  // The FULL lock key. A revalidation performed while holding a lease for a DIFFERENT entity
  // is not a revalidation under the lock, and `25 §14.1` requires the SAME key as Epoch A's.
  lease.assertHeld(entityKeyForResourceRef(identity.companyId, original.resource_ref));

  if (original.enumeration_id === null || original.option_id === null) {
    return {
      kind: 'STALE',
      reason: 'REVALIDATION_IDENTITY_ABSENT',
      detail:
        'the authorisation carries no enumeration/option identity, so the originally ' +
        'authorised effect cannot be revalidated against current state (25 §14.1)',
    };
  }

  // --- 2. the enumeration the selector NAMED, and its BINDING ---------------------------
  const record = await findEnumerationRecord(
    lease.client,
    identity.companyId,
    original.enumeration_id,
  );
  if (record === null) {
    return {
      kind: 'STALE',
      reason: 'ENUMERATION_RECORD_ABSENT',
      detail: `enumeration ${original.enumeration_id} is no longer in kernel state`,
    };
  }
  if (
    record.actionClass !== original.action_class ||
    record.resourceRef !== original.resource_ref ||
    record.resourceId !== original.resource_id
  ) {
    return {
      kind: 'STALE',
      reason: 'ENUMERATION_BINDING_MISMATCH',
      detail:
        'the recorded enumeration was not computed for this effect’s action class, ' +
        'resource ref and resolved resource id (26 §2.0.1, 25 §14.1)',
    };
  }
  // `25 §14.1`'s "original constructor/version identity", compared BEFORE any live read: a
  // set enumerated under a different constructor version is not comparable to the authorised
  // one, and comparing them anyway would be the substitution the section forbids.
  if (
    record.constructorId !== original.constructor_id ||
    record.constructorSemanticMajor !== original.constructor_semantic_major ||
    record.constructorNonSemanticMinor !== original.constructor_non_semantic_minor
  ) {
    return {
      kind: 'STALE',
      reason: 'CONSTRUCTOR_VERSION_CHANGED',
      detail:
        `the authorisation was constructed under ${original.constructor_id} ` +
        `v${String(original.constructor_semantic_major)}.` +
        `${String(original.constructor_non_semantic_minor)} and the recorded enumeration ` +
        'under a different version (26 §2.1.2, I61)',
    };
  }

  // --- 3. the KERNEL-OWNED task scope this enumeration ran under -------------------------
  //
  // Read from the enumeration record, NEVER from a dispatch-time caller. `24 §3` K4, on what
  // AI may not do: "Enumerate outside the resource set its context_spec admits." A scope
  // supplied at the dispatch boundary would let a caller widen it one epoch after the gates
  // ran — and, because `refund.create`'s `semantic_option_digest` includes the task's
  // `reason_code_scope` (`26 §2.2`), a different scope would also compute a different
  // `option_id` and make the comparison meaningless.
  const spec = record.contextSpec;
  if (spec === null) {
    return {
      kind: 'STALE',
      reason: 'REVALIDATION_IDENTITY_ABSENT',
      detail:
        'the recorded enumeration carries no persisted task scope, so the live ' +
        're-enumeration cannot be performed under the scope that authorised it (25 §14.1)',
    };
  }

  // --- 4. RE-ENUMERATE THE LIVE SET, under the dispatch lease ----------------------------
  //
  // The ACCEPTED S1C re-enumeration, imported and not reimplemented. It mints no
  // `enumeration_id`, writes no record, constructs no effect and returns no payload — it
  // reads the CURRENT permissible effects for `(action_class, resource)` and nothing else.
  const live = await enumerator.reEnumerate(underlyingLeaseFor(lease), {
    actionClass: original.action_class,
    resourceRef: original.resource_ref,
    spec,
  });

  if (live.set.options.length === 0) {
    // An empty live set is `26 §7` C′'s own answer for a resource that no longer resolves
    // to enumerable RECORD-grade state AND for one that resolves with nothing permissible.
    // The two are deliberately NOT distinguished here — `36 §2` VC-C2's empty set exists so
    // they cannot be — and either way the authorised option is absent.
    return {
      kind: 'STALE',
      reason:
        live.internalFailure === null
          ? 'OPTION_ABSENT_FROM_LIVE_SET'
          : 'RESOURCE_NO_LONGER_RESOLVES',
      detail:
        'the live enumeration for the originally authorised effect is empty ' +
        `(${live.internalFailure ?? 'NO_PERMISSIBLE_OPTION'})`,
    };
  }

  // --- 5. IS THE ORIGINAL OPTION STILL THERE? --------------------------------------------
  //
  // A MEMBERSHIP TEST ON THE CONTENT-ADDRESSED IDENTITY, and never a positional lookup.
  // `26 §2.2`: `option_id = H(action_class ‖ resource_id ‖ semantic_option_digest)`, so an
  // option whose economics or whose scope changed has a DIFFERENT id and is correctly absent.
  // `tests/negative-controls/unsafe-positional-selector.ts` is the accepted control for the
  // opposite shape, and the same reasoning applies one epoch later.
  const stillLive = live.set.options.some((option) => option.optionId === original.option_id);
  if (!stillLive) {
    return {
      kind: 'STALE',
      reason: 'OPTION_ABSENT_FROM_LIVE_SET',
      detail:
        `the authorised option ${original.option_id} is absent from the live set for ` +
        `${original.resource_ref} (I53 at the dispatch boundary, 25 §14.1)`,
    };
  }

  return {
    kind: 'VALID',
    actionClass: original.action_class,
    resourceRef: original.resource_ref,
    optionId: original.option_id,
    enumerationId: original.enumeration_id,
  };
}
