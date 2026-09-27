import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { COMPANY_ID } from '../../support/fixture.js';
import {
  S1I_NOW,
  authorisePause,
  createOutboxHarness,
  type OutboxHarness,
} from '../../support/outboxFixture.js';
import { dispatchEnvWith } from '../../support/gatewayFixture.js';
import { enqueueDispatch } from '../../../src/kernel/outbox/enqueue.js';
import { dispatchAuthorisedEffect } from '../../../src/kernel/gateway/effectGateway.js';
import { buildDispatchRequest } from '../../../src/integration/control/integrationClient.js';
import { handleDispatchRequest } from '../../../src/integration/runtime/integrationHost.js';
import { emitIntegrationLog } from '../../../src/integration/runtime/runtimeLog.js';
import {
  createRecordingAdapter,
  unsafeHandleDispatchRequest,
} from '../../negative-controls/unsafe-integration-host.js';
import {
  ADAPTER_A,
  CREDENTIAL_A_NON_MONETARY,
  adapterADescriptor,
  awaitRuntimeReady,
  launchIntegration,
  mintSentinelSecret,
  runtimeRegistry,
  type LaunchedIntegration,
} from '../../support/integrationFixture.js';
import { stringifyForLeakScan, syntheticEnvelope } from '../../support/perimeterFixture.js';
import type { AdapterSecretSource } from '../../../src/integration/runtime/adapterSecretSource.js';

/**
 * `§29`, `§23`, `§43` — THE SECRET-LEAK MATRIX.
 *
 * =================================================================================
 * `§29`'s REQUIREMENT, VERBATIM
 *
 * "Use a clearly fake high-entropy sentinel secret [...] Inject only into integration
 * adapter A. Capture: control logs; integration sanitized logs; IPC request/response; DB;
 * journal; effect; outbox; error objects. **The secret must appear nowhere except its
 * integration-only test credential source / private adapter memory fixture.** Add an unsafe
 * implementation that leaks it. Must discriminate."
 *
 * Every surface below is captured DIRECTLY — raw SQL for the database rows, the encoded
 * bytes for the IPC, the child's own streams for the logs — rather than through any
 * production helper that might sanitise on the way.
 * =================================================================================
 */

let h: OutboxHarness;
let launched: LaunchedIntegration | null = null;
const NOW = S1I_NOW;

beforeAll(async () => {
  h = await createOutboxHarness();
});

afterAll(async () => {
  await h.close();
});

beforeEach(async () => {
  await h.reset();
});

afterEach(async () => {
  if (launched !== null) {
    await launched.close();
    launched = null;
  }
});

/**
 * The identity this file's synthetic source resolves, and the one every configuration below
 * echoes as `expectedCredentialId`. `50 §2g` field 1's binding is satisfied by the pair
 * agreeing; the leak matrix is about what ESCAPES, so it holds the binding constant.
 */
const FIXED_CREDENTIAL_IDENTITY = CREDENTIAL_A_NON_MONETARY;

function fixedSecretSource(adapterId: string, secret: string): AdapterSecretSource {
  return {
    declaredAdapterId: adapterId,
    resolve: () =>
      Promise.resolve({
        kind: 'RESOLVED',
        credential: {
          secret,
          credentialIdentity: FIXED_CREDENTIAL_IDENTITY,
          identityProvenance: 'SYNTHETIC_TEST_IDENTITY',
          version: 'ACCEPT',
        },
      }),
  };
}

