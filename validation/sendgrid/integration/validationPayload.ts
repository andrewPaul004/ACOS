/**
 * THE CLOSED DISPATCH-PAYLOAD SCHEMA FOR THE S1P VALIDATION EMAIL, AND THE DECODER THAT
 * ENFORCES IT.
 *
 * =================================================================================
 * THE DEFECT THIS MODULE EXISTS TO CLOSE — S1P INDEPENDENT REVIEW, CORRECTION 2
 *
 * The rejected adapter verified that `dispatchPayloadBytes` hashed to the hash the
 * authorisation committed, and then **ignored those bytes**. The recipient, the sender and
 * the body were read from LAUNCH CONFIGURATION, so the chain
 *
 *     authorisation_ref -> dispatch_payload_hash -> the actual provider request
 *
 * was broken in its last link: an edit to one JSON document on the deployment host changed
 * WHO RECEIVED THE EFFECT while every hash in the system still verified. The review's words:
 * "A configuration change can change the recipient while preserving the same authorised
 * payload. That is unacceptable."
 *
 * `26 §2.1` is the rule the defect violated — the payload "binds this request to exactly one
 * dispatch payload" — and `33 §1` is the same rule from the adapter's side: "Each [adapter]
 * receives the kernel's `dispatch_payload` **verbatim**."
 *
 * So EVERY SEMANTIC PROVIDER-WRITE FIELD IS NOW IN THE PAYLOAD, and this module is where the
 * payload is read. `tests/negative-controls/sendgrid-controls.test.ts` CONTROL 9 is the
 * discrimination: the same authorised bytes, two different launch configurations, and the
 * corrected adapter produces the same recipient both times while the unsafe one follows the
 * configuration.
 *
 * =================================================================================
 * WHY THE DECODER IS WRITTEN OUT HERE RATHER THAN IMPORTED FROM THE CANONICALISER
 *
 * `canonicalBytes.ts` is the ENCODER, and it is on the control plane's authority path: its
 * entry point calls `assertJcs1SpecificationAdmitted`, which requires an ACTIVE VERIFIED
 * class-20 bundle. The integration runtime is a `child_process.fork` that holds a vendor
 * credential and deliberately holds NO control-plane trust chain — `I25`, and
 * `tests/sendgrid/prerequisites-and-separation.test.ts` asserts the closure — so importing
 * the canonicaliser here would either drag the whole bootstrap into the credential-holding
 * child or refuse at the first invocation.
 *
 * This is the same trade `adapterSecretSource.ts` states for the provenance list: "Two
 * independent transcriptions of one closed list disagree loudly." The disagreement is caught
 * in `tests/sendgrid/payload-binding.test.ts`, which ENCODES with the real
 * `dispatchPayloadCanonicalBytes` and DECODES with this module, in a test process where
 * importing both is harmless. A decoder that agreed with itself would prove nothing.
 *
 * =================================================================================
 * WHAT IS IN THE PAYLOAD, AND WHAT IS DELIBERATELY NOT
 *
 * IN — every field that decides WHO receives the effect or WHAT effect is sent:
 *   `sender_address`  the exact verified sending identity
 *   `sink_address`    the exact owner-controlled sink
 *   `subject`         the exact subject line
 *   `body_text`       the exact `text/plain` body
 *
 * NOT IN, and each for a stated reason:
 *   the CORRELATION TAG   `25 §7` kernel/outbox metadata, minted at enqueue AFTER the
 *                         authorisation committed. ADR-026 puts it on the outbox row, so it
 *                         cannot be a payload field without inverting that order. It reaches
 *                         only `categories` and `custom_args` — provider-visible correlation
 *                         fields — and changes no business or recipient semantics.
 *   `sandbox_mode`        a FIXED ADAPTER SAFETY PROPERTY, emitted as the literal `false`.
 *                         Not an authority field, because no authority may turn it on:
 *                         `§8.6` and S1O's capability record make a sandbox send the one
 *                         that removes the `I36` evidence.
 *   the CREDENTIAL        `23 §3`, `I25`. Resolved per invocation by the runtime's own
 *   and the ENDPOINT      source; the origin and path are module constants in
 *                         `providerClient.ts`. Neither is a payload field and neither could
 *                         be: there is no member here to put one in.
 * =================================================================================
 */

