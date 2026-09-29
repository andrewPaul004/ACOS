import type { ProviderEvidenceRecord } from '../../src/audit/provider/protocol/readWire.js';
import type {
  AuditProviderReader,
  ProviderReadResult,
} from '../../src/audit/provider/runtime/auditProviderReader.js';
import { PROVIDER_READ_BOUNDARY } from '../../src/audit/provider/runtime/auditProviderReader.js';
import type { VerifiedCredentialScope } from '../../src/kernel/controlArtifacts/bundle.js';
import type {
  SendGridMailSendBody,
  SendGridSendInput,
} from '../../validation/sendgrid/integration/requestMapping.js';
import type { ValidationEmailPayload } from '../../validation/sendgrid/integration/validationPayload.js';
import type { SendGridReadResponse } from '../../validation/sendgrid/audit/activityRecords.js';
import type { Stage1Facts, Stage1Gate } from '../../validation/sendgrid/harness/preflight.js';
import type { EvidenceBundle } from '../../validation/sendgrid/harness/evidence.js';

/**
 * THE S1P NEGATIVE CONTROLS — THE IMPLEMENTATIONS THE SLICE REFUSED TO WRITE.
 *
 * =================================================================================
 * WHAT A NEGATIVE CONTROL IS FOR, IN THIS REPOSITORY
 *
 * A test that asserts a safe implementation is safe proves that the assertion and the
 * implementation agree. It does not prove the assertion could ever FAIL. Each function below
 * is the plausible unsafe version of one S1P control, and `sendgrid-controls.test.ts` runs
 * the SAME assertion against both: the real one passes, this one fails, and the difference is
 * what makes the control a control.
 *
 * **CONTROLS 9 TO 14 ARE THE DEFECTS THE INDEPENDENT REVIEW ACTUALLY FOUND**, written out as
 * the code that was there. They are the most valuable controls in the file for exactly that
 * reason: each one is a design a careful engineer shipped and defended in comments, so a test
 * that only discriminates an obviously-silly implementation would not have caught it.
 *
 * **NOTHING HERE IS IMPORTED BY ANY PRODUCTION OR VALIDATION MODULE.**
 * `tests/sendgrid/prerequisites-and-separation.test.ts` asserts the closures, and these are
 * test-only fixtures in the location `§18` reserves for them.
 * =================================================================================
 */

/**
 * CONTROL 1 — A MAPPING THAT HONOURS `sandboxMode` INSTEAD OF REFUSING IT.
 *
 * The plausible version: "sandbox mode is a configuration option, so the mapper should map
 * it." S1O's finding is why it is wrong — a sandbox request generates no Email Activity and
 * no Event Webhook event, so the flag silently removes the evidence `I36` reads while every
 * local assertion still passes.
 */
export function unsafeSandboxHonouringMapping(input: SendGridSendInput): SendGridMailSendBody {
  return {
    personalizations: [{ to: [{ email: input.authorised.sinkAddress }] }],
    from: { email: input.authorised.senderAddress },
    subject: input.authorised.subject,
    content: [{ type: 'text/plain', value: input.authorised.bodyText }],
    categories: [input.correlationTag],
    custom_args: { acos_correlation_tag: input.correlationTag },
    // THE DEFECT: the caller's flag reaches the provider.
    mail_settings: { sandbox_mode: { enable: input.sandboxMode as false } },
  };
}

/**
 * CONTROL 2 — A CLIENT WHOSE DESTINATION IS AN ARGUMENT.
 *
 * The plausible version: "one client, parameterised by path, so the audit read and the send
 * can share it." It is `§19`'s "generic arbitrary-HTTP escape hatch" with a narrower name:
 * once a destination is a parameter, every caller — and every message that reaches a caller —
 * is one validation away from choosing it.
 *
 * It performs NO request. The defect this control demonstrates is the SHAPE, and a fixture
 * that actually dialled a host would be a fixture that made the offline suite reach one.
 */
export function unsafeParameterisedDestination(input: {
  readonly origin: string;
  readonly path: string;
  readonly method: string;
}): string {
  return `${input.origin}${input.path}`;
}

/**
 * CONTROL 3 — AN OBSERVATION LOOP THAT CAN RESEND.
 *
 * The plausible version: "if the provider has not shown the message after N attempts, it was
 * probably never sent, so send it again." It is the exact defect `§8.4` names — "never treat
 * 'not visible yet' as permission to resend" — and it is plausible precisely because the
 * reading that justifies it feels like diligence.
 *
 * The DEPS SHAPE is the control: a deps object with a `send` member is a loop that can send,
 * whatever its body does today.
 */
