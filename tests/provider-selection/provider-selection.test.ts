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
  evidencePathIncompatibility,
  isSelectable,
  selectProvider,
} from '../../tools/provider-selection/capabilityRecord.js';
import {
  recordWhoseSandboxSuppressesEvidence,
  recordWithMissingQueryFinding,
  recordWithSendCapableAuditKey,
  recordWithUnresolvedSandboxEvidence,
  unsafeAcceptsAnyReference,
  unsafeSelectIgnoringAuditWriteCapability,
  unsafeSelectOnIndependentCapabilities,
  unsafeSelectOverPresentFindingsOnly,
  unsafeTreatsNullSandboxEvidenceAsPending,
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
      'additional Email Activity history entitlement',
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

/* ================================================================================
 * 6. THE v1.3.7 CORRECTION — SENDGRID SANDBOX MODE, AND WHAT IT CANNOT BE
 *
 * The S1O owner review found the sandbox row factually wrong: the record carried
 * `producesQueryableActivity: null` and an account-validation item, on the reading that the
 * documentation was silent. It is not silent. Official Twilio SendGrid Sandbox Mode
 * documentation states that requests made in sandbox mode generate no events in either the
 * Event Webhook or Email Activity.
 *
 * `null` was therefore a claim that the documentation is silent where it speaks, and it let
 * the selection rule admit a test path that cannot produce the evidence `I36` reads.
 * ============================================================================== */

describe('`§3` of the correction — SendGrid Sandbox Mode, from the official documentation', () => {
  it('`producesQueryableActivity` is FALSE — not null, not pending', () => {
    // A DOCUMENTED NEGATIVE. `CAPABILITY_STATUSES` keeps `ABSENT` and `UNRESOLVED` apart for
    // exactly this reason, and this row is the first kind.
    expect(SENDGRID_CAPABILITY_RECORD.sandbox.producesQueryableActivity).toBe(false);
    expect(SENDGRID_CAPABILITY_RECORD.sandbox.producesQueryableActivity).not.toBeNull();
    expect(SENDGRID_CAPABILITY_RECORD.sandbox.basis).toBe('PUBLISHED_DOCUMENTATION');
    expect(SENDGRID_CAPABILITY_RECORD.sandbox.reference).toBe(
      'https://www.twilio.com/docs/sendgrid/for-developers/sending-email/sandbox-mode',
    );
    expect(SENDGRID_CAPABILITY_RECORD.sandbox.mechanism).toMatch(
      /Event Webhook or Email Activity/,
    );
  });

  it('the four things sandbox mode must NOT be used for are named, not implied', () => {
    // `§3` of the correction lists them, and a named prohibition is one a later slice can be
    // held to. "It is not suitable" in prose is not.
    const notSuitable = SENDGRID_CAPABILITY_RECORD.sandbox.notSuitableFor.join('\n');
    for (const marker of [
      'accepted-count evidence',
      'I36 six-kill-point oracle',
      'Email Activity correlation',
      'Event Webhook reconciliation',
    ]) {
      expect(notSuitable, marker).toContain(marker);
    }
    // And what it IS for, so the record is not a rejection of the mode as such.
    const suitable = SENDGRID_CAPABILITY_RECORD.sandbox.suitableFor.join('\n');
    expect(suitable).toMatch(/request-shape validation/);
    expect(suitable).toMatch(/credential-scope validation/);
  });

  it('the resolved negative is recorded as SETTLED, and is no longer a pending item', () => {
    expect(SENDGRID_CAPABILITY_RECORD.resolvedDocumentedNegatives.join('\n')).toContain(
      'SANDBOX_ACTIVITY_EVIDENCE = ABSENT',
    );
    // `§7`: "The sandbox-activity question is no longer pending." A pending item nobody can
    // close postpones a decision that has already been made.
    const pending = SENDGRID_CAPABILITY_RECORD.unresolvedAccountItems.join('\n');
    expect(pending).not.toMatch(/whether a sandbox-mode send produces/);
  });

  it('every remaining account-level item from `§7` is carried, and none is claimed done', () => {
    const pending = SENDGRID_CAPABILITY_RECORD.unresolvedAccountItems.join('\n');
    for (const marker of [
      'Email Activity history entitlement',
      'mail.send key actually carries only that permission',
      'audit key actually LACKS mail.send',
      'must be REFUSED BY SENDGRID',
      'sandbox_mode=false',
      'correlation',
      'rate limit',
      'controlled recipient',
    ]) {
      expect(pending, marker).toContain(marker);
    }
    for (const item of SENDGRID_CAPABILITY_RECORD.unresolvedAccountItems) {
      expect(item).toMatch(/ACCOUNT VALIDATION PENDING/);
    }
  });
});

/* ================================================================================
 * 7. `§5` — THE TEST PATH AND THE EVIDENCE PATH MUST BE THE SAME PATH
 * ============================================================================== */

describe('`§5` of the correction — the structural compatibility check', () => {
  it('SendGrid remains SELECTED, on a path that is NOT sandbox mode', () => {
    // `§4`: "SendGrid may remain the selected provider if its other documented capabilities
    // still satisfy the selection rule." They do, and the validation path is the corrected
    // one: a dedicated non-production environment with `sandbox_mode=false`.
    expect(isSelectable(SENDGRID_CAPABILITY_RECORD)).toBe(true);
    expect(evidencePathIncompatibility(SENDGRID_CAPABILITY_RECORD)).toBeNull();

    const path = SENDGRID_CAPABILITY_RECORD.nonProductionValidationPath;
    expect(path.sandboxModeEnabled).toBe(false);
    expect(path.producesQueryableActivity).toBe(true);
    expect(path.requiresControlledRecipient).toBe(true);
    expect(path.mechanism).toMatch(/DEDICATED NON-PRODUCTION/);
  });

  it('and the path names every provisioning item it needs, including the sink recipient', () => {
    const requirements =
      SENDGRID_CAPABILITY_RECORD.nonProductionValidationPath.requirements.join('\n');
    for (const marker of [
      'dedicated non-production SendGrid account, subuser',
      'mail.send integration key',
      'email_activity.read audit key',
      'Email Activity history entitlement',
      'verified sender',
      'OWNER-CONTROLLED SINK RECIPIENT',
    ]) {
      expect(requirements, marker).toContain(marker);
    }
    // `§4`: "no customer recipient; no production business messages."
    expect(requirements).toMatch(/No customer recipient and no production/);
  });

  it('the NON_PRODUCTION_TEST_PATH finding cites the real path, not the sandbox flag', () => {
    const finding = SENDGRID_CAPABILITY_RECORD.findings.find(
      (row) => row.capability === 'NON_PRODUCTION_TEST_PATH',
    );
    expect(finding?.status).toBe('DOCUMENTED');
    expect(finding?.evidence).toMatch(/sandbox_mode=false/);
    expect(finding?.evidence).toMatch(/Sandbox mode is NOT this path/);
  });

  it('Mailgun is blocked TWICE over: the audit credential AND the evidence path', () => {
    // Two independent reasons, and reporting both is the point: `§5` is a new blocker rather
    // than a restatement of `§19`'s conjunction.
    expect(blockingFindings(MAILGUN_CAPABILITY_RECORD)).toHaveLength(1);
    expect(evidencePathIncompatibility(MAILGUN_CAPABILITY_RECORD)).toMatch(/UNRESOLVED/);
    expect(isSelectable(MAILGUN_CAPABILITY_RECORD)).toBe(false);
  });
});

/* ================================================================================
 * 8. CONTROLS 16 AND 17 — THE TWO DEFECTS THE FIRST CANDIDATE HAD
 * ============================================================================== */

describe('CONTROL 16 — a provider selected on capabilities that do not compose', () => {
  it('UNSAFE selects a provider whose safe mode suppresses its own evidence surface', () => {
    const suppressing = recordWhoseSandboxSuppressesEvidence(SENDGRID_CAPABILITY_RECORD);

    // UNSAFE: five independent lookups, all DOCUMENTED, so the conjunction is true.
    expect(unsafeSelectOnIndependentCapabilities([suppressing])?.provider).toBe(
      'synthetic_evidence_suppressing_sandbox',
    );
    // And it really does pass the capability conjunction — which is what makes this a
    // discrimination rather than two rules disagreeing about a malformed record.
    expect(blockingFindings(suppressing)).toEqual([]);

    // PRODUCTION: the same record fails `§5`, because the declared test path cannot carry
    // the evidence the declared query API describes.
    expect(evidencePathIncompatibility(suppressing)).toMatch(/no queryable provider evidence/);
    expect(isSelectable(suppressing)).toBe(false);
    expect(selectProvider([suppressing]).selected).toBeNull();
  });

  it('a path that ENABLES an evidence-suppressing sandbox is caught even when it claims otherwise', () => {
    // The self-contradictory record: the sandbox is documented to leave nothing, and the
    // validation path both enables it and claims evidence. Caught here, rather than trusted
    // to the two fields being edited together.
    const contradictory = {
      ...SENDGRID_CAPABILITY_RECORD,
      provider: 'synthetic_contradictory',
      nonProductionValidationPath: {
        ...SENDGRID_CAPABILITY_RECORD.nonProductionValidationPath,
        sandboxModeEnabled: true,
        producesQueryableActivity: true,
      },
    };
    expect(evidencePathIncompatibility(contradictory)).toMatch(
      /enables a sandbox mode the provider documents as producing no queryable activity/,
    );
    expect(isSelectable(contradictory)).toBe(false);
  });
});

describe('CONTROL 17 — a documented negative carried as an open question', () => {
  it('UNSAFE reads `null` as "pending"; PRODUCTION refuses an unestablished evidence path', () => {
    const nullEvidence = recordWithUnresolvedSandboxEvidence(SENDGRID_CAPABILITY_RECORD);

    // UNSAFE: `null` treated as "an account will settle this later", on a row the provider's
    // own documentation already settled.
    expect(unsafeTreatsNullSandboxEvidenceAsPending(nullEvidence)).toBe(true);
    expect(nullEvidence.resolvedDocumentedNegatives).toEqual([]);

    // PRODUCTION: an UNRESOLVED evidence path is not an established one, and the corrected
    // record carries `false` with the documentation reference instead.
    expect(evidencePathIncompatibility(nullEvidence)).toMatch(
      /UNRESOLVED rather than established/,
    );
    expect(isSelectable(nullEvidence)).toBe(false);
    expect(unsafeTreatsNullSandboxEvidenceAsPending(SENDGRID_CAPABILITY_RECORD)).toBe(false);
  });
});
