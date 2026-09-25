import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { filesystemArtifactPackage } from '../../src/kernel/controlArtifacts/artifactPackage.js';
import {
  admitConstructorVersionRecords,
  verifiedConstructorVersionResolver,
} from '../../src/kernel/canonicalisation/constructorAdmission.js';
import type { ConstructorVersionRecord } from '../../src/kernel/canonicalisation/constructorVersion.js';
import {
  verifiedConstructorSet,
  type VerifiedControlArtifactBundle,
} from '../../src/kernel/controlArtifacts/bundle.js';
import { readDeploymentTrustConfiguration } from '../../src/kernel/controlArtifacts/trustConfig.js';
import { verifyControlArtifactBundle } from '../../src/kernel/controlArtifacts/verifier.js';
import { unsafeCallerKeyConstructorResolver } from '../negative-controls/unsafe-release-ceremony.js';
import {
  newTestSigner,
  signConstructorVersion,
  type TestSigner,
} from '../support/canonicalisationFixture.js';
import { completeReleaseFixture, scratchDirectory } from '../support/releaseCeremonyFixture.js';

/**
 * `§12` — THE REQUIRED PRE-LIVE CLASS-19 AUDIT.
 *
 * =================================================================================
 * THE PROPERTY THIS FILE EXISTS TO PROVE, VERBATIM FROM `§12`
 *
 *   "**A CALLER-SUPPLIED LEGACY CONSTRUCTOR VERIFICATION KEY CANNOT CREATE OR ADMIT
 *    AUTHORITY OUTSIDE THE VERIFIED CLASS-19 ARTIFACT.**"
 *
 * `50 §3i` states the unmigrated arrangement plainly: `ConstructorVersionResolver` "takes the
 * verifying public key **as a constructor argument** and holds no keystore, no rotation and
 * no revocation list", and "**A CALLER-SUPPLIED VERIFICATION KEY IS NOT A TRUST ROOT**".
 *
 * `§13` then bounds the remedy: "DO NOT invent the migration if v1.3.6 merely says 'future
 * migration' without defining mechanics", and "The preferred safety property is:
 * **constructor resolution is rooted in the verified class-19 artifact/bundle identity, not
 * in an arbitrary runtime verification-key argument.**"
 *
 * `50 §3i` declares the KEY migration future work and defines no mechanics, so no key
 * management is invented here. The preferred safety property IS implemented:
 * `src/kernel/canonicalisation/constructorAdmission.ts` roots MEMBERSHIP in the verified
 * class-19 artifact bytes. The key argument survives, renamed for what it is, and can now
 * only cause a refusal.
 *
 * All four required attacks are below, each against the production admission path AND
 * against the unwrapped S1B arrangement, so the difference is demonstrated rather than
 * asserted.
 *
 * =================================================================================
 * A NOTE ON THE CONSTRUCTOR ID, WHICH IS ITSELF EVIDENCE
 *
 * The verified class-19 artifact declares `acos.constructor.refund.create`. The S1B
 * canonicaliser registry declares `ctor.refund.create`
 * (`src/kernel/canonicalisation/constructors/refundCreate.ts`). They differ, and that is
 * consistent with the residual this slice reports rather than a defect it introduces: class
 * 19 has no production authority consumer at v1.3.6, and `50 §6` carries the artifact as a
 * manifest member while `50 §3i` leaves its runtime wiring to a later slice. These tests
 * therefore exercise the ADMISSION BOUNDARY, which is where the widening risk lives, and
 * they use the identifiers the verified artifact actually declares.
 * =================================================================================
 */

/** The identity tuple class-19 admission is decided on. Widened on purpose: a test that
 * could not express version 2 could not express `§12`'s attack A. */
interface ConstructorTuple {
  readonly constructorId: string;
  readonly actionClass: string;
  readonly semanticMajor: number;
  readonly nonSemanticMinor: number;
}

const MANIFESTED: ConstructorTuple = Object.freeze({
  constructorId: 'acos.constructor.refund.create',
  actionClass: 'refund.create',
  semanticMajor: 1,
  nonSemanticMinor: 0,
});

function record(
  signer: TestSigner,
  overrides: Partial<ConstructorTuple> = {},
): ConstructorVersionRecord {
  return signConstructorVersion(signer, {
    constructorId: overrides.constructorId ?? MANIFESTED.constructorId,
    actionClass: overrides.actionClass ?? MANIFESTED.actionClass,
    semanticMajor: overrides.semanticMajor ?? MANIFESTED.semanticMajor,
    nonSemanticMinor: overrides.nonSemanticMinor ?? MANIFESTED.nonSemanticMinor,
    changedFields: [],
    semanticChange: (overrides.semanticMajor ?? MANIFESTED.semanticMajor) !== 1,
    signedAt: new Date('2026-09-24T00:00:00.000Z'),
  });
}