export interface UnsafeResendingDeps {
  readonly read: () => Promise<{
    readonly kind: 'EVIDENCE';
    readonly records: readonly ProviderEvidenceRecord[];
    readonly recordCount: number;
  }>;
  /** THE DEFECT. The real `ObservationDeps` has no member of this shape. */
  readonly send: () => Promise<void>;
}

export async function unsafeResendingObservation(
  deps: UnsafeResendingDeps,
  attempts: number,
): Promise<{ readonly sends: number }> {
  let sends = 0;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const result = await deps.read();
    if (result.records.length > 0) break;
    // "Not visible yet" read as permission to resend.
    await deps.send();
    sends += 1;
  }
  return { sends };
}

/**
 * CONTROL 4 — A PREFLIGHT THAT TREATS AN UNESTABLISHED FACT AS SATISFIED.
 *
 * The plausible version: "only refuse on facts we positively measured as unsafe." It inverts
 * the default, so every gate a future edit forgets to populate becomes a gate that passes,
 * and the harness's refusals quietly become optional.
 */
export function unsafePermissivePreflight(facts: Stage1Facts): readonly Stage1Gate[] {
  const failures: Stage1Gate[] = [];
  if (facts.sandboxModeRequested) failures.push('SANDBOX_MODE_ENABLED');
  if (facts.recipientReachableFromProductionState) failures.push('PRODUCTION_TARGET_REACHABLE');
  // THE DEFECT: an absent credential, an absent class-5 record, an absent sink and an absent
  // acknowledgement all contribute NOTHING to the failure list.
  return failures;
}

/**
 * CONTROL 5 — A SECRET SOURCE THAT ACCEPTS A FIXTURE IDENTITY FOR A LIVE CREDENTIAL.
 *
 * The plausible version: "the provenance enum already has three members, so all three are
 * admissible." `§3` is why it is wrong: `SYNTHETIC_TEST_IDENTITY` means a test wrote the
 * string into a file, and a live provider run resting on it rests on a label rather than on a
 * binding to material.
 */
export function unsafeProvenanceAcceptsFixture(provenance: string): boolean {
  return ['PROVIDER_KEY_ID', 'DEPLOYMENT_SECRET_VERSION', 'SYNTHETIC_TEST_IDENTITY'].includes(
    provenance,
  );
}

/**
 * CONTROL 6 — AN AUDIT READER THAT GAINED A SEND MEMBER.
 *
 * The plausible version: "`36 §13` needs an attempted write, so the reader needs a way to
 * attempt one." `§8.2` forbids exactly that: the probe must not become a normal audit
 * capability. This reader satisfies the `AuditProviderReader` interface STRUCTURALLY —
 * TypeScript admits extra members — which is why the accepted host checks the shape at
 * runtime.
 */
export const unsafeSendCapableAuditReader = {
  providerId: 'twilio_sendgrid',
  boundary: PROVIDER_READ_BOUNDARY,
  readFromProvider: (): Promise<{ readonly kind: 'PROVIDER_UNAVAILABLE' }> =>
    Promise.resolve({ kind: 'PROVIDER_UNAVAILABLE' }),
  /** THE DEFECT. */
  send: (): Promise<void> => Promise.resolve(),
} as unknown as AuditProviderReader;

/**
 * CONTROL 7 — AN EVIDENCE RENDERER THAT REDACTS INSTEAD OF REFUSING.
 *
 * The plausible version: "scrub the secret and carry on." It is worse than it looks: a
 * pipeline that put a key into the bundle is a pipeline whose NEXT member is unfiltered, and
 * a redactor turns that defect into a silent one. `§16`'s prohibition is about what the
 * bundle CAN contain, and the real renderer throws.
 */
export function unsafeRedactingRenderer(bundle: EvidenceBundle): string {
  return JSON.stringify(bundle).replace(/SG\.[A-Za-z0-9_-]{10,}/g, '<redacted>');
}

/**
 * CONTROL 8 — A NORMALISER THAT ECHOES THE REQUESTED TAG ONTO EVERY RECORD.
 *
 * The plausible version: "we asked for this tag, so every record we got back is about it."
 * It makes the correlation self-fulfilling — the matcher writes the value it then compares —
 * so a period-bounded read of an account's ordinary traffic would report every message as the
 * scenario's own accepted message, and `I36`'s oracle would count the account's volume.
 */
