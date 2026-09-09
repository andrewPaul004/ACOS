import { readFile, readdir } from 'node:fs/promises';
import { join, sep } from 'node:path';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { COMPANY_ID } from '../../support/fixture.js';
import {
  S1I_NOW,
  authorisePause,
  createOutboxHarness,
  type OutboxHarness,
} from '../../support/outboxFixture.js';
import { rawOutcomeRows, testRegistry } from '../../support/gatewayFixture.js';
import { createMockAdapter, returnedOutcome } from '../../support/mockAdapter.js';
import { enqueueDispatch } from '../../../src/kernel/outbox/enqueue.js';
import { dispatchAuthorisedEffect } from '../../../src/kernel/gateway/effectGateway.js';
import * as gatewayModule from '../../../src/kernel/gateway/effectGateway.js';
import * as portModule from '../../../src/kernel/gateway/adapterPort.js';
import * as registryModule from '../../../src/kernel/gateway/adapterRegistry.js';
import * as capabilityModule from '../../../src/kernel/gateway/dispatchCapability.js';
import * as envelopeModule from '../../../src/kernel/gateway/dispatchEnvelope.js';
import * as policyModule from '../../../src/kernel/gateway/outcomePolicy.js';
import * as outcomeModule from '../../../src/kernel/gateway/outcomeTransaction.js';
import { EMPTY_ADAPTER_REGISTRY } from '../../../src/kernel/gateway/adapterRegistry.js';

/**
 * `§7`, `§9`, `§29`, `§31`, `§34`, `§39` — WHERE S1J STOPS, HELD AS ASSERTIONS.
 *
 * =================================================================================
 * `§39`'s STRICT SOURCE GATE, VERBATIM
 *
 *   "Add a production-source test over S1J's dispatch path rejecting imports/calls for:
 *    `fetch`; `http`; `https`; axios; undici request APIs; node net/tls; vendor SDKs;
 *    credential loaders; environment API keys/tokens. Database connections already used by
 *    kernel/audit are not the target. The test should specifically guard the external-effect
 *    adapter path. Mock adapter is in-process only."
 *
 * This file is the S1J successor to the ACCEPTED `no-transport-boundary.test.ts`, which is
 * UNAMENDED by S1J except for nothing at all: every absence it asserts still holds, and this
 * file adds the gateway directory's own.
 *
 * THE ONE THING S1J DELIBERATELY DOES NOT ASSERT AS AN ABSENCE is the pair of post-dispatch
 * effect statuses `35 §4` and `S1J-C4` declare. `no-transport-boundary.test.ts` asserts that
 * `'DISPATCHED'`, `'EXECUTED'`, `'SETTLED'`, `'PRESUMED_EXECUTED'` and `'NEVER_SENT'` appear
 * nowhere in `src/`, AND ALL FIVE STILL DO NOT — `OUTCOME_RESOLVED` is named for exactly
 * that reason, and the IRRECOVERABLE unknown branch is PARTIAL so `PRESUMED_EXECUTED` was
 * never written.
 * =================================================================================
 */

let h: OutboxHarness;
const NOW = S1I_NOW;

beforeAll(async () => {
  h = await createOutboxHarness();
});

afterAll(async () => {
  await h.close();
});

beforeEach(async () => {
  await h.reset();
});

/** Every `.ts` file under `src/`, comments stripped. */
async function sourceOf(): Promise<readonly { path: string; code: string }[]> {
  const root = join(process.cwd(), 'src');
  const out: { path: string; code: string }[] = [];
  async function walk(dir: string): Promise<void> {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.name.endsWith('.ts')) {
        const raw = await readFile(full, 'utf8');
        out.push({
          path: full,
          code: raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1'),
        });
      }
    }
  }
  await walk(root);
  return out;
}

async function gatewaySourceOf(): Promise<readonly { path: string; code: string }[]> {
  const files = await sourceOf();
  return files.filter(({ path }) => path.includes(`${sep}kernel${sep}gateway${sep}`));
}

const relative = (path: string): string => path.replace(`${process.cwd()}${sep}`, '');

