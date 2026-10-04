import { isOwnerControlledSink } from '../integration/validationPayload.js';

/**
 * `§8.5`, `§4` — THE LIVE-RUN GATE, IN **TWO STAGES**. IT FAILS CLOSED BEFORE ANY NETWORK
 * ACTIVITY AND, NOW, BEFORE ANY CREDENTIAL IS TOUCHED.
 *
 * =================================================================================
 * CORRECTION 4 — THE STAGE SPLIT, AND WHY IT IS A SAFETY PROPERTY AND NOT A TIDINESS ONE
 *
 * The rejected harness called `withResolvedCredentials(establishFacts(...))` and THEN
 * evaluated the gate. Its own comments claimed the opposite — "a run that is going to refuse
 * on its configuration should not have touched a secret source at all" — and the code did the
 * reverse: BOTH vendor credentials were read out of their deployment documents before the
 * harness had checked whether the operator had even acknowledged a live run.
 *
 * Every needless credential read is a needless opportunity: a document read into a process
 * that was always going to refuse, material on a heap that never needed it, a rotation window
 * touched by a run that was not entitled to run. `§4`: "Do not touch credentials before cheap
 * gates pass."
 *
 * SO THE GATE IS TWO FUNCTIONS OVER TWO FACT RECORDS:
 *
 *   STAGE 1 — `evaluateStage1` over `Stage1Facts`. EVERYTHING ESTABLISHABLE WITHOUT
 *             CREDENTIAL MATERIAL: the verified bundle, the provider, the declared credential
 *             identities, the signed class-5 records and their risk classes, the signed
 *             class-3 adapter, Option-A's runtime count, the non-production acknowledgement,
 *             sender and sink safety, the entitlement acknowledgement, the live
 *             acknowledgement, the duplicate acknowledgement and sandbox impossibility.
 *             **IF ANY STAGE-1 GATE FAILS, NO CREDENTIAL IS RESOLVED AND NO
 *             CREDENTIAL-HOLDING CHILD IS STARTED.**
 *
 *   STAGE 2 — `evaluateStage2` over `Stage2Facts`. ONLY the credential-identity questions,
 *             and only over facts that a ONE-SHOT CREDENTIAL PROCESS established
 *             (`probeRuntime.ts`, correction 5). The coordinator that runs this function
 *             holds no material; it holds two non-secret identities and two provenances.
 *
 * =================================================================================
 * PURE, TOTAL, AND DELIBERATELY WITHOUT I/O
 *
 * Neither evaluator reads a file, resolves a secret, opens a socket or calls a provider. Each
 * takes a record of FACTS the CLI has already established and returns the list of gates that
 * failed, so `tests/sendgrid/preflight.test.ts` drives every refusal with a plain object,
 * offline. A gate that could only be exercised by standing up an account is a gate nobody
 * exercises.
 *
 * **A REFUSAL IS THE DEFAULT, NOT THE EXCEPTION.** Both evaluators ACCUMULATE failures and
 * both `permits` predicates require the list to be EMPTY — so a gate that a future edit
 * forgets to evaluate contributes nothing to a pass, and a fact the CLI could not establish
 * arrives as `false`/`null` and refuses.
 *
 * =================================================================================
 * THE SECRETS ARE NOT HERE, AND NOT BY ACCIDENT
 *
 * `Stage2Facts` carries two credential IDENTITIES and no material. `§8.5`: "Do not print
 * secrets. Do not persist secrets in evidence." A gate function that took the keys in order
 * to check they were different would be a function with two keys in its frame and a
 * stringified argument list one debugger away from a log; comparing IDENTITIES answers the
 * same question, and the identities are non-secret by `50 §2g` field 1's own definition.
 * =================================================================================
 */

/**
 * THE PROVENANCES THAT MAY CARRY A REAL LIVE RUN — TRANSCRIBED, NOT IMPORTED.
 *
 * =================================================================================
 * WHY THIS LIST IS HERE RATHER THAN IMPORTED FROM THE TWO SECRET SOURCES
 *
 * The rejected preflight imported `isLiveIdentityProvenance` from the integration secret
 * source and `isLiveAuditIdentityProvenance` from the audit one — which put BOTH credential
 * sources into the coordinator's import closure, because `cli.ts` imports this file.
 *
 * Correction 5 requires the coordinator to hold ZERO vendor credential material, and the
 * strongest form of that is the one `tests/sendgrid/credential-process-isolation.test.ts`
 * asserts: the coordinator cannot REACH a secret source at all. A process that cannot import
 * one cannot resolve one, whatever its control flow does — and a two-member list of enum
 * names was a poor reason to give it the capability.
 *
 * So the list is transcribed, exactly as `adapterSecretSource.ts` transcribes the same
 * provenance set for the integration runtime and for the same reason. Two independent
 * transcriptions of one closed list disagree loudly:
 * `tests/sendgrid/credential-binding.test.ts` asserts this one against BOTH planes' own
 * mechanism maps, from a test process where importing everything is harmless.
 * =================================================================================
 */
