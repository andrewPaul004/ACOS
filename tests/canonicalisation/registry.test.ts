import { describe, expect, it } from 'vitest';

import { ACTION_CLASSES } from '../../src/kernel/canonicalisation/actionCatalogue.js';
import { CanonicalisationDenied } from '../../src/kernel/canonicalisation/errors.js';
import { parseProposedIntent } from '../../src/kernel/canonicalisation/intent.js';
import { ConstructorRegistry } from '../../src/kernel/canonicalisation/registry.js';
import { refundCreateConstructor } from '../../src/kernel/canonicalisation/constructors/refundCreate.js';
import {
  makeCanonicaliser,
  makeContext,
  makeRawIntent,
  makeRefundOption,
} from '../support/canonicalisationFixture.js';

/**
 * Step C2 — the constructor registry, and the class that has no constructor.
 *
 * `26 §7`, verbatim:
 *
 *   "Registered canonical constructor for this class?" -> no ->
 *   "DENY: NOT_CANONICALISABLE — class not autonomy-eligible"
 *
 * `36 §2`, verbatim:
 *
 *   "Selector rejection (v1.1, superseded in detail by VC-C2/VC-C3): an action class with
 *    no registered constructor must produce DENY: NOT_CANONICALISABLE."
 *
 * `26 §11.2`'s exclusion table, verbatim: "Any class with no registered constructor |
 * DENY: NOT_CANONICALISABLE at step C2".
 */

const option = makeRefundOption();

function denialOf(fn: () => unknown): CanonicalisationDenied {
  try {
    fn();
  } catch (error) {
    if (error instanceof CanonicalisationDenied) return error;
    throw error;
  }
  throw new Error('expected a denial');
}

describe('S1B registers exactly one constructor', () => {
  it('refund.create, and nothing else', () => {
    const registry = new ConstructorRegistry([refundCreateConstructor]);
    expect(registry.registeredClasses()).toEqual(['refund.create']);
  });

  it('the catalogue is larger than the registry, which is the point', () => {
    // `37 §2` S1: one REVERSIBLE, one COMPENSABLE, one IRRECOVERABLE, plus one rate-based.
    expect([...ACTION_CLASSES].sort()).toEqual([
      'campaign.budget.set',
      'campaign.pause',
      'fulfilment.reship',
      'refund.create',
    ]);
  });
});

describe('a catalogued class with no constructor denies NOT_CANONICALISABLE', () => {
  const { canonicaliser } = makeCanonicaliser();

  for (const actionClass of ['campaign.pause', 'fulfilment.reship', 'campaign.budget.set']) {
    it(actionClass, () => {
      const intent = parseProposedIntent(makeRawIntent(option, { actionClass }));
      const denial = denialOf(() => canonicaliser.canonicalise(intent, makeContext(), option));
      expect(denial.code).toBe('NOT_CANONICALISABLE');
      expect(denial.detail).toBe('NO_REGISTERED_CONSTRUCTOR');
    });
  }

  it('and NOT_CANONICALISABLE is distinct from UNKNOWN_ACTION', () => {
    // `26 §7` puts C (catalogue) before C2 (constructor). A class outside the catalogue
    // never reaches the registry at all, so the two conditions cannot be confused.
    const outside = denialOf(() => parseProposedIntent(makeRawIntent(option, { actionClass: 'payee.create' })));
    expect(outside.code).toBe('UNKNOWN_ACTION');
  });
});

describe('there is no fallback and no silent substitution', () => {
  it('an empty registry denies rather than degrading to a generic constructor', () => {
    const { canonicaliser } = makeCanonicaliser({ registerRefund: false });
    const denial = denialOf(() =>
      canonicaliser.canonicalise(parseProposedIntent(makeRawIntent(option)), makeContext(), option),
    );
    expect(denial.code).toBe('NOT_CANONICALISABLE');
  });

  it('two constructors for one class is a build failure, not a last-writer-wins', () => {
    expect(() => new ConstructorRegistry([refundCreateConstructor, refundCreateConstructor])).toThrow(
      /duplicate constructor/,
    );
  });
});
