import {
  ACTION_CLASSES,
  REASON_CODES,
  isActionClass,
  isReasonCode,
  type ActionClass,
  type ReasonCode,
  type ReasonCodeScope,
  type Recoverability,
  type SettlementTolerance,
  type ValueDirection,
} from '../canonicalisation/actionClasses.js';
import { ED25519_PUBLIC_KEY_BYTES } from './casSig.js';
import { decodeLowercaseHex, keyIdOf } from './ed25519.js';
import { integrityFailure } from './errors.js';
import type {
  VerifiedActionCatalogue,
  VerifiedActionCatalogueEntry,
  VerifiedAuditSigningKey,
  VerifiedConstructorSet,
  VerifiedDegradedModeConfiguration,
  VerifiedJcs1Specification,
  VerifiedPolicySet,
} from './bundle.js';

/**
 * Parsers for the verified artifact bytes.
 *
 * =================================================================================
 * NOTHING HERE RUNS BEFORE VERIFICATION, AND THAT ORDER IS THE POINT
 *
 * `50 §3c`: "**The runtime consumes the signed bytes, or a parsed immutable representation
 * derived EXCLUSIVELY from those verified bytes.**"
 *
 * `verifier.ts` calls every function in this file only after the artifact's exact-byte
 * `SHA-256` matched its manifest entry and both Ed25519 signatures verified. A parser that
 * ran first would be a parser an attacker could reach with bytes nobody signed — which is
 * exactly the shape `50 §2e` refuses for Cedar: "**Do not load unsigned policy and compare
 * digest afterward.**"
 *
 * =================================================================================
 * THE PARSE IS STRICT, AND THE SCHEMAS ARE CLOSED
 *
 * `50 §2a`: "**The list below is the WHOLE of class 3's signed content. There is no `incl.`,
 * no `etc.` and no open tail.**" `50 §2c`: "**Exactly four static quantities. No runtime
 * state. No open tail.**"
 *
 * So every object below is checked for EXACTLY its declared fields. An unknown field fails
 * closed rather than being ignored, for the same reason `policyArtifacts.ts` already refuses
 * a stray file in the policy directory: it is either an accident that changes nothing or an
 * artifact nobody reviewed, and the parser cannot tell which.
 *
 * =================================================================================
 * THE ARTIFACT ENCODING IS AN IMPLEMENTATION CHOICE, AND CANNOT MOVE AUTHORITY
 *
 * `50 §6` calls classes 2, 3 and 27 "the assembled ... artifact bytes" and declares no
 * container format, because `§3c` hashes EXACT BYTES: whatever encoding a release assembles,
 * the digest is over those bytes and both signatures bind that digest. A different encoding
 * is a different artifact with a different hash and a different manifest, which the
 * deployment pin rejects. The encoding chosen here — UTF-8 JSON, one file per class — is
 * therefore recorded in `docs/implementation/S1K-contract.md` as an implementation-level
 * decision rather than a normative one.
 *
 * `JSON.parse` RUNS HERE AND `JSON.stringify` NEVER DOES. `§3c`: "**WHAT IS NEVER HASHED:**
 * a parsed semantic object; a reserialised JSON document; a pretty-printed object [...]".
 * The hash was taken over the file's bytes before this module saw them.
 * =================================================================================
 */

function asObject(value: unknown, where: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    integrityFailure('ARTIFACT_CONTENT_INVALID', `${where} is not an object`);
  }
  return value as Record<string, unknown>;
}

function assertExactFields(
  value: Record<string, unknown>,
  allowed: readonly string[],
  where: string,
): void {
  const present = Object.keys(value).sort();
  const unexpected = present.filter((key) => !allowed.includes(key));
  const missing = [...allowed].sort().filter((key) => !present.includes(key));
  if (unexpected.length > 0 || missing.length > 0) {
    integrityFailure(
      'ARTIFACT_CONTENT_INVALID',
      `${where} carries exactly its declared fields; missing [${missing.join(', ')}], ` +
        `unexpected [${unexpected.join(', ')}]`,
    );
  }
}

