import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { COMPANY_ID } from '../../support/fixture.js';
import {
  S1I_NOW,
  authorisePause,
  authoriseRefund,
  authoriseReship,
  createOutboxHarness,
  outboxRowCount,
  outboxRows,
  type AuthorisedEffect,
  type OutboxHarness,
} from '../../support/outboxFixture.js';
import { enqueueDispatch, readByEffect } from '../../../src/kernel/outbox/enqueue.js';
import {
  actionCatalogue,
  ACTION_CLASSES,
  INTERNAL_ONLY_ADAPTER,
  requiresExternalDispatch,
  requiresExternalDispatchFor,
  type ActionCatalogueEntry,
} from '../../../src/kernel/canonicalisation/actionCatalogue.js';

/**
 * v1.3.6 (`50 §2a`, `50 §3f`): the catalogue is READ FROM THE ACTIVE VERIFIED BUNDLE.
 *
 * Before S1K this was a frozen literal imported from `actionCatalogue.ts`. `50 §3f`'s single
 * source of authority rule moved it into the signed class-3 artifact, so this binding now
 * resolves the same rows out of the bundle `tests/support/controlArtifactSetup.ts`
 * bootstrapped — which is what production reads.
 */
const ACTION_CATALOGUE = actionCatalogue().entries;


/**
 * `S1I-C5` RESOLVED — THE OUTBOX APPLIES TO EVERY EXTERNAL-WRITE EFFECT AND ONLY THOSE.
 * v1.3.4 (OBX-02), `25 §7`, `I66`.
 *
 * =================================================================================
 * WHAT WAS AMBIGUOUS.
 *
 * FOUR passages scoped the outbox to "irrecoverable sends" — `24 §4`'s ERD, `33 §6`,
 * `35 §4` item 3 and ADR-026's title. TWO presented it generally — `25 §7`'s
 * idempotency-layer table, where the other three layers are not class-scoped, and
 * `31 §2` / `33 §1` / ADR-002, which state it of "the dispatch boundary" as such.
 *
 * S1I applied it uniformly to every catalogue class, disclosed the widening as strictly
 * stronger, and asked. `25 §7` now declares the predicate:
 *
 *     "**The scope predicate is `effect requires external dispatch`.** It is **not**
 *      `effect.recoverability == IRRECOVERABLE`, and it is **not** every catalogue action
 *      unconditionally [...] **The predicate is derived from the closed action catalogue's
 *      execution metadata**, so it is a property of the catalogue that a model cannot
 *      choose and a caller cannot pass."
 * =================================================================================
 *
 * =================================================================================
 * `§17` OF THE OWNER-RESOLUTION MANDATE ASKS FOR FOUR CASES, AND SAYS WHAT TO DO ABOUT
 * THE FOURTH.
 *
 *   "Add tests for: one REVERSIBLE external effect; one COMPENSABLE external effect; one
 *    IRRECOVERABLE external effect; **one internal-only/non-dispatchable effect IF SUCH A
 *    CLASS CURRENTLY EXISTS**. Internal-only must not be enqueued."
 *
 * **NO SUCH CLASS EXISTS AT S1.** `37` S1's closed catalogue is four classes "all against
 * a mock adapter", and a mock adapter stands in for a real external one — so all four are
 * external-write and the existing implementation already conforms.
 *
 * THAT IS EXACTLY WHY THE PREDICATE IS TESTED SEPARATELY FROM THE PIPELINE. `I66` has two
 * halves — "every external-write effect takes exactly one row, and an internal-only effect
 * takes none" — and a predicate whose false branch is unrepresentable proves only one of
 * them. The suite therefore exercises the DERIVATION over a hypothetical internal-only
 * entry as well as running the three real classes end to end, and says which is which.
 * =================================================================================
 */

let h: OutboxHarness;
const NOW = S1I_NOW;

beforeAll(async () => {
  h = await createOutboxHarness();
});

afterAll(async () => {
  await h.close();
});

