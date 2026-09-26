import { describe, expect, it } from 'vitest';

import {
  MAILGUN_CAPABILITY_RECORD,
  SENDGRID_CAPABILITY_RECORD,
} from '../../tools/provider-selection/capabilityRecord.js';
import {
  credentialScopesNormativelyCompatible,
  s1mReadiness,
} from '../../tools/provider-selection/s1mReadiness.js';
import { recordWithSendCapableAuditKey } from '../negative-controls/unsafe-provider-selection.js';

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
    expect(result.status).toBe('READY_TO_PROVISION_TWILIO_SENDGRID_SANDBOX_CREDENTIALS');
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
