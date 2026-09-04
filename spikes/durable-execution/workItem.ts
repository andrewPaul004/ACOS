import type { Client } from '../../src/db/pool.js';
import { acquireMoneyPathLocks, allocateJournalSeq } from '../../src/kernel/exposure/lockOrder.js';

/**
 * THE SHARED WORK ITEM.
 *
 * `phase2-v1.3-implementation-brief.md §4`, verbatim:
 *
 *   "The DBOS-versus-step-journal spike is authorised (62 §6), unchanged and
 *    re-authorised. Gap-free journal_seq requires a counter row inside the authorising
 *    transaction, which is a property of the substrate and not of the workflow engine,
 *    and the outbox is ACOS-owned either way. Add to its kill-point matrix: the TB-04
 *    interleavings — an asynchronous realised-spend update against a concurrent
 *    authorisation on the same window_balance row, in both orderings."
 *
 * The S1A mandate: "Create two minimal implementations around the SAME small
 * transaction/work item. [...] Do not compare different applications. Both candidates
 * should exercise the same conceptual sequence."
 *
 * That sequence, once, here. Candidate A (DBOS) and candidate B (ACOS step journal) each
 * wrap THESE functions; neither reimplements them. Whatever the two candidates differ
 * in, it is not the work.
 *
 *   step 1  claim      — idempotency claim on the work item id
 *   step 2  applyLedger — THE ACOS APPLICATION TRANSACTION:
 *                          declared lock order → TB-04 atomic realised-spend statement
 *                          → gap-free journal_seq allocation, all in ONE commit
 *   step 3  dispatch   — a MOCK external effect. `37` S1: all four action classes run
 *                        against mocks, and the S1A mandate prohibits real adapters
 *   step 4  complete   — mark the work item done
 *
 * The property the spike is measuring is narrow and is stated in
 * docs/implementation/ADR-IMP-002-durable-execution.md: does the durability layer
 * PRESERVE or MATERIALLY COMPLICATE step 2's single-commit property?
 */

export const COMPANY_ID = 'co_spike';
export const WINDOW_ID = 'W_MONTH_ADSPEND';
export const INSTANCE_KEY = 'W_MONTH_ADSPEND:2026-01';
export const STANDING_ID = 'sa_spike';
export const CEILING = '186.00';
export const STANDING_CAP = '100.00';

/** Named points at which a candidate's process may be killed. */
export const KILL = {
  NONE: 'NONE',
  /** 1. before the application transaction begins */
  BEFORE_TX: 'BEFORE_TX',
  /** 2. after locks acquired */
  AFTER_LOCKS: 'AFTER_LOCKS',
  /** 3. after business rows change but before commit */
  AFTER_ROWS_BEFORE_COMMIT: 'AFTER_ROWS_BEFORE_COMMIT',
  /** 4. immediately after commit */
  AFTER_COMMIT: 'AFTER_COMMIT',
  /** 5. after durability/checkpoint state */
  AFTER_CHECKPOINT: 'AFTER_CHECKPOINT',
  /** 6. during retry/recovery */
  DURING_RECOVERY: 'DURING_RECOVERY',
  /** 7. concurrent retry of the same work item — driven by the harness, not a kill */
  CONCURRENT_RETRY: 'CONCURRENT_RETRY',
} as const;

export type KillPoint = (typeof KILL)[keyof typeof KILL];

/** Hard-kill this process. Not an exception: the point is that no handler runs. */
export function killNow(point: string): never {
  process.stdout.write(`KILLED_AT ${point}\n`);
  process.kill(process.pid, 'SIGKILL');
  // Unreachable in practice; SIGKILL is not catchable.
  throw new Error(`unreachable after SIGKILL at ${point}`);
}

export function killIf(active: string, point: string): void {
  if (active === point) killNow(point);
}

/** The spike's own tables, plus the S1A schema it reuses. */
export async function createSpikeSchema(client: Client): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS spike_work_item (
      work_item_id  TEXT PRIMARY KEY,
      delta         NUMERIC(18,2) NOT NULL,
      state         TEXT NOT NULL,
      claimed_at    TIMESTAMPTZ,
      completed_at  TIMESTAMPTZ
    )
  `);
  // The MOCK external effect. `37` S1: "all against a mock adapter."
  await client.query(`
    CREATE TABLE IF NOT EXISTS spike_mock_dispatch (
      dispatch_id   BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      work_item_id  TEXT NOT NULL,
      payload       TEXT NOT NULL,
      dispatched_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}

