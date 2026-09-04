/**
 * Denial and violation codes reaching the money path.
 *
 * Every one is raised by PostgreSQL, not by application code. The SQLSTATE values are
 * the contract between the trigger bodies in `src/db/migrations/` and this module, and
 * the tests assert on them so that a denial produced by an application-level check
 * instead of by the database would be visible as a different error shape.
 *
 * `36 §2` VC-L2: "The commitment guard on window_balance rejects the over-commit at the
 * database, not in application code — assert by attempting the insert with the
 * application check disabled."
 */

export const SQLSTATE = {
  /** I3's commitment guard refused a new commitment. `24 §3` K5. */
  I3_WINDOW_EXHAUSTED: 'ACS03',
  /** I62 refused a StandingAuthorization transition outside T1–T8. Registry §1.2. */
  I62_ILLEGAL_TRANSITION: 'ACS62',
  /** I51 refused an increase to a held reservation. Registry §1.2. */
  I51_RESERVATION_INCREASE_REFUSED: 'ACS51',
  /** PostgreSQL: a write naming a GENERATED ALWAYS column. */
  GENERATED_ALWAYS_WRITE: '428C9',
  /** PostgreSQL: deadlock detected. */
  DEADLOCK_DETECTED: '40P01',
  /** PostgreSQL: could not serialize access. */
  SERIALIZATION_FAILURE: '40001',
} as const;

export type Sqlstate = (typeof SQLSTATE)[keyof typeof SQLSTATE];

export interface PgErrorLike {
  readonly code?: string;
  readonly detail?: string;
  readonly message: string;
}

export function isPgError(error: unknown): error is PgErrorLike {
  return (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof (error as { message: unknown }).message === 'string'
  );
}

export function hasSqlstate(error: unknown, code: string): boolean {
  return isPgError(error) && error.code === code;
}

/** The step R denial `26 §7` names when any referenced window instance lacks headroom. */
export class WindowExhausted extends Error {
  public readonly denialCode = 'WINDOW_EXHAUSTED';
  public override readonly cause: unknown;
  public readonly detail: string | undefined;

  public constructor(detail: string | undefined, cause: unknown) {
    super(`DENY: WINDOW_EXHAUSTED${detail ? ` — ${detail}` : ''}`);
    this.name = 'WindowExhausted';
    this.cause = cause;
    this.detail = detail;
  }
}

/**
 * Translate a database refusal into the architecture's denial vocabulary.
 *
 * Deliberately narrow: only I3's guard becomes a denial. Everything else — an illegal
 * transition, a generated-column write, a reservation increase — is a defect or an
 * attack and propagates as itself rather than being softened into a denial.
 */
export function asDenial(error: unknown): never {
  if (hasSqlstate(error, SQLSTATE.I3_WINDOW_EXHAUSTED)) {
    const detail = isPgError(error) ? error.detail : undefined;
    throw new WindowExhausted(detail, error);
  }
  throw error;
}
