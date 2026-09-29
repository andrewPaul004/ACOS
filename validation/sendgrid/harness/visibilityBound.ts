/**
 * `I36` LIVE FINALITY — THE PROVIDER VISIBILITY BOUND. SECOND REVIEW, DEFECT 4.
 *
 * =================================================================================
 * THE DEFECT
 *
 * `MIN_STABILISATION_OBSERVATIONS = 2` is documented in this repository as an **S1P FIXTURE
 * DECISION** (S1P-C4). Two successful polls at the published rate limit is a reasonable
 * deterministic settling rule for an OFFLINE simulated account. It is not a statement about
 * Twilio SendGrid.
 *
 * The rejected design let it be the SOLE condition turning a real provider count into a live
 * `I36` PASS. The second review, verbatim: "That can remain useful for OFFLINE tests. It may
 * NOT be the sole condition that turns a real provider count into a live I36 PASS."
 *
 * The failure it admits is concrete: Email Activity is eventually consistent by an amount
 * nothing in this repository has measured. Two polls spaced ten seconds apart establish only
 * that nothing new appeared in twenty seconds. If the provider's real reporting lag is longer
 * than that — and no accepted source says it is not — a duplicate could surface afterwards and
 * the oracle would already have certified.
 *
 * =================================================================================
 * WHAT A LIVE PASS NOW REQUIRES: **BOTH**, NOT EITHER
 *
 * `§4.3`: "The live final-count rule should effectively require BOTH: required successful
 * samples; AND completion of the evidence-backed provider visibility/completeness interval
 * after the last possible write."
 *
 *   SAMPLES   `MIN_STABILISATION_OBSERVATIONS` further successful observations. Retained as
 *             defence in depth, and no longer load-bearing on its own.
 *   INTERVAL  an EVIDENCE-BACKED bound on how long after a write the provider may still first
 *             report it. **This repository has none for SendGrid.**
 *
 * =================================================================================
 * WHY THERE IS NO NUMBER HERE, AND WHY THAT IS THE CORRECT OUTCOME
 *
 * `§4.1`: "Do NOT invent a number." The three acceptable sources it names are a documented
 * provider reporting-lag guarantee, an empirically measured and owner-accepted non-production
 * bound produced during provider validation, or query semantics establishing completeness for
 * a closed period.
 *
 * The accepted S1O capability record (`tools/provider-selection/capabilityRecord.ts`) documents
 * SendGrid's Email Activity endpoints, its filter fields and its 6-requests-per-minute rate
 * limit. **It documents no reporting-lag guarantee**, no freshness contract, and no
 * closed-period completeness semantics — the same absence that defeats a complete `I8` sweep.
 * No empirical bound exists either, because no run against a real account has ever happened.
 *
 * `§4.1`'s own instruction for exactly this state: "If no sufficient SendGrid bound is
 * currently established: the live count may be observed, but a no-duplicate PASS remains
 * UNRESOLVED. This is acceptable and honest."
 *
 * So `SENDGRID_LIVE_VISIBILITY_BOUND` is `UNESTABLISHED`, and a LIVE row whose verdict depends
 * on no duplicate having appeared is UNRESOLVED — while the count itself is still observed,
 * recorded and compared. An EXCESS is still a FAIL: seeing a second message needs no bound.
 *
 * =================================================================================
 * OFFLINE EVIDENCE IS LABELLED OFFLINE
 *
 * `§4.4`: "offline fixture mode may still use deterministic fixture timing but must be
 * labeled offline evidence." `FIXTURE_VISIBILITY_BOUND` is that mode, it is named for what it
 * is, and `observationModeLabel` puts the distinction into the evidence bundle so a reviewer
 * cannot mistake a deterministic simulation for a provider guarantee.
 * =================================================================================
 */

/** How a run establishes that "no later record appeared" means something. A closed set. */
export const VISIBILITY_BOUND_KINDS = [
  /**
   * A deterministic OFFLINE simulation. The account is a file this process controls, so "no
   * further record" is a fact about the fixture and settles immediately.
   *
   * **NEVER VALID FOR A LIVE RUN**, and `assertLiveUsable` refuses it.
   */
  'FIXTURE_DETERMINISTIC',
  /**
   * An evidence-backed interval, in milliseconds, after the last possible write, during which
   * the provider may still first report a record.
   *
   * Constructing one requires `basis` to name the accepted source. There is no such source for
   * SendGrid today.
   */
  'MEASURED_INTERVAL',
  /**
   * No bound is established for this provider.
   *
   * **THIS IS SENDGRID TODAY.** The count may be observed; a no-duplicate PASS may not.
   */
  'UNESTABLISHED',
] as const;