/**
 * THE SIGNED CLASS-3 OPERATION THIS PACKAGE IMPLEMENTS — CORRECTION 17.
 *
 * Transcribed rather than read from the verified bundle, for the reason
 * `adapterSecretSource.ts` transcribes its provenance list: these constants are read by the
 * credential-holding integration child, whose import closure deliberately contains no
 * control-plane trust chain. `tests/sendgrid/payload-binding.test.ts` asserts the
 * transcription against the VERIFIED class-3 artifact, from a test process where importing
 * both is harmless — so a future edit to the signed record that this file does not follow
 * fails there rather than at a provider.
 *
 * They live HERE rather than in `adapter.ts` so that a module wanting the signed operation
 * does not acquire the real vendor send client along with it. That matters for exactly one
 * consumer and it is the one that matters most: the OFFLINE double in
 * `tests/sendgrid-doubles/` must be unable to reach `api.sendgrid.com` structurally.
 */
export const SIGNED_ACTION_CLASS = 'email.send';
export const SIGNED_METHOD = 'emailSend';
/** `50 §2a` field 2 for this class. An email send cannot be unsent. */
export const SIGNED_RECOVERABILITY = 'IRRECOVERABLE';

/** The canonical structure kind `dispatchPayloadCanonicalBytes` frames first. */
export const DISPATCH_PAYLOAD_KIND = 'acos.dispatch_payload.v1';

/** `30 §5.3` (v1.3.2 JCS-01): the reserved framing word meaning a field-level NULL. */
const NULL_LENGTH_WORD = 0xff_ff_ff_ff;

/**
 * The CLOSED field set of the validation email's vendor parameters.
 *
 * Closed in both directions: a payload MISSING one of these is refused, and a payload
 * carrying anything else is refused. `§2.1` of the correction mandate: "a CLOSED
 * deterministic dispatch-payload schema"; `§2.2` item 5: "reject malformed/unknown fields
 * before the provider boundary."
 */
export const VALIDATION_EMAIL_FIELDS = [
  'sender_address',
  'sink_address',
  'subject',
  'body_text',
] as const;

export type ValidationEmailField = (typeof VALIDATION_EMAIL_FIELDS)[number];

/** The authorised effect, as the adapter may use it. Every member is payload-bound. */
export interface ValidationEmailPayload {
  readonly senderAddress: string;
  readonly sinkAddress: string;
  readonly subject: string;
  readonly bodyText: string;
}

/** The seven declared fields of `acos.dispatch_payload.v1`, decoded. */
export interface DecodedDispatchPayload {
  readonly adapter: string;
  readonly method: string;
  readonly vendorParameters: Readonly<Record<string, string>>;
  readonly idempotencyKey: string;
  readonly monetaryEffect: string | null;
  readonly preconditionToken: string | null;
  readonly authorisationRef: string;
}

/**
 * Why a payload could not be used. A CLOSED set, and EVERY member is refused BEFORE the
 * provider boundary is marked — so every one of them is honestly pre-send.
 */
export const PAYLOAD_REFUSALS = [
  /** The framing is not `acos.dispatch_payload.v1`, or is truncated, or over-long. */
  'PAYLOAD_FRAMING_INVALID',
  /** The framed structure kind is some other structure. */
  'PAYLOAD_KIND_MISMATCH',
  /** `vendorParameters` is not a flat JSON object of strings. */
  'VENDOR_PARAMETERS_MALFORMED',
  /** A declared field is absent. */
  'VENDOR_PARAMETER_MISSING',
  /** A field outside the closed set is present. `§2.2` item 5. */
  'VENDOR_PARAMETER_UNKNOWN',
  /** The payload names an adapter other than this one. */
  'PAYLOAD_ADAPTER_MISMATCH',
  /** The payload names a method other than the signed class-3 `method`. */
  'PAYLOAD_METHOD_MISMATCH',
  /** The payload's `authorisation_ref` is not the one the host validated. */
  'PAYLOAD_AUTHORISATION_REF_MISMATCH',
  /** `I18a`: `email.send` declares `carries_vendor_monetary_field: false`. */
  'PAYLOAD_CARRIES_MONETARY_EFFECT',
  /** The authorised sender or sink is not a syntactically usable address. */
  'PAYLOAD_ADDRESS_MALFORMED',
  /** The AUTHORISED sink does not carry the owner-controlled non-production marker. */
  'PAYLOAD_SINK_NOT_OWNER_CONTROLLED',
  /** The subject or body is empty, over-long, or carries a header separator. */
  'PAYLOAD_CONTENT_INVALID',
] as const;

export type PayloadRefusal = (typeof PAYLOAD_REFUSALS)[number];

export type PayloadResult =
  | { readonly kind: 'PAYLOAD'; readonly payload: ValidationEmailPayload }
  | { readonly kind: 'REFUSED'; readonly reason: PayloadRefusal };

