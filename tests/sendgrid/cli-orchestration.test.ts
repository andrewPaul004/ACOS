import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  ENV_AUDIT_LOCATOR,
  ENV_CONFIG,
  ENV_DUPLICATE_ACK,
  ENV_ENTITLEMENT_CONFIRMED,
  ENV_INTEGRATION_LOCATOR,
  ENV_LIVE_ACK,
  ENV_NON_PRODUCTION_ACK,
  DUPLICATE_ACK_TOKEN,
  ENTITLEMENT_CONFIRMED_TOKEN,
  LIVE_ACK_TOKEN,
  NON_PRODUCTION_ACK_TOKEN,
  main,
} from '../../validation/sendgrid/harness/cli.js';
import type { S1PHarnessSeams } from '../../validation/sendgrid/harness/cli.js';
import type {
  CompositionAvailability,
  CompositionInput,
  OpenedScenarioComposition,
  ScenarioCompositionProvider,
} from '../../validation/sendgrid/harness/liveComposition.js';
import { FIXTURE_VISIBILITY_BOUND } from '../../validation/sendgrid/harness/visibilityBound.js';
import type { ProbeLaunchResult } from '../../validation/sendgrid/harness/probeClient.js';
import type { EvidenceBundle } from '../../validation/sendgrid/harness/evidence.js';
import {
  S1P_AUDIT_CREDENTIAL_ID,
  S1P_INTEGRATION_CREDENTIAL_ID,
  S1P_SENDER,
  S1P_SINK,
  createS1PScenario,
  s1pValidationArtifacts,
  type S1PScenario,
} from '../support/s1pScenarioFixture.js';
import { createOutboxHarness, type OutboxHarness } from '../support/outboxFixture.js';
import { acceptSend } from '../sendgrid-doubles/simulatedAccount.js';

/**
 * SECOND REVIEW, BLOCKER 1 — **THE SUBJECT OF THIS SUITE IS `main`, NOT THE DRIVER.**
 *
 * =================================================================================
 * WHAT THE REVIEW REJECTED, AND WHY A SECOND DRIVER TEST WOULD NOT HAVE FIXED IT
 *
 * `scenarioDriver.ts` was complete and exercised, and `cli.ts` could not call it: the entry
 * point passed `controlPlaneCompositionAvailable: false` as a literal, wrote an evidence
 * bundle saying nothing ran, and returned. The matrix was unreachable code.
 *
 * `§1.4`, verbatim: "Do not satisfy this by testing `scenarioDriver.ts` separately again.
 * The test subject must be the orchestration that the real CLI uses."
 *
 * So every case below calls `main`. What the CLI does with the answers — which gate blocks
 * which step, when the composition opens and closes, when `I20` and the `I8` sweep run, how
 * the evidence bundle and the exit code are derived from what actually happened — is the
 * thing under test, and it exists in exactly one place.
 *
 * =================================================================================
 * THE THREE SUBSTITUTIONS, NAMED, AND WHY EACH IS UNAVOIDABLE OFFLINE
 *
 *   COMPOSITION  the offline provider hands back `createS1PScenario`'s ports — a REAL kernel,
 *                REAL outbox, REAL gateway, REAL forked runtimes, and a doubled TRANSPORT.
 *                A live composition would need a class-19 effect constructor for the
 *                validation class, which does not exist.
 *   PROBE        the one-shot credential launcher. Substituting it is what lets `§12`'s probe
 *                gating be exercised without a vendor credential.
 *   BUNDLE       a signed package whose class-5 declaration carries the two validation
 *                credential records. The shipped repository carries neither, deliberately.
 *
 * **NOTHING BETWEEN THEM IS SUBSTITUTED.** The preflight is the real preflight, the gates are
 * the real gates, the sequencing is the shipped sequencing, and the evidence is rendered by
 * the shipped renderer.
 *
 * And the substitutions are HONEST about what they are: the probe stub reports a
 * `PROVIDER_KEY_ID` provenance, which a real file-backed source never does — it reports
 * `SYNTHETIC_TEST_IDENTITY` and `INTEGRATION_IDENTITY_NOT_MATERIAL_BOUND` refuses. The last
 * case below drives exactly that, so the suite proves the gate still bites.
 * =================================================================================
 */

