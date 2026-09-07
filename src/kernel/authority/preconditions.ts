import type { Client } from '../../db/pool.js';
import type { Recoverability } from '../canonicalisation/actionCatalogue.js';
import type { Clock } from '../enumeration/clock.js';
import { denyAuthority } from './errors.js';

/**
 * Steps G, H, H′ and H″ — preconditions, grade, staleness, contradiction and delegation.
 *
 * `26 §7`'s flowchart, verbatim:
 *
 *   G[Fetch preconditions from state store<br/>engine fetches; proposer does not supply]
 *   G --> H{All preconditions RECORD/OBSERVATION<br/>and within max_age?}
 *   H -->|no| D6[DENY: PRECONDITION or STALE]
 *   H -->|yes| H2{Any precondition in an<br/>open ContradictionLink? — step H′}
 *   H2 -->|yes| DH1[DENY: PRECONDITION_CONTRADICTED]
 *   H2 -->|no| H3{Monetary or irrecoverable class<br/>with a DECISION_DELEGATED<br/>precondition? — step H″}
 *   H3 -->|yes| DH2[DENY: PRECONDITION_DELEGATED]
 *
 * ---------------------------------------------------------------------------------
 * WHAT MAKES STEP G MEAN ANYTHING
 *
 * `26 §7` property 3, verbatim: "**The engine fetches its own preconditions** (step G). This
 * remains true and remains valuable; it is simply no longer the whole story."
 *
 * The property is only worth anything if the SELECTION of preconditions is also kernel-owned.
 * An engine that fetched its own values for a list the proposer chose would be an engine a
 * proposer could steer to the facts it liked. So the list comes from
 * `action_class_precondition`, keyed on the action class, and the SUBJECT is templated from
 * the RESOLVED RESOURCE — the one C′ produced under the entity lease — never from
 * `resource_ref` as the model wrote it.
 *
 * There is no parameter on any function here through which a fact, a value, a grade, an age
 * or a contradiction status could be supplied.
 *
 * ---------------------------------------------------------------------------------
 * WHY H, H′ AND H″ ARE THREE PASSES OVER ONE FETCHED SET AND NOT ONE PASS
 *
 * `26 §19`-style determinism: the three steps have three different terminals, and a single
 * loop that checked all three conditions per fact would make the determining terminal depend
 * on WHICH FACT came first rather than on WHICH STEP fires first. `26 §7` is ordered, so a
 * contradicted fact and a delegated-grade fact in the same set must deny
 * `PRECONDITION_CONTRADICTED`, because H′ precedes H″.
 *
 * The set is fetched once at G and then examined three times, in `26 §7`'s order.
 * ---------------------------------------------------------------------------------
 */

/**
 * `24 §5`'s "May it be a policy precondition?" column, as a set.
 *
 * RECORD — "**Yes** — the only grade that may."
 * OBSERVATION — "Yes, where the spec is registered."
 * DECISION_OWNER — "**Yes**."
 *
 * Every other grade is No. `I6`: "No policy precondition is evaluated against a `CLAIM`-grade
 * fact." `DECISION_DELEGATED` is admitted HERE and rejected at step H″ for the classes `I28`
 * names — which is exactly `24 §5`'s wording, "Only for the narrow action class the
 * delegating grant names, and never for a monetary or irrecoverable class".
 */
const GATING_GRADES: ReadonlySet<string> = new Set([
  'RECORD',
  'OBSERVATION',
  'DECISION_OWNER',
  'DECISION_DELEGATED',
]);

export interface FetchedPrecondition {
  readonly preconditionKey: string;
  readonly factId: string;
  readonly subject: string;
  readonly predicate: string;
  readonly value: string;
  readonly requiredValue: string;
  readonly grade: string;
  readonly derivationSpec: string | null;
  readonly sourceAdapter: string | null;
  readonly corroboratingSource: string | null;
  readonly observedAt: Date;
  readonly recordedAt: Date;
  readonly maxAgeSeconds: number;
  readonly stalenessPolicy: string;
}

interface PreconditionSpecRow {
  readonly precondition_key: string;
  readonly subject_template: string;
  readonly predicate: string;
  readonly required_value: string;
}

interface FactRow {
  readonly fact_id: string;
  readonly subject: string;
  readonly predicate: string;
  readonly value: string;
  readonly grade: string;
  readonly derivation_spec: string | null;
  readonly source_adapter: string | null;
  readonly corroborating_source: string | null;
  readonly observed_at: Date;
  readonly recorded_at: Date;
  readonly max_age_seconds: string;
  readonly staleness_policy: string;
}

export interface PreconditionEvaluatorOptions {
  readonly clock: Clock;
}

