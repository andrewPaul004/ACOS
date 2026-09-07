import type { PoolClient } from 'pg';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { toDb } from '../../../src/kernel/exposure/money.js';
import { projectPreReservationToWorker } from '../../../src/kernel/authority/workerFacingAuthorityDenial.js';
import { createHarness, COMPANY_ID, type Harness } from '../../support/fixture.js';
import { parseProposedIntent } from '../../../src/kernel/canonicalisation/intent.js';
import {
  entityKeyFor,
  loadCommerceFixture,
  rawIntent,
} from '../../support/enumerationFixture.js';
import {
  AUTONOMY_KEY_BINDING,
  CEO_PRINCIPAL,
  OWNER_PRINCIPAL,
  REFUND_GRANT,
  REFUND_PRECONDITION_PREDICATE,
  S1E_OVER_CAP_ORDER,
  S1E_PASS_ORDER,
  WORKER_MODEL_BINDING,
  WORKER_PRINCIPAL,
  bindEvidenceSet,
  clearPlatformStatus,
  insertAutonomyEntry,
  insertContradiction,
  insertDelegationHop,
  insertEvidenceItem,
  insertEvidenceSource,
  insertGrant,
  insertPrincipal,
  insertPrincipalKey,
  insertSession,
  insertStateFact,
  loadAuthorityWorld,
  loadS1eOrders,
  makeAuthorityHarness,
  newAuthoritySigner,
  nonAuthorityContext,
  preconditionFactId,
  proposeUnderLease,
  s1eSpec,
  workerSession,
  setPlatformStatus,
  type AuthorityHarness,
  type AuthorityWorld,
} from '../../support/authorityFixture.js';

/**
 * S1E — `26 §7` steps D through N, END TO END, ON REAL POSTGRESQL.
 *
 * ---------------------------------------------------------------------------------
 * WHAT MAKES THIS SUITE DISCRIMINATING RATHER THAN SELF-CONFIRMING
 *
 * `36 §0`'s oracle requirement, and `46 R1`: "a test that calls the same function twice
 * proves nothing."
 *
 * Three disciplines are applied throughout:
 *
 * 1. **ONE happy-path world, broken in exactly one place per case.** `loadAuthorityWorld`
 *    seeds a state in which the proposal passes every gate. Each case below then changes ONE
 *    row and asserts ONE step. A denial that fired for a second reason would show up as the
 *    wrong step, not as a pass.
 *
 * 2. **The expected step and code are written down here, transcribed from `26 §7`'s
 *    flowchart.** No test reads the production step table, the production denial registry or
 *    the production gate order to decide what it expects.
 *
 * 3. **A positive control per gate.** Every negative case has a sibling that proves the same
 *    fixture reaches `PRE_RESERVATION_PASS` when the one broken row is intact — otherwise a
 *    suite in which the pipeline denied everything would pass entirely.
 * ---------------------------------------------------------------------------------
 */

let harness: Harness;
let kernel: AuthorityHarness;
let world: AuthorityWorld;

/**
 * JSON for an assertion message, with `Money` rendered.
 *
 * `Money` is a `bigint` (`exposure/money.ts`), and `JSON.stringify` throws on one. A failing
 * assertion whose MESSAGE throws reports the serialiser's error instead of the mismatch,
 * which is how a real failure gets misdiagnosed as a harness bug.
 */
function json(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    typeof v === 'bigint' ? v.toString() : v,
  );
}

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

// =====================================================================================
// The positive control the whole suite rests on
// =====================================================================================

describe('the happy path reaches the pre-reservation boundary and stops there', () => {
  it('PRE_RESERVATION_PASS, from real rows, through every gate D–N', async () => {
    const outcome = await proposeUnderLease(kernel, S1E_PASS_ORDER);
    expect(outcome.outcome, json(outcome)).toBe('PRE_RESERVATION_PASS');
    if (outcome.outcome !== 'PRE_RESERVATION_PASS') return;

    // The gates that ran, in `26 §7`'s order. Transcribed from the flowchart here, not read
    // from `steps.ts`.
    expect(outcome.lineage.stepsEvaluated).toEqual([
      'D', 'E', 'F', 'G', 'H', 'H′', 'H″', 'I', 'J', 'K', 'L', 'M', 'N', 'P',
    ]);

    // The economics the sequence was evaluated over: $9.41 vendor + $0.59 retained = $10.00.
    expect(toDb(outcome.request.exposure.vendorAmount!)).toBe('9.41');
    expect(toDb(outcome.request.exposure.totalExposure)).toBe('10.00');

    // `26 §2.1`: window_refs are "every named window the matching grants reference".
    expect(outcome.windowRefs).toEqual(['W_DAY_REFUND', 'W_MONTH_REFUND']);
    expect(outcome.autonomyLevel).toBe('L3_OPERATIONAL');
    expect(outcome.gateClass).toBe('UNGATED_LOGGED');
  });

  it('AND THE RESULT IS NOT DISPATCHABLE — no payload crosses the boundary', async () => {
    const outcome = await proposeUnderLease(kernel, S1E_PASS_ORDER);
    expect(outcome.outcome).toBe('PRE_RESERVATION_PASS');
    if (outcome.outcome !== 'PRE_RESERVATION_PASS') return;

    // Everything an adapter would need, absent by construction. `26 §2.1`'s DispatchPayload
    // is `{ adapter, method, vendor_parameters, idempotency_key, monetary_effect,
    // precondition_token, authorisation_ref }` and NONE of it is reachable from here.
    const keys = Object.keys(outcome);
    expect(keys).not.toContain('dispatchPayload');
    expect(keys).not.toContain('effect');
    for (const forbidden of [
      'adapter',
      'method',
      'vendorParameters',
      'idempotencyKey',
      'monetaryEffect',
      'reservation',
      'reservationId',
      'authorisationId',
      'authorisationDecision',
    ]) {
      expect(json(outcome)).not.toContain(forbidden);
    }
    // The hash that BINDS a payload is present; the payload is not.
    expect(outcome.dispatchPayloadHash).toMatch(/^[0-9a-f]{64}$/);

    // And the outcome word itself is not an authorisation word.
    expect(outcome.outcome).toBe('PRE_RESERVATION_PASS');
    expect(['AUTHORISED', 'PERMIT', 'RESERVED', 'APPROVED', 'DISPATCHABLE']).not.toContain(
      outcome.outcome,
    );
  });

  it('the worker sees `eligible`, and no lineage, step, policy or amount', async () => {
    const outcome = await proposeUnderLease(kernel, S1E_PASS_ORDER);
    const projected = projectPreReservationToWorker(outcome);
    expect(projected).toEqual({ eligible: true });
    expect(Object.keys(projected)).toHaveLength(1);
    expect(Object.isFrozen(projected)).toBe(true);
  });
});

// =====================================================================================
// Step D — the principal
// =====================================================================================

