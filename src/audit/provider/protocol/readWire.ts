/**
 * THE ACOS AUDIT PROVIDER-READ PROTOCOL. A CLOSED READ-ONLY SCHEMA, AND NOT AN HTTP CLIENT.
 *
 * =================================================================================
 * `§16` OF THE S1O MANDATE, VERBATIM
 *
 *   "Closed read-only request protocol. Permit only declared provider-read operations needed
 *    for audit/reconciliation. **No generic URL. No send operation. No credential crosses
 *    IPC.** Unknown operation: **REFUSED.**"
 *
 * Four sentences, four mechanisms, and each is structural rather than a check:
 *
 *   no generic URL        there is no `url`, `path`, `endpoint`, `host`, `origin`, `query`,
 *                         `headers` or `body` member on `ProviderReadRequest`, and nothing
 *                         in this file constructs a `URL`. The request names an OPERATION
 *                         from a closed enum and carries that operation's own typed
 *                         arguments. A caller cannot express a destination because the
 *                         schema has no room for one.
 *   no send operation     `PROVIDER_READ_OPERATIONS` is a hand-authored closed list of
 *                         three, every one a query, and the reply type has no member an
 *                         acknowledgement of a send could occupy.
 *                         `tests/integration/audit/audit-read-protocol.test.ts` asserts the
 *                         list against a second hand-authored copy, so a fourth member has
 *                         to be added in two places by someone who read this paragraph.
 *   no credential crosses `ProviderReadRequest` has no `token`, `apiKey`, `authorization`,
 *                         `credential` or `headers` member, and `ProviderReadResponse`
 *                         carries `credentialIdentity` — a non-secret label the SOURCE
 *                         declares — and no member the material could occupy.
 *   unknown is REFUSED    `decodeProviderReadRequest` returns a refusal for an operation
 *                         outside the closed list, for an unknown field, and for an argument
 *                         shape the operation does not declare. An unknown field is a
 *                         REFUSAL rather than an ignored key, because a protocol that
 *                         ignores what it does not understand is a protocol whose next
 *                         version is an injection surface.
 *
 * =================================================================================
 * WHY THIS IS A SECOND PROTOCOL AND NOT A MODE OF `integration/protocol/wire.ts`
 *
 * `§13`: "Do not put audit credentials into: control process; **control integration adapter
 * runtime**; same secret source as send credential."
 *
 * A shared protocol module is a shared import closure. `29 §3.5` requires "**per-adapter**
 * runtime, filesystem and dependency isolation — not merely per-plane", and `23 §7` scopes
 * isolation per credential; a `DispatchRequest` type that could be narrowed into a read
 * request would mean the audit reader's process graph contained the sender's schema and the
 * sender's refusal vocabulary, and one day a `kind` field would decide which half ran.
 *
 * **THE TWO PROTOCOLS SHARE NO MODULE, NO TYPE AND NO CONSTANT**, and
 * `tests/integration/audit/audit-plane-packaging.test.ts` asserts the import closures are
 * disjoint. The cost is a second decoder; the benefit is that there is no expression in
 * either protocol that names the other plane's operation.
 *
 * =================================================================================
 * `§14` — AND NOTHING HERE CARRIES A CONTROL-PLANE VERDICT
 *
 * "Do not make audit verification depend on a control-plane `verified=true`."
 *
 * So `ProviderReadRequest` has no `expectedOutcome`, no `controlVerified`, no `effectId`, no
 * `outboxId` and no `authorisationRef`. The audit plane asks the provider what it holds for
 * a CORRELATION TAG over a PERIOD, and forms its own answer. `48`'s v1.3 note is the rule
 * being implemented: the inverse-sweep reads are "**period-bounded and never parameterised
 * by an ACOS-side identifier or tag set**" — so the period is mandatory on every operation,
 * and the correlation tag narrows a period-bounded result rather than replacing it.
 * =================================================================================
 */

import { createHash } from 'node:crypto';

/** The protocol version, restated into the child so a mismatched pair cannot start. */
export const AUDIT_READ_PROTOCOL_VERSION = 'acos.audit.provider-read.v1';

/**
 * `§16`'s message bound. 256 KiB, the same figure the integration protocol uses, and chosen
 * for the same reason: large enough for a page of provider evidence, small enough that a
 * wedged reader cannot allocate the parent's heap one message at a time.
 */
export const MAX_AUDIT_IPC_MESSAGE_BYTES = 262_144;

