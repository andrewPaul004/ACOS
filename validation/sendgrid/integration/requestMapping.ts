import { isCorrelationTag } from '../../../src/kernel/outbox/correlationTag.js';
import type { ValidationEmailPayload } from './validationPayload.js';

/**
 * THE DETERMINISTIC MAPPING FROM AN ALREADY-AUTHORITATIVE ACOS DISPATCH PAYLOAD INTO A v3
 * MAIL SEND BODY. PURE, TOTAL, AND THE ONLY PLACE A SENDGRID REQUEST IS CONSTRUCTED.
 *
 * =================================================================================
 * WHAT CHANGED AFTER THE S1P INDEPENDENT REVIEW, AND WHY IT IS THE WHOLE POINT
 *
 * THE REJECTED VERSION OF THIS FILE TOOK ITS SENDER AND ITS RECIPIENT FROM LAUNCH
 * CONFIGURATION, and argued that this was SAFER than taking them from the effect: "A
 * recipient that arrives in the dispatch payload is a recipient an upstream defect can make a
 * customer."
 *
 * That argument is wrong, and the review said why: it breaks the meaningful relationship
 * between `authorisation_ref`, `dispatch_payload_hash` and the actual provider request. A
 * hash that commits to bytes nobody reads commits to nothing. With the recipient in launch
 * configuration, editing ONE JSON file on the deployment host changed who received the
 * effect while every hash in the system still verified — and the verification was what the
 * whole slice existed to demonstrate.
 *
 * **SO EVERY SEMANTIC PROVIDER-WRITE FIELD NOW ARRIVES FROM `ValidationEmailPayload`**, which
 * `validationPayload.ts` decodes from `invocation.dispatchPayloadBytes` — the bytes the
 * integration host already checked against `dispatch_payload_hash`. The safety property the
 * old comment wanted is kept, and kept in the two places that can actually hold it:
 *
 *   1. AT AUTHORISATION. The S1P validation seeder refuses to construct an effect whose
 *      recipient is not the owner-controlled sink, so a customer address never becomes an
 *      authorised payload in the first place.
 *   2. AT THE ADAPTER, AS A REFUSAL AND NEVER AS A SUBSTITUTION.
 *      `parseValidationEmailPayload` refuses an authorised sink that does not carry the
 *      owner marker. It cannot replace one, because there is no configured address in its
 *      scope to replace it with.
 *
 * `26 §1` COROLLARY 3 still holds and now holds honestly: every field below comes from the
 * KERNEL — from the payload the kernel canonicalised and committed, or from the correlation
 * tag the kernel minted at enqueue. **NOTHING COMES FROM A MODEL, A WORKER, A PROVIDER
 * RESPONSE OR A LAUNCH DOCUMENT.**
 *
 * =================================================================================
 * THE THREE CLASSES OF FIELD IN THE EMITTED BODY, NAMED
 *
 *   PAYLOAD-BOUND SEMANTIC FIELDS — `personalizations[0].to[0].email`, `from.email`,
 *     `subject`, `content[0].value`. Every one is committed by `dispatch_payload_hash`.
 *   KERNEL CORRELATION METADATA — `categories` and `custom_args`. `25 §7`'s tag, minted at
 *     enqueue AFTER the authorisation committed and carried on the outbox row per ADR-026.
 *     It is provider-visible correlation and changes no business or recipient semantics;
 *     `§2.1` of the correction mandate admits it here for exactly that reason.
 *   FIXED ADAPTER SAFETY FIELDS — `mail_settings.sandbox_mode.enable`, emitted as the
 *     literal `false`. Not an authority field, because no authority may turn it on.
 *
 * The credential and the endpoint are neither: they are runtime configuration and module
 * constants, and this function names neither.
 *
 * =================================================================================
 * `§19` OF THE S1P MANDATE — SANDBOX MODE IS REFUSED HERE, BEFORE THE BOUNDARY
 *
 * S1O established the fact this refusal rests on, from Twilio SendGrid's own documentation:
 * a request made with `mail_settings.sandbox_mode.enable = true` is validated, never
 * delivered, and **generates no Event Webhook event and no Email Activity event.** The mode
 * that makes a request safe is the mode that removes the evidence `I36` reads.
 *
 * So `sandbox_mode` is not a configurable member of the body this module emits. It is
 * emitted EXPLICITLY AS `false`, and `buildSendGridSendRequest` REFUSES an input that asks
 * for `true` — returning a refusal rather than throwing, so the adapter can decline without
 * marking the provider boundary crossed. `§8.6`: "Add a discriminating test for this. Do not
 * merely document it."
 * =================================================================================
 */

/** `https://api.sendgrid.com`'s v3 Mail Send path. A CONSTANT, never an argument. */
export const SENDGRID_MAIL_SEND_PATH = '/v3/mail/send';

/** The `custom_args` key carrying the correlation tag. Non-secret, declared once. */
export const CORRELATION_CUSTOM_ARG = 'acos_correlation_tag';

/**
 * The deterministic subject prefix the S1P validation SEEDER puts into the authorised
 * payload. It is declared here so the seeder and the reviewer share one literal, and it is
 * NOT applied by this function: the subject it emits is the authorised one, verbatim.
 */
export const VALIDATION_SUBJECT_PREFIX = 'ACOS S1P NON-PRODUCTION VALIDATION';

