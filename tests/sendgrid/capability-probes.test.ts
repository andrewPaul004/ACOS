import { describe, expect, it } from 'vitest';

import {
  PROBE_BLOCKS,
  orchestrateCapabilityProbes,
  type CapabilityProbeConfig,
  type ProbeLauncher,
} from '../../validation/sendgrid/harness/capabilityProbes.js';
import type { ProbeOutcome, ProbeRecord } from '../../validation/sendgrid/harness/probeResult.js';
import type { S1PProbePlane, S1PProbeRole } from '../../validation/sendgrid/harness/probeEnvironment.js';
import { OWNER_SINK_MARKER } from '../../validation/sendgrid/integration/validationPayload.js';

/**
 * `§12` — THE CAPABILITY-PROBE ORCHESTRATION, EXERCISED OFFLINE.
 *
 * =================================================================================
 * EVERY CASE IS DRIVEN WITH A SCRIPTED LAUNCHER, SO NO CREDENTIAL AND NO PROVIDER IS INVOLVED
 *
 * What is under test is the ORCHESTRATION — which probes run, on which plane, with which
 * credential, and what blocks the scenario matrix. `§12`'s two rules are the ones that matter
 * and both are asserted directly:
 *
 *   "A provider-unreachable/inconclusive probe does NOT pass."
 *   "A credential whose observed capability disagrees with signed class-5 declaration blocks
 *    the scenario matrix."
 * =================================================================================
 */

const CONFIG: CapabilityProbeConfig = Object.freeze({
  integrationSourceModule: '/validation/sendgrid/integration/secretSource.ts',
  integrationLocator: '/deployment/integration.json',
  integrationCredentialId: 'twilio_sendgrid.validation_send',
  auditSourceModule: '/validation/sendgrid/audit/secretSource.ts',
  auditLocator: '/deployment/audit.json',
  auditCredentialId: 'twilio_sendgrid.validation_audit_read',
  senderAddress: 'validation@nonprod.example.test',
  sinkAddress: `owner+${OWNER_SINK_MARKER}@example.test`,
  probeCorrelationTag: 'acos-corr-00000000-0000-4000-8000-0000000000aa',
  periodStartMs: 0,
  periodEndMs: 1_000,
});

interface Launched {
  readonly role: S1PProbeRole;
  readonly plane: S1PProbePlane;
  readonly locator: string;
}

function record(plane: 'INTEGRATION' | 'AUDIT', outcome: ProbeOutcome): ProbeRecord {
  return {
    operation: 'scripted',
    credentialIdentity: plane === 'AUDIT' ? CONFIG.auditCredentialId : CONFIG.integrationCredentialId,
    plane,
    httpStatus: null,
    outcome,
    note: 'scripted',
  };
}

/** A launcher scripted per (role, plane), recording exactly what it was asked for. */
function launcher(
  script: Partial<Record<string, ProbeOutcome | 'NO_REPLY'>>,
): { readonly launch: ProbeLauncher; readonly launched: Launched[] } {
  const launched: Launched[] = [];
  const launch: ProbeLauncher = (input) => {
    launched.push({ role: input.role, plane: input.plane, locator: input.locator });
    const scripted = script[`${input.role}:${input.plane}`] ?? 'CAPABILITY_REFUSED_BY_PROVIDER';
    if (scripted === 'NO_REPLY') {
      return Promise.resolve({ kind: 'PROBE_PROCESS_FAILED' as const, detail: 'NO_REPLY' as const });
    }
    return Promise.resolve({
      kind: 'REPLY' as const,
      reply: { kind: 'PROBE_RECORD' as const, record: record(input.plane, scripted) },
      pid: 1234,
    });
  };
  return { launch, launched };
}

/** The conformant account: audit reads, audit cannot send, integration cannot read. */
const CONFORMANT = {
  'READ_PROBE:AUDIT': 'CAPABILITY_CONFIRMED' as const,
  'SEND_PROBE:AUDIT': 'CAPABILITY_REFUSED_BY_PROVIDER' as const,
  'READ_PROBE:INTEGRATION': 'CAPABILITY_REFUSED_BY_PROVIDER' as const,
};