function asString(value: unknown, where: string): string {
  if (typeof value !== 'string') {
    integrityFailure('ARTIFACT_CONTENT_INVALID', `${where} is not a string`);
  }
  return value;
}

function asBoolean(value: unknown, where: string): boolean {
  if (typeof value !== 'boolean') {
    integrityFailure('ARTIFACT_CONTENT_INVALID', `${where} is not a boolean`);
  }
  return value;
}

function asNonNegativeInteger(value: unknown, where: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    integrityFailure('ARTIFACT_CONTENT_INVALID', `${where} is not a non-negative integer`);
  }
  return value;
}

/**
 * A non-negative integer carried as DECIMAL ASCII, not as a JSON number.
 *
 * `irrecoverable_units` is a `BIGINT` ledger quantity (`24 §3` K5), and a JSON number is an
 * IEEE-754 double. Carrying it as text means the artifact's bytes say exactly what the
 * ledger will hold, with no parse step that could round.
 */
function asDecimalBigInt(value: unknown, where: string): bigint {
  const text = asString(value, where);
  if (!/^(0|[1-9][0-9]*)$/.test(text)) {
    integrityFailure(
      'ARTIFACT_CONTENT_INVALID',
      `${where} is not a non-negative decimal integer with no leading zeros`,
    );
  }
  return BigInt(text);
}

/**
 * `PTnM` / `PTnS` — the ISO 8601 durations `50 §2c` prints, and NOTHING ELSE.
 *
 * `§2c` declares `PT15M`, `PT30M` and `PT5M`. The grammar accepted here is exactly that
 * shape: hours, days, weeks, fractional seconds and a bare `PT0S` special case are all
 * refused, because a duration spelling the architecture never printed is a duration nobody
 * reviewed and the artifact is the reviewed object.
 */
function asDurationMs(value: unknown, where: string): number {
  const text = asString(value, where);
  const match = /^PT(?:([1-9][0-9]*)M|([1-9][0-9]*)S)$/.exec(text);
  if (match === null) {
    integrityFailure(
      'ARTIFACT_CONTENT_INVALID',
      `${where} is ${JSON.stringify(text)}; 50 §2c's durations are PT<n>M or PT<n>S`,
    );
  }
  const minutes = match[1];
  if (minutes !== undefined) return Number(minutes) * 60 * 1000;
  return Number(match[2]) * 1000;
}

/**
 * A scale-2 monetary amount, carried as DECIMAL TEXT and parsed to MINOR UNITS.
 *
 * `51 §1` and `exposure/money.ts`: a monetary value is never a `number`. `50 §2c` quantity
 * 3 declares `USD 20.00` in "single ledger currency, scale 2", so the artifact carries
 * `"20.00"` and this returns `2000n`. Exactly two decimal places are required: `"20"` and
 * `"20.000"` are refused rather than coerced, because a coercion is a place a scale error
 * can hide.
 */
function asScale2MinorUnits(value: unknown, where: string): bigint {
  const text = asString(value, where);
  const match = /^(0|[1-9][0-9]*)\.([0-9]{2})$/.exec(text);
  if (match === null) {
    integrityFailure(
      'ARTIFACT_CONTENT_INVALID',
      `${where} is ${JSON.stringify(text)}; a scale-2 ledger amount is <units>.<2 digits>`,
    );
  }
  return BigInt(match[1]!) * 100n + BigInt(match[2]!);
}

function artifactHeader(
  document: Record<string, unknown>,
  expectedArtifactId: string,
  where: string,
): string {
  const artifactId = asString(document.artifact_id, `${where}.artifact_id`);
  if (artifactId !== expectedArtifactId) {
    integrityFailure(
      'ARTIFACT_IDENTITY_UNEXPECTED',
      `${where} declares artifact_id ${JSON.stringify(artifactId)}; the pre-live set ` +
        `declares ${JSON.stringify(expectedArtifactId)} (50 §6)`,
    );
  }
  return asString(document.artifact_version, `${where}.artifact_version`);
}

