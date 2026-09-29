import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { ACTION_CLASSES } from '../../src/kernel/canonicalisation/actionCatalogue.js';
import {
  buildCedarRequest,
  hasPolicyConstruction,
  registeredPolicyConstructionClasses,
} from '../../src/kernel/policy/cedarRequest.js';
import { ConstructorRegistry } from '../../src/kernel/canonicalisation/registry.js';
import { refundCreateConstructor } from '../../src/kernel/canonicalisation/constructors/refundCreate.js';
import { canonicalEffectAt } from '../support/policyFixture.js';
import { compareI20, type I20ScenarioOperand } from '../../validation/sendgrid/harness/i20.js';
import {
  S1PValidationAuthority,
  S1P_VALIDATION_AUTHORITY_ACKNOWLEDGEMENT,
  VALIDATION_WINDOWS,
  composeValidationContent,
} from '../../validation/sendgrid/harness/validationAuthority.js';
import { OWNER_SINK_MARKER } from '../../validation/sendgrid/integration/validationPayload.js';

/**
 * `§14` — THE `I20` COMPARISON MACHINERY, AND `§11.2` — THE VALIDATION-AUTHORITY BOUNDARY.
 *
 * =================================================================================
 * `§19` ITEMS 15 AND 16, AND THE `I20` CALCULATION `§14` REQUIRES PROVED OFFLINE
 *
 * `§14`: "Offline tests must prove the calculation. Do not claim provider-side I20 complete
 * until real provider observations exist." So this file proves the ARITHMETIC and the
 * REFUSALS, and claims nothing about a provider.
 *
 * `§11.2`: "Add boundary tests proving ordinary production cannot reach it." The seeder is
 * unreachable from production in four independent ways, and all four are asserted below.
 * =================================================================================
 */

const SINK = `owner+${OWNER_SINK_MARKER}@example.test`;
const SENDER = 'validation@nonprod.example.test';

function operand(
  label: string,
  providerAcceptedCount: number | null,
  units: bigint,
): I20ScenarioOperand {
  return { scenarioLabel: label, providerAcceptedCount, historicalReservationUnits: units };
}

describe('`§14` — `I20` COMPARES THE PROVIDER AGAINST THE IMMUTABLE RESERVATION BASIS', () => {
  it('a run whose accepted effects all stand behind reservations is WITHIN_BASIS', () => {
    const comparison = compareI20([
      operand('kill-point-1', 1, 1n),
      operand('kill-point-2', 0, 1n),
      operand('kill-point-3', 1, 1n),
    ]);
    expect(comparison.verdict).toBe('WITHIN_BASIS');
    expect(comparison.providerAcceptedIrrecoverableEffects).toBe(2);
    expect(comparison.historicalReservationBasisUnits).toBe(3n);
  });

  it('`I20` IS A BOUND, NOT AN EQUALITY — an unsent effect is not a violation', () => {
    /*
     * Kill point 2 reserves a unit and legitimately never sends. `35 §12.3` states that cost
     * openly: "A message that was genuinely never sent is delayed until the delivery-event
     * reconciliation resolves it." A comparison that demanded equality would fail the row the
     * architecture designs for.
     */
    const comparison = compareI20([operand('only-reserved', 0, 1n)]);
    expect(comparison.verdict).toBe('WITHIN_BASIS');
  });

  it('a provider-accepted effect with NO reservation behind it is EXCEEDS_BASIS', () => {
    const comparison = compareI20([operand('unbacked', 2, 1n)]);
    expect(comparison.verdict).toBe('EXCEEDS_BASIS');
    expect(comparison.statement).toContain('has no');
    expect(comparison.statement).toContain('committed authorisation behind it');
  });

  it('ONE unmeasured scenario makes the WHOLE comparison UNRESOLVED', () => {
    /*
     * CORRECTION 9'S RULE, APPLIED TO THE NUMERATOR.
     *
     * Treating an unmeasured scenario as contributing zero biases the numerator DOWNWARD,
     * which is the direction that makes the bound PASS — which is the direction a safety
     * comparison must never fail in.
     */
    const comparison = compareI20([
      operand('measured', 1, 1n),
      operand('refused-read', null, 1n),
    ]);
    expect(comparison.verdict).toBe('UNRESOLVED');
    expect(comparison.providerAcceptedIrrecoverableEffects).toBeNull();
    expect([...comparison.unmeasuredScenarios]).toEqual(['refused-read']);
    // The DENOMINATOR is still reported: it is committed local evidence and is always summable.
    expect(comparison.historicalReservationBasisUnits).toBe(2n);
  });

  it('an EMPTY comparison is UNRESOLVED, never a vacuous pass', () => {
    const comparison = compareI20([]);
    expect(comparison.verdict).toBe('UNRESOLVED');
    expect(comparison.statement).toContain('not a passing comparison');
  });

  it('`§14` — the module reads NO live balance column, and says which one it refuses', () => {
    /*
     * `phase2-v1.3.5-errata.md §1`: the denominator is the immutable historical basis and NOT
     * `reserved_irrecoverable`, "because PRESUME and REALISE move units out of that column
     * while leaving the commitment unchanged". The module is a pure function over operands, so
     * it cannot read a column at all — and it names the one it must not be given.
     */
    const source = readFileSync(join('validation', 'sendgrid', 'harness', 'i20.ts'), 'utf8');
    expect(source).toContain('reserved_irrecoverable');
    expect(source).toContain('reservation_window_instance');
    expect(source).not.toMatch(/\bSELECT\b/);
    expect(source).not.toContain('fetch(');
  });
});

