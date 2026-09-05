/**
 * POSITIVE CONTROL — this file MUST compile with zero diagnostics.
 *
 * Without it, every file in this directory could be failing for an unrelated reason — a
 * typo, a bad import path, a renamed export — and the compile-negative harness would still
 * report success. `36 §0`'s discipline applies to a type-level test exactly as it does to a
 * concurrency test: a check with no positive control cannot be distinguished from a check
 * that does not run.
 *
 * Everything here is a legal use of the same imports the negative files use.
 */

import { computed } from '../../src/kernel/canonicalisation/brands.js';
import {
  parseProposedIntent,
  permittedFieldsOf,
} from '../../src/kernel/canonicalisation/intent.js';
import { intentHash } from '../../src/kernel/canonicalisation/lineage.js';
import { money } from '../../src/kernel/exposure/money.js';
import type { Exposure } from '../../src/kernel/canonicalisation/types.js';

const intent = parseProposedIntent({
  action_class: 'refund.create',
  resource_ref: 'order:ORD-123',
  selector: { enumeration_id: 'enum:1', option_id: 'abc' },
  reason_code: 'ITEM_RETURNED',
  rationale: 'ordinary prose',
});

// The four permitted fields cross the boundary. This is what I21 allows.
const permitted = permittedFieldsOf(intent);
export const actionClass: string = permitted.actionClass;
export const resourceRef: string = permitted.resourceRef;
export const reasonCode: string = permitted.reasonCode;
export const optionId: string = permitted.selector.optionId;

// rationale's one legal use: the opaque lineage commitment.
export const lineage: string = intentHash(intent);

// And its one observable property.
export const rationaleBytes: number = intent.rationale.byteLength;

// A kernel-computed exposure field, minted through the only mint.
export const exposure: Pick<Exposure, 'vendorAmount' | 'totalExposure'> = {
  vendorAmount: computed(money('25.00')),
  totalExposure: computed(money('26.03')),
};
