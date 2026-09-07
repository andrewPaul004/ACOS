import type { Client } from '../../db/pool.js';
import type { Recoverability } from '../canonicalisation/actionCatalogue.js';
import type { ResolvedResource } from '../canonicalisation/types.js';
import { fromDb, type Money } from '../exposure/money.js';
import type { Clock } from '../enumeration/clock.js';
import { authorityDefect, denyAuthority } from './errors.js';
import type { AuthoritativePrincipal } from './principal.js';
import { selectorMatchesResource } from './resourceSelector.js';

/**
 * Step I — "Matching grant exists after subset intersection?"
 *
 * `26 §7`'s flowchart edge, verbatim: `I -->|no| D7[DENY: NO_GRANT]`.
 *
 * ---------------------------------------------------------------------------------
 * WHAT "MATCHING" MEANS, FIELD BY FIELD, FROM `26 §4`
 *
 *   status               ACTIVE
 *   expires_at           strictly in the future.  "expiry is mandatory […] An expired grant
 *                        is not renewed automatically."
 *   principal_selector   { kind?, role?, model_binding? }, each NULL meaning "any", each
 *                        compared against the KERNEL-RESOLVED principal
 *   action_class_selector  contains the class
 *   resource_selector    { type, predicate } selects the KERNEL-RESOLVED resource
 *   window_refs          references named windows; MONTH is mandatory
 *
 * and then `26 §3` rule 2's intersection: the class must ALSO be inside the delegation
 * chain's effective capability set, or the grant is not a grant this principal can use.
 *
 * ---------------------------------------------------------------------------------
 * MULTIPLE MATCHING GRANTS INTERSECT. THEY DO NOT UNION.
 *
 * `26 §4` v1.2 declares the window arithmetic and leaves the composition of two matching
 * grants' PER-ACTION bounds unstated. Both readings are expressible and they differ in a
 * way that matters, so S1E takes the conservative one and records it as an owner
 * clarification (S1E-C4) rather than choosing quietly:
 *
 *   recoverability_max        MINIMUM across matching grants
 *   counterparty novelty_max  MINIMUM (and NULL — "no counterparty at all" — is the minimum)
 *   per_action_max.monetary   MINIMUM of the declared ones
 *   evidence_requirements     the STRICTEST: max(min_sources), min(max_tier), min(max_age)
 *   approval_requirement      the HIGHEST tier
 *   window_refs               UNION — `26 §7` step R reserves "against EVERY named window
 *                             instance the matching grants reference […] and fails if ANY
 *                             lacks headroom", so union is the restrictive direction here
 *
 * The governing sentences are `26 §3` rule 2 — "A delegation can only narrow" — and `26 §4`
 * v1.2's "a grant may only narrow". A union of per-action bounds would let an owner who
 * adds a broad grant silently erase a narrow restriction they wrote earlier, which is the
 * failure the mandate names and which no passage in `26` endorses.
 *
 * ---------------------------------------------------------------------------------
 * THE PER-ACTION CAP THAT BINDS IS STILL THE ONE IN THE CEDAR ARTIFACT
 *
 * `perActionMaxMonetary` below is carried for the audit record and for the intersection. It
 * is NOT the operand step M compares against: `26 §11` P1's cap is the literal inside the
 * hash-committed policy artifact, and S1D's `acos.refund.create.per_action_max.cedar` holds
 * it. Moving the binding figure into a database row would put the money cap somewhere a
 * compromised writer could raise, which is the opposite of `26 §11`'s "No runtime editing".
 * ---------------------------------------------------------------------------------
 */

/** `26 §5`'s ordering. A higher ordinal is a broader authority. */
const RECOVERABILITY_ORDER: Readonly<Record<Recoverability, number>> = Object.freeze({
  REVERSIBLE: 0,
  COMPENSABLE: 1,
  IRRECOVERABLE: 2,
});

export function recoverabilityOrdinal(value: Recoverability): number {
  return RECOVERABILITY_ORDER[value];
}

/** `26 §2.1`'s counterparty novelty, ordered. `26 §4` caps at EXISTING or ALLOWLISTED. */
export type CounterpartyNovelty = 'EXISTING' | 'ALLOWLISTED' | 'NOVEL';

const NOVELTY_ORDER: Readonly<Record<CounterpartyNovelty, number>> = Object.freeze({
  EXISTING: 0,
  ALLOWLISTED: 1,
  NOVEL: 2,
});

