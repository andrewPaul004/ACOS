import {
  SENDGRID_API_ORIGIN,
  SENDGRID_MESSAGES_PATH,
  buildActivityQuery,
} from '../audit/providerReadClient.js';
import { SENDGRID_MAIL_SEND_PATH, buildSendGridSendRequest } from '../integration/requestMapping.js';
import { isOwnerControlledSink, isUsableAddress } from '../integration/validationPayload.js';
import type { ProbeOutcome, ProbeRecord } from './probeResult.js';

/**
 * `§8.7` — THE EMPIRICAL CREDENTIAL-CAPABILITY PROBES. THE PART NO DECLARATION DISCHARGES.
 *
 * =================================================================================
 * WHY THESE EXIST AT ALL, IN ONE SENTENCE FROM THE ACCEPTED S1O RESULT
 *
 * "**A SIGNED `READ_ONLY` DECLARATION IS NOT THE ATTEMPTED-WRITE TEST.** The declaration says
 * what the deployment believes it provisioned; `36 §13` asks the vendor."
 *
 * And the S1O correction's own limit on what the identity binding bought: it proves *"this is
 * credential A"*; it does not prove *"credential A still holds the provider permissions the
 * signed record declares"*. A scoped provider key is mutable at the provider with no
 * ACOS-observable event. **Scope drift is empirical or it is unproven.**
 *
 * =================================================================================
 * WHY THIS FILE IS IN `harness/` AND NOT IN `audit/`, WHICH IS THE WHOLE OF `§8.2`
 *
 * `§8.2`, verbatim: "Do NOT add a normal audit IPC 'send' method just to perform the negative
 * control. The negative control must be an explicitly isolated validation/probe path that
 * cannot become a production audit capability."
 *
 * So the attempted-write probe is NOT in the audit reader's package:
 *
 *   - `validation/sendgrid/audit/` declares NO `sendToProvider*` function, and
 *     `perimeter-enumeration.test.ts` asserts zero send sites under it;
 *   - `reader.ts` does not import this module, and
 *     `tests/sendgrid/plane-separation.test.ts` asserts the audit reader's import closure
 *     does not contain it;
 *   - the audit read IPC has three operations and none of them reaches this file, so no
 *     message the audit plane can receive causes a probe;
 *   - nothing under `src/` imports `validation/`, so no ACOS runtime holds this capability.
 *
 * **THE HARNESS IS THE OPERATOR, NOT A PLANE.** This module is reached only from
 * `cli.ts`, which a human invokes with an explicit acknowledgement token, and the credential
 * it is handed is read by that CLI from the operator's own deployment documents. It is not a
 * capability of the audit runtime, of the integration runtime or of the control plane, and it
 * is not reachable from any of them.
 *
 * =================================================================================
 * WHAT A PROBE MAY AND MAY NOT CONCLUDE
 *
 * A probe records the OPERATION ATTEMPTED, the NON-SECRET CREDENTIAL IDENTITY, the PROVIDER'S
 * HTTP STATUS and an OUTCOME CLASSIFICATION. It concludes nothing from a key's name, its id,
 * its operator label, the configuration that created it or the fact that it was INTENDED to
 * be read-only — `§8.7` forbids each of those by name.
 *
 * And a probe that could not run is recorded as `NOT_RUN`, never as a pass. `§8.7`: "If
 * provider entitlements prevent a required probe, report PARTIAL."
 * =================================================================================
 */

/** The transport deadline for one probe. */
export const PROBE_DEADLINE_MS = 12_000;

/*
 * `PROBE_OUTCOMES`, `ProbeOutcome` and `ProbeRecord` MOVED TO `probeResult.ts` — CORRECTION 5.
 *
 * The coordinator has to be able to READ a probe's result without acquiring the capability to
 * PERFORM one, and this file holds two real vendor call sites. So the shapes live in a module
 * with no `fetch` and no credential, and both the credential-holding child and the
 * credential-free parent import them from there.
 */
/**
 * SendGrid's documented refusal statuses for a credential lacking a scope.
 *
 * S1O's capability record cites the published converse — "a key lacking Email Activity
 * permission receives 403 Access Forbidden from `GET /v3/messages`" — and 401 is the
 * unauthenticated case. Both are refusals BY THE PROVIDER; neither is inferred from a label.
 */
const SCOPE_REFUSAL_STATUSES: readonly number[] = Object.freeze([401, 403]);

function classify(status: number, acceptedStatuses: readonly number[]): ProbeOutcome {
  if (acceptedStatuses.includes(status)) return 'CAPABILITY_CONFIRMED';
  if (SCOPE_REFUSAL_STATUSES.includes(status)) return 'CAPABILITY_REFUSED_BY_PROVIDER';
  return 'INCONCLUSIVE';
}

