import { createHash, createPublicKey } from 'node:crypto';

import type {
  VerifiedProviderEvidenceChannel,
  VerifiedProviderEvidenceTrust,
} from './bundle.js';
import { ControlArtifactIntegrityFailure, integrityFailure, quoted } from './errors.js';

/**
 * CLASS 28 — the CONTROL PLANE's parse of `50 §2h`'s provider-evidence trust record.
 *
 * =================================================================================
 * WHY THE CONTROL PLANE PARSES A CLASS IT DOES NOT CONSUME
 *
 * `50 §6` (v1.3.8) makes class 28 a member of the pre-live signed set: "**Every entry requires
 * both signatures. Every entry is a manifest member.**" Its consumer is the AUDIT plane's
 * provider-evidence ingress, which parses the same verified bytes with its own implementation
 * (`src/audit/providerEvidence/class28.ts`). The control plane verifies the artifact's hash and
 * both signatures like every other member, and then refuses a record that is not a closed
 * `§2h` record — because `50 §3c` admits only "a parsed immutable representation derived
 * EXCLUSIVELY from those verified bytes", and an artifact this plane carries but cannot read is
 * an artifact nobody on this plane reviewed.
 *
 * THIS IS A SECOND, INDEPENDENT IMPLEMENTATION, BUILT BY A DIFFERENT ROUTE WHERE `§2h` ADMITS
 * ONE. The audit plane walks the SPKI with its own DER reader and checks the point on the curve
 * itself; this module imports the key through the platform and then requires the platform's
 * canonical SPKI re-export to equal the signed octets EXACTLY — which refuses a trailing octet,
 * a non-minimal length, a compressed point and an explicit-parameters key without a DER walker
 * of its own. The ingress grammar is one anchored expression here and a structured recogniser
 * there. Same artifact, two refusals.
 *
 * =================================================================================
 * `50 §2h` — THE CLOSED DISCRIMINATED UNION
 *
 *   PROVIDER_READ          exactly `provider`, `evidence_mode`, `accepted_count_operand`
 *   SIGNED_PROVIDER_PUSH   those three + `verification_key`, `verification_profile`,
 *                          `key_identity`, `accepted_event_classes`, `ingress_identity`
 *
 * No universal shape, no optional field, no placeholder, no default.
 * =================================================================================
 */

const CLASS_28_FIELDS = ['artifact_id', 'artifact_version', 'channels'] as const;
const COMMON = ['provider', 'evidence_mode', 'accepted_count_operand'] as const;
const PUSH_ONLY = [
  'verification_key',
  'verification_profile',
  'key_identity',
  'accepted_event_classes',
  'ingress_identity',
] as const;

/** `50 §2h` field 5's only defined value. */
const PROFILE_SENDGRID_EVENT_WEBHOOK_V1 = 'SENDGRID_EVENT_WEBHOOK_V1';
/** The count operand that profile's evidence normaliser implements. */
const PROFILE_COUNT_OPERAND = 'sg_message_id';

/** `https://<host><fixed-path>` — the whole `§2h` grammar as one anchored expression. */
const INGRESS_GRAMMAR =
  /^https:\/\/((?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*)((?:\/[A-Za-z0-9\-._~]+)+)$/;

function fail(where: string, detail: string): never {
  return integrityFailure('ARTIFACT_CONTENT_INVALID', `${where}: ${detail} (50 §2h)`);
}

function strictBase64(text: string): Buffer | null {
  if (text.length === 0 || text.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(text)) {
    return null;
  }
  const octets = Buffer.from(text, 'base64');
  return octets.toString('base64') === text ? octets : null;
}

function keyIdentityOf(text: string, where: string): string {
  const der = strictBase64(text);
  if (der === null) fail(where, 'verification_key is not strict canonical standard Base64');
  let exported: Buffer;
  try {
    const key = createPublicKey({ key: der, format: 'der', type: 'spki' });
    if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1') {
      fail(where, 'verification_key is not an EC key on prime256v1');
    }
    exported = key.export({ format: 'der', type: 'spki' });
  } catch (error) {
    if (error instanceof ControlArtifactIntegrityFailure) throw error;
    return fail(where, 'verification_key is not one DER SubjectPublicKeyInfo');
  }
  // THE CANONICAL RE-EXPORT MUST BE THE SIGNED OCTETS, EXACTLY.
  if (!exported.equals(der)) {
    fail(where, 'verification_key is not the canonical uncompressed P-256 SubjectPublicKeyInfo');
  }
  return createHash('sha256').update(der).digest('hex');
}

function ingressIdentityOf(value: unknown, where: string): string {
  if (typeof value !== 'string') fail(where, 'ingress_identity is not a string');
  const match = INGRESS_GRAMMAR.exec(value);
  if (match === null) fail(where, `ingress_identity ${quoted(value)} is outside the grammar`);
  const host = match[1]!;
  const labels = host.split('.');
  if (host.length > 253 || /^[0-9]+$/.test(labels[labels.length - 1]!)) {
    fail(where, 'ingress_identity names an IP literal or an over-long host');
  }
  const segments = match[2]!.slice(1).split('/');
  if (segments.some((segment) => segment === '.' || segment === '..')) {
    fail(where, 'ingress_identity carries a dot segment');
  }
  return value;
}

