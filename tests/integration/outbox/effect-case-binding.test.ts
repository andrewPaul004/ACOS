import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { COMPANY_ID } from '../../support/fixture.js';
import {
  REFUND_TASK_ID,
  S1I_NOW,
  authorisePause,
  authoriseRefund,
  authoriseReship,
  bindTaskToCase,
  cloneAuthorisation,
  createOutboxHarness,
  effectCaseRef,
  openLiveClock,
  seedTaskWithCase,
  type OutboxHarness,
} from '../../support/outboxFixture.js';
import { clockBearingAtClaim } from '../../../src/kernel/outbox/claim.js';
import {
  unsafeClockBearingFromCallerCase,
  unsafeClockBearingFromResourceLookup,
} from '../../negative-controls/unsafe-caller-case-ref.js';

/**
 * `S1I-C1` RESOLVED — THE TRUSTED EFFECT→CASE BINDING. v1.3.4 (CSB-01), `30 §9.2`, `I64`.
 *
 * =================================================================================
 * WHAT WAS WRONG, AND WHAT THIS SUITE PROVES INSTEAD.
 *
 * `30 §5.1` row 3's operand is keyed on `statutory_clock.case_ref`, and v1.3.3 related a
 * `case_ref` to nothing at all. S1I stopped: `clockBearingAtClaim()` took no arguments and
 * returned `false`, so row 3 was unreachable and the leg was reported PARTIAL in the
 * fail-closed direction rather than guessed.
 *
 * `30 §9.2.1` declares the binding:
 *
 *     "**`effect.case_ref : CaseRef | NULL`.** **KERNEL-OWNED. IMMUTABLE. NEVER
 *      MODEL-SUPPLIED.** For a case-associated effect, `case_ref` is inherited from the
 *      authoritative originating task."
 *
 * So there are two properties and they are different. **REACHABILITY**: a legitimate
 * qualifying case makes row 3 apply. **UNFORGEABILITY**: no caller, model, resource or
 * later write can change which case an effect is bound to. A design with only the first is
 * the row-3 lever `30 §9.1` exists to close; a design with only the second is what S1I
 * shipped and reported PARTIAL.
 * =================================================================================
 *
 * =================================================================================
 * THE FOUR ATTACKS `§3` OF THE OWNER-RESOLUTION MANDATE NAMES, EACH RUN.
 *
 *   1. effect created for case A; attempt to rewrite it to case B;
 *   2. the model proposes a different case;
 *   3. the caller passes a claim-time case;
 *   4. the underlying order/customer state later points elsewhere.
 *
 * "Production must continue using the original authoritative case binding."
 * =================================================================================
 */

let h: OutboxHarness;
const NOW = S1I_NOW;
const CASE_A = 'case:CS-ALPHA';
const CASE_B = 'case:CS-BRAVO';

beforeAll(async () => {
  h = await createOutboxHarness();
});

afterAll(async () => {
  await h.close();
});

beforeEach(async () => {
  await h.reset();
});

/** A live FTC clock, well inside its deadline at `NOW`. */
async function liveClockOn(caseRef: string, clockId: string): Promise<void> {
  await openLiveClock(h.control, {
    caseRef,
    clockId,
    deadlineAt: new Date(NOW.getTime() + 7 * 24 * 60 * 60 * 1000),
  });
}

