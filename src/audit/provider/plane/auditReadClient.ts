import { fork, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildAuditReaderEnvironment } from '../protocol/readerEnvironment.js';
import {
  AUDIT_READ_PROTOCOL_VERSION,
  MAX_RECORDS_PER_READ,
  PROVIDER_READ_REQUEST_KIND,
  computeReadDigest,
  decodeAuditReaderReply,
  encodeAuditReadMessage,
  type ProviderEvidenceRecord,
  type ProviderReadOperation,
  type ProviderReadRefusal,
  type ProviderReadRequest,
} from '../protocol/readWire.js';
import type { AuditReaderDescriptor, AuditReaderRegistry } from './auditReaderRegistry.js';

/**
 * THE AUDIT PLANE'S SIDE OF THE PROVIDER-READ PERIMETER. A TRANSPORT, AND NOTHING ELSE.
 *
 * =================================================================================
 * `§13`, `§14` — WHAT THIS FILE MAKES TRUE
 *
 * Before S1O the audit plane had no process a provider read could happen in, so
 * `48 §2` row 13 — "Audit plane vendor reads" — described a capability with no component,
 * and `48 §3.6`'s "read-only, separately provisioned, and attempted-write-tested" was a
 * requirement with nothing to hold it.
 *
 *     before      audit plane ──► (nothing)
 *     after       audit plane ──► closed read-only boundary ──► dedicated reader runtime ──► provider
 *
 * The key property is the mirror of `I25`'s: **the audit read credential's bytes never enter
 * the audit plane's own process, and never enter the control plane or the integration
 * runtime at all.** This file is the boundary, and the way it holds that property is by
 * having no route to a credential: it imports no secret source, reads no environment
 * variable, resolves nothing, and receives nothing on the wire that could carry one —
 * `ProviderReadResponse` has `credentialIdentity` and no second member.
 *
 * =================================================================================
 * `§14` — THE RESULT IS THE PROVIDER'S, AND THIS FILE CANNOT MAKE IT ANYTHING ELSE
 *
 * "Do not make audit verification depend on a control-plane `verified=true`."
 *
 * `read()` returns provider records and a provider count. It has no parameter through which
 * a control-plane expectation could arrive, it performs no comparison, and it produces no
 * `verified` field. The comparison belongs to `independentFinding.ts`, which takes provider
 * evidence and an audit-derived expectation and is deliberately unable to accept a
 * control-plane verdict as either operand.
 * =================================================================================
 */

/** The module the child executes. Resolved from THIS file's location, never from a caller. */
const READER_ENTRY_POINT = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'runtime',
  'main.ts',
);

/**
 * The bounded read deadline.
 *
 * Fifteen seconds: longer than the integration plane's ten because a provider activity query
 * is a heavier call than a send, short enough that a wedged reader does not stall an `I8`
 * sweep. **Nothing holds a lock across this await** — unlike the integration client, whose
 * round trip sits inside `25 §14.1`'s Epoch B dispatch lease — because an audit read is not
 * part of any economic transaction. That is stated here so a future change that puts one
 * inside a lease has to argue for it.
 */
export const DEFAULT_READ_DEADLINE_MS = 15_000;

/**
 * The concurrency bound, per reader.
 *
 * ONE, and for a different reason than the integration plane's: there is no entity lease to
 * protect here, and the bound exists so a compromised audit component cannot create an
 * unbounded queue of provider reads inside a single process. A second request arriving while
 * one is in flight is REFUSED rather than queued — there is no queue to grow.
 */
export const MAX_CONCURRENT_READS_PER_READER = 1;

export interface AuditReadClientOptions {
  readonly deadlineMs?: number;
  /** Test-only observability. Production passes none, and the boundary suite asserts it. */
  readonly onReaderStarted?: (event: {
    readonly providerId: string;
    readonly pid: number;
  }) => void;
}

interface RunningReader {
  readonly child: ChildProcess;
  readonly descriptor: AuditReaderDescriptor;
  ready: boolean;
  inFlight: number;
  pid: number;
  environmentKeys: readonly string[] | null;
  declaredCredentialRiskClass: string | null;
  /**
   * `§17` — THE READER'S OWN OUTPUT STREAMS, CAPTURED AND NOT FORWARDED.
   *
   * `stdio` gives the child PIPES rather than the parent's own descriptors: inheriting
   * would mean an accidental `console.log` of a resolved credential in a future reader
   * landed in the audit plane's log with no boundary in between, which is exactly the leak
   * `§17` is about. Piping puts them where the leak matrix can assert over them, and
   * `stdout` is asserted EMPTY — the structured stream is `stderr`.
   */
  stdout: string;
  stderr: string;
}

