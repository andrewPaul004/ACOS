import {
  parseIngressIdentity,
  type IngressIdentity,
} from './ingressIdentity.js';
import {
  SENDGRID_EVENT_WEBHOOK_V1,
  VERIFICATION_PROFILES,
  parseVerificationKey,
  type ParsedVerificationKey,
} from './sendgridEventWebhookV1.js';

/**
 * CLASS 28 — THE AUDIT PLANE'S OWN PARSE OF THE PROVIDER-EVIDENCE TRUST RECORD.
 * `50 §2h` (v1.3.8, `S1P-W2` — `S1P-W5`).
 *
 * =================================================================================
 * A CLOSED DISCRIMINATED UNION, AND NEVER ONE UNIVERSAL SHAPE
 *
 * `50 §2h`: "**The record is a CLOSED DISCRIMINATED UNION: `evidence_mode` selects exactly one of
 * two variants, and each variant has its own EXACT field set.** There is no universal record
 * shape."
 *
 *   PROVIDER_READ          exactly `provider`, `evidence_mode`, `accepted_count_operand`
 *   SIGNED_PROVIDER_PUSH   exactly those three plus `verification_key`, `verification_profile`,
 *                          `key_identity`, `accepted_event_classes`, `ingress_identity`
 *
 * The parser follows `50 §2h`'s seven steps in order — parse `provider`, parse `evidence_mode`,
 * select the exact field set, reject missing, reject extra, reject any push-only field on
 * `PROVIDER_READ`, reject any missing push field on `SIGNED_PROVIDER_PUSH` — and there is no
 * optional field, no default and no placeholder: a push field PRESENT on a read record is a
 * refusal whatever its value, including `null`, `""` and `[]`.
 *
 * =================================================================================
 * WHY THIS IS A SECOND PARSE AND NOT AN IMPORT
 *
 * `auditPlaneVerifier.ts` imports nothing from `src/kernel/`, and this module is part of the
 * audit plane's own verification for the same reason: `50 §3` property 2, "**The audit plane
 * recomputes independently.**" The control plane parses the same verified bytes with its own
 * implementation in `src/kernel/controlArtifacts/artifactParsers.ts`. Two refusals, written from
 * the artifact, in two planes.
 *
 * NOTHING HERE RUNS BEFORE VERIFICATION. The caller hands this module bytes whose exact-byte
 * `SHA-256` matched the signed manifest entry and whose two owner signatures verified.
 * =================================================================================
 */

export const PROVIDER_EVIDENCE_TRUST_ARTIFACT_ID = 'acos.control.provider_evidence_trust';

export const EVIDENCE_MODES = ['PROVIDER_READ', 'SIGNED_PROVIDER_PUSH'] as const;
export type EvidenceMode = (typeof EVIDENCE_MODES)[number];

const DOCUMENT_FIELDS = ['artifact_id', 'artifact_version', 'channels'] as const;

/** `50 §2h` — the three common fields, which are the WHOLE of the read variant. */
const READ_FIELDS = ['provider', 'evidence_mode', 'accepted_count_operand'] as const;

/** `50 §2h` — the five push-only fields. */
const PUSH_ONLY_FIELDS = [
  'verification_key',
  'verification_profile',
  'key_identity',
  'accepted_event_classes',
  'ingress_identity',
] as const;

const PUSH_FIELDS = [...READ_FIELDS, ...PUSH_ONLY_FIELDS] as const;

/**
 * The provider field names this runtime can count. `50 §2h` common field 3 is signed authority
 * and the runtime HONOURS it — so a record naming an operand this profile's normaliser does not
 * implement is refused rather than silently counted on a different field.
 */
const PROFILE_COUNT_OPERAND = 'sg_message_id';

/** One `PROVIDER_READ` channel. Three fields, and nothing a push channel carries. */
export interface ProviderReadChannel {
  readonly evidenceMode: 'PROVIDER_READ';
  readonly provider: string;
  readonly acceptedCountOperand: string;
}

