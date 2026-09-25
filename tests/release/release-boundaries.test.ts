import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { PRE_LIVE_INVENTORY } from '../../tools/control-release/inventory.js';
import { REQUIRED_PRE_LIVE_ARTIFACTS } from '../../src/kernel/controlArtifacts/requiredSet.js';
import {
  UNSAFE_RUNTIME_SIGNER_IMPORT_SAMPLE,
  importsReleaseTooling,
  unsafeUnlabelledDeploymentDocument,
} from '../negative-controls/unsafe-release-ceremony.js';
import { TEST_ONLY_PRIMARY_SEED, TEST_ONLY_SECOND_FACTOR_SEED } from '../support/controlArtifactFixture.js';
import { RELEASE_LAYOUT, completeReleaseFixture, scratchDirectory } from '../support/releaseCeremonyFixture.js';

/**
 * `§3`, `§4`, `§16`, `§35`, `§37` AND `§47` — THE RELEASE-TOOLING BOUNDARIES.
 *
 * =================================================================================
 * THE RUNTIME IS A VERIFIER. IT NEVER SIGNS, AND IT CANNOT REACH A SIGNER.
 *
 * `§3`: "Production runtime must never receive: primary private signing key; second-factor
 * private signing key. [...] That tooling must not be reachable from: application bootstrap;
 * control kernel; audit runtime; worker/model surfaces; Effect Gateway; web routes."
 *
 * `§16`: the release signer "must not import `src/...` production framing helpers."
 *
 * Both directions are asserted below over the import graph, not in prose.
 * =================================================================================
 */

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, out);
    else if (entry.name.endsWith('.ts')) out.push(path);
  }
  return out;
}

function walkAll(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walkAll(path, out);
    else out.push(path);
  }
  return out;
}

const PRODUCTION_SOURCES = walk('src');
const RELEASE_TOOLING = walk(join('tools', 'control-release'));
const PRELIVE_TOOLING = walk(join('tools', 'prelive'));

