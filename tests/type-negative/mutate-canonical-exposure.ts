/**
 * NEGATIVE — a canonical effect's authoritative economics cannot be rewritten after C′.
 *
 * S1D, attack A4. `26 §7`'s C′ row, verbatim: "**Everything downstream of C′ evaluates
 * kernel-computed operands only.**"
 *
 * `AuthorisationPipeline.authoriseUnderLease` removes the runtime window by never handing a
 * caller the effect before the decision is taken. This is the compile-time half: even
 * holding an effect, the operand that bounds the money is not assignable.
 */

import { money } from '../../src/kernel/exposure/money.js';
import type { CanonicalEffect } from '../../src/kernel/canonicalisation/types.js';

declare const effect: CanonicalEffect;

export function reduceExposure(): void {
  // EXPECT_ERROR: `totalExposure` is readonly on `Exposure`.
  effect.request.exposure.totalExposure = money('25.00'); // EXPECT_ERROR TS2540
}

export function replaceExposureBlock(): void {
  // EXPECT_ERROR: `exposure` is readonly on `AuthorizationRequest`.
  effect.request.exposure = effect.request.exposure; // EXPECT_ERROR TS2540
}
