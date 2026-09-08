/**
 * `30 §5.7.1a` — THE CLOSED POSTGRESQL MAPPING FOR `AUDIT_STORE_WRITE_UNAVAILABLE`.
 * S1H, completed under package issue v1.3.3 (S1H-C8).
 *
 * =================================================================================
 * THE ARCHITECTURE DECLARES THE SEMANTIC CLASS. THIS FILE DECLARES THE MAPPING.
 *
 * `30 §5.7.1a`, verbatim:
 *
 *   "**`AUDIT_STORE_WRITE_UNAVAILABLE`.** The genuine inability of an otherwise healthy,
 *    authenticated audit ingress path to make a **valid** write durable, because the
 *    **audit storage layer is unavailable for writes.**
 *
 *    **The architecture declares the semantic class. The storage implementation declares
 *    which of its concrete failures map into it.** The mapping must be a **closed
 *    enumeration**, documented at the point of implementation, tested, and **fail-closed for
 *    every unknown or unenumerated storage error**. The architecture does not depend on, and
 *    must not restate, a vendor-specific error-code list; conversely no implementation may
 *    widen the class by mapping a code the architecture's definition does not cover. For each
 *    mapped failure the implementation must state **why it is a store-availability failure
 *    rather than a security, integrity or policy failure.**"
 *
 * This is that point of implementation. THREE SQLSTATEs map. Everything else — every other
 * code in every other class, and any error carrying no SQLSTATE at all — is `UNKNOWN`, and
 * `UNKNOWN` produces no signal. `store-write-availability.test.ts` asserts the closure by
 * enumerating the mapped set and by driving a representative of each excluded class.
 * =================================================================================
 *
 * =================================================================================
 * WHY THE ORDERING OF `§5.7.1a`'s TEN CONJUNCTS IS A PROPERTY OF `A0001`, NOT OF THIS FILE.
 *
 * `§5.7.1a` conditions 1-8 are the conditions under which the store would otherwise have
 * ACCEPTED the row. `A0001`'s `audit_ingest_journal_row` already establishes every one of
 * them before the heap write, and it does so by construction rather than by a checklist:
 *
 *   1  reached ingress          the function executed at all. A control-side timeout before
 *                              that is `§5.7.1a`'s own exclusion and never gets here.
 *   2  identity/authentication  `EXECUTE` is granted to `acos_audit_replication` and to
 *                              nothing else; `insufficient_privilege` is raised BEFORE the
 *                              body runs, and is excluded below.
 *   3  admissible               the declared signature, the row-kind CHECK and the column
 *                              domains. A violation raises `23xxx`, excluded below.
 *   4  JCS-1 reconstruction     `audit_journal_chain`, a BEFORE INSERT trigger, raises
 *   5  hash/canonical checks    `ACS41` on either. The function catches it and RETURNS
 *                              `AUDIT_CANONICAL_MISMATCH` or `AUDIT_CHAIN_BREAK`.
 *   6  not a collision          returns `AUDIT_SEQUENCE_COLLISION`, in the pre-read and
 *   7  not a benign duplicate   again in the `unique_violation` handler. Both RETURN.
 *   8  quota available          the same BEFORE INSERT trigger raises `ACS18`; the function
 *                              catches it and RETURNS `AUDIT_QUOTA_SATURATED`.
 *   9  the write was attempted   the `INSERT` statement ran — the trigger fired, so it did.
 *  10  it could not commit       the only remaining way out of the function is a PROPAGATED
 *                              PostgreSQL error, which is what this file classifies.
 *
 * So the ten conjuncts are not re-tested here and could not be: **six of the eight
 * disqualifying conditions leave the function through a `RETURN`, not through an exception**,
 * and the trigger that performs conditions 4, 5 and 8 is `BEFORE INSERT`, which means it has
 * already run when the heap write is attempted. An error that reaches this classifier is one
 * that arrived after all of them. `store-write-availability.test.ts` asserts that ordering
 * against real PostgreSQL rather than trusting this comment.
 * =================================================================================
 */

/** The audit plane's classification of one propagated storage error. Closed. */
export const STORE_WRITE_CLASSES = ['AUDIT_STORE_WRITE_UNAVAILABLE', 'UNKNOWN'] as const;

export type StoreWriteClass = (typeof STORE_WRITE_CLASSES)[number];

