import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { COMPANY_ID } from '../../support/fixture.js';
import {
  authorisePause,
  claimJournalRows,
  createOutboxHarness,
  outboxRows,
  type AuthorisedEffect,
  type OutboxHarness,
} from '../../support/outboxFixture.js';
import { enqueueDispatch } from '../../../src/kernel/outbox/enqueue.js';
import { claimForExternalDispatch } from '../../../src/kernel/outbox/claim.js';
import { unsafeReclaimableOutbox } from '../../negative-controls/unsafe-reclaimable-outbox.js';

/**
 * `§19`, `§22`, `§25` — THE OUTBOX STATE MACHINE, ATTACKED WITH DIRECT SQL.
 *
 * =================================================================================
 * WHY THE ATTACKS ARE SQL AND NOT API CALLS.
 *
 * `§25` of the S1I mandate: "Required DIRECT SQL attacks." Registry `I36`'s enforcement
 * column says "DB (state machine constraint)", so the property under test is a property of
 * the DATABASE and an assertion routed through `src/kernel/outbox/` would prove only that
 * the application does not attempt the write. Every case below issues the statement itself,
 * as the application role, against the running database.
 *
 * `25 §7`: a `CLAIMED` row "is never re-dispatched by any path — including recovery,
 * including a fork, including a manual replay." A DIRECT `UPDATE` is the manual replay.
 * =================================================================================
 */

let h: OutboxHarness;
const NOW = new Date('2026-09-05T10:05:00.000Z');
const LATER = new Date('2026-09-05T11:05:00.000Z');

beforeAll(async () => {
  h = await createOutboxHarness();
});

afterAll(async () => {
  await h.close();
});

beforeEach(async () => {
  await h.reset();
});

async function enqueuedPause(resourceId = 'CMP-S1I-IMMUT'): Promise<AuthorisedEffect> {
  const effect = await authorisePause(h, { resourceId });
  const outcome = await enqueueDispatch(h.control, {
    companyId: COMPANY_ID,
    effectId: effect.effectId,
    outboxId: `outbox:${resourceId}`,
    payloadCanonicalBytes: effect.payloadCanonicalBytes,
    now: NOW,
  });
  expect(outcome.kind).toBe('ENQUEUED');
  return effect;
}

async function claimed(resourceId = 'CMP-S1I-IMMUT'): Promise<AuthorisedEffect> {
  const effect = await enqueuedPause(resourceId);
  const result = await claimForExternalDispatch(h.control, {
    companyId: COMPANY_ID,
    idempotencyKey: effect.idempotencyKey,
    claimedBy: 'worker:immutability',
    now: NOW,
  });
  expect(result.kind).toBe('CLAIMED');
  return effect;
}

/** Issue one statement as the application role and report whether it was refused. */
async function attempt(sql: string, params: readonly unknown[]): Promise<string> {
  const client = await h.control.connect();
  try {
    await client.query(sql, [...params]);
    return 'ACCEPTED';
  } catch (error) {
    return `REFUSED:${String((error as { message?: string }).message ?? error)}`;
  } finally {
    client.release();
  }
}

