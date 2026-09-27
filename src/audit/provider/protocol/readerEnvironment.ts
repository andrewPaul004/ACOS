import { AUDIT_READ_PROTOCOL_VERSION } from './readWire.js';
import { auditProviderReaderIdentity } from './readerIdentity.js';

/**
 * `§13`, `§14`, `§17` — THE AUDIT READER'S CHILD ENVIRONMENT, AS A CLOSED ALLOWLIST.
 *
 * =================================================================================
 * THE ALLOWLIST IS SEPARATE FROM THE INTEGRATION PLANE'S, AND THE SEPARATION IS THE POINT
 *
 * `§14`: the audit runtime needs "separate OS process / architecture-equivalent trust
 * boundary; **separate credential source**; **separate environment allowlist**; **no control
 * send credential**; no write capability; no reliance on control adapter result."
 *
 * Every KEY NAME below is distinct from every key in
 * `src/integration/protocol/runtimeEnvironment.ts`, and that is not cosmetic. A shared key
 * name is a shared slot: a deployment that populated `ACOS_INTEGRATION_SECRET_LOCATOR` for
 * the sender and launched a reader inheriting it would hand the audit plane the SEND
 * credential's locator, and every later assertion about the audit plane's independence
 * would be true of a process pointing at the wrong secret.
 *
 * `auditAllowlistIsDisjointFromIntegration()` asserts the disjointness by COMPUTATION rather
 * than by reading, so a future key added to either list without checking the other fails the
 * boundary suite rather than the next audit.
 *
 * =================================================================================
 * CONSTRUCTED, NOT FILTERED — THE SAME RULE S1N ESTABLISHED, FOR A SHARPER REASON HERE
 *
 * `buildAuditReaderEnvironment` returns a fresh object whose keys are exactly
 * `AUDIT_READER_ENV_KEYS`, and the plane's client passes it as `env` to `fork`, which
 * REPLACES the environment rather than extending it.
 *
 * The parent of an audit reader is the AUDIT PLANE, and its environment in a real deployment
 * holds `ACOS_AUDIT_PG_URL` — the audit store's own credential, the one thing whose
 * compromise makes the second hash chain worthless. A denylist of likely secret names would
 * be a list of the secrets somebody thought of; this list is the whole of what a reader
 * sees.
 *
 * =================================================================================
 * AND THERE IS NO KEY THROUGH WHICH A CONTROL-PLANE VERDICT COULD ARRIVE
 *
 * `§14`: "Do not make audit verification depend on a control-plane `verified=true`."
 *
 * The list carries a protocol version, an identity, a provider id, a confinement root, two
 * module specifiers, one locator and two echoes of the AUDIT PLANE'S OWN reading of the
 * signed class-5 record — its risk class and its `credential_id`. There is no
 * `ACOS_CONTROL_*` key, no effect id, no outbox id and no expected outcome, so a reader has
 * no environment slot a control-plane belief could occupy even if a deployment wanted to
 * pass one. **Both echoes are produced by this plane's own verifier, never by the control
 * plane's**, which is what keeps `§14`'s independence a fact about the graph.
 * =================================================================================
 */

/** The protocol version, restated into the child so a mismatched pair cannot start. */
export const ENV_AUDIT_PROTOCOL_VERSION = 'ACOS_AUDIT_READ_PROTOCOL_VERSION';
/** `AUDIT_PROVIDER_READER:<provider_id>`. */
export const ENV_AUDIT_READER_IDENTITY = 'ACOS_AUDIT_READER_IDENTITY';
/** The ONE provider identity this reader serves. */
export const ENV_AUDIT_PROVIDER_ID = 'ACOS_AUDIT_PROVIDER_ID';
/** `29 §3.5`'s confinement root, applied to the audit plane's own reader package. */
export const ENV_AUDIT_RUNTIME_ROOT = 'ACOS_AUDIT_READER_RUNTIME_ROOT';
/** The reader module specifier. TRUSTED LAUNCH CONFIGURATION, never message content. */
export const ENV_AUDIT_READER_MODULE = 'ACOS_AUDIT_READER_MODULE';
/** The read-only secret-source module specifier. Same provenance, same confinement. */
export const ENV_AUDIT_SECRET_SOURCE_MODULE = 'ACOS_AUDIT_READ_SECRET_SOURCE_MODULE';
/**
 * The audit read credential's LOCATOR — never the material.
 *
 * `§13`: "Do not put audit credentials into: [...] **same secret source as send
 * credential**." The locator names a source in the AUDIT plane's own deployment boundary,
 * and `auditReaderRegistry.ts` refuses a descriptor whose locator equals any locator the
 * integration registry holds.
 */
