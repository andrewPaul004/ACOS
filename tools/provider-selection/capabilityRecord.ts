/**
 * THE S1O PROVIDER CAPABILITY RECORD — `§25` OF THE S1O MANDATE, AS DATA.
 *
 * =================================================================================
 * WHAT THIS FILE IS, AND WHAT IT DELIBERATELY IS NOT
 *
 * `§25`: "Create a dated evidence record containing: provider; docs URLs/references;
 * retrieval date; send credential scope; audit read scope; attempted-write expectation;
 * activity query; correlation mechanism; sandbox mechanism; retention/add-on requirement;
 * unresolved account-level items. **No marketing prose.**"
 *
 * So this is a hand-authored, frozen transcription of what each PROVIDER'S OWN OFFICIAL
 * DEVELOPER DOCUMENTATION said on the retrieval date below. It carries no token, no account
 * identifier, no domain and no recipient. Nothing at runtime writes it, no model proposes
 * it, and no caller parameterises it.
 *
 * **IT IS EVIDENCE, NOT ARCHITECTURE.** `48 §3.6` declares the audit-plane obligation;
 * `50 §2g` declares the credential risk class; this file records whether three named
 * providers can satisfy them, and a provider that changes its API changes this file rather
 * than either declaration.
 *
 * =================================================================================
 * EVERY ROW IS DOCUMENTATION EVIDENCE. NOT ONE IS ACCOUNT EVIDENCE.
 *
 * `§24`: "S1O is provider SELECTION and audit-boundary implementation. It may PASS without
 * live vendor credentials if official documentation unambiguously establishes the
 * capability shape [...] and selected-provider account-level confirmation is explicitly
 * left for resumed S1M/S1P."
 *
 * `basis` is `PUBLISHED_DOCUMENTATION` on every row and **NOT ONE ROW IS MARKED AS
 * MEASURED.** `36 §7` requires vendor properties to be MEASURED against a sandbox rather
 * than trusted from an annotation, and this record does not pretend to be that measurement.
 * The distinction is carried in the TYPE so a later slice holding an account changes a
 * discriminated value rather than a comment.
 *
 * =================================================================================
 * `§27` — NO PROVIDER REQUEST WAS MADE BY ANYTHING IN THIS REPOSITORY.
 *
 * This file constructs no URL, imports no HTTP primitive and is imported by no runtime. The
 * strings below are documentation REFERENCES for a human reader.
 * `tests/provider-selection/provider-selection-boundary.test.ts` asserts the absence.
 * =================================================================================
 */

/** How a row came to be believed. A closed set of two, and S1O can only produce the first. */
export const OBSERVATION_BASES = [
  /** Read from the provider's own official developer documentation on `RETRIEVED_ON`. */
  'PUBLISHED_DOCUMENTATION',
  /** Exercised against a real provider account and recorded from the response. */
  'MEASURED_AGAINST_ACCOUNT',
] as const;

export type ObservationBasis = (typeof OBSERVATION_BASES)[number];

/**
 * `§19`'s FIVE REQUIRED CAPABILITIES. "**If any is absent: provider is not selected.**"
 *
 * A closed list, because `§19` is a conjunction and a conjunction evaluated over an open
 * list is a conjunction whose result depends on what somebody remembered to check.
 */
export const REQUIRED_CAPABILITIES = [
  /** A credential restricted to the required send operation, not broad account admin. */
  'CONTROL_SEND_ONLY_CREDENTIAL',
  /** A SEPARATE credential able to query provider evidence and INCAPABLE of send. */
  'AUDIT_READ_ONLY_CREDENTIAL',
  /** A provider-visible ACOS correlation field that can later be QUERIED. */
  'PROVIDER_VISIBLE_CORRELATION',
  /** Queryable accepted/sent/delivery activity adequate for the real `I36` oracle. */
  'QUERYABLE_PROVIDER_EVIDENCE',
  /** A safe way to exercise real API behaviour without sending to ordinary customers. */
  'NON_PRODUCTION_TEST_PATH',
] as const;

export type RequiredCapability = (typeof REQUIRED_CAPABILITIES)[number];

/**
 * What the official documentation establishes about one required capability.
 *
 * THREE VALUES, AND THE THIRD IS THE ONE THAT MATTERS. `§22`: "If official endpoint/role
 * mapping cannot establish it: mark Mailgun **unresolved**." `§24`: "If provider docs leave
 * a load-bearing permission ambiguous: S1O returns PARTIAL rather than guessing."
 *
 * `UNRESOLVED` is therefore NOT a synonym for `ABSENT`, and collapsing the two would be the
 * guess `§24` forbids: `ABSENT` is a documented negative, and `UNRESOLVED` is the absence of
 * documentation either way.
 */
export const CAPABILITY_STATUSES = [
  /** Official documentation establishes the capability shape unambiguously. */
  'DOCUMENTED',
  /** Official documentation establishes that the capability does NOT exist. */
  'ABSENT',
  /** Official documentation does not settle it either way. NOT a negative. */
  'UNRESOLVED',
] as const;

export type CapabilityStatus = (typeof CAPABILITY_STATUSES)[number];

export interface CapabilityFinding {
  readonly capability: RequiredCapability;
  readonly status: CapabilityStatus;
  /** What the documentation states. Non-secret, narrowly paraphrased, no marketing prose. */
  readonly evidence: string;
  readonly basis: ObservationBasis;
  /** The official page this finding was read from. */
  readonly reference: string;
}

