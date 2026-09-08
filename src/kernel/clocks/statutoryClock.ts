import { inTransaction, type Client, type Pool } from '../../db/pool.js';

/**
 * `I56` and `30 §9.1` — THE STATUTORY-CLOCK PROVENANCE LEG. S1H.
 *
 * =================================================================================
 * WHY THIS IS IN A MIRROR SLICE AT ALL
 *
 * `30 §9.1`: "`§5.1`'s precedence row 3 privileges clock-bearing COMPENSABLE effects over
 * the mirror, so **the statutory clock is a lever on the audit plane** and its provenance is
 * a security property rather than a compliance detail."
 *
 * `24 §3` K10: "Without this, a model that can cause a clock to exist can manufacture the
 * row-3 exemption it wants. With it, and with `§5.6`'s inversion, **both ends of the lever
 * are closed**: the clock cannot be fabricated, and the state in which the clock buys a
 * relaxation cannot be self-declared."
 *
 * So `clockBearing` is precedence row 3's operand and this module is where it comes from.
 * =================================================================================
 *
 * =================================================================================
 * `I56`, VERBATIM, AND WHAT IT REFUSES
 *
 *   "Every statutory clock has a not-null `source_record_ref` resolving to a RECORD-grade
 *    artifact of a declared kind — a processor dispute webhook, a retained raw inbound
 *    message with its content hash, a carrier or regulator record, or a signed owner action.
 *    **A model classification can route a case; it can never create a clock.**"
 *
 * `30 §9.1`: "**No OBSERVATION, no CLAIM, no `DECISION_DELEGATED` fact may start a clock**,
 * and no model-authored summary may."
 *
 * THE STRUCTURAL FORM OF THAT REFUSAL. `createStatutoryClock` takes a `sourceRecordId` and
 * NOTHING ELSE that could stand in for one. There is no `reason` string, no
 * `classification`, no `confidence`, no `rationale` and no `statuteGuess` parameter. The id
 * must resolve to a row of `retained_source_record`, whose only admissible `provenance` is
 * `RECORD` and whose `kind` is `I56`'s own closed enumeration — so an OBSERVATION, a CLAIM
 * or a model summary has no representation to cite, rather than failing a check.
 *
 * `i56-clock-provenance.test.ts` runs `§25`'s negative control: a triage worker that
 * classifies EVERY case as a clock-bearing refund creates ZERO live clocks, because
 * classification is not an argument this module accepts.
 * =================================================================================
 *
 * ---------------------------------------------------------------------------------
 * WHAT IS DELIBERATELY NOT BUILT — TA-08, AND THE CITATION FOR THE DEFERRAL.
 *
 * `phase2-v1.3-lower-severity-register.md` TA-08 raises that "`I56` bounds clock
 * *provenance*, not clock *volume*" and schedules three additional controls — at most one
 * live clock per `(case_ref, statute)`, a collapse rule for duplicate `source_record_ref`
 * content hashes, and a per-window anomaly bound on newly created clock-bearing cases — as
 * **LATER MVP SLICE (S5)**, with the reason stated in the same row: "`I56`'s schema leg is
 * S1 and is unaffected; the bound is about live clocks, which land at S5."
 *
 * They are therefore NOT normative at S1 and are not invented here. `S1H-result.md §9`
 * reports them deferred with that citation, and the residual is real: at S1 the clock
 * population is provenance-bounded and not volume-bounded.
 * ---------------------------------------------------------------------------------
 */

/** `24 §3` K10's enumeration: "GDPR 72h / 1 month, CCPA 45d, FTC 30d and 7 working days". */
export const STATUTES = [
  'GDPR_ART_33_72H',
  'GDPR_ART_12_3_ONE_MONTH',
  'CCPA_45D',
  'FTC_30D',
  'FTC_7_WORKING_DAYS',
] as const;

export type Statute = (typeof STATUTES)[number];

/** `I56`'s declared kinds, verbatim, closed. */
export const SOURCE_RECORD_KINDS = [
  'PROCESSOR_DISPUTE_WEBHOOK',
  'RETAINED_RAW_INBOUND_MESSAGE',
  'CARRIER_OR_REGULATOR_RECORD',
  'SIGNED_OWNER_ACTION',
] as const;

export type SourceRecordKind = (typeof SOURCE_RECORD_KINDS)[number];

export interface RetainedSourceRecord {
  readonly companyId: string;
  readonly sourceRecordId: string;
  readonly kind: SourceRecordKind;
  /** `I26`: the digest of the retained bytes. 32 bytes, enforced by CHECK. */
  readonly contentHash: Buffer;
  /** What it came from, OUTSIDE ACOS. Never a principal of this system. */
  readonly externalRef: string;
  readonly receivedAt: Date;
}

/**
 * Retain a RECORD-grade artifact.
 *
 * `provenance` is not a parameter: the table admits `RECORD` and nothing else, so this
 * function cannot be called in a way that stores a lesser grade. That is the difference
 * between a check and a structural property, and `I56`'s enforcement column asks for the
 * latter — "DB (not-null + FK to the retained artifact)".
 *
 * S1H does NOT build the ingress that produces these. `37` S2 builds K15 with webhook dedup
 * and HMAC verification, and `37` S3 builds the processor adapter that would emit a dispute
 * webhook. At S1H the retained records are SEEDED FIXTURES, which `§25` of the mandate
 * directs — "Seed retained authoritative RECORD fixtures" — and `S1H-result.md §9` says so.
 */
