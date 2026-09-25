import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { runPostmarkSandboxCli } from '../../tools/postmark-sandbox/cli.js';
import {
  AUDIT_READ_CREDENTIAL_KEY,
  CONTROL_SEND_CREDENTIAL_KEY,
  EXPECTED_DELIVERY_TYPE_KEY,
  OPEN_ARCHITECTURE_PRECONDITIONS,
  OPERATOR_REQUIREMENTS,
  REFUSED_CONFIGURATION_KEYS,
  REQUIRED_DELIVERY_TYPE,
  evaluatePostmarkSandboxReadiness,
  renderPostmarkGateResult,
} from '../../tools/postmark-sandbox/gate.js';
import {
  REFUSED_KEYS,
  TRUSTED_API_ORIGIN_FOR_COMPARISON,
  unsafeAcceptsDeliveryType,
  unsafeAuditCredentialSlot,
  unsafeCapabilityRecord,
  unsafeReadinessWithCallerToken,
  unsafeResolveApiOrigin,
} from '../negative-controls/unsafe-postmark-sandbox-gate.js';
import {
  auditPlaneEnv,
  bothPlanesEnv,
  completeReleaseFixture,
  controlPlaneEnv,
  scratchDirectory,
} from '../support/releaseCeremonyFixture.js';

/**
 * `§37`, `§52`, `§53` — THE S1M PROVIDER-SANDBOX READINESS GATE.
 *
 * =================================================================================
 * THE GATE IS NOT_READY IN THIS REPOSITORY AND THE TESTS SAY SO OUT LOUD
 *
 * `§52`: "It must fail/abort clearly if credentials are absent. It must NOT silently SKIP."
 *
 * So there is no `it.skipIf` anywhere below, no conditional describe and no environment
 * probe that decides whether to assert. The gate's verdict in this repository is
 * `NOT_READY`, that verdict is asserted directly, and the findings that produce it are
 * asserted individually — because "not ready" for the wrong reason would be a passing test
 * concealing a regression.
 * =================================================================================
 */

const PRECONDITION_CODES = OPEN_ARCHITECTURE_PRECONDITIONS.map((row) => row.code);

/** An environment in which BOTH planes verify, so S1M's own rows are what is being tested. */
function planesReadyEnv(label: string): Readonly<Record<string, string>> {
  const fixture = completeReleaseFixture({ dir: scratchDirectory(`acos-s1m-${label}-`) });
  return bothPlanesEnv(fixture.controlEnv, fixture.auditEnv);
}

/** The same, but with a deliberately wrong control-plane pin — `§53` row 13. */
function wrongPinEnv(label: string): Readonly<Record<string, string>> {
  const fixture = completeReleaseFixture({ dir: scratchDirectory(`acos-s1m-${label}-`) });
  return bothPlanesEnv(
    controlPlaneEnv(fixture.completed, fixture.controlPackageRoot, 'a'.repeat(64)),
    fixture.auditEnv,
  );
}

const codesOf = async (
  source: Readonly<Record<string, string | undefined>>,
): Promise<readonly string[]> =>
  (await evaluatePostmarkSandboxReadiness(source)).findings.map((finding) => finding.code);

describe('§52 — the gate refuses, and it refuses for the reasons this repository actually has', () => {
  it('an empty environment is NOT_READY, and never a skip', async () => {
    const result = await evaluatePostmarkSandboxReadiness({});
    expect(result.status).toBe('NOT_READY');
    expect(result.findings.length).toBeGreaterThan(0);
  });

  it('the status union has exactly two members and neither is an "inapplicable"', async () => {
    // A third member is how a gate acquires a way of passing without passing.
    const rendered = renderPostmarkGateResult(await evaluatePostmarkSandboxReadiness({}));
    expect(rendered).toContain('RESULT: NOT_READY');
    for (const forbidden of ['SKIPPED', 'INAPPLICABLE', 'NOT_APPLICABLE', 'PRODUCTION_READY']) {
      expect(rendered, `the report contains ${forbidden}`).not.toContain(forbidden);
    }
  });

  it('the CLI exits NON-ZERO, so a CI job cannot mistake a refusal for a pass', async () => {
    const chunks: string[] = [];
    const original = process.stdout.write.bind(process.stdout);
    (process.stdout as unknown as { write: (value: string) => boolean }).write = (value) => {
      chunks.push(value);
      return true;
    };
    try {
      expect(await runPostmarkSandboxCli({})).toBe(1);
    } finally {
      (process.stdout as unknown as { write: typeof original }).write = original;
    }
    expect(chunks.join('')).toContain('NOT_READY');
  });

  it('and it prints the slots an operator must provide, naming no value', async () => {
    const rendered = renderPostmarkGateResult(await evaluatePostmarkSandboxReadiness({}));
    for (const requirement of OPERATOR_REQUIREMENTS) {
      expect(rendered).toContain(requirement);
    }
    expect(rendered).toContain(CONTROL_SEND_CREDENTIAL_KEY);
    expect(rendered).toContain(AUDIT_READ_CREDENTIAL_KEY);
  });
});