/** `§25`'s named evidence fields, one per provider. */
export interface ProviderCapabilityRecord {
  readonly provider: string;
  /** `§18`: the retrieval date, so a reader knows how old this belief is. */
  readonly retrievedOn: string;
  /** `§19` control-side: the exact scope a send-only credential would carry. */
  readonly sendCredentialScope: {
    readonly mechanism: string;
    readonly scope: readonly string[];
    readonly excludesAccountAdministration: boolean;
    readonly reference: string;
    readonly basis: ObservationBasis;
  };
  /** `§19` audit-side: the exact scope an independent read credential would carry. */
  readonly auditReadCredentialScope: {
    readonly mechanism: string;
    readonly scope: readonly string[];
    /** The decisive property. `48 §3.6`, `36 §13`, `50 §2g` field 7. */
    readonly sendCapable: boolean | null;
    readonly reference: string;
    readonly basis: ObservationBasis;
  };
  /**
   * `§15`, `§20` — what a send attempted with the AUDIT credential is EXPECTED to do.
   *
   * An EXPECTATION, and the type says so. `§15`: "A documentation claim alone is not the
   * final acceptance proof for a configured provider. [...] The later sandbox slice must
   * empirically run the attempted-write test."
   */
  readonly attemptedWriteExpectation: {
    readonly expected: string;
    readonly mechanism: string;
    readonly empiricallyTested: false;
    readonly reference: string;
    readonly basis: ObservationBasis;
  };
  /** `§19`: queryable provider evidence for the real `I36` oracle. */
  readonly activityQuery: {
    readonly endpoints: readonly string[];
    readonly filterFields: readonly string[];
    readonly rateLimit: string | null;
    readonly reference: string;
    readonly basis: ObservationBasis;
  };
  /** `§19`: the provider-visible ACOS correlation mechanism. */
  readonly correlation: {
    readonly sendField: string;
    readonly queryField: string;
    readonly queryable: boolean | null;
    readonly limits: string;
    readonly reference: string;
    readonly basis: ObservationBasis;
  };
  /**
   * `§19`: the provider's OWN safe-test flag, and whether it leaves evidence behind.
   *
   * =================================================================================
   * `producesQueryableActivity` IS THE FIELD THE v1.3.7 CORRECTION IS ABOUT
   *
   * The first S1O candidate carried `null` here for SendGrid, on the reading that the
   * documentation "says the message is never delivered and says NOTHING about whether a
   * sandbox request produces an Email Activity record". **That reading was wrong**: the
   * official Sandbox Mode page states the negative directly, and the owner review corrected
   * it. `null` therefore became a claim that the documentation is silent where it is not,
   * and an account-validation item was carried for a question already settled.
   *
   * `false` means the provider DOCUMENTS that this mode leaves no queryable evidence, which
   * is disqualifying for the `I36` oracle and is why `nonProductionValidationPath` below
   * exists as a separate field rather than as more prose on this one.
   */
  readonly sandbox: {
    readonly mechanism: string;
    readonly producesQueryableActivity: boolean | null;
    /** What this mode IS good for. Narrow, and never the evidence path. */
    readonly suitableFor: readonly string[];
    /** What this mode must NOT be used for. Named, so a later slice cannot drift into it. */
    readonly notSuitableFor: readonly string[];
    readonly reference: string;
    readonly basis: ObservationBasis;
  };
  /**
   * `§5` OF THE CORRECTION — THE BOUNDED NON-PRODUCTION PATH THAT MUST CARRY THE EVIDENCE.
   *
   * =================================================================================
   * WHY THIS IS A SECOND FIELD AND NOT A SENTENCE INSIDE `sandbox`
   *
   * The original selection rule checked five capabilities INDEPENDENTLY, and a provider
   * passed by having *a* safe test mechanism and, separately, *an* activity-query API. That
   * conjunction is satisfiable by a provider whose safe mode deliberately suppresses the
   * query surface — which is exactly SendGrid — and the resulting selection would have
   * named an `I36` validation environment that cannot produce `I36`'s evidence.
   *
   * So the record declares the test path ACOS would actually run, and
   * `evidencePathIncompatibility` requires THE SAME path to satisfy the whole chain:
   *
   *     real API request -> provider accepts/processes -> provider-side evidence exists
   *                      -> the AUDIT credential can independently observe it
   *
   * `sandboxModeEnabled` is carried explicitly because the corrected SendGrid answer is
   * `false`: the validation environment is a dedicated non-production account sending real
   * requests to an owner-controlled sink, not the sandbox flag.
   */
  readonly nonProductionValidationPath: {
    readonly mechanism: string;
    /** Whether the provider's own sandbox FLAG is set on the validating request. */
    readonly sandboxModeEnabled: boolean;
    /** Whether THIS path leaves evidence the activity query returns. `null` = unresolved. */
    readonly producesQueryableActivity: boolean | null;
    /** No customer recipient. An owner-controlled sink, or the path is not bounded. */
    readonly requiresControlledRecipient: boolean;
    /** What provisioning this path needs before it can run. Never claimed as done. */
    readonly requirements: readonly string[];
    readonly reference: string;
    readonly basis: ObservationBasis;
  };
  /** `§21`, `§25`: the entitlement or add-on the evidence query requires. */
  readonly retentionAndEntitlement: {
    readonly addOnRequired: boolean;
    readonly detail: string;
    readonly reference: string;
    readonly basis: ObservationBasis;
  };
  readonly findings: readonly CapabilityFinding[];
  /**
   * `§7` OF THE CORRECTION — QUESTIONS THE DOCUMENTATION HAS ALREADY ANSWERED NEGATIVELY.
   *
   * Separate from `unresolvedAccountItems` because the first S1O candidate carried SendGrid's
   * sandbox-activity question as PENDING when the official page had already settled it. A
   * pending item nobody can close is worse than no item: it postpones a decision that has
   * been made, and it left the readiness token describing an environment that cannot work.
   */
  readonly resolvedDocumentedNegatives: readonly string[];
  /** `§21`, `§25`: what only an account can settle. Never empty for a selected provider. */
  readonly unresolvedAccountItems: readonly string[];
}

