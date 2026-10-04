import { createHash, generateKeyPairSync } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { verifyAuditPlaneControlArtifacts } from '../../src/audit/controlArtifacts/auditPlaneVerifier.js';
import { parseProviderEvidenceTrust } from '../../src/audit/providerEvidence/class28.js';
import { parseIngressIdentity } from '../../src/audit/providerEvidence/ingressIdentity.js';
import { parseVerificationKey } from '../../src/audit/providerEvidence/sendgridEventWebhookV1.js';
import { verifiedProviderEvidenceTrust } from '../../src/kernel/controlArtifacts/bundle.js';
import { ControlArtifactIntegrityFailure } from '../../src/kernel/controlArtifacts/errors.js';
import { parseClass28ProviderEvidenceTrust } from '../../src/kernel/controlArtifacts/providerEvidenceTrust.js';
import { buildControlArtifactFixture, verifyFixtureBundle } from '../support/controlArtifactFixture.js';
import {
  SENDGRID_HELPER_VECTOR,
  TEST_INGRESS_IDENTITY,
  TEST_ONLY_WEBHOOK_SIGNER,
  TEST_ONLY_WEBHOOK_SIGNER_B,
  class28Bytes,
  providerEvidenceArtifactFixture,
  pushRecord,
  readRecord,
} from '../support/providerEvidenceFixture.js';

/**
 * `50 §2h` — CLASS 28 IS A CLOSED DISCRIMINATED UNION, PARSED BY BOTH PLANES.
 *
 * Every case is run against BOTH implementations — the audit plane's own
 * (`src/audit/providerEvidence/class28.ts`) and the control plane's
 * (`src/kernel/controlArtifacts/providerEvidenceTrust.ts`). They are written by different
 * routes, so agreement here is two refusals reaching one verdict, not one refusal run twice.
 */

function auditAccepts(records: readonly Record<string, unknown>[]): boolean {
  return parseProviderEvidenceTrust(class28Bytes(records)).ok;
}

function auditRefusal(records: readonly Record<string, unknown>[]): string {
  const outcome = parseProviderEvidenceTrust(class28Bytes(records));
  return outcome.ok ? 'ACCEPTED' : outcome.refusal;
}

function kernelAccepts(records: readonly Record<string, unknown>[]): boolean {
  try {
    parseClass28ProviderEvidenceTrust(class28Bytes(records));
    return true;
  } catch (error) {
    if (error instanceof ControlArtifactIntegrityFailure) return false;
    throw error;
  }
}

function bothRefuse(records: readonly Record<string, unknown>[]): void {
  expect(auditAccepts(records), 'audit plane accepted').toBe(false);
  expect(kernelAccepts(records), 'control plane accepted').toBe(false);
}

function without(record: Record<string, unknown>, field: string): Record<string, unknown> {
  const copy = { ...record };
  delete copy[field];
  return copy;
}

const PUSH_ONLY = [
  'verification_key',
  'verification_profile',
  'key_identity',
  'accepted_event_classes',
  'ingress_identity',
] as const;

