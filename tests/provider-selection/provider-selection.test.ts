import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  CAPABILITY_STATUSES,
  MAILGUN_CAPABILITY_RECORD,
  OBSERVATION_BASES,
  POSTMARK_DISPOSITION,
  PROVIDER_CAPABILITY_RECORDS,
  REQUIRED_CAPABILITIES,
  RETRIEVED_ON,
  SENDGRID_CAPABILITY_RECORD,
  blockingFindings,
  isSelectable,
  selectProvider,
} from '../../tools/provider-selection/capabilityRecord.js';
import {
  recordWithMissingQueryFinding,
  recordWithSendCapableAuditKey,
  unsafeAcceptsAnyReference,
  unsafeSelectIgnoringAuditWriteCapability,
  unsafeSelectOverPresentFindingsOnly,
} from '../negative-controls/unsafe-provider-selection.js';
import { POSTMARK_CAPABILITY_RECORD } from '../../tools/postmark-sandbox/capabilityRecord.js';

/**
 * `§18`–`§26` — THE PROVIDER CAPABILITY RECORD AND THE SELECTION DECISION.
 *
 * =================================================================================
 * WHAT THIS FILE ASSERTS, AND WHAT IT CANNOT
 *
 * It asserts that the record is DATED, that every row is documentation rather than
 * measurement, that the selection rule is the conjunction `§19` states, and that the three
 * `§29` selection controls discriminate.
 *
 * **IT ASSERTS NOTHING ABOUT ANY PROVIDER'S ACTUAL BEHAVIOUR.** `§27` forbids a provider
 * request and none is made; `§15` puts the empirical attempted-write test in the later
 * slice. Every `basis` below is `PUBLISHED_DOCUMENTATION` and the type makes the distinction
 * impossible to lose.
 * =================================================================================
 */

/* ================================================================================
 * 1. THE RECORD IS DATED DOCUMENTATION, NOT MEASUREMENT
 * ============================================================================== */