export const LIVE_IDENTITY_PROVENANCES: readonly string[] = Object.freeze([
  'PROVIDER_KEY_ID',
  'DEPLOYMENT_SECRET_VERSION',
]);

/**
 * Whether a declared provenance may govern a real provider credential.
 *
 * `SYNTHETIC_TEST_IDENTITY` is absent from the list above, and its absence is the point: a
 * file-backed source assigns exactly that provenance (correction 3), so a live run on a
 * fixture credential refuses here.
 */
export function isLiveIdentityProvenance(value: unknown): boolean {
  return typeof value === 'string' && LIVE_IDENTITY_PROVENANCES.includes(value);
}

/**
 * The audit plane's own predicate. A SECOND name over the SAME list, deliberately.
 *
 * `§3.4`: "Apply the same correction independently to integration and audit credentials." Two
 * names mean a future decision to admit a provenance on one plane and not the other is a
 * one-line change here rather than a refactor — and it means a reader of the two gates below
 * can see that the planes are judged separately.
 */
export function isLiveAuditIdentityProvenance(value: unknown): boolean {
  return typeof value === 'string' && LIVE_IDENTITY_PROVENANCES.includes(value);
}

/** Every STAGE-1 gate, as a closed enum. A gate is named or it does not exist. */
export const STAGE_1_GATES = [
  /** `50 §3f`: without a verified bundle there is no signed class-3 and no signed class-5. */
  'CONTROL_ARTIFACT_BUNDLE_UNAVAILABLE',
  /** `§8.5`: "provider = SendGrid". */
  'PROVIDER_NOT_SENDGRID',
  /** The trusted deployment configuration could not be read at all. */
  'DEPLOYMENT_CONFIGURATION_UNREADABLE',
  /**
   * `§7` — THE EXPLICIT NON-PRODUCTION ACKNOWLEDGEMENT.
   *
   * NOT inferred from a parseable document, an environment label, a sender address or the
   * sink marker. The operator states, in one sentence they had to type, that the account or
   * subuser is a dedicated non-production sending identity, that the sink is owner-controlled
   * and that no customer or production recipient is involved.
   */
  'NON_PRODUCTION_NOT_ACKNOWLEDGED',
  /** `§16`: the run has no safely-non-secret environment identifier to put in evidence. */
  'NON_PRODUCTION_ENVIRONMENT_LABEL_ABSENT',
  /** `§8.6`: sandbox mode must NOT be enabled. S1O: it suppresses the I36 evidence. */
  'SANDBOX_MODE_ENABLED',
  /**
   * CORRECTION 6 — the run must NAME the exact credential it expects, per plane.
   *
   * Absent, the harness would be back to scanning the signed class-5 declaration for
   * "whichever record mentions this adapter", which is a guess whenever there is more than
   * one.
   */
  'INTEGRATION_CREDENTIAL_ID_NOT_CONFIGURED',
  'AUDIT_CREDENTIAL_ID_NOT_CONFIGURED',
  /** Two planes naming ONE credential identity. `§13` of S1O forbids the composition. */
  'CONFIGURED_CREDENTIAL_IDS_NOT_DISTINCT',
  /** `§8.5`: "class-5 declarations exist" — for the EXACT configured identities. */
  'INTEGRATION_CLASS_5_RECORD_ABSENT',
  'AUDIT_CLASS_5_RECORD_ABSENT',
  /** The signed record for the configured integration identity binds it to another adapter. */
  'INTEGRATION_CLASS_5_RECORD_ADAPTER_MISMATCH',
  /** The signed audit record is not the audit plane's reserved sentinel, or another provider. */
  'AUDIT_CLASS_5_RECORD_SCOPE_MISMATCH',
  /** `50 §2g` / ADR-024: the risk classes must keep option A legal. */
  'INTEGRATION_CREDENTIAL_NOT_OPTION_A_LEGAL',
  'AUDIT_CREDENTIAL_NOT_READ_ONLY',
  /**
   * ADR-024's option-B adapter-count trigger, evaluated on the runtimes THIS RUN CONFIGURES.
   *
   * `OPTION_A_MAX_ADAPTER_RUNTIMES` is two. A validation run that configured a third
   * integration runtime would have crossed into option B, where the execution proxy is
   * required and S1P's composition is not the accepted one.
   */
  'OPTION_A_RUNTIME_COUNT_EXCEEDED',
  /**
   * The signed class-3 catalogue must name the adapter a SendGrid descriptor would register.
   *
   * `createAdapterRuntimeRegistry` raises `ADAPTER_NOT_IN_CATALOGUE` without it. The gate is
   * restated here so the harness can say WHY it stopped before it constructs a registry that
   * throws.
   */
  'ADAPTER_NOT_IN_SIGNED_CATALOGUE',
  /** The signed class-3 record for `email.send` must name THIS adapter and THIS method. */
  'SIGNED_CLASS_3_OPERATION_MISMATCH',
  /** `§8.5`: "required sender identity/config exists". */
  'SENDER_IDENTITY_ABSENT',
  /** `§8.5`: "explicit owner-controlled test sink is supplied". */
  'SINK_ABSENT_OR_NOT_OWNER_CONTROLLED',
  /** `§8.5`: no production/customer target through ordinary production state. */
  'PRODUCTION_TARGET_REACHABLE',
  /** `§8.5`: "Email Activity capability/entitlement can be tested". */
  'EMAIL_ACTIVITY_ENTITLEMENT_UNCONFIRMED',
  /** `§8.5`: "live operation is explicitly opted into". */
  'LIVE_RUN_NOT_OPTED_IN',
  /** `§11`: the duplicate negative control needs a SECOND, separate opt-in. */
  'DUPLICATE_CONTROL_NOT_SEPARATELY_OPTED_IN',
  /**
   * `§11.1` — THE SCENARIO DRIVER NEEDS A CONTROL-PLANE COMPOSITION, AND THIS REPOSITORY
   * SHIPS NONE.
   *
   * The driver must traverse the ACCEPTED path: a committed local authorisation, step R's
   * reservation, the durable outbox, the Effect Gateway, a dispatch lease and a live
   * enumerator. Those are the property of a DEPLOYMENT's composition root, and `src/` has
   * never contained one — `no-real-transport-boundary.test.ts` asserts that production holds
   * no adapter implementation at all, which is the same fact from the other side.
   *
   * So the harness refuses rather than improvising one. `scenarioDriver.ts` is written,
   * compiled and fully exercised offline against the accepted test composition; what is
   * missing is a LIVE composition, and a run that invented one would be validating a
   * composition no deployment uses.
   */
  'CONTROL_PLANE_COMPOSITION_UNAVAILABLE',
  /**
   * v1.3.8, `50 §2h` — the VERIFIED class-28 record declares no evidence channel for SendGrid,
   * so there is no signed answer to which provider-evidence requirements are active. Every
   * read-mode gate is ALSO evaluated in this case: an undeclared mode never relaxes anything.
   */
  'PROVIDER_EVIDENCE_MODE_UNDECLARED',
  /**
   * ADR-027, `SIGNED_PROVIDER_PUSH` — no audit evidence store (`ACOS_AUDIT_PG_URL`) is
   * configured, so the push oracle has nowhere to read authenticated evidence from.
   */
  'AUDIT_EVIDENCE_STORE_NOT_CONFIGURED',
  /**
   * `SIGNED_PROVIDER_PUSH` — the AUDIT plane's OWN verification of class 28 did not bind the SAME
   * class-28 artifact as the control bundle (their exact-byte content hashes differ), did not name
   * the same push channel, or could not run. `50 §3` property 2: the audit plane recomputes
   * independently, and the two copies must be one artifact, not merely share a key.
   */
  'AUDIT_PLANE_EVIDENCE_CHANNEL_DISAGREES',
  /**
   * `SIGNED_PROVIDER_PUSH` — a SendGrid audit READ credential identity or locator was supplied.
   * Under push mode no SendGrid audit credential is required, resolved or used (ADR-027 decision
   * 3); one supplied anyway is a misconfiguration and is refused rather than silently ignored.
   */
  'AUDIT_READ_CREDENTIAL_SUPPLIED_UNDER_SIGNED_PUSH',
] as const;

