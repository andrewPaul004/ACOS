import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { COMPANY_ID } from '../../support/fixture.js';
import { createMirrorHarness, type MirrorHarness } from '../../support/mirrorFixture.js';
import { ORACLE_MIRROR_LAG_CRITICAL_MS } from '../../support/mirrorPrecedenceTable.js';
import {
  degradedModeTiming,
  classifyMirrorLag,
} from '../../../src/kernel/mirror/degradedModeThresholds.js';
import {
  evaluateState,
  mirrorLagCondition,
  mirrorLagMs,
} from '../../../src/kernel/mirror/mirrorStateMachine.js';
import { emitAttestation } from '../../../src/replication/attestation.js';

/**
 * `30 §5.1` item 5's FIRST rule and `30 §5.1a`'s boundary — THE MIRROR-LAG CRITICAL
 * CONDITION, AGAINST REAL POSTGRESQL. v1.3.3, part of `S1H-C10`.
 *
 * =================================================================================
 * WHAT THIS CONDITION IS, AND — MORE IMPORTANTLY — WHAT IT IS NOT.
 *
 * `30 §5.1a`: "An **escalation and state input**. It raises the CRITICAL condition item 5
 * names and it does nothing else. It **cannot** create `CORROBORATED_DEGRADED`, **cannot**
 * fabricate or substitute for a `MirrorInputStallSignal`, **cannot** grant or extend a
 * `DegradedModeOverride`, and **cannot** move any monetary limit."
 *
 * `§15` of the owner-resolution mandate says the same four things. Each is asserted below as
 * a property of the DURABLE TABLES after the condition has fired, not as a property of the
 * function's signature — a signature proves only that a particular caller cannot do it.
 * =================================================================================
 *
 * =================================================================================
 * THE OPERAND IS CONTROL-DERIVED, AND THE SUITE SAYS SO RATHER THAN HIDING IT.
 *
 * `30 §5.1a` declares `mirror_lag` as `now() − min(occurred_at)` over `effect_journal` rows
 * whose `mirrored_at` is null, and `30 §5.2` makes `mirrored_at` "ADVISORY ONLY [...] a
 * compromised control plane can set it freely". `§5.1a` accepts that for THIS operand and
 * only this one, because the condition it raises is an ESCALATION: understating the lag
 * suppresses an alarm rather than obtaining authority. The last suite below asserts that
 * direction — a control plane that sets every `mirrored_at` silences the alarm and gains
 * NOTHING in dispatch eligibility.
 * =================================================================================
 */

let h: MirrorHarness;

const T0 = new Date('2026-03-01T12:00:00.000Z');
const T = degradedModeTiming().mirrorLagCriticalMs;

beforeAll(async () => {
  h = await createMirrorHarness();
});

afterAll(async () => {
  await h.close();
});

beforeEach(async () => {
  await h.reset();
});

/**
 * Commit one journal row at `at`, unmirrored.
 *
 * `emitAttestation` is the accepted S1G path and writes a `JOURNAL_ATTESTATION` row whose
 * `occurred_at` is the instant passed — `0008`: "`attested_at` is `occurred_at`". Nothing is
 * pushed, so `mirrored_at` stays NULL, which is exactly the backlog `30 §5.1a`'s operand
 * measures. `30 §5.4`: "the empty attestation is the entire point", so an attestation over an
 * empty journal is a legitimate row rather than a contrivance.
 */
async function unmirroredRowAt(at: Date): Promise<void> {
  await emitAttestation(h.control, COMPANY_ID, at);
}