beforeEach(async () => {
  await h.reset();
});

async function enqueue(effect: AuthorisedEffect, tag: string) {
  return enqueueDispatch(h.control, {
    companyId: COMPANY_ID,
    effectId: effect.effectId,
    outboxId: `outbox:${tag}`,
    payloadCanonicalBytes: effect.payloadCanonicalBytes,
    now: NOW,
  });
}

describe('`I66` — EVERY EXTERNAL-WRITE CLASS TAKES EXACTLY ONE ROW', () => {
  it('REVERSIBLE — `campaign.pause` — is enqueued, and it is not the irrecoverable class', async () => {
    const effect = await authorisePause(h, { resourceId: 'CMP-SCOPE-REV' });
    expect(effect.recoverability).toBe('REVERSIBLE');
    const outcome = await enqueue(effect, 'scope-reversible');
    expect(outcome.kind).toBe('ENQUEUED');
    expect(await outboxRowCount(h.control)).toBe(1);
    expect((await outboxRows(h.control))[0]!.recoverability).toBe('REVERSIBLE');
  });

  it('COMPENSABLE — `refund.create` — is enqueued', async () => {
    const effect = await authoriseRefund(h);
    expect(effect.recoverability).toBe('COMPENSABLE');
    const outcome = await enqueue(effect, 'scope-compensable');
    expect(outcome.kind).toBe('ENQUEUED');
    expect(await outboxRowCount(h.control)).toBe(1);
    expect((await outboxRows(h.control))[0]!.recoverability).toBe('COMPENSABLE');
  });

  it('IRRECOVERABLE — `fulfilment.reship` — is enqueued, which is ADR-026s own case', async () => {
    const effect = await authoriseReship(h, { resourceId: 'ORD-SCOPE-IRR' });
    expect(effect.recoverability).toBe('IRRECOVERABLE');
    const outcome = await enqueue(effect, 'scope-irrecoverable');
    expect(outcome.kind).toBe('ENQUEUED');
    expect(await outboxRowCount(h.control)).toBe(1);
    expect((await outboxRows(h.control))[0]!.recoverability).toBe('IRRECOVERABLE');
  });

  it('all three coexist, one row each, and none is the subject of a class-scoped rule', async () => {
    // The three at once, so "exactly one row per effect identity" is asserted across the
    // classes rather than three times in isolation.
    const pause = await authorisePause(h, { resourceId: 'CMP-SCOPE-ALL' });
    const refund = await authoriseRefund(h);
    const reship = await authoriseReship(h, { resourceId: 'ORD-SCOPE-ALL' });
    for (const [effect, tag] of [
      [pause, 'all-pause'],
      [refund, 'all-refund'],
      [reship, 'all-reship'],
    ] as const) {
      expect((await enqueue(effect, tag)).kind).toBe('ENQUEUED');
    }
    expect(await outboxRowCount(h.control)).toBe(3);
    const classes = (await outboxRows(h.control)).map((r) => r.recoverability).sort();
    expect(classes).toEqual(['COMPENSABLE', 'IRRECOVERABLE', 'REVERSIBLE']);

    // And each resolves back to its own effect — one row per identity, not three rows of
    // one shape. `readByEffect` takes a client, so one is checked out for the sweep.
    const client = await h.control.connect();
    try {
      for (const effect of [pause, refund, reship]) {
        const row = await readByEffect(client, COMPANY_ID, effect.effectId);
        expect(row?.effectId).toBe(effect.effectId);
      }
    } finally {
      client.release();
    }
  });
});

