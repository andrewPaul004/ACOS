import {
  verifiedActionCatalogue,
  type VerifiedActionCatalogue,
  type VerifiedActionCatalogueEntry,
  type VerifiedControlArtifactBundle,
} from '../controlArtifacts/bundle.js';
import { activeVerifiedControlArtifacts } from '../controlArtifacts/registry.js';
import {
  ACTION_CLASSES,
  INTERNAL_ONLY_ADAPTER,
  type ActionClass,
  type ReasonCode,
  type ReasonCodeScope,
} from './actionClasses.js';

/**
 * THE CLOSED ACTION CATALOGUE — read from `50 §2a`'s SIGNED class-3 artifact, and from
 * nowhere else.
 *
 * =================================================================================
 * WHAT THIS FILE WAS BEFORE S1K, AND WHY IT COULD NOT STAY THAT WAY
 *
 * Until this slice, `ACTION_CATALOGUE` was a frozen TypeScript literal in this module, and
 * every authority consumer read it: `stepR.ts` took `irrecoverable_units` from it,
 * `enqueue.ts` derived `I66`'s outbox scope predicate from its `adapter`,
 * `adapterRegistry.ts` resolved adapters from it, `canonicaliser.ts` copied `recoverability`
 * and `value_direction` out of it, and `refundCreate.ts` read the reason-code scope map
 * beside it. The manifest declared class 3 signed and NOTHING VERIFIED ANYTHING, so the
 * deployed authority was a literal a code change could move.
 *
 * `50 §3f`, the single source of authority, verbatim:
 *
 *   "**For classes 3 and 27 the signed artifact bytes ARE the deployed authority source.**
 *    Production code may parse them into frozen typed structures **after** verification.
 *    **It may not maintain a signed artifact value and a hard-coded production literal as
 *    two authority sources with equality asserted only in tests** — that leaves the unsigned
 *    literal authoritative in the path that matters. **Migrating today's frozen literals
 *    onto the verified bundle is required S1K runtime work** and is listed as such in
 *    `37 §2`."
 *
 * =================================================================================
 * SO: THERE IS NO CATALOGUE LITERAL IN THIS FILE, AND THAT ABSENCE IS THE CONTROL
 *
 * Every function below resolves through `activeVerifiedControlArtifacts()`, which throws
 * `NO_ACTIVE_VERIFIED_BUNDLE` when `50 §3f` occasion 1 has not completed. There is no
 * fallback table, no default entry, no `?? DEFAULT`, and no cached copy that could outlive a
 * failed reload.
 *
 * `tests/negative-controls/unsafe-unsigned-authority-literals.ts` is the discriminating
 * control: it carries the v1.3.5 literal with `fulfilment.reship` moved to `0` irrecoverable
 * units and `internal_only`, and `tests/controlArtifacts/class-3-authority.test.ts` runs
 * both readers over one fixture in which the signed artifact says `1` and `mock_commerce`.
 * The unsafe reader answers `0` and "no outbox row"; production answers `1` and "one outbox
 * row". If production still held a literal the two would agree, and the control would prove
 * nothing.
 *
 * =================================================================================
 * WHAT REMAINS A CONSTANT, AND WHY THAT IS NOT THE SAME MISTAKE
 *
 * The closed MEMBER SETS and the type unions moved to `actionClasses.ts` and are re-exported
 * here so every existing import keeps working. `§17` of the S1K mandate permits exactly
 * that: "TypeScript enum names; parser machinery; structural schemas". A member set decides
 * which names can be written down; it decides no recoverability, no adapter, no unit count
 * and no tolerance, and the class-3 parser REFUSES an artifact whose membership disagrees
 * with it rather than silently taking either side.
 * =================================================================================
 */

export {
  ACTION_CLASSES,
  INTERNAL_ONLY_ADAPTER,
  REASON_CODES,
  isActionClass,
  isReasonCode,
} from './actionClasses.js';

export type {
  ActionClass,
  ReasonCode,
  ReasonCodeScope,
  Recoverability,
  SettlementTolerance,
  ValueDirection,
} from './actionClasses.js';

