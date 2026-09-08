import { createPublicKey, verify as verifyEd25519 } from 'node:crypto';

import { inTransaction, type Client, type Pool } from '../../db/pool.js';
import type { ActionClass } from '../canonicalisation/actionCatalogue.js';
import { canonicalBytes, type CanonicalStructure } from '../canonicalisation/canonicalBytes.js';
import { toDb, fromDb, type Money } from '../exposure/money.js';
import type { OverrideScope } from './dispatchPrecedence.js';
import { evaluateStateOn } from './mirrorStateMachine.js';
import type { MirrorStateResolution } from './mirrorState.js';

/**
 * `30 §5.7.2` — `DegradedModeOverride`: THE ESCAPE, BOUNDED. S1H.
 *
 * =================================================================================
 * WHY THIS EXISTS, IN THE ARCHITECTURE'S OWN WORDS
 *
 * `30 §5.6`: "The residual, stated plainly. A **genuine two-sided outage** leaves the
 * system in `UNCORROBORATED_STALL`, suspending clock-bearing refunds while the FTC clock
 * runs. **That costs an owner override.**"
 *
 * `30 §5.1` item 5: "**The only escape from either the halt or `UNCORROBORATED_STALL`'s
 * row-3 suspension is a `DegradedModeOverride`** [...]. An override restores precedence rows
 * 3 and 4 only, never rows 1 or 2."
 *
 * `30 §5.7.2`, on why it is specified at all: "AUD-07's own words — *'the override is a
 * single act with no declared scope, no expiry and no cap'* — were still true, and the
 * ledger recorded AUD-07 as closed. **It is kernel state now.**"
 * =================================================================================
 *
 * =================================================================================
 * THE ONE THING THIS FILE CANNOT DO, AND IT IS STRUCTURAL RATHER THAN CHECKED
 *
 * `30 §5.7.2` semantics item 1: "**It changes no ceiling.** Every effect dispatched under it
 * still traverses the full policy sequence, still reserves, and is still bound by `I3`. The
 * override releases a **dispatch gate**, never an exposure gate. **`MAL_total` is unchanged
 * by an override's existence** and no re-signature is triggered."
 *
 * There is therefore NO STATEMENT ANYWHERE IN THIS MODULE that touches `window_balance`,
 * `window_registry`, `authority_grant`, `authority_grant_window`, `exposure_reservation`,
 * `standing_window_exposure` or `standing_authorization`. `override-cannot-widen-ceilings.
 * test.ts` asserts that three ways: as a source property over this file, as a schema
 * property over `degraded_mode_override`'s columns and foreign keys, and behaviourally, by
 * granting a maximum override and recomputing `MAL_monetary` before and after.
 *
 * `monetary_exposure_cap` is a CEILING ON THE OVERRIDE'S OWN CONSUMPTION, capped at $50.00
 * by `51 §3.6`, and `51 §3.6` states why that cannot leak: "every monetary and count
 * aggregate is **strictly below** the already-signed window ceiling it draws against:
 * `$100.00` against `W_MONTH_REFUND`'s `$250.00`, and 8 effects against its count of 10."
 * =================================================================================
 */

/**
 * `51 §3.6`, `DESIGN LIMIT — OWNER SIGNED`, transcribed from the fixture table.
 *
 * The database transcribes the same values into `degraded_mode_override_limits()`, and
 * `override-limits-agree.test.ts` asserts that these constants, that function and a
 * hand-authored third reading of `51 §3.6` all agree — so a drift between the application
 * and the CHECK constraints is a test failure rather than a silent relaxation.
 *
 * THESE ARE READ, NEVER WRITTEN. `50 §2` class 25 makes the limit set an owner-signed
 * control artifact — "Active overrides run to their existing caps; no new one may be granted
 * against an unverified limit set" — and `I19`'s runtime hash verification is OPEN, which
 * `S1H-result.md §16` carries forward.
 */
