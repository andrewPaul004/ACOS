/**
 * THE ONE VENDOR HTTP CLIENT FOR AUDIT-PLANE READS — `48 §2` ROW 13, `48 §3.6`.
 *
 * =================================================================================
 * AN EXEMPTION IS NOT A HOLE. IT IS A NAMED, ANNOTATED, REVIEWED HOLE
 *
 * `48 §3`, verbatim, and the reason every read site in this file carries
 * `PERIMETER_EXEMPT(audit_plane_read_only, 48-3-6)` even though `48` exempts an audit read
 * from carrying an `authorisation_ref`: **an unenumerated read is not exempt, it is
 * unreviewed.** `tools/perimeter/` recognises the `readFromProvider*` declaration shape,
 * scans this tree at PRODUCTION scope, and fails the build on an unannotated site.
 *
 * =================================================================================
 * THERE IS NO SEND FUNCTION IN THIS FILE, AND THAT IS THE POINT OF THE WHOLE BOUNDARY
 *
 * `§16` of the S1O mandate: "No send operation." A file named `providerReadClient.ts` that
 * also exported a `sendToProviderSendGrid` would satisfy every structural check in the audit
 * runtime and defeat the architecture, so the absence is ASSERTED rather than intended:
 * `tests/sendgrid/audit-reader-boundary.test.ts` scans this directory for the
 * `sendToProvider*` declaration shape `tools/perimeter/` recognises and requires ZERO, and
 * `perimeter-enumeration.test.ts` requires zero `PROVIDER_CLIENT` sites under
 * `validation/sendgrid/audit/`.
 *
 * **THE `36 §13` ATTEMPTED-WRITE PROBE IS NOT HERE.** It is `sendRefusalProbe.ts`, it is not
 * imported by `reader.ts`, and it is not reachable from any audit read IPC message. `§8.2`:
 * "Do NOT add a normal audit IPC 'send' method just to perform the negative control."
 *
 * =================================================================================
 * TWO OPERATIONS, TWO CONSTANT PATHS, NO ARBITRARY URL
 *
 * `GET /v3/messages` and `GET /v3/messages/{msg_id}` — S1O's capability record cites both,
 * and this client has exactly those two. The message id is the ONE value that reaches a path
 * and it is percent-encoded and shape-checked before it does; every other narrowing goes in
 * the documented query language, which `buildActivityQuery` constructs from a closed set of
 * operands.
 *
 * `ProviderReadQuery` — the ACCEPTED audit IPC type this client's caller receives — has no
 * `url`, `path`, `endpoint`, `host`, `origin`, `method`, `headers`, `body` or `query` member,
 * so nothing a caller supplies can name a destination.
 * =================================================================================
 */

import {
  isUsableProviderMessageId,
  normaliseActivityRecords,
  type SendGridReadResponse,
} from './activityRecords.js';

/** THE ONE ORIGIN. A CONSTANT — never an argument, never composed, never configurable. */
export const SENDGRID_API_ORIGIN = 'https://api.sendgrid.com';

/** `GET /v3/messages`, the Email Activity search. A CONSTANT. */
export const SENDGRID_MESSAGES_PATH = '/v3/messages';

/**
 * The transport deadline for one read, in milliseconds.
 *
 * Below `auditReadClient.ts`'s `DEFAULT_READ_DEADLINE_MS` (15s) so a hung provider produces
 * this client's own `NOT_REACHED` rather than the audit plane's IPC timeout.
 */
export const SENDGRID_READ_DEADLINE_MS = 12_000;

/**
 * The closed operand set one activity query may narrow on.
 *
 * `categories` is S1O's unambiguous correlation mechanism on BOTH sides — settable on the v3
 * send and itself a documented Email Activity filter field — so it is the one this client
 * filters on. `last_event_time` carries `48`'s mandatory period bound.
 */
export interface SendGridActivityQuery {
  readonly correlationTag: string | null;
  readonly periodStartMs: number;
  readonly periodEndMs: number;
  readonly limit: number;
}

