import type { Pool } from '../../src/db/pool.js';

/**
 * TEST-ONLY. Two defective CLAIM designs: a bypass, and a full-halt-blind evaluator.
 *
 * =================================================================================
 * `§37` OF THE S1I MANDATE, items 7 and 10:
 *
 *   7. "full-halt ignored at claim"
 *  10. "claim bypass API skips S1H classifier"
 *
 * `§30`: "Do not expose a low-level exported production function that says
 * `forceClaim(outboxId)` without performing the current eligibility checks."
 * `§15`: "At claim time: every normally affected class must refuse claim under full halt."
 * =================================================================================
 */

/**
 * The unconstrained claim ledger. Created in its own transaction, before any use.
 *
 * `0010`'s state-machine trigger refuses every UPDATE to a `CLAIMED` row, so a bypass
 * pointed at the production table would raise rather than exhibit its defect — and the
 * point of a bypass control is that it CLAIMS. The production row is read, never written.
 */
export async function ensureUnsafeBypassLedger(control: Pool): Promise<void> {
  const client = await control.connect();
  try {
    await client.query(
      `CREATE TABLE IF NOT EXISTS unsafe_bypass_claims (
         company_id      TEXT,
         idempotency_key TEXT,
         claim_id        TEXT,
         reason          TEXT
       )`,
    );
    await client.query('TRUNCATE unsafe_bypass_claims');
  } finally {
    client.release();
  }
}

export async function unsafeBypassClaimCount(
  control: Pool,
  companyId: string,
  idempotencyKey: string,
): Promise<number> {
  const client = await control.connect();
  try {
    const result = await client.query<{ n: string }>(
      `SELECT count(*)::TEXT AS n FROM unsafe_bypass_claims
        WHERE company_id = $1 AND idempotency_key = $2`,
      [companyId, idempotencyKey],
    );
    return Number(result.rows[0]!.n);
  } finally {
    client.release();
  }
}

/**
 * `§37` ITEM 10 / `§30` — `forceClaim(outboxId)`. NO ELIGIBILITY EVALUATION AT ALL.
 *
 * WHAT IS MISSING: everything the production claim reads. No `mirrorDispatchOperandsOn`, no
 * `activeOverrideOn`, no `classifyDispatchPrecedence`, no exposure, no recoverability.
 *
 * `30 §5.1` item 3 puts "dispatch, per (4)" after the commit and after the audit push, so a
 * claim that skips (4) is a dispatch decision made by nobody. `26 §1` Corollary 3 states
 * the general form: "the request must be built by the ceiling's enforcer, not by its
 * subject."
 *
 * This is the shape `§30` forbids production from having, and the production module's
 * exported surface is asserted against a hand-authored list in
 * `no-transport-boundary.test.ts` so this shape cannot appear there.
 */
export async function unsafeForceClaim(
  control: Pool,
  input: {
    readonly companyId: string;
    readonly idempotencyKey: string;
    readonly claimId: string;
  },
): Promise<'CLAIMED' | 'NOT_FOUND'> {
  const client = await control.connect();
  try {
    const exists = await client.query(
      `SELECT 1 FROM dispatch_outbox WHERE company_id = $1 AND idempotency_key = $2`,
      [input.companyId, input.idempotencyKey],
    );
    if ((exists.rowCount ?? 0) === 0) return 'NOT_FOUND';
    await client.query(
      `INSERT INTO unsafe_bypass_claims (company_id, idempotency_key, claim_id, reason)
       VALUES ($1, $2, $3, 'forceClaim: no precedence evaluation performed')`,
      [input.companyId, input.idempotencyKey, input.claimId],
    );
    return 'CLAIMED';
  } finally {
    client.release();
  }
}

/**
 * `§37` ITEM 7 — the precedence list evaluated WITHOUT `30 §5.1a`'s FULL-HALT POSTURE.
 *
 * WHAT IS MISSING: the posture. This evaluator reads the mirror state and the recoverability
 * class — so it is not a bypass — and then applies `30 §5.1` item 4's rows WITHOUT item 5's
 * "Mirror unreachable continuously for at or beyond `audit_unreachable_full_halt_threshold`
 * halts **all** classes including REVERSIBLE."
 *
 * That is the v1.3.2 behaviour S1H's own result reported as NOT IMPLEMENTED, so this control
 * is also a regression guard against reverting to it: `30 §5.1a` is the owner disposition
 * that declared the threshold, and a REVERSIBLE claim six hours into an unreachable mirror
 * is precisely what it exists to stop.
 *
 * The declaration's age is read from the REAL `mirror_declaration` row, so the only
 * difference from production is the missing predicate.
 */
export async function unsafeFullHaltBlindClaim(
  control: Pool,
  input: {
    readonly companyId: string;
    readonly idempotencyKey: string;
    readonly recoverability: string;
    readonly now: Date;
  },
): Promise<'DISPATCH_ELIGIBLE' | 'SUSPEND' | 'HALT'> {
  const client = await control.connect();
  try {
    const declaration = await client.query<{ opened_at: Date }>(
      `SELECT opened_at FROM mirror_declaration
        WHERE company_id = $1 AND closed_at IS NULL`,
      [input.companyId],
    );
    // The state IS read, and the declaration's age IS available — and then ignored.
    const openFor =
      declaration.rows[0] === undefined
        ? 0
        : input.now.getTime() - declaration.rows[0].opened_at.getTime();
    void openFor;

    // `30 §5.1` item 4's rows, WITHOUT item 5's posture.
    if (input.recoverability === 'IRRECOVERABLE') return 'HALT';
    if (input.recoverability === 'COMPENSABLE') return 'SUSPEND';
    return 'DISPATCH_ELIGIBLE';
  } finally {
    client.release();
  }
}
