import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { toDb } from '../../../src/kernel/exposure/money.js';
import { CanonicalisationDenied } from '../../../src/kernel/canonicalisation/errors.js';
import { parseProposedIntent } from '../../../src/kernel/canonicalisation/intent.js';
import { sealRationale } from '../../../src/kernel/canonicalisation/rationale.js';
import { projectDenialToWorker } from '../../../src/kernel/enumeration/workerFacingDenial.js';
import { unsafeCanonicaliseByPosition } from '../../negative-controls/unsafe-positional-selector.js';
import { createHarness, type Harness } from '../../support/fixture.js';
import {
  CAN03,
  entityKeyFor,
  exhaustLineA,
  kernelContext,
  loadCommerceFixture,
  makeEnumerationHarness,
  makeSpec,
  rawIntent,
  type EnumerationHarness,
} from '../../support/enumerationFixture.js';

/**
 * VC-C3 — CAN-03, the mandatory reordering fixture, directly.
 *
 * `36 §2` VC-C3, verbatim:
 *
 *   "**VC-C3 — content-addressed selectors never substitute.** The reordering fixture,
 *    directly: order 123 with refundable lines `[A: $10.00, B: $20.00]`; the worker selects
 *    A's `option_id`; a concurrent partial refund exhausts A; step C′ re-enumerates.
 *    **Assert `DENY: SELECTOR_STALE` and assert no effect was dispatched.** Under v1.1's
 *    positional index this fixture dispatched a refund of line B with every invariant
 *    holding."
 *
 * Registry `I53`'s test column, verbatim: "`53 §1` CAN-03's reordering scenario with an
 * injected concurrent partial refund. **Mandatory negative control: the same test under
 * positional selectors must produce the substitution.**"
 *
 * Both halves are in this file, deliberately: a passing production assertion is worth
 * nothing without the control immediately beside it showing that the fixture can detect the
 * failure.
 */

let harness: Harness;
let kernel: EnumerationHarness;

beforeAll(async () => {
  harness = await createHarness();
});

afterAll(async () => {
  await harness.close();
});

beforeEach(async () => {
  await harness.reset();
  const client = await harness.connect();
  try {
    await loadCommerceFixture(client);
  } finally {
    client.release();
  }
  kernel = makeEnumerationHarness(harness);
});

const KEY = entityKeyFor(CAN03.orderId);

/** Step 1 of the fixture: the worker enumerates and reads A's option id. */
async function enumerateAndSelectA(): Promise<{
  enumerationId: string;
  optionIdA: string;
  optionIdB: string;
}> {
  return kernel.leases.withEntityLease(KEY, async (lease) => {
    const outcome = await kernel.enumerator.enumerate(lease, {
      actionClass: 'refund.create',
      resourceRef: CAN03.resourceRef,
      spec: makeSpec(),
    });
    expect(outcome.set.options).toHaveLength(2);
    // `[A: $10.00, B: $20.00]`, and A is first.
    expect(toDb(outcome.authoritative[0]!.option.amount)).toBe(CAN03.lineAAmount);
    expect(outcome.authoritative[0]!.option.lineId).toBe(CAN03.lineA);
    return {
      enumerationId: outcome.set.enumerationId,
      optionIdA: outcome.set.options[0]!.optionId,
      optionIdB: outcome.set.options[1]!.optionId,
    };
  });
}

/** The injected concurrent partial refund, on its own connection. */
async function injectConcurrentExhaustionOfA(): Promise<void> {
  const client = await harness.connect();
  try {
    await exhaustLineA(client);
  } finally {
    client.release();
  }
}