/**
 * The declared marker an owner-controlled non-production sink address must carry.
 *
 * A sub-address tag (`user+acos-nonprod-sink@example.test`) or a local part containing it.
 * It is DEFENCE IN DEPTH and NOT the non-production declaration: `§7` of the correction
 * mandate is explicit that "the structural sink marker remains useful defence in depth, but
 * it is not the declaration itself", and the declaration is an explicit operator
 * acknowledgement evaluated by `preflight.ts`.
 */
export const OWNER_SINK_MARKER = 'acos-nonprod-sink';

/** A subject or body longer than this is not a validation artifact. */
export const MAX_VALIDATION_SUBJECT_LENGTH = 200;
export const MAX_VALIDATION_BODY_LENGTH = 2_000;

/**
 * Deliberately narrow, and deliberately NOT an RFC 5322 parser.
 *
 * What it has to exclude is a value that is not an address at all — an empty string, a
 * header injection, a list. The PROVIDER is the authority on address validity; this
 * function's job is to refuse the shapes that would make the request mean something other
 * than it says.
 */
export function isUsableAddress(value: string): boolean {
  if (value.length === 0 || value.length > 254) return false;
  if (/[\s,;<>"\\]/.test(value)) return false;
  if (/[\r\n]/.test(value)) return false;
  const at = value.indexOf('@');
  return at > 0 && at === value.lastIndexOf('@') && at < value.length - 1;
}

/** Whether an address is the owner-controlled non-production sink it claims to be. */
export function isOwnerControlledSink(value: string): boolean {
  return isUsableAddress(value) && value.includes(OWNER_SINK_MARKER);
}

/** A subject or body may not carry a bare CR or LF: neither may forge a header boundary. */
function isUsableContent(value: string, maxLength: number): boolean {
  if (value.length === 0 || value.length > maxLength) return false;
  return !/[\r]/.test(value);
}

/**
 * Read ONE length-framed field. Returns the payload bytes, `null` for a field-level NULL,
 * and throws nothing: a truncated buffer yields `undefined`, which the caller refuses.
 */
function readField(
  bytes: Buffer,
  offset: number,
): { readonly value: Buffer | null; readonly next: number } | undefined {
  if (offset + 4 > bytes.byteLength) return undefined;
  const word = bytes.readUInt32BE(offset);
  if (word === NULL_LENGTH_WORD) return { value: null, next: offset + 4 };
  const end = offset + 4 + word;
  if (end > bytes.byteLength) return undefined;
  return { value: bytes.subarray(offset + 4, end), next: end };
}

/**
 * Decode `acos.dispatch_payload.v1`'s eight framed fields — the structure kind and the seven
 * declared members — in the DECLARED ORDER `dispatchPayloadStructure` writes.
 *
 * TOTAL over its argument: every malformed input yields a refusal rather than an exception,
 * because this function runs inside the adapter and an exception there is classified by the
 * host as an adapter fault rather than as the specific refusal a reviewer needs to see.
 */
export function decodeDispatchPayload(
  bytes: Buffer,
): { readonly kind: 'DECODED'; readonly payload: DecodedDispatchPayload } | {
  readonly kind: 'REFUSED';
  readonly reason: PayloadRefusal;
} {
  const refuse = (reason: PayloadRefusal): { readonly kind: 'REFUSED'; readonly reason: PayloadRefusal } =>
    ({ kind: 'REFUSED', reason });

  let offset = 0;
  const fields: (Buffer | null)[] = [];
  // EIGHT fields exactly: the kind, then the seven members. A ninth is a different
  // structure and a missing one is a truncation; both refuse.
  for (let index = 0; index < 8; index += 1) {
    const read = readField(bytes, offset);
    if (read === undefined) return refuse('PAYLOAD_FRAMING_INVALID');
    fields.push(read.value);
    offset = read.next;
  }
  if (offset !== bytes.byteLength) return refuse('PAYLOAD_FRAMING_INVALID');

  const text = (index: number): string | null => {
    const field = fields[index];
    return field === null || field === undefined ? null : field.toString('utf8');
  };

  if (text(0) !== DISPATCH_PAYLOAD_KIND) return refuse('PAYLOAD_KIND_MISMATCH');

  const adapter = text(1);
  const method = text(2);
  const vendorJson = text(3);
  const idempotencyKey = text(4);
  const authorisationRef = text(7);
  if (
    adapter === null ||
    method === null ||
    vendorJson === null ||
    idempotencyKey === null ||
    authorisationRef === null
  ) {
    // These five positions are NON-NULLABLE in the declared structure. A NULL framing word
    // at one of them is a payload this decoder must not guess at.
    return refuse('PAYLOAD_FRAMING_INVALID');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(vendorJson) as unknown;
  } catch {
    return refuse('VENDOR_PARAMETERS_MALFORMED');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return refuse('VENDOR_PARAMETERS_MALFORMED');
  }
  const vendorParameters: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof value !== 'string') return refuse('VENDOR_PARAMETERS_MALFORMED');
    vendorParameters[key] = value;
  }

  return {
    kind: 'DECODED',
    payload: Object.freeze({
      adapter,
      method,
      vendorParameters: Object.freeze(vendorParameters),
      idempotencyKey,
      monetaryEffect: text(5),
      preconditionToken: text(6),
      authorisationRef,
    }),
  };
}

