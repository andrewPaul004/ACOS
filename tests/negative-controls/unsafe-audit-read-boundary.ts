import {
  AUDIT_READ_PROTOCOL_VERSION,
  PROVIDER_READ_REFUSED_KIND,
  PROVIDER_READ_RESPONSE_KIND,
  type ProviderEvidenceRecord,
} from '../../src/audit/provider/protocol/readWire.js';
import {
  PROVIDER_READ_BOUNDARY,
  type AuditProviderReader,
  type ProviderReadQuery,
  type ProviderReadResult,
} from '../../src/audit/provider/runtime/auditProviderReader.js';
import type {
  AuditReadCredential,
  AuditReadSecretSource,
  AuditSecretResolution,
} from '../../src/audit/provider/runtime/auditSecretSource.js';
import type { AuditHostReply, AuditReaderConfiguration } from '../../src/audit/provider/runtime/auditReadHost.js';
import type {
  AuditExpectation,
  IndependentFinding,
} from '../../src/audit/provider/independentFinding.js';
import type { AuditReadOutcome } from '../../src/audit/provider/plane/auditReadClient.js';
import type {
  AuditReaderDescriptor,
  AuditReaderRegistry,
} from '../../src/audit/provider/plane/auditReaderRegistry.js';

/**
 * S1O VULNERABLE CONTROLS 5–9 — THE AUDIT PROVIDER-READ BOUNDARY.
 *
 * **TEST-ONLY. NOTHING HERE IS PRODUCTION CODE AND NOTHING HERE IS EXPORTED FROM `src/`.**
 *
 * =================================================================================
 * `§29` OF THE S1O MANDATE, ITEMS 5–9
 *
 *   5. audit credential resides in control process
 *   6. audit credential shared with send adapter
 *   7. audit provider client exposes send operation
 *   8. audit trusts control-side provider evidence
 *   9. read query accepts caller-supplied arbitrary URL
 *
 * Each is paired in `tests/negative-controls/audit-provider-controls.test.ts` with an input
 * on which it accepts and production refuses.
 * =================================================================================
 */

/**
 * CONTROL 5 — THE AUDIT CREDENTIAL RESOLVED IN THE PARENT PROCESS.
 *
 * =================================================================================
 * `§13`'s FIRST PROHIBITION
 *
 *   "Do not put audit credentials into: **control process**; control integration adapter
 *    runtime; same secret source as send credential."
 *
 * This is the shape S1M's PARTIAL blocker B described one plane over: an in-process object
 * that resolves the material where the caller can read it. It looks harmless because the
 * object is small and the material is "only" passed to a reader — and the whole of `I25`'s
 * argument is that a credential resolved in a process is held by that process, whatever the
 * code then does with it.
 *
 * **THE DISCRIMINATION IS A HEAP FACT, NOT A CODE REVIEW.** The control test resolves this
 * source in the test's own process and finds the sentinel in a value reachable from it;
 * production's material exists only inside the forked reader, and the leak matrix finds the
 * sentinel on none of the parent's surfaces.
 * =================================================================================
 */
export class UnsafeInProcessAuditCredentialHolder {
  public readonly declaredProviderId: string;

  /** THE VIOLATION: the material lives on an object in the caller's own process. */
  public resolvedSecret: string | null = null;

  public constructor(
    providerId: string,
    private readonly secret: string,
  ) {
    this.declaredProviderId = providerId;
  }

  public resolve(): Promise<AuditSecretResolution> {
    this.resolvedSecret = this.secret;
    return Promise.resolve({
      kind: 'RESOLVED',
      credential: { secret: this.secret, identity: 'unsafe-in-process', version: null },
    });
  }
}