export async function seedSpikeFixture(client: Client, workItemId: string, delta: string): Promise<void> {
  await client.query(
    `INSERT INTO company (company_id, name, timezone, created_at)
     VALUES ($1, 'spike', 'UTC', now()) ON CONFLICT DO NOTHING`,
    [COMPANY_ID],
  );
  await client.query(
    `INSERT INTO journal_counter (company_id) VALUES ($1) ON CONFLICT DO NOTHING`,
    [COMPANY_ID],
  );
  await client.query(
    `INSERT INTO window_registry (
       company_id, window_id, name, boundary_kind, period,
       max_monetary, max_monetary_unbounded, max_count, max_count_unbounded,
       max_irrecoverable_units, max_irrecoverable_unbounded)
     VALUES ($1, $2, 'spike ad spend', 'DISCRETE', 'MONTH', $3::NUMERIC, false, 0, true, 0, true)
     ON CONFLICT DO NOTHING`,
    [COMPANY_ID, WINDOW_ID, CEILING],
  );
  await client.query(
    `INSERT INTO window_balance (
       company_id, window_id, window_instance_key,
       max_monetary, max_monetary_unbounded, max_count, max_count_unbounded,
       max_irrecoverable_units, max_irrecoverable_unbounded)
     VALUES ($1, $2, $3, $4::NUMERIC, false, 0, true, 0, true)
     ON CONFLICT DO NOTHING`,
    [COMPANY_ID, WINDOW_ID, INSTANCE_KEY, CEILING],
  );
  await client.query(
    `INSERT INTO standing_revocation_authority (
       revocation_authority_id, company_id, standing_authorization_id,
       action_class_selector, resource_selector, per_action_max_monetary, expires_at, created_by)
     VALUES ('sra_spike', $1, $2, 'campaign.pause', 'campaign/1', 0.00,
             '2026-04-01T00:00:00Z', 'KERNEL') ON CONFLICT DO NOTHING`,
    [COMPANY_ID, STANDING_ID],
  );
  await client.query(
    `INSERT INTO standing_authorization (
       standing_authorization_id, company_id, action_class, resource_ref, adapter,
       rate_amount, rate_currency, rate_period, created_at, expires_at,
       cessation_grace_hours, revocation_effect_class, revocation_authority_id, status)
     VALUES ($1, $2, 'campaign.budget.set', 'campaign/1', 'google_ads',
             6.00, 'USD', 'day', '2026-01-01T00:00:00Z', '2026-01-31T23:59:59Z',
             72, 'campaign.pause', 'sra_spike', 'LIVE') ON CONFLICT DO NOTHING`,
    [STANDING_ID, COMPANY_ID],
  );
  await client.query(
    `INSERT INTO standing_window_exposure (
       standing_authorization_id, window_id, window_instance_key, company_id,
       standing_cap_monetary, realised_monetary, instance_in_scope)
     VALUES ($1, $2, $3, $4, $5::NUMERIC, 0.00, true) ON CONFLICT DO NOTHING`,
    [STANDING_ID, WINDOW_ID, INSTANCE_KEY, COMPANY_ID, STANDING_CAP],
  );
  await client.query(
    `INSERT INTO spike_work_item (work_item_id, delta, state)
     VALUES ($1, $2::NUMERIC, 'PENDING') ON CONFLICT DO NOTHING`,
    [workItemId, delta],
  );
}

/* ------------------------------------------------------------------------------ *
 * The four steps. Shared verbatim by both candidates.
 * ------------------------------------------------------------------------------ */

/** Step 1 — claim. Idempotent by construction: only PENDING → CLAIMED transitions. */
export async function stepClaim(client: Client, workItemId: string): Promise<boolean> {
  const result = await client.query(
    `UPDATE spike_work_item SET state = 'CLAIMED', claimed_at = now()
      WHERE work_item_id = $1 AND state = 'PENDING'`,
    [workItemId],
  );
  return (result.rowCount ?? 0) === 1;
}

export interface LedgerResult {
  readonly journalSeq: string;
  readonly realisedAfter: string;
  readonly standingAfter: string;
}

/**
 * Step 2 — THE ACOS APPLICATION TRANSACTION.
 *
 * The caller supplies an already-open transaction. Everything below must land in ONE
 * commit: the declared lock order, the TB-04 atomic realised/standing statement, and the
 * gap-free journal_seq allocation. `phase2-v1.3-implementation-brief.md §4` calls the
 * counter-inside-the-transaction "a property of the substrate and not of the workflow
 * engine", and this function is where that claim is tested.
 */
