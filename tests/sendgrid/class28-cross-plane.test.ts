import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { verifyAuditPlaneControlArtifacts } from '../../src/audit/controlArtifacts/auditPlaneVerifier.js';
import {
  bundleArtifactIdentities,
  verifiedProviderEvidenceTrust,
  verifiedProviderEvidenceTrustContentHash,
  type VerifiedControlArtifactBundle,
} from '../../src/kernel/controlArtifacts/bundle.js';
import {
  auditPlaneAgreesOnPushChannel,
  planesAgreeOnClass28,
  type AuditPlaneVerification,
} from '../../validation/sendgrid/harness/liveComposition.js';
import type { ControlArtifactFixture } from '../support/controlArtifactFixture.js';
import {
  TEST_ONLY_WEBHOOK_SIGNER,
  TEST_ONLY_WEBHOOK_SIGNER_B,
  pushRecord,
  readRecord,
} from '../support/providerEvidenceFixture.js';
import { S1P_PROVIDER_ID, s1pPushValidationArtifacts } from '../support/s1pScenarioFixture.js';

/**
 * FINAL CORRECTION, DEFECT 1 — CROSS-PLANE CLASS-28 AGREEMENT IS EXACT-ARTIFACT IDENTITY.
 *
 * Class 28 is ONE signed control artifact. The control bundle and the audit plane verify their
 * copies independently, and they agree only when both bound the SAME exact artifact bytes:
 * the control bundle's class-28 content hash (`50 §3c`) EQUALS the audit plane's
 * `providerEvidenceTrustDigest`. Every package below is independently built and DUAL-SIGNED, and
 * every split-brain variant keeps the SAME SendGrid verification key — so the previous
 * mode + `key_identity` comparison would have accepted each of them.
 */

const CONTROL = s1pPushValidationArtifacts();

function auditVerificationOf(fixture: ControlArtifactFixture): AuditPlaneVerification {
  const outcome = verifyAuditPlaneControlArtifacts(fixture.auditEnv);
  if (!outcome.verified) throw new Error(`audit plane did not verify: ${outcome.reason}`);
  return outcome;
}

function sendgridKeyIdentity(bundle: VerifiedControlArtifactBundle): string | null {
  const channel = verifiedProviderEvidenceTrust(bundle).channels[S1P_PROVIDER_ID];
  return channel?.evidenceMode === 'SIGNED_PROVIDER_PUSH' ? channel.keyIdentity : null;
}

/** Same SendGrid key; a different, independently valid and signed class-28 artifact. */
const SPLIT_BRAIN: readonly (readonly [string, ReturnType<typeof s1pPushValidationArtifacts>])[] = [
  [
    'accepted_event_classes differ',
    s1pPushValidationArtifacts([pushRecord({ accepted_event_classes: ['delivered', 'processed'] })]),
  ],
  [
    'ingress_identity differs',
    s1pPushValidationArtifacts([
      pushRecord({ ingress_identity: 'https://webhook-b.example.test/provider-evidence/sendgrid' }),
    ]),
  ],
  /*
   * `accepted_count_operand` and `verification_profile` of the SendGrid PUSH record cannot
   * differ while staying valid: the closed parser admits one profile, and refuses a push
   * operand the profile does not count. So the artifact is changed ELSEWHERE — another
   * channel's `accepted_count_operand` — while the SendGrid record and its key are untouched.
   */
  [
    'another channel’s accepted_count_operand differs',
    s1pPushValidationArtifacts([pushRecord()], {
      otherChannels: [readRecord({ accepted_count_operand: 'provider_event_message_id' })],
    }),
  ],
  [
    'another channel is added',
    s1pPushValidationArtifacts([pushRecord()], {
      otherChannels: [readRecord(), readRecord({ provider: 'synthetic_esp_b' })],
    }),
  ],
  [
    'only the exact bytes differ (same parsed content, different JSON indentation)',
    s1pPushValidationArtifacts([pushRecord()], { indent: 4 }),
  ],
];

