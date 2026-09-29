import type { SendGridMailSendBody } from './requestMapping.js';
import { SENDGRID_MAIL_SEND_PATH } from './requestMapping.js';

/**
 * THE ONE VENDOR HTTP CLIENT FOR SENDS — `48 §4` ITEM 1, AND THE FIRST REAL ONE IN THIS
 * REPOSITORY'S HISTORY.
 *
 * =================================================================================
 * "ONE VENDOR-HTTP CLIENT PER ADAPTER. NO AD-HOC HTTP CONSTRUCTION ANYWHERE IN THE CODEBASE"
 *
 * `48 §4` item 1, verbatim, and this file is the whole of the send side's compliance with it.
 * `tools/perimeter/` recognises the `sendToProvider*` declaration shape, scans this tree at
 * PRODUCTION scope because `validation/` is not `tests/`, and fails the build on an
 * unannotated site. `tests/sendgrid/provider-client-boundary.test.ts` asserts the structural
 * half a scanner cannot: exactly one origin constant, exactly one path, and no route by
 * which either could come from an argument.
 *
 * =================================================================================
 * THERE IS NO ARBITRARY-URL CAPABILITY, AND THE ABSENCE IS STRUCTURAL RATHER THAN CHECKED
 *
 * `§19` of the S1P mandate forbids "a generic arbitrary-HTTP escape hatch", and `§8.1`
 * forbids exposing "arbitrary URL, verb, header, or body passthrough" to control.
 *
 *   - the ORIGIN is a module constant;
 *   - the PATH is a module constant;
 *   - the METHOD is the literal `'POST'`;
 *   - the HEADERS are constructed here from the credential and nothing else;
 *   - the BODY is a `SendGridMailSendBody`, which only `buildSendGridSendRequest` produces.
 *
 * `SendGridSendRequest` therefore has no member that could name a destination. The control
 * plane is two process boundaries away from this function and `DispatchRequest`'s closed
 * twenty-field list contains no `url`, `method`, `headers` or `body` member either, so there
 * is no value the control plane can set that reaches any part of the request line.
 *
 * =================================================================================
 * NO RETRY. NOT ONE, NOT CONDITIONAL, NOT "SAFE" — `§33`, `§19`
 *
 * There is no loop in this file, no `setTimeout`, no attempt counter and no retry predicate.
 * `25 §7` is why: a retried send for a CLAIMED effect is the duplicate `I36` exists to
 * forbid, and a client that retried on a 5xx would do exactly that for the one status whose
 * meaning is "the provider may or may not have accepted it". A transport failure becomes
 * `OUTCOME_UNKNOWN` at the adapter and the effect stays `CLAIMED`; nothing in this package
 * sends it again, ever.
 * =================================================================================
 */

/** THE ONE ORIGIN. A CONSTANT — never an argument, never composed, never configurable. */
export const SENDGRID_API_ORIGIN = 'https://api.sendgrid.com';

/**
 * The transport deadline, in milliseconds.
 *
 * Below `integrationClient.ts`'s `DEFAULT_INVOCATION_DEADLINE_MS` (10s) so a hung provider
 * produces this adapter's own `OUTCOME_UNKNOWN` rather than the control plane's invocation
 * timeout. Both are honest; the inner one carries more information.
 */
export const SENDGRID_SEND_DEADLINE_MS = 8_000;

/** What the client is handed. NO MEMBER NAMES A DESTINATION. */
export interface SendGridSendRequest {
  readonly body: SendGridMailSendBody;
  /**
   * The vendor secret, presented exactly where a vendor client presents one.
   *
   * An ARGUMENT rather than a module-level value, for the reason
   * `tests/integration-plane/adapterA/providerClient.ts` takes one: it keeps the material in
   * the one call frame `§29`'s leak matrix has to account for. It is never logged, never
   * returned and never placed on a result.
   */
  readonly secret: string;
}

/**
 * What the provider answered. NON-SECRET, AND NARROW BY CONSTRUCTION.
 *
 * There is no member the response BODY could occupy. `§44` of the S1N mandate: "Do not
 * expose arbitrary raw provider response to worker/model", and a client that returned the
 * body would put the decision about what to keep in the adapter, one layer too late.
 */
export type SendGridSendResponse =
  | {
      readonly kind: 'PROVIDER_ANSWERED';
      readonly httpStatus: number;
      /** SendGrid's `X-Message-Id` response header, or `null` when it sent none. */
      readonly providerMessageId: string | null;
    }
  /** The boundary was crossed and no answer came back. NEVER conflated with a rejection. */
  | { readonly kind: 'NO_ANSWER' };

/**
 * `POST https://api.sendgrid.com/v3/mail/send`. THE ONE SEND CALL SITE.
 *
 * PERIMETER_AUTHORISED(authorisation_ref) — I24, 48 §4 item 2. Every invocation of this
 * function is reached only from `adapter.ts`, which receives an `AdapterInvocation` whose
 * `authorisationRef` the integration host validated for PRESENCE and then for BINDING to
 * this exact effect, before any line of this package ran.
 */