export function noveltyOrdinal(value: CounterpartyNovelty): number {
  return NOVELTY_ORDER[value];
}

const APPROVAL_ORDER: Readonly<Record<string, number>> = Object.freeze({
  NONE: 0,
  TIER_1: 1,
  TIER_2: 2,
  OWNER: 3,
});

export interface MatchedGrant {
  readonly grantId: string;
  readonly version: number;
  readonly recoverabilityMax: Recoverability;
  readonly counterpartyNoveltyMax: 'EXISTING' | 'ALLOWLISTED' | null;
  readonly perActionMaxMonetary: Money | null;
  readonly evidenceMinSources: number | null;
  readonly evidenceMaxTier: number | null;
  readonly evidenceMaxAgeDays: number | null;
  readonly approvalRequirement: string;
  readonly autonomyKeyBinding: string;
  readonly gateClassOnPermit: string;
  readonly standingRequired: boolean;
  readonly windowRefs: readonly string[];
}

/** The intersection `26 §3` rule 2 and `26 §4` describe. Every bound is the narrowest. */
export interface EffectiveAuthority {
  readonly grants: readonly MatchedGrant[];
  readonly recoverabilityMax: Recoverability;
  readonly counterpartyNoveltyMax: 'EXISTING' | 'ALLOWLISTED' | null;
  readonly perActionMaxMonetary: Money | null;
  readonly evidenceMinSources: number | null;
  readonly evidenceMaxTier: number | null;
  readonly evidenceMaxAgeDays: number | null;
  readonly approvalRequirement: string;
  readonly autonomyKeyBindings: readonly string[];
  /** The UNION, sorted. `26 §7` step R reserves against every one of them. */
  readonly windowRefs: readonly string[];
}

interface GrantRow {
  readonly grant_id: string;
  readonly version: number;
  readonly expires_at: Date;
  readonly principal_kind: string | null;
  readonly principal_role: string | null;
  readonly principal_model_binding: string | null;
  readonly resource_type: string;
  readonly resource_predicate: string;
  readonly counterparty_novelty_max: string | null;
  readonly recoverability_max: string;
  readonly per_action_max_monetary: string | null;
  readonly standing_required: boolean;
  readonly evidence_min_sources: number | null;
  readonly evidence_max_tier: number | null;
  readonly evidence_max_age_days: number | null;
  readonly approval_requirement: string;
  readonly autonomy_key_binding: string;
  readonly gate_class_on_permit: string;
}

export interface GrantResolverOptions {
  readonly clock: Clock;
}

export class GrantResolver {
  readonly #clock: Clock;

  constructor(options: GrantResolverOptions) {
    this.#clock = options.clock;
  }

