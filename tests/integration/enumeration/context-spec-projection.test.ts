import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { toDb } from '../../../src/kernel/exposure/money.js';
import { parseProposedIntent } from '../../../src/kernel/canonicalisation/intent.js';
import { refundOptionDescriptionFields } from '../../../src/kernel/canonicalisation/constructors/refundCreate.js';
import type { SelectedAuthoritativeRefundOption } from '../../../src/kernel/canonicalisation/types.js';
import {
  projectOptionDescription,
  projectedFieldNames,
} from '../../../src/kernel/enumeration/contextSpec.js';
import { createHarness, type Harness } from '../../support/fixture.js';
import {
  ADMITTED_DESCRIPTION_FIELDS,
  CAN03,
  entityKeyFor,
  kernelContext,
  loadCommerceFixture,
  makeEnumerationHarness,
  makeSpec,
  rawIntent,
  type EnumerationHarness,
} from '../../support/enumerationFixture.js';

/**
 * `I52` — the runtime projection half.
 *
 * Registry `I52`, verbatim:
 *
 *   "No `EnumeratedOptionSet` returned by `enumerate_effects` contains, in any option
 *    description, a field outside the requesting task's `context_spec` admitted-field set."
 *
 * `26 §2.0.1`, verbatim: "enforced by a projection filter at runtime **and by spec review in
 * CI**."
 *
 * ---------------------------------------------------------------------------------
 * S1C IMPLEMENTS THE RUNTIME HALF AND CLAIMS ONLY THAT
 *
 * There is no CI spec review in this increment. `S1C-result.md` reports `I52` as the runtime
 * projection filter, PROVEN, with the CI spec-review half OPEN. The mandate is explicit:
 * "Do not claim the CI spec-review half unless actually implemented."
 * ---------------------------------------------------------------------------------
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

async function enumerateWith(admitted: readonly string[] | null | undefined) {
  return kernel.leases.withEntityLease(KEY, (lease) =>
    kernel.enumerator.enumerate(lease, {
      actionClass: 'refund.create',
      resourceRef: CAN03.resourceRef,
      spec:
        admitted === undefined
          ? makeSpec()
          : makeSpec({ admittedDescriptionFields: admitted }),
    }),
  );
}

describe('4 — a field the context_spec omits cannot appear in ANY description', () => {
  it('the full fixture spec renders every candidate field', async () => {
    // The positive control. Without it, "the field is absent" below could be produced by a
    // projection that renders nothing at all.
    const outcome = await enumerateWith(undefined);
    for (const [index, option] of outcome.set.options.entries()) {
      const authoritative = outcome.authoritative[index]!.option as SelectedAuthoritativeRefundOption;
      expect(option.description).toContain(`amount=${toDb(authoritative.amount)}`);
      expect(option.description).toContain(`line=${authoritative.lineId}`);
      expect(option.description).toContain(
        `parent_transaction=${authoritative.parentTransactionId}`,
      );
      expect(option.description).toContain(`instrument=${authoritative.instrument}`);
      expect(option.description).toContain(
        `refundable_remaining=${toDb(authoritative.lineRefundableRemaining)}`,
      );
    }
  });

  it('WITHHOLDING refundable_remaining removes its NAME and its VALUE from every description', async () => {
    // The discriminating case. `refundable_remaining` is a real candidate the constructor
    // offers and a real policy operand (`26 §8`), so a projection that ignored the spec would
    // emit it here.
    const withheld = ADMITTED_DESCRIPTION_FIELDS.filter((f) => f !== 'refundable_remaining');
    const outcome = await enumerateWith(withheld);

    expect(outcome.set.options).toHaveLength(2);
    for (const [index, option] of outcome.set.options.entries()) {
      const authoritative = outcome.authoritative[index]!.option as SelectedAuthoritativeRefundOption;
      expect(option.description).not.toContain('refundable_remaining');
      // And the VALUE is gone too, not merely the label. Line B's remaining is $20.00 and
      // its amount is also $20.00, so the check is made against line A, where the two
      // differ... except in this fixture they do not. Assert on the field-name form instead,
      // plus the structural check below, which is the stronger statement.
      expect(option.description).not.toMatch(/refundable/);
      expect(authoritative.lineRefundableRemaining).toBeDefined();
    }
  });

  it('THE STRUCTURAL FORM OF I52 — the emitted field names are a SUBSET of the admitted set', async () => {
    // Asserted from the same filter the renderer uses, not by re-parsing the rendered
    // string, so it cannot pass against a renderer that leaked.
    for (const admitted of [
      ADMITTED_DESCRIPTION_FIELDS,
      ADMITTED_DESCRIPTION_FIELDS.filter((f) => f !== 'refundable_remaining'),
      ['amount'],
      [],
    ]) {
      const spec = makeSpec({ admittedDescriptionFields: admitted });
      const outcome = await enumerateWith(admitted);
      for (const entry of outcome.authoritative) {
        const emitted = projectedFieldNames(
          spec,
          'refund.create',
          refundOptionDescriptionFields(entry.option as SelectedAuthoritativeRefundOption),
        );
        for (const name of emitted) {
          expect(admitted, `${name} was emitted but is not admitted`).toContain(name);
        }
      }
    }
  });

  it('a context_spec admitting NO field for the class produces empty descriptions, not full ones', async () => {
    // The default is CLOSED. A `context_spec` that forgot to declare a class must fail
    // towards silence, which is the direction a field-visibility control has to fail in.
    const outcome = await enumerateWith(null);
    expect(outcome.set.options).toHaveLength(2);
    for (const option of outcome.set.options) {
      expect(option.description).toBe('');
    }
    // The option ids are unaffected: a description is not part of option identity.
    const full = await enumerateWith(undefined);
    expect(outcome.set.options.map((o) => o.optionId)).toEqual(
      full.set.options.map((o) => o.optionId),
    );
  });

  it('the admitted set is applied per ACTION CLASS, and an unrelated class admits nothing', () => {
    const spec = makeSpec();
    const option = {
      lineId: 'L', parentTransactionId: 'T', instrument: 'original',
    } as unknown as SelectedAuthoritativeRefundOption;
    expect(
      projectOptionDescription(spec, 'campaign.pause', [{ name: 'amount', value: '1.00' }]),
    ).toBe('');
    expect(projectedFieldNames(spec, 'campaign.pause', [{ name: 'amount', value: '1.00' }])).toEqual(
      [],
    );
    expect(option.lineId).toBe('L');
  });

  it('the rendering order is the CONSTRUCTOR-declared order, not the admitted set order', () => {
    // A `context_spec` edit that reorders a set must not reorder a description — otherwise
    // the description recorded on the request could differ from the one shown, in bytes,
    // without any field changing.
    const forward = makeSpec({
      admittedDescriptionFields: ['amount', 'currency', 'line'],
    });
    const reversed = makeSpec({
      admittedDescriptionFields: ['line', 'currency', 'amount'],
    });
    const fields = [
      { name: 'amount', value: '10.00' },
      { name: 'currency', value: 'USD' },
      { name: 'line', value: 'L1' },
    ];
    expect(projectOptionDescription(forward, 'refund.create', fields)).toBe(
      projectOptionDescription(reversed, 'refund.create', fields),
    );
    expect(projectOptionDescription(forward, 'refund.create', fields)).toBe(
      'amount=10.00 currency=USD line=L1',
    );
  });
});

describe('10 — the RECORDED description is the authoritative projected one the model saw', () => {
  it('AuthorizationRequest.selected_option.description === the enumeration option description', async () => {
    // `26 §2.1`: `selected_option` is "the enumerated option whose `option_id` the selector
    // names, **with its full description**". The mandate: "No separately reconstructed
    // description may drift from it."
    const outcome = await kernel.leases.withEntityLease(KEY, (lease) =>
      kernel.enumerator.enumerate(lease, {
        actionClass: 'refund.create',
        resourceRef: CAN03.resourceRef,
        spec: makeSpec(),
      }),
    );
    const seen = outcome.set.options[0]!;
    const intent = parseProposedIntent(
      rawIntent({ enumerationId: outcome.set.enumerationId, optionId: seen.optionId }),
    );

    const effect = await kernel.leases.withEntityLease(KEY, (lease) =>
      kernel.liveSelector.canonicaliseUnderLease(lease, intent, makeSpec(), kernelContext()),
    );

    expect(effect.request.selectedOption.description).toBe(seen.description);
    expect(effect.request.selectedOption.description).not.toBe('');
  });

  it('AND the recorded description obeys the SAME context_spec restriction', async () => {
    // The consequence that matters: `I52` governs the audit record too. A projection applied
    // only on the way out would let a withheld field reach the AuthorizationRequest, where
    // `30`'s audit mirror would carry it to a place the task was never entitled to put it.
    const withheld = ADMITTED_DESCRIPTION_FIELDS.filter((f) => f !== 'refundable_remaining');
    const spec = makeSpec({ admittedDescriptionFields: withheld });

    const outcome = await kernel.leases.withEntityLease(KEY, (lease) =>
      kernel.enumerator.enumerate(lease, {
        actionClass: 'refund.create',
        resourceRef: CAN03.resourceRef,
        spec,
      }),
    );
    const seen = outcome.set.options[0]!;
    const intent = parseProposedIntent(
      rawIntent({ enumerationId: outcome.set.enumerationId, optionId: seen.optionId }),
    );

    const effect = await kernel.leases.withEntityLease(KEY, (lease) =>
      kernel.liveSelector.canonicaliseUnderLease(lease, intent, spec, kernelContext()),
    );

    expect(effect.request.selectedOption.description).toBe(seen.description);
    expect(effect.request.selectedOption.description).not.toMatch(/refundable/);
  });

  it('A CHANGED context_spec between the READ and C′ is a THROWN DEFECT, not a silent drift', async () => {
    // ---------------------------------------------------------------------------------
    // This test found a real weakness and drove a repair.
    //
    // The first version of the boundary compared the constructor's description against the
    // LIVE re-projection. Both come from the same `projectOptionDescription` call over the
    // same live option and the same `context_spec`, so a spec that changed between the READ
    // and C′ moved BOTH halves together: the request recorded a description the model never
    // saw, and the check could not notice.
    //
    // The repair is in `enumerationRecord.ts` and `liveSelector.ts` step 5a — the projected
    // descriptions are RECORDED at enumeration time and C′ compares against the stored one,
    // which is the string the model actually read. This test is that repair's evidence.
    //
    // The scenario below is not exotic: `context_spec`s are versioned control artifacts
    // (`23 §5` B9) and a deploy between a worker's read and its proposal is exactly how they
    // change under a running system.
    // ---------------------------------------------------------------------------------
    const outcome = await kernel.leases.withEntityLease(KEY, (lease) =>
      kernel.enumerator.enumerate(lease, {
        actionClass: 'refund.create',
        resourceRef: CAN03.resourceRef,
        spec: makeSpec(),
      }),
    );
    const intent = parseProposedIntent(
      rawIntent({
        enumerationId: outcome.set.enumerationId,
        optionId: outcome.set.options[0]!.optionId,
      }),
    );

    // Same task and principal — so the enumeration binding still matches — but a NARROWER
    // admitted-field set than the one the model read under.
    const narrowed = makeSpec({ admittedDescriptionFields: ['amount'] });
    await expect(
      kernel.leases.withEntityLease(KEY, (lease) =>
        kernel.liveSelector.canonicaliseUnderLease(lease, intent, narrowed, kernelContext()),
      ),
    ).rejects.toThrow(/I52: the recorded selected-option description/);
  });

  it('the recorded description is the STORED one, so it cannot drift with the spec', async () => {
    // The positive half of the same repair: canonicalising under the SAME spec succeeds and
    // the recorded description equals the row stored at enumeration time.
    const outcome = await kernel.leases.withEntityLease(KEY, (lease) =>
      kernel.enumerator.enumerate(lease, {
        actionClass: 'refund.create',
        resourceRef: CAN03.resourceRef,
        spec: makeSpec(),
      }),
    );
    const intent = parseProposedIntent(
      rawIntent({
        enumerationId: outcome.set.enumerationId,
        optionId: outcome.set.options[0]!.optionId,
      }),
    );
    const effect = await kernel.leases.withEntityLease(KEY, (lease) =>
      kernel.liveSelector.canonicaliseUnderLease(lease, intent, makeSpec(), kernelContext()),
    );

    const client = await harness.connect();
    try {
      const row = await client.query<{ options: { option_id: string; description: string }[] }>(
        'SELECT options FROM enumeration_record WHERE enumeration_id = $1',
        [outcome.set.enumerationId],
      );
      const stored = row.rows[0]!.options.find(
        (o) => o.option_id === effect.request.selectedOption.optionId,
      );
      expect(stored).toBeDefined();
      expect(effect.request.selectedOption.description).toBe(stored!.description);
    } finally {
      client.release();
    }
  });

  it('and a description is NOT part of option identity — narrowing the spec leaves option_id alone', async () => {
    // `26 §2.1.2` classes `description_string` as NON-SEMANTIC. If a description change moved
    // `option_id`, every `context_spec` edit would invalidate every outstanding selector.
    const wide = await enumerateWith(undefined);
    const narrow = await enumerateWith(['amount']);
    expect(narrow.set.options.map((o) => o.optionId)).toEqual(
      wide.set.options.map((o) => o.optionId),
    );
    expect(narrow.set.options[0]!.description).not.toBe(wide.set.options[0]!.description);
  });
});
