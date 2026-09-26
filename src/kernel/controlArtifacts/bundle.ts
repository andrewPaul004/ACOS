import type {
  ActionClass,
  Recoverability,
  ReasonCode,
  ReasonCodeScope,
  SettlementTolerance,
  ValueDirection,
} from '../canonicalisation/actionClasses.js';
import type { CredentialRiskClass } from './credentialRisk.js';
import { integrityFailure } from './errors.js';

/**
 * `VerifiedControlArtifactBundle` — `50 §3f`'s occasion-3 capability.
 *
 * =================================================================================
 * `50 §3f`, verbatim
 *
 *   "**Production authority code receives only a `VerifiedControlArtifactBundle`** — an
 *    immutable capability whose existence is proof that occasion 1 or occasion 2 completed
 *    successfully for the bytes it carries."
 *
 *   "**Raw or unverified artifact loaders are NOT EXPOSED TO AUTHORITY CONSUMERS**, and
 *    **no caller and no model may manufacture this capability.** The capability boundary is
 *    the runtime enforcement."
 *
 * =================================================================================
 * THE MECHANISM IS THE ACCEPTED ONE, REUSED
 *
 * `gateway/dispatchCapability.ts` already established the shape this package uses for a
 * capability that must not be forgeable: AN OPAQUE FROZEN OBJECT WITH NO OWN DATA, and a
 * module-private map holding everything about it.
 *
 *   minted only by verification   `sealVerifiedBundle` is not exported from this package's
 *                                 public surface; `verifier.ts` is its only caller, and it
 *                                 calls it only after all eight of `§3f`'s bootstrap steps
 *                                 have passed for every required artifact.
 *
 *   not forgeable                 An object literal cast to the type carries no entry in the
 *                                 private `WeakMap`, so every accessor refuses it. A
 *                                 TypeScript `interface` alone would not do this — a cast
 *                                 defeats an interface — which is why `§27` of the S1K
 *                                 mandate requires a structural mechanism.
 *
 *   not serialisable             `toJSON` THROWS and the object has no own enumerable
 *                                 properties, so a bundle cannot be put in a worker result,
 *                                 a model tool response, a queue message or a log line and
 *                                 cannot be reconstructed from one.
 *
 *   immutable                     The record and every parsed representation inside it are
 *                                 deep-frozen at seal time. `§3f`: "The active verified
 *                                 bundle is IMMUTABLE."
 * =================================================================================
 */

/** The opaque capability. It has no readable structure, deliberately. */
export interface VerifiedControlArtifactBundle {
  /**
   * PHANTOM. There is no such property at runtime, and there is no runtime property at all:
   * everything about a bundle lives in this module's private `WeakMap`. The declaration
   * exists so that TypeScript refuses an unrelated object where a bundle is required.
   */
  readonly __verifiedControlArtifactBundle: unique symbol;
}

/** One verified artifact's identity, as the manifest bound it. */
export interface VerifiedArtifactIdentity {
  readonly artifactClass: number;
  readonly artifactId: string;
  readonly artifactVersion: string;
  /** `50 §3c`: `SHA-256` over the EXACT artifact bytes, lowercase hex. */
  readonly contentHash: string;
  /** How many exact bytes were hashed. Recorded for evidence, never for authority. */
  readonly byteLength: number;
}

/** `50 §2a` Part A — the per-action-class record. EXACTLY TEN FIELDS. */
export interface VerifiedActionCatalogueEntry {
  readonly actionClass: ActionClass;
  readonly recoverability: Recoverability;
  readonly valueDirection: ValueDirection;
  readonly carriesVendorMonetaryField: boolean;
  readonly costComponentFree: boolean;
  readonly rateBased: boolean;
  readonly irrecoverableUnits: bigint;
  readonly settlementTolerance: SettlementTolerance;
  readonly adapter: string;
  readonly method: string;
}

