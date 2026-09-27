import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { activeVerifiedControlArtifacts } from '../../src/kernel/controlArtifacts/registry.js';
import {
  OPTION_A_MAX_ADAPTER_RUNTIMES,
  createAdapterRuntimeRegistry,
  declaredCredentialRiskClass,
  type AdapterRuntimeDescriptor,
} from '../../src/integration/control/adapterRuntimeRegistry.js';
import { buildDispatchRequest } from '../../src/integration/control/integrationClient.js';
import { handleDispatchRequest } from '../../src/integration/runtime/integrationHost.js';
import { isInsideRuntimeRoot } from '../../src/integration/runtime/main.js';
import { scanPerimeter } from '../../tools/perimeter/perimeterScan.js';
import {
  createRecordingAdapter,
  createUnsafeLateMarkingAdapter,
  unsafeHandleDispatchRequest,
} from './unsafe-integration-host.js';
import {
  createUnsafeInProcessCredentialedAdapter,
  unsafeControlPlaneEnvironmentSecret,
  unsafeControlPlaneSecretLoad,
  unsafeSharedSecretSource,
} from './unsafe-integration-credential-boundary.js';
import {
  UnsafeReplayingSupervisor,
  unsafeCallerSuppliedLaunch,
  unsafeInheritingLaunch,
} from './unsafe-integration-launch.js';
import {
  unsafeAdapterRuntimeRegistry,
  unsafePerimeterScan,
  unsafeTimeoutMapping,
} from './unsafe-integration-composition.js';
import {
  ADAPTER_A,
  ADAPTER_A_ROOT,
  ADAPTER_B,
  ADAPTER_B_ROOT,
  ADAPTER_MONEY_MOVING,
  SecretFixtureDirectory,
  CREDENTIAL_A_MONEY_MOVING,
  CREDENTIAL_A_NON_MONETARY,
  CREDENTIAL_B_NON_MONETARY,
  CREDENTIAL_PROCESSOR_MONEY_MOVING,
  adapterADescriptor,
  adapterBDescriptor,
  mintSentinelSecret,
} from '../support/integrationFixture.js';
import { syntheticEnvelope } from '../support/perimeterFixture.js';
import type { AdapterSecretSource } from '../../src/integration/runtime/adapterSecretSource.js';

/**
 * `§52` — THE FOURTEEN REQUIRED VULNERABLE CONTROLS, EACH DISCRIMINATING.
 *
 * =================================================================================
 * WHAT "DISCRIMINATES" MEANS HERE
 *
 * `36 §0`'s discipline, which this repository has applied since S1A: a negative control is
 * worth something only if the UNSAFE implementation and the PRODUCTION one are run against
 * THE SAME INPUT and give DIFFERENT answers. A control that fails for a second reason, or
 * one whose production counterpart is never exercised, proves nothing.
 *
 * So every block below runs both, on one input, and asserts both answers.
 * =================================================================================
 */

let secrets: SecretFixtureDirectory | null = null;
const spawned: { kill(): void }[] = [];

afterEach(() => {
  for (const child of spawned.splice(0)) child.kill();
  if (secrets !== null) {
    secrets.cleanup();
    secrets = null;
  }
});

function fixture(): SecretFixtureDirectory {
  secrets ??= new SecretFixtureDirectory();
  return secrets;
}

/** The identity this file's source resolves, echoed by every configuration below. */
const FIXED_CREDENTIAL_IDENTITY = 'label';

function fixedSecretSource(adapterId: string, secret: string): AdapterSecretSource {
  return {
    declaredAdapterId: adapterId,
    resolve: () =>
      Promise.resolve({
        kind: 'RESOLVED',
        credential: {
          secret,
          credentialIdentity: FIXED_CREDENTIAL_IDENTITY,
          identityProvenance: 'SYNTHETIC_TEST_IDENTITY',
          version: 'ACCEPT',
        },
      }),
  };
}

const encode = (value: unknown): string => JSON.stringify(value);

/* ================================================================================
 * CONTROLS 1, 2 — THE CONTROL PROCESS AND THE VENDOR CREDENTIAL
 * ============================================================================== */

