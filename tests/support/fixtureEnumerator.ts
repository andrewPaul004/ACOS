import type { Client } from '../../src/db/pool.js';
import { canonicalHash } from '../../src/kernel/canonicalisation/canonicalBytes.js';
import type { ActionClass } from '../../src/kernel/canonicalisation/actionCatalogue.js';
import type { RegisteredConstructor } from '../../src/kernel/canonicalisation/registry.js';
import type {
  EnumeratedAuthoritativeOption,
  LiveEnumerator,
  ResourceResolution,
} from '../../src/kernel/enumeration/port.js';
import type { SelectedAuthoritativeOption } from '../../src/kernel/canonicalisation/types.js';

/**
 * TEST-ONLY. A MINIMAL LIVE ENUMERATOR FOR THE TWO CLASSES S1B REGISTERED NO CONSTRUCTOR FOR.
 *
 * =================================================================================
 * WHY THIS EXISTS, AND WHY IT IS NOT PRODUCTION CODE
 *
 * `25 §14.1` (v1.3.5, SER-01) makes dispatch-time revalidation MANDATORY and specifies its
 * operands: "the original `action_class`, the original resource identity, **the original
 * enumeration/option identity** and the original constructor/version identity". An effect
 * that carries no enumeration cannot be revalidated, and `dispatchRevalidation.ts` refuses
 * it — the fail-closed direction.
 *
 * S1B registered a constructor for exactly ONE class, `refund.create`, and
 * `actionCatalogue.ts` records why: "The other three are in the catalogue and have no
 * constructor, so they deny `NOT_CANONICALISABLE` at step C2, which is the behaviour
 * `36 §2` asks for." **THAT IS STILL TRUE OF PRODUCTION AND IS UNCHANGED.** In a conformant
 * S1 pipeline `campaign.pause` and `fulfilment.reship` cannot be canonicalised, cannot be
 * authorised, and therefore cannot be dispatched.
 *
 * But `37 §2` S1 requires all three recoverability classes to be exercised against mocks,
 * and v1.3.5's SEQ-02 puts the IRRECOVERABLE half of the execution semantics — step R's
 * unit reservation, the `reserved → presumed` movement and its kill-point matrix — AT S1.
 * The accepted S1I/S1J suites reach those classes through hand-authored facts that bypass
 * C′ (`outboxFixture.ts`'s `pauseFacts` and `reshipFacts`, which say so in their own
 * headers). Under v1.3.5 those fixture-authored effects would be refused at the dispatch
 * boundary for carrying no enumeration — not because production is wrong, but because the
 * FIXTURE was standing in for only half of C′.
 *
 * THIS MODULE IS THE OTHER HALF. It lets the fixture produce a REAL enumeration record for
 * those two classes, so the dispatch path revalidates them exactly as it revalidates a
 * refund — through the production `EffectEnumerator`, against live authoritative state,
 * with a content-addressed `option_id`. Nothing here is imported from `src/`, and
 * `no-real-transport-boundary.test.ts`'s assertion that no production file imports anything
 * from `tests/` is unamended.
 * =================================================================================
 *
 * =================================================================================
 * THE STATE MODEL IS `commerce_order`, DELIBERATELY REUSED
 *
 * `24 §3` K4 wants a per-class state model — "for a refund, the refundable line items […];
 * for a budget change, the permitted absolute values […]; for an address edit, the permitted
 * address sources". A FIXTURE does not need three; it needs ONE resolvable, MUTABLE,
 * RECORD-graded row, because what the S1J suites exercise is not the class's business rule
 * but the dispatch boundary's behaviour when that state MOVES during the asynchronous gap.
 *
 * `commerce_order` is that row: `resource_ref` is `UNIQUE` and free-form TEXT, `grade` is
 * checked against `24 §2`'s evidence grades, and `enumerateEffects` already treats a
 * non-`RECORD` grade as an unresolvable resource. So a test makes an authorised effect stale
 * by demoting the grade — one `UPDATE`, no new table, and the staleness is a real property
 * of authoritative state rather than a flag the fixture sets.
 *
 * THE OPTION OBJECT IS SHAPED LIKE A REFUND OPTION AND IS CAST. `SelectedAuthoritativeOption`
 * is a union of ONE at S1B — "A union of one at S1B, exactly as `SelectedAuthoritativeOption`
 * is" — so there is no second member to build. Widening a PRODUCTION type so a FIXTURE can
 * satisfy it would be the tail wagging the dog, and the cast is safe because nothing ever
 * reads the refund-specific fields: `computeSemanticOptionDigest` and
 * `optionDescriptionFields` below are this constructor's own, `construct` throws, and the
 * enumeration core touches nothing else.
 * =================================================================================
 */

