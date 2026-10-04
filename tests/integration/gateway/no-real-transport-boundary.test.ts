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
import {
  dispatchEnv,
  rawOutcomeRows,
} from '../../support/gatewayFixture.js';
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
import * as leaseModule from '../../../src/kernel/gateway/dispatchLease.js';
import * as revalidationModule from '../../../src/kernel/gateway/dispatchRevalidation.js';
import { EMPTY_ADAPTER_REGISTRY } from '../../../src/kernel/gateway/adapterRegistry.js';
import { withoutProviderEvidenceSurface } from '../../support/providerEvidenceSurface.js';

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
    for (const { path, code: raw } of files) {
      // v1.3.8 — the declared provider-evidence surface's exact tokens are removed first, and
      // only from its declared files (`tests/support/providerEvidenceSurface.ts`). Every pattern
      // below still applies to every file, those included.
      const code = withoutProviderEvidenceSurface(path, raw);
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
      // v1.3.5 (SER-01, MIE-01). Four dependencies the two epochs and the ledger movement
      // need, each named for the declaration that requires it:
      //
      //   entityLease.js      `25 §14.1`'s Epoch B reacquires "the SAME architecture entity
      //                       advisory-lock key", so the dispatch lease composes the accepted
      //                       manager rather than opening a second lock discipline.
      //   enumerateEffects.js the live re-enumeration `25 §14.1` revalidates against. The
      //                       ACCEPTED S1C core, imported and not reimplemented — and note
      //                       what is NOT here: no constructor, no canonicaliser, no
      //                       `liveSelector.js`, because revalidation constructs no payload.
      //   ledger.js           `25 §10.1`'s three implemented movements.
      //   lockOrder.js        `30 §5.2`'s SINGLE acquisition site, for the outcome
      //                       transaction's balance locks (`30 §5.1`'s own block).
      //   retry.js            the accepted bounded `40001` retry. `40P01` is still never
      //                       retried — `retry.ts` propagates it, and that is the property
      //                       the assertion below checks.
      '../enumeration/entityLease.js',
      '../enumeration/enumerateEffects.js',
      '../enumeration/enumerationRecord.js',
      '../exposure/ledger.js',
      '../exposure/lockOrder.js',
      '../exposure/retry.js',
      './dispatchLease.js',
      './dispatchRevalidation.js',
      // v1.3.6 (`50 §3f`). ONE new dependency, and it is the pre-live external-effect gate:
      // `DispatchEnvironment` carries a `VerifiedControlArtifactBundle`, and
      // `dispatchEnvelope.ts` reads the catalogue entry out of THAT bundle rather than out
      // of a literal. `50 §3f`: "external claim and dispatch cannot proceed if the verified
      // bundle is unavailable or invalid." It is a TYPE-ONLY import of the capability; the
      // gateway reaches no verifier, no loader, no trust configuration and no artifact
      // package, and `tests/controlArtifacts/boundaries.test.ts` asserts that each of those
      // has exactly one production call site, in `registry.ts`.
      '../controlArtifacts/bundle.js',
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
    // And the verified-bundle capability IS imported, which is `50 §3f`'s requirement.
    expect(seen).toContain('../controlArtifacts/bundle.js');
    // AND THE RAW LOADERS ARE ABSENT. The gateway may hold the capability; it may not
    // produce one, configure one, or read an artifact package.
    for (const forbidden of [
      '../controlArtifacts/verifier.js',
      '../controlArtifacts/trustConfig.js',
      '../controlArtifacts/artifactPackage.js',
      '../controlArtifacts/registry.js',
    ]) {
      expect(seen, `the gateway imports ${forbidden}`).not.toContain(forbidden);
    }
    // AND THE CANONICALISER IS STILL ABSENT — `25 §14.1`: revalidation "constructs no
    // payload" and "the persisted payload remains the exact authorised payload". A gateway
    // that imported the constructor registry or the live selector could rebuild dispatch
    // bytes one epoch later, which is the substitution the section forbids by name.
    expect(seen).not.toContain('../enumeration/liveSelector.js');
    expect(seen).not.toContain('../canonicalisation/canonicaliser.js');
    expect(seen).not.toContain('../canonicalisation/registry.js');
    // AND NO CANONICALISER, NO ENUMERATION PORT, NO COMMERCE READER — `§10`'s absence.
    //
    // `../exposure/ledger.js` HAS LEFT THIS LIST, and `../exposure/stepR.js` HAS NOT.
    // The distinction is `30 §5.1`'s own: the outcome transaction moves the MIE ledger
    // (`25 §10.1`) and therefore reads and writes balance rows, so it imports the ledger's
    // movement functions and `30 §5.2`'s single lock-acquisition site. What it must never
    // import is the RESERVATION writer — a gateway that could call `reserveOrdinary` could
    // create authority at the dispatch boundary, which is `26 §1` Corollary 3's whole
    // subject. One import moves a declared commitment; the other would mint one.
    for (const forbidden of [
      '../canonicalisation/canonicaliser.js',
      '../enumeration/port.js',
      '../enumeration/liveSelector.js',
      '../enumeration/commerceState.js',
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
  it('the ONLY `ExternalEffectAdapter` in `src/` is the credential-free transport proxy', async () => {
    /*
     * =============================================================================
     * S1N AMENDS THIS ASSERTION, OUT LOUD. THE ACCEPTED VERSION SAID:
     *
     *     "`src/` contains NO `ExternalEffectAdapter` implementation at all"
     *
     * and its sibling assertion below said, in its own words, that "a future slice that adds
     * one has to change this assertion out loud." THIS IS THAT SLICE.
     *
     * =============================================================================
     * WHY THE PROPERTY CHANGED, AND WHY THE NEW ONE IS STRONGER RATHER THAN WEAKER
     *
     * The accepted absence was a proxy for the property that actually matters: nothing in
     * the control process can present a vendor credential. S1J could state that as an
     * absence because there was no other way to state it — the repository had ONE process,
     * so "an adapter in `src/`" and "an adapter in the control process" were the same
     * sentence.
     *
     * `I25` is the real property and it is about a PROCESS: "**No process in the control
     * plane holds a vendor credential.**" S1M returned PARTIAL because no process existed
     * that could satisfy it. S1N builds one, and the object that remains in `src/` is a
     * TRANSPORT PROXY: it forwards a validated envelope to a separate OS process and
     * translates a closed reply back. It presents no credential, reaches no vendor and has
     * no route to either.
     *
     * SO THE ASSERTION BECOMES AN ALLOWLIST OF EXACTLY ONE FILE, PLUS FOUR NARROWING CHECKS
     * THAT DID NOT EXIST BEFORE. The permitted file must contain no secret loader, no
     * provider client, no network primitive and no environment read, and it must be the ONLY
     * file in `src/` that spawns a process. A second adapter implementation, or a credential
     * appearing in this one, fails this test exactly as before.
     * =============================================================================
     */
    const PERMITTED = join('src', 'integration', 'control', 'integrationClient.ts');

    const files = await sourceOf();
    const offenders: string[] = [];
    for (const { path, code } of files) {
      if (path.endsWith(`${sep}adapterPort.ts`)) continue;
      if (relative(path) === PERMITTED) continue;
      for (const pattern of [
        /adapterId\s*:\s*['"]/,
        /resolutionCapabilities\s*:\s*\[/,
        /async\s+dispatch\s*\(/,
        /dispatch\s*\(\s*envelope\s*:/,
        // S1N ADDS THIS PATTERN, because the S1N shape — an object literal whose `dispatch`
        // is an arrow property — is one the four accepted patterns do not see. Without it
        // the amendment would be cosmetic: a second proxy could be added anywhere in `src/`
        // and this test would stay green.
        /\bdispatch\s*:\s*\(/,
      ]) {
        if (pattern.test(code)) offenders.push(`${relative(path)} (${String(pattern)})`);
      }
    }
    expect(
      offenders,
      `an adapter implementation in src/ outside ${PERMITTED}:\n  ${offenders.join('\n  ')}`,
    ).toEqual([]);

    // AND THE PERMITTED FILE IS NARROWED, so the carve-out is smaller than the hole it opens.
    const proxy = files.find(({ path }) => relative(path) === PERMITTED);
    expect(proxy, `${PERMITTED} is missing`).toBeDefined();
    for (const forbidden of [
      /readFileSync/,
      /readFile\s*\(/,
      /process\.env/,
      /dotenv/i,
      /SecretsManager/i,
      /vault/i,
      /\bsecret\b/i,
      /globalThis\.fetch/,
      /(?<![.\w$])fetch\s*\(/,
      /from\s+['"](node:)?https?['"]/,
      /from\s+['"](node:)?net['"]/,
      /from\s+['"](node:)?tls['"]/,
      /from\s+['"]axios['"]/,
      /from\s+['"]undici['"]/,
      /Authorization/,
      /Bearer/,
      /apiKey/i,
      /accessToken/i,
      /https?:\/\//,
      // It transports; it does not load an adapter. The dynamic import lives in the CHILD.
      /await\s+import\s*\(/,
    ]) {
      expect(proxy!.code, `${PERMITTED} (${String(forbidden)})`).not.toMatch(forbidden);
    }

    /*
     * =============================================================================
     * S1O AMENDS THIS ASSERTION, OUT LOUD. THE S1N VERSION SAID:
     *
     *     "AND IT IS THE ONLY FILE IN `src/` THAT SPAWNS A PROCESS."
     *
     * =============================================================================
     * WHY THERE ARE NOW TWO, AND WHY THE PROPERTY IS UNCHANGED
     *
     * The count was never the property. The property is that **every process this
     * repository spawns is a credential boundary that the spawning process cannot see
     * into**, and S1N could state it as "exactly one" because there was exactly one such
     * boundary to build.
     *
     * S1O builds the second, in the OTHER PLANE. `48 §2` row 13 — "Audit plane vendor
     * reads" — described a capability with no component, and `48 §3.6`'s "read-only,
     * separately provisioned, and attempted-write-tested" was a requirement with nothing to
     * hold it. The audit plane now forks its own reader, and that reader holds a credential
     * the audit plane's own parent process must not be able to read — the same sentence
     * `I25` makes about the control plane, one plane over.
     *
     * SO THE ASSERTION BECOMES AN ALLOWLIST OF EXACTLY TWO, ONE PER PLANE, AND EACH IS
     * NARROWED BY THE SAME CHECKS. A third spawner, or a credential appearing in either of
     * these two, fails this test exactly as before.
     *
     * AND THE TWO ARE IN DIFFERENT PLANES BY CONSTRUCTION, which is asserted rather than
     * assumed: one under `src/integration/`, one under `src/audit/`. A second spawner
     * appearing in the SAME plane would mean one plane had two credential boundaries, which
     * is the shape `23 §7`'s per-credential isolation forbids.
     * =============================================================================
     */
    const AUDIT_PERMITTED = join('src', 'audit', 'provider', 'plane', 'auditReadClient.ts');

    const spawners = files
      .filter(({ code }) => /from\s+['"]node:child_process['"]/.test(code))
      .map(({ path }) => relative(path))
      .sort();
    expect(spawners).toEqual([AUDIT_PERMITTED, PERMITTED].sort());

    // ONE PER PLANE, asserted rather than assumed.
    expect(spawners.filter((path) => path.includes(join('src', 'integration')))).toHaveLength(1);
    expect(spawners.filter((path) => path.includes(join('src', 'audit')))).toHaveLength(1);

    // AND THE AUDIT SPAWNER IS NARROWED BY THE SAME CHECKS AS THE INTEGRATION ONE, so the
    // second carve-out is no wider than the first.
    const auditProxy = files.find(({ path }) => relative(path) === AUDIT_PERMITTED);
    expect(auditProxy, `${AUDIT_PERMITTED} is missing`).toBeDefined();
    for (const forbidden of [
      /readFileSync/,
      /readFile\s*\(/,
      /process\.env/,
      /dotenv/i,
      /SecretsManager/i,
      /vault/i,
      /\bsecret\b/i,
      /globalThis\.fetch/,
      /(?<![.\w$])fetch\s*\(/,
      /from\s+['"](node:)?https?['"]/,
      /from\s+['"](node:)?net['"]/,
      /from\s+['"](node:)?tls['"]/,
      /from\s+['"]axios['"]/,
      /from\s+['"]undici['"]/,
      /Authorization/,
      /Bearer/,
      /apiKey/i,
      /accessToken/i,
      /https?:\/\//,
      // It transports; it does not load a reader. The dynamic import lives in the CHILD.
      /await\s+import\s*\(/,
    ]) {
      expect(auditProxy!.code, `${AUDIT_PERMITTED} (${String(forbidden)})`).not.toMatch(forbidden);
    }
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
    // `25 §14.1`'s two new modules. NEITHER EXPORTS A DISPATCH SURFACE: the lease manager
    // grants no permission (`25 §14.1`: "Reacquiring the dispatch lease is not a recovery
    // mechanism"), and the revalidator returns `VALID` or `STALE` and nothing an adapter
    // could be invoked with.
    expect(Object.keys(leaseModule).sort()).toEqual([
      'DispatchLeaseManager',
      'entityKeyEqualityProof',
      'entityKeyForResourceRef',
      'underlyingLeaseFor',
    ]);
    expect(Object.keys(revalidationModule).sort()).toEqual([
      'DISPATCH_STALE_REASONS',
      'revalidateAuthorisedEffectUnderLease',
    ]);
    expect(Object.keys(portModule).sort()).toEqual([
      'ADAPTER_OUTCOME_KINDS',
      'ADAPTER_RESOLUTION_CAPABILITIES',
      // `25 §7.2`'s two admissible bases, as a closed enum. It exists so the classification
      // is typed control flow rather than a parsed string, and it carries no behaviour.
      'NOT_SENT_BASES',
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
      // `30 §5.1`: the outcome transaction takes the money-path lock order "where — and only
      // where — it moves the ledger". This predicate is that condition, derived from the
      // MOVEMENT so the lock decision and the ledger decision cannot drift apart.
      'movesLedger',
      'outcomePolicyFor',
    ]);
    expect(Object.keys(outcomeModule).sort()).toEqual([
      'OUTCOME_REFUSALS',
      // `25 §14.1` Epoch B runs its outcome transaction ON THE DISPATCH LEASE'S CONNECTION,
      // so the service exposes a client-taking entry point beside the pooled one.
      'outcomeIsolationFor',
      'processAdapterOutcome',
      'processAdapterOutcomeOn',
      'processAdapterOutcomeOnClient',
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
    const result = await dispatchAuthorisedEffect(dispatchEnv(h, mock), {
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
    // `movedWindows` is `25 §10.1`'s "every applicable MIE window instance", as a value the
    // gateway REPORTS rather than a property a test has to infer from balances. It carries
    // window ids and instance keys and nothing else — no amount, no unit count, no ceiling
    // and no headroom — so `§33`'s rule that no economic quantity reaches a worker surface
    // is unchanged by it.
    expect(Object.keys(parsed).sort()).toEqual([
      'claimJournalSeq',
      'kind',
      'movedWindows',
      'record',
    ]);
    for (const moved of parsed['movedWindows'] as readonly Record<string, unknown>[]) {
      expect(Object.keys(moved).sort()).toEqual(['windowId', 'windowInstanceKey']);
    }
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
      // v1.3.5 (MIE-01), FAIL-CLOSED. An IRRECOVERABLE effect whose committed reservation
      // holds no irrecoverable unit has nothing for `25 §10.1`'s PRESUME row to move.
      'MIE_UNITS_NOT_RESERVED',
    ]);

    // `25 §14.1`'s stale reasons are INTERNAL and are never a `GatewayResult` field — the
    // gateway collapses every one of them to a single coarse literal, exactly as
    // `workerFacingDenial.ts` collapses the four selector codes. The vocabulary is asserted
    // here so a new member cannot appear without a reviewer seeing it.
    expect([...revalidationModule.DISPATCH_STALE_REASONS]).toEqual([
      'AUTHORISED_EFFECT_NOT_FOUND',
      'REVALIDATION_IDENTITY_ABSENT',
      'ENUMERATION_RECORD_ABSENT',
      'ENUMERATION_BINDING_MISMATCH',
      'CONSTRUCTOR_VERSION_CHANGED',
      'RESOURCE_NO_LONGER_RESOLVES',
      'OPTION_ABSENT_FROM_LIVE_SET',
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
    for (const { path, code: raw } of files) {
      // v1.3.8 — the declared provider-evidence surface's exact tokens are removed first, and
      // only from its declared files (`tests/support/providerEvidenceSurface.ts`). Every pattern
      // below still applies to every file, those included.
      const withoutTagName = withoutProviderEvidenceSurface(path, raw)
        .replace(/DISPATCHED_UNMIRRORED/g, '')
        // `PRESUMED_EXECUTED` IS NO LONGER A PROVIDER-EVIDENCE LITERAL, and removing it from
        // this sweep is a consequence of MIE-01 rather than a relaxation.
        //
        // The accepted S1J banned it because v1.3.4 reached it only through a consumption it
        // could not perform. v1.3.5 declares it as a LOCAL state reached from the adapter's
        // own typed outcome — `25 §7.1`'s two IRRECOVERABLE rows — and `25 §10.1` is explicit
        // that it is NOT a realisation: "The unit does not move directly to `realised`,
        // because a presumption is not a realisation and provider truth is unverified."
        //
        // The literals that DO assert provider truth stay banned below, and that is the line
        // the sweep now draws: `VERIFIED` and `NEVER_SENT` require "independent provider
        // evidence" by `25 §10.1`'s own words, and neither appears in `src/`.
        .replace(/PRESUMED_EXECUTED/g, '')
        // Likewise the confirmed-not-sent state, which `25 §7.2` keeps "deliberately NOT
        // `NEVER_SENT`" precisely because it is IMMEDIATE TRUSTED-ADAPTER PROOF rather than
        // later reconciliation. The sweep still bans the reconciled literal itself.
        .replace(/DISPATCH_NOT_SENT_CONFIRMED/g, '')
        .replace(/NOT_SENT_CONFIRMED/g, '')
        .replace(/PROVIDER_REJECTED_NO_MUTATION/g, '');
      for (const pattern of [
        /'VERIFIED'/,
        /'NEVER_SENT'/,
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
    await dispatchAuthorisedEffect(dispatchEnv(h, mock), {
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
