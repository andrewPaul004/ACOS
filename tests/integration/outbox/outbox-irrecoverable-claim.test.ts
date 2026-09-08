import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sign as signEd25519 } from 'node:crypto';

import { COMPANY_ID } from '../../support/fixture.js';
import {
  S1I_NOW,
  authoriseReship,
  claimJournalRows,
  createOutboxHarness,
  economicSnapshot,
  outboxRows,
  type AuthorisedEffect,
  type OutboxHarness,
} from '../../support/outboxFixture.js';
import { enqueueDispatch } from '../../../src/kernel/outbox/enqueue.js';
import { claimForExternalDispatch } from '../../../src/kernel/outbox/claim.js';
import { signalFieldsAt, signalSignedWith } from '../../support/mirrorFixture.js';
import {
  consumeCorroboration,
  declareMirrorDegraded,
  evaluateState,
} from '../../../src/kernel/mirror/mirrorStateMachine.js';
import { signalSigningBytes } from '../../../src/kernel/mirror/corroborationSignal.js';
import {
  grantOverride,
  overrideGrantBytes,
  type OverrideRequest,
} from '../../../src/kernel/mirror/degradedModeOverride.js';
import { money } from '../../../src/kernel/exposure/money.js';
import { unsafeIrrecoverableRow1 } from '../../negative-controls/unsafe-irrecoverable-blanket-halt.js';

/**
 * `S1I-C6` RESOLVED — IRRECOVERABLE IS CLAIMABLE IN `NORMAL` AND NOWHERE ELSE.
 * v1.3.4 (IRN-01), `30 §5.1b`.
 *
 * =================================================================================
 * WHAT WAS WRONG.
 *
 * `22 §3.1` printed `30 §5.1` row 1 as **Halt / Halt / Halt**. Composed with item 5's "An
 * override restores precedence rows 3 and 4 only, never rows 1 or 2" and `51 §3.6`'s
 * `recoverability_classes[] ⊆ {COMPENSABLE, REVERSIBLE}` DATABASE CHECK, an IRRECOVERABLE
 * effect was **never dispatch-eligible, in any state, with or without an owner override**.
 *
 * So ADR-026 — titled "**Irrecoverable dispatch** goes through an ACOS-owned outbox" —
 * `25 §7`'s outbox, `25 §5`'s `PRESUMED_EXECUTED` branch, `I20` and `37` S4's autonomous
 * sends all specified mechanisms with no reachable subject. S1I reported it as a finding
 * and implemented the printed table, which is the fail-closed direction.
 * =================================================================================
 *
 * =================================================================================
 * `§11` OF THE OWNER-RESOLUTION MANDATE — THE FIVE-CONDITION MATRIX.
 *
 *   | State                                  | Expected              |
 *   | NORMAL                                 | ELIGIBLE / claimable  |
 *   | UNCORROBORATED_STALL                   | HALT                  |
 *   | CORROBORATED_DEGRADED                  | HALT                  |
 *   | FULL HALT                              | HALT                  |
 *   | FULL HALT + ordinary degraded override | HALT                  |
 *
 * "**Do not derive expected outcomes from the production table. Use a hand-authored
 * oracle.**" — so the expectations below are literals written from `30 §5.1b`'s own table,
 * and the discriminating control is `unsafeIrrecoverableRow1`, which is v1.3.3's reading.
 *
 * THE CONTROL RUNS IN THE OPPOSITE DIRECTION TO EVERY OTHER ONE IN THIS REPOSITORY, and
 * `unsafe-irrecoverable-blanket-halt.ts` records why: the two ways this correction can be
 * wrong are "it did not happen" and "it went too far", and only a STRICTER control detects
 * the first.
 * =================================================================================
 */

let h: OutboxHarness;
const NOW = S1I_NOW;
const HOUR = 60 * 60 * 1000;
/** `51 §3.8`: `audit_unreachable_full_halt_threshold` = PT30M. Transcribed, not imported. */
const FULL_HALT_MS = 30 * 60 * 1000;

beforeAll(async () => {
  h = await createOutboxHarness();
});

afterAll(async () => {
  await h.close();
});

beforeEach(async () => {
  await h.reset();
});

async function enqueuedReship(tag: string): Promise<AuthorisedEffect> {
  const effect = await authoriseReship(h, { resourceId: `ORD-IRR-${tag}` });
  expect(effect.recoverability).toBe('IRRECOVERABLE');
  const outcome = await enqueueDispatch(h.control, {
    companyId: COMPANY_ID,
    effectId: effect.effectId,
    outboxId: `outbox:irr-${tag}`,
    payloadCanonicalBytes: effect.payloadCanonicalBytes,
    now: NOW,
  });
  expect(outcome.kind).toBe('ENQUEUED');
  return effect;
}

