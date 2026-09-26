/**
 * `50 §2g` — THE CLOSED CREDENTIAL RISK CLASS, AND THE ONE THING IT IS ABOUT.
 *
 * =================================================================================
 * WHAT v1.3.7 RULED, AND WHY S1N's ANSWER WAS WRONG IN KIND
 *
 * ADR-024 builds the execution proxy "at the first **money-moving credential** or the third
 * adapter, whichever comes first". v1.3.6 said that in six places and **never said how a
 * build would decide it**, so S1N derived it from `50 §2a` field 4 —
 * `carries_vendor_monetary_field` — and recorded the derivation as `S1N-C1`, an open owner
 * question.
 *
 * v1.3.7 `50 §2g` rules that derivation wrong IN KIND, not merely in calibration:
 *
 *   **MONEY-MOVING IS A PROPERTY OF THE CREDENTIAL'S CAPABILITY ENVELOPE AT THE PROVIDER.
 *   IT IS NOT A PROPERTY OF THE ACTION ACOS CURRENTLY INTENDS TO CALL.**
 *
 * `29 §14` is the standing finding that makes the distinction load-bearing: "**vendor OAuth
 * scopes are coarser than ACOS action classes on every platform examined**". A credential
 * provisioned so ACOS can send one email routinely carries provider permissions ACOS never
 * intends to use, and a classification that read ACOS's intended action would classify that
 * credential by the half of its envelope ACOS chose to look at.
 *
 * THE ATTACK THIS MODULE EXISTS TO REFUSE, stated concretely. One provider credential
 * authorises `email.send` AND `payment.refund`. ACOS configures only `email.send`. An
 * implementation that examines the current action answers `NON_MONETARY_WRITE` and admits
 * the credential under option A. This module answers `MONEY_MOVING` and the registry
 * refuses, because the credential can refund money whatever ACOS intends.
 * `tests/negative-controls/unsafe-credential-risk.ts` is the discriminating control.
 *
 * =================================================================================
 * AND THE CONVERSE, WHICH `50 §2g` IS EQUALLY EXPLICIT ABOUT
 *
 * An ACOS action class being monetary does NOT make a credential money-moving. If the
 * configured credential cannot execute that action at the provider, that is a **provider
 * capability / `I15` enforceability** question — `29 §14` replaced `I15` with exactly that
 * empirical probe — and it is not this classification's subject. **ACOS action authority
 * remains separately governed by `26` and is not merged into this file.**
 *
 * There is therefore NO import of `actionClasses.js` or `actionCatalogue.js` in this module,
 * and that absence is asserted by `tests/controlArtifacts/credential-risk.test.ts`.
 * =================================================================================
 */

/**
 * `50 §2g`'s closed set. **EXACTLY THREE VALUES AND NO FOURTH.**
 *
 * `§2g`: "**There is no `UNKNOWN`, and a missing classification is not a permissive
 * default.**" An `UNKNOWN` member is precisely what a permissive default looks like once
 * somebody needs a value to put in a column, so the type has no room for one and the parser
 * refuses a string outside this list rather than mapping it anywhere.
 */
export const CREDENTIAL_RISK_CLASSES = [
  /** Every reachable provider permission is a read or a query. No external mutation at all. */
  'READ_ONLY',
  /** At least one reachable permission mutates provider state; none is money-moving. */
  'NON_MONETARY_WRITE',
  /** At least one reachable permission satisfies at least one of the nine clauses below. */
  'MONEY_MOVING',
] as const;

export type CredentialRiskClass = (typeof CREDENTIAL_RISK_CLASSES)[number];

export function isCredentialRiskClass(value: unknown): value is CredentialRiskClass {
  return (
    typeof value === 'string' &&
    (CREDENTIAL_RISK_CLASSES as readonly string[]).includes(value)
  );
}

/**
 * `50 §2g`'s NINE CLAUSES, transcribed as prose and not as a matcher.
 *
 * =================================================================================
 * WHY THIS IS A DOCUMENTATION CONSTANT AND NOT A PREDICATE OVER PERMISSION NAMES
 *
 * `§2g` field 4 is "a non-empty closed list of provider permission identifiers, **as the
 * PROVIDER spells them**", and field 5 is "the subset of field 4 satisfying at least one of
 * the nine clauses". **The subsetting is a human judgement made at signing time, by the
 * owner, over one named provider's published permission model** — and it is then frozen into
 * signed bytes.
 *
 * A regular expression over permission names would be the `§36` defect one level down: it
 * would infer money-movement from a STRING, so `mail.send` would be safe and
 * `billing.read` would look dangerous, and a provider that named its refund scope
 * `messages.write` would defeat it silently. The nine clauses live here so a reader of the
 * signing ceremony has them, and nothing in this file matches on them.
 * =================================================================================
 */
export const MONEY_MOVING_CLAUSES: readonly string[] = Object.freeze([
  'debit or charge funds',
  'capture or settle a payment',
  'refund or externally credit funds',
  'transfer or pay out funds',
  'withdraw funds',
  'purchase goods or services creating monetary liability',
  'issue or redeem externally meaningful monetary or stored value',
  'initiate provider-side monetary spend',
  'increase a budget, spend cap, credit line, or analogous provider-side authority that ' +
    'permits additional spend',
]);

