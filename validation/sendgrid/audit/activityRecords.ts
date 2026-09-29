import { isCorrelationTag } from '../../../src/kernel/outbox/correlationTag.js';
import type {
  ProviderReadQuery,
  ProviderReadResult,
} from '../../../src/audit/provider/runtime/auditProviderReader.js';

/**
 * THE PURE HALF OF THE AUDIT READ PATH: RECORD SHAPES, THE RESPONSE TAXONOMY, AND THE
 * NORMALISATION. **NO `fetch`, NO CREDENTIAL, NO DESTINATION.**
 *
 * =================================================================================
 * WHY THIS IS A SEPARATE MODULE FROM `providerReadClient.ts`
 *
 * Three consumers need these shapes and NONE of them should acquire a vendor HTTP client by
 * asking for them:
 *
 *   `observation.ts`               needs the published rate limit to derive its minimum poll
 *                                  interval. It is a poller that `§8.4` requires to have
 *                                  NOTHING to send with, and importing a module that declares
 *                                  a `fetch` would put one in its closure.
 *   `reader.ts`                    needs the response taxonomy and the reduction. It is loaded
 *                                  by the audit runtime, which legitimately also loads the
 *                                  client — but the MAPPING is pure and testing it should not
 *                                  require a transport.
 *   `tests/sendgrid-doubles/`      needs both, in an OFFLINE child that must not hold a real
 *                                  provider capability at all. A double that imported the real
 *                                  client would put a live `POST`/`GET` into the very process
 *                                  whose whole point is that it cannot reach the provider.
 *
 * The third is the one that forced the split, and it is the right reason: the offline scenario
 * run must be unable to reach `api.sendgrid.com` STRUCTURALLY, not merely by not calling it.
 *
 * **CORRECTION 9 LIVES HERE.** `SendGridReadResponse`'s four members and the rule that only
 * `ANSWERED` may become `EVIDENCE` are the whole of it, and keeping them in a module the
 * doubles import means the offline run exercises the corrected mapping rather than a copy.
 * =================================================================================
 */

/**
 * S1O's capability record: "6 requests per minute; HTTP 429 above it" on the Email Activity
 * API. Declared here so the bounded observation loop can pace itself against the published
 * figure rather than against a guess, and carried into evidence.
 */
export const SENDGRID_ACTIVITY_REQUESTS_PER_MINUTE = 6;

/** SendGrid's message id grammar, as narrow as the documented values allow. */
const MESSAGE_ID_GRAMMAR = /^[A-Za-z0-9._@-]{1,128}$/;

export function isUsableProviderMessageId(value: string): boolean {
  return MESSAGE_ID_GRAMMAR.test(value);
}

/** One Email Activity record, reduced to the four non-secret facts the audit plane needs. */
export interface SendGridActivityRecord {
  readonly providerMessageId: string;
  readonly providerStatus: string;
  readonly providerTimestampMs: number;
  readonly correlationTag: string | null;
}

/**
 * WHAT ONE READ PRODUCED. FOUR MEMBERS, AND **ONLY THE FIRST IS EVIDENCE.**
 *
 * =================================================================================
 * CORRECTION 9 OF THE S1P INDEPENDENT REVIEW — A FAILED READ IS NOT A COUNT OF ZERO
 *
 * The rejected client had TWO members: `ANSWERED` carrying an HTTP status and a record list,
 * and `NOT_REACHED`. A 401, a 403, a 429 and a 5xx all became `ANSWERED` with an EMPTY record
 * list, `reader.ts` turned every `ANSWERED` into `EVIDENCE`, and the observation loop read
 * the result as "the provider holds no message for this correlation".
 *
 * The review, verbatim: "A 401, 403, 429, 5xx or other failed Email Activity query does NOT
 * establish: provider accepted count == 0." It is the most consequential defect in the read
 * path, because `I36`'s whole question is a provider-side count and a silently-zeroed count
 * PASSES the rows it should have left UNRESOLVED.
 *
 * So the states are now distinguished AT THE CLIENT, where the distinction exists, rather
 * than collapsed into one member and re-derived nowhere:
 *
 *   `ANSWERED`             the provider answered 2xx AND the body parsed. THE ONLY EVIDENCE.
 *   `REFUSED_BY_PROVIDER`  the provider answered, and not with success. Evidence about the
 *                          CREDENTIAL or the entitlement; never about the message.
 *   `UNREADABLE_RESPONSE`  the provider answered 2xx and the body was not JSON this client
 *                          could read. `§9`: "malformed provider response [...] must remain a
 *                          non-evidence result."
 *   `NOT_REACHED`          the boundary was reached and nothing answered, or the request was
 *                          refused before it was made.
 *
 * **THE HTTP STATUS IS PRESERVED ON THE REFUSAL MEMBER**, which is what lets `§9`'s exception
 * hold: "The separate scope-probe path may preserve the raw HTTP status because that path
 * exists specifically to evaluate permission refusal." the capability-probe module has its own client
 * and reads its own status; this member keeps the ordinary read path able to say WHY it
 * produced no evidence without pretending the absence was an observation.
 * =================================================================================
 */
