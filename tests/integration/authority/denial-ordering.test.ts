import type { PoolClient } from 'pg';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { projectPreReservationToWorker } from '../../../src/kernel/authority/workerFacingAuthorityDenial.js';
import { createHarness, type Harness } from '../../support/fixture.js';
import { loadCommerceFixture } from '../../support/enumerationFixture.js';
import {
  CEO_PRINCIPAL,
  REFUND_GRANT,
  REFUND_PRECONDITION_PREDICATE,
  S1E_OVER_CAP_ORDER,
  S1E_PASS_ORDER,
  WORKER_PRINCIPAL,
  insertContradiction,
  insertDelegationHop,
  insertStateFact,
  loadAuthorityWorld,
  loadS1eOrders,
  makeAuthorityHarness,
  preconditionFactId,
  proposeUnderLease,
  setPlatformStatus,
  type AuthorityHarness,
  type AuthorityWorld,
} from '../../support/authorityFixture.js';

/**
 * DETERMINISTIC DENIAL ORDERING — multi-failure fixtures.
 *
 * `26 §7`'s opening sentence, verbatim: "**Deterministic, ordered, fail-closed.** Every step
 * can deny; only completion permits."
 *
 * ---------------------------------------------------------------------------------
 * WHY MULTI-FAILURE FIXTURES ARE THE ONLY WAY TO TEST AN ORDER
 *
 * A suite of single-failure cases proves each gate denies. It does not prove they are
 * ORDERED: an implementation that ran the gates in any sequence would pass every one of
 * them. The order only becomes observable when two gates would both deny and exactly one
 * result comes back.
 *
 * `26 §7` property 1 is a statement of this kind and it is load-bearing: "Prohibitions are
 * evaluated before grants and are unappealable. **No grant, no approval, no owner override
 * at runtime can reach them.**" A prohibition evaluated after grant matching would be
 * appealable by arranging a grant.
 *
 * ---------------------------------------------------------------------------------
 * THE EXPECTED ORDER IS TRANSCRIBED HERE FROM `26 §7`'s FLOWCHART
 *
 * D -> E -> F -> G -> H -> H′ -> H″ -> I -> J -> K -> L -> M -> N -> P
 *
 * Nothing in this file imports `steps.ts`, reads the production gate order or asks the
 * pipeline which gate it ran first. Each case names the step the ARCHITECTURE says wins, and
 * asserts the kernel recorded that one.
 * ---------------------------------------------------------------------------------
 */

let harness: Harness;
let kernel: AuthorityHarness;
let world: AuthorityWorld;

async function withClient<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await harness.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

beforeAll(async () => {
  harness = await createHarness();
});

afterAll(async () => {
  await harness.close();
});

beforeEach(async () => {
  await harness.reset();
  world = await withClient(async (client) => {
    await loadCommerceFixture(client);
    await loadS1eOrders(client);
    return loadAuthorityWorld(client);
  });
  kernel = makeAuthorityHarness(harness);
});

// --- the individual breakages, each applied by a named function ------------------------
//
// Composed rather than inlined, so a multi-failure case is literally the conjunction of the
// single-failure cases the pipeline suite already proves in isolation.

async function breakPrincipal(client: PoolClient): Promise<void> {
  await client.query(`UPDATE principal SET status = 'SUSPENDED' WHERE principal_id = $1`, [
    WORKER_PRINCIPAL,
  ]);
}

async function engageKillSwitch(client: PoolClient): Promise<void> {
  await setPlatformStatus(client, { killSwitch: true });
}

async function breakPrecondition(client: PoolClient): Promise<void> {
  await client.query(`UPDATE state_fact SET value = 'false' WHERE fact_id = $1`, [
    preconditionFactId(S1E_PASS_ORDER.orderId),
  ]);
}

async function openContradiction(client: PoolClient, orderId: string): Promise<void> {
  await insertStateFact(client, {
    factId: `fact:conflicting:${orderId}`,
    subject: `order:${orderId}`,
    predicate: REFUND_PRECONDITION_PREDICATE,
    value: 'false',
    writerKind: 'PARSER',
    sourceAdapter: 'mock_processor',
    recordedAt: new Date('2026-09-05T08:00:00.000Z'),
    observedAt: new Date('2026-09-05T08:00:00.000Z'),
  });
  await insertContradiction(client, {
    linkId: `contradiction:${orderId}`,
    factA: preconditionFactId(orderId),
    factB: `fact:conflicting:${orderId}`,
  });
}

async function makeDelegatedGrade(client: PoolClient, orderId: string): Promise<void> {
  await client.query(`DELETE FROM state_fact WHERE fact_id = $1`, [preconditionFactId(orderId)]);
  await insertStateFact(client, {
    factId: preconditionFactId(orderId),
    subject: `order:${orderId}`,
    predicate: REFUND_PRECONDITION_PREDICATE,
    value: 'true',
    writerKind: 'KERNEL_SERVICE',
    decisionAuthority: 'DELEGATED',
  });
}