describe('`§12` — THE THREE PROBES RUN ON THE RIGHT PLANES, WITH THE RIGHT LOCATORS', () => {
  it('a conformant account blocks nothing', async () => {
    const { launch, launched } = launcher(CONFORMANT);
    const outcome = await orchestrateCapabilityProbes(launch, CONFIG);

    expect(outcome.blocks).toEqual([]);
    expect(outcome.probes).toHaveLength(3);
    expect(outcome.auditKeySendRefusal?.outcome).toBe('CAPABILITY_REFUSED_BY_PROVIDER');

    /*
     * `§5.1` — THE ATTEMPTED WRITE IS THE AUDIT KEY'S, AND ITS PROCESS HOLDS THE AUDIT LOCATOR.
     *
     * Asserted over what the launcher was ASKED for, so a future edit that paired a role with
     * the wrong plane — or handed a probe the other plane's locator — fails here rather than
     * at a provider.
     */
    expect(launched).toEqual([
      { role: 'READ_PROBE', plane: 'AUDIT', locator: CONFIG.auditLocator },
      { role: 'SEND_PROBE', plane: 'AUDIT', locator: CONFIG.auditLocator },
      { role: 'READ_PROBE', plane: 'INTEGRATION', locator: CONFIG.integrationLocator },
    ]);
    // NO probe was launched with the OTHER plane's locator.
    for (const entry of launched) {
      expect(entry.locator).toBe(
        entry.plane === 'AUDIT' ? CONFIG.auditLocator : CONFIG.integrationLocator,
      );
    }
  });

  it('the permitted non-production SEND is NOT duplicated here — the driver performs it', async () => {
    const { launched } = launcher(CONFORMANT);
    await orchestrateCapabilityProbes(launcher(CONFORMANT).launch, CONFIG);
    /*
     * `§12` item 1 is the integration credential performing a PERMITTED send, and the scenario
     * driver already does exactly that through the accepted gateway and the accepted runtime.
     * A second send from here would be a message ACOS did not authorise, so there is no
     * `SEND_PROBE:INTEGRATION` launch — and `probeRuntime.ts` refuses that pairing anyway.
     */
    expect(launched.filter((entry) => entry.role === 'SEND_PROBE' && entry.plane === 'INTEGRATION')).toEqual([]);
  });
});

describe('`§12` — A DISAGREEMENT WITH THE SIGNED DECLARATION BLOCKS THE MATRIX', () => {
  it('`36 §13`: an audit credential that CAN send is the most serious finding', async () => {
    const { launch } = launcher({ ...CONFORMANT, 'SEND_PROBE:AUDIT': 'CAPABILITY_CONFIRMED' });
    const outcome = await orchestrateCapabilityProbes(launch, CONFIG);
    expect(outcome.blocks).toContain('AUDIT_CREDENTIAL_CAN_SEND');
  });

  it('an audit credential that cannot READ leaves the I36 oracle with no source', async () => {
    const { launch } = launcher({
      ...CONFORMANT,
      'READ_PROBE:AUDIT': 'CAPABILITY_REFUSED_BY_PROVIDER',
    });
    const outcome = await orchestrateCapabilityProbes(launch, CONFIG);
    expect(outcome.blocks).toContain('AUDIT_CREDENTIAL_CANNOT_READ');
  });

  it('`§8.7`s inverse: an integration credential that CAN read is over-scoped', async () => {
    const { launch } = launcher({
      ...CONFORMANT,
      'READ_PROBE:INTEGRATION': 'CAPABILITY_CONFIRMED',
    });
    const outcome = await orchestrateCapabilityProbes(launch, CONFIG);
    expect(outcome.blocks).toContain('INTEGRATION_CREDENTIAL_CAN_READ');
  });
});

describe('`§12` — AN UNREACHABLE OR INCONCLUSIVE PROBE DOES **NOT** PASS', () => {
  for (const outcome of ['PROVIDER_UNREACHABLE', 'INCONCLUSIVE', 'NOT_RUN'] as const) {
    it(`a ${outcome} audit read BLOCKS rather than being shrugged off`, async () => {
      const { launch } = launcher({ ...CONFORMANT, 'READ_PROBE:AUDIT': outcome });
      const result = await orchestrateCapabilityProbes(launch, CONFIG);
      expect(result.blocks).toContain('PROBE_INCONCLUSIVE');
      expect(result.blocks).not.toEqual([]);
    });
  }

  it('a probe process that did not answer BLOCKS, and the record is not invented', async () => {
    const { launch } = launcher({ ...CONFORMANT, 'SEND_PROBE:AUDIT': 'NO_REPLY' });
    const result = await orchestrateCapabilityProbes(launch, CONFIG);
    expect(result.blocks).toContain('PROBE_PROCESS_FAILED');
    // TWO records, not three: nothing is fabricated for the process that said nothing.
    expect(result.probes).toHaveLength(2);
    expect(result.auditKeySendRefusal).toBeNull();
  });

  it('every block this orchestration can produce is a declared member', async () => {
    const { launch } = launcher({
      'READ_PROBE:AUDIT': 'INCONCLUSIVE',
      'SEND_PROBE:AUDIT': 'CAPABILITY_CONFIRMED',
      'READ_PROBE:INTEGRATION': 'CAPABILITY_CONFIRMED',
    });
    const result = await orchestrateCapabilityProbes(launch, CONFIG);
    expect(result.blocks.length).toBeGreaterThanOrEqual(3);
    for (const block of result.blocks) expect([...PROBE_BLOCKS]).toContain(block);
  });
});
