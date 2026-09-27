import { isAbsolute, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  ENV_AUDIT_CREDENTIAL_RISK_CLASS,
  ENV_AUDIT_EXPECTED_CREDENTIAL_ID,
  ENV_AUDIT_PROTOCOL_VERSION,
  ENV_AUDIT_PROVIDER_ID,
  ENV_AUDIT_READER_IDENTITY,
  ENV_AUDIT_READER_MODULE,
  ENV_AUDIT_RUNTIME_ROOT,
  ENV_AUDIT_SECRET_LOCATOR,
  ENV_AUDIT_SECRET_SOURCE_MODULE,
} from '../protocol/readerEnvironment.js';
import {
  AUDIT_READER_READY_KIND,
  AUDIT_READ_PROTOCOL_VERSION,
  encodeAuditReadMessage,
  type AuditReaderReady,
} from '../protocol/readWire.js';
import {
  auditProviderReaderIdentity,
  providerIdOfAuditReaderIdentity,
} from '../protocol/readerIdentity.js';
import type { AuditReadSecretSource } from './auditSecretSource.js';
import {
  REQUIRED_AUDIT_CREDENTIAL_RISK_CLASS,
  handleProviderReadRequest,
  type AuditReaderConfiguration,
} from './auditReadHost.js';
import { isAuditProviderReaderModule } from './auditProviderReader.js';
import { emitAuditReadLog } from './auditReadLog.js';

/**
 * THE AUDIT PROVIDER-READ RUNTIME'S ENTRY POINT. THE PROCESS `§14` IS ABOUT.
 *
 * =================================================================================
 * `§14` — A REAL OS PROCESS, AND THE MECHANISM IS THE POINT
 *
 * "Use a genuinely separate audit-side provider-read runtime/process if current architecture
 * requires it. At minimum ensure: **separate OS process / architecture-equivalent trust
 * boundary**; separate credential source; separate environment allowlist; no control send
 * credential; no write capability; no reliance on control adapter result."
 *
 * It does. `I25` is a statement about a PROCESS, and `48 §2` row 13's read-only exemption is
 * a statement about a CREDENTIAL; neither is satisfiable by an object in a process that also
 * holds the other plane's material. This module is executed by `child_process.fork` in a
 * process of its own, with its own PID, heap, module registry, environment and filesystem
 * view, and the only channel between it and its parent is the private descriptor the parent
 * created.
 *
 * **`§30`'s REGRESSION LIST IS PRESERVED BY REUSING S1N's PRIMITIVES, NOT BY COPYING ITS
 * CODE.** `§14`: "Reuse S1N's process-isolation primitives where safe." The primitives
 * reused are the TECHNIQUES — a constructed environment allowlist, a fixed module path, an
 * argument array, a confinement root, `stdio` with no listener — and each is re-implemented
 * against this plane's own constants, because sharing the modules would put the integration
 * plane's protocol into the audit reader's import closure, which is the coupling `§13`
 * forbids one level up.
 *
 * =================================================================================
 * `§16` — NO GENERIC URL REACHES THIS PROCESS, AND NO SEND LEAVES IT
 *
 * The inbound surface is `process.on('message')` on an inherited descriptor, and the only
 * thing it accepts is a `PROVIDER_READ_REQUEST` naming one of three closed operations. The
 * runtime opens **no** TCP port, **no** HTTP listener and **no** named socket, and the
 * reader object it loads is refused at composition if it carries a mutation member.
 *
 * =================================================================================
 * `§14` — AND IT CANNOT READ A CONTROL-PLANE RESULT EVEN IF IT WANTED TO
 *
 * "Do not make audit verification depend on a control-plane `verified=true`."
 *
 * The child environment carries nine keys and not one of them is a control-plane variable;
 * there is no `ACOS_CONTROL_PG_URL`, so no control database is reachable; and the wire
 * protocol has no member a control verdict could occupy. The independence is structural in
 * the same sense `30 §5.4` means: the declared inputs contain no control-plane read.
 * =================================================================================
 */

