import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  CAS_ARTIFACT_DOMAIN,
  CAS_MANIFEST_CORE_DOMAIN,
  CAS_MANIFEST_DOMAIN,
  CAS_MAX_ARTIFACT_ID_BYTES,
  CAS_MAX_ARTIFACT_VERSION_BYTES,
  ControlArtifactFramingDefect,
  MANIFEST_FORMAT_VERSION,
  artifactSignatureMessage,
  casField,
  casInteger,
  casText,
  manifestCoreBytes,
  manifestSignatureMessage,
} from '../../src/kernel/controlArtifacts/casSig.js';
import { sha256, verifyControlSignature } from '../../src/kernel/controlArtifacts/ed25519.js';
import {
  oracleArtifactMessage,
  oracleField,
  oracleManifestCore,
  oracleManifestMessage,
  oracleSign,
  oracleText,
} from '../../tools/control-artifacts/framing.js';
import {
  TEST_ONLY_PRIMARY_SEED,
  TEST_ONLY_SECOND_FACTOR_SEED,
  testOnlyKeyPair,
} from '../support/controlArtifactFixture.js';

/**
 * `50 §3b` — `ACOS-CAS-SIG-V1`, against an INDEPENDENT ORACLE.
 *
 * =================================================================================
 * WHY THE ORACLE IS NOT THE PRODUCTION ENCODER, AND WHY THAT MATTERS HERE MORE THAN USUAL
 *
 * `§9` and `§58` of the S1K mandate: "Tests must contain an independent hand-authored
 * implementation of the signature-message framing. **The test oracle must NOT import the
 * production framing helper.**" and "Do not derive expected: signature framing; manifest
 * core bytes; content hash; [...] from the production helper being tested."
 *
 * `tools/control-artifacts/framing.ts` is that implementation, written from `50 §3b`'s and
 * `50 §3d`'s printed messages, importing nothing from `src/`. It is ALSO the signer every
 * fixture in this suite is produced by, which is stronger than having two: every package the
 * production verifier accepts in these tests was SIGNED by the implementation the production
 * verifier does not share a line with. A byte-level disagreement between them would show up
 * as a verification failure across the whole suite rather than as a quiet agreement.
 *
 * `36 §2` VC-K1, verbatim: "Assert against an independently written oracle that reproduces
 * `50 §3b`'s framing from the specification and not from the production encoder."
 * =================================================================================
 */

const PRIMARY = testOnlyKeyPair(TEST_ONLY_PRIMARY_SEED);
const SECOND_FACTOR = testOnlyKeyPair(TEST_ONLY_SECOND_FACTOR_SEED);

const DIGEST_A = sha256(Buffer.from('artifact A bytes', 'utf8'));
const DIGEST_B = sha256(Buffer.from('artifact B bytes', 'utf8'));

const IDENTITY = {
  artifactClass: 3,
  artifactId: 'acos.control.action_catalogue',
  artifactVersion: 'acos.action_catalogue.2026-09-24',
  contentSha256: DIGEST_A,
};