export const PROVIDER_READ_REQUEST_KIND = 'PROVIDER_READ_REQUEST';
export const PROVIDER_READ_RESPONSE_KIND = 'PROVIDER_READ_RESPONSE';
export const PROVIDER_READ_REFUSED_KIND = 'PROVIDER_READ_REFUSED';
export const AUDIT_READER_READY_KIND = 'AUDIT_READER_READY';

/**
 * `§16`'s CLOSED OPERATION SET. THREE MEMBERS, EVERY ONE A QUERY.
 *
 * "Permit only declared provider-read operations needed for audit/reconciliation."
 *
 *   `MESSAGE_ACTIVITY_SEARCH`  the period-bounded activity query. `I20`'s "provider-reported
 *                              accepted" and `I8`'s inverse sweep both read this.
 *   `MESSAGE_ACTIVITY_DETAIL`  one provider record by the PROVIDER's own message id, for
 *                              `I36`'s acceptance oracle.
 *   `MESSAGE_ACTIVITY_COUNT`   the count alone, for a sweep that needs a total and must not
 *                              pull a page of recipient data to get one. `30 §5.10`'s scrub
 *                              posture: the narrowest read that answers the question.
 *
 * **THERE IS NO `SEND`, NO `CREATE`, NO `UPDATE`, NO `DELETE`, NO `SUBSCRIBE` AND NO
 * `EXECUTE`.** And there is no generic member — no `RAW`, no `PASSTHROUGH`, no `CUSTOM` —
 * because `§18` of the S1N mandate's rule applies here unchanged: a broad member is an
 * exemption nobody reviewed, wearing the name of a feature.
 */
export const PROVIDER_READ_OPERATIONS = [
  'MESSAGE_ACTIVITY_SEARCH',
  'MESSAGE_ACTIVITY_DETAIL',
  'MESSAGE_ACTIVITY_COUNT',
] as const;

export type ProviderReadOperation = (typeof PROVIDER_READ_OPERATIONS)[number];

export function isProviderReadOperation(value: unknown): value is ProviderReadOperation {
  return (
    typeof value === 'string' &&
    (PROVIDER_READ_OPERATIONS as readonly string[]).includes(value)
  );
}

/**
 * The closed field list of a read request. ASSERTED AGAINST A SECOND HAND-AUTHORED COPY.
 *
 * Note what is absent and could not be added without editing this list, the interface, the
 * decoder and the boundary test: every one of `url`, `path`, `endpoint`, `host`, `origin`,
 * `method`, `headers`, `body`, `query`, `token`, `apiKey`, `authorization`, `credential`.
 */
export const PROVIDER_READ_REQUEST_FIELDS = [
  'protocolVersion',
  'kind',
  'readId',
  'operation',
  'providerId',
  /** `48`'s v1.3 note: the read is PERIOD-BOUNDED. Both bounds are required. */
  'periodStartMs',
  'periodEndMs',
  /** Narrows a period-bounded result. Never replaces the period. May be `null`. */
  'correlationTag',
  /** The PROVIDER's own message id, for `MESSAGE_ACTIVITY_DETAIL`. May be `null`. */
  'providerMessageId',
  /** A page bound the READER enforces. Never a caller-chosen page size at the provider. */
  'maxRecords',
] as const;

export type ProviderReadRequestField = (typeof PROVIDER_READ_REQUEST_FIELDS)[number];

export interface ProviderReadRequest {
  readonly protocolVersion: typeof AUDIT_READ_PROTOCOL_VERSION;
  readonly kind: typeof PROVIDER_READ_REQUEST_KIND;
  /** Transport observability. `§27` of S1N: it replaces no identity and grants no authority. */
  readonly readId: string;
  readonly operation: ProviderReadOperation;
  readonly providerId: string;
  readonly periodStartMs: number;
  readonly periodEndMs: number;
  readonly correlationTag: string | null;
  readonly providerMessageId: string | null;
  readonly maxRecords: number;
}

/** `§16`'s bound on how much evidence one read may return. */
export const MAX_RECORDS_PER_READ = 500;

/** The longest period one read may span. A sweep asks repeatedly rather than unboundedly. */
export const MAX_READ_PERIOD_MS = 31 * 24 * 60 * 60 * 1000;

