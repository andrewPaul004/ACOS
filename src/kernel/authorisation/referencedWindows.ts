import type { Client } from '../../db/pool.js';
import { ensureWindowInstance } from '../exposure/ledger.js';
import { instanceFor, type WindowInstance, type WindowPeriod } from '../exposure/windowInstance.js';
import { denyLocal } from './localAuthorisationErrors.js';

/**
 * EVERY referenced applicable window instance — step R's actual subject.
 *
 * `26 §7` step R, as restated by `phase2-v1.3.1-errata.md §1`, verbatim:
 *
 *   "Reserves `exposure.total_exposure` into the ordinary reservation term — `I3` term 1 —
 *    against EVERY named window instance the matching grants reference, taking each
 *    `window_balance` row `SELECT … FOR UPDATE` in ascending `window_id` and then the
 *    journal counter (`30 §5.2`'s declared lock order), and fails if ANY lacks headroom."
 *
 * The accepted S1E owner ruling (S1E-C4) settles which windows those are, verbatim:
 *
 *   "window sets compose by UNION and step R must reserve against every referenced
 *    applicable window; adding a matching grant may never widen."
 *
 * So the input here is the UNION `GrantResolver.resolveWindowRefs` already computed under
 * the held lease, and this module turns each `window_id` into the concrete INSTANCE that
 * contains the authorising instant.
 *
 * ---------------------------------------------------------------------------------
 * THERE IS NO PRIMARY WINDOW
 *
 * No first-match, no most-permissive, no "the tightest one is enough". Every entry in the
 * union produces a locked row and every locked row is evaluated by the four-term guard, and
 * an empty union DENIES — `NO_REFERENCED_WINDOW` — because an effect no window bounds is an
 * unbounded effect, which is the one thing `26 §10`'s authorised-loss quantities exist to
 * make impossible.
 *
 * ---------------------------------------------------------------------------------
 * WHERE THE INSTANT COMES FROM, AND WHAT IS DEFERRED
 *
 * `24 §3.1`, verbatim: a window instance is "keyed by `window_instance_key` — for example
 * `W_MONTH_ADSPEND:2026-01`, evaluated in the company timezone on the database clock."
 *
 * The COMPANY TIMEZONE and the WINDOW PERIOD are read from the database here — from
 * `company.timezone` and `window_registry.period` — so neither is caller-supplied and
 * neither can be influenced by a proposal. That is the half that decides which instance a
 * commitment lands in.
 *
 * The INSTANT is the kernel-owned injected `Clock`, not `SELECT now()`.
 * `phase2-v1.3-implementation-brief.md §3` excludes "any live clock — `I56`'s schema is S1;
 * live clocks are S5", and the accepted S1A `windowInstance.ts` states the same rule ("No
 * live clock. Every function here takes the instant as a parameter"). Reading the database
 * clock instead would be a second time source alongside the one S1A–S1E were built and
 * verified against. The residual — that `24 §3.1`'s "on the database clock" is satisfied by
 * an injected kernel clock rather than by `now()` — is recorded in
 * docs/implementation/S1F-result.md and is unchanged from S1A.
 *
 * The instance is NOT a parameter of the S1F entry point. There is no `windowInstances`
 * argument anywhere on the local-authorisation boundary, so a caller cannot choose the
 * instance its commitment lands in.
 * ---------------------------------------------------------------------------------
 */

export interface ReferencedWindowInstance {
  readonly windowId: string;
  readonly instance: WindowInstance;
  readonly period: WindowPeriod;
  readonly boundaryKind: 'DISCRETE' | 'ROLLING';
}

interface RegistryRow {
  readonly window_id: string;
  readonly period: string;
  readonly boundary_kind: string;
}

/**
 * Resolve every referenced `window_id` to its current instance, and materialise the
 * `window_balance` row.
 *
 * `ensureWindowInstance` runs here, BEFORE the declared lock order is entered — the
 * accepted S1A `ledger.ts` is explicit that it is "deliberately NOT a lock acquisition: it
 * runs before the declared lock order is entered", and two concurrent authorisations racing
 * to create the same fresh instance both succeed and then both queue on the same row in
 * step 1 of the order, which is where the serialisation belongs.
 */
export async function resolveReferencedWindowInstances(
  client: Client,
  companyId: string,
  windowRefs: readonly string[],
  at: Date,
): Promise<readonly ReferencedWindowInstance[]> {
  if (windowRefs.length === 0) {
    denyLocal(
      'R',
      'WINDOW_EXHAUSTED',
      'NO_REFERENCED_WINDOW',
      'the matching grants reference no named window, so nothing would bound this effect',
    );
  }

  const timezoneRows = await client.query<{ timezone: string }>(
    `SELECT timezone FROM company WHERE company_id = $1`,
    [companyId],
  );
  const timezoneRow = timezoneRows.rows[0];
  if (timezoneRow === undefined) {
    // Not a denial. Every earlier gate ran against this company's own state, so its
    // absence here is corruption rather than a condition a proposal can produce.
    throw new Error(`company ${companyId} has no row; the window instance has no timezone`);
  }
  const timezone = timezoneRow.timezone;

  const registry = await client.query<RegistryRow>(
    `SELECT window_id, period, boundary_kind
       FROM window_registry
      WHERE company_id = $1 AND window_id = ANY($2::TEXT[])`,
    [companyId, [...windowRefs]],
  );
  const byId = new Map(registry.rows.map((row) => [row.window_id, row] as const));

  const resolved: ReferencedWindowInstance[] = [];
  for (const windowId of windowRefs) {
    const row = byId.get(windowId);
    if (row === undefined) {
      // FAIL CLOSED. A grant referencing a window this company has not registered has an
      // UNKNOWN ceiling, and `26 §10.1` is explicit that an absent ceiling is a schema
      // violation rather than an unbounded one: "null is a schema violation, rejected at
      // catalogue validation."
      denyLocal(
        'R',
        'WINDOW_EXHAUSTED',
        'REFERENCED_WINDOW_NOT_REGISTERED',
        `window ${windowId} is referenced by a matching grant and is not registered for this company`,
      );
    }
    const instance = instanceFor(windowId, row.period as WindowPeriod, at, timezone);
    await ensureWindowInstance(client, companyId, instance);
    resolved.push({
      windowId,
      instance,
      period: row.period as WindowPeriod,
      boundaryKind: row.boundary_kind as 'DISCRETE' | 'ROLLING',
    });
  }
  return Object.freeze(resolved);
}
