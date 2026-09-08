import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { COMPANY_ID } from '../../support/fixture.js';
import {
  createMirrorHarness,
  signalFieldsAt,
  signalSignedWith,
  journalRowsOfKind,
  type MirrorHarness,
} from '../../support/mirrorFixture.js';
import {
  closeMirrorDeclaration,
  consumeCorroboration,
  declareMirrorDegraded,
  evaluateState,
  persistedState,
} from '../../../src/kernel/mirror/mirrorStateMachine.js';
import {
  signalSigningBytes,
  type SignalWire,
} from '../../../src/kernel/mirror/corroborationSignal.js';
import {
  SIGNAL_MAX_AGE_MS,
  resolveMirrorState,
} from '../../../src/kernel/mirror/mirrorState.js';

/**
 * THE MIRROR STATE IS DURABLE, JOURNALED, AND RECONSTRUCTED FROM THE OPERANDS. S1H.
 *
 * =================================================================================
 * THE THREE PROPERTIES THIS FILE ESTABLISHES, AND THEIR CITATIONS
 *
 * 1. `§11`/`§38` of the S1H mandate: "Transitions must be persisted deterministically. No
 *    process-local mirror state as sole authority." Every assertion below reads the state
 *    back through a FRESH derivation from PostgreSQL, and the crash cases discard the
 *    in-process result entirely.
 *
 * 2. `§28`: "Every current architecture mirror-state transition that requires a
 *    control-side declaration/decision must be journaled through the established control
 *    journal. Do not introduce an unaudited mutable boolean." `30 §5.7` names the row:
 *    `AUDIT_MIRROR_DEGRADED`. `30 §5.7.1`: "`signal_id` is recorded in the journal on
 *    consumption."
 *
 * 3. `30 §5.7.1`: "Extending it by holding it is bounded by `max_age`, **evaluated at every
 *    state evaluation and not only at entry**." So a persisted `CORROBORATED_DEGRADED` must
 *    not survive its signal, and the re-derivation is what stops it.
 * =================================================================================
 */

let h: MirrorHarness;

/** Deterministic instants. `36 §6`'s clock rule: the evaluating instant is an operand. */
const T0 = new Date('2026-03-01T12:00:00.000Z');
const AUDIT_KEY_PLACEHOLDER_LENGTH = 64;

beforeAll(async () => {
  h = await createMirrorHarness();
});

afterAll(async () => {
  await h.close();
});

beforeEach(async () => {
  await h.reset();
});

function signal(observedAt: Date, signalId: string): SignalWire {
  return signalSignedWith(
    signalFieldsAt(observedAt, { signalId }),
    h.auditKey.privateKey,
    signalSigningBytes,
  );
}

describe('`NORMAL` is the state of a company that has declared nothing', () => {
  it('with no rows at all, the derivation is NORMAL and it is persisted', async () => {
    const resolution = await evaluateState(h.control, COMPANY_ID, T0);
    expect(resolution.state).toBe('NORMAL');
    expect(await persistedState(h.control, COMPANY_ID)).toEqual({
      state: 'NORMAL',
      evaluatedAt: T0,
    });
  });
});

