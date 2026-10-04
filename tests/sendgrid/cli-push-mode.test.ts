import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { CorrelationObservation } from '../../src/audit/providerEvidence/evidenceReader.js';
import {
  ENV_AUDIT_LOCATOR,
  ENV_CONFIG,
  ENV_DUPLICATE_ACK,
  ENV_ENTITLEMENT_CONFIRMED,
  ENV_INTEGRATION_LOCATOR,
  ENV_LIVE_ACK,
  ENV_NON_PRODUCTION_ACK,
  DUPLICATE_ACK_TOKEN,
  ENTITLEMENT_CONFIRMED_TOKEN,
  LIVE_ACK_TOKEN,
  NON_PRODUCTION_ACK_TOKEN,
  i8Conclusion,
  main,
} from '../../validation/sendgrid/harness/cli.js';
import type { S1PHarnessSeams } from '../../validation/sendgrid/harness/cli.js';
import type { EvidenceBundle } from '../../validation/sendgrid/harness/evidence.js';
import {
  ENV_AUDIT_PG_URL,
  type CompositionInput,
  type OpenedScenarioComposition,
  type ScenarioCompositionProvider,
} from '../../validation/sendgrid/harness/liveComposition.js';
import type { ProbeLaunchResult } from '../../validation/sendgrid/harness/probeClient.js';
import {
  SIGNED_PUSH_LIVE_VISIBILITY_BOUND,
  runPushInverseObservation,
  type SignedPushEvidencePort,
} from '../../validation/sendgrid/harness/pushEvidence.js';
import {
  FIXTURE_VISIBILITY_BOUND,
  type VisibilityBound,
} from '../../validation/sendgrid/harness/visibilityBound.js';
import { acceptSend, readAccount } from '../sendgrid-doubles/simulatedAccount.js';
import { createOutboxHarness, type OutboxHarness } from '../support/outboxFixture.js';
import { TEST_ONLY_WEBHOOK_SIGNER_B, pushRecord } from '../support/providerEvidenceFixture.js';
import {
  S1P_AUDIT_CREDENTIAL_ID,
  S1P_INTEGRATION_CREDENTIAL_ID,
  S1P_PROVIDER_ID,
  S1P_SENDER,
  S1P_SINK,
  createS1PScenario,
  s1pPushValidationArtifacts,
  s1pValidationArtifacts,
  type S1PScenario,
} from '../support/s1pScenarioFixture.js';

/**
 * v1.3.8 CORRECTION, DEFECT 1 — `SIGNED_PROVIDER_PUSH` THROUGH THE REAL CLI ENTRY POINT.
 *
 * =================================================================================
 * THE SUBJECT IS `main`, AS IN `cli-orchestration.test.ts`
 *
 * The mode comes from the VERIFIED class-28 record in the supplied package and from nothing
 * else: no flag, no environment variable, no configuration preference. Under push the run
 * needs the integration credential, its class-5 record, the class-28 push record, the audit
 * evidence store and the audit plane's own agreement — and NOTHING of the SendGrid audit read:
 * no audit credential identity, locator, class-5 record, Key Vault secret, managed identity,
 * Email Activity entitlement, audit reader child, capability probe or `/v3/messages` read.
 *
 * The recording seams below are what PROVE the second half. Every credential-process launch
 * is recorded with its plane and role; every audit-reader launch is recorded and refused; the
 * composition input is captured so its audit locator can be asserted `null`.
 *
 * THE PUSH PORT. The audit-store reader is exercised end to end by
 * `tests/providerEvidence/ingress-runtime.test.ts` and `tests/sendgrid/signed-push-evidence.test.ts`.
 * Here the port reads the simulated account's accepted messages directly — a stand-in for the
 * evidence a real ingress would have committed — because what is under test is which oracle the
 * CLI routes to, not the store.
 * =================================================================================
 */

const INTEGRATION_PRINCIPAL = '11111111-2222-3333-4444-555555555555';
const AUDIT_PRINCIPAL = '99999999-8888-7777-6666-555555555555';

let h: OutboxHarness;
let scenario: S1PScenario | null = null;
let workspace: string;

interface Launch {
  readonly plane: string;
  readonly role: string;
  readonly expectedCredentialId: string;
  readonly locator: string;
}

let launches: Launch[];
let auditReaderLaunches: number;
let inverseCalls: number;
let compositionInputs: CompositionInput[];

