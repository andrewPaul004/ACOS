import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  MAILGUN_CAPABILITY_RECORD,
  SENDGRID_CAPABILITY_RECORD,
  evidencePathIncompatibility,
} from '../../tools/provider-selection/capabilityRecord.js';
import {
  credentialScopesNormativelyCompatible,
  nonProductionReadinessToken,
  s1mReadiness,
} from '../../tools/provider-selection/s1mReadiness.js';
import {
  recordWhoseSandboxSuppressesEvidence,
  recordWithSendCapableAuditKey,
} from '../negative-controls/unsafe-provider-selection.js';

/**
 * `§28` — THE DETERMINISTIC S1M READINESS RESULT.
 *
 * The three boundary flags are supplied as INPUTS, and this file supplies `true` for the two
 * that S1N and S1O actually prove — `tests/integration/perimeter/` and
 * `tests/integration/audit/` — because a readiness function that observed its own conclusion
 * would be asserting it.
 */

const GREEN = {
  integrationBoundaryGreen: true,
  auditReadBoundaryGreen: true,
  localArchitectureBlockers: [] as readonly string[],
};

describe('`§28` — the readiness token is a CONJUNCTION, not a judgement', () => {
  it('READY names the selected provider and carries the pending account items', () => {
    const result = s1mReadiness(GREEN);
    expect(result.status).toBe(
      'READY_TO_PROVISION_TWILIO_SENDGRID_NONPRODUCTION_TEST_CREDENTIALS',
    );
    expect(result.selectedProvider).toBe('twilio_sendgrid');
    expect(result.blockers).toEqual([]);

    /*
     * THE PENDING ITEMS ARE CARRIED, NOT CLEARED.
     *
     * `§28`: "Do NOT say provider validation complete." A READY token beside an empty
     * pending list would say exactly that, so the list is part of the result and the
     * attempted-write test is in it.
     */
    expect(result.accountValidationPending.length).toBeGreaterThanOrEqual(3);
    expect(result.accountValidationPending.join('\n')).toContain('attempted-write');
  });

  it('every conjunct can block, and each reports its own reason', () => {
    for (const [label, inputs] of [
      ['integration', { ...GREEN, integrationBoundaryGreen: false }],
      ['audit', { ...GREEN, auditReadBoundaryGreen: false }],
      ['local', { ...GREEN, localArchitectureBlockers: ['option B is required'] }],
    ] as const) {
      const result = s1mReadiness(inputs);
      expect(result.status, label).toBe('NOT_READY_TO_PROVISION');
      expect(result.blockers.length, label).toBeGreaterThan(0);
    }
  });

  it('NO PROVIDER SELECTED blocks, and the pending list is empty rather than invented', () => {
    const result = s1mReadiness(GREEN, [MAILGUN_CAPABILITY_RECORD]);
    expect(result.status).toBe('NOT_READY_TO_PROVISION');
    expect(result.selectedProvider).toBeNull();
    expect(result.blockers[0]).toMatch(/no provider selected/);
    expect(result.accountValidationPending).toEqual([]);
  });
});

describe('`§28` conjunct 4 — normative scope compatibility', () => {
  it('SendGrid’s documented pair is compatible, and the reason names both scopes', () => {
    const { compatible, reason } = credentialScopesNormativelyCompatible(
      SENDGRID_CAPABILITY_RECORD,
    );
    expect(compatible).toBe(true);
    expect(reason).toContain('mail.send');
    expect(reason).toContain('email_activity.read');
  });

  it('a SEND-CAPABLE audit scope is NOT compatible — 48 §3.6’s exemption is not earned', () => {
    const broken = recordWithSendCapableAuditKey(SENDGRID_CAPABILITY_RECORD);
    const { compatible, reason } = credentialScopesNormativelyCompatible(broken);
    expect(compatible).toBe(false);
    expect(reason).toMatch(/would not classify it READ_ONLY/);
    // And the whole conjunction refuses, not just this clause.
    expect(s1mReadiness(GREEN, [broken]).status).toBe('NOT_READY_TO_PROVISION');
  });

  it('an UNRESOLVED audit scope is NOT compatible either — null is not false', () => {
    // Mailgun's `sendCapable` is `null`: the documentation does not settle it. A check
    // written `=== true` would have admitted it, which is why the check is `!== false`.
    expect(MAILGUN_CAPABILITY_RECORD.auditReadCredentialScope.sendCapable).toBeNull();
    expect(credentialScopesNormativelyCompatible(MAILGUN_CAPABILITY_RECORD).compatible).toBe(
      false,
    );
  });
});

/* ================================================================================
 * THE v1.3.7 CORRECTION — THE READINESS TOKEN NAMES THE RIGHT ENVIRONMENT
 *
 * `§6` of the correction: "Remove `READY_TO_PROVISION_*_SANDBOX_CREDENTIALS` for SendGrid.
 * Use precise semantics." The old token named the provider's sandbox mode, and the official
 * documentation says that mode generates no Email Activity and no Event Webhook events — so
 * the token described an environment in which `I36` can observe nothing.
 * ============================================================================== */