/** One `SIGNED_PROVIDER_PUSH` channel. Eight fields, each parsed under its closed rule. */
export interface SignedProviderPushChannel {
  readonly evidenceMode: 'SIGNED_PROVIDER_PUSH';
  readonly provider: string;
  readonly acceptedCountOperand: string;
  /** Field 4, exactly as signed — the provider-returned `public_key` string. */
  readonly verificationKeyText: string;
  /** Field 4, parsed under the one canonical representation. */
  readonly verificationKey: ParsedVerificationKey;
  /** Field 5. The closed profile identifier. */
  readonly verificationProfile: typeof SENDGRID_EVENT_WEBHOOK_V1;
  /** Field 6. Equal to the identity DERIVED from field 4, or the record was refused. */
  readonly keyIdentity: string;
  /** Field 7. Sorted, unique, non-empty. */
  readonly acceptedEventClasses: readonly string[];
  /** Field 8. Canonical, or the record was refused. */
  readonly ingressIdentity: IngressIdentity;
}

export type ProviderEvidenceChannel = ProviderReadChannel | SignedProviderPushChannel;

/** The verified class-28 content, as the audit plane parsed it. */
export interface ProviderEvidenceTrust {
  readonly artifactVersion: string;
  /** In the artifact's own strictly ascending `provider` order. */
  readonly providers: readonly string[];
  readonly channels: Readonly<Record<string, ProviderEvidenceChannel>>;
}

/** Why the class-28 bytes are refused. A closed set; each is a record failure. */
export const CLASS_28_REFUSALS = [
  'CLASS_28_NOT_JSON',
  'CLASS_28_DOCUMENT_SHAPE',
  'CLASS_28_ARTIFACT_ID',
  'CLASS_28_PROVIDER_INVALID',
  'CLASS_28_PROVIDER_DUPLICATED_OR_UNORDERED',
  'CLASS_28_UNKNOWN_EVIDENCE_MODE',
  'CLASS_28_MISSING_FIELD',
  'CLASS_28_EXTRA_FIELD',
  'CLASS_28_PUSH_FIELD_ON_READ_RECORD',
  'CLASS_28_MISSING_PUSH_FIELD',
  'CLASS_28_FIELD_TYPE',
  'CLASS_28_COUNT_OPERAND_UNSUPPORTED',
  'CLASS_28_UNKNOWN_VERIFICATION_PROFILE',
  'CLASS_28_VERIFICATION_KEY_INVALID',
  'CLASS_28_KEY_IDENTITY_MISMATCH',
  'CLASS_28_ACCEPTED_EVENT_CLASSES_INVALID',
  'CLASS_28_INGRESS_IDENTITY_INVALID',
  'CLASS_28_INGRESS_IDENTITY_SHARED',
] as const;

export type Class28Refusal = (typeof CLASS_28_REFUSALS)[number];

export type Class28ParseOutcome =
  | { readonly ok: true; readonly trust: ProviderEvidenceTrust }
  | { readonly ok: false; readonly refusal: Class28Refusal; readonly detail: string };

class Refused extends Error {
  constructor(
    readonly refusal: Class28Refusal,
    readonly detail: string,
  ) {
    super(`${refusal}: ${detail}`);
  }
}

function refuse(refusal: Class28Refusal, detail: string): never {
  throw new Refused(refusal, detail);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asText(value: unknown, where: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    refuse('CLASS_28_FIELD_TYPE', `${where} is not a non-empty string`);
  }
  return value;
}