describe('7 & 8 — CAN-03 under the PRODUCTION content-addressed selector', () => {
  it('denies SELECTOR_STALE, constructs NO effect, and NEVER substitutes B', async () => {
    // --- the worker enumerates and chooses A's CONTENT ADDRESS -------------------------
    const { enumerationId, optionIdA, optionIdB } = await enumerateAndSelectA();

    // --- the concurrent state change that exhausts A -----------------------------------
    await injectConcurrentExhaustionOfA();

    // --- and C′ re-enumerates under the entity lease -----------------------------------
    const intent = parseProposedIntent(rawIntent({ enumerationId, optionId: optionIdA }));

    const outcome = await kernel.leases.withEntityLease(KEY, async (lease) => {
      // The live set really has become `[B: $20.00]` — asserted here so the denial below
      // cannot be produced by an empty set or by a failed read.
      const live = await kernel.enumerator.reEnumerate(lease, {
        actionClass: 'refund.create',
        resourceRef: CAN03.resourceRef,
        spec: makeSpec(),
      });
      expect(live.set.options).toHaveLength(1);
      expect(live.set.options[0]!.optionId).toBe(optionIdB);
      expect(toDb(live.authoritative[0]!.option.amount)).toBe(CAN03.lineBAmount);
      expect(live.authoritative[0]!.option.lineId).toBe(CAN03.lineB);

      return kernel.liveSelector
        .canonicaliseUnderLease(lease, intent, makeSpec(), kernelContext())
        .then(
          (effect) => ({ denied: null, effect }),
          (error: unknown) => ({ denied: error, effect: null }),
        );
    });

    // --- `36 §2` VC-C3: "Assert DENY: SELECTOR_STALE" ----------------------------------
    expect(outcome.effect, 'an effect was constructed for a stale option').toBeNull();
    expect(outcome.denied).toBeInstanceOf(CanonicalisationDenied);
    const denial = outcome.denied as CanonicalisationDenied;
    expect(denial.code).toBe('SELECTOR_STALE');
    expect(denial.detail).toBe('OPTION_ABSENT_FROM_LIVE_SET');

    // --- "and assert no effect was dispatched" -----------------------------------------
    //
    // S1C dispatches nothing at all, so the strong form of the assertion is that no
    // canonical effect exists — there is no request, no dispatch payload and no
    // idempotency key for anything. Asserted above by `effect === null`.
    //
    // --- ASSERT EXPLICITLY THAT B WAS NEVER SUBSTITUTED --------------------------------
    //
    // The mandate: "Assert explicitly that B is never substituted." This is the assertion
    // that separates "denied" from "denied for the right reason": B's option_id is live and
    // valid at this instant, and a substituting implementation would have returned an effect
    // carrying it.
    expect(denial.message).not.toContain(optionIdB);
    expect(denial.message).not.toContain(CAN03.lineB);
    expect(denial.message).not.toContain(CAN03.lineBAmount);

    // And no reservation, no effect row and no journal sequence moved.
    const client = await harness.connect();
    try {
      expect((await client.query('SELECT 1 FROM exposure_reservation')).rowCount).toBe(0);
      const counter = await client.query<{ next_seq: string }>('SELECT next_seq FROM journal_counter');
      expect(counter.rows[0]!.next_seq).toBe('1');
    } finally {
      client.release();
    }
  });

  it('the CONTROL — with A still live, the same intent canonicalises A and only A', async () => {
    // Without this, the denial above could be produced by an implementation that denies
    // everything. Same fixture, same intent, no mutation.
    const { enumerationId, optionIdA } = await enumerateAndSelectA();
    const intent = parseProposedIntent(rawIntent({ enumerationId, optionId: optionIdA }));

    const effect = await kernel.leases.withEntityLease(KEY, (lease) =>
      kernel.liveSelector.canonicaliseUnderLease(lease, intent, makeSpec(), kernelContext()),
    );

    expect(effect.request.selectedOption.optionId).toBe(optionIdA);
    expect(effect.request.parameters.lineId).toBe(CAN03.lineA);
    expect(toDb(effect.request.parameters.amount)).toBe(CAN03.lineAAmount);
    // `I18a`: the dispatched money is `vendor_amount`, and it is A's $10.00, not B's $20.00.
    expect(effect.dispatchPayload.vendorParameters['amount']).toBe(CAN03.lineAAmount);
    // `I18b`/`I18c`: $10.00 + A's $0.59 authoritative retained fee.
    expect(toDb(effect.request.exposure.totalExposure)).toBe('10.59');
  });

  it('selecting B AFTER A is exhausted still works — the denial is about identity, not the order', async () => {
    // The sharpest control. If C′ denied because "the set changed", this would deny too. It
    // must not: B's option_id is unchanged by A's exhaustion, because
    // `line_refundable_remaining` for line A is not a member of line B's option identity —
    // and B's own is not a member of B's identity either (S1B.2 finding 2).
    const { enumerationId, optionIdB } = await enumerateAndSelectA();
    await injectConcurrentExhaustionOfA();

    const intent = parseProposedIntent(rawIntent({ enumerationId, optionId: optionIdB }));
    const effect = await kernel.leases.withEntityLease(KEY, (lease) =>
      kernel.liveSelector.canonicaliseUnderLease(lease, intent, makeSpec(), kernelContext()),
    );
    expect(effect.request.parameters.lineId).toBe(CAN03.lineB);
    expect(toDb(effect.request.parameters.amount)).toBe(CAN03.lineBAmount);
  });

  it('the worker sees the coarse DENY: SELECTOR and nothing else', async () => {
    // `26 §2.0.1`: "A single `DENY: SELECTOR` category covers out-of-range, stale and
    // downstream denial, so cardinality is not recoverable by binary search (CAN-05)."
    const { enumerationId, optionIdA } = await enumerateAndSelectA();
    await injectConcurrentExhaustionOfA();
    const intent = parseProposedIntent(rawIntent({ enumerationId, optionId: optionIdA }));

    const error = await kernel.leases
      .withEntityLease(KEY, (lease) =>
        kernel.liveSelector.canonicaliseUnderLease(lease, intent, makeSpec(), kernelContext()),
      )
      .catch((caught: unknown) => caught);

    const workerFacing = projectDenialToWorker(error as CanonicalisationDenied);
    expect(workerFacing).toEqual({ deny: 'SELECTOR' });
    expect(JSON.stringify(workerFacing)).not.toContain('STALE');
    expect(JSON.stringify(workerFacing)).not.toContain('LIVE_SET');
  });
});

