import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  classifyDispatchPrecedence,
  type PrecedenceOperands,
} from '../../src/kernel/mirror/dispatchPrecedence.js';
import { money, type Money } from '../../src/kernel/exposure/money.js';
import {
  ORACLE_STATES,
  allOracleCases,
  expectedFor,
  oracleIsAboveApprovalFloor,
  type OracleState,
} from '../support/mirrorPrecedenceTable.js';

/**
 * `S1H-C1` CLOSED — PRECEDENCE ROW 2's OPERAND IS DERIVED FROM THE DECLARED QUANTITY, AND
 * THE MODEL AND THE CALLER CANNOT CHOOSE IT. v1.3.3, `51 §3.7`, `30 §5.1a`.
 *
 * =================================================================================
 * WHAT S1H SHIPPED, AND WHAT THIS SUITE PROVES INSTEAD.
 *
 * S1H's `PrecedenceOperands` carried `aboveApprovalFloor: boolean`, because v1.3.2 declared
 * no numeric floor anywhere and `§42` of the S1H mandate forbids inventing one. The ROW-2
 * BEHAVIOUR was fully tested over both values; the DERIVATION was PARTIAL, and the boolean
 * was an AUTHORITY ESCAPE HATCH — a caller passing `false` skipped row 2 entirely.
 *
 * `51 §3.7` declares the quantity, so `§13` of the owner-resolution mandate requires the
 * hatch to be removed rather than renamed: "The model/caller must not choose
 * `aboveApprovalFloor`. Trusted code derives it from `total_exposure > USD 20.00`. If the
 * current public classifier accepts a free boolean for production convenience: remove or
 * internalize that authority escape hatch."
 *
 * IT IS REMOVED, AND NO TEST-ONLY SEAM RE-ADMITS IT. The truth table is still exercised
 * over both values of the predicate — by choosing exposures either side of the declared
 * floor, which is strictly stronger than a seam because it proves the derivation too.
 * =================================================================================
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const PRECEDENCE_SOURCE = join(HERE, '../../src/kernel/mirror/dispatchPrecedence.ts');

const NOW = new Date('2026-03-01T12:00:00.000Z');

/** Executable lines only — comment lines stripped. Used by the absence assertions below. */
function codeOnly(source: string): string {
  return source
    .split('\n')
    .filter((line) => !/^\s*(\*|\/\*|\/\/)/.test(line))
    .join('\n');
}

function refund(
  state: OracleState,
  totalExposure: Money,
  over: Partial<PrecedenceOperands> = {},
): PrecedenceOperands {
  return {
    mirrorState: state,
    actionClass: 'refund.create',
    recoverability: 'COMPENSABLE',
    clockBearing: false,
    totalExposure,
    hasRecordedApproval: false,
    activeOverride: null,
    // Inside `51 §3.8`'s 30-minute threshold. The posture is `full-halt-posture.test.ts`'s
    // subject and would reduce every disposition here to HALT.
    unreachableSince: state === 'NORMAL' ? null : new Date(NOW.getTime() - 60_000),
    now: NOW,
    ...over,
  };
}

