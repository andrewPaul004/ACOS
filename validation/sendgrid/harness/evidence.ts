import { createHash } from 'node:crypto';

import type { ObservationResult } from './observation.js';
import type { ProbeRecord } from './probeResult.js';
import type { I20Comparison } from './i20.js';
import type { PreflightGate, ProviderEvidenceMode, Stage1Gate, Stage2Gate } from './preflight.js';
import type { VisibilityBoundKind } from './visibilityBound.js';
import { KILL_POINT_CONCLUSION_LIMITS } from './killPoints.js';

/**
 * `§16` — THE SANITIZED EVIDENCE BUNDLE.
 *
 * =================================================================================
 * THE REDACTION IS STRUCTURAL FIRST AND A FILTER SECOND
 *
 * `§16` lists what a bundle must NOT contain: API secrets, authorization headers, secret
 * hashes or fingerprints masquerading as IDs, raw environment dumps, unnecessary personal
 * information, full customer-like message content.
 *
 * The FIRST defence is that most of those have nowhere to go. `EvidenceBundle`'s members are
 * hand-enumerated, none of them is `unknown`, none is a free record, and the pipeline that
 * fills them reads from types that already exclude the material: `ProbeRecord` carries a
 * credential IDENTITY and an HTTP status, `ObservationResult` carries provider message ids
 * and counts, and `ProviderEvidenceRecord` has no member a recipient address could occupy.
 *
 * The SECOND defence is `redactAddress`, for the two places an address legitimately appears —
 * the configured sender and the owner-controlled sink — because `§16` wants the sink
 * "represented safely/redacted" rather than absent: a reviewer has to be able to tell that
 * the run used A sink without the bundle publishing WHICH mailbox.
 *
 * And `assertNoSecretShapes` is the third: a scan of the SERIALISED bundle for the shapes a
 * SendGrid key and an Authorization header take. It is a belt over braces and it is not the
 * control — a denylist never is — but it is the one that fires if a future member carries
 * something the type system was happy with.
 *
 * =================================================================================
 * `§16`'s LAST LINE, HONOURED EXPLICITLY
 *
 * "If you create a local evidence hash, do not claim that this closes I17b external
 * anchoring." `bundleDigest` exists so two copies of a bundle can be compared, and
 * `I17B_STATUS` is carried INSIDE the bundle saying exactly that, so the disclaimer travels
 * with the artifact rather than living in a document beside it.
 * =================================================================================
 */

/** Carried in every bundle. `§16`: a local hash anchors nothing outside this repository. */
export const I17B_STATUS =
  'I17b REMAINS OPEN. bundleDigest is a LOCAL digest computed by the same process that ' +
  'produced this bundle, and it establishes only that two copies of this file are the same ' +
  'bytes. It is not an external anchor, it is not witnessed by any party outside this ' +
  'repository, and nothing in S1P closes I17b.';

/**
 * `§8` OF THE S1P CORRECTION MANDATE — **EVIDENCE MUST DESCRIBE WHAT ACTUALLY HAPPENED.**
 *
 * =================================================================================
 * THE DEFECT: A STATIC SENTENCE THAT WAS FALSE ON EVERY RUN THAT HAD EVER HAPPENED
 *
 * The rejected bundle carried a CONSTANT called `PRODUCTION_DISABLED_STATEMENT` reading:
 * "This run used a dedicated non-production sending identity with sandbox_mode=false and an
 * owner-controlled sink recipient." It was written into EVERY bundle — including the bundles
 * this repository actually produced, where the preflight refused, no account existed, no
 * sender existed and no provider call was made.
 *
 * The review: "That is false evidence." It is, and the failure mode is the one evidence
 * exists to prevent: a reviewer reading the artifact would conclude that a non-production
 * environment had been exercised, when nothing had been exercised at all.
 *
 * =================================================================================
 * THE REPLACEMENT: THE STATEMENT IS **COMPUTED FROM RUN STATE**
 *
 * `productionStatementFor` takes the facts the run actually established and emits only
 * sentences those facts support. The two shapes are structurally different, not differently
 * worded:
 *
 *   OFFLINE / REFUSED   states what did NOT happen — no provider call, production SendGrid
 *                       not enabled by this run — and names the gates that refused. It makes
 *                       NO claim about an environment, a sender or a sink, because a run that
 *                       refused before resolving a credential used none of them.
 *   LIVE                may say a dedicated non-production environment was declared and used,
 *                       name the redacted sender and sink, and record `sandbox_mode=false` —
 *                       and only after `liveRunPerformed` is true, which only a completed
 *                       provider operation sets.
 *
 * `tests/sendgrid/evidence-and-kill-points.test.ts` asserts the property directly: an offline
 * bundle contains NO sentence claiming a live environment was used, checked against the
 * forbidden phrases rather than against the expected one — a positive assertion would pass on
 * a bundle that said both.
 * =================================================================================
 */
