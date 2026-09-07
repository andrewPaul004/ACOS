import type { Client } from '../../db/pool.js';
import type { Clock } from '../enumeration/clock.js';
import { denyAuthority } from './errors.js';
import type { EffectiveAuthority } from './grants.js';

/**
 * Step L — "Evidence requirements met? corroboration, tier, freshness, coverage".
 *
 * `26 §7`'s flowchart edge, verbatim: `L -->|no| D10[DENY: EVIDENCE]`.
 *
 * ---------------------------------------------------------------------------------
 * THE REQUIREMENT IS THE GRANT'S, AND THE EVIDENCE IS THE KERNEL'S
 *
 * `26 §4`'s Grant record, verbatim: `evidence_requirements { min_independent_sources,
 * max_tier, max_age_days }`. That is the authoritative statement of what this action needs,
 * it is owner-written data (B9), and `grants.ts` intersects it at its strictest across
 * matching grants.
 *
 * The evidence itself is resolved from `action_evidence_binding` on
 * `(company, task, action_class, resource)` — kernel state. A proposer cannot name an
 * evidence set, cannot supply one, and cannot point this action at a more convenient one:
 * `ProposedIntent` has four authority-bearing fields and none of them is an evidence
 * reference.
 *
 * ---------------------------------------------------------------------------------
 * WHAT S1E IMPLEMENTS, AND WHAT IT DELIBERATELY DOES NOT
 *
 * `26 §7` step L names four checks and `24 §13` supplies their definitions:
 *
 *   corroboration  "Two claims corroborate only if their sources differ on **registrable
 *                  domain** *and* on **owner entity where determinable** *and* neither cites
 *                  the other as its source."  -> INDEPENDENCE IS COMPUTED HERE, not asserted
 *   tier           `24 §12`'s numeric source tier, against the grant's `max_tier`
 *   freshness      `fetch_at` against the grant's `max_age_days`
 *   coverage       `24 §14`: "the proportion of the decision's required claim slots that are
 *                  filled by items with `access_status=OK`" — S1E requires FULL coverage of
 *                  the frozen set, because a partial-coverage threshold is an `[ESTIMATE]`
 *                  the architecture leaves owner-configurable and S1E declines to invent one
 *
 * NOT implemented, and named rather than silently absent: the reasoning plane, retrieval,
 * AI corroboration, vendor ingestion, audit-plane independent reads, `I48`'s retained
 * snapshots, and `24 §13`'s exposure-BAND table. The band table selects a requirement from
 * the exposure; the grant states a requirement directly; S1E evaluates the stated one and
 * `I10` — "Every decision that authorised exposure above the per-action floor references a
 * frozen evidence set meeting the corroboration schedule in `24 §13`" — remains an S2 row in
 * the registry, unchanged.
 * ---------------------------------------------------------------------------------
 */

export interface EvidenceItemRow {
  readonly evidenceItemId: string;
  readonly sourceId: string;
  readonly registrableDomain: string;
  readonly ownerEntity: string | null;
  readonly tier: number;
  readonly fetchAt: Date;
  readonly accessStatus: string;
  readonly citesItemId: string | null;
  readonly loadBearing: boolean;
}

export interface EvidenceEvaluatorOptions {
  readonly clock: Clock;
}

export class EvidenceEvaluator {
  readonly #clock: Clock;

  constructor(options: EvidenceEvaluatorOptions) {
    this.#clock = options.clock;
  }

  /**
   * Step L.
   *
   * A grant declaring no evidence requirement at all — all three fields NULL — passes. That
   * is `24 §13`'s first row, verbatim: "No exposure (internal artifact) | none | any | any",
   * and it is the owner's declared position rather than a default this code chose.
   */
  async evaluate(
    client: Client,
    companyId: string,
    taskId: string,
    actionClass: string,
    resourceId: string,
    authority: EffectiveAuthority,
  ): Promise<readonly string[]> {
    const requiresEvidence =
      authority.evidenceMinSources !== null ||
      authority.evidenceMaxTier !== null ||
      authority.evidenceMaxAgeDays !== null;
    if (!requiresEvidence) return Object.freeze([]);

    const items = await this.#loadFrozenSet(client, companyId, taskId, actionClass, resourceId);
    if (items === null) {
      denyAuthority(
        'L',
        'EVIDENCE',
        'EVIDENCE_SET_ABSENT',
        'the effective grant declares evidence requirements and no frozen evidence set is bound to this action',
      );
    }

    // --- coverage, `24 §14` ---------------------------------------------------------------
    //
    // "`access_status` is a required field, `FAILED` items are stored, and the Decision
    // Registry computes an **evidence coverage** figure". A stored FAILED item is evidence of
    // a gap and is deliberately NOT silently dropped from the set before counting — dropping
    // it would make an unanswerable question look answered, which is `11 E8`'s false closure.
    if (items.some((item) => item.accessStatus !== 'OK')) {
      denyAuthority(
        'L',
        'EVIDENCE',
        'EVIDENCE_COVERAGE_INCOMPLETE',
        'the frozen evidence set contains an item that was not retrieved',
      );
    }

    // --- tier, `24 §12` -------------------------------------------------------------------
    const maxTier = authority.evidenceMaxTier;
    if (maxTier !== null && items.some((item) => item.tier > maxTier)) {
      denyAuthority(
        'L',
        'EVIDENCE',
        'EVIDENCE_SOURCE_TIER_TOO_LOW',
        'the frozen evidence set contains a source below the declared tier ceiling',
      );
    }

    // --- freshness ------------------------------------------------------------------------
    const maxAgeDays = authority.evidenceMaxAgeDays;
    if (maxAgeDays !== null) {
      const now = this.#clock.now().getTime();
      const limitMs = maxAgeDays * 24 * 60 * 60 * 1000;
      if (items.some((item) => now - item.fetchAt.getTime() > limitMs)) {
        denyAuthority(
          'L',
          'EVIDENCE',
          'EVIDENCE_PAST_MAX_AGE',
          'the frozen evidence set contains an item outside the declared freshness window',
        );
      }
    }

    // --- corroboration, `24 §13` -----------------------------------------------------------
    const minSources = authority.evidenceMinSources;
    if (minSources !== null && countIndependent(items) < minSources) {
      denyAuthority(
        'L',
        'EVIDENCE',
        'EVIDENCE_INSUFFICIENT_INDEPENDENT_SOURCES',
        'the frozen evidence set does not carry the declared number of independent sources',
      );
    }

    return Object.freeze(items.map((item) => item.evidenceItemId).sort());
  }

