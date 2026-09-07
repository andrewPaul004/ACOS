import { toDb, type Money } from '../exposure/money.js';
import type { ActionClass } from '../canonicalisation/actionCatalogue.js';
import type { CanonicalEffect } from '../canonicalisation/types.js';
import { policyDefect } from './errors.js';

/**
 * Deterministic Cedar request construction, from the canonical effect and NOTHING ELSE.
 *
 * `26 §7` property 2, verbatim: "**The kernel constructs the request** (step C′). It never
 * accepts an amount, a percentage, a vendor parameter or a counterparty from the proposer."
 *
 * `26 §8`, verbatim: "**v1.1: every operand below is a kernel-computed field.** [...] The
 * `context.exposure.*` and `context.selected_option.*` values here are produced by the
 * Effect Canonicaliser (§2.1) from authoritative state, and I21 makes it a type-level
 * property that they cannot come from anywhere else."
 *
 * ---------------------------------------------------------------------------------
 * ONE PARAMETER
 *
 * `buildCedarRequest` takes a `CanonicalEffect` and has no second parameter, no options
 * object, no overrides bag, no context map and no default argument. That is the whole of
 * the authority-channel defence and it is structural rather than checked:
 *
 *   - there is no position in which a caller can place a limit, a grant, a window, a
 *     company id, a resource id, an action identity, an amount or a "policy attribute";
 *   - `CanonicalEffect`'s authority-bearing fields are `KernelComputed<T>`, and a raw value
 *     is not assignable to one, so a caller cannot fabricate an effect either;
 *   - the effect is produced by S1C's `canonicaliseUnderLease`, which itself takes no option
 *     parameter and resolves the option from the LIVE C′ enumeration.
 *
 * `tests/type-negative/` holds the compile-failure fixtures for each of those.
 *
 * ---------------------------------------------------------------------------------
 * NO ARITHMETIC
 *
 * Nothing here adds, subtracts, multiplies or rounds a `Money`. `toDb` is `money.ts`'s
 * fixed-scale FORMATTER — the same one the dispatch payload uses — and rendering a bigint of
 * minor units at the declared scale is exact by construction, so no value is normalised,
 * repaired or re-derived on its way to Cedar.
 *
 * `26 §12`'s separation, restated: the canonicaliser supplies `$26.03`; Cedar tests it.
 * `tests/policy/source-rules-s1d.test.ts` asserts the absence of money arithmetic under
 * `src/kernel/policy/` rather than trusting this paragraph.
 * ---------------------------------------------------------------------------------
 */

const NAMESPACE = 'Acos';
const PRINCIPAL_TYPE = `${NAMESPACE}::Principal`;
const ROLE_TYPE = `${NAMESPACE}::Role`;
const ACTION_TYPE = `${NAMESPACE}::Action`;
const ORDER_TYPE = `${NAMESPACE}::Order`;

export interface CedarEntityUid {
  readonly type: string;
  readonly id: string;
}

export type CedarValue =
  | string
  | number
  | boolean
  | { readonly __extn: { readonly fn: string; readonly arg: string } }
  | { readonly [key: string]: CedarValue };

export interface CedarEntity {
  readonly uid: CedarEntityUid;
  readonly attrs: Readonly<Record<string, CedarValue>>;
  readonly parents: readonly CedarEntityUid[];
}

/** Everything Cedar needs about THIS request. The schema and policy set are the engine's. */
export interface CedarRequest {
  readonly principal: CedarEntityUid;
  readonly action: CedarEntityUid;
  readonly resource: CedarEntityUid;
  readonly context: Readonly<Record<string, CedarValue>>;
  readonly entities: readonly CedarEntity[];
}

/**
 * A `Money` as a Cedar `decimal`.
 *
 * `money.ts` holds a bigint count of minor units at `SCALE = 2` and `toDb` renders it at
 * exactly that scale — `30 §5.3` (ACOS-JCS-1) is explicit that "25.0 and 25.00 are different
 * bytes", and Cedar's `decimal` carries up to four places, so the round trip is lossless and
 * the comparison in the policy is exact fixed-point rather than floating point.
 *
 * There is deliberately no `number` anywhere on this path.
 */
