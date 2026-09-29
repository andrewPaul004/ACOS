import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';

import type { Pool } from '../../src/db/pool.js';
import { COMPANY_ID } from './fixture.js';
import {
  EMAIL_SEND_CONSTRUCTOR_VERSION,
  S1I_NOW,
  outboxRows,
  type OutboxHarness,
} from './outboxFixture.js';
import { dispatchEnvWith, rawOutcomeRows } from './gatewayFixture.js';
import {
  buildControlArtifactFixture,
  verifyFixtureBundle,
  withArtifactBytes,
  type ControlArtifactFixture,
} from './controlArtifactFixture.js';
import { verifyAuditPlaneControlArtifacts } from '../../src/audit/controlArtifacts/auditPlaneVerifier.js';
import { createAdapterRuntimeRegistry } from '../../src/integration/control/adapterRuntimeRegistry.js';
import { IntegrationClient } from '../../src/integration/control/integrationClient.js';
import { createAuditReaderRegistry } from '../../src/audit/provider/plane/auditReaderRegistry.js';
import { AuditReadClient } from '../../src/audit/provider/plane/auditReadClient.js';
import type { VerifiedControlArtifactBundle } from '../../src/kernel/controlArtifacts/bundle.js';
import { enqueueDispatch } from '../../src/kernel/outbox/enqueue.js';
import { commitLocalAuthorisation } from '../../src/kernel/authorisation/localAuthorisation.js';
import { OWNER_SINK_MARKER } from '../../validation/sendgrid/integration/validationPayload.js';
import {
  S1P_VALIDATION_AUTHORITY_ACKNOWLEDGEMENT,
  S1PValidationAuthority,
} from '../../validation/sendgrid/harness/validationAuthority.js';
import type {
  LaunchedAuditRuntime,
  LaunchedIntegrationRuntime,
  LocalScenarioState,
  ScenarioPorts,
  ScenarioRuntimeConfig,
} from '../../validation/sendgrid/harness/scenarioDriver.js';
import { MIN_STABILISATION_OBSERVATIONS } from '../../validation/sendgrid/harness/observation.js';
import { FIXTURE_VISIBILITY_BOUND } from '../../validation/sendgrid/harness/visibilityBound.js';
import { EMPTY_ACCOUNT, writeAccount, type SimulatedReadBehaviour } from '../sendgrid-doubles/simulatedAccount.js';

/**
 * THE OFFLINE COMPOSITION THE S1P SCENARIO DRIVER IS EXERCISED AGAINST — `§11`.
 *
 * =================================================================================
 * WHAT IS REAL HERE, AND IT IS ALMOST EVERYTHING
 *
 * `§11`: the driver "must compile and be fully exercised against deterministic offline
 * doubles without making real provider calls." What this fixture supplies is a composition in
 * which EXACTLY ONE thing is a double — the transport — and everything else is the accepted
 * machinery:
 *
 *   REAL  the S1P validation-authority seeder, with the real owner-sink refusal and the real
 *         canonical payload construction;
 *   REAL  `commitLocalAuthorisation`, step R's IRRECOVERABLE reservation, and the committed
 *         `reservation_window_instance` rows `I20`'s denominator is read from;
 *   REAL  `enqueueDispatch` and the kernel-minted `25 §7` correlation tag;
 *   REAL  `dispatchAuthorisedEffect` — the ACCEPTED Effect Gateway, unmodified, with its real
 *         dispatch lease, revalidation, claim transaction and outcome transaction;
 *   REAL  `IntegrationClient` and `AuditReadClient`, forking REAL OS processes from the
 *         accepted `src/integration/runtime/main.ts` and `src/audit/provider/runtime/main.ts`;
 *   REAL  the closed dispatch-payload decoder, the request mapping, both credential sources,
 *         the activity normalisation and the correction-9 read mapping;
 *   DOUBLE the transport only: `tests/sendgrid-doubles/simulatedAccount.ts`, a file two
 *         isolated child processes can both reach, with NO `fetch` anywhere in its closure.
 *
 * =================================================================================
 * THE CLASS-5 RECORDS ARE A **TEST-ONLY SIGNED BUNDLE**, AND THAT IS `§16`'s OWN ALLOWANCE
 *
 * A SendGrid runtime cannot be registered without a signed class-5 record naming its
 * credential, and `§16` forbids inventing one in the repository's shipped artifact: "Do not
 * activate a real-provider release whose class-5 credential identities are fictional."
 *
 * `§16` also says what IS allowed: "You may use the accepted repository's test/pre-live trust
 * roots and fixture mechanisms for offline discrimination if those mechanisms are already
 * sanctioned." So the two validation credential records are added to a SEPARATE package built
 * by `buildControlArtifactFixture`, signed by the TEST-ONLY roots, verified through the
 * ACCEPTED verifier, and used ONLY to construct the two runtime registries. The repository's
 * `artifacts/control/class-05.credential-scopes.json` is untouched, and
 * `tests/sendgrid/prerequisites-and-separation.test.ts` still asserts that it carries no
 * SendGrid credential.
 * =================================================================================
 */

