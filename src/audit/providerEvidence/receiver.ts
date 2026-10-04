import type { SignedProviderPushChannel } from './class28.js';
import { normaliseAuthenticatedBatch } from './eventPayload.js';
import type { BatchPersister, EvidenceChannelContext } from './evidenceStore.js';
import { requestTargetMatches } from './ingressIdentity.js';
import {
  rawHeaderValues,
  verifySendGridEventWebhookV1,
  type RawHeaderList,
} from './sendgridEventWebhookV1.js';

/**
 * THE PROVIDER-EVIDENCE INGRESS — ONE REQUEST, IN ADR-027 DECISION 4's NORMATIVE ORDER.
 *
 * =================================================================================
 *   1  the request target equals the signed `ingress_identity`        (G1, G12)  — no body read
 *   2  POST only                                                       (G2)       — no body read
 *   3  exactly one `Content-Type`, and it is `application/json`        (G2)       — no body read
 *   4  the raw body, streamed, bounded                                 (G4)
 *   5  both signature headers, exactly once; P1 – P10                  (G5, G6)
 *   6  ONLY NOW is the body parsed
 *   7  validated against the closed accepted schema, and normalised
 *   8  durably persisted                                               (G11)
 *   9  ONLY AFTER COMMIT, a 2xx                                        (G11)
 * =================================================================================
 *
 * THIS HANDLER SUPPLIES OBSERVATIONS AND NEVER AUTHORITY. Its scope holds a persister and a
 * clock. There is no gateway, no outbox, no authorisation, no adapter, no provider client, no
 * credential source and no control-artifact writer anywhere it can reach — `48 §8`'s
 * "What the receiver MUST NOT hold" is a property of this module's import closure, which
 * `tools/integration-packaging/` computes and the suite asserts.
 *
 * THE RESPONSE IS A STATUS CODE AND NOTHING ELSE (G9). No evidence, no signature data, no key
 * material, no correlation and no provider identifier ever leaves in a response body, and a
 * refusal names no reason: the reason is a closed code in the audit plane's own log.
 */

/**
 * THE RAW-BODY RESOURCE LIMIT. `48 §8` G4 requires "a declared raw-body size limit, enforced
 * before the body is buffered", and v1.3.8 declares no figure.
 *
 * **AN IMPLEMENTATION-ONLY AVAILABILITY LIMIT, NOT SIGNED AUTHORITY.** 1 MiB: four times the
 * repository's existing 256 KiB IPC message bound, so it sits in the same order as every other
 * bounded input here while leaving room for the provider's batched POSTs. Exceeding it produces
 * no evidence and a non-2xx; it can only refuse, and it decides nothing about any message.
 */
export const MAX_PROVIDER_EVIDENCE_BODY_BYTES = 1_048_576;

/** An inbound request, as the HTTP boundary hands it over. Nothing here is parsed. */
export interface IngressRequest {
  readonly method: string | undefined;
  /** The request-target exactly as received (origin-form expected). */
  readonly requestTarget: string | undefined;
  /** `[name, value, name, value, …]` exactly as received. Never a merged header map. */
  readonly rawHeaders: RawHeaderList;
  /** Stream the body as raw octets, stopping as soon as `limit` is exceeded. */
  readBody(
    limit: number,
  ): Promise<
    | { readonly kind: 'BODY'; readonly bytes: Buffer }
    | { readonly kind: 'TOO_LARGE' }
    | { readonly kind: 'FAILED' }
  >;
}

/** The closed set of things the ingress logs. A code is the whole diagnostic. */
export const INGRESS_LOG_EVENTS = [
  'INGRESS_REFUSED_TARGET',
  'INGRESS_REFUSED_METHOD',
  'INGRESS_REFUSED_CONTENT_TYPE',
  'INGRESS_REFUSED_BODY_TOO_LARGE',
  'INGRESS_REFUSED_BODY_UNREADABLE',
  'INGRESS_REFUSED_UNAUTHENTICATED',
  'INGRESS_PERSIST_FAILED',
  'INGRESS_EVIDENCE_RECORDED',
  'INGRESS_INCOMPLETE_OBSERVATION_RECORDED',
] as const;

export type IngressLogEvent = (typeof INGRESS_LOG_EVENTS)[number];

/**
 * ONE LOG RECORD. Every member is an identity, a closed code, a count or a hash.
 *
 * Never: the raw body, a recipient, a sender, a subject, an API key, the verification key, the
 * signature header, arbitrary provider JSON — and never an UNVERIFIED event identity, because a
 * value from an unauthenticated request is an attacker's string, not a provider identifier.
 */
export interface IngressLogRecord {
  readonly event: IngressLogEvent;
  readonly provider: string;
  readonly keyIdentity: string;
  readonly trustArtifactVersion: string;
  /** A closed refusal or reason code. */
  readonly resultClass: string | null;
  /** Only after the signature verified. */
  readonly rawBodySha256: string | null;
  readonly observationId: string | null;
  readonly inserted: number | null;
  readonly confirmedExisting: number | null;
}

export interface ProviderEvidenceIngressContext {
  readonly channel: SignedProviderPushChannel;
  /** The class-28 content hash the audit plane computed itself. */
  readonly trustArtifactDigest: string;
  readonly trustArtifactVersion: string;
  readonly persist: BatchPersister;
  readonly now: () => Date;
  readonly log: (record: IngressLogRecord) => void;
}

function mediaTypeIsJson(values: readonly string[]): boolean {
  if (values.length !== 1) return false;
  const parts = values[0]!.split(';').map((part) => part.trim().toLowerCase());
  if (parts[0] !== 'application/json') return false;
  // A charset parameter is admitted only as UTF-8; any other parameter is refused.
  return parts.slice(1).every((parameter) => parameter === 'charset=utf-8');
}

