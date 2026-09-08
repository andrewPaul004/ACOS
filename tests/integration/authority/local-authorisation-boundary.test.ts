import { readdir, readFile } from 'node:fs/promises';
import { join, sep } from 'node:path';

import type { PoolClient } from 'pg';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AUTHORITY_STEPS } from '../../../src/kernel/authority/steps.js';
import {
  DISPATCH_IS_NOT_IMPLEMENTED,
  LOCAL_AUTHORISATION_STEPS,
  POST_COMMIT_STEPS,
  localStepPrecedes,
} from '../../../src/kernel/authorisation/localSteps.js';
import { LOCAL_SQLSTATE } from '../../../src/kernel/authorisation/localAuthorisationErrors.js';
import { createHarness, type Harness } from '../../support/fixture.js';

/**
 * THE S1F BOUNDARY — what the slice implements, what the DATABASE enforces, and where it
 * stops.
 *
 * Everything asserted about the schema is read out of the RUNNING DATABASE through
 * `information_schema` and the catalogues, never out of the migration file. A test that
 * parsed the `.sql` would pass whether or not the migration was ever applied — the same
 * discipline the accepted S1A schema-conformance suite states.
 */

let harness: Harness;
let client: PoolClient;

beforeAll(async () => {
  harness = await createHarness();
  await harness.reset();
  client = await harness.connect();
});

afterAll(async () => {
  client?.release();
  await harness?.close();
});

async function columnsOf(
  table: string,
): Promise<Map<string, { type: string; nullable: boolean }>> {
  const result = await client.query<{
    column_name: string;
    data_type: string;
    is_nullable: string;
  }>(
    `SELECT column_name, data_type, is_nullable
       FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1`,
    [table],
  );
  return new Map(
    result.rows.map((r) => [
      r.column_name,
      { type: r.data_type, nullable: r.is_nullable === 'YES' },
    ]),
  );
}

async function primaryKeyOf(table: string): Promise<string[]> {
  const result = await client.query<{ attname: string }>(
    `SELECT a.attname, k.ord
       FROM pg_constraint c
       JOIN LATERAL unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord) ON true
       JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
      WHERE c.conrelid = $1::regclass AND c.contype = 'p'
      ORDER BY k.ord`,
    [table],
  );
  return result.rows.map((r) => r.attname);
}

/**
 * The UNIQUE constraint column sets, each as a comma-joined name list.
 *
 * `string_agg` rather than `array_agg`: `pool.ts` deliberately leaves `pg`'s type parsers
 * alone so NUMERIC stays a string, and an aggregated `text[]` therefore arrives as
 * PostgreSQL's own array literal rather than as a JavaScript array. A joined string is
 * unambiguous and needs no parser.
 */
async function uniqueSets(table: string): Promise<string[]> {
  const result = await client.query<{ cols: string }>(
    `SELECT string_agg(a.attname, ',' ORDER BY k.ord) AS cols
       FROM pg_constraint c
       JOIN LATERAL unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord) ON true
       JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
      WHERE c.conrelid = $1::regclass AND c.contype = 'u'
      GROUP BY c.oid`,
    [table],
  );
  return result.rows.map((r) => r.cols);
}

async function foreignKeysOf(table: string): Promise<{ column: string; target: string }[]> {
  const result = await client.query<{ column_name: string; target: string }>(
    `SELECT a.attname AS column_name, confrelid::regclass::TEXT AS target
       FROM pg_constraint c
       JOIN LATERAL unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord) ON true
       JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
      WHERE c.conrelid = $1::regclass AND c.contype = 'f'`,
    [table],
  );
  return result.rows.map((r) => ({ column: r.column_name, target: r.target }));
}

async function checkClauses(table: string): Promise<Map<string, string>> {
  const result = await client.query<{ conname: string; clause: string }>(
    `SELECT conname, pg_get_constraintdef(oid) AS clause
       FROM pg_constraint
      WHERE conrelid = $1::regclass AND contype = 'c'`,
    [table],
  );
  return new Map(result.rows.map((r) => [r.conname, r.clause]));
}