export async function sendToProviderSendGrid(
  request: SendGridSendRequest,
): Promise<SendGridSendResponse> {
  const controller = new AbortController();
  const deadline = setTimeout(() => {
    controller.abort();
  }, SENDGRID_SEND_DEADLINE_MS);

  try {
    // PERIMETER_AUTHORISED(authorisation_ref) — I24, 48 §4 item 2. The destination is
    // `SENDGRID_API_ORIGIN` and `SENDGRID_MAIL_SEND_PATH`, both module constants; no
    // argument of this function participates in the request line.
    const response = await globalThis.fetch(`${SENDGRID_API_ORIGIN}${SENDGRID_MAIL_SEND_PATH}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${request.secret}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(request.body),
      signal: controller.signal,
    });
    return {
      kind: 'PROVIDER_ANSWERED',
      httpStatus: response.status,
      providerMessageId: response.headers.get('x-message-id'),
    };
  } catch {
    /*
     * THE EXCEPTION IS NOT READ, AND ITS MESSAGE NEVER LEAVES THIS FRAME — `§23`.
     *
     * A transport error at this point means the request MAY have reached the provider. `25
     * §7.2`: "Anything for which the request MAY have escaped is OUTCOME_UNKNOWN", and this
     * return is what the adapter turns into one. An abort, a DNS failure and a reset are the
     * same fact here, and distinguishing them would be distinguishing them in a direction
     * that cannot change the answer.
     */
    return { kind: 'NO_ANSWER' };
  } finally {
    clearTimeout(deadline);
  }
}

/**
 * `202 Accepted` — the ONLY status this package treats as provider acceptance.
 *
 * S1O's capability record, from Twilio SendGrid's own documentation: a live accepted request
 * returns 202 where a valid SANDBOX request returns 200. The distinction is not cosmetic and
 * the constant is separated from the classifier so a test can state it.
 */
export const SENDGRID_ACCEPTED_STATUS = 202;

/** The sandbox status, named so the classifier can refuse it rather than ignore it. */
export const SENDGRID_SANDBOX_VALIDATED_STATUS = 200;

/**
 * The outcome taxonomy one send response maps to. PURE — no transport, fully testable.
 *
 * =================================================================================
 * `NOT_SENT_CONFIRMED` IS NOT REACHABLE FROM ANY PROVIDER STATUS, AND THAT IS THE FINDING
 *
 * `25 §7.2` admits two bases, and the second is "a provider rejection whose declared adapter
 * contract **guarantees** no external mutation occurred". `36 §7` requires that guarantee to
 * be ESTABLISHED against the vendor, and
 * `tests/integration-plane/adapterA/adapter.ts` says why a synthetic adapter's version of it
 * proves nothing: it "IS the provider".
 *
 * **S1P HAS MEASURED NO SUCH CONTRACT.** Twilio SendGrid publishes no statement that a 400
 * or a 403 from `/v3/mail/send` guarantees no message was queued, and this package will not
 * infer one from a status code's usual meaning. So every provider answer other than 202 is
 * `ADAPTER_FAILED / PROVIDER_CLIENT_REJECTED` — which carries "no local outcome policy"
 * (`25 §7.1`) and therefore claims nothing — and the effect stays `CLAIMED`.
 *
 * The cost is stated rather than engineered away, exactly as `35 §12.3` states the analogous
 * one: a request SendGrid definitely refused is treated as one that might not have been
 * refused. Recorded as an open obligation, and the measurement that would close it is an
 * account-level probe, not a code change.
 *
 * A `200` is the sandbox status. It is reachable only if the account forced sandbox mode on
 * at the account level, because `buildSendGridSendRequest` emits `enable: false` and refuses
 * an input asking otherwise — so it is classified as its own failure rather than as success,
 * and the harness reports it as a configuration defect.
 * =================================================================================
 */
export type SendGridSendClassification =
  | { readonly kind: 'ACCEPTED'; readonly providerMessageId: string | null }
  /** The provider answered and did not accept. No no-mutation guarantee is claimed. */
  | { readonly kind: 'REJECTED'; readonly httpStatus: number }
  /** A 200: the account applied sandbox mode. `I36` evidence would not exist. */
  | { readonly kind: 'SANDBOX_SUPPRESSED'; readonly httpStatus: number }
  /** The request may have escaped and no answer came back. */
  | { readonly kind: 'UNKNOWN' };

export function classifySendGridSendResponse(
  response: SendGridSendResponse,
): SendGridSendClassification {
  if (response.kind === 'NO_ANSWER') return { kind: 'UNKNOWN' };
  if (response.httpStatus === SENDGRID_ACCEPTED_STATUS) {
    return { kind: 'ACCEPTED', providerMessageId: response.providerMessageId };
  }
  if (response.httpStatus === SENDGRID_SANDBOX_VALIDATED_STATUS) {
    return { kind: 'SANDBOX_SUPPRESSED', httpStatus: response.httpStatus };
  }
  /*
   * A 5xx IS `UNKNOWN`, NOT A REJECTION.
   *
   * "The provider had an internal error" does not say whether the message was queued first.
   * `25 §7.2`'s question is "could the write have escaped?", and for a 5xx the honest answer
   * is yes. A 429 is treated the same way for the same reason: SendGrid's documented rate
   * limiting sits in front of the API, and this package will not assume where.
   */
  if (response.httpStatus >= 500 || response.httpStatus === 429) return { kind: 'UNKNOWN' };
  return { kind: 'REJECTED', httpStatus: response.httpStatus };
}