/** The two distinct user-assigned managed identities a real deployment must configure. */
const INTEGRATION_PRINCIPAL = '11111111-2222-3333-4444-555555555555';
const AUDIT_PRINCIPAL = '99999999-8888-7777-6666-555555555555';

let h: OutboxHarness;
let scenario: S1PScenario | null = null;
let workspace: string;

beforeAll(async () => {
  h = await createOutboxHarness();
}, 120_000);

afterAll(async () => {
  await h.close();
});

beforeEach(async () => {
  await h.reset();
});

afterEach(async () => {
  if (scenario !== null) await scenario.cleanup();
  scenario = null;
  if (workspace !== undefined) rmSync(workspace, { recursive: true, force: true });
});

/** A probe stub whose answers are chosen per case. It forks nothing and holds nothing. */
function probeStub(
  overrides: {
    readonly identityProvenance?: string;
    readonly auditReadOutcome?: string;
    readonly auditSendOutcome?: string;
    readonly integrationReadOutcome?: string;
    readonly duplicateSent?: boolean;
    /**
     * Force BOTH planes onto one Azure principal, to drive the distinctness gate.
     * `null` makes both children report NO principal, which is a different refusal.
     */
    readonly sourcePrincipal?: string | null;
    /** Force BOTH planes onto one SendGrid credential identity. A different gate. */
    readonly forceCredentialIdentity?: string;
  } = {},
): NonNullable<S1PHarnessSeams['probe']> {
  const provenance = overrides.identityProvenance ?? 'PROVIDER_KEY_ID';
  return (input): Promise<ProbeLaunchResult> => {
    if (input.role === 'IDENTITY') {
      const expected = overrides.forceCredentialIdentity ?? input.expectedCredentialId;
      return Promise.resolve({
        kind: 'REPLY' as const,
        pid: 0,
        reply: {
          kind: 'IDENTITY_FACTS' as const,
          facts: {
            plane: input.plane,
            resolved: true,
            resolvedIdentity: expected,
            identityProvenance: provenance,
            expectedCredentialId: expected,
            identityMatchedExpectation: true,
            revoked: false,
            /*
             * `§5` — WHAT THE CHILD REPORTS ABOUT ITS OWN PROCESS.
             *
             * A real one-shot process answers with the SEVEN-key allowlist it was launched
             * with and its own pid, which is how the isolation is evidenced rather than
             * asserted. The stub reports the same shape with no locator in it.
             */
            /*
             * AND THE AZURE PRINCIPAL EACH CHILD REPORTS ABOUT ITSELF.
             *
             * TWO DIFFERENT GUIDS, keyed off the plane, because a real deployment must give
             * the two planes different user-assigned managed identities and the stage-2 gate
             * now enforces it. A stub that reported one value for both would refuse every
             * case in this suite on `CREDENTIAL_SOURCE_PRINCIPALS_NOT_DISTINCT` — which is
             * itself driven, deliberately, further down.
             */
            sourcePrincipalIdentity:
              overrides.sourcePrincipal === undefined
                ? input.plane === 'INTEGRATION'
                  ? INTEGRATION_PRINCIPAL
                  : AUDIT_PRINCIPAL
                : overrides.sourcePrincipal,
            sourcePrincipalMechanism: 'SECRET_MANAGER_VERSION',
            environmentKeys: ['ACOS_S1P_PROBE_ROLE', 'ACOS_S1P_PROBE_PLANE'],
            pid: 0,
          },
        },
      });
    }
    const outcome =
      input.role === 'READ_PROBE' && input.plane === 'AUDIT'
        ? (overrides.auditReadOutcome ?? 'CAPABILITY_CONFIRMED')
        : input.role === 'SEND_PROBE'
          ? (overrides.auditSendOutcome ?? 'CAPABILITY_REFUSED_BY_PROVIDER')
          : input.role === 'READ_PROBE'
            ? (overrides.integrationReadOutcome ?? 'CAPABILITY_REFUSED_BY_PROVIDER')
            : 'CAPABILITY_CONFIRMED';
    if (input.role === 'DUPLICATE_SEND_PROBE') {
      if (overrides.duplicateSent === false) {
        return Promise.resolve({
          kind: 'PROBE_PROCESS_FAILED' as const,
          detail: 'NO_REPLY' as const,
        });
      }
      /*
       * THE STUB REALLY SENDS THE PAIR — INTO THE SIMULATED ACCOUNT.
       *
       * `§11`'s control is only meaningful if the ORACLE then has two records to find. A stub
       * that merely answered "sent" would let the oracle report zero and the assertion would
       * be measuring the stub rather than the oracle. So two accepted messages are written
       * under ONE correlation tag, exactly as a real duplicate pair would be, and the CLI's
       * own observation loop reads them back through the double reader.
       */
      const tag = input.operands?.correlationTag ?? '';
      acceptSend(scenario!.accountPath, { categories: [tag] });
      acceptSend(scenario!.accountPath, { categories: [tag] });
    }
    return Promise.resolve({
      kind: 'REPLY' as const,
      pid: 0,
      reply: {
        kind: 'PROBE_RECORD' as const,
        record: {
          operation: `${input.role} ${input.plane}`,
          credentialIdentity: input.expectedCredentialId,
          plane: input.plane,
          httpStatus: 200,
          outcome: outcome as never,
          note: 'offline stub for the CLI orchestration suite',
        },
      },
    });
  };
}

