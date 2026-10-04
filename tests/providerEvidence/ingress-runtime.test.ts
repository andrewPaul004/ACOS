import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { connect } from 'node:net';
import { join } from 'node:path';

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createAuditEvidenceIngressPool } from '../../src/audit/db/auditPool.js';
import { normaliseAuthenticatedBatch } from '../../src/audit/providerEvidence/eventPayload.js';
import {
  i20ProviderOperand,
  observeCorrelation,
  pushInverseObservation,
} from '../../src/audit/providerEvidence/evidenceReader.js';
import {
  persistAuthenticatedBatch,
  type BatchPersister,
  type EvidenceChannelContext,
} from '../../src/audit/providerEvidence/evidenceStore.js';
import {
  startProviderEvidenceIngress,
  type StartedProviderEvidenceIngress,
} from '../../src/audit/providerEvidence/ingressMain.js';
import {
  MAX_PROVIDER_EVIDENCE_BODY_BYTES,
  type IngressLogRecord,
} from '../../src/audit/providerEvidence/receiver.js';
import type { Pool } from '../../src/db/pool.js';
import { compareI20 } from '../../validation/sendgrid/harness/i20.js';
import { auditSql, createAuditHarness, type AuditHarness } from '../support/auditHarness.js';
import type { ControlArtifactFixture } from '../support/controlArtifactFixture.js';
import {
  ACCEPTED_EVENT_CLASSES,
  TEST_INGRESS_IDENTITY,
  TEST_ONLY_WEBHOOK_SIGNER,
  TEST_ONLY_WEBHOOK_SIGNER_B,
  TEST_PROVIDER,
  bodyOf,
  correlationTag,
  ingressEnvironment,
  processedEvent,
  providerEvidenceArtifactFixture,
  pushRecord,
  readRecord,
  signWebhook,
} from '../support/providerEvidenceFixture.js';

/**
 * THE PROVIDER-EVIDENCE INGRESS, END TO END: a real listener, real sockets carrying exact bytes,
 * the audit plane's own control-artifact verification, and the real audit store under the
 * ingress role.
 */

const HOST = 'webhook.example.test';
const PATH = '/provider-evidence/sendgrid';
const TIMESTAMP = '1760000500';

interface RawResponse {
  readonly status: number;
  readonly raw: string;
}

/**
 * Send EXACT bytes over a socket. The header list is written as given — duplicates, case and all —
 * which no HTTP client library will do for us.
 */
function rawRequest(
  port: number,
  input: {
    readonly method?: string;
    readonly target?: string;
    readonly headers: readonly (readonly [string, string])[];
    readonly body?: Buffer;
    /** Send the headers and then STOP, without the body the headers promise. */
    readonly withholdBody?: boolean;
  },
): Promise<RawResponse> {
  return new Promise((resolveResponse, rejectResponse) => {
    const socket = connect(port, '127.0.0.1');
    const chunks: Buffer[] = [];
    const timer = setTimeout(() => {
      socket.destroy();
      rejectResponse(new Error('no response'));
    }, 10_000);
    socket.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
      const text = Buffer.concat(chunks).toString('latin1');
      const match = /^HTTP\/1\.1 (\d{3})/.exec(text);
      if (match !== null && text.includes('\r\n\r\n')) {
        clearTimeout(timer);
        socket.destroy();
        resolveResponse({ status: Number(match[1]), raw: text });
      }
    });
    socket.on('error', (error) => {
      clearTimeout(timer);
      rejectResponse(error);
    });
    const head = [
      `${input.method ?? 'POST'} ${input.target ?? PATH} HTTP/1.1`,
      ...input.headers.map(([name, value]) => `${name}: ${value}`),
      '',
      '',
    ].join('\r\n');
    socket.write(head, 'latin1');
    if (input.body !== undefined && input.withholdBody !== true) socket.write(input.body);
  });
}

function signedHeaders(
  body: Buffer,
  options: {
    readonly host?: string;
    readonly timestamp?: string;
    readonly signature?: string;
    readonly extra?: readonly (readonly [string, string])[];
  } = {},
): (readonly [string, string])[] {
  const timestamp = options.timestamp ?? TIMESTAMP;
  return [
    ['Host', options.host ?? HOST],
    ['Content-Type', 'application/json'],
    ['Content-Length', String(body.length)],
    ['X-Twilio-Email-Event-Webhook-Signature', options.signature ?? signWebhook(timestamp, body)],
    ['X-Twilio-Email-Event-Webhook-Timestamp', timestamp],
    ...(options.extra ?? []),
  ];
}

let audit: AuditHarness;
let fixture: ControlArtifactFixture;
let ingress: StartedProviderEvidenceIngress;
let logs: IngressLogRecord[];

beforeAll(async () => {
  audit = await createAuditHarness();
  fixture = providerEvidenceArtifactFixture();
});

afterAll(async () => {
  await audit.close();
});

async function startIngress(
  overrides: Readonly<Record<string, string | undefined>> = {},
  persist?: BatchPersister,
): Promise<StartedProviderEvidenceIngress> {
  const started = await startProviderEvidenceIngress({
    environment: ingressEnvironment(fixture, overrides),
    log: (record) => logs.push(record),
    ...(persist === undefined ? {} : { persist }),
  });
  if (!started.ready) throw new Error(`ingress did not start: ${started.refusal}`);
  return started;
}

beforeEach(async () => {
  await audit.reset();
  logs = [];
  ingress = await startIngress();
});

afterEach(async () => {
  await ingress.close();
});