/**
 * ONE provider evidence record. NON-SECRET, AND NARROW BY CONSTRUCTION.
 *
 * `30 §5.10`'s scrub posture and `§17`'s leak matrix both apply: there is no member a
 * credential could occupy, and no member a recipient address could occupy either. What the
 * audit plane needs from the provider is whether the provider ACCEPTED something carrying
 * this correlation tag, when, and under which provider-side identity — not who received it.
 */
export interface ProviderEvidenceRecord {
  /** The PROVIDER's own message identity. Evidence, never an ACOS identity. */
  readonly providerMessageId: string;
  /** The provider's own status word, verbatim and unmapped. */
  readonly providerStatus: string;
  /** The provider's own timestamp, in epoch milliseconds. */
  readonly providerTimestampMs: number;
  /** The ACOS correlation tag the provider echoed back, or `null` if it carried none. */
  readonly correlationTag: string | null;
}

/**
 * Why a read did not produce evidence. A CLOSED set, and every member is a REFUSAL SHAPE
 * rather than an exception with a message.
 *
 * `§23` of the S1N mandate's rule carries over: an audit failure must not teach the caller a
 * filesystem path, a module specifier, a credential label or a provider URL. So a refusal is
 * a code, and the code is the whole message.
 */
export const PROVIDER_READ_REFUSALS = [
  'PROTOCOL_VERSION_MISMATCH',
  'MALFORMED_MESSAGE',
  'UNKNOWN_FIELD',
  /** `§16`: "Unknown operation: REFUSED." */
  'UNKNOWN_OPERATION',
  /** The operation's own declared arguments were not supplied, or were supplied wrongly. */
  'OPERATION_ARGUMENTS_INVALID',
  /** `48`'s v1.3 note: an unbounded or inverted period is not a period-bounded read. */
  'PERIOD_BOUND_INVALID',
  'RECORD_BOUND_EXCEEDED',
  /** This reader serves one provider; the request named another. */
  'PROVIDER_IDENTITY_MISMATCH',
  /** The read-only credential is revoked or unprovisioned. */
  'CREDENTIAL_UNAVAILABLE',
  /**
   * The configured credential's SIGNED class-5 record is not `READ_ONLY`.
   *
   * `48 §3.6`, `50 §2g` field 6. A reader that started with a mutation-capable credential
   * would be an audit plane holding a send capability, and `§13` forbids exactly that. The
   * check runs at composition, so this refusal is unreachable in a correctly wired runtime
   * and exists so a wiring mistake produces a code rather than a silent capability.
   */
  'CREDENTIAL_NOT_READ_ONLY',
  /**
   * `50 §2g` FIELD 1 — THE RESOLVED MATERIAL IS NOT THE CREDENTIAL THE SIGNED RECORD GOVERNS.
   *
   * `CREDENTIAL_NOT_READ_ONLY` answers "is the declared class right for an audit reader?".
   * This one answers "is the declaration about the credential in this reader's hand?", and
   * the second question is the one a genuinely `READ_ONLY` signed record cannot settle: a
   * reader whose locator resolves a send-capable token passes every other check on this
   * plane. Refused BEFORE `readFromProvider`, so no provider query is made with it.
   */
  'CREDENTIAL_IDENTITY_MISMATCH',
  /** The provider client reached its boundary and the provider did not answer. */
  'PROVIDER_UNAVAILABLE',
  /** The reply would not encode within `MAX_AUDIT_IPC_MESSAGE_BYTES`. */
  'RESPONSE_TOO_LARGE',
] as const;

export type ProviderReadRefusal = (typeof PROVIDER_READ_REFUSALS)[number];

export interface ProviderReadResponse {
  readonly protocolVersion: typeof AUDIT_READ_PROTOCOL_VERSION;
  readonly kind: typeof PROVIDER_READ_RESPONSE_KIND;
  readonly readId: string;
  readonly operation: ProviderReadOperation;
  /** Empty for `MESSAGE_ACTIVITY_COUNT`, whose answer is `recordCount` alone. */
  readonly records: readonly ProviderEvidenceRecord[];
  /** The provider's own total for the period, which may exceed `records.length`. */
  readonly recordCount: number;
  /**
   * `§17`'s non-secret credential label, declared by the SOURCE.
   *
   * The response carries this and NOT the material, for the reason `DispatchResponse`
   * carries `credentialIdentity` and no third member: a label proves which credential
   * answered without being the credential.
   */
  readonly credentialIdentity: string | null;
  /**
   * `§14` — THE ANSWER IS THE PROVIDER'S, AND THE RESPONSE SAYS SO.
   *
   * There is no `verified`, no `matched` and no `expected` member. A control-plane verdict
   * cannot travel on this wire because the wire has nowhere to put one, and the audit
   * plane's own comparison happens in the audit plane against the records above.
   */
  readonly providerQueriedAtMs: number;
}

