import { describe, expect, it } from 'vitest';

import { computed } from '../../src/kernel/canonicalisation/brands.js';
import { CanonicalisationDenied } from '../../src/kernel/canonicalisation/errors.js';
import { parseProposedIntent } from '../../src/kernel/canonicalisation/intent.js';
import { refundCreateConstructor } from '../../src/kernel/canonicalisation/constructors/refundCreate.js';
import type {
  ConstructedEffect,
  ConstructorInput,
  RegisteredConstructor,
} from '../../src/kernel/canonicalisation/registry.js';
import type {
  AuthoritativeCanonicalisationContext,
  SelectedAuthoritativeOption,
  SelectedAuthoritativeRefundOption,
} from '../../src/kernel/canonicalisation/types.js';
import {
  makeCanonicaliser,
  makeContext,
  makeRawIntent,
  makeRefundOption,
} from '../support/canonicalisationFixture.js';
import {
  VC_C1_ORDER,
  VC_C1_OUT_OF_SCOPE_REASON_CODE,
  VC_C1_REASON_CODE,
  VC_C1_REASON_CODE_SCOPES,
  VC_C1_SEMANTIC_OPTION_FIELDS,
} from '../support/canonicalisationOracle.js';

/**
 * CANONICALISATION INPUT COHESION — S1B.2, finding 1, table-driven.
 *
 * The canonicaliser is handed three things: the four permitted intent fields, an
 * authoritative context, and a selected authoritative option. Several relationships BETWEEN
 * them are authoritative facts, and the original S1B checked only three of them. A
 * canonicaliser that constructs from mutually contradictory inputs emits a request that is
 * internally false — one naming order A while acting on order B, or recording a reason code
 * that contradicts the effect it selected — and every downstream check then reasons about
 * the wrong thing.
 *
 * ---------------------------------------------------------------------------------
 * ONE RELATIONSHIP PER CASE, AND A POSITIVE CONTROL
 *
 * `36 §0`'s discipline: a failing check whose fixture breaks two things at once cannot say
 * which one it detected, and a suite with no positive control cannot be distinguished from
 * a suite that never runs. So every row below corrupts EXACTLY ONE relationship, leaves
 * every other one intact, and the positive control canonicalises the ordinary VC-C1 fixture
 * through the same instrumented registry.
 *
 * FAIL CLOSED BEFORE AN EFFECT IS EMITTED is asserted mechanically rather than by reading
 * the code: the registered constructor is wrapped in a call counter, and every failing row
 * asserts the counter did not move.
 *
 * THROW versus DENY. A contradiction between two KERNEL-OWNED inputs throws: no
 * `ProposedIntent` can produce it, and `26 §7` returns coarse categories to the model, so
 * returning one would report a model-visible category for a condition no model can cause. A
 * contradiction between a PERMITTED INTENT FIELD and the authoritative option denies, under
 * a code `26 §7` already declares. No new denial code was invented.
 * ---------------------------------------------------------------------------------
 */

// =====================================================================================
// The instrumented registry: the real constructor, wrapped in a call counter.
// =====================================================================================

let constructCalls = 0;

const countingRefundConstructor: RegisteredConstructor = {
  ...refundCreateConstructor,
  construct: (input: ConstructorInput): ConstructedEffect => {
    constructCalls += 1;
    return refundCreateConstructor.construct(input);
  },
};

function canonicaliseWith(
  option: SelectedAuthoritativeOption,
  context: AuthoritativeCanonicalisationContext,
  raw: Record<string, unknown>,
): () => unknown {
  const { canonicaliser } = makeCanonicaliser({ constructors: [countingRefundConstructor] });
  return () => canonicaliser.canonicalise(parseProposedIntent(raw), context, option);
}

// =====================================================================================
// The table.  Exactly one authoritative relationship corrupted per row.
// =====================================================================================

const ORDINARY_OPTION = makeRefundOption();

interface CohesionCase {
  readonly relationship: string;
  readonly why: string;
  /** The call that must fail closed. */
  readonly run: () => () => unknown;
  /** `throw` for a kernel/kernel contradiction, `deny` for an intent/authoritative one. */
  readonly failure:
    | { readonly kind: 'throw'; readonly message: RegExp }
    | { readonly kind: 'deny'; readonly code: string; readonly detail: string };
}

