import { computed } from '../canonicalisation/brands.js';
import { ACTION_CATALOGUE } from '../canonicalisation/actionCatalogue.js';
import { CanonicalisationDenied } from '../canonicalisation/errors.js';
import type { ProposedIntent } from '../canonicalisation/intent.js';
import type { TaskContextSpec } from '../enumeration/contextSpec.js';
import type { HeldEntityLease } from '../enumeration/entityLease.js';
import type { LiveSelectorCanonicaliser } from '../enumeration/liveSelector.js';
import type { Clock } from '../enumeration/clock.js';
import type { PolicyEngine } from '../policy/policyEngine.js';
import { AutonomyLedger } from './autonomy.js';
import { evaluateChannel } from './channel.js';
import { evaluateCounterparty } from './counterparty.js';
import { AuthorityDenied } from './errors.js';
import { EvidenceEvaluator } from './evidence.js';
import { evaluateGrantMatch, GrantResolver, type EffectiveAuthority } from './grants.js';
import { freezeCanonicalEffect } from './immutability.js';
import { evaluatePlatformStatus } from './platformStatus.js';
import { PreconditionEvaluator } from './preconditions.js';
import { evaluateCategoricalProhibition } from './prohibitions.js';
import { PrincipalResolver, type AuthoritativePrincipal, type RuntimeSessionRef } from './principal.js';
import { evaluateRecoverability } from './recoverability.js';
import { resourceTypeOf } from './resourceSelector.js';
import {
  AUTHORITY_STEPS,
  S1E_GATE_STEPS,
  S1E_POST_M_STEPS,
  stepPrecedes,
  type AuthorityStep,
} from './steps.js';
import type {
  PreReservationLineage,
  PreReservationOutcome,
} from './preReservationResult.js';

/**
 * `26 §7`'s pre-reservation sequence, end to end, under one held entity execution lease.
 *
 * ---------------------------------------------------------------------------------
 * WHAT THIS COMPOSES AND WHAT IT IMPLEMENTS
 *
 *   B, C, C2   the accepted S1B schema, closed-catalogue and constructor-registry checks,
 *              inside `parseProposedIntent` and `EffectCanonicaliser`
 *   C′         the accepted S1C live re-enumeration under the entity advisory lease
 *   D … L      S1E's own gates
 *   M          the accepted S1D real in-process Cedar decision, UNCHANGED — one production
 *              `isAuthorized` path, one policy artifact set, one digest
 *   N, P       S1E's own gates
 *
 * AND THEN IT STOPS. `26 §7` step R is the next edge and it is not here.
 *
 * ---------------------------------------------------------------------------------
 * THE ORDER IS CHECKED AGAINST `steps.ts` AT CONSTRUCTION
 *
 * `26 §7` property 1: "**Prohibitions are evaluated before grants** and are unappealable."
 *
 * An order that exists only as the sequence of statements in `evaluateUnderLease` is an
 * order a refactor can silently change. So the constructor asserts the declared sequence
 * against `steps.ts` — including the four properties the architecture calls out by name:
 * E before I, H′ before H″, everything before M, and M before N. A pipeline that violates
 * one fails to CONSTRUCT, which is a startup failure rather than a silent authority bypass.
 *
 * ---------------------------------------------------------------------------------
 * THE LEASE IS HELD THROUGHOUT, ON ONE CONNECTION
 *
 * `25 §14`, verbatim: "Advisory lock on `(company_id, entity_type, entity_id)` **for the
 * duration of the propose→authorise→execute span.** Second item waits or defers; it does not
 * proceed on stale state."
 *
 * Every authoritative read below — the session, the principal, the delegation chain, the
 * platform status, the agent profile, the preconditions, the contradiction links, the
 * grants, the evidence and the autonomy ledger — runs on `lease.client`, the connection
 * holding the session-level advisory lock. There is no second connection, no pool checkout
 * and no release-and-reacquire anywhere in this file. `lease.assertHeld()` is called before
 * the first gate and again before the terminal result, so a released lease throws rather
 * than producing a pass.
 *
 * S1E therefore extends the accepted S1C lease discipline through the whole pre-reservation
 * sequence. It does NOT close VC-C3: steps R, S and W are still absent, so the
 * propose→authorise→EXECUTE span remains unproven and `S1E-result.md` says so.
 * ---------------------------------------------------------------------------------
 */

