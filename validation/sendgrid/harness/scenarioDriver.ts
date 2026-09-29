import type { AdapterRuntimeDescriptor } from '../../../src/integration/control/adapterRuntimeRegistry.js';
import type { AuditReaderDescriptor } from '../../../src/audit/provider/plane/auditReaderRegistry.js';
import type { AdapterRegistry } from '../../../src/kernel/gateway/adapterRegistry.js';
import type { DispatchEnvironment, DispatchHooks } from '../../../src/kernel/gateway/effectGateway.js';
import { dispatchAuthorisedEffect } from '../../../src/kernel/gateway/effectGateway.js';
import type { S1PValidationAuthority } from './validationAuthority.js';
import type { KillPointRow } from './killPoints.js';
import { KILL_POINT_ROWS } from './killPoints.js';
import type { ObservationDeps, ObservationResult } from './observation.js';
import type { VisibilityBound } from './visibilityBound.js';
import { observeCorrelation } from './observation.js';
import type { KillPointEvidence } from './evidence.js';
import type { I20ScenarioOperand } from './i20.js';

/**
 * `§11` — THE SIX-SCENARIO KILL-POINT DRIVER. THE PART THE INDEPENDENT REVIEW FOUND MISSING.
 *
 * =================================================================================
 * WHY THIS EXISTS NOW RATHER THAN "WHEN AN ACCOUNT EXISTS"
 *
 * The rejected S1P shipped the preflight, the adapter, the reader, the observation loop and
 * the evidence bundle, and then printed: "The scenario driver is NOT IMPLEMENTED — see the
 * operator procedure step 15." The review rejected the deferral in one sentence: **"The
 * provider account is required to EXECUTE it, not to WRITE it."**
 *
 * That is exactly right, and the consequence is that this module is written, compiled,
 * linted and FULLY EXERCISED OFFLINE, against deterministic doubles, with no provider call
 * anywhere. `tests/sendgrid/scenario-driver.test.ts` drives all six canonical points through
 * the ACCEPTED gateway, the ACCEPTED outbox, real forked runtimes and a deterministic
 * simulated provider, and asserts the measured rows against `KILL_POINT_ROWS`. The only thing
 * provisioning changes is WHICH module specifier the descriptors below name.
 *
 * =================================================================================
 * `§11.1` — THE NORMAL ACOS PATH, AND NOTHING SHORTER
 *
 * Every scenario traverses, in order:
 *
 *   1. the ISOLATED VALIDATION AUTHORITY seeder — one non-production `email.send` effect to
 *      an owner-controlled sink, with the sender, the sink, the subject and the body bound
 *      into the canonical dispatch payload (`validationAuthority.ts`);
 *   2. step R's IRRECOVERABLE unit reservation, which that commit performs;
 *   3. the DURABLE OUTBOX — `enqueueDispatch`, which mints `25 §7`'s correlation tag;
 *   4. `dispatchAuthorisedEffect` — the ACCEPTED Effect Gateway, unmodified;
 *   5. an `AdapterRuntimeDescriptor` THIS MODULE CONSTRUCTS;
 *   6. the ACCEPTED S1N integration runtime, forked, holding the send credential;
 *   7. the SendGrid integration adapter, invoked through that runtime;
 *   8. an `AuditReaderDescriptor` THIS MODULE CONSTRUCTS;
 *   9. the ACCEPTED S1O audit reader runtime, forked, holding the read credential;
 *  10. provider reads through the accepted audit IPC;
 *  11. recovery/re-entry through the SAME gateway entry point.
 *
 * `§11.1`'s two prohibitions are structural here: this module imports NEITHER provider client
 * and NEITHER adapter module. It cannot call `sendToProviderSendGrid` or
 * `readFromProviderSendGridActivity`, because it has no reference to either — it has a
 * DESCRIPTOR, which is a record of strings, and a LAUNCH PORT that turns one into a process.
 * `tests/sendgrid/scenario-driver.test.ts` asserts that import closure.
 *
 * =================================================================================
 * WHY THE LAUNCHERS AND THE STORE READERS ARE **PORTS**
 *
 * Forking the S1N runtime needs an `IntegrationClient`; forking the S1O runtime needs an
 * `AuditReadClient`; measuring committed local state needs direct SQL against the control
 * store. Those are properties of a COMPOSITION. A driver that built its own would be a second
 * composition root, and — more to the point — it could not then be exercised offline against
 * doubles, which is the whole requirement.
 *
 * So they arrive as injected functions, and what this module owns is the thing that must be
 * IDENTICAL offline and live: the ORDER of the steps, the TRIGGER for each kill point, the
 * RECOVERY attempt, the ORACLE it believes, and the VERDICT rule.
 *
 * =================================================================================
 * **NO ROW PASSES ON LOCAL EXPECTATIONS ALONE.** `§11.3`
 *
 * `verdictFor` requires the PROVIDER-SIDE count to match the row's expectation, and an
 * observation that produced no trustworthy count yields `UNRESOLVED` rather than `PASS` —
 * including for kill point 3, where the integration child exits deliberately. `§11.3`:
 * "Ensure the driver can distinguish an accepted send from a provider rejection and does not
 * declare the scenario PASS merely because the child exited."
 *
 * =================================================================================
 * AND **NO ROW PASSES ON A NEGATIVE THE PROVIDER CANNOT PROVE.** `§10.1`
 *
 * A row whose provider-side expectation is ZERO can only ever be met by NOT SEEING anything,
 * and `§10.1` forbids reading that as proof: "bounded non-observation is not automatically
 * proof of never-sent unless the accepted provider-reporting evidence actually supplies a
 * complete absence guarantee." Email Activity supplies none.
 *
 * So kill points 1 and 2 end `UNRESOLVED` even on a perfect run, and that is the honest
 * result rather than a shortcoming of the harness. **They can still FAIL** — a
 * zero-expectation row that shows an accepted message is caught — so the rows remain
 * controls; what they cannot do is certify a negative.
 *
 * Point 3, the row the whole slice exists for, is unaffected: its expectation is ONE,
 * positively observed, and that positive observation is exactly the discrimination a mock
 * cannot make.
 * =================================================================================
 */