/**
 * The three mapped SQLSTATEs, each with the justification `30 §5.7.1a` requires.
 *
 * ---------------------------------------------------------------------------------
 * `53100` — `disk_full`.
 *
 * PostgreSQL raises it when it cannot extend a relation or write WAL because the filesystem
 * or tablespace holding it has no space. The row was authenticated, admissible, canonical,
 * correctly chained, non-colliding and in quota — the store simply has nowhere to put it.
 *
 * WHY IT IS A STORE-AVAILABILITY FAILURE AND NOT A SECURITY, INTEGRITY OR POLICY FAILURE.
 * Nothing about the row is in question: the same bytes succeed the moment space exists. It
 * carries no information about the writer, contradicts no held predecessor and violates no
 * declared rule. And it is NOT the audit insert quota: `I17c`'s quota is a DECLARED
 * per-principal accounting limit enforced by `A0001`'s trigger, which returns
 * `AUDIT_QUOTA_SATURATED` as an OUTCOME and never reaches this classifier.
 * ---------------------------------------------------------------------------------
 * `58030` — `io_error`.
 *
 * The storage layer failed a physical read or write. Same argument: the write is valid and
 * the layer cannot complete it.
 *
 * WHY NOT AN INTEGRITY FAILURE. An I/O error on a WRITE is a failure to make a valid write
 * durable, which is the semantic class exactly. It is deliberately narrow: `58P01`
 * (`undefined_file`) is EXCLUDED, because a missing file is a claim about the store's own
 * state that a store-availability reading would launder into a mode change.
 * ---------------------------------------------------------------------------------
 * `25006` — `read_only_sql_transaction`.
 *
 * The audit instance will not accept writes at all — it is in recovery or hot standby, or
 * `default_transaction_read_only` is on. Every valid write fails and no invalid one is
 * distinguished.
 *
 * WHY NOT A PRIVILEGE FAILURE. A privilege failure is about the PRINCIPAL and PostgreSQL
 * raises `42501` for it, which is excluded below. `25006` is about the INSTANCE, and is
 * raised identically for a superuser. `30 §5.7.1a`'s class is "the audit storage layer is
 * unavailable for writes", and a read-only instance is the literal case.
 * ---------------------------------------------------------------------------------
 */
export const MAPPED_STORE_WRITE_SQLSTATES: readonly string[] = Object.freeze([
  '53100',
  '58030',
  '25006',
]);

/**
 * Codes that are DELIBERATELY NOT MAPPED, enumerated so the exclusion is a reviewable list
 * rather than an absence, and asserted by name in `store-write-availability.test.ts`.
 *
 * `30 §5.7.1a`'s exclusion list, against the SQLSTATE each excluded case actually raises:
 *
 *   `42501`  insufficient_privilege        — insufficient privilege / unauthorised principal
 *   `28000`  invalid_authorization_spec.   — invalid credentials
 *   `28P01`  invalid_password              — invalid credentials
 *   `23502`  not_null_violation            — malformed payload
 *   `23503`  foreign_key_violation         — malformed payload
 *   `23514`  check_violation               — malformed payload / unsupported row kind
 *   `22P02`  invalid_text_representation   — malformed payload
 *   `22003`  numeric_value_out_of_range    — malformed payload
 *   `23505`  unique_violation              — handled as duplicate/collision by `A0001`
 *   `ACS41`  canonical / chain mismatch    — integrity, handled as an OUTCOME by `A0001`
 *   `ACS18`  quota saturated               — `I17c` incident, an OUTCOME, NEVER a mode change
 *   `40001`  serialization_failure         — retryable, excluded by name
 *   `40P01`  deadlock_detected             — excluded by name
 *   `57014`  query_canceled                — caller cancellation
 *   `08000`  connection_exception          — the attempt may not have been OBSERVED at
 *   `08003`  connection_does_not_exist       ingress, which fails `§5.7.1a` conjunct 1. This
 *   `08006`  connection_failure              is the "control-side timeout before audit
 *   `57P03`  cannot_connect_now              ingress observed the attempt" exclusion, and a
 *                                            severed connection is indistinguishable from it
 *   `53200`  out_of_memory                 — a server process resource failure, not the
 *                                            storage layer being unavailable for writes
 *   `53300`  too_many_connections          — a connection failure; see the `08xxx` reasoning
 *   `58P01`  undefined_file                — a claim about the store's own state; a
 *                                            store-availability reading would launder a
 *                                            possible integrity problem into a mode change
 *
 * The list is illustrative of the reasoning and is NOT the mechanism: the mechanism is that
 * only `MAPPED_STORE_WRITE_SQLSTATES` maps and everything else is `UNKNOWN`. Adding a code
 * to PostgreSQL, or meeting one nobody enumerated, changes nothing.
 */
export const EXPLICITLY_EXCLUDED_SQLSTATES: readonly string[] = Object.freeze([
  '42501',
  '28000',
  '28P01',
  '23502',
  '23503',
  '23514',
  '23505',
  '22P02',
  '22003',
  'ACS41',
  'ACS18',
  '40001',
  '40P01',
  '57014',
  '08000',
  '08003',
  '08006',
  '57P03',
  '53200',
  '53300',
  '58P01',
]);

/**
 * Classify one propagated error. FAIL-CLOSED BY CONSTRUCTION.
 *
 * The default is `UNKNOWN` and the mapped set is a literal allowlist, so this function
 * cannot be widened by a new error code, by an error with no code, by a non-`Error` throw or
 * by a message the error carries. **Nothing is read from `message`**: a classifier that
 * matched on text would be a classifier a payload could influence.
 *
 * `30 §5.7.1a`: "fail-closed for every unknown or unenumerated storage error."
 */
export function classifyStoreWriteError(error: unknown): StoreWriteClass {
  if (typeof error !== 'object' || error === null) return 'UNKNOWN';
  const code = (error as { code?: unknown }).code;
  if (typeof code !== 'string') return 'UNKNOWN';
  return MAPPED_STORE_WRITE_SQLSTATES.includes(code)
    ? 'AUDIT_STORE_WRITE_UNAVAILABLE'
    : 'UNKNOWN';
}
