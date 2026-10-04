import { existsSync, readFileSync } from 'node:fs';
import { createHash, createPrivateKey, createPublicKey, type KeyObject } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createPool, type Pool } from '../../../src/db/pool.js';
import { systemClock } from '../../../src/kernel/enumeration/clock.js';
import { EntityLeaseManager } from '../../../src/kernel/enumeration/entityLease.js';
import { EffectEnumerator } from '../../../src/kernel/enumeration/enumerateEffects.js';
import { EffectCanonicaliser } from '../../../src/kernel/canonicalisation/canonicaliser.js';
import { s1pLiveConstructorRegistry } from './validationEmailConstructor.js';
import { verifiedConstructorVersionResolver } from '../../../src/kernel/canonicalisation/constructorAdmission.js';
import { Ed25519DecisionSigner } from '../../../src/kernel/authorisation/decisionSignature.js';
import { commitLocalAuthorisation } from '../../../src/kernel/authorisation/localAuthorisation.js';
import { enqueueDispatch } from '../../../src/kernel/outbox/enqueue.js';
import { DispatchLeaseManager } from '../../../src/kernel/gateway/dispatchLease.js';
import { createAdapterRuntimeRegistry } from '../../../src/integration/control/adapterRuntimeRegistry.js';
import { IntegrationClient } from '../../../src/integration/control/integrationClient.js';
import { createAuditReaderRegistry } from '../../../src/audit/provider/plane/auditReaderRegistry.js';
import { AuditReadClient } from '../../../src/audit/provider/plane/auditReadClient.js';
import {
  verifiedActionCatalogue,
  verifiedProviderEvidenceTrust,
  verifiedProviderEvidenceTrustContentHash,
} from '../../../src/kernel/controlArtifacts/bundle.js';
import { createAuditEvaluatorPool } from '../../../src/audit/db/auditPool.js';
import {
  observeCorrelation as observeAuditPushCorrelation,
  pushInverseObservation,
} from '../../../src/audit/providerEvidence/evidenceReader.js';
import { SIGNED_PUSH_LIVE_VISIBILITY_BOUND, type SignedPushEvidencePort } from './pushEvidence.js';
import { PolicyEngine } from '../../../src/kernel/policy/policyEngine.js';
import { verifyAuditPlaneControlArtifacts } from '../../../src/audit/controlArtifacts/auditPlaneVerifier.js';
import type {
  ChangedField,
  ConstructorVersionIdentity,
  ConstructorVersionRecord,
} from '../../../src/kernel/canonicalisation/constructorVersion.js';
import { ACTION_CLASSES } from '../../../src/kernel/canonicalisation/actionClasses.js';
import type { ActionClass } from '../../../src/kernel/canonicalisation/actionClasses.js';
import type { VerifiedControlArtifactBundle } from '../../../src/kernel/controlArtifacts/bundle.js';
import type { AdapterRegistry } from '../../../src/kernel/gateway/adapterRegistry.js';
import type { DispatchEnvironment } from '../../../src/kernel/gateway/effectGateway.js';

import {
  S1P_VALIDATION_AUTHORITY_ACKNOWLEDGEMENT,
  S1PValidationAuthority,
  type ValidationConstructorVersion,
} from './validationAuthority.js';
import {
  MAX_OBSERVATION_ATTEMPTS,
  MAX_OBSERVATION_DURATION_MS,
  MIN_OBSERVATION_INTERVAL_MS,
  MIN_STABILISATION_OBSERVATIONS,
} from './observation.js';
import {
  SENDGRID_LIVE_VISIBILITY_BOUND,
  assertLiveUsable,
  type VisibilityBound,
} from './visibilityBound.js';
import type {
  AuditReaderRuntimeConfig,
  LaunchedAuditRuntime,
  LaunchedIntegrationRuntime,
  LocalScenarioState,
  ScenarioPorts,
  ScenarioRuntimeConfig,
} from './scenarioDriver.js';
import { SENDGRID_ACTION_CLASS, SENDGRID_ADAPTER_ID, SENDGRID_PROVIDER_ID } from './preflight.js';
import type { S1PDeploymentConfig } from './deploymentConfig.js';

/**
 * SECOND REVIEW, BLOCKER 1 — **THE VALIDATION-ONLY LIVE COMPOSITION ROOT.**
 *
 * =================================================================================
 * THE DEFECT THIS FILE ANSWERS
 *
 * `scenarioDriver.ts` was written, and exercised offline, and **nothing could ever call it**.
 * `cli.ts` passed `controlPlaneCompositionAvailable: false` as a LITERAL and stopped. So the
 * repository contained a six-scenario matrix that no entry point could execute, and a
 * preflight fact that was an assertion rather than a measurement.
 *
 * This module is the missing half. It answers two questions and nothing else:
 *
 *   `describeLiveComposition`  CAN a live control plane be composed here, and if not, WHICH
 *                              concrete pieces are absent? Every answer is a probe.
 *   `openLiveComposition`      build it, from the PRODUCTION constructors, and hand back the
 *                              `ScenarioRuntimeConfig` and `ScenarioPorts` the driver takes.
 *
 * =================================================================================
 * WHAT `§1.1` FORBIDS, AND WHY NONE OF IT IS HERE
 *
 *   "no generic production email composition"   — the ONLY effect this composition can
 *       authorise is built by `S1PValidationAuthority`, whose payload is the closed four-field
 *       validation schema and whose recipient must carry the owner-sink marker.
 *   "no customer recipient path"                — the sink comes from the deployment
 *       configuration, is refused unless owner-controlled, and is bound into the payload the
 *       authorisation hash covers.
 *   "no general Cedar permit"                   — this module adds no policy. It reads the
 *       VERIFIED class-2 bytes through the same `PolicyEngine` every dispatch uses.
 *   "no direct adapter call from the coordinator" — the coordinator holds an `AdapterRegistry`
 *       backed by a FORKED runtime. There is no `import` of either provider client here, and
 *       `tests/sendgrid/credential-process-isolation.test.ts` computes that closure.
 *   "do not bypass the durable outbox/gateway"  — `enqueue` is `enqueueDispatch` and the send
 *       is `dispatchAuthorisedEffect`, called by the driver. There is no other path.
 *   "no vendor credentials in this composition process" — this file imports NEITHER plane's
 *       secret source. It passes LOCATORS to registries that fork runtimes; the material is
 *       resolved inside the child. The decision signing key below is a CONTROL-PLANE key, not
 *       a vendor credential, and it is the one secret this process legitimately holds.
 *
 * =================================================================================
 * `§1.2` — THE AVAILABILITY ANSWER IS A MEASUREMENT, AND TODAY IT IS A LONG "NO"
 *
 * Every block below is decided by looking: an environment variable, a file on disk, the
 * VERIFIED catalogue's own entries, the S1P live constructor registry's own membership.
 * None is a constant.
 *
 * =================================================================================
 * THIRD REVIEW — **EVERY REMAINING BLOCK IS NOW EXTERNAL**
 *
 * The second round reported `EFFECT_CONSTRUCTOR_NOT_IMPLEMENTED` permanently, because the
 * registry held `refundCreateConstructor` alone and no `email.send` constructor existed
 * anywhere. The reviewer's objection was exact: **an owner-signed `ConstructorVersionRecord`
 * cannot implement missing TypeScript code**, so the live path would have stayed impossible
 * after every external prerequisite was provisioned.
 *
 * `validation/sendgrid/harness/validationEmailConstructor.ts` is that code, and
 * `s1pLiveConstructorRegistry()` is the registry this composition measures and builds from.
 * The block remains in the closed set below and is still MEASURED — a misconfigured or
 * removed module must still stop a live run — but the checked-in tree clears it.
 *
 * What is left is signatures, credentials, deployment materials and provider measurements:
 * a signed `ConstructorVersionRecord` the class-19 candidate is admitted against, the class-3
 * and class-5 releases, material-bound credential identities, a control database, a decision
 * signing key, and an empirical provider visibility bound.
 * =================================================================================
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..', '..');

/** The live SendGrid integration runtime's root and modules. Real ones, not doubles. */
const LIVE_INTEGRATION_ROOT = join(REPO_ROOT, 'validation', 'sendgrid', 'integration');
const LIVE_AUDIT_ROOT = join(REPO_ROOT, 'validation', 'sendgrid', 'audit');

