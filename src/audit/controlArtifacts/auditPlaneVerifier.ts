import { createHash, createPublicKey, verify as edVerify } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  parseProviderEvidenceTrust,
  type ProviderEvidenceTrust,
} from '../providerEvidence/class28.js';

/**
 * THE AUDIT PLANE'S OWN CONTROL-ARTIFACT VERIFICATION — `50 §3` property 2.
 *
 * =================================================================================
 * WHY THIS IS A SECOND IMPLEMENTATION AND NOT A SECOND CALL
 *
 * `50 §3`, the second of its four load-bearing properties, verbatim:
 *
 *   "**The audit plane recomputes independently.** A manifest check run only by the control
 *    plane is a check the control plane can pass by lying (`30 §5.2`)."
 *
 * and the mechanism block above it:
 *
 *   "Independent recomputation:
 *      the AUDIT PLANE recomputes every hash from its own copy
 *      and compares to the manifest it holds"
 *
 * THE WORD THAT DOES THE WORK IS "OWN". This module:
 *
 *   * imports NOTHING from `src/kernel/` — not the framing, not the verifier, not the
 *     parsers, not the bundle, not the trust-configuration reader. `node:crypto`, `node:fs`
 *     and `node:path` are its whole platform import list, and `30 §5.2`'s cross-implementation
 *     rule permits a shared standard cryptographic primitive while forbidding a shared authority
 *     computation. The one first-party import is this plane's OWN class-28 parser
 *     (`../providerEvidence/class28.ts`, v1.3.8), which is itself audit-plane code;
 *   * reads ITS OWN copy of the artifact bytes, from a directory named by ITS OWN
 *     deployment variables;
 *   * re-derives `50 §3b`'s framing and `50 §3d`'s core from the specification, in its own
 *     code, and recomputes every digest itself;
 *   * receives NO "verified" flag, digest, bundle, capability or boolean from the control
 *     plane, and has no parameter through which one could be handed to it.
 *
 * `50 §2b` on the class-20 copies: "**The control plane and the audit plane each hold a
 * BYTE-IDENTICAL COPY of this artifact.** That is not a loss of implementation
 * independence. **Same specification; independent implementations.**" The same sentence
 * governs this module: same manifest, same trust roots, two verifications.
 *
 * =================================================================================
 * WHAT THE AUDIT PLANE DOES WITH THE RESULT
 *
 * `50 §2c` quantity 4 is the concrete case: `corroboration_signal_max_age`'s audit-plane
 * copy is "**the one declared duplication in the whole inventory**", and "equality across
 * the two planes is a cross-plane obligation, not a second owner". The audit plane reads
 * that quantity from ITS verified class-27 bytes, so the two planes agreeing is a fact about
 * two independent verifications of one signed artifact rather than a value passed between
 * them.
 * =================================================================================
 */

const ARTIFACT_DOMAIN = 'ACOS-CONTROL-ARTIFACT-SIGNATURE-V1';
const MANIFEST_DOMAIN = 'ACOS-CONTROL-MANIFEST-SIGNATURE-V1';
const CORE_DOMAIN = 'ACOS-CONTROL-MANIFEST-CORE-V1';
const FORMAT_VERSION = 'ACOS-CONTROL-MANIFEST-CORE-V1';

/** The audit plane's own deployment variables. Named apart from the control plane's. */
export const AUDIT_PLANE_TRUST_VARIABLES = Object.freeze({
  primaryPublicKey: 'ACOS_AUDIT_OWNER_ARTIFACT_ROOT_KEY',
  secondFactorPublicKey: 'ACOS_AUDIT_OWNER_ARTIFACT_SECOND_FACTOR_KEY',
  expectedActiveManifestId: 'ACOS_AUDIT_EXPECTED_ACTIVE_MANIFEST_ID',
  artifactPackageRoot: 'ACOS_AUDIT_CONTROL_ARTIFACT_ROOT',
});

/**
 * `50 §6`'s inventory, transcribed a SECOND time from the architecture.
 *
 * It is not imported from `requiredSet.ts` on purpose. A shared table would mean a
 * class dropped from the control plane's required set would be dropped from the audit
 * plane's in the same edit, and the two planes would agree because they were one.
 */