export const OVERRIDE_LIMITS = Object.freeze({
  /** `max_override_duration` */
  maxDurationMs: 24 * 60 * 60 * 1000,
  /** `max_override_effect_count` */
  maxEffectCount: 5n,
  /** `max_override_monetary_exposure`, in the `Money` scale-2 minor unit. */
  maxMonetaryExposure: 5000n as Money,
  /** `max_override_count(30-day rolling)` */
  maxCount: 3n,
  /** `max_cumulative_override_hours(30-day rolling)` */
  maxCumulativeHours: 72,
  /** `max_cumulative_override_effects(30-day rolling)` */
  maxCumulativeEffects: 8n,
  /** `max_cumulative_override_monetary(30-day rolling)` */
  maxCumulativeMonetary: 10000n as Money,
  /** `second_approver_required_from` — "the 2nd override inside a 30-day rolling window". */
  secondApproverRequiredFrom: 2n,
  /** The rolling window `I63(b)` and item 9 are both stated over. */
  compositionWindowDays: 30,
});

/** `30 §5.7.2`'s `recoverability_classes[] ⊆ { COMPENSABLE, REVERSIBLE }`. */
export type GrantableRecoverability = 'COMPENSABLE' | 'REVERSIBLE';

/** `30 §5.7.2`'s `precedence_rows[] ⊆ { 3, 4 }`. */
export type GrantablePrecedenceRow = 3 | 4;

export interface OverrideRequest {
  readonly companyId: string;
  readonly overrideId: string;
  readonly requestedBy: string;
  readonly requestedAt: Date;
  readonly effectClasses: readonly ActionClass[];
  readonly recoverabilityClasses: readonly GrantableRecoverability[];
  readonly precedenceRows: readonly GrantablePrecedenceRow[];
  readonly startsAt: Date;
  readonly expiresAt: Date;
  readonly effectCountCap: bigint;
  readonly monetaryExposureCap: Money;
  readonly reason: string;
  /** `30 §5.7.2`: "NOT NULL FK — the open incident it responds to." */
  readonly incidentRef: bigint;
}

/**
 * The fields an OWNER-tier principal's Ed25519 signature covers.
 *
 * `30 §5.7.2` item 7 requires the grant to be journaled and `26 §3` rule 1 gives the S1
 * mechanism for owner authority: "Each hop is signed by the delegating principal's key,
 * **held by the kernel, not by the model**." S1E built that — real Ed25519 over
 * `ACOS-JCS-1` bytes against `principal_key.public_key` — and this reuses it rather than
 * inventing a second owner-authority mechanism.
 *
 * THE SCOPE IS INSIDE THE SIGNATURE. Every bound the owner is consenting to — the classes,
 * the rows, the time box and both caps — is a signed field, so a handler that widened any
 * of them after the signature would produce a signature that no longer verifies. That is
 * what makes `§15`'s attack — "a compromised owner-action handler must not turn a mirror
 * override into a budget override" — fail on the cryptography and not only on the schema.
 */
export function overrideGrantFields(request: OverrideRequest): CanonicalStructure {
  return [
    { kind: 'text', value: request.overrideId },
    { kind: 'text', value: request.companyId },
    { kind: 'text', value: request.requestedBy },
    { kind: 'text', value: [...request.effectClasses].sort().join(',') },
    { kind: 'text', value: [...request.recoverabilityClasses].sort().join(',') },
    { kind: 'text', value: [...request.precedenceRows].sort().join(',') },
    { kind: 'timestamp', value: request.startsAt },
    { kind: 'timestamp', value: request.expiresAt },
    { kind: 'integer', value: request.effectCountCap },
    { kind: 'money', value: request.monetaryExposureCap },
    { kind: 'text', value: request.reason },
    { kind: 'integer', value: request.incidentRef },
  ];
}

export const OVERRIDE_GRANT_KIND = 'acos.degraded_mode_override.grant.v1';

export function overrideGrantBytes(request: OverrideRequest): Buffer {
  return canonicalBytes(OVERRIDE_GRANT_KIND, overrideGrantFields(request));
}

export const OVERRIDE_REFUSALS = [
  'OVERRIDE_PRINCIPAL_NOT_OWNER',
  'OVERRIDE_PRINCIPAL_HAS_NO_REGISTERED_KEY',
  'OVERRIDE_SIGNATURE_INVALID',
  'OVERRIDE_SCOPE_OUTSIDE_GRANT_PATH',
  'OVERRIDE_LIMIT_EXCEEDED',
] as const;

export type OverrideRefusal = (typeof OVERRIDE_REFUSALS)[number];

export class OverrideRefused extends Error {
  constructor(
    readonly refusal: OverrideRefusal,
    detail: string,
  ) {
    super(`${refusal}: ${detail}`);
    this.name = 'OverrideRefused';
  }
}

