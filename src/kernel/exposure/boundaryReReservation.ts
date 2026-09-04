import type { Client } from '../../db/pool.js';
import { ensureWindowInstance } from './ledger.js';
import { acquireMoneyPathLocks } from './lockOrder.js';
import { standingCap, type AdapterParameters } from './standingCap.js';
import { fromDb, toDb } from './money.js';
import {
  inScopeInterval,
  instanceFor,
  periodIntersectsInterval,
  type WindowPeriod,
} from './windowInstance.js';

/**
 * The window-boundary re-reservation job.
 *
 * `24 §3.1`, verbatim:
 *
 *   "The boundary re-reservation job re-reserves only for status = LIVE. At a window
 *    boundary it creates a standing_window_exposure row in the new instance for every
 *    LIVE authorisation whose in-scope interval reaches it, and for no other status."
 *
 * and the table it implements:
 *
 *   | Status at the boundary | Predecessor instance      | New instance                    |
 *   | LIVE                   | Closes with the instance  | Row created. Exposure continues |
 *   | PAUSE_PENDING          | Retained to instance close| No row. Headroom returns        |
 *   | PAUSED                 | Retained to instance close| No row. Headroom returns        |
 *   | EXPIRED                | Retained to instance close| No row. Headroom returns        |
 *   | REVOKED                | Released at T7/T8         | No row                          |
 *
 * The LIVE-only rule is a single SQL predicate below, and it is the whole of TB-02's
 * repair. `24 §3.1` on why not more: "The alternative — re-reserving PAUSE_PENDING
 * indefinitely — reintroduces permanent exhaustion for any pause that never verifies,
 * which is the defect being repaired."
 *
 * NOT IN S1A. This job does not dispatch a pause, does not retry (TB-11 blocks the
 * PAUSE_PENDING retry implementation), and does not supersede anything (TB-13 blocks any
 * campaign.budget.set supersession path). `24 §3` K5's "a window boundary that cannot be
 * re-reserved pauses the affected standing authorisation" is the S1 behaviour; S1A
 * implements the row creation and reports the failure to its caller.
 */

export interface BoundaryWindowSpec {
  readonly windowId: string;
  readonly period: WindowPeriod;
}

export interface BoundaryRunRequest {
  readonly companyId: string;
  readonly companyTimezone: string;
  /** The instant the new instance is entered. No live clock: `37` S1 / brief `§3`. */
  readonly at: Date;
  readonly windows: readonly BoundaryWindowSpec[];
  readonly adapters: ReadonlyMap<string, AdapterParameters>;
}

export interface BoundaryOutcome {
  readonly standingAuthorizationId: string;
  readonly windowId: string;
  readonly windowInstanceKey: string;
  readonly action: 'ROW_CREATED' | 'SKIPPED_NOT_LIVE' | 'SKIPPED_OUT_OF_SCOPE' | 'ALREADY_PRESENT';
  readonly status: string;
  readonly standingCap: string | null;
}

interface AuthorizationRow {
  standing_authorization_id: string;
  status: string;
  adapter: string;
  rate_amount: string;
  created_at: Date;
  expires_at: Date;
  cessation_grace_hours: number;
}

/**
 * Create the new instance's standing_window_exposure rows.
 *
 * Runs one transaction per (window, instance) so the declared lock order is entered
 * cleanly for each and a failure on one boundary does not roll back another. The caller
 * owns the transaction boundary for each call into `runForInstance`.
 */
