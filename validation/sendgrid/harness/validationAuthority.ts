import { createHash, randomUUID } from 'node:crypto';

import { dispatchPayloadCanonicalBytes } from '../../../src/kernel/canonicalisation/canonicaliser.js';
import type { LocalAuthorisationRequestFacts } from '../../../src/kernel/authorisation/localAuthorisation.js';
import { money } from '../../../src/kernel/exposure/money.js';
import {
  VALIDATION_EMAIL_FIELDS,
  isOwnerControlledSink,
  isUsableAddress,
  type ValidationEmailPayload,
} from '../integration/validationPayload.js';
import { VALIDATION_SUBJECT_PREFIX } from '../integration/requestMapping.js';

/**
 * `§11.2` — THE ISOLATED S1P VALIDATION-AUTHORITY SEEDER. **IT IS NOT A PRODUCTION API.**
 *
 * =================================================================================
 * WHAT THIS IS FOR, AND THE ONE THING IT MUST NOT BECOME
 *
 * The S1P scenario driver has to traverse the ACCEPTED dispatch path — outbox, claim,
 * gateway, integration runtime, outcome — and that path begins with an ALREADY-AUTHORITATIVE
 * effect. `email.send` is `UNGOVERNED_FAILS_CLOSED` in ordinary production: no Cedar policy,
 * no registered policy construction, no registered constructor, so `26 §7` step C2 denies it
 * long before policy. **THAT IS CORRECT AND S1P DOES NOT CHANGE IT.**
 *
 * `§11.2`: "Do NOT build a general production email policy just to execute S1P. [...] This
 * mechanism must not become a generic 'insert authorised effect' production API."
 *
 * So this module is the narrow analogue of the accepted S1J integration fixture: it produces
 * ONE shape of effect — a non-production validation email to an owner-controlled sink — and
 * it is reachable only from the S1P harness. The boundary is asserted from four directions in
 * `tests/sendgrid/validation-authority-boundary.test.ts`:
 *
 *   1. NOTHING UNDER `src/` IMPORTS `validation/`. The control plane's import closure cannot
 *      reach this module, so no production route can call it whatever it wanted to.
 *   2. THE CONSTRUCTOR REQUIRES THE S1P LIVE ACKNOWLEDGEMENT TOKEN, by value. A caller that
 *      does not have the operator's sentence cannot build one.
 *   3. THE SINK MUST BE OWNER-CONTROLLED, and the refusal is here, before an authorisation
 *      is committed — `§2.3`: the harness "must refuse unless the recipient satisfies the
 *      non-production sink controls".
 *   4. ORDINARY `email.send` STILL FAILS CLOSED. This module does not register a policy, a
 *      policy construction or a production constructor, and
 *      `tests/policy/policy-set-gap-analysis.test.ts` asserts that by execution.
 *
 * =================================================================================
 * THE PAYLOAD IT COMMITS IS THE WHOLE OF CORRECTION 2's OTHER HALF
 *
 * `validationPayload.ts` makes the ADAPTER read every semantic field out of the authorised
 * bytes. That is only worth something if the bytes actually CARRY them, and this is where
 * they are written: `vendorParameters` holds exactly `VALIDATION_EMAIL_FIELDS` — the sender,
 * the sink, the subject and the body — so `dispatch_payload_hash` commits to the entire
 * provider-visible effect.
 *
 * The chain is then closed end to end:
 *
 *     this seeder writes sender/sink/subject/body into the canonical payload
 *       -> `commitLocalAuthorisation` binds `dispatch_payload_hash` to `authorisation_ref`
 *       -> the outbox carries the payload BYTES verbatim (`25 §7`)
 *       -> the integration host re-hashes them against the authorisation
 *       -> the adapter parses THOSE BYTES and sends exactly what they say
 *
 * **NO LAUNCH DOCUMENT APPEARS ANYWHERE IN THAT CHAIN.**
 *
 * =================================================================================
 * WHY THE COMMIT AND THE ENUMERATION ARE **PORTS**
 *
 * Committing a local authorisation needs a control-plane transaction, an entity lease and a
 * live enumeration; enumerating needs a registered constructor for the class. Those are
 * properties of a COMPOSITION, and a validation module that built its own would be a second
 * composition root with its own opinion about authority.
 *
 * So they arrive as injected functions. The offline scenario suite supplies the accepted
 * harness's own lease manager, enumerator and `commitLocalAuthorisation`; a live deployment
 * supplies its own. What this module owns — and what is therefore identical offline and live
 * — is the PAYLOAD, the SAFETY REFUSALS and the FACTS record.
 * =================================================================================
 */