export type Stage1Gate = (typeof STAGE_1_GATES)[number];

/** Every STAGE-2 gate. Each one needs a credential-holding process to have answered. */
export const STAGE_2_GATES = [
  /** `§8.5`: "integration credential available legally". */
  'INTEGRATION_CREDENTIAL_UNAVAILABLE',
  'AUDIT_CREDENTIAL_UNAVAILABLE',
  /** `§8.5`: the two credentials must be DISTINCT. Compared on identity, never on material. */
  'CREDENTIALS_NOT_DISTINCT',
  /** `§8.5`: "both credential identities resolve and match signed expected IDs". */
  'INTEGRATION_CREDENTIAL_IDENTITY_MISMATCH',
  'AUDIT_CREDENTIAL_IDENTITY_MISMATCH',
  /**
   * `§3` — THE IDENTITY MUST BE MATERIAL-BOUND.
   *
   * The operand is the provenance the SOURCE MECHANISM assigned, never one a document
   * declared (correction 3). A file-backed fixture source reports `SYNTHETIC_TEST_IDENTITY`
   * and fails here; the two binding mechanisms are declared and UNPROVISIONED, so on this
   * repository TODAY these two gates are the ones a live run cannot pass.
   */
  'INTEGRATION_IDENTITY_NOT_MATERIAL_BOUND',
  'AUDIT_IDENTITY_NOT_MATERIAL_BOUND',
  /** The one-shot credential process did not answer. Never a pass. */
  'CREDENTIAL_PROBE_PROCESS_FAILED',
  /*
   * =================================================================================
   * THE AZURE PRINCIPAL GATES. A **SECOND, INDEPENDENT** CONTROL.
   *
   * `CREDENTIALS_NOT_DISTINCT` above asks WHICH SENDGRID MATERIAL each plane resolved. These
   * ask WHICH AZURE PRINCIPAL WAS ALLOWED TO RESOLVE IT, and neither substitutes for the
   * other: two planes can hold two genuinely distinct SendGrid keys behind ONE
   * over-privileged user-assigned managed identity, and that configuration passes the
   * credential-identity check while defeating the separation it exists to create.
   *
   * The owner decision makes distinct managed identities part of the security boundary rather
   * than an operator recommendation, so it is a GATE and it fails closed.
   *
   * The operands are non-secret GUIDs reported BY THE ISOLATED CHILD PROCESSES from their own
   * closed locator parses. The coordinator never reads either locator file.
   * =================================================================================
   */
  /** The integration child could not report the Azure principal it resolves as. */
  'INTEGRATION_SOURCE_PRINCIPAL_UNAVAILABLE',
  /** The audit child could not report the Azure principal it resolves as. */
  'AUDIT_SOURCE_PRINCIPAL_UNAVAILABLE',
  /**
   * **BOTH PLANES RESOLVE AS THE SAME AZURE PRINCIPAL.**
   *
   * One identity able to read both the send key and the audit key is one compromise away from
   * holding both, and `48 §3.6`'s read-only exemption rests on the audit plane being
   * independently reachable. Same principal blocks the matrix.
   */
  'CREDENTIAL_SOURCE_PRINCIPALS_NOT_DISTINCT',
] as const;

