import { describe, expect, it } from 'vitest';

import {
  PRECEDENCE_ROW_ORDER,
  classifyDispatchPrecedence,
  type PrecedenceOperands,
} from '../../src/kernel/mirror/dispatchPrecedence.js';
import {
  UNSAFE_ROW_3_BEFORE_ROW_2,
  UNSAFE_ROW_4_BEFORE_ROW_3,
  unsafeEvaluate,
} from '../negative-controls/unsafe-precedence-order.js';
import { money } from '../../src/kernel/exposure/money.js';
import { expectedFor, type OracleState } from '../support/mirrorPrecedenceTable.js';

/**
 * `VC-A6` — THE DISPATCH PRECEDENCE IS AN ORDERED FIRST-MATCH LIST.
 *
 * =================================================================================
 * `36 §9`, VC-A6, verbatim:
 *
 *   "**VC-A6 — dispatch precedence is a first-match list.** The ambiguous fixture, directly:
 *    a **$30 refund inside a live FTC clock**, above the $25 approval floor. Assert exactly
 *    one behaviour — it reaches row 3 and dispatches, journalling `DISPATCHED_UNMIRRORED`.
 *    Assert an IRRECOVERABLE effect halts at row 1 **regardless** of clock or approval, and
 *    an above-floor non-clock-bearing effect halts at row 2. **Assert no fixture matches two
 *    rows with different outcomes** — the property v1.1's five-row table did not have."
 *
 * `§22` of the S1H mandate additionally requires a TEST-ONLY evaluator with the rows in a
 * different order, and "at least one effect whose outcome changes under the wrong ordering".
 * =================================================================================
 */

const NOW = new Date('2026-03-01T12:00:00.000Z');

function refundOperands(
  state: OracleState,
  over: Partial<PrecedenceOperands> = {},
): PrecedenceOperands {
  return {
    mirrorState: state,
    actionClass: 'refund.create',
    recoverability: 'COMPENSABLE',
    clockBearing: true,
    // v1.3.3: `51 §3.7`'s declared operand. `$22.00` is above the `$20.00` floor and still
    // admitted by `refund.create`'s `$25.00` `per_action_max` — `36`'s re-based VC-A6
    // fixture. There is no boolean to pass here any more (`S1H-C1`).
    totalExposure: money('22.00'),
    hasRecordedApproval: true,
    activeOverride: null,
    // Well inside `51 §3.8`'s 30-minute threshold: `30 §5.1a`'s FULL-HALT POSTURE is
    // `full-halt-posture.test.ts`'s subject and would otherwise mask every row here.
    unreachableSince: state === 'NORMAL' ? null : new Date(NOW.getTime() - 60_000),
    now: NOW,
    ...over,
  };
}

describe('the row order is the ARCHITECTURE order', () => {
  it('rows 1..5, and the assertion is against a literal transcribed from `30 §5.1`', () => {
    // The literal is written out here, from `30 §5.1` item 4's table, rather than read from
    // the module under test. `PRECEDENCE_ROW_ORDER` exists to be COMPARED against it.
    expect([...PRECEDENCE_ROW_ORDER]).toEqual([1, 2, 3, 4, 5]);
  });
});

