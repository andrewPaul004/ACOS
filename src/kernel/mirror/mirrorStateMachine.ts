import { randomUUID, type KeyObject } from 'node:crypto';

import { inTransaction, type Client, type Pool } from '../../db/pool.js';
import {
  verifyCorroborationSignal,
  type SignalRejection,
  type SignalWire,
} from './corroborationSignal.js';
import {
  resolveMirrorState,
  type HeldCorroboration,
  type MirrorState,
  type MirrorStateResolution,
} from './mirrorState.js';
import type { CorroborationSignalSource } from './signalSource.js';

/**
 * `30 §5.6` — THE MIRROR STATE MACHINE, DURABLE. S1H.
 *
 * =================================================================================
 * WHAT IS AUTHORITATIVE HERE, AND WHAT IS A CACHE.
 *
 * AUTHORITATIVE: `mirror_declaration` (the control-side observation, journaled as
 * `AUDIT_MIRROR_DEGRADED`) and `mirror_corroboration` (the consumed, cryptographically
 * verified signals). Both are durable, both are journaled, and both are append-only apart
 * from a declaration's single closing update.
 *
 * A CACHE: `mirror_state`. It is written in the same transaction as the journal row that
 * caused the transition so a restart has a reading, and `evaluateState` RE-DERIVES it from
 * the operands on every call rather than reading it. `mirror-state-durability.test.ts`
 * asserts the two never disagree.
 *
 * The reason the cache cannot be authoritative is `30 §5.7.1`'s own instruction:
 * "Extending [a signal's] life by holding it is bounded by `max_age`, **evaluated at every
 * state evaluation and not only at entry**." A stored `CORROBORATED_DEGRADED` that was
 * trusted on read would be a state that outlived its corroboration, which is TA-06's
 * defect exactly.
 *
 * NO PROCESS-LOCAL STATE. There is no module-level variable in this file. Every function
 * takes a pool or a client and reads the operands from PostgreSQL. `§38`'s restart cases
 * construct a fresh module graph and assert the same authority.
 * =================================================================================
 */

/** `mirror_declaration.observed_reason`'s closed enum. The control plane's own observation. */
export const MIRROR_OBSERVATIONS = [
  'PUSH_ACK_TIMEOUT',
  'PUSH_PATH_UNREACHABLE',
  'AUDIT_STORE_WRITE_REJECTED',
] as const;

export type MirrorObservation = (typeof MIRROR_OBSERVATIONS)[number];

// =====================================================================================
// READING THE DURABLE OPERANDS
// =====================================================================================

interface DeclarationRow {
  readonly declaration_id: string;
}

async function openDeclaration(client: Client, companyId: string): Promise<string | null> {
  const result = await client.query<DeclarationRow>(
    `SELECT declaration_id FROM mirror_declaration
      WHERE company_id = $1 AND closed_at IS NULL`,
    [companyId],
  );
  return result.rows[0]?.declaration_id ?? null;
}

interface CorroborationRow {
  readonly signal_id: string;
  readonly interval_start: Date;
  readonly observed_at: Date;
  readonly expires_at: Date;
  readonly reason: string;
}

/**
 * The NEWEST consumed signal.
 *
 * Newest by `observed_at`, not by `consumed_at`: `30 §5.7.1`'s freshness rule is stated over
 * `observed_at`, and a control plane that consumed an older issuance later must not thereby
 * make it look fresher than a newer one. Ordering by the consumption instant would let the
 * order of a replay decide which signal the state rests on.
 */
async function newestCorroboration(
  client: Client,
  companyId: string,
): Promise<HeldCorroboration | null> {
  const result = await client.query<CorroborationRow>(
    `SELECT signal_id, interval_start, observed_at, expires_at, reason
       FROM mirror_corroboration
      WHERE company_id = $1
      ORDER BY observed_at DESC, signal_id DESC
      LIMIT 1`,
    [companyId],
  );
  const row = result.rows[0];
  if (row === undefined) return null;
  return {
    signalId: row.signal_id,
    companyId,
    observedAt: row.observed_at,
    expiresAt: row.expires_at,
    intervalStart: row.interval_start,
    reason: row.reason as HeldCorroboration['reason'],
  };
}