beforeAll(async () => {
  h = await createOutboxHarness();
}, 120_000);

afterAll(async () => {
  await h.close();
});

beforeEach(async () => {
  await h.reset();
  launches = [];
  auditReaderLaunches = 0;
  inverseCalls = 0;
  compositionInputs = [];
});

afterEach(async () => {
  if (scenario !== null) await scenario.cleanup();
  scenario = null;
  if (workspace !== undefined) rmSync(workspace, { recursive: true, force: true });
});

/** A RECORDING probe launcher. It forks nothing and holds nothing. */
function recordingProbe(
  options: { readonly integrationIdentityFails?: boolean } = {},
): NonNullable<S1PHarnessSeams['probe']> {
  return (input): Promise<ProbeLaunchResult> => {
    launches.push({
      plane: input.plane,
      role: input.role,
      expectedCredentialId: input.expectedCredentialId,
      locator: input.locator,
    });
    if (input.role === 'IDENTITY') {
      if (options.integrationIdentityFails === true && input.plane === 'INTEGRATION') {
        return Promise.resolve({ kind: 'PROBE_PROCESS_FAILED' as const, detail: 'NO_REPLY' as const });
      }
      return Promise.resolve({
        kind: 'REPLY' as const,
        pid: 0,
        reply: {
          kind: 'IDENTITY_FACTS' as const,
          facts: {
            plane: input.plane,
            resolved: true,
            resolvedIdentity: input.expectedCredentialId,
            identityProvenance: 'PROVIDER_KEY_ID',
            expectedCredentialId: input.expectedCredentialId,
            identityMatchedExpectation: true,
            revoked: false,
            sourcePrincipalIdentity: input.plane === 'INTEGRATION' ? INTEGRATION_PRINCIPAL : AUDIT_PRINCIPAL,
            sourcePrincipalMechanism: 'SECRET_MANAGER_VERSION',
            environmentKeys: ['ACOS_S1P_PROBE_ROLE', 'ACOS_S1P_PROBE_PLANE'],
            pid: 0,
          },
        },
      });
    }
    if (input.role === 'DUPLICATE_SEND_PROBE') {
      const tag = input.operands?.correlationTag ?? '';
      acceptSend(scenario!.accountPath, { categories: [tag] });
      acceptSend(scenario!.accountPath, { categories: [tag] });
    }
    const outcome =
      input.role === 'READ_PROBE' && input.plane === 'AUDIT'
        ? 'CAPABILITY_CONFIRMED'
        : input.role === 'DUPLICATE_SEND_PROBE'
          ? 'CAPABILITY_CONFIRMED'
          : 'CAPABILITY_REFUSED_BY_PROVIDER';
    return Promise.resolve({
      kind: 'REPLY' as const,
      pid: 0,
      reply: {
        kind: 'PROBE_RECORD' as const,
        record: {
          operation: `${input.role} ${input.plane}`,
          credentialIdentity: input.expectedCredentialId,
          plane: input.plane,
          httpStatus: 200,
          outcome: outcome as never,
          note: 'offline stub for the push-mode CLI suite',
        },
      },
    });
  };
}

/** Accepted messages under one correlation, as the simulated account recorded them. */
function accountObservation(tag: string): CorrelationObservation {
  const ids = readAccount(scenario!.accountPath)
    .messages.filter((message) => message.categories[0] === tag)
    .map((message) => message.msg_id)
    .sort();
  return {
    provider: S1P_PROVIDER_ID,
    correlationTag: tag,
    providerMessageIds: ids,
    observedAcceptedCount: ids.length,
    knownIncomplete: false,
    incompleteReasons: [],
    completenessEstablished: false,
    i36: ids.length >= 2 ? 'EXCESS_DUPLICATE_SEND_EVIDENCE' : ids.length === 1 ? 'ONE_OBSERVED_NOT_FINAL' : 'NONE_OBSERVED_NOT_FINAL',
  };
}