describe('the planes agree ONLY on the exact class-28 artifact bytes', () => {
  it('each plane obtains its digest from its OWN verification of the exact bytes', () => {
    const control = verifiedProviderEvidenceTrustContentHash(CONTROL.bundle);
    const identity = bundleArtifactIdentities(CONTROL.bundle).find((entry) => entry.artifactClass === 28)!;
    expect(control).toBe(identity.contentHash);
    // Both are SHA-256 over the exact artifact bytes on disk: nothing re-serialised.
    const bytes = CONTROL.fixture.artifacts.find((artifact) => artifact.artifactClass === 28)!.bytes;
    expect(control).toBe(createHash('sha256').update(bytes).digest('hex'));
    expect(auditVerificationOf(CONTROL.fixture).providerEvidenceTrustDigest).toBe(control);
  });

  it('IDENTICAL class-28 bytes on both planes => agreement (stage 1 and the composition rule)', () => {
    expect(auditPlaneAgreesOnPushChannel(CONTROL.fixture.auditEnv, CONTROL.bundle)).toBe(true);
    expect(planesAgreeOnClass28(CONTROL.bundle, auditVerificationOf(CONTROL.fixture))).toBe(true);
  });

  it('a SEPARATELY BUILT AND SIGNED package with byte-identical class 28 => agreement', () => {
    const twin = s1pPushValidationArtifacts([pushRecord()], { label: 'separately signed twin' });
    expect(twin.fixture.auditRoot).not.toBe(CONTROL.fixture.auditRoot);
    expect(auditPlaneAgreesOnPushChannel(twin.fixture.auditEnv, CONTROL.bundle)).toBe(true);
  });

  for (const [label, audit] of SPLIT_BRAIN) {
    it(`SAME SendGrid key, ${label} => REFUSED at both sites`, () => {
      // The previous rule's operands are EQUAL — mode and key identity both match.
      expect(sendgridKeyIdentity(audit.bundle)).toBe(TEST_ONLY_WEBHOOK_SIGNER.keyIdentity);
      expect(sendgridKeyIdentity(audit.bundle)).toBe(sendgridKeyIdentity(CONTROL.bundle));
      const verification = auditVerificationOf(audit.fixture);
      expect(verification.providerEvidenceTrust.channels[S1P_PROVIDER_ID]?.evidenceMode).toBe(
        'SIGNED_PROVIDER_PUSH',
      );
      // ...and the artifact digests differ, so both sites refuse.
      expect(verification.providerEvidenceTrustDigest).not.toBe(
        verifiedProviderEvidenceTrustContentHash(CONTROL.bundle),
      );
      expect(auditPlaneAgreesOnPushChannel(audit.fixture.auditEnv, CONTROL.bundle)).toBe(false);
      expect(planesAgreeOnClass28(CONTROL.bundle, verification)).toBe(false);
      // Symmetric: neither copy may stand in for the other.
      expect(planesAgreeOnClass28(audit.bundle, auditVerificationOf(CONTROL.fixture))).toBe(false);
    });
  }

  it('a DIFFERENT SendGrid key => refused, as before', () => {
    const other = s1pPushValidationArtifacts([pushRecord({}, TEST_ONLY_WEBHOOK_SIGNER_B)]);
    expect(sendgridKeyIdentity(other.bundle)).toBe(TEST_ONLY_WEBHOOK_SIGNER_B.keyIdentity);
    expect(auditPlaneAgreesOnPushChannel(other.fixture.auditEnv, CONTROL.bundle)).toBe(false);
    expect(planesAgreeOnClass28(CONTROL.bundle, auditVerificationOf(other.fixture))).toBe(false);
  });

  it('a READ-mode copy on the audit plane => refused', () => {
    const read = s1pPushValidationArtifacts([
      readRecord({ provider: S1P_PROVIDER_ID, accepted_count_operand: 'msg_id' }),
    ]);
    expect(auditPlaneAgreesOnPushChannel(read.fixture.auditEnv, CONTROL.bundle)).toBe(false);
    expect(planesAgreeOnClass28(CONTROL.bundle, auditVerificationOf(read.fixture))).toBe(false);
  });

  it('BOTH check sites use the one shared rule, and no mode+key-only comparison survives', () => {
    const source = readFileSync(join('validation', 'sendgrid', 'harness', 'liveComposition.ts'), 'utf8');
    const preflightSite = source.slice(
      source.indexOf('export function auditPlaneAgreesOnPushChannel('),
      source.indexOf('export type AuditPlaneVerification'),
    );
    expect(preflightSite).toContain('return planesAgreeOnClass28(bundle, verification);');
    const compositionStart = source.indexOf('export async function openLiveComposition(');
    expect(compositionStart).toBeGreaterThan(0);
    expect(source.slice(compositionStart)).toContain('!planesAgreeOnClass28(bundle, auditVerification)');
    // The ONLY key-identity comparison in the module sits inside the shared rule, AFTER the digest check.
    const rule = source.slice(
      source.indexOf('export function planesAgreeOnClass28('),
      source.indexOf('export type CompositionBlock'),
    );
    expect(rule.indexOf('providerEvidenceTrustDigest')).toBeLessThan(rule.indexOf('keyIdentity'));
    expect([...source.matchAll(/\.keyIdentity\b/g)].length).toBe([...rule.matchAll(/\.keyIdentity\b/g)].length);
  });
});