function declaredLengthExceeds(values: readonly string[], limit: number): boolean {
  if (values.length === 0) return false;
  if (values.length > 1) return true;
  const text = values[0]!;
  if (!/^[0-9]{1,16}$/.test(text)) return true;
  return Number(text) > limit;
}

/**
 * Handle ONE request. Returns the status code; the HTTP boundary writes it with no body.
 */
export async function handleProviderEvidenceRequest(
  context: ProviderEvidenceIngressContext,
  request: IngressRequest,
): Promise<number> {
  const channel = context.channel;
  const base = {
    provider: channel.provider,
    keyIdentity: channel.keyIdentity,
    trustArtifactVersion: context.trustArtifactVersion,
  };
  const refused = (event: IngressLogEvent, resultClass: string | null, status: number): number => {
    context.log({
      ...base,
      event,
      resultClass,
      rawBodySha256: null,
      observationId: null,
      inserted: null,
      confirmedExisting: null,
    });
    return status;
  };

  // 1 — THE SIGNED INGRESS IDENTITY, BEFORE THE BODY. Only `Host` is read; no forwarded header.
  if (
    request.requestTarget === undefined ||
    !requestTargetMatches(channel.ingressIdentity, {
      hostValues: rawHeaderValues(request.rawHeaders, 'host'),
      requestTarget: request.requestTarget,
    })
  ) {
    return refused('INGRESS_REFUSED_TARGET', null, 404);
  }

  // 2 — POST only.
  if (request.method !== 'POST') return refused('INGRESS_REFUSED_METHOD', null, 405);

  // 3 — the content type, exactly once.
  if (!mediaTypeIsJson(rawHeaderValues(request.rawHeaders, 'content-type'))) {
    return refused('INGRESS_REFUSED_CONTENT_TYPE', null, 415);
  }

  // 4 — the bound, first from a declared length and then while streaming.
  if (
    declaredLengthExceeds(
      rawHeaderValues(request.rawHeaders, 'content-length'),
      MAX_PROVIDER_EVIDENCE_BODY_BYTES,
    )
  ) {
    return refused('INGRESS_REFUSED_BODY_TOO_LARGE', null, 413);
  }
  const body = await request.readBody(MAX_PROVIDER_EVIDENCE_BODY_BYTES);
  if (body.kind === 'TOO_LARGE') return refused('INGRESS_REFUSED_BODY_TOO_LARGE', null, 413);
  if (body.kind === 'FAILED') return refused('INGRESS_REFUSED_BODY_UNREADABLE', null, 400);

  // 5 — THE TRUST BOUNDARY. Exact headers, exact raw octets, the closed profile.
  const verification = verifySendGridEventWebhookV1({
    rawHeaders: request.rawHeaders,
    rawBody: body.bytes,
    verificationKey: channel.verificationKey,
  });
  if (!verification.verified) {
    return refused('INGRESS_REFUSED_UNAUTHENTICATED', verification.refusal, 401);
  }

  // 6, 7 — ONLY NOW is the body parsed, and it is reduced to the named operands.
  const batch = normaliseAuthenticatedBatch(body.bytes, channel.acceptedEventClasses);

  // 8 — durably persisted. A throw is a non-2xx, so the provider's own retry redelivers.
  const evidenceChannel: EvidenceChannelContext = {
    provider: channel.provider,
    trustArtifactDigest: context.trustArtifactDigest,
    trustArtifactVersion: context.trustArtifactVersion,
    keyIdentity: channel.keyIdentity,
    verificationProfile: channel.verificationProfile,
  };
  let outcome;
  try {
    outcome = await context.persist(
      evidenceChannel,
      {
        timestampText: verification.request.timestampText,
        rawBodySha256: verification.request.rawBodySha256,
        receivedAt: context.now(),
      },
      batch,
    );
  } catch {
    context.log({
      ...base,
      event: 'INGRESS_PERSIST_FAILED',
      resultClass: null,
      rawBodySha256: verification.request.rawBodySha256,
      observationId: null,
      inserted: null,
      confirmedExisting: null,
    });
    return 503;
  }

  // 9 — ONLY AFTER COMMIT.
  if (outcome.kind === 'COMPLETE_RECORDED') {
    context.log({
      ...base,
      event: 'INGRESS_EVIDENCE_RECORDED',
      resultClass: 'COMPLETE',
      rawBodySha256: verification.request.rawBodySha256,
      observationId: outcome.observationId,
      inserted: outcome.inserted,
      confirmedExisting: outcome.confirmedExisting,
    });
  } else {
    context.log({
      ...base,
      event: 'INGRESS_INCOMPLETE_OBSERVATION_RECORDED',
      resultClass: outcome.reason,
      rawBodySha256: verification.request.rawBodySha256,
      observationId: outcome.observationId,
      inserted: null,
      confirmedExisting: null,
    });
  }
  return 204;
}

/** The default log sink: one JSON line per record on `stderr`. Members are closed by type. */
export function emitIngressLog(record: IngressLogRecord): void {
  process.stderr.write(
    `${JSON.stringify({
      event: record.event,
      provider: record.provider,
      keyIdentity: record.keyIdentity,
      trustArtifactVersion: record.trustArtifactVersion,
      resultClass: record.resultClass,
      rawBodySha256: record.rawBodySha256,
      observationId: record.observationId,
      inserted: record.inserted,
      confirmedExisting: record.confirmedExisting,
    })}\n`,
  );
}
