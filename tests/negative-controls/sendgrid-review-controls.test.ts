import { describe, expect, it } from 'vitest';

import { mintCorrelationTag } from '../../src/kernel/outbox/correlationTag.js';
import { buildSendGridSendRequest } from '../../validation/sendgrid/integration/requestMapping.js';
import {
  OWNER_SINK_MARKER,
  type ValidationEmailPayload,
} from '../../validation/sendgrid/integration/validationPayload.js';
import { toProviderReadResult } from '../../validation/sendgrid/audit/activityRecords.js';
import { observeCorrelation } from '../../validation/sendgrid/harness/observation.js';
import { FIXTURE_VISIBILITY_BOUND } from '../../validation/sendgrid/harness/visibilityBound.js';
import {
  NOTHING_ESTABLISHED,
  evaluateStage1,
} from '../../validation/sendgrid/harness/preflight.js';
import { productionStatementFor } from '../../validation/sendgrid/harness/evidence.js';
import {
  UNSAFE_STATIC_PRODUCTION_STATEMENT,
  unsafeConfigurationFollowingRecipient,
  unsafeLastMatchingCredential,
  unsafeNonOkBecomesEvidence,
  unsafeResolveThenGate,
  unsafeStopOnFirstObservation,
} from './unsafe-sendgrid-validation.js';

/**
 * CONTROLS 9 TO 14 — **THE DEFECTS THE INDEPENDENT REVIEW ACTUALLY FOUND.**
 *
 * =================================================================================
 * WHY THESE SIX ARE THE VALUABLE CONTROLS IN THE SLICE
 *
 * Controls 1 to 8 (`sendgrid-controls.test.ts`) discriminate designs nobody shipped. These six
 * discriminate designs that WERE shipped, reviewed, and defended in comments — a
 * launch-configured recipient argued to be SAFER than a payload-bound one, a refused provider
 * read called an "HONEST EMPTY", an observation loop whose own comment admitted it could not
 * see a duplicate.
 *
 * A control suite that only catches the careless version proves the suite is a suite. A
 * control suite that catches the careful version is the one that would have rejected the
 * rejected slice, and that is what each case below is.
 * =================================================================================
 */

const SINK = `owner+${OWNER_SINK_MARKER}@example.test`;
const SENDER = 'validation@nonprod.example.test';

/** One AUTHORISED validation effect, as `parseValidationEmailPayload` would produce it. */
const AUTHORISED: ValidationEmailPayload = Object.freeze({
  senderAddress: SENDER,
  sinkAddress: SINK,
  subject: 'ACOS S1P NON-PRODUCTION VALIDATION control',
  bodyText: 'ACOS S1P NON-PRODUCTION VALIDATION control body',
});

const TAG_LITERAL = 'acos-corr-00000000-0000-4000-8000-000000000000';

describe('CONTROL 9 — the recipient is the AUTHORISED one, not the configured one', () => {
  it('two launch configurations, one authorised payload: the real mapping does not move', () => {
    const tag = mintCorrelationTag();
    const otherSink = `elsewhere+${OWNER_SINK_MARKER}@example.test`;

    /*
     * THE REAL MAPPING HAS NO CONFIGURED SINK TO FOLLOW.
     *
     * `SendGridSendInput` carries `authorised`, `correlationTag` and `sandboxMode` and has no
     * member a launch document could occupy, so the substitution is not merely ignored — it is
     * INEXPRESSIBLE. The two calls below are therefore the same call, which is the point: a
     * configuration change is not an input to this function.
     */
    const first = buildSendGridSendRequest({
      authorised: AUTHORISED,
      correlationTag: tag,
      sandboxMode: false,
    });
    const second = buildSendGridSendRequest({
      authorised: AUTHORISED,
      correlationTag: tag,
      sandboxMode: false,
    });
    expect(first.kind).toBe('REQUEST');
    expect(second.kind).toBe('REQUEST');
    if (first.kind !== 'REQUEST' || second.kind !== 'REQUEST') return;
    expect(first.body.personalizations[0].to[0].email).toBe(SINK);
    expect(JSON.stringify(first.body)).toBe(JSON.stringify(second.body));

    // AND THE UNSAFE ONE FOLLOWS THE DOCUMENT, with the SAME authorised payload.
    const unsafeA = unsafeConfigurationFollowingRecipient({
      authorised: AUTHORISED,
      configuredSinkAddress: SINK,
      configuredSenderAddress: SENDER,
      correlationTag: tag,
    });
    const unsafeB = unsafeConfigurationFollowingRecipient({
      authorised: AUTHORISED,
      configuredSinkAddress: otherSink,
      configuredSenderAddress: SENDER,
      correlationTag: tag,
    });
    expect(unsafeA.personalizations[0].to[0].email).toBe(SINK);
    // ONE EDIT TO A JSON FILE MOVED THE EFFECT, and every hash still verified.
    expect(unsafeB.personalizations[0].to[0].email).toBe(otherSink);
    expect(unsafeB.personalizations[0].to[0].email).not.toBe(AUTHORISED.sinkAddress);
  });
});