/** The acknowledgement a caller must present BY VALUE to construct a seeder. */
export const S1P_VALIDATION_AUTHORITY_ACKNOWLEDGEMENT =
  'I_AUTHORISE_A_REAL_NON_PRODUCTION_SENDGRID_SEND';

/** The action class and method the signed class-3 record declares. */
export const VALIDATION_ACTION_CLASS = 'email.send';
export const VALIDATION_METHOD = 'emailSend';
export const VALIDATION_ADAPTER = 'sendgrid_email';

/**
 * `51 §2`'s MIE windows, as the accepted IRRECOVERABLE fixture uses them.
 *
 * `email.send` declares `irrecoverable_units: 1`, so step R reserves one unit against the
 * same window instances `fulfilment.reship` reserves against. The driver's `I20` comparison
 * reads the reservation basis those windows record.
 */
export const VALIDATION_WINDOWS: readonly string[] = Object.freeze(['W_DAY_MIE', 'W_MONTH_MIE']);

/** Why an effect could not be authorised. A closed set, and every member is a refusal to ACT. */
export const SEED_REFUSALS = [
  /** The caller did not present the operator's acknowledgement. */
  'LIVE_ACKNOWLEDGEMENT_ABSENT',
  /** `§2.3`: the recipient does not satisfy the non-production sink controls. */
  'SINK_NOT_OWNER_CONTROLLED',
  'SENDER_MALFORMED',
  /** The composed subject or body is not a validation artifact. */
  'CONTENT_INVALID',
  /** The commit port refused. The reason is the port's, and it is carried verbatim. */
  'COMMIT_REFUSED',
] as const;

export type SeedRefusal = (typeof SEED_REFUSALS)[number];

/** One authorised validation effect, as the driver needs it. */
export interface AuthorisedValidationEffect {
  readonly effectId: string;
  readonly authorisationRef: string;
  readonly idempotencyKey: string;
  readonly resourceId: string;
  readonly resourceRef: string;
  readonly dispatchPayloadHash: string;
  readonly payloadCanonicalBytes: Buffer;
  /** The semantic fields the payload committed. The oracle for what the adapter must send. */
  readonly authorised: ValidationEmailPayload;
}

export type SeedResult =
  | { readonly kind: 'AUTHORISED'; readonly effect: AuthorisedValidationEffect }
  | { readonly kind: 'REFUSED'; readonly reason: SeedRefusal; readonly detail: string };

/** The composition's own commit path. `commitLocalAuthorisation`, wired by the deployment. */
export type CommitPort = (
  facts: LocalAuthorisationRequestFacts,
) => Promise<{ readonly kind: 'COMMITTED'; readonly effectId: string } | { readonly kind: 'REFUSED'; readonly detail: string }>;

/** The composition's own live enumeration, for `25 §14.1`'s revalidation identity. */
export type EnumeratePort = (input: {
  readonly actionClass: string;
  readonly resourceRef: string;
  readonly resourceId: string;
  readonly taskId: string;
}) => Promise<{ readonly enumerationId: string; readonly optionId: string }>;

/** The constructor-version identity the composition signed for this validation class. */
export interface ValidationConstructorVersion {
  readonly constructorId: string;
  readonly actionClass: string;
  readonly semanticMajor: number;
  readonly nonSemanticMinor: number;
  readonly semanticChange: boolean;
  readonly changedFields: readonly string[];
  readonly signedAt: Date;
  readonly recordHash: string;
}

/**
 * Compose the validation message's subject and body DETERMINISTICALLY from the correlation
 * salt, so two runs of one scenario produce byte-identical authorised payloads and a reviewer
 * can recompute them.
 *
 * The content is recognisable in an account's own activity view as a validation artifact
 * rather than a business message, and it carries NO customer-like content — `§16`: evidence
 * must not carry "full customer-like message content", and a message that cannot contain any
 * is one no redaction step has to remove it from.
 */