/**
 * One class's verified catalogue record — `50 §2a` Part A's exactly ten fields.
 *
 * It is the parsed representation of signed bytes, so the type is the bundle's own. There is
 * deliberately no constructor for it in `src/`: the only way to obtain one is to verify a
 * package.
 */
export type ActionCatalogueEntry = VerifiedActionCatalogueEntry;

/**
 * Resolve the verified catalogue.
 *
 * The optional `bundle` parameter exists for call sites that already hold the capability —
 * `50 §3f` occasion 3's "Production authority code receives only a
 * `VerifiedControlArtifactBundle`" — and defaults to the active published one. It is NOT a
 * route to an unverified catalogue: the parameter's type is the sealed capability, which
 * only verification produces.
 */
export function actionCatalogue(
  bundle: VerifiedControlArtifactBundle = activeVerifiedControlArtifacts(),
): VerifiedActionCatalogue {
  return verifiedActionCatalogue(bundle);
}

/**
 * One class's verified record.
 *
 * `50 §2a` declares the per-class record "for every member of the closed action catalogue",
 * and the parser refuses an artifact that omits one, so this lookup is total over
 * `ActionClass` by construction. The throw below is an ASSERTION on that construction, not
 * a fallback: `51 §2.3`'s rule that "a class present in the catalogue with no declared value
 * is a catalogue-validation failure, not a class with a value of one" applies to every field
 * of the record, not only to the unit count.
 */
export function actionCatalogueEntry(
  actionClass: ActionClass,
  bundle?: VerifiedControlArtifactBundle,
): ActionCatalogueEntry {
  const entry = actionCatalogue(bundle).entries[actionClass];
  if (entry === undefined) {
    throw new Error(
      `${actionClass} has no record in the verified class-3 action catalogue; an ` +
        'undeclared class has no authority and no implicit default may widen it ' +
        '(50 §2a, 51 §2.3)',
    );
  }
  return entry;
}

/**
 * `50 §2a` record 12 — the TOTAL map from `reason_code` to `reason_code_scope`.
 *
 * `refundCreate.ts` reads it to check that a proposed reason code belongs to the scope the
 * selected option was addressed under. Before S1K that map was a literal beside the
 * catalogue; it is now signed content, so a deployment cannot widen which reasons reach
 * which refund option by editing a TypeScript file.
 */
export function reasonCodeScopeFor(
  reasonCode: ReasonCode,
  bundle?: VerifiedControlArtifactBundle,
): ReasonCodeScope {
  const scope = actionCatalogue(bundle).reasonCodeScopes[reasonCode];
  if (scope === undefined) {
    throw new Error(
      `${reasonCode} has no scope in the verified class-3 catalogue; 50 §2a record 12 ` +
        'declares a TOTAL map and a missing entry is a catalogue-validation failure',
    );
  }
  return scope;
}

/**
 * `50 §2a` record 13 — per class, the DECLARED ORDERED field list the semantic option digest
 * covers.
 *
 * `26 §2.2`: "the digest must cover every field whose change would make the option a
 * different effect. **Declared per class in the action catalogue**, and a change to any
 * digest definition is a semantic constructor bump."
 *
 * The constructor computes the digest; this is the SIGNED declaration of what it must cover,
 * and `constructors/refundCreate.ts` asserts its own field order against this list before
 * hashing. A constructor that quietly dropped a field from the digest would then fail
 * closed rather than start minting colliding `option_id`s.
 */
export function semanticOptionDigestFieldsFor(
  actionClass: ActionClass,
  bundle?: VerifiedControlArtifactBundle,
): readonly string[] {
  const fields = actionCatalogue(bundle).semanticOptionDigestFields[actionClass];
  if (fields === undefined) {
    throw new Error(
      `${actionClass} has no semantic_option_digest_fields in the verified class-3 ` +
        'catalogue (50 §2a record 13)',
    );
  }
  return fields;
}

/**
 * `50 §2a` record 14 — per class, the enumeration `max_age` checked at C'.
 *
 * `26 §2.0.1`'s staleness bound. It was an S1C fixture constant; it is signed content now,
 * so a deployment cannot make a model reason about a world that has moved by editing a
 * number in `enumerationMaxAge.ts`.
 */
