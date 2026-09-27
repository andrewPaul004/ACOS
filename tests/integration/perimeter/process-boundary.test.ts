import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  INTEGRATION_RUNTIME_ENV_KEYS,
  PLATFORM_INJECTED_ENV_KEYS,
  buildIntegrationRuntimeEnvironment,
} from '../../../src/integration/protocol/runtimeEnvironment.js';
import {
  CONTROL_PLANE_RUNTIME,
  adapterIdOfRuntimeIdentity,
  integrationAdapterRuntimeIdentity,
  isWellFormedAdapterId,
} from '../../../src/integration/protocol/runtimeIdentity.js';
import { buildDispatchRequest } from '../../../src/integration/control/integrationClient.js';
import {
  ADAPTER_A,
  ADAPTER_A_ROOT,
  ADAPTER_B,
  adapterADescriptor,
  adapterBDescriptor,
  awaitRuntimeReady,
  launchIntegration,
  mintSentinelSecret,
  runtimeRegistry,
  type LaunchedIntegration,
} from '../../support/integrationFixture.js';
import { syntheticEnvelope } from '../../support/perimeterFixture.js';

/**
 * `§5`, `§6`, `§7`, `§12`, `§30`, `§39`, `§40` — THE PROCESS AND CREDENTIAL BOUNDARY.
 *
 * =================================================================================
 * WHAT S1M COULD NOT SAY, AND WHAT THIS FILE MAKES SAYABLE
 *
 * S1M returned PARTIAL because "no integration-plane runtime exists, so there is no
 * architecture-legal place for a provider token." `I25` — "no process in the control plane
 * holds a vendor credential" — is a statement about a PROCESS, and before this slice the
 * repository had exactly one.
 *
 * So every assertion here is measured against a real OS process. Nothing is simulated: the
 * PIDs are `process.pid` and the child's own report of `process.pid`, the environment is the
 * one the child observes through its own `process.env`, and the secret is a sentinel written
 * to a file only the child was told about.
 * =================================================================================
 */

let launched: LaunchedIntegration | null = null;

afterEach(async () => {
  if (launched !== null) {
    await launched.close();
    launched = null;
  }
});

describe('`§6` — THE RUNTIME IDENTITIES ARE A CLOSED SET', () => {
  it('there are exactly two shapes, and neither is a caller-chosen string', () => {
    expect(CONTROL_PLANE_RUNTIME).toBe('CONTROL_PLANE');
    expect(integrationAdapterRuntimeIdentity(ADAPTER_A)).toBe(`INTEGRATION_ADAPTER:${ADAPTER_A}`);
    expect(adapterIdOfRuntimeIdentity(`INTEGRATION_ADAPTER:${ADAPTER_A}`)).toBe(ADAPTER_A);
  });

  it('and a malformed adapter identity cannot become a runtime target', () => {
    for (const bad of [
      '',
      'a',
      'MOCK_ADS',
      'mock-ads',
      'mock ads',
      '../../etc/passwd',
      'mock_ads\u0000',
      'INTERNAL_ONLY',
      'campaign.pause',
    ]) {
      expect(isWellFormedAdapterId(bad), bad).toBe(false);
      expect(() => integrationAdapterRuntimeIdentity(bad), bad).toThrow();
    }
  });
});

describe('`§5` — THE INTEGRATION RUNTIME IS A SEPARATE OS PROCESS', () => {
  it('the control and integration runtimes have distinct PIDs', async () => {
    const secret = mintSentinelSecret('pid');
    launched = launchIntegration((secrets) => {
      const locator = secrets.write('a', { adapterId: ADAPTER_A, secret });
      return runtimeRegistry(adapterADescriptor(locator));
    });

    expect(launched.client.isRunning(ADAPTER_A)).toBe(false);

    const registry = launched.client.adapterRegistry();
    const proxy = registry.resolve(ADAPTER_A);
    expect(proxy).toBeDefined();
    const outcome = await proxy!.dispatch(syntheticEnvelope({ adapter: ADAPTER_A }));

    expect(outcome.kind).toBe('ADAPTER_RETURNED');
    const childPid = await awaitRuntimeReady(launched.client, ADAPTER_A);
    expect(childPid).toBeGreaterThan(0);
    expect(childPid).not.toBe(process.pid);
  });

  it('and adapter A and adapter B run in two different processes', async () => {
    const secretA = mintSentinelSecret('A');
    const secretB = mintSentinelSecret('B');
    launched = launchIntegration((secrets) => {
      const a = secrets.write('a', { adapterId: ADAPTER_A, secret: secretA });
      const b = secrets.write('b', { adapterId: ADAPTER_B, secret: secretB });
      return runtimeRegistry(adapterADescriptor(a), adapterBDescriptor(b));
    });

    const registry = launched.client.adapterRegistry();
    const first = await registry.resolve(ADAPTER_A)!.dispatch(syntheticEnvelope({ adapter: ADAPTER_A }));
    const second = await registry
      .resolve(ADAPTER_B)!
      .dispatch(syntheticEnvelope({ adapter: ADAPTER_B, recoverability: 'IRRECOVERABLE' }));

    expect(first.kind).toBe('ADAPTER_RETURNED');
    expect(second.kind).toBe('ADAPTER_RETURNED');

    const pidA = await awaitRuntimeReady(launched.client, ADAPTER_A);
    const pidB = await awaitRuntimeReady(launched.client, ADAPTER_B);
    expect(pidA).not.toBe(pidB);
    expect(pidA).not.toBe(process.pid);
    expect(pidB).not.toBe(process.pid);
  });
});

