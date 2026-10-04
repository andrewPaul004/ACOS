import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { classesServedBy } from '../../../src/integration/control/adapterRuntimeRegistry.js';
import {
  activeVerifiedControlArtifacts,
  bootstrapControlArtifactAuthority,
  kernelAuthorityReady,
} from '../../../src/kernel/controlArtifacts/registry.js';
import {
  verifiedActionCatalogue,
  verifiedCredentialScopes,
} from '../../../src/kernel/controlArtifacts/bundle.js';
import type { VerifiedControlArtifactBundle } from '../../../src/kernel/controlArtifacts/bundle.js';
import { readDeploymentConfig } from './deploymentConfig.js';
import type { S1PDeploymentConfig } from './deploymentConfig.js';
import {
  NOTHING_ESTABLISHED,
  NO_CREDENTIAL_FACTS,
  SENDGRID_ACTION_CLASS,
  SENDGRID_ADAPTER_ID,
  SENDGRID_PROVIDER_ID,
  evaluateStage1,
  evaluateStage2,
  type ProviderEvidenceMode,
  type Stage1Facts,
  type Stage2Facts,
} from './preflight.js';
import {
  I17B_STATUS,
  NOT_APPLICABLE,
  bundleDigest,
  productionStatementFor,
  redactAddress,
  renderEvidenceBundle,
  type EvidenceBundle,
  type ProviderEvidenceSection,
} from './evidence.js';
import { KILL_POINT_CONCLUSION_LIMITS } from './killPoints.js';
import { runCredentialProbe } from './probeClient.js';
import {
  SIGNED_PUSH_OPEN_EMPIRICAL_OBLIGATIONS,
  orchestrateCapabilityProbes,
} from './capabilityProbes.js';
import type { ProbeBlock } from './capabilityProbes.js';
import type { CredentialIdentityFacts, ProbeRecord } from './probeResult.js';
import { mintCorrelationTag } from '../../../src/kernel/outbox/correlationTag.js';
import {
  auditDescriptorFor,
  runAllScenarios,
  type ScenarioResult,
} from './scenarioDriver.js';
import {
  auditPlaneAgreesOnPushChannel,
  createLiveScenarioComposition,
  ENV_AUDIT_PG_URL,
  LIVE_ACTIVITY_PAGE_RECORDS,
  LIVE_VISIBILITY_BOUND,
  verifiedEvidenceModeFor,
  type CompositionAvailability,
  type ScenarioCompositionProvider,
} from './liveComposition.js';
import {
  observePushCorrelation,
  runPushInverseObservation,
  type SignedPushEvidencePort,
} from './pushEvidence.js';
import { compareI20, type I20Comparison } from './i20.js';
import {
  MAX_SWEEP_PAGES,
  MAX_SWEEP_RECORDS,
  runInverseSweep,
  type InverseSweepResult,
} from './inverseSweep.js';
import {
  SENDGRID_ACTIVITY_COMPLETENESS,
  SENDGRID_COMPLETENESS_BASIS,
  type ActivityPage,
} from '../audit/activityCompleteness.js';
import { observeCorrelation, type ObservationDeps } from './observation.js';
import { observationModeLabel, type VisibilityBound } from './visibilityBound.js';
import type { KillPointEvidence } from './evidence.js';
import type { OpenedScenarioComposition } from './liveComposition.js';

type OpenedPorts = OpenedScenarioComposition['ports'];
type OpenedRuntime = OpenedScenarioComposition['runtime'];

/**
 * `§8.5`, `§4`, `§5` — THE S1P LIVE-VALIDATION ENTRY POINT. **THE COORDINATOR HOLDS NO
 * VENDOR CREDENTIAL.**
 *
 * =================================================================================
 * NOTHING IN `npm run verify` REACHES THIS FILE
 *
 * `§8.5`: "Ordinary unit tests, integration tests, architecture verification, CI and normal
 * repository verification must make ZERO real SendGrid calls. A real provider call must
 * require explicit invocation."
 *
 * Three mechanisms, and the third is the one that holds when the first two are edited:
 *
 *   1. this file is not a vitest test file and matches no pattern in `vitest.config.ts`;
 *   2. `tests/sendgrid/prerequisites-and-separation.test.ts` asserts that NO file under
 *      `tests/` imports `harness/cli.js`, `harness/scopeProbes.js`, `harness/probeRuntime.js`,
 *      either provider client, or the two adapter modules;
 *   3. **STAGE 1 OF THE PREFLIGHT REFUSES**, and it refuses from `NOTHING_ESTABLISHED` — so
 *      even an invocation with no arguments at all, from any caller, resolves no credential,
 *      starts no credential-holding process and performs no provider call.
 *
 * =================================================================================
 * CORRECTION 4 — THE ORDER OF OPERATIONS IS THE SAFETY PROPERTY
 *
 * The rejected `main` resolved BOTH vendor credentials and THEN evaluated the gate. `main`
 * below does the opposite, and the structure makes the inversion impossible to reintroduce
 * quietly: `establishStage1Facts` imports no secret source and calls no probe client, and the
 * ONLY call to `runCredentialProbe` in this file sits after an `if (stage1Failures.length > 0)`
 * that writes evidence and returns.
 *
 * =================================================================================
 * CORRECTION 5 — AND WHEN A CREDENTIAL IS NEEDED, A DIFFERENT PROCESS HOLDS IT
 *
 * This module imports NEITHER plane's secret source and NEITHER provider client. What it
 * imports is `probeClient.ts`, which forks a one-shot process with a seven-key constructed
 * environment carrying ONE locator. `tests/sendgrid/credential-process-isolation.test.ts`
 * computes this file's import closure and asserts that neither `createAdapterSecretSource`
 * nor `createAuditReadSecretSource` is reachable from it.
 *
 * =================================================================================
 * WHAT THIS CLI DOES ON A REPOSITORY WITH NO CREDENTIALS, WHICH IS TODAY
 *
 * Stage 1 refuses — on the non-production acknowledgement, on the class-5 records that do not
 * exist for a real SendGrid credential, on the control-plane composition this repository does
 * not ship, and on several more. It writes an evidence bundle recording every gate that
 * refused and exits non-zero. **THAT ARTIFACT IS NOT PROVIDER EVIDENCE**, and — after
 * correction 8 — it no longer says otherwise: `liveRunPerformed` is `false`, `probes` is
 * empty, `credentialsTouched` is `false`, every kill-point row is `NOT_RUN`, and the
 * production statement is DERIVED from those facts rather than asserted from a constant.
 * =================================================================================
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..', '..');

/** The env var carrying the TRUSTED, NON-SECRET S1P deployment configuration's path. */
export const ENV_CONFIG = 'ACOS_S1P_CONFIG';
/** The env var carrying the integration runtime's secret-document path. NOT a secret. */
export const ENV_INTEGRATION_LOCATOR = 'ACOS_S1P_INTEGRATION_LOCATOR';
/** The env var carrying the AUDIT runtime's secret-document path. A DIFFERENT document. */
export const ENV_AUDIT_LOCATOR = 'ACOS_S1P_AUDIT_LOCATOR';
/** `§7`'s EXPLICIT dedicated-non-production acknowledgement. */
export const ENV_NON_PRODUCTION_ACK = 'ACOS_S1P_NON_PRODUCTION_ACKNOWLEDGEMENT';
/** The ordinary live-run acknowledgement. */
export const ENV_LIVE_ACK = 'ACOS_S1P_LIVE_ACKNOWLEDGEMENT';
/** `§11`'s SECOND, separate acknowledgement for the duplicate negative control. */
export const ENV_DUPLICATE_ACK = 'ACOS_S1P_DUPLICATE_CONTROL_ACKNOWLEDGEMENT';
/** `§8.5`: the operator's declaration that the Email Activity entitlement was confirmed. */
export const ENV_ENTITLEMENT_CONFIRMED = 'ACOS_S1P_EMAIL_ACTIVITY_ENTITLEMENT_CONFIRMED';

/**
 * The acknowledgement values. Long, specific, and impossible to set by accident.
 *
 * A boolean would be `true`, which is a value a shell sets for a dozen unrelated reasons.
 * These sentences are ones an operator can only have typed after reading what they mean.
 */