describe('12 — THE MANDATORY NEGATIVE CONTROL: the same fixture under a positional selector', () => {
  it('EXPECTED SUBSTITUTION OBSERVED — index 0 selects A before, and B after', async () => {
    // ---------------------------------------------------------------------------------
    // `36 §0`'s rule, and the S1C mandate's restatement: "If the unsafe positional fixture
    // does not substitute B, the test does not discriminate the architecture's CAN-03
    // failure."
    //
    // The unsafe path uses the SAME enumerator, the SAME lease, the SAME enumeration record
    // and the SAME accepted S1B canonicaliser. The only difference is that its selector is
    // an integer. No production code is weakened to produce this.
    // ---------------------------------------------------------------------------------
    const { enumerationId } = await enumerateAndSelectA();

    const unsafeIntent = {
      actionClass: 'refund.create' as const,
      resourceRef: CAN03.resourceRef,
      // `26 §2.0.1`: "the model reads the enumeration and submits index 0 for line A".
      selector: 0,
      enumerationId,
      reasonCode: 'CUSTOMER_REPORTED_DAMAGE' as const,
      rationale: sealRationale('Customer photographed a cracked panel on arrival.'),
    };
    const deps = { enumerator: kernel.enumerator, canonicaliser: kernel.canonicaliser };

    // --- BEFORE the mutation: index 0 denotes A ----------------------------------------
    const before = await kernel.leases.withEntityLease(KEY, (lease) =>
      unsafeCanonicaliseByPosition(deps, lease, unsafeIntent, makeSpec(), kernelContext()),
    );
    expect(before.dispatchedLineId).toBe(CAN03.lineA);
    expect(before.dispatchedAmount).toBe(CAN03.lineAAmount);

    // --- the concurrent partial refund exhausts A ---------------------------------------
    await injectConcurrentExhaustionOfA();

    // --- AFTER: index 0 is still in range, and now denotes B ----------------------------
    const after = await kernel.leases.withEntityLease(KEY, (lease) =>
      unsafeCanonicaliseByPosition(deps, lease, unsafeIntent, makeSpec(), kernelContext()),
    );

    // ===================================================================================
    // EXPECTED SUBSTITUTION OBSERVED
    //
    // `26 §2.0.1`: "index 0 is valid and denotes B; the kernel computes $20.00, every policy
    // check passes, and a refund of line B dispatches with I18, I21, I2, I3, I29 and I31 all
    // holding. The executed effect was economically different from the selected one and no
    // invariant fired."
    // ===================================================================================
    expect(after.dispatchedLineId, 'the positional control did NOT substitute').toBe(CAN03.lineB);
    expect(after.dispatchedAmount).toBe(CAN03.lineBAmount);
    expect(after.dispatchedLineId).not.toBe(before.dispatchedLineId);

    // The economic difference the architecture names: $10.00 selected, $20.00 dispatched.
    expect(toDb(after.effect.request.exposure.vendorAmount!)).toBe('20.00');
    expect(toDb(before.effect.request.exposure.vendorAmount!)).toBe('10.00');

    // And it substituted with every OTHER control intact — which is the finding. I18a holds:
    // the dispatched monetary effect equals `vendor_amount`, for the WRONG line.
    expect(toDb(after.effect.dispatchPayload.monetaryEffect!)).toBe(
      toDb(after.effect.request.exposure.vendorAmount!),
    );
    // The canonicaliser emitted a complete, internally consistent, dispatchable effect.
    expect(after.effect.request.dispatchPayloadHash).toMatch(/^[0-9a-f]{64}$/);

    console.log(
      `EXPECTED SUBSTITUTION OBSERVED — positional selector 0 dispatched ${after.dispatchedLineId} ` +
        `at ${after.dispatchedAmount} after ${before.dispatchedLineId} at ${before.dispatchedAmount} was selected`,
    );
  });

  it('and the SAME shrink is benign for the positional guard v1.1 actually had', async () => {
    // `26 §2.0.1`: v1.1's guard "catches the option set *shrinking past* the index, which is
    // the benign case." Index 1 is out of range after the shrink and the unsafe path
    // correctly refuses — which is exactly why v1.1 looked adequate and was not.
    const { enumerationId } = await enumerateAndSelectA();
    await injectConcurrentExhaustionOfA();

    const deps = { enumerator: kernel.enumerator, canonicaliser: kernel.canonicaliser };
    await expect(
      kernel.leases.withEntityLease(KEY, (lease) =>
        unsafeCanonicaliseByPosition(
          deps,
          lease,
          {
            actionClass: 'refund.create',
            resourceRef: CAN03.resourceRef,
            selector: 1,
            enumerationId,
            reasonCode: 'CUSTOMER_REPORTED_DAMAGE',
            rationale: sealRationale('x'),
          },
          makeSpec(),
          kernelContext(),
        ),
      ),
    ).rejects.toThrow(/out of range/);
  });
});