describe('step D — the principal is kernel-derived and cannot be spoofed', () => {
  it('an UNKNOWN session denies PRINCIPAL, and says nothing about why', async () => {
    const outcome = await proposeUnderLease(kernel, S1E_PASS_ORDER, {
      sessionId: 'session:does-not-exist',
    });
    expect(outcome.outcome).toBe('DENIED');
    if (outcome.outcome !== 'DENIED') return;
    expect(outcome.step).toBe('D');
    expect(outcome.code).toBe('PRINCIPAL');
    expect(outcome.detail).toBe('SESSION_UNKNOWN');
    expect(projectPreReservationToWorker(outcome)).toEqual({ deny: 'PRINCIPAL' });
  });

  it('an EXPIRED session denies PRINCIPAL — indistinguishable from unknown, at the worker', async () => {
    await withClient((client) =>
      insertSession(client, {
        sessionId: 'session:expired',
        principalId: WORKER_PRINCIPAL,
        issuedAt: new Date('2026-09-05T08:00:00.000Z'),
        expiresAt: new Date('2026-09-05T09:00:00.000Z'),
      }),
    );
    const outcome = await proposeUnderLease(kernel, S1E_PASS_ORDER, {
      sessionId: 'session:expired',
    });
    expect(outcome.outcome).toBe('DENIED');
    if (outcome.outcome !== 'DENIED') return;
    expect(outcome.detail).toBe('SESSION_EXPIRED');
    // The two internal reasons collapse at the worker. That is the point.
    expect(projectPreReservationToWorker(outcome)).toEqual({ deny: 'PRINCIPAL' });
  });

  it('a SUSPENDED principal denies PRINCIPAL', async () => {
    await withClient((client) =>
      client.query(`UPDATE principal SET status = 'SUSPENDED' WHERE principal_id = $1`, [
        WORKER_PRINCIPAL,
      ]),
    );
    const outcome = await proposeUnderLease(kernel, S1E_PASS_ORDER);
    expect(outcome.outcome === 'DENIED' && outcome.detail).toBe('PRINCIPAL_SUSPENDED');
  });

  it('a session for ANOTHER principal on this task denies PRINCIPAL', async () => {
    // The classic confused deputy: a legitimate session, a legitimate task, and they are not
    // each other's.
    await withClient(async (client) => {
      await insertPrincipal(client, {
        principalId: 'principal:other_worker',
        kind: 'AI_ROLE',
        role: 'support_reasoner',
        modelBinding: WORKER_MODEL_BINDING,
      });
      await insertSession(client, {
        sessionId: 'session:other',
        principalId: 'principal:other_worker',
      });
    });
    const outcome = await proposeUnderLease(kernel, S1E_PASS_ORDER, {
      sessionId: 'session:other',
    });
    expect(outcome.outcome === 'DENIED' && outcome.detail).toBe('PRINCIPAL_NOT_ON_TASK');
  });

  it('a hop signed with the WRONG key denies PRINCIPAL — the signature is verified, not assumed', async () => {
    const impostor = newAuthoritySigner();
    await withClient(async (client) => {
      await client.query(`DELETE FROM delegation_hop WHERE hop_index = 2`);
      await insertDelegationHop(client, {
        principalId: WORKER_PRINCIPAL,
        hopIndex: 2,
        delegatingPrincipalId: CEO_PRINCIPAL,
        grantedActionClasses: ['refund.create'],
        // Signed by a key the CEO does not hold. Everything else about the row is valid.
        signWith: impostor,
      });
    });
    const outcome = await proposeUnderLease(kernel, S1E_PASS_ORDER);
    expect(outcome.outcome === 'DENIED' && outcome.detail).toBe(
      'DELEGATION_HOP_SIGNATURE_INVALID',
    );
  });

  it('a CORRUPTED signature over a correctly-keyed hop denies too', async () => {
    await withClient(async (client) => {
      await client.query(`DELETE FROM delegation_hop WHERE hop_index = 2`);
      await insertDelegationHop(client, {
        principalId: WORKER_PRINCIPAL,
        hopIndex: 2,
        delegatingPrincipalId: CEO_PRINCIPAL,
        grantedActionClasses: ['refund.create'],
        signWith: world.ceoSigner,
        corruptSignature: true,
      });
    });
    const outcome = await proposeUnderLease(kernel, S1E_PASS_ORDER);
    expect(outcome.outcome === 'DENIED' && outcome.detail).toBe(
      'DELEGATION_HOP_SIGNATURE_INVALID',
    );
  });

  it('a hop that WIDENS the delegated subset denies — a delegation can only narrow', async () => {
    // `26 §3` rule 2. Hop 1 conveys {refund.create, campaign.pause}; hop 2 tries to convey a
    // class hop 1 did not.
    await withClient(async (client) => {
      await client.query(`DELETE FROM delegation_hop WHERE hop_index = 2`);
      await insertDelegationHop(client, {
        principalId: WORKER_PRINCIPAL,
        hopIndex: 2,
        delegatingPrincipalId: CEO_PRINCIPAL,
        grantedActionClasses: ['refund.create', 'fulfilment.reship'],
        signWith: world.ceoSigner,
      });
    });
    const outcome = await proposeUnderLease(kernel, S1E_PASS_ORDER);
    expect(outcome.outcome === 'DENIED' && outcome.detail).toBe('DELEGATION_SUBSET_WIDENED');
  });

  it('depth 4 denies PRINCIPAL — the cap is counted from the rows, not read from a column', async () => {
    // `26 §3` rule 3: "delegation_depth ≤ 3. Beyond that, deny." Four correctly signed,
    // correctly narrowing hops.
    const third = newAuthoritySigner();
    const fourth = newAuthoritySigner();
    await withClient(async (client) => {
      await insertPrincipal(client, {
        principalId: 'principal:mid3',
        kind: 'AI_ROLE',
        role: 'lead',
        modelBinding: 'model:mid@1/prompt@1',
      });
      await insertPrincipal(client, {
        principalId: 'principal:mid4',
        kind: 'AI_ROLE',
        role: 'lead',
        modelBinding: 'model:mid@1/prompt@1',
      });
      await insertPrincipalKey(client, 'principal:mid3', third);
      await insertPrincipalKey(client, 'principal:mid4', fourth);
      await insertDelegationHop(client, {
        principalId: WORKER_PRINCIPAL,
        hopIndex: 3,
        delegatingPrincipalId: 'principal:mid3',
        grantedActionClasses: ['refund.create'],
        signWith: third,
      });
      await insertDelegationHop(client, {
        principalId: WORKER_PRINCIPAL,
        hopIndex: 4,
        delegatingPrincipalId: 'principal:mid4',
        grantedActionClasses: ['refund.create'],
        signWith: fourth,
      });
    });
    const outcome = await proposeUnderLease(kernel, S1E_PASS_ORDER);
    expect(outcome.outcome === 'DENIED' && outcome.detail).toBe('DELEGATION_DEPTH_EXCEEDED');
  });

  it('a NON-CONTIGUOUS chain denies — a missing hop is a narrowing that never happened', async () => {
    await withClient((client) => client.query(`DELETE FROM delegation_hop WHERE hop_index = 1`));
    const outcome = await proposeUnderLease(kernel, S1E_PASS_ORDER);
    expect(outcome.outcome === 'DENIED' && outcome.detail).toBe(
      'DELEGATION_CHAIN_NOT_CONTIGUOUS',
    );
  });
});