/** The env var naming the control-plane database. `src/db/pool.ts` reads the same name. */
/**
 * HOW MANY ACTIVITY RECORDS ONE READ ASKS FOR.
 *
 * A REQUEST SIZE, NOT A POLICY. The provider returns what it returns, and no conclusion
 * depends on this figure: an answer that is short because the page was small is
 * indistinguishable, to the inverse sweep, from any other incomplete result, and is
 * reported as incomplete either way.
 */
export const LIVE_ACTIVITY_PAGE_RECORDS = 100;

/**
 * The principal the validation enumeration is recorded under.
 *
 * `enumeration_record.principal_id` is TEXT with no foreign key, and it is a BINDING
 * field: an enumeration computed for one `(task, principal, class, resource)` may not be
 * paired at C′ with a selector for another. A stable, self-describing identifier is
 * therefore what this needs — not a real worker principal, because no model and no worker
 * is involved in a provider-validation run.
 */
export const S1P_VALIDATION_PRINCIPAL_ID = 'principal:s1p_validation_harness';

/**
 * The ledger currency the validation resource row carries.
 *
 * `email.send` is `carries_vendor_monetary_field: false` and its option amount is zero, so
 * nothing monetary is derived from this. The column is `NOT NULL`, so the row needs a
 * value, and a validation run must not appear to denominate anything it did not.
 */
const LEDGER_CURRENCY = 'USD';

export const ENV_CONTROL_PG_URL = 'ACOS_CONTROL_PG_URL';
/** The env var naming the file holding the kernel's DECISION signing key. NOT a vendor key. */
export const ENV_DECISION_KEY_LOCATOR = 'ACOS_S1P_DECISION_KEY_LOCATOR';
/** The env var naming the signed `ConstructorVersionRecord` set `50 §3i` admits. */
export const ENV_CONSTRUCTOR_RECORDS_LOCATOR = 'ACOS_S1P_CONSTRUCTOR_RECORDS_LOCATOR';

/**
 * WHY A LIVE COMPOSITION CANNOT BE BUILT. A CLOSED SET, EVERY MEMBER MEASURED.
 *
 * The order is the order a composition would fail in, so an operator reading a bundle works
 * down the list rather than guessing which absence is upstream of which.
 */
export const COMPOSITION_BLOCKS = [
  /** `ACOS_CONTROL_PG_URL` is unset, so there is no control store to compose against. */
  'CONTROL_DATABASE_NOT_CONFIGURED',
  /** `50 §3f` occasion 1 produced no ACTIVE verified bundle in this process. */
  'CONTROL_ARTIFACT_AUTHORITY_UNAVAILABLE',
  /** The VERIFIED class-3 bytes do not carry the validation action class. */
  'ACTION_CLASS_NOT_IN_VERIFIED_CATALOGUE',
  /** The verified catalogue routes the class somewhere other than the SendGrid adapter. */
  'ACTION_CLASS_NOT_ROUTED_TO_ADAPTER',
  /**
   * The S1P live constructor registry carries no constructor for the validation action
   * class, so the production enumerator could not enumerate it.
   *
   * **THE CHECKED-IN TREE CLEARS THIS.** It remains measured, and it still blocks, because a
   * composition whose constructor module was removed or misregistered must stop rather than
   * discover the absence at the first enumeration.
   */
  'EFFECT_CONSTRUCTOR_NOT_IMPLEMENTED',
  /** No signed `ConstructorVersionRecord` set was supplied for the resolver to admit. */
  'CONSTRUCTOR_VERSION_RECORDS_NOT_PROVISIONED',
  /** The kernel's decision signing key was not supplied, so no authorisation can be signed. */
  'DECISION_SIGNING_KEY_NOT_PROVISIONED',
  /** The live integration runtime's modules are not on disk where the descriptor names them. */
  'INTEGRATION_RUNTIME_MODULE_MISSING',
  'AUDIT_RUNTIME_MODULE_MISSING',
  /** A live run was handed a bound that only an offline fixture may use. `§4.4`. */
  'VISIBILITY_BOUND_NOT_LIVE_USABLE',
  /**
   * v1.3.8, `50 §2h` — the VERIFIED class-28 record declares no evidence channel for the
   * provider, so there is no signed answer to "where does its accepted-message evidence come
   * from?". A signature prerequisite: a class-28 release naming the provider.
   */
  'PROVIDER_EVIDENCE_CHANNEL_NOT_DECLARED',
  /**
   * v1.3.8, ADR-027 — the provider's verified mode is `SIGNED_PROVIDER_PUSH` and no audit
   * evidence store is configured (`ACOS_AUDIT_PG_URL`), so the push evidence the oracle reads has
   * nowhere to be read from. A deployment prerequisite.
   */
  'AUDIT_EVIDENCE_STORE_NOT_CONFIGURED',
] as const;

