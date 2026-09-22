import type { Client } from '../../db/pool.js';
import { canonicalHash, hex } from '../canonicalisation/canonicalBytes.js';
import type { ActionClass } from '../canonicalisation/actionCatalogue.js';
import type { ConstructorVersionIdentity } from '../canonicalisation/constructorVersion.js';
import {
  deserialiseContextSpec,
  serialiseContextSpec,
  type TaskContextSpec,
} from './contextSpec.js';
import type { EnumeratedOption } from './enumeratedOptionSet.js';

/**
 * The enumeration record — the STALENESS AND LINEAGE SUBSTRATE.
 *
 * ---------------------------------------------------------------------------------
 * THIS IS NOT THE VC-C2 READ JOURNAL, AND S1C DOES NOT CLAIM IT IS.
 *
 * `36 §2` VC-C2 requires the enumeration to be "journaled with `journal_row_kind = READ`",
 * and `26 §2.0.1`'s journaling row spells out what that means: "**It is a journal row, not
 * an effect** — it takes a `journal_seq`, it chains, it mirrors, and it is not in the effect
 * ledger."
 *
 * None of that is here. No `journal_seq`, no chain hash, no audit mirror, no quota. The S1C
 * mandate is explicit — "Do not build a fake in-memory journal merely to print PASS" — and
 * a table wearing journal column names without the sequence, the chain and the mirror would
 * be the durable version of the same mistake. `S1C-result.md` reports VC-C2 journaling and
 * quota as **OPEN**.
 *
 * WHAT THIS TABLE IS FOR. `26 §2.0.1` requires `computed_at` "for the class's `max_age`
 * check at C′", and `26 §7`'s C′ row requires the check. So C′ must obtain the enumeration's
 * `computed_at` from somewhere. The only two candidates are kernel state and the proposer,
 * and `26 §1` Corollary 3 settles it: "the request must be built by the ceiling's enforcer,
 * not by its subject." A staleness check reading a timestamp its subject supplied is not a
 * staleness check. This table is the kernel's own record of what it enumerated and when.
 *
 * It also carries the BINDING fields, and that is the second reason it exists. Without them
 * the `enumeration_id` half of the content-addressed pair carries no information: a model
 * could pair an enumeration taken against order A with an `option_id` computed for order B
 * and the pair would be only as strong as the `option_id` alone. `26 §2.0.1` calls
 * `enumeration_id` the name of "one EnumeratedOptionSet the kernel computed" — one, and a
 * specific one.
 * ---------------------------------------------------------------------------------
 */

export interface EnumerationRecord {
  readonly companyId: string;
  readonly enumerationId: string;
  readonly taskId: string;
  readonly principalId: string;
  readonly actionClass: ActionClass;
  readonly resourceRef: string;
  readonly resourceId: string;
  /** `26 §2.1`: the `enumeration_ref`'s `computed_at`, for lineage and for max_age. */
  readonly computedAt: Date;
  readonly constructorId: string;
  readonly constructorSemanticMajor: number;
  readonly constructorNonSemanticMinor: number;
  readonly constructorRecordHash: string;
  /**
   * The ordered options this enumeration RETURNED TO THE MODEL — id AND projected
   * description.
   *
   * The description is stored, not just the id, and that is what makes `26 §2.1`'s
   * "**with its full description**" a comparison against the model's own read rather than
   * against a value C′ recomputes from inputs it shares with itself. See `liveSelector.ts`
   * step 9.
   */
  readonly options: readonly EnumeratedOption[];
  /**
   * The KERNEL-OWNED task scope this enumeration was computed under — v1.3.5 (SER-01).
   *
   * `25 §14.1`'s dispatch-time revalidation re-enumerates the CURRENT permissible effects
   * one epoch later and asks whether the original `option_id` is still among them. That
   * re-enumeration must run under THE SAME SCOPE, because `24 §3` K4 bounds an enumeration
   * by the task's `context_spec` and `26 §2.2` puts the task's `reasonCodeScope` inside
   * `refund.create`'s `semantic_option_digest` — a different scope computes different
   * `option_id`s and the comparison would be meaningless.
   *
   * PERSISTED HERE SO NO DISPATCH-TIME CALLER SUPPLIES ONE. See `contextSpec.ts`'s
   * serialisation header for the two attacks that closes.
   *
   * NULLABLE, because rows written before `0013` have none. `dispatchRevalidation.ts`
   * treats an absent scope as STALE and refuses the dispatch rather than substituting a
   * default — `51 §2.3`'s "no implicit default may widen authority", applied to a scope.
   */
  readonly contextSpec: TaskContextSpec | null;
}

