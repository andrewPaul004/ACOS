import type { PoolClient } from 'pg';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { parseProposedIntent } from '../../src/kernel/canonicalisation/intent.js';
import { toDb } from '../../src/kernel/exposure/money.js';
import { FixedClock } from '../../src/kernel/enumeration/clock.js';
import { AuthorityDenied } from '../../src/kernel/authority/errors.js';
import { GrantResolver, evaluateGrantMatch } from '../../src/kernel/authority/grants.js';
import { PreconditionEvaluator } from '../../src/kernel/authority/preconditions.js';
import { PrincipalResolver } from '../../src/kernel/authority/principal.js';
import { evaluateCategoricalProhibition } from '../../src/kernel/authority/prohibitions.js';
import { evaluateRecoverability } from '../../src/kernel/authority/recoverability.js';
import { createHarness, COMPANY_ID, type Harness } from '../support/fixture.js';
import {
  FIXTURE_NOW,
  entityKeyFor,
  loadCommerceFixture,
  rawIntent,
} from '../support/enumerationFixture.js';
import {
  REFUND_GRANT,
  REFUND_PRECONDITION_PREDICATE,
  S1E_PASS_ORDER,
  WORKER_PRINCIPAL,
  insertContradiction,
  insertGrant,
  insertPrincipal,
  insertSession,
  insertStateFact,
  loadAuthorityWorld,
  loadS1eOrders,
  makeAuthorityHarness,
  nonAuthorityContext,
  preconditionFactId,
  proposeUnderLease,
  s1eSpec,
  workerSession,
  type AuthorityHarness,
} from '../support/authorityFixture.js';
import { unsafeResolvePrincipalFromAssertion } from './unsafe-caller-supplied-principal.js';
import {
  unsafeEvaluateContradictions,
  unsafeEvaluateGrade,
} from './unsafe-precondition-evaluator.js';
import { unsafePermissiveAuthority } from './unsafe-permissive-grant-union.js';
import { unsafeEvaluateProhibition } from './unsafe-appealable-prohibition.js';
import { runInTwoLeases } from './unsafe-lease-reacquire.js';

/**
 * THE DISCRIMINATING NEGATIVE CONTROLS FOR `26 §7` STEPS D, E, H, H′ AND THE LEASE SPAN.
 *
 * `36 §0`, and the S1E mandate in the same words: a security test whose only oracle is the
 * implementation under test is not evidence. For each attack below, the SAME fixture is run
 * through two implementations:
 *
 *   an intentionally vulnerable one, in `tests/negative-controls/`, which ACCEPTS the attack
 *   the production one, in `src/kernel/authority/`, which REJECTS it
 *
 * A run in which the vulnerable implementation also rejects the attack is a TEST FAILURE, not
 * a pass: it would mean the fixture does not actually exercise the defect, and the production
 * assertion beside it would be certifying nothing.
 */

let harness: Harness;
let kernel: AuthorityHarness;

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
  await withClient(async (client) => {
    await loadCommerceFixture(client);
    await loadS1eOrders(client);
    await loadAuthorityWorld(client);
  });
  kernel = makeAuthorityHarness(harness);
});

// =====================================================================================
// ATTACK 1 — a caller-supplied principal
// =====================================================================================

