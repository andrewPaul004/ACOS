import { createHash } from 'node:crypto';

import type { Recoverability } from '../../kernel/canonicalisation/actionClasses.js';
import { isWellFormedAdapterId } from './runtimeIdentity.js';

/**
 * THE ACOS INTEGRATION PERIMETER PROTOCOL. A CLOSED SCHEMA, AND NOT AN RPC BUS.
 *
 * =================================================================================
 * `§14` OF THE MANDATE: "Do not build a general RPC bus. This protocol exists only for the
 * ACOS integration perimeter."
 *
 * So there are exactly two message kinds in each direction, the field set of each is a
 * hand-authored closed list, and there is no envelope, no method name resolved at runtime,
 * no callback address, no URL and no extension point. An unknown field is a REFUSAL rather
 * than an ignored key, because a protocol that ignores what it does not understand is a
 * protocol whose next version is an injection surface.
 * =================================================================================
 *
 * =================================================================================
 * WHAT IS DELIBERATELY ABSENT FROM THE REQUEST — `§13`, `§8`, `§24`
 *
 * NO VENDOR SECRET, AND NOWHERE TO PUT ONE. `§8`: "No production secret value is supplied
 * through: effect payload; dispatch envelope; RPC message; authorisation; worker request;
 * model output." There is no `token`, no `apiKey`, no `authorization` and no `headers`
 * member on `DispatchRequest`, and the boundary suite asserts the field list against a
 * hand-authored copy so a future member has to be added in two places by someone who read
 * this paragraph.
 *
 * NO ECONOMIC AUTHORITY FIELD. `26 §1` Corollary 3: "the request must be built by the
 * ceiling's enforcer, not by its subject." `adapterPort.ts` already says this about the
 * envelope; crossing a process boundary does not re-open it. The monetary content of the
 * request, where the class has one, is inside the canonical payload bytes the canonicaliser
 * emitted and the authorisation hash-bound, and is not separately readable or writable here.
 *
 * NO REVOCATION OVERRIDE. `§24`: "This switch must not be model controlled. The control
 * plane may request no override." There is no `enabled`, no `force` and no `bypass` member,
 * so the control plane cannot express the request even if it wanted to.
 *
 * NO EXECUTABLE PATH, MODULE PATH, RUNTIME FLAG OR SECRET LOCATOR. `§37`. Those are launch
 * configuration (`adapterRuntimeRegistry.ts`), never message content.
 * =================================================================================
 */

/** The exact protocol version string. A mismatch REFUSES; it does not negotiate. */
export const INTEGRATION_PROTOCOL_VERSION = 'acos.integration.v1';

/**
 * `§14`'s "Bound message sizes", as one number for both directions.
 *
 * 256 KiB. It is a TRANSPORT bound and not a business limit — `§42`: "Use architecture
 * existing limits if present. Do not invent business-rate ceilings." The canonical dispatch
 * payload of every class in the S1 catalogue is three orders of magnitude below it, so the
 * bound is never load-bearing for a legitimate request and is exactly load-bearing for a
 * compromised caller trying to make the boundary allocate.
 */
export const MAX_IPC_MESSAGE_BYTES = 262_144;

export const DISPATCH_REQUEST_KIND = 'DISPATCH_REQUEST';
export const DISPATCH_RESPONSE_KIND = 'DISPATCH_RESPONSE';
export const REQUEST_REFUSED_KIND = 'REQUEST_REFUSED';
export const RUNTIME_READY_KIND = 'RUNTIME_READY';

/**
 * THE REQUEST'S CLOSED FIELD LIST. Twenty members, and the list is the schema.
 *
 * Every member is traceable to committed control state or to the closed catalogue:
 *
 *   protocolVersion       this module's constant. Never negotiated.
 *   kind                  the discriminant.
 *   invocationId          `§27` — TRANSPORT OBSERVABILITY ONLY. It is NOT an idempotency
 *                         key, NOT a provider correlation and NOT a claim. `§27`: "Do not
 *                         claim exactly-once because IPC has request IDs."
 *   adapterId / method    `26 §5`'s catalogue execution metadata, via the envelope.
 *   actionClass           the committed class.
 *   recoverability        catalogue-assigned (`26 §5`), on the wire so the runtime can
 *                         refuse work it is not eligible for — never so it can change it.
 *   authorisationRef      `I24`. The load-bearing member; see `computeRequestBindingDigest`.
 *   companyId / outboxId / claimId / effectId / idempotencyKey
 *                         the committed dispatch identity (`DispatchIdentity`).
 *   correlationTag        `25 §7`'s provider-visible tag, minted before the claim.
 *   resourceRef           the committed resource.
 *   requiresUnmirroredTag / overrideRef
 *                         `30 §5.7.2` item 5's requirement, crossing one more boundary.
 *   dispatchPayloadHash   the hash the authorisation committed.
 *   dispatchPayloadBase64 the persisted canonical bytes, verbatim.
 *   bindingDigest         `§16`. See `computeRequestBindingDigest`.
 */
