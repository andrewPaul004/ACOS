import { fork, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { AdapterOutcome, DispatchEnvelope, ExternalEffectAdapter } from '../../kernel/gateway/adapterPort.js';
import { createAdapterRegistry, type AdapterRegistry } from '../../kernel/gateway/adapterRegistry.js';
import { buildIntegrationRuntimeEnvironment } from '../protocol/runtimeEnvironment.js';
import {
  DISPATCH_REQUEST_KIND,
  INTEGRATION_PROTOCOL_VERSION,
  computeRequestBindingDigest,
  decodeIntegrationReply,
  encodeIntegrationMessage,
  type DispatchRequest,
  type WireOutcome,
} from '../protocol/wire.js';
import type { AdapterRuntimeDescriptor, AdapterRuntimeRegistry } from './adapterRuntimeRegistry.js';

/**
 * THE CONTROL PLANE'S SIDE OF THE INTEGRATION PERIMETER. A TRANSPORT, AND NOTHING ELSE.
 *
 * =================================================================================
 * `§3` — WHAT THIS FILE TRANSFORMS
 *
 * Before S1N the production path was
 *
 *     control process -> adapter object -> vendor
 *
 * and `§2`'s `I25` — "**no process in the control plane holds a vendor credential**" — was
 * unsatisfiable by that shape, because the adapter object's credential would have been
 * resolved in control-plane memory. S1M returned PARTIAL for exactly that reason.
 *
 * After S1N it is
 *
 *     control process -> deterministic integration boundary -> dedicated adapter runtime -> vendor
 *
 * and the key property is the one `§3` states: **VENDOR CREDENTIAL BYTES NEVER ENTER
 * CONTROL-PLANE PROCESS MEMORY.** This file is the boundary, and the way it holds that
 * property is by having no route to a credential at all: it imports no secret source, reads
 * no environment variable, resolves nothing and receives nothing on the wire that could
 * carry one — `DispatchResponse` has `credentialIdentity` and `credentialVersion` and no
 * third member.
 * =================================================================================
 *
 * =================================================================================
 * WHY THIS IS AN `ExternalEffectAdapter`, STATED OUT LOUD
 *
 * The ACCEPTED `no-real-transport-boundary.test.ts` asserted that `src/` contains NO
 * `ExternalEffectAdapter` implementation at all, and said in its own comment that "a future
 * slice that adds one has to change this assertion out loud." THIS IS THAT SLICE, and the
 * assertion is amended rather than evaded: the test now names this ONE file and adds four
 * narrowing assertions that did not exist before — the file holds no secret loader, no
 * provider client, no network primitive, and it is the only file in `src/` that spawns a
 * process.
 *
 * THE SHAPE IS DELIBERATE AND IT IS WHAT KEEPS THE EFFECT GATEWAY UNCHANGED. `§19`: "The
 * Effect Gateway remains the sole production dispatch origin." `effectGateway.ts` is not
 * touched by this slice — not one line — because the thing it resolves out of its registry
 * is still an `ExternalEffectAdapter` and it still awaits `dispatch` INSIDE the dispatch
 * lease callback. So `§21`'s requirement holds structurally rather than by a new argument:
 * `25 §14.1`'s Epoch B entity lease is held across the IPC round trip for the same reason it
 * was held across the in-process call, which is that the `await` is in the same place.
 *
 * WHAT THIS OBJECT IS NOT is an adapter in the sense `49 §3.1` means. It presents no
 * credential, writes no fact the policy engine trusts, and reaches no vendor. It moves a
 * validated envelope from one process to another and translates a closed reply into the
 * closed outcome taxonomy. The TCB member is the adapter in the child.
 * =================================================================================
 */

/** The module the child executes. Resolved from THIS file's location, never from a caller. */
const RUNTIME_ENTRY_POINT = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'runtime',
  'main.ts',
);