describe('`I66` — THE PREDICATE IS DERIVED FROM THE CATALOGUE, NOT FROM RECOVERABILITY', () => {
  it('every S1 catalogue class is external-write, and the predicate says so for each', () => {
    /*
     * `37` S1: "Closed action catalogue with exactly three classes: one REVERSIBLE, one
     * COMPENSABLE, one IRRECOVERABLE, **all against a mock adapter** — plus one rate-based
     * class against a mock." A mock adapter stands in for a real external one, so all four
     * cross the `48` perimeter and all four are in scope.
     *
     * STATED AS AN ENUMERATION OVER THE WHOLE CATALOGUE, so a class added later without an
     * adapter — or with `INTERNAL_ONLY_ADAPTER` — changes this assertion rather than
     * slipping through.
     *
     * S1P ADDED ONE, AND THE ENUMERATION IS WHY THIS LINE MOVED RATHER THAN THE PROPERTY.
     * `email.send` names the real adapter `sendgrid_email`, so it is an external write in
     * exactly the way the other four are, and `I66`'s predicate says so for it too.
     */
    expect(ACTION_CLASSES).toHaveLength(5);
    for (const actionClass of ACTION_CLASSES) {
      expect(requiresExternalDispatchFor(actionClass), actionClass).toBe(true);
      expect(ACTION_CATALOGUE[actionClass].adapter, actionClass).not.toBe(
        INTERNAL_ONLY_ADAPTER,
      );
    }
  });

  it('the predicate is NOT recoverability, and the three classes prove it independently', () => {
    // The three recoverability values map to ONE answer, so the predicate cannot be a
    // function of recoverability. `25 §7`: "It is not `effect.recoverability ==
    // IRRECOVERABLE`."
    const byClass = ACTION_CLASSES.map((c) => ({
      recoverability: ACTION_CATALOGUE[c].recoverability,
      external: requiresExternalDispatchFor(c),
    }));
    expect(new Set(byClass.map((b) => b.recoverability)).size).toBe(3);
    expect(new Set(byClass.map((b) => b.external))).toEqual(new Set([true]));
  });

  it('an INTERNAL-ONLY entry is FALSE — the half no S1 class can exercise', () => {
    /*
     * `§17`'s fourth case, run against the DERIVATION rather than against a fabricated
     * production class. Adding a class to `ACTION_CATALOGUE` to make a test pass would be
     * inventing architecture — `37` S1 declares a CLOSED catalogue of four — so the entry
     * below is a local literal handed to the predicate, and nothing registers it.
     *
     * `I66`'s second half is what this covers: "an internal-only effect takes none."
     */
    const internalOnly: ActionCatalogueEntry = {
      ...ACTION_CATALOGUE['campaign.pause'],
      adapter: INTERNAL_ONLY_ADAPTER,
    };
    expect(requiresExternalDispatch(internalOnly)).toBe(false);
    // And the recoverability is untouched, so the FALSE came from the adapter and not from
    // the class — which is the whole claim.
    expect(internalOnly.recoverability).toBe('REVERSIBLE');
    expect(requiresExternalDispatch(ACTION_CATALOGUE['campaign.pause'])).toBe(true);
  });

  it('and no caller parameter can change it: the enqueue surface has no scope field', () => {
    /*
     * `I66`: "never a caller's or a model's choice." The property is in the SIGNATURE, not
     * in a check: `enqueueDispatchOn` takes `companyId`, `effectId`, `outboxId`,
     * `payloadCanonicalBytes` and `now`, and `requiresExternalDispatchFor` takes an
     * `ActionClass` and reads a frozen catalogue.
     *
     * `no-transport-boundary.test.ts` asserts the module's exported surface against a
     * hand-authored list; this asserts the CATALOGUE is frozen, so the predicate's input
     * cannot be mutated at runtime either.
     */
    expect(Object.isFrozen(ACTION_CATALOGUE)).toBe(true);
    for (const actionClass of ACTION_CLASSES) {
      expect(Object.isFrozen(ACTION_CATALOGUE[actionClass]), actionClass).toBe(true);
    }
    expect(() => {
      // @ts-expect-error — the catalogue is frozen and readonly; this is the attack.
      ACTION_CATALOGUE['fulfilment.reship'].adapter = INTERNAL_ONLY_ADAPTER;
    }).toThrow();
    expect(requiresExternalDispatchFor('fulfilment.reship')).toBe(true);
  });
});