/** `§18`'s retrieval date. Every reference below was read on this date and on no other. */
export const RETRIEVED_ON = '2026-09-26';

const DOCUMENTED: ObservationBasis = 'PUBLISHED_DOCUMENTATION';

// ---------------------------------------------------------------------------------
// TWILIO SENDGRID — official Twilio SendGrid developer documentation.
// ---------------------------------------------------------------------------------

const SG_CREATE_KEY =
  'https://www.twilio.com/docs/sendgrid/api-reference/api-keys/create-api-keys';
const SG_PERMISSIONS =
  'https://www.twilio.com/docs/sendgrid/api-reference/api-key-permissions';
const SG_ACTIVITY = 'https://www.twilio.com/docs/sendgrid/api-reference/email-activity';
const SG_ACTIVITY_GUIDE =
  'https://www.twilio.com/docs/sendgrid/for-developers/sending-email/getting-started-email-activity-api';
const SG_SANDBOX =
  'https://www.twilio.com/docs/sendgrid/for-developers/sending-email/sandbox-mode';
const SG_LIMITS = 'https://www.twilio.com/docs/sendgrid/api-reference/mail-send/limitations';
const SG_CATEGORIES =
  'https://www.twilio.com/docs/sendgrid/for-developers/sending-email/categories';
const SG_403 =
  'https://support.sendgrid.com/hc/en-us/articles/31240221874971-Error-403-Access-Forbidden-when-Accessing-the-Email-Activity-API';

