import { describe, expect, it } from 'vitest';

import {
  NOTHING_ESTABLISHED,
  NO_CREDENTIAL_FACTS,
  SENDGRID_ADAPTER_ID,
  SENDGRID_METHOD,
  SENDGRID_PROVIDER_ID,
  STAGE_1_GATES,
  STAGE_2_GATES,
  evaluateStage1,
  evaluateStage2,
  stage1PermitsCredentialResolution,
  stage2PermitsLiveRun,
  type Stage1Facts,
  type Stage2Facts,
} from '../../validation/sendgrid/harness/preflight.js';
import {
  ENV_CONFIG,
  ENV_DUPLICATE_ACK,
  ENV_ENTITLEMENT_CONFIRMED,
  ENV_LIVE_ACK,
  ENV_NON_PRODUCTION_ACK,
  ENTITLEMENT_CONFIRMED_TOKEN,
  LIVE_ACK_TOKEN,
  NON_PRODUCTION_ACK_TOKEN,
  establishStage1Facts,
} from '../../validation/sendgrid/harness/cli.js';
import { OWNER_SINK_MARKER } from '../../validation/sendgrid/integration/validationPayload.js';
import { parseDeploymentConfig } from '../../validation/sendgrid/harness/deploymentConfig.js';

/**
 * `§8.5`, `§4`, `§6`, `§7` — THE TWO-STAGE GATE.
 *
 * =================================================================================
 * WHAT THE INDEPENDENT REVIEW CHANGED ABOUT THIS SUITE
 *
 * The rejected preflight was ONE function over ONE fact record, and the CLI resolved both
 * vendor credentials before calling it. The corrected one is two functions over two records,
 * and the ordering is the safety property — so this file asserts:
 *
 *   `§4`   stage 1 refuses from facts NO CREDENTIAL CONTRIBUTED TO, and the stage-1 fact
 *          record has no member a credential could occupy;
 *   `§6`   the EXACT configured credential identity is what selects the signed class-5
 *          record, and stage 2 compares the resolution to that SAME identity;
 *   `§7`   the non-production declaration is the operator's SENTENCE, and a parseable
 *          configuration document does not supply it.
 * =================================================================================
 */

const SINK = `owner+${OWNER_SINK_MARKER}@example.test`;
const SENDER = 'validation@nonprod.example.test';

/** Every stage-1 fact established. The only record `evaluateStage1` passes. */
const FULLY_ESTABLISHED: Stage1Facts = Object.freeze({
  verifiedBundleAvailable: true,
  providerId: SENDGRID_PROVIDER_ID,
  deploymentConfigurationRead: true,
  nonProductionAcknowledged: true,
  environmentLabel: 'acos-s1p-nonprod',
  sandboxModeRequested: false,
  configuredIntegrationCredentialId: 'twilio_sendgrid.validation_send',
  configuredAuditCredentialId: 'twilio_sendgrid.audit_read',
  integrationSignedRecordFound: true,
  integrationSignedRecordAdapter: SENDGRID_ADAPTER_ID,
  integrationRiskClass: 'NON_MONETARY_WRITE',
  auditSignedRecordFound: true,
  auditSignedRecordAdapter: 'audit_plane',
  auditSignedRecordProvider: SENDGRID_PROVIDER_ID,
  auditRiskClass: 'READ_ONLY',
  adapterInSignedCatalogue: true,
  signedActionClassAdapter: SENDGRID_ADAPTER_ID,
  signedActionClassMethod: SENDGRID_METHOD,
  configuredAdapterRuntimeCount: 1,
  senderAddress: SENDER,
  sinkAddress: SINK,
  recipientReachableFromProductionState: false,
  emailActivityEntitlementConfirmed: true,
  liveRunOptedIn: true,
  duplicateControlRequested: false,
  duplicateControlOptedIn: false,
  controlPlaneCompositionAvailable: true,
});

