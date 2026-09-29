import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { computeClosure } from '../../tools/integration-packaging/packagingManifest.js';
import {
  S1P_PROBE_ENV_KEYS,
  S1P_PROBE_ROLES,
  buildProbeEnvironment,
} from '../../validation/sendgrid/harness/probeEnvironment.js';
import { runCredentialProbe } from '../../validation/sendgrid/harness/probeClient.js';
import {
  ENV_CONFIG,
  ENV_INTEGRATION_LOCATOR,
  ENV_AUDIT_LOCATOR,
  ENV_LIVE_ACK,
  ENV_NON_PRODUCTION_ACK,
  INTEGRATION_SECRET_SOURCE_MODULE,
  AUDIT_SECRET_SOURCE_MODULE,
  LIVE_ACK_TOKEN,
  NON_PRODUCTION_ACK_TOKEN,
  establishStage1Facts,
} from '../../validation/sendgrid/harness/cli.js';
import { evaluateStage1 } from '../../validation/sendgrid/harness/preflight.js';

/**
 * CORRECTION 5 — **NO PROCESS HOLDS BOTH VENDOR CREDENTIALS, AND THE COORDINATOR HOLDS
 * NEITHER.**
 *
 * =================================================================================
 * `§19` ITEMS 5 AND 6, DRIVEN THREE WAYS
 *
 *   BY IMPORT CLOSURE   the coordinator (`cli.ts`, `probeClient.ts`) cannot REACH a secret
 *                       source. A process that cannot import one cannot resolve one, whatever
 *                       its control flow does.
 *   BY ENVIRONMENT      the one-shot child's allowlist has ONE locator slot, and the CHILD
 *                       REPORTS ITS OWN `Object.keys(process.env)` — which is the only
 *                       evidence that is not the parent's account of what it passed.
 *   BY ORDER            a stage-1 refusal never reaches the probe client at all, so a run that
 *                       was going to refuse touches ZERO secret sources.
 * =================================================================================
 */

const directory = mkdtempSync(join(tmpdir(), 'acos-s1p-isolation-'));

afterAll(() => {
  rmSync(directory, { recursive: true, force: true });
});

function document(name: string, contents: Record<string, unknown>): string {
  const path = join(directory, `${name}.json`);
  writeFileSync(path, JSON.stringify(contents), 'utf8');
  return path;
}

const INTEGRATION_LOCATOR = document('integration', {
  adapterId: 'sendgrid_email',
  sourceKind: 'FILE_FIXTURE',
  apiKey: 'TEST_ONLY_VENDOR_SECRET_S1P_ISOLATION_INTEGRATION_00',
  credentialIdentity: 'twilio_sendgrid.validation_send',
});
const AUDIT_LOCATOR = document('audit', {
  providerId: 'twilio_sendgrid',
  sourceKind: 'FILE_FIXTURE',
  apiKey: 'TEST_ONLY_AUDIT_READ_SECRET_S1P_ISOLATION_AUDIT_00',
  credentialIdentity: 'twilio_sendgrid.validation_audit_read',
});

describe('`§19` item 5 — THE COORDINATOR CANNOT REACH A SECRET SOURCE', () => {
  it('neither `cli.ts` nor `probeClient.ts` imports either plane s credential source', async () => {
    const coordinator = await computeClosure({
      name: 'S1P_COORDINATOR',
      entryPoints: ['validation/sendgrid/harness/cli.ts', 'validation/sendgrid/harness/probeClient.ts'],
    });
    // NON-VACUOUS: the closure really reached the coordinator.
    expect(coordinator.modules).toContain('validation/sendgrid/harness/cli.ts');
    expect(coordinator.modules).toContain('validation/sendgrid/harness/probeClient.ts');

    /*
     * THE REJECTED CLI IMPORTED BOTH OF THESE AND CALLED BOTH OF THEM.
     *
     * `createAdapterSecretSource` and `createAuditReadSecretSource` are the only two routes to
     * vendor material in this package, and neither is in the coordinator's module graph.
     */
    expect(coordinator.modules).not.toContain('validation/sendgrid/integration/secretSource.ts');
    expect(coordinator.modules).not.toContain('validation/sendgrid/audit/secretSource.ts');
    // Nor either provider client, so the coordinator cannot reach the vendor at all.
    expect(coordinator.modules).not.toContain('validation/sendgrid/integration/providerClient.ts');
    expect(coordinator.modules).not.toContain('validation/sendgrid/audit/providerReadClient.ts');
    expect(coordinator.modules).not.toContain('validation/sendgrid/harness/scopeProbes.ts');
  });

  it('and the probe RUNTIME does reach them — so the split is real, not vacuous', async () => {
    const child = await computeClosure({
      name: 'S1P_PROBE_RUNTIME',
      entryPoints: ['validation/sendgrid/harness/probeMain.ts'],
    });
    expect(child.modules).toContain('validation/sendgrid/harness/probeRuntime.ts');
    expect(child.modules).toContain('validation/sendgrid/harness/scopeProbes.ts');
  });
});