/**
 * `36 §13` — ATTEMPT A SEND WITH THE AUDIT CREDENTIAL, AND EXPECT THE PROVIDER TO REFUSE.
 *
 * THE EXPECTATION IS NOT THE EVIDENCE. This function does not assert; it RECORDS what
 * SendGrid answered, and `CAPABILITY_CONFIRMED` here — the audit key CAN send — is a
 * finding, a serious one, and the harness reports it as a failure of the provisioning rather
 * than hiding it.
 *
 * The body it attempts is the ordinary validation body: the owner-controlled sink, the
 * scenario's own correlation tag, `sandbox_mode` explicitly false. So in the failure case —
 * a mis-scoped audit key that CAN send — the message that escapes goes to the owner's own
 * sink, carries no business content, and is queryable under its own tag, which is the
 * smallest possible consequence of discovering the thing this probe exists to discover.
 *
 * PERIMETER_EXEMPT(credential_scope_conformance_probe, 36-13) — `48 §2` row 13's neighbour.
 * This site carries NO `authorisation_ref` and must not pretend to: there is no ACOS effect
 * behind it, no claim, no outbox row and no dispatch. It is an operator-invoked capability
 * measurement against a non-production account, and recording it as an annotated, ticketed,
 * reviewed exemption is `48 §3`'s own answer to a hole that has to exist.
 */