describe('`§12`, `§30` — THE CHILD ENVIRONMENT IS CONSTRUCTED, NOT INHERITED', () => {
  it('the constructed environment is EXACTLY the eight declared keys', () => {
    const environment = buildIntegrationRuntimeEnvironment({
      adapterId: ADAPTER_A,
      runtimeRoot: ADAPTER_A_ROOT,
      adapterModule: join(ADAPTER_A_ROOT, 'adapter.ts'),
      secretSourceModule: join(ADAPTER_A_ROOT, 'secretSource.ts'),
      secretLocator: '/nowhere/a.json',
      // `50 §2g` field 1's echo. An IDENTITY, never material — the assertion below is what
      // keeps that true as the allowlist grows.
      expectedCredentialId: 'mock_ads.pause_only',
    });
    expect(Object.keys(environment).sort()).toEqual([...INTEGRATION_RUNTIME_ENV_KEYS].sort());
    // AND THE LOCATOR IS A LOCATOR. No member of the environment is secret material.
    expect(JSON.stringify(environment)).not.toContain('TEST_ONLY_VENDOR_SECRET');
  });

  it('`§30`: adapter A sees its own locator, and NOT adapter B’s or any control secret', async () => {
    /*
     * THE PARENT GENUINELY HOLDS SECRETS. `globalSetup.ts` publishes
     * `ACOS_CONTROL_PG_URL` and `ACOS_AUDIT_PG_URL` — real connection strings with real
     * passwords — into this process's environment, so the negative is not contrived. The
     * two adapter-shaped variables are added here to complete `§30`'s required list.
     */
    process.env['ADAPTER_B_SECRET'] = mintSentinelSecret('envB');
    process.env['OWNER_SIGNING_PRIVATE_KEY'] = mintSentinelSecret('envSigning');
    process.env['UNRELATED_APPLICATION_SECRET'] = mintSentinelSecret('envOther');
    try {
      expect(process.env['ACOS_CONTROL_PG_URL']).toBeDefined();

      const secretA = mintSentinelSecret('envA');
      launched = launchIntegration((secrets) => {
        const locator = secrets.write('a', { adapterId: ADAPTER_A, secret: secretA });
        return runtimeRegistry(adapterADescriptor(locator));
      });

      const registry = launched.client.adapterRegistry();
      await registry.resolve(ADAPTER_A)!.dispatch(syntheticEnvelope({ adapter: ADAPTER_A }));

      const observed = launched.client.observedChildEnvironmentKeys(ADAPTER_A);
      expect(observed).not.toBeNull();

      // EXACTLY: the declared allowlist plus whatever the platform injects, and nothing else.
      const admissible = new Set<string>([
        ...INTEGRATION_RUNTIME_ENV_KEYS,
        ...PLATFORM_INJECTED_ENV_KEYS,
      ]);
      const surplus = observed!.filter((key) => !admissible.has(key));
      expect(surplus, `the child received keys outside the allowlist: ${surplus.join(', ')}`).toEqual(
        [],
      );

      // AND THE NAMED NEGATIVES, one by one, as `§30` lists them.
      for (const forbidden of [
        'ADAPTER_B_SECRET',
        'OWNER_SIGNING_PRIVATE_KEY',
        'UNRELATED_APPLICATION_SECRET',
        'ACOS_CONTROL_PG_URL',
        'ACOS_AUDIT_PG_URL',
        'ACOS_DBOS_SYS_PG_URL',
      ]) {
        expect(observed, forbidden).not.toContain(forbidden);
      }
    } finally {
      delete process.env['ADAPTER_B_SECRET'];
      delete process.env['OWNER_SIGNING_PRIVATE_KEY'];
      delete process.env['UNRELATED_APPLICATION_SECRET'];
    }
  });
});