describe("`VC-A6`'s three named fixtures", () => {
  it('the $30 refund inside a live FTC clock reaches ROW 3 and dispatches in NORMAL', () => {
    // `30 §5.1`: "An above-floor clock-bearing COMPENSABLE effect — the $30 refund — reaches
    // row 3 and dispatches, because the approval has already been given and the statutory
    // clock is the reason the architecture accepted this trade in the first place."
    const d = classifyDispatchPrecedence(refundOperands('NORMAL'));
    expect(d.matchedRow).toBe(3);
    expect(d.disposition).toBe('DISPATCH_ELIGIBLE');
  });

  it('and it reaches ROW 3 and is TAGGED in CORROBORATED_DEGRADED', () => {
    const d = classifyDispatchPrecedence(refundOperands('CORROBORATED_DEGRADED'));
    expect(d.matchedRow).toBe(3);
    expect(d.disposition).toBe('DISPATCH_ELIGIBLE');
    expect(d.requiresUnmirroredTag).toBe(true);
  });

  it('an IRRECOVERABLE effect matches ROW 1 REGARDLESS of clock or approval, and its behaviour is STATE-QUALIFIED', () => {
    // ---------------------------------------------------------------------------------
    // `30 §5.1` as v1.3.4 issues it: "An IRRECOVERABLE effect matches row 1 regardless of
    // clock or approval, and row 1 is where the trade is refused **in the two degraded
    // states**."
    //
    // TWO PROPERTIES, ASSERTED SEPARATELY BECAUSE THEY ARE DIFFERENT PROPERTIES:
    //
    //   (1) THE MATCH IS UNCONDITIONAL. Row 1 matches on `recoverability` alone, in every
    //       state, for every combination of the other three operands. `30 §5.1b`: "Row 1's
    //       CONDITION is unchanged [...] Its POSITION is unchanged: first, ahead of row 2,
    //       in every state." This is what keeps row 2 unreachable for the class and keeps
    //       the correction from moving anything else.
    //
    //   (2) THE BEHAVIOUR IS STATE-QUALIFIED. Dispatch in `NORMAL`, Halt in both degraded
    //       states. `30 §5.1b`: "`NORMAL` is the state in which the effect is *not*
    //       unmirrored."
    //
    // All eight combinations of the other three operands, in all three states — so a
    // clock, an approval or an above-floor exposure changing the answer would fail here.
    // ---------------------------------------------------------------------------------
    for (const state of ['NORMAL', 'UNCORROBORATED_STALL', 'CORROBORATED_DEGRADED'] as const) {
      for (const clockBearing of [false, true]) {
        for (const totalExposure of ['19.99', '20.01']) {
          for (const hasRecordedApproval of [false, true]) {
            const d = classifyDispatchPrecedence({
              mirrorState: state,
              actionClass: 'fulfilment.reship',
              recoverability: 'IRRECOVERABLE',
              clockBearing,
              totalExposure: money(totalExposure),
              hasRecordedApproval,
              activeOverride: null,
              unreachableSince: state === 'NORMAL' ? null : new Date(NOW.getTime() - 60_000),
              now: NOW,
            });
            expect(d.matchedRow).toBe(1);
            expect(d.disposition).toBe(state === 'NORMAL' ? 'DISPATCH_ELIGIBLE' : 'HALT');
            // `36 §6`: the tag follows `CORROBORATED_DEGRADED` and an override dispatch.
            // Row 1 in `NORMAL` is neither — in `NORMAL` the row IS mirrored, which is why
            // it dispatches at all — and in the degraded states it halts, so nothing is
            // tagged in any of the three.
            expect(d.requiresUnmirroredTag).toBe(false);
            // `30 §5.1` item 5: "An override restores precedence rows 3 and 4 only, never
            // rows 1 or 2." UNCHANGED by v1.3.4, in EVERY state — so there is no owner
            // escape to offer for this effect anywhere, including where it halts.
            expect(d.ownerOverrideAvailable).toBe(false);
          }
        }
      }
    }
  });

  it('an above-floor NON-clock-bearing UNAPPROVED effect halts at ROW 2', () => {
    const d = classifyDispatchPrecedence(
      refundOperands('NORMAL', { clockBearing: false, hasRecordedApproval: false }),
    );
    expect(d.matchedRow).toBe(2);
    expect(d.disposition).toBe('HALT');
    expect(d.ownerOverrideAvailable).toBe(false);
  });

  it('but WITH a recorded approval it is never evaluated at row 2', () => {
    // `30 §5.1`: "**Approval-bearing effects evaluate at rows 3 or 5 once approved.**"
    // `phase2-v1.2-remediation-ledger.md`: "an effect carrying a recorded approval is
    // evaluated at row 3 or row 5, **never row 2**."
    //
    // `S1H-C7` records that "rows 3 or 5" is imprecise for a COMPENSABLE DISCRETIONARY
    // above-floor approved effect: row 3 requires a clock, so it falls to row 4 and suspends.
    // "Never row 2" is the operative half and is what is asserted.
    const approved = classifyDispatchPrecedence(
      refundOperands('NORMAL', { clockBearing: false, hasRecordedApproval: true }),
    );
    expect(approved.matchedRow).not.toBe(2);
    expect(approved.matchedRow).toBe(4);
    expect(approved.disposition).toBe('SUSPEND');

    const reversible = classifyDispatchPrecedence(
      refundOperands('NORMAL', {
        actionClass: 'campaign.pause',
        recoverability: 'REVERSIBLE',
        clockBearing: false,
        hasRecordedApproval: true,
      }),
    );
    expect(reversible.matchedRow).toBe(5);
    expect(reversible.disposition).toBe('DISPATCH_ELIGIBLE');
  });
});

