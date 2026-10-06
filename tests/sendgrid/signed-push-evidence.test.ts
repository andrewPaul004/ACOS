import { readFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { join } from 'node:path';

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  observeCorrelation as observeStore,
  pushInverseObservation as inverseStore,
  type CorrelationObservation,
} from '../../src/audit/providerEvidence/evidenceReader.js';
import {
  startProviderEvidenceIngress,
  type StartedProviderEvidenceIngress,
} from '../../src/audit/providerEvidence/ingressMain.js';
import { compareI20 } from '../../validation/sendgrid/harness/i20.js';
import {
  ENV_AUDIT_PG_URL,
  describeLiveComposition,
  verifiedEvidenceModeFor,
  type CompositionInput,
} from '../../validation/sendgrid/harness/liveComposition.js';
import {
  SIGNED_PUSH_LIVE_VISIBILITY_BOUND,
  observePushCorrelation,
  runPushInverseObservation,
  type SignedPushEvidencePort,
} from '../../validation/sendgrid/harness/pushEvidence.js';
import { runAllScenarios, runScenario, verdictFor } from '../../validation/sendgrid/harness/scenarioDriver.js';
import { KILL_POINT_ROWS } from '../../validation/sendgrid/harness/killPoints.js';
import { FIXTURE_VISIBILITY_BOUND } from '../../validation/sendgrid/harness/visibilityBound.js';
import { readAccount } from '../sendgrid-doubles/simulatedAccount.js';
import {
  buildControlArtifactFixture,
  verifyFixtureBundle,
  withArtifactBytes,
} from '../support/controlArtifactFixture.js';
import { createOutboxHarness, type OutboxHarness } from '../support/outboxFixture.js';
import {
  ACCEPTED_EVENT_CLASSES,
  TEST_PROVIDER,
  bodyOf,
  correlationTag,
  ingressEnvironment,
  processedEvent,
  providerEvidenceArtifactFixture,
  pushRecord,
  readRecord,
  signWebhook,
  testIngressStore,
} from '../support/providerEvidenceFixture.js';
import { createS1PScenario, s1pValidationArtifacts, type S1PScenario } from '../support/s1pScenarioFixture.js';

/**
 * v1.3.8, ADR-027 — THE S1P HARNESS UNDER `SIGNED_PROVIDER_PUSH`.
 *
 * The oracle reads the AUDIT STORE's authenticated push evidence; it never calls `/v3/messages`,
 * never reads Email Activity and holds no SendGrid read key. The offline composition below sends
 * through the accepted gateway, outbox and forked integration runtime exactly as the read-mode
 * matrix does — and then a TEST relay plays the provider's role: it POSTs every accepted message
 * as a SIGNED `processed` event to a REAL ingress, which verifies, normalises and durably records
 * it, and the oracle reads what the ingress committed.
 */

function observation(
  ids: readonly string[],
  knownIncomplete = false,
): CorrelationObservation {
  return {
    provider: TEST_PROVIDER,
    correlationTag: 'acos-corr-x',
    providerMessageIds: ids,
    observedAcceptedCount: ids.length,
    knownIncomplete,
    incompleteReasons: knownIncomplete ? ['BODY_NOT_ARRAY'] : [],
    completenessEstablished: false,
    i36: ids.length >= 2 ? 'EXCESS_DUPLICATE_SEND_EVIDENCE' : ids.length === 1 ? 'ONE_OBSERVED_NOT_FINAL' : 'NONE_OBSERVED_NOT_FINAL',
  };
}

function scripted(answers: readonly CorrelationObservation[]): SignedPushEvidencePort & { calls: number } {
  const port = {
    calls: 0,
    observe: () => {
      const answer = answers[Math.min(port.calls, answers.length - 1)]!;
      port.calls += 1;
      return Promise.resolve(answer);
    },
    inverse: () => Promise.reject(new Error('the scripted port answers observe() only')),
  };
  return port;
}