export const LIVE_ACK_TOKEN = 'I_AUTHORISE_A_REAL_NON_PRODUCTION_SENDGRID_SEND';
export const DUPLICATE_ACK_TOKEN = 'I_AUTHORISE_AN_INTENTIONAL_DUPLICATE_SEND_TO_MY_OWN_SINK';
export const ENTITLEMENT_CONFIRMED_TOKEN = 'EMAIL_ACTIVITY_HISTORY_ENTITLEMENT_CONFIRMED';
/**
 * `§7` — THE SENTENCE THAT IS THE NON-PRODUCTION DECLARATION.
 *
 * It names all three things `§7` requires an operator to state, so the acknowledgement cannot
 * be read as covering only one of them: a dedicated non-production sending identity, an
 * owner-controlled sink, and no customer or production recipient. A parseable configuration
 * document is not this sentence, an environment label is not this sentence, and the sink
 * marker is not this sentence.
 */
export const NON_PRODUCTION_ACK_TOKEN =
  'THIS_IS_A_DEDICATED_NON_PRODUCTION_SENDGRID_IDENTITY_WITH_AN_OWNER_CONTROLLED_SINK_AND_NO_CUSTOMER_RECIPIENT';

/** The secret-source modules a probe process may be launched with. Launch configuration. */
export const INTEGRATION_SECRET_SOURCE_MODULE = join(
  REPO_ROOT,
  'validation',
  'sendgrid',
  'integration',
  'secretSource.ts',
);
export const AUDIT_SECRET_SOURCE_MODULE = join(
  REPO_ROOT,
  'validation',
  'sendgrid',
  'audit',
  'secretSource.ts',
);

/** The git commit the run was made from, or a declared absence. Never a guess. */
function gitCommit(): string {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    }).trim();
  } catch {
    return 'UNKNOWN — git rev-parse failed';
  }
}

/**
 * The ACTIVE verified bundle, or the ACCEPTED bootstrap, or a declared absence.
 *
 * `50 §3f` occasion 1 may already have run in this process, so the ACTIVE bundle is preferred
 * and a second bootstrap is attempted only when there is none. Re-bootstrapping over a live
 * authority would be reading the trust configuration twice and publishing the second answer,
 * which is a thing the harness has no business doing.
 */
function loadVerifiedBundle(): VerifiedControlArtifactBundle | null {
  try {
    if (kernelAuthorityReady()) return activeVerifiedControlArtifacts();
    return bootstrapControlArtifactAuthority();
  } catch {
    // The failure's detail is NOT read into the harness: `50 §3f` raises its own CRITICAL
    // incident, and a second rendering of it here would be a second, unreviewed channel.
    return null;
  }
}

/**
 * ESTABLISH STAGE-1 FACTS. **NO CREDENTIAL IS TOUCHED BY ANY LINE OF THIS FUNCTION.**
 *
 * It reads the trusted non-secret configuration, the verified control-artifact bundle and the
 * operator's acknowledgements. It imports no secret source, forks no process and opens no
 * socket, which is what makes `§4`'s stage split real rather than declared.
 */
export interface Stage1Options {
  /**
   * **A TEST SEAM, AND THE ONLY WAY THIS FACT CAN BE ASSERTED RATHER THAN MEASURED.**
   *
   * `tests/sendgrid/preflight.test.ts` drives the gate table over synthetic fact sets and
   * needs to say "suppose a composition existed". `main` NEVER passes it: it passes a
   * `composition` and takes the measurement.
   */
  readonly controlPlaneCompositionAvailable?: boolean;
  /** `§1.2` — the provider whose `describe` MEASURES whether a control plane can be built. */
  readonly composition?: ScenarioCompositionProvider;
  /**
   * The VERIFIED control-artifact bundle. Defaults to the ACTIVE one `50 §3f` published.
   *
   * **A SEAM FOR ONE REASON, AND IT IS NOT CONVENIENCE.** `§1.4`'s offline test needs a
   * signed package whose class-5 declaration carries the two validation credential records.
   * The shipped repository deliberately carries NEITHER — `docs/implementation/S1P-release-candidate.md`
   * records why a class-5 release cannot exist before the identities are material-bound — so
   * a test driving the orchestration end to end has to supply a package that does.
   *
   * It is still a VERIFIED bundle: `verifyFixtureBundle` runs the real `50 §3f` verification
   * over real signatures. What differs is the KEYS, exactly as every other control-artifact
   * test differs.
   */
  readonly bundle?: () => VerifiedControlArtifactBundle | null;
  /** The bound a live run would observe under. `§4.4`. Measured by `describe`, never assumed. */
  readonly visibilityBound?: VisibilityBound;
}