export type Stage2Gate = (typeof STAGE_2_GATES)[number];

/** Every gate, for evidence and for the CLI's summary. The union, in stage order. */
export const PREFLIGHT_GATES = [...STAGE_1_GATES, ...STAGE_2_GATES] as const;

export type PreflightGate = Stage1Gate | Stage2Gate;

/**
 * The facts establishable WITHOUT touching a credential. NO MEMBER CARRIES A SECRET, and no
 * member requires one to have been resolved.
 *
 * Every member is `false`/`null` when the CLI could not establish it, which is what makes
 * "could not establish" and "established as unsafe" refuse identically.
 */
export interface Stage1Facts {
  readonly verifiedBundleAvailable: boolean;
  readonly providerId: string;
  readonly deploymentConfigurationRead: boolean;

  /** `§7`: the operator's EXPLICIT dedicated-non-production acknowledgement. */
  readonly nonProductionAcknowledged: boolean;
  /** `§16`: the non-secret environment label, for evidence. Not the declaration. */
  readonly environmentLabel: string | null;
  /** Whether anything in the configuration asks for sandbox mode. Must be `false`. */
  readonly sandboxModeRequested: boolean;

  /** CORRECTION 6: the EXACT expected identities, from the trusted configuration. */
  readonly configuredIntegrationCredentialId: string | null;
  readonly configuredAuditCredentialId: string | null;

  /** The SIGNED class-5 record SELECTED BY the configured integration identity. */
  readonly integrationSignedRecordFound: boolean;
  readonly integrationSignedRecordAdapter: string | null;
  readonly integrationRiskClass: string | null;
  /** The SIGNED class-5 record SELECTED BY the configured audit identity. */
  readonly auditSignedRecordFound: boolean;
  readonly auditSignedRecordAdapter: string | null;
  readonly auditSignedRecordProvider: string | null;
  readonly auditRiskClass: string | null;

  /** Whether the VERIFIED class-3 catalogue names the SendGrid adapter identity. */
  readonly adapterInSignedCatalogue: boolean;
  /** The signed class-3 `adapter` and `method` for `email.send`, as read from the bundle. */
  readonly signedActionClassAdapter: string | null;
  readonly signedActionClassMethod: string | null;

  /** How many integration runtimes this run configures. ADR-024's option-B count trigger. */
  readonly configuredAdapterRuntimeCount: number;

  readonly senderAddress: string | null;
  readonly sinkAddress: string | null;
  /**
   * Whether any recipient could arrive from ordinary production state.
   *
   * `false` by construction in this package — the recipient is bound into the AUTHORISED
   * payload by the isolated validation seeder, which no production route reaches — and
   * carried as a FACT so the CLI has to assert it rather than the reader having to notice it.
   */
  readonly recipientReachableFromProductionState: boolean;
  /** Whether the Email Activity entitlement has been CONFIRMED against the account. */
  readonly emailActivityEntitlementConfirmed: boolean;

  readonly liveRunOptedIn: boolean;
  readonly duplicateControlRequested: boolean;
  readonly duplicateControlOptedIn: boolean;

  /** Whether a deployment supplied the control-plane composition the driver traverses. */
  readonly controlPlaneCompositionAvailable: boolean;