/** Every stage-2 fact established, with a MATERIAL-BOUND provenance. */
const CREDENTIALS_BOUND: Stage2Facts = Object.freeze({
  integrationProbeAnswered: true,
  integrationCredentialResolved: true,
  integrationResolvedIdentity: 'twilio_sendgrid.validation_send',
  integrationIdentityProvenance: 'PROVIDER_KEY_ID',
  auditProbeAnswered: true,
  auditCredentialResolved: true,
  auditResolvedIdentity: 'twilio_sendgrid.audit_read',
  auditIdentityProvenance: 'DEPLOYMENT_SECRET_VERSION',
  /*
   * TWO **DIFFERENT** AZURE PRINCIPALS, because the established set must establish this too.
   *
   * The gate they feed is independent of the credential-identity gate above: those two
   * identities say which SendGrid material each plane resolved; these say which Azure
   * principal was allowed to resolve it.
   */
  integrationSourcePrincipal: '11111111-2222-3333-4444-555555555555',
  auditSourcePrincipal: '99999999-8888-7777-6666-555555555555',
  configuredIntegrationCredentialId: 'twilio_sendgrid.validation_send',
  configuredAuditCredentialId: 'twilio_sendgrid.audit_read',
});

describe('THE AZURE PRINCIPAL GATES — A SECOND, INDEPENDENT SEPARATION CONTROL', () => {
  /*
   * =================================================================================
   * WHY THIS IS NOT COVERED BY `CREDENTIALS_NOT_DISTINCT`
   *
   * That gate compares the SendGrid credential identities — which material each plane
   * resolved. These compare the AZURE PRINCIPALS — which identity was allowed to resolve it.
   *
   * The configuration they catch is the one the other gate cannot see: two genuinely distinct
   * SendGrid keys, in two genuinely distinct Key Vault secrets, both readable by ONE
   * over-privileged user-assigned managed identity. Every credential-identity check passes,
   * and the separation `48 §3.6`'s read-only exemption rests on does not exist.
   * =================================================================================
   */
  it('the fully established set has DISTINCT principals and passes', () => {
    expect(evaluateStage2(CREDENTIALS_BOUND)).toEqual([]);
    expect(CREDENTIALS_BOUND.integrationSourcePrincipal).not.toBe(
      CREDENTIALS_BOUND.auditSourcePrincipal,
    );
  });

  it('**THE SAME managed identity on both planes REFUSES**, with distinct credentials', () => {
    /*
     * THE DISCRIMINATING CASE. Both SendGrid identities are still distinct and still match
     * their configured expectations, so every accepted gate passes — and the run is refused
     * anyway, on the principal alone.
     */
    const shared = '11111111-2222-3333-4444-555555555555';
    const failures = evaluateStage2({
      ...CREDENTIALS_BOUND,
      integrationSourcePrincipal: shared,
      auditSourcePrincipal: shared,
    });
    expect(failures).toContain('CREDENTIAL_SOURCE_PRINCIPALS_NOT_DISTINCT');
    // ...and NOT because anything else broke.
    expect(failures).not.toContain('CREDENTIALS_NOT_DISTINCT');
    expect(failures).not.toContain('INTEGRATION_CREDENTIAL_IDENTITY_MISMATCH');
    expect(failures).not.toContain('AUDIT_CREDENTIAL_IDENTITY_MISMATCH');
  });

  it('a child that reported NO principal refuses, per plane', () => {
    const noIntegration = evaluateStage2({
      ...CREDENTIALS_BOUND,
      integrationSourcePrincipal: null,
    });
    expect(noIntegration).toContain('INTEGRATION_SOURCE_PRINCIPAL_UNAVAILABLE');

    const noAudit = evaluateStage2({ ...CREDENTIALS_BOUND, auditSourcePrincipal: null });
    expect(noAudit).toContain('AUDIT_SOURCE_PRINCIPAL_UNAVAILABLE');
  });

  it('TWO ABSENCES ARE NOT DISTINCT — `null` does not equal `null` for this gate', () => {
    /*
     * The same rule `CREDENTIALS_NOT_DISTINCT` follows, and for the same reason: a pair that
     * both failed to report has established no separation, and reading two absences as
     * "different" would let the misconfiguration this gate exists for pass unnoticed.
     */
    const failures = evaluateStage2({
      ...CREDENTIALS_BOUND,
      integrationSourcePrincipal: null,
      auditSourcePrincipal: null,
    });
    expect(failures).toContain('CREDENTIAL_SOURCE_PRINCIPALS_NOT_DISTINCT');
  });

  it('the two controls are INDEPENDENT — one shared SendGrid key still refuses on its own gate', () => {
    // NON-VACUOUS IN THE OTHER DIRECTION: distinct principals do not excuse a shared key.
    const failures = evaluateStage2({
      ...CREDENTIALS_BOUND,
      auditResolvedIdentity: CREDENTIALS_BOUND.integrationResolvedIdentity,
      configuredAuditCredentialId: CREDENTIALS_BOUND.integrationResolvedIdentity,
    });
    expect(failures).toContain('CREDENTIALS_NOT_DISTINCT');
    expect(failures).not.toContain('CREDENTIAL_SOURCE_PRINCIPALS_NOT_DISTINCT');
  });
});