export interface PreReservationPipelineOptions {
  readonly liveSelector: LiveSelectorCanonicaliser;
  readonly policyEngine: PolicyEngine;
  readonly clock: Clock;
}

export class PreReservationAuthorityPipeline {
  readonly #liveSelector: LiveSelectorCanonicaliser;
  readonly #policyEngine: PolicyEngine;
  readonly #principals: PrincipalResolver;
  readonly #preconditions: PreconditionEvaluator;
  readonly #grants: GrantResolver;
  readonly #evidence: EvidenceEvaluator;
  readonly #autonomy: AutonomyLedger;

  constructor(options: PreReservationPipelineOptions) {
    assertDeclaredOrder();
    this.#liveSelector = options.liveSelector;
    this.#policyEngine = options.policyEngine;
    this.#principals = new PrincipalResolver({ clock: options.clock });
    this.#preconditions = new PreconditionEvaluator({ clock: options.clock });
    this.#grants = new GrantResolver({ clock: options.clock });
    this.#evidence = new EvidenceEvaluator({ clock: options.clock });
    this.#autonomy = new AutonomyLedger({ clock: options.clock });
  }

  /**
   * Evaluate `26 §7` from step D to the edge that would enter step R.
   *
   * `session` is the ONLY identity input and it names a session, not a principal. There is no
   * parameter here for a principal, a role, a grade, a grant, a counterparty, a value
   * direction, a platform status, an evidence set, an autonomy level or a policy operand, and
   * no options bag, generic context map, `extra`, `metadata` or `attributes` field in which
   * one could be smuggled. Every authority operand is read from kernel state on the lease's
   * own connection.
   *
   * `barrier` is a TEST-ONLY observation point. It is invoked between the last gate and the
   * terminal result so a concurrency test can park the pipeline while the lease is still
   * held. It receives no authority value, returns nothing that is read, and cannot influence
   * any decision — every gate has already run by the time it is called.
   */
  async evaluateUnderLease(
    lease: HeldEntityLease,
    session: RuntimeSessionRef,
    intent: ProposedIntent,
    spec: TaskContextSpec,
    supplied: KernelNonAuthorityContext,
    barrier?: () => Promise<void>,
  ): Promise<PreReservationOutcome> {
    const evaluated: AuthorityStep[] = [];
    lease.assertHeld();
    if (lease.key.companyId !== session.companyId) {
      throw new Error(
        `the entity execution lease is for company ${lease.key.companyId}, not ${session.companyId}`,
      );
    }

    try {
      // =================================================================================
      // STEP D — the principal, BEFORE anything is canonicalised with it
      // =================================================================================
      //
      // `26 §7` places D after C′. S1E resolves the principal FIRST and then runs C′ with it,
      // because `26 §2.1` requires the request's principal to be "stamped by the kernel" and
      // C′ is where the request is stamped. Resolving it afterwards would mean C′ stamped
      // something unverified. The GATE is still step D — the denial code, the step label and
      // the audit record all say D — and no gate between C′ and D exists to be reordered
      // past.
      evaluated.push('D');
      const principal = await this.#principals.resolve(lease.client, session, spec.taskId);
      if (spec.principalId !== principal.resolved.id) {
        // The `context_spec` is a `23 §5` B9 control artifact. One naming a different
        // principal from the session's is not a proposal a worker can retry; it is two
        // control-plane components disagreeing about identity.
        throw new Error(
          `context_spec principal ${spec.principalId} is not the session principal ${principal.resolved.id}`,
        );
      }

      // =================================================================================
      // C′ — the accepted S1C boundary, with the kernel-resolved principal
      // =================================================================================
      //
      // `window_refs[]` is `26 §2.1`'s "every named window the matching grants reference", so
      // the grant set has to be READ before the request can be built. The read decides
      // nothing: step I below is the gate, and it runs on a second resolution taken on the
      // same lease.
      const preResource = await this.#resolveResourceForWindows(
        lease,
        intent,
        spec,
        supplied,
        principal,
      );
      const effect = freezeCanonicalEffect(
        await this.#liveSelector.canonicaliseUnderLease(lease, intent, spec, {
          companyId: session.companyId,
          principal: computed(principal.resolved),
          grantWindows: {
            windowRefs: preResource.windowRefs,
            resolvedBy: 'kernel:s1e-grant-resolver:v1',
          },
          contextDigest: supplied.contextDigest,
          authorisationRef: supplied.authorisationRef,
        }),
      );

      const request = effect.request;
      const actionClass: string = request.actionClass;
      // `26 §2.1`: `recoverability` and `value_direction` are "from the catalogue, never
      // from the intent". The row is read by CLASS, exactly as `canonicaliser.ts` reads it —
      // there is no catalogue-entry parameter anywhere in S1E for the same reason S1B.2
      // removed one from the canonicalisation context.
      const catalogueEntry = ACTION_CATALOGUE[actionClass as keyof typeof ACTION_CATALOGUE];

      // =================================================================================
      // STEP E — categorical prohibitions. BEFORE grants, and unappealable.
      // =================================================================================
      evaluated.push('E');
      evaluateCategoricalProhibition(actionClass);

      // =================================================================================
      // STEP F — platform status, kill switch, agent profile
      // =================================================================================
      evaluated.push('F');
      await evaluatePlatformStatus(
        lease.client,
        session.companyId,
        principal.resolved.id,
        actionClass,
      );

      // =================================================================================
      // STEPS G / H / H′ / H″ — preconditions
      // =================================================================================
      //
      // Fetched ONCE at G and then examined three times in `26 §7`'s order, so the determining
      // terminal depends on which STEP fires first rather than on which FACT is first in the
      // set.
      evaluated.push('G');
      const preconditions = await this.#preconditions.fetch(
        lease.client,
        session.companyId,
        actionClass,
        // The KERNEL-RESOLVED ref, off the request, not `intent.resourceRef`.
        request.resource.resourceRef,
      );

      evaluated.push('H');
      this.#preconditions.evaluateGrade(preconditions);

      evaluated.push('H′');
      await this.#preconditions.evaluateContradictions(
        lease.client,
        session.companyId,
        preconditions,
      );

      evaluated.push('H″');
      this.#preconditions.evaluateDelegatedGrade(preconditions, {
        carriesVendorMonetaryField: catalogueEntry.carriesVendorMonetaryField,
        recoverability: catalogueEntry.recoverability,
      });

      // =================================================================================
      // STEP I — the matching grant set, after subset intersection
      // =================================================================================
      evaluated.push('I');
      const matched = await this.#grants.resolve(
        lease.client,
        session.companyId,
        principal,
        actionClass,
        request.resource,
      );
      const authority: EffectiveAuthority = evaluateGrantMatch(matched, request.windowRefs);

      // =================================================================================
      // STEP J — recoverability ≤ the effective grant ceiling
      // =================================================================================
      evaluated.push('J');
      evaluateRecoverability(request.recoverability, authority);

      // =================================================================================
      // STEP K — counterparty novelty, where the CATALOGUE says the class has one
      // =================================================================================
      evaluated.push('K');
      evaluateCounterparty(request.valueDirection, request.counterparty, authority);

      // =================================================================================
      // STEP L — evidence
      // =================================================================================
      evaluated.push('L');
      await this.#evidence.evaluate(
        lease.client,
        session.companyId,
        spec.taskId,
        actionClass,
        request.resource.resourceId,
        authority,
      );

      // =================================================================================
      // STEP M — the accepted S1D Cedar decision. NOT REIMPLEMENTED.
      // =================================================================================
      //
      // One production `isAuthorized` path exists in this tree and it is
      // `policy/cedarEngine.ts`, reached only through `PolicyEngine.evaluate`. S1E calls it
      // with the canonical effect and reads its verdict; it adds no second evaluator, no
      // wrapper policy, no fallback and no re-inspection of any amount.
      evaluated.push('M');
      const decision = this.#policyEngine.evaluate(effect);
      const lineage: PreReservationLineage = Object.freeze({
        policyVersion: decision.lineage.policyVersion,
        constructorVersion: decision.lineage.constructorVersion,
        determiningPolicies: decision.lineage.determiningPolicies,
        stepsEvaluated: Object.freeze([...evaluated]),
      });
      if (decision.decision === 'DENY') {
        return Object.freeze({
          outcome: 'DENIED' as const,
          step: 'M' as const,
          code: decision.code,
          // Step M's internal reason is the DETERMINING CEDAR POLICY, which `lineage` already
          // carries. There is no S1E detail to add and none is invented.
          detail: null,
          lineage,
          stepsEvaluated: lineage.stepsEvaluated,
        });
      }

      // =================================================================================
      // STEP N — the autonomy ledger
      // =================================================================================
      evaluated.push('N');
      const autonomy = await this.#autonomy.evaluate(lease.client, session.companyId, {
        taskType: await this.#taskTypeOf(lease, session.companyId, spec.taskId),
        actionClass,
        // `26 §3`: null for non-AI. A principal with no binding has no ledger key, and
        // `26 §13`'s ladder cannot speak about it — so it takes the absent-entry branch
        // rather than a wildcard, and the absent-entry branch is REQUIRE_APPROVAL.
        modelBinding: principal.resolved.modelBinding ?? '',
        resourceClass: resourceTypeOf(request.resource),
      });
      if (!autonomy.permits) {
        return Object.freeze({
          outcome: 'REQUIRE_APPROVAL' as const,
          reason: autonomy.reason,
          approvalRequirement: authority.approvalRequirement,
          lineage: withSteps(lineage, evaluated),
        });
      }

      // =================================================================================
      // STEP P — channel. `26 §9` is not deployed, so a channel-bearing request denies.
      // =================================================================================
      evaluated.push('P');
      evaluateChannel(request.channel);

      // =================================================================================
      // THE EDGE INTO STEP R — and S1E STOPS HERE
      // =================================================================================
      if (barrier !== undefined) await barrier();
      // The lease must STILL be held. This is not a formality: it is the assertion that
      // distinguishes "one session held the lock across the whole sequence" from "a session
      // held it at the start".
      lease.assertHeld();

      return Object.freeze({
        outcome: 'PRE_RESERVATION_PASS' as const,
        request,
        dispatchPayloadHash: request.dispatchPayloadHash,
        windowRefs: authority.windowRefs,
        autonomyLevel: autonomy.level,
        gateClass: autonomy.gateClass,
        lineage: withSteps(lineage, evaluated),
      });
    } catch (error) {
      if (error instanceof AuthorityDenied) {
        return Object.freeze({
          outcome: 'DENIED' as const,
          step: error.step,
          code: error.code,
          detail: error.detail,
          lineage: null,
          stepsEvaluated: Object.freeze([...evaluated]),
        });
      }
      if (error instanceof CanonicalisationDenied) {
        // S1B/S1C denials keep their own codes and are attributed to the step that raised
        // them. `26 §7`'s C′ row owns the selector family; B, C and C2 own the rest.
        return Object.freeze({
          outcome: 'DENIED' as const,
          step: stepForCanonicalisationDenial(error.code),
          code: error.code,
          // S1C's own closed detail enum, carried through unchanged. The exception still
          // holds its free-text note for the audit-write step a later slice adds.
          detail: error.detail,
          lineage: null,
          stepsEvaluated: Object.freeze([...evaluated]),
        });
      }
      // Everything else is a control-plane defect and RETHROWS, exactly as S1C and S1D do.
      // Swallowing one into a denial would tell a worker to try something else while the
      // authority substrate was broken.
      throw error;
    }
  }

  /**
   * The grant-derived `window_refs[]` for the request C′ is about to build.
   *
   * `26 §2.1` puts the field on the request and `26 §7` puts the grant DECISION at step I, so
   * the resolution has to happen twice: once as a read that populates the field, once as the
   * gate. Both run on the lease's client, and step I asserts the two agree — a divergence
   * would mean grant state moved under a held lease.
   */
  async #resolveResourceForWindows(
    lease: HeldEntityLease,
    intent: ProposedIntent,
    spec: TaskContextSpec,
    supplied: KernelNonAuthorityContext,
    principal: AuthoritativePrincipal,
  ): Promise<{ readonly windowRefs: readonly string[] }> {
    void supplied;
    const rows = await lease.client.query<{ order_id: string; grade: string }>(
      `SELECT order_id, grade
         FROM commerce_order
        WHERE company_id = $1 AND resource_ref = $2`,
      [spec.companyId, intent.resourceRef],
    );
    const row = rows.rows[0];
    if (row === undefined) {
      // The resource does not resolve. C′ is the step that owns that denial and owns its
      // wording — `26 §7`'s C′ row, and S1C's rule that reporting WHY would hand the worker
      // an existence oracle. So this read yields no windows and lets C′ deny.
      return { windowRefs: [] };
    }
    const windowRefs = await this.#grants.resolveWindowRefs(
      lease.client,
      spec.companyId,
      principal,
      intent.actionClass,
      { resourceRef: intent.resourceRef, resourceId: row.order_id, grade: row.grade as 'RECORD' },
    );
    return { windowRefs };
  }

  async #taskTypeOf(lease: HeldEntityLease, companyId: string, taskId: string): Promise<string> {
    const rows = await lease.client.query<{ task_type: string }>(
      `SELECT task_type FROM authority_task WHERE company_id = $1 AND task_id = $2`,
      [companyId, taskId],
    );
    const row = rows.rows[0];
    if (row === undefined) {
      // Step D already proved the task exists and belongs to this principal, so its absence
      // here is corruption between two reads on one held lease.
      throw new Error(`task ${taskId} disappeared during the authority sequence`);
    }
    return row.task_type;
  }
}