/** What one read produced, as the AUDIT PLANE sees it. */
export type AuditReadOutcome =
  | {
      readonly kind: 'EVIDENCE';
      readonly records: readonly ProviderEvidenceRecord[];
      readonly recordCount: number;
      readonly credentialIdentity: string | null;
      readonly providerQueriedAtMs: number;
      /** Evidence about what was asked. Never an authority token. */
      readonly readDigest: string;
    }
  /** No evidence was obtained, and the closed reason why. */
  | { readonly kind: 'NO_EVIDENCE'; readonly reason: ProviderReadRefusal };

/** One read, as the audit plane expresses it. No URL, no path, no method. */
export interface AuditReadQuery {
  readonly providerId: string;
  readonly operation: ProviderReadOperation;
  readonly periodStartMs: number;
  readonly periodEndMs: number;
  readonly correlationTag?: string | null;
  readonly providerMessageId?: string | null;
  readonly maxRecords?: number;
}

/**
 * The live audit read transport. ONE PER AUDIT PROCESS, HOLDING ONE CHILD PER PROVIDER.
 *
 * The map is keyed by provider identity and a descriptor can only reach it through
 * `AuditReaderRegistry`, which refuses a duplicate at construction, so two credential scopes
 * cannot share a process and one scope cannot be spread across two.
 */
export class AuditReadClient {
  private readonly readers = new Map<string, RunningReader>();

  private readonly deadlineMs: number;

  private readonly onReaderStarted: AuditReadClientOptions['onReaderStarted'];

  private closed = false;

  public constructor(
    private readonly registry: AuditReaderRegistry,
    options: AuditReadClientOptions = {},
  ) {
    this.deadlineMs = options.deadlineMs ?? DEFAULT_READ_DEADLINE_MS;
    this.onReaderStarted = options.onReaderStarted;
  }

  /**
   * Start one provider's reader. A FIXED module path and an ARGUMENT ARRAY.
   *
   * =================================================================================
   * EVERY `fork` OPTION IS LOAD-BEARING, AND EACH MIRRORS S1N's FOR THIS PLANE
   *
   *   modulePath   `READER_ENTRY_POINT`, computed from THIS file's own location. Not a
   *                parameter, not a descriptor member, not configurable.
   *   args         `[]`. Nothing to put on a command line, so nothing is.
   *   env          the CONSTRUCTED eight-key allowlist. `fork` REPLACES the child's
   *                environment; it does not merge. The audit plane's own database URL is
   *                absent because it was never copied, and so is every integration key —
   *                `auditAllowlistIsDisjointFromIntegration()` is the assertion.
   *   execArgv     the TypeScript loader and nothing else. No flag from a descriptor.
   *   stdio        `ignore` for stdin, pipes for the two output streams, and `ipc`. No TCP
   *                port, no HTTP listener, no named socket. The `ipc` descriptor is an
   *                anonymous pipe the parent created and exactly one child inherited; it has
   *                no address, so the channel IS the authentication, exactly as `S1N-C2`
   *                records for the Z1→Z2 edge.
   *   shell        NEVER SET.
   * =================================================================================
   */
  private start(descriptor: AuditReaderDescriptor): RunningReader {
    const scope = this.registry.credentialScopeOf(descriptor.providerId);
    if (scope === undefined) {
      // Unreachable through `createAuditReaderRegistry`, which records a scope for every
      // descriptor it admits. Present because this is the last point before a credential
      // locator enters a child environment, and `50 §2g`'s fail-closed rule should hold at
      // the boundary that acts on it as well as at the one that produced it.
      throw new Error(
        `no verified class-5 credential scope for provider "${descriptor.providerId}"; ` +
          '50 §2g fails closed rather than launching a reader on an undeclared credential',
      );
    }

    const child = fork(READER_ENTRY_POINT, [], {
      execPath: process.execPath,
      execArgv: ['--import', 'tsx'],
      env: buildAuditReaderEnvironment({
        providerId: descriptor.providerId,
        runtimeRoot: descriptor.runtimeRoot,
        readerModule: descriptor.readerModule,
        secretSourceModule: descriptor.secretSourceModule,
        secretLocator: descriptor.secretLocator,
        // The ECHO, and the registry is where the authority was read. See
        // `ENV_AUDIT_CREDENTIAL_RISK_CLASS`'s own comment: this can only narrow.
        credentialRiskClass: scope.credentialRiskClass,
        // THE SECOND ECHO. `50 §2g` field 1, from the record the AUDIT PLANE's own verifier
        // read and this registry admitted the descriptor against. It is the identity the
        // reader must find in its own hand; see `ENV_AUDIT_EXPECTED_CREDENTIAL_ID`.
        expectedCredentialId: scope.credentialId,
      }),
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      serialization: 'json',
    });

    const reader: RunningReader = {
      child,
      descriptor,
      ready: false,
      inFlight: 0,
      pid: child.pid ?? -1,
      environmentKeys: null,
      declaredCredentialRiskClass: null,
      stdout: '',
      stderr: '',
    };
    child.stdout?.on('data', (chunk: Buffer) => {
      reader.stdout += chunk.toString('utf8');
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      reader.stderr += chunk.toString('utf8');
    });
    child.on('message', (raw: unknown) => {
      const decoded = decodeAuditReaderReply(raw);
      if (decoded.kind === 'DECODED' && decoded.message.kind === 'AUDIT_READER_READY') {
        reader.ready = true;
        reader.pid = decoded.message.pid;
        reader.environmentKeys = decoded.message.environmentKeys;
        reader.declaredCredentialRiskClass = decoded.message.declaredCredentialRiskClass;
        this.onReaderStarted?.({ providerId: descriptor.providerId, pid: decoded.message.pid });
      }
    });
    // A reader that exits is FORGOTTEN and nothing else is held. There is no last-request
    // field, no pending buffer and no retry queue, so a restart — which happens lazily on
    // the next read — has nothing to replay even if something asked it to.
    child.on('exit', () => {
      this.readers.delete(descriptor.providerId);
    });
    child.on('error', () => {
      this.readers.delete(descriptor.providerId);
    });
    this.readers.set(descriptor.providerId, reader);
    return reader;
  }

