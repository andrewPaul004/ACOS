import type { Client } from '../../../src/db/pool.js';
import { canonicalHash } from '../../../src/kernel/canonicalisation/canonicalBytes.js';
import { semanticOptionDigestFieldsFor } from '../../../src/kernel/canonicalisation/actionCatalogue.js';
import { ConstructorRegistry } from '../../../src/kernel/canonicalisation/registry.js';
import type { RegisteredConstructor } from '../../../src/kernel/canonicalisation/registry.js';
import { refundCreateConstructor } from '../../../src/kernel/canonicalisation/constructors/refundCreate.js';
import type {
  EnumeratedAuthoritativeOption,
  LiveEnumerator,
  ResourceResolution,
} from '../../../src/kernel/enumeration/port.js';
import type { SelectedAuthoritativeOption } from '../../../src/kernel/canonicalisation/types.js';
import type { VerifiedControlArtifactBundle } from '../../../src/kernel/controlArtifacts/bundle.js';

/**
 * THIRD REVIEW — **THE S1P VALIDATION `email.send` ENUMERATION CONSTRUCTOR.**
 *
 * =================================================================================
 * THE DEFECT THIS FILE ANSWERS
 *
 * The second-round live composition built its registry from `refundCreateConstructor` alone,
 * so `describeLiveComposition` reported `EFFECT_CONSTRUCTOR_NOT_IMPLEMENTED` permanently and
 * `S1PValidationAuthority`'s `enumerate` port was an unconditional `throw`. The reviewer's
 * objection is exact: **an owner-signed `ConstructorVersionRecord` cannot implement missing
 * TypeScript code.** No ceremony, no credential and no provisioning would have made the live
 * path executable, because a piece of the repository was simply absent.
 *
 * This is that piece. After it, every remaining blocker is a signature, a credential, a
 * deployment material or a provider measurement — none of them source code.
 *
 * =================================================================================
 * WHAT THIS IS NOT, AND THE OWNER DIRECTION THAT SAYS SO
 *
 * **IT IS NOT A PRODUCTION EMAIL CAPABILITY.** The owner direction for this correction is
 * verbatim: "Do NOT turn this into a general production email capability." So:
 *
 *   * `email.send` keeps its ordinary policy status, `UNGOVERNED_FAILS_CLOSED`. No Cedar
 *     permit is added, and `tests/policy/policy-set-gap-analysis.test.ts` proves the gap by
 *     execution rather than by assertion.
 *   * this module lives under `validation/`, NOT under `src/kernel/canonicalisation/
 *     constructors/`. Nothing in `src/` imports it, and
 *     `tests/sendgrid/prerequisites-and-separation.test.ts` computes that closure.
 *   * the ONLY registry that carries it is `s1pLiveConstructorRegistry()`, which exists
 *     solely for the S1P live validation composition.
 *   * there is no customer-recipient path and no general email option-selection surface.
 *     The constructor enumerates ONE option for a resolvable validation resource and
 *     nothing else; the recipient is never one of its dimensions.
 *
 * **CONSTRUCTOR EXISTENCE IS NOT AUTHORITY TO EXECUTE.** A registered constructor makes a
 * class CANONICALISABLE at `26 §7` step C2. Authorisation is a separate gate, and for
 * ordinary production traffic `email.send` still fails closed there for want of a Cedar
 * permit. The two facts are independent and both are asserted.
 *
 * =================================================================================
 * WHY `construct` THROWS, AND WHY THAT IS THE HONEST SHAPE
 *
 * `25 §14.1` is explicit that dispatch revalidation "constructs no payload" and that "the
 * persisted payload remains the exact authorised payload". The S1P validation payload — the
 * sender, the owner-controlled sink, the validation subject and the validation body — is
 * composed and committed by `S1PValidationAuthority`, whose closed four-field schema and
 * owner-sink refusal are the accepted second-round work. Moving payload construction here
 * would be moving it back towards a general email composition, which the owner direction
 * forbids, and would give a reviewer two payloads to wonder about instead of one.
 *
 * So this constructor supplies exactly the half the kernel needs and no more: ENUMERATION
 * IDENTITY, so that `25 §14.1`'s mandatory revalidation has an enumeration to revalidate.
 * `construct` throws, for the same reason and with the same rationale as the accepted
 * `tests/support/fixtureEnumerator.ts`.
 *
 * =================================================================================
 * THE OPTION OBJECT IS CAST, FOR THE ACCEPTED REASON
 *
 * `SelectedAuthoritativeOption` is a union of ONE at S1B — it IS
 * `SelectedAuthoritativeRefundOption`. Widening a PRODUCTION kernel type so a NON-PRODUCTION
 * validation class can satisfy it would be exactly the tail wagging the dog the accepted
 * fixture enumerator names, and it would spread a validation-only concern through `src/`.
 *
 * The cast is safe because nothing ever reads the refund-shaped fields on this class's
 * option: `computeSemanticOptionDigest` below reads none of them, `optionDescriptionFields`
 * returns an empty candidate set, `construct` throws, and the enumeration core touches only
 * `actionClass` and `resourceId`.
 * =================================================================================
 */