describe('THE OPERAND IS `total_exposure` AND THE TYPE IS THE PROOF', () => {
  it('`PrecedenceOperands` carries no boolean the caller could use to skip row 2', async () => {
    // A SOURCE PROPERTY, not a behavioural one, because the property is an ABSENCE. `§13`:
    // "remove or internalize that authority escape hatch."
    const source = await readFile(PRECEDENCE_SOURCE, 'utf8');
    const operandBlock = source.slice(
      source.indexOf('export interface PrecedenceOperands {'),
      source.indexOf('export interface OverrideScope {'),
    );
    expect(operandBlock).not.toBe('');
    // No field of any name declares the predicate directly.
    expect(operandBlock).not.toMatch(/aboveApprovalFloor\s*:/);
    expect(operandBlock).not.toMatch(/aboveFloor\s*:/);
    expect(operandBlock).not.toMatch(/approvalFloor\s*:\s*boolean/);
    expect(operandBlock).not.toMatch(/fullHalt\s*:\s*boolean/);
    // And the declared operand is present, typed as Money.
    expect(operandBlock).toMatch(/readonly totalExposure: Money;/);
  });

  it('and no TEST-ONLY seam re-admits it — nothing in `src/` exports one', async () => {
    const source = await readFile(PRECEDENCE_SOURCE, 'utf8');
    // `§13` permits a test-only seam and this implementation does not use one, because
    // exposures either side of the declared floor exercise the same truth table. Asserted so
    // a future convenience export is a failure rather than a quiet regression.
    expect(source).not.toMatch(/export function classify\w*ForTest/);
    expect(source).not.toMatch(/ForTest\s*\(/);
    // Over EXECUTABLE lines only: the file's own documentation names the withdrawn boolean
    // in order to record why it is gone (`S1H-C1`), and a denylist that forbade the word in
    // prose would forbid the explanation rather than the hatch.
    expect(codeOnly(source)).not.toMatch(/aboveApprovalFloor/);
  });

  it('`vendor_amount` is not read anywhere in the classifier', async () => {
    // `51 §3.7`: "Not `exposure.vendor_amount`, not a dispatch amount, not a model-supplied
    // amount, not a `rationale` figure, not grant prose." The classifier has no field that
    // could carry any of them, and the source names none.
    const code = codeOnly(await readFile(PRECEDENCE_SOURCE, 'utf8'));
    expect(code).not.toMatch(/vendorAmount/);
    expect(code).not.toMatch(/vendor_amount/);
    expect(code).not.toMatch(/dispatchAmount/);
    expect(code).not.toMatch(/rationale/);
  });
});

describe('`30 §5.1a`s BOUNDARY TABLE, row by row, through the real classifier', () => {
  // `30 §5.1a` prints the band. Every row of it, with the expectation decided from the
  // architecture text and NOT from production's constant.
  //
  //   | `$19.99` | admits | No                                  | row 2 does not match |
  //   | `$20.00` | admits | **No** — the comparison is strict    | row 2 does not match |
  //   | `$20.01` | admits | **Yes**                              | row 2 matches        |
  //   | `$25.00` | admits (`<=`) | Yes                           | row 2 matches        |
  //
  // The fixture is a non-clock-bearing, unapproved COMPENSABLE refund, which is exactly the
  // effect row 2 exists to intercept. Below the floor it falls to row 4 and SUSPENDS; above
  // it, row 2 matches and it HALTS.
  const BAND: readonly [string, 1 | 2 | 3 | 4 | 5, 'HALT' | 'SUSPEND'][] = [
    ['19.99', 4, 'SUSPEND'],
    ['20.00', 4, 'SUSPEND'],
    ['20.01', 2, 'HALT'],
    ['22.00', 2, 'HALT'],
    ['25.00', 2, 'HALT'],
  ];

  for (const state of ORACLE_STATES) {
    for (const [literal, row, disposition] of BAND) {
      it(`${state} — $${literal} reaches row ${String(row)} and ${disposition}s`, () => {
        const decision = classifyDispatchPrecedence(refund(state, money(literal)));
        expect(decision.matchedRow).toBe(row);
        expect(decision.disposition).toBe(disposition);
      });
    }
  }

  it('$20.00 and $20.01 differ, and the difference is one minor unit', () => {
    // THE ASSERTION `§24` CRITERION 3 ASKS FOR, as one statement.
    const at = classifyDispatchPrecedence(refund('UNCORROBORATED_STALL', money('20.00')));
    const above = classifyDispatchPrecedence(refund('UNCORROBORATED_STALL', money('20.01')));
    expect(at.matchedRow).toBe(4);
    expect(at.disposition).toBe('SUSPEND');
    expect(above.matchedRow).toBe(2);
    expect(above.disposition).toBe('HALT');
    expect(money('20.01') - money('20.00')).toBe(1n);
  });

  it('$25.01 is above the floor too — and is a POLICY DENY before precedence is reached', () => {
    // `30 §5.1a`: "`$25.01` | **DENIES `PER_ACTION`** | not evaluated | **never reaches item
    // 4**". This suite cannot assert the DENY — that is `26 §8`'s Cedar bound and
    // `vendor-amount-policy-binding.test.ts` has asserted it since S1C — so what is asserted
    // here is the DISTINCTION: the floor predicate is true at $25.01, which is why the two
    // bounds have to be separate quantities rather than one.
    expect(oracleIsAboveApprovalFloor('25.01')).toBe(true);
    const decision = classifyDispatchPrecedence(refund('NORMAL', money('25.01')));
    // The classifier would halt it at row 2 IF it ever saw it. It does not: the policy gate
    // runs first and denies, and `30 §5.1a` states the ordering.
    expect(decision.matchedRow).toBe(2);
    expect(decision.disposition).toBe('HALT');
  });
});

describe('`30 §5.1` item 4 row 2s OTHER TWO CONJUNCTS still hold at the declared floor', () => {
  it('above the floor AND clock-bearing reaches row 3, not row 2', () => {
    // "Above the per-action approval floor **and not** clock-bearing". `30 §5.1`: "An
    // above-floor clock-bearing COMPENSABLE effect [...] reaches row 3 and dispatches."
    const decision = classifyDispatchPrecedence(
      refund('NORMAL', money('22.00'), { clockBearing: true }),
    );
    expect(decision.matchedRow).toBe(3);
    expect(decision.disposition).toBe('DISPATCH_ELIGIBLE');
  });

  it('above the floor AND carrying a recorded approval is NEVER row 2', () => {
    // `phase2-v1.2-remediation-ledger.md`: "an effect carrying a recorded approval is
    // evaluated at row 3 or row 5, **never row 2**". `S1H-C7` records that "rows 3 or 5" is
    // imprecise — a discretionary COMPENSABLE effect falls to row 4 — and that "never row 2"
    // is the operative half.
    const decision = classifyDispatchPrecedence(
      refund('NORMAL', money('22.00'), { hasRecordedApproval: true }),
    );
    expect(decision.matchedRow).toBe(4);
    expect(decision.disposition).toBe('SUSPEND');
  });

  it('and an above-floor REVERSIBLE effect still halts at row 2 — row 2 is class-blind', () => {
    // `30 §5.1`: "row 2 intercepts above-floor unapproved non-clock-bearing effects of ANY
    // class." So REVERSIBLE does not escape it, which is what makes row 2 before row 5 load
    // bearing.
    const decision = classifyDispatchPrecedence({
      ...refund('NORMAL', money('22.00')),
      actionClass: 'campaign.pause',
      recoverability: 'REVERSIBLE',
    });
    expect(decision.matchedRow).toBe(2);
    expect(decision.disposition).toBe('HALT');
  });
});

describe('THE FULL `VC-A2` CROSS-PRODUCT, WITH THE DERIVED OPERAND', () => {
  it('72 rows, and every one matches the hand-authored table', () => {
    // `§13`: "Run the full VC-A2 cross-product with the real declared quantity rather than a
    // caller-supplied test boolean. [...] Assert that S1H's existing hand-authored expected
    // table still stands."
    //
    // `vc-a2-inversion.test.ts` runs the same cross-product as its own suite. This is the
    // ASSERTION THAT THE TABLE DID NOT MOVE when the operand changed: the same 72 rows, the
    // same hand-authored expectations, now reached through `total_exposure`.
    const cases = allOracleCases();
    expect(cases).toHaveLength(24);
    let rows = 0;
    for (const state of ORACLE_STATES) {
      for (const c of cases) {
        const expected = expectedFor(state, c);
        const decision = classifyDispatchPrecedence({
          ...refund(state, money(c.totalExposure)),
          actionClass:
            c.recoverability === 'COMPENSABLE'
              ? 'refund.create'
              : c.recoverability === 'REVERSIBLE'
                ? 'campaign.pause'
                : 'fulfilment.reship',
          recoverability: c.recoverability,
          clockBearing: c.clockBearing,
          hasRecordedApproval: c.hasRecordedApproval,
        });
        const label = `${state}/${c.recoverability}/clock=${String(c.clockBearing)}/$${
          c.totalExposure
        }/approved=${String(c.hasRecordedApproval)}`;
        expect(decision.disposition, label).toBe(expected.disposition);
        expect(decision.matchedRow, label).toBe(expected.row);
        expect(decision.requiresUnmirroredTag, label).toBe(expected.requiresUnmirroredTag);
        rows += 1;
      }
    }
    expect(rows).toBe(72);
  });

  it('and row 2 is REACHED by the cross-product — the derivation is not vacuous', () => {
    // If the declared floor were above every exposure the cross-product uses, every
    // assertion above would pass with row 2 never matching. Counted, so it cannot.
    let row2 = 0;
    for (const state of ORACLE_STATES) {
      for (const c of allOracleCases()) {
        const decision = classifyDispatchPrecedence({
          ...refund(state, money(c.totalExposure)),
          actionClass:
            c.recoverability === 'COMPENSABLE'
              ? 'refund.create'
              : c.recoverability === 'REVERSIBLE'
                ? 'campaign.pause'
                : 'fulfilment.reship',
          recoverability: c.recoverability,
          clockBearing: c.clockBearing,
          hasRecordedApproval: c.hasRecordedApproval,
        });
        if (decision.matchedRow === 2) row2 += 1;
      }
    }
    expect(row2).toBeGreaterThan(0);
  });
});