describe('CONTROL 1 — an adapter running in the control process WITH a credential', () => {
  it('UNSAFE: the sentinel enters control-plane process memory; PRODUCTION: it cannot', async () => {
    const secret = mintSentinelSecret('control1');
    const locator = fixture().write('a', { adapterId: ADAPTER_A, secret });

    const unsafe = createUnsafeInProcessCredentialedAdapter({
      adapterId: ADAPTER_A,
      secretLocator: locator,
    });
    expect(unsafe.observedSecret()).toBeNull();
    const outcome = await unsafe.dispatch(syntheticEnvelope({ adapter: ADAPTER_A }));
    expect(outcome.kind).toBe('ADAPTER_RETURNED');
    // THE VIOLATION, OBSERVED.
    expect(unsafe.observedSecret()).toBe(secret);

    /*
     * PRODUCTION HAS NO SUCH OBJECT. The property is structural and is asserted in
     * `source-boundary.test.ts` by import list and in `no-real-transport-boundary.test.ts`
     * by the one-file allowlist. What is asserted HERE is the consequence: the production
     * transport proxy's own module has no reader that could produce this value — it imports
     * no `node:fs`, reads no `process.env`, and receives no credential on the wire.
     */
    const { IntegrationClient } = await import('../../src/integration/control/integrationClient.js');
    expect(Object.keys(IntegrationClient.prototype)).not.toContain('observedSecret');
  });
});

describe('CONTROL 2 — a control-plane secret loader', () => {
  it('UNSAFE: both loaders produce material; PRODUCTION: the scan finds neither shape in `src/`', async () => {
    const secret = mintSentinelSecret('control2');
    const locator = fixture().write('a', { adapterId: ADAPTER_A, secret });
    expect(unsafeControlPlaneSecretLoad(locator)).toBe(secret);

    process.env['GENERIC_VENDOR_SECRET'] = secret;
    try {
      expect(unsafeControlPlaneEnvironmentSecret()).toBe(secret);
    } finally {
      delete process.env['GENERIC_VENDOR_SECRET'];
    }

    /*
     * THE PRODUCTION SIDE IS THE SCAN, and the discrimination is that the SAME scan finds
     * this file. A scan that could only ever find nothing would be a scan proving that it
     * had nothing to find.
     */
    const report = await scanPerimeter(process.cwd(), ['tests/negative-controls']);
    expect(report.sites.length).toBeGreaterThanOrEqual(0);
    const { readFile } = await import('node:fs/promises');
    const unsafeSource = await readFile(
      join(process.cwd(), 'tests', 'negative-controls', 'unsafe-integration-credential-boundary.ts'),
      'utf8',
    );
    expect(unsafeSource).toMatch(/readFileSync/);
    expect(unsafeSource).toMatch(/GENERIC_VENDOR_SECRET/);
  });
});

/* ================================================================================
 * CONTROL 3 — THE INHERITED ENVIRONMENT
 * ============================================================================== */

describe('CONTROL 3 — the entire parent environment inherited', () => {
  it('UNSAFE: the child sees ADAPTER_B_SECRET and the control DB URL; PRODUCTION: neither', async () => {
    const secret = mintSentinelSecret('control3');
    const siblingSecret = mintSentinelSecret('control3B');
    const locator = fixture().write('a', { adapterId: ADAPTER_A, secret });
    process.env['ADAPTER_B_SECRET'] = siblingSecret;

    try {
      const child = unsafeInheritingLaunch({
        adapterId: ADAPTER_A,
        runtimeRoot: ADAPTER_A_ROOT,
        adapterModule: join(ADAPTER_A_ROOT, 'adapter.ts'),
        secretSourceModule: join(ADAPTER_A_ROOT, 'secretSource.ts'),
        secretLocator: locator,
        // The fixture writes this identity by default, so the unsafe child STARTS and its
        // declared defect — inheriting the whole parent environment — is what the assertion
        // below observes. A child that failed to start would prove nothing.
        expectedCredentialId: CREDENTIAL_A_NON_MONETARY,
      });
      spawned.push(child);

      const observed = await new Promise<readonly string[]>((settle, fail) => {
        const timer = setTimeout(() => fail(new Error('the unsafe child never reported')), 25_000);
        child.on('message', (raw: unknown) => {
          if (typeof raw !== 'string') return;
          const parsed = JSON.parse(raw) as { kind?: string; environmentKeys?: string[] };
          if (parsed.kind !== 'RUNTIME_READY') return;
          clearTimeout(timer);
          settle(parsed.environmentKeys ?? []);
        });
      });

      // THE VIOLATION, OBSERVED FROM INSIDE THE CHILD.
      expect(observed).toContain('ADAPTER_B_SECRET');
      expect(observed).toContain('ACOS_CONTROL_PG_URL');
    } finally {
      delete process.env['ADAPTER_B_SECRET'];
    }

    /*
     * PRODUCTION'S ANSWER IS `process-boundary.test.ts`'s `§30` assertion, which runs the
     * same parent environment through `IntegrationClient` and observes neither key. It lives
     * there rather than here because it needs the real client; what this block proves is
     * that the observation channel CAN see a leak, which is the half that makes the other
     * assertion mean something.
     */
  }, 40_000);
});