function parseChannel(raw: unknown, where: string): VerifiedProviderEvidenceChannel {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) fail(where, 'not an object');
  const record = raw as Record<string, unknown>;
  const present = Object.keys(record);

  const provider = record.provider;
  if (typeof provider !== 'string' || !/^[a-z0-9][a-z0-9_.-]{0,63}$/.test(provider)) {
    fail(where, 'provider is not a provider identifier');
  }
  const mode = record.evidence_mode;
  if (mode !== 'PROVIDER_READ' && mode !== 'SIGNED_PROVIDER_PUSH') {
    fail(where, 'evidence_mode is not PROVIDER_READ or SIGNED_PROVIDER_PUSH');
  }
  const allowed: readonly string[] =
    mode === 'PROVIDER_READ' ? COMMON : [...COMMON, ...PUSH_ONLY];
  const pushOnRead =
    mode === 'PROVIDER_READ'
      ? present.filter((key) => (PUSH_ONLY as readonly string[]).includes(key))
      : [];
  if (pushOnRead.length > 0) {
    fail(where, `a PROVIDER_READ record carries push-only field(s) [${pushOnRead.join(', ')}]`);
  }
  const extra = present.filter((key) => !allowed.includes(key));
  const missing = allowed.filter((key) => !present.includes(key));
  if (extra.length > 0 || missing.length > 0) {
    fail(where, `missing [${missing.join(', ')}], unexpected [${extra.join(', ')}]`);
  }

  const operand = record.accepted_count_operand;
  if (typeof operand !== 'string' || operand.length === 0) {
    fail(where, 'accepted_count_operand is not a non-empty string');
  }
  if (mode === 'PROVIDER_READ') {
    return Object.freeze({ evidenceMode: 'PROVIDER_READ' as const, provider, acceptedCountOperand: operand });
  }

  if (record.verification_profile !== PROFILE_SENDGRID_EVENT_WEBHOOK_V1) {
    fail(where, 'verification_profile is not a closed profile identifier');
  }
  if (operand !== PROFILE_COUNT_OPERAND) {
    fail(where, 'accepted_count_operand is not the operand the profile counts');
  }
  if (typeof record.verification_key !== 'string') fail(where, 'verification_key is not a string');
  const derived = keyIdentityOf(record.verification_key, where);
  if (record.key_identity !== derived) {
    fail(where, 'key_identity is not lowercase_hex(SHA-256(verification_key_der_octets))');
  }
  const classes = record.accepted_event_classes;
  if (
    !Array.isArray(classes) ||
    classes.length === 0 ||
    classes.some((entry, i) => typeof entry !== 'string' || !/^[a-z][a-z_]*$/.test(entry) || (i > 0 && String(classes[i - 1]) >= entry))
  ) {
    fail(where, 'accepted_event_classes is not a non-empty strictly ascending list');
  }
  return Object.freeze({
    evidenceMode: 'SIGNED_PROVIDER_PUSH' as const,
    provider,
    acceptedCountOperand: operand,
    verificationKey: record.verification_key,
    verificationProfile: PROFILE_SENDGRID_EVENT_WEBHOOK_V1,
    keyIdentity: derived,
    acceptedEventClasses: Object.freeze([...(classes as string[])]),
    ingressIdentity: ingressIdentityOf(record.ingress_identity, where),
  });
}

/** Parse `50 §2h`'s class-28 content from VERIFIED bytes. */
export function parseClass28ProviderEvidenceTrust(bytes: Uint8Array): VerifiedProviderEvidenceTrust {
  const where = 'the class-28 provider-evidence trust record';
  let document: unknown;
  try {
    document = JSON.parse(Buffer.from(bytes).toString('utf8'));
  } catch (error) {
    return fail(where, `does not parse: ${String(error)}`);
  }
  if (typeof document !== 'object' || document === null || Array.isArray(document)) {
    fail(where, 'is not an object');
  }
  const top = document as Record<string, unknown>;
  const keys = Object.keys(top);
  const extra = keys.filter((key) => !(CLASS_28_FIELDS as readonly string[]).includes(key));
  const missing = CLASS_28_FIELDS.filter((key) => !keys.includes(key));
  if (extra.length > 0 || missing.length > 0) {
    fail(where, `missing [${missing.join(', ')}], unexpected [${extra.join(', ')}]`);
  }
  if (top.artifact_id !== 'acos.control.provider_evidence_trust') {
    integrityFailure(
      'ARTIFACT_IDENTITY_UNEXPECTED',
      `${where} declares an artifact_id other than acos.control.provider_evidence_trust (50 §6)`,
    );
  }
  if (typeof top.artifact_version !== 'string' || top.artifact_version.length === 0) {
    fail(where, 'artifact_version is not a non-empty string');
  }
  if (!Array.isArray(top.channels)) fail(where, 'channels is not an array');

  const channels: Record<string, VerifiedProviderEvidenceChannel> = {};
  const providers: string[] = [];
  const ingress = new Set<string>();
  for (const [index, raw] of (top.channels as unknown[]).entries()) {
    const channel = parseChannel(raw, `${where}.channels[${String(index)}]`);
    if (providers.length > 0 && providers[providers.length - 1]! >= channel.provider) {
      fail(where, 'channels repeat or reorder a provider; exactly one mode is active per provider');
    }
    if (channel.evidenceMode === 'SIGNED_PROVIDER_PUSH') {
      if (ingress.has(channel.ingressIdentity)) fail(where, 'two push channels share one ingress');
      ingress.add(channel.ingressIdentity);
    }
    providers.push(channel.provider);
    channels[channel.provider] = channel;
  }
  return Object.freeze({
    artifactVersion: top.artifact_version as string,
    providers: Object.freeze(providers),
    channels: Object.freeze(channels),
  });
}
