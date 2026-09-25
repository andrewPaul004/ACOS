/**
 * THE POSTMARK PROVIDER CAPABILITY RECORD — `25 §7`'s EM6 CRITERION, AS DATA.
 *
 * =================================================================================
 * WHAT THIS FILE IS
 *
 * `§36` of the S1M mandate: "Persist/cache only NON-SECRET provider capability evidence
 * needed by EM6 [...] Do not make capability metadata model-controlled."
 *
 * So this is a hand-authored, frozen transcription of what the PROVIDER'S OWN PUBLISHED
 * DOCUMENTATION said on the retrieval date below. It carries no token, no server id, no
 * account identifier and no recipient. Nothing at runtime writes it, no model proposes it,
 * and no caller parameterises it.
 *
 * `§2` of the mandate: "Do not treat this paragraph as architecture." The same applies here
 * with more force — THIS RECORD IS EVIDENCE, NOT ARCHITECTURE. `25 §7` declares the EM6
 * criterion; this file records whether one named provider meets it, and a provider that
 * changes its API changes this file rather than the criterion.
 *
 * =================================================================================
 * IT IS DOCUMENTATION EVIDENCE AND NOT ACCOUNT EVIDENCE
 *
 * `§2`: "Verify current provider behavior against official Postmark documentation AND,
 * WHERE POSSIBLE, THE ACTUAL SANDBOX ACCOUNT. Record dated evidence."
 *
 * No sandbox account was available to S1M, so `basis` is `PUBLISHED_DOCUMENTATION` on every
 * row and NOT ONE ROW IS MARKED AS MEASURED. `36 §7` requires vendor properties to be
 * MEASURED against a sandbox rather than trusted from an annotation, and this record does
 * not pretend to be that measurement. The distinction is carried in the TYPE so that a later
 * slice which does hold an account changes a discriminated value rather than a comment.
 * =================================================================================
 */

/** How a row came to be believed. A closed set of two, and S1M can only produce the first. */
export const OBSERVATION_BASES = [
  /** Read from the provider's own published developer documentation on `RETRIEVED_ON`. */
  'PUBLISHED_DOCUMENTATION',
  /** Exercised against a real provider account and recorded from the response. */
  'MEASURED_AGAINST_ACCOUNT',
] as const;

export type ObservationBasis = (typeof OBSERVATION_BASES)[number];

/**
 * `25 §7`'s three EM6 disjuncts, transcribed. The same closed set
 * `src/kernel/gateway/adapterPort.ts` declares, and deliberately a SECOND, INDEPENDENT
 * transcription rather than an import: `tools/` may import `src/`, but a capability record
 * that took its vocabulary from the port it is evidence about would agree with the port by
 * construction. `tests/postmark/capability-record.test.ts` asserts the two agree.
 */
export const EM6_PRIMITIVES = [
  'IDEMPOTENCY_HEADER',
  'DELIVERY_EVENT_WEBHOOK',
  'QUERYABLE_MESSAGE_LOG',
] as const;

export type Em6Primitive = (typeof EM6_PRIMITIVES)[number];

export interface CapabilityRow {
  readonly capability: string;
  /** What the provider documentation states. Non-secret, and paraphrased narrowly (`§47`). */
  readonly evidence: string;
  readonly basis: ObservationBasis;
  /** The published page this row was read from. */
  readonly reference: string;
}