/**
 * THE ONE CONSTRUCTOR IDENTITY, AND IT IS USED EVERYWHERE.
 *
 * `50 §3i`'s admission decides membership on the tuple
 * `(constructor_id, action_class, semantic_major, non_semantic_minor)`, compared against the
 * VERIFIED class-19 bytes. So the same four values must appear in the implementation, the
 * S1P live registry, the class-19 candidate record, the future signed
 * `ConstructorVersionRecord`, the validation authority's lineage and the tests — or the
 * live composition refuses at admission.
 *
 * **THE GRAMMAR IS THE ARTIFACT'S, DELIBERATELY.** `class-19.effect-constructors.json`
 * declares `acos.constructor.refund.create`, while `constructors/refundCreate.ts` declares
 * `ctor.refund.create`; `tests/release/class19-admission.test.ts` records that divergence as
 * a residual of class 19 having had no production authority consumer at v1.3.6. S1P is the
 * first slice to run a constructor THROUGH that admission, so it does not inherit the
 * divergence: one identity, in the artifact's own grammar, everywhere.
 *
 * The `s1p_validation` suffix is load-bearing documentation. A reader of the signed class-19
 * bytes must not be able to mistake this for a general production email implementation.
 */
export const S1P_VALIDATION_EMAIL_CONSTRUCTOR_ID = 'acos.constructor.email.send.s1p_validation';

/** `26 §2.1.2`: a semantic bump is a change to the digest definition or to the effect. */
export const S1P_VALIDATION_EMAIL_SEMANTIC_MAJOR = 1;
export const S1P_VALIDATION_EMAIL_NON_SEMANTIC_MINOR = 0;

/** The action class this constructor serves. Exactly one, and it is checked at every entry. */
export const S1P_VALIDATION_EMAIL_ACTION_CLASS = 'email.send';

/**
 * `50 §2a` RECORD 13 DECLARES **NO** SEMANTIC OPTION DIGEST FIELDS FOR THIS CLASS, AND THAT
 * IS INTERNALLY CONSISTENT WITH THIS CONTRACT.
 *
 * The owner decision recorded for S1P is `semantic_option_digest_fields: { "email.send": [] }`,
 * on the ground that the validation path exposes no selectable semantic option dimension.
 * The real constructor contract agrees, and the reason is arithmetic rather than assertion:
 *
 *   `26 §2.2` / `optionDigest.ts`: `option_id = H(action_class ‖ resource_id ‖
 *   semantic_option_digest)`.
 *
 * The digest is only ONE of three preimage components. With an empty field list the digest is
 * constant for the class, and `option_id` still separates classes and resources — so two
 * validation resources still receive distinct option identities, and there is nothing WITHIN
 * one resource to separate, because this class enumerates exactly ONE option per resolvable
 * resource. A digest over fields that cannot vary would add no discrimination.
 *
 * **AND THE PAYLOAD IS BOUND MORE STRONGLY ELSEWHERE.** Sender, sink, subject and body are
 * not option dimensions: they are committed by `S1PValidationAuthority` into the dispatch
 * payload, and the authorisation binds `dispatch_payload_hash` over the canonical bytes. That
 * binding is over the exact values, not over a digest of selectable dimensions, so making
 * them option fields would weaken nothing and add nothing — while creating precisely the
 * general email option-selection surface the owner direction forbids.
 *
 * This constant exists so the agreement is CHECKED at runtime rather than believed. If a
 * future class-3 release declares fields for this class, `computeSemanticOptionDigest` fails
 * closed exactly as `refundCreate.ts` does, instead of minting colliding option ids.
 */