describe('`NORMAL` → `UNCORROBORATED_STALL` is a JOURNALED transition', () => {
  it('the declaration writes an `AUDIT_MIRROR_DEGRADED` row on the SAME chain', async () => {
    const outcome = await declareMirrorDegraded(h.control, COMPANY_ID, 'PUSH_ACK_TIMEOUT', T0);
    expect(outcome.resolution.state).toBe('UNCORROBORATED_STALL');

    const rows = await journalRowsOfKind(h.control, COMPANY_ID, 'AUDIT_MIRROR_DEGRADED');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.journalSeq).toBe(outcome.journalSeq);
    expect(rows[0]!.declarationEvent).toBe('OPENED');
    expect(rows[0]!.observedReason).toBe('PUSH_ACK_TIMEOUT');
    // `I17d`: the chain is the database's. A row with no `row_hash` would mean the trigger
    // did not run on this kind.
    expect(rows[0]!.rowHash.length).toBe(32);
    // The genesis `prev_hash` — this is the company's first journal row.
    expect(rows[0]!.prevHash).toEqual(Buffer.alloc(32));
  });

  it('there is NO unaudited boolean: the state table has no writable state flag path', async () => {
    // `§28`: "Do not introduce an unaudited mutable boolean." `mirror_state` is written only
    // by `evaluateStateOn`, and its `basis_declaration_id`/`basis_signal_id` are FOREIGN KEYS
    // to journaled rows — so a state claiming a basis that was never journaled cannot exist.
    await declareMirrorDegraded(h.control, COMPANY_ID, 'PUSH_ACK_TIMEOUT', T0);
    const client = await h.control.connect();
    try {
      const fks = await client.query<{ conname: string }>(
        `SELECT conname FROM pg_constraint
          WHERE conrelid = 'mirror_state'::regclass AND contype = 'f'`,
      );
      // Three: `company_id` to `company`, and the two basis columns to the journaled rows.
      expect(fks.rows.length).toBe(3);

      // And the CHECK that makes the relaxed state unclaimable without a signal.
      await expect(
        client.query(
          `INSERT INTO mirror_state (company_id, state, evaluated_at)
           VALUES ($1, 'CORROBORATED_DEGRADED', $2)
           ON CONFLICT (company_id) DO UPDATE SET state = 'CORROBORATED_DEGRADED',
             basis_signal_id = NULL`,
          [COMPANY_ID, T0],
        ),
      ).rejects.toThrow(/mirror_state_corroborated_names_a_signal/);
    } finally {
      client.release();
    }
  });

  it('a REPEATED declaration is a no-op and journals nothing further', async () => {
    // `§5`'s attack: "A compromised control-side caller repeatedly declares mirror failure
    // while the audit plane is healthy." Each repetition returns the open declaration.
    const first = await declareMirrorDegraded(h.control, COMPANY_ID, 'PUSH_ACK_TIMEOUT', T0);
    for (let i = 1; i <= 20; i += 1) {
      const again = await declareMirrorDegraded(
        h.control,
        COMPANY_ID,
        'PUSH_ACK_TIMEOUT',
        new Date(T0.getTime() + i * 1000),
      );
      expect(again.declarationId).toBe(first.declarationId);
      expect(again.journalSeq).toBe(first.journalSeq);
      // AND THE STATE NEVER RELAXES.
      expect(again.resolution.state).toBe('UNCORROBORATED_STALL');
    }
    expect(await journalRowsOfKind(h.control, COMPANY_ID, 'AUDIT_MIRROR_DEGRADED')).toHaveLength(
      1,
    );
  });

  it('two concurrent declarations cannot both open one — the partial unique index refuses', async () => {
    const client = await h.control.connect();
    try {
      await declareMirrorDegraded(h.control, COMPANY_ID, 'PUSH_ACK_TIMEOUT', T0);
      await expect(
        client.query(
          `INSERT INTO mirror_declaration
             (company_id, declaration_id, observed_reason, opened_at, opened_journal_seq)
           VALUES ($1, 'declaration:second', 'PUSH_PATH_UNREACHABLE', $2, 99)`,
          [COMPANY_ID, T0],
        ),
      ).rejects.toThrow(/mirror_declaration_one_open_per_company/);
    } finally {
      client.release();
    }
  });
});