async function expireGrant(client: PoolClient): Promise<void> {
  await client.query(`UPDATE authority_grant SET expires_at = $1 WHERE grant_id = $2`, [
    new Date('2026-09-01T00:00:00.000Z'),
    REFUND_GRANT,
  ]);
}

async function narrowRecoverability(client: PoolClient): Promise<void> {
  await client.query(
    `UPDATE authority_grant SET recoverability_max = 'REVERSIBLE' WHERE grant_id = $1`,
    [REFUND_GRANT],
  );
}

async function requireUnmeetableEvidence(client: PoolClient): Promise<void> {
  await client.query(
    `UPDATE authority_grant SET evidence_min_sources = 2 WHERE grant_id = $1`,
    [REFUND_GRANT],
  );
}

async function exhaustAutonomy(client: PoolClient): Promise<void> {
  await client.query(`UPDATE autonomy_ledger_entry SET policy_violations = 1`);
}

// =====================================================================================
// The multi-failure matrix
// =====================================================================================

describe('when several gates would deny, the EARLIER one determines the outcome', () => {
  it('suspended principal + kill switch -> D wins, because D precedes F', async () => {
    await withClient(async (client) => {
      await breakPrincipal(client);
      await engageKillSwitch(client);
    });
    const outcome = await proposeUnderLease(kernel, S1E_PASS_ORDER);
    expect(outcome.outcome).toBe('DENIED');
    if (outcome.outcome !== 'DENIED') return;
    expect(outcome.step).toBe('D');
    expect(outcome.code).toBe('PRINCIPAL');
    // And F never ran, so a later gate could not have overridden the earlier failure.
    expect(outcome.stepsEvaluated).toEqual(['D']);
  });

  it('kill switch + failing precondition -> F wins, because F precedes G', async () => {
    await withClient(async (client) => {
      await engageKillSwitch(client);
      await breakPrecondition(client);
    });
    const outcome = await proposeUnderLease(kernel, S1E_PASS_ORDER);
    expect(outcome.outcome).toBe('DENIED');
    if (outcome.outcome !== 'DENIED') return;
    expect(outcome.step).toBe('F');
    expect(outcome.stepsEvaluated).toEqual(['D', 'E', 'F']);
  });

  it('open contradiction + delegated grade -> H′ wins, because H′ precedes H″', async () => {
    // The pair `26 §7` orders explicitly: "H′ — Contradiction check | Immediately after H",
    // then H″. Both facts are in the precondition set and both would deny.
    await withClient(async (client) => {
      await makeDelegatedGrade(client, S1E_PASS_ORDER.orderId);
      await openContradiction(client, S1E_PASS_ORDER.orderId);
    });
    const outcome = await proposeUnderLease(kernel, S1E_PASS_ORDER);
    expect(outcome.outcome).toBe('DENIED');
    if (outcome.outcome !== 'DENIED') return;
    expect(outcome.step).toBe('H′');
    expect(outcome.code).toBe('PRECONDITION_CONTRADICTED');
    expect(outcome.stepsEvaluated).toEqual(['D', 'E', 'F', 'G', 'H', 'H′']);
  });

  it('failing precondition + open contradiction -> H wins, because H precedes H′', async () => {
    // The mirror of the previous case. Together they show the ordering is real in both
    // directions rather than an artefact of which condition happens to be checked.
    await withClient(async (client) => {
      await breakPrecondition(client);
      await openContradiction(client, S1E_PASS_ORDER.orderId);
    });
    const outcome = await proposeUnderLease(kernel, S1E_PASS_ORDER);
    expect(outcome.outcome === 'DENIED' && outcome.step).toBe('H');
  });

  it('expired grant + exhausted autonomy -> I wins, because I precedes N', async () => {
    await withClient(async (client) => {
      await expireGrant(client);
      await exhaustAutonomy(client);
    });
    const outcome = await proposeUnderLease(kernel, S1E_PASS_ORDER);
    expect(outcome.outcome).toBe('DENIED');
    if (outcome.outcome !== 'DENIED') return;
    expect(outcome.step).toBe('I');
    expect(outcome.code).toBe('NO_GRANT');
    // Decisive: a REQUIRE_APPROVAL from step N would be a DIFFERENT outcome kind, so an
    // out-of-order pipeline would be visible as an approval requirement, not as a denial.
    expect(outcome.outcome).not.toBe('REQUIRE_APPROVAL');
  });

  it('narrowed recoverability + unmeetable evidence -> J wins, because J precedes L', async () => {
    await withClient(async (client) => {
      await narrowRecoverability(client);
      await requireUnmeetableEvidence(client);
    });
    const outcome = await proposeUnderLease(kernel, S1E_PASS_ORDER);
    expect(outcome.outcome === 'DENIED' && outcome.step).toBe('J');
  });

  it('unmeetable evidence + over-cap exposure -> L wins, because L precedes M', async () => {
    // The over-cap order would deny PER_ACTION at step M. Evidence denies at L. L is first.
    await withClient((client) => requireUnmeetableEvidence(client));
    const outcome = await proposeUnderLease(kernel, S1E_OVER_CAP_ORDER);
    expect(outcome.outcome).toBe('DENIED');
    if (outcome.outcome !== 'DENIED') return;
    expect(outcome.step).toBe('L');
    expect(outcome.code).toBe('EVIDENCE');
    // Cedar never ran, so there is no policy lineage on this outcome.
    expect(outcome.lineage).toBeNull();
  });

  it('over-cap exposure + exhausted autonomy -> M wins, because M precedes N', async () => {
    await withClient((client) => exhaustAutonomy(client));
    const outcome = await proposeUnderLease(kernel, S1E_OVER_CAP_ORDER);
    expect(outcome.outcome).toBe('DENIED');
    if (outcome.outcome !== 'DENIED') return;
    expect(outcome.step).toBe('M');
    expect(outcome.code).toBe('PER_ACTION');
  });

  it('a delegated-subset failure + a kill switch -> D wins over F, both over I', async () => {
    // Three simultaneous failures. `26 §7`'s order puts the chain check at D.
    await withClient(async (client) => {
      await client.query(`DELETE FROM delegation_hop WHERE hop_index = 2`);
      await insertDelegationHop(client, {
        principalId: WORKER_PRINCIPAL,
        hopIndex: 2,
        delegatingPrincipalId: CEO_PRINCIPAL,
        grantedActionClasses: ['refund.create', 'fulfilment.reship'],
        signWith: world.ceoSigner,
      });
      await engageKillSwitch(client);
      await expireGrant(client);
    });
    const outcome = await proposeUnderLease(kernel, S1E_PASS_ORDER);
    expect(outcome.outcome).toBe('DENIED');
    if (outcome.outcome !== 'DENIED') return;
    expect(outcome.step).toBe('D');
    expect(outcome.detail).toBe('DELEGATION_SUBSET_WIDENED');
  });

  it('EVERY gate broken at once still denies at D, and nothing later overrides it', async () => {
    await withClient(async (client) => {
      await breakPrincipal(client);
      await engageKillSwitch(client);
      await breakPrecondition(client);
      await openContradiction(client, S1E_PASS_ORDER.orderId);
      await expireGrant(client);
      await narrowRecoverability(client);
      await requireUnmeetableEvidence(client);
      await exhaustAutonomy(client);
    });
    const outcome = await proposeUnderLease(kernel, S1E_PASS_ORDER);
    expect(outcome.outcome).toBe('DENIED');
    if (outcome.outcome !== 'DENIED') return;
    expect(outcome.step).toBe('D');
    expect(outcome.stepsEvaluated).toEqual(['D']);
  });
});