/**
 * CONTROL 6 — ONE SECRET SOURCE SERVING BOTH THE SEND AND THE AUDIT SCOPE.
 *
 * =================================================================================
 * `§13`'s THIRD PROHIBITION
 *
 *   "Do not put audit credentials into: [...] **same secret source as send credential**."
 *
 * The defect is the SELECTOR SIGNATURE, exactly as `unsafeSharedSecretSource` is for the
 * integration plane: a source that takes a scope id is a source that CAN be asked for
 * another scope's material, and the only thing between the ask and the answer is a check
 * inside the source. `29 §3.1`'s objection to internal capability tokens applies one layer
 * down: the source would be enforcing a restriction on itself, which is an audit tag rather
 * than a boundary.
 *
 * Production's `AuditReadSecretSource.resolve()` **takes no argument**, so there is no ask
 * to answer. The discrimination is that this source, handed the audit reader's provider id,
 * returns the SEND credential when asked for the send scope — and the control test asks.
 * =================================================================================
 */
export class UnsafeSharedAuditSecretSource {
  public readonly declaredProviderId: string;

  public constructor(
    providerId: string,
    private readonly material: ReadonlyMap<string, string>,
  ) {
    this.declaredProviderId = providerId;
  }

  /** THE VIOLATION: a selector. Any scope this source knows about is reachable. */
  public resolve(scopeId: string = this.declaredProviderId): Promise<AuditSecretResolution> {
    const secret = this.material.get(scopeId);
    if (secret === undefined) return Promise.resolve({ kind: 'UNAVAILABLE' });
    return Promise.resolve({
      kind: 'RESOLVED',
      credential: { secret, identity: `unsafe-shared:${scopeId}`, version: null },
    });
  }
}

/**
 * CONTROL 7 — AN AUDIT PROVIDER CLIENT THAT EXPOSES A SEND OPERATION.
 *
 * =================================================================================
 * `§16`'s PROHIBITION, AND WHY A TYPE ALONE WOULD NOT CATCH THIS
 *
 *   "Permit only declared provider-read operations needed for audit/reconciliation. No
 *    generic URL. **No send operation.**"
 *
 * TypeScript's structural typing admits EXTRA MEMBERS. An object with `providerId`,
 * `boundary`, `readFromProvider` **and `sendToProvider`** satisfies `AuditProviderReader` at
 * compile time, so a reader that gained a send method would type-check, load, and serve
 * reads correctly — while holding, in the same process and against the same credential, a
 * method that mutates provider state.
 *
 * That is why production checks the SHAPE at runtime: `isAuditProviderReader` refuses any
 * member outside the declared three and refuses fourteen mutation names explicitly, at
 * composition, before a credential is resolved.
 *
 * **THE DISCRIMINATION IS THAT THIS OBJECT REACHES A PROVIDER WITH A WRITE.** The control
 * test calls `sendToProvider` on it and observes a mutation; production refuses the same
 * object at `composeAuditReader` with `READER_MODULE_INVALID` and never resolves material.
 * =================================================================================
 */
export class UnsafeSendCapableAuditReader implements AuditProviderReader {
  public readonly providerId: string;

  public readonly boundary = PROVIDER_READ_BOUNDARY;

  /** Observable proof that the mutation happened. */
  public readonly mutations: string[] = [];

  public constructor(providerId: string) {
    this.providerId = providerId;
  }

  public readFromProvider(
    _credential: AuditReadCredential,
    query: ProviderReadQuery,
  ): Promise<ProviderReadResult> {
    return Promise.resolve({
      kind: 'EVIDENCE',
      records: [
        Object.freeze({
          providerMessageId: 'unsafe-send-capable',
          providerStatus: 'accepted',
          providerTimestampMs: query.periodStartMs,
          correlationTag: query.correlationTag,
        }),
      ],
      recordCount: 1,
    });
  }

  /**
   * THE VIOLATION. A reader with a write.
   *
   * It presents the AUDIT credential — the one `48 §3.6` exempts from carrying an
   * `authorisation_ref` **because it only reads** — at a mutating boundary.
   */
  public sendToProvider(credential: AuditReadCredential, body: string): Promise<string> {
    this.mutations.push(body);
    return Promise.resolve(`mutated:${credential.identity ?? 'unknown'}`);
  }
}