export function unsafeSelfFulfillingNormalisation(
  records: readonly { readonly providerMessageId: string }[],
  requestedTag: string,
): readonly ProviderEvidenceRecord[] {
  return records.map((record) => ({
    providerMessageId: record.providerMessageId,
    providerStatus: 'delivered',
    providerTimestampMs: 0,
    // THE DEFECT: the tag comes from the QUESTION, not from the provider's answer.
    correlationTag: requestedTag,
  }));
}

// =====================================================================================
// CONTROLS 9 TO 14 — THE DEFECTS THE INDEPENDENT REVIEW FOUND IN THE REJECTED S1P.
// =====================================================================================

/**
 * CONTROL 9 — AN ADAPTER THAT TAKES ITS RECIPIENT FROM LAUNCH CONFIGURATION.
 *
 * **THIS WAS THE SHIPPED DESIGN, AND ITS COMMENT ARGUED THAT IT WAS SAFER**:
 *
 *     "A recipient that arrives in the dispatch payload is a recipient an upstream defect can
 *      make a customer. A recipient that arrives in this runtime's launch configuration is one
 *      the OWNER wrote into the deployment boundary, and no value on any wire can change it."
 *
 * The argument is seductive and it is wrong, because it trades the wrong thing away. What it
 * buys is protection against an upstream defect choosing a recipient; what it SPENDS is the
 * entire meaning of `dispatch_payload_hash`. With the recipient in configuration, the chain
 *
 *     authorisation_ref -> dispatch_payload_hash -> the actual provider request
 *
 * verifies at every step and constrains nothing at the last one: editing one JSON file on the
 * deployment host redirects the effect while every hash still matches.
 *
 * The real protection lives where it can be kept without that cost — at AUTHORISATION, in the
 * validation seeder, which refuses a sink that is not owner-controlled before an effect exists.
 *
 * This function takes BOTH the authorised payload and a configured sink, and follows the
 * CONFIGURATION. `sendgrid-controls.test.ts` runs both against one authorised payload and two
 * different launch configurations: the real mapping produces the same recipient twice, this
 * one follows the document.
 */
export function unsafeConfigurationFollowingRecipient(input: {
  readonly authorised: ValidationEmailPayload;
  readonly configuredSinkAddress: string;
  readonly configuredSenderAddress: string;
  readonly correlationTag: string;
}): SendGridMailSendBody {
  return {
    // THE DEFECT: the AUTHORISED sink is ignored and the CONFIGURED one is addressed.
    personalizations: [{ to: [{ email: input.configuredSinkAddress }] }],
    from: { email: input.configuredSenderAddress },
    subject: `ACOS S1P NON-PRODUCTION VALIDATION ${input.correlationTag}`,
    content: [{ type: 'text/plain', value: input.correlationTag }],
    categories: [input.correlationTag],
    custom_args: { acos_correlation_tag: input.correlationTag },
    mail_settings: { sandbox_mode: { enable: false } },
  };
}

/**
 * CONTROL 10 — A READ MAPPING THAT TURNS A REFUSED QUERY INTO A COUNT OF ZERO.
 *
 * **THIS WAS THE SHIPPED DESIGN, AND ITS COMMENT CALLED IT HONEST**:
 *
 *     "The evidence a non-OK read yields is therefore an HONEST EMPTY: zero records, count
 *      zero."
 *
 * It is not honest. A 403 says the credential may not ask the question; answering "there were
 * none" is a claim about the ACCOUNT that no read supports. And the consequence is not
 * cosmetic: `I36`'s oracle IS a provider-side count, so a row whose count is zero because the
 * read was refused is indistinguishable from a row whose count is zero because nothing was
 * sent — which is the one discrimination the whole slice exists to make.
 */
export function unsafeNonOkBecomesEvidence(response: SendGridReadResponse): ProviderReadResult {
  if (response.kind === 'NOT_REACHED') return { kind: 'PROVIDER_UNAVAILABLE' };
  if (response.kind === 'ANSWERED') {
    return { kind: 'EVIDENCE', records: response.records, recordCount: response.records.length };
  }
  // THE DEFECT: a refused or unreadable answer becomes evidence of an empty account.
  return { kind: 'EVIDENCE', records: [], recordCount: 0 };
}