function parseJson(bytes: Uint8Array, where: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(bytes).toString('utf8'));
  } catch (error) {
    integrityFailure(
      'ARTIFACT_CONTENT_INVALID',
      `${where} does not parse: ${String(error)}`,
    );
  }
  return asObject(parsed, where);
}

// ---------------------------------------------------------------------------------
// CLASS 3 — `50 §2a`'s CLOSED schema.
// ---------------------------------------------------------------------------------

const CLASS_3_FIELDS = [
  'artifact_id',
  'artifact_version',
  'action_classes',
  'reason_codes',
  'reason_code_scopes',
  'semantic_option_digest_fields',
  'enumeration_max_age_seconds',
] as const;

/** `50 §2a` Part A. EXACTLY TEN FIELDS, in the declared order. */
const CLASS_3_ENTRY_FIELDS = [
  'action_class',
  'recoverability',
  'value_direction',
  'carries_vendor_monetary_field',
  'cost_component_free',
  'rate_based',
  'irrecoverable_units',
  'settlement_tolerance',
  'adapter',
  'method',
] as const;

const RECOVERABILITY_VALUES: readonly Recoverability[] = [
  'REVERSIBLE',
  'COMPENSABLE',
  'IRRECOVERABLE',
];

const VALUE_DIRECTION_VALUES: readonly ValueDirection[] = [
  'NONE',
  'INBOUND_ORIGINAL_INSTRUMENT',
  'OUTBOUND_TO_COUNTERPARTY',
  'INTERNAL_LIABILITY',
  'OUTBOUND_TO_THIRD_PARTY_BENEFICIARY',
  'OUTBOUND_GOODS_TO_ADDRESS',
];

const SETTLEMENT_TOLERANCE_VALUES: readonly SettlementTolerance[] = ['EXACT', 'BAND', 'NONE'];

const REASON_CODE_SCOPE_VALUES: readonly ReasonCodeScope[] = [
  'GOODS_FAULT',
  'GOODS_RETURNED',
  'BILLING_ERROR',
];

function asMember<T extends string>(
  value: unknown,
  members: readonly T[],
  where: string,
): T {
  const text = asString(value, where);
  if (!(members as readonly string[]).includes(text)) {
    integrityFailure(
      'ARTIFACT_CONTENT_INVALID',
      `${where} is ${JSON.stringify(text)}; the declared domain is [${members.join(', ')}]`,
    );
  }
  return text as T;
}

/**
 * Parse `50 §2a`'s class-3 content from VERIFIED bytes.
 *
 * =================================================================================
 * THE ACTION-CLASS MEMBER SET IS THE TYPESCRIPT ENUM AND THE AUTHORITY VALUES ARE NOT
 *
 * `§17` of the S1K mandate: "Constants may remain for: TypeScript enum names; parser
 * machinery; structural schemas; **but not for independent authority values that can
 * disagree with the signed artifact.**"
 *
 * `ACTION_CLASSES` and `REASON_CODES` are enum NAMES — the closed member sets `SR7` makes
 * the single extension point — and they stay in `actionCatalogue.ts` as the TypeScript
 * types every signature in `src/` is written against. What this parser takes from the
 * signed bytes is everything a change could USE to widen authority: recoverability, value
 * direction, adapter, method, unit counts, tolerances and the four catalogue-level records.
 *
 * The artifact declaring a class outside `ACTION_CLASSES`, or omitting one inside it, is a
 * FAILURE rather than an extension: a class the TypeScript surface cannot name is a class no
 * consumer could dispatch, and silently admitting one would leave the two member sets
 * disagreeing with no reader noticing.
 * =================================================================================
 */