function codeOf(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

function importsOf(path: string): string[] {
  return [...readFileSync(path, 'utf8').matchAll(/from '([^']+)'/g)].map((match) => match[1]!);
}

describe('§3 / §13 — VULNERABLE CONTROL 13: the runtime importing the signing tool', () => {
  it('NOTHING under `src/` imports anything under `tools/`', () => {
    for (const path of PRODUCTION_SOURCES) {
      for (const specifier of importsOf(path)) {
        expect(specifier, `${path} imports ${specifier}`).not.toMatch(/tools\//);
      }
    }
  });

  it('and the same scan FINDS the defect where it exists, so the control discriminates', () => {
    // The sample is what a production module would contain. It cannot be placed under `src/`
    // without failing the test above, which is the point of the test above.
    expect(importsReleaseTooling(UNSAFE_RUNTIME_SIGNER_IMPORT_SAMPLE)).toBe(true);
    // Over the real production tree, the same scan finds nothing.
    const offenders = PRODUCTION_SOURCES.filter((path) => importsReleaseTooling(readFileSync(path, 'utf8')));
    expect(offenders).toEqual([]);
    // And it does find the ceremony's own modules, so it is not simply always false.
    expect(
      RELEASE_TOOLING.filter((path) => importsReleaseTooling(readFileSync(path, 'utf8'))).length,
    ).toBeGreaterThan(0);
  });

  it('nothing under `src/` imports anything under `tests/`', () => {
    for (const path of PRODUCTION_SOURCES) {
      for (const specifier of importsOf(path)) {
        expect(specifier, `${path} imports ${specifier}`).not.toMatch(/tests\//);
      }
    }
  });
});

describe('§16 — the offline release tooling is independent of the runtime verifier', () => {
  it('`tools/control-release/` imports NOTHING from `src/`', () => {
    for (const path of RELEASE_TOOLING) {
      for (const specifier of importsOf(path)) {
        expect(specifier, `${path} imports ${specifier}`).not.toMatch(/src\//);
      }
    }
  });

  it('and it holds its OWN transcription of 50 §6’s inventory, which agrees with the runtime’s', () => {
    // Two independent transcriptions of one printed table. The agreement is asserted HERE,
    // in a test, and neither module reads the other in the path that matters.
    expect(PRE_LIVE_INVENTORY.map((member) => member.artifactClass)).toEqual(
      REQUIRED_PRE_LIVE_ARTIFACTS.map((member) => member.artifactClass),
    );
    expect(PRE_LIVE_INVENTORY.map((member) => member.artifactId)).toEqual(
      REQUIRED_PRE_LIVE_ARTIFACTS.map((member) => member.artifactId),
    );
    expect(PRE_LIVE_INVENTORY.map((member) => member.declaredVersion)).toEqual(
      REQUIRED_PRE_LIVE_ARTIFACTS.map((member) => member.declaredVersion),
    );
  });

  it('the PRE-LIVE READINESS tool may import `src/` — it is a verifier consumer, not a signer', () => {
    // `§39`'s gate reads each plane's own verified evidence, so it necessarily uses both
    // planes' real verifiers. What it must NOT do is sign, and it does not.
    expect(PRELIVE_TOOLING.some((path) => importsOf(path).some((s) => s.includes('src/')))).toBe(
      true,
    );
    for (const path of PRELIVE_TOOLING) {
      const code = codeOf(path);
      expect(code, `${path} signs`).not.toMatch(/\bsign\s*\(/);
      expect(code, `${path} imports the release ceremony`).not.toMatch(/control-release/);
    }
  });
});

describe('§12 / §13 — the ONLY production constructor resolver is the artifact-rooted one', () => {
  /**
   * `50 §3i`: "**A CALLER-SUPPLIED VERIFICATION KEY IS NOT A TRUST ROOT**, and it must not
   * become the general S1K pattern."
   *
   * The admission gate is what keeps a caller-supplied key from ADMITTING a constructor
   * record outside the verified class-19 artifact. That property is only worth anything if
   * the raw constructor cannot be reached around it, so the construction sites are pinned to
   * a hand-authored allow-list of exactly one — the same discipline
   * `tests/controlArtifacts/boundaries.test.ts` applies to `verifyControlArtifactBundle`.
   *
   * A later slice wiring constructor resolution into a kernel path therefore cannot reach the
   * unwrapped constructor by accident: it has to edit this list, in a commit somebody reads.
   */
  const ADMISSION_GATE = join('src', 'kernel', 'canonicalisation', 'constructorAdmission.ts');
  const DECLARATION = join('src', 'kernel', 'canonicalisation', 'constructorVersion.ts');

  it('`new ConstructorVersionResolver(` appears in exactly ONE production module', () => {
    const offenders = PRODUCTION_SOURCES.filter(
      (path) => path !== DECLARATION && codeOf(path).includes('new ConstructorVersionResolver('),
    );
    expect(offenders).toEqual([ADMISSION_GATE]);
  });

  it('and that module decides membership from the VERIFIED class-19 artifact', () => {
    const code = codeOf(ADMISSION_GATE);
    expect(code).toContain('verifiedConstructorSet(bundle)');
    expect(code).toContain('CONSTRUCTOR_RECORD_NOT_MANIFESTED');
    expect(code).toContain('MANIFESTED_CONSTRUCTOR_MISSING');
    // It takes the bundle FIRST: a resolver cannot be built without one.
    const signature = /verifiedConstructorVersionResolver\([\s\S]{0,40}?bundle:/.exec(code);
    expect(signature, 'the factory does not take the bundle first').not.toBeNull();
  });

  it('the rule is not vacuous — the unsafe control DOES construct it raw', () => {
    const unsafe = codeOf(join('tests', 'negative-controls', 'unsafe-release-ceremony.ts'));
    expect(unsafe).toContain('new ConstructorVersionResolver(');
  });
});

describe('§4 / §35 — no private key material anywhere it could be committed or shipped', () => {
  it('no module under `tools/control-release/` GENERATES a key pair', () => {
    for (const path of RELEASE_TOOLING) {
      const code = codeOf(path);
      expect(code, `${path} generates a key`).not.toContain('generateKeyPair');
    }
  });

  it('the only private-key entry points are the explicit file path and the TEST-ONLY seed', () => {
    const signerKey = codeOf(join('tools', 'control-release', 'signerKey.ts'));
    expect(signerKey).toContain('signerFromKeyFile');
    expect(signerKey).toContain('testOnlySignerFromSeed');
    // No environment variable is read for key material, anywhere in the release tooling.
    for (const path of RELEASE_TOOLING) {
      expect(codeOf(path), `${path} reads process.env`).not.toContain('process.env');
    }
  });

  it('the CLI exposes `--key-file` and NOTHING that could carry key bytes', () => {
    // On the EXECUTABLE code, not the prose: the file's own comment names the flags it
    // deliberately does not offer, and a rule that forbade saying so would forbid explaining
    // the rule.
    const cli = codeOf(join('tools', 'control-release', 'cli.ts'));
    expect(cli).toContain('--key-file');
    expect(cli).not.toContain('--key-hex');
    expect(cli).not.toContain('--seed');
    expect(cli).not.toContain('testOnlySignerFromSeed');
  });

  it('a COMPLETED release directory contains no private material at all', () => {
    const fixture = completeReleaseFixture({ dir: scratchDirectory('acos-s1l-bnd-') });
    const needles = [
      'PRIVATE KEY',
      'private_key',
      'privateKey',
      'BEGIN EC',
      'BEGIN RSA',
      TEST_ONLY_PRIMARY_SEED.toString('hex'),
      TEST_ONLY_SECOND_FACTOR_SEED.toString('hex'),
    ];
    for (const path of walkAll(fixture.releaseRoot)) {
      const content = readFileSync(path).toString('binary');
      for (const needle of needles) {
        expect(content.includes(needle), `${path} carries ${needle}`).toBe(false);
      }
    }
  });

  it('the deployment document carries the two PUBLIC keys and says so', () => {
    const fixture = completeReleaseFixture({ dir: scratchDirectory('acos-s1l-dep-') });
    const document = JSON.parse(
      readFileSync(join(fixture.releaseRoot, RELEASE_LAYOUT.deploymentFile), 'utf8'),
    ) as Record<string, unknown>;
    expect(document.CONTAINS_NO_PRIVATE_KEY_MATERIAL).toBe(true);
    expect(document.owner_artifact_root_key).toBe(fixture.primary.rawPublicKey.toString('hex'));
    expect(document.owner_artifact_second_factor_key).toBe(
      fixture.secondFactor.rawPublicKey.toString('hex'),
    );
    expect(document.expected_active_manifest_id).toBe(fixture.completed.manifestId);
    // Each plane gets its OWN block, under its OWN variable names (`§23`).
    expect(Object.keys(document.control_plane as object)).toContain('ACOS_CONTROL_ARTIFACT_ROOT');
    expect(Object.keys(document.audit_plane as object)).toContain(
      'ACOS_AUDIT_CONTROL_ARTIFACT_ROOT',
    );
  });
});

describe('§37 — no network signing service, and no vendor key technology, is introduced', () => {
  it('the release tooling has no transport of any kind', () => {
    for (const path of [...RELEASE_TOOLING, ...PRELIVE_TOOLING]) {
      const code = codeOf(path);
      for (const needle of [
        'node:http',
        'node:https',
        'node:net',
        'node:tls',
        'fetch(',
        'axios',
        'undici',
        'XMLHttpRequest',
      ]) {
        expect(code, `${path} carries ${needle}`).not.toContain(needle);
      }
    }
  });

  it('and names no key-management vendor', () => {
    for (const path of [...RELEASE_TOOLING, ...PRELIVE_TOOLING]) {
      const text = readFileSync(path, 'utf8');
      for (const vendor of ['KMS', 'Key Vault', 'HashiCorp', 'Vault(', 'CloudHSM']) {
        expect(text, `${path} names ${vendor}`).not.toContain(vendor);
      }
    }
  });
});

describe('§47 — VULNERABLE CONTROL 14: a test-signed release presented as production', () => {
  it('the real deployment document always declares its channel', () => {
    const test = completeReleaseFixture({ dir: scratchDirectory('acos-s1l-chan-a-') });
    const production = completeReleaseFixture({
      dir: scratchDirectory('acos-s1l-chan-b-'),
      releaseChannel: 'PRODUCTION',
    });
    const read = (fixture: typeof test): Record<string, unknown> =>
      JSON.parse(
        readFileSync(join(fixture.releaseRoot, RELEASE_LAYOUT.deploymentFile), 'utf8'),
      ) as Record<string, unknown>;

    expect(read(test).release_channel).toBe('TEST_ONLY');
    expect(read(production).release_channel).toBe('PRODUCTION');
  });

  it('THE DEFECT drops the channel, so a test release reads exactly like a production one', () => {
    const fixture = completeReleaseFixture({ dir: scratchDirectory('acos-s1l-chan-c-') });
    const unsafe = unsafeUnlabelledDeploymentDocument({
      primaryPublicKeyHex: fixture.primary.rawPublicKey.toString('hex'),
      secondFactorPublicKeyHex: fixture.secondFactor.rawPublicKey.toString('hex'),
      manifestId: fixture.completed.manifestId,
    });
    expect(unsafe).not.toContain('release_channel');
    expect(unsafe).not.toContain('TEST');

    const real = readFileSync(join(fixture.releaseRoot, RELEASE_LAYOUT.deploymentFile), 'utf8');
    expect(real).toContain('release_channel');
    expect(real).toContain('TEST_ONLY');
  });

  it('and the DECISIVE separation is the key id, not the label', () => {
    // A test-signed package can never satisfy a deployment pinned to a production manifest,
    // because the test keys derive different `key_id`s, which move `50 §3d`'s core and
    // therefore `manifest_id`. The label is legibility; this is the mechanism.
    const fixture = completeReleaseFixture({ dir: scratchDirectory('acos-s1l-chan-d-') });
    const manifest = JSON.parse(
      readFileSync(join(fixture.completed.packageRoot, 'manifest.json'), 'utf8'),
    ) as { expected_primary_key_id: string };
    expect(manifest.expected_primary_key_id).toBe(
      createHash('sha256').update(fixture.primary.rawPublicKey).digest('hex'),
    );
  });

  it('NO release signed with the test keys is checked into the repository', () => {
    // `§47`: a test-signed release must never sit where a production one could be read from.
    // `artifacts/control/` carries UNSIGNED artifact bytes and no manifest, and there is no
    // committed release directory anywhere in the tree.
    expect(readdirSync(join('artifacts', 'control'))).not.toContain('manifest.json');
    const committedReleases = readdirSync('.', { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .filter((name) => name === 'release' || name === 'releases');
    expect(committedReleases).toEqual([]);
  });
});

describe('§38 — what the repository proves about custody, stated as a limit', () => {
  it('the ceremony leaves three approval records under two distinct key ids', () => {
    const fixture = completeReleaseFixture({ dir: scratchDirectory('acos-s1l-cust-') });
    const approvals = readdirSync(join(fixture.releaseRoot, RELEASE_LAYOUT.approvalsDir)).sort();
    expect(approvals).toHaveLength(3);

    const keyIds = approvals.map((name) => {
      const document = JSON.parse(
        readFileSync(join(fixture.releaseRoot, RELEASE_LAYOUT.approvalsDir, name), 'utf8'),
      ) as { signer_key_id: string };
      return document.signer_key_id;
    });
    expect(new Set(keyIds).size).toBe(2);
  });

  it('and NOTHING in the tooling claims two humans were present', () => {
    for (const path of RELEASE_TOOLING) {
      const text = readFileSync(path, 'utf8').toLowerCase();
      expect(text, `${path} claims human custody`).not.toContain('two people');
      expect(text, `${path} claims human custody`).not.toContain('human custody is proved');
    }
  });
});
