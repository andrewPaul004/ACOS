/**
 * `I8` COMPLETENESS — WHAT THIS REPOSITORY CAN AND CANNOT ESTABLISH ABOUT A SENDGRID EMAIL
 * ACTIVITY RESULT SET. SECOND REVIEW, DEFECT 3.
 *
 * =================================================================================
 * THE DEFECT
 *
 * `runInverseSweep` issued ONE request carrying `maxRecords`, looked at what came back, and
 * could return `ALL_PROVIDER_RECORDS_ACCOUNTED` — a statement about the WHOLE period — from a
 * result set the provider may have truncated. `I8` is "no external effect exists in any vendor
 * system that ACOS did not journal"; a capped query cannot establish it, because the record
 * the sweep exists to find may be the one past the cap.
 *
 * =================================================================================
 * WHAT THE REPOSITORY ACTUALLY RECORDS — READ BEFORE ANYTHING WAS WRITTEN
 *
 * `§3.1`: "Read the accepted S1O SendGrid capability research already in the repository.
 * Determine what the Email Activity endpoint actually exposes for: pagination,
 * continuation/cursor, total results, next page, maximum page size, query completeness. Do
 * not invent an API shape."
 *
 * `tools/provider-selection/capabilityRecord.ts`, SendGrid's `activityQuery` record, in full:
 *
 *     endpoints    GET /v3/messages, GET /v3/messages/{msg_id}
 *     filterFields msg_id, from_email, to_email, subject, status, template_id, categories,
 *                  unique_args, events, last_event_time, api_key_id
 *     rateLimit    6 requests per minute; HTTP 429 above it
 *
 * **THAT IS THE WHOLE RECORD, AND IT CONTAINS NO COMPLETENESS MECHANISM.** No cursor, no
 * continuation token, no `next` link, no total count, no page-size contract, and no statement
 * that a result set is complete for its period. The one "entries per page" figure anywhere in
 * that file — "up to 300 entries per page" — belongs to **MAILGUN's** Events endpoint, in
 * Mailgun's own capability block, and is not a SendGrid fact.
 *
 * No external documentation was consulted, because `§3.1` permits that only where repository
 * evidence is insufficient AND the project rules allow it — and here the repository evidence
 * is not insufficient, it is decisive in the negative direction: nothing in the accepted S1O
 * research establishes a usable completeness signal for this endpoint.
 *
 * =================================================================================
 * THE CONSEQUENCE, WHICH IS `§3.2`'s SECOND BRANCH
 *
 * `§3.2`: "If the provider does NOT expose a usable completeness mechanism: do NOT manufacture
 * one [...] a capped clean result cannot establish `ALL_PROVIDER_RECORDS_ACCOUNTED`; return an
 * explicit `SWEEP_INCOMPLETE` / UNRESOLVED outcome instead."
 *
 * So `SENDGRID_ACTIVITY_COMPLETENESS` below is `UNESTABLISHED`, and a live SendGrid inverse
 * sweep can:
 *
 *   * REPORT AN UNACCOUNTED RECORD it actually observed — a positive finding needs no
 *     completeness guarantee, and it is the finding `I8` most needs to surface; and
 *   * NEVER report `ALL_PROVIDER_RECORDS_ACCOUNTED`. A clean capped read returns
 *     `SWEEP_INCOMPLETE`, which is a narrow explicit statement rather than a false clean bill.
 *
 * **`SWEEP_INCOMPLETE` IS DELIBERATELY NOT `SWEEP_UNAVAILABLE`.** `§3.2`: "Do not map
 * truncation onto `SWEEP_UNAVAILABLE` unless that is genuinely the narrowest existing truthful
 * state." It is not: the provider ANSWERED, and what is missing is the guarantee that the
 * answer was the whole of it. Collapsing the two would lose the distinction between an outage
 * and a truncation, which are different operator problems.
 *
 * =================================================================================
 * THE PAGINATION MACHINERY EXISTS ANYWAY, AND THAT IS NOT A CONTRADICTION
 *
 * `§3.2`'s FIRST branch describes what to do for a provider that DOES paginate deterministically:
 * keep the paging inside the audit reader, fixed endpoint, no caller-supplied cursor, bounded
 * pages, continue until the provider's own semantics say there is no further page.
 *
 * That machinery is implemented — `runInverseSweep` walks pages through a port and stops on the
 * provider's own signal — and it is exercised offline by doubles that DO supply one. What
 * SendGrid supplies is `UNESTABLISHED`, so the live path takes the honest branch. When a
 * completeness mechanism is established for this provider, the change is this constant and the
 * reader that produces the signal; the sweep does not move.
 * =================================================================================
 */