const S1P_VALIDATION_EMAIL_DIGEST_FIELDS: readonly string[] = Object.freeze([]);

/** One resolvable validation resource, as `commerce_order` holds it. */
interface ValidationResourceRow {
  readonly order_id: string;
  readonly resource_ref: string;
  readonly grade: string;
  readonly currency: string;
  readonly customer_novelty: string;
}

/**
 * `24 §3` K4 items 1–2 for the validation class.
 *
 * =================================================================================
 * WHY THE STATE MODEL IS `commerce_order`
 *
 * `24 §3` K4 wants a per-class state model. A VALIDATION class does not have a business one:
 * the only authoritative fact about a validation resource is that it exists and is currently
 * enumerable. What it DOES need is a real, MUTABLE, RECORD-graded row, because `§8` item 7 of
 * this correction requires that changed state fail revalidation under the existing kernel
 * rules — and a resolver that read nothing could never fail.
 *
 * `commerce_order` is the only resolvable resource row in the schema, `resource_ref` is
 * `UNIQUE` free-form text, and `grade` is checked against `24 §2`'s evidence grades, so a
 * validation resource can be made stale by DEMOTING ITS GRADE — one `UPDATE`, no migration,
 * and the staleness is a real property of authoritative state rather than a flag a test sets.
 * The accepted `tests/support/fixtureEnumerator.ts` resolves the constructor-less classes the
 * same way and for the same reason; reusing it keeps the live path and the offline path
 * resolving through one rule instead of two.
 *
 * **THE ROW CARRIES NO CUSTOMER DATA.** The validation composition materialises it with a
 * synthetic identifier before enumerating; nothing about a customer, an order or a payment
 * reaches it, and this resolver reads five columns none of which could carry one.
 * =================================================================================
 */
const s1pValidationLiveEnumerator: LiveEnumerator = {
  async resolveResource(
    client: Client,
    companyId: string,
    resourceRef: string,
  ): Promise<ResourceResolution> {
    const found = await client.query<ValidationResourceRow>(
      `SELECT order_id, resource_ref, grade, currency, customer_novelty
         FROM commerce_order
        WHERE company_id = $1 AND resource_ref = $2`,
      [companyId, resourceRef],
    );
    const row = found.rows[0];
    if (row === undefined) return { ok: false, failure: 'RESOURCE_ABSENT' };
    if (row.grade !== 'RECORD') {
      // `26 §8`: "resource.grade == 'RECORD'". The demotion a staleness test performs.
      return { ok: false, failure: 'RESOURCE_NOT_RECORD_GRADE' };
    }
    return {
      ok: true,
      state: {
        resource: { resourceRef: row.resource_ref, resourceId: row.order_id, grade: 'RECORD' },
        ledgerCurrency: row.currency,
        customerNovelty: row.customer_novelty === 'NEW' ? 'NEW' : 'RETURNING',
      },
    };
  },

  /**
   * EXACTLY ONE OPTION PER RESOLVABLE VALIDATION RESOURCE, AND IT IS DETERMINISTIC.
   *
   * No clock, no random, no model input, no credential, no network. The option is a pure
   * function of the resolved resource, so the initial enumeration and the `25 §14.1`
   * re-enumeration at dispatch produce the SAME `option_id` for unchanged state — which is
   * exactly the property the revalidation compares.
   *
   * The option is PRESENT while the resource resolves at RECORD grade and ABSENT otherwise,
   * so the dispatch-boundary membership test is meaningful rather than vacuous.
   */
  async enumerate(
    _client: Client,
    _companyId: string,
    state,
  ): Promise<readonly EnumeratedAuthoritativeOption[]> {
    const option = {
      actionClass: S1P_VALIDATION_EMAIL_ACTION_CLASS,
      resourceId: state.resource.resourceId,
      lineId: `${S1P_VALIDATION_EMAIL_ACTION_CLASS}:validation`,
      parentTransactionId: `${S1P_VALIDATION_EMAIL_ACTION_CLASS}:none`,
      amount: { minor: 0n },
      instrument: 'none',
      reasonCodeScope: 'GOODS_FAULT',
      lineRefundableRemaining: { minor: 0n },
    } as unknown as SelectedAuthoritativeOption;
    return [{ option, retainedProcessingFee: null }];
  },
};