/** Which module specifiers and locators this run's runtimes are launched from. */
export interface ScenarioRuntimeConfig {
  readonly adapterId: string;
  readonly providerId: string;

  readonly integrationRuntimeRoot: string;
  /** The ORDINARY adapter module. Points 1, 2, 4, 5 and 6 use it. */
  readonly integrationAdapterModule: string;
  /**
   * The KILL-POINT adapter module — a DIFFERENT specifier inside the same runtime root.
   *
   * `§11.3` point 3: "Integration child launched with the dedicated kill-point adapter
   * module. Do not add a control-message kill flag." The dispatch wire carries no control
   * member and this driver adds none; the behaviour rides on the runtime's own launch
   * configuration, which is the accepted `tests/integration-plane/adapterA/` pattern.
   */
  readonly integrationKillPointAdapterModule: string;
  readonly integrationSecretSourceModule: string;
  readonly integrationSecretLocator: string;
  /** `50 §2g` field 1 — the EXACT expected identity, from the trusted configuration. */
  readonly integrationCredentialId: string;

  readonly auditRuntimeRoot: string;
  readonly auditReaderModule: string;
  readonly auditSecretSourceModule: string;
  readonly auditSecretLocator: string;
  readonly auditCredentialId: string;
}

/** One launched integration runtime, as the driver needs it. */
export interface LaunchedIntegrationRuntime {
  /** The gateway registry this runtime's proxy is resolved out of. */
  readonly registry: AdapterRegistry;
  close(): Promise<void>;
}

/** One launched audit reader, as the driver needs it. */
export interface LaunchedAuditRuntime {
  /** ONE period-bounded, correlation-narrowed read through the accepted audit IPC. */
  readonly read: ObservationDeps['read'];
  close(): Promise<void>;
}

/** The committed local state one scenario left behind. Read by DIRECT SQL, never by a helper. */
export interface LocalScenarioState {
  readonly outboxStatus: string | null;
  readonly outcomeRows: number;
  /** The kernel's own record of whether the invocation may have crossed the boundary. */
  readonly mayHaveCrossedProviderBoundary: boolean | null;
  /** The provider's message id from the send response, where the outcome recorded one. */
  readonly providerResponseMessageId: string | null;
  /** The effect's ACOS state at the end of the scenario. */
  readonly finalEffectState: string | null;
}

/** Everything the driver cannot build for itself. */
export interface ScenarioPorts {
  readonly authority: S1PValidationAuthority;
  /** The verified non-production sender and the owner-controlled sink, from configuration. */
  readonly senderAddress: string;
  readonly sinkAddress: string;

  /** `25 §7`'s durable pre-dispatch row. The ACCEPTED `enqueueDispatch`, wired by the caller. */
  readonly enqueue: (input: {
    readonly effectId: string;
    readonly outboxId: string;
    readonly payloadCanonicalBytes: Buffer;
    readonly now: Date;
  }) => Promise<void>;
  /** The correlation tag the KERNEL minted at enqueue. Read back, never computed here. */
  readonly correlationTagFor: (idempotencyKey: string) => Promise<string>;

  readonly dispatchEnvironmentFor: (registry: AdapterRegistry) => DispatchEnvironment;
  readonly launchIntegration: (
    descriptor: AdapterRuntimeDescriptor,
  ) => Promise<LaunchedIntegrationRuntime>;
  readonly launchAuditReader: (
    descriptor: AuditReaderDescriptor,
  ) => Promise<LaunchedAuditRuntime>;