export const SENDGRID_CAPABILITY_RECORD: ProviderCapabilityRecord = Object.freeze({
  provider: 'twilio_sendgrid',
  retrievedOn: RETRIEVED_ON,
  sendCredentialScope: Object.freeze({
    mechanism:
      'POST /v3/api_keys takes an explicit "scopes" array of individual permission strings; ' +
      'a key created with an explicit scopes array holds those permissions and no others. ' +
      'Omitting the array grants Full Access, so the array is REQUIRED for a narrow key',
    scope: Object.freeze(['mail.send']),
    excludesAccountAdministration: true,
    reference: SG_CREATE_KEY,
    basis: DOCUMENTED,
  }),
  auditReadCredentialScope: Object.freeze({
    mechanism:
      'a SECOND API key created by the same endpoint with a disjoint explicit scopes array; ' +
      'email_activity.read is a documented scope in the Stats permission group and ' +
      'mail.send is a documented scope in the Mail permission group, so a key may carry ' +
      'one without the other',
    scope: Object.freeze(['email_activity.read']),
    sendCapable: false,
    reference: SG_PERMISSIONS,
    basis: DOCUMENTED,
  }),
  attemptedWriteExpectation: Object.freeze({
    expected:
      'POST /v3/mail/send with a key whose scopes array does not contain mail.send is ' +
      'expected to be refused by the provider with HTTP 403',
    mechanism:
      'scope enforcement at the API. The documented converse is published: a key lacking ' +
      'Email Activity permission receives 403 Access Forbidden from GET /v3/messages, which ' +
      'is the same enforcement point read in the other direction',
    empiricallyTested: false,
    reference: SG_403,
    basis: DOCUMENTED,
  }),
  activityQuery: Object.freeze({
    endpoints: Object.freeze(['GET /v3/messages', 'GET /v3/messages/{msg_id}']),
    filterFields: Object.freeze([
      'msg_id',
      'from_email',
      'to_email',
      'subject',
      'status',
      'template_id',
      'categories',
      'unique_args',
      'events',
      'last_event_time',
      'api_key_id',
    ]),
    rateLimit: '6 requests per minute; HTTP 429 above it',
    reference: SG_ACTIVITY_GUIDE,
    basis: DOCUMENTED,
  }),
  correlation: Object.freeze({
    sendField: 'custom_args',
    queryField: 'unique_args',
    queryable: true,
    limits:
      'custom_args total length under 10,000 bytes; the documented query form is ' +
      "unique_args['<name>']=\"<value>\"; the v3 Mail Send resource uses custom_args where " +
      'the SMTP API and v2 Mail Send use unique_args, and the documentation states the two ' +
      'serve the same function. categories is the second, unambiguous mechanism: up to 10 ' +
      'per message, and categories is itself a documented Email Activity filter field',
    reference: SG_LIMITS,
    basis: DOCUMENTED,
  }),
  sandbox: Object.freeze({
    mechanism:
      'mail_settings.sandbox_mode.enable on the v3 Mail Send request. The documentation ' +
      'states the request is validated and the email is never delivered while the feature ' +
      'is enabled; a valid sandbox request returns 200 where a live accepted request ' +
      'returns 202. The same page states that requests made in sandbox mode do not ' +
      'generate events in either the Event Webhook or Email Activity',
    /*
     * **`false`, NOT `null` — THE DOCUMENTATION SETTLES IT.**
     *
     * The first S1O candidate carried `null` here and an account-validation item beside it,
     * on the reading that the page was silent about whether a sandbox request is RECORDED.
     * It is not silent. The official Sandbox Mode page states that sandbox requests generate
     * no Event Webhook events and no Email Activity events, which is a DOCUMENTED NEGATIVE
     * and not an open question, so `CAPABILITY_STATUSES`' own distinction applies: this is
     * `ABSENT` evidence, never `UNRESOLVED`.
     *
     * The consequence is the whole of the correction. SendGrid Sandbox Mode CANNOT be the
     * `I36` provider-side acceptance oracle, because the mode that makes the request safe is
     * the mode that removes the evidence the oracle reads.
     */
    producesQueryableActivity: false,
    suitableFor: Object.freeze([
      'request-shape validation: the v3 Mail Send request is parsed and validated by the ' +
        'real API',
      'credential-scope validation: the request reaches real API-key scope enforcement, so ' +
        'a key lacking mail.send is refused as it would be on a live send',
    ]),
    notSuitableFor: Object.freeze([
      'real-provider accepted-count evidence — a sandbox request returns 200 rather than ' +
        'the 202 a live accepted request returns, and is recorded nowhere',
      'the I36 six-kill-point oracle — every kill point needs provider-side evidence for a ' +
        'request the provider accepted, and this mode produces none',
      'Email Activity correlation — no Email Activity event is generated, so there is ' +
        'nothing for a correlation filter to match',
      'Event Webhook reconciliation — no Event Webhook event is generated',
    ]),
    reference: SG_SANDBOX,
    basis: DOCUMENTED,
  }),
  nonProductionValidationPath: Object.freeze({
    mechanism:
      'a DEDICATED NON-PRODUCTION SendGrid environment sending REAL requests with ' +
      'sandbox_mode=false to an owner-controlled sink recipient. The request is accepted ' +
      'normally (202), so it generates the Email Activity record the I36 oracle reads and ' +
      'the separate email_activity.read credential can observe independently',
    // FALSE, AND THAT IS THE CORRECTION. The safe mode and the evidence mode are different
    // modes at this provider, and only the second one can carry I36.
    sandboxModeEnabled: false,
    producesQueryableActivity: true,
    requiresControlledRecipient: true,
    requirements: Object.freeze([
      'a dedicated non-production SendGrid account, subuser or equivalently isolated test ' +
        'sending identity — never the production sending identity',
      'a narrowly scoped mail.send integration key for that identity',
      'a SEPARATE email_activity.read audit key that does not carry mail.send',
      'the additional Email Activity history entitlement the Email Activity Feed API ' +
        'requires',
      'a verified sender / test sending identity',
      'an OWNER-CONTROLLED SINK RECIPIENT. No customer recipient and no production ' +
        'business message, ever',
    ]),
    reference: SG_ACTIVITY_GUIDE,
    basis: DOCUMENTED,
  }),
  retentionAndEntitlement: Object.freeze({
    addOnRequired: true,
    detail:
      'the Email Activity Feed API requires purchased additional email activity history, ' +
      'purchased under Account Details > Your Products > Add-ons. The published guidance ' +
      'names a 30-day additional history tier, states that an API key must separately carry ' +
      'Email Activity permission, and states that the billing update takes time to ' +
      'propagate with a recommendation to wait 12 hours after purchase',
    reference: SG_ACTIVITY,
    basis: DOCUMENTED,
  }),
  findings: Object.freeze([
    Object.freeze({
      capability: 'CONTROL_SEND_ONLY_CREDENTIAL' as const,
      status: 'DOCUMENTED' as const,
      evidence:
        'a key created with scopes ["mail.send"] carries that permission and no other; the ' +
        'key type that customises permissions explicitly excludes billing',
      basis: DOCUMENTED,
      reference: SG_CREATE_KEY,
    }),
    Object.freeze({
      capability: 'AUDIT_READ_ONLY_CREDENTIAL' as const,
      status: 'DOCUMENTED' as const,
      evidence:
        'email_activity.read and mail.send are separate documented scope strings in ' +
        'separate permission groups, and the create endpoint takes the scope list ' +
        'explicitly, so a key may carry the first without the second',
      basis: DOCUMENTED,
      reference: SG_PERMISSIONS,
    }),
    Object.freeze({
      capability: 'PROVIDER_VISIBLE_CORRELATION' as const,
      status: 'DOCUMENTED' as const,
      evidence:
        'categories is settable on the v3 send and is a documented Email Activity filter ' +
        'field; custom_args is settable on the v3 send and unique_args is a documented ' +
        'Email Activity filter field with a published query form',
      basis: DOCUMENTED,
      reference: SG_CATEGORIES,
    }),
    Object.freeze({
      capability: 'QUERYABLE_PROVIDER_EVIDENCE' as const,
      status: 'DOCUMENTED' as const,
      evidence:
        'GET /v3/messages returns stored message records filtered by a documented query ' +
        'language over status and the listed fields, and GET /v3/messages/{msg_id} returns ' +
        'one message record',
      basis: DOCUMENTED,
      reference: SG_ACTIVITY,
    }),
    Object.freeze({
      capability: 'NON_PRODUCTION_TEST_PATH' as const,
      status: 'DOCUMENTED' as const,
      /*
       * **THE EVIDENCE IS THE DEDICATED NON-PRODUCTION ENVIRONMENT, NOT SANDBOX MODE.**
       *
       * The pre-correction row cited sandbox mode, which is documented to suppress both
       * evidence surfaces. A test path that cannot be observed is not a test path for `I36`,
       * so this row now cites the path `nonProductionValidationPath` declares, and
       * `evidencePathIncompatibility` is what stops a future edit quietly pointing it back
       * at the sandbox flag.
       */
      evidence:
        'a dedicated non-production sending identity with sandbox_mode=false and an ' +
        'owner-controlled sink recipient exercises the real API, real credential-scope ' +
        'enforcement AND leaves the Email Activity record the audit credential reads. ' +
        'Sandbox mode is NOT this path: it is documented to generate no Email Activity and ' +
        'no Event Webhook events',
      basis: DOCUMENTED,
      reference: SG_ACTIVITY_GUIDE,
    }),
  ]),
  /**
   * `§7` OF THE CORRECTION — WHAT THE DOCUMENTATION HAS ALREADY SETTLED, AS A NEGATIVE.
   *
   * Carried beside the pending list rather than inside it, because a resolved negative and
   * an open question are different facts and the pre-correction record conflated them.
   */
  resolvedDocumentedNegatives: Object.freeze([
    'SANDBOX_ACTIVITY_EVIDENCE = ABSENT — official Twilio SendGrid Sandbox Mode ' +
      'documentation states that requests made in sandbox mode generate no events in ' +
      'either the Event Webhook or Email Activity. This is no longer an account-validation ' +
      'question',
  ]),
  unresolvedAccountItems: Object.freeze([
    'CAPABILITY DOCUMENTED — ACCOUNT VALIDATION PENDING: whether the dedicated ' +
      'non-production account holds the additional Email Activity history entitlement the ' +
      'Email Activity Feed API requires, and which tier is the minimum sufficient one',
    'CAPABILITY DOCUMENTED — ACCOUNT VALIDATION PENDING: whether the provisioned ' +
      'mail.send key actually carries only that permission, read back from the account ' +
      'rather than assumed from the create request',
    'CAPABILITY DOCUMENTED — ACCOUNT VALIDATION PENDING: whether the provisioned ' +
      'email_activity.read audit key actually LACKS mail.send, read back from the account',
    'CAPABILITY DOCUMENTED — ACCOUNT VALIDATION PENDING: the EMPIRICAL attempted-write ' +
      'test required by 36 §13 and 48 §3.6 — POST /v3/mail/send with the ' +
      'email_activity.read-only key must be REFUSED BY SENDGRID. S1O selects on the ' +
      'documented scope model and does not claim this test has run',
    'CAPABILITY DOCUMENTED — ACCOUNT VALIDATION PENDING: whether provider evidence from a ' +
      'normal non-production send (sandbox_mode=false) is actually queryable through the ' +
      'Email Activity API on that account',
    'CAPABILITY DOCUMENTED — ACCOUNT VALIDATION PENDING: whether the chosen correlation ' +
      "field is present and queryable — whether v3 custom_args are returned by the Email " +
      "Activity unique_args['<name>'] filter. categories is the documented fallback and is " +
      'unambiguous on both sides',
    'CAPABILITY DOCUMENTED — ACCOUNT VALIDATION PENDING: whether the 6-requests-per-minute ' +
      'Email Activity rate limit is operationally sufficient for bounded six-kill-point ' +
      'observation',
    'CAPABILITY DOCUMENTED — ACCOUNT VALIDATION PENDING: whether the controlled ' +
      'recipient / test sending identity configuration is valid — a verified sender and an ' +
      'owner-controlled sink recipient, with no customer recipient reachable',
  ]),
});