// =====================================================================================
// Step F — platform status and the kill switch
// =====================================================================================

describe('step F — platform status is authoritative and its absence denies', () => {
  it('an ENGAGED kill switch denies PLATFORM_SUSPENDED', async () => {
    await withClient((client) => setPlatformStatus(client, { killSwitch: true }));
    const outcome = await proposeUnderLease(kernel, S1E_PASS_ORDER);
    expect(outcome.outcome).toBe('DENIED');
    if (outcome.outcome !== 'DENIED') return;
    expect(outcome.step).toBe('F');
    expect(outcome.detail).toBe('KILL_SWITCH_ENGAGED');
  });

  it('a SUSPENDED company denies PLATFORM_SUSPENDED', async () => {
    await withClient((client) => setPlatformStatus(client, { status: 'SUSPENDED' }));
    const outcome = await proposeUnderLease(kernel, S1E_PASS_ORDER);
    expect(outcome.outcome === 'DENIED' && outcome.detail).toBe('PLATFORM_STATUS_NOT_OPERATING');
  });

  it('a MISSING status row denies — deleting the row is not a bypass', async () => {
    await withClient((client) => clearPlatformStatus(client));
    const outcome = await proposeUnderLease(kernel, S1E_PASS_ORDER);
    expect(outcome.outcome).toBe('DENIED');
    if (outcome.outcome !== 'DENIED') return;
    expect(outcome.step).toBe('F');
    expect(outcome.detail).toBe('PLATFORM_STATUS_ABSENT');
    // And the three reasons are one category at the worker, so an attacker cannot tell
    // "I deleted the row" from "the switch is engaged".
    expect(projectPreReservationToWorker(outcome)).toEqual({ deny: 'PLATFORM_SUSPENDED' });
  });

  it('a SUSPENDED agent-profile capability denies', async () => {
    await withClient((client) =>
      client.query(
        `UPDATE agent_profile_capability SET status = 'SUSPENDED' WHERE principal_id = $1`,
        [WORKER_PRINCIPAL],
      ),
    );
    const outcome = await proposeUnderLease(kernel, S1E_PASS_ORDER);
    expect(outcome.outcome === 'DENIED' && outcome.detail).toBe(
      'AGENT_PROFILE_CAPABILITY_SUSPENDED',
    );
  });

  it('an ABSENT agent-profile capability denies — the default is closed', async () => {
    await withClient((client) => client.query(`DELETE FROM agent_profile_capability`));
    const outcome = await proposeUnderLease(kernel, S1E_PASS_ORDER);
    expect(outcome.outcome === 'DENIED' && outcome.detail).toBe(
      'AGENT_PROFILE_CAPABILITY_ABSENT',
    );
  });
});

// =====================================================================================
// Steps G / H / H′ / H″ — preconditions
// =====================================================================================

