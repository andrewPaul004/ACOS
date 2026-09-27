import { afterEach, describe, expect, it } from 'vitest';

import {
  REQUIRED_AUDIT_CREDENTIAL_RISK_CLASS,
  handleProviderReadRequest,
  type AuditReaderConfiguration,
} from '../../../src/audit/provider/runtime/auditReadHost.js';
import {
  AUDIT_CREDENTIAL_IDENTITY_PROVENANCES,
  auditCredentialIdentityMismatch,
  type AuditReadSecretSource,
} from '../../../src/audit/provider/runtime/auditSecretSource.js';
import {
  AUDIT_READER_ENV_KEYS,
  ENV_AUDIT_EXPECTED_CREDENTIAL_ID,
  buildAuditReaderEnvironment,
} from '../../../src/audit/provider/protocol/readerEnvironment.js';
import {
  AUDIT_READ_PROTOCOL_VERSION,
  PROVIDER_READ_REFUSALS,
} from '../../../src/audit/provider/protocol/readWire.js';
import {
  CREDENTIAL_IDENTITY_PROVENANCES,
  credentialIdentityMismatch,
} from '../../../src/kernel/controlArtifacts/credentialRisk.js';
import { auditProviderReader } from '../../audit-plane/readerA/reader.js';
import {
  unsafeHandleWithoutAuditIdentityBinding,
  unsafeLocatorComparisonAsIdentityBinding,
  unsafeLocatorInequalityProvesSeparation,
} from '../../negative-controls/unsafe-credential-identity-binding.js';
import {
  AUDIT_PERIOD_END_MS,
  AUDIT_PERIOD_START_MS,
  AUDIT_PROVIDER,
  AUDIT_READ_CREDENTIAL_ID,
  SEND_CREDENTIAL_ID,
  auditReaderRegistry,
  awaitReaderReady,
  launchAuditReader,
  mintAuditSentinelSecret,
  readerADescriptor,
  type LaunchedAuditReader,
} from '../../support/auditProviderFixture.js';
import {
  ADAPTER_A,
  CREDENTIAL_A_NON_MONETARY,
  adapterADescriptor,
} from '../../support/integrationFixture.js';

/**
 * `50 §2g` FIELD 1 ON THE AUDIT PLANE — **AND WHY LOCATOR ISOLATION DOES NOT IMPLY IT.**
 *
 * =================================================================================
 * THE ATTACK PASSES EVERY CONTROL THIS PLANE ALREADY HAD
 *
 *     the signed class-5 record   `synthetic_esp.audit_read`, `audit_plane`-scoped,
 *                                 READ_ONLY, `external_mutation_capable` false     CORRECT
 *     the audit plane's verifier  read it from the audit plane's OWN copy           CORRECT
 *     the registry                admitted the descriptor against that record       CORRECT
 *     the risk-class echo         READ_ONLY                                         CORRECT
 *     the locator                 not one the integration plane holds               CORRECT
 *     the material at the locator a SEND-CAPABLE token                              WRONG
 *
 * Nothing above is a mistake, and the reader queries a provider with material nobody
 * classified. `48 §3.6`'s exemption — the reason an audit-plane vendor read carries no
 * `authorisation_ref`, which is the reason `I8`'s independent sweep is permitted to exist —
 * would be resting on a declaration about a credential the reader is not holding.
 *
 * =================================================================================
 * AND THE CONTROL THAT LOOKS LIKE IT SHOULD HAVE CAUGHT IT
 *
 * `createAuditReaderRegistry` refuses a descriptor whose `secretLocator` is one the
 * integration plane holds. It is a real control and it implements `§13`'s "not the same
 * secret source as the send credential". **It cannot decide this question**, in either
 * direction:
 *
 *     two locators, one credential   `/audit.json` and `/audit-alias.json` may resolve the
 *                                    same token. Inequality holds; separation does not.
 *     one locator, two credentials   the file at `/audit.json` may be rewritten. Equality
 *                                    holds across the change; the credential is different.
 *
 * Section 3 below asserts both halves: the locator control still refuses a shared locator,
 * AND locator inequality is not accepted as proof of anything about the credential.
 * =================================================================================
 */