export interface ProviderCapabilityRecord {
  readonly provider: 'postmark';
  /**
   * `§36`: "server/environment identity". The record names the CLASSIFICATION and the
   * mechanism that establishes it. It deliberately carries NO server id and NO server name,
   * because S1M holds no account and a placeholder identity is worse than an absent one.
   */
  readonly environmentClassification: 'Sandbox';
  /**
   * The provider mechanism that PROVES the classification before a send — `§35`.
   * `50 §3f`'s discipline applied to a vendor: evidence, not a variable named sandbox.
   */
  readonly classificationProof: {
    readonly method: string;
    readonly field: string;
    readonly acceptedValue: 'Sandbox';
    readonly rejectedValue: 'Live';
    readonly credentialRequired: string;
    readonly reference: string;
    readonly basis: ObservationBasis;
  };
  /** Which of `25 §7`'s three disjuncts this provider satisfies, and which it does not. */
  readonly em6: Readonly<Record<Em6Primitive, boolean>>;
  /**
   * The ONE primitive S1M nominates as the qualifying one — `§14`: "State which exact
   * primitive qualifies Postmark."
   */
  readonly qualifyingPrimitive: Em6Primitive;
  readonly correlation: {
    readonly providerField: string;
    readonly key: string;
    readonly maxKeyLength: number;
    readonly maxValueLength: number;
    readonly maxFields: number;
    readonly searchable: boolean;
    readonly returnedInWebhooks: boolean;
    readonly reference: string;
    readonly basis: ObservationBasis;
  };
  /** `§36`: "relevant retention window". */
  readonly retention: {
    readonly defaultDays: number;
    readonly minimumConfigurableDays: number;
    readonly maximumConfigurableDays: number;
    readonly reference: string;
    readonly basis: ObservationBasis;
  };
  /**
   * `§7` of the mandate and `36 §13`'s replica-read test. Recorded as a LIMITATION row
   * rather than omitted, because the architecture's audit-plane exemption (`48 §2` row 13)
   * rests on that plane's vendor credentials being read-only.
   */
  readonly credentialScoping: {
    readonly readOnlyApiTokenAvailable: boolean;
    readonly tokensPerServer: number;
    readonly detail: string;
    readonly reference: string;
    readonly basis: ObservationBasis;
  };
  readonly rows: readonly CapabilityRow[];
  /** `§47`: the retrieval date, so a reader knows how old this belief is. */
  readonly retrievedOn: string;
}

/** `§47`'s retrieval date. Every row below was read on this date and on no other. */
export const RETRIEVED_ON = '2026-09-25';

const DOC_SERVER_API = 'https://postmarkapp.com/developer/api/server-api';
const DOC_MESSAGES_API = 'https://postmarkapp.com/developer/api/messages-api';
const DOC_EMAIL_API = 'https://postmarkapp.com/developer/api/email-api';
const DOC_OVERVIEW = 'https://postmarkapp.com/developer/api/overview';
const DOC_SANDBOX = 'https://postmarkapp.com/developer/user-guide/sandbox-mode/server-sandbox-mode';
const DOC_METADATA = 'https://postmarkapp.com/support/article/1125-custom-metadata-faq';
const DOC_TOKENS =
  'https://postmarkapp.com/support/article/1008-what-are-the-account-and-server-api-tokens';

const DOCUMENTED: ObservationBasis = 'PUBLISHED_DOCUMENTATION';

