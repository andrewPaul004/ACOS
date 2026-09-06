/**
 * NEGATIVE — a model-originated amount cannot be handed to the policy engine.
 *
 * S1D, attack A7: "call the policy engine directly with model-originated authoritative
 * operands."
 *
 * The engine takes a `CanonicalEffect`, whose authority-bearing fields are
 * `KernelComputed<T>`. A plain `Money` — however a compromised worker obtained it — has no
 * assignable position, so the attack has no expressible form rather than being rejected at
 * runtime. `brands.ts`: "`computed()` is the only mint."
 *
 * Two diagnostics, because the boundary holds at two depths: the money cannot enter an
 * `Exposure`, and a hand-built `Exposure` cannot enter an `AuthorizationRequest`.
 */

import { buildCedarRequest } from '../../src/kernel/policy/cedarRequest.js';
import { money, type Money } from '../../src/kernel/exposure/money.js';
import type { CanonicalEffect, Exposure } from '../../src/kernel/canonicalisation/types.js';

declare const effect: CanonicalEffect;

/** Whatever a compromised model managed to get hold of. Plain, not computed. */
const modelChosen: Money = money('0.01');

const forgedExposure: Exposure = {
  ...effect.request.exposure,
  totalExposure: modelChosen, // EXPECT_ERROR TS2375
};

export const forged = buildCedarRequest({
  ...effect,
  request: { ...effect.request, exposure: forgedExposure }, // EXPECT_ERROR TS2322
});
