import type { PoolClient } from 'pg';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { toDb } from '../../../src/kernel/exposure/money.js';
import { createHarness, COMPANY_ID, type Harness } from '../../support/fixture.js';
import { loadCommerceFixture } from '../../support/enumerationFixture.js';
import {
  S1E_PASS_ORDER,
  WORKER_PRINCIPAL,
  insertStateFact,
  loadAuthorityWorld,
  loadS1eOrders,
  makeAuthorityHarness,
  preconditionFactId,
  proposeUnderLease,
  type AuthorityHarness,
} from '../../support/authorityFixture.js';

/**
 * THE AUTHORITATIVE SUBSTRATE'S OWN INTEGRITY, ASSERTED AGAINST POSTGRESQL.
 *
 * `36 §2`, verbatim: "For any row, `grade` is a pure function of `writer_principal_type` and
 * `promoter_rule_id`. **Attempting to insert an asserted grade must be rejected by the
 * generated column, not by application code.**"
 *
 * Registry `I5`: "No `RECORD` or `OBSERVATION` grade fact has a MODEL-kind writer.
 * Enforcement: **DB (generated column)**. On violation: **Security incident. Structurally
 * impossible.**"
 *
 * Every assertion here runs SQL directly. None of it goes through the authority evaluators,
 * because the property under test is that the DATABASE refuses, not that some code checks.
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

describe('`I5` — grade is derived by the database and cannot be asserted', () => {
  it('supplying a grade at INSERT is REFUSED BY POSTGRESQL, not by application code', async () => {
    await withClient(async (client) => {
      await expect(
        client.query(
          `INSERT INTO state_fact
             (company_id, fact_id, subject, predicate, value, writer_kind, grade,
              observed_at, recorded_at, max_age_seconds, staleness_policy)
           VALUES ($1,'fact:asserted','order:X','settled','true','MODEL','RECORD',
                   now(), now(), 3600, 'BLOCK')`,
          [COMPANY_ID],
        ),
        // PostgreSQL's own words, quoted so a future PostgreSQL that stopped refusing would
        // fail this test rather than silently passing a looser match.
      ).rejects.toThrow('cannot insert a non-DEFAULT value into column "grade"');
    });
  });

  it('UPDATING a grade is refused too — the write path has no back door either', async () => {
    await withClient(async (client) => {
      await expect(
        client.query(`UPDATE state_fact SET grade = 'RECORD' WHERE company_id = $1`, [
          COMPANY_ID,
        ]),
      ).rejects.toThrow('column "grade" can only be updated to DEFAULT');
    });
  });

  it('the writer determines the grade, across every declared writer kind', async () => {
    // `24 §5`'s table, transcribed as (writer, discriminator) -> grade pairs, and asserted
    // against the DATABASE's own computation.
    const expected: readonly {
      readonly id: string;
      readonly writerKind: string;
      readonly promoterRule?: string;
      readonly derivationSpec?: string;
      readonly decisionAuthority?: string;
      readonly grade: string;
    }[] = [
      { id: 'g:parser', writerKind: 'PARSER', grade: 'RECORD' },
      { id: 'g:transport', writerKind: 'TRANSPORT', grade: 'CLAIM' },
      { id: 'g:owner', writerKind: 'OWNER', grade: 'RECORD' },
      { id: 'g:model', writerKind: 'MODEL', grade: 'INTERPRETATION' },
      { id: 'g:kernel', writerKind: 'KERNEL_SERVICE', grade: 'RECORD' },
      {
        id: 'g:metric',
        writerKind: 'KERNEL_SERVICE',
        derivationSpec: 'spec:v1',
        grade: 'OBSERVATION',
      },
      {
        id: 'g:decision-owner',
        writerKind: 'KERNEL_SERVICE',
        decisionAuthority: 'OWNER',
        grade: 'DECISION_OWNER',
      },
      {
        id: 'g:decision-delegated',
        writerKind: 'KERNEL_SERVICE',
        decisionAuthority: 'DELEGATED',
        grade: 'DECISION_DELEGATED',
      },
      // `24 §5`: "A record's grade may be raised only by a deterministic promoter". A
      // promoted fact is RECORD whichever kind ran the rule.
      { id: 'g:promoted', writerKind: 'TRANSPORT', promoterRule: 'shipment_confirmed_v1', grade: 'RECORD' },
    ];

    await withClient(async (client) => {
      for (const row of expected) {
        await insertStateFact(client, {
          factId: row.id,
          subject: 'order:GRADES',
          predicate: `p:${row.id}`,
          value: 'true',
          writerKind: row.writerKind,
          ...(row.promoterRule === undefined ? {} : { promoterRule: row.promoterRule }),
          ...(row.derivationSpec === undefined ? {} : { derivationSpec: row.derivationSpec }),
          ...(row.decisionAuthority === undefined
            ? {}
            : { decisionAuthority: row.decisionAuthority }),
        });
      }
      const rows = await client.query<{ fact_id: string; grade: string }>(
        `SELECT fact_id, grade FROM state_fact WHERE subject = 'order:GRADES' ORDER BY fact_id`,
      );
      const actual = Object.fromEntries(rows.rows.map((row) => [row.fact_id, row.grade]));
      for (const row of expected) {
        expect(actual[row.id], row.id).toBe(row.grade);
      }
    });
  });

  it('a MODEL writer cannot carry a decision authority or invoke a promoter', async () => {
    // MOA-10, closed at the schema rather than at a gate. Without these two CHECKs, a MODEL
    // writer could reach DECISION_DELEGATED or RECORD through the discriminator columns.
    await withClient(async (client) => {
      await expect(
        insertStateFact(client, {
          factId: 'g:model-decision',
          subject: 'order:X',
          predicate: 'p',
          value: 'true',
          writerKind: 'MODEL',
          decisionAuthority: 'DELEGATED',
        }),
      ).rejects.toThrow(/state_fact_model_writes_no_decision/);

      await expect(
        insertStateFact(client, {
          factId: 'g:model-promoter',
          subject: 'order:X',
          predicate: 'p',
          value: 'true',
          writerKind: 'MODEL',
          promoterRule: 'shipment_confirmed_v1',
        }),
      ).rejects.toThrow(/state_fact_model_invokes_no_promoter/);
    });
  });
});

describe('the authority tables refuse malformed authoritative state', () => {
  it('an undeclared principal kind is refused', async () => {
    await withClient(async (client) => {
      await expect(
        client.query(
          `INSERT INTO principal (company_id, principal_id, kind, role, model_binding, status)
           VALUES ($1,'p:bad','ROBOT','x',NULL,'ACTIVE')`,
          [COMPANY_ID],
        ),
      ).rejects.toThrow(/principal_kind_declared/);
    });
  });

  it('an AI_ROLE principal without a model binding is refused — `26 §13` needs the key', async () => {
    await withClient(async (client) => {
      await expect(
        client.query(
          `INSERT INTO principal (company_id, principal_id, kind, role, model_binding, status)
           VALUES ($1,'p:unbound','AI_ROLE','support_reasoner',NULL,'ACTIVE')`,
          [COMPANY_ID],
        ),
      ).rejects.toThrow(/principal_ai_role_has_model_binding/);
    });
  });

  it('a grant with an undeclared recoverability ceiling is refused', async () => {
    await withClient(async (client) => {
      await expect(
        client.query(
          `INSERT INTO authority_grant
             (company_id, grant_id, version, status, created_by, created_at, expires_at,
              resource_type, resource_predicate, recoverability_max, standing_required,
              approval_requirement, autonomy_key_binding, gate_class_on_permit)
           VALUES ($1,'g:bad',1,'ACTIVE','owner',now(),now() + interval '1 day',
                   'order','ANY','MOSTLY_REVERSIBLE',false,'NONE','k','GATED')`,
          [COMPANY_ID],
        ),
      ).rejects.toThrow(/authority_grant_recoverability_declared/);
    });
  });

  it('a self-delegating hop is refused — a cycle wearing a hop\'s clothes', async () => {
    await withClient(async (client) => {
      await expect(
        client.query(
          `INSERT INTO delegation_hop
             (company_id, principal_id, hop_index, delegating_principal_id,
              granted_action_classes, signature)
           VALUES ($1,$2,9,$2,ARRAY['refund.create'],'\\x00')`,
          [COMPANY_ID, WORKER_PRINCIPAL],
        ),
      ).rejects.toThrow(/delegation_hop_not_self/);
    });
  });

  it('a contradiction link between a fact and itself is refused', async () => {
    await withClient(async (client) => {
      await expect(
        client.query(
          `INSERT INTO contradiction_link
             (company_id, link_id, fact_a_id, fact_b_id, detected_by_rule, status, detected_at)
           VALUES ($1,'c:self',$2,$2,'r','OPEN',now())`,
          [COMPANY_ID, preconditionFactId(S1E_PASS_ORDER.orderId)],
        ),
      ).rejects.toThrow(/contradiction_link_distinct_facts/);
    });
  });

  it('an autonomy level outside `26 §13`\'s five is refused', async () => {
    await withClient(async (client) => {
      await expect(
        client.query(
          `INSERT INTO autonomy_ledger_entry
             (company_id, task_type, action_class, model_binding, resource_class, level,
              granted_at, observations, policy_violations, escalation_misses)
           VALUES ($1,'t','refund.create','m','order','L9_UNBOUNDED',now(),0,0,0)`,
          [COMPANY_ID],
        ),
      ).rejects.toThrow(/autonomy_ledger_level_declared/);
    });
  });
});

describe('the canonical effect cannot be mutated between C′ and the terminal result', () => {
  it('the returned request and every nested authority operand are FROZEN', async () => {
    const outcome = await proposeUnderLease(kernel, S1E_PASS_ORDER);
    expect(outcome.outcome).toBe('PRE_RESERVATION_PASS');
    if (outcome.outcome !== 'PRE_RESERVATION_PASS') return;

    const request = outcome.request;
    expect(Object.isFrozen(request)).toBe(true);
    expect(Object.isFrozen(request.exposure)).toBe(true);
    expect(Object.isFrozen(request.exposure.costComponents)).toBe(true);
    expect(Object.isFrozen(request.parameters)).toBe(true);
    expect(Object.isFrozen(request.selectedOption)).toBe(true);
    expect(Object.isFrozen(request.principal)).toBe(true);
    expect(Object.isFrozen(request.resource)).toBe(true);
    expect(Object.isFrozen(request.windowRefs)).toBe(true);
  });

  it('an ALIASED mutation attempt on the money operand does not change it', async () => {
    const outcome = await proposeUnderLease(kernel, S1E_PASS_ORDER);
    if (outcome.outcome !== 'PRE_RESERVATION_PASS') throw new Error('expected a pass');

    const before = toDb(outcome.request.exposure.totalExposure);
    expect(before).toBe('10.00');

    // The alias a later component would hold. `readonly` is a compile-time property and this
    // is the runtime half: the assignment is expressed through a widened alias, exactly as a
    // careless refactor or a compromised in-process component would express it.
    const alias = outcome.request.exposure as unknown as { totalExposure: bigint };
    expect(() => {
      alias.totalExposure = 1_000_000n;
    }).toThrow(TypeError);

    // And in a non-strict caller the assignment would silently no-op rather than throwing,
    // so the operand itself is asserted rather than the exception.
    expect(toDb(outcome.request.exposure.totalExposure)).toBe(before);
  });

  it('the window refs, the recoverability and the value direction cannot be replaced', async () => {
    const outcome = await proposeUnderLease(kernel, S1E_PASS_ORDER);
    if (outcome.outcome !== 'PRE_RESERVATION_PASS') throw new Error('expected a pass');

    const request = outcome.request as unknown as {
      recoverability: string;
      valueDirection: string;
      windowRefs: string[];
    };
    expect(() => {
      request.recoverability = 'REVERSIBLE';
    }).toThrow(TypeError);
    expect(() => {
      request.valueDirection = 'NONE';
    }).toThrow(TypeError);
    expect(() => {
      request.windowRefs.push('W_MONTH_ADSPEND');
    }).toThrow(TypeError);

    expect(outcome.request.recoverability).toBe('COMPENSABLE');
    expect(outcome.request.valueDirection).toBe('INBOUND_ORIGINAL_INSTRUMENT');
    expect(outcome.request.windowRefs).toEqual(['W_DAY_REFUND', 'W_MONTH_REFUND']);
  });

  it('the outcome object itself is frozen, so a caller cannot restamp its verdict', async () => {
    const outcome = await proposeUnderLease(kernel, S1E_PASS_ORDER);
    expect(Object.isFrozen(outcome)).toBe(true);
    const mutable = outcome as unknown as { outcome: string };
    expect(() => {
      mutable.outcome = 'AUTHORISED';
    }).toThrow(TypeError);
    expect(outcome.outcome).toBe('PRE_RESERVATION_PASS');
  });
});