export type SendGridReadResponse =
  | {
      readonly kind: 'ANSWERED';
      readonly httpStatus: number;
      readonly records: readonly SendGridActivityRecord[];
    }
  /** The provider answered, and refused. NOT an observation of zero messages. */
  | { readonly kind: 'REFUSED_BY_PROVIDER'; readonly httpStatus: number }
  /** The provider answered successfully and the body could not be read. Not evidence. */
  | { readonly kind: 'UNREADABLE_RESPONSE'; readonly httpStatus: number }
  /** The boundary was reached and the provider did not answer, or no request was made. */
  | { readonly kind: 'NOT_REACHED' };

/**
 * WHY A NORMALISATION HAS A RESULT TYPE AT ALL — SECOND REVIEW, DEFECT 2.
 *
 * =================================================================================
 * THE DEFECT: SUCCESSFUL **JSON** PARSING WAS BEING CONFUSED WITH SUCCESSFUL **EVIDENCE**
 *
 * The previous `normaliseActivityRecords` returned a plain array and SILENTLY DROPPED
 * anything it could not read: a non-object payload, a missing or non-array `messages`, a
 * malformed entry, an unusable message id, an empty status, an unparseable timestamp. Its own
 * comment defended the drop — "a half-understood record is evidence about nothing" — which is
 * true of the RECORD and false of the QUERY.
 *
 * The consequence is the one that matters for `I36`. Suppose a duplicate exists and the
 * provider returns two records, one of which is malformed:
 *
 *     rejected behaviour : drop the malformed one, return one record, count = 1
 *     correct behaviour  : the answer could not be read in full, so the query produced NO
 *                          evidence and the row is UNRESOLVED
 *
 * A count of one is exactly the answer a NON-duplicated send produces. So a malformed second
 * record could silently certify the condition `I36` exists to exclude, and every local
 * assertion would still pass.
 *
 * =================================================================================
 * THE RULE, AND THE ONE DISTINCTION IT TURNS ON
 *
 * **A VALID ZERO IS NOT A MALFORMED ANYTHING.** A valid zero is: the provider answered
 * successfully, the top-level object was present, `messages` was a real array, and that array
 * legitimately held no entries. That is evidence, and `I36`s zero-expectation rows read it.
 *
 * Everything else — a non-object body, `messages` absent or not an array, or ANY entry in the
 * returned set that cannot be normalised — makes the WHOLE QUERY non-evidence. Not a shorter
 * list. Not a smaller count.
 *
 * =================================================================================
 * WHICH FIELDS ARE REQUIRED, AND WHY `categories` IS NOT AMONG THEM
 *
 * `§2.2` of the second review: "Optional provider fields may remain optional only where
 * architecture actually treats them as optional. Do not require a correlation tag to exist
 * merely for I8; an honestly returned record with no correlation tag remains an unaccounted
 * record."
 *
 * So the REQUIRED fields are the three a `ProviderEvidenceRecord` cannot be built without —
 * `msg_id`, `status`, `last_event_time` — and a record missing or mangling any of them makes
 * the query unreadable. `categories` is OPTIONAL: a record that carries none is a record the
 * provider honestly returned with no tag, and `correlationTag: null` is the preserved answer
 * that `I8`s inverse sweep reads as UNACCOUNTED. Requiring it would have turned every
 * third-party message in the account into an unreadable query instead of the finding it is.
 *
 * **NO RECIPIENT ADDRESS IS READ.** `ProviderEvidenceRecord` has no member one could occupy
 * (`30 §5.10`), and the reduction does not look at `to_email` at all — so there is no step at
 * which a redactor has to remove it.
 * =================================================================================
 */
export const ACTIVITY_MALFORMATIONS = [
  /** The 2xx body was not a JSON object at all. */
  'PAYLOAD_NOT_AN_OBJECT',
  /** `messages` was absent, or was present and not an array. */
  'MESSAGES_NOT_AN_ARRAY',
  /** An entry in the returned set was not an object. */
  'ENTRY_NOT_AN_OBJECT',
  /** `msg_id` was absent, not a string, or outside the documented grammar. */
  'MESSAGE_ID_INVALID',
  /** `status` was absent, not a string, empty, or implausibly long. */
  'STATUS_INVALID',
  /** `last_event_time` was absent, not a string, or not a parseable instant. */
  'TIMESTAMP_INVALID',
] as const;