export function establishStage1Facts(
  environment: Readonly<Record<string, string | undefined>>,
  options: Stage1Options = {},
): {
  readonly facts: Stage1Facts;
  readonly config: S1PDeploymentConfig | null;
  /** WHY a composition is or is not available, in named blocks. `§1.2`. */
  readonly availability: CompositionAvailability;
  /**
   * The VERIFIED bundle this stage read, handed on so the composition uses the SAME bytes.
   *
   * Re-reading it downstream would mean `50 §3f`'s trust configuration was consulted twice
   * and the second answer published, which the loader above already refuses to do.
   */
  readonly bundle: VerifiedControlArtifactBundle | null;
} {
  const configuration = readDeploymentConfig(environment[ENV_CONFIG] ?? '');
  const config = configuration.kind === 'CONFIG' ? configuration.config : null;
  const bundle = (options.bundle ?? loadVerifiedBundle)();

  let integrationSignedRecordFound = false;
  let integrationSignedRecordAdapter: string | null = null;
  let integrationRiskClass: string | null = null;
  let auditSignedRecordFound = false;
  let auditSignedRecordAdapter: string | null = null;
  let auditSignedRecordProvider: string | null = null;
  let auditRiskClass: string | null = null;
  let adapterInSignedCatalogue = false;
  let signedActionClassAdapter: string | null = null;
  let signedActionClassMethod: string | null = null;

  /*
   * v1.3.8 — THE PROVIDER-EVIDENCE MODE, FROM THE VERIFIED CLASS-28 RECORD AND NOTHING ELSE.
   *
   * No flag, no environment variable, no configuration preference, no credential's presence
   * and no default selects it. `null` — no bundle, or no SendGrid channel in the record — is
   * its own stage-1 refusal, and every read-mode gate is still evaluated beside it.
   */
  const providerEvidenceMode: ProviderEvidenceMode | null =
    bundle === null ? null : verifiedEvidenceModeFor(bundle);
  const push = providerEvidenceMode === 'SIGNED_PROVIDER_PUSH';

  if (bundle !== null) {
    /*
     * CORRECTION 6 — THE RECORD IS **SELECTED BY IDENTITY**, NEVER FOUND BY SCANNING.
     *
     * The rejected harness iterated every signed class-5 record and kept whichever one it
     * encountered last with a matching adapter or provider. Here the configured identity is
     * the KEY into `declaration.credentials`, so a declaration carrying two records for one
     * adapter is not ambiguous and a declaration carrying none for the configured identity is
     * a refusal rather than a silent `null`.
     */
    const declaration = verifiedCredentialScopes(bundle);
    if (config !== null) {
      const integration = declaration.credentials[config.integrationCredentialId];
      if (integration !== undefined) {
        integrationSignedRecordFound = true;
        integrationSignedRecordAdapter = integration.adapter;
        integrationRiskClass = integration.credentialRiskClass;
      }
      /*
       * THE AUDIT-READ CLASS-5 RECORD IS LOOKED UP UNDER `PROVIDER_READ` ONLY. Under push no
       * SendGrid audit credential exists, so there is no record to select — and an identity
       * supplied anyway is refused by the preflight, not resolved here.
       */
      if (!push && config.auditCredentialId !== null) {
        const audit = declaration.credentials[config.auditCredentialId];
        if (audit !== undefined) {
          auditSignedRecordFound = true;
          auditSignedRecordAdapter = audit.adapter;
          auditSignedRecordProvider = audit.provider;
          auditRiskClass = audit.credentialRiskClass;
        }
      }
    }

    // `classesServedBy` reads the VERIFIED class-3 catalogue. An adapter no class routes to
    // is an adapter the catalogue does not name, and `createAdapterRuntimeRegistry` would
    // raise `ADAPTER_NOT_IN_CATALOGUE` for it.
    adapterInSignedCatalogue = classesServedBy(SENDGRID_ADAPTER_ID, bundle).length > 0;

    // CORRECTION 17's preflight half: the signed operation, read from the verified bytes.
    const catalogue = verifiedActionCatalogue(bundle);
    const entry = catalogue.entries[SENDGRID_ACTION_CLASS as keyof typeof catalogue.entries];
    if (entry !== undefined) {
      signedActionClassAdapter = entry.adapter;
      signedActionClassMethod = entry.method;
    }
  }

  /*
   * `§1.2` — **COMPOSITION AVAILABILITY IS MEASURED HERE, FROM THE SAME FACTS.**
   *
   * The rejected CLI passed a literal `false`. This calls the provider's own `describe`,
   * which probes an environment variable, several files on disk, the VERIFIED catalogue's
   * entries and the PRODUCTION constructor registry's membership — and names every absence.
   *
   * **NO CREDENTIAL IS TOUCHED BY IT.** `describeLiveComposition` opens no pool, forks
   * nothing and imports no secret source, which is what keeps it inside stage 1.
   */
  const visibilityBound = options.visibilityBound ?? LIVE_VISIBILITY_BOUND;
  const availability =
    config === null
      ? Object.freeze({
          available: false,
          blocks: Object.freeze([]),
          statement:
            'no deployment configuration was read, so there is nothing to compose a control ' +
            'plane for; the configuration gate below is the finding',
        })
      : (options.composition ?? createLiveScenarioComposition()).describe({
          environment,
          config,
          bundle,
          integrationLocator: environment[ENV_INTEGRATION_LOCATOR] ?? '',
          auditLocator: auditLocatorFor(environment, providerEvidenceMode),
          visibilityBound,
        });

  return {
    availability,
    bundle,
    facts: Object.freeze({
      ...NOTHING_ESTABLISHED,
      verifiedBundleAvailable: bundle !== null,
      providerId: SENDGRID_PROVIDER_ID,
      deploymentConfigurationRead: config !== null,
      /*
       * `§7` — THE DECLARATION IS THE OPERATOR'S SENTENCE AND NOTHING ELSE.
       *
       * The rejected harness computed this as `configuration.kind === 'CONFIG'`: a parseable
       * document was treated as evidence that the account was dedicated non-production.
       */
      nonProductionAcknowledged: environment[ENV_NON_PRODUCTION_ACK] === NON_PRODUCTION_ACK_TOKEN,
      environmentLabel: config?.environmentLabel ?? null,
      /*
       * ALWAYS `false`, AND NOT BECAUSE A DEFAULT SAYS SO.
       *
       * `buildSendGridSendRequest` is called by the adapter with a LITERAL `false`, so no
       * document and no variable can make this package emit a sandbox request. The fact is
       * carried into the preflight anyway, because `§8.5` requires the gate and a gate whose
       * operand is a constant is still a gate a future edit has to move deliberately.
       */
      sandboxModeRequested: false,
      configuredIntegrationCredentialId: config?.integrationCredentialId ?? null,
      configuredAuditCredentialId: config?.auditCredentialId ?? null,
      integrationSignedRecordFound,
      integrationSignedRecordAdapter,
      integrationRiskClass,
      auditSignedRecordFound,
      auditSignedRecordAdapter,
      auditSignedRecordProvider,
      auditRiskClass,
      adapterInSignedCatalogue,
      signedActionClassAdapter,
      signedActionClassMethod,
      /*
       * ONE integration runtime. ADR-024's option-B count trigger is two, and S1P configures
       * the SendGrid runtime and nothing else — the kill-point runtime is the SAME adapter
       * identity launched from a different module specifier, not a second runtime.
       */
      configuredAdapterRuntimeCount: 1,
      senderAddress: config?.senderAddress ?? null,
      sinkAddress: config?.sinkAddress ?? null,
      /*
       * `false` BY CONSTRUCTION. The recipient is bound into the AUTHORISED dispatch payload
       * by `validationAuthority.ts`, which refuses a sink that is not owner-controlled and
       * which no production route reaches — nothing under `src/` imports `validation/`.
       */
      recipientReachableFromProductionState: false,
      emailActivityEntitlementConfirmed:
        environment[ENV_ENTITLEMENT_CONFIRMED] === ENTITLEMENT_CONFIRMED_TOKEN,
      liveRunOptedIn: environment[ENV_LIVE_ACK] === LIVE_ACK_TOKEN,
      duplicateControlRequested: environment[ENV_DUPLICATE_ACK] !== undefined,
      duplicateControlOptedIn: environment[ENV_DUPLICATE_ACK] === DUPLICATE_ACK_TOKEN,
      /*
       * DERIVED FROM THE MEASUREMENT ABOVE, and overridable ONLY by the declared test seam.
       *
       * `??` rather than `||` so an explicit `false` from a test still means `false`.
       */
      controlPlaneCompositionAvailable:
        options.controlPlaneCompositionAvailable ?? availability.available,
      providerEvidenceMode,
      auditEvidenceStoreConfigured: (environment[ENV_AUDIT_PG_URL] ?? '').length > 0,
      /*
       * `50 §3` property 2 — THE AUDIT PLANE RECOMPUTES. Evaluated under push only, from the
       * audit plane's OWN trust configuration; it reads signed bytes and no credential.
       */
      auditPlaneEvidenceChannelAgrees:
        push && bundle !== null ? auditPlaneAgreesOnPushChannel(environment, bundle) : null,
      auditReadCredentialReferenceSupplied: (environment[ENV_AUDIT_LOCATOR] ?? '').length > 0,
    }),
    config,
  };
}

/**
 * The audit-READ locator a composition is given: the operator's under `PROVIDER_READ`, and
 * `null` — never an empty-string placeholder — under `SIGNED_PROVIDER_PUSH` or when absent.
 */
function auditLocatorFor(
  environment: Readonly<Record<string, string | undefined>>,
  mode: ProviderEvidenceMode | null,
): string | null {
  if (mode === 'SIGNED_PROVIDER_PUSH') return null;
  const locator = environment[ENV_AUDIT_LOCATOR] ?? '';
  return locator.length > 0 ? locator : null;
}

/**
 * ESTABLISH STAGE-2 FACTS, THROUGH **SEPARATE ONE-SHOT PROCESSES**.
 *
 * Two launches under `PROVIDER_READ`, two environments, one locator each. There is no
 * arrangement of this function's arguments that puts both locators in one process, because
 * `runCredentialProbe` takes ONE locator and `buildProbeEnvironment` has ONE slot for it.
 *
 * ONE launch under `SIGNED_PROVIDER_PUSH`: the integration credential's. No audit credential
 * process is started, because no SendGrid audit credential exists to resolve.
 */