/**
 * Resolve the state from durable operands at instant `now`, and persist the resolution.
 *
 * `now` is a parameter because `36 §6`'s clock rule makes the evaluating instant an operand
 * and because a 5-minute freshness bound asserted with a 5-minute sleep is a bound nobody
 * tests. Production passes the control database clock; the tests pass a chosen instant. The
 * comparison is identical either way.
 */
export async function evaluateStateOn(
  client: Client,
  companyId: string,
  now: Date,
): Promise<MirrorStateResolution> {
  const declarationId = await openDeclaration(client, companyId);
  const held = await newestCorroboration(client, companyId);

  const resolution = resolveMirrorState({
    companyId,
    declarationOpen: declarationId !== null,
    heldCorroboration: held,
    now,
  });

  await client.query(
    `INSERT INTO mirror_state
       (company_id, state, evaluated_at, basis_declaration_id, basis_signal_id)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (company_id) DO UPDATE
        SET state = EXCLUDED.state,
            evaluated_at = EXCLUDED.evaluated_at,
            basis_declaration_id = EXCLUDED.basis_declaration_id,
            basis_signal_id = EXCLUDED.basis_signal_id`,
    [
      companyId,
      resolution.state,
      resolution.evaluatedAt,
      resolution.state === 'NORMAL' ? null : declarationId,
      resolution.basisSignalId,
    ],
  );

  return resolution;
}

/** The same, in its own transaction. */
export async function evaluateState(
  control: Pool,
  companyId: string,
  now: Date,
): Promise<MirrorStateResolution> {
  const client = await control.connect();
  try {
    return await inTransaction(client, 'READ COMMITTED', (tx) =>
      evaluateStateOn(tx, companyId, now),
    );
  } finally {
    client.release();
  }
}

/**
 * The PERSISTED reading, without re-deriving. For the durability tests and for forensics.
 *
 * NOT FOR AUTHORITY. Every authority path calls `evaluateStateOn`, which re-derives. This
 * function exists so `mirror-state-durability.test.ts` can compare the two and fail if they
 * ever differ, which is the only reason to be able to read the cache at all.
 */
export async function persistedState(
  control: Pool,
  companyId: string,
): Promise<{ state: MirrorState; evaluatedAt: Date } | null> {
  const client = await control.connect();
  try {
    const result = await client.query<{ state: string; evaluated_at: Date }>(
      'SELECT state, evaluated_at FROM mirror_state WHERE company_id = $1',
      [companyId],
    );
    const row = result.rows[0];
    if (row === undefined) return null;
    return { state: row.state as MirrorState, evaluatedAt: row.evaluated_at };
  } finally {
    client.release();
  }
}

// =====================================================================================
// `NORMAL` → `UNCORROBORATED_STALL`: THE CONTROL-SIDE DECLARATION
// =====================================================================================

export interface DeclarationOutcome {
  readonly declarationId: string;
  readonly journalSeq: bigint;
  readonly resolution: MirrorStateResolution;
}

