import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { COMPANY_ID } from '../../support/fixture.js';
import {
  OWNER_ONE,
  createMirrorHarness,
  type MirrorHarness,
} from '../../support/mirrorFixture.js';
import {
  ORACLE_FULL_HALT_MS,
  PERMISSIVENESS,
  expectedFor,
  expectedUnderFullHalt,
  type OracleCase,
} from '../../support/mirrorPrecedenceTable.js';
import { unsafeProlongedUnreachabilityEvaluator } from '../../negative-controls/unsafe-prolonged-unreachability.js';
import {
  classifyDispatchPrecedence,
  type PrecedenceOperands,
} from '../../../src/kernel/mirror/dispatchPrecedence.js';
import {
  activeOverrideOn,
  grantOverride,
  overrideGrantBytes,
  type OverrideRequest,
} from '../../../src/kernel/mirror/degradedModeOverride.js';
import {
  closeMirrorDeclaration,
  declareMirrorDegraded,
  evaluateState,
  mirrorDispatchOperands,
  openDeclarationOpenedAt,
} from '../../../src/kernel/mirror/mirrorStateMachine.js';
import { DEGRADED_MODE_TIMING } from '../../../src/kernel/mirror/degradedModeThresholds.js';
import { money } from '../../../src/kernel/exposure/money.js';
import { sign as signEd25519, type KeyObject } from 'node:crypto';

/**
 * `30 §5.1a`'s FULL-HALT POSTURE, AGAINST REAL POSTGRESQL. v1.3.3, `S1H-C10` CLOSED.
 *
 * =================================================================================
 * WHAT WAS NOT IMPLEMENTED, AND WHY.
 *
 * `30 §5.1` item 5 has always said "Mirror unreachable beyond a longer threshold halts
 * **all** classes including REVERSIBLE — the point at which the company stops", and v1.3.2
 * declared no threshold, no operand and no timer semantics for it. So `S1H-result.md §16`
 * reported the posture NOT IMPLEMENTED and `S1H-C10` asked the owner for the quantity —
 * `§42` of the S1H mandate forbids inventing one.
 *
 * `51 §3.8` declares it: `audit_unreachable_full_halt_threshold` = **PT30M**, inclusive, over
 * `now() − opened_at` of the company's OPEN `AUDIT_MIRROR_DEGRADED` declaration.
 * =================================================================================
 *
 * =================================================================================
 * NOTHING IS DISPATCHED HERE, AND NOTHING COULD BE.
 *
 * `§14` of the owner-resolution mandate: "Do NOT create external dispatch." `§20`: no
 * outbox, no claim, no adapter, no vendor call. This suite reads a DISPOSITION out of a pure
 * classifier and asserts it, exactly as every S1H precedence suite does, and
 * `no-dispatch-boundary.test.ts` asserts the absence of every dispatch surface in `src/`.
 * =================================================================================
 */

let h: MirrorHarness;

const T0 = new Date('2026-03-01T12:00:00.000Z');
const HOUR = 60 * 60 * 1000;

/** The declared threshold, and the two instants either side of it. */
const T = DEGRADED_MODE_TIMING.auditUnreachableFullHaltMs;
/** `29:59.999` after the declaration opened. */
const JUST_INSIDE = new Date(T0.getTime() + T - 1);
/** Exactly `30:00.000` after the declaration opened. */
const AT_THRESHOLD = new Date(T0.getTime() + T);
/** One millisecond over. */
const JUST_OVER = new Date(T0.getTime() + T + 1);

beforeAll(async () => {
  h = await createMirrorHarness();
});

afterAll(async () => {
  await h.close();
});

beforeEach(async () => {
  await h.reset();
});

const ACTION_FOR = {
  REVERSIBLE: 'campaign.pause',
  COMPENSABLE: 'refund.create',
  IRRECOVERABLE: 'fulfilment.reship',
} as const;

function operands(
  c: OracleCase,
  now: Date,
  over: Partial<PrecedenceOperands> = {},
): PrecedenceOperands {
  return {
    mirrorState: 'UNCORROBORATED_STALL',
    actionClass: ACTION_FOR[c.recoverability],
    recoverability: c.recoverability,
    clockBearing: c.clockBearing,
    totalExposure: money(c.totalExposure),
    hasRecordedApproval: c.hasRecordedApproval,
    activeOverride: null,
    unreachableSince: T0,
    now,
    ...over,
  };
}