export const DISPATCH_REQUEST_FIELDS = [
  'protocolVersion',
  'kind',
  'invocationId',
  'adapterId',
  'method',
  'actionClass',
  'recoverability',
  'authorisationRef',
  'companyId',
  'outboxId',
  'claimId',
  'effectId',
  'idempotencyKey',
  'correlationTag',
  'resourceRef',
  'requiresUnmirroredTag',
  'overrideRef',
  'dispatchPayloadHash',
  'dispatchPayloadBase64',
  'bindingDigest',
] as const;

export type DispatchRequestField = (typeof DISPATCH_REQUEST_FIELDS)[number];

export interface DispatchRequest {
  readonly protocolVersion: typeof INTEGRATION_PROTOCOL_VERSION;
  readonly kind: typeof DISPATCH_REQUEST_KIND;
  readonly invocationId: string;
  readonly adapterId: string;
  readonly method: string;
  readonly actionClass: string;
  readonly recoverability: Recoverability;
  readonly authorisationRef: string;
  readonly companyId: string;
  readonly outboxId: string;
  readonly claimId: string;
  readonly effectId: string;
  readonly idempotencyKey: string;
  readonly correlationTag: string;
  readonly resourceRef: string;
  readonly requiresUnmirroredTag: boolean;
  readonly overrideRef: string | null;
  readonly dispatchPayloadHash: string;
  readonly dispatchPayloadBase64: string;
  readonly bindingDigest: string;
}

/**
 * `§22`'s CLOSED OUTCOME TAXONOMY, ON THE WIRE — the SAME four members `adapterPort.ts`
 * declares, and not a superset.
 *
 * `§22`: "Integration process returns only the trusted closed adapter result taxonomy
 * already accepted [...] No arbitrary provider exception crosses back into kernel state."
 * The wire shape is structurally identical to `AdapterOutcome` so the control side's
 * translation is a VALIDATION rather than a mapping: there is no wire member with no
 * `AdapterOutcome` counterpart, and none the other way.
 *
 * The one narrowing is `failureClass`, which `adapterPort.ts` types as a free `string` for
 * an IN-PROCESS adapter and which this wire closes to two members. A free string crossing a
 * process boundary is exactly `§23`'s leak channel, and `ADAPTER_FAILED` has no local
 * outcome policy anyway (`25 §7.1`: "Retained for diagnostics only"), so nothing is lost by
 * closing it and one whole class of leak is closed by doing so.
 */
export const WIRE_FAILURE_CLASSES = [
  /** The adapter threw before its own provider-client boundary was crossed. */
  'ADAPTER_THREW_PRE_SEND',
  /** The adapter's provider-client boundary rejected, with no no-mutation guarantee. */
  'PROVIDER_CLIENT_REJECTED',
] as const;

export type WireFailureClass = (typeof WIRE_FAILURE_CLASSES)[number];

export type WireOutcome =
  | {
      readonly kind: 'ADAPTER_RETURNED';
      readonly providerReference: string | null;
      readonly rawResponseHash: string | null;
    }
  | { readonly kind: 'OUTCOME_UNKNOWN'; readonly reason: 'TIMEOUT' | 'AMBIGUOUS' }
  | {
      readonly kind: 'NOT_SENT_CONFIRMED';
      readonly basis: 'PRE_SEND_FAILURE' | 'PROVIDER_REJECTED_NO_MUTATION';
    }
  | { readonly kind: 'ADAPTER_FAILED'; readonly failureClass: WireFailureClass };