/** The OFFLINE PUSH composition: the accepted kernel path, an audit-store-shaped oracle, no reader. */
function pushComposition(bound: VisibilityBound): ScenarioCompositionProvider {
  return {
    label: 'OFFLINE S1P scenario composition (simulated transport, signed-push oracle)',
    describe: (input) => {
      compositionInputs.push(input);
      return { available: true, blocks: [], statement: 'the OFFLINE push composition is available' };
    },
    open: (input): Promise<OpenedScenarioComposition> => {
      compositionInputs.push(input);
      scenario = createS1PScenario(h, { maxObservationAttempts: 6 });
      const base = scenario;
      const signedPushEvidence: SignedPushEvidencePort = {
        observe: (query) => Promise.resolve(accountObservation(query.correlationTag)),
        inverse: (query) => {
          inverseCalls += 1;
          const unaccounted = readAccount(base.accountPath)
            .messages.filter((message) => !query.accountedCorrelationTags.has(message.categories[0] ?? ''))
            .map((message) => ({
              sgMessageId: message.msg_id,
              correlationTag: message.categories[0] ?? '',
              eventClass: 'processed',
            }));
          return Promise.resolve({
            outcome:
              unaccounted.length > 0
                ? ('UNACCOUNTED_PROVIDER_ACTIVITY' as const)
                : ('NO_UNACCOUNTED_ACTIVITY_SEEN_PERIOD_INCOMPLETE' as const),
            examinedEvents: readAccount(base.accountPath).messages.length,
            unaccounted,
          });
        },
      };
      return Promise.resolve({
        // NO audit-reader runtime configuration exists under push.
        runtime: { ...base.runtime, auditReader: null },
        ports: {
          ...base.ports,
          visibilityBound: bound,
          signedPushEvidence,
          launchAuditReader: () => {
            auditReaderLaunches += 1;
            return Promise.reject(new Error('an audit READER was launched under SIGNED_PROVIDER_PUSH'));
          },
        },
        close: () => Promise.resolve(),
      });
    },
  };
}

/** A push operator's environment: NO audit locator, NO entitlement, NO audit credential id. */
function pushEnvironment(
  overrides: Readonly<Record<string, string | undefined>> = {},
  config: Readonly<Record<string, unknown>> = {},
  auditEnv: Readonly<Record<string, string>> = s1pPushValidationArtifacts().fixture.auditEnv,
): Readonly<Record<string, string | undefined>> {
  workspace = mkdtempSync(join(tmpdir(), 'acos-s1p-push-cli-'));
  const configPath = join(workspace, 'deployment.json');
  writeFileSync(
    configPath,
    JSON.stringify({
      environmentLabel: 'nonprod-validation',
      senderAddress: S1P_SENDER,
      sinkAddress: S1P_SINK,
      integrationCredentialId: S1P_INTEGRATION_CREDENTIAL_ID,
      ...config,
    }),
    'utf8',
  );
  const environment: Record<string, string | undefined> = {
    ...auditEnv,
    [ENV_CONFIG]: configPath,
    [ENV_NON_PRODUCTION_ACK]: NON_PRODUCTION_ACK_TOKEN,
    [ENV_LIVE_ACK]: LIVE_ACK_TOKEN,
    [ENV_INTEGRATION_LOCATOR]: join(workspace, 'integration-secret.json'),
    // Configuration presence only: the offline composition never connects to it.
    [ENV_AUDIT_PG_URL]: 'postgres://audit-evidence.invalid/acos_audit',
    ...overrides,
  };
  for (const key of Object.keys(environment)) {
    if (environment[key] === undefined) delete environment[key];
  }
  return environment;
}

function pushSeams(extra: Partial<S1PHarnessSeams> = {}, bound: VisibilityBound = FIXTURE_VISIBILITY_BOUND): S1PHarnessSeams {
  const { bundle } = s1pPushValidationArtifacts();
  return {
    composition: pushComposition(bound),
    probe: recordingProbe(),
    bundle: () => bundle,
    visibilityBound: bound,
    evidenceDirectory: join(workspace, 'evidence'),
    ...extra,
  };
}

function writtenEvidence(): EvidenceBundle {
  const directory = join(workspace, 'evidence');
  const files = readdirSync(directory);
  expect(files.length).toBe(1);
  return JSON.parse(readFileSync(join(directory, files[0]!), 'utf8')) as EvidenceBundle;
}