/**
 * `§14`: "Test every recoverability class." The three classes, each in its most
 * DISPATCH-FAVOURABLE configuration, so the posture is what halts them and not a row above.
 *
 * Written out by hand from `22 §3.1` rather than generated, because the point of each row is
 * which ordinary disposition the posture is overriding.
 */
const CLASS_CASES: readonly { readonly label: string; readonly c: OracleCase }[] = [
  {
    label: 'REVERSIBLE (row 5 — ordinarily DISPATCH_ELIGIBLE in every state)',
    c: {
      recoverability: 'REVERSIBLE',
      clockBearing: false,
      totalExposure: '19.99',
      hasRecordedApproval: false,
    },
  },
  {
    label: 'COMPENSABLE inside a live clock (row 3 — the inversion row)',
    c: {
      recoverability: 'COMPENSABLE',
      clockBearing: true,
      totalExposure: '19.99',
      hasRecordedApproval: true,
    },
  },
  {
    label: 'COMPENSABLE discretionary (row 4 — ordinarily SUSPEND)',
    c: {
      recoverability: 'COMPENSABLE',
      clockBearing: false,
      totalExposure: '19.99',
      hasRecordedApproval: true,
    },
  },
  {
    label: 'IRRECOVERABLE (row 1 — ordinarily HALT in every state)',
    c: {
      recoverability: 'IRRECOVERABLE',
      clockBearing: true,
      totalExposure: '19.99',
      hasRecordedApproval: true,
    },
  },
  {
    label: 'above the floor, unapproved, no clock (row 2 — ordinarily HALT)',
    c: {
      recoverability: 'COMPENSABLE',
      clockBearing: false,
      totalExposure: '20.01',
      hasRecordedApproval: false,
    },
  },
];

// =====================================================================================
// THE BOUNDARY, OVER EVERY RECOVERABILITY CLASS
// =====================================================================================

describe('`51 §3.8` — at 29:59.999 the ORDINARY three-state table holds', () => {
  for (const { label, c } of CLASS_CASES) {
    it(`${label}`, () => {
      const decision = classifyDispatchPrecedence(operands(c, JUST_INSIDE));
      const expected = expectedFor('UNCORROBORATED_STALL', c);
      expect(decision.fullHaltPosture).toBe(false);
      expect(decision.haltedByFullHaltPosture).toBe(false);
      expect(decision.matchedRow).toBe(expected.row);
      expect(decision.disposition).toBe(expected.disposition);
    });
  }
});

describe('`51 §3.8` — at exactly 30:00.000 EVERY class is HALT', () => {
  for (const { label, c } of CLASS_CASES) {
    it(`${label}`, () => {
      const decision = classifyDispatchPrecedence(operands(c, AT_THRESHOLD));
      const expected = expectedUnderFullHalt('UNCORROBORATED_STALL', c);
      expect(decision.fullHaltPosture).toBe(true);
      expect(decision.disposition).toBe('HALT');
      expect(decision.disposition).toBe(expected.disposition);
      // `VC-A2g`: the matched row is still item 4's own answer, so a reader can tell that a
      // REVERSIBLE effect halted at ROW 5 UNDER THE POSTURE and not at row 1.
      expect(decision.matchedRow).toBe(expected.row);
      // And nothing is tagged, because a HALT dispatches nothing.
      expect(decision.requiresUnmirroredTag).toBe(false);
      expect(decision.overrideId).toBeNull();
    });
  }

  it('and one millisecond over is identical — the posture does not un-latch', () => {
    for (const { c } of CLASS_CASES) {
      expect(classifyDispatchPrecedence(operands(c, JUST_OVER)).disposition).toBe('HALT');
    }
  });

  it('`haltedByFullHaltPosture` attributes the halt HONESTLY', () => {
    // Rows 1 and 2 halt on their own merits, in or out of the posture, so reporting the
    // posture as their CAUSE would be false. Rows 3, 4 and 5 are the ones it reduces.
    const reduced = CLASS_CASES.filter(
      ({ c }) => expectedFor('UNCORROBORATED_STALL', c).disposition !== 'HALT',
    );
    const ownMerits = CLASS_CASES.filter(
      ({ c }) => expectedFor('UNCORROBORATED_STALL', c).disposition === 'HALT',
    );
    expect(reduced.length).toBeGreaterThan(0);
    expect(ownMerits.length).toBeGreaterThan(0);
    for (const { label, c } of reduced) {
      expect(
        classifyDispatchPrecedence(operands(c, AT_THRESHOLD)).haltedByFullHaltPosture,
        label,
      ).toBe(true);
    }
    for (const { label, c } of ownMerits) {
      expect(
        classifyDispatchPrecedence(operands(c, AT_THRESHOLD)).haltedByFullHaltPosture,
        label,
      ).toBe(false);
    }
  });

  it('the posture only ever moves toward HALT — never the other way', () => {
    // `PERMISSIVENESS` is declared in the oracle from `30 §5.1`'s own row texts. The
    // reduction cannot make anything MORE permissive, which is the property that makes the
    // posture safe to compose with the three-state table rather than replace it.
    for (const { label, c } of CLASS_CASES) {
      const ordinary = classifyDispatchPrecedence(operands(c, JUST_INSIDE));
      const posture = classifyDispatchPrecedence(operands(c, AT_THRESHOLD));
      expect(
        PERMISSIVENESS[posture.disposition],
        label,
      ).toBeLessThanOrEqual(PERMISSIVENESS[ordinary.disposition]);
    }
  });
});