let launched: LaunchedAuditReader | null = null;

afterEach(async () => {
  if (launched !== null) {
    await launched.close();
    launched = null;
  }
});

function sourceResolving(
  providerId: string,
  secret: string,
  credentialIdentity: string,
): AuditReadSecretSource {
  return {
    declaredProviderId: providerId,
    resolve: () =>
      Promise.resolve({
        kind: 'RESOLVED',
        credential: {
          secret,
          credentialIdentity,
          identityProvenance: 'SYNTHETIC_TEST_IDENTITY',
          version: null,
        },
      }),
  };
}

function configurationFor(
  expectedCredentialId: string,
  resolvedCredentialIdentity: string,
): AuditReaderConfiguration {
  return {
    providerId: AUDIT_PROVIDER,
    reader: auditProviderReader,
    secretSource: sourceResolving(
      AUDIT_PROVIDER,
      mintAuditSentinelSecret('binding'),
      resolvedCredentialIdentity,
    ),
    credentialRiskClass: REQUIRED_AUDIT_CREDENTIAL_RISK_CLASS,
    expectedCredentialId,
  };
}

const read = (): string =>
  JSON.stringify({
    protocolVersion: AUDIT_READ_PROTOCOL_VERSION,
    kind: 'PROVIDER_READ_REQUEST',
    readId: 'r-binding',
    operation: 'MESSAGE_ACTIVITY_SEARCH',
    providerId: AUDIT_PROVIDER,
    periodStartMs: AUDIT_PERIOD_START_MS,
    periodEndMs: AUDIT_PERIOD_END_MS,
    correlationTag: 'acos-corr-binding',
    providerMessageId: null,
    maxRecords: 10,
  });

/* ================================================================================
 * 1. THE BINDING IS DECLARED, INDEPENDENTLY OF THE CONTROL PLANE
 * ============================================================================== */

describe('`50 §2g` field 1 — the audit plane binds its own credential', () => {
  it('`CREDENTIAL_IDENTITY_MISMATCH` is its own member of the closed refusal set', () => {
    expect([...PROVIDER_READ_REFUSALS]).toContain('CREDENTIAL_IDENTITY_MISMATCH');
    // And it is NOT a synonym for the risk-class refusal. That one answers "is this class
    // right for an audit reader?"; this one answers "is that declaration about the
    // credential in this reader's hand?".
    expect([...PROVIDER_READ_REFUSALS]).toContain('CREDENTIAL_NOT_READ_ONLY');
  });

  it('the reader environment carries the expected identity, and no control-plane key', () => {
    const environment = buildAuditReaderEnvironment({
      providerId: AUDIT_PROVIDER,
      runtimeRoot: '/root',
      readerModule: '/root/reader.ts',
      secretSourceModule: '/root/secretSource.ts',
      secretLocator: '/elsewhere/audit.json',
      credentialRiskClass: 'READ_ONLY',
      expectedCredentialId: AUDIT_READ_CREDENTIAL_ID,
    });
    expect(Object.keys(environment).sort()).toEqual([...AUDIT_READER_ENV_KEYS].sort());
    expect(environment[ENV_AUDIT_EXPECTED_CREDENTIAL_ID]).toBe(AUDIT_READ_CREDENTIAL_ID);
    // `§14` is unchanged by the new key: both echoes come from THIS plane's own verifier.
    for (const key of Object.keys(environment)) expect(key).not.toMatch(/CONTROL/);
    expect(JSON.stringify(environment)).not.toContain('TEST_ONLY_AUDIT_READ_SECRET');
  });

  it('the audit plane and the kernel agree on the provenance set without sharing it', () => {
    expect([...AUDIT_CREDENTIAL_IDENTITY_PROVENANCES]).toEqual([
      ...CREDENTIAL_IDENTITY_PROVENANCES,
    ]);
  });

  it('the audit comparison and the kernel comparison agree on every case', () => {
    const cases: readonly (readonly [string, string])[] = [
      [AUDIT_READ_CREDENTIAL_ID, AUDIT_READ_CREDENTIAL_ID],
      [AUDIT_READ_CREDENTIAL_ID, SEND_CREDENTIAL_ID],
      ['', AUDIT_READ_CREDENTIAL_ID],
      [AUDIT_READ_CREDENTIAL_ID, ''],
    ];
    for (const [expected, resolved] of cases) {
      expect(
        auditCredentialIdentityMismatch(expected, resolved) === null,
        `${expected}/${resolved}`,
      ).toBe(credentialIdentityMismatch(expected, resolved) === null);
    }
  });
});