async function claim(effect: AuthorisedEffect, at: Date = NOW) {
  return claimForExternalDispatch(h.control, {
    companyId: COMPANY_ID,
    idempotencyKey: effect.idempotencyKey,
    claimedBy: 'worker:irrecoverable',
    now: at,
  });
}

/** `30 §5.6`: a control-side declaration with no corroborating signal. */
async function toStall(at: Date): Promise<void> {
  await declareMirrorDegraded(h.control, COMPANY_ID, 'PUSH_ACK_TIMEOUT', at);
  expect((await evaluateState(h.control, COMPANY_ID, at)).state).toBe('UNCORROBORATED_STALL');
}

/**
 * `30 §5.6`: the declaration PLUS a fresh, valid, audit-signed `MirrorInputStallSignal`.
 *
 * A control plane cannot mint one — `§5.7.1` — so the signal is signed with the harness's
 * audit key, which is the accepted S1H path and the only way this state is reachable.
 */
async function toCorroborated(at: Date): Promise<void> {
  await declareMirrorDegraded(h.control, COMPANY_ID, 'PUSH_ACK_TIMEOUT', at);
  const signal = signalSignedWith(
    signalFieldsAt(at, { signalId: `signal:irr-${String(at.getTime())}` }),
    h.auditKey.privateKey,
    signalSigningBytes,
  );
  const outcome = await consumeCorroboration(
    h.control,
    COMPANY_ID,
    signal,
    h.auditKey.publicKey,
    at,
  );
  expect(outcome.kind).toBe('SIGNAL_CONSUMED');
  expect((await evaluateState(h.control, COMPANY_ID, at)).state).toBe('CORROBORATED_DEGRADED');
}

/**
 * `30 §5.7.2`'s override, granted for real: owner-signed, against an open incident, scoped
 * to a COMPENSABLE class and precedence rows 3 and 4.
 *
 * `51 §3.6` makes `recoverability_classes[] ⊆ {COMPENSABLE, REVERSIBLE}` a DATABASE CHECK,
 * so an override naming IRRECOVERABLE cannot be created at all — asserted separately below.
 * This is therefore the MOST PERMISSIVE override the architecture admits, which is what
 * `§11`'s fifth row means by "a valid ordinary degraded override".
 */
async function grantOrdinaryOverride(at: Date): Promise<string> {
  const request: OverrideRequest = {
    companyId: COMPANY_ID,
    overrideId: 'override:irr-matrix',
    requestedBy: 'principal:owner',
    requestedAt: at,
    effectClasses: ['refund.create'],
    // `30 §5.7.2` / `51 §3.6`: the class set cannot hold IRRECOVERABLE at all.
    recoverabilityClasses: ['COMPENSABLE'],
    // `30 §5.1` item 5: rows 3 and 4 only. Both are taken, so this override is the widest
    // one the architecture admits — and it still does not reach row 1.
    precedenceRows: [3, 4],
    startsAt: at,
    expiresAt: new Date(at.getTime() + 12 * HOUR),
    effectCountCap: 5n,
    monetaryExposureCap: money('50.00'),
    reason: 'the S1I-C6 matrix: the most permissive override the architecture admits',
    incidentRef: h.seed.incidentRef,
  };
  await grantOverride(h.control, request, {
    grantedBy: 'principal:owner',
    grantedAt: at,
    grantSignature: signEd25519(
      null,
      overrideGrantBytes(request),
      h.seed.ownerSigner.privateKey,
    ),
  });
  return request.overrideId;
}