/** What one send needs. THE SEMANTIC OPERANDS ARE THE AUTHORISED ONES. */
export interface SendGridSendInput {
  /**
   * The decoded, validated, payload-bound semantic fields. `§2.1`: "the authoritative payload
   * must bind every semantic provider-write field that could change who receives the effect
   * or what effect is sent."
   */
  readonly authorised: ValidationEmailPayload;
  /** `25 §7`'s provider-visible correlation tag, verbatim from the invocation. */
  readonly correlationTag: string;
  /**
   * Present so the refusal has something to refuse, and `false` on every legitimate path.
   *
   * A boolean rather than an absent member, because a check that can only be written by
   * adding a field is a check nobody can test. `§8.6` requires a DISCRIMINATING test, and a
   * discriminating test needs the unsafe input to be expressible.
   */
  readonly sandboxMode: boolean;
}

/** Why a send request could not be constructed. A closed set; every member is pre-boundary. */
export const SEND_MAPPING_REFUSALS = [
  /** `§19`: sandbox mode is not the `I36` path, and it is refused before the boundary. */
  'SANDBOX_MODE_REFUSED',
  /** The tag is not one `mintCorrelationTag` produced. Provider evidence would not correlate. */
  'CORRELATION_TAG_MALFORMED',
] as const;

export type SendMappingRefusal = (typeof SEND_MAPPING_REFUSALS)[number];

/**
 * The v3 Mail Send body, as a closed shape.
 *
 * `personalizations` carries ONE entry with ONE recipient. There is no member a second
 * recipient, a cc, a bcc or a template substitution could occupy, which is the structural
 * form of "one owner-controlled sink, never a list".
 */
export interface SendGridMailSendBody {
  readonly personalizations: readonly [{ readonly to: readonly [{ readonly email: string }] }];
  readonly from: { readonly email: string };
  readonly subject: string;
  readonly content: readonly [{ readonly type: 'text/plain'; readonly value: string }];
  /**
   * `25 §7`'s tag in a PROVIDER-VISIBLE FIELD, and `categories` is the unambiguous one.
   *
   * S1O's capability record: `categories` is settable on the v3 send AND is itself a
   * documented Email Activity filter field, where `custom_args`/`unique_args` round-tripping
   * is the item the account validation still owes. Both are emitted; `categories` is the one
   * the observation loop filters on, and the second is carried so the account run can settle
   * whether it round-trips.
   */
  readonly categories: readonly [string];
  readonly custom_args: Readonly<Record<string, string>>;
  /** EXPLICITLY `false`. See this module's header. */
  readonly mail_settings: { readonly sandbox_mode: { readonly enable: false } };
}

export type SendMappingResult =
  | { readonly kind: 'REQUEST'; readonly body: SendGridMailSendBody }
  | { readonly kind: 'REFUSED'; readonly reason: SendMappingRefusal };

/**
 * Build one v3 Mail Send body, or refuse. TOTAL, PURE, AND THE ONLY CONSTRUCTOR.
 *
 * It performs no I/O, holds no credential and names no URL: the client one file over adds
 * the origin, the path and the Authorization header, and nothing it adds is derived from
 * anything this function returns.
 *
 * The ADDRESS and CONTENT validity checks are NOT repeated here. They belong to
 * `parseValidationEmailPayload`, which is the only producer of a `ValidationEmailPayload`,
 * and duplicating them would create a second place where the sink policy could drift.
 */
export function buildSendGridSendRequest(input: SendGridSendInput): SendMappingResult {
  // `§19`, FIRST, because a sandbox request is refused whatever else is wrong with it.
  if (input.sandboxMode) return { kind: 'REFUSED', reason: 'SANDBOX_MODE_REFUSED' };
  if (!isCorrelationTag(input.correlationTag)) {
    return { kind: 'REFUSED', reason: 'CORRELATION_TAG_MALFORMED' };
  }

  return {
    kind: 'REQUEST',
    body: Object.freeze({
      personalizations: Object.freeze([
        Object.freeze({
          to: Object.freeze([Object.freeze({ email: input.authorised.sinkAddress })]),
        }),
      ]) as SendGridMailSendBody['personalizations'],
      from: Object.freeze({ email: input.authorised.senderAddress }),
      /*
       * THE AUTHORISED SUBJECT AND BODY, VERBATIM.
       *
       * Not a subject this function composes from the tag, and not a sentence it appends:
       * `33 §1` — "receives the kernel's `dispatch_payload` verbatim" — and a mapping that
       * decorated the authorised content would be a mapping whose output the authorisation
       * did not commit to. The seeder puts `VALIDATION_SUBJECT_PREFIX`, the correlation and
       * the "this is a validation artifact" sentence INTO the payload, where the hash covers
       * them.
       */
      subject: input.authorised.subject,
      content: Object.freeze([
        Object.freeze({ type: 'text/plain' as const, value: input.authorised.bodyText }),
      ]) as SendGridMailSendBody['content'],
      categories: Object.freeze([input.correlationTag]) as SendGridMailSendBody['categories'],
      custom_args: Object.freeze({ [CORRELATION_CUSTOM_ARG]: input.correlationTag }),
      mail_settings: Object.freeze({ sandbox_mode: Object.freeze({ enable: false as const }) }),
    }),
  };
}