describe('§3, §35, §45 — VULNERABLE CONTROL 1: a live server accepted as a sandbox', () => {
  it('an UNDECLARED delivery type is a refusal, not a default', async () => {
    expect(await codesOf({})).toContain('PROVIDER_DELIVERY_TYPE_UNDECLARED');
  });

  it('a delivery type declared LIVE is refused', async () => {
    const codes = await codesOf({ [EXPECTED_DELIVERY_TYPE_KEY]: 'Live' });
    expect(codes).toContain('PROVIDER_DELIVERY_TYPE_NOT_SANDBOX');
    expect(codes).not.toContain('PROVIDER_DELIVERY_TYPE_UNDECLARED');
  });

  it('only the exact declared value clears the row — no case folding, no prefix match', async () => {
    for (const near of ['sandbox', 'SANDBOX', 'Sandbox ', 'Sandbox,Live', 'LiveSandbox']) {
      expect(
        await codesOf({ [EXPECTED_DELIVERY_TYPE_KEY]: near }),
        `"${near}" was accepted`,
      ).toContain('PROVIDER_DELIVERY_TYPE_NOT_SANDBOX');
    }
    expect(await codesOf({ [EXPECTED_DELIVERY_TYPE_KEY]: REQUIRED_DELIVERY_TYPE })).not.toContain(
      'PROVIDER_DELIVERY_TYPE_NOT_SANDBOX',
    );
  });
});

describe('§30, §45 — VULNERABLE CONTROLS 3 and the live toggle: refused configuration', () => {
  it('each refused key is a finding on its own', async () => {
    for (const refused of REFUSED_CONFIGURATION_KEYS) {
      const codes = await codesOf({ [refused.key]: 'x' });
      expect(codes, `${refused.key} was not refused`).toContain('REFUSED_CONFIGURATION_PRESENT');
    }
  });

  it('a caller-supplied API origin is REFUSED rather than honoured', async () => {
    /*
     * `§30`: "Do not ship SSRF-like arbitrary base URL selection in production." The gate has
     * no code path that reads this variable into an origin — its presence is the finding.
     */
    const result = await evaluatePostmarkSandboxReadiness({
      POSTMARK_API_BASE_URL: 'https://attacker.example',
    });
    expect(result.findings.map((f) => f.code)).toContain('REFUSED_CONFIGURATION_PRESENT');
    expect(renderPostmarkGateResult(result)).not.toContain('attacker.example');
  });

  it('a live-server toggle does not enable anything — its presence is the finding', async () => {
    expect(await codesOf({ POSTMARK_ALLOW_LIVE: 'true' })).toContain('REFUSED_CONFIGURATION_PRESENT');
    expect(await codesOf({ POSTMARK_ALLOW_LIVE: 'false' })).toContain('REFUSED_CONFIGURATION_PRESENT');
  });
});