const CASES: readonly CohesionCase[] = [
  {
    relationship: 'resource_ref / resolved resource',
    why:
      '`26 §2.1`: the resource is "resolved from resource_ref". The option agreeing with the ' +
      'resolved resource is not enough — the MODEL-NAMED ref and the resolved resource must ' +
      'agree too, or the request names one order while acting on another.',
    run: () => {
      // intent.resource_ref = order:ORD-123  (the fixture default)
      // context.resource    = order:OTHER-999 / OTHER-999
      // option.resourceId   = OTHER-999       <- agrees with the resolved resource
      const option = makeRefundOption({ resourceId: 'OTHER-999' });
      return canonicaliseWith(
        option,
        makeContext({
          resource: {
            resourceRef: 'order:OTHER-999',
            resourceId: 'OTHER-999',
            grade: 'RECORD',
          },
        }),
        makeRawIntent(option, { resourceRef: VC_C1_ORDER.resourceRef }),
      );
    },
    failure: { kind: 'throw', message: /intent resource_ref .* is not the resolved resource/ },
  },
  {
    relationship: 'option / resolved resource',
    why: 'The authoritative option must be an option FOR the resolved resource.',
    run: () => {
      const option = makeRefundOption({ resourceId: 'ORD-999' });
      return canonicaliseWith(option, makeContext(), makeRawIntent(option));
    },
    failure: { kind: 'deny', code: 'SELECTOR_INVALID', detail: 'OPTION_RESOURCE_MISMATCH' },
  },
  {
    relationship: 'option action class / intent action class',
    why: 'An option for another class would be constructed by the wrong constructor.',
    run: () => {
      // The cast is the point: this state is not reachable through the fixture types, and a
      // caller would have to assemble it deliberately. The kernel still refuses it.
      const option = {
        ...ORDINARY_OPTION,
        actionClass: computed('campaign.pause'),
      } as unknown as SelectedAuthoritativeOption;
      return canonicaliseWith(option, makeContext(), makeRawIntent(ORDINARY_OPTION));
    },
    failure: { kind: 'deny', code: 'SELECTOR_INVALID', detail: 'OPTION_ACTION_CLASS_MISMATCH' },
  },
  {
    relationship: 'option currency / ledger currency',
    why:
      'S1B.2 finding 1C. The constructor writes `context.ledgerCurrency` into the parameters ' +
      'and the payload. A disagreement silently REINTERPRETS a EUR option as USD at the same ' +
      'numeral. `51 §5.1`: "Single currency only." No FX is implemented and none is implied.',
    run: () => {
      const option = makeRefundOption({ currency: 'EUR' });
      return canonicaliseWith(
        option,
        makeContext({ ledgerCurrency: 'USD' }),
        makeRawIntent(option),
      );
    },
    failure: { kind: 'throw', message: /denominated in EUR, not the ledger currency USD/ },
  },
  {
    relationship: 'reason_code / reason_code_scope',
    why:
      'S1B.2 finding 1D. `reason_code_scope` is a member of the declared semantic option ' +
      'identity for this class (`26 §2.2`), so a reason code outside the selected scope ' +
      'records a reason contradicting the effect selected. Model-reachable, so it denies.',
    run: () => {
      // The option keeps GOODS_FAULT; the intent proposes a BILLING_ERROR-scoped code.
      const option = makeRefundOption({ reasonCodeScope: 'GOODS_FAULT' });
      return canonicaliseWith(
        option,
        makeContext(),
        makeRawIntent(option, { reasonCode: VC_C1_OUT_OF_SCOPE_REASON_CODE }),
      );
    },
    failure: { kind: 'deny', code: 'SELECTOR_INVALID', detail: 'REASON_CODE_SCOPE_MISMATCH' },
  },
];