/**
 * The `enumeration_id` preimage — S1C fixture decision S1C-C6.
 *
 * `26 §2.0.1` says only "opaque, journaled". Opacity is a property of what the MODEL can do
 * with the value, not of how the kernel derives it, so deriving it deterministically from
 * the enumeration's own content is admissible and is strictly better than a random id:
 *
 *   - two enumerations that differ in ANY bound field get different ids, so an id cannot be
 *     transplanted between tasks, principals, classes or resources;
 *   - the id commits to the ORDERED OPTIONS — ids AND projected descriptions — so a
 *     recorded enumeration whose option set or whose rendered descriptions were altered no
 *     longer hashes to its own id. That is the re-derivability `I53`'s enforcement column
 *     asks for ("re-derivable from the journaled enumeration"), held here until the real
 *     journal row exists to hold it, and it is what binds the id to WHAT THE MODEL SAW
 *     rather than merely to which effects were available;
 *   - it commits to `computed_at`, so two enumerations of an unchanged option set at
 *     different instants are different enumerations — which they are, for `max_age`.
 *
 * It is NOT a capability token and is not treated as one: presenting a well-formed id proves
 * nothing, because C′ looks the row up and checks every bound field against the intent.
 *
 * The digest is domain-separated through `canonicalHash`, so an `enumeration_id` and an
 * `option_id` over coincidentally identical bytes are different values.
 */
export function computeEnumerationId(input: {
  readonly companyId: string;
  readonly taskId: string;
  readonly principalId: string;
  readonly actionClass: ActionClass;
  readonly resourceRef: string;
  readonly computedAt: Date;
  readonly constructorVersion: ConstructorVersionIdentity;
  readonly options: readonly EnumeratedOption[];
}): string {
  return hex(
    canonicalHash('acos.enumeration_id.v1', [
      { kind: 'text', value: input.companyId },
      { kind: 'text', value: input.taskId },
      { kind: 'text', value: input.principalId },
      { kind: 'text', value: input.actionClass },
      // The MODEL-FACING reference, and deliberately NOT the resolved `resource_id`.
      //
      // S1C found this by test. An id committing to `resource_id` cannot be computed when
      // the resource did not resolve, so the refusal path had to substitute something —
      // and any substitution makes an unenumerable resource's id structurally different
      // from a legitimately-empty one's. That is the existence oracle `36 §2` VC-C2 exists
      // to close, rebuilt inside the identifier: a prober comparing the ids from two
      // unknown references could tell "in scope and exists but has nothing refundable"
      // from "out of scope, absent, or not RECORD grade".
      //
      // `resource_ref` is a value the MODEL supplied, so it is known on every path and
      // tells the model nothing it did not already have. Nothing is lost: `resource_ref` is
      // UNIQUE per order (`0005__commerce_state.sql`), the resolved `resource_id` is still
      // recorded on the `enumeration_record` row, and C′ still checks it there.
      { kind: 'text', value: input.resourceRef },
      { kind: 'timestamp', value: input.computedAt },
      { kind: 'text', value: input.constructorVersion.constructorId },
      { kind: 'integer', value: BigInt(input.constructorVersion.semanticMajor) },
      { kind: 'integer', value: BigInt(input.constructorVersion.nonSemanticMinor) },
      { kind: 'text', value: input.constructorVersion.recordHash },
      // A JSON array, so RFC 8785 applies and the ORDER is significant — correct, because a
      // reordered option list is a different list even when its members are the same.
      //
      // Each member carries the option id AND the description the model was shown, so the
      // enumeration_id commits to the projection as well as to the option set.
      {
        kind: 'json',
        value: input.options.map((option) => ({
          option_id: option.optionId,
          description: option.description,
        })),
      },
    ]),
  );
}

