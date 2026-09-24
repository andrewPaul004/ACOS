import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { filesystemArtifactPackage } from '../../src/kernel/controlArtifacts/artifactPackage.js';
import { ControlArtifactIntegrityFailure } from '../../src/kernel/controlArtifacts/errors.js';
import { sha256 } from '../../src/kernel/controlArtifacts/ed25519.js';
import { readDeploymentTrustConfiguration } from '../../src/kernel/controlArtifacts/trustConfig.js';
import { verifyControlArtifactBundle } from '../../src/kernel/controlArtifacts/verifier.js';
import {
  unsafeSemanticDigest,
  unsafeVerifyControlArtifacts,
  type UnsafeVerifierDefect,
} from '../negative-controls/unsafe-control-artifact-verifier.js';
import {
  TEST_ONLY_PRIMARY_SEED,
  TEST_ONLY_SECOND_FACTOR_SEED,
  REPO_ARTIFACT_ROOT,
  TEST_ONLY_THIRD_PARTY_SEED,
  buildControlArtifactFixture,
  testOnlyKeyPair,
  withArtifactBytes,
  withoutArtifactClass,
  type ControlArtifactFixture,
} from '../support/controlArtifactFixture.js';

/**
 * `50 §3a`, `§3d` and `§3e` — the trust roots, the manifest core, and the deployment pin.
 *
 * =================================================================================
 * EVERY CASE HERE IS DISCRIMINATING
 *
 * `36 §2` VC-K2: "**Four must-fail mutations**: a deleted entry, an inserted entry, a
 * reordered pair, and a complete valid **older** signed manifest — each must be rejected
 * against the deployment-pinned `EXPECTED_ACTIVE_MANIFEST_ID`, and **the old-manifest case
 * must be rejected on the pin rather than on any epoch comparison.**"
 *
 * A test that only asserted production REFUSES would be satisfied by a verifier that refused
 * everything, so each attack is also run through
 * `tests/negative-controls/unsafe-control-artifact-verifier.ts` — a second implementation
 * that makes the specific mistake — and the pair must DISAGREE.
 * =================================================================================
 */

const PRIMARY = testOnlyKeyPair(TEST_ONLY_PRIMARY_SEED);
const SECOND_FACTOR = testOnlyKeyPair(TEST_ONLY_SECOND_FACTOR_SEED);
const ATTACKER = testOnlyKeyPair(TEST_ONLY_THIRD_PARTY_SEED);

function verify(fixture: ControlArtifactFixture): void {
  verifyControlArtifactBundle(
    readDeploymentTrustConfiguration(fixture.controlEnv),
    filesystemArtifactPackage(fixture.controlRoot),
  );
}

function reasonOf(run: () => void): string {
  try {
    run();
  } catch (error) {
    if (error instanceof ControlArtifactIntegrityFailure) return error.reasonCode;
    throw error;
  }
  throw new Error('expected a control-artifact integrity failure and none was raised');
}

function unsafe(
  defect: UnsafeVerifierDefect,
  fixture: ControlArtifactFixture,
  extra: { readonly alternativeRoots?: readonly string[] } = {},
): boolean {
  return unsafeVerifyControlArtifacts(defect, {
    root: fixture.controlRoot,
    primaryPublicKeyHex: fixture.controlEnv.ACOS_OWNER_ARTIFACT_ROOT_KEY!,
    secondFactorPublicKeyHex: fixture.controlEnv.ACOS_OWNER_ARTIFACT_SECOND_FACTOR_KEY!,
    expectedActiveManifestId: fixture.controlEnv.ACOS_EXPECTED_ACTIVE_MANIFEST_ID!,
    keyDirectory: {
      [Buffer.from(PRIMARY.rawPublicKey).toString('hex')]: '',
    },
    ...extra,
  }).accepted;
}