describe('6.1 — SIGNED_PROVIDER_PUSH runs through `main` WITHOUT any SendGrid audit-read item', () => {
  it('the preflight passes with no audit credential id, no audit locator and no entitlement', async () => {
    const environment = pushEnvironment();
    expect(environment[ENV_AUDIT_LOCATOR]).toBeUndefined();
    expect(environment[ENV_ENTITLEMENT_CONFIRMED]).toBeUndefined();
    await main(environment, pushSeams());
    const evidence = writtenEvidence();
    expect(evidence.preflightFailures).toEqual([]);
    expect(evidence.providerEvidenceMode).toBe('SIGNED_PROVIDER_PUSH');
    expect(evidence.killPoints.map((row) => row.point)).toEqual([1, 2, 3, 4, 5, 6]);
  }, 180_000);

  it('ONE credential process is launched — the INTEGRATION identity — and no audit or capability probe', async () => {
    await main(pushEnvironment(), pushSeams());
    expect(launches).toEqual([
      expect.objectContaining({
        plane: 'INTEGRATION',
        role: 'IDENTITY',
        expectedCredentialId: S1P_INTEGRATION_CREDENTIAL_ID,
      }),
    ]);
    expect(launches.filter((launch) => launch.plane === 'AUDIT')).toEqual([]);
    expect(launches.filter((launch) => launch.role === 'READ_PROBE' || launch.role === 'SEND_PROBE')).toEqual([]);
  }, 180_000);

  it('no audit reader child is launched, the audit locator is null, and I8 used the push inverse', async () => {
    await main(pushEnvironment(), pushSeams());
    expect(auditReaderLaunches).toBe(0);
    expect(compositionInputs.length).toBeGreaterThan(0);
    for (const input of compositionInputs) {
      expect(input.auditLocator).toBeNull();
      expect(input.config.auditCredentialId).toBeNull();
    }
    expect(inverseCalls).toBe(1);
    const evidence = writtenEvidence();
    expect(evidence.invariantConclusions.i8).toContain('NOT DISCHARGED');
    expect(evidence.invariantConclusions.i8).toContain('quiet channel');
    expect(evidence.invariantConclusions.i8).not.toContain('DISCHARGED FOR THE SWEPT PERIOD');
  }, 180_000);

  it('the evidence bundle says SIGNED_PROVIDER_PUSH and manufactures NO audit-read evidence', async () => {
    await main(pushEnvironment(), pushSeams());
    const evidence = writtenEvidence();
    expect(evidence.schema).toBe('acos.s1p.sendgrid-validation-evidence.v2');
    expect(evidence.packageIssue).toBe('v1.3.8');
    expect(evidence.auditCredentialIdentity).toBeNull();
    expect(evidence.auditIdentityMatchedSignedRecord).toBeNull();
    expect(evidence.auditKeySendRefusal).toBeNull();
    expect(evidence.probes).toEqual([]);
    expect(evidence.providerEvidence).toMatchObject({
      mode: 'SIGNED_PROVIDER_PUSH',
      evidenceSource: 'AUDIT_STORE_AUTHENTICATED_PUSH',
      auditReadCredential: 'NOT_APPLICABLE',
      auditPrincipal: 'NOT_APPLICABLE',
      auditKeySendRefusal: 'NOT_APPLICABLE',
      emailActivityEntitlement: 'NOT_APPLICABLE',
      emailActivityRead: 'NOT_APPLICABLE',
      providerReadInverseSweep: 'NOT_APPLICABLE',
      completenessBasis: 'UNESTABLISHED',
    });
    if (evidence.providerEvidence.mode !== 'SIGNED_PROVIDER_PUSH') throw new Error('not push');
    expect(
      evidence.providerEvidence.openEmpiricalObligations.some((entry) =>
        entry.startsWith('PROVIDER_PERMISSION_DRIFT'),
      ),
    ).toBe(true);
    const rendered = JSON.stringify(evidence);
    expect(rendered).not.toContain(S1P_AUDIT_CREDENTIAL_ID);
    expect(rendered).not.toContain('v1.3.7');
  }, 180_000);

  it('under the LIVE push bound: no PASS, point 6 UNRESOLVED, I20 UNRESOLVED with an observed lower bound', async () => {
    await main(pushEnvironment(), pushSeams({}, SIGNED_PUSH_LIVE_VISIBILITY_BOUND));
    const evidence = writtenEvidence();
    expect(evidence.visibilityBoundKind).toBe('UNESTABLISHED');
    expect(evidence.killPoints.filter((row) => row.verdict === 'PASS')).toEqual([]);
    expect(evidence.killPoints.filter((row) => row.verdict === 'FAIL')).toEqual([]);
    const six = evidence.killPoints.find((row) => row.point === 6)!;
    expect(six.verdict).toBe('UNRESOLVED');
    expect(six.redispatchOccurred).toBeNull();
    expect(evidence.i20?.verdict).toBe('UNRESOLVED');
    expect(evidence.i20?.providerAcceptedIrrecoverableEffects).toBeNull();
    expect(evidence.i20?.observedDistinctAcceptedMessagesLowerBound).toBe(4);
  }, 180_000);

  it('the duplicate negative control uses the PUSH oracle and still sees the pair', async () => {
    await main(pushEnvironment({ [ENV_DUPLICATE_ACK]: DUPLICATE_ACK_TOKEN }), pushSeams());
    const evidence = writtenEvidence();
    expect(evidence.duplicateControl.status).toBe('RUN');
    expect(evidence.duplicateControl.observedAcceptedCount).toBe(2);
    expect(evidence.duplicateControl.oracleDiscriminatedDuplicate).toBe(true);
    expect(auditReaderLaunches).toBe(0);
    expect(launches.filter((launch) => launch.plane === 'AUDIT')).toEqual([]);
  }, 240_000);
});