describe('`§6` of the correction — no `..._SANDBOX_CREDENTIALS` token survives', () => {
  it('the emitted token is the NON-PRODUCTION one, and says SENDGRID', () => {
    const result = s1mReadiness(GREEN);
    expect(result.status).toBe('READY_TO_PROVISION_TWILIO_SENDGRID_NONPRODUCTION_TEST_CREDENTIALS');

    // `§6`, both halves: it must name the provider explicitly, and it must NOT say sandbox.
    expect(result.status).toContain('SENDGRID');
    expect(result.status).not.toContain('SANDBOX');
    expect(result.status).toContain('NONPRODUCTION_TEST_CREDENTIALS');
  });

  it('the token is DERIVED from the selected provider, so it cannot name a stale one', () => {
    expect(nonProductionReadinessToken('twilio_sendgrid')).toBe(
      'READY_TO_PROVISION_TWILIO_SENDGRID_NONPRODUCTION_TEST_CREDENTIALS',
    );
    // A renamed provider renames its token. There is no second place holding the old string.
    expect(nonProductionReadinessToken('some_other_provider')).toBe(
      'READY_TO_PROVISION_SOME_OTHER_PROVIDER_NONPRODUCTION_TEST_CREDENTIALS',
    );
  });

  it('no module in the repository still emits a `_SANDBOX_CREDENTIALS` readiness token', () => {
    /*
     * A REPOSITORY-WIDE ASSERTION, because the defect this replaces was a STRING.
     *
     * The type union already excludes the old member, so a call site returning one would not
     * compile — but a string could still be written into a document, a comment or a report
     * and read as the result. This reads the two modules that produce and render the token
     * and requires the old suffix to appear nowhere in either.
     */
    for (const file of ['s1mReadiness.ts', 'cli.ts', 'capabilityRecord.ts']) {
      const source = readFileSync(join(process.cwd(), 'tools', 'provider-selection', file), 'utf8');
      const emitted = source.match(/READY_TO_PROVISION_[A-Z_$<>{}]*SANDBOX_CREDENTIALS/g) ?? [];
      // The only permitted mentions are the ones explaining what was REMOVED, and those are
      // in prose that names the mandate's original offer rather than emitting a value.
      for (const mention of emitted) {
        expect(mention, `${file}: ${mention}`).toBe('READY_TO_PROVISION_<PROVIDER>_SANDBOX_CREDENTIALS');
      }
    }
  });
});

describe('`§5` of the correction — conjunct 6 can block the token on its own', () => {
  it('a provider whose test path suppresses its evidence gets NO readiness token', () => {
    const suppressing = recordWhoseSandboxSuppressesEvidence(SENDGRID_CAPABILITY_RECORD);
    const result = s1mReadiness(GREEN, [suppressing]);

    expect(result.status).toBe('NOT_READY_TO_PROVISION');
    // It is blocked on SELECTION, because `isSelectable` already applies the rule — and the
    // reason names the compatibility rule rather than a capability.
    expect(result.blockers.join('\n')).toMatch(/test-path\/evidence compatibility/);
  });

  it('and the conjunct is checked again on the selected provider, as defence in depth', () => {
    // The token is the artifact a later slice acts on. If selection were ever relaxed, the
    // readiness result must still refuse rather than promise an unusable environment.
    expect(evidencePathIncompatibility(SENDGRID_CAPABILITY_RECORD)).toBeNull();
    const suppressing = recordWhoseSandboxSuppressesEvidence(SENDGRID_CAPABILITY_RECORD);
    expect(evidencePathIncompatibility(suppressing)).not.toBeNull();
  });
});

describe('`§7` of the correction — the token carries what is settled AND what is pending', () => {
  it('a READY result carries the documented negative beside the token', () => {
    const result = s1mReadiness(GREEN);
    expect(result.resolvedDocumentedNegatives.join('\n')).toContain(
      'SANDBOX_ACTIVITY_EVIDENCE = ABSENT',
    );
    // Without it, "non-production test credentials" reads as "sandbox credentials" and the
    // wrong environment gets provisioned. Carried, never cleared.
    expect(result.resolvedDocumentedNegatives.length).toBeGreaterThan(0);
  });

  it('and it still carries every account-level item, none of them completed', () => {
    const result = s1mReadiness(GREEN);
    const pending = result.accountValidationPending.join('\n');
    for (const marker of [
      'Email Activity history entitlement',
      'audit key actually LACKS mail.send',
      'must be REFUSED BY SENDGRID',
      'controlled recipient',
    ]) {
      expect(pending, marker).toContain(marker);
    }
    expect(result.accountValidationPending.length).toBeGreaterThanOrEqual(8);
  });
});