/**
 * `§23` — THE REFUSAL REASONS, AS A CLOSED ENUM AND NOT A MESSAGE.
 *
 * =================================================================================
 * WHY THERE IS NO `detail` STRING ON A REFUSAL
 *
 * `§23`: "IPC errors visible to control plane must not contain: credential; provider auth
 * header; secret source path; entire integration environment; stack containing secret; raw
 * provider payload."
 *
 * A free-text detail is the channel every one of those leaks through, and redacting one is
 * a denylist. So a refusal carries a member of this enum and NOTHING ELSE — there is
 * nowhere on the wire to put a path, a stack, an environment or a vendor body, which is the
 * same discipline `25 §7.2` applies to `NotSentBasis` and `30 §5.7` to string-classified
 * causes. The negative-control suite's leaky host is the discriminating
 * control: it adds the detail string and the sentinel secret arrives in the control plane.
 *
 * EVERY MEMBER IS RAISED STRICTLY BEFORE THE ADAPTER'S PROVIDER-CLIENT BOUNDARY, which is
 * what lets `integrationClient.ts` map a refusal to `NOT_SENT_CONFIRMED / PRE_SEND_FAILURE`
 * without inventing a guarantee. The host's guard ORDER is what makes that true, and the
 * focused suite asserts the order rather than assuming it.
 * =================================================================================
 */
export const REFUSAL_REASONS = [
  'PROTOCOL_VERSION_MISMATCH',
  'MESSAGE_NOT_AN_OBJECT',
  'MESSAGE_TOO_LARGE',
  'UNKNOWN_FIELD',
  'MISSING_FIELD',
  'FIELD_MALFORMED',
  'DUPLICATE_SEMANTIC_FIELD',
  'PROTOTYPE_POLLUTION_SHAPE',
  'ADAPTER_IDENTITY_MISMATCH',
  /** `I24`, at the runtime. The invocation carried no resolvable authorisation reference. */
  'AUTHORISATION_REF_MISSING',
  /** `§16`. The reference is present and is not bound to the effect being dispatched. */
  'AUTHORISATION_BINDING_MISMATCH',
  /** The payload bytes do not hash to the hash the authorisation committed. */
  'PAYLOAD_HASH_MISMATCH',
  /** `§24`'s per-credential revocation switch, thrown at the integration runtime. */
  'CREDENTIAL_REVOKED',
  'CREDENTIAL_UNAVAILABLE',
  'ADAPTER_NOT_LOADED',
  /** `§42`'s availability bound, refused before anything is queued. */
  'CONCURRENCY_LIMIT_EXCEEDED',
] as const;

export type RefusalReason = (typeof REFUSAL_REASONS)[number];

export interface DispatchResponse {
  readonly protocolVersion: typeof INTEGRATION_PROTOCOL_VERSION;
  readonly kind: typeof DISPATCH_RESPONSE_KIND;
  readonly invocationId: string;
  readonly adapterId: string;
  readonly outcome: WireOutcome;
  /**
   * `§25` — A NON-SECRET CREDENTIAL IDENTITY, OR NULL.
   *
   * "The integration runtime may report a non-secret credential identity/version if
   * architecture needs audit evidence. Do not log secret fingerprint unless explicitly
   * architecture-approved."
   *
   * SO THIS IS A LABEL THE SECRET SOURCE DECLARES, NOT A DIGEST OF THE SECRET. A hash of a
   * credential is a credential oracle under a rotation schedule — it confirms a guess — and
   * v1.3.6 approves no fingerprint anywhere. `adapterSecretSource.ts` refuses a source whose
   * declared identity is derivable from its own secret material, which is the structural
   * form of that rule.
   */
  readonly credentialIdentity: string | null;
  readonly credentialVersion: string | null;
}

export interface RequestRefused {
  readonly protocolVersion: typeof INTEGRATION_PROTOCOL_VERSION;
  readonly kind: typeof REQUEST_REFUSED_KIND;
  /** `null` where the request did not parse far enough to carry one. */
  readonly invocationId: string | null;
  readonly reason: RefusalReason;
}

export interface RuntimeReady {
  readonly protocolVersion: typeof INTEGRATION_PROTOCOL_VERSION;
  readonly kind: typeof RUNTIME_READY_KIND;
  readonly runtimeIdentity: string;
  readonly adapterId: string;
  readonly pid: number;
  /**
   * `§30`, `48 §4` ITEM 4 — THE INJECTED ENVIRONMENT'S KEY SET. KEYS ONLY, NEVER VALUES.
   *
   * `48 §4` item 4: `I25` is "CI-checked on the dependency tree **and the injected
   * environment**". An assertion about the injected environment has to be made against the
   * environment the child ACTUALLY received, and only the child can report that — the
   * parent knows what it passed, which is exactly the thing under test and therefore not
   * evidence about it.
   *
   * SO THE CHILD REPORTS THE KEYS OF ITS OWN `process.env`, AND NOTHING ELSE. There is no
   * member of this message that can carry a VALUE, the decoder refuses a key that is not a
   * bare `[A-Z0-9_]+` identifier, and it refuses more than `MAX_REPORTED_ENV_KEYS` of them.
   * A key name is not a secret; `§43`'s prohibition is on "raw environment", which is the
   * values, and this message has nowhere to put one.
   */
  readonly environmentKeys: readonly string[];
}