export function parseClass3ActionCatalogue(bytes: Uint8Array): VerifiedActionCatalogue {
  const where = 'the class-3 action catalogue';
  const document = parseJson(bytes, where);
  assertExactFields(document, CLASS_3_FIELDS, where);
  const artifactVersion = artifactHeader(document, 'acos.control.action_catalogue', where);

  const rawEntries = document.action_classes;
  if (!Array.isArray(rawEntries)) {
    integrityFailure('ARTIFACT_CONTENT_INVALID', `${where}.action_classes is not an array`);
  }

  const entries: Record<string, VerifiedActionCatalogueEntry> = {};
  const seen: string[] = [];
  for (const [index, raw] of rawEntries.entries()) {
    const at = `${where}.action_classes[${String(index)}]`;
    const entry = asObject(raw, at);
    assertExactFields(entry, CLASS_3_ENTRY_FIELDS, at);
    const actionClass = asString(entry.action_class, `${at}.action_class`);
    if (!isActionClass(actionClass)) {
      integrityFailure(
        'ARTIFACT_CONTENT_INVALID',
        `${at}.action_class is ${JSON.stringify(actionClass)}, which is outside the closed ` +
          'catalogue member set this runtime can name (SR7, 50 §2a field 1)',
      );
    }
    if (seen.includes(actionClass)) {
      integrityFailure(
        'ARTIFACT_CONTENT_INVALID',
        `${at}.action_class ${actionClass} appears twice`,
      );
    }
    seen.push(actionClass);
    entries[actionClass] = Object.freeze({
      actionClass,
      recoverability: asMember(entry.recoverability, RECOVERABILITY_VALUES, `${at}.recoverability`),
      valueDirection: asMember(
        entry.value_direction,
        VALUE_DIRECTION_VALUES,
        `${at}.value_direction`,
      ),
      carriesVendorMonetaryField: asBoolean(
        entry.carries_vendor_monetary_field,
        `${at}.carries_vendor_monetary_field`,
      ),
      costComponentFree: asBoolean(entry.cost_component_free, `${at}.cost_component_free`),
      rateBased: asBoolean(entry.rate_based, `${at}.rate_based`),
      irrecoverableUnits: asDecimalBigInt(entry.irrecoverable_units, `${at}.irrecoverable_units`),
      settlementTolerance: asMember(
        entry.settlement_tolerance,
        SETTLEMENT_TOLERANCE_VALUES,
        `${at}.settlement_tolerance`,
      ),
      adapter: asString(entry.adapter, `${at}.adapter`),
      method: asString(entry.method, `${at}.method`),
    });
  }

  const missing = ACTION_CLASSES.filter((actionClass) => !seen.includes(actionClass));
  if (missing.length > 0) {
    integrityFailure(
      'ARTIFACT_CONTENT_INVALID',
      `${where} declares no record for [${missing.join(', ')}]; 50 §2a's per-class record ` +
        'is declared "for every member of the closed action catalogue"',
    );
  }

  // `51 §2.3`'s COHERENCE RULE, checked over the VERIFIED bytes before the bundle can be
  // sealed rather than at module load over a literal:
  //
  //   "**For every IRRECOVERABLE class in the current catalogue the declared value is `1`,
  //    and for every REVERSIBLE and COMPENSABLE class it is `0`.**"
  //
  // A REVERSIBLE class with a positive count moves ledger 3 for an effect that is not
  // irrecoverable; an IRRECOVERABLE class with `0` removes the class from the MIE ceiling
  // entirely. Both are startup failures, and both are now failures of the BOOTSTRAP CEREMONY
  // — the signed artifact is refused and the kernel never becomes READY.
  for (const actionClass of seen) {
    const entry = entries[actionClass]!;
    if (entry.recoverability === 'IRRECOVERABLE') {
      if (entry.irrecoverableUnits < 1n) {
        integrityFailure(
          'ARTIFACT_CONTENT_INVALID',
          `${where}: ${actionClass} is IRRECOVERABLE and declares irrecoverable_units = ` +
            `${String(entry.irrecoverableUnits)}; 51 §2.3 declares 1 for every current ` +
            'IRRECOVERABLE class and a 0 would remove the class from the MIE ceiling',
        );
      }
    } else if (entry.irrecoverableUnits !== 0n) {
      integrityFailure(
        'ARTIFACT_CONTENT_INVALID',
        `${where}: ${actionClass} is ${entry.recoverability} and declares ` +
          `irrecoverable_units = ${String(entry.irrecoverableUnits)}; 51 §2.3 declares 0 ` +
          'for every REVERSIBLE and COMPENSABLE class',
      );
    }
  }

  // Record 11 — the closed `reason_code` enum.
  const rawReasonCodes = document.reason_codes;
  if (!Array.isArray(rawReasonCodes)) {
    integrityFailure('ARTIFACT_CONTENT_INVALID', `${where}.reason_codes is not an array`);
  }
  const reasonCodes: ReasonCode[] = rawReasonCodes.map((raw, index) => {
    const code = asString(raw, `${where}.reason_codes[${String(index)}]`);
    if (!isReasonCode(code)) {
      integrityFailure(
        'ARTIFACT_CONTENT_INVALID',
        `${where}.reason_codes[${String(index)}] is ${JSON.stringify(code)}, outside the ` +
          'closed enum this runtime can name (26 §2.0)',
      );
    }
    return code;
  });
  const missingCodes = REASON_CODES.filter((code) => !reasonCodes.includes(code));
  if (missingCodes.length > 0) {
    integrityFailure(
      'ARTIFACT_CONTENT_INVALID',
      `${where}.reason_codes omits [${missingCodes.join(', ')}]`,
    );
  }

  // Record 12 — the TOTAL map. `50 §2a`: "the total map from each `reason_code` to its
  // `reason_code_scope`". Total, so a missing key is a failure and not an absent default.
  const rawScopes = asObject(document.reason_code_scopes, `${where}.reason_code_scopes`);
  assertExactFields(rawScopes, reasonCodes, `${where}.reason_code_scopes`);
  const reasonCodeScopes: Record<string, ReasonCodeScope> = {};
  for (const code of reasonCodes) {
    reasonCodeScopes[code] = asMember(
      rawScopes[code],
      REASON_CODE_SCOPE_VALUES,
      `${where}.reason_code_scopes.${code}`,
    );
  }

  // Record 13 — per class, the declared ORDERED field list.
  const rawDigestFields = asObject(
    document.semantic_option_digest_fields,
    `${where}.semantic_option_digest_fields`,
  );
  assertExactFields(rawDigestFields, seen, `${where}.semantic_option_digest_fields`);
  const semanticOptionDigestFields: Record<string, readonly string[]> = {};
  for (const actionClass of seen) {
    const at = `${where}.semantic_option_digest_fields.${actionClass}`;
    const list = rawDigestFields[actionClass];
    if (!Array.isArray(list)) {
      integrityFailure('ARTIFACT_CONTENT_INVALID', `${at} is not an array`);
    }
    semanticOptionDigestFields[actionClass] = Object.freeze(
      list.map((field, index) => asString(field, `${at}[${String(index)}]`)),
    );
  }

  // Record 14 — per class, the enumeration `max_age` checked at C'.
  const rawMaxAge = asObject(
    document.enumeration_max_age_seconds,
    `${where}.enumeration_max_age_seconds`,
  );
  assertExactFields(rawMaxAge, seen, `${where}.enumeration_max_age_seconds`);
  const enumerationMaxAgeSeconds: Record<string, number> = {};
  for (const actionClass of seen) {
    enumerationMaxAgeSeconds[actionClass] = asNonNegativeInteger(
      rawMaxAge[actionClass],
      `${where}.enumeration_max_age_seconds.${actionClass}`,
    );
  }

  return Object.freeze({
    artifactVersion,
    actionClasses: Object.freeze([...ACTION_CLASSES]),
    entries: Object.freeze(entries) as Readonly<
      Record<ActionClass, VerifiedActionCatalogueEntry>
    >,
    reasonCodes: Object.freeze(reasonCodes),
    reasonCodeScopes: Object.freeze(reasonCodeScopes) as Readonly<
      Record<ReasonCode, ReasonCodeScope>
    >,
    semanticOptionDigestFields: Object.freeze(semanticOptionDigestFields) as Readonly<
      Record<ActionClass, readonly string[]>
    >,
    enumerationMaxAgeSeconds: Object.freeze(enumerationMaxAgeSeconds) as Readonly<
      Record<ActionClass, number>
    >,
  });
}