/**
 * Decode AND validate one authorised validation-email payload. THE ONLY ROUTE FROM BYTES TO
 * A SENDABLE EFFECT.
 *
 * Every check is a refusal rather than a coercion, and every refusal happens before the
 * caller marks the provider boundary. The `expected` record is what the HOST already
 * validated on the invocation: the payload must AGREE with it, so a payload naming another
 * adapter, another method or another authorisation is refused even though its hash verified.
 */
export function parseValidationEmailPayload(
  bytes: Buffer,
  expected: {
    readonly adapterId: string;
    readonly method: string;
    readonly authorisationRef: string;
  },
): PayloadResult {
  const decoded = decodeDispatchPayload(bytes);
  if (decoded.kind === 'REFUSED') return decoded;
  const payload = decoded.payload;

  if (payload.adapter !== expected.adapterId) return { kind: 'REFUSED', reason: 'PAYLOAD_ADAPTER_MISMATCH' };
  if (payload.method !== expected.method) return { kind: 'REFUSED', reason: 'PAYLOAD_METHOD_MISMATCH' };
  if (payload.authorisationRef !== expected.authorisationRef) {
    return { kind: 'REFUSED', reason: 'PAYLOAD_AUTHORISATION_REF_MISMATCH' };
  }
  // `I18a`'s null branch. `email.send` declares `carries_vendor_monetary_field: false`, so a
  // payload carrying a money field is a payload for some other class.
  if (payload.monetaryEffect !== null) {
    return { kind: 'REFUSED', reason: 'PAYLOAD_CARRIES_MONETARY_EFFECT' };
  }

  const present = Object.keys(payload.vendorParameters);
  for (const field of present) {
    if (!(VALIDATION_EMAIL_FIELDS as readonly string[]).includes(field)) {
      return { kind: 'REFUSED', reason: 'VENDOR_PARAMETER_UNKNOWN' };
    }
  }
  for (const field of VALIDATION_EMAIL_FIELDS) {
    if (!present.includes(field)) return { kind: 'REFUSED', reason: 'VENDOR_PARAMETER_MISSING' };
  }

  const senderAddress = payload.vendorParameters.sender_address!;
  const sinkAddress = payload.vendorParameters.sink_address!;
  const subject = payload.vendorParameters.subject!;
  const bodyText = payload.vendorParameters.body_text!;

  if (!isUsableAddress(senderAddress)) return { kind: 'REFUSED', reason: 'PAYLOAD_ADDRESS_MALFORMED' };
  if (!isUsableAddress(sinkAddress)) return { kind: 'REFUSED', reason: 'PAYLOAD_ADDRESS_MALFORMED' };
  /*
   * THE SINK SAFETY CHECK IS APPLIED TO THE **AUTHORISED** ADDRESS, NOT TO A CONFIGURED ONE.
   *
   * `§2.3` of the correction mandate: the harness must refuse to AUTHORISE an effect whose
   * recipient fails the non-production sink controls, and "once the effect is authorised, the
   * address actually dispatched MUST be the address committed by `dispatch_payload_hash`".
   * This check is the adapter's independent half of the first sentence; it can only REFUSE,
   * and it can never substitute. There is no configured sink in this module's scope to
   * substitute WITH.
   */
  if (!isOwnerControlledSink(sinkAddress)) {
    return { kind: 'REFUSED', reason: 'PAYLOAD_SINK_NOT_OWNER_CONTROLLED' };
  }
  if (!isUsableContent(subject, MAX_VALIDATION_SUBJECT_LENGTH)) {
    return { kind: 'REFUSED', reason: 'PAYLOAD_CONTENT_INVALID' };
  }
  if (!isUsableContent(bodyText, MAX_VALIDATION_BODY_LENGTH)) {
    return { kind: 'REFUSED', reason: 'PAYLOAD_CONTENT_INVALID' };
  }

  return {
    kind: 'PAYLOAD',
    payload: Object.freeze({ senderAddress, sinkAddress, subject, bodyText }),
  };
}