describe('`§4` — STAGE 1 REFUSES FROM FACTS NO CREDENTIAL CONTRIBUTED TO', () => {
  it('the fully established set passes, so the refusals below are real discriminations', () => {
    expect(evaluateStage1(FULLY_ESTABLISHED)).toEqual([]);
    expect(stage1PermitsCredentialResolution(FULLY_ESTABLISHED)).toBe(true);
  });

  it('a run that established NOTHING refuses, and refuses on nearly every gate', () => {
    const failures = evaluateStage1(NOTHING_ESTABLISHED);
    expect(stage1PermitsCredentialResolution(NOTHING_ESTABLISHED)).toBe(false);
    /*
     * Every gate EXCEPT the four whose refusing value is the SAFE one — an absent sandbox
     * request, an unreachable production target, an un-requested duplicate control, and the
     * class-5 sub-gates that only fire once a record has been FOUND.
     */
    const unreachableFromNothing = [
      'SANDBOX_MODE_ENABLED',
      'PRODUCTION_TARGET_REACHABLE',
      'DUPLICATE_CONTROL_NOT_SEPARATELY_OPTED_IN',
      'CONFIGURED_CREDENTIAL_IDS_NOT_DISTINCT',
      'INTEGRATION_CLASS_5_RECORD_ADAPTER_MISMATCH',
      'AUDIT_CLASS_5_RECORD_SCOPE_MISMATCH',
      'INTEGRATION_CREDENTIAL_NOT_OPTION_A_LEGAL',
      'AUDIT_CREDENTIAL_NOT_READ_ONLY',
      'OPTION_A_RUNTIME_COUNT_EXCEEDED',
    ];
    for (const gate of STAGE_1_GATES) {
      if (unreachableFromNothing.includes(gate)) continue;
      expect(failures, gate).toContain(gate);
    }
  });

  it('`Stage1Facts` has NO member a credential, a secret or a locator could occupy', () => {
    /*
     * `§4.1`: stage 1 checks "everything that can be established without credential
     * material". The record's member list is the structural statement of that, so it is
     * asserted by value rather than by reading the comments.
     */
    for (const key of Object.keys(NOTHING_ESTABLISHED)) {
      expect(key.toLowerCase(), key).not.toContain('secret');
      expect(key.toLowerCase(), key).not.toContain('locator');
      expect(key.toLowerCase(), key).not.toContain('apikey');
      expect(key.toLowerCase(), key).not.toContain('material');
    }
    // The two credential members that DO appear are IDENTITIES declared by configuration.
    expect(Object.keys(NOTHING_ESTABLISHED)).toContain('configuredIntegrationCredentialId');
    expect(Object.keys(NOTHING_ESTABLISHED)).toContain('configuredAuditCredentialId');
  });

  it('EVERY individual stage-1 fact is load-bearing — flipping one refuses on its own gate', () => {
    const cases: readonly (readonly [Partial<Stage1Facts>, string])[] = [
      [{ verifiedBundleAvailable: false }, 'CONTROL_ARTIFACT_BUNDLE_UNAVAILABLE'],
      [{ providerId: 'postmark' }, 'PROVIDER_NOT_SENDGRID'],
      [{ deploymentConfigurationRead: false }, 'DEPLOYMENT_CONFIGURATION_UNREADABLE'],
      [{ nonProductionAcknowledged: false }, 'NON_PRODUCTION_NOT_ACKNOWLEDGED'],
      [{ environmentLabel: null }, 'NON_PRODUCTION_ENVIRONMENT_LABEL_ABSENT'],
      [{ sandboxModeRequested: true }, 'SANDBOX_MODE_ENABLED'],
      [{ configuredIntegrationCredentialId: null }, 'INTEGRATION_CREDENTIAL_ID_NOT_CONFIGURED'],
      [{ configuredAuditCredentialId: null }, 'AUDIT_CREDENTIAL_ID_NOT_CONFIGURED'],
      [{ integrationSignedRecordFound: false }, 'INTEGRATION_CLASS_5_RECORD_ABSENT'],
      [{ auditSignedRecordFound: false }, 'AUDIT_CLASS_5_RECORD_ABSENT'],
      [{ integrationSignedRecordAdapter: 'mock_ads' }, 'INTEGRATION_CLASS_5_RECORD_ADAPTER_MISMATCH'],
      [{ auditSignedRecordAdapter: 'sendgrid_email' }, 'AUDIT_CLASS_5_RECORD_SCOPE_MISMATCH'],
      [{ auditSignedRecordProvider: 'synthetic_esp' }, 'AUDIT_CLASS_5_RECORD_SCOPE_MISMATCH'],
      [{ integrationRiskClass: 'MONEY_MOVING' }, 'INTEGRATION_CREDENTIAL_NOT_OPTION_A_LEGAL'],
      [{ auditRiskClass: 'NON_MONETARY_WRITE' }, 'AUDIT_CREDENTIAL_NOT_READ_ONLY'],
      [{ configuredAdapterRuntimeCount: 3 }, 'OPTION_A_RUNTIME_COUNT_EXCEEDED'],
      [{ adapterInSignedCatalogue: false }, 'ADAPTER_NOT_IN_SIGNED_CATALOGUE'],
      [{ signedActionClassMethod: 'emailSendV2' }, 'SIGNED_CLASS_3_OPERATION_MISMATCH'],
      [{ signedActionClassAdapter: 'mock_ads' }, 'SIGNED_CLASS_3_OPERATION_MISMATCH'],
      [{ senderAddress: null }, 'SENDER_IDENTITY_ABSENT'],
      [{ sinkAddress: 'customer@example.com' }, 'SINK_ABSENT_OR_NOT_OWNER_CONTROLLED'],
      [{ recipientReachableFromProductionState: true }, 'PRODUCTION_TARGET_REACHABLE'],
      [{ emailActivityEntitlementConfirmed: false }, 'EMAIL_ACTIVITY_ENTITLEMENT_UNCONFIRMED'],
      [{ liveRunOptedIn: false }, 'LIVE_RUN_NOT_OPTED_IN'],
      [{ controlPlaneCompositionAvailable: false }, 'CONTROL_PLANE_COMPOSITION_UNAVAILABLE'],
    ];
    for (const [override, gate] of cases) {
      const failures = evaluateStage1({ ...FULLY_ESTABLISHED, ...override });
      expect(failures, `${gate}: ${JSON.stringify(override)}`).toContain(gate);
    }
    // NON-VACUOUS: the table covers every stage-1 gate that a single flip can reach.
    expect(new Set(cases.map(([, gate]) => gate)).size).toBeGreaterThanOrEqual(
      STAGE_1_GATES.length - 2,
    );
  });

  it('`§6` — two planes naming ONE credential identity is refused', () => {
    const shared = evaluateStage1({
      ...FULLY_ESTABLISHED,
      configuredAuditCredentialId: FULLY_ESTABLISHED.configuredIntegrationCredentialId,
    });
    expect(shared).toContain('CONFIGURED_CREDENTIAL_IDS_NOT_DISTINCT');
  });

  it('`§11` — the duplicate control needs its OWN opt-in, and only when requested', () => {
    expect(evaluateStage1({ ...FULLY_ESTABLISHED, duplicateControlRequested: false })).toEqual([]);
    expect(
      evaluateStage1({ ...FULLY_ESTABLISHED, duplicateControlRequested: true }),
    ).toContain('DUPLICATE_CONTROL_NOT_SEPARATELY_OPTED_IN');
    expect(
      evaluateStage1({
        ...FULLY_ESTABLISHED,
        duplicateControlRequested: true,
        duplicateControlOptedIn: true,
      }),
    ).toEqual([]);
  });
});