// ---------------------------------------------------------------------------------
// CLASS 27 — `50 §2c`'s CLOSED schema. Exactly four static quantities.
// ---------------------------------------------------------------------------------

const CLASS_27_FIELDS = [
  'artifact_id',
  'artifact_version',
  'mirror_lag_critical_threshold',
  'audit_unreachable_full_halt_threshold',
  'degraded_per_action_approval_floor_monetary',
  'corroboration_signal_max_age',
] as const;

/**
 * Parse `50 §2c`'s class-27 content from VERIFIED bytes.
 *
 * The four quantities, and NO RUNTIME STATE. `§2c`: "**Runtime state is not control
 * configuration**: the open `AUDIT_MIRROR_DEGRADED` declaration and its `opened_at`, the
 * current resolved mirror state, the held corroboration, and any active
 * `DegradedModeOverride` are runtime rows and are **not** class-27 content." The closed
 * field list above is what makes an artifact carrying one of them fail to parse.
 *
 * The ORDERING COHERENCE `30 §5.1` item 5 depends on — "a longer threshold" — is asserted
 * here as ARITHMETIC over the two verified values, so a signed configuration that collapsed
 * the escalation into the halt fails closed at publication instead of at the moment the
 * company should have halted.
 */
export function parseClass27DegradedModeConfiguration(
  bytes: Uint8Array,
): VerifiedDegradedModeConfiguration {
  const where = 'the class-27 degraded-mode configuration';
  const document = parseJson(bytes, where);
  assertExactFields(document, CLASS_27_FIELDS, where);
  const artifactVersion = artifactHeader(document, 'acos.control.degraded_mode_config', where);

  const mirrorLagCriticalThresholdMs = asDurationMs(
    document.mirror_lag_critical_threshold,
    `${where}.mirror_lag_critical_threshold`,
  );
  const auditUnreachableFullHaltThresholdMs = asDurationMs(
    document.audit_unreachable_full_halt_threshold,
    `${where}.audit_unreachable_full_halt_threshold`,
  );

  if (auditUnreachableFullHaltThresholdMs <= mirrorLagCriticalThresholdMs) {
    integrityFailure(
      'ARTIFACT_CONTENT_INVALID',
      `${where} declares audit_unreachable_full_halt_threshold at or below ` +
        'mirror_lag_critical_threshold; 30 §5.1 item 5 requires the halt threshold to be ' +
        'the longer of the two',
    );
  }

  return Object.freeze({
    artifactVersion,
    mirrorLagCriticalThresholdMs,
    auditUnreachableFullHaltThresholdMs,
    degradedPerActionApprovalFloorMinorUnits: asScale2MinorUnits(
      document.degraded_per_action_approval_floor_monetary,
      `${where}.degraded_per_action_approval_floor_monetary`,
    ),
    corroborationSignalMaxAgeMs: asDurationMs(
      document.corroboration_signal_max_age,
      `${where}.corroboration_signal_max_age`,
    ),
  });
}