export async function retainSourceRecord(
  control: Pool,
  record: RetainedSourceRecord,
): Promise<void> {
  const client = await control.connect();
  try {
    await client.query(
      `INSERT INTO retained_source_record
         (company_id, source_record_id, kind, provenance, content_hash, external_ref,
          received_at)
       VALUES ($1, $2, $3, 'RECORD', $4, $5, $6)`,
      [
        record.companyId,
        record.sourceRecordId,
        record.kind,
        record.contentHash,
        record.externalRef,
        record.receivedAt,
      ],
    );
  } finally {
    client.release();
  }
}

export interface ClockCreation {
  readonly companyId: string;
  readonly clockId: string;
  readonly statute: Statute;
  readonly caseRef: string;
  readonly startedAt: Date;
  readonly deadlineAt: Date;
  /**
   * `30 §9.1`: "MANDATORY, RECORD grade". The ONLY provenance argument, and it is an id that
   * must resolve — not a grade the caller asserts, not a classification, not a summary.
   */
  readonly sourceRecordId: string;
}

export const CLOCK_REFUSALS = [
  'I56_SOURCE_RECORD_DOES_NOT_RESOLVE',
  'I56_SOURCE_RECORD_NOT_RECORD_GRADE',
] as const;

export type ClockRefusal = (typeof CLOCK_REFUSALS)[number];

export class ClockRefused extends Error {
  constructor(
    readonly refusal: ClockRefusal,
    detail: string,
  ) {
    super(`${refusal}: ${detail}`);
    this.name = 'ClockRefused';
  }
}

/**
 * Create a statutory clock, citing a retained RECORD-grade artifact.
 *
 * TWO MECHANISMS, DELIBERATELY. The application check below produces a legible refusal; the
 * NOT NULL foreign key in `0009__mirror_state.sql` produces a constraint violation. `36 §0`
 * is why both exist — a property enforced in one place is a property one edit away from
 * being unenforced — and `i56-clock-provenance.test.ts` exercises each independently, the
 * second by attempting a direct INSERT with a dangling `source_record_ref`.
 *
 * A clock with an unresolvable `source_record_ref` is, in registry `I56`'s words, "a
 * **critical incident**". It cannot arise here: the FK makes it unrepresentable. The
 * detector for a record deleted AFTER a clock cited it is likewise structural, because
 * `retained_source_record` is append-only.
 */
export async function createStatutoryClock(
  control: Pool,
  creation: ClockCreation,
): Promise<void> {
  const client = await control.connect();
  try {
    await inTransaction(client, 'READ COMMITTED', async (tx) => {
      const cited = await tx.query<{ provenance: string; kind: string }>(
        `SELECT provenance, kind FROM retained_source_record
          WHERE company_id = $1 AND source_record_id = $2`,
        [creation.companyId, creation.sourceRecordId],
      );
      const record = cited.rows[0];
      if (record === undefined) {
        throw new ClockRefused(
          'I56_SOURCE_RECORD_DOES_NOT_RESOLVE',
          `${creation.sourceRecordId} is not a retained artifact of ${creation.companyId}; ` +
            'a clock may be created only by citing one (I56, 30 §9.1)',
        );
      }
      if (record.provenance !== 'RECORD') {
        throw new ClockRefused(
          'I56_SOURCE_RECORD_NOT_RECORD_GRADE',
          `${creation.sourceRecordId} is ${record.provenance}-grade; no OBSERVATION, CLAIM ` +
            'or DECISION_DELEGATED fact may start a clock (30 §9.1)',
        );
      }

      await tx.query(
        `INSERT INTO statutory_clock
           (company_id, clock_id, statute, case_ref, started_at, deadline_at,
            source_record_ref)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          creation.companyId,
          creation.clockId,
          creation.statute,
          creation.caseRef,
          creation.startedAt,
          creation.deadlineAt,
          creation.sourceRecordId,
        ],
      );
    });
  } finally {
    client.release();
  }
}

/**
 * `30 §5.1` row 3's operand: "a **live** statutory clock citing a RECORD-grade fact, `§9.1`".
 *
 * LIVE means `closed_at IS NULL` and `now < deadline_at`. A clock past its own deadline is
 * not a live clock — a deadline that has passed is a breach, not a reason to relax the
 * mirror, and treating it as live would let an expired obligation buy an indefinite
 * relaxation.
 *
 * The join back to `retained_source_record` is redundant against the NOT NULL FK and is
 * written out anyway, so that `clockBearing` is never true for a clock whose citation does
 * not currently resolve. `I56`: "A clock with an unresolvable `source_record_ref` is a
 * critical incident" — this reads it as NOT CLOCK-BEARING, which is the fail-closed
 * direction for row 3.
 */
export async function isClockBearingOn(
  client: Client,
  companyId: string,
  caseRef: string,
  now: Date,
): Promise<boolean> {
  const result = await client.query<{ live: string }>(
    `SELECT count(*)::TEXT AS live
       FROM statutory_clock c
       JOIN retained_source_record r
         ON r.company_id = c.company_id AND r.source_record_id = c.source_record_ref
      WHERE c.company_id = $1 AND c.case_ref = $2
        AND c.closed_at IS NULL AND c.deadline_at > $3
        AND r.provenance = 'RECORD'`,
    [companyId, caseRef, now],
  );
  return BigInt(result.rows[0]!.live) > 0n;
}

export async function isClockBearing(
  control: Pool,
  companyId: string,
  caseRef: string,
  now: Date,
): Promise<boolean> {
  const client = await control.connect();
  try {
    return await isClockBearingOn(client, companyId, caseRef, now);
  } finally {
    client.release();
  }
}