describe('`§4` — STAGE 2 IS ONLY ABOUT CREDENTIAL IDENTITY, AND IT FAILS CLOSED', () => {
  it('the bound set passes; the empty set fails every gate that can fire', () => {
    expect(evaluateStage2(CREDENTIALS_BOUND)).toEqual([]);
    expect(stage2PermitsLiveRun(CREDENTIALS_BOUND)).toBe(true);

    const nothing = evaluateStage2(NO_CREDENTIAL_FACTS);
    expect(stage2PermitsLiveRun(NO_CREDENTIAL_FACTS)).toBe(false);
    for (const gate of STAGE_2_GATES) expect(nothing, gate).toContain(gate);
  });

  it('`§3` — a FIXTURE provenance fails the material-binding gate on BOTH planes', () => {
    expect(
      evaluateStage2({ ...CREDENTIALS_BOUND, integrationIdentityProvenance: 'SYNTHETIC_TEST_IDENTITY' }),
    ).toContain('INTEGRATION_IDENTITY_NOT_MATERIAL_BOUND');
    expect(
      evaluateStage2({ ...CREDENTIALS_BOUND, auditIdentityProvenance: 'SYNTHETIC_TEST_IDENTITY' }),
    ).toContain('AUDIT_IDENTITY_NOT_MATERIAL_BOUND');
  });

  it('`§6` — the comparison is against the CONFIGURED identity, not against "some record"', () => {
    /*
     * The resolved credential is a real, material-bound one; it is simply NOT the one the
     * trusted configuration named. The rejected harness could not express this case at all,
     * because it discovered its expectation by scanning for the adapter.
     */
    const wrongCredential = evaluateStage2({
      ...CREDENTIALS_BOUND,
      integrationResolvedIdentity: 'twilio_sendgrid.some_other_send_key',
    });
    expect(wrongCredential).toContain('INTEGRATION_CREDENTIAL_IDENTITY_MISMATCH');
  });

  it('TWO ABSENCES ARE NOT DISTINCT — the shared-key gate fails closed', () => {
    const bothAbsent = evaluateStage2({
      ...NO_CREDENTIAL_FACTS,
      integrationProbeAnswered: true,
      auditProbeAnswered: true,
    });
    expect(bothAbsent).toContain('CREDENTIALS_NOT_DISTINCT');

    const sameIdentity = evaluateStage2({
      ...CREDENTIALS_BOUND,
      auditResolvedIdentity: CREDENTIALS_BOUND.integrationResolvedIdentity,
      configuredAuditCredentialId: CREDENTIALS_BOUND.integrationResolvedIdentity,
    });
    expect(sameIdentity).toContain('CREDENTIALS_NOT_DISTINCT');
  });

  it('a probe process that did not answer is a FAILURE, never a pass', () => {
    expect(
      evaluateStage2({ ...CREDENTIALS_BOUND, integrationProbeAnswered: false }),
    ).toContain('CREDENTIAL_PROBE_PROCESS_FAILED');
  });
});

