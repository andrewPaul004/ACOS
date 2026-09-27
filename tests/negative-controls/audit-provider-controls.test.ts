import { afterEach, describe, expect, it } from 'vitest';

import {
  AUDIT_READ_PROTOCOL_VERSION,
  decodeProviderReadRequest,
} from '../../src/audit/provider/protocol/readWire.js';
import {
  REQUIRED_AUDIT_CREDENTIAL_RISK_CLASS,
  handleProviderReadRequest,
} from '../../src/audit/provider/runtime/auditReadHost.js';
import { deriveIndependentFinding } from '../../src/audit/provider/independentFinding.js';
import type { AuditReadOutcome } from '../../src/audit/provider/plane/auditReadClient.js';
import { auditProviderReader } from '../audit-plane/readerA/reader.js';
import {
  UnsafeInProcessAuditCredentialHolder,
  UnsafeSendCapableAuditReader,
  UnsafeSharedAuditSecretSource,
  fixedAuditSecretSource,
  unsafeAuditReaderRegistry,
  unsafeControlTrustingFinding,
  unsafeDecodeUrlBearingReadRequest,
  unsafeHandleProviderReadRequest,
} from './unsafe-audit-read-boundary.js';
import {
  AUDIT_PERIOD_END_MS,
  AUDIT_PERIOD_START_MS,
  AUDIT_PROVIDER,
  AUDIT_READ_CREDENTIAL_ID,
  auditReaderRegistry,
  awaitReaderReady,
  launchAuditReader,
  mintAuditSentinelSecret,
  readerADescriptor,
  type LaunchedAuditReader,
} from '../support/auditProviderFixture.js';
import { mintSentinelSecret } from '../support/integrationFixture.js';

/**
 * `§29` ITEMS 5–9 — THE AUDIT PROVIDER-READ VULNERABLE CONTROLS.
 *
 * "Each must discriminate." Every case runs the UNSAFE implementation and the PRODUCTION one
 * on the SAME input and asserts they give different answers.
 */

let launched: LaunchedAuditReader | null = null;

afterEach(async () => {
  if (launched !== null) {
    await launched.close();
    launched = null;
  }
});

const READ = {
  readId: 'r1',
  operation: 'MESSAGE_ACTIVITY_SEARCH' as const,
  periodStartMs: AUDIT_PERIOD_START_MS,
  periodEndMs: AUDIT_PERIOD_END_MS,
  correlationTag: 'acos-corr-control',
  providerMessageId: null,
  maxRecords: 10,
};

function encoded(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    protocolVersion: AUDIT_READ_PROTOCOL_VERSION,
    kind: 'PROVIDER_READ_REQUEST',
    providerId: AUDIT_PROVIDER,
    ...READ,
    ...overrides,
  });
}

/* ================================================================================
 * CONTROL 5 — THE AUDIT CREDENTIAL IN THE PARENT PROCESS
 * ============================================================================== */

describe('CONTROL 5 — the audit credential resides in the control/audit parent process', () => {
  it('UNSAFE leaves the material on a heap object here; PRODUCTION keeps it in the child', async () => {
    const secret = mintAuditSentinelSecret('c5');

    // UNSAFE: the material is resolved in THIS process and is readable from it.
    const holder = new UnsafeInProcessAuditCredentialHolder(AUDIT_PROVIDER, secret);
    expect(holder.resolvedSecret).toBeNull();
    await holder.resolve();
    expect(holder.resolvedSecret).toBe(secret);

    // PRODUCTION: the parent forks a reader and never resolves anything itself. Every
    // surface it can observe is free of the sentinel, and the material exists only in the
    // child's own heap.
    let locator = '';
    launched = launchAuditReader((secrets) => {
      locator = secrets.write('audit', {
        providerId: AUDIT_PROVIDER,
        secret,
        credentialIdentity: AUDIT_READ_CREDENTIAL_ID,
      });
      return auditReaderRegistry([readerADescriptor(locator)]);
    });
    const outcome = await launched.client.read({
      providerId: AUDIT_PROVIDER,
      operation: 'MESSAGE_ACTIVITY_SEARCH',
      periodStartMs: AUDIT_PERIOD_START_MS,
      periodEndMs: AUDIT_PERIOD_END_MS,
      correlationTag: 'acos-corr-c5',
    });
    const pid = await awaitReaderReady(launched.client, AUDIT_PROVIDER);
    expect(pid).not.toBe(process.pid);
    expect(JSON.stringify(outcome)).not.toContain(secret);
    expect(launched.client.capturedReaderStderr(AUDIT_PROVIDER) ?? '').not.toContain(secret);
    // The response carries the SOURCE's label and no material.
    expect(outcome.kind === 'EVIDENCE' && outcome.credentialIdentity).toBe(
      AUDIT_READ_CREDENTIAL_ID,
    );
  });
});