const BOUND = {
  correlationTag: 'acos-corr-x',
  periodStartMs: 0,
  periodEndMs: 1,
  maxAttempts: 6,
  intervalMs: 0,
  maxDurationMs: 60_000,
  stabilisationObservations: 2,
  lastPossibleWriteAtMs: 0,
};

const deps = (port: SignedPushEvidencePort) => ({ port, delay: () => Promise.resolve(), now: () => 0 });

describe('`observePushCorrelation` — the same oracle contract over push evidence', () => {
  it('two distinct message ids are reported IMMEDIATELY, and the accepted verdict FAILS the row', async () => {
    const port = scripted([observation(['m1', 'm2'], true)]);
    const result = await observePushCorrelation(deps(port), {
      ...BOUND,
      visibilityBound: SIGNED_PUSH_LIVE_VISIBILITY_BOUND,
    });
    expect(result.outcome).toBe('PROVIDER_ACTIVITY_OBSERVED');
    expect(result.providerAcceptedCount).toBe(2);
    expect(port.calls).toBe(1);
    const row = KILL_POINT_ROWS.find((entry) => entry.point === 5)!;
    expect(
      verdictFor({
        row,
        localOutboxStatus: row.expectedOutboxStatus,
        localOutcomeRows: row.expectedOutcomeRowsInSeparateProcessComposition ?? row.expectedOutcomeRows,
        recovery: row.expectedRecovery,
        observationBefore: result,
        observationAfter: result,
      }).verdict,
    ).toBe('FAIL');
  });

  it('known-incomplete evidence yields NO count — a readable sibling is not a count of one', async () => {
    const result = await observePushCorrelation(deps(scripted([observation(['m1'], true)])), {
      ...BOUND,
      visibilityBound: FIXTURE_VISIBILITY_BOUND,
    });
    expect(result.outcome).toBe('STABILISATION_UNRESOLVED');
    expect(result.providerAcceptedCount).toBeNull();
    expect(result.providerMessageIds).toEqual(['m1']);
    const none = await observePushCorrelation(deps(scripted([observation([], true)])), {
      ...BOUND,
      visibilityBound: FIXTURE_VISIBILITY_BOUND,
    });
    expect(none.providerAcceptedCount).toBeNull();
  });

  it('zero is NOT_OBSERVED_WITHIN_BOUND — never "not sent" — and polling the store never settles it', async () => {
    const port = scripted([observation([])]);
    const result = await observePushCorrelation(deps(port), {
      ...BOUND,
      visibilityBound: SIGNED_PUSH_LIVE_VISIBILITY_BOUND,
    });
    expect(result.outcome).toBe('NOT_OBSERVED_WITHIN_BOUND');
    expect(result.providerAcceptedCount).toBe(0);
    expect(result.settlingIntervalCompleted).toBe(false);
    expect(port.calls).toBe(6);
    expect(result.attempts.every((attempt) => attempt.operation === 'AUDIT_STORE_PUSH_EVIDENCE_QUERY')).toBe(true);
  });

  it('one id under the LIVE push bound is an observation whose absence claim is withheld', async () => {
    const result = await observePushCorrelation(deps(scripted([observation(['m1'])])), {
      ...BOUND,
      visibilityBound: SIGNED_PUSH_LIVE_VISIBILITY_BOUND,
    });
    expect(result.outcome).toBe('PROVIDER_ACTIVITY_OBSERVED');
    expect(result.providerAcceptedCount).toBe(1);
    expect(result.settlingIntervalCompleted).toBe(false);
    expect(result.visibilityBoundKind).toBe('UNESTABLISHED');
  });

  it('the push I8 adapter never reports ALL_PROVIDER_RECORDS_ACCOUNTED', async () => {
    const quiet = await runPushInverseObservation(
      {
        inverse: () =>
          Promise.resolve({ outcome: 'NO_UNACCOUNTED_ACTIVITY_SEEN_PERIOD_INCOMPLETE' as const, examinedEvents: 3, unaccounted: [] }),
      },
      { periodStartMs: 0, periodEndMs: 1, accountedCorrelationTags: new Set() },
    );
    expect(quiet.outcome).toBe('SWEEP_INCOMPLETE');
    const found = await runPushInverseObservation(
      {
        inverse: () =>
          Promise.resolve({
            outcome: 'UNACCOUNTED_PROVIDER_ACTIVITY' as const,
            examinedEvents: 1,
            unaccounted: [{ sgMessageId: 'm', correlationTag: 'acos-corr-y', eventClass: 'processed' }],
          }),
      },
      { periodStartMs: 0, periodEndMs: 1, accountedCorrelationTags: new Set() },
    );
    expect(found.outcome).toBe('UNACCOUNTED_PROVIDER_RECORDS');
  });
});

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