function parseChannel(raw: unknown, at: string): ProviderEvidenceChannel {
  if (!isPlainObject(raw)) refuse('CLASS_28_DOCUMENT_SHAPE', `${at} is not an object`);
  const present = Object.keys(raw);

  // STEP 1 — provider.
  const provider = raw.provider;
  if (typeof provider !== 'string' || !/^[a-z0-9][a-z0-9_.-]{0,63}$/.test(provider)) {
    refuse('CLASS_28_PROVIDER_INVALID', `${at}.provider is not a provider identifier`);
  }

  // STEP 2 — evidence_mode. An unknown mode fails closed; nothing defaults.
  const mode = raw.evidence_mode;
  if (mode !== 'PROVIDER_READ' && mode !== 'SIGNED_PROVIDER_PUSH') {
    refuse('CLASS_28_UNKNOWN_EVIDENCE_MODE', `${at}.evidence_mode is not a declared mode`);
  }

  // STEP 3 — the exact field set for THAT mode.
  const allowed: readonly string[] = mode === 'PROVIDER_READ' ? READ_FIELDS : PUSH_FIELDS;

  // STEP 6 before 5, so a push field on a read record is named as what it is.
  if (mode === 'PROVIDER_READ') {
    const pushOnRead = present.filter((key) => (PUSH_ONLY_FIELDS as readonly string[]).includes(key));
    if (pushOnRead.length > 0) {
      refuse(
        'CLASS_28_PUSH_FIELD_ON_READ_RECORD',
        `${at} is PROVIDER_READ and carries push-only field(s) [${pushOnRead.join(', ')}]; a ` +
          'read record carries them not at all — not as null, empty or a placeholder',
      );
    }
  }
  // STEP 5 — extra fields.
  const extra = present.filter((key) => !allowed.includes(key));
  if (extra.length > 0) refuse('CLASS_28_EXTRA_FIELD', `${at} carries [${extra.join(', ')}]`);
  // STEPS 4 and 7 — missing fields, named by variant.
  const missing = allowed.filter((key) => !present.includes(key));
  if (missing.length > 0) {
    const pushMissing = missing.filter((key) => (PUSH_ONLY_FIELDS as readonly string[]).includes(key));
    if (mode === 'SIGNED_PROVIDER_PUSH' && pushMissing.length > 0) {
      refuse(
        'CLASS_28_MISSING_PUSH_FIELD',
        `${at} is SIGNED_PROVIDER_PUSH and lacks [${pushMissing.join(', ')}]`,
      );
    }
    refuse('CLASS_28_MISSING_FIELD', `${at} lacks [${missing.join(', ')}]`);
  }

  const acceptedCountOperand = asText(raw.accepted_count_operand, `${at}.accepted_count_operand`);

  if (mode === 'PROVIDER_READ') {
    return Object.freeze({ evidenceMode: 'PROVIDER_READ' as const, provider, acceptedCountOperand });
  }

  // ---- SIGNED_PROVIDER_PUSH ----

  const profile = asText(raw.verification_profile, `${at}.verification_profile`);
  if (!VERIFICATION_PROFILES.includes(profile) || profile !== SENDGRID_EVENT_WEBHOOK_V1) {
    refuse(
      'CLASS_28_UNKNOWN_VERIFICATION_PROFILE',
      `${at}.verification_profile is not a closed profile identifier; a bare algorithm name is ` +
        'not a profile (50 §2h field 5)',
    );
  }
  if (acceptedCountOperand !== PROFILE_COUNT_OPERAND) {
    refuse(
      'CLASS_28_COUNT_OPERAND_UNSUPPORTED',
      `${at}.accepted_count_operand is not the field ${SENDGRID_EVENT_WEBHOOK_V1}'s normaliser ` +
        'counts; the signed operand is honoured, never substituted',
    );
  }

  const verificationKeyText = asText(raw.verification_key, `${at}.verification_key`);
  const parsedKey = parseVerificationKey(verificationKeyText);
  if (!parsedKey.ok) {
    refuse('CLASS_28_VERIFICATION_KEY_INVALID', `${at}.verification_key: ${parsedKey.refusal}`);
  }

  const keyIdentity = asText(raw.key_identity, `${at}.key_identity`);
  // `S1P-W4`: RECOMPUTED, and a disagreement is refusal. A free label never matches.
  if (!/^[0-9a-f]{64}$/.test(keyIdentity) || keyIdentity !== parsedKey.key.keyIdentity) {
    refuse(
      'CLASS_28_KEY_IDENTITY_MISMATCH',
      `${at}.key_identity is not lowercase_hex(SHA-256(verification_key_der_octets))`,
    );
  }

  const classes = raw.accepted_event_classes;
  if (
    !Array.isArray(classes) ||
    classes.length === 0 ||
    !classes.every((entry) => typeof entry === 'string' && /^[a-z][a-z_]{0,63}$/.test(entry))
  ) {
    refuse(
      'CLASS_28_ACCEPTED_EVENT_CLASSES_INVALID',
      `${at}.accepted_event_classes is not a non-empty list of event-type names`,
    );
  }
  const eventClasses = classes as string[];
  for (let i = 1; i < eventClasses.length; i += 1) {
    if (eventClasses[i - 1]! >= eventClasses[i]!) {
      refuse(
        'CLASS_28_ACCEPTED_EVENT_CLASSES_INVALID',
        `${at}.accepted_event_classes is not strictly ascending and unique`,
      );
    }
  }

  const ingressText = asText(raw.ingress_identity, `${at}.ingress_identity`);
  const ingress = parseIngressIdentity(ingressText);
  if (!ingress.ok) {
    refuse('CLASS_28_INGRESS_IDENTITY_INVALID', `${at}.ingress_identity: ${ingress.refusal}`);
  }

  return Object.freeze({
    evidenceMode: 'SIGNED_PROVIDER_PUSH' as const,
    provider,
    acceptedCountOperand,
    verificationKeyText,
    verificationKey: parsedKey.key,
    verificationProfile: SENDGRID_EVENT_WEBHOOK_V1,
    keyIdentity,
    acceptedEventClasses: Object.freeze([...eventClasses]),
    ingressIdentity: ingress.identity,
  });
}

