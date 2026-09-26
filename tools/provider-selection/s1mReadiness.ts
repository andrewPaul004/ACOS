import {
  PROVIDER_CAPABILITY_RECORDS,
  selectProvider,
  type ProviderCapabilityRecord,
} from './capabilityRecord.js';

/**
 * `§28` — THE DETERMINISTIC S1M READINESS RESULT.
 *
 * =================================================================================
 * `§28`, VERBATIM
 *
 *   "At S1O completion, produce a deterministic readiness result. Possible:
 *    `READY_TO_PROVISION_<PROVIDER>_SANDBOX_CREDENTIALS` **only if**: provider selected;
 *    integration boundary S1N green; audit read boundary green; credential scopes are
 *    normatively compatible; no local architecture blocker remains.
 *    **Do NOT say provider validation complete.**"
 *
 * Five conjuncts, and the function is a conjunction rather than a judgement so that a later
 * slice reading this cannot mistake an optimistic summary for a checked result.
 *
 * =================================================================================
 * WHAT THIS RESULT MEANS, AND THE THREE THINGS IT DOES NOT
 *
 * It means: **nothing in this repository now blocks provisioning the selected provider's
 * sandbox credentials.** That is all.
 *
 * It does NOT mean provider validation is complete — `§28` forbids saying so, and `§15` puts
 * the empirical attempted-write test in the later slice.
 * It does NOT mean the credentials exist. None is held, requested or required.
 * It does NOT discharge `36 §13`, `I8`, `I20` or `I36`'s verification leg, every one of which
 * needs a real provider read this slice does not perform.
 *
 * `preliveGate.ts`'s `READY_FOR_PROVIDER_SANDBOX_CONFIGURATION` is the adjacent statement and
 * is deliberately NOT reused: that one answers "are the local control artifacts in a state
 * where a sandbox may be configured", and this one answers "has a provider been selected and
 * is the audit-plane boundary built". **Two different questions, two different tokens**, and
 * a slice that needs both must check both.
 * =================================================================================
 */

/** The closed result set. Two members, and the negative carries its reasons. */
export type S1mReadinessStatus =
  | `READY_TO_PROVISION_${string}_SANDBOX_CREDENTIALS`
  | 'NOT_READY_TO_PROVISION';

export interface S1mReadinessResult {
  readonly status: S1mReadinessStatus;
  readonly selectedProvider: string | null;
  /** Empty exactly when the status is READY. Never summarised away. */
  readonly blockers: readonly string[];
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
  }

  if (blockers.length > 0 || selected === null) {
    return Object.freeze({
      status: 'NOT_READY_TO_PROVISION',
      selectedProvider: selected?.provider ?? null,
      blockers: Object.freeze(blockers),
      accountValidationPending: Object.freeze(selected?.unresolvedAccountItems ?? []),
    });
  }

  return Object.freeze({
    status: `READY_TO_PROVISION_${selected.provider.toUpperCase()}_SANDBOX_CREDENTIALS` as const,
    selectedProvider: selected.provider,
    blockers: Object.freeze([]),
    // CARRIED, NOT CLEARED. See `accountValidationPending`'s own comment.
    accountValidationPending: selected.unresolvedAccountItems,
  });
}