export function composeValidationContent(scenarioLabel: string): {
  readonly subject: string;
  readonly bodyText: string;
} {
  return {
    subject: `${VALIDATION_SUBJECT_PREFIX} ${scenarioLabel}`,
    bodyText:
      `${VALIDATION_SUBJECT_PREFIX}\n` +
      `scenario: ${scenarioLabel}\n` +
      'This message is an ACOS non-production provider-validation artifact. It carries no ' +
      'business content and was sent to an owner-controlled sink.',
  };
}

/**
 * The canonical dispatch payload for one validation email.
 *
 * Exported so `tests/sendgrid/payload-binding.test.ts` can ENCODE with this function and
 * DECODE with `validationPayload.ts` — two independent implementations of one framing, which
 * is the only way the transcribed decoder can be shown to agree with the production encoder.
 */
export function validationDispatchPayloadBytes(input: {
  readonly authorisationRef: string;
  readonly idempotencyKey: string;
  readonly authorised: ValidationEmailPayload;
}): Buffer {
  return dispatchPayloadCanonicalBytes({
    adapter: VALIDATION_ADAPTER as never,
    method: VALIDATION_METHOD as never,
    /*
     * THE CLOSED FIELD SET, AND NOTHING ELSE.
     *
     * Written out member by member rather than spread from a record, so a field added to
     * `ValidationEmailPayload` without being added to `VALIDATION_EMAIL_FIELDS` is a
     * compile-time omission here rather than a silently unbound semantic field at the
     * provider.
     */
    vendorParameters: Object.freeze({
      sender_address: input.authorised.senderAddress,
      sink_address: input.authorised.sinkAddress,
      subject: input.authorised.subject,
      body_text: input.authorised.bodyText,
    }) as never,
    idempotencyKey: input.idempotencyKey as never,
    /*
     * `I18a`'s NULL BRANCH. `email.send` declares `carries_vendor_monetary_field: false`, so
     * the vendor request contains no money field at all and the payload carries none.
     * `parseValidationEmailPayload` refuses a payload that does.
     */
    monetaryEffect: null,
    preconditionToken: null,
    authorisationRef: input.authorisationRef as never,
  });
}