// ---------------------------------------------------------------------------------
// MAILGUN — official Mailgun (Sinch) developer documentation.
// ---------------------------------------------------------------------------------

const MG_KEYS =
  'https://documentation.mailgun.com/docs/mailgun/api-reference/send/mailgun/keys/post-v1-keys';
const MG_RBAC =
  'https://documentation.mailgun.com/docs/mailgun/user-manual/api-key-mgmt/rbac-mgmt';
const MG_EVENTS =
  'https://documentation.mailgun.com/docs/mailgun/api-reference/send/mailgun/events/get-v3-domain_name-events';
const MG_LOGS =
  'https://documentation.mailgun.com/docs/mailgun/api-reference/send/mailgun/logs/post-v1-analytics-logs';

export const MAILGUN_CAPABILITY_RECORD: ProviderCapabilityRecord = Object.freeze({
  provider: 'mailgun',
  retrievedOn: RETRIEVED_ON,
  sendCredentialScope: Object.freeze({
    mechanism:
      'a Domain Sending Key — POST /v1/keys with kind "domain" and role "sending", ' +
      'documented as domain-scoped permissions for use only with a domain-kind key. The ' +
      'published guidance states such a key allows sending via POST on /messages and ' +
      '/messages.mime for the one domain',
    scope: Object.freeze(['POST /v3/{domain}/messages', 'POST /v3/{domain}/messages.mime']),
    excludesAccountAdministration: true,
    reference: MG_KEYS,
    basis: DOCUMENTED,
  }),
  auditReadCredentialScope: Object.freeze({
    mechanism:
      'POST /v1/keys with role "basic", documented as "basic aka analyst-level permissions ' +
      'on an API key". The RBAC permissions table gives the Analyst role Read on Messages, ' +
      'Logs and Metrics and No Access to Keys, Credentials and the suppression endpoints',
    scope: Object.freeze(['role=basic (analyst-level)']),
    // NOT `false`. The RBAC table is a role-to-endpoint-CATEGORY matrix. It has no Events
    // row at all, and the Events endpoint's own reference states no role requirement, so
    // the documentation does not establish that a basic-role key reaches the evidence.
    sendCapable: null,
    reference: MG_RBAC,
    basis: DOCUMENTED,
  }),
  attemptedWriteExpectation: Object.freeze({
    expected:
      'a send attempted with a basic-role key is expected to be refused, on the basis that ' +
      'the Analyst role carries Read and not Write on Messages',
    mechanism:
      'role-based endpoint-category permissions. The documentation states the role model ' +
      'and does not publish the endpoint-to-category mapping, so the expectation rests on ' +
      'a category name rather than on an endpoint rule',
    empiricallyTested: false,
    reference: MG_RBAC,
    basis: DOCUMENTED,
  }),
  activityQuery: Object.freeze({
    endpoints: Object.freeze(['GET /v3/{domain_name}/events', 'POST /v1/analytics/logs']),
    filterFields: Object.freeze([
      'begin',
      'end',
      'ascending',
      'limit',
      'event',
      'list',
      'attachment',
      'from',
      'message-id',
      'subject',
      'to',
      'size',
      'recipient',
      'recipients',
      'tags',
      'severity',
    ]),
    rateLimit: null,
    reference: MG_EVENTS,
    basis: DOCUMENTED,
  }),
  correlation: Object.freeze({
    sendField: 'o:tag',
    queryField: 'tags',
    queryable: true,
    limits:
      'the Events endpoint documents a tags filter and documents no filter over ' +
      'user-defined v: variables, so per-message ACOS correlation would have to travel as a ' +
      'tag. The Logs endpoint publishes one filter example and no complete attribute list',
    reference: MG_EVENTS,
    basis: DOCUMENTED,
  }),
  sandbox: Object.freeze({
    mechanism:
      'a sandbox domain, which sends only to authorised recipients registered on the ' +
      'account',
    /*
     * STILL `null`, AND THAT IS NOT THE SAME ANSWER AS SENDGRID'S.
     *
     * SendGrid's `false` is a DOCUMENTED NEGATIVE: its own page states the mode generates
     * no events. Mailgun's documentation says nothing either way about whether a sandbox
     * domain's sends appear in Events or Logs, so this is `UNRESOLVED` evidence and
     * collapsing it to `false` would be the guess `§24` forbids — the same distinction
     * `CAPABILITY_STATUSES` keeps between `ABSENT` and `UNRESOLVED`, one field down.
     *
     * Mailgun is blocked on `AUDIT_READ_ONLY_CREDENTIAL` regardless, so nothing turns on
     * this row today. It is kept honest so a later slice that obtains a Mailgun account
     * measures the right question.
     */
    producesQueryableActivity: null,
    suitableFor: Object.freeze([
      'delivery containment: a sandbox domain sends only to authorised recipients ' +
        'registered on the account',
    ]),
    notSuitableFor: Object.freeze([
      'the I36 six-kill-point oracle, while it is unresolved whether a sandbox domain ' +
        'produces Events or Logs records at all',
    ]),
    reference: MG_RBAC,
    basis: DOCUMENTED,
  }),
  nonProductionValidationPath: Object.freeze({
    mechanism:
      'a sandbox domain with authorised recipients, or a dedicated non-production domain ' +
      'with an owner-controlled sink recipient. Which of the two carries the evidence is ' +
      'NOT established by the published documentation',
    sandboxModeEnabled: true,
    // UNRESOLVED, not false. See `sandbox.producesQueryableActivity` above.
    producesQueryableActivity: null,
    requiresControlledRecipient: true,
    requirements: Object.freeze([
      'a domain-kind sending key scoped to the non-production domain',
      'a basic/analyst-level key whose Events and Logs access is confirmed against an ' +
        'account, because the published RBAC table does not establish it',
      'authorised recipients, or an owner-controlled sink recipient',
    ]),
    reference: MG_EVENTS,
    basis: DOCUMENTED,
  }),
  retentionAndEntitlement: Object.freeze({
    addOnRequired: false,
    detail:
      'neither the Events endpoint reference nor the Logs endpoint reference states a ' +
      'retention window, and neither states a plan entitlement for the read',
    reference: MG_LOGS,
    basis: DOCUMENTED,
  }),
  findings: Object.freeze([
    Object.freeze({
      capability: 'CONTROL_SEND_ONLY_CREDENTIAL' as const,
      status: 'DOCUMENTED' as const,
      evidence:
        'a domain-kind key with role "sending" is documented as domain-scoped and is ' +
        'published as the least-privilege choice for an application that only sends',
      basis: DOCUMENTED,
      reference: MG_KEYS,
    }),
    Object.freeze({
      capability: 'AUDIT_READ_ONLY_CREDENTIAL' as const,
      // THE DECIDING ROW. `§22`: "Do not infer Events access merely from the word Analyst.
      // If official endpoint/role mapping cannot establish it: mark Mailgun unresolved."
      status: 'UNRESOLVED' as const,
      evidence:
        'a basic/analyst-level key is creatable and the RBAC table gives Analyst Read on ' +
        'Logs and Messages, but the table carries NO Events row, the Events endpoint ' +
        'reference states no role requirement, and the Logs endpoint reference publishes no ' +
        'complete filter attribute list. The official endpoint-to-role mapping for the exact ' +
        'evidence ACOS needs is therefore not established either way',
      basis: DOCUMENTED,
      reference: MG_RBAC,
    }),
    Object.freeze({
      capability: 'PROVIDER_VISIBLE_CORRELATION' as const,
      status: 'DOCUMENTED' as const,
      evidence: 'the Events endpoint documents a tags filter over sender-supplied tags',
      basis: DOCUMENTED,
      reference: MG_EVENTS,
    }),
    Object.freeze({
      capability: 'QUERYABLE_PROVIDER_EVIDENCE' as const,
      status: 'DOCUMENTED' as const,
      evidence:
        'GET /v3/{domain}/events returns event records filtered by the listed parameters, ' +
        'up to 300 entries per page',
      basis: DOCUMENTED,
      reference: MG_EVENTS,
    }),
    Object.freeze({
      capability: 'NON_PRODUCTION_TEST_PATH' as const,
      status: 'DOCUMENTED' as const,
      evidence:
        'a sandbox domain restricts delivery to authorised recipients registered on the ' +
        'account',
      basis: DOCUMENTED,
      reference: MG_RBAC,
    }),
  ]),
  /** Mailgun has no documented negative to record. `§22`: unresolved is not absent. */
  resolvedDocumentedNegatives: Object.freeze([]),
  unresolvedAccountItems: Object.freeze([
    'UNRESOLVED FROM OFFICIAL DOCUMENTATION: whether a sandbox domain, or any Mailgun test ' +
      'path, produces Events or Logs records the audit credential could read — the ' +
      'test-path/evidence compatibility §5 requires is therefore not established',
    'UNRESOLVED FROM OFFICIAL DOCUMENTATION: whether a basic/analyst-level API key can call ' +
      'GET /v3/{domain}/events. The RBAC permissions table has no Events row and the Events ' +
      'endpoint reference states no role requirement',
    'UNRESOLVED FROM OFFICIAL DOCUMENTATION: whether POST /v1/analytics/logs under a ' +
      'basic-role key returns the accepted/delivered evidence ACOS needs, and over which ' +
      'filter attributes. The endpoint reference publishes one filter example and no ' +
      'complete attribute list',
    'UNRESOLVED FROM OFFICIAL DOCUMENTATION: the retention window of Events and Logs data',
  ]),
});