/**
 * CONTROL 11 — AN OBSERVATION LOOP THAT STOPS AT THE FIRST SIGHTING.
 *
 * **THIS WAS THE SHIPPED DESIGN, AND ITS COMMENT ADMITTED THE CONSEQUENCE**:
 *
 *     "It means `providerAcceptedCount` is the count AT THE MOMENT THE TAG FIRST BECAME
 *      VISIBLE, and a duplicate that appeared later would not be seen by THIS loop."
 *
 * Admitting a limitation is not the same as not having it. Email Activity is eventually
 * consistent, so two messages accepted moments apart do not become visible together — and a
 * loop that returns on the first sighting answers "were there two?" with "I saw one", every
 * time. It would report `providerAcceptedCount: 1` for a genuine duplicate: the oracle passes
 * the exact condition it exists to exclude.
 */
export async function unsafeStopOnFirstObservation(
  read: () => Promise<{ readonly messageIds: readonly string[] }>,
  attempts: number,
): Promise<{ readonly providerAcceptedCount: number; readonly reads: number }> {
  const seen = new Set<string>();
  let reads = 0;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const result = await read();
    reads += 1;
    for (const id of result.messageIds) seen.add(id);
    // THE DEFECT: the first sighting ends the observation, so a later second message is
    // never counted.
    if (seen.size > 0) break;
  }
  return { providerAcceptedCount: seen.size, reads };
}

/**
 * CONTROL 12 — A HARNESS THAT FINDS ITS CREDENTIAL BY SCANNING FOR AN ADAPTER.
 *
 * **THIS WAS THE SHIPPED DESIGN**: iterate every signed class-5 record, and keep whichever one
 * mentions the adapter. With one matching record it is indistinguishable from correct; with
 * two it silently selects the LAST one the iteration happened to reach, which is a property of
 * the artifact's key order rather than of anybody's intent.
 *
 * The plausible defence is "there is only one SendGrid credential." That is a fact about
 * today's artifact, not a property of the mechanism, and `50 §2g` places no cardinality bound
 * on records per adapter.
 */
export function unsafeLastMatchingCredential(
  credentials: Readonly<Record<string, VerifiedCredentialScope>>,
  adapter: string,
): string | null {
  let selected: string | null = null;
  for (const [credentialId, scope] of Object.entries(credentials)) {
    // THE DEFECT: no `break`, and no configured expectation to select by.
    if (scope.adapter === adapter) selected = credentialId;
  }
  return selected;
}

/**
 * CONTROL 13 — A RUN THAT RESOLVES BOTH CREDENTIALS BEFORE IT EVALUATES ITS GATES.
 *
 * **THIS WAS THE SHIPPED DESIGN, AND THE COMMENT BESIDE IT DESCRIBED THE OPPOSITE**:
 *
 *     "The credentials are resolved below, in `main`, and only after the cheap gates have been
 *      evaluated — a run that is going to refuse on its configuration should not have touched
 *      a secret source at all."
 *
 * `main` in fact called `withResolvedCredentials(establishFacts(...))` and evaluated the gate
 * afterwards. Both vendor deployment documents were read on every invocation, including the
 * invocations that were always going to refuse for want of an acknowledgement.
 *
 * The control RECORDS ITS ORDER rather than performing I/O, so the discrimination is the
 * sequence itself: the corrected harness never reaches `resolve` when a gate fails.
 */
export async function unsafeResolveThenGate(input: {
  readonly resolve: () => Promise<void>;
  readonly evaluate: () => readonly string[];
  readonly trace: string[];
}): Promise<readonly string[]> {
  // THE DEFECT: the resolution happens unconditionally, before anything is evaluated.
  input.trace.push('RESOLVE');
  await input.resolve();
  input.trace.push('EVALUATE');
  return input.evaluate();
}

/**
 * CONTROL 14 — A PRODUCTION STATEMENT THAT IS A CONSTANT.
 *
 * **THIS WAS THE SHIPPED SENTENCE**, written into EVERY evidence bundle including the ones
 * produced by runs that refused before touching anything:
 *
 *     "PRODUCTION SENDGRID WAS NOT ENABLED. This run used a dedicated non-production sending
 *      identity with sandbox_mode=false and an owner-controlled sink recipient."
 *
 * The first sentence was true. The second was false on every run that had ever happened, and
 * it is the one a reviewer would act on.
 */
export const UNSAFE_STATIC_PRODUCTION_STATEMENT =
  'PRODUCTION SENDGRID WAS NOT ENABLED. This run used a dedicated non-production sending ' +
  'identity with sandbox_mode=false and an owner-controlled sink recipient. No customer ' +
  'recipient was addressable: the recipient is launch configuration and no dispatch field ' +
  'can carry one. No production business message was sent.';