describe('`§19` — THERE IS NO TRANSITION OUT OF `CLAIMED`, BY ANY STATEMENT', () => {
  it('a direct UPDATE back to ENQUEUED is refused', async () => {
    const effect = await claimed();
    const outcome = await attempt(
      `UPDATE dispatch_outbox
          SET status = 'ENQUEUED', claim_id = NULL, claimed_at = NULL, claimed_by = NULL,
              claim_matched_row = NULL, claim_mirror_state = NULL,
              claim_requires_unmirrored_tag = NULL
        WHERE company_id = $1 AND idempotency_key = $2`,
      [COMPANY_ID, effect.idempotencyKey],
    );
    expect(outcome).toMatch(/OUTBOX_ROW_ALREADY_CLAIMED/);
    expect((await outboxRows(h.control))[0]!.status).toBe('CLAIMED');
  });

  it('a direct UPDATE of the claim id — a "new attempt" — is refused', async () => {
    const effect = await claimed();
    const outcome = await attempt(
      `UPDATE dispatch_outbox SET claim_id = 'claim:second-attempt'
        WHERE company_id = $1 AND idempotency_key = $2`,
      [COMPANY_ID, effect.idempotencyKey],
    );
    expect(outcome).toMatch(/OUTBOX_ROW_ALREADY_CLAIMED/);
  });

  it('a direct UPDATE of `claimed_at` — a "lease renewal" — is refused', async () => {
    const effect = await claimed();
    const outcome = await attempt(
      `UPDATE dispatch_outbox SET claimed_at = $3
        WHERE company_id = $1 AND idempotency_key = $2`,
      [COMPANY_ID, effect.idempotencyKey, LATER],
    );
    expect(outcome).toMatch(/OUTBOX_ROW_ALREADY_CLAIMED/);
  });

  it('a DELETE is refused — on a claimed row AND on an enqueued one', async () => {
    /*
     * `§7`: a deleted row is a duplicate waiting to be re-enqueued under the same
     * idempotency key, which is exactly what the primary key exists to prevent. So DELETE
     * is refused on BOTH statuses, not only on `CLAIMED`.
     */
    const claimedEffect = await claimed('CMP-DEL-CLAIMED');
    const enqueuedEffect = await enqueuedPause('CMP-DEL-ENQUEUED');

    for (const key of [claimedEffect.idempotencyKey, enqueuedEffect.idempotencyKey]) {
      const outcome = await attempt(
        `DELETE FROM dispatch_outbox WHERE company_id = $1 AND idempotency_key = $2`,
        [COMPANY_ID, key],
      );
      expect(outcome).toMatch(/OUTBOX_ROW_UNDELETABLE/);
    }
    expect(await outboxRows(h.control)).toHaveLength(2);
  });

  it('and a TRUNCATE cannot be used to get around the trigger', async () => {
    // `TRUNCATE` does not fire row triggers, so the property has to be checked rather than
    // assumed. The application role is not the table's owner in production
    // (`33 §6`); at S1 the control plane runs as one role, so this asserts the SHAPE the
    // production deployment must preserve and `S1I-result.md §18` carries the residual.
    await claimed();
    const client = await h.control.connect();
    try {
      const owner = await client.query<{ tableowner: string; current: string }>(
        `SELECT tableowner, current_user AS current FROM pg_tables
          WHERE schemaname = 'public' AND tablename = 'dispatch_outbox'`,
      );
      // The condition under which `TRUNCATE` is reachable at all, recorded explicitly.
      expect(owner.rows[0]!.tableowner).toBe(owner.rows[0]!.current);
    } finally {
      client.release();
    }
  });

  it('NEGATIVE CONTROL: a conventional stale-lease reaper DOES return the row to READY', async () => {
    /*
     * `§39` OF THE MANDATE, and it is mandatory:
     *
     *   "Unsafe job-queue-style implementation: `CLAIMED for > N minutes → READY`. Then:
     *    1. claim; 2. simulate crash; 3. advance clock; 4. unsafe path reclaims.
     *    Production: does NOT. This test establishes that ACOS claims are not ordinary
     *    retryable queue leases."
     *
     * The unsafe reaper operates on its own copy of the row, because `0010`'s trigger would
     * refuse the write on the real one — which is the point being made: the trigger is what
     * makes ACOS's claim not a lease.
     */
    const effect = await claimed('CMP-REAPER');
    const wayLater = new Date(NOW.getTime() + 6 * 60 * 60 * 1000);

    const reaped = await unsafeReclaimableOutbox(h.control, {
      companyId: COMPANY_ID,
      idempotencyKey: effect.idempotencyKey,
      visibilityTimeoutMs: 5 * 60 * 1000,
      now: wayLater,
    });
    // THE CONTROL DISCRIMINATES: the unsafe reaper returns it to READY and re-issues a
    // claim.
    expect(reaped.reclaimed).toBe(true);
    expect(reaped.secondClaimIssued).toBe(true);

    // PRODUCTION DOES NOT. Six hours later, the row is still claimed, once.
    const production = await claimForExternalDispatch(h.control, {
      companyId: COMPANY_ID,
      idempotencyKey: effect.idempotencyKey,
      claimedBy: 'worker:after-timeout',
      now: wayLater,
    });
    expect(production.kind).toBe('REFUSED');
    if (production.kind === 'REFUSED') expect(production.reason).toBe('ALREADY_CLAIMED');
    expect((await outboxRows(h.control))[0]!.status).toBe('CLAIMED');
    expect(await claimJournalRows(h.control)).toHaveLength(1);
  });
});

