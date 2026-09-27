import {
  PROVIDER_CAPABILITY_RECORDS,
  evidencePathIncompatibility,
  selectProvider,
  type ProviderCapabilityRecord,
} from './capabilityRecord.js';

/**
 * `§28` — THE DETERMINISTIC READINESS RESULT, WITH THE TOKEN THE OWNER CORRECTED.
 *
 * =================================================================================
 * THE OLD TOKEN NAMED AN ENVIRONMENT THAT CANNOT PRODUCE THE EVIDENCE
 *
 * `§28` of the S1O mandate offered `READY_TO_PROVISION_<PROVIDER>_SANDBOX_CREDENTIALS`, and
 * the first candidate emitted it. For SendGrid that token names the provider's SANDBOX MODE,
 * and official Twilio SendGrid documentation states that requests made in sandbox mode
 * generate no events in either the Event Webhook or Email Activity — so the environment the
 * token described is one in which the `I36` oracle can observe nothing at all.
 *
 * **THE TOKEN IS THEREFORE `READY_TO_PROVISION_<PROVIDER>_NONPRODUCTION_TEST_CREDENTIALS`,**
 * and the change is not cosmetic: it names a DEDICATED NON-PRODUCTION ENVIRONMENT sending
 * real requests with `sandbox_mode=false` to an owner-controlled sink recipient, which is
 * the only design at this provider where the request is bounded AND the evidence exists.
 *
 * =================================================================================
 * WHAT THE TOKEN MEANS, EXACTLY, AND THE FOUR THINGS IT DOES NOT
 *
 * It means: **the repository is LOCALLY ready to provision credentials for a dedicated
 * non-production validation environment at the selected provider.** That is all.
 *
 * It does NOT mean SANDBOX MODE. That mode is documented to suppress the evidence.
 * It does NOT mean provider validation is complete — `§28` forbids saying so, and `§15` puts
 * the empirical attempted-write test in the later slice.
 * It does NOT mean production readiness, and it does not mean the credentials exist. None is
 * held, requested or required.
 * It does NOT discharge `36 §13`, `I8`, `I20` or `I36`'s verification leg, every one of which
 * needs a real provider read this slice does not perform.
 *
 * `preliveGate.ts`'s `READY_FOR_PROVIDER_SANDBOX_CONFIGURATION` is the adjacent statement and
 * is deliberately NOT reused: that one answers "are the local control artifacts in a state
 * where a provider environment may be configured", and this one answers "has a provider been
 * selected, is the audit-plane boundary built, and can the selected provider's bounded test
 * path carry `I36`'s evidence". **Two different questions, two different tokens**, and a
 * slice that needs both must check both.
 *
 * =================================================================================
 * SIX CONJUNCTS NOW, NOT FIVE
 *
 * `§28`'s five, plus `§5`'s test-path/evidence compatibility. The sixth is the one that
 * would have refused the first candidate's own token, and it is a conjunct rather than a
 * note for exactly that reason.
 * =================================================================================
 */

/**
 * The closed result set. Two members, and the negative carries its reasons.
 *
 * **NO `..._SANDBOX_CREDENTIALS` MEMBER EXISTS**, so the old token cannot be reached by
 * editing a string: a call site that wanted it would have to widen this type, which is a
 * change a reviewer sees. `tests/provider-selection/s1m-readiness.test.ts` asserts the
 * absence against the emitted token as well as against the type.
 */
export type S1mReadinessStatus =
  | `READY_TO_PROVISION_${string}_NONPRODUCTION_TEST_CREDENTIALS`
  | 'NOT_READY_TO_PROVISION';

export interface S1mReadinessResult {
  readonly status: S1mReadinessStatus;
  readonly selectedProvider: string | null;
  /** Empty exactly when the status is READY. Never summarised away. */
  readonly blockers: readonly string[];
  /**
   * What the selected provider's own documentation has already settled NEGATIVELY.
   *
   * Printed beside the token because the token's meaning depends on it: a reader who does
   * not know that SendGrid sandbox mode produces no Email Activity will read "non-production
   * test credentials" as "sandbox credentials" and provision the wrong environment.
   * **Carried by a READY result, never cleared.**
   */
  readonly resolvedDocumentedNegatives: readonly string[];
  /**
   * `§21`, `§24` — what only an account can settle for the selected provider.
   *
   * **A READY result carries these and does not clear them.** They are the difference
   * between "nothing local blocks provisioning" and "validation is complete", and printing
   * them beside the token is what stops the token being read as the second thing.
   */
  readonly accountValidationPending: readonly string[];
}

/**
 * `§28`'s five conjuncts, as inputs rather than as assumptions.
 *
 * The three boundary flags are PARAMETERS because this module cannot observe them: whether
 * the integration boundary is green is a fact about a test run, not about a record, and a
 * function that asserted it from inside would be asserting its own conclusion. The caller —
 * `tests/provider-selection/s1m-readiness.test.ts` — supplies them from the real suite.
 */