export async function sendToProviderSendGridScopeProbe(input: {
  readonly auditSecret: string;
  readonly auditCredentialIdentity: string;
  readonly correlationTag: string;
  readonly senderAddress: string;
  readonly sinkAddress: string;
}): Promise<ProbeRecord> {
  const refused = (note: string): ProbeRecord => ({
    operation: `POST ${SENDGRID_MAIL_SEND_PATH}`,
    credentialIdentity: input.auditCredentialIdentity,
    plane: 'AUDIT',
    httpStatus: null,
    outcome: 'NOT_RUN',
    note,
  });

  /*
   * THE SINK SAFETY CHECK IS PERFORMED HERE, EXPLICITLY, BECAUSE THIS PATH HAS NO
   * AUTHORISATION BEHIND IT.
   *
   * `buildSendGridSendRequest` takes a `ValidationEmailPayload`, which on the ORDINARY path
   * can only be produced by `parseValidationEmailPayload` from authorised bytes — and that
   * function applies the owner-sink refusal. This probe has no authorised bytes by design
   * (`48 §3`: an operator-invoked capability measurement with no ACOS effect behind it), so
   * the same refusal is applied here, to the operands the operator supplied, before anything
   * is constructed.
   */
  if (!isUsableAddress(input.senderAddress)) return refused('the probe sender is not an address');
  if (!isOwnerControlledSink(input.sinkAddress)) {
    return refused('the probe sink is not the owner-controlled non-production sink');
  }

  const mapped = buildSendGridSendRequest({
    authorised: {
      senderAddress: input.senderAddress,
      sinkAddress: input.sinkAddress,
      subject: `ACOS S1P CREDENTIAL SCOPE PROBE ${input.correlationTag}`,
      bodyText:
        'This message is an ACOS 36 §13 attempted-write capability probe. If it arrived, ' +
        'the audit-read credential can send and the provisioning is wrong.',
    },
    correlationTag: input.correlationTag,
    sandboxMode: false,
  });
  if (mapped.kind === 'REFUSED') {
    return refused(`the probe body could not be constructed: ${mapped.reason}`);
  }

  const controller = new AbortController();
  const deadline = setTimeout(() => {
    controller.abort();
  }, PROBE_DEADLINE_MS);
  try {
    // PERIMETER_EXEMPT(credential_scope_conformance_probe, 36-13) — the 36 §13 attempted-write
    // test, with the READ-ONLY credential, against a dedicated non-production account.
    const response = await globalThis.fetch(`${SENDGRID_API_ORIGIN}${SENDGRID_MAIL_SEND_PATH}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${input.auditSecret}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(mapped.body),
      signal: controller.signal,
    });
    const outcome = classify(response.status, [202]);
    return {
      operation: `POST ${SENDGRID_MAIL_SEND_PATH}`,
      credentialIdentity: input.auditCredentialIdentity,
      plane: 'AUDIT',
      httpStatus: response.status,
      outcome,
      note:
        outcome === 'CAPABILITY_REFUSED_BY_PROVIDER'
          ? '36 §13 satisfied for this credential at this moment: SendGrid refused a send ' +
            'attempted with the audit credential'
          : outcome === 'CAPABILITY_CONFIRMED'
            ? 'THE AUDIT CREDENTIAL CAN SEND. 48 §3.6 read-only exemption is NOT earned by ' +
              'this credential and the provisioning is wrong'
            : 'the provider answered with a status that settles neither capability',
    };
  } catch {
    return {
      operation: `POST ${SENDGRID_MAIL_SEND_PATH}`,
      credentialIdentity: input.auditCredentialIdentity,
      plane: 'AUDIT',
      httpStatus: null,
      outcome: 'PROVIDER_UNREACHABLE',
      note: 'the provider was not reached; a refusal was NOT observed and is not claimed',
    };
  } finally {
    clearTimeout(deadline);
  }
}

/**
 * THE READ CAPABILITY, MEASURED IN BOTH DIRECTIONS.
 *
 * Run twice by the harness: once with the AUDIT credential, where `CAPABILITY_CONFIRMED` is
 * the required result, and once with the INTEGRATION credential, where
 * `CAPABILITY_REFUSED_BY_PROVIDER` is what a correctly scoped `mail.send`-only key produces.
 * `§8.7`: "Where safe and useful, also prove prohibited cross-capability access in the other
 * direction."
 *
 * The second direction is safe in a way the send probe is not: a read cannot mutate, so the
 * worst case of a mis-scoped send key is a record read, not a message sent.
 *
 * PERIMETER_EXEMPT(credential_scope_conformance_probe, 36-13) — an operator-invoked
 * capability measurement with no ACOS effect behind it, carrying no `authorisation_ref` and
 * not pretending to.
 */
export async function probeActivityReadCapability(input: {
  readonly secret: string;
  readonly credentialIdentity: string;
  /** Which plane's credential this process holds. Carried into evidence by the child. */
  readonly plane: 'INTEGRATION' | 'AUDIT';
  readonly periodStartMs: number;
  readonly periodEndMs: number;
}): Promise<ProbeRecord> {
  const controller = new AbortController();
  const deadline = setTimeout(() => {
    controller.abort();
  }, PROBE_DEADLINE_MS);
  const search = new URLSearchParams({
    query: buildActivityQuery({
      correlationTag: null,
      periodStartMs: input.periodStartMs,
      periodEndMs: input.periodEndMs,
      limit: 1,
    }),
    limit: '1',
  });
  try {
    // PERIMETER_EXEMPT(credential_scope_conformance_probe, 36-13) — measures whether THIS
    // credential holds `email_activity.read` at the provider, rather than assuming it from
    // the key's name, its id, its label or the request that created it.
    const response = await globalThis.fetch(
      `${SENDGRID_API_ORIGIN}${SENDGRID_MESSAGES_PATH}?${search.toString()}`,
      {
        method: 'GET',
        headers: { authorization: `Bearer ${input.secret}` },
        signal: controller.signal,
      },
    );
    const outcome = classify(response.status, [200]);
    return {
      operation: `GET ${SENDGRID_MESSAGES_PATH}`,
      credentialIdentity: input.credentialIdentity,
      plane: input.plane,
      httpStatus: response.status,
      outcome,
      note:
        outcome === 'CAPABILITY_CONFIRMED'
          ? 'the credential holds email_activity.read at the provider'
          : outcome === 'CAPABILITY_REFUSED_BY_PROVIDER'
            ? 'the provider refused the read for this credential'
            : 'the provider answered with a status that settles neither capability; a 4xx ' +
              'other than 401/403 may indicate the Email Activity entitlement is absent ' +
              'rather than the scope',
    };
  } catch {
    return {
      operation: `GET ${SENDGRID_MESSAGES_PATH}`,
      credentialIdentity: input.credentialIdentity,
      plane: input.plane,
      httpStatus: null,
      outcome: 'PROVIDER_UNREACHABLE',
      note: 'the provider was not reached; no capability conclusion is drawn',
    };
  } finally {
    clearTimeout(deadline);
  }
}

/**
 * `§11`, `§13` — THE DELIBERATE DUPLICATE NEGATIVE CONTROL. **ISOLATED, OPT-IN, AND NOT A
 * DISPATCH PATH.**
 *
 * =================================================================================
 * WHAT IT IS FOR, AND WHY IT IS NOT AN ADAPTER METHOD
 *
 * `I36`'s oracle claims to be able to tell ONE provider-accepted message from TWO. That claim
 * is only worth something if the oracle has been shown to SEE two when two exist — otherwise a
 * matrix in which every row reports `1` is equally consistent with an oracle that can only
 * ever report `1`, which is precisely the defect correction 10 found in the stop-on-first
 * loop.
 *
 * So this function deliberately produces the condition `I36` exists to exclude: TWO accepted
 * messages under ONE correlation tag. `§13`'s constraints are all structural here:
 *
 *   - it is in `harness/`, reached only from a one-shot probe process, and it is NOT a member
 *     of `IntegrationAdapter`. The kernel dispatch path cannot reach it: `adapter.ts` does not
 *     import this module and the integration wire has no operation that names it.
 *   - it takes an owner-controlled sink and REFUSES anything else, before constructing a body.
 *   - it sends EXACTLY TWICE. There is no loop and no count parameter — two literal calls —
 *     so "minimal two-send experiment" is a property of the code rather than of an argument.
 *   - it carries its OWN correlation tag, supplied by the coordinator, so the duplicate pair
 *     is queryable in isolation and cannot contaminate a scenario's count.
 *   - it runs only behind `§11`'s SECOND acknowledgement, which `preflight.ts` gates and which
 *     the coordinator must have passed before this process is launched at all.
 *
 * **IT CARRIES NO `authorisation_ref` AND DOES NOT PRETEND TO.** There is no ACOS effect
 * behind it, no claim, no outbox row and no dispatch — recording it as an annotated, ticketed,
 * reviewed exemption is `48 §3`'s own answer to a hole that has to exist.
 *
 * PERIMETER_EXEMPT(duplicate_negative_control, S1P-11) — an operator-invoked, separately
 * acknowledged two-send experiment against a dedicated non-production account's own sink.
 */
export async function sendToProviderSendGridDuplicateProbe(input: {
  readonly secret: string;
  readonly credentialIdentity: string;
  readonly correlationTag: string;
  readonly senderAddress: string;
  readonly sinkAddress: string;
}): Promise<ProbeRecord> {
  const refused = (note: string): ProbeRecord => ({
    operation: `POST ${SENDGRID_MAIL_SEND_PATH} x2`,
    credentialIdentity: input.credentialIdentity,
    plane: 'INTEGRATION',
    httpStatus: null,
    outcome: 'NOT_RUN',
    note,
  });

  if (!isUsableAddress(input.senderAddress)) return refused('the probe sender is not an address');
  if (!isOwnerControlledSink(input.sinkAddress)) {
    return refused('the probe sink is not the owner-controlled non-production sink');
  }

  const mapped = buildSendGridSendRequest({
    authorised: {
      senderAddress: input.senderAddress,
      sinkAddress: input.sinkAddress,
      subject: `ACOS S1P DUPLICATE NEGATIVE CONTROL ${input.correlationTag}`,
      bodyText:
        'This message is one of a deliberately duplicated PAIR, sent by the ACOS S1P ' +
        'duplicate negative control to prove that the I36 provider-side oracle can observe ' +
        'two accepted messages under one correlation. It carries no business content.',
    },
    correlationTag: input.correlationTag,
    sandboxMode: false,
  });
  if (mapped.kind === 'REFUSED') {
    return refused(`the probe body could not be constructed: ${mapped.reason}`);
  }

  const post = async (): Promise<number | null> => {
    const controller = new AbortController();
    const deadline = setTimeout(() => {
      controller.abort();
    }, PROBE_DEADLINE_MS);
    try {
      // PERIMETER_EXEMPT(duplicate_negative_control, S1P-11) — the deliberate second accepted
      // message, to the owner's own sink, behind §11's separate acknowledgement.
      const response = await globalThis.fetch(`${SENDGRID_API_ORIGIN}${SENDGRID_MAIL_SEND_PATH}`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${input.secret}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(mapped.body),
        signal: controller.signal,
      });
      return response.status;
    } catch {
      return null;
    } finally {
      clearTimeout(deadline);
    }
  };

  /*
   * EXACTLY TWO CALLS. WRITTEN TWICE, NOT LOOPED.
   *
   * A loop with a bound of two is a loop whose bound is one edit away from being three, and
   * this is the one function in the repository whose job is to send a message ACOS did not
   * authorise. Two statements is the smallest expression of "exactly two" that a reviewer can
   * check without reading a variable.
   */
  const first = await post();
  const second = await post();

  if (first === null || second === null) {
    return {
      operation: `POST ${SENDGRID_MAIL_SEND_PATH} x2`,
      credentialIdentity: input.credentialIdentity,
      plane: 'INTEGRATION',
      httpStatus: first ?? second,
      outcome: 'PROVIDER_UNREACHABLE',
      note: 'at least one of the two sends did not reach the provider; the duplicate ' +
        'condition was NOT established and no oracle conclusion may be drawn from it',
    };
  }
  const bothAccepted = first === 202 && second === 202;
  return {
    operation: `POST ${SENDGRID_MAIL_SEND_PATH} x2`,
    credentialIdentity: input.credentialIdentity,
    plane: 'INTEGRATION',
    httpStatus: second,
    outcome: bothAccepted ? 'CAPABILITY_CONFIRMED' : 'INCONCLUSIVE',
    note: bothAccepted
      ? `the provider accepted BOTH sends (${String(first)}, ${String(second)}); the ` +
        'duplicate condition is established and the oracle must now observe a count of at ' +
        'least two for this correlation'
      : `the provider answered ${String(first)} then ${String(second)}; the duplicate ` +
        'condition was not established, so the oracle was not put to the test',
  };
}