interface RecordRow {
  enumeration_id: string;
  task_id: string;
  principal_id: string;
  action_class: string;
  resource_ref: string;
  resource_id: string;
  computed_at: Date;
  constructor_id: string;
  constructor_semantic_major: number;
  constructor_non_semantic_minor: number;
  constructor_record_hash: string;
  options: unknown;
  context_spec: unknown;
}

export async function insertEnumerationRecord(
  client: Client,
  record: EnumerationRecord,
): Promise<void> {
  await client.query(
    `INSERT INTO enumeration_record (
       company_id, enumeration_id, task_id, principal_id, action_class,
       resource_ref, resource_id, computed_at,
       constructor_id, constructor_semantic_major, constructor_non_semantic_minor,
       constructor_record_hash, options, context_spec)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14::jsonb)
     ON CONFLICT (company_id, enumeration_id) DO NOTHING`,
    [
      record.companyId,
      record.enumerationId,
      record.taskId,
      record.principalId,
      record.actionClass,
      record.resourceRef,
      record.resourceId,
      record.computedAt,
      record.constructorId,
      record.constructorSemanticMajor,
      record.constructorNonSemanticMinor,
      record.constructorRecordHash,
      JSON.stringify(
        record.options.map((option) => ({
          option_id: option.optionId,
          description: option.description,
        })),
      ),
      // `25 §14.1`. NOT part of the `enumeration_id` preimage, deliberately: the id already
      // commits to the ORDERED OPTIONS the scope produced, so committing to the scope as
      // well would change every accepted id for no additional binding. What the column adds
      // is the ability to REPRODUCE that set later, which the id alone cannot give.
      record.contextSpec === null ? null : JSON.stringify(serialiseContextSpec(record.contextSpec)),
    ],
  );
  // `ON CONFLICT DO NOTHING` is safe precisely BECAUSE the id is content-addressed: a
  // collision on the primary key means every bound field, the instant and the ordered
  // option list — ids and descriptions — were identical, so the existing row already IS
  // this row. Under a random id this clause would silently drop a distinct enumeration.
}

export async function findEnumerationRecord(
  client: Client,
  companyId: string,
  enumerationId: string,
): Promise<EnumerationRecord | null> {
  const result = await client.query<RecordRow>(
    `SELECT enumeration_id, task_id, principal_id, action_class,
            resource_ref, resource_id, computed_at,
            constructor_id, constructor_semantic_major, constructor_non_semantic_minor,
            constructor_record_hash, options, context_spec
       FROM enumeration_record
      WHERE company_id = $1 AND enumeration_id = $2`,
    [companyId, enumerationId],
  );
  const row = result.rows[0];
  if (!row) return null;

  const options: EnumeratedOption[] = [];
  if (Array.isArray(row.options)) {
    for (const raw of row.options) {
      if (typeof raw !== 'object' || raw === null) continue;
      const member = raw as { option_id?: unknown; description?: unknown };
      if (typeof member.option_id !== 'string' || typeof member.description !== 'string') continue;
      options.push({ optionId: member.option_id, description: member.description });
    }
  }

  return {
    companyId,
    enumerationId: row.enumeration_id,
    taskId: row.task_id,
    principalId: row.principal_id,
    // The column is written from a closed-catalogue value and read back into the closed
    // type. A row whose class is not in the catalogue is a corrupted row, not a wider type.
    actionClass: row.action_class as ActionClass,
    resourceRef: row.resource_ref,
    resourceId: row.resource_id,
    computedAt: row.computed_at,
    constructorId: row.constructor_id,
    constructorSemanticMajor: row.constructor_semantic_major,
    constructorNonSemanticMinor: row.constructor_non_semantic_minor,
    constructorRecordHash: row.constructor_record_hash,
    options,
    contextSpec: deserialiseContextSpec(companyId, row.context_spec),
  };
}