// =====================================================================================
// The step tables
// =====================================================================================

describe('`26 §7`\'s sequence is declared in exactly two tables, and they compose', () => {
  /**
   * `26 §7`'s flowchart, transcribed HERE, edge by edge, from R onward:
   *
   *   R -> S -> T -> U -> V | W -> X
   */
  const LOCAL_FLOWCHART: readonly string[] = ['R', 'S', 'T', 'U', 'V', 'W'];

  it('the local step table is `26 §7`\'s, transcribed independently', () => {
    expect([...LOCAL_AUTHORISATION_STEPS]).toEqual(LOCAL_FLOWCHART);
  });

  it('R precedes S, S precedes T, and V precedes W', () => {
    // `26 §7` property 6: "Reservation precedes approval (step R before S), SR5."
    expect(localStepPrecedes('R', 'S')).toBe(true);
    // `26 §7` property 8: "Idempotency check happens after reservation and before permit
    // (steps T–V)."
    expect(localStepPrecedes('S', 'T')).toBe(true);
    expect(localStepPrecedes('T', 'U')).toBe(true);
    expect(localStepPrecedes('V', 'W')).toBe(true);
  });

  it('the two tables are DISJOINT, and their concatenation is the whole flowchart', () => {
    const pre = [...AUTHORITY_STEPS];
    const local = [...LOCAL_AUTHORISATION_STEPS];
    expect(pre.filter((step) => (local as string[]).includes(step))).toEqual([]);
    // `26 §7`'s flowchart, whole, transcribed here.
    expect([...pre, ...local]).toEqual([
      'B', 'C', 'C2', 'C′', 'D', 'E', 'F', 'G', 'H', 'H′', 'H″', 'I', 'J', 'K', 'L', 'M',
      'N', 'P', 'R', 'S', 'T', 'U', 'V', 'W',
    ]);
  });

  it('the ACCEPTED S1E table is UNCHANGED — it still declares no step at or after R', () => {
    // tests/authority/authority-channel-attacks.test.ts asserts this too, and it is
    // restated here because S1F is the slice that could have been tempted to append to it.
    for (const beyond of ['R', "R′", 'S', 'T', 'U', 'V', 'W', 'X']) {
      expect([...AUTHORITY_STEPS], `step ${beyond} leaked into the pre-R table`).not.toContain(
        beyond,
      );
    }
  });

  it('step X — the AUDIT WRITE — is in NEITHER table, because it is AFTER THE COMMIT', () => {
    // `30 §5.1`: "Cross-database atomicity is not attempted, because it does not exist."
    // The audit push is after the COMMIT.
    //
    // S1G IMPLEMENTS STEP X, and the two assertions below are unchanged — because S1G
    // implements it exactly where the architecture puts it. A step X appended to either
    // table would be a claim that the audit write shares a commit point with the money
    // path, which is the one thing `30 §5.1` says does not exist. It lives in its own
    // table instead, asserted next.
    expect([...LOCAL_AUTHORISATION_STEPS]).not.toContain('X');
    expect([...AUTHORITY_STEPS]).not.toContain('X');
  });

  it('S1G declares step X in a SEPARATE post-commit table, disjoint from both', () => {
    expect([...POST_COMMIT_STEPS]).toEqual(['X']);
    const pre = [...AUTHORITY_STEPS] as string[];
    const local = [...LOCAL_AUTHORISATION_STEPS] as string[];
    for (const step of POST_COMMIT_STEPS) {
      expect(pre).not.toContain(step);
      expect(local).not.toContain(step);
    }
    // And `26 §7`'s whole sequence is the concatenation of all three.
    expect([...pre, ...local, ...POST_COMMIT_STEPS]).toEqual([
      'B', 'C', 'C2', 'C′', 'D', 'E', 'F', 'G', 'H', 'H′', 'H″', 'I', 'J', 'K',
      'L', 'M', 'N', 'P', 'R', 'S', 'T', 'U', 'V', 'W', 'X',
    ]);
  });

  it('and DISPATCH is still not implemented — S1G stops after the audit write', () => {
    expect(DISPATCH_IS_NOT_IMPLEMENTED).toBe(true);
  });

  it("and R′ — verify mode — is in neither, because resume is not implemented", () => {
    expect([...LOCAL_AUTHORISATION_STEPS]).not.toContain('R′');
  });
});