export function enumerationMaxAgeSecondsFor(
  actionClass: ActionClass,
  bundle?: VerifiedControlArtifactBundle,
): number {
  const seconds = actionCatalogue(bundle).enumerationMaxAgeSeconds[actionClass];
  if (seconds === undefined) {
    throw new Error(
      `${actionClass} has no enumeration max_age in the verified class-3 catalogue ` +
        '(50 §2a record 14); a lookup that returned undefined would make the staleness ' +
        'check silently unbounded',
    );
  }
  return seconds;
}

/**
 * `I66` / `25 §7`'s OUTBOX SCOPE PREDICATE, derived from `50 §2a` FIELD 9.
 *
 * `50 §2f`, on this exact derivation: "**`I66`'s outbox scope is DERIVED FROM `adapter`**,
 * not separately stored; `adapter = internal_only` removes an effect from the outbox
 * entirely". The operand's owner is the signed catalogue, which is why the predicate could
 * not stay derived from a literal: an edit to `adapter` is an edit to whether an effect
 * crosses the external-write perimeter at all.
 *
 * THERE IS NO OVERRIDE AND NO PARAMETER. This function takes an entry and reads one field.
 */
export function requiresExternalDispatch(entry: ActionCatalogueEntry): boolean {
  return entry.adapter !== INTERNAL_ONLY_ADAPTER;
}

/** The same predicate, resolved from the VERIFIED catalogue by class. */
export function requiresExternalDispatchFor(
  actionClass: ActionClass,
  bundle?: VerifiedControlArtifactBundle,
): boolean {
  return requiresExternalDispatch(actionCatalogueEntry(actionClass, bundle));
}

/**
 * `51 §2.3`'s unit count, RESOLVED FROM THE VERIFIED CATALOGUE BY CLASS — v1.3.5 (MIE-01),
 * re-rooted on the signed artifact by v1.3.6 (`50 §2a` field 7).
 *
 * =================================================================================
 * THE SIGNATURE IS STILL THE AUTHORITY PROPERTY. READ IT BEFORE THE BODY.
 *
 * One required parameter, an `ActionClass`. There is no units argument, no options bag, no
 * override, no allow list and no default parameter, so `51 §2.3`'s "**there is no generic
 * caller parameter for it, and no request field carries one**" remains a property of this
 * signature. The optional second parameter is the sealed `VerifiedControlArtifactBundle`,
 * which a caller cannot manufacture.
 *
 * `src/kernel/exposure/stepR.ts` is the only production caller, and
 * `tests/integration/gateway/no-real-transport-boundary.test.ts` asserts that no reservation
 * surface under `src/` accepts a unit count as an argument.
 *
 * =================================================================================
 * `51 §2.3`'s COHERENCE RULE IS NOW CHECKED AT VERIFICATION, NOT AT MODULE LOAD
 *
 * "**For every IRRECOVERABLE class in the current catalogue the declared value is `1`, and
 *  for every REVERSIBLE and COMPENSABLE class it is `0`.**"
 *
 * That check used to run at module load over the literal. It now runs inside
 * `controlArtifacts/artifactParsers.ts`, over the VERIFIED bytes, before the bundle can be
 * sealed — so a signed artifact that declared a REVERSIBLE class with a positive count, or
 * an IRRECOVERABLE class with `0`, fails the bootstrap ceremony instead of being loaded and
 * then complained about.
 * =================================================================================
 */
export function irrecoverableUnitsFor(
  actionClass: ActionClass,
  bundle?: VerifiedControlArtifactBundle,
): bigint {
  return actionCatalogueEntry(actionClass, bundle).irrecoverableUnits;
}

/** Every catalogue member's verified record, in `ACTION_CLASSES` order. */
export function actionCatalogueEntries(
  bundle?: VerifiedControlArtifactBundle,
): readonly ActionCatalogueEntry[] {
  return ACTION_CLASSES.map((actionClass) => actionCatalogueEntry(actionClass, bundle));
}