async function post(
  events: readonly unknown[],
  options: Parameters<typeof signedHeaders>[1] = {},
): Promise<number> {
  const body = bodyOf(events);
  return (await rawRequest(ingress.port, { headers: signedHeaders(body, options), body })).status;
}

async function count(table: string): Promise<number> {
  const rows = await auditSql<{ n: string }>(audit, `SELECT COUNT(*)::TEXT AS n FROM ${table}`);
  return Number(rows[0]!.n);
}

const WINDOW = { receivedFrom: new Date(0), receivedTo: new Date(Date.now() + 86_400_000) };

function observe(tag: string) {
  return observeCorrelation(audit.evaluator, {
    ...WINDOW,
    provider: TEST_PROVIDER,
    correlationTag: tag,
    acceptedEventClasses: ACCEPTED_EVENT_CLASSES,
  });
}

// =====================================================================================
// STARTUP — verified, bound, listening; or not READY at all.
// =====================================================================================

describe('READY means verified, bound and listening — and the launch echo can only REFUSE', () => {
  it('a launch echo that differs from the signed ingress_identity prevents READY', async () => {
    for (const echo of [
      undefined,
      '',
      `${TEST_INGRESS_IDENTITY}/`,
      TEST_INGRESS_IDENTITY.toUpperCase(),
      'https://other.example.test/provider-evidence/sendgrid',
    ]) {
      const started = await startProviderEvidenceIngress({
        environment: ingressEnvironment(fixture, { ACOS_PROVIDER_EVIDENCE_INGRESS_ECHO: echo }),
      });
      expect(started.ready, String(echo)).toBe(false);
      if (!started.ready) expect(started.refusal).toBe('LAUNCH_ECHO_MISMATCH');
    }
  });

  it('a read-mode channel, an undeclared provider and an unverified package never become READY', async () => {
    const read = await startProviderEvidenceIngress({
      environment: ingressEnvironment(fixture, { ACOS_PROVIDER_EVIDENCE_PROVIDER: 'synthetic_esp' }),
    });
    expect(read).toMatchObject({ ready: false, refusal: 'CHANNEL_NOT_SIGNED_PROVIDER_PUSH' });
    const undeclared = await startProviderEvidenceIngress({
      environment: ingressEnvironment(fixture, { ACOS_PROVIDER_EVIDENCE_PROVIDER: 'other_esp' }),
    });
    expect(undeclared).toMatchObject({ ready: false, refusal: 'CHANNEL_NOT_DECLARED' });
    const unpinned = await startProviderEvidenceIngress({
      environment: ingressEnvironment(fixture, { ACOS_AUDIT_EXPECTED_ACTIVE_MANIFEST_ID: '0'.repeat(64) }),
    });
    expect(unpinned).toMatchObject({ ready: false, refusal: 'AUDIT_CONTROL_ARTIFACTS_NOT_VERIFIED' });
  });

  it('a class-28 record presented OUTSIDE the verified bundle is not authority', async () => {
    // A package whose class 28 was edited after signing: the audit plane's own hash check
    // refuses it, so no listener ever binds to the edited record.
    const tampered = providerEvidenceArtifactFixture([readRecord(), pushRecord()]);
    const auditCopy = join(tampered.auditRoot, 'class-28.provider-evidence-trust.json');
    const { writeFileSync } = await import('node:fs');
    writeFileSync(
      auditCopy,
      readFileSync(auditCopy, 'utf8').replace(
        TEST_ONLY_WEBHOOK_SIGNER.publicKeyText,
        TEST_ONLY_WEBHOOK_SIGNER_B.publicKeyText,
      ),
    );
    const started = await startProviderEvidenceIngress({ environment: ingressEnvironment(tampered) });
    expect(started).toMatchObject({ ready: false, refusal: 'AUDIT_CONTROL_ARTIFACTS_NOT_VERIFIED' });
  });

  it('a verification key in the ENVIRONMENT or in the REQUEST is not authority', async () => {
    await ingress.close();
    ingress = await startIngress({
      ACOS_PROVIDER_EVIDENCE_VERIFICATION_KEY: TEST_ONLY_WEBHOOK_SIGNER_B.publicKeyText,
      SENDGRID_WEBHOOK_PUBLIC_KEY: TEST_ONLY_WEBHOOK_SIGNER_B.publicKeyText,
    });
    const body = bodyOf([processedEvent(correlationTag())]);
    const signedByB = signWebhook(TIMESTAMP, body, TEST_ONLY_WEBHOOK_SIGNER_B);
    const viaEnv = await rawRequest(ingress.port, {
      headers: signedHeaders(body, {
        signature: signedByB,
        extra: [['X-Verification-Key', TEST_ONLY_WEBHOOK_SIGNER_B.publicKeyText]],
      }),
      body,
    });
    expect(viaEnv.status).toBe(401);
    expect(await count('provider_evidence_observation')).toBe(0);
  });
});

// =====================================================================================
// THE PERIMETER — refused before the body is read.
// =====================================================================================