export const ENV_AUDIT_SECRET_LOCATOR = 'ACOS_AUDIT_READ_SECRET_LOCATOR';
/**
 * The signed class-5 `credential_risk_class` this reader's credential carries.
 *
 * **THIS IS NOT THE AUTHORITY, AND THE RUNTIME TREATS IT AS A CROSS-CHECK.** `50 §2g`: "no
 * provider response, account response, adapter self-description, **environment variable**,
 * caller parameter or model output may supply, override or widen any of the seven fields."
 *
 * So the value here is an ECHO of what the AUDIT PLANE's parent read out of the verified
 * bundle before it forked, and the child's only use for it is to refuse to start when it is
 * not `READ_ONLY`. It cannot WIDEN anything: a child whose environment said
 * `NON_MONETARY_WRITE` refuses to start, and a child whose environment said `READ_ONLY`
 * while the bundle said otherwise never gets forked, because the parent checks the bundle
 * first and the parent is the only producer of this variable.
 *
 * `tests/negative-controls/unsafe-credential-risk.ts` holds the implementation that reads
 * the class from here INSTEAD of from the bundle, which is the attack this comment describes.
 */
export const ENV_AUDIT_CREDENTIAL_RISK_CLASS = 'ACOS_AUDIT_CREDENTIAL_RISK_CLASS_ECHO';
/**
 * `50 §2g` FIELD 1 — THE SIGNED EXPECTED CREDENTIAL IDENTITY, AS A TRUSTED LAUNCH ECHO.
 *
 * =================================================================================
 * THE SECOND ECHO, AND IT ANSWERS A QUESTION THE FIRST ONE CANNOT
 *
 * `ENV_AUDIT_CREDENTIAL_RISK_CLASS` carries WHAT CLASS the signed record declares. This one
 * carries WHICH CREDENTIAL that record is about, and the gap between the two is the defect
 * this correction closes: a reader can start under a genuine `READ_ONLY` echo, from a
 * genuine `audit_plane`-scoped signed record, with a locator genuinely disjoint from the
 * integration plane's — and still resolve a send-capable token, because nothing compared the
 * material in its hand to the record that governs it.
 *
 * **IT IS NOT AUTHORITY.** The AUDIT PLANE's own verifier read the class-5 bytes
 * (`auditPlaneVerifier.ts`, from this plane's own copy, sharing no module with the control
 * plane), `createAuditReaderRegistry` selected the record and refused every descriptor that
 * did not match it, and only then does `auditReadClient.ts` fork. This value is the parent's
 * echo of a decision already taken, and the child's one use for it is the comparison the
 * parent cannot make, because the parent never holds resolved material.
 *
 * **IT CAN ONLY NARROW**, exactly as the risk-class echo can: the child compares the echo to
 * what its source resolved, and any disagreement refuses.
 *
 * **AND IT IS AN IDENTITY, NEVER MATERIAL.** No credential material travels in any
 * environment or on any IPC channel, on either plane.
 */
export const ENV_AUDIT_EXPECTED_CREDENTIAL_ID = 'ACOS_AUDIT_EXPECTED_CREDENTIAL_ID';

/** THE CLOSED ALLOWLIST. Nine keys. A reader sees these and, from ACOS, nothing else. */
export const AUDIT_READER_ENV_KEYS = [
  ENV_AUDIT_PROTOCOL_VERSION,
  ENV_AUDIT_READER_IDENTITY,
  ENV_AUDIT_PROVIDER_ID,
  ENV_AUDIT_RUNTIME_ROOT,
  ENV_AUDIT_READER_MODULE,
  ENV_AUDIT_SECRET_SOURCE_MODULE,
  ENV_AUDIT_SECRET_LOCATOR,
  ENV_AUDIT_CREDENTIAL_RISK_CLASS,
  ENV_AUDIT_EXPECTED_CREDENTIAL_ID,
] as const;

export type AuditReaderEnvKey = (typeof AUDIT_READER_ENV_KEYS)[number];

/**
 * The OS variables the platform adds to any child regardless of the `env` option.
 *
 * Declared so the boundary assertion can be an EQUALITY rather than a containment, exactly
 * as `runtimeEnvironment.ts` does. Empty on POSIX, where `env` genuinely replaces.
 */
