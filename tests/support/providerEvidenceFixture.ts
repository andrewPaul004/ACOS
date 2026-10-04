import { createHash, createPrivateKey, createPublicKey, randomUUID, sign, type KeyObject } from 'node:crypto';

import {
  buildControlArtifactFixture,
  withArtifactBytes,
  type ControlArtifactFixture,
} from './controlArtifactFixture.js';

/**
 * TEST-ONLY provider-evidence material: P-256 webhook signers, class-28 records, signed requests.
 *
 * =================================================================================
 * THESE KEYS ARE NOT, AND CANNOT BECOME, A PROVIDER KEY
 *
 * A real `SIGNED_PROVIDER_PUSH` trust root is SendGrid's PUBLIC key, captured by the owner at
 * provisioning and released through the class-28 ceremony. No such key exists in this
 * repository and none is created here. What this module holds are TEST-ONLY P-256 private keys,
 * derived DETERMINISTICALLY from a sentence that says what they are — exactly as
 * `controlArtifactFixture.ts` derives its test-only Ed25519 owner roots — so that a signature
 * fixture is reproducible on every machine and nobody can mistake the key for a provider's.
 *
 * NOTHING UNDER `src/` CAN LOAD THIS FILE. `tests/controlArtifacts/key-hygiene.test.ts` asserts
 * no `src/` module imports `tests/`, and the packaging manifest's ingress obligation refuses any
 * `tests/` module in the receiver's closure.
 *
 * The ingress URL is unmistakably non-production: `example.test` is an RFC 6761 reserved name.
 * =================================================================================
 */

/** RFC 6761 reserved; never a real ingress. */
export const TEST_INGRESS_IDENTITY = 'https://webhook.example.test/provider-evidence/sendgrid';

export const TEST_PROVIDER = 'twilio_sendgrid';

export const ACCEPTED_EVENT_CLASSES = ['processed'] as const;

/**
 * SendGrid's own published helper-library test vector (`sendgrid-go` and `sendgrid-python`
 * `helpers/eventwebhook` tests). A PUBLIC KNOWN-ANSWER vector: the key, signature, timestamp and
 * exact payload octets the provider's own helpers verify. It is a `dropped` event carrying the
 * fixture address `hello@world.com`, so it is also a data-minimisation probe: a verified body
 * whose address must never reach the store or a log.
 */
export const SENDGRID_HELPER_VECTOR = Object.freeze({
  publicKey:
    'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE83T4O/n84iotIvIW4mdBgQ/7dAfSmpqIM8kF9mN1flpVKS3GRqe62gw+2fNNRaINXvVpiglSI8eNEc6wEA3F+g==',
  signature:
    'MEUCIGHQVtGj+Y3LkG9fLcxf3qfI10QysgDWmMOVmxG0u6ZUAiEAyBiXDWzM+uOe5W0JuG+luQAbPIqHh89M15TluLtEZtM=',
  timestamp: '1600112502',
  payload: Buffer.from(
    '[{"email":"hello@world.com","event":"dropped","reason":"Bounced Address",' +
      '"sg_event_id":"ZHJvcC0xMDk5NDkxOS1MUnpYbF9OSFN0T0doUTRrb2ZTbV9BLTA",' +
      '"sg_message_id":"LRzXl_NHStOGhQ4kofSm_A.filterdrecv-p3mdw1-756b745b58-kmzbl-18-5F5FC76C-9.0",' +
      '"smtp-id":"<LRzXl_NHStOGhQ4kofSm_A@ismtpd0039p1iad1.sendgrid.net>","timestamp":1600112492}]\r\n',
    'utf8',
  ),
});

export interface TestOnlyWebhookSigner {
  readonly privateKey: KeyObject;
  /** Standard Base64 of the DER SPKI — the provider-returned `public_key` representation. */
  readonly publicKeyText: string;
  readonly spkiDer: Buffer;
  /** `lowercase_hex(SHA-256(spkiDer))`. */
  readonly keyIdentity: string;
}

/**
 * A P-256 private key from a fixed 32-byte scalar, imported as SEC 1 WITHOUT a public key so the
 * platform derives the public point. The scalar is the sentence's bytes, which are far below the
 * group order.
 */
function testOnlySigner(sentence: string): TestOnlyWebhookSigner {
  // The sentence IS the scalar, so it must fit in 32 bytes: two sentences sharing a 32-byte
  // prefix would silently be one key.
  if (Buffer.byteLength(sentence) > 32) throw new Error('a test-only signer sentence exceeds 32 bytes');
  const scalar = Buffer.alloc(32, 0);
  Buffer.from(sentence, 'utf8').copy(scalar, 0, 0, Math.min(32, Buffer.byteLength(sentence)));
  const sec1 = Buffer.concat([
    Buffer.from('30310201010420', 'hex'),
    scalar,
    Buffer.from('a00a06082a8648ce3d030107', 'hex'),
  ]);
  const privateKey = createPrivateKey({ key: sec1, format: 'der', type: 'sec1' });
  const spkiDer = createPublicKey(privateKey).export({ format: 'der', type: 'spki' });
  return Object.freeze({
    privateKey,
    publicKeyText: spkiDer.toString('base64'),
    spkiDer,
    keyIdentity: createHash('sha256').update(spkiDer).digest('hex'),
  });
}