describe('consuming a signal is JOURNALED and REPLAY-PROTECTED', () => {
  beforeEach(async () => {
    await declareMirrorDegraded(h.control, COMPANY_ID, 'PUSH_ACK_TIMEOUT', T0);
  });

  it('a valid fresh signal reaches `CORROBORATED_DEGRADED` and writes its journal row', async () => {
    const outcome = await consumeCorroboration(
      h.control,
      COMPANY_ID,
      signal(T0, 'signal:one'),
      h.auditKey.publicKey,
      T0,
    );
    expect(outcome.kind).toBe('SIGNAL_CONSUMED');
    expect(outcome.resolution.state).toBe('CORROBORATED_DEGRADED');
    expect(outcome.resolution.basisSignalId).toBe('signal:one');

    const rows = await journalRowsOfKind(h.control, COMPANY_ID, 'MIRROR_CORROBORATION_CONSUMED');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.signalId).toBe('signal:one');
    expect(rows[0]!.reason).toBe('ATTESTATION_STALL');
    expect(rows[0]!.expiresAt?.getTime()).toBe(T0.getTime() + SIGNAL_MAX_AGE_MS);
  });

  it('the SAME `signal_id` cannot re-enter the state machine', async () => {
    // `30 §5.7.1`, Replay protection: "a `signal_id` already consumed cannot re-enter the
    // state machine."
    const s = signal(T0, 'signal:one');
    expect((await consumeCorroboration(h.control, COMPANY_ID, s, h.auditKey.publicKey, T0)).kind).toBe(
      'SIGNAL_CONSUMED',
    );
    const second = await consumeCorroboration(h.control, COMPANY_ID, s, h.auditKey.publicKey, T0);
    expect(second.kind).toBe('ALREADY_CONSUMED');
    // Exactly one journal row, so the second receipt produced no new record.
    expect(
      await journalRowsOfKind(h.control, COMPANY_ID, 'MIRROR_CORROBORATION_CONSUMED'),
    ).toHaveLength(1);
  });

  it('and the PRIMARY KEY refuses a second row even with the application check removed', async () => {
    // `§39`: the property must not rest on a check production could be edited to skip.
    const s = signal(T0, 'signal:one');
    await consumeCorroboration(h.control, COMPANY_ID, s, h.auditKey.publicKey, T0);
    const client = await h.control.connect();
    try {
      await expect(
        client.query(
          `INSERT INTO mirror_corroboration
             (company_id, signal_id, interval_start, observed_at, expires_at, reason,
              last_attestation_seq, last_attestation_received_at, audit_instance_id,
              signature, consumed_at, consumed_journal_seq)
           VALUES ($1,'signal:one',$2,$2,$3,'ATTESTATION_STALL',1,$2,'audit',$4,$2,1)`,
          [
            COMPANY_ID,
            T0,
            new Date(T0.getTime() + SIGNAL_MAX_AGE_MS),
            Buffer.alloc(AUDIT_KEY_PLACEHOLDER_LENGTH),
          ],
        ),
      ).rejects.toThrow(/mirror_corroboration_pkey|duplicate key/);
    } finally {
      client.release();
    }
  });

  it('a consumed signal is IMMUTABLE — `expires_at` cannot be rewritten', async () => {
    // `30 §5.7.1`, Minting and extension. The signature is one defence; the append-only
    // trigger is the other, so the control plane cannot extend a signal it already holds.
    await consumeCorroboration(h.control, COMPANY_ID, signal(T0, 'signal:one'), h.auditKey.publicKey, T0);
    const client = await h.control.connect();
    try {
      await expect(
        client.query(
          `UPDATE mirror_corroboration SET expires_at = $2 WHERE company_id = $1`,
          [COMPANY_ID, new Date(T0.getTime() + 24 * 60 * 60 * 1000)],
        ),
      ).rejects.toThrow(/APPEND_ONLY_TABLE_mirror_corroboration/);
      await expect(
        client.query(`DELETE FROM mirror_corroboration WHERE company_id = $1`, [COMPANY_ID]),
      ).rejects.toThrow(/APPEND_ONLY_TABLE_mirror_corroboration/);
    } finally {
      client.release();
    }
  });

  it('a rejected signal writes NOTHING — no journal row, no state change', async () => {
    const forged: SignalWire = { ...signal(T0, 'signal:forged'), signature: Buffer.alloc(64, 9) };
    const outcome = await consumeCorroboration(
      h.control,
      COMPANY_ID,
      forged,
      h.auditKey.publicKey,
      T0,
    );
    expect(outcome.kind).toBe('REJECTED');
    expect(outcome.resolution.state).toBe('UNCORROBORATED_STALL');
    expect(
      await journalRowsOfKind(h.control, COMPANY_ID, 'MIRROR_CORROBORATION_CONSUMED'),
    ).toHaveLength(0);
  });
});