/**
 * `§41` — THE BOUNDED RESPONSE DEADLINE.
 *
 * "Effect Gateway integration invocation must have a bounded IPC/process response deadline."
 * Ten seconds by default: long enough that a cold `fork` plus a synthetic invocation never
 * reaches it, short enough that a wedged runtime does not hold `25 §14.1`'s Epoch B entity
 * lease indefinitely — which is the availability consequence that makes the deadline
 * necessary rather than tidy.
 */
export const DEFAULT_INVOCATION_DEADLINE_MS = 10_000;

/**
 * `§42` — THE CONCURRENCY BOUND, PER RUNTIME.
 *
 * "Bound: concurrent integration invocations; queued IPC requests; message size. Do not
 * allow a compromised worker to create an unbounded process/message queue."
 *
 * ONE, and the number is forced rather than chosen. `25 §14.1`'s Epoch B holds an entity
 * advisory lock across the whole of dispatch, so two concurrent invocations for one entity
 * are already impossible; what a bound of one adds is that two invocations for DIFFERENT
 * entities do not queue inside a single runtime process, where the second would wait on the
 * first while holding its own lease. A second request arriving while one is in flight is
 * REFUSED rather than queued — `§42`: there is no queue to grow.
 */
export const MAX_CONCURRENT_INVOCATIONS_PER_RUNTIME = 1;

export interface IntegrationClientOptions {
  readonly deadlineMs?: number;
  /** Test-only observability. Production passes none, and the boundary suite asserts it. */
  readonly onRuntimeStarted?: (event: { readonly adapterId: string; readonly pid: number }) => void;
}

interface RunningRuntime {
  readonly child: ChildProcess;
  readonly descriptor: AdapterRuntimeDescriptor;
  ready: boolean;
  inFlight: number;
  pid: number;
  /** `§30`'s evidence: the key set the child reported for its own environment. */
  environmentKeys: readonly string[] | null;
  /**
   * `§29`, `§43` — THE RUNTIME'S OWN OUTPUT STREAMS, CAPTURED AND NOT FORWARDED.
   *
   * `stdio` gives the child PIPES rather than the parent's own descriptors, deliberately:
   * inheriting would mean an accidental `console.log` of an invocation object in a future
   * adapter landed in the control process's log with no boundary in between, which is
   * exactly the leak `§43` is about. Piping puts them where `§29`'s matrix can assert over
   * them, and `stdout` is asserted EMPTY — the structured stream is `stderr`.
   */
  stdout: string;
  stderr: string;
}

/**
 * The live integration transport. ONE PER CONTROL PROCESS, HOLDING ONE CHILD PER ADAPTER.
 *
 * `§7`: "one credential scope -> one adapter runtime." The map is keyed by adapter identity
 * and a descriptor can only reach it through `AdapterRuntimeRegistry`, which refuses a
 * duplicate at construction, so two credential scopes cannot share a process and one scope
 * cannot be spread across two.
 */
export class IntegrationClient {
  private readonly runtimes = new Map<string, RunningRuntime>();

  private readonly deadlineMs: number;

  private readonly onRuntimeStarted: IntegrationClientOptions['onRuntimeStarted'];

  private closed = false;

  public constructor(
    private readonly registry: AdapterRuntimeRegistry,
    options: IntegrationClientOptions = {},
  ) {
    this.deadlineMs = options.deadlineMs ?? DEFAULT_INVOCATION_DEADLINE_MS;
    this.onRuntimeStarted = options.onRuntimeStarted;
  }