/** A startup failure. Written to `stderr` as a closed code and never as a stack. */
export const AUDIT_STARTUP_FAILURES = [
  'ENV_MISSING',
  'ENV_PROTOCOL_MISMATCH',
  'ENV_IDENTITY_MISMATCH',
  'MODULE_OUTSIDE_RUNTIME_ROOT',
  'READER_MODULE_INVALID',
  'SECRET_SOURCE_MODULE_INVALID',
  'PROVIDER_IDENTITY_MISMATCH',
  /** `§13`: the audit plane's credential must be incapable of external mutation. */
  'CREDENTIAL_NOT_READ_ONLY',
] as const;

export type AuditStartupFailure = (typeof AUDIT_STARTUP_FAILURES)[number];

export class AuditReaderStartupError extends Error {
  public readonly failure: AuditStartupFailure;

  public constructor(failure: AuditStartupFailure) {
    // THE MESSAGE IS THE CODE. A startup error printing the specifier it refused would print
    // a filesystem path, and a path is one of the things an audit failure must not teach.
    super(failure);
    this.failure = failure;
    this.name = 'AuditReaderStartupError';
  }
}

function readEnv(key: string): string {
  const value = process.env[key];
  if (value === undefined || value.length === 0) {
    throw new AuditReaderStartupError('ENV_MISSING');
  }
  return value;
}

/**
 * `29 §3.5`'s confinement check, applied to the audit plane's own reader package.
 *
 * A specifier must resolve to an absolute path inside the runtime root. Deliberately a
 * SECOND implementation of the same containment test `integration/runtime/main.ts` holds:
 * importing that one would put the integration plane's entry point into this process's
 * module graph, which is the one thing this file exists to avoid.
 */
export function isInsideAuditRuntimeRoot(runtimeRoot: string, specifier: string): boolean {
  if (!isAbsolute(specifier)) return false;
  const root = resolve(runtimeRoot);
  const target = resolve(specifier);
  if (target === root) return false;
  const rel = relative(root, target);
  return rel.length > 0 && !rel.startsWith('..') && !isAbsolute(rel);
}

/**
 * What a secret-source module must export: a FACTORY taking the locator, not an instance.
 *
 * A factory rather than a ready-made source because the locator is per runtime and the
 * source must be SCOPED to this runtime's provider at construction —
 * `auditSecretSource.ts` explains why a source with a selector signature is not a boundary.
 */
export interface AuditSecretSourceModule {
  readonly createAuditReadSecretSource: (input: {
    readonly providerId: string;
    readonly locator: string;
  }) => AuditReadSecretSource;
}

function isAuditSecretSourceModule(value: unknown): value is AuditSecretSourceModule {
  if (typeof value !== 'object' || value === null) return false;
  return (
    typeof (value as { createAuditReadSecretSource?: unknown }).createAuditReadSecretSource ===
    'function'
  );
}

/**
 * Compose this reader from its launch environment. NO REQUEST HAS BEEN READ AT THIS POINT.
 *
 * Exported so the focused suite can compose a reader in-process and assert the refusals
 * without forking — the fork is proved separately, by PID, and the two properties are
 * independent.
 */