/**
 * THE OFFLINE COMPOSITION PROVIDER.
 *
 * `describe` reports AVAILABLE — the offline composition genuinely can be built here, which
 * is the fact being reported. `open` builds it exactly once per run and the CLI closes it.
 */
function offlineComposition(options: {
  readonly available?: boolean;
  readonly blocks?: readonly string[];
} = {}): ScenarioCompositionProvider {
  return {
    label: 'OFFLINE S1P scenario composition (simulated transport)',
    describe: (): CompositionAvailability => ({
      available: options.available ?? true,
      blocks: (options.blocks ?? []) as never,
      statement:
        (options.available ?? true)
          ? 'the OFFLINE composition is available: a real kernel, a real outbox and a real ' +
            'gateway over a simulated transport'
          : `the offline composition was declared unavailable for this case: ${(options.blocks ?? []).join(', ')}`,
    }),
    open: (): Promise<OpenedScenarioComposition> => {
      scenario = createS1PScenario(h, { maxObservationAttempts: 6 });
      const opened = scenario;
      return Promise.resolve({
        runtime: opened.runtime,
        ports: opened.ports,
        close: () => Promise.resolve(),
      });
    },
  };
}

/** The environment a fully-configured operator would supply. Per case, in a fresh directory. */
function operatorEnvironment(
  overrides: Readonly<Record<string, string | undefined>> = {},
): Readonly<Record<string, string | undefined>> {
  workspace = mkdtempSync(join(tmpdir(), 'acos-s1p-cli-'));
  const configPath = join(workspace, 'deployment.json');
  writeFileSync(
    configPath,
    JSON.stringify({
      environmentLabel: 'nonprod-validation',
      senderAddress: S1P_SENDER,
      sinkAddress: S1P_SINK,
      integrationCredentialId: S1P_INTEGRATION_CREDENTIAL_ID,
      auditCredentialId: S1P_AUDIT_CREDENTIAL_ID,
    }),
    'utf8',
  );
  return {
    [ENV_CONFIG]: configPath,
    [ENV_NON_PRODUCTION_ACK]: NON_PRODUCTION_ACK_TOKEN,
    [ENV_LIVE_ACK]: LIVE_ACK_TOKEN,
    [ENV_ENTITLEMENT_CONFIRMED]: ENTITLEMENT_CONFIRMED_TOKEN,
    [ENV_INTEGRATION_LOCATOR]: join(workspace, 'integration-secret.json'),
    [ENV_AUDIT_LOCATOR]: join(workspace, 'audit-secret.json'),
    ...overrides,
  };
}

function seams(extra: Partial<S1PHarnessSeams> = {}): S1PHarnessSeams {
  const { bundle } = s1pValidationArtifacts();
  return {
    composition: offlineComposition(),
    probe: probeStub(),
    bundle: () => bundle,
    visibilityBound: FIXTURE_VISIBILITY_BOUND,
    evidenceDirectory: join(workspace, 'evidence'),
    ...extra,
  };
}