export interface ProviderReadRefused {
  readonly protocolVersion: typeof AUDIT_READ_PROTOCOL_VERSION;
  readonly kind: typeof PROVIDER_READ_REFUSED_KIND;
  readonly readId: string;
  readonly reason: ProviderReadRefusal;
}

export interface AuditReaderReady {
  readonly protocolVersion: typeof AUDIT_READ_PROTOCOL_VERSION;
  readonly kind: typeof AUDIT_READER_READY_KIND;
  readonly readerIdentity: string;
  readonly providerId: string;
  readonly pid: number;
  /**
   * `§17` — THE KEYS OF THIS PROCESS'S OWN ENVIRONMENT. KEYS ONLY.
   *
   * `Object.keys`, never `process.env`: a value has no route onto this message, because the
   * member's type is `readonly string[]` and the parent's decoder refuses any element that
   * is not a bare environment-variable identifier.
   *
   * It is the CHILD that reports this rather than the parent asserting what it passed,
   * because what the parent passed is the thing under test and is therefore not evidence
   * about itself.
   */
  readonly environmentKeys: readonly string[];
  /** The signed class-5 risk class the reader's own composition verified. Evidence. */
  readonly declaredCredentialRiskClass: string;
}

export const MAX_REPORTED_ENV_KEYS = 256;

export type AuditReadMessage =
  | ProviderReadRequest
  | ProviderReadResponse
  | ProviderReadRefused
  | AuditReaderReady;

// ---------------------------------------------------------------------------------
// DECODE.
// ---------------------------------------------------------------------------------

export type AuditDecodeResult<T> =
  | { readonly kind: 'DECODED'; readonly message: T }
  | { readonly kind: 'REFUSED'; readonly reason: ProviderReadRefusal };

function refused<T>(reason: ProviderReadRefusal): AuditDecodeResult<T> {
  return { kind: 'REFUSED', reason };
}

function asRecord(raw: unknown): Record<string, unknown> | null {
  if (typeof raw !== 'string') return null;
  if (Buffer.byteLength(raw, 'utf8') > MAX_AUDIT_IPC_MESSAGE_BYTES) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
  return parsed as Record<string, unknown>;
}

function isSafeNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/** The environment-variable identifier grammar. A VALUE cannot satisfy it by accident. */
const ENV_KEY_GRAMMAR = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;

/**
 * Decode a read request, in the READER. Every refusal below runs BEFORE any provider call.
 *
 * The ORDER is load-bearing and is the same discipline `integrationHost.ts` applies: the
 * refusals that prove nothing left the process run first, so a `PROVIDER_READ_REFUSED` reply
 * is positive evidence that no provider request was opened.
 */