  async #loadFrozenSet(
    client: Client,
    companyId: string,
    taskId: string,
    actionClass: string,
    resourceId: string,
  ): Promise<readonly EvidenceItemRow[] | null> {
    const binding = await client.query<{ evidence_set_id: string }>(
      `SELECT evidence_set_id
         FROM action_evidence_binding
        WHERE company_id = $1 AND task_id = $2 AND action_class = $3 AND resource_id = $4`,
      [companyId, taskId, actionClass, resourceId],
    );
    const bound = binding.rows[0];
    if (bound === undefined) return null;

    const rows = await client.query<{
      evidence_item_id: string;
      source_id: string;
      registrable_domain: string;
      owner_entity: string | null;
      tier: number;
      fetch_at: Date;
      access_status: string;
      cites_item_id: string | null;
      load_bearing: boolean;
    }>(
      `SELECT i.evidence_item_id, i.source_id, s.registrable_domain, s.owner_entity, s.tier,
              i.fetch_at, i.access_status, i.cites_item_id, m.load_bearing
         FROM evidence_set_item m
         JOIN evidence_item i
           ON i.company_id = m.company_id AND i.evidence_item_id = m.evidence_item_id
         JOIN evidence_source s
           ON s.company_id = i.company_id AND s.source_id = i.source_id
        WHERE m.company_id = $1 AND m.evidence_set_id = $2
        ORDER BY i.evidence_item_id ASC`,
      [companyId, bound.evidence_set_id],
    );
    // An empty frozen set is not "no requirement". It is a set with zero independent sources
    // and zero coverage, and the checks above treat it as such.
    return Object.freeze(
      rows.rows.map((row) =>
        Object.freeze({
          evidenceItemId: row.evidence_item_id,
          sourceId: row.source_id,
          registrableDomain: row.registrable_domain,
          ownerEntity: row.owner_entity,
          tier: row.tier,
          fetchAt: row.fetch_at,
          accessStatus: row.access_status,
          citesItemId: row.cites_item_id,
          loadBearing: row.load_bearing,
        }),
      ),
    );
  }
}

/**
 * `24 §13`'s independence, COMPUTED.
 *
 * Verbatim: "**Independence is computed, not asserted.** Two claims corroborate only if their
 * sources differ on **registrable domain** *and* on **owner entity where determinable** *and*
 * neither cites the other as its source. Two articles quoting the same press release are one
 * source."
 *
 * The count is the size of the largest set of items that are pairwise independent, computed
 * greedily over a deterministic order. Greedy is exact here because "same registrable domain"
 * and "same owner entity" are equivalence relations: the pairwise-independent sets are exactly
 * the sets with one item per (domain, owner) class, minus any citation edge inside them, and
 * a citation edge inside one class removes an item that was already collapsed by the class.
 */
export function countIndependent(items: readonly EvidenceItemRow[]): number {
  const chosen: EvidenceItemRow[] = [];
  for (const candidate of items) {
    const independentOfAll = chosen.every((other) => independent(candidate, other));
    if (independentOfAll) chosen.push(candidate);
  }
  return chosen.length;
}

function independent(a: EvidenceItemRow, b: EvidenceItemRow): boolean {
  if (a.registrableDomain === b.registrableDomain) return false;
  // "where determinable" — two NULL owner entities are not evidence of a shared owner, so
  // they do not collapse. Two EQUAL non-null ones do.
  if (a.ownerEntity !== null && b.ownerEntity !== null && a.ownerEntity === b.ownerEntity) {
    return false;
  }
  if (a.citesItemId === b.evidenceItemId || b.citesItemId === a.evidenceItemId) return false;
  return true;
}