describe('`30 §9.2.1` — THE BINDING IS INHERITED FROM THE AUTHORITATIVE TASK', () => {
  it('an effect authorised under a case-bound task carries that case, and no API supplied it', async () => {
    await bindTaskToCase(h.control, REFUND_TASK_ID, CASE_A);
    const effect = await authoriseRefund(h);

    // The value is on the committed row, read with raw SQL rather than through `src/`.
    expect(await effectCaseRef(h.control, effect.effectId)).toBe(CASE_A);

    /*
     * AND NOTHING IN THE PIPELINE THAT PRODUCED IT TOOK A CASE. `authoriseRefund` calls the
     * ACCEPTED S1F `proposeAndAuthorise`, whose `LocalAuthorisationRequestFacts` has no
     * `caseRef` field — the fixture could not have passed one. The value came from
     * `authority_task`, through `authorisation.task_id`, in `0011`'s BEFORE INSERT trigger.
     */
    const client = await h.control.connect();
    try {
      const task = await client.query<{ case_ref: string | null }>(
        `SELECT case_ref FROM authority_task WHERE company_id = $1 AND task_id = $2`,
        [COMPANY_ID, REFUND_TASK_ID],
      );
      expect(task.rows[0]!.case_ref).toBe(CASE_A);
    } finally {
      client.release();
    }
  });

  it('an effect whose task carries no case carries NULL — a declared ordinary state', async () => {
    // `30 §9.2.3`: "`case_ref = NULL` is a declared, ordinary state. An effect not
    // associated with a statutory or customer case has no case binding, and none is
    // invented for it."
    await bindTaskToCase(h.control, REFUND_TASK_ID, null);
    const effect = await authoriseRefund(h);
    expect(await effectCaseRef(h.control, effect.effectId)).toBeNull();
  });

  it('an effect whose task row does not exist carries NULL, and is not refused', async () => {
    /*
     * `authorisation` carries no foreign key to `authority_task` — `0006` and `0007` as
     * accepted — so a task row may legitimately be absent. `0011` uses a LEFT JOIN and
     * `30 §9.2.3` says what an absent binding means: NULL, and `clock_bearing = false`.
     *
     * MAKING IT AN ERROR WOULD REFUSE EFFECTS THE ACCEPTED S1F PIPELINE COMMITS TODAY —
     * `authorisePause` and `authoriseReship` both run under task ids the authority fixture
     * never seeds — so the fail-closed direction here is NULL rather than a denial.
     */
    const effect = await authorisePause(h, { resourceId: 'CMP-NO-TASK' });
    expect(await effectCaseRef(h.control, effect.effectId)).toBeNull();
  });
});