/** A bound on the reported key set, so the message cannot become an allocation channel. */
export const MAX_REPORTED_ENV_KEYS = 256;

const ENV_KEY_GRAMMAR = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;

export type IntegrationMessage =
  | DispatchRequest
  | DispatchResponse
  | RequestRefused
  | RuntimeReady;

/* ================================================================================
 * §16 — THE AUTHORISATION BINDING DIGEST
 * ================================================================================ */

/** The binding's domain separator. `50 §3b`'s discipline: every digest names its purpose. */
const BINDING_DOMAIN = 'acos.integration.binding.v1';

/** The field separator. Not a character any identity in this repository may contain. */
const SEPARATOR = '\u0000';

/**
 * `§16` — BIND THE REQUEST TO THE EFFECT, NOT MERELY ASSERT THE REFERENCE IS PRESENT.
 *
 * =================================================================================
 * THE ATTACK, AND EXACTLY WHAT THIS CLOSES
 *
 * `§16`: "valid authorisation for effect A + dispatch envelope for effect B. Production
 * refuses."
 *
 * The preimage is the separator-joined concatenation of the domain separator and every
 * identity-bearing member of the request. `runtimeIdentity.ts`'s grammar and the
 * repository's identifier shapes admit no `U+0000`, and the decoder below refuses any field
 * containing one, so the encoding is INJECTIVE: two different field tuples cannot produce
 * one preimage, and a swapped `authorisationRef` or a swapped `effectId` changes the digest.
 *
 * SO A REQUEST ASSEMBLED FROM ONE EFFECT'S AUTHORISATION AND ANOTHER'S ENVELOPE DOES NOT
 * VERIFY, and the host refuses `AUTHORISATION_BINDING_MISMATCH` before any adapter code runs.
 *
 * =================================================================================
 * WHAT IT DOES NOT CLOSE, STATED PLAINLY
 *
 * The digest is computed from the same fields it protects and carries no secret, so a
 * COMPROMISED CONTROL PLANE that recomputed it would produce a self-consistent forgery.
 * That is not a gap this slice can close and it is not one this slice pretends to close:
 *
 *   - The control plane is Z1 and TRUSTED (`23 §7`). `48 §1`'s subject is a path that
 *     reaches a vendor WITHOUT an authorisation, not a Z1 compromise.
 *   - On the CONTROL side the binding is already structural and stronger than any digest:
 *     `0010`'s composite foreign key makes `authorisation_id` a member of a key into
 *     `effect`, and `buildDispatchEnvelope` reads it from the committed row. There is no
 *     parameter anywhere on the dispatch path that could carry a different one, which is
 *     the same "unrepresentable rather than refused" argument `adapterRegistry.ts` makes
 *     about adapter substitution.
 *   - INDEPENDENT authorisation verification at the point the credential is presented is
 *     precisely one of ADR-024's two named benefits of OPTION B — "action scoping becomes
 *     enforceable at the point the credential is presented" — and option B is deferred by
 *     the architecture until the first money-moving credential or the third adapter.
 *     `adapterRuntimeRegistry.ts` is where that trigger is kept from disappearing.
 *
 * What the digest closes is the TRANSIT and HAND-ASSEMBLY cases: a mutated message, a
 * replayed message with one field swapped, and a caller that obtained a legitimate
 * authorisation reference and tried to spend it on a different effect.
 * =================================================================================
 */
export function computeRequestBindingDigest(
  request: Omit<DispatchRequest, 'bindingDigest'>,
): string {
  const preimage = [
    BINDING_DOMAIN,
    request.protocolVersion,
    request.kind,
    request.adapterId,
    request.method,
    request.actionClass,
    request.recoverability,
    request.authorisationRef,
    request.companyId,
    request.outboxId,
    request.claimId,
    request.effectId,
    request.idempotencyKey,
    request.correlationTag,
    request.resourceRef,
    request.requiresUnmirroredTag ? 'true' : 'false',
    request.overrideRef ?? '',
    request.dispatchPayloadHash,
  ].join(SEPARATOR);
  return createHash('sha256').update(Buffer.from(preimage, 'utf8')).digest('hex');
}

/* ================================================================================
 * §14 — THE CLOSED DECODER
 * ================================================================================ */

