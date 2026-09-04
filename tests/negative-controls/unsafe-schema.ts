import type { Client } from '../../src/db/pool.js';

/**
 * TEST-ONLY UNSAFE SCHEMA. Never imported by anything under `src/`.
 *
 * `36 §2`, the mandatory-negative-control rule, verbatim:
 *
 *   "Negative control, mandatory (v1.1, VAL-06): the same targeted-interleaving scenario
 *    at REPEATABLE READ must fail. A concurrency test with no negative control cannot be
 *    distinguished from a test that does not exercise the race."
 *
 * The S1A mandate: "Create a TEST-ONLY deliberately unsafe implementation or SQL path.
 * It must use the weaker/incomplete concurrency semantics under test; reproduce the
 * forbidden interleaving; cause the negative-control assertion to fail. Do NOT weaken
 * production code to perform the negative control."
 *
 * ---------------------------------------------------------------------------------
 * WHAT MAKES THIS UNSAFE — three named removals, each one a defect the v1.3
 * remediations closed. This is a reconstruction of the PRE-REMEDIATION shape, not an
 * invention:
 *
 *   1. NO COMMITMENT GUARD TRIGGER (the TB-01 shape).
 *      `24 §3` K5: v1.2 "printed a three-term CHECK over a row with no standing column,
 *      so the term Mechanism B exists to enforce was enforced by nothing in the artifact
 *      declaring the enforcement." Here the headroom test is done in APPLICATION CODE
 *      from a snapshot, which is what a three-term-or-absent DB guard forces.
 *
 *   2. NO GENERATED COLUMN AND NO IN-STATEMENT SYNC TRIGGER (the TB-04 shape).
 *      `24 §3` K5: "v1.2 left their atomicity undeclared: realised-first transiently
 *      breached the CHECK and blocked the financial-truth path; standing-first
 *      transiently created headroom a concurrent authorisation could consume without
 *      touching any lock associated with the standing authorisation." Here
 *      forward_monetary is an ordinary writable column and the reconciler moves standing
 *      and realised in TWO SEPARATE TRANSACTIONS, standing-first.
 *
 *   3. NO ROW LOCK, AND REPEATABLE READ INSTEAD OF SERIALIZABLE.
 *      Registry §1.2 I3 requires the row "taken SELECT … FOR UPDATE inside the
 *      authorising transaction [...] + TX at serialisable". Both are removed, which is
 *      precisely the weaker isolation `36 §2` names.
 * ---------------------------------------------------------------------------------
 *
 * The schema below is created in its own PostgreSQL schema, `unsafe_v12`, so the
 * production tables in `public` are neither modified nor shadowed.
 */

export const UNSAFE_SCHEMA = 'unsafe_v12';

export async function createUnsafeSchema(client: Client): Promise<void> {
  await client.query(`DROP SCHEMA IF EXISTS ${UNSAFE_SCHEMA} CASCADE`);
  await client.query(`CREATE SCHEMA ${UNSAFE_SCHEMA}`);

  // Same columns as the production window_balance, and NO i3_commitment_guard trigger.
  await client.query(`
    CREATE TABLE ${UNSAFE_SCHEMA}.window_balance (
      company_id          TEXT NOT NULL,
      window_id           TEXT NOT NULL,
      window_instance_key TEXT NOT NULL,
      reserved_monetary   NUMERIC(18,2) NOT NULL DEFAULT 0,
      standing_monetary   NUMERIC(18,2) NOT NULL DEFAULT 0,
      presumed_monetary   NUMERIC(18,2) NOT NULL DEFAULT 0,
      realised_monetary   NUMERIC(18,2) NOT NULL DEFAULT 0,
      max_monetary        NUMERIC(18,2) NOT NULL,
      PRIMARY KEY (company_id, window_id, window_instance_key)
    )
  `);

  // forward_monetary is an ORDINARY WRITABLE COLUMN here, not GENERATED ALWAYS.
  await client.query(`
    CREATE TABLE ${UNSAFE_SCHEMA}.standing_window_exposure (
      standing_authorization_id TEXT NOT NULL,
      window_id                 TEXT NOT NULL,
      window_instance_key       TEXT NOT NULL,
      company_id                TEXT NOT NULL,
      standing_cap_monetary     NUMERIC(18,2) NOT NULL,
      realised_monetary         NUMERIC(18,2) NOT NULL DEFAULT 0,
      forward_monetary          NUMERIC(18,2) NOT NULL DEFAULT 0,
      instance_in_scope         BOOLEAN NOT NULL DEFAULT true,
      PRIMARY KEY (standing_authorization_id, window_id, window_instance_key)
    )
  `);
}

export async function dropUnsafeSchema(client: Client): Promise<void> {
  await client.query(`DROP SCHEMA IF EXISTS ${UNSAFE_SCHEMA} CASCADE`);
}

export interface UnsafeFixture {
  readonly companyId: string;
  readonly windowId: string;
  readonly instanceKey: string;
  readonly ceiling: string;
  readonly standingAuthorizationId: string;
  readonly standingCap: string;
}

export async function seedUnsafeFixture(
  client: Client,
  fixture: UnsafeFixture,
): Promise<void> {
  await client.query(
    `INSERT INTO ${UNSAFE_SCHEMA}.window_balance
       (company_id, window_id, window_instance_key, standing_monetary, max_monetary)
     VALUES ($1, $2, $3, $4::NUMERIC, $5::NUMERIC)`,
    [
      fixture.companyId,
      fixture.windowId,
      fixture.instanceKey,
      fixture.standingCap,
      fixture.ceiling,
    ],
  );
  await client.query(
    `INSERT INTO ${UNSAFE_SCHEMA}.standing_window_exposure
       (standing_authorization_id, window_id, window_instance_key, company_id,
        standing_cap_monetary, realised_monetary, forward_monetary)
     VALUES ($1, $2, $3, $4, $5::NUMERIC, 0.00, $5::NUMERIC)`,
    [
      fixture.standingAuthorizationId,
      fixture.windowId,
      fixture.instanceKey,
      fixture.companyId,
      fixture.standingCap,
    ],
  );
}