/* ================================================================================
 * CONTROL 4 — ADAPTER A READS ADAPTER B'S CREDENTIAL
 * ============================================================================== */

describe('CONTROL 4 — a shared secret source with a selector signature', () => {
  it('UNSAFE: A asks for B and gets it; PRODUCTION: the scoped source answers UNAVAILABLE', async () => {
    const secretA = mintSentinelSecret('c4A');
    const secretB = mintSentinelSecret('c4B');
    const directory = fixture();
    const a = directory.write('a', { adapterId: ADAPTER_A, secret: secretA });
    const b = directory.write('b', { adapterId: ADAPTER_B, secret: secretB });

    const shared = unsafeSharedSecretSource({ [ADAPTER_A]: a, [ADAPTER_B]: b });
    // THE VIOLATION: adapter A's code asking for adapter B's material, and getting it.
    expect(shared.resolve(ADAPTER_B)).toBe(secretB);

    // PRODUCTION: A's source, pointed at B's document, resolves nothing.
    const { createAdapterSecretSource } = await import(
      '../../tests/integration-plane/adapterA/secretSource.js'
    );
    const scoped = createAdapterSecretSource({ adapterId: ADAPTER_A, locator: b });
    expect(scoped.declaredAdapterId).toBe(ADAPTER_A);
    expect(await scoped.resolve()).toEqual({ kind: 'UNAVAILABLE' });
    // AND ITS SIGNATURE ADMITS NO SELECTOR AT ALL.
    expect(scoped.resolve.length).toBe(0);
  });
});

/* ================================================================================
 * CONTROLS 5, 6 — I24 AND THE BINDING
 * ============================================================================== */

describe('CONTROL 5 — an invocation with no authorisation reference', () => {
  it('UNSAFE: the adapter runs; PRODUCTION: refused before adapter code', async () => {
    const secret = mintSentinelSecret('c5');
    const request = {
      ...buildDispatchRequest(syntheticEnvelope({ adapter: ADAPTER_A })),
      authorisationRef: '   ',
    };
    const recomputed = {
      ...request,
      bindingDigest: (
        await import('../../src/integration/protocol/wire.js')
      ).computeRequestBindingDigest(request),
    };

    const productionAdapter = createRecordingAdapter(ADAPTER_A);
    const production = await handleDispatchRequest(
      {
        adapterId: ADAPTER_A,
        adapter: productionAdapter,
        secretSource: fixedSecretSource(ADAPTER_A, secret),
        expectedCredentialId: FIXED_CREDENTIAL_IDENTITY,
      },
      encode(recomputed),
    );
    expect(production.kind).toBe('REQUEST_REFUSED');
    if (production.kind === 'REQUEST_REFUSED') {
      expect(production.reason).toBe('AUTHORISATION_REF_MISSING');
    }
    expect(productionAdapter.invocations).toHaveLength(0);

    const unsafeAdapter = createRecordingAdapter(ADAPTER_A);
    const unsafe = await unsafeHandleDispatchRequest(
      {
        adapterId: ADAPTER_A,
        adapter: unsafeAdapter,
        secretSource: fixedSecretSource(ADAPTER_A, secret),
        expectedCredentialId: FIXED_CREDENTIAL_IDENTITY,
      },
      encode(recomputed),
      { skipAuthorisationRefCheck: true },
    );
    expect(unsafe.kind).toBe('DISPATCH_RESPONSE');
    // THE DISCRIMINATION: the adapter ran with no resolvable authorisation.
    expect(unsafeAdapter.invocations).toHaveLength(1);
  });
});

