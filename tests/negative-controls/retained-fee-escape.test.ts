import { describe, expect, it } from 'vitest';

import { toDb } from '../../src/kernel/exposure/money.js';
import { ACTION_CATALOGUE } from '../../src/kernel/canonicalisation/actionCatalogue.js';
import {
  parseProposedIntent,
  permittedFieldsOf,
} from '../../src/kernel/canonicalisation/intent.js';
import {
  REFUND_VERSION_1_0,
  makeCanonicaliser,
  makeContext,
  makeRawIntent,
  makeRefundOption,
  newTestSigner,
  signConstructorVersion,
} from '../support/canonicalisationFixture.js';
import { VC_C1, formatMinor } from '../support/canonicalisationOracle.js';
import {
  UNSAFE_CONSTRUCTOR_ID,
  unsafeRetainedFeeEscapeConstructor,
  constructRefundCreateUnsafely,
} from './unsafe-retained-fee-escape.js';

/**
 * THE NEGATIVE CONTROL for VC-C1.
 *
 * `36 §0`'s two structural rules apply to more than concurrency: a check with no negative
 * control "is indistinguishable from a test that cannot detect the bug". VC-C1 exists to
 * detect one specific defect, and `26 §2.1.1` names it exactly:
 *
 *   "a developer resolving the contradiction by driving cost_components to zero silently
 *    restores the v1.0 defect R1 exists to close — 42 §8.2 row 12, compensator cost
 *    unreserved."
 *
 * and `26 §2.2`'s catalogue names it as a distinct error class:
 *
 *   "Retained fee escaping the per-action cap (v1.2) | The cap is compared against
 *    total_exposure, never vendor_amount (§8)"
 *
 * So this file carries a deliberately WRONG constructor that sets
 * `total_exposure = vendor_amount`, and asserts the fixture catches it. If the fixture did
 * not, a passing VC-C1 would prove nothing about the defect VC-C1 exists for.
 *
 * The unsafe code is TEST-ONLY. It lives under `tests/negative-controls/`, is never
 * registered by any production registry, and `src/` does not import it — the same
 * containment `tests/negative-controls/unsafe-schema.ts` uses in S1A.
 */

const option = makeRefundOption();
const context = makeContext();
const intent = parseProposedIntent(makeRawIntent(option));

describe('the unsafe constructor reproduces the escape', () => {
  const unsafe = constructRefundCreateUnsafely({
    permitted: permittedFieldsOf(intent),
    context,
    option,
    // S1B.2 finding 1B: the catalogue row is an input the CANONICALISER supplies from the
    // closed catalogue. Calling the constructor directly means supplying it here, from the
    // same closed catalogue — there is no context field to take it from.
    catalogueEntry: ACTION_CATALOGUE['refund.create'],
  });

  it('it produces $25.00 where a correct constructor produces $26.03', () => {
    expect(toDb(unsafe.exposure.totalExposure)).toBe('25.00');
    expect(toDb(unsafe.exposure.vendorAmount!)).toBe('25.00');
    expect(unsafe.exposure.costComponents).toHaveLength(0);
  });

  it('and it satisfies every check that does NOT look at total_exposure', () => {
    // This is why the defect is dangerous rather than obvious. I18a holds. The dispatched
    // amount is correct. The vendor request is correct. Only the reserved quantity — the
    // one that bounds economic loss — is wrong, and it is wrong in the permissive
    // direction.
    expect(toDb(unsafe.dispatchPayload.monetaryEffect!)).toBe('25.00');
    expect(unsafe.dispatchPayload.monetaryEffect).toBe(unsafe.exposure.vendorAmount);
    expect(unsafe.exposure.totalExposure >= unsafe.exposure.vendorAmount!).toBe(true);
  });
});

describe('THE CONTROL — the hand-authored VC-C1 fixture rejects it', () => {
  const unsafe = constructRefundCreateUnsafely({
    permitted: permittedFieldsOf(intent),
    context,
    option,
    // S1B.2 finding 1B: the catalogue row is an input the CANONICALISER supplies from the
    // closed catalogue. Calling the constructor directly means supplying it here, from the
    // same closed catalogue — there is no context field to take it from.
    catalogueEntry: ACTION_CATALOGUE['refund.create'],
  });

  it('the fixture expects $26.03 and the unsafe constructor gives $25.00', () => {
    // The expected value comes from tests/support/canonicalisationOracle.ts, which imports
    // nothing from src/.
    expect(formatMinor(VC_C1.expectedTotalExposureMinor)).toBe('26.03');
    expect(toDb(unsafe.exposure.totalExposure)).not.toBe(
      formatMinor(VC_C1.expectedTotalExposureMinor),
    );
  });

  it('the fixture expects a retained-fee cost component and the unsafe constructor has none', () => {
    expect(VC_C1.expectedRetainedFeeMinor).toBe(103n);
    expect(unsafe.exposure.costComponents).toHaveLength(0);
  });

  it('and the escape would have flipped the per-action outcome', () => {
    // The whole reason `26 §2.1.1` split the field. Against the $25.00 cap:
    //   correct   $26.03 > $25.00  -> a correct policy must DENY PER_ACTION
    //   escaped   $25.00 <= $25.00 -> the same policy PERMITS
    // S1B evaluates no policy; this is arithmetic over the two constructed exposures.
    expect(VC_C1.expectedTotalExposureMinor > VC_C1.perActionCapMinor).toBe(true);
    expect(unsafe.exposure.totalExposure <= VC_C1.perActionCapMinor).toBe(true);
  });
});

describe('and the kernel would also refuse it, independently of the fixture', () => {
  /**
   * Defence in depth, and deliberately asserted SECOND. The mandate's requirement is that
   * the hand-authored fixture catches the escape — that is the assertion above. This one
   * shows the canonicaliser's own `I18c` guard is a second, independent detector: a class
   * the catalogue does not declare cost-component-free may not emit
   * `total_exposure == vendor_amount`.
   *
   * Registry `I18c`, verbatim: "with equality only for action classes declaring an empty
   * cost_components[] in the catalogue."
   */
  it('registering the unsafe constructor makes canonicalisation throw on I18c', () => {
    const signer = newTestSigner();
    const { canonicaliser } = makeCanonicaliser({
      signer,
      constructors: [unsafeRetainedFeeEscapeConstructor],
      records: [
        signConstructorVersion(signer, {
          ...REFUND_VERSION_1_0,
          constructorId: UNSAFE_CONSTRUCTOR_ID,
        }),
      ],
    });
    expect(() => canonicaliser.canonicalise(intent, context, option)).toThrow(/I18c/);
  });

  it('the unsafe constructor is registered nowhere in production', async () => {
    const { readdirSync, readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
        entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)],
      );
    for (const file of walk('src').filter((name) => name.endsWith('.ts'))) {
      const source = readFileSync(file, 'utf8');
      expect(source, file).not.toContain(UNSAFE_CONSTRUCTOR_ID);
      // No production module may import the negative-control tree. (S1A's migration SQL
      // mentions the directory in a comment, which is why this rule reads .ts imports
      // rather than grepping every file for the word.)
      expect(source, `${file} imports the negative-control tree`).not.toMatch(
        /from\s+['"][^'"]*negative-controls/,
      );
    }
  });
});