  /**
   * v1.3.8 — THE PROVIDER-EVIDENCE MODE, READ FROM THE VERIFIED CLASS-28 RECORD AND NOTHING
   * ELSE. Not a flag, not an environment variable, not inferred from which credentials are
   * present. `null` when no bundle is available or the record names no SendGrid channel.
   */
  readonly providerEvidenceMode: ProviderEvidenceMode | null;
  /** `SIGNED_PROVIDER_PUSH`: whether the audit evidence store is configured. */
  readonly auditEvidenceStoreConfigured: boolean;
  /**
   * `SIGNED_PROVIDER_PUSH`: whether the audit plane's OWN class-28 verification names the same
   * push channel. `null` when not evaluated (any other mode).
   */
  readonly auditPlaneEvidenceChannelAgrees: boolean | null;
  /** Whether an audit SendGrid READ locator was supplied in the environment. */
  readonly auditReadCredentialReferenceSupplied: boolean;
}

/** `50 §2h` field 2. The two modes the verified class-28 record may select. */
export type ProviderEvidenceMode = 'PROVIDER_READ' | 'SIGNED_PROVIDER_PUSH';

/** The facts only a ONE-SHOT CREDENTIAL PROCESS can establish. Still no material. */
export interface Stage2Facts {
  readonly integrationProbeAnswered: boolean;
  readonly integrationCredentialResolved: boolean;
  readonly integrationResolvedIdentity: string | null;
  readonly integrationIdentityProvenance: string | null;

  readonly auditProbeAnswered: boolean;
  readonly auditCredentialResolved: boolean;
  readonly auditResolvedIdentity: string | null;
  readonly auditIdentityProvenance: string | null;

  /**
   * THE NON-SECRET AZURE PRINCIPAL EACH CHILD REPORTED ABOUT ITSELF.
   *
   * A user-assigned managed-identity client id, parsed by that plane's OWN closed locator
   * parser inside that plane's OWN one-shot process. `null` when the mechanism has none —
   * which `FILE_FIXTURE` always reports, so an offline fixture cannot satisfy a live gate.
   *
   * **NOT READ BY THE COORDINATOR.** A parent that could read a locator file could read
   * whatever an operator had put in it; these arrive on the probe reply, where a GUID is
   * admissible and a token is not.
   */
  readonly integrationSourcePrincipal: string | null;
  readonly auditSourcePrincipal: string | null;

  /** Echoed from stage 1 so the comparison is made here rather than trusted from the child. */
  readonly configuredIntegrationCredentialId: string | null;
  readonly configuredAuditCredentialId: string | null;

  /**
   * The VERIFIED mode, echoed from stage 1. Under `SIGNED_PROVIDER_PUSH` no audit credential
   * process is launched and no audit gate is evaluated; under any other value (including
   * `null`) every read-mode gate applies.
   */
  readonly providerEvidenceMode: ProviderEvidenceMode | null;
}

/** The provider this harness serves, and the only one it will run against. */
export const SENDGRID_PROVIDER_ID = 'twilio_sendgrid';

/** The adapter identity a SendGrid descriptor would register. */
export const SENDGRID_ADAPTER_ID = 'sendgrid_email';

/** The signed class-3 operation this harness validates. */
export const SENDGRID_ACTION_CLASS = 'email.send';
export const SENDGRID_METHOD = 'emailSend';

/** `50 §2g` field 2's reserved audit-plane sentinel. */
export const AUDIT_PLANE_ADAPTER_SENTINEL = 'audit_plane';

/** ADR-024 / `adapterRuntimeRegistry.ts`: option A admits at most two adapter runtimes. */
export const OPTION_A_MAX_ADAPTER_RUNTIMES = 2;

/** `50 §2g`: option A admits `READ_ONLY` and `NON_MONETARY_WRITE`, never `MONEY_MOVING`. */
const OPTION_A_LEGAL_RISK_CLASSES: readonly string[] = Object.freeze([
  'READ_ONLY',
  'NON_MONETARY_WRITE',
]);