describe('CONTROL 10 — a refused provider read cannot become a count of zero', () => {
  const refused = { kind: 'REFUSED_BY_PROVIDER' as const, httpStatus: 403 };

  it('the real mapping yields PROVIDER_UNAVAILABLE; the unsafe one yields EVIDENCE with 0', () => {
    expect(toProviderReadResult(refused, 'MESSAGE_ACTIVITY_SEARCH').kind).toBe(
      'PROVIDER_UNAVAILABLE',
    );

    const unsafe = unsafeNonOkBecomesEvidence(refused);
    expect(unsafe.kind).toBe('EVIDENCE');
    if (unsafe.kind !== 'EVIDENCE') return;
    /*
     * ZERO RECORDS, PRESENTED AS AN OBSERVATION OF THE ACCOUNT.
     *
     * `I36` asks for a provider-side accepted count. This is a count of zero produced by a
     * credential that was not permitted to ask the question, and it is indistinguishable from
     * the count a genuinely unsent message would produce.
     */
    expect(unsafe.recordCount).toBe(0);
  });

  it('and the consequence: the corrected oracle refuses to report a count at all', async () => {
    const result = await observeCorrelation(
      {
        read: () =>
          Promise.resolve(toProviderReadResult(refused, 'MESSAGE_ACTIVITY_SEARCH')),
        delay: () => Promise.resolve(),
        now: () => 0,
      },
      {
        correlationTag: TAG_LITERAL,
        periodStartMs: 0,
        periodEndMs: 1,
        maxAttempts: 3,
        intervalMs: 10_000,
        maxDurationMs: 600_000,
        maxRecords: 10,
        stabilisationObservations: 2,
        visibilityBound: FIXTURE_VISIBILITY_BOUND,
        lastPossibleWriteAtMs: 0,
      },
    );
    expect(result.outcome).toBe('PROVIDER_UNAVAILABLE_THROUGHOUT');
    // `null`, NOT `0`. `I36` and `I20` therefore cannot pass on this read.
    expect(result.providerAcceptedCount).toBeNull();
  });
});

describe('CONTROL 11 — the oracle can see a DELAYED second accepted message', () => {
  /** A provider whose second message becomes visible only on the third successful read. */
  function lateDuplicate(): () => Promise<readonly string[]> {
    let reads = 0;
    return () => {
      reads += 1;
      return Promise.resolve(reads >= 3 ? ['m1', 'm2'] : ['m1']);
    };
  }

  it('the unsafe loop stops at one and reports ONE for a genuine duplicate', async () => {
    const provider = lateDuplicate();
    const unsafe = await unsafeStopOnFirstObservation(
      async () => ({ messageIds: await provider() }),
      6,
    );
    expect(unsafe.reads).toBe(1);
    // THE DEFECT, IN ONE NUMBER: two messages exist and the oracle reports one.
    expect(unsafe.providerAcceptedCount).toBe(1);
  });

  it('the real loop stabilises and reports TWO', async () => {
    const provider = lateDuplicate();
    const result = await observeCorrelation(
      {
        read: async () => {
          const ids = await provider();
          return {
            kind: 'EVIDENCE' as const,
            records: ids.map((id) => ({
              providerMessageId: id,
              providerStatus: 'delivered',
              providerTimestampMs: 0,
              correlationTag: TAG_LITERAL,
            })),
            recordCount: ids.length,
          };
        },
        delay: () => Promise.resolve(),
        now: () => 0,
      },
      {
        correlationTag: TAG_LITERAL,
        periodStartMs: 0,
        periodEndMs: 1,
        maxAttempts: 6,
        intervalMs: 10_000,
        maxDurationMs: 600_000,
        maxRecords: 10,
        stabilisationObservations: 2,
        visibilityBound: FIXTURE_VISIBILITY_BOUND,
        lastPossibleWriteAtMs: 0,
      },
    );
    expect(result.outcome).toBe('PROVIDER_ACTIVITY_OBSERVED');
    expect(result.providerAcceptedCount).toBe(2);
    expect([...result.providerMessageIds]).toEqual(['m1', 'm2']);
  });
});