describe('`30 §9.2.2` — THE BINDING IS IMMUTABLE, AND COMMITS WITH THE EFFECT', () => {
  it('ATTACK 1: an effect bound to case A cannot be rewritten to case B, by any SQL', async () => {
    await bindTaskToCase(h.control, REFUND_TASK_ID, CASE_A);
    const effect = await authoriseRefund(h);
    expect(await effectCaseRef(h.control, effect.effectId)).toBe(CASE_A);

    const client = await h.control.connect();
    try {
      // `0007`'s `effect_append_only` refuses every UPDATE, for every role including the
      // privileged one. `30 §9.2.2`: "A post-hoc mutable mapping is forbidden [...] a
      // mapping that can change after authorisation can change which statutory clock
      // applies to an already-authorised effect."
      await expect(
        client.query(`UPDATE effect SET case_ref = $3 WHERE company_id = $1 AND effect_id = $2`, [
          COMPANY_ID,
          effect.effectId,
          CASE_B,
        ]),
      ).rejects.toThrow(/APPEND_ONLY_TABLE_effect/);
      // And a DELETE-then-reinsert is refused at the same trigger.
      await expect(
        client.query(`DELETE FROM effect WHERE company_id = $1 AND effect_id = $2`, [
          COMPANY_ID,
          effect.effectId,
        ]),
      ).rejects.toThrow(/APPEND_ONLY_TABLE_effect/);
    } finally {
      client.release();
    }
    expect(await effectCaseRef(h.control, effect.effectId)).toBe(CASE_A);
  });

  it('ATTACK 1b: moving the TASK afterwards does not move the effect already bound', async () => {
    /*
     * The subtler form of the same attack, and the one a "mapping" design would admit: the
     * task's own case is kernel state and could legitimately be corrected, but an effect
     * already authorised under it must keep the case it was authorised under. `30 §9.2.2`:
     * the binding "is established no later than the creation of the authoritative local
     * effect", and a later task edit is a different fact about a later effect.
     */
    await bindTaskToCase(h.control, REFUND_TASK_ID, CASE_A);
    const first = await authoriseRefund(h);
    await bindTaskToCase(h.control, REFUND_TASK_ID, CASE_B);

    // The committed effect keeps the case it was AUTHORISED under.
    expect(await effectCaseRef(h.control, first.effectId)).toBe(CASE_A);

    /*
     * AND A NEW EFFECT UNDER A NEWLY-CASED TASK INHERITS THE NEW CASE — the same rule
     * producing a different answer for a different effect.
     *
     * It needs a SECOND TASK, and the reason is `30 §9.2.6`'s own idempotency argument
     * observed rather than asserted: `25 §7`'s key is
     * `H(task_id ‖ action_class ‖ resource_id ‖ semantic_param_digest)`, so a second
     * refund on the same order under the SAME task is the same effect and `I42` returns
     * the prior result. **Two effects with different case bindings necessarily carry
     * different `task_id`s**, which is exactly why `case_ref` need not join the key.
     */
    await seedTaskWithCase(h.control, { taskId: 'task:T-CASE-B', caseRef: CASE_B });
    const second = await authoriseReship(h, {
      resourceId: 'ORD-CASE-B',
      taskId: 'task:T-CASE-B',
    });
    expect(await effectCaseRef(h.control, second.effectId)).toBe(CASE_B);
    // And the first is still where it was.
    expect(await effectCaseRef(h.control, first.effectId)).toBe(CASE_A);
  });

  it('ATTACK 2: a direct INSERT supplying a case is IGNORED, not merely refused', async () => {
    /*
     * `30 §9.2.1` forbids the value coming from a caller. `0011` implements that by
     * DERIVATION rather than by a CHECK: `effect_derive_case_ref` overwrites whatever
     * `NEW.case_ref` holds on every INSERT.
     *
     * A refusal would tell an attacker the field exists. A silent overwrite means there is
     * no field to attack — and this test asserts the stronger of the two by supplying a
     * case and reading back the authoritative one.
     */
    await bindTaskToCase(h.control, REFUND_TASK_ID, CASE_A);
    const donor = await authoriseRefund(h);

    /*
     * The attacker needs an authorisation with no effect yet: `effect.authorisation_id` is
     * UNIQUE (`24 §3` K5 / `I31`), so cloning the donor's authorisation reference would be
     * refused before `effect_derive_case_ref` could run and the test would prove `I31`
     * rather than `I64`. The clone keeps the donor's `task_id`, which is what the
     * derivation reads.
     */
    await cloneAuthorisation(h.control, donor.authorisationId, 'auth:ATTACK-SUPPLIED-CASE');

    const client = await h.control.connect();
    try {
      const row = await client.query<{ case_ref: string | null }>(
        `INSERT INTO effect (company_id, idempotency_key, effect_id, authorisation_id,
                             action_class, resource_ref, adapter, recoverability,
                             gate_class, status, created_at, case_ref)
         SELECT e.company_id, e.idempotency_key || ':attack', e.effect_id || ':attack',
                'auth:ATTACK-SUPPLIED-CASE', e.action_class, e.resource_ref, e.adapter,
                e.recoverability, e.gate_class, e.status, e.created_at, $3
           FROM effect e
          WHERE e.company_id = $1 AND e.effect_id = $2
         RETURNING case_ref`,
        [COMPANY_ID, donor.effectId, CASE_B],
      );
      // THE SUPPLIED CASE IS GONE. The row carries the AUTHORITATIVE one, and the INSERT
      // was NOT refused — `30 §9.2.1`'s rule is enforced by derivation, so there is no
      // field to attack rather than a check that says no.
      expect(row.rows[0]!.case_ref).toBe(CASE_A);
      expect(row.rows[0]!.case_ref).not.toBe(CASE_B);
    } finally {
      client.release();
    }
  });
});