// =====================================================================================
// The schema — I2, I31, I42, I60
// =====================================================================================

describe('the invariants S1F closes are enforced by the DATABASE', () => {
  it('I42 — the effect primary key INCLUDES the idempotency key', async () => {
    // `33 §6`, verbatim: "`effects` primary key includes the idempotency key with a unique
    // constraint (I42), so a duplicate proposal cannot create a second row even if every
    // layer above it fails."
    expect(await primaryKeyOf('effect')).toEqual(['company_id', 'idempotency_key']);
    // And the surrogate is unique too, so foreign keys can name it without weakening the
    // key that decides duplication.
    expect(await uniqueSets('effect')).toContain('effect_id');
  });

  it('I42 — the key is NOT NULL, so a null cannot be a wildcard duplicate', async () => {
    const columns = await columnsOf('effect');
    expect(columns.get('idempotency_key')?.nullable).toBe(false);
  });

  it('I2 — a decision CANNOT exist without a reservation, structurally', async () => {
    // Registry `I2`: "Every `AuthorizationDecision` with verdict PERMIT has a
    // `Reservation`". `26 §2.1.3` removed the last candidate exemption (the rate class
    // writes a real zero-amount row), so there is no exempt class at S1 and the invariant
    // is a NOT NULL foreign key rather than a scheduled check.
    const columns = await columnsOf('authorisation_decision');
    expect(columns.get('reservation_id')?.nullable).toBe(false);
    expect(await foreignKeysOf('authorisation_decision')).toContainEqual({
      column: 'reservation_id',
      target: 'exposure_reservation',
    });
  });

  it('I31 — the reservation is unique per authorisation', async () => {
    // Registry `I31`: "No `Reservation` row is created for an `AuthorizationDecision` that
    // already holds one. | DB (unique on `authorisation_id`)". The constraint is the
    // ACCEPTED S1A one; this asserts S1F did not weaken it.
    expect(await uniqueSets('exposure_reservation')).toContain('authorisation_id');
    // And the decision names one reservation and one effect, once each.
    const decisionUniques = await uniqueSets('authorisation_decision');
    expect(decisionUniques).toContain('authorisation_id');
    expect(decisionUniques).toContain('effect_id');
    expect(decisionUniques).toContain('reservation_id');
  });

  it('I31 is cited for the no-second-row property ONLY — I51 owns deny-on-excess', async () => {
    // Registry `I31`: "This invariant is cited only for the no-second-row property. The
    // deny-on-excess rule is `I51`." `I51`'s trigger is the ACCEPTED S1A
    // `reservation_no_increase`, and S1F adds no runtime resume path that would exercise it.
    const triggers = await client.query<{ tgname: string }>(
      `SELECT tgname FROM pg_trigger
        WHERE tgrelid = 'exposure_reservation'::regclass AND NOT tgisinternal`,
    );
    expect(triggers.rows.map((r) => r.tgname)).toContain('reservation_no_increase');
  });

  it('I60 — the unique partial index on `RESUMING` exists', async () => {
    // `26 §12.2`: "`RESUMING` carries a unique partial index on `(approval_id)` (I60), so a
    // second resume cannot start." Transcribed as declared. It is structurally redundant
    // against the primary key, and that is RECORDED rather than silently improved: the
    // architecture names this index and S1F installs the index it names.
    const indexes = await client.query<{ indexdef: string; indexname: string }>(
      `SELECT indexname, indexdef FROM pg_indexes
        WHERE schemaname = 'public' AND tablename = 'approval'`,
    );
    const partial = indexes.rows.find((r) => r.indexname === 'approval_single_resuming');
    expect(partial).toBeDefined();
    expect(partial!.indexdef).toContain('UNIQUE');
    expect(partial!.indexdef).toContain("state = 'RESUMING'");
  });

  it('the journal is keyed `(company_id, journal_seq)`, per `30 §5.2`', async () => {
    expect(await primaryKeyOf('effect_journal')).toEqual(['company_id', 'journal_seq']);
    const columns = await columnsOf('effect_journal');
    // `30 §5.2`: "null until the audit store acknowledges".
    expect(columns.get('mirrored_at')?.nullable).toBe(true);
    // The chain columns are nullable in the SCHEMA because the trigger fills them and
    // refuses a supplied value; a NOT NULL would make a caller-supplied value the only way
    // to insert.
    expect(columns.get('prev_hash')?.nullable).toBe(true);
    expect(columns.get('row_hash')?.nullable).toBe(true);
  });

  it('the money columns are `NUMERIC(18,2)` everywhere S1F added one', async () => {
    // `30 §5.3`: "Per-column declared decimal scale, serialised as a string at that exact
    // scale. `25.0` and `25.00` are different bytes, deliberately."
    for (const [table, columns] of [
      ['authorisation', ['vendor_amount', 'total_exposure', 'forward_integral']],
      ['effect_journal', ['vendor_amount', 'total_exposure', 'forward_integral']],
    ] as const) {
      const actual = await client.query<{ column_name: string; precision: number; scale: number }>(
        `SELECT column_name, numeric_precision AS precision, numeric_scale AS scale
           FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = $1 AND column_name = ANY($2::TEXT[])`,
        [table, [...columns]],
      );
      expect(actual.rows, `${table} money columns`).toHaveLength(columns.length);
      for (const row of actual.rows) {
        expect(row.precision, `${table}.${row.column_name}`).toBe(18);
        expect(row.scale, `${table}.${row.column_name}`).toBe(2);
      }
    }
  });

  it('the rate-class field table is a CHECK, not a convention', async () => {
    // `26 §2.1.3`'s table, made structural on the authorisation row as well as on the
    // reservation row — so the request that Cedar evaluated and the reservation that
    // committed cannot disagree about the class.
    const checks = await checkClauses('authorisation');
    const rate = [...checks.entries()].find(([name]) => name === 'authorisation_rate_class_fields');
    expect(rate).toBeDefined();
    expect(rate![1]).toContain('total_exposure = 0.00');
    expect(rate![1]).toContain('vendor_amount IS NULL');
    const noForward = [...checks.entries()].find(
      ([name]) => name === 'authorisation_non_rate_carries_no_forward_integral',
    );
    expect(noForward).toBeDefined();
  });

  it('the effect status set is the TWO local statuses, and no terminal one', async () => {
    // `24 §3` K4's terminal statuses — VERIFIED, FAILED, COMPENSATED, PRESUMED_EXECUTED,
    // UNRESOLVED_DISCREPANCY — are all reached after DISPATCH, and S1F dispatches nothing.
    // Admitting one would be a status the slice cannot produce.
    const checks = await checkClauses('effect');
    const status = [...checks.entries()].find(
      ([name]) => name === 'effect_status_is_a_local_authorisation_status',
    );
    expect(status).toBeDefined();
    expect(status![1]).toContain('AUTHORISED');
    expect(status![1]).toContain('AWAITING_APPROVAL');
    for (const terminal of [
      'VERIFIED',
      'FAILED',
      'COMPENSATED',
      'PRESUMED_EXECUTED',
      'UNRESOLVED_DISCREPANCY',
      'DISPATCHED',
    ]) {
      expect(status![1], `the effect status set admits ${terminal}`).not.toContain(terminal);
    }
  });

  it('the verdict and the approval requirement cannot disagree', async () => {
    // `26 §7` step S: `NONE` continues to T and permits at W; a tier returns
    // REQUIRE_APPROVAL with the reservation held. A PERMIT carrying a tier, or a
    // REQUIRE_APPROVAL with no approval object, are rows the database refuses.
    const checks = await checkClauses('authorisation_decision');
    expect([...checks.keys()]).toContain('decision_verdict_matches_approval_requirement');
    expect([...checks.keys()]).toContain('decision_approval_present_iff_requires_approval');
    // Ed25519 signatures are 64 bytes, and an empty one is refused.
    expect([...checks.keys()]).toContain('decision_signature_non_empty');
  });
});

