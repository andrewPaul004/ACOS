// PERIMETER_INGRESS(provider_evidence, class_28)
import { createServer, type IncomingMessage, type Server } from 'node:http';

import { verifyAuditPlaneControlArtifacts } from '../controlArtifacts/auditPlaneVerifier.js';
import { createAuditEvidenceIngressPool } from '../db/auditPool.js';
import type { Pool } from '../../db/pool.js';
import type { SignedProviderPushChannel } from './class28.js';
import { poolPersister, type BatchPersister } from './evidenceStore.js';
import { launchEchoMatches } from './ingressIdentity.js';
import {
  emitIngressLog,
  handleProviderEvidenceRequest,
  type IngressLogRecord,
  type IngressRequest,
} from './receiver.js';

/**
 * THE PROVIDER-EVIDENCE INGRESS — `48 §8` ROW I1, AN INDEPENDENTLY RUNNABLE AUDIT-PLANE PROCESS.
 *
 * =================================================================================
 * `PERIMETER_INGRESS(provider_evidence, class_28)`
 *
 * `48 §8`: "The ingress carries its own [annotation]: **`PERIMETER_INGRESS(channel,
 * trust_class)`** — naming the declared channel and the control-artifact class that holds its
 * trust root. For I1 that is the provider-evidence channel and class 28." The annotation at the
 * top of this file is that declaration, and `tools/perimeter/` reads it: the `node:http`
 * import below is an INBOUND listener, not an outbound call, and neither
 * `PERIMETER_AUTHORISED` nor `PERIMETER_EXEMPT` may be reused for it.
 *
 * =================================================================================
 * WHAT THIS PROCESS HOLDS — AND, BY CONSTRUCTION, WHAT IT DOES NOT
 *
 * May hold (`48 §8`): the class-28 trust record, verified by THIS plane's own verifier; write
 * access to the audit-side provider-evidence store, under its own role; its own process identity
 * and deployment configuration, including the non-authoritative ingress launch echo.
 *
 * Must not hold: no provider SEND credential, no provider READ credential, no integration-plane
 * secret locator or managed identity, no vendor mutation capability, no ability to create,
 * authorise, enqueue, dispatch or re-dispatch an effect, and no ability to modify a control
 * artifact, a policy, a grant or a deployment pin. Its import closure is computed by
 * `tools/integration-packaging/` as `AUDIT_PROVIDER_EVIDENCE_INGRESS`, and every one of those
 * is a separation obligation that fails the gate.
 *
 * NO SENDGRID CREDENTIAL AND NO AZURE AUDIT KEY VAULT SECRET is read here, because none is
 * needed: the trust root is a PUBLIC key in a signed artifact.
 *
 * =================================================================================
 * READY MEANS: VERIFIED, BOUND, LISTENING
 *
 *   1  the audit plane verifies its OWN control-artifact package (`50 §3` property 2);
 *   2  the selected provider's class-28 record exists and is `SIGNED_PROVIDER_PUSH`;
 *   3  the launch echo equals the signed `ingress_identity` EXACTLY (`50 §2h` comparison 1);
 *   4  the listener is bound.
 *
 * Any failure: the process never listens and never becomes READY. The provider selector and the
 * launch echo are deployment configuration and are NOT authority — the selector only names which
 * SIGNED record to serve, and the echo can only refuse.
 *
 * ONE ROUTE (G1). There is no health route, no second path and no handler table: a readiness
 * probe is this process's own startup result, not a second endpoint on the public listener.
 * =================================================================================
 */

/** Deployment configuration keys. None of them is authority. */
export const INGRESS_ENVIRONMENT = Object.freeze({
  /** Which SIGNED class-28 record to serve. A selector; it can select nothing unsigned. */
  provider: 'ACOS_PROVIDER_EVIDENCE_PROVIDER',
  /** The URL this deployment was configured to serve. Compared; never used as a value. */
  launchEcho: 'ACOS_PROVIDER_EVIDENCE_INGRESS_ECHO',
  /** The local listener behind the declared TLS-terminating front end. */
  listenHost: 'ACOS_PROVIDER_EVIDENCE_LISTEN_HOST',
  listenPort: 'ACOS_PROVIDER_EVIDENCE_LISTEN_PORT',
});

export const INGRESS_STARTUP_REFUSALS = [
  'AUDIT_CONTROL_ARTIFACTS_NOT_VERIFIED',
  'PROVIDER_NOT_CONFIGURED',
  'CHANNEL_NOT_DECLARED',
  'CHANNEL_NOT_SIGNED_PROVIDER_PUSH',
  'LAUNCH_ECHO_MISMATCH',
  'LISTEN_ADDRESS_INVALID',
] as const;

export type IngressStartupRefusal = (typeof INGRESS_STARTUP_REFUSALS)[number];

export interface StartedProviderEvidenceIngress {
  readonly ready: true;
  readonly server: Server;
  readonly port: number;
  readonly channel: SignedProviderPushChannel;
  close(): Promise<void>;
}

export type IngressStartup =
  | StartedProviderEvidenceIngress
  | { readonly ready: false; readonly refusal: IngressStartupRefusal; readonly detail: string };

export interface IngressStartOptions {
  readonly environment: Readonly<Record<string, string | undefined>>;
  /** The store port. Defaults to the ingress role's own pool over `ACOS_AUDIT_PG_URL`. */
  readonly persist?: BatchPersister;
  readonly log?: (record: IngressLogRecord) => void;
  readonly now?: () => Date;
}