export const PLATFORM_INJECTED_ENV_KEYS: readonly string[] =
  process.platform === 'win32'
    ? [
        'HOMEDRIVE',
        'HOMEPATH',
        'LOGONSERVER',
        'PATH',
        'SYSTEMDRIVE',
        'SYSTEMROOT',
        'TEMP',
        'TMP',
        'USERDOMAIN',
        'USERNAME',
        'USERPROFILE',
        'WINDIR',
      ]
    : [];

/**
 * The integration plane's eight keys, TRANSCRIBED rather than imported.
 *
 * An import would make the audit reader's module graph contain the integration plane's
 * protocol package, which is the coupling `readWire.ts`'s header refuses. Two independent
 * transcriptions of one list disagree loudly; one shared constant cannot disagree at all,
 * and the disagreement is what `tests/integration/audit/audit-plane-packaging.test.ts`
 * checks — against the real integration module, from the TEST's graph, where the import is
 * harmless.
 */
export const INTEGRATION_ENV_KEYS_FOR_DISJOINTNESS: readonly string[] = Object.freeze([
  'ACOS_INTEGRATION_PROTOCOL_VERSION',
  'ACOS_INTEGRATION_RUNTIME_IDENTITY',
  'ACOS_INTEGRATION_ADAPTER_ID',
  'ACOS_INTEGRATION_RUNTIME_ROOT',
  'ACOS_INTEGRATION_ADAPTER_MODULE',
  'ACOS_INTEGRATION_SECRET_SOURCE_MODULE',
  'ACOS_INTEGRATION_SECRET_LOCATOR',
  'ACOS_INTEGRATION_EXPECTED_CREDENTIAL_ID',
]);

/** `§14`'s "separate environment allowlist", as a computation rather than an observation. */
export function auditAllowlistIsDisjointFromIntegration(): boolean {
  const integration = new Set(INTEGRATION_ENV_KEYS_FOR_DISJOINTNESS);
  return AUDIT_READER_ENV_KEYS.every((key) => !integration.has(key));
}

/** Everything a reader needs to exist, and nothing a request could influence. */
export interface AuditReaderLaunchConfiguration {
  readonly providerId: string;
  readonly runtimeRoot: string;
  readonly readerModule: string;
  readonly secretSourceModule: string;
  readonly secretLocator: string;
  readonly credentialRiskClass: string;
  /**
   * `50 §2g` field 1, as the AUDIT PLANE's own verifier read it out of the class-5 record.
   *
   * LOCATOR ISOLATION AND CREDENTIAL IDENTITY BINDING ARE DIFFERENT CONTROLS AND BOTH ARE
   * KEPT. `createAuditReaderRegistry` still refuses a locator the integration plane holds;
   * this value makes the reader refuse material that is not the credential the signed record
   * governs, which a locator comparison cannot decide either way.
   */
  readonly expectedCredentialId: string;
}

/**
 * Build the child's complete environment. THE ONLY PRODUCER, AND IT READS NOTHING.
 *
 * It has no access to `process.env`, no parameter that could carry one, and no branch that
 * adds a key. A future change wanting to pass one more variable has to add it to
 * `AUDIT_READER_ENV_KEYS` first, which is the list the boundary test asserts by hand and the
 * list `auditAllowlistIsDisjointFromIntegration` re-checks against the other plane.
 */
export function buildAuditReaderEnvironment(
  configuration: AuditReaderLaunchConfiguration,
): Readonly<Record<AuditReaderEnvKey, string>> {
  return Object.freeze({
    [ENV_AUDIT_PROTOCOL_VERSION]: AUDIT_READ_PROTOCOL_VERSION,
    [ENV_AUDIT_READER_IDENTITY]: auditProviderReaderIdentity(configuration.providerId),
    [ENV_AUDIT_PROVIDER_ID]: configuration.providerId,
    [ENV_AUDIT_RUNTIME_ROOT]: configuration.runtimeRoot,
    [ENV_AUDIT_READER_MODULE]: configuration.readerModule,
    [ENV_AUDIT_SECRET_SOURCE_MODULE]: configuration.secretSourceModule,
    [ENV_AUDIT_SECRET_LOCATOR]: configuration.secretLocator,
    [ENV_AUDIT_CREDENTIAL_RISK_CLASS]: configuration.credentialRiskClass,
    [ENV_AUDIT_EXPECTED_CREDENTIAL_ID]: configuration.expectedCredentialId,
  });
}