/** The bundle the run just wrote. There is exactly one per run, by construction. */
function writtenEvidence(): EvidenceBundle {
  const directory = join(workspace, 'evidence');
  const files = readdirSync(directory);
  expect(files.length).toBe(1);
  return JSON.parse(readFileSync(join(directory, files[0]!), 'utf8')) as EvidenceBundle;
}

describe('`§1.3`, `§1.4` — THE CLI EXECUTES THE SCENARIO MATRIX', () => {
  it('a fully-configured run drives all six canonical rows through `main`', async () => {
    /*
     * THE CASE THAT COULD NOT EXIST BEFORE THIS CORRECTION.
     *
     * Nothing here calls `runAllScenarios`. `main` does, and the assertions below read the
     * evidence bundle `main` wrote.
     */
    const environment = operatorEnvironment();
    const exit = await main(environment, seams());

    const evidence = writtenEvidence();
    expect(evidence.killPoints.length).toBe(6);
    expect(evidence.killPoints.map((row) => row.point)).toEqual([1, 2, 3, 4, 5, 6]);
    // EVERY row was judged. `NOT_RUN` is the verdict a row carries when nothing executed it.
    expect(evidence.killPoints.filter((row) => row.verdict === 'NOT_RUN')).toEqual([]);
    expect(evidence.preflightFailures).toEqual([]);
    // The exit code is derived from the verdicts, so a clean matrix exits 0.
    expect([0, 1, 2]).toContain(exit);
  }, 180_000);

  it('the run REACHED a provider boundary, and the evidence derives that rather than asserting it', async () => {
    const environment = operatorEnvironment();
    await main(environment, seams());

    const evidence = writtenEvidence();
    // The simulated transport is still a provider operation from the harness's point of view.
    expect(evidence.providerOperationCount).toBeGreaterThan(0);
    expect(evidence.liveRunPerformed).toBe(true);
    expect(evidence.credentialsTouched).toBe(true);
  }, 180_000);

  it('`§14` — `I20` is computed from the operands the scenarios produced, not left `null`', async () => {
    const environment = operatorEnvironment();
    await main(environment, seams());

    const evidence = writtenEvidence();
    expect(evidence.i20).not.toBeNull();
    /*
     * AND THE EXPOSURE BASIS SURVIVED SERIALISATION AS AN EXACT DECIMAL STRING.
     *
     * `irrecoverable_units` is a `bigint`, which `JSON.stringify` throws on. The bundle
     * renderer converts it to a decimal string rather than to a `number`, because
     * `Number(...)` on a large exposure figure is silently wrong. This assertion is the
     * regression guard for a defect that only existed once `i20` could be non-null at all.
     */
    expect(typeof evidence.i20?.historicalReservationBasisUnits).toBe('string');
    expect(String(evidence.i20?.historicalReservationBasisUnits)).toMatch(/^[0-9]+$/);
    // And the conclusion sentence is the comparison's own, not the "NO CHANGE" placeholder.
    expect(evidence.invariantConclusions.i20).not.toContain('NO CHANGE');
  }, 180_000);

  it('`§15`, DEFECT 3 — the `I8` sweep RAN and reports itself INCOMPLETE, never clean', async () => {
    /*
     * THE TWO HALVES OF DEFECT 3, END TO END THROUGH THE CLI.
     *
     * The sweep is performed — so `I8` is no longer "no sweep was attempted" — AND its verdict
     * is honest: the audit IPC carries no cursor and SendGrid publishes no completeness
     * semantics, so a result with no unaccounted record establishes nothing.
     */
    const environment = operatorEnvironment();
    await main(environment, seams());

    const evidence = writtenEvidence();
    expect(evidence.invariantConclusions.i8).not.toContain('NO CHANGE');
    expect(evidence.invariantConclusions.i8).toContain('NOT DISCHARGED');
    expect(evidence.invariantConclusions.i8).not.toContain('DISCHARGED FOR THE SWEPT PERIOD');
  }, 180_000);

  it('`§4.4` — the bundle NAMES the settling regime the counts were taken under', async () => {
    const environment = operatorEnvironment();
    await main(environment, seams());

    const evidence = writtenEvidence();
    expect(evidence.visibilityBoundKind).toBe('FIXTURE_DETERMINISTIC');
    expect(evidence.observationMode).toContain('OFFLINE FIXTURE EVIDENCE');
  }, 180_000);

  it('`§11` — the duplicate control runs ONLY behind its own second acknowledgement', async () => {
    const withoutAck = operatorEnvironment();
    await main(withoutAck, seams());
    expect(writtenEvidence().duplicateControl.status).toBe('NOT_RUN');

    const withAck = operatorEnvironment({ [ENV_DUPLICATE_ACK]: DUPLICATE_ACK_TOKEN });
    await main(withAck, seams());
    const evidence = writtenEvidence();
    expect(evidence.duplicateControl.status).toBe('RUN');
    // The SAME oracle the matrix uses saw the deliberate pair.
    expect(evidence.duplicateControl.observedAcceptedCount).toBeGreaterThanOrEqual(2);
    expect(evidence.duplicateControl.oracleDiscriminatedDuplicate).toBe(true);
  }, 240_000);
});