// ---------------------------------------------------------------------------------
// CLASS 2 — `50 §2e`'s bundle: the Cedar schema plus every policy source.
// ---------------------------------------------------------------------------------

const CLASS_2_FIELDS = ['artifact_id', 'artifact_version', 'schema', 'policies'] as const;
const CLASS_2_POLICY_FIELDS = ['id', 'source'] as const;

/**
 * Parse `50 §2e`'s class-2 bundle from VERIFIED bytes.
 *
 * `§2e`: the artifact is "the `acos.control.policy_set` **bundle**: the Cedar schema file
 * and every `.cedar` policy source file, in one immutable byte object", and its runtime
 * consumer is "the policy loader, before the Cedar engine is constructed".
 *
 * `§2e`'s O4 rule, verbatim: "**A Cedar policy bundle is admitted to the engine only after
 * the verified manifest, its `content_hash`, its primary signature and its second-factor
 * signature have all been checked.** A bundle presented with a matching hash and no valid
 * signature pair is **REFUSED**."
 *
 * Policies are required to be in SORTED ID ORDER inside the bundle, and duplicates are a
 * defect. The bundle is one byte object, so its own order is what the owner signed; sorting
 * it here would let two byte sequences carry one meaning and would put a reordering outside
 * the signature's reach.
 */