/** One resolvable fixture resource, as `commerce_order` holds it. */
interface FixtureResourceRow {
  readonly order_id: string;
  readonly resource_ref: string;
  readonly grade: string;
  readonly currency: string;
  readonly customer_novelty: string;
}

function fixtureLiveEnumerator(actionClass: ActionClass): LiveEnumerator {
  return {
    async resolveResource(
      client: Client,
      companyId: string,
      resourceRef: string,
    ): Promise<ResourceResolution> {
      const found = await client.query<FixtureResourceRow>(
        `SELECT order_id, resource_ref, grade, currency, customer_novelty
           FROM commerce_order
          WHERE company_id = $1 AND resource_ref = $2`,
        [companyId, resourceRef],
      );
      const row = found.rows[0];
      if (row === undefined) {
        return { ok: false, failure: 'RESOURCE_ABSENT' };
      }
      if (row.grade !== 'RECORD') {
        // `26 §8`: "resource.grade == 'RECORD'". The demotion a gap-mutation test performs.
        return { ok: false, failure: 'RESOURCE_NOT_RECORD_GRADE' };
      }
      return {
        ok: true,
        state: {
          resource: {
            resourceRef: row.resource_ref,
            resourceId: row.order_id,
            grade: 'RECORD',
          },
          ledgerCurrency: row.currency,
          customerNovelty: row.customer_novelty === 'NEW' ? 'NEW' : 'RETURNING',
        },
      };
    },

    /**
     * EXACTLY ONE OPTION PER RESOLVABLE RESOURCE.
     *
     * `campaign.pause` and `fulfilment.reship` are not enumerable in the way a refund is —
     * a pause has no dimensions and a reship's would be the shipment lines. One option is
     * the smallest set that makes the dispatch-boundary membership test meaningful: the
     * option is present while the resource resolves at RECORD grade, and absent otherwise.
     *
     * The absence is what `dispatch-gap-revalidation.test.ts` produces, and it produces it
     * by moving AUTHORITATIVE STATE rather than by removing the option directly.
     */
    async enumerate(
      _client: Client,
      _companyId: string,
      state,
    ): Promise<readonly EnumeratedAuthoritativeOption[]> {
      const option = {
        actionClass,
        resourceId: state.resource.resourceId,
        lineId: `${actionClass}:sole`,
        parentTransactionId: `${actionClass}:none`,
        amount: { minor: 0n },
        instrument: 'none',
        reasonCodeScope: 'GOODS_FAULT',
        lineRefundableRemaining: { minor: 0n },
      } as unknown as SelectedAuthoritativeOption;
      return [{ option, retainedProcessingFee: null }];
    },
  };
}

/**
 * A fixture `RegisteredConstructor` for one of the two constructor-less classes.
 *
 * `construct` THROWS, ON PURPOSE. `25 §14.1` is explicit that revalidation "constructs no
 * payload" and that "the persisted payload remains the exact authorised payload", so the
 * dispatch path never reaches a constructor. These classes' payloads are hand-authored by
 * `outboxFixture.ts` and canonicalised by the production `dispatchPayloadCanonicalBytes`.
 * A constructor that returned something plausible would make a reviewer wonder which of the
 * two payloads a dispatch used; one that throws answers the question.
 */
export function fixtureEnumerationConstructor(
  actionClass: ActionClass,
  constructorId: string,
): RegisteredConstructor {
  return {
    actionClass,
    constructorId,
    /**
     * `26 §2.2`'s `semantic_option_digest` for this fixture class.
     *
     * Over `(action_class, resource_id)` and nothing else, because those are the only two
     * facts the fixture option carries that could make it "a different effect". It is
     * domain-separated through `canonicalHash`, so it cannot collide with a refund digest
     * over coincidentally equal bytes.
     */
    computeSemanticOptionDigest(option: SelectedAuthoritativeOption): Buffer {
      return canonicalHash('acos.fixture.semantic_option_digest.v1', [
        { kind: 'text', value: option.actionClass },
        { kind: 'text', value: option.resourceId },
      ]);
    },
    assertInputCohesion(): void {
      // Nothing to cohere: the fixture option carries no model-supplied field.
    },
    optionDescriptionFields() {
      // No candidate fields, so every projection is empty regardless of `context_spec`.
      // `I52`'s subset property holds trivially and the description carries no state.
      return [];
    },
    liveEnumerator: fixtureLiveEnumerator(actionClass),
    construct(): never {
      throw new Error(
        `${actionClass} has no production constructor; the fixture enumerator exists only ` +
          'so 25 §14.1 dispatch revalidation has an enumeration to revalidate against, and ' +
          'revalidation constructs no payload',
      );
    },
  } as unknown as RegisteredConstructor;
}