/** Evaluate every STAGE-1 gate. Returns the FAILURES; an empty list is the only pass. */
export function evaluateStage1(facts: Stage1Facts): readonly Stage1Gate[] {
  const failures: Stage1Gate[] = [];

  if (!facts.verifiedBundleAvailable) failures.push('CONTROL_ARTIFACT_BUNDLE_UNAVAILABLE');
  if (facts.providerId !== SENDGRID_PROVIDER_ID) failures.push('PROVIDER_NOT_SENDGRID');
  if (!facts.deploymentConfigurationRead) failures.push('DEPLOYMENT_CONFIGURATION_UNREADABLE');

  /*
   * `§7` — THE DECLARATION IS THE ACKNOWLEDGEMENT, AND THE LABEL IS ONLY EVIDENCE.
   *
   * Two separate gates, deliberately. A run with a label and no acknowledgement has told the
   * evidence which environment it used and told nobody that the environment is dedicated
   * non-production; a run with an acknowledgement and no label has made the claim and left a
   * reviewer unable to say which account it was about. Both are refusals, and collapsing them
   * into one would let a parseable document look like a declaration — which is the defect.
   */
  if (!facts.nonProductionAcknowledged) failures.push('NON_PRODUCTION_NOT_ACKNOWLEDGED');
  if (facts.environmentLabel === null || facts.environmentLabel.length === 0) {
    failures.push('NON_PRODUCTION_ENVIRONMENT_LABEL_ABSENT');
  }
  if (facts.sandboxModeRequested) failures.push('SANDBOX_MODE_ENABLED');

  /*
   * v1.3.8 — WHICH PROVIDER-EVIDENCE REQUIREMENTS ARE ACTIVE IS DECIDED BY THE SIGNED CLASS-28
   * MODE. `SIGNED_PROVIDER_PUSH` replaces the read-side gates with the push-side ones; ANY OTHER
   * VALUE — `PROVIDER_READ`, or no declared mode at all — evaluates every read-side gate exactly
   * as before. An undeclared mode is its own refusal and never relaxes anything.
   */
  const push = facts.providerEvidenceMode === 'SIGNED_PROVIDER_PUSH';
  if (facts.providerEvidenceMode === null) failures.push('PROVIDER_EVIDENCE_MODE_UNDECLARED');

  // CORRECTION 6 — the exact identities, declared.
  const integrationId = facts.configuredIntegrationCredentialId;
  const auditId = facts.configuredAuditCredentialId;
  if (integrationId === null || integrationId.length === 0) {
    failures.push('INTEGRATION_CREDENTIAL_ID_NOT_CONFIGURED');
  }
  if (push) {
    // NO SendGrid audit credential exists under push. One supplied is refused, not ignored.
    if ((auditId !== null && auditId.length > 0) || facts.auditReadCredentialReferenceSupplied) {
      failures.push('AUDIT_READ_CREDENTIAL_SUPPLIED_UNDER_SIGNED_PUSH');
    }
    if (!facts.auditEvidenceStoreConfigured) failures.push('AUDIT_EVIDENCE_STORE_NOT_CONFIGURED');
    if (facts.auditPlaneEvidenceChannelAgrees !== true) {
      failures.push('AUDIT_PLANE_EVIDENCE_CHANNEL_DISAGREES');
    }
  } else {
    if (auditId === null || auditId.length === 0) {
      failures.push('AUDIT_CREDENTIAL_ID_NOT_CONFIGURED');
    }
    if (integrationId !== null && auditId !== null && integrationId === auditId) {
      failures.push('CONFIGURED_CREDENTIAL_IDS_NOT_DISTINCT');
    }
  }

  if (!facts.integrationSignedRecordFound) {
    failures.push('INTEGRATION_CLASS_5_RECORD_ABSENT');
  } else {
    if (facts.integrationSignedRecordAdapter !== SENDGRID_ADAPTER_ID) {
      failures.push('INTEGRATION_CLASS_5_RECORD_ADAPTER_MISMATCH');
    }
    if (
      facts.integrationRiskClass === null ||
      !OPTION_A_LEGAL_RISK_CLASSES.includes(facts.integrationRiskClass)
    ) {
      failures.push('INTEGRATION_CREDENTIAL_NOT_OPTION_A_LEGAL');
    }
  }

  if (push) {
    // UNDER PUSH THERE IS NO AUDIT CLASS-5 RECORD TO REQUIRE: ADR-027 decision 3.
  } else if (!facts.auditSignedRecordFound) {
    failures.push('AUDIT_CLASS_5_RECORD_ABSENT');
  } else {
    if (
      facts.auditSignedRecordAdapter !== AUDIT_PLANE_ADAPTER_SENTINEL ||
      facts.auditSignedRecordProvider !== SENDGRID_PROVIDER_ID
    ) {
      failures.push('AUDIT_CLASS_5_RECORD_SCOPE_MISMATCH');
    }
    if (facts.auditRiskClass !== 'READ_ONLY') failures.push('AUDIT_CREDENTIAL_NOT_READ_ONLY');
  }

  if (facts.configuredAdapterRuntimeCount > OPTION_A_MAX_ADAPTER_RUNTIMES) {
    failures.push('OPTION_A_RUNTIME_COUNT_EXCEEDED');
  }

  if (!facts.adapterInSignedCatalogue) failures.push('ADAPTER_NOT_IN_SIGNED_CATALOGUE');
  if (
    facts.signedActionClassAdapter !== SENDGRID_ADAPTER_ID ||
    facts.signedActionClassMethod !== SENDGRID_METHOD
  ) {
    /*
     * CORRECTION 17'S PREFLIGHT HALF.
     *
     * The adapter refuses an invocation that does not name the signed operation. This gate
     * refuses a RUN whose signed record does not name the operation the adapter implements,
     * so a class-3 edit that repointed `email.send` at another adapter or renamed its method
     * stops the harness at stage 1 rather than producing refusals at every dispatch.
     */
    failures.push('SIGNED_CLASS_3_OPERATION_MISMATCH');
  }

  if (facts.senderAddress === null || facts.senderAddress.length === 0) {
    failures.push('SENDER_IDENTITY_ABSENT');
  }
  if (facts.sinkAddress === null || !isOwnerControlledSink(facts.sinkAddress)) {
    failures.push('SINK_ABSENT_OR_NOT_OWNER_CONTROLLED');
  }
  if (facts.recipientReachableFromProductionState) failures.push('PRODUCTION_TARGET_REACHABLE');
  // The paid Email Activity entitlement is a PROVIDER_READ prerequisite only (ADR-027).
  if (!push && !facts.emailActivityEntitlementConfirmed) {
    failures.push('EMAIL_ACTIVITY_ENTITLEMENT_UNCONFIRMED');
  }

  if (!facts.liveRunOptedIn) failures.push('LIVE_RUN_NOT_OPTED_IN');
  /*
   * `§11` — THE SECOND OPT-IN IS REQUIRED ONLY WHEN THE DUPLICATE CONTROL IS REQUESTED,
   * AND IT IS A SECOND ONE.
   *
   * "explicit second opt-in beyond ordinary live validation." A run that does not ask for the
   * duplicate control is not gated on it; a run that asks for it and supplied only the
   * ordinary acknowledgement is refused, because the ordinary acknowledgement is consent to a
   * safe validation and this is consent to deliberately provoking a duplicate.
   */
  if (facts.duplicateControlRequested && !facts.duplicateControlOptedIn) {
    failures.push('DUPLICATE_CONTROL_NOT_SEPARATELY_OPTED_IN');
  }

  if (!facts.controlPlaneCompositionAvailable) {
    failures.push('CONTROL_PLANE_COMPOSITION_UNAVAILABLE');
  }

  return Object.freeze(failures);
}