describe('6.1 — what a push run still REQUIRES, each refusing before any credential is touched', () => {
  async function refusedStage1(
    environment: Readonly<Record<string, string | undefined>>,
    extra: Partial<S1PHarnessSeams> = {},
  ): Promise<readonly string[]> {
    const exit = await main(environment, pushSeams(extra));
    expect(exit).toBe(1);
    expect(launches).toEqual([]);
    const evidence = writtenEvidence();
    expect(evidence.credentialsTouched).toBe(false);
    expect(evidence.killPoints).toEqual([]);
    return evidence.stage1Failures;
  }

  it('no audit evidence store configured refuses', async () => {
    expect(await refusedStage1(pushEnvironment({ [ENV_AUDIT_PG_URL]: undefined }))).toContain(
      'AUDIT_EVIDENCE_STORE_NOT_CONFIGURED',
    );
  }, 60_000);

  it('a SUPPLIED audit locator or audit credential id is refused, not ignored', async () => {
    expect(
      await refusedStage1(pushEnvironment({ [ENV_AUDIT_LOCATOR]: '/some/audit-secret.json' })),
    ).toEqual(['AUDIT_READ_CREDENTIAL_SUPPLIED_UNDER_SIGNED_PUSH']);
  }, 60_000);

  it('a SUPPLIED audit credential id is refused, not ignored', async () => {
    expect(
      await refusedStage1(pushEnvironment({}, { auditCredentialId: S1P_AUDIT_CREDENTIAL_ID })),
    ).toEqual(['AUDIT_READ_CREDENTIAL_SUPPLIED_UNDER_SIGNED_PUSH']);
  }, 60_000);

  it('an integration identity with no signed class-5 record refuses', async () => {
    expect(
      await refusedStage1(pushEnvironment({}, { integrationCredentialId: 'twilio_sendgrid.unsigned_send' })),
    ).toContain('INTEGRATION_CLASS_5_RECORD_ABSENT');
  }, 60_000);

  it('a class 28 that names NO SendGrid channel refuses, and every read gate fires beside it', async () => {
    const { bundle } = s1pPushValidationArtifacts([]);
    const failures = await refusedStage1(pushEnvironment(), { bundle: () => bundle });
    for (const gate of [
      'PROVIDER_EVIDENCE_MODE_UNDECLARED',
      'AUDIT_CREDENTIAL_ID_NOT_CONFIGURED',
      'AUDIT_CLASS_5_RECORD_ABSENT',
      'EMAIL_ACTIVITY_ENTITLEMENT_UNCONFIRMED',
    ]) {
      expect(failures, gate).toContain(gate);
    }
  }, 60_000);

  it('an unverifiable control package (no verified class 28 at all) refuses', async () => {
    const failures = await refusedStage1(pushEnvironment(), { bundle: () => null });
    expect(failures).toContain('CONTROL_ARTIFACT_BUNDLE_UNAVAILABLE');
    expect(failures).toContain('PROVIDER_EVIDENCE_MODE_UNDECLARED');
  }, 60_000);

  it('an audit plane whose OWN class 28 disagrees refuses', async () => {
    // The audit plane verifies the READ-mode package while the control bundle says push.
    const readAuditEnv = s1pValidationArtifacts().fixture.auditEnv;
    expect(await refusedStage1(pushEnvironment({}, {}, readAuditEnv))).toEqual([
      'AUDIT_PLANE_EVIDENCE_CHANNEL_DISAGREES',
    ]);
  }, 60_000);

  it('an audit plane with NO trust configuration refuses', async () => {
    expect(await refusedStage1(pushEnvironment({}, {}, {}))).toEqual([
      'AUDIT_PLANE_EVIDENCE_CHANNEL_DISAGREES',
    ]);
  }, 60_000);

  it('a push channel whose audit-plane copy names a DIFFERENT key identity refuses', async () => {
    const other = s1pPushValidationArtifacts([pushRecord({}, TEST_ONLY_WEBHOOK_SIGNER_B)]);
    expect(await refusedStage1(pushEnvironment({}, {}, other.fixture.auditEnv))).toEqual([
      'AUDIT_PLANE_EVIDENCE_CHANNEL_DISAGREES',
    ]);
  }, 60_000);

  for (const [label, variant] of [
    [
      'accepted_event_classes',
      () => s1pPushValidationArtifacts([pushRecord({ accepted_event_classes: ['delivered', 'processed'] })]),
    ],
    [
      'ingress_identity',
      () =>
        s1pPushValidationArtifacts([
          pushRecord({ ingress_identity: 'https://webhook-b.example.test/provider-evidence/sendgrid' }),
        ]),
    ],
  ] as const) {
    it(`SPLIT BRAIN: the audit plane's class 28 has the SAME key but a different ${label} — refused`, async () => {
      expect(await refusedStage1(pushEnvironment({}, {}, variant().fixture.auditEnv))).toEqual([
        'AUDIT_PLANE_EVIDENCE_CHANNEL_DISAGREES',
      ]);
    }, 60_000);
  }

  it('an integration credential that does not resolve refuses at stage 2; nothing is composed', async () => {
    const exit = await main(pushEnvironment(), pushSeams({ probe: recordingProbe({ integrationIdentityFails: true }) }));
    expect(exit).toBe(1);
    const evidence = writtenEvidence();
    expect(evidence.stage1Failures).toEqual([]);
    expect(evidence.stage2Failures).toContain('INTEGRATION_CREDENTIAL_UNAVAILABLE');
    expect(evidence.stage2Failures.filter((gate) => gate.startsWith('AUDIT'))).toEqual([]);
    expect(launches.map((launch) => `${launch.plane}:${launch.role}`)).toEqual(['INTEGRATION:IDENTITY']);
    expect(evidence.killPoints).toEqual([]);
  }, 60_000);
});

