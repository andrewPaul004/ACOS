import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { ADAPTER_CREDENTIAL_IDENTITY_PROVENANCES } from '../../src/integration/runtime/adapterSecretSource.js';
import {
  CREDENTIAL_SOURCE_KINDS,
  LIVE_IDENTITY_PROVENANCES as INTEGRATION_LIVE_PROVENANCES,
  PROVENANCE_BY_SOURCE_KIND,
  createAdapterSecretSource,
} from '../../validation/sendgrid/integration/secretSource.js';
import {
  AUDIT_PROVENANCE_BY_SOURCE_KIND,
  LIVE_AUDIT_IDENTITY_PROVENANCES,
  createAuditReadSecretSource,
} from '../../validation/sendgrid/audit/secretSource.js';
import {
  LIVE_IDENTITY_PROVENANCES as PREFLIGHT_LIVE_PROVENANCES,
  isLiveAuditIdentityProvenance,
  isLiveIdentityProvenance,
} from '../../validation/sendgrid/harness/preflight.js';

/**
 * CORRECTION 3 — **A LABEL IN A FILE IS NOT A MATERIAL BINDING.**
 *
 * =================================================================================
 * THE DEFECT, AND THE ONE-LINE RULE THAT REPLACES IT
 *
 * The rejected sources read `identityProvenance` OUT OF THE DOCUMENT and admitted a live run
 * whenever it said `PROVIDER_KEY_ID`. The review, verbatim:
 *
 *     A document containing: secret B / credentialIdentity A / identityProvenance
 *     PROVIDER_KEY_ID is still only a labelled mismatch unless some trusted
 *     provider/secret-manager mechanism establishes the binding.
 *
 * **PROVENANCE IS NOW A PROPERTY OF THE MECHANISM THAT RESOLVED THE MATERIAL, NEVER A FIELD
 * OF THE DOCUMENT.** `§19` item 4 is the discrimination this file owes, and it is driven
 * directly: a document that SAYS `PROVIDER_KEY_ID` resolves with `SYNTHETIC_TEST_IDENTITY`,
 * because a file established the label and a file cannot bind one to bytes.
 *
 * Both planes are driven independently, because `§3.4` requires the correction applied
 * independently and the two packages share no module.
 * =================================================================================
 */

const directory = mkdtempSync(join(tmpdir(), 'acos-s1p-credential-'));

afterAll(() => {
  rmSync(directory, { recursive: true, force: true });
});

const SECRET = 'TEST_ONLY_VENDOR_SECRET_S1P_BINDING_0123456789abcdef';
const IDENTITY = 'twilio_sendgrid.validation_send';

function integrationDocument(name: string, document: Record<string, unknown>): string {
  const path = join(directory, `${name}.json`);
  writeFileSync(path, JSON.stringify(document), 'utf8');
  return path;
}

function integrationSource(document: Record<string, unknown>, name: string) {
  return createAdapterSecretSource({
    adapterId: 'sendgrid_email',
    locator: integrationDocument(name, document),
  });
}

function auditSource(document: Record<string, unknown>, name: string) {
  return createAuditReadSecretSource({
    providerId: 'twilio_sendgrid',
    locator: integrationDocument(name, document),
  });
}

const FILE_FIXTURE = {
  adapterId: 'sendgrid_email',
  sourceKind: 'FILE_FIXTURE',
  apiKey: SECRET,
  credentialIdentity: IDENTITY,
};