export interface S1mReadinessInputs {
  /** `§28` conjunct 2. S1N's integration-plane boundary suite is green. */
  readonly integrationBoundaryGreen: boolean;
  /** `§28` conjunct 3. S1O's audit provider-read boundary suite is green. */
  readonly auditReadBoundaryGreen: boolean;
  /** `§28` conjunct 5. No local architecture blocker remains. */
  readonly localArchitectureBlockers: readonly string[];
}

/**
 * The corrected token, built from the selected provider's identity.
 *
 * DERIVED RATHER THAN WRITTEN, so a record whose provider name changed cannot keep emitting
 * a token naming the old one, and so the suffix lives in exactly one place.
 */
export function nonProductionReadinessToken(
  provider: string,
): `READY_TO_PROVISION_${string}_NONPRODUCTION_TEST_CREDENTIALS` {
  return `READY_TO_PROVISION_${provider.toUpperCase()}_NONPRODUCTION_TEST_CREDENTIALS`;
}

/**
 * `§28` conjunct 4 — the selected provider's credential scopes are NORMATIVELY COMPATIBLE.
 *
 * "Normatively compatible" is not "both exist". It means the two scopes, read against
 * `50 §2g`, would classify such that the deployment is admissible:
 *
 *   the SEND scope     must not be `MONEY_MOVING`, or ADR-024 requires option B and option B
 *                      is not built. `§10`: "Current expected provider-validation email
 *                      credential should be `NON_MONETARY_WRITE`."
 *   the AUDIT scope    must be `READ_ONLY`, or `48 §3.6`'s exemption is not earned.
 *
 * Both are judged from the DOCUMENTED scope shape, which is what S1O holds. Neither is a
 * claim about a provisioned credential.
 */
export function credentialScopesNormativelyCompatible(
  record: ProviderCapabilityRecord,
): { readonly compatible: boolean; readonly reason: string } {
  if (record.auditReadCredentialScope.sendCapable !== false) {
    return {
      compatible: false,
      reason:
        `${record.provider}'s audit read scope is not documented as incapable of send, so ` +
        "50 §2g would not classify it READ_ONLY and 48 §3.6's exemption is not earned",
    };
  }
  if (!record.sendCredentialScope.excludesAccountAdministration) {
    return {
      compatible: false,
      reason:
        `${record.provider}'s send scope is not documented as excluding broad account ` +
        'administration, so its provider permission envelope is not bounded',
    };
  }
  if (record.sendCredentialScope.scope.length === 0) {
    return {
      compatible: false,
      reason: `${record.provider} documents no send scope to restrict`,
    };
  }
  return {
    compatible: true,
    reason:
      `${record.provider}'s send scope [${record.sendCredentialScope.scope.join(', ')}] is a ` +
      'non-monetary external write and its audit scope ' +
      `[${record.auditReadCredentialScope.scope.join(', ')}] is documented as incapable of ` +
      'send',
  };
}

/** `§28`'s conjunction. Every failing conjunct is reported; none is summarised away. */
export function s1mReadiness(
  inputs: S1mReadinessInputs,
  records: readonly ProviderCapabilityRecord[] = PROVIDER_CAPABILITY_RECORDS,
): S1mReadinessResult {
  const blockers: string[] = [];

  const decision = selectProvider(records);
  const selected = decision.selected;
  if (selected === null) blockers.push(`no provider selected: ${decision.reason}`);

  if (!inputs.integrationBoundaryGreen) {
    blockers.push('the S1N integration-plane boundary is not green');
  }
  if (!inputs.auditReadBoundaryGreen) {
    blockers.push('the S1O audit provider-read boundary is not green');
  }
  for (const blocker of inputs.localArchitectureBlockers) {
    blockers.push(`local architecture blocker: ${blocker}`);
  }

  if (selected !== null) {
    const compatibility = credentialScopesNormativelyCompatible(selected);
    if (!compatibility.compatible) blockers.push(compatibility.reason);

    /*
     * CONJUNCT 6 — `§5`'s TEST-PATH/EVIDENCE COMPATIBILITY.
     *
     * `selectProvider` already applies it, so a provider reaching this line has passed it and
     * the check is redundant TODAY. It is here anyway, because the readiness token is the
     * artifact a later slice acts on: a future change that relaxed selection would otherwise
     * emit a token promising an environment that cannot carry `I36`, and a token is exactly
     * the kind of statement that gets read without its reasons.
     */
    const incompatibility = evidencePathIncompatibility(selected);
    if (incompatibility !== null) blockers.push(incompatibility);
  }

  if (blockers.length > 0 || selected === null) {
    return Object.freeze({
      status: 'NOT_READY_TO_PROVISION',
      selectedProvider: selected?.provider ?? null,
      blockers: Object.freeze(blockers),
      resolvedDocumentedNegatives: Object.freeze(selected?.resolvedDocumentedNegatives ?? []),
      accountValidationPending: Object.freeze(selected?.unresolvedAccountItems ?? []),
    });
  }

  return Object.freeze({
    status: nonProductionReadinessToken(selected.provider),
    selectedProvider: selected.provider,
    blockers: Object.freeze([]),
    // BOTH CARRIED, NEITHER CLEARED. See each member's own comment.
    resolvedDocumentedNegatives: selected.resolvedDocumentedNegatives,
    accountValidationPending: selected.unresolvedAccountItems,
  });
}