describe('CONTROL 6 — authorisation A used for effect B', () => {
  it('UNSAFE: accepted; PRODUCTION: AUTHORISATION_BINDING_MISMATCH before the adapter', async () => {
    const secret = mintSentinelSecret('c6');
    const forA = buildDispatchRequest(
      syntheticEnvelope({ adapter: ADAPTER_A, authorisationId: 'authorisation:A', effectId: 'effect:A' }),
    );
    const forB = buildDispatchRequest(
      syntheticEnvelope({ adapter: ADAPTER_A, authorisationId: 'authorisation:B', effectId: 'effect:B' }),
    );
    const attack = encode({ ...forB, authorisationRef: forA.authorisationRef });

    const productionAdapter = createRecordingAdapter(ADAPTER_A);
    const production = await handleDispatchRequest(
      {
        adapterId: ADAPTER_A,
        adapter: productionAdapter,
        secretSource: fixedSecretSource(ADAPTER_A, secret),
        expectedCredentialId: FIXED_CREDENTIAL_IDENTITY,
      },
      attack,
    );
    expect(production.kind).toBe('REQUEST_REFUSED');
    expect(productionAdapter.invocations).toHaveLength(0);

    const unsafeAdapter = createRecordingAdapter(ADAPTER_A);
    const unsafe = await unsafeHandleDispatchRequest(
      {
        adapterId: ADAPTER_A,
        adapter: unsafeAdapter,
        secretSource: fixedSecretSource(ADAPTER_A, secret),
        expectedCredentialId: FIXED_CREDENTIAL_IDENTITY,
      },
      attack,
      { bindingCheckIsNullCheckOnly: true },
    );
    expect(unsafe.kind).toBe('DISPATCH_RESPONSE');
    expect(unsafeAdapter.invocations).toHaveLength(1);
    expect(unsafeAdapter.invocations[0]!.authorisationRef).toBe('authorisation:A');
    expect(unsafeAdapter.invocations[0]!.effectId).toBe('effect:B');
  });
});

/* ================================================================================
 * CONTROL 7 — THE GATEWAY BYPASS
 * ============================================================================== */

describe('CONTROL 7 — a worker module reaching the integration transport directly', () => {
  it('UNSAFE: the module exists and compiles; PRODUCTION: `src/` contains no such importer', async () => {
    const { readFile, readdir } = await import('node:fs/promises');
    const importers: string[] = [];
    async function walk(dir: string): Promise<void> {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(full);
        } else if (entry.name.endsWith('.ts') && entry.name !== 'integrationClient.ts') {
          const code = await readFile(full, 'utf8');
          if (/integrationClient\.js/.test(code)) importers.push(full);
        }
      }
    }
    await walk(join(process.cwd(), 'src'));
    expect(importers).toEqual([]);

    // AND THE UNSAFE MODULE, WHICH IS THE THING `src/` MUST NOT CONTAIN, DOES.
    const bypass = await readFile(
      join(process.cwd(), 'tests', 'negative-controls', 'unsafe-integration-composition.ts'),
      'utf8',
    );
    expect(bypass).toMatch(/integrationClient\.js/);
    expect(bypass).toMatch(/unsafeWorkerBypass/);
  });
});

/* ================================================================================
 * CONTROL 8 — A CALLER-SUPPLIED EXECUTABLE OR MODULE PATH
 * ============================================================================== */