  /** The live PID for one provider's reader, or `null`. The process-separation evidence. */
  public readerPid(providerId: string): number | null {
    const reader = this.readers.get(providerId);
    return reader === undefined ? null : reader.pid;
  }

  public isRunning(providerId: string): boolean {
    return this.readers.has(providerId);
  }

  /** `§17`'s evidence: the key set one reader reported for its OWN environment. KEYS ONLY. */
  public observedReaderEnvironmentKeys(providerId: string): readonly string[] | null {
    return this.readers.get(providerId)?.environmentKeys ?? null;
  }

  /** The risk class the reader itself reported having started under. Evidence. */
  public observedCredentialRiskClass(providerId: string): string | null {
    return this.readers.get(providerId)?.declaredCredentialRiskClass ?? null;
  }

  public capturedReaderStderr(providerId: string): string | null {
    return this.readers.get(providerId)?.stderr ?? null;
  }

  public capturedReaderStdout(providerId: string): string | null {
    return this.readers.get(providerId)?.stdout ?? null;
  }

  public stop(providerId: string): void {
    const reader = this.readers.get(providerId);
    if (reader === undefined) return;
    this.readers.delete(providerId);
    reader.child.kill();
  }

  public async close(): Promise<void> {
    this.closed = true;
    const running = [...this.readers.values()];
    this.readers.clear();
    await Promise.all(
      running.map(
        (reader) =>
          new Promise<void>((settle) => {
            if (reader.child.exitCode !== null || reader.child.signalCode !== null) {
              settle();
              return;
            }
            reader.child.once('exit', () => {
              settle();
            });
            reader.child.kill();
          }),
      ),
    );
  }