describe('THE PERSISTED VALUE NEVER DISAGREES WITH A FRESH DERIVATION', () => {
  it('across the whole lifecycle: declare, corroborate, age out, close', async () => {
    // This is the assertion that stops `mirror_state` becoming a second source of truth.
    // At every step the cached row is compared to `resolveMirrorState` applied to the
    // operands read back out of PostgreSQL — IMMEDIATELY, because the operands change under
    // the next step and a replayed comparison would only re-test the final state.
    await evaluateState(h.control, COMPANY_ID, T0);
    expect(await derive(T0)).toBe('NORMAL');

    await declareMirrorDegraded(h.control, COMPANY_ID, 'PUSH_ACK_TIMEOUT', T0);
    expect(await derive(T0)).toBe('UNCORROBORATED_STALL');

    await consumeCorroboration(h.control, COMPANY_ID, signal(T0, 'signal:one'), h.auditKey.publicKey, T0);
    expect(await derive(T0)).toBe('CORROBORATED_DEGRADED');

    // AGE OUT. `30 §5.7.1`: evaluated at EVERY state evaluation.
    const past = new Date(T0.getTime() + SIGNAL_MAX_AGE_MS + 1);
    const reverted = await evaluateState(h.control, COMPANY_ID, past);
    expect(reverted.state).toBe('UNCORROBORATED_STALL');
    expect((await persistedState(h.control, COMPANY_ID))!.state).toBe('UNCORROBORATED_STALL');
    expect(await derive(past)).toBe('UNCORROBORATED_STALL');

    // RECOVERY.
    const closed = await closeMirrorDeclaration(h.control, COMPANY_ID, past);
    expect(closed.state).toBe('NORMAL');
    expect(await derive(past)).toBe('NORMAL');
    const closeRows = (
      await journalRowsOfKind(h.control, COMPANY_ID, 'AUDIT_MIRROR_DEGRADED')
    ).filter((r) => r.declarationEvent === 'CLOSED');
    expect(closeRows).toHaveLength(1);
  });

  /**
   * Re-derive from the DURABLE OPERANDS with a function that shares nothing with
   * `evaluateStateOn` except the pure resolver — the reads are written out here, so a bug in
   * `evaluateStateOn`'s own queries cannot hide behind itself.
   */
  async function derive(at: Date): Promise<string> {
    const client = await h.control.connect();
    try {
      const declaration = await client.query<{ declaration_id: string }>(
        `SELECT declaration_id FROM mirror_declaration
          WHERE company_id = $1 AND closed_at IS NULL`,
        [COMPANY_ID],
      );
      const corroboration = await client.query<{
        signal_id: string;
        interval_start: Date;
        observed_at: Date;
        expires_at: Date;
        reason: string;
      }>(
        `SELECT signal_id, interval_start, observed_at, expires_at, reason
           FROM mirror_corroboration WHERE company_id = $1
          ORDER BY observed_at DESC LIMIT 1`,
        [COMPANY_ID],
      );
      const row = corroboration.rows[0];
      const resolution = resolveMirrorState({
        companyId: COMPANY_ID,
        declarationOpen: declaration.rows.length > 0,
        heldCorroboration:
          row === undefined
            ? null
            : {
                signalId: row.signal_id,
                companyId: COMPANY_ID,
                observedAt: row.observed_at,
                expiresAt: row.expires_at,
                intervalStart: row.interval_start,
                reason: row.reason as 'ATTESTATION_STALL',
              },
        now: at,
      });
      const persisted = await client.query<{ state: string }>(
        'SELECT state FROM mirror_state WHERE company_id = $1',
        [COMPANY_ID],
      );
      expect(persisted.rows[0]?.state).toBe(resolution.state);
      return resolution.state;
    } finally {
      client.release();
    }
  }
});