function decimalOf(value: Money): CedarValue {
  return { __extn: { fn: 'decimal', arg: toDb(value) } };
}

/**
 * The per-class construction registry. CLOSED, with no generic fallback.
 *
 * `26 §7` step C2's terminal is `DENY: NOT_CANONICALISABLE — class not autonomy-eligible`,
 * and the same discipline applies one step later: a class with no registered policy
 * construction does not get a generic request built for it on the hope that some policy
 * matches. It is a `NO_POLICY_CONSTRUCTION` defect, which is not a `PERMIT` and is not a
 * business denial either.
 *
 * S1D registers exactly one class. `36 §3`'s gap analysis over the whole catalogue is
 * `tests/policy/policy-set-gap-analysis.test.ts`, which asserts the other three fail closed
 * BY EXECUTION rather than by this comment.
 */
type CedarRequestConstructor = (effect: CanonicalEffect) => CedarRequest;

const CONSTRUCTIONS: Readonly<Partial<Record<ActionClass, CedarRequestConstructor>>> =
  Object.freeze({
    'refund.create': buildRefundCreateCedarRequest,
  });

export function hasPolicyConstruction(actionClass: string): boolean {
  return Object.prototype.hasOwnProperty.call(CONSTRUCTIONS, actionClass);
}

export function registeredPolicyConstructionClasses(): readonly string[] {
  return Object.keys(CONSTRUCTIONS).sort();
}

/** The single entry point. One argument. */
export function buildCedarRequest(effect: CanonicalEffect): CedarRequest {
  const actionClass: ActionClass = effect.request.actionClass;
  const construct = CONSTRUCTIONS[actionClass];
  if (construct === undefined) {
    return policyDefect(
      'NO_POLICY_CONSTRUCTION',
      `no Cedar request construction is registered for ${actionClass}`,
    );
  }
  return construct(effect);
}

/**
 * `refund.create`'s request, field by field against `26 §8`'s worked policy.
 *
 * Every line below names the field on the `AuthorizationRequest` it reads. There is no other
 * source. In particular `exposure.vendorAmount` — which exists on the request and is
 * `$25.00` for VC-C1 — is READ NOWHERE HERE, and `acos.cedarschema` declares no attribute it
 * could be written into. The vulnerable negative control has to substitute this whole
 * function to express the defect, which is what makes the defect observable rather than
 * asserted.
 */