describe('`50 §3a` — the roots are externally provisioned, distinct, and never learned', () => {
  it('a valid package verifies under the provisioned roots', () => {
    expect(() => verify(buildControlArtifactFixture())).not.toThrow();
  });

  it('the same key in both deployment slots FAILS CLOSED before any manifest byte is read', () => {
    const fixture = buildControlArtifactFixture({ sameKeyInBothSlots: true });
    expect(reasonOf(() => verify(fixture))).toBe('TRUST_ROOTS_NOT_DISTINCT');
  });

  it('VULNERABLE CONTROL 4 — a verifier without the distinctness check accepts it', () => {
    // The unsafe verifier silently uses the primary key in both roles. The fixture below is
    // signed with the primary key in BOTH slots, so the unsafe verifier accepts it and
    // production refuses the CONFIGURATION before it reaches a signature.
    const fixture = buildControlArtifactFixture({
      secondFactor: PRIMARY,
      sameKeyInBothSlots: true,
    });
    expect(unsafe('SAME_KEY_SATISFIES_BOTH_ROLES', fixture)).toBe(true);
    expect(reasonOf(() => verify(fixture))).toBe('TRUST_ROOTS_NOT_DISTINCT');
  });

  it('a manifest naming DIFFERENT key ids fails closed — the manifest is never the source', () => {
    // Pinned to its own identity, so the deployment pin passes and the KEY-ID CHECK is what
    // refuses. `50 §3a`: "**If the manifest names a different key: FAIL CLOSED.**"
    const fixture = buildControlArtifactFixture({
      tamper: { declaredPrimaryKeyId: 'f'.repeat(64) },
    });
    expect(reasonOf(() => verify(fixture))).toBe('MANIFEST_KEY_ID_MISMATCH');

    // And a deployment pinned to the UNTAMPERED manifest rejects it one step earlier still,
    // because the declared key id is inside the signed core and moves `manifest_id`.
    const honest = buildControlArtifactFixture();
    const repinned: ControlArtifactFixture = {
      ...fixture,
      controlEnv: {
        ...fixture.controlEnv,
        ACOS_EXPECTED_ACTIVE_MANIFEST_ID: honest.manifestId,
      },
    };
    expect(reasonOf(() => verify(repinned))).toBe('MANIFEST_IDENTITY_NOT_PINNED');
  });

  it('VULNERABLE CONTROL 2 — a verifier that RESOLVES keys from the manifest accepts an attacker set', () => {
    // A complete, self-consistent package signed end to end by an attacker's keys, naming
    // the attacker's key ids. Production is configured with the OWNER's roots.
    const attackerSecond = testOnlyKeyPair(Buffer.from('ACOS TEST-ONLY ATTACKER SECOND'.padEnd(32, '\u0000'), 'utf8'));
    const forged = buildControlArtifactFixture({
      primary: ATTACKER,
      secondFactor: attackerSecond,
    });
    const directory = {
      [Buffer.from(ATTACKER.rawPublicKey).toString('hex')]: Buffer.from(
        ATTACKER.rawPublicKey,
      ).toString('hex'),
      [Buffer.from(attackerSecond.rawPublicKey).toString('hex')]: Buffer.from(
        attackerSecond.rawPublicKey,
      ).toString('hex'),
    };
    const keyIdOf = (raw: Buffer): string =>
      require('node:crypto').createHash('sha256').update(raw).digest('hex') as string;
    const resolvable: Record<string, string> = {
      [keyIdOf(Buffer.from(ATTACKER.rawPublicKey))]: Buffer.from(ATTACKER.rawPublicKey).toString('hex'),
      [keyIdOf(Buffer.from(attackerSecond.rawPublicKey))]: Buffer.from(
        attackerSecond.rawPublicKey,
      ).toString('hex'),
      ...directory,
    };

    expect(
      unsafeVerifyControlArtifacts('MANIFEST_SUPPLIED_ROOT', {
        root: forged.controlRoot,
        expectedActiveManifestId: forged.manifestId,
        keyDirectory: resolvable,
      }).accepted,
    ).toBe(true);

    // Production, configured with the OWNER's roots and the OWNER's pin, refuses it.
    const owner = buildControlArtifactFixture();
    expect(
      reasonOf(() =>
        verifyControlArtifactBundle(
          readDeploymentTrustConfiguration(owner.controlEnv),
          filesystemArtifactPackage(forged.controlRoot),
        ),
      ),
    ).toBe('MANIFEST_IDENTITY_NOT_PINNED');
  });

  it('VULNERABLE CONTROL 1 — trust-on-first-use accepts a self-consistent attacker manifest', () => {
    const attackerSecond = testOnlyKeyPair(
      Buffer.from('ACOS TEST-ONLY ATTACKER SECOND'.padEnd(32, '\u0000'), 'utf8'),
    );
    const forged = buildControlArtifactFixture({
      primary: ATTACKER,
      secondFactor: attackerSecond,
    });
    const crypto = require('node:crypto') as typeof import('node:crypto');
    const keyId = (raw: Buffer): string => crypto.createHash('sha256').update(raw).digest('hex');
    expect(
      unsafeVerifyControlArtifacts('TOFU_ROOT', {
        root: forged.controlRoot,
        keyDirectory: {
          [keyId(Buffer.from(ATTACKER.rawPublicKey))]: Buffer.from(ATTACKER.rawPublicKey).toString('hex'),
          [keyId(Buffer.from(attackerSecond.rawPublicKey))]: Buffer.from(
            attackerSecond.rawPublicKey,
          ).toString('hex'),
        },
      }).accepted,
    ).toBe(true);

    const owner = buildControlArtifactFixture();
    expect(
      reasonOf(() =>
        verifyControlArtifactBundle(
          readDeploymentTrustConfiguration(owner.controlEnv),
          filesystemArtifactPackage(forged.controlRoot),
        ),
      ),
    ).toBe('MANIFEST_IDENTITY_NOT_PINNED');
  });
});