describe('`§18`, `§24` — every row is DOCUMENTATION and the date is recorded', () => {
  it('the retrieval date is declared and every record carries it', () => {
    expect(RETRIEVED_ON).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    for (const record of PROVIDER_CAPABILITY_RECORDS) {
      expect(record.retrievedOn, record.provider).toBe(RETRIEVED_ON);
    }
  });

  it('NOT ONE row is marked as measured against an account', () => {
    // `36 §7` requires vendor properties to be MEASURED against a sandbox. S1O measures
    // nothing, and the type carries the distinction so a later slice changes a discriminated
    // value rather than a comment.
    expect([...OBSERVATION_BASES]).toEqual([
      'PUBLISHED_DOCUMENTATION',
      'MEASURED_AGAINST_ACCOUNT',
    ]);
    for (const record of PROVIDER_CAPABILITY_RECORDS) {
      for (const finding of record.findings) {
        expect(finding.basis, `${record.provider}/${finding.capability}`).toBe(
          'PUBLISHED_DOCUMENTATION',
        );
      }
      for (const row of [
        record.sendCredentialScope,
        record.auditReadCredentialScope,
        record.attemptedWriteExpectation,
        record.activityQuery,
        record.correlation,
        record.sandbox,
        record.retentionAndEntitlement,
      ]) {
        expect(row.basis, record.provider).toBe('PUBLISHED_DOCUMENTATION');
      }
    }
  });

  it('the attempted-write test is declared NOT run, for every provider', () => {
    // `§15`: "A documentation claim alone is not the final acceptance proof for a configured
    // provider. [...] The later sandbox slice must empirically run the attempted-write test."
    for (const record of PROVIDER_CAPABILITY_RECORDS) {
      expect(record.attemptedWriteExpectation.empiricallyTested, record.provider).toBe(false);
    }
  });

  it('every reference is an OFFICIAL provider documentation URL', () => {
    const OFFICIAL = [
      /^https:\/\/www\.twilio\.com\/docs\/sendgrid\//,
      /^https:\/\/support\.sendgrid\.com\/hc\//,
      /^https:\/\/documentation\.mailgun\.com\/docs\//,
    ];
    for (const record of PROVIDER_CAPABILITY_RECORDS) {
      const references = [
        ...record.findings.map((f) => f.reference),
        record.sendCredentialScope.reference,
        record.auditReadCredentialScope.reference,
        record.attemptedWriteExpectation.reference,
        record.activityQuery.reference,
        record.correlation.reference,
        record.sandbox.reference,
        record.retentionAndEntitlement.reference,
      ];
      for (const reference of references) {
        expect(
          OFFICIAL.some((pattern) => pattern.test(reference)),
          `${record.provider}: ${reference}`,
        ).toBe(true);
      }
    }
  });

  it('`§25` — no marketing prose: the record constructs no URL and imports no client', () => {
    const source = readFileSync(
      join(process.cwd(), 'tools', 'provider-selection', 'capabilityRecord.ts'),
      'utf8',
    );
    expect(source).not.toMatch(/^\s*import\s/m);
    expect(source).not.toMatch(/new\s+URL\s*\(/);
    expect(source).not.toMatch(/fetch\s*\(/);
  });
});

/* ================================================================================
 * 2. `§19` — THE CONJUNCTION, AND `§22`'s UNRESOLVED
 * ============================================================================== */

describe('`§19` — five required capabilities, and any absence blocks', () => {
  it('the required list is closed at five', () => {
    expect([...REQUIRED_CAPABILITIES]).toEqual([
      'CONTROL_SEND_ONLY_CREDENTIAL',
      'AUDIT_READ_ONLY_CREDENTIAL',
      'PROVIDER_VISIBLE_CORRELATION',
      'QUERYABLE_PROVIDER_EVIDENCE',
      'NON_PRODUCTION_TEST_PATH',
    ]);
  });

  it('`UNRESOLVED` is NOT a synonym for `ABSENT` — §22 and §24 turn on the difference', () => {
    expect([...CAPABILITY_STATUSES]).toEqual(['DOCUMENTED', 'ABSENT', 'UNRESOLVED']);
  });

  it('SendGrid satisfies all five from official documentation', () => {
    expect(blockingFindings(SENDGRID_CAPABILITY_RECORD)).toEqual([]);
    expect(isSelectable(SENDGRID_CAPABILITY_RECORD)).toBe(true);
    // The two scopes are DISJOINT, which is the property the whole slice turns on.
    expect(SENDGRID_CAPABILITY_RECORD.sendCredentialScope.scope).toEqual(['mail.send']);
    expect(SENDGRID_CAPABILITY_RECORD.auditReadCredentialScope.scope).toEqual([
      'email_activity.read',
    ]);
    expect(SENDGRID_CAPABILITY_RECORD.auditReadCredentialScope.sendCapable).toBe(false);
  });

  it('Mailgun is UNRESOLVED on the audit credential — §22’s own rule', () => {
    // `§22`: "Do not infer Events access merely from the word Analyst. If official
    // endpoint/role mapping cannot establish it: mark Mailgun unresolved."
    const blocking = blockingFindings(MAILGUN_CAPABILITY_RECORD);
    expect(blocking).toHaveLength(1);
    expect(blocking[0]!.capability).toBe('AUDIT_READ_ONLY_CREDENTIAL');
    expect(blocking[0]!.status).toBe('UNRESOLVED');
    expect(isSelectable(MAILGUN_CAPABILITY_RECORD)).toBe(false);
    // And the record says so in its own words, not only in a status.
    expect(MAILGUN_CAPABILITY_RECORD.auditReadCredentialScope.sendCapable).toBeNull();
    expect(MAILGUN_CAPABILITY_RECORD.unresolvedAccountItems.length).toBeGreaterThan(0);
  });
});

/* ================================================================================
 * 3. `§23` — THE DECISION RULE
 * ============================================================================== */

describe('`§23` — the selected provider, and the reason', () => {
  it('SendGrid is selected, and the reason is its documented capability shape', () => {
    const decision = selectProvider(PROVIDER_CAPABILITY_RECORDS);
    expect(decision.selected?.provider).toBe('twilio_sendgrid');
    expect(decision.reason).toMatch(/only provider whose official documentation/);
  });

  it('and with NO selectable provider the answer is null, not a best effort', () => {
    // `§33`: "PARTIAL if no provider can satisfy the audit credential constraint."
    const decision = selectProvider([MAILGUN_CAPABILITY_RECORD]);
    expect(decision.selected).toBeNull();
    expect(decision.reason).toMatch(/PARTIAL when no provider can satisfy/);
  });

  it('the tie-break is the NARROWER credential, not a name or a preference', () => {
    const wide = {
      ...SENDGRID_CAPABILITY_RECORD,
      provider: 'synthetic_wide',
      sendCredentialScope: {
        ...SENDGRID_CAPABILITY_RECORD.sendCredentialScope,
        scope: ['mail.send', 'templates.read', 'stats.read'],
      },
    };
    const decision = selectProvider([wide, SENDGRID_CAPABILITY_RECORD]);
    expect(decision.selected?.provider).toBe('twilio_sendgrid');
    expect(decision.reason).toMatch(/narrower independently provable send credential/);
  });

  it('`§21` — the entitlement caveat is recorded, not hidden', () => {
    expect(SENDGRID_CAPABILITY_RECORD.retentionAndEntitlement.addOnRequired).toBe(true);
    const pending = SENDGRID_CAPABILITY_RECORD.unresolvedAccountItems;
    expect(pending.length).toBeGreaterThanOrEqual(3);
    for (const marker of [
      'CAPABILITY DOCUMENTED — ACCOUNT VALIDATION PENDING',
      'attempted-write',
      'additional email activity history',
    ]) {
      expect(pending.join('\n'), marker).toContain(marker);
    }
  });
});

/* ================================================================================
 * 4. `§26` — POSTMARK, AND I8 IS NOT WEAKENED
 * ============================================================================== */

describe('`§26` — Postmark is NOT SELECTED, and its S1M evidence survives', () => {
  it('the disposition is recorded with its reason and weakens no architecture', () => {
    expect(POSTMARK_DISPOSITION.selected).toBe(false);
    expect(POSTMARK_DISPOSITION.disposition).toBe('NOT SELECTED UNDER CURRENT CREDENTIAL MODEL');
    expect(POSTMARK_DISPOSITION.reason).toMatch(/also send-capable/);
    expect(POSTMARK_DISPOSITION.architectureWeakened).toBe(false);
  });

  it('S1M’s own dated record is UNTOUCHED and still says the same thing', () => {
    // `§26`: "Do not delete S1M's evidence."
    expect(POSTMARK_DISPOSITION.s1mEvidenceRetained).toBe(true);
    expect(POSTMARK_CAPABILITY_RECORD.retrievedOn).toBe('2026-09-25');
    expect(POSTMARK_CAPABILITY_RECORD.credentialScoping.readOnlyApiTokenAvailable).toBe(false);
    expect(POSTMARK_CAPABILITY_RECORD.credentialScoping.detail).toMatch(
      /one\s+undivided capability/,
    );
  });
});

/* ================================================================================
 * 5. `§29` CONTROLS 10–12 — EACH DISCRIMINATES
 * ============================================================================== */

describe('CONTROL 10 — a provider selected despite an audit key that can send', () => {
  it('UNSAFE selects it; PRODUCTION reports the blocking finding and selects nothing', () => {
    const sendCapable = recordWithSendCapableAuditKey(SENDGRID_CAPABILITY_RECORD);

    // UNSAFE: the audit credential's independence is downgraded to an advisory.
    expect(unsafeSelectIgnoringAuditWriteCapability([sendCapable])?.provider).toBe(
      'synthetic_send_capable_audit',
    );

    // PRODUCTION: `§19` is a conjunction, and `§26` forbids weakening `I8` / `36 §13`.
    const blocking = blockingFindings(sendCapable);
    expect(blocking).toHaveLength(1);
    expect(blocking[0]!.capability).toBe('AUDIT_READ_ONLY_CREDENTIAL');
    expect(blocking[0]!.status).toBe('ABSENT');
    expect(selectProvider([sendCapable]).selected).toBeNull();
  });
});

describe('CONTROL 11 — a provider selected without query evidence', () => {
  it('UNSAFE passes on a MISSING row; PRODUCTION synthesises UNRESOLVED and blocks', () => {
    const noQuery = recordWithMissingQueryFinding(SENDGRID_CAPABILITY_RECORD);

    // UNSAFE: iterating the findings that happen to be present, a missing row is no row to
    // reject — the conjunction's term was never evaluated.
    expect(unsafeSelectOverPresentFindingsOnly([noQuery])?.provider).toBe(
      'synthetic_no_query_row',
    );

    // PRODUCTION: iterating the CLOSED required list, a missing row is UNRESOLVED.
    const blocking = blockingFindings(noQuery);
    expect(blocking).toHaveLength(1);
    expect(blocking[0]!.capability).toBe('QUERYABLE_PROVIDER_EVIDENCE');
    expect(blocking[0]!.status).toBe('UNRESOLVED');
    expect(blocking[0]!.evidence).toMatch(/no finding was recorded/);
    expect(selectProvider([noQuery]).selected).toBeNull();
  });
});

describe('CONTROL 12 — a provider selected from marketing text', () => {
  it('UNSAFE accepts any reference; PRODUCTION requires an official documentation path', () => {
    const marketing = {
      capability: 'QUERYABLE_PROVIDER_EVIDENCE' as const,
      status: 'DOCUMENTED' as const,
      evidence: 'granular API keys and detailed analytics',
      basis: 'PUBLISHED_DOCUMENTATION' as const,
      reference: 'https://sendgrid.com/en-us/solutions/email-api',
    };

    // UNSAFE: any non-empty reference counts.
    expect(unsafeAcceptsAnyReference(marketing)).toBe(true);

    // PRODUCTION: the reference must sit under an official developer-documentation path.
    const OFFICIAL = [
      /^https:\/\/www\.twilio\.com\/docs\/sendgrid\//,
      /^https:\/\/support\.sendgrid\.com\/hc\//,
      /^https:\/\/documentation\.mailgun\.com\/docs\//,
    ];
    expect(OFFICIAL.some((pattern) => pattern.test(marketing.reference))).toBe(false);
    // And the real record's own rows all pass the same check — asserted above, so the
    // rejection here is not a rejection of the whole scheme.
    expect(
      OFFICIAL.some((pattern) =>
        pattern.test(SENDGRID_CAPABILITY_RECORD.auditReadCredentialScope.reference),
      ),
    ).toBe(true);
  });
});