/**
 * Build the documented query string. PURE, and the only place one is constructed.
 *
 * The values it interpolates are a correlation tag — which `isCorrelationTag` has already
 * constrained to `acos-corr-` plus a UUID — and two epoch timestamps rendered as ISO
 * instants. There is no operand a caller could use to inject a second clause, because there
 * is no operand a caller supplies that is not one of those three.
 */
export function buildActivityQuery(query: SendGridActivityQuery): string {
  const from = new Date(query.periodStartMs).toISOString();
  const to = new Date(query.periodEndMs).toISOString();
  const clauses = [
    `last_event_time BETWEEN TIMESTAMP "${from}" AND TIMESTAMP "${to}"`,
  ];
  if (query.correlationTag !== null) {
    clauses.push(`Contains(categories,"${query.correlationTag}")`);
  }
  return clauses.join(' AND ');
}

/**
 * `GET https://api.sendgrid.com/v3/messages`. THE ONE ACTIVITY-SEARCH CALL SITE.
 *
 * PERIMETER_EXEMPT(audit_plane_read_only, 48-3-6) — `48 §2` row 13. Read-only: the method is
 * the literal `'GET'` and this function has no branch that mutates provider state. The
 * `36 §13` empirical attempted-write test is separately owed and is not performed here.
 */
export async function readFromProviderSendGridActivity(input: {
  readonly secret: string;
  readonly query: SendGridActivityQuery;
}): Promise<SendGridReadResponse> {
  const controller = new AbortController();
  const deadline = setTimeout(() => {
    controller.abort();
  }, SENDGRID_READ_DEADLINE_MS);

  try {
    const search = new URLSearchParams({
      query: buildActivityQuery(input.query),
      limit: String(input.query.limit),
    });
    // PERIMETER_EXEMPT(audit_plane_read_only, 48-3-6) — 48 §2 row 13. The destination is
    // `SENDGRID_API_ORIGIN` and `SENDGRID_MESSAGES_PATH`, both module constants; the only
    // caller-supplied values are a correlation tag and two timestamps, inside the documented
    // query language.
    const response = await globalThis.fetch(
      `${SENDGRID_API_ORIGIN}${SENDGRID_MESSAGES_PATH}?${search.toString()}`,
      {
        method: 'GET',
        headers: { authorization: `Bearer ${input.secret}` },
        signal: controller.signal,
      },
    );
    if (!response.ok) {
      /*
       * A NON-OK READ IS `REFUSED_BY_PROVIDER`, AND IT IS NOT EVIDENCE OF ANYTHING ABOUT A
       * MESSAGE. CORRECTION 9.
       *
       * The status is preserved because the two refusals mean different things — the
       * documented 403 is "this key lacks Email Activity permission" and a 429 is the
       * published six-per-minute limit — and because a reviewer reading an UNRESOLVED row
       * needs to know which. What the status may NOT do is become a record count.
       */
      return { kind: 'REFUSED_BY_PROVIDER', httpStatus: response.status };
    }
    let payload: unknown;
    try {
      payload = (await response.json()) as unknown;
    } catch {
      // A 2xx whose body is not readable JSON. The provider answered and said nothing this
      // client can act on, which is neither an outage nor an observation.
      return { kind: 'UNREADABLE_RESPONSE', httpStatus: response.status };
    }
    /*
     * DEFECT 2.3 — **ONLY A STRUCTURALLY VALID PROVIDER RESPONSE MAY BECOME `ANSWERED`.**
     *
     * A 2xx whose JSON parses is not the same thing as a 2xx whose EMAIL ACTIVITY SHAPE is
     * readable. The second review: "A 2xx response whose JSON parses but whose Email Activity
     * shape is malformed must map to `UNREADABLE_RESPONSE`."
     *
     * So the normalisation result is discriminated here rather than flattened into a record
     * list, and a malformed answer never reaches the audit taxonomy as evidence.
     */
    const normalised = normaliseActivityRecords(payload, input.query.correlationTag);
    if (normalised.kind === 'MALFORMED') {
      return { kind: 'UNREADABLE_RESPONSE', httpStatus: response.status };
    }
    return {
      kind: 'ANSWERED',
      httpStatus: response.status,
      records: normalised.records,
    };
  } catch {
    // The exception is not read and its message never crosses the process boundary (`§23`).
    return { kind: 'NOT_REACHED' };
  } finally {
    clearTimeout(deadline);
  }
}