const AUDIT_REQUIRED_ARTIFACTS: readonly {
  readonly artifactClass: number;
  readonly artifactId: string;
  readonly fileName: string;
}[] = Object.freeze([
  { artifactClass: 2, artifactId: 'acos.control.policy_set', fileName: 'class-02.policy-set.json' },
  {
    artifactClass: 3,
    artifactId: 'acos.control.action_catalogue',
    fileName: 'class-03.action-catalogue.json',
  },
  {
    // v1.3.7, `50 §2g` (`S1N-C1`). The audit plane verifies the credential-scope declaration
    // for its own reasons as well as for completeness: `48 §3.6`'s read-only exemption for
    // THIS plane's vendor reads has its operand in class 5, so an audit plane that did not
    // verify it would be exempting itself on an artifact it never checked.
    artifactClass: 5,
    artifactId: 'acos.control.credential_scopes',
    fileName: 'class-05.credential-scopes.json',
  },
  {
    artifactClass: 19,
    artifactId: 'acos.control.effect_constructors',
    fileName: 'class-19.effect-constructors.json',
  },
  {
    artifactClass: 20,
    artifactId: 'acos.control.jcs1_specification',
    fileName: 'class-20.acos-jcs-1.spec.v1.txt',
  },
  {
    artifactClass: 24,
    artifactId: 'acos.control.audit_signing_key',
    fileName: 'class-24.audit-signing-key.json',
  },
  {
    artifactClass: 27,
    artifactId: 'acos.control.degraded_mode_config',
    fileName: 'class-27.degraded-mode-config.json',
  },
  {
    // v1.3.8, `50 §2h` (`S1P-W1` — `S1P-W5`). The provider-evidence trust record. THIS plane
    // is its consumer: the provider-evidence ingress verifies every inbound signed payload
    // against a class-28 `verification_key`, so the audit plane verifies the record itself
    // and parses it with its own closed-union parser.
    artifactClass: 28,
    artifactId: 'acos.control.provider_evidence_trust',
    fileName: 'class-28.provider-evidence-trust.json',
  },
]);

/** `50 §2d`: retired, reserved, deprecated, never a manifest member. */
const AUDIT_RETIRED_CLASS = 17;

/**
 * `50 §2g` field 2's reserved audit-plane sentinel, TRANSCRIBED rather than imported.
 *
 * The same discipline the artifact list above follows, and for the same reason: importing
 * `credentialRisk.ts` would put the control plane's trust chain into this module's graph,
 * and the two planes would agree because they were one.
 */
const AUDIT_PLANE_SCOPE = 'audit_plane';

/** The three class-5 fields `48 §3.6`'s exemption turns on, as the audit plane reads them. */
export interface AuditVerifiedCredentialScope {
  readonly credentialId: string;
  readonly provider: string;
  readonly credentialRiskClass: string;
  readonly externalMutationCapable: boolean;
}