export function decodeProviderReadRequest(
  raw: unknown,
): AuditDecodeResult<ProviderReadRequest> {
  const record = asRecord(raw);
  if (record === null) return refused('MALFORMED_MESSAGE');

  if (record.protocolVersion !== AUDIT_READ_PROTOCOL_VERSION) {
    return refused('PROTOCOL_VERSION_MISMATCH');
  }
  if (record.kind !== PROVIDER_READ_REQUEST_KIND) return refused('MALFORMED_MESSAGE');

  // `§16`: an unknown field is a REFUSAL, never an ignored key.
  for (const key of Object.keys(record)) {
    if (!(PROVIDER_READ_REQUEST_FIELDS as readonly string[]).includes(key)) {
      return refused('UNKNOWN_FIELD');
    }
  }
  for (const field of PROVIDER_READ_REQUEST_FIELDS) {
    if (!(field in record)) return refused('MALFORMED_MESSAGE');
  }

  if (typeof record.readId !== 'string' || record.readId.length === 0) {
    return refused('MALFORMED_MESSAGE');
  }
  if (!isProviderReadOperation(record.operation)) return refused('UNKNOWN_OPERATION');
  if (typeof record.providerId !== 'string' || record.providerId.length === 0) {
    return refused('MALFORMED_MESSAGE');
  }

  if (
    !isSafeNonNegativeInteger(record.periodStartMs) ||
    !isSafeNonNegativeInteger(record.periodEndMs)
  ) {
    return refused('PERIOD_BOUND_INVALID');
  }
  if (record.periodEndMs <= record.periodStartMs) return refused('PERIOD_BOUND_INVALID');
  if (record.periodEndMs - record.periodStartMs > MAX_READ_PERIOD_MS) {
    return refused('PERIOD_BOUND_INVALID');
  }

  if (!isSafeNonNegativeInteger(record.maxRecords)) return refused('OPERATION_ARGUMENTS_INVALID');
  if (record.maxRecords === 0 || record.maxRecords > MAX_RECORDS_PER_READ) {
    return refused('RECORD_BOUND_EXCEEDED');
  }

  if (record.correlationTag !== null && typeof record.correlationTag !== 'string') {
    return refused('OPERATION_ARGUMENTS_INVALID');
  }
  if (record.providerMessageId !== null && typeof record.providerMessageId !== 'string') {
    return refused('OPERATION_ARGUMENTS_INVALID');
  }

  // PER-OPERATION ARGUMENT RULES. A closed schema whose arguments are optional for every
  // operation is a schema that admits a detail request with no id and a search with no
  // filter, and both would be answered by the widest possible read.
  if (record.operation === 'MESSAGE_ACTIVITY_DETAIL') {
    if (record.providerMessageId === null) return refused('OPERATION_ARGUMENTS_INVALID');
    if (record.correlationTag !== null) return refused('OPERATION_ARGUMENTS_INVALID');
  } else if (record.providerMessageId !== null) {
    return refused('OPERATION_ARGUMENTS_INVALID');
  }

  return {
    kind: 'DECODED',
    message: {
      protocolVersion: AUDIT_READ_PROTOCOL_VERSION,
      kind: PROVIDER_READ_REQUEST_KIND,
      readId: record.readId,
      operation: record.operation,
      providerId: record.providerId,
      periodStartMs: record.periodStartMs,
      periodEndMs: record.periodEndMs,
      correlationTag: record.correlationTag as string | null,
      providerMessageId: record.providerMessageId as string | null,
      maxRecords: record.maxRecords,
    },
  };
}

