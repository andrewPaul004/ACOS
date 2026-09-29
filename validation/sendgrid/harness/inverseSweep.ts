import type { ActivityPage, PageCompletenessSignal } from '../audit/activityCompleteness.js';

/**
 * `I8` — THE INVERSE SWEEP, FOR THIS PROVIDER. `§15` OF THE FIRST CORRECTION MANDATE AND
 * `§3` OF THE SECOND.
 *
 * =================================================================================
 * THE AUTHORITATIVE DEFINITION, LOCATED AND QUOTED RATHER THAN INFERRED
 *
 * `24 §3` K11's invariant block, verbatim:
 *
 *     "**No external effect exists in any vendor system that ACOS did not journal, evaluated
 *      from the audit plane's own reads (I8).**"
 *
 * and `25`'s v1.1 note on where it runs: "The sweep runs in the **audit plane**, from that
 * plane's own read-only vendor credentials, and files findings the control plane cannot see,
 * edit or delete (I8)."
 *
 * =================================================================================
 * WHY `observeCorrelation` IS NOT THIS
 *
 * `observeCorrelation` asks: *did the provider accept the message ACOS believes it sent?* It
 * narrows by a tag ACOS minted, so it can only find what ACOS already knew to look for. `I8`
 * asks the OPPOSITE — *does the provider hold anything ACOS did not account for?* — and a
 * tag-narrowed read cannot answer it, because the records it must find are precisely the ones
 * carrying no tag ACOS would have supplied.
 *
 * So this sweep reads with **no correlation tag**, PERIOD-BOUNDED, which `48`'s v1.3 note
 * requires and which `independentFinding.ts` already relies on: "reachable only because the
 * read was period-bounded rather than tag-bounded."
 *
 * =================================================================================
 * SECOND REVIEW, DEFECT 3 — **A CAPPED CLEAN READ IS NOT A COMPLETE SWEEP**
 *
 * The rejected version issued ONE request carrying `maxRecords` and could answer
 * `ALL_PROVIDER_RECORDS_ACCOUNTED` from it. That is a statement about the whole period made
 * from a result set the provider may have truncated — and the record `I8` exists to find may
 * be exactly the one past the cap.
 *
 * The sweep now WALKS PAGES, and the walk is governed by the PROVIDER's own signal rather than
 * by the sweep's optimism:
 *
 *   `MORE_AVAILABLE`  continue, if the page and record bounds allow;
 *   `COMPLETE`        the provider's semantics establish there is no further page. **THE ONLY
 *                     SIGNAL THAT PERMITS A CLEAN VERDICT.**
 *   `UNESTABLISHED`   the provider offers no mechanism by which completeness could be
 *                     established. The walk stops and the verdict is `SWEEP_INCOMPLETE`.
 *
 * **SENDGRID IS `UNESTABLISHED` TODAY** — see `activityCompleteness.ts`, which quotes the
 * accepted S1O capability record in full and shows it contains no cursor, no total, no
 * next-page link and no page-size contract. So a live SendGrid sweep can report an unaccounted
 * record it actually SAW, and can never report a clean one.
 *
 * `SWEEP_INCOMPLETE` is deliberately NOT `SWEEP_UNAVAILABLE`: the provider answered, and what
 * is missing is the guarantee that the answer was the whole of it. `§3.2` forbids collapsing
 * truncation onto unavailability unless that is genuinely the narrowest truthful state, and
 * here it is not — an outage and a truncation are different operator problems.
 *
 * =================================================================================
 * A POSITIVE FINDING NEEDS NO COMPLETENESS GUARANTEE
 *
 * The asymmetry is the point and it is preserved: seeing a record ACOS cannot account for
 * PROVES one exists, whatever else the provider was holding. Not seeing one proves nothing
 * unless the sweep can say it looked at everything. So `UNACCOUNTED_PROVIDER_RECORDS` is
 * reachable under every completeness signal, and `ALL_PROVIDER_RECORDS_ACCOUNTED` under
 * exactly one.
 *
 * **THIS IS MACHINERY, NOT EVIDENCE.** Nothing in this repository has run it against a real
 * account, and `docs/implementation/S1P-result.md` records `I8` as unchanged.
 * =================================================================================
 */

/** One provider record the sweep could not account for. Evidence, never a verdict. */
export interface UnaccountedRecord {
  readonly providerMessageId: string;
  /** The tag the PROVIDER echoed, or `null` where it carried none. */
  readonly correlationTag: string | null;
  /** The provider's own status word, verbatim and unmapped (`30 §5.7`). */
  readonly providerStatus: string;
}