export function parseClass2PolicySet(bytes: Uint8Array): VerifiedPolicySet {
  const where = 'the class-2 policy-set bundle';
  const document = parseJson(bytes, where);
  assertExactFields(document, CLASS_2_FIELDS, where);
  const artifactVersion = artifactHeader(document, 'acos.control.policy_set', where);

  const rawPolicies = document.policies;
  if (!Array.isArray(rawPolicies)) {
    integrityFailure('ARTIFACT_CONTENT_INVALID', `${where}.policies is not an array`);
  }

  const staticPolicies: Record<string, string> = {};
  const policyIds: string[] = [];
  for (const [index, raw] of rawPolicies.entries()) {
    const at = `${where}.policies[${String(index)}]`;
    const policy = asObject(raw, at);
    assertExactFields(policy, CLASS_2_POLICY_FIELDS, at);
    const id = asString(policy.id, `${at}.id`);
    const previous = policyIds[policyIds.length - 1];
    if (previous !== undefined && !(previous < id)) {
      integrityFailure(
        'ARTIFACT_CONTENT_INVALID',
        `${at}.id ${JSON.stringify(id)} does not follow ${JSON.stringify(previous)} in ` +
          'strictly ascending id order',
      );
    }
    policyIds.push(id);
    staticPolicies[id] = asString(policy.source, `${at}.source`);
  }

  if (policyIds.length === 0) {
    // `policyArtifacts.ts` already refuses an empty policy directory; the same rule applies
    // to a signed bundle. An empty policy set is a set in which nothing forbids anything.
    integrityFailure('ARTIFACT_CONTENT_INVALID', `${where} declares no policies`);
  }

  return Object.freeze({
    artifactVersion,
    schema: asString(document.schema, `${where}.schema`),
    staticPolicies: Object.freeze(staticPolicies),
    policyIds: Object.freeze(policyIds),
  });
}

// ---------------------------------------------------------------------------------
// CLASS 20 — `50 §2b`. The artifact file IS the boundary; there is nothing to parse.
// ---------------------------------------------------------------------------------

/**
 * `50 §2b`'s class-20 identity, taken from the VERIFIED bytes and their manifest entry.
 *
 * THIS FUNCTION DELIBERATELY DOES NOT INTERPRET THE SPECIFICATION TEXT. `50 §2b`: class 20
 * "signs THE SPECIFICATION, never an implementation", and `§2b` is explicit that a valid
 * signature "**DOES NOT PROVE THAT ANY IMPLEMENTATION CONFORMS TO IT**". Executing or
 * interpreting the text would be inventing a conformance mechanism the architecture assigns
 * to `36 §2`'s VC-A3.
 *
 * The one structural property it does check is `§2b`'s declared encoding: "**LF (`0x0A`)
 * line terminators exclusively; the file contains no `0x0D` byte.** A CRLF copy is a
 * different artifact and fails verification." That is a property of the bytes, checkable
 * without reading a word of the specification, and it turns the commonest accidental
 * corruption — a checkout that rewrote line endings — into a named failure instead of a
 * content-hash mismatch nobody can explain.
 */
export function parseClass20Specification(
  bytes: Uint8Array,
  identity: { readonly artifactVersion: string; readonly contentHash: string },
): VerifiedJcs1Specification {
  if (bytes.includes(0x0d)) {
    integrityFailure(
      'ARTIFACT_CONTENT_INVALID',
      'the class-20 specification contains a 0x0D byte; 50 §2b declares LF line ' +
        'terminators exclusively and a CRLF copy is a different artifact',
    );
  }
  return Object.freeze({
    artifactVersion: identity.artifactVersion,
    contentHash: identity.contentHash,
    byteLength: bytes.length,
  });
}

// ---------------------------------------------------------------------------------
// CLASS 24 — `50 §2` row 24. The audit plane's published public key.
// ---------------------------------------------------------------------------------

