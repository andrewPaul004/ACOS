import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { toDb } from '../../src/kernel/exposure/money.js';
import { PolicyEngine } from '../../src/kernel/policy/policyEngine.js';
import { loadPolicyArtifacts } from '../../src/kernel/policy/policyArtifacts.js';
import { buildRefundCreateCedarRequest } from '../../src/kernel/policy/cedarRequest.js';
import {
  VC_C1_RETAINED_FEE,
  VC_C1_VENDOR_AMOUNT,
  canonicalEffectAt,
} from '../support/policyFixture.js';
import { evaluateUnsafely, unsafeVendorAmountRequest } from './unsafe-vendor-amount-policy.js';

/**
 * THE ECONOMIC-BINDING NEGATIVE CONTROL, RUN.
 *
 * `36 §0` and `46 R1`: a suite that cannot distinguish the defect it is about certifies
 * nothing. The S1D mandate states the requirement directly: "the unsafe control must
 * demonstrate the wrong behavior — e.g. permit or otherwise fail to return the required
 * `PER_ACTION` denial — while production Cedar denies."
 *
 * Both sides run the same real Cedar engine over the same loaded policy artifacts. The only
 * variable is the field bound into `context.exposure.total_exposure`.
 */

const artifacts = loadPolicyArtifacts();
const engine = new PolicyEngine(artifacts);

describe('VC-C1 — production denies where the vulnerable binding permits', () => {
  const effect = canonicalEffectAt({
    vendorAmount: VC_C1_VENDOR_AMOUNT,
    retainedFee: VC_C1_RETAINED_FEE,
  });

  it('the fixture carries both figures, and they straddle the cap', () => {
    expect(toDb(effect.request.exposure.vendorAmount!)).toBe('25.00'); // inside the cap
    expect(toDb(effect.request.exposure.totalExposure)).toBe('26.03'); // outside the cap
  });

  it('PRODUCTION denies PER_ACTION', () => {
    const decision = engine.evaluate(effect);
    expect(decision.decision === 'DENY' && decision.code).toBe('PER_ACTION');
  });

  it('THE UNSAFE CONTROL PERMITS — the defect is observed, not asserted', () => {
    const unsafe = evaluateUnsafely(artifacts, effect);
    expect(unsafe.decision).toBe('PERMIT');
    expect(unsafe.code).toBeNull();
  });

  it('so the suite can tell the two implementations apart on this exact fixture', () => {
    expect(engine.evaluate(effect).decision).not.toBe(evaluateUnsafely(artifacts, effect).decision);
  });
});

describe('the control differs in exactly one field, and agrees everywhere else', () => {
  /**
   * A control that differed in several places could be failing for a reason other than the
   * one it names. These assertions pin the difference to one expression.
   */
  const effect = canonicalEffectAt({ vendorAmount: '25.00', retainedFee: '1.03' });
  const safe = buildRefundCreateCedarRequest(effect);
  const unsafe = unsafeVendorAmountRequest(effect);

  it('principal, action, resource and entities are identical', () => {
    expect(unsafe.principal).toEqual(safe.principal);
    expect(unsafe.action).toEqual(safe.action);
    expect(unsafe.resource).toEqual(safe.resource);
    expect(unsafe.entities).toEqual(safe.entities);
  });

  it('every context field except the cap operand is identical', () => {
    const strip = (context: Record<string, unknown>): Record<string, unknown> => {
      const { exposure: _exposure, ...rest } = context;
      return rest;
    };
    expect(strip(unsafe.context)).toEqual(strip(safe.context));
  });

  it('and the cap operand differs by exactly the retained fee', () => {
    expect(JSON.stringify(safe.context['exposure'])).toContain('26.03');
    expect(JSON.stringify(unsafe.context['exposure'])).toContain('25.00');
  });
});

describe('the control is discriminating across the whole boundary, not just at VC-C1', () => {
  it('agrees with production below the cap, where the fee does not change the side', () => {
    // $10.00 + $1.03 = $11.03. Both figures are inside the cap, so a correct and an
    // incorrect binding must AGREE — a control that disagreed everywhere would be testing
    // that two different programs are different, not that one is wrong.
    const effect = canonicalEffectAt({ vendorAmount: '10.00', retainedFee: '1.03' });
    expect(engine.evaluate(effect).decision).toBe('PERMIT');
    expect(evaluateUnsafely(artifacts, effect).decision).toBe('PERMIT');
  });

  it('agrees far above the cap, where both figures are outside it', () => {
    // $40.00 + $1.03 = $41.03. Both outside, so both deny PER_ACTION.
    const effect = canonicalEffectAt({ vendorAmount: '40.00', retainedFee: '1.03' });
    const production = engine.evaluate(effect);
    expect(production.decision === 'DENY' && production.code).toBe('PER_ACTION');
    expect(evaluateUnsafely(artifacts, effect)).toEqual({ decision: 'DENY', code: 'PER_ACTION' });
  });

  it('DISAGREES exactly in the band the retained fee opens — $23.98 through $25.00 vendor', () => {
    // The band where `vendor_amount <= 25.00 < vendor_amount + 1.03`. Every effect in it is
    // one the vulnerable binding would have dispatched and the correct binding refuses. This
    // is the money `26 §2.1.1` says the v1.0 cap was leaking.
    const band = ['23.98', '24.00', '24.50', '24.99', '25.00'];
    for (const vendorAmount of band) {
      const effect = canonicalEffectAt({ vendorAmount, retainedFee: '1.03' });
      const production = engine.evaluate(effect);
      expect(production.decision, `production at vendor ${vendorAmount}`).toBe('DENY');
      expect(production.decision === 'DENY' && production.code).toBe('PER_ACTION');
      expect(
        evaluateUnsafely(artifacts, effect).decision,
        `unsafe control at vendor ${vendorAmount}`,
      ).toBe('PERMIT');
    }
    // And the value just below the band, where they agree again.
    const below = canonicalEffectAt({ vendorAmount: '23.97', retainedFee: '1.03' });
    expect(engine.evaluate(below).decision).toBe('PERMIT');
    expect(evaluateUnsafely(artifacts, below).decision).toBe('PERMIT');
  });
});

describe('the unsafe implementation is quarantined in tests/', () => {
  it('nothing under src/ imports it', () => {
    const offenders = sourceFiles(join('src')).filter((file) =>
      readFileSync(file, 'utf8').includes('unsafe-vendor-amount-policy'),
    );
    expect(offenders, offenders.join(', ')).toEqual([]);
  });

  it('and `src/kernel/policy/` never reads `vendorAmount` at all', () => {
    // The structural form of the property. `acos.cedarschema` declares no attribute the
    // vendor amount could be written into, and the production tree never reads the field —
    // so the defect cannot be reintroduced by an edit that merely renames a variable.
    const scanned = sourceFiles(join('src', 'kernel', 'policy'));
    expect(scanned.length).toBeGreaterThan(0);
    for (const file of scanned) {
      const code = readFileSync(file, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
      expect(code, `${file} reads vendorAmount`).not.toContain('vendorAmount');
      expect(code, `${file} names vendor_amount`).not.toContain('vendor_amount');
    }
  });
});

/** Every `.ts` file under `dir`, recursively. */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? sourceFiles(join(dir, entry.name))
      : entry.name.endsWith('.ts')
        ? [join(dir, entry.name)]
        : [],
  );
}
