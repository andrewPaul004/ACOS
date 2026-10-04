import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  AUDIT_PLANE_CREDENTIAL_SCOPE,
  CREDENTIAL_RISK_CLASSES,
  MONEY_MOVING_CLAUSES,
  credentialDeclarationInconsistency,
  highestRiskOf,
  isCredentialRiskClass,
} from '../../src/kernel/controlArtifacts/credentialRisk.js';
import { parseClass5CredentialScopes } from '../../src/kernel/controlArtifacts/artifactParsers.js';
import { ControlArtifactIntegrityFailure } from '../../src/kernel/controlArtifacts/errors.js';
import {
  verifiedCredentialScopes,
} from '../../src/kernel/controlArtifacts/bundle.js';
import { activeVerifiedControlArtifacts } from '../../src/kernel/controlArtifacts/registry.js';
import { REQUIRED_PRE_LIVE_ARTIFACTS } from '../../src/kernel/controlArtifacts/requiredSet.js';

/**
 * `50 §2g` — THE CLOSED CREDENTIAL RISK CLASS, ITS PARSER, AND ITS SIGNED OWNERSHIP.
 *
 * v1.3.7's whole normative content, asserted against the real verified bundle rather than
 * against a description of it.
 */

const REPO_ARTIFACT_ROOT = join(process.cwd(), 'artifacts', 'control');

function bytes(document: unknown): Uint8Array {
  return Buffer.from(`${JSON.stringify(document, null, 2)}\n`, 'utf8');
}

/** A self-consistent record, as a base the negative cases edit one field of. */
function record(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    credential_id: 'p.cred',
    adapter: 'mock_ads',
    provider: 'p',
    granted_provider_permissions: ['campaign.pause'],
    monetary_provider_permissions: [],
    credential_risk_class: 'NON_MONETARY_WRITE',
    external_mutation_capable: true,
    ...overrides,
  };
}

function artifact(...records: readonly Record<string, unknown>[]): Uint8Array {
  return bytes({
    artifact_id: 'acos.control.credential_scopes',
    artifact_version: 'acos.credential_scopes.2026-09-26',
    credentials: records,
  });
}


/**
 * The DETAIL of a control-artifact integrity failure.
 *
 * `errors.ts` deliberately coarsens the worker-facing `message` and keeps the specifics on
 * `reasonCode` and `detail`, because a near miss here is cryptographic material. **A test is
 * inside the trust boundary**, so it reads the structured fields; no worker-facing surface
 * may.
 */
function failureDetail(run: () => unknown): { code: string; detail: string } {
  try {
    run();
  } catch (error) {
    if (error instanceof ControlArtifactIntegrityFailure) {
      return { code: error.reasonCode, detail: error.detail };
    }
    throw error;
  }
  throw new Error('expected a ControlArtifactIntegrityFailure and none was raised');
}

/* ================================================================================
 * THE CLOSED SET
 * ============================================================================== */