describe('steps G–H″ — preconditions are fetched, graded, checked and never asserted', () => {
  it('an ABSENT fact denies PRECONDITION at step G', async () => {
    await withClient((client) => client.query(`DELETE FROM state_fact`));
    const outcome = await proposeUnderLease(kernel, S1E_PASS_ORDER);
    expect(outcome.outcome).toBe('DENIED');
    if (outcome.outcome !== 'DENIED') return;
    expect(outcome.step).toBe('G');
    expect(outcome.code).toBe('PRECONDITION');
    expect(outcome.detail).toBe('PRECONDITION_FACT_ABSENT');
  });

  it('a MODEL-written fact denies — INTERPRETATION may not gate', async () => {
    // `24 §5`: a MODEL writer reaches INTERPRETATION and no further. The generated column
    // decides that; this fixture only chooses the writer.
    await withClient(async (client) => {
      await client.query(`DELETE FROM state_fact`);
      await insertStateFact(client, {
        factId: 'fact:model-authored',
        subject: S1E_PASS_ORDER.resourceRef,
        predicate: REFUND_PRECONDITION_PREDICATE,
        value: 'true',
        writerKind: 'MODEL',
        writerPrincipalId: WORKER_PRINCIPAL,
      });
      const grade = await client.query<{ grade: string }>(
        `SELECT grade FROM state_fact WHERE fact_id = 'fact:model-authored'`,
      );
      // Asserted directly against the DATABASE, independently of the evaluator.
      expect(grade.rows[0]!.grade).toBe('INTERPRETATION');
    });
    const outcome = await proposeUnderLease(kernel, S1E_PASS_ORDER);
    expect(outcome.outcome).toBe('DENIED');
    if (outcome.outcome !== 'DENIED') return;
    expect(outcome.step).toBe('H');
    expect(outcome.detail).toBe('PRECONDITION_GRADE_NOT_GATING');
  });

  it('a TRANSPORT-written fact is CLAIM and denies — I6', async () => {
    await withClient(async (client) => {
      await client.query(`DELETE FROM state_fact`);
      await insertStateFact(client, {
        factId: 'fact:claim',
        subject: S1E_PASS_ORDER.resourceRef,
        predicate: REFUND_PRECONDITION_PREDICATE,
        value: 'true',
        writerKind: 'TRANSPORT',
        sourceAdapter: 'mock_processor',
      });
      const grade = await client.query<{ grade: string }>(
        `SELECT grade FROM state_fact WHERE fact_id = 'fact:claim'`,
      );
      expect(grade.rows[0]!.grade).toBe('CLAIM');
    });
    const outcome = await proposeUnderLease(kernel, S1E_PASS_ORDER);
    expect(outcome.outcome === 'DENIED' && outcome.detail).toBe(
      'PRECONDITION_GRADE_NOT_GATING',
    );
  });

  it('a fact holding the WRONG value denies', async () => {
    await withClient((client) =>
      client.query(`UPDATE state_fact SET value = 'false' WHERE fact_id = $1`, [
        preconditionFactId(S1E_PASS_ORDER.orderId),
      ]),
    );
    const outcome = await proposeUnderLease(kernel, S1E_PASS_ORDER);
    expect(outcome.outcome === 'DENIED' && outcome.detail).toBe('PRECONDITION_VALUE_MISMATCH');
  });

  it('a fact PAST max_age under staleness_policy=BLOCK denies STALE', async () => {
    // `24 §7`: "A precondition outside max_age with staleness_policy=BLOCK is not a warning."
    // The fixture clock is 2026-09-05T10:00:00Z and max_age is 86400s, so an observation at
    // 2026-09-04T09:59:59Z is one second outside.
    await withClient((client) =>
      client.query(`UPDATE state_fact SET observed_at = $1 WHERE fact_id = $2`, [
        new Date('2026-09-04T09:59:59.000Z'),
        preconditionFactId(S1E_PASS_ORDER.orderId),
      ]),
    );
    const outcome = await proposeUnderLease(kernel, S1E_PASS_ORDER);
    expect(outcome.outcome).toBe('DENIED');
    if (outcome.outcome !== 'DENIED') return;
    expect(outcome.code).toBe('STALE');
    expect(outcome.detail).toBe('PRECONDITION_PAST_MAX_AGE');
  });

  it('AND ONE SECOND INSIDE max_age PASSES — the boundary is a boundary', async () => {
    await withClient((client) =>
      client.query(`UPDATE state_fact SET observed_at = $1 WHERE fact_id = $2`, [
        new Date('2026-09-04T10:00:01.000Z'),
        preconditionFactId(S1E_PASS_ORDER.orderId),
      ]),
    );
    const outcome = await proposeUnderLease(kernel, S1E_PASS_ORDER);
    expect(outcome.outcome, json(outcome)).toBe('PRE_RESERVATION_PASS');
  });

  it('an OBSERVATION from a single adapter denies PRECONDITION_UNCORROBORATED — I27', async () => {
    await withClient(async (client) => {
      await client.query(`DELETE FROM state_fact`);
      await insertStateFact(client, {
        factId: 'fact:observation-single',
        subject: S1E_PASS_ORDER.resourceRef,
        predicate: REFUND_PRECONDITION_PREDICATE,
        value: 'true',
        writerKind: 'KERNEL_SERVICE',
        derivationSpec: 'spec:payment_settled_v1',
        sourceAdapter: 'mock_commerce',
        corroboratingSource: null,
      });
      const grade = await client.query<{ grade: string }>(
        `SELECT grade FROM state_fact WHERE fact_id = 'fact:observation-single'`,
      );
      expect(grade.rows[0]!.grade).toBe('OBSERVATION');
    });
    const outcome = await proposeUnderLease(kernel, S1E_PASS_ORDER);
    expect(outcome.outcome).toBe('DENIED');
    if (outcome.outcome !== 'DENIED') return;
    expect(outcome.code).toBe('PRECONDITION_UNCORROBORATED');
  });

  it('AND THE SAME OBSERVATION CORROBORATED BY A SECOND SOURCE PASSES', async () => {
    await withClient(async (client) => {
      await client.query(`DELETE FROM state_fact`);
      await insertStateFact(client, {
        factId: 'fact:observation-corroborated',
        subject: S1E_PASS_ORDER.resourceRef,
        predicate: REFUND_PRECONDITION_PREDICATE,
        value: 'true',
        writerKind: 'KERNEL_SERVICE',
        derivationSpec: 'spec:payment_settled_v1',
        sourceAdapter: 'mock_commerce',
        // `24 §10` case 6: corroborated against PROCESSOR SETTLEMENT, not the commerce
        // projection that would be the compromised adapter's own writes.
        corroboratingSource: 'mock_processor_settlement',
      });
    });
    const outcome = await proposeUnderLease(kernel, S1E_PASS_ORDER);
    expect(outcome.outcome, json(outcome)).toBe('PRE_RESERVATION_PASS');
  });

  it('an OPEN ContradictionLink denies PRECONDITION_CONTRADICTED at H′ — I29', async () => {
    await withClient(async (client) => {
      await insertStateFact(client, {
        factId: 'fact:conflicting-processor-record',
        subject: S1E_PASS_ORDER.resourceRef,
        predicate: REFUND_PRECONDITION_PREDICATE,
        value: 'false',
        writerKind: 'PARSER',
        sourceAdapter: 'mock_processor',
        // Recorded EARLIER, so it is not the fact step G selects; the contradiction is what
        // reaches it.
        recordedAt: new Date('2026-09-05T08:00:00.000Z'),
        observedAt: new Date('2026-09-05T08:00:00.000Z'),
      });
      await insertContradiction(client, {
        linkId: 'contradiction:1',
        factA: preconditionFactId(S1E_PASS_ORDER.orderId),
        factB: 'fact:conflicting-processor-record',
      });
    });
    const outcome = await proposeUnderLease(kernel, S1E_PASS_ORDER);
    expect(outcome.outcome).toBe('DENIED');
    if (outcome.outcome !== 'DENIED') return;
    expect(outcome.step).toBe('H′');
    expect(outcome.code).toBe('PRECONDITION_CONTRADICTED');
  });

  it('the link is found from EITHER side — inserting it the other way round does not evade it', async () => {
    await withClient(async (client) => {
      await insertStateFact(client, {
        factId: 'fact:conflicting-b',
        subject: S1E_PASS_ORDER.resourceRef,
        predicate: REFUND_PRECONDITION_PREDICATE,
        value: 'false',
        writerKind: 'PARSER',
        sourceAdapter: 'mock_processor',
        recordedAt: new Date('2026-09-05T08:00:00.000Z'),
        observedAt: new Date('2026-09-05T08:00:00.000Z'),
      });
      await insertContradiction(client, {
        linkId: 'contradiction:reversed',
        // The precondition fact is now fact_B.
        factA: 'fact:conflicting-b',
        factB: preconditionFactId(S1E_PASS_ORDER.orderId),
      });
    });
    const outcome = await proposeUnderLease(kernel, S1E_PASS_ORDER);
    expect(outcome.outcome === 'DENIED' && outcome.code).toBe('PRECONDITION_CONTRADICTED');
  });

  it('a RESOLVED link does not deny — only OPEN ones gate', async () => {
    await withClient(async (client) => {
      await insertStateFact(client, {
        factId: 'fact:was-conflicting',
        subject: S1E_PASS_ORDER.resourceRef,
        predicate: REFUND_PRECONDITION_PREDICATE,
        value: 'false',
        writerKind: 'PARSER',
        sourceAdapter: 'mock_processor',
        recordedAt: new Date('2026-09-05T08:00:00.000Z'),
        observedAt: new Date('2026-09-05T08:00:00.000Z'),
      });
      await insertContradiction(client, {
        linkId: 'contradiction:resolved',
        factA: preconditionFactId(S1E_PASS_ORDER.orderId),
        factB: 'fact:was-conflicting',
        status: 'RESOLVED',
      });
    });
    const outcome = await proposeUnderLease(kernel, S1E_PASS_ORDER);
    expect(outcome.outcome, json(outcome)).toBe('PRE_RESERVATION_PASS');
  });

  it('a DECISION_DELEGATED precondition denies PRECONDITION_DELEGATED at H″ — I28', async () => {
    await withClient(async (client) => {
      await client.query(`DELETE FROM state_fact`);
      await insertStateFact(client, {
        factId: 'fact:delegated-decision',
        subject: S1E_PASS_ORDER.resourceRef,
        predicate: REFUND_PRECONDITION_PREDICATE,
        value: 'true',
        // `24 §5`: the Decision Registry, acting within delegated authority. A MODEL writer
        // cannot produce this grade at all — the CHECK on `state_fact` refuses it — which is
        // MOA-10 closed at the schema.
        writerKind: 'KERNEL_SERVICE',
        decisionAuthority: 'DELEGATED',
      });
      const grade = await client.query<{ grade: string }>(
        `SELECT grade FROM state_fact WHERE fact_id = 'fact:delegated-decision'`,
      );
      expect(grade.rows[0]!.grade).toBe('DECISION_DELEGATED');
    });
    const outcome = await proposeUnderLease(kernel, S1E_PASS_ORDER);
    expect(outcome.outcome).toBe('DENIED');
    if (outcome.outcome !== 'DENIED') return;
    expect(outcome.step).toBe('H″');
    expect(outcome.code).toBe('PRECONDITION_DELEGATED');
  });

  it('AND THE OWNER-DECIDED EQUIVALENT PASSES — DECISION_OWNER is a gating grade', async () => {
    // `24 §5`'s table: DECISION_OWNER "May it be a policy precondition? **Yes**."
    // This is the discriminating sibling: the same fact, the same subject, the same value,
    // one authority attribute apart.
    await withClient(async (client) => {
      await client.query(`DELETE FROM state_fact`);
      await insertStateFact(client, {
        factId: 'fact:owner-decision',
        subject: S1E_PASS_ORDER.resourceRef,
        predicate: REFUND_PRECONDITION_PREDICATE,
        value: 'true',
        writerKind: 'KERNEL_SERVICE',
        decisionAuthority: 'OWNER',
      });
      const grade = await client.query<{ grade: string }>(
        `SELECT grade FROM state_fact WHERE fact_id = 'fact:owner-decision'`,
      );
      expect(grade.rows[0]!.grade).toBe('DECISION_OWNER');
    });
    const outcome = await proposeUnderLease(kernel, S1E_PASS_ORDER);
    expect(outcome.outcome, json(outcome)).toBe('PRE_RESERVATION_PASS');
  });
});