export const S1P_ADAPTER_ID = 'sendgrid_email';
export const S1P_PROVIDER_ID = 'twilio_sendgrid';

/** The TEST-ONLY credential identities the augmented class-5 fixture declares. */
export const S1P_INTEGRATION_CREDENTIAL_ID = 'twilio_sendgrid.validation_send';
export const S1P_AUDIT_CREDENTIAL_ID = 'twilio_sendgrid.validation_audit_read';

export const S1P_SENDER = 'validation@nonprod.example.test';
export const S1P_SINK = `owner+${OWNER_SINK_MARKER}@example.test`;

const DOUBLES_ROOT = resolve(process.cwd(), 'tests', 'sendgrid-doubles');
export const DOUBLE_INTEGRATION_ROOT = join(DOUBLES_ROOT, 'integration');
export const DOUBLE_AUDIT_ROOT = join(DOUBLES_ROOT, 'audit');

/** `§29`'s sentinel shape, so a leak found later is attributable to this fixture. */
function sentinel(label: string): string {
  return `TEST_ONLY_VENDOR_SECRET_${label}_${randomBytes(24).toString('hex')}`;
}

/**
 * The two class-5 records the S1P validation composition needs, as `50 §2g` declares them.
 *
 * `granted_provider_permissions` are spelled as the PROVIDER spells them, and the derived
 * fields 5, 6 and 7 are consistent with field 4 — which the class-5 parser checks, so an
 * inconsistent fixture record would be refused at verification rather than admitted.
 */
const S1P_CREDENTIAL_RECORDS = [
  {
    credential_id: S1P_INTEGRATION_CREDENTIAL_ID,
    adapter: S1P_ADAPTER_ID,
    provider: S1P_PROVIDER_ID,
    granted_provider_permissions: ['mail.send'],
    monetary_provider_permissions: [],
    credential_risk_class: 'NON_MONETARY_WRITE',
    external_mutation_capable: true,
  },
  {
    credential_id: S1P_AUDIT_CREDENTIAL_ID,
    /** `50 §2g` field 2's reserved audit-plane sentinel. Not presentable by any adapter. */
    adapter: 'audit_plane',
    provider: S1P_PROVIDER_ID,
    granted_provider_permissions: ['email_activity.read'],
    monetary_provider_permissions: [],
    credential_risk_class: 'READ_ONLY',
    external_mutation_capable: false,
  },
];

let augmented: ControlArtifactFixture | null = null;
let augmentedBundle: VerifiedControlArtifactBundle | null = null;

/**
 * The TEST-ONLY signed package whose class 5 carries the two validation credentials.
 *
 * Built once per worker, into its own directory, so it never disturbs the worker's ACTIVE
 * bundle — `verifyFixtureBundle` verifies WITHOUT publishing, which is the separation
 * `50 §3f` draws deliberately.
 */