export const INVERSE_SWEEP_OUTCOMES = [
  /**
   * Every record the provider held in this period was accounted for, AND the provider's own
   * semantics established that the sweep saw them all.
   *
   * **UNREACHABLE FOR SENDGRID TODAY**, because its completeness signal is `UNESTABLISHED`.
   */
  'ALL_PROVIDER_RECORDS_ACCOUNTED',
  /**
   * The provider held at least one record ACOS did not account for.
   *
   * Reachable under EVERY completeness signal: a record seen is a record that exists.
   */
  'UNACCOUNTED_PROVIDER_RECORDS',
  /**
   * The provider answered, nothing unaccounted was seen, and completeness was NOT established
   * — because the provider offers no mechanism, or because a bound was reached first.
   *
   * **NOT a clean sweep and NOT an outage.** `§3.2`'s explicit incompleteness result.
   */
  'SWEEP_INCOMPLETE',
  /** The read did not produce evidence at all. **NOT agreement**, and never reported as one. */
  'SWEEP_UNAVAILABLE',
] as const;

export type InverseSweepOutcome = (typeof INVERSE_SWEEP_OUTCOMES)[number];

/** Why a sweep stopped walking. Carried into evidence so a reviewer can check the bound. */
export const SWEEP_STOP_REASONS = [
  'PROVIDER_SIGNALLED_COMPLETE',
  'PROVIDER_COMPLETENESS_UNESTABLISHED',
  'PAGE_BOUND_REACHED',
  'RECORD_BOUND_REACHED',
  'PROVIDER_UNAVAILABLE',
] as const;

export type SweepStopReason = (typeof SWEEP_STOP_REASONS)[number];

export interface InverseSweepResult {
  readonly outcome: InverseSweepOutcome;
  /** How many records the sweep actually examined. `null` when no page was readable. */
  readonly providerRecordsExamined: number | null;
  /** How many pages were read. Evidence about the walk, not about the account. */
  readonly pagesRead: number;
  readonly stoppedBecause: SweepStopReason;
  /** The records ACOS could not account for. Empty on a clean or incomplete-clean sweep. */
  readonly unaccounted: readonly UnaccountedRecord[];
  /** One sentence a reviewer can check the outcome against. */
  readonly statement: string;
}

/**
 * ONE page read, through the INDEPENDENT audit reader.
 *
 * The cursor is the READER's own opaque handle, passed back verbatim from the previous page.
 * `§3.2`: "no arbitrary cursor/URL from control." This sweep cannot construct one — it has
 * only what a page gave it — and the endpoint stays fixed inside the reader.
 */
export type ActivityPageReader = (input: {
  readonly periodStartMs: number;
  readonly periodEndMs: number;
  readonly maxRecords: number;
  readonly cursor: string | null;
}) => Promise<ActivityPage | { readonly kind: 'PROVIDER_UNAVAILABLE' }>;

/** Bounds on the walk. A bound is a bound; exhausting one is an INCOMPLETE, never a clean. */
export interface SweepBound {
  readonly periodStartMs: number;
  readonly periodEndMs: number;
  /** Records requested per page. */
  readonly maxRecordsPerPage: number;
  /** Hard ceiling on pages, so a mis-behaving provider cannot become an unbounded loop. */
  readonly maxPages: number;
  /** Hard ceiling on total records examined. */
  readonly maxTotalRecords: number;
}

/** The declared ceilings. A configured bound is clamped into them. */
export const MAX_SWEEP_PAGES = 20;
export const MAX_SWEEP_RECORDS = 5_000;

export function clampSweepBound(bound: SweepBound): SweepBound {
  return Object.freeze({
    ...bound,
    maxPages: Math.max(1, Math.min(bound.maxPages, MAX_SWEEP_PAGES)),
    maxTotalRecords: Math.max(1, Math.min(bound.maxTotalRecords, MAX_SWEEP_RECORDS)),
  });
}

/**
 * Walk the provider's period-bounded result set and decide what `I8` may conclude.
 *
 * `accountedCorrelationTags` is the set of tags the AUDIT PLANE's own state accounts for.
 * `30 §5.4`'s discipline applies to it exactly as it does to `AuditExpectation`: it is
 * something the audit plane knows from its own mirrored rows, and it is NOT a control-plane
 * verdict about what was sent.
 */