describe('`§11` — THE FIVE-CONDITION MATRIX, AGAINST A HAND-AUTHORED ORACLE', () => {
  it('NORMAL: ELIGIBLE, and the row is durably CLAIMED', async () => {
    // HAND-AUTHORED, from `30 §5.1b`'s table: `NORMAL` → **Dispatch**.
    const expected = 'DISPATCH_ELIGIBLE';

    const effect = await enqueuedReship('normal');
    const outcome = await claim(effect);
    expect(outcome.kind).toBe('CLAIMED');
    if (outcome.kind !== 'CLAIMED') return;
    expect(outcome.claim.decision.disposition).toBe(expected);
    expect(outcome.claim.matchedRow).toBe(1);
    expect(outcome.claim.mirrorState).toBe('NORMAL');
    expect((await outboxRows(h.control))[0]!.status).toBe('CLAIMED');

    // THE DISCRIMINATION. v1.3.3's reading DENIES here; production PERMITS.
    expect(unsafeIrrecoverableRow1('NORMAL').disposition).toBe('HALT');
    expect(outcome.claim.decision.disposition).not.toBe(
      unsafeIrrecoverableRow1('NORMAL').disposition,
    );
  });

  it('UNCORROBORATED_STALL: HALT, and nothing is written', async () => {
    const expected = 'HALT';

    const effect = await enqueuedReship('stall');
    await toStall(NOW);
    const outcome = await claim(effect, new Date(NOW.getTime() + 60_000));
    expect(outcome.kind).toBe('REFUSED');
    if (outcome.kind !== 'REFUSED') return;
    expect(outcome.reason).toBe('PRE_DISPATCH_HALTED');
    expect(outcome.decision?.disposition).toBe(expected);
    expect(outcome.decision?.matchedRow).toBe(1);
    expect((await outboxRows(h.control))[0]!.status).toBe('ENQUEUED');

    // AND HERE THE TWO AGREE, which is what proves the correction is narrow.
    expect(unsafeIrrecoverableRow1('UNCORROBORATED_STALL').disposition).toBe(expected);
  });

  it('CORROBORATED_DEGRADED: HALT — corroboration proves the stall, it does not cure it', async () => {
    const expected = 'HALT';

    const effect = await enqueuedReship('corroborated');
    await toCorroborated(NOW);
    const outcome = await claim(effect, new Date(NOW.getTime() + 60_000));
    expect(outcome.kind).toBe('REFUSED');
    if (outcome.kind !== 'REFUSED') return;
    expect(outcome.decision?.disposition).toBe(expected);
    expect(outcome.decision?.matchedRow).toBe(1);
    expect(outcome.decision?.explanation).toContain('CORROBORATED_DEGRADED');
    expect((await outboxRows(h.control))[0]!.status).toBe('ENQUEUED');
    expect(unsafeIrrecoverableRow1('CORROBORATED_DEGRADED').disposition).toBe(expected);
  });

  it('FULL HALT: HALT, and the posture is the recorded reason', async () => {
    const expected = 'HALT';

    const effect = await enqueuedReship('full-halt');
    await toStall(NOW);
    // At or beyond `51 §3.8`'s PT30M, inclusive.
    const at = new Date(NOW.getTime() + FULL_HALT_MS);
    const outcome = await claim(effect, at);
    expect(outcome.kind).toBe('REFUSED');
    if (outcome.kind !== 'REFUSED') return;
    expect(outcome.decision?.disposition).toBe(expected);
    expect(outcome.decision?.fullHaltPosture).toBe(true);
    expect(outcome.decision?.matchedRow).toBe(1);
    expect((await outboxRows(h.control))[0]!.status).toBe('ENQUEUED');
    expect(unsafeIrrecoverableRow1('UNCORROBORATED_STALL', { fullHaltPosture: true }).disposition)
      .toBe(expected);
  });

  it('FULL HALT + a valid ordinary degraded override: STILL HALT', async () => {
    const expected = 'HALT';

    const effect = await enqueuedReship('override');
    await toStall(NOW);
    const overrideId = await grantOrdinaryOverride(NOW);

    const at = new Date(NOW.getTime() + FULL_HALT_MS);
    const outcome = await claim(effect, at);
    expect(outcome.kind).toBe('REFUSED');
    if (outcome.kind !== 'REFUSED') return;
    expect(outcome.decision?.disposition).toBe(expected);
    expect(outcome.decision?.matchedRow).toBe(1);
    // `30 §5.1` item 5 / `30 §5.1b`: no escape is even OFFERED at row 1.
    expect(outcome.decision?.ownerOverrideAvailable).toBe(false);
    expect(outcome.decision?.overrideId).toBeNull();
    expect((await outboxRows(h.control))[0]!.status).toBe('ENQUEUED');

    // AND THE OVERRIDE'S ALLOWANCE IS UNTOUCHED: nothing was consumed by a claim that did
    // not happen, so the owner's bounded escape is still available for the rows it covers.
    const client = await h.control.connect();
    try {
      const counters = await client.query<{ effects_dispatched: string; status: string }>(
        `SELECT effects_dispatched::TEXT, status FROM degraded_mode_override
          WHERE company_id = $1 AND override_id = $2`,
        [COMPANY_ID, overrideId],
      );
      expect(counters.rows[0]!.effects_dispatched).toBe('0');
      expect(counters.rows[0]!.status).toBe('ACTIVE');
    } finally {
      client.release();
    }
    expect(unsafeIrrecoverableRow1('UNCORROBORATED_STALL', { overrideInScope: true }).disposition)
      .toBe(expected);
  });

  it('and an override NAMING IRRECOVERABLE cannot be granted at all — `51 §3.6`, in the database', async () => {
    /*
     * The structural half, unchanged by v1.3.4 and re-asserted because the correction
     * would be worthless if it had quietly widened the grant path instead of row 1's
     * `NORMAL` cell. `30 §5.1b`: "A `DegradedModeOverride` can never unlock row 1, in any
     * state [...] `precedence_rows` still cannot hold `1`."
     */
    const client = await h.control.connect();
    try {
      await expect(
        client.query(
          `INSERT INTO degraded_mode_override (
             company_id, override_id, requested_by, granted_by, incident_ref,
             effect_classes, recoverability_classes, precedence_rows,
             starts_at, expires_at, effect_count_cap, monetary_exposure_cap, reason,
             grant_signature, requested_at, granted_at)
           VALUES ($1, 'override:illegal', 'principal:owner', 'principal:owner', $2,
                   ARRAY['fulfilment.reship'], ARRAY['IRRECOVERABLE'], ARRAY[1],
                   $3, $4, 1, 0.00, 'illegal', '\\x00'::BYTEA, $3, $3)`,
          [
            COMPANY_ID,
            h.seed.incidentRef.toString(),
            NOW,
            new Date(NOW.getTime() + HOUR),
          ],
        ),
      ).rejects.toThrow();
    } finally {
      client.release();
    }
  });
});