export async function establishStage2Facts(
  environment: Readonly<Record<string, string | undefined>>,
  config: S1PDeploymentConfig,
  /** The launcher. `runCredentialProbe` FORKS; `§1.4`'s offline test substitutes it. */
  launch: typeof runCredentialProbe = runCredentialProbe,
  /** The VERIFIED mode from stage 1. Anything but push launches the full read-mode pair. */
  providerEvidenceMode: ProviderEvidenceMode | null = null,
): Promise<{
  readonly facts: Stage2Facts;
  readonly integration: CredentialIdentityFacts | null;
  readonly audit: CredentialIdentityFacts | null;
}> {
  const integrationReply = await launch({
    role: 'IDENTITY',
    plane: 'INTEGRATION',
    sourceModule: INTEGRATION_SECRET_SOURCE_MODULE,
    locator: environment[ENV_INTEGRATION_LOCATOR] ?? '',
    expectedCredentialId: config.integrationCredentialId,
  });
  /*
   * THE AUDIT IDENTITY PROCESS — `PROVIDER_READ` ONLY, AND ONLY WITH A CONFIGURED IDENTITY.
   *
   * Under push it is not launched at all. Under read mode a missing identity was already a
   * stage-1 refusal; were it reached anyway, no process is launched and the stage-2 gates read
   * the absent audit facts as the refusal they are.
   */
  const auditReply =
    providerEvidenceMode === 'SIGNED_PROVIDER_PUSH' || config.auditCredentialId === null
      ? null
      : await launch({
          role: 'IDENTITY',
          plane: 'AUDIT',
          sourceModule: AUDIT_SECRET_SOURCE_MODULE,
          locator: environment[ENV_AUDIT_LOCATOR] ?? '',
          expectedCredentialId: config.auditCredentialId,
        });

  const integration =
    integrationReply.kind === 'REPLY' && integrationReply.reply.kind === 'IDENTITY_FACTS'
      ? integrationReply.reply.facts
      : null;
  const audit =
    auditReply !== null &&
    auditReply.kind === 'REPLY' &&
    auditReply.reply.kind === 'IDENTITY_FACTS'
      ? auditReply.reply.facts
      : null;

  return {
    facts: Object.freeze({
      ...NO_CREDENTIAL_FACTS,
      integrationProbeAnswered: integration !== null,
      integrationCredentialResolved: integration?.resolved ?? false,
      integrationResolvedIdentity: integration?.resolvedIdentity ?? null,
      integrationIdentityProvenance: integration?.identityProvenance ?? null,
      auditProbeAnswered: audit !== null,
      auditCredentialResolved: audit?.resolved ?? false,
      auditResolvedIdentity: audit?.resolvedIdentity ?? null,
      auditIdentityProvenance: audit?.identityProvenance ?? null,
      /*
       * THE AZURE PRINCIPALS, AS EACH ISOLATED CHILD REPORTED ITS OWN.
       *
       * Carried straight through: this coordinator does not read either locator file and has
       * no way to derive these itself. `null` when a child did not answer, which the gates
       * read as an absence rather than as a match.
       */
      integrationSourcePrincipal: integration?.sourcePrincipalIdentity ?? null,
      auditSourcePrincipal: audit?.sourcePrincipalIdentity ?? null,
      configuredIntegrationCredentialId: config.integrationCredentialId,
      configuredAuditCredentialId: config.auditCredentialId,
      providerEvidenceMode,
    }),
    integration,
    audit,
  };
}

/**
 * `§11`, `§13` — THE DUPLICATE NEGATIVE CONTROL. **THE ONE DELIBERATE UNAUTHORISED PAIR.**
 *
 * =================================================================================
 * WHY A NEGATIVE CONTROL IS NEEDED AT ALL
 *
 * The six kill points all expect AT MOST one accepted message. If every one of them passes,
 * a reviewer has learned that the oracle reported "one" six times — which is also what an
 * oracle that can only ever say "one" would report. `§11` closes that: send a REAL pair to
 * the owner's own sink under one correlation, and require the SAME oracle to say TWO.
 *
 * =================================================================================
 * EVERY GUARD THAT SITS IN FRONT OF IT
 *
 *   - a SECOND operator acknowledgement, distinct from the live-run one and naming the
 *     duplicate explicitly;
 *   - a DEDICATED correlation tag, minted here, so the pair cannot contaminate any scenario
 *     row's provider-side count;
 *   - the owner-controlled sink from the configuration, never a customer address;
 *   - a one-shot credential process, so this coordinator never holds the send key;
 *   - `DUPLICATE_SEND_PROBE`, which `probeRuntime.ts` refuses on the AUDIT plane.
 *
 * It carries no `authorisation_ref` because ACOS authorised NEITHER send. That is the point:
 * it is an experiment on the ORACLE, not an effect, and it never touches the outbox.
 */
async function runDuplicateControl(input: {
  readonly probe: typeof runCredentialProbe;
  readonly config: S1PDeploymentConfig;
  readonly environment: Readonly<Record<string, string | undefined>>;
  readonly ports: OpenedPorts;
  readonly runtime: OpenedRuntime;
  readonly visibilityBound: VisibilityBound;
  /** Present under `SIGNED_PROVIDER_PUSH`: the oracle is the audit store, not a reader. */
  readonly signedPushEvidence: SignedPushEvidencePort | null;
}): Promise<{
  readonly observedAcceptedCount: number | null;
  readonly oracleDiscriminatedDuplicate: boolean | null;
  readonly reason: string;
}> {
  const correlationTag = mintCorrelationTag();
  const sent = await input.probe({
    role: 'DUPLICATE_SEND_PROBE',
    plane: 'INTEGRATION',
    sourceModule: INTEGRATION_SECRET_SOURCE_MODULE,
    locator: input.environment[ENV_INTEGRATION_LOCATOR] ?? '',
    expectedCredentialId: input.config.integrationCredentialId,
    operands: {
      correlationTag,
      senderAddress: input.config.senderAddress,
      sinkAddress: input.config.sinkAddress,
    },
  });
  if (sent.kind !== 'REPLY' || sent.reply.kind !== 'PROBE_RECORD') {
    return {
      observedAcceptedCount: null,
      oracleDiscriminatedDuplicate: null,
      reason: 'the duplicate-send probe process did not answer; no pair was sent and the ' +
        'oracle was not exercised',
    };
  }

  /*
   * AND NOW THE **SAME** ORACLE, unchanged, over the dedicated tag.
   *
   * `observeCorrelation` is the function every scenario row's count comes from. Running a
   * different counter here would prove nothing about the one that judges the matrix. Under
   * `SIGNED_PROVIDER_PUSH` that oracle is `observePushCorrelation` over the audit store, which
   * the scenario rows use, and no audit reader is launched.
   */
  if (input.signedPushEvidence !== null) {
    const window = input.ports.observationWindow();
    const observation = await observePushCorrelation(
      { port: input.signedPushEvidence, delay: input.ports.delay, now: input.ports.nowMs },
      {
        correlationTag,
        periodStartMs: window.periodStartMs,
        periodEndMs: window.periodEndMs,
        maxAttempts: input.ports.observationBound.maxAttempts,
        intervalMs: input.ports.observationBound.intervalMs,
        maxDurationMs: input.ports.observationBound.maxDurationMs,
        stabilisationObservations: input.ports.observationBound.stabilisationObservations,
        visibilityBound: input.visibilityBound,
        lastPossibleWriteAtMs: input.ports.nowMs(),
      },
    );
    return duplicateControlFinding(observation.providerAcceptedCount, observation.outcome);
  }
  const reader = await input.ports.launchAuditReader(auditDescriptorFor(input.runtime));
  try {
    const deps: ObservationDeps = {
      read: (query) => reader.read(query),
      delay: input.ports.delay,
      now: input.ports.nowMs,
    };
    const window = input.ports.observationWindow();
    const observation = await observeCorrelation(deps, {
      correlationTag,
      periodStartMs: window.periodStartMs,
      periodEndMs: window.periodEndMs,
      ...input.ports.observationBound,
      visibilityBound: input.visibilityBound,
      // The last possible write is the pair that has just been sent.
      lastPossibleWriteAtMs: input.ports.nowMs(),
    });
    return duplicateControlFinding(observation.providerAcceptedCount, observation.outcome);
  } finally {
    await reader.close();
  }
}

function duplicateControlFinding(
  count: number | null,
  outcome: string,
): {
  readonly observedAcceptedCount: number | null;
  readonly oracleDiscriminatedDuplicate: boolean | null;
  readonly reason: string;
} {
  return {
    observedAcceptedCount: count,
    /*
     * `null`, NOT `false`, WHEN THE COUNT WAS NEVER ESTABLISHED.
     *
     * An oracle that could not finish its window has not FAILED to discriminate; it has
     * not been asked. Reporting `false` there would be the same conflation correction 9
     * removed from the read path.
     */
    oracleDiscriminatedDuplicate: count === null ? null : count >= 2,
    reason:
      count === null
        ? `the pair was sent, and the oracle did not establish a count (${outcome})`
        : `the pair was sent and the oracle reported ${String(count)} accepted message(s)`,
  };
}

/*
 * =====================================================================================
 * `§13` — THE THREE INVARIANT CONCLUSIONS, EACH DERIVED FROM THE RUN.
 *
 * Every one of these can return a "NO CHANGE" sentence, and none of them returns it by
 * default: the run state selects it. That is the difference the second review is testing for.
 * A bundle that says `I8` was discharged is a bundle whose sweep actually returned
 * `ALL_PROVIDER_RECORDS_ACCOUNTED` over a result the provider SIGNALLED complete.
 * =====================================================================================
 */