describe('the operand: `now() − min(occurred_at)` over the unmirrored backlog', () => {
  it('an EMPTY backlog is 0 — the mirror is acknowledging', async () => {
    expect(await mirrorLagMs(h.control, COMPANY_ID, T0)).toBe(0);
    const { condition } = await mirrorLagCondition(h.control, COMPANY_ID, T0);
    expect(condition).toBe('WITHIN_THRESHOLD');
  });

  it('and it is the OLDEST unmirrored row that decides, not the newest', async () => {
    // `30 §5.1a`: "the age of the **oldest** journal row this company has committed that the
    // audit store has not acknowledged". A newer row cannot mask an older one, which is the
    // whole point of taking `min`.
    await unmirroredRowAt(new Date(T0.getTime() - T));
    await unmirroredRowAt(new Date(T0.getTime() - 1000));
    expect(await mirrorLagMs(h.control, COMPANY_ID, T0)).toBe(T);
  });

  it('and a MIRRORED row is not in the backlog at all', async () => {
    await unmirroredRowAt(new Date(T0.getTime() - T));
    const client = await h.control.connect();
    try {
      await client.query(
        `UPDATE effect_journal SET mirrored_at = $2 WHERE company_id = $1`,
        [COMPANY_ID, T0],
      );
    } finally {
      client.release();
    }
    expect(await mirrorLagMs(h.control, COMPANY_ID, T0)).toBe(0);
  });
});

describe('`51 §3.8` — the CRITICAL boundary, INCLUSIVE, through the durable operand', () => {
  beforeEach(async () => {
    // One row, committed exactly `T` before `T0`, so the evaluating instant moves the lag by
    // one millisecond at a time and the boundary is exact rather than approximate.
    await unmirroredRowAt(new Date(T0.getTime() - T));
  });

  it('14:59.999 of lag is WITHIN_THRESHOLD', async () => {
    const at = new Date(T0.getTime() - 1);
    const { lagMs, condition } = await mirrorLagCondition(h.control, COMPANY_ID, at);
    expect(lagMs).toBe(T - 1);
    expect(condition).toBe('WITHIN_THRESHOLD');
  });

  it('exactly 15:00.000 of lag is CRITICAL — at the threshold is over it', async () => {
    const { lagMs, condition } = await mirrorLagCondition(h.control, COMPANY_ID, T0);
    expect(lagMs).toBe(T);
    expect(condition).toBe('CRITICAL');
  });

  it('15:00.001 of lag is CRITICAL', async () => {
    const at = new Date(T0.getTime() + 1);
    const { lagMs, condition } = await mirrorLagCondition(h.control, COMPANY_ID, at);
    expect(lagMs).toBe(T + 1);
    expect(condition).toBe('CRITICAL');
  });

  it('and the threshold is the DECLARED one, from the hand-authored reading', () => {
    expect(T).toBe(ORACLE_MIRROR_LAG_CRITICAL_MS);
  });
});

describe('`§15` — THE CONDITION UNLOCKS NOTHING. Four assertions, over the durable tables', () => {
  beforeEach(async () => {
    await unmirroredRowAt(new Date(T0.getTime() - 10 * T));
    // The condition is well past CRITICAL.
    const { condition } = await mirrorLagCondition(h.control, COMPANY_ID, T0);
    expect(condition).toBe('CRITICAL');
  });

  it('1 — it does NOT create `CORROBORATED_DEGRADED`, or any state at all', async () => {
    // `30 §5.6`'s entry conditions are unchanged by `§5.1a`. A CRITICAL lag with no
    // declaration open resolves to `NORMAL`, because `NORMAL` is "no declaration open" and
    // the lag is not one of the table's operands.
    const resolution = await evaluateState(h.control, COMPANY_ID, T0);
    expect(resolution.state).toBe('NORMAL');
    expect(resolution.basisSignalId).toBeNull();
  });

  it('2 — it fabricates NO signal: `mirror_corroboration` is still empty', async () => {
    await mirrorLagCondition(h.control, COMPANY_ID, T0);
    await evaluateState(h.control, COMPANY_ID, T0);
    const client = await h.control.connect();
    try {
      const rows = await client.query<{ n: string }>(
        'SELECT count(*) AS n FROM mirror_corroboration WHERE company_id = $1',
        [COMPANY_ID],
      );
      expect(rows.rows[0]!.n).toBe('0');
    } finally {
      client.release();
    }
  });

  it('3 — it grants NO override: `degraded_mode_override` is still empty', async () => {
    await mirrorLagCondition(h.control, COMPANY_ID, T0);
    const client = await h.control.connect();
    try {
      const rows = await client.query<{ n: string }>(
        'SELECT count(*) AS n FROM degraded_mode_override WHERE company_id = $1',
        [COMPANY_ID],
      );
      expect(rows.rows[0]!.n).toBe('0');
    } finally {
      client.release();
    }
  });

  it('4 — it moves NO monetary limit: every window ceiling is byte-identical', async () => {
    const client = await h.control.connect();
    const ceilings = async (): Promise<string> => {
      const rows = await client.query<{ snapshot: string }>(
        `SELECT string_agg(window_id || '=' || max_monetary::TEXT || '/' || max_count::TEXT
                           || '/' || max_irrecoverable_units::TEXT, ',' ORDER BY window_id)
                AS snapshot
           FROM window_registry WHERE company_id = $1`,
        [COMPANY_ID],
      );
      return rows.rows[0]?.snapshot ?? '';
    };
    try {
      const before = await ceilings();
      expect(before).not.toBe('');
      await mirrorLagCondition(h.control, COMPANY_ID, T0);
      await evaluateState(h.control, COMPANY_ID, T0);
      expect(await ceilings()).toBe(before);
    } finally {
      client.release();
    }
  });
});