/**
 * `50 §2g` field 2's RESERVED SENTINEL for an audit-plane read credential.
 *
 * `§2g`: "**THE `audit_plane` SENTINEL IS RESERVED AND CARRIES NO DISPATCH AUTHORITY.** It
 * is not an adapter identity, it is never added to the class-3 catalogue, and the
 * adapter-runtime registry refuses a descriptor naming it — an audit read credential is not
 * a credential any adapter may present."
 *
 * It exists because `48 §3.6`'s audit-plane credential is scoped to a PROVIDER rather than
 * to an adapter — its job is to ask the provider what happened, not to dispatch anything —
 * and without a sentinel it would have had to sit outside the closed schema, which is where
 * it sat at v1.3.6 and is the reason the exemption had no signed operand.
 *
 * The same shape `INTERNAL_ONLY_ADAPTER` takes in the class-3 catalogue, and declared here
 * rather than beside it because this one is class-5 content and `50 §2f` allows a field
 * exactly one owning class.
 */
export const AUDIT_PLANE_CREDENTIAL_SCOPE = 'audit_plane';

/**
 * `50 §2g`'s MAXIMUM-PRIVILEGE RULE, over a set of classes.
 *
 * "**The class is the highest reachable, never the lowest, never the average and never the
 * intended.**" Used where several credentials, or several declarations, must collapse to one
 * answer — never to *derive* a credential's own class, which is DECLARED.
 *
 * An EMPTY set has no highest member, and the honest answer is not a default. Callers pass a
 * non-empty set; `highestRiskOf` refuses an empty one rather than inventing `READ_ONLY`,
 * because "no credentials were considered" and "every credential is safe" are different
 * facts and only one of them is evidence.
 */
export function highestRiskOf(
  classes: readonly CredentialRiskClass[],
): CredentialRiskClass | null {
  if (classes.length === 0) return null;
  if (classes.includes('MONEY_MOVING')) return 'MONEY_MOVING';
  if (classes.includes('NON_MONETARY_WRITE')) return 'NON_MONETARY_WRITE';
  return 'READ_ONLY';
}

/**
 * `50 §2g`'s SELF-CONSISTENCY RULE over fields 4–7, as a total function.
 *
 * "**Fields 5, 6 and 7 are CONSISTENCY-CHECKED against field 4 and against each other at
 * verification, and a declaration that disagrees with itself is REFUSED.**"
 *
 *   `credential_risk_class` is `MONEY_MOVING` exactly when field 5 is non-empty;
 *   `READ_ONLY` requires field 7 false;
 *   `NON_MONETARY_WRITE` requires field 7 true and field 5 empty.
 *
 * Returns the REASON a declaration is inconsistent, or `null` when it agrees with itself.
 * A reason rather than a boolean, because `artifactParsers.ts` has to say which of the four
 * ways a record can lie about itself this one took, and `50 §3f`'s fail-closed rule is worth
 * nothing if the operator cannot tell a typo from an understatement.
 *
 * NOTE WHAT THIS DOES NOT DO. It does not decide whether a permission is money-moving; the
 * owner did that at signing time and it is field 5. What it catches is a record whose own
 * three derived fields disagree — the shape a hand-edited or partially-updated declaration
 * takes, and the shape an understatement takes when somebody changes field 6 and forgets
 * field 5.
 */
export function credentialDeclarationInconsistency(declaration: {
  readonly grantedProviderPermissions: readonly string[];
  readonly monetaryProviderPermissions: readonly string[];
  readonly credentialRiskClass: CredentialRiskClass;
  readonly externalMutationCapable: boolean;
}): string | null {
  const granted = new Set(declaration.grantedProviderPermissions);
  for (const permission of declaration.monetaryProviderPermissions) {
    if (!granted.has(permission)) {
      return (
        `monetary_provider_permissions carries ${JSON.stringify(permission)}, which is not ` +
        'a member of granted_provider_permissions; 50 §2g field 5 is a SUBSET of field 4'
      );
    }
  }

  const monetary = declaration.monetaryProviderPermissions.length > 0;

  if (monetary && declaration.credentialRiskClass !== 'MONEY_MOVING') {
    return (
      `credential_risk_class is ${declaration.credentialRiskClass} and ` +
      'monetary_provider_permissions is non-empty; 50 §2g: the class is MONEY_MOVING ' +
      'EXACTLY when field 5 is non-empty, and maximum privilege decides a mixed envelope'
    );
  }
  if (!monetary && declaration.credentialRiskClass === 'MONEY_MOVING') {
    return (
      'credential_risk_class is MONEY_MOVING and monetary_provider_permissions is empty; ' +
      '50 §2g: the class is MONEY_MOVING EXACTLY when field 5 is non-empty, so a ' +
      'money-moving credential must name the permissions that make it one'
    );
  }
  if (monetary && !declaration.externalMutationCapable) {
    return (
      'monetary_provider_permissions is non-empty and external_mutation_capable is false; ' +
      'a permission that moves money mutates provider-side state'
    );
  }
  if (declaration.credentialRiskClass === 'READ_ONLY' && declaration.externalMutationCapable) {
    return (
      'credential_risk_class is READ_ONLY and external_mutation_capable is true; ' +
      '50 §2g: READ_ONLY requires field 7 false'
    );
  }
  if (
    declaration.credentialRiskClass === 'NON_MONETARY_WRITE' &&
    !declaration.externalMutationCapable
  ) {
    return (
      'credential_risk_class is NON_MONETARY_WRITE and external_mutation_capable is false; ' +
      '50 §2g: NON_MONETARY_WRITE requires field 7 true and field 5 empty'
    );
  }
  return null;
}