describe('`48 §8` G1, G2, G12 — one route, POST only, the signed identity only', () => {
  it('the wrong path, host, port, query and a platform default hostname are refused BEFORE the body is read', async () => {
    const body = bodyOf([processedEvent(correlationTag())]);
    const cases: { target?: string; host?: string }[] = [
      { target: '/provider-evidence/other' },
      { target: `${PATH}/` },
      { target: `${PATH}?probe=1` },
      { target: `https://${HOST}${PATH}` },
      { host: 'other.example.test' },
      { host: `${HOST}:443` },
      { host: 'acos-ingress.azurecontainerapps.io' },
      { host: 'WEBHOOK.EXAMPLE.TEST:443' },
    ];
    for (const entry of cases) {
      // THE BODY IS WITHHELD. A receiver that waited for it would never answer.
      const response = await rawRequest(ingress.port, {
        ...(entry.target === undefined ? {} : { target: entry.target }),
        headers: signedHeaders(body, entry.host === undefined ? {} : { host: entry.host }),
        body,
        withholdBody: true,
      });
      expect(response.status, JSON.stringify(entry)).toBe(404);
    }
    expect(await count('provider_evidence_observation')).toBe(0);
  });

  it('the host is compared case-insensitively, and the signed value is otherwise exact', async () => {
    expect(await post([processedEvent(correlationTag())], { host: 'WEBHOOK.example.TEST' })).toBe(204);
  });

  it('X-Forwarded-Host, X-Forwarded-Proto and Forwarded cannot override the target', async () => {
    const body = bodyOf([processedEvent(correlationTag())]);
    const forwarded = await rawRequest(ingress.port, {
      headers: signedHeaders(body, {
        host: 'other.example.test',
        extra: [
          ['X-Forwarded-Host', HOST],
          ['X-Forwarded-Proto', 'https'],
          ['Forwarded', `host=${HOST};proto=https`],
        ],
      }),
      body,
      withholdBody: true,
    });
    expect(forwarded.status).toBe(404);
    // …and a forwarded header claiming plaintext changes nothing either: it is never read.
    const ignored = await rawRequest(ingress.port, {
      headers: signedHeaders(body, { extra: [['X-Forwarded-Proto', 'http']] }),
      body,
    });
    expect(ignored.status).toBe(204);
  });

  it('POST only', async () => {
    for (const method of ['GET', 'PUT', 'DELETE', 'OPTIONS']) {
      const response = await rawRequest(ingress.port, {
        method,
        headers: [['Host', HOST]],
      });
      expect(response.status, method).toBe(405);
    }
  });

  it('exactly one application/json content type', async () => {
    const body = bodyOf([processedEvent(correlationTag())]);
    for (const contentType of ['text/plain', 'application/x-www-form-urlencoded', 'application/json; charset=latin1']) {
      const headers = signedHeaders(body).map(([name, value]) =>
        name === 'Content-Type' ? ([name, contentType] as const) : ([name, value] as const),
      );
      expect((await rawRequest(ingress.port, { headers, body })).status, contentType).toBe(415);
    }
    const twice = await rawRequest(ingress.port, {
      headers: [...signedHeaders(body), ['Content-Type', 'application/json']],
      body,
    });
    expect(twice.status).toBe(415);
    const charset = signedHeaders(body).map(([name, value]) =>
      name === 'Content-Type' ? ([name, 'application/json; charset=utf-8'] as const) : ([name, value] as const),
    );
    expect((await rawRequest(ingress.port, { headers: charset, body })).status).toBe(204);
  });

  it('an over-limit body is refused without evidence — by declared length and while streaming', async () => {
    const big = Buffer.alloc(MAX_PROVIDER_EVIDENCE_BODY_BYTES + 1, 0x20);
    const declared = await rawRequest(ingress.port, {
      headers: signedHeaders(big),
      body: big,
      withholdBody: true,
    });
    expect(declared.status).toBe(413);
    const chunkedHeaders = signedHeaders(big).filter(([name]) => name !== 'Content-Length');
    const chunked = Buffer.concat([
      Buffer.from(`${big.length.toString(16)}\r\n`, 'latin1'),
      big,
      Buffer.from('\r\n0\r\n\r\n', 'latin1'),
    ]);
    const streamed = await rawRequest(ingress.port, {
      headers: [...chunkedHeaders, ['Transfer-Encoding', 'chunked']],
      body: chunked,
    });
    expect(streamed.status).toBe(413);
    expect(await count('provider_evidence_observation')).toBe(0);
  });
});

// =====================================================================================
// AUTHENTICATION, over the wire.
// =====================================================================================