/* ================================================================================
 * 2. THE REQUIRED ATTACK — A SEND CREDENTIAL UNDER A READ_ONLY DECLARATION
 * ============================================================================== */

describe('`§13` of the correction — the send-credential substitution', () => {
  it('a READ_ONLY declaration over a DIFFERENT resolved credential is REFUSED', async () => {
    const reply = await handleProviderReadRequest(
      configurationFor(AUDIT_READ_CREDENTIAL_ID, SEND_CREDENTIAL_ID),
      read(),
    );
    expect(reply.kind).toBe('PROVIDER_READ_REFUSED');
    if (reply.kind === 'PROVIDER_READ_REFUSED') {
      expect(reply.reason).toBe('CREDENTIAL_IDENTITY_MISMATCH');
    }
  });

  it('UNSAFE: the same input READS when the binding is not checked', async () => {
    const reply = await unsafeHandleWithoutAuditIdentityBinding(
      configurationFor(AUDIT_READ_CREDENTIAL_ID, SEND_CREDENTIAL_ID),
      read(),
    );
    // THE DISCRIMINATION. Same configuration, same request, opposite outcome — and the
    // response names the credential it queried with, which is the send one.
    expect(reply.kind).toBe('PROVIDER_READ_RESPONSE');
    if (reply.kind === 'PROVIDER_READ_RESPONSE') {
      expect(reply.credentialIdentity).toBe(SEND_CREDENTIAL_ID);
    }
  });

  it('the MATCHING pair reads, so the refusal is not vacuous', async () => {
    const reply = await handleProviderReadRequest(
      configurationFor(AUDIT_READ_CREDENTIAL_ID, AUDIT_READ_CREDENTIAL_ID),
      read(),
    );
    expect(reply.kind).toBe('PROVIDER_READ_RESPONSE');
    if (reply.kind === 'PROVIDER_READ_RESPONSE') {
      expect(reply.credentialIdentity).toBe(AUDIT_READ_CREDENTIAL_ID);
    }
  });

  it('the refusal carries a closed code and neither credential identity', async () => {
    const reply = await handleProviderReadRequest(
      configurationFor(AUDIT_READ_CREDENTIAL_ID, SEND_CREDENTIAL_ID),
      read(),
    );
    expect(Object.keys(reply).sort()).toEqual(
      ['protocolVersion', 'kind', 'readId', 'reason'].sort(),
    );
    expect(JSON.stringify(reply)).not.toContain(SEND_CREDENTIAL_ID);
  });

  it('and the REAL forked reader refuses material that is not its declared credential', async () => {
    launched = launchAuditReader((secrets) => {
      // THE ATTACK AT THE DEPLOYMENT BOUNDARY. The descriptor is untouched, the locator is
      // the audit plane's own, in the audit plane's own directory. THE FILE holds a
      // different credential.
      const locator = secrets.write('audit', {
        providerId: AUDIT_PROVIDER,
        secret: mintAuditSentinelSecret('fork-mismatch'),
        credentialIdentity: SEND_CREDENTIAL_ID,
      });
      return auditReaderRegistry([readerADescriptor(locator)]);
    });

    const outcome = await launched.client.read({
      providerId: AUDIT_PROVIDER,
      operation: 'MESSAGE_ACTIVITY_SEARCH',
      periodStartMs: AUDIT_PERIOD_START_MS,
      periodEndMs: AUDIT_PERIOD_END_MS,
      correlationTag: 'acos-corr-fork-mismatch',
    });

    /*
     * `NO_EVIDENCE`, AND THE DISTINCTION MATTERS MORE HERE THAN ANYWHERE.
     *
     * `auditReadClient.ts`: "`EVIDENCE` with zero records and `NO_EVIDENCE` are different
     * values". A refused read must never be read downstream as "the provider holds no
     * record" — that is how an `I8` sweep concludes a send never happened because the audit
     * plane could not ask.
     */
    expect(outcome.kind).toBe('NO_EVIDENCE');
    if (outcome.kind === 'NO_EVIDENCE') {
      expect(outcome.reason).toBe('CREDENTIAL_IDENTITY_MISMATCH');
    }
    const pid = await awaitReaderReady(launched.client, AUDIT_PROVIDER);
    expect(pid).not.toBe(process.pid);
  });
});