/**
 * CONTROL 8 — AN AUDIT FINDING DERIVED FROM THE CONTROL PLANE'S OWN VERDICT.
 *
 * =================================================================================
 * `§14`'s PROHIBITION, AND `30 §5.4`'s REASON FOR IT
 *
 *   "**Do not make audit verification depend on a control-plane `verified=true`.**"
 *
 * `30 §5.4` states the general form: an audit check whose declared inputs contain a
 * control-plane read is an audit check that agrees with the plane it is auditing. The
 * failure is not that the control plane lies often; it is that when it does, the audit
 * plane's agreement is what makes the lie durable — `36 §12`'s self-agreement failure.
 *
 * This function short-circuits on the control plane's belief and reaches the provider
 * evidence only when the control plane already said "not verified". A reviewer reading it
 * sees an optimisation.
 *
 * **THE DISCRIMINATION IS A FABRICATED CONTROL RESULT.** Given `controlVerified: true` and
 * provider evidence containing NO matching record, this returns `CORROBORATED`; production's
 * `deriveIndependentFinding` has no parameter for `controlVerified` at all and returns
 * `MISSING_PROVIDER_RECORD` on the same evidence.
 * =================================================================================
 */
export function unsafeControlTrustingFinding(
  outcome: AuditReadOutcome,
  expectation: AuditExpectation,
  controlVerified: boolean,
): IndependentFinding {
  // THE VIOLATION: the control plane's own verdict decides the audit plane's finding.
  if (controlVerified) {
    return Object.freeze({
      finding: 'CORROBORATED',
      matchingRecordCount: 0,
      providerStatuses: Object.freeze([]),
    });
  }
  if (outcome.kind === 'NO_EVIDENCE') {
    // AND THE SECOND VIOLATION, which is the one that survives a reviewer removing the
    // first: a read that did not happen is reported as the provider holding nothing.
    return Object.freeze({
      finding: 'PROVIDER_HAS_NO_RECORD',
      matchingRecordCount: 0,
      providerStatuses: Object.freeze([]),
    });
  }
  const matching = outcome.records.filter(
    (record: ProviderEvidenceRecord) => record.correlationTag === expectation.correlationTag,
  );
  return Object.freeze({
    finding: matching.length > 0 ? 'CORROBORATED' : 'MISSING_PROVIDER_RECORD',
    matchingRecordCount: matching.length,
    providerStatuses: Object.freeze(matching.map((record) => record.providerStatus)),
  });
}

/**
 * CONTROL 9 — A READ PROTOCOL THAT ACCEPTS A CALLER-SUPPLIED URL.
 *
 * =================================================================================
 * `§16`'s FIRST PROHIBITION
 *
 *   "Closed read-only request protocol. [...] **No generic URL.**"
 *
 * The defect arrives as a feature request: the closed operation set does not cover a query
 * somebody needs, so a `url` member is added "just for the audit plane, which only reads".
 * It is read-only in intent and arbitrary in capability — the audit credential is presented
 * at whatever host the caller named, so a caller that can reach this protocol can exfiltrate
 * the audit credential to an endpoint of its own choosing by asking the reader to "read"
 * from it.
 *
 * Production's `ProviderReadRequest` has no `url`, `path`, `endpoint`, `host`, `origin`,
 * `method`, `headers`, `body` or `query` member, `decodeProviderReadRequest` refuses an
 * unknown field outright, and nothing in the audit plane constructs a `URL`.
 *
 * **THE DISCRIMINATION IS THAT THIS DECODER ACCEPTS A MESSAGE CARRYING A URL** and
 * production refuses the same message with `UNKNOWN_FIELD`.
 * =================================================================================
 */
export interface UnsafeUrlBearingReadRequest {
  readonly protocolVersion: string;
  readonly kind: string;
  readonly readId: string;
  /** THE VIOLATION. */
  readonly url: string;
  readonly periodStartMs: number;
  readonly periodEndMs: number;
}