describe('`§25` — A CLAIMED IDENTITY CANNOT BE REBOUND', () => {
  it('not to a different payload', async () => {
    const effect = await claimed();
    const outcome = await attempt(
      `UPDATE dispatch_outbox SET payload_canonical_bytes = $3
        WHERE company_id = $1 AND idempotency_key = $2`,
      [COMPANY_ID, effect.idempotencyKey, Buffer.from('a different payload')],
    );
    expect(outcome).toMatch(/OUTBOX_ROW_ALREADY_CLAIMED/);
    const row = (await outboxRows(h.control))[0]!;
    expect(row.payloadCanonicalBytes.equals(effect.payloadCanonicalBytes)).toBe(true);
  });

  it('not to a different correlation tag', async () => {
    const effect = await claimed();
    const before = (await outboxRows(h.control))[0]!.correlationTag;
    const outcome = await attempt(
      `UPDATE dispatch_outbox SET correlation_tag = 'acos-corr-substituted'
        WHERE company_id = $1 AND idempotency_key = $2`,
      [COMPANY_ID, effect.idempotencyKey],
    );
    expect(outcome).toMatch(/OUTBOX_ROW_ALREADY_CLAIMED/);
    expect((await outboxRows(h.control))[0]!.correlationTag).toBe(before);
  });

  it('not to a different effect, recoverability, company or tag requirement', async () => {
    const effect = await claimed();
    for (const [column, value] of [
      ['effect_id', 'effect:someone-elses'],
      ['recoverability', 'REVERSIBLE'],
      ['company_id', 'co_other'],
      ['claim_requires_unmirrored_tag', 'FALSE'],
      ['action_class', 'refund.create'],
      ['dispatch_payload_hash', 'deadbeef'],
      ['idempotency_key', 'idem:substituted'],
    ] as const) {
      const literal = value === 'FALSE' ? 'FALSE' : `'${value}'`;
      const outcome = await attempt(
        `UPDATE dispatch_outbox SET ${column} = ${literal}
          WHERE company_id = $1 AND idempotency_key = $2`,
        [COMPANY_ID, effect.idempotencyKey],
      );
      expect(outcome, column).toMatch(/OUTBOX_ROW_ALREADY_CLAIMED/);
    }
  });

  it('and an ENQUEUED row cannot be rebound either — only claimed', async () => {
    /*
     * `§22`: "Any state transition leaving CLAIMED must be one current architecture
     * explicitly permits." The converse also has to hold: an `ENQUEUED` row's identity is
     * as immutable as a claimed row's, or a caller could swap the payload in the window
     * before the claim and the async boundary would mean nothing.
     */
    const effect = await enqueuedPause('CMP-ENQ-IMMUT');
    for (const [column, literal] of [
      ['payload_canonical_bytes', `'\\x00'::BYTEA`],
      ['correlation_tag', `'acos-corr-swapped'`],
      ['effect_id', `'effect:elsewhere'`],
      ['recoverability', `'REVERSIBLE'`],
      ['dispatch_payload_hash', `'deadbeef'`],
    ] as const) {
      const outcome = await attempt(
        `UPDATE dispatch_outbox SET ${column} = ${literal}
          WHERE company_id = $1 AND idempotency_key = $2`,
        [COMPANY_ID, effect.idempotencyKey],
      );
      // Either the identity guard or the payload↔hash CHECK refuses it. Both are
      // acceptable refusals and neither is an acceptance.
      expect(outcome, column).toMatch(
        /OUTBOX_IDENTITY_IMMUTABLE|OUTBOX_TRANSITION_UNDECLARED|dispatch_outbox_payload_binds_hash|violates foreign key/,
      );
    }
    const row = (await outboxRows(h.control))[0]!;
    expect(row.payloadCanonicalBytes.equals(effect.payloadCanonicalBytes)).toBe(true);
    expect(row.status).toBe('ENQUEUED');
  });
});