/**
 * Verify one OWNER-tier signature over the grant.
 *
 * `24 §3` K10 on what may NOT do this: an AI role "may not [...] Suppress, close, downgrade
 * urgency, or reset a clock", and `26 §3`'s principal kinds separate `OWNER` from `AI_ROLE`,
 * `KERNEL_SERVICE`, `ADAPTER` and `AUDIT_REVIEWER`. The `kind = 'OWNER'` test below and the
 * database trigger in `0009__mirror_state.sql` both enforce it, so neither is the only
 * mechanism — `36 §0`'s rule about single-mechanism properties.
 *
 * THERE IS NO `isOwner` PARAMETER ANYWHERE IN THIS MODULE. The principal id is resolved
 * against `principal`, its key is read from `principal_key`, and the signature is verified
 * with `node:crypto`. A caller can name a principal; it cannot assert one is an owner.
 */
async function requireOwnerSignature(
  client: Client,
  companyId: string,
  principalId: string,
  bytes: Buffer,
  signature: Buffer,
): Promise<void> {
  const row = await client.query<{ kind: string; status: string; public_key: Buffer | null }>(
    `SELECT p.kind, p.status, k.public_key
       FROM principal p
       LEFT JOIN principal_key k
              ON k.company_id = p.company_id AND k.principal_id = p.principal_id
      WHERE p.company_id = $1 AND p.principal_id = $2`,
    [companyId, principalId],
  );
  const principal = row.rows[0];
  if (principal === undefined || principal.kind !== 'OWNER' || principal.status !== 'ACTIVE') {
    throw new OverrideRefused(
      'OVERRIDE_PRINCIPAL_NOT_OWNER',
      `${principalId} is not an ACTIVE OWNER-tier principal (30 §5.7.2)`,
    );
  }
  if (principal.public_key === null) {
    throw new OverrideRefused(
      'OVERRIDE_PRINCIPAL_HAS_NO_REGISTERED_KEY',
      `${principalId} has no registered key, so its consent is unverifiable (26 §3 rule 1)`,
    );
  }
  let ok: boolean;
  try {
    ok = verifyEd25519(
      null,
      bytes,
      createPublicKey({ key: principal.public_key, format: 'der', type: 'spki' }),
      signature,
    );
  } catch {
    // The only safe reading of "we could not verify this" is "this is not verified" — the
    // rule `principal.ts` applies to a delegation hop.
    ok = false;
  }
  if (!ok) {
    throw new OverrideRefused(
      'OVERRIDE_SIGNATURE_INVALID',
      `${principalId}'s Ed25519 signature does not verify over the grant's canonical bytes`,
    );
  }
}

/**
 * `30 §5.7.2`'s SCOPE RULE, checked before the write reaches the database.
 *
 * "`recoverability_classes[]` therefore excludes `IRRECOVERABLE` **structurally at MVP, not
 * by policy**: there is no grant path that admits it." The database CHECK is the structural
 * half; this is the half that produces a legible refusal rather than a constraint violation,
 * and `vc-a2e-override.test.ts` asserts BOTH — an application call is refused here, and a
 * direct INSERT is refused by the CHECK.
 */
