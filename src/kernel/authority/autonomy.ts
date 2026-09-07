import type { Client } from '../../db/pool.js';
import type { Clock } from '../enumeration/clock.js';
import { authorityDefect } from './errors.js';

/**
 * Step N — "Autonomy ledger permits this key at this level?"
 *
 * `26 §7`'s flowchart edge, verbatim: `N -->|no| O1[REQUIRE_APPROVAL: PROBATION]`.
 *
 * ---------------------------------------------------------------------------------
 * STEP N IS NOT A DENIAL STEP
 *
 * Every other gate S1E owns has a `DENY:` terminal. Step N's negative edge goes to
 * `REQUIRE_APPROVAL`, which then goes to X (the audit write) and never to R. So the honest
 * S1E terminal for a failing step N is a third outcome — neither a pass nor a denial — and
 * `preReservation.ts` returns exactly that.
 *
 * S1E does NOT create an Approval object, does not enqueue one, and does not wait. `26 §12`'s
 * state machine, `I60`, the reservation-before-approval ordering and the resume path are all
 * step-R-and-after machinery. A REQUIRE_APPROVAL outcome here means "this proposal cannot
 * proceed to step R autonomously", which is true and is all S1E can prove.
 *
 * ---------------------------------------------------------------------------------
 * THE KEY IS FOUR KERNEL-OWNED OPERANDS
 *
 * `26 §13`, verbatim: "key: (task_type, action_class, model_binding, resource_class)".
 *
 *   task_type       from `authority_task` — `24 §3` K7 owns tasks
 *   action_class    from the closed catalogue, one of `I21`'s four permitted intent fields
 *   model_binding   from the resolved `principal` row — `26 §3`
 *   resource_class  from the KERNEL-RESOLVED resource's type
 *
 * None is a request field a proposer supplies, and there is no parameter here through which
 * a level, a probation date or a violation count could arrive.
 *
 * ---------------------------------------------------------------------------------
 * THE LADDER IS INERT AT MVP, AND SAYING SO IS PART OF IMPLEMENTING IT
 *
 * `26 §13`, verbatim: "the promotion thresholds are `[ESTIMATE]`-graded and the ladder is
 * inert at MVP (R20, `45 §8`) […] **no capability is expected to promote during the MVP.**"
 *
 * S1E therefore implements the READ side exactly and implements NO promotion path: there is
 * no function here that raises a level, and `26 §13`'s promotion criteria — observation
 * minimums, `pass^k`, exception rate, human-correction rate, realised loss — are measured by
 * the audit plane, which does not exist. Demotion's automatic half IS implemented, because it
 * is a read over counters the ledger already carries and because `26 §13` calls it
 * "automatic and immediate".
 * ---------------------------------------------------------------------------------
 */

export type AutonomyLevel =
  | 'L0_ADVISORY'
  | 'L1_ASSISTED'
  | 'L2_SUPERVISED'
  | 'L3_OPERATIONAL'
  | 'L4_STRATEGIC';

const LEVEL_ORDER: Readonly<Record<AutonomyLevel, number>> = Object.freeze({
  L0_ADVISORY: 0,
  L1_ASSISTED: 1,
  L2_SUPERVISED: 2,
  L3_OPERATIONAL: 3,
  L4_STRATEGIC: 4,
});

/**
 * The lowest level at which `26 §13` says an effect proceeds without approval.
 *
 * Verbatim: "Effects permitted at **L3/L4** without approval are `UNGATED_LOGGED` and count
 * toward the governed monthly quantity." L2 and below therefore require approval, which is
 * what "SUPERVISED" means.
 */
export const AUTONOMOUS_LEVEL_FLOOR: AutonomyLevel = 'L3_OPERATIONAL';

export interface AutonomyKey {
  readonly taskType: string;
  readonly actionClass: string;
  readonly modelBinding: string;
  readonly resourceClass: string;
}

export type AutonomyOutcome =
  | { readonly permits: true; readonly level: AutonomyLevel; readonly gateClass: 'UNGATED_LOGGED' }
  | { readonly permits: false; readonly reason: AutonomyRefusal };

/**
 * Why step N did not permit. AUDIT PATH ONLY — the worker sees `REQUIRE_APPROVAL` and no
 * reason, because "your capability is on probation until the 9th" is a statement about the
 * company's control posture.
 */
export type AutonomyRefusal =
  | 'LEDGER_ENTRY_ABSENT'
  | 'ON_PROBATION'
  | 'LEVEL_BELOW_AUTONOMOUS_FLOOR'
  | 'POLICY_VIOLATION_RECORDED'
  | 'ESCALATION_MISS_RECORDED';

export interface AutonomyLedgerOptions {
  readonly clock: Clock;
}

export class AutonomyLedger {
  readonly #clock: Clock;

  constructor(options: AutonomyLedgerOptions) {
    this.#clock = options.clock;
  }

  async evaluate(client: Client, companyId: string, key: AutonomyKey): Promise<AutonomyOutcome> {
    const rows = await client.query<{
      level: string;
      observations: string;
      policy_violations: string;
      escalation_misses: string;
      probation_until: Date | null;
    }>(
      `SELECT level, observations, policy_violations, escalation_misses, probation_until
         FROM autonomy_ledger_entry
        WHERE company_id = $1
          AND task_type = $2
          AND action_class = $3
          AND model_binding = $4
          AND resource_class = $5`,
      [companyId, key.taskType, key.actionClass, key.modelBinding, key.resourceClass],
    );
    const row = rows.rows[0];
    if (row === undefined) {
      // `26 §13`: a binding with no proven level "starts at […] by default `probation`,
      // meaning `REQUIRE_APPROVAL` on every effect". An absent entry is the same position and
      // the same answer. It is NOT a permit and it is NOT a hard denial.
      return Object.freeze({ permits: false as const, reason: 'LEDGER_ENTRY_ABSENT' as const });
    }

    const level = row.level as AutonomyLevel;
    if (!(level in LEVEL_ORDER)) {
      authorityDefect('N', `autonomy ledger entry declares an undeclared level`);
    }

    // `26 §13`: "Demotion is automatic and immediate on any of: a policy violation; a
    // RED-class escalation miss; …". Immediate means it is read here, not swept later.
    if (BigInt(row.policy_violations) > 0n) {
      return Object.freeze({
        permits: false as const,
        reason: 'POLICY_VIOLATION_RECORDED' as const,
      });
    }
    if (BigInt(row.escalation_misses) > 0n) {
      return Object.freeze({
        permits: false as const,
        reason: 'ESCALATION_MISS_RECORDED' as const,
      });
    }
    if (row.probation_until !== null && row.probation_until.getTime() > this.#clock.now().getTime()) {
      return Object.freeze({ permits: false as const, reason: 'ON_PROBATION' as const });
    }
    if (LEVEL_ORDER[level] < LEVEL_ORDER[AUTONOMOUS_LEVEL_FLOOR]) {
      return Object.freeze({
        permits: false as const,
        reason: 'LEVEL_BELOW_AUTONOMOUS_FLOOR' as const,
      });
    }

    // `26 §13`: "Effects permitted at L3/L4 without approval are UNGATED_LOGGED".
    return Object.freeze({ permits: true as const, level, gateClass: 'UNGATED_LOGGED' as const });
  }
}