// =====================================================================================
// Step I — grants
// =====================================================================================

describe('step I — the matching grant, its scope, its expiry and its subset', () => {
  it('NO grant at all denies NO_GRANT', async () => {
    await withClient((client) => client.query(`DELETE FROM authority_grant_action_class`));
    const outcome = await proposeUnderLease(kernel, S1E_PASS_ORDER);
    expect(outcome.outcome).toBe('DENIED');
    if (outcome.outcome !== 'DENIED') return;
    expect(outcome.step).toBe('I');
    expect(outcome.code).toBe('NO_GRANT');
    expect(outcome.detail).toBe('NO_ACTIVE_GRANT');
  });

  it('an EXPIRED grant denies NO_GRANT — expiry is mandatory and it binds', async () => {
    await withClient((client) =>
      client.query(`UPDATE authority_grant SET expires_at = $1 WHERE grant_id = $2`, [
        new Date('2026-09-01T00:00:00.000Z'),
        REFUND_GRANT,
      ]),
    );
    const outcome = await proposeUnderLease(kernel, S1E_PASS_ORDER);
    expect(outcome.outcome === 'DENIED' && outcome.detail).toBe('NO_ACTIVE_GRANT');
  });

  it('a REVOKED grant denies NO_GRANT', async () => {
    await withClient((client) =>
      client.query(`UPDATE authority_grant SET status = 'REVOKED' WHERE grant_id = $1`, [
        REFUND_GRANT,
      ]),
    );
    expect((await proposeUnderLease(kernel, S1E_PASS_ORDER)).outcome).toBe('DENIED');
  });

  it('a grant whose RESOURCE SELECTOR names another order denies NO_GRANT', async () => {
    await withClient((client) =>
      client.query(
        `UPDATE authority_grant SET resource_predicate = $1 WHERE grant_id = $2`,
        [`RESOURCE_REF_EQ:${S1E_OVER_CAP_ORDER.resourceRef}`, REFUND_GRANT],
      ),
    );
    const outcome = await proposeUnderLease(kernel, S1E_PASS_ORDER);
    expect(outcome.outcome === 'DENIED' && outcome.code).toBe('NO_GRANT');
  });

  it('a grant selecting ANOTHER ROLE denies — the role is the kernel-resolved one', async () => {
    await withClient((client) =>
      client.query(
        `UPDATE authority_grant SET principal_role = 'market_researcher' WHERE grant_id = $1`,
        [REFUND_GRANT],
      ),
    );
    expect((await proposeUnderLease(kernel, S1E_PASS_ORDER)).outcome).toBe('DENIED');
  });

  it('a grant OUTSIDE the delegated subset denies — rule 2 is consumed, not merely checked', async () => {
    // The chain narrows to {refund.create}. A grant for a class the chain conveys is usable;
    // narrowing the chain to a DIFFERENT class makes the same grant unusable, with every
    // other row untouched.
    await withClient(async (client) => {
      await client.query(`DELETE FROM delegation_hop WHERE hop_index = 2`);
      await insertDelegationHop(client, {
        principalId: WORKER_PRINCIPAL,
        hopIndex: 2,
        delegatingPrincipalId: CEO_PRINCIPAL,
        grantedActionClasses: ['campaign.pause'],
        signWith: world.ceoSigner,
      });
    });
    const outcome = await proposeUnderLease(kernel, S1E_PASS_ORDER);
    expect(outcome.outcome).toBe('DENIED');
    if (outcome.outcome !== 'DENIED') return;
    expect(outcome.step).toBe('I');
    expect(outcome.code).toBe('NO_GRANT');
  });

  it('a grant with NO MONTH window denies — MAL_total(month) must be defined', async () => {
    await withClient((client) =>
      client.query(`DELETE FROM authority_grant_window WHERE window_id = 'W_MONTH_REFUND'`),
    );
    const outcome = await proposeUnderLease(kernel, S1E_PASS_ORDER);
    expect(outcome.outcome === 'DENIED' && outcome.detail).toBe('GRANT_MISSING_MONTH_WINDOW');
  });

  it('A BROADER CONCURRENT GRANT CANNOT ERASE A NARROWER RESTRICTION', async () => {
    // The mandate's case, and `26 §4`'s rule: "a grant may only narrow."
    //
    // Grant A (the fixture) permits COMPENSABLE. Grant B permits IRRECOVERABLE and is
    // otherwise identical. `refund.create` is COMPENSABLE (`26 §5`), so BOTH admit it and the
    // union would too. The DISCRIMINATING case is the recoverability ceiling: narrow the
    // fixture grant to REVERSIBLE and add a broad IRRECOVERABLE one. Under a union the
    // proposal proceeds; under the intersection it denies at step J.
    await withClient(async (client) => {
      await client.query(
        `UPDATE authority_grant SET recoverability_max = 'REVERSIBLE' WHERE grant_id = $1`,
        [REFUND_GRANT],
      );
      await insertGrant(client, {
        grantId: 'grant:s1e:broad',
        actionClasses: ['refund.create'],
        windows: ['W_DAY_REFUND', 'W_MONTH_REFUND'],
        recoverabilityMax: 'IRRECOVERABLE',
      });
    });
    const outcome = await proposeUnderLease(kernel, S1E_PASS_ORDER);
    expect(outcome.outcome).toBe('DENIED');
    if (outcome.outcome !== 'DENIED') return;
    expect(outcome.step).toBe('J');
    expect(outcome.code).toBe('RECOVERABILITY');
  });

  it('and the same pair with the narrow grant at COMPENSABLE passes — the sibling control', async () => {
    await withClient((client) =>
      insertGrant(client, {
        grantId: 'grant:s1e:broad',
        actionClasses: ['refund.create'],
        windows: ['W_DAY_REFUND', 'W_MONTH_REFUND'],
        recoverabilityMax: 'IRRECOVERABLE',
      }),
    );
    const outcome = await proposeUnderLease(kernel, S1E_PASS_ORDER);
    expect(outcome.outcome, json(outcome)).toBe('PRE_RESERVATION_PASS');
  });

  it('window_refs on the request are the UNION over matching grants', async () => {
    await withClient((client) =>
      insertGrant(client, {
        grantId: 'grant:s1e:extra-window',
        actionClasses: ['refund.create'],
        windows: ['W_MONTH_REFUND', 'W_MONTH_UNGATED'],
      }),
    );
    const outcome = await proposeUnderLease(kernel, S1E_PASS_ORDER);
    expect(outcome.outcome).toBe('PRE_RESERVATION_PASS');
    if (outcome.outcome !== 'PRE_RESERVATION_PASS') return;
    expect(outcome.windowRefs).toEqual(['W_DAY_REFUND', 'W_MONTH_REFUND', 'W_MONTH_UNGATED']);
    expect(outcome.request.windowRefs).toEqual(outcome.windowRefs);
  });
});