function requireGrantableScope(request: OverrideRequest): void {
  const badRecoverability = request.recoverabilityClasses.filter(
    (c) => c !== 'COMPENSABLE' && c !== 'REVERSIBLE',
  );
  if (badRecoverability.length > 0) {
    throw new OverrideRefused(
      'OVERRIDE_SCOPE_OUTSIDE_GRANT_PATH',
      `recoverability_classes ⊆ { COMPENSABLE, REVERSIBLE } (51 §3.6); got ` +
        `${badRecoverability.join(', ')}`,
    );
  }
  const badRows = request.precedenceRows.filter((r) => r !== 3 && r !== 4);
  if (badRows.length > 0) {
    throw new OverrideRefused(
      'OVERRIDE_SCOPE_OUTSIDE_GRANT_PATH',
      'an override restores precedence rows 3 and 4 only, never rows 1 or 2 ' +
        `(30 §5.1 item 5); got row ${badRows.join(', ')}`,
    );
  }
  if (request.effectClasses.length === 0 || request.recoverabilityClasses.length === 0) {
    throw new OverrideRefused(
      'OVERRIDE_SCOPE_OUTSIDE_GRANT_PATH',
      'an override with an empty scope grants nothing and bounds nothing',
    );
  }
  const durationMs = request.expiresAt.getTime() - request.startsAt.getTime();
  if (durationMs <= 0 || durationMs > OVERRIDE_LIMITS.maxDurationMs) {
    throw new OverrideRefused(
      'OVERRIDE_LIMIT_EXCEEDED',
      `expires_at − starts_at is ${String(durationMs)}ms; 51 §3.6's ` +
        `max_override_duration is ${String(OVERRIDE_LIMITS.maxDurationMs)}ms`,
    );
  }
  if (request.effectCountCap <= 0n || request.effectCountCap > OVERRIDE_LIMITS.maxEffectCount) {
    throw new OverrideRefused(
      'OVERRIDE_LIMIT_EXCEEDED',
      `effect_count_cap ${String(request.effectCountCap)} against 51 §3.6's ` +
        `max_override_effect_count ${String(OVERRIDE_LIMITS.maxEffectCount)}`,
    );
  }
  if (
    request.monetaryExposureCap < 0n ||
    request.monetaryExposureCap > OVERRIDE_LIMITS.maxMonetaryExposure
  ) {
    throw new OverrideRefused(
      'OVERRIDE_LIMIT_EXCEEDED',
      `monetary_exposure_cap ${toDb(request.monetaryExposureCap)} against 51 §3.6's ` +
        `max_override_monetary_exposure ${toDb(OVERRIDE_LIMITS.maxMonetaryExposure)}`,
    );
  }
}

export interface GrantOutcome {
  readonly overrideId: string;
  readonly requestedJournalSeq: bigint;
  readonly grantedJournalSeq: bigint;
  readonly secondApprovedJournalSeq: bigint | null;
}

/**
 * Request and grant an override in one transaction, with real owner signatures.
 *
 * `30 §5.7.2` item 7 journals "Creation, grant, second approval [...] each as its own row",
 * so this emits two or three `DEGRADED_MODE_OVERRIDE_EVENT` rows rather than one.
 *
 * `30 §5.7.2` item 9's SECOND-APPROVER RULE is enforced by the database trigger, which is
 * where it belongs: the ordinal depends on the rolling window and must be computed under the
 * same lock as the insert. This function's job is to carry a SECOND SIGNATURE when one is
 * supplied, so the second approver's consent is cryptographic and not a field a handler
 * could fill in. `51 §3.6`'s honest consequence is preserved: at MVP one OWNER-tier
 * principal is registered, so a second grant inside 30 days has no valid second approver
 * available and is refused — which is the intended cost, not a bug.
 */
export async function grantOverride(
  control: Pool,
  request: OverrideRequest,
  grant: {
    readonly grantedBy: string;
    readonly grantedAt: Date;
    readonly grantSignature: Buffer;
    readonly secondApprover?: string;
    readonly secondApprovedAt?: Date;
    readonly secondApproverSignature?: Buffer;
  },
): Promise<GrantOutcome> {
  requireGrantableScope(request);
  const bytes = overrideGrantBytes(request);

  const client = await control.connect();
  try {
    return await inTransaction(client, 'READ COMMITTED', async (tx) => {
      await requireOwnerSignature(
        tx,
        request.companyId,
        grant.grantedBy,
        bytes,
        grant.grantSignature,
      );
      if (grant.secondApprover !== undefined) {
        if (grant.secondApproverSignature === undefined) {
          throw new OverrideRefused(
            'OVERRIDE_SIGNATURE_INVALID',
            'a second approver was named with no signature; a named approver who signed ' +
              'nothing has approved nothing (30 §5.7.2 item 9)',
          );
        }
        await requireOwnerSignature(
          tx,
          request.companyId,
          grant.secondApprover,
          bytes,
          grant.secondApproverSignature,
        );
      }

      const requested = await tx.query<{ emit_degraded_mode_override_event: string }>(
        'SELECT emit_degraded_mode_override_event($1, $2, $3, $4, $5)',
        [request.companyId, request.overrideId, 'REQUESTED', request.requestedBy, request.requestedAt],
      );
      const granted = await tx.query<{ emit_degraded_mode_override_event: string }>(
        'SELECT emit_degraded_mode_override_event($1, $2, $3, $4, $5)',
        [request.companyId, request.overrideId, 'GRANTED', grant.grantedBy, grant.grantedAt],
      );
      let secondSeq: bigint | null = null;
      if (grant.secondApprover !== undefined) {
        const second = await tx.query<{ emit_degraded_mode_override_event: string }>(
          'SELECT emit_degraded_mode_override_event($1, $2, $3, $4, $5)',
          [
            request.companyId,
            request.overrideId,
            'SECOND_APPROVED',
            grant.secondApprover,
            grant.secondApprovedAt ?? grant.grantedAt,
          ],
        );
        secondSeq = BigInt(second.rows[0]!.emit_degraded_mode_override_event);
      }

      // The row. Every bound is a CHECK and `I63(b)` is a constraint trigger, so an
      // over-composing grant fails HERE rather than at a later evaluation.
      await tx.query(
        `INSERT INTO degraded_mode_override (
           company_id, override_id, requested_at, requested_by, granted_at, granted_by,
           second_approver, second_approved_at,
           effect_classes, recoverability_classes, precedence_rows,
           starts_at, expires_at, effect_count_cap, monetary_exposure_cap,
           reason, incident_ref, status
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,'ACTIVE')`,
        [
          request.companyId,
          request.overrideId,
          request.requestedAt,
          request.requestedBy,
          grant.grantedAt,
          grant.grantedBy,
          grant.secondApprover ?? null,
          grant.secondApprover === undefined ? null : (grant.secondApprovedAt ?? grant.grantedAt),
          [...request.effectClasses],
          [...request.recoverabilityClasses],
          [...request.precedenceRows],
          request.startsAt,
          request.expiresAt,
          request.effectCountCap.toString(),
          toDb(request.monetaryExposureCap),
          request.reason,
          request.incidentRef.toString(),
        ],
      );

      return {
        overrideId: request.overrideId,
        requestedJournalSeq: BigInt(requested.rows[0]!.emit_degraded_mode_override_event),
        grantedJournalSeq: BigInt(granted.rows[0]!.emit_degraded_mode_override_event),
        secondApprovedJournalSeq: secondSeq,
      };
    });
  } finally {
    client.release();
  }
}