describe('the live composition SELECTS the mode from the VERIFIED class-28 record', () => {
  function input(channels: Record<string, unknown>[], environment: Record<string, string | undefined> = {}): CompositionInput {
    const { fixture } = s1pValidationArtifacts();
    void fixture;
    const bytes = Buffer.from(
      `${JSON.stringify({ artifact_id: 'acos.control.provider_evidence_trust', artifact_version: 'acos.provider_evidence_trust.2026-10-03', channels }, null, 2)}\n`,
      'utf8',
    );
    const bundle = verifyFixtureBundle(
      buildControlArtifactFixture({ mutate: (artifacts) => withArtifactBytes(artifacts, 28, () => bytes) }),
    );
    return {
      environment,
      config: {
        environmentLabel: 'nonprod-validation',
        senderAddress: 'validation@nonprod.example.test',
        sinkAddress: 'owner+acos-validation-sink@example.test',
        integrationCredentialId: 'twilio_sendgrid.validation_send',
        auditCredentialId: 'twilio_sendgrid.validation_audit_read',
      },
      bundle,
      integrationLocator: 'integration.json',
      auditLocator: 'audit.json',
      visibilityBound: SIGNED_PUSH_LIVE_VISIBILITY_BOUND,
    };
  }

  it('no channel for the provider is a named SIGNATURE prerequisite', () => {
    const availability = describeLiveComposition(input([readRecord()]));
    expect(availability.blocks).toContain('PROVIDER_EVIDENCE_CHANNEL_NOT_DECLARED');
  });

  it('SIGNED_PROVIDER_PUSH needs the audit evidence store and NOT the audit reader runtime', () => {
    const push = input([pushRecord()]);
    expect(verifiedEvidenceModeFor(push.bundle!)).toBe('SIGNED_PROVIDER_PUSH');
    const without = describeLiveComposition(push);
    expect(without.blocks).toContain('AUDIT_EVIDENCE_STORE_NOT_CONFIGURED');
    expect(without.blocks).not.toContain('AUDIT_RUNTIME_MODULE_MISSING');
    const withStore = describeLiveComposition(input([pushRecord()], { [ENV_AUDIT_PG_URL]: 'postgres://example.invalid/audit' }));
    expect(withStore.blocks).not.toContain('AUDIT_EVIDENCE_STORE_NOT_CONFIGURED');
    expect(withStore.blocks).not.toContain('PROVIDER_EVIDENCE_CHANNEL_NOT_DECLARED');
  });

  it('a push composition is described WITHOUT an audit locator or an audit credential id', () => {
    const push = input([pushRecord()], { [ENV_AUDIT_PG_URL]: 'postgres://example.invalid/audit' });
    const availability = describeLiveComposition({
      ...push,
      auditLocator: null,
      config: { ...push.config, auditCredentialId: null },
    });
    expect(availability.blocks).not.toContain('AUDIT_RUNTIME_MODULE_MISSING');
    expect(availability.blocks).not.toContain('AUDIT_EVIDENCE_STORE_NOT_CONFIGURED');
    expect(availability.blocks).not.toContain('PROVIDER_EVIDENCE_CHANNEL_NOT_DECLARED');
  });

  it('`openLiveComposition` touches the audit READ credentials and reader client ONLY in its PROVIDER_READ branch', () => {
    /*
     * A SOURCE-LEVEL ASSERTION, because opening the live composition needs a control database,
     * a decision key and provisioned constructor records. The property is about WHERE the
     * read-credential map and the reader client are reachable: only after the push branch has
     * been excluded, never on the push path.
     */
    const source = readFileSync(join('validation', 'sendgrid', 'harness', 'liveComposition.ts'), 'utf8');
    const pushBranch = source.indexOf("if (auditChannel.evidenceMode === 'SIGNED_PROVIDER_PUSH') {");
    const readBranch = source.indexOf('} else {', pushBranch);
    const readBranchEnd = source.indexOf('const runtime: ScenarioRuntimeConfig', readBranch);
    expect(pushBranch).toBeGreaterThan(0);
    expect(readBranch).toBeGreaterThan(pushBranch);
    for (const token of ['auditReadCredentials', 'new AuditReadClient(', 'createAuditReaderRegistry(', 'input.auditLocator']) {
      const uses = [...source.matchAll(new RegExp(escapeRegExp(token), 'g'))].map(
        (match) => match.index,
      );
      expect(uses.length, token).toBeGreaterThan(0);
      for (const at of uses) {
        // Every use sits inside the READ branch (the push branch precedes it and has none).
        expect(at > readBranch && at < readBranchEnd, `${token} at ${String(at)}`).toBe(true);
      }
    }
    // And the push branch refuses an audit-reader launch rather than serving one.
    const pushBody = source.slice(pushBranch, readBranch);
    expect(pushBody).toContain('no SendGrid audit reader exists in this composition');
    expect(pushBody).toContain('auditReader = null');
  });

  it('PROVIDER_READ keeps the read path exactly as it was', () => {
    const read = input([readRecord({ provider: 'twilio_sendgrid', accepted_count_operand: 'msg_id' })]);
    expect(verifiedEvidenceModeFor(read.bundle!)).toBe('PROVIDER_READ');
    expect(describeLiveComposition(read).blocks).not.toContain('AUDIT_EVIDENCE_STORE_NOT_CONFIGURED');
  });
});