describe('`50 §4` — every artifact and the manifest carry TWO signatures', () => {
  it('a manifest with no valid SECOND_FACTOR signature is REFUSED', () => {
    const fixture = buildControlArtifactFixture({
      tamper: { voidManifestSecondFactorSignature: true },
    });
    expect(reasonOf(() => verify(fixture))).toBe('MANIFEST_SECOND_FACTOR_SIGNATURE_INVALID');
  });

  it('a manifest with no valid PRIMARY signature is REFUSED', () => {
    const fixture = buildControlArtifactFixture({
      tamper: { voidManifestPrimarySignature: true },
    });
    expect(reasonOf(() => verify(fixture))).toBe('MANIFEST_PRIMARY_SIGNATURE_INVALID');
  });

  it('a manifest signed TWICE UNDER THE PRIMARY KEY is REFUSED', () => {
    const fixture = buildControlArtifactFixture({
      tamper: { manifestSecondFactorUsesPrimaryKey: true },
    });
    expect(reasonOf(() => verify(fixture))).toBe('MANIFEST_SECOND_FACTOR_SIGNATURE_INVALID');
  });

  it('an artifact signed TWICE UNDER THE PRIMARY KEY is REFUSED', () => {
    const fixture = buildControlArtifactFixture({
      tamper: { secondFactorUsesPrimaryKey: true },
    });
    expect(reasonOf(() => verify(fixture))).toBe('ARTIFACT_SECOND_FACTOR_SIGNATURE_INVALID');
  });

  it('a PRIMARY signature transplanted into the SECOND_FACTOR slot is REFUSED', () => {
    const fixture = buildControlArtifactFixture({
      tamper: { transplantPrimaryIntoSecondFactor: true },
    });
    expect(reasonOf(() => verify(fixture))).toBe('ARTIFACT_SECOND_FACTOR_SIGNATURE_INVALID');
  });

  it('ONE artifact with a bad second factor refuses the WHOLE bundle', () => {
    const fixture = buildControlArtifactFixture({
      tamper: { voidSecondFactorArtifactSignature: 2 },
    });
    expect(reasonOf(() => verify(fixture))).toBe('ARTIFACT_SECOND_FACTOR_SIGNATURE_INVALID');
  });

  it('ONE artifact with a bad primary signature refuses the WHOLE bundle', () => {
    const fixture = buildControlArtifactFixture({
      tamper: { voidPrimaryArtifactSignature: 0 },
    });
    expect(reasonOf(() => verify(fixture))).toBe('ARTIFACT_PRIMARY_SIGNATURE_INVALID');
  });

  it('VULNERABLE CONTROL 3 — a verifier that treats the second factor as optional accepts it', () => {
    const fixture = buildControlArtifactFixture({
      tamper: { voidSecondFactorArtifactSignature: 2, voidManifestSecondFactorSignature: true },
    });
    expect(unsafe('SINGLE_SIGNATURE_ACCEPTED', fixture)).toBe(true);
    expect(reasonOf(() => verify(fixture))).toBe('MANIFEST_SECOND_FACTOR_SIGNATURE_INVALID');
  });
});