// =====================================================================================
// READING AN ACTIVE OVERRIDE, FOR THE PURE CLASSIFIER
// =====================================================================================

interface OverrideRow {
  readonly override_id: string;
  readonly effect_classes: string[];
  readonly recoverability_classes: string[];
  readonly precedence_rows: number[];
  readonly starts_at: Date;
  readonly expires_at: Date;
  readonly effect_count_cap: string;
  readonly effects_dispatched: string;
  readonly status: string;
}

function toScope(row: OverrideRow): OverrideScope {
  return {
    overrideId: row.override_id,
    effectClasses: row.effect_classes,
    recoverabilityClasses: row.recoverability_classes,
    precedenceRows: row.precedence_rows,
    startsAt: row.starts_at,
    expiresAt: row.expires_at,
    effectCountCap: BigInt(row.effect_count_cap),
    effectsDispatched: BigInt(row.effects_dispatched),
    status: row.status,
  };
}

/**
 * The single override the classifier may consult, or `null`.
 *
 * Newest `starts_at` first among ACTIVE overrides currently inside `[starts_at, expires_at)`.
 * The DAY-one alternative — returning a set and letting the classifier pick — was rejected
 * because "which override authorised this" must be one answer for `30 §5.7.2` item 5's
 * `override_id` tag to mean anything, and because the aggregate bound `I63(b)` already keeps
 * the population small enough that overlap is a governance question rather than a
 * throughput one.
 */
export async function activeOverrideOn(
  client: Client,
  companyId: string,
  now: Date,
): Promise<OverrideScope | null> {
  const result = await client.query<OverrideRow>(
    `SELECT override_id, effect_classes, recoverability_classes, precedence_rows,
            starts_at, expires_at, effect_count_cap, effects_dispatched, status
       FROM degraded_mode_override
      WHERE company_id = $1 AND status = 'ACTIVE'
        AND starts_at <= $2 AND expires_at > $2
      ORDER BY starts_at DESC, override_id DESC
      LIMIT 1`,
    [companyId, now],
  );
  const row = result.rows[0];
  return row === undefined ? null : toScope(row);
}

// =====================================================================================
// CONSUMING THE ALLOWANCE — `I63(a)` AND `I63(b)`'s CONSUMABLE LEGS
// =====================================================================================