// =====================================================================================
// Append-only
// =====================================================================================

describe('`33 §6`\'s append-only rule is enforced, and it applies to the privileged role', () => {
  /**
   * `33 §6`, verbatim: "Append-only tables (`state_facts`, `effects`, `authorisations`,
   * `decisions`, `evidence`, `experiment_registrations`) have no `UPDATE` or `DELETE` grant
   * for any application role. Correction is a new row with `supersedes`."
   *
   * The architecture's mechanism is a GRANT. S1 runs as one role — `33 §6` itself declares
   * the `effect_path` role spans all five schemas and is "the privileged path" — so there is
   * no second role to withhold the grant from, and a trigger is the substitute that actually
   * refuses the write. It refuses it for the privileged role too, which a grant to a single
   * role could not.
   */
  it('UPDATE and DELETE are refused on every append-only table S1F added', async () => {
    for (const table of ['authorisation', 'authorisation_window_instance', 'effect', 'authorisation_decision']) {
      const triggers = await client.query<{ tgname: string }>(
        `SELECT tgname FROM pg_trigger
          WHERE tgrelid = $1::regclass AND NOT tgisinternal`,
        [table],
      );
      expect(triggers.rows.map((r) => r.tgname), table).toContain(`${table}_append_only`);
    }
  });

  it('and the refusal is real, not merely declared', async () => {
    // Exercised against an EMPTY table: a statement matching no row still fires nothing, so
    // the test seeds one row through the same constraint set the production path uses.
    await client.query(
      `INSERT INTO company (company_id, name, timezone, created_at)
       VALUES ('co_s1f_appendonly', 'x', 'UTC', now())
       ON CONFLICT DO NOTHING`,
    );
    await client.query(
      `INSERT INTO principal (company_id, principal_id, kind, role, status)
       VALUES ('co_s1f_appendonly', 'p1', 'OWNER', 'owner', 'ACTIVE')
       ON CONFLICT DO NOTHING`,
    );
    await client.query(
      `INSERT INTO authorisation (
         authorisation_id, company_id, principal_id, session_id, task_id,
         action_class, resource_ref, resource_id,
         dispatch_payload_hash, intent_hash, context_digest,
         constructor_id, constructor_semantic_major, constructor_non_semantic_minor,
         policy_version, vendor_amount, total_exposure, forward_integral, is_rate_class,
         recoverability, value_direction, autonomy_level, gate_class, created_at)
       VALUES ('auth:appendonly','co_s1f_appendonly','p1','s','t','refund.create','order:x','x',
               'h','h','h','c',1,0,'p',1.00,2.00,NULL,false,'COMPENSABLE','NONE','L3','UNGATED_LOGGED',now())`,
    );

    for (const statement of [
      `UPDATE authorisation SET total_exposure = 999.00 WHERE authorisation_id = 'auth:appendonly'`,
      `DELETE FROM authorisation WHERE authorisation_id = 'auth:appendonly'`,
    ]) {
      let code: string | undefined;
      try {
        await client.query(statement);
      } catch (error) {
        code = (error as { code?: string }).code;
      }
      expect(code, statement).toBe(LOCAL_SQLSTATE.APPEND_ONLY_REFUSED);
    }

    await client.query(`DELETE FROM principal WHERE company_id = 'co_s1f_appendonly'`).catch(() => undefined);
  });
});