export type ActivityMalformation = (typeof ACTIVITY_MALFORMATIONS)[number];

/**
 * What ONE normalisation produced. A closed pair, and only `VALID` is evidence.
 *
 * `VALID` carries the COMPLETE normalised set for the answer it was given — every entry the
 * provider returned, normalised, with none dropped. If even one could not be read the result
 * is `MALFORMED` and there is no record list to mistake for a short one.
 */
export type ActivityNormalisation =
  | { readonly kind: 'VALID'; readonly records: readonly SendGridActivityRecord[] }
  | {
      readonly kind: 'MALFORMED';
      readonly reason: ActivityMalformation;
      /** How many entries had been read before the defect. Diagnostic; never a count. */
      readonly entriesReadBeforeDefect: number;
    };

/**
 * Reduce the provider JSON to the facts a `ProviderEvidenceRecord` can carry, or declare the
 * answer unreadable. PURE and TOTAL over its argument.
 *
 * **IT FAILS THE WHOLE QUERY ON THE FIRST UNREADABLE ENTRY.** That is the point of defect 2:
 * continuing past one would produce a count smaller than the provider answer and
 * indistinguishable from a genuinely smaller answer.
 */
/**
 * THE TAG THE PROVIDER ITSELF CARRIED, FOR BOTH KINDS OF QUERY.
 *
 * =================================================================================
 * TWO CALLERS, TWO QUESTIONS, AND ONE OF THEM WAS ANSWERED WRONGLY
 *
 * A NARROWED read (`expectedCorrelationTag` is a tag) asks "did the provider accept THIS
 * message?". The answer must never be the matcher writing the value it then compares, so the
 * tag is echoed only when the provider's own `categories` array actually contains it.
 *
 * The INVERSE SWEEP (`expectedCorrelationTag` is `null`) asks the opposite question: "what is
 * in this account that ACOS cannot account for?" — and it supplies no tag, because supplying
 * one would defeat the purpose.
 *
 * **THE REJECTED REDUCTION RETURNED `null` FOR EVERY RECORD IN THAT CASE**, because the
 * `expectedCorrelationTag !== null` conjunct made the whole expression false before
 * `categories` was consulted. `runInverseSweep` reads `correlationTag === null` as
 * UNACCOUNTED, so the sweep reported every message in the account as a control violation —
 * INCLUDING the ones ACOS had just sent and tagged itself. It is a false `I8` VIOLATED on any
 * account the harness has ever written to, and it was invisible for as long as nothing could
 * call the sweep.
 *
 * So with no expected tag the record reports the ACOS correlation tag the provider actually
 * carried. `isCorrelationTag` is the KERNEL'S OWN recogniser, so this selects a tag ACOS
 * minted rather than any string an account happens to categorise by; a record carrying none
 * still reports `null`, and `I8` still reads that as unaccounted, which is the finding the
 * sweep exists to make.
 *
 * A record carrying TWO ACOS tags reports `null` as well: it is not attributable to one
 * correlation, and an ambiguous attribution is exactly the thing a reviewer must see rather
 * than have resolved by array order.
 */
function echoedCorrelationTag(
  categories: unknown,
  expectedCorrelationTag: string | null,
): string | null {
  if (!Array.isArray(categories)) return null;
  if (expectedCorrelationTag !== null) {
    return categories.some((value) => value === expectedCorrelationTag)
      ? expectedCorrelationTag
      : null;
  }
  const acosTags = [
    ...new Set(
      categories.filter(
        (value): value is string => typeof value === 'string' && isCorrelationTag(value),
      ),
    ),
  ];
  return acosTags.length === 1 ? acosTags[0]! : null;
}

