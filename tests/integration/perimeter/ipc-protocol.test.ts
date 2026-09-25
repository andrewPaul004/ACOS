import { createHash } from 'node:crypto';

import { afterEach, describe, expect, it } from 'vitest';

import {
  DISPATCH_REQUEST_FIELDS,
  INTEGRATION_PROTOCOL_VERSION,
  MAX_IPC_MESSAGE_BYTES,
  REFUSAL_REASONS,
  WIRE_FAILURE_CLASSES,
  computeRequestBindingDigest,
  decodeDispatchRequest,
  decodeIntegrationReply,
  encodeIntegrationMessage,
  type DispatchRequest,
} from '../../../src/integration/protocol/wire.js';
import { ADAPTER_OUTCOME_KINDS } from '../../../src/kernel/gateway/adapterPort.js';
import { buildDispatchRequest } from '../../../src/integration/control/integrationClient.js';
import { handleDispatchRequest } from '../../../src/integration/runtime/integrationHost.js';
import {
  createRecordingAdapter,
  unsafeHandleDispatchRequest,
} from '../../negative-controls/unsafe-integration-host.js';
import {
  ADAPTER_A,
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
import type { AdapterSecretSource } from '../../../src/integration/runtime/adapterSecretSource.js';

/**
 * `§13`, `§14`, `§15`, `§16`, `§22`, `§23`, `§42` — THE CLOSED IPC PROTOCOL.
 *
 * `§14`: "Use a CLOSED schema. Unknown fields reject. Missing fields reject. Version
 * mismatch rejects. Bound message sizes." Every one of those is a separate assertion below,
 * and each is made against a message that is otherwise valid — a refusal that could also be
 * explained by a second defect proves nothing about the rule it was written for.
 */

let launched: LaunchedIntegration | null = null;

afterEach(async () => {
  if (launched !== null) {
    await launched.close();
    launched = null;
  }
});

function validRequest(overrides: Partial<DispatchRequest> = {}): DispatchRequest {
  const base = buildDispatchRequest(syntheticEnvelope({ adapter: ADAPTER_A }));
  if (Object.keys(overrides).length === 0) return base;
  const merged = { ...base, ...overrides } as DispatchRequest;
  // Recompute the digest UNLESS the test is deliberately breaking the binding.
  if (!('bindingDigest' in overrides)) {
    return Object.freeze({ ...merged, bindingDigest: computeRequestBindingDigest(merged) });
  }
  return merged;
}

const encode = (value: unknown): string => JSON.stringify(value);

/** A secret source that answers instantly, for the in-process host assertions. */
function fixedSecretSource(adapterId: string, secret: string): AdapterSecretSource {
  return {
    declaredAdapterId: adapterId,
    resolve: () =>
      Promise.resolve({
        kind: 'RESOLVED',
        credential: { secret, identity: 'label', version: null },
      }),
  };
}

describe('`§14` — THE SCHEMA IS CLOSED IN EVERY DIRECTION', () => {
  it('a well-formed request decodes, and its field list is exactly the declared one', () => {
    const request = validRequest();
    expect(Object.keys(request).sort()).toEqual([...DISPATCH_REQUEST_FIELDS].sort());
    const decoded = decodeDispatchRequest(encode(request));
    expect(decoded.kind).toBe('DECODED');
  });

  it('an UNKNOWN field rejects', () => {
    const decoded = decodeDispatchRequest(encode({ ...validRequest(), extraField: 'x' }));
    expect(decoded).toEqual({ kind: 'REFUSED', reason: 'UNKNOWN_FIELD' });
  });

  it('a MISSING field rejects — every declared field, one at a time', () => {
    for (const field of DISPATCH_REQUEST_FIELDS) {
      const partial: Record<string, unknown> = { ...validRequest() };
      delete partial[field];
      const decoded = decodeDispatchRequest(encode(partial));
      expect(decoded.kind, field).toBe('REFUSED');
      if (decoded.kind !== 'REFUSED') continue;
      // `protocolVersion` and `kind` are checked by value, so their absence surfaces as the
      // value check rather than the presence check. Both are refusals; neither decodes.
      expect(['MISSING_FIELD', 'PROTOCOL_VERSION_MISMATCH', 'FIELD_MALFORMED'], field).toContain(
        decoded.reason,
      );
    }
  });

  it('a VERSION MISMATCH rejects, and does not negotiate', () => {
    const decoded = decodeDispatchRequest(
      encode({ ...validRequest(), protocolVersion: 'acos.integration.v2' }),
    );
    expect(decoded).toEqual({ kind: 'REFUSED', reason: 'PROTOCOL_VERSION_MISMATCH' });
  });

  it('an OVERSIZED message rejects, on both the sending and the receiving side', () => {
    const huge = validRequest({
      dispatchPayloadBase64: Buffer.alloc(MAX_IPC_MESSAGE_BYTES).toString('base64'),
    });
    // The sender refuses to encode it at all — `§42`: the bound is enforced where the
    // allocation would happen.
    expect(encodeIntegrationMessage(huge)).toBeNull();
    // And the receiver refuses it even if something else produced the bytes.
    expect(decodeDispatchRequest(encode(huge))).toEqual({
      kind: 'REFUSED',
      reason: 'MESSAGE_TOO_LARGE',
    });
  });

  it('a PROTOTYPE-POLLUTION shape rejects, and is caught in the TEXT', () => {
    const raw = encode(validRequest()).replace('{', '{"__proto__":{"polluted":true},');
    expect(decodeDispatchRequest(raw)).toEqual({
      kind: 'REFUSED',
      reason: 'PROTOTYPE_POLLUTION_SHAPE',
    });
    /*
     * AND THE REFUSAL IS ATTRIBUTABLE RATHER THAN INCIDENTAL. The closed-field walk would
     * refuse the same bytes as `UNKNOWN_FIELD`, which is true and says nothing; the raw-text
     * check runs first so the reason names the shape.
     *
     * The parsed object shows why the shape matters at all: `JSON.parse` defines
     * `__proto__` as an OWN DATA PROPERTY rather than invoking the setter, so nothing is
     * polluted YET — and the key is sitting there for the next spread or merge to act on.
     */
    const parsed = JSON.parse(raw) as object;
    expect(Object.keys(parsed)).toContain('__proto__');
    expect(Object.getPrototypeOf(parsed)).toBe(Object.prototype);
    expect((parsed as { polluted?: unknown }).polluted).toBeUndefined();
  });

  it('a DUPLICATE semantic field rejects', () => {
    const request = validRequest();
    const raw = encode(request).replace(
      `"authorisationRef":${JSON.stringify(request.authorisationRef)}`,
      `"authorisationRef":"authorisation:OTHER","authorisationRef":${JSON.stringify(
        request.authorisationRef,
      )}`,
    );
    expect(decodeDispatchRequest(raw)).toEqual({
      kind: 'REFUSED',
      reason: 'DUPLICATE_SEMANTIC_FIELD',
    });
  });

  it('a LONE SURROGATE rejects — `§14`’s malformed-UTF-8 case', () => {
    const raw = encode(validRequest()).replace('"companyId":"', '"companyId":"\uD800');
    expect(decodeDispatchRequest(raw)).toEqual({ kind: 'REFUSED', reason: 'FIELD_MALFORMED' });
  });

  it('and a malformed value in any typed field rejects', () => {
    const cases: readonly [string, unknown][] = [
      ['recoverability', 'SOMETIMES'],
      ['requiresUnmirroredTag', 'true'],
      ['dispatchPayloadHash', 'not-a-hash'],
      ['bindingDigest', 'A'.repeat(64)],
      ['adapterId', 'MOCK_ADS'],
      ['dispatchPayloadBase64', '!!!!'],
      ['authorisationRef', ''],
      ['overrideRef', 5],
    ];
    for (const [field, value] of cases) {
      const decoded = decodeDispatchRequest(encode({ ...validRequest(), [field]: value }));
      expect(decoded.kind, field).toBe('REFUSED');
    }
  });
});

describe('`§15`, `§16` — `I24` AT THE RUNTIME, AND THE BINDING', () => {
  const secret = 'TEST_ONLY_VENDOR_SECRET_bindings';

  it('a request with a BLANK authorisation reference is refused before the adapter', async () => {
    const adapter = createRecordingAdapter(ADAPTER_A);
    const configuration = {
      adapterId: ADAPTER_A,
      adapter,
      secretSource: fixedSecretSource(ADAPTER_A, secret),
    };
    // The decoder refuses an empty string, so the message never reaches the guard — which is
    // the stronger form of the same property and is asserted as such.
    const reply = await handleDispatchRequest(
      configuration,
      encode(validRequest({ authorisationRef: '' })),
    );
    expect(reply.kind).toBe('REQUEST_REFUSED');
    expect(adapter.invocations).toHaveLength(0);
  });

  it('`§16`: a valid authorisation for effect A on effect B’s envelope is REFUSED', async () => {
    const adapter = createRecordingAdapter(ADAPTER_A);
    const configuration = {
      adapterId: ADAPTER_A,
      adapter,
      secretSource: fixedSecretSource(ADAPTER_A, secret),
    };

    // TWO GENUINE EFFECTS, each with its own genuine authorisation.
    const effectA = buildDispatchRequest(
      syntheticEnvelope({ adapter: ADAPTER_A, authorisationId: 'authorisation:A', effectId: 'effect:A' }),
    );
    const effectB = buildDispatchRequest(
      syntheticEnvelope({ adapter: ADAPTER_A, authorisationId: 'authorisation:B', effectId: 'effect:B' }),
    );

    // Both are accepted on their own.
    expect((await handleDispatchRequest(configuration, encode(effectA))).kind).toBe(
      'DISPATCH_RESPONSE',
    );
    expect((await handleDispatchRequest(configuration, encode(effectB))).kind).toBe(
      'DISPATCH_RESPONSE',
    );
    expect(adapter.invocations).toHaveLength(2);

    // THE ATTACK: effect B's envelope carrying effect A's authorisation reference.
    const swapped = { ...effectB, authorisationRef: effectA.authorisationRef };
    const reply = await handleDispatchRequest(configuration, encode(swapped));
    expect(reply.kind).toBe('REQUEST_REFUSED');
    if (reply.kind === 'REQUEST_REFUSED') {
      expect(reply.reason).toBe('AUTHORISATION_BINDING_MISMATCH');
    }
    // AND THE ADAPTER NEVER RAN. `§15`: "refused before provider adapter method."
    expect(adapter.invocations).toHaveLength(2);
  });

  it('UNSAFE: a host whose binding check is a null check accepts the same attack', async () => {
    const adapter = createRecordingAdapter(ADAPTER_A);
    const configuration = {
      adapterId: ADAPTER_A,
      adapter,
      secretSource: fixedSecretSource(ADAPTER_A, secret),
    };
    const effectA = buildDispatchRequest(
      syntheticEnvelope({ adapter: ADAPTER_A, authorisationId: 'authorisation:A', effectId: 'effect:A' }),
    );
    const effectB = buildDispatchRequest(
      syntheticEnvelope({ adapter: ADAPTER_A, authorisationId: 'authorisation:B', effectId: 'effect:B' }),
    );
    const swapped = { ...effectB, authorisationRef: effectA.authorisationRef };

    const reply = await unsafeHandleDispatchRequest(configuration, encode(swapped), {
      bindingCheckIsNullCheckOnly: true,
    });
    expect(reply.kind).toBe('DISPATCH_RESPONSE');
    // THE DISCRIMINATION: the adapter RAN, under an authorisation for a different effect.
    expect(adapter.invocations).toHaveLength(1);
    expect(adapter.invocations[0]!.effectId).toBe('effect:B');
    expect(adapter.invocations[0]!.authorisationRef).toBe('authorisation:A');
  });

  it('and a PAYLOAD that does not hash to the committed hash is refused before the adapter', async () => {
    const adapter = createRecordingAdapter(ADAPTER_A);
    const configuration = {
      adapterId: ADAPTER_A,
      adapter,
      secretSource: fixedSecretSource(ADAPTER_A, secret),
    };
    const request = validRequest({
      dispatchPayloadBase64: Buffer.from('{"substituted":true}', 'utf8').toString('base64'),
    });
    const reply = await handleDispatchRequest(configuration, encode(request));
    expect(reply.kind).toBe('REQUEST_REFUSED');
    if (reply.kind === 'REQUEST_REFUSED') expect(reply.reason).toBe('PAYLOAD_HASH_MISMATCH');
    expect(adapter.invocations).toHaveLength(0);
  });

  it('a request addressed to ANOTHER adapter is refused by this runtime', async () => {
    const adapter = createRecordingAdapter(ADAPTER_A);
    const configuration = {
      adapterId: ADAPTER_A,
      adapter,
      secretSource: fixedSecretSource(ADAPTER_A, secret),
    };
    const forB = buildDispatchRequest(syntheticEnvelope({ adapter: ADAPTER_B }));
    const reply = await handleDispatchRequest(configuration, encode(forB));
    expect(reply.kind).toBe('REQUEST_REFUSED');
    if (reply.kind === 'REQUEST_REFUSED') expect(reply.reason).toBe('ADAPTER_IDENTITY_MISMATCH');
    expect(adapter.invocations).toHaveLength(0);
  });

  it('the binding digest is INJECTIVE over every identity-bearing member', () => {
    const base = validRequest();
    const digest = computeRequestBindingDigest(base);
    const mutations: readonly Partial<DispatchRequest>[] = [
      { authorisationRef: 'authorisation:other' },
      { effectId: 'effect:other' },
      { outboxId: 'outbox:other' },
      { claimId: 'claim:other' },
      { idempotencyKey: 'idem:other' },
      { companyId: 'company:other' },
      { correlationTag: 'tag:other' },
      { resourceRef: 'campaign:other' },
      { adapterId: ADAPTER_B },
      { method: 'somethingElse' },
      { actionClass: 'refund.create' },
      { recoverability: 'IRRECOVERABLE' },
      { requiresUnmirroredTag: true },
      { overrideRef: 'override:1' },
      { dispatchPayloadHash: createHash('sha256').update('other').digest('hex') },
    ];
    for (const mutation of mutations) {
      const mutated = { ...base, ...mutation } as DispatchRequest;
      expect(computeRequestBindingDigest(mutated), JSON.stringify(mutation)).not.toBe(digest);
    }
    // AND `invocationId` IS NOT BOUND, deliberately: `§27` makes it transport observability,
    // so two transports of the same authorised work are the same authorised work.
    expect(computeRequestBindingDigest({ ...base, invocationId: 'other' })).toBe(digest);
  });
});

describe('`§22`, `§23` — THE REPLY TAXONOMY IS CLOSED AND CARRIES NO DETAIL', () => {
  it('the wire outcome kinds are EXACTLY the accepted adapter taxonomy', () => {
    // The four members `adapterPort.ts` declares, and no fifth.
    expect([...ADAPTER_OUTCOME_KINDS].sort()).toEqual(
      ['ADAPTER_FAILED', 'ADAPTER_RETURNED', 'NOT_SENT_CONFIRMED', 'OUTCOME_UNKNOWN'].sort(),
    );
    for (const kind of ADAPTER_OUTCOME_KINDS) {
      const shape =
        kind === 'ADAPTER_RETURNED'
          ? { kind, providerReference: null, rawResponseHash: null }
          : kind === 'OUTCOME_UNKNOWN'
            ? { kind, reason: 'TIMEOUT' }
            : kind === 'NOT_SENT_CONFIRMED'
              ? { kind, basis: 'PRE_SEND_FAILURE' }
              : { kind, failureClass: WIRE_FAILURE_CLASSES[0] };
      const decoded = decodeIntegrationReply(
        encode({
          protocolVersion: INTEGRATION_PROTOCOL_VERSION,
          kind: 'DISPATCH_RESPONSE',
          invocationId: 'inv',
          adapterId: ADAPTER_A,
          outcome: shape,
          credentialIdentity: null,
          credentialVersion: null,
        }),
      );
      expect(decoded.kind, kind).toBe('DECODED');
    }
  });

  it('an outcome with a FIFTH member does not decode — `§44`’s raw body has nowhere to go', () => {
    const decoded = decodeIntegrationReply(
      encode({
        protocolVersion: INTEGRATION_PROTOCOL_VERSION,
        kind: 'DISPATCH_RESPONSE',
        invocationId: 'inv',
        adapterId: ADAPTER_A,
        outcome: {
          kind: 'ADAPTER_RETURNED',
          providerReference: 'p',
          rawResponseHash: null,
          rawResponseBody: '{"everything":"the vendor said"}',
        },
        credentialIdentity: null,
        credentialVersion: null,
      }),
    );
    expect(decoded).toEqual({ kind: 'REFUSED', reason: 'FIELD_MALFORMED' });
  });

  it('a REFUSAL carrying a `detail` string does not decode — `§23`', () => {
    for (const reason of REFUSAL_REASONS) {
      const clean = decodeIntegrationReply(
        encode({
          protocolVersion: INTEGRATION_PROTOCOL_VERSION,
          kind: 'REQUEST_REFUSED',
          invocationId: 'inv',
          reason,
        }),
      );
      expect(clean.kind, reason).toBe('DECODED');
    }
    const leaky = decodeIntegrationReply(
      encode({
        protocolVersion: INTEGRATION_PROTOCOL_VERSION,
        kind: 'REQUEST_REFUSED',
        invocationId: 'inv',
        reason: 'CREDENTIAL_UNAVAILABLE',
        detail: 'TEST_ONLY_VENDOR_SECRET_leak at /tmp/secrets/a.json',
      }),
    );
    expect(leaky).toEqual({ kind: 'REFUSED', reason: 'UNKNOWN_FIELD' });
  });

  it('and an UNPARSEABLE reply becomes OUTCOME_UNKNOWN rather than a refusal', async () => {
    /*
     * The distinction is economic. A REFUSAL releases a commitment (`25 §7.1`:
     * `DISPATCH_NOT_SENT_CONFIRMED / RESERVATION_RELEASED`); an unparseable message proves
     * nothing about whether a write escaped, so it must not.
     */
    const secret = mintSentinelSecret('unparseable');
    launched = launchIntegration((secrets) => {
      const a = secrets.write('a', { adapterId: ADAPTER_A, secret, version: 'AMBIGUOUS' });
      return runtimeRegistry(adapterADescriptor(a));
    });
    const outcome = await launched.client
      .adapterRegistry()
      .resolve(ADAPTER_A)!
      .dispatch(syntheticEnvelope({ adapter: ADAPTER_A }));
    expect(outcome).toEqual({ kind: 'OUTCOME_UNKNOWN', reason: 'AMBIGUOUS' });
  });
});

describe('`§42` — THE BOUNDS ARE REAL, AND A SECOND REQUEST IS REFUSED RATHER THAN QUEUED', () => {
  it('a concurrent invocation on one runtime is refused before anything is sent', async () => {
    const secret = mintSentinelSecret('backpressure');
    launched = launchIntegration(
      (secrets) => {
        const a = secrets.write('a', { adapterId: ADAPTER_A, secret, version: 'HANG' });
        return runtimeRegistry(adapterADescriptor(a));
      },
      { deadlineMs: 2_000 },
    );
    const proxy = launched.client.adapterRegistry().resolve(ADAPTER_A)!;

    const first = proxy.dispatch(syntheticEnvelope({ adapter: ADAPTER_A }));
    await awaitRuntimeReady(launched.client, ADAPTER_A);
    // Give the first request time to be sent and to reach the hanging provider.
    await new Promise((settle) => setTimeout(settle, 300));

    const second = await proxy.dispatch(syntheticEnvelope({ adapter: ADAPTER_A }));
    // REFUSED BEFORE SEND, so it is provably not sent.
    expect(second).toEqual({ kind: 'NOT_SENT_CONFIRMED', basis: 'PRE_SEND_FAILURE' });

    // The first still resolves on its deadline, as `§41` requires.
    expect(await first).toEqual({ kind: 'OUTCOME_UNKNOWN', reason: 'TIMEOUT' });
  });

  it('and adapter B is unaffected by adapter A being saturated', async () => {
    const secretA = mintSentinelSecret('satA');
    const secretB = mintSentinelSecret('satB');
    launched = launchIntegration(
      (secrets) => {
        const a = secrets.write('a', { adapterId: ADAPTER_A, secret: secretA, version: 'HANG' });
        const b = secrets.write('b', { adapterId: ADAPTER_B, secret: secretB });
        return runtimeRegistry(adapterADescriptor(a), adapterBDescriptor(b));
      },
      { deadlineMs: 2_000 },
    );
    const registry = launched.client.adapterRegistry();
    const saturating = registry.resolve(ADAPTER_A)!.dispatch(syntheticEnvelope({ adapter: ADAPTER_A }));
    await new Promise((settle) => setTimeout(settle, 300));

    const outcome = await registry
      .resolve(ADAPTER_B)!
      .dispatch(syntheticEnvelope({ adapter: ADAPTER_B, recoverability: 'IRRECOVERABLE' }));
    expect(outcome.kind).toBe('ADAPTER_RETURNED');
    expect((await saturating).kind).toBe('OUTCOME_UNKNOWN');
  });
});