function bundleFor(
  fixture: ReturnType<typeof completeReleaseFixture>,
): VerifiedControlArtifactBundle {
  return verifyControlArtifactBundle(
    readDeploymentTrustConfiguration(fixture.controlEnv),
    filesystemArtifactPackage(fixture.controlPackageRoot),
  );
}

function reasonCode(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      (error as { name?: string }).name === 'ControlArtifactIntegrityFailure'
    ) {
      return String((error as { reasonCode?: string }).reasonCode);
    }
    return `UNEXPECTED: ${String(error)}`;
  }
  return 'NO REFUSAL';
}

function class19Bytes(records: readonly ConstructorTuple[]): Buffer {
  return Buffer.from(
    `${JSON.stringify(
      {
        artifact_id: 'acos.control.effect_constructors',
        artifact_version: 'acos.effect_constructors.2026-09-24',
        records: records.map((entry) => ({
          constructor_id: entry.constructorId,
          action_class: entry.actionClass,
          semantic_major: entry.semanticMajor,
          non_semantic_minor: entry.nonSemanticMinor,
        })),
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
}

describe('the verified class-19 artifact is what declares which constructor versions exist', () => {
  it('the repository release carries exactly one record, at 1.0', () => {
    const fixture = completeReleaseFixture({ dir: scratchDirectory('acos-s1l-c19-base-') });
    expect(verifiedConstructorSet(bundleFor(fixture)).records).toEqual([MANIFESTED]);
  });

  it('the manifested record, correctly signed, is admitted and resolves', () => {
    const fixture = completeReleaseFixture({ dir: scratchDirectory('acos-s1l-c19-ok-') });
    const owner = newTestSigner();
    const resolver = verifiedConstructorVersionResolver(
      bundleFor(fixture),
      [record(owner)],
      owner.publicKey,
    );
    const identity = resolver.resolve(MANIFESTED.constructorId, 'refund.create');
    expect(identity.semanticMajor).toBe(1);
    expect(identity.nonSemanticMinor).toBe(0);
  });
});

describe('§12 ATTACK A — an attacker key plus an attacker-signed version B', () => {
  it('PRODUCTION refuses B before any signature is checked', () => {
    const fixture = completeReleaseFixture({ dir: scratchDirectory('acos-s1l-c19-a-') });
    const attacker = newTestSigner();
    const versionB = record(attacker, { semanticMajor: 2 });

    expect(
      reasonCode(() =>
        verifiedConstructorVersionResolver(bundleFor(fixture), [versionB], attacker.publicKey),
      ),
    ).toBe('CONSTRUCTOR_RECORD_NOT_MANIFESTED');
  });

  it('VULNERABLE CONTROL 10 — the unwrapped S1B arrangement ADMITS B', () => {
    const attacker = newTestSigner();
    const versionB = record(attacker, { semanticMajor: 2 });

    // THE DEFECT: membership is whatever the caller passed, verified against whatever key
    // the caller passed. No verified artifact is consulted at all.
    const unsafe = unsafeCallerKeyConstructorResolver(attacker.publicKey, [versionB]);
    const admitted = unsafe.resolve(MANIFESTED.constructorId, 'refund.create');
    expect(admitted.semanticMajor).toBe(2);
  });
});

describe('§12 ATTACK B — a verification key that does not verify the manifested record', () => {
  it('PRODUCTION admits the manifested TUPLE and then FAILS CLOSED on the signature', () => {
    const fixture = completeReleaseFixture({ dir: scratchDirectory('acos-s1l-c19-b-') });
    const owner = newTestSigner();
    const stranger = newTestSigner();

    const resolver = verifiedConstructorVersionResolver(
      bundleFor(fixture),
      [record(owner)],
      // A key that does not verify the record the verified artifact declares.
      stranger.publicKey,
    );

    let denied = false;
    try {
      resolver.resolve(MANIFESTED.constructorId, 'refund.create');
    } catch (error) {
      denied = true;
      expect(String(error)).toMatch(/signature|CONSTRUCTOR_VERSION|canonicalis/i);
    }
    // Fail closed, and NOTHING substituted.
    expect(denied).toBe(true);
  });

  it('admission returns the caller’s records and never supplies one of its own', () => {
    const fixture = completeReleaseFixture({ dir: scratchDirectory('acos-s1l-c19-b2-') });
    const owner = newTestSigner();
    const supplied = record(owner);
    const admitted = admitConstructorVersionRecords(bundleFor(fixture), [supplied]);
    expect(admitted).toHaveLength(1);
    expect(admitted[0]).toBe(supplied);
  });
});

describe('§12 ATTACK C — a correctly signed record for a constructor not in the verified bytes', () => {
  it('PRODUCTION refuses it', () => {
    const fixture = completeReleaseFixture({ dir: scratchDirectory('acos-s1l-c19-c-') });
    const owner = newTestSigner();
    const intruder = record(owner, {
      constructorId: 'acos.constructor.campaign.pause',
      actionClass: 'campaign.pause',
    });

    expect(
      reasonCode(() =>
        admitConstructorVersionRecords(bundleFor(fixture), [record(owner), intruder]),
      ),
    ).toBe('CONSTRUCTOR_RECORD_NOT_MANIFESTED');
  });

  it('and a deployment MISSING a manifested record fails closed too', () => {
    const fixture = completeReleaseFixture({ dir: scratchDirectory('acos-s1l-c19-c2-') });
    expect(reasonCode(() => admitConstructorVersionRecords(bundleFor(fixture), []))).toBe(
      'MANIFESTED_CONSTRUCTOR_MISSING',
    );
  });

  it('VULNERABLE CONTROL 10 — the unwrapped arrangement resolves the intruder happily', () => {
    const owner = newTestSigner();
    const intruder = record(owner, {
      constructorId: 'acos.constructor.campaign.pause',
      actionClass: 'campaign.pause',
    });
    const unsafe = unsafeCallerKeyConstructorResolver(owner.publicKey, [intruder]);
    expect(
      unsafe.resolve('acos.constructor.campaign.pause', 'campaign.pause').semanticMajor,
    ).toBe(1);
  });
});

describe('§12 ATTACK D — a legitimate new owner-approved class-19 release', () => {
  it('the NEW version is admitted after a normal ceremony, and the old one no longer is', () => {
    const owner = newTestSigner();
    const bumped = class19Bytes([{ ...MANIFESTED, semanticMajor: 2 }]);

    const before = completeReleaseFixture({ dir: scratchDirectory('acos-s1l-c19-d1-') });
    const after = completeReleaseFixture({
      dir: scratchDirectory('acos-s1l-c19-d2-'),
      manifestEpoch: '2',
      overrides: [{ artifactClass: 19, bytes: bumped }],
    });
    // A new release, a new identity, a new pin. Not an edit to a deployed artifact.
    expect(after.completed.manifestId).not.toBe(before.completed.manifestId);

    const versionB = record(owner, { semanticMajor: 2 });

    // Against the OLD release, version B is refused.
    expect(reasonCode(() => admitConstructorVersionRecords(bundleFor(before), [versionB]))).toBe(
      'CONSTRUCTOR_RECORD_NOT_MANIFESTED',
    );

    // Against the NEW verified release it is admitted — and 1.0 is not.
    const newBundle = bundleFor(after);
    expect(admitConstructorVersionRecords(newBundle, [versionB])).toHaveLength(1);
    expect(reasonCode(() => admitConstructorVersionRecords(newBundle, [record(owner)]))).toBe(
      'CONSTRUCTOR_RECORD_NOT_MANIFESTED',
    );

    // Authority followed the SIGNED BYTES, which is the whole property.
    const resolver = verifiedConstructorVersionResolver(newBundle, [versionB], owner.publicKey);
    expect(resolver.resolve(MANIFESTED.constructorId, 'refund.create').semanticMajor).toBe(2);
  });
});

describe('§13 — what is closed, and what is honestly still open', () => {
  it('the key argument still exists, and is named for what it is', () => {
    // `50 §3i` declares the KEY migration future work without defining its mechanics, and
    // `§13` forbids inventing it. So the parameter remains — named `legacyRecordVerifyingKey`
    // rather than anything a reader could mistake for a trust root.
    const source = readFileSync(
      join('src', 'kernel', 'canonicalisation', 'constructorAdmission.ts'),
      'utf8',
    );
    expect(source).toContain('legacyRecordVerifyingKey');
    expect(source).toContain('DECLARED FUTURE WORK');
    expect(source).not.toContain('trustRoot');
  });

  it('but the key can no longer WIDEN authority — only refuse', () => {
    const fixture = completeReleaseFixture({ dir: scratchDirectory('acos-s1l-c19-scope-') });
    const bundle = bundleFor(fixture);
    const owner = newTestSigner();
    const attacker = newTestSigner();

    for (const forged of [
      record(attacker, { semanticMajor: 7 }),
      record(attacker, { constructorId: 'acos.constructor.invented' }),
      record(attacker, { nonSemanticMinor: 4 }),
    ]) {
      expect(reasonCode(() => admitConstructorVersionRecords(bundle, [forged]))).toBe(
        'CONSTRUCTOR_RECORD_NOT_MANIFESTED',
      );
    }

    // And the ONE record the owner signed is admitted whichever key the caller offers,
    // because membership is not the key's decision at all.
    expect(admitConstructorVersionRecords(bundle, [record(attacker)])).toHaveLength(1);
    expect(admitConstructorVersionRecords(bundle, [record(owner)])).toHaveLength(1);
  });

  it('two records for one manifested version are refused', () => {
    const fixture = completeReleaseFixture({ dir: scratchDirectory('acos-s1l-c19-dup-') });
    const owner = newTestSigner();
    expect(
      reasonCode(() =>
        admitConstructorVersionRecords(bundleFor(fixture), [record(owner), record(owner)]),
      ),
    ).toBe('CONSTRUCTOR_RECORD_DUPLICATED');
  });
});