  readonly localStateFor: (idempotencyKey: string) => Promise<LocalScenarioState>;
  /**
   * `I20`'s DENOMINATOR for one effect — the sum of the committed
   * `reservation_window_instance.irrecoverable_units` rows its authorisation wrote.
   *
   * The IMMUTABLE HISTORICAL basis, never the live `reserved_irrecoverable` column. See
   * `i20.ts`, and `phase2-v1.3.5-errata.md §1` behind it.
   */
  readonly reservationUnitsFor: (effectId: string) => Promise<bigint>;

  readonly companyId: string;
  readonly now: () => Date;
  /** The clock the RECOVERY attempt runs at. A later instant, as the accepted matrix uses. */
  readonly recoveryAt: () => Date;
  /** Injected so the offline suite drives observation without waiting. */
  readonly delay: (ms: number) => Promise<void>;
  readonly nowMs: () => number;
  readonly observationWindow: () => {
    readonly periodStartMs: number;
    readonly periodEndMs: number;
  };
  readonly observationBound: {
    readonly maxAttempts: number;
    readonly intervalMs: number;
    readonly maxDurationMs: number;
    readonly maxRecords: number;
    readonly stabilisationObservations: number;
  };
  /**
   * `§4.1` — WHAT MAKES "NO LATER RECORD APPEARED" MEAN ANYTHING FOR THIS RUN.
   *
   * `FIXTURE_DETERMINISTIC` offline; `SENDGRID_LIVE_VISIBILITY_BOUND` — which is
   * `UNESTABLISHED` — live. Injected rather than imported so the driver cannot quietly assume
   * a provider guarantee it does not have.
   */
  readonly visibilityBound: VisibilityBound;
}

/** One scenario's measured result, with everything an evidence row and `I20` need. */
export interface ScenarioResult {
  readonly row: KillPointEvidence;
  readonly i20Operand: I20ScenarioOperand;
  /** How many provider operations this scenario performed. One per dispatch that crossed. */
  readonly providerOperationCount: number;
}

/**
 * Build the integration descriptor for one scenario.
 *
 * `§11.1` item 5, and test 14's property: the driver CONSTRUCTS a descriptor rather than
 * calling a provider module. Point 3 is the ONLY row that names the kill-point specifier, and
 * it names a DIFFERENT MODULE rather than setting a flag.
 */
export function integrationDescriptorFor(
  runtime: ScenarioRuntimeConfig,
  point: KillPointRow['point'],
): AdapterRuntimeDescriptor {
  return {
    adapterId: runtime.adapterId,
    credentialId: runtime.integrationCredentialId,
    runtimeRoot: runtime.integrationRuntimeRoot,
    adapterModule:
      point === 3 ? runtime.integrationKillPointAdapterModule : runtime.integrationAdapterModule,
    secretSourceModule: runtime.integrationSecretSourceModule,
    secretLocator: runtime.integrationSecretLocator,
    /*
     * `25 §7`'s EM6 criterion, declared per adapter.
     *
     * `QUERYABLE_MESSAGE_LOG` is the honest primitive for this provider: Email Activity is a
     * queryable log of accepted messages, which is what S1O's capability record established
     * and what the audit reader queries. It is a DECLARATION and `36 §7` requires such a claim
     * to be measured against the vendor — which is what the capability probes do, and which
     * is why a probe disagreeing with this declaration blocks the scenario matrix.
     */
    resolutionCapabilities: ['QUERYABLE_MESSAGE_LOG'],
  };
}

/** Build the audit reader descriptor. `§11.1` item 8. */
export function auditDescriptorFor(runtime: ScenarioRuntimeConfig): AuditReaderDescriptor {
  return {
    providerId: runtime.providerId,
    credentialId: runtime.auditCredentialId,
    runtimeRoot: runtime.auditRuntimeRoot,
    readerModule: runtime.auditReaderModule,
    secretSourceModule: runtime.auditSecretSourceModule,
    secretLocator: runtime.auditSecretLocator,
  };
}

/**
 * The hook that produces each CONTROL-PLANE kill point.
 *
 * Points 1, 2, 4 and 5 are `DispatchHooks` members — the canonical positions
 * `mock-kill-matrix.test.ts` uses and `effectGateway.ts` declares. Point 3 is NOT here: it
 * happens inside the integration child and is produced by the adapter module specifier.
 * Point 6 is not here either: it is the re-entry every row already performs.
 */
export function hooksFor(point: KillPointRow['point']): DispatchHooks | undefined {
  const kill = (): Promise<never> =>
    Promise.reject(new Error(`S1P kill point ${String(point)}`));
  switch (point) {
    case 1:
      return { afterClaimLock: kill };
    case 2:
      return { afterClaimCommit: kill };
    case 4:
      return { beforeOutcomeCommit: kill };
    case 5:
      return { afterOutcomeCommit: kill };
    default:
      return undefined;
  }
}