/** `50 §2a` — ten per-class fields plus four catalogue-level records, and no open tail. */
export interface VerifiedActionCatalogue {
  readonly artifactVersion: string;
  readonly actionClasses: readonly ActionClass[];
  readonly entries: Readonly<Record<ActionClass, VerifiedActionCatalogueEntry>>;
  /** Record 11 — the closed `reason_code` enum (`26 §2.0`). */
  readonly reasonCodes: readonly ReasonCode[];
  /** Record 12 — the TOTAL map from each `reason_code` to its scope (`26 §2.2`). */
  readonly reasonCodeScopes: Readonly<Record<ReasonCode, ReasonCodeScope>>;
  /** Record 13 — per class, the declared ORDERED field list the digest covers. */
  readonly semanticOptionDigestFields: Readonly<Record<ActionClass, readonly string[]>>;
  /** Record 14 — per class, the enumeration `max_age` checked at C'. Seconds. */
  readonly enumerationMaxAgeSeconds: Readonly<Record<ActionClass, number>>;
}

/** `50 §2c` — EXACTLY FOUR static quantities. No runtime state. No open tail. */
export interface VerifiedDegradedModeConfiguration {
  readonly artifactVersion: string;
  /** Quantity 1. `PT15M`, inclusive `>=`. Milliseconds. */
  readonly mirrorLagCriticalThresholdMs: number;
  /** Quantity 2. `PT30M`, inclusive `>=`. Milliseconds. */
  readonly auditUnreachableFullHaltThresholdMs: number;
  /** Quantity 3. `USD 20.00`, strict `>`. Minor units of the single ledger currency. */
  readonly degradedPerActionApprovalFloorMinorUnits: bigint;
  /** Quantity 4. `PT5M`. Milliseconds. */
  readonly corroborationSignalMaxAgeMs: number;
}

/** `50 §2e` — the `acos.control.policy_set` bundle, as one immutable byte object. */
export interface VerifiedPolicySet {
  readonly artifactVersion: string;
  readonly schema: string;
  /** id -> source, in the bundle's declared sorted-id order. */
  readonly staticPolicies: Readonly<Record<string, string>>;
  readonly policyIds: readonly string[];
}

/**
 * `50 §2b` — the class-20 SPECIFICATION's verified identity.
 *
 * `50 §2b`: "**What the class-20 signature proves, and what it does not.** A valid pair of
 * owner signatures over this content hash proves exactly one thing: **this is the
 * owner-approved `ACOS-JCS-1` specification.** **IT DOES NOT PROVE THAT ANY IMPLEMENTATION
 * CONFORMS TO IT.**"
 *
 * The bundle therefore carries the specification's IDENTITY and its verified BYTES, and
 * carries no claim about any implementation. Conformance remains `36 §2`'s VC-A3.
 */
export interface VerifiedJcs1Specification {
  readonly artifactVersion: string;
  readonly contentHash: string;
  readonly byteLength: number;
}

/** `50 §2` row 24 — the audit plane's published verifying key. */
export interface VerifiedAuditSigningKey {
  readonly artifactVersion: string;
  readonly keyId: string;
  readonly publicKey: Uint8Array;
}

/**
 * `50 §2g` — ONE configured vendor credential's signed capability envelope. SEVEN FIELDS.
 *
 * `§2g`: "**The list below is the WHOLE of class 5's signed content. There is no `incl.`, no
 * `etc.` and no open tail.**" Fields 5, 6 and 7 are DERIVED at signing time and
 * CONSISTENCY-CHECKED against field 4 at verification, so a record that disagrees with
 * itself never reaches a consumer.
 *
 * **NO MEMBER CARRIES CREDENTIAL MATERIAL, AND THERE IS NOWHERE TO PUT ONE.** `credentialId`
 * is an identity and `§2g` says so in the field table: "the credential's identity; **never
 * the material**". `adapterSecretSource.ts` remains the only thing in the repository that
 * resolves material, in the integration runtime, from its own deployment boundary.
 */