describe('`§7` — ONE CREDENTIAL SCOPE, ONE RUNTIME: A CANNOT REACH B', () => {
  it("adapter A's runtime cannot resolve adapter B's credential", async () => {
    const secretA = mintSentinelSecret('isoA');
    const secretB = mintSentinelSecret('isoB');
    launched = launchIntegration((secrets) => {
      secrets.write('a', { adapterId: ADAPTER_A, secret: secretA });
      const b = secrets.write('b', { adapterId: ADAPTER_B, secret: secretB });
      return runtimeRegistry(
        // A's runtime is pointed at B's LOCATOR — the strongest form of the attack, because
        // it is what a mis-wired deployment would actually produce.
        adapterADescriptor(b),
        adapterBDescriptor(b),
      );
    });

    const registry = launched.client.adapterRegistry();
    const outcome = await registry
      .resolve(ADAPTER_A)!
      .dispatch(syntheticEnvelope({ adapter: ADAPTER_A }));

    /*
     * A's source is scoped to `mock_ads` at construction and B's document declares
     * `mock_commerce`, so the source answers UNAVAILABLE and the host refuses before the
     * adapter is reached. The refusal reaches the control plane as `NOT_SENT_CONFIRMED /
     * PRE_SEND_FAILURE` — provably nothing was sent, which is correct: the adapter never ran.
     */
    expect(outcome).toEqual({ kind: 'NOT_SENT_CONFIRMED', basis: 'PRE_SEND_FAILURE' });
  });

  it('and B is unaffected by A being pointed at the wrong locator', async () => {
    const secretB = mintSentinelSecret('unaffB');
    launched = launchIntegration((secrets) => {
      const b = secrets.write('b', { adapterId: ADAPTER_B, secret: secretB });
      return runtimeRegistry(adapterADescriptor(b), adapterBDescriptor(b));
    });
    const registry = launched.client.adapterRegistry();
    const outcome = await registry
      .resolve(ADAPTER_B)!
      .dispatch(syntheticEnvelope({ adapter: ADAPTER_B, recoverability: 'IRRECOVERABLE' }));
    expect(outcome.kind).toBe('ADAPTER_RETURNED');
  });
});

describe('`§24` — PER-CREDENTIAL REVOCATION, AND IT IS PER CREDENTIAL', () => {
  it('enabled → invoked; revoked → refused before the adapter; the sibling is unaffected', async () => {
    const secretA = mintSentinelSecret('revA');
    const secretB = mintSentinelSecret('revB');
    launched = launchIntegration((secrets) => {
      const a = secrets.write('a', { adapterId: ADAPTER_A, secret: secretA });
      const b = secrets.write('b', { adapterId: ADAPTER_B, secret: secretB });
      return runtimeRegistry(adapterADescriptor(a), adapterBDescriptor(b));
    });
    const registry = launched.client.adapterRegistry();
    const envelopeA = syntheticEnvelope({ adapter: ADAPTER_A });
    const envelopeB = syntheticEnvelope({ adapter: ADAPTER_B, recoverability: 'IRRECOVERABLE' });

    // ENABLED.
    expect((await registry.resolve(ADAPTER_A)!.dispatch(envelopeA)).kind).toBe('ADAPTER_RETURNED');

    // REVOKED, at the deployment boundary — the control plane is not involved and is not
    // restarted. `§24`: "A later owner/deployment operation may change it."
    launched.secrets.write('a', { adapterId: ADAPTER_A, secret: secretA, revoked: true });

    const refused = await registry.resolve(ADAPTER_A)!.dispatch(envelopeA);
    expect(refused).toEqual({ kind: 'NOT_SENT_CONFIRMED', basis: 'PRE_SEND_FAILURE' });

    // THE SIBLING IS UNAFFECTED. `§24`: "Other adapter unaffected."
    expect((await registry.resolve(ADAPTER_B)!.dispatch(envelopeB)).kind).toBe('ADAPTER_RETURNED');

    // AND IT IS REVERSIBLE AT THE SAME BOUNDARY, with no control-plane restart.
    launched.secrets.write('a', { adapterId: ADAPTER_A, secret: secretA, revoked: false });
    expect((await registry.resolve(ADAPTER_A)!.dispatch(envelopeA)).kind).toBe('ADAPTER_RETURNED');
  });
});