const CLASS_24_FIELDS = ['artifact_id', 'artifact_version', 'public_key'] as const;

/**
 * Parse `50 §2` row 24's content from VERIFIED bytes.
 *
 * Row 24's halt scope, verbatim: "**Entry into `CORROBORATED_DEGRADED`.** A substituted
 * public key would let a compromised control plane mint its own corroboration, so the key
 * is hashed into the manifest and a mismatch makes the corroborated state unreachable rather
 * than forgeable."
 *
 * The artifact carries the PUBLIC half only. `50 §2` row 24 and `30 §5.7.1` both declare the
 * private half "generated on and never leaving the audit-plane host".
 */
export function parseClass24AuditSigningKey(bytes: Uint8Array): VerifiedAuditSigningKey {
  const where = 'the class-24 audit-plane signing key';
  const document = parseJson(bytes, where);
  assertExactFields(document, CLASS_24_FIELDS, where);
  const artifactVersion = artifactHeader(document, 'acos.control.audit_signing_key', where);

  const publicKey = decodeLowercaseHex(
    asString(document.public_key, `${where}.public_key`),
    ED25519_PUBLIC_KEY_BYTES,
  );
  if (publicKey === null) {
    integrityFailure(
      'ARTIFACT_CONTENT_INVALID',
      `${where}.public_key is not ${String(ED25519_PUBLIC_KEY_BYTES * 2)} lowercase hex ` +
        'characters of raw Ed25519 public key',
    );
  }

  return Object.freeze({
    artifactVersion,
    keyId: keyIdOf(publicKey),
    publicKey,
  });
}

// ---------------------------------------------------------------------------------
// CLASS 19 — `50 §2` row 19. Effect constructors and their version records.
// ---------------------------------------------------------------------------------

const CLASS_19_FIELDS = ['artifact_id', 'artifact_version', 'records'] as const;
const CLASS_19_RECORD_FIELDS = [
  'constructor_id',
  'action_class',
  'semantic_major',
  'non_semantic_minor',
] as const;

/**
 * Parse `50 §2` row 19's content from VERIFIED bytes.
 *
 * `50 §3i` IS THE SCOPE STATEMENT FOR THIS CLASS, AND IT IS NOT DISCHARGED HERE:
 * "**Its verification keys should therefore become the same externally provisioned roots
 * this section declares. THAT MIGRATION IS DECLARED FUTURE WORK** and is listed in `37 §2`'s
 * S1K gate as a follow-on rather than a pre-live blocker."
 *
 * So the artifact is a MANIFEST MEMBER (`50 §6`) and is verified with the rest of the set,
 * and `ConstructorVersionResolver`'s caller-supplied-key arrangement is left exactly as S1B
 * built it. Nothing here claims class 19's trust root has moved.
 */
export function parseClass19ConstructorSet(bytes: Uint8Array): VerifiedConstructorSet {
  const where = 'the class-19 effect-constructor set';
  const document = parseJson(bytes, where);
  assertExactFields(document, CLASS_19_FIELDS, where);
  const artifactVersion = artifactHeader(document, 'acos.control.effect_constructors', where);

  const rawRecords = document.records;
  if (!Array.isArray(rawRecords)) {
    integrityFailure('ARTIFACT_CONTENT_INVALID', `${where}.records is not an array`);
  }

  const records = rawRecords.map((raw, index) => {
    const at = `${where}.records[${String(index)}]`;
    const record = asObject(raw, at);
    assertExactFields(record, CLASS_19_RECORD_FIELDS, at);
    return Object.freeze({
      constructorId: asString(record.constructor_id, `${at}.constructor_id`),
      actionClass: asString(record.action_class, `${at}.action_class`),
      semanticMajor: asNonNegativeInteger(record.semantic_major, `${at}.semantic_major`),
      nonSemanticMinor: asNonNegativeInteger(
        record.non_semantic_minor,
        `${at}.non_semantic_minor`,
      ),
    });
  });

  return Object.freeze({ artifactVersion, records: Object.freeze(records) });
}