export async function composeAuditReader(): Promise<{
  readonly configuration: AuditReaderConfiguration;
  readonly readerIdentity: string;
}> {
  if (readEnv(ENV_AUDIT_PROTOCOL_VERSION) !== AUDIT_READ_PROTOCOL_VERSION) {
    throw new AuditReaderStartupError('ENV_PROTOCOL_MISMATCH');
  }
  const providerId = readEnv(ENV_AUDIT_PROVIDER_ID);
  const readerIdentity = readEnv(ENV_AUDIT_READER_IDENTITY);
  if (providerIdOfAuditReaderIdentity(readerIdentity) !== providerId) {
    throw new AuditReaderStartupError('ENV_IDENTITY_MISMATCH');
  }
  // Recomputed rather than trusted: the identity in the environment must be the identity
  // this repository's own producer would mint for this provider id, and not merely one that
  // parses back to it.
  if (auditProviderReaderIdentity(providerId) !== readerIdentity) {
    throw new AuditReaderStartupError('ENV_IDENTITY_MISMATCH');
  }

  // ---------------------------------------------------------------------------------
  // `§13` — THE CREDENTIAL MUST BE READ-ONLY, AND THE CHECK IS BEFORE ANY MODULE LOADS.
  //
  // The value is the parent's ECHO of the SIGNED class-5 record (`50 §2g` field 6); the
  // parent read the verified bundle and refused to fork a reader whose record said anything
  // else. This check runs here anyway, first, because a reader that has already imported a
  // provider module and resolved a locator is a reader that has done work on behalf of a
  // credential nobody established was safe.
  //
  // IT CANNOT WIDEN. The only value that admits a start is `READ_ONLY`, so an echo that
  // disagreed with the bundle in the permissive direction would need the PARENT to have
  // produced it — and the parent's own check already refused that case.
  // ---------------------------------------------------------------------------------
  const credentialRiskClass = readEnv(ENV_AUDIT_CREDENTIAL_RISK_CLASS);
  if (credentialRiskClass !== REQUIRED_AUDIT_CREDENTIAL_RISK_CLASS) {
    throw new AuditReaderStartupError('CREDENTIAL_NOT_READ_ONLY');
  }

  const runtimeRoot = readEnv(ENV_AUDIT_RUNTIME_ROOT);
  const readerModule = readEnv(ENV_AUDIT_READER_MODULE);
  const secretSourceModule = readEnv(ENV_AUDIT_SECRET_SOURCE_MODULE);
  const secretLocator = readEnv(ENV_AUDIT_SECRET_LOCATOR);
  /*
   * `50 §2g` FIELD 1's ECHO. ABSENT REFUSES TO START.
   *
   * `readEnv` refuses an absent or empty value, so there is no launch path that produces a
   * reader with nothing to compare its resolved credential against. The comparison itself is
   * guard 7 in `auditReadHost.ts`, because the material is resolved per read.
   */
  const expectedCredentialId = readEnv(ENV_AUDIT_EXPECTED_CREDENTIAL_ID);

  for (const specifier of [readerModule, secretSourceModule]) {
    if (!isInsideAuditRuntimeRoot(runtimeRoot, specifier)) {
      throw new AuditReaderStartupError('MODULE_OUTSIDE_RUNTIME_ROOT');
    }
  }

  /*
   * THE ONLY DYNAMIC IMPORT IN THIS PACKAGE, AND IT IS DELIBERATE.
   *
   * `§27` forbids a real provider call and there is none: what this process loads is
   * whatever its TRUSTED LAUNCH CONFIGURATION declared, confined to its own runtime root —
   * in S1O a synthetic reader under `tests/audit-plane/`, and in a later slice a real
   * provider-read package.
   *
   * A STATIC IMPORT COULD NOT DO THIS JOB. Each reader runtime must load ITS OWN provider
   * client and no other; a static import list here would put every provider's module into
   * every reader's module graph, which is the per-credential dependency isolation `23 §7`
   * and `29 §3.5` require.
   */
  const loadedReader: unknown = await import(pathToFileURL(resolve(readerModule)).href);
  if (!isAuditProviderReaderModule(loadedReader)) {
    // This is also where a reader carrying a SEND member is refused, because
    // `isAuditProviderReaderModule` delegates to `isAuditProviderReader`, which refuses one.
    throw new AuditReaderStartupError('READER_MODULE_INVALID');
  }
  const reader = loadedReader.auditProviderReader;
  if (reader.providerId !== providerId) {
    throw new AuditReaderStartupError('PROVIDER_IDENTITY_MISMATCH');
  }

  const loadedSource: unknown = await import(pathToFileURL(resolve(secretSourceModule)).href);
  if (!isAuditSecretSourceModule(loadedSource)) {
    throw new AuditReaderStartupError('SECRET_SOURCE_MODULE_INVALID');
  }
  const secretSource = loadedSource.createAuditReadSecretSource({
    providerId,
    locator: secretLocator,
  });
  if (secretSource.declaredProviderId !== providerId) {
    throw new AuditReaderStartupError('PROVIDER_IDENTITY_MISMATCH');
  }

  return {
    configuration: Object.freeze({
      providerId,
      reader,
      secretSource,
      credentialRiskClass,
      expectedCredentialId,
    }),
    readerIdentity,
  };
}