function sha256Hex(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * THE SEEDER. One shape of effect, one acknowledgement, one sink policy.
 *
 * It is a class rather than a function so the acknowledgement is checked ONCE, at
 * construction, and every later call is on an object a caller could only have obtained by
 * presenting it. A free function taking the token per call would be one whose safety a
 * `?? ''` default could remove.
 */
export class S1PValidationAuthority {
  private readonly commit: CommitPort;

  private readonly enumerate: EnumeratePort;

  private readonly constructorVersion: ValidationConstructorVersion;

  private readonly companyId: string;

  private readonly acknowledged: boolean;

  public constructor(input: {
    readonly acknowledgement: string;
    readonly companyId: string;
    readonly commit: CommitPort;
    readonly enumerate: EnumeratePort;
    readonly constructorVersion: ValidationConstructorVersion;
  }) {
    this.acknowledged = input.acknowledgement === S1P_VALIDATION_AUTHORITY_ACKNOWLEDGEMENT;
    this.companyId = input.companyId;
    this.commit = input.commit;
    this.enumerate = input.enumerate;
    this.constructorVersion = input.constructorVersion;
  }

  /**
   * Authorise ONE non-production validation email, or refuse.
   *
   * `scenarioLabel` names the kill-point scenario and reaches the subject and body — so the
   * message that arrives at the owner's sink says which scenario produced it, and says so in
   * bytes the authorisation committed.
   */
  public async authoriseValidationEmail(input: {
    readonly scenarioLabel: string;
    readonly senderAddress: string;
    readonly sinkAddress: string;
    readonly resourceId: string;
    readonly taskId: string;
  }): Promise<SeedResult> {
    if (!this.acknowledged) {
      return {
        kind: 'REFUSED',
        reason: 'LIVE_ACKNOWLEDGEMENT_ABSENT',
        detail: 'the S1P validation authority was constructed without the operator sentence',
      };
    }
    if (!isUsableAddress(input.senderAddress)) {
      return { kind: 'REFUSED', reason: 'SENDER_MALFORMED', detail: 'the sender is not an address' };
    }
    /*
     * `§2.3` — THE NON-PRODUCTION SINK CONTROL, APPLIED **BEFORE** ANYTHING IS AUTHORISED.
     *
     * This is the half the adapter cannot perform: once an effect is authorised, the adapter
     * must dispatch the address the hash committed, so the only place a customer address can
     * be kept out of the system is BEFORE the commit. A refusal here means no authorisation
     * row, no outbox row and no payload — nothing downstream has to defend against it.
     */
    if (!isOwnerControlledSink(input.sinkAddress)) {
      return {
        kind: 'REFUSED',
        reason: 'SINK_NOT_OWNER_CONTROLLED',
        detail: 'the recipient does not carry the owner-controlled non-production sink marker',
      };
    }

    const content = composeValidationContent(input.scenarioLabel);
    const authorised: ValidationEmailPayload = Object.freeze({
      senderAddress: input.senderAddress,
      sinkAddress: input.sinkAddress,
      subject: content.subject,
      bodyText: content.bodyText,
    });
    if (content.subject.length === 0 || content.bodyText.length === 0) {
      return { kind: 'REFUSED', reason: 'CONTENT_INVALID', detail: 'composed content was empty' };
    }

    const authorisationRef = `auth:AR-S1P-${randomUUID()}`;
    const idempotencyKey = `idem:${VALIDATION_ACTION_CLASS}:${input.resourceId}:${authorisationRef}`;
    const payloadCanonicalBytes = validationDispatchPayloadBytes({
      authorisationRef,
      idempotencyKey,
      authorised,
    });
    const dispatchPayloadHash = sha256Hex(payloadCanonicalBytes);

    const resourceRef = `validation:${input.resourceId}`;
    // `25 §14.1`'s revalidation identity, from a REAL enumeration against live state.
    const identity = await this.enumerate({
      actionClass: VALIDATION_ACTION_CLASS,
      resourceRef,
      resourceId: input.resourceId,
      taskId: input.taskId,
    });

    const facts: LocalAuthorisationRequestFacts = {
      companyId: this.companyId,
      sessionId: 'session:S1P-validation',
      taskId: input.taskId,
      principalId: 'principal:support_reasoner:1',
      authorisationRef,
      actionClass: VALIDATION_ACTION_CLASS,
      resourceRef,
      resourceId: input.resourceId,
      dispatchPayloadHash,
      intentHash: 'fixture:s1p-validation-intent-hash',
      contextDigest: 'fixture:s1p-validation-context-digest',
      constructorVersion: this.constructorVersion as never,
      policyVersion: 'fixture:s1p-validation-policy-version',
      /*
       * NO MONETARY EXPOSURE. `email.send` declares `carries_vendor_monetary_field: false`
       * and `cost_component_free: false` — the send costs the account something, and that
       * cost is a DISCLOSED estimate rather than a reservation, exactly as
       * `fulfilment.reship`'s COGS is. `26 §5`: "Count remains the **gating** control."
       */
      exposure: { vendorAmount: null, totalExposure: money('0.00'), forwardIntegral: null },
      recoverability: 'IRRECOVERABLE',
      valueDirection: 'NONE',
      adapter: VALIDATION_ADAPTER,
      idempotencyKey,
      windowRefs: [...VALIDATION_WINDOWS],
      approvalRequirement: 'NONE',
      autonomyLevel: 'L3',
      gateClass: 'UNGATED_LOGGED',
      /** `51 §2.3`: ONE irrecoverable unit, as the signed class-3 record declares. */
      countUnits: 1n,
      enumerationId: identity.enumerationId,
      optionId: identity.optionId,
    } as LocalAuthorisationRequestFacts;

    const committed = await this.commit(facts);
    if (committed.kind === 'REFUSED') {
      return { kind: 'REFUSED', reason: 'COMMIT_REFUSED', detail: committed.detail };
    }

    return {
      kind: 'AUTHORISED',
      effect: Object.freeze({
        effectId: committed.effectId,
        authorisationRef,
        idempotencyKey,
        resourceId: input.resourceId,
        resourceRef,
        dispatchPayloadHash,
        payloadCanonicalBytes,
        authorised,
      }),
    };
  }
}

/** Exported so a test can assert the payload's field set against the decoder's closed one. */
export const SEEDED_VENDOR_PARAMETER_FIELDS: readonly string[] = VALIDATION_EMAIL_FIELDS;