describe('the worker-facing surface stays coarse under multi-failure denial', () => {
  it('every multi-failure case returns one category, and never the determining step', async () => {
    const cases: readonly {
      readonly name: string;
      readonly apply: (client: PoolClient) => Promise<void>;
      readonly expected: string;
    }[] = [
      {
        name: 'principal + kill switch',
        apply: async (client) => {
          await breakPrincipal(client);
          await engageKillSwitch(client);
        },
        expected: 'PRINCIPAL',
      },
      {
        name: 'contradiction + delegated grade',
        apply: async (client) => {
          await makeDelegatedGrade(client, S1E_PASS_ORDER.orderId);
          await openContradiction(client, S1E_PASS_ORDER.orderId);
        },
        expected: 'PRECONDITION_CONTRADICTED',
      },
      {
        name: 'expired grant + autonomy exhausted',
        apply: async (client) => {
          await expireGrant(client);
          await exhaustAutonomy(client);
        },
        expected: 'NO_GRANT',
      },
    ];

    for (const testCase of cases) {
      await harness.reset();
      world = await withClient(async (client) => {
        await loadCommerceFixture(client);
        await loadS1eOrders(client);
        const loaded = await loadAuthorityWorld(client);
        await testCase.apply(client);
        return loaded;
      });
      kernel = makeAuthorityHarness(harness);

      const outcome = await proposeUnderLease(kernel, S1E_PASS_ORDER);
      const projected = projectPreReservationToWorker(outcome);
      expect(projected, testCase.name).toEqual({ deny: testCase.expected });
      // ONE field. No step, no detail, no note, no lineage, no second reason.
      expect(Object.keys(projected), testCase.name).toHaveLength(1);
      // The forbidden list is CONCRETE IDENTIFIERS AND FIELD NAMES rather than English
      // words: `26 §7`'s categories legitimately contain "GRANT" and "EVIDENCE", and a check
      // that banned those substrings would ban the architecture's own terminals.
      const serialised = JSON.stringify(projected);
      for (const forbidden of [
        '"step"',
        '"detail"',
        '"auditNote"',
        '"policyVersion"',
        '"stepsEvaluated"',
        REFUND_GRANT,
        WORKER_PRINCIPAL,
        preconditionFactId(S1E_PASS_ORDER.orderId),
        'contradiction:',
        'session:',
        'DELEGATION_',
        'PRECONDITION_IN_OPEN_CONTRADICTION',
      ]) {
        expect(serialised, testCase.name).not.toContain(forbidden);
      }
    }
  });
});