/**
 * Journal `AUDIT_MIRROR_DEGRADED` and open a declaration.
 *
 * =================================================================================
 * THIS IS THE MOVE A COMPROMISED CONTROL PLANE WANTS TO MAKE, AND IT IS UNGATED ON PURPOSE.
 *
 * `30 §5.6`: "**The uncorroborated state is stricter than normal operation, not looser.** A
 * control plane that unilaterally declares a problem thereby **loses** the relaxation it was
 * declaring in order to obtain — it suspends the very refunds Path B wanted to dispatch.
 * **There is no longer anything to gain by lying, so the transition does not need to be
 * gated against a lie.**"
 *
 * So there is no authority check on this function, and adding one would be a
 * misunderstanding of the mechanism rather than a hardening of it. What makes it safe is
 * that `resolveMirrorState` cannot reach `CORROBORATED_DEGRADED` from a declaration alone,
 * and `classifyDispatchPrecedence` makes `UNCORROBORATED_STALL` equal-or-stricter than
 * `NORMAL` for every operand combination — which `vc-a2-inversion.test.ts` proves over the
 * whole cross-product and `vc-a2-self-declared-degradation.test.ts` proves DISCRIMINATES,
 * by showing an unsafe state machine that reaches the relaxed state from the same input.
 * =================================================================================
 *
 * Idempotent on an already-open declaration: `mirror_declaration_one_open_per_company` makes
 * two concurrent declarations impossible, and re-declaring an open condition returns the
 * open one rather than raising. A repeated declaration is `§5`'s attack — "a compromised
 * control-side caller repeatedly declares mirror failure while the audit plane is healthy" —
 * and the answer to it is that each repetition is a no-op that leaves the system in the
 * stricter state.
 */
export async function declareMirrorDegraded(
  control: Pool,
  companyId: string,
  observation: MirrorObservation,
  at: Date,
): Promise<DeclarationOutcome> {
  const client = await control.connect();
  try {
    return await inTransaction(client, 'READ COMMITTED', async (tx) => {
      const existing = await tx.query<{ declaration_id: string; opened_journal_seq: string }>(
        `SELECT declaration_id, opened_journal_seq FROM mirror_declaration
          WHERE company_id = $1 AND closed_at IS NULL`,
        [companyId],
      );
      const open = existing.rows[0];
      if (open !== undefined) {
        return {
          declarationId: open.declaration_id,
          journalSeq: BigInt(open.opened_journal_seq),
          resolution: await evaluateStateOn(tx, companyId, at),
        };
      }

      const declarationId = randomUUID();
      const emitted = await tx.query<{ emit_mirror_declaration: string }>(
        'SELECT emit_mirror_declaration($1, $2, $3, $4, $5)',
        [companyId, declarationId, 'OPENED', observation, at],
      );
      const journalSeq = BigInt(emitted.rows[0]!.emit_mirror_declaration);

      await tx.query(
        `INSERT INTO mirror_declaration
           (company_id, declaration_id, observed_reason, opened_at, opened_journal_seq)
         VALUES ($1, $2, $3, $4, $5)`,
        [companyId, declarationId, observation, at, journalSeq.toString()],
      );

      return {
        declarationId,
        journalSeq,
        resolution: await evaluateStateOn(tx, companyId, at),
      };
    });
  } finally {
    client.release();
  }
}

/**
 * Close the declaration and journal the closing row.
 *
 * `30 §5.7.2` item 4 states the analogous rule for an override's expiry — "Auto-expiry is to
 * the restrictive state, never to `NORMAL`. [...] An override never certifies that the mirror
 * recovered." This is the OTHER act, the one that DOES certify recovery, and it is a
 * control-side observation like the opening: `30 §5.6`'s `NORMAL` row is "mirror
 * acknowledging within threshold", which only the control plane can observe.
 *
 * A closed declaration re-resolves to `NORMAL` whether or not a signal is still held, because
 * `NORMAL` is the row whose condition no longer mentions the signal. `§11`'s recovery case
 * "control declaration closes while current audit signal remains" is that path, and
 * `resolveMirrorState` reports it as the `SIGNAL_HELD_WITHOUT_DECLARATION` anomaly —
 * `I17f(b)`'s condition — rather than silently.
 */