describe('`§5` — THE ALLOWLIST HAS **ONE** LOCATOR SLOT, SO TWO CANNOT BE PASSED', () => {
  it('the constructed environment is exactly the declared seven keys', () => {
    const environment = buildProbeEnvironment({
      role: 'IDENTITY',
      plane: 'INTEGRATION',
      sourceModule: INTEGRATION_SECRET_SOURCE_MODULE,
      locator: INTEGRATION_LOCATOR,
      expectedCredentialId: 'twilio_sendgrid.validation_send',
      operands: {},
    });
    expect(Object.keys(environment).sort()).toEqual([...S1P_PROBE_ENV_KEYS].sort());
    // ONE locator value, and the other plane's path appears nowhere in it.
    expect(JSON.stringify(environment)).not.toContain(AUDIT_LOCATOR);
  });

  it('every role is a member of the closed enum, and `SEND_PROBE` is the audit key s alone', async () => {
    expect([...S1P_PROBE_ROLES]).toContain('SEND_PROBE');
    const refused = await runCredentialProbe({
      role: 'SEND_PROBE',
      plane: 'INTEGRATION',
      sourceModule: INTEGRATION_SECRET_SOURCE_MODULE,
      locator: INTEGRATION_LOCATOR,
      expectedCredentialId: 'twilio_sendgrid.validation_send',
    });
    expect(refused.kind).toBe('REPLY');
    if (refused.kind !== 'REPLY') return;
    expect(refused.reply.kind).toBe('PROBE_REFUSED');
    if (refused.reply.kind !== 'PROBE_REFUSED') return;
    /*
     * `§5.1` — `36 §13` asks whether the READ-ONLY credential can write. Asking it of the SEND
     * credential would be a deliberate unauthorised send, and it is refused BEFORE a credential
     * is resolved.
     */
    expect(refused.reply.reason).toBe('ROLE_NOT_PERMITTED_ON_PLANE');
  }, 60_000);
});