/* ================================================================================
 * CONTROL 6 — ONE SOURCE SERVING BOTH SCOPES
 * ============================================================================== */

describe('CONTROL 6 — the audit credential shared with the send adapter', () => {
  it('UNSAFE hands the SEND credential to whoever asks; PRODUCTION cannot be asked', async () => {
    const auditSecret = mintAuditSentinelSecret('c6');
    const sendSecret = mintSentinelSecret('c6');
    const shared = new UnsafeSharedAuditSecretSource(
      AUDIT_PROVIDER,
      new Map([
        [AUDIT_PROVIDER, auditSecret],
        ['mock_ads', sendSecret],
      ]),
    );

    // UNSAFE: the selector reaches the OTHER plane's credential.
    const crossPlane = await shared.resolve('mock_ads');
    expect(crossPlane.kind).toBe('RESOLVED');
    expect(crossPlane.kind === 'RESOLVED' && crossPlane.credential.secret).toBe(sendSecret);

    // PRODUCTION: `AuditReadSecretSource.resolve()` takes NO argument, so there is no ask.
    const production = fixedAuditSecretSource(AUDIT_PROVIDER, auditSecret);
    expect(production.resolve.length).toBe(0);
    const own = await production.resolve();
    expect(own.kind === 'RESOLVED' && own.credential.secret).toBe(auditSecret);
  });

  it('and a SHARED LOCATOR is refused at the registry, whatever the source type is', () => {
    const shared = '/tmp/one-secret-for-both.json';
    expect(() => auditReaderRegistry([readerADescriptor(shared)], new Set([shared]))).toThrow(
      /READER_LOCATOR_SHARED_WITH_INTEGRATION/,
    );
    // UNSAFE: no collision check at all.
    expect(unsafeAuditReaderRegistry([readerADescriptor(shared)]).registeredIds).toEqual([
      AUDIT_PROVIDER,
    ]);
  });
});

/* ================================================================================
 * CONTROL 7 — AN AUDIT PROVIDER CLIENT THAT EXPOSES A SEND
 * ============================================================================== */

describe('CONTROL 7 — the audit provider client exposes a send operation', () => {
  it('UNSAFE mutates provider state with the AUDIT credential; PRODUCTION refuses the object', async () => {
    const secret = mintAuditSentinelSecret('c7');
    const unsafeReader = new UnsafeSendCapableAuditReader(AUDIT_PROVIDER);
    const source = fixedAuditSecretSource(AUDIT_PROVIDER, secret, AUDIT_READ_CREDENTIAL_ID);

    // UNSAFE: the reader satisfies the interface structurally AND can write.
    const resolution = await source.resolve();
    expect(resolution.kind).toBe('RESOLVED');
    await unsafeReader.sendToProvider(
      resolution.kind === 'RESOLVED'
        ? resolution.credential
        : {
            secret: '',
            credentialIdentity: '',
            identityProvenance: 'SYNTHETIC_TEST_IDENTITY' as const,
            version: null,
          },
      'a mutation nobody authorised',
    );
    expect(unsafeReader.mutations).toHaveLength(1);

    // PRODUCTION: the host refuses the object before any credential is resolved.
    const refused = await handleProviderReadRequest(
      {
        providerId: AUDIT_PROVIDER,
        reader: unsafeReader,
        secretSource: source,
        credentialRiskClass: REQUIRED_AUDIT_CREDENTIAL_RISK_CLASS,
        expectedCredentialId: AUDIT_READ_CREDENTIAL_ID,
      },
      encoded(),
    );
    expect(refused.kind).toBe('PROVIDER_READ_REFUSED');
    expect(refused.kind === 'PROVIDER_READ_REFUSED' && refused.reason).toBe(
      'CREDENTIAL_NOT_READ_ONLY',
    );
    // And it produced no additional mutation — the guard ran before the reader was used.
    expect(unsafeReader.mutations).toHaveLength(1);

    // The REAL reader is admitted by the same host, so the refusal is not vacuous.
    const accepted = await handleProviderReadRequest(
      {
        providerId: AUDIT_PROVIDER,
        reader: auditProviderReader,
        secretSource: source,
        credentialRiskClass: REQUIRED_AUDIT_CREDENTIAL_RISK_CLASS,
        expectedCredentialId: AUDIT_READ_CREDENTIAL_ID,
      },
      encoded(),
    );
    expect(accepted.kind).toBe('PROVIDER_READ_RESPONSE');
  });

  it('and the host REFUSES a credential class that is not READ_ONLY', async () => {
    const source = fixedAuditSecretSource(AUDIT_PROVIDER, mintAuditSentinelSecret('c7b'));
    const configuration = {
      providerId: AUDIT_PROVIDER,
      reader: auditProviderReader,
      secretSource: source,
      credentialRiskClass: 'NON_MONETARY_WRITE',
      expectedCredentialId: 'unsafe-fixture',
    };
    const refused = await handleProviderReadRequest(configuration, encoded());
    expect(refused.kind === 'PROVIDER_READ_REFUSED' && refused.reason).toBe(
      'CREDENTIAL_NOT_READ_ONLY',
    );

    // UNSAFE: guards 3 and 4 removed — the read happens.
    const leaked = await unsafeHandleProviderReadRequest(configuration, READ);
    expect(leaked.kind).toBe('PROVIDER_READ_RESPONSE');
  });
});