// =====================================================================================
// THE OFFLINE SIX-SCENARIO MATRIX, ON PUSH EVIDENCE, THROUGH A REAL INGRESS.
// =====================================================================================

let h: OutboxHarness;
let scenario: S1PScenario | null = null;
let ingress: StartedProviderEvidenceIngress | null = null;

beforeAll(async () => {
  h = await createOutboxHarness();
}, 120_000);

afterAll(async () => {
  await h.close();
});

beforeEach(async () => {
  await h.reset();
});

afterEach(async () => {
  if (scenario !== null) await scenario.cleanup();
  scenario = null;
  if (ingress !== null) await ingress.close();
  ingress = null;
});

/** POST exact bytes, with a `Host` the ingress's signed identity names. */
function postSigned(port: number, body: Buffer, timestamp: string): Promise<number> {
  return new Promise((resolveStatus, rejectStatus) => {
    const request = httpRequest(
      {
        host: '127.0.0.1',
        port,
        method: 'POST',
        path: '/provider-evidence/sendgrid',
        setHost: false,
        headers: {
          Host: 'webhook.example.test',
          'Content-Type': 'application/json',
          'Content-Length': String(body.length),
          'X-Twilio-Email-Event-Webhook-Signature': signWebhook(timestamp, body),
          'X-Twilio-Email-Event-Webhook-Timestamp': timestamp,
        },
      },
      (response) => {
        response.resume();
        resolveStatus(response.statusCode ?? 0);
      },
    );
    request.on('error', rejectStatus);
    request.end(body);
  });
}

/**
 * The TEST stand-in for the provider's push: every message the simulated account accepted is
 * POSTed as a signed `processed` event. The event identity is derived from the message identity,
 * so a re-POST is a REDELIVERY the ingress deduplicates — exactly the provider's own shape.
 */
async function relaySimulatedAccount(accountPath: string, port: number): Promise<void> {
  const account = readAccount(accountPath);
  const events = account.messages
    .filter((message) => message.categories[0] !== undefined)
    .map((message) =>
      processedEvent(message.categories[0]!, {
        sg_event_id: `evt-${message.msg_id}`,
        sg_message_id: message.msg_id,
        timestamp: 1_760_000_000,
      }),
    );
  if (events.length === 0) return;
  const status = await postSigned(port, bodyOf(events), '1760000000');
  if (status !== 204) throw new Error(`the ingress refused the relayed batch: ${String(status)}`);
}