/** The audit store the push-evidence oracle reads, through the evaluator role. */
export const ENV_AUDIT_PG_URL = 'ACOS_AUDIT_PG_URL';

/**
 * v1.3.8 — WHICH EVIDENCE MODE THE VERIFIED CLASS-28 RECORD SELECTS FOR THE PROVIDER, or `null`.
 *
 * Read from the VERIFIED control bundle and nothing else: no environment variable, no CLI flag
 * and no default chooses the mode. The audit plane re-reads its OWN class-28 copy when the
 * composition opens, and a disagreement refuses.
 */
export function verifiedEvidenceModeFor(
  bundle: VerifiedControlArtifactBundle,
): 'PROVIDER_READ' | 'SIGNED_PROVIDER_PUSH' | null {
  return verifiedProviderEvidenceTrust(bundle).channels[SENDGRID_PROVIDER_ID]?.evidenceMode ?? null;
}

/**
 * `SIGNED_PROVIDER_PUSH` — whether the AUDIT plane's OWN class-28 verification bound the SAME
 * class-28 artifact (equal exact-byte content hash) as the control bundle, naming the same push
 * channel. `50 §3` property 2. The rule is `planesAgreeOnClass28`, shared with the composition.
 *
 * Stage-1 safe: it reads the audit plane's trust configuration and signed artifacts, and no
 * credential. A verification that cannot run is a disagreement, never an agreement.
 */
export function auditPlaneAgreesOnPushChannel(
  environment: Readonly<Record<string, string | undefined>>,
  bundle: VerifiedControlArtifactBundle,
): boolean {
  if (verifiedEvidenceModeFor(bundle) !== 'SIGNED_PROVIDER_PUSH') return false;
  let verification: ReturnType<typeof verifyAuditPlaneControlArtifacts>;
  try {
    verification = verifyAuditPlaneControlArtifacts(environment);
  } catch {
    return false;
  }
  if (!verification.verified) return false;
  return planesAgreeOnClass28(bundle, verification);
}

/** The audit plane's own verification, in its VERIFIED form. */
export type AuditPlaneVerification = Extract<
  ReturnType<typeof verifyAuditPlaneControlArtifacts>,
  { readonly verified: true }
>;

/**
 * THE ONE CROSS-PLANE CLASS-28 AGREEMENT RULE — used by the stage-1 preflight
 * (`auditPlaneAgreesOnPushChannel`) and by `openLiveComposition`, so the two cannot differ.
 *
 * Class 28 is ONE signed control artifact. The planes agree only when each, verifying
 * independently, bound the SAME exact artifact bytes: the control bundle's class-28 content
 * hash (`50 §3c`, recomputed against the manifest during verification) must EQUAL the audit
 * plane's own `providerEvidenceTrustDigest`. That equality is the authoritative split-brain
 * check — two dual-signed artifacts that share a SendGrid key but differ in any other byte
 * (accepted event classes, ingress identity, another channel, the version string) are two
 * authorities, and refuse. Nothing is re-hashed or normalised here.
 *
 * The parsed SendGrid channel comparison below is DEFENCE IN DEPTH only: with equal digests it
 * cannot differ unless one plane's parser disagrees with the other's.
 */
export function planesAgreeOnClass28(
  bundle: VerifiedControlArtifactBundle,
  audit: AuditPlaneVerification,
): boolean {
  if (verifiedProviderEvidenceTrustContentHash(bundle) !== audit.providerEvidenceTrustDigest) {
    return false;
  }
  const control = verifiedProviderEvidenceTrust(bundle).channels[SENDGRID_PROVIDER_ID];
  const plane = audit.providerEvidenceTrust.channels[SENDGRID_PROVIDER_ID];
  if (control === undefined || plane === undefined) return false;
  if (control.evidenceMode !== plane.evidenceMode) return false;
  if (control.evidenceMode === 'SIGNED_PROVIDER_PUSH' && plane.evidenceMode === 'SIGNED_PROVIDER_PUSH') {
    return control.keyIdentity === plane.keyIdentity;
  }
  return true;
}

export type CompositionBlock = (typeof COMPOSITION_BLOCKS)[number];

export interface CompositionAvailability {
  /** `true` only when `blocks` is empty. Derived, never authored. */
  readonly available: boolean;
  readonly blocks: readonly CompositionBlock[];
  /** One sentence a reviewer can check the answer against. */
  readonly statement: string;
}

/** What the driver needs, and a way to give it all back. */
export interface OpenedScenarioComposition {
  readonly runtime: ScenarioRuntimeConfig;
  readonly ports: ScenarioPorts;
  close(): Promise<void>;
}

export interface CompositionInput {
  readonly environment: Readonly<Record<string, string | undefined>>;
  readonly config: S1PDeploymentConfig;
  readonly bundle: VerifiedControlArtifactBundle | null;
  readonly integrationLocator: string;
  /**
   * The audit-READ secret locator — `PROVIDER_READ` only. `null` under `SIGNED_PROVIDER_PUSH`,
   * where no SendGrid audit credential exists to locate. Never an empty-string placeholder.
   */
  readonly auditLocator: string | null;
  readonly visibilityBound: VisibilityBound;
}

/**
 * THE SEAM `cli.ts` ORCHESTRATES THROUGH — `§1.4`.
 *
 * The CLI depends on this interface and NOT on the live implementation, so the offline test
 * can drive the REAL orchestration with an offline composition. The alternative — a test that
 * calls `runAllScenarios` itself — is what the second review refused: "Do not satisfy this by
 * testing `scenarioDriver.ts` separately again."
 */
export interface ScenarioCompositionProvider {
  /** The name that reaches evidence, so a bundle says WHICH composition produced it. */
  readonly label: string;
  describe(input: CompositionInput): CompositionAvailability;
  open(input: CompositionInput): Promise<OpenedScenarioComposition>;
}

/**
 * THE REGISTRY THIS COMPOSITION MEASURES AND BUILDS ITS KERNEL FROM.
 *
 * **NOT A PRODUCTION REGISTRY, AND NO LONGER NAMED LIKE ONE.** The second round called this
 * `PRODUCTION_CONSTRUCTOR_REGISTRY`; adding a validation-only constructor to a constant with
 * that name would have made the identifier assert something false. `s1pLiveConstructorRegistry`
 * carries the production constructors the kernel needs PLUS the S1P validation constructor,
 * and it is reachable only from this composition.
 *
 * Deliberately NOT a hand-written list of class names: a slice that adds a constructor makes
 * this probe pass by existing, and a slice that removes one makes it fail.
 */