export async function closeMirrorDeclaration(
  control: Pool,
  companyId: string,
  at: Date,
): Promise<MirrorStateResolution> {
  const client = await control.connect();
  try {
    return await inTransaction(client, 'READ COMMITTED', async (tx) => {
      const open = await tx.query<{ declaration_id: string }>(
        `SELECT declaration_id FROM mirror_declaration
          WHERE company_id = $1 AND closed_at IS NULL FOR UPDATE`,
        [companyId],
      );
      const declarationId = open.rows[0]?.declaration_id;
      if (declarationId !== undefined) {
        const emitted = await tx.query<{ emit_mirror_declaration: string }>(
          'SELECT emit_mirror_declaration($1, $2, $3, $4, $5)',
          [
            companyId,
            declarationId,
            'CLOSED',
            (
              await tx.query<{ observed_reason: string }>(
                `SELECT observed_reason FROM mirror_declaration
                  WHERE company_id = $1 AND declaration_id = $2`,
                [companyId, declarationId],
              )
            ).rows[0]!.observed_reason,
            at,
          ],
        );
        // `mirror_state.basis_declaration_id` references this row, so the cache must stop
        // pointing at it before the declaration is closed out of the resolution.
        await tx.query(
          `UPDATE mirror_state SET basis_declaration_id = NULL
            WHERE company_id = $1 AND basis_declaration_id = $2`,
          [companyId, declarationId],
        );
        await tx.query(
          `UPDATE mirror_declaration
              SET closed_at = $3, closed_journal_seq = $4
            WHERE company_id = $1 AND declaration_id = $2`,
          [companyId, declarationId, at, emitted.rows[0]!.emit_mirror_declaration],
        );
      }
      return await evaluateStateOn(tx, companyId, at);
    });
  } finally {
    client.release();
  }
}

// =====================================================================================
// `UNCORROBORATED_STALL` → `CORROBORATED_DEGRADED`: FETCH, VERIFY, CONSUME
// =====================================================================================

export type ConsumeOutcome =
  | {
      /**
       * NOT `'CONSUMED'`. `26 §12.2`'s approval lifecycle owns that literal and
       * `local-authorisation-boundary.test.ts` forbids it in `src/` until the resume path
       * exists. This is a consumed corroboration SIGNAL, which is a different fact.
       */
      readonly kind: 'SIGNAL_CONSUMED';
      readonly signalId: string;
      readonly journalSeq: bigint;
      readonly resolution: MirrorStateResolution;
    }
  | {
      readonly kind: 'ALREADY_CONSUMED';
      readonly signalId: string;
      readonly resolution: MirrorStateResolution;
    }
  | {
      readonly kind: 'REJECTED';
      readonly rejection: SignalRejection;
      readonly detail: string;
      readonly resolution: MirrorStateResolution;
    }
  | {
      /** `30 §5.6`'s reachability table: partition, audit store down, audit host down. */
      readonly kind: 'UNAVAILABLE';
      readonly detail: string;
      readonly resolution: MirrorStateResolution;
    }
  | { readonly kind: 'NO_SIGNAL'; readonly resolution: MirrorStateResolution };

/**
 * Fetch the audit plane's current signal, verify it, and consume it.
 *
 * =================================================================================
 * EVERY OUTCOME EXCEPT `CONSUMED` LEAVES THE STATE WHERE IT WAS, AND `resolution` IS
 * ALWAYS THE FRESHLY DERIVED VALUE.
 *
 * `30 §5.7.1`: "A signal failing either test **cannot enter the state machine**; the state
 * remains or reverts to `UNCORROBORATED_STALL`." So each branch returns the re-derivation
 * rather than an assumption about what the state now is — a caller cannot read `REJECTED`
 * and conclude anything about authority without the resolution beside it.
 *
 * `30 §5.7`: "An audit-plane observation the control plane cannot fetch does not unlock the
 * state; that is the fail-closed direction." `UNAVAILABLE` therefore does exactly what
 * `NO_SIGNAL` does, and there is no retry-until-success loop here that would turn a partition
 * into eventual corroboration.
 * =================================================================================
 */