export type ClaimOutcome =
  /**
    * NOT `'CLAIMED'`. `25 §7` layer 4's outbox owns that literal — `I36`'s at-most-once
    * EXCLUSIVE CLAIM on an external effect — and
    * `local-authorisation-boundary.test.ts` forbids it in `src/` until the outbox exists.
    * What this outcome reports is `§18`'s "pre-dispatch override allowance", taken against
    * a counter. NOTHING IS TAKEN EXTERNALLY, and the name says so. The journal event
    * carries the same name for the same reason.
    */
  | { readonly kind: 'ALLOWANCE_TAKEN'; readonly journalSeq: bigint; readonly exhausted: boolean }
  | { readonly kind: 'REFUSED'; readonly reason: string };

/**
 * Claim ONE pre-dispatch allowance against an override.
 *
 * =================================================================================
 * NO EFFECT IS DISPATCHED. `§18` of the S1H mandate: "The test consumes the architecture's
 * pre-dispatch override allowance / claim as appropriate." This function increments
 * `effects_dispatched` and `monetary_dispatched`, which is `30 §5.7.2` item 3's "incremented
 * in the dispatching transaction" — the transaction that WOULD dispatch, in a slice that
 * has no dispatcher. There is no adapter call here and no `DISPATCHED` state anywhere.
 * =================================================================================
 *
 * `SELECT … FOR UPDATE` on the override row is what makes the count cap a real cap.
 * `30 §5.7.2` item 3: "reaching either cap moves the override to `EXHAUSTED` immediately."
 * Two concurrent claims for the last allowed effect must not both succeed, and
 * `override-count-race.test.ts` runs exactly that against real PostgreSQL with an injected
 * interleaving — `36 §14`'s rule that a race needs "targeted interleaving with injected
 * delays, not throughput".
 *
 * `I63(b)`'s consumable legs — `max_cumulative_override_effects` 8 and
 * `max_cumulative_override_monetary` $100.00 per rolling 30 days — are enforced by the
 * constraint trigger on the UPDATE, so the aggregate binds in this transaction exactly as
 * registry `I63` says: "evaluated in the granting **and the dispatching** transaction".
 */
/**
 * `I63(b)`'s CONSUMABLE legs, projected — the application half of the aggregate bound.
 *
 * =================================================================================
 * WHY THERE ARE TWO IMPLEMENTATIONS OF THIS, AND WHY NEITHER IS REDUNDANT
 *
 * Registry `I63`'s enforcement column is "**DB** (CHECK on the per-override counters +
 * trigger on the rolling aggregate, evaluated in the granting and the dispatching
 * transaction) **+ RUNTIME**". Both, not either.
 *
 * The TRIGGER is authoritative: it fires inside the same transaction as the counter update
 * and cannot be bypassed by any code path, including a direct `UPDATE`. What it cannot do is
 * refuse LEGIBLY — it raises, which aborts the transaction, and a caller cannot tell an
 * over-composition from a lost connection without parsing an error string.
 *
 * So this function computes the same bound BEFORE the update, and the claim returns
 * `REFUSED` with a reason. The trigger remains as the enforcement, and
 * `vc-a2f-override-composition.test.ts` exercises the trigger directly on the GRANT path
 * where no application pre-check exists.
 *
 * "ANY ROLLING 30-DAY WINDOW", implemented as the trigger implements it: for a finite set of
 * records every maximal window is anchored at some record's own `starts_at`, so checking
 * those checks all of them. A single look-back from the newest record would miss a violating
 * window anchored earlier, which is `30 §5.7.2` item 10's "expiry-and-recreation" evasion.
 * =================================================================================
 */