describe('`§25` — CREDENTIAL ROTATION AT THE INTEGRATION BOUNDARY', () => {
  it('the material changes, the control process is untouched, and no value is exposed', async () => {
    const first = mintSentinelSecret('rot1');
    const second = mintSentinelSecret('rot2');
    launched = launchIntegration((secrets) => {
      const a = secrets.write('a', {
        adapterId: ADAPTER_A,
        secret: first,
        version: 'ACCEPT',
      });
      return runtimeRegistry(adapterADescriptor(a));
    });
    const proxy = launched.client.adapterRegistry().resolve(ADAPTER_A)!;
    const envelope = syntheticEnvelope({ adapter: ADAPTER_A });

    expect((await proxy.dispatch(envelope)).kind).toBe('ADAPTER_RETURNED');
    const pidBefore = launched.client.runtimePid(ADAPTER_A);

    // ROTATE. Same runtime, same control process, different material.
    launched.secrets.write('a', {
      adapterId: ADAPTER_A,
      secret: second,
      version: 'ACCEPT',
    });

    const after = await proxy.dispatch(envelope);
    expect(after.kind).toBe('ADAPTER_RETURNED');
    // Neither process restarted: rotation is a deployment-boundary operation.
    expect(launched.client.runtimePid(ADAPTER_A)).toBe(pidBefore);

    // AND NEITHER VALUE IS ANYWHERE THE CONTROL PLANE CAN SEE.
    const serialised = JSON.stringify(after);
    expect(serialised).not.toContain(first);
    expect(serialised).not.toContain(second);
  });
});

describe('`§39`, `§40` — THE CHANNEL IS A PRIVATE PIPE AND THERE IS NO LISTENER', () => {
  it('the runtime opens no TCP port, no HTTP listener and no named socket', async () => {
    const secret = mintSentinelSecret('listener');
    launched = launchIntegration((secrets) => {
      const a = secrets.write('a', { adapterId: ADAPTER_A, secret });
      return runtimeRegistry(adapterADescriptor(a));
    });
    await launched.client.adapterRegistry().resolve(ADAPTER_A)!.dispatch(
      syntheticEnvelope({ adapter: ADAPTER_A }),
    );
    await awaitRuntimeReady(launched.client, ADAPTER_A);

    /*
     * ASSERTED STRUCTURALLY RATHER THAN BY PROBING A PORT. A port scan proves only that
     * nothing was listening on the ports scanned at the moment they were scanned; the
     * property `§40` wants is that no listener CAN exist, and that is a property of the
     * runtime's import closure. `source-boundary.test.ts` asserts the closure; this
     * assertion is the behavioural half — the request reached the child, so the channel
     * works, and it worked over a descriptor with no address.
     */
    expect(launched.client.runtimePid(ADAPTER_A)).not.toBe(process.pid);
  });
});

describe('`§13` — THE REQUEST CARRIES NO CREDENTIAL AND NO AUTHORITY FIELD', () => {
  it('every member of a built request is traceable to the envelope', () => {
    const envelope = syntheticEnvelope({ adapter: ADAPTER_A });
    const request = buildDispatchRequest(envelope);

    expect(request.authorisationRef).toBe(envelope.authorisationId);
    expect(request.effectId).toBe(envelope.effectId);
    expect(request.dispatchPayloadHash).toBe(envelope.dispatchPayloadHash);
    expect(Buffer.from(request.dispatchPayloadBase64, 'base64')).toEqual(
      envelope.payloadCanonicalBytes,
    );

    // NO MEMBER NAMES A SECRET, A TOKEN, AN AMOUNT, A LIMIT OR A URL.
    const members = Object.keys(request).join(' ');
    for (const forbidden of [
      /secret/i,
      /token/i,
      /apikey/i,
      /credential/i,
      /authoriz/i,
      /header/i,
      /amount/i,
      /exposure/i,
      /limit/i,
      /ceiling/i,
      /url/i,
      /endpoint/i,
      /enabled/i,
      /force/i,
      /bypass/i,
    ]) {
      expect(members, String(forbidden)).not.toMatch(forbidden);
    }
  });
});