describe('`50 §2h` — the two variants, exactly', () => {
  it('a valid PROVIDER_READ record of EXACTLY three fields is accepted by both planes', () => {
    expect(Object.keys(readRecord())).toHaveLength(3);
    expect(auditAccepts([readRecord()])).toBe(true);
    expect(kernelAccepts([readRecord()])).toBe(true);
    const parsed = parseProviderEvidenceTrust(class28Bytes([readRecord()]));
    expect(parsed.ok && parsed.trust.channels['synthetic_esp']).toEqual({
      evidenceMode: 'PROVIDER_READ',
      provider: 'synthetic_esp',
      acceptedCountOperand: 'provider_message_id',
    });
  });

  it('a valid SIGNED_PROVIDER_PUSH record of EXACTLY eight fields is accepted by both planes', () => {
    expect(Object.keys(pushRecord())).toHaveLength(8);
    expect(auditAccepts([pushRecord()])).toBe(true);
    expect(kernelAccepts([pushRecord()])).toBe(true);
    const parsed = parseProviderEvidenceTrust(class28Bytes([pushRecord()]));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const channel = parsed.trust.channels['twilio_sendgrid']!;
    expect(channel.evidenceMode).toBe('SIGNED_PROVIDER_PUSH');
    if (channel.evidenceMode !== 'SIGNED_PROVIDER_PUSH') return;
    expect(channel.keyIdentity).toBe(TEST_ONLY_WEBHOOK_SIGNER.keyIdentity);
    expect(channel.ingressIdentity.value).toBe(TEST_INGRESS_IDENTITY);
    expect(channel.verificationProfile).toBe('SENDGRID_EVENT_WEBHOOK_V1');
  });

  it('a push-only field on a PROVIDER_READ record is refused — including null, "" and [] placeholders', () => {
    for (const field of PUSH_ONLY) {
      for (const placeholder of [null, '', [], 'NONE', pushRecord()[field]]) {
        bothRefuse([readRecord({ [field]: placeholder })]);
      }
    }
    expect(auditRefusal([readRecord({ verification_key: null })])).toBe(
      'CLASS_28_PUSH_FIELD_ON_READ_RECORD',
    );
  });

  it('a SIGNED_PROVIDER_PUSH record missing any one push field is refused', () => {
    for (const field of PUSH_ONLY) {
      bothRefuse([without(pushRecord(), field)]);
      expect(auditRefusal([without(pushRecord(), field)])).toBe('CLASS_28_MISSING_PUSH_FIELD');
    }
  });

  it('a missing common field and an extra field are refused on either variant', () => {
    bothRefuse([without(readRecord(), 'accepted_count_operand')]);
    bothRefuse([without(pushRecord(), 'accepted_count_operand')]);
    bothRefuse([readRecord({ webhook_id: 'abc' })]);
    bothRefuse([pushRecord({ webhook_id: 'abc' })]);
    expect(auditRefusal([pushRecord({ webhook_id: 'abc' })])).toBe('CLASS_28_EXTRA_FIELD');
  });

  it('there is NO universal eight-field shape: a READ record carrying all eight is refused', () => {
    bothRefuse([pushRecord({ evidence_mode: 'PROVIDER_READ' })]);
  });

  it('an unknown evidence_mode fails closed, and nothing defaults', () => {
    for (const mode of ['PROVIDER_PUSH', 'signed_provider_push', '', null, undefined]) {
      bothRefuse([pushRecord({ evidence_mode: mode })]);
    }
    bothRefuse([without(pushRecord(), 'evidence_mode')]);
    expect(auditRefusal([pushRecord({ evidence_mode: 'BOTH' })])).toBe(
      'CLASS_28_UNKNOWN_EVIDENCE_MODE',
    );
  });

  it('an unknown verification_profile fails closed — a bare algorithm name is not a profile', () => {
    for (const profile of ['ECDSA', 'ECDSA_P256_SHA256', 'SENDGRID_EVENT_WEBHOOK_V2', 'sendgrid_event_webhook_v1']) {
      bothRefuse([pushRecord({ verification_profile: profile })]);
    }
    expect(auditRefusal([pushRecord({ verification_profile: 'ECDSA' })])).toBe(
      'CLASS_28_UNKNOWN_VERIFICATION_PROFILE',
    );
  });

  it('exactly one mode per provider: a repeated provider is refused', () => {
    bothRefuse([pushRecord(), pushRecord()]);
    bothRefuse([pushRecord(), pushRecord({ evidence_mode: 'PROVIDER_READ' })]);
  });

  it('a count operand the profile does not count is refused, never substituted', () => {
    bothRefuse([pushRecord({ accepted_count_operand: 'sg_event_id' })]);
  });

  it('accepted_event_classes must be a non-empty, sorted, unique list', () => {
    bothRefuse([pushRecord({ accepted_event_classes: [] })]);
    bothRefuse([pushRecord({ accepted_event_classes: ['processed', 'processed'] })]);
    bothRefuse([pushRecord({ accepted_event_classes: ['processed', 'delivered'] })]);
    bothRefuse([pushRecord({ accepted_event_classes: 'processed' })]);
  });
});