/** Exported for the evidence-text regression test; `main` is its only production caller. */
export function i8Conclusion(
  sweep: InverseSweepResult | null,
  block: string | null,
  mode: ProviderEvidenceMode | null = null,
): string {
  if (sweep !== null && mode === 'SIGNED_PROVIDER_PUSH') {
    /*
     * PUSH: the inverse observation is the audit store's, over the receipt interval. A positive
     * finding stands; nothing else is ever a clean period (ADR-027 decision 6). Each sentence is
     * ONE template literal, so the statement is interpolated by construction.
     */
    if (sweep.outcome === 'UNACCOUNTED_PROVIDER_RECORDS') {
      const count = String(sweep.unaccounted.length);
      return `**VIOLATED.** ${count} authenticated accepted event(s) in the receipt interval are not accounted for by any ACOS correlation. ${sweep.statement}`;
    }
    return `NOT DISCHARGED. Signed push evidence carries no completeness signal, so a period in which nothing unaccounted was seen is INCOMPLETE, not clean. ${sweep.statement}`;
  }
  if (sweep === null) {
    return (
      'NO CHANGE. No vendor-side sweep was performed and no provider read occurred' +
      (block === null ? '' : `: ${block}`) +
      '. See docs/implementation/S1P-result.md for the located definition and for why a ' +
      'known-correlation query would not discharge it.'
    );
  }
  switch (sweep.outcome) {
    case 'ALL_PROVIDER_RECORDS_ACCOUNTED':
      return (
        'DISCHARGED FOR THE SWEPT PERIOD. Every record the provider returned was accounted ' +
        `for by an ACOS correlation, over a result the provider SIGNALLED complete. ${sweep.statement}`
      );
    case 'UNACCOUNTED_PROVIDER_RECORDS':
      return (
        `**VIOLATED.** ${String(sweep.unaccounted.length)} provider record(s) in the swept ` +
        `period are not accounted for by any ACOS correlation. ${sweep.statement}`
      );
    case 'SWEEP_INCOMPLETE':
      /*
       * DEFECT 3'S OWN OUTCOME, AND THE ONE SENDGRID PRODUCES TODAY.
       *
       * Positive findings survive an incomplete sweep — an unaccounted record is one whether
       * or not the rest of the page set was readable — but a CLEAN verdict does not.
       */
      return (
        'NOT DISCHARGED. The sweep found no unaccounted record, and it did not cover a ' +
        `result the provider established as complete, so absence proves nothing. ${sweep.statement} ` +
        `Completeness basis: ${SENDGRID_COMPLETENESS_BASIS}`
      );
    case 'SWEEP_UNAVAILABLE':
      return `NOT EVALUATED. No page of the provider's period result was readable. ${sweep.statement}`;
  }
}

function i20Conclusion(comparison: I20Comparison | null, block: string | null): string {
  if (comparison === null) {
    return (
      'NO CHANGE on the provider side. The local comparison machinery exists and is proved ' +
      'offline (validation/sendgrid/harness/i20.ts); no scenario was staged' +
      (block === null ? '' : `: ${block}`) +
      ', so the invariant has no provider-side numerator and is not evaluated.'
    );
  }
  return comparison.statement;
}

function i36Conclusion(
  rows: readonly KillPointEvidence[],
  duplicateControl: { readonly oracleDiscriminatedDuplicate: boolean | null } | null,
  bound: VisibilityBound,
  block: string | null,
): string {
  if (rows.length === 0) {
    return (
      'NO CHANGE. The local composition leg remains proved by the ACCEPTED mock kill matrix; ' +
      'the verification leg needs a provider accepted count and none was measured' +
      (block === null ? '' : `: ${block}`) +
      '. The six-scenario driver and its stabilising provider-count oracle exist and are ' +
      'exercised offline, which is machinery rather than evidence.'
    );
  }
  const failed = rows.filter((row) => row.verdict === 'FAIL').length;
  const unresolved = rows.filter((row) => row.verdict === 'UNRESOLVED').length;
  const passed = rows.filter((row) => row.verdict === 'PASS').length;
  if (failed > 0) {
    return (
      `**VIOLATED.** ${String(failed)} of ${String(rows.length)} canonical kill points ` +
      'produced a provider-side count the invariant forbids.'
    );
  }
  if (unresolved > 0) {
    return (
      `NOT DISCHARGED. ${String(passed)} of ${String(rows.length)} rows passed and ` +
      `${String(unresolved)} could not be resolved, so the matrix is incomplete. Observation ` +
      `mode: ${observationModeLabel(bound)}`
    );
  }
  /*
   * AND EVEN A CLEAN SWEEP OF THE MATRIX IS QUALIFIED BY THE NEGATIVE CONTROL.
   *
   * `§11`: six rows all reporting "at most one" is also what an oracle that can only say
   * "one" reports. Without the duplicate control having shown the SAME oracle saying TWO,
   * the matrix's agreement is not yet discriminating evidence.
   */
  if (duplicateControl?.oracleDiscriminatedDuplicate !== true) {
    return (
      `ALL ${String(rows.length)} canonical kill points passed, and the duplicate negative ` +
      'control did not demonstrate that the same oracle reports TWO for a real pair, so the ' +
      'matrix is not yet discriminating. Observation mode: ' +
      observationModeLabel(bound)
    );
  }
  return (
    `DISCHARGED FOR THIS PROVIDER AND PERIOD. All ${String(rows.length)} canonical kill ` +
    'points passed, and the duplicate negative control showed the same oracle reporting a ' +
    `count of two for a deliberate pair. Observation mode: ${observationModeLabel(bound)}`
  );
}

/** Whether the VERIFIED class-28 mode stage 1 read is `SIGNED_PROVIDER_PUSH`. */
function pushMode(stage1: Stage1Facts): boolean {
  return stage1.providerEvidenceMode === 'SIGNED_PROVIDER_PUSH';
}

/**
 * v1.3.8 — THE BUNDLE'S MODE-DISCRIMINATED PROVIDER-EVIDENCE SECTION.
 *
 * Under push every SendGrid audit-read item is the literal `NOT_APPLICABLE`. Nothing is
 * manufactured: no audit identity, principal, send refusal, entitlement, Email Activity read
 * or provider-read sweep is reported for a mode in which none exists.
 */
function providerEvidenceSectionFor(stage1: Stage1Facts): ProviderEvidenceSection {
  switch (stage1.providerEvidenceMode) {
    case 'SIGNED_PROVIDER_PUSH':
      return Object.freeze({
        mode: 'SIGNED_PROVIDER_PUSH' as const,
        evidenceSource: 'AUDIT_STORE_AUTHENTICATED_PUSH' as const,
        auditReadCredential: NOT_APPLICABLE,
        auditPrincipal: NOT_APPLICABLE,
        auditKeySendRefusal: NOT_APPLICABLE,
        emailActivityEntitlement: NOT_APPLICABLE,
        emailActivityRead: NOT_APPLICABLE,
        providerReadInverseSweep: NOT_APPLICABLE,
        inverseObservation: 'AUDIT_STORE_PUSH_INVERSE_OBSERVATION' as const,
        completenessBasis: 'UNESTABLISHED' as const,
        openEmpiricalObligations: SIGNED_PUSH_OPEN_EMPIRICAL_OBLIGATIONS,
      });
    case 'PROVIDER_READ':
      return Object.freeze({
        mode: 'PROVIDER_READ' as const,
        evidenceSource: 'PROVIDER_EMAIL_ACTIVITY_READ' as const,
        auditReadCredential: 'REQUIRED' as const,
        emailActivityEntitlement: stage1.emailActivityEntitlementConfirmed
          ? ('OPERATOR_CONFIRMED' as const)
          : ('NOT_CONFIRMED' as const),
        inverseSweep: 'PROVIDER_READ_SWEEP' as const,
      });
    case null:
      return Object.freeze({
        mode: 'UNDECLARED' as const,
        statement:
          'no verified class-28 record named an evidence channel for the provider, so no ' +
          'provider-evidence requirement was selected and the preflight refused',
      });
  }
}