export interface VerifiedCredentialScope {
  /** Field 1. Unique within the artifact. Never the material. */
  readonly credentialId: string;
  /** Field 2. An adapter identity the class-3 catalogue names. */
  readonly adapter: string;
  /** Field 3. Which vendor grants the permissions. */
  readonly provider: string;
  /** Field 4. Non-empty, as the PROVIDER spells them. The envelope being classified. */
  readonly grantedProviderPermissions: readonly string[];
  /** Field 5. The subset of field 4 satisfying at least one of `§2g`'s nine clauses. */
  readonly monetaryProviderPermissions: readonly string[];
  /** Field 6. **ADR-024's option-B trigger operand.** */
  readonly credentialRiskClass: CredentialRiskClass;
  /** Field 7. `48 §3.6`'s read-only exemption operand for an audit-plane credential. */
  readonly externalMutationCapable: boolean;
}

/** `50 §2g` — the verified class-5 artifact: one record per configured vendor credential. */
export interface VerifiedCredentialScopeDeclaration {
  readonly artifactVersion: string;
  /** In the artifact's own declared sorted-`credential_id` order. */
  readonly credentialIds: readonly string[];
  readonly credentials: Readonly<Record<string, VerifiedCredentialScope>>;
}

/** `50 §2` row 19 — the constructor version records, verified as bytes. */
export interface VerifiedConstructorRecord {
  readonly constructorId: string;
  readonly actionClass: string;
  readonly semanticMajor: number;
  readonly nonSemanticMinor: number;
}

export interface VerifiedConstructorSet {
  readonly artifactVersion: string;
  readonly records: readonly VerifiedConstructorRecord[];
}

/** Everything a sealed bundle carries. Deep-frozen; never handed out whole. */
export interface VerifiedBundleContents {
  /** `50 §3e`: `SHA-256(CORE)`, lowercase hex. The deployment-pinned active identity. */
  readonly manifestId: string;
  /** `50 §3d`: recorded "for lineage and for operator legibility". NEVER a selector. */
  readonly manifestEpoch: string;
  readonly identities: readonly VerifiedArtifactIdentity[];
  readonly policySet: VerifiedPolicySet;
  readonly actionCatalogue: VerifiedActionCatalogue;
  /** `50 §2g`, v1.3.7 — the class-5 credential-scope declaration. */
  readonly credentialScopes: VerifiedCredentialScopeDeclaration;
  readonly constructorSet: VerifiedConstructorSet;
  readonly jcs1Specification: VerifiedJcs1Specification;
  readonly auditSigningKey: VerifiedAuditSigningKey;
  readonly degradedModeConfiguration: VerifiedDegradedModeConfiguration;
}

/**
 * The private registry. A `WeakMap` keyed by the opaque object itself.
 *
 * A bundle's contents are reachable ONLY through this map, and the map is not exported. A
 * forged object — `{} as VerifiedControlArtifactBundle` — is absent from it, so every
 * accessor below refuses it rather than returning a default.
 */
const SEALED = new WeakMap<VerifiedControlArtifactBundle, VerifiedBundleContents>();

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  // A typed array cannot be frozen while it has elements. The digests and key bytes a
  // bundle carries are therefore immutable by CONFINEMENT rather than by `Object.freeze`:
  // they are produced inside verification, they are reachable only through this module's
  // private map, and no accessor hands one to a caller that could write to it without
  // first copying it.
  if (ArrayBuffer.isView(value)) return value;
  if (Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const key of Object.getOwnPropertyNames(value)) {
    deepFreeze((value as Record<string, unknown>)[key]);
  }
  return value;
}

/**
 * Seal verified contents into a capability.
 *
 * NOT part of this package's public surface. `verifier.ts` is the only caller, and
 * `tests/controlArtifacts/bundle-confinement.test.ts` asserts that against a hand-authored
 * list of call sites.
 */
export function sealVerifiedBundle(
  contents: VerifiedBundleContents,
): VerifiedControlArtifactBundle {
  const capability = Object.freeze(
    Object.defineProperty({}, 'toJSON', {
      /**
       * `§27` of the S1K mandate: "not JSON-serializable as an authority token". A bundle
       * that could be stringified could be posted into a queue, a log or a model response,
       * and something downstream would eventually read it back as authority.
       *
       * NON-ENUMERABLE, so the object has no own enumerable property at all: neither
       * `JSON.stringify`, nor `Object.keys`, nor a spread can copy anything out of it.
       */
      enumerable: false,
      value(): never {
        throw new Error(
          'a VerifiedControlArtifactBundle is a capability and is not serialisable (50 §3f)',
        );
      },
    }),
  ) as unknown as VerifiedControlArtifactBundle;
  SEALED.set(capability, deepFreeze(contents));
  return capability;
}