// ---------------------------------------------------------------------------------
// POSTMARK — carried forward from S1M. `§26`.
// ---------------------------------------------------------------------------------

const PM_TOKENS =
  'https://postmarkapp.com/support/article/1008-what-are-the-account-and-server-api-tokens';

/**
 * `§26` — POSTMARK IS CARRIED FORWARD AS **NOT SELECTED UNDER THE CURRENT CREDENTIAL
 * MODEL**, AND S1M'S EVIDENCE IS NOT DELETED.
 *
 * `tools/postmark-sandbox/capabilityRecord.ts` is untouched by S1O and remains the dated
 * S1M record. What this constant adds is the DISPOSITION, stated in S1O's own vocabulary so
 * the three providers can be compared in one table, and it agrees with S1M's own finding
 * rather than restating it more weakly:
 *
 *   "a server API token grants sending, sent-message inspection and the bounce API as one
 *    undivided capability [...] so every API credential able to read the outbound message
 *    log is also able to submit a send."
 *
 * **`I8` AND `36 §13` ARE NOT WEAKENED TO ACCOMMODATE IT.** `48 §3.6`'s exemption requires
 * "read-only, separately provisioned, and attempted-write-tested", and a Postmark audit
 * token PASSES the attempted write. That is a provider-selection finding, and S1O acts on
 * it by not selecting the provider — not by relaxing the obligation.
 */