describe('ATTACK — the caller asserts a principal it is not', () => {
  /**
   * The fixture: a REAL session belonging to a principal with no authority, and a spoofed
   * assertion naming the principal that has it.
   *
   * `market_researcher` is one of `26 §3`'s own example roles and the fixture grant selects
   * `support_reasoner`, so the two differ on the operand `26 §8`'s worked policy opens with.
   */
  async function seedAttacker(client: PoolClient): Promise<void> {
    await insertPrincipal(client, {
      principalId: 'principal:market_researcher:1',
      kind: 'AI_ROLE',
      role: 'market_researcher',
      modelBinding: 'model:researcher@1/prompt@1',
    });
    await insertSession(client, {
      sessionId: 'session:attacker',
      principalId: 'principal:market_researcher:1',
    });
  }

  it('VULNERABLE — the asserted principal is resolved, and its grant matches', async () => {
    await withClient(seedAttacker);
    const resolved = await withClient((client) =>
      unsafeResolvePrincipalFromAssertion(client, {
        companyId: COMPANY_ID,
        sessionId: 'session:attacker',
        // THE SPOOF.
        assertedPrincipalId: WORKER_PRINCIPAL,
      }),
    );
    expect(resolved).not.toBeNull();
    expect(resolved!.resolved.role).toBe('support_reasoner');

    // And the attack SUCCEEDS all the way to a matching grant, which is what makes it an
    // authority bypass rather than a cosmetic difference.
    const grants = await withClient((client) =>
      new GrantResolver({ clock: new FixedClock(FIXTURE_NOW) }).resolve(
        client,
        COMPANY_ID,
        resolved!,
        'refund.create',
        { resourceRef: S1E_PASS_ORDER.resourceRef, resourceId: S1E_PASS_ORDER.orderId, grade: 'RECORD' },
      ),
    );
    expect(grants.map((grant) => grant.grantId)).toEqual([REFUND_GRANT]);
  });

  it('PRODUCTION — the SESSION decides, so the same fixture resolves the unauthorised principal', async () => {
    await withClient(seedAttacker);
    // Step D denies before the grant is ever consulted, because the task belongs to the
    // worker and the session does not. The spoofed id has no argument position at all.
    const resolver = new PrincipalResolver({ clock: new FixedClock(FIXTURE_NOW) });
    await expect(
      withClient((client) =>
        resolver.resolve(
          client,
          { companyId: COMPANY_ID, sessionId: 'session:attacker' },
          's1e:task-of-the-worker',
        ),
      ),
    ).rejects.toBeInstanceOf(AuthorityDenied);
  });

  it('PRODUCTION — and with its own task, the attacker resolves as ITSELF and matches no grant', async () => {
    await withClient(async (client) => {
      await seedAttacker(client);
      await client.query(
        `INSERT INTO authority_task (company_id, task_id, task_type, principal_id)
         VALUES ($1, 'task:attacker', 'support_case', 'principal:market_researcher:1')`,
        [COMPANY_ID],
      );
    });
    const resolver = new PrincipalResolver({ clock: new FixedClock(FIXTURE_NOW) });
    const resolved = await withClient((client) =>
      resolver.resolve(client, { companyId: COMPANY_ID, sessionId: 'session:attacker' }, 'task:attacker'),
    );
    // The kernel stamped the REAL principal, not the asserted one.
    expect(resolved.resolved.id).toBe('principal:market_researcher:1');
    expect(resolved.resolved.role).toBe('market_researcher');

    const grants = await withClient((client) =>
      new GrantResolver({ clock: new FixedClock(FIXTURE_NOW) }).resolve(
        client,
        COMPANY_ID,
        resolved,
        'refund.create',
        { resourceRef: S1E_PASS_ORDER.resourceRef, resourceId: S1E_PASS_ORDER.orderId, grade: 'RECORD' },
      ),
    );
    expect(grants).toHaveLength(0);
    expect(() => evaluateGrantMatch(grants, [])).toThrow(AuthorityDenied);
  });

  it('THE TEST DISCRIMINATES — the two implementations disagree on one fixture', async () => {
    await withClient(seedAttacker);
    const spoofed = await withClient((client) =>
      unsafeResolvePrincipalFromAssertion(client, {
        companyId: COMPANY_ID,
        sessionId: 'session:attacker',
        assertedPrincipalId: WORKER_PRINCIPAL,
      }),
    );
    expect(spoofed!.resolved.id).toBe(WORKER_PRINCIPAL);
    // Production has NO parameter through which the same fixture could be expressed. That is
    // the property; the assertion below is that the type says so.
    const resolveSignature = PrincipalResolver.prototype.resolve.length;
    expect(resolveSignature).toBe(3); // (client, session, taskId) — and nothing else.
  });
});

// =====================================================================================
// ATTACK 2 — an ungated grade, and a missing contradiction check
// =====================================================================================

