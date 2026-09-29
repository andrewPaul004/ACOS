import { createHash } from 'node:crypto';

import type {
  AdapterInvocation,
  IntegrationAdapter,
  ProviderBoundary,
} from '../../../src/integration/runtime/integrationAdapter.js';
import type { WireOutcome } from '../../../src/integration/protocol/wire.js';
import { buildSendGridSendRequest } from './requestMapping.js';
import {
  SIGNED_ACTION_CLASS,
  SIGNED_METHOD,
  SIGNED_RECOVERABILITY,
  parseValidationEmailPayload,
} from './validationPayload.js';
import { classifySendGridSendResponse, sendToProviderSendGrid } from './providerClient.js';

/**
 * THE SENDGRID Z2 ADAPTER — `sendgrid_email`. NON-PRODUCTION VALIDATION ONLY.
 *
 * =================================================================================
 * WHERE THIS RUNS, AND WHY THE ANSWER IS THE WHOLE SECURITY ARGUMENT
 *
 * This module is loaded by `src/integration/runtime/main.ts`, INSIDE the `child_process.fork`
 * the control plane spawned, from a module specifier that is trusted launch configuration and
 * that `main.ts` refuses unless it resolves inside the declared runtime root. By the time
 * `invoke` runs, the ACCEPTED integration host has already:
 *
 *   1. decoded the request against the closed twenty-field schema;
 *   2. checked the adapter identity against this runtime's own;
 *   3. checked `authorisationRef` is present (`I24`);
 *   4. checked it is BOUND to this exact effect (`§16`);
 *   5. checked the payload bytes hash to the hash the authorisation committed;
 *   6. resolved the credential from THIS runtime's own source, per invocation;
 *   7. compared the resolved material's identity to the signed class-5 `credential_id`.
 *
 * **NONE OF THOSE CHECKS IS REIMPLEMENTED HERE**, and none can be skipped: guard 8 is the
 * only call site of `invoke` and every earlier guard is an early return.
 *
 * =================================================================================
 * WHAT THIS ADAPTER ADDS AFTER THE S1P INDEPENDENT REVIEW — CORRECTIONS 2 AND 17
 *
 * Step 5 above proves the bytes are the AUTHORISED bytes. It does not make anybody READ
 * them, and the rejected version of this adapter did not: it verified the hash and then
 * built its request out of launch configuration. The review's finding, and its consequence:
 * "A configuration change can change the recipient while preserving the same authorised
 * payload."
 *
 * So the chain is closed HERE, in four steps that all precede the boundary mark:
 *
 *   A. THE INVOCATION MUST NAME THE SIGNED OPERATION. `invocation.actionClass` must be
 *      `email.send` and `invocation.method` must be `emailSend` — the two values the signed
 *      class-3 record carries for this adapter — and `invocation.recoverability` must be
 *      `IRRECOVERABLE`, which is the same record's field 2. A `sendgrid_email` adapter
 *      implementing ONE operation refuses anything that is not that operation, so the signed
 *      `method` field CONSTRAINS what this adapter does rather than merely describing it.
 *      (Correction 17.)
 *   B. THE PAYLOAD IS PARSED against a CLOSED schema, and an unknown or missing field is a
 *      refusal. (Correction 2, `§2.2` item 5.)
 *   C. THE REQUEST IS BUILT FROM THE PARSED PAYLOAD and from nothing else. This module
 *      imports no configuration reader; there is no address in its scope that is not the
 *      authorised one. Substituting a launch document therefore cannot change the recipient,
 *      which is what `tests/negative-controls/sendgrid-controls.test.ts` CONTROL 9
 *      discriminates.
 *   D. ONLY THE CORRELATION TAG is added outside the payload, and only onto `categories` and
 *      `custom_args`. `§2.1` admits that explicitly: kernel/outbox metadata added after
 *      authorisation, on provider-visible correlation fields, altering no business or
 *      recipient semantics.
 *
 * EVERY ONE OF A TO D REFUSES WITH `ADAPTER_THREW_PRE_SEND`, before `markProviderClientCrossed`,
 * so every one of them is honestly pre-send and `25 §7.2`'s "could the write have escaped?"
 * answers NO for all of them.
 *
 * =================================================================================
 * `I25`: THE CONTROL PROCESS NEVER SEES THE KEY, AND CANNOT
 *
 * `invocation.credential` did not cross the wire. `DispatchRequest` has no member a secret
 * could occupy, the child's environment is an eight-key constructed allowlist carrying a
 * LOCATOR rather than material, and `DispatchResponse` carries a non-secret
 * `credentialIdentity` and has nowhere to put the key on the way back.
 *
 * =================================================================================
 * NO PROVIDER-CONTROLLED AUTHORITY, AND NO PROVIDER RETRY
 *
 * `36 §7` / `I26`: "A compromised adapter must produce a well-formed VENDOR RESPONSE, not a
 * well-formed ACOS FACT." This adapter returns a member of the closed `WireOutcome` taxonomy
 * and nothing else. A SendGrid response cannot set an ACOS state, cannot extend a claim,
 * cannot reverse an outcome and cannot cause a second send: there is no loop in this file
 * and no call to `sendToProviderSendGrid` other than the one below.
 * =================================================================================
 */