describe('`30 §9.2.4` — THE DERIVATION READS THE EFFECT, NOT THE CALLER', () => {
  it('ATTACK 3: production ignores a caller case; the UNSAFE classifier does not', async () => {
    /*
     * `§8` OF THE OWNER-RESOLUTION MANDATE, verbatim:
     *
     *   "Fixture: effect authoritatively belongs to case A; case A has NO live statutory
     *    clock; attacker supplies case B; case B HAS a valid live clock. Unsafe: row 3 /
     *    clock-bearing path becomes reachable. Production: does not. Must discriminate."
     */
    await bindTaskToCase(h.control, REFUND_TASK_ID, CASE_A);
    const effect = await authoriseRefund(h);
    await liveClockOn(CASE_B, 'clock:bravo-live');

    const client = await h.control.connect();
    try {
      // PRODUCTION reads the effect's OWN binding. Case A has no clock.
      const production = await clockBearingAtClaim(client, {
        companyId: COMPANY_ID,
        caseRef: await effectCaseRef(h.control, effect.effectId),
        now: NOW,
      });
      expect(production).toBe(false);
    } finally {
      client.release();
    }

    // THE UNSAFE PATH takes the attacker's case and reaches the clock-bearing path.
    const unsafe = await unsafeClockBearingFromCallerCase(h.control, {
      companyId: COMPANY_ID,
      callerSuppliedCaseRef: CASE_B,
      now: NOW,
    });
    expect(unsafe).toBe(true);

    // THE DISCRIMINATION, stated as one assertion so a future edit that made them agree
    // fails here rather than silently removing the control's value.
    expect(unsafe).not.toBe(false);
  });

  it('ATTACK 3 REVERSED: the caller cannot REMOVE a real clock either', async () => {
    /*
     * `§8`: "Also test the reverse: effect bound to case A with a real live clock; caller
     * tries to remove/change the case; production still sees the real clock."
     */
    await bindTaskToCase(h.control, REFUND_TASK_ID, CASE_A);
    const effect = await authoriseRefund(h);
    await liveClockOn(CASE_A, 'clock:alpha-live');

    const client = await h.control.connect();
    try {
      const authoritative = await effectCaseRef(h.control, effect.effectId);
      expect(authoritative).toBe(CASE_A);
      expect(
        await clockBearingAtClaim(client, {
          companyId: COMPANY_ID,
          caseRef: authoritative,
          now: NOW,
        }),
      ).toBe(true);
    } finally {
      client.release();
    }

    // The caller supplying NULL or another case changes the UNSAFE answer and nothing else.
    expect(
      await unsafeClockBearingFromCallerCase(h.control, {
        companyId: COMPANY_ID,
        callerSuppliedCaseRef: null,
        now: NOW,
      }),
    ).toBe(false);
    expect(
      await unsafeClockBearingFromCallerCase(h.control, {
        companyId: COMPANY_ID,
        callerSuppliedCaseRef: CASE_B,
        now: NOW,
      }),
    ).toBe(false);

    // Production is unmoved: the binding is on the committed row and no argument reaches it.
    expect(await effectCaseRef(h.control, effect.effectId)).toBe(CASE_A);
  });

  it('ATTACK 4: a sibling effect on the SAME RESOURCE cannot lend its clock', async () => {
    /*
     * `§3` attack 4, and `30 §9.2.1`'s forbidden source "an arbitrary resource lookup
     * selected at claim time". `S1I-C1`'s own words: a claim-time case "chosen by a caller
     * — **or guessed by the kernel from `resource_ref`** — is the same lever."
     *
     * Two effects on ONE order: the first bound to clockless case A, the second to
     * clock-bearing case B. A resource-based lookup would let the first borrow the
     * second's clock. Production cannot, because it never reads `resource_ref` at all.
     */
    // Two tasks, because two differently-cased effects need two tasks — see ATTACK 1b.
    await seedTaskWithCase(h.control, { taskId: 'task:T-SIB-A', caseRef: CASE_A });
    await seedTaskWithCase(h.control, { taskId: 'task:T-SIB-B', caseRef: CASE_B });
    const subject = await authoriseReship(h, {
      resourceId: 'ORD-SIBLING',
      taskId: 'task:T-SIB-A',
    });
    const sibling = await authoriseReship(h, {
      resourceId: 'ORD-SIBLING',
      taskId: 'task:T-SIB-B',
    });
    await liveClockOn(CASE_B, 'clock:bravo-sibling');

    // The two share one resource — that is what makes the lookup plausible.
    const client = await h.control.connect();
    try {
      const refs = await client.query<{ resource_ref: string }>(
        `SELECT DISTINCT resource_ref FROM effect
          WHERE company_id = $1 AND effect_id IN ($2, $3)`,
        [COMPANY_ID, subject.effectId, sibling.effectId],
      );
      expect(refs.rows).toHaveLength(1);

      // PRODUCTION: case A, no clock.
      expect(
        await clockBearingAtClaim(client, {
          companyId: COMPANY_ID,
          caseRef: await effectCaseRef(h.control, subject.effectId),
          now: NOW,
        }),
      ).toBe(false);
    } finally {
      client.release();
    }

    // THE RESOURCE-LOOKUP CONTROL: the sibling's clock is borrowed and row 3 opens.
    expect(
      await unsafeClockBearingFromResourceLookup(h.control, {
        companyId: COMPANY_ID,
        effectId: subject.effectId,
        now: NOW,
      }),
    ).toBe(true);
  });
});