  /**
   * Resolve the matching grant set for `(principal, action class, resource)`.
   *
   * Called TWICE in one proposal and deliberately so:
   *
   *   before C′  to produce `window_refs[]` — `26 §2.1` requires the request to carry "every
   *              named window the matching grants reference", and C′ builds the request. The
   *              fetch is a READ; it decides nothing.
   *   at step I  as the GATE. `26 §7` places the decision here, and this is where NO_GRANT
   *              is raised.
   *
   * Both calls run on the LEASE'S OWN CLIENT, so the grant state the request was built from
   * is the grant state the gate evaluates, under one held lease.
   */
  async resolve(
    client: Client,
    companyId: string,
    principal: AuthoritativePrincipal,
    actionClass: string,
    resource: ResolvedResource,
  ): Promise<readonly MatchedGrant[]> {
    const now = this.#clock.now();
    const rows = await client.query<GrantRow>(
      `SELECT g.grant_id, g.version, g.expires_at,
              g.principal_kind, g.principal_role, g.principal_model_binding,
              g.resource_type, g.resource_predicate,
              g.counterparty_novelty_max, g.recoverability_max,
              g.per_action_max_monetary, g.standing_required,
              g.evidence_min_sources, g.evidence_max_tier, g.evidence_max_age_days,
              g.approval_requirement, g.autonomy_key_binding, g.gate_class_on_permit
         FROM authority_grant g
         JOIN authority_grant_action_class a
           ON a.company_id = g.company_id AND a.grant_id = g.grant_id
        WHERE g.company_id = $1
          AND g.status = 'ACTIVE'
          AND a.action_class = $2
        ORDER BY g.grant_id ASC`,
      [companyId, actionClass],
    );

    const matched: MatchedGrant[] = [];
    for (const row of rows.rows) {
      // `26 §4`: "expiry is mandatory […] An expired grant is not renewed automatically."
      if (row.expires_at.getTime() <= now.getTime()) continue;

      // `26 §4`'s `principal_selector { kind?, role?, model_binding? }`. NULL is the printed
      // `?` — the selector does not constrain that dimension. Every comparison is against
      // the KERNEL-RESOLVED principal.
      if (row.principal_kind !== null && row.principal_kind !== principal.resolved.kind) continue;
      if (row.principal_role !== null && row.principal_role !== principal.resolved.role) continue;
      if (
        row.principal_model_binding !== null &&
        row.principal_model_binding !== principal.resolved.modelBinding
      ) {
        continue;
      }

      if (
        !selectorMatchesResource(
          { type: row.resource_type, predicate: row.resource_predicate },
          resource,
        )
      ) {
        continue;
      }

      // `26 §3` rule 2. A grant conveying a class the delegation chain narrowed away is not
      // a grant this principal can use, however well it matches on every other dimension.
      if (
        principal.effectiveActionClasses !== null &&
        !principal.effectiveActionClasses.has(actionClass)
      ) {
        continue;
      }

      const windows = await client.query<{ window_id: string; period: string }>(
        `SELECT w.window_id, r.period
           FROM authority_grant_window w
           JOIN window_registry r
             ON r.company_id = w.company_id AND r.window_id = w.window_id
          WHERE w.company_id = $1 AND w.grant_id = $2
          ORDER BY w.window_id ASC`,
        [companyId, row.grant_id],
      );
      // `26 §4`, verbatim: "**every grant carries a MONTH window** so `MAL_total(month)` is
      // defined. A grant with only a DAY window made `min(g.window_limit(MONTH).max_monetary,
      // …)` undefined". A grant that cannot satisfy that is malformed authority state, and a
      // malformed grant must not silently match.
      if (!windows.rows.some((window) => window.period === 'MONTH')) {
        denyAuthority(
          'I',
          'NO_GRANT',
          'GRANT_MISSING_MONTH_WINDOW',
          `grant ${row.grant_id} references no MONTH window`,
        );
      }

      const recoverability = row.recoverability_max;
      if (recoverability !== 'REVERSIBLE' && recoverability !== 'COMPENSABLE' && recoverability !== 'IRRECOVERABLE') {
        authorityDefect('I', `grant ${row.grant_id} has an undeclared recoverability_max`);
      }
      const novelty = row.counterparty_novelty_max;
      if (novelty !== null && novelty !== 'EXISTING' && novelty !== 'ALLOWLISTED') {
        authorityDefect('I', `grant ${row.grant_id} has an undeclared counterparty novelty_max`);
      }

      matched.push(
        Object.freeze({
          grantId: row.grant_id,
          version: row.version,
          recoverabilityMax: recoverability,
          counterpartyNoveltyMax: novelty,
          perActionMaxMonetary:
            row.per_action_max_monetary === null ? null : fromDb(row.per_action_max_monetary),
          evidenceMinSources: row.evidence_min_sources,
          evidenceMaxTier: row.evidence_max_tier,
          evidenceMaxAgeDays: row.evidence_max_age_days,
          approvalRequirement: row.approval_requirement,
          autonomyKeyBinding: row.autonomy_key_binding,
          gateClassOnPermit: row.gate_class_on_permit,
          standingRequired: row.standing_required,
          windowRefs: Object.freeze(windows.rows.map((window) => window.window_id)),
        }),
      );
    }
    return Object.freeze(matched);
  }

  /**
   * The window refs `26 §2.1` puts on the request: the UNION over matching grants.
   *
   * Returns an empty array when nothing matches. C′ then builds a request with no windows
   * and step I denies `NO_GRANT` shortly after — the ORDER is `26 §7`'s and this read does
   * not pre-empt it.
   */
  async resolveWindowRefs(
    client: Client,
    companyId: string,
    principal: AuthoritativePrincipal,
    actionClass: string,
    resource: ResolvedResource,
  ): Promise<readonly string[]> {
    const matched = await this.resolve(client, companyId, principal, actionClass, resource);
    return unionWindowRefs(matched);
  }
}

function unionWindowRefs(grants: readonly MatchedGrant[]): readonly string[] {
  const union = new Set<string>();
  for (const grant of grants) {
    for (const windowId of grant.windowRefs) union.add(windowId);
  }
  return Object.freeze([...union].sort());
}