export type AuditVerificationOutcome =
  | {
      readonly verified: true;
      readonly manifestId: string;
      readonly manifestEpoch: string;
      readonly artifactDigests: Readonly<Record<number, string>>;
      /** `50 §2c` quantity 4, read from the audit plane's OWN verified class-27 bytes. */
      readonly corroborationSignalMaxAgeMs: number;
      /** `50 §2b`'s specification identity, as the audit plane computed it. */
      readonly jcs1SpecificationContentHash: string;
      /** `50 §2` row 24's key, as the audit plane computed it. */
      readonly auditSigningKeyId: string;
      /**
       * `50 §2g`, v1.3.7 — the audit plane's OWN reading of the class-5 credential scopes.
       *
       * **THE AUDIT PLANE PARSES THIS ITSELF AND DOES NOT ASK THE CONTROL PLANE.** `§13`'s
       * whole point is that the audit plane's read credential is independent of the control
       * plane, and an audit reader admitted on the control plane's reading of the record
       * that says it is read-only would be an audit plane trusting the plane it audits for
       * its own independence — `30 §5.4`'s self-agreement failure, one level up.
       *
       * The parse is deliberately NARROW: three fields per record, and only the ones
       * `48 §3.6`'s exemption turns on. The control plane's `parseClass5CredentialScopes`
       * enforces `§2g`'s full seven-field closure and its self-consistency rule; this one
       * re-reads the subset the AUDIT plane acts on, from bytes this plane verified.
       */
      readonly auditReadCredentials: Readonly<Record<string, AuditVerifiedCredentialScope>>;
      /**
       * `50 §2h`, v1.3.8 — the audit plane's OWN parse of class 28: the closed discriminated
       * union, every push record's key parsed under the one canonical representation, its
       * `key_identity` RECOMPUTED, its ingress identity recognised under the grammar.
       *
       * A record that fails any of those never reaches this field — the whole verification
       * refuses, because a class-28 record the audit plane cannot trust is the one condition
       * under which an attacker's evidence and the provider's are indistinguishable.
       */
      readonly providerEvidenceTrust: ProviderEvidenceTrust;
      /** The class-28 content hash this plane computed. The evidence channel's artifact identity. */
      readonly providerEvidenceTrustDigest: string;
    }
  | { readonly verified: false; readonly reason: string; readonly detail: string };

function u32be(length: number): Buffer {
  const out = Buffer.alloc(4);
  out.writeUInt32BE(length, 0);
  return out;
}

function field(payload: Buffer): Buffer {
  if (payload.length > 0xfffffffe) throw new Error('CAS field exceeds 0xFFFFFFFE');
  return Buffer.concat([u32be(payload.length), payload]);
}

function textField(value: string): Buffer {
  if (value.includes('\u0000')) throw new Error('CAS text may not carry U+0000');
  return field(Buffer.from(value.normalize('NFC'), 'utf8'));
}

function intField(value: number): Buffer {
  return textField(BigInt(value).toString(10));
}

function rawField(value: Buffer, length: number): Buffer {
  if (value.length !== length) throw new Error('CAS raw field has the wrong length');
  return field(value);
}

function digest(bytes: Uint8Array): Buffer {
  return createHash('sha256').update(bytes).digest();
}

function verifyEd25519Raw(message: Buffer, rawPublicKey: Buffer, signature: Buffer): boolean {
  if (signature.length !== 64 || rawPublicKey.length !== 32) return false;
  try {
    const key = createPublicKey({
      key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), rawPublicKey]),
      format: 'der',
      type: 'spki',
    });
    return edVerify(null, message, key, signature);
  } catch {
    return false;
  }
}

function hexBytes(value: unknown, byteLength: number): Buffer | null {
  if (typeof value !== 'string') return null;
  if (value.length !== byteLength * 2) return null;
  if (!/^[0-9a-f]*$/.test(value)) return null;
  return Buffer.from(value, 'hex');
}

interface AuditEntry {
  readonly artifactClass: number;
  readonly artifactId: string;
  readonly artifactVersion: string;
  readonly contentSha256: Buffer;
  readonly primarySignature: Buffer;
  readonly secondFactorSignature: Buffer;
}

function refuse(reason: string, detail: string): AuditVerificationOutcome {
  return { verified: false, reason, detail };
}

/**
 * Verify the control-artifact package THE AUDIT PLANE HOLDS, against the trust roots and the
 * active-manifest pin THE AUDIT PLANE WAS PROVISIONED WITH.
 *
 * It returns a verdict rather than throwing. The audit plane's job is to OBSERVE and to
 * report — `30 §5.2` — so a divergence must become a finding it can record rather than an
 * exception that stops it from recording anything.
 */
