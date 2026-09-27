import { afterEach, describe, expect, it } from 'vitest';

import {
  handleDispatchRequest,
  type IntegrationRuntimeConfiguration,
} from '../../../src/integration/runtime/integrationHost.js';
import {
  ADAPTER_CREDENTIAL_IDENTITY_PROVENANCES,
  adapterCredentialIdentityMismatch,
  type AdapterSecretSource,
} from '../../../src/integration/runtime/adapterSecretSource.js';
import {
  ENV_EXPECTED_CREDENTIAL_ID,
  INTEGRATION_RUNTIME_ENV_KEYS,
  buildIntegrationRuntimeEnvironment,
} from '../../../src/integration/protocol/runtimeEnvironment.js';
import {
  CREDENTIAL_IDENTITY_PROVENANCES,
  credentialIdentityMismatch,
} from '../../../src/kernel/controlArtifacts/credentialRisk.js';
import { REFUSAL_REASONS } from '../../../src/integration/protocol/wire.js';
import { unsafeHandleWithoutCredentialIdentityBinding } from '../../negative-controls/unsafe-credential-identity-binding.js';
import { createRecordingAdapter } from '../../negative-controls/unsafe-integration-host.js';
import { buildDispatchRequest } from '../../../src/integration/control/integrationClient.js';
import { syntheticEnvelope } from '../../support/perimeterFixture.js';
import {
  ADAPTER_A,
  CREDENTIAL_A_MONEY_MOVING,
  CREDENTIAL_A_NON_MONETARY,
  adapterADescriptor,
  awaitRuntimeReady,
  launchIntegration,
  mintSentinelSecret,
  runtimeRegistry,
  type LaunchedIntegration,
} from '../../support/integrationFixture.js';

/**
 * `50 §2g` FIELD 1 — **THE RESOLVED CREDENTIAL IS THE DECLARED CREDENTIAL.**
 *
 * =================================================================================
 * WHAT THIS FILE PROVES, AND WHY IT IS A SEPARATE SUITE
 *
 * The S1O owner review found a defect that no existing assertion could have caught, because
 * every existing assertion was about ONE of the two chains:
 *
 *     signed class-5 `credential_id`  ->  risk class  ->  the registry admits the runtime
 *     `secretLocator`                 ->  material    ->  presented at the provider boundary
 *
 * `adapterRuntimeRegistry`'s suite proves the first chain refuses a `MONEY_MOVING` record, an
 * undeclared credential and an `audit_plane`-scoped one. The perimeter suite proves the
 * second chain never lets material reach the control plane. **Neither asks whether the two
 * chains are about the same credential**, and until this correction, nothing did.
 *
 * So the discriminating input here is the one both suites pass:
 *
 *     descriptor      `mock_ads`, credential `mock_ads.pause_only`
 *     signed record   NON_MONETARY_WRITE  ->  option A admits it, correctly
 *     secret source   resolves material identified `mock_ads.budget_manage`
 *     signed record   MONEY_MOVING        ->  ADR-024's trigger, on the credential in hand
 *
 * =================================================================================
 * AND THE NEGATIVE HALF: A LOCATOR IS NOT AN IDENTITY
 *
 * The attack does not touch the locator. Adapter A's runtime reads adapter A's own locator,
 * from adapter A's own directory, through adapter A's own source — every isolation property
 * S1N established still holds. What changed is the CONTENT at that locator, which is exactly
 * the change a locator comparison cannot see.
 * =================================================================================
 */

let launched: LaunchedIntegration | null = null;

afterEach(async () => {
  if (launched !== null) {
    await launched.close();
    launched = null;
  }
});