/**
 * `26 §7` step I — the GATE, and the intersection.
 *
 * Denies `NO_GRANT` when nothing matched. Otherwise returns the effective authority every
 * later step evaluates against, with each bound at its narrowest.
 */
export function evaluateGrantMatch(
  grants: readonly MatchedGrant[],
  requestWindowRefs: readonly string[],
): EffectiveAuthority {
  if (grants.length === 0) {
    denyAuthority(
      'I',
      'NO_GRANT',
      'NO_ACTIVE_GRANT',
      'no active, unexpired grant selects this principal, class and resource',
    );
  }

  // `26 §2.1`: the request's `window_refs[]` IS "every named window the matching grants
  // reference". The two are resolved by one function under one lease, so a divergence means
  // the grant state moved between the C′ read and this gate — which is exactly the condition
  // the lease exists to prevent, and therefore a defect rather than a denial.
  const union = unionWindowRefs(grants);
  const requested = [...requestWindowRefs].sort();
  if (union.length !== requested.length || union.some((id, index) => id !== requested[index])) {
    denyAuthority(
      'I',
      'NO_GRANT',
      'GRANT_WINDOW_REFS_DIVERGE_FROM_REQUEST',
      'the request window_refs do not equal the union over the matching grants',
    );
  }

  let recoverabilityMax = grants[0]!.recoverabilityMax;
  let counterpartyNoveltyMax = grants[0]!.counterpartyNoveltyMax;
  let perActionMaxMonetary = grants[0]!.perActionMaxMonetary;
  let evidenceMinSources = grants[0]!.evidenceMinSources;
  let evidenceMaxTier = grants[0]!.evidenceMaxTier;
  let evidenceMaxAgeDays = grants[0]!.evidenceMaxAgeDays;
  let approvalRequirement = grants[0]!.approvalRequirement;

  for (const grant of grants.slice(1)) {
    if (recoverabilityOrdinal(grant.recoverabilityMax) < recoverabilityOrdinal(recoverabilityMax)) {
      recoverabilityMax = grant.recoverabilityMax;
    }
    // NULL is "this grant permits no external counterparty", which is narrower than either
    // declared value, so it wins.
    if (grant.counterpartyNoveltyMax === null) {
      counterpartyNoveltyMax = null;
    } else if (
      counterpartyNoveltyMax !== null &&
      noveltyOrdinal(grant.counterpartyNoveltyMax) < noveltyOrdinal(counterpartyNoveltyMax)
    ) {
      counterpartyNoveltyMax = grant.counterpartyNoveltyMax;
    }
    if (grant.perActionMaxMonetary !== null) {
      perActionMaxMonetary =
        perActionMaxMonetary === null || grant.perActionMaxMonetary < perActionMaxMonetary
          ? grant.perActionMaxMonetary
          : perActionMaxMonetary;
    }
    // Evidence: strictest of each dimension. More sources, lower (better) tier ceiling,
    // shorter freshness window.
    if (grant.evidenceMinSources !== null) {
      evidenceMinSources =
        evidenceMinSources === null
          ? grant.evidenceMinSources
          : Math.max(evidenceMinSources, grant.evidenceMinSources);
    }
    if (grant.evidenceMaxTier !== null) {
      evidenceMaxTier =
        evidenceMaxTier === null
          ? grant.evidenceMaxTier
          : Math.min(evidenceMaxTier, grant.evidenceMaxTier);
    }
    if (grant.evidenceMaxAgeDays !== null) {
      evidenceMaxAgeDays =
        evidenceMaxAgeDays === null
          ? grant.evidenceMaxAgeDays
          : Math.min(evidenceMaxAgeDays, grant.evidenceMaxAgeDays);
    }
    if ((APPROVAL_ORDER[grant.approvalRequirement] ?? 0) > (APPROVAL_ORDER[approvalRequirement] ?? 0)) {
      approvalRequirement = grant.approvalRequirement;
    }
  }

  return Object.freeze({
    grants,
    recoverabilityMax,
    counterpartyNoveltyMax,
    perActionMaxMonetary,
    evidenceMinSources,
    evidenceMaxTier,
    evidenceMaxAgeDays,
    approvalRequirement,
    autonomyKeyBindings: Object.freeze(
      [...new Set(grants.map((grant) => grant.autonomyKeyBinding))].sort(),
    ),
    windowRefs: union,
  });
}