describe('§7, §27 — VULNERABLE CONTROL 9: the audit plane borrowing the control credential', () => {
  it('both slots absent is two findings, not one', async () => {
    const codes = await codesOf({});
    expect(codes).toContain('CONTROL_SEND_CREDENTIAL_ABSENT');
    expect(codes).toContain('AUDIT_READ_CREDENTIAL_ABSENT');
  });

  it('the SAME credential in both slots is refused as non-independent', async () => {
    const codes = await codesOf({
      [CONTROL_SEND_CREDENTIAL_KEY]: 'the-same-value',
      [AUDIT_READ_CREDENTIAL_KEY]: 'the-same-value',
    });
    expect(codes).toContain('AUDIT_CREDENTIAL_NOT_INDEPENDENT');
  });

  it('two DISTINCT values clear that row, and the gate says so in the report', async () => {
    const result = await evaluatePostmarkSandboxReadiness({
      [CONTROL_SEND_CREDENTIAL_KEY]: 'control-value',
      [AUDIT_READ_CREDENTIAL_KEY]: 'audit-value',
    });
    expect(result.findings.map((f) => f.code)).not.toContain('AUDIT_CREDENTIAL_NOT_INDEPENDENT');
    expect(result.credentialSlotsDistinct).toBe(true);
  });

  it('distinctness is NOT sufficient — the provider limitation stands regardless', async () => {
    /*
     * `§7`: "never pretend independence that Postmark cannot provide." Two distinct tokens
     * are two SEPARATELY PROVISIONED credentials with IDENTICAL capability, and `36 §13`'s
     * replica-read test asks for read-only, not for distinct.
     */
    const codes = await codesOf({
      [CONTROL_SEND_CREDENTIAL_KEY]: 'control-value',
      [AUDIT_READ_CREDENTIAL_KEY]: 'audit-value',
    });
    expect(codes).toContain('AUDIT_PROVIDER_READ_CREDENTIAL_NOT_LEAST_PRIVILEGE');
  });

  it('the rule is not vacuous — an unsafe record calling that token read-only clears the row', async () => {
    const cleared = await evaluatePostmarkSandboxReadiness(
      {},
      unsafeCapabilityRecord('SEND_CAPABLE_TOKEN_RECORDED_AS_READ_ONLY'),
    );
    expect(cleared.findings.map((f) => f.code)).not.toContain(
      'AUDIT_PROVIDER_READ_CREDENTIAL_NOT_LEAST_PRIVILEGE',
    );
  });
});

describe('§29 — VULNERABLE CONTROL 11: the credential reaching a log', () => {
  const SECRET = 'pm-sandbox-token-0123456789abcdef';
  const AUDIT_SECRET = 'pm-sandbox-audit-fedcba9876543210';

  it('neither credential value appears in the rendered report', async () => {
    const rendered = renderPostmarkGateResult(
      await evaluatePostmarkSandboxReadiness({
        [EXPECTED_DELIVERY_TYPE_KEY]: REQUIRED_DELIVERY_TYPE,
        [CONTROL_SEND_CREDENTIAL_KEY]: SECRET,
        [AUDIT_READ_CREDENTIAL_KEY]: AUDIT_SECRET,
      }),
    );
    expect(rendered).not.toContain(SECRET);
    expect(rendered).not.toContain(AUDIT_SECRET);
    // Presence is reported as a WORD, which is the whole of what the gate needs to know.
    expect(rendered).toContain('control send credential  : present');
    expect(rendered).toContain('audit read credential    : present');
  });

  it('nor in the returned result object, nor in its digest form', async () => {
    /*
     * The comparison digest exists so two slots can be compared. It is not returned, because
     * a digest of a high-entropy credential is still a credential-derived value and there is
     * no reason for one to travel.
     */
    const serialised = JSON.stringify(
      await evaluatePostmarkSandboxReadiness({
        [CONTROL_SEND_CREDENTIAL_KEY]: SECRET,
        [AUDIT_READ_CREDENTIAL_KEY]: AUDIT_SECRET,
      }),
    );
    expect(serialised).not.toContain(SECRET);
    expect(serialised).not.toContain(AUDIT_SECRET);
    expect(serialised).not.toMatch(/[0-9a-f]{64}.*digest/);
  });

  it('the rule is not vacuous — the unsafe renderer DOES print it', async () => {
    const { unsafeRenderWithCredential } = await import(
      '../negative-controls/unsafe-postmark-sandbox-gate.js'
    );
    expect(unsafeRenderWithCredential({ [CONTROL_SEND_CREDENTIAL_KEY]: SECRET })).toContain(SECRET);
  });
});