describe('`48 §8` G5, G6 — headers and signature over the exact raw bytes', () => {
  it('duplicate signature or timestamp headers on the WIRE are refused, and nothing is stored', async () => {
    const body = bodyOf([processedEvent(correlationTag())]);
    const signature = signWebhook(TIMESTAMP, body);
    const dupSignature = await rawRequest(ingress.port, {
      headers: [...signedHeaders(body), ['X-Twilio-Email-Event-Webhook-Signature', signature]],
      body,
    });
    expect(dupSignature.status).toBe(401);
    const dupTimestamp = await rawRequest(ingress.port, {
      headers: [...signedHeaders(body), ['x-twilio-email-event-webhook-timestamp', TIMESTAMP]],
      body,
    });
    expect(dupTimestamp.status).toBe(401);
    expect(logs.map((record) => record.resultClass)).toEqual([
      'SIGNATURE_HEADER_REPEATED',
      'TIMESTAMP_HEADER_REPEATED',
    ]);
    expect(await count('provider_evidence_observation')).toBe(0);
  });

  it('missing headers, a bad signature and a mutated body are 401 with an EMPTY response body', async () => {
    const body = bodyOf([processedEvent(correlationTag())]);
    const missing = await rawRequest(ingress.port, {
      headers: signedHeaders(body).filter(([name]) => !name.includes('Signature')),
      body,
    });
    expect(missing.status).toBe(401);
    const mutated = Buffer.from(body.toString('utf8').replace('[', '[ '), 'utf8');
    const bad = await rawRequest(ingress.port, {
      headers: signedHeaders(mutated, { signature: signWebhook(TIMESTAMP, body) }),
      body: mutated,
    });
    expect(bad.status).toBe(401);
    for (const response of [missing, bad]) {
      expect(response.raw).toMatch(/content-length: 0/i);
      expect(response.raw.split('\r\n\r\n')[1]).toBe('');
    }
    expect(await count('provider_evidence_observation')).toBe(0);
  });

  it('the body is parsed ONLY after verification: an unauthenticated non-JSON body is 401, an authenticated one is an INCOMPLETE observation', async () => {
    const garbage = Buffer.from('{{{ not json', 'utf8');
    const unauthenticated = await rawRequest(ingress.port, {
      headers: signedHeaders(garbage, { signature: signWebhook(TIMESTAMP, Buffer.from('other')) }),
      body: garbage,
    });
    expect(unauthenticated.status).toBe(401);
    expect(await count('provider_evidence_observation')).toBe(0);
    const authenticated = await rawRequest(ingress.port, { headers: signedHeaders(garbage), body: garbage });
    expect(authenticated.status).toBe(204);
    expect(
      await auditSql(audit, 'SELECT status, incomplete_reason FROM provider_evidence_observation'),
    ).toEqual([{ status: 'INCOMPLETE', incomplete_reason: 'BODY_NOT_JSON' }]);
  });

  it('a DELAYED but validly signed event is still evidence — no freshness window is invented', async () => {
    const tag = correlationTag();
    expect(await post([processedEvent(tag, { timestamp: 1_000_000_000 })], { timestamp: '1000000001' })).toBe(204);
    expect((await observe(tag)).observedAcceptedCount).toBe(1);
  });

  it('the receiver source orders verification BEFORE the parse, and never parses in the profile', () => {
    const source = readFileSync(join('src', 'audit', 'providerEvidence', 'receiver.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');
    const verifyAt = source.indexOf('verifySendGridEventWebhookV1({');
    const parseAt = source.indexOf('normaliseAuthenticatedBatch(body');
    expect(verifyAt).toBeGreaterThan(0);
    expect(parseAt).toBeGreaterThan(verifyAt);
    expect(source).not.toContain('JSON.parse');
  });
});

// =====================================================================================
// PERSISTENCE, DEDUPLICATION, COUNTING.
// =====================================================================================

describe('`A0009` — durable, data-minimised evidence; `sg_event_id` dedup; distinct `sg_message_id` count', () => {
  it('a valid processed event is ONE observation and ONE event row, and NOTHING personal is stored', async () => {
    const tag = correlationTag();
    const event = processedEvent(tag, { email: 'recipient-person@example.test', subject: 'Hello', from: 'sender@example.test' });
    const body = bodyOf([event]);
    expect((await rawRequest(ingress.port, { headers: signedHeaders(body), body })).status).toBe(204);

    const observations = await auditSql<Record<string, unknown>>(audit, 'SELECT * FROM provider_evidence_observation');
    expect(observations).toHaveLength(1);
    expect(observations[0]).toMatchObject({
      provider: TEST_PROVIDER,
      status: 'COMPLETE',
      key_identity: TEST_ONLY_WEBHOOK_SIGNER.keyIdentity,
      verification_profile: 'SENDGRID_EVENT_WEBHOOK_V1',
      provider_signature_timestamp: TIMESTAMP,
      raw_body_sha256: createHash('sha256').update(body).digest('hex'),
    });
    const events = await auditSql<Record<string, unknown>>(audit, 'SELECT * FROM provider_evidence_event');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      sg_event_id: event.sg_event_id,
      sg_message_id: event.sg_message_id,
      event_class: 'processed',
      acos_correlation_tag: tag,
    });

    // NO RAW BODY, NO ADDRESS, NO SUBJECT, NO PROVIDER JSON — in any column of any table.
    const everything = JSON.stringify([
      ...observations,
      ...events,
      ...(await auditSql(audit, 'SELECT * FROM provider_evidence_inconsistency')),
    ]);
    for (const forbidden of ['@example.test', 'Hello', 'smtp-id', '"email"', body.toString('utf8')]) {
      expect(everything).not.toContain(forbidden);
    }
    const columns = await auditSql<{ column_name: string; data_type: string }>(
      audit,
      `SELECT column_name, data_type FROM information_schema.columns
        WHERE table_name LIKE 'provider_evidence_%'`,
    );
    for (const column of columns) {
      // The body's SHA-256 is the ONE body-derived column, and it is a hash.
      if (column.column_name === 'raw_body_sha256') continue;
      expect(column.column_name).not.toMatch(/body|payload|email|recipient|sender|subject|content|json/);
      expect(column.data_type).not.toMatch(/json|bytea/);
    }
  });

  it('THE SAME EVENT DELIVERED TWICE is one semantic row; the retry is acknowledged after the row is confirmed', async () => {
    const tag = correlationTag();
    const event = processedEvent(tag);
    expect(await post([event])).toBe(204);
    expect(await post([event])).toBe(204);
    expect(await count('provider_evidence_event')).toBe(1);
    expect(await count('provider_evidence_observation')).toBe(2);
    expect(logs.map((record) => [record.inserted, record.confirmedExisting])).toEqual([
      [1, 0],
      [0, 1],
    ]);
    expect((await observe(tag)).observedAcceptedCount).toBe(1);
  });

  it('two different event ids bearing ONE message id are ONE accepted message', async () => {
    const tag = correlationTag();
    await post([processedEvent(tag, { sg_message_id: 'msg-same' })]);
    await post([processedEvent(tag, { sg_message_id: 'msg-same' })]);
    expect(await count('provider_evidence_event')).toBe(2);
    const observation = await observe(tag);
    expect(observation.observedAcceptedCount).toBe(1);
    expect(observation.i36).toBe('ONE_OBSERVED_NOT_FINAL');
  });

  it('TWO DISTINCT MESSAGE IDS UNDER ONE CORRELATION ARE AN EXCESS — immediate duplicate-send evidence', async () => {
    const tag = correlationTag();
    await post([processedEvent(tag, { sg_message_id: 'msg-1' })]);
    await post([processedEvent(tag, { sg_message_id: 'msg-2' })]);
    const observation = await observe(tag);
    expect(observation.observedAcceptedCount).toBe(2);
    expect(observation.providerMessageIds).toEqual(['msg-1', 'msg-2']);
    expect(observation.i36).toBe('EXCESS_DUPLICATE_SEND_EVIDENCE');
    expect(observation.completenessEstablished).toBe(false);
  });

  it('the SAME event id with CHANGED semantic fields is an inconsistency: no overwrite, the batch is INCOMPLETE, both correlations are tainted', async () => {
    const original = correlationTag();
    const presented = correlationTag();
    const event = processedEvent(original, { sg_event_id: 'evt-conflict' });
    const sibling = processedEvent(presented);
    await post([event]);
    expect(await post([{ ...event, acos_correlation_tag: presented }, sibling])).toBe(204);

    expect(await auditSql(audit, 'SELECT acos_correlation_tag FROM provider_evidence_event')).toEqual([
      { acos_correlation_tag: original },
    ]);
    expect(
      await auditSql(audit, `SELECT status, incomplete_reason FROM provider_evidence_observation ORDER BY observation_id`),
    ).toEqual([
      { status: 'COMPLETE', incomplete_reason: null },
      { status: 'INCOMPLETE', incomplete_reason: 'EVENT_IDENTITY_INCONSISTENT' },
    ]);
    expect(
      await auditSql(audit, 'SELECT sg_event_id, recorded_correlation_tag, presented_correlation_tag FROM provider_evidence_inconsistency'),
    ).toEqual([{ sg_event_id: 'evt-conflict', recorded_correlation_tag: original, presented_correlation_tag: presented }]);
    // The sibling did NOT escape the rolled-back transaction.
    expect(await count('provider_evidence_event')).toBe(1);
    for (const tag of [original, presented]) {
      const observation = await observe(tag);
      expect(observation.knownIncomplete).toBe(true);
      expect(observation.incompleteReasons).toContain('EVENT_IDENTITY_INCONSISTENT');
    }
  });

  it('A MALFORMED SECOND PROCESSED EVENT: acknowledged after an INCOMPLETE observation commits, and the readable sibling is NOT a count of one', async () => {
    const tag = correlationTag();
    expect(await post([processedEvent(tag), processedEvent(tag, { sg_message_id: undefined })])).toBe(204);
    expect(await count('provider_evidence_event')).toBe(0);
    const observation = await observe(tag);
    expect(observation.observedAcceptedCount).toBe(0);
    expect(observation.knownIncomplete).toBe(true);
    expect(observation.incompleteReasons).toEqual(['ACCEPTED_EVENT_MESSAGE_IDENTITY_INVALID']);
  });

  it('a non-accepted event type is stored nowhere and counted for nothing', async () => {
    const tag = correlationTag();
    expect(await post([{ ...processedEvent(tag), event: 'delivered' }])).toBe(204);
    expect(await count('provider_evidence_event')).toBe(0);
    expect((await observe(tag)).knownIncomplete).toBe(false);
  });

  it('the store is APPEND-ONLY, even for the owner', async () => {
    await post([processedEvent(correlationTag())]);
    for (const statement of [
      `UPDATE provider_evidence_event SET sg_message_id = 'x'`,
      'DELETE FROM provider_evidence_event',
      'TRUNCATE provider_evidence_observation CASCADE',
      `UPDATE provider_evidence_observation SET status = 'COMPLETE'`,
    ]) {
      await expect(auditSql(audit, statement), statement).rejects.toThrow();
    }
  });

  it('an event row cannot hang off an INCOMPLETE observation — enforced by the store', async () => {
    await post([processedEvent(correlationTag(), { timestamp: 'bad' })]);
    const [observation] = await auditSql<{ observation_id: string }>(
      audit,
      'SELECT observation_id::TEXT AS observation_id FROM provider_evidence_observation',
    );
    await expect(
      auditSql(
        audit,
        `INSERT INTO provider_evidence_event
           (provider, sg_event_id, sg_message_id, event_class, acos_correlation_tag,
            provider_event_timestamp, received_at, key_identity, trust_artifact_digest, observation_id)
         VALUES ($1, 'e', 'm', 'processed', $2, 1, now(), $3, $3, $4)`,
        [TEST_PROVIDER, correlationTag(), TEST_ONLY_WEBHOOK_SIGNER.keyIdentity, observation!.observation_id],
      ),
    ).rejects.toThrow(/may not reference observation/);
  });

  it('the ingress role cannot reach the audit journal, incidents or the quota ledger', async () => {
    const pool = createAuditEvidenceIngressPool();
    try {
      for (const statement of [
        'SELECT 1 FROM audit_journal LIMIT 1',
        'SELECT 1 FROM audit_incident LIMIT 1',
        `UPDATE provider_evidence_event SET event_class = 'x'`,
      ]) {
        await expect(pool.query(statement), statement).rejects.toThrow();
      }
    } finally {
      await pool.end();
    }
  });
});