export function s1pValidationArtifacts(): {
  readonly fixture: ControlArtifactFixture;
  readonly bundle: VerifiedControlArtifactBundle;
} {
  if (augmented === null || augmentedBundle === null) {
    augmented = buildControlArtifactFixture({
      dir: join(tmpdir(), 'acos-s1p-validation-package'),
      mutate: (artifacts) =>
        withArtifactBytes(artifacts, 5, (bytes) => {
          const document = JSON.parse(bytes.toString('utf8')) as {
            credentials: unknown[];
            [key: string]: unknown;
          };
          /*
           * `50 §2g`: the records are declared in STRICTLY ASCENDING `credential_id` ORDER,
           * and the class-5 parser refuses a set that is not. The merge therefore SORTS rather
           * than appends — an appended record that happened to sort correctly would be a
           * fixture whose validity depended on the names it chose.
           */
          const merged = [...(document.credentials as { credential_id: string }[]), ...S1P_CREDENTIAL_RECORDS]
            .slice()
            .sort((left, right) => (left.credential_id < right.credential_id ? -1 : 1));
          return Buffer.from(
            `${JSON.stringify({ ...document, credentials: merged }, null, 2)}\n`,
            'utf8',
          );
        }),
    });
    augmentedBundle = verifyFixtureBundle(augmented);
  }
  return { fixture: augmented, bundle: augmentedBundle };
}

export interface S1PScenarioOptions {
  /** How the simulated account answers reads. `OK` unless a test is driving a refusal. */
  readonly readBehaviour?: SimulatedReadBehaviour;
  /** How many successful reads must pass before an accepted message becomes visible. */
  readonly visibleAfterReads?: number;
  /** Bound the observation tightly so the offline run is fast AND still stabilises. */
  readonly maxObservationAttempts?: number;
}

export interface S1PScenario {
  readonly runtime: ScenarioRuntimeConfig;
  readonly ports: ScenarioPorts;
  /** The file the double adapter writes to and the double reader reads from. */
  readonly accountPath: string;
  /** The integration secret document's path, for the isolation assertions. */
  readonly integrationLocator: string;
  readonly auditLocator: string;
  cleanup(): Promise<void>;
}

/**
 * Build the whole offline composition for ONE scenario.
 *
 * ONE integration runtime and ONE audit runtime per scenario, because the driver launches and
 * closes a pair per kill point — and because kill point 3 launches a DIFFERENT adapter module,
 * which is a property of the descriptor rather than of a shared long-lived process.
 */