/** Decode a reply, in the AUDIT PLANE's parent process. */
export function decodeAuditReaderReply(
  raw: unknown,
): AuditDecodeResult<ProviderReadResponse | ProviderReadRefused | AuditReaderReady> {
  const record = asRecord(raw);
  if (record === null) return refused('MALFORMED_MESSAGE');
  if (record.protocolVersion !== AUDIT_READ_PROTOCOL_VERSION) {
    return refused('PROTOCOL_VERSION_MISMATCH');
  }

  if (record.kind === AUDIT_READER_READY_KIND) {
    if (typeof record.readerIdentity !== 'string') return refused('MALFORMED_MESSAGE');
    if (typeof record.providerId !== 'string') return refused('MALFORMED_MESSAGE');
    if (!isSafeNonNegativeInteger(record.pid)) return refused('MALFORMED_MESSAGE');
    if (typeof record.declaredCredentialRiskClass !== 'string') {
      return refused('MALFORMED_MESSAGE');
    }
    const keys = record.environmentKeys;
    if (!Array.isArray(keys) || keys.length > MAX_REPORTED_ENV_KEYS) {
      return refused('MALFORMED_MESSAGE');
    }
    for (const key of keys) {
      // A VALUE cannot travel here disguised as a key. `§17`'s prohibition is on the raw
      // environment, which is the values, and this is the mechanism that enforces it.
      if (typeof key !== 'string' || !ENV_KEY_GRAMMAR.test(key)) {
        return refused('MALFORMED_MESSAGE');
      }
    }
    return {
      kind: 'DECODED',
      message: {
        protocolVersion: AUDIT_READ_PROTOCOL_VERSION,
        kind: AUDIT_READER_READY_KIND,
        readerIdentity: record.readerIdentity,
        providerId: record.providerId,
        pid: record.pid,
        environmentKeys: Object.freeze([...(keys as string[])]),
        declaredCredentialRiskClass: record.declaredCredentialRiskClass,
      },
    };
  }

  if (record.kind === PROVIDER_READ_REFUSED_KIND) {
    if (typeof record.readId !== 'string') return refused('MALFORMED_MESSAGE');
    if (
      typeof record.reason !== 'string' ||
      !(PROVIDER_READ_REFUSALS as readonly string[]).includes(record.reason)
    ) {
      return refused('MALFORMED_MESSAGE');
    }
    return {
      kind: 'DECODED',
      message: {
        protocolVersion: AUDIT_READ_PROTOCOL_VERSION,
        kind: PROVIDER_READ_REFUSED_KIND,
        readId: record.readId,
        reason: record.reason as ProviderReadRefusal,
      },
    };
  }

  if (record.kind !== PROVIDER_READ_RESPONSE_KIND) return refused('MALFORMED_MESSAGE');
  if (typeof record.readId !== 'string') return refused('MALFORMED_MESSAGE');
  if (!isProviderReadOperation(record.operation)) return refused('UNKNOWN_OPERATION');
  if (!isSafeNonNegativeInteger(record.recordCount)) return refused('MALFORMED_MESSAGE');
  if (!isSafeNonNegativeInteger(record.providerQueriedAtMs)) return refused('MALFORMED_MESSAGE');
  if (record.credentialIdentity !== null && typeof record.credentialIdentity !== 'string') {
    return refused('MALFORMED_MESSAGE');
  }
  const rawRecords = record.records;
  if (!Array.isArray(rawRecords) || rawRecords.length > MAX_RECORDS_PER_READ) {
    return refused('RECORD_BOUND_EXCEEDED');
  }
  const records: ProviderEvidenceRecord[] = [];
  for (const raw of rawRecords) {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      return refused('MALFORMED_MESSAGE');
    }
    const row = raw as Record<string, unknown>;
    for (const key of Object.keys(row)) {
      if (
        !['providerMessageId', 'providerStatus', 'providerTimestampMs', 'correlationTag'].includes(
          key,
        )
      ) {
        return refused('UNKNOWN_FIELD');
      }
    }
    if (typeof row.providerMessageId !== 'string') return refused('MALFORMED_MESSAGE');
    if (typeof row.providerStatus !== 'string') return refused('MALFORMED_MESSAGE');
    if (!isSafeNonNegativeInteger(row.providerTimestampMs)) return refused('MALFORMED_MESSAGE');
    if (row.correlationTag !== null && typeof row.correlationTag !== 'string') {
      return refused('MALFORMED_MESSAGE');
    }
    records.push(
      Object.freeze({
        providerMessageId: row.providerMessageId,
        providerStatus: row.providerStatus,
        providerTimestampMs: row.providerTimestampMs,
        correlationTag: row.correlationTag as string | null,
      }),
    );
  }

  return {
    kind: 'DECODED',
    message: {
      protocolVersion: AUDIT_READ_PROTOCOL_VERSION,
      kind: PROVIDER_READ_RESPONSE_KIND,
      readId: record.readId,
      operation: record.operation,
      records: Object.freeze(records),
      recordCount: record.recordCount,
      credentialIdentity: record.credentialIdentity as string | null,
      providerQueriedAtMs: record.providerQueriedAtMs,
    },
  };
}

/** Encode, or `null` when the message exceeds the bound. A reply is DROPPED, never truncated. */
export function encodeAuditReadMessage(message: AuditReadMessage): string | null {
  const encoded = JSON.stringify(message);
  if (Buffer.byteLength(encoded, 'utf8') > MAX_AUDIT_IPC_MESSAGE_BYTES) return null;
  return encoded;
}

/**
 * A stable digest over the read the parent asked for, for the audit journal.
 *
 * `NUL`-separated and length-framed in the same shape `computeRequestBindingDigest` uses,
 * so a tag containing a separator cannot be made to look like a different read. This is
 * EVIDENCE about what was asked, not an authority token: nothing refuses on its basis and
 * the reader does not check it.
 */
export function computeReadDigest(request: ProviderReadRequest): string {
  const hash = createHash('sha256');
  for (const part of [
    AUDIT_READ_PROTOCOL_VERSION,
    request.operation,
    request.providerId,
    String(request.periodStartMs),
    String(request.periodEndMs),
    request.correlationTag ?? '',
    request.providerMessageId ?? '',
  ]) {
    hash.update(Buffer.from(String(Buffer.byteLength(part, 'utf8')), 'utf8'));
    hash.update(Buffer.from([0]));
    hash.update(Buffer.from(part, 'utf8'));
    hash.update(Buffer.from([0]));
  }
  return hash.digest('hex');
}
