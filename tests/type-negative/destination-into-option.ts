/**
 * NEGATIVE — there is no independent destination field on a refund option, and none on the
 * computed parameters.  S1B.2, finding 3.
 *
 * `26 §2.2` declares `refund.create`'s semantic option identity as exactly:
 *
 *   line_id · parent_transaction_id · amount · instrument · reason_code_scope
 *
 * and requires the digest to "cover every field whose change would make the option a
 * different effect". An independently supplied `destination_instrument_ref` broke that in
 * the direction that matters: changing it changed where the money went while `option_id`
 * stayed identical.
 *
 * The repair is removal, not digest widening — widening would change an
 * architecture-declared digest. `26 §11.2` row 3's destination is "derived by the
 * canonicaliser from the RECORD-grade transaction, never from the intent", and that
 * transaction is already content-addressed by `parent_transaction_id` together with
 * `instrument`, both of which ARE digest members.
 *
 * So the second identifier has no expressible position anywhere on the money path.
 */

import { computed } from '../../src/kernel/canonicalisation/brands.js';
import type {
  RefundParameters,
  SelectedAuthoritativeRefundOption,
} from '../../src/kernel/canonicalisation/types.js';

// EXPECT_ERROR: the authoritative option carries no independent destination.
export const option: Pick<SelectedAuthoritativeRefundOption, 'currency'> = {
  currency: computed('USD'),
  destinationInstrumentRef: computed('instrument:pm_attacker_9999'), // EXPECT_ERROR TS2353
};

// EXPECT_ERROR: nor do the computed vendor parameters.
export const parameters: Pick<RefundParameters, 'currency'> = {
  currency: 'USD',
  destinationInstrumentRef: 'instrument:pm_attacker_9999', // EXPECT_ERROR TS2353
};