// =====================================================================================
// Where S1F stops
// =====================================================================================

describe('the excluded future steps are absent from `src/`', () => {
  async function sourceOf(): Promise<{ path: string; code: string }[]> {
    const files: { path: string; code: string }[] = [];
    async function walk(dir: string): Promise<void> {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(path);
          continue;
        }
        if (!entry.name.endsWith('.ts')) continue;
        files.push({
          path,
          code: (await readFile(path, 'utf8'))
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/(^|[^:])\/\/.*$/gm, '$1'),
        });
      }
    }
    await walk(join(process.cwd(), 'src'));
    return files;
  }

  it('there is no APPROVAL RESUME path — no R′, no verify mode, no RemedyObligation', async () => {
    // `26 §12.2`'s transitions out of `PENDING`, step `R′`, `CONSTRUCTOR_SEMANTIC_CHANGE`,
    // `RESERVATION_ABSENT`, `EXPOSURE_EXCEEDS_RESERVATION`, `RemedyObligation` and `I58` are
    // all DEFERRED. S1F creates the initial `PENDING` row and nothing else.
    const files = await sourceOf();
    const offenders: string[] = [];
    for (const { path, code } of files) {
      for (const pattern of [
        /'APPROVED'/,
        /'RESUMING'/,
        /'CONSUMED'/,
        /'SUPERSEDED'/,
        /verifyMode/i,
        /RemedyObligation/,
        /EXPOSURE_EXCEEDS_RESERVATION/,
        /RESERVATION_ABSENT/,
        /CONSTRUCTOR_SEMANTIC_CHANGE/,
      ]) {
        if (pattern.test(code)) offenders.push(`${path} (${String(pattern)})`);
      }
    }
    expect(offenders, `a resume path exists:\n  ${offenders.join('\n  ')}`).toEqual([]);
  });

  it('the AUTHORITY AND MONEY PATH contains no audit-plane code — S1G confined it', async () => {
    // ACCEPTED AS S1F WROTE IT, NARROWED BY EXACTLY ONE SLICE BOUNDARY, S1G-C2.
    //
    // S1F asserted "there is no AUDIT PLANE anywhere in `src/`", which was correct then:
    // S1F built none. S1G BUILDS ONE, in `src/audit/` and `src/replication/`, so the
    // literal form of that assertion cannot survive the slice that implements step X.
    //
    // What S1F's assertion was PROTECTING survives verbatim and is what is asserted here:
    // the authority path, the money path and the local authorisation transaction must
    // contain no audit-plane code, because `30 §5.1` puts the push AFTER the commit and a
    // reference from inside the transaction would be the cross-database coupling the
    // architecture refuses. The exemption is TWO DIRECTORIES, named, and everything else
    // in `src/` is held to the original rule.
    const AUDIT_PLANE = [`${sep}audit${sep}`, `${sep}replication${sep}`];
    const files = await sourceOf();
    const offenders: string[] = [];
    for (const { path, code } of files) {
      // `pool.ts` exports `auditUrl()`, the ACCEPTED S1A helper. It is a connection-string
      // reader, not an audit plane, and nothing in the authority path calls it.
      if (path.endsWith(join('db', 'pool.ts'))) continue;
      if (AUDIT_PLANE.some((dir) => path.includes(dir))) continue;
      for (const pattern of [
        /auditUrl\(/,
        /JournalAttestation/,
        /emitAttestation/,
        /auditIngress/,
        /JournalPusher/,
        /mirrored_at\s*=/,
      ]) {
        if (pattern.test(code)) offenders.push(`${path} (${String(pattern)})`);
      }
    }
    expect(
      offenders,
      `audit-plane code outside src/audit and src/replication:\n  ${offenders.join('\n  ')}`,
    ).toEqual([]);
  });

  it('and the LOCAL AUTHORISATION TRANSACTION still knows nothing about the audit plane', async () => {
    // The sharpest form of the property, and the one that makes the post-commit ordering
    // structural: the module that owns the S1F transaction cannot reach the audit store.
    const code = (
      await readFile(
        join(process.cwd(), 'src', 'kernel', 'authorisation', 'localAuthorisation.ts'),
        'utf8',
      )
    )
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');
    for (const pattern of [/auditUrl/, /audit\//, /replication\//, /mirrored_at/, /audit_journal/]) {
      expect(code, String(pattern)).not.toMatch(pattern);
    }
  });

  it('THE MIRROR STATE MACHINE, THE OVERRIDE AND THE ANCHOR ARE STILL ABSENT', async () => {
    // Unchanged from S1F, and still true: `30 §5.6`'s three states, `§5.7.1`'s
    // `MirrorInputStallSignal`, `§5.7.2`'s `DegradedModeOverride` and `I17b`'s external
    // anchor (`§5.8`) are all OUT OF S1G's scope. Held over the WHOLE of `src/`, audit
    // plane included.
    const files = await sourceOf();
    const offenders: string[] = [];
    for (const { path, code } of files) {
      for (const pattern of [
        /mirrorState/i,
        /MirrorInputStall/,
        /CORROBORATED_DEGRADED/,
        /UNCORROBORATED_STALL/,
        /DegradedModeOverride/,
        /anchor/i,
        /DISPATCHED_UNMIRRORED/,
      ]) {
        if (pattern.test(code)) offenders.push(`${path} (${String(pattern)})`);
      }
    }
    expect(offenders, `deferred mechanism in src/:\n  ${offenders.join('\n  ')}`).toEqual([]);
  });

  it('there is no SETTLEMENT, RECONCILIATION or EXTERNAL CLAIM path', async () => {
    const files = await sourceOf();
    const offenders: string[] = [];
    for (const { path, code } of files) {
      // `reconciler.ts` is the ACCEPTED S1A settlement-observation writer for
      // `standing_window_exposure`, which is a LOCAL ledger move and not an external
      // reconciliation; it is allowed and named here so its exemption is deliberate.
      if (path.endsWith(join('exposure', 'reconciler.ts'))) continue;
      for (const pattern of [/settled_total/, /CLAIMED/, /outboxClaim/i, /vendorQuery/i]) {
        if (pattern.test(code)) offenders.push(`${path} (${String(pattern)})`);
      }
    }
    expect(offenders, `settlement or claim code in src/:\n  ${offenders.join('\n  ')}`).toEqual(
      [],
    );
  });

  it('there is exactly ONE Cedar decision path, and S1F added none', async () => {
    // The ACCEPTED S1D property, restated: a second place able to produce `PER_ACTION`
    // without Cedar having run would make the money cap decidable outside the hash-committed
    // policy artifact.
    const files = await sourceOf();
    // What makes a module a DECISION path is calling Cedar's `isAuthorized`. Two modules
    // import the Cedar runtime — `cedarEngine.ts` for the decision and the ACCEPTED
    // `policyArtifacts.ts` for `checkParseSchema` / `checkParsePolicySet` at load, which is
    // validation and not evaluation — and exactly one of them decides anything.
    const engines = files.filter(({ code }) => /cedar\.isAuthorized\(/.test(code));
    expect(engines.map((f) => f.path.replace(`${process.cwd()}${sep}`, ''))).toEqual([
      join('src', 'kernel', 'policy', 'cedarEngine.ts'),
    ]);
    // And nothing outside the accepted S1D policy module can PRODUCE the `PER_ACTION`
    // terminal. `errors.ts` declares the union and `denialCategory.ts` maps the DETERMINING
    // CEDAR POLICY ID onto it — which is a projection of Cedar's own answer, not a second
    // place that can reach it. Anywhere else, and the money cap would be decidable outside
    // the hash-committed artifact.
    const perAction = files.filter(
      ({ path, code }) =>
        /'PER_ACTION'/.test(code) &&
        !path.endsWith(join('policy', 'errors.ts')) &&
        !path.endsWith(join('policy', 'denialCategory.ts')),
    );
    expect(perAction.map((f) => f.path.replace(`${process.cwd()}${sep}`, ''))).toEqual([]);
  });
});

// =====================================================================================
// The one production entry point into the money transaction
// =====================================================================================

/**
 * OWNER-RESOLUTION REVIEW, S1F-C3. The rate-class fixture supplies a KERNEL-BUILT exposure
 * block straight to `commitLocalAuthorisation`, which is a bounded TEST/INTERNAL step-R
 * seam. What makes it a seam rather than a production authority bypass is that the
 * primitive has exactly ONE production caller, and that caller reaches it only from an
 * S1E `PRE_RESERVATION_PASS` whose economics it did not receive from its own caller.
 *
 * Both halves are asserted from the SOURCE, because both are refactor-reachable: a second
 * `src/` module importing the transaction module, or a `commitLocalAuthorisation` call that
 * stopped being gated by the pass check, would each turn the seam into a bypass without
 * failing any behavioural test.
 */
describe('the local authorisation transaction has exactly ONE production entry point', () => {
  async function sourceOf(): Promise<{ path: string; code: string }[]> {
    const files: { path: string; code: string }[] = [];
    async function walk(dir: string): Promise<void> {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(path);
          continue;
        }
        if (!entry.name.endsWith('.ts')) continue;
        files.push({ path, code: await readFile(path, 'utf8') });
      }
    }
    await walk(join(process.cwd(), 'src'));
    return files;
  }

  it('exactly one module in `src/` imports the transaction, and it is the pipeline', async () => {
    const files = await sourceOf();
    const importers = files.filter(
      ({ path, code }) =>
        !path.includes(`${sep}authorisation${sep}`) &&
        /from '[^']*authorisation\/localAuthorisation\.js'/.test(code),
    );
    expect(importers.map((f) => f.path.replace(`${process.cwd()}${sep}`, ''))).toEqual([
      join('src', 'kernel', 'authority', 'preReservation.ts'),
    ]);
  });

  it('and its only call is gated by a PRE_RESERVATION_PASS and the sealed continuation', async () => {
    const code = await readFile(
      join(process.cwd(), 'src', 'kernel', 'authority', 'preReservation.ts'),
      'utf8',
    );
    // One call site, not two.
    expect(code.match(/\n\s*(?:return |await )?commitLocalAuthorisation\(/g)).toHaveLength(1);
    // And the guard between the pipeline's entry and that call: a non-PASS outcome returns
    // verbatim, and the facts come from the module-scoped WeakMap rather than a parameter.
    const guarded =
      /if \(outcome\.outcome !== 'PRE_RESERVATION_PASS'\) \{[\s\S]*?return outcome;[\s\S]*?\}[\s\S]*?SEALED_CONTINUATIONS\.get\(outcome\)[\s\S]*?commitLocalAuthorisation\(/;
    expect(guarded.test(code)).toBe(true);
    // The economics are the frozen S1E ones: the composing method takes no exposure, no
    // reservation amount, no window list and no lineage of its own. Read from the
    // COMMENT-STRIPPED source, so the prose explaining each omission cannot satisfy it.
    const bare = code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    const signature = bare.slice(
      bare.indexOf('async authoriseLocallyUnderLease('),
      bare.indexOf('): Promise<LocalAuthorisationOutcome> {'),
    );
    expect(signature.length).toBeGreaterThan(0);
    for (const forbidden of ['exposure', 'ExposureBlock', 'windowRefs', 'RateClassFacts', 'Money']) {
      expect(signature.includes(forbidden), `${forbidden} is a parameter`).toBe(false);
    }
    // `lineage` appears exactly once, as the thing the options type OMITS.
    expect(signature).toContain("Omit<LocalAuthorisationOptions, 'lineage'>");
    expect(signature.match(/lineage/g)).toHaveLength(1);
  });
});