export function normaliseActivityRecords(
  payload: unknown,
  expectedCorrelationTag: string | null,
): ActivityNormalisation {
  const malformed = (
    reason: ActivityMalformation,
    entriesReadBeforeDefect: number,
  ): ActivityNormalisation =>
    Object.freeze({ kind: 'MALFORMED' as const, reason, entriesReadBeforeDefect });

  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return malformed('PAYLOAD_NOT_AN_OBJECT', 0);
  }
  const messages = (payload as { messages?: unknown }).messages;
  if (!Array.isArray(messages)) return malformed('MESSAGES_NOT_AN_ARRAY', 0);

  const out: SendGridActivityRecord[] = [];
  for (const entry of messages) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      return malformed('ENTRY_NOT_AN_OBJECT', out.length);
    }
    const record = entry as Record<string, unknown>;
    const id = record.msg_id;
    const status = record.status;
    const at = record.last_event_time;
    if (typeof id !== 'string' || !isUsableProviderMessageId(id)) {
      return malformed('MESSAGE_ID_INVALID', out.length);
    }
    if (typeof status !== 'string' || status.length === 0 || status.length > 64) {
      return malformed('STATUS_INVALID', out.length);
    }
    if (typeof at !== 'string') return malformed('TIMESTAMP_INVALID', out.length);
    const timestampMs = Date.parse(at);
    if (!Number.isFinite(timestampMs)) return malformed('TIMESTAMP_INVALID', out.length);

    /*
     * THE TAG IS ECHOED ONLY WHEN THE PROVIDER ACTUALLY RETURNED IT.
     *
     * A reduction that copied the REQUESTED tag onto every record would make the observation
     * loop correlation self-fulfilling: every record would match because the matcher wrote
     * the value it then compared. So the tag comes from the provider own `categories` array,
     * and `null` — "the provider carried none" — is a distinct and preserved answer, and an
     * OPTIONAL one. See this block header on why `categories` is not required.
     */
    const categories = record.categories;
    const echoed = echoedCorrelationTag(categories, expectedCorrelationTag);

    out.push(
      Object.freeze({
        providerMessageId: id,
        providerStatus: status,
        providerTimestampMs: timestampMs,
        correlationTag: echoed,
      }),
    );
  }
  return Object.freeze({ kind: 'VALID' as const, records: Object.freeze(out) });
}


/**
 * Translate one client response into the closed audit result taxonomy. PURE, and TOTAL over
 * the client's four members.
 *
 * =================================================================================
 * CORRECTION 9 — **ONLY A SUCCESSFUL, PARSED ANSWER MAY BECOME `EVIDENCE`.**
 *
 * The rejected version of this function turned EVERY answered response into `EVIDENCE` with
 * `recordCount: response.records.length`, and every failed query therefore reported ZERO
 * RECORDS. Its own comment defended this as "an HONEST EMPTY". It is not: a 403 says the
 * credential may not ask the question, and answering "there were none" is a claim about the
 * account that no read supports.
 *
 * The consequence was not cosmetic. `I36`'s oracle is a PROVIDER-SIDE ACCEPTED COUNT, and a
 * row whose count is zero because the read was refused looks exactly like a row whose count
 * is zero because nothing was sent — which is the discrimination the whole slice exists to
 * make. `tests/negative-controls/sendgrid-controls.test.ts` CONTROL 10 runs the two side by
 * side: provider returns 403; the unsafe reader produces a count of 0; this one produces no
 * provider count at all, so the row is UNRESOLVED and `I36`/`I20` cannot pass on it.
 *
 * `PROVIDER_UNAVAILABLE` is the NARROWEST EXISTING non-evidence member of the ACCEPTED wire
 * taxonomy, and `auditProviderReader.ts` documents it as exactly this pair of cases: "The
 * provider was reached and refused, or was not reached at all." `§9` permits the narrowest
 * existing member and prefers it to a protocol extension, so no member is added.
 *
 * **THE SCOPE FINDING IS NOT LOST.** `§9`'s own exception: "The separate scope-probe path may
 * preserve the raw HTTP status because that path exists specifically to evaluate permission
 * refusal." `probeActivityReadCapability` reads the status from its own client and reports
 * `CAPABILITY_REFUSED_BY_PROVIDER`; this taxonomy never had anywhere to put a status, and
 * inventing a record count to carry one was the defect rather than the workaround.
 * =================================================================================
 */
export function toProviderReadResult(
  response: SendGridReadResponse,
  operation: ProviderReadQuery['operation'],
): ProviderReadResult {
  // THE THREE NON-EVIDENCE MEMBERS, TOGETHER. A refused query, an unreadable body and an
  // unreached provider differ in what they say about the NETWORK and the CREDENTIAL; they
  // agree exactly in what they say about the messages, which is nothing.
  if (
    response.kind === 'NOT_REACHED' ||
    response.kind === 'REFUSED_BY_PROVIDER' ||
    response.kind === 'UNREADABLE_RESPONSE'
  ) {
    return { kind: 'PROVIDER_UNAVAILABLE' };
  }

  if (operation === 'MESSAGE_ACTIVITY_COUNT') {
    return { kind: 'EVIDENCE', records: Object.freeze([]), recordCount: response.records.length };
  }
  return {
    kind: 'EVIDENCE',
    records: response.records.map((record) =>
      Object.freeze({
        providerMessageId: record.providerMessageId,
        providerStatus: record.providerStatus,
        providerTimestampMs: record.providerTimestampMs,
        correlationTag: record.correlationTag,
      }),
    ),
    recordCount: response.records.length,
  };
}