describe('VC-K1 — the field encoding, byte for byte against the oracle', () => {
  it('`CAS_FIELD(b) = uint32_be(len(b)) || b`, on a hand-computed vector', () => {
    // Hand-authored, not derived: "abc" is three bytes, so the framing is 00 00 00 03 61 62 63.
    expect(Buffer.from(casField(casText('abc'))).toString('hex')).toBe('00000003616263');
    // The empty value is an ordinary zero-length field. `50 §3b`: NULL is "NOT REPRESENTABLE",
    // so an empty string is a value and not an absence.
    expect(Buffer.from(casField(casText(''))).toString('hex')).toBe('00000000');
  });

  it('and production agrees with the oracle on every field kind', () => {
    for (const value of ['', 'a', 'acos.control.policy_set', 'ACOS-JCS-1', 'PRIMARY']) {
      expect(Buffer.from(casField(casText(value)))).toEqual(oracleField(oracleText(value)));
    }
    expect(Buffer.from(casField(casInteger(0n)))).toEqual(oracleField(Buffer.from('0', 'utf8')));
    expect(Buffer.from(casField(casInteger(27n)))).toEqual(oracleField(Buffer.from('27', 'utf8')));
  });

  it('integers are decimal ASCII with no leading zeros and no leading plus', () => {
    expect(Buffer.from(casInteger(0n)).toString('utf8')).toBe('0');
    expect(Buffer.from(casInteger(7n)).toString('utf8')).toBe('7');
    expect(Buffer.from(casInteger(4294967294n)).toString('utf8')).toBe('4294967294');
    expect(Buffer.from(casInteger(-3n)).toString('utf8')).toBe('-3');
  });

  it('text is NFC, so one logical identity has exactly one framing', () => {
    // U+00E9 and "e" + U+0301 are the same NFC string and must frame identically, or an
    // artifact id could be spelled two ways and signed once.
    expect(Buffer.from(casText('café'))).toEqual(Buffer.from(casText('café')));
  });

  it('`U+0000` is excluded from text, and a malformed length fails closed', () => {
    expect(() => casText('a\u0000b')).toThrow(ControlArtifactFramingDefect);
  });
});