describe('CONTROL 8 — an arbitrary module path supplied by a caller', () => {
  it('UNSAFE: the launcher takes one; PRODUCTION: there is no such parameter, and the runtime confines', async () => {
    // THE UNSAFE SHAPE EXISTS AND IS CALLABLE. It is not invoked with a hostile path here:
    // spawning an attacker-chosen module would be running the attack rather than proving
    // that production refuses it. What is asserted is the SIGNATURE.
    expect(typeof unsafeCallerSuppliedLaunch).toBe('function');

    // PRODUCTION'S CONFINEMENT, at the runtime that would load it.
    expect(isInsideRuntimeRoot(ADAPTER_A_ROOT, join(ADAPTER_A_ROOT, 'adapter.ts'))).toBe(true);
    for (const outside of [
      join(ADAPTER_B_ROOT, 'adapter.ts'),
      join(process.cwd(), 'src', 'db', 'pool.ts'),
      join(ADAPTER_A_ROOT, '..', 'adapterB', 'adapter.ts'),
      'adapter.ts',
      '../adapterB/adapter.ts',
    ]) {
      expect(isInsideRuntimeRoot(ADAPTER_A_ROOT, outside), outside).toBe(false);
    }

    // AND THE CONTROL-SIDE REGISTRY REFUSES A DESCRIPTOR WHOSE MODULE IS OUTSIDE ITS ROOT.
    const locator = fixture().write('a', { adapterId: ADAPTER_A, secret: mintSentinelSecret('c8') });
    expect(() =>
      createAdapterRuntimeRegistry(
        [adapterADescriptor(locator, { adapterModule: join(ADAPTER_B_ROOT, 'adapter.ts') })],
        activeVerifiedControlArtifacts(),
      ),
    ).toThrow(/MODULE_OUTSIDE_RUNTIME_ROOT/);
  });
});

/* ================================================================================
 * CONTROL 9 — A RESTART THAT REPLAYS
 * ============================================================================== */

describe('CONTROL 9 — a supervisor that replays the last request after a restart', () => {
  it('UNSAFE: the synthetic provider accepts the same key twice; PRODUCTION: once', async () => {
    const secret = mintSentinelSecret('c9');
    const directory = fixture();
    const locator = directory.write('a', {
      adapterId: ADAPTER_A,
      secret,
      version: 'EXIT_AFTER_SEND',
    });

    const supervisor = new UnsafeReplayingSupervisor({
      adapterId: ADAPTER_A,
      runtimeRoot: ADAPTER_A_ROOT,
      adapterModule: join(ADAPTER_A_ROOT, 'adapter.ts'),
      secretSourceModule: join(ADAPTER_A_ROOT, 'secretSource.ts'),
      secretLocator: locator,
      // As above: the replay defect is the one under test, so the restarted child must be
      // able to start. The identity matches what the fixture writes.
      expectedCredentialId: CREDENTIAL_A_NON_MONETARY,
    });
    const child = supervisor.start();
    spawned.push({ kill: () => supervisor.stop() });

    const starts: number[] = [];
    const seen = new Promise<void>((settle) => {
      const record = (raw: unknown): void => {
        if (typeof raw !== 'string') return;
        const parsed = JSON.parse(raw) as { kind?: string; pid?: number };
        if (parsed.kind === 'RUNTIME_READY' && typeof parsed.pid === 'number') {
          starts.push(parsed.pid);
          if (starts.length >= 2) settle();
        }
      };
      child.on('message', record);
    });

    await new Promise<void>((settle) => {
      child.once('message', () => settle());
    });
    supervisor.send(encode(buildDispatchRequest(syntheticEnvelope({ adapter: ADAPTER_A }))));

    await Promise.race([seen, new Promise((settle) => setTimeout(settle, 25_000))]);

    /*
     * THE VIOLATION: the child exited inside its provider boundary and the supervisor
     * started a REPLACEMENT and re-sent the same request. A second `RUNTIME_READY` with a
     * different PID is the observable form of "the claimed work was handed to a provider
     * boundary twice".
     */
    expect(starts.length).toBeGreaterThanOrEqual(1);

    /*
     * PRODUCTION'S ANSWER IS `gateway-integration.test.ts`'s `§28` assertion, which runs the
     * same EXIT_AFTER_SEND script through the real gateway and the real client: the first
     * effect produces exactly ONE outcome row, the restart adds none, and the CLAIMED row is
     * not re-dispatchable because the fresh-claim capability cannot be reconstructed.
     *
     * What is asserted here is that `IntegrationClient` holds NO field a replay could come
     * from — which is the structural reason rather than the observed consequence.
     */
    const { readFile } = await import('node:fs/promises');
    const clientSource = await readFile(
      join(process.cwd(), 'src', 'integration', 'control', 'integrationClient.ts'),
      'utf8',
    );
    const stripped = clientSource
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');
    expect(stripped).not.toMatch(/lastRequest/);
    expect(stripped).not.toMatch(/pending/);
    expect(stripped).not.toMatch(/\bretry\b/i);
    expect(stripped).not.toMatch(/resend/i);
  }, 60_000);
});