export const LIVE_ENVIRONMENT_CLAIM_PHRASES: readonly string[] = Object.freeze([
  'used a dedicated non-production sending identity',
  'was used',
  'were used',
  'the sink received',
  'the provider accepted',
]);

/** The facts a production statement may be derived from. Every one is measured, none assumed. */
export interface ProductionStatementFacts {
  /** Whether ANY provider operation was performed by this run. */
  readonly liveRunPerformed: boolean;
  /** Whether the operator's explicit dedicated-non-production acknowledgement was present. */
  readonly nonProductionAcknowledged: boolean;
  /** How many preflight gates refused. */
  readonly refusedGateCount: number;
  /** The redacted sender and sink, when the run actually used them. */
  readonly senderRedacted: string | null;
  readonly sinkRedacted: string | null;
  /** How many provider operations the run performed. `0` on every offline run. */
  readonly providerOperationCount: number;
}

/** Derive the production statement from what the run established. NEVER a constant. */
export function productionStatementFor(facts: ProductionStatementFacts): string {
  if (!facts.liveRunPerformed) {
    /*
     * ONLY FACTS THAT AN OFFLINE RUN ACTUALLY ESTABLISHED.
     *
     * "No provider call was made" is observable from this process. "Production SendGrid was
     * not enabled BY THIS RUN" is a statement about this run and not about the account. The
     * gate count is measured. Nothing here says an environment, a sender or a sink existed,
     * because a refused run did not establish that any of them did.
     */
    return (
      'NO PROVIDER CALL WAS MADE BY THIS RUN. Production SendGrid was not enabled by this ' +
      'run. The live non-production prerequisites were not all established: ' +
      `${String(facts.refusedGateCount)} preflight gate(s) refused` +
      (facts.nonProductionAcknowledged
        ? ' (the dedicated non-production acknowledgement WAS present).'
        : ', and the dedicated non-production acknowledgement was absent.') +
      ' This artifact makes no claim that any sending environment, sender identity or sink ' +
      'mailbox was exercised, because none was.'
    );
  }
  return (
    'A LIVE NON-PRODUCTION RUN WAS PERFORMED. The operator declared a dedicated ' +
    'non-production sending identity and this run used it. sandbox_mode was false on every ' +
    `request. ${String(facts.providerOperationCount)} provider operation(s) were performed, ` +
    `from sender ${facts.senderRedacted ?? '<none recorded>'} to the owner-controlled sink ` +
    `${facts.sinkRedacted ?? '<none recorded>'}. No customer recipient was addressable: the ` +
    'recipient is bound into the authorised dispatch payload by the isolated S1P validation ' +
    'seeder, which refuses a sink that is not owner-controlled and which no production route ' +
    'reaches. No production business message was sent.'
  );
}

/**
 * Represent an address safely. `§16`: the sink is "represented safely/redacted".
 *
 * The domain is kept because it is what tells a reviewer the run went to the owner's own
 * domain rather than to a customer's, and the local part is reduced to its first character
 * plus a length — enough to distinguish two configured sinks, not enough to address one.
 */
export function redactAddress(address: string): string {
  const at = address.lastIndexOf('@');
  if (at <= 0) return '<redacted>';
  const local = address.slice(0, at);
  const domain = address.slice(at + 1);
  return `${local.slice(0, 1)}***(${String(local.length)})@${domain}`;
}