describe('ATTACK — a model-authored fact gates money, and a contradicted one is not noticed', () => {
  async function seedModelAuthoredFact(client: PoolClient): Promise<void> {
    await client.query(`DELETE FROM state_fact WHERE fact_id = $1`, [
      preconditionFactId(S1E_PASS_ORDER.orderId),
    ]);
    await insertStateFact(client, {
      factId: preconditionFactId(S1E_PASS_ORDER.orderId),
      subject: S1E_PASS_ORDER.resourceRef,
      predicate: REFUND_PRECONDITION_PREDICATE,
      value: 'true',
      writerKind: 'MODEL',
      writerPrincipalId: WORKER_PRINCIPAL,
    });
  }

  async function fetched(): Promise<
    Awaited<ReturnType<PreconditionEvaluator['fetch']>>
  > {
    return withClient((client) =>
      new PreconditionEvaluator({ clock: new FixedClock(FIXTURE_NOW) }).fetch(
        client,
        COMPANY_ID,
        'refund.create',
        S1E_PASS_ORDER.resourceRef,
      ),
    );
  }

  it('VULNERABLE — the unsafe evaluator accepts an INTERPRETATION-grade precondition', async () => {
    await withClient(seedModelAuthoredFact);
    const preconditions = await fetched();
    expect(preconditions[0]!.grade).toBe('INTERPRETATION');
    // The attack succeeds: no throw.
    expect(() => unsafeEvaluateGrade(preconditions)).not.toThrow();
  });

  it('PRODUCTION — the same set denies PRECONDITION on grade', async () => {
    await withClient(seedModelAuthoredFact);
    const preconditions = await fetched();
    const evaluator = new PreconditionEvaluator({ clock: new FixedClock(FIXTURE_NOW) });
    expect(() => evaluator.evaluateGrade(preconditions)).toThrow(AuthorityDenied);
  });

  it('AND END TO END, the same fixture denies rather than reaching Cedar', async () => {
    await withClient(seedModelAuthoredFact);
    const outcome = await proposeUnderLease(kernel, S1E_PASS_ORDER);
    expect(outcome.outcome).toBe('DENIED');
    if (outcome.outcome !== 'DENIED') return;
    expect(outcome.step).toBe('H');
    expect(outcome.stepsEvaluated).not.toContain('M');
  });

  async function seedOpenContradiction(client: PoolClient): Promise<void> {
    await insertStateFact(client, {
      factId: 'fact:processor-disagrees',
      subject: S1E_PASS_ORDER.resourceRef,
      predicate: REFUND_PRECONDITION_PREDICATE,
      value: 'false',
      writerKind: 'PARSER',
      sourceAdapter: 'mock_processor',
      recordedAt: new Date('2026-09-05T08:00:00.000Z'),
      observedAt: new Date('2026-09-05T08:00:00.000Z'),
    });
    await insertContradiction(client, {
      linkId: 'contradiction:commerce-vs-processor',
      factA: preconditionFactId(S1E_PASS_ORDER.orderId),
      factB: 'fact:processor-disagrees',
    });
  }

  it('VULNERABLE — the v1.0 evaluator does not notice the open ContradictionLink', async () => {
    await withClient(seedOpenContradiction);
    const preconditions = await fetched();
    await withClient(async (client) => {
      // The attack succeeds: no throw, on a set that IS in an open contradiction.
      await expect(
        unsafeEvaluateContradictions(client, COMPANY_ID, preconditions),
      ).resolves.toBeUndefined();
      const open = await client.query<{ count: string }>(
        `SELECT count(*) AS count FROM contradiction_link WHERE status = 'OPEN'`,
      );
      expect(open.rows[0]!.count).toBe('1');
    });
  });

  it('PRODUCTION — the same set denies PRECONDITION_CONTRADICTED at H′', async () => {
    await withClient(seedOpenContradiction);
    const preconditions = await fetched();
    const evaluator = new PreconditionEvaluator({ clock: new FixedClock(FIXTURE_NOW) });
    await withClient(async (client) => {
      await expect(
        evaluator.evaluateContradictions(client, COMPANY_ID, preconditions),
      ).rejects.toBeInstanceOf(AuthorityDenied);
    });
  });
});

// =====================================================================================
// ATTACK 3 — a broad grant erasing a narrow restriction
// =====================================================================================