async function pushScenario(liveBound = false): Promise<S1PScenario> {
  ingress = await (async () => {
    const started = await startProviderEvidenceIngress({
      environment: ingressEnvironment(providerEvidenceArtifactFixture()),
      log: () => undefined,
      ...testIngressStore(),
    });
    if (!started.ready) throw new Error(started.refusal);
    return started;
  })();
  const base = createS1PScenario(h);
  const port = ingress.port;
  const signedPushEvidence: SignedPushEvidencePort = {
    observe: async (query) => {
      await relaySimulatedAccount(base.accountPath, port);
      return observeStore(h.auditEvaluator, {
        provider: TEST_PROVIDER,
        correlationTag: query.correlationTag,
        acceptedEventClasses: ACCEPTED_EVENT_CLASSES,
        receivedFrom: new Date(0),
        receivedTo: new Date(Date.now() + 86_400_000),
      });
    },
    inverse: async (query) => {
      await relaySimulatedAccount(base.accountPath, port);
      return inverseStore(h.auditEvaluator, {
        provider: TEST_PROVIDER,
        accountedCorrelationTags: query.accountedCorrelationTags,
        acceptedEventClasses: ACCEPTED_EVENT_CLASSES,
        receivedFrom: new Date(query.periodStartMs),
        receivedTo: new Date(query.periodEndMs),
      });
    },
  };
  return {
    ...base,
    ports: {
      ...base.ports,
      signedPushEvidence,
      // UNDER PUSH, NO AUDIT READER MAY BE LAUNCHED. A launch is a failure of the test.
      launchAuditReader: () => Promise.reject(new Error('an audit READER was launched under SIGNED_PROVIDER_PUSH')),
      ...(liveBound ? { visibilityBound: SIGNED_PUSH_LIVE_VISIBILITY_BOUND } : {}),
    },
  };
}