/**
 * The kernel-owned context fields that are NOT authority operands.
 *
 * Four fields became three when S1E took over principal resolution and grant-window
 * resolution: `principal` and `grantWindows` are DELIBERATELY ABSENT, because a caller able
 * to pass either could supply the two operands `26 §7` steps D and I exist to derive.
 *
 * What remains is lineage: the digest of the assembled context the proposer saw, and the
 * authorisation reference the gateway allocates. Neither bounds money, neither selects a
 * grant, and neither can influence a gate — which is the property
 * `tests/authority/authority-channel-attacks.test.ts` asserts field by field.
 */
export interface KernelNonAuthorityContext {
  /** `26 §2.1`: "context_digest — hash of the assembled context the proposer saw". */
  readonly contextDigest: string;
  /** `26 §2.1`, on DispatchPayload: `authorisation_ref`. Allocated by the gateway. */
  readonly authorisationRef: string;
}

function withSteps(
  lineage: PreReservationLineage,
  evaluated: readonly AuthorityStep[],
): PreReservationLineage {
  return Object.freeze({ ...lineage, stepsEvaluated: Object.freeze([...evaluated]) });
}

function stepForCanonicalisationDenial(code: string): AuthorityStep {
  switch (code) {
    case 'MALFORMED':
      return 'B';
    case 'UNKNOWN_ACTION':
      return 'C';
    case 'NOT_CANONICALISABLE':
      return 'C2';
    default:
      return "C′";
  }
}