/** THE ONLY STAGE-1 PASS: an empty failure list. */
export function stage1PermitsCredentialResolution(facts: Stage1Facts): boolean {
  return evaluateStage1(facts).length === 0;
}

/** Evaluate every STAGE-2 gate. Only reachable when stage 1 returned no failures. */
export function evaluateStage2(facts: Stage2Facts): readonly Stage2Gate[] {
  /*
   * v1.3.8 — UNDER `SIGNED_PROVIDER_PUSH` ONLY THE INTEGRATION CREDENTIAL EXISTS.
   *
   * No audit credential process was launched, so there is no audit identity, provenance or
   * principal to require and no cross-plane distinctness to compare. Every INTEGRATION gate is
   * evaluated exactly as in read mode. Any other mode value evaluates the full read-mode set.
   */
  if (facts.providerEvidenceMode === 'SIGNED_PROVIDER_PUSH') return evaluatePushStage2(facts);

  const failures: Stage2Gate[] = [];

  if (!facts.integrationProbeAnswered || !facts.auditProbeAnswered) {
    // A process that did not answer established nothing. It is not a refusal by a source and
    // it is certainly not a pass.
    failures.push('CREDENTIAL_PROBE_PROCESS_FAILED');
  }

  if (!facts.integrationCredentialResolved || facts.integrationResolvedIdentity === null) {
    failures.push('INTEGRATION_CREDENTIAL_UNAVAILABLE');
  }
  if (!facts.auditCredentialResolved || facts.auditResolvedIdentity === null) {
    failures.push('AUDIT_CREDENTIAL_UNAVAILABLE');
  }

  /*
   * DISTINCTNESS IS CHECKED ON IDENTITY, AND `null` IS NOT EQUAL TO `null` HERE.
   *
   * Two unresolved credentials are not "distinct"; they are two absences, and treating them
   * as passing this gate would let a run whose credentials both failed to resolve clear the
   * one gate that exists to stop the audit plane and the send plane sharing a key.
   */
  if (
    facts.integrationResolvedIdentity === null ||
    facts.auditResolvedIdentity === null ||
    facts.integrationResolvedIdentity === facts.auditResolvedIdentity
  ) {
    failures.push('CREDENTIALS_NOT_DISTINCT');
  }

  /*
   * THE AZURE PRINCIPAL GATES. INDEPENDENT OF THE CREDENTIAL-IDENTITY GATE ABOVE.
   *
   * `null` is an ABSENCE, not a value: two planes that both failed to report a principal are
   * not "distinct", and treating them as passing would let a misconfigured pair clear the one
   * gate that stops a single Azure identity reading both vendor credentials.
   */
  if (facts.integrationSourcePrincipal === null) {
    failures.push('INTEGRATION_SOURCE_PRINCIPAL_UNAVAILABLE');
  }
  if (facts.auditSourcePrincipal === null) {
    failures.push('AUDIT_SOURCE_PRINCIPAL_UNAVAILABLE');
  }
  if (
    facts.integrationSourcePrincipal === null ||
    facts.auditSourcePrincipal === null ||
    facts.integrationSourcePrincipal === facts.auditSourcePrincipal
  ) {
    failures.push('CREDENTIAL_SOURCE_PRINCIPALS_NOT_DISTINCT');
  }

  /*
   * CORRECTION 6'S SECOND HALF — THE COMPARISON IS AGAINST THE **CONFIGURED** IDENTITY.
   *
   * Stage 1 used that identity to SELECT the signed class-5 record; stage 2 compares it to
   * what the credential-holding process actually resolved. A configuration that named the
   * wrong credential therefore fails HERE rather than silently authorising the wrong key, and
   * no step in the chain ever asked "which record mentions this adapter?".
   */
  if (
    facts.configuredIntegrationCredentialId === null ||
    facts.integrationResolvedIdentity === null ||
    facts.configuredIntegrationCredentialId !== facts.integrationResolvedIdentity
  ) {
    failures.push('INTEGRATION_CREDENTIAL_IDENTITY_MISMATCH');
  }
  if (
    facts.configuredAuditCredentialId === null ||
    facts.auditResolvedIdentity === null ||
    facts.configuredAuditCredentialId !== facts.auditResolvedIdentity
  ) {
    failures.push('AUDIT_CREDENTIAL_IDENTITY_MISMATCH');
  }

  if (!isLiveIdentityProvenance(facts.integrationIdentityProvenance)) {
    failures.push('INTEGRATION_IDENTITY_NOT_MATERIAL_BOUND');
  }
  if (!isLiveAuditIdentityProvenance(facts.auditIdentityProvenance)) {
    failures.push('AUDIT_IDENTITY_NOT_MATERIAL_BOUND');
  }

  return Object.freeze(failures);
}