/**
 * `GET https://api.sendgrid.com/v3/messages/{msg_id}`. THE ONE ACTIVITY-DETAIL CALL SITE.
 *
 * A SECOND declaration rather than a widened first one, because the two reach different
 * documented endpoints and `48 §4` item 2 annotates SITES: a single function that chose its
 * path from an argument would be one site standing for two destinations, and the argument
 * that chose would be the arbitrary-URL member this package must not have.
 *
 * `providerMessageId` is the ONE caller value that reaches a path. It is shape-checked
 * against `MESSAGE_ID_GRAMMAR` and percent-encoded before it does, so a value carrying `/`,
 * `?`, `#` or `..` never becomes a path segment.
 *
 * PERIMETER_EXEMPT(audit_plane_read_only, 48-3-6) — `48 §2` row 13. Read-only: the method is
 * the literal `'GET'` and this function has no branch that mutates provider state.
 */
export async function readFromProviderSendGridMessage(input: {
  readonly secret: string;
  readonly providerMessageId: string;
  readonly expectedCorrelationTag: string | null;
}): Promise<SendGridReadResponse> {
  if (!isUsableProviderMessageId(input.providerMessageId)) {
    /*
     * Refused BEFORE the boundary. A message id that is not one is not a destination.
     *
     * `NOT_REACHED` rather than a synthetic 400: correction 9's rule is that only an answer
     * may be reported as one, and no request was made here. A fabricated status on a request
     * that never left would be this client asserting a provider behaviour it did not observe.
     */
    return { kind: 'NOT_REACHED' };
  }

  const controller = new AbortController();
  const deadline = setTimeout(() => {
    controller.abort();
  }, SENDGRID_READ_DEADLINE_MS);

  try {
    const segment = encodeURIComponent(input.providerMessageId);
    // PERIMETER_EXEMPT(audit_plane_read_only, 48-3-6) — 48 §2 row 13. The destination is
    // `SENDGRID_API_ORIGIN` and `SENDGRID_MESSAGES_PATH`, both module constants, plus one
    // shape-checked and percent-encoded message id.
    const response = await globalThis.fetch(
      `${SENDGRID_API_ORIGIN}${SENDGRID_MESSAGES_PATH}/${segment}`,
      {
        method: 'GET',
        headers: { authorization: `Bearer ${input.secret}` },
        signal: controller.signal,
      },
    );
    if (!response.ok) {
      // CORRECTION 9. See `readFromProviderSendGridActivity` and `SendGridReadResponse`.
      return { kind: 'REFUSED_BY_PROVIDER', httpStatus: response.status };
    }
    let payload: unknown;
    try {
      payload = (await response.json()) as unknown;
    } catch {
      return { kind: 'UNREADABLE_RESPONSE', httpStatus: response.status };
    }
    /*
     * The detail endpoint returns ONE message object rather than a `messages` array, so it
     * is wrapped into the shape `normaliseActivityRecords` reads. Wrapping rather than
     * writing a second reducer keeps ONE normalisation path, and therefore one place where
     * the "no recipient address is read" property has to hold.
     */
    // DEFECT 2.3, again. The detail endpoint answer is subject to the same rule.
    const normalised = normaliseActivityRecords(
      { messages: [payload] },
      input.expectedCorrelationTag,
    );
    if (normalised.kind === 'MALFORMED') {
      return { kind: 'UNREADABLE_RESPONSE', httpStatus: response.status };
    }
    return {
      kind: 'ANSWERED',
      httpStatus: response.status,
      records: normalised.records,
    };
  } catch {
    return { kind: 'NOT_REACHED' };
  } finally {
    clearTimeout(deadline);
  }
}
