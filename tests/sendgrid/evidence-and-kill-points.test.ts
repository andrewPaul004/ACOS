import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  FIXTURE_VISIBILITY_BOUND,
  observationModeLabel,
} from '../../validation/sendgrid/harness/visibilityBound.js';

import {
  I17B_STATUS,
  LIVE_ENVIRONMENT_CLAIM_PHRASES,
  bundleDigest,
  detectSecretShapes,
  productionStatementFor,
  redactAddress,
  renderEvidenceBundle,
  type EvidenceBundle,
} from '../../validation/sendgrid/harness/evidence.js';
import {
  KILL_POINT_CONCLUSION_LIMITS,
  KILL_POINT_ROWS,
} from '../../validation/sendgrid/harness/killPoints.js';
import { OWNER_SINK_MARKER } from '../../validation/sendgrid/integration/validationPayload.js';

/**
 * `§9`, `§10`, `§16` — THE KILL-POINT MAP AND THE EVIDENCE BUNDLE.
 *
 * The kill-point cases assert the map against the ACCEPTED sources rather than against a
 * second hand-authored list: `§9` requires S1P to use the EXISTING six points, and a copy
 * that nothing compares to the original is a copy that drifts.
 */

const FAKE_KEY = 'SG.THIS-IS-NOT-A-REAL-KEY.0000000000000000000000000000000000000000';
const MOCK_MATRIX = readFileSync(
  join('tests', 'integration', 'gateway', 'mock-kill-matrix.test.ts'),
  'utf8',
);
const EFFECT_GATEWAY = readFileSync(join('src', 'kernel', 'gateway', 'effectGateway.ts'), 'utf8');