describe('the posture applies in `CORROBORATED_DEGRADED` too', () => {
  // `30 §5.1a`: "It applies in **both** degraded states, including `CORROBORATED_DEGRADED`:
  // item 5 qualifies the halt by no state, and corroboration **proves** the stall rather
  // than curing it."
  for (const { label, c } of CLASS_CASES) {
    it(`${label}`, () => {
      const decision = classifyDispatchPrecedence(
        operands(c, AT_THRESHOLD, { mirrorState: 'CORROBORATED_DEGRADED' }),
      );
      expect(decision.fullHaltPosture).toBe(true);
      expect(decision.disposition).toBe('HALT');
    });
  }

  it('and `NORMAL` is never in the posture, because no declaration is open', () => {
    // `30 §5.1a`: "`continuous_unreachability = 0`, when no declaration is open."
    for (const { label, c } of CLASS_CASES) {
      const decision = classifyDispatchPrecedence(
        operands(c, new Date(T0.getTime() + 100 * HOUR), {
          mirrorState: 'NORMAL',
          unreachableSince: null,
        }),
      );
      expect(decision.fullHaltPosture, label).toBe(false);
      expect(decision.disposition, label).toBe(
        expectedFor('NORMAL', c).disposition,
      );
    }
  });
});

// =====================================================================================
// `§14`'s REQUIRED VULNERABLE CONTROL
// =====================================================================================

describe('`§14` — THE VULNERABLE CONTROL: the ordinary table, evaluated for ever', () => {
  it('UNSAFE at 30:00: at least one class is still FUTURE-DISPATCH ELIGIBLE', () => {
    // `§14`: "unsafe path continues to mark at least one class future-dispatch eligible".
    // This IS what S1H shipped — the posture was not implemented — so the control is the
    // accepted behaviour rather than a straw man.
    const eligible = CLASS_CASES.filter(
      ({ c }) =>
        unsafeProlongedUnreachabilityEvaluator(operands(c, AT_THRESHOLD))
          .futureDispatchEligible,
    );
    expect(eligible.length).toBeGreaterThan(0);
    // And REVERSIBLE specifically, which is the class item 5 names.
    const reversible = CLASS_CASES.find(({ c }) => c.recoverability === 'REVERSIBLE');
    expect(reversible).toBeDefined();
    const unsafe = unsafeProlongedUnreachabilityEvaluator(operands(reversible!.c, AT_THRESHOLD));
    expect(unsafe.matchedRow).toBe(5);
    expect(unsafe.disposition).toBe('DISPATCH_ELIGIBLE');
    expect(unsafe.futureDispatchEligible).toBe(true);
  });

  it('PRODUCTION at 30:00: FULL HALT, every class, REVERSIBLE included', () => {
    for (const { label, c } of CLASS_CASES) {
      const production = classifyDispatchPrecedence(operands(c, AT_THRESHOLD));
      expect(production.disposition, label).toBe('HALT');
      expect(production.fullHaltPosture, label).toBe(true);
    }
  });

  it('THE DISCRIMINATION, stated as one assertion, per class', () => {
    let discriminating = 0;
    for (const { label, c } of CLASS_CASES) {
      const unsafe = unsafeProlongedUnreachabilityEvaluator(operands(c, AT_THRESHOLD));
      const production = classifyDispatchPrecedence(operands(c, AT_THRESHOLD));
      if (unsafe.disposition !== production.disposition) {
        discriminating += 1;
        // Production is the STRICTER of the two, every time.
        expect(
          PERMISSIVENESS[production.disposition],
          label,
        ).toBeLessThan(PERMISSIVENESS[unsafe.disposition]);
      }
    }
    // Rows 1 and 2 halt in both, so not every class separates them — and the ones that do
    // are counted rather than asserted in aggregate.
    expect(discriminating).toBeGreaterThan(0);
  });

  it('and the two AGREE at 29:59.999 — so the difference is the POSTURE and nothing else', () => {
    // The control's rows are transcribed identically to production's. If the two disagreed
    // below the threshold, the discrimination above would be attributable to a different
    // row predicate rather than to `§5.1a`'s reduction.
    for (const { label, c } of CLASS_CASES) {
      const unsafe = unsafeProlongedUnreachabilityEvaluator(operands(c, JUST_INSIDE));
      const production = classifyDispatchPrecedence(operands(c, JUST_INSIDE));
      expect(unsafe.disposition, label).toBe(production.disposition);
      expect(unsafe.matchedRow, label).toBe(production.matchedRow);
    }
  });
});