/**
 * What a provider's result set can say about its own completeness.
 *
 * A CLOSED set. Each member is a statement the AUDIT READER makes about the answer it just
 * received, never one the control plane supplies and never one the sweep assumes.
 */
export const PAGE_COMPLETENESS_SIGNALS = [
  /**
   * The provider's own semantics establish that no further page exists for this query.
   *
   * The ONLY signal that permits `ALL_PROVIDER_RECORDS_ACCOUNTED`.
   */
  'COMPLETE',
  /** The provider's own semantics establish that at least one further page exists. */
  'MORE_AVAILABLE',
  /**
   * The provider offers no mechanism by which completeness could be established.
   *
   * **THIS IS SENDGRID TODAY.** The answer may be the whole result set or a truncation, and
   * nothing in the response distinguishes them.
   */
  'UNESTABLISHED',
] as const;

export type PageCompletenessSignal = (typeof PAGE_COMPLETENESS_SIGNALS)[number];

/**
 * ONE page of an inverse-sweep read: the records, and what the provider said about whether
 * there are more.
 *
 * The cursor is DELIBERATELY OPAQUE and is produced by the reader, never by a caller. `§3.2`:
 * "no arbitrary cursor/URL from control". `runInverseSweep` passes back whatever the previous
 * page handed it and cannot construct one.
 */
export interface ActivityPage {
  readonly records: readonly {
    readonly providerMessageId: string;
    readonly providerStatus: string;
    readonly providerTimestampMs: number;
    readonly correlationTag: string | null;
  }[];
  readonly completeness: PageCompletenessSignal;
  /** The reader's own continuation handle, or `null` when there is nothing to continue with. */
  readonly nextCursor: string | null;
}

/**
 * **THE SENDGRID ANSWER, AND IT IS A NEGATIVE.**
 *
 * Derived from the accepted S1O capability record and from nothing else. See this module's
 * header for the full quotation of what that record contains and what it does not.
 *
 * A future slice that establishes a completeness mechanism — a documented cursor, a documented
 * total, or query semantics that close a period — changes THIS CONSTANT and the reader that
 * produces the signal. Nothing else in the sweep moves.
 */
export const SENDGRID_ACTIVITY_COMPLETENESS: PageCompletenessSignal = 'UNESTABLISHED';

/**
 * Why the accepted S1O research supports the constant above. Carried as evidence so a reviewer
 * does not have to take the constant's word for it, and asserted by
 * `tests/sendgrid/inverse-sweep.test.ts` against the capability record itself.
 */
export const SENDGRID_COMPLETENESS_BASIS =
  'The accepted S1O SendGrid capability record (tools/provider-selection/capabilityRecord.ts, ' +
  'activityQuery) documents the two Email Activity endpoints, eleven filter fields and a ' +
  '6-requests-per-minute rate limit. It records NO cursor, NO continuation token, NO next-page ' +
  'link, NO total-results count, NO maximum page size and NO statement that a result set is ' +
  'complete for its period. The "up to 300 entries per page" figure in that file belongs to ' +
  "Mailgun's Events endpoint, not SendGrid's. No usable completeness mechanism is therefore " +
  'established for this provider, and I8 may not claim a complete sweep over a capped result.';