/** The verdict rule. NO ROW PASSES ON LOCAL EXPECTATIONS ALONE. */
export function verdictFor(input: {
  readonly row: KillPointRow;
  readonly localOutboxStatus: string | null;
  readonly localOutcomeRows: number;
  readonly recovery: string;
  readonly observationBefore: ObservationResult | null;
  readonly observationAfter: ObservationResult | null;
}): { readonly verdict: KillPointEvidence['verdict']; readonly note: string } {
  const before = input.observationBefore;
  const after = input.observationAfter;

  if (before === null || after === null) {
    return { verdict: 'NOT_RUN', note: 'no provider observation was attempted for this row' };
  }
  /*
   * AN UNTRUSTWORTHY COUNT IS `UNRESOLVED`, NEVER A PASS AND NEVER A FAIL.
   *
   * `KILL_POINT_CONCLUSION_LIMITS`'s fourth entry states the rule and correction 10 supplies
   * the second case: a stabilisation window that did not complete leaves a count that cannot
   * be trusted, and `observeCorrelation` reports `null` for exactly that reason.
   */
  if (before.providerAcceptedCount === null || after.providerAcceptedCount === null) {
    return {
      verdict: 'UNRESOLVED',
      note:
        `the provider-side accepted count was not established (before: ${before.outcome}, ` +
        `after recovery: ${after.outcome}); provider latency, a refused read and a message ` +
        'that never left read identically, so this row is neither passed nor failed',
    };
  }

  /*
   * THE LOCAL EXPECTATION IS THE **SEPARATE-PROCESS** ONE WHERE THE ROW DECLARES ONE.
   *
   * Exactly one row does: kill point 3, where the integration child dies and the CONTROL plane
   * survives to commit `§41`'s `OUTCOME_UNKNOWN`. The mock matrix's zero is kept in
   * `expectedOutcomeRows` and is NOT overwritten, so a reader of `KILL_POINT_ROWS` sees both
   * numbers and the reason the two compositions differ.
   */
  const expectedOutcomeRows =
    input.row.expectedOutcomeRowsInSeparateProcessComposition ?? input.row.expectedOutcomeRows;
  const localAgrees =
    input.localOutboxStatus === input.row.expectedOutboxStatus &&
    input.localOutcomeRows === expectedOutcomeRows &&
    input.recovery === input.row.expectedRecovery;
  const measured = `measured outbox ${input.localOutboxStatus ?? 'ABSENT'}/` +
    `${String(input.localOutcomeRows)}, recovery ${input.recovery}, provider count ` +
    `${String(before.providerAcceptedCount)} then ${String(after.providerAcceptedCount)}`;

  if (!localAgrees) {
    return {
      verdict: 'FAIL',
      note:
        `expected outbox ${input.row.expectedOutboxStatus}/${String(expectedOutcomeRows)} ` +
        `outcome row(s) and recovery ${input.row.expectedRecovery}; ${measured}`,
    };
  }

  /*
   * `§10.1` — **A SHORTFALL IS ONLY A FAILURE WHEN THE PROVIDER POSITIVELY SHOWED ONE.**
   *
   * Two directions, and the architecture treats them differently:
   *
   *   AN EXCESS — the provider accepted MORE than the row expects — is a FAILURE whichever
   *     observation produced it. An extra message is a POSITIVE observation, and it is exactly
   *     the condition `I36` exists to exclude.
   *
   *   A SHORTFALL — fewer than expected — is a failure only if the provider ANSWERED and still
   *     held fewer. If the count is short because the correlation never became visible within
   *     the bound, that is `NOT_OBSERVED_WITHIN_BOUND`, and `§10.1` forbids reading it as
   *     proof: "bounded non-observation is not automatically proof of never-sent unless the
   *     accepted provider-reporting evidence actually supplies a complete absence guarantee."
   *     Email Activity supplies none, so the row is UNRESOLVED.
   *
   * `KILL_POINT_CONCLUSION_LIMITS`'s fourth entry states the same rule, and this is where it
   * is ENFORCED rather than merely printed.
   */
  const excess =
    before.providerAcceptedCount > input.row.expectedProviderAcceptedCount ||
    after.providerAcceptedCount > input.row.expectedProviderAcceptedCountAfterRecovery;
  if (excess) {
    return {
      verdict: 'FAIL',
      note:
        'the provider accepted MORE messages than the canonical expectation — expected ' +
        `${String(input.row.expectedProviderAcceptedCount)} then ` +
        `${String(input.row.expectedProviderAcceptedCountAfterRecovery)}; ${measured}`,
    };
  }

  const shortfall =
    before.providerAcceptedCount < input.row.expectedProviderAcceptedCount ||
    after.providerAcceptedCount < input.row.expectedProviderAcceptedCountAfterRecovery;
  if (shortfall) {
    const observedShortfall =
      (before.providerAcceptedCount < input.row.expectedProviderAcceptedCount &&
        before.outcome === 'PROVIDER_ACTIVITY_OBSERVED') ||
      (after.providerAcceptedCount < input.row.expectedProviderAcceptedCountAfterRecovery &&
        after.outcome === 'PROVIDER_ACTIVITY_OBSERVED');
    return observedShortfall
      ? {
          verdict: 'FAIL',
          note:
            'the provider ANSWERED and held fewer accepted messages than the canonical ' +
            `expectation — expected ${String(input.row.expectedProviderAcceptedCount)} then ` +
            `${String(input.row.expectedProviderAcceptedCountAfterRecovery)}; ${measured}`,
        }
      : {
          verdict: 'UNRESOLVED',
          note:
            'the correlation did not become visible within the bound, so the expected ' +
            'accepted message was not observed. Provider latency and a message that never ' +
            `left read identically, so this row is neither passed nor failed; ${measured}`,
        };
  }

  /*
   * `§10.1` — **BOUNDED NON-OBSERVATION IS NOT PROOF OF NEVER-SENT, SO IT CANNOT PASS A ROW.**
   *
   * `§10.1`: "For scenarios expecting zero, preserve the architecture's uncertainty rule:
   * bounded non-observation is not automatically proof of never-sent unless the accepted
   * provider-reporting evidence actually supplies a complete absence guarantee."
   *
   * SendGrid's Email Activity supplies none, and `KILL_POINT_CONCLUSION_LIMITS` already says
   * what follows: "NOT_OBSERVED_WITHIN_BOUND on any row leaves that row UNRESOLVED rather than
   * passing or failing it — provider latency and a message that never left read identically."
   * This branch is that limit, enforced rather than merely printed.
   *
   * **THE ROW CAN STILL FAIL, AND THAT IS WHAT KEEPS IT A CONTROL.** A zero-expectation row
   * whose provider count came back as ONE is caught by the EXCESS branch above. What this
   * branch refuses is the opposite direction: reporting "the provider held nothing" as PROOF
   * that nothing was accepted.
   *
   * CONSEQUENCE, STATED: kill points 1 and 2 can never reach PASS, even on a perfect live run,
   * because each carries a zero expectation that only a non-observation can meet. Point 3 —
   * the row the whole slice exists for — is unaffected: its expectation is ONE, positively
   * observed, which is exactly the discrimination a mock cannot make.
   */
  const zeroRestingOnNonObservation =
    (input.row.expectedProviderAcceptedCount === 0 &&
      before.outcome === 'NOT_OBSERVED_WITHIN_BOUND') ||
    (input.row.expectedProviderAcceptedCountAfterRecovery === 0 &&
      after.outcome === 'NOT_OBSERVED_WITHIN_BOUND');

  if (zeroRestingOnNonObservation) {
    return {
      verdict: 'UNRESOLVED',
      note:
        'every local expectation was met and no provider-accepted message was observed, but ' +
        'this row expects a provider-side count of ZERO and a bounded non-observation is not ' +
        'proof of never-sent: provider latency and a message that never left read identically. ' +
        'The row is neither passed nor failed',
    };
  }

  /*
   * `§4.1`, `§4.3` — **A NO-DUPLICATE PASS NEEDS AN EVIDENCE-BACKED VISIBILITY BOUND.**
   *
   * Everything above has agreed: local state matches, the counts match, and every non-zero
   * count was positively observed. What remains is the claim the row is really making — that
   * NO FURTHER accepted message appeared after the recovery — and that claim rests entirely on
   * how long the oracle waited relative to the last possible write.
   *
   * Second review `§4.3`: the live rule requires BOTH "required successful samples; AND
   * completion of the evidence-backed provider visibility/completeness interval after the last
   * possible write". `observeCorrelation` reports whether the second condition held, and it can
   * only hold for a `MEASURED_INTERVAL` bound.
   *
   * **FOR SENDGRID TODAY IT NEVER HOLDS** — `SENDGRID_LIVE_VISIBILITY_BOUND` is `UNESTABLISHED`
   * because the accepted S1O research documents no reporting-lag guarantee and no empirical
   * measurement exists. `§4.1`: "If no sufficient SendGrid bound is currently established: the
   * live count may be observed, but a no-duplicate PASS remains UNRESOLVED. This is acceptable
   * and honest."
   *
   * **THE FIXTURE MODE IS EXEMPT, AND LABELLED.** Offline, the simulated account is a file this
   * process controls, so the absence of a later record is determinate rather than a provider
   * claim — `§4.4` permits deterministic fixture timing provided the evidence says it is
   * offline, which `observationModeLabel` does.
   *
   * **AN EXCESS IS STILL A FAIL**, above, and needs no bound: seeing a second message proves
   * one exists whatever the visibility guarantee. The asymmetry is preserved exactly as it is
   * for `I8`.
   */
  const liveAbsenceSettled =
    after.visibilityBoundKind === 'FIXTURE_DETERMINISTIC' || after.settlingIntervalCompleted;
  if (!liveAbsenceSettled) {
    return {
      verdict: 'UNRESOLVED',
      note:
        'local state and the observed provider counts both match the canonical expectation, ' +
        'but this row asserts that NO FURTHER accepted message appeared after the recovery, ' +
        'and no evidence-backed provider visibility bound establishes how long that takes ' +
        `(bound: ${after.visibilityBoundKind}). Two stable samples is an S1P fixture rule, not ` +
        'a SendGrid guarantee, so the count is reported and the no-duplicate conclusion is ' +
        'withheld',
    };
  }
  return {
    verdict: 'PASS',
    note:
      `local state and the provider's own accepted count both match the canonical ` +
      `expectation (${String(input.row.expectedProviderAcceptedCount)} before recovery, ` +
      `${String(input.row.expectedProviderAcceptedCountAfterRecovery)} after), and every ` +
      'non-zero count was POSITIVELY OBSERVED rather than inferred from an absence',
  };
}