/** One kill-point scenario's measured row. Expectation and observation, side by side. */
export interface KillPointEvidence {
  readonly point: number;
  readonly killPointName: string;
  readonly correlationTag: string;
  /** The canonical expectation, copied from `KILL_POINT_ROWS`. */
  readonly expectedSemantics: string;
  /** The committed outbox status after the kill, read from the control store. */
  readonly localOutboxStatus: string | null;
  /** Committed `dispatch_outcome` rows after the kill. */
  readonly localOutcomeRows: number | null;
  /**
   * `§9` item 12 — WHETHER THE INVOCATION MAY HAVE CROSSED THE PROVIDER BOUNDARY.
   *
   * The adapter's own `markProviderClientCrossed` answer, as the host classified it. It is
   * the local half of the question the provider read answers independently, and the two are
   * recorded separately BECAUSE they can disagree — a disagreement is the finding.
   */
  readonly mayHaveCrossedProviderBoundary: boolean | null;
  /** The provider's own message id from the send response, where one was observed. */
  readonly providerResponseMessageId: string | null;
  /** What the bounded observation concluded. */
  readonly observation: ObservationResult | null;
  /** `§10`'s oracle operand, restated at the top level for a reviewer's convenience. */
  readonly providerAcceptedCount: number | null;
  /** What the recovery attempt did. `CLAIM_REFUSED:<reason>` or the resolution kind. */
  readonly recovery: string | null;
  /** Whether a redispatch of the CLAIMED effect occurred. MUST be `false` on every row. */
  readonly redispatchOccurred: boolean | null;
  /** The effect's ACOS state at the end of the scenario. */
  readonly finalEffectState: string | null;
  readonly verdict: 'PASS' | 'FAIL' | 'UNRESOLVED' | 'NOT_RUN';
  readonly note: string;
}

/** A requirement the selected evidence mode does not have. Stated, never filled with a value. */
export const NOT_APPLICABLE = 'NOT_APPLICABLE' as const;

/**
 * v1.3.8 — WHAT THE RUN'S PROVIDER-EVIDENCE MODE MADE APPLICABLE, DISCRIMINATED BY THE MODE.
 *
 * The mode is the VERIFIED class-28 record's, read in stage 1. Under `SIGNED_PROVIDER_PUSH`
 * every SendGrid audit-read item is the literal `NOT_APPLICABLE` — there is no audit credential
 * identity, audit principal, audit send refusal, Email Activity entitlement, Email Activity read
 * or provider-read inverse sweep to report, and the bundle does not manufacture one. `UNDECLARED`
 * is a run whose verified record named no channel; the preflight refused it.
 */
export type ProviderEvidenceSection =
  | {
      readonly mode: 'PROVIDER_READ';
      readonly evidenceSource: 'PROVIDER_EMAIL_ACTIVITY_READ';
      readonly auditReadCredential: 'REQUIRED';
      readonly emailActivityEntitlement: 'OPERATOR_CONFIRMED' | 'NOT_CONFIRMED';
      readonly inverseSweep: 'PROVIDER_READ_SWEEP';
    }
  | {
      readonly mode: 'SIGNED_PROVIDER_PUSH';
      readonly evidenceSource: 'AUDIT_STORE_AUTHENTICATED_PUSH';
      readonly auditReadCredential: typeof NOT_APPLICABLE;
      readonly auditPrincipal: typeof NOT_APPLICABLE;
      readonly auditKeySendRefusal: typeof NOT_APPLICABLE;
      readonly emailActivityEntitlement: typeof NOT_APPLICABLE;
      readonly emailActivityRead: typeof NOT_APPLICABLE;
      readonly providerReadInverseSweep: typeof NOT_APPLICABLE;
      readonly inverseObservation: 'AUDIT_STORE_PUSH_INVERSE_OBSERVATION';
      /** ADR-027 decision 6: authentication is not completeness. */
      readonly completenessBasis: 'UNESTABLISHED';
      /** Obligations no automated or offline step can discharge. Each is stated, none assumed. */
      readonly openEmpiricalObligations: readonly string[];
    }
  | {
      readonly mode: 'UNDECLARED';
      readonly statement: string;
    };