export type DecodeResult<T> =
  | { readonly kind: 'DECODED'; readonly message: T }
  | { readonly kind: 'REFUSED'; readonly reason: RefusalReason };

const HEX64 = /^[0-9a-f]{64}$/;
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;
const RECOVERABILITY_VALUES: readonly string[] = ['REVERSIBLE', 'COMPENSABLE', 'IRRECOVERABLE'];

/**
 * `§14`'s "malformed UTF-8 if transport representation exposes it".
 *
 * A JavaScript string is UTF-16, so the representable malformation is a LONE SURROGATE — a
 * high surrogate with no low one after it, or a low one with no high one before it. Such a
 * string has no valid UTF-8 encoding: `Buffer.from` silently substitutes `U+FFFD`, so a
 * field carrying one means something different on the two sides of the boundary, and a
 * binding digest computed over it is a digest over the substitution rather than over what
 * the sender wrote.
 */
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

/** A bounded, non-empty, separator-free, surrogate-clean string. */
function isCleanString(value: unknown, maxLength: number): value is string {
  if (typeof value !== 'string') return false;
  if (value.length === 0 || value.length > maxLength) return false;
  if (value.includes(SEPARATOR)) return false;
  return !LONE_SURROGATE.test(value);
}

const PROTOTYPE_KEYS = ['__proto__', 'constructor', 'prototype'] as const;

/**
 * `§14`'s prototype-pollution check, applied to the RAW TEXT and not to the parsed object.
 *
 * =================================================================================
 * WHAT `JSON.parse` ACTUALLY DOES, AND WHY THE TEXT IS STILL THE RIGHT PLACE
 *
 * `JSON.parse` does NOT invoke the `__proto__` setter: it defines an OWN DATA PROPERTY of
 * that name, so the parsed object's prototype is untouched and the key survives. Nothing is
 * polluted yet — and that is precisely the hazard, because the object now carries a key that
 * a later spread, merge, `structuredClone` or `Object.assign` into a fresh object CAN turn
 * into a prototype write.
 *
 * TWO REASONS THE CHECK IS ON THE TEXT AND RUNS FIRST:
 *
 *   1. ATTRIBUTABILITY. The closed-field walk below would refuse the same message as
 *      `UNKNOWN_FIELD`, which is true and uninformative. A message carrying `__proto__` is
 *      a different event from a message carrying a typo, and the refusal says so.
 *   2. REACH. The field walk inspects the TOP LEVEL of a request. A reply's `outcome` is a
 *      nested object, and `decodeWireOutcome`'s exact-key comparison is what refuses one
 *      there. Checking the bytes covers every depth with one rule rather than relying on
 *      each nested decoder to have remembered.
 * =================================================================================
 */
function hasPrototypeShape(raw: string): boolean {
  for (const key of PROTOTYPE_KEYS) {
    if (raw.includes(`"${key}"`)) return true;
  }
  return false;
}

/**
 * `§14`'s DUPLICATE SEMANTIC FIELD check, also against the raw text.
 *
 * `JSON.parse` keeps the LAST of two identical keys and reports nothing, so a message
 * carrying `authorisationRef` twice parses to a well-formed request holding the second
 * value while a reviewer reading the bytes sees the first. That divergence is the whole
 * point of the rule: a message whose meaning depends on which end parsed it has no meaning.
 */
function occurrences(raw: string, key: string): number {
  return raw.split(`"${key}"`).length - 1;
}

/**
 * Decode and validate one inbound DISPATCH REQUEST. THE ONLY ENTRY TO THE INTEGRATION SIDE.
 *
 * Takes the RAW TEXT the transport delivered rather than a parsed object, because three of
 * `§14`'s required refusals — oversize, prototype shape and duplicate semantic field — are
 * properties of the bytes that parsing destroys.
 */