export const TEST_ONLY_WEBHOOK_SIGNER = testOnlySigner('ACOS TEST-ONLY SG WEBHOOK KEY A');
/** A second key: a rotation target, and the "wrong key" negative. */
export const TEST_ONLY_WEBHOOK_SIGNER_B = testOnlySigner('ACOS TEST-ONLY SG WEBHOOK KEY B');

/** `SENDGRID_EVENT_WEBHOOK_V1` signing: ECDSA P-256 / SHA-256 over timestamp ‖ body, DER, Base64. */
export function signWebhook(
  timestamp: string,
  body: Buffer,
  signer: TestOnlyWebhookSigner = TEST_ONLY_WEBHOOK_SIGNER,
): string {
  return sign('sha256', Buffer.concat([Buffer.from(timestamp, 'ascii'), body]), {
    key: signer.privateKey,
    dsaEncoding: 'der',
  }).toString('base64');
}

/** A kernel-shaped correlation tag. */
export function correlationTag(): string {
  return `acos-corr-${randomUUID()}`;
}

/** One `processed` event in SendGrid's Event Webhook shape, with an ACOS custom argument. */
export function processedEvent(
  correlation: string,
  overrides: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    email: 'sink-owner@example.test',
    event: 'processed',
    sg_event_id: `evt-${randomUUID()}`,
    sg_message_id: `msg-${randomUUID()}.filter`,
    timestamp: 1_760_000_000,
    category: [correlation],
    acos_correlation_tag: correlation,
    'smtp-id': '<smtp-id@example.test>',
    ...overrides,
  };
}

/** A body exactly as a provider might send it: compact JSON with the trailing CRLF. */
export function bodyOf(events: readonly unknown[]): Buffer {
  return Buffer.from(`${JSON.stringify(events)}\r\n`, 'utf8');
}

/** A `SIGNED_PROVIDER_PUSH` class-28 record. Every field may be overridden or deleted. */
export function pushRecord(
  overrides: Readonly<Record<string, unknown>> = {},
  signer: TestOnlyWebhookSigner = TEST_ONLY_WEBHOOK_SIGNER,
): Record<string, unknown> {
  return {
    provider: TEST_PROVIDER,
    evidence_mode: 'SIGNED_PROVIDER_PUSH',
    accepted_count_operand: 'sg_message_id',
    verification_key: signer.publicKeyText,
    verification_profile: 'SENDGRID_EVENT_WEBHOOK_V1',
    key_identity: signer.keyIdentity,
    accepted_event_classes: [...ACCEPTED_EVENT_CLASSES],
    ingress_identity: TEST_INGRESS_IDENTITY,
    ...overrides,
  };
}

/** A `PROVIDER_READ` class-28 record: exactly three fields. */
export function readRecord(
  overrides: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    provider: 'synthetic_esp',
    evidence_mode: 'PROVIDER_READ',
    accepted_count_operand: 'provider_message_id',
    ...overrides,
  };
}

export const CLASS_28_TEST_VERSION = 'acos.provider_evidence_trust.2026-10-03';

/** The exact class-28 artifact bytes for a set of records. */
export function class28Bytes(channels: readonly Record<string, unknown>[]): Buffer {
  return Buffer.from(
    `${JSON.stringify(
      {
        artifact_id: 'acos.control.provider_evidence_trust',
        artifact_version: CLASS_28_TEST_VERSION,
        channels,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
}

/**
 * A complete signed control-artifact package — both planes — whose class 28 carries the given
 * records. Signed by the TEST-ONLY owner roots through the SAME verification interface a
 * deployment uses; the receiver can only obtain its trust root through that verification.
 */
export function providerEvidenceArtifactFixture(
  channels: readonly Record<string, unknown>[] = [readRecord(), pushRecord()],
): ControlArtifactFixture {
  const bytes = class28Bytes(channels);
  return buildControlArtifactFixture({
    mutate: (artifacts) => withArtifactBytes(artifacts, 28, () => bytes),
  });
}

/** The deployment environment an ingress needs, for a fixture. None of it is authority. */
export function ingressEnvironment(
  fixture: ControlArtifactFixture,
  overrides: Readonly<Record<string, string | undefined>> = {},
): Record<string, string | undefined> {
  return {
    ...fixture.auditEnv,
    ACOS_AUDIT_PG_URL: process.env['ACOS_AUDIT_PG_URL'],
    ACOS_PROVIDER_EVIDENCE_PROVIDER: TEST_PROVIDER,
    ACOS_PROVIDER_EVIDENCE_INGRESS_ECHO: TEST_INGRESS_IDENTITY,
    ACOS_PROVIDER_EVIDENCE_LISTEN_HOST: '127.0.0.1',
    ACOS_PROVIDER_EVIDENCE_LISTEN_PORT: '0',
    ...overrides,
  };
}