/**
 * The construction-time order check.
 *
 * Four named properties from `26 §7`, asserted against `steps.ts` rather than against this
 * file's statement order, plus the full-sequence check that the gates this pipeline runs are
 * exactly the ones `26 §7` places between C′ and R.
 */
function assertDeclaredOrder(): void {
  const required: readonly (readonly [AuthorityStep, AuthorityStep])[] = [
    // `26 §7` property 1: "Prohibitions are evaluated before grants".
    ['E', 'I'],
    // `26 §7`: H′ is "Immediately after H"; H″ follows H′.
    ['H', "H′"],
    ["H′", 'H″'],
    // Every authority gate precedes the policy decision.
    ['D', 'M'],
    ['L', 'M'],
    // And the autonomy ledger follows it.
    ['M', 'N'],
    ['N', 'P'],
  ];
  for (const [earlier, later] of required) {
    if (!stepPrecedes(earlier, later)) {
      throw new Error(
        `26 §7 requires step ${earlier} to precede step ${later}; the declared sequence does not`,
      );
    }
  }
  const declared = new Set<string>(AUTHORITY_STEPS);
  for (const step of [...S1E_GATE_STEPS, ...S1E_POST_M_STEPS]) {
    if (!declared.has(step)) {
      throw new Error(`step ${step} is not a declared 26 §7 step`);
    }
  }
}