/** Run ONE canonical kill-point scenario, end to end, through the accepted path. */
export async function runScenario(
  runtime: ScenarioRuntimeConfig,
  ports: ScenarioPorts,
  row: KillPointRow,
): Promise<ScenarioResult> {
  const scenarioLabel = `kill-point-${String(row.point)}`;
  const resourceId = `S1P-${scenarioLabel}-${String(ports.nowMs())}`;

  // 1 and 2 — THE ISOLATED VALIDATION AUTHORITY, and step R's reservation inside its commit.
  const seeded = await ports.authority.authoriseValidationEmail({
    scenarioLabel,
    senderAddress: ports.senderAddress,
    sinkAddress: ports.sinkAddress,
    resourceId,
    taskId: `task:S1P-${scenarioLabel}`,
  });
  if (seeded.kind === 'REFUSED') {
    return {
      row: notRunRow(row, scenarioLabel, `the validation authority refused: ${seeded.reason}`),
      i20Operand: {
        scenarioLabel,
        providerAcceptedCount: null,
        historicalReservationUnits: 0n,
      },
      providerOperationCount: 0,
    };
  }
  const effect = seeded.effect;

  // 3 — THE DURABLE OUTBOX. The correlation tag is the KERNEL's, read back from the row.
  await ports.enqueue({
    effectId: effect.effectId,
    outboxId: `outbox:${scenarioLabel}:${resourceId}`,
    payloadCanonicalBytes: effect.payloadCanonicalBytes,
    now: ports.now(),
  });
  const correlationTag = await ports.correlationTagFor(effect.idempotencyKey);

  // 5, 6 and 7 — THE DESCRIPTOR, THE FORKED RUNTIME, THE ADAPTER BEHIND IT.
  const integration = await ports.launchIntegration(integrationDescriptorFor(runtime, row.point));
  // 8 and 9 — THE AUDIT DESCRIPTOR AND ITS OWN, SEPARATE, FORKED RUNTIME.
  const audit = await ports.launchAuditReader(auditDescriptorFor(runtime));

  let providerOperationCount = 0;
  try {
    const environment = ports.dispatchEnvironmentFor(integration.registry);

    // 4 — THE ACCEPTED EFFECT GATEWAY. Unmodified, and the ONLY dispatch entry point used.
    const first = dispatchAuthorisedEffect(
      environment,
      {
        companyId: ports.companyId,
        idempotencyKey: effect.idempotencyKey,
        dispatchedBy: `worker:s1p-${scenarioLabel}`,
        now: ports.now(),
      },
      (() => {
        const hooks = hooksFor(row.point);
        return hooks === undefined ? undefined : { hooks };
      })(),
    );
    /*
     * EVERY KILL POINT EXCEPT 6 ENDS THE FIRST DISPATCH ABNORMALLY.
     *
     * Points 1, 2, 4 and 5 reject from their hook; point 3's integration child EXITS, which
     * the accepted `IntegrationClient` surfaces as a failure of the invocation. The rejection
     * is caught and discarded rather than read: the state that matters is what COMMITTED, and
     * that is measured from the control store below.
     */
    await first.catch(() => undefined);

    const afterKill = await ports.localStateFor(effect.idempotencyKey);

    const window = ports.observationWindow();
    const deps: ObservationDeps = {
      read: audit.read,
      delay: ports.delay,
      now: ports.nowMs,
    };
    /*
     * `§4.2` — THE SETTLING WINDOW BEGINS AT THE LAST POSSIBLE WRITE.
     *
     * For this FIRST observation the last possible write is the dispatch that just returned,
     * so the interval is measured from here.
     */
    const firstWriteAtMs = ports.nowMs();
    const observationBefore = await observeCorrelation(deps, {
      correlationTag,
      periodStartMs: window.periodStartMs,
      periodEndMs: window.periodEndMs,
      ...ports.observationBound,
      visibilityBound: ports.visibilityBound,
      lastPossibleWriteAtMs: firstWriteAtMs,
    });

    // 11 — RECOVERY/RE-ENTRY, THROUGH THE SAME GATEWAY ENTRY POINT. KILL POINT 6.
    const recovery = await dispatchAuthorisedEffect(environment, {
      companyId: ports.companyId,
      idempotencyKey: effect.idempotencyKey,
      dispatchedBy: `worker:s1p-${scenarioLabel}-recovered`,
      now: ports.recoveryAt(),
    });
    /*
     * `§4.2` — THE INSTANT THE LAST POSSIBLE WRITE COULD HAVE HAPPENED.
     *
     * Taken AFTER the recovery returns, because a recovery that dispatched (kill point 1) may
     * have written right up to this moment. Anything earlier would start the settling clock
     * before the action under test had finished.
     */
    const recoveryAtMs = ports.nowMs();
    const recoveryLabel =
      recovery.kind === 'CLAIM_REFUSED' ? `CLAIM_REFUSED:${recovery.reason}` : recovery.kind;

    const afterRecovery = await ports.localStateFor(effect.idempotencyKey);

    /*
     * `§4.2`, AND THIS IS THE ONE THAT MATTERS.
     *
     * The FINAL observation's settling interval begins at the RECOVERY / RE-ENTRY ATTEMPT —
     * the last possible write in this scenario and the very action the row exists to test.
     *
     * The failure `§4.2` names is precise: "initial send becomes visible / stabilization
     * completes / recovery occurs / duplicate appears afterward" — and the oracle would have
     * certified before the recovery had a chance to produce anything. Measuring from
     * `recoveryAtMs` closes it, because the window cannot end until the interval has run from
     * the last thing that could have written.
     */
    const observationAfter = await observeCorrelation(deps, {
      correlationTag,
      periodStartMs: window.periodStartMs,
      periodEndMs: window.periodEndMs,
      ...ports.observationBound,
      visibilityBound: ports.visibilityBound,
      lastPossibleWriteAtMs: recoveryAtMs,
    });

    /*
     * THE PROVIDER-OPERATION COUNT IS THE **PROVIDER'S**, NOT A LOCAL TALLY.
     *
     * `§10` and `§14` are both explicit that a local invocation count is not the operand.
     * The evidence bundle's `providerOperationCount` therefore comes from the distinct
     * message ids the independent audit read observed, so a scenario whose dispatch crossed
     * the boundary and produced no observable message contributes nothing to it — which is
     * the honest reading and the one a reviewer can check against the account.
     */
    providerOperationCount = observationAfter.providerMessageIds.length;

    const { verdict, note } = verdictFor({
      row,
      localOutboxStatus: afterKill.outboxStatus,
      localOutcomeRows: afterKill.outcomeRows,
      recovery: recoveryLabel,
      observationBefore,
      observationAfter,
    });

    return {
      row: Object.freeze({
        point: row.point,
        killPointName: row.name,
        correlationTag,
        expectedSemantics: row.rationale,
        localOutboxStatus: afterKill.outboxStatus,
        localOutcomeRows: afterKill.outcomeRows,
        mayHaveCrossedProviderBoundary: afterKill.mayHaveCrossedProviderBoundary,
        providerResponseMessageId: afterKill.providerResponseMessageId,
        observation: observationAfter,
        providerAcceptedCount: observationAfter.providerAcceptedCount,
        recovery: recoveryLabel,
        /*
         * `§22`'s ONE PRODUCTION PROPERTY, MEASURED AGAINST THE PROVIDER RATHER THAN A MOCK.
         *
         * A redispatch of an already-CLAIMED effect would show as the provider's own count
         * INCREASING across the recovery, so the flag is derived from the two observations
         * rather than from a local call counter. Point 1 is the legitimate exception the
         * accepted matrix names: nothing was claimed, so the recovery is a FIRST claim.
         */
        redispatchOccurred:
          observationBefore.providerAcceptedCount === null ||
          observationAfter.providerAcceptedCount === null
            ? null
            : row.point !== 1 &&
              observationAfter.providerAcceptedCount > observationBefore.providerAcceptedCount,
        finalEffectState: afterRecovery.finalEffectState,
        verdict,
        note,
      }),
      i20Operand: {
        scenarioLabel,
        providerAcceptedCount: observationAfter.providerAcceptedCount,
        historicalReservationUnits: await ports.reservationUnitsFor(effect.effectId),
      },
      providerOperationCount,
    };
  } finally {
    await integration.close();
    await audit.close();
  }
}