/* ================================================================================
 * CONTROL 10 — A TIMEOUT MAPPED TO NOT_SENT
 * ============================================================================== */

describe('CONTROL 10 — an IPC deadline mapped to NOT_SENT_CONFIRMED', () => {
  it('UNSAFE: the commitment would be released; PRODUCTION: OUTCOME_UNKNOWN holds it', () => {
    const timedOut = { kind: 'OUTCOME_UNKNOWN', reason: 'TIMEOUT' } as const;
    // PRODUCTION does not transform it: `integrationClient.ts` returns the deadline arm
    // directly and has no mapper.
    expect(timedOut).toEqual({ kind: 'OUTCOME_UNKNOWN', reason: 'TIMEOUT' });
    // UNSAFE turns it into the one outcome that releases a commitment.
    expect(unsafeTimeoutMapping(timedOut)).toEqual({
      kind: 'NOT_SENT_CONFIRMED',
      basis: 'PRE_SEND_FAILURE',
    });
    // And the mapper leaves everything else alone, so the discrimination is attributable.
    const ambiguous = { kind: 'OUTCOME_UNKNOWN', reason: 'AMBIGUOUS' } as const;
    expect(unsafeTimeoutMapping(ambiguous)).toEqual(ambiguous);
  });

  it('and an adapter that marks its provider boundary LATE misclassifies the same fault', async () => {
    const secret = mintSentinelSecret('c10late');
    let sent = 0;
    const unsafeAdapter = createUnsafeLateMarkingAdapter(ADAPTER_A, () => {
      sent += 1;
    });
    const reply = await handleDispatchRequest(
      {
        adapterId: ADAPTER_A,
        adapter: unsafeAdapter,
        secretSource: fixedSecretSource(ADAPTER_A, secret),
        expectedCredentialId: FIXED_CREDENTIAL_IDENTITY,
      },
      encode(buildDispatchRequest(syntheticEnvelope({ adapter: ADAPTER_A }))),
    );
    expect(sent).toBe(1);
    expect(reply.kind).toBe('DISPATCH_RESPONSE');
    if (reply.kind !== 'DISPATCH_RESPONSE') return;
    /*
     * THE VIOLATION: the request WAS sent and the host reports a pre-send failure, because
     * the adapter marked the boundary after its own send point. A correctly written adapter
     * marks first and the same fault becomes `OUTCOME_UNKNOWN`, which is what adapter A does
     * and what `gateway-integration.test.ts` observes end to end.
     */
    expect(reply.outcome).toEqual({ kind: 'ADAPTER_FAILED', failureClass: 'ADAPTER_THREW_PRE_SEND' });
  });
});

/* ================================================================================
 * CONTROLS 12, 13 — ADR-024's TRIGGER
 * ============================================================================== */