describe('`50 §2g` — the set is CLOSED at exactly three values and no fourth', () => {
  it('three members, in the declared order, and nothing else is admitted', () => {
    expect([...CREDENTIAL_RISK_CLASSES]).toEqual([
      'READ_ONLY',
      'NON_MONETARY_WRITE',
      'MONEY_MOVING',
    ]);
    for (const value of CREDENTIAL_RISK_CLASSES) expect(isCredentialRiskClass(value)).toBe(true);
    // THE FOURTH VALUE IS THE PERMISSIVE DEFAULT ARRIVING UNDER ANOTHER NAME.
    for (const rejected of ['UNKNOWN', 'unknown', 'NONE', '', 'MONEY_MOVING ', null, 0, {}]) {
      expect(isCredentialRiskClass(rejected), String(rejected)).toBe(false);
    }
  });

  it('the nine money-moving clauses are transcribed, and none is a matcher', () => {
    expect(MONEY_MOVING_CLAUSES).toHaveLength(9);
    // `§2g` field 5 is an OWNER JUDGEMENT at signing time. A predicate over permission
    // STRINGS would be the name-inference defect one level down, so the clauses are prose
    // and nothing in the module matches on them.
    const source = readFileSync(
      join(process.cwd(), 'src', 'kernel', 'controlArtifacts', 'credentialRisk.ts'),
      'utf8',
    );
    expect(source).not.toMatch(/RegExp|\.test\(|\.match\(/);
  });

  it('the module does not import the ACTION catalogue — §2g forbids merging the two', () => {
    const source = readFileSync(
      join(process.cwd(), 'src', 'kernel', 'controlArtifacts', 'credentialRisk.ts'),
      'utf8',
    );
    // IMPORT LINES ONLY. The module's own prose explains why the import is absent, and a
    // scan over the whole file would be reporting the explanation rather than an import.
    expect(source).not.toMatch(/^\s*import\s/m);
    expect(source).not.toMatch(/^\s*\}\s*from\s+/m);
  });
});

/* ================================================================================
 * MAXIMUM PRIVILEGE
 * ============================================================================== */

describe('`50 §2g` — MAXIMUM PRIVILEGE decides a mixed envelope', () => {
  it('the highest reachable, never the lowest, the average or the intended', () => {
    expect(highestRiskOf(['READ_ONLY', 'MONEY_MOVING'])).toBe('MONEY_MOVING');
    expect(highestRiskOf(['NON_MONETARY_WRITE', 'MONEY_MOVING'])).toBe('MONEY_MOVING');
    expect(highestRiskOf(['READ_ONLY', 'NON_MONETARY_WRITE'])).toBe('NON_MONETARY_WRITE');
    expect(highestRiskOf(['READ_ONLY'])).toBe('READ_ONLY');
  });

  it('an EMPTY set has no highest member, and the answer is not READ_ONLY', () => {
    // "No credentials were considered" and "every credential is safe" are different facts,
    // and only one of them is evidence.
    expect(highestRiskOf([])).toBeNull();
  });
});

/* ================================================================================
 * SELF-CONSISTENCY — the four ways a record can lie about itself
 * ============================================================================== */

describe('`50 §2g` — a declaration that disagrees with itself is REFUSED', () => {
  it('a self-consistent record reports no inconsistency', () => {
    expect(
      credentialDeclarationInconsistency({
        grantedProviderPermissions: ['mail.send'],
        monetaryProviderPermissions: [],
        credentialRiskClass: 'NON_MONETARY_WRITE',
        externalMutationCapable: true,
      }),
    ).toBeNull();
    expect(
      credentialDeclarationInconsistency({
        grantedProviderPermissions: ['email_activity.read'],
        monetaryProviderPermissions: [],
        credentialRiskClass: 'READ_ONLY',
        externalMutationCapable: false,
      }),
    ).toBeNull();
  });

  it('THE UNDERSTATEMENT: field 5 non-empty while field 6 says non-monetary', () => {
    expect(
      credentialDeclarationInconsistency({
        grantedProviderPermissions: ['mail.send', 'payment.refund'],
        monetaryProviderPermissions: ['payment.refund'],
        credentialRiskClass: 'NON_MONETARY_WRITE',
        externalMutationCapable: true,
      }),
    ).toMatch(/MONEY_MOVING EXACTLY when field 5 is non-empty/);
  });

  it('the OVERSTATEMENT: MONEY_MOVING naming no monetary permission', () => {
    expect(
      credentialDeclarationInconsistency({
        grantedProviderPermissions: ['mail.send'],
        monetaryProviderPermissions: [],
        credentialRiskClass: 'MONEY_MOVING',
        externalMutationCapable: true,
      }),
    ).toMatch(/must name the permissions that make it one/);
  });

  it('field 5 must be a SUBSET of field 4', () => {
    expect(
      credentialDeclarationInconsistency({
        grantedProviderPermissions: ['mail.send'],
        monetaryProviderPermissions: ['payment.refund'],
        credentialRiskClass: 'MONEY_MOVING',
        externalMutationCapable: true,
      }),
    ).toMatch(/is a SUBSET of field 4/);
  });

  it('READ_ONLY requires field 7 false, and NON_MONETARY_WRITE requires it true', () => {
    expect(
      credentialDeclarationInconsistency({
        grantedProviderPermissions: ['email_activity.read'],
        monetaryProviderPermissions: [],
        credentialRiskClass: 'READ_ONLY',
        externalMutationCapable: true,
      }),
    ).toMatch(/READ_ONLY requires field 7 false/);
    expect(
      credentialDeclarationInconsistency({
        grantedProviderPermissions: ['mail.send'],
        monetaryProviderPermissions: [],
        credentialRiskClass: 'NON_MONETARY_WRITE',
        externalMutationCapable: false,
      }),
    ).toMatch(/requires field 7 true/);
  });

  it('a money-moving permission implies external mutation', () => {
    expect(
      credentialDeclarationInconsistency({
        grantedProviderPermissions: ['payment.refund'],
        monetaryProviderPermissions: ['payment.refund'],
        credentialRiskClass: 'MONEY_MOVING',
        externalMutationCapable: false,
      }),
    ).toMatch(/moves money mutates provider-side state/);
  });
});

/* ================================================================================
 * THE PARSER — the closed schema, and every refusal
 * ============================================================================== */

describe('`50 §2g` — the class-5 parser refuses rather than corrects', () => {
  it('parses the seven declared fields and freezes the result', () => {
    const parsed = parseClass5CredentialScopes(artifact(record()));
    expect(parsed.credentialIds).toEqual(['p.cred']);
    const scope = parsed.credentials['p.cred']!;
    expect(scope.credentialRiskClass).toBe('NON_MONETARY_WRITE');
    expect(Object.isFrozen(scope)).toBe(true);
    expect(Object.isFrozen(parsed)).toBe(true);
  });

  it('an UNKNOWN field is a refusal, not an ignored key', () => {
    const failure = failureDetail(() =>
      parseClass5CredentialScopes(artifact(record({ note: 'harmless' }))),
    );
    expect(failure.code).toBe('ARTIFACT_CONTENT_INVALID');
    expect(failure.detail).toMatch(/carries exactly its declared fields/);
  });

  it('a MISSING field is a refusal', () => {
    const incomplete = record();
    delete incomplete.credential_risk_class;
    expect(failureDetail(() => parseClass5CredentialScopes(artifact(incomplete))).detail).toMatch(
      /carries exactly its declared fields/,
    );
  });

  it('a risk class OUTSIDE the closed three is a refusal, and UNKNOWN is named', () => {
    expect(
      failureDetail(() =>
        parseClass5CredentialScopes(artifact(record({ credential_risk_class: 'UNKNOWN' }))),
      ).detail,
    ).toMatch(/closes the set at .* and admits no fourth value/);
  });

  it('an EMPTY granted-permission list is a refusal — there is no envelope to classify', () => {
    expect(
      failureDetail(() =>
        parseClass5CredentialScopes(
          artifact(
            record({
              granted_provider_permissions: [],
              external_mutation_capable: false,
              credential_risk_class: 'READ_ONLY',
            }),
          ),
        ),
      ).detail,
    ).toMatch(/NON-EMPTY closed list/);
  });

  it('a SELF-INCONSISTENT record is a refusal, and the reason names which way it lied', () => {
    expect(
      failureDetail(() =>
        parseClass5CredentialScopes(
          artifact(
            record({
              granted_provider_permissions: ['mail.send', 'payment.refund'],
              monetary_provider_permissions: ['payment.refund'],
              credential_risk_class: 'NON_MONETARY_WRITE',
            }),
          ),
        ),
      ).detail,
    ).toMatch(/disagrees with itself.*MONEY_MOVING EXACTLY when field 5 is non-empty/s);
  });

  it('a DUPLICATE credential id is a refusal — one identity has one trigger answer', () => {
    expect(
      failureDetail(() => parseClass5CredentialScopes(artifact(record(), record()))).detail,
    ).toMatch(/not in strictly ascending credential_id order|two records for credential/);
  });

  it('unsorted permissions and unsorted records are refusals', () => {
    expect(
      failureDetail(() =>
        parseClass5CredentialScopes(
          artifact(record({ granted_provider_permissions: ['campaign.read', 'campaign.pause'] })),
        ),
      ).detail,
    ).toMatch(/strictly ascending order/);
    expect(
      failureDetail(() =>
        parseClass5CredentialScopes(
          artifact(record({ credential_id: 'z.cred' }), record({ credential_id: 'a.cred' })),
        ),
      ).detail,
    ).toMatch(/strictly ascending credential_id order/);
  });

  it('an EMPTY credential list parses — a deployment with no vendor credential is legal', () => {
    // The production posture: the registries are empty, so no credential is configured. An
    // artifact declaring none is not the same as an artifact that failed to declare one.
    const parsed = parseClass5CredentialScopes(artifact());
    expect(parsed.credentialIds).toEqual([]);
  });
});

/* ================================================================================
 * SIGNED OWNERSHIP — the class is class 5, and it is a manifest member
 * ============================================================================== */

describe('`50 §6`, `§2g` — the classification is SIGNED authority', () => {
  it('class 5 is a member of the pre-live required set', () => {
    const class5 = REQUIRED_PRE_LIVE_ARTIFACTS.find((a) => a.artifactClass === 5);
    expect(class5).toBeDefined();
    expect(class5!.artifactId).toBe('acos.control.credential_scopes');
    expect(class5!.boundary).toBe('50 §2g');
    // SEVEN members after v1.3.7 and EIGHT after v1.3.8 adds class 28 (`50 §2h`); the count is
    // asserted so a silent removal — or a silent addition — fails here.
    expect(REQUIRED_PRE_LIVE_ARTIFACTS).toHaveLength(8);
  });

  it('the deployed artifact is what the ACTIVE VERIFIED BUNDLE carries', () => {
    const deployed = parseClass5CredentialScopes(
      readFileSync(join(REPO_ARTIFACT_ROOT, 'class-05.credential-scopes.json')),
    );
    const verified = verifiedCredentialScopes(activeVerifiedControlArtifacts());
    expect(verified.credentialIds).toEqual(deployed.credentialIds);
    expect(verified.artifactVersion).toBe(deployed.artifactVersion);
  });

  it('the risk class is reachable ONLY through a sealed bundle', () => {
    // `50 §3f`: no caller and no model may manufacture the capability. A forged object
    // carries no entry in the private map, so the accessor refuses rather than defaulting.
    const failure = failureDetail(() => verifiedCredentialScopes({} as never));
    expect(failure.code).toBe('NO_ACTIVE_VERIFIED_BUNDLE');
    expect(failure.detail).toMatch(/was not produced by control-artifact verification/);
  });
});

/* ================================================================================
 * THE DEPLOYED DECLARATION — §8's attack, and §9's converse
 * ============================================================================== */

describe('the deployed class-5 declaration answers §8 and §9', () => {
  const verified = () => verifiedCredentialScopes(activeVerifiedControlArtifacts());

  it('§8 — a MIXED envelope is MONEY_MOVING even where ACOS intends only the send', () => {
    const mixed = verified().credentials['synthetic_esp.mixed_send']!;
    expect(mixed.grantedProviderPermissions).toContain('mail.send');
    expect(mixed.grantedProviderPermissions).toContain('payment.refund');
    expect(mixed.monetaryProviderPermissions).toEqual(['payment.refund']);
    expect(mixed.credentialRiskClass).toBe('MONEY_MOVING');
  });

  it('§9 — two credentials on ONE adapter classify differently', () => {
    const scopes = verified();
    const pauseOnly = scopes.credentials['mock_ads.pause_only']!;
    const budgetManage = scopes.credentials['mock_ads.budget_manage']!;
    expect(pauseOnly.adapter).toBe('mock_ads');
    expect(budgetManage.adapter).toBe('mock_ads');
    expect(pauseOnly.credentialRiskClass).toBe('NON_MONETARY_WRITE');
    expect(budgetManage.credentialRiskClass).toBe('MONEY_MOVING');
    // The permission that makes the difference is `§2g` clause 9's budget raise, and it is
    // a PROVIDER permission — the action catalogue says `carries_vendor_monetary_field:
    // false` for `campaign.budget.set`.
    expect(budgetManage.monetaryProviderPermissions).toEqual(['campaign.budget.set']);
  });

  it('the audit read credential is READ_ONLY and carries the reserved audit_plane scope', () => {
    const audit = verified().credentials['synthetic_esp.audit_read']!;
    expect(audit.adapter).toBe(AUDIT_PLANE_CREDENTIAL_SCOPE);
    expect(audit.credentialRiskClass).toBe('READ_ONLY');
    expect(audit.externalMutationCapable).toBe(false);
  });
});