export const S1P_LIVE_CONSTRUCTOR_REGISTRY = s1pLiveConstructorRegistry();

/** Whether a file the composition would load is actually on disk. */
function present(path: string): boolean {
  try {
    return existsSync(path);
  } catch {
    return false;
  }
}

/**
 * `§1.2` — MEASURE WHETHER A LIVE CONTROL PLANE CAN BE COMPOSED. **PURE OVER ITS INPUT AND
 * FREE OF SIDE EFFECTS**: it opens no pool, forks nothing and touches no credential.
 */
export function describeLiveComposition(input: CompositionInput): CompositionAvailability {
  const blocks: CompositionBlock[] = [];

  const controlUrl = input.environment[ENV_CONTROL_PG_URL];
  if (controlUrl === undefined || controlUrl.length === 0) {
    blocks.push('CONTROL_DATABASE_NOT_CONFIGURED');
  }

  // v1.3.8 — the provider's evidence mode, from the verified class-28 record. `null` when no
  // bundle is available (that block is reported below) or when the record names no channel.
  const mode = input.bundle === null ? null : verifiedEvidenceModeFor(input.bundle);

  if (input.bundle === null) {
    blocks.push('CONTROL_ARTIFACT_AUTHORITY_UNAVAILABLE');
  } else {
    if (mode === null) blocks.push('PROVIDER_EVIDENCE_CHANNEL_NOT_DECLARED');
    /*
     * READ FROM THE VERIFIED BYTES, NOT FROM THE FILE ON DISK.
     *
     * `artifacts/control/class-03.action-catalogue.json` carries the S1P candidate entry, and
     * a composition that trusted those bytes directly would be trusting an unsigned edit.
     * `verifiedActionCatalogue` can only be reached through a bundle `50 §3f` produced.
     */
    const catalogue = verifiedActionCatalogue(input.bundle);
    const entry = catalogue.entries[SENDGRID_ACTION_CLASS as keyof typeof catalogue.entries];
    if (entry === undefined) {
      blocks.push('ACTION_CLASS_NOT_IN_VERIFIED_CATALOGUE');
    } else if (entry.adapter !== SENDGRID_ADAPTER_ID) {
      blocks.push('ACTION_CLASS_NOT_ROUTED_TO_ADAPTER');
    }
  }

  /*
   * MEASURED FROM THE REAL REGISTRY THE KERNEL IS BUILT WITH — not from a list of names.
   *
   * `ConstructorRegistry.get` is the same lookup `26 §7` step C2 performs, so this probe and
   * the kernel cannot disagree about whether the class is canonicalisable.
   */
  if (S1P_LIVE_CONSTRUCTOR_REGISTRY.get(SENDGRID_ACTION_CLASS as never) === undefined) {
    blocks.push('EFFECT_CONSTRUCTOR_NOT_IMPLEMENTED');
  }

  const recordsLocator = input.environment[ENV_CONSTRUCTOR_RECORDS_LOCATOR];
  if (recordsLocator === undefined || !present(recordsLocator)) {
    blocks.push('CONSTRUCTOR_VERSION_RECORDS_NOT_PROVISIONED');
  }

  const decisionKeyLocator = input.environment[ENV_DECISION_KEY_LOCATOR];
  if (decisionKeyLocator === undefined || !present(decisionKeyLocator)) {
    blocks.push('DECISION_SIGNING_KEY_NOT_PROVISIONED');
  }

  if (
    !present(join(LIVE_INTEGRATION_ROOT, 'adapter.ts')) ||
    !present(join(LIVE_INTEGRATION_ROOT, 'killPointAdapter.ts')) ||
    !present(join(LIVE_INTEGRATION_ROOT, 'secretSource.ts'))
  ) {
    blocks.push('INTEGRATION_RUNTIME_MODULE_MISSING');
  }
  if (mode === 'SIGNED_PROVIDER_PUSH') {
    // PUSH: no reader runtime is launched; the oracle reads the audit evidence store.
    const auditUrl = input.environment[ENV_AUDIT_PG_URL];
    if (auditUrl === undefined || auditUrl.length === 0) {
      blocks.push('AUDIT_EVIDENCE_STORE_NOT_CONFIGURED');
    }
  } else if (
    !present(join(LIVE_AUDIT_ROOT, 'reader.ts')) ||
    !present(join(LIVE_AUDIT_ROOT, 'secretSource.ts'))
  ) {
    blocks.push('AUDIT_RUNTIME_MODULE_MISSING');
  }

  // `§4.4` — a LIVE run may never borrow the offline fixture's determinism.
  if (input.visibilityBound.kind === 'FIXTURE_DETERMINISTIC') {
    blocks.push('VISIBILITY_BOUND_NOT_LIVE_USABLE');
  }

  return Object.freeze({
    available: blocks.length === 0,
    blocks: Object.freeze([...blocks]),
    statement:
      blocks.length === 0
        ? 'a live control-plane composition can be built: every probed prerequisite is present'
        : `a live control-plane composition CANNOT be built; ${String(blocks.length)} ` +
          `prerequisite(s) are absent: ${blocks.join(', ')}`,
  });
}

/**
 * THE SIGNED `ConstructorVersionRecord` SET, AS A DOCUMENT ON DISK.
 *
 * `50 §3i` calls this the UNMIGRATED input: the records carry their own `ACOS-JCS-1`
 * signature, separate from the owner artifact signature, and MEMBERSHIP is decided by the
 * VERIFIED class-19 artifact rather than by this file.
 */
interface ConstructorRecordsDocument {
  readonly records: readonly {
    readonly constructorId: string;
    readonly actionClass: string;
    readonly semanticMajor: number;
    readonly nonSemanticMinor: number;
    readonly changedFields: readonly string[];
    readonly semanticChange: boolean;
    readonly signedAtIso: string;
    readonly signatureBase64: string;
  }[];
  /** The `50 §3i` legacy record verifying key. It SELECTS nothing. */
  readonly verifyingKeyPem: string;
}

function toConstructorVersionRecord(
  entry: ConstructorRecordsDocument['records'][number],
): ConstructorVersionRecord {
  return {
    constructorId: entry.constructorId,
    actionClass: entry.actionClass,
    semanticMajor: entry.semanticMajor,
    nonSemanticMinor: entry.nonSemanticMinor,
    changedFields: entry.changedFields,
    semanticChange: entry.semanticChange,
    signedAt: new Date(entry.signedAtIso),
    signature: Buffer.from(entry.signatureBase64, 'base64'),
  };
}