async function projectedAggregateBreach(
  client: Client,
  companyId: string,
  overrideId: string,
  addExposure: Money,
): Promise<string | null> {
  const rows = await client.query<{
    override_id: string;
    starts_at: Date;
    effects_dispatched: string;
    monetary_dispatched: string;
  }>(
    `SELECT override_id, starts_at, effects_dispatched, monetary_dispatched
       FROM degraded_mode_override
      WHERE company_id = $1`,
    [companyId],
  );

  const projected = rows.rows.map((r) => ({
    startsAtMs: r.starts_at.getTime(),
    effects: BigInt(r.effects_dispatched) + (r.override_id === overrideId ? 1n : 0n),
    monetary: fromDb(r.monetary_dispatched) + (r.override_id === overrideId ? addExposure : 0n),
  }));

  const windowMs = OVERRIDE_LIMITS.compositionWindowDays * 24 * 60 * 60 * 1000;
  for (const anchor of new Set(projected.map((p) => p.startsAtMs))) {
    const inside = projected.filter(
      (p) => p.startsAtMs >= anchor && p.startsAtMs < anchor + windowMs,
    );
    const effects = inside.reduce((sum, p) => sum + p.effects, 0n);
    const monetary = inside.reduce((sum, p) => sum + p.monetary, 0n as Money);
    if (effects > OVERRIDE_LIMITS.maxCumulativeEffects) {
      return (
        `I63(b): ${String(effects)} cumulative override effects in the rolling 30-day ` +
        `window from ${new Date(anchor).toISOString()}; 51 §3.6's ` +
        `max_cumulative_override_effects is ${String(OVERRIDE_LIMITS.maxCumulativeEffects)}`
      );
    }
    if (monetary > OVERRIDE_LIMITS.maxCumulativeMonetary) {
      return (
        `I63(b): ${toDb(monetary)} cumulative override exposure in the rolling 30-day ` +
        `window from ${new Date(anchor).toISOString()}; 51 §3.6's ` +
        `max_cumulative_override_monetary is ${toDb(OVERRIDE_LIMITS.maxCumulativeMonetary)}`
      );
    }
  }
  return null;
}

export async function claimOverrideAllowanceOn(
  client: Client,
  companyId: string,
  overrideId: string,
  exposure: Money,
  now: Date,
  hooks?: { readonly afterLock?: () => Promise<void> },
): Promise<ClaimOutcome> {
  const locked = await client.query<
    OverrideRow & { readonly monetary_exposure_cap: string; readonly monetary_dispatched: string }
  >(
    `SELECT override_id, effect_classes, recoverability_classes, precedence_rows,
            starts_at, expires_at, effect_count_cap, effects_dispatched, status,
            monetary_exposure_cap, monetary_dispatched
       FROM degraded_mode_override
      WHERE company_id = $1 AND override_id = $2
      FOR UPDATE`,
    [companyId, overrideId],
  );
  const row = locked.rows[0];
  if (row === undefined) {
    return { kind: 'REFUSED', reason: `no override ${overrideId} for ${companyId}` };
  }

  // The interleaving point. TEST-ONLY, and it is a hook rather than a sleep because
  // `36 §14` requires the race to be constructed rather than hoped for.
  if (hooks?.afterLock !== undefined) await hooks.afterLock();

  if (row.status !== 'ACTIVE') {
    return { kind: 'REFUSED', reason: `override ${overrideId} is ${row.status}, not ACTIVE` };
  }
  if (now.getTime() < row.starts_at.getTime() || now.getTime() >= row.expires_at.getTime()) {
    return {
      kind: 'REFUSED',
      reason:
        `now is outside [${row.starts_at.toISOString()}, ${row.expires_at.toISOString()}) — ` +
        'I63(a)`s time box',
    };
  }
  const cap = BigInt(row.effect_count_cap);
  const used = BigInt(row.effects_dispatched);
  if (used >= cap) {
    return {
      kind: 'REFUSED',
      reason: `effect_count_cap ${String(cap)} is already consumed (I63(a))`,
    };
  }
  const monetaryCap = fromDb(row.monetary_exposure_cap);
  const monetaryUsed = fromDb(row.monetary_dispatched);
  if (monetaryUsed + exposure > monetaryCap) {
    return {
      kind: 'REFUSED',
      reason:
        `monetary_exposure_cap ${toDb(monetaryCap)} would be exceeded: ` +
        `${toDb(monetaryUsed)} + ${toDb(exposure)} (I63(a))`,
    };
  }

  // `I63(b)`'s consumable legs, evaluated in the DISPATCHING transaction as registry `I63`
  // requires, and BEFORE the journal row: a refused claim is not an event.
  const aggregateBreach = await projectedAggregateBreach(
    client,
    companyId,
    overrideId,
    exposure,
  );
  if (aggregateBreach !== null) return { kind: 'REFUSED', reason: aggregateBreach };

  const emitted = await client.query<{ emit_degraded_mode_override_event: string }>(
    'SELECT emit_degraded_mode_override_event($1, $2, $3, $4, $5)',
    [companyId, overrideId, 'ALLOWANCE_TAKEN', 'KERNEL', now],
  );

  // The `degraded_mode_override_exhausts` trigger sets `EXHAUSTED` when either cap is
  // reached, so the status is derived by the database and not asserted here.
  const updated = await client.query<{ status: string }>(
    `UPDATE degraded_mode_override
        SET effects_dispatched = effects_dispatched + 1,
            monetary_dispatched = monetary_dispatched + $3::NUMERIC
      WHERE company_id = $1 AND override_id = $2
      RETURNING status`,
    [companyId, overrideId, toDb(exposure)],
  );

  const exhausted = updated.rows[0]!.status === 'EXHAUSTED';
  if (exhausted) {
    await client.query('SELECT emit_degraded_mode_override_event($1, $2, $3, $4, $5)', [
      companyId,
      overrideId,
      'EXHAUSTED',
      'KERNEL',
      now,
    ]);
  }

  return {
    kind: 'ALLOWANCE_TAKEN',
    journalSeq: BigInt(emitted.rows[0]!.emit_degraded_mode_override_event),
    exhausted,
  };
}