describe('the condition is a PURE FUNCTION of the lag, and there is no third value', () => {
  it('`classifyMirrorLag` reads nothing but the number it is given', () => {
    // A CRITICAL lag and a WITHIN_THRESHOLD lag differ only in the argument. There is no
    // company, no state, no signal and no clock in the signature, so the condition cannot be
    // made to depend on any of them.
    expect(classifyMirrorLag(T)).toBe('CRITICAL');
    expect(classifyMirrorLag(T - 1)).toBe('WITHIN_THRESHOLD');
    // v1.3.6 (`50 §2c` quantity 1): the THRESHOLD is now signed class-27 content, so the
    // signature gained an optional second parameter — the `VerifiedControlArtifactBundle`,
    // which only verification produces and which defaults to the active one. There is still
    // no company, no state, no signal and no clock, so the condition still cannot be made to
    // depend on any of them.
    expect(classifyMirrorLag.length).toBe(1);
    // And the second parameter cannot smuggle a threshold in: it is the sealed capability,
    // and an object cast to its type carries no contents at all.
    expect(() =>
      classifyMirrorLag(T, {} as unknown as Parameters<typeof classifyMirrorLag>[1]),
    ).toThrow();
  });
});

describe('the operand is CONTROL-DERIVED, and the exposure is in the SAFE direction', () => {
  it('a control plane that sets every `mirrored_at` silences the alarm and gains NOTHING', async () => {
    // `30 §5.2`: `mirrored_at` is "ADVISORY ONLY [...] a compromised control plane can set it
    // freely; nothing depends on it." So the understated case is reachable, and `§5.1a`
    // accepts it because the condition is an ESCALATION.
    //
    // THE ASSERTION IS THAT NOTHING IS GAINED. The alarm goes quiet; the mirror state does
    // not move, no signal appears, and the dispatch table is untouched — the only thing the
    // control plane bought is the audit plane's attestation-absence check firing instead
    // (`30 §5.4`, `I17f(b)`), which it cannot forge.
    await unmirroredRowAt(new Date(T0.getTime() - 10 * T));
    expect((await mirrorLagCondition(h.control, COMPANY_ID, T0)).condition).toBe('CRITICAL');

    const client = await h.control.connect();
    try {
      await client.query(
        `UPDATE effect_journal SET mirrored_at = $2
          WHERE company_id = $1 AND mirrored_at IS NULL`,
        [COMPANY_ID, T0],
      );
    } finally {
      client.release();
    }

    // The alarm is silenced.
    expect((await mirrorLagCondition(h.control, COMPANY_ID, T0)).condition).toBe(
      'WITHIN_THRESHOLD',
    );
    // And the state is exactly what it was: `NORMAL`, on no declaration, with no basis.
    const resolution = await evaluateState(h.control, COMPANY_ID, T0);
    expect(resolution.state).toBe('NORMAL');
    expect(resolution.basisSignalId).toBeNull();
    // Which is the same state a healthy company is in, so the lie bought no relaxation: the
    // relaxed state requires a signal this plane cannot mint (`30 §5.7`).
  });
});