export class PreconditionEvaluator {
  readonly #clock: Clock;

  constructor(options: PreconditionEvaluatorOptions) {
    this.#clock = options.clock;
  }

  /**
   * Step G — fetch, and ONLY fetch.
   *
   * `resourceRef` is the ref the KERNEL resolved at C′ and carries on the request's
   * `resource` field, not the string the proposer wrote. They are equal on the happy path
   * and the distinction is the point: a resource that resolved to a different entity would
   * change which facts are fetched, and this function reads the resolved one.
   */
  async fetch(
    client: Client,
    companyId: string,
    actionClass: string,
    resourceRef: string,
  ): Promise<readonly FetchedPrecondition[]> {
    const specs = await client.query<PreconditionSpecRow>(
      `SELECT precondition_key, subject_template, predicate, required_value
         FROM action_class_precondition
        WHERE company_id = $1 AND action_class = $2
        ORDER BY precondition_key ASC`,
      [companyId, actionClass],
    );

    const fetched: FetchedPrecondition[] = [];
    for (const spec of specs.rows) {
      const subject = spec.subject_template.replaceAll('{resource_ref}', resourceRef);
      // The MOST RECENTLY RECORDED fact for the (subject, predicate) pair. `24 §8`:
      // "Nothing overwrites anything. The rules govern supersession" — so the current
      // reading is the latest recorded row, and the superseded ones remain.
      const facts = await client.query<FactRow>(
        `SELECT fact_id, subject, predicate, value, grade, derivation_spec,
                source_adapter, corroborating_source, observed_at, recorded_at,
                max_age_seconds, staleness_policy
           FROM state_fact
          WHERE company_id = $1 AND subject = $2 AND predicate = $3
          ORDER BY recorded_at DESC, fact_id DESC
          LIMIT 1`,
        [companyId, subject, spec.predicate],
      );
      const fact = facts.rows[0];
      if (fact === undefined) {
        // `26 §7` D6. A declared precondition with no fact is not a permission to skip it.
        denyAuthority(
          'G',
          'PRECONDITION',
          'PRECONDITION_FACT_ABSENT',
          `no authoritative fact exists for the declared precondition ${spec.precondition_key}`,
        );
      }
      fetched.push(
        Object.freeze({
          preconditionKey: spec.precondition_key,
          factId: fact.fact_id,
          subject: fact.subject,
          predicate: fact.predicate,
          value: fact.value,
          requiredValue: spec.required_value,
          grade: fact.grade,
          derivationSpec: fact.derivation_spec,
          sourceAdapter: fact.source_adapter,
          corroboratingSource: fact.corroborating_source,
          observedAt: fact.observed_at,
          recordedAt: fact.recorded_at,
          maxAgeSeconds: Number(fact.max_age_seconds),
          stalenessPolicy: fact.staleness_policy,
        }),
      );
    }
    return Object.freeze(fetched);
  }

  /**
   * Step H — grade, corroboration, value and freshness.
   *
   * Four failure modes and each denies under `26 §7`'s own terminal for it:
   *
   *   grade not in the gating set          -> D6 PRECONDITION   (`I6`)
   *   OBSERVATION from a single adapter    -> `I27`'s PRECONDITION_UNCORROBORATED
   *   value ≠ the declared required value   -> D6 PRECONDITION
   *   past `max_age` with policy BLOCK     -> D6 STALE
   *
   * `24 §7`: "A precondition outside `max_age` with `staleness_policy=BLOCK` is not a
   * warning." A `WARN` or `IGNORE` fact past its age does NOT deny, which is what the
   * declared policy means; S1E's fixture declares `BLOCK`, and the boundary is asserted at
   * `max_age ± 1` in the suite.
   */
  evaluateGrade(preconditions: readonly FetchedPrecondition[]): void {
    const now = this.#clock.now().getTime();
    for (const precondition of preconditions) {
      if (!GATING_GRADES.has(precondition.grade)) {
        denyAuthority(
          'H',
          'PRECONDITION',
          'PRECONDITION_GRADE_NOT_GATING',
          `precondition ${precondition.preconditionKey} is ${precondition.grade}-grade and may not gate`,
        );
      }
      if (precondition.grade === 'OBSERVATION') {
        // `I27`, verbatim: "No `OBSERVATION` used as a policy precondition derives solely
        // from a single adapter's writes." The corroborating source must EXIST and must be a
        // DIFFERENT source; a row naming the same adapter twice is a single adapter's writes
        // written twice.
        const single =
          precondition.corroboratingSource === null ||
          precondition.corroboratingSource === precondition.sourceAdapter;
        if (single) {
          denyAuthority(
            'H',
            'PRECONDITION_UNCORROBORATED',
            'PRECONDITION_OBSERVATION_SINGLE_ADAPTER',
            `observation ${precondition.preconditionKey} derives solely from one adapter's writes`,
          );
        }
      }
      if (precondition.value !== precondition.requiredValue) {
        denyAuthority(
          'H',
          'PRECONDITION',
          'PRECONDITION_VALUE_MISMATCH',
          `precondition ${precondition.preconditionKey} does not hold the declared required value`,
        );
      }
      // `24 §7`: `observed_at` is "when the world was in this condition, per the source".
      // Age is measured from THAT, not from `recorded_at`: a fact ACOS learned a second ago
      // about a world state from last month is stale, and measuring from `recorded_at` would
      // let a re-ingest refresh a fact's apparent age without refreshing the fact.
      const ageSeconds = (now - precondition.observedAt.getTime()) / 1000;
      if (ageSeconds > precondition.maxAgeSeconds && precondition.stalenessPolicy === 'BLOCK') {
        denyAuthority(
          'H',
          'STALE',
          'PRECONDITION_PAST_MAX_AGE',
          `precondition ${precondition.preconditionKey} is outside its declared max_age under staleness_policy=BLOCK`,
        );
      }
    }
  }