export type VisibilityBoundKind = (typeof VISIBILITY_BOUND_KINDS)[number];

export type VisibilityBound =
  | { readonly kind: 'FIXTURE_DETERMINISTIC'; readonly label: string }
  | {
      readonly kind: 'MEASURED_INTERVAL';
      /** How long after the LAST POSSIBLE WRITE the interval runs. `§4.2`. */
      readonly intervalMs: number;
      /** The accepted source. `§4.1` forbids an invented number, so this is mandatory. */
      readonly basis: string;
    }
  | { readonly kind: 'UNESTABLISHED'; readonly why: string };

/**
 * **THE SENDGRID ANSWER, AND IT IS A NEGATIVE.** Derived from the accepted S1O research.
 *
 * A future slice that establishes a bound — a documented lag guarantee, or an owner-accepted
 * empirical measurement from a real non-production run — replaces THIS VALUE. Nothing else in
 * the oracle moves.
 */
export const SENDGRID_LIVE_VISIBILITY_BOUND: VisibilityBound = Object.freeze({
  kind: 'UNESTABLISHED' as const,
  why:
    'The accepted S1O SendGrid capability record documents the Email Activity endpoints, ' +
    'eleven filter fields and a 6-requests-per-minute rate limit. It documents NO ' +
    'reporting-lag guarantee, NO freshness contract and NO closed-period completeness ' +
    'semantics, and no empirical non-production measurement exists because no run against a ' +
    'real account has ever happened. Per second-review §4.1, the live count may be observed ' +
    'but a no-duplicate PASS remains UNRESOLVED.',
});

/** The OFFLINE mode. Named for what it is so evidence cannot pass it off as a guarantee. */
export const FIXTURE_VISIBILITY_BOUND: VisibilityBound = Object.freeze({
  kind: 'FIXTURE_DETERMINISTIC' as const,
  label:
    'OFFLINE FIXTURE EVIDENCE. The simulated account is a file this process controls, so the ' +
    'absence of a later record is a determinate property of the fixture rather than a claim ' +
    'about any provider.',
});

/** Whether a bound can carry a LIVE no-duplicate conclusion. */
export function boundSettlesLiveAbsence(bound: VisibilityBound): boolean {
  return bound.kind === 'MEASURED_INTERVAL';
}

/**
 * How long the final observation window must run after the LAST POSSIBLE WRITE.
 *
 * `0` for the fixture mode, where settling is immediate and determinate. For an unestablished
 * bound this is also `0` — not because nothing need elapse, but because no interval is KNOWN;
 * the verdict rule refuses the conclusion instead of guessing at a duration.
 */
export function settlingIntervalMs(bound: VisibilityBound): number {
  return bound.kind === 'MEASURED_INTERVAL' ? bound.intervalMs : 0;
}

/** One sentence naming the observation mode, for the evidence bundle. `§4.4`. */
export function observationModeLabel(bound: VisibilityBound): string {
  switch (bound.kind) {
    case 'FIXTURE_DETERMINISTIC':
      return bound.label;
    case 'MEASURED_INTERVAL':
      return (
        `LIVE PROVIDER EVIDENCE. A visibility interval of ${String(bound.intervalMs)}ms after ` +
        `the last possible write is established by: ${bound.basis}`
      );
    case 'UNESTABLISHED':
      return `LIVE PROVIDER EVIDENCE WITH NO ESTABLISHED VISIBILITY BOUND. ${bound.why}`;
  }
}

/**
 * **A LIVE RUN MAY NEVER BORROW THE FIXTURE'S DETERMINISM.** `§4.4`.
 *
 * The one way defect 4 could reappear is a live composition that injects
 * `FIXTURE_VISIBILITY_BOUND` — the verdict rule would then treat provider silence as settled
 * on the strength of a claim that is only true of a local file. Nothing else can produce that
 * mistake, so it is refused at the single point where a live composition names its bound.
 *
 * `UNESTABLISHED` is deliberately PERMITTED: it is SendGrid's honest state today and it
 * downgrades conclusions rather than faking them.
 */
export function assertLiveUsable(bound: VisibilityBound): VisibilityBound {
  if (bound.kind === 'FIXTURE_DETERMINISTIC') {
    throw new Error(
      'a LIVE provider run was handed the OFFLINE fixture visibility bound; deterministic ' +
        'fixture settling is a property of the simulated account file and says nothing about ' +
        'the provider (second review §4.4)',
    );
  }
  return bound;
}