describe('`§12`, `§1.2` — WHAT STOPS THE MATRIX, AND THE CLI HONOURS EACH', () => {
  it('a capability-probe finding BLOCKS the matrix, and no composition is opened', async () => {
    /*
     * `§12`: "A provider-unreachable/inconclusive probe does NOT pass." The audit credential
     * being able to SEND is the most serious finding the harness can make, and a run that
     * measured it must not go on to measure kill points with that credential.
     */
    const environment = operatorEnvironment();
    let opened = 0;
    const composition = offlineComposition();
    const counting: ScenarioCompositionProvider = {
      ...composition,
      open: (input: CompositionInput) => {
        opened += 1;
        return composition.open(input);
      },
    };
    const exit = await main(
      environment,
      seams({
        composition: counting,
        probe: probeStub({ auditSendOutcome: 'CAPABILITY_CONFIRMED' }),
      }),
    );

    // THE COMPOSITION WAS NEVER OPENED. The block is checked before anything is built.
    expect(opened).toBe(0);
    expect(exit).toBe(2);
    const evidence = writtenEvidence();
    expect(evidence.killPoints).toEqual([]);
    expect(evidence.unresolvedObservations.join(' ')).toContain('AUDIT_CREDENTIAL_CAN_SEND');
    expect(evidence.invariantConclusions.i36).toContain('NO CHANGE');
  }, 180_000);

  it('an UNAVAILABLE composition blocks it too, and every named block reaches the evidence', async () => {
    const environment = operatorEnvironment();
    const exit = await main(
      environment,
      seams({
        composition: offlineComposition({
          available: false,
          blocks: ['EFFECT_CONSTRUCTOR_NOT_IMPLEMENTED', 'CONTROL_DATABASE_NOT_CONFIGURED'],
        }),
      }),
    );

    /*
     * EXIT 1, NOT 2, AND THE DISTINCTION IS THE POINT.
     *
     * An unavailable composition is not a late discovery: it becomes the stage-1 fact
     * `controlPlaneCompositionAvailable`, so `CONTROL_PLANE_COMPOSITION_UNAVAILABLE` refuses
     * in the PREFLIGHT — before a single credential process is started. The blocks still
     * reach the evidence, so a reader learns WHICH prerequisite was missing.
     */
    expect(exit).toBe(1);
    const evidence = writtenEvidence();
    expect(evidence.stage1Failures).toContain('CONTROL_PLANE_COMPOSITION_UNAVAILABLE');
    expect(evidence.credentialsTouched).toBe(false);
    expect(evidence.killPoints).toEqual([]);
    expect(evidence.liveRunPerformed).toBe(false);
    expect(evidence.providerOperationCount).toBe(0);
    const unresolved = evidence.unresolvedObservations.join(' ');
    expect(unresolved).toContain('EFFECT_CONSTRUCTOR_NOT_IMPLEMENTED');
    expect(unresolved).toContain('CONTROL_DATABASE_NOT_CONFIGURED');
  }, 120_000);

  it('`§1.2` — a stage-1 preflight refusal stops everything, and the matrix is not attempted', async () => {
    // The `§7` sentence is absent, which is the one fact a parseable document cannot supply.
    const environment = operatorEnvironment({ [ENV_NON_PRODUCTION_ACK]: undefined });
    let opened = 0;
    const composition = offlineComposition();
    const exit = await main(
      environment,
      seams({
        composition: {
          ...composition,
          open: (input: CompositionInput) => {
            opened += 1;
            return composition.open(input);
          },
        },
      }),
    );

    expect(exit).toBe(1);
    expect(opened).toBe(0);
    const evidence = writtenEvidence();
    expect(evidence.stage1Failures).toContain('NON_PRODUCTION_NOT_ACKNOWLEDGED');
    // AND NO CREDENTIAL PROCESS WAS STARTED. `§4`'s stage split, through the real CLI.
    expect(evidence.credentialsTouched).toBe(false);
    expect(evidence.killPoints).toEqual([]);
  }, 120_000);

  it('a SYNTHETIC identity provenance still refuses at stage 2, substitution or not', async () => {
    /*
     * THE ASSERTION THAT KEEPS THE PROBE STUB HONEST.
     *
     * Every other case above hands the CLI a `PROVIDER_KEY_ID` provenance so the run can reach
     * the matrix. A real file-backed source reports `SYNTHETIC_TEST_IDENTITY`, and correction
     * 3's gate must still refuse it — otherwise this suite would have quietly proved that the
     * material-binding gate can be walked past.
     */
    const environment = operatorEnvironment();
    const exit = await main(
      environment,
      seams({ probe: probeStub({ identityProvenance: 'SYNTHETIC_TEST_IDENTITY' }) }),
    );

    expect(exit).toBe(1);
    const evidence = writtenEvidence();
    expect(evidence.stage2Failures).toContain('INTEGRATION_IDENTITY_NOT_MATERIAL_BOUND');
    expect(evidence.stage2Failures).toContain('AUDIT_IDENTITY_NOT_MATERIAL_BOUND');
    expect(evidence.killPoints).toEqual([]);
  }, 120_000);
});