export const POSTMARK_DISPOSITION = Object.freeze({
  provider: 'postmark',
  selected: false,
  disposition: 'NOT SELECTED UNDER CURRENT CREDENTIAL MODEL',
  reason:
    'the API credential capable of the required outbound-message query is also send-capable, ' +
    'so the audit attempted-write refusal required by 36 §13 and 48 §3.6 cannot be ' +
    'demonstrated. Read-only access exists only as a web-interface user role carrying no API ' +
    'token',
  architectureWeakened: false,
  s1mEvidenceRetained: true,
  s1mEvidencePath: 'tools/postmark-sandbox/capabilityRecord.ts',
  reference: PM_TOKENS,
  basis: DOCUMENTED,
});

// ---------------------------------------------------------------------------------
// THE DECISION.
// ---------------------------------------------------------------------------------

export const PROVIDER_CAPABILITY_RECORDS: readonly ProviderCapabilityRecord[] = Object.freeze([
  SENDGRID_CAPABILITY_RECORD,
  MAILGUN_CAPABILITY_RECORD,
]);

/**
 * `§19`'s conjunction, as a function. "**If any is absent: provider is not selected.**"
 *
 * A provider is selectable only when EVERY required capability is `DOCUMENTED`. `ABSENT` and
 * `UNRESOLVED` both block, and they block for different reasons that the caller is expected
 * to report differently — which is why this returns the blocking findings rather than a
 * boolean.
 */
export function blockingFindings(
  record: ProviderCapabilityRecord,
): readonly CapabilityFinding[] {
  const byCapability = new Map(record.findings.map((f) => [f.capability, f] as const));
  const blocking: CapabilityFinding[] = [];
  for (const capability of REQUIRED_CAPABILITIES) {
    const finding = byCapability.get(capability);
    if (finding === undefined) {
      // A capability with NO finding is not a pass. `§19` is a conjunction over a closed
      // list, and a missing row is the one shape a membership check would silently admit.
      blocking.push(
        Object.freeze({
          capability,
          status: 'UNRESOLVED' as const,
          evidence: 'no finding was recorded for this required capability',
          basis: DOCUMENTED,
          reference: '',
        }),
      );
      continue;
    }
    if (finding.status !== 'DOCUMENTED') blocking.push(finding);
  }
  return Object.freeze(blocking);
}