describe('6.5 — PROVIDER_READ keeps EVERY audit-read prerequisite', () => {
  /** The read-mode package with a push-shaped environment: every read prerequisite missing. */
  it('without the audit identity, locator and entitlement, a READ run refuses on each', async () => {
    const { bundle, fixture } = s1pValidationArtifacts();
    const exit = await main(
      pushEnvironment({ [ENV_AUDIT_PG_URL]: undefined }, {}, fixture.auditEnv),
      pushSeams({ bundle: () => bundle }),
    );
    expect(exit).toBe(1);
    const evidence = writtenEvidence();
    expect(evidence.providerEvidenceMode).toBe('PROVIDER_READ');
    for (const gate of ['AUDIT_CREDENTIAL_ID_NOT_CONFIGURED', 'AUDIT_CLASS_5_RECORD_ABSENT', 'EMAIL_ACTIVITY_ENTITLEMENT_UNCONFIRMED']) {
      expect(evidence.stage1Failures, gate).toContain(gate);
    }
    // And no push-only gate stands in for them.
    expect(evidence.stage1Failures).not.toContain('AUDIT_EVIDENCE_STORE_NOT_CONFIGURED');
    expect(launches).toEqual([]);
  }, 60_000);

  it('a fully configured READ run launches BOTH identity processes and all THREE capability probes', async () => {
    const { bundle, fixture } = s1pValidationArtifacts();
    const readComposition: ScenarioCompositionProvider = {
      label: 'OFFLINE S1P scenario composition (simulated transport)',
      describe: (input) => {
        compositionInputs.push(input);
        return { available: true, blocks: [], statement: 'available' };
      },
      open: (input) => {
        compositionInputs.push(input);
        scenario = createS1PScenario(h, { maxObservationAttempts: 6 });
        return Promise.resolve({ runtime: scenario.runtime, ports: scenario.ports, close: () => Promise.resolve() });
      },
    };
    await main(
      pushEnvironment(
        {
          [ENV_AUDIT_PG_URL]: undefined,
          [ENV_AUDIT_LOCATOR]: '/some/audit-secret.json',
          [ENV_ENTITLEMENT_CONFIRMED]: ENTITLEMENT_CONFIRMED_TOKEN,
        },
        { auditCredentialId: S1P_AUDIT_CREDENTIAL_ID },
        fixture.auditEnv,
      ),
      pushSeams({ bundle: () => bundle, composition: readComposition }),
    );
    const evidence = writtenEvidence();
    expect(evidence.preflightFailures).toEqual([]);
    expect(evidence.providerEvidenceMode).toBe('PROVIDER_READ');
    expect(evidence.providerEvidence.mode).toBe('PROVIDER_READ');
    expect(launches.map((launch) => `${launch.plane}:${launch.role}`)).toEqual([
      'INTEGRATION:IDENTITY',
      'AUDIT:IDENTITY',
      'AUDIT:READ_PROBE',
      'AUDIT:SEND_PROBE',
      'INTEGRATION:READ_PROBE',
    ]);
    expect(evidence.auditIdentityMatchedSignedRecord).toBe(true);
    expect(evidence.auditKeySendRefusal).not.toBeNull();
    for (const input of compositionInputs) expect(input.auditLocator).toBe('/some/audit-secret.json');
  }, 180_000);
});