describe('`§7` — THE NON-PRODUCTION DECLARATION IS THE OPERATOR SENTENCE', () => {
  it('a PARSEABLE configuration document does NOT supply it', () => {
    const configured = parseDeploymentConfig({
      environmentLabel: 'acos-s1p-nonprod',
      senderAddress: SENDER,
      sinkAddress: SINK,
      integrationCredentialId: 'twilio_sendgrid.validation_send',
      auditCredentialId: 'twilio_sendgrid.audit_read',
    });
    expect(configured.kind).toBe('CONFIG');

    /*
     * THE REJECTED HARNESS COMPUTED `nonProductionDeclared` AS EXACTLY THIS PREDICATE.
     * A document that parses says the operator wrote five well-formed fields; it says nothing
     * about whether the ACCOUNT is a dedicated non-production identity.
     */
    const withoutSentence = establishStage1Facts({}, { controlPlaneCompositionAvailable: true });
    expect(withoutSentence.facts.nonProductionAcknowledged).toBe(false);
    expect(evaluateStage1(withoutSentence.facts)).toContain('NON_PRODUCTION_NOT_ACKNOWLEDGED');
  });

  it('the sentence names all three things `§7` requires, so it cannot be read narrowly', () => {
    expect(NON_PRODUCTION_ACK_TOKEN).toContain('DEDICATED_NON_PRODUCTION');
    expect(NON_PRODUCTION_ACK_TOKEN).toContain('OWNER_CONTROLLED_SINK');
    expect(NON_PRODUCTION_ACK_TOKEN).toContain('NO_CUSTOMER_RECIPIENT');
  });

  it('and it is a TOKEN — `true`, `1` and `yes` do not declare anything', () => {
    for (const attempt of ['true', '1', 'yes', 'YES', 'non-production']) {
      const facts = establishStage1Facts(
        { [ENV_NON_PRODUCTION_ACK]: attempt },
        { controlPlaneCompositionAvailable: true },
      ).facts;
      expect(facts.nonProductionAcknowledged, attempt).toBe(false);
    }
    const real = establishStage1Facts(
      { [ENV_NON_PRODUCTION_ACK]: NON_PRODUCTION_ACK_TOKEN },
      { controlPlaneCompositionAvailable: true },
    ).facts;
    expect(real.nonProductionAcknowledged).toBe(true);
  });
});

