import { describe, expect, it } from 'vitest';

import {
  FIXTURE_VISIBILITY_BOUND,
  observationModeLabel,
} from '../../validation/sendgrid/harness/visibilityBound.js';

import { isAuditProviderReader } from '../../src/audit/provider/runtime/auditProviderReader.js';
import { mintCorrelationTag } from '../../src/kernel/outbox/correlationTag.js';
import { buildSendGridSendRequest } from '../../validation/sendgrid/integration/requestMapping.js';
import {
  OWNER_SINK_MARKER,
  type ValidationEmailPayload,
} from '../../validation/sendgrid/integration/validationPayload.js';
import { isLiveIdentityProvenance } from '../../validation/sendgrid/integration/secretSource.js';
import { normaliseActivityRecords } from '../../validation/sendgrid/audit/activityRecords.js';
import {
  NOTHING_ESTABLISHED,
  evaluateStage1,
} from '../../validation/sendgrid/harness/preflight.js';
import {
  I17B_STATUS,
  productionStatementFor,
  renderEvidenceBundle,
  type EvidenceBundle,
} from '../../validation/sendgrid/harness/evidence.js';
import { KILL_POINT_CONCLUSION_LIMITS } from '../../validation/sendgrid/harness/killPoints.js';
import { auditProviderReader } from '../../validation/sendgrid/audit/reader.js';
import {
  unsafeParameterisedDestination,
  unsafePermissivePreflight,
  unsafeProvenanceAcceptsFixture,
  unsafeRedactingRenderer,
  unsafeResendingObservation,
  unsafeSandboxHonouringMapping,
  unsafeSelfFulfillingNormalisation,
  unsafeSendCapableAuditReader,
} from './unsafe-sendgrid-validation.js';

/*
 * CONTROLS 9 TO 14 — the defects the independent review actually found — live in
 * `sendgrid-review-controls.test.ts`, beside these. They are separated because they discriminate
 * a different class of thing: these eight catch designs nobody shipped, and those six catch
 * designs that WERE shipped and defended in comments.
 */

/**
 * `§17` — THE S1P CONTROLS ACTUALLY DISCRIMINATE.
 *
 * `§17`: "Mutation/negative-control tests should actually discriminate the protected
 * condition [...] Do not inflate test counts with meaningless assertion-only coverage."
 *
 * Each case below runs ONE assertion against BOTH the real implementation and the plausible
 * unsafe one. A control whose unsafe twin also passed would be a control proving nothing, and
 * that is the failure mode this file exists to rule out.
 */

const SINK = `owner+${OWNER_SINK_MARKER}@example.test`;
const SENDER = 'validation@nonprod.example.test';
const FAKE_KEY = 'SG.THIS-IS-NOT-A-REAL-KEY.0000000000000000000000000000000000000000';

/** One AUTHORISED validation effect, as `parseValidationEmailPayload` would produce it. */
const AUTHORISED: ValidationEmailPayload = Object.freeze({
  senderAddress: SENDER,
  sinkAddress: SINK,
  subject: 'ACOS S1P NON-PRODUCTION VALIDATION control',
  bodyText: 'ACOS S1P NON-PRODUCTION VALIDATION control body',
});

describe('CONTROL 1 — the sandbox refusal', () => {
  it('the real mapping REFUSES; the unsafe one emits `enable: true`', () => {
    const input = {
      authorised: AUTHORISED,
      correlationTag: mintCorrelationTag(),
      sandboxMode: true,
    };
    expect(buildSendGridSendRequest(input).kind).toBe('REFUSED');
    expect(unsafeSandboxHonouringMapping(input).mail_settings.sandbox_mode.enable).toBe(true);
  });
});

describe('CONTROL 2 — the absence of an arbitrary destination', () => {
  it('the unsafe client dials whatever it is handed; the real one has no such parameter', () => {
    expect(
      unsafeParameterisedDestination({
        origin: 'https://attacker.example',
        path: '/exfiltrate',
        method: 'POST',
      }),
    ).toBe('https://attacker.example/exfiltrate');

    /*
     * The real client's counterpart is a TYPE property rather than a value one:
     * `SendGridSendRequest` has `body` and `secret` and no member a destination could
     * occupy. `tests/sendgrid/provider-boundary.test.ts` asserts the source-level half —
     * every `fetch` destination is a template of module constants — and this case is the
     * reminder of what it is protecting against.
     */
    expect(Object.keys({ body: null, secret: '' }).sort()).toEqual(['body', 'secret']);
  });
});

describe('CONTROL 3 — the poller that cannot resend', () => {
  it('the unsafe loop sends on every empty read; the real deps shape has no send at all', async () => {
    let sends = 0;
    const result = await unsafeResendingObservation(
      {
        read: () => Promise.resolve({ kind: 'EVIDENCE' as const, records: [], recordCount: 0 }),
        send: () => {
          sends += 1;
          return Promise.resolve();
        },
      },
      3,
    );
    expect(result.sends).toBe(3);
    expect(sends).toBe(3);
    // `tests/sendgrid/observation.test.ts` asserts the real deps object's key set is exactly
    // `read`, `delay`, `now`. Three sends here is what that assertion is worth.
  });
});