export interface EvidenceBundle {
  readonly schema: 'acos.s1p.sendgrid-validation-evidence.v2';
  /** `§16`: architecture/package version. */
  readonly operatingSpine: string;
  readonly packageIssue: string;
  /** `§16`: the git commit/tree identifier used for the run. */
  readonly gitCommit: string;
  readonly validationRunId: string;
  readonly startedAtUtc: string;
  readonly finishedAtUtc: string;
  /** `§16`: the non-production environment identifier, if safely non-secret. */
  readonly environmentLabel: string | null;
  readonly providerId: string;

  /**
   * v1.3.8 — THE PROVIDER-EVIDENCE MODE, FROM THE VERIFIED CLASS-28 RECORD, or `null` when no
   * verified record named one. Never from a flag, an environment variable or a default.
   */
  readonly providerEvidenceMode: ProviderEvidenceMode | null;
  /** What that mode made applicable, with every inapplicable item stated as such. */
  readonly providerEvidence: ProviderEvidenceSection;

  /**
   * `§16`: the stable non-secret credential identities. NEVER the material. The audit identity
   * is `null` under `SIGNED_PROVIDER_PUSH`, where `providerEvidence` states it NOT_APPLICABLE.
   */
  readonly integrationCredentialIdentity: string | null;
  readonly auditCredentialIdentity: string | null;
  /**
   * `§16`: proof the identities matched signed class-5 expectations. The audit member is `null`
   * — not `false`, not `true` — under `SIGNED_PROVIDER_PUSH`: there is no audit record to match.
   */
  readonly integrationIdentityMatchedSignedRecord: boolean;
  readonly auditIdentityMatchedSignedRecord: boolean | null;

  /** `§16`: the sink, represented safely. */
  readonly senderRedacted: string | null;
  readonly sinkRedacted: string | null;

  /**
   * Every preflight gate that refused, BY STAGE — `§4`.
   *
   * The split is evidence in its own right: a bundle whose `stage2Failures` is empty AND
   * whose `stage1Failures` is not is a bundle from a run that NEVER RESOLVED A CREDENTIAL,
   * and `credentialsTouched` below says so explicitly rather than leaving a reader to infer
   * it from an absence.
   */
  readonly stage1Failures: readonly Stage1Gate[];
  readonly stage2Failures: readonly Stage2Gate[];
  /** The union, for a reader who wants one list. Derived, never authored separately. */
  readonly preflightFailures: readonly PreflightGate[];
  /**
   * `§4.1` — WHETHER ANY CREDENTIAL SOURCE WAS TOUCHED BY THIS RUN.
   *
   * `false` whenever stage 1 refused: no one-shot credential process was started, so no
   * deployment document was read and no material was resolved anywhere.
   */
  readonly credentialsTouched: boolean;
  readonly liveRunPerformed: boolean;
  /** How many provider operations this run performed. `0` on every offline run. */
  readonly providerOperationCount: number;

  /** `§8.7` / `§16`: the capability probes, as measured. */
  readonly probes: readonly ProbeRecord[];
  /** `§16`: the audit-key send-refusal result, restated so it cannot be overlooked. */
  readonly auditKeySendRefusal: ProbeRecord | null;

  /**
   * SECOND REVIEW `§4.4` — **WHICH SETTLING REGIME THE OBSERVATIONS RAN UNDER.**
   *
   * `§4.4`: offline fixture mode "may still use deterministic fixture timing but must be
   * labeled offline evidence." A bundle that reported provider counts without saying how
   * their finality was established would let a reviewer read a deterministic simulation as a
   * provider guarantee — which is precisely the confusion defect 4 was raised about.
   *
   * `observationModeLabel` produces the sentence, so the three regimes cannot be described
   * inconsistently in different bundles, and `visibilityBoundKind` carries the same fact in a
   * form a machine can filter on.
   */
  readonly observationMode: string;
  readonly visibilityBoundKind: VisibilityBoundKind;