function streamBody(message: IncomingMessage): IngressRequest['readBody'] {
  return (limit) =>
    new Promise((resolveBody) => {
      const chunks: Buffer[] = [];
      let total = 0;
      let settled = false;
      const settle = (
        value:
          | { readonly kind: 'BODY'; readonly bytes: Buffer }
          | { readonly kind: 'TOO_LARGE' }
          | { readonly kind: 'FAILED' },
      ): void => {
        if (settled) return;
        settled = true;
        resolveBody(value);
      };
      message.on('data', (chunk: Buffer) => {
        if (settled) return;
        total += chunk.length;
        if (total > limit) {
          // STOP BUFFERING. The excess is never held, and the request produces no evidence.
          settle({ kind: 'TOO_LARGE' });
          message.pause();
          return;
        }
        chunks.push(chunk);
      });
      message.on('end', () => settle({ kind: 'BODY', bytes: Buffer.concat(chunks, total) }));
      message.on('error', () => settle({ kind: 'FAILED' }));
      message.on('aborted', () => settle({ kind: 'FAILED' }));
    });
}

/**
 * Start the ingress, or refuse to. The ONLY construction site for the listener.
 */
export async function startProviderEvidenceIngress(
  options: IngressStartOptions,
): Promise<IngressStartup> {
  const env = options.environment;
  const refuse = (refusal: IngressStartupRefusal, detail: string): IngressStartup => ({
    ready: false,
    refusal,
    detail,
  });

  // 1 — THIS PLANE'S OWN VERIFICATION. No control-plane verdict is read or accepted.
  const verification = verifyAuditPlaneControlArtifacts(env);
  if (!verification.verified) {
    return refuse('AUDIT_CONTROL_ARTIFACTS_NOT_VERIFIED', verification.reason);
  }

  // 2 — the SIGNED record for the selected provider, and it must be a push record.
  const provider = env[INGRESS_ENVIRONMENT.provider];
  if (provider === undefined || provider.length === 0) {
    return refuse('PROVIDER_NOT_CONFIGURED', 'no provider evidence channel was selected');
  }
  const channel = verification.providerEvidenceTrust.channels[provider];
  if (channel === undefined) {
    return refuse('CHANNEL_NOT_DECLARED', 'the verified class-28 record declares no such channel');
  }
  if (channel.evidenceMode !== 'SIGNED_PROVIDER_PUSH') {
    return refuse(
      'CHANNEL_NOT_SIGNED_PROVIDER_PUSH',
      'the selected provider is not in SIGNED_PROVIDER_PUSH mode; no ingress may serve it',
    );
  }

  // 3 — THE STARTUP BINDING. The echo can only refuse.
  if (!launchEchoMatches(channel.ingressIdentity, env[INGRESS_ENVIRONMENT.launchEcho])) {
    return refuse(
      'LAUNCH_ECHO_MISMATCH',
      'the deployment launch echo is not exactly the signed class-28 ingress_identity',
    );
  }

  const host = env[INGRESS_ENVIRONMENT.listenHost] ?? '127.0.0.1';
  const portText = env[INGRESS_ENVIRONMENT.listenPort] ?? '0';
  if (!/^[0-9]{1,5}$/.test(portText) || Number(portText) > 65_535) {
    return refuse('LISTEN_ADDRESS_INVALID', 'the listen port is not a port number');
  }

  let pool: Pool | null = null;
  let persist = options.persist;
  if (persist === undefined) {
    pool = createAuditEvidenceIngressPool();
    persist = poolPersister(pool);
  }

  const context = {
    channel,
    trustArtifactDigest: verification.providerEvidenceTrustDigest,
    trustArtifactVersion: verification.providerEvidenceTrust.artifactVersion,
    persist,
    now: options.now ?? ((): Date => new Date()),
    log: options.log ?? emitIngressLog,
  };

  const server = createServer((message, response) => {
    const request: IngressRequest = {
      method: message.method,
      requestTarget: message.url,
      rawHeaders: message.rawHeaders,
      readBody: streamBody(message),
    };
    void handleProviderEvidenceRequest(context, request)
      .catch(() => 500)
      .then((status) => {
        // A STATUS CODE AND NOTHING ELSE (G9). The connection is not reused after a request,
        // so an unread refused body cannot be mistaken for a next request.
        response.writeHead(status, { 'content-length': '0', connection: 'close' });
        response.end();
      });
  });

  await new Promise<void>((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen(Number(portText), host, () => resolveListen());
  });
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : Number(portText);

  return Object.freeze({
    ready: true as const,
    server,
    port,
    channel,
    close: async (): Promise<void> => {
      await new Promise<void>((resolveClose) => {
        server.close(() => resolveClose());
        server.closeAllConnections();
      });
      if (pool !== null) await pool.end();
    },
  });
}

async function main(): Promise<void> {
  const started = await startProviderEvidenceIngress({ environment: process.env });
  if (!started.ready) {
    // A closed code on stderr, never a stack and never configuration content.
    process.stderr.write(`${JSON.stringify({ event: 'INGRESS_NOT_READY', refusal: started.refusal })}\n`);
    process.exit(1);
  }
  process.stderr.write(
    `${JSON.stringify({
      event: 'INGRESS_READY',
      provider: started.channel.provider,
      keyIdentity: started.channel.keyIdentity,
    })}\n`,
  );
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))) {
  void main();
}
