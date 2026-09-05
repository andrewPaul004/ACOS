/**
 * NEGATIVE — an action catalogue entry cannot be supplied as canonicalisation context.
 * S1B.2, finding 1B.
 *
 * `26 §2.1`: `recoverability` and `value_direction` come "From the catalogue, never null
 * (I59)". `26 §5` assigns recoverability per class. `26 §11.2` assigns value_direction per
 * class. The adapter and the method are catalogue rows too. Every one of them is a property
 * of the CLOSED CATALOGUE keyed by `action_class` — not of the request, and not of whatever
 * the caller happened to assemble.
 *
 * The original S1B carried `catalogueEntry` on `AuthoritativeCanonicalisationContext` and
 * the canonicaliser trusted it, so a caller could hand a `refund.create` request
 * `campaign.pause`'s recoverability, its value_direction, its adapter or its method. The
 * repair removes the field rather than validating it, and this file is that repair's
 * compile-time form: the substitution has NO EXPRESSIBLE SHAPE.
 *
 * If the field were ever restored to the context, this file would compile — which is what
 * makes it a test rather than a comment.
 */

import { ACTION_CATALOGUE } from '../../src/kernel/canonicalisation/actionCatalogue.js';
import { computed } from '../../src/kernel/canonicalisation/brands.js';
import type { AuthoritativeCanonicalisationContext } from '../../src/kernel/canonicalisation/types.js';

/** Another class's row, exactly as a mis-wired caller would have had it to hand. */
const anotherClassesRow = ACTION_CATALOGUE['campaign.pause'];

// EXPECT_ERROR: AuthoritativeCanonicalisationContext has no `catalogueEntry` member, so a
// `refund.create` request cannot acquire campaign.pause's recoverability, value_direction,
// adapter or method through caller-supplied context.
export const context: Pick<AuthoritativeCanonicalisationContext, 'ledgerCurrency'> = {
  ledgerCurrency: computed('USD'),
  catalogueEntry: computed(anotherClassesRow), // EXPECT_ERROR TS2353
};