describe('`50 §3e` — the deployment pin, and the four set mutations', () => {
  it('a DELETED entry is rejected', () => {
    const baseline = buildControlArtifactFixture();
    const mutated = buildControlArtifactFixture({
      mutate: (artifacts) => withoutArtifactClass(artifacts, 19),
      pinOverride: baseline.manifestId,
    });
    expect(reasonOf(() => verify(mutated))).toBe('MANIFEST_IDENTITY_NOT_PINNED');
  });

  it('an INSERTED entry is rejected', () => {
    const baseline = buildControlArtifactFixture();
    const mutated = buildControlArtifactFixture({
      mutate: (artifacts) => [
        ...artifacts,
        {
          artifactClass: 26,
          artifactId: 'acos.control.i8_sweep_specification',
          artifactVersion: 'v1',
          fileName: 'class-26.i8-sweep.json',
          bytes: Buffer.from('{}\n', 'utf8'),
        },
      ],
      pinOverride: baseline.manifestId,
    });
    expect(reasonOf(() => verify(mutated))).toBe('MANIFEST_IDENTITY_NOT_PINNED');
  });

  it('REORDERED entries are rejected — the declared order is normative', () => {
    // Pinned to its own reordered identity, so the ORDER CHECK itself is what refuses.
    // `50 §3d`: "The order is a property of the bytes", and a reordered manifest is refused
    // rather than sorted — sorting it would let two byte sequences carry one `manifest_id`.
    const fixture = buildControlArtifactFixture({ tamper: { reverseEntryOrder: true } });
    expect(reasonOf(() => verify(fixture))).toBe('MANIFEST_ENTRY_ORDER_INVALID');

    // A deployment pinned to the correctly ordered manifest refuses it too — on the ORDER,
    // because a document that does not parse never reaches a pin comparison. `50 §3e` says
    // both legs are required and does not say which fires first for a malformed document.
    const honest = buildControlArtifactFixture();
    const repinned: ControlArtifactFixture = {
      ...fixture,
      controlEnv: {
        ...fixture.controlEnv,
        ACOS_EXPECTED_ACTIVE_MANIFEST_ID: honest.manifestId,
      },
    };
    expect(reasonOf(() => verify(repinned))).toBe('MANIFEST_ENTRY_ORDER_INVALID');

    // And the reordering DOES move the identity, so a well-formed substitution of the same
    // entries in another order could never pass the pin either.
    expect(fixture.manifestId).not.toBe(honest.manifestId);
  });

  it('a complete, validly dual-signed OLDER manifest is rejected ON THE PIN', () => {
    const current = buildControlArtifactFixture({ manifestEpoch: '9' });
    const older = buildControlArtifactFixture({
      manifestEpoch: '1',
      pinOverride: current.manifestId,
    });
    // The older manifest is entirely valid: right roots, right signatures, right artifacts.
    // It is rejected because it is not the manifest this deployment was pinned to.
    expect(reasonOf(() => verify(older))).toBe('MANIFEST_IDENTITY_NOT_PINNED');
  });

  it('VULNERABLE CONTROL 8 — a verifier with no pin accepts ANY validly signed manifest', () => {
    const older = buildControlArtifactFixture({ manifestEpoch: '1' });
    expect(
      unsafeVerifyControlArtifacts('NO_DEPLOYMENT_PIN', {
        root: older.controlRoot,
        primaryPublicKeyHex: Buffer.from(PRIMARY.rawPublicKey).toString('hex'),
        secondFactorPublicKeyHex: Buffer.from(SECOND_FACTOR.rawPublicKey).toString('hex'),
        // A pin is supplied and DELIBERATELY IGNORED by this defect.
        expectedActiveManifestId: 'f'.repeat(64),
      }).accepted,
    ).toBe(true);

    const current = buildControlArtifactFixture({ manifestEpoch: '9' });
    expect(
      reasonOf(() =>
        verifyControlArtifactBundle(
          readDeploymentTrustConfiguration(current.controlEnv),
          filesystemArtifactPackage(older.controlRoot),
        ),
      ),
    ).toBe('MANIFEST_IDENTITY_NOT_PINNED');
  });

  it('VULNERABLE CONTROL 9 — "highest epoch on disk" accepts a rollback the pin rejects', () => {
    const current = buildControlArtifactFixture({ manifestEpoch: '2' });
    const rolledBack = buildControlArtifactFixture({ manifestEpoch: '5' });

    // The unsafe verifier picks the HIGHEST epoch it can see, which is the attacker's.
    const chosen = unsafeVerifyControlArtifacts('HIGHEST_EPOCH_WINS', {
      root: current.controlRoot,
      alternativeRoots: [rolledBack.controlRoot],
      primaryPublicKeyHex: Buffer.from(PRIMARY.rawPublicKey).toString('hex'),
      secondFactorPublicKeyHex: Buffer.from(SECOND_FACTOR.rawPublicKey).toString('hex'),
      expectedActiveManifestId: current.manifestId,
    });
    expect(chosen.accepted).toBe(true);
    expect(chosen.manifestId).toBe(rolledBack.manifestId);

    // Production compares no epoch at all, and the pin is what rejects it.
    expect(
      reasonOf(() =>
        verifyControlArtifactBundle(
          readDeploymentTrustConfiguration(current.controlEnv),
          filesystemArtifactPackage(rolledBack.controlRoot),
        ),
      ),
    ).toBe('MANIFEST_IDENTITY_NOT_PINNED');
  });

  it('VULNERABLE CONTROL 10 — a missing required entry is IGNORED by the unsafe verifier', () => {
    const fixture = buildControlArtifactFixture({
      mutate: (artifacts) => withoutArtifactClass(artifacts, 27),
    });
    expect(unsafe('MISSING_ENTRY_IGNORED', fixture)).toBe(true);
    expect(reasonOf(() => verify(fixture))).toBe('REQUIRED_ARTIFACT_MISSING');
  });

  it('a DUPLICATED entry identity is a defect, not a tie', () => {
    const fixture = buildControlArtifactFixture({
      mutate: (artifacts) => [...artifacts, artifacts[0]!],
    });
    expect(reasonOf(() => verify(fixture))).toBe('MANIFEST_DUPLICATE_ENTRY');
  });

  it('a manifest reviving RETIRED CLASS 17 is refused', () => {
    const fixture = buildControlArtifactFixture({
      mutate: (artifacts) => [
        ...artifacts,
        {
          artifactClass: 17,
          artifactId: 'acos.control.window_registry',
          artifactVersion: 'v1',
          fileName: 'class-17.window-registry.json',
          bytes: Buffer.from('{}\n', 'utf8'),
        },
      ],
    });
    const selfPinned: ControlArtifactFixture = {
      ...fixture,
      controlEnv: {
        ...fixture.controlEnv,
        ACOS_EXPECTED_ACTIVE_MANIFEST_ID: fixture.manifestId,
      },
    };
    expect(reasonOf(() => verify(selfPinned))).toBe('RETIRED_CLASS_PRESENT');
  });

  it('an entry_count that disagrees with the entries is refused', () => {
    const fixture = buildControlArtifactFixture({ tamper: { declaredEntryCount: 5 } });
    const selfPinned: ControlArtifactFixture = {
      ...fixture,
      controlEnv: {
        ...fixture.controlEnv,
        ACOS_EXPECTED_ACTIVE_MANIFEST_ID: fixture.manifestId,
      },
    };
    expect(reasonOf(() => verify(selfPinned))).toBe('MANIFEST_ENTRY_COUNT_MISMATCH');
  });

  it('an unknown field in the manifest document is refused, not ignored', () => {
    const fixture = buildControlArtifactFixture({ tamper: { extraDocumentField: 'notes' } });
    const selfPinned: ControlArtifactFixture = {
      ...fixture,
      controlEnv: {
        ...fixture.controlEnv,
        ACOS_EXPECTED_ACTIVE_MANIFEST_ID: fixture.manifestId,
      },
    };
    expect(reasonOf(() => verify(selfPinned))).toBe('MANIFEST_UNKNOWN_FIELD');
  });
});