export function unsafeDecodeUrlBearingReadRequest(
  raw: unknown,
): UnsafeUrlBearingReadRequest | null {
  if (typeof raw !== 'string') return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const record = parsed as Record<string, unknown>;
  if (record.protocolVersion !== AUDIT_READ_PROTOCOL_VERSION) return null;
  // THE VIOLATION: unknown fields are tolerated and a destination is one of them.
  if (typeof record.url !== 'string') return null;
  if (typeof record.readId !== 'string') return null;
  if (typeof record.periodStartMs !== 'number') return null;
  if (typeof record.periodEndMs !== 'number') return null;
  return {
    protocolVersion: record.protocolVersion,
    kind: String(record.kind),
    readId: record.readId,
    url: record.url,
    periodStartMs: record.periodStartMs,
    periodEndMs: record.periodEndMs,
  };
}

/**
 * A host with GUARDS 3 and 4 REMOVED.
 *
 * Production's `handleProviderReadRequest` refuses a mutation-capable reader and a
 * non-`READ_ONLY` credential class before resolving any material. This one resolves first
 * and reads afterwards, which is the ordering defect the guard list exists to prevent.
 */
export async function unsafeHandleProviderReadRequest(
  configuration: AuditReaderConfiguration,
  request: {
    readonly readId: string;
    readonly operation: ProviderReadQuery['operation'];
    readonly periodStartMs: number;
    readonly periodEndMs: number;
    readonly correlationTag: string | null;
    readonly providerMessageId: string | null;
    readonly maxRecords: number;
  },
): Promise<AuditHostReply> {
  // THE VIOLATION: no reader-shape check, and no credential-risk-class check.
  const resolution = await configuration.secretSource.resolve();
  if (resolution.kind !== 'RESOLVED') {
    return Object.freeze({
      protocolVersion: AUDIT_READ_PROTOCOL_VERSION,
      kind: PROVIDER_READ_REFUSED_KIND,
      readId: request.readId,
      reason: 'CREDENTIAL_UNAVAILABLE',
    });
  }
  const result = await configuration.reader.readFromProvider(resolution.credential, request);
  if (result.kind === 'PROVIDER_UNAVAILABLE') {
    return Object.freeze({
      protocolVersion: AUDIT_READ_PROTOCOL_VERSION,
      kind: PROVIDER_READ_REFUSED_KIND,
      readId: request.readId,
      reason: 'PROVIDER_UNAVAILABLE',
    });
  }
  return Object.freeze({
    protocolVersion: AUDIT_READ_PROTOCOL_VERSION,
    kind: PROVIDER_READ_RESPONSE_KIND,
    readId: request.readId,
    operation: request.operation,
    records: result.records,
    recordCount: result.recordCount,
    credentialIdentity: resolution.credential.identity,
    providerQueriedAtMs: 0,
  });
}

/**
 * A registry that admits any reader descriptor, whatever the class-5 record says.
 *
 * No class-5 lookup, no `READ_ONLY` check, no locator-collision check. Used where a control
 * needs a registry to EXIST so a later assertion has something to compare against.
 */
export function unsafeAuditReaderRegistry(
  descriptors: readonly AuditReaderDescriptor[],
): AuditReaderRegistry {
  const byProvider = new Map<string, AuditReaderDescriptor>();
  for (const descriptor of descriptors) {
    // THE VIOLATION: the audit plane launches a reader on a credential nobody classified,
    // from a locator that may be the send side's own.
    byProvider.set(descriptor.providerId, descriptor);
  }
  return Object.freeze({
    resolve: (providerId: string): AuditReaderDescriptor | undefined => byProvider.get(providerId),
    registeredIds: Object.freeze([...byProvider.keys()].sort()),
    credentialScopeOf: () => undefined,
  });
}

/** A source that always resolves, for composing the controls above. */
export function fixedAuditSecretSource(
  providerId: string,
  secret: string,
  identity: string | null = 'unsafe-fixture',
): AuditReadSecretSource {
  return {
    declaredProviderId: providerId,
    resolve: () =>
      Promise.resolve({ kind: 'RESOLVED', credential: { secret, identity, version: null } }),
  };
}