export async function fetchAndConsumeCorroboration(
  control: Pool,
  source: CorroborationSignalSource,
  companyId: string,
  auditPublicKey: KeyObject,
  now: Date,
): Promise<ConsumeOutcome> {
  const fetched = await source.fetchCurrent(companyId);

  if (fetched.kind === 'UNAVAILABLE') {
    return {
      kind: 'UNAVAILABLE',
      detail: fetched.detail,
      resolution: await evaluateState(control, companyId, now),
    };
  }
  if (fetched.kind === 'NONE') {
    return { kind: 'NO_SIGNAL', resolution: await evaluateState(control, companyId, now) };
  }

  return consumeCorroboration(control, companyId, fetched.signal, auditPublicKey, now);
}

/**
 * Verify and consume one already-fetched signal.
 *
 * Separate from the fetch so `VC-A2d`'s eight adversarial artifacts can be handed straight
 * to the verifier without a transport in the way, and so the replay fixture can present the
 * SAME signal twice.
 */
export async function consumeCorroboration(
  control: Pool,
  companyId: string,
  signal: SignalWire,
  auditPublicKey: KeyObject,
  now: Date,
): Promise<ConsumeOutcome> {
  // Cryptography and freshness FIRST, and outside the transaction: an artifact that fails
  // `30 §5.7.1` must not reach a write path at all, and a rejected signal produces no
  // journal row because it is not a fact about this company's state.
  const verified = verifyCorroborationSignal(signal, companyId, auditPublicKey, now);
  if (!verified.ok) {
    return {
      kind: 'REJECTED',
      rejection: verified.rejection,
      detail: verified.detail,
      resolution: await evaluateState(control, companyId, now),
    };
  }

  const client = await control.connect();
  try {
    return await inTransaction(client, 'READ COMMITTED', async (tx) => {
      // `30 §5.7.1`, replay protection: "`signal_id` is recorded in the journal on
      // consumption; a `signal_id` already consumed cannot re-enter the state machine."
      //
      // The uniqueness is the PRIMARY KEY on `mirror_corroboration(company_id, signal_id)`,
      // so two concurrent consumptions of one signal cannot both write. This lookup is the
      // cooperative half; the constraint is the enforcing half, and `§39` forbids relying on
      // a check the production code could be edited to skip.
      const seen = await tx.query<{ signal_id: string }>(
        `SELECT signal_id FROM mirror_corroboration
          WHERE company_id = $1 AND signal_id = $2`,
        [companyId, signal.signalId],
      );
      if (seen.rows.length > 0) {
        return {
          kind: 'ALREADY_CONSUMED' as const,
          signalId: signal.signalId,
          resolution: await evaluateStateOn(tx, companyId, now),
        };
      }

      const emitted = await tx.query<{ emit_mirror_corroboration_consumed: string }>(
        'SELECT emit_mirror_corroboration_consumed($1, $2, $3, $4, $5, $6, $7)',
        [
          companyId,
          signal.signalId,
          signal.intervalStart,
          signal.observedAt,
          signal.expiresAt,
          signal.reason,
          now,
        ],
      );
      const journalSeq = BigInt(emitted.rows[0]!.emit_mirror_corroboration_consumed);

      await tx.query(
        `INSERT INTO mirror_corroboration
           (company_id, signal_id, interval_start, observed_at, expires_at, reason,
            last_attestation_seq, last_attestation_received_at, audit_instance_id,
            signature, consumed_at, consumed_journal_seq)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [
          companyId,
          signal.signalId,
          signal.intervalStart,
          signal.observedAt,
          signal.expiresAt,
          signal.reason,
          signal.lastAttestationSeq.toString(),
          signal.lastAttestationReceivedAt,
          signal.auditInstanceId,
          signal.signature,
          now,
          journalSeq.toString(),
        ],
      );

      return {
        kind: 'SIGNAL_CONSUMED' as const,
        signalId: signal.signalId,
        journalSeq,
        resolution: await evaluateStateOn(tx, companyId, now),
      };
    });
  } finally {
    client.release();
  }
}