/**
 * SELECT the validation class's signed constructor version BY ACTION CLASS.
 *
 * Correction 6's rule, applied to class 19: a document carrying TWO records for the class
 * is ambiguous and is refused rather than resolved by position, and a document carrying
 * NONE is a refusal rather than a fabricated identity.
 */
function validationConstructorVersion(
  document: ConstructorRecordsDocument,
): ValidationConstructorVersion {
  const matching = document.records.filter(
    (entry) => entry.actionClass === SENDGRID_ACTION_CLASS,
  );
  if (matching.length !== 1) {
    throw new Error(
      `the signed ConstructorVersionRecord set carries ${String(matching.length)} records ` +
        `for ${SENDGRID_ACTION_CLASS}; exactly one is required`,
    );
  }
  const entry = matching[0]!;
  /*
   * AND IT MUST BE A CLASS THE KERNEL KNOWS.
   *
   * `ACTION_CLASSES` is the canonicalisation registry's own closed list. A document naming a
   * class outside it would otherwise travel as a `string` into lineage that is typed
   * `ActionClass`, which is the kind of widening a cast hides and a check does not.
   */
  if (!(ACTION_CLASSES as readonly string[]).includes(entry.actionClass)) {
    throw new Error(
      `the signed ConstructorVersionRecord names action class "${entry.actionClass}", which ` +
        'the kernel canonicalisation registry does not carry',
    );
  }
  return Object.freeze({
    constructorId: entry.constructorId,
    actionClass: entry.actionClass as ActionClass,
    semanticMajor: entry.semanticMajor,
    nonSemanticMinor: entry.nonSemanticMinor,
    semanticChange: entry.semanticChange,
    changedFields: entry.changedFields as readonly ChangedField[],
    signedAt: new Date(entry.signedAtIso),
    // BINDS THE IDENTITY TO THE EXACT RECORD THAT WAS VERIFIED, never to the class name.
    recordHash: createHash('sha256').update(entry.signatureBase64, 'utf8').digest('hex'),
  });
}

/** Read the kernel's decision signing key from the locator. A CONTROL key, not a vendor key. */
function readDecisionSigner(locator: string): { key: KeyObject; keyId: string } {
  const document = JSON.parse(readFileSync(locator, 'utf8')) as Record<string, unknown>;
  const pem = document['privateKeyPem'];
  const keyId = document['signingKeyId'];
  if (typeof pem !== 'string' || typeof keyId !== 'string') {
    throw new Error(
      'the S1P decision-key document must carry a `privateKeyPem` and a `signingKeyId`',
    );
  }
  return { key: createPrivateKey(pem), keyId };
}

/**
 * `§1.1` — BUILD THE LIVE COMPOSITION, FROM THE PRODUCTION CONSTRUCTORS.
 *
 * Refuses unless `describeLiveComposition` measured every prerequisite present, so there is
 * no argument list that reaches a provider through a half-built control plane.
 */