export async function runForInstance(
  client: Client,
  request: BoundaryRunRequest,
  window: BoundaryWindowSpec,
): Promise<readonly BoundaryOutcome[]> {
  const instance = instanceFor(
    window.windowId,
    window.period,
    request.at,
    request.companyTimezone,
  );
  await ensureWindowInstance(client, request.companyId, instance);

  await acquireMoneyPathLocks(client, {
    companyId: request.companyId,
    windowInstances: [{ windowId: instance.windowId, windowInstanceKey: instance.key }],
    includeStandingRows: true,
    includeJournalCounter: false,
  });

  // Every authorisation the company holds against this window, whatever its status. The
  // LIVE filter is applied below rather than in this query, so a skipped status is
  // reported as a skip with its reason rather than being invisible.
  const candidates = await client.query<AuthorizationRow>(
    `SELECT DISTINCT s.standing_authorization_id, s.status, s.adapter, s.rate_amount,
            s.created_at, s.expires_at, s.cessation_grace_hours
       FROM standing_authorization s
       JOIN standing_window_exposure e
         ON e.standing_authorization_id = s.standing_authorization_id
      WHERE s.company_id = $1
        AND e.window_id = $2
      ORDER BY s.standing_authorization_id`,
    [request.companyId, instance.windowId],
  );

  const outcomes: BoundaryOutcome[] = [];

  for (const row of candidates.rows) {
    const existing = await client.query(
      `SELECT 1 FROM standing_window_exposure
        WHERE standing_authorization_id = $1 AND window_id = $2 AND window_instance_key = $3`,
      [row.standing_authorization_id, instance.windowId, instance.key],
    );
    if ((existing.rowCount ?? 0) > 0) {
      outcomes.push({
        standingAuthorizationId: row.standing_authorization_id,
        windowId: instance.windowId,
        windowInstanceKey: instance.key,
        action: 'ALREADY_PRESENT',
        status: row.status,
        standingCap: null,
      });
      continue;
    }

    // THE LIVE-ONLY RULE. `24 §3.1`, and the reason it is one line: every other status
    // returns headroom at the boundary, and that is TB-02's repair.
    if (row.status !== 'LIVE') {
      outcomes.push({
        standingAuthorizationId: row.standing_authorization_id,
        windowId: instance.windowId,
        windowInstanceKey: instance.key,
        action: 'SKIPPED_NOT_LIVE',
        status: row.status,
        standingCap: null,
      });
      continue;
    }

    const interval = inScopeInterval(
      row.created_at,
      row.expires_at,
      row.cessation_grace_hours,
    );
    if (!periodIntersectsInterval(instance, interval)) {
      outcomes.push({
        standingAuthorizationId: row.standing_authorization_id,
        windowId: instance.windowId,
        windowInstanceKey: instance.key,
        action: 'SKIPPED_OUT_OF_SCOPE',
        status: row.status,
        standingCap: null,
      });
      continue;
    }

    const adapter = request.adapters.get(row.adapter);
    if (!adapter) {
      throw new Error(`no declared parameters for adapter ${row.adapter} (51 §3.2)`);
    }
    const cap = standingCap(fromDb(row.rate_amount), window.period, instance, adapter);

    await client.query(
      `INSERT INTO standing_window_exposure (
         standing_authorization_id, window_id, window_instance_key, company_id,
         standing_cap_monetary, realised_monetary, instance_in_scope)
       VALUES ($1, $2, $3, $4, $5::NUMERIC, 0.00, true)`,
      [
        row.standing_authorization_id,
        instance.windowId,
        instance.key,
        request.companyId,
        toDb(cap),
      ],
    );

    outcomes.push({
      standingAuthorizationId: row.standing_authorization_id,
      windowId: instance.windowId,
      windowInstanceKey: instance.key,
      action: 'ROW_CREATED',
      status: row.status,
      standingCap: toDb(cap),
    });
  }

  return outcomes;
}

/**
 * Drop an authorisation's exposure out of scope when its in-scope interval has ended.
 *
 * `24 §3.1`: "instance_in_scope goes false when the interval ends, and
 * window_balance.standing_monetary drops the term in the same statement."
 *
 * The "same statement" property comes from the sync trigger, not from this function.
 */
export async function lapseOutOfScopeExposure(
  client: Client,
  companyId: string,
  standingAuthorizationId: string,
  windowId: string,
  windowInstanceKey: string,
): Promise<void> {
  await acquireMoneyPathLocks(client, {
    companyId,
    windowInstances: [{ windowId, windowInstanceKey }],
    includeStandingRows: true,
    includeJournalCounter: false,
  });
  await client.query(
    `UPDATE standing_window_exposure
        SET instance_in_scope = false
      WHERE company_id = $1 AND standing_authorization_id = $2
        AND window_id = $3 AND window_instance_key = $4`,
    [companyId, standingAuthorizationId, windowId, windowInstanceKey],
  );
}