export function verifyAuditPlaneControlArtifacts(
  source: Readonly<Record<string, string | undefined>> = process.env,
): AuditVerificationOutcome {
  const primaryHex = source[AUDIT_PLANE_TRUST_VARIABLES.primaryPublicKey];
  const secondFactorHex = source[AUDIT_PLANE_TRUST_VARIABLES.secondFactorPublicKey];
  const pin = source[AUDIT_PLANE_TRUST_VARIABLES.expectedActiveManifestId];
  const root = source[AUDIT_PLANE_TRUST_VARIABLES.artifactPackageRoot];

  if (
    primaryHex === undefined ||
    secondFactorHex === undefined ||
    pin === undefined ||
    root === undefined
  ) {
    return refuse(
      'AUDIT_TRUST_CONFIG_MISSING',
      'the audit plane has no deployment trust configuration of its own; it does not read ' +
        "the control plane's (50 §3a)",
    );
  }

  const primaryKey = hexBytes(primaryHex, 32);
  const secondFactorKey = hexBytes(secondFactorHex, 32);
  if (primaryKey === null || secondFactorKey === null) {
    return refuse('AUDIT_TRUST_CONFIG_MALFORMED', 'an audit-plane root key is not 32 raw bytes');
  }
  if (primaryKey.equals(secondFactorKey)) {
    return refuse(
      'AUDIT_TRUST_ROOTS_NOT_DISTINCT',
      'the audit plane is configured with one key in both root slots (50 §3a)',
    );
  }

  const primaryKeyId = digest(primaryKey).toString('hex');
  const secondFactorKeyId = digest(secondFactorKey).toString('hex');

  let documentText: string;
  try {
    documentText = readFileSync(join(root, 'manifest.json'), 'utf8');
  } catch (error) {
    return refuse('AUDIT_MANIFEST_UNREADABLE', String(error));
  }

  let document: Record<string, unknown>;
  try {
    document = JSON.parse(documentText) as Record<string, unknown>;
  } catch (error) {
    return refuse('AUDIT_MANIFEST_MALFORMED', String(error));
  }

  const formatVersion = document.manifest_format_version;
  const epoch = document.manifest_epoch;
  const declaredPrimaryKeyId = document.expected_primary_key_id;
  const declaredSecondFactorKeyId = document.expected_second_factor_key_id;
  if (
    typeof formatVersion !== 'string' ||
    typeof epoch !== 'string' ||
    typeof declaredPrimaryKeyId !== 'string' ||
    typeof declaredSecondFactorKeyId !== 'string' ||
    !Array.isArray(document.entries) ||
    typeof document.entry_count !== 'number'
  ) {
    return refuse('AUDIT_MANIFEST_MALFORMED', 'the manifest core fields are not well formed');
  }
  if (formatVersion !== FORMAT_VERSION) {
    return refuse('AUDIT_MANIFEST_MALFORMED', 'unrecognised manifest_format_version');
  }
  if (document.entry_count !== document.entries.length) {
    return refuse('AUDIT_MANIFEST_ENTRY_COUNT_MISMATCH', 'entry_count disagrees with entries');
  }

  const entries: AuditEntry[] = [];
  for (const raw of document.entries) {
    if (typeof raw !== 'object' || raw === null) {
      return refuse('AUDIT_MANIFEST_MALFORMED', 'an entry is not an object');
    }
    const entry = raw as Record<string, unknown>;
    const contentSha256 = hexBytes(entry.content_hash, 32);
    const primarySignature = hexBytes(entry.primary_signature, 64);
    const secondFactorSignature = hexBytes(entry.second_factor_signature, 64);
    if (
      typeof entry.artifact_class !== 'number' ||
      typeof entry.artifact_id !== 'string' ||
      typeof entry.artifact_version !== 'string' ||
      contentSha256 === null ||
      primarySignature === null ||
      secondFactorSignature === null
    ) {
      return refuse('AUDIT_MANIFEST_MALFORMED', 'an entry field is not well formed');
    }
    entries.push({
      artifactClass: entry.artifact_class,
      artifactId: entry.artifact_id,
      artifactVersion: entry.artifact_version,
      contentSha256,
      primarySignature,
      secondFactorSignature,
    });
  }

  // `50 §3d`'s declared order, re-derived here. Refused, never sorted.
  for (let i = 1; i < entries.length; i += 1) {
    const before = entries[i - 1]!;
    const after = entries[i]!;
    const order =
      before.artifactClass !== after.artifactClass
        ? before.artifactClass - after.artifactClass
        : Buffer.compare(
              Buffer.from(before.artifactId.normalize('NFC'), 'utf8'),
              Buffer.from(after.artifactId.normalize('NFC'), 'utf8'),
            ) !== 0
          ? Buffer.compare(
              Buffer.from(before.artifactId.normalize('NFC'), 'utf8'),
              Buffer.from(after.artifactId.normalize('NFC'), 'utf8'),
            )
          : Buffer.compare(
              Buffer.from(before.artifactVersion.normalize('NFC'), 'utf8'),
              Buffer.from(after.artifactVersion.normalize('NFC'), 'utf8'),
            );
    if (order >= 0) {
      return refuse('AUDIT_MANIFEST_ENTRY_ORDER_INVALID', 'entries are not strictly ascending');
    }
  }

  // The CORE bytes, and the identity, recomputed by this plane's own encoder.
  const coreParts: Buffer[] = [
    textField(CORE_DOMAIN),
    textField(formatVersion),
    textField(epoch),
    textField(declaredPrimaryKeyId),
    textField(declaredSecondFactorKeyId),
    intField(entries.length),
  ];
  for (const entry of entries) {
    coreParts.push(intField(entry.artifactClass));
    coreParts.push(textField(entry.artifactId));
    coreParts.push(textField(entry.artifactVersion));
    coreParts.push(rawField(entry.contentSha256, 32));
    coreParts.push(rawField(entry.primarySignature, 64));
    coreParts.push(rawField(entry.secondFactorSignature, 64));
  }
  const core = Buffer.concat(coreParts);
  const coreSha256 = digest(core);
  const manifestId = coreSha256.toString('hex');

  // The PIN, before the signatures. `50 §3e`.
  if (manifestId !== pin) {
    return refuse(
      'AUDIT_MANIFEST_IDENTITY_NOT_PINNED',
      `the audit plane computes manifest_id ${manifestId}, which is not its pinned ` +
        'EXPECTED_ACTIVE_MANIFEST_ID',
    );
  }

  const manifestHeader = [
    textField(formatVersion),
    textField(epoch),
    textField(declaredPrimaryKeyId),
    textField(declaredSecondFactorKeyId),
  ];
  const primaryManifestMessage = Buffer.concat([
    textField(MANIFEST_DOMAIN),
    textField('PRIMARY'),
    ...manifestHeader,
    rawField(coreSha256, 32),
  ]);
  const secondFactorManifestMessage = Buffer.concat([
    textField(MANIFEST_DOMAIN),
    textField('SECOND_FACTOR'),
    ...manifestHeader,
    rawField(coreSha256, 32),
  ]);

  const manifestPrimarySignature = hexBytes(document.primary_signature, 64);
  const manifestSecondFactorSignature = hexBytes(document.second_factor_signature, 64);
  if (manifestPrimarySignature === null || manifestSecondFactorSignature === null) {
    return refuse('AUDIT_MANIFEST_MALFORMED', 'a manifest signature is not 64 raw bytes');
  }
  if (!verifyEd25519Raw(primaryManifestMessage, primaryKey, manifestPrimarySignature)) {
    return refuse(
      'AUDIT_MANIFEST_PRIMARY_SIGNATURE_INVALID',
      'the manifest core carries no valid PRIMARY signature under the audit plane roots',
    );
  }
  if (
    !verifyEd25519Raw(secondFactorManifestMessage, secondFactorKey, manifestSecondFactorSignature)
  ) {
    return refuse(
      'AUDIT_MANIFEST_SECOND_FACTOR_SIGNATURE_INVALID',
      'the manifest core carries no valid SECOND_FACTOR signature under the audit plane roots',
    );
  }

  if (declaredPrimaryKeyId !== primaryKeyId || declaredSecondFactorKeyId !== secondFactorKeyId) {
    return refuse(
      'AUDIT_MANIFEST_KEY_ID_MISMATCH',
      'the manifest names key ids the audit plane was not provisioned with',
    );
  }

  const byClass = new Map<number, AuditEntry>();
  for (const entry of entries) {
    if (entry.artifactClass === AUDIT_RETIRED_CLASS) {
      return refuse('AUDIT_RETIRED_CLASS_PRESENT', 'the manifest revives retired class 17');
    }
    if (byClass.has(entry.artifactClass)) {
      return refuse('AUDIT_MANIFEST_DUPLICATE_ENTRY', 'two entries for one class');
    }
    byClass.set(entry.artifactClass, entry);
  }

  const artifactDigests: Record<number, string> = {};
  let corroborationSignalMaxAgeMs: number | null = null;
  const auditReadCredentials: Record<string, AuditVerifiedCredentialScope> = {};
  let auditSigningKeyId: string | null = null;
  let providerEvidenceTrust: ProviderEvidenceTrust | null = null;

  for (const required of AUDIT_REQUIRED_ARTIFACTS) {
    const entry = byClass.get(required.artifactClass);
    if (entry === undefined) {
      return refuse(
        'AUDIT_REQUIRED_ARTIFACT_MISSING',
        `no class-${String(required.artifactClass)} entry`,
      );
    }
    if (entry.artifactId !== required.artifactId) {
      return refuse(
        'AUDIT_ARTIFACT_IDENTITY_UNEXPECTED',
        `class ${String(required.artifactClass)} declares an unexpected artifact_id`,
      );
    }

    let bytes: Buffer;
    try {
      // THE AUDIT PLANE'S OWN COPY, from the audit plane's own directory.
      bytes = readFileSync(join(root, required.fileName));
    } catch (error) {
      return refuse('AUDIT_ARTIFACT_BYTES_UNREADABLE', String(error));
    }

    // ITS OWN HASH. Not the control plane's, and not a value read from anywhere.
    const computed = digest(bytes);
    if (!computed.equals(entry.contentSha256)) {
      return refuse(
        'AUDIT_ARTIFACT_CONTENT_HASH_MISMATCH',
        `class ${String(required.artifactClass)}: the audit plane's own copy hashes to ` +
          `${computed.toString('hex')} and the signed manifest declares ` +
          entry.contentSha256.toString('hex'),
      );
    }

    const identityFields = [
      intField(entry.artifactClass),
      textField(entry.artifactId),
      textField(entry.artifactVersion),
      rawField(entry.contentSha256, 32),
    ];
    const primaryArtifactMessage = Buffer.concat([
      textField(ARTIFACT_DOMAIN),
      textField('PRIMARY'),
      ...identityFields,
    ]);
    const secondFactorArtifactMessage = Buffer.concat([
      textField(ARTIFACT_DOMAIN),
      textField('SECOND_FACTOR'),
      ...identityFields,
    ]);

    if (!verifyEd25519Raw(primaryArtifactMessage, primaryKey, entry.primarySignature)) {
      return refuse(
        'AUDIT_ARTIFACT_PRIMARY_SIGNATURE_INVALID',
        `class ${String(required.artifactClass)} carries no valid PRIMARY signature`,
      );
    }
    if (
      !verifyEd25519Raw(secondFactorArtifactMessage, secondFactorKey, entry.secondFactorSignature)
    ) {
      return refuse(
        'AUDIT_ARTIFACT_SECOND_FACTOR_SIGNATURE_INVALID',
        `class ${String(required.artifactClass)} carries no valid SECOND_FACTOR signature`,
      );
    }

    artifactDigests[required.artifactClass] = computed.toString('hex');

    if (required.artifactClass === 27) {
      const parsed = JSON.parse(bytes.toString('utf8')) as Record<string, unknown>;
      const maxAge = parsed.corroboration_signal_max_age;
      const match = typeof maxAge === 'string' ? /^PT([1-9][0-9]*)M$/.exec(maxAge) : null;
      if (match === null) {
        return refuse(
          'AUDIT_ARTIFACT_CONTENT_INVALID',
          'the audit plane cannot read corroboration_signal_max_age from its class-27 copy',
        );
      }
      corroborationSignalMaxAgeMs = Number(match[1]) * 60 * 1000;
    }

    if (required.artifactClass === 5) {
      /*
       * `50 §2g`, v1.3.7 — THE AUDIT PLANE READS ITS OWN EXEMPTION'S OPERAND.
       *
       * Only the AUDIT-PLANE-scoped records are kept. An adapter-scoped credential is not
       * this plane's business and keeping it would let a later change admit one by
       * accident; `§13`'s "no control send credential" is easier to hold when the audit
       * plane never learns a send credential's identity at all.
       */
      const parsed = JSON.parse(bytes.toString('utf8')) as Record<string, unknown>;
      const rows = parsed.credentials;
      if (!Array.isArray(rows)) {
        return refuse(
          'AUDIT_ARTIFACT_CONTENT_INVALID',
          'the audit plane cannot read credentials from its class-5 copy',
        );
      }
      for (const raw of rows) {
        if (typeof raw !== 'object' || raw === null) {
          return refuse(
            'AUDIT_ARTIFACT_CONTENT_INVALID',
            'a class-5 credential record is not an object',
          );
        }
        const row = raw as Record<string, unknown>;
        if (row.adapter !== AUDIT_PLANE_SCOPE) continue;
        const credentialId = row.credential_id;
        const provider = row.provider;
        const riskClass = row.credential_risk_class;
        const mutation = row.external_mutation_capable;
        if (
          typeof credentialId !== 'string' ||
          typeof provider !== 'string' ||
          typeof riskClass !== 'string' ||
          typeof mutation !== 'boolean'
        ) {
          return refuse(
            'AUDIT_ARTIFACT_CONTENT_INVALID',
            'an audit-plane class-5 credential record is malformed',
          );
        }
        // `48 §3.6` and `50 §2g`: a record carrying the audit sentinel and claiming anything
        // but READ_ONLY, or admitting external mutation, is REFUSED rather than kept and
        // filtered later. The plane that would act on it refuses to finish verifying.
        if (riskClass !== 'READ_ONLY' || mutation) {
          return refuse(
            'AUDIT_ARTIFACT_CONTENT_INVALID',
            `audit-plane credential "${credentialId}" is not declared READ_ONLY with no ` +
              'external mutation; 48 §3.6 rests on exactly that',
          );
        }
        auditReadCredentials[credentialId] = Object.freeze({
          credentialId,
          provider,
          credentialRiskClass: riskClass,
          externalMutationCapable: mutation,
        });
      }
    }

    if (required.artifactClass === 24) {
      const parsed = JSON.parse(bytes.toString('utf8')) as Record<string, unknown>;
      const publicKey = hexBytes(parsed.public_key, 32);
      if (publicKey === null) {
        return refuse(
          'AUDIT_ARTIFACT_CONTENT_INVALID',
          'the audit plane cannot read its published signing key from its class-24 copy',
        );
      }
      auditSigningKeyId = digest(publicKey).toString('hex');
    }

    if (required.artifactClass === 28) {
      const parsed = parseProviderEvidenceTrust(bytes);
      if (!parsed.ok) {
        return refuse(
          'AUDIT_ARTIFACT_CONTENT_INVALID',
          `the audit plane refuses its class-28 copy: ${parsed.refusal}`,
        );
      }
      if (parsed.trust.artifactVersion !== entry.artifactVersion) {
        return refuse(
          'AUDIT_ARTIFACT_IDENTITY_UNEXPECTED',
          'class 28 declares an artifact_version the signed manifest entry does not',
        );
      }
      providerEvidenceTrust = parsed.trust;
    }
  }

  if (
    corroborationSignalMaxAgeMs === null ||
    auditSigningKeyId === null ||
    providerEvidenceTrust === null
  ) {
    return refuse('AUDIT_REQUIRED_ARTIFACT_MISSING', 'the audit plane set is incomplete');
  }

  return {
    verified: true,
    manifestId,
    manifestEpoch: epoch,
    artifactDigests: Object.freeze(artifactDigests),
    corroborationSignalMaxAgeMs,
    jcs1SpecificationContentHash: artifactDigests[20]!,
    auditSigningKeyId,
    auditReadCredentials: Object.freeze(auditReadCredentials),
    providerEvidenceTrust,
    providerEvidenceTrustDigest: artifactDigests[28]!,
  };
}