describe('POSITIVE CONTROL — the ordinary refund fixture canonicalises', () => {
  it('an uncorrupted fixture produces an effect, through the same instrumented registry', () => {
    constructCalls = 0;
    const result = canonicaliseWith(
      ORDINARY_OPTION,
      makeContext(),
      makeRawIntent(ORDINARY_OPTION),
    )() as { request: { selectedOption: { optionId: string } } };
    expect(constructCalls, 'the instrumented constructor did not run').toBe(1);
    expect(result.request.selectedOption.optionId).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('every corrupted relationship fails closed, one at a time', () => {
  for (const testCase of CASES) {
    it(`${testCase.relationship} — ${testCase.failure.kind}s before construction`, () => {
      constructCalls = 0;
      const run = testCase.run();

      if (testCase.failure.kind === 'throw') {
        expect(run, testCase.why).toThrow(testCase.failure.message);
        // And it is NOT a denial: a coarse model-visible category for a condition no
        // ProposedIntent can produce would be a misreport.
        let error: unknown = null;
        try {
          run();
        } catch (caught) {
          error = caught;
        }
        expect(error).not.toBeInstanceOf(CanonicalisationDenied);
      } else {
        let denial: CanonicalisationDenied | null = null;
        try {
          run();
        } catch (error) {
          if (error instanceof CanonicalisationDenied) denial = error;
          else throw error;
        }
        expect(denial, testCase.why).not.toBeNull();
        expect(denial!.code).toBe(testCase.failure.code);
        expect(denial!.detail).toBe(testCase.failure.detail);
      }

      // THE STRUCTURAL HALF: no effect was emitted, because the constructor never ran.
      expect(
        constructCalls,
        `${testCase.relationship}: the constructor ran despite contradictory inputs`,
      ).toBe(0);
    });
  }

  it('the table covers every relationship the finding names, and no case is duplicated', () => {
    expect(CASES.map((c) => c.relationship)).toEqual([
      'resource_ref / resolved resource',
      'option / resolved resource',
      'option action class / intent action class',
      'option currency / ledger currency',
      'reason_code / reason_code_scope',
    ]);
    expect(new Set(CASES.map((c) => c.relationship)).size).toBe(CASES.length);
  });
});

describe('the reason-code scope rule is the S1B-C6 fixture mapping, checked independently', () => {
  /**
   * The oracle transcribes the S1B-C6 mapping by hand and imports nothing from `src/`, so
   * this compares production behaviour against an independent table rather than against
   * itself — `36 §0`.
   *
   * Recorded as a FIXTURE-LEVEL consistency rule tied to S1B-C6. Not a claim that this enum,
   * or this grouping, is universal production policy.
   */
  const { canonicaliser } = makeCanonicaliser();

  it('the ordinary fixture reason code is in the selected option scope', () => {
    expect(VC_C1_REASON_CODE_SCOPES[VC_C1_REASON_CODE]).toBe(
      VC_C1_SEMANTIC_OPTION_FIELDS.reasonCodeScope,
    );
  });

  it('the out-of-scope reason code really is in another scope', () => {
    expect(VC_C1_REASON_CODE_SCOPES[VC_C1_OUT_OF_SCOPE_REASON_CODE]).not.toBe(
      VC_C1_SEMANTIC_OPTION_FIELDS.reasonCodeScope,
    );
  });

  it('every reason code is accepted against an option declaring ITS OWN scope', () => {
    // The rule constrains the PAIR, not the reason code: no code is globally forbidden.
    for (const [reasonCode, scope] of Object.entries(VC_C1_REASON_CODE_SCOPES)) {
      const option: SelectedAuthoritativeRefundOption = makeRefundOption({
        reasonCodeScope: scope as SelectedAuthoritativeRefundOption['reasonCodeScope'],
      });
      const result = canonicaliser.canonicalise(
        parseProposedIntent(makeRawIntent(option, { reasonCode })),
        makeContext(),
        option,
      );
      expect(result.request.reasonCode, reasonCode).toBe(reasonCode);
      expect(result.request.parameters.reasonCodeScope, reasonCode).toBe(scope);
    }
  });

  it('and every code is refused against an option declaring a DIFFERENT scope', () => {
    for (const [reasonCode, scope] of Object.entries(VC_C1_REASON_CODE_SCOPES)) {
      const otherScope = Object.values(VC_C1_REASON_CODE_SCOPES).find((s) => s !== scope)!;
      const option: SelectedAuthoritativeRefundOption = makeRefundOption({
        reasonCodeScope: otherScope as SelectedAuthoritativeRefundOption['reasonCodeScope'],
      });
      let denial: CanonicalisationDenied | null = null;
      try {
        canonicaliser.canonicalise(
          parseProposedIntent(makeRawIntent(option, { reasonCode })),
          makeContext(),
          option,
        );
      } catch (error) {
        if (error instanceof CanonicalisationDenied) denial = error;
        else throw error;
      }
      expect(denial?.detail, `${reasonCode} against ${otherScope}`).toBe(
        'REASON_CODE_SCOPE_MISMATCH',
      );
    }
  });
});