// =====================================================================================
// DURABILITY BEFORE ACKNOWLEDGEMENT, AND FAILURE.
// =====================================================================================

describe('`48 §8` G11 — durable commit precedes acknowledgement', () => {
  it('a store failure before commit is a NON-2xx, so the provider retries', async () => {
    await ingress.close();
    ingress = await startIngress({}, () => Promise.reject(new Error('audit store unavailable')));
    expect(await post([processedEvent(correlationTag())])).toBe(503);
    expect(logs.at(-1)?.event).toBe('INGRESS_PERSIST_FAILED');
  });

  it('a real database failure (the store unreachable) is a NON-2xx', async () => {
    await ingress.close();
    const { createPool } = await import('../../src/db/pool.js');
    const dead: Pool = createPool({
      connectionString: 'postgres://nobody:nothing@127.0.0.1:1/none',
      max: 1,
    });
    ingress = await startIngress({}, (channel, receipt, batch) =>
      persistAuthenticatedBatch(dead, channel, receipt, batch),
    );
    expect(await post([processedEvent(correlationTag())])).toBe(503);
    await dead.end();
  });

  it('NO 2xx IS SENT WHILE THE COMMIT IS STILL OUTSTANDING', async () => {
    await ingress.close();
    let release: (() => void) | null = null;
    const gate = new Promise<void>((resolveGate) => {
      release = resolveGate;
    });
    const pool = createAuditEvidenceIngressPool();
    let committed = false;
    ingress = await startIngress({}, async (channel, receipt, batch) => {
      await gate;
      const outcome = await persistAuthenticatedBatch(pool, channel, receipt, batch);
      committed = true;
      return outcome;
    });
    const pending = post([processedEvent(correlationTag())]);
    const raced = await Promise.race([
      pending.then(() => 'ANSWERED'),
      new Promise((resolveWait) => setTimeout(() => resolveWait('WAITING'), 500)),
    ]);
    expect(raced).toBe('WAITING');
    expect(committed).toBe(false);
    release!();
    expect(await pending).toBe(204);
    expect(committed).toBe(true);
    await pool.end();
  });
});