describe('`§8.5` — THE CLI ESTABLISHES STAGE-1 FACTS WITHOUT REACHING ANYTHING', () => {
  it('on THIS repository, with no credentials, stage 1 refuses', async () => {
    const { facts } = establishStage1Facts({
      [ENV_LIVE_ACK]: LIVE_ACK_TOKEN,
      [ENV_ENTITLEMENT_CONFIRMED]: ENTITLEMENT_CONFIRMED_TOKEN,
      [ENV_NON_PRODUCTION_ACK]: NON_PRODUCTION_ACK_TOKEN,
    });
    const failures = evaluateStage1(facts);
    expect(failures.length).toBeGreaterThan(0);

    /*
     * THE GATES THIS REPOSITORY ACTUALLY FAILS, NAMED.
     *
     * No deployment configuration exists, so no credential identity is configured and no
     * class-5 record can be selected; and no deployment composition root exists, so the
     * scenario driver has nothing to traverse. The signed class-3 record for `email.send` DOES
     * exist after this slice, so `ADAPTER_NOT_IN_SIGNED_CATALOGUE` is NOT among them — which
     * is a change from the rejected slice and is asserted rather than assumed.
     */
    expect(failures).toContain('DEPLOYMENT_CONFIGURATION_UNREADABLE');
    expect(failures).toContain('INTEGRATION_CREDENTIAL_ID_NOT_CONFIGURED');
    expect(failures).toContain('AUDIT_CREDENTIAL_ID_NOT_CONFIGURED');
    expect(failures).toContain('CONTROL_PLANE_COMPOSITION_UNAVAILABLE');
    expect(failures).not.toContain('ADAPTER_NOT_IN_SIGNED_CATALOGUE');
    expect(failures).not.toContain('SIGNED_CLASS_3_OPERATION_MISMATCH');
    await Promise.resolve();
  });

  it('the acknowledgements are TOKENS — `true`, `1` and `yes` do not opt in', () => {
    for (const attempt of ['true', '1', 'yes', 'YES']) {
      const facts = establishStage1Facts({
        [ENV_LIVE_ACK]: attempt,
        [ENV_ENTITLEMENT_CONFIRMED]: attempt,
      }).facts;
      expect(facts.liveRunOptedIn, attempt).toBe(false);
      expect(facts.emailActivityEntitlementConfirmed, attempt).toBe(false);
    }
  });

  it('setting the duplicate variable to ANYTHING requests the control, and a wrong value refuses', () => {
    const wrong = establishStage1Facts({ [ENV_DUPLICATE_ACK]: 'yes' }).facts;
    expect(wrong.duplicateControlRequested).toBe(true);
    expect(wrong.duplicateControlOptedIn).toBe(false);
    expect(evaluateStage1(wrong)).toContain('DUPLICATE_CONTROL_NOT_SEPARATELY_OPTED_IN');
  });

  it('an unreadable configuration path refuses rather than defaulting', () => {
    const facts = establishStage1Facts({ [ENV_CONFIG]: '/definitely/not/a/path.json' }).facts;
    expect(facts.deploymentConfigurationRead).toBe(false);
    expect(facts.configuredIntegrationCredentialId).toBeNull();
    expect(facts.senderAddress).toBeNull();
  });
});