export async function claimOverrideAllowance(
  control: Pool,
  companyId: string,
  overrideId: string,
  exposure: Money,
  now: Date,
  hooks?: { readonly afterLock?: () => Promise<void> },
): Promise<ClaimOutcome> {
  const client = await control.connect();
  try {
    return await inTransaction(client, 'READ COMMITTED', (tx) =>
      claimOverrideAllowanceOn(tx, companyId, overrideId, exposure, now, hooks),
    );
  } finally {
    client.release();
  }
}

// =====================================================================================
// EXPIRY — `30 §5.7.2` ITEM 4
// =====================================================================================

export interface ExpiryOutcome {
  readonly expired: readonly string[];
  /**
   * `30 §5.7.2` item 4, verbatim: "Auto-expiry is to the restrictive state, **never to
   * `NORMAL`**. On `expires_at` or exhaustion the system returns to whichever of
   * `UNCORROBORATED_STALL` or full halt the underlying condition implies. **An override never
   * certifies that the mirror recovered.**"
   *
   * So expiry re-derives the state from the underlying operands — the open declaration and
   * the held corroboration — and never writes `NORMAL`. It CANNOT write `NORMAL`, because
   * `resolveMirrorState` returns `NORMAL` only when no declaration is open, and expiring an
   * override does not close a declaration. `vc-a2e-override.test.ts` asserts the resolved
   * state after expiry is `UNCORROBORATED_STALL` while the declaration stands.
   */
  readonly resolution: MirrorStateResolution;
}

/** Sweep expired overrides, journal each expiry, and re-derive the mirror state. */
export async function expireOverrides(
  control: Pool,
  companyId: string,
  now: Date,
): Promise<ExpiryOutcome> {
  const client = await control.connect();
  try {
    return await inTransaction(client, 'READ COMMITTED', async (tx) => {
      const due = await tx.query<{ override_id: string }>(
        `SELECT override_id FROM degraded_mode_override
          WHERE company_id = $1 AND status = 'ACTIVE' AND expires_at <= $2
          ORDER BY override_id
          FOR UPDATE`,
        [companyId, now],
      );
      const expired: string[] = [];
      for (const row of due.rows) {
        await tx.query('SELECT emit_degraded_mode_override_event($1, $2, $3, $4, $5)', [
          companyId,
          row.override_id,
          'EXPIRED',
          'KERNEL',
          now,
        ]);
        await tx.query(
          `UPDATE degraded_mode_override SET status = 'EXPIRED'
            WHERE company_id = $1 AND override_id = $2`,
          [companyId, row.override_id],
        );
        expired.push(row.override_id);
      }
      return { expired, resolution: await evaluateStateOn(tx, companyId, now) };
    });
  } finally {
    client.release();
  }
}

/** `30 §5.7.2`'s `REVOKED` status. Journaled, and it does not refund the aggregate. */
export async function revokeOverride(
  control: Pool,
  companyId: string,
  overrideId: string,
  actor: string,
  now: Date,
): Promise<void> {
  const client = await control.connect();
  try {
    await inTransaction(client, 'READ COMMITTED', async (tx) => {
      await tx.query('SELECT emit_degraded_mode_override_event($1, $2, $3, $4, $5)', [
        companyId,
        overrideId,
        'REVOKED',
        actor,
        now,
      ]);
      await tx.query(
        `UPDATE degraded_mode_override SET status = 'REVOKED'
          WHERE company_id = $1 AND override_id = $2`,
        [companyId, overrideId],
      );
    });
  } finally {
    client.release();
  }
}