function contentsOf(bundle: VerifiedControlArtifactBundle): VerifiedBundleContents {
  const contents = SEALED.get(bundle);
  if (contents === undefined) {
    // A value shaped like a bundle that this module never sealed. `50 §3f`: no caller and
    // no model may manufacture the capability, so the answer is a refusal and never a
    // default, a re-verification or a lazy load.
    integrityFailure(
      'NO_ACTIVE_VERIFIED_BUNDLE',
      'the value presented as a VerifiedControlArtifactBundle was not produced by ' +
        'control-artifact verification (50 §3f)',
    );
  }
  return contents;
}

/** `50 §3e`'s active manifest identity, as verified. */
export function bundleManifestId(bundle: VerifiedControlArtifactBundle): string {
  return contentsOf(bundle).manifestId;
}

/** Lineage and operator legibility only. `50 §3e`: the PIN rejects a rollback, not this. */
export function bundleManifestEpoch(bundle: VerifiedControlArtifactBundle): string {
  return contentsOf(bundle).manifestEpoch;
}

/** The verified artifact identities, for evidence and for the audit record. */
export function bundleArtifactIdentities(
  bundle: VerifiedControlArtifactBundle,
): readonly VerifiedArtifactIdentity[] {
  return contentsOf(bundle).identities;
}

/** `50 §2a`'s verified class-3 content. THE action-catalogue authority source. */
export function verifiedActionCatalogue(
  bundle: VerifiedControlArtifactBundle,
): VerifiedActionCatalogue {
  return contentsOf(bundle).actionCatalogue;
}

/**
 * `50 §2g`'s verified class-5 content. **THE credential-risk authority source (v1.3.7).**
 *
 * `§2g`: "no provider response, account response, adapter self-description, environment
 * variable, caller parameter or model output may supply, override or widen any of the seven
 * fields". This accessor is therefore the ONLY route to a `credential_risk_class` in the
 * repository, and it is reachable only through a bundle this module sealed —
 * `tests/negative-controls/unsafe-credential-risk.ts` holds the implementations that read
 * one from somewhere else.
 */
export function verifiedCredentialScopes(
  bundle: VerifiedControlArtifactBundle,
): VerifiedCredentialScopeDeclaration {
  return contentsOf(bundle).credentialScopes;
}

/** `50 §2c`'s verified class-27 content. THE degraded-mode authority source. */
export function verifiedDegradedModeConfiguration(
  bundle: VerifiedControlArtifactBundle,
): VerifiedDegradedModeConfiguration {
  return contentsOf(bundle).degradedModeConfiguration;
}

/** `50 §2e`'s verified class-2 bundle. Admitted to Cedar only through this. */
export function verifiedPolicySet(bundle: VerifiedControlArtifactBundle): VerifiedPolicySet {
  return contentsOf(bundle).policySet;
}

/** `50 §2b`'s verified class-20 specification identity. Not a conformance claim. */
export function verifiedJcs1Specification(
  bundle: VerifiedControlArtifactBundle,
): VerifiedJcs1Specification {
  return contentsOf(bundle).jcs1Specification;
}

/** `50 §2` row 24's verified audit-plane verifying key. */
export function verifiedAuditSigningKey(
  bundle: VerifiedControlArtifactBundle,
): VerifiedAuditSigningKey {
  return contentsOf(bundle).auditSigningKey;
}

/** `50 §2` row 19's verified constructor set. `50 §3i`: the key migration is follow-on. */
export function verifiedConstructorSet(
  bundle: VerifiedControlArtifactBundle,
): VerifiedConstructorSet {
  return contentsOf(bundle).constructorSet;
}

/** Whether this module sealed the value presented. Used by boundary tests. */
export function isVerifiedControlArtifactBundle(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    SEALED.has(value as VerifiedControlArtifactBundle)
  );
}