/** `SIGNED_PROVIDER_PUSH` stage 2: the integration credential's gates, and only those. */
function evaluatePushStage2(facts: Stage2Facts): readonly Stage2Gate[] {
  const failures: Stage2Gate[] = [];
  if (!facts.integrationProbeAnswered) failures.push('CREDENTIAL_PROBE_PROCESS_FAILED');
  if (!facts.integrationCredentialResolved || facts.integrationResolvedIdentity === null) {
    failures.push('INTEGRATION_CREDENTIAL_UNAVAILABLE');
  }
  if (facts.integrationSourcePrincipal === null) {
    failures.push('INTEGRATION_SOURCE_PRINCIPAL_UNAVAILABLE');
  }
  if (
    facts.configuredIntegrationCredentialId === null ||
    facts.integrationResolvedIdentity === null ||
    facts.configuredIntegrationCredentialId !== facts.integrationResolvedIdentity
  ) {
    failures.push('INTEGRATION_CREDENTIAL_IDENTITY_MISMATCH');
  }
  if (!isLiveIdentityProvenance(facts.integrationIdentityProvenance)) {
    failures.push('INTEGRATION_IDENTITY_NOT_MATERIAL_BOUND');
  }
  return Object.freeze(failures);
}

/** THE ONLY STAGE-2 PASS: an empty failure list. */
export function stage2PermitsLiveRun(facts: Stage2Facts): boolean {
  return evaluateStage2(facts).length === 0;
}

/**
 * The stage-1 facts a run that has established NOTHING starts from.
 *
 * Every member is the refusing value, so a CLI that forgot to populate a field refuses on it
 * rather than inheriting a permissive default. `tests/sendgrid/preflight.test.ts` asserts
 * that this record fails EVERY gate that can fail without a contradiction.
 */
export const NOTHING_ESTABLISHED: Stage1Facts = Object.freeze({
  verifiedBundleAvailable: false,
  providerId: '',
  deploymentConfigurationRead: false,
  nonProductionAcknowledged: false,
  environmentLabel: null,
  sandboxModeRequested: false,
  configuredIntegrationCredentialId: null,
  configuredAuditCredentialId: null,
  integrationSignedRecordFound: false,
  integrationSignedRecordAdapter: null,
  integrationRiskClass: null,
  auditSignedRecordFound: false,
  auditSignedRecordAdapter: null,
  auditSignedRecordProvider: null,
  auditRiskClass: null,
  adapterInSignedCatalogue: false,
  signedActionClassAdapter: null,
  signedActionClassMethod: null,
  configuredAdapterRuntimeCount: 0,
  senderAddress: null,
  sinkAddress: null,
  recipientReachableFromProductionState: false,
  emailActivityEntitlementConfirmed: false,
  liveRunOptedIn: false,
  duplicateControlRequested: false,
  duplicateControlOptedIn: false,
  controlPlaneCompositionAvailable: false,
  providerEvidenceMode: null,
  auditEvidenceStoreConfigured: false,
  auditPlaneEvidenceChannelAgrees: null,
  auditReadCredentialReferenceSupplied: false,
});

/** The stage-2 facts a run that resolved NOTHING starts from. Refuses on every gate. */
export const NO_CREDENTIAL_FACTS: Stage2Facts = Object.freeze({
  // No child answered, so no principal was established on either plane.
  integrationSourcePrincipal: null,
  auditSourcePrincipal: null,
  integrationProbeAnswered: false,
  integrationCredentialResolved: false,
  integrationResolvedIdentity: null,
  integrationIdentityProvenance: null,
  auditProbeAnswered: false,
  auditCredentialResolved: false,
  auditResolvedIdentity: null,
  auditIdentityProvenance: null,
  configuredIntegrationCredentialId: null,
  configuredAuditCredentialId: null,
  providerEvidenceMode: null,
});