export async function stepApplyLedger(
  tx: Client,
  workItemId: string,
  delta: string,
  killPoint: string,
): Promise<LedgerResult> {
  await acquireMoneyPathLocks(tx, {
    companyId: COMPANY_ID,
    windowInstances: [{ windowId: WINDOW_ID, windowInstanceKey: INSTANCE_KEY }],
    includeStandingRows: true,
    includeJournalCounter: true,
  });
  killIf(killPoint, KILL.AFTER_LOCKS);

  // The TB-04 statement. One column written; the sync trigger moves both window_balance
  // terms inside it.
  const updated = await tx.query<{ realised_monetary: string; forward_monetary: string }>(
    `UPDATE standing_window_exposure
        SET realised_monetary = realised_monetary + $1::NUMERIC
      WHERE company_id = $2 AND standing_authorization_id = $3
        AND window_id = $4 AND window_instance_key = $5
      RETURNING realised_monetary, forward_monetary`,
    [delta, COMPANY_ID, STANDING_ID, WINDOW_ID, INSTANCE_KEY],
  );

  const journalSeq = await allocateJournalSeq(tx, COMPANY_ID);

  await tx.query(
    `UPDATE spike_work_item SET state = 'LEDGER_APPLIED' WHERE work_item_id = $1`,
    [workItemId],
  );

  const balance = await tx.query<{ standing_monetary: string }>(
    `SELECT standing_monetary FROM window_balance
      WHERE company_id = $1 AND window_id = $2 AND window_instance_key = $3`,
    [COMPANY_ID, WINDOW_ID, INSTANCE_KEY],
  );

  killIf(killPoint, KILL.AFTER_ROWS_BEFORE_COMMIT);

  return {
    journalSeq: journalSeq.toString(),
    realisedAfter: updated.rows[0]?.realised_monetary ?? '?',
    standingAfter: balance.rows[0]?.standing_monetary ?? '?',
  };
}

/** Step 3 — the MOCK external effect. */
export async function stepDispatch(
  client: Client,
  workItemId: string,
  payload: string,
): Promise<void> {
  await client.query(
    `INSERT INTO spike_mock_dispatch (work_item_id, payload) VALUES ($1, $2)`,
    [workItemId, payload],
  );
}

/** Step 4 — complete. */
export async function stepComplete(client: Client, workItemId: string): Promise<void> {
  await client.query(
    `UPDATE spike_work_item SET state = 'COMPLETE', completed_at = now()
      WHERE work_item_id = $1`,
    [workItemId],
  );
}

/* ------------------------------------------------------------------------------ *
 * Observation. What the parent process inspects after a kill.
 * ------------------------------------------------------------------------------ */

export interface SpikeObservation {
  readonly workItemState: string | null;
  readonly realisedMonetary: string | null;
  readonly standingMonetary: string | null;
  readonly journalNextSeq: string | null;
  readonly dispatchCount: number;
  /** True when the four-term sum is within the ceiling. */
  readonly withinCeiling: boolean;
  /** True when standing == max(0, cap - realised) — the TB-04 coupling still holds. */
  readonly couplingHolds: boolean;
}

export async function observe(client: Client, workItemId: string): Promise<SpikeObservation> {
  const item = await client.query<{ state: string }>(
    `SELECT state FROM spike_work_item WHERE work_item_id = $1`,
    [workItemId],
  );
  const balance = await client.query<{
    reserved_monetary: string;
    standing_monetary: string;
    presumed_monetary: string;
    realised_monetary: string;
    max_monetary: string;
  }>(
    `SELECT reserved_monetary, standing_monetary, presumed_monetary,
            realised_monetary, max_monetary
       FROM window_balance
      WHERE company_id = $1 AND window_id = $2 AND window_instance_key = $3`,
    [COMPANY_ID, WINDOW_ID, INSTANCE_KEY],
  );
  const exposure = await client.query<{
    standing_cap_monetary: string;
    realised_monetary: string;
    forward_monetary: string;
  }>(
    `SELECT standing_cap_monetary, realised_monetary, forward_monetary
       FROM standing_window_exposure WHERE standing_authorization_id = $1`,
    [STANDING_ID],
  );
  const counter = await client.query<{ next_seq: string }>(
    `SELECT next_seq FROM journal_counter WHERE company_id = $1`,
    [COMPANY_ID],
  );
  const dispatch = await client.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM spike_mock_dispatch WHERE work_item_id = $1`,
    [workItemId],
  );

  const b = balance.rows[0];
  const e = exposure.rows[0];
  const cents = (v: string): bigint => {
    const m = /^(-?)(\d+)\.(\d{2})$/.exec(v);
    if (!m) throw new Error(`not scale-2: ${v}`);
    return (m[1] === '-' ? -1n : 1n) * (BigInt(m[2]!) * 100n + BigInt(m[3]!));
  };

  const sum = b
    ? cents(b.reserved_monetary) +
      cents(b.standing_monetary) +
      cents(b.presumed_monetary) +
      cents(b.realised_monetary)
    : 0n;

  const expectedForward = e
    ? (() => {
        const r = cents(e.standing_cap_monetary) - cents(e.realised_monetary);
        return r > 0n ? r : 0n;
      })()
    : 0n;

  return {
    workItemState: item.rows[0]?.state ?? null,
    realisedMonetary: b?.realised_monetary ?? null,
    standingMonetary: b?.standing_monetary ?? null,
    journalNextSeq: counter.rows[0]?.next_seq ?? null,
    dispatchCount: Number.parseInt(dispatch.rows[0]?.n ?? '0', 10),
    withinCeiling: b ? sum <= cents(b.max_monetary) : true,
    couplingHolds: Boolean(b && e && cents(b.standing_monetary) === expectedForward),
  };
}