/**
 * `26 §2.2`'s per-class digest, over the owner-declared field set — which is EMPTY.
 *
 * The agreement with the signed class-3 bytes is checked first, in the same shape and for the
 * same reason `constructors/refundCreate.ts` checks its own: a constructor whose digest does
 * not cover the owner's declaration is a catalogue defect, and failing closed is better than
 * minting option ids that silently stop discriminating.
 *
 * With no declared fields the digest is a DOMAIN-SEPARATED CONSTANT. It is not the empty
 * buffer and not a shared value: `canonicalHash`'s kind string names this class and this
 * version, so it cannot collide with another class's digest even before `option_id` mixes in
 * the action class itself.
 */
export function s1pValidationEmailSemanticOptionDigest(
  bundle?: VerifiedControlArtifactBundle,
): Buffer {
  const declared = semanticOptionDigestFieldsFor(
    S1P_VALIDATION_EMAIL_ACTION_CLASS as never,
    bundle,
  );
  if (declared.length !== S1P_VALIDATION_EMAIL_DIGEST_FIELDS.length) {
    throw new Error(
      'email.send: the verified class-3 artifact declares semantic_option_digest_fields ' +
        `[${declared.join(', ')}] and the S1P validation constructor covers ` +
        `[${S1P_VALIDATION_EMAIL_DIGEST_FIELDS.join(', ')}]; a digest that does not cover ` +
        'the owner-declared fields is a catalogue defect (26 §2.2, 50 §2a record 13). If the ' +
        'owner has declared option dimensions for this class, the constructor must cover ' +
        'them before it may run',
    );
  }
  return canonicalHash('acos.semantic_option_digest.email.send.s1p_validation.v1', []);
}

/**
 * The registration. The validation class reaches the kernel through THIS OBJECT and nothing
 * else, exactly as `refund.create` does — no core edit, no per-class branch anywhere.
 */
export const s1pValidationEmailConstructor: RegisteredConstructor = {
  actionClass: S1P_VALIDATION_EMAIL_ACTION_CLASS as never,
  constructorId: S1P_VALIDATION_EMAIL_CONSTRUCTOR_ID,
  computeSemanticOptionDigest: () => s1pValidationEmailSemanticOptionDigest(),
  optionDescriptionFields: () => {
    /*
     * NO CANDIDATE FIELDS, SO EVERY PROJECTION IS EMPTY WHATEVER THE `context_spec` SAYS.
     *
     * `I52`'s subset property holds trivially, and — more to the point — the option
     * description cannot carry the sink, the subject or the body. A validation option
     * describes nothing, which is the correct amount for an option with no dimensions.
     */
    return [];
  },
  liveEnumerator: s1pValidationLiveEnumerator,
  assertInputCohesion: (input) => {
    if (input.permitted.actionClass !== S1P_VALIDATION_EMAIL_ACTION_CLASS) {
      throw new Error(
        'the S1P validation email constructor was invoked for another action class',
      );
    }
    // Nothing further to cohere: the validation option carries no model-supplied field, and
    // `PermittedIntentFields` cannot reach the payload, which the authority owns.
  },
  construct: () => {
    /*
     * `25 §14.1`: REVALIDATION CONSTRUCTS NO PAYLOAD, AND NOTHING ELSE REACHES HERE.
     *
     * The authorised payload is `S1PValidationAuthority`'s, canonicalised once and bound by
     * `dispatch_payload_hash`. A constructor that returned something plausible would leave a
     * reviewer unable to tell which of two payloads a dispatch used; one that throws answers
     * the question, and a live run that somehow reached it stops instead of sending.
     */
    throw new Error(
      'the S1P validation email constructor builds no payload: the validation authority ' +
        'composes and commits the closed four-field payload, and 25 §14.1 revalidation ' +
        'constructs none',
    );
  },
};

/**
 * THE REGISTRY THE S1P LIVE COMPOSITION USES. **NOT A PRODUCTION REGISTRY.**
 *
 * It carries the production constructors the kernel needs, plus the validation-only one. The
 * name says validation-only on purpose: the second-round code called its registry
 * `PRODUCTION_CONSTRUCTOR_REGISTRY`, and keeping that name while adding a non-production
 * constructor to it would have made the identifier assert something false.
 *
 * `src/` builds no registry from this function, and nothing in `src/` imports this module.
 */
export function s1pLiveConstructorRegistry(): ConstructorRegistry {
  return new ConstructorRegistry([refundCreateConstructor, s1pValidationEmailConstructor]);
}
