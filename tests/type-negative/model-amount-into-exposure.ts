/**
 * NEGATIVE — a model-supplied amount cannot become an exposure figure.
 *
 * `26 §2.0`, the boxed rule: "It may never supply an authoritative precondition, an
 * exposure figure, or any field of the dispatched request."
 *
 * `35 §4`: "The $5,000 is not expressible."  At the wire boundary that is enforced by the
 * parser; here it is enforced by the type, so a future code path that somehow obtained a
 * model-chosen Money still cannot write it into `exposure`.
 */

import { money, type Money } from '../../src/kernel/exposure/money.js';
import type { Exposure } from '../../src/kernel/canonicalisation/types.js';

/** Whatever a compromised model managed to get hold of. It is a plain Money, not computed. */
const modelChosen: Money = money('5000.00');

// EXPECT_ERROR: Money is not assignable to KernelComputed<Money>.
export const exposure: Pick<Exposure, 'vendorAmount' | 'totalExposure'> = {
  vendorAmount: modelChosen, // EXPECT_ERROR TS2322
  totalExposure: modelChosen, // EXPECT_ERROR TS2375
};
