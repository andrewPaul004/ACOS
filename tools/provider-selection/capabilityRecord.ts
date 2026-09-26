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
  /** `§19`: the non-production path. */
  readonly sandbox: {
    readonly mechanism: string;
    readonly producesQueryableActivity: boolean | null;
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
      'states the request is validated and "the email will never be delivered while this ' +
      'feature is enabled"; a valid sandbox request returns 200 where a live accepted ' +
      'request returns 202',
    // NOT `false`. The documentation says the message is never delivered and says NOTHING
    // about whether a sandbox request produces an Email Activity record, and the difference
    // between those two decides whether the six-kill-point oracle can run in sandbox mode.
    producesQueryableActivity: null,
    reference: SG_SANDBOX,
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
      evidence:
        'sandbox mode validates a send request without delivering it; the request reaches ' +
        'the real API and real credential-scope enforcement',
      basis: DOCUMENTED,
      reference: SG_SANDBOX,
    }),
  ]),
  unresolvedAccountItems: Object.freeze([
    'CAPABILITY DOCUMENTED — ACCOUNT VALIDATION PENDING: whether the intended sandbox/test ' +
      'account holds the additional email activity history entitlement the Email Activity ' +
      'Feed API requires, and which tier is the minimum sufficient one',
    'CAPABILITY DOCUMENTED — ACCOUNT VALIDATION PENDING: whether a sandbox-mode send ' +
      'produces a record the Email Activity query returns. The documentation states the ' +
      'message is never delivered and does not state whether it is recorded, and the six ' +
      'kill points need provider-side evidence for a send that was accepted. If it does ' +
      'not, the validation slice needs a dedicated non-production sending identity and a ' +
      'controlled sink recipient rather than sandbox mode',
    'CAPABILITY DOCUMENTED — ACCOUNT VALIDATION PENDING: the EMPIRICAL attempted-write ' +
      'test required by 36 §13 and 48 §3.6 — POST /v3/mail/send with the ' +
      'email_activity.read-only key must be refused BY THE PROVIDER. S1O selects on the ' +
      'documented scope model and does not claim this test has run',
    'CAPABILITY DOCUMENTED — ACCOUNT VALIDATION PENDING: whether v3 custom_args set on a ' +
      "send are returned by the Email Activity unique_args['<name>'] filter. The " +
      'documentation states the two serve the same function across API generations and does ' +
      'not state the query-side mapping directly. categories is the fallback correlation ' +
      'mechanism and is unambiguous on both sides',
    'CAPABILITY DOCUMENTED — ACCOUNT VALIDATION PENDING: whether the 6-requests-per-minute ' +
      'Email Activity rate limit admits the query volume the six-kill-point run needs',
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
    producesQueryableActivity: null,
    reference: MG_RBAC,
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
  unresolvedAccountItems: Object.freeze([
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

export function isSelectable(record: ProviderCapabilityRecord): boolean {
  return blockingFindings(record).length === 0;
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
        'no provider satisfies §19 in full; §33 returns PARTIAL when no provider can satisfy ' +
        'the audit credential constraint',
    };
  }
  if (selectable.length === 1) {
    return {
      selected: selectable[0]!,
      reason:
        `${selectable[0]!.provider} is the only provider whose official documentation ` +
        'establishes all five required capabilities',
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