/**
 * `§5` OF THE CORRECTION — **THE TEST PATH AND THE EVIDENCE PATH MUST BE THE SAME PATH.**
 *
 * =================================================================================
 * WHY FIVE INDEPENDENT CAPABILITY CHECKS WERE NOT ENOUGH
 *
 * `blockingFindings` evaluates `§19`'s conjunction one capability at a time. Each term can
 * be true of a DIFFERENT configuration of the same provider, and the conjunction cannot
 * notice:
 *
 *     NON_PRODUCTION_TEST_PATH    true  — "the provider has a sandbox mode"
 *     QUERYABLE_PROVIDER_EVIDENCE true  — "the provider has an activity API"
 *     conjunction                 true
 *     reality                     the sandbox mode is documented to suppress the activity API
 *
 * That is not hypothetical: it is exactly what the first S1O candidate selected, and the
 * readiness token it produced named an environment in which the `I36` oracle cannot run.
 *
 * SO THE CHECK IS OVER ONE PATH, END TO END:
 *
 *     real API request
 *       -> the provider accepts/processes the request
 *       -> provider-side query/event evidence EXISTS for that request
 *       -> the independent AUDIT credential can observe it
 *
 * **A TEST MODE THAT DELIBERATELY SUPPRESSES THE EVIDENCE SURFACE DOES NOT SATISFY THE `I36`
 * VALIDATION PATH**, however convenient it is, and a provider whose only bounded mode is
 * that one is not selectable on it.
 *
 * Returns the REASON the declared path cannot carry `I36`, or `null` when it can. A reason
 * rather than a boolean because the three ways it fails are different facts: the path leaves
 * no evidence, the evidence is unresolved, or there is no independent credential to read it
 * with.
 */
export function evidencePathIncompatibility(record: ProviderCapabilityRecord): string | null {
  const path = record.nonProductionValidationPath;
  if (path.producesQueryableActivity === null) {
    return (
      `${record.provider}'s declared non-production validation path is not documented to ` +
      'produce queryable provider evidence either way, so the I36-compatible test path is ' +
      'UNRESOLVED rather than established'
    );
  }
  if (!path.producesQueryableActivity) {
    return (
      `${record.provider}'s declared non-production validation path produces no queryable ` +
      'provider evidence, so the same bounded design cannot carry both the real request and ' +
      'the I36 oracle'
    );
  }
  if (!path.requiresControlledRecipient) {
    return (
      `${record.provider}'s declared non-production validation path does not require an ` +
      'owner-controlled recipient, so it is not a BOUNDED non-production path'
    );
  }
  if (record.auditReadCredentialScope.sendCapable !== false) {
    return (
      `${record.provider}'s audit read credential is not documented as incapable of send, ` +
      'so the evidence this path leaves cannot be observed by an INDEPENDENT read-only ' +
      'credential'
    );
  }
  if (record.correlation.queryable !== true) {
    return (
      `${record.provider}'s correlation field is not documented as queryable, so evidence ` +
      "left by this path cannot be matched back to the ACOS request that produced it"
    );
  }
  /*
   * AND THE PROVIDER'S OWN SAFE-FLAG MODE IS CHECKED SEPARATELY, SO IT CANNOT BE SUBSTITUTED.
   *
   * A path declaring `sandboxModeEnabled: true` on a provider whose sandbox is DOCUMENTED to
   * suppress evidence is self-contradictory, and the contradiction is caught here rather
   * than trusted to the two fields being edited together.
   */
  if (path.sandboxModeEnabled && record.sandbox.producesQueryableActivity === false) {
    return (
      `${record.provider}'s declared validation path enables a sandbox mode the provider ` +
      'documents as producing no queryable activity; the safe mode and the evidence mode ' +
      'are different modes at this provider and only the second can carry I36'
    );
  }
  return null;
}

/**
 * `§19`'s conjunction AND `§5`'s compatibility rule. Both must hold.
 *
 * The capability conjunction alone is what admitted a provider on a test mode that cannot
 * produce the evidence, so `isSelectable` is deliberately not a synonym for "no blocking
 * findings" any more.
 */
export function isSelectable(record: ProviderCapabilityRecord): boolean {
  return blockingFindings(record).length === 0 && evidencePathIncompatibility(record) === null;
}

/**
 * `§23`'s DECISION RULE, as code rather than as a paragraph.
 *
 * "Select the provider with the strongest provable fit. Do NOT rank by: popularity; UI;
 * developer preference. [...] If SendGrid and Mailgun both satisfy everything: prefer the
 * one with the narrower independently provable credentials."
 *
 * So the function is a FILTER first and a comparison second, and the comparison operand is
 * the number of independently provable credential scopes — not a score, not a weighting and
 * not a name.
 */
export function selectProvider(
  records: readonly ProviderCapabilityRecord[],
): { readonly selected: ProviderCapabilityRecord | null; readonly reason: string } {
  const selectable = records.filter(isSelectable);
  if (selectable.length === 0) {
    return {
      selected: null,
      reason:
        "no provider satisfies §19 in full and §5's test-path/evidence compatibility rule; " +
        '§33 returns PARTIAL when no provider can satisfy the audit credential constraint',
    };
  }
  if (selectable.length === 1) {
    return {
      selected: selectable[0]!,
      reason:
        `${selectable[0]!.provider} is the only provider whose official documentation ` +
        'establishes all five required capabilities AND a non-production validation path ' +
        'compatible with its own provider-evidence path',
    };
  }
  // §23's tie-break: the narrower independently provable credentials. "Narrower" is the
  // SMALLER declared send scope, because that is the scope a compromise is bounded by.
  const narrowest = [...selectable].sort(
    (a, b) => a.sendCredentialScope.scope.length - b.sendCredentialScope.scope.length,
  )[0]!;
  return {
    selected: narrowest,
    reason:
      `${narrowest.provider} carries the narrower independently provable send credential ` +
      `(${String(narrowest.sendCredentialScope.scope.length)} declared scope entries)`,
  };
}