export interface UnsafeTerms {
  readonly reserved: string;
  readonly standing: string;
  readonly presumed: string;
  readonly realised: string;
  readonly ceiling: string;
}

export async function readUnsafeTerms(
  client: Client,
  fixture: UnsafeFixture,
): Promise<UnsafeTerms> {
  const result = await client.query<{
    reserved_monetary: string;
    standing_monetary: string;
    presumed_monetary: string;
    realised_monetary: string;
    max_monetary: string;
  }>(
    `SELECT reserved_monetary, standing_monetary, presumed_monetary,
            realised_monetary, max_monetary
       FROM ${UNSAFE_SCHEMA}.window_balance
      WHERE company_id = $1 AND window_id = $2 AND window_instance_key = $3`,
    [fixture.companyId, fixture.windowId, fixture.instanceKey],
  );
  const row = result.rows[0];
  if (!row) throw new Error('unsafe fixture row missing');
  return {
    reserved: row.reserved_monetary,
    standing: row.standing_monetary,
    presumed: row.presumed_monetary,
    realised: row.realised_monetary,
    ceiling: row.max_monetary,
  };
}

/**
 * The unsafe reconciler: standing-first, in TWO SEPARATE COMMITTED TRANSACTIONS.
 *
 * `24 §3` K5 names this exact shape as the defect: "standing-first transiently created
 * headroom a concurrent authorisation could consume without touching any lock associated
 * with the standing authorisation."
 *
 * `betweenTransactions` is the seam. The interleaving under test happens there.
 */
export async function unsafeRecordRealisedSpend(
  client: Client,
  fixture: UnsafeFixture,
  delta: string,
  betweenTransactions: () => Promise<void>,
): Promise<void> {
  // TRANSACTION ONE — standing only. No FOR UPDATE. REPEATABLE READ.
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
  await client.query(
    `UPDATE ${UNSAFE_SCHEMA}.standing_window_exposure
        SET realised_monetary = realised_monetary + $4::NUMERIC,
            forward_monetary  = GREATEST(0, standing_cap_monetary
                                            - (realised_monetary + $4::NUMERIC))
      WHERE company_id = $1 AND window_id = $2 AND window_instance_key = $3`,
    [fixture.companyId, fixture.windowId, fixture.instanceKey, delta],
  );
  await client.query(
    `UPDATE ${UNSAFE_SCHEMA}.window_balance wb
        SET standing_monetary = (
              SELECT COALESCE(SUM(e.forward_monetary), 0)
                FROM ${UNSAFE_SCHEMA}.standing_window_exposure e
               WHERE e.company_id = wb.company_id
                 AND e.window_id = wb.window_id
                 AND e.window_instance_key = wb.window_instance_key
                 AND e.instance_in_scope)
      WHERE wb.company_id = $1 AND wb.window_id = $2 AND wb.window_instance_key = $3`,
    [fixture.companyId, fixture.windowId, fixture.instanceKey],
  );
  await client.query('COMMIT');

  // ---- THE FORBIDDEN INTERVAL. standing has fallen; realised has not yet risen. ----
  await betweenTransactions();

  // TRANSACTION TWO — realised only.
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
  await client.query(
    `UPDATE ${UNSAFE_SCHEMA}.window_balance
        SET realised_monetary = realised_monetary + $4::NUMERIC
      WHERE company_id = $1 AND window_id = $2 AND window_instance_key = $3`,
    [fixture.companyId, fixture.windowId, fixture.instanceKey, delta],
  );
  await client.query('COMMIT');
}

/**
 * The unsafe authorisation: read WITHOUT a lock at REPEATABLE READ, decide headroom in
 * application code, then write.
 *
 * Registry §1.2 I3's enforcement — the FOR UPDATE and the DB guard — are both absent, so
 * the decision is made against a snapshot rather than under serialisation.
 */
export async function unsafeAuthorise(
  client: Client,
  fixture: UnsafeFixture,
  amount: string,
  afterUnlockedRead: () => Promise<void>,
): Promise<'PERMIT' | 'WINDOW_EXHAUSTED'> {
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
  try {
    const terms = await readUnsafeTerms(client, fixture);
    await afterUnlockedRead();

    // The headroom test, in APPLICATION CODE, against the snapshot just read.
    const sum =
      toCents(terms.reserved) +
      toCents(terms.standing) +
      toCents(terms.presumed) +
      toCents(terms.realised);
    if (sum + toCents(amount) > toCents(terms.ceiling)) {
      await client.query('ROLLBACK');
      return 'WINDOW_EXHAUSTED';
    }

    await client.query(
      `UPDATE ${UNSAFE_SCHEMA}.window_balance
          SET reserved_monetary = reserved_monetary + $4::NUMERIC
        WHERE company_id = $1 AND window_id = $2 AND window_instance_key = $3`,
      [fixture.companyId, fixture.windowId, fixture.instanceKey, amount],
    );
    await client.query('COMMIT');
    return 'PERMIT';
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  }
}

function toCents(value: string): bigint {
  const match = /^(-?)(\d+)\.(\d{2})$/.exec(value);
  if (!match) throw new Error(`expected a scale-2 decimal, got ${value}`);
  const magnitude = BigInt(match[2]!) * 100n + BigInt(match[3]!);
  return match[1] === '-' ? -magnitude : magnitude;
}
