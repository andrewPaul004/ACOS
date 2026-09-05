import { CanonicalisationDenied, type DenyCode } from '../canonicalisation/errors.js';

/**
 * The worker-facing denial projection — `26 §7`'s coarse category, and nothing else.
 *
 * `26 §7`, verbatim:
 *
 *   "**Denial detail returned to the model is coarse.** The audit record holds the full
 *    reason; the worker receives a category and no near-miss information. A model that
 *    learns 'denied: amount exceeded by $3' has been handed a probing oracle."
 *
 * `26 §2.0.1`, the denial-detail row, verbatim:
 *
 *   "A single `DENY: SELECTOR` category covers out-of-range, stale and downstream denial,
 *    so cardinality is not recoverable by binary search (CAN-05)."
 *
 * `26 §7`'s v1.2 paragraph names the attack this closes:
 *
 *   "the probing oracle `53 §1` CAN-05 constructed — binary-searching `selector = 2^k`
 *    against `SELECTOR_INVALID` to recover `|options|` in `O(log n)` — is closed twice over:
 *    content-addressed `option_id`s are not searchable by index, and **a single
 *    `DENY: SELECTOR` category no longer distinguishes out-of-range from downstream
 *    denial.**"
 *
 * ---------------------------------------------------------------------------------
 * WHY THIS MODULE EXISTS AT ALL — the carried-forward S1B note
 *
 * S1B's `CanonicalisationDenied` carries `code`, `detail` and `auditNote`, and its own
 * comment says `detail` "is for the audit record and is never rendered to a model by any S1B
 * code path". That was true and it was a property of S1B's call sites rather than of its
 * types: nothing stopped a caller from returning the exception, and `Error.message` embeds
 * both `detail` and `auditNote` by construction.
 *
 * This module makes it structural. `projectDenialToWorker` returns a frozen object with
 * exactly one field, built from `code` alone. There is no path from a
 * `CanonicalisationDenied` to a worker that does not pass through here, and the returned
 * value has no field in which a detail, a note, a message, a count, a nearest valid option,
 * an index range or an "exceeded by $3" could be placed.
 * ---------------------------------------------------------------------------------
 */

/**
 * The categories `26 §7` declares as model-visible.
 *
 * `SELECTOR` is the collapsed one. `MALFORMED` (step B), `UNKNOWN_ACTION` (step C) and
 * `NOT_CANONICALISABLE` (step C2) are each declared separately by the flowchart and are
 * each a statement about the PROPOSAL or about a published control artifact rather than
 * about the option set, so collapsing them would remove information the architecture
 * chose to return without closing any oracle.
 */
export type WorkerFacingDenyCategory =
  | 'SELECTOR'
  | 'MALFORMED'
  | 'UNKNOWN_ACTION'
  | 'NOT_CANONICALISABLE';

/** Exactly one field. There is nowhere to put a detail. */
export interface WorkerFacingDenial {
  readonly deny: WorkerFacingDenyCategory;
}

/**
 * The selector family, collapsed.
 *
 * All four are probe-relevant, and each one distinguished from the others is a bit of
 * information about the live option set:
 *
 *   SELECTOR_MALFORMED           the pair did not parse
 *   SELECTOR_INVALID             the pair does not address a permissible option for this intent
 *   SELECTOR_STALE               the option_id is absent from the live set (I53)
 *   SELECTOR_ENUMERATION_STALE   computed_at exceeds the class's max_age
 *
 * Separating STALE from INVALID would tell a prober whether an `option_id` it constructed
 * ever existed. Separating ENUMERATION_STALE from STALE would let it distinguish "your
 * enumeration aged out" from "the world moved", which is a timing channel onto concurrent
 * activity against the resource. One category.
 */
const SELECTOR_FAMILY: ReadonlySet<DenyCode> = new Set<DenyCode>([
  'SELECTOR_MALFORMED',
  'SELECTOR_INVALID',
  'SELECTOR_STALE',
  'SELECTOR_ENUMERATION_STALE',
]);

/**
 * Project a canonicalisation denial onto the coarse category a worker receives.
 *
 * The returned object is FROZEN and is a different object from the exception in every case,
 * including the ones where no collapsing happens. `tests/canonicalisation/…` asserts that
 * directly: a projection that returned the exception for the non-collapsed codes would ship
 * `message` and `auditNote` to a worker for three of the four categories.
 */
export function projectDenialToWorker(error: CanonicalisationDenied): WorkerFacingDenial {
  if (SELECTOR_FAMILY.has(error.code)) return Object.freeze({ deny: 'SELECTOR' as const });
  switch (error.code) {
    case 'MALFORMED':
      return Object.freeze({ deny: 'MALFORMED' as const });
    case 'UNKNOWN_ACTION':
      return Object.freeze({ deny: 'UNKNOWN_ACTION' as const });
    case 'NOT_CANONICALISABLE':
      return Object.freeze({ deny: 'NOT_CANONICALISABLE' as const });
    default:
      // Unreachable while `DenyCode` is the union above. If a future code is added and this
      // switch is not updated, the SAFE answer is the coarsest category, not a leak and not
      // a crash — a new denial reaching a worker uncategorised is how a probing oracle gets
      // reintroduced by accident.
      return Object.freeze({ deny: 'SELECTOR' as const });
  }
}

/**
 * Run `fn`, and convert a canonicalisation denial into the worker-facing category.
 *
 * The intended shape of every model-facing call site. A caller that uses this cannot
 * accidentally return the exception, because the failure branch never yields one.
 *
 * NOTE the deliberate asymmetry: a non-`CanonicalisationDenied` error is RETHROWN, not
 * projected. Those are internal defects — S1B's cohesion throws, `I18a`/`I18c` violations,
 * a broken connection — and `26 §7`'s coarse-denial rule is about DENIALS. Swallowing an
 * internal defect into `DENY: SELECTOR` would hide a critical incident behind a routine
 * category, which registry `I18a`'s on-violation column forbids in as many words: "Critical
 * incident. The action class is suspended pending investigation."
 */
export async function denialProjected<T>(
  fn: () => Promise<T>,
): Promise<{ ok: true; value: T } | { ok: false; denial: WorkerFacingDenial }> {
  try {
    return { ok: true, value: await fn() };
  } catch (error) {
    if (error instanceof CanonicalisationDenied) {
      return { ok: false, denial: projectDenialToWorker(error) };
    }
    throw error;
  }
}