// =====================================================================================
// Step J — recoverability
// =====================================================================================

describe('step J — recoverability against the effective grant ceiling', () => {
  it('a REVERSIBLE-only grant denies a COMPENSABLE class', async () => {
    await withClient((client) =>
      client.query(
        `UPDATE authority_grant SET recoverability_max = 'REVERSIBLE' WHERE grant_id = $1`,
        [REFUND_GRANT],
      ),
    );
    const outcome = await proposeUnderLease(kernel, S1E_PASS_ORDER);
    expect(outcome.outcome).toBe('DENIED');
    if (outcome.outcome !== 'DENIED') return;
    expect(outcome.step).toBe('J');
    expect(outcome.code).toBe('RECOVERABILITY');
    expect(outcome.detail).toBe('RECOVERABILITY_ABOVE_GRANT_MAX');
  });
});

// =====================================================================================
// Step L — evidence
// =====================================================================================

describe('step L — evidence requirements, from the grant and the kernel evidence store', () => {
  async function requireTwoIndependentSources(): Promise<void> {
    await withClient((client) =>
      client.query(
        `UPDATE authority_grant
            SET evidence_min_sources = 2, evidence_max_tier = 4, evidence_max_age_days = 30
          WHERE grant_id = $1`,
        [REFUND_GRANT],
      ),
    );
  }

  it('a grant requiring evidence with NO bound evidence set denies EVIDENCE', async () => {
    await requireTwoIndependentSources();
    const outcome = await proposeUnderLease(kernel, S1E_PASS_ORDER);
    expect(outcome.outcome).toBe('DENIED');
    if (outcome.outcome !== 'DENIED') return;
    expect(outcome.step).toBe('L');
    expect(outcome.code).toBe('EVIDENCE');
    expect(outcome.detail).toBe('EVIDENCE_SET_ABSENT');
  });

  it('TWO ITEMS FROM ONE DOMAIN are one source and deny', async () => {
    // `24 §13`: "Two articles quoting the same press release are one source."
    await requireTwoIndependentSources();
    await withClient(async (client) => {
      await insertEvidenceSource(client, {
        sourceId: 'src:a',
        registrableDomain: 'example.com',
        ownerEntity: 'Example Ltd',
        tier: 2,
      });
      await insertEvidenceItem(client, { itemId: 'ev:1', sourceId: 'src:a' });
      await insertEvidenceItem(client, { itemId: 'ev:2', sourceId: 'src:a' });
      await bindEvidenceSet(client, {
        evidenceSetId: 'set:one-domain',
        itemIds: ['ev:1', 'ev:2'],
        loadBearingItemId: 'ev:1',
        resourceId: S1E_PASS_ORDER.orderId,
      });
    });
    const outcome = await proposeUnderLease(kernel, S1E_PASS_ORDER);
    expect(outcome.outcome === 'DENIED' && outcome.detail).toBe(
      'EVIDENCE_INSUFFICIENT_INDEPENDENT_SOURCES',
    );
  });

  it('TWO GENUINELY INDEPENDENT SOURCES PASS — the discriminating sibling', async () => {
    await requireTwoIndependentSources();
    await withClient(async (client) => {
      await insertEvidenceSource(client, {
        sourceId: 'src:a',
        registrableDomain: 'example.com',
        ownerEntity: 'Example Ltd',
        tier: 2,
      });
      await insertEvidenceSource(client, {
        sourceId: 'src:b',
        registrableDomain: 'other.org',
        ownerEntity: 'Other Foundation',
        tier: 3,
      });
      await insertEvidenceItem(client, { itemId: 'ev:1', sourceId: 'src:a' });
      await insertEvidenceItem(client, { itemId: 'ev:2', sourceId: 'src:b' });
      await bindEvidenceSet(client, {
        evidenceSetId: 'set:two-domains',
        itemIds: ['ev:1', 'ev:2'],
        loadBearingItemId: 'ev:1',
        resourceId: S1E_PASS_ORDER.orderId,
      });
    });
    const outcome = await proposeUnderLease(kernel, S1E_PASS_ORDER);
    expect(outcome.outcome, json(outcome)).toBe('PRE_RESERVATION_PASS');
  });

  it('SAME OWNER ENTITY across two domains is still one source', async () => {
    await requireTwoIndependentSources();
    await withClient(async (client) => {
      await insertEvidenceSource(client, {
        sourceId: 'src:a',
        registrableDomain: 'example.com',
        ownerEntity: 'Same Holdings',
        tier: 2,
      });
      await insertEvidenceSource(client, {
        sourceId: 'src:b',
        registrableDomain: 'example.org',
        ownerEntity: 'Same Holdings',
        tier: 2,
      });
      await insertEvidenceItem(client, { itemId: 'ev:1', sourceId: 'src:a' });
      await insertEvidenceItem(client, { itemId: 'ev:2', sourceId: 'src:b' });
      await bindEvidenceSet(client, {
        evidenceSetId: 'set:same-owner',
        itemIds: ['ev:1', 'ev:2'],
        resourceId: S1E_PASS_ORDER.orderId,
      });
    });
    const outcome = await proposeUnderLease(kernel, S1E_PASS_ORDER);
    expect(outcome.outcome === 'DENIED' && outcome.detail).toBe(
      'EVIDENCE_INSUFFICIENT_INDEPENDENT_SOURCES',
    );
  });

  it('AN ITEM THAT WAS NOT RETRIEVED denies on coverage — inaccessible evidence is evidence', async () => {
    await requireTwoIndependentSources();
    await withClient(async (client) => {
      await insertEvidenceSource(client, {
        sourceId: 'src:a',
        registrableDomain: 'example.com',
        tier: 2,
      });
      await insertEvidenceSource(client, {
        sourceId: 'src:b',
        registrableDomain: 'other.org',
        tier: 3,
      });
      await insertEvidenceItem(client, { itemId: 'ev:1', sourceId: 'src:a' });
      await insertEvidenceItem(client, {
        itemId: 'ev:2',
        sourceId: 'src:b',
        accessStatus: 'ROBOTS_BLOCKED',
      });
      await bindEvidenceSet(client, {
        evidenceSetId: 'set:gap',
        itemIds: ['ev:1', 'ev:2'],
        resourceId: S1E_PASS_ORDER.orderId,
      });
    });
    const outcome = await proposeUnderLease(kernel, S1E_PASS_ORDER);
    expect(outcome.outcome === 'DENIED' && outcome.detail).toBe('EVIDENCE_COVERAGE_INCOMPLETE');
  });

  it('A SOURCE BELOW THE DECLARED TIER CEILING denies', async () => {
    await requireTwoIndependentSources();
    await withClient(async (client) => {
      await insertEvidenceSource(client, {
        sourceId: 'src:a',
        registrableDomain: 'example.com',
        tier: 2,
      });
      // `24 §12` tier 9 is "Vendor marketing"; the grant's ceiling is 4.
      await insertEvidenceSource(client, {
        sourceId: 'src:vendor',
        registrableDomain: 'vendor.example',
        tier: 9,
        vendorInterest: true,
      });
      await insertEvidenceItem(client, { itemId: 'ev:1', sourceId: 'src:a' });
      await insertEvidenceItem(client, { itemId: 'ev:2', sourceId: 'src:vendor' });
      await bindEvidenceSet(client, {
        evidenceSetId: 'set:vendor',
        itemIds: ['ev:1', 'ev:2'],
        resourceId: S1E_PASS_ORDER.orderId,
      });
    });
    const outcome = await proposeUnderLease(kernel, S1E_PASS_ORDER);
    expect(outcome.outcome === 'DENIED' && outcome.detail).toBe('EVIDENCE_SOURCE_TIER_TOO_LOW');
  });

  it('AN ITEM OUTSIDE THE FRESHNESS WINDOW denies', async () => {
    await requireTwoIndependentSources();
    await withClient(async (client) => {
      await insertEvidenceSource(client, {
        sourceId: 'src:a',
        registrableDomain: 'example.com',
        tier: 2,
      });
      await insertEvidenceSource(client, {
        sourceId: 'src:b',
        registrableDomain: 'other.org',
        tier: 3,
      });
      await insertEvidenceItem(client, { itemId: 'ev:1', sourceId: 'src:a' });
      await insertEvidenceItem(client, {
        itemId: 'ev:2',
        sourceId: 'src:b',
        // The grant declares 30 days; the fixture clock is 2026-09-05.
        fetchAt: new Date('2026-06-01T00:00:00.000Z'),
      });
      await bindEvidenceSet(client, {
        evidenceSetId: 'set:stale',
        itemIds: ['ev:1', 'ev:2'],
        resourceId: S1E_PASS_ORDER.orderId,
      });
    });
    const outcome = await proposeUnderLease(kernel, S1E_PASS_ORDER);
    expect(outcome.outcome === 'DENIED' && outcome.detail).toBe('EVIDENCE_PAST_MAX_AGE');
  });
});