  /**
   * Start one adapter's runtime. `§38`: a FIXED module path and an ARGUMENT ARRAY.
   *
   * =================================================================================
   * EVERY `fork` OPTION HERE IS LOAD-BEARING
   *
   *   modulePath     `RUNTIME_ENTRY_POINT`, computed from THIS file's own location. It is
   *                  not a parameter, not a descriptor member and not configurable. `§38`:
   *                  "The control runtime must not spawn `command = caller_input`."
   *   args           `[]`. There is nothing to put on a command line, so nothing is.
   *   env            the CONSTRUCTED allowlist (`§12`, `§30`). `fork` REPLACES the child's
   *                  environment with this object; it does not merge. The parent's control
   *                  database password, audit grant and every other variable are absent
   *                  because they were never copied.
   *   execArgv       the TypeScript loader and nothing else. No `--inspect`, no
   *                  `--experimental-*`, no flag from a descriptor. `§37`: "The worker
   *                  cannot supply [...] runtime flags."
   *   stdio          `ignore` for stdin, pipes for the two output streams, and `ipc`.
   *                  `§40`: "S1N integration process should not expose: TCP port; HTTP
   *                  listener; public Unix socket." The `ipc` descriptor is an anonymous
   *                  pipe the parent created and exactly one child inherited. It has no
   *                  address, so `§39`'s authentication question has the answer the mandate
   *                  anticipated: the channel IS the authentication.
   *   shell          NEVER SET. `fork` does not take it; this comment is here so a future
   *                  change to `spawn` reads it before adding one.
   * =================================================================================
   */
  private start(descriptor: AdapterRuntimeDescriptor): RunningRuntime {
    const child = fork(RUNTIME_ENTRY_POINT, [], {
      execPath: process.execPath,
      execArgv: ['--import', 'tsx'],
      env: buildIntegrationRuntimeEnvironment({
        adapterId: descriptor.adapterId,
        runtimeRoot: descriptor.runtimeRoot,
        adapterModule: descriptor.adapterModule,
        secretSourceModule: descriptor.secretSourceModule,
        secretLocator: descriptor.secretLocator,
        // `50 §2g` FIELD 1's ECHO. The registry is where the AUTHORITY was read: this
        // descriptor exists only because `createAdapterRuntimeRegistry` found a signed
        // class-5 record for this `credentialId`, checked its adapter binding and its risk
        // class, and refused to construct otherwise. See `ENV_EXPECTED_CREDENTIAL_ID`.
        expectedCredentialId: descriptor.credentialId,
      }),
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      serialization: 'json',
    });
    const runtime: RunningRuntime = {
      child,
      descriptor,
      ready: false,
      inFlight: 0,
      pid: child.pid ?? -1,
      environmentKeys: null,
      stdout: '',
      stderr: '',
    };
    child.stdout?.on('data', (chunk: Buffer) => {
      runtime.stdout += chunk.toString('utf8');
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      runtime.stderr += chunk.toString('utf8');
    });
    child.on('message', (raw: unknown) => {
      const decoded = decodeIntegrationReply(raw);
      if (decoded.kind === 'DECODED' && decoded.message.kind === 'RUNTIME_READY') {
        runtime.ready = true;
        runtime.pid = decoded.message.pid;
        runtime.environmentKeys = decoded.message.environmentKeys;
        this.onRuntimeStarted?.({ adapterId: descriptor.adapterId, pid: decoded.message.pid });
      }
    });
    /*
     * `§28` — AUTOMATIC RESTART RESTORES AVAILABILITY AND REPLAYS NOTHING.
     *
     * "If integration process crashes: automatic process restart may be permitted. But:
     * **AUTOMATIC RESTART MUST NOT REPLAY A CLAIMED EFFECT.** Restart only restores adapter
     * availability. It does not reconstruct the fresh claim capability."
     *
     * The exit handler DELETES the runtime and holds NOTHING ELSE. There is no last-request
     * field, no pending buffer, no retry queue and no reference to any envelope anywhere on
     * this object — `invoke` keeps its request in a local variable that dies with the call.
     * So the restart, which happens lazily on the NEXT `invoke`, has nothing to replay even
     * if it wanted to.
     *
     * AND IT COULD NOT REPLAY ANYWAY, WHICH IS THE SECOND MECHANISM. The fresh-claim
     * capability `dispatchCapability.ts` mints is consumed BEFORE `dispatch` is called and
     * revoked in the gateway's `finally`. A restarted child restores a process; it does not
     * restore the one capability that makes a claim dispatchable, and there is no way back
     * to that line after this process's stack has unwound.
     * `UnsafeReplayingSupervisor` in the negative-control suite is the discriminating
     * control: a supervisor that DOES keep the last request and re-sends it on restart.
     */
    child.on('exit', () => {
      this.runtimes.delete(descriptor.adapterId);
    });
    child.on('error', () => {
      this.runtimes.delete(descriptor.adapterId);
    });
    this.runtimes.set(descriptor.adapterId, runtime);
    return runtime;
  }