/** A source that resolves material identified as whatever the caller names. */
function sourceResolving(
  adapterId: string,
  secret: string,
  credentialIdentity: string,
): AdapterSecretSource {
  return {
    declaredAdapterId: adapterId,
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
  adapter = createRecordingAdapter(ADAPTER_A),
): { readonly configuration: IntegrationRuntimeConfiguration; readonly adapter: typeof adapter } {
  return {
    configuration: {
      adapterId: ADAPTER_A,
      adapter,
      secretSource: sourceResolving(
        ADAPTER_A,
        mintSentinelSecret('identity'),
        resolvedCredentialIdentity,
      ),
      expectedCredentialId,
    },
    adapter,
  };
}

const request = (): string =>
  JSON.stringify(buildDispatchRequest(syntheticEnvelope({ adapter: ADAPTER_A })));

/* ================================================================================
 * 1. THE BINDING IS A DECLARED REFUSAL, NOT AN INCIDENTAL ONE
 * ============================================================================== */

describe('`50 §2g` field 1 — the refusal exists and is its own closed code', () => {
  it('`CREDENTIAL_IDENTITY_MISMATCH` is a member of the closed refusal set', () => {
    // Its own code rather than a reuse of `CREDENTIAL_UNAVAILABLE`, because "the deployment
    // boundary could not answer" and "it answered with the wrong credential" are different
    // facts and an operator reading a log must be able to tell them apart.
    expect([...REFUSAL_REASONS]).toContain('CREDENTIAL_IDENTITY_MISMATCH');
    expect([...REFUSAL_REASONS]).toContain('CREDENTIAL_UNAVAILABLE');
  });

  it('the launch environment carries the expected identity, and it is an IDENTITY', () => {
    const environment = buildIntegrationRuntimeEnvironment({
      adapterId: ADAPTER_A,
      runtimeRoot: '/root',
      adapterModule: '/root/adapter.ts',
      secretSourceModule: '/root/secretSource.ts',
      secretLocator: '/elsewhere/a.json',
      expectedCredentialId: CREDENTIAL_A_NON_MONETARY,
    });
    expect(Object.keys(environment).sort()).toEqual([...INTEGRATION_RUNTIME_ENV_KEYS].sort());
    expect(environment[ENV_EXPECTED_CREDENTIAL_ID]).toBe(CREDENTIAL_A_NON_MONETARY);
    // `§30`, restated for the new key: an identity travels, material never does.
    expect(JSON.stringify(environment)).not.toContain('TEST_ONLY_VENDOR_SECRET');
  });

  it('the kernel and the integration runtime agree on the provenance set', () => {
    // Two transcriptions of one closed list. The audit plane holds a third, asserted in
    // `source-boundary.test.ts`; the disagreement is what either assertion is for.
    expect([...ADAPTER_CREDENTIAL_IDENTITY_PROVENANCES]).toEqual([
      ...CREDENTIAL_IDENTITY_PROVENANCES,
    ]);
  });

  it('the kernel and the runtime comparison agree on every case', () => {
    const cases: readonly (readonly [string, string])[] = [
      [CREDENTIAL_A_NON_MONETARY, CREDENTIAL_A_NON_MONETARY],
      [CREDENTIAL_A_NON_MONETARY, CREDENTIAL_A_MONEY_MOVING],
      ['', CREDENTIAL_A_NON_MONETARY],
      [CREDENTIAL_A_NON_MONETARY, ''],
      ['', ''],
    ];
    for (const [expected, resolved] of cases) {
      const kernel = credentialIdentityMismatch(expected, resolved);
      const runtime = adapterCredentialIdentityMismatch(expected, resolved);
      expect(kernel === null, `${expected}/${resolved}`).toBe(runtime === null);
    }
  });
});

/* ================================================================================
 * 2. THE REQUIRED ATTACK — A MONEY-MOVING CREDENTIAL UNDER A NON-MONETARY DECLARATION
 * ============================================================================== */

describe('`§12` of the correction — the money-moving substitution', () => {
  it('a NON_MONETARY_WRITE declaration over MONEY_MOVING material is REFUSED', async () => {
    const { configuration, adapter } = configurationFor(
      CREDENTIAL_A_NON_MONETARY,
      CREDENTIAL_A_MONEY_MOVING,
    );
    const reply = await handleDispatchRequest(configuration, request());

    expect(reply.kind).toBe('REQUEST_REFUSED');
    if (reply.kind === 'REQUEST_REFUSED') {
      expect(reply.reason).toBe('CREDENTIAL_IDENTITY_MISMATCH');
    }
    // THE PROPERTY THAT MATTERS: no provider boundary was reached, because no adapter code
    // ran at all. The guard is before the invocation, not inside it.
    expect(adapter.invocations).toHaveLength(0);
  });

  it('UNSAFE: the same input DISPATCHES when the binding is not checked', async () => {
    const { configuration, adapter } = configurationFor(
      CREDENTIAL_A_NON_MONETARY,
      CREDENTIAL_A_MONEY_MOVING,
    );
    const reply = await unsafeHandleWithoutCredentialIdentityBinding(configuration, request());

    // THE DISCRIMINATION. Same configuration, same request, opposite outcome.
    expect(reply.kind).toBe('DISPATCH_RESPONSE');
    expect(adapter.invocations).toHaveLength(1);
    if (reply.kind === 'DISPATCH_RESPONSE') {
      // And it reports the MONEY_MOVING identity it presented, which is the evidence that
      // ADR-024's option-B trigger was crossed by the credential actually in hand.
      expect(reply.credentialIdentity).toBe(CREDENTIAL_A_MONEY_MOVING);
    }
  });

  it('the refusal teaches a closed code and neither credential identity', async () => {
    const { configuration } = configurationFor(
      CREDENTIAL_A_NON_MONETARY,
      CREDENTIAL_A_MONEY_MOVING,
    );
    const reply = await handleDispatchRequest(configuration, request());
    // `§23`: a refusal carries four members. A detail naming both identities would publish
    // the deployment's credential topology to any caller that could provoke a mismatch.
    expect(Object.keys(reply).sort()).toEqual(
      ['protocolVersion', 'kind', 'invocationId', 'reason'].sort(),
    );
    expect(JSON.stringify(reply)).not.toContain(CREDENTIAL_A_MONEY_MOVING);
  });
});

/* ================================================================================
 * 3. THE MATCHING CASE PROCEEDS — THE REFUSAL IS NOT VACUOUS
 * ============================================================================== */

describe('a MATCHING signed and resolved identity proceeds through the boundary', () => {
  it('the in-process host dispatches and reports the bound identity', async () => {
    const { configuration, adapter } = configurationFor(
      CREDENTIAL_A_NON_MONETARY,
      CREDENTIAL_A_NON_MONETARY,
    );
    const reply = await handleDispatchRequest(configuration, request());

    expect(reply.kind).toBe('DISPATCH_RESPONSE');
    expect(adapter.invocations).toHaveLength(1);
    if (reply.kind === 'DISPATCH_RESPONSE') {
      expect(reply.credentialIdentity).toBe(CREDENTIAL_A_NON_MONETARY);
    }
  });

  it('and the REAL forked runtime completes a dispatch with the matching pair', async () => {
    // The in-process assertions above prove the guard; this one proves the ECHO reaches a
    // real child through a real `fork`, because a guard whose operand never arrives is a
    // guard that refuses everything.
    const secret = mintSentinelSecret('bound');
    launched = launchIntegration((secrets) => {
      const locator = secrets.write('a', {
        adapterId: ADAPTER_A,
        secret,
        credentialIdentity: CREDENTIAL_A_NON_MONETARY,
        version: 'ACCEPT',
      });
      return runtimeRegistry(adapterADescriptor(locator));
    });

    const proxy = launched.client.adapterRegistry().resolve(ADAPTER_A)!;
    const outcome = await proxy.dispatch(syntheticEnvelope({ adapter: ADAPTER_A }));

    expect(outcome.kind).toBe('ADAPTER_RETURNED');
    const pid = await awaitRuntimeReady(launched.client, ADAPTER_A);
    expect(pid).not.toBe(process.pid);
  });

  it('and a REAL forked runtime whose locator holds the WRONG credential refuses', async () => {
    const secret = mintSentinelSecret('unbound');
    launched = launchIntegration((secrets) => {
      // THE ATTACK, AT THE DEPLOYMENT BOUNDARY: the descriptor is untouched, the locator is
      // untouched, adapter A's own source reads adapter A's own file. The FILE holds the
      // other credential.
      const locator = secrets.write('a', {
        adapterId: ADAPTER_A,
        secret,
        credentialIdentity: CREDENTIAL_A_MONEY_MOVING,
        version: 'ACCEPT',
      });
      return runtimeRegistry(adapterADescriptor(locator));
    });

    const proxy = launched.client.adapterRegistry().resolve(ADAPTER_A)!;
    const outcome = await proxy.dispatch(syntheticEnvelope({ adapter: ADAPTER_A }));

    /*
     * `NOT_SENT_CONFIRMED` IS THE CORRECT CLASSIFICATION AND IT IS LOAD-BEARING.
     *
     * `25 §7.2` permits it "only where the adapter can positively establish that NO EXTERNAL
     * WRITE CROSSED THE TRANSPORT BOUNDARY". A refusal raised by the runtime BEFORE the
     * adapter was invoked establishes exactly that: no adapter code ran, so no provider
     * client was constructed and no boundary was crossed. An `OUTCOME_UNKNOWN` here would be
     * a false ambiguity that an `I36` sweep would have to chase.
     */
    expect(outcome.kind).toBe('NOT_SENT_CONFIRMED');
  });
});