/* ================================================================================
 * 3. A LOCATOR IS NOT AN IDENTITY — BOTH CONTROLS, KEPT
 * ============================================================================== */

describe('`§13` locator isolation and `50 §2g` identity binding are DIFFERENT controls', () => {
  it('UNSAFE: locator inequality is treated as proof the credentials differ', () => {
    const auditDescriptor = readerADescriptor('/secrets/audit.json');
    const integrationDescriptor = adapterADescriptor('/secrets/audit-alias.json', {
      credentialId: CREDENTIAL_A_NON_MONETARY,
    });

    // The two locators ARE different, so the unsafe rule answers "separated".
    expect(
      unsafeLocatorInequalityProvesSeparation(auditDescriptor, integrationDescriptor),
    ).toBe(true);

    // AND THE CONCLUSION IS UNFOUNDED: two distinct paths may name one credential, which is
    // precisely what the production comparison asks about and this one cannot.
    expect(auditCredentialIdentityMismatch(AUDIT_READ_CREDENTIAL_ID, SEND_CREDENTIAL_ID)).not.toBe(
      null,
    );
  });

  it('UNSAFE: locator EQUALITY is treated as proof the credential is the declared one', () => {
    // The mirror mistake. The source really was pointed where the descriptor said, which
    // proves the CONFIGURATION and says nothing about what was found there.
    expect(unsafeLocatorComparisonAsIdentityBinding('/secrets/audit.json', '/secrets/audit.json'))
      .toBe(true);
    // Production, on the same "correctly pointed" source, still refuses the wrong material.
    expect(
      auditCredentialIdentityMismatch(AUDIT_READ_CREDENTIAL_ID, SEND_CREDENTIAL_ID),
    ).toContain(AUDIT_READ_CREDENTIAL_ID);
  });

  it('PRODUCTION keeps the locator control too: a SHARED locator is still refused', () => {
    const shared = '/secrets/shared.json';
    expect(() =>
      auditReaderRegistry(
        [readerADescriptor(shared)],
        new Set([adapterADescriptor(shared).secretLocator]),
      ),
    ).toThrow(/READER_LOCATOR_SHARED_WITH_INTEGRATION/);
  });

  it('PRODUCTION refuses wrong material even when the locator is exclusively the audit plane’s', async () => {
    // The locator control passes — the audit plane holds this locator alone — and the
    // identity control still fires. That is the whole claim: they are independent.
    const reply = await handleProviderReadRequest(
      configurationFor(AUDIT_READ_CREDENTIAL_ID, SEND_CREDENTIAL_ID),
      read(),
    );
    expect(reply.kind === 'PROVIDER_READ_REFUSED' && reply.reason).toBe(
      'CREDENTIAL_IDENTITY_MISMATCH',
    );
  });

  it('and the integration plane holds no locator the audit descriptor uses', () => {
    // The composition the boundary suite asserts, restated here so section 3 carries both
    // halves of the pair it is about.
    const auditDescriptor = readerADescriptor('/secrets/audit-only.json');
    const integrationDescriptor = adapterADescriptor('/secrets/send-only.json');
    expect(auditDescriptor.secretLocator).not.toBe(integrationDescriptor.secretLocator);
    expect(auditDescriptor.credentialId).toBe(AUDIT_READ_CREDENTIAL_ID);
    expect(integrationDescriptor.credentialId).toBe(CREDENTIAL_A_NON_MONETARY);
    expect(integrationDescriptor.adapterId).toBe(ADAPTER_A);
  });
});