describe('`24 §2` — CONCURRENT duplicate deliveries remain ONE durable semantic event', () => {
  it('two simultaneous POSTs of one event identity leave exactly one row, and both are acknowledged', async () => {
    const tag = correlationTag();
    const event = processedEvent(tag);
    const statuses = await Promise.all([post([event]), post([event]), post([event])]);
    expect(statuses).toEqual([204, 204, 204]);
    expect(await count('provider_evidence_event')).toBe(1);
  });

  it('racing the store directly: one inserts, every other loser CONFIRMS the existing row', async () => {
    const pool = createAuditEvidenceIngressPool();
    try {
      const tag = correlationTag();
      const body = bodyOf([processedEvent(tag, { sg_event_id: 'evt-race' })]);
      const batch = normaliseAuthenticatedBatch(body, ACCEPTED_EVENT_CLASSES);
      const channel: EvidenceChannelContext = {
        provider: TEST_PROVIDER,
        trustArtifactDigest: 'a'.repeat(64),
        trustArtifactVersion: 'v',
        keyIdentity: TEST_ONLY_WEBHOOK_SIGNER.keyIdentity,
        verificationProfile: 'SENDGRID_EVENT_WEBHOOK_V1',
      };
      const outcomes = await Promise.all(
        Array.from({ length: 6 }, () =>
          persistAuthenticatedBatch(pool, channel, {
            timestampText: TIMESTAMP,
            rawBodySha256: createHash('sha256').update(body).digest('hex'),
            receivedAt: new Date(),
          }, batch),
        ),
      );
      const inserted = outcomes.reduce((sum, o) => sum + (o.kind === 'COMPLETE_RECORDED' ? o.inserted : 0), 0);
      const confirmed = outcomes.reduce((sum, o) => sum + (o.kind === 'COMPLETE_RECORDED' ? o.confirmedExisting : 0), 0);
      expect(outcomes.every((o) => o.kind === 'COMPLETE_RECORDED')).toBe(true);
      expect(inserted).toBe(1);
      expect(confirmed).toBe(5);
      expect(await count('provider_evidence_event')).toBe(1);
    } finally {
      await pool.end();
    }
  });
});

// =====================================================================================
// FINALITY — authentication is not completeness.
// =====================================================================================

describe('ADR-027 decision 6 — authentication is not completeness, and absence is not zero', () => {
  it('ZERO observations is an observation, never NOT_SENT_CONFIRMED', async () => {
    const observation = await observe(correlationTag());
    expect(observation).toMatchObject({
      observedAcceptedCount: 0,
      i36: 'NONE_OBSERVED_NOT_FINAL',
      completenessEstablished: false,
    });
  });

  it('ONE observation does not establish completeness, and quiet local polling never does either', async () => {
    const tag = correlationTag();
    await post([processedEvent(tag)]);
    for (let poll = 0; poll < 5; poll += 1) {
      const observation = await observe(tag);
      expect(observation.i36).toBe('ONE_OBSERVED_NOT_FINAL');
      expect(observation.completenessEstablished).toBe(false);
    }
  });

  it('nothing in the push runtime can say "never sent", "complete" or "clean", and no retry horizon appears', () => {
    const dir = join('src', 'audit', 'providerEvidence');
    for (const file of readdirSync(dir)) {
      const code = readFileSync(join(dir, file), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/.*$/gm, '$1');
      expect(code, file).not.toMatch(/NOT_SENT_CONFIRMED|NEVER_SENT|CONFIRMED_ABSENT/);
      expect(code, file).not.toMatch(/completenessEstablished:\s*true/);
      expect(code, file).not.toMatch(/horizon|24\s*\*\s*60|86_?400/i);
      expect(code, file).not.toMatch(/'CLEAN'|ALL_PROVIDER_RECORDS_ACCOUNTED/);
    }
  });
});