describe('ATTACK — a broader concurrent grant widens the effective authority', () => {
  async function seedNarrowAndBroad(client: PoolClient): Promise<void> {
    await client.query(
      `UPDATE authority_grant SET recoverability_max = 'REVERSIBLE' WHERE grant_id = $1`,
      [REFUND_GRANT],
    );
    await insertGrant(client, {
      grantId: 'grant:s1e:broad',
      actionClasses: ['refund.create'],
      windows: ['W_DAY_REFUND', 'W_MONTH_REFUND'],
      recoverabilityMax: 'IRRECOVERABLE',
      perActionMaxMonetary: '250.00',
    });
  }

  it('VULNERABLE — the union yields IRRECOVERABLE, and step J passes', async () => {
    await withClient(seedNarrowAndBroad);
    const grants = await withClient((client) =>
      new GrantResolver({ clock: new FixedClock(FIXTURE_NOW) }).resolve(
        client,
        COMPANY_ID,
        { resolved: { id: WORKER_PRINCIPAL, kind: 'AI_ROLE', role: 'support_reasoner', modelBinding: 'model:fixture-binding@1/prompt@1', delegationDepth: 2 }, chain: [], effectiveActionClasses: null },
        'refund.create',
        { resourceRef: S1E_PASS_ORDER.resourceRef, resourceId: S1E_PASS_ORDER.orderId, grade: 'RECORD' },
      ),
    );
    expect(grants).toHaveLength(2);
    const unsafe = unsafePermissiveAuthority(grants);
    expect(unsafe.recoverabilityMax).toBe('IRRECOVERABLE');
    expect(toDb(unsafe.perActionMaxMonetary!)).toBe('250.00');
    // The attack succeeds: a COMPENSABLE class passes a ceiling the owner narrowed to
    // REVERSIBLE.
    expect(() => evaluateRecoverability('COMPENSABLE', unsafe)).not.toThrow();
  });

  it('PRODUCTION — the intersection yields REVERSIBLE, and step J denies', async () => {
    await withClient(seedNarrowAndBroad);
    const grants = await withClient((client) =>
      new GrantResolver({ clock: new FixedClock(FIXTURE_NOW) }).resolve(
        client,
        COMPANY_ID,
        { resolved: { id: WORKER_PRINCIPAL, kind: 'AI_ROLE', role: 'support_reasoner', modelBinding: 'model:fixture-binding@1/prompt@1', delegationDepth: 2 }, chain: [], effectiveActionClasses: null },
        'refund.create',
        { resourceRef: S1E_PASS_ORDER.resourceRef, resourceId: S1E_PASS_ORDER.orderId, grade: 'RECORD' },
      ),
    );
    const authority = evaluateGrantMatch(grants, ['W_DAY_REFUND', 'W_MONTH_REFUND']);
    expect(authority.recoverabilityMax).toBe('REVERSIBLE');
    expect(toDb(authority.perActionMaxMonetary!)).toBe('25.00');
    expect(() => evaluateRecoverability('COMPENSABLE', authority)).toThrow(AuthorityDenied);
  });

  it('AND END TO END, the same two grants deny at step J', async () => {
    await withClient(seedNarrowAndBroad);
    const outcome = await proposeUnderLease(kernel, S1E_PASS_ORDER);
    expect(outcome.outcome === 'DENIED' && outcome.step).toBe('J');
  });
});

// =====================================================================================
// ATTACK 4 — a prohibited class with every other operand favourable
// =====================================================================================

describe('ATTACK — a categorically prohibited class, with a grant seeded to permit it', () => {
  /**
   * `26 §6`'s first row, and the highest-value one: `payee.create`. EM17, IC3 2025, BEC at
   * 24,768 complaints and $3.05B.
   *
   * The fixture arranges EVERY other operand favourably: an active principal on its own task,
   * an OPERATING platform with the kill switch clear, and an owner-written ACTIVE grant whose
   * `action_class_selector` contains the prohibited class. `26 §6` says no arrangement of
   * those may reach it.
   */
  const PROHIBITED = 'payee.create';

  async function seedGrantForProhibitedClass(client: PoolClient): Promise<void> {
    await insertGrant(client, {
      grantId: 'grant:s1e:prohibited',
      actionClasses: [PROHIBITED],
      windows: ['W_DAY_REFUND', 'W_MONTH_REFUND'],
      recoverabilityMax: 'IRRECOVERABLE',
    });
  }

  it('VULNERABLE — with a matching grant, the prohibition is appealed away', async () => {
    await withClient(seedGrantForProhibitedClass);
    const grants = await withClient((client) =>
      new GrantResolver({ clock: new FixedClock(FIXTURE_NOW) }).resolve(
        client,
        COMPANY_ID,
        { resolved: { id: WORKER_PRINCIPAL, kind: 'AI_ROLE', role: 'support_reasoner', modelBinding: 'model:fixture-binding@1/prompt@1', delegationDepth: 2 }, chain: [], effectiveActionClasses: null },
        PROHIBITED,
        { resourceRef: S1E_PASS_ORDER.resourceRef, resourceId: S1E_PASS_ORDER.orderId, grade: 'RECORD' },
      ),
    );
    expect(grants).toHaveLength(1);
    // The attack succeeds: no throw.
    expect(() => unsafeEvaluateProhibition(PROHIBITED, grants)).not.toThrow();
  });

  it('PRODUCTION — the prohibition takes no grant argument and denies regardless', async () => {
    await withClient(seedGrantForProhibitedClass);
    expect(() => evaluateCategoricalProhibition(PROHIBITED)).toThrow(AuthorityDenied);
    try {
      evaluateCategoricalProhibition(PROHIBITED);
    } catch (error) {
      expect(error).toBeInstanceOf(AuthorityDenied);
      const denied = error as AuthorityDenied;
      expect(denied.step).toBe('E');
      expect(denied.code).toBe('PROHIBITED');
    }
    // The structural half: one parameter. There is no position for a grant, a principal, an
    // approval or an override.
    expect(evaluateCategoricalProhibition.length).toBe(1);
  });

  it('AND THE CLASS IS UNREACHABLE ANYWAY — it is not in the closed catalogue', async () => {
    // `26 §6`'s second enforcement leg. A proposal naming it denies at step C, long before E.
    const spec = s1eSpec();
    const key = entityKeyFor(S1E_PASS_ORDER.orderId);
    await expect(
      kernel.leases.withEntityLease(key, (lease) =>
        kernel.pipeline.evaluateUnderLease(
          lease,
          workerSession(),
          parseProposedIntent(
            rawIntent({ resourceRef: S1E_PASS_ORDER.resourceRef, enumerationId: 'x', optionId: 'y' }),
          ),
          spec,
          nonAuthorityContext(),
        ),
      ),
    ).resolves.toBeDefined();
    // And the class name itself cannot be parsed into an intent at all.
    expect(() =>
      parseProposedIntent(
        rawIntent({ actionClass: PROHIBITED, resourceRef: S1E_PASS_ORDER.resourceRef }),
      ),
    ).toThrow();
  });
});

