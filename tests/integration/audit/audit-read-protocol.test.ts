import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  AUDIT_READ_PROTOCOL_VERSION,
  MAX_AUDIT_IPC_MESSAGE_BYTES,
  MAX_READ_PERIOD_MS,
  MAX_RECORDS_PER_READ,
  PROVIDER_READ_OPERATIONS,
  PROVIDER_READ_REFUSALS,
  PROVIDER_READ_REQUEST_FIELDS,
  computeReadDigest,
  decodeAuditReaderReply,
  decodeProviderReadRequest,
  encodeAuditReadMessage,
  isProviderReadOperation,
  type ProviderReadRequest,
} from '../../../src/audit/provider/protocol/readWire.js';
import {
  AUDIT_PROVIDER_READER_MEMBERS,
  FORBIDDEN_READER_MEMBERS,
  PROVIDER_READ_BOUNDARY,
  isAuditProviderReader,
  isAuditProviderReaderModule,
} from '../../../src/audit/provider/runtime/auditProviderReader.js';
import { DISPATCH_REQUEST_FIELDS } from '../../../src/integration/protocol/wire.js';

/**
 * `§16` — THE CLOSED READ-ONLY PROTOCOL.
 *
 *   "Closed read-only request protocol. Permit only declared provider-read operations needed
 *    for audit/reconciliation. **No generic URL. No send operation. No credential crosses
 *    IPC.** Unknown operation: **REFUSED.**"
 *
 * Four sentences, four groups of assertions, each against the real decoder.
 */

const PERIOD_START = Date.UTC(2026, 0, 5, 12, 0, 0);
const PERIOD_END = Date.UTC(2026, 0, 5, 13, 0, 0);

function request(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    protocolVersion: AUDIT_READ_PROTOCOL_VERSION,
    kind: 'PROVIDER_READ_REQUEST',
    readId: 'r1',
    operation: 'MESSAGE_ACTIVITY_SEARCH',
    providerId: 'synthetic_esp',
    periodStartMs: PERIOD_START,
    periodEndMs: PERIOD_END,
    correlationTag: 'acos-corr-1',
    providerMessageId: null,
    maxRecords: 10,
    ...overrides,
  });
}

/* ================================================================================
 * 1. NO GENERIC URL
 * ============================================================================== */

