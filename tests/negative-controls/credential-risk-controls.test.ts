import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  createAdapterRuntimeRegistry,
  declaredCredentialRiskClass,
  type AdapterRuntimeDescriptor,
} from '../../src/integration/control/adapterRuntimeRegistry.js';
import { verifiedCredentialScopes } from '../../src/kernel/controlArtifacts/bundle.js';
import { activeVerifiedControlArtifacts } from '../../src/kernel/controlArtifacts/registry.js';
import {
  UNSAFE_RISK_OVERRIDE_ENV_KEY,
  unsafeActionDerivedCredentialClass,
  unsafeCredentialBlindRuntimeRegistry,
  unsafeEnvironmentChosenRiskClass,
  unsafeIntendedPermissionRiskClass,
  unsafeMissingRiskDefaultsSafe,
} from './unsafe-credential-risk.js';
import {
  ADAPTER_A,
  ADAPTER_A_ROOT,
  ADAPTER_MONEY_MOVING,
  CREDENTIAL_A_MONEY_MOVING,
  CREDENTIAL_A_NON_MONETARY,
  CREDENTIAL_MIXED_ENVELOPE,
  CREDENTIAL_PROCESSOR_MONEY_MOVING,
} from '../support/integrationFixture.js';

/**
 * `§29` ITEMS 1–4 — THE CREDENTIAL-RISK VULNERABLE CONTROLS.
 *
 * "Each must discriminate." Every case below runs the UNSAFE implementation and the
 * PRODUCTION one on the SAME input and asserts they give different answers. A control that
 * cannot do that proves nothing.
 */

const bundle = (): ReturnType<typeof activeVerifiedControlArtifacts> =>
  activeVerifiedControlArtifacts();

function descriptor(
  adapterId: string,
  credentialId: string,
): AdapterRuntimeDescriptor {
  return {
    adapterId,
    credentialId,
    runtimeRoot: ADAPTER_A_ROOT,
    adapterModule: join(ADAPTER_A_ROOT, 'adapter.ts'),
    secretSourceModule: join(ADAPTER_A_ROOT, 'secretSource.ts'),
    secretLocator: '/tmp/unused.json',
    resolutionCapabilities: ['QUERYABLE_MESSAGE_LOG'],
  };
}

/* ================================================================================
 * CONTROL 1 — ACTION-BASED INSTEAD OF CREDENTIAL-BASED
 * ============================================================================== */

describe('CONTROL 1 — money-moving derived from the ACTION, not the CREDENTIAL', () => {
  it('UNSAFE answers NON_MONETARY for a credential that can raise a campaign budget', () => {
    const b = bundle();

    /*
     * THE DISCRIMINATION, ON THE DEPLOYED ARTIFACT SET.
     *
     * `campaign.budget.set` declares `carries_vendor_monetary_field: false`, so S1N's
     * action-derived predicate answers `NON_MONETARY` for EVERY `mock_ads` credential.
     * v1.3.7 asks what the CREDENTIAL reaches at the provider, and
     * `mock_ads.budget_manage` reaches the budget raise — `50 §2g` clause 9.
     */
    expect(unsafeActionDerivedCredentialClass(ADAPTER_A, b)).toBe('NON_MONETARY');
    expect(declaredCredentialRiskClass(CREDENTIAL_A_MONEY_MOVING, b)).toBe('MONEY_MOVING');

    // UNSAFE: the adapter is admitted under option A.
    expect(
      unsafeCredentialBlindRuntimeRegistry([
        descriptor(ADAPTER_A, CREDENTIAL_A_MONEY_MOVING),
      ]).registeredIds,
    ).toEqual([ADAPTER_A]);

    // PRODUCTION: refused, on one adapter, because the CREDENTIAL moves money.
    expect(() =>
      createAdapterRuntimeRegistry([descriptor(ADAPTER_A, CREDENTIAL_A_MONEY_MOVING)], b),
    ).toThrow(/OPTION_B_TRIGGER_MONEY_MOVING_CREDENTIAL/);
  });

  it('and the two agree where the ACTION happens to be monetary — so the test is not tautological', () => {
    const b = bundle();
    // `refund.create` DOES declare `carries_vendor_monetary_field`, so the unsafe predicate
    // gets this one right. The defect is not that it is always wrong; it is that it cannot
    // see the case the architecture cares about.
    expect(unsafeActionDerivedCredentialClass(ADAPTER_MONEY_MOVING, b)).toBe('MONEY_MOVING');
    expect(declaredCredentialRiskClass(CREDENTIAL_PROCESSOR_MONEY_MOVING, b)).toBe(
      'MONEY_MOVING',
    );
  });
});

/* ================================================================================
 * CONTROL 2 — A MIXED-SCOPE CREDENTIAL MISCLASSIFIED NON-MONEY
 * ============================================================================== */