describe('§8, §37 — the sole write entry, and the preconditions no variable can clear', () => {
  it('production’s adapter registry is EMPTY, so no external write can leave by any path', async () => {
    const result = await evaluatePostmarkSandboxReadiness({});
    expect(result.registeredAdapterIds).toEqual([]);
    expect(result.findings.map((f) => f.code)).toContain('COMMUNICATIONS_ADAPTER_ABSENT');
  });

  it('every open architecture precondition is reported, with its owning slice', async () => {
    const result = await evaluatePostmarkSandboxReadiness({});
    const codes = result.findings.map((f) => f.code);
    for (const code of PRECONDITION_CODES) expect(codes).toContain(code);
    const rendered = renderPostmarkGateResult(result);
    for (const row of OPEN_ARCHITECTURE_PRECONDITIONS) {
      expect(rendered).toContain(`[owning slice ${row.owningSlice}]`);
    }
  });

  it('a FULLY configured environment is still NOT_READY, and only the preconditions remain', async () => {
    /*
     * THE DECISIVE ASSERTION OF THIS FILE. An operator who supplies every variable the gate
     * asks for still does not get readiness, because the remaining findings are mechanisms
     * this repository has not built. `§6`: "If that runtime mechanism is not yet implemented
     * sufficiently for a real provider token: RETURN PARTIAL. Do not invent a shortcut."
     */
    const result = await evaluatePostmarkSandboxReadiness({
      ...planesReadyEnv('full'),
      [EXPECTED_DELIVERY_TYPE_KEY]: REQUIRED_DELIVERY_TYPE,
      [CONTROL_SEND_CREDENTIAL_KEY]: 'control-value',
      [AUDIT_READ_CREDENTIAL_KEY]: 'audit-value',
    });
    expect(result.status).toBe('NOT_READY');
    expect(result.findings.map((f) => f.code).sort()).toEqual(
      [
        'AUDIT_PROVIDER_READ_CREDENTIAL_NOT_LEAST_PRIVILEGE',
        'COMMUNICATIONS_ADAPTER_ABSENT',
        ...PRECONDITION_CODES,
      ].sort(),
    );
  });

  it('the preconditions are attributed to S2 and S3, which is where `37 §2` puts them', async () => {
    const slices = new Set(OPEN_ARCHITECTURE_PRECONDITIONS.map((row) => row.owningSlice));
    expect([...slices].sort()).toEqual(['S2', 'S3']);
  });
});

describe('§37, §53 rows 13 and 14 — the release rows are the pre-live gate’s, not re-decided here', () => {
  it('both planes on the same verified release clear every PRELIVE row', async () => {
    const codes = await codesOf(planesReadyEnv('ready'));
    expect(codes.filter((code) => code.startsWith('PRELIVE_'))).toEqual([]);
  });

  it('VULNERABLE CONTROL 13 — an old signed release under the wrong pin does not clear them', async () => {
    const codes = await codesOf(wrongPinEnv('pin'));
    expect(codes.some((code) => code.startsWith('PRELIVE_'))).toBe(true);
  });

  it('VULNERABLE CONTROL 14 — a partial rollout is NOT treated as READY', async () => {
    /*
     * The two releases must differ in `manifest_epoch`, because the ceremony is
     * DETERMINISTIC: the same six artifacts under the same two keys produce the same
     * `manifest_id` however many times they are built, which is a property S1L asserts
     * directly. A "partial rollout" of two byte-identical releases is not a partial rollout.
     */
    const control = completeReleaseFixture({
      dir: scratchDirectory('acos-s1m-splitc-'),
      manifestEpoch: '1',
    });
    const audit = completeReleaseFixture({
      dir: scratchDirectory('acos-s1m-splita-'),
      manifestEpoch: '2',
    });
    const codes = await codesOf(
      bothPlanesEnv(
        controlPlaneEnv(control.completed, control.controlPackageRoot),
        auditPlaneEnv(audit.completed, audit.auditPackageRoot),
      ),
    );
    expect(codes.some((code) => code.startsWith('PRELIVE_'))).toBe(true);
  });
});