describe('FINAL CORRECTION 3 — the push I8 evidence text carries the ACTUAL sweep statement', () => {
  const PLACEHOLDER = '$' + '{sweep.statement}';

  it('a quiet push period: NOT DISCHARGED, the statement interpolated, no literal placeholder', async () => {
    const sweep = await runPushInverseObservation(
      {
        inverse: () =>
          Promise.resolve({
            outcome: 'NO_UNACCOUNTED_ACTIVITY_SEEN_PERIOD_INCOMPLETE' as const,
            examinedEvents: 7,
            unaccounted: [],
          }),
      },
      { periodStartMs: 0, periodEndMs: 1, accountedCorrelationTags: new Set() },
    );
    const known = { ...sweep, statement: 'KNOWN-QUIET-STATEMENT-7f3a' };
    const text = i8Conclusion(known, null, 'SIGNED_PROVIDER_PUSH');
    expect(text).toContain('NOT DISCHARGED');
    expect(text).toContain('INCOMPLETE, not clean');
    expect(text).toContain('KNOWN-QUIET-STATEMENT-7f3a');
    expect(text).not.toContain(PLACEHOLDER);
    expect(text).not.toContain('$' + '{');
    // The adapter's own statement, unaltered, also reaches the text.
    expect(i8Conclusion(sweep, null, 'SIGNED_PROVIDER_PUSH')).toContain(sweep.statement);
  });

  it('a positive push finding: VIOLATED, the statement interpolated, no literal placeholder', async () => {
    const sweep = await runPushInverseObservation(
      {
        inverse: () =>
          Promise.resolve({
            outcome: 'UNACCOUNTED_PROVIDER_ACTIVITY' as const,
            examinedEvents: 1,
            unaccounted: [{ sgMessageId: 'm', correlationTag: 'acos-corr-y', eventClass: 'processed' }],
          }),
      },
      { periodStartMs: 0, periodEndMs: 1, accountedCorrelationTags: new Set() },
    );
    const text = i8Conclusion({ ...sweep, statement: 'KNOWN-FINDING-STATEMENT-9c1e' }, null, 'SIGNED_PROVIDER_PUSH');
    expect(text).toContain('**VIOLATED.** 1 authenticated accepted event(s)');
    expect(text).toContain('KNOWN-FINDING-STATEMENT-9c1e');
    expect(text).not.toContain(PLACEHOLDER);
  });

  it('the RENDERED evidence bundle of a push run carries no literal placeholder anywhere', async () => {
    await main(pushEnvironment(), pushSeams());
    const directory = join(workspace, 'evidence');
    const rendered = readFileSync(join(directory, readdirSync(directory)[0]!), 'utf8');
    expect(rendered).not.toContain('$' + '{');
    expect(writtenEvidence().invariantConclusions.i8).toContain('quiet channel is not a clean one');
  }, 180_000);
});