describe('`50 §3c` — the content hash is over EXACT bytes', () => {
  const byteAttacks: readonly (readonly [string, (bytes: Buffer) => Buffer])[] = [
    ['LF to CRLF', (b) => Buffer.from(b.toString('utf8').replace(/\n/g, '\r\n'), 'utf8')],
    ['one added space', (b) => Buffer.concat([b.subarray(0, 1), Buffer.from(' '), b.subarray(1)])],
    ['the final newline removed', (b) => b.subarray(0, b.length - 1)],
    ['a final newline added', (b) => Buffer.concat([b, Buffer.from('\n')])],
    ['a byte-order mark prepended', (b) => Buffer.concat([Buffer.from('﻿', 'utf8'), b])],
    [
      'one UTF-8 byte changed',
      (b) => {
        const copy = Buffer.from(b);
        copy[copy.length - 2] = copy[copy.length - 2]! ^ 0x01;
        return copy;
      },
    ],
  ];

  for (const [name, mutate] of byteAttacks) {
    it(`${name} changes the digest, and the stale signature fails`, () => {
      const baseline = buildControlArtifactFixture();
      // The manifest still carries the ORIGINAL digest and the ORIGINAL signatures, which is
      // what "a stale signature" means: the bytes moved and nothing re-signed them.
      const tampered = buildControlArtifactFixture({
        pinOverride: baseline.manifestId,
        mutate: (artifacts) => withArtifactBytes(artifacts, 3, mutate),
      });
      // Because the manifest core carries the artifact's content hash, the identity moves
      // too and the pin rejects it first. Pinning to the tampered manifest's own identity
      // isolates the byte check itself.
      expect(reasonOf(() => verify(tampered))).toBe('MANIFEST_IDENTITY_NOT_PINNED');

      const staleSignatures = buildControlArtifactFixture();
      const rewritten = withArtifactBytes(staleSignatures.artifacts, 3, mutate);
      const onDiskOnly = buildControlArtifactFixture({
        pinOverride: staleSignatures.manifestId,
      });
      // Rewrite ONLY the bytes on disk, leaving the signed manifest untouched.
      require('node:fs').writeFileSync(
        require('node:path').join(onDiskOnly.controlRoot, 'class-03.action-catalogue.json'),
        rewritten.find((a) => a.artifactClass === 3)!.bytes,
      );
      expect(reasonOf(() => verify(onDiskOnly))).toBe('ARTIFACT_CONTENT_HASH_MISMATCH');
    });
  }

  it('VULNERABLE CONTROL 7 — a semantically-normalised hash cannot tell two artifacts apart', () => {
    // `§43` of the S1K mandate: "Fixture: two byte-different artifacts parse to equivalent
    // semantics. Unsafe: same hash/accepted. Production: different SHA-256 exact-byte
    // digest; stale signature fails."
    const original = readFileSync(join(REPO_ARTIFACT_ROOT, 'class-03.action-catalogue.json'));
    const reindented = Buffer.from(
      `${JSON.stringify(JSON.parse(original.toString('utf8')), null, 4)}
`,
      'utf8',
    );
    expect(reindented.equals(original)).toBe(false);

    // THE UNSAFE DIGEST — over the parsed, reserialised object — CANNOT TELL THEM APART.
    expect(unsafeSemanticDigest(reindented)).toEqual(unsafeSemanticDigest(original));

    // THE EXACT-BYTE DIGEST CAN, which is `50 §3c`'s whole point.
    expect(sha256(reindented)).not.toEqual(sha256(original));

    // And in the runtime: the reformatted artifact on disk, under the signed manifest that
    // named the original's digest, is refused.
    const baseline = buildControlArtifactFixture();
    writeFileSync(join(baseline.controlRoot, 'class-03.action-catalogue.json'), reindented);
    expect(reasonOf(() => verify(baseline))).toBe('ARTIFACT_CONTENT_HASH_MISMATCH');
  });
});