// =====================================================================================
// THE TIMER'S DECLARED START AND RESET SEMANTICS, AGAINST REAL POSTGRESQL
// =====================================================================================

describe('`30 §5.1a` — the timer STARTS on declaration open', () => {
  it('`opened_at` is the operand, read from `mirror_declaration`', async () => {
    await declareMirrorDegraded(h.control, COMPANY_ID, 'PUSH_ACK_TIMEOUT', T0);
    const client = await h.control.connect();
    try {
      const openedAt = await openDeclarationOpenedAt(client, COMPANY_ID);
      expect(openedAt).not.toBeNull();
      expect(openedAt!.getTime()).toBe(T0.getTime());
    } finally {
      client.release();
    }
  });

  it('and NO declaration means the operand is null and the posture cannot hold', async () => {
    const client = await h.control.connect();
    try {
      expect(await openDeclarationOpenedAt(client, COMPANY_ID)).toBeNull();
    } finally {
      client.release();
    }
    const pair = await mirrorDispatchOperands(h.control, COMPANY_ID, AT_THRESHOLD);
    expect(pair.mirrorState).toBe('NORMAL');
    expect(pair.unreachableSince).toBeNull();
  });
});

describe('`30 §5.1a` — the timer RESETS ONLY on declaration close', () => {
  beforeEach(async () => {
    await declareMirrorDegraded(h.control, COMPANY_ID, 'PUSH_ACK_TIMEOUT', T0);
  });

  it('a REPEATED declaration does not restart it', async () => {
    // `declareMirrorDegraded` returns the existing declaration, and
    // `mirror_declaration_one_open_per_company` makes a second impossible anyway.
    await declareMirrorDegraded(h.control, COMPANY_ID, 'PUSH_ACK_TIMEOUT', JUST_INSIDE);
    const client = await h.control.connect();
    try {
      const openedAt = await openDeclarationOpenedAt(client, COMPANY_ID);
      expect(openedAt!.getTime()).toBe(T0.getTime());
    } finally {
      client.release();
    }
  });

  it('WRITING A CORROBORATION does not restart it — `opened_at` is not a corroboration column', async () => {
    // `30 §5.1a`: the timer "is not reset by [...] a signal arriving or expiring, by a
    // re-issued signal". Asserted STRUCTURALLY rather than by driving a signal: the only
    // table a consumed signal writes is `mirror_corroboration`, `opened_at` lives on
    // `mirror_declaration`, and the two are joined by nothing that could move it.
    //
    // The stronger half is the DIRECT ATTACK: an UPDATE that tries to move `opened_at`
    // forward, as the control plane's own role, so a reader does not have to take the
    // separation on trust.
    const client = await h.control.connect();
    try {
      const rows = await client.query<{ n: string }>(
        `SELECT count(*) AS n FROM information_schema.columns
          WHERE table_name = 'mirror_corroboration' AND column_name = 'opened_at'`,
      );
      expect(rows.rows[0]!.n).toBe('0');

      await client.query(
        `UPDATE mirror_declaration SET opened_at = $2
          WHERE company_id = $1 AND closed_at IS NULL`,
        [COMPANY_ID, JUST_INSIDE],
      );
      // The UPDATE is admitted by the schema — `mirror_declaration` carries no immutability
      // trigger, which is recorded rather than claimed away — so the operand's integrity
      // rests on the migration principal boundary (`49 §3.11`) and not on a trigger. What
      // this assertion establishes is that NO PRODUCTION PATH performs it: the value is
      // restored and the suite below drives every production path that touches the
      // declaration and finds `opened_at` unmoved.
      await client.query(
        `UPDATE mirror_declaration SET opened_at = $2
          WHERE company_id = $1 AND closed_at IS NULL`,
        [COMPANY_ID, T0],
      );
      expect((await openDeclarationOpenedAt(client, COMPANY_ID))!.getTime()).toBe(T0.getTime());
    } finally {
      client.release();
    }
  });

  it('a fresh evaluation at any later instant does not restart it', async () => {
    await evaluateState(h.control, COMPANY_ID, JUST_INSIDE);
    await evaluateState(h.control, COMPANY_ID, AT_THRESHOLD);
    await evaluateState(h.control, COMPANY_ID, new Date(T0.getTime() + 100 * HOUR));
    const client = await h.control.connect();
    try {
      expect((await openDeclarationOpenedAt(client, COMPANY_ID))!.getTime()).toBe(T0.getTime());
    } finally {
      client.release();
    }
  });

  it('CLOSING the declaration is what resets it, and then the posture cannot hold', async () => {
    const pairBefore = await mirrorDispatchOperands(h.control, COMPANY_ID, AT_THRESHOLD);
    expect(pairBefore.mirrorState).toBe('UNCORROBORATED_STALL');
    expect(pairBefore.unreachableSince!.getTime()).toBe(T0.getTime());

    await closeMirrorDeclaration(h.control, COMPANY_ID, AT_THRESHOLD);

    const pairAfter = await mirrorDispatchOperands(h.control, COMPANY_ID, AT_THRESHOLD);
    expect(pairAfter.mirrorState).toBe('NORMAL');
    expect(pairAfter.unreachableSince).toBeNull();
  });

  it('and a NEW declaration after a close starts a NEW interval, not a continuation', async () => {
    await closeMirrorDeclaration(h.control, COMPANY_ID, JUST_INSIDE);
    await declareMirrorDegraded(h.control, COMPANY_ID, 'PUSH_ACK_TIMEOUT', JUST_INSIDE);
    const client = await h.control.connect();
    try {
      const openedAt = await openDeclarationOpenedAt(client, COMPANY_ID);
      expect(openedAt!.getTime()).toBe(JUST_INSIDE.getTime());
      // So at `AT_THRESHOLD` the new interval is only 1ms old and the posture does not hold.
      expect(AT_THRESHOLD.getTime() - openedAt!.getTime()).toBeLessThan(T);
    } finally {
      client.release();
    }
  });
});