/**
 * Parse class 28 from VERIFIED bytes. Never throws; a refusal is a value, so the audit plane can
 * record it as a finding rather than stop being able to record anything.
 */
export function parseProviderEvidenceTrust(bytes: Uint8Array): Class28ParseOutcome {
  try {
    let document: unknown;
    try {
      document = JSON.parse(Buffer.from(bytes).toString('utf8'));
    } catch {
      refuse('CLASS_28_NOT_JSON', 'the class-28 artifact does not parse');
    }
    if (!isPlainObject(document)) refuse('CLASS_28_DOCUMENT_SHAPE', 'the document is not an object');
    const keys = Object.keys(document);
    const extra = keys.filter((key) => !(DOCUMENT_FIELDS as readonly string[]).includes(key));
    const missing = DOCUMENT_FIELDS.filter((key) => !keys.includes(key));
    if (extra.length > 0 || missing.length > 0) {
      refuse(
        'CLASS_28_DOCUMENT_SHAPE',
        `the document carries exactly its declared fields; missing [${missing.join(', ')}], ` +
          `unexpected [${extra.join(', ')}]`,
      );
    }
    if (document.artifact_id !== PROVIDER_EVIDENCE_TRUST_ARTIFACT_ID) {
      refuse('CLASS_28_ARTIFACT_ID', 'the document declares an unexpected artifact_id');
    }
    const artifactVersion = asText(document.artifact_version, 'artifact_version');
    if (!Array.isArray(document.channels)) {
      refuse('CLASS_28_DOCUMENT_SHAPE', 'channels is not an array');
    }

    const channels: Record<string, ProviderEvidenceChannel> = {};
    const providers: string[] = [];
    const ingressValues = new Set<string>();
    for (const [index, raw] of (document.channels as unknown[]).entries()) {
      const channel = parseChannel(raw, `channels[${String(index)}]`);
      // EXACTLY ONE MODE PER PROVIDER: one record per provider, in strictly ascending order.
      if (providers.length > 0 && providers[providers.length - 1]! >= channel.provider) {
        refuse(
          'CLASS_28_PROVIDER_DUPLICATED_OR_UNORDERED',
          `channels[${String(index)}] repeats or reorders a provider; exactly one mode is ` +
            'active per provider',
        );
      }
      if (channel.evidenceMode === 'SIGNED_PROVIDER_PUSH') {
        // `48 §8` G1: one fixed route per channel. Two channels sharing one ingress would make
        // the route a dispatcher between trust roots.
        if (ingressValues.has(channel.ingressIdentity.value)) {
          refuse('CLASS_28_INGRESS_IDENTITY_SHARED', 'two push channels name one ingress_identity');
        }
        ingressValues.add(channel.ingressIdentity.value);
      }
      providers.push(channel.provider);
      channels[channel.provider] = channel;
    }

    return {
      ok: true,
      trust: Object.freeze({
        artifactVersion,
        providers: Object.freeze(providers),
        channels: Object.freeze(channels),
      }),
    };
  } catch (error) {
    if (error instanceof Refused) return { ok: false, refusal: error.refusal, detail: error.detail };
    throw error;
  }
}