describe('`§19` item 4 — A MUTABLE JSON LABEL IS NOT SUFFICIENT LIVE MATERIAL BINDING', () => {
  it('a document CLAIMING `PROVIDER_KEY_ID` still resolves as a FIXTURE identity', async () => {
    /*
     * THE REJECTED DOCUMENT, VERBATIM IN SHAPE.
     *
     * It carries the secret, an identity, AND the provenance label the rejected source
     * trusted. The corrected source does not read that field at all — it reads the declared
     * MECHANISM, and `FILE_FIXTURE` is entitled to exactly one provenance.
     */
    const resolution = await integrationSource(
      { ...FILE_FIXTURE, identityProvenance: 'PROVIDER_KEY_ID' },
      'claims-provider-key-id',
    ).resolve();

    expect(resolution.kind).toBe('RESOLVED');
    if (resolution.kind !== 'RESOLVED') return;
    expect(resolution.credential.credentialIdentity).toBe(IDENTITY);
    // THE CORRECTION, IN ONE ASSERTION.
    expect(resolution.credential.identityProvenance).toBe('SYNTHETIC_TEST_IDENTITY');
    expect(isLiveIdentityProvenance(resolution.credential.identityProvenance)).toBe(false);
  });

  it('and the SAME document on the audit plane resolves the same way', async () => {
    const resolution = await auditSource(
      {
        providerId: 'twilio_sendgrid',
        sourceKind: 'FILE_FIXTURE',
        apiKey: SECRET,
        credentialIdentity: 'twilio_sendgrid.audit_read',
        identityProvenance: 'DEPLOYMENT_SECRET_VERSION',
      },
      'audit-claims-secret-version',
    ).resolve();

    expect(resolution.kind).toBe('RESOLVED');
    if (resolution.kind !== 'RESOLVED') return;
    expect(resolution.credential.identityProvenance).toBe('SYNTHETIC_TEST_IDENTITY');
    expect(isLiveAuditIdentityProvenance(resolution.credential.identityProvenance)).toBe(false);
  });

  it('the PREFLIGHT s transcription agrees with BOTH planes own lists', () => {
    /*
     * THE TRANSCRIPTION CHECK CORRECTION 5 BOUGHT.
     *
     * `preflight.ts` no longer imports either secret source — that is what keeps the
     * coordinator unable to reach vendor material — so it carries its own copy of the
     * two-member live-provenance list. Two independent transcriptions of one closed list
     * disagree loudly, and this is where the disagreement would be caught.
     */
    expect([...PREFLIGHT_LIVE_PROVENANCES].sort()).toEqual([...INTEGRATION_LIVE_PROVENANCES].sort());
    expect([...PREFLIGHT_LIVE_PROVENANCES].sort()).toEqual([...LIVE_AUDIT_IDENTITY_PROVENANCES].sort());
    expect(PREFLIGHT_LIVE_PROVENANCES).not.toContain('SYNTHETIC_TEST_IDENTITY');
  });

  it('the provenance map is the WHOLE authority on which mechanism may claim what', () => {
    /*
     * ASSERTED AS A MAP RATHER THAN AS A BEHAVIOUR, so that adding a fourth mechanism without
     * deciding what it establishes is a compile error rather than an unnoticed admission.
     */
    expect(PROVENANCE_BY_SOURCE_KIND.FILE_FIXTURE).toBe('SYNTHETIC_TEST_IDENTITY');
    expect(PROVENANCE_BY_SOURCE_KIND.SECRET_MANAGER_VERSION).toBe('DEPLOYMENT_SECRET_VERSION');
    expect(PROVENANCE_BY_SOURCE_KIND.PROVIDER_KEY_ID_BINDING).toBe('PROVIDER_KEY_ID');
    expect(AUDIT_PROVENANCE_BY_SOURCE_KIND.FILE_FIXTURE).toBe('SYNTHETIC_TEST_IDENTITY');

    // Every value the map assigns is a member of the ACCEPTED provenance enum.
    for (const provenance of Object.values(PROVENANCE_BY_SOURCE_KIND)) {
      expect([...ADAPTER_CREDENTIAL_IDENTITY_PROVENANCES]).toContain(provenance);
    }
  });
});