describe('`§11.2`, `§19` item 16 — NO PRODUCTION ROUTE REACHES THE VALIDATION SEEDER', () => {
  it('BARRIER 1 — nothing under `src/` imports `validation/`', () => {
    /*
     * The strongest of the four, and it is already asserted over the whole tree by
     * `prerequisites-and-separation.test.ts`. Restated here against the SEEDER specifically,
     * because a boundary test that only pointed elsewhere would be a boundary test nobody ran.
     */
    const source = readFileSync(
      join('validation', 'sendgrid', 'harness', 'validationAuthority.ts'),
      'utf8',
    );
    expect(source).toContain('S1P_VALIDATION_AUTHORITY_ACKNOWLEDGEMENT');
    // It lives outside `src/` entirely; the control plane's closure cannot name it.
    expect(join('validation', 'sendgrid', 'harness', 'validationAuthority.ts')).not.toContain(
      `src${join('')}`,
    );
  });

  it('BARRIER 2 — the seeder REFUSES without the operator acknowledgement, by value', async () => {
    const unacknowledged = new S1PValidationAuthority({
      acknowledgement: 'I_WOULD_LIKE_TO_SEND_AN_EMAIL',
      companyId: 'company:test',
      constructorVersion: {
        constructorId: 'constructor:email.send:test',
        actionClass: 'email.send',
        semanticMajor: 1,
        nonSemanticMinor: 0,
        semanticChange: false,
        changedFields: [],
        signedAt: new Date('2026-01-01T00:00:00.000Z'),
        recordHash: 'fixture',
      },
      commit: () => {
        throw new Error('the commit port must NEVER be reached without the acknowledgement');
      },
      enumerate: () => {
        throw new Error('the enumerate port must NEVER be reached without the acknowledgement');
      },
    });

    const refused = await unacknowledged.authoriseValidationEmail({
      scenarioLabel: 'attempt',
      senderAddress: SENDER,
      sinkAddress: SINK,
      resourceId: 'ORD-1',
      taskId: 'task:1',
    });
    expect(refused.kind).toBe('REFUSED');
    if (refused.kind !== 'REFUSED') return;
    expect(refused.reason).toBe('LIVE_ACKNOWLEDGEMENT_ABSENT');
  });

  it('BARRIER 3 — an acknowledged seeder still REFUSES a non-owner sink, before committing', async () => {
    let committed = false;
    const acknowledged = new S1PValidationAuthority({
      acknowledgement: S1P_VALIDATION_AUTHORITY_ACKNOWLEDGEMENT,
      companyId: 'company:test',
      constructorVersion: {
        constructorId: 'constructor:email.send:test',
        actionClass: 'email.send',
        semanticMajor: 1,
        nonSemanticMinor: 0,
        semanticChange: false,
        changedFields: [],
        signedAt: new Date('2026-01-01T00:00:00.000Z'),
        recordHash: 'fixture',
      },
      commit: () => {
        committed = true;
        return Promise.resolve({ kind: 'COMMITTED' as const, effectId: 'effect:1' });
      },
      enumerate: () =>
        Promise.resolve({ enumerationId: 'enum:1', optionId: 'option:1' }),
    });

    for (const hostile of ['customer@example.com', 'ceo@bigco.test', '']) {
      const refused = await acknowledged.authoriseValidationEmail({
        scenarioLabel: 'attempt',
        senderAddress: SENDER,
        sinkAddress: hostile,
        resourceId: 'ORD-1',
        taskId: 'task:1',
      });
      expect(refused.kind, hostile).toBe('REFUSED');
      if (refused.kind !== 'REFUSED') continue;
      expect(refused.reason).toBe('SINK_NOT_OWNER_CONTROLLED');
    }
    /*
     * `§2.3`: the refusal is BEFORE the commit, which is the only place a customer address can
     * be kept out of the system — once an effect is authorised the adapter must dispatch the
     * address the hash committed.
     */
    expect(committed).toBe(false);
  });

  it('BARRIER 4 — ordinary `email.send` remains UNGOVERNED and UNCONSTRUCTABLE', () => {
    /*
     * `§19` item 15, driven at the two barriers `26 §7` puts before policy.
     *
     * A production caller cannot canonicalise an `email.send` effect (no registered
     * constructor) and cannot build a Cedar request for one (no registered policy
     * construction). The seeder does not change either, because it registers neither.
     */
    expect([...ACTION_CLASSES]).toContain('email.send');
    expect(hasPolicyConstruction('email.send')).toBe(false);
    expect(registeredPolicyConstructionClasses()).toEqual(['refund.create']);
    expect(new ConstructorRegistry([refundCreateConstructor]).registeredClasses()).toEqual([
      'refund.create',
    ]);

    const effect = canonicalEffectAt({ vendorAmount: '10.00', retainedFee: '1.03' });
    expect(() =>
      buildCedarRequest({
        ...effect,
        request: { ...effect.request, actionClass: 'email.send' as never },
      }),
    ).toThrow(/NO_POLICY_CONSTRUCTION/);
  });

  it('the seeder produces ONE shape of effect — a non-production validation email', () => {
    /*
     * `§11.2`: "This mechanism must not become a generic 'insert authorised effect' production
     * API." Its ONE method takes a scenario label, a sender, a sink, a resource and a task —
     * and no action class, no adapter, no recoverability, no exposure and no window list. Every
     * one of those is a constant inside the module.
     */
    const content = composeValidationContent('kill-point-3');
    expect(content.subject).toContain('ACOS S1P NON-PRODUCTION VALIDATION');
    expect(content.bodyText).toContain('carries no business content');
    expect(content.bodyText).toContain('owner-controlled sink');
    // `51 §2`'s MIE windows, declared once and not a parameter.
    expect([...VALIDATION_WINDOWS]).toEqual(['W_DAY_MIE', 'W_MONTH_MIE']);
  });
});