const ADAPTER_ID = 'sendgrid_email';

/*
 * `SIGNED_ACTION_CLASS`, `SIGNED_METHOD` and `SIGNED_RECOVERABILITY` ARE DECLARED IN
 * `validationPayload.ts`, NOT HERE.
 *
 * They are the operands of correction 17's refusals below, and they are also what the OFFLINE
 * double must check against. Declaring them in the module that holds the vendor send client
 * would mean the double acquired a live `POST /v3/mail/send` in order to learn the name of the
 * method it must refuse — so they live in the pure module and this file imports them.
 */

export const integrationAdapter: IntegrationAdapter = {
  adapterId: ADAPTER_ID,

  async invoke(invocation: AdapterInvocation, boundary: ProviderBoundary): Promise<WireOutcome> {
    /*
     * EVERY REFUSAL BELOW HAPPENS BEFORE `markProviderClientCrossed`, SO EVERY ONE OF THEM
     * IS HONESTLY PRE-SEND.
     *
     * The host classifies a throw from an unmarked adapter as `ADAPTER_THREW_PRE_SEND`, and
     * these return `ADAPTER_FAILED` with the same class directly. `25 §7.2`'s question —
     * "could the write have escaped?" — has one answer above the mark and a different one
     * below it, and nothing in this method blurs the line.
     */
    const refusePreSend = (): WireOutcome => ({
      kind: 'ADAPTER_FAILED',
      failureClass: 'ADAPTER_THREW_PRE_SEND',
    });

    /*
     * A — THE INVOCATION MUST NAME THE ONE SIGNED OPERATION. CORRECTION 17.
     *
     * "The signed class-3 `method` field must actually constrain what the adapter does."
     * These three comparisons are the constraint. They are not defence against the host,
     * which already checked the adapter identity; they are the adapter refusing to perform
     * an operation the signed record does not say it performs, which is a different claim
     * and the one `36 §7` is about.
     */
    if (invocation.actionClass !== SIGNED_ACTION_CLASS) return refusePreSend();
    if (invocation.method !== SIGNED_METHOD) return refusePreSend();
    if (invocation.recoverability !== SIGNED_RECOVERABILITY) return refusePreSend();

    /*
     * B — THE AUTHORISED BYTES ARE PARSED, AND THE PARSE IS CLOSED.
     *
     * `invocation.dispatchPayloadBytes` is the payload the host verified against
     * `dispatch_payload_hash`. Everything the provider request says about WHO receives the
     * effect and WHAT is sent comes out of this call and out of nothing else.
     */
    const parsed = parseValidationEmailPayload(invocation.dispatchPayloadBytes, {
      adapterId: ADAPTER_ID,
      method: SIGNED_METHOD,
      authorisationRef: invocation.authorisationRef,
    });
    if (parsed.kind === 'REFUSED') return refusePreSend();

    /*
     * C and D — THE REQUEST IS THE AUTHORISED EFFECT PLUS THE KERNEL'S CORRELATION TAG.
     *
     * `§8.6` — SANDBOX MODE FAILS BEFORE THE SEND. `sandboxMode: false` is passed as a
     * LITERAL rather than read from anywhere, which is the structural form of the rule:
     * there is no document an operator could write, and no environment variable anyone could
     * set, that makes this adapter emit a sandbox request. `buildSendGridSendRequest` still
     * carries the refusal because the input shape must be able to express the unsafe case
     * for the discriminating test to exercise it.
     */
    const mapped = buildSendGridSendRequest({
      authorised: parsed.payload,
      correlationTag: invocation.correlationTag,
      sandboxMode: false,
    });
    if (mapped.kind === 'REFUSED') return refusePreSend();

    /*
     * `§31` / `25 §7.2` — THE MARK GOES BEFORE THE CALL, NEVER AFTER IT.
     *
     * A flag set after the provider call is unset in exactly the case it exists for, which
     * is a call that crossed and then died. Everything above this line is provably pre-send;
     * everything below it may have escaped.
     */
    boundary.markProviderClientCrossed();

    let response;
    try {
      // PERIMETER_AUTHORISED(authorisation_ref) — I24, 48 §4 item 2. `invocation` carries
      // `authorisationRef`, which the integration host validated for PRESENCE and then for
      // BINDING to this exact effect before any line of this adapter ran, and which this
      // adapter then compared against the authorisation the PAYLOAD names.
      response = await sendToProviderSendGrid({
        body: mapped.body,
        secret: invocation.credential.secret,
      });
    } catch {
      // The boundary was crossed. The exception is not read and its message never crosses
      // the process boundary (`§23`).
      return { kind: 'OUTCOME_UNKNOWN', reason: 'AMBIGUOUS' };
    }

    const classification = classifySendGridSendResponse(response);
    switch (classification.kind) {
      case 'ACCEPTED':
        return {
          kind: 'ADAPTER_RETURNED',
          /*
           * SENDGRID'S OWN `X-Message-Id`, PRESERVED AS PROVIDER EVIDENCE — `§8.3`.
           *
           * It is the provider's identity for the request, it is what
           * `GET /v3/messages/{msg_id}` takes, and it is NOT the ACOS correlation tag: the
           * tag is what ACOS minted and the message id is what SendGrid answered. `§8.3`
           * requires both and forbids confusing one for the other.
           */
          providerReference: classification.providerMessageId,
          /*
           * `§44` — THE RAW RECORD DOES NOT CROSS. A DIGEST DOES.
           *
           * `WireOutcome` has no member a body could occupy, so the bound is structural.
           * What is hashed is the status line and the message id — the two facts this
           * package retained — rather than a response body it deliberately never read.
           */
          rawResponseHash: createHash('sha256')
            .update(
              `sendgrid:202:${classification.providerMessageId ?? ''}:${invocation.correlationTag}`,
              'utf8',
            )
            .digest('hex'),
        };

      case 'SANDBOX_SUPPRESSED':
        /*
         * A 200 MEANS THE ACCOUNT APPLIED SANDBOX MODE, AND THE EVIDENCE DOES NOT EXIST.
         *
         * `ADAPTER_FAILED` rather than `ADAPTER_RETURNED`: the request was validated and
         * nothing was delivered, so treating it as a return would record an acceptance the
         * provider did not make and would leave `I36` reading an Email Activity feed that
         * S1O established will hold no event for it. The harness reports the status as a
         * configuration defect.
         */
        return { kind: 'ADAPTER_FAILED', failureClass: 'PROVIDER_CLIENT_REJECTED' };

      case 'REJECTED':
        /*
         * NOT `NOT_SENT_CONFIRMED`. See `classifySendGridSendResponse`'s header: `25 §7.2`'s
         * second basis needs a MEASURED vendor no-mutation guarantee, `36 §7` says where it
         * comes from, and S1P has measured none.
         */
        return { kind: 'ADAPTER_FAILED', failureClass: 'PROVIDER_CLIENT_REJECTED' };

      case 'UNKNOWN':
      default:
        return { kind: 'OUTCOME_UNKNOWN', reason: 'AMBIGUOUS' };
    }
  },
};