/** A row for a scenario that did not run. NEVER a pass. */
function notRunRow(row: KillPointRow, correlationTag: string, note: string): KillPointEvidence {
  return Object.freeze({
    point: row.point,
    killPointName: row.name,
    correlationTag,
    expectedSemantics: row.rationale,
    localOutboxStatus: null,
    localOutcomeRows: null,
    mayHaveCrossedProviderBoundary: null,
    providerResponseMessageId: null,
    observation: null,
    providerAcceptedCount: null,
    recovery: null,
    redispatchOccurred: null,
    finalEffectState: null,
    verdict: 'NOT_RUN' as const,
    note,
  });
}

/**
 * KILL POINT 6 IS **DERIVED**, NOT DRIVEN — AND THAT IS WHAT THE ACCEPTED MATRIX DOES.
 *
 * `§9`'s canonical point 6 is "re-entry, at every point", and
 * `mock-kill-matrix.test.ts` measures it by re-entering at each of points 2 to 5 rather than
 * by staging a sixth independent scenario. `§11.3` restates it: "Re-entry/recovery against
 * points 2–5, using the normal gateway path, with provider accepted count stable after the
 * recovery attempt."
 *
 * So there is no sixth dispatch. Every scenario ALREADY performs a recovery through the same
 * gateway entry point, and this function reads the four that matter and states the one
 * production property `§22` names: **no recovery path produced a second provider-accepted
 * message for an already-CLAIMED effect.**
 *
 * Staging a sixth scenario would have meant a row whose first dispatch succeeded and whose
 * "re-entry" was the only interesting part — which is points 2 to 5 with extra steps, and
 * which would have reported a local outcome row that `KILL_POINT_ROWS`' row 6 does not expect.
 */