describe('THE DURABLE OPERANDS ARE COHERENT BY CONSTRUCTION', () => {
  it('`mirrorDispatchOperands` never returns an incoherent pair, and the classifier refuses one', async () => {
    await declareMirrorDegraded(h.control, COMPANY_ID, 'PUSH_ACK_TIMEOUT', T0);
    const pair = await mirrorDispatchOperands(h.control, COMPANY_ID, AT_THRESHOLD);
    expect(pair.mirrorState).not.toBe('NORMAL');
    expect(pair.unreachableSince).not.toBeNull();

    const base = operands(CLASS_CASES[0]!.c, AT_THRESHOLD);
    // The classifier throws on both incoherent pairs, rather than reading either
    // conservatively — a null accepted alongside a degraded state would be an indefinite
    // exemption from the posture.
    expect(() =>
      classifyDispatchPrecedence({ ...base, mirrorState: 'NORMAL', unreachableSince: T0 }),
    ).toThrow(/incoherent operands/);
    expect(() =>
      classifyDispatchPrecedence({
        ...base,
        mirrorState: 'UNCORROBORATED_STALL',
        unreachableSince: null,
      }),
    ).toThrow(/incoherent operands/);
  });

  it('and the durable pair, fed to the classifier, produces the FULL HALT', async () => {
    await declareMirrorDegraded(h.control, COMPANY_ID, 'PUSH_ACK_TIMEOUT', T0);
    const pair = await mirrorDispatchOperands(h.control, COMPANY_ID, AT_THRESHOLD);
    for (const { label, c } of CLASS_CASES) {
      const decision = classifyDispatchPrecedence({
        ...operands(c, AT_THRESHOLD),
        mirrorState: pair.mirrorState,
        unreachableSince: pair.unreachableSince,
      });
      expect(decision.disposition, label).toBe('HALT');
    }
  });
});