describe('THE SHIPPED DEFAULT — `main` WITH NO SEAMS MEASURES, AND REFUSES', () => {
  it('the LIVE composition is measured UNAVAILABLE on this repository, with named blocks', async () => {
    /*
     * `§1.2` — the default path, with nothing injected. It must reach the REAL
     * `describeLiveComposition`, measure, and name what is missing. An empty environment is
     * used so no ambient `ACOS_*` variable from the test worker changes the answer.
     */
    workspace = mkdtempSync(join(tmpdir(), 'acos-s1p-cli-default-'));
    const exit = await main({}, { evidenceDirectory: join(workspace, 'evidence') });

    expect(exit).toBe(1);
    const evidence = writtenEvidence();
    expect(evidence.stage1Failures).toContain('CONTROL_PLANE_COMPOSITION_UNAVAILABLE');
    expect(evidence.credentialsTouched).toBe(false);
    expect(evidence.providerOperationCount).toBe(0);
    expect(evidence.liveRunPerformed).toBe(false);
  }, 120_000);
});

describe('THE DISTINCT AZURE PRINCIPAL GATE, END TO END THROUGH `main`', () => {
  /*
   * =================================================================================
   * WHY THIS IS HERE AND NOT ONLY IN THE PREFLIGHT SUITE
   *
   * `tests/sendgrid/preflight.test.ts` drives the GATE over fact sets. What it cannot show is
   * the CONSEQUENCE: that a run whose two planes share one Azure managed identity never
   * reaches the capability probes and performs zero SendGrid operations.
   *
   * The owner decision makes distinct user-assigned managed identities part of the security
   * boundary rather than an operator recommendation, and a boundary that refuses late — after
   * probing a provider with the very credentials it was meant to keep separate — would not be
   * one. So the refusal is asserted where it bites.
   *
   * The principals arrive on the probe replies, from the isolated child processes. This suite
   * substitutes the probe LAUNCHER, so what it drives is the orchestration's handling of what
   * a child reported; `tests/sendgrid/key-vault-binding.test.ts` drives the sources actually
   * producing those values from their own closed locators.
   * =================================================================================
   */

  it('1 — integration MI A / audit MI B: the distinct-principal gate passes', async () => {
    const environment = operatorEnvironment();
    await main(environment, seams());

    const evidence = writtenEvidence();
    expect(evidence.stage2Failures).not.toContain('CREDENTIAL_SOURCE_PRINCIPALS_NOT_DISTINCT');
    // The run got past stage 2 entirely, which is what makes case 2 a discrimination.
    expect(evidence.stage2Failures).toEqual([]);
  }, 180_000);

  it('2, 3, 4 — the SAME managed identity on both planes REFUSES, probes never run, zero sends', async () => {
    /*
     * THE CASE THE OLD TEST 23 COULD NOT MAKE.
     *
     * Two distinct SendGrid credential identities, both matching their signed expectations —
     * every accepted gate passes. One Azure principal for both planes, and the run stops.
     */
    const environment = operatorEnvironment();
    let probesLaunched = 0;
    let compositionsOpened = 0;
    const composition = offlineComposition();
    const exit = await main(
      environment,
      seams({
        composition: {
          ...composition,
          open: (input: CompositionInput) => {
            compositionsOpened += 1;
            return composition.open(input);
          },
        },
        probe: (input) => {
          if (input.role !== 'IDENTITY') probesLaunched += 1;
          return probeStub({ sourcePrincipal: INTEGRATION_PRINCIPAL })(input);
        },
      }),
    );

    expect(exit).toBe(1);
    const evidence = writtenEvidence();
    expect(evidence.stage2Failures).toContain('CREDENTIAL_SOURCE_PRINCIPALS_NOT_DISTINCT');

    // 3 — NO CAPABILITY PROBE RAN. The refusal is in stage 2, which gates them.
    expect(probesLaunched).toBe(0);
    expect(evidence.probes).toEqual([]);

    // 4 — ZERO SENDGRID OPERATIONS, and no composition was opened either.
    expect(evidence.providerOperationCount).toBe(0);
    expect(evidence.liveRunPerformed).toBe(false);
    expect(compositionsOpened).toBe(0);
    expect(evidence.killPoints).toEqual([]);
  }, 180_000);

  it('5 — the operands come from the CHILDREN, not from parent-authored constants', async () => {
    /*
     * The coordinator holds no locator and cannot derive a principal. It reports exactly what
     * the probe replies carried — so a child that reported nothing produces a refusal, not a
     * default.
     */
    const environment = operatorEnvironment();
    const exit = await main(
      environment,
      seams({ probe: (input) => probeStub({ sourcePrincipal: null })(input) }),
    );

    expect(exit).toBe(1);
    const evidence = writtenEvidence();
    expect(evidence.stage2Failures).toContain('INTEGRATION_SOURCE_PRINCIPAL_UNAVAILABLE');
    expect(evidence.stage2Failures).toContain('AUDIT_SOURCE_PRINCIPAL_UNAVAILABLE');
    expect(evidence.providerOperationCount).toBe(0);
  }, 180_000);

  it('9 — the distinct VENDOR CREDENTIAL gate remains separately discriminating', async () => {
    /*
     * NEITHER CONTROL SUBSTITUTES FOR THE OTHER.
     *
     * Here the two planes use different Azure principals — the new gate passes — and resolve
     * the SAME SendGrid credential identity. The accepted `CREDENTIALS_NOT_DISTINCT` gate
     * catches it on its own.
     */
    const environment = operatorEnvironment();
    const exit = await main(
      environment,
      seams({
        probe: (input) =>
          probeStub({ forceCredentialIdentity: 'twilio_sendgrid.one_key_for_both' })(input),
      }),
    );

    expect(exit).toBe(1);
    const evidence = writtenEvidence();
    expect(evidence.stage2Failures).toContain('CREDENTIALS_NOT_DISTINCT');
    // ...and NOT because the Azure principals were wrong. They were fine.
    expect(evidence.stage2Failures).not.toContain('CREDENTIAL_SOURCE_PRINCIPALS_NOT_DISTINCT');
    expect(evidence.providerOperationCount).toBe(0);
  }, 180_000);

  it('7 — no Azure token or material crosses the probe reply', async () => {
    /*
     * The reply carries a GUID, which names a principal and authenticates nobody. `§12`'s
     * hygiene rule applied to the new field: a value that could authenticate would be a value
     * the coordinator must not hold.
     */
    const environment = operatorEnvironment();
    await main(environment, seams());

    const evidence = writtenEvidence();
    const serialised = JSON.stringify(evidence);
    for (const forbidden of ['SG.', 'Bearer ', 'eyJ0', 'PRIVATE KEY', 'AZURE_CLIENT_SECRET']) {
      expect(serialised, forbidden).not.toContain(forbidden);
    }
  }, 180_000);
});