/**
 * The process's message loop. ONE inbound channel, ONE reply per request, NO queue of its own.
 *
 * What this side guarantees is that it reads one message, answers it, and holds nothing:
 * there is no buffer, no retry, no pending map and no record of the last request, so a
 * restarted reader has nothing to replay even if something asked it to. A read is
 * idempotent at the provider by construction — it is a query — but a reader that
 * remembered its last query would be a reader whose restart could re-issue a read against a
 * credential that had since been revoked.
 */
async function run(): Promise<void> {
  const { configuration, readerIdentity } = await composeAuditReader();

  emitAuditReadLog({
    event: 'READER_STARTED',
    readerIdentity,
    providerId: configuration.providerId,
    readId: null,
    operation: null,
    periodStartMs: null,
    periodEndMs: null,
    correlationTag: null,
    recordCount: null,
    resultClass: null,
  });

  process.on('message', (raw: unknown) => {
    void (async (): Promise<void> => {
      const reply = await handleProviderReadRequest(configuration, raw);
      emitAuditReadLog({
        event: reply.kind === 'PROVIDER_READ_REFUSED' ? 'READ_REQUEST_REFUSED' : 'READ_COMPLETED',
        readerIdentity,
        providerId: configuration.providerId,
        readId: reply.readId.length > 0 ? reply.readId : null,
        operation: reply.kind === 'PROVIDER_READ_RESPONSE' ? reply.operation : null,
        periodStartMs: null,
        periodEndMs: null,
        // A REFUSED read has no established correlation tag to record, and recording an
        // unvalidated one beside a provider identity is how a log becomes a false trail.
        correlationTag: null,
        recordCount: reply.kind === 'PROVIDER_READ_RESPONSE' ? reply.recordCount : null,
        resultClass: reply.kind === 'PROVIDER_READ_REFUSED' ? reply.reason : 'EVIDENCE',
      });
      const encoded = encodeAuditReadMessage(reply);
      // A reply that does not encode within the bound is DROPPED rather than truncated. The
      // parent's deadline resolves it as unavailable, which is the honest answer: the read
      // ran and the audit plane did not learn what the provider said.
      if (encoded !== null) process.send?.(encoded);
    })();
  });

  const ready: AuditReaderReady = {
    protocolVersion: AUDIT_READ_PROTOCOL_VERSION,
    kind: AUDIT_READER_READY_KIND,
    readerIdentity,
    providerId: configuration.providerId,
    pid: process.pid,
    /*
     * `§17` — THE KEYS OF THIS PROCESS'S OWN ENVIRONMENT. KEYS ONLY.
     *
     * `Object.keys`, never `process.env` itself: a value has no route onto this message,
     * because the member's type is `readonly string[]` and the parent's decoder refuses any
     * element that is not a bare environment-variable identifier.
     *
     * It is the CHILD that reports this rather than the parent asserting what it passed,
     * because what the parent passed is the thing under test and is therefore not evidence
     * about itself. This is the message that proves the audit reader holds neither the
     * integration plane's secret nor the audit database's credential.
     */
    environmentKeys: Object.keys(process.env).sort(),
    declaredCredentialRiskClass: configuration.credentialRiskClass,
  };
  const encodedReady = encodeAuditReadMessage(ready);
  if (encodedReady !== null) process.send?.(encodedReady);
}

/*
 * =================================================================================
 * THE MODULE IS BOTH A LIBRARY AND AN EXECUTABLE, AND THE DISCRIMINATOR IS THE LAUNCH
 * CONTRACT RATHER THAN `process.send`.
 *
 * `process.send` is defined in ANY forked child — including a Vitest worker — so gating on
 * it alone would start an audit reader inside the test runner the moment a test imported
 * this module for one of its exported functions, and that reader would then fail its own
 * environment check and call `process.exit`. `integration/runtime/main.ts` found exactly
 * that, and the same gate is applied here against THIS plane's own identity variable.
 * =================================================================================
 */
if (process.send !== undefined && process.env[ENV_AUDIT_READER_IDENTITY] !== undefined) {
  void run().catch((error: unknown) => {
    const failure =
      error instanceof AuditReaderStartupError ? error.failure : 'READER_MODULE_INVALID';
    process.stderr.write(`${JSON.stringify({ event: 'READER_START_FAILED', failure })}\n`);
    process.exit(1);
  });
}