  /**
   * Step H′ — the contradiction check.
   *
   * `I29`, verbatim: "No authorisation whose precondition set includes a fact participating
   * in an open `ContradictionLink`."
   *
   * `24 §15`: "v1.0 blocked contradicted evidence at the Decision Registry only, which left
   * the effect path open […] The worked case is a refund proceeding on the commerce
   * projection while a conflicting processor record is open."
   *
   * Note the query direction: the fact may sit on EITHER side of the link. A check that only
   * looked at `fact_a_id` would be defeated by inserting the link the other way round.
   */
  async evaluateContradictions(
    client: Client,
    companyId: string,
    preconditions: readonly FetchedPrecondition[],
  ): Promise<void> {
    if (preconditions.length === 0) return;
    const factIds = preconditions.map((precondition) => precondition.factId);
    const rows = await client.query<{ link_id: string }>(
      `SELECT link_id
         FROM contradiction_link
        WHERE company_id = $1
          AND status = 'OPEN'
          AND (fact_a_id = ANY($2::text[]) OR fact_b_id = ANY($2::text[]))
        LIMIT 1`,
      [companyId, factIds],
    );
    if (rows.rows.length > 0) {
      denyAuthority(
        'H′',
        'PRECONDITION_CONTRADICTED',
        'PRECONDITION_IN_OPEN_CONTRADICTION',
        'a precondition participates in an open ContradictionLink',
      );
    }
  }

  /**
   * Step H″ — the delegated-grade check.
   *
   * `I28`, verbatim: "No authorisation whose precondition set includes a `DECISION_DELEGATED`
   * fact for a monetary or irrecoverable action class."
   *
   * `24 §5`, on what this closes (MOA-10): "a CEO-authored recommendation is accepted within
   * delegated authority, becomes a `DECISION`, and thereby reaches gating grade **without a
   * promoter and without a corroborating RECORD**."
   *
   * ---------------------------------------------------------------------------------
   * "MONETARY OR IRRECOVERABLE" IS READ OFF THE CATALOGUE
   *
   * Both operands come from the class's catalogue row, never from the intent and never from
   * the grant:
   *
   *   monetary       the class's vendor request carries a monetary field, or its exposure
   *                  is non-zero — `carriesVendorMonetaryField`
   *   irrecoverable  `recoverability === 'IRRECOVERABLE'` (`26 §5`)
   *
   * `refund.create` is monetary, so a `DECISION_DELEGATED` precondition denies it. A future
   * REVERSIBLE, non-money class would be permitted to gate on one, which is precisely
   * `24 §5`'s "Only for the narrow action class the delegating grant names".
   */
  evaluateDelegatedGrade(
    preconditions: readonly FetchedPrecondition[],
    classShape: { readonly carriesVendorMonetaryField: boolean; readonly recoverability: Recoverability },
  ): void {
    const gated =
      classShape.carriesVendorMonetaryField || classShape.recoverability === 'IRRECOVERABLE';
    if (!gated) return;
    for (const precondition of preconditions) {
      if (precondition.grade === 'DECISION_DELEGATED') {
        denyAuthority(
          'H″',
          'PRECONDITION_DELEGATED',
          'PRECONDITION_DELEGATED_GRADE_ON_GATED_CLASS',
          `precondition ${precondition.preconditionKey} is DECISION_DELEGATED and the class is monetary or irrecoverable`,
        );
      }
    }
  }
}