  readonly killPoints: readonly KillPointEvidence[];
  /** `§11`: the duplicate negative control. */
  readonly duplicateControl: {
    readonly status: 'RUN' | 'NOT_RUN';
    readonly reason: string;
    readonly observedAcceptedCount: number | null;
    readonly oracleDiscriminatedDuplicate: boolean | null;
  };

  /** `§14`: the I20 comparison, as computed. `null` when no scenario ran at all. */
  readonly i20: I20Comparison | null;

  /** `§13`: the three invariant conclusions, stated separately and without rounding. */
  readonly invariantConclusions: {
    readonly i8: string;
    readonly i20: string;
    readonly i36: string;
  };
  readonly unresolvedObservations: readonly string[];
  readonly conclusionLimits: readonly string[];
  readonly i17bStatus: string;
  readonly productionStatement: string;
}

/** The shapes a SendGrid secret and an auth header take. A LAST-RESORT scan, never the control. */
const SECRET_SHAPES: readonly RegExp[] = Object.freeze([
  /SG\.[A-Za-z0-9_-]{10,}/,
  /\bBearer\s+\S+/i,
  /"authorization"\s*:/i,
]);

/**
 * Scan a serialised bundle for secret shapes. Returns the patterns that matched.
 *
 * `§16`'s prohibitions are enforced FIRST by the bundle's closed member list; this is the
 * check that fires when a future member carries something the type system permitted. A
 * non-empty result is a defect in the pipeline, not something to redact and continue from,
 * so `renderEvidenceBundle` throws on it rather than filtering.
 */
export function detectSecretShapes(serialised: string): readonly string[] {
  return Object.freeze(
    SECRET_SHAPES.filter((pattern) => pattern.test(serialised)).map((pattern) => String(pattern)),
  );
}

/**
 * `I20`'s RESERVATION BASIS IS A `bigint`, AND `JSON.stringify` THROWS ON ONE.
 *
 * =================================================================================
 * THIS REPLACER EXISTS BECAUSE THE CODE PATH THAT NEEDS IT WAS UNREACHABLE
 *
 * `irrecoverable_units` is a `NUMERIC` column read as an exact integer, so it is carried as a
 * `bigint` all the way from `reservation_window_instance` into `I20Comparison` — the whole
 * point being that an exposure figure must never pass through a float. `JSON.stringify` has
 * no representation for one and throws `TypeError: Do not know how to serialize a BigInt`.
 *
 * Nothing had noticed, because until the second review's blocker 1 was fixed the CLI could
 * never produce a non-null `i20`: it reported `null` on every run, so a bundle carrying a
 * real comparison had never been rendered. Wiring the entry point to the driver is what
 * surfaced it.
 *
 * **A DECIMAL STRING, NOT A `number`.** `Number(9007199254740993n)` is silently wrong, and an
 * exposure unit that a reader cannot trust is worse than one they cannot parse. Every JSON
 * consumer can read a decimal string exactly.
 */
function bigintSafe(_key: string, value: unknown): unknown {
  return typeof value === 'bigint' ? value.toString(10) : value;
}

/** Serialise a bundle, refusing to emit one that carries a secret shape. */
export function renderEvidenceBundle(bundle: EvidenceBundle): string {
  const serialised = JSON.stringify(
    { ...bundle, conclusionLimits: KILL_POINT_CONCLUSION_LIMITS },
    bigintSafe,
    2,
  );
  const offenders = detectSecretShapes(serialised);
  if (offenders.length > 0) {
    /*
     * A THROW, NOT A REDACTION.
     *
     * Redacting here would mean the bundle was produced by a pipeline that put a secret in
     * it and a filter took it out, which is a pipeline whose next member is unfiltered.
     * `§16` is a property of what the bundle CAN contain; a violation is a code defect and
     * the run stops so someone fixes it.
     */
    throw new Error(
      `S1P evidence bundle carries a secret shape and was NOT written: ${offenders.join(', ')}`,
    );
  }
  return serialised;
}

/**
 * A LOCAL digest of the rendered bundle. See `I17B_STATUS` for what it does NOT establish.
 */
export function bundleDigest(rendered: string): string {
  return createHash('sha256').update(rendered, 'utf8').digest('hex');
}