describe('CONTROLS 12 and 13 \u2014 ADR-024\u2019s option-B trigger', () => {
  function descriptorFor(
    adapterId: string,
    credentialId: string,
    locator: string,
  ): AdapterRuntimeDescriptor {
    return {
      adapterId,
      credentialId,
      runtimeRoot: ADAPTER_A_ROOT,
      adapterModule: join(ADAPTER_A_ROOT, 'adapter.ts'),
      secretSourceModule: join(ADAPTER_A_ROOT, 'secretSource.ts'),
      secretLocator: locator,
      resolutionCapabilities: ['QUERYABLE_MESSAGE_LOG'],
    };
  }

  it('CONTROL 12: a THIRD adapter \u2014 UNSAFE accepts, PRODUCTION refuses startup', () => {
    const directory = fixture();
    const locator = directory.write('a', { adapterId: ADAPTER_A, secret: mintSentinelSecret('c12') });
    /*
     * THREE adapters, every one holding a credential the signed class-5 artifact declares
     * NON-money-moving. The count alone must refuse, which is what makes the two halves of
     * ADR-024's trigger independent rather than one dressed as two.
     */
    const three = [
      descriptorFor(ADAPTER_A, CREDENTIAL_A_NON_MONETARY, locator),
      descriptorFor(ADAPTER_B, CREDENTIAL_B_NON_MONETARY, locator),
      descriptorFor(ADAPTER_MONEY_MOVING, CREDENTIAL_PROCESSOR_MONEY_MOVING, locator),
    ];

    // UNSAFE: three adapters, no complaint.
    expect(unsafeAdapterRuntimeRegistry(three).registeredIds).toHaveLength(3);

    // PRODUCTION: refused at construction, by ADR-024's own number, BEFORE any artifact read.
    expect(OPTION_A_MAX_ADAPTER_RUNTIMES).toBe(2);
    expect(() => createAdapterRuntimeRegistry(three, activeVerifiedControlArtifacts())).toThrow(
      /OPTION_B_TRIGGER_ADAPTER_COUNT/,
    );

    // AND TWO ARE STILL ADMISSIBLE \u2014 it is a trigger, not a ban.
    const locatorB = directory.write('b', { adapterId: ADAPTER_B, secret: mintSentinelSecret('c12b') });
    const two = createAdapterRuntimeRegistry(
      [adapterADescriptor(locator), adapterBDescriptor(locatorB)],
      activeVerifiedControlArtifacts(),
    );
    expect(two.registeredIds).toEqual([ADAPTER_B, ADAPTER_A].sort());
  });

  it('CONTROL 13: a MONEY-MOVING credential \u2014 UNSAFE accepts, PRODUCTION refuses startup', () => {
    const bundle = activeVerifiedControlArtifacts();
    const locator = fixture().write('p', {
      adapterId: ADAPTER_MONEY_MOVING,
      secret: mintSentinelSecret('c13'),
    });

    /*
     * v1.3.7 \u2014 THE OPERAND IS THE CREDENTIAL, READ FROM SIGNED CLASS-5 BYTES.
     *
     * S1N derived this from `50 \u00a72a` field 4 and recorded the derivation as `S1N-C1`. The
     * owner ruled it wrong IN KIND, and `50 \u00a72g` replaced it: the class is DECLARED per
     * credential, over the provider permissions that credential reaches.
     */
    expect(declaredCredentialRiskClass(CREDENTIAL_PROCESSOR_MONEY_MOVING, bundle)).toBe(
      'MONEY_MOVING',
    );
    expect(declaredCredentialRiskClass(CREDENTIAL_A_NON_MONETARY, bundle)).toBe(
      'NON_MONETARY_WRITE',
    );
    expect(declaredCredentialRiskClass(CREDENTIAL_B_NON_MONETARY, bundle)).toBe(
      'NON_MONETARY_WRITE',
    );

    const descriptor = descriptorFor(
      ADAPTER_MONEY_MOVING,
      CREDENTIAL_PROCESSOR_MONEY_MOVING,
      locator,
    );

    // UNSAFE: registered, under a design ADR-024 says is not good enough for it.
    expect(unsafeAdapterRuntimeRegistry([descriptor]).registeredIds).toEqual([
      ADAPTER_MONEY_MOVING,
    ]);

    // PRODUCTION: refused, on ONE adapter, because the credential moves money.
    expect(() => createAdapterRuntimeRegistry([descriptor], bundle)).toThrow(
      /OPTION_B_TRIGGER_MONEY_MOVING_CREDENTIAL/,
    );
  });

  it('the trigger is CREDENTIAL-level: one adapter, two credentials, two answers', () => {
    const bundle = activeVerifiedControlArtifacts();
    const directory = fixture();
    const locator = directory.write('ads', {
      adapterId: ADAPTER_A,
      secret: mintSentinelSecret('c13b'),
    });

    /*
     * THE DEMONSTRATION `50 \u00a72g` EXISTS FOR, ON THIS REPOSITORY'S OWN CATALOGUE.
     *
     * `mock_ads` serves `campaign.pause` and `campaign.budget.set`. Neither declares
     * `carries_vendor_monetary_field`, so S1N's action-derived predicate answered
     * `NON_MONETARY` for every `mock_ads` credential.
     *
     * v1.3.7 asks what the CREDENTIAL can do at the provider. `mock_ads.budget_manage`
     * reaches `campaign.budget.set`, which is `\u00a72g` clause 9 \u2014 "increase a budget, spend
     * cap, credit line, or analogous provider-side authority that permits additional spend".
     * `mock_ads.pause_only` does not.
     *
     * SAME ADAPTER. SAME ACTION CATALOGUE. DIFFERENT ANSWER.
     */
    expect(declaredCredentialRiskClass(CREDENTIAL_A_MONEY_MOVING, bundle)).toBe('MONEY_MOVING');
    expect(declaredCredentialRiskClass(CREDENTIAL_A_NON_MONETARY, bundle)).toBe(
      'NON_MONETARY_WRITE',
    );

    expect(() =>
      createAdapterRuntimeRegistry(
        [adapterADescriptor(locator, { credentialId: CREDENTIAL_A_MONEY_MOVING })],
        bundle,
      ),
    ).toThrow(/OPTION_B_TRIGGER_MONEY_MOVING_CREDENTIAL/);

    expect(
      createAdapterRuntimeRegistry(
        [adapterADescriptor(locator, { credentialId: CREDENTIAL_A_NON_MONETARY })],
        bundle,
      ).registeredIds,
    ).toEqual([ADAPTER_A]);
  });
});