export function createS1PScenario(
  h: OutboxHarness,
  options: S1PScenarioOptions = {},
): S1PScenario {
  const directory = mkdtempSync(join(tmpdir(), 'acos-s1p-scenario-'));
  const accountPath = join(directory, 'simulated-sendgrid-account.json');
  writeAccount(accountPath, {
    ...EMPTY_ACCOUNT,
    ...(options.readBehaviour === undefined ? {} : { readBehaviour: options.readBehaviour }),
  });

  /*
   * TWO SEPARATE SECRET DOCUMENTS, IN TWO SEPARATE FILES.
   *
   * `createAuditReaderRegistry` refuses `READER_LOCATOR_SHARED_WITH_INTEGRATION` when the two
   * locators collide, so the composition cannot point both planes at one document — and the
   * fixture does not try to, which is what makes the refusal a real check rather than one this
   * fixture works around.
   */
  const integrationLocator = join(directory, 'integration-secret.json');
  const auditLocator = join(directory, 'audit-secret.json');
  writeFileSync(
    integrationLocator,
    JSON.stringify({
      adapterId: S1P_ADAPTER_ID,
      // CORRECTION 3: the MECHANISM is declared; the provenance is not, and could not be.
      sourceKind: 'FILE_FIXTURE',
      apiKey: sentinel('S1P_INTEGRATION'),
      credentialIdentity: S1P_INTEGRATION_CREDENTIAL_ID,
      // Read by the DOUBLE adapter from its own runtime's locator, the accepted way a runtime
      // receives launch configuration that the eight-key allowlist has no slot for.
      simulatedAccountPath: accountPath,
      ...(options.visibleAfterReads === undefined
        ? {}
        : { visibleAfterReads: options.visibleAfterReads }),
    }),
    'utf8',
  );
  writeFileSync(
    auditLocator,
    JSON.stringify({
      providerId: S1P_PROVIDER_ID,
      sourceKind: 'FILE_FIXTURE',
      apiKey: sentinel('S1P_AUDIT'),
      credentialIdentity: S1P_AUDIT_CREDENTIAL_ID,
      simulatedAccountPath: accountPath,
    }),
    'utf8',
  );

  const runtime: ScenarioRuntimeConfig = {
    adapterId: S1P_ADAPTER_ID,
    providerId: S1P_PROVIDER_ID,
    integrationRuntimeRoot: DOUBLE_INTEGRATION_ROOT,
    integrationAdapterModule: join(DOUBLE_INTEGRATION_ROOT, 'adapter.ts'),
    integrationKillPointAdapterModule: join(DOUBLE_INTEGRATION_ROOT, 'killPointAdapter.ts'),
    integrationSecretSourceModule: join(DOUBLE_INTEGRATION_ROOT, 'secretSource.ts'),
    integrationSecretLocator: integrationLocator,
    integrationCredentialId: S1P_INTEGRATION_CREDENTIAL_ID,
    auditRuntimeRoot: DOUBLE_AUDIT_ROOT,
    auditReaderModule: join(DOUBLE_AUDIT_ROOT, 'reader.ts'),
    auditSecretSourceModule: join(DOUBLE_AUDIT_ROOT, 'secretSource.ts'),
    auditSecretLocator: auditLocator,
    auditCredentialId: S1P_AUDIT_CREDENTIAL_ID,
  };

  const { fixture, bundle } = s1pValidationArtifacts();
  const auditCredentials = (() => {
    const outcome = verifyAuditPlaneControlArtifacts(fixture.auditEnv);
    if (!outcome.verified) {
      throw new Error(`the S1P audit plane could not verify its artifacts: ${outcome.reason}`);
    }
    return outcome.auditReadCredentials;
  })();

  const open: { close(): Promise<void> }[] = [];

  const ports: ScenarioPorts = {
    authority: new S1PValidationAuthority({
      acknowledgement: S1P_VALIDATION_AUTHORITY_ACKNOWLEDGEMENT,
      companyId: COMPANY_ID,
      constructorVersion: EMAIL_SEND_CONSTRUCTOR_VERSION,
      commit: async (facts) => {
        const outcome = await h.kernel.leases.withEntityLease(
          { companyId: COMPANY_ID, entityType: 'order', entityId: facts.resourceId },
          (lease) =>
            commitLocalAuthorisation(lease, { kind: 'ORDINARY', facts }, h.kernel.commitOptions()),
        );
        return outcome.outcome === 'LOCAL_AUTHORISATION_COMMITTED'
          ? { kind: 'COMMITTED' as const, effectId: outcome.effectId }
          : { kind: 'REFUSED' as const, detail: outcome.outcome };
      },
      enumerate: async (input) => {
        /*
         * A REAL ENUMERATION, THROUGH THE PRODUCTION `EffectEnumerator`.
         *
         * `25 §14.1` revalidates the ORIGINAL enumeration/option identity at dispatch, so an
         * effect with a fabricated identity would be refused at the dispatch boundary. The
         * resource row is materialised first, outside the lease, exactly as the accepted
         * `outboxFixture.ts` does for the other two constructor-less classes.
         */
        const seedClient = await h.control.connect();
        try {
          await seedClient.query(
            `INSERT INTO commerce_order
               (company_id, order_id, resource_ref, grade, currency, customer_novelty)
             VALUES ($1, $2, $3, 'RECORD', 'USD', 'RETURNING')
             ON CONFLICT (company_id, order_id) DO NOTHING`,
            [COMPANY_ID, input.resourceId, input.resourceRef],
          );
        } finally {
          seedClient.release();
        }
        return h.kernel.leases.withEntityLease(
          { companyId: COMPANY_ID, entityType: 'order', entityId: input.resourceId },
          async (lease) => {
            const outcome = await h.kernel.enumerator.enumerate(lease, {
              actionClass: input.actionClass as never,
              resourceRef: input.resourceRef,
              spec: {
                companyId: COMPANY_ID,
                taskId: input.taskId,
                principalId: 'principal:support_reasoner:1',
                admittedResourceRefs: new Set([input.resourceRef]),
                admittedDescriptionFields: {},
                reasonCodeScope: 'GOODS_FAULT',
              },
            });
            const optionId = outcome.set.options[0]?.optionId;
            if (optionId === undefined) {
              throw new Error(`no option enumerated for ${input.resourceRef}`);
            }
            return { enumerationId: outcome.set.enumerationId, optionId };
          },
        );
      },
    }),
    senderAddress: S1P_SENDER,
    sinkAddress: S1P_SINK,
    companyId: COMPANY_ID,

    enqueue: async (input) => {
      const outcome = await enqueueDispatch(h.control, {
        companyId: COMPANY_ID,
        effectId: input.effectId,
        outboxId: input.outboxId,
        payloadCanonicalBytes: input.payloadCanonicalBytes,
        now: input.now,
      });
      if (outcome.kind !== 'ENQUEUED') {
        throw new Error(`the S1P validation effect did not enqueue: ${outcome.kind}`);
      }
    },

    correlationTagFor: async (idempotencyKey) => {
      // THE KERNEL'S OWN TAG, read back from the committed row. Never recomputed here.
      const rows = await outboxRows(h.control);
      const row = rows.find((entry) => entry.idempotencyKey === idempotencyKey);
      if (row === undefined) throw new Error(`no outbox row for ${idempotencyKey}`);
      return row.correlationTag;
    },

    dispatchEnvironmentFor: (registry) => dispatchEnvWith(h, registry),

    launchIntegration: (descriptor): Promise<LaunchedIntegrationRuntime> => {
      const client = new IntegrationClient(createAdapterRuntimeRegistry([descriptor], bundle), {
        deadlineMs: 30_000,
      });
      const launched: LaunchedIntegrationRuntime = {
        registry: client.adapterRegistry(),
        close: () => client.close(),
      };
      open.push(launched);
      return Promise.resolve(launched);
    },

    launchAuditReader: (descriptor): Promise<LaunchedAuditRuntime> => {
      const client = new AuditReadClient(
        createAuditReaderRegistry([descriptor], auditCredentials, new Set([integrationLocator])),
        { deadlineMs: 30_000 },
      );
      const launched: LaunchedAuditRuntime = {
        read: async (query) => {
          const outcome = await client.read({
            providerId: descriptor.providerId,
            operation: query.operation,
            periodStartMs: query.periodStartMs,
            periodEndMs: query.periodEndMs,
            correlationTag: query.correlationTag,
            maxRecords: query.maxRecords,
          });
          return outcome.kind === 'EVIDENCE'
            ? {
                kind: 'EVIDENCE' as const,
                records: outcome.records,
                recordCount: outcome.recordCount,
              }
            : { kind: 'PROVIDER_UNAVAILABLE' as const };
        },
        close: () => client.close(),
      };
      open.push(launched);
      return Promise.resolve(launched);
    },

    localStateFor: (idempotencyKey) => readLocalState(h.control, idempotencyKey),

    reservationUnitsFor: async (effectId) => {
      /*
       * `I20`'s DENOMINATOR, FROM THE IMMUTABLE HISTORICAL EVIDENCE.
       *
       * `reservation_window_instance.irrecoverable_units`, joined through the reservation to
       * this effect — NOT `window_balance.reserved_irrecoverable`, which PRESUME and REALISE
       * move. `phase2-v1.3.5-errata.md §1`, and `0013__irrecoverable_units.sql` behind it.
       *
       * DISTINCT window instances would double-count an effect that reserved against two
       * windows, so the per-effect basis is the MAXIMUM over its window instances: one
       * authorised irrecoverable effect commits ONE unit, recorded once per applicable window.
       */
      const client = await h.control.connect();
      try {
        const result = await client.query<{ units: string | null }>(
          `SELECT MAX(rwi.irrecoverable_units)::TEXT AS units
             FROM reservation_window_instance rwi
             JOIN exposure_reservation r ON r.reservation_id = rwi.reservation_id
             JOIN effect e ON e.authorisation_id = r.authorisation_id
            WHERE e.effect_id = $1`,
          [effectId],
        );
        const units = result.rows[0]?.units;
        return units === undefined || units === null ? 0n : BigInt(units);
      } finally {
        client.release();
      }
    },

    now: () => S1I_NOW,
    recoveryAt: () => new Date(S1I_NOW.getTime() + 6 * 60 * 60 * 1000),
    delay: () => Promise.resolve(),
    nowMs: () => Date.now(),
    observationWindow: () => ({
      periodStartMs: S1I_NOW.getTime() - 24 * 60 * 60 * 1000,
      periodEndMs: Date.now() + 24 * 60 * 60 * 1000,
    }),
    observationBound: {
      maxAttempts: options.maxObservationAttempts ?? 6,
      // The interval is CLAMPED UP to the published rate limit by `clampObservationBound`; the
      // injected `delay` resolves immediately, so the offline run pays no wall clock for it.
      intervalMs: 10_000,
      maxDurationMs: 10 * 60 * 1000,
      maxRecords: 50,
      stabilisationObservations: MIN_STABILISATION_OBSERVATIONS,
    },
    /*
     * SECOND REVIEW `§4.4` — THE OFFLINE FIXTURE BOUND, AND WHY IT IS LEGITIMATE HERE.
     *
     * The simulated provider account is a FILE THIS PROCESS OWNS. Nothing can append to it
     * after the recovery returns except code in this test run, so "no further record appeared"
     * is a determinate fact rather than a claim about SendGrid's reporting pipeline.
     *
     * `§4.4` allows exactly this — "deterministic fixture timing" — on condition the evidence
     * says the settling was offline, which `observationModeLabel` writes into every record.
     *
     * The LIVE composition injects `SENDGRID_LIVE_VISIBILITY_BOUND`, which is `UNESTABLISHED`,
     * so a live no-duplicate row is `UNRESOLVED` and no fixture convenience leaks into it.
     */
    visibilityBound: FIXTURE_VISIBILITY_BOUND,
  };

  return {
    runtime,
    ports,
    accountPath,
    integrationLocator,
    auditLocator,
    cleanup: async (): Promise<void> => {
      for (const handle of open) await handle.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

/** Committed local state for one effect, by DIRECT SQL. No production helper is consulted. */
async function readLocalState(
  control: Pool,
  idempotencyKey: string,
): Promise<LocalScenarioState> {
  const rows = await outboxRows(control);
  const row = rows.find((entry) => entry.idempotencyKey === idempotencyKey);
  const outcomes = (await rawOutcomeRows(control)).filter(
    (entry) => entry.idempotencyKey === idempotencyKey,
  );
  const outcome = outcomes[0];
  return {
    outboxStatus: row?.status ?? null,
    outcomeRows: outcomes.length,
    /*
     * THE LOCAL HALF OF `§9` ITEM 12, AND ONLY THE LOCAL HALF.
     *
     * A committed outcome carrying the PROVIDER's own reference is the control plane's record
     * that the boundary was crossed. Its absence is NOT evidence that the boundary was not
     * crossed — kill points 3 and 4 are exactly the cases where it was and no outcome
     * committed — so the absence is reported as `null` rather than as `false`, and the
     * provider-side read is what answers the question independently.
     */
    mayHaveCrossedProviderBoundary:
      outcome === undefined ? null : outcome.providerReference !== null,
    providerResponseMessageId: outcome?.providerReference ?? null,
    finalEffectState: outcome?.effectStatus ?? null,
  };
}