describe('`I8` and `I20` under push evidence', () => {
  it('an authenticated event with an UNACCOUNTED correlation is a POSITIVE I8 finding immediately', async () => {
    const accounted = correlationTag();
    const stray = correlationTag();
    await post([processedEvent(accounted), processedEvent(stray, { sg_message_id: 'stray-msg' })]);
    const finding = await pushInverseObservation(audit.evaluator, {
      ...WINDOW,
      provider: TEST_PROVIDER,
      accountedCorrelationTags: new Set([accounted]),
      acceptedEventClasses: ACCEPTED_EVENT_CLASSES,
    });
    expect(finding.outcome).toBe('UNACCOUNTED_PROVIDER_ACTIVITY');
    expect(finding.unaccounted.map((entry) => entry.sgMessageId)).toEqual(['stray-msg']);
  });

  it('NO unaccounted event is NOT a clean I8 pass', async () => {
    const accounted = correlationTag();
    await post([processedEvent(accounted)]);
    const finding = await pushInverseObservation(audit.evaluator, {
      ...WINDOW,
      provider: TEST_PROVIDER,
      accountedCorrelationTags: new Set([accounted]),
      acceptedEventClasses: ACCEPTED_EVENT_CLASSES,
    });
    expect(finding.outcome).toBe('NO_UNACCOUNTED_ACTIVITY_SEEN_PERIOD_INCOMPLETE');
    expect(finding.completenessEstablished).toBe(false);
  });

  it('the OBSERVED count is a lower bound; the EXACT numerator is null while completeness is unestablished', async () => {
    const a = correlationTag();
    const b = correlationTag();
    await post([processedEvent(a)]);
    const complete = await i20ProviderOperand(audit.evaluator, {
      ...WINDOW,
      provider: TEST_PROVIDER,
      correlationTags: [a, b],
      acceptedEventClasses: ACCEPTED_EVENT_CLASSES,
    });
    // No incomplete observation, and STILL no exact numerator: authentication is not completeness.
    expect(complete).toMatchObject({
      observedDistinctAcceptedMessages: 1,
      exactAcceptedMessageNumerator: null,
      unresolved: true,
      completenessEstablished: false,
      completenessBasis: { kind: 'UNESTABLISHED' },
    });
    await post([processedEvent(b, { acos_correlation_tag: 'not-a-tag' })]);
    const incomplete = await i20ProviderOperand(audit.evaluator, {
      ...WINDOW,
      provider: TEST_PROVIDER,
      correlationTags: [a, b],
      acceptedEventClasses: ACCEPTED_EVENT_CLASSES,
    });
    expect(incomplete).toMatchObject({
      observedDistinctAcceptedMessages: 1,
      exactAcceptedMessageNumerator: null,
      unresolved: true,
    });
  });

  it('nothing observed is NOT an exact zero', async () => {
    const operand = await i20ProviderOperand(audit.evaluator, {
      ...WINDOW,
      provider: TEST_PROVIDER,
      correlationTags: [correlationTag()],
      acceptedEventClasses: ACCEPTED_EVENT_CLASSES,
    });
    expect(operand).toMatchObject({
      observedDistinctAcceptedMessages: 0,
      exactAcceptedMessageNumerator: null,
      unresolved: true,
    });
  });
});

describe('FINAL CORRECTION G — the audit store and the harness agree: I20 is the distinct message-id UNION', () => {
  it('one message under two correlations plus a second message: both sides say {M1, M2} = 2', async () => {
    const a = correlationTag();
    const b = correlationTag();
    const c = correlationTag();
    await post([
      processedEvent(a, { sg_message_id: 'M1', sg_event_id: 'evt-g-a' }),
      processedEvent(b, { sg_message_id: 'M1', sg_event_id: 'evt-g-b' }),
      processedEvent(c, { sg_message_id: 'M2', sg_event_id: 'evt-g-c' }),
    ]);
    const store = await i20ProviderOperand(audit.evaluator, {
      ...WINDOW,
      provider: TEST_PROVIDER,
      correlationTags: [a, b, c],
      acceptedEventClasses: ACCEPTED_EVENT_CLASSES,
    });
    expect(store.observedDistinctAcceptedMessages).toBe(2);
    const storeIds = new Set(store.perCorrelation.flatMap((observation) => [...observation.providerMessageIds]));
    expect([...storeIds].sort()).toEqual(['M1', 'M2']);

    // The harness, over the SAME per-correlation observations, as live push operands.
    const harness = compareI20(
      store.perCorrelation.map((observation) => ({
        scenarioLabel: observation.correlationTag,
        providerAcceptedCount: null,
        observedProviderMessageIds: observation.providerMessageIds,
        historicalReservationUnits: 1n,
      })),
    );
    expect(harness.observedDistinctAcceptedMessagesLowerBound).toBe(store.observedDistinctAcceptedMessages);
    // Per-scenario counts would have summed to 3.
    expect(store.perCorrelation.reduce((sum, observation) => sum + observation.observedAcceptedCount, 0)).toBe(3);
    // Basis 3 (one unit per correlation): 2 distinct accepted is not an excess, and is not exact.
    expect(harness.verdict).toBe('UNRESOLVED');
    expect(store.exactAcceptedMessageNumerator).toBeNull();
  });
});