describe('`§39` — NO NETWORK, NO VENDOR, NO CREDENTIAL, SCOPED TO THE DISPATCH PATH', () => {
  it('the gateway directory imports no HTTP client, no socket and no vendor SDK', async () => {
    /*
     * SCOPED, AS `§39` ASKS. `pg` is the accepted database driver and opens a real TCP
     * socket; flagging it would be a false positive and would prove nothing about dispatch.
     * What must be absent is anything capable of reaching a VENDOR.
     */
    const files = await gatewaySourceOf();
    expect(files.length).toBeGreaterThanOrEqual(6);
    const offenders: string[] = [];
    for (const { path, code } of files) {
      for (const pattern of [
        /globalThis\.fetch/,
        /\bfetch\s*\(/,
        /require\(['"](node:)?https?['"]\)/,
        /from\s+['"](node:)?https?['"]/,
        /from\s+['"](node:)?net['"]/,
        /from\s+['"](node:)?dgram['"]/,
        /from\s+['"](node:)?tls['"]/,
        /from\s+['"]axios['"]/,
        /from\s+['"]undici['"]/,
        /from\s+['"]node-fetch['"]/,
        /new\s+WebSocket/,
        /XMLHttpRequest/,
        /from\s+['"][^'"]*adapters?\//,
        // Vendor names. `§7`'s list, plus the four `48 §2` integration-plane rows.
        /shopify/i,
        /stripe/i,
        /sendgrid/i,
        /postmark/i,
        /mailgun/i,
        /\bses\b/i,
        /\bmeta\b/i,
        /google/i,
        // Credentials and endpoints.
        /Authorization/,
        /Bearer/,
        /apiKey/i,
        /api_key/i,
        /accessToken/i,
        /secret/i,
        /credential/i,
        /endpoint/i,
        /baseUrl/i,
        /https?:\/\//,
        // Credential loaders and environment reads. `48 §4` item 4 / `I25`: "No
        // control-plane process holds a vendor credential", CI-checked "on the dependency
        // tree and the injected environment".
        /process\.env/,
        /dotenv/i,
        /SecretsManager/i,
        /vault/i,
      ]) {
        if (pattern.test(code)) offenders.push(`${relative(path)} (${String(pattern)})`);
      }
    }
    expect(
      offenders,
      `a transport, vendor or credential surface in src/kernel/gateway/:\n  ${offenders.join('\n  ')}`,
    ).toEqual([]);
  });

  it('and the whole of `src/` still holds the accepted absences', async () => {
    // The global patterns the ACCEPTED S1H and S1I boundary tests established, re-asserted
    // over the tree S1J grew. A new directory must not be where a vendor client appears.
    const files = await sourceOf();
    const offenders: string[] = [];
    for (const { path, code } of files) {
      for (const pattern of [
        /from\s+['"]axios['"]/,
        /from\s+['"]node-fetch['"]/,
        /from\s+['"]undici['"]/,
        // `globalThis.fetch` rather than a bare `fetch(`. `26 §7` step G's precondition
        // port declares an interface METHOD named `fetch` — "the engine fetches;
        // the proposer does not supply" — and that is a read against the control database,
        // not a network call. The ACCEPTED S1I test scopes the bare pattern to the outbox
        // directory for the same reason, and the gateway-scoped case above keeps it.
        /globalThis\.fetch/,
        /shopify/i,
        /stripe/i,
        /sendgrid/i,
        /postmark/i,
      ]) {
        if (pattern.test(code)) offenders.push(`${relative(path)} (${String(pattern)})`);
      }
    }
    expect(offenders, `a vendor surface in src/:\n  ${offenders.join('\n  ')}`).toEqual([]);
  });

  it('the gateway directory imports only the kernel modules it is allowed to', async () => {
    /*
     * The positive form, which is stronger than a denylist: the import list is enumerated by
     * hand, so a NEW dependency fails this test rather than slipping past a pattern. The
     * ACCEPTED S1I test does the same for `src/kernel/outbox/`.
     */
    const allowed = [
      '../../db/pool.js',
      // `§13` — the S1I claim, IMPORTED and not reimplemented. `§6`'s ordering is
      // structural because this is the function that commits before it resolves.
      '../outbox/claim.js',
      '../outbox/outboxState.js',
      // `26 §5`'s closed catalogue: the adapter identity, the method and the
      // recoverability, and `I66`'s scope predicate's own source.
      '../canonicalisation/actionCatalogue.js',
      './adapterPort.js',
      './adapterRegistry.js',
      './dispatchCapability.js',
      './dispatchEnvelope.js',
      './outcomePolicy.js',
      './outcomeTransaction.js',
    ];
    const files = await gatewaySourceOf();
    const seen = new Set<string>();
    for (const { path, code } of files) {
      for (const match of code.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
        const specifier = match[1]!;
        seen.add(specifier);
        expect(allowed, `${relative(path)} imports ${specifier}`).toContain(specifier);
      }
    }
    // The ACCEPTED claim IS imported, which is `§13`'s requirement rather than a leak.
    expect(seen).toContain('../outbox/claim.js');
    expect(seen).toContain('../canonicalisation/actionCatalogue.js');
    // AND NO CANONICALISER, NO ENUMERATION PORT, NO COMMERCE READER — `§10`'s absence.
    for (const forbidden of [
      '../canonicalisation/canonicaliser.js',
      '../enumeration/port.js',
      '../enumeration/liveSelector.js',
      '../enumeration/commerceState.js',
      '../exposure/ledger.js',
      '../exposure/stepR.js',
    ]) {
      expect(seen, `the gateway imports ${forbidden}`).not.toContain(forbidden);
    }
  });

  it('there is no scheduler, no poller and no background worker — `§23`', async () => {
    /*
     * `§23`: "Do NOT build `on startup, dispatch all CLAIMED rows`. That is forbidden." The
     * shape is unbuildable because the fresh-claim capability cannot be obtained from a row;
     * the absence below is the second mechanism (`36 §0`).
     */
    const files = await gatewaySourceOf();
    const offenders: string[] = [];
    for (const { path, code } of files) {
      for (const pattern of [
        /setInterval/,
        /setTimeout/,
        /setImmediate/,
        /cron/i,
        /\bpoll\b/i,
        /startWorker/i,
        /runLoop/i,
        /while\s*\(true\)/,
        /for\s*\(;;\)/,
        /\.subscribe\s*\(/,
        /LISTEN\s/i,
        /NOTIFY\s/i,
        // And no sweep query shape: nothing selects rows BY STATUS to act on them.
        /WHERE[^']*status\s*=\s*'CLAIMED'/i,
      ]) {
        if (pattern.test(code)) offenders.push(`${relative(path)} (${String(pattern)})`);
      }
    }
    expect(offenders, `a sweep in src/kernel/gateway/:\n  ${offenders.join('\n  ')}`).toEqual(
      [],
    );
  });

  it('and no production module imports from `tests/` or names an unsafe control', async () => {
    const files = await sourceOf();
    for (const { path, code } of files) {
      expect(code, relative(path)).not.toMatch(/from\s+['"].*tests\//);
      expect(code, relative(path)).not.toMatch(/unsafe-/);
      expect(code, relative(path)).not.toMatch(/mockAdapter/);
    }
  });
});

describe('`§7`, `§9` — THERE IS EXACTLY ONE PRODUCTION INVOCATION SURFACE, AND NO ADAPTER', () => {
  it('`src/` contains NO `ExternalEffectAdapter` implementation at all', async () => {
    /*
     * `§7`: "Do NOT implement a real adapter. The deterministic mock implementation belongs
     * under test/support or another explicitly non-production test location."
     *
     * Asserted structurally: nothing in `src/` declares a `dispatch(` method or an
     * `adapterId` field, so there is no object that satisfies the port. The port itself is a
     * TYPE declaration, and `adapterPort.ts` is exempted from the `dispatch(` pattern
     * because the interface member IS the declaration being asserted about.
     */
    const files = await sourceOf();
    const offenders: string[] = [];
    for (const { path, code } of files) {
      if (path.endsWith(`${sep}adapterPort.ts`)) continue;
      for (const pattern of [
        /adapterId\s*:\s*['"]/,
        /resolutionCapabilities\s*:\s*\[/,
        /async\s+dispatch\s*\(/,
        /dispatch\s*\(\s*envelope\s*:/,
      ]) {
        if (pattern.test(code)) offenders.push(`${relative(path)} (${String(pattern)})`);
      }
    }
    expect(
      offenders,
      `an adapter implementation in src/:\n  ${offenders.join('\n  ')}`,
    ).toEqual([]);
  });

  it('production’s own registry is EMPTY, so a production process can invoke nothing', () => {
    /*
     * `48 §2` rows 1 to 4 are the four integration-plane components that would fill it, and
     * none exists. So the default posture of a production process at S1J is that
     * `resolveAdapterFor` refuses `ADAPTER_NOT_REGISTERED` for every effect — which is the
     * correct posture for a slice with no real adapter, and a future slice that adds one has
     * to change this assertion out loud.
     */
    expect(EMPTY_ADAPTER_REGISTRY.registeredIds).toEqual([]);
    expect(EMPTY_ADAPTER_REGISTRY.resolve('mock_ads')).toBeUndefined();
    expect(EMPTY_ADAPTER_REGISTRY.resolve('mock_processor')).toBeUndefined();
    expect(EMPTY_ADAPTER_REGISTRY.resolve('mock_commerce')).toBeUndefined();
  });

  it('exactly ONE production file calls `.dispatch(` on an adapter — the Effect Gateway', async () => {
    /*
     * `36 §7`: "Every adapter method is reachable **only** through the Effect Gateway.
     * Verified by a static check that no adapter method is exported to any other caller."
     * `48 §1`: "'The only permitted path' is a policy. 'The only capable path' is an
     * architecture."
     */
    const files = await sourceOf();
    const callers = files
      .filter(({ path }) => !path.endsWith(`${sep}adapterPort.ts`))
      .filter(({ code }) => /\.dispatch\s*\(/.test(code))
      .map(({ path }) => relative(path));
    expect(callers).toEqual([join('src', 'kernel', 'gateway', 'effectGateway.ts')]);
  });

  it('and exactly ONE production file mints a capability, and ONE mints an attestation', async () => {
    /*
     * `§5`: "minted only by the successful claim operation." The single call site is what
     * makes that true — the mint function cannot verify freshness itself, so WHERE it is
     * called is the property, and this is the assertion that pins it.
     */
    const files = await sourceOf();
    const mintCapability = files
      .filter(({ path }) => !path.endsWith(`${sep}dispatchCapability.ts`))
      .filter(({ code }) => /mintFreshDispatchCapability\s*\(/.test(code))
      .map(({ path }) => relative(path));
    const mintAttestation = files
      .filter(({ path }) => !path.endsWith(`${sep}dispatchCapability.ts`))
      .filter(({ code }) => /mintDispatchAttestation\s*\(/.test(code))
      .map(({ path }) => relative(path));
    const gateway = join('src', 'kernel', 'gateway', 'effectGateway.ts');
    expect(mintCapability).toEqual([gateway]);
    expect(mintAttestation).toEqual([gateway]);
  });

  it('the gateway modules export exactly the declared surface', async () => {
    /*
     * ASSERTED AGAINST HAND-AUTHORED LISTS, so a new export fails this test rather than
     * being caught only by a pattern — the discipline the ACCEPTED S1I boundary test
     * established for `src/kernel/outbox/`.
     *
     * `EMPTY_ADAPTER_REGISTRY` is exported and `createAdapterRegistry` is exported, and
     * neither is a dispatch surface: one is an empty map, the other a validating
     * constructor. There is NO exported function anywhere below that takes an outbox row,
     * an `outboxId` or a `claimId` and returns a capability.
     */
    expect(Object.keys(gatewayModule).sort()).toEqual([
      'GATEWAY_EVENTS',
      'dispatchAuthorisedEffect',
    ]);
    expect(Object.keys(portModule).sort()).toEqual([
      'ADAPTER_OUTCOME_KINDS',
      'ADAPTER_RESOLUTION_CAPABILITIES',
    ]);
    expect(Object.keys(registryModule).sort()).toEqual([
      'ADAPTER_RESOLUTION_REFUSALS',
      'EMPTY_ADAPTER_REGISTRY',
      'adapterIsEligibleFor',
      'catalogueAdapterIds',
      'createAdapterRegistry',
      'resolveAdapterFor',
    ]);
    expect(Object.keys(capabilityModule).sort()).toEqual([
      'CAPABILITY_REFUSALS',
      'consumeFreshDispatchCapability',
      'dispatchIdentityEquals',
      'liveAttestationCount',
      'liveCapabilityCount',
      'mintDispatchAttestation',
      'mintFreshDispatchCapability',
      'readDispatchAttestation',
      'revokeFreshDispatchCapability',
    ]);
    expect(Object.keys(envelopeModule).sort()).toEqual([
      'ENVELOPE_REFUSALS',
      'buildDispatchEnvelope',
    ]);
    expect(Object.keys(policyModule).sort()).toEqual([
      'ECONOMIC_MOVEMENTS',
      'POST_DISPATCH_EFFECT_STATUSES',
      'UNDECLARED_POLICY_REASONS',
      'outcomePolicyFor',
    ]);
    expect(Object.keys(outcomeModule).sort()).toEqual([
      'OUTCOME_REFUSALS',
      'processAdapterOutcome',
      'processAdapterOutcomeOn',
      'readDispatchOutcome',
    ]);
  });

  it('and no production caller supplies a hook or an event observer', async () => {
    const files = await sourceOf();
    const offenders: string[] = [];
    for (const { path, code } of files) {
      if (path.endsWith(`${sep}effectGateway.ts`)) continue;
      if (path.endsWith(`${sep}outcomeTransaction.ts`)) continue;
      for (const pattern of [
        /afterClaimCommit/,
        /afterAdapterReturned/,
        /beforeOutcomeCommit/,
        /afterOutcomeCommit/,
        /afterOutcomeLock/,
      ]) {
        if (pattern.test(code)) offenders.push(`${relative(path)} (${String(pattern)})`);
      }
    }
    expect(offenders, `a production hook caller:\n  ${offenders.join('\n  ')}`).toEqual([]);
  });
});

describe('`§34` — THE WORKER-FACING SURFACE IS COARSE, AND CARRIES NO AUTHORITY', () => {
  it('a `GatewayResult` carries no capability, attestation, envelope, adapter or payload', async () => {
    const effect = await authorisePause(h, { resourceId: 'CMP-COARSE' });
    await enqueueDispatch(h.control, {
      companyId: COMPANY_ID,
      effectId: effect.effectId,
      outboxId: 'outbox:coarse',
      payloadCanonicalBytes: effect.payloadCanonicalBytes,
      now: NOW,
    });
    const mock = createMockAdapter({
      adapterId: 'mock_ads',
      resolutionCapabilities: ['IDEMPOTENCY_HEADER'],
      outcome: returnedOutcome('mock:coarse'),
    });
    const result = await dispatchAuthorisedEffect(h.control, testRegistry(mock), {
      companyId: COMPANY_ID,
      idempotencyKey: effect.idempotencyKey,
      dispatchedBy: 'worker:coarse',
      now: NOW,
    });
    expect(result.kind).toBe('OUTCOME_RESOLVED');

    // The whole result, as a worker would see it if it serialised it. A capability or an
    // attestation on it would THROW on `toJSON`, so this call succeeding is itself part of
    // the property: neither is reachable from the result.
    //
    // `journalSeq` values are `bigint`, which `JSON.stringify` refuses, so they are rendered
    // as strings by the replacer — the same discipline `src/audit/ingress.ts` applies on the
    // wire, and for the same reason: `30 §5.2`'s sequence must not pass through a
    // JavaScript `number`.
    const serialised = JSON.stringify(result, (_key, value) =>
      typeof value === 'bigint' ? value.toString() : value,
    );
    const parsed = JSON.parse(serialised) as Record<string, unknown>;
    expect(Object.keys(parsed).sort()).toEqual(['claimJournalSeq', 'kind', 'record']);
    for (const forbidden of [
      'capability',
      'attestation',
      'envelope',
      'payload',
      'payloadCanonicalBytes',
      'correlationTag',
    ]) {
      expect(serialised, forbidden).not.toContain(forbidden);
    }
    // What it DOES carry is a record of a committed local fact, which is the same shape the
    // ACCEPTED S1I claim result had one stage earlier.
    const record = parsed['record'] as Record<string, unknown>;
    expect(record['outcomeKind']).toBe('ADAPTER_RETURNED');
    expect(record['economicMovement']).toBe('NONE');
  });

  it('and a refusal carries a declared category, not a near-miss detail', async () => {
    /*
     * `26 §7`: "Denial detail returned to the model is coarse. The audit record holds the
     * full reason; the worker receives a category and no near-miss information. A model that
     * learns 'denied: amount exceeded by $3' has been handed a probing oracle."
     *
     * Every refusal arm's `reason` is a member of a declared closed vocabulary, and the
     * vocabularies are asserted here so a new free-form string fails the test.
     */
    expect([...registryModule.ADAPTER_RESOLUTION_REFUSALS]).toEqual([
      'ADAPTER_NOT_REGISTERED',
      'ADAPTER_INELIGIBLE_FOR_IRRECOVERABLE',
    ]);
    expect([...envelopeModule.ENVELOPE_REFUSALS]).toEqual([
      'ACTION_CLASS_NOT_IN_CATALOGUE',
      'CATALOGUE_DIVERGED_FROM_COMMITTED_EFFECT',
      'ROW_NOT_CLAIMED',
    ]);
    expect([...outcomeModule.OUTCOME_REFUSALS]).toEqual([
      'ATTESTATION_NOT_LIVE',
      'ATTESTATION_IDENTITY_MISMATCH',
      'OUTBOX_ROW_NOT_FOUND',
      'OUTBOX_ROW_NOT_CLAIMED',
      'OUTCOME_POLICY_UNDECLARED',
    ]);
    expect([...capabilityModule.CAPABILITY_REFUSALS]).toEqual([
      'CAPABILITY_NOT_LIVE',
      'CAPABILITY_IDENTITY_MISMATCH',
    ]);
  });
});

describe('`§29`, `§31` — NO PROVIDER, NO RECONCILIATION, NOTHING FAKED', () => {
  it('`src/` declares no provider query, delivery webhook or reconciliation surface', async () => {
    /*
     * `§31`: "Do NOT implement: real provider query; delivery webhook; provider log;
     * `VERIFIED` from provider evidence; `NEVER_SENT` from provider evidence; new proposal
     * after NEVER_SENT; audit-plane provider read; `I8`."
     *
     * And `§29`: a mock proves the ACOS-side state machine and nothing more.
     */
    const files = await sourceOf();
    const offenders: string[] = [];
    for (const { path, code } of files) {
      const withoutTagName = code.replace(/DISPATCHED_UNMIRRORED/g, '');
      for (const pattern of [
        /'VERIFIED'/,
        /'NEVER_SENT'/,
        /'PRESUMED_EXECUTED'/,
        /'DISPATCHED'/,
        /'EXECUTED'/,
        /'SETTLED'/,
        /deliveryEvent/i,
        /deliveryWebhook/i,
        /providerQuery/i,
        /providerLog/i,
        /messageLog/i,
        /reconcileDelivery/i,
        /acceptedCount/i,
      ]) {
        if (pattern.test(withoutTagName)) {
          offenders.push(`${relative(path)} (${String(pattern)})`);
        }
      }
    }
    expect(
      offenders,
      `a provider-evidence surface in src/:\n  ${offenders.join('\n  ')}`,
    ).toEqual([]);
  });

  it('and a full mock dispatch produces no provider-shaped row anywhere', async () => {
    const effect = await authorisePause(h, { resourceId: 'CMP-NOFAKE' });
    await enqueueDispatch(h.control, {
      companyId: COMPANY_ID,
      effectId: effect.effectId,
      outboxId: 'outbox:nofake',
      payloadCanonicalBytes: effect.payloadCanonicalBytes,
      now: NOW,
    });
    const mock = createMockAdapter({
      adapterId: 'mock_ads',
      resolutionCapabilities: ['IDEMPOTENCY_HEADER', 'DELIVERY_EVENT_WEBHOOK'],
      outcome: returnedOutcome(),
    });
    await dispatchAuthorisedEffect(h.control, testRegistry(mock), {
      companyId: COMPANY_ID,
      idempotencyKey: effect.idempotencyKey,
      dispatchedBy: 'worker:nofake',
      now: NOW,
    });

    // The mock ADVERTISED a delivery-event webhook — `§13` permits the mock to advertise
    // architecture-defined capabilities — and no delivery event exists, was recorded, or
    // could be. The advertisement is trusted METADATA for the eligibility predicate and is
    // not evidence about any provider.
    expect(mock.resolutionCapabilities).toContain('DELIVERY_EVENT_WEBHOOK');
    const row = (await rawOutcomeRows(h.control))[0]!;
    // `provider_reference` and `raw_response_hash` are the only adapter-supplied values that
    // persist, and both are inert. Neither is read as authority anywhere.
    expect(row.providerReference).toBe('mock:ref-1');
    expect(row.rawResponseHash).toBe('a'.repeat(64));
    // And the effect is NOT verified, NOT settled, NOT presumed executed.
    expect(row.effectStatus).toBe('DISPATCHED_AWAITING_VERIFICATION');
    expect(row.economicMovement).toBe('NONE');
  });
});