// =====================================================================================
// Step M — the accepted S1D Cedar decision, reached through the whole sequence
// =====================================================================================

describe('step M — the accepted VC-C1 denial, after every preceding gate has PASSED', () => {
  it('$25.00 + $1.03 = $26.03 denies PER_ACTION at step M, having passed D–L', async () => {
    const outcome = await proposeUnderLease(kernel, S1E_OVER_CAP_ORDER);
    expect(outcome.outcome).toBe('DENIED');
    if (outcome.outcome !== 'DENIED') return;
    expect(outcome.step).toBe('M');
    expect(outcome.code).toBe('PER_ACTION');
    // The gates that ran BEFORE the denial — every one of D through L.
    expect(outcome.stepsEvaluated).toEqual([
      'D', 'E', 'F', 'G', 'H', 'H′', 'H″', 'I', 'J', 'K', 'L', 'M',
    ]);
    // Step M's internal reason is the DETERMINING CEDAR POLICY, carried on the lineage.
    // `26 §11` P1's operand is `exposure.total_exposure`, and the policy that fired is the
    // one that holds that literal.
    expect(outcome.lineage?.determiningPolicies).toEqual(['acos.refund.create.per_action_max']);
    expect(outcome.detail).toBeNull();
    expect(projectPreReservationToWorker(outcome)).toEqual({ deny: 'PER_ACTION' });
  });

  it('the worker learns no amount, no policy id and no distance from the cap', async () => {
    const outcome = await proposeUnderLease(kernel, S1E_OVER_CAP_ORDER);
    const projected = json(projectPreReservationToWorker(outcome));
    for (const leak of ['25.00', '26.03', '1.03', 'acos.refund', 'total_exposure', 'M']) {
      expect(projected).not.toContain(leak);
    }
  });
});

// =====================================================================================
// Step N — the autonomy ledger
// =====================================================================================

describe('step N — the autonomy ledger, with kernel-owned operands', () => {
  it('an ABSENT ledger entry REQUIRES APPROVAL — it does not permit and does not deny', async () => {
    await withClient((client) => client.query(`DELETE FROM autonomy_ledger_entry`));
    const outcome = await proposeUnderLease(kernel, S1E_PASS_ORDER);
    expect(outcome.outcome).toBe('REQUIRE_APPROVAL');
    if (outcome.outcome !== 'REQUIRE_APPROVAL') return;
    expect(outcome.reason).toBe('LEDGER_ENTRY_ABSENT');
    expect(projectPreReservationToWorker(outcome)).toEqual({ approvalRequired: true });
  });

  it('a level BELOW L3 requires approval', async () => {
    await withClient((client) =>
      client.query(`UPDATE autonomy_ledger_entry SET level = 'L2_SUPERVISED'`),
    );
    const outcome = await proposeUnderLease(kernel, S1E_PASS_ORDER);
    expect(outcome.outcome === 'REQUIRE_APPROVAL' && outcome.reason).toBe(
      'LEVEL_BELOW_AUTONOMOUS_FLOOR',
    );
  });

  it('an ACTIVE probation requires approval', async () => {
    await withClient((client) =>
      client.query(`UPDATE autonomy_ledger_entry SET probation_until = $1`, [
        new Date('2026-10-01T00:00:00.000Z'),
      ]),
    );
    const outcome = await proposeUnderLease(kernel, S1E_PASS_ORDER);
    expect(outcome.outcome === 'REQUIRE_APPROVAL' && outcome.reason).toBe('ON_PROBATION');
  });

  it('ONE recorded policy violation demotes immediately — `26 §13`', async () => {
    await withClient((client) =>
      client.query(`UPDATE autonomy_ledger_entry SET policy_violations = 1`),
    );
    const outcome = await proposeUnderLease(kernel, S1E_PASS_ORDER);
    expect(outcome.outcome === 'REQUIRE_APPROVAL' && outcome.reason).toBe(
      'POLICY_VIOLATION_RECORDED',
    );
  });

  it('A CHANGED MODEL BINDING DEMOTES — the ledger key includes it, so the entry stops matching', async () => {
    // SR6, `26 §13`: "Model change demotes […] the earned level cannot transfer." No sweep is
    // needed: the key contains the binding, so a new binding has no entry.
    await withClient((client) =>
      client.query(`UPDATE principal SET model_binding = $1 WHERE principal_id = $2`, [
        'model:fixture-binding@2/prompt@1',
        WORKER_PRINCIPAL,
      ]),
    );
    const outcome = await proposeUnderLease(kernel, S1E_PASS_ORDER);
    expect(outcome.outcome === 'REQUIRE_APPROVAL' && outcome.reason).toBe('LEDGER_ENTRY_ABSENT');
  });

  it('an entry for ANOTHER key does not satisfy this one', async () => {
    await withClient(async (client) => {
      await client.query(`DELETE FROM autonomy_ledger_entry`);
      await insertAutonomyEntry(client, { taskType: 'some_other_task_type' });
    });
    const outcome = await proposeUnderLease(kernel, S1E_PASS_ORDER);
    expect(outcome.outcome).toBe('REQUIRE_APPROVAL');
  });

  it('the ledger key is exactly `26 §13`\'s four components, as rows', async () => {
    // Asserted against the DATABASE's own primary key, not against the resolver.
    const columns = await withClient((client) =>
      client.query<{ attname: string }>(
        `SELECT a.attname
           FROM pg_index i
           JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
          WHERE i.indrelid = 'autonomy_ledger_entry'::regclass AND i.indisprimary
          ORDER BY a.attname`,
      ),
    );
    expect(columns.rows.map((row) => row.attname)).toEqual([
      'action_class',
      'company_id',
      'model_binding',
      'resource_class',
      'task_type',
    ]);
    expect(AUTONOMY_KEY_BINDING).toContain('refund.create');
  });
});