export const POSTMARK_CAPABILITY_RECORD: ProviderCapabilityRecord = Object.freeze({
  provider: 'postmark',
  environmentClassification: 'Sandbox',
  classificationProof: Object.freeze({
    method: 'GET /server',
    field: 'DeliveryType',
    acceptedValue: 'Sandbox',
    rejectedValue: 'Live',
    credentialRequired: 'server-level token',
    reference: DOC_SERVER_API,
    basis: DOCUMENTED,
  }),
  em6: Object.freeze({
    // NO DOCUMENTED IDEMPOTENCY KEY. `§14`: "Do NOT claim native idempotency if Postmark
    // does not provide a documented idempotency key." The published request semantics
    // declare no idempotency header and no idempotent-retry contract for the send endpoint.
    IDEMPOTENCY_HEADER: false,
    // Documented as AVAILABLE and NOT IMPLEMENTED by S1M — `§26`.
    DELIVERY_EVENT_WEBHOOK: true,
    QUERYABLE_MESSAGE_LOG: true,
  }),
  qualifyingPrimitive: 'QUERYABLE_MESSAGE_LOG',
  correlation: Object.freeze({
    providerField: 'Metadata',
    // Exactly twenty characters, which is the documented maximum for a metadata field name.
    key: 'acos_correlation_tag',
    maxKeyLength: 20,
    maxValueLength: 80,
    maxFields: 10,
    searchable: true,
    returnedInWebhooks: true,
    reference: DOC_METADATA,
    basis: DOCUMENTED,
  }),
  retention: Object.freeze({
    defaultDays: 45,
    minimumConfigurableDays: 7,
    maximumConfigurableDays: 365,
    reference: DOC_MESSAGES_API,
    basis: DOCUMENTED,
  }),
  credentialScoping: Object.freeze({
    readOnlyApiTokenAvailable: false,
    tokensPerServer: 3,
    detail:
      'a server API token grants sending, sent-message inspection and the bounce API as one ' +
      'undivided capability; read-only access exists as a user role in the web interface and ' +
      'carries no API token, so every API credential able to read the outbound message log ' +
      'is also able to submit a send',
    reference: DOC_TOKENS,
    basis: DOCUMENTED,
  }),
  rows: Object.freeze([
    Object.freeze({
      capability: 'sandbox classification',
      evidence:
        'a server carries a delivery type of Live or Sandbox, fixed at creation and not ' +
        'changeable afterwards; a sandbox server does not deliver to recipients',
      basis: DOCUMENTED,
      reference: DOC_SANDBOX,
    }),
    Object.freeze({
      capability: 'provider query / search',
      evidence:
        'the outbound message search supports count, offset, recipient, fromemail, tag, ' +
        'status, fromdate, todate, subject, messagestream and a per-metadata-field filter, ' +
        'one metadata field per search',
      basis: DOCUMENTED,
      reference: DOC_MESSAGES_API,
    }),
    Object.freeze({
      capability: 'provider message details',
      evidence: 'an outbound message detail endpoint returns the record for one message id',
      basis: DOCUMENTED,
      reference: DOC_MESSAGES_API,
    }),
    Object.freeze({
      capability: 'provider-generated message identity',
      evidence: 'the send endpoint returns a provider message id, a submission time and a status',
      basis: DOCUMENTED,
      reference: DOC_EMAIL_API,
    }),
    Object.freeze({
      capability: 'provider-visible ACOS correlation',
      evidence:
        'a send carries a metadata object of at most ten key/value pairs, field names at ' +
        'most twenty characters and values at most eighty, surfaced in the API and in ' +
        'webhook payloads and filterable in the outbound search',
      basis: DOCUMENTED,
      reference: DOC_METADATA,
    }),
    Object.freeze({
      capability: 'delivery / event information',
      evidence: 'webhooks fire for messages sent through a sandbox server',
      basis: DOCUMENTED,
      reference: DOC_SANDBOX,
    }),
    Object.freeze({
      capability: 'native idempotency',
      evidence: 'no idempotency key, header or idempotent-retry contract is documented',
      basis: DOCUMENTED,
      reference: DOC_OVERVIEW,
    }),
    Object.freeze({
      capability: 'rate limiting',
      evidence:
        'a rate-limited response is documented; no published numeric limit is stated, so ' +
        'such a response carries no documented guarantee about whether the request mutated ' +
        'state',
      basis: DOCUMENTED,
      reference: DOC_OVERVIEW,
    }),
    Object.freeze({
      capability: 'audit-plane read credential',
      evidence:
        'no read-only API token scope exists; a server may hold up to three API tokens and ' +
        'each carries the full server capability',
      basis: DOCUMENTED,
      reference: DOC_TOKENS,
    }),
  ]),
  retrievedOn: RETRIEVED_ON,
});

/**
 * Whether the record satisfies `25 §7`'s EM6 criterion. The section's disqualifier is
 * "NEITHER an idempotency header NOR a delivery-event webhook NOR a queryable message log",
 * so any one of the three qualifies — and the nominated primitive must be one that is
 * actually present, so the record cannot qualify on a primitive it also declares absent.
 */
export function em6Qualifies(record: ProviderCapabilityRecord): boolean {
  return (
    EM6_PRIMITIVES.some((primitive) => record.em6[primitive]) &&
    record.em6[record.qualifyingPrimitive]
  );
}