describe('VC-K1 — `M_artifact`, and the five bindings', () => {
  it('production and the oracle produce byte-identical messages for both roles', () => {
    for (const role of ['PRIMARY', 'SECOND_FACTOR'] as const) {
      expect(Buffer.from(artifactSignatureMessage(role, IDENTITY))).toEqual(
        oracleArtifactMessage(role, {
          artifactClass: IDENTITY.artifactClass,
          artifactId: IDENTITY.artifactId,
          artifactVersion: IDENTITY.artifactVersion,
          contentSha256: Buffer.from(IDENTITY.contentSha256),
        }),
      );
    }
  });

  it('the message opens with the declared domain separator, as literal ASCII', () => {
    const message = Buffer.from(artifactSignatureMessage('PRIMARY', IDENTITY));
    expect(message.subarray(4, 4 + CAS_ARTIFACT_DOMAIN.length).toString('ascii')).toBe(
      'ACOS-CONTROL-ARTIFACT-SIGNATURE-V1',
    );
  });

  it('SIGNER ROLE is bound: a PRIMARY signature does not verify in the SECOND_FACTOR slot', () => {
    const primaryMessage = artifactSignatureMessage('PRIMARY', IDENTITY);
    const signature = oracleSign(Buffer.from(primaryMessage), PRIMARY.privateKey);
    expect(verifyControlSignature(primaryMessage, PRIMARY.rawPublicKey, signature)).toBe(true);
    // Transplanted into the other slot, over the other role's message, it does not verify —
    // `50 §3b`: "even if the two keys were accidentally identical, because the signed bytes
    // differ".
    expect(
      verifyControlSignature(
        artifactSignatureMessage('SECOND_FACTOR', IDENTITY),
        PRIMARY.rawPublicKey,
        signature,
      ),
    ).toBe(false);
  });

  it('ARTIFACT CLASS is bound: a class-3 signature is not a class-20 signature', () => {
    const signature = oracleSign(
      Buffer.from(artifactSignatureMessage('PRIMARY', IDENTITY)),
      PRIMARY.privateKey,
    );
    expect(
      verifyControlSignature(
        artifactSignatureMessage('PRIMARY', { ...IDENTITY, artifactClass: 20 }),
        PRIMARY.rawPublicKey,
        signature,
      ),
    ).toBe(false);
  });

  it('ARTIFACT ID is bound: artifact A’s signature is not artifact B’s', () => {
    const signature = oracleSign(
      Buffer.from(artifactSignatureMessage('PRIMARY', IDENTITY)),
      PRIMARY.privateKey,
    );
    expect(
      verifyControlSignature(
        artifactSignatureMessage('PRIMARY', {
          ...IDENTITY,
          artifactId: 'acos.control.degraded_mode_config',
        }),
        PRIMARY.rawPublicKey,
        signature,
      ),
    ).toBe(false);
  });

  it('ARTIFACT VERSION is bound: an old version’s signature does not validate a new one', () => {
    const signature = oracleSign(
      Buffer.from(artifactSignatureMessage('PRIMARY', IDENTITY)),
      PRIMARY.privateKey,
    );
    expect(
      verifyControlSignature(
        artifactSignatureMessage('PRIMARY', { ...IDENTITY, artifactVersion: 'v2' }),
        PRIMARY.rawPublicKey,
        signature,
      ),
    ).toBe(false);
  });

  it('CONTENT HASH is bound: different bytes under one identity do not verify', () => {
    const signature = oracleSign(
      Buffer.from(artifactSignatureMessage('PRIMARY', IDENTITY)),
      PRIMARY.privateKey,
    );
    expect(
      verifyControlSignature(
        artifactSignatureMessage('PRIMARY', { ...IDENTITY, contentSha256: DIGEST_B }),
        PRIMARY.rawPublicKey,
        signature,
      ),
    ).toBe(false);
  });

  it('boundary lengths are accepted at the maximum and refused one byte over', () => {
    const maxId = 'a'.repeat(CAS_MAX_ARTIFACT_ID_BYTES);
    const maxVersion = 'b'.repeat(CAS_MAX_ARTIFACT_VERSION_BYTES);
    expect(() =>
      artifactSignatureMessage('PRIMARY', {
        ...IDENTITY,
        artifactId: maxId,
        artifactVersion: maxVersion,
      }),
    ).not.toThrow();
    expect(() =>
      artifactSignatureMessage('PRIMARY', { ...IDENTITY, artifactId: `${maxId}a` }),
    ).toThrow(ControlArtifactFramingDefect);
    expect(() =>
      artifactSignatureMessage('PRIMARY', { ...IDENTITY, artifactVersion: `${maxVersion}b` }),
    ).toThrow(ControlArtifactFramingDefect);
  });

  it('a malformed digest or signature length fails closed and is never truncated', () => {
    expect(() =>
      artifactSignatureMessage('PRIMARY', {
        ...IDENTITY,
        contentSha256: new Uint8Array(31),
      }),
    ).toThrow(ControlArtifactFramingDefect);
    expect(() =>
      manifestCoreBytes(
        {
          manifestFormatVersion: MANIFEST_FORMAT_VERSION,
          manifestEpoch: '1',
          expectedPrimaryKeyId: 'a'.repeat(64),
          expectedSecondFactorKeyId: 'b'.repeat(64),
        },
        [
          {
            ...IDENTITY,
            primarySignature: new Uint8Array(63),
            secondFactorSignature: new Uint8Array(64),
          },
        ],
      ),
    ).toThrow(ControlArtifactFramingDefect);
  });
});