describe('`§16` — NO GENERIC URL, and no member one could occupy', () => {
  it('the request field list is closed, and names no destination', () => {
    // A SECOND hand-authored copy. A future member has to be added in two places by someone
    // who reads this list.
    expect([...PROVIDER_READ_REQUEST_FIELDS]).toEqual([
      'protocolVersion',
      'kind',
      'readId',
      'operation',
      'providerId',
      'periodStartMs',
      'periodEndMs',
      'correlationTag',
      'providerMessageId',
      'maxRecords',
    ]);
    for (const forbidden of [
      'url',
      'path',
      'endpoint',
      'host',
      'origin',
      'method',
      'headers',
      'body',
      'query',
      'token',
      'apiKey',
      'authorization',
      'credential',
      'secret',
    ]) {
      expect(PROVIDER_READ_REQUEST_FIELDS as readonly string[], forbidden).not.toContain(
        forbidden,
      );
    }
  });

  it('a request carrying a url is REFUSED as an unknown field, not ignored', () => {
    const decoded = decodeProviderReadRequest(
      request({ url: 'https://attacker.example/collect' }),
    );
    expect(decoded.kind).toBe('REFUSED');
    expect(decoded.kind === 'REFUSED' && decoded.reason).toBe('UNKNOWN_FIELD');
  });

  it('nothing in the audit provider package constructs a URL', () => {
    for (const file of [
      'protocol/readWire.ts',
      'protocol/readerEnvironment.ts',
      'protocol/readerIdentity.ts',
      'plane/auditReadClient.ts',
      'plane/auditReaderRegistry.ts',
      'runtime/auditReadHost.ts',
      'runtime/auditProviderReader.ts',
      'runtime/main.ts',
    ]) {
      const source = readFileSync(
        join(process.cwd(), 'src', 'audit', 'provider', file),
        'utf8',
      );
      expect(source, file).not.toMatch(/new\s+URL\s*\(/);
      expect(source, file).not.toMatch(/https?:\/\/[a-z]/i);
    }
  });
});

/* ================================================================================
 * 2. NO SEND OPERATION
 * ============================================================================== */

describe('`§16` — NO SEND OPERATION, in the protocol or on the reader', () => {
  it('the operation set is closed at three queries', () => {
    expect([...PROVIDER_READ_OPERATIONS]).toEqual([
      'MESSAGE_ACTIVITY_SEARCH',
      'MESSAGE_ACTIVITY_DETAIL',
      'MESSAGE_ACTIVITY_COUNT',
    ]);
    for (const rejected of ['SEND', 'MAIL_SEND', 'CREATE', 'RAW', 'PASSTHROUGH', 'CUSTOM']) {
      expect(isProviderReadOperation(rejected), rejected).toBe(false);
    }
  });

  it('an UNKNOWN operation is REFUSED — §16, verbatim', () => {
    const decoded = decodeProviderReadRequest(request({ operation: 'MAIL_SEND' }));
    expect(decoded.kind).toBe('REFUSED');
    expect(decoded.kind === 'REFUSED' && decoded.reason).toBe('UNKNOWN_OPERATION');
  });

  it('a reader carrying ANY mutation member is refused at composition', () => {
    const base = {
      providerId: 'synthetic_esp',
      boundary: PROVIDER_READ_BOUNDARY,
      readFromProvider: () => Promise.resolve({ kind: 'PROVIDER_UNAVAILABLE' as const }),
    };
    expect(isAuditProviderReader(base)).toBe(true);
    expect([...AUDIT_PROVIDER_READER_MEMBERS]).toEqual([
      'providerId',
      'boundary',
      'readFromProvider',
    ]);
    // TypeScript's structural typing admits extra members, so the shape is checked at
    // RUNTIME. Every forbidden name is refused individually.
    for (const member of FORBIDDEN_READER_MEMBERS) {
      expect(isAuditProviderReader({ ...base, [member]: () => undefined }), member).toBe(false);
    }
    // And any member outside the declared three, forbidden-list or not.
    expect(isAuditProviderReader({ ...base, somethingElse: 1 })).toBe(false);
    expect(isAuditProviderReaderModule({ auditProviderReader: { ...base, send: () => 1 } })).toBe(
      false,
    );
  });
});

/* ================================================================================
 * 3. NO CREDENTIAL CROSSES IPC
 * ============================================================================== */

describe('`§16` — NO CREDENTIAL CROSSES IPC', () => {
  it('the response carries a non-secret label and no second member', () => {
    const reply = decodeAuditReaderReply(
      JSON.stringify({
        protocolVersion: AUDIT_READ_PROTOCOL_VERSION,
        kind: 'PROVIDER_READ_RESPONSE',
        readId: 'r1',
        operation: 'MESSAGE_ACTIVITY_SEARCH',
        records: [],
        recordCount: 0,
        credentialIdentity: 'synthetic_esp.audit_read',
        providerQueriedAtMs: PERIOD_START,
      }),
    );
    expect(reply.kind).toBe('DECODED');
    const message = reply.kind === 'DECODED' ? reply.message : null;
    expect(message).not.toBeNull();
    expect(Object.keys(message!)).toEqual([
      'protocolVersion',
      'kind',
      'readId',
      'operation',
      'records',
      'recordCount',
      'credentialIdentity',
      'providerQueriedAtMs',
    ]);
  });

  it('an evidence record carrying an unknown field is REFUSED', () => {
    const reply = decodeAuditReaderReply(
      JSON.stringify({
        protocolVersion: AUDIT_READ_PROTOCOL_VERSION,
        kind: 'PROVIDER_READ_RESPONSE',
        readId: 'r1',
        operation: 'MESSAGE_ACTIVITY_SEARCH',
        records: [
          {
            providerMessageId: 'm1',
            providerStatus: 'accepted',
            providerTimestampMs: PERIOD_START,
            correlationTag: null,
            apiKey: 'SG.leaked',
          },
        ],
        recordCount: 1,
        credentialIdentity: null,
        providerQueriedAtMs: PERIOD_START,
      }),
    );
    expect(reply.kind).toBe('REFUSED');
    expect(reply.kind === 'REFUSED' && reply.reason).toBe('UNKNOWN_FIELD');
  });

  it('a READY message admits environment KEYS only — a value cannot pass as one', () => {
    const ready = (keys: unknown[]): ReturnType<typeof decodeAuditReaderReply> =>
      decodeAuditReaderReply(
        JSON.stringify({
          protocolVersion: AUDIT_READ_PROTOCOL_VERSION,
          kind: 'AUDIT_READER_READY',
          readerIdentity: 'AUDIT_PROVIDER_READER:synthetic_esp',
          providerId: 'synthetic_esp',
          pid: 1234,
          environmentKeys: keys,
          declaredCredentialRiskClass: 'READ_ONLY',
        }),
      );
    expect(ready(['ACOS_AUDIT_PROVIDER_ID']).kind).toBe('DECODED');
    // A SECRET does not satisfy the environment-variable identifier grammar.
    expect(ready(['TEST_ONLY_AUDIT_READ_SECRET_x_deadbeef=value']).kind).toBe('REFUSED');
    expect(ready(['has spaces']).kind).toBe('REFUSED');
    expect(ready([{ key: 'x' }]).kind).toBe('REFUSED');
  });

  it('the two protocols share no field name that could carry a credential', () => {
    const readFields = new Set<string>(PROVIDER_READ_REQUEST_FIELDS);
    const dispatchFields = new Set<string>(DISPATCH_REQUEST_FIELDS);
    /*
     * THE INTERSECTION IS TRANSPORT VOCABULARY AND ONE ACOS-MINTED IDENTIFIER, AND NOTHING
     * THAT NAMES MATERIAL.
     *
     * `correlationTag` appears in both, deliberately: it is minted at enqueue, travels to
     * the provider on a send, and is what the audit plane later looks for. That is the whole
     * mechanism `§19`'s correlation requirement is about, and the two planes naming it the
     * same thing is the point rather than a coupling — the NAME is shared, the module is not.
     *
     * What must never be shared is a member material could occupy, so the assertion is over
     * the intersection rather than a claim that it is empty.
     */
    const shared = [...readFields].filter((f) => dispatchFields.has(f)).sort();
    expect(shared).toEqual(['correlationTag', 'kind', 'protocolVersion']);
    for (const name of shared) {
      expect(['token', 'apiKey', 'authorization', 'credential', 'secret'], name).not.toContain(
        name,
      );
    }
  });
});

/* ================================================================================
 * 4. BOUNDS, AND THE PERIOD RULE
 * ============================================================================== */

describe('`48` v1.3 note — the read is PERIOD-BOUNDED, always', () => {
  it('both bounds are required and an inverted or unbounded period is refused', () => {
    for (const bad of [
      { periodStartMs: PERIOD_END, periodEndMs: PERIOD_START },
      { periodStartMs: PERIOD_START, periodEndMs: PERIOD_START },
      { periodStartMs: 0, periodEndMs: MAX_READ_PERIOD_MS + 1 },
      { periodStartMs: -1 },
      { periodEndMs: 'now' },
    ]) {
      const decoded = decodeProviderReadRequest(request(bad));
      expect(decoded.kind, JSON.stringify(bad)).toBe('REFUSED');
      expect(decoded.kind === 'REFUSED' && decoded.reason).toBe('PERIOD_BOUND_INVALID');
    }
  });

  it('a well-formed period-bounded request decodes', () => {
    const decoded = decodeProviderReadRequest(request());
    expect(decoded.kind).toBe('DECODED');
  });

  it('the record bound is enforced on both sides', () => {
    expect(
      decodeProviderReadRequest(request({ maxRecords: MAX_RECORDS_PER_READ + 1 })).kind,
    ).toBe('REFUSED');
    expect(decodeProviderReadRequest(request({ maxRecords: 0 })).kind).toBe('REFUSED');
    expect(decodeProviderReadRequest(request({ maxRecords: MAX_RECORDS_PER_READ })).kind).toBe(
      'DECODED',
    );
  });

  it('per-operation arguments are enforced — a DETAIL needs an id, a SEARCH must not carry one', () => {
    expect(
      decodeProviderReadRequest(request({ operation: 'MESSAGE_ACTIVITY_DETAIL' })).kind,
    ).toBe('REFUSED');
    expect(
      decodeProviderReadRequest(
        request({
          operation: 'MESSAGE_ACTIVITY_DETAIL',
          providerMessageId: 'm1',
          correlationTag: null,
        }),
      ).kind,
    ).toBe('DECODED');
    expect(decodeProviderReadRequest(request({ providerMessageId: 'm1' })).kind).toBe('REFUSED');
  });

  it('an over-size message is refused before it is parsed', () => {
    const huge = 'x'.repeat(MAX_AUDIT_IPC_MESSAGE_BYTES + 1);
    expect(decodeProviderReadRequest(huge).kind).toBe('REFUSED');
    const oversize = encodeAuditReadMessage({
      protocolVersion: AUDIT_READ_PROTOCOL_VERSION,
      kind: 'PROVIDER_READ_REFUSED',
      readId: huge,
      reason: 'MALFORMED_MESSAGE',
    });
    expect(oversize).toBeNull();
  });

  it('every refusal reason is a CODE, and the closed set is asserted', () => {
    expect([...PROVIDER_READ_REFUSALS]).toEqual([
      'PROTOCOL_VERSION_MISMATCH',
      'MALFORMED_MESSAGE',
      'UNKNOWN_FIELD',
      'UNKNOWN_OPERATION',
      'OPERATION_ARGUMENTS_INVALID',
      'PERIOD_BOUND_INVALID',
      'RECORD_BOUND_EXCEEDED',
      'PROVIDER_IDENTITY_MISMATCH',
      'CREDENTIAL_UNAVAILABLE',
      'CREDENTIAL_NOT_READ_ONLY',
      // v1.3.7 correction: the resolved material is not the credential the signed class-5
      // record governs. Its own code, because "the boundary could not answer" and "it
      // answered with the wrong credential" are different facts.
      'CREDENTIAL_IDENTITY_MISMATCH',
      'PROVIDER_UNAVAILABLE',
      'RESPONSE_TOO_LARGE',
    ]);
  });
});

/* ================================================================================
 * 5. THE READ DIGEST — evidence, never authority
 * ============================================================================== */

describe('the read digest is evidence about what was asked', () => {
  it('a separator inside a tag cannot forge a different read', () => {
    const base: ProviderReadRequest = {
      protocolVersion: AUDIT_READ_PROTOCOL_VERSION,
      kind: 'PROVIDER_READ_REQUEST',
      readId: 'r1',
      operation: 'MESSAGE_ACTIVITY_SEARCH',
      providerId: 'synthetic_esp',
      periodStartMs: PERIOD_START,
      periodEndMs: PERIOD_END,
      correlationTag: 'a',
      providerMessageId: null,
      maxRecords: 10,
    };
    const shifted: ProviderReadRequest = { ...base, correlationTag: 'a b', providerMessageId: null };
    expect(computeReadDigest(base)).not.toBe(computeReadDigest(shifted));
    // Deterministic: the same request digests the same way, and `readId` is NOT an operand
    // (it is transport observability, not part of what was asked).
    expect(computeReadDigest(base)).toBe(computeReadDigest({ ...base, readId: 'r2' }));
  });
});