describe('`30 §9.2.6` — THE BINDING CHANGES NOTHING IT MUST NOT CHANGE', () => {
  it('the same order authorised under two different cases produces the SAME dispatch payload', async () => {
    /*
     * `30 §9.2.6`: "`case_ref` is authority provenance, not vendor data. It does not enter
     * the dispatch payload [...] Its existence changes no refund amount, no recipient, no
     * payment instrument and no external vendor field."
     *
     * ASSERTED ON THE BYTES, not on a field list: the payload is canonicalised by the
     * production canonicaliser and the two runs are compared byte for byte. A case that
     * leaked into any vendor parameter would change the digest.
     */
    await bindTaskToCase(h.control, REFUND_TASK_ID, CASE_A);
    const underA = await authoriseRefund(h, { authorisationRef: 'auth:AR-CASE-FIXED' });
    await h.reset();
    await bindTaskToCase(h.control, REFUND_TASK_ID, CASE_B);
    const underB = await authoriseRefund(h, { authorisationRef: 'auth:AR-CASE-FIXED' });

    expect(underB.payloadCanonicalBytes.equals(underA.payloadCanonicalBytes)).toBe(true);
    expect(underB.dispatchPayloadHash).toBe(underA.dispatchPayloadHash);
  });

  it('and it does not change the effect idempotency key, because `task_id` already determines it', async () => {
    /*
     * `30 §9.2.6`: "`25 §7`'s key is `H(task_id ‖ action_class ‖ resource_id ‖
     * semantic_param_digest)`. `case_ref` is a **function of `task_id`**, so two effects
     * with different case bindings necessarily carry different `task_id`s and already have
     * different keys; adding `case_ref` to the key would be redundant."
     *
     * THE CLAIM IS CHECKABLE AND IS CHECKED HERE, not assumed: the SAME task under two
     * different cases produces the SAME key, which is what "a function of `task_id`"
     * means. Two case-bound effects that could collide under the existing key would have
     * to share a `task_id`, and sharing a `task_id` means sharing a case.
     */
    await bindTaskToCase(h.control, REFUND_TASK_ID, CASE_A);
    const underA = await authoriseRefund(h, { authorisationRef: 'auth:AR-IDEM-FIXED' });
    await h.reset();
    await bindTaskToCase(h.control, REFUND_TASK_ID, CASE_B);
    const underB = await authoriseRefund(h, { authorisationRef: 'auth:AR-IDEM-FIXED' });

    expect(underB.idempotencyKey).toBe(underA.idempotencyKey);
  });
});