describe('§3, §9, §30 — the unsafe branches ACCEPT what the gate REFUSES', () => {
  it('VULNERABLE CONTROL 1 — the permissive reader accepts a LIVE declaration', async () => {
    const live = { [EXPECTED_DELIVERY_TYPE_KEY]: 'Live' };
    expect(unsafeAcceptsDeliveryType(live, 'LIVE_SERVER_ACCEPTED_AS_SANDBOX')).toBe(true);
    expect(await codesOf(live)).toContain('PROVIDER_DELIVERY_TYPE_NOT_SANDBOX');
  });

  it('VULNERABLE CONTROL 1 — the defaulting reader accepts an ABSENT declaration', async () => {
    expect(unsafeAcceptsDeliveryType({}, 'UNDECLARED_DELIVERY_TYPE_DEFAULTED_TO_SANDBOX')).toBe(
      true,
    );
    expect(await codesOf({})).toContain('PROVIDER_DELIVERY_TYPE_UNDECLARED');
  });

  it('VULNERABLE CONTROL 2 — the unsafe shape HAS a caller-token parameter; production has none', async () => {
    /*
     * `§9`: "The model/worker must not supply: Postmark token [...]". The defect is that the
     * parameter exists at all, so the discrimination is on the SIGNATURE: the unsafe function
     * takes two arguments and uses the second; `evaluatePostmarkSandboxReadiness` takes an
     * environment source and a capability record, and neither can carry a credential the
     * caller chose.
     */
    expect(unsafeReadinessWithCallerToken({}, 'caller-chosen-token').tokenUsed).toBe(
      'caller-chosen-token',
    );
    // The unsafe shape REQUIRES a token argument; `Function.length` counts parameters before
    // the first default, so a required credential parameter is visible as a non-zero arity.
    expect(unsafeReadinessWithCallerToken.length).toBe(2);
    // Production requires none: both its parameters are defaulted, and neither is a credential.
    expect(evaluatePostmarkSandboxReadiness.length).toBe(0);
    // And the second production parameter is the capability RECORD, which carries no token.
    const record = (await evaluatePostmarkSandboxReadiness({})).capability;
    expect(JSON.stringify(record)).not.toContain('caller-chosen-token');
  });

  it('VULNERABLE CONTROL 3 — the unsafe resolver DIALS the caller origin; the gate refuses it', async () => {
    const hostile = { POSTMARK_API_BASE_URL: 'https://attacker.example' };
    expect(unsafeResolveApiOrigin(hostile)).toBe('https://attacker.example');
    expect(unsafeResolveApiOrigin({})).toBe(TRUSTED_API_ORIGIN_FOR_COMPARISON);
    expect(await codesOf(hostile)).toContain('REFUSED_CONFIGURATION_PRESENT');
    expect(REFUSED_KEYS).toContain('POSTMARK_API_BASE_URL');
  });

  it('VULNERABLE CONTROL 9 — the unsafe slot FALLS BACK to the send credential', async () => {
    const oneCredential = { [CONTROL_SEND_CREDENTIAL_KEY]: 'control-value' };
    // The defect: an empty audit slot silently becomes the send credential.
    expect(unsafeAuditCredentialSlot(oneCredential)).toBe('control-value');
    // Production: an empty audit slot is a finding, and never a fallback.
    expect(await codesOf(oneCredential)).toContain('AUDIT_READ_CREDENTIAL_ABSENT');
  });
});

describe('§49 — no other real provider, and no new dependency, is introduced', () => {
  it('the dependency set is unchanged — no SDK, no HTTP client, no second vendor', async () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as {
      dependencies: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const all = Object.keys({ ...pkg.dependencies, ...(pkg.devDependencies ?? {}) });
    for (const forbidden of [
      'postmark',
      'stripe',
      'shopify',
      'mailgun',
      'sendgrid',
      'aws-sdk',
      '@aws-sdk',
      'axios',
      'undici',
      'node-fetch',
      'got',
      'superagent',
    ]) {
      expect(
        all.some((name) => name.toLowerCase().includes(forbidden)),
        `a dependency matching ${forbidden} was added`,
      ).toBe(false);
    }
  });

  it('the provider verify command exists and is wired to the S1M CLI', async () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts['verify:postmark-sandbox']).toBe('tsx tools/postmark-sandbox/cli.ts');
  });
});

describe('§43, §44 — the gate closes nothing, and says so', () => {
  it('it never names I36, I20 or I8 as closed, and never claims exactly-once', async () => {
    const rendered = renderPostmarkGateResult(await evaluatePostmarkSandboxReadiness(planesReadyEnv('claims')));
    expect(rendered).toContain('closes none of them');
    for (const forbidden of [
      'exactly-once',
      'exactly once',
      'I36 CLOSED',
      'I20 CLOSED',
      'I8 CLOSED',
      'VERIFIED BY PROVIDER',
    ]) {
      expect(rendered, `the report claims ${forbidden}`).not.toContain(forbidden);
    }
  });
});