describe('`S1P-W3` / `S1P-W4` — one key representation, and a key identity bound to it', () => {
  it('the provider’s own published key parses, and its identity is SHA-256 over the DER', () => {
    const parsed = parseVerificationKey(SENDGRID_HELPER_VECTOR.publicKey);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const der = Buffer.from(SENDGRID_HELPER_VECTOR.publicKey, 'base64');
    expect(der).toHaveLength(91);
    expect(parsed.key.keyIdentity).toBe(createHash('sha256').update(der).digest('hex'));
    expect(parsed.key.keyIdentity).toBe(
      'f0fe1f9c9477f0bbe0e68c62ce5b1a05745d19eeeab5b4368cc518301b6d02e7',
    );
  });

  it('a key_identity that is not the derived identity is refused — free labels included', () => {
    for (const label of ['sendgrid-webhook-key', 'key-2026-10', TEST_INGRESS_IDENTITY, 'A'.repeat(64)]) {
      bothRefuse([pushRecord({ key_identity: label })]);
    }
  });

  it('CHANGING THE KEY WHILE KEEPING THE OLD IDENTITY IS REFUSED', () => {
    bothRefuse([
      pushRecord({
        verification_key: TEST_ONLY_WEBHOOK_SIGNER_B.publicKeyText,
        key_identity: TEST_ONLY_WEBHOOK_SIGNER.keyIdentity,
      }),
    ]);
    // …and the rotated record with the RE-DERIVED identity is accepted.
    expect(auditAccepts([pushRecord({}, TEST_ONLY_WEBHOOK_SIGNER_B)])).toBe(true);
    expect(kernelAccepts([pushRecord({}, TEST_ONLY_WEBHOOK_SIGNER_B)])).toBe(true);
    expect(TEST_ONLY_WEBHOOK_SIGNER_B.keyIdentity).not.toBe(TEST_ONLY_WEBHOOK_SIGNER.keyIdentity);
  });

  it('an identity hashed over the BASE64 TEXT instead of the consumed DER is refused', () => {
    const overText = createHash('sha256')
      .update(TEST_ONLY_WEBHOOK_SIGNER.publicKeyText, 'ascii')
      .digest('hex');
    bothRefuse([pushRecord({ key_identity: overText })]);
    const upper = TEST_ONLY_WEBHOOK_SIGNER.keyIdentity.toUpperCase();
    bothRefuse([pushRecord({ key_identity: upper })]);
  });

  it('a non-P-256 key is refused: P-384, secp256k1, Ed25519, RSA', () => {
    const others = [
      generateKeyPairSync('ec', { namedCurve: 'secp384r1' }).publicKey,
      generateKeyPairSync('ec', { namedCurve: 'secp256k1' }).publicKey,
      generateKeyPairSync('ed25519').publicKey,
      generateKeyPairSync('rsa', { modulusLength: 2048 }).publicKey,
    ];
    for (const key of others) {
      const der = key.export({ format: 'der', type: 'spki' });
      const text = der.toString('base64');
      expect(parseVerificationKey(text).ok).toBe(false);
      bothRefuse([
        pushRecord({
          verification_key: text,
          key_identity: createHash('sha256').update(der).digest('hex'),
        }),
      ]);
    }
  });

  it('invalid or non-canonical Base64 key text is refused', () => {
    const text = TEST_ONLY_WEBHOOK_SIGNER.publicKeyText;
    const variants = [
      text.replace(/=+$/, ''), // missing padding
      text.replace(/\+/g, '-').replace(/\//g, '_'), // URL-safe alphabet
      `${text.slice(0, 20)}\n${text.slice(20)}`, // embedded newline
      ` ${text}`, // leading whitespace
      `${text}AAAA`, // trailing garbage that decodes
      '',
    ];
    for (const variant of variants) {
      if (variant === text) continue;
      expect(parseVerificationKey(variant).ok, JSON.stringify(variant.slice(0, 12))).toBe(false);
      bothRefuse([pushRecord({ verification_key: variant })]);
    }
  });

  it('NO ALTERNATE ENCODING IS TRIED: PEM, raw DER hex, a raw point and a compressed point are refused', () => {
    const der = TEST_ONLY_WEBHOOK_SIGNER.spkiDer;
    const pem = `-----BEGIN PUBLIC KEY-----\n${der.toString('base64')}\n-----END PUBLIC KEY-----\n`;
    const rawPoint = der.subarray(der.length - 65).toString('base64');
    const point = der.subarray(der.length - 65);
    const compressedPoint = Buffer.concat([
      Buffer.from([(point[64]! & 1) === 1 ? 0x03 : 0x02]),
      point.subarray(1, 33),
    ]);
    const compressedSpki = Buffer.concat([
      Buffer.from('3039301306072a8648ce3d020106082a8648ce3d030107032200', 'hex'),
      compressedPoint,
    ]);
    for (const variant of [
      pem,
      der.toString('hex'),
      rawPoint,
      compressedSpki.toString('base64'),
      Buffer.concat([der, Buffer.from([0x00])]).toString('base64'),
    ]) {
      expect(parseVerificationKey(variant).ok).toBe(false);
      bothRefuse([pushRecord({ verification_key: variant })]);
    }
  });
});

describe('`S1P-W5` — the ingress identity grammar', () => {
  const refused = [
    'http://webhook.example.test/provider-evidence/sendgrid',
    'HTTPS://webhook.example.test/provider-evidence/sendgrid',
    'https://Webhook.Example.Test/provider-evidence/sendgrid',
    'https://webhook.example.test:443/provider-evidence/sendgrid',
    'https://user@webhook.example.test/provider-evidence/sendgrid',
    'https://webhook.example.test/provider-evidence/sendgrid?x=1',
    'https://webhook.example.test/provider-evidence/sendgrid#frag',
    'https://webhook.example.test/provider-evidence/sendgrid/',
    'https://webhook.example.test/provider-evidence//sendgrid',
    'https://webhook.example.test/provider-evidence/../sendgrid',
    'https://webhook.example.test/provider-evidence/./sendgrid',
    'https://webhook.example.test/provider-evidence/%73endgrid',
    'https://webhook.example.test/provider-evidence/*',
    'https://webhook.example.test/provider-evidence/:provider',
    'https://webhook.example.test/provider-evidence/{provider}',
    'https://*.example.test/provider-evidence/sendgrid',
    'https://webhook.example.test./provider-evidence/sendgrid',
    'https://203.0.113.7/provider-evidence/sendgrid',
    'https://[2001:db8::1]/provider-evidence/sendgrid',
    'https://webhook.example.test',
    'https://webhook.example.test/',
    'webhook.example.test/provider-evidence/sendgrid',
    'sendgrid-webhook',
  ];

  it.each(refused)('refuses %s', (value) => {
    expect(parseIngressIdentity(value).ok).toBe(false);
    bothRefuse([pushRecord({ ingress_identity: value })]);
  });

  it('accepts the canonical test ingress, and an A-label host', () => {
    expect(parseIngressIdentity(TEST_INGRESS_IDENTITY).ok).toBe(true);
    expect(parseIngressIdentity('https://xn--bcher-kva.example.test/evidence').ok).toBe(true);
  });

  it('two push channels may not share one ingress (one fixed route per channel)', () => {
    bothRefuse([pushRecord(), pushRecord({ provider: 'z_provider' })]);
  });
});

describe('`50 §6` — class 28 reaches consumers ONLY through the verified bundle, on both planes', () => {
  it('the audit plane’s OWN verification yields the parsed channels and the class-28 digest', () => {
    const fixture = providerEvidenceArtifactFixture();
    const outcome = verifyAuditPlaneControlArtifacts(fixture.auditEnv);
    expect(outcome.verified).toBe(true);
    if (!outcome.verified) return;
    expect(outcome.providerEvidenceTrust.providers).toEqual(['synthetic_esp', 'twilio_sendgrid']);
    expect(outcome.providerEvidenceTrustDigest).toMatch(/^[0-9a-f]{64}$/);
    const control = verifiedProviderEvidenceTrust(verifyFixtureBundle(fixture));
    expect(control.providers).toEqual(['synthetic_esp', 'twilio_sendgrid']);
    expect(control.channels['twilio_sendgrid']).toMatchObject({
      evidenceMode: 'SIGNED_PROVIDER_PUSH',
      keyIdentity: TEST_ONLY_WEBHOOK_SIGNER.keyIdentity,
      ingressIdentity: TEST_INGRESS_IDENTITY,
    });
  });

  it('a signed but MALFORMED class-28 record fails BOTH planes’ bootstrap, independently', () => {
    const fixture = providerEvidenceArtifactFixture([
      readRecord({ verification_key: TEST_ONLY_WEBHOOK_SIGNER.publicKeyText }),
    ]);
    const audit = verifyAuditPlaneControlArtifacts(fixture.auditEnv);
    expect(audit.verified).toBe(false);
    expect(() => verifyFixtureBundle(fixture)).toThrow(ControlArtifactIntegrityFailure);
  });

  it('the repository’s deployed class 28 carries ONE synthetic read channel and NO push channel', () => {
    // No real provider key exists in this repository. A push channel is test-only material.
    const fixture = buildControlArtifactFixture();
    const outcome = verifyAuditPlaneControlArtifacts(fixture.auditEnv);
    expect(outcome.verified).toBe(true);
    if (!outcome.verified) return;
    expect(outcome.providerEvidenceTrust.providers).toEqual(['synthetic_esp']);
    expect(outcome.providerEvidenceTrust.channels['synthetic_esp']!.evidenceMode).toBe(
      'PROVIDER_READ',
    );
    expect(
      Object.values(verifiedProviderEvidenceTrust(verifyFixtureBundle(fixture)).channels).some(
        (channel) => channel.evidenceMode === 'SIGNED_PROVIDER_PUSH',
      ),
    ).toBe(false);
  });
});