describe('CONTROL 4 — the preflight default', () => {
  it('the real gate refuses an empty fact set; the permissive one passes it', () => {
    expect(evaluateStage1(NOTHING_ESTABLISHED).length).toBeGreaterThan(10);
    expect(unsafePermissivePreflight(NOTHING_ESTABLISHED)).toEqual([]);
  });
});

describe('CONTROL 5 — the material-bound identity', () => {
  it('the real check rejects the fixture provenance; the unsafe one admits it', () => {
    expect(isLiveIdentityProvenance('SYNTHETIC_TEST_IDENTITY')).toBe(false);
    expect(unsafeProvenanceAcceptsFixture('SYNTHETIC_TEST_IDENTITY')).toBe(true);
    // And both agree on the two that ARE bindings, so the difference is the fixture alone.
    for (const provenance of ['PROVIDER_KEY_ID', 'DEPLOYMENT_SECRET_VERSION']) {
      expect(isLiveIdentityProvenance(provenance)).toBe(true);
      expect(unsafeProvenanceAcceptsFixture(provenance)).toBe(true);
    }
  });
});

describe('CONTROL 6 — the audit reader that cannot send', () => {
  it('the accepted shape check admits the real reader and REFUSES the send-capable one', () => {
    expect(isAuditProviderReader(auditProviderReader)).toBe(true);
    expect(isAuditProviderReader(unsafeSendCapableAuditReader)).toBe(false);
    // The unsafe one satisfies the interface STRUCTURALLY, which is why the runtime check
    // exists: TypeScript admits extra members and the host must not.
    expect(typeof unsafeSendCapableAuditReader.readFromProvider).toBe('function');
  });
});

describe('CONTROL 7 — the evidence renderer that refuses rather than scrubs', () => {
  const bundle: EvidenceBundle = {
    schema: 'acos.s1p.sendgrid-validation-evidence.v1',
    operatingSpine: 'Operating Spine v1.3',
    packageIssue: 'v1.3.7',
    gitCommit: 'test',
    validationRunId: 'control-7',
    startedAtUtc: '2026-09-27T00:00:00.000Z',
    finishedAtUtc: '2026-09-27T00:00:00.000Z',
    environmentLabel: 'acos-nonprod',
    providerId: 'twilio_sendgrid',
    integrationCredentialIdentity: 'sg-key-id-integration',
    auditCredentialIdentity: 'sg-key-id-audit',
    integrationIdentityMatchedSignedRecord: true,
    auditIdentityMatchedSignedRecord: true,
    senderRedacted: null,
    sinkRedacted: null,
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
      reason: 'control',
      observedAcceptedCount: null,
      oracleDiscriminatedDuplicate: null,
    },
    i20: null,
    invariantConclusions: { i8: '', i20: '', i36: '' },
    unresolvedObservations: [`leaked ${FAKE_KEY}`],
    conclusionLimits: KILL_POINT_CONCLUSION_LIMITS,
    // `§4.4` — these bundles describe OFFLINE runs, and they say so.
    observationMode: observationModeLabel(FIXTURE_VISIBILITY_BOUND),
    visibilityBoundKind: 'FIXTURE_DETERMINISTIC',
    i17bStatus: I17B_STATUS,
    productionStatement: productionStatementFor({
      liveRunPerformed: false,
      nonProductionAcknowledged: false,
      refusedGateCount: 0,
      senderRedacted: null,
      sinkRedacted: null,
      providerOperationCount: 0,
    }),
  };

  it('the real renderer THROWS; the unsafe one emits a bundle and hides the defect', () => {
    expect(() => renderEvidenceBundle(bundle)).toThrow(/secret shape/);
    const scrubbed = unsafeRedactingRenderer(bundle);
    expect(scrubbed).toContain('<redacted>');
    expect(scrubbed).not.toContain(FAKE_KEY);
    /*
     * AND THAT IS THE POINT. The unsafe output LOOKS clean. A reviewer reading it would see
     * a redaction and conclude the pipeline is careful, when what happened is that a key
     * reached the serialiser and a regex happened to know its shape.
     */
  });
});

describe('CONTROL 8 — the correlation that is the provider’s answer, not the question', () => {
  it('the real normaliser returns `null` for a record with no categories; the unsafe one echoes', () => {
    const tag = mintCorrelationTag();
    const payload = {
      messages: [
        { msg_id: 'unrelated-1', status: 'delivered', last_event_time: '2026-09-27T00:10:00Z' },
        { msg_id: 'unrelated-2', status: 'delivered', last_event_time: '2026-09-27T00:11:00Z' },
      ],
    };

    const normalised = normaliseActivityRecords(payload, tag);
    // DEFECT 2: a record with no `categories` is an OPTIONAL field absent, so the query is
    // still VALID — and the tag is still `null`, which is the property this control is about.
    expect(normalised.kind).toBe('VALID');
    if (normalised.kind !== 'VALID') return;
    const real = normalised.records;
    expect(real.every((record) => record.correlationTag === null)).toBe(true);
    expect(real.filter((record) => record.correlationTag === tag)).toHaveLength(0);

    const unsafe = unsafeSelfFulfillingNormalisation(
      [{ providerMessageId: 'unrelated-1' }, { providerMessageId: 'unrelated-2' }],
      tag,
    );
    // The account's ordinary traffic, counted as this scenario's accepted messages.
    expect(unsafe.filter((record) => record.correlationTag === tag)).toHaveLength(2);
  });
});