/* ================================================================================
 * CONTROL 8 — THE AUDIT PLANE TRUSTING THE CONTROL PLANE
 * ============================================================================== */

describe('CONTROL 8 — the audit finding derived from a control-plane verdict', () => {
  const expectation = { correlationTag: 'acos-corr-c8', auditStateExpectsProviderRecord: true };
  const evidenceWith = (correlationTag: string): AuditReadOutcome => ({
    kind: 'EVIDENCE',
    records: [
      {
        providerMessageId: 'm-other',
        providerStatus: 'accepted',
        providerTimestampMs: AUDIT_PERIOD_START_MS,
        correlationTag,
      },
    ],
    recordCount: 1,
    credentialIdentity: AUDIT_READ_CREDENTIAL_ID,
    providerQueriedAtMs: AUDIT_PERIOD_START_MS,
    readDigest: 'deadbeef',
  });
  const noMatchingEvidence = evidenceWith('acos-corr-someone-else');

  it('UNSAFE returns CORROBORATED on a FABRICATED control result; PRODUCTION returns MISSING', () => {
    // A control plane claiming success, and a provider that holds no such record.
    expect(unsafeControlTrustingFinding(noMatchingEvidence, expectation, true).finding).toBe(
      'CORROBORATED',
    );
    expect(deriveIndependentFinding(noMatchingEvidence, expectation).finding).toBe(
      'MISSING_PROVIDER_RECORD',
    );
  });

  it('PRODUCTION has NO parameter a control-plane verdict could arrive on', () => {
    // The mechanism is a TYPE, not a check: `deriveIndependentFinding` takes two operands
    // and `AuditExpectation` has no member for a control verdict.
    expect(deriveIndependentFinding.length).toBe(2);
    expect(Object.keys(expectation).sort()).toEqual([
      'auditStateExpectsProviderRecord',
      'correlationTag',
    ]);
  });

  it('a read that DID NOT HAPPEN is never reported as the provider holding nothing', () => {
    const noEvidence: AuditReadOutcome = { kind: 'NO_EVIDENCE', reason: 'PROVIDER_UNAVAILABLE' };
    // UNSAFE: an outage becomes a clean bill of health.
    expect(unsafeControlTrustingFinding(noEvidence, expectation, false).finding).toBe(
      'PROVIDER_HAS_NO_RECORD',
    );
    // PRODUCTION: silence is not agreement.
    expect(deriveIndependentFinding(noEvidence, expectation).finding).toBe('READ_INCONCLUSIVE');
  });

  it('`I8`’s inverse sweep: a record the audit plane did NOT expect is UNACCOUNTED', () => {
    expect(
      deriveIndependentFinding(evidenceWith('acos-corr-c8'), {
        correlationTag: 'acos-corr-c8',
        auditStateExpectsProviderRecord: false,
      }).finding,
    ).toBe('UNACCOUNTED_PROVIDER_RECORD');
  });
});

/* ================================================================================
 * CONTROL 9 — A CALLER-SUPPLIED ARBITRARY URL
 * ============================================================================== */

describe('CONTROL 9 — the read query accepts a caller-supplied arbitrary URL', () => {
  it('UNSAFE decodes a message carrying a destination; PRODUCTION refuses it', () => {
    const withUrl = JSON.stringify({
      protocolVersion: AUDIT_READ_PROTOCOL_VERSION,
      kind: 'PROVIDER_READ_REQUEST',
      readId: 'r1',
      url: 'https://attacker.example/collect',
      periodStartMs: AUDIT_PERIOD_START_MS,
      periodEndMs: AUDIT_PERIOD_END_MS,
    });

    // UNSAFE: the destination survives the decode, and the credential would be presented at it.
    const unsafe = unsafeDecodeUrlBearingReadRequest(withUrl);
    expect(unsafe).not.toBeNull();
    expect(unsafe!.url).toBe('https://attacker.example/collect');

    // PRODUCTION: an unknown field is a refusal, not an ignored key.
    const production = decodeProviderReadRequest(withUrl);
    expect(production.kind).toBe('REFUSED');
    expect(production.kind === 'REFUSED' && production.reason).toBe('UNKNOWN_FIELD');
  });

  it('and PRODUCTION still refuses when the URL rides alongside every valid field', () => {
    const decoded = decodeProviderReadRequest(
      encoded({ url: 'https://attacker.example/collect' }),
    );
    expect(decoded.kind === 'REFUSED' && decoded.reason).toBe('UNKNOWN_FIELD');
  });
});