// =====================================================================================
// The kernel-service branch — `26 §7.1`
// =====================================================================================

describe('`26 §7.1` — the KERNEL_SERVICE branch is not a hidden alternate route', () => {
  it('a KERNEL_SERVICE principal traverses the SAME worker gates and is not exempted', async () => {
    // `26 §7.1`'s table marks I, K, L and N as SKIPPED for a request whose authority is a
    // `StandingRevocationAuthority`. S1E implements no standing-revocation lifecycle, so no
    // such authority can exist — and the branch must therefore NOT be reachable by merely
    // being a KERNEL_SERVICE principal. A kernel-kind principal here is evaluated by every
    // gate a worker is, which is the fail-closed reading.
    await withClient(async (client) => {
      await insertPrincipal(client, {
        principalId: 'principal:kernel',
        kind: 'KERNEL_SERVICE',
        role: 'kernel',
      });
      await insertSession(client, {
        sessionId: 'session:kernel',
        principalId: 'principal:kernel',
      });
    });
    const outcome = await proposeUnderLease(kernel, S1E_PASS_ORDER, {
      sessionId: 'session:kernel',
    });
    // It denies at step D because the task belongs to the worker — there is no kernel task,
    // no standing authorisation and no revocation authority, so the branch has no entry
    // point at all. What matters is that it does not PASS.
    expect(outcome.outcome).toBe('DENIED');
    if (outcome.outcome !== 'DENIED') return;
    expect(outcome.step).toBe('D');
  });

  it('and a kernel principal with its own task still faces step I, which it cannot satisfy', async () => {
    await withClient(async (client) => {
      await insertPrincipal(client, {
        principalId: 'principal:kernel',
        kind: 'KERNEL_SERVICE',
        role: 'kernel',
      });
      await insertSession(client, {
        sessionId: 'session:kernel',
        principalId: 'principal:kernel',
      });
      await client.query(`UPDATE authority_task SET principal_id = 'principal:kernel'`);
      await client.query(`DELETE FROM agent_profile_capability`);
      await client.query(
        `INSERT INTO agent_profile_capability (company_id, principal_id, action_class, status)
         VALUES ($1,'principal:kernel','refund.create','ENABLED')`,
        [COMPANY_ID],
      );
    });
    const outcome = await proposeUnderLease(kernel, S1E_PASS_ORDER, {
      sessionId: 'session:kernel',
      // The `context_spec` is a `23 §5` B9 control artifact bound to one principal, so the
      // kernel principal gets its own rather than borrowing the worker's — a spec naming a
      // different principal from the session is a defect and throws, which is asserted
      // separately in the authority-channel suite.
      spec: s1eSpec({ principalId: 'principal:kernel' }),
    });
    // The grant selects role `support_reasoner`, so `26 §7.1`'s STD-03 deadlock is exactly
    // what happens: NO_GRANT. S1E does NOT resolve it, because resolving it requires the
    // `StandingRevocationAuthority` and its lifecycle, which is step-R-and-after work.
    expect(outcome.outcome).toBe('DENIED');
    if (outcome.outcome !== 'DENIED') return;
    expect(outcome.step).toBe('I');
    expect(outcome.code).toBe('NO_GRANT');
  });
});

// =====================================================================================
// The accepted S1C guarantees still hold ahead of the sequence
// =====================================================================================

describe('the accepted S1B/S1C behaviour is unchanged ahead of step D', () => {
  it('a stale option_id still denies SELECTOR and never reaches an authority gate', async () => {
    const spec = s1eSpec();
    const key = entityKeyFor(S1E_PASS_ORDER.orderId);
    const enumerationId = await kernel.leases.withEntityLease(key, async (lease) =>
      (
        await kernel.enumerator.enumerate(lease, {
          actionClass: 'refund.create',
          resourceRef: S1E_PASS_ORDER.resourceRef,
          spec,
        })
      ).set.enumerationId,
    );
    const intent = parseProposedIntent(
      rawIntent({
        resourceRef: S1E_PASS_ORDER.resourceRef,
        enumerationId,
        optionId: 'deadbeef'.repeat(8),
      }),
    );
    const outcome = await kernel.leases.withEntityLease(key, (lease) =>
      kernel.pipeline.evaluateUnderLease(
        lease,
        workerSession(),
        intent,
        spec,
        nonAuthorityContext(),
      ),
    );
    expect(outcome.outcome).toBe('DENIED');
    if (outcome.outcome !== 'DENIED') return;
    expect(outcome.step).toBe('C′');
    // The whole selector family stays collapsed at the worker — S1C's CAN-05 closure.
    expect(projectPreReservationToWorker(outcome)).toEqual({ deny: 'SELECTOR' });
    // And step D ran before C′ — the principal was resolved — but no gate after it did.
    expect(outcome.stepsEvaluated).toEqual(['D']);
  });

  it('the precondition fact is fetched for the KERNEL-RESOLVED resource', async () => {
    // The fixture fact is keyed on the resolved `resource_ref`. Renaming the fact's subject
    // to something the model wrote but the kernel did not resolve makes it invisible.
    await withClient((client) =>
      client.query(`UPDATE state_fact SET subject = 'order:ATTACKER-CHOSEN' WHERE fact_id = $1`, [
        preconditionFactId(S1E_PASS_ORDER.orderId),
      ]),
    );
    const outcome = await proposeUnderLease(kernel, S1E_PASS_ORDER);
    expect(outcome.outcome === 'DENIED' && outcome.detail).toBe('PRECONDITION_FACT_ABSENT');
    expect(OWNER_PRINCIPAL).toBe('principal:owner');
  });
});