  /** The live PID for one adapter's runtime, or `null`. `§5`'s distinct-PID evidence. */
  public runtimePid(adapterId: string): number | null {
    const runtime = this.runtimes.get(adapterId);
    return runtime === undefined ? null : runtime.pid;
  }

  public isRunning(adapterId: string): boolean {
    return this.runtimes.has(adapterId);
  }

  /**
   * `§30`, `48 §4` item 4 — the key set one adapter runtime reported for its OWN environment.
   *
   * `null` until that runtime has reported ready. KEYS ONLY: the wire type carries no member
   * a value could occupy and the decoder refuses an element that is not a bare identifier.
   */
  public observedChildEnvironmentKeys(adapterId: string): readonly string[] | null {
    return this.runtimes.get(adapterId)?.environmentKeys ?? null;
  }

  /** `§29`'s log surfaces. `null` where no runtime for that adapter has started. */
  public capturedRuntimeStderr(adapterId: string): string | null {
    return this.runtimes.get(adapterId)?.stderr ?? null;
  }

  public capturedRuntimeStdout(adapterId: string): string | null {
    return this.runtimes.get(adapterId)?.stdout ?? null;
  }

  /** Stop one runtime. Used by deployment operations and by the focused suite's crash points. */
  public stop(adapterId: string): void {
    const runtime = this.runtimes.get(adapterId);
    if (runtime === undefined) return;
    this.runtimes.delete(adapterId);
    runtime.child.kill();
  }

  public async close(): Promise<void> {
    this.closed = true;
    const running = [...this.runtimes.values()];
    this.runtimes.clear();
    await Promise.all(
      running.map(
        (runtime) =>
          new Promise<void>((settle) => {
            if (runtime.child.exitCode !== null || runtime.child.signalCode !== null) {
              settle();
              return;
            }
            runtime.child.once('exit', () => {
              settle();
            });
            runtime.child.kill();
          }),
      ),
    );
  }

  /**
   * Invoke one adapter runtime for one envelope. THE ONLY SEND SITE IN `src/`.
   *
   * =================================================================================
   * THE OUTCOME MAPPING, AND WHY EACH ARM IS THE ARM IT IS — `§41`, `§26`
   *
   * `25 §7.2`'s discriminating question is "COULD THE WRITE HAVE ESCAPED?", and a process
   * boundary adds exactly one new place to ask it: between `send` succeeding and a reply
   * arriving. Every arm below answers that question and nothing else.
   *
   *   registry has no descriptor          the gateway already refused this; unreachable here
   *   runtime unavailable BEFORE send     NOT_SENT_CONFIRMED / PRE_SEND_FAILURE
   *                                       `25 §7.2`: "a failure raised BEFORE the external
   *                                       request was opened or sent". The proof is exact —
   *                                       `child.send` returned false or threw, so no bytes
   *                                       entered the channel.
   *   message will not encode / too large NOT_SENT_CONFIRMED / PRE_SEND_FAILURE, same proof
   *   concurrency bound refused           NOT_SENT_CONFIRMED / PRE_SEND_FAILURE, same proof
   *   send succeeded, child died          OUTCOME_UNKNOWN / AMBIGUOUS. The runtime may have
   *                                       reached its adapter and its provider boundary, and
   *                                       nothing here can tell. `§41`: "after invocation
   *                                       ambiguity -> OUTCOME_UNKNOWN."
   *   send succeeded, deadline elapsed    OUTCOME_UNKNOWN / TIMEOUT. `§41`: "Timeout does NOT
   *                                       mean NOT_SENT if the integration process may have
   *                                       crossed the synthetic provider boundary."
   *   reply does not decode               OUTCOME_UNKNOWN / AMBIGUOUS. `§22`: nothing
   *                                       unparseable becomes an ACOS fact, and a runtime
   *                                       that answered nonsense told the kernel nothing.
   *   REQUEST_REFUSED                     NOT_SENT_CONFIRMED / PRE_SEND_FAILURE. Every member
   *                                       of `REFUSAL_REASONS` is raised by a guard that runs
   *                                       strictly before `adapter.invoke` — see
   *                                       `integrationHost.ts`'s guard order — so a refusal
   *                                       is positive proof from a trusted runtime that no
   *                                       write crossed. This is the one arm that RELEASES a
   *                                       commitment, and it rests on the host's guard order
   *                                       rather than on a message.
   *   DISPATCH_RESPONSE                   the adapter's own closed outcome, verbatim.
   *
   * THERE IS NO RETRY ANYWHERE IN THIS FUNCTION. `§26`: "Do not create a new retry path. A
   * process boundary does NOT authorize resend."
   * =================================================================================
   */
  private async invoke(
    descriptor: AdapterRuntimeDescriptor,
    envelope: DispatchEnvelope,
  ): Promise<AdapterOutcome> {
    if (this.closed) return notSent();

    let runtime = this.runtimes.get(descriptor.adapterId);
    if (runtime === undefined) {
      try {
        runtime = this.start(descriptor);
      } catch {
        return notSent();
      }
    }
    if (runtime.inFlight >= MAX_CONCURRENT_INVOCATIONS_PER_RUNTIME) return notSent();

    const request = buildDispatchRequest(envelope);
    const encoded = encodeIntegrationMessage(request);
    if (encoded === null) return notSent();

    runtime.inFlight += 1;
    try {
      return await this.roundTrip(runtime, request.invocationId, encoded);
    } finally {
      runtime.inFlight -= 1;
    }
  }