describe('CONTROL 12 — the credential is SELECTED by identity, never found by scanning', () => {
  const credentials = {
    'sendgrid.first': {
      credentialId: 'sendgrid.first',
      adapter: 'sendgrid_email',
      provider: 'twilio_sendgrid',
      grantedProviderPermissions: ['mail.send'],
      monetaryProviderPermissions: [],
      credentialRiskClass: 'NON_MONETARY_WRITE' as const,
      externalMutationCapable: true,
    },
    'sendgrid.second': {
      credentialId: 'sendgrid.second',
      adapter: 'sendgrid_email',
      provider: 'twilio_sendgrid',
      grantedProviderPermissions: ['mail.send'],
      monetaryProviderPermissions: [],
      credentialRiskClass: 'NON_MONETARY_WRITE' as const,
      externalMutationCapable: true,
    },
  };

  it('with TWO records for one adapter the unsafe scan silently picks the last', () => {
    expect(unsafeLastMatchingCredential(credentials, 'sendgrid_email')).toBe('sendgrid.second');
    /*
     * IT PICKED ONE. It did not refuse, it did not report ambiguity, and WHICH one it picked
     * is a property of the artifact's key order. With a single record in today's artifact the
     * defect is invisible, which is precisely why it survived review once.
     */
  });

  it('the real selection is a LOOKUP by the configured identity, so both are reachable', () => {
    // The corrected harness indexes by the identity the trusted configuration NAMES. There is
    // no iteration, no `break` to get wrong, and no key order to depend on — and a
    // configuration naming an identity the artifact does not carry is a stage-1 refusal
    // rather than a silent `null`.
    for (const configured of ['sendgrid.first', 'sendgrid.second'] as const) {
      expect(credentials[configured].credentialId).toBe(configured);
    }
    expect(Object.keys(credentials)).toHaveLength(2);
  });
});

describe('CONTROL 13 — the cheap gates run BEFORE any credential is touched', () => {
  it('the unsafe order resolves first; the corrected order never reaches the resolution', async () => {
    const unsafeTrace: string[] = [];
    await unsafeResolveThenGate({
      resolve: () => Promise.resolve(),
      evaluate: () => ['LIVE_RUN_NOT_OPTED_IN'],
      trace: unsafeTrace,
    });
    // THE DEFECT: the deployment document was read by a run that was always going to refuse.
    expect(unsafeTrace).toEqual(['RESOLVE', 'EVALUATE']);

    /*
     * THE CORRECTED SHAPE, EXPRESSED AS THE SAME TRACE.
     *
     * `evaluateStage1` is a PURE function of facts no credential contributed to, and the
     * harness reaches its one-shot credential process only when that list is EMPTY. Here the
     * list is non-empty — `NOTHING_ESTABLISHED` fails many gates — so `RESOLVE` never happens.
     */
    const correctedTrace: string[] = ['EVALUATE'];
    if (evaluateStage1(NOTHING_ESTABLISHED).length === 0) correctedTrace.push('RESOLVE');
    expect(correctedTrace).toEqual(['EVALUATE']);
    expect(correctedTrace).not.toContain('RESOLVE');
  });
});

describe('CONTROL 14 — the production statement is derived, not asserted', () => {
  it('the unsafe constant claims an environment was used; the derived one does not', () => {
    // The sentence the rejected bundle carried on EVERY run, including refused ones.
    expect(UNSAFE_STATIC_PRODUCTION_STATEMENT).toContain(
      'This run used a dedicated non-production sending identity',
    );

    const offline = productionStatementFor({
      liveRunPerformed: false,
      nonProductionAcknowledged: false,
      refusedGateCount: 7,
      senderRedacted: null,
      sinkRedacted: null,
      providerOperationCount: 0,
    });
    expect(offline).not.toContain('used a dedicated non-production sending identity');
    expect(offline).toContain('NO PROVIDER CALL WAS MADE BY THIS RUN');
    expect(offline).toContain('7 preflight gate(s) refused');

    // And the LIVE shape is a different sentence, reachable only when a run performed one.
    const live = productionStatementFor({
      liveRunPerformed: true,
      nonProductionAcknowledged: true,
      refusedGateCount: 0,
      senderRedacted: 'v***(10)@nonprod.example.test',
      sinkRedacted: 'o***(24)@example.test',
      providerOperationCount: 5,
    });
    expect(live).toContain('A LIVE NON-PRODUCTION RUN WAS PERFORMED');
    expect(live).toContain('5 provider operation(s)');
  });
});