export function buildRefundCreateCedarRequest(effect: CanonicalEffect): CedarRequest {
  const request = effect.request;
  const option = request.selectedOption;
  // Read BEFORE the narrowing below, because `RecordedSelectedOption` is a union of one at
  // S1D and TypeScript narrows the discriminant to `never` inside the guard.
  const optionClass: string = option.actionClass;
  if (option.actionClass !== 'refund.create') {
    // Defence in depth against a future registry edit, matching the pattern every S1B
    // constructor entry point already uses.
    return policyDefect(
      'NO_POLICY_CONSTRUCTION',
      `the refund.create policy construction received a ${optionClass} option`,
    );
  }

  const principal = request.principal;
  // `26 §3`: `role` is a declared field on the principal and is REQUIRED, so an absent role
  // is a resolution defect rather than a request that quietly matches no grant. `36 §3`
  // layer 2: "A test asserts that omitting any tuple field fails closed rather than
  // defaulting."
  if (principal.role.length === 0) {
    return policyDefect(
      'AUTHORITATIVE_OPERAND_ABSENT',
      'the resolved principal carries no role, and `26 §8` matches the grant on `principal in Role::"…"`',
    );
  }
  // THERE IS DELIBERATELY NO CURRENCY CHECK OR CURRENCY REPAIR HERE.
  //
  // `refundCreate.ts` already throws when the option's currency, the retained fee's currency
  // and the ledger currency disagree, and it does so BEFORE any exposure is emitted, so a
  // currency-mismatched effect cannot exist to be handed to policy. `26 §11.2`'s exclusion
  // table puts cross-currency monetary classes outside the MVP catalogue entirely.
  //
  // Re-checking it here would be a recomputation of a rule that already holds; NORMALISING
  // it here would be Cedar repairing an economic quantity, which is precisely what the
  // canonicaliser/policy separation forbids.
  // `tests/policy/fail-closed.test.ts` proves the ordering by execution.

  const principalUid: CedarEntityUid = { type: PRINCIPAL_TYPE, id: principal.id };
  const roleUid: CedarEntityUid = { type: ROLE_TYPE, id: principal.role };
  const resourceUid: CedarEntityUid = { type: ORDER_TYPE, id: request.resource.resourceId };

  return Object.freeze({
    principal: principalUid,
    action: { type: ACTION_TYPE, id: 'refund.create' },
    resource: resourceUid,
    context: Object.freeze({
      exposure: Object.freeze({
        // SR-C1, and the whole point of the slice. `26 §2.1`: total_exposure is
        // "vendor_amount + Σ cost_components + class-specific economically bounded loss",
        // computed by the constructor from authoritative state.
        total_exposure: decimalOf(request.exposure.totalExposure),
      }),
      selected_option: Object.freeze({
        amount: decimalOf(option.amount),
        instrument: option.instrument,
        // `26 §8`: "enumerated from the order at fetch time". S1C re-enumerates it under the
        // C′ entity lease, so this is the CURRENT value and not the one the model read.
        line_refundable_remaining: decimalOf(option.lineRefundableRemaining),
      }),
      // One of the four `I21` fields. It carries no monetary meaning: the APPROVED subset it
      // is tested against is a literal inside the hash-committed policy artifact.
      reason_code: request.reasonCode,
      // `26 §2.1` types it nullable. An absent novelty OMITS the attribute rather than
      // substituting a value, so the policy's `context has customer_novelty` guard fails the
      // grant closed. Defaulting it to "NEW" here would be the exact shape of defect
      // `36 §3` layer 2 exists to catch.
      ...(request.customerNovelty === null
        ? {}
        : { customer_novelty: request.customerNovelty as string }),
    }),
    entities: Object.freeze([
      Object.freeze({
        uid: principalUid,
        attrs: Object.freeze({
          kind: principal.kind as string,
          delegation_depth: principal.delegationDepth,
        }),
        // `26 §3`: the role is a parent edge, which is what makes `principal in Role::"…"`
        // the operator `26 §8` writes.
        parents: Object.freeze([roleUid]),
      }),
      Object.freeze({ uid: roleUid, attrs: Object.freeze({}), parents: Object.freeze([]) }),
      Object.freeze({
        uid: resourceUid,
        attrs: Object.freeze({
          // `26 §8`: `resource.exists`.
          //
          // A `ResolvedResource` is produced ONLY by a successful authoritative resolution:
          // S1C's step C′ denies `SELECTOR_STALE` when "the resource no longer resolves to
          // enumerable RECORD-grade state", and no `CanonicalEffect` exists for a resource
          // that did not resolve. So existence is ENTAILED by the presence of the record
          // rather than asserted about it, and the entailment is proven by execution in
          // `tests/integration/policy/…`, which shows a deleted resource denying at C′ and
          // never reaching policy.
          //
          // A later slice that can present an unresolved resource to policy must carry
          // `exists` as a field on `ResolvedResource`. S1D does not pre-build that field,
          // because a field nothing can currently set to `false` is a field that reads as a
          // check and performs none.
          exists: true,
          // `26 §8`: `resource.grade == "RECORD"`. Read, never assumed — S1C resolves it from
          // authoritative commerce state.
          grade: request.resource.grade as string,
        }),
        parents: Object.freeze([]),
      }),
    ]),
  });
}