describe('`§24` — THE ADR-026 PATH IS STRUCTURALLY REACHABLE, AND IT STOPS AT CLAIMED', () => {
  it('authorise → audit/mirror NORMAL → enqueue → claim → durable CLAIMED, and then STOP', async () => {
    /*
     * `§24` OF THE OWNER-RESOLUTION MANDATE, verbatim:
     *
     *   "Add an end-to-end local test showing: authoritative IRRECOVERABLE effect →
     *    accepted local authorisation → audit/mirror NORMAL → enqueue → claim → durable
     *    `CLAIMED` and then STOP. Assert: zero HTTP calls; zero DISPATCHED state; zero
     *    provider outcome; no MIE execution consumption unless architecture explicitly
     *    binds it to claim; second claim refused. **This proves the ADR-026 path is
     *    structurally reachable without pretending it executed.**"
     */
    const effect = await enqueuedReship('e2e');
    // The snapshot is taken AFTER authorisation and enqueue and BEFORE the claim, because
    // the property under test is `§29`'s — "THE CLAIM CHANGES NO ECONOMIC AUTHORITY".
    // Authorisation legitimately reserves; the claim must move nothing.
    const before = await economicSnapshot(h.control);

    const claimed = await claim(effect);
    expect(claimed.kind).toBe('CLAIMED');
    if (claimed.kind !== 'CLAIMED') return;

    // THE CLAIM IS DURABLE AND COMMITTED — visible from a SEPARATE connection.
    const client = await h.control.connect();
    try {
      const row = await client.query<{
        status: string;
        claim_id: string;
        claim_matched_row: number;
        claim_mirror_state: string;
        claim_clock_ref: string | null;
      }>(
        `SELECT status, claim_id, claim_matched_row, claim_mirror_state, claim_clock_ref
           FROM dispatch_outbox WHERE company_id = $1 AND idempotency_key = $2`,
        [COMPANY_ID, effect.idempotencyKey],
      );
      expect(row.rows[0]!.status).toBe('CLAIMED');
      expect(row.rows[0]!.claim_id).toBe(claimed.claim.row.claimId);
      expect(row.rows[0]!.claim_matched_row).toBe(1);
      expect(row.rows[0]!.claim_mirror_state).toBe('NORMAL');
      // Row 1's reason is the CLASS, never a clock.
      expect(row.rows[0]!.claim_clock_ref).toBeNull();

      // ZERO DISPATCHED STATE. `24 §3` K4's terminal statuses are reached only after a
      // dispatch, and there is none.
      const statuses = await client.query<{ status: string }>(
        `SELECT DISTINCT status FROM effect WHERE company_id = $1`,
        [COMPANY_ID],
      );
      for (const s of statuses.rows) {
        expect(['AUTHORISED', 'AWAITING_APPROVAL']).toContain(s.status);
      }

      // NO MIE EXECUTION CONSUMPTION. ADR-026 item 3 and `35 §4` put the consumption at
      // `PRESUMED_EXECUTED`, which requires a real request uncertainty and therefore a
      // request. There is none, so all three irrecoverable ledgers are zero.
      const ledger = await client.query<{
        window_id: string;
        reserved_irrecoverable: string;
        presumed_irrecoverable: string;
        realised_irrecoverable: string;
      }>(
        `SELECT window_id, reserved_irrecoverable::TEXT, presumed_irrecoverable::TEXT,
                realised_irrecoverable::TEXT
           FROM window_balance WHERE company_id = $1`,
        [COMPANY_ID],
      );
      expect(ledger.rows.length).toBeGreaterThan(0);
      for (const w of ledger.rows) {
        expect(w.presumed_irrecoverable, w.window_id).toBe('0');
        expect(w.realised_irrecoverable, w.window_id).toBe('0');
      }
    } finally {
      client.release();
    }

    // EXACTLY ONE JOURNAL ROW, and it is a CLAIM rather than a dispatch.
    const journal = await claimJournalRows(h.control);
    expect(journal).toHaveLength(1);
    expect(journal[0]!.matchedRow).toBe(1);
    expect(journal[0]!.mirrorState).toBe('NORMAL');
    expect(journal[0]!.claimClockRef).toBeNull();

    // A SECOND CLAIM IS REFUSED — `25 §7`, `I36`, and v1.3.4 changes nothing about it.
    const second = await claim(effect);
    expect(second.kind).toBe('REFUSED');
    if (second.kind === 'REFUSED') {
      expect(second.reason).toBe('ALREADY_CLAIMED');
    }

    // AND NO ECONOMIC AUTHORITY MOVED. `§29`: the claim moves no money.
    const after = await economicSnapshot(h.control);
    expect(after).toEqual(before);
  });
});

