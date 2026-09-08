import type { LocalAuthorisationStep } from './localSteps.js';

/**
 * `26 §7`'s denial terminals for the steps AT AND AFTER R, and the internal reasons behind
 * them.
 *
 * The same two-level separation the accepted `errors.ts` established, extended over the
 * local authorisation transaction. `LocalAuthorisationDenyCode` is the CATEGORY a worker
 * may receive; `LocalAuthorisationDenyDetail` is the internal reason and reaches only the
 * audit path.
 *
 * The separation matters more here than anywhere earlier in the sequence, because step R's
 * internal reason IS a headroom figure. `26 §7`:
 *
 *   "A model that learns 'denied: amount exceeded by $3' has been handed a probing
 *    oracle."
 *
 * At step R the oracle would be worse than a near miss: a worker able to distinguish WHICH
 * of several referenced windows lacked headroom could binary-search the whole balance
 * sheet, one denial at a time. So `WINDOW_EXHAUSTED` carries no window id, and the detail
 * enum below has no member that names one either — the determining window is recorded on
 * the internal exception and in the incident, not on the outcome record.
 */

/**
 * The terminals, transcribed from `26 §7`'s flowchart for steps R–W.
 *
 * D13 `WINDOW_EXHAUSTED` is the only DENY terminal `26 §7` places at or after R on the
 * initial path. `DR1 EXPOSURE_EXCEEDS_RESERVATION` and `RESERVATION_ABSENT` are step R′'s,
 * they belong to verify-mode resume, and S1F implements no resume — so they are
 * deliberately absent from this union rather than declared and unreachable.
 */
export type LocalAuthorisationDenyCode = 'WINDOW_EXHAUSTED';

/** The internal reason. AUDIT PATH ONLY. Carries no window id, balance or amount. */
export type LocalAuthorisationDenyDetail =
  /** The four-term commitment guard on `window_balance` refused the new commitment (I3). */
  | 'COMMITMENT_GUARD_REFUSED'
  /**
   * A referenced window has no registry row for this company, so no instance can be
   * derived and no ceiling is known. Fail-closed: an unknown ceiling is not an absent one.
   */
  | 'REFERENCED_WINDOW_NOT_REGISTERED'
  /** The matching grants referenced no window at all. Nothing would bound the effect. */
  | 'NO_REFERENCED_WINDOW';

export class LocalAuthorisationDenied extends Error {
  public readonly step: LocalAuthorisationStep;
  public readonly code: LocalAuthorisationDenyCode;
  public readonly detail: LocalAuthorisationDenyDetail;
  public override readonly cause: unknown;

  public constructor(
    step: LocalAuthorisationStep,
    code: LocalAuthorisationDenyCode,
    detail: LocalAuthorisationDenyDetail,
    note: string,
    cause?: unknown,
  ) {
    super(`DENY: ${code} at step ${step} — ${detail}: ${note}`);
    this.name = 'LocalAuthorisationDenied';
    this.step = step;
    this.code = code;
    this.detail = detail;
    this.cause = cause;
  }
}

export function denyLocal(
  step: LocalAuthorisationStep,
  code: LocalAuthorisationDenyCode,
  detail: LocalAuthorisationDenyDetail,
  note: string,
  cause?: unknown,
): never {
  throw new LocalAuthorisationDenied(step, code, detail, note, cause);
}

/**
 * The SQLSTATEs 0007 raises, as the contract between the migration's trigger bodies and
 * this module. Every one is a DEFECT or an ATTACK, never a denial — which is why none of
 * them is translated into a `LocalAuthorisationDenyCode`.
 *
 * `I3`'s `ACS03` is the single exception and it is owned by the ACCEPTED
 * `src/kernel/exposure/errors.ts` `asDenial`, which S1F calls rather than reimplementing.
 */
export const LOCAL_SQLSTATE = {
  /** `33 §6`'s append-only rule refused an UPDATE or DELETE. */
  APPEND_ONLY_REFUSED: 'ACS33',
  /** `I17d` refused a caller-supplied `prev_hash`/`row_hash`, or a non-contiguous seq. */
  I17D_CALLER_SUPPLIED_CHAIN: 'ACS17',
  /** `30 §5.2`: the journal sequence was not contiguous. */
  JOURNAL_SEQUENCE_NOT_CONTIGUOUS: 'ACS30',
  /** PostgreSQL: unique violation. At step T this is `I42` doing its job. */
  UNIQUE_VIOLATION: '23505',
} as const;

/**
 * TEST-ONLY injection points inside the local authorisation transaction.
 *
 * `36 §2`'s kill-point matrix needs an abort at declared places inside one transaction, and
 * a test cannot reach inside a function to cause one. The points below are the production
 * sequence's own boundaries, named; the production call passes no hook and the hook
 * receives no authority value and returns nothing that is read.
 *
 * They are declared in `src/` rather than in `tests/` for the same reason `Clock` is: a
 * fixture that named its own points could drift from the sequence, and then the matrix
 * would be asserting against places the code no longer has.
 */
export const LOCAL_COMMIT_POINTS = [
  'AFTER_ISOLATION_ASSERTED',
  'AFTER_FIRST_WINDOW_LOCK',
  'AFTER_ALL_WINDOW_LOCKS',
  'AFTER_AUTHORISATION_ROW',
  'AFTER_RESERVATION_ROW',
  'AFTER_STANDING_ROWS',
  'AFTER_EFFECT_ROW',
  'AFTER_APPROVAL_ROW',
  'AFTER_DECISION_ROW',
  'AFTER_JOURNAL_SEQ_ALLOCATED',
  'AFTER_JOURNAL_ROW',
] as const;

export type LocalCommitPoint = (typeof LOCAL_COMMIT_POINTS)[number];

/** The error a kill-point hook throws. Never produced by production code. */
export class InjectedCommitAbort extends Error {
  public readonly point: LocalCommitPoint;

  public constructor(point: LocalCommitPoint) {
    super(`injected abort at ${point}`);
    this.name = 'InjectedCommitAbort';
    this.point = point;
  }
}