/** Where a run's evidence lands. Under `artifacts/`, beside the deployment's own bytes. */
export const EVIDENCE_DIRECTORY = join(REPO_ROOT, 'artifacts', 's1p-validation');

/**
 * `§1.4` — THE SEAM THE OFFLINE TEST DRIVES THE **REAL** ORCHESTRATION THROUGH.
 *
 * The second review is explicit: "Do not satisfy this by testing `scenarioDriver.ts`
 * separately again. The test subject must be the orchestration that the real CLI uses."
 *
 * So the sequencing below — which gate blocks which step, when the composition opens, when
 * the matrix runs, when `I20` and `I8` are computed, how the evidence is derived from what
 * actually happened — lives in `main` and NOWHERE ELSE, and the offline test calls `main`.
 * What it substitutes is the two things that would otherwise reach a real account: the
 * COMPOSITION and the CREDENTIAL PROBE LAUNCHER. Everything between them is the shipped path.
 */
export interface S1PHarnessSeams {
  /** The scenario composition. Defaults to the LIVE one. */
  readonly composition?: ScenarioCompositionProvider;
  /**
   * The one-shot credential-probe launcher. Defaults to `runCredentialProbe`, which FORKS.
   *
   * Substituting it is what lets an offline run exercise `§12`'s probe gating without a
   * vendor credential — and `establishStage2Facts` takes it too, so the offline run cannot
   * pass the probe gate while the identity gate is stubbed differently.
   */
  readonly probe?: typeof runCredentialProbe;
  /** The provider visibility bound. Defaults to `SENDGRID_LIVE_VISIBILITY_BOUND`. `§4.4`. */
  readonly visibilityBound?: VisibilityBound;
  /** The verified bundle. See `Stage1Options.bundle` for the one reason this is a seam. */
  readonly bundle?: () => VerifiedControlArtifactBundle | null;
  /** Where evidence is written. Defaults to `EVIDENCE_DIRECTORY`. */
  readonly evidenceDirectory?: string;
}