describe('`VC-A6` — NO FIXTURE MATCHES TWO ROWS WITH DIFFERENT OUTCOMES', () => {
  it('the five predicates never yield two matches with disagreeing behaviour', () => {
    // The property v1.1's table did not have (AUD-05). Established by evaluating the
    // predicates INDEPENDENTLY here — written out from `30 §5.1` in this file — and checking
    // that wherever two match, the architecture's behaviour for them agrees, OR the earlier
    // one is the architecture's declared winner.
    //
    // Rows 1..5 as predicates, transcribed here and not imported:
    const predicates: readonly [number, (o: PrecedenceOperands) => boolean][] = [
      [1, (o) => o.recoverability === 'IRRECOVERABLE'],
      // `51 §3.7`'s strict comparison, transcribed here in minor units and NOT imported:
      // `total_exposure > 20.00` is above the floor.
      [2, (o) => o.totalExposure > 2000n && !o.clockBearing && !o.hasRecordedApproval],
      [3, (o) => o.clockBearing && o.recoverability === 'COMPENSABLE'],
      [4, (o) => o.recoverability === 'COMPENSABLE' && !o.clockBearing],
      [5, (o) => o.recoverability === 'REVERSIBLE'],
    ];

    let multiMatchCount = 0;
    for (const state of ['NORMAL', 'UNCORROBORATED_STALL', 'CORROBORATED_DEGRADED'] as const) {
      for (const recoverability of ['REVERSIBLE', 'COMPENSABLE', 'IRRECOVERABLE'] as const) {
        for (const clockBearing of [false, true]) {
          for (const totalExposure of ['19.99', '20.01']) {
            for (const hasRecordedApproval of [false, true]) {
              const o: PrecedenceOperands = {
                mirrorState: state,
                actionClass:
                  recoverability === 'COMPENSABLE'
                    ? 'refund.create'
                    : recoverability === 'REVERSIBLE'
                      ? 'campaign.pause'
                      : 'fulfilment.reship',
                recoverability,
                clockBearing,
                totalExposure: money(totalExposure),
                hasRecordedApproval,
                activeOverride: null,
                unreachableSince:
                  state === 'NORMAL' ? null : new Date(NOW.getTime() - 60_000),
                now: NOW,
              };
              const matching = predicates.filter(([, p]) => p(o)).map(([row]) => row);
              expect(matching.length, 'the five rows must be exhaustive').toBeGreaterThan(0);
              if (matching.length > 1) multiMatchCount += 1;
              // FIRST MATCH WINS, and production must have taken the FIRST.
              expect(classifyDispatchPrecedence(o).matchedRow).toBe(matching[0]);
            }
          }
        }
      }
    }
    // And the overlap is REAL — AUD-05's whole point was that two rows match for the most
    // consequential case. If nothing overlapped, the ordering would be untested.
    expect(multiMatchCount).toBeGreaterThan(0);
  });
});

describe('THE VULNERABLE CONTROL — the rows in the wrong order', () => {
  it('`row 4 before row 3` SUSPENDS the clock-bearing refund that production DISPATCHES', () => {
    // THE DISCRIMINATING FIXTURE `§22` REQUIRES: "Construct at least one effect whose outcome
    // changes under the wrong ordering."
    const operands = refundOperands('NORMAL');

    const unsafe = unsafeEvaluate(UNSAFE_ROW_4_BEFORE_ROW_3, operands);
    expect(unsafe.row).toBe(4);
    expect(unsafe.disposition).toBe('SUSPEND');

    const production = classifyDispatchPrecedence(operands);
    expect(production.matchedRow).toBe(3);
    expect(production.disposition).toBe('DISPATCH_ELIGIBLE');

    // The two DIFFER, which is what makes the ordering assertion above meaningful rather
    // than a restatement of the predicates.
    expect(unsafe.disposition).not.toBe(production.disposition);
    // And production agrees with the HAND-AUTHORED table, while the unsafe evaluator does not.
    expect(production.disposition).toBe(
      expectedFor('NORMAL', {
        recoverability: 'COMPENSABLE',
        clockBearing: true,
        totalExposure: '22.00',
        hasRecordedApproval: true,
      }).disposition,
    );
  });

  it('`row 3 before row 2` is observationally EQUIVALENT here, and the suite says so', () => {
    // Recorded rather than claimed as a second discrimination. `30 §5.1` forbids this order
    // — "**Row 2 before row 3**" — but at the four action classes the S1 catalogue declares,
    // no effect distinguishes them: row 3 requires COMPENSABLE, and every above-floor
    // unapproved COMPENSABLE effect that is clock-bearing reaches row 3 under BOTH orders.
    //
    // `36 §0`'s discipline applied honestly: a control that does not discriminate is
    // reported as one, not counted as evidence.
    const separating: string[] = [];
    for (const recoverability of ['REVERSIBLE', 'COMPENSABLE', 'IRRECOVERABLE'] as const) {
      for (const clockBearing of [false, true]) {
        for (const totalExposure of ['19.99', '20.01']) {
          for (const hasRecordedApproval of [false, true]) {
            const o: PrecedenceOperands = {
              mirrorState: 'NORMAL',
              actionClass:
                recoverability === 'COMPENSABLE'
                  ? 'refund.create'
                  : recoverability === 'REVERSIBLE'
                    ? 'campaign.pause'
                    : 'fulfilment.reship',
              recoverability,
              clockBearing,
              totalExposure: money(totalExposure),
              hasRecordedApproval,
              activeOverride: null,
              unreachableSince: null,
              now: NOW,
            };
            const unsafe = unsafeEvaluate(UNSAFE_ROW_3_BEFORE_ROW_2, o);
            const production = classifyDispatchPrecedence(o);
            if (unsafe.disposition !== production.disposition) {
              separating.push(`${recoverability}/${String(clockBearing)}`);
            }
          }
        }
      }
    }
    expect(separating).toEqual([]);
  });
});