describe('VC-K1 — `CORE` and `M_manifest`, against the oracle', () => {
  const header = {
    manifestFormatVersion: MANIFEST_FORMAT_VERSION,
    manifestEpoch: '7',
    expectedPrimaryKeyId: 'c'.repeat(64),
    expectedSecondFactorKeyId: 'd'.repeat(64),
  };
  const entries = [
    {
      ...IDENTITY,
      primarySignature: new Uint8Array(64).fill(1),
      secondFactorSignature: new Uint8Array(64).fill(2),
    },
  ];

  it('the CORE bytes agree byte for byte', () => {
    expect(Buffer.from(manifestCoreBytes(header, entries))).toEqual(
      oracleManifestCore(header, [
        {
          artifactClass: IDENTITY.artifactClass,
          artifactId: IDENTITY.artifactId,
          artifactVersion: IDENTITY.artifactVersion,
          contentSha256: Buffer.from(IDENTITY.contentSha256),
          primarySignature: Buffer.alloc(64, 1),
          secondFactorSignature: Buffer.alloc(64, 2),
        },
      ]),
    );
  });

  it('the manifest message agrees byte for byte, under its SEPARATE domain', () => {
    const coreSha256 = sha256(manifestCoreBytes(header, entries));
    for (const role of ['PRIMARY', 'SECOND_FACTOR'] as const) {
      expect(Buffer.from(manifestSignatureMessage(role, header, coreSha256))).toEqual(
        oracleManifestMessage(role, header, Buffer.from(coreSha256)),
      );
    }
    const message = Buffer.from(manifestSignatureMessage('PRIMARY', header, coreSha256));
    expect(message.subarray(4, 4 + CAS_MANIFEST_DOMAIN.length).toString('ascii')).toBe(
      'ACOS-CONTROL-MANIFEST-SIGNATURE-V1',
    );
  });

  it('an ARTIFACT signature can never be presented as a MANIFEST signature', () => {
    // The two domains are different strings, so the first framed field differs and the
    // signed bytes can never coincide.
    expect(CAS_ARTIFACT_DOMAIN).not.toBe(CAS_MANIFEST_DOMAIN);
    expect(CAS_MANIFEST_CORE_DOMAIN).not.toBe(CAS_MANIFEST_DOMAIN);
    const coreSha256 = sha256(manifestCoreBytes(header, entries));
    const manifestSignature = oracleSign(
      Buffer.from(manifestSignatureMessage('PRIMARY', header, coreSha256)),
      PRIMARY.privateKey,
    );
    expect(
      verifyControlSignature(
        artifactSignatureMessage('PRIMARY', { ...IDENTITY, contentSha256: coreSha256 }),
        PRIMARY.rawPublicKey,
        manifestSignature,
      ),
    ).toBe(false);
  });

  it('the two roots are distinct, so a second-factor message is a different signature', () => {
    expect(Buffer.from(PRIMARY.rawPublicKey).equals(SECOND_FACTOR.rawPublicKey)).toBe(false);
  });
});

describe('`50 §3g` — the framing sits ABOVE everything and imports nothing', () => {
  const CONTROL_ARTIFACTS_ROOT = join('src', 'kernel', 'controlArtifacts');

  it('`casSig.ts` has no import statement at all', () => {
    const source = readFileSync(join(CONTROL_ARTIFACTS_ROOT, 'casSig.ts'), 'utf8');
    expect(source).not.toMatch(/^import /m);
  });

  it('nothing on the bootstrap path references ACOS-JCS-1 or JSON serialisation', () => {
    // `50 §3b`: "**IT DOES NOT DEPEND ON `ACOS-JCS-1`.** [...] **IT USES NO JSON AND NO JSON
    // RESERIALIZATION.**" The manifest DOCUMENT is parsed as a transport, so `JSON.parse` is
    // permitted in `manifestCore.ts`; `JSON.stringify` is not, anywhere, because reserialising
    // is the step that would make an identity depend on a property order.
    for (const file of ['casSig.ts', 'ed25519.ts', 'manifestCore.ts', 'verifier.ts']) {
      const source = readFileSync(join(CONTROL_ARTIFACTS_ROOT, file), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
      expect(source, `${file} reserialises JSON`).not.toContain('JSON.stringify');
      expect(source, `${file} imports the canonicaliser`).not.toContain('canonicalBytes');
      expect(source, `${file} imports the canonicaliser`).not.toContain('canonicaliser');
    }
  });

  it('and no module under controlArtifacts/ imports the TypeScript canonicaliser', () => {
    for (const file of readdirSync(CONTROL_ARTIFACTS_ROOT)) {
      if (!file.endsWith('.ts')) continue;
      const source = readFileSync(join(CONTROL_ARTIFACTS_ROOT, file), 'utf8');
      const imports = [...source.matchAll(/^import .*?from '([^']+)';$/gm)].map((m) => m[1]!);
      for (const specifier of imports) {
        expect(specifier, `${file} imports ${specifier}`).not.toMatch(/canonicalBytes|jcs1/i);
      }
    }
  });
});