export async function runInverseSweep(
  readPage: ActivityPageReader,
  input: SweepBound & { readonly accountedCorrelationTags: ReadonlySet<string> },
): Promise<InverseSweepResult> {
  const bound = clampSweepBound(input);
  const unaccounted: UnaccountedRecord[] = [];
  let examined = 0;
  let pagesRead = 0;
  let cursor: string | null = null;
  let stoppedBecause: SweepStopReason = 'PAGE_BOUND_REACHED';
  let completeness: PageCompletenessSignal = 'UNESTABLISHED';
  let anyPageRead = false;

  for (let page = 0; page < bound.maxPages; page += 1) {
    const result: ActivityPage | { readonly kind: 'PROVIDER_UNAVAILABLE' } = await readPage({
      periodStartMs: bound.periodStartMs,
      periodEndMs: bound.periodEndMs,
      maxRecords: bound.maxRecordsPerPage,
      cursor,
    });

    if ('kind' in result) {
      /*
       * THE PROVIDER STOPPED ANSWERING MID-WALK.
       *
       * If an unaccounted record was ALREADY SEEN, the finding stands — it is a positive
       * observation and no completeness guarantee was needed for it. Otherwise the sweep has
       * neither a finding nor a guarantee, and `§3.3` requires that this never be a clean
       * result.
       */
      stoppedBecause = 'PROVIDER_UNAVAILABLE';
      completeness = 'UNESTABLISHED';
      if (!anyPageRead) {
        return Object.freeze({
          outcome: 'SWEEP_UNAVAILABLE' as const,
          providerRecordsExamined: null,
          pagesRead,
          stoppedBecause,
          unaccounted: Object.freeze([]),
          statement:
            'the inverse sweep obtained no evidence: the provider was not reached, refused ' +
            'the query, or answered unreadably. SILENCE IS NOT AGREEMENT and no I8 ' +
            'conclusion is drawn',
        });
      }
      break;
    }

    anyPageRead = true;
    pagesRead += 1;
    examined += result.records.length;
    completeness = result.completeness;

    for (const record of result.records) {
      // A record with NO echoed tag is unaccounted: a message ACOS sent carries the tag the
      // adapter put on `categories`, so an untagged record in this window is not ACOS's.
      const accounted =
        record.correlationTag !== null &&
        input.accountedCorrelationTags.has(record.correlationTag);
      if (!accounted) {
        unaccounted.push(
          Object.freeze({
            providerMessageId: record.providerMessageId,
            correlationTag: record.correlationTag,
            providerStatus: record.providerStatus,
          }),
        );
      }
    }

    if (result.completeness === 'COMPLETE') {
      stoppedBecause = 'PROVIDER_SIGNALLED_COMPLETE';
      break;
    }
    if (result.completeness === 'UNESTABLISHED') {
      /*
       * **THE SENDGRID BRANCH.** The provider said nothing about whether more exists, so the
       * walk cannot continue meaningfully and cannot conclude cleanly. Stopping here rather
       * than requesting a second page is deliberate: without a continuation signal a second
       * request is a second arbitrary window, not a next page.
       */
      stoppedBecause = 'PROVIDER_COMPLETENESS_UNESTABLISHED';
      break;
    }
    if (examined >= bound.maxTotalRecords) {
      stoppedBecause = 'RECORD_BOUND_REACHED';
      break;
    }
    if (result.nextCursor === null) {
      /*
       * The provider said MORE_AVAILABLE and handed back no way to ask for it. That is a
       * provider contradiction, and the safe reading is incompleteness rather than a clean
       * result.
       */
      stoppedBecause = 'PROVIDER_COMPLETENESS_UNESTABLISHED';
      break;
    }
    cursor = result.nextCursor;
  }

  if (unaccounted.length > 0) {
    return Object.freeze({
      outcome: 'UNACCOUNTED_PROVIDER_RECORDS' as const,
      providerRecordsExamined: examined,
      pagesRead,
      stoppedBecause,
      unaccounted: Object.freeze([...unaccounted]),
      statement:
        `the provider holds ${String(unaccounted.length)} record(s) in this period that ACOS ` +
        'did not account for. A record SEEN needs no completeness guarantee, so this finding ' +
        'stands whatever the sweep could establish about the rest. I8 names the three ' +
        'readings and all three are incidents: a bug, a second uncontrolled actor, or a ' +
        'compromise',
    });
  }

  if (stoppedBecause === 'PROVIDER_SIGNALLED_COMPLETE' && completeness === 'COMPLETE') {
    return Object.freeze({
      outcome: 'ALL_PROVIDER_RECORDS_ACCOUNTED' as const,
      providerRecordsExamined: examined,
      pagesRead,
      stoppedBecause,
      unaccounted: Object.freeze([]),
      statement:
        `the provider answered across ${String(pagesRead)} page(s), its own semantics ` +
        `established that no further page exists, and every one of ${String(examined)} ` +
        'record(s) in this period carried a correlation the audit plane accounts for',
    });
  }

  return Object.freeze({
    outcome: 'SWEEP_INCOMPLETE' as const,
    providerRecordsExamined: examined,
    pagesRead,
    stoppedBecause,
    unaccounted: Object.freeze([]),
    statement:
      `nothing unaccounted was seen across ${String(examined)} record(s) in ` +
      `${String(pagesRead)} page(s), but the sweep could NOT establish that it examined the ` +
      `complete result set for this period (stopped: ${stoppedBecause}). A capped or ` +
      'unguaranteed clean read is NOT a clean sweep, and I8 is not evaluated on it',
  });
}