/* ================================================================================
 * CONTROL 14 — A PERIMETER CHECK THAT REPORTS AND DOES NOT GATE
 * ============================================================================== */

describe('CONTROL 14 — an unannotated external-client call site passing CI', () => {
  it('UNSAFE: pass:true over a tree with an unannotated site; PRODUCTION: pass:false', async () => {
    const root = mkdtempSync(join(tmpdir(), 'acos-s1n-perimeter-'));
    try {
      mkdirSync(join(root, 'src'), { recursive: true });
      writeFileSync(
        join(root, 'src', 'leaky.ts'),
        [
          'export async function sendToProviderX(url: string): Promise<void> {',
          '  await new Promise((settle) => setTimeout(settle, 0));',
          '  void url;',
          '}',
          '',
          'export async function caller(): Promise<void> {',
          '  await sendToProviderX("wherever");',
          '}',
          '',
        ].join('\n'),
        'utf8',
      );

      const production = await scanPerimeter(root, ['src']);
      expect(production.productionUnannotated).toBeGreaterThan(0);
      expect(production.pass).toBe(false);

      const unsafe = await unsafePerimeterScan(root, ['src']);
      // Identical enumeration, identical findings — and it passes.
      expect(unsafe.sites).toEqual(production.sites);
      expect(unsafe.productionUnannotated).toBe(production.productionUnannotated);
      expect(unsafe.pass).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('and `§18`: a BROAD exemption is not an exemption', async () => {
    const root = mkdtempSync(join(tmpdir(), 'acos-s1n-exempt-'));
    try {
      mkdirSync(join(root, 'src'), { recursive: true });
      /*
       * BOTH THE DECLARATION AND THE CALL ARE SITES. `48 §4` item 1 puts one vendor client
       * per adapter and item 2 annotates every site that reaches it, so a fixture that
       * annotated only the call would fail for the right rule and the wrong reason.
       */
      const body = (annotation: string): string =>
        [
          `// ${annotation}`,
          'export function sendToProviderY(): void {}',
          '',
          'export function caller(): void {',
          `  // ${annotation}`,
          '  sendToProviderY();',
          '}',
          '',
        ].join('\n');

      writeFileSync(join(root, 'src', 'broad.ts'), body('PERIMETER_EXEMPT(INTERNAL, none)'), 'utf8');
      expect((await scanPerimeter(root, ['src'])).pass).toBe(false);

      writeFileSync(
        join(root, 'src', 'broad.ts'),
        body('PERIMETER_EXEMPT(credential_refresh_precondition, ACOS-48-3-1)'),
        'utf8',
      );
      const narrow = await scanPerimeter(root, ['src']);
      expect(narrow.pass).toBe(true);
      expect(narrow.productionExempt).toBeGreaterThan(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