export async function openLiveComposition(
  input: CompositionInput,
): Promise<OpenedScenarioComposition> {
  const availability = describeLiveComposition(input);
  if (!availability.available || input.bundle === null) {
    throw new Error(`the S1P live composition was opened while UNAVAILABLE: ${availability.statement}`);
  }
  const bundle = input.bundle;
  const controlUrl = input.environment[ENV_CONTROL_PG_URL] ?? '';
  const visibilityBound = assertLiveUsable(input.visibilityBound);

  const pool: Pool = createPool({
    connectionString: controlUrl,
    max: 8,
    applicationName: 'acos-s1p-validation',
  });

  /*
   * THE KERNEL, FROM THE PRODUCTION CONSTRUCTORS AND THE VERIFIED BUNDLE.
   *
   * `verifiedConstructorVersionResolver` is documented in `constructorAdmission.ts` as THE
   * ONLY PRODUCTION CONSTRUCTION SITE for a resolver, and it decides membership from the
   * verified artifact rather than from the records file — the file's own signature is checked
   * afterwards by the resolver, and it selects nothing.
   */
  const recordsLocator = input.environment[ENV_CONSTRUCTOR_RECORDS_LOCATOR] ?? '';
  const recordsDocument = JSON.parse(
    readFileSync(recordsLocator, 'utf8'),
  ) as ConstructorRecordsDocument;
  const versions = verifiedConstructorVersionResolver(
    bundle,
    recordsDocument.records.map(toConstructorVersionRecord),
    createPublicKey(recordsDocument.verifyingKeyPem),
  );
  /*
   * `I61` — THE CONSTRUCTOR VERSION THE AUTHORITY RECORDS IS THE **SIGNED** ONE.
   *
   * Read from the record set the resolver just admitted, selected by ACTION CLASS, and
   * refused when the set carries none for the class — correction 6's discipline applied to a
   * second kind of signed record. A fabricated identity here would travel onto the
   * `AuthorizationDecision`, the journal row and the approval binding.
   */
  const constructorVersion = validationConstructorVersion(recordsDocument);
  /*
   * THE SAME IDENTITY, IN THE KERNEL'S OWN TYPE.
   *
   * `ValidationConstructorVersion.actionClass` is a `string` because the validation
   * authority was written against the S1P class independently of the canonicalisation
   * registry. `validationConstructorVersion` has ALREADY checked membership in
   * `ACTION_CLASSES` and refused otherwise, so this is the point at which a checked value
   * takes the kernel's type — not a cast standing in for a check.
   */
  const constructorIdentity: ConstructorVersionIdentity = {
    ...constructorVersion,
    actionClass: constructorVersion.actionClass as ActionClass,
    changedFields: constructorVersion.changedFields as readonly ChangedField[],
  };
  const registry = S1P_LIVE_CONSTRUCTOR_REGISTRY;
  const clock = systemClock;
  const leases = new EntityLeaseManager({ pool });
  const enumerator = new EffectEnumerator({ registry, versions, clock });
  // Constructed for completeness of the kernel the driver dispatches through; the canonical
  // bytes the gateway revalidates are produced from it.
  void new EffectCanonicaliser({ registry, versions });

  /*
   * `26 §11` — THE POLICY VERSION IS THE ENGINE'S, OVER THE **VERIFIED** CEDAR BYTES.
   *
   * `PolicyEngine`'s default argument is `loadPolicyArtifacts()`, which resolves through
   * `activeVerifiedControlArtifacts()`. So this composition adds no policy of its own and
   * cannot: `§1.1`'s "no general Cedar permit" is a property of where the bytes come from.
   */
  const policyEngine = new PolicyEngine();

  const decision = readDecisionSigner(input.environment[ENV_DECISION_KEY_LOCATOR] ?? '');
  const signer = new Ed25519DecisionSigner(decision.key, decision.keyId);

  /*
   * `48 §3.6` — THE AUDIT PLANE VERIFIES ITS **OWN** ARTIFACTS, FROM ITS **OWN** TRUST
   * CONFIGURATION.
   *
   * `verifyAuditPlaneControlArtifacts` reads the four `ACOS_AUDIT_*` variables and refuses
   * `AUDIT_TRUST_CONFIG_MISSING` when they are absent — it does NOT fall back to the control
   * plane's. Handing `createAuditReaderRegistry` an empty scope map instead would have made
   * the read plane's credential scope something this process asserted rather than verified.
   */
  const auditVerification = verifyAuditPlaneControlArtifacts(input.environment);
  if (!auditVerification.verified) {
    await pool.end();
    throw new Error(
      `the S1P audit plane could not verify its control artifacts: ${auditVerification.reason}`,
    );
  }

  /*
   * v1.3.8, ADR-027 — THE EVIDENCE MODE, AGREED BY BOTH PLANES' OWN VERIFICATIONS.
   *
   * The control bundle's class-28 reading selected the mode in `describeLiveComposition`; the
   * audit plane's OWN verification must have bound the SAME class-28 artifact bytes (equal
   * content hashes — `planesAgreeOnClass28`, the rule the stage-1 preflight also applies), or
   * the composition refuses before any scenario, send or evidence read. Under `SIGNED_PROVIDER_PUSH` the
   * oracle reads the audit store's authenticated evidence as the EVALUATOR role, and no reader
   * runtime, no read credential and no provider read exist in this composition.
   */
  const auditChannel = auditVerification.providerEvidenceTrust.channels[SENDGRID_PROVIDER_ID];
  if (auditChannel === undefined || !planesAgreeOnClass28(bundle, auditVerification)) {
    await pool.end();
    throw new Error(
      'AUDIT_PLANE_EVIDENCE_CHANNEL_DISAGREES: the control and audit planes did not verify the ' +
        'same class-28 artifact (content hash) and evidence channel for the provider',
    );
  }
  let evidencePool: Pool | null = null;
  let signedPushEvidence: SignedPushEvidencePort | undefined;
  let liveBound = visibilityBound;
  /*
   * THE AUDIT READER, BY MODE. Under `PROVIDER_READ` it is the accepted reader runtime, scoped
   * by the audit plane's VERIFIED read-credential map. Under `SIGNED_PROVIDER_PUSH` there is no
   * reader: the read-credential map is never consulted, no `AuditReadClient` is constructed, and
   * a launch request is refused rather than served with a placeholder.
   */
  let launchAuditReader: ScenarioPorts['launchAuditReader'];
  let auditReader: AuditReaderRuntimeConfig | null;
  if (auditChannel.evidenceMode === 'SIGNED_PROVIDER_PUSH') {
    const evaluator = createAuditEvaluatorPool();
    evidencePool = evaluator;
    const acceptedEventClasses = auditChannel.acceptedEventClasses;
    signedPushEvidence = Object.freeze({
      observe: (query: {
        readonly correlationTag: string;
        readonly periodStartMs: number;
        readonly periodEndMs: number;
      }) =>
        observeAuditPushCorrelation(evaluator, {
          provider: SENDGRID_PROVIDER_ID,
          correlationTag: query.correlationTag,
          acceptedEventClasses,
          receivedFrom: new Date(query.periodStartMs),
          receivedTo: new Date(query.periodEndMs),
        }),
      inverse: (query: {
        readonly periodStartMs: number;
        readonly periodEndMs: number;
        readonly accountedCorrelationTags: ReadonlySet<string>;
      }) =>
        pushInverseObservation(evaluator, {
          provider: SENDGRID_PROVIDER_ID,
          accountedCorrelationTags: query.accountedCorrelationTags,
          acceptedEventClasses,
          receivedFrom: new Date(query.periodStartMs),
          receivedTo: new Date(query.periodEndMs),
        }),
    });
    // AUTHENTICATION IS NOT COMPLETENESS: the live push bound is UNESTABLISHED.
    liveBound = SIGNED_PUSH_LIVE_VISIBILITY_BOUND;
    auditReader = null;
    launchAuditReader = () =>
      Promise.reject(
        new Error(
          'SIGNED_PROVIDER_PUSH: no SendGrid audit reader exists in this composition; the ' +
            'oracle reads the audit evidence store',
        ),
      );
  } else {
    if (input.auditLocator === null || input.config.auditCredentialId === null) {
      await pool.end();
      throw new Error(
        'PROVIDER_READ requires the audit-read credential identity and locator, and one is absent',
      );
    }
    const auditReadCredentials = auditVerification.auditReadCredentials;
    auditReader = Object.freeze({
      runtimeRoot: LIVE_AUDIT_ROOT,
      readerModule: join(LIVE_AUDIT_ROOT, 'reader.ts'),
      secretSourceModule: join(LIVE_AUDIT_ROOT, 'secretSource.ts'),
      secretLocator: input.auditLocator,
      credentialId: input.config.auditCredentialId,
    });
    launchAuditReader = (descriptor): Promise<LaunchedAuditRuntime> => {
      const client = new AuditReadClient(
        createAuditReaderRegistry(
          [descriptor],
          auditReadCredentials,
          new Set([input.integrationLocator]),
        ),
        { deadlineMs: 30_000 },
      );
      const launched: LaunchedAuditRuntime = {
        read: async (query) => {
          const outcome = await client.read({
            providerId: descriptor.providerId,
            operation: query.operation,
            periodStartMs: query.periodStartMs,
            periodEndMs: query.periodEndMs,
            correlationTag: query.correlationTag,
            maxRecords: query.maxRecords,
          });
          return outcome.kind === 'EVIDENCE'
            ? {
                kind: 'EVIDENCE' as const,
                records: outcome.records,
                recordCount: outcome.recordCount,
              }
            : { kind: 'PROVIDER_UNAVAILABLE' as const };
        },
        close: () => client.close(),
      };
      open.push(launched);
      return Promise.resolve(launched);
    };
  }

  const runtime: ScenarioRuntimeConfig = Object.freeze({
    adapterId: SENDGRID_ADAPTER_ID,
    providerId: SENDGRID_PROVIDER_ID,
    integrationRuntimeRoot: LIVE_INTEGRATION_ROOT,
    integrationAdapterModule: join(LIVE_INTEGRATION_ROOT, 'adapter.ts'),
    integrationKillPointAdapterModule: join(LIVE_INTEGRATION_ROOT, 'killPointAdapter.ts'),
    integrationSecretSourceModule: join(LIVE_INTEGRATION_ROOT, 'secretSource.ts'),
    integrationSecretLocator: input.integrationLocator,
    integrationCredentialId: input.config.integrationCredentialId,
    auditReader,
  });

  const open: { close(): Promise<void> }[] = [];

  const ports: ScenarioPorts = {
    authority: new S1PValidationAuthority({
      acknowledgement: S1P_VALIDATION_AUTHORITY_ACKNOWLEDGEMENT,
      companyId: input.config.environmentLabel,
      constructorVersion,
      commit: async (facts) =>
        leases.withEntityLease(
          {
            companyId: input.config.environmentLabel,
            entityType: 'order',
            entityId: facts.resourceId,
          },
          async (lease) => {
            const outcome = await commitLocalAuthorisation(
              lease,
              { kind: 'ORDINARY', facts },
              {
                clock: { now: () => clock.now() },
                signer,
                /*
                 * `26 §11` — THE LINEAGE OPERANDS ARE THE VERIFIED ONES.
                 *
                 * `policyVersion` is the content hash over the VERIFIED Cedar schema and
                 * policy set, read from the bundle rather than named here, and
                 * `constructorVersion` is the signed identity above. `determiningPolicies`
                 * and `stepsEvaluated` are AUDIT-PATH fields the DIRECT-commit path does not
                 * evaluate, and they are empty on that path for the same reason the kernel's
                 * own direct commits leave them empty: no gate ran, so none is reported.
                 */
                lineage: {
                  policyVersion: policyEngine.policyVersion,
                  constructorVersion: constructorIdentity,
                  determiningPolicies: [],
                  stepsEvaluated: [],
                },
              },
            );
            return outcome.outcome === 'LOCAL_AUTHORISATION_COMMITTED'
              ? { kind: 'COMMITTED' as const, effectId: outcome.effectId }
              : { kind: 'REFUSED' as const, detail: outcome.outcome };
          },
        ),
      /*
       * =============================================================================
       * `§5` — THE ENUMERATION PORT, THROUGH THE **REAL** `EffectEnumerator`.
       *
       * The second round threw here. The reviewer rejected that, and the replacement returns
       * the `enumerationId` and `optionId` THE PRODUCTION ENUMERATOR GENERATED — neither is
       * synthesised, neither is copied from a fixture, and no value is composed in this port.
       *
       * The SAME `enumerator` instance is handed to `dispatchEnvironmentFor` below, so the
       * re-enumeration `25 §14.1` performs at dispatch is literally the same machinery over
       * the same registry and the same resolver. That is what makes the six-step live
       * sequence real rather than assembled from two lookalikes:
       *
       *   1  enumerate here, under the entity lease, recording an `enumeration_record`;
       *   2  authorise, bound to that enumeration/option identity;
       *   3  enqueue on the durable outbox;
       *   4  re-enumerate at dispatch, WITHOUT minting a new enumeration id;
       *   5  identity match;
       *   6  dispatch.
       *
       * **THE VALIDATION RESOURCE IS MATERIALISED HERE, NOT IN THE CONSTRUCTOR.**
       * `resolveResource` is also called at C′, where an insert would be wrong — it must be a
       * pure resolver. So the composition creates the row before enumerating, inside the
       * lease, with a synthetic identifier and no customer, order or payment content. The
       * accepted offline fixture splits the same two jobs the same way.
       * =============================================================================
       */
      enumerate: (enumerateInput) =>
        leases.withEntityLease(
          {
            companyId: input.config.environmentLabel,
            entityType: 'order',
            entityId: enumerateInput.resourceId,
          },
          async (lease) => {
            await lease.client.query(
              `INSERT INTO commerce_order
                 (company_id, order_id, resource_ref, grade, currency, customer_novelty)
               VALUES ($1, $2, $3, 'RECORD', $4, 'RETURNING')
               ON CONFLICT (company_id, order_id) DO NOTHING`,
              [
                input.config.environmentLabel,
                enumerateInput.resourceId,
                enumerateInput.resourceRef,
                LEDGER_CURRENCY,
              ],
            );

            const outcome = await enumerator.enumerate(lease, {
              actionClass: enumerateInput.actionClass,
              resourceRef: enumerateInput.resourceRef,
              spec: {
                companyId: input.config.environmentLabel,
                taskId: enumerateInput.taskId,
                principalId: S1P_VALIDATION_PRINCIPAL_ID,
                /*
                 * THE SCOPE ADMITS THIS ONE VALIDATION RESOURCE AND NOTHING ELSE.
                 *
                 * `24 §3` K4: AI may not "enumerate outside the resource set its context_spec
                 * admits". This composition is not an AI task, and the scope is still the
                 * narrowest one that can resolve the resource — so a defect that pointed the
                 * enumeration at another reference returns an empty set rather than someone
                 * else's options.
                 */
                admittedResourceRefs: new Set([enumerateInput.resourceRef]),
                // No class admits a description field, so every projection is empty. The
                // validation option describes nothing, which is the correct amount.
                admittedDescriptionFields: {},
                reasonCodeScope: 'GOODS_FAULT',
              },
            });

            const optionId = outcome.set.options[0]?.optionId;
            if (optionId === undefined) {
              /*
               * NOTHING IS SUBSTITUTED. An empty set means the resource did not resolve at
               * RECORD grade, and inventing an option id here would produce an authorisation
               * that dispatch revalidation could never match.
               */
              throw new Error(
                'the S1P validation resource enumerated no option; the resource did not ' +
                  `resolve at RECORD grade (internal: ${outcome.internalFailure ?? 'NONE'})`,
              );
            }
            // THE ENUMERATOR'S OWN VALUES, returned unchanged.
            return { enumerationId: outcome.set.enumerationId, optionId };
          },
        ),
    }),
    senderAddress: input.config.senderAddress,
    sinkAddress: input.config.sinkAddress,
    companyId: input.config.environmentLabel,

    enqueue: async (enqueueInput) => {
      const outcome = await enqueueDispatch(pool, {
        companyId: input.config.environmentLabel,
        effectId: enqueueInput.effectId,
        outboxId: enqueueInput.outboxId,
        payloadCanonicalBytes: enqueueInput.payloadCanonicalBytes,
        now: enqueueInput.now,
      });
      if (outcome.kind !== 'ENQUEUED') {
        throw new Error(`the S1P validation effect did not enqueue: ${outcome.kind}`);
      }
    },

    correlationTagFor: async (idempotencyKey) => {
      // THE KERNEL'S OWN TAG, read back from the committed row. `25 §7`, never recomputed.
      const client = await pool.connect();
      try {
        const result = await client.query<{ correlation_tag: string }>(
          `SELECT correlation_tag FROM dispatch_outbox WHERE idempotency_key = $1`,
          [idempotencyKey],
        );
        const row = result.rows[0];
        if (row === undefined) throw new Error(`no outbox row for ${idempotencyKey}`);
        return row.correlation_tag;
      } finally {
        client.release();
      }
    },

    dispatchEnvironmentFor: (adapterRegistry: AdapterRegistry): DispatchEnvironment =>
      ({
        control: pool,
        registry: adapterRegistry,
        leases: new DispatchLeaseManager({ pool }),
        enumerator,
        controlArtifacts: bundle,
      }) as DispatchEnvironment,

    launchIntegration: (descriptor): Promise<LaunchedIntegrationRuntime> => {
      const client = new IntegrationClient(createAdapterRuntimeRegistry([descriptor], bundle), {
        deadlineMs: 30_000,
      });
      const launched: LaunchedIntegrationRuntime = {
        registry: client.adapterRegistry(),
        close: () => client.close(),
      };
      open.push(launched);
      return Promise.resolve(launched);
    },

    launchAuditReader,

    localStateFor: async (idempotencyKey): Promise<LocalScenarioState> => {
      const client = await pool.connect();
      try {
        const outbox = await client.query<{
          status: string;
          effect_id: string;
          may_have_crossed: boolean | null;
          provider_message_id: string | null;
        }>(
          `SELECT status, effect_id, may_have_crossed_provider_boundary AS may_have_crossed,
                  provider_message_id
             FROM dispatch_outbox WHERE idempotency_key = $1`,
          [idempotencyKey],
        );
        const row = outbox.rows[0];
        if (row === undefined) {
          return Object.freeze({
            outboxStatus: null,
            outcomeRows: 0,
            mayHaveCrossedProviderBoundary: null,
            providerResponseMessageId: null,
            finalEffectState: null,
          });
        }
        const outcomes = await client.query<{ count: string }>(
          `SELECT COUNT(*)::TEXT AS count FROM dispatch_outcome WHERE effect_id = $1`,
          [row.effect_id],
        );
        const effect = await client.query<{ state: string }>(
          `SELECT state FROM effect WHERE effect_id = $1`,
          [row.effect_id],
        );
        return Object.freeze({
          outboxStatus: row.status,
          outcomeRows: Number(outcomes.rows[0]?.count ?? '0'),
          mayHaveCrossedProviderBoundary: row.may_have_crossed,
          providerResponseMessageId: row.provider_message_id,
          finalEffectState: effect.rows[0]?.state ?? null,
        });
      } finally {
        client.release();
      }
    },

    reservationUnitsFor: async (effectId) => {
      /*
       * `I20`'s DENOMINATOR, FROM THE IMMUTABLE HISTORICAL EVIDENCE.
       *
       * `reservation_window_instance.irrecoverable_units`, never
       * `window_balance.reserved_irrecoverable`, which PRESUME and REALISE move. The same
       * query the offline fixture runs, for the same reason.
       */
      const client = await pool.connect();
      try {
        const result = await client.query<{ units: string | null }>(
          `SELECT MAX(rwi.irrecoverable_units)::TEXT AS units
             FROM reservation_window_instance rwi
             JOIN exposure_reservation r ON r.reservation_id = rwi.reservation_id
             JOIN effect e ON e.authorisation_id = r.authorisation_id
            WHERE e.effect_id = $1`,
          [effectId],
        );
        const units = result.rows[0]?.units;
        return units === undefined || units === null ? 0n : BigInt(units);
      } finally {
        client.release();
      }
    },

    now: () => clock.now(),
    recoveryAt: () => new Date(clock.now().getTime() + 60_000),
    delay: (ms) => new Promise((resolveDelay) => setTimeout(resolveDelay, ms)),
    nowMs: () => Date.now(),
    observationWindow: () => ({
      periodStartMs: Date.now() - 60 * 60 * 1000,
      periodEndMs: Date.now() + 60 * 60 * 1000,
    }),
    /*
     * THE LIVE OBSERVATION BUDGET IS THE **DECLARED CEILING**, NOT A NUMBER CHOSEN HERE.
     *
     * Two reasons, and neither is style:
     *
     *   `§4.1`'S "DO NOT INVENT A NUMBER" applies to a poll budget as much as to a
     *   visibility bound. `observation.ts` already declares what the loop may spend, with the
     *   published 6-requests-per-minute rate limit behind `MIN_OBSERVATION_INTERVAL_MS`, and a
     *   second set of figures here would be a second, unreviewed policy.
     *
     *   `§19`, `§33` — the validation package carries NO RETRY CONSTRUCT, and
     *   `tests/sendgrid/provider-boundary.test.ts` enforces that across every file in it by
     *   refusing a numeric attempt-count literal. A live composition writing its own would be
     *   indistinguishable, to that scan, from a send retry.
     *
     * A live run really does wait between attempts: `delay` below is a real timer, not the
     * offline fixture's already-resolved promise.
     */
    observationBound: {
      maxAttempts: MAX_OBSERVATION_ATTEMPTS,
      intervalMs: MIN_OBSERVATION_INTERVAL_MS,
      maxDurationMs: MAX_OBSERVATION_DURATION_MS,
      maxRecords: LIVE_ACTIVITY_PAGE_RECORDS,
      stabilisationObservations: MIN_STABILISATION_OBSERVATIONS,
    },
    visibilityBound: liveBound,
    ...(signedPushEvidence === undefined ? {} : { signedPushEvidence }),
  };

  return {
    runtime,
    ports,
    close: async (): Promise<void> => {
      for (const handle of open) await handle.close();
      await pool.end();
      if (evidencePool !== null) await evidencePool.end();
    },
  };
}

/** The provider the CLI uses when nothing is injected. `§1.4`'s default arm. */
export function createLiveScenarioComposition(): ScenarioCompositionProvider {
  return Object.freeze({
    label: 'LIVE SendGrid non-production composition',
    describe: describeLiveComposition,
    open: openLiveComposition,
  });
}

/** The bound a live run uses. Exported so `cli.ts` never names a fixture value. */
export const LIVE_VISIBILITY_BOUND = SENDGRID_LIVE_VISIBILITY_BOUND;