describe('`§9` — THE SIX POINTS ARE THE EXISTING SIX, BY THEIR EXISTING NAMES', () => {
  it('there are exactly six, numbered 1 to 6', () => {
    expect(KILL_POINT_ROWS).toHaveLength(6);
    expect(KILL_POINT_ROWS.map((row) => row.point)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('every canonical NAME appears verbatim in the ACCEPTED mock kill matrix', () => {
    /*
     * The assertion that stops a rename. `§9`: "Do not rename them unnecessarily." Each name
     * below is searched for as a literal in `mock-kill-matrix.test.ts`, which is the file
     * S1J's `§22` is implemented in.
     */
    for (const row of KILL_POINT_ROWS.filter((entry) => entry.point <= 5)) {
      expect(MOCK_MATRIX, `kill point ${row.point} name drifted`).toContain(row.name);
    }
    // Point 6's canonical phrasing in the matrix is its own `it` title.
    expect(MOCK_MATRIX).toContain('re-entry, at every point');
  });

  it('every control-plane TRIGGER is a real `DispatchHooks` member', () => {
    /*
     * `§9`: "Do not alter their semantic positions merely to make the test easier." A trigger
     * naming a hook that does not exist would be a point positioned somewhere else, so each
     * one is checked against the hook declarations in the ACCEPTED gateway.
     */
    for (const row of KILL_POINT_ROWS) {
      if (
        row.trigger === null ||
        row.trigger === 'RE_ENTRY' ||
        row.trigger === 'INTEGRATION_CHILD_EXIT_AFTER_SEND'
      ) {
        // `null` is in the TYPE and on no row; skipping it here keeps the narrowing honest
        // rather than asserting a hook named "null" does not exist.
        continue;
      }
      expect(EFFECT_GATEWAY, `${row.trigger} is not a DispatchHooks member`).toContain(
        `readonly ${row.trigger}?:`,
      );
    }
  });

  it('point 1 is the ONLY row whose recovery legitimately dispatches', () => {
    const resolving = KILL_POINT_ROWS.filter((row) => row.expectedRecovery === 'OUTCOME_RESOLVED');
    expect(resolving.map((row) => row.point)).toEqual([1]);
    expect(resolving[0]?.expectedOutboxStatus).toBe('ENQUEUED');
    for (const row of KILL_POINT_ROWS.filter((entry) => entry.point !== 1)) {
      expect(row.expectedOutboxStatus, `point ${row.point}`).toBe('CLAIMED');
      expect(row.expectedRecovery, `point ${row.point}`).toBe('CLAIM_REFUSED:ALREADY_CLAIMED');
    }
  });

  it('`§10` — NO ROW EXPECTS RECOVERY TO INCREASE THE PROVIDER-SIDE ACCEPTED COUNT', () => {
    /*
     * `§22`'s one production property, read against the provider: "No recovery path invokes
     * the mock a second time for an already-claimed effect." Point 1 is the exception and it
     * is not one — nothing was claimed, so its recovery is a FIRST claim.
     */
    for (const row of KILL_POINT_ROWS) {
      if (row.point === 1) {
        expect(row.expectedProviderAcceptedCountAfterRecovery).toBe(1);
        continue;
      }
      expect(
        row.expectedProviderAcceptedCountAfterRecovery,
        `point ${row.point} expects a second accepted message`,
      ).toBe(row.expectedProviderAcceptedCount);
    }
    // And no row ever expects more than one accepted message for one correlation.
    for (const row of KILL_POINT_ROWS) {
      expect(row.expectedProviderAcceptedCountAfterRecovery).toBeLessThanOrEqual(1);
    }
  });

  it('points 2 and 3 differ ONLY in the provider-side count — which is why a mock cannot close I36', () => {
    const two = KILL_POINT_ROWS.find((row) => row.point === 2)!;
    const three = KILL_POINT_ROWS.find((row) => row.point === 3)!;
    expect(two.expectedOutboxStatus).toBe(three.expectedOutboxStatus);
    expect(two.expectedOutcomeRows).toBe(three.expectedOutcomeRows);
    expect(two.expectedRecovery).toBe(three.expectedRecovery);
    // The one discriminating field, and it is the one only a provider read can supply.
    expect(two.expectedProviderAcceptedCount).toBe(0);
    expect(three.expectedProviderAcceptedCount).toBe(1);
  });

  it('`§19` — the declared conclusion limits refuse the claims S1P must not make', () => {
    const joined = KILL_POINT_CONCLUSION_LIMITS.join(' ');
    expect(joined).toContain('does NOT show exactly-once delivery');
    expect(joined).toContain('distributed exactly-once');
    expect(joined).toContain('does NOT close I17b');
  });
});

describe('`§16` — THE EVIDENCE BUNDLE CANNOT CARRY A SECRET', () => {
  const bundle: EvidenceBundle = {
    schema: 'acos.s1p.sendgrid-validation-evidence.v2',
    operatingSpine: 'Operating Spine v1.3',
    packageIssue: 'v1.3.8',
    gitCommit: 'd897833b14253030f75fe113534df34a9827d464',
    validationRunId: 's1p-test',
    startedAtUtc: '2026-09-27T00:00:00.000Z',
    finishedAtUtc: '2026-09-27T00:00:01.000Z',
    environmentLabel: 'acos-nonprod',
    providerId: 'twilio_sendgrid',
    providerEvidenceMode: 'PROVIDER_READ',
    providerEvidence: {
      mode: 'PROVIDER_READ',
      evidenceSource: 'PROVIDER_EMAIL_ACTIVITY_READ',
      auditReadCredential: 'REQUIRED',
      emailActivityEntitlement: 'OPERATOR_CONFIRMED',
      inverseSweep: 'PROVIDER_READ_SWEEP',
    },
    integrationCredentialIdentity: 'sg-key-id-integration',
    auditCredentialIdentity: 'sg-key-id-audit',
    integrationIdentityMatchedSignedRecord: true,
    auditIdentityMatchedSignedRecord: true,
    senderRedacted: redactAddress('validation@nonprod.example.test'),
    sinkRedacted: redactAddress(`owner+${OWNER_SINK_MARKER}@example.test`),
    stage1Failures: [],
    stage2Failures: [],
    preflightFailures: [],
    credentialsTouched: false,
    liveRunPerformed: false,
    providerOperationCount: 0,
    probes: [],
    auditKeySendRefusal: null,
    killPoints: [],
    duplicateControl: {
      status: 'NOT_RUN',
      reason: 'not requested',
      observedAcceptedCount: null,
      oracleDiscriminatedDuplicate: null,
    },
    i20: null,
    invariantConclusions: { i8: 'NO CHANGE.', i20: 'NO CHANGE.', i36: 'NO CHANGE.' },
    unresolvedObservations: [],
    conclusionLimits: KILL_POINT_CONCLUSION_LIMITS,
    // `§4.4` — these bundles describe OFFLINE runs, and they say so.
    observationMode: observationModeLabel(FIXTURE_VISIBILITY_BOUND),
    visibilityBoundKind: 'FIXTURE_DETERMINISTIC',
    i17bStatus: I17B_STATUS,
    productionStatement: productionStatementFor({
      liveRunPerformed: false,
      nonProductionAcknowledged: false,
      refusedGateCount: 4,
      senderRedacted: null,
      sinkRedacted: null,
      providerOperationCount: 0,
    }),
  };

  it('a clean bundle renders, and its digest is stable', () => {
    const rendered = renderEvidenceBundle(bundle);
    expect(bundleDigest(rendered)).toBe(bundleDigest(renderEvidenceBundle(bundle)));
    expect(rendered).toContain('acos.s1p.sendgrid-validation-evidence.v2');
  });

  it('rendering THROWS rather than redacting when a secret shape reaches it', () => {
    /*
     * THE DISCRIMINATING CONTROL. A pipeline that put a key in the bundle and a filter that
     * took it out is a pipeline whose next member is unfiltered, so a violation stops the
     * run. The unsafe value is injected through a member that legitimately holds free text.
     */
    expect(() =>
      renderEvidenceBundle({
        ...bundle,
        unresolvedObservations: [`the key was ${FAKE_KEY}`],
      }),
    ).toThrow(/secret shape/);

    expect(() =>
      renderEvidenceBundle({
        ...bundle,
        unresolvedObservations: ['authorization: Bearer abc123'],
      }),
    ).toThrow(/secret shape/);
  });

  it('the detector recognises a key, a bearer scheme and an authorization header', () => {
    expect(detectSecretShapes(`x ${FAKE_KEY} y`).length).toBeGreaterThan(0);
    expect(detectSecretShapes('Bearer sometoken').length).toBeGreaterThan(0);
    expect(detectSecretShapes('"authorization": "x"').length).toBeGreaterThan(0);
    expect(detectSecretShapes('nothing to see')).toEqual([]);
  });

  it('`§16` — an address is represented safely: the domain survives, the mailbox does not', () => {
    const redacted = redactAddress('owner.person+acos-nonprod-sink@example.test');
    expect(redacted).toContain('@example.test');
    expect(redacted).not.toContain('owner.person');
    expect(redacted).toMatch(/^o\*\*\*\(\d+\)@example\.test$/);
    expect(redactAddress('not-an-address')).toBe('<redacted>');
  });

  it('`§16` — the I17b disclaimer and the production statement travel INSIDE the artifact', () => {
    const rendered = renderEvidenceBundle(bundle);
    expect(rendered).toContain('I17b REMAINS OPEN');
    expect(rendered).toContain('NO PROVIDER CALL WAS MADE BY THIS RUN');
    expect(I17B_STATUS).toContain('not an external anchor');
  });

  describe('CORRECTION 8 — AN OFFLINE BUNDLE MAKES NO CLAIM ABOUT A LIVE ENVIRONMENT', () => {
    const REFUSED_GATES = [
      'DEPLOYMENT_CONFIGURATION_UNREADABLE',
      'NON_PRODUCTION_NOT_ACKNOWLEDGED',
      'LIVE_RUN_NOT_OPTED_IN',
      'CONTROL_PLANE_COMPOSITION_UNAVAILABLE',
    ] as const;

    /** The bundle a run that refused at stage 1 on THIS repository actually produces. */
    const offline: EvidenceBundle = {
      ...bundle,
      environmentLabel: null,
      senderRedacted: null,
      sinkRedacted: null,
      integrationCredentialIdentity: null,
      auditCredentialIdentity: null,
      integrationIdentityMatchedSignedRecord: false,
      auditIdentityMatchedSignedRecord: false,
      stage1Failures: [...REFUSED_GATES],
      stage2Failures: [],
      preflightFailures: [...REFUSED_GATES],
      credentialsTouched: false,
      productionStatement: productionStatementFor({
        liveRunPerformed: false,
        nonProductionAcknowledged: false,
        refusedGateCount: REFUSED_GATES.length,
        senderRedacted: null,
        sinkRedacted: null,
        providerOperationCount: 0,
      }),
    };

    it('`§19` item 8 — the rendered artifact contains NO live-environment claim', () => {
      const rendered = renderEvidenceBundle(offline);
      /*
       * ASSERTED AGAINST THE FORBIDDEN PHRASES RATHER THAN THE EXPECTED ONE.
       *
       * A positive assertion — "it contains the offline sentence" — would pass on a bundle
       * that contained BOTH, which is exactly the bundle the rejected slice produced: an
       * honest `liveRunPerformed: false` beside a constant claiming an environment had been
       * used.
       */
      for (const phrase of LIVE_ENVIRONMENT_CLAIM_PHRASES) {
        expect(rendered, phrase).not.toContain(phrase);
      }
      expect(rendered).toContain('NO PROVIDER CALL WAS MADE BY THIS RUN');
      expect(rendered).toContain('makes no claim that any sending environment');
    });

    it('and the evidence says, in FIELDS rather than prose, that nothing happened', () => {
      expect(offline.liveRunPerformed).toBe(false);
      expect(offline.providerOperationCount).toBe(0);
      expect(offline.probes).toEqual([]);
      expect(offline.killPoints).toEqual([]);
      expect(offline.i20).toBeNull();
      // `§4.1`: a stage-1 refusal means NO credential source was touched, and it says so.
      expect(offline.credentialsTouched).toBe(false);
      expect(offline.stage1Failures.length).toBeGreaterThan(0);
      expect(offline.stage2Failures).toEqual([]);
    });

    it('a LIVE statement is structurally different, and unreachable from an offline run', () => {
      const live = productionStatementFor({
        liveRunPerformed: true,
        nonProductionAcknowledged: true,
        refusedGateCount: 0,
        senderRedacted: 'v***(10)@nonprod.example.test',
        sinkRedacted: 'o***(24)@example.test',
        providerOperationCount: 6,
      });
      expect(live).toContain('A LIVE NON-PRODUCTION RUN WAS PERFORMED');
      expect(live).toContain('6 provider operation(s)');
      // The two shapes cannot be produced by one run state, which is the whole correction.
      expect(live).not.toContain('NO PROVIDER CALL WAS MADE BY THIS RUN');
    });
  });
});