// =====================================================================================
// ATTACK 5 — release the lease and reacquire it
// =====================================================================================

describe('ATTACK — the entity lease is released between C′ and the authority gates', () => {
  it('VULNERABLE — the lock is FREE in the gap, and the second lease is a different one', async () => {
    const key = entityKeyFor(S1E_PASS_ORDER.orderId);
    let freeInTheGap: boolean | null = null;

    const result = await runInTwoLeases(
      kernel.leases,
      key,
      async (lease) => {
        const outcome = await kernel.enumerator.enumerate(lease, {
          actionClass: 'refund.create',
          resourceRef: S1E_PASS_ORDER.resourceRef,
          spec: s1eSpec(),
        });
        return outcome.set.enumerationId;
      },
      async () => {
        // Observed from a SEPARATE PostgreSQL session, not from an application field.
        freeInTheGap = await kernel.leases.isEntityLockFree(key);
      },
      async (lease, first) => {
        expect(lease.isHeld()).toBe(true);
        return first;
      },
    );

    // The attack succeeds: there was a window in which nothing held the entity lock.
    expect(freeInTheGap).toBe(true);
    // And the two phases genuinely ran under DIFFERENT leases.
    expect(result.leaseIds).toHaveLength(2);
    expect(result.leaseIds[0]).not.toBe(result.leaseIds[1]);
  });

  it('PRODUCTION — the lock is HELD for the whole sequence, observed from another session', async () => {
    const key = entityKeyFor(S1E_PASS_ORDER.orderId);
    const spec = s1eSpec();
    const read = await kernel.leases.withEntityLease(key, async (lease) => {
      const outcome = await kernel.enumerator.enumerate(lease, {
        actionClass: 'refund.create',
        resourceRef: S1E_PASS_ORDER.resourceRef,
        spec,
      });
      return {
        enumerationId: outcome.set.enumerationId,
        optionId: outcome.set.options[0]!.optionId,
      };
    });
    const intent = parseProposedIntent(
      rawIntent({
        resourceRef: S1E_PASS_ORDER.resourceRef,
        enumerationId: read.enumerationId,
        optionId: read.optionId,
      }),
    );

    let freeAfterEveryGate: boolean | null = null;
    let leaseIdAtEnd: string | null = null;
    let leaseIdAtStart: string | null = null;

    const outcome = await kernel.leases.withEntityLease(key, async (lease) => {
      leaseIdAtStart = lease.leaseId;
      return kernel.pipeline.evaluateUnderLease(
        lease,
        workerSession(),
        intent,
        spec,
        nonAuthorityContext(),
        async () => {
          freeAfterEveryGate = await kernel.leases.isEntityLockFree(key);
          leaseIdAtEnd = lease.leaseId;
        },
      );
    });

    expect(outcome.outcome).toBe('PRE_RESERVATION_PASS');
    // The discriminating comparison with the case above: FALSE where the unsafe path is TRUE.
    expect(freeAfterEveryGate).toBe(false);
    // And ONE lease id spans the whole sequence, where the unsafe path has two.
    expect(leaseIdAtEnd).toBe(leaseIdAtStart);
  });
});