  /**
   * Perform one provider read. THE ONLY READ SITE IN THE AUDIT PLANE.
   *
   * =================================================================================
   * EVERY ARM RETURNS `NO_EVIDENCE` WITH A CLOSED REASON, AND NONE INVENTS EVIDENCE
   *
   * The integration client's outcome mapping answers "could the write have escaped?". This
   * one answers a different and simpler question — **did the provider tell us something?** —
   * and the honest answer to everything except a decoded response is "no".
   *
   * THAT ASYMMETRY MATTERS. A missing write outcome is ambiguous and must be carried as
   * `OUTCOME_UNKNOWN`; a missing READ is not ambiguous at all. The audit plane simply did not
   * learn, and a read that returns "no evidence" must never be read downstream as "the
   * provider holds no record", which is why `AuditReadOutcome` has no member that could be
   * confused with an empty evidence set: `EVIDENCE` with zero records and `NO_EVIDENCE` are
   * different values, and `independentFinding.ts` treats them differently.
   * =================================================================================
   */
  public async read(query: AuditReadQuery): Promise<AuditReadOutcome> {
    if (this.closed) return { kind: 'NO_EVIDENCE', reason: 'PROVIDER_UNAVAILABLE' };

    const descriptor = this.registry.resolve(query.providerId);
    if (descriptor === undefined) {
      return { kind: 'NO_EVIDENCE', reason: 'PROVIDER_IDENTITY_MISMATCH' };
    }

    let reader = this.readers.get(query.providerId);
    if (reader === undefined) {
      try {
        reader = this.start(descriptor);
      } catch {
        return { kind: 'NO_EVIDENCE', reason: 'CREDENTIAL_UNAVAILABLE' };
      }
    }
    if (reader.inFlight >= MAX_CONCURRENT_READS_PER_READER) {
      return { kind: 'NO_EVIDENCE', reason: 'RECORD_BOUND_EXCEEDED' };
    }

    const request: ProviderReadRequest = Object.freeze({
      protocolVersion: AUDIT_READ_PROTOCOL_VERSION,
      kind: PROVIDER_READ_REQUEST_KIND,
      readId: randomUUID(),
      operation: query.operation,
      providerId: query.providerId,
      periodStartMs: query.periodStartMs,
      periodEndMs: query.periodEndMs,
      correlationTag: query.correlationTag ?? null,
      providerMessageId: query.providerMessageId ?? null,
      maxRecords: query.maxRecords ?? MAX_RECORDS_PER_READ,
    });
    const encoded = encodeAuditReadMessage(request);
    if (encoded === null) return { kind: 'NO_EVIDENCE', reason: 'RESPONSE_TOO_LARGE' };

    reader.inFlight += 1;
    try {
      return await this.roundTrip(reader, request, encoded);
    } finally {
      reader.inFlight -= 1;
    }
  }

  private roundTrip(
    reader: RunningReader,
    request: ProviderReadRequest,
    encoded: string,
  ): Promise<AuditReadOutcome> {
    return new Promise<AuditReadOutcome>((settleWith) => {
      let settled = false;
      const child = reader.child;

      const finish = (outcome: AuditReadOutcome): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        child.off('message', onMessage);
        child.off('exit', onExit);
        child.off('error', onExit);
        settleWith(outcome);
      };

      const onMessage = (raw: unknown): void => {
        const decoded = decodeAuditReaderReply(raw);
        if (decoded.kind === 'REFUSED') {
          // A reply that does not decode is not evidence of anything, and is NOT treated as
          // an empty result: an unparseable message proves nothing about what the provider
          // holds.
          finish({ kind: 'NO_EVIDENCE', reason: decoded.reason });
          return;
        }
        const message = decoded.message;
        if (message.kind === 'AUDIT_READER_READY') return;
        if (message.readId !== request.readId) return;
        if (message.kind === 'PROVIDER_READ_REFUSED') {
          finish({ kind: 'NO_EVIDENCE', reason: message.reason });
          return;
        }
        finish({
          kind: 'EVIDENCE',
          records: message.records,
          recordCount: message.recordCount,
          credentialIdentity: message.credentialIdentity,
          providerQueriedAtMs: message.providerQueriedAtMs,
          readDigest: computeReadDigest(request),
        });
      };

      const onExit = (): void => {
        finish({ kind: 'NO_EVIDENCE', reason: 'PROVIDER_UNAVAILABLE' });
      };

      const timer = setTimeout(() => {
        finish({ kind: 'NO_EVIDENCE', reason: 'PROVIDER_UNAVAILABLE' });
      }, this.deadlineMs);

      child.on('message', onMessage);
      child.once('exit', onExit);
      child.once('error', onExit);

      let sent = false;
      try {
        sent = child.send(encoded);
      } catch {
        sent = false;
      }
      if (!sent) finish({ kind: 'NO_EVIDENCE', reason: 'PROVIDER_UNAVAILABLE' });
    });
  }
}