describe('`§3.2` — THE TWO BINDING MECHANISMS ARE DECLARED AND **UNPROVISIONED**', () => {
  for (const kind of CREDENTIAL_SOURCE_KINDS.filter((entry) => entry !== 'FILE_FIXTURE')) {
    it(`a document declaring \`${kind}\` resolves NOTHING`, async () => {
      /*
       * `§3.2`: "If no concrete secret manager is selected, implement the contract and leave
       * the real live source UNPROVISIONED/PARTIAL. That is preferable to a fake binding."
       *
       * The document is otherwise complete and the material is there. The source refuses
       * anyway, because no mechanism in this repository can bind that material to that
       * identity — and returning it under a borrowed provenance is exactly the fake binding.
       */
      const resolution = await integrationSource(
        { ...FILE_FIXTURE, sourceKind: kind },
        `unprovisioned-${kind}`,
      ).resolve();
      expect(resolution.kind).toBe('UNAVAILABLE');
    });
  }

  it('a document with NO declared mechanism — the pre-correction shape — resolves nothing', () => {
    /*
     * THE MIGRATION CASE, ASSERTED DELIBERATELY.
     *
     * A deployment document written before this correction carries `identityProvenance` and no
     * `sourceKind`. It must not be reinterpreted as any mechanism, least of all as a binding
     * one, so an undeclared mechanism is not a default mechanism.
     */
    const legacy = {
      adapterId: 'sendgrid_email',
      apiKey: SECRET,
      credentialIdentity: IDENTITY,
      identityProvenance: 'PROVIDER_KEY_ID',
    };
    return integrationSource(legacy, 'legacy-shape')
      .resolve()
      .then((resolution) => {
        expect(resolution.kind).toBe('UNAVAILABLE');
      });
  });

  it('`§3.3` — the nonexistent read-back probe is not claimed anywhere in the source', async () => {
    /*
     * The rejected file's comment claimed that "`§8.7`'s read-back probe is what establishes
     * that the id written here is the id of the key whose material is in `apiKey`". No such
     * probe exists, and the capability probe that DOES exist measures whether a credential can
     * perform an operation — which answers nothing about which key id it IS.
     */
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(
      join('validation', 'sendgrid', 'integration', 'secretSource.ts'),
      'utf8',
    );
    /*
     * THE PHRASE STILL APPEARS — INSIDE THE RETRACTION, IN QUOTATION MARKS.
     *
     * Asserting its ABSENCE would have forced the retraction to be silent, which is the
     * opposite of what `§3.3` asks for. What is asserted is that the file RETRACTS the claim
     * and that the source does not rest on it: the live paths refuse, which the
     * `UNPROVISIONED` cases above drive directly.
     */
    expect(source).toContain('THE NONEXISTENT PROOF IS GONE');
    expect(source).toContain('The claim is removed rather than reworded');
  });
});

describe('THE ORDINARY REFUSALS SURVIVE THE REWRITE', () => {
  it('`§24` — a revoked document returns CREDENTIAL_REVOKED with NO material', async () => {
    const resolution = await integrationSource(
      { ...FILE_FIXTURE, revoked: true },
      'revoked',
    ).resolve();
    expect(resolution.kind).toBe('CREDENTIAL_REVOKED');
    expect(JSON.stringify(resolution)).not.toContain(SECRET);
  });

  it('a document for ANOTHER adapter, or ANOTHER provider, is UNAVAILABLE', async () => {
    expect(
      (await integrationSource({ ...FILE_FIXTURE, adapterId: 'mock_ads' }, 'other-adapter').resolve())
        .kind,
    ).toBe('UNAVAILABLE');
    expect(
      (
        await auditSource(
          {
            providerId: 'synthetic_esp',
            sourceKind: 'FILE_FIXTURE',
            apiKey: SECRET,
            credentialIdentity: 'x',
          },
          'other-provider',
        ).resolve()
      ).kind,
    ).toBe('UNAVAILABLE');
  });

  it('an identity DERIVED FROM THE SECRET is refused, in every encoding', async () => {
    for (const [name, derived] of [
      ['identical', SECRET],
      ['contained', SECRET.slice(0, 20)],
      ['hex', Buffer.from(SECRET, 'utf8').toString('hex')],
      ['base64', Buffer.from(SECRET, 'utf8').toString('base64')],
    ] as const) {
      const resolution = await integrationSource(
        { ...FILE_FIXTURE, credentialIdentity: derived },
        `derived-${name}`,
      ).resolve();
      expect(resolution.kind, name).toBe('UNAVAILABLE');
    }
  });

  it('an unreadable locator is UNAVAILABLE, never a partial credential', async () => {
    const resolution = await createAdapterSecretSource({
      adapterId: 'sendgrid_email',
      locator: join(directory, 'does-not-exist.json'),
    }).resolve();
    expect(resolution.kind).toBe('UNAVAILABLE');
  });
});