export function decodeDispatchRequest(raw: unknown): DecodeResult<DispatchRequest> {
  if (typeof raw !== 'string') return { kind: 'REFUSED', reason: 'MESSAGE_NOT_AN_OBJECT' };
  if (Buffer.byteLength(raw, 'utf8') > MAX_IPC_MESSAGE_BYTES) {
    return { kind: 'REFUSED', reason: 'MESSAGE_TOO_LARGE' };
  }
  if (LONE_SURROGATE.test(raw)) return { kind: 'REFUSED', reason: 'FIELD_MALFORMED' };
  if (hasPrototypeShape(raw)) return { kind: 'REFUSED', reason: 'PROTOTYPE_POLLUTION_SHAPE' };
  for (const field of DISPATCH_REQUEST_FIELDS) {
    if (occurrences(raw, field) > 1) {
      return { kind: 'REFUSED', reason: 'DUPLICATE_SEMANTIC_FIELD' };
    }
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { kind: 'REFUSED', reason: 'MESSAGE_NOT_AN_OBJECT' };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { kind: 'REFUSED', reason: 'MESSAGE_NOT_AN_OBJECT' };
  }
  const object = parsed as Record<string, unknown>;

  // UNKNOWN BEFORE MISSING, deliberately: a message carrying an extra field is refused as
  // what it is rather than being reported for whichever declared field it also omitted.
  const declared = new Set<string>(DISPATCH_REQUEST_FIELDS);
  for (const key of Object.keys(object)) {
    if (!declared.has(key)) return { kind: 'REFUSED', reason: 'UNKNOWN_FIELD' };
  }
  for (const field of DISPATCH_REQUEST_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(object, field)) {
      return { kind: 'REFUSED', reason: 'MISSING_FIELD' };
    }
  }

  if (object['protocolVersion'] !== INTEGRATION_PROTOCOL_VERSION) {
    return { kind: 'REFUSED', reason: 'PROTOCOL_VERSION_MISMATCH' };
  }
  if (object['kind'] !== DISPATCH_REQUEST_KIND) {
    return { kind: 'REFUSED', reason: 'FIELD_MALFORMED' };
  }
  for (const field of [
    'invocationId',
    'method',
    'actionClass',
    'authorisationRef',
    'companyId',
    'outboxId',
    'claimId',
    'effectId',
    'idempotencyKey',
    'correlationTag',
    'resourceRef',
  ] as const) {
    if (!isCleanString(object[field], 512)) {
      return { kind: 'REFUSED', reason: 'FIELD_MALFORMED' };
    }
  }
  const adapterId = object['adapterId'];
  if (!isCleanString(adapterId, 64) || !isWellFormedAdapterId(adapterId)) {
    return { kind: 'REFUSED', reason: 'FIELD_MALFORMED' };
  }
  const recoverability = object['recoverability'];
  if (typeof recoverability !== 'string' || !RECOVERABILITY_VALUES.includes(recoverability)) {
    return { kind: 'REFUSED', reason: 'FIELD_MALFORMED' };
  }
  if (typeof object['requiresUnmirroredTag'] !== 'boolean') {
    return { kind: 'REFUSED', reason: 'FIELD_MALFORMED' };
  }
  const overrideRef = object['overrideRef'];
  if (overrideRef !== null && !isCleanString(overrideRef, 512)) {
    return { kind: 'REFUSED', reason: 'FIELD_MALFORMED' };
  }
  const payloadHash = object['dispatchPayloadHash'];
  if (typeof payloadHash !== 'string' || !HEX64.test(payloadHash)) {
    return { kind: 'REFUSED', reason: 'FIELD_MALFORMED' };
  }
  const bindingDigest = object['bindingDigest'];
  if (typeof bindingDigest !== 'string' || !HEX64.test(bindingDigest)) {
    return { kind: 'REFUSED', reason: 'FIELD_MALFORMED' };
  }
  const payload = object['dispatchPayloadBase64'];
  if (
    typeof payload !== 'string' ||
    payload.length > MAX_IPC_MESSAGE_BYTES ||
    !BASE64.test(payload)
  ) {
    return { kind: 'REFUSED', reason: 'FIELD_MALFORMED' };
  }

  const message: DispatchRequest = Object.freeze({
    protocolVersion: INTEGRATION_PROTOCOL_VERSION,
    kind: DISPATCH_REQUEST_KIND,
    invocationId: object['invocationId'] as string,
    adapterId,
    method: object['method'] as string,
    actionClass: object['actionClass'] as string,
    recoverability: recoverability as Recoverability,
    authorisationRef: object['authorisationRef'] as string,
    companyId: object['companyId'] as string,
    outboxId: object['outboxId'] as string,
    claimId: object['claimId'] as string,
    effectId: object['effectId'] as string,
    idempotencyKey: object['idempotencyKey'] as string,
    correlationTag: object['correlationTag'] as string,
    resourceRef: object['resourceRef'] as string,
    requiresUnmirroredTag: object['requiresUnmirroredTag'],
    overrideRef: overrideRef as string | null,
    dispatchPayloadHash: payloadHash,
    dispatchPayloadBase64: payload,
    bindingDigest,
  });
  return { kind: 'DECODED', message };
}