export function derivePointSixRow(
  results: readonly ScenarioResult[],
): { readonly row: KillPointEvidence; readonly i20Operand: I20ScenarioOperand } {
  const canonical = KILL_POINT_ROWS.find((entry) => entry.point === 6)!;
  const reEntryRows = results.filter(
    (result) => result.row.point >= 2 && result.row.point <= 5,
  );

  const measured = reEntryRows.filter((result) => result.row.providerAcceptedCount !== null);
  const anyUnresolved = reEntryRows.length !== measured.length || reEntryRows.length === 0;
  const everyRecoveryRefused = reEntryRows.every(
    (result) => result.row.recovery === 'CLAIM_REFUSED:ALREADY_CLAIMED',
  );
  const noRedispatch = reEntryRows.every((result) => result.row.redispatchOccurred === false);

  const verdict: KillPointEvidence['verdict'] = anyUnresolved
    ? 'UNRESOLVED'
    : everyRecoveryRefused && noRedispatch
      ? 'PASS'
      : 'FAIL';

  return {
    row: Object.freeze({
      point: 6 as const,
      killPointName: canonical.name,
      correlationTag: reEntryRows.map((result) => result.row.correlationTag).join(','),
      expectedSemantics: canonical.rationale,
      localOutboxStatus: null,
      localOutcomeRows: null,
      mayHaveCrossedProviderBoundary: null,
      providerResponseMessageId: null,
      observation: null,
      providerAcceptedCount: null,
      recovery: everyRecoveryRefused ? 'CLAIM_REFUSED:ALREADY_CLAIMED' : 'MIXED',
      redispatchOccurred: anyUnresolved ? null : !noRedispatch,
      finalEffectState: null,
      verdict,
      note: anyUnresolved
        ? 'at least one of points 2 to 5 produced no trustworthy provider count, so the ' +
          're-entry property could not be evaluated against the provider'
        : verdict === 'PASS'
          ? 'across points 2 to 5, every re-entry through the accepted gateway was refused ' +
            'ALREADY_CLAIMED and the provider-side accepted count was unchanged by the ' +
            'recovery attempt. **THIS PROPERTY IS CHECKABLE IN ITS FAILING DIRECTION**, which ' +
            'is why it may PASS where a zero-expectation row may not: an INCREASE would be a ' +
            'positive observation, so a bounded non-observation cannot conceal one'
          : 'at least one re-entry was not refused, or the provider-side count increased ' +
            'across a recovery for an already-CLAIMED effect',
    }),
    i20Operand: {
      scenarioLabel: 'kill-point-6',
      /*
       * POINT 6 CONTRIBUTES NO NUMERATOR AND NO DENOMINATOR.
       *
       * It stages no effect of its own, so it reserves nothing and the provider accepts
       * nothing for it. Reporting a `null` count here would make `I20` UNRESOLVED on every
       * run, so it contributes a MEASURED ZERO against a ZERO basis — which is the honest
       * arithmetic for a row that authorised nothing.
       */
      providerAcceptedCount: 0,
      historicalReservationUnits: 0n,
    },
  };
}

/**
 * Run ALL SIX canonical points: five staged scenarios in canonical order, then the derived
 * re-entry row.
 */
export async function runAllScenarios(
  runtime: ScenarioRuntimeConfig,
  ports: ScenarioPorts,
): Promise<readonly ScenarioResult[]> {
  const results: ScenarioResult[] = [];
  for (const row of KILL_POINT_ROWS) {
    if (row.point === 6) continue;
    results.push(await runScenario(runtime, ports, row));
  }
  const derived = derivePointSixRow(results);
  results.push({
    row: derived.row,
    i20Operand: derived.i20Operand,
    providerOperationCount: 0,
  });
  return Object.freeze(results);
}