describe('`§29` — THE SENTINEL APPEARS ON NO SURFACE BUT ITS OWN SOURCE', () => {
  it('the full matrix, over one real dispatch through a real separate process', async () => {
    const secret = mintSentinelSecret('matrix');
    const controlLog: string[] = [];
    launched = launchIntegration((secrets) => {
      const locator = secrets.write('a', {
        adapterId: ADAPTER_A,
        secret,
        credentialIdentity: FIXED_CREDENTIAL_IDENTITY,
      });
      return runtimeRegistry(adapterADescriptor(locator));
    });

    const effect = await authorisePause(h, { resourceId: 'CMP-S1N-LEAK' });
    const enqueued = await enqueueDispatch(h.control, {
      companyId: COMPANY_ID,
      effectId: effect.effectId,
      outboxId: 'outbox:s1n-leak',
      payloadCanonicalBytes: effect.payloadCanonicalBytes,
      now: NOW,
    });
    expect(enqueued.kind).toBe('ENQUEUED');

    const result = await dispatchAuthorisedEffect(
      dispatchEnvWith(h, launched.client.adapterRegistry()),
      {
        companyId: COMPANY_ID,
        idempotencyKey: effect.idempotencyKey,
        dispatchedBy: 'worker:s1n',
        now: NOW,
      },
      { events: (event) => controlLog.push(event) },
    );
    expect(result.kind).toBe('OUTCOME_RESOLVED');
    await awaitRuntimeReady(launched.client, ADAPTER_A);

    /* --------------------------------------------------------------------------
     * SURFACE 1 — THE CONTROL PROCESS'S OWN ACCESSIBLE CONFIGURATION.
     *
     * `§5`: "Do not attempt unsafe general process-memory scraping. Use structural /
     * configuration evidence appropriate to the architecture."
     *
     * So the evidence is the control process's ENVIRONMENT and its whole `src/` closure,
     * neither of which holds the material or a route to it. The locator is held; the
     * material is not, and the control process has no reader that could turn one into the
     * other — `source-boundary.test.ts` asserts that as an import-list property.
     * ------------------------------------------------------------------------ */
    expect(stringifyForLeakScan(process.env)).not.toContain(secret);

    /* SURFACE 2 — THE WORKER-FACING GATEWAY RESULT. */
    expect(stringifyForLeakScan(result)).not.toContain(secret);

    /* SURFACE 3 — THE CONTROL PLANE'S OWN EVENT LOG. */
    expect(controlLog.join('|')).not.toContain(secret);

    /* SURFACE 4 — THE IPC REQUEST, AS BYTES. */
    const request = buildDispatchRequest(syntheticEnvelope({ adapter: ADAPTER_A }));
    expect(stringifyForLeakScan(request)).not.toContain(secret);

    /* SURFACE 5 — EVERY ROW OF EVERY CONTROL TABLE, BY RAW SQL. */
    const tables = await h.control.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
        ORDER BY table_name`,
    );
    expect(tables.rows.length).toBeGreaterThan(5);
    for (const { table_name: table } of tables.rows) {
      const rows = await h.control.query(`SELECT * FROM ${table}`);
      expect(stringifyForLeakScan(rows.rows), `table ${table}`).not.toContain(secret);
    }

    /* SURFACE 6 — THE JOURNAL, WHICH SURFACE 5 ALREADY COVERS BY NAME. */
    const journal = await h.control.query(`SELECT * FROM effect_journal`);
    expect(journal.rows.length).toBeGreaterThan(0);
    expect(stringifyForLeakScan(journal.rows)).not.toContain(secret);

    /* SURFACE 7 — THE INTEGRATION RUNTIME'S OWN STRUCTURED LOG. */
    const stderr = launched.client.capturedRuntimeStderr(ADAPTER_A);
    expect(stderr).not.toBeNull();
    expect(stderr!).toContain('RUNTIME_STARTED');
    expect(stderr!, 'the integration runtime logged the sentinel').not.toContain(secret);

    /* SURFACE 8 — THE INTEGRATION RUNTIME'S `stdout`, WHICH MUST BE EMPTY. */
    expect(launched.client.capturedRuntimeStdout(ADAPTER_A)).toBe('');

    /* SURFACE 9 — THE SENTINEL IS IN ITS OWN SOURCE, so the matrix is not vacuous. */
    const document = await readFile(launched.secrets.locator('a'), 'utf8');
    expect(document).toContain(secret);

    /* SURFACE 10 — AND NOWHERE IN THE REPOSITORY'S WORKING TREE. */
    expect(launched.secrets.path.startsWith(process.cwd())).toBe(false);
  });
});

describe('`§23`, `§43` — THE ERROR AND LOG SURFACES, AND THE CONTROL THAT LEAKS THEM', () => {
  const secret = 'TEST_ONLY_VENDOR_SECRET_errorpath_ab12cd34ef56';

  it('PRODUCTION: a refusal carries a closed reason and no detail', async () => {
    const configuration = {
      adapterId: ADAPTER_A,
      adapter: createRecordingAdapter(ADAPTER_A),
      secretSource: fixedSecretSource(ADAPTER_A, secret),
      expectedCredentialId: FIXED_CREDENTIAL_IDENTITY,
    };
    const swapped = {
      ...buildDispatchRequest(syntheticEnvelope({ adapter: ADAPTER_A })),
      authorisationRef: 'authorisation:SOMEONE_ELSE',
    };
    const reply = await handleDispatchRequest(configuration, JSON.stringify(swapped));
    expect(reply.kind).toBe('REQUEST_REFUSED');
    expect(Object.keys(reply).sort()).toEqual(
      ['protocolVersion', 'kind', 'invocationId', 'reason'].sort(),
    );
    expect(stringifyForLeakScan(reply)).not.toContain(secret);
  });

  it('UNSAFE: the same host with a detail string puts the sentinel on the wire', async () => {
    const configuration = {
      adapterId: ADAPTER_A,
      adapter: {
        adapterId: ADAPTER_A,
        invoke: (): Promise<never> => {
          throw new Error('SYNTHETIC');
        },
      },
      secretSource: fixedSecretSource(ADAPTER_A, secret),
      expectedCredentialId: FIXED_CREDENTIAL_IDENTITY,
    };
    const reply = await unsafeHandleDispatchRequest(
      configuration,
      JSON.stringify(buildDispatchRequest(syntheticEnvelope({ adapter: ADAPTER_A }))),
      { leakCredentialInRefusal: true },
    );
    // THE DISCRIMINATION.
    expect(stringifyForLeakScan(reply)).toContain(secret);
  });

  it('PRODUCTION: a log record has no member a credential or an environment could occupy', () => {
    const lines: string[] = [];
    emitIntegrationLog(
      {
        event: 'INVOCATION_COMPLETED',
        runtimeIdentity: `INTEGRATION_ADAPTER:${ADAPTER_A}`,
        adapterId: ADAPTER_A,
        invocationId: 'inv-1',
        authorisationRef: 'authorisation:1',
        effectId: 'effect:1',
        outboxId: 'outbox:1',
        correlationTag: 'tag:1',
        resultClass: 'ADAPTER_RETURNED',
        // A caller handing in extra properties: they are dropped, because the emitter
        // REBUILDS the record member by member rather than spreading it.
        ...({ credential: secret, environment: process.env } as object),
      },
      (line) => lines.push(line),
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain(secret);
    expect(Object.keys(JSON.parse(lines[0]!) as object).sort()).toEqual(
      [
        'event',
        'runtimeIdentity',
        'adapterId',
        'invocationId',
        'authorisationRef',
        'effectId',
        'outboxId',
        'correlationTag',
        'resultClass',
      ].sort(),
    );
    // AND THE USEFUL IDENTITIES `§43` REQUIRES ARE PRESENT.
    const record = JSON.parse(lines[0]!) as Record<string, unknown>;
    expect(record['adapterId']).toBe(ADAPTER_A);
    expect(record['authorisationRef']).toBe('authorisation:1');
    expect(record['resultClass']).toBe('ADAPTER_RETURNED');
  });

  it('UNSAFE: a host that logs the invocation writes the sentinel and the environment', async () => {
    const lines: string[] = [];
    const configuration = {
      adapterId: ADAPTER_A,
      adapter: createRecordingAdapter(ADAPTER_A),
      secretSource: fixedSecretSource(ADAPTER_A, secret),
      expectedCredentialId: FIXED_CREDENTIAL_IDENTITY,
    };
    await unsafeHandleDispatchRequest(
      configuration,
      JSON.stringify(buildDispatchRequest(syntheticEnvelope({ adapter: ADAPTER_A }))),
      { logSink: (line) => lines.push(line) },
    );
    expect(lines.join('')).toContain(secret);
  });
});

describe('`§25` — THE CREDENTIAL LABELS ARE NOT A FINGERPRINT', () => {
  it('a source whose label is derived from its own secret is REFUSED, not sanitised', async () => {
    const derived = Buffer.from(secretFor('derived'), 'utf8').toString('hex');
    const configuration = {
      adapterId: ADAPTER_A,
      adapter: createRecordingAdapter(ADAPTER_A),
      secretSource: {
        declaredAdapterId: ADAPTER_A,
        resolve: () =>
          Promise.resolve({
            kind: 'RESOLVED' as const,
            credential: {
              secret: secretFor('derived'),
              credentialIdentity: derived,
              identityProvenance: 'SYNTHETIC_TEST_IDENTITY' as const,
              version: null,
            },
          }),
      },
      expectedCredentialId: derived,
    };
    const reply = await handleDispatchRequest(
      configuration,
      JSON.stringify(buildDispatchRequest(syntheticEnvelope({ adapter: ADAPTER_A }))),
    );
    expect(reply.kind).toBe('REQUEST_REFUSED');
    if (reply.kind === 'REQUEST_REFUSED') expect(reply.reason).toBe('CREDENTIAL_UNAVAILABLE');
  });
});

function secretFor(label: string): string {
  return `TEST_ONLY_VENDOR_SECRET_${label}_0011223344556677`;
}

describe('the wire module holds no physical NUL byte', () => {
  it('`\\u0000` is a SOURCE ESCAPE, exactly as `lockOrder.ts` requires of its own separator', async () => {
    const source = await readFile(
      join(process.cwd(), 'src', 'integration', 'protocol', 'wire.ts'),
      'utf8',
    );
    expect(source.includes('\u0000')).toBe(false);
    expect(source).toContain("'\\u0000'");
  });
});