describe('`§22` — THE DECLARED STATE MACHINE, AND NOTHING ELSE', () => {
  it('an UPDATE to any undeclared status is refused', async () => {
    const effect = await enqueuedPause('CMP-STATES');
    for (const status of [
      'RETRY_READY',
      'EXPIRED_CLAIM',
      'RECLAIMABLE',
      'AUTO_RETRY',
      'DISPATCHED',
      'PRESUMED_EXECUTED',
      'VERIFIED',
      'NEVER_SENT',
    ]) {
      const outcome = await attempt(
        `UPDATE dispatch_outbox SET status = $3
          WHERE company_id = $1 AND idempotency_key = $2`,
        [COMPANY_ID, effect.idempotencyKey, status],
      );
      // The CHECK refuses the value, or the trigger refuses the transition. `§22`: "Do not
      // invent RETRY_READY, EXPIRED_CLAIM, RECLAIMABLE, AUTO_RETRY if they are not
      // architecture-defined."
      expect(outcome, status).toMatch(
        /dispatch_outbox_status_declared|OUTBOX_TRANSITION_UNDECLARED/,
      );
    }
    expect((await outboxRows(h.control))[0]!.status).toBe('ENQUEUED');
  });

  it('the status domain read out of the running database is exactly two values', async () => {
    const client = await h.control.connect();
    try {
      const check = await client.query<{ def: string }>(
        `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
          WHERE conrelid = 'dispatch_outbox'::regclass
            AND conname = 'dispatch_outbox_status_declared'`,
      );
      // Read from the CATALOGUE, not from the migration file: a test that parsed the `.sql`
      // would pass whether or not the migration was applied.
      const def = check.rows[0]!.def;
      const values = [...def.matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]);
      expect(new Set(values)).toEqual(new Set(['ENQUEUED', 'CLAIMED']));
    } finally {
      client.release();
    }
  });

  it('and there is no `claim_expires_at`, no lease column and no attempt counter', async () => {
    const client = await h.control.connect();
    try {
      const columns = await client.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'dispatch_outbox'`,
      );
      const names = columns.rows.map((r) => r.column_name);
      for (const forbidden of [
        'claim_expires_at',
        'visible_at',
        'lease_expires_at',
        'attempt_count',
        'retry_count',
        'next_attempt_at',
        'dispatched_at',
        'eligible',
        'eligible_at_enqueue',
        'dispatch_eligible',
      ]) {
        expect(names, forbidden).not.toContain(forbidden);
      }
    } finally {
      client.release();
    }
  });
});

describe('`§35` — THE CARRIED-FORWARD `mirror_declaration.opened_at` RESIDUAL', () => {
  it('no ordinary production path can change `opened_at`, and S1I widened nothing', async () => {
    /*
     * `§35` OF THE S1I MANDATE, verbatim: "Carry forward S1H's disclosed residual:
     * `mirror_declaration.opened_at` relies on the migration/DDL principal boundary rather
     * than a row immutability trigger. Do not silently broaden runtime UPDATE access. Add/
     * retain a source/role regression asserting no ordinary production role/path can change
     * `opened_at`."
     *
     * TWO HALVES, AND BOTH ARE CHECKED.
     *
     * THE SOURCE HALF: no module in `src/` issues an `UPDATE` that names `opened_at`. S1I
     * adds `src/kernel/outbox/`, which reads the mirror state through
     * `mirrorDispatchOperandsOn` and writes nothing to any mirror table.
     *
     * THE RESIDUAL IS UNCHANGED AND IS NOT SOLVED HERE. `§35`: "Do not attempt to solve the
     * globally trusted DDL-principal threat in S1I. That belongs to the higher-trust/
     * supply-chain/anchoring work." `S1I-result.md §18` carries it forward.
     */
    const { readFile, readdir } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const root = join(process.cwd(), 'src');
    const offenders: string[] = [];
    const walk = async (dir: string): Promise<void> => {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(full);
        } else if (entry.name.endsWith('.ts')) {
          const code = (await readFile(full, 'utf8'))
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/(^|[^:])\/\/.*$/gm, '$1');
          /*
           * THE ACCEPTED S1H `closeMirrorDeclaration` DOES issue `UPDATE
           * mirror_declaration SET closed_at = ...`, and `30 §5.1a` requires it: "leaving
           * the degraded path journals the close and sets `closed_at`." So the property is
           * NOT "no UPDATE to the table" — it is that no UPDATE names `opened_at`, which
           * is the column the FULL-HALT timer reads and the one `§35`'s residual is about.
           *
           * Each `UPDATE mirror_declaration` statement is examined up to its terminating
           * backtick, so the check is over the STATEMENT rather than over the file.
           */
          for (const match of code.matchAll(/UPDATE\s+mirror_declaration[^`]*/gi)) {
            if (/opened_at/.test(match[0])) {
              offenders.push(`${full} (UPDATE ... SET opened_at)`);
            }
          }
        }
      }
    };
    await walk(root);
    expect(
      offenders,
      `a production path writes mirror_declaration.opened_at:\n  ${offenders.join('\n  ')}`,
    ).toEqual([]);

    // And the outbox directory in particular writes to no mirror table at all.
    const outboxDir = join(root, 'kernel', 'outbox');
    for (const entry of await readdir(outboxDir)) {
      const code = await readFile(join(outboxDir, entry), 'utf8');
      const stripped = code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
      expect(stripped, entry).not.toMatch(/INSERT\s+INTO\s+mirror_/i);
      expect(stripped, entry).not.toMatch(/UPDATE\s+mirror_/i);
      expect(stripped, entry).not.toMatch(/DELETE\s+FROM\s+mirror_/i);
      // The override counters ARE written, through the ACCEPTED S1H function, and not by
      // SQL in this directory. `§31`: the consumption is atomic with the claim.
      expect(stripped, entry).not.toMatch(/UPDATE\s+degraded_mode_override/i);
    }
  });
});