  private roundTrip(
    runtime: RunningRuntime,
    invocationId: string,
    encoded: string,
  ): Promise<AdapterOutcome> {
    return new Promise<AdapterOutcome>((settleWith) => {
      let settled = false;
      const child = runtime.child;

      const finish = (outcome: AdapterOutcome): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        child.off('message', onMessage);
        child.off('exit', onExit);
        child.off('error', onExit);
        settleWith(outcome);
      };

      const onMessage = (raw: unknown): void => {
        const decoded = decodeIntegrationReply(raw);
        if (decoded.kind === 'REFUSED') {
          // A reply that does not decode is not evidence of anything. It is NOT treated as a
          // refusal, because a refusal releases a commitment and an unparseable message
          // proves nothing about whether a write escaped.
          finish({ kind: 'OUTCOME_UNKNOWN', reason: 'AMBIGUOUS' });
          return;
        }
        const message = decoded.message;
        if (message.kind === 'RUNTIME_READY') return;
        if (message.invocationId !== invocationId) return;
        if (message.kind === 'REQUEST_REFUSED') {
          finish(notSent());
          return;
        }
        finish(translateWireOutcome(message.outcome));
      };

      const onExit = (): void => {
        finish({ kind: 'OUTCOME_UNKNOWN', reason: 'AMBIGUOUS' });
      };

      const timer = setTimeout(() => {
        finish({ kind: 'OUTCOME_UNKNOWN', reason: 'TIMEOUT' });
      }, this.deadlineMs);
      // The deadline must not hold the event loop open on its own.
      timer.unref?.();

      child.on('message', onMessage);
      child.once('exit', onExit);
      child.once('error', onExit);

      let sent = false;
      try {
        sent = child.send(encoded);
      } catch {
        sent = false;
      }
      if (!sent) {
        // NOTHING ENTERED THE CHANNEL. This is the one branch with positive proof of
        // non-transmission, and it is why `PRE_SEND_FAILURE` is honest here.
        finish(notSent());
      }
    });
  }

  /**
   * Build the `AdapterRegistry` the Effect Gateway resolves out of.
   *
   * =================================================================================
   * WHAT THE PROXY CARRIES, AND WHAT IT CANNOT
   *
   * `adapterId` and `resolutionCapabilities` come from the DESCRIPTOR, which
   * `createAdapterRuntimeRegistry` already validated against the verified class-3 catalogue.
   * `createAdapterRegistry` then validates them AGAIN against the same catalogue, which is
   * not redundant: the two registries are constructed separately and a composition that
   * wired mismatched ones must not start.
   *
   * The proxy closes over the descriptor and over this client. It does not close over a
   * credential, a locator, an environment or a path, because it has none of those and no way
   * to obtain one: this whole module imports no secret source, no filesystem reader and no
   * environment.
   * =================================================================================
   */
  public adapterRegistry(): AdapterRegistry {
    const proxies: ExternalEffectAdapter[] = [];
    for (const adapterId of this.registry.registeredIds) {
      const descriptor = this.registry.resolve(adapterId);
      if (descriptor === undefined) continue;
      proxies.push({
        adapterId: descriptor.adapterId,
        resolutionCapabilities: descriptor.resolutionCapabilities,
        dispatch: (envelope: DispatchEnvelope): Promise<AdapterOutcome> =>
          this.invoke(descriptor, envelope),
      });
    }
    return createAdapterRegistry(proxies);
  }
}