describe('CONTROL 2 — §8’s required attack: email.send beside payment.refund', () => {
  it('UNSAFE classifies on the INTENDED permission; PRODUCTION on the envelope', () => {
    const b = bundle();
    const scope = verifiedCredentialScopes(b).credentials[CREDENTIAL_MIXED_ENVELOPE]!;

    // The attack input, exactly as `§8` states it.
    expect(scope.grantedProviderPermissions).toContain('mail.send');
    expect(scope.grantedProviderPermissions).toContain('payment.refund');

    // UNSAFE: ACOS intends only the send, so the refund scope is invisible.
    expect(unsafeIntendedPermissionRiskClass(CREDENTIAL_MIXED_ENVELOPE, 'mail.send', b)).toBe(
      'NON_MONETARY_WRITE',
    );

    // PRODUCTION: maximum privilege over the whole envelope.
    expect(declaredCredentialRiskClass(CREDENTIAL_MIXED_ENVELOPE, b)).toBe('MONEY_MOVING');

    // AND THE CONSEQUENCE DIFFERS, not just the label.
    expect(
      unsafeCredentialBlindRuntimeRegistry([
        descriptor(ADAPTER_A, CREDENTIAL_MIXED_ENVELOPE),
      ]).registeredIds,
    ).toEqual([ADAPTER_A]);
    expect(() =>
      createAdapterRuntimeRegistry([descriptor(ADAPTER_A, CREDENTIAL_MIXED_ENVELOPE)], b),
    ).toThrow(/OPTION_B_TRIGGER_MONEY_MOVING_CREDENTIAL/);
  });
});

/* ================================================================================
 * CONTROL 3 — A MISSING CLASSIFICATION DEFAULTING SAFE
 * ============================================================================== */

describe('CONTROL 3 — a missing credential risk defaults safe', () => {
  it('UNSAFE returns NON_MONETARY_WRITE; PRODUCTION FAILS CLOSED', () => {
    const b = bundle();
    const undeclared = 'nobody.declared.this.credential';

    // UNSAFE: absent means safe, and the deployment starts.
    expect(unsafeMissingRiskDefaultsSafe(undeclared, b)).toBe('NON_MONETARY_WRITE');
    expect(
      unsafeCredentialBlindRuntimeRegistry([descriptor(ADAPTER_A, undeclared)]).registeredIds,
    ).toEqual([ADAPTER_A]);

    // PRODUCTION: `50 §2g` — absent FAILS CLOSED, and the answer is `null`, not a default.
    expect(declaredCredentialRiskClass(undeclared, b)).toBeNull();
    expect(() => createAdapterRuntimeRegistry([descriptor(ADAPTER_A, undeclared)], b)).toThrow(
      /CREDENTIAL_NOT_DECLARED/,
    );
  });
});

/* ================================================================================
 * CONTROL 4 — UNSIGNED RUNTIME CONFIG CHOOSES THE RISK CLASS
 * ============================================================================== */

describe('CONTROL 4 — the risk class chosen by unsigned runtime configuration', () => {
  it('UNSAFE lets an environment variable outrank the signed artifact', () => {
    const b = bundle();
    const environment = { [UNSAFE_RISK_OVERRIDE_ENV_KEY]: 'NON_MONETARY_WRITE' };

    // UNSAFE: whoever can set a variable decides whether option B is required.
    expect(
      unsafeEnvironmentChosenRiskClass(CREDENTIAL_PROCESSOR_MONEY_MOVING, b, environment),
    ).toBe('NON_MONETARY_WRITE');

    // PRODUCTION: the signed artifact, and there is no parameter an override could arrive on.
    expect(declaredCredentialRiskClass(CREDENTIAL_PROCESSOR_MONEY_MOVING, b)).toBe(
      'MONEY_MOVING',
    );
    expect(declaredCredentialRiskClass.length).toBe(2); // credentialId, bundle. No third.
    expect(() =>
      createAdapterRuntimeRegistry(
        [descriptor(ADAPTER_MONEY_MOVING, CREDENTIAL_PROCESSOR_MONEY_MOVING)],
        b,
      ),
    ).toThrow(/OPTION_B_TRIGGER_MONEY_MOVING_CREDENTIAL/);
  });

  it('and with the variable ABSENT the unsafe reading agrees — the defect is the override', () => {
    const b = bundle();
    expect(unsafeEnvironmentChosenRiskClass(CREDENTIAL_PROCESSOR_MONEY_MOVING, b, {})).toBe(
      'MONEY_MOVING',
    );
  });

  it('`AdapterRuntimeDescriptor` carries no member a risk class could occupy', () => {
    const d = descriptor(ADAPTER_A, CREDENTIAL_A_NON_MONETARY);
    expect(Object.keys(d).sort()).toEqual([
      'adapterId',
      'adapterModule',
      'credentialId',
      'resolutionCapabilities',
      'runtimeRoot',
      'secretLocator',
      'secretSourceModule',
    ]);
    // S1N's `declaredCredentialClass` is GONE, and so is the refusal that cross-checked it.
    expect(d).not.toHaveProperty('declaredCredentialClass');
  });
});