const REFUSAL_MEMBERS: readonly string[] = ['protocolVersion', 'kind', 'invocationId', 'reason'];
const RESPONSE_MEMBERS: readonly string[] = [
  'protocolVersion',
  'kind',
  'invocationId',
  'adapterId',
  'outcome',
  'credentialIdentity',
  'credentialVersion',
];

/**
 * Decode one inbound REPLY on the CONTROL side. Equally closed, for the same reason.
 *
 * `§22`: "No arbitrary provider exception crosses back into kernel state." A reply that
 * does not satisfy this decoder never becomes an `AdapterOutcome`: the client maps it to
 * `OUTCOME_UNKNOWN`, because a runtime that answered something unparseable has told the
 * kernel nothing about whether the write escaped.
 */
export function decodeIntegrationReply(
  raw: unknown,
): DecodeResult<DispatchResponse | RequestRefused | RuntimeReady> {
  if (typeof raw !== 'string') return { kind: 'REFUSED', reason: 'MESSAGE_NOT_AN_OBJECT' };
  if (Buffer.byteLength(raw, 'utf8') > MAX_IPC_MESSAGE_BYTES) {
    return { kind: 'REFUSED', reason: 'MESSAGE_TOO_LARGE' };
  }
  if (LONE_SURROGATE.test(raw)) return { kind: 'REFUSED', reason: 'FIELD_MALFORMED' };
  if (hasPrototypeShape(raw)) return { kind: 'REFUSED', reason: 'PROTOTYPE_POLLUTION_SHAPE' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { kind: 'REFUSED', reason: 'MESSAGE_NOT_AN_OBJECT' };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { kind: 'REFUSED', reason: 'MESSAGE_NOT_AN_OBJECT' };
  }
  const object = parsed as Record<string, unknown>;
  if (object['protocolVersion'] !== INTEGRATION_PROTOCOL_VERSION) {
    return { kind: 'REFUSED', reason: 'PROTOCOL_VERSION_MISMATCH' };
  }

  if (object['kind'] === RUNTIME_READY_KIND) {
    const pid = object['pid'];
    if (
      !isCleanString(object['runtimeIdentity'], 128) ||
      !isCleanString(object['adapterId'], 64) ||
      typeof pid !== 'number' ||
      !Number.isInteger(pid)
    ) {
      return { kind: 'REFUSED', reason: 'FIELD_MALFORMED' };
    }
    const environmentKeys = object['environmentKeys'];
    if (
      !Array.isArray(environmentKeys) ||
      environmentKeys.length > MAX_REPORTED_ENV_KEYS ||
      !environmentKeys.every(
        (key: unknown) => typeof key === 'string' && ENV_KEY_GRAMMAR.test(key),
      )
    ) {
      return { kind: 'REFUSED', reason: 'FIELD_MALFORMED' };
    }
    const ready: RuntimeReady = Object.freeze({
      protocolVersion: INTEGRATION_PROTOCOL_VERSION,
      kind: RUNTIME_READY_KIND,
      runtimeIdentity: object['runtimeIdentity'] as string,
      adapterId: object['adapterId'] as string,
      pid,
      environmentKeys: Object.freeze([...(environmentKeys as string[])].sort()),
    });
    return { kind: 'DECODED', message: ready };
  }

  if (object['kind'] === REQUEST_REFUSED_KIND) {
    // A REFUSAL CARRIES EXACTLY FOUR MEMBERS. An extra one is a detail string wearing a
    // different name, and `§23` is the reason it does not decode.
    for (const key of Object.keys(object)) {
      if (!REFUSAL_MEMBERS.includes(key)) return { kind: 'REFUSED', reason: 'UNKNOWN_FIELD' };
    }
    const invocationId = object['invocationId'];
    if (invocationId !== null && !isCleanString(invocationId, 512)) {
      return { kind: 'REFUSED', reason: 'FIELD_MALFORMED' };
    }
    const reason = object['reason'];
    if (typeof reason !== 'string' || !(REFUSAL_REASONS as readonly string[]).includes(reason)) {
      return { kind: 'REFUSED', reason: 'FIELD_MALFORMED' };
    }
    const refused: RequestRefused = Object.freeze({
      protocolVersion: INTEGRATION_PROTOCOL_VERSION,
      kind: REQUEST_REFUSED_KIND,
      invocationId: invocationId as string | null,
      reason: reason as RefusalReason,
    });
    return { kind: 'DECODED', message: refused };
  }

  if (object['kind'] !== DISPATCH_RESPONSE_KIND) {
    return { kind: 'REFUSED', reason: 'FIELD_MALFORMED' };
  }
  for (const key of Object.keys(object)) {
    if (!RESPONSE_MEMBERS.includes(key)) return { kind: 'REFUSED', reason: 'UNKNOWN_FIELD' };
  }
  for (const member of RESPONSE_MEMBERS) {
    if (!Object.prototype.hasOwnProperty.call(object, member)) {
      return { kind: 'REFUSED', reason: 'MISSING_FIELD' };
    }
  }
  if (!isCleanString(object['invocationId'], 512) || !isCleanString(object['adapterId'], 64)) {
    return { kind: 'REFUSED', reason: 'FIELD_MALFORMED' };
  }
  for (const field of ['credentialIdentity', 'credentialVersion'] as const) {
    const value = object[field];
    if (value !== null && !isCleanString(value, 128)) {
      return { kind: 'REFUSED', reason: 'FIELD_MALFORMED' };
    }
  }
  const outcome = decodeWireOutcome(object['outcome']);
  if (outcome === null) return { kind: 'REFUSED', reason: 'FIELD_MALFORMED' };

  const response: DispatchResponse = Object.freeze({
    protocolVersion: INTEGRATION_PROTOCOL_VERSION,
    kind: DISPATCH_RESPONSE_KIND,
    invocationId: object['invocationId'] as string,
    adapterId: object['adapterId'] as string,
    outcome,
    credentialIdentity: object['credentialIdentity'] as string | null,
    credentialVersion: object['credentialVersion'] as string | null,
  });
  return { kind: 'DECODED', message: response };
}