describe('`observeCorrelation` reads only events RECEIVED inside the caller interval', () => {
  const RECEIVED_FROM = new Date('2026-01-01T00:00:00.000Z');
  const RECEIVED_TO = new Date('2026-01-01T01:00:00.000Z');
  const CHANNEL: EvidenceChannelContext = {
    provider: TEST_PROVIDER,
    trustArtifactDigest: 'b'.repeat(64),
    trustArtifactVersion: 'v',
    keyIdentity: TEST_ONLY_WEBHOOK_SIGNER.keyIdentity,
    verificationProfile: 'SENDGRID_EVENT_WEBHOOK_V1',
  };

  async function recordAt(
    tag: string,
    messageId: string,
    receivedAt: Date,
    eventId = `evt-${messageId}`,
    expected: 'COMPLETE_RECORDED' | 'INCOMPLETE_RECORDED' = 'COMPLETE_RECORDED',
  ): Promise<void> {
    const pool = createAuditEvidenceIngressPool();
    try {
      const body = bodyOf([processedEvent(tag, { sg_message_id: messageId, sg_event_id: eventId })]);
      const outcome = await persistAuthenticatedBatch(
        pool,
        CHANNEL,
        {
          timestampText: TIMESTAMP,
          rawBodySha256: createHash('sha256').update(body).digest('hex'),
          receivedAt,
        },
        normaliseAuthenticatedBatch(body, ACCEPTED_EVENT_CLASSES),
      );
      expect(outcome.kind).toBe(expected);
    } finally {
      await pool.end();
    }
  }

  function observeInterval(tag: string) {
    return observeCorrelation(audit.evaluator, {
      receivedFrom: RECEIVED_FROM,
      receivedTo: RECEIVED_TO,
      provider: TEST_PROVIDER,
      correlationTag: tag,
      acceptedEventClasses: ACCEPTED_EVENT_CLASSES,
    });
  }

  for (const [label, offsetMs, counted] of [
    ['one millisecond BEFORE the lower endpoint', -1, false],
    ['exactly AT the lower endpoint', 0, true],
    ['INSIDE the interval', 30 * 60_000, true],
    ['exactly AT the upper endpoint', 60 * 60_000, true],
    ['one millisecond AFTER the upper endpoint', 60 * 60_000 + 1, false],
  ] as const) {
    it(`an event received ${label} is ${counted ? 'counted' : 'NOT counted'}`, async () => {
      const tag = correlationTag();
      await recordAt(tag, 'interval-msg', new Date(RECEIVED_FROM.getTime() + offsetMs));
      const observation = await observeInterval(tag);
      expect(observation.providerMessageIds).toEqual(counted ? ['interval-msg'] : []);
      expect(observation.observedAcceptedCount).toBe(counted ? 1 : 0);
    });
  }

  it('events either side of the interval never join an inside event in the count', async () => {
    const tag = correlationTag();
    await recordAt(tag, 'before-msg', new Date(RECEIVED_FROM.getTime() - 1));
    await recordAt(tag, 'inside-msg', new Date(RECEIVED_FROM.getTime() + 1));
    await recordAt(tag, 'after-msg', new Date(RECEIVED_TO.getTime() + 1));
    const observation = await observeInterval(tag);
    expect(observation.providerMessageIds).toEqual(['inside-msg']);
    expect(observation.i36).toBe('ONE_OBSERVED_NOT_FINAL');
  });

  it('an identity inconsistency taints the correlation for its LIFETIME, even when recorded after the interval', async () => {
    const tag = correlationTag();
    await recordAt(tag, 'inside-msg', new Date(RECEIVED_FROM.getTime() + 1));
    expect((await observeInterval(tag)).knownIncomplete).toBe(false);
    // The SAME event identity, presented again AFTER the interval with a different message id.
    await recordAt(tag, 'conflicting-msg', new Date(RECEIVED_TO.getTime() + 3_600_000), 'evt-inside-msg', 'INCOMPLETE_RECORDED');
    const observation = await observeInterval(tag);
    expect(observation.providerMessageIds).toEqual(['inside-msg']);
    expect(observation.knownIncomplete).toBe(true);
    expect(observation.incompleteReasons).toEqual(['EVENT_IDENTITY_INCONSISTENT']);
  });
});

// =====================================================================================
// LOGGING HYGIENE.
// =====================================================================================

describe('logs carry codes, identities, counts and hashes — never content', () => {
  it('no body, address, signature, key or unverified identifier reaches a log record', async () => {
    const tag = correlationTag();
    const event = processedEvent(tag, { email: 'person@example.test', sg_event_id: 'evt-log-probe' });
    const body = bodyOf([event]);
    const signature = signWebhook(TIMESTAMP, body);
    await rawRequest(ingress.port, { headers: signedHeaders(body), body });
    // An UNAUTHENTICATED request carrying an attacker-chosen event id.
    const forged = bodyOf([processedEvent(tag, { sg_event_id: 'attacker-chosen-id' })]);
    await rawRequest(ingress.port, {
      headers: signedHeaders(forged, { signature }),
      body: forged,
    });
    const text = JSON.stringify(logs);
    for (const forbidden of [
      'person@example.test',
      signature,
      TEST_ONLY_WEBHOOK_SIGNER.publicKeyText,
      'attacker-chosen-id',
      'evt-log-probe',
      body.toString('utf8'),
    ]) {
      expect(text).not.toContain(forbidden);
    }
    expect(logs.map((record) => record.event)).toEqual([
      'INGRESS_EVIDENCE_RECORDED',
      'INGRESS_REFUSED_UNAUTHENTICATED',
    ]);
  });
});