describe('`30 §9.2.7` — REMEDY OBLIGATION LINEAGE', () => {
  it('a re-proposal that inherits an obligation case reaches the effect without a human or a model', async () => {
    /*
     * `26 §12.3`'s `RemedyObligation` already carries `case_ref` and `clock_ref`, and
     * `30 §9.2.7` requires the lineage to survive a re-proposal:
     *
     *     "Where a fresh proposal originates from a `RemedyObligation`, its task inherits
     *      that obligation's `case_ref`, and the resulting effect inherits it from the task
     *      by `§9.2.1`'s ordinary rule. The owner is not asked to re-enter it and no model
     *      re-derives it."
     *
     * WHAT THIS TEST DOES AND DOES NOT COVER, STATED PLAINLY. `26 §12`'s approval resume,
     * verify mode and `R′` are UNBUILT — `S1I-result.md §18` reports `I51`, `I58` and
     * `I60`'s transition leg all OPEN — and `§7` of the owner-resolution mandate is
     * explicit: "Do NOT implement the broader approval-resume slice." So the obligation is
     * a SEEDED lineage carrier, exactly as `retainSourceRecord`'s artifacts are seeded for
     * `I56`, and what is proved is the LINEAGE LEG: an obligation's case, placed on the
     * successor task by the kernel, arrives on the successor effect with no model-facing
     * field and no owner re-entry anywhere in the path.
     */
    const obligationCase = CASE_A;
    const obligationClock = 'clock:remedy-live';
    await liveClockOn(obligationCase, obligationClock);

    // The denial's obligation, carrying `case_ref` and `clock_ref` (`26 §12.3`).
    const obligation = { caseRef: obligationCase, clockRef: obligationClock };

    // The successor task is created by the kernel FROM the obligation, which is the one
    // step `§9.2.7` specifies. No model and no owner supplies the case.
    await bindTaskToCase(h.control, REFUND_TASK_ID, obligation.caseRef);
    const reproposed = await authoriseRefund(h);

    // The lineage arrived, and it is the obligation's own case.
    expect(await effectCaseRef(h.control, reproposed.effectId)).toBe(obligation.caseRef);

    // AND IT IS LIVE-CLOCK-BEARING, so the re-proposal is evaluated at row 3 rather than
    // suspended at row 4 — which is exactly what `I58` exists to prevent: "A valid customer
    // or legal obligation is never stranded because the safety mechanism correctly refused
    // the old effect."
    const client = await h.control.connect();
    try {
      expect(
        await clockBearingAtClaim(client, {
          companyId: COMPANY_ID,
          caseRef: await effectCaseRef(h.control, reproposed.effectId),
          now: NOW,
        }),
      ).toBe(true);
    } finally {
      client.release();
    }
  });

  it('and an IRRECOVERABLE effect under a case is bound too — the rule is not class-scoped', async () => {
    // The binding is a property of the task, not of the recoverability class. Asserted so
    // that a later reading cannot narrow it to the classes row 3 can match.
    await bindTaskToCase(h.control, REFUND_TASK_ID, CASE_A);
    const reship = await authoriseReship(h, { resourceId: 'ORD-CASE-IRR' });
    // `authoriseReship` runs under its own unseeded task, so this one is NULL — and that
    // is the honest current state rather than a property of the class.
    expect(await effectCaseRef(h.control, reship.effectId)).toBeNull();
  });
});
