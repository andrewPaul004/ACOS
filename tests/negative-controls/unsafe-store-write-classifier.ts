import type { StoreWriteClass } from '../../src/audit/storeWriteAvailability.js';
import type { AuditIngestOutcome } from '../../src/audit/transport/journalRecord.js';

/**
 * THE TWO MANDATORY VULNERABLE CONTROLS FOR `30 §5.7.1a`.
 *
 * =================================================================================
 * `§8` of the owner-resolution mandate, verbatim:
 *
 *   "A. quota saturation — Unsafe implementation treats audit quota exhaustion as
 *    `STORE_WRITE_REJECTED`. Unsafe: can eventually corroborate degraded mode. Production:
 *    incident only; no mode-relaxing signal. Must discriminate.
 *
 *    B. sequence collision — Unsafe implementation maps a conflicting existing sequence to
 *    store rejection. Production: security-critical collision; no mode-relaxing signal.
 *
 *    C. malformed/canonical mismatch — Unsafe generic 'INSERT failed → store rejected'
 *    implementation produces corroboration. Production: integrity incident; no
 *    corroboration.
 *
 *    D. unknown SQL/database error — Unsafe generic database-error mapper emits
 *    `STORE_WRITE_REJECTED`. Production: UNKNOWN / fail closed; no relaxed state."
 * =================================================================================
 *
 * Two functions, because A-D are two distinct defects wearing four hats:
 *
 *   `unsafeOutcomeMapper`      — the OUTCOME-side defect. Any non-`ACCEPTED` outcome is
 *                                treated as a store-write availability failure. Covers A
 *                                (quota), B (collision) and C (canonical mismatch), because
 *                                `A0001` returns all three as OUTCOMES rather than throwing.
 *   `unsafeErrorMapper`        — the EXCEPTION-side defect. Any thrown database error is
 *                                treated as one. Covers C's raw-`INSERT` variant and D.
 *
 * NEITHER IS A STRAW MAN. Both are the obvious implementation: "the row did not go in, so
 * the store rejected the write" is a true sentence about every one of these cases, and it is
 * exactly the reading `§5.7.1a` had to exclude normatively. The whole content of the
 * derivation is that the sentence is true and the CONCLUSION does not follow.
 *
 * NOT IMPORTED BY `src/`. `no-dispatch-boundary.test.ts` asserts that no file under `src/`
 * imports anything from `tests/`.
 */

/**
 * `§8` A, B and C: every outcome that is not an acceptance becomes the availability class.
 *
 * The comment a developer would have written above it: "if the audit store did not take the
 * row, its write path is not available." Which is why the exclusion list in `§5.7.1a` is
 * NORMATIVE rather than advisory.
 */
export function unsafeOutcomeMapper(outcome: AuditIngestOutcome): StoreWriteClass {
  return outcome === 'ACCEPTED' || outcome === 'AUDIT_PUSH_DUPLICATE'
    ? 'UNKNOWN'
    : 'AUDIT_STORE_WRITE_UNAVAILABLE';
}

/**
 * `§8` C and D: any thrown database error becomes the availability class.
 *
 * The generic mapper. It does not look at the SQLSTATE at all, which is precisely the
 * "giant vendor-specific list" problem inverted: no list, so everything qualifies.
 */
export function unsafeErrorMapper(error: unknown): StoreWriteClass {
  return error === null || error === undefined ? 'UNKNOWN' : 'AUDIT_STORE_WRITE_UNAVAILABLE';
}

/**
 * A third variant, kept because `§8` D says "unknown SQL/database error" specifically: a
 * mapper that DOES read the SQLSTATE and then admits every error class rather than a closed
 * set. This is the "fail-open on unknown" defect, distinct from having no list at all.
 */
export function unsafeOpenEndedSqlstateMapper(error: unknown): StoreWriteClass {
  if (typeof error !== 'object' || error === null) return 'UNKNOWN';
  const code = (error as { code?: unknown }).code;
  if (typeof code !== 'string') return 'UNKNOWN';
  // "Anything in the resource, I/O or transaction-state classes is a store problem." Reads
  // plausible; admits `40001` (retryable), `08006` (never observed at ingress), `53200`
  // (a process resource failure) and `25006`'s whole class.
  return /^(?:53|58|08|25|40)/.test(code) ? 'AUDIT_STORE_WRITE_UNAVAILABLE' : 'UNKNOWN';
}