export async function main(
  environment: Readonly<Record<string, string | undefined>> = process.env,
  seams: S1PHarnessSeams = {},
): Promise<number> {
  const startedAt = new Date().toISOString();
  const runId = `s1p-${startedAt.replace(/[:.]/g, '-')}`;

  const composition = seams.composition ?? createLiveScenarioComposition();
  const probe = seams.probe ?? runCredentialProbe;
  const visibilityBound = seams.visibilityBound ?? LIVE_VISIBILITY_BOUND;

  /*
   * STAGE 1. NO CREDENTIAL IS TOUCHED ABOVE THIS LINE OR BY THIS CALL.
   *
   * `controlPlaneCompositionAvailable` is no longer a literal: `establishStage1Facts` asks
   * the composition provider to MEASURE it, and `availability.blocks` names every absence so
   * an operator reads a list instead of inferring one. `§1.2`.
   */
  const {
    facts: stage1,
    config,
    availability,
    bundle: verifiedBundle,
  } = establishStage1Facts(environment, {
    composition,
    visibilityBound,
    ...(seams.bundle === undefined ? {} : { bundle: seams.bundle }),
  });
  const stage1Failures = evaluateStage1(stage1);

  let stage2Failures: readonly string[] = [];
  let credentialsTouched = false;
  let integrationIdentity: string | null = null;
  let auditIdentity: string | null = null;
  let integrationMatched = false;
  let auditMatched: boolean | null = pushMode(stage1) ? null : false;

  if (stage1Failures.length === 0 && config !== null) {
    /*
     * STAGE 2. THE ONLY PLACE IN THIS FILE WHERE A CREDENTIAL-HOLDING PROCESS IS STARTED, AND
     * IT IS UNREACHABLE UNTIL EVERY CHEAP GATE HAS PASSED.
     */
    credentialsTouched = true;
    const stage2 = await establishStage2Facts(
      environment,
      config,
      probe,
      stage1.providerEvidenceMode,
    );
    stage2Failures = evaluateStage2(stage2.facts);
    integrationIdentity = stage2.facts.integrationResolvedIdentity;
    auditIdentity = stage2.facts.auditResolvedIdentity;
    integrationMatched = stage2.integration?.identityMatchedExpectation ?? false;
    // `null` under push: there is no audit record to have matched, and `false` would say there was.
    auditMatched = pushMode(stage1) ? null : (stage2.audit?.identityMatchedExpectation ?? false);
  }

  /*
   * THE ONE BRANCH THAT WOULD REACH A PROVIDER, AND IT IS GUARDED BY TWO EMPTY LISTS.
   *
   * `§6`: "Before the first live provider call, verify every safety gate in this prompt. If
   * any prerequisite is uncertain, do not send." A gate the harness could not evaluate arrives
   * as a failure, so uncertainty and refusal are the same path.
   *
   * S1P ships with this branch UNREACHED on every machine this repository has run on, and the
   * evidence bundle below is what says so rather than a comment.
   */
  let probes: readonly ProbeRecord[] = Object.freeze([]);
  let auditKeySendRefusal: ProbeRecord | null = null;
  let probeBlocks: readonly ProbeBlock[] = Object.freeze([]);

  /*
   * EVERYTHING THE SCENARIO MATRIX WOULD PRODUCE, DECLARED EMPTY.
   *
   * Correction 8's rule, carried forward: the evidence below is DERIVED from these, so a run
   * that executed nothing cannot report otherwise. `liveRunPerformed` in particular is
   * computed from the provider operations the scenarios actually performed.
   */
  let killPoints: readonly KillPointEvidence[] = Object.freeze([]);
  let i20: I20Comparison | null = null;
  let sweep: InverseSweepResult | null = null;
  let providerOperationCount = 0;
  let scenarioBlock: string | null = null;
  let duplicateControlRun: {
    readonly observedAcceptedCount: number | null;
    readonly oracleDiscriminatedDuplicate: boolean | null;
    readonly reason: string;
  } | null = null;

  if (stage1Failures.length === 0 && stage2Failures.length === 0 && config !== null) {
    /*
     * `§12` — THE CAPABILITY PROBES, AFTER EVERY PREREQUISITE GATE AND THE LIVE
     * ACKNOWLEDGEMENT, AND NEVER BEFORE.
     *
     * Three one-shot processes, one credential each. The fourth item `§12` names — the
     * INTEGRATION credential performing a PERMITTED non-production send — is what the scenario
     * driver does through the accepted gateway and the accepted runtime; a second send from
     * here would be a message ACOS did not authorise.
     *
     * `probeBlocks` is non-empty when an observed capability disagrees with the signed class-5
     * declaration, or when a probe could not ask the provider. Either BLOCKS the scenario
     * matrix: `§12`, "A provider-unreachable/inconclusive probe does NOT pass."
     */
    /*
     * v1.3.8 — UNDER `SIGNED_PROVIDER_PUSH` NO CAPABILITY PROBE IS LAUNCHED.
     *
     * Two of the three are audit-credential probes and there is no audit credential; the
     * third reads `/v3/messages` and would be confounded by the absent entitlement.
     * `SIGNED_PUSH_OPEN_EMPIRICAL_OBLIGATIONS` states what that leaves open, in the bundle.
     */
    if (!pushMode(stage1)) {
      if (config.auditCredentialId === null) {
        // Unreachable: stage 1 refuses a read-mode run with no audit identity. Fail closed.
        probeBlocks = Object.freeze(['PROBE_PROCESS_FAILED' as const]);
      } else {
        const measured = await orchestrateCapabilityProbes(probe, {
          integrationSourceModule: INTEGRATION_SECRET_SOURCE_MODULE,
          integrationLocator: environment[ENV_INTEGRATION_LOCATOR] ?? '',
          integrationCredentialId: config.integrationCredentialId,
          auditSourceModule: AUDIT_SECRET_SOURCE_MODULE,
          auditLocator: environment[ENV_AUDIT_LOCATOR] ?? '',
          auditCredentialId: config.auditCredentialId,
          senderAddress: config.senderAddress,
          sinkAddress: config.sinkAddress,
          // A DEDICATED correlation, so the `36 §13` attempted write cannot contaminate a
          // scenario's provider-side count even in the failure case where it is accepted.
          probeCorrelationTag: mintCorrelationTag(),
          periodStartMs: Date.now() - 60 * 60 * 1000,
          periodEndMs: Date.now(),
        });
        probes = measured.probes;
        auditKeySendRefusal = measured.auditKeySendRefusal;
        probeBlocks = measured.blocks;
      }
    }

    /*
     * =============================================================================
     * `§1.3` — THE LIVE SEQUENCE. THIS IS THE PART THAT DID NOT EXIST.
     *
     * Order, and what each step may not skip:
     *
     *   1  `§12`'s probe findings BLOCK the matrix. A credential whose observed capability
     *      disagrees with its signed class-5 declaration, or a probe that could not ask,
     *      means no row may be measured. Checked FIRST, so a blocked run never opens a
     *      composition and never reaches a provider through the scenarios.
     *   2  composition availability, measured in stage 1, blocks it second.
     *   3  the matrix runs through `runAllScenarios` — the SAME entry point the offline
     *      driver test drives, with a composition supplied from outside.
     *   4  `I20` is computed from the operands the scenarios produced.
     *   5  `I8`'s inverse sweep runs over the SAME period, through the independent audit
     *      reader, and reports its own completeness honestly.
     *   6  `§11`'s duplicate control runs only behind its SECOND acknowledgement.
     *
     * The permitted send `§1.3` asks for is step 3's kill point 1: the scenario driver's
     * first row dispatches the authorised effect through the gateway and the durable outbox.
     * A separate send from here would be a message ACOS did not authorise.
     * =============================================================================
     */
    if (probeBlocks.length > 0) {
      scenarioBlock =
        `${String(probeBlocks.length)} capability-probe finding(s) BLOCK the scenario ` +
        `matrix: ${probeBlocks.join(', ')}`;
    } else if (!availability.available) {
      scenarioBlock = availability.statement;
    } else {
      const opened = await composition.open({
        environment,
        config,
        bundle: verifiedBundle,
        integrationLocator: environment[ENV_INTEGRATION_LOCATOR] ?? '',
        auditLocator: auditLocatorFor(environment, stage1.providerEvidenceMode),
        visibilityBound,
      });
      try {
        /*
         * THE OPENED COMPOSITION MUST AGREE WITH THE VERIFIED MODE, BEFORE ANY ROW RUNS.
         *
         * A push run whose composition supplied no audit-store port has no oracle, and does NOT
         * fall back to a provider read; a read run whose composition supplied one would have its
         * oracle chosen by a port's presence rather than by class 28. Either refuses.
         */
        const pushEvidence = opened.ports.signedPushEvidence ?? null;
        if (pushMode(stage1) !== (pushEvidence !== null)) {
          throw new Error(
            'the opened composition evidence port disagrees with the verified class-28 mode ' +
              `(${stage1.providerEvidenceMode ?? 'UNDECLARED'}); no scenario was run`,
          );
        }

        // 3 — THE SIX CANONICAL KILL POINTS.
        const results: readonly ScenarioResult[] = await runAllScenarios(
          opened.runtime,
          opened.ports,
        );
        killPoints = Object.freeze(results.map((result) => result.row));
        providerOperationCount = results.reduce(
          (total, result) => total + result.providerOperationCount,
          0,
        );

        // 4 — `I20`, FROM THE OPERANDS THE SCENARIOS MEASURED.
        i20 = compareI20(results.map((result) => result.i20Operand));

        // 5 — `I8`'s INVERSE SWEEP, over the same period, through the INDEPENDENT reader.
        const window = opened.ports.observationWindow();
        const accounted = new Set(
          results
            .map((result) => result.row.correlationTag)
            .filter((tag): tag is string => tag.length > 0),
        );
        if (pushEvidence !== null) {
          /*
           * `I8` UNDER PUSH — the audit store's bounded inverse observation. No reader is
           * launched and `/v3/messages` is not read. A quiet interval is `SWEEP_INCOMPLETE`.
           */
          sweep = await runPushInverseObservation(pushEvidence, {
            periodStartMs: window.periodStartMs,
            periodEndMs: window.periodEndMs,
            accountedCorrelationTags: accounted,
          });
        } else {
          const sweepReader = await opened.ports.launchAuditReader(auditDescriptorFor(opened.runtime));
          try {
            sweep = await runInverseSweep(
              async (page): Promise<ActivityPage | { readonly kind: 'PROVIDER_UNAVAILABLE' }> => {
                /*
                 * ONE PERIOD-BOUNDED READ, AND AN HONEST COMPLETENESS SIGNAL.
                 *
                 * `correlationTag: null` is the INVERSE direction — everything the account
                 * accepted in the period, not just what ACOS asked about. The audit IPC carries
                 * NO cursor, so `nextCursor` is `null` and the completeness signal is the
                 * recorded `SENDGRID_ACTIVITY_COMPLETENESS`, which is `UNESTABLISHED`.
                 *
                 * `§3.2`, and this is the whole of defect 3: a truncated result cannot be
                 * reported as a complete sweep, so `runInverseSweep` will conclude
                 * `SWEEP_INCOMPLETE` rather than `ALL_PROVIDER_RECORDS_ACCOUNTED`.
                 */
                const outcome = await sweepReader.read({
                  operation: 'MESSAGE_ACTIVITY_SEARCH',
                  correlationTag: null,
                  periodStartMs: page.periodStartMs,
                  periodEndMs: page.periodEndMs,
                  maxRecords: page.maxRecords,
                });
                if (outcome.kind === 'PROVIDER_UNAVAILABLE') {
                  return { kind: 'PROVIDER_UNAVAILABLE' as const };
                }
                return {
                  records: outcome.records,
                  completeness: SENDGRID_ACTIVITY_COMPLETENESS,
                  nextCursor: null,
                };
              },
              {
                periodStartMs: window.periodStartMs,
                periodEndMs: window.periodEndMs,
                // THE DECLARED CEILINGS, for the reason the observation bound uses its own:
                // a second set of figures here would be a second, unreviewed policy.
                maxRecordsPerPage: LIVE_ACTIVITY_PAGE_RECORDS,
                maxPages: MAX_SWEEP_PAGES,
                maxTotalRecords: MAX_SWEEP_RECORDS,
                accountedCorrelationTags: accounted,
              },
            );
          } finally {
            await sweepReader.close();
          }
        }

        // 6 — `§11`'s DUPLICATE NEGATIVE CONTROL, behind its OWN acknowledgement.
        if (stage1.duplicateControlOptedIn) {
          duplicateControlRun = await runDuplicateControl({
            probe,
            config,
            environment,
            ports: opened.ports,
            runtime: opened.runtime,
            // The composition's own bound: under push it is the UNESTABLISHED push bound.
            visibilityBound: opened.ports.visibilityBound,
            signedPushEvidence: pushEvidence,
          });
        }
      } finally {
        await opened.close();
      }
    }
  }

  /*
   * CORRECTION 8 — **`liveRunPerformed` IS A MEASUREMENT.**
   *
   * A run performed a live provider interaction exactly when it performed a provider
   * OPERATION. Not when it was authorised to, not when its gates passed, and not when a
   * constant here says so.
   */
  const liveRunPerformed = providerOperationCount > 0;

  const failures = [...stage1Failures, ...stage2Failures];

  const bundle: EvidenceBundle = {
    schema: 'acos.s1p.sendgrid-validation-evidence.v2',
    operatingSpine: 'Operating Spine v1.3',
    packageIssue: 'v1.3.8',
    gitCommit: gitCommit(),
    validationRunId: runId,
    startedAtUtc: startedAt,
    finishedAtUtc: new Date().toISOString(),
    environmentLabel: stage1.environmentLabel,
    providerId: stage1.providerId,
    providerEvidenceMode: stage1.providerEvidenceMode,
    providerEvidence: providerEvidenceSectionFor(stage1),
    integrationCredentialIdentity: integrationIdentity,
    auditCredentialIdentity: auditIdentity,
    integrationIdentityMatchedSignedRecord: integrationMatched,
    auditIdentityMatchedSignedRecord: auditMatched,
    senderRedacted: stage1.senderAddress === null ? null : redactAddress(stage1.senderAddress),
    sinkRedacted: stage1.sinkAddress === null ? null : redactAddress(stage1.sinkAddress),
    stage1Failures,
    stage2Failures: stage2Failures as EvidenceBundle['stage2Failures'],
    preflightFailures: failures as EvidenceBundle['preflightFailures'],
    credentialsTouched,
    liveRunPerformed,
    providerOperationCount,
    probes,
    auditKeySendRefusal,
    // `§4.4` — WHICH SETTLING REGIME PRODUCED THE COUNTS ABOVE, IN WORDS AND AS A TOKEN.
    observationMode: observationModeLabel(visibilityBound),
    visibilityBoundKind: visibilityBound.kind,
    killPoints,
    duplicateControl:
      duplicateControlRun === null
        ? Object.freeze({
            status: 'NOT_RUN' as const,
            reason:
              failures.length > 0
                ? 'the preflight refused, so no send of any kind was attempted'
                : scenarioBlock !== null
                  ? `the scenario matrix did not execute: ${scenarioBlock}`
                  : stage1.duplicateControlRequested
                    ? 'requested, and the second acknowledgement did not match'
                    : 'not requested',
            observedAcceptedCount: null,
            oracleDiscriminatedDuplicate: null,
          })
        : Object.freeze({
            status: 'RUN' as const,
            reason: duplicateControlRun.reason,
            observedAcceptedCount: duplicateControlRun.observedAcceptedCount,
            oracleDiscriminatedDuplicate: duplicateControlRun.oracleDiscriminatedDuplicate,
          }),
    /*
     * `§14` — THE COMPARISON THE SCENARIOS PRODUCED, or `null` when none ran.
     *
     * `compareI20([])` returns UNRESOLVED and says why, which is what a run that STAGED
     * scenarios and measured none reports. A run that staged NONE AT ALL has no comparison
     * to report, and the difference between those two is evidence.
     */
    i20,
    /*
     * `§13` — **DERIVED FROM WHAT THIS RUN ACTUALLY DID.**
     *
     * Correction 8's rule extended to the invariants: each sentence is chosen by the run
     * state, so a bundle cannot carry a conclusion the run did not reach. The `NO CHANGE`
     * texts are what a run that measured nothing reports, and they are NOT the default a
     * measuring run would have to overwrite.
     */
    invariantConclusions: Object.freeze({
      i8: i8Conclusion(sweep, scenarioBlock, stage1.providerEvidenceMode),
      i20: i20Conclusion(i20, scenarioBlock),
      i36: i36Conclusion(killPoints, duplicateControlRun, visibilityBound, scenarioBlock),
    }),
    unresolvedObservations: [
      ...failures.map((gate) => `preflight gate ${gate} refused; the live run did not proceed`),
      ...probeBlocks.map(
        (block) =>
          `capability probe finding ${block} BLOCKS the scenario matrix; no row may be ` +
          'measured with a credential whose observed capability disagrees with its signed ' +
          'class-5 declaration',
      ),
      // `§1.2` — every NAMED reason a live control plane could not be composed.
      ...availability.blocks.map(
        (block) =>
          `composition prerequisite ${block} is absent; the scenario matrix cannot execute ` +
          'without it',
      ),
      // Every row the matrix could not resolve, with the oracle's own note.
      ...killPoints
        .filter((row) => row.verdict === 'UNRESOLVED')
        .map((row) => `kill point ${String(row.point)} UNRESOLVED: ${row.note}`),
    ],
    conclusionLimits: KILL_POINT_CONCLUSION_LIMITS,
    i17bStatus: I17B_STATUS,
    /*
     * CORRECTION 8 — DERIVED FROM RUN STATE, NEVER A CONSTANT.
     *
     * On this run `liveRunPerformed` is `false`, so the statement says what did NOT happen and
     * makes no claim that any environment, sender or sink was exercised.
     */
    productionStatement: productionStatementFor({
      liveRunPerformed,
      nonProductionAcknowledged: stage1.nonProductionAcknowledged,
      refusedGateCount: failures.length,
      senderRedacted: stage1.senderAddress === null ? null : redactAddress(stage1.senderAddress),
      sinkRedacted: stage1.sinkAddress === null ? null : redactAddress(stage1.sinkAddress),
      providerOperationCount,
    }),
  };

  const rendered = renderEvidenceBundle(bundle);
  const evidenceDirectory = seams.evidenceDirectory ?? EVIDENCE_DIRECTORY;
  mkdirSync(evidenceDirectory, { recursive: true });
  const path = join(evidenceDirectory, `${runId}.json`);
  writeFileSync(path, `${rendered}\n`, 'utf8');

  process.stdout.write('ACOS S1P — Twilio SendGrid non-production provider validation\n');
  process.stdout.write(`run: ${runId}\n`);
  process.stdout.write(`evidence: ${path}\n`);
  process.stdout.write(`local digest: ${bundleDigest(rendered)}\n`);
  process.stdout.write(
    `credential sources touched by this run: ${credentialsTouched ? 'YES' : 'NO'}\n`,
  );
  process.stdout.write(
    `provider operations performed by this run: ${String(providerOperationCount)}\n`,
  );
  process.stdout.write(`observation mode: ${observationModeLabel(visibilityBound)}\n`);
  process.stdout.write(
    `provider evidence mode: ${stage1.providerEvidenceMode ?? 'UNDECLARED (refused)'}\n`,
  );

  if (failures.length === 0) {
    /*
     * THE PREFLIGHT PASSED. WHETHER THE MATRIX RAN IS A SEPARATE QUESTION, AND IS REPORTED
     * SEPARATELY.
     *
     * Exit 2 — "gates clear, nothing measured" — is now reached only when a NAMED block
     * stopped the matrix, and the block is printed. Exit 0 means six rows were judged.
     */
    if (scenarioBlock !== null) {
      process.stdout.write('PREFLIGHT PASSED; THE SCENARIO MATRIX DID NOT EXECUTE.\n');
      process.stdout.write(`  ${scenarioBlock}\n`);
      for (const block of availability.blocks) process.stdout.write(`    - ${block}\n`);
      process.stdout.write('See docs/implementation/S1P-operator-procedure.md.\n');
      return 2;
    }
    process.stdout.write(
      `SCENARIO MATRIX EXECUTED — ${String(killPoints.length)} canonical row(s):\n`,
    );
    for (const row of killPoints) {
      process.stdout.write(
        `  point ${String(row.point)} ${row.verdict} — ${row.killPointName}\n`,
      );
    }
    const failedRows = killPoints.filter((row) => row.verdict === 'FAIL').length;
    const unresolvedRows = killPoints.filter((row) => row.verdict === 'UNRESOLVED').length;
    process.stdout.write(`I8:  ${i8Conclusion(sweep, scenarioBlock, stage1.providerEvidenceMode)}\n`);
    process.stdout.write(`I20: ${i20Conclusion(i20, scenarioBlock)}\n`);
    process.stdout.write(
      `I36: ${i36Conclusion(killPoints, duplicateControlRun, visibilityBound, scenarioBlock)}\n`,
    );
    if (failedRows > 0) return 1;
    return unresolvedRows > 0 ? 2 : 0;
  }
  process.stdout.write(`PREFLIGHT REFUSED — ${String(failures.length)} gate(s):\n`);
  process.stdout.write(`  stage 1 (no credential touched): ${String(stage1Failures.length)}\n`);
  for (const gate of stage1Failures) process.stdout.write(`    - ${gate}\n`);
  process.stdout.write(`  stage 2 (credential identity): ${String(stage2Failures.length)}\n`);
  for (const gate of stage2Failures) process.stdout.write(`    - ${gate}\n`);
  process.stdout.write('NO PROVIDER CALL WAS MADE.\n');
  return 1;
}

/*
 * THERE IS NO MODULE-EVALUATION SIDE EFFECT IN THIS FILE.
 *
 * `main` is exported and never self-invoked, so importing this module — which is what
 * `tests/sendgrid/preflight.test.ts` does to reach `establishStage1Facts` — runs nothing,
 * opens nothing and writes nothing. The npm entry point is `run.ts`, which exists for the
 * single purpose of calling `main`, and a guard comparing `import.meta.url` to
 * `process.argv[1]` is exactly the kind of clever line that silently stops guarding after a
 * path change.
 */