describe('`§19` item 5 — THE CHILD REPORTS ITS OWN ENVIRONMENT, AND IT HOLDS ONE LOCATOR', () => {
  it('an INTEGRATION identity probe sees its own locator and NOT the audit one', async () => {
    const launched = await runCredentialProbe({
      role: 'IDENTITY',
      plane: 'INTEGRATION',
      sourceModule: INTEGRATION_SECRET_SOURCE_MODULE,
      locator: INTEGRATION_LOCATOR,
      expectedCredentialId: 'twilio_sendgrid.validation_send',
    });
    expect(launched.kind).toBe('REPLY');
    if (launched.kind !== 'REPLY' || launched.reply.kind !== 'IDENTITY_FACTS') {
      throw new Error(`expected identity facts, got ${JSON.stringify(launched)}`);
    }
    const facts = launched.reply.facts;

    expect(facts.plane).toBe('INTEGRATION');
    expect(facts.resolved).toBe(true);
    expect(facts.resolvedIdentity).toBe('twilio_sendgrid.validation_send');
    expect(facts.identityMatchedExpectation).toBe(true);
    // CORRECTION 3: a file-backed source reports the FIXTURE provenance, so the live gate fails.
    expect(facts.identityProvenance).toBe('SYNTHETIC_TEST_IDENTITY');

    // A DIFFERENT PROCESS. `§5`'s whole premise.
    expect(facts.pid).not.toBe(process.pid);

    /*
     * THE CHILD'S OWN ACCOUNT OF ITS ENVIRONMENT — the only evidence that is not the parent's.
     *
     * The audit plane's keys are absent because they were never passed, and the audit
     * locator's VALUE cannot be present because the allowlist has one slot for a locator.
     */
    for (const key of facts.environmentKeys) {
      expect(key, key).not.toContain('AUDIT');
    }
    expect(facts.environmentKeys).toContain('ACOS_S1P_PROBE_LOCATOR');
  }, 60_000);

  it('an AUDIT identity probe is a SECOND, SEPARATE process holding the other credential', async () => {
    const launched = await runCredentialProbe({
      role: 'IDENTITY',
      plane: 'AUDIT',
      sourceModule: AUDIT_SECRET_SOURCE_MODULE,
      locator: AUDIT_LOCATOR,
      expectedCredentialId: 'twilio_sendgrid.validation_audit_read',
    });
    if (launched.kind !== 'REPLY' || launched.reply.kind !== 'IDENTITY_FACTS') {
      throw new Error(`expected identity facts, got ${JSON.stringify(launched)}`);
    }
    expect(launched.reply.facts.plane).toBe('AUDIT');
    expect(launched.reply.facts.resolvedIdentity).toBe('twilio_sendgrid.validation_audit_read');
    expect(launched.reply.facts.pid).not.toBe(process.pid);
  }, 60_000);

  it('NEITHER reply carries the material — `ProbeReply` has nowhere to put one', async () => {
    const launched = await runCredentialProbe({
      role: 'IDENTITY',
      plane: 'INTEGRATION',
      sourceModule: INTEGRATION_SECRET_SOURCE_MODULE,
      locator: INTEGRATION_LOCATOR,
      expectedCredentialId: 'twilio_sendgrid.validation_send',
    });
    const serialised = JSON.stringify(launched);
    const material = JSON.parse(readFileSync(INTEGRATION_LOCATOR, 'utf8')) as {
      readonly apiKey: string;
    };
    expect(serialised).not.toContain(material.apiKey);
    expect(serialised).not.toContain('TEST_ONLY_VENDOR_SECRET');
  }, 60_000);
});

describe('`§19` item 6 — A STAGE-1 REFUSAL TOUCHES ZERO SECRET SOURCES', () => {
  it('on THIS repository the run refuses at stage 1, so no probe is ever launched', () => {
    /*
     * ASSERTED AS AN ORDER PROPERTY OVER THE REAL FACTS.
     *
     * `establishStage1Facts` reads the trusted configuration and the verified bundle and
     * NOTHING ELSE — it imports no secret source and forks no process. Its result refuses, and
     * `main` reaches `establishStage2Facts` only when that list is empty.
     */
    const { facts } = establishStage1Facts({
      [ENV_LIVE_ACK]: LIVE_ACK_TOKEN,
      [ENV_NON_PRODUCTION_ACK]: NON_PRODUCTION_ACK_TOKEN,
      // BOTH locators are supplied, and neither is read, because the gate refuses first.
      [ENV_INTEGRATION_LOCATOR]: INTEGRATION_LOCATOR,
      [ENV_AUDIT_LOCATOR]: AUDIT_LOCATOR,
      [ENV_CONFIG]: '/no/such/config.json',
    });
    expect(evaluateStage1(facts).length).toBeGreaterThan(0);
  });

  it('and `cli.ts` calls the probe client exactly once, INSIDE the stage-1 guard', () => {
    /*
     * A SOURCE-LEVEL ASSERTION, because the property is about ORDER and the rejected code's
     * comments claimed the correct order while the code did the opposite.
     *
     * `runCredentialProbe` is reached only from `establishStage2Facts`, and
     * `establishStage2Facts` is called from exactly one place: inside
     * `if (stage1Failures.length === 0 && config !== null)`.
     */
    const source = readFileSync(join('validation', 'sendgrid', 'harness', 'cli.ts'), 'utf8');
    const callSites = [...source.matchAll(/establishStage2Facts\(/g)];
    // One declaration, one call.
    expect(callSites).toHaveLength(2);
    const guardIndex = source.indexOf('if (stage1Failures.length === 0 && config !== null)');
    expect(guardIndex).toBeGreaterThan(0);
    const callIndex = source.lastIndexOf('await establishStage2Facts(');
    expect(callIndex).toBeGreaterThan(guardIndex);
    // And the facts the gate reads are established by a function that imports no source.
    expect(source.indexOf('export function establishStage1Facts')).toBeLessThan(guardIndex);
  });
});