describe('`§8.5` — THE DEPLOYMENT CONFIGURATION CANNOT CARRY A KEY', () => {
  const base = {
    environmentLabel: 'acos-s1p-nonprod',
    senderAddress: SENDER,
    sinkAddress: SINK,
    integrationCredentialId: 'twilio_sendgrid.validation_send',
    auditCredentialId: 'twilio_sendgrid.audit_read',
  };

  it('the parsed configuration has exactly five members and none is the key', () => {
    const parsed = parseDeploymentConfig({
      ...base,
      apiKey: 'SG.THIS-IS-NOT-A-REAL-KEY.0000000000000000000000000000000000000000',
    });
    expect(parsed.kind).toBe('CONFIG');
    if (parsed.kind !== 'CONFIG') return;
    expect(Object.keys(parsed.config).sort()).toEqual([
      'auditCredentialId',
      'environmentLabel',
      'integrationCredentialId',
      'senderAddress',
      'sinkAddress',
    ]);
    expect(JSON.stringify(parsed.config)).not.toContain('SG.');
  });

  it('a key pasted into a label slot is REFUSED rather than redacted', () => {
    for (const field of ['environmentLabel', 'integrationCredentialId', 'auditCredentialId']) {
      const parsed = parseDeploymentConfig({
        ...base,
        [field]: 'SG.THIS-IS-NOT-A-REAL-KEY.0000000000000000000000000000000000000000',
      });
      expect(parsed.kind, field).toBe('REFUSED');
    }
  });

  it('a non-owner sink is refused at configuration time, before any effect exists', () => {
    const parsed = parseDeploymentConfig({ ...base, sinkAddress: 'customer@example.com' });
    expect(parsed.kind).toBe('REFUSED');
    if (parsed.kind !== 'REFUSED') return;
    expect(parsed.reason).toBe('SINK_NOT_OWNER_CONTROLLED');
  });

  it('`§6` — a configuration naming ONE identity for both planes is refused', () => {
    const parsed = parseDeploymentConfig({ ...base, auditCredentialId: base.integrationCredentialId });
    expect(parsed.kind).toBe('REFUSED');
    if (parsed.kind !== 'REFUSED') return;
    expect(parsed.reason).toBe('CREDENTIAL_IDS_NOT_DISTINCT');
  });
});