/**
 * The outcome member's own closed decoder.
 *
 * FOUR SHAPES, EACH WITH ITS OWN EXACT FIELD LIST. A shape with a fifth member does not
 * decode, which is what keeps `§44`'s "arbitrary raw provider response" off this wire: an
 * adapter that wanted to return a body has nowhere on `WireOutcome` to put one, and
 * `rawResponseHash` is a digest of retained evidence rather than the evidence.
 */
function decodeWireOutcome(value: unknown): WireOutcome | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const object = value as Record<string, unknown>;
  const keys = Object.keys(object).sort().join(',');
  switch (object['kind']) {
    case 'ADAPTER_RETURNED': {
      if (keys !== 'kind,providerReference,rawResponseHash') return null;
      const reference = object['providerReference'];
      const hash = object['rawResponseHash'];
      if (reference !== null && !isCleanString(reference, 256)) return null;
      if (hash !== null && (typeof hash !== 'string' || !HEX64.test(hash))) return null;
      return Object.freeze({
        kind: 'ADAPTER_RETURNED',
        providerReference: reference as string | null,
        rawResponseHash: hash as string | null,
      });
    }
    case 'OUTCOME_UNKNOWN': {
      if (keys !== 'kind,reason') return null;
      const reason = object['reason'];
      if (reason !== 'TIMEOUT' && reason !== 'AMBIGUOUS') return null;
      return Object.freeze({ kind: 'OUTCOME_UNKNOWN', reason });
    }
    case 'NOT_SENT_CONFIRMED': {
      if (keys !== 'basis,kind') return null;
      const basis = object['basis'];
      if (basis !== 'PRE_SEND_FAILURE' && basis !== 'PROVIDER_REJECTED_NO_MUTATION') return null;
      return Object.freeze({ kind: 'NOT_SENT_CONFIRMED', basis });
    }
    case 'ADAPTER_FAILED': {
      if (keys !== 'failureClass,kind') return null;
      const failureClass = object['failureClass'];
      if (
        typeof failureClass !== 'string' ||
        !(WIRE_FAILURE_CLASSES as readonly string[]).includes(failureClass)
      ) {
        return null;
      }
      return Object.freeze({ kind: 'ADAPTER_FAILED', failureClass: failureClass as WireFailureClass });
    }
    default:
      return null;
  }
}

/**
 * Encode one message for the transport. THE ONLY SERIALISER, AND IT BOUNDS ITS OWN OUTPUT.
 *
 * Returns `null` where the encoded form exceeds `MAX_IPC_MESSAGE_BYTES`, so the bound is
 * enforced on the SENDING side too rather than only detected on the receiving one. `§42`:
 * "Do not allow a compromised worker to create an unbounded process/message queue."
 */
export function encodeIntegrationMessage(message: IntegrationMessage): string | null {
  const raw = JSON.stringify(message);
  if (Buffer.byteLength(raw, 'utf8') > MAX_IPC_MESSAGE_BYTES) return null;
  return raw;
}