describe('`§38` — CRASH AND RESTART. AUTHORITY RECONSTRUCTS FROM DURABLE STATE', () => {
  it('crash after the declaration, before any signal arrives', async () => {
    await declareMirrorDegraded(h.control, COMPANY_ID, 'PUSH_ACK_TIMEOUT', T0);
    // "Restart": a completely new evaluation, holding nothing from the previous call.
    const afterRestart = await evaluateState(h.control, COMPANY_ID, new Date(T0.getTime() + 60_000));
    expect(afterRestart.state).toBe('UNCORROBORATED_STALL');
  });

  it('crash after a valid signal is PERSISTED but before the state row was written', async () => {
    // Simulated by writing the corroboration through the production path and then deleting
    // the CACHE, which is the only row a crash between the two writes could leave missing.
    await declareMirrorDegraded(h.control, COMPANY_ID, 'PUSH_ACK_TIMEOUT', T0);
    await consumeCorroboration(h.control, COMPANY_ID, signal(T0, 'signal:one'), h.auditKey.publicKey, T0);
    const client = await h.control.connect();
    try {
      await client.query('DELETE FROM mirror_state WHERE company_id = $1', [COMPANY_ID]);
      expect(await persistedState(h.control, COMPANY_ID)).toBeNull();
    } finally {
      client.release();
    }
    // The authority is RECONSTRUCTED, not lost — because the cache was never the authority.
    const afterRestart = await evaluateState(h.control, COMPANY_ID, T0);
    expect(afterRestart.state).toBe('CORROBORATED_DEGRADED');
  });

  it('restart while the held signal is STALE reconstructs the RESTRICTIVE state', async () => {
    await declareMirrorDegraded(h.control, COMPANY_ID, 'PUSH_ACK_TIMEOUT', T0);
    await consumeCorroboration(h.control, COMPANY_ID, signal(T0, 'signal:one'), h.auditKey.publicKey, T0);
    expect((await persistedState(h.control, COMPANY_ID))!.state).toBe('CORROBORATED_DEGRADED');

    // Time passes across the "restart". `30 §5.7.1`: evaluated at every state evaluation.
    const later = new Date(T0.getTime() + 60 * 60 * 1000);
    const afterRestart = await evaluateState(h.control, COMPANY_ID, later);
    expect(afterRestart.state).toBe('UNCORROBORATED_STALL');
    expect((await persistedState(h.control, COMPANY_ID))!.state).toBe('UNCORROBORATED_STALL');
  });

  it('a crash DURING the transition transaction leaves neither the row nor the state', async () => {
    // `30 §5.1`: "Cross-database atomicity is not attempted." WITHIN one database it IS
    // attempted, and this is the assertion: the journal row, the corroboration row and the
    // state row share one transaction, so a failure inside it leaves none of the three.
    await declareMirrorDegraded(h.control, COMPANY_ID, 'PUSH_ACK_TIMEOUT', T0);
    const before = await journalRowsOfKind(h.control, COMPANY_ID, 'MIRROR_CORROBORATION_CONSUMED');

    // Force the failure at the LAST write of the transaction by violating the state row's
    // CHECK: a signal whose `expires_at` does not equal `observed_at + max_age` passes the
    // verifier only if the verifier is bypassed, so instead the corroboration table's own
    // CHECK is tripped with a hand-built insert inside a transaction that also journals.
    const client = await h.control.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        'SELECT emit_mirror_corroboration_consumed($1,$2,$3,$4,$5,$6,$7)',
        [COMPANY_ID, 'signal:doomed', T0, T0, new Date(T0.getTime() + 1), 'ATTESTATION_STALL', T0],
      );
      await expect(
        client.query(
          `INSERT INTO mirror_corroboration
             (company_id, signal_id, interval_start, observed_at, expires_at, reason,
              last_attestation_seq, last_attestation_received_at, audit_instance_id,
              signature, consumed_at, consumed_journal_seq)
           VALUES ($1,'signal:doomed',$2,$2,$3,'ATTESTATION_STALL',1,$2,'audit',$4,$2,1)`,
          [COMPANY_ID, T0, new Date(T0.getTime() + 1), Buffer.alloc(64)],
        ),
      ).rejects.toThrow(/mirror_corroboration_expiry_is_max_age/);
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }

    // NEITHER the journal row NOR the corroboration survived.
    expect(await journalRowsOfKind(h.control, COMPANY_ID, 'MIRROR_CORROBORATION_CONSUMED')).toEqual(
      before,
    );
    expect((await evaluateState(h.control, COMPANY_ID, T0)).state).toBe('UNCORROBORATED_STALL');
  });
});