// =====================================================================================
// `§16` — THE OVERRIDE, COMPOSED EXACTLY AS THE ARCHITECTURE COMPOSES IT
// =====================================================================================

describe('`30 §5.1a` — the override escapes the posture on ROWS 3 AND 4 ONLY', () => {
  function signGrant(req: OverrideRequest, key: KeyObject): Buffer {
    return signEd25519(null, overrideGrantBytes(req), key);
  }

  async function grantRows(rows: readonly (3 | 4)[]): Promise<void> {
    const req: OverrideRequest = {
      companyId: COMPANY_ID,
      overrideId: 'override:posture',
      requestedBy: OWNER_ONE,
      requestedAt: T0,
      effectClasses: ['refund.create', 'campaign.pause'],
      recoverabilityClasses: ['COMPENSABLE', 'REVERSIBLE'],
      precedenceRows: rows,
      startsAt: T0,
      // `51 §3.6`: `max_override_duration` 24 hours. UNCHANGED by v1.3.3.
      expiresAt: new Date(T0.getTime() + 24 * HOUR),
      effectCountCap: 5n,
      monetaryExposureCap: money('50.00'),
      reason: 'a prolonged two-sided outage inside 30 §5.1a’s FULL-HALT POSTURE',
      incidentRef: h.seed.incidentRef,
    };
    await grantOverride(h.control, req, {
      grantedBy: OWNER_ONE,
      grantedAt: T0,
      grantSignature: signGrant(req, h.seed.ownerOne.privateKey),
    });
  }

  it('rows 3 and 4 ARE restored inside the posture, tagged and carrying the override id', async () => {
    await declareMirrorDegraded(h.control, COMPANY_ID, 'PUSH_ACK_TIMEOUT', T0);
    await grantRows([3, 4]);
    const client = await h.control.connect();
    try {
      const scope = await activeOverrideOn(client, COMPANY_ID, AT_THRESHOLD);
      expect(scope).not.toBeNull();

      const row3 = CLASS_CASES.find(({ c }) => c.clockBearing && c.recoverability === 'COMPENSABLE');
      const row4 = CLASS_CASES.find(
        ({ c }) => !c.clockBearing && c.recoverability === 'COMPENSABLE' && c.hasRecordedApproval,
      );
      for (const found of [row3, row4]) {
        expect(found).toBeDefined();
        const decision = classifyDispatchPrecedence(
          operands(found!.c, AT_THRESHOLD, { activeOverride: scope }),
        );
        const expected = expectedUnderFullHalt('UNCORROBORATED_STALL', found!.c, true);
        expect(decision.fullHaltPosture, found!.label).toBe(true);
        expect(decision.haltedByFullHaltPosture, found!.label).toBe(false);
        expect(decision.disposition, found!.label).toBe(expected.disposition);
        expect(decision.matchedRow, found!.label).toBe(expected.row);
        // `30 §5.7.2` item 5: "Every dispatch under it is tagged `DISPATCHED_UNMIRRORED`
        // **and** carries `override_id`." Unqualified, and unchanged by v1.3.3.
        expect(decision.requiresUnmirroredTag, found!.label).toBe(true);
        expect(decision.overrideId, found!.label).toBe('override:posture');
      }
    } finally {
      client.release();
    }
  });

  it('ROW 5 IS NOT — REVERSIBLE has no override path out of the posture', async () => {
    // `30 §5.1a`: "Row 5's REVERSIBLE dispatch, which the posture is what halts, has **no**
    // override path — `precedence_rows` cannot hold `5`."
    await declareMirrorDegraded(h.control, COMPANY_ID, 'PUSH_ACK_TIMEOUT', T0);
    await grantRows([3, 4]);
    const client = await h.control.connect();
    try {
      const scope = await activeOverrideOn(client, COMPANY_ID, AT_THRESHOLD);
      const reversible = CLASS_CASES.find(({ c }) => c.recoverability === 'REVERSIBLE');
      const decision = classifyDispatchPrecedence(
        operands(reversible!.c, AT_THRESHOLD, { activeOverride: scope }),
      );
      expect(decision.matchedRow).toBe(5);
      expect(decision.disposition).toBe('HALT');
      expect(decision.haltedByFullHaltPosture).toBe(true);
      expect(decision.overrideId).toBeNull();
      // And there is no escape to offer the owner for it.
      expect(decision.ownerOverrideAvailable).toBe(false);
    } finally {
      client.release();
    }
  });

  it('and an override naming row 5 CANNOT BE GRANTED AT ALL — the grant path refuses it', async () => {
    // `51 §3.6` makes `{3, 4}` the structural grantable set, and `0009__mirror_state.sql`
    // carries the CHECK. v1.3.3 did not widen it, and this asserts the refusal against real
    // PostgreSQL rather than inferring it from the classifier's behaviour above.
    await declareMirrorDegraded(h.control, COMPANY_ID, 'PUSH_ACK_TIMEOUT', T0);
    await expect(grantRows([5 as unknown as 3])).rejects.toThrow();
  });

  it('rows 1 and 2 are not restored inside the posture either', async () => {
    await declareMirrorDegraded(h.control, COMPANY_ID, 'PUSH_ACK_TIMEOUT', T0);
    await grantRows([3, 4]);
    const client = await h.control.connect();
    try {
      const scope = await activeOverrideOn(client, COMPANY_ID, AT_THRESHOLD);
      for (const { label, c } of CLASS_CASES.filter(({ c }) =>
        [1, 2].includes(expectedFor('UNCORROBORATED_STALL', c).row),
      )) {
        const decision = classifyDispatchPrecedence(
          operands(c, AT_THRESHOLD, { activeOverride: scope }),
        );
        expect(decision.disposition, label).toBe('HALT');
        expect(decision.overrideId, label).toBeNull();
        expect(decision.ownerOverrideAvailable, label).toBe(false);
      }
    } finally {
      client.release();
    }
  });

  it('an EXPIRED override does not escape the posture — expiry halts rather than suspends', async () => {
    // The additive counterpart to `vc-a2e-override.test.ts`'s accepted "expiry restores
    // NOTHING" assertion, which holds the posture out of scope. Inside the posture the
    // suspended row is HALTED rather than suspended, and that is stricter, not looser.
    await declareMirrorDegraded(h.control, COMPANY_ID, 'PUSH_ACK_TIMEOUT', T0);
    const client = await h.control.connect();
    try {
      expect(await activeOverrideOn(client, COMPANY_ID, AT_THRESHOLD)).toBeNull();
    } finally {
      client.release();
    }
    const row3 = CLASS_CASES.find(({ c }) => c.clockBearing && c.recoverability === 'COMPENSABLE');
    const decision = classifyDispatchPrecedence(operands(row3!.c, AT_THRESHOLD));
    expect(decision.matchedRow).toBe(3);
    expect(decision.disposition).toBe('HALT');
    expect(decision.haltedByFullHaltPosture).toBe(true);
    // Still restorable IN PRINCIPLE — rows 3 and 4 keep their escape — which is what
    // `ownerOverrideAvailable` reports and what the owner is offered.
    expect(decision.ownerOverrideAvailable).toBe(true);
  });
});

describe('THE THRESHOLD USED IS THE DECLARED ONE', () => {
  it('the posture boundary is `ORACLE_FULL_HALT_MS`, from the hand-authored reading', () => {
    // A seeded change to production's constant moves the boundary, and this suite's
    // `JUST_INSIDE`/`AT_THRESHOLD` are computed from production's — so the assertion that
    // ties them to the architecture is here, against the transcription that imports nothing.
    expect(T).toBe(ORACLE_FULL_HALT_MS);
    expect(AT_THRESHOLD.getTime() - T0.getTime()).toBe(ORACLE_FULL_HALT_MS);
    expect(JUST_INSIDE.getTime() - T0.getTime()).toBe(ORACLE_FULL_HALT_MS - 1);
  });
});