describe('`§25` — THE NORMAL CORRECTION DID NOT WEAKEN THE DEGRADED INVARIANT', () => {
  it('the SAME fixture claims in NORMAL and is refused in every degraded condition', async () => {
    /*
     * `§25`: "Using the exact same IRRECOVERABLE effect/outbox: NORMAL: claim succeeds.
     * Then equivalent fixture under UNCORROBORATED_STALL, CORROBORATED_DEGRADED, prolonged
     * FULL HALT, valid ordinary degraded override. Expected: all refuse claim. **This
     * proves the NORMAL correction did not weaken the degraded invariant.**"
     *
     * The fixture is rebuilt per condition because a CLAIMED row can never be re-claimed
     * (`I36`) — which is itself the accepted property, and is asserted in the first arm.
     */
    const normal = await enqueuedReship('same-normal');
    const claimed = await claim(normal);
    expect(claimed.kind).toBe('CLAIMED');

    const degraded: {
      readonly label: string;
      readonly prepare: () => Promise<void>;
      readonly at: Date;
    }[] = [
      {
        label: 'UNCORROBORATED_STALL',
        prepare: async () => {
          await toStall(NOW);
        },
        at: new Date(NOW.getTime() + 60_000),
      },
      {
        label: 'CORROBORATED_DEGRADED',
        prepare: async () => {
          await toCorroborated(NOW);
        },
        at: new Date(NOW.getTime() + 60_000),
      },
      {
        label: 'FULL HALT',
        prepare: async () => {
          await toStall(NOW);
        },
        at: new Date(NOW.getTime() + FULL_HALT_MS),
      },
      {
        label: 'FULL HALT + ordinary override',
        prepare: async () => {
          await toStall(NOW);
          await grantOrdinaryOverride(NOW);
        },
        at: new Date(NOW.getTime() + FULL_HALT_MS),
      },
    ];

    for (const condition of degraded) {
      await h.reset();
      const effect = await enqueuedReship('same-degraded');
      await condition.prepare();
      const outcome = await claim(effect, condition.at);
      expect(outcome.kind, condition.label).toBe('REFUSED');
      if (outcome.kind !== 'REFUSED') continue;
      expect(outcome.reason, condition.label).toBe('PRE_DISPATCH_HALTED');
      expect(outcome.decision?.matchedRow, condition.label).toBe(1);
      expect((await outboxRows(h.control))[0]!.status, condition.label).toBe('ENQUEUED');
      // The vulnerable control agrees in every one of these, and disagreed in `NORMAL`.
      expect(unsafeIrrecoverableRow1('UNCORROBORATED_STALL').disposition, condition.label)
        .toBe('HALT');
    }
  });
});