/** `25 §7.2`'s `PRE_SEND_FAILURE`, as one function so every proven-not-sent arm is one arm. */
function notSent(): AdapterOutcome {
  return { kind: 'NOT_SENT_CONFIRMED', basis: 'PRE_SEND_FAILURE' };
}

/**
 * Translate a decoded wire outcome into the kernel's own taxonomy.
 *
 * A TOTAL FUNCTION OVER A CLOSED UNION, and an exhaustiveness check rather than a default
 * arm: adding a fifth wire member without adding its kernel counterpart does not compile.
 */
function translateWireOutcome(outcome: WireOutcome): AdapterOutcome {
  switch (outcome.kind) {
    case 'ADAPTER_RETURNED':
      return {
        kind: 'ADAPTER_RETURNED',
        providerReference: outcome.providerReference,
        rawResponseHash: outcome.rawResponseHash,
      };
    case 'OUTCOME_UNKNOWN':
      return { kind: 'OUTCOME_UNKNOWN', reason: outcome.reason };
    case 'NOT_SENT_CONFIRMED':
      return { kind: 'NOT_SENT_CONFIRMED', basis: outcome.basis };
    case 'ADAPTER_FAILED':
      return { kind: 'ADAPTER_FAILED', failureClass: outcome.failureClass };
  }
}

/**
 * Build the wire request from ONE envelope. EVERY FIELD COMES FROM THE ENVELOPE.
 *
 * `§13`'s field list, and nothing else: there is no parameter on this function besides the
 * envelope, so there is no route by which a caller's value could reach the wire. The
 * `invocationId` is minted here and is `§27`'s transport identifier — it is not an
 * idempotency key, and the idempotency key travels beside it, unchanged, in its own field.
 */
export function buildDispatchRequest(envelope: DispatchEnvelope): DispatchRequest {
  const withoutDigest = {
    protocolVersion: INTEGRATION_PROTOCOL_VERSION,
    kind: DISPATCH_REQUEST_KIND,
    invocationId: randomUUID(),
    adapterId: envelope.adapter,
    method: envelope.method,
    actionClass: envelope.actionClass,
    recoverability: envelope.recoverability,
    // `I24`. The authorisation the committed effect carries, read from the envelope the
    // gateway built from the committed outbox row — never a parameter, anywhere.
    authorisationRef: envelope.authorisationId,
    companyId: envelope.companyId,
    outboxId: envelope.outboxId,
    claimId: envelope.claimId,
    effectId: envelope.effectId,
    idempotencyKey: envelope.idempotencyKey,
    correlationTag: envelope.correlationTag,
    resourceRef: envelope.resourceRef,
    requiresUnmirroredTag: envelope.requiresUnmirroredTag,
    overrideRef: envelope.overrideId,
    dispatchPayloadHash: envelope.dispatchPayloadHash,
    dispatchPayloadBase64: envelope.payloadCanonicalBytes.toString('base64'),
  } as const;
  return Object.freeze({
    ...withoutDigest,
    bindingDigest: computeRequestBindingDigest(withoutDigest),
  });
}
