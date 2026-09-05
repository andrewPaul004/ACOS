/**
 * NEGATIVE — the model-facing intent is not an authoritative context.
 *
 * The S1B contract §2.2: the three constructor inputs are deliberately NOT merged into one
 * convenience object. Merged, `I21` reverts to a code-review property, because nothing in
 * the type system would distinguish "the model chose this" from "the kernel resolved this".
 */

import { EffectCanonicaliser } from '../../src/kernel/canonicalisation/canonicaliser.js';
import { ConstructorRegistry } from '../../src/kernel/canonicalisation/registry.js';
import { ConstructorVersionResolver } from '../../src/kernel/canonicalisation/constructorVersion.js';
import { parseProposedIntent } from '../../src/kernel/canonicalisation/intent.js';
import { createPublicKey } from 'node:crypto';

declare const key: ReturnType<typeof createPublicKey>;

const intent = parseProposedIntent({
  action_class: 'refund.create',
  resource_ref: 'order:ORD-123',
  selector: { enumeration_id: 'enum:1', option_id: 'abc' },
  reason_code: 'ITEM_RETURNED',
  rationale: 'the model said so',
});

const canonicaliser = new EffectCanonicaliser({
  registry: new ConstructorRegistry([]),
  versions: new ConstructorVersionResolver(key, []),
});

// EXPECT_ERROR: a ProposedIntent is not an AuthoritativeCanonicalisationContext, and is
// not a SelectedAuthoritativeOption either.
export const result = canonicaliser.canonicalise(intent, intent, intent); // EXPECT_ERROR TS2345