describe('ALL SIX POINTS, ON SIGNED PUSH EVIDENCE — the accepted path, a real ingress, the audit store', () => {
  it('the matrix shape matches the read-mode matrix, and I20 compares on push evidence', async () => {
    scenario = await pushScenario();
    const results = await runAllScenarios(scenario.runtime, scenario.ports);
    const byPoint = new Map(results.map((result) => [result.row.point, result.row]));
    expect(byPoint.get(1)?.verdict).toBe('UNRESOLVED');
    expect(byPoint.get(2)?.verdict).toBe('UNRESOLVED');
    for (const point of [3, 4, 5] as const) {
      expect(byPoint.get(point)?.verdict, byPoint.get(point)?.note).toBe('PASS');
    }
    expect(results.filter((result) => result.row.verdict === 'FAIL')).toEqual([]);
    const comparison = compareI20(results.map((result) => result.i20Operand));
    expect(comparison.verdict).toBe('WITHIN_BASIS');
    expect(comparison.providerAcceptedIrrecoverableEffects).toBe(4);
    // EVERY count came from the AUDIT STORE: the events the ingress committed.
    const committed = await h.auditEvaluator.query<{ n: string }>(
      'SELECT COUNT(DISTINCT sg_message_id)::TEXT AS n FROM provider_evidence_event',
    );
    expect(Number(committed.rows[0]!.n)).toBe(4);
  }, 300_000);

  it('under the LIVE push bound no row PASSES on an absence claim', async () => {
    scenario = await pushScenario(true);
    const row = KILL_POINT_ROWS.find((entry) => entry.point === 5)!;
    const result = await runScenario(scenario.runtime, scenario.ports, row);
    expect(result.row.verdict).toBe('UNRESOLVED');
    expect(result.row.providerAcceptedCount).toBe(1);
    // I20: the observed ONE is a lower bound; the exact operand is null, never 1.
    expect(result.i20Operand.providerAcceptedCount).toBeNull();
    // F — the identities are COPIED from the observation the row was judged on.
    expect(result.i20Operand.observedProviderMessageIds).toEqual(result.row.observation?.providerMessageIds);
    expect(result.i20Operand.observedProviderMessageIds).toHaveLength(1);
  }, 300_000);

  it('a live push ZERO (kill point 2) is a null exact operand, never an exact zero', async () => {
    scenario = await pushScenario(true);
    const row = KILL_POINT_ROWS.find((entry) => entry.point === 2)!;
    const result = await runScenario(scenario.runtime, scenario.ports, row);
    expect(result.row.verdict).toBe('UNRESOLVED');
    expect(result.i20Operand.providerAcceptedCount).toBeNull();
    expect(result.i20Operand.observedProviderMessageIds).toEqual([]);
  }, 300_000);

  it('THE WHOLE LIVE PUSH MATRIX: point 6 UNRESOLVED and I20 UNRESOLVED with 4 observed', async () => {
    scenario = await pushScenario(true);
    const results = await runAllScenarios(scenario.runtime, scenario.ports);
    expect(results.filter((result) => result.row.verdict === 'FAIL')).toEqual([]);
    expect(results.filter((result) => result.row.verdict === 'PASS')).toEqual([]);
    const six = results.find((result) => result.row.point === 6)!.row;
    expect(six.verdict).toBe('UNRESOLVED');
    expect(six.redispatchOccurred).toBeNull();
    const comparison = compareI20(results.map((result) => result.i20Operand));
    expect(comparison.verdict).toBe('UNRESOLVED');
    expect(comparison.providerAcceptedIrrecoverableEffects).toBeNull();
    expect(comparison.observedDistinctAcceptedMessagesLowerBound).toBe(4);
  }, 300_000);

  it('a SECOND accepted message under the scenario’s correlation is a FAIL on push evidence', async () => {
    scenario = await pushScenario();
    const row = KILL_POINT_ROWS.find((entry) => entry.point === 5)!;
    const first = await runScenario(scenario.runtime, scenario.ports, row);
    expect(first.row.verdict).toBe('PASS');
    // THE DELIBERATE DUPLICATE, delivered as the provider would: a second signed processed event
    // with a NEW message identity under the SAME correlation.
    const status = await postSigned(
      ingress!.port,
      bodyOf([processedEvent(first.row.correlationTag, { sg_message_id: 'duplicate-msg' })]),
      '1760000001',
    );
    expect(status).toBe(204);
    const observed = await observePushCorrelation(
      { port: scenario.ports.signedPushEvidence!, delay: () => Promise.resolve(), now: () => 0 },
      { ...BOUND, correlationTag: first.row.correlationTag, visibilityBound: FIXTURE_VISIBILITY_BOUND },
    );
    expect(observed.providerAcceptedCount).toBe(2);
    expect(
      verdictFor({
        row,
        localOutboxStatus: first.row.localOutboxStatus,
        localOutcomeRows: first.row.localOutcomeRows ?? 0,
        recovery: first.row.recovery ?? '',
        observationBefore: observed,
        observationAfter: observed,
      }).verdict,
    ).toBe('FAIL');
  }, 300_000);

  it('a synthetic SIGNED event with no ACOS correlation cannot populate any scenario’s count', async () => {
    scenario = await pushScenario();
    const tag = correlationTag();
    const unrelated = processedEvent(tag);
    delete unrelated.acos_correlation_tag;
    expect(await postSigned(ingress!.port, bodyOf([unrelated]), '1760000002')).toBe(204);
    const observedForTag = await observeStore(h.auditEvaluator, {
      provider: TEST_PROVIDER,
      correlationTag: tag,
      acceptedEventClasses: ACCEPTED_EVENT_CLASSES,
      receivedFrom: new Date(0),
      receivedTo: new Date(Date.now() + 86_400_000),
    });
    expect(observedForTag.observedAcceptedCount).toBe(0);
    expect(observedForTag.knownIncomplete).toBe(true);
  }, 120_000);
});
