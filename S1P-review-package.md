# S1P — review package

**Review material only. This file and `S1P-review.diff` are the ONLY files created in this
step. No implementation, test, architecture artifact, documentation or configuration file was
modified, formatted, regenerated, signed, committed, stashed or reset. No release tooling was
run. No SendGrid provider call was made.**

| | |
|---|---|
| baseline | `d897833b14253030f75fe113534df34a9827d464` |
| HEAD at generation | `d897833b14253030f75fe113534df34a9827d464` — unchanged |
| pre-existing S1O review diffs | `S1O-review.diff`, `S1O-correction-review.diff` — **untouched, not deleted, not included** |
| classification | **NOT changed in this step.** The completion report's classification stands as written and is not defended here |

**This artifact is evidence, not argument.** Where the reviewer asked for facts rather than a
case — notably `§H` — the evidence is given without a claim that the choice was correct.

---

## A. Exact Git inventory

### A.1 `git status --short`

```text
 M .gitignore
 M package.json
 M tests/integration/perimeter/perimeter-enumeration.test.ts
 M tools/perimeter/perimeterScan.ts
 M tsconfig.json
?? S1O-correction-review.diff
?? S1O-review.diff
?? docs/implementation/S1P-contract.md
?? docs/implementation/S1P-implementation-log.md
?? docs/implementation/S1P-operator-procedure.md
?? docs/implementation/S1P-owner-clarifications.md
?? docs/implementation/S1P-result.md
?? docs/implementation/S1P-test-matrix.md
?? docs/implementation/evidence/S1P-offline-runs.md
?? tests/negative-controls/sendgrid-controls.test.ts
?? tests/negative-controls/unsafe-sendgrid-validation.ts
?? tests/sendgrid/
?? validation/
```

*(Captured before this review package existed. `S1P-review-package.md` and `S1P-review.diff`
are themselves untracked additions of this step and appear in any later `git status`.)*

### A.2 `git diff --stat`

```text
 .gitignore                                         |  9 +++
 package.json                                       |  1 +
 .../perimeter/perimeter-enumeration.test.ts        | 94 +++++++++++++++++++---
 tools/perimeter/perimeterScan.ts                   | 16 ++++
 tsconfig.json                                      | 14 +++-
 5 files changed, 124 insertions(+), 10 deletions(-)
```

### A.3 `git diff --name-status`

```text
M	.gitignore
M	package.json
M	tests/integration/perimeter/perimeter-enumeration.test.ts
M	tools/perimeter/perimeterScan.ts
M	tsconfig.json
```

### A.4 `git diff --numstat`

```text
9	0	.gitignore
1	0	package.json
85	9	tests/integration/perimeter/perimeter-enumeration.test.ts
16	0	tools/perimeter/perimeterScan.ts
13	1	tsconfig.json
```

Note `--stat` renders the perimeter test as `94 +++...---` (its bar is scaled); `--numstat`
gives the true figures: **85 added, 9 removed**. The `124 insertions / 10 deletions` total is
the authoritative one.

### A.5 S1P-created untracked files — the complete list (32)

Derived from `git status --short --untracked-files=all`, with the two pre-existing S1O review
artifacts removed. `--untracked-files=all` is used deliberately: plain `git status --short`
collapses `tests/sendgrid/` and `validation/` to directory entries and hides 21 of these files.

| # | Path | Group |
|---|---|---|
| 1 | `docs/implementation/S1P-contract.md` | docs (7) |
| 2 | `docs/implementation/S1P-implementation-log.md` | docs |
| 3 | `docs/implementation/S1P-operator-procedure.md` | docs |
| 4 | `docs/implementation/S1P-owner-clarifications.md` | docs |
| 5 | `docs/implementation/S1P-result.md` | docs |
| 6 | `docs/implementation/S1P-test-matrix.md` | docs |
| 7 | `docs/implementation/evidence/S1P-offline-runs.md` | docs |
| 8 | `tests/negative-controls/sendgrid-controls.test.ts` | tests (8) |
| 9 | `tests/negative-controls/unsafe-sendgrid-validation.ts` | tests — **helper, not a `.test.ts`** |
| 10 | `tests/sendgrid/evidence-and-kill-points.test.ts` | tests |
| 11 | `tests/sendgrid/observation.test.ts` | tests |
| 12 | `tests/sendgrid/preflight.test.ts` | tests |
| 13 | `tests/sendgrid/prerequisites-and-separation.test.ts` | tests |
| 14 | `tests/sendgrid/provider-boundary.test.ts` | tests |
| 15 | `tests/sendgrid/request-mapping.test.ts` | tests |
| 16 | `validation/sendgrid/README.md` | validation (17) |
| 17 | `validation/sendgrid/audit/providerReadClient.ts` | validation |
| 18 | `validation/sendgrid/audit/reader.ts` | validation |
| 19 | `validation/sendgrid/audit/secretSource.ts` | validation |
| 20 | `validation/sendgrid/harness/cli.ts` | validation |
| 21 | `validation/sendgrid/harness/evidence.ts` | validation |
| 22 | `validation/sendgrid/harness/killPoints.ts` | validation |
| 23 | `validation/sendgrid/harness/observation.ts` | validation |
| 24 | `validation/sendgrid/harness/preflight.ts` | validation |
| 25 | `validation/sendgrid/harness/run.ts` | validation |
| 26 | `validation/sendgrid/harness/scopeProbes.ts` | validation |
| 27 | `validation/sendgrid/integration/adapter.ts` | validation |
| 28 | `validation/sendgrid/integration/killPointAdapter.ts` | validation |
| 29 | `validation/sendgrid/integration/nonProductionConfig.ts` | validation |
| 30 | `validation/sendgrid/integration/providerClient.ts` | validation |
| 31 | `validation/sendgrid/integration/requestMapping.ts` | validation |
| 32 | `validation/sendgrid/integration/secretSource.ts` | validation |

Not listed, and deliberately:

- `S1O-review.diff`, `S1O-correction-review.diff` — **pre-existing**, belong to the S1O
  review, untouched by S1P and untouched by this step.
- `artifacts/s1p-validation/*.json` — gitignored harness **run output**, not source. One file
  exists from the offline harness run recorded in `S1P-offline-runs.md §1`.
- `node_modules/` — vendor.

### A.6 Reconciliation of the completion-report accounting discrepancy

**THE GIT-DERIVED TOTALS ARE AUTHORITATIVE AND THEY ARE:**

| Measure | Count |
|---|---|
| tracked files modified | **5** |
| S1P-created untracked files | **32** |
| **total repository files touched by S1P** | **37** |
| pre-existing untracked files left alone | 2 |
| files created by THIS review step | 2 (`S1P-review-package.md`, `S1P-review.diff`) |

Claim by claim:

| Completion-report claim | Verdict | Actual |
|---|---|---|
| "Modified (5 tracked files, +124/−10)" | **CORRECT** | 5 files, +124/−10 |
| "New — validation package (**13 files**)" | **WRONG — understated** | **17 files.** The parenthetical count was stale; the list printed immediately after it already contained 17 names (6 integration + 3 audit + 7 harness + `README.md`). The number was not recomputed after the list grew. |
| "New — tests (**7 files**, +87 tests)" | **AMBIGUOUS, and the ambiguity is the defect** | **8 files** under `tests/`. Seven are `.test.ts` files; the eighth, `unsafe-sendgrid-validation.ts`, is the negative-control helper module and is not a test file. The report's "(7 files)" counted test files and its own trailing clause named the eighth, so the sentence contradicted itself. |
| "New — docs (7)" | **CORRECT** | 7 |
| "31 edited files" | **NOT A FIGURE THIS REPORT STATED, AND IT IS WRONG FOR EITHER READING** | The completion report contains no such sentence. If it came from a tool/UI counter, it matches neither 37 (files touched) nor 32 (files created) nor 5 (files modified). **It should be disregarded in favour of the Git-derived 5 / 32 / 37.** |

**The arithmetic that reconciles the report's own groups:**
`17 (validation) + 8 (tests) + 7 (docs) = 32 created`, `+ 5 modified = 37 touched`.
The report's groups summed to `13 + 7 + 7 = 27 + 5 = 32`, which is five short because of the
validation undercount (17 − 13 = 4) and the tests undercount (8 − 7 = 1).

**Vitest totals are not repository file totals.** The report's "191 test files / 2741 tests"
are Vitest's counts of *collected spec files and cases*, and Vitest's "191 files" counts only
`.test.ts` spec files across the whole repository (184 at baseline + 7 new spec files). It is
unrelated to the 37 repository files this slice touched, and the two must not be added,
compared or reconciled against each other.

---

## B. Complete S1P diff

**The complete textual diff is in the companion artifact `S1P-review.diff`** (345,865 bytes,
7,100 lines). The Markdown-inline form was impractical: the tracked diff plus the 6,524 lines
of untracked S1P source would have made this file unreadable, so the split the review brief
permits was taken.

`S1P-review.diff` contains, with nothing truncated and nothing summarised:

| Part | Content |
|---|---|
| **PART 1** | `git diff --no-ext-diff --find-renames d897833 -- .` — the 5 tracked files |
| **PART 2** | All **32** S1P-created untracked files as `/dev/null` patches, each under a `## UNTRACKED FILE: <path>` banner |

**Completeness check, machine-derived:**

```text
diff --git headers in S1P-review.diff        : 37   (5 tracked + 32 untracked)
'## UNTRACKED FILE:' banners                 : 32
source lines of the 32 untracked files on disk: 6524
'+' lines in PART 2 of the patch             : 6524   <- exact match, nothing truncated
```

Excluded from `S1P-review.diff`, deliberately: `S1O-review.diff` and
`S1O-correction-review.diff` (pre-existing S1O review artifacts), `node_modules/`,
`artifacts/s1p-validation/` (gitignored run output), and the two files of this review step.

**No secret material exists anywhere in this tree** — no `.env`, no SendGrid key, no
credential of any kind. The only key-shaped strings in the repository are the S1K test-only
Ed25519 seeds, which are printed in full in `tests/support/controlArtifactFixture.ts` by
design and are unchanged by S1P.

---

## C. S1P-C1 authority sources

The files below are **unmodified by S1P** and are reproduced from the current tree so the
reviewer can evaluate the missing email action without a second checkout. Each is preceded by
its repository path. Nothing is paraphrased.

Where a file exceeds ~20 KB the **exact line range** included is stated and the remainder is
identified by path; those files are tracked, unchanged at `d897833`, and available in the
reviewer's own checkout.

### C.1 Signed class-3 action catalogue — the deployed bytes

#### `artifacts/control/class-03.action-catalogue.json`

```json
{
  "artifact_id": "acos.control.action_catalogue",
  "artifact_version": "acos.action_catalogue.2026-09-24",
  "action_classes": [
    {
      "action_class": "campaign.pause",
      "recoverability": "REVERSIBLE",
      "value_direction": "NONE",
      "carries_vendor_monetary_field": false,
      "cost_component_free": true,
      "rate_based": false,
      "irrecoverable_units": "0",
      "settlement_tolerance": "NONE",
      "adapter": "mock_ads",
      "method": "campaignPause"
    },
    {
      "action_class": "refund.create",
      "recoverability": "COMPENSABLE",
      "value_direction": "INBOUND_ORIGINAL_INSTRUMENT",
      "carries_vendor_monetary_field": true,
      "cost_component_free": false,
      "rate_based": false,
      "irrecoverable_units": "0",
      "settlement_tolerance": "EXACT",
      "adapter": "mock_processor",
      "method": "refundCreate"
    },
    {
      "action_class": "fulfilment.reship",
      "recoverability": "IRRECOVERABLE",
      "value_direction": "OUTBOUND_GOODS_TO_ADDRESS",
      "carries_vendor_monetary_field": false,
      "cost_component_free": false,
      "rate_based": false,
      "irrecoverable_units": "1",
      "settlement_tolerance": "BAND",
      "adapter": "mock_commerce",
      "method": "fulfilmentReship"
    },
    {
      "action_class": "campaign.budget.set",
      "recoverability": "COMPENSABLE",
      "value_direction": "OUTBOUND_TO_COUNTERPARTY",
      "carries_vendor_monetary_field": false,
      "cost_component_free": true,
      "rate_based": true,
      "irrecoverable_units": "0",
      "settlement_tolerance": "BAND",
      "adapter": "mock_ads",
      "method": "campaignBudgetSet"
    }
  ],
  "reason_codes": [
    "CUSTOMER_REPORTED_DAMAGE",
    "CUSTOMER_REPORTED_NOT_RECEIVED",
    "ITEM_RETURNED",
    "DUPLICATE_CHARGE",
    "PRICING_ERROR"
  ],
  "reason_code_scopes": {
    "CUSTOMER_REPORTED_DAMAGE": "GOODS_FAULT",
    "CUSTOMER_REPORTED_NOT_RECEIVED": "GOODS_FAULT",
    "ITEM_RETURNED": "GOODS_RETURNED",
    "DUPLICATE_CHARGE": "BILLING_ERROR",
    "PRICING_ERROR": "BILLING_ERROR"
  },
  "semantic_option_digest_fields": {
    "campaign.pause": [],
    "refund.create": [
      "line_id",
      "parent_transaction_id",
      "amount",
      "instrument",
      "reason_code_scope"
    ],
    "fulfilment.reship": [],
    "campaign.budget.set": []
  },
  "enumeration_max_age_seconds": {
    "campaign.pause": 120,
    "refund.create": 120,
    "fulfilment.reship": 120,
    "campaign.budget.set": 120
  }
}
```

### C.2 The parser that validates class 3

`src/kernel/controlArtifacts/artifactParsers.ts` is 922 lines / 37,956 bytes. The class-3
parser is **lines 300–511** and is reproduced complete below. The same file also holds
`parseClass5CredentialScopes` (633–746), `parseClass2PolicySet` (747–810) and
`parseClass19ConstructorSet` (895–922), reproduced in C.5, C.7 and C.8. The remainder is
classes 20, 24 and 27 and shared JSON helpers.

**The exhaustiveness rule that makes `S1P-C1` non-bounded is at line 357.**

#### `src/kernel/controlArtifacts/artifactParsers.ts` lines 300–511 (class-3 parser)

```typescript
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
        `${at}.action_class is ${quoted(actionClass)}, which is outside the closed ` +
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
        `${where}.reason_codes[${String(index)}] is ${quoted(code)}, outside the ` +
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
```

### C.3 Authoritative action-class and recoverability type definitions

`ACTION_CLASSES` is `SR7`'s single extension point. Adding a member here is what forces a
class-3 record, because of the exhaustiveness check at `artifactParsers.ts:357` above.

#### `src/kernel/canonicalisation/actionClasses.ts`

```typescript
/**
 * THE CLOSED MEMBER SETS AND THEIR TYPESCRIPT TYPES — and NOT their authority values.
 *
 * =================================================================================
 * WHAT MAY STAY A CONSTANT AFTER S1K, AND WHAT MAY NOT
 *
 * `50 §3c`: "**A signed control artifact and a separate hard-coded production literal may
 * not both be authority sources**, with equality asserted only in a test; that arrangement
 * leaves the unsigned literal authoritative, because the test is not in the authority path."
 *
 * `§17` of the S1K mandate draws the line this file sits on: "Constants may remain for:
 * TypeScript enum names; parser machinery; structural schemas; but not for independent
 * authority values that can disagree with the signed artifact."
 *
 * SO THIS FILE HOLDS MEMBER SETS AND TYPES, AND NOTHING THAT DECIDES ANYTHING.
 *
 *   `ACTION_CLASSES`   the closed catalogue's MEMBER SET — `SR7`'s single extension point,
 *                      and the union every signature in `src/` is written against. Adding a
 *                      member here adds a TypeScript name; it adds no recoverability, no
 *                      adapter, no unit count and no authority, all of which arrive only
 *                      from the verified class-3 artifact.
 *
 *   `REASON_CODES`     the same, for `26 §2.0`'s closed enum.
 *
 *   the type unions    `Recoverability`, `ValueDirection`, `ReasonCodeScope` — the DOMAINS
 *                      `50 §2a` fields 2 and 3 and record 12 declare. A parser needs them to
 *                      refuse a value outside the domain; none of them says which value a
 *                      class has.
 *
 * WHAT IS NOT HERE, AND WAS BEFORE S1K: the per-class entry table and the reason-code scope
 * map. Both were authority values and both now come from `50 §2a`'s signed artifact through
 * `actionCatalogue.ts`'s accessors.
 *
 * =================================================================================
 * WHY IT IS A SEPARATE FILE
 *
 * The class-3 PARSER must refuse a member outside the closed set, so it needs these names;
 * `actionCatalogue.ts` must read the verified bundle, so it needs the registry. Leaving both
 * in one module would make `actionCatalogue -> registry -> verifier -> parser ->
 * actionCatalogue` a runtime import cycle. ES modules survive that, and a cycle on the
 * authority path is still a thing to remove rather than to reason about.
 * =================================================================================
 */

/** `26 §5`. Assigned per action class BY THE VERIFIED CATALOGUE, never per request. */
export type Recoverability = 'REVERSIBLE' | 'COMPENSABLE' | 'IRRECOVERABLE';

/** `26 §2.1`. "From the catalogue, never null (I59)." */
export type ValueDirection =
  | 'NONE'
  | 'INBOUND_ORIGINAL_INSTRUMENT'
  | 'OUTBOUND_TO_COUNTERPARTY'
  | 'INTERNAL_LIABILITY'
  | 'OUTBOUND_TO_THIRD_PARTY_BENEFICIARY'
  | 'OUTBOUND_GOODS_TO_ADDRESS';

/** `51 §5.1`, `I18d`. The domain of `50 §2a` field 8. */
export type SettlementTolerance = 'EXACT' | 'BAND' | 'NONE';

/**
 * `37 §2` S1's closed catalogue: "exactly three classes: one REVERSIBLE, one COMPENSABLE,
 * one IRRECOVERABLE, all against a mock adapter — plus one rate-based class against a mock".
 *
 * The MEMBERSHIP is here. Which of them is which is `50 §2a` field 2's business.
 */
export const ACTION_CLASSES = [
  'campaign.pause',
  'refund.create',
  'fulfilment.reship',
  'campaign.budget.set',
] as const;

export type ActionClass = (typeof ACTION_CLASSES)[number];

const ACTION_CLASS_SET: ReadonlySet<string> = new Set<string>(ACTION_CLASSES);

export function isActionClass(value: string): value is ActionClass {
  return ACTION_CLASS_SET.has(value);
}

/**
 * `26 §2.0`'s closed `reason_code` enum, as the S1B fixture declared it under clarification
 * S1B-C6. `50 §2a` record 11 is what SIGNS it.
 *
 * The point of the closure is that `reason_code` is NOT free text, which is what leaves
 * `rationale` as the only free text on the model-facing surface.
 */
export const REASON_CODES = [
  'CUSTOMER_REPORTED_DAMAGE',
  'CUSTOMER_REPORTED_NOT_RECEIVED',
  'ITEM_RETURNED',
  'DUPLICATE_CHARGE',
  'PRICING_ERROR',
] as const;

export type ReasonCode = (typeof REASON_CODES)[number];

const REASON_CODE_SET: ReadonlySet<string> = new Set<string>(REASON_CODES);

export function isReasonCode(value: string): value is ReasonCode {
  return REASON_CODE_SET.has(value);
}

/**
 * `26 §2.2`'s coarser grouping. The DOMAIN is here; `50 §2a` record 12's total map — which
 * code sits in which scope — is signed content and arrives from the verified artifact.
 */
export type ReasonCodeScope = 'GOODS_FAULT' | 'GOODS_RETURNED' | 'BILLING_ERROR';

/** `50 §2a` field 9's reserved sentinel. `I66`'s outbox scope predicate reads it. */
export const INTERNAL_ONLY_ADAPTER = 'internal_only';
```

### C.4 The verified-catalogue accessors the kernel reads through

#### `src/kernel/canonicalisation/actionCatalogue.ts`

```typescript
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
      `${actionClass} has no record in the verified class-3 artifact; it is not a member ` +
        'of the closed action catalogue, and an undeclared class has no authority — no ' +
        'implicit default may widen it (SR7, 50 §2a, 51 §2.3)',
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
```

### C.5 Signed class-5 credential/capability declaration — deployed bytes and its risk model

`NON_MONETARY_WRITE` is field 6 of `50 §2g`. The deployed declaration carries **no SendGrid
credential of either kind**; `twilio_sendgrid` appears nowhere in it.

#### `artifacts/control/class-05.credential-scopes.json`

```json
{
  "artifact_id": "acos.control.credential_scopes",
  "artifact_version": "acos.credential_scopes.2026-09-26",
  "credentials": [
    {
      "credential_id": "mock_ads.budget_manage",
      "adapter": "mock_ads",
      "provider": "synthetic_ads",
      "granted_provider_permissions": [
        "campaign.budget.set",
        "campaign.pause",
        "campaign.read"
      ],
      "monetary_provider_permissions": ["campaign.budget.set"],
      "credential_risk_class": "MONEY_MOVING",
      "external_mutation_capable": true
    },
    {
      "credential_id": "mock_ads.pause_only",
      "adapter": "mock_ads",
      "provider": "synthetic_ads",
      "granted_provider_permissions": ["campaign.pause", "campaign.read"],
      "monetary_provider_permissions": [],
      "credential_risk_class": "NON_MONETARY_WRITE",
      "external_mutation_capable": true
    },
    {
      "credential_id": "mock_commerce.fulfilment",
      "adapter": "mock_commerce",
      "provider": "synthetic_commerce",
      "granted_provider_permissions": ["fulfilment.read", "fulfilment.reship"],
      "monetary_provider_permissions": [],
      "credential_risk_class": "NON_MONETARY_WRITE",
      "external_mutation_capable": true
    },
    {
      "credential_id": "mock_processor.refund",
      "adapter": "mock_processor",
      "provider": "synthetic_psp",
      "granted_provider_permissions": ["payment.read", "payment.refund"],
      "monetary_provider_permissions": ["payment.refund"],
      "credential_risk_class": "MONEY_MOVING",
      "external_mutation_capable": true
    },
    {
      "credential_id": "synthetic_esp.audit_read",
      "adapter": "audit_plane",
      "provider": "synthetic_esp",
      "granted_provider_permissions": ["email_activity.read"],
      "monetary_provider_permissions": [],
      "credential_risk_class": "READ_ONLY",
      "external_mutation_capable": false
    },
    {
      "credential_id": "synthetic_esp.mixed_send",
      "adapter": "mock_ads",
      "provider": "synthetic_esp",
      "granted_provider_permissions": ["mail.send", "payment.refund"],
      "monetary_provider_permissions": ["payment.refund"],
      "credential_risk_class": "MONEY_MOVING",
      "external_mutation_capable": true
    }
  ]
}
```

#### `src/kernel/controlArtifacts/credentialRisk.ts`

```typescript
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

/**
 * `50 §2g` FIELD 1 — WHAT A `credential_id` IS, AND WHY A LABEL IS NOT ONE.
 *
 * =================================================================================
 * THE DEFECT THIS SECTION EXISTS TO CLOSE
 *
 * v1.3.7's first draft made field 1 "a unique identity for the credential, never the
 * material" and stopped there. That is satisfiable by a NICKNAME, and a nickname makes the
 * whole risk declaration governable by whoever writes the wiring:
 *
 *     signed record        `mock_ads.pause_only`  ->  NON_MONETARY_WRITE
 *     secret locator       resolves ...................  `mock_ads.budget_manage`'s material
 *
 * The risk class was read off record A and the material presented at the provider is
 * credential B's. Nothing in the chain is forged, no signature is broken, and the deployment
 * is running a `MONEY_MOVING` credential under a `NON_MONETARY_WRITE` declaration. The audit
 * plane has the mirror image: a signed `READ_ONLY` record and a send-capable token.
 *
 * =================================================================================
 * SO `credential_id` IS DEFINED AS A BINDING, NOT AS A NAME
 *
 * `50 §2g` field 1, v1.3.7 as corrected:
 *
 *   **THE STABLE NON-SECRET IDENTITY OF THE EXACT CREDENTIAL MATERIAL THE RUNTIME MAY
 *   PRESENT.** It is not a friendly alias, not an adapter-local name and not a descriptor
 *   label.
 *
 *   * where the provider exposes a stable API-key ID, field 1 IS that provider key ID;
 *   * where it does not, field 1 is an immutable deployment/secret-manager credential
 *     identity or version that the secret source can return for the exact material it
 *     resolved;
 *   * **never** the raw secret, a hash or fingerprint of it, or a token prefix used as an
 *     ad-hoc identity.
 *
 * **IF NO SUCH IDENTITY CAN BE DEFINED FOR A PROVIDER, THE SLICE THAT WOULD CONFIGURE IT
 * RETURNS PARTIAL.** A binding that is only a label must not be claimed as a binding.
 *
 * =================================================================================
 * AND THE BINDING IS CHECKED AT RUNTIME, ON BOTH PLANES, BEFORE THE PROVIDER BOUNDARY
 *
 * `adapterRuntimeRegistry` and `auditReaderRegistry` select a SIGNED record by field 1. The
 * credential-holding child then resolves its own material and asks its source which
 * credential that material IS. The two must be equal:
 *
 *     signed expected credential identity  ==  secret-source resolved credential identity
 *
 * and a mismatch REFUSES before any provider operation —
 * `CREDENTIAL_IDENTITY_MISMATCH` on the integration plane and on the audit plane, each in
 * its own closed refusal set.
 *
 * **LOCATOR SEPARATION IS A DIFFERENT CONTROL AND DOES NOT IMPLY THIS ONE.** Two locators
 * may name one credential, and one locator may be repointed at another; a locator says
 * where to look and an identity says what was found. Both controls are kept.
 */
export const CREDENTIAL_IDENTITY_PROVENANCES = [
  /** The provider's own stable, non-secret key identifier for this exact credential. */
  'PROVIDER_KEY_ID',
  /** An immutable secret-manager credential identity/version naming this exact material. */
  'DEPLOYMENT_SECRET_VERSION',
  /** A TEST-ONLY synthetic identity. Never admissible for a configured real credential. */
  'SYNTHETIC_TEST_IDENTITY',
] as const;

export type CredentialIdentityProvenance = (typeof CREDENTIAL_IDENTITY_PROVENANCES)[number];

export function isCredentialIdentityProvenance(
  value: unknown,
): value is CredentialIdentityProvenance {
  return (
    typeof value === 'string' &&
    (CREDENTIAL_IDENTITY_PROVENANCES as readonly string[]).includes(value)
  );
}

/**
 * The three things a credential identity is NEVER derived from. Documentation, not a matcher.
 *
 * The structural half of the rule is `credentialLabelsAreNonDerived` in each plane's own
 * secret-source contract, which refuses a label that CONTAINS its secret, is contained by
 * it, or is a hex/base64 encoding of it. Neither can refuse every derivation, and neither is
 * claimed to: what they close is the accident, and this list is what a reviewer reads.
 */
export const FORBIDDEN_CREDENTIAL_IDENTITY_FORMS: readonly string[] = Object.freeze([
  'the raw secret',
  'a hash or fingerprint of the secret',
  'a token prefix used as an ad-hoc identity',
]);

/**
 * The binding comparison. Returns the REASON a resolved credential is the wrong one, or
 * `null` when the signed record and the resolved material agree.
 *
 * A NAMED FUNCTION RATHER THAN AN INLINE `!==`, because this is the one comparison that
 * decides whether a risk declaration governs the credential it was signed for, and a reader
 * auditing the call sites should be able to find them by name. An empty resolved identity is
 * NOT equality with an empty expectation: `50 §2g` requires a configured credential to have
 * one, so absence is a refusal rather than a match.
 */
export function credentialIdentityMismatch(
  expectedCredentialId: string,
  resolvedCredentialIdentity: string,
): string | null {
  if (expectedCredentialId.length === 0) {
    return (
      'the launch configuration carried no expected credential identity; 50 §2g field 1 is ' +
      'the identity of the exact material the runtime may present, and an absent ' +
      'expectation cannot bind one'
    );
  }
  if (resolvedCredentialIdentity.length === 0) {
    return (
      'the secret source returned no credential identity for the material it resolved; ' +
      '50 §2g: a null identity is not sufficient for a configured credential'
    );
  }
  if (expectedCredentialId !== resolvedCredentialIdentity) {
    return (
      `the signed class-5 record governs credential "${expectedCredentialId}" and the ` +
      `secret source resolved material identified as "${resolvedCredentialIdentity}"; the ` +
      'risk declaration would govern the wrong credential'
    );
  }
  return null;
}
```

#### `src/kernel/controlArtifacts/artifactParsers.ts` lines 633–746 (class-5 parser)

```typescript
export function parseClass5CredentialScopes(
  bytes: Uint8Array,
): VerifiedCredentialScopeDeclaration {
  const where = 'the class-5 credential-scope declaration';
  const document = parseJson(bytes, where);
  assertExactFields(document, CLASS_5_FIELDS, where);
  const artifactVersion = artifactHeader(document, 'acos.control.credential_scopes', where);

  const rawCredentials = document.credentials;
  if (!Array.isArray(rawCredentials)) {
    integrityFailure('ARTIFACT_CONTENT_INVALID', `${where}.credentials is not an array`);
  }

  const credentials: Record<string, VerifiedCredentialScope> = {};
  const credentialIds: string[] = [];

  for (const [index, raw] of rawCredentials.entries()) {
    const at = `${where}.credentials[${String(index)}]`;
    const record = asObject(raw, at);
    assertExactFields(record, CLASS_5_CREDENTIAL_FIELDS, at);

    const credentialId = asString(record.credential_id, `${at}.credential_id`);
    if (credentialId.length === 0) {
      integrityFailure('ARTIFACT_CONTENT_INVALID', `${at}.credential_id is empty`);
    }
    if (credentialId in credentials) {
      integrityFailure(
        'ARTIFACT_CONTENT_INVALID',
        `${where} carries two records for credential ${quoted(credentialId)}; one identity ` +
          "has one option-B trigger answer, and two records give it two",
      );
    }
    if (credentialIds.length > 0 && credentialIds[credentialIds.length - 1]! >= credentialId) {
      integrityFailure(
        'ARTIFACT_CONTENT_INVALID',
        `${where}.credentials is not in strictly ascending credential_id order at index ` +
          `${String(index)}`,
      );
    }

    const riskClass = asString(record.credential_risk_class, `${at}.credential_risk_class`);
    if (!isCredentialRiskClass(riskClass)) {
      integrityFailure(
        'ARTIFACT_CONTENT_INVALID',
        `${at}.credential_risk_class is ${quoted(riskClass)}; 50 §2g closes the set at ` +
          `[${CREDENTIAL_RISK_CLASSES.join(', ')}] and admits no fourth value — there is no ` +
          'UNKNOWN, and a value outside the set is not a permissive default',
      );
    }

    const scope: VerifiedCredentialScope = Object.freeze({
      credentialId,
      adapter: asString(record.adapter, `${at}.adapter`),
      provider: asString(record.provider, `${at}.provider`),
      grantedProviderPermissions: asPermissionList(
        record.granted_provider_permissions,
        `${at}.granted_provider_permissions`,
        { allowEmpty: false },
      ),
      monetaryProviderPermissions: asPermissionList(
        record.monetary_provider_permissions,
        `${at}.monetary_provider_permissions`,
        { allowEmpty: true },
      ),
      credentialRiskClass: riskClass,
      externalMutationCapable: asBoolean(
        record.external_mutation_capable,
        `${at}.external_mutation_capable`,
      ),
    });

    const inconsistency = credentialDeclarationInconsistency(scope);
    if (inconsistency !== null) {
      integrityFailure(
        'ARTIFACT_CONTENT_INVALID',
        `${at} disagrees with itself: ${inconsistency} (50 §2g)`,
      );
    }

    credentials[credentialId] = scope;
    credentialIds.push(credentialId);
  }

  return Object.freeze({
    artifactVersion,
    credentialIds: Object.freeze(credentialIds),
    credentials: Object.freeze(credentials),
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
```

### C.6 Class-2 / Cedar — the policy set that would have to recognise a new action class

The deployed class-2 artifact carries a Cedar **schema** and **two** policies, both for
`refund.create`. `26 §2.3` makes the schema a CLOSURE: a request whose context carries an
attribute the schema does not declare is REJECTED, which is why a new action class is a
class-2 question and not only a class-3 one.

The artifact is 12,956 bytes and its `schema` member is one long JSON string. It is
reproduced complete below.

#### `artifacts/control/class-02.policy-set.json`

```json
{
  "artifact_id": "acos.control.policy_set",
  "artifact_version": "acos.policy_set.2026-09-24",
  "schema": "// ACOS Cedar schema — control artifact, `50 §2` class 2 (\"Policy set (Cedar source +\n// compiled artifact)\"), signer \"Owner, second factor\", halt scope \"All effects\".\n//\n// THIS FILE IS THE CLOSURE.\n//\n// `26 §2.3`, on what is deliberately absent from the authority tuple, and `26 §7` property\n// 2, verbatim: \"The kernel constructs the request (step C′). It never accepts an amount, a\n// percentage, a vendor parameter or a counterparty from the proposer.\"\n//\n// Cedar enforces the second half of that structurally: a request whose context carries an\n// attribute this schema does not declare is REJECTED at parse time --\n//\n//   while parsing context, record attribute `evil` should not exist according to the schema\n//\n// -- so there is no generic policy-attribute map, no escape hatch, and nowhere for a\n// model-originated value to be placed even by a caller that wanted to. The context record\n// below is exactly the operand set `26 §8`'s worked refund policy reads, and nothing else.\n//\n// WHAT IS DELIBERATELY NOT DECLARED HERE\n//\n// No window attribute of any kind. `26 §8`'s worked policy carries four window-headroom\n// terms; `26 §7` places window headroom at step R (`DENY: WINDOW_EXHAUSTED`) rather than at\n// step M, ADR-005 states that \"numeric aggregation over time windows lives in the exposure\n// ledger, not in policy\", and `36 §4` item 2 repeats it. S1D implements step M and does not\n// implement step R, so declaring a window attribute would create a position in which a\n// fixture-supplied headroom could masquerade as an evaluated policy operand. The omission is\n// recorded as an OPEN obligation in docs/implementation/S1D-result.md rather than papered\n// over here.\n//\n// No `rationale`, and no lineage commitment that covers it. `26 §2.0`: \"NEVER parsed,\n// NEVER interpreted as authority.\"\n\nnamespace Acos {\n\n  // `26 §3`'s `Principal.role`, as the Cedar group `26 §8` writes as\n  // `principal in Role::\"support_reasoner\"`.\n  entity Role;\n\n  // `26 §3`: \"A principal is not 'an agent.' It is a resolved, attributable identity with a\n  // verified chain.\" Its role membership is a parent edge, which is what makes `in` the\n  // right operator in the worked policy.\n  entity Principal in [Role] = {\n    kind: String,\n    delegation_depth: Long,\n  };\n\n  // `26 §8`: `resource is Order`, with `resource.exists` and `resource.grade == \"RECORD\"`.\n  entity Order = {\n    exists: Bool,\n    grade: String,\n  };\n\n  action \"refund.create\" appliesTo {\n    principal: [Principal],\n    resource: [Order],\n    context: {\n      // `26 §2.1.1`, SR-C1: the cap operand. NOT `vendor_amount`, which is deliberately\n      // ABSENT from this schema so that no policy can be written against it by accident and\n      // no request can carry it. The vulnerable negative control in\n      // tests/negative-controls/ has to place the vendor amount INTO this field to express\n      // the defect, which is precisely why the defect is observable.\n      exposure: {\n        total_exposure: decimal,\n      },\n      // `26 §2.1`: \"the enumerated option whose option_id the selector names\". Every field\n      // here is projected by the Effect Canonicaliser off the option resolved from the LIVE\n      // C′ enumeration (S1C), never from `ProposedIntent`.\n      selected_option: {\n        amount: decimal,\n        instrument: String,\n        // `26 §8`: \"enumerated from the order at fetch time\". Current policy state,\n        // deliberately not part of `option_id` -- see `types.ts`.\n        line_refundable_remaining: decimal,\n      },\n      // One of the four fields `I21` permits to cross from `ProposedIntent`. It selects\n      // nothing monetary: the closed enum is `actionCatalogue.ts` and the APPROVED subset is\n      // a literal inside the hash-committed policy artifact, not a request field.\n      reason_code: String,\n      // `26 §2.1`: \"NEW | RETURNING | null -- the payer of the original transaction, NOT a\n      // counterparty\". Optional because the architecture types it nullable; a policy reading\n      // it must guard with `has`, so an absent novelty fails the grant closed rather than\n      // defaulting.\n      customer_novelty?: String,\n    }\n  };\n}\n",
  "policies": [
    {
      "id": "acos.refund.create.grant",
      "source": "// acos.refund.create.grant\n//\n// Control artifact, `50 §2` class 2. Signer: Owner, second factor. Halt scope: all effects.\n//\n// `26 §8`, \"Support may refund an existing order up to $25 for an approved reason\",\n// transcribed. The architecture's sketch, verbatim:\n//\n//   permit(principal in Role::\"support_reasoner\",\n//          action == Action::\"refund.create\",\n//          resource is Order)\n//   when {\n//     resource.exists && resource.grade == \"RECORD\" &&\n//     context.exposure.total_exposure <= 25.00 &&            // v1.2: TOTAL, incl. retained fee\n//     context.selected_option.line_refundable_remaining >=\n//         context.selected_option.amount &&                  // enumerated from the order at fetch time\n//     context.selected_option.instrument == \"original\" &&    // v1.2: an ENUMERATED dimension\n//     context.reason_code in ApprovedReasons &&\n//     context.customer_novelty in [NEW, RETURNING] &&        // v1.1: NOT a counterparty test\n//     exposure.window(\"W_DAY_REFUND\").count_headroom > 0 &&\n//     exposure.window(\"W_MONTH_REFUND\").count_headroom > 0 &&\n//     exposure.window(\"W_DAY_REFUND\").monetary_headroom >=\n//         context.exposure.total_exposure &&\n//     exposure.window(\"W_MONTH_REFUND\").monetary_headroom >=\n//         context.exposure.total_exposure\n//   };\n//\n// and the sentence governing every operand, verbatim:\n//\n//   \"v1.1: every operand below is a kernel-computed field. [...] The `context.exposure.*`\n//    and `context.selected_option.*` values here are produced by the Effect Canonicaliser\n//    (§2.1) from authoritative state, and I21 makes it a type-level property that they\n//    cannot come from anywhere else.\"\n//\n// ---------------------------------------------------------------------------------\n// THE FOUR WINDOW TERMS ARE ABSENT, AND THE ABSENCE IS DECLARED\n//\n// `26 §7` puts window headroom at STEP R -- \"R -- any window lacks headroom -> D13\n// DENY: WINDOW_EXHAUSTED\" -- and step R is the reservation, which S1D does not implement.\n// ADR-005's consequences paragraph, verbatim: \"Cedar cannot express everything: numeric\n// aggregation over time windows lives in the exposure ledger, not in policy\". `36 §4` item\n// 2 says the same.\n//\n// The four terms are therefore NOT silently dropped and NOT faked: `acos.cedarschema`\n// declares no window attribute at all, so there is no position in which a fixture-supplied\n// headroom could be presented to Cedar as an evaluated operand. The obligation is carried\n// openly in docs/implementation/S1D-result.md.\n//\n// Consequence a reader must hold: a PERMIT from this policy set is a STEP-M permit. It is\n// not an `AuthorizationDecision`, and `PolicyPermit` in `decision.ts` says so in its type\n// name and its comment.\n//\n// ---------------------------------------------------------------------------------\n// `ApprovedReasons`, AND WHY IT IS A LITERAL SET IN THE POLICY ARTIFACT\n//\n// `26 §2.0` types `reason_code` as \"from a closed enum\" and never enumerates the members;\n// S1B declared the closed enum as a fixture under clarification S1B-C6 and recorded it as a\n// fixture rather than an architecture claim. `ApprovedReasons` is the APPROVED SUBSET of\n// that enum, and it is a grant/policy fact.\n//\n// It lives here, as a literal, because here is the only place a caller cannot reach: the\n// artifact is a `50 §2` class 2 control artifact whose digest is bound into every decision,\n// and there is no request field, entity attribute or constructor parameter through which a\n// different approved set could be supplied. Putting it in an entity store built at request\n// time would have moved it back onto the code path.\n//\n// The set below is every member of S1B's closed `REASON_CODES` fixture. `26 §8` gives no\n// grounds for excluding any of the five, and inventing an exclusion in order to have a\n// smaller set would be an invented policy quantity. It is recorded as an S1D fixture\n// decision (S1D-C4), not as an architecture claim.\n//\n// Cedar renders `in` over a value set as `.contains()`; `in` is reserved for entity\n// hierarchy. The principal clause below does use entity `in`, exactly as `26 §8` writes it.\n\npermit(\n  principal in Acos::Role::\"support_reasoner\",\n  action == Acos::Action::\"refund.create\",\n  resource is Acos::Order\n)\nwhen {\n  resource.exists &&\n  resource.grade == \"RECORD\" &&\n  // SR-C1. TOTAL, including the retained fee. Duplicated by design from\n  // acos.refund.create.per_action_max, which carries the same figure as a `forbid` so that\n  // P1 holds over the whole policy set and not merely over this permit.\n  context.exposure.total_exposure.lessThanOrEqual(decimal(\"25.00\")) &&\n  context.selected_option.line_refundable_remaining.greaterThanOrEqual(\n    context.selected_option.amount\n  ) &&\n  context.selected_option.instrument == \"original\" &&\n  [\"CUSTOMER_REPORTED_DAMAGE\",\n   \"CUSTOMER_REPORTED_NOT_RECEIVED\",\n   \"ITEM_RETURNED\",\n   \"DUPLICATE_CHARGE\",\n   \"PRICING_ERROR\"].contains(context.reason_code) &&\n  // `26 §2.1` types this nullable. The `has` guard is what makes an absent novelty fail the\n  // grant CLOSED rather than short-circuiting into a Cedar evaluation error.\n  context has customer_novelty &&\n  [\"NEW\", \"RETURNING\"].contains(context.customer_novelty)\n};\n"
    },
    {
      "id": "acos.refund.create.per_action_max",
      "source": "// acos.refund.create.per_action_max\n//\n// Control artifact, `50 §2` class 2. Signer: Owner, second factor. Halt scope: all effects.\n//\n// ---------------------------------------------------------------------------------\n// WHY THIS IS A `forbid` AND NOT MERELY A CONJUNCT OF THE GRANT\n//\n// `26 §11`, property P1, verbatim:\n//\n//   \"P1 | No policy path permits `refund.create` whose **`exposure.total_exposure`**\n//    exceeds the configured per-action cap. *(v1.2: the operand is `total_exposure`, not\n//    the vendor amount -- SR-C1.)*\"\n//\n// \"No policy path permits\" is a statement about the entire policy set. A `when` clause\n// inside one `permit` cannot carry it: a second permit added later, for another role, for\n// another resource group, under another grant, would satisfy P1's negation without touching\n// this file. In Cedar a `forbid` is the only construct that holds regardless of what permits\n// exist, so P1 is expressed as one.\n//\n// The `<= 25.00` term ALSO appears in `acos.refund.create.grant`, exactly as `26 §8` writes\n// it. That duplication is deliberate and is asserted by\n// tests/policy/policy-artifacts.test.ts: the two literals must be the same figure, and\n// `51 §3.1`'s figure.\n//\n// ---------------------------------------------------------------------------------\n// THE OPERAND, AND THE LIMIT\n//\n// `51 §3.1`, verbatim:\n//\n//   \"| `refund.create` | **$25.00** | 2 | **10** | `INBOUND_ORIGINAL_INSTRUMENT` |\n//    COMPENSABLE | `EXACT` |\"\n//\n//   \"`per_action_max.monetary` is compared against **`exposure.total_exposure`**, not\n//    `exposure.vendor_amount` (SR-C1, `26 §8`). For a $25.00 line refund carrying a $1.03\n//    retained processing fee, `total_exposure = $26.03` and the action **denies**\n//    `PER_ACTION`.\"\n//\n// `26 §8` fixes the comparison as `<=`, and `26 §11.2` row 3 repeats it as\n// \"Bounded by `total_exposure <= $25.00`\". At the limit is INSIDE the limit.\n//\n// The figure is a literal HERE, in the hash-committed artifact, and nowhere else in the tree.\n// It is not a request field, not a constructor parameter, not an environment variable and\n// not a fixture: a caller has no position in which to supply or replace it, and a substituted\n// artifact moves the policy-set digest that every decision records (`26 §11`).\n//\n// ---------------------------------------------------------------------------------\n// ATTRIBUTION\n//\n// Cedar's `diagnostics.reason` names the determining policy. This policy's id is the sole\n// member of the PER_ACTION family in `src/kernel/policy/denialCategory.ts`, so a denial in\n// which it is determining maps onto `26 §7` step M's terminal `D11 -- DENY: PER_ACTION`,\n// deterministically and without inspecting any amount.\n\nforbid(\n  principal,\n  action == Acos::Action::\"refund.create\",\n  resource\n)\nunless {\n  context.exposure.total_exposure.lessThanOrEqual(decimal(\"25.00\"))\n};\n"
    }
  ]
}
```

#### `src/kernel/policy/artifacts/policies/acos.refund.create.grant.cedar`

```cedar
// acos.refund.create.grant
//
// Control artifact, `50 §2` class 2. Signer: Owner, second factor. Halt scope: all effects.
//
// `26 §8`, "Support may refund an existing order up to $25 for an approved reason",
// transcribed. The architecture's sketch, verbatim:
//
//   permit(principal in Role::"support_reasoner",
//          action == Action::"refund.create",
//          resource is Order)
//   when {
//     resource.exists && resource.grade == "RECORD" &&
//     context.exposure.total_exposure <= 25.00 &&            // v1.2: TOTAL, incl. retained fee
//     context.selected_option.line_refundable_remaining >=
//         context.selected_option.amount &&                  // enumerated from the order at fetch time
//     context.selected_option.instrument == "original" &&    // v1.2: an ENUMERATED dimension
//     context.reason_code in ApprovedReasons &&
//     context.customer_novelty in [NEW, RETURNING] &&        // v1.1: NOT a counterparty test
//     exposure.window("W_DAY_REFUND").count_headroom > 0 &&
//     exposure.window("W_MONTH_REFUND").count_headroom > 0 &&
//     exposure.window("W_DAY_REFUND").monetary_headroom >=
//         context.exposure.total_exposure &&
//     exposure.window("W_MONTH_REFUND").monetary_headroom >=
//         context.exposure.total_exposure
//   };
//
// and the sentence governing every operand, verbatim:
//
//   "v1.1: every operand below is a kernel-computed field. [...] The `context.exposure.*`
//    and `context.selected_option.*` values here are produced by the Effect Canonicaliser
//    (§2.1) from authoritative state, and I21 makes it a type-level property that they
//    cannot come from anywhere else."
//
// ---------------------------------------------------------------------------------
// THE FOUR WINDOW TERMS ARE ABSENT, AND THE ABSENCE IS DECLARED
//
// `26 §7` puts window headroom at STEP R -- "R -- any window lacks headroom -> D13
// DENY: WINDOW_EXHAUSTED" -- and step R is the reservation, which S1D does not implement.
// ADR-005's consequences paragraph, verbatim: "Cedar cannot express everything: numeric
// aggregation over time windows lives in the exposure ledger, not in policy". `36 §4` item
// 2 says the same.
//
// The four terms are therefore NOT silently dropped and NOT faked: `acos.cedarschema`
// declares no window attribute at all, so there is no position in which a fixture-supplied
// headroom could be presented to Cedar as an evaluated operand. The obligation is carried
// openly in docs/implementation/S1D-result.md.
//
// Consequence a reader must hold: a PERMIT from this policy set is a STEP-M permit. It is
// not an `AuthorizationDecision`, and `PolicyPermit` in `decision.ts` says so in its type
// name and its comment.
//
// ---------------------------------------------------------------------------------
// `ApprovedReasons`, AND WHY IT IS A LITERAL SET IN THE POLICY ARTIFACT
//
// `26 §2.0` types `reason_code` as "from a closed enum" and never enumerates the members;
// S1B declared the closed enum as a fixture under clarification S1B-C6 and recorded it as a
// fixture rather than an architecture claim. `ApprovedReasons` is the APPROVED SUBSET of
// that enum, and it is a grant/policy fact.
//
// It lives here, as a literal, because here is the only place a caller cannot reach: the
// artifact is a `50 §2` class 2 control artifact whose digest is bound into every decision,
// and there is no request field, entity attribute or constructor parameter through which a
// different approved set could be supplied. Putting it in an entity store built at request
// time would have moved it back onto the code path.
//
// The set below is every member of S1B's closed `REASON_CODES` fixture. `26 §8` gives no
// grounds for excluding any of the five, and inventing an exclusion in order to have a
// smaller set would be an invented policy quantity. It is recorded as an S1D fixture
// decision (S1D-C4), not as an architecture claim.
//
// Cedar renders `in` over a value set as `.contains()`; `in` is reserved for entity
// hierarchy. The principal clause below does use entity `in`, exactly as `26 §8` writes it.

permit(
  principal in Acos::Role::"support_reasoner",
  action == Acos::Action::"refund.create",
  resource is Acos::Order
)
when {
  resource.exists &&
  resource.grade == "RECORD" &&
  // SR-C1. TOTAL, including the retained fee. Duplicated by design from
  // acos.refund.create.per_action_max, which carries the same figure as a `forbid` so that
  // P1 holds over the whole policy set and not merely over this permit.
  context.exposure.total_exposure.lessThanOrEqual(decimal("25.00")) &&
  context.selected_option.line_refundable_remaining.greaterThanOrEqual(
    context.selected_option.amount
  ) &&
  context.selected_option.instrument == "original" &&
  ["CUSTOMER_REPORTED_DAMAGE",
   "CUSTOMER_REPORTED_NOT_RECEIVED",
   "ITEM_RETURNED",
   "DUPLICATE_CHARGE",
   "PRICING_ERROR"].contains(context.reason_code) &&
  // `26 §2.1` types this nullable. The `has` guard is what makes an absent novelty fail the
  // grant CLOSED rather than short-circuiting into a Cedar evaluation error.
  context has customer_novelty &&
  ["NEW", "RETURNING"].contains(context.customer_novelty)
};
```

#### `src/kernel/policy/artifacts/policies/acos.refund.create.per_action_max.cedar`

```cedar
// acos.refund.create.per_action_max
//
// Control artifact, `50 §2` class 2. Signer: Owner, second factor. Halt scope: all effects.
//
// ---------------------------------------------------------------------------------
// WHY THIS IS A `forbid` AND NOT MERELY A CONJUNCT OF THE GRANT
//
// `26 §11`, property P1, verbatim:
//
//   "P1 | No policy path permits `refund.create` whose **`exposure.total_exposure`**
//    exceeds the configured per-action cap. *(v1.2: the operand is `total_exposure`, not
//    the vendor amount -- SR-C1.)*"
//
// "No policy path permits" is a statement about the entire policy set. A `when` clause
// inside one `permit` cannot carry it: a second permit added later, for another role, for
// another resource group, under another grant, would satisfy P1's negation without touching
// this file. In Cedar a `forbid` is the only construct that holds regardless of what permits
// exist, so P1 is expressed as one.
//
// The `<= 25.00` term ALSO appears in `acos.refund.create.grant`, exactly as `26 §8` writes
// it. That duplication is deliberate and is asserted by
// tests/policy/policy-artifacts.test.ts: the two literals must be the same figure, and
// `51 §3.1`'s figure.
//
// ---------------------------------------------------------------------------------
// THE OPERAND, AND THE LIMIT
//
// `51 §3.1`, verbatim:
//
//   "| `refund.create` | **$25.00** | 2 | **10** | `INBOUND_ORIGINAL_INSTRUMENT` |
//    COMPENSABLE | `EXACT` |"
//
//   "`per_action_max.monetary` is compared against **`exposure.total_exposure`**, not
//    `exposure.vendor_amount` (SR-C1, `26 §8`). For a $25.00 line refund carrying a $1.03
//    retained processing fee, `total_exposure = $26.03` and the action **denies**
//    `PER_ACTION`."
//
// `26 §8` fixes the comparison as `<=`, and `26 §11.2` row 3 repeats it as
// "Bounded by `total_exposure <= $25.00`". At the limit is INSIDE the limit.
//
// The figure is a literal HERE, in the hash-committed artifact, and nowhere else in the tree.
// It is not a request field, not a constructor parameter, not an environment variable and
// not a fixture: a caller has no position in which to supply or replace it, and a substituted
// artifact moves the policy-set digest that every decision records (`26 §11`).
//
// ---------------------------------------------------------------------------------
// ATTRIBUTION
//
// Cedar's `diagnostics.reason` names the determining policy. This policy's id is the sole
// member of the PER_ACTION family in `src/kernel/policy/denialCategory.ts`, so a denial in
// which it is determining maps onto `26 §7` step M's terminal `D11 -- DENY: PER_ACTION`,
// deterministically and without inspecting any amount.

forbid(
  principal,
  action == Acos::Action::"refund.create",
  resource
)
unless {
  context.exposure.total_exposure.lessThanOrEqual(decimal("25.00"))
};
```

#### `src/kernel/controlArtifacts/artifactParsers.ts` lines 747–810 (class-2 parser)

```typescript
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
        `${at}.id ${quoted(id)} does not follow ${quoted(previous)} in ` +
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
```

### C.7 Class-19 effect constructors — records and parser

The deployed constructor set carries **one** record, for `refund.create`. Class-19 key
migration is a currently OPEN obligation, which is why `S1P-C1` reaches it.

#### `artifacts/control/class-19.effect-constructors.json`

```json
{
  "artifact_id": "acos.control.effect_constructors",
  "artifact_version": "acos.effect_constructors.2026-09-24",
  "records": [
    {
      "constructor_id": "acos.constructor.refund.create",
      "action_class": "refund.create",
      "semantic_major": 1,
      "non_semantic_minor": 0
    }
  ]
}
```

#### `src/kernel/controlArtifacts/artifactParsers.ts` lines 895–922 (class-19 parser)

```typescript
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
```

### C.8 Active manifest entries covering those artifacts

`requiredSet.ts` declares the pre-live required artifact set and each class's expected file
name and artifact id — this is where a new class-3/class-5 shape is pinned. `manifestCore.ts`
computes the manifest identity over the artifact bytes, which is why changing class-3 bytes
changes the manifest id.

#### `src/kernel/controlArtifacts/requiredSet.ts`

```typescript
/**
 * The EXACT pre-live signed artifact set, from `50 §6`.
 *
 * =================================================================================
 * `50 §6`, verbatim, and it is a CLOSED inventory
 *
 *   "**The pre-live signed set. No `etc.` No `including`.** Every entry's content boundary
 *    is closed by the section named in its row. **Every entry requires both signatures.
 *    Every entry is a manifest member.**"
 *
 * The table's four printed rows are classes **2**, **3**, **20** and **27**. `§6` then adds,
 * verbatim:
 *
 *   "**Also in the manifest at the pre-live gate, unchanged in content by this pass and
 *    carried here so the set is complete rather than partial:** **class 19** (effect
 *    constructors and their `ConstructorVersionRecord`s — `§3i` declares the key migration
 *    as follow-on work) and **class 24** (the audit-plane signing key's published public
 *    half [...]). **Both require both signatures and both are manifest members.**"
 *
 * So the required set is SIX classes, and `37 §2`'s S1K gate list — which names classes 3,
 * 20, 27 and the Cedar bundle — is the list of classes whose RUNTIME CONSUMERS this slice
 * migrates, not the list of manifest members. The two lists are different lengths on
 * purpose and both are transcribed here rather than reconciled into one.
 * =================================================================================
 *
 * =================================================================================
 * CLASS 17 IS RETIRED, AND ITS ABSENCE IS ENFORCED RATHER THAN ASSUMED
 *
 * `50 §2d`: "**PER-COMPANY `window_registry` ROWS ARE NOT DEPLOY-TIME SIGNED CONTROL
 * ARTIFACTS.** They are runtime authoritative database state." and "**No empty or
 * signature-only artifact is retained to preserve numbering.** Class number **17 is reserved
 * and deprecated**; it is never reassigned".
 *
 * A manifest presenting a class-17 entry is therefore REFUSED — not ignored, not tolerated
 * as an unknown class. `§6`'s closed membership means an entry outside the set is an entry
 * nobody reviewed, and a revived class 17 specifically would be an attempt to reintroduce a
 * deploy-time signature over runtime state that `§3h` governs by other means.
 * =================================================================================
 *
 * =================================================================================
 * THE ARTIFACT IDS THAT `50` PRINTS, AND THE TWO IT DOES NOT
 *
 * `50 §6`'s table prints `artifact_id` for classes 2, 3, 20 and 27, and those four are
 * transcribed exactly. `§6`'s carried paragraph names classes 19 and 24 without printing an
 * id, so this module declares one for each.
 *
 * THAT CHOICE CANNOT MOVE AUTHORITY, which is why it is made here rather than returned as
 * an architecture gap: `§3b` binds `artifact_id` INSIDE the signature message and `§3d`
 * binds every entry inside the signed core, so whichever identifier a release ceremony
 * signs is the only one the deployment pin admits. A different identifier is a different
 * manifest and a different `manifest_id`. The choice is recorded in
 * `docs/implementation/S1K-contract.md` as an implementation-level identifier rather than a
 * normative one.
 * =================================================================================
 */

/** `50 §2d`. Reserved, deprecated, never reassigned, and never a manifest member. */
export const RETIRED_ARTIFACT_CLASS = 17;

/** One member of the closed pre-live set. */
export interface RequiredArtifact {
  readonly artifactClass: number;
  readonly artifactId: string;
  /**
   * The version the manifest entry must carry, when `50` declares one literally.
   *
   * `null` means the version is declared by the artifact package rather than by `50` —
   * `§6` writes "the catalogue's declared version", "the configuration's declared version"
   * and "the bundle's declared version" — and in that case the parser cross-checks the
   * manifest entry's version against the version the ARTIFACT'S OWN VERIFIED BYTES declare.
   * That is a consistency check between two things the owner signed, never a value this
   * module supplies.
   */
  readonly declaredVersion: string | null;
  /** The file inside the deployment's artifact package that carries the exact bytes. */
  readonly fileName: string;
  /** Which `50` section closes this artifact's content boundary. */
  readonly boundary: string;
}

/**
 * `50 §6`'s inventory, in `§3d`'s declared manifest order — ascending `artifact_class`.
 *
 * The ordering here is incidental to correctness (the verifier checks the manifest's own
 * order element-wise) and deliberate for legibility: this list reads in the same order the
 * signed core does.
 */
export const REQUIRED_PRE_LIVE_ARTIFACTS: readonly RequiredArtifact[] = Object.freeze([
  Object.freeze({
    artifactClass: 2,
    artifactId: 'acos.control.policy_set',
    declaredVersion: null,
    fileName: 'class-02.policy-set.json',
    boundary: '50 §2e',
  }),
  Object.freeze({
    artifactClass: 3,
    artifactId: 'acos.control.action_catalogue',
    declaredVersion: null,
    fileName: 'class-03.action-catalogue.json',
    boundary: '50 §2a',
  }),
  Object.freeze({
    // v1.3.7, `S1N-C1`. `50 §2g` closes class 5 and `37 §2`'s SEQ-04 pulls it into the
    // pre-live subset, because ADR-024's option-B money-moving trigger has no operand
    // without it and a trigger operand read from anywhere unsigned is unsigned authority
    // over whether the execution proxy is required.
    artifactClass: 5,
    artifactId: 'acos.control.credential_scopes',
    declaredVersion: null,
    fileName: 'class-05.credential-scopes.json',
    boundary: '50 §2g',
  }),
  Object.freeze({
    artifactClass: 19,
    artifactId: 'acos.control.effect_constructors',
    declaredVersion: null,
    fileName: 'class-19.effect-constructors.json',
    boundary: '50 §2 row 19, §3i',
  }),
  Object.freeze({
    // `50 §2b`: the artifact IS `artifacts/acos-jcs-1.spec.v1.txt`, and its
    // `artifact_version` is the literal `ACOS-JCS-1`.
    artifactClass: 20,
    artifactId: 'acos.control.jcs1_specification',
    declaredVersion: 'ACOS-JCS-1',
    fileName: 'class-20.acos-jcs-1.spec.v1.txt',
    boundary: '50 §2b',
  }),
  Object.freeze({
    artifactClass: 24,
    artifactId: 'acos.control.audit_signing_key',
    declaredVersion: null,
    fileName: 'class-24.audit-signing-key.json',
    boundary: '50 §2 row 24',
  }),
  Object.freeze({
    artifactClass: 27,
    artifactId: 'acos.control.degraded_mode_config',
    declaredVersion: null,
    fileName: 'class-27.degraded-mode-config.json',
    boundary: '50 §2c',
  }),
]);

/** The four classes `37 §2`'s S1K gate migrates a runtime consumer onto. */
export const CLASSES_WITH_S1K_CONSUMERS: readonly number[] = Object.freeze([2, 3, 20, 27]);

const BY_CLASS: ReadonlyMap<number, RequiredArtifact> = new Map(
  REQUIRED_PRE_LIVE_ARTIFACTS.map((artifact) => [artifact.artifactClass, artifact]),
);

export function requiredArtifactForClass(artifactClass: number): RequiredArtifact | undefined {
  return BY_CLASS.get(artifactClass);
}

/**
 * `50 §2b`'S ACCEPTED CLASS-20 DIGEST IS DELIBERATELY NOT IN THIS FILE.
 *
 * `7af60fc5…a18f33` is the digest the architecture freeze recorded for
 * `artifacts/acos-jcs-1.spec.v1.txt`. A constant here would become a SECOND authority
 * source for class 20's content — exactly the arrangement `50 §3c` forbids — and a runtime
 * that compared against it would be verifying against a literal a code change can move
 * rather than against an owner-signed manifest entry.
 *
 * THE MANIFEST IS THE AUTHORITY. The accepted digest lives in
 * `tests/support/controlArtifactFixture.ts` as an ACCEPTANCE REGRESSION FIXTURE, where it
 * proves the bytes shipped in the artifact package are the bytes the architecture froze,
 * and where it is outside every authority path.
 */
```

#### `src/kernel/controlArtifacts/manifestCore.ts`

```typescript
import {
  ED25519_SIGNATURE_BYTES,
  MANIFEST_FORMAT_VERSION,
  SHA256_DIGEST_BYTES,
  manifestCoreBytes,
  type ManifestCoreEntryFields,
  type ManifestCoreHeaderFields,
} from './casSig.js';
import { decodeLowercaseHex, hexOf, sha256 } from './ed25519.js';
import { integrityFailure, quoted } from './errors.js';

/**
 * `50 §3d`'s MANIFEST CORE, and `50 §3e`'s `manifest_id`.
 *
 * =================================================================================
 * WHY A CORE EXISTS AT ALL — `50 §3d`, verbatim
 *
 *   "**Per-artifact signatures authenticate the rows that are present. They do not protect
 *    the ROW SET.** A deleted row removes a requirement; an inserted row adds one; a
 *    reordering or a substitution of a complete, validly signed older set defeats every
 *    per-row signature without forging anything."
 *
 * =================================================================================
 * THE DOCUMENT IS A TRANSPORT. THE CORE IS THE AUTHORITY.
 *
 * The manifest arrives as a JSON document because a deployment needs something to put in a
 * release package, and `50` declares no on-disk container. What is HASHED AND SIGNED is
 * never that document: it is `§3d`'s fixed `ACOS-CAS-SIG-V1` framing over the parsed
 * fields. So `JSON.parse` runs here, `JSON.stringify` never does, and no property order,
 * whitespace choice or duplicate-key resolution of the transport can move `manifest_id`.
 *
 * That is the deliberate difference from `§3c`'s artifact rule. An ARTIFACT's hash is over
 * its EXACT BYTES because the artifact is the thing being protected. The MANIFEST's identity
 * is over a REFRAMING of its fields because the manifest is a set declaration, and a set
 * declaration that changed identity when an operator reformatted the file would be unusable
 * without adding a canonicalisation — which is exactly what `§3b` forbids depending on.
 * =================================================================================
 *
 * =================================================================================
 * UNKNOWN FIELDS ARE REJECTED, NOT IGNORED
 *
 * `50 §3d`: "**Each artifact entry carries exactly:** `artifact_class`; `artifact_id`;
 * `artifact_version`; `content_hash`; `primary_signature`; `second_factor_signature`."
 *
 * "Exactly" is a closed enumeration, and the same rule `50 §2a` applies to class 3's content
 * applies to the manifest's own: a field outside the boundary is either an accident that
 * changes nothing or an instruction nobody reviewed, and the parser cannot tell which. A
 * permissive parser would also let a field be added that a FUTURE reader treats as
 * authoritative while today's `manifest_id` computation ignores it.
 * =================================================================================
 */

/** One parsed manifest entry, in the runtime's own representation. */
export interface ManifestEntry {
  readonly artifactClass: number;
  readonly artifactId: string;
  readonly artifactVersion: string;
  /** Lowercase hex, 64 characters. */
  readonly contentHash: string;
  /** The 32 raw bytes behind `contentHash`. */
  readonly contentSha256: Uint8Array;
  readonly primarySignature: Uint8Array;
  readonly secondFactorSignature: Uint8Array;
}

/** A parsed manifest: the core's fields, its entries, and the two signatures beside it. */
export interface ParsedManifest {
  readonly header: ManifestCoreHeaderFields;
  readonly entries: readonly ManifestEntry[];
  /** `50 §3d`: NOT inside the bytes being signed. Carried beside the core. */
  readonly primarySignature: Uint8Array;
  readonly secondFactorSignature: Uint8Array;
  /** `50 §3e`: `manifest_id = SHA-256(exact CORE bytes)`, lowercase hex. */
  readonly manifestId: string;
  /** The exact CORE bytes, recomputed from the parsed fields by `§3d`'s framing. */
  readonly coreBytes: Uint8Array;
  /** `SHA-256(CORE)`, raw, for `M_manifest`. */
  readonly coreSha256: Uint8Array;
}

const MANIFEST_DOCUMENT_FIELDS = [
  'manifest_format_version',
  'manifest_epoch',
  'expected_primary_key_id',
  'expected_second_factor_key_id',
  'entry_count',
  'entries',
  'primary_signature',
  'second_factor_signature',
] as const;

const MANIFEST_ENTRY_FIELDS = [
  'artifact_class',
  'artifact_id',
  'artifact_version',
  'content_hash',
  'primary_signature',
  'second_factor_signature',
] as const;

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
      unexpected.length > 0 ? 'MANIFEST_UNKNOWN_FIELD' : 'MANIFEST_MALFORMED',
      `${where} carries exactly the declared fields; missing [${missing.join(', ')}], ` +
        `unexpected [${unexpected.join(', ')}] (50 §3d)`,
    );
  }
}

function asObject(value: unknown, where: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    integrityFailure('MANIFEST_MALFORMED', `${where} is not an object (50 §3d)`);
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown, where: string): string {
  if (typeof value !== 'string') {
    integrityFailure('MANIFEST_MALFORMED', `${where} is not a string (50 §3d)`);
  }
  return value;
}

function asNonNegativeInteger(value: unknown, where: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    integrityFailure(
      'MANIFEST_MALFORMED',
      `${where} is not a non-negative integer (50 §3d)`,
    );
  }
  return value;
}

function asHexBytes(value: unknown, byteLength: number, where: string): Uint8Array {
  const decoded = decodeLowercaseHex(asString(value, where), byteLength);
  if (decoded === null) {
    integrityFailure(
      'MANIFEST_MALFORMED',
      `${where} is not ${String(byteLength * 2)} lowercase hex characters (50 §3b)`,
    );
  }
  return decoded;
}

/**
 * `50 §3d`'s ENTRY ORDER, as a total comparison.
 *
 *   1. `artifact_class` — as an **unsigned integer**, ascending;
 *   2. `artifact_id` — **byte-wise lexicographic** over its UTF-8 NFC bytes, with a proper
 *      prefix sorting before its extensions;
 *   3. `artifact_version` — **byte-wise lexicographic** over its UTF-8 NFC bytes.
 *
 * "**The order is a property of the bytes, not of any implementation's map iteration, locale
 * or collation.**" So the string keys are compared through `Buffer.compare` over their UTF-8
 * NFC bytes and NEVER through `String.prototype.localeCompare` or a default `<`, both of
 * which are UTF-16 code-unit or locale comparisons and disagree with a byte-wise one above
 * the BMP.
 *
 * Returns a negative number, zero, or a positive number. ZERO IS A DEFECT at the call site:
 * "Two entries with all three keys equal are a **defect**, not a tie: the manifest fails
 * closed."
 */
function compareEntryOrder(a: ManifestEntry, b: ManifestEntry): number {
  if (a.artifactClass !== b.artifactClass) return a.artifactClass - b.artifactClass;
  const idOrder = Buffer.compare(
    Buffer.from(a.artifactId.normalize('NFC'), 'utf8'),
    Buffer.from(b.artifactId.normalize('NFC'), 'utf8'),
  );
  if (idOrder !== 0) return idOrder;
  return Buffer.compare(
    Buffer.from(a.artifactVersion.normalize('NFC'), 'utf8'),
    Buffer.from(b.artifactVersion.normalize('NFC'), 'utf8'),
  );
}

function coreEntryFields(entry: ManifestEntry): ManifestCoreEntryFields {
  return {
    artifactClass: entry.artifactClass,
    artifactId: entry.artifactId,
    artifactVersion: entry.artifactVersion,
    contentSha256: entry.contentSha256,
    primarySignature: entry.primarySignature,
    secondFactorSignature: entry.secondFactorSignature,
  };
}

/**
 * Parse a manifest document and compute its identity.
 *
 * NOTHING HERE IS TRUSTED YET. This function computes `manifest_id`; it does not check the
 * pin, does not check a signature and does not read a public key. `50 §3e`: "**The pin is
 * checked *before* the signatures**, because a signature check on a manifest the deployment
 * did not intend proves only that someone once signed something" — and both of those happen
 * in `verifier.ts`, in `§3f`'s declared order, against a configuration this module has never
 * seen.
 */
export function parseManifestDocument(documentText: string): ParsedManifest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(documentText);
  } catch (error) {
    integrityFailure(
      'MANIFEST_MALFORMED',
      `the manifest document is not parseable: ${String(error)}`,
    );
  }

  const document = asObject(parsed, 'the manifest document');
  assertExactFields(document, MANIFEST_DOCUMENT_FIELDS, 'the manifest document');

  const header: ManifestCoreHeaderFields = {
    manifestFormatVersion: asString(
      document.manifest_format_version,
      'manifest_format_version',
    ),
    manifestEpoch: asString(document.manifest_epoch, 'manifest_epoch'),
    expectedPrimaryKeyId: asString(document.expected_primary_key_id, 'expected_primary_key_id'),
    expectedSecondFactorKeyId: asString(
      document.expected_second_factor_key_id,
      'expected_second_factor_key_id',
    ),
  };

  // The framing version the CORE bytes are built under. A document declaring another
  // version is not a document this framing may hash: `50 §3a`'s no-negotiation rule applied
  // to the container.
  if (header.manifestFormatVersion !== MANIFEST_FORMAT_VERSION) {
    integrityFailure(
      'MANIFEST_MALFORMED',
      `manifest_format_version is ${quoted(header.manifestFormatVersion)}; this ` +
        `runtime implements ${MANIFEST_FORMAT_VERSION} and negotiates no other (50 §3d)`,
    );
  }

  const rawEntries = document.entries;
  if (!Array.isArray(rawEntries)) {
    integrityFailure('MANIFEST_MALFORMED', 'entries is not an array (50 §3d)');
  }

  const entries: ManifestEntry[] = rawEntries.map((raw, index) => {
    const where = `entries[${String(index)}]`;
    const entry = asObject(raw, where);
    assertExactFields(entry, MANIFEST_ENTRY_FIELDS, where);
    const contentSha256 = asHexBytes(
      entry.content_hash,
      SHA256_DIGEST_BYTES,
      `${where}.content_hash`,
    );
    return {
      artifactClass: asNonNegativeInteger(entry.artifact_class, `${where}.artifact_class`),
      artifactId: asString(entry.artifact_id, `${where}.artifact_id`),
      artifactVersion: asString(entry.artifact_version, `${where}.artifact_version`),
      contentHash: hexOf(contentSha256),
      contentSha256,
      primarySignature: asHexBytes(
        entry.primary_signature,
        ED25519_SIGNATURE_BYTES,
        `${where}.primary_signature`,
      ),
      secondFactorSignature: asHexBytes(
        entry.second_factor_signature,
        ED25519_SIGNATURE_BYTES,
        `${where}.second_factor_signature`,
      ),
    };
  });

  // `50 §3d`: "`entry_count` is inside the signed bytes **and** the entries follow it, so a
  // deletion is detectable twice over: the count disagrees, and the entry sequence differs."
  // The DOCUMENT's declared count is diffed here against the entries actually parsed, so a
  // document whose two halves disagree never reaches the framing at all.
  const declaredCount = asNonNegativeInteger(document.entry_count, 'entry_count');
  if (declaredCount !== entries.length) {
    integrityFailure(
      'MANIFEST_ENTRY_COUNT_MISMATCH',
      `entry_count declares ${String(declaredCount)} and the document carries ` +
        `${String(entries.length)} entries (50 §3d)`,
    );
  }

  // The declared order, checked element-wise. A manifest whose entries are out of order is
  // refused rather than sorted: sorting it would let two different byte sequences produce
  // one `manifest_id`, which is the injectivity the pin depends on.
  for (let i = 1; i < entries.length; i += 1) {
    const order = compareEntryOrder(entries[i - 1]!, entries[i]!);
    if (order === 0) {
      integrityFailure(
        'MANIFEST_DUPLICATE_ENTRY',
        `entries ${String(i - 1)} and ${String(i)} carry the same ` +
          '(artifact_class, artifact_id, artifact_version); that is a defect, not a tie ' +
          '(50 §3d)',
      );
    }
    if (order > 0) {
      integrityFailure(
        'MANIFEST_ENTRY_ORDER_INVALID',
        `entries ${String(i - 1)} and ${String(i)} are not in the declared ascending ` +
          '(artifact_class, artifact_id, artifact_version) order (50 §3d)',
      );
    }
  }

  const coreBytes = manifestCoreBytes(header, entries.map(coreEntryFields));
  const coreSha256 = sha256(coreBytes);

  return Object.freeze({
    header: Object.freeze(header),
    entries: Object.freeze(entries.map((entry) => Object.freeze(entry))),
    primarySignature: asHexBytes(
      document.primary_signature,
      ED25519_SIGNATURE_BYTES,
      'primary_signature',
    ),
    secondFactorSignature: asHexBytes(
      document.second_factor_signature,
      ED25519_SIGNATURE_BYTES,
      'second_factor_signature',
    ),
    manifestId: hexOf(coreSha256),
    coreBytes,
    coreSha256,
  });
}
```

### C.9 Externally pinned / deployment-trust material

`EXPECTED_ACTIVE_MANIFEST_ID` is the external pin. If class-3 bytes change, the manifest id
changes, and this pinned value — held in each plane's own deployment environment, not in the
repository — must be re-issued by the owner. Both planes read their own copy.

#### `src/kernel/controlArtifacts/trustConfig.ts`

```typescript
import { ED25519_PUBLIC_KEY_BYTES, SHA256_DIGEST_BYTES } from './casSig.js';
import { decodeLowercaseHex, keyIdOf, samePublicKey } from './ed25519.js';
import { integrityFailure } from './errors.js';

/**
 * The DEPLOYMENT TRUST CONFIGURATION — the three things `50 §3e` pins, and the top of
 * `50 §3g`'s dependency graph.
 *
 * =================================================================================
 * WHERE THESE COME FROM, AND EVERY PLACE THEY DO NOT — `50 §3a`, verbatim
 *
 *   "**Both public keys are TRUSTED DEPLOYMENT ROOTS. They are not control artifacts. They
 *    are not manifest rows. They are not discovered from a database, from the manifest,
 *    from the network, from a model, from a caller, from an API, or from the first
 *    signature observed.**"
 *
 *   "**TRUST-ON-FIRST-USE IS FORBIDDEN.** There is no "remember the key that first verified"
 *    path, no "accept any valid Ed25519 key" path, and no per-request key parameter."
 *
 * `50 §3e`: "**THE TRUSTED DEPLOYMENT CONFIGURATION PINS THREE THINGS:** 1.
 * `OWNER_ARTIFACT_ROOT_KEY` [...] 2. `OWNER_ARTIFACT_SECOND_FACTOR_KEY` [...] 3.
 * `EXPECTED_ACTIVE_MANIFEST_ID` — the manifest identity this deployment is intended to run."
 *
 * =================================================================================
 * THE ABSTRACTION IS NARROW ON PURPOSE
 *
 * The architecture declares that the roots are provisioned "out of band through the trusted
 * deployment mechanism" and does NOT declare a physical transport, so this module chooses
 * one — process environment, read once, at bootstrap — and keeps the choice as small as it
 * can be made:
 *
 *   * the reader takes a flat string map and returns a FROZEN configuration object. It has
 *     no network, no filesystem, no database and no default key;
 *   * there is NO per-request, per-call or per-verification key parameter anywhere in
 *     `src/`. `verifyControlArtifactBundle` takes this configuration, and
 *     `tests/controlArtifacts/trust-root-confinement.test.ts` asserts against a
 *     hand-authored list that `readDeploymentTrustConfiguration` has exactly one production
 *     call site per plane;
 *   * NOTHING remembers a key between runs. There is no keystore, no cache, no "last good"
 *     file and no learned state, so `§3e`'s "This introduces no mutable runtime trust state"
 *     is a property of the module rather than a claim about it.
 *
 * `50 §3i` is the warning this module exists to answer: S1B's `ConstructorVersionResolver`
 * "takes the verifying public key **as a constructor argument** and holds no keystore" —
 * "**A CALLER-SUPPLIED VERIFICATION KEY IS NOT A TRUST ROOT**, and it must not become the
 * general S1K pattern."
 * =================================================================================
 */

/** `50 §3e`'s three pinned values, and the two key ids derived from the first two. */
export interface DeploymentTrustConfiguration {
  /** `OWNER_ARTIFACT_ROOT_KEY` — the 32 RAW Ed25519 public-key bytes. */
  readonly primaryPublicKey: Uint8Array;
  /** `OWNER_ARTIFACT_SECOND_FACTOR_KEY` — the 32 RAW Ed25519 public-key bytes. */
  readonly secondFactorPublicKey: Uint8Array;
  /** `SHA-256(raw primary public key)`, lowercase hex. DERIVED, never supplied. */
  readonly primaryKeyId: string;
  /** `SHA-256(raw second-factor public key)`, lowercase hex. DERIVED, never supplied. */
  readonly secondFactorKeyId: string;
  /** `EXPECTED_ACTIVE_MANIFEST_ID` — `SHA-256(CORE)`, lowercase hex. */
  readonly expectedActiveManifestId: string;
  /** Where this deployment's artifact package lives. Not a trust anchor; a location. */
  readonly artifactPackageRoot: string;
}

/** A flat string map. `process.env` is one; a test's own record is another. */
export type TrustConfigurationSource = Readonly<Record<string, string | undefined>>;

/** The control plane's deployment variable names. */
export const CONTROL_TRUST_CONFIG_KEYS = Object.freeze({
  primaryPublicKey: 'ACOS_OWNER_ARTIFACT_ROOT_KEY',
  secondFactorPublicKey: 'ACOS_OWNER_ARTIFACT_SECOND_FACTOR_KEY',
  expectedActiveManifestId: 'ACOS_EXPECTED_ACTIVE_MANIFEST_ID',
  artifactPackageRoot: 'ACOS_CONTROL_ARTIFACT_ROOT',
});

/**
 * The AUDIT plane's own deployment variable names.
 *
 * `50 §3` property 2, verbatim: "**The audit plane recomputes independently.** A manifest
 * check run only by the control plane is a check the control plane can pass by lying
 * (`30 §5.2`)."
 *
 * The audit plane's roots and pin therefore arrive through ITS OWN trusted deployment
 * boundary rather than being handed across from the control plane. The VALUES are expected
 * to be equal — they are the same owner's roots and the same active manifest — and the
 * PROVENANCE is not, which is the whole point: a control plane that lied about its
 * configuration would not move the audit plane's.
 */
export const AUDIT_TRUST_CONFIG_KEYS = Object.freeze({
  primaryPublicKey: 'ACOS_AUDIT_OWNER_ARTIFACT_ROOT_KEY',
  secondFactorPublicKey: 'ACOS_AUDIT_OWNER_ARTIFACT_SECOND_FACTOR_KEY',
  expectedActiveManifestId: 'ACOS_AUDIT_EXPECTED_ACTIVE_MANIFEST_ID',
  artifactPackageRoot: 'ACOS_AUDIT_CONTROL_ARTIFACT_ROOT',
});

/** The four variable names one plane's trust configuration is read from. */
export interface TrustConfigKeyNames {
  readonly primaryPublicKey: string;
  readonly secondFactorPublicKey: string;
  readonly expectedActiveManifestId: string;
  readonly artifactPackageRoot: string;
}

function required(source: TrustConfigurationSource, name: string): string {
  const value = source[name];
  if (value === undefined || value === '') {
    integrityFailure(
      'TRUST_CONFIG_MISSING',
      `the deployment trust configuration does not provide ${name}; the runtime has no ` +
        'default root, no keystore and no discovery path (50 §3a)',
    );
  }
  return value;
}

function rawPublicKey(source: TrustConfigurationSource, name: string): Uint8Array {
  const decoded = decodeLowercaseHex(required(source, name), ED25519_PUBLIC_KEY_BYTES);
  if (decoded === null) {
    integrityFailure(
      'TRUST_CONFIG_MALFORMED',
      `${name} is not ${String(ED25519_PUBLIC_KEY_BYTES * 2)} lowercase hex characters; an ` +
        'Ed25519 root is 32 RAW public-key bytes and never a DER, SPKI, PEM or base64 ' +
        'wrapper (50 §3a)',
    );
  }
  return decoded;
}

/**
 * Read the deployment trust configuration, once, at bootstrap.
 *
 * `50 §3f` bootstrap steps 1 and 2 are BOTH discharged here, because a configuration that
 * names the same key twice must never become a configuration object at all:
 *
 *   1. "load the two root public keys from the deployment trust configuration";
 *   2. "check `primary_public_key != second_factor_public_key`".
 *
 * `50 §3a`, on step 2: "A deployment configuring the same key in both slots **fails closed
 * at bootstrap** and never becomes READY. **A second signature produced under the primary
 * key does not satisfy the second-factor requirement**, whatever its `signer_role` claims."
 *
 * The distinctness check compares the RAW 32 PUBLIC-KEY BYTES and not the key ids, because
 * `§3a` declares the bytes to be the anchor and the ids to be derived; comparing ids alone
 * would make the check depend on `SHA-256` being injective over a set an operator controls,
 * which is true and is not the reason the check passes.
 */
export function readDeploymentTrustConfiguration(
  source: TrustConfigurationSource = process.env,
  names: TrustConfigKeyNames = CONTROL_TRUST_CONFIG_KEYS,
): DeploymentTrustConfiguration {
  const primaryPublicKey = rawPublicKey(source, names.primaryPublicKey);
  const secondFactorPublicKey = rawPublicKey(source, names.secondFactorPublicKey);

  // STEP 2. Before anything is derived, and before any manifest byte is read.
  if (samePublicKey(primaryPublicKey, secondFactorPublicKey)) {
    integrityFailure(
      'TRUST_ROOTS_NOT_DISTINCT',
      `${names.primaryPublicKey} and ${names.secondFactorPublicKey} carry the same 32 raw ` +
        'public-key bytes; a second signature under the primary key does not satisfy the ' +
        'second-factor requirement, whatever its signer_role claims (50 §3a, 50 §4)',
    );
  }

  const expectedActiveManifestIdRaw = required(source, names.expectedActiveManifestId);
  if (decodeLowercaseHex(expectedActiveManifestIdRaw, SHA256_DIGEST_BYTES) === null) {
    integrityFailure(
      'TRUST_CONFIG_MALFORMED',
      `${names.expectedActiveManifestId} is not ${String(SHA256_DIGEST_BYTES * 2)} ` +
        'lowercase hex characters; the pin is SHA-256 over the exact manifest CORE bytes ' +
        '(50 §3e)',
    );
  }

  const primaryKeyId = keyIdOf(primaryPublicKey);
  const secondFactorKeyId = keyIdOf(secondFactorPublicKey);

  // Implied by the raw-byte distinctness above, and asserted rather than assumed because
  // `50 §3a` states both: "**`primary_public_key != second_factor_public_key`** [...] and
  // therefore **`primary_key_id != second_factor_key_id`**".
  if (primaryKeyId === secondFactorKeyId) {
    integrityFailure(
      'TRUST_ROOTS_NOT_DISTINCT',
      'the two provisioned roots derive the same key_id (50 §3a)',
    );
  }

  // The two key arrays are NOT `Object.freeze`d — a typed array cannot be frozen while it
  // has elements — so the configuration object is frozen and the bytes are private by
  // confinement: this module is their only producer, nothing exports them, and the only
  // consumer (`verifier.ts`) reads them.
  return Object.freeze({
    primaryPublicKey,
    secondFactorPublicKey,
    primaryKeyId,
    secondFactorKeyId,
    expectedActiveManifestId: expectedActiveManifestIdRaw,
    artifactPackageRoot: required(source, names.artifactPackageRoot),
  });
}

/**
 * The audit plane's reader. Same rules, different variables, and a SEPARATE call.
 *
 * It is a distinct function rather than a parameter default so that a source-boundary test
 * can assert the control plane never reads the audit plane's configuration and the audit
 * plane never reads the control plane's.
 */
export function readAuditDeploymentTrustConfiguration(
  source: TrustConfigurationSource = process.env,
): DeploymentTrustConfiguration {
  return readDeploymentTrustConfiguration(source, AUDIT_TRUST_CONFIG_KEYS);
}
```

### C.10 Architecture text defining action recoverability and the class relationships

> **READER NOTE — THIS IS THE MOST CONSEQUENTIAL EXCERPT IN THE PACKAGE.**
>
> `26 §5`'s recoverability table, reproduced verbatim below, **already designates
> `email.send` as IRRECOVERABLE**, on `20 §5 I4`: *"A gate can refuse a send; it cannot
> unsend."* The `S1P-C1` clarification as written characterised the recoverability of an
> email send as an open owner ruling. **This text bears directly on that characterisation and
> the reviewer should weigh it.** It is presented here without resolving `S1P-C1`, which is
> out of scope for this step.
>
> Note also line 387 of the same file, which discusses `email.send` **at one MIE unit** and
> the operational consequence of that calibration — i.e. the accepted architecture has
> already reasoned about an email class's exposure treatment, not only its recoverability.

#### `docs/architecture/v1.3.7/deliverables/26-authority-and-policy-model.md` lines 377–416 (`§5 Recoverability, as a first-class attribute`)

Full file: 150,412 bytes. Included: `§5` complete. Remainder unchanged in-repo.

```markdown
## 5. Recoverability, as a first-class attribute

EM3. Assigned per action class in the catalogue, not per request, and never by a model.

| Class | Definition | Compensator | Governance |
|---|---|---|---|
| **REVERSIBLE** | A compensating action fully restores the prior external state, and its success is verifiable. | Registered, `guarantee=FULL` | Monetary limits only. |
| **COMPENSABLE** | A remedy exists that limits but does not undo the effect. A shipped order can be returned; the shipping cost is spent. | Registered, `guarantee=PARTIAL` | Monetary limits plus a rate limit. |
| **IRRECOVERABLE** | No compensator exists. The effect reached a third party or the physical world. | None | **Count-gated, cost-disclosed** (v1.1). No batching. Approval tier raised. |

**v1.1: the irrecoverable currency splits (R8, from `43 §4.4`).** The two-currency model carried an unexamined assumption — that irrecoverable actions are *rare*. They are rare only for the agent-**discretionary** class. `33 §9` puts POD's dominant recoverability class at IRRECOVERABLE for every fulfilled order, and for high-value digital, delivering the fenced asset is a disclosure that cannot be recalled. So in at least two of the four tested business models, a correctly calibrated single MIE would have to exceed order volume, at which point it gates nothing — and at v1.0's proposed MIE of 5/month with `email.send` at one unit, the sixth customer message of the month required an owner approval and the company's normal operating mode became an approval queue (`44 §6.3`).

| Class | Governed by | Consumes |
|---|---|---|
| **`MIE_discretionary`** — reship, goodwill send, address edit, public post, campaign send, entitlement revocation | A small owner-signed integer per window, gating | `MIE_discretionary` headroom, and contributes `MIE_cost` to the disclosed ceiling |
| **Order-driven irrecoverable fulfilment** — the shipment or entitlement a paid order requires, and transactional order-state sends | A per-order rate limit, a template whitelist, and an anomaly threshold on the **ratio of fulfilments to settled orders** | Nothing from `MIE_discretionary` (I30) |

**And an irrecoverable action still costs money.** A reship costs COGS plus freight; a campaign send costs ESP volume and, on a bad day, the sending domain's bulk-sender classification. Count remains the **gating** control; `MIE_cost` — an `[ESTIMATE]`-graded sum of class unit costs — enters the **disclosed** ceiling (`§10`). v1.0 built a second currency for exactly these actions and then omitted their cost from the figure shown to the owner.

**Worked assignments.**

| Action class | Recoverability | Note |
|---|---|---|
| `catalog.update` | REVERSIBLE | Versioned; restore is exact. |
| `price.change` | REVERSIBLE for the record; **COMPENSABLE in effect** | A customer who bought at the wrong price is a real event. Classified COMPENSABLE. |
| `refund.create` | COMPENSABLE | Money left; the goods relationship persists. |
| `campaign.budget.set` | COMPENSABLE, **and rate-based** | Spend already delivered is not recoverable; the rate can be reversed forward. **v1.1: requires a `StandingAuthorization`** and dispatches an absolute value computed by the kernel, not a delta supplied by a model. v1.0's `campaign.budget.increase` reserved a *delta* against a window measuring *spend* — a unit error in the package's own worked policy. |
| `subscription.*`, `dunning.retry`, `payment_mandate.*`, `plan.change` (metered) | COMPENSABLE, **and rate-based** | Same shape. One authorisation, recurring external effect. `StandingAuthorization` required. |
| `campaign.pause` | REVERSIBLE | |
| `supplier.order.place` | COMPENSABLE at best, IRRECOVERABLE once produced | POD production starts fast; the class is IRRECOVERABLE unless the adapter exposes a verifiable pre-production cancel window. |
| `email.send`, `sms.send`, `social.post`, `social.reply`, `platform.message.send` | **IRRECOVERABLE** | `20 §5 I4`: *"A gate can refuse a send; it cannot unsend."* |
| `order.address.edit` | COMPENSABLE, and specifically flagged | `07 §4.1` names address edit and free reshipment as the two highest-risk support actions precisely because they move goods without tripping a monetary cap. |
| `fulfilment.reship` | IRRECOVERABLE, **discretionary** | Same reason. Count-limited from `MIE_discretionary`, with COGS plus freight in `MIE_cost`. |
| `fulfilment.order.create` (the shipment a paid order requires) | IRRECOVERABLE, **order-driven** | Governed by per-order rate limit, template whitelist and the fulfilment-to-settled-order ratio. Does **not** consume `MIE_discretionary` (I30). |
| `entitlement.issue` | **IRRECOVERABLE** (v1.1, R17) | `33 §9` v1.0 put the digital column's dominant class at COMPENSABLE while its own "hardest governance problem" cell said asset leakage is irrecoverable. Issuing an entitlement discloses a fenced asset; revocation removes future access and does not un-disclose it. Order-driven when a paid order requires it; discretionary otherwise. |
| `entitlement.revoke` | IRRECOVERABLE, **discretionary** | A customer-facing removal of something already paid for. |
| `payee.create`, `payment_method.modify`, `credential.*`, `payment_page_code.*`, `authority.*`, `audit.write` | **PROHIBITED** | §6. |

---

```

#### `docs/architecture/v1.3.7/deliverables/26-authority-and-policy-model.md` lines 249–265 (`§2.1.2 Constructor versioning` — the class-19 linkage)

```markdown
### 2.1.2 Constructor versioning (v1.2, SR-C4, CAN-04)

`§11`'s v1.1 reproducibility claim — *"same inputs, same version, same verdict, forever"* — was false across any constructor deploy, because the *inputs* are constructed by a versioned constructor whose version was recorded nowhere. `I18`'s settlement-side investigation could not determine which constructor computed the exposure it was disputing, and `35`'s walkthroughs were auditable after the fact only for the policy half.

```
ConstructorVersionRecord {
  constructor_id, action_class,
  semantic_major, non_semantic_minor,
  changed_fields[], semantic_change: bool,
  signed_at, signature
}
```

**The semantic/non-semantic line is declared, not asserted per deploy.** A bump is **semantic by definition** — and cannot be declared otherwise — if it changes any of: exposure computation, `cost_components` membership, enumeration membership, the `semantic_option_digest`, counterparty derivation, `value_direction`, recoverability, or the dispatch payload's field set. Anything else — logging, refactoring, a `description` string — may be declared non-semantic.

`constructor_version` is recorded on the `AuthorizationRequest`, the `AuthorizationDecision`, the journal row, the approval binding alongside `dispatch_payload_hash`, and the replay context. **A pending approval must not silently execute under changed construction semantics**: on resume, a differing `semantic_major` denies `CONSTRUCTOR_SEMANTIC_CHANGE` and re-proposes with a `RemedyObligation` (`§12`); a differing `non_semantic_minor` resumes. Replay of a recorded decision under a differing `semantic_major` is **refused**, not silently recomputed. Constructors join the control-artifact manifest as class 19 (`50 §2`) — **they compute money and in v1.1 they were not owner-signed.**

```

#### `docs/architecture/v1.3.7/deliverables/26-authority-and-policy-model.md` lines 305–309 (`§2.3 What is deliberately absent from the tuple`)

```markdown
### 2.3 What is deliberately absent from the tuple

**Any free text with authority.** The engine reads no prose. `rationale` exists for the audit record and the engine never parses it. This is B3, and it is the property that makes injection unable to argue with the gate.

---
```

#### `docs/architecture/v1.3.7/deliverables/34-architecture-decision-records.md` lines 655–756 (ADR-024 — per-adapter credentials, deferred broker, execution proxy)

Full file: 97,228 bytes. Included: ADR-024 complete. ADR-026 follows at 757.

```markdown
## ADR-024 — Vendor credentials are held per adapter; the broker is deferred and returns as an execution proxy

**Status:** ACCEPTED for option A. **New in v1.1 (R5).**

**Context.** `29 §3` v1.0 described the broker as issuing *"short-TTL, audience-bound, action-scoped tokens, to adapters only, per invocation."* Tested against the platform this architecture selects: **Shopify custom-app offline access tokens do not expire, and their scopes are set at the app, not per request.** There is no TTL to shorten, no audience to bind and no action to scope. So the broker could not have been issuing the vendor credential with the described properties, because no such credential exists to issue (CRD-01).

And an internal action-scoped token constrains the vendor credential **only if the component presenting the vendor credential enforces the constraint.** The presenter is the adapter. The adapter would be enforcing a restriction on itself — an audit tag, not a security boundary (CRD-02).

**Alternatives.** `42 §4` gives three and eliminates one.

1. **Option A — adapters hold their own secrets and are declared TCB members.** Honest, matches what the code will do anyway, and removes an MVP component that does not do what it claims.
2. **Option B — the broker as an execution proxy**: the only holder of vendor credentials and the only process that opens a vendor connection, receiving typed pre-authorised request descriptors, validating against the authorisation reference, signing its own audit record, performing the call and returning raw bytes.
3. **Option C — no component holds a credential exceeding a single action.** **Does not exist.** It requires the vendor to issue per-action credentials, and no platform in this stack does: Shopify scopes are app-level; Google Ads requires the full `adwords` scope for any GAQL query including a pure read; Meta's `ads_management` covers create/update/pause/delete; ESP server tokens send anything to anyone. **Stripe restricted keys are the one genuine exception.**

**Decision.** **Option A for the MVP; the broker component is removed** (`45 §3`). Per-adapter vendor secrets in the platform secret manager, injected at process start, never shared, with per-adapter runtime, filesystem and dependency-tree isolation, bank-line ingest in its own runtime, and a per-credential revocation switch that **revokes** rather than stopping the loop.

**Adapters are declared members of the Trusted Computing Base** (`49`), and this document does not claim internal capability tokens reduce external vendor credential scope.

**Option B is specified now and built at the first money-moving credential or the third adapter, whichever comes first.** Its two benefits are real and unavailable under A: action scoping becomes enforceable **at the point the credential is presented**, and raw vendor responses can be retained outside the adapter, which is what makes provenance stop being self-attested (ADR-016).

**v1.3.7 — THE TRIGGER IS MECHANISED (`S1N-C1`).** v1.1 through v1.3.6 stated the trigger in
this sentence and in `23 §11`, `29 §3.2`, `31 §12`, `33 §7` and `37 §5`, and **no deliverable
said how a build would decide which credential is money-moving.** S1N derived it from class 3
field 4 — a statement about the ACTION ACOS intends to dispatch — and recorded the derivation as
an open owner question. **The owner rules that derivation wrong in kind.**

> **MONEY-MOVING IS A PROPERTY OF THE CREDENTIAL'S CAPABILITY ENVELOPE AT THE PROVIDER, NOT OF
> THE CURRENT ACTION'S `value_direction` AND NOT OF ITS `carries_vendor_monetary_field`.**

`50 §2g` carries the normative definition, the closed three-value `credential_risk_class`
(`READ_ONLY`, `NON_MONETARY_WRITE`, `MONEY_MOVING`), the nine money-moving clauses, the
maximum-privilege rule for a mixed envelope, and the fail-closed rule for a missing
classification. **It is class-5 content — signed, dual-signed, and a manifest member — because a
trigger operand read from an environment variable, a caller parameter, an adapter's own
self-description, a model output or a provider response would be unsigned authority.**

**The trigger, restated mechanically.** Option A is permitted only while **both** hold:

1. **fewer than three** configured external-write adapter runtimes, under this ADR's counting
   rule; and
2. **every** configured vendor credential has `credential_risk_class` other than `MONEY_MOVING`.

**The first configured `MONEY_MOVING` credential requires option B. The third adapter requires
option B. Whichever occurs first wins.** Neither half weakens the other, and this ADR's own
argument — *"with two adapters and no money, a broker adds a TCB member and delivers nothing"* —
is preserved exactly: `29 §14`'s standing finding that **vendor scopes are coarser than ACOS
action classes** is why the operand has to be the credential rather than the action, and a
credential that genuinely carries no money-moving provider permission still admits option A.

**Option B remains UNIMPLEMENTED at v1.3.7.** The trigger is now objectively executable; the
execution proxy is not built, so crossing either half is a refusal at configuration.

**Rationale.** With two adapters and no money, a broker adds a TCB member and delivers nothing. It also becomes the highest-value target in the company — a chokepoint behind a chokepoint — and **vendor credentials survive an ACOS rebuild while the control plane does not**, so the broker's compromise is worse than the control plane's (`41 §3.7`). Deferring it is the smaller residual now and the better design later.

**Evidence.** `42 §2`, `42 §4`, `42 §5`; `41 §3.7`, `41 §3.8`; CRD-01, CRD-02, CRD-05, CRD-07.

**Invariants.** **I25** — no control-plane process holds a vendor credential. **I15 replaced** — for each prohibited class with a reachable vendor endpoint, a scheduled probe attempts the operation against a sacrificial resource and asserts vendor-side failure; **a succeeding probe is a critical incident.** As written, I15 compared ACOS's own scope labels to its own prohibition list and passed vacuously.

**Consequences.** Two of twelve categorical prohibitions have **no credential-level enforcement at all** (`29 §3.3`) — `platform.spend_cap.raise` and the `email.send` / `email.campaign.send` distinction — and those classes are marked **non-autonomous**. `35 §7` layer 3's claim that the platform cap holds *"even if the entire control plane misbehaves"* is withdrawn. Each adapter's blast radius is its full vendor scope plus every authority its RECORD writes can satisfy.

**Reconsider if:** a vendor ships per-action credentials, or ACOS reaches the money-moving/third-adapter trigger — at which point build option B properly rather than reviving the v1.0 description. **v1.3.7: “reaches the trigger” is now a decidable question over signed class-5 bytes (`50 §2g`), not a judgement call.**

---

## ADR-025 — Control artifacts are owner-signed and hash-verified against a manifest

**Status:** ACCEPTED. **New in v1.1 (R11).**

**Context.** B9 v1.0 prohibited self-modification of six artifact classes: grants, policies, the action catalogue, model bindings, credential scopes and audit records. It **omitted** the utterance template corpus, the approved policy corpus, the prohibited-commitment grammar, the ten escalation detectors and their patterns, promoter rules, `context_spec`s, metric computation specs, tolerance rules, the locale rendering policy and the adverse-facts threshold set — **and every one of those defeats a stated invariant if modified** (REC-05, UTT-02).

The sharpest case: the prohibited-commitment grammar was applied to T-U1 *generations at runtime* and never to *templates at authoring time*, so the entire T-U0 commitment surface was an unversioned, uninvarianted template file that anyone with the deploy path could edit. A tolerance rule's modification silently disables the terminal financial control. An adverse-facts threshold's modification changes what counts as bad news.

**Alternatives.** Code review (rejected — v1.0's implicit answer, and `21 §2` item 16 records two auditability failures inside this project's own review process); version control alone (rejected — proves history, not deployed state); an owner-signed content-hash manifest (adopted).

**Decision.** `50-control-artifact-manifest.md` defines sixteen control-artifact classes, each with a content hash, a version and an owner signature. **Every control artifact's deployed content hash must match the signed manifest (I19), and a mismatch halts effects in the affected class.** The audit plane recomputes the hashes independently. The prohibited-commitment grammar runs against **templates at authoring time in CI**, not only against generations at runtime. `30 §6.4`'s quarterly diff extends to the full set.

**Rationale.** The distinguishing question is not whether an artifact is code or data; it is **whether modifying it changes what ACOS may say, believe, calculate or authorise.** Sixteen artifacts pass that test and v1.0 protected six. Halting the affected class rather than the whole system keeps the response proportionate: a template mismatch stops that utterance class, not order fulfilment.

**Evidence.** `44 §1.1` attack 3; REC-05, UTT-02.

**Invariants.** **I19** — manifest hash match, halting the affected class. **I38** — the adverse-facts threshold set specifically, because the CEO must not shape the predicate that decides whether a fact is adverse.

**Consequences.** Editing a template becomes an owner-signed act, which slows customer-communication iteration — the cost EM4 already accepted for templates and v1.0 then failed to enforce. A signing ceremony the owner must actually perform, which is one more demand on the scarcest resource in the company.

**Reconsider if:** the signing burden proves to exceed the owner's attention budget, in which case the response is to reduce the number of artifacts requiring signature by making some of them derived — not to relax the invariant.

---

**v1.2 amendment to ADR-025 (SR-C4, SR-A3, SR-S4, SR-S3).** Five classes added — **19** effect constructors, **20** the `ACOS-JCS-1` journal canonicalisation specification, **21** adapter parameter sets with provenance grades, **22** `cessation_grace`, **23** anchor-medium selection. Nineteen and twenty are the consequential ones: a constructor computes every dispatched amount and was governed by code review alone, and `ACOS-JCS-1` defines what the integrity machinery hashes, so changing it is indistinguishable from breaking the chain. The manifest's own count is corrected: **twenty-three rows, twenty-one signed classes, one prohibition.**

**v1.3 amendment to ADR-013 (TA-01 … TA-07). Five corrections, none of which abandons the attestation, the inversion or the relocation of the completeness claim.**

1. **The claim is corrected, not the mechanism** (TA-01). `I17`/`I17e` establish *continuity of the attestation channel and internal consistency and completeness of the latest attested prefix*. They do **not** establish that the attested maximum equals the true control-journal maximum, and v1.2's `30 §5.5` case 2 claimed a 15-minute bound that holds against transport loss and not against the attester. Case 2 is split into 2a and 2b; registry `§3` item 9 records the class of suppressed rows with **no detector at all**; and VC-A1d is a mandatory negative control asserting `I17e` does **not** fire against an adjusted attestation.
2. **`I8` acquires a bound and a scope** (TA-02, TA-03). Per-adapter sweep cadence, `CONFIGURED`, audit-plane scheduled; detection bound written as `sweep_cadence + vendor_reporting_lag` with the second operand `UNMEASURED`; and the tag set restated as an **additive verification list that never scopes the sweep**.
3. **A dispatch→tag detector exists** (TA-04). `I17f(c)`, audit-plane owned, on a declared 15-minute evaluation interval.
4. **The corroboration signal is a contract** (TA-06). `MirrorInputStallSignal`, Ed25519-signed under an audit-plane-only key, pulled from a declared audit read endpoint, `max_age` 5 minutes, replay-protected — and `30 §5.6` now states plainly that partition and audit-plane outage do **not** reach `CORROBORATED_DEGRADED`.
5. **The override is kernel state** (TA-05). `DegradedModeOverride` with declared scope, time box, count cap, monetary cap, expiry-to-restrictive-state, second-approver rule, and the aggregate composition bound `I63`.

**What did not change and was not renegotiated:** the attestation, `k = 3` at a 5-minute cadence, the inversion, the three-state machine, the relocation of the unqualified completeness claim to `I8`, or R10's removal of the control-database replica.

**v1.2 amendment to ADR-013 (SR-A1, SR-A2, SR-A4, SR-A5).** The replicating verifier survives; its completeness claim is re-scoped. `I17` is *transport* completeness — what a push target can actually check — and the unqualified claim moves to `I8`, which is evaluated from the audit plane's own vendor reads. `JournalAttestation` at 5 minutes with k=3 makes silence distinguishable from idleness within 15 minutes, against an hourly anchor designed to bound rewrite rather than silence. **Degraded mode is no longer self-declared and no longer relaxes anything**: the uncorroborated state is *stricter* (`30 §5.6`), so a compromised control plane declaring degradation harms itself. `journal_seq` comes from a counter row rather than a `SEQUENCE`, under a declared lock order, and re-push is idempotent under `UNIQUE(company_id, journal_seq)`.

```

#### `docs/architecture/v1.3.7/deliverables/34-architecture-decision-records.md` lines 757–830 (ADR-026 — outbox, recoverability-keyed unknown outcomes)

```markdown
## ADR-026 — Irrecoverable dispatch goes through an ACOS-owned outbox, and unknown outcomes are keyed on recoverability

**Status:** ACCEPTED. **New in v1.1 (R13).**

**Context.** Two of this package's own rules collided and nobody noticed. `25 §7`: *"Where the adapter's API offers no idempotency, the effect class is downgraded: it cannot be autonomous, and if it is also irrecoverable it is excluded entirely."* `26 §5` classifies `email.send` as **IRRECOVERABLE**, and most ESPs offer neither an idempotency header nor a synchronous query primitive. **So the rule as written excludes autonomous email sending** — while `33 §9` planned a "T-U0 heavy" operating profile, `37 S4` built autonomous T-U0 sends and `37 S7` extended to a real recipient (DUP-01). The internal quality gate identified the ESP at-least-once exposure as its one real residual and did not notice the residual was prohibited.

And `35 §4` had **one** unknown-outcome policy for all classes — hold and resolve — which is right for money and wrong for an irrecoverable send in the same way (DUP-02). No invariant compared dispatched sends to reserved units or to the provider's own count (DUP-03).

**Alternatives.**

1. **Require vendor idempotency.** Rejected as the only answer: it eliminates most of the ESP market and it is not necessary, because the query primitive can be built.
2. **Hold-and-resolve for sends, as for money.** Rejected: holding does not help when there is nothing to query synchronously, and the retry that eventually follows is the duplicate.
3. **An ACOS-owned outbox with a recoverability-keyed policy.** Adopted.

**Decision.**

1. **ACOS-owned outbox.** One row per intended message, **unique on the effect idempotency key**, carrying a unique **correlation tag in a provider-visible field** (custom header, metadata, tag).
2. **At-most-once claim.** The row transitions to `CLAIMED` in a committed transaction **before** the HTTP call. **A `CLAIMED` row is never re-dispatched by any path** — recovery, workflow fork, or manual replay (I36).
3. **Recoverability-keyed unknown-outcome policy.**

| Class | On unknown outcome |
|---|---|
| REVERSIBLE / COMPENSABLE (money) | **Hold and resolve.** Reservation held; the reconciler queries or re-POSTs under the original authorisation; never a blind retry. |
| IRRECOVERABLE | **Assume it happened. Never re-dispatch.** Mark `PRESUMED_EXECUTED`, consume the irrecoverable unit — **`reserved_irrecoverable → presumed_irrecoverable`, v1.3.5, `25 §10.1`** — resolve later from the provider's delivery event. |

4. **Delivery-event reconciliation** on the correlation tag resolves `PRESUMED_EXECUTED` to `VERIFIED` or `NEVER_SENT`. **A `NEVER_SENT` row is a new proposal requiring fresh authorisation, never a retry** — which keeps the irrecoverable-unit accounting honest.
5. **ESP selection becomes an EM6 criterion.** A provider with neither an idempotency header nor a delivery-event webhook nor a queryable message log **cannot serve an IRRECOVERABLE class.** That is `25 §7`'s disqualifier applied where it belongs — to vendor selection rather than to engineering.

**Rationale.** The asymmetry is the point. For money the expensive error is duplication, so hold and ask. For an irrecoverable send the expensive error is **also** duplication — Gmail bulk-sender status has **no expiration** and spam rate must stay under 0.1%, so a duplicate storm is a permanent domain-reputation event rather than an annoyance — so **assume-executed is the safe direction and the missed message is recovered by detection rather than by retry.**


**v1.3.4 amendments (IRN-01, OBX-01, OBX-02, OBX-03). The decision is unchanged; four things it depended on are now declared.**

- **This ADR was unreachable as issued.** `30 §5.1` item 4 row 1 was printed as Halt in `NORMAL` too, so the class this ADR is titled for could never be dispatched at all and decision items 2 through 5 had no subject. `30 §5.1b` corrects row 1's `NORMAL` cell **only**: an otherwise-valid IRRECOVERABLE effect is dispatch-eligible in `NORMAL` and still halts in `UNCORROBORATED_STALL`, in `CORROBORATED_DEGRADED`, under the `30 §5.1a` full-halt posture, and against any owner override.
- **Decision item 2's state machine is declared** in `25 §7`: `ENQUEUED → CLAIMED`, one transition, and **no timeout, lease, expiry or reclaim out of `CLAIMED`**. *"Never re-dispatched by any path"* is a state machine, not a convention.
- **The outbox's scope is declared** in `25 §7`: **every effect crossing an external-write boundary**, not the irrecoverable class alone. This ADR's title names the case that forced the mechanism; it never bounded it.
- **"The committed transaction before the HTTP call" is identified** with the claim transaction, which is also `30 §5.7.2` item 3's *"dispatching transaction"* (`25 §7`, OBX-03).

**Decision items 3, 4 and 5 are unchanged and remain unbuilt at v1.3.4.** `PRESUMED_EXECUTED`, MIE consumption at the execution point, delivery-event reconciliation, `VERIFIED`/`NEVER_SENT` and the ESP criterion all belong to the later execution/adapter slice (`37 §2`). **A claim is not an execution**, and reaching `CLAIMED` asserts none of them.


**v1.3.5 amendments (MIE-01, OBX-04, OBX-05, SER-01). The decision is unchanged; decision item 3's ledger movement, its outcome taxonomy and its serialization protocol are now declared.**

- **Decision item 3's "consume the irrecoverable unit" is declared as a ledger movement** in `25 §10.1` and `24 §3` K5: an authorised IRRECOVERABLE effect **reserves** its catalogue-declared `irrecoverable_units` at local authorisation (`26 §7` step R), and `PRESUMED_EXECUTED` moves them **`reserved_irrecoverable → presumed_irrecoverable`**, exactly once, atomically with the effect state, the outcome state and the outcome journal row. **The three-term sum does not fall, so an unknown outcome creates no headroom.** As issued, all four statements of this requirement named a movement no artifact defined, and **no reservation of an irrecoverable unit was declared anywhere — so there was no unit to consume** (`S1J-C1`).
- **`irrecoverable_units` is catalogue-owned, never model- or caller-supplied**, and is `1` for every current IRRECOVERABLE class.
- **Decision item 3 is extended to the adapter-returned case** (`25 §7.1`): an `ADAPTER_RETURNED` outcome on an IRRECOVERABLE effect reaches **`PRESUMED_EXECUTED`** and performs the same movement, because an accepted request is at least as strong as an ambiguous one for duplicate-prevention purposes. **An adapter response is still never independent verification.**
- **The adapter outcome taxonomy is closed** (`25 §7.1`, OBX-04): `ADAPTER_RETURNED`, `OUTCOME_UNKNOWN`, `NOT_SENT_CONFIRMED` and a policy-free `ADAPTER_FAILED`. **`24 §3` K4's "bounded retry against the same idempotency key" is corrected to no retry after a claim** — it contradicted decision item 2 outright — and retry is scoped to workflow and internal failures **before** an external-effect claim.
- **A known-not-sent immediate outcome is declared** (`25 §7.2`, OBX-05): `NOT_SENT_CONFIRMED`, admissible only where a trusted adapter can positively establish that no external write crossed the boundary and never from an error string, reaches the terminal **`DISPATCH_NOT_SENT_CONFIRMED`** and **releases** the commitment in the same atomic transaction. **It is deliberately distinct from decision item 4's `NEVER_SENT`**, which is later independent provider evidence after a presumption. Both make a further attempt **a new proposal under fresh authorisation with a new effect and outbox identity**, never a retry of the claimed row.
- **The serialization protocol across the asynchronous boundary is declared** (`25 §14.1`, SER-01): `25 §14`'s single continuous propose→authorise→execute lease **is not achievable across this ADR's own outbox** and is replaced by **two epochs** — an authority lease through the authorising COMMIT, and a **dispatch lease** (a new session, never described as the same lease) held continuously across **dispatch-time revalidation → claim → COMMIT → adapter → outcome → COMMIT** — plus **mandatory dispatch-time revalidation of the originally authorised effect before the claim.** A stale effect cannot dispatch, and **no new payload is constructed and no option is substituted** (`S1J-C6`).
- **`I20`'s denominator is the historical committed reservation basis**, not the current value of `reserved_irrecoverable`, because the declared lifecycle moves units out of that term without reducing the commitment. **An ACOS-side count is not a provider-reported count**, and `I20`'s left-hand side still requires the audit plane's own provider read.

**What v1.3.5 leaves unbuilt.** Decision item 4 in full — the provider query, the delivery-event webhook, the reconciliation, `VERIFIED` and `NEVER_SENT` — and decision item 5's empirical ESP capability measurement. The REALISE and never-sent RELEASE transitions of `25 §10.1` are **declared so the MIE lifecycle is complete, and are reached only from provider evidence that does not yet exist.** **`I20` and `I36`'s verification leg remain OPEN**, and VAL-04's real-sandbox kill-point requirement is undischarged.

**Evidence.** `44 §5`; `25 §7`; DUP-01, DUP-02, DUP-03; quality-gate Gate 5's residual, now closed rather than accepted.

**Invariants.** **I36** — no outbox row transitions from `CLAIMED` to a second dispatch. **I20** — `Σ provider-reported accepted irrecoverable effects per window instance ≤ Σ legitimately authorised/reserved irrecoverable units for that window instance` (v1.3.5: the right-hand side is the **immutable historical reservation basis**, not the current `reserved_irrecoverable` term — `25 §10.1`), reconciled by the **audit plane** from its own ESP read credential. **I53** at the dispatch boundary — no effect is dispatched whose authorised option is absent from the live enumeration at dispatch-time revalidation (v1.3.5, `25 §14.1`).

**Consequences.** A missed message is now possible and is detected rather than prevented — the correct trade, and it means abstention and re-authorisation appear in the human residual. ESP choice is constrained. And **the kill-point tests must run against a real ESP sandbox rather than a mock** (VAL-04), because duplicate prevention at the dispatch boundary is a vendor property and a mock with a naive idempotency implementation passes while the vendor would not.

**Reconsider if:** a provider offers a genuine idempotency key with a documented deduplication window longer than the reconciler's resolution latency — in which case the outbox remains (it is also the at-most-once claim) and the unknown-outcome policy for that provider can move toward hold-and-resolve.
```

### C.11 `50 §2a` and `50 §2g` — class-3's and class-5's CLOSED content schemas

`§2a` is the class-3 schema whose ten per-class fields a new action class must supply.
`§2g` is class-5's, including `credential_risk_class` and the `credential_id` binding.

#### `docs/architecture/v1.3.7/deliverables/50-control-artifact-manifest.md` lines 76–109 (`§2a` class-3 closed content schema)

Full file: 80,185 bytes.

```markdown
## 2a. Class 3's CLOSED content schema (v1.3.6, `S1K-C6`)

**v1.3.5's class-3 row read *"Action catalogue, **incl.** recoverability class, ..."*. `incl.` is not a closed enumeration, and a content hash cannot be computed over content whose boundary is not declared. The list below is the WHOLE of class 3's signed content. There is no `incl.`, no `etc.` and no open tail.**

**Part A — the per-action-class record.** Exactly ten fields, for every member of the closed action catalogue.

| # | Field | Domain | Authority it carries |
|---|---|---|---|
| 1 | `action_class` | the closed catalogue's member set | class identity; `SR7`'s single extension point |
| 2 | `recoverability` | `REVERSIBLE` \| `COMPENSABLE` \| `IRRECOVERABLE` | `26 §5`; the MIE ledger's applicability |
| 3 | `value_direction` | `26 §2.1`'s six values; never null (`I59`) | which direction value moves |
| 4 | `carries_vendor_monetary_field` | bool | `I18a`'s null branch |
| 5 | `cost_component_free` | bool | `I18c`'s equality condition |
| 6 | `rate_based` | bool | `26 §2.1.3` — a rate class reserves `0.00` |
| 7 | `irrecoverable_units` | non-negative integer | **v1.3.6: class 3, not class 17.** `51 §2.3`; the MIE reservation quantity |
| 8 | `settlement_tolerance` | `EXACT` \| `BAND` \| `NONE` | `51 §5.1`, `I18d` |
| 9 | `adapter` | an adapter identifier, or the reserved sentinel `internal_only` | **`I66`'s outbox scope predicate is derived from this field**; changing it to `internal_only` removes an effect from the outbox entirely |
| 10 | `method` | the adapter operation | the dispatched vendor operation |

**Part B — the catalogue-level records.** Exactly four.

| # | Record | Content |
|---|---|---|
| 11 | `reason_codes` | the closed `reason_code` enum (`26 §2.0`) |
| 12 | `reason_code_scopes` | the total map from each `reason_code` to its `reason_code_scope` (`26 §2.2`) |
| 13 | `semantic_option_digest_fields` | per action class, the declared ordered field list the digest covers (`26 §2.2`) |
| 14 | `enumeration_max_age` | per action class, the enumeration `max_age` checked at C′ (`26 §2.0.1`) |

**What is NOT class 3 content, stated so the boundary has two sides.** `degraded_per_action_approval_floor_monetary` — **class 27** (`§2c`). Per-action monetary caps, window ids and window ceilings — **grants and `window_registry` runtime rows**, not the catalogue. The constructor logic and its `ConstructorVersionRecord` — **class 19**. The Cedar policies that read catalogue fields — **class 2**.

**No authority-bearing catalogue field exists outside this boundary, and no field in it belongs to a second class.** The two v1.3.5 co-residences `S1K-C6` reported are both resolved by ownership rather than by splitting a file: `irrecoverable_units` is class 3 content wherever it is stored, and the approval floor is class 27 content wherever it is stored.

---

```

#### `docs/architecture/v1.3.7/deliverables/50-control-artifact-manifest.md` lines 191–355 (`§2g` class-5 closed schema + `§2f` field ownership)

```markdown
## 2g. Class 5's CLOSED content schema, and `credential_risk_class` (v1.3.7, `S1N-C1`)

**v1.3.6's class-5 row read *"Credential scope declarations"* and closed nothing.** ADR-024's option-B trigger fires at *"the first **money-moving credential**"*, and no deliverable at v1.3.6 said how a build would decide which credential that is. `S1N-C1` recorded the gap and S1N derived the answer from class 3 field 4 as a temporary measure. **THE OWNER RULES THAT DERIVATION WRONG IN KIND, NOT MERELY IN CALIBRATION**, and v1.3.7 replaces it.

### The normative definition

**MONEY-MOVING IS A PROPERTY OF THE CREDENTIAL'S CAPABILITY ENVELOPE AT THE PROVIDER. IT IS NOT A PROPERTY OF THE ACTION ACOS CURRENTLY INTENDS TO CALL.**

A credential is **`MONEY_MOVING`** if **any** provider permission reachable with that credential can, **without requiring a second independently held credential**, do any of:

1. debit or charge funds;
2. capture or settle a payment;
3. refund or externally credit funds;
4. transfer or pay out funds;
5. withdraw funds;
6. purchase goods or services creating monetary liability;
7. issue or redeem externally meaningful monetary or stored value;
8. initiate provider-side monetary spend;
9. increase a budget, spend cap, credit line, or analogous provider-side authority that permits additional spend.

**The subject of every clause is what the CREDENTIAL can do at the PROVIDER.** `29 §14`'s standing finding is the reason: *"vendor OAuth scopes are coarser than ACOS action classes on every platform examined"*, so a credential provisioned for one ACOS action routinely carries provider permissions ACOS never intends to use. A classification that read ACOS's intended action would classify that credential by the half of its envelope ACOS chose to look at.

### The closed classification

`credential_risk_class` takes **exactly three values and no fourth**:

| Value | Meaning |
|---|---|
| `READ_ONLY` | every reachable provider permission is a read or a query; the credential performs no external mutation of any kind |
| `NON_MONETARY_WRITE` | at least one reachable permission mutates provider-side state, and **no** reachable permission satisfies any clause of the nine above |
| `MONEY_MOVING` | **at least one** reachable permission satisfies at least one clause of the nine above |

**There is no `UNKNOWN`, and a missing classification is not a permissive default.** A configured vendor credential whose `credential_risk_class` is absent, unparseable, or outside this closed set **FAILS CLOSED**: the configuration is refused and the process does not start.

**MAXIMUM PRIVILEGE DECIDES A MIXED ENVELOPE.** A credential carrying an email-send permission *and* a payment-refund permission is `MONEY_MOVING`. A credential carrying a read permission *and* a webhook-subscription permission is `NON_MONETARY_WRITE`. The class is the highest reachable, never the lowest, never the average and never the intended.

**Examples that are `NON_MONETARY_WRITE` when those are the credential's only mutating permissions**, stated so the boundary has two sides: transactional or marketing message send; webhook subscription management; non-monetary support communication; address edit; non-monetary fulfilment operation; any other external write with no provider-side monetary effect and no provider-side spend authority.

### What this classification is NOT

**It is not ACOS action authority, and the two must not be merged.** If an ACOS action class is monetary but the configured credential cannot execute it at the provider, that is a **provider capability / `I15` enforceability** question — `29 §14` replaced `I15` with exactly that empirical probe — and it does not make the credential `MONEY_MOVING`. Conversely a `MONEY_MOVING` credential does not grant ACOS any authority: `26`'s authority model is unchanged by this section and remains separately governed.

**It is not inferred from an action name, a method name, an adapter name or a credential label.** `credential_risk_class` is DECLARED, from the enumerated provider permissions, in signed bytes.

### The closed class-5 record

**The list below is the WHOLE of class 5's signed content. There is no `incl.`, no `etc.` and no open tail.** One record per configured vendor credential, exactly seven fields.

| # | Field | Domain | Authority it carries |
|---|---|---|---|
| 1 | `credential_id` | **the stable non-secret identity of the exact credential MATERIAL the runtime may present**, unique within the artifact | the binding between this signed record and the material a runtime actually holds; **never the material itself** |
| 2 | `adapter` | an adapter identifier the class-3 catalogue names, **or the reserved sentinel `audit_plane`** | which runtime this credential scopes (`23 §7`). **`audit_plane` names an AUDIT-PLANE read credential** (`48 §2` row 13), which is scoped to a provider rather than to an adapter because its job is to ask the provider what happened rather than to dispatch anything |
| 3 | `provider` | a provider identifier | which vendor grants the permissions |
| 4 | `granted_provider_permissions` | a non-empty closed list of provider permission identifiers, as the PROVIDER spells them | the capability envelope this section classifies |
| 5 | `monetary_provider_permissions` | the subset of field 4 satisfying at least one of the nine clauses | which permissions make the envelope monetary; **an empty list means none, and is not the same as absent** |
| 6 | `credential_risk_class` | `READ_ONLY` \| `NON_MONETARY_WRITE` \| `MONEY_MOVING` | **ADR-024's option-B trigger operand** |
| 7 | `external_mutation_capable` | bool | whether any permission in field 4 mutates provider-side state; `48 §3.6`'s read-only exemption operand for an audit-plane credential |

**THE `audit_plane` SENTINEL IS RESERVED AND CARRIES NO DISPATCH AUTHORITY.** It is not an adapter identity, it is never added to the class-3 catalogue, and the adapter-runtime registry refuses a descriptor naming it — an audit read credential is not a credential any adapter may present. It exists so that `48 §3.6`'s audit-plane credential has a declared owner in the same closed schema as every other credential, rather than sitting outside every signed boundary as it did at v1.3.6.

**Fields 5, 6 and 7 are CONSISTENCY-CHECKED against field 4 and against each other at verification, and a declaration that disagrees with itself is REFUSED.** `credential_risk_class` is `MONEY_MOVING` exactly when field 5 is non-empty; `READ_ONLY` requires field 7 false; `NON_MONETARY_WRITE` requires field 7 true and field 5 empty. **The check is over signed bytes only** — nothing reads a provider, and no provider response, account response, adapter self-description, environment variable, caller parameter or model output may supply, override or widen any of the seven fields.

**Signer: Owner, second factor. Halt scope: the affected adapter** — unchanged from v1.3.6's class-5 row, and the reason is now printed: a credential whose declared envelope cannot be verified is a credential whose option-B trigger cannot be evaluated, and `§3f`'s fail-closed rule already forbids serving a degraded subset.

### `credential_id` is a BINDING, not a name (v1.3.7 correction)

**A `credential_id` that is only a label makes this entire section governable by whoever writes the wiring.** The first v1.3.7 draft defined field 1 as *"a credential identifier, unique within the artifact"*, which is satisfied by a nickname — and a nickname admits this:

```
signed class-5 record    mock_ads.pause_only       ->  NON_MONETARY_WRITE  ->  registry admits
secret locator           resolves ...................  mock_ads.budget_manage's material
                                                        which is MONEY_MOVING
```

Nothing is forged. No signature is broken. The deployment is running a money-moving credential under a non-monetary declaration, and ADR-024's option-B trigger never fires because the registry evaluated the record for the OTHER credential. **The audit plane has the mirror image**: a signed `READ_ONLY` record and a send-capable token, with `48 §3.6`'s exemption resting on a declaration about a credential the reader is not holding.

**SO FIELD 1 IS DEFINED AS THE STABLE NON-SECRET IDENTITY OF THE EXACT CREDENTIAL MATERIAL THE RUNTIME MAY PRESENT.** It is not a friendly alias, not an adapter-local name and not a descriptor label.

| Where the provider... | field 1 is |
|---|---|
| exposes a stable non-secret API-key identifier | **that provider key ID** |
| exposes none | an **immutable deployment / secret-manager credential identity or version** that the secret source can return for the exact material it resolved |

**Field 1 is NEVER the raw secret, NEVER a hash or fingerprint of it, and NEVER a token prefix used as an ad-hoc identity.** A fingerprint under a rotation schedule is a confirm-a-guess oracle, and a prefix is a partial disclosure of the material it claims to describe.

**IF NO SUCH IDENTITY CAN BE DEFINED FOR A PROVIDER, THE SLICE THAT WOULD CONFIGURE THAT PROVIDER RETURNS PARTIAL.** A binding that is only a label must not be recorded as a binding.

### The runtime-use requirement: signed identity == resolved identity

**BEFORE A CREDENTIAL-HOLDING RUNTIME MAY REACH ITS PROVIDER BOUNDARY, IT MUST COMPARE THE SIGNED EXPECTED `credential_id` TO THE IDENTITY ITS OWN SECRET SOURCE RETURNED FOR THE MATERIAL IT RESOLVED. A MISMATCH REFUSES.**

This holds on **both planes, independently**:

| Plane | The parent reads | The child compares | On mismatch |
|---|---|---|---|
| integration | the verified class-5 record for the descriptor's `credential_id` | that identity against what its secret source resolved | **refused before any adapter code runs** |
| audit | **the AUDIT PLANE's OWN verification** of the same signed artifact (`§3`, property 2) | the same comparison, in its own process | **refused before any provider query** |

**THE SECRET SOURCE MUST THEREFORE RETURN A MANDATORY NON-SECRET CREDENTIAL IDENTITY FOR THE MATERIAL IT RESOLVED.** A null identity is not sufficient for a configured credential: a source that cannot name what it resolved has not supplied a usable one. A TEST or pre-live source returns an explicit synthetic identity and declares it as such.

**THE PARENT MAY PASS THE EXPECTED `credential_id` TO THE CHILD AS A TRUSTED NON-SECRET LAUNCH ECHO.** The echo is NOT authority — the signed artifact remains the authority, and the parent has already verified it — and the echo exists only because the comparison cannot happen in the parent: `I25` forbids the control plane holding a vendor credential, so the identity of the resolved material is visible only inside the child. **No credential material travels on IPC or in any environment, on either plane.**

**LOCATOR ISOLATION AND CREDENTIAL IDENTITY BINDING ARE DIFFERENT CONTROLS AND BOTH ARE REQUIRED.** A locator says where to look; an identity says what was found.

* two locators may resolve **one** credential, so locator inequality does not establish separation;
* one locator may be repointed at **another** credential, so locator equality does not establish identity.

`48 §3.6`'s requirement that the audit credential not share a source with the send credential is unchanged and is still enforced on locators. It does not imply this rule and is not implied by it.

### What identity binding does NOT prove

**IT PROVES "THIS IS CREDENTIAL A". IT DOES NOT PROVE "CREDENTIAL A STILL HAS THE PROVIDER PERMISSIONS THE SIGNED RECORD DECLARES".**

A scoped provider API key is mutable at the provider: its permissions can be widened after the class-5 record was signed, by an actor with provider-side administrative access and with no ACOS-observable event. **Credential scope drift is therefore an EMPIRICAL provider-side obligation**, discharged by probing the configured credential against the provider, and it is **NOT discharged by this binding, by the signature, or by any consistency check over signed bytes.** `36 §13`'s attempted-write test is the first of those probes and remains separately owed.

### ADR-024's option-B trigger, mechanised

**Option A is permitted only while BOTH hold:**

1. **fewer than three** configured external-write adapter runtimes, under ADR-024's existing counting rule; **and**
2. **every** configured vendor credential has `credential_risk_class` other than `MONEY_MOVING`.

**The FIRST configured `MONEY_MOVING` credential requires option B. The THIRD adapter requires option B. Whichever occurs first wins, and neither half weakens the other.** The third-adapter half is unchanged from v1.3.6 and needs no derivation. The money-moving half is now decided by field 6 of a signed class-5 record and by nothing else.

**Option B — the execution proxy — remains UNIMPLEMENTED at v1.3.7.** This section makes its trigger objectively executable; it does not build it. A deployment that crosses either half under option A is refused at configuration, which is the only behaviour available while the proxy does not exist.

---

## 2f. The CLOSED field-ownership table (v1.3.6, `S1K-C6`)

**`§2a`, `§2c`, `§2d` and `§2e` each close one artifact's boundary. This section reads the same closure the other way — field first — so that the question *"which signed artifact owns this field?"* has a printed answer for every authority-bearing static field a current production mechanism reads.**

**EXACTLY ONE CANONICAL SIGNED OWNER PER ROW. NO ROW IS OWNED BY CLASS 3 AND CLASS 27 BOTH.** **v1.3.7 adds three rows whose owner is class 5, and adds no row owned by two classes.** A field whose owner is not class 3 or class 27 is named with its actual owner rather than omitted, because omission is how `S1K-C6`'s six unowned fields survived v1.3.5.

| Field | Canonical signed owner | Where the boundary closes it | Reading mechanism | Was it ambiguous at v1.3.5? |
|---|---|---|---|---|
| **action identity** — `action_class` | **class 3** | `§2a` field 1 | the closed catalogue's member set; `SR7`'s single extension point | no — but the list it sat in was open |
| **recoverability** | **class 3** | `§2a` field 2 | `26 §5`; MIE applicability | no — same open list |
| **value direction** | **class 3** | `§2a` field 3 | `26 §2.1`; never null (`I59`) | **yes — outside the `incl.` list** |
| **adapter** | **class 3** | `§2a` field 9 | adapter selection | **yes — outside the `incl.` list** |
| **external-dispatch predicate** | **class 3**, *derived* | `§2a` field 9 | **`I66`'s outbox scope is DERIVED FROM `adapter`**, not separately stored; `adapter = internal_only` removes an effect from the outbox entirely | **yes — the predicate had no declared operand owner** |
| **method** | **class 3** | `§2a` field 10 | the dispatched vendor operation | **yes — outside the `incl.` list** |
| **`irrecoverableUnits`** — `irrecoverable_units` | **class 3** | `§2a` field 7; the move recorded in `§2d` and `51 §2.3` | step R's MIE reservation quantity | **yes — claimed by class 17, which is now RETIRED (`§2d`)** |
| `carries_vendor_monetary_field`, `cost_component_free`, `rate_based`, `settlement_tolerance` | **class 3** | `§2a` fields 4, 5, 6, 8 | `I18a`, `I18c`, `26 §2.1.3`, `I18d` | **yes — outside the `incl.` list** |
| `reason_codes`, `reason_code_scopes`, `semantic_option_digest_fields`, `enumeration_max_age` | **class 3** | `§2a` records 11–14 | `26 §2.0`, `§2.2`, `§2.0.1` | **yes — catalogue-level and unlisted** |
| **degraded approval floor** — `degraded_per_action_approval_floor_monetary` | **class 27** | `§2c` quantity 3 | `30 §5.1` item 4 row 2; strict `> 20.00` | **yes — claimed by class 3 in `50 §2` and `51 §3.7`; MOVED, value unchanged** |
| **signal freshness** — `corroboration_signal_max_age` | **class 27** | `§2c` quantity 4 | `30 §5.7.1`'s freshness rule | **yes — owned by NO signed class at all** |
| **mirror lag threshold** — `mirror_lag_critical_threshold` | **class 27** | `§2c` quantity 1 | `30 §5.1` item 5, `30 §5.1a`; inclusive `>= PT15M` | no |
| **full-halt threshold** — `audit_unreachable_full_halt_threshold` | **class 27** | `§2c` quantity 2 | `30 §5.1a`'s FULL-HALT POSTURE; inclusive `>= PT30M` | no |
| **override limits** — the eight quantities of `51 §3.6`, plus the registered OWNER-tier approver set | **class 25** | `§2` row 25 | grant of a new `DegradedModeOverride`; **active overrides run to their existing caps** | no — **and explicitly NOT class 27**, whose halt scope is all effects rather than the grant of an override |
| the Cedar policies that read any catalogue field | **class 2** | `§2e` | the policy loader, before the engine is constructed | no |
| the per-class canonicalisation logic and its `ConstructorVersionRecord` | **class 19** | `§2` row 19; `§3i` for its key migration | the constructor registry at load | no |
| the journal canonicalisation rules and every registered row kind's field order | **class 20** | `§2b` — the artifact file is the boundary | both journal chains and the TypeScript canonicaliser | no — **but the class had no artifact to sign** |
| **credential capability envelope** — `granted_provider_permissions`, `monetary_provider_permissions` | **class 5** | `§2g` field 4, field 5 | the provider permissions a configured credential reaches; the operand `credential_risk_class` is checked against | **yes — owned by NO signed class at all (v1.3.7, `S1N-C1`)** |
| **credential risk** — `credential_risk_class` | **class 5** | `§2g` field 6 | **ADR-024's option-B money-moving trigger.** It is a property of the CREDENTIAL, never of the action ACOS intends to call | **yes — the phrase *money-moving credential* had no mechanised operand and no owner (v1.3.7, `S1N-C1`)** |
| **credential external-mutation capability** — `external_mutation_capable` | **class 5** | `§2g` field 7 | `48 §3.6`'s read-only exemption for an audit-plane vendor credential | **yes — `48 §3.6` required *read-only* and named no signed operand** |

**FIELDS DELIBERATELY OUTSIDE EVERY SIGNED BOUNDARY, AND WHY.** Per-action monetary caps, window ids, window ceilings and their `UNBOUNDED` flags are **per-company `window_registry` runtime rows** (`§2d`, `§3h`), not deploy-time bytes. The open `AUDIT_MIRROR_DEGRADED` declaration, the current resolved mirror state, the held corroboration and any active `DegradedModeOverride` are **runtime rows** (`§2c`). `attestation_cadence` and `k` are `30 §5.4` **detection-latency** parameters and are not operands of any authority listed in `§6`'s closure rule (`phase2-v1.3.6-errata.md §6`). **Each of these is excluded by an argued rule rather than by silence.**

**The one declared duplication in the whole inventory** is `corroboration_signal_max_age`'s audit-plane copy: **equality across the two planes is a cross-plane obligation, not a second owner** (`§2c`).

**NO VALUE IN THIS TABLE CHANGED IN THIS PASS.** Two fields changed owning class — `irrecoverable_units` (17 → 3) and `degraded_per_action_approval_floor_monetary` (3 → 27) — and `analysis/recompute-v1.3.py` reproduces its recorded output line for line.

---

```

### C.12 `48` — the external-write perimeter, and the audit-plane read exemption

#### `docs/architecture/v1.3.7/deliverables/48-external-write-perimeter.md` lines 34–61 (`§2` the enumeration)

Full file: 23,522 bytes.

```markdown
## 2. The enumeration

Fourteen rows. The `authorisation_ref` column is the load-bearing one: **`REQUIRED` means the call site must carry a resolvable authorisation reference; `EXEMPT` means it carries an annotated `PERIMETER_EXEMPT(reason, ticket)` and appears in §3's justification table.**

| # | Component | Plane | External write? | Model-reachable? | v1.0 status | v1.1 `authorisation_ref` |
|---|---|---|---|---|---|---|
| 1 | Commerce adapter (Shopify Admin GraphQL) | Integration (Z2) | Yes | No | Authorised | **REQUIRED** |
| 2 | Communications adapter (ESP) | Integration (Z2) | Yes | No | Authorised | **REQUIRED** |
| 3 | Payment-processor adapter (Stripe test mode) | Integration (Z2) | Yes | No | *Did not exist* | **REQUIRED** |
| 4 | Advertising adapter (mock at MVP) | Integration (Z2) | Yes | No | Authorised | **REQUIRED** |
| 5 | Finance **ingest** adapter (provider cost APIs, payout, bank line) | Integration (Z2) | Reads only | No | **Ambiguous — placed in two planes** | **EXEMPT** (read-only; §3.5) |
| 6 | **Webhook subscription watchdog** | Kernel (Z1) | **Yes** | No | **Unauthorised** | **REQUIRED** — now a governed effect class (§5.1) |
| 7 | **Reconciler resolution / re-POST** | Kernel (Z1) | **Yes** | No | **Unauthorised** | **REQUIRED** — now a governed effect class (§5.2) |
| 8 | **Credential refresh / token rotation** | Integration (Z2) | **Yes** (vendor-side state change) | No | **Unauthorised** | **EXEMPT** (§3.1) |
| 9 | **Framework-managed OAuth and webhook registration** (`shopify-app-js`) | Integration (Z2) | **Yes** | No | **Unauthorised** | **EXEMPT** (§3.2) |
| 10 | **Migration / DDL principal** | Out of plane | No external write, but **can alter the audit schema** | No | **Unnamed** | **EXEMPT** (§3.3) — and a named TCB member (`49`) |
| 11 | **Observability exporter (Sentry)** | Cross-cutting | **Yes** (data egress) | No | **Absent from every egress table** | **EXEMPT** (§3.4) |
| 12 | Observability exporter (Langfuse) | Cross-cutting | Yes | No | Absent from every egress table | **REMOVED** (`31 §10`) |
| 13 | **Audit plane vendor reads** | Audit | Reads only | No | *Did not exist* | **EXEMPT** (read-only; §3.6) — **v1.3.7: the exemption's operand is `50 §2g` fields 6 and 7, the resolved material must be bound to `50 §2g` field 1 before any provider query, and the `36 §13` attempted-write test remains separately owed** |
| 14 | **External anchoring writer** | Audit | **Yes** | No | *Cadence unspecified* | **EXEMPT** (§3.7) |
| 15 | Egress proxy (research worker fetches) | Sandbox | Reads only, allowlisted, budgeted | **Yes** | Authorised as read | **EXEMPT** (read-only, deferred with the research worker) |

**Four rows are `REQUIRED` and were unauthorised in v1.0 (6, 7) or did not exist (3).** Six rows carry annotated exemptions. Two rows are new because v1.1 added capabilities. One row is removed.

**And note row 5.** v1.0 placed the finance capability in the control plane (`33 §2.1`) and in the integration plane (`28 §3`) simultaneously, while `23 §3` said the control plane holds only its own database credential. All three could not be true. The split — ingest holds credentials and computes nothing, computation holds no credential and is CI-checked for the absence of both a model client and a credential loader (I25) — is what resolves it.

---

```

#### `docs/architecture/v1.3.7/deliverables/48-external-write-perimeter.md` lines 108–198 (`§3.5`/`§3.6` finance ingest and audit-plane vendor reads, `§4` enforcement)

```markdown
### 3.5 Finance ingest (row 5) and 3.6 audit plane vendor reads (row 13)

**Why exempt.** Read-only. Neither mutates external state.

**Compensating controls.** Row 5's org-scoped model-provider admin credential is enumerated in §6 rather than assumed benign — it plausibly covers `credential.*` and spend-limit configuration, both prohibited classes — and is subject to I15's empirical probe. Row 13's credentials are **read-only, separately provisioned, and attempted-write-tested** (`36 §13`). Where a vendor offers no read-only scope (Google Ads), the audit credential is a **separate login with viewer-level account access** rather than API scope separation, and that residual is stated rather than engineered away.

**v1.3.7 — ROW 13'S EXEMPTION NOW HAS A SIGNED OPERAND (`S1N-C1`).** *"Read-only"* was a prose
property of an audit-plane vendor credential and named no artifact that declared it, so the
exemption rested on an assertion nothing verified. **`50 §2g` field 7,
`external_mutation_capable`, is that operand, and `50 §2g` field 6's `credential_risk_class`
must be `READ_ONLY` for a credential to earn this row's exemption.** Both are class-5 content:
signed, dual-signed, and manifest members.

**THE THREE OBLIGATIONS ARE NOW DISTINGUISHED RATHER THAN CONFLATED, because they have
different evidence.**

| Obligation | Evidence | Status at v1.3.7 |
|---|---|---|
| *separately provisioned* | the audit credential resolves from its own source, in its own runtime, and no control-plane or integration-send process can reach it | **mechanised** — the audit-plane provider-read runtime and its own secret source |
| *read-only* | `50 §2g` fields 6 and 7 over signed bytes | **mechanised** — and a declaration that disagrees with its own permission list is REFUSED at verification |
| *attempted-write-tested* | an attempted write with the audit credential **fails at the PROVIDER** (`36 §13`) | **NOT DISCHARGED BY ANY SIGNED DECLARATION.** It is an EMPIRICAL obligation and it stays open until a configured provider account refuses a real attempted write |

**A SIGNED `READ_ONLY` DECLARATION IS NOT THE ATTEMPTED-WRITE TEST AND MUST NOT BE REPORTED AS
ONE.** The declaration says what the deployment believes it provisioned; `36 §13` asks the
vendor. A provider whose only credential able to read the required evidence is also able to
send **cannot earn this exemption by declaring `READ_ONLY`**, because the declaration would be
false and the vendor would prove it false. That is a **provider-selection** finding, and
`50 §2g`'s consistency check is deliberately unable to rescue it.

**v1.3.7 CORRECTION — AND A FOURTH OBLIGATION, WHICH THE FIRST THREE DO NOT IMPLY.**

The three obligations above all ask about a credential the reader is ASSUMED to be holding.
None of them asks **whether the reader is holding that credential**, and the answer is not
automatic: the record is selected by `credential_id` and the material is resolved from a
locator, and before this correction nothing compared the two.

| Obligation | Evidence | Status at v1.3.7 |
|---|---|---|
| *the resolved material IS the declared credential* | the reader compares the signed `credential_id` against the identity its own secret source returned, **before any provider query** | **mechanised** — `50 §2g`'s runtime-use requirement, enforced in the audit reader's own process |

**THE ATTACK THIS CLOSES PASSES EVERY OTHER CONTROL ON THIS ROW.** A genuinely
`audit_plane`-scoped, genuinely `READ_ONLY` signed record; a locator genuinely disjoint from
the integration plane's; a reader genuinely in its own process — and a **send-capable token**
at the end of the locator. This exemption would then rest on a declaration about a credential
the reader is not using, and the plane whose job is to catch the control plane lying would be
the one holding an unclassified write capability.

**LOCATOR SEPARATION DOES NOT IMPLY IT.** The *separately provisioned* obligation above is
enforced on locators, and a locator says where to look rather than what was found: two
locators may resolve one credential, and one locator may be repointed at another. **Both
controls are required and both are kept.**

**AND NONE OF THE FOUR CLOSES CREDENTIAL SCOPE DRIFT.** Identity binding proves *"this is
credential A"*; it does not prove *"credential A still has the provider permissions the signed
record declares"*. A scoped provider API key is mutable at the provider, and its permissions
can be widened after the class-5 record was signed with no ACOS-observable event. **Scope
conformance is an EMPIRICAL provider-side obligation**, and for a selected email provider the
minimum probe set is: the send key succeeds at its permitted send; the audit key succeeds at
the activity read; **the audit key's send attempt is refused BY THE PROVIDER**; and any
architecture-required prohibited operation stays provider-refused. **v1.3.7 does not discharge
any of them.**

### 3.7 External anchoring writer (row 14)

**What it does.** Writes `{head_hash, chain_seq, row_count}` hourly to a medium the database operator cannot rewrite, and delivers a copy to the owner.

**Why exempt.** Requiring an authorisation for the mechanism that makes authorisations verifiable is circular, and the anchor must be written even when effects are halted.

**Compensating controls.** Write-only, append-only, one destination from configuration. A **missing anchor is itself an incident** — this is the one exempt path whose *silence* is monitored rather than only its activity, because an attacker's first move against anchoring is to stop it.

---

## 4. Enforcement

Four mechanisms. The first two are the ones that matter.

1. **One vendor-HTTP client per adapter.** No ad-hoc HTTP construction anywhere in the codebase. A single audited client type per adapter, and the linter forbids raw HTTP libraries outside it.
2. **Every vendor-call site carries `authorisation_ref` or `PERIMETER_EXEMPT(reason, ticket)`.** **CI fails the build on an unannotated site** (I24). This is the mechanism that survives the enumeration being incomplete.
3. **A runtime assertion refuses an adapter invocation carrying neither.** Defence in depth against a call path CI did not see — a dynamically dispatched framework callback, for instance.
4. **No control-plane process holds a vendor credential** (I25), CI-checked on the dependency tree and the injected environment. This is what makes the plane boundary mean something: a control-plane component that acquires a vendor call site fails the build twice.

**v1.2: two additions to the annotation contract.**

5. **`KERNEL_SERVICE` call sites carry an `authorisation_ref`, not an exemption** (SR-S3). The standing-pause path dispatches through the gateway under a `StandingRevocationAuthority`, so it is an authorised effect with a journal row and an audit write, and `26 §7.1` enumerates exactly which policy steps it skips. **It must not be annotated `PERIMETER_EXEMPT`** — a kernel-originated vendor write with no authorisation reference is precisely the shape the perimeter exists to make impossible, and the fact that the kernel rather than a model originated it is not a justification.

6. **`enumerate_effects` reads are journaled, not exempt** (SR-C2). Enumeration issues vendor-adjacent reads to construct its option set. These are reads, so they do not cross the *write* perimeter, but they are journaled with `journal_row_kind = READ` under the same rate limiting as any other capability, because an unbounded read capability is a probing oracle even when it moves no money.

**Why network policy is not on this list.** `42 §1.3`: every unauthorised path in §2 runs from a process that legitimately requires egress **to the same vendor host, over the same port, with the same credential, to the same endpoint** as an authorised path. **Network policy separates planes. It cannot separate purposes within a plane.** It remains valuable for the plane boundaries and is not the perimeter control.

---

```

### C.13 The in-repo text establishing SendGrid `mail.send` as `NON_MONETARY_WRITE`

Two sources exist in-repo. **Neither is a signed artifact** — both are prose/tooling records,
and no class-5 record for a SendGrid credential exists in the deployed bytes (see C.5).

#### `docs/implementation/S1O-result.md` lines 300–320 (`§10 S1M resume readiness`)

```markdown
instead.

---

## 10. S1M resume readiness

| | |
|---|---|
| integration boundary (S1N) | **green**, unchanged |
| audit read boundary | **green**, synthetic credential, seven leak surfaces clear, sibling isolation proved with two live processes |
| selected provider | **Twilio SendGrid** |
| credential scopes normatively compatible | **yes** — `mail.send` is `NON_MONETARY_WRITE` under `50 §2g`, so one email adapter continues under option A; `email_activity.read` is `READ_ONLY` and earns `48 §3.6`'s exemption's *declaration* half |
| local architecture blocker | **none** |

**`READY_TO_PROVISION_TWILIO_SENDGRID_NONPRODUCTION_TEST_CREDENTIALS`**

**THE TOKEN CHANGED, AND NOT COSMETICALLY.** The candidate emitted
`READY_TO_PROVISION_SENDGRID_SANDBOX_CREDENTIALS`, which names the provider's sandbox mode —
the mode its own documentation says produces no Email Activity and no Event Webhook events.
The token described an environment in which `I36` can observe nothing.

```

#### `docs/architecture/v1.3.7/deliverables/50-control-artifact-manifest.md` lines 213–234 (`§2g` the closed classification — the maximum-privilege rule that governs a `mail.send` key)

```markdown
### The closed classification

`credential_risk_class` takes **exactly three values and no fourth**:

| Value | Meaning |
|---|---|
| `READ_ONLY` | every reachable provider permission is a read or a query; the credential performs no external mutation of any kind |
| `NON_MONETARY_WRITE` | at least one reachable permission mutates provider-side state, and **no** reachable permission satisfies any clause of the nine above |
| `MONEY_MOVING` | **at least one** reachable permission satisfies at least one clause of the nine above |

**There is no `UNKNOWN`, and a missing classification is not a permissive default.** A configured vendor credential whose `credential_risk_class` is absent, unparseable, or outside this closed set **FAILS CLOSED**: the configuration is refused and the process does not start.

**MAXIMUM PRIVILEGE DECIDES A MIXED ENVELOPE.** A credential carrying an email-send permission *and* a payment-refund permission is `MONEY_MOVING`. A credential carrying a read permission *and* a webhook-subscription permission is `NON_MONETARY_WRITE`. The class is the highest reachable, never the lowest, never the average and never the intended.

**Examples that are `NON_MONETARY_WRITE` when those are the credential's only mutating permissions**, stated so the boundary has two sides: transactional or marketing message send; webhook subscription management; non-monetary support communication; address edit; non-monetary fulfilment operation; any other external write with no provider-side monetary effect and no provider-side spend authority.

### What this classification is NOT

**It is not ACOS action authority, and the two must not be merged.** If an ACOS action class is monetary but the configured credential cannot execute it at the provider, that is a **provider capability / `I15` enforceability** question — `29 §14` replaced `I15` with exactly that empirical probe — and it does not make the credential `MONEY_MOVING`. Conversely a `MONEY_MOVING` credential does not grant ACOS any authority: `26`'s authority model is unchanged by this section and remains separately governed.

**It is not inferred from an action name, a method name, an adapter name or a credential label.** `credential_risk_class` is DECLARED, from the enumerated provider permissions, in signed bytes.

```

#### `tools/provider-selection/capabilityRecord.ts` lines 268–300 (the SendGrid send-credential scope record)

```typescript
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
```

**Status of this classification, stated plainly:** `mail.send` being `NON_MONETARY_WRITE` is a
*normative reading* recorded in S1O's result and supported by `50 §2g`'s maximum-privilege
rule. It is **not** a signed class-5 record, and the deployed class-5 artifact contains no
`twilio_sendgrid` credential at all. Section L treats the signing of it as work still owed.

---

## D. Existing action examples — derived directly from the deployed artifacts

Descriptive only. **No email value is proposed here.** Every cell is read out of
`artifacts/control/class-03.action-catalogue.json`, `class-05.credential-scopes.json`
and `class-19.effect-constructors.json` at the current tree state.

| action_class | adapter | method | recoverability | value_direction | irrecoverable_units | credentials bound to that adapter (class 5) | class-19 constructor |
|---|---|---|---|---|---|---|---|
| `campaign.pause` | `mock_ads` | `campaignPause` | REVERSIBLE | NONE | 0 | `mock_ads.budget_manage` — MONEY_MOVING<br>`mock_ads.pause_only` — NON_MONETARY_WRITE<br>`synthetic_esp.mixed_send` — MONEY_MOVING | **none** |
| `refund.create` | `mock_processor` | `refundCreate` | COMPENSABLE | INBOUND_ORIGINAL_INSTRUMENT | 0 | `mock_processor.refund` — MONEY_MOVING | `acos.constructor.refund.create` v1.0 |
| `fulfilment.reship` | `mock_commerce` | `fulfilmentReship` | IRRECOVERABLE | OUTBOUND_GOODS_TO_ADDRESS | 1 | `mock_commerce.fulfilment` — NON_MONETARY_WRITE | **none** |
| `campaign.budget.set` | `mock_ads` | `campaignBudgetSet` | COMPENSABLE | OUTBOUND_TO_COUNTERPARTY | 0 | `mock_ads.budget_manage` — MONEY_MOVING<br>`mock_ads.pause_only` — NON_MONETARY_WRITE<br>`synthetic_esp.mixed_send` — MONEY_MOVING | **none** |

Other class-3 per-class fields, for completeness: `carries_vendor_monetary_field`,
`cost_component_free`, `rate_based`, `settlement_tolerance` — all present in C.1.

### D.1 Per-class maps the class-3 artifact carries, keyed by action class

Both must be exhaustive over the catalogue; a new action class must supply an entry in both.

| action_class | semantic_option_digest_fields | enumeration_max_age_seconds |
|---|---|---|
| `campaign.pause` | *(empty list)* | 120 |
| `refund.create` | `line_id`, `parent_transaction_id`, `amount`, `instrument`, `reason_code_scope` | 120 |
| `fulfilment.reship` | *(empty list)* | 120 |
| `campaign.budget.set` | *(empty list)* | 120 |

### D.2 Class-5 credentials NOT bound to any catalogue adapter

| credential_id | adapter field | provider | risk class | external_mutation_capable |
|---|---|---|---|---|
| `synthetic_esp.audit_read` | `audit_plane` | `synthetic_esp` | READ_ONLY | False |

**Observations, factual:**

- the catalogue declares **4** action classes and **3** adapters: `mock_ads`, `mock_commerce`, `mock_processor`.
- **no action class routes to an email adapter, and `sendgrid_email` appears nowhere.**
- class 19 carries **1** constructor record; three of the four action classes have none.
- `audit_plane` is `50 §2g`'s reserved scope sentinel, not a catalogue adapter. `synthetic_esp.mixed_send` is declared against adapter `mock_ads`, which is why it appears in that adapter's credential list above.
- `twilio_sendgrid` appears as a provider in the class-5 artifact: **no**.


---

## E. S1J kill-point sources

The reviewer's stated concern is whether S1P *copied names while changing semantic positions*.
The four accepted sources are reproduced complete, then the new S1P file, so the two can be
read against each other without a second checkout.

### E.1 `DispatchHooks` — the canonical trigger positions

`src/kernel/gateway/effectGateway.ts` is 33,623 bytes. The `DispatchHooks` declaration is
lines 290–335 and every hook **call site** in the dispatch body is listed after it with its
line number, so the reviewer can confirm each named position is where S1P claims it is.

#### `src/kernel/gateway/effectGateway.ts` lines 290–335 (`DispatchHooks`)

```typescript
export interface DispatchHooks {
  /**
   * TEST-ONLY. KILL POINT 0 — inside Epoch B, after the dispatch lease is held and after
   * revalidation passed, before the claim transaction opens.
   *
   * The interleaving point `30 §5.1`'s "no ACOS-authorised entity mutation can intervene"
   * is proved at: a competitor session attempts a legitimate mutation requiring the same
   * entity lock while this hook blocks, and must not obtain it until Epoch B ends.
   */
  readonly afterRevalidation?: () => Promise<void>;
  /**
   * TEST-ONLY. Inside the claim transaction, after the row lock. KILL POINT 1 — "before
   * claim commits". Passed straight through to the ACCEPTED S1I claim service.
   */
  readonly afterClaimLock?: () => Promise<void>;
  /** TEST-ONLY. KILL POINT 2 — after claim COMMIT, before any adapter is invoked. */
  readonly afterClaimCommit?: () => Promise<void>;
  /**
   * TEST-ONLY. KILL POINT 4 — after the adapter returned, before the outcome transaction.
   *
   * It RECEIVES THE ATTESTATION for the invocation that just happened, because `§25`'s race
   * needs two outcome-processing transactions for ONE mock attempt and the attestation is
   * the only honest way to have one: it is minted by the invocation and cannot be
   * fabricated. Handing it to a hook keeps the second processing an equally real
   * processing of the same attempt rather than a second invocation.
   *
   * Production passes no hooks at all, and `no-real-transport-boundary.test.ts` asserts no
   * production caller supplies one.
   */
  readonly afterAdapterReturned?: (attempt: {
    readonly attestation: DispatchAttestation;
    readonly identity: DispatchIdentity;
  }) => Promise<void>;
  /** TEST-ONLY. Inside the outcome transaction, after the row lock, before any write. */
  readonly afterOutcomeLock?: () => Promise<void>;
  /** TEST-ONLY. Inside the outcome transaction, after the balance locks, before the movement. */
  readonly beforeLedgerMovement?: () => Promise<void>;
  /** TEST-ONLY. Inside the outcome transaction, after the movement, before the journal row. */
  readonly afterLedgerMovement?: () => Promise<void>;
  /** TEST-ONLY. Inside the outcome transaction, after the journal row, before the outcome row. */
  readonly afterJournalRow?: () => Promise<void>;
  /** TEST-ONLY. Inside the outcome transaction, after every write, before its COMMIT. */
  readonly beforeOutcomeCommit?: () => Promise<void>;
  /** TEST-ONLY. KILL POINT 5 — after the outcome transaction committed, lease still held. */
  readonly afterOutcomeCommit?: () => Promise<void>;
}
```

#### `src/kernel/gateway/effectGateway.ts` — every hook invocation, with line numbers

```text
467:      if (hooks?.afterRevalidation !== undefined) await hooks.afterRevalidation();
487:            hooks?.afterClaimLock === undefined ? undefined : { afterLock: hooks.afterClaimLock },
530:        if (hooks?.afterClaimCommit !== undefined) await hooks.afterClaimCommit();
585:        if (hooks?.afterAdapterReturned !== undefined) {
586:          await hooks.afterAdapterReturned({ attestation, identity: built.identity });
602:            ...(hooks?.afterOutcomeLock === undefined
604:              : { afterLock: hooks.afterOutcomeLock }),
605:            ...(hooks?.beforeLedgerMovement === undefined
607:              : { beforeLedgerMovement: hooks.beforeLedgerMovement }),
608:            ...(hooks?.afterLedgerMovement === undefined
610:              : { afterLedgerMovement: hooks.afterLedgerMovement }),
611:            ...(hooks?.afterJournalRow === undefined
613:              : { afterJournalRow: hooks.afterJournalRow }),
614:            ...(hooks?.beforeOutcomeCommit === undefined
616:              : { beforeReturn: hooks.beforeOutcomeCommit }),
629:        if (hooks?.afterOutcomeCommit !== undefined) await hooks.afterOutcomeCommit();
```

### E.2 The canonical mock kill matrix — complete

#### `tests/integration/gateway/mock-kill-matrix.test.ts` (424 lines, complete)

```typescript
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { COMPANY_ID } from '../../support/fixture.js';
import {
  S1I_NOW,
  authorisePause,
  createOutboxHarness,
  outboxRows,
  type AuthorisedEffect,
  type OutboxHarness,
} from '../../support/outboxFixture.js';
import {
  ADAPTER_ADS,
  dispatchEnv,
  dispatchEnvWith,
  outcomeJournalRows,
  rawOutcomeRows,
  testRegistry,
} from '../../support/gatewayFixture.js';
import { createMockAdapter, returnedOutcome } from '../../support/mockAdapter.js';
import type { MockAdapter } from '../../support/mockAdapter.js';
import { enqueueDispatch } from '../../../src/kernel/outbox/enqueue.js';
import { dispatchAuthorisedEffect } from '../../../src/kernel/gateway/effectGateway.js';
import { liveCapabilityCount } from '../../../src/kernel/gateway/dispatchCapability.js';

/**
 * `§22`, `§23` — THE SIX KILL POINTS, AGAINST THE DETERMINISTIC MOCK.
 *
 * =================================================================================
 * WHAT THIS SUITE IS, AND — MORE IMPORTANTLY — WHAT IT IS NOT
 *
 * `§22` names six conceptual dispatch kill points and requires the mock to expose an
 * independent call/accepted counter "so tests know how many times it was invoked", with one
 * production property to hold across all of them:
 *
 *     "No recovery path invokes the mock a second time for an already-claimed effect."
 *
 * AND THEN, IN CAPITALS:
 *
 *     "THIS MOCK MATRIX DOES NOT CLOSE THE REAL I36 VALIDATION GATE."
 *
 * `phase2-v1.3.4-errata.md` SEQ-01 and `37 §2` both put the closing leg elsewhere:
 * "`I36`'s declared verification — the six kill points of `44 §5.2` against a **real ESP
 * sandbox**, measured by the provider's own accepted count — and `I20`." The registry says
 * the same in its own two-leg split: "ENFORCEMENT: attack the state machine directly [...]
 * VERIFICATION: kill at each of the six points in `44 §5.2` against the **real ESP
 * sandbox** and assert exactly one accepted message. **An outbox row count is not a
 * provider accepted count.**"
 *
 * `35 §12.3` says why a mock cannot substitute: "**a mock with a naive idempotency
 * implementation passes while the vendor would not.**"
 *
 * So what follows is `I36`'s LOCAL COMPOSITION leg. `mock.acceptedCount` is this process's
 * count of times its own in-process function reached its own acceptance point. It is not a
 * provider's accepted count, there is no provider, and `I36`'s verification leg and `I20`
 * both stay OPEN.
 * =================================================================================
 */

let h: OutboxHarness;
const NOW = S1I_NOW;
const LATER = new Date(S1I_NOW.getTime() + 6 * 60 * 60 * 1000);

beforeAll(async () => {
  h = await createOutboxHarness();
});

afterAll(async () => {
  await h.close();
});

beforeEach(async () => {
  await h.reset();
});

async function enqueuedPause(tag: string): Promise<AuthorisedEffect> {
  const effect = await authorisePause(h, { resourceId: `CMP-${tag}` });
  const outcome = await enqueueDispatch(h.control, {
    companyId: COMPANY_ID,
    effectId: effect.effectId,
    outboxId: `outbox:${tag}`,
    payloadCanonicalBytes: effect.payloadCanonicalBytes,
    now: NOW,
  });
  expect(outcome.kind).toBe('ENQUEUED');
  return effect;
}

/** One row of the matrix, measured. */
interface KillRow {
  readonly point: string;
  readonly mockCalls: number;
  readonly mockAccepted: number;
  readonly outboxStatus: string;
  readonly outcomeRows: number;
  readonly outcomeJournalRows: number;
  readonly liveCapabilities: number;
  /** What the RECOVERY attempt did, and what the counter read afterwards. */
  readonly recovery: string;
  readonly mockCallsAfterRecovery: number;
}

async function measure(
  point: string,
  tag: string,
  mockOptions: { readonly afterAccepted?: () => Promise<void> },
  hooks: Parameters<typeof dispatchAuthorisedEffect>[2] extends undefined
    ? never
    : NonNullable<Parameters<typeof dispatchAuthorisedEffect>[2]>['hooks'],
  expectThrow: boolean,
): Promise<{ readonly row: KillRow; readonly mock: MockAdapter }> {
  const effect = await enqueuedPause(tag);
  const mock = createMockAdapter({
    adapterId: ADAPTER_ADS,
    resolutionCapabilities: ['IDEMPOTENCY_HEADER'],
    outcome: returnedOutcome(),
    ...(mockOptions.afterAccepted === undefined
      ? {}
      : { afterAccepted: mockOptions.afterAccepted }),
  });
  const registry = testRegistry(mock);

  const run = dispatchAuthorisedEffect(
    dispatchEnvWith(h, registry),
    
    {
      companyId: COMPANY_ID,
      idempotencyKey: effect.idempotencyKey,
      dispatchedBy: 'worker:kill',
      now: NOW,
    },
    hooks === undefined ? undefined : { hooks },
  );
  if (expectThrow) {
    await expect(run).rejects.toThrow();
  } else {
    await run;
  }

  const afterCrash = {
    mockCalls: mock.callCount,
    mockAccepted: mock.acceptedCount,
    outboxStatus: (await outboxRows(h.control))[0]!.status,
    outcomeRows: (await rawOutcomeRows(h.control)).length,
    outcomeJournalRows: (await outcomeJournalRows(h.control)).length,
    liveCapabilities: liveCapabilityCount(),
  };

  // KILL POINT 6 — "recovery/re-entry attempt". The SAME production entry point, called
  // again, with the SAME registry, after the notional restart.
  const recovery = await dispatchAuthorisedEffect(dispatchEnvWith(h, registry),  {
    companyId: COMPANY_ID,
    idempotencyKey: effect.idempotencyKey,
    dispatchedBy: 'worker:recovered',
    now: LATER,
  });

  return {
    row: {
      point,
      ...afterCrash,
      recovery:
        recovery.kind === 'CLAIM_REFUSED'
          ? `CLAIM_REFUSED:${recovery.reason}`
          : recovery.kind,
      mockCallsAfterRecovery: mock.callCount,
    },
    mock,
  };
}

describe('`§22` — THE SIX POINTS, ONE ROW EACH', () => {
  it('POINT 1 — before the claim commits: nothing claimed, nothing invoked', async () => {
    /*
     * The kill is INSIDE the ACCEPTED S1I claim transaction, at its `afterLock` hook, so
     * the claim's own `BEGIN` is rolled back. `25 §7`: the transition happens "in a
     * committed transaction"; an uncommitted one is not a transition.
     *
     * THIS IS THE ONLY POINT WHERE RECOVERY LEGITIMATELY DISPATCHES, and it is legitimate
     * precisely because nothing was claimed: the row is still `ENQUEUED`, so a later claim
     * is a FIRST claim and not a re-dispatch. `I36` is about `CLAIMED` rows.
     */
    const { row, mock } = await measure(
      'before claim COMMIT',
      'kill-1',
      {},
      { afterClaimLock: () => Promise.reject(new Error('SIGKILL inside the claim tx')) },
      true,
    );
    expect(row.mockCalls).toBe(0);
    expect(row.mockAccepted).toBe(0);
    expect(row.outboxStatus).toBe('ENQUEUED');
    expect(row.outcomeRows).toBe(0);
    expect(row.liveCapabilities).toBe(0);
    // Recovery: a FIRST claim, and it succeeds. One invocation total.
    expect(row.recovery).toBe('OUTCOME_RESOLVED');
    expect(row.mockCallsAfterRecovery).toBe(1);
    expect(mock.acceptedCount).toBe(1);
  });

  it('POINT 2 — after claim COMMIT, before invocation: CLAIMED, and never invoked', async () => {
    const { row } = await measure(
      'after claim COMMIT, before invocation',
      'kill-2',
      {},
      { afterClaimCommit: () => Promise.reject(new Error('SIGKILL after claim COMMIT')) },
      true,
    );
    expect(row.mockCalls).toBe(0);
    expect(row.outboxStatus).toBe('CLAIMED');
    expect(row.outcomeRows).toBe(0);
    expect(row.liveCapabilities).toBe(0);
    // `§5`'s whole point: the row is CLAIMED, the request never left, and NOTHING will send
    // it. `35 §12.3`'s cost is stated rather than engineered away: "A message that was
    // genuinely never sent is delayed until the delivery-event reconciliation resolves it
    // and a fresh authorisation is obtained. That is a real customer-experience cost and it
    // is the correct trade."
    expect(row.recovery).toBe('CLAIM_REFUSED:ALREADY_CLAIMED');
    expect(row.mockCallsAfterRecovery).toBe(0);
  });

  it('POINT 3 — after the mock ACCEPTED, before the outcome is known: one call, no outcome', async () => {
    /*
     * `§22` item 3: "after mock invocation/request acceptance point, before outcome known".
     * The mock increments `acceptedCount` and THEN throws, so this is the state a real
     * request-sent-but-response-lost crash produces — `35 §12.3`'s "The HTTP request
     * leaves; the process dies before the response is recorded."
     */
    const { row } = await measure(
      'after mock ACCEPTED, before outcome known',
      'kill-3',
      { afterAccepted: () => Promise.reject(new Error('SIGKILL after acceptance')) },
      undefined,
      true,
    );
    expect(row.mockCalls).toBe(1);
    expect(row.mockAccepted).toBe(1);
    expect(row.outboxStatus).toBe('CLAIMED');
    expect(row.outcomeRows).toBe(0);
    expect(row.outcomeJournalRows).toBe(0);
    expect(row.liveCapabilities).toBe(0);
    // THE PROPERTY `§22` NAMES: no recovery path invokes the mock a second time.
    expect(row.recovery).toBe('CLAIM_REFUSED:ALREADY_CLAIMED');
    expect(row.mockCallsAfterRecovery).toBe(1);
  });

  it('POINT 4 — after the mock RETURNED, before the local outcome commits', async () => {
    const { row } = await measure(
      'after mock RETURNED, before outcome COMMIT',
      'kill-4',
      {},
      {
        beforeOutcomeCommit: () =>
          Promise.reject(new Error('SIGKILL before the outcome COMMIT')),
      },
      true,
    );
    expect(row.mockCalls).toBe(1);
    expect(row.mockAccepted).toBe(1);
    expect(row.outboxStatus).toBe('CLAIMED');
    // BOTH WRITES ROLLED BACK TOGETHER. `§20`'s fourth prohibition.
    expect(row.outcomeRows).toBe(0);
    expect(row.outcomeJournalRows).toBe(0);
    expect(row.recovery).toBe('CLAIM_REFUSED:ALREADY_CLAIMED');
    expect(row.mockCallsAfterRecovery).toBe(1);
  });

  it('POINT 5 — after the local outcome COMMITTED: the outcome stands, and is final', async () => {
    const { row } = await measure(
      'after outcome COMMIT',
      'kill-5',
      {},
      { afterOutcomeCommit: () => Promise.reject(new Error('SIGKILL after outcome COMMIT')) },
      true,
    );
    expect(row.mockCalls).toBe(1);
    expect(row.outboxStatus).toBe('CLAIMED');
    // The outcome and its journal row both survive, because they committed before the kill.
    expect(row.outcomeRows).toBe(1);
    expect(row.outcomeJournalRows).toBe(1);
    expect(row.recovery).toBe('CLAIM_REFUSED:ALREADY_CLAIMED');
    expect(row.mockCallsAfterRecovery).toBe(1);
  });

  it('POINT 6 — re-entry, at every point: exactly one invocation, ever', async () => {
    /*
     * The matrix's own summary row, and the property `§22` states in one line: "No recovery
     * path invokes the mock a second time for an already-claimed effect."
     *
     * Points 2 through 5 all leave a `CLAIMED` row, and the re-entry at each of them is
     * refused by the same mechanism — `25 §7`'s state machine — so the invocation count is
     * whatever it was when the process died and never one more.
     */
    const points: {
      readonly tag: string;
      readonly hooks: NonNullable<Parameters<typeof dispatchAuthorisedEffect>[2]>['hooks'];
      readonly afterAccepted?: () => Promise<void>;
      readonly expectedCalls: number;
    }[] = [
      {
        tag: 're-2',
        hooks: { afterClaimCommit: () => Promise.reject(new Error('k')) },
        expectedCalls: 0,
      },
      {
        tag: 're-3',
        hooks: undefined,
        afterAccepted: () => Promise.reject(new Error('k')),
        expectedCalls: 1,
      },
      {
        tag: 're-4',
        hooks: { beforeOutcomeCommit: () => Promise.reject(new Error('k')) },
        expectedCalls: 1,
      },
      {
        tag: 're-5',
        hooks: { afterOutcomeCommit: () => Promise.reject(new Error('k')) },
        expectedCalls: 1,
      },
    ];

    for (const point of points) {
      const { row } = await measure(
        point.tag,
        point.tag,
        point.afterAccepted === undefined ? {} : { afterAccepted: point.afterAccepted },
        point.hooks,
        true,
      );
      expect(row.recovery, point.tag).toBe('CLAIM_REFUSED:ALREADY_CLAIMED');
      expect(row.mockCallsAfterRecovery, point.tag).toBe(point.expectedCalls);
      // And a THIRD attempt changes nothing either.
      const third = await dispatchAuthorisedEffect(
        dispatchEnv(h,
        
          createMockAdapter({
            adapterId: ADAPTER_ADS,
            resolutionCapabilities: ['IDEMPOTENCY_HEADER'],
            outcome: returnedOutcome(),
          }),
        ),
        {
          companyId: COMPANY_ID,
          idempotencyKey: `idem:campaign.pause:CMP-${point.tag}:missing`,
          dispatchedBy: 'worker:third',
          now: LATER,
        },
      );
      // A key that never existed refuses for the OTHER declared reason, which is what makes
      // the `ALREADY_CLAIMED` above a real discrimination rather than a blanket refusal.
      expect(third.kind, point.tag).toBe('CLAIM_REFUSED');
      if (third.kind === 'CLAIM_REFUSED') {
        expect(third.reason, point.tag).toBe('OUTBOX_ROW_NOT_FOUND');
      }
    }
  });
});

describe('`§22`, `§30` — WHAT THE MATRIX DOES NOT CLOSE', () => {
  it('THIS DOES NOT CLOSE REAL-PROVIDER `I36` VALIDATION, AND `I20` REMAINS OPEN', async () => {
    /*
     * Asserted as a test rather than written only in a document, because `§29` and `§30`
     * are about a claim the repository must not make:
     *
     *   `§29`: "Do not state: provider accepted exactly once; ESP idempotency proven;
     *          provider query semantics proven; external exactly-once proven; delivery
     *          webhook proven."
     *   `§30`: "Do not compare mock accepted count to MIE reserved units and call I20
     *          closed. I20 requires provider-reported accepted messages/effects evaluated
     *          by the audit plane's independent provider read. There is no provider in
     *          S1J. I20 remains OPEN."
     *
     * The three absences below are what make the claim unavailable rather than merely
     * unmade: there is no provider read, no ESP credential and no delivery-event surface for
     * `I20` or `I36`'s verification leg to run against.
     */
    const effect = await enqueuedPause('open');
    const mock = createMockAdapter({
      adapterId: ADAPTER_ADS,
      resolutionCapabilities: ['IDEMPOTENCY_HEADER'],
      outcome: returnedOutcome(),
    });
    await dispatchAuthorisedEffect(dispatchEnv(h, mock), {
      companyId: COMPANY_ID,
      idempotencyKey: effect.idempotencyKey,
      dispatchedBy: 'worker:open',
      now: NOW,
    });
    expect(mock.acceptedCount).toBe(1);

    // 1. THE AUDIT PLANE HOLDS NO PROVIDER READING. `I20` is an AUDIT-plane invariant
    //    reconciled "from its own ESP read credential" (`35 §12.3`), and there is no table
    //    in the audit store that could hold a provider-reported accepted count.
    const auditTables = await h.auditOwner.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`,
    );
    const names = auditTables.rows.map((r) => r.table_name);
    for (const forbidden of ['provider', 'vendor', 'esp', 'delivery', 'accepted']) {
      expect(
        names.filter((n) => n.includes(forbidden)),
        `audit table matching ${forbidden}`,
      ).toEqual([]);
    }

    // 2. THE CONTROL PLANE HOLDS NO PROVIDER-REPORTED COUNT EITHER, so nothing in the
    //    repository can even form `I20`'s left-hand side.
    const controlTables = await h.control.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`,
    );
    const controlNames = controlTables.rows.map((r) => r.table_name);
    expect(controlNames.filter((n) => n.includes('provider'))).toEqual([]);
    expect(controlNames.filter((n) => n.includes('delivery'))).toEqual([]);

    // 3. AND `reserved_irrecoverable` IS ZERO EVERYWHERE, so `I20`'s right-hand side does
    //    not exist either — which is `S1J-C1`'s finding from the other direction.
    const units = await h.control.query<{ n: string }>(
      `SELECT COALESCE(sum(reserved_irrecoverable), 0)::TEXT AS n FROM window_balance
        WHERE company_id = $1`,
      [COMPANY_ID],
    );
    expect(units.rows[0]!.n).toBe('0');
  });
});
```

### E.3 The adapter-side `afterAccepted` hook — kill point 3's canonical mechanism

Kill point 3 is the only one that is **not** a `DispatchHooks` member: it fires inside the
adapter, after the request was accepted and before the outcome is known. In the accepted mock
this is `afterAccepted`. The complete mock adapter follows.

#### `tests/support/mockAdapter.ts` (344 lines, complete)

```typescript
import type {
  AdapterOutcome,
  AdapterResolutionCapability,
  DispatchEnvelope,
  ExternalEffectAdapter,
  NotSentBasis,
} from '../../src/kernel/gateway/adapterPort.js';

/**
 * THE DETERMINISTIC IN-PROCESS MOCK ADAPTER. TEST-ONLY, AND NOT A PROVIDER.
 *
 * =================================================================================
 * WHY IT LIVES HERE AND NOT IN `src/`
 *
 * `§7` of the S1J mandate: "Do NOT implement a real adapter. The deterministic mock
 * implementation belongs under test/support or another explicitly non-production test
 * location."
 *
 * `37 §2` S1 independently puts the mock here: its closed catalogue has "exactly three
 * classes: one REVERSIBLE, one COMPENSABLE, one IRRECOVERABLE, **all against a mock
 * adapter** — plus one rate-based class against a mock". So a mock at this stage is
 * architecture, and a mock in `src/` would be a second production write path, which is
 * what `48 §1` says the perimeter exists to make impossible.
 *
 * `no-real-transport-boundary.test.ts` asserts that no file under `src/` imports this
 * module and that `src/` contains no `ExternalEffectAdapter` implementation.
 * =================================================================================
 *
 * =================================================================================
 * IT IS IN-PROCESS. NO SOCKET, NO LOCALHOST SERVER, NO PORT.
 *
 * `§7`: "The mock is in-process. No socket. No localhost fake HTTP server. This slice is
 * testing kernel semantics, not networking." So `dispatch` is a plain async function that
 * consults a programmed table and returns. There is no `fetch`, no `http`, no `net`, no
 * listener and no URL anywhere in this file.
 * =================================================================================
 *
 * =================================================================================
 * IT IMPORTS NO PRODUCTION POLICY — `§41`
 *
 * "Forbidden: [...] adapter mock importing production outcome classifier to decide what it
 *  returns."
 *
 * This file imports exactly ONE production module — `adapterPort.js` — and imports only
 * TYPES from it. It does not import `outcomePolicy.ts`, `outcomeTransaction.ts`,
 * `effectGateway.ts`, `adapterRegistry.ts`, `actionCatalogue.ts` or anything under
 * `src/kernel/outbox/`. What it returns is what the TEST programmed it to return, decided
 * by hand at the call site, and never derived from production's own answer.
 * =================================================================================
 *
 * =================================================================================
 * WHAT ITS COUNTERS PROVE, AND WHAT THEY DO NOT — `§29`, `§30`
 *
 * `callCount` and `acceptedCount` are the mock's own instrumentation, and they prove
 * ACOS-SIDE properties: that no recovery path invoked an adapter a second time for an
 * already-claimed effect, that a restart after a claim invoked nothing at all, that a
 * refused resolution invoked nothing.
 *
 * THEY ARE NOT A PROVIDER ACCEPTED COUNT. `I36`'s verification leg requires "the six kill
 * points of `44 §5.2` against a **real ESP sandbox**, measured by the provider's own
 * accepted count" (`37 §2`, SEQ-01), and `I20` requires "Σ provider-reported accepted
 * messages per window", reconciled by the audit plane from its own ESP read credential.
 * There is no provider here and no audit-plane vendor credential, so:
 *
 *   - `I36`'s real-provider validation stays OPEN;
 *   - `I20` stays OPEN;
 *   - no test in this repository may compare `acceptedCount` to a reserved unit count and
 *     call either closed.
 *
 * `35 §12.3` says it in one line: "the kill-point tests must run against a real ESP sandbox
 * (VAL-04) — **a mock with a naive idempotency implementation passes while the vendor would
 * not**."
 * =================================================================================
 */

/** One recorded observation of what actually crossed the port. */
export interface ObservedDispatch {
  readonly companyId: string;
  readonly outboxId: string;
  readonly claimId: string;
  readonly effectId: string;
  readonly authorisationId: string;
  readonly idempotencyKey: string;
  readonly actionClass: string;
  readonly resourceRef: string;
  readonly recoverability: string;
  readonly adapter: string;
  readonly method: string;
  readonly dispatchPayloadHash: string;
  /** Hex of the bytes the adapter actually received. `§10`'s persisted-payload assertion. */
  readonly payloadHex: string;
  /** `§11`. The tag as observed, never as minted here. */
  readonly correlationTag: string;
  /** `§12`. The requirement as it crossed the port. */
  readonly requiresUnmirroredTag: boolean;
  readonly overrideId: string | null;
}

export interface MockAdapterOptions {
  /** MUST be a catalogue adapter identity, or `createAdapterRegistry` refuses it (`§8`). */
  readonly adapterId: string;
  /**
   * `25 §7`'s EM6 primitives this mock ADVERTISES.
   *
   * `§13`: "The MOCK may advertise architecture-defined capabilities for testing. Do NOT
   * claim a real provider has that capability." An empty array is the required negative
   * control: an IRRECOVERABLE effect against an adapter advertising none must be refused
   * before invocation.
   */
  readonly resolutionCapabilities: readonly AdapterResolutionCapability[];
  /**
   * What to return. A value, or a function of the envelope — hand-authored at the call
   * site, never computed from production policy.
   */
  readonly outcome: AdapterOutcome | ((envelope: DispatchEnvelope) => AdapterOutcome);
  /** A shared ordering log. The mock pushes `MOCK_ADAPTER_INVOKED` into it (`§6`). */
  readonly events?: string[];
  /**
   * KILL POINT 3 — `§22` item 3: "after mock invocation/request acceptance point, before
   * outcome known".
   *
   * Called AFTER `acceptedCount` has been incremented and BEFORE the outcome is returned,
   * so a hook that throws reproduces exactly the crash the architecture cares about: the
   * request may have been accepted and the outcome never reached the kernel.
   */
  readonly afterAccepted?: () => Promise<void>;
  /**
   * `§32`'s ALIAS ATTACK. When true the mock tries to mutate everything it received.
   *
   * It writes into the payload buffer it was handed and attempts to assign to the
   * envelope's correlation tag, effect identity, recoverability, unmirrored requirement and
   * override. Every attempt is recorded in `mutationAttempts` and the envelope is read back
   * afterwards, so the test can assert that nothing the adapter did changed what a second
   * reader sees.
   */
  readonly attemptMutation?: boolean;
  /**
   * `25 §7.2`'s FIRST ADMISSIBLE BASIS, AS A REAL CONTROL-FLOW BRANCH — v1.3.5 (OBX-05).
   *
   * =================================================================================
   * WHY THIS IS A SEPARATE FLAG AND NOT JUST A PROGRAMMED OUTCOME
   *
   * `25 §7.2`: `NOT_SENT_CONFIRMED` "may be returned only by a trusted adapter, and only
   * where the adapter can positively establish **from its own control flow** or from typed
   * provider semantics that NO EXTERNAL WRITE CROSSED THE TRANSPORT BOUNDARY". The admissible
   * basis it names first is "a failure raised **before** the external request was opened or
   * sent".
   *
   * An adapter could be PROGRAMMED to return `NOT_SENT_CONFIRMED` through `outcome`, and that
   * would prove only that the kernel handles the literal. What `§17` of the continuation
   * mandate asks for is "a deterministic genuine pre-send failure producing this result" —
   * an adapter whose CONTROL FLOW never reached its own send point.
   *
   * SO THIS FLAG RETURNS EARLY, BEFORE `acceptedCount` IS INCREMENTED. The counter is the
   * observable that separates an honest confirmed-non-send from a false one:
   *
   *   genuine pre-send failure   callCount 1, acceptedCount 0  → NOT_SENT_CONFIRMED is TRUE
   *   escaped, then failed       callCount 1, acceptedCount 1  → NOT_SENT_CONFIRMED is a LIE
   *
   * `tests/negative-controls/unsafe-not-sent-mapping.ts` is the second row, and
   * `not-sent-vs-unknown.test.ts` asserts the discrimination as a comparison of the two
   * counters rather than as a claim about intent.
   * =================================================================================
   */
  readonly failBeforeSend?: NotSentBasis;
}

export interface MockAdapter extends ExternalEffectAdapter {
  /** How many times `dispatch` was entered. */
  readonly callCount: number;
  /**
   * How many times the mock reached its own acceptance point — i.e. past the point at
   * which a real request would have left. NOT a provider accepted count (`§29`).
   */
  readonly acceptedCount: number;
  readonly observed: readonly ObservedDispatch[];
  /** What `attemptMutation` tried, and whether the runtime let it. */
  readonly mutationAttempts: readonly { readonly field: string; readonly threw: boolean }[];
  reset(): void;
}

export function createMockAdapter(options: MockAdapterOptions): MockAdapter {
  let callCount = 0;
  let acceptedCount = 0;
  const observed: ObservedDispatch[] = [];
  const mutationAttempts: { field: string; threw: boolean }[] = [];

  const tryMutate = (field: string, mutate: () => void): void => {
    try {
      mutate();
      mutationAttempts.push({ field, threw: false });
    } catch {
      mutationAttempts.push({ field, threw: true });
    }
  };

  const adapter: MockAdapter = {
    adapterId: options.adapterId,
    resolutionCapabilities: Object.freeze([...options.resolutionCapabilities]),
    get callCount(): number {
      return callCount;
    },
    get acceptedCount(): number {
      return acceptedCount;
    },
    get observed(): readonly ObservedDispatch[] {
      return observed;
    },
    get mutationAttempts(): readonly { readonly field: string; readonly threw: boolean }[] {
      return mutationAttempts;
    },
    reset(): void {
      callCount = 0;
      acceptedCount = 0;
      observed.length = 0;
      mutationAttempts.length = 0;
    },
    async dispatch(envelope: DispatchEnvelope): Promise<AdapterOutcome> {
      callCount += 1;
      options.events?.push('MOCK_ADAPTER_INVOKED');

      // Record what actually crossed the port, BEFORE any mutation attempt, so the
      // observation is of what the gateway handed over.
      observed.push({
        companyId: envelope.companyId,
        outboxId: envelope.outboxId,
        claimId: envelope.claimId,
        effectId: envelope.effectId,
        authorisationId: envelope.authorisationId,
        idempotencyKey: envelope.idempotencyKey,
        actionClass: envelope.actionClass,
        resourceRef: envelope.resourceRef,
        recoverability: envelope.recoverability,
        adapter: envelope.adapter,
        method: envelope.method,
        dispatchPayloadHash: envelope.dispatchPayloadHash,
        payloadHex: envelope.payloadCanonicalBytes.toString('hex'),
        correlationTag: envelope.correlationTag,
        requiresUnmirroredTag: envelope.requiresUnmirroredTag,
        overrideId: envelope.overrideId,
      });

      if (options.attemptMutation === true) {
        // The buffer the adapter was handed. Writing into it must not change what the next
        // reader gets, because every read returns a fresh copy of a private snapshot.
        const handed = envelope.payloadCanonicalBytes;
        tryMutate('payloadCanonicalBytes[0]', () => {
          handed[0] = (handed[0]! ^ 0xff) & 0xff;
        });
        // The scalars. `Object.freeze` on the envelope makes each of these throw in a
        // module (strict mode is implicit in ESM), which is the property being asserted.
        const mutable = envelope as unknown as Record<string, unknown>;
        tryMutate('correlationTag', () => {
          mutable['correlationTag'] = 'tag:forged-by-adapter';
        });
        tryMutate('effectId', () => {
          mutable['effectId'] = 'effect:forged-by-adapter';
        });
        tryMutate('recoverability', () => {
          mutable['recoverability'] = 'REVERSIBLE';
        });
        tryMutate('requiresUnmirroredTag', () => {
          mutable['requiresUnmirroredTag'] = false;
        });
        tryMutate('overrideId', () => {
          mutable['overrideId'] = null;
        });
        tryMutate('dispatchPayloadHash', () => {
          mutable['dispatchPayloadHash'] = '0'.repeat(64);
        });
      }

      // ==============================================================================
      // THE PRE-SEND FAILURE BRANCH — `25 §7.2`, AND IT RETURNS BEFORE THE ACCEPTANCE POINT.
      //
      // "a failure raised **before** the external request was opened or sent". The adapter
      // establishes the basis from ITS OWN CONTROL FLOW: it has not reached the line below,
      // so no request can have left, and `acceptedCount` stays where it was.
      //
      // This is the ONLY honest source of `NOT_SENT_CONFIRMED` in this file. There is no path
      // that reaches the acceptance point and then returns it, because that is the lie
      // `25 §7.2` exists to make unrepresentable and
      // `tests/negative-controls/unsafe-not-sent-mapping.ts` is where it lives instead.
      // ==============================================================================
      if (options.failBeforeSend !== undefined) {
        options.events?.push('MOCK_ADAPTER_FAILED_BEFORE_SEND');
        return { kind: 'NOT_SENT_CONFIRMED', basis: options.failBeforeSend };
      }

      // THE ACCEPTANCE POINT. Past here, a real request would have left the process.
      acceptedCount += 1;
      options.events?.push('MOCK_ADAPTER_ACCEPTED');

      if (options.afterAccepted !== undefined) await options.afterAccepted();

      const outcome =
        typeof options.outcome === 'function' ? options.outcome(envelope) : options.outcome;
      options.events?.push('MOCK_ADAPTER_RETURNED');
      return outcome;
    },
  };
  return adapter;
}

/** `25 §5`'s "adapter returned", with two inert opaque references. */
export function returnedOutcome(providerReference: string | null = 'mock:ref-1'): AdapterOutcome {
  return {
    kind: 'ADAPTER_RETURNED',
    providerReference,
    // A hand-authored 64-hex digest. Inert: nothing reads it as authority.
    rawResponseHash: 'a'.repeat(64),
  };
}

/** `25 §5`'s "timeout / ambiguous", and `35 §4`'s unknown. */
export function unknownOutcome(reason: 'TIMEOUT' | 'AMBIGUOUS' = 'TIMEOUT'): AdapterOutcome {
  return { kind: 'OUTCOME_UNKNOWN', reason };
}

/**
 * `25 §7.1`'s `ADAPTER_FAILED`. Retained for diagnostics; it reaches no local state.
 *
 * v1.3.5 CORRECTED WHAT THIS MEANS. v1.3.4 declared a RESPONSE for it — "bounded retry with
 * jitter against the same idempotency key" — and no state, and the response contradicted
 * OBX-01. `25 §7.1` scopes the retry to pre-claim workflow failures and declares that this
 * kind "carries no local outcome policy and reaches no local state".
 */
export function failedOutcome(failureClass = 'MOCK_REJECTED'): AdapterOutcome {
  return { kind: 'ADAPTER_FAILED', failureClass };
}

/**
 * `25 §7.2`'s `NOT_SENT_CONFIRMED`, as a programmed value.
 *
 * USE `failBeforeSend` INSTEAD WHERE THE POINT IS THE PROOF. This helper is for the cases
 * where the subject is the KERNEL's handling of the literal — the C4 matrix, the release, the
 * terminal state — and the adapter's own basis is not what is under test. Where the subject
 * IS the basis, `failBeforeSend` returns before the acceptance point and the counter shows it.
 */
export function notSentOutcome(
  basis: NotSentBasis = 'PRE_SEND_FAILURE',
): AdapterOutcome {
  return { kind: 'NOT_SENT_CONFIRMED', basis };
}
```

### E.4 The new S1P kill-point map — complete

This is the file the reviewer must read against E.1–E.3. Also in `S1P-review.diff` PART 2.

#### `validation/sendgrid/harness/killPoints.ts` (196 lines, complete)

```typescript
/**
 * `§9` — THE SIX KILL POINTS. THE EXISTING ONES, BY THEIR EXISTING NAMES.
 *
 * =================================================================================
 * THESE ARE NOT NEW POINTS AND THEY ARE NOT RENAMED
 *
 * `§9` of the S1P mandate: "First locate their canonical definitions and expected outcomes.
 * Do not rename them unnecessarily. Do not alter their semantic positions merely to make the
 * test easier."
 *
 * The canonical definitions are `§22` of the S1J mandate as
 * `tests/integration/gateway/mock-kill-matrix.test.ts` implements them, and the canonical
 * trigger positions are the `DispatchHooks` members `src/kernel/gateway/effectGateway.ts`
 * declares. **EVERY NAME AND EVERY EXPECTATION BELOW IS COPIED FROM THOSE TWO FILES**, and
 * `tests/sendgrid/kill-point-map.test.ts` asserts the copy against them rather than against a
 * second hand-authored list — so a future change to a hook name or a matrix expectation fails
 * this map rather than silently diverging from it.
 *
 * =================================================================================
 * WHAT THE REAL-PROVIDER RUN ADDS TO THE MOCK MATRIX, AND WHAT IT DOES NOT
 *
 * The mock matrix already proves the LOCAL composition leg, and it says so in capitals:
 * "THIS MOCK MATRIX DOES NOT CLOSE THE REAL I36 VALIDATION GATE." What it cannot supply is
 * the ORACLE — `35 §12.3`: "a mock with a naive idempotency implementation passes while the
 * vendor would not", and the registry's own split: "**An outbox row count is not a provider
 * accepted count.**"
 *
 * So each row below carries a `providerAcceptedCount` expectation ALONGSIDE the local one,
 * and a live run is judged on both. The local half is already proved offline; the provider
 * half has never been measured, and this file does not pretend otherwise —
 * `KILL_POINT_ROWS` is a declaration of what a run would have to show, not a record that one
 * did.
 *
 * =================================================================================
 * POINT 3 IS THE ONE THAT NEEDED A MECHANISM, AND WHY IT IS NOT A HOOK
 *
 * Points 1, 2, 4 and 5 are `DispatchHooks` members: they fire in the CONTROL process, where
 * the harness drives the gateway, and a real provider changes nothing about them.
 *
 * Point 3 — "after mock invocation/request acceptance point, before outcome known" — is
 * INSIDE the adapter, in the INTEGRATION child, and the mock produces it with an
 * `afterAccepted` callback the real adapter has no equivalent of. `§13` of the S1N mandate
 * is why it cannot get one: the dispatch wire carries no control member, so the control
 * plane cannot ask an adapter to crash, and adding a member so it could would be the
 * control channel the whole perimeter exists to deny.
 *
 * The accepted answer is the one `tests/integration-plane/adapterA/` already uses: the
 * behaviour rides on the RUNTIME's own launch configuration, not on a message. So point 3 is
 * produced by launching the integration runtime with `killPointAdapter.js` as its adapter
 * module — a DIFFERENT specifier from `adapter.js`, inside the same runtime root, that wraps
 * the real adapter and exits after the real send returned. `adapter.ts` itself has no such
 * branch and no import of one.
 * =================================================================================
 */

/** The canonical `DispatchHooks` member each control-plane point fires at, or `null`. */
export type KillPointHook =
  | 'afterClaimLock'
  | 'afterClaimCommit'
  | 'beforeOutcomeCommit'
  | 'afterOutcomeCommit'
  | null;

export interface KillPointRow {
  /** The canonical ordinal from `§22` of the S1J mandate. */
  readonly point: 1 | 2 | 3 | 4 | 5 | 6;
  /** The canonical name, verbatim from `mock-kill-matrix.test.ts`. */
  readonly name: string;
  /** Where the kill is produced. A hook, the integration child, or the re-entry itself. */
  readonly trigger: KillPointHook | 'INTEGRATION_CHILD_EXIT_AFTER_SEND' | 'RE_ENTRY';
  /** The outbox row's committed status immediately after the kill. */
  readonly expectedOutboxStatus: 'ENQUEUED' | 'CLAIMED';
  /** Committed rows in `dispatch_outcome` after the kill. */
  readonly expectedOutcomeRows: 0 | 1;
  /**
   * The PROVIDER-side accepted-message count for this scenario's correlation, measured by
   * the independent audit read. `§10`'s oracle.
   */
  readonly expectedProviderAcceptedCount: 0 | 1;
  /** What the recovery attempt must do. `§22`'s one production property. */
  readonly expectedRecovery: 'OUTCOME_RESOLVED' | 'CLAIM_REFUSED:ALREADY_CLAIMED';
  /** The provider-side count AFTER recovery. Never one more than before it, except point 1. */
  readonly expectedProviderAcceptedCountAfterRecovery: 0 | 1;
  /** Why this row's provider expectation is what it is. */
  readonly rationale: string;
}

export const KILL_POINT_ROWS: readonly KillPointRow[] = Object.freeze([
  Object.freeze({
    point: 1 as const,
    name: 'before claim COMMIT',
    trigger: 'afterClaimLock' as const,
    expectedOutboxStatus: 'ENQUEUED' as const,
    expectedOutcomeRows: 0 as const,
    expectedProviderAcceptedCount: 0 as const,
    /*
     * THE ONLY POINT WHERE RECOVERY LEGITIMATELY DISPATCHES, and the mock matrix says why:
     * "it is legitimate precisely because nothing was claimed: the row is still `ENQUEUED`,
     * so a later claim is a FIRST claim and not a re-dispatch. `I36` is about `CLAIMED` rows."
     */
    expectedRecovery: 'OUTCOME_RESOLVED' as const,
    expectedProviderAcceptedCountAfterRecovery: 1 as const,
    rationale:
      'the claim transaction rolled back, so no request was ever built; the recovery is a ' +
      'FIRST claim and the single accepted message is its own, not a duplicate',
  }),
  Object.freeze({
    point: 2 as const,
    name: 'after claim COMMIT, before invocation',
    trigger: 'afterClaimCommit' as const,
    expectedOutboxStatus: 'CLAIMED' as const,
    expectedOutcomeRows: 0 as const,
    expectedProviderAcceptedCount: 0 as const,
    expectedRecovery: 'CLAIM_REFUSED:ALREADY_CLAIMED' as const,
    expectedProviderAcceptedCountAfterRecovery: 0 as const,
    rationale:
      "35 §12.3's cost, stated rather than engineered away: the row is CLAIMED, the request " +
      'never left, and NOTHING will send it. A genuinely unsent message is delayed until ' +
      'reconciliation resolves it and a fresh authorisation is obtained',
  }),
  Object.freeze({
    point: 3 as const,
    name: 'after mock ACCEPTED, before outcome known',
    trigger: 'INTEGRATION_CHILD_EXIT_AFTER_SEND' as const,
    expectedOutboxStatus: 'CLAIMED' as const,
    expectedOutcomeRows: 0 as const,
    expectedProviderAcceptedCount: 1 as const,
    expectedRecovery: 'CLAIM_REFUSED:ALREADY_CLAIMED' as const,
    expectedProviderAcceptedCountAfterRecovery: 1 as const,
    rationale:
      "35 §12.3's own case: the HTTP request leaves; the process dies before the response " +
      'is recorded. SendGrid accepted exactly one message and ACOS holds no outcome for ' +
      'it — the provider-side count is the ONLY evidence that distinguishes this from ' +
      'point 2, which is precisely why the mock matrix cannot close I36',
  }),
  Object.freeze({
    point: 4 as const,
    name: 'after mock RETURNED, before outcome COMMIT',
    trigger: 'beforeOutcomeCommit' as const,
    expectedOutboxStatus: 'CLAIMED' as const,
    expectedOutcomeRows: 0 as const,
    expectedProviderAcceptedCount: 1 as const,
    expectedRecovery: 'CLAIM_REFUSED:ALREADY_CLAIMED' as const,
    expectedProviderAcceptedCountAfterRecovery: 1 as const,
    rationale:
      "both local writes rolled back together (§20's fourth prohibition) while the provider " +
      'had already accepted; recovery must not produce a second accepted message',
  }),
  Object.freeze({
    point: 5 as const,
    name: 'after outcome COMMIT',
    trigger: 'afterOutcomeCommit' as const,
    expectedOutboxStatus: 'CLAIMED' as const,
    expectedOutcomeRows: 1 as const,
    expectedProviderAcceptedCount: 1 as const,
    expectedRecovery: 'CLAIM_REFUSED:ALREADY_CLAIMED' as const,
    expectedProviderAcceptedCountAfterRecovery: 1 as const,
    rationale:
      'the outcome and its journal row both survive because they committed before the kill; ' +
      "the local record and the provider's record agree, and I20's comparison is the one " +
      'this row would supply an operand for',
  }),
  Object.freeze({
    point: 6 as const,
    name: 're-entry, at every point',
    trigger: 'RE_ENTRY' as const,
    expectedOutboxStatus: 'CLAIMED' as const,
    expectedOutcomeRows: 0 as const,
    expectedProviderAcceptedCount: 1 as const,
    expectedRecovery: 'CLAIM_REFUSED:ALREADY_CLAIMED' as const,
    expectedProviderAcceptedCountAfterRecovery: 1 as const,
    rationale:
      "§22's one production property — 'No recovery path invokes the mock a second time for " +
      "an already-claimed effect' — read against the provider instead of against the mock. " +
      'Point 6 is measured at each of points 2 to 5, and the provider count after re-entry ' +
      'is whatever it was before it',
  }),
]);

/**
 * WHAT A LIVE RUN MAY CONCLUDE FROM THE ROWS ABOVE, AND WHAT IT MAY NOT.
 *
 * `§19`: "Do not claim exactly-once delivery. Do not claim distributed exactly-once."
 * `§22` of the S1J mandate is the same prohibition from the other side, and `35 §12.3` gives
 * the reason it survives a passing run: a single account, a single observation window and a
 * bounded number of scenarios establish a property of THESE runs, not a theorem.
 */
export const KILL_POINT_CONCLUSION_LIMITS: readonly string[] = Object.freeze([
  'a passing matrix shows that, for the scenarios run, no recovery path produced a second ' +
    'provider-accepted message for an already-CLAIMED effect',
  'it does NOT show exactly-once delivery, distributed exactly-once, provider idempotency, ' +
    'or that the provider would never accept a duplicate',
  'it does NOT close I17b: a local evidence hash anchors nothing outside this repository',
  'NOT_OBSERVED_WITHIN_BOUND on any row leaves that row UNRESOLVED rather than passing or ' +
    'failing it — provider latency and a message that never left read identically',
]);
```

### E.5 The assertions that bind the map to the accepted sources

`tests/sendgrid/evidence-and-kill-points.test.ts` compares the map to the two accepted files
rather than to a second hand-authored list. The three binding assertions are:

| Assertion | What it reads |
|---|---|
| "every canonical NAME appears verbatim in the ACCEPTED mock kill matrix" | `readFileSync` of `mock-kill-matrix.test.ts`, `toContain(row.name)` for points 1–5, plus the literal `re-entry, at every point` for point 6 |
| "every control-plane TRIGGER is a real `DispatchHooks` member" | `readFileSync` of `effectGateway.ts`, `toContain(\`readonly ${row.trigger}?:\`)` |
| "points 2 and 3 differ ONLY in the provider-side count" | field-by-field equality of `expectedOutboxStatus`, `expectedOutcomeRows`, `expectedRecovery`, then inequality of `expectedProviderAcceptedCount` |

**What those assertions do and do not establish, stated factually:**

- they establish the map's **names** exist verbatim in the accepted matrix, and its
  **control-plane trigger identifiers** exist as declared `DispatchHooks` members;
- they do **not** execute any scenario, and they do **not** verify that a live run would fire
  at those positions — no live run exists (see `§M`);
- the `expectedProviderAcceptedCount` column is **new to S1P** and has no accepted
  counterpart, because no provider-side count has ever been measured. It is a declaration of
  what a run would have to show, not a record that one did.

---

## F. Integration-plane attachment

The question the reviewer must be able to settle: **does `validation/` attach to the accepted
S1N integration plane, or create a parallel execution route?** The accepted sources come
first, the new S1P files second.

### F.1 Where S1N loads an adapter module, and how it confines it

#### `src/integration/runtime/main.ts` (complete)

```typescript
import { isAbsolute, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  ENV_ADAPTER_ID,
  ENV_ADAPTER_MODULE,
  ENV_EXPECTED_CREDENTIAL_ID,
  ENV_PROTOCOL_VERSION,
  ENV_RUNTIME_IDENTITY,
  ENV_RUNTIME_ROOT,
  ENV_SECRET_LOCATOR,
  ENV_SECRET_SOURCE_MODULE,
} from '../protocol/runtimeEnvironment.js';
import {
  INTEGRATION_PROTOCOL_VERSION,
  RUNTIME_READY_KIND,
  encodeIntegrationMessage,
  type RuntimeReady,
} from '../protocol/wire.js';
import {
  adapterIdOfRuntimeIdentity,
  integrationAdapterRuntimeIdentity,
} from '../protocol/runtimeIdentity.js';
import type { AdapterSecretSource } from './adapterSecretSource.js';
import { handleDispatchRequest, type IntegrationRuntimeConfiguration } from './integrationHost.js';
import { isIntegrationAdapterModule } from './integrationAdapter.js';
import { emitIntegrationLog } from './runtimeLog.js';

/**
 * THE INTEGRATION RUNTIME'S ENTRY POINT. THE PROCESS `I25` IS ABOUT.
 *
 * =================================================================================
 * `§5` — A REAL OS PROCESS, AND THE MECHANISM IS THE POINT
 *
 * "Do not satisfy I25 with: another module; class; worker object in same process; DI
 * container; Node `vm`; mere function boundary."
 *
 * This module is executed by `child_process.fork` in a process of its own. It has its own
 * PID, its own heap, its own module registry, its own environment and its own filesystem
 * view, and the only channel between it and the control plane is the private descriptor the
 * parent created — `§40`: no TCP port, no HTTP listener, no Unix socket, no listener of any
 * kind. `process.on('message')` below is the whole of its inbound surface, and a process
 * that is not this process's parent cannot reach it.
 *
 * `§39` — THAT IS ALSO THE AUTHENTICATION, AND v1.3.6 DECLARES NO OTHER.
 *
 * "If architecture has no explicit IPC authentication because same-host process spawning +
 * private pipe is the trust mechanism, document and test that boundary. Do not invent
 * network JWT infrastructure."
 *
 * v1.3.6 specifies no IPC authentication mechanism for the Z1→Z2 edge. `23 §7`'s zone
 * diagram draws it as `Z1 -->|authorised effects| Z2` and says nothing about how Z2 knows
 * the sender; `48` is about what reaches Z5. So the trust mechanism is the one the OS
 * provides: an anonymous pipe created by the parent at fork, inherited by exactly one child,
 * addressable by no name and reachable by no other process. There is no token to steal
 * because there is no token, and no endpoint to reach because there is no endpoint.
 * =================================================================================
 *
 * =================================================================================
 * `§38` — NO ARBITRARY COMMAND EXECUTION, FROM EITHER DIRECTION
 *
 * "The control runtime must not spawn `command = caller_input`. Use a closed adapter-runtime
 * registry mapping trusted adapter IDs to known executable/module identities. No shell
 * interpolation. Use process APIs with argument arrays."
 *
 * The control side of that is `adapterRuntimeRegistry.ts` and `integrationClient.ts`, which
 * `fork` a fixed module path with an argument ARRAY and never a shell. THIS side adds the
 * second half: the module specifiers arrive in the launch environment, and this module
 * refuses to load either one unless it RESOLVES INSIDE THIS RUNTIME'S OWN ROOT.
 *
 * `§11`: "For adapter A: only A's integration package/dependencies should be available
 * through its declared runtime composition. Adapter B must not be able to import A's
 * provider-specific module. [...] Do not solve by convention only." `assertInsideRuntimeRoot`
 * is that mechanism at load time; the static import-closure proof is
 * `tools/integration-packaging/`.
 * =================================================================================
 */

/** A startup failure. Written to `stderr` as a closed code and never as a stack. */
export const STARTUP_FAILURES = [
  'ENV_MISSING',
  'ENV_PROTOCOL_MISMATCH',
  'ENV_IDENTITY_MISMATCH',
  'MODULE_OUTSIDE_RUNTIME_ROOT',
  'ADAPTER_MODULE_INVALID',
  'SECRET_SOURCE_MODULE_INVALID',
  'ADAPTER_IDENTITY_MISMATCH',
] as const;

export type StartupFailure = (typeof STARTUP_FAILURES)[number];

export class IntegrationRuntimeStartupError extends Error {
  public readonly failure: StartupFailure;

  public constructor(failure: StartupFailure) {
    // THE MESSAGE IS THE CODE. `§23`: a startup error that printed the specifier it refused
    // would print a filesystem path, and a path is one of the five things a control plane
    // must not learn from an integration failure.
    super(failure);
    this.failure = failure;
    this.name = 'IntegrationRuntimeStartupError';
  }
}

function readEnv(key: string): string {
  const value = process.env[key];
  if (value === undefined || value.length === 0) {
    throw new IntegrationRuntimeStartupError('ENV_MISSING');
  }
  return value;
}

/**
 * `§11`, `§12` — THE MODULE CONFINEMENT CHECK.
 *
 * A specifier must resolve to an absolute path inside the runtime root. `relative` returning
 * a path that starts with `..` or that is absolute means the target is outside, which is the
 * standard containment test and is correct on both path separators.
 */
export function isInsideRuntimeRoot(runtimeRoot: string, specifier: string): boolean {
  if (!isAbsolute(specifier)) return false;
  const root = resolve(runtimeRoot);
  const target = resolve(specifier);
  if (target === root) return false;
  const rel = relative(root, target);
  return rel.length > 0 && !rel.startsWith('..') && !isAbsolute(rel);
}

/**
 * What a secret-source module must export: a FACTORY taking the locator, not an instance.
 *
 * A factory rather than a ready-made source because the locator is per runtime and the
 * source must be SCOPED to this runtime's adapter at construction — `adapterSecretSource.ts`
 * explains why a source with a selector signature is not a boundary. The factory receives
 * the adapter id and the locator, and what it returns must declare that same adapter id or
 * this process refuses to start.
 */
export interface SecretSourceModule {
  readonly createAdapterSecretSource: (input: {
    readonly adapterId: string;
    readonly locator: string;
  }) => AdapterSecretSource;
}

function isSecretSourceModule(value: unknown): value is SecretSourceModule {
  if (typeof value !== 'object' || value === null) return false;
  return typeof (value as { createAdapterSecretSource?: unknown }).createAdapterSecretSource === 'function';
}

/**
 * Compose this runtime from its launch environment. NO REQUEST HAS BEEN READ AT THIS POINT.
 *
 * Exported so the focused suite can compose a runtime in-process and assert the refusals
 * without forking — the fork is proved separately, by PID, and the two properties are
 * independent.
 */
export async function composeIntegrationRuntime(): Promise<{
  readonly configuration: IntegrationRuntimeConfiguration;
  readonly runtimeIdentity: string;
}> {
  if (readEnv(ENV_PROTOCOL_VERSION) !== INTEGRATION_PROTOCOL_VERSION) {
    throw new IntegrationRuntimeStartupError('ENV_PROTOCOL_MISMATCH');
  }
  const adapterId = readEnv(ENV_ADAPTER_ID);
  const runtimeIdentity = readEnv(ENV_RUNTIME_IDENTITY);
  if (adapterIdOfRuntimeIdentity(runtimeIdentity) !== adapterId) {
    throw new IntegrationRuntimeStartupError('ENV_IDENTITY_MISMATCH');
  }
  // Recomputed rather than trusted: the identity in the environment must be the identity
  // this repository's own producer would mint for this adapter id, and not merely one that
  // parses back to it.
  if (integrationAdapterRuntimeIdentity(adapterId) !== runtimeIdentity) {
    throw new IntegrationRuntimeStartupError('ENV_IDENTITY_MISMATCH');
  }

  const runtimeRoot = readEnv(ENV_RUNTIME_ROOT);
  const adapterModule = readEnv(ENV_ADAPTER_MODULE);
  const secretSourceModule = readEnv(ENV_SECRET_SOURCE_MODULE);
  const secretLocator = readEnv(ENV_SECRET_LOCATOR);
  /*
   * `50 §2g` FIELD 1's ECHO, READ HERE AND COMPARED IN THE HOST.
   *
   * `readEnv` refuses an absent or empty value, so a runtime launched WITHOUT an expected
   * credential identity does not start. That is the fail-closed direction and it is the one
   * that matters: the alternative — start, and skip the comparison when there is nothing to
   * compare against — is precisely the defect this correction closes, one level up.
   *
   * It is NOT compared here, because at this point nothing has been resolved. The comparison
   * needs the material's own identity, and the material is resolved per invocation.
   */
  const expectedCredentialId = readEnv(ENV_EXPECTED_CREDENTIAL_ID);

  for (const specifier of [adapterModule, secretSourceModule]) {
    if (!isInsideRuntimeRoot(runtimeRoot, specifier)) {
      throw new IntegrationRuntimeStartupError('MODULE_OUTSIDE_RUNTIME_ROOT');
    }
  }

  /*
   * THE ONLY DYNAMIC IMPORT IN `src/`, AND IT IS DELIBERATE.
   *
   * `§4` forbids a real provider and `§7` of the S1J mandate puts every adapter
   * implementation in "an explicitly non-production test location". Both hold: there is no
   * adapter under `src/` and nothing here names one. What this process loads is whatever its
   * TRUSTED LAUNCH CONFIGURATION declared, confined to its own runtime root — in S1N a
   * synthetic adapter under `tests/integration-plane/`, and in a later slice a real Z2
   * adapter package.
   *
   * A STATIC IMPORT COULD NOT DO THIS JOB. Each adapter runtime must load ITS OWN adapter
   * and no other; a static import list in this file would put every adapter's module into
   * every runtime's module graph, which is exactly the per-adapter dependency isolation
   * `29 §3.5` and `23 §7` require and would be the defect the confinement check exists to
   * prevent.
   */
  const loadedAdapter: unknown = await import(pathToFileURL(resolve(adapterModule)).href);
  if (!isIntegrationAdapterModule(loadedAdapter)) {
    throw new IntegrationRuntimeStartupError('ADAPTER_MODULE_INVALID');
  }
  const adapter = loadedAdapter.integrationAdapter;
  if (adapter.adapterId !== adapterId) {
    throw new IntegrationRuntimeStartupError('ADAPTER_IDENTITY_MISMATCH');
  }

  const loadedSource: unknown = await import(pathToFileURL(resolve(secretSourceModule)).href);
  if (!isSecretSourceModule(loadedSource)) {
    throw new IntegrationRuntimeStartupError('SECRET_SOURCE_MODULE_INVALID');
  }
  const secretSource = loadedSource.createAdapterSecretSource({
    adapterId,
    locator: secretLocator,
  });
  if (secretSource.declaredAdapterId !== adapterId) {
    throw new IntegrationRuntimeStartupError('ADAPTER_IDENTITY_MISMATCH');
  }

  return {
    configuration: Object.freeze({ adapterId, adapter, secretSource, expectedCredentialId }),
    runtimeIdentity,
  };
}

/**
 * The process's message loop. ONE inbound channel, ONE reply per request, NO queue of its own.
 *
 * `§42`'s bounds live on the CONTROL side, where the requests originate, because a bound
 * enforced only by the callee still lets the caller allocate the messages. What this side
 * guarantees is that it reads one message, answers it, and holds nothing: there is no
 * buffer, no retry, no pending map and — `§28` — no record of the last request, so a
 * restarted runtime has nothing to replay even if something asked it to.
 */
async function run(): Promise<void> {
  const { configuration, runtimeIdentity } = await composeIntegrationRuntime();

  emitIntegrationLog({
    event: 'RUNTIME_STARTED',
    runtimeIdentity,
    adapterId: configuration.adapterId,
    invocationId: null,
    authorisationRef: null,
    effectId: null,
    outboxId: null,
    correlationTag: null,
    resultClass: null,
  });

  process.on('message', (raw: unknown) => {
    void (async (): Promise<void> => {
      const reply = await handleDispatchRequest(configuration, raw);
      emitIntegrationLog({
        event: reply.kind === 'REQUEST_REFUSED' ? 'REQUEST_REFUSED' : 'INVOCATION_COMPLETED',
        runtimeIdentity,
        adapterId: configuration.adapterId,
        invocationId: reply.invocationId,
        // A REFUSED request has no authorisation to record: either it carried none, or the
        // one it carried was not bound to the effect, and recording an unbound reference
        // beside an effect identity is how a log becomes a false provenance trail.
        authorisationRef: null,
        effectId: null,
        outboxId: null,
        correlationTag: null,
        resultClass: reply.kind === 'REQUEST_REFUSED' ? reply.reason : reply.outcome.kind,
      });
      const encoded = encodeIntegrationMessage(reply);
      // A reply that does not encode within the bound is DROPPED rather than truncated. The
      // control side's deadline resolves it as `OUTCOME_UNKNOWN`, which is the honest answer:
      // the adapter ran and the kernel did not learn what happened.
      if (encoded !== null) process.send?.(encoded);
    })();
  });

  const ready: RuntimeReady = {
    protocolVersion: INTEGRATION_PROTOCOL_VERSION,
    kind: RUNTIME_READY_KIND,
    runtimeIdentity,
    adapterId: configuration.adapterId,
    pid: process.pid,
    /*
     * `§30`, `48 §4` item 4 — THE KEYS OF THIS PROCESS'S OWN ENVIRONMENT. KEYS ONLY.
     *
     * `Object.keys`, never `process.env` itself: a value has no route onto this message,
     * because the member's type is `readonly string[]` and the control-side decoder refuses
     * any element that is not a bare environment-variable identifier. `§43`'s prohibition is
     * on the "raw environment", which is the values.
     *
     * It is the CHILD that reports this rather than the parent asserting what it passed,
     * because what the parent passed is the thing under test and is therefore not evidence
     * about itself.
     */
    environmentKeys: Object.keys(process.env).sort(),
  };
  const encodedReady = encodeIntegrationMessage(ready);
  if (encodedReady !== null) process.send?.(encodedReady);
}

/*
 * =================================================================================
 * THE MODULE IS BOTH A LIBRARY AND AN EXECUTABLE, AND THE DISCRIMINATOR IS THE LAUNCH
 * CONTRACT RATHER THAN `process.send`.
 *
 * `process.send` is defined in ANY forked child — including a Vitest worker — so gating on
 * it alone would start an integration runtime inside the test runner the moment a test
 * imported this module for one of its exported functions, and that runtime would then fail
 * its own environment check and call `process.exit`. The focused suite found exactly that.
 *
 * So the gate is the LAUNCH CONTRACT: this process runs as an integration runtime only when
 * `integrationClient.ts` constructed its environment, which means
 * `ACOS_INTEGRATION_RUNTIME_IDENTITY` is set AND an IPC channel exists. Nothing else can
 * produce that pair, and a Vitest worker produces neither half.
 * =================================================================================
 */
if (process.send !== undefined && process.env[ENV_RUNTIME_IDENTITY] !== undefined) {
  void run().catch((error: unknown) => {
    const failure =
      error instanceof IntegrationRuntimeStartupError ? error.failure : 'ADAPTER_MODULE_INVALID';
    process.stderr.write(`${JSON.stringify({ event: 'RUNTIME_START_FAILED', failure })}\n`);
    process.exit(1);
  });
}
```

### F.2 All guards before adapter invocation

Guard 8 — `adapter.invoke(...)` — is the only call site of `invoke` in this file, and every
guard above it is an early return.

#### `src/integration/runtime/integrationHost.ts` (complete)

```typescript
import { createHash } from 'node:crypto';

import {
  DISPATCH_RESPONSE_KIND,
  REQUEST_REFUSED_KIND,
  computeRequestBindingDigest,
  decodeDispatchRequest,
  type DispatchRequest,
  type DispatchResponse,
  type RefusalReason,
  type RequestRefused,
  type WireOutcome,
} from '../protocol/wire.js';
import { INTEGRATION_PROTOCOL_VERSION } from '../protocol/wire.js';
import type { AdapterSecretSource } from './adapterSecretSource.js';
import {
  adapterCredentialIdentityMismatch,
  credentialLabelsAreNonDerived,
} from './adapterSecretSource.js';
import type { AdapterInvocation, IntegrationAdapter, ProviderBoundary } from './integrationAdapter.js';

/**
 * THE INTEGRATION RUNTIME'S REQUEST HANDLER. Z2's SIDE OF THE PERIMETER.
 *
 * =================================================================================
 * WHAT RUNS HERE AND WHY IT IS A DIFFERENT PROCESS
 *
 * `I25`, verbatim from the invariant registry: "**No process in the control plane holds a
 * vendor credential.**" `48 §4` item 4 gives the enforcement: "CI-checked on the dependency
 * tree and the injected environment. This is what makes the plane boundary mean something:
 * a control-plane component that acquires a vendor call site fails the build twice."
 *
 * Before S1N the repository had no process this sentence could be true OF. `effectGateway.ts`
 * invoked `adapter.dispatch()` in its own process, so a real adapter's credential would have
 * been resolved in control-plane memory and `I25` would have been violated by the shape of
 * the composition rather than by anyone's mistake. S1M returned PARTIAL for exactly that
 * reason and this module is the answer to it.
 *
 * SO THE CREDENTIAL IS RESOLVED HERE, in a process the control plane spawned and cannot read
 * back from, from a source the control plane does not import and cannot construct.
 * =================================================================================
 *
 * =================================================================================
 * THE GUARD ORDER IS THE SECURITY PROPERTY — `§15`, `§16`, `§24`
 *
 * Every refusal below happens STRICTLY BEFORE the adapter is reached, and the order is:
 *
 *     1. decode                       closed schema (`§14`)
 *     2. adapter identity             this runtime serves exactly one (`§7`)
 *     3. authorisation_ref present    `I24`, at the runtime (`48 §4` item 3)
 *     4. authorisation binding        `§16` — bound to THIS effect, not merely non-null
 *     5. payload hash                 the bytes are the bytes the authorisation committed
 *     6. credential resolution        revoked or unavailable refuses here (`§24`)
 *     7. credential IDENTITY binding  the resolved material IS the declared credential
 *     8. adapter invocation           the FIRST line that runs adapter code
 *
 * `§15`: "Integration runtime validates presence before reaching adapter code. [...] No
 * adapter public method exists that can execute without it." Step 8 is the only call site of
 * `invoke` in this file and it is unreachable until 1..7 have all passed, because each is an
 * early return rather than a flag. The negative-control suite's permissive host
 * removes steps 3 and 4 and reaches the adapter, and
 * `unsafeHandleWithoutCredentialIdentityBinding` removes step 7 — which is the
 * discrimination for the v1.3.7 correction.
 * =================================================================================
 */

/** The result of handling one request: exactly one reply message, and nothing else. */
export type HostReply = DispatchResponse | RequestRefused;

function refuse(invocationId: string | null, reason: RefusalReason): RequestRefused {
  return Object.freeze({
    protocolVersion: INTEGRATION_PROTOCOL_VERSION,
    kind: REQUEST_REFUSED_KIND,
    invocationId,
    reason,
  });
}

/**
 * The runtime's own configuration. Built once, at process start, from the child environment.
 *
 * There is no member a REQUEST can influence, which is `§13`'s and `§37`'s shape: the
 * message carries work, and the launch carries capability.
 */
export interface IntegrationRuntimeConfiguration {
  /** The ONE adapter identity this runtime serves. `23 §7`: isolation is per adapter. */
  readonly adapterId: string;
  readonly adapter: IntegrationAdapter;
  readonly secretSource: AdapterSecretSource;
  /**
   * `50 §2g` FIELD 1, AS THE PARENT READ IT OUT OF THE VERIFIED CLASS-5 RECORD.
   *
   * Carried into this process so guard 7 can compare it to what the secret source actually
   * resolved, and NOT trusted as the authority: the authority is the signed record, the
   * parent checked it before forking, and this value is an echo only the parent produces.
   *
   * **THE PARENT CANNOT PERFORM THIS COMPARISON.** `I25` forbids the control plane holding a
   * vendor credential, so the only process that can see the resolved material's identity is
   * this one. That is why the echo exists at all: it moves one non-secret string across the
   * boundary so the comparison can happen on the side that has the other operand.
   */
  readonly expectedCredentialId: string;
}

/**
 * `§24` — PER-CREDENTIAL REVOCATION, AND IT IS THE SOURCE'S ANSWER RATHER THAN A FLAG HERE.
 *
 * ADR-024 requires "a per-credential revocation switch that **REVOKES** rather than stopping
 * the loop", and `07 §10.6` is the underlying rule: "A kill switch that revokes credentials,
 * not merely one that stops the loop."
 *
 * The distinction is which component the switch lives in. A boolean in this module would be
 * a loop-stopper: the credential would still be resolvable and a bug that skipped the check
 * would still reach a vendor. So the switch is a state of the SECRET SOURCE — `REVOKED` is a
 * member of `SecretResolution`, beside `RESOLVED` and `UNAVAILABLE` — and a revoked source
 * returns NO MATERIAL AT ALL. There is nothing to leak past a missed check because there is
 * nothing in hand.
 *
 * IT IS NOT MODEL-CONTROLLED AND NOT CONTROL-PLANE-CONTROLLED. `DispatchRequest` has no
 * member that could express an override and the decoder refuses unknown fields, so the
 * control plane cannot ask; the owner/deployment operation that flips it acts on the
 * deployment boundary, in this runtime's own secret source, with no ACOS code path in
 * between.
 */
export async function handleDispatchRequest(
  configuration: IntegrationRuntimeConfiguration,
  raw: unknown,
): Promise<HostReply> {
  // ---------------------------------------------------------------------------------
  // GUARD 1 — THE CLOSED SCHEMA. `§14`.
  // ---------------------------------------------------------------------------------
  const decoded = decodeDispatchRequest(raw);
  if (decoded.kind === 'REFUSED') return refuse(null, decoded.reason);
  const request: DispatchRequest = decoded.message;

  // ---------------------------------------------------------------------------------
  // GUARD 2 — ADAPTER IDENTITY. `§7`: one credential scope, one adapter runtime.
  //
  // The runtime refuses work addressed to another adapter even though it could not serve it
  // anyway. The refusal is what makes the property observable: a request for adapter B
  // arriving at adapter A's runtime is a wiring or routing defect, and a silent success on
  // the wrong runtime is how a credential ends up presented for a class it does not serve.
  // ---------------------------------------------------------------------------------
  if (
    request.adapterId !== configuration.adapterId ||
    configuration.adapter.adapterId !== configuration.adapterId ||
    configuration.secretSource.declaredAdapterId !== configuration.adapterId
  ) {
    return refuse(request.invocationId, 'ADAPTER_IDENTITY_MISMATCH');
  }

  // ---------------------------------------------------------------------------------
  // GUARD 3 — `I24`, AT THE RUNTIME. `48 §4` item 3: "A runtime assertion refuses an adapter
  // invocation carrying neither [an `authorisation_ref` nor an annotated exemption]. Defence
  // in depth against a call path CI did not see."
  //
  // The decoder already refuses an empty or absent `authorisationRef`, so reaching this line
  // with a blank one is impossible; the check is here anyway, explicitly, because `I24` is
  // named as a RUNTIME invariant and an invariant enforced only as a side effect of a
  // decoder's string rules is an invariant that disappears the day the decoder is relaxed.
  // ---------------------------------------------------------------------------------
  if (request.authorisationRef.trim().length === 0) {
    return refuse(request.invocationId, 'AUTHORISATION_REF_MISSING');
  }

  // ---------------------------------------------------------------------------------
  // GUARD 4 — `§16`. THE REFERENCE IS BOUND TO THIS EFFECT, NOT MERELY PRESENT.
  // ---------------------------------------------------------------------------------
  const expected = computeRequestBindingDigest(request);
  if (expected !== request.bindingDigest) {
    return refuse(request.invocationId, 'AUTHORISATION_BINDING_MISMATCH');
  }

  // ---------------------------------------------------------------------------------
  // GUARD 5 — THE PAYLOAD IS THE AUTHORISED PAYLOAD.
  //
  // `24 §3` K4: "adapter invocation with that payload **verbatim**". `25 §14.1`: "the
  // persisted payload remains the exact authorised payload". The hash is the one the
  // authorising transaction committed, and `enqueue.ts` computes it as `sha256` of the
  // canonical bytes, so this recomputation is the SAME function over the SAME bytes on the
  // far side of a process boundary — which is the one check that makes "verbatim" mean
  // something after the payload has been encoded, transported and decoded.
  // ---------------------------------------------------------------------------------
  const payloadBytes = Buffer.from(request.dispatchPayloadBase64, 'base64');
  const payloadHash = createHash('sha256').update(payloadBytes).digest('hex');
  if (payloadHash !== request.dispatchPayloadHash) {
    return refuse(request.invocationId, 'PAYLOAD_HASH_MISMATCH');
  }

  // ---------------------------------------------------------------------------------
  // GUARD 6 — THE CREDENTIAL. RESOLVED HERE, FROM THIS RUNTIME'S OWN SOURCE, PER INVOCATION.
  //
  // Per invocation rather than once at start, which is `§25`'s rotation requirement. A
  // source that re-reads its deployment boundary serves a rotated credential on the next
  // call with no control-plane involvement and no restart of anything the control plane owns.
  // ---------------------------------------------------------------------------------
  let resolution;
  try {
    resolution = await configuration.secretSource.resolve();
  } catch {
    // `§23`: the thrown value is DISCARDED rather than inspected. A secret source's
    // exception is the single most likely place for a path, an environment dump or the
    // material itself to appear, and there is no `catch (error)` binding here to be tempted
    // by. The control plane learns the closed reason and nothing else.
    return refuse(request.invocationId, 'CREDENTIAL_UNAVAILABLE');
  }
  if (resolution.kind === 'CREDENTIAL_REVOKED') {
    return refuse(request.invocationId, 'CREDENTIAL_REVOKED');
  }
  if (resolution.kind === 'UNAVAILABLE') {
    return refuse(request.invocationId, 'CREDENTIAL_UNAVAILABLE');
  }
  const credential = resolution.credential;
  if (!credentialLabelsAreNonDerived(credential)) {
    // `§25`. A source publishing a fingerprint of its own secret is refused rather than
    // sanitised: sanitising would leave the source believing it had published something.
    return refuse(request.invocationId, 'CREDENTIAL_UNAVAILABLE');
  }

  // ---------------------------------------------------------------------------------
  // GUARD 7 — `50 §2g` FIELD 1. **THE RESOLVED CREDENTIAL IS THE DECLARED CREDENTIAL.**
  //
  // Until this guard existed the chain ran in two halves that never met:
  //
  //     signed class-5 record  ->  risk class  ->  this runtime was admitted
  //     secret locator         ->  material    ->  about to be presented at a provider
  //
  // A locator repointed at another credential produced a runtime presenting
  // `budget_manage` (MONEY_MOVING) under `pause_only`'s NON_MONETARY_WRITE declaration, and
  // every other check on this path passed: the descriptor was well formed, the adapter was
  // in the catalogue, the signed record existed and said NON_MONETARY_WRITE, the
  // authorisation was bound, the payload hashed. The declaration simply governed a
  // credential the runtime was not holding.
  //
  // **LOCATOR SEPARATION IS A DIFFERENT CONTROL AND DOES NOT IMPLY THIS ONE.** Two locators
  // may name one credential; one locator may be repointed at another. `23 §7`'s per-adapter
  // source isolation and this binding are kept as two checks because they answer two
  // different questions: which source was read, and what was found there.
  //
  // IT RUNS BEFORE THE ADAPTER, so no provider boundary is reachable on a mismatch.
  // ---------------------------------------------------------------------------------
  if (
    adapterCredentialIdentityMismatch(
      configuration.expectedCredentialId,
      credential.credentialIdentity,
    ) !== null
  ) {
    // The REASON is not returned to the control plane. `§23`: a refusal teaches a closed
    // code and nothing else, and a message naming both credential identities would put the
    // deployment's credential topology on the wire for any caller that provoked a mismatch.
    return refuse(request.invocationId, 'CREDENTIAL_IDENTITY_MISMATCH');
  }

  // ---------------------------------------------------------------------------------
  // GUARD 8 — THE INVOCATION. THE FIRST LINE OF ADAPTER CODE, AND THE ONLY CALL SITE.
  // ---------------------------------------------------------------------------------
  const invocation: AdapterInvocation = Object.freeze({
    adapterId: request.adapterId,
    method: request.method,
    actionClass: request.actionClass,
    recoverability: request.recoverability,
    authorisationRef: request.authorisationRef,
    companyId: request.companyId,
    effectId: request.effectId,
    outboxId: request.outboxId,
    claimId: request.claimId,
    idempotencyKey: request.idempotencyKey,
    correlationTag: request.correlationTag,
    resourceRef: request.resourceRef,
    requiresUnmirroredTag: request.requiresUnmirroredTag,
    overrideRef: request.overrideRef,
    dispatchPayloadHash: request.dispatchPayloadHash,
    dispatchPayloadBytes: payloadBytes,
    credential,
  });

  let crossed = false;
  const boundary: ProviderBoundary = Object.freeze({
    markProviderClientCrossed: (): void => {
      crossed = true;
    },
  });

  let outcome: WireOutcome;
  try {
    outcome = await configuration.adapter.invoke(invocation, boundary);
  } catch {
    /*
     * `25 §7.2` AT THE PROCESS BOUNDARY, AND THE EXCEPTION IS NOT READ.
     *
     * "Anything for which the request MAY have escaped is `OUTCOME_UNKNOWN`." The
     * discriminating fact is the boundary flag, recorded by the adapter BEFORE its provider
     * call, and not anything about the exception — which is discarded unbound for the same
     * reason the secret source's is.
     *
     * NOT `NOT_SENT_CONFIRMED` WHERE THE BOUNDARY WAS CROSSED, EVER. `25 §7.2`: the
     * confirmed-not-sent classification "may be returned only by a trusted adapter, and only
     * where the adapter can positively establish [...] that NO EXTERNAL WRITE CROSSED THE
     * TRANSPORT BOUNDARY", and a thrown exception establishes nothing.
     */
    outcome = crossed
      ? Object.freeze({ kind: 'OUTCOME_UNKNOWN', reason: 'AMBIGUOUS' })
      : Object.freeze({ kind: 'ADAPTER_FAILED', failureClass: 'ADAPTER_THREW_PRE_SEND' });
  }

  const response: DispatchResponse = Object.freeze({
    protocolVersion: INTEGRATION_PROTOCOL_VERSION,
    kind: DISPATCH_RESPONSE_KIND,
    invocationId: request.invocationId,
    adapterId: request.adapterId,
    outcome,
    credentialIdentity: credential.credentialIdentity,
    credentialVersion: credential.version,
  });
  return response;
}
```

### F.3 How the locator and the expected credential identity reach the child

The child's environment is CONSTRUCTED, not filtered. Eight keys. The locator names where to
look; no credential material travels in any environment or on any wire.

#### `src/integration/protocol/runtimeEnvironment.ts` (complete)

```typescript
import { INTEGRATION_PROTOCOL_VERSION } from './wire.js';
import { integrationAdapterRuntimeIdentity } from './runtimeIdentity.js';

/**
 * `§12`, `§30` — THE CHILD ENVIRONMENT, AS A CLOSED ALLOWLIST AND NOT A FILTER.
 *
 * =================================================================================
 * WHY AN ALLOWLIST AND NOT A DENYLIST, STATED ONCE
 *
 * `§30`: "When launching integration runtime, use an explicit allowlist. Test child-visible
 * environment exactly. **Do not merely blacklist likely secret names.**"
 *
 * `23 §7`'s zone rule is what this implements: "one adapter cannot read another's secret
 * from its own environment or filesystem". A denylist of likely secret names is a list of
 * the secrets somebody thought of, and the control plane's environment in any real
 * deployment holds the control database password, the audit-instance grant, the owner
 * signing material's locators and whatever else the platform injected. Every one of those
 * reaches a child that inherits, and the ONE that matters is the one nobody named.
 *
 * SO THE CHILD'S ENVIRONMENT IS CONSTRUCTED, NOT FILTERED. `buildIntegrationRuntimeEnvironment`
 * returns a fresh object whose keys are exactly `INTEGRATION_RUNTIME_ENV_KEYS`, and
 * `integrationClient.ts` passes it as `env` to `fork`, which REPLACES the environment rather
 * than extending it. There is no code path in this repository that copies a key out of
 * `process.env` into a child.
 * =================================================================================
 *
 * =================================================================================
 * WHAT THE PLATFORM ADDS ANYWAY, NAMED RATHER THAN IGNORED
 *
 * On Windows, libuv adds a small fixed set of OS variables to every spawned process
 * regardless of the `env` option, because a Win32 process without them cannot resolve its
 * own user profile or temporary directory. They are listed in
 * `PLATFORM_INJECTED_ENV_KEYS` so the boundary test can assert the child's observed
 * environment against `allowlist ∪ platform` EXACTLY rather than against a lower bound —
 * `§30`'s "test child-visible environment exactly" is only a real assertion if the expected
 * set is closed on both sides.
 *
 * None of them is a secret and none is ACOS-specific. The test that matters is the negative
 * one, and it is not about this list: a parent holding `ADAPTER_B_SECRET`, a control
 * database password and an audit database password must produce a child holding none of
 * them, and that is asserted by name.
 * =================================================================================
 */

/** The protocol version, restated into the child so a mismatched pair cannot start. */
export const ENV_PROTOCOL_VERSION = 'ACOS_INTEGRATION_PROTOCOL_VERSION';
/** `§6`'s closed runtime identity — `INTEGRATION_ADAPTER:<adapter_id>`. */
export const ENV_RUNTIME_IDENTITY = 'ACOS_INTEGRATION_RUNTIME_IDENTITY';
/** The ONE adapter identity this runtime serves. `26 §5`'s catalogue value. */
export const ENV_ADAPTER_ID = 'ACOS_INTEGRATION_ADAPTER_ID';
/**
 * `§11` — THE DEPENDENCY-TREE CONFINEMENT ROOT.
 *
 * `29 §3.5`: "**Per-adapter** runtime, filesystem and dependency isolation — not merely
 * per-plane (v1.1)". The runtime refuses to load an adapter module or a secret-source module
 * that does not resolve INSIDE this directory, so adapter B's runtime cannot load adapter
 * A's provider-specific module even when handed its specifier. The static counterpart —
 * that A's import closure and B's are disjoint — is the packaging manifest in
 * `tools/integration-packaging/`.
 */
export const ENV_RUNTIME_ROOT = 'ACOS_INTEGRATION_RUNTIME_ROOT';
/** The adapter module specifier. TRUSTED LAUNCH CONFIGURATION, never message content. */
export const ENV_ADAPTER_MODULE = 'ACOS_INTEGRATION_ADAPTER_MODULE';
/** The secret-source module specifier. Same provenance, same confinement. */
export const ENV_SECRET_SOURCE_MODULE = 'ACOS_INTEGRATION_SECRET_SOURCE_MODULE';
/**
 * `§30`'s "adapter-A secret-source locator if needed".
 *
 * A LOCATOR, NOT A SECRET. It names where this runtime's own secret source should look —
 * a secret-manager resource name in a real deployment, a fixture path in S1N — and the
 * control plane holds the locator, never the material it locates. `48 §6` is the
 * corresponding row: "Secret-manager IAM | Deployment only | Not held by any adapter".
 *
 * ONE LOCATOR PER RUNTIME. Adapter A's environment carries A's and nothing else, which is
 * `§30`'s required negative: "adapter A [...] does NOT see: adapter-B locator".
 */
export const ENV_SECRET_LOCATOR = 'ACOS_INTEGRATION_SECRET_LOCATOR';
/**
 * `50 §2g` FIELD 1 — THE SIGNED EXPECTED CREDENTIAL IDENTITY, AS A TRUSTED LAUNCH ECHO.
 *
 * =================================================================================
 * WHAT THIS IS, AND — MORE IMPORTANTLY — WHAT IT IS NOT
 *
 * **IT IS NOT AUTHORITY.** `50 §2g`: "no provider response, account response, adapter
 * self-description, **environment variable**, caller parameter or model output may supply,
 * override or widen any of the seven fields." The AUTHORITY is the signed class-5 record,
 * and the PARENT is the only component that reads it: `createAdapterRuntimeRegistry`
 * selects the record by `credentialId`, checks its adapter binding, its `audit_plane`
 * sentinel and its risk class, and refuses to construct a registry at all when any of those
 * fails. Only then does `integrationClient.ts` fork, and only the parent writes this value.
 *
 * **SO WHAT TRAVELS HERE IS AN ECHO OF A DECISION ALREADY MADE**, and the child's single use
 * for it is a comparison the parent CANNOT perform: the parent never sees resolved material,
 * because `I25` is the rule that it must not. The child resolves its own credential, asks
 * its source which credential that material is, and refuses when the two disagree.
 *
 *     parent   signed class-5 record  ->  risk decision  ->  echo of `credential_id`
 *     child    secret source          ->  resolved material  ->  its `credentialIdentity`
 *     child    echo == resolved identity, or CREDENTIAL_IDENTITY_MISMATCH before dispatch
 *
 * **IT CAN ONLY NARROW.** A tampered echo does not widen anything: the child compares an
 * echo to a resolution, and disagreement refuses in both directions. A deployment that wrote
 * the WRONG echo refuses; one that wrote the RIGHT echo for material it does not hold
 * refuses. There is no value of this variable that admits a credential the signed record
 * did not govern.
 *
 * **AND IT IS AN IDENTITY, NEVER MATERIAL.** `§30`'s prohibition is unchanged: no credential
 * material travels on IPC or in any environment. `credential_id` is non-secret by `50 §2g`'s
 * own definition of field 1, and `credentialLabelsAreNonDerived` refuses a source whose
 * identity is derivable from its secret, which is what stops the echo becoming an oracle.
 */
export const ENV_EXPECTED_CREDENTIAL_ID = 'ACOS_INTEGRATION_EXPECTED_CREDENTIAL_ID';

/** THE CLOSED ALLOWLIST. Eight keys. A child sees these and, from ACOS, nothing else. */
export const INTEGRATION_RUNTIME_ENV_KEYS = [
  ENV_PROTOCOL_VERSION,
  ENV_RUNTIME_IDENTITY,
  ENV_ADAPTER_ID,
  ENV_RUNTIME_ROOT,
  ENV_ADAPTER_MODULE,
  ENV_SECRET_SOURCE_MODULE,
  ENV_SECRET_LOCATOR,
  ENV_EXPECTED_CREDENTIAL_ID,
] as const;

export type IntegrationRuntimeEnvKey = (typeof INTEGRATION_RUNTIME_ENV_KEYS)[number];

/**
 * The OS variables the platform adds to any child regardless of the `env` option.
 *
 * Declared so the boundary assertion can be an EQUALITY rather than a containment. Empty on
 * POSIX, where `env` genuinely replaces the environment.
 */
export const PLATFORM_INJECTED_ENV_KEYS: readonly string[] =
  process.platform === 'win32'
    ? [
        'HOMEDRIVE',
        'HOMEPATH',
        'LOGONSERVER',
        'PATH',
        'SYSTEMDRIVE',
        'SYSTEMROOT',
        'TEMP',
        'TMP',
        'USERDOMAIN',
        'USERNAME',
        'USERPROFILE',
        'WINDIR',
      ]
    : [];

/** Everything a runtime needs to exist, and nothing a request could influence. */
export interface IntegrationRuntimeLaunchConfiguration {
  readonly adapterId: string;
  readonly runtimeRoot: string;
  readonly adapterModule: string;
  readonly secretSourceModule: string;
  readonly secretLocator: string;
  /**
   * `50 §2g` field 1, as the PARENT read it out of the verified class-5 record.
   *
   * A LOCATOR AND AN IDENTITY ARE DIFFERENT CONTROLS AND BOTH ARE CARRIED. The locator says
   * where to look; the identity says what must have been found. Two locators may name one
   * credential and one locator may be repointed at another, so locator separation does not
   * imply identity binding and identity binding does not imply source separation.
   */
  readonly expectedCredentialId: string;
}

/**
 * Build the child's complete environment. THE ONLY PRODUCER, AND IT READS NOTHING.
 *
 * Note what this function does not take and does not touch: it has no access to
 * `process.env`, no parameter that could carry one, and no branch that adds a key. A future
 * change that wanted to pass one more variable has to add it to
 * `INTEGRATION_RUNTIME_ENV_KEYS` first, which is the list the boundary test asserts against
 * by hand.
 */
export function buildIntegrationRuntimeEnvironment(
  configuration: IntegrationRuntimeLaunchConfiguration,
): Readonly<Record<IntegrationRuntimeEnvKey, string>> {
  return Object.freeze({
    [ENV_PROTOCOL_VERSION]: INTEGRATION_PROTOCOL_VERSION,
    [ENV_RUNTIME_IDENTITY]: integrationAdapterRuntimeIdentity(configuration.adapterId),
    [ENV_ADAPTER_ID]: configuration.adapterId,
    [ENV_RUNTIME_ROOT]: configuration.runtimeRoot,
    [ENV_ADAPTER_MODULE]: configuration.adapterModule,
    [ENV_SECRET_SOURCE_MODULE]: configuration.secretSourceModule,
    [ENV_SECRET_LOCATOR]: configuration.secretLocator,
    [ENV_EXPECTED_CREDENTIAL_ID]: configuration.expectedCredentialId,
  });
}
```

### F.4 Where class-5 authority is checked, and where a SendGrid runtime is REFUSED

`createAdapterRuntimeRegistry` is the only producer of an `AdapterRuntimeRegistry`. It
refuses `ADAPTER_NOT_IN_CATALOGUE` for `sendgrid_email` against the deployed class-3 bytes,
and `CREDENTIAL_NOT_DECLARED` for any SendGrid credential against the deployed class-5 bytes.
`emptyAdapterRuntimeRegistry()` at the end of the file is what production actually holds.

#### `src/integration/control/adapterRuntimeRegistry.ts` (complete)

```typescript
import {
  ACTION_CLASSES,
  INTERNAL_ONLY_ADAPTER,
  type ActionClass,
} from '../../kernel/canonicalisation/actionClasses.js';
import { actionCatalogueEntry } from '../../kernel/canonicalisation/actionCatalogue.js';
import {
  verifiedCredentialScopes,
  type VerifiedControlArtifactBundle,
  type VerifiedCredentialScope,
} from '../../kernel/controlArtifacts/bundle.js';
import {
  AUDIT_PLANE_CREDENTIAL_SCOPE,
  type CredentialRiskClass,
} from '../../kernel/controlArtifacts/credentialRisk.js';
import type { AdapterResolutionCapability } from '../../kernel/gateway/adapterPort.js';
import { isWellFormedAdapterId } from '../protocol/runtimeIdentity.js';

/**
 * THE CLOSED ADAPTER-RUNTIME REGISTRY — `§37`, `§38`, AND OPTION A's OWN GUARD RAIL.
 *
 * =================================================================================
 * WHAT A DESCRIPTOR IS, AND WHY NO REQUEST CAN CARRY ONE
 *
 * `§37` of the S1N mandate: "Adapter registration should be trusted startup/deployment
 * configuration plus signed catalogue binding. The model cannot register adapters. The
 * worker cannot supply: executable path; module path; credential locator; runtime flags."
 *
 * So a descriptor is built at process wiring time and validated against the VERIFIED
 * class-3 catalogue and the VERIFIED class-5 credential-scope declaration — `50 §3f`: "For
 * classes 3 and 27 the signed artifact bytes ARE the deployed authority source" — and there
 * is no function in this module, in `integrationClient.ts` or on the dispatch path that
 * takes a path, a specifier, a flag or a locator as a per-request argument.
 * =================================================================================
 */

/**
 * `50 §2g` — THE CREDENTIAL RISK CLASS, READ FROM SIGNED CLASS-5 BYTES.
 *
 * =================================================================================
 * WHAT CHANGED AT v1.3.7, AND WHY IT IS A CHANGE IN KIND
 *
 * S1N recorded `S1N-C1`: ADR-024's trigger is "the first **money-moving credential** or the
 * third adapter, whichever comes first", and **v1.3.6 did not define `money-moving
 * credential` as a mechanised predicate anywhere.** S1N derived it from `50 §2a` field 4,
 * `carries_vendor_monetary_field` — a statement about the vendor request the CURRENT ACTION
 * dispatches — and flagged the derivation for owner ruling.
 *
 * **THE OWNER RULED THAT DERIVATION WRONG IN KIND.** v1.3.7 `50 §2g`:
 *
 *   "MONEY-MOVING IS A PROPERTY OF THE CREDENTIAL'S CAPABILITY ENVELOPE AT THE PROVIDER. IT
 *    IS NOT A PROPERTY OF THE ACTION ACOS CURRENTLY INTENDS TO CALL."
 *
 * `29 §14` is why the distinction is load-bearing: "**vendor OAuth scopes are coarser than
 * ACOS action classes on every platform examined**". A credential provisioned so ACOS can
 * pause a campaign routinely carries the permission to RAISE ITS BUDGET, which is `§2g`
 * clause 9 — "increase a budget, spend cap, credit line, or analogous provider-side
 * authority that permits additional spend" — and no field of the ACTION catalogue says so.
 *
 * **THE DIFFERENCE IS OBSERVABLE ON THIS REPOSITORY'S OWN CATALOGUE.** `campaign.budget.set`
 * declares `carries_vendor_monetary_field: false`, so S1N's derivation called every
 * `mock_ads` credential `NON_MONETARY`. v1.3.7 asks instead what the credential can do at
 * the provider, and the deployed class-5 declaration carries TWO `mock_ads` credentials that
 * answer differently: `mock_ads.pause_only` is `NON_MONETARY_WRITE` and
 * `mock_ads.budget_manage` is `MONEY_MOVING`. **Same adapter, same action catalogue,
 * different answer** — which is the whole content of the ruling.
 *
 * =================================================================================
 * NOTHING IS DERIVED HERE. THE CLASS IS DECLARED, IN SIGNED BYTES, AND READ.
 *
 * `50 §2g`: "no provider response, account response, adapter self-description, environment
 * variable, caller parameter or model output may supply, override or widen any of the seven
 * fields." A descriptor therefore names a `credentialId` and NOT a risk class: there is no
 * member of `AdapterRuntimeDescriptor` a deployment could use to state one, so there is
 * nothing to cross-check and nothing to be overstated or understated.
 *
 * `S1N`'s `declaredCredentialClass` member and its `CREDENTIAL_CLASS_UNDERSTATED` refusal
 * are **REMOVED** for exactly that reason. A declaration that has to be cross-checked is a
 * declaration somebody can make; the class-5 record is one the owner signed.
 *
 * =================================================================================
 * AND `§9`'s CONVERSE IS HONOURED: A MONETARY ACTION DOES NOT MAKE A CREDENTIAL MONETARY
 *
 * `50 §2g`: "If an ACOS action class is monetary but the configured credential cannot
 * execute it at the provider, that is a **provider capability / `I15` enforceability**
 * question [...] and it does not make the credential `MONEY_MOVING`."
 *
 * `mock_ads.pause_only` is exactly that case: `mock_ads` serves `campaign.budget.set`, and a
 * credential scoped to pause alone cannot execute it. **This module does not refuse that
 * combination**, because refusing it would merge credential risk with ACOS action authority
 * — the merge `§2g` forbids. `29 §14`'s empirical `I15` probe is what catches an action
 * ACOS believes it can dispatch and the provider will not accept.
 * =================================================================================
 */

/**
 * ADR-024's own numbers, as constants so the trigger cannot be edited by accident.
 *
 * "the first money-moving credential or the **third adapter**, whichever comes first."
 * Three adapters is the trigger; two is the last permitted count under option A. `23 §11`
 * sizes the MVP integration plane at "4 adapters at MVP", and that is the point: the fourth
 * slice that wants an adapter is the slice that has to build option B.
 *
 * **UNCHANGED BY v1.3.7.** `50 §2g`: "The third-adapter half is unchanged from v1.3.6 and
 * needs no derivation."
 */
export const OPTION_A_MAX_ADAPTER_RUNTIMES = 2;

/** One adapter runtime, as trusted deployment configuration. */
export interface AdapterRuntimeDescriptor {
  /** MUST be an adapter identity the verified class-3 catalogue names. */
  readonly adapterId: string;
  /**
   * MUST be a credential identity the verified class-5 declaration names (`50 §2g`).
   *
   * An IDENTITY, never the material and never a risk class. The risk class is field 6 of
   * the signed record this identity selects, and a deployment that wanted to state one
   * itself has nowhere to put it.
   */
  readonly credentialId: string;
  /** `§11`'s confinement root. Both module specifiers must resolve inside it. */
  readonly runtimeRoot: string;
  /** The adapter module. Trusted configuration, never a caller's value. */
  readonly adapterModule: string;
  /** The secret-source module. Same provenance. */
  readonly secretSourceModule: string;
  /** `§30`'s per-adapter secret-source LOCATOR. Never the material it locates. */
  readonly secretLocator: string;
  /** `25 §7`'s EM6 criterion, declared per adapter exactly as `adapterPort.ts` requires. */
  readonly resolutionCapabilities: readonly AdapterResolutionCapability[];
}

/** The refusals this module produces. All are refusals to CONSTRUCT, at wiring time. */
export const RUNTIME_REGISTRY_REFUSALS = [
  'ADAPTER_NOT_IN_CATALOGUE',
  'ADAPTER_ID_MALFORMED',
  'DUPLICATE_ADAPTER_RUNTIME',
  'MODULE_OUTSIDE_RUNTIME_ROOT',
  /** ADR-024's third-adapter trigger. Option B is not built, so the third is refused. */
  'OPTION_B_TRIGGER_ADAPTER_COUNT',
  /** ADR-024's money-moving trigger, from `50 §2g` field 6. */
  'OPTION_B_TRIGGER_MONEY_MOVING_CREDENTIAL',
  /**
   * `50 §2g`: a configured credential with no verified class-5 record. **FAILS CLOSED.**
   *
   * The S1N refusal this replaces was `CREDENTIAL_CLASS_UNDERSTATED`, which presumed a
   * deployment-supplied class to understate. There is no such class any more, so the only
   * remaining failure mode is an ABSENT declaration — and `§2g` rules that absence fails
   * closed rather than defaulting to the safe-looking value.
   */
  'CREDENTIAL_NOT_DECLARED',
  /** The class-5 record binds this credential to a different adapter. */
  'CREDENTIAL_ADAPTER_MISMATCH',
  /**
   * `50 §2g` field 2's reserved sentinel: an AUDIT-PLANE read credential.
   *
   * Refused by NAME rather than left to `CREDENTIAL_ADAPTER_MISMATCH`, because the two are
   * different mistakes and only one of them is an attack: a mismatch is a mis-wiring
   * between two adapters, and this is an attempt to present the audit plane's read
   * credential — the one `48 §3.6` exempts from carrying an `authorisation_ref` BECAUSE it
   * only reads — at a dispatch boundary.
   */
  'CREDENTIAL_IS_AUDIT_PLANE_SCOPED',
] as const;

export type RuntimeRegistryRefusal = (typeof RUNTIME_REGISTRY_REFUSALS)[number];

export class AdapterRuntimeRegistryError extends Error {
  public readonly refusal: RuntimeRegistryRefusal;

  public constructor(refusal: RuntimeRegistryRefusal, detail: string) {
    super(`${refusal}: ${detail}`);
    this.refusal = refusal;
    this.name = 'AdapterRuntimeRegistryError';
  }
}

export interface AdapterRuntimeRegistry {
  readonly resolve: (adapterId: string) => AdapterRuntimeDescriptor | undefined;
  readonly registeredIds: readonly string[];
  /** The signed class-5 record each registered adapter was admitted against. Evidence. */
  readonly credentialScopeOf: (adapterId: string) => VerifiedCredentialScope | undefined;
}

/** Every class the verified catalogue routes to this adapter identity. */
export function classesServedBy(
  adapterId: string,
  bundle: VerifiedControlArtifactBundle,
): readonly ActionClass[] {
  return ACTION_CLASSES.filter(
    (actionClass) => actionCatalogueEntry(actionClass, bundle).adapter === adapterId,
  );
}

/**
 * `50 §2g` field 6, for one configured credential. **THE OPTION-B TRIGGER OPERAND.**
 *
 * A LOOKUP, NOT A DERIVATION, and that is the substance of the v1.3.7 change. S1N's
 * `derivedCredentialClass()` read the ACTION catalogue and computed an answer; this reads
 * the CREDENTIAL declaration and returns the one the owner signed.
 *
 * Returns `null` when the declaration carries no record for the credential. `§2g`: absent
 * FAILS CLOSED, and a `null` return is what makes the caller say so rather than defaulting.
 */
export function declaredCredentialRiskClass(
  credentialId: string,
  bundle: VerifiedControlArtifactBundle,
): CredentialRiskClass | null {
  const scope = verifiedCredentialScopes(bundle).credentials[credentialId];
  return scope === undefined ? null : scope.credentialRiskClass;
}

/** Every adapter identity the verified catalogue names, `INTERNAL_ONLY` excluded. */
function catalogueAdapterIdsFrom(bundle: VerifiedControlArtifactBundle): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const actionClass of ACTION_CLASSES) {
    const adapter = actionCatalogueEntry(actionClass, bundle).adapter;
    if (adapter !== INTERNAL_ONLY_ADAPTER) ids.add(adapter);
  }
  return ids;
}

function specifierIsInsideRoot(root: string, specifier: string): boolean {
  // Deliberately a STRING-PREFIX check on normalised separators rather than a filesystem
  // resolution: this runs in the control plane, and a control-plane function that resolved
  // an integration runtime's paths against the control plane's own working directory would
  // be answering a question about the wrong process. The authoritative containment check is
  // `main.ts`'s `isInsideRuntimeRoot`, which runs INSIDE the runtime being confined. This one
  // catches the wiring error early, in the process that can still refuse to start.
  const normalise = (value: string): string => value.replace(/\\/g, '/').replace(/\/+$/, '');
  const normalisedRoot = normalise(root);
  const normalisedSpecifier = normalise(specifier);
  return (
    normalisedSpecifier.startsWith(`${normalisedRoot}/`) && !normalisedSpecifier.includes('/../')
  );
}

/**
 * Build the registry. THE ONLY WAY TO PRODUCE AN `AdapterRuntimeRegistry`.
 *
 * =================================================================================
 * `§35` — THE OPTION-B TRIGGER CANNOT SILENTLY DISAPPEAR
 *
 * "Add a mechanism/assertion that this trigger cannot silently disappear. If a third adapter
 * is registered under option A: refuse startup/configuration. Likewise a money-moving
 * credential class."
 *
 * Both checks are here, both are refusals to CONSTRUCT, and both throw rather than returning
 * a value — the same discipline `createAdapterRegistry` applies, for the same reason: this
 * is a wiring decision at process start, not a runtime authority decision, and a deployment
 * that has crossed ADR-024's trigger must not start under option A.
 *
 * A THROW IS WHAT MAKES THE TRIGGER LOUD. A refusal value can be ignored by a caller that
 * does not read it; a throw at composition stops the process.
 *
 * =================================================================================
 * v1.3.7 — THE CONJUNCTION, AND WHICHEVER OCCURS FIRST WINS
 *
 * `50 §2g`: option A is permitted only while BOTH hold —
 *
 *   1. fewer than three configured external-write adapter runtimes; AND
 *   2. every configured vendor credential has `credential_risk_class` other than
 *      `MONEY_MOVING`.
 *
 * The count check runs first because it needs no artifact read, and the credential check
 * runs per descriptor. **Neither half weakens the other**: a deployment with one
 * money-moving credential is refused at one adapter, and a deployment with three
 * `READ_ONLY` credentials is refused at the third.
 * =================================================================================
 */
export function createAdapterRuntimeRegistry(
  descriptors: readonly AdapterRuntimeDescriptor[],
  bundle: VerifiedControlArtifactBundle,
): AdapterRuntimeRegistry {
  // ---------------------------------------------------------------------------------
  // ADR-024's SECOND TRIGGER, CHECKED FIRST BECAUSE IT NEEDS NO ARTIFACT READ.
  // ---------------------------------------------------------------------------------
  if (descriptors.length > OPTION_A_MAX_ADAPTER_RUNTIMES) {
    throw new AdapterRuntimeRegistryError(
      'OPTION_B_TRIGGER_ADAPTER_COUNT',
      `${descriptors.length} adapter runtimes were configured; ADR-024 builds the execution ` +
        'proxy (option B) "at the first money-moving credential or the THIRD adapter, ' +
        `whichever comes first", so option A admits at most ${OPTION_A_MAX_ADAPTER_RUNTIMES}. ` +
        'Option B is not implemented. Build it rather than raising this constant',
    );
  }

  const known = catalogueAdapterIdsFrom(bundle);
  const declaration = verifiedCredentialScopes(bundle);
  const byId = new Map<string, AdapterRuntimeDescriptor>();
  const scopeById = new Map<string, VerifiedCredentialScope>();

  for (const descriptor of descriptors) {
    if (!isWellFormedAdapterId(descriptor.adapterId)) {
      throw new AdapterRuntimeRegistryError(
        'ADAPTER_ID_MALFORMED',
        `"${descriptor.adapterId}" does not satisfy the adapter identifier grammar`,
      );
    }
    if (!known.has(descriptor.adapterId)) {
      throw new AdapterRuntimeRegistryError(
        'ADAPTER_NOT_IN_CATALOGUE',
        `"${descriptor.adapterId}" is not an adapter identity the VERIFIED class-3 action ` +
          `catalogue names (SR7, ADR-006, 50 §2a); known: ${[...known].sort().join(', ')}`,
      );
    }
    if (byId.has(descriptor.adapterId)) {
      throw new AdapterRuntimeRegistryError(
        'DUPLICATE_ADAPTER_RUNTIME',
        `two runtimes were configured for adapter "${descriptor.adapterId}"; 23 §7 scopes ` +
          'isolation per adapter, so one credential scope is one runtime',
      );
    }
    for (const specifier of [descriptor.adapterModule, descriptor.secretSourceModule]) {
      if (!specifierIsInsideRoot(descriptor.runtimeRoot, specifier)) {
        throw new AdapterRuntimeRegistryError(
          'MODULE_OUTSIDE_RUNTIME_ROOT',
          `a module configured for "${descriptor.adapterId}" does not resolve inside its ` +
            'declared runtime root; 29 §3.5 requires per-adapter dependency isolation',
        );
      }
    }

    // ---------------------------------------------------------------------------------
    // `50 §2g` — THE SIGNED CLASS-5 RECORD. MISSING FAILS CLOSED.
    // ---------------------------------------------------------------------------------
    const scope = declaration.credentials[descriptor.credentialId];
    if (scope === undefined) {
      throw new AdapterRuntimeRegistryError(
        'CREDENTIAL_NOT_DECLARED',
        `the verified class-5 declaration carries no record for credential ` +
          `"${descriptor.credentialId}"; 50 §2g: a configured vendor credential whose ` +
          'credential_risk_class is absent FAILS CLOSED, and an undeclared credential is ' +
          'not a non-money-moving one by default',
      );
    }
    if (scope.adapter === AUDIT_PLANE_CREDENTIAL_SCOPE) {
      throw new AdapterRuntimeRegistryError(
        'CREDENTIAL_IS_AUDIT_PLANE_SCOPED',
        `credential "${descriptor.credentialId}" is declared with 50 §2g's reserved ` +
          'audit_plane scope; an audit-plane read credential carries no dispatch authority ' +
          "and 48 §3.6's exemption rests on it only ever reading",
      );
    }
    if (scope.adapter !== descriptor.adapterId) {
      throw new AdapterRuntimeRegistryError(
        'CREDENTIAL_ADAPTER_MISMATCH',
        `credential "${descriptor.credentialId}" is bound by the verified class-5 ` +
          `declaration to adapter "${scope.adapter}", and the descriptor configures it for ` +
          `"${descriptor.adapterId}"; 23 §7 scopes isolation per adapter, so a credential ` +
          'presented for a scope it was not declared against is an unreviewed scope',
      );
    }

    // ---------------------------------------------------------------------------------
    // ADR-024's FIRST TRIGGER, FROM `50 §2g` FIELD 6.
    //
    // A LOOKUP, and the comparison is against the one value `§2g` reserves. `READ_ONLY` and
    // `NON_MONETARY_WRITE` both admit option A subject to the count; `MONEY_MOVING` does
    // not, whatever action ACOS intends to dispatch through the adapter.
    // ---------------------------------------------------------------------------------
    if (scope.credentialRiskClass === 'MONEY_MOVING') {
      throw new AdapterRuntimeRegistryError(
        'OPTION_B_TRIGGER_MONEY_MOVING_CREDENTIAL',
        `credential "${descriptor.credentialId}" is declared MONEY_MOVING by the VERIFIED ` +
          `class-5 artifact, on the provider permissions ` +
          `[${scope.monetaryProviderPermissions.join(', ')}]. ADR-024: the execution proxy ` +
          'is built "at the FIRST money-moving credential or the third adapter, whichever ' +
          'comes first", and option B is not implemented. Option A does not admit this ' +
          'credential — and 50 §2g decides that on what the credential can do at the ' +
          'PROVIDER, not on which action ACOS currently intends to call',
      );
    }

    byId.set(descriptor.adapterId, Object.freeze({ ...descriptor }));
    scopeById.set(descriptor.adapterId, scope);
  }

  const ids = Object.freeze([...byId.keys()].sort());
  return Object.freeze({
    resolve: (adapterId: string): AdapterRuntimeDescriptor | undefined => byId.get(adapterId),
    registeredIds: ids,
    credentialScopeOf: (adapterId: string): VerifiedCredentialScope | undefined =>
      scopeById.get(adapterId),
  });
}

/**
 * PRODUCTION'S OWN RUNTIME REGISTRY. IT IS EMPTY, AND THAT IS THE POINT.
 *
 * The same posture `EMPTY_ADAPTER_REGISTRY` holds for the control-side port, one plane over:
 * `48 §2` rows 1 to 4 are the four integration-plane components that would fill it, and none
 * exists. A production process therefore launches no integration runtime at all.
 *
 * It is a FUNCTION rather than a constant because `createAdapterRuntimeRegistry` requires a
 * verified bundle, and `50 §3f` occasion 1 has not run at module-evaluation time. An empty
 * registry needs no artifact read, so this one never asks for one — which also means the
 * absence is available to a process that has not bootstrapped, and a process that cannot
 * bootstrap cannot dispatch either way.
 */
export function emptyAdapterRuntimeRegistry(): AdapterRuntimeRegistry {
  return Object.freeze({
    resolve: (): AdapterRuntimeDescriptor | undefined => undefined,
    registeredIds: Object.freeze([]),
    credentialScopeOf: (): VerifiedCredentialScope | undefined => undefined,
  });
}
```

### F.5 The credential contract the S1P source must satisfy

#### `src/integration/runtime/adapterSecretSource.ts` (complete)

```typescript
/**
 * `§9` — THE NARROW SECRET-SOURCE INTERFACE. NO CLOUD VENDOR IS SELECTED HERE.
 *
 * =================================================================================
 * WHAT THE ARCHITECTURE SAYS, AND WHAT IT DELIBERATELY DOES NOT SAY
 *
 * ADR-024's decision, verbatim: "Per-adapter vendor secrets **in the platform secret
 * manager**, injected at process start, never shared, with per-adapter runtime, filesystem
 * and dependency-tree isolation, bank-line ingest in its own runtime, and a per-credential
 * revocation switch that **revokes** rather than stopping the loop."
 *
 * `29 §3.2`'s option A block says the same in five lines. `48 §6` puts "Secret-manager IAM"
 * in the credential inventory under "Deployment only — Not held by any adapter".
 *
 * WHAT NO DELIVERABLE IN v1.3.6 SAYS IS *WHICH* PLATFORM SECRET MANAGER. `31 §12`'s
 * technology table names none, and `§9` of the mandate is explicit about the consequence:
 * "Do NOT select a cloud vendor in S1N."
 *
 * So this file declares the CONTRACT and nothing else. There is no AWS SDK, no Azure SDK,
 * no GCP SDK, no Vault client, no HTTP client and no network of any kind in this directory;
 * the S1N implementations of this interface are TEST-ONLY fixtures under
 * `tests/integration-plane/`, and the production posture is that a runtime launched without
 * a source resolves nothing and refuses `CREDENTIAL_UNAVAILABLE`.
 * =================================================================================
 *
 * =================================================================================
 * WHY THE INTERFACE IS PER-ADAPTER AND TAKES NO ADAPTER ID
 *
 * `23 §7`: "one adapter cannot read another's secret from its own environment or
 * filesystem." A source with a `resolve(adapterId)` signature is a source that CAN be asked
 * for another adapter's secret, and the only thing standing between the ask and the answer
 * would be a check inside the source — which is `29 §3.1`'s own objection to internal
 * capability tokens, one layer down: "The adapter would be enforcing a restriction on
 * itself. That is an audit tag, not a security boundary."
 *
 * So `AdapterSecretSource` is SCOPED AT CONSTRUCTION to exactly one adapter identity and
 * `resolve()` takes NO argument. `declaredAdapterId` is there so the HOST can refuse a
 * mis-wired runtime at start — it is a wiring assertion, not a selector — and
 * `unsafeSharedSecretSource` in the negative-control suite is the discriminating control: a
 * source with the selector signature, which adapter A uses to read adapter B's secret.
 * =================================================================================
 */

/**
 * `50 §2g` field 1's identity-provenance set, TRANSCRIBED rather than imported.
 *
 * `credentialRisk.ts` holds the canonical list, and importing it would put the control
 * plane's trust chain into the integration RUNTIME's module graph — the one process
 * `I25` is about, whose import closure `tools/integration-packaging/` proves disjoint.
 * Two independent transcriptions of one closed list disagree loudly;
 * `tests/integration/perimeter/source-boundary.test.ts` is where the disagreement is
 * caught, from the TEST's graph, where importing both is harmless.
 */
export const ADAPTER_CREDENTIAL_IDENTITY_PROVENANCES = [
  'PROVIDER_KEY_ID',
  'DEPLOYMENT_SECRET_VERSION',
  'SYNTHETIC_TEST_IDENTITY',
] as const;

export type CredentialIdentityProvenance =
  (typeof ADAPTER_CREDENTIAL_IDENTITY_PROVENANCES)[number];

/**
 * The resolved credential material, and the non-secret labels that describe it.
 *
 * =================================================================================
 * `secret` IS THE ONLY MEMBER THAT MAY LEAVE THIS OBJECT, AND IT MAY ONLY GO TO ONE PLACE
 *
 * `§29`: the sentinel "must appear nowhere except its integration-only test credential
 * source / private adapter memory fixture." The host hands this whole object to the
 * adapter's `invoke` and to nothing else: it is not logged, not encoded, not attached to an
 * outcome and not readable from any wire type — `DispatchResponse` carries
 * `credentialIdentity` and `credentialVersion` and has no member the secret could occupy.
 *
 * `credentialIdentity` and `version` are NON-SECRET VALUES THE SOURCE DECLARES (`§25`),
 * not digests of the secret. `§25`: "Do not log secret fingerprint unless explicitly
 * architecture-approved", and v1.3.6 approves none. A fingerprint under a rotation schedule
 * is a confirm-a-guess oracle, which is why `credentialLabelsAreNonDerived` below refuses a
 * source whose labels are derivable from its own secret material. `credentialIdentity` is
 * more than a label, though: it is `50 §2g` field 1's BINDING, and the host compares it to
 * the signed expected identity before the adapter is reached.
 * =================================================================================
 */
export interface AdapterCredential {
  /** The vendor secret. NEVER serialised, NEVER logged, NEVER returned to the control plane. */
  readonly secret: string;
  /**
   * `50 §2g` FIELD 1 — **WHICH CREDENTIAL THIS MATERIAL IS.** MANDATORY, NON-SECRET.
   *
   * =================================================================================
   * IT IS NOT A LABEL, AND THE DIFFERENCE IS THE WHOLE CONTROL
   *
   * Before this field existed, the chain ran in two disconnected halves:
   *
   *     signed class-5 `credential_id`  ->  risk class  ->  registry admits the runtime
   *     `secretLocator`                 ->  resolved secret  ->  presented at the provider
   *
   * and NOTHING compared them. A locator repointed at another credential produced a runtime
   * whose risk declaration governed a credential it was not holding:
   * `pause_only = NON_MONETARY_WRITE` declared, `budget_manage = MONEY_MOVING` presented.
   *
   * So the source must now say WHICH CREDENTIAL IT RESOLVED, and `integrationHost.ts`
   * compares that answer to the signed expected identity the parent echoed into the launch
   * configuration. A mismatch is `CREDENTIAL_IDENTITY_MISMATCH`, refused before the adapter
   * is reached and therefore before any provider boundary.
   *
   * **NULL IS NOT A VALUE HERE.** `50 §2g`: a configured credential has an identity, and a
   * source that cannot name what it resolved has not supplied a usable credential. The type
   * carries `string` rather than `string | null` so the absence is a compile error on a
   * source rather than a runtime surprise at a boundary.
   *
   * **AND IT IS NEVER DERIVED FROM THE MATERIAL.** Not the secret, not a hash or fingerprint
   * of it, not a token prefix. `credentialLabelsAreNonDerived` below is the structural half.
   */
  readonly credentialIdentity: string;
  /**
   * WHAT ESTABLISHES THAT IDENTITY. Declared, so a reviewer can tell a binding from a label.
   *
   * `§14` of the S1O correction: "The secret source is a TCB component, but document exactly
   * what establishes its returned credential identity." A source returning
   * `SYNTHETIC_TEST_IDENTITY` is a fixture and is admissible only in a TEST/pre-live package;
   * a production source must return `PROVIDER_KEY_ID` — the provider's own stable key id —
   * or `DEPLOYMENT_SECRET_VERSION`, an immutable secret-manager identity for that exact
   * material. **A source does not become a provider binding by labelling itself one**, which
   * is why this is recorded and reviewed rather than trusted as proof.
   */
  readonly identityProvenance: CredentialIdentityProvenance;
  /** A non-secret, source-declared rotation label. May be `null`. `§25`. */
  readonly version: string | null;
}

/** What a resolution can say. A closed set; there is no exception with a message. */
export type SecretResolution =
  | { readonly kind: 'RESOLVED'; readonly credential: AdapterCredential }
  /** `§24`'s revocation switch, as the source's own answer. */
  | { readonly kind: 'CREDENTIAL_REVOKED' }
  /** No material is provisioned, or the deployment boundary cannot answer. */
  | { readonly kind: 'UNAVAILABLE' };

/**
 * ONE ADAPTER'S SECRET BOUNDARY. THE INTEGRATION RUNTIME'S ONLY ROUTE TO A VENDOR SECRET.
 *
 * `resolve` is called PER INVOCATION rather than once at start, which is `§25`'s rotation
 * requirement: "S1N should support replacing an adapter credential at the integration
 * deployment boundary without restarting/reconfiguring the control process." A source
 * backed by a platform secret manager re-reads; a source backed by a file re-reads the
 * file; the control plane is not involved in either and learns neither the value nor the
 * fact that it changed, beyond the non-secret `version` label it may already see.
 */
export interface AdapterSecretSource {
  /** The ONE adapter identity this source serves. A wiring assertion, never a selector. */
  readonly declaredAdapterId: string;
  resolve(): Promise<SecretResolution>;
}

/**
 * `§25`'s structural form of "do not publish a fingerprint".
 *
 * Refuses a credential whose non-secret labels CONTAIN the secret, are contained BY it, or
 * are a hex/base64 encoding of it. It cannot refuse every derivation — a source determined
 * to publish a keyed digest of its own secret could — and it is not claimed to. What it
 * closes is the accident: a source that set `identity` to the token because the token was
 * the handiest unique string, which is how fingerprints actually reach logs.
 */
export function credentialLabelsAreNonDerived(credential: AdapterCredential): boolean {
  const { secret } = credential;
  if (secret.length === 0) return false;
  for (const label of [credential.credentialIdentity, credential.version]) {
    if (label === null) continue;
    if (label.length === 0) return false;
    if (label.includes(secret) || secret.includes(label)) return false;
    if (label === Buffer.from(secret, 'utf8').toString('hex')) return false;
    if (label === Buffer.from(secret, 'utf8').toString('base64')) return false;
  }
  return true;
}

/**
 * The binding comparison, for THIS plane. Returns the reason the resolved credential is the
 * wrong one, or `null` when the signed record and the resolved material agree.
 *
 * A SECOND implementation of `credentialRisk.ts`'s `credentialIdentityMismatch`, kept inside
 * the integration runtime's own package for the reason the provenance list is transcribed
 * here: this module is loaded by the credential-holding child, and that child's import
 * closure does not contain the control plane's trust chain.
 *
 * **AN EMPTY RESOLVED IDENTITY IS NOT EQUALITY WITH AN EMPTY EXPECTATION.** Absence refuses.
 */
export function adapterCredentialIdentityMismatch(
  expectedCredentialId: string,
  resolvedCredentialIdentity: string,
): string | null {
  if (expectedCredentialId.length === 0) {
    return (
      'the runtime was launched with no expected credential identity; 50 §2g field 1 is the ' +
      'identity of the exact material the runtime may present, and an absent expectation ' +
      'cannot bind one'
    );
  }
  if (resolvedCredentialIdentity.length === 0) {
    return (
      'the secret source returned no credential identity for the material it resolved; a ' +
      'null identity is not sufficient for a configured credential'
    );
  }
  if (expectedCredentialId !== resolvedCredentialIdentity) {
    return (
      `the signed class-5 record governs credential "${expectedCredentialId}" and the secret ` +
      `source resolved material identified as "${resolvedCredentialIdentity}"; the risk ` +
      'declaration would govern the wrong credential'
    );
  }
  return null;
}
```

### F.6 The Z2 adapter contract

#### `src/integration/runtime/integrationAdapter.ts` (complete)

```typescript
import type { Recoverability } from '../../kernel/canonicalisation/actionClasses.js';
import type { WireOutcome } from '../protocol/wire.js';
import type { AdapterCredential } from './adapterSecretSource.js';

/**
 * THE INTEGRATION-SIDE ADAPTER CONTRACT — Z2, AND A DIFFERENT CONTRACT FROM THE PORT.
 *
 * =================================================================================
 * WHY THIS IS NOT `ExternalEffectAdapter`
 *
 * `adapterPort.ts` declares the CONTROL-SIDE port: what the Effect Gateway may hand across
 * its boundary, and what it may receive back. Every member of `DispatchEnvelope` is
 * something the kernel computed, and `dispatch` "receives no client, no credential, no
 * configuration and no callback into the kernel."
 *
 * THAT DESCRIPTION IS EXACTLY WRONG FOR A Z2 ADAPTER AFTER S1N, and deliberately so. An
 * integration-plane adapter DOES receive a credential — `23 §3`: "vendor credentials live
 * here and nowhere else" — resolved by its own runtime from its own deployment boundary and
 * never from the message. Reusing one interface for both sides would mean one of two things
 * and both are defects: either the control-side port grows a credential member (`I25`
 * violated at the type level), or the integration-side adapter cannot see its own credential
 * and has to reach around its own contract for it.
 *
 * So there are two contracts, they are named for their planes, and the method names differ
 * (`dispatch` on the control side, `invoke` here) so that the ACCEPTED static assertion —
 * "exactly ONE production file calls `.dispatch(` on an adapter" — stays true and unamended
 * with the Effect Gateway as that one file.
 * =================================================================================
 *
 * =================================================================================
 * AN ADAPTER IS STILL A TCB MEMBER, AND THIS IS STILL NOT A REAL ONE
 *
 * `49 §3.1` makes adapters TCB members and `29 §3.1` states why: "Each presents a vendor
 * credential whose scope exceeds the action classes it serves, and each writes facts the
 * policy engine trusts. There is no design in which they are not."
 *
 * S1N IMPLEMENTS NO ADAPTER. `§4` of the mandate forbids every provider it enumerates, and
 * THE NAMES ARE DELIBERATELY NOT REPEATED HERE: the ACCEPTED S1M tooling-boundary suite
 * asserts that no vendor name appears anywhere under `src/` in any case, and a comment
 * saying a vendor is absent is still that vendor's name in the tree. The list is in
 * `S1N-contract.md §4`. `§4` forbids any real provider HTTP and any vendor SDK, and there is
 * none anywhere under `src/`. The implementations that satisfy this interface in S1N are
 * SYNTHETIC and live under `tests/integration-plane/`, which is the same
 * "explicitly non-production test location" `§7` of the S1J mandate named for the
 * deterministic mock. `emptyAdapterRuntimeRegistry()` is what production actually holds.
 * =================================================================================
 */

/**
 * What one Z2 adapter is handed. THE VALIDATED REQUEST PLUS ITS OWN CREDENTIAL.
 *
 * Every member except `credential` is a field the host DECODED from the wire and then
 * CHECKED: the payload bytes hash to `dispatchPayloadHash`, the binding digest verifies over
 * the identity fields, the adapter identity equals the runtime's own, and the authorisation
 * reference is present. An adapter therefore never has to validate its own input, and — more
 * to the point — never has the opportunity to accept input the host refused.
 *
 * `credential` did not cross the wire. It was resolved by this runtime from this runtime's
 * own `AdapterSecretSource`, in this process, after the guards ran.
 */
export interface AdapterInvocation {
  readonly adapterId: string;
  readonly method: string;
  readonly actionClass: string;
  readonly recoverability: Recoverability;
  /** `I24`. Present by construction: the host refuses the request before building this. */
  readonly authorisationRef: string;
  readonly companyId: string;
  readonly effectId: string;
  readonly outboxId: string;
  readonly claimId: string;
  readonly idempotencyKey: string;
  readonly correlationTag: string;
  readonly resourceRef: string;
  readonly requiresUnmirroredTag: boolean;
  readonly overrideRef: string | null;
  readonly dispatchPayloadHash: string;
  /** The canonical payload, verbatim. `24 §3` K4: "with that payload **verbatim**". */
  readonly dispatchPayloadBytes: Buffer;
  /** Z2's own credential. `23 §3`. Never serialised, never logged, never returned. */
  readonly credential: AdapterCredential;
}

/**
 * `§31` — THE PROVIDER-CLIENT CALL BOUNDARY, AS A RECORDED FACT RATHER THAN A HOPE.
 *
 * =================================================================================
 * WHY THE ADAPTER MUST TELL THE HOST WHETHER IT CROSSED
 *
 * `25 §7.2`'s discriminating question is not "did the call succeed?" but "COULD THE WRITE
 * HAVE ESCAPED?", and after S1N there are TWO processes that have to agree on the answer.
 * The host cannot observe the adapter's control flow, so if the adapter threw, the host has
 * exactly one honest way to classify it: ask whether the provider-client boundary was
 * crossed before the throw.
 *
 * `markProviderClientCrossed` is that answer, and it is RECORDED BEFORE the provider call
 * rather than after it — a flag set afterwards would be unset in precisely the case it
 * exists for, which is a call that crossed and then died. `§41`: "after invocation
 * ambiguity -> OUTCOME_UNKNOWN."
 *
 * `createUnsafeLateMarkingAdapter` in the negative-control suite is the discriminating
 * control: an adapter whose fault falls BETWEEN its send and its mark, so the host sees
 * `crossed === false` for a request that was sent and classifies a possible escape as a
 * pre-send failure.
 * =================================================================================
 */
export interface ProviderBoundary {
  /** Call IMMEDIATELY BEFORE the provider client, never after it. */
  markProviderClientCrossed(): void;
}

/**
 * ONE TRUSTED Z2 ADAPTER.
 *
 * `invoke` returns a member of the closed wire taxonomy directly, so there is no per-adapter
 * mapping layer and no place for a vendor exception to be reinterpreted into an ACOS fact.
 * `36 §7` / `I26`: "A compromised adapter must produce a well-formed VENDOR RESPONSE, not a
 * well-formed ACOS FACT."
 *
 * An adapter that THROWS has told the host nothing, and the host classifies from
 * `ProviderBoundary` rather than from the exception: crossed becomes `OUTCOME_UNKNOWN`, not
 * crossed becomes `ADAPTER_FAILED / ADAPTER_THREW_PRE_SEND`. The exception's message never
 * crosses the boundary (`§23`).
 */
export interface IntegrationAdapter {
  readonly adapterId: string;
  invoke(invocation: AdapterInvocation, boundary: ProviderBoundary): Promise<WireOutcome>;
}

/**
 * What a loaded adapter module must export.
 *
 * ONE NAMED EXPORT, `integrationAdapter`, and not a default: a default export is whatever
 * the module happened to evaluate to, and the host refusing a module that does not name its
 * adapter is one more thing a mis-wired or substituted module cannot get past.
 */
export interface IntegrationAdapterModule {
  readonly integrationAdapter: IntegrationAdapter;
}

export function isIntegrationAdapterModule(value: unknown): value is IntegrationAdapterModule {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = (value as { integrationAdapter?: unknown }).integrationAdapter;
  if (typeof candidate !== 'object' || candidate === null) return false;
  const adapter = candidate as { adapterId?: unknown; invoke?: unknown };
  return typeof adapter.adapterId === 'string' && typeof adapter.invoke === 'function';
}
```

### F.7 The new S1P integration-plane files — complete

All six are also in `S1P-review.diff` PART 2.

**Attachment evidence the reviewer can check against F.1–F.6:**

| Question | Where to look |
|---|---|
| does the adapter implement the accepted Z2 contract? | `adapter.ts` imports `IntegrationAdapter`, `AdapterInvocation`, `ProviderBoundary` from `src/integration/runtime/integrationAdapter.js` (F.6) and `WireOutcome` from the accepted wire |
| does it re-implement any guard? | it performs no decode, no identity check, no binding check, no payload-hash check and no credential resolution — those are F.2 guards 1–7 |
| how would it be loaded? | only by `main.ts` (F.1) `await import(...)` of a descriptor's `adapterModule`, confined to `runtimeRoot` |
| is such a descriptor registered anywhere? | **no.** `createAdapterRuntimeRegistry` (F.4) refuses it; nothing in the tree constructs one |
| does the secret source satisfy the accepted contract? | `secretSource.ts` implements `AdapterSecretSource` (F.5) with `resolve()` taking no argument |

#### `validation/sendgrid/integration/requestMapping.ts` (complete)

```typescript
import { isCorrelationTag } from '../../../src/kernel/outbox/correlationTag.js';

/**
 * THE DETERMINISTIC MAPPING FROM AN ALREADY-AUTHORITATIVE ACOS INVOCATION INTO A v3 MAIL
 * SEND BODY. PURE, TOTAL, AND THE ONLY PLACE A SENDGRID REQUEST IS CONSTRUCTED.
 *
 * =================================================================================
 * `26 §1` COROLLARY 3 — THE REQUEST IS BUILT BY THE CEILING'S ENFORCER, NOT BY ITS SUBJECT
 *
 * Every field of the body below comes from exactly one of two places:
 *
 *   1. THE INVOCATION — `correlationTag`, minted at enqueue by `25 §7`'s kernel path,
 *      persisted once, made immutable by `dispatch_outbox_state_machine`, and carried
 *      verbatim across the IPC boundary the integration host validated.
 *   2. THE LAUNCH CONFIGURATION — the sender identity and the owner-controlled sink, read
 *      by this runtime from its own deployment boundary at process start.
 *
 * **NOTHING COMES FROM A MODEL, A WORKER, A PROVIDER RESPONSE OR A REQUEST FIELD.** There is
 * no parameter on this function a proposer could reach: `SendGridSendInput` carries the two
 * values above and nothing else, and the resulting body has no member a caller could widen.
 *
 * =================================================================================
 * THE RECIPIENT IS LAUNCH CONFIGURATION, NOT MESSAGE CONTENT, AND THAT IS DELIBERATE
 *
 * A production email adapter would take its recipient from the effect. S1P must not, and
 * `§19` of the mandate is why: "NO customer recipient", "NO production business message".
 *
 * A recipient that arrives in the dispatch payload is a recipient an upstream defect can
 * make a customer. A recipient that arrives in this runtime's launch configuration is one
 * the OWNER wrote into the deployment boundary, and no value on any wire can change it.
 * `assertOwnerControlledSink` is the second half: the configured value must carry the
 * declared non-production sink marker, so a production address cannot be configured by
 * accident either.
 *
 * **THE CONSEQUENCE IS STATED RATHER THAN HIDDEN:** this package cannot send a real business
 * email at all, to anyone, and an email action class that needed to would need a different
 * adapter and a different review. That is the correct capability for a validation slice.
 *
 * =================================================================================
 * `§19` OF THE S1P MANDATE — SANDBOX MODE IS REFUSED HERE, BEFORE THE BOUNDARY
 *
 * S1O established the fact this refusal rests on, from Twilio SendGrid's own documentation:
 * a request made with `mail_settings.sandbox_mode.enable = true` is validated, never
 * delivered, and **generates no Event Webhook event and no Email Activity event.** The mode
 * that makes a request safe is the mode that removes the evidence `I36` reads.
 *
 * So `sandbox_mode` is not a configurable member of the body this module emits. It is
 * emitted EXPLICITLY AS `false`, and `buildSendGridSendRequest` REFUSES an input that asks
 * for `true` — returning a refusal rather than throwing, so the adapter can decline without
 * marking the provider boundary crossed. `§8.6`: "Add a discriminating test for this. Do not
 * merely document it."
 * =================================================================================
 */

/** `https://api.sendgrid.com`'s v3 Mail Send path. A CONSTANT, never an argument. */
export const SENDGRID_MAIL_SEND_PATH = '/v3/mail/send';

/**
 * The declared marker an owner-controlled non-production sink address must carry.
 *
 * A sub-address tag (`user+acos-nonprod-sink@example.test`) or a local part containing it.
 * `§15` item 11 makes configuring the sink an operator step; this makes MIS-configuring it a
 * refusal rather than a delivery.
 */
export const OWNER_SINK_MARKER = 'acos-nonprod-sink';

/** The `custom_args` key carrying the correlation tag. Non-secret, declared once. */
export const CORRELATION_CUSTOM_ARG = 'acos_correlation_tag';

/**
 * The deterministic subject prefix. NOT customer-like content, and recognisable in an
 * account's own activity view as a validation artifact rather than a business message.
 */
export const VALIDATION_SUBJECT_PREFIX = 'ACOS S1P NON-PRODUCTION VALIDATION';

/** What one send needs. Two operands, and neither is reachable from a dispatch request. */
export interface SendGridSendInput {
  /** `25 §7`'s provider-visible correlation tag, verbatim from the invocation. */
  readonly correlationTag: string;
  /** Launch configuration: the verified non-production sending identity. */
  readonly senderAddress: string;
  /** Launch configuration: the OWNER-CONTROLLED sink. Never a customer, never an effect field. */
  readonly sinkAddress: string;
  /**
   * Present so the refusal has something to refuse, and `false` on every legitimate path.
   *
   * A boolean rather than an absent member, because a check that can only be written by
   * adding a field is a check nobody can test. `§8.6` requires a DISCRIMINATING test, and a
   * discriminating test needs the unsafe input to be expressible.
   */
  readonly sandboxMode: boolean;
}

/** Why a send request could not be constructed. A closed set; every member is pre-boundary. */
export const SEND_MAPPING_REFUSALS = [
  /** `§19`: sandbox mode is not the `I36` path, and it is refused before the boundary. */
  'SANDBOX_MODE_REFUSED',
  /** The tag is not one `mintCorrelationTag` produced. Provider evidence would not correlate. */
  'CORRELATION_TAG_MALFORMED',
  /** The configured sink does not carry `OWNER_SINK_MARKER`. */
  'SINK_NOT_OWNER_CONTROLLED',
  /** The sender or sink is not a syntactically usable address. */
  'ADDRESS_MALFORMED',
] as const;

export type SendMappingRefusal = (typeof SEND_MAPPING_REFUSALS)[number];

/**
 * The v3 Mail Send body, as a closed shape.
 *
 * `personalizations` carries ONE entry with ONE recipient. There is no member a second
 * recipient, a cc, a bcc or a template substitution could occupy, which is the structural
 * form of "one owner-controlled sink, never a list".
 */
export interface SendGridMailSendBody {
  readonly personalizations: readonly [{ readonly to: readonly [{ readonly email: string }] }];
  readonly from: { readonly email: string };
  readonly subject: string;
  readonly content: readonly [{ readonly type: 'text/plain'; readonly value: string }];
  /**
   * `25 §7`'s tag in a PROVIDER-VISIBLE FIELD, and `categories` is the unambiguous one.
   *
   * S1O's capability record: `categories` is settable on the v3 send AND is itself a
   * documented Email Activity filter field, where `custom_args`/`unique_args` round-tripping
   * is the item the account validation still owes. Both are emitted; `categories` is the one
   * the observation loop filters on, and the second is carried so the account run can settle
   * whether it round-trips.
   */
  readonly categories: readonly [string];
  readonly custom_args: Readonly<Record<string, string>>;
  /** EXPLICITLY `false`. See this module's header. */
  readonly mail_settings: { readonly sandbox_mode: { readonly enable: false } };
}

export type SendMappingResult =
  | { readonly kind: 'REQUEST'; readonly body: SendGridMailSendBody }
  | { readonly kind: 'REFUSED'; readonly reason: SendMappingRefusal };

/**
 * Deliberately narrow, and deliberately NOT an RFC 5322 parser.
 *
 * What it has to exclude is a value that is not an address at all — an empty string, a
 * header injection, a list. A permissive-but-safe check is correct here because the PROVIDER
 * is the authority on address validity and this function's job is to refuse the shapes that
 * would make the request mean something other than it says.
 */
function isUsableAddress(value: string): boolean {
  if (value.length === 0 || value.length > 254) return false;
  if (/[\s,;<>"\\]/.test(value)) return false;
  if (/[\r\n]/.test(value)) return false;
  const at = value.indexOf('@');
  return at > 0 && at === value.lastIndexOf('@') && at < value.length - 1;
}

/** Whether a configured address is the owner-controlled non-production sink it claims to be. */
export function isOwnerControlledSink(value: string): boolean {
  return isUsableAddress(value) && value.includes(OWNER_SINK_MARKER);
}

/**
 * Build one v3 Mail Send body, or refuse. TOTAL, PURE, AND THE ONLY CONSTRUCTOR.
 *
 * It performs no I/O, holds no credential and names no URL: the client one file over adds
 * the origin, the path and the Authorization header, and nothing it adds is derived from
 * anything this function returns.
 */
export function buildSendGridSendRequest(input: SendGridSendInput): SendMappingResult {
  // `§19`, FIRST, because a sandbox request is refused whatever else is wrong with it.
  if (input.sandboxMode) return { kind: 'REFUSED', reason: 'SANDBOX_MODE_REFUSED' };
  if (!isCorrelationTag(input.correlationTag)) {
    return { kind: 'REFUSED', reason: 'CORRELATION_TAG_MALFORMED' };
  }
  if (!isUsableAddress(input.senderAddress)) {
    return { kind: 'REFUSED', reason: 'ADDRESS_MALFORMED' };
  }
  if (!isUsableAddress(input.sinkAddress)) {
    return { kind: 'REFUSED', reason: 'ADDRESS_MALFORMED' };
  }
  if (!isOwnerControlledSink(input.sinkAddress)) {
    return { kind: 'REFUSED', reason: 'SINK_NOT_OWNER_CONTROLLED' };
  }

  return {
    kind: 'REQUEST',
    body: Object.freeze({
      personalizations: Object.freeze([
        Object.freeze({ to: Object.freeze([Object.freeze({ email: input.sinkAddress })]) }),
      ]) as SendGridMailSendBody['personalizations'],
      from: Object.freeze({ email: input.senderAddress }),
      subject: `${VALIDATION_SUBJECT_PREFIX} ${input.correlationTag}`,
      content: Object.freeze([
        Object.freeze({
          type: 'text/plain' as const,
          /*
           * THE BODY IS THE CORRELATION TAG AND A SENTENCE SAYING WHAT THIS IS.
           *
           * No customer data, no business content, no rendered template, and nothing derived
           * from the dispatch payload — `§16`: evidence must not carry "full customer-like
           * message content", and a message that cannot contain any is one no redaction step
           * has to remove it from.
           */
          value:
            `${VALIDATION_SUBJECT_PREFIX}\n` +
            `correlation: ${input.correlationTag}\n` +
            'This message is an ACOS non-production provider-validation artifact. It ' +
            'carries no business content and was sent to an owner-controlled sink.',
        }),
      ]) as SendGridMailSendBody['content'],
      categories: Object.freeze([input.correlationTag]) as SendGridMailSendBody['categories'],
      custom_args: Object.freeze({ [CORRELATION_CUSTOM_ARG]: input.correlationTag }),
      mail_settings: Object.freeze({ sandbox_mode: Object.freeze({ enable: false as const }) }),
    }),
  };
}
```

#### `validation/sendgrid/integration/providerClient.ts` (complete)

```typescript
import type { SendGridMailSendBody } from './requestMapping.js';
import { SENDGRID_MAIL_SEND_PATH } from './requestMapping.js';

/**
 * THE ONE VENDOR HTTP CLIENT FOR SENDS — `48 §4` ITEM 1, AND THE FIRST REAL ONE IN THIS
 * REPOSITORY'S HISTORY.
 *
 * =================================================================================
 * "ONE VENDOR-HTTP CLIENT PER ADAPTER. NO AD-HOC HTTP CONSTRUCTION ANYWHERE IN THE CODEBASE"
 *
 * `48 §4` item 1, verbatim, and this file is the whole of the send side's compliance with it.
 * `tools/perimeter/` recognises the `sendToProvider*` declaration shape, scans this tree at
 * PRODUCTION scope because `validation/` is not `tests/`, and fails the build on an
 * unannotated site. `tests/sendgrid/provider-client-boundary.test.ts` asserts the structural
 * half a scanner cannot: exactly one origin constant, exactly one path, and no route by
 * which either could come from an argument.
 *
 * =================================================================================
 * THERE IS NO ARBITRARY-URL CAPABILITY, AND THE ABSENCE IS STRUCTURAL RATHER THAN CHECKED
 *
 * `§19` of the S1P mandate forbids "a generic arbitrary-HTTP escape hatch", and `§8.1`
 * forbids exposing "arbitrary URL, verb, header, or body passthrough" to control.
 *
 *   - the ORIGIN is a module constant;
 *   - the PATH is a module constant;
 *   - the METHOD is the literal `'POST'`;
 *   - the HEADERS are constructed here from the credential and nothing else;
 *   - the BODY is a `SendGridMailSendBody`, which only `buildSendGridSendRequest` produces.
 *
 * `SendGridSendRequest` therefore has no member that could name a destination. The control
 * plane is two process boundaries away from this function and `DispatchRequest`'s closed
 * twenty-field list contains no `url`, `method`, `headers` or `body` member either, so there
 * is no value the control plane can set that reaches any part of the request line.
 *
 * =================================================================================
 * NO RETRY. NOT ONE, NOT CONDITIONAL, NOT "SAFE" — `§33`, `§19`
 *
 * There is no loop in this file, no `setTimeout`, no attempt counter and no retry predicate.
 * `25 §7` is why: a retried send for a CLAIMED effect is the duplicate `I36` exists to
 * forbid, and a client that retried on a 5xx would do exactly that for the one status whose
 * meaning is "the provider may or may not have accepted it". A transport failure becomes
 * `OUTCOME_UNKNOWN` at the adapter and the effect stays `CLAIMED`; nothing in this package
 * sends it again, ever.
 * =================================================================================
 */

/** THE ONE ORIGIN. A CONSTANT — never an argument, never composed, never configurable. */
export const SENDGRID_API_ORIGIN = 'https://api.sendgrid.com';

/**
 * The transport deadline, in milliseconds.
 *
 * Below `integrationClient.ts`'s `DEFAULT_INVOCATION_DEADLINE_MS` (10s) so a hung provider
 * produces this adapter's own `OUTCOME_UNKNOWN` rather than the control plane's invocation
 * timeout. Both are honest; the inner one carries more information.
 */
export const SENDGRID_SEND_DEADLINE_MS = 8_000;

/** What the client is handed. NO MEMBER NAMES A DESTINATION. */
export interface SendGridSendRequest {
  readonly body: SendGridMailSendBody;
  /**
   * The vendor secret, presented exactly where a vendor client presents one.
   *
   * An ARGUMENT rather than a module-level value, for the reason
   * `tests/integration-plane/adapterA/providerClient.ts` takes one: it keeps the material in
   * the one call frame `§29`'s leak matrix has to account for. It is never logged, never
   * returned and never placed on a result.
   */
  readonly secret: string;
}

/**
 * What the provider answered. NON-SECRET, AND NARROW BY CONSTRUCTION.
 *
 * There is no member the response BODY could occupy. `§44` of the S1N mandate: "Do not
 * expose arbitrary raw provider response to worker/model", and a client that returned the
 * body would put the decision about what to keep in the adapter, one layer too late.
 */
export type SendGridSendResponse =
  | {
      readonly kind: 'PROVIDER_ANSWERED';
      readonly httpStatus: number;
      /** SendGrid's `X-Message-Id` response header, or `null` when it sent none. */
      readonly providerMessageId: string | null;
    }
  /** The boundary was crossed and no answer came back. NEVER conflated with a rejection. */
  | { readonly kind: 'NO_ANSWER' };

/**
 * `POST https://api.sendgrid.com/v3/mail/send`. THE ONE SEND CALL SITE.
 *
 * PERIMETER_AUTHORISED(authorisation_ref) — I24, 48 §4 item 2. Every invocation of this
 * function is reached only from `adapter.ts`, which receives an `AdapterInvocation` whose
 * `authorisationRef` the integration host validated for PRESENCE and then for BINDING to
 * this exact effect, before any line of this package ran.
 */
export async function sendToProviderSendGrid(
  request: SendGridSendRequest,
): Promise<SendGridSendResponse> {
  const controller = new AbortController();
  const deadline = setTimeout(() => {
    controller.abort();
  }, SENDGRID_SEND_DEADLINE_MS);

  try {
    // PERIMETER_AUTHORISED(authorisation_ref) — I24, 48 §4 item 2. The destination is
    // `SENDGRID_API_ORIGIN` and `SENDGRID_MAIL_SEND_PATH`, both module constants; no
    // argument of this function participates in the request line.
    const response = await globalThis.fetch(`${SENDGRID_API_ORIGIN}${SENDGRID_MAIL_SEND_PATH}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${request.secret}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(request.body),
      signal: controller.signal,
    });
    return {
      kind: 'PROVIDER_ANSWERED',
      httpStatus: response.status,
      providerMessageId: response.headers.get('x-message-id'),
    };
  } catch {
    /*
     * THE EXCEPTION IS NOT READ, AND ITS MESSAGE NEVER LEAVES THIS FRAME — `§23`.
     *
     * A transport error at this point means the request MAY have reached the provider. `25
     * §7.2`: "Anything for which the request MAY have escaped is OUTCOME_UNKNOWN", and this
     * return is what the adapter turns into one. An abort, a DNS failure and a reset are the
     * same fact here, and distinguishing them would be distinguishing them in a direction
     * that cannot change the answer.
     */
    return { kind: 'NO_ANSWER' };
  } finally {
    clearTimeout(deadline);
  }
}

/**
 * `202 Accepted` — the ONLY status this package treats as provider acceptance.
 *
 * S1O's capability record, from Twilio SendGrid's own documentation: a live accepted request
 * returns 202 where a valid SANDBOX request returns 200. The distinction is not cosmetic and
 * the constant is separated from the classifier so a test can state it.
 */
export const SENDGRID_ACCEPTED_STATUS = 202;

/** The sandbox status, named so the classifier can refuse it rather than ignore it. */
export const SENDGRID_SANDBOX_VALIDATED_STATUS = 200;

/**
 * The outcome taxonomy one send response maps to. PURE — no transport, fully testable.
 *
 * =================================================================================
 * `NOT_SENT_CONFIRMED` IS NOT REACHABLE FROM ANY PROVIDER STATUS, AND THAT IS THE FINDING
 *
 * `25 §7.2` admits two bases, and the second is "a provider rejection whose declared adapter
 * contract **guarantees** no external mutation occurred". `36 §7` requires that guarantee to
 * be ESTABLISHED against the vendor, and
 * `tests/integration-plane/adapterA/adapter.ts` says why a synthetic adapter's version of it
 * proves nothing: it "IS the provider".
 *
 * **S1P HAS MEASURED NO SUCH CONTRACT.** Twilio SendGrid publishes no statement that a 400
 * or a 403 from `/v3/mail/send` guarantees no message was queued, and this package will not
 * infer one from a status code's usual meaning. So every provider answer other than 202 is
 * `ADAPTER_FAILED / PROVIDER_CLIENT_REJECTED` — which carries "no local outcome policy"
 * (`25 §7.1`) and therefore claims nothing — and the effect stays `CLAIMED`.
 *
 * The cost is stated rather than engineered away, exactly as `35 §12.3` states the analogous
 * one: a request SendGrid definitely refused is treated as one that might not have been
 * refused. Recorded as an open obligation, and the measurement that would close it is an
 * account-level probe, not a code change.
 *
 * A `200` is the sandbox status. It is reachable only if the account forced sandbox mode on
 * at the account level, because `buildSendGridSendRequest` emits `enable: false` and refuses
 * an input asking otherwise — so it is classified as its own failure rather than as success,
 * and the harness reports it as a configuration defect.
 * =================================================================================
 */
export type SendGridSendClassification =
  | { readonly kind: 'ACCEPTED'; readonly providerMessageId: string | null }
  /** The provider answered and did not accept. No no-mutation guarantee is claimed. */
  | { readonly kind: 'REJECTED'; readonly httpStatus: number }
  /** A 200: the account applied sandbox mode. `I36` evidence would not exist. */
  | { readonly kind: 'SANDBOX_SUPPRESSED'; readonly httpStatus: number }
  /** The request may have escaped and no answer came back. */
  | { readonly kind: 'UNKNOWN' };

export function classifySendGridSendResponse(
  response: SendGridSendResponse,
): SendGridSendClassification {
  if (response.kind === 'NO_ANSWER') return { kind: 'UNKNOWN' };
  if (response.httpStatus === SENDGRID_ACCEPTED_STATUS) {
    return { kind: 'ACCEPTED', providerMessageId: response.providerMessageId };
  }
  if (response.httpStatus === SENDGRID_SANDBOX_VALIDATED_STATUS) {
    return { kind: 'SANDBOX_SUPPRESSED', httpStatus: response.httpStatus };
  }
  /*
   * A 5xx IS `UNKNOWN`, NOT A REJECTION.
   *
   * "The provider had an internal error" does not say whether the message was queued first.
   * `25 §7.2`'s question is "could the write have escaped?", and for a 5xx the honest answer
   * is yes. A 429 is treated the same way for the same reason: SendGrid's documented rate
   * limiting sits in front of the API, and this package will not assume where.
   */
  if (response.httpStatus >= 500 || response.httpStatus === 429) return { kind: 'UNKNOWN' };
  return { kind: 'REJECTED', httpStatus: response.httpStatus };
}
```

#### `validation/sendgrid/integration/adapter.ts` (complete)

```typescript
import { createHash } from 'node:crypto';

import type {
  AdapterInvocation,
  IntegrationAdapter,
  ProviderBoundary,
} from '../../../src/integration/runtime/integrationAdapter.js';
import type { WireOutcome } from '../../../src/integration/protocol/wire.js';
import { ENV_SECRET_LOCATOR } from '../../../src/integration/protocol/runtimeEnvironment.js';
import { readNonProductionConfig } from './nonProductionConfig.js';
import { buildSendGridSendRequest } from './requestMapping.js';
import { classifySendGridSendResponse, sendToProviderSendGrid } from './providerClient.js';

/**
 * THE SENDGRID Z2 ADAPTER — `sendgrid_email`. NON-PRODUCTION VALIDATION ONLY.
 *
 * =================================================================================
 * WHERE THIS RUNS, AND WHY THE ANSWER IS THE WHOLE SECURITY ARGUMENT
 *
 * This module is loaded by `src/integration/runtime/main.ts`, INSIDE the `child_process.fork`
 * the control plane spawned, from a module specifier that is trusted launch configuration and
 * that `main.ts` refuses unless it resolves inside the declared runtime root. By the time
 * `invoke` runs, the ACCEPTED integration host has already:
 *
 *   1. decoded the request against the closed twenty-field schema;
 *   2. checked the adapter identity against this runtime's own;
 *   3. checked `authorisationRef` is present (`I24`);
 *   4. checked it is BOUND to this exact effect (`§16`);
 *   5. checked the payload bytes hash to the hash the authorisation committed;
 *   6. resolved the credential from THIS runtime's own source, per invocation;
 *   7. compared the resolved material's identity to the signed class-5 `credential_id`.
 *
 * **NONE OF THOSE CHECKS IS REIMPLEMENTED HERE**, and none can be skipped: guard 8 is the
 * only call site of `invoke` and every earlier guard is an early return. This adapter's own
 * job is the two things the host cannot do for it — build a request that says what ACOS
 * authorised, and tell the host whether the provider boundary was crossed.
 *
 * =================================================================================
 * `I25`: THE CONTROL PROCESS NEVER SEES THE KEY, AND CANNOT
 *
 * `invocation.credential` did not cross the wire. `DispatchRequest` has no member a secret
 * could occupy, the child's environment is an eight-key constructed allowlist carrying a
 * LOCATOR rather than material, and `DispatchResponse` carries a non-secret
 * `credentialIdentity` and has nowhere to put the key on the way back.
 *
 * =================================================================================
 * NO PROVIDER-CONTROLLED AUTHORITY, AND NO PROVIDER RETRY
 *
 * `36 §7` / `I26`: "A compromised adapter must produce a well-formed VENDOR RESPONSE, not a
 * well-formed ACOS FACT." This adapter returns a member of the closed `WireOutcome` taxonomy
 * and nothing else. A SendGrid response cannot set an ACOS state, cannot extend a claim,
 * cannot reverse an outcome and cannot cause a second send: there is no loop in this file
 * and no call to `sendToProviderSendGrid` other than the one below.
 * =================================================================================
 */

const ADAPTER_ID = 'sendgrid_email';

/**
 * The non-secret configuration, read ONCE at module evaluation from this runtime's own
 * locator.
 *
 * Once rather than per invocation, and deliberately the opposite of the credential's
 * lifecycle: `§25`'s rotation requirement is about the SECRET, and a sink address that could
 * change between two invocations of one validation run would make the evidence ambiguous
 * about which sink each scenario reached. The credential is re-resolved per invocation by
 * the host; the sink is fixed for the life of the process.
 */
const CONFIG = readNonProductionConfig(process.env[ENV_SECRET_LOCATOR] ?? '');

export const integrationAdapter: IntegrationAdapter = {
  adapterId: ADAPTER_ID,

  async invoke(invocation: AdapterInvocation, boundary: ProviderBoundary): Promise<WireOutcome> {
    /*
     * EVERY REFUSAL BELOW HAPPENS BEFORE `markProviderClientCrossed`, SO EVERY ONE OF THEM
     * IS HONESTLY PRE-SEND.
     *
     * The host classifies a throw from an unmarked adapter as `ADAPTER_THREW_PRE_SEND`, and
     * these return `ADAPTER_FAILED` with the same class directly. `25 §7.2`'s question —
     * "could the write have escaped?" — has one answer above the mark and a different one
     * below it, and nothing in this method blurs the line.
     */
    if (CONFIG.kind === 'REFUSED') {
      return { kind: 'ADAPTER_FAILED', failureClass: 'ADAPTER_THREW_PRE_SEND' };
    }

    /*
     * `§8.6` — SANDBOX MODE FAILS BEFORE THE SEND.
     *
     * `sandboxMode: false` is passed as a LITERAL rather than read from configuration, which
     * is the structural form of the rule: there is no document an operator could write, and
     * no environment variable anyone could set, that makes this adapter emit a sandbox
     * request. `buildSendGridSendRequest` still carries the refusal because the input shape
     * must be able to express the unsafe case for `sandbox-refusal.test.ts` to discriminate
     * it — a check whose failing input cannot be constructed is a check nobody has tested.
     */
    const mapped = buildSendGridSendRequest({
      correlationTag: invocation.correlationTag,
      senderAddress: CONFIG.config.senderAddress,
      sinkAddress: CONFIG.config.sinkAddress,
      sandboxMode: false,
    });
    if (mapped.kind === 'REFUSED') {
      return { kind: 'ADAPTER_FAILED', failureClass: 'ADAPTER_THREW_PRE_SEND' };
    }

    /*
     * `§31` / `25 §7.2` — THE MARK GOES BEFORE THE CALL, NEVER AFTER IT.
     *
     * A flag set after the provider call is unset in exactly the case it exists for, which
     * is a call that crossed and then died. Everything above this line is provably pre-send;
     * everything below it may have escaped.
     */
    boundary.markProviderClientCrossed();

    let response;
    try {
      // PERIMETER_AUTHORISED(authorisation_ref) — I24, 48 §4 item 2. `invocation` carries
      // `authorisationRef`, which the integration host validated for PRESENCE and then for
      // BINDING to this exact effect before any line of this adapter ran.
      response = await sendToProviderSendGrid({
        body: mapped.body,
        secret: invocation.credential.secret,
      });
    } catch {
      // The boundary was crossed. The exception is not read and its message never crosses
      // the process boundary (`§23`).
      return { kind: 'OUTCOME_UNKNOWN', reason: 'AMBIGUOUS' };
    }

    const classification = classifySendGridSendResponse(response);
    switch (classification.kind) {
      case 'ACCEPTED':
        return {
          kind: 'ADAPTER_RETURNED',
          /*
           * SENDGRID'S OWN `X-Message-Id`, PRESERVED AS PROVIDER EVIDENCE — `§8.3`.
           *
           * It is the provider's identity for the request, it is what
           * `GET /v3/messages/{msg_id}` takes, and it is NOT the ACOS correlation tag: the
           * tag is what ACOS minted and the message id is what SendGrid answered. `§8.3`
           * requires both and forbids confusing one for the other.
           */
          providerReference: classification.providerMessageId,
          /*
           * `§44` — THE RAW RECORD DOES NOT CROSS. A DIGEST DOES.
           *
           * `WireOutcome` has no member a body could occupy, so the bound is structural.
           * What is hashed is the status line and the message id — the two facts this
           * package retained — rather than a response body it deliberately never read.
           */
          rawResponseHash: createHash('sha256')
            .update(
              `sendgrid:202:${classification.providerMessageId ?? ''}:${invocation.correlationTag}`,
              'utf8',
            )
            .digest('hex'),
        };

      case 'SANDBOX_SUPPRESSED':
        /*
         * A 200 MEANS THE ACCOUNT APPLIED SANDBOX MODE, AND THE EVIDENCE DOES NOT EXIST.
         *
         * `ADAPTER_FAILED` rather than `ADAPTER_RETURNED`: the request was validated and
         * nothing was delivered, so treating it as a return would record an acceptance the
         * provider did not make and would leave `I36` reading an Email Activity feed that
         * S1O established will hold no event for it. The harness reports the status as a
         * configuration defect.
         */
        return { kind: 'ADAPTER_FAILED', failureClass: 'PROVIDER_CLIENT_REJECTED' };

      case 'REJECTED':
        /*
         * NOT `NOT_SENT_CONFIRMED`. See `classifySendGridSendResponse`'s header: `25 §7.2`'s
         * second basis needs a MEASURED vendor no-mutation guarantee, `36 §7` says where it
         * comes from, and S1P has measured none.
         */
        return { kind: 'ADAPTER_FAILED', failureClass: 'PROVIDER_CLIENT_REJECTED' };

      case 'UNKNOWN':
      default:
        return { kind: 'OUTCOME_UNKNOWN', reason: 'AMBIGUOUS' };
    }
  },
};
```

#### `validation/sendgrid/integration/killPointAdapter.ts` (complete)

```typescript
import { readFileSync } from 'node:fs';

import type {
  AdapterInvocation,
  IntegrationAdapter,
  ProviderBoundary,
} from '../../../src/integration/runtime/integrationAdapter.js';
import type { WireOutcome } from '../../../src/integration/protocol/wire.js';
import { ENV_SECRET_LOCATOR } from '../../../src/integration/protocol/runtimeEnvironment.js';
import { integrationAdapter as realSendGridAdapter } from './adapter.js';

/**
 * KILL POINT 3, AS A SEPARATE ADAPTER MODULE — `§9`.
 *
 * =================================================================================
 * WHY THE CRASH LIVES HERE AND NOT IN `adapter.ts`
 *
 * Kill point 3 is "after invocation/request acceptance point, before outcome known", and it
 * happens INSIDE the integration child, after the provider accepted and before the response
 * crosses back. A real adapter has no `afterAccepted` callback for the control plane to hook,
 * and `§13` of the S1N mandate forbids giving it one: the dispatch wire carries no control
 * member, so the control plane cannot ask an adapter to do anything but its job.
 *
 * `tests/integration-plane/adapterA/` established the accepted alternative — the behaviour
 * rides on the RUNTIME's OWN LAUNCH CONFIGURATION rather than on a message — and its
 * consequence is stated there and holds here: "one runtime behaves one way for its whole
 * life, the control plane cannot change it mid-flight, and nothing about the outcome is
 * attributable to anything the control plane said."
 *
 * **SO THIS IS A DIFFERENT MODULE SPECIFIER, NOT A FLAG.** `adapter.ts` has no crash branch,
 * no import of this file and no reference to `killPoint`; a descriptor that names
 * `adapter.js` cannot reach this code by any configuration. A run that wants point 3 launches
 * a runtime whose `adapterModule` IS this file, which is a decision taken once, at wiring
 * time, by the operator invoking the harness.
 *
 * =================================================================================
 * THE SEND IS REAL AND THE CRASH IS REAL. THAT IS THE POINT
 *
 * This wrapper does not simulate a send and does not simulate acceptance. It delegates to the
 * REAL adapter, which performs the REAL `POST /v3/mail/send`; only once that has returned
 * does it kill its own process, so the provider genuinely accepted a message that ACOS
 * genuinely has no outcome for. `§9`: "Do not simulate this result and call it provider
 * evidence."
 *
 * `process.exit` rather than a throw, and the difference matters: a throw would be caught by
 * the integration host and answered on the wire, which is a different failure from the one
 * `35 §12.3` describes. An exit produces the silence a SIGKILL produces, and
 * `integrationClient.ts`'s deadline is what the control plane then sees.
 * =================================================================================
 */

/** The exit code, chosen so a run's process table says which kill this was. */
export const KILL_POINT_3_EXIT_CODE = 33;

/**
 * Whether this runtime was launched to crash. Read ONCE, from this runtime's OWN locator
 * document, at module evaluation — never per invocation and never from a message.
 */
function killPointArmed(): boolean {
  try {
    const document = JSON.parse(
      readFileSync(process.env[ENV_SECRET_LOCATOR] ?? '', 'utf8'),
    ) as { readonly killPoint?: unknown };
    return document.killPoint === 'EXIT_AFTER_SEND';
  } catch {
    return false;
  }
}

const ARMED = killPointArmed();

export const integrationAdapter: IntegrationAdapter = {
  adapterId: realSendGridAdapter.adapterId,

  async invoke(invocation: AdapterInvocation, boundary: ProviderBoundary): Promise<WireOutcome> {
    const outcome = await realSendGridAdapter.invoke(invocation, boundary);
    if (ARMED) {
      /*
       * THE REAL SEND HAS RETURNED. THE OUTCOME HAS NOT BEEN REPORTED.
       *
       * Exactly `35 §12.3`'s "The HTTP request leaves; the process dies before the response
       * is recorded." The outbox row stays CLAIMED, no outcome row exists, and the provider
       * holds one accepted message that ACOS cannot see — which is the state only a
       * provider-side read can distinguish from kill point 2.
       */
      process.exit(KILL_POINT_3_EXIT_CODE);
    }
    return outcome;
  },
};

/*
 * THE NAMED EXPORT ABOVE IS `integrationAdapter`, WHICH IS THE NAME THE HOST REQUIRES.
 *
 * `isIntegrationAdapterModule` admits a module carrying that one named export and refuses a
 * default, so a module that failed to provide it is refused at load rather than partially
 * loaded. The name being the SAME as the real adapter's is what lets a descriptor swap one
 * for the other by changing a module specifier and nothing else.
 */
```

#### `validation/sendgrid/integration/secretSource.ts` (complete)

```typescript
import { readFileSync } from 'node:fs';

import type {
  AdapterSecretSource,
  CredentialIdentityProvenance,
  SecretResolution,
} from '../../../src/integration/runtime/adapterSecretSource.js';

/**
 * THE SENDGRID SEND CREDENTIAL'S SOURCE — `§30`, `50 §2g` FIELD 1.
 *
 * =================================================================================
 * THE IDENTITY THIS SOURCE RETURNS IS THE WHOLE OF S1P's CREDENTIAL-BINDING OBLIGATION
 *
 * `50 §2g` field 1: `credential_id` is "the stable non-secret identity of the EXACT MATERIAL
 * the runtime may present". Never the secret, never its hash, never a token prefix, never an
 * operator-friendly alias.
 *
 * TWO FORMS SATISFY IT AND THIS SOURCE ACCEPTS ONLY THOSE TWO:
 *
 *   `PROVIDER_KEY_ID`             SendGrid's own `api_key_id`, the stable non-secret
 *                                 identifier `GET /v3/api_keys` returns beside each key.
 *                                 `§8.7`'s read-back probe is what establishes that the id
 *                                 written here is the id of the key whose material is in
 *                                 `apiKey` — the provider is the only party that can say so.
 *   `DEPLOYMENT_SECRET_VERSION`   an IMMUTABLE secret-manager version identity for that
 *                                 exact material — a value that changes when the material
 *                                 changes, which is what makes it a binding rather than a
 *                                 pointer.
 *
 * **`SYNTHETIC_TEST_IDENTITY` IS REFUSED BY THIS SOURCE.** The provenance exists in the
 * accepted enum for the S1N/S1O fixtures, and `§3` of the S1P mandate is explicit that a
 * fixture's answer is not a binding: "Do NOT substitute a hash, key prefix, environment
 * variable name, secret alias, or user-entered string." A source that accepted it would be a
 * source through which a live run could proceed on an unbound declaration, so the refusal is
 * here, in the source, rather than in a reviewer's attention.
 *
 * **AND THE SOURCE REFUSES A DERIVED IDENTITY BY VALUE**, not only by provenance label: an
 * identity that contains the key, is contained by it, or is an encoding of it is refused
 * before it is returned. `credentialLabelsAreNonDerived` in the accepted host checks the same
 * property one layer up; doing it here means a derived identity never becomes a resolution
 * at all.
 *
 * =================================================================================
 * `§24` — THE REVOCATION SWITCH IS A STATE OF THE DOCUMENT, NOT A FLAG IN ACOS
 *
 * `revoked: true` returns `CREDENTIAL_REVOKED` **with no material**. There is nothing in hand
 * for a missed check to leak. The document is re-read on EVERY `resolve()`, which is what
 * makes the switch operable without restarting anything and what makes `§25`'s rotation work:
 * replacing the key in the document replaces the credential the next invocation presents,
 * with no control-plane involvement.
 *
 * **THE DOCUMENT IS NOT IN THIS REPOSITORY.** The locator names a path on the deployment
 * host. Nothing in this tree names one, no fixture writes a real key, and `§19` forbids
 * committing one.
 * =================================================================================
 */

interface DeploymentDocument {
  readonly adapterId?: unknown;
  readonly apiKey?: unknown;
  readonly credentialIdentity?: unknown;
  readonly identityProvenance?: unknown;
  readonly version?: unknown;
  readonly revoked?: unknown;
}

/**
 * The provenances a REAL provider credential may declare. `SYNTHETIC_TEST_IDENTITY` is
 * absent, and its absence is the point.
 */
export const LIVE_IDENTITY_PROVENANCES: readonly CredentialIdentityProvenance[] = Object.freeze([
  'PROVIDER_KEY_ID',
  'DEPLOYMENT_SECRET_VERSION',
]);

/** Whether a declared provenance may govern a real provider credential. */
export function isLiveIdentityProvenance(value: unknown): value is CredentialIdentityProvenance {
  return (
    typeof value === 'string' &&
    (LIVE_IDENTITY_PROVENANCES as readonly string[]).includes(value)
  );
}

/**
 * Whether a candidate identity is derived from the material it claims to identify.
 *
 * A SECOND implementation of the accepted host's `credentialLabelsAreNonDerived`, applied
 * BEFORE the resolution is constructed rather than after. Both are kept: the host's is the
 * one that runs on every plane, and this one means a derived identity never leaves this file.
 */
export function identityIsDerivedFromSecret(identity: string, secret: string): boolean {
  if (identity.length === 0 || secret.length === 0) return true;
  if (identity.includes(secret) || secret.includes(identity)) return true;
  if (identity === Buffer.from(secret, 'utf8').toString('hex')) return true;
  if (identity === Buffer.from(secret, 'utf8').toString('base64')) return true;
  return false;
}

class SendGridSecretSource implements AdapterSecretSource {
  public readonly declaredAdapterId: string;

  private readonly locator: string;

  public constructor(adapterId: string, locator: string) {
    this.declaredAdapterId = adapterId;
    this.locator = locator;
  }

  public resolve(): Promise<SecretResolution> {
    let document: DeploymentDocument;
    try {
      document = JSON.parse(readFileSync(this.locator, 'utf8')) as DeploymentDocument;
    } catch {
      return Promise.resolve({ kind: 'UNAVAILABLE' });
    }

    /*
     * `§7`, `23 §7` — THE SOURCE SERVES ONE ADAPTER AND REFUSES THE REST.
     *
     * A document whose `adapterId` is not this source's own is UNAVAILABLE, never a
     * credential for another adapter. `resolve()` takes no selector, so there is no ask this
     * check could be asked to answer differently.
     */
    if (document.adapterId !== this.declaredAdapterId) {
      return Promise.resolve({ kind: 'UNAVAILABLE' });
    }
    if (document.revoked === true) return Promise.resolve({ kind: 'CREDENTIAL_REVOKED' });

    const secret = document.apiKey;
    if (typeof secret !== 'string' || secret.length === 0) {
      return Promise.resolve({ kind: 'UNAVAILABLE' });
    }

    const identity = document.credentialIdentity;
    if (typeof identity !== 'string' || identity.length === 0) {
      // `§10` of the S1O correction: "Null identity is not sufficient for a configured real
      // credential." A source that cannot name what it resolved has not resolved one.
      return Promise.resolve({ kind: 'UNAVAILABLE' });
    }
    if (!isLiveIdentityProvenance(document.identityProvenance)) {
      return Promise.resolve({ kind: 'UNAVAILABLE' });
    }
    if (identityIsDerivedFromSecret(identity, secret)) {
      return Promise.resolve({ kind: 'UNAVAILABLE' });
    }

    return Promise.resolve({
      kind: 'RESOLVED',
      credential: {
        secret,
        credentialIdentity: identity,
        identityProvenance: document.identityProvenance,
        version: typeof document.version === 'string' ? document.version : null,
      },
    });
  }
}

export function createAdapterSecretSource(input: {
  readonly adapterId: string;
  readonly locator: string;
}): AdapterSecretSource {
  return new SendGridSecretSource(input.adapterId, input.locator);
}
```

#### `validation/sendgrid/integration/nonProductionConfig.ts` (complete)

```typescript
import { readFileSync } from 'node:fs';

import { isOwnerControlledSink } from './requestMapping.js';

/**
 * THE NON-SECRET HALF OF THE OPERATOR-PROVISIONED DEPLOYMENT DOCUMENT.
 *
 * =================================================================================
 * ONE DOCUMENT, TWO READERS, AND ONLY ONE OF THEM MAY SEE THE SECRET
 *
 * `secretSource.ts` reads the document for `apiKey`, `credentialIdentity` and
 * `identityProvenance`. THIS module reads the SAME document for the two non-secret values a
 * send needs — the verified sending identity and the owner-controlled sink — and returns a
 * record that HAS NO MEMBER THE KEY COULD OCCUPY.
 *
 * Why one document rather than two: `§30` of the S1N mandate gives the runtime exactly ONE
 * locator (`ACOS_INTEGRATION_SECRET_LOCATOR`) and the eight-key allowlist has no slot for a
 * second path. A second file would need a ninth key, and widening a closed allowlist to carry
 * two email addresses is a poor trade against reading one more field out of a document this
 * runtime already reads.
 *
 * Why it is a SEPARATE MODULE: so `tests/sendgrid/non-production-config.test.ts` can assert
 * that the returned record carries no secret, on a document that contains one. A function
 * that returned the whole document and left the discipline to its callers would be a
 * function whose safety was a convention.
 *
 * **THE DOCUMENT LIVES OUTSIDE THIS REPOSITORY.** `§15`: "Do not tell the operator to paste
 * secrets into documentation, source files, command history, issue trackers, or chat
 * output." The locator names a path the operator chose on the deployment host; nothing in
 * this tree names one, `.gitignore` carries the pattern for the case where an operator picks
 * a path inside the working tree anyway, and no test fixture writes a real key.
 * =================================================================================
 */

/** The non-secret configuration one send needs. NO MEMBER CAN CARRY THE KEY. */
export interface SendGridNonProductionConfig {
  /** The verified non-production sending identity. */
  readonly senderAddress: string;
  /** The OWNER-CONTROLLED sink. `isOwnerControlledSink` has already accepted it. */
  readonly sinkAddress: string;
  /**
   * The non-production environment's own non-secret label — a subuser name or an account
   * nickname — carried into evidence so a reviewer can tell WHICH environment ran.
   *
   * `§16` admits it: "SendGrid non-production environment identifier **if safely
   * non-secret**". A value that is not safely non-secret is one the operator should not put
   * here, and the length bound below is what stops a key being pasted into the slot.
   */
  readonly environmentLabel: string;
}

/** Why the non-secret configuration could not be read. A closed set. */
export const CONFIG_REFUSALS = [
  'CONFIG_UNREADABLE',
  'CONFIG_MALFORMED',
  'SENDER_MISSING',
  'SINK_MISSING',
  'SINK_NOT_OWNER_CONTROLLED',
  'ENVIRONMENT_LABEL_MISSING',
  /** The label is long enough to be a key. Refused rather than redacted. */
  'ENVIRONMENT_LABEL_SUSPICIOUS',
] as const;

export type ConfigRefusal = (typeof CONFIG_REFUSALS)[number];

export type ConfigResult =
  | { readonly kind: 'CONFIG'; readonly config: SendGridNonProductionConfig }
  | { readonly kind: 'REFUSED'; readonly reason: ConfigRefusal };

/**
 * A SendGrid API key is `SG.` followed by two base64url segments and is comfortably over 60
 * characters. An environment label is a subuser name. The bound is deliberately well below
 * a key's length and well above any plausible label.
 */
export const MAX_ENVIRONMENT_LABEL_LENGTH = 48;

/** Parse the non-secret half of a deployment document. PURE over its argument. */
export function parseNonProductionConfig(raw: unknown): ConfigResult {
  if (typeof raw !== 'object' || raw === null) {
    return { kind: 'REFUSED', reason: 'CONFIG_MALFORMED' };
  }
  const document = raw as Record<string, unknown>;

  const sender = document.senderAddress;
  if (typeof sender !== 'string' || sender.length === 0) {
    return { kind: 'REFUSED', reason: 'SENDER_MISSING' };
  }
  const sink = document.sinkAddress;
  if (typeof sink !== 'string' || sink.length === 0) {
    return { kind: 'REFUSED', reason: 'SINK_MISSING' };
  }
  if (!isOwnerControlledSink(sink)) {
    return { kind: 'REFUSED', reason: 'SINK_NOT_OWNER_CONTROLLED' };
  }
  const label = document.environmentLabel;
  if (typeof label !== 'string' || label.length === 0) {
    return { kind: 'REFUSED', reason: 'ENVIRONMENT_LABEL_MISSING' };
  }
  if (label.length > MAX_ENVIRONMENT_LABEL_LENGTH || label.includes('SG.')) {
    return { kind: 'REFUSED', reason: 'ENVIRONMENT_LABEL_SUSPICIOUS' };
  }

  /*
   * THE RETURN IS CONSTRUCTED FIELD BY FIELD, NEVER SPREAD FROM THE DOCUMENT.
   *
   * `{ ...document }` would carry `apiKey` into the result the moment the document had one,
   * and the only thing standing between that and a log line would be every caller's
   * discipline. Three named fields is the structural version of the same rule the child
   * environment follows: constructed, not filtered.
   */
  return {
    kind: 'CONFIG',
    config: Object.freeze({
      senderAddress: sender,
      sinkAddress: sink,
      environmentLabel: label,
    }),
  };
}

/** Read the document the runtime's own locator names. The locator is launch configuration. */
export function readNonProductionConfig(locator: string): ConfigResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(locator, 'utf8')) as unknown;
  } catch {
    return { kind: 'REFUSED', reason: 'CONFIG_UNREADABLE' };
  }
  return parseNonProductionConfig(parsed);
}
```

---

## G. Audit-plane attachment

### G.1 S1O audit child-process launch and confinement

#### `src/audit/provider/runtime/main.ts` (complete)

```typescript
import { isAbsolute, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  ENV_AUDIT_CREDENTIAL_RISK_CLASS,
  ENV_AUDIT_EXPECTED_CREDENTIAL_ID,
  ENV_AUDIT_PROTOCOL_VERSION,
  ENV_AUDIT_PROVIDER_ID,
  ENV_AUDIT_READER_IDENTITY,
  ENV_AUDIT_READER_MODULE,
  ENV_AUDIT_RUNTIME_ROOT,
  ENV_AUDIT_SECRET_LOCATOR,
  ENV_AUDIT_SECRET_SOURCE_MODULE,
} from '../protocol/readerEnvironment.js';
import {
  AUDIT_READER_READY_KIND,
  AUDIT_READ_PROTOCOL_VERSION,
  encodeAuditReadMessage,
  type AuditReaderReady,
} from '../protocol/readWire.js';
import {
  auditProviderReaderIdentity,
  providerIdOfAuditReaderIdentity,
} from '../protocol/readerIdentity.js';
import type { AuditReadSecretSource } from './auditSecretSource.js';
import {
  REQUIRED_AUDIT_CREDENTIAL_RISK_CLASS,
  handleProviderReadRequest,
  type AuditReaderConfiguration,
} from './auditReadHost.js';
import { isAuditProviderReaderModule } from './auditProviderReader.js';
import { emitAuditReadLog } from './auditReadLog.js';

/**
 * THE AUDIT PROVIDER-READ RUNTIME'S ENTRY POINT. THE PROCESS `§14` IS ABOUT.
 *
 * =================================================================================
 * `§14` — A REAL OS PROCESS, AND THE MECHANISM IS THE POINT
 *
 * "Use a genuinely separate audit-side provider-read runtime/process if current architecture
 * requires it. At minimum ensure: **separate OS process / architecture-equivalent trust
 * boundary**; separate credential source; separate environment allowlist; no control send
 * credential; no write capability; no reliance on control adapter result."
 *
 * It does. `I25` is a statement about a PROCESS, and `48 §2` row 13's read-only exemption is
 * a statement about a CREDENTIAL; neither is satisfiable by an object in a process that also
 * holds the other plane's material. This module is executed by `child_process.fork` in a
 * process of its own, with its own PID, heap, module registry, environment and filesystem
 * view, and the only channel between it and its parent is the private descriptor the parent
 * created.
 *
 * **`§30`'s REGRESSION LIST IS PRESERVED BY REUSING S1N's PRIMITIVES, NOT BY COPYING ITS
 * CODE.** `§14`: "Reuse S1N's process-isolation primitives where safe." The primitives
 * reused are the TECHNIQUES — a constructed environment allowlist, a fixed module path, an
 * argument array, a confinement root, `stdio` with no listener — and each is re-implemented
 * against this plane's own constants, because sharing the modules would put the integration
 * plane's protocol into the audit reader's import closure, which is the coupling `§13`
 * forbids one level up.
 *
 * =================================================================================
 * `§16` — NO GENERIC URL REACHES THIS PROCESS, AND NO SEND LEAVES IT
 *
 * The inbound surface is `process.on('message')` on an inherited descriptor, and the only
 * thing it accepts is a `PROVIDER_READ_REQUEST` naming one of three closed operations. The
 * runtime opens **no** TCP port, **no** HTTP listener and **no** named socket, and the
 * reader object it loads is refused at composition if it carries a mutation member.
 *
 * =================================================================================
 * `§14` — AND IT CANNOT READ A CONTROL-PLANE RESULT EVEN IF IT WANTED TO
 *
 * "Do not make audit verification depend on a control-plane `verified=true`."
 *
 * The child environment carries nine keys and not one of them is a control-plane variable;
 * there is no `ACOS_CONTROL_PG_URL`, so no control database is reachable; and the wire
 * protocol has no member a control verdict could occupy. The independence is structural in
 * the same sense `30 §5.4` means: the declared inputs contain no control-plane read.
 * =================================================================================
 */

/** A startup failure. Written to `stderr` as a closed code and never as a stack. */
export const AUDIT_STARTUP_FAILURES = [
  'ENV_MISSING',
  'ENV_PROTOCOL_MISMATCH',
  'ENV_IDENTITY_MISMATCH',
  'MODULE_OUTSIDE_RUNTIME_ROOT',
  'READER_MODULE_INVALID',
  'SECRET_SOURCE_MODULE_INVALID',
  'PROVIDER_IDENTITY_MISMATCH',
  /** `§13`: the audit plane's credential must be incapable of external mutation. */
  'CREDENTIAL_NOT_READ_ONLY',
] as const;

export type AuditStartupFailure = (typeof AUDIT_STARTUP_FAILURES)[number];

export class AuditReaderStartupError extends Error {
  public readonly failure: AuditStartupFailure;

  public constructor(failure: AuditStartupFailure) {
    // THE MESSAGE IS THE CODE. A startup error printing the specifier it refused would print
    // a filesystem path, and a path is one of the things an audit failure must not teach.
    super(failure);
    this.failure = failure;
    this.name = 'AuditReaderStartupError';
  }
}

function readEnv(key: string): string {
  const value = process.env[key];
  if (value === undefined || value.length === 0) {
    throw new AuditReaderStartupError('ENV_MISSING');
  }
  return value;
}

/**
 * `29 §3.5`'s confinement check, applied to the audit plane's own reader package.
 *
 * A specifier must resolve to an absolute path inside the runtime root. Deliberately a
 * SECOND implementation of the same containment test `integration/runtime/main.ts` holds:
 * importing that one would put the integration plane's entry point into this process's
 * module graph, which is the one thing this file exists to avoid.
 */
export function isInsideAuditRuntimeRoot(runtimeRoot: string, specifier: string): boolean {
  if (!isAbsolute(specifier)) return false;
  const root = resolve(runtimeRoot);
  const target = resolve(specifier);
  if (target === root) return false;
  const rel = relative(root, target);
  return rel.length > 0 && !rel.startsWith('..') && !isAbsolute(rel);
}

/**
 * What a secret-source module must export: a FACTORY taking the locator, not an instance.
 *
 * A factory rather than a ready-made source because the locator is per runtime and the
 * source must be SCOPED to this runtime's provider at construction —
 * `auditSecretSource.ts` explains why a source with a selector signature is not a boundary.
 */
export interface AuditSecretSourceModule {
  readonly createAuditReadSecretSource: (input: {
    readonly providerId: string;
    readonly locator: string;
  }) => AuditReadSecretSource;
}

function isAuditSecretSourceModule(value: unknown): value is AuditSecretSourceModule {
  if (typeof value !== 'object' || value === null) return false;
  return (
    typeof (value as { createAuditReadSecretSource?: unknown }).createAuditReadSecretSource ===
    'function'
  );
}

/**
 * Compose this reader from its launch environment. NO REQUEST HAS BEEN READ AT THIS POINT.
 *
 * Exported so the focused suite can compose a reader in-process and assert the refusals
 * without forking — the fork is proved separately, by PID, and the two properties are
 * independent.
 */
export async function composeAuditReader(): Promise<{
  readonly configuration: AuditReaderConfiguration;
  readonly readerIdentity: string;
}> {
  if (readEnv(ENV_AUDIT_PROTOCOL_VERSION) !== AUDIT_READ_PROTOCOL_VERSION) {
    throw new AuditReaderStartupError('ENV_PROTOCOL_MISMATCH');
  }
  const providerId = readEnv(ENV_AUDIT_PROVIDER_ID);
  const readerIdentity = readEnv(ENV_AUDIT_READER_IDENTITY);
  if (providerIdOfAuditReaderIdentity(readerIdentity) !== providerId) {
    throw new AuditReaderStartupError('ENV_IDENTITY_MISMATCH');
  }
  // Recomputed rather than trusted: the identity in the environment must be the identity
  // this repository's own producer would mint for this provider id, and not merely one that
  // parses back to it.
  if (auditProviderReaderIdentity(providerId) !== readerIdentity) {
    throw new AuditReaderStartupError('ENV_IDENTITY_MISMATCH');
  }

  // ---------------------------------------------------------------------------------
  // `§13` — THE CREDENTIAL MUST BE READ-ONLY, AND THE CHECK IS BEFORE ANY MODULE LOADS.
  //
  // The value is the parent's ECHO of the SIGNED class-5 record (`50 §2g` field 6); the
  // parent read the verified bundle and refused to fork a reader whose record said anything
  // else. This check runs here anyway, first, because a reader that has already imported a
  // provider module and resolved a locator is a reader that has done work on behalf of a
  // credential nobody established was safe.
  //
  // IT CANNOT WIDEN. The only value that admits a start is `READ_ONLY`, so an echo that
  // disagreed with the bundle in the permissive direction would need the PARENT to have
  // produced it — and the parent's own check already refused that case.
  // ---------------------------------------------------------------------------------
  const credentialRiskClass = readEnv(ENV_AUDIT_CREDENTIAL_RISK_CLASS);
  if (credentialRiskClass !== REQUIRED_AUDIT_CREDENTIAL_RISK_CLASS) {
    throw new AuditReaderStartupError('CREDENTIAL_NOT_READ_ONLY');
  }

  const runtimeRoot = readEnv(ENV_AUDIT_RUNTIME_ROOT);
  const readerModule = readEnv(ENV_AUDIT_READER_MODULE);
  const secretSourceModule = readEnv(ENV_AUDIT_SECRET_SOURCE_MODULE);
  const secretLocator = readEnv(ENV_AUDIT_SECRET_LOCATOR);
  /*
   * `50 §2g` FIELD 1's ECHO. ABSENT REFUSES TO START.
   *
   * `readEnv` refuses an absent or empty value, so there is no launch path that produces a
   * reader with nothing to compare its resolved credential against. The comparison itself is
   * guard 7 in `auditReadHost.ts`, because the material is resolved per read.
   */
  const expectedCredentialId = readEnv(ENV_AUDIT_EXPECTED_CREDENTIAL_ID);

  for (const specifier of [readerModule, secretSourceModule]) {
    if (!isInsideAuditRuntimeRoot(runtimeRoot, specifier)) {
      throw new AuditReaderStartupError('MODULE_OUTSIDE_RUNTIME_ROOT');
    }
  }

  /*
   * THE ONLY DYNAMIC IMPORT IN THIS PACKAGE, AND IT IS DELIBERATE.
   *
   * `§27` forbids a real provider call and there is none: what this process loads is
   * whatever its TRUSTED LAUNCH CONFIGURATION declared, confined to its own runtime root —
   * in S1O a synthetic reader under `tests/audit-plane/`, and in a later slice a real
   * provider-read package.
   *
   * A STATIC IMPORT COULD NOT DO THIS JOB. Each reader runtime must load ITS OWN provider
   * client and no other; a static import list here would put every provider's module into
   * every reader's module graph, which is the per-credential dependency isolation `23 §7`
   * and `29 §3.5` require.
   */
  const loadedReader: unknown = await import(pathToFileURL(resolve(readerModule)).href);
  if (!isAuditProviderReaderModule(loadedReader)) {
    // This is also where a reader carrying a SEND member is refused, because
    // `isAuditProviderReaderModule` delegates to `isAuditProviderReader`, which refuses one.
    throw new AuditReaderStartupError('READER_MODULE_INVALID');
  }
  const reader = loadedReader.auditProviderReader;
  if (reader.providerId !== providerId) {
    throw new AuditReaderStartupError('PROVIDER_IDENTITY_MISMATCH');
  }

  const loadedSource: unknown = await import(pathToFileURL(resolve(secretSourceModule)).href);
  if (!isAuditSecretSourceModule(loadedSource)) {
    throw new AuditReaderStartupError('SECRET_SOURCE_MODULE_INVALID');
  }
  const secretSource = loadedSource.createAuditReadSecretSource({
    providerId,
    locator: secretLocator,
  });
  if (secretSource.declaredProviderId !== providerId) {
    throw new AuditReaderStartupError('PROVIDER_IDENTITY_MISMATCH');
  }

  return {
    configuration: Object.freeze({
      providerId,
      reader,
      secretSource,
      credentialRiskClass,
      expectedCredentialId,
    }),
    readerIdentity,
  };
}

/**
 * The process's message loop. ONE inbound channel, ONE reply per request, NO queue of its own.
 *
 * What this side guarantees is that it reads one message, answers it, and holds nothing:
 * there is no buffer, no retry, no pending map and no record of the last request, so a
 * restarted reader has nothing to replay even if something asked it to. A read is
 * idempotent at the provider by construction — it is a query — but a reader that
 * remembered its last query would be a reader whose restart could re-issue a read against a
 * credential that had since been revoked.
 */
async function run(): Promise<void> {
  const { configuration, readerIdentity } = await composeAuditReader();

  emitAuditReadLog({
    event: 'READER_STARTED',
    readerIdentity,
    providerId: configuration.providerId,
    readId: null,
    operation: null,
    periodStartMs: null,
    periodEndMs: null,
    correlationTag: null,
    recordCount: null,
    resultClass: null,
  });

  process.on('message', (raw: unknown) => {
    void (async (): Promise<void> => {
      const reply = await handleProviderReadRequest(configuration, raw);
      emitAuditReadLog({
        event: reply.kind === 'PROVIDER_READ_REFUSED' ? 'READ_REQUEST_REFUSED' : 'READ_COMPLETED',
        readerIdentity,
        providerId: configuration.providerId,
        readId: reply.readId.length > 0 ? reply.readId : null,
        operation: reply.kind === 'PROVIDER_READ_RESPONSE' ? reply.operation : null,
        periodStartMs: null,
        periodEndMs: null,
        // A REFUSED read has no established correlation tag to record, and recording an
        // unvalidated one beside a provider identity is how a log becomes a false trail.
        correlationTag: null,
        recordCount: reply.kind === 'PROVIDER_READ_RESPONSE' ? reply.recordCount : null,
        resultClass: reply.kind === 'PROVIDER_READ_REFUSED' ? reply.reason : 'EVIDENCE',
      });
      const encoded = encodeAuditReadMessage(reply);
      // A reply that does not encode within the bound is DROPPED rather than truncated. The
      // parent's deadline resolves it as unavailable, which is the honest answer: the read
      // ran and the audit plane did not learn what the provider said.
      if (encoded !== null) process.send?.(encoded);
    })();
  });

  const ready: AuditReaderReady = {
    protocolVersion: AUDIT_READ_PROTOCOL_VERSION,
    kind: AUDIT_READER_READY_KIND,
    readerIdentity,
    providerId: configuration.providerId,
    pid: process.pid,
    /*
     * `§17` — THE KEYS OF THIS PROCESS'S OWN ENVIRONMENT. KEYS ONLY.
     *
     * `Object.keys`, never `process.env` itself: a value has no route onto this message,
     * because the member's type is `readonly string[]` and the parent's decoder refuses any
     * element that is not a bare environment-variable identifier.
     *
     * It is the CHILD that reports this rather than the parent asserting what it passed,
     * because what the parent passed is the thing under test and is therefore not evidence
     * about itself. This is the message that proves the audit reader holds neither the
     * integration plane's secret nor the audit database's credential.
     */
    environmentKeys: Object.keys(process.env).sort(),
    declaredCredentialRiskClass: configuration.credentialRiskClass,
  };
  const encodedReady = encodeAuditReadMessage(ready);
  if (encodedReady !== null) process.send?.(encodedReady);
}

/*
 * =================================================================================
 * THE MODULE IS BOTH A LIBRARY AND AN EXECUTABLE, AND THE DISCRIMINATOR IS THE LAUNCH
 * CONTRACT RATHER THAN `process.send`.
 *
 * `process.send` is defined in ANY forked child — including a Vitest worker — so gating on
 * it alone would start an audit reader inside the test runner the moment a test imported
 * this module for one of its exported functions, and that reader would then fail its own
 * environment check and call `process.exit`. `integration/runtime/main.ts` found exactly
 * that, and the same gate is applied here against THIS plane's own identity variable.
 * =================================================================================
 */
if (process.send !== undefined && process.env[ENV_AUDIT_READER_IDENTITY] !== undefined) {
  void run().catch((error: unknown) => {
    const failure =
      error instanceof AuditReaderStartupError ? error.failure : 'READER_MODULE_INVALID';
    process.stderr.write(`${JSON.stringify({ event: 'READER_START_FAILED', failure })}\n`);
    process.exit(1);
  });
}
```

### G.2 The audit host's guards — class-5 risk class, credential identity, read dispatch

#### `src/audit/provider/runtime/auditReadHost.ts` (complete)

```typescript
import {
  AUDIT_READ_PROTOCOL_VERSION,
  PROVIDER_READ_REFUSED_KIND,
  PROVIDER_READ_RESPONSE_KIND,
  decodeProviderReadRequest,
  type ProviderReadRefused,
  type ProviderReadRefusal,
  type ProviderReadRequest,
  type ProviderReadResponse,
} from '../protocol/readWire.js';
import {
  auditCredentialIdentityMismatch,
  auditCredentialLabelsAreNonDerived,
  type AuditReadSecretSource,
} from './auditSecretSource.js';
import {
  isAuditProviderReader,
  type AuditProviderReader,
} from './auditProviderReader.js';

/**
 * THE AUDIT READER'S REQUEST HANDLER. Z4's SIDE OF THE PROVIDER-READ PERIMETER.
 *
 * =================================================================================
 * `§13`, `§14` — WHAT RUNS HERE AND WHY IT IS ITS OWN PROCESS
 *
 * `§13`: "The audit plane must use **AN INDEPENDENT PROVIDER READ CREDENTIAL INCAPABLE OF
 * EXTERNAL MUTATION.** Do not put audit credentials into: control process; control
 * integration adapter runtime; same secret source as send credential."
 *
 * `§14`: "separate OS process / architecture-equivalent trust boundary; separate credential
 * source; separate environment allowlist; **no control send credential**; **no write
 * capability**; **no reliance on control adapter result**."
 *
 * The audit read credential is resolved HERE, in a process the audit plane spawned, from a
 * source the control plane does not import and the integration runtime cannot construct, and
 * it never leaves this process: `ProviderReadResponse` carries `credentialIdentity` — the
 * source's own non-secret label — and has no member the material could occupy.
 *
 * =================================================================================
 * THE GUARD ORDER IS THE SECURITY PROPERTY
 *
 * Every refusal below happens STRICTLY BEFORE the provider reader is reached:
 *
 *     1. decode                     closed read-only schema; unknown operation REFUSED
 *     2. provider identity          this reader serves exactly one provider
 *     3. reader shape               no mutation member, checked at runtime not by type
 *     4. credential risk class      the SIGNED class-5 value must be `READ_ONLY`
 *     5. credential resolution      revoked or unavailable refuses here
 *     6. label non-derivation       a source publishing its own secret as a label refuses
 *     7. credential IDENTITY        the resolved material IS the signed audit credential
 *     8. provider read              the FIRST line that reaches a provider boundary
 *
 * Step 8 is the only call site of `readFromProvider` in this file and is unreachable until
 * 1..7 have all passed, because each is an early return rather than a flag.
 * `unsafeHandleProviderReadRequest` in the negative-control suite removes steps 3 and 4 and
 * reaches the reader, and `unsafeHandleWithoutAuditIdentityBinding` removes step 7 — which
 * is the discrimination for the v1.3.7 correction.
 *
 * =================================================================================
 * `§14` AGAIN — AND NOTHING HERE READS A CONTROL-PLANE RESULT
 *
 * "Do not make audit verification depend on a control-plane `verified=true`."
 *
 * This module imports no control-plane module, reads no control database, receives no
 * control-plane verdict on the wire and produces no `verified` field. What it produces is
 * what the PROVIDER answered, verbatim and unmapped — `providerStatus` is the provider's own
 * word — and the audit plane forms its own comparison from that. `independentFinding.ts` is
 * where the comparison lives, and it takes provider evidence and an expectation the AUDIT
 * plane derived, never a control-plane belief.
 * =================================================================================
 */

export type AuditHostReply = ProviderReadResponse | ProviderReadRefused;

function refuse(readId: string | null, reason: ProviderReadRefusal): ProviderReadRefused {
  return Object.freeze({
    protocolVersion: AUDIT_READ_PROTOCOL_VERSION,
    kind: PROVIDER_READ_REFUSED_KIND,
    // A refusal raised before the request decoded has no read id to echo, and inventing one
    // would put a value the parent never sent into the parent's own correlation.
    readId: readId ?? '',
    reason,
  });
}

/**
 * The reader's own configuration. Built once, at process start, from the child environment.
 *
 * There is no member a REQUEST can influence. The message carries work; the launch carries
 * capability.
 */
export interface AuditReaderConfiguration {
  /** The ONE provider identity this reader serves. */
  readonly providerId: string;
  readonly reader: AuditProviderReader;
  readonly secretSource: AuditReadSecretSource;
  /**
   * `50 §2g` field 6, AS THE AUDIT PLANE'S PARENT READ IT OUT OF THE VERIFIED BUNDLE.
   *
   * Carried into this process so guard 4 can refuse locally, and NOT trusted as the
   * authority: the authority is the signed class-5 record, the parent checked it before
   * forking, and this value is an echo the parent alone produced. A child whose echo is
   * anything but `READ_ONLY` refuses every read, which is the fail-closed direction — the
   * echo can only narrow, never widen.
   */
  readonly credentialRiskClass: string;
  /**
   * `50 §2g` FIELD 1, AS THE AUDIT PLANE'S OWN VERIFIER READ IT.
   *
   * The risk-class echo above answers "what class does the signed record declare?". This one
   * answers "which credential is that record about?", and only the second question can catch
   * a reader holding a send-capable token under a genuinely `READ_ONLY` declaration.
   *
   * **THE PARENT CANNOT PERFORM THIS COMPARISON EITHER.** The audit plane's own process does
   * not hold the read credential — that is the whole point of forking this one — so the
   * identity of the resolved material is visible only here.
   */
  readonly expectedCredentialId: string;
}

/**
 * `§13`'s decisive property, as the one string this module compares against.
 *
 * `50 §2g`: `READ_ONLY` means "every reachable provider permission is a read or a query; the
 * credential performs no external mutation of any kind". `48 §3.6`'s exemption rests on
 * exactly that, and `NON_MONETARY_WRITE` — which is what a send credential is — does not
 * earn it.
 */
export const REQUIRED_AUDIT_CREDENTIAL_RISK_CLASS = 'READ_ONLY';

export async function handleProviderReadRequest(
  configuration: AuditReaderConfiguration,
  raw: unknown,
): Promise<AuditHostReply> {
  // ---------------------------------------------------------------------------------
  // GUARD 1 — THE CLOSED READ-ONLY SCHEMA. `§16`: "Unknown operation: REFUSED."
  // ---------------------------------------------------------------------------------
  const decoded = decodeProviderReadRequest(raw);
  if (decoded.kind === 'REFUSED') return refuse(null, decoded.reason);
  const request: ProviderReadRequest = decoded.message;

  // ---------------------------------------------------------------------------------
  // GUARD 2 — PROVIDER IDENTITY. One credential scope, one reader runtime.
  //
  // Three operands rather than one: the request's, the configured reader's, and the secret
  // source's. A reader wired to provider A holding provider B's source is a mis-wiring that
  // would otherwise present the wrong credential at the right boundary.
  // ---------------------------------------------------------------------------------
  if (
    request.providerId !== configuration.providerId ||
    configuration.reader.providerId !== configuration.providerId ||
    configuration.secretSource.declaredProviderId !== configuration.providerId
  ) {
    return refuse(request.readId, 'PROVIDER_IDENTITY_MISMATCH');
  }

  // ---------------------------------------------------------------------------------
  // GUARD 3 — THE READER CANNOT MUTATE. `§16`: "No send operation."
  //
  // Checked AT RUNTIME rather than left to the type, because TypeScript's structural typing
  // admits extra members: an object with `readFromProvider` AND `send` satisfies
  // `AuditProviderReader` at compile time. `isAuditProviderReader` refuses it here, before
  // any credential is resolved, so a mutation-capable reader never sees material.
  // ---------------------------------------------------------------------------------
  if (!isAuditProviderReader(configuration.reader)) {
    return refuse(request.readId, 'CREDENTIAL_NOT_READ_ONLY');
  }

  // ---------------------------------------------------------------------------------
  // GUARD 4 — THE SIGNED CLASS-5 RISK CLASS. `50 §2g` field 6, `48 §3.6`.
  //
  // A reader whose credential is not declared `READ_ONLY` refuses every read. The value is
  // the parent's echo of the verified bundle (see `credentialRiskClass` above); the parent
  // is the authority and already refused to fork a reader whose bundle record said anything
  // else, so this guard is defence in depth against a launch path the parent did not take.
  // ---------------------------------------------------------------------------------
  if (configuration.credentialRiskClass !== REQUIRED_AUDIT_CREDENTIAL_RISK_CLASS) {
    return refuse(request.readId, 'CREDENTIAL_NOT_READ_ONLY');
  }

  // ---------------------------------------------------------------------------------
  // GUARD 5 — CREDENTIAL RESOLUTION. Revocation is the SOURCE's answer, not a flag here.
  // ---------------------------------------------------------------------------------
  const resolution = await configuration.secretSource.resolve();
  if (resolution.kind !== 'RESOLVED') {
    return refuse(request.readId, 'CREDENTIAL_UNAVAILABLE');
  }

  // ---------------------------------------------------------------------------------
  // GUARD 6 — THE LABELS ARE NOT THE SECRET.
  //
  // `credentialIdentity` travels back to the audit plane on every response, so a source that
  // set its label to its own token would publish the credential on the wire. The refusal is
  // `CREDENTIAL_UNAVAILABLE` rather than a new code, deliberately: a source that cannot
  // describe its credential safely has not supplied a usable one.
  // ---------------------------------------------------------------------------------
  if (!auditCredentialLabelsAreNonDerived(resolution.credential)) {
    return refuse(request.readId, 'CREDENTIAL_UNAVAILABLE');
  }

  // ---------------------------------------------------------------------------------
  // GUARD 7 — `50 §2g` FIELD 1. **THE RESOLVED CREDENTIAL IS THE SIGNED AUDIT CREDENTIAL.**
  //
  // The attack this refuses passes every check above it:
  //
  //     signed record   `synthetic_esp.audit_read`, audit_plane-scoped, READ_ONLY   ok
  //     risk echo       READ_ONLY                                                   ok
  //     locator         not one the integration plane holds                         ok
  //     resolved token  SEND-CAPABLE                                                NO
  //
  // `48 §3.6`'s exemption rests on the reader's credential being incapable of external
  // mutation. Without this guard it rests on a declaration about a DIFFERENT credential, and
  // the audit plane would be querying — and could be sending — with material nobody
  // classified.
  //
  // **AND IT IS NOT A LOCATOR COMPARISON.** `auditReaderRegistry` already refuses a locator
  // the integration plane holds, and that check cannot decide this one: two locators may
  // name one credential, and one locator may be repointed at another. Both controls are
  // kept because they answer different questions.
  //
  // IT RUNS BEFORE `readFromProvider`, so no provider query is made with the wrong material.
  // ---------------------------------------------------------------------------------
  if (
    auditCredentialIdentityMismatch(
      configuration.expectedCredentialId,
      resolution.credential.credentialIdentity,
    ) !== null
  ) {
    // The reason is not returned to the parent: a refusal teaches a closed code and nothing
    // else, and a message naming both identities would publish the audit plane's credential
    // topology to any caller that could provoke a mismatch.
    return refuse(request.readId, 'CREDENTIAL_IDENTITY_MISMATCH');
  }

  // ---------------------------------------------------------------------------------
  // GUARD 8 — THE PROVIDER READ. THE ONLY CALL SITE, AND THE FIRST LINE THAT REACHES OUT.
  // ---------------------------------------------------------------------------------
  const result = await configuration.reader.readFromProvider(resolution.credential, {
    operation: request.operation,
    periodStartMs: request.periodStartMs,
    periodEndMs: request.periodEndMs,
    correlationTag: request.correlationTag,
    providerMessageId: request.providerMessageId,
    maxRecords: request.maxRecords,
  });

  if (result.kind === 'PROVIDER_UNAVAILABLE') {
    return refuse(request.readId, 'PROVIDER_UNAVAILABLE');
  }

  // A reader that returned more than the request bounded is a reader that did not honour the
  // bound, and truncating here would hide it. The refusal is the honest answer: the audit
  // plane learns that the read did not happen as asked rather than receiving a silently
  // shortened page it would then treat as complete evidence.
  if (result.records.length > request.maxRecords) {
    return refuse(request.readId, 'RECORD_BOUND_EXCEEDED');
  }

  return Object.freeze({
    protocolVersion: AUDIT_READ_PROTOCOL_VERSION,
    kind: PROVIDER_READ_RESPONSE_KIND,
    readId: request.readId,
    operation: request.operation,
    records: result.records,
    recordCount: result.recordCount,
    // The SOURCE's declared label, never a digest of the material — guard 6 already refused
    // a label derived from it.
    credentialIdentity: resolution.credential.credentialIdentity,
    providerQueriedAtMs: Date.now(),
  });
}
```

### G.3 The audit IPC schema — three operations, and no member a destination could occupy

#### `src/audit/provider/protocol/readWire.ts` (complete)

```typescript
/**
 * THE ACOS AUDIT PROVIDER-READ PROTOCOL. A CLOSED READ-ONLY SCHEMA, AND NOT AN HTTP CLIENT.
 *
 * =================================================================================
 * `§16` OF THE S1O MANDATE, VERBATIM
 *
 *   "Closed read-only request protocol. Permit only declared provider-read operations needed
 *    for audit/reconciliation. **No generic URL. No send operation. No credential crosses
 *    IPC.** Unknown operation: **REFUSED.**"
 *
 * Four sentences, four mechanisms, and each is structural rather than a check:
 *
 *   no generic URL        there is no `url`, `path`, `endpoint`, `host`, `origin`, `query`,
 *                         `headers` or `body` member on `ProviderReadRequest`, and nothing
 *                         in this file constructs a `URL`. The request names an OPERATION
 *                         from a closed enum and carries that operation's own typed
 *                         arguments. A caller cannot express a destination because the
 *                         schema has no room for one.
 *   no send operation     `PROVIDER_READ_OPERATIONS` is a hand-authored closed list of
 *                         three, every one a query, and the reply type has no member an
 *                         acknowledgement of a send could occupy.
 *                         `tests/integration/audit/audit-read-protocol.test.ts` asserts the
 *                         list against a second hand-authored copy, so a fourth member has
 *                         to be added in two places by someone who read this paragraph.
 *   no credential crosses `ProviderReadRequest` has no `token`, `apiKey`, `authorization`,
 *                         `credential` or `headers` member, and `ProviderReadResponse`
 *                         carries `credentialIdentity` — a non-secret label the SOURCE
 *                         declares — and no member the material could occupy.
 *   unknown is REFUSED    `decodeProviderReadRequest` returns a refusal for an operation
 *                         outside the closed list, for an unknown field, and for an argument
 *                         shape the operation does not declare. An unknown field is a
 *                         REFUSAL rather than an ignored key, because a protocol that
 *                         ignores what it does not understand is a protocol whose next
 *                         version is an injection surface.
 *
 * =================================================================================
 * WHY THIS IS A SECOND PROTOCOL AND NOT A MODE OF `integration/protocol/wire.ts`
 *
 * `§13`: "Do not put audit credentials into: control process; **control integration adapter
 * runtime**; same secret source as send credential."
 *
 * A shared protocol module is a shared import closure. `29 §3.5` requires "**per-adapter**
 * runtime, filesystem and dependency isolation — not merely per-plane", and `23 §7` scopes
 * isolation per credential; a `DispatchRequest` type that could be narrowed into a read
 * request would mean the audit reader's process graph contained the sender's schema and the
 * sender's refusal vocabulary, and one day a `kind` field would decide which half ran.
 *
 * **THE TWO PROTOCOLS SHARE NO MODULE, NO TYPE AND NO CONSTANT**, and
 * `tests/integration/audit/audit-plane-packaging.test.ts` asserts the import closures are
 * disjoint. The cost is a second decoder; the benefit is that there is no expression in
 * either protocol that names the other plane's operation.
 *
 * =================================================================================
 * `§14` — AND NOTHING HERE CARRIES A CONTROL-PLANE VERDICT
 *
 * "Do not make audit verification depend on a control-plane `verified=true`."
 *
 * So `ProviderReadRequest` has no `expectedOutcome`, no `controlVerified`, no `effectId`, no
 * `outboxId` and no `authorisationRef`. The audit plane asks the provider what it holds for
 * a CORRELATION TAG over a PERIOD, and forms its own answer. `48`'s v1.3 note is the rule
 * being implemented: the inverse-sweep reads are "**period-bounded and never parameterised
 * by an ACOS-side identifier or tag set**" — so the period is mandatory on every operation,
 * and the correlation tag narrows a period-bounded result rather than replacing it.
 * =================================================================================
 */

import { createHash } from 'node:crypto';

/** The protocol version, restated into the child so a mismatched pair cannot start. */
export const AUDIT_READ_PROTOCOL_VERSION = 'acos.audit.provider-read.v1';

/**
 * `§16`'s message bound. 256 KiB, the same figure the integration protocol uses, and chosen
 * for the same reason: large enough for a page of provider evidence, small enough that a
 * wedged reader cannot allocate the parent's heap one message at a time.
 */
export const MAX_AUDIT_IPC_MESSAGE_BYTES = 262_144;

export const PROVIDER_READ_REQUEST_KIND = 'PROVIDER_READ_REQUEST';
export const PROVIDER_READ_RESPONSE_KIND = 'PROVIDER_READ_RESPONSE';
export const PROVIDER_READ_REFUSED_KIND = 'PROVIDER_READ_REFUSED';
export const AUDIT_READER_READY_KIND = 'AUDIT_READER_READY';

/**
 * `§16`'s CLOSED OPERATION SET. THREE MEMBERS, EVERY ONE A QUERY.
 *
 * "Permit only declared provider-read operations needed for audit/reconciliation."
 *
 *   `MESSAGE_ACTIVITY_SEARCH`  the period-bounded activity query. `I20`'s "provider-reported
 *                              accepted" and `I8`'s inverse sweep both read this.
 *   `MESSAGE_ACTIVITY_DETAIL`  one provider record by the PROVIDER's own message id, for
 *                              `I36`'s acceptance oracle.
 *   `MESSAGE_ACTIVITY_COUNT`   the count alone, for a sweep that needs a total and must not
 *                              pull a page of recipient data to get one. `30 §5.10`'s scrub
 *                              posture: the narrowest read that answers the question.
 *
 * **THERE IS NO `SEND`, NO `CREATE`, NO `UPDATE`, NO `DELETE`, NO `SUBSCRIBE` AND NO
 * `EXECUTE`.** And there is no generic member — no `RAW`, no `PASSTHROUGH`, no `CUSTOM` —
 * because `§18` of the S1N mandate's rule applies here unchanged: a broad member is an
 * exemption nobody reviewed, wearing the name of a feature.
 */
export const PROVIDER_READ_OPERATIONS = [
  'MESSAGE_ACTIVITY_SEARCH',
  'MESSAGE_ACTIVITY_DETAIL',
  'MESSAGE_ACTIVITY_COUNT',
] as const;

export type ProviderReadOperation = (typeof PROVIDER_READ_OPERATIONS)[number];

export function isProviderReadOperation(value: unknown): value is ProviderReadOperation {
  return (
    typeof value === 'string' &&
    (PROVIDER_READ_OPERATIONS as readonly string[]).includes(value)
  );
}

/**
 * The closed field list of a read request. ASSERTED AGAINST A SECOND HAND-AUTHORED COPY.
 *
 * Note what is absent and could not be added without editing this list, the interface, the
 * decoder and the boundary test: every one of `url`, `path`, `endpoint`, `host`, `origin`,
 * `method`, `headers`, `body`, `query`, `token`, `apiKey`, `authorization`, `credential`.
 */
export const PROVIDER_READ_REQUEST_FIELDS = [
  'protocolVersion',
  'kind',
  'readId',
  'operation',
  'providerId',
  /** `48`'s v1.3 note: the read is PERIOD-BOUNDED. Both bounds are required. */
  'periodStartMs',
  'periodEndMs',
  /** Narrows a period-bounded result. Never replaces the period. May be `null`. */
  'correlationTag',
  /** The PROVIDER's own message id, for `MESSAGE_ACTIVITY_DETAIL`. May be `null`. */
  'providerMessageId',
  /** A page bound the READER enforces. Never a caller-chosen page size at the provider. */
  'maxRecords',
] as const;

export type ProviderReadRequestField = (typeof PROVIDER_READ_REQUEST_FIELDS)[number];

export interface ProviderReadRequest {
  readonly protocolVersion: typeof AUDIT_READ_PROTOCOL_VERSION;
  readonly kind: typeof PROVIDER_READ_REQUEST_KIND;
  /** Transport observability. `§27` of S1N: it replaces no identity and grants no authority. */
  readonly readId: string;
  readonly operation: ProviderReadOperation;
  readonly providerId: string;
  readonly periodStartMs: number;
  readonly periodEndMs: number;
  readonly correlationTag: string | null;
  readonly providerMessageId: string | null;
  readonly maxRecords: number;
}

/** `§16`'s bound on how much evidence one read may return. */
export const MAX_RECORDS_PER_READ = 500;

/** The longest period one read may span. A sweep asks repeatedly rather than unboundedly. */
export const MAX_READ_PERIOD_MS = 31 * 24 * 60 * 60 * 1000;

/**
 * ONE provider evidence record. NON-SECRET, AND NARROW BY CONSTRUCTION.
 *
 * `30 §5.10`'s scrub posture and `§17`'s leak matrix both apply: there is no member a
 * credential could occupy, and no member a recipient address could occupy either. What the
 * audit plane needs from the provider is whether the provider ACCEPTED something carrying
 * this correlation tag, when, and under which provider-side identity — not who received it.
 */
export interface ProviderEvidenceRecord {
  /** The PROVIDER's own message identity. Evidence, never an ACOS identity. */
  readonly providerMessageId: string;
  /** The provider's own status word, verbatim and unmapped. */
  readonly providerStatus: string;
  /** The provider's own timestamp, in epoch milliseconds. */
  readonly providerTimestampMs: number;
  /** The ACOS correlation tag the provider echoed back, or `null` if it carried none. */
  readonly correlationTag: string | null;
}

/**
 * Why a read did not produce evidence. A CLOSED set, and every member is a REFUSAL SHAPE
 * rather than an exception with a message.
 *
 * `§23` of the S1N mandate's rule carries over: an audit failure must not teach the caller a
 * filesystem path, a module specifier, a credential label or a provider URL. So a refusal is
 * a code, and the code is the whole message.
 */
export const PROVIDER_READ_REFUSALS = [
  'PROTOCOL_VERSION_MISMATCH',
  'MALFORMED_MESSAGE',
  'UNKNOWN_FIELD',
  /** `§16`: "Unknown operation: REFUSED." */
  'UNKNOWN_OPERATION',
  /** The operation's own declared arguments were not supplied, or were supplied wrongly. */
  'OPERATION_ARGUMENTS_INVALID',
  /** `48`'s v1.3 note: an unbounded or inverted period is not a period-bounded read. */
  'PERIOD_BOUND_INVALID',
  'RECORD_BOUND_EXCEEDED',
  /** This reader serves one provider; the request named another. */
  'PROVIDER_IDENTITY_MISMATCH',
  /** The read-only credential is revoked or unprovisioned. */
  'CREDENTIAL_UNAVAILABLE',
  /**
   * The configured credential's SIGNED class-5 record is not `READ_ONLY`.
   *
   * `48 §3.6`, `50 §2g` field 6. A reader that started with a mutation-capable credential
   * would be an audit plane holding a send capability, and `§13` forbids exactly that. The
   * check runs at composition, so this refusal is unreachable in a correctly wired runtime
   * and exists so a wiring mistake produces a code rather than a silent capability.
   */
  'CREDENTIAL_NOT_READ_ONLY',
  /**
   * `50 §2g` FIELD 1 — THE RESOLVED MATERIAL IS NOT THE CREDENTIAL THE SIGNED RECORD GOVERNS.
   *
   * `CREDENTIAL_NOT_READ_ONLY` answers "is the declared class right for an audit reader?".
   * This one answers "is the declaration about the credential in this reader's hand?", and
   * the second question is the one a genuinely `READ_ONLY` signed record cannot settle: a
   * reader whose locator resolves a send-capable token passes every other check on this
   * plane. Refused BEFORE `readFromProvider`, so no provider query is made with it.
   */
  'CREDENTIAL_IDENTITY_MISMATCH',
  /** The provider client reached its boundary and the provider did not answer. */
  'PROVIDER_UNAVAILABLE',
  /** The reply would not encode within `MAX_AUDIT_IPC_MESSAGE_BYTES`. */
  'RESPONSE_TOO_LARGE',
] as const;

export type ProviderReadRefusal = (typeof PROVIDER_READ_REFUSALS)[number];

export interface ProviderReadResponse {
  readonly protocolVersion: typeof AUDIT_READ_PROTOCOL_VERSION;
  readonly kind: typeof PROVIDER_READ_RESPONSE_KIND;
  readonly readId: string;
  readonly operation: ProviderReadOperation;
  /** Empty for `MESSAGE_ACTIVITY_COUNT`, whose answer is `recordCount` alone. */
  readonly records: readonly ProviderEvidenceRecord[];
  /** The provider's own total for the period, which may exceed `records.length`. */
  readonly recordCount: number;
  /**
   * `§17`'s non-secret credential label, declared by the SOURCE.
   *
   * The response carries this and NOT the material, for the reason `DispatchResponse`
   * carries `credentialIdentity` and no third member: a label proves which credential
   * answered without being the credential.
   */
  readonly credentialIdentity: string | null;
  /**
   * `§14` — THE ANSWER IS THE PROVIDER'S, AND THE RESPONSE SAYS SO.
   *
   * There is no `verified`, no `matched` and no `expected` member. A control-plane verdict
   * cannot travel on this wire because the wire has nowhere to put one, and the audit
   * plane's own comparison happens in the audit plane against the records above.
   */
  readonly providerQueriedAtMs: number;
}

export interface ProviderReadRefused {
  readonly protocolVersion: typeof AUDIT_READ_PROTOCOL_VERSION;
  readonly kind: typeof PROVIDER_READ_REFUSED_KIND;
  readonly readId: string;
  readonly reason: ProviderReadRefusal;
}

export interface AuditReaderReady {
  readonly protocolVersion: typeof AUDIT_READ_PROTOCOL_VERSION;
  readonly kind: typeof AUDIT_READER_READY_KIND;
  readonly readerIdentity: string;
  readonly providerId: string;
  readonly pid: number;
  /**
   * `§17` — THE KEYS OF THIS PROCESS'S OWN ENVIRONMENT. KEYS ONLY.
   *
   * `Object.keys`, never `process.env`: a value has no route onto this message, because the
   * member's type is `readonly string[]` and the parent's decoder refuses any element that
   * is not a bare environment-variable identifier.
   *
   * It is the CHILD that reports this rather than the parent asserting what it passed,
   * because what the parent passed is the thing under test and is therefore not evidence
   * about itself.
   */
  readonly environmentKeys: readonly string[];
  /** The signed class-5 risk class the reader's own composition verified. Evidence. */
  readonly declaredCredentialRiskClass: string;
}

export const MAX_REPORTED_ENV_KEYS = 256;

export type AuditReadMessage =
  | ProviderReadRequest
  | ProviderReadResponse
  | ProviderReadRefused
  | AuditReaderReady;

// ---------------------------------------------------------------------------------
// DECODE.
// ---------------------------------------------------------------------------------

export type AuditDecodeResult<T> =
  | { readonly kind: 'DECODED'; readonly message: T }
  | { readonly kind: 'REFUSED'; readonly reason: ProviderReadRefusal };

function refused<T>(reason: ProviderReadRefusal): AuditDecodeResult<T> {
  return { kind: 'REFUSED', reason };
}

function asRecord(raw: unknown): Record<string, unknown> | null {
  if (typeof raw !== 'string') return null;
  if (Buffer.byteLength(raw, 'utf8') > MAX_AUDIT_IPC_MESSAGE_BYTES) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
  return parsed as Record<string, unknown>;
}

function isSafeNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/** The environment-variable identifier grammar. A VALUE cannot satisfy it by accident. */
const ENV_KEY_GRAMMAR = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;

/**
 * Decode a read request, in the READER. Every refusal below runs BEFORE any provider call.
 *
 * The ORDER is load-bearing and is the same discipline `integrationHost.ts` applies: the
 * refusals that prove nothing left the process run first, so a `PROVIDER_READ_REFUSED` reply
 * is positive evidence that no provider request was opened.
 */
export function decodeProviderReadRequest(
  raw: unknown,
): AuditDecodeResult<ProviderReadRequest> {
  const record = asRecord(raw);
  if (record === null) return refused('MALFORMED_MESSAGE');

  if (record.protocolVersion !== AUDIT_READ_PROTOCOL_VERSION) {
    return refused('PROTOCOL_VERSION_MISMATCH');
  }
  if (record.kind !== PROVIDER_READ_REQUEST_KIND) return refused('MALFORMED_MESSAGE');

  // `§16`: an unknown field is a REFUSAL, never an ignored key.
  for (const key of Object.keys(record)) {
    if (!(PROVIDER_READ_REQUEST_FIELDS as readonly string[]).includes(key)) {
      return refused('UNKNOWN_FIELD');
    }
  }
  for (const field of PROVIDER_READ_REQUEST_FIELDS) {
    if (!(field in record)) return refused('MALFORMED_MESSAGE');
  }

  if (typeof record.readId !== 'string' || record.readId.length === 0) {
    return refused('MALFORMED_MESSAGE');
  }
  if (!isProviderReadOperation(record.operation)) return refused('UNKNOWN_OPERATION');
  if (typeof record.providerId !== 'string' || record.providerId.length === 0) {
    return refused('MALFORMED_MESSAGE');
  }

  if (
    !isSafeNonNegativeInteger(record.periodStartMs) ||
    !isSafeNonNegativeInteger(record.periodEndMs)
  ) {
    return refused('PERIOD_BOUND_INVALID');
  }
  if (record.periodEndMs <= record.periodStartMs) return refused('PERIOD_BOUND_INVALID');
  if (record.periodEndMs - record.periodStartMs > MAX_READ_PERIOD_MS) {
    return refused('PERIOD_BOUND_INVALID');
  }

  if (!isSafeNonNegativeInteger(record.maxRecords)) return refused('OPERATION_ARGUMENTS_INVALID');
  if (record.maxRecords === 0 || record.maxRecords > MAX_RECORDS_PER_READ) {
    return refused('RECORD_BOUND_EXCEEDED');
  }

  if (record.correlationTag !== null && typeof record.correlationTag !== 'string') {
    return refused('OPERATION_ARGUMENTS_INVALID');
  }
  if (record.providerMessageId !== null && typeof record.providerMessageId !== 'string') {
    return refused('OPERATION_ARGUMENTS_INVALID');
  }

  // PER-OPERATION ARGUMENT RULES. A closed schema whose arguments are optional for every
  // operation is a schema that admits a detail request with no id and a search with no
  // filter, and both would be answered by the widest possible read.
  if (record.operation === 'MESSAGE_ACTIVITY_DETAIL') {
    if (record.providerMessageId === null) return refused('OPERATION_ARGUMENTS_INVALID');
    if (record.correlationTag !== null) return refused('OPERATION_ARGUMENTS_INVALID');
  } else if (record.providerMessageId !== null) {
    return refused('OPERATION_ARGUMENTS_INVALID');
  }

  return {
    kind: 'DECODED',
    message: {
      protocolVersion: AUDIT_READ_PROTOCOL_VERSION,
      kind: PROVIDER_READ_REQUEST_KIND,
      readId: record.readId,
      operation: record.operation,
      providerId: record.providerId,
      periodStartMs: record.periodStartMs,
      periodEndMs: record.periodEndMs,
      correlationTag: record.correlationTag as string | null,
      providerMessageId: record.providerMessageId as string | null,
      maxRecords: record.maxRecords,
    },
  };
}

/** Decode a reply, in the AUDIT PLANE's parent process. */
export function decodeAuditReaderReply(
  raw: unknown,
): AuditDecodeResult<ProviderReadResponse | ProviderReadRefused | AuditReaderReady> {
  const record = asRecord(raw);
  if (record === null) return refused('MALFORMED_MESSAGE');
  if (record.protocolVersion !== AUDIT_READ_PROTOCOL_VERSION) {
    return refused('PROTOCOL_VERSION_MISMATCH');
  }

  if (record.kind === AUDIT_READER_READY_KIND) {
    if (typeof record.readerIdentity !== 'string') return refused('MALFORMED_MESSAGE');
    if (typeof record.providerId !== 'string') return refused('MALFORMED_MESSAGE');
    if (!isSafeNonNegativeInteger(record.pid)) return refused('MALFORMED_MESSAGE');
    if (typeof record.declaredCredentialRiskClass !== 'string') {
      return refused('MALFORMED_MESSAGE');
    }
    const keys = record.environmentKeys;
    if (!Array.isArray(keys) || keys.length > MAX_REPORTED_ENV_KEYS) {
      return refused('MALFORMED_MESSAGE');
    }
    for (const key of keys) {
      // A VALUE cannot travel here disguised as a key. `§17`'s prohibition is on the raw
      // environment, which is the values, and this is the mechanism that enforces it.
      if (typeof key !== 'string' || !ENV_KEY_GRAMMAR.test(key)) {
        return refused('MALFORMED_MESSAGE');
      }
    }
    return {
      kind: 'DECODED',
      message: {
        protocolVersion: AUDIT_READ_PROTOCOL_VERSION,
        kind: AUDIT_READER_READY_KIND,
        readerIdentity: record.readerIdentity,
        providerId: record.providerId,
        pid: record.pid,
        environmentKeys: Object.freeze([...(keys as string[])]),
        declaredCredentialRiskClass: record.declaredCredentialRiskClass,
      },
    };
  }

  if (record.kind === PROVIDER_READ_REFUSED_KIND) {
    if (typeof record.readId !== 'string') return refused('MALFORMED_MESSAGE');
    if (
      typeof record.reason !== 'string' ||
      !(PROVIDER_READ_REFUSALS as readonly string[]).includes(record.reason)
    ) {
      return refused('MALFORMED_MESSAGE');
    }
    return {
      kind: 'DECODED',
      message: {
        protocolVersion: AUDIT_READ_PROTOCOL_VERSION,
        kind: PROVIDER_READ_REFUSED_KIND,
        readId: record.readId,
        reason: record.reason as ProviderReadRefusal,
      },
    };
  }

  if (record.kind !== PROVIDER_READ_RESPONSE_KIND) return refused('MALFORMED_MESSAGE');
  if (typeof record.readId !== 'string') return refused('MALFORMED_MESSAGE');
  if (!isProviderReadOperation(record.operation)) return refused('UNKNOWN_OPERATION');
  if (!isSafeNonNegativeInteger(record.recordCount)) return refused('MALFORMED_MESSAGE');
  if (!isSafeNonNegativeInteger(record.providerQueriedAtMs)) return refused('MALFORMED_MESSAGE');
  if (record.credentialIdentity !== null && typeof record.credentialIdentity !== 'string') {
    return refused('MALFORMED_MESSAGE');
  }
  const rawRecords = record.records;
  if (!Array.isArray(rawRecords) || rawRecords.length > MAX_RECORDS_PER_READ) {
    return refused('RECORD_BOUND_EXCEEDED');
  }
  const records: ProviderEvidenceRecord[] = [];
  for (const raw of rawRecords) {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      return refused('MALFORMED_MESSAGE');
    }
    const row = raw as Record<string, unknown>;
    for (const key of Object.keys(row)) {
      if (
        !['providerMessageId', 'providerStatus', 'providerTimestampMs', 'correlationTag'].includes(
          key,
        )
      ) {
        return refused('UNKNOWN_FIELD');
      }
    }
    if (typeof row.providerMessageId !== 'string') return refused('MALFORMED_MESSAGE');
    if (typeof row.providerStatus !== 'string') return refused('MALFORMED_MESSAGE');
    if (!isSafeNonNegativeInteger(row.providerTimestampMs)) return refused('MALFORMED_MESSAGE');
    if (row.correlationTag !== null && typeof row.correlationTag !== 'string') {
      return refused('MALFORMED_MESSAGE');
    }
    records.push(
      Object.freeze({
        providerMessageId: row.providerMessageId,
        providerStatus: row.providerStatus,
        providerTimestampMs: row.providerTimestampMs,
        correlationTag: row.correlationTag as string | null,
      }),
    );
  }

  return {
    kind: 'DECODED',
    message: {
      protocolVersion: AUDIT_READ_PROTOCOL_VERSION,
      kind: PROVIDER_READ_RESPONSE_KIND,
      readId: record.readId,
      operation: record.operation,
      records: Object.freeze(records),
      recordCount: record.recordCount,
      credentialIdentity: record.credentialIdentity as string | null,
      providerQueriedAtMs: record.providerQueriedAtMs,
    },
  };
}

/** Encode, or `null` when the message exceeds the bound. A reply is DROPPED, never truncated. */
export function encodeAuditReadMessage(message: AuditReadMessage): string | null {
  const encoded = JSON.stringify(message);
  if (Buffer.byteLength(encoded, 'utf8') > MAX_AUDIT_IPC_MESSAGE_BYTES) return null;
  return encoded;
}

/**
 * A stable digest over the read the parent asked for, for the audit journal.
 *
 * `NUL`-separated and length-framed in the same shape `computeRequestBindingDigest` uses,
 * so a tag containing a separator cannot be made to look like a different read. This is
 * EVIDENCE about what was asked, not an authority token: nothing refuses on its basis and
 * the reader does not check it.
 */
export function computeReadDigest(request: ProviderReadRequest): string {
  const hash = createHash('sha256');
  for (const part of [
    AUDIT_READ_PROTOCOL_VERSION,
    request.operation,
    request.providerId,
    String(request.periodStartMs),
    String(request.periodEndMs),
    request.correlationTag ?? '',
    request.providerMessageId ?? '',
  ]) {
    hash.update(Buffer.from(String(Buffer.byteLength(part, 'utf8')), 'utf8'));
    hash.update(Buffer.from([0]));
    hash.update(Buffer.from(part, 'utf8'));
    hash.update(Buffer.from([0]));
  }
  return hash.digest('hex');
}
```

### G.4 The audit reader contract and its structural write refusal

#### `src/audit/provider/runtime/auditProviderReader.ts` (complete)

```typescript
import type {
  ProviderEvidenceRecord,
  ProviderReadOperation,
} from '../protocol/readWire.js';
import type { AuditReadCredential } from './auditSecretSource.js';

/**
 * `§16` — THE AUDIT-SIDE PROVIDER READER CONTRACT. THREE READS AND NO FOURTH METHOD.
 *
 * =================================================================================
 * WHAT `§16` FORBIDS, AND HOW A TYPE FORBIDS IT
 *
 *   "Permit only declared provider-read operations needed for audit/reconciliation. **No
 *    generic URL. No send operation.** No credential crosses IPC. Unknown operation:
 *    REFUSED."
 *
 * `AuditProviderReader` has exactly the members below. There is no `send`, no `post`, no
 * `write`, no `create`, no `request`, no `call` and no `invoke`, and there is no method
 * taking a URL, a path, a method verb, a header map or a body. **A reader object cannot
 * express a mutation**, so an audit reader that wanted to send would have to gain a member
 * — which is a change to this file, to `auditReadHost.ts`'s dispatch, and to the boundary
 * suite's hand-authored member list.
 *
 * `tests/negative-controls/unsafe-audit-read-boundary.ts` holds the discriminating control:
 * a reader object that DOES expose a send method, and the assertions that catch it.
 *
 * =================================================================================
 * `§31` OF S1N's MARK, CARRIED OVER: ONE CLEARLY MARKED PROVIDER BOUNDARY
 *
 * `48 §4` item 1 wants one vendor client per credential scope, and `tools/perimeter/`
 * recognises a SEND client by the `sendToProvider*` declaration shape. The audit plane's
 * counterpart is `readFromProvider*`, and `PROVIDER_READ_BOUNDARY` below is the mark a
 * reader implementation carries so the perimeter scan can enumerate a READ site and
 * classify it under `48 §2` row 13's read-only exemption rather than silently miss it.
 *
 * **A READ SITE IS STILL A PERIMETER SITE.** `48 §3.6` calls row 13 EXEMPT, and an
 * exemption is "a **named, annotated, reviewed** hole". An unenumerated read is not exempt;
 * it is unreviewed.
 * =================================================================================
 */

/** The mark an audit provider-read boundary carries. `48 §2` row 13, `48 §3.6`. */
export const PROVIDER_READ_BOUNDARY = 'ACOS_AUDIT_PROVIDER_READ_BOUNDARY' as const;

/** The arguments one read carries. A closed record, and no member is a destination. */
export interface ProviderReadQuery {
  readonly operation: ProviderReadOperation;
  /** `48`'s v1.3 note: PERIOD-BOUNDED, always, on every operation. */
  readonly periodStartMs: number;
  readonly periodEndMs: number;
  /** Narrows a period-bounded result. Never replaces the period. */
  readonly correlationTag: string | null;
  /** The PROVIDER's own message id, for `MESSAGE_ACTIVITY_DETAIL` only. */
  readonly providerMessageId: string | null;
  readonly maxRecords: number;
}

/** What one read produced. A closed set; there is no exception with a message. */
export type ProviderReadResult =
  | {
      readonly kind: 'EVIDENCE';
      readonly records: readonly ProviderEvidenceRecord[];
      /** The provider's own total for the period, which may exceed `records.length`. */
      readonly recordCount: number;
    }
  /** The provider was reached and refused, or was not reached at all. */
  | { readonly kind: 'PROVIDER_UNAVAILABLE' };

/**
 * ONE PROVIDER'S READ BOUNDARY. THE ONLY THING IN THE AUDIT PLANE THAT TOUCHES A PROVIDER.
 *
 * `readFromProvider` takes the resolved credential as an ARGUMENT rather than holding it,
 * for the reason the integration adapter's `invoke` does: a client that held its credential
 * would keep it alive across reads, and `§17`'s leak matrix would then have a long-lived
 * heap reference to assert about instead of a call-scoped one.
 */
export interface AuditProviderReader {
  /** The ONE provider identity this reader serves. A wiring assertion, never a selector. */
  readonly providerId: string;
  /**
   * The mark. Present so `tools/perimeter/` and the packaging manifest can see a read
   * boundary that carries no `fetch` — which is every reader in this repository today,
   * because `§27` forbids a real provider call and there is no vendor HTTP anywhere.
   */
  readonly boundary: typeof PROVIDER_READ_BOUNDARY;
  readFromProvider(
    credential: AuditReadCredential,
    query: ProviderReadQuery,
  ): Promise<ProviderReadResult>;
}

/**
 * The closed member list, HAND-AUTHORED, so `auditReadHost.ts` can refuse a reader carrying
 * anything else at COMPOSITION rather than discovering it at the first read.
 *
 * `§16`: "No send operation." A reader that gained a `send` member would satisfy this
 * interface structurally — TypeScript's structural typing admits extra members — so the
 * shape is checked at runtime, against this list, before the reader is used.
 */
export const AUDIT_PROVIDER_READER_MEMBERS = [
  'providerId',
  'boundary',
  'readFromProvider',
] as const;

/** Every member name that would make a reader mutation-capable. Refused by name AND by list. */
export const FORBIDDEN_READER_MEMBERS = [
  'send',
  'sendToProvider',
  'post',
  'put',
  'patch',
  'delete',
  'write',
  'create',
  'update',
  'invoke',
  'dispatch',
  'request',
  'call',
  'execute',
  'fetch',
] as const;

/**
 * Whether a value is a reader this host will use.
 *
 * TWO CHECKS, AND BOTH ARE NEEDED. The member list closes the shape; the forbidden list
 * names the mutations explicitly so a failure message says WHICH capability was found rather
 * than "unexpected member". The second is redundant against the first today, and it is kept
 * because the first is the one a future refactor is likely to widen.
 */
export function isAuditProviderReader(value: unknown): value is AuditProviderReader {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.providerId !== 'string') return false;
  if (candidate.boundary !== PROVIDER_READ_BOUNDARY) return false;
  if (typeof candidate.readFromProvider !== 'function') return false;
  for (const member of FORBIDDEN_READER_MEMBERS) {
    if (member in candidate) return false;
  }
  const allowed = new Set<string>(AUDIT_PROVIDER_READER_MEMBERS);
  for (const key of Object.keys(candidate)) {
    if (!allowed.has(key)) return false;
  }
  return true;
}

/** What a reader module must export. A named export, so a default cannot smuggle a shape. */
export interface AuditProviderReaderModule {
  readonly auditProviderReader: AuditProviderReader;
}

export function isAuditProviderReaderModule(
  value: unknown,
): value is AuditProviderReaderModule {
  if (typeof value !== 'object' || value === null) return false;
  return isAuditProviderReader((value as { auditProviderReader?: unknown }).auditProviderReader);
}
```

### G.5 Audit secret-source resolution and class-5 admission

#### `src/audit/provider/runtime/auditSecretSource.ts` (complete)

```typescript
/**
 * `§13`, `§14` — THE AUDIT PLANE'S OWN SECRET BOUNDARY. A SEPARATE CONTRACT, DELIBERATELY.
 *
 * =================================================================================
 * WHY THIS IS NOT `AdapterSecretSource`
 *
 * `§13`: "Do not put audit credentials into: control process; control integration adapter
 * runtime; **same secret source as send credential**."
 *
 * `src/integration/runtime/adapterSecretSource.ts` declares a source SCOPED TO ONE ADAPTER,
 * whose credential the integration host hands to an adapter's `invoke`. Reusing that type
 * here would mean:
 *
 *   1. the audit reader's module graph contains the integration plane's secret contract,
 *      so `29 §3.5`'s per-credential isolation would be a convention rather than a shape;
 *   2. a source implementation written for one plane would TYPE-CHECK in the other, and
 *      "same secret source as send credential" is exactly the mistake that makes possible;
 *   3. `declaredAdapterId` would key the audit credential by an ACOS-side concept, which
 *      `readerIdentity.ts` explains is the wrong key for a plane whose job is to ask the
 *      provider rather than to trust ACOS.
 *
 * So the contract is separate, it is keyed by PROVIDER, and the two source types share no
 * module. `tests/integration/audit/audit-plane-packaging.test.ts` asserts the disjointness.
 *
 * =================================================================================
 * `§9` OF S1N STILL HOLDS: NO CLOUD SECRET MANAGER IS SELECTED
 *
 * v1.3.6 and v1.3.7 name no platform secret manager, so this file declares the CONTRACT and
 * nothing else. There is no AWS SDK, no Azure SDK, no GCP SDK, no Vault client, no HTTP
 * client and no network of any kind in this directory. The S1O implementations are TEST-ONLY
 * fixtures under `tests/audit-plane/`, and the production posture is that a reader launched
 * without a source resolves nothing and refuses `CREDENTIAL_UNAVAILABLE`.
 * =================================================================================
 */

/**
 * `50 §2g` field 1's identity-provenance set, TRANSCRIBED a THIRD time.
 *
 * The same discipline `readerEnvironment.ts` applies to the integration plane's key list and
 * `auditPlaneVerifier.ts` applies to `50 §6`'s inventory: this plane imports neither the
 * kernel's `credentialRisk.ts` nor the integration plane's `adapterSecretSource.ts`, because
 * either import would make the audit reader's module graph contain a plane it is supposed to
 * be independent of. `tests/integration/perimeter/source-boundary.test.ts` asserts the three
 * transcriptions agree.
 */
export const AUDIT_CREDENTIAL_IDENTITY_PROVENANCES = [
  'PROVIDER_KEY_ID',
  'DEPLOYMENT_SECRET_VERSION',
  'SYNTHETIC_TEST_IDENTITY',
] as const;

export type AuditCredentialIdentityProvenance =
  (typeof AUDIT_CREDENTIAL_IDENTITY_PROVENANCES)[number];

/**
 * The resolved READ-ONLY credential material, and the non-secret labels describing it.
 *
 * `secret` is the only member that may leave this object, and it may only go to the
 * provider-read client's own boundary. It is not logged, not encoded, not attached to a
 * response and not readable from any wire type — `ProviderReadResponse` carries
 * `credentialIdentity` and has no member the material could occupy.
 */
export interface AuditReadCredential {
  /** The read-only provider secret. NEVER serialised, NEVER logged, NEVER sent to a parent. */
  readonly secret: string;
  /**
   * `50 §2g` FIELD 1 — **WHICH CREDENTIAL THIS MATERIAL IS.** MANDATORY, NON-SECRET.
   *
   * =================================================================================
   * THE AUDIT PLANE'S HALF OF THE BINDING, AND ITS ATTACK IS THE MIRROR IMAGE
   *
   *     signed audit record   `synthetic_esp.audit_read`  ->  READ_ONLY  ->  reader admitted
   *     secret locator        resolves ........................  a SEND-CAPABLE token
   *
   * Every existing control passes. The class-5 record is genuinely `READ_ONLY`, the
   * `audit_plane` sentinel is genuinely present, the locator is genuinely not one the
   * integration plane holds — and the material in the reader's hand can send. `48 §3.6`'s
   * exemption would then rest on a declaration about a credential the reader is not using.
   *
   * So the source must name what it resolved, and `auditReadHost.ts` compares that answer to
   * the signed expected identity the audit plane echoed into the launch configuration, in a
   * guard that runs BEFORE `readFromProvider`. A mismatch is `CREDENTIAL_IDENTITY_MISMATCH`.
   *
   * **NULL IS NOT A VALUE HERE**, for the reason it is not one on the integration plane.
   */
  readonly credentialIdentity: string;
  /**
   * WHAT ESTABLISHES THAT IDENTITY. Declared, so a reviewer can tell a binding from a label.
   *
   * `§14` of the S1O correction: a source returning a friendly label such as
   * `"audit-read-key"` has returned a STRING, and that string is not a provider binding
   * merely because the source chose it. A production audit source must return the PROVIDER'S
   * OWN non-secret key identifier (`PROVIDER_KEY_ID`) or an immutable secret-manager identity
   * for that exact token (`DEPLOYMENT_SECRET_VERSION`); `SYNTHETIC_TEST_IDENTITY` is a
   * fixture's answer and belongs only to a TEST/pre-live package.
   *
   * **WHICH PROVIDER THAT IS IS NOT THIS FILE'S BUSINESS.** No vendor is named anywhere under
   * `src/audit/`, and `audit-read-boundary.test.ts` asserts the absence: the provider
   * selection lives in `tools/provider-selection/`, as dated documentation evidence, and a
   * plane whose job is to observe independently does not carry a vendor's name in its
   * contract.
   */
  readonly identityProvenance: AuditCredentialIdentityProvenance;
  /** A non-secret, source-declared rotation label. May be `null`. */
  readonly version: string | null;
}

/** What a resolution can say. A closed set; there is no exception with a message. */
export type AuditSecretResolution =
  | { readonly kind: 'RESOLVED'; readonly credential: AuditReadCredential }
  /** The revocation switch, as the SOURCE's own answer rather than a flag in ACOS. */
  | { readonly kind: 'CREDENTIAL_REVOKED' }
  /** No material is provisioned, or the audit deployment boundary cannot answer. */
  | { readonly kind: 'UNAVAILABLE' };

/**
 * ONE PROVIDER'S AUDIT READ CREDENTIAL. THE AUDIT READER'S ONLY ROUTE TO A PROVIDER SECRET.
 *
 * `resolve()` TAKES NO ARGUMENT, for the reason `AdapterSecretSource.resolve` takes none: a
 * source with a selector signature is a source that CAN be asked for another scope's
 * material, and the only thing between the ask and the answer would be a check inside the
 * source — `29 §3.1`'s own objection to internal capability tokens, one layer down.
 *
 * `declaredProviderId` is a WIRING ASSERTION so the host can refuse a mis-wired reader at
 * start. It is not a selector, and `unsafeSharedAuditSecretSource` in the negative-control
 * suite is the discriminating control: a source with the selector signature, through which
 * the audit reader reaches the integration plane's send credential.
 */
export interface AuditReadSecretSource {
  /** The ONE provider identity this source serves. A wiring assertion, never a selector. */
  readonly declaredProviderId: string;
  resolve(): Promise<AuditSecretResolution>;
}

/**
 * The structural form of "do not publish a fingerprint", for the audit plane's labels.
 *
 * Refuses a credential whose non-secret labels CONTAIN the secret, are contained BY it, or
 * are a hex/base64 encoding of it. It cannot refuse every derivation and is not claimed to;
 * what it closes is the accident — a source that set `identity` to the token because the
 * token was the handiest unique string, which is how fingerprints actually reach logs.
 *
 * Deliberately a SECOND implementation rather than an import of
 * `credentialLabelsAreNonDerived`: the two planes share no module, and a rule this small is
 * cheaper to restate than a coupling is to justify.
 */
export function auditCredentialLabelsAreNonDerived(credential: AuditReadCredential): boolean {
  const { secret } = credential;
  if (secret.length === 0) return false;
  for (const label of [credential.credentialIdentity, credential.version]) {
    if (label === null) continue;
    if (label.length === 0) return false;
    if (label.includes(secret) || secret.includes(label)) return false;
    if (label === Buffer.from(secret, 'utf8').toString('hex')) return false;
    if (label === Buffer.from(secret, 'utf8').toString('base64')) return false;
  }
  return true;
}

/**
 * The binding comparison, for THIS plane. Returns the reason the resolved credential is the
 * wrong one, or `null` when the signed record and the resolved material agree.
 *
 * Deliberately a SECOND implementation of `credentialRisk.ts`'s
 * `credentialIdentityMismatch`, for the reason `auditCredentialLabelsAreNonDerived` is a
 * second implementation: the two planes share no module, and a rule this small is cheaper to
 * restate than a coupling is to justify. `tests/integration/audit/audit-read-boundary.test.ts`
 * asserts the two agree on every case it exercises.
 *
 * **AN EMPTY RESOLVED IDENTITY IS NOT EQUALITY WITH AN EMPTY EXPECTATION.** Absence refuses.
 */
export function auditCredentialIdentityMismatch(
  expectedCredentialId: string,
  resolvedCredentialIdentity: string,
): string | null {
  if (expectedCredentialId.length === 0) {
    return (
      'the reader was launched with no expected credential identity; 50 §2g field 1 is the ' +
      'identity of the exact material the reader may present, and an absent expectation ' +
      'cannot bind one'
    );
  }
  if (resolvedCredentialIdentity.length === 0) {
    return (
      'the audit secret source returned no credential identity for the material it ' +
      'resolved; a null identity is not sufficient for a configured credential'
    );
  }
  if (expectedCredentialId !== resolvedCredentialIdentity) {
    return (
      `the signed class-5 audit record governs credential "${expectedCredentialId}" and the ` +
      `audit secret source resolved material identified as "${resolvedCredentialIdentity}"; ` +
      "48 §3.6's read-only exemption would govern the wrong credential"
    );
  }
  return null;
}
```

#### `src/audit/provider/plane/auditReaderRegistry.ts` (complete)

```typescript
import type { AuditVerifiedCredentialScope } from '../../controlArtifacts/auditPlaneVerifier.js';
import { isWellFormedProviderId } from '../protocol/readerIdentity.js';

/**
 * THE CLOSED AUDIT-READER REGISTRY — `§13`, `§14`, AND `48 §3.6`'s EXEMPTION, ENFORCED.
 *
 * =================================================================================
 * WHAT A DESCRIPTOR IS, AND WHY NO REQUEST CAN CARRY ONE
 *
 * The same rule `adapterRuntimeRegistry.ts` implements, applied to this plane: a descriptor
 * is built at process wiring time, and there is no function in this module, in
 * `auditReadClient.ts` or on the read path that takes a path, a specifier, a flag or a
 * locator as a per-request argument. `§16`'s "no generic URL" is the message-level half of
 * the same property; this is the launch-level half.
 *
 * =================================================================================
 * `§13`'s THREE SEPARATIONS, EACH AS A REFUSAL TO CONSTRUCT
 *
 * "Do not put audit credentials into: control process; control integration adapter runtime;
 * **same secret source as send credential**."
 *
 *   control process            structural. This registry is in `src/audit/`, its reader runs
 *                              in its own forked process, and the control plane imports
 *                              neither. `tests/integration/audit/audit-source-boundary.test.ts`
 *                              asserts no control-plane module imports this package.
 *   integration adapter runtime structural, plus `READER_LOCATOR_SHARED_WITH_INTEGRATION`
 *                              below: a descriptor whose locator collides with a locator the
 *                              integration plane holds is REFUSED at construction.
 *   same secret source         same refusal. A locator is what names a source, so two
 *                              runtimes sharing a locator are two runtimes sharing a source
 *                              whatever their module specifiers say.
 *
 * =================================================================================
 * AND THE ONE CHECK THAT IS NEW IN S1O — `50 §2g` FIELD 6
 *
 * `48 §3.6`'s exemption rests on the audit plane's vendor credential being read-only, and
 * before v1.3.7 that was a prose property with no signed operand. It has one now, and this
 * registry is where it is enforced: a descriptor naming a credential whose SIGNED class-5
 * record is not `READ_ONLY` is refused, and a descriptor naming a credential the class-5
 * artifact does not contain at all is refused too.
 *
 * **MISSING FAILS CLOSED.** `50 §2g`: "A configured vendor credential whose
 * `credential_risk_class` is absent, unparseable, or outside this closed set FAILS CLOSED."
 * There is no branch below that treats an unknown credential as safe, and
 * `tests/negative-controls/unsafe-audit-read-boundary.ts` holds the implementation that does.
 * =================================================================================
 */

/** One audit reader runtime, as trusted deployment configuration. */
export interface AuditReaderDescriptor {
  /** The ONE provider identity this reader serves. */
  readonly providerId: string;
  /** The credential identity whose SIGNED class-5 record governs this reader. */
  readonly credentialId: string;
  /** `29 §3.5`'s confinement root. Both module specifiers must resolve inside it. */
  readonly runtimeRoot: string;
  /** The reader module. Trusted configuration, never a caller's value. */
  readonly readerModule: string;
  /** The secret-source module. Same provenance. */
  readonly secretSourceModule: string;
  /** The audit read credential's LOCATOR. Never the material it locates. */
  readonly secretLocator: string;
}

/** The refusals this module produces. All are refusals to CONSTRUCT, at wiring time. */
export const AUDIT_READER_REGISTRY_REFUSALS = [
  'PROVIDER_ID_MALFORMED',
  'DUPLICATE_AUDIT_READER',
  'MODULE_OUTSIDE_RUNTIME_ROOT',
  /** `50 §2g`: the class-5 artifact carries no record for this credential. FAIL CLOSED. */
  'CREDENTIAL_NOT_DECLARED',
  /** `50 §2g` field 6 is not `READ_ONLY`. `48 §3.6`'s exemption is not earned. */
  'CREDENTIAL_NOT_READ_ONLY',
  /** `50 §2g` field 7 is true. A mutation-capable credential is not an audit credential. */
  'CREDENTIAL_EXTERNALLY_MUTATION_CAPABLE',
  /**
   * `50 §2g` field 2 does not carry the reserved `audit_plane` scope.
   *
   * The mirror of `adapterRuntimeRegistry`'s `CREDENTIAL_IS_AUDIT_PLANE_SCOPED`, and both
   * halves are needed: that one stops an audit credential being presented at a dispatch
   * boundary, and this one stops an ADAPTER's credential being presented at the audit read
   * boundary. Without it, a deployment could point the audit reader at a send credential
   * that happened to be declared `READ_ONLY` for some other adapter, and `§13`'s "no control
   * send credential" would rest on the declaration alone.
   */
  'CREDENTIAL_NOT_AUDIT_PLANE_SCOPED',
  /** `§13`: the audit credential must not share a source with the send credential. */
  'READER_LOCATOR_SHARED_WITH_INTEGRATION',
] as const;

export type AuditReaderRegistryRefusal = (typeof AUDIT_READER_REGISTRY_REFUSALS)[number];

export class AuditReaderRegistryError extends Error {
  public readonly refusal: AuditReaderRegistryRefusal;

  public constructor(refusal: AuditReaderRegistryRefusal, detail: string) {
    super(`${refusal}: ${detail}`);
    this.refusal = refusal;
    this.name = 'AuditReaderRegistryError';
  }
}

export interface AuditReaderRegistry {
  readonly resolve: (providerId: string) => AuditReaderDescriptor | undefined;
  readonly registeredIds: readonly string[];
  /** The signed class-5 record each registered reader was admitted against. Evidence. */
  readonly credentialScopeOf: (providerId: string) => AuditVerifiedCredentialScope | undefined;
}

function specifierIsInsideRoot(root: string, specifier: string): boolean {
  // A STRING-PREFIX check on normalised separators, for the reason
  // `adapterRuntimeRegistry.ts` uses one: this runs in the audit plane's parent, and a
  // parent that resolved a child's paths against its own working directory would be
  // answering a question about the wrong process. The authoritative containment check is
  // `main.ts`'s `isInsideAuditRuntimeRoot`, which runs INSIDE the runtime being confined.
  const normalise = (value: string): string => value.replace(/\\/g, '/').replace(/\/+$/, '');
  const normalisedRoot = normalise(root);
  const normalisedSpecifier = normalise(specifier);
  return (
    normalisedSpecifier.startsWith(`${normalisedRoot}/`) && !normalisedSpecifier.includes('/../')
  );
}

/**
 * Build the registry. THE ONLY WAY TO PRODUCE AN `AuditReaderRegistry`.
 *
 * `integrationSecretLocators` is the set of locators the INTEGRATION plane holds, supplied
 * by the composition root so this module can refuse a collision without importing the other
 * plane's registry. Passing it is the deployment's own declaration of what the send side
 * uses; passing an empty set is possible and is exactly the mis-wiring
 * `tests/negative-controls/unsafe-audit-read-boundary.ts` exercises, so the boundary suite
 * asserts the real composition passes the real set.
 */
export function createAuditReaderRegistry(
  descriptors: readonly AuditReaderDescriptor[],
  auditReadCredentials: Readonly<Record<string, AuditVerifiedCredentialScope>>,
  integrationSecretLocators: ReadonlySet<string>,
): AuditReaderRegistry {
  const byProvider = new Map<string, AuditReaderDescriptor>();
  const scopeByProvider = new Map<string, AuditVerifiedCredentialScope>();

  for (const descriptor of descriptors) {
    if (!isWellFormedProviderId(descriptor.providerId)) {
      throw new AuditReaderRegistryError(
        'PROVIDER_ID_MALFORMED',
        `"${descriptor.providerId}" does not satisfy the provider identifier grammar`,
      );
    }
    if (byProvider.has(descriptor.providerId)) {
      throw new AuditReaderRegistryError(
        'DUPLICATE_AUDIT_READER',
        `two readers were configured for provider "${descriptor.providerId}"; 23 §7 scopes ` +
          'isolation per credential, so one credential scope is one runtime',
      );
    }
    for (const specifier of [descriptor.readerModule, descriptor.secretSourceModule]) {
      if (!specifierIsInsideRoot(descriptor.runtimeRoot, specifier)) {
        throw new AuditReaderRegistryError(
          'MODULE_OUTSIDE_RUNTIME_ROOT',
          `a module configured for "${descriptor.providerId}" does not resolve inside its ` +
            'declared runtime root; 29 §3.5 requires per-credential dependency isolation',
        );
      }
    }

    // ---------------------------------------------------------------------------------
    // `§13` — THE AUDIT SOURCE IS NOT THE SEND SOURCE.
    // ---------------------------------------------------------------------------------
    if (integrationSecretLocators.has(descriptor.secretLocator)) {
      throw new AuditReaderRegistryError(
        'READER_LOCATOR_SHARED_WITH_INTEGRATION',
        `the audit reader for "${descriptor.providerId}" resolves its credential from a ` +
          'locator the integration plane also holds; §13 requires a separate credential ' +
          'source, and a shared locator is a shared source whatever the module specifiers say',
      );
    }

    // ---------------------------------------------------------------------------------
    // `50 §2g` — THE SIGNED CLASS-5 RECORD. MISSING FAILS CLOSED.
    // ---------------------------------------------------------------------------------
    const scope = auditReadCredentials[descriptor.credentialId];
    if (scope === undefined) {
      throw new AuditReaderRegistryError(
        'CREDENTIAL_NOT_DECLARED',
        `the verified class-5 declaration carries no record for credential ` +
          `"${descriptor.credentialId}"; 50 §2g: a configured vendor credential whose ` +
          'credential_risk_class is absent FAILS CLOSED, and an undeclared credential is ' +
          'not a READ_ONLY one by default',
      );
    }
    /*
     * THE `audit_plane` SENTINEL CHECK IS THE VERIFIER'S, NOT THIS MODULE'S.
     *
     * `auditPlaneVerifier.ts` keeps ONLY records carrying `50 §2g` field 2's reserved
     * `audit_plane` scope, so an adapter-scoped credential never reaches this map and a
     * descriptor naming one is refused as UNDECLARED above. That is the stronger placement:
     * the audit plane never learns a send credential's identity at all, which makes `§13`'s
     * "no control send credential" a fact about what this plane can see rather than a check
     * it performs.
     */
    if (scope.provider !== descriptor.providerId) {
      throw new AuditReaderRegistryError(
        'CREDENTIAL_NOT_AUDIT_PLANE_SCOPED',
        `credential "${descriptor.credentialId}" is declared for provider ` +
          `"${scope.provider}" and the descriptor configures it for ` +
          `"${descriptor.providerId}"`,
      );
    }
    if (scope.credentialRiskClass !== 'READ_ONLY') {
      throw new AuditReaderRegistryError(
        'CREDENTIAL_NOT_READ_ONLY',
        `credential "${descriptor.credentialId}" is declared ${scope.credentialRiskClass}; ` +
          "48 §3.6's audit-plane exemption rests on the credential being read-only, and " +
          '50 §2g reserves READ_ONLY for a credential with no external mutation at all',
      );
    }
    if (scope.externalMutationCapable) {
      // Unreachable while the class-5 parser enforces `§2g`'s self-consistency rule, and
      // present anyway: this registry is the component `48 §3.6` names, and an invariant it
      // relies on should be checked where it is relied upon rather than only where it is
      // produced.
      throw new AuditReaderRegistryError(
        'CREDENTIAL_EXTERNALLY_MUTATION_CAPABLE',
        `credential "${descriptor.credentialId}" declares external_mutation_capable true`,
      );
    }

    byProvider.set(descriptor.providerId, Object.freeze({ ...descriptor }));
    scopeByProvider.set(descriptor.providerId, scope);
  }

  const ids = Object.freeze([...byProvider.keys()].sort());
  return Object.freeze({
    resolve: (providerId: string): AuditReaderDescriptor | undefined => byProvider.get(providerId),
    registeredIds: ids,
    credentialScopeOf: (providerId: string): AuditVerifiedCredentialScope | undefined =>
      scopeByProvider.get(providerId),
  });
}

/**
 * PRODUCTION'S OWN AUDIT READER REGISTRY. IT IS EMPTY, AND THAT IS THE POINT.
 *
 * `§27`: "Do not make any provider send call. [...] No real provider secret should be
 * required." The read side is the same posture: `48 §2` row 13 describes a capability the
 * repository does not yet have, S1O builds the mechanism and selects a provider, and the
 * first real provider read belongs to the resumed validation slice.
 *
 * A FUNCTION rather than a constant because `createAuditReaderRegistry` requires the audit
 * plane's own verification outcome, which has not run at module-evaluation time. An empty
 * registry needs no artifact read, so this one never asks for one.
 */
export function emptyAuditReaderRegistry(): AuditReaderRegistry {
  return Object.freeze({
    resolve: (): AuditReaderDescriptor | undefined => undefined,
    registeredIds: Object.freeze([]),
    credentialScopeOf: (): AuditVerifiedCredentialScope | undefined => undefined,
  });
}
```

### G.6 The new S1P audit-plane files — complete

#### `validation/sendgrid/audit/providerReadClient.ts` (complete)

```typescript
/**
 * THE ONE VENDOR HTTP CLIENT FOR AUDIT-PLANE READS — `48 §2` ROW 13, `48 §3.6`.
 *
 * =================================================================================
 * AN EXEMPTION IS NOT A HOLE. IT IS A NAMED, ANNOTATED, REVIEWED HOLE
 *
 * `48 §3`, verbatim, and the reason every read site in this file carries
 * `PERIMETER_EXEMPT(audit_plane_read_only, 48-3-6)` even though `48` exempts an audit read
 * from carrying an `authorisation_ref`: **an unenumerated read is not exempt, it is
 * unreviewed.** `tools/perimeter/` recognises the `readFromProvider*` declaration shape,
 * scans this tree at PRODUCTION scope, and fails the build on an unannotated site.
 *
 * =================================================================================
 * THERE IS NO SEND FUNCTION IN THIS FILE, AND THAT IS THE POINT OF THE WHOLE BOUNDARY
 *
 * `§16` of the S1O mandate: "No send operation." A file named `providerReadClient.ts` that
 * also exported a `sendToProviderSendGrid` would satisfy every structural check in the audit
 * runtime and defeat the architecture, so the absence is ASSERTED rather than intended:
 * `tests/sendgrid/audit-reader-boundary.test.ts` scans this directory for the
 * `sendToProvider*` declaration shape `tools/perimeter/` recognises and requires ZERO, and
 * `perimeter-enumeration.test.ts` requires zero `PROVIDER_CLIENT` sites under
 * `validation/sendgrid/audit/`.
 *
 * **THE `36 §13` ATTEMPTED-WRITE PROBE IS NOT HERE.** It is `sendRefusalProbe.ts`, it is not
 * imported by `reader.ts`, and it is not reachable from any audit read IPC message. `§8.2`:
 * "Do NOT add a normal audit IPC 'send' method just to perform the negative control."
 *
 * =================================================================================
 * TWO OPERATIONS, TWO CONSTANT PATHS, NO ARBITRARY URL
 *
 * `GET /v3/messages` and `GET /v3/messages/{msg_id}` — S1O's capability record cites both,
 * and this client has exactly those two. The message id is the ONE value that reaches a path
 * and it is percent-encoded and shape-checked before it does; every other narrowing goes in
 * the documented query language, which `buildActivityQuery` constructs from a closed set of
 * operands.
 *
 * `ProviderReadQuery` — the ACCEPTED audit IPC type this client's caller receives — has no
 * `url`, `path`, `endpoint`, `host`, `origin`, `method`, `headers`, `body` or `query` member,
 * so nothing a caller supplies can name a destination.
 * =================================================================================
 */

/** THE ONE ORIGIN. A CONSTANT — never an argument, never composed, never configurable. */
export const SENDGRID_API_ORIGIN = 'https://api.sendgrid.com';

/** `GET /v3/messages`, the Email Activity search. A CONSTANT. */
export const SENDGRID_MESSAGES_PATH = '/v3/messages';

/**
 * The transport deadline for one read, in milliseconds.
 *
 * Below `auditReadClient.ts`'s `DEFAULT_READ_DEADLINE_MS` (15s) so a hung provider produces
 * this client's own `NOT_REACHED` rather than the audit plane's IPC timeout.
 */
export const SENDGRID_READ_DEADLINE_MS = 12_000;

/**
 * S1O's capability record: "6 requests per minute; HTTP 429 above it" on the Email Activity
 * API. Declared here so the bounded observation loop can pace itself against the published
 * figure rather than against a guess, and carried into evidence.
 */
export const SENDGRID_ACTIVITY_REQUESTS_PER_MINUTE = 6;

/** SendGrid's message id grammar, as narrow as the documented values allow. */
const MESSAGE_ID_GRAMMAR = /^[A-Za-z0-9._@-]{1,128}$/;

export function isUsableProviderMessageId(value: string): boolean {
  return MESSAGE_ID_GRAMMAR.test(value);
}

/**
 * The closed operand set one activity query may narrow on.
 *
 * `categories` is S1O's unambiguous correlation mechanism on BOTH sides — settable on the v3
 * send and itself a documented Email Activity filter field — so it is the one this client
 * filters on. `last_event_time` carries `48`'s mandatory period bound.
 */
export interface SendGridActivityQuery {
  readonly correlationTag: string | null;
  readonly periodStartMs: number;
  readonly periodEndMs: number;
  readonly limit: number;
}

/**
 * Build the documented query string. PURE, and the only place one is constructed.
 *
 * The values it interpolates are a correlation tag — which `isCorrelationTag` has already
 * constrained to `acos-corr-` plus a UUID — and two epoch timestamps rendered as ISO
 * instants. There is no operand a caller could use to inject a second clause, because there
 * is no operand a caller supplies that is not one of those three.
 */
export function buildActivityQuery(query: SendGridActivityQuery): string {
  const from = new Date(query.periodStartMs).toISOString();
  const to = new Date(query.periodEndMs).toISOString();
  const clauses = [
    `last_event_time BETWEEN TIMESTAMP "${from}" AND TIMESTAMP "${to}"`,
  ];
  if (query.correlationTag !== null) {
    clauses.push(`Contains(categories,"${query.correlationTag}")`);
  }
  return clauses.join(' AND ');
}

/** One Email Activity record, reduced to the four non-secret facts the audit plane needs. */
export interface SendGridActivityRecord {
  readonly providerMessageId: string;
  readonly providerStatus: string;
  readonly providerTimestampMs: number;
  readonly correlationTag: string | null;
}

export type SendGridReadResponse =
  | {
      readonly kind: 'ANSWERED';
      readonly httpStatus: number;
      readonly records: readonly SendGridActivityRecord[];
    }
  /** The boundary was reached and the provider did not answer. */
  | { readonly kind: 'NOT_REACHED' };

/**
 * Reduce the provider's JSON to the four facts a `ProviderEvidenceRecord` can carry.
 *
 * PURE and TOTAL, so `tests/sendgrid/activity-normalisation.test.ts` can exercise every
 * malformed shape without a provider. A record the provider sent that this function cannot
 * read is DROPPED rather than guessed at: `§8.2` bounds the normalised output, and a
 * half-understood record is evidence about nothing.
 *
 * **NO RECIPIENT ADDRESS IS READ.** `ProviderEvidenceRecord` has no member one could occupy
 * (`30 §5.10`), and the reduction does not look at `to_email` at all — so there is no step
 * at which a redactor has to remove it.
 */
export function normaliseActivityRecords(
  payload: unknown,
  expectedCorrelationTag: string | null,
): readonly SendGridActivityRecord[] {
  if (typeof payload !== 'object' || payload === null) return Object.freeze([]);
  const messages = (payload as { messages?: unknown }).messages;
  if (!Array.isArray(messages)) return Object.freeze([]);

  const out: SendGridActivityRecord[] = [];
  for (const entry of messages) {
    if (typeof entry !== 'object' || entry === null) continue;
    const record = entry as Record<string, unknown>;
    const id = record.msg_id;
    const status = record.status;
    const at = record.last_event_time;
    if (typeof id !== 'string' || !isUsableProviderMessageId(id)) continue;
    if (typeof status !== 'string' || status.length === 0 || status.length > 64) continue;
    if (typeof at !== 'string') continue;
    const timestampMs = Date.parse(at);
    if (!Number.isFinite(timestampMs)) continue;

    /*
     * THE TAG IS ECHOED ONLY WHEN THE PROVIDER ACTUALLY RETURNED IT.
     *
     * A reduction that copied the REQUESTED tag onto every record would make the observation
     * loop's correlation self-fulfilling: every record would match because the matcher wrote
     * the value it then compared. So the tag comes from the provider's own `categories`
     * array, and `null` — "the provider carried none" — is a distinct and preserved answer.
     */
    const categories = record.categories;
    const echoed =
      Array.isArray(categories) &&
      expectedCorrelationTag !== null &&
      categories.some((value) => value === expectedCorrelationTag)
        ? expectedCorrelationTag
        : null;

    out.push(
      Object.freeze({
        providerMessageId: id,
        providerStatus: status,
        providerTimestampMs: timestampMs,
        correlationTag: echoed,
      }),
    );
  }
  return Object.freeze(out);
}

/**
 * `GET https://api.sendgrid.com/v3/messages`. THE ONE ACTIVITY-SEARCH CALL SITE.
 *
 * PERIMETER_EXEMPT(audit_plane_read_only, 48-3-6) — `48 §2` row 13. Read-only: the method is
 * the literal `'GET'` and this function has no branch that mutates provider state. The
 * `36 §13` empirical attempted-write test is separately owed and is not performed here.
 */
export async function readFromProviderSendGridActivity(input: {
  readonly secret: string;
  readonly query: SendGridActivityQuery;
}): Promise<SendGridReadResponse> {
  const controller = new AbortController();
  const deadline = setTimeout(() => {
    controller.abort();
  }, SENDGRID_READ_DEADLINE_MS);

  try {
    const search = new URLSearchParams({
      query: buildActivityQuery(input.query),
      limit: String(input.query.limit),
    });
    // PERIMETER_EXEMPT(audit_plane_read_only, 48-3-6) — 48 §2 row 13. The destination is
    // `SENDGRID_API_ORIGIN` and `SENDGRID_MESSAGES_PATH`, both module constants; the only
    // caller-supplied values are a correlation tag and two timestamps, inside the documented
    // query language.
    const response = await globalThis.fetch(
      `${SENDGRID_API_ORIGIN}${SENDGRID_MESSAGES_PATH}?${search.toString()}`,
      {
        method: 'GET',
        headers: { authorization: `Bearer ${input.secret}` },
        signal: controller.signal,
      },
    );
    if (!response.ok) {
      /*
       * A NON-OK READ IS `ANSWERED` WITH NO RECORDS, NOT `NOT_REACHED`.
       *
       * The two are different facts and the audit host maps them differently: the provider
       * answering 403 (the documented "key lacks Email Activity permission" case) is
       * evidence about the CREDENTIAL, and a socket that never opened is evidence about the
       * NETWORK. Collapsing them would make a scope failure look like an outage.
       */
      return { kind: 'ANSWERED', httpStatus: response.status, records: Object.freeze([]) };
    }
    const payload = (await response.json()) as unknown;
    return {
      kind: 'ANSWERED',
      httpStatus: response.status,
      records: normaliseActivityRecords(payload, input.query.correlationTag),
    };
  } catch {
    // The exception is not read and its message never crosses the process boundary (`§23`).
    return { kind: 'NOT_REACHED' };
  } finally {
    clearTimeout(deadline);
  }
}

/**
 * `GET https://api.sendgrid.com/v3/messages/{msg_id}`. THE ONE ACTIVITY-DETAIL CALL SITE.
 *
 * A SECOND declaration rather than a widened first one, because the two reach different
 * documented endpoints and `48 §4` item 2 annotates SITES: a single function that chose its
 * path from an argument would be one site standing for two destinations, and the argument
 * that chose would be the arbitrary-URL member this package must not have.
 *
 * `providerMessageId` is the ONE caller value that reaches a path. It is shape-checked
 * against `MESSAGE_ID_GRAMMAR` and percent-encoded before it does, so a value carrying `/`,
 * `?`, `#` or `..` never becomes a path segment.
 *
 * PERIMETER_EXEMPT(audit_plane_read_only, 48-3-6) — `48 §2` row 13. Read-only: the method is
 * the literal `'GET'` and this function has no branch that mutates provider state.
 */
export async function readFromProviderSendGridMessage(input: {
  readonly secret: string;
  readonly providerMessageId: string;
  readonly expectedCorrelationTag: string | null;
}): Promise<SendGridReadResponse> {
  if (!isUsableProviderMessageId(input.providerMessageId)) {
    // Refused BEFORE the boundary. A message id that is not one is not a destination.
    return { kind: 'ANSWERED', httpStatus: 400, records: Object.freeze([]) };
  }

  const controller = new AbortController();
  const deadline = setTimeout(() => {
    controller.abort();
  }, SENDGRID_READ_DEADLINE_MS);

  try {
    const segment = encodeURIComponent(input.providerMessageId);
    // PERIMETER_EXEMPT(audit_plane_read_only, 48-3-6) — 48 §2 row 13. The destination is
    // `SENDGRID_API_ORIGIN` and `SENDGRID_MESSAGES_PATH`, both module constants, plus one
    // shape-checked and percent-encoded message id.
    const response = await globalThis.fetch(
      `${SENDGRID_API_ORIGIN}${SENDGRID_MESSAGES_PATH}/${segment}`,
      {
        method: 'GET',
        headers: { authorization: `Bearer ${input.secret}` },
        signal: controller.signal,
      },
    );
    if (!response.ok) {
      return { kind: 'ANSWERED', httpStatus: response.status, records: Object.freeze([]) };
    }
    const payload = (await response.json()) as unknown;
    /*
     * The detail endpoint returns ONE message object rather than a `messages` array, so it
     * is wrapped into the shape `normaliseActivityRecords` reads. Wrapping rather than
     * writing a second reducer keeps ONE normalisation path, and therefore one place where
     * the "no recipient address is read" property has to hold.
     */
    return {
      kind: 'ANSWERED',
      httpStatus: response.status,
      records: normaliseActivityRecords({ messages: [payload] }, input.expectedCorrelationTag),
    };
  } catch {
    return { kind: 'NOT_REACHED' };
  } finally {
    clearTimeout(deadline);
  }
}
```

#### `validation/sendgrid/audit/reader.ts` (complete)

```typescript
import type {
  AuditProviderReader,
  ProviderReadQuery,
  ProviderReadResult,
} from '../../../src/audit/provider/runtime/auditProviderReader.js';
import { PROVIDER_READ_BOUNDARY } from '../../../src/audit/provider/runtime/auditProviderReader.js';
import type { AuditReadCredential } from '../../../src/audit/provider/runtime/auditSecretSource.js';
import {
  readFromProviderSendGridActivity,
  readFromProviderSendGridMessage,
  type SendGridReadResponse,
} from './providerReadClient.js';

/**
 * THE SENDGRID Z4 AUDIT READER — `twilio_sendgrid`. READ-ONLY, BY CONSTRUCTION.
 *
 * =================================================================================
 * WHERE THIS RUNS, AND WHAT HAS ALREADY BEEN CHECKED BEFORE IT DOES
 *
 * This module is loaded by `src/audit/provider/runtime/main.ts`, inside the audit plane's own
 * `child_process.fork` — a process whose PID differs from the control process AND from the
 * integration runtime, whose environment is a nine-key constructed allowlist disjoint from
 * the integration plane's BY COMPUTATION, and whose credential comes from a source the
 * integration plane does not hold a locator for.
 *
 * By the time `readFromProvider` runs, the ACCEPTED audit host has already:
 *
 *   1. decoded the request against the closed read-only schema (unknown operation: REFUSED);
 *   2. checked the provider identity against this reader's own;
 *   3. checked this reader carries NO mutation member — fourteen names refused, plus any
 *      member outside the declared three;
 *   4. checked the signed class-5 risk class is `READ_ONLY`;
 *   5. resolved the credential from the AUDIT plane's own source;
 *   6. checked the labels are not the secret;
 *   7. compared the resolved material's identity to the signed `credential_id`, BEFORE this
 *      function is reached.
 *
 * **AND THE SIGNED RECORD IT ACTED ON WAS READ BY THE AUDIT PLANE'S OWN VERIFIER**, from its
 * own copy through its own deployment variables — never from the control plane's bundle.
 * `S1O-C3`: an audit reader admitted on the control plane's reading of the record that says
 * it is read-only is an audit plane trusting the plane it audits for its own independence.
 *
 * =================================================================================
 * IT CANNOT SEND, AND NOT BECAUSE IT CHOOSES NOT TO
 *
 * `isAuditProviderReader` admits an object with EXACTLY `providerId`, `boundary` and
 * `readFromProvider`, and refuses one carrying any of fourteen mutation member names. This
 * object has three members. `providerReadClient.ts` declares no `sendToProvider*` function
 * for it to call. The audit IPC wire has three operations and no `SEND`, no `CREATE`, no
 * `RAW` and no `PASSTHROUGH`.
 *
 * **THE `36 §13` ATTEMPTED-WRITE PROBE IS IN A DIFFERENT FILE THIS ONE DOES NOT IMPORT.**
 * `§8.2`: the negative control "must be an explicitly isolated validation/probe path that
 * cannot become a production audit capability."
 *
 * =================================================================================
 * AND IT DOES NOT TRUST THE CONTROL PLANE'S ACCOUNT OF THE SEND
 *
 * `§8.2`: "no reliance on integration/control-plane claims that 'SendGrid accepted it'".
 * `ProviderReadQuery` carries a period, an optional correlation tag, an optional provider
 * message id and a record bound. There is no member an ACOS outcome, an ACOS effect state or
 * a control-plane verdict could occupy, and `ProviderReadResponse` has no `verified`,
 * `matched` or `expected` member for one to travel back on.
 * =================================================================================
 */

const PROVIDER_ID = 'twilio_sendgrid';

/** Translate one client response into the closed audit result taxonomy. PURE. */
export function toProviderReadResult(
  response: SendGridReadResponse,
  operation: ProviderReadQuery['operation'],
): ProviderReadResult {
  if (response.kind === 'NOT_REACHED') return { kind: 'PROVIDER_UNAVAILABLE' };

  /*
   * A NON-OK ANSWER IS EVIDENCE OF ZERO RECORDS, NOT `PROVIDER_UNAVAILABLE`.
   *
   * The documented 403 — "the key lacks Email Activity permission" — is the single most
   * important read this package can get, because it is what `§8.7`'s audit-credential
   * capability probe measures. Mapping it to `PROVIDER_UNAVAILABLE` would make a scope
   * finding indistinguishable from an outage, so the status is preserved and the harness
   * reads it from the probe rather than from this taxonomy, which has nowhere to put it.
   *
   * The evidence a non-OK read yields is therefore an HONEST EMPTY: zero records, count
   * zero. The observation loop treats "the provider answered and held nothing" as
   * inconclusive rather than as proof of a negative, which is `§12`'s unknown-outcome rule.
   */
  if (operation === 'MESSAGE_ACTIVITY_COUNT') {
    return { kind: 'EVIDENCE', records: Object.freeze([]), recordCount: response.records.length };
  }
  return {
    kind: 'EVIDENCE',
    records: response.records.map((record) =>
      Object.freeze({
        providerMessageId: record.providerMessageId,
        providerStatus: record.providerStatus,
        providerTimestampMs: record.providerTimestampMs,
        correlationTag: record.correlationTag,
      }),
    ),
    recordCount: response.records.length,
  };
}

export const auditProviderReader: AuditProviderReader = {
  providerId: PROVIDER_ID,
  boundary: PROVIDER_READ_BOUNDARY,

  async readFromProvider(
    credential: AuditReadCredential,
    query: ProviderReadQuery,
  ): Promise<ProviderReadResult> {
    if (query.operation === 'MESSAGE_ACTIVITY_DETAIL') {
      if (query.providerMessageId === null) {
        // The host's `OPERATION_ARGUMENTS_INVALID` covers this; the reader refuses again
        // rather than dereferencing, because a reader that relied on its host's validation
        // would be a reader whose safety lived in another module.
        return { kind: 'PROVIDER_UNAVAILABLE' };
      }
      // PERIMETER_EXEMPT(audit_plane_read_only, 48-3-6) — 48 §2 row 13.
      const detail = await readFromProviderSendGridMessage({
        secret: credential.secret,
        providerMessageId: query.providerMessageId,
        expectedCorrelationTag: query.correlationTag,
      });
      return toProviderReadResult(detail, query.operation);
    }

    // PERIMETER_EXEMPT(audit_plane_read_only, 48-3-6) — 48 §2 row 13. `MESSAGE_ACTIVITY_SEARCH`
    // and `MESSAGE_ACTIVITY_COUNT` reach the same documented endpoint; the COUNT operation
    // differs only in what the audit plane is told back, never in what is queried.
    const activity = await readFromProviderSendGridActivity({
      secret: credential.secret,
      query: {
        correlationTag: query.correlationTag,
        periodStartMs: query.periodStartMs,
        periodEndMs: query.periodEndMs,
        limit: query.maxRecords,
      },
    });
    return toProviderReadResult(activity, query.operation);
  },
};
```

#### `validation/sendgrid/audit/secretSource.ts` (complete)

```typescript
import { readFileSync } from 'node:fs';

import type {
  AuditCredentialIdentityProvenance,
  AuditReadSecretSource,
  AuditSecretResolution,
} from '../../../src/audit/provider/runtime/auditSecretSource.js';

/**
 * THE SENDGRID AUDIT READ CREDENTIAL'S SOURCE — `§13`, `48 §3.6`, `50 §2g` FIELD 1.
 *
 * =================================================================================
 * IT IS A DIFFERENT SOURCE, IN A DIFFERENT PACKAGE, READING A DIFFERENT DOCUMENT
 *
 * `§14` of the S1O mandate requires the audit plane to hold "separate credential source;
 * separate environment allowlist; no control send credential". All three are properties of
 * the composition rather than checks this file performs:
 *
 *   - this module is loaded from `ACOS_AUDIT_READ_SECRET_SOURCE_MODULE`, a key that does not
 *     exist in the integration plane's eight-key allowlist;
 *   - its locator arrives on `ACOS_AUDIT_READ_SECRET_LOCATOR`, likewise;
 *   - `createAuditReaderRegistry` refuses `READER_LOCATOR_SHARED_WITH_INTEGRATION` when the
 *     two locators collide, so the deployment cannot point them at one document.
 *
 * **AND THE INTEGRATION PACKAGE IS NOT IMPORTED HERE.** `validation/sendgrid/integration/`
 * and `validation/sendgrid/audit/` share no module; `tests/sendgrid/plane-separation.test.ts`
 * asserts the two import closures are disjoint, which is the same property
 * `tools/integration-packaging/` asserts for the two synthetic adapters.
 *
 * =================================================================================
 * THE IDENTITY, AND WHY `SYNTHETIC_TEST_IDENTITY` IS REFUSED HERE TOO
 *
 * `48 §3.6`'s read-only exemption rests on a signed declaration, and the declaration is only
 * about the credential in hand if the source can name what it resolved in a form the PROVIDER
 * or the SECRET MANAGER establishes. A friendly label such as `"audit-read-key"` is a string
 * the source chose, and `§3` of the S1P mandate rules it out by name.
 *
 * So this source accepts `PROVIDER_KEY_ID` — SendGrid's own `api_key_id` for the audit key —
 * or `DEPLOYMENT_SECRET_VERSION`, and refuses the fixture provenance the S1O synthetic reader
 * legitimately uses. A live audit read cannot proceed on a fixture's word about which
 * credential it holds.
 * =================================================================================
 */

interface AuditDeploymentDocument {
  readonly providerId?: unknown;
  readonly apiKey?: unknown;
  readonly credentialIdentity?: unknown;
  readonly identityProvenance?: unknown;
  readonly version?: unknown;
  readonly revoked?: unknown;
}

/** The provenances a REAL audit credential may declare. The fixture one is absent. */
export const LIVE_AUDIT_IDENTITY_PROVENANCES: readonly AuditCredentialIdentityProvenance[] =
  Object.freeze(['PROVIDER_KEY_ID', 'DEPLOYMENT_SECRET_VERSION']);

export function isLiveAuditIdentityProvenance(
  value: unknown,
): value is AuditCredentialIdentityProvenance {
  return (
    typeof value === 'string' &&
    (LIVE_AUDIT_IDENTITY_PROVENANCES as readonly string[]).includes(value)
  );
}

/**
 * A SECOND implementation of the derived-label refusal, for the reason the accepted planes
 * each carry their own: these two packages share no module, and a rule this small is cheaper
 * to restate than a coupling between the send side and the audit side is to justify.
 */
export function auditIdentityIsDerivedFromSecret(identity: string, secret: string): boolean {
  if (identity.length === 0 || secret.length === 0) return true;
  if (identity.includes(secret) || secret.includes(identity)) return true;
  if (identity === Buffer.from(secret, 'utf8').toString('hex')) return true;
  if (identity === Buffer.from(secret, 'utf8').toString('base64')) return true;
  return false;
}

class SendGridAuditSecretSource implements AuditReadSecretSource {
  public readonly declaredProviderId: string;

  private readonly locator: string;

  public constructor(providerId: string, locator: string) {
    this.declaredProviderId = providerId;
    this.locator = locator;
  }

  /**
   * `resolve()` TAKES NO ARGUMENT, and that is the accepted contract rather than a
   * convenience: a source with a selector signature is a source that CAN be asked for
   * another scope's material, and the only thing between the ask and the answer would be a
   * check inside the source.
   */
  public resolve(): Promise<AuditSecretResolution> {
    let document: AuditDeploymentDocument;
    try {
      document = JSON.parse(readFileSync(this.locator, 'utf8')) as AuditDeploymentDocument;
    } catch {
      return Promise.resolve({ kind: 'UNAVAILABLE' });
    }

    if (document.providerId !== this.declaredProviderId) {
      return Promise.resolve({ kind: 'UNAVAILABLE' });
    }
    if (document.revoked === true) return Promise.resolve({ kind: 'CREDENTIAL_REVOKED' });

    const secret = document.apiKey;
    if (typeof secret !== 'string' || secret.length === 0) {
      return Promise.resolve({ kind: 'UNAVAILABLE' });
    }
    const identity = document.credentialIdentity;
    if (typeof identity !== 'string' || identity.length === 0) {
      return Promise.resolve({ kind: 'UNAVAILABLE' });
    }
    if (!isLiveAuditIdentityProvenance(document.identityProvenance)) {
      return Promise.resolve({ kind: 'UNAVAILABLE' });
    }
    if (auditIdentityIsDerivedFromSecret(identity, secret)) {
      return Promise.resolve({ kind: 'UNAVAILABLE' });
    }

    return Promise.resolve({
      kind: 'RESOLVED',
      credential: {
        secret,
        credentialIdentity: identity,
        identityProvenance: document.identityProvenance,
        version: typeof document.version === 'string' ? document.version : null,
      },
    });
  }
}

export function createAuditReadSecretSource(input: {
  readonly providerId: string;
  readonly locator: string;
}): AuditReadSecretSource {
  return new SendGridAuditSecretSource(input.providerId, input.locator);
}
```

### G.7 The scope-probe implementation — the isolated prohibited-write probe

**This is the file the reviewer asked to see in order to verify that the audit credential's
prohibited send/write probe is isolated from normal audit IPC.** It is reproduced complete.

Isolation evidence, each independently checkable:

| Claim | Where it is checkable |
|---|---|
| it is not in the audit package | path is `validation/sendgrid/harness/scopeProbes.ts` |
| the audit reader does not import it | `grep -rn scopeProbes validation/sendgrid/audit/` → no match; and the closure assertion in `tests/sendgrid/prerequisites-and-separation.test.ts` requires the audit runtime's import closure to contain **zero** `validation/sendgrid/harness/` modules |
| no audit IPC message reaches it | the audit wire (G.3) has three operations, all read; `auditReadHost.ts` (G.2) dispatches only to `reader.readFromProvider` |
| no ACOS runtime holds it | nothing under `src/` imports `validation/` (see `§K`) |
| it is separately annotated at the perimeter | `PERIMETER_EXEMPT(credential_scope_conformance_probe, 36-13)` — a different reason and ticket from the audit read exemption, enumerated separately in `§H` |
| it is reached only by an operator | its only importer is `harness/cli.ts`-adjacent harness code invoked through `npm run validate:sendgrid` |

**What is NOT claimed:** the harness process, while it runs, holds both credentials in memory.
It is an operator tool rather than a plane or a deployed runtime. That trade-off is stated in
`docs/implementation/S1P-owner-clarifications.md §S1P-C5` and is a legitimate review target.

#### `validation/sendgrid/harness/scopeProbes.ts` (complete)

```typescript
import {
  SENDGRID_API_ORIGIN,
  SENDGRID_MESSAGES_PATH,
  buildActivityQuery,
} from '../audit/providerReadClient.js';
import { SENDGRID_MAIL_SEND_PATH, buildSendGridSendRequest } from '../integration/requestMapping.js';

/**
 * `§8.7` — THE EMPIRICAL CREDENTIAL-CAPABILITY PROBES. THE PART NO DECLARATION DISCHARGES.
 *
 * =================================================================================
 * WHY THESE EXIST AT ALL, IN ONE SENTENCE FROM THE ACCEPTED S1O RESULT
 *
 * "**A SIGNED `READ_ONLY` DECLARATION IS NOT THE ATTEMPTED-WRITE TEST.** The declaration says
 * what the deployment believes it provisioned; `36 §13` asks the vendor."
 *
 * And the S1O correction's own limit on what the identity binding bought: it proves *"this is
 * credential A"*; it does not prove *"credential A still holds the provider permissions the
 * signed record declares"*. A scoped provider key is mutable at the provider with no
 * ACOS-observable event. **Scope drift is empirical or it is unproven.**
 *
 * =================================================================================
 * WHY THIS FILE IS IN `harness/` AND NOT IN `audit/`, WHICH IS THE WHOLE OF `§8.2`
 *
 * `§8.2`, verbatim: "Do NOT add a normal audit IPC 'send' method just to perform the negative
 * control. The negative control must be an explicitly isolated validation/probe path that
 * cannot become a production audit capability."
 *
 * So the attempted-write probe is NOT in the audit reader's package:
 *
 *   - `validation/sendgrid/audit/` declares NO `sendToProvider*` function, and
 *     `perimeter-enumeration.test.ts` asserts zero send sites under it;
 *   - `reader.ts` does not import this module, and
 *     `tests/sendgrid/plane-separation.test.ts` asserts the audit reader's import closure
 *     does not contain it;
 *   - the audit read IPC has three operations and none of them reaches this file, so no
 *     message the audit plane can receive causes a probe;
 *   - nothing under `src/` imports `validation/`, so no ACOS runtime holds this capability.
 *
 * **THE HARNESS IS THE OPERATOR, NOT A PLANE.** This module is reached only from
 * `cli.ts`, which a human invokes with an explicit acknowledgement token, and the credential
 * it is handed is read by that CLI from the operator's own deployment documents. It is not a
 * capability of the audit runtime, of the integration runtime or of the control plane, and it
 * is not reachable from any of them.
 *
 * =================================================================================
 * WHAT A PROBE MAY AND MAY NOT CONCLUDE
 *
 * A probe records the OPERATION ATTEMPTED, the NON-SECRET CREDENTIAL IDENTITY, the PROVIDER'S
 * HTTP STATUS and an OUTCOME CLASSIFICATION. It concludes nothing from a key's name, its id,
 * its operator label, the configuration that created it or the fact that it was INTENDED to
 * be read-only — `§8.7` forbids each of those by name.
 *
 * And a probe that could not run is recorded as `NOT_RUN`, never as a pass. `§8.7`: "If
 * provider entitlements prevent a required probe, report PARTIAL."
 * =================================================================================
 */

/** The transport deadline for one probe. */
export const PROBE_DEADLINE_MS = 12_000;

/** What one capability probe concluded. A closed set; there is no "probably". */
export const PROBE_OUTCOMES = [
  /** The provider performed the operation. The credential HOLDS the capability. */
  'CAPABILITY_CONFIRMED',
  /** The provider refused on authorisation/scope. The credential LACKS the capability. */
  'CAPABILITY_REFUSED_BY_PROVIDER',
  /** The provider answered, and the answer settles neither. Recorded, never rounded. */
  'INCONCLUSIVE',
  /** The provider was not reached. NOT a refusal, and never reported as one. */
  'PROVIDER_UNREACHABLE',
  /** The probe did not run. NEVER a pass. */
  'NOT_RUN',
] as const;

export type ProbeOutcome = (typeof PROBE_OUTCOMES)[number];

/** One probe's sanitized record. NO MEMBER CAN CARRY A SECRET. */
export interface ProbeRecord {
  /** e.g. `POST /v3/mail/send`. The operation attempted, verbatim. */
  readonly operation: string;
  /** The NON-SECRET credential identity. `§8.7`: "credential identity, never secret". */
  readonly credentialIdentity: string;
  /** The provider's own HTTP status, or `null` when it did not answer. */
  readonly httpStatus: number | null;
  readonly outcome: ProbeOutcome;
  /** Why the outcome is what it is, in words a reviewer can check. Never a provider body. */
  readonly note: string;
}

/**
 * SendGrid's documented refusal statuses for a credential lacking a scope.
 *
 * S1O's capability record cites the published converse — "a key lacking Email Activity
 * permission receives 403 Access Forbidden from `GET /v3/messages`" — and 401 is the
 * unauthenticated case. Both are refusals BY THE PROVIDER; neither is inferred from a label.
 */
const SCOPE_REFUSAL_STATUSES: readonly number[] = Object.freeze([401, 403]);

function classify(status: number, acceptedStatuses: readonly number[]): ProbeOutcome {
  if (acceptedStatuses.includes(status)) return 'CAPABILITY_CONFIRMED';
  if (SCOPE_REFUSAL_STATUSES.includes(status)) return 'CAPABILITY_REFUSED_BY_PROVIDER';
  return 'INCONCLUSIVE';
}

/**
 * `36 §13` — ATTEMPT A SEND WITH THE AUDIT CREDENTIAL, AND EXPECT THE PROVIDER TO REFUSE.
 *
 * THE EXPECTATION IS NOT THE EVIDENCE. This function does not assert; it RECORDS what
 * SendGrid answered, and `CAPABILITY_CONFIRMED` here — the audit key CAN send — is a
 * finding, a serious one, and the harness reports it as a failure of the provisioning rather
 * than hiding it.
 *
 * The body it attempts is the ordinary validation body: the owner-controlled sink, the
 * scenario's own correlation tag, `sandbox_mode` explicitly false. So in the failure case —
 * a mis-scoped audit key that CAN send — the message that escapes goes to the owner's own
 * sink, carries no business content, and is queryable under its own tag, which is the
 * smallest possible consequence of discovering the thing this probe exists to discover.
 *
 * PERIMETER_EXEMPT(credential_scope_conformance_probe, 36-13) — `48 §2` row 13's neighbour.
 * This site carries NO `authorisation_ref` and must not pretend to: there is no ACOS effect
 * behind it, no claim, no outbox row and no dispatch. It is an operator-invoked capability
 * measurement against a non-production account, and recording it as an annotated, ticketed,
 * reviewed exemption is `48 §3`'s own answer to a hole that has to exist.
 */
export async function sendToProviderSendGridScopeProbe(input: {
  readonly auditSecret: string;
  readonly auditCredentialIdentity: string;
  readonly correlationTag: string;
  readonly senderAddress: string;
  readonly sinkAddress: string;
}): Promise<ProbeRecord> {
  const mapped = buildSendGridSendRequest({
    correlationTag: input.correlationTag,
    senderAddress: input.senderAddress,
    sinkAddress: input.sinkAddress,
    sandboxMode: false,
  });
  if (mapped.kind === 'REFUSED') {
    return {
      operation: `POST ${SENDGRID_MAIL_SEND_PATH}`,
      credentialIdentity: input.auditCredentialIdentity,
      httpStatus: null,
      outcome: 'NOT_RUN',
      note: `the validation body could not be constructed: ${mapped.reason}`,
    };
  }

  const controller = new AbortController();
  const deadline = setTimeout(() => {
    controller.abort();
  }, PROBE_DEADLINE_MS);
  try {
    // PERIMETER_EXEMPT(credential_scope_conformance_probe, 36-13) — the 36 §13 attempted-write
    // test, with the READ-ONLY credential, against a dedicated non-production account.
    const response = await globalThis.fetch(`${SENDGRID_API_ORIGIN}${SENDGRID_MAIL_SEND_PATH}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${input.auditSecret}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(mapped.body),
      signal: controller.signal,
    });
    const outcome = classify(response.status, [202]);
    return {
      operation: `POST ${SENDGRID_MAIL_SEND_PATH}`,
      credentialIdentity: input.auditCredentialIdentity,
      httpStatus: response.status,
      outcome,
      note:
        outcome === 'CAPABILITY_REFUSED_BY_PROVIDER'
          ? '36 §13 satisfied for this credential at this moment: SendGrid refused a send ' +
            'attempted with the audit credential'
          : outcome === 'CAPABILITY_CONFIRMED'
            ? 'THE AUDIT CREDENTIAL CAN SEND. 48 §3.6 read-only exemption is NOT earned by ' +
              'this credential and the provisioning is wrong'
            : 'the provider answered with a status that settles neither capability',
    };
  } catch {
    return {
      operation: `POST ${SENDGRID_MAIL_SEND_PATH}`,
      credentialIdentity: input.auditCredentialIdentity,
      httpStatus: null,
      outcome: 'PROVIDER_UNREACHABLE',
      note: 'the provider was not reached; a refusal was NOT observed and is not claimed',
    };
  } finally {
    clearTimeout(deadline);
  }
}

/**
 * THE READ CAPABILITY, MEASURED IN BOTH DIRECTIONS.
 *
 * Run twice by the harness: once with the AUDIT credential, where `CAPABILITY_CONFIRMED` is
 * the required result, and once with the INTEGRATION credential, where
 * `CAPABILITY_REFUSED_BY_PROVIDER` is what a correctly scoped `mail.send`-only key produces.
 * `§8.7`: "Where safe and useful, also prove prohibited cross-capability access in the other
 * direction."
 *
 * The second direction is safe in a way the send probe is not: a read cannot mutate, so the
 * worst case of a mis-scoped send key is a record read, not a message sent.
 *
 * PERIMETER_EXEMPT(credential_scope_conformance_probe, 36-13) — an operator-invoked
 * capability measurement with no ACOS effect behind it, carrying no `authorisation_ref` and
 * not pretending to.
 */
export async function probeActivityReadCapability(input: {
  readonly secret: string;
  readonly credentialIdentity: string;
  readonly periodStartMs: number;
  readonly periodEndMs: number;
}): Promise<ProbeRecord> {
  const controller = new AbortController();
  const deadline = setTimeout(() => {
    controller.abort();
  }, PROBE_DEADLINE_MS);
  const search = new URLSearchParams({
    query: buildActivityQuery({
      correlationTag: null,
      periodStartMs: input.periodStartMs,
      periodEndMs: input.periodEndMs,
      limit: 1,
    }),
    limit: '1',
  });
  try {
    // PERIMETER_EXEMPT(credential_scope_conformance_probe, 36-13) — measures whether THIS
    // credential holds `email_activity.read` at the provider, rather than assuming it from
    // the key's name, its id, its label or the request that created it.
    const response = await globalThis.fetch(
      `${SENDGRID_API_ORIGIN}${SENDGRID_MESSAGES_PATH}?${search.toString()}`,
      {
        method: 'GET',
        headers: { authorization: `Bearer ${input.secret}` },
        signal: controller.signal,
      },
    );
    const outcome = classify(response.status, [200]);
    return {
      operation: `GET ${SENDGRID_MESSAGES_PATH}`,
      credentialIdentity: input.credentialIdentity,
      httpStatus: response.status,
      outcome,
      note:
        outcome === 'CAPABILITY_CONFIRMED'
          ? 'the credential holds email_activity.read at the provider'
          : outcome === 'CAPABILITY_REFUSED_BY_PROVIDER'
            ? 'the provider refused the read for this credential'
            : 'the provider answered with a status that settles neither capability; a 4xx ' +
              'other than 401/403 may indicate the Email Activity entitlement is absent ' +
              'rather than the scope',
    };
  } catch {
    return {
      operation: `GET ${SENDGRID_MESSAGES_PATH}`,
      credentialIdentity: input.credentialIdentity,
      httpStatus: null,
      outcome: 'PROVIDER_UNREACHABLE',
      note: 'the provider was not reached; no capability conclusion is drawn',
    };
  } finally {
    clearTimeout(deadline);
  }
}
```

---

## H. External-write perimeter change

### H.1 Pre-S1P roots, at `d897833`

```typescript
export const DEFAULT_PERIMETER_ROOTS: readonly string[] = [
  'src',
  join('tests', 'integration-plane'),
  // S1O's synthetic Z4 audit reader. Scanned under TEST_ONLY scope for the same reason
  // `tests/integration-plane/` is: its sites must be annotated and are never counted as
  // production perimeter entries (`§18`), and including it is what makes the
  // `PROVIDER_READ_CLIENT` kind non-vacuous today — the repository has no real audit
  // read, so a scanner looking only at `src/` would report zero read sites forever.
  join('tests', 'audit-plane'),
];
```

### H.2 Current roots

```typescript
export const DEFAULT_PERIMETER_ROOTS: readonly string[] = [
  'src',
  join('tests', 'integration-plane'),
  // S1O's synthetic Z4 audit reader. Scanned under TEST_ONLY scope for the same reason
  // `tests/integration-plane/` is: its sites must be annotated and are never counted as
  // production perimeter entries (`§18`), and including it is what makes the
  // `PROVIDER_READ_CLIENT` kind non-vacuous today — the repository has no real audit
  // read, so a scanner looking only at `src/` would report zero read sites forever.
  join('tests', 'audit-plane'),
  /*
   * S1P's Twilio SendGrid non-production validation package, AND THE FIRST ROOT HERE WHOSE
   * SITES ARE REAL.
   *
   * **ITS FIRST PATH SEGMENT IS NOT `tests`, SO ITS SITES ARE SCANNED AT `PRODUCTION`
   * SCOPE, AND THAT IS THE POINT.** `§18` scopes the `TEST_ONLY` carve-out to a "test
   * synthetic provider"; `validation/sendgrid/` is not synthetic — its clients reach
   * `api.sendgrid.com`. Admitting a real vendor client into the scope that is EXCLUDED
   * from the production perimeter count is exactly the quiet weakening `48 §7` question 4
   * exists to catch, so the send sites here must carry
   * `PERIMETER_AUTHORISED(authorisation_ref)`, the audit-plane read sites must carry
   * `PERIMETER_EXEMPT(audit_plane_read_only, 48-3-6)`, the operator-invoked capability
   * probes must carry `PERIMETER_EXEMPT(credential_scope_conformance_probe, 36-13)`, and an
   * unannotated site fails the build.
   */
  'validation',
];
```

### H.3 Complete diff for `tools/perimeter/perimeterScan.ts`

```diff
diff --git a/tools/perimeter/perimeterScan.ts b/tools/perimeter/perimeterScan.ts
index 30353f3..19d7c85 100644
--- a/tools/perimeter/perimeterScan.ts
+++ b/tools/perimeter/perimeterScan.ts
@@ -179,6 +179,22 @@ export const DEFAULT_PERIMETER_ROOTS: readonly string[] = [
   // `PROVIDER_READ_CLIENT` kind non-vacuous today — the repository has no real audit
   // read, so a scanner looking only at `src/` would report zero read sites forever.
   join('tests', 'audit-plane'),
+  /*
+   * S1P's Twilio SendGrid non-production validation package, AND THE FIRST ROOT HERE WHOSE
+   * SITES ARE REAL.
+   *
+   * **ITS FIRST PATH SEGMENT IS NOT `tests`, SO ITS SITES ARE SCANNED AT `PRODUCTION`
+   * SCOPE, AND THAT IS THE POINT.** `§18` scopes the `TEST_ONLY` carve-out to a "test
+   * synthetic provider"; `validation/sendgrid/` is not synthetic — its clients reach
+   * `api.sendgrid.com`. Admitting a real vendor client into the scope that is EXCLUDED
+   * from the production perimeter count is exactly the quiet weakening `48 §7` question 4
+   * exists to catch, so the send sites here must carry
+   * `PERIMETER_AUTHORISED(authorisation_ref)`, the audit-plane read sites must carry
+   * `PERIMETER_EXEMPT(audit_plane_read_only, 48-3-6)`, the operator-invoked capability
+   * probes must carry `PERIMETER_EXEMPT(credential_scope_conformance_probe, 36-13)`, and an
+   * unannotated site fails the build.
+   */
+  'validation',
 ];
 
 async function typescriptFilesUnder(root: string): Promise<readonly string[]> {
```

### H.4 Complete perimeter test changes

```diff
diff --git a/tests/integration/perimeter/perimeter-enumeration.test.ts b/tests/integration/perimeter/perimeter-enumeration.test.ts
index 7d3cb04..f3475bd 100644
--- a/tests/integration/perimeter/perimeter-enumeration.test.ts
+++ b/tests/integration/perimeter/perimeter-enumeration.test.ts
@@ -1,3 +1,5 @@
+import { join } from 'node:path';
+
 import { describe, expect, it } from 'vitest';
 
 import {
@@ -60,9 +62,33 @@ describe('`§17` — EVERY EXTERNAL-CLIENT CALL SITE IS ENUMERATED AND ANNOTATED
     expect(byRoot('adapterA')).toBeGreaterThanOrEqual(2);
     expect(byRoot('adapterB')).toBeGreaterThanOrEqual(2);
 
-    // AND EVERY ONE IS TEST_ONLY. `§18`: a synthetic provider "remains TEST-ONLY and is not
-    // a production perimeter entry."
-    expect(providerSites.every((site) => site.scope === 'TEST_ONLY')).toBe(true);
+    /*
+     * S1P AMENDS THE SECOND HALF OF THIS ASSERTION, OUT LOUD.
+     *
+     * It read: "AND EVERY ONE IS TEST_ONLY. `§18`: a synthetic provider 'remains TEST-ONLY
+     * and is not a production perimeter entry.'" That was true while every provider client
+     * in the repository was SYNTHETIC. S1P adds one that is not.
+     *
+     * So the rule is restated as what `§18` actually says — a site under `tests/` is
+     * TEST_ONLY and never a production entry — and the new obligation is added beside it:
+     * the real client is a PRODUCTION entry and must carry an `authorisation_ref`. The
+     * amended pair is strictly stronger than the sentence it replaces.
+     */
+    for (const site of providerSites.filter((entry) => entry.file.startsWith('tests'))) {
+      expect(site.scope, site.file).toBe('TEST_ONLY');
+    }
+
+    const sendGridSends = providerSites.filter((site) =>
+      site.file.includes(join('validation', 'sendgrid', 'integration')),
+    );
+    expect(sendGridSends.length).toBeGreaterThanOrEqual(2);
+    for (const site of sendGridSends) {
+      expect(site.scope, site.file).toBe('PRODUCTION');
+      // A SEND carries an `authorisation_ref`, never an exemption. `48 §4` item 2:
+      // "Production external writes require authorisation_ref."
+      expect(site.annotation.kind, site.file).toBe('AUTHORISED');
+    }
+    expect(report.productionAuthorised).toBeGreaterThanOrEqual(2);
   });
 
   it('`§18`: no broad exemption is admissible, and the banned list is enforced by value', () => {
@@ -71,7 +97,7 @@ describe('`§17` — EVERY EXTERNAL-CLIENT CALL SITE IS ENUMERATED AND ANNOTATED
     }
   });
 
-  it('the roots cover the control plane and BOTH synthetic planes', () => {
+  it(`the roots cover the control plane, BOTH synthetic planes and the real validation package`, () => {
     /*
      * S1O ADDS `tests/audit-plane/`, and the reason is `48 §3`'s own: "An exemption is not a
      * hole. It is a **named, annotated, reviewed** hole, and the difference is that a
@@ -79,10 +105,22 @@ describe('`§17` — EVERY EXTERNAL-CLIENT CALL SITE IS ENUMERATED AND ANNOTATED
      * an `authorisation_ref`; it does not exempt them from being ENUMERATED, and an
      * unenumerated read is unreviewed rather than exempt.
      */
+    /*
+     * S1P ADDS `validation/`, AND AMENDS THIS ACCEPTED ASSERTION OUT LOUD.
+     *
+     * `45 §3` warns about accepted boundary assertions changed quietly, so: the fourth root
+     * is the Twilio SendGrid non-production validation package, it holds the first REAL
+     * vendor clients this repository has ever contained, and its first path segment is
+     * deliberately NOT `tests` — `§18` scopes the `TEST_ONLY` carve-out to a "test synthetic
+     * provider", and a client that reaches `api.sendgrid.com` is not one. Its sites are
+     * therefore PRODUCTION perimeter entries, which is a WIDENING of what this check counts
+     * rather than a relaxation of what it requires.
+     */
     expect([...DEFAULT_PERIMETER_ROOTS]).toEqual([
       'src',
       expect.stringContaining('integration-plane'),
       expect.stringContaining('audit-plane'),
+      'validation',
     ]);
   });
 
@@ -94,24 +132,62 @@ describe('`§17` — EVERY EXTERNAL-CLIENT CALL SITE IS ENUMERATED AND ANNOTATED
 
     const reads = report.sites.filter((site) => site.kind === 'PROVIDER_READ_CLIENT');
     for (const site of reads) {
-      // TEST_ONLY, always: `§18` — a test fixture is never a production perimeter entry.
-      expect(site.scope, site.file).toBe('TEST_ONLY');
-      // A READ carries an EXEMPTION, never an `authorisation_ref`: the two annotations are
-      // different claims and neither may stand in for the other.
+      /*
+       * S1P AMENDS THE SCOPE HALF OF THIS ASSERTION TOO, AND FOR THE SAME REASON.
+       *
+       * It read "TEST_ONLY, always". S1P's SendGrid Email Activity reader is a real
+       * provider read at PRODUCTION scope; the ANNOTATION requirement is unchanged and is
+       * the half that carries the meaning — `48 §2` row 13's exemption is `48 §3.6`'s and
+       * no other, so the reason and the ticket are still asserted by value on every read
+       * site in either scope.
+       */
       expect(site.annotation.kind, site.file).toBe('EXEMPT');
       if (site.annotation.kind === 'EXEMPT') {
         expect(site.annotation.reason).toBe('audit_plane_read_only');
         expect(site.annotation.ticket).toBe('48-3-6');
       }
     }
+    // The synthetic reader stays TEST_ONLY; the real one is a PRODUCTION entry.
+    for (const site of reads.filter((entry) => entry.file.startsWith('tests'))) {
+      expect(site.scope, site.file).toBe('TEST_ONLY');
+    }
+    expect(
+      reads.some(
+        (site) =>
+          site.scope === 'PRODUCTION' && site.file.includes(join('validation', 'sendgrid')),
+      ),
+    ).toBe(true);
 
     // AND NO SEND CLIENT LIVES IN THE AUDIT PLANE. This is the assertion `§16`'s "no send
     // operation" reduces to at the perimeter: the scanner finds zero `sendToProvider*`
     // declarations or calls under `tests/audit-plane/`.
     const auditSends = report.sites.filter(
-      (site) => site.kind === 'PROVIDER_CLIENT' && site.file.includes('audit-plane'),
+      (site) =>
+        site.kind === 'PROVIDER_CLIENT' &&
+        (site.file.includes('audit-plane') ||
+          site.file.includes(join('validation', 'sendgrid', 'audit'))),
     );
     expect(auditSends).toEqual([]);
+
+    /*
+     * S1P EXTENDS THIS ASSERTION TO THE REAL AUDIT PACKAGE, which is where it matters most:
+     * `36 §13` needs an attempted-write probe, and `§8.2` forbids that probe from becoming a
+     * normal audit capability. It lives in `validation/sendgrid/harness/`, it is a PRODUCTION
+     * perimeter entry in its own right, and it carries its OWN exemption reason so a reviewer
+     * can never mistake it for a read.
+     */
+    const scopeProbes = report.sites.filter(
+      (site) =>
+        site.annotation.kind === 'EXEMPT' &&
+        site.annotation.reason === 'credential_scope_conformance_probe',
+    );
+    expect(scopeProbes.length).toBeGreaterThanOrEqual(1);
+    for (const site of scopeProbes) {
+      expect(site.file, 'a scope probe outside the harness').toContain(
+        join('validation', 'sendgrid', 'harness'),
+      );
+      if (site.annotation.kind === 'EXEMPT') expect(site.annotation.ticket).toBe('36-13');
+    }
   });
 
   it('and the rendered artifact is deterministic', async () => {
```

### H.5 Every production-scope site now enumerated under `validation/`

Verbatim from `npm run verify:perimeter` in this tree (full output in `§N`):

```text
PRODUCTION PROVIDER_READ_CLIENT EXEMPT(audit_plane_read_only, 48-3-6) validation\sendgrid\audit\providerReadClient.ts:190
PRODUCTION NETWORK_PRIMITIVE  EXEMPT(audit_plane_read_only, 48-3-6) validation\sendgrid\audit\providerReadClient.ts:208
PRODUCTION PROVIDER_READ_CLIENT EXEMPT(audit_plane_read_only, 48-3-6) validation\sendgrid\audit\providerReadClient.ts:256
PRODUCTION NETWORK_PRIMITIVE  EXEMPT(audit_plane_read_only, 48-3-6) validation\sendgrid\audit\providerReadClient.ts:276
PRODUCTION PROVIDER_READ_CLIENT EXEMPT(audit_plane_read_only, 48-3-6) validation\sendgrid\audit\reader.ts:122
PRODUCTION PROVIDER_READ_CLIENT EXEMPT(audit_plane_read_only, 48-3-6) validation\sendgrid\audit\reader.ts:133
PRODUCTION PROVIDER_CLIENT    EXEMPT(credential_scope_conformance_probe, 36-13) validation\sendgrid\harness\scopeProbes.ts:126
PRODUCTION NETWORK_PRIMITIVE  EXEMPT(credential_scope_conformance_probe, 36-13) validation\sendgrid\harness\scopeProbes.ts:156
PRODUCTION NETWORK_PRIMITIVE  EXEMPT(credential_scope_conformance_probe, 36-13) validation\sendgrid\harness\scopeProbes.ts:232
PRODUCTION PROVIDER_CLIENT    AUTHORISED                         validation\sendgrid\integration\adapter.ts:122
PRODUCTION PROVIDER_CLIENT    AUTHORISED                         validation\sendgrid\integration\providerClient.ts:98
PRODUCTION NETWORK_PRIMITIVE  AUTHORISED                         validation\sendgrid\integration\providerClient.ts:110
```

Counts, before and after:

| | at `d897833` | now |
|---|---|---|
| roots | 3 | 4 |
| production call sites | **0** | **12** |
| — carrying `authorisation_ref` | 0 | **3** |
| — annotated `PERIMETER_EXEMPT` | 0 | **9** |
| — unannotated | 0 | **0** |
| test-only call sites | 6 | 6 (unchanged) |
| provider READ sites | 2 | 6 |
| result | PASS | PASS |

### H.6 Why `validation/` was marked `PRODUCTION` — the evidence, not an argument

**The scope rule was NOT changed by S1P.** It is byte-identical at `d897833` and now:

```typescript
const scope: SiteScope = root.split(sep)[0] === 'tests' ? 'TEST_ONLY' : 'PRODUCTION';
```

- at `d897833` it is line **331**; now it is line **347**;
- `git diff d897833 -- tools/perimeter/perimeterScan.ts | grep -c SiteScope` returns **0**.

So the PRODUCTION classification is **mechanical, not elective**: the only S1P edit to that
file was adding the string `'validation'` to `DEFAULT_PERIMETER_ROOTS`, and the pre-existing
unchanged rule assigns PRODUCTION to any root whose first path segment is not `tests`. Placing
the tree under `tests/` would have produced TEST_ONLY by the same unchanged rule.

The stated reasoning for choosing a non-`tests` path is recorded in-repo at
`validation/sendgrid/README.md` and `docs/implementation/S1P-owner-clarifications.md §S1P-C2`,
and is summarised here **without endorsement**:

1. `§18` scopes the `TEST_ONLY` carve-out to a "test synthetic provider"; these clients reach
   `api.sendgrid.com`.
2. TEST_ONLY sites are excluded from the production perimeter count, so a real vendor client
   under `tests/` would not be counted as a production perimeter entry.
3. `src/` was rejected because three accepted suites forbid a vendor name, an adapter
   implementation and real transport there, and S1P did not widen any of them.

**Facts a reviewer may weigh against that reasoning:**

- the code is non-production by intent — it can only be reached through
  `npm run validate:sendgrid`, and no descriptor registers it (see `§F.4`, `§K`);
- marking it PRODUCTION raised `productionTotal` from 0 to 12 and changed what
  `perimeter-enumeration.test.ts` asserts, which required amending two accepted assertions
  about scope (H.4);
- an alternative not taken was a third `SiteScope` member; `SiteScope` is a closed two-member
  type and adding one would itself have been an accepted-type change.

---

## I. Live harness and preflight

All files complete. The scope-probe module is in `§G.7`; the kill-point map is in `§E.4`.

#### `validation/sendgrid/harness/preflight.ts` (complete)

```typescript
import { isOwnerControlledSink } from '../integration/requestMapping.js';
import { isLiveIdentityProvenance } from '../integration/secretSource.js';
import { isLiveAuditIdentityProvenance } from '../audit/secretSource.js';

/**
 * `§8.5` — THE LIVE-RUN GATE. IT FAILS CLOSED BEFORE ANY NETWORK ACTIVITY.
 *
 * =================================================================================
 * PURE, TOTAL, AND DELIBERATELY WITHOUT I/O
 *
 * `evaluatePreflight` reads no file, resolves no secret, opens no socket and calls no
 * provider. It takes a record of FACTS the CLI has already established and returns the list
 * of gates that failed. `§8.5`: "The live harness must fail closed before network activity
 * unless all required non-production inputs and acknowledgements are valid."
 *
 * The separation is what makes the gate testable: `tests/sendgrid/preflight.test.ts` drives
 * every refusal with a plain object, offline, and a gate that could only be exercised by
 * standing up an account is a gate nobody exercises.
 *
 * **A REFUSAL IS THE DEFAULT, NOT THE EXCEPTION.** `evaluatePreflight` accumulates failures
 * and `preflightPermitsLiveRun` requires the list to be EMPTY — so a gate that a future edit
 * forgets to evaluate contributes nothing to a pass, and a fact the CLI could not establish
 * arrives as `false`/`null` and refuses.
 *
 * =================================================================================
 * THE SECRETS ARE NOT HERE, AND NOT BY ACCIDENT
 *
 * `PreflightFacts` carries two credential IDENTITIES and no material. `§8.5`: "Do not print
 * secrets. Do not persist secrets in evidence." A gate function that took the keys in order
 * to check they were different would be a function with two keys in its frame and a
 * stringified argument list one debugger away from a log; comparing IDENTITIES answers the
 * same question, and the identities are non-secret by `50 §2g` field 1's own definition.
 * =================================================================================
 */

/** Every gate, as a closed enum. A gate is named or it does not exist. */
export const PREFLIGHT_GATES = [
  /** `§8.5`: "provider = SendGrid". */
  'PROVIDER_NOT_SENDGRID',
  /** `§8.5`: "non-production context". */
  'NOT_A_NON_PRODUCTION_ENVIRONMENT',
  /** `§8.6`: sandbox mode must NOT be enabled. S1O: it suppresses the I36 evidence. */
  'SANDBOX_MODE_ENABLED',
  /** `§8.5`: "integration credential available legally". */
  'INTEGRATION_CREDENTIAL_UNAVAILABLE',
  'AUDIT_CREDENTIAL_UNAVAILABLE',
  /** `§8.5`: the two credentials must be DISTINCT. Compared on identity, never on material. */
  'CREDENTIALS_NOT_DISTINCT',
  /** `§8.5`: "both credential identities resolve and match signed expected IDs". */
  'INTEGRATION_CREDENTIAL_IDENTITY_MISMATCH',
  'AUDIT_CREDENTIAL_IDENTITY_MISMATCH',
  /**
   * `§3`: the identity must be MATERIAL-BOUND. A fixture provenance cannot carry a live run.
   */
  'INTEGRATION_IDENTITY_NOT_MATERIAL_BOUND',
  'AUDIT_IDENTITY_NOT_MATERIAL_BOUND',
  /** `§8.5`: "class-5 declarations exist". Read by each plane's OWN verifier. */
  'INTEGRATION_CLASS_5_RECORD_ABSENT',
  'AUDIT_CLASS_5_RECORD_ABSENT',
  /** `50 §2g` / ADR-024: the risk classes must keep option A legal. */
  'INTEGRATION_CREDENTIAL_NOT_OPTION_A_LEGAL',
  'AUDIT_CREDENTIAL_NOT_READ_ONLY',
  /**
   * The signed class-3 catalogue must name the adapter a SendGrid descriptor would register.
   *
   * `createAdapterRuntimeRegistry` raises `ADAPTER_NOT_IN_CATALOGUE` without it. The gate is
   * restated here so the harness can say WHY it stopped before it constructs a registry that
   * throws, and `tests/sendgrid/registry-prerequisites.test.ts` asserts the registry's own
   * refusal is the one that actually fires against the deployed bytes.
   */
  'ADAPTER_NOT_IN_SIGNED_CATALOGUE',
  /** `§8.5`: "required sender identity/config exists". */
  'SENDER_IDENTITY_ABSENT',
  /** `§8.5`: "explicit owner-controlled test sink is supplied". */
  'SINK_ABSENT_OR_NOT_OWNER_CONTROLLED',
  /** `§8.5`: no production/customer target through ordinary production state. */
  'PRODUCTION_TARGET_REACHABLE',
  /** `§8.5`: "Email Activity capability/entitlement can be tested". */
  'EMAIL_ACTIVITY_ENTITLEMENT_UNCONFIRMED',
  /** `§8.5`: "live operation is explicitly opted into". */
  'LIVE_RUN_NOT_OPTED_IN',
  /** `§11`: the duplicate negative control needs a SECOND, separate opt-in. */
  'DUPLICATE_CONTROL_NOT_SEPARATELY_OPTED_IN',
] as const;

export type PreflightGate = (typeof PREFLIGHT_GATES)[number];

/**
 * The facts the CLI establishes before this function runs. NO MEMBER CARRIES A SECRET.
 *
 * Every member is `false`/`null` when the CLI could not establish it, which is what makes
 * "could not establish" and "established as unsafe" refuse identically.
 */
export interface PreflightFacts {
  readonly providerId: string;
  /** The operator's declared non-production environment label, or `null`. */
  readonly environmentLabel: string | null;
  /** Whether the operator declared this a dedicated non-production environment. */
  readonly nonProductionDeclared: boolean;
  /** Whether anything in the configuration asks for sandbox mode. Must be `false`. */
  readonly sandboxModeRequested: boolean;

  readonly integrationCredentialResolved: boolean;
  readonly integrationResolvedIdentity: string | null;
  readonly integrationSignedCredentialId: string | null;
  readonly integrationIdentityProvenance: string | null;
  readonly integrationRiskClass: string | null;

  readonly auditCredentialResolved: boolean;
  readonly auditResolvedIdentity: string | null;
  readonly auditSignedCredentialId: string | null;
  readonly auditIdentityProvenance: string | null;
  readonly auditRiskClass: string | null;

  /** Whether the VERIFIED class-3 catalogue names the SendGrid adapter identity. */
  readonly adapterInSignedCatalogue: boolean;

  readonly senderAddress: string | null;
  readonly sinkAddress: string | null;
  /**
   * Whether any recipient could arrive from ordinary production state.
   *
   * `false` by construction in this package — the recipient is launch configuration and no
   * dispatch field can carry one — and carried as a FACT so the CLI has to assert it rather
   * than the reader having to notice it.
   */
  readonly recipientReachableFromProductionState: boolean;
  /** Whether the Email Activity entitlement has been CONFIRMED against the account. */
  readonly emailActivityEntitlementConfirmed: boolean;

  readonly liveRunOptedIn: boolean;
  readonly duplicateControlRequested: boolean;
  readonly duplicateControlOptedIn: boolean;
}

/** The provider this harness serves, and the only one it will run against. */
export const SENDGRID_PROVIDER_ID = 'twilio_sendgrid';

/** `50 §2g`: option A admits `READ_ONLY` and `NON_MONETARY_WRITE`, never `MONEY_MOVING`. */
const OPTION_A_LEGAL_RISK_CLASSES: readonly string[] = Object.freeze([
  'READ_ONLY',
  'NON_MONETARY_WRITE',
]);

/** Evaluate every gate. Returns the FAILURES; an empty list is the only pass. */
export function evaluatePreflight(facts: PreflightFacts): readonly PreflightGate[] {
  const failures: PreflightGate[] = [];

  if (facts.providerId !== SENDGRID_PROVIDER_ID) failures.push('PROVIDER_NOT_SENDGRID');
  if (!facts.nonProductionDeclared || facts.environmentLabel === null) {
    failures.push('NOT_A_NON_PRODUCTION_ENVIRONMENT');
  }
  if (facts.sandboxModeRequested) failures.push('SANDBOX_MODE_ENABLED');

  if (!facts.integrationCredentialResolved || facts.integrationResolvedIdentity === null) {
    failures.push('INTEGRATION_CREDENTIAL_UNAVAILABLE');
  }
  if (!facts.auditCredentialResolved || facts.auditResolvedIdentity === null) {
    failures.push('AUDIT_CREDENTIAL_UNAVAILABLE');
  }

  /*
   * DISTINCTNESS IS CHECKED ON IDENTITY, AND `null` IS NOT EQUAL TO `null` HERE.
   *
   * Two unresolved credentials are not "distinct"; they are two absences, and treating them
   * as passing this gate would let a run whose credentials both failed to resolve clear the
   * one gate that exists to stop the audit plane and the send plane sharing a key.
   */
  if (
    facts.integrationResolvedIdentity === null ||
    facts.auditResolvedIdentity === null ||
    facts.integrationResolvedIdentity === facts.auditResolvedIdentity
  ) {
    failures.push('CREDENTIALS_NOT_DISTINCT');
  }

  if (
    facts.integrationSignedCredentialId === null ||
    facts.integrationResolvedIdentity === null ||
    facts.integrationSignedCredentialId !== facts.integrationResolvedIdentity
  ) {
    failures.push('INTEGRATION_CREDENTIAL_IDENTITY_MISMATCH');
  }
  if (
    facts.auditSignedCredentialId === null ||
    facts.auditResolvedIdentity === null ||
    facts.auditSignedCredentialId !== facts.auditResolvedIdentity
  ) {
    failures.push('AUDIT_CREDENTIAL_IDENTITY_MISMATCH');
  }

  if (!isLiveIdentityProvenance(facts.integrationIdentityProvenance)) {
    failures.push('INTEGRATION_IDENTITY_NOT_MATERIAL_BOUND');
  }
  if (!isLiveAuditIdentityProvenance(facts.auditIdentityProvenance)) {
    failures.push('AUDIT_IDENTITY_NOT_MATERIAL_BOUND');
  }

  if (facts.integrationSignedCredentialId === null || facts.integrationRiskClass === null) {
    failures.push('INTEGRATION_CLASS_5_RECORD_ABSENT');
  } else if (!OPTION_A_LEGAL_RISK_CLASSES.includes(facts.integrationRiskClass)) {
    failures.push('INTEGRATION_CREDENTIAL_NOT_OPTION_A_LEGAL');
  }

  if (facts.auditSignedCredentialId === null || facts.auditRiskClass === null) {
    failures.push('AUDIT_CLASS_5_RECORD_ABSENT');
  } else if (facts.auditRiskClass !== 'READ_ONLY') {
    failures.push('AUDIT_CREDENTIAL_NOT_READ_ONLY');
  }

  if (!facts.adapterInSignedCatalogue) failures.push('ADAPTER_NOT_IN_SIGNED_CATALOGUE');

  if (facts.senderAddress === null || facts.senderAddress.length === 0) {
    failures.push('SENDER_IDENTITY_ABSENT');
  }
  if (facts.sinkAddress === null || !isOwnerControlledSink(facts.sinkAddress)) {
    failures.push('SINK_ABSENT_OR_NOT_OWNER_CONTROLLED');
  }
  if (facts.recipientReachableFromProductionState) failures.push('PRODUCTION_TARGET_REACHABLE');
  if (!facts.emailActivityEntitlementConfirmed) {
    failures.push('EMAIL_ACTIVITY_ENTITLEMENT_UNCONFIRMED');
  }

  if (!facts.liveRunOptedIn) failures.push('LIVE_RUN_NOT_OPTED_IN');
  /*
   * `§11` — THE SECOND OPT-IN IS REQUIRED ONLY WHEN THE DUPLICATE CONTROL IS REQUESTED,
   * AND IT IS A SECOND ONE.
   *
   * "explicit second opt-in beyond ordinary live validation." A run that does not ask for the
   * duplicate control is not gated on it; a run that asks for it and supplied only the
   * ordinary acknowledgement is refused, because the ordinary acknowledgement is consent to a
   * safe validation and this is consent to deliberately provoking a duplicate.
   */
  if (facts.duplicateControlRequested && !facts.duplicateControlOptedIn) {
    failures.push('DUPLICATE_CONTROL_NOT_SEPARATELY_OPTED_IN');
  }

  return Object.freeze(failures);
}

/** THE ONLY PASS: an empty failure list. */
export function preflightPermitsLiveRun(facts: PreflightFacts): boolean {
  return evaluatePreflight(facts).length === 0;
}

/**
 * The facts a run that has established NOTHING starts from.
 *
 * Every member is the refusing value, so a CLI that forgot to populate a field refuses on it
 * rather than inheriting a permissive default. `tests/sendgrid/preflight.test.ts` asserts
 * that this record fails EVERY gate that can fail without a contradiction.
 */
export const NOTHING_ESTABLISHED: PreflightFacts = Object.freeze({
  providerId: '',
  environmentLabel: null,
  nonProductionDeclared: false,
  sandboxModeRequested: false,
  integrationCredentialResolved: false,
  integrationResolvedIdentity: null,
  integrationSignedCredentialId: null,
  integrationIdentityProvenance: null,
  integrationRiskClass: null,
  auditCredentialResolved: false,
  auditResolvedIdentity: null,
  auditSignedCredentialId: null,
  auditIdentityProvenance: null,
  auditRiskClass: null,
  adapterInSignedCatalogue: false,
  senderAddress: null,
  sinkAddress: null,
  recipientReachableFromProductionState: false,
  emailActivityEntitlementConfirmed: false,
  liveRunOptedIn: false,
  duplicateControlRequested: false,
  duplicateControlOptedIn: false,
});
```

#### `validation/sendgrid/harness/cli.ts` (complete)

```typescript
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { classesServedBy } from '../../../src/integration/control/adapterRuntimeRegistry.js';
import {
  activeVerifiedControlArtifacts,
  bootstrapControlArtifactAuthority,
  kernelAuthorityReady,
} from '../../../src/kernel/controlArtifacts/registry.js';
import { verifiedCredentialScopes } from '../../../src/kernel/controlArtifacts/bundle.js';
import type { VerifiedControlArtifactBundle } from '../../../src/kernel/controlArtifacts/bundle.js';
import { readNonProductionConfig } from '../integration/nonProductionConfig.js';
import { createAdapterSecretSource } from '../integration/secretSource.js';
import { createAuditReadSecretSource } from '../audit/secretSource.js';
import {
  NOTHING_ESTABLISHED,
  SENDGRID_PROVIDER_ID,
  evaluatePreflight,
  type PreflightFacts,
} from './preflight.js';
import {
  I17B_STATUS,
  PRODUCTION_DISABLED_STATEMENT,
  bundleDigest,
  redactAddress,
  renderEvidenceBundle,
  type EvidenceBundle,
} from './evidence.js';
import { KILL_POINT_CONCLUSION_LIMITS } from './killPoints.js';

/**
 * `§8.5` — THE S1P LIVE-VALIDATION ENTRY POINT. EXPLICIT INVOCATION, AND NOTHING ELSE.
 *
 * =================================================================================
 * NOTHING IN `npm run verify` REACHES THIS FILE
 *
 * `§8.5`: "Ordinary unit tests, integration tests, architecture verification, CI and normal
 * repository verification must make ZERO real SendGrid calls. A real provider call must
 * require explicit invocation."
 *
 * Three mechanisms, and the third is the one that holds when the first two are edited:
 *
 *   1. this file is not a vitest test file and matches no pattern in `vitest.config.ts`;
 *   2. `tests/sendgrid/live-harness-isolation.test.ts` asserts that NO file under `tests/`
 *      imports `harness/cli.js`, `harness/scopeProbes.js`, either provider client, or the
 *      two adapter modules;
 *   3. **THE PREFLIGHT REFUSES**, and it refuses from `NOTHING_ESTABLISHED` — so even an
 *      invocation with no arguments at all, from any caller, performs no provider call.
 *
 * =================================================================================
 * THE ACKNOWLEDGEMENT IS A TOKEN, IN THE ENVIRONMENT, AND IT IS NOT A DEFAULT
 *
 * `§8.5`: "Do not put secrets on command lines if the operating system/process model would
 * expose them." The two LOCATORS are paths rather than secrets and the two ACKNOWLEDGEMENTS
 * are constants rather than secrets, and all four arrive through the environment anyway:
 * on Windows a command line is readable from other processes in the session, and a habit that
 * puts a path there is a habit that will one day put a key there.
 *
 * =================================================================================
 * WHAT THIS CLI DOES ON A REPOSITORY WITH NO CREDENTIALS, WHICH IS TODAY
 *
 * It establishes what it can, refuses on what it cannot, writes an evidence bundle recording
 * every gate that refused, and exits non-zero. **THAT ARTIFACT IS NOT PROVIDER EVIDENCE**,
 * and it says so: `liveRunPerformed` is `false`, `probes` is empty, and every kill-point row
 * is `NOT_RUN`.
 * =================================================================================
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..', '..');

/** The env var carrying the integration runtime's deployment-document path. NOT a secret. */
export const ENV_INTEGRATION_LOCATOR = 'ACOS_S1P_INTEGRATION_LOCATOR';
/** The env var carrying the AUDIT runtime's deployment-document path. A DIFFERENT document. */
export const ENV_AUDIT_LOCATOR = 'ACOS_S1P_AUDIT_LOCATOR';
/** The ordinary live-run acknowledgement. */
export const ENV_LIVE_ACK = 'ACOS_S1P_LIVE_ACKNOWLEDGEMENT';
/** `§11`'s SECOND, separate acknowledgement for the duplicate negative control. */
export const ENV_DUPLICATE_ACK = 'ACOS_S1P_DUPLICATE_CONTROL_ACKNOWLEDGEMENT';
/** `§8.5`: the operator's declaration that the Email Activity entitlement was confirmed. */
export const ENV_ENTITLEMENT_CONFIRMED = 'ACOS_S1P_EMAIL_ACTIVITY_ENTITLEMENT_CONFIRMED';

/**
 * The acknowledgement values. Long, specific, and impossible to set by accident.
 *
 * A boolean would be `true`, which is a value a shell sets for a dozen unrelated reasons.
 * These sentences are ones an operator can only have typed after reading what they mean.
 */
export const LIVE_ACK_TOKEN = 'I_AUTHORISE_A_REAL_NON_PRODUCTION_SENDGRID_SEND';
export const DUPLICATE_ACK_TOKEN =
  'I_AUTHORISE_AN_INTENTIONAL_DUPLICATE_SEND_TO_MY_OWN_SINK';
export const ENTITLEMENT_CONFIRMED_TOKEN = 'EMAIL_ACTIVITY_HISTORY_ENTITLEMENT_CONFIRMED';

/** The adapter identity a SendGrid descriptor would register. */
export const SENDGRID_ADAPTER_ID = 'sendgrid_email';

/** The git commit the run was made from, or a declared absence. Never a guess. */
function gitCommit(): string {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    }).trim();
  } catch {
    return 'UNKNOWN — git rev-parse failed';
  }
}

/**
 * The ACTIVE verified bundle, or the ACCEPTED bootstrap, or a declared absence.
 *
 * `50 §3f` occasion 1 may already have run in this process — the offline suite bootstraps
 * per worker, and a deployment's composition root bootstraps before anything else — so the
 * ACTIVE bundle is preferred and a second bootstrap is attempted only when there is none.
 * Re-bootstrapping over a live authority would be reading the trust configuration twice and
 * publishing the second answer, which is a thing the harness has no business doing.
 *
 * The FAILURE is a first-class result: a deployment with no owner-signed manifest cannot
 * produce a verified bundle, and `50 §3f`'s fail-closed bootstrap is what says so. The
 * harness does not work around it — a run without a verified class-3 and class-5 is a run
 * whose adapter registration and credential risk are unsigned, which is the whole thing the
 * architecture refuses.
 */
function loadVerifiedBundle(): { readonly bundle: VerifiedControlArtifactBundle | null } {
  try {
    if (kernelAuthorityReady()) return { bundle: activeVerifiedControlArtifacts() };
    return { bundle: bootstrapControlArtifactAuthority() };
  } catch {
    // The failure's detail is NOT read into the harness: `50 §3f` raises its own CRITICAL
    // incident, and a second rendering of it here would be a second, unreviewed channel.
    return { bundle: null };
  }
}

/** Establish every preflight fact this repository and environment can actually supply. */
export function establishFacts(
  environment: Readonly<Record<string, string | undefined>>,
): PreflightFacts {
  const configuration = readNonProductionConfig(environment[ENV_INTEGRATION_LOCATOR] ?? '');
  const { bundle } = loadVerifiedBundle();

  let integrationSignedCredentialId: string | null = null;
  let integrationRiskClass: string | null = null;
  let auditSignedCredentialId: string | null = null;
  let auditRiskClass: string | null = null;
  let adapterInSignedCatalogue = false;

  if (bundle !== null) {
    const declaration = verifiedCredentialScopes(bundle);
    for (const [credentialId, scope] of Object.entries(declaration.credentials)) {
      if (scope.adapter === SENDGRID_ADAPTER_ID) {
        integrationSignedCredentialId = credentialId;
        integrationRiskClass = scope.credentialRiskClass;
      }
      if (scope.adapter === 'audit_plane' && scope.provider === SENDGRID_PROVIDER_ID) {
        auditSignedCredentialId = credentialId;
        auditRiskClass = scope.credentialRiskClass;
      }
    }
    // `classesServedBy` reads the VERIFIED class-3 catalogue. An adapter no class routes to
    // is an adapter the catalogue does not name, and `createAdapterRuntimeRegistry` would
    // raise `ADAPTER_NOT_IN_CATALOGUE` for it.
    adapterInSignedCatalogue = classesServedBy(SENDGRID_ADAPTER_ID, bundle).length > 0;
  }

  return Object.freeze({
    ...NOTHING_ESTABLISHED,
    providerId: SENDGRID_PROVIDER_ID,
    environmentLabel: configuration.kind === 'CONFIG' ? configuration.config.environmentLabel : null,
    nonProductionDeclared: configuration.kind === 'CONFIG',
    /*
     * ALWAYS `false`, AND NOT BECAUSE A DEFAULT SAYS SO.
     *
     * `buildSendGridSendRequest` is called by the adapter with a LITERAL `false`, so no
     * document and no variable can make this package emit a sandbox request. The fact is
     * carried into the preflight anyway, because `§8.5` requires the gate and a gate whose
     * operand is a constant is still a gate a future edit has to move deliberately.
     */
    sandboxModeRequested: false,
    integrationSignedCredentialId,
    integrationRiskClass,
    auditSignedCredentialId,
    auditRiskClass,
    adapterInSignedCatalogue,
    senderAddress: configuration.kind === 'CONFIG' ? configuration.config.senderAddress : null,
    sinkAddress: configuration.kind === 'CONFIG' ? configuration.config.sinkAddress : null,
    /*
     * `false` BY CONSTRUCTION. The recipient is launch configuration; `DispatchRequest`'s
     * closed twenty-field list carries no recipient member, and nothing in the payload
     * reaches `buildSendGridSendRequest`.
     */
    recipientReachableFromProductionState: false,
    emailActivityEntitlementConfirmed:
      environment[ENV_ENTITLEMENT_CONFIRMED] === ENTITLEMENT_CONFIRMED_TOKEN,
    liveRunOptedIn: environment[ENV_LIVE_ACK] === LIVE_ACK_TOKEN,
    duplicateControlRequested: environment[ENV_DUPLICATE_ACK] !== undefined,
    duplicateControlOptedIn: environment[ENV_DUPLICATE_ACK] === DUPLICATE_ACK_TOKEN,
    // The credentials are resolved below, in `main`, and only after the cheap gates have
    // been evaluated — a run that is going to refuse on its configuration should not have
    // touched a secret source at all.
    integrationCredentialResolved: false,
    integrationResolvedIdentity: null,
    integrationIdentityProvenance: null,
    auditCredentialResolved: false,
    auditResolvedIdentity: null,
    auditIdentityProvenance: null,
  });
}

/**
 * Resolve both credentials through their OWN sources and fold the results into the facts.
 *
 * The material is destructured into a boolean and two non-secret labels and is NOT retained:
 * `resolution.credential.secret` is never assigned to anything this function returns, and
 * `PreflightFacts` has no member it could occupy.
 */
export async function withResolvedCredentials(
  facts: PreflightFacts,
  environment: Readonly<Record<string, string | undefined>>,
): Promise<PreflightFacts> {
  const integrationSource = createAdapterSecretSource({
    adapterId: SENDGRID_ADAPTER_ID,
    locator: environment[ENV_INTEGRATION_LOCATOR] ?? '',
  });
  const auditSource = createAuditReadSecretSource({
    providerId: SENDGRID_PROVIDER_ID,
    locator: environment[ENV_AUDIT_LOCATOR] ?? '',
  });

  const integration = await integrationSource.resolve();
  const audit = await auditSource.resolve();

  return Object.freeze({
    ...facts,
    integrationCredentialResolved: integration.kind === 'RESOLVED',
    integrationResolvedIdentity:
      integration.kind === 'RESOLVED' ? integration.credential.credentialIdentity : null,
    integrationIdentityProvenance:
      integration.kind === 'RESOLVED' ? integration.credential.identityProvenance : null,
    auditCredentialResolved: audit.kind === 'RESOLVED',
    auditResolvedIdentity: audit.kind === 'RESOLVED' ? audit.credential.credentialIdentity : null,
    auditIdentityProvenance:
      audit.kind === 'RESOLVED' ? audit.credential.identityProvenance : null,
  });
}

/** Where a run's evidence lands. Under `artifacts/`, beside the deployment's own bytes. */
export const EVIDENCE_DIRECTORY = join(REPO_ROOT, 'artifacts', 's1p-validation');

export async function main(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): Promise<number> {
  const startedAt = new Date().toISOString();
  const runId = `s1p-${startedAt.replace(/[:.]/g, '-')}`;

  const facts = await withResolvedCredentials(establishFacts(environment), environment);
  const failures = evaluatePreflight(facts);

  /*
   * THE ONE BRANCH THAT WOULD REACH A PROVIDER, AND IT IS GUARDED BY AN EMPTY LIST.
   *
   * `§6`: "Before the first live provider call, verify every safety gate in this prompt. If
   * any prerequisite is uncertain, do not send." A gate the harness could not evaluate
   * arrives as a failure, so uncertainty and refusal are the same path.
   *
   * S1P ships with this branch UNREACHED on every machine this repository has run on, and
   * the evidence bundle below is what says so rather than a comment.
   */
  const liveRunPerformed = false;

  const bundle: EvidenceBundle = {
    schema: 'acos.s1p.sendgrid-validation-evidence.v1',
    operatingSpine: 'Operating Spine v1.3',
    packageIssue: 'v1.3.7',
    gitCommit: gitCommit(),
    validationRunId: runId,
    startedAtUtc: startedAt,
    finishedAtUtc: new Date().toISOString(),
    environmentLabel: facts.environmentLabel,
    providerId: facts.providerId,
    integrationCredentialIdentity: facts.integrationResolvedIdentity,
    auditCredentialIdentity: facts.auditResolvedIdentity,
    integrationIdentityMatchedSignedRecord:
      facts.integrationSignedCredentialId !== null &&
      facts.integrationSignedCredentialId === facts.integrationResolvedIdentity,
    auditIdentityMatchedSignedRecord:
      facts.auditSignedCredentialId !== null &&
      facts.auditSignedCredentialId === facts.auditResolvedIdentity,
    senderRedacted: facts.senderAddress === null ? null : redactAddress(facts.senderAddress),
    sinkRedacted: facts.sinkAddress === null ? null : redactAddress(facts.sinkAddress),
    preflightFailures: failures,
    liveRunPerformed,
    probes: Object.freeze([]),
    auditKeySendRefusal: null,
    killPoints: Object.freeze([]),
    duplicateControl: Object.freeze({
      status: 'NOT_RUN' as const,
      reason:
        failures.length > 0
          ? 'the preflight refused, so no send of any kind was attempted'
          : 'not requested',
      observedAcceptedCount: null,
      oracleDiscriminatedDuplicate: null,
    }),
    invariantConclusions: Object.freeze({
      i8: 'NO CHANGE. No vendor side was swept; no provider read was performed.',
      i20: 'NO CHANGE. No provider-reported accepted count exists, so I20 has no operand.',
      i36:
        'NO CHANGE. The local composition leg remains proved by the ACCEPTED mock kill ' +
        'matrix; the verification leg needs a provider accepted count and none was measured.',
    }),
    unresolvedObservations: failures.map(
      (gate) => `preflight gate ${gate} refused; the live run did not proceed`,
    ),
    conclusionLimits: KILL_POINT_CONCLUSION_LIMITS,
    i17bStatus: I17B_STATUS,
    productionStatement: PRODUCTION_DISABLED_STATEMENT,
  };

  const rendered = renderEvidenceBundle(bundle);
  mkdirSync(EVIDENCE_DIRECTORY, { recursive: true });
  const path = join(EVIDENCE_DIRECTORY, `${runId}.json`);
  writeFileSync(path, `${rendered}\n`, 'utf8');

  process.stdout.write(`ACOS S1P — Twilio SendGrid non-production provider validation\n`);
  process.stdout.write(`run: ${runId}\n`);
  process.stdout.write(`evidence: ${path}\n`);
  process.stdout.write(`local digest: ${bundleDigest(rendered)}\n`);
  if (failures.length === 0) {
    /*
     * REACHING HERE MEANS EVERY GATE PASSED AND THE RUN STILL DID NOT SEND.
     *
     * S1P ships the gate, the adapter, the reader, the observation loop and the evidence
     * bundle; the SCENARIO DRIVER that walks the six kill points against a live account is
     * the part that needs an account to be written against, and inventing it blind would be
     * the "fake provider responses presented as live evidence" `§6` forbids. The operator
     * procedure records this as the last remaining step, and the exit code says the run did
     * not complete rather than that it passed.
     */
    process.stdout.write(
      'PREFLIGHT PASSED. The scenario driver is NOT IMPLEMENTED — see ' +
        'docs/implementation/S1P-operator-procedure.md step 15. NO PROVIDER CALL WAS MADE.\n',
    );
    return 2;
  }
  process.stdout.write(`PREFLIGHT REFUSED — ${String(failures.length)} gate(s):\n`);
  for (const gate of failures) process.stdout.write(`  - ${gate}\n`);
  process.stdout.write('NO PROVIDER CALL WAS MADE.\n');
  return 1;
}

/*
 * THERE IS NO MODULE-EVALUATION SIDE EFFECT IN THIS FILE.
 *
 * `main` is exported and never self-invoked, so importing this module — which is what
 * `tests/sendgrid/preflight.test.ts` does to reach `establishFacts` — runs nothing, opens
 * nothing and writes nothing. The npm entry point is `run.ts`, which exists for the single
 * purpose of calling `main`, and a guard comparing `import.meta.url` to `process.argv[1]` is
 * exactly the kind of clever line that silently stops guarding after a path change.
 */
```

#### `validation/sendgrid/harness/run.ts` (complete)

```typescript
import { main } from './cli.js';

/**
 * THE S1P LIVE-VALIDATION ENTRY POINT — `npm run validate:sendgrid`.
 *
 * It exists so `cli.ts` can have NO module-evaluation side effect: a module that runs itself
 * when imported is a module whose safety depends on nobody importing it, and the offline
 * suite imports `cli.ts` to exercise `establishFacts` and the preflight.
 *
 * `§8.5`: a real provider call requires explicit invocation. THIS FILE IS THAT INVOCATION,
 * and even it performs none until every preflight gate has passed.
 */
void main().then((code) => {
  process.exitCode = code;
});
```

#### `validation/sendgrid/harness/observation.ts` (complete)

```typescript
import type {
  ProviderEvidenceRecord,
  ProviderReadOperation,
} from '../../../src/audit/provider/protocol/readWire.js';
import { SENDGRID_ACTIVITY_REQUESTS_PER_MINUTE } from '../audit/providerReadClient.js';

/**
 * `§8.4` — BOUNDED OBSERVATION. IT WAITS, AND IT NEVER SENDS.
 *
 * =================================================================================
 * THE ONE SENTENCE THIS WHOLE MODULE EXISTS TO MAKE STRUCTURALLY TRUE
 *
 * `§8.4`: "The poller may wait for provider visibility. **The poller may NEVER resend.**"
 *
 * And the way it is made true is not a rule this module follows. It is the shape of its
 * argument: `ObservationDeps.read` is a function from a read QUERY to a read RESULT, and
 * there is no second function, no adapter, no registry, no gateway entry point and no
 * dispatch identity anywhere in this file's scope. **There is nothing here to resend WITH.**
 * `tests/sendgrid/observation.test.ts` asserts it the other way round: a deps object carrying
 * a send function is a type error, and the module's import closure contains no dispatch path.
 *
 * `§19` of the S1P mandate lists the two adjacent defects and both are absent: no "automatic
 * redispatch of uncertain effects", and no "send retry to the observation loop".
 *
 * =================================================================================
 * "NOT VISIBLE YET" IS NOT "NEVER SENT", AND THE RESULT TYPE REFUSES TO SAY IT IS
 *
 * `§8.4`: "never treat 'not visible yet' as permission to resend"; "preserve unknown outcome
 * when the evidence is genuinely insufficient". `§12`: "no conversion of uncertainty into
 * `NOT_SENT_CONFIRMED`".
 *
 * So the exhausted case is `NOT_OBSERVED_WITHIN_BOUND` and its own documentation says what it
 * is not. There is no `NOT_SENT`, no `NEVER_SENT` and no `CONFIRMED_ABSENT` member of
 * `ObservationOutcome`, because Email Activity latency and an unsent message produce the
 * same reading and no number of attempts distinguishes them.
 *
 * =================================================================================
 * THE BOUND IS TWO BOUNDS, AND EITHER ENDS IT
 *
 * `§8.4` requires "explicit maximum duration AND/OR maximum attempts". Both are carried, both
 * are checked, and the loop ends on whichever comes first. The delay is DETERMINISTIC — a
 * fixed interval, not an exponential backoff with jitter — because the evidence has to say
 * when each attempt happened and a reviewer has to be able to check the spacing against the
 * provider's published rate limit.
 *
 * That limit is S1O's own recorded figure: 6 requests per minute on the Email Activity API.
 * `MIN_OBSERVATION_INTERVAL_MS` is derived from it rather than guessed, and the loop refuses
 * a configured interval below it — a poller that trips a documented 429 is a poller whose
 * empty readings are about the rate limit rather than about the message.
 * =================================================================================
 */

/** 60_000 / 6 = 10_000ms. Derived from the published limit, never chosen. */
export const MIN_OBSERVATION_INTERVAL_MS = Math.ceil(
  60_000 / SENDGRID_ACTIVITY_REQUESTS_PER_MINUTE,
);

/** A hard ceiling on attempts, so a mis-configured bound cannot become an unbounded loop. */
export const MAX_OBSERVATION_ATTEMPTS = 12;

/** A hard ceiling on wall-clock duration, for the same reason. */
export const MAX_OBSERVATION_DURATION_MS = 10 * 60 * 1000;

/** What ONE observation attempt recorded. Evidence, and it is kept whatever the outcome. */
export interface ObservationAttempt {
  readonly attempt: number;
  readonly startedAtMs: number;
  readonly operation: ProviderReadOperation;
  /** How the audit read ended. The provider's own answer, unmapped. */
  readonly result: 'EVIDENCE' | 'PROVIDER_UNAVAILABLE';
  /** Records whose correlation tag the PROVIDER echoed. Never records the matcher wrote. */
  readonly matchingRecords: number;
  /** The provider's own total for the period, which may exceed the records returned. */
  readonly recordCount: number;
}

export const OBSERVATION_OUTCOMES = [
  /** The provider returned at least one record carrying this correlation tag. */
  'PROVIDER_ACTIVITY_OBSERVED',
  /**
   * The bound was reached with no matching record.
   *
   * **THIS IS NOT EVIDENCE THAT NOTHING WAS SENT.** Email Activity latency, a missing
   * entitlement, a correlation field that did not round-trip and a message that never left
   * all read identically here. `§12`: uncertainty stays uncertainty.
   */
  'NOT_OBSERVED_WITHIN_BOUND',
  /** Every attempt failed to reach the provider. Evidence about the network, not the message. */
  'PROVIDER_UNAVAILABLE_THROUGHOUT',
] as const;

export type ObservationOutcome = (typeof OBSERVATION_OUTCOMES)[number];

export interface ObservationResult {
  readonly outcome: ObservationOutcome;
  readonly correlationTag: string;
  readonly attempts: readonly ObservationAttempt[];
  /**
   * `§10` — THE PROVIDER-SIDE ACCEPTED-MESSAGE COUNT FOR THIS CORRELATION.
   *
   * The number of DISTINCT provider message ids the provider returned carrying this tag. It
   * is the `I36` oracle's operand and it is NOT a local invocation count, a mock count, an
   * HTTP client call count or an ACOS log count — those are counted elsewhere and compared
   * against this, never substituted for it.
   *
   * `null` when no attempt reached the provider at all: zero would be an assertion about the
   * provider that no read supports.
   */
  readonly providerAcceptedCount: number | null;
  /** The distinct provider message ids observed. Evidence for an independent reviewer. */
  readonly providerMessageIds: readonly string[];
}

/** The read the loop drives, and the delay it waits with. THERE IS NO THIRD MEMBER. */
export interface ObservationDeps {
  /**
   * One period-bounded, correlation-narrowed audit read.
   *
   * The result type is the ACCEPTED audit plane's, so what this loop can learn is exactly
   * what `48 §3.6`'s read-only boundary can produce. There is no richer channel.
   */
  readonly read: (query: {
    readonly operation: ProviderReadOperation;
    readonly correlationTag: string;
    readonly periodStartMs: number;
    readonly periodEndMs: number;
    readonly maxRecords: number;
  }) => Promise<
    | {
        readonly kind: 'EVIDENCE';
        readonly records: readonly ProviderEvidenceRecord[];
        readonly recordCount: number;
      }
    | { readonly kind: 'PROVIDER_UNAVAILABLE' }
  >;
  /** Injected so the suite can drive the loop without waiting. Deterministic either way. */
  readonly delay: (ms: number) => Promise<void>;
  /** Injected for the same reason. Never used to decide anything but the bound. */
  readonly now: () => number;
}

export interface ObservationBound {
  readonly correlationTag: string;
  readonly periodStartMs: number;
  readonly periodEndMs: number;
  readonly maxAttempts: number;
  readonly intervalMs: number;
  readonly maxDurationMs: number;
  readonly maxRecords: number;
}

/** Clamp a configured bound into the declared ceilings. A bound is a bound. */
export function clampObservationBound(bound: ObservationBound): ObservationBound {
  return Object.freeze({
    ...bound,
    maxAttempts: Math.max(1, Math.min(bound.maxAttempts, MAX_OBSERVATION_ATTEMPTS)),
    intervalMs: Math.max(bound.intervalMs, MIN_OBSERVATION_INTERVAL_MS),
    maxDurationMs: Math.max(1, Math.min(bound.maxDurationMs, MAX_OBSERVATION_DURATION_MS)),
  });
}

/**
 * Poll one correlation until the provider shows it, the attempts run out, or the clock does.
 *
 * `MESSAGE_ACTIVITY_SEARCH` on every attempt: the operation is a CONSTANT in this function,
 * so there is no attempt at which the loop could escalate to a different operation, and
 * `MESSAGE_ACTIVITY_COUNT` is not used because a count without ids cannot tell a reviewer
 * WHICH messages were accepted.
 */
export async function observeCorrelation(
  deps: ObservationDeps,
  rawBound: ObservationBound,
): Promise<ObservationResult> {
  const bound = clampObservationBound(rawBound);
  const startedAt = deps.now();
  const attempts: ObservationAttempt[] = [];
  const messageIds = new Set<string>();
  let reachedProvider = false;

  for (let attempt = 1; attempt <= bound.maxAttempts; attempt += 1) {
    const attemptStart = deps.now();
    if (attempt > 1) {
      // THE DEADLINE IS CHECKED BEFORE THE WAIT, so the loop cannot sleep past its own bound.
      if (attemptStart - startedAt + bound.intervalMs > bound.maxDurationMs) break;
      await deps.delay(bound.intervalMs);
    }

    const result = await deps.read({
      operation: 'MESSAGE_ACTIVITY_SEARCH',
      correlationTag: bound.correlationTag,
      periodStartMs: bound.periodStartMs,
      periodEndMs: bound.periodEndMs,
      maxRecords: bound.maxRecords,
    });

    if (result.kind === 'PROVIDER_UNAVAILABLE') {
      attempts.push(
        Object.freeze({
          attempt,
          startedAtMs: attemptStart,
          operation: 'MESSAGE_ACTIVITY_SEARCH' as const,
          result: 'PROVIDER_UNAVAILABLE' as const,
          matchingRecords: 0,
          recordCount: 0,
        }),
      );
      continue;
    }

    reachedProvider = true;
    /*
     * A RECORD COUNTS ONLY IF THE PROVIDER ECHOED THE TAG.
     *
     * The audit reader sets `correlationTag` from the provider's own `categories` array and
     * leaves it `null` when the provider carried none, so this filter is reading the
     * provider's answer rather than the question. A period-bounded read legitimately returns
     * records about other correlations — `I8`'s inverse sweep depends on that — and counting
     * them here would make every scenario's accepted count the account's traffic.
     */
    const matching = result.records.filter(
      (record) => record.correlationTag === bound.correlationTag,
    );
    for (const record of matching) messageIds.add(record.providerMessageId);

    attempts.push(
      Object.freeze({
        attempt,
        startedAtMs: attemptStart,
        operation: 'MESSAGE_ACTIVITY_SEARCH' as const,
        result: 'EVIDENCE' as const,
        matchingRecords: matching.length,
        recordCount: result.recordCount,
      }),
    );

    /*
     * THE LOOP STOPS ON THE FIRST OBSERVATION, AND THAT IS A CHOICE WITH A CONSEQUENCE.
     *
     * It means `providerAcceptedCount` is the count AT THE MOMENT THE TAG FIRST BECAME
     * VISIBLE, and a duplicate that appeared later would not be seen by THIS loop. The
     * duplicate negative control therefore runs its own observation AFTER both sends rather
     * than relying on this one — `§11`'s oracle has to be able to see two, and a loop that
     * stopped at one could not.
     */
    if (matching.length > 0) {
      return Object.freeze({
        outcome: 'PROVIDER_ACTIVITY_OBSERVED' as const,
        correlationTag: bound.correlationTag,
        attempts: Object.freeze([...attempts]),
        providerAcceptedCount: messageIds.size,
        providerMessageIds: Object.freeze([...messageIds].sort()),
      });
    }
  }

  return Object.freeze({
    outcome: reachedProvider
      ? ('NOT_OBSERVED_WITHIN_BOUND' as const)
      : ('PROVIDER_UNAVAILABLE_THROUGHOUT' as const),
    correlationTag: bound.correlationTag,
    attempts: Object.freeze([...attempts]),
    // ZERO ONLY IF A READ ACTUALLY REACHED THE PROVIDER. `null` otherwise: a count of zero
    // is an assertion about the provider, and an unreached provider asserted nothing.
    providerAcceptedCount: reachedProvider ? messageIds.size : null,
    providerMessageIds: Object.freeze([]),
  });
}
```

#### `validation/sendgrid/harness/evidence.ts` (complete)

```typescript
import { createHash } from 'node:crypto';

import type { ObservationResult } from './observation.js';
import type { ProbeRecord } from './scopeProbes.js';
import type { PreflightGate } from './preflight.js';
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

/** Carried in every bundle. `§19`, `§25`: production SendGrid is not enabled. */
export const PRODUCTION_DISABLED_STATEMENT =
  'PRODUCTION SENDGRID WAS NOT ENABLED. This run used a dedicated non-production sending ' +
  'identity with sandbox_mode=false and an owner-controlled sink recipient. No customer ' +
  'recipient was addressable: the recipient is launch configuration and no dispatch field ' +
  'can carry one. No production business message was sent.';

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

export interface EvidenceBundle {
  readonly schema: 'acos.s1p.sendgrid-validation-evidence.v1';
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

  /** `§16`: the two stable non-secret credential identities. NEVER the material. */
  readonly integrationCredentialIdentity: string | null;
  readonly auditCredentialIdentity: string | null;
  /** `§16`: proof the identities matched signed class-5 expectations. */
  readonly integrationIdentityMatchedSignedRecord: boolean;
  readonly auditIdentityMatchedSignedRecord: boolean;

  /** `§16`: the sink, represented safely. */
  readonly senderRedacted: string | null;
  readonly sinkRedacted: string | null;

  /** Every preflight gate that refused. Empty on a run that proceeded. */
  readonly preflightFailures: readonly PreflightGate[];
  readonly liveRunPerformed: boolean;

  /** `§8.7` / `§16`: the capability probes, as measured. */
  readonly probes: readonly ProbeRecord[];
  /** `§16`: the audit-key send-refusal result, restated so it cannot be overlooked. */
  readonly auditKeySendRefusal: ProbeRecord | null;

  readonly killPoints: readonly KillPointEvidence[];
  /** `§11`: the duplicate negative control. */
  readonly duplicateControl: {
    readonly status: 'RUN' | 'NOT_RUN';
    readonly reason: string;
    readonly observedAcceptedCount: number | null;
    readonly oracleDiscriminatedDuplicate: boolean | null;
  };

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

/** Serialise a bundle, refusing to emit one that carries a secret shape. */
export function renderEvidenceBundle(bundle: EvidenceBundle): string {
  const serialised = JSON.stringify(
    { ...bundle, conclusionLimits: KILL_POINT_CONCLUSION_LIMITS },
    null,
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
```

#### `tests/negative-controls/unsafe-sendgrid-validation.ts` (complete — the unsafe validation helper)

```typescript
import type { ProviderEvidenceRecord } from '../../src/audit/provider/protocol/readWire.js';
import type { AuditProviderReader } from '../../src/audit/provider/runtime/auditProviderReader.js';
import { PROVIDER_READ_BOUNDARY } from '../../src/audit/provider/runtime/auditProviderReader.js';
import type {
  SendGridMailSendBody,
  SendGridSendInput,
} from '../../validation/sendgrid/integration/requestMapping.js';
import type { PreflightFacts, PreflightGate } from '../../validation/sendgrid/harness/preflight.js';
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
    personalizations: [{ to: [{ email: input.sinkAddress }] }],
    from: { email: input.senderAddress },
    subject: `ACOS ${input.correlationTag}`,
    content: [{ type: 'text/plain', value: input.correlationTag }],
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
export function unsafePermissivePreflight(facts: PreflightFacts): readonly PreflightGate[] {
  const failures: PreflightGate[] = [];
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
```

### I.1 The seven properties the reviewer asked to be able to establish

Each row gives the code location, not a claim.

| Property | Where it is established | Caveat |
|---|---|---|
| **all preflight gates occur before network access** | `cli.ts main()` calls `withResolvedCredentials(establishFacts(env))` then `evaluatePreflight`, then sets `const liveRunPerformed = false` and writes the bundle. **There is no network call anywhere in `cli.ts`** — it imports neither provider client nor `scopeProbes`. | The gates precede nothing, because no send path exists downstream yet (`§M`). |
| **sandbox cannot be enabled** | `adapter.ts` passes `sandboxMode: false` as a **literal**; `requestMapping.ts` returns `SANDBOX_MODE_REFUSED` first, before every other check; the body emits `enable: false as const`; `providerClient.ts` classifies HTTP 200 as `SANDBOX_SUPPRESSED`; preflight gate `SANDBOX_MODE_ENABLED` exists. | `establishFacts` hard-codes `sandboxModeRequested: false`, so that **gate is currently unfalsifiable from configuration** — it is a guard against a future edit, not a live discriminator. |
| **polling cannot send** | `ObservationDeps` has exactly `read`, `delay`, `now`. `observation.ts` imports only `readWire` types and one constant. No dispatch, adapter, client or registry module is in its scope. | — |
| **unknown result cannot cause resend** | exhausted bound → `NOT_OBSERVED_WITHIN_BOUND`; unreached provider → `providerAcceptedCount: null`. The outcome union has no `NOT_SENT`/`NEVER_SENT` member. Nothing in the loop can send (row above). | — |
| **live invocation requires explicit opt-in** | `LIVE_RUN_NOT_OPTED_IN` unless `ACOS_S1P_LIVE_ACKNOWLEDGEMENT === 'I_AUTHORISE_A_REAL_NON_PRODUCTION_SENDGRID_SEND'`. `'true'`/`'1'`/`'yes'` do not satisfy it. | — |
| **duplicate negative control requires a separate opt-in** | `duplicateControlRequested` is true if `ACOS_S1P_DUPLICATE_CONTROL_ACKNOWLEDGEMENT` is set **at all**; `duplicateControlOptedIn` requires the exact token; the gate fires on requested-but-not-opted-in. | The control itself is **not implemented** — no code performs a duplicate send. |
| **production/customer target cannot be reached accidentally** | recipient is launch configuration, never message content; `isOwnerControlledSink` requires the literal `acos-nonprod-sink` and is checked twice (config parse and request mapping); `personalizations` is a fixed one-element tuple with no cc/bcc member; `DispatchRequest`'s closed field list carries no recipient. | `recipientReachableFromProductionState` is hard-coded `false` in `establishFacts`, so that gate is also currently unfalsifiable. |

**Two gates are currently hard-coded to their passing value** (`sandboxModeRequested: false`,
`recipientReachableFromProductionState: false`). Both are defended structurally elsewhere, and
both are recorded here because a reviewer counting gates should know which ones can actually
fail today. The remaining nineteen are driven by real inputs.

---

## J. Network call-site enumeration

Every SendGrid-facing network call introduced by S1P. Derived from
`grep -rn "globalThis\.fetch(" validation/` plus the adjacent `method:` literal.
**There are five, and no other network primitive exists anywhere under `validation/`.**

| # | File : line | HTTP method | Destination | Fixed or derived | Executing process | Credential that can reach it | Kind |
|---|---|---|---|---|---|---|---|
| 1 | `validation/sendgrid/integration/providerClient.ts:110` | `POST` | `` `${SENDGRID_API_ORIGIN}${SENDGRID_MAIL_SEND_PATH}` `` | **fixed** — two module constants, no argument participates | integration child (`child_process.fork` from control) | integration `mail.send` credential, resolved in-child from its own locator | **ordinary send** |
| 2 | `validation/sendgrid/audit/providerReadClient.ts:208` | `GET` | `` `${SENDGRID_API_ORIGIN}${SENDGRID_MESSAGES_PATH}?${search}` `` | **fixed path**; query string built by `buildActivityQuery` from a correlation tag + two timestamps | audit child (audit plane's own fork) | audit `email_activity.read` credential | **read** |
| 3 | `validation/sendgrid/audit/providerReadClient.ts:276` | `GET` | `` `${SENDGRID_API_ORIGIN}${SENDGRID_MESSAGES_PATH}/${segment}` `` | **fixed path**; `segment` is one message id, shape-checked against `/^[A-Za-z0-9._@-]{1,128}$/` then `encodeURIComponent`-ed | audit child | audit credential | **read** |
| 4 | `validation/sendgrid/harness/scopeProbes.ts:156` | `POST` | `` `${SENDGRID_API_ORIGIN}${SENDGRID_MAIL_SEND_PATH}` `` | **fixed** | **harness / operator process** — neither plane | **the AUDIT credential** (deliberately) | **isolated negative probe** — the `36 §13` attempted write |
| 5 | `validation/sendgrid/harness/scopeProbes.ts:232` | `GET` | `` `${SENDGRID_API_ORIGIN}${SENDGRID_MESSAGES_PATH}?${search}` `` | **fixed path** | harness / operator process | run twice — once with the audit credential (expect confirm), once with the integration credential (expect refuse) | **isolated capability probe** |

Origin and path constants, and their only definitions:

```text
validation/sendgrid/integration/providerClient.ts:48   SENDGRID_API_ORIGIN    = 'https://api.sendgrid.com'
validation/sendgrid/integration/requestMapping.ts:56   SENDGRID_MAIL_SEND_PATH = '/v3/mail/send'
validation/sendgrid/audit/providerReadClient.ts:44     SENDGRID_API_ORIGIN    = 'https://api.sendgrid.com'
validation/sendgrid/audit/providerReadClient.ts:47     SENDGRID_MESSAGES_PATH = '/v3/messages'
```

`validation/sendgrid/integration/adapter.ts:122` is enumerated by the scanner as a
`PROVIDER_CLIENT` **call site** — it calls `sendToProviderSendGrid`, it is not itself a
`fetch`.

### J.1 Can a generic URL, method, header or body cross IPC into these clients?

**No, on both planes, and the absence is structural rather than validated.**

| Plane | Message type | Field count | Members that could carry a destination or payload |
|---|---|---|---|
| integration | `DispatchRequest` (`src/integration/protocol/wire.ts`) | 20, hand-enumerated in `DISPATCH_REQUEST_FIELDS` | **none.** No `url`, `path`, `endpoint`, `host`, `origin`, `method`, `headers`, `body`, `query`, `token`, `apiKey`, `authorization`. An unknown field is `UNKNOWN_FIELD` — a refusal, not an ignored key |
| audit | `ProviderReadRequest` (`src/audit/provider/protocol/readWire.ts`) | 10, hand-enumerated in `PROVIDER_READ_REQUEST_FIELDS` | **none**, same list. `operation` is a closed three-member enum; an unknown value is `UNKNOWN_OPERATION` |

Both field lists are reproduced complete in `§F` and `§G`. Neither was modified by S1P —
`git diff d897833 -- src/` is empty.

The only caller-influenced values that reach a request line at all are: the **correlation
tag** (constrained to `acos-corr-` + a v4 UUID by `isCorrelationTag`), two **timestamps**, and
one **message id** (shape-checked and percent-encoded). The request **body** on site 1 is a
`SendGridMailSendBody`, which only `buildSendGridSendRequest` can construct.

---

## K. Imports / dependency closure — machine-derived

Closures computed with the **accepted** `computeClosure` from
`tools/integration-packaging/packagingManifest.ts` (the same function
`perimeter-enumeration.test.ts` uses), over the current tree. It follows static `from '…'`
specifiers, first-party only, and deliberately does **not** follow dynamic `await import(…)` —
which is exactly how each runtime loads its own adapter/reader.

### K.1 No `src/` control-plane module imports `validation/`

```text
$ grep -rn "validation/" src/ --include=*.ts | grep -E "from '|import\("
(no output)
```

And by closure:

```text
CONTROL_PLANE — 65 modules
  modules under validation/ : 0
```

### K.2 Full closures

```text
=== HARNESS_CLI (cli.ts + run.ts) — 34 modules ===
  src/audit/provider/protocol/readWire.ts
  src/audit/provider/runtime/auditSecretSource.ts
  src/integration/control/adapterRuntimeRegistry.ts
  src/integration/protocol/runtimeIdentity.ts
  src/integration/runtime/adapterSecretSource.ts
  src/kernel/canonicalisation/actionCatalogue.ts
  src/kernel/canonicalisation/actionClasses.ts
  src/kernel/controlArtifacts/artifactPackage.ts
  src/kernel/controlArtifacts/artifactParsers.ts
  src/kernel/controlArtifacts/bundle.ts
  src/kernel/controlArtifacts/casSig.ts
  src/kernel/controlArtifacts/credentialRisk.ts
  src/kernel/controlArtifacts/ed25519.ts
  src/kernel/controlArtifacts/errors.ts
  src/kernel/controlArtifacts/incidents.ts
  src/kernel/controlArtifacts/manifestCore.ts
  src/kernel/controlArtifacts/registry.ts
  src/kernel/controlArtifacts/requiredSet.ts
  src/kernel/controlArtifacts/trustConfig.ts
  src/kernel/controlArtifacts/verifier.ts
  src/kernel/gateway/adapterPort.ts
  src/kernel/outbox/correlationTag.ts
  validation/sendgrid/audit/providerReadClient.ts
  validation/sendgrid/audit/secretSource.ts
  validation/sendgrid/harness/cli.ts
  validation/sendgrid/harness/evidence.ts
  validation/sendgrid/harness/killPoints.ts
  validation/sendgrid/harness/observation.ts
  validation/sendgrid/harness/preflight.ts
  validation/sendgrid/harness/run.ts
  validation/sendgrid/harness/scopeProbes.ts
  validation/sendgrid/integration/nonProductionConfig.ts
  validation/sendgrid/integration/requestMapping.ts
  validation/sendgrid/integration/secretSource.ts

=== INTEGRATION_CHILD:sendgrid_email — 15 modules ===
  src/integration/protocol/runtimeEnvironment.ts
  src/integration/protocol/runtimeIdentity.ts
  src/integration/protocol/wire.ts
  src/integration/runtime/adapterSecretSource.ts
  src/integration/runtime/integrationAdapter.ts
  src/integration/runtime/integrationHost.ts
  src/integration/runtime/main.ts
  src/integration/runtime/runtimeLog.ts
  src/kernel/canonicalisation/actionClasses.ts
  src/kernel/outbox/correlationTag.ts
  validation/sendgrid/integration/adapter.ts
  validation/sendgrid/integration/nonProductionConfig.ts
  validation/sendgrid/integration/providerClient.ts
  validation/sendgrid/integration/requestMapping.ts
  validation/sendgrid/integration/secretSource.ts

=== AUDIT_CHILD:twilio_sendgrid — 11 modules ===
  src/audit/provider/protocol/readWire.ts
  src/audit/provider/protocol/readerEnvironment.ts
  src/audit/provider/protocol/readerIdentity.ts
  src/audit/provider/runtime/auditProviderReader.ts
  src/audit/provider/runtime/auditReadHost.ts
  src/audit/provider/runtime/auditReadLog.ts
  src/audit/provider/runtime/auditSecretSource.ts
  src/audit/provider/runtime/main.ts
  validation/sendgrid/audit/providerReadClient.ts
  validation/sendgrid/audit/reader.ts
  validation/sendgrid/audit/secretSource.ts

=== CONTROL_PLANE — 65 modules ===
  src/db/pool.ts
  src/integration/control/adapterRuntimeRegistry.ts
  src/integration/control/integrationClient.ts
  src/integration/protocol/runtimeEnvironment.ts
  src/integration/protocol/runtimeIdentity.ts
  src/integration/protocol/wire.ts
  src/kernel/canonicalisation/actionCatalogue.ts
  src/kernel/canonicalisation/actionClasses.ts
  src/kernel/canonicalisation/authoritativeCost.ts
  src/kernel/canonicalisation/brands.ts
  src/kernel/canonicalisation/canonicalBytes.ts
  src/kernel/canonicalisation/constructorVersion.ts
  src/kernel/canonicalisation/errors.ts
  src/kernel/canonicalisation/grantWindows.ts
  src/kernel/canonicalisation/intent.ts
  src/kernel/canonicalisation/jcs1Admission.ts
  src/kernel/canonicalisation/optionDigest.ts
  src/kernel/canonicalisation/rationale.ts
  src/kernel/canonicalisation/registry.ts
  src/kernel/canonicalisation/types.ts
  src/kernel/clocks/statutoryClock.ts
  src/kernel/controlArtifacts/artifactPackage.ts
  src/kernel/controlArtifacts/artifactParsers.ts
  src/kernel/controlArtifacts/bundle.ts
  src/kernel/controlArtifacts/casSig.ts
  src/kernel/controlArtifacts/credentialRisk.ts
  src/kernel/controlArtifacts/ed25519.ts
  src/kernel/controlArtifacts/errors.ts
  src/kernel/controlArtifacts/incidents.ts
  src/kernel/controlArtifacts/manifestCore.ts
  src/kernel/controlArtifacts/registry.ts
  src/kernel/controlArtifacts/requiredSet.ts
  src/kernel/controlArtifacts/trustConfig.ts
  src/kernel/controlArtifacts/verifier.ts
  src/kernel/enumeration/clock.ts
  src/kernel/enumeration/contextSpec.ts
  src/kernel/enumeration/entityLease.ts
  src/kernel/enumeration/enumerateEffects.ts
  src/kernel/enumeration/enumeratedOptionSet.ts
  src/kernel/enumeration/enumerationRecord.ts
  src/kernel/enumeration/port.ts
  src/kernel/exposure/errors.ts
  src/kernel/exposure/ledger.ts
  src/kernel/exposure/lockOrder.ts
  src/kernel/exposure/money.ts
  src/kernel/exposure/retry.ts
  src/kernel/exposure/windowInstance.ts
  src/kernel/gateway/adapterPort.ts
  src/kernel/gateway/adapterRegistry.ts
  src/kernel/gateway/dispatchCapability.ts
  src/kernel/gateway/dispatchEnvelope.ts
  src/kernel/gateway/dispatchLease.ts
  src/kernel/gateway/dispatchRevalidation.ts
  src/kernel/gateway/effectGateway.ts
  src/kernel/gateway/outcomePolicy.ts
  src/kernel/gateway/outcomeTransaction.ts
  src/kernel/mirror/corroborationSignal.ts
  src/kernel/mirror/degradedModeOverride.ts
  src/kernel/mirror/degradedModeThresholds.ts
  src/kernel/mirror/dispatchPrecedence.ts
  src/kernel/mirror/mirrorState.ts
  src/kernel/mirror/mirrorStateMachine.ts
  src/kernel/mirror/signalSource.ts
  src/kernel/outbox/claim.ts
  src/kernel/outbox/outboxState.ts

```

### K.3 How each child reaches its S1P module

Both are **dynamic** imports of a module specifier supplied as trusted launch configuration,
confined to a declared runtime root — never a static import, and never a message field.

| | integration | audit |
|---|---|---|
| loader | `src/integration/runtime/main.ts` | `src/audit/provider/runtime/main.ts` |
| specifier arrives on | `ACOS_INTEGRATION_ADAPTER_MODULE` | `ACOS_AUDIT_READER_MODULE` |
| confinement root | `ACOS_INTEGRATION_RUNTIME_ROOT` | `ACOS_AUDIT_READER_RUNTIME_ROOT` |
| would resolve to | `validation/sendgrid/integration/adapter.js` (or `killPointAdapter.js`) | `validation/sendgrid/audit/reader.js` |
| **is any such descriptor registered today?** | **NO** — `createAdapterRuntimeRegistry` throws `ADAPTER_NOT_IN_CATALOGUE` | **NO** — `createAuditReaderRegistry` throws `CREDENTIAL_NOT_DECLARED` |

Cross-plane contamination, measured:

```text
INTEGRATION_CHILD:sendgrid_email — modules under validation/sendgrid/audit/    : 0
INTEGRATION_CHILD:sendgrid_email — modules under validation/sendgrid/harness/  : 0
AUDIT_CHILD:twilio_sendgrid      — modules under validation/sendgrid/integration/: 0
AUDIT_CHILD:twilio_sendgrid      — modules under validation/sendgrid/harness/   : 0
```

### K.4 Can an S1P module be invoked outside the accepted child-process boundaries?

**Yes, and the reviewer should not be told otherwise.**

- `npm run validate:sendgrid` runs `harness/run.ts` in an **ordinary operator process** — not
  the control plane, not the integration child, not the audit child. Its closure (34 modules)
  contains `scopeProbes.ts`, which holds two `fetch` sites including the deliberate
  attempted-write probe.
- `scopeProbes.ts` enters that closure through a **type-only** import in `evidence.ts`
  (`import type { ProbeRecord } from './scopeProbes.js'`). The static walker follows the
  specifier; at runtime a type-only import is erased. Either way the module is reachable from
  the harness and is intended to be.
- Nothing prevents a developer running `npx tsx` against any module in the tree. The
  protection against an accidental provider call is the **preflight refusal**, not
  unreachability.

### K.5 Does the live CLI bypass normal ACOS dispatch/claim authority?

**NO — AND THE REASON IS THAT IT HAS NO DISPATCH PATH AT ALL, NOT THAT IT USES THE PROPER ONE.**

This is the review question flagged as especially important, so it is answered from the graph
rather than from intent.

```text
HARNESS_CLI closure, searched for a dispatch/claim/outbox/IPC-client module:
  effectGateway.ts        : absent
  outbox/claim.ts         : absent
  outbox/enqueue.ts       : absent
  integrationClient.ts    : absent
  dispatchEnvelope.ts     : absent
  outcomeTransaction.ts   : absent
  auditReadClient.ts      : absent
```

What the harness closure **does** contain from `src/`: the control-artifact trust chain
(`registry`, `verifier`, `bundle`, `artifactParsers`, `credentialRisk`, `trustConfig`,
`manifestCore`, `casSig`, `ed25519`, …), `adapterRuntimeRegistry` (for `classesServedBy`),
`actionCatalogue`/`actionClasses`, both secret-source **contracts**, the audit **wire types**,
and `outbox/correlationTag.ts` (for the `isCorrelationTag` predicate only).

It contains **neither** `validation/sendgrid/integration/adapter.ts` **nor**
`validation/sendgrid/integration/providerClient.ts` **nor** `validation/sendgrid/audit/reader.ts`.

**Consequences, stated plainly:**

1. the CLI **cannot** dispatch an effect — through the accepted path or around it;
2. the CLI **cannot** send through the SendGrid adapter, because the adapter is not in its
   closure and it holds no `IntegrationClient` to fork a child with;
3. the CLI **cannot** perform an audit read through the accepted reader, for the same reason;
4. the only provider-reaching code in its closure is `scopeProbes.ts` — the two **capability
   probes**, which by design carry no `authorisation_ref` and belong to no plane;
5. therefore **no bypass exists today, and no compliant path exists either.** See `§M`.

---

## L. `S1P-C1` impact analysis

**Nothing below was created, edited or chosen. No recoverability enum is selected here.**
This is the set of files that a change adding a dedicated SendGrid email-send action class and
a `sendgrid_email` adapter to signed class 3 would have to touch, with the reason for each.

> **See `§C.10` first.** `26 §5`'s recoverability table already designates `email.send` as
> **IRRECOVERABLE**, with `20 §5 I4` as its reason, and `26 §5` line 387 already discusses
> `email.send` at one MIE unit. That materially narrows — but does not by itself close — the
> "which enum value" part of `S1P-C1`, and the reviewer should weigh it.

### L.1 Signed artifacts

| File | Why it changes | Alters bytes/hash? |
|---|---|---|
| `artifacts/control/class-03.action-catalogue.json` | a new `action_classes` entry carrying all ten per-class fields, **plus** an entry in `semantic_option_digest_fields` **and** one in `enumeration_max_age_seconds` — both maps are keyed per class and the parser requires exhaustiveness | **YES — class-3 bytes and content hash** |
| `artifacts/control/class-05.credential-scopes.json` | two records: a `mail.send` credential bound to adapter `sendgrid_email`, and an `audit_plane`-scoped `email_activity.read` credential for provider `twilio_sendgrid`. Without them both registries fail closed (`CREDENTIAL_NOT_DECLARED`) | **YES — class-5 bytes and content hash** |
| `artifacts/control/class-02.policy-set.json` | `26 §2.3` makes the Cedar **schema** a closure — a request carrying an attribute the schema does not declare is REJECTED. A new action class therefore reaches the schema, and reaches the policy set if the class is to be GOVERNED rather than UNGOVERNED_FAILS_CLOSED | **YES — class-2 bytes, and `policy_version` (the Cedar-set digest, which is NOT the class-2 content hash)** |
| `artifacts/control/class-19.effect-constructors.json` | **conditionally.** Only `refund.create` has a constructor today; `campaign.pause`, `fulfilment.reship` and `campaign.budget.set` have none. Whether an email class needs one depends on whether it carries semantic options — which is part of the decision, not derivable here. If it does, class-19 key migration (an **open obligation**) is reached | **YES if a record is added** |

### L.2 Source

| File | Why it changes |
|---|---|
| `src/kernel/canonicalisation/actionClasses.ts` | `ACTION_CLASSES` is `SR7`'s single extension point. Adding the member is what forces the class-3 record, via the exhaustiveness check at `artifactParsers.ts:357` |
| `src/kernel/policy/cedarRequest.ts` | `registeredPolicyConstructionClasses()` today returns exactly `['refund.create']`. A GOVERNED email class would need a policy construction registered here |
| `src/kernel/policy/artifacts/policies/` | a new `.cedar` grant (and possibly a per-action cap) if GOVERNED |

### L.3 Manifest, pin and deployment trust

| Item | Why it changes |
|---|---|
| the active manifest | `manifestCore.ts` computes the manifest identity over the member artifacts' content hashes. Changing class 2, 3, 5 (and possibly 19) changes each hash and therefore the manifest id |
| `ACOS_EXPECTED_ACTIVE_MANIFEST_ID` (control plane) | the **externally pinned** value in `trustConfig.ts`'s `CONTROL_TRUST_CONFIG_KEYS`. Not held in the repository; the owner must re-issue it |
| `ACOS_AUDIT_EXPECTED_ACTIVE_MANIFEST_ID` (audit plane) | the audit plane reads its **own** copy through its own deployment boundary (`AUDIT_TRUST_CONFIG_KEYS`). Both must move, independently |
| dual owner signatures | class 2, 3, 5 and 19 are dual-signed manifest members. New bytes need a new primary-owner signature and a new second-factor signature — i.e. a release ceremony |

### L.4 Verification fixtures and tests — machine-derived, not guessed

| File | Why it changes |
|---|---|
| `tests/policy/policy-set-gap-analysis.test.ts` | its `DECLARED_STATUS` map is asserted equal to `ACTION_CLASSES` (line 74). A new class must be declared `GOVERNED` or `UNGOVERNED_FAILS_CLOSED`, and line 83/88 pin the governed set to exactly `['refund.create']` |
| `tests/controlArtifacts/class-authority.test.ts` | asserts `catalogue.actionClasses` equals `ACTION_CLASSES` and iterates every class (lines 106–160) |
| `tests/canonicalisation/registry.test.ts` | couples to the class set |
| `tests/integration/outbox/outbox-scope.test.ts` | couples to `ACTION_CLASSES` |
| `tests/authority/authority-channel-attacks.test.ts` | couples to `ACTION_CLASSES` |
| `tests/negative-controls/unsafe-credential-risk.ts`, `credential-risk-controls.test.ts`, `integration-controls.test.ts` | couple to the class/credential pairs |
| `tests/support/controlArtifactFixture.ts` | `ACCEPTED_POLICY_VERSION` is the Cedar-set digest; it changes if class 2 changes. `CLASS_20_ACCEPTED_CONTENT_HASH` is unaffected |
| ~18 further suites naming `campaign.budget.set` alongside the other three | listed by `grep -rln "campaign.budget.set" tests/`; each must be re-checked for exhaustive-set assumptions |

### L.5 Architecture verification and mutation seeds

| Item | Status |
|---|---|
| `docs/architecture/v1.3.7/analysis/consistency-v1.3.py` | it verifies the **architecture deliverables' prose**, not the repository artifacts. It contains 28 lines matching `email.send|action_class|catalogue`, so whether any of the 108 conditions asserts the catalogue's membership must be re-checked before assuming it is unaffected. **Not determined here.** |
| the 77 mutation seeds | same — they seed edits to the deliverables. A change confined to repository artifacts may leave them untouched; a change that also edits `26 §5` or `50 §2a` would not. **Not determined here.** |
| residual 12 (22 older C/E conditions lack seeds) | unchanged, still open |

### L.6 Release tooling

| File | Why it changes |
|---|---|
| `tools/control-release/verifyRelease.ts` | carries the class-number → file-name map (`3: 'class-03.action-catalogue.json'`, `5: 'class-05.credential-scopes.json'`); new bytes flow through the release candidate, approvals and signed package |
| `tools/control-release/candidate.ts`, `ceremony.ts`, `inventory.ts`, `compare.ts`, `review.ts` | the candidate/diff/approval path a new signed release runs through |
| `tests/release/*`, `deployment-dry-run.test.ts` | S1O recorded that `deployment-dry-run.test.ts` previously spliced an entry at a literal index and silently stopped testing the deployment pin when class 5 moved it; the index is now derived. A new class-19 record would move the inventory again |
| `tools/control-artifacts/assemblePolicySet.ts` | assembles class 2 from the `.cedar` sources if a policy is added |

### L.7 What does NOT change

- the claim/outbox/dispatch state machine, the two hash chains, `effectGateway.ts`;
- the integration and audit IPC wires;
- `docs/architecture/v1.3.6/`, which is immutable;
- the `validation/` package itself — its adapter already declares `adapterId = 'sendgrid_email'`
  and would be registrable the moment the catalogue names it.

---

## M. Six-scenario live-driver gap

Answered from the code, not from intent.

### M.1 What code currently EXISTS for the six real-provider scenarios

| Component | File | What it is |
|---|---|---|
| the canonical map | `validation/sendgrid/harness/killPoints.ts` | a **declarative table** — `KILL_POINT_ROWS`, six frozen objects. It contains no executable scenario logic: no dispatch call, no hook installation, no process control |
| kill point 3's mechanism | `validation/sendgrid/integration/killPointAdapter.ts` | a wrapper that delegates to the real adapter and then `process.exit(33)`. It is an **adapter module**, activated only by being named as a runtime's `adapterModule` |
| the provider send path | `integration/adapter.ts` + `providerClient.ts` + `requestMapping.ts` | complete |
| the provider read path | `audit/reader.ts` + `providerReadClient.ts` | complete |
| bounded observation | `harness/observation.ts` | complete, driven by an injected `read` |
| the evidence row shape | `harness/evidence.ts` — `KillPointEvidence` | a complete **type**, with fields for local state, provider observation, accepted count, recovery and `redispatchOccurred` |
| the gate | `harness/preflight.ts` | complete, 21 gates |

### M.2 What code does NOT exist

**No scenario driver of any kind.** Specifically absent:

- no code that enqueues an effect (`enqueueDispatch` is not imported anywhere under `validation/`);
- no code that claims or dispatches one (`dispatchAuthorisedEffect`, `effectGateway` — absent);
- no code that installs a `DispatchHooks` member to fire kill points 1, 2, 4 or 5;
- no code that launches an integration child with `killPointAdapter.js` for kill point 3;
- no code that performs a recovery / re-entry attempt for kill point 6;
- no code that constructs an `AdapterRuntimeDescriptor` or an `AuditReaderDescriptor`;
- no code that runs the scope probes (`scopeProbes.ts` is imported only for its `ProbeRecord`
  **type**, by `evidence.ts`);
- no code that performs the duplicate negative control;
- no code that populates any `KillPointEvidence` row.

The CLI's own terminal state is hard-coded:

```typescript
validation/sendgrid/harness/cli.ts:271   const liveRunPerformed = false;
validation/sendgrid/harness/cli.ts:294     liveRunPerformed,
validation/sendgrid/harness/cli.ts:295     probes: Object.freeze([]),
validation/sendgrid/harness/cli.ts:296     auditKeySendRefusal: null,
validation/sendgrid/harness/cli.ts:297     killPoints: Object.freeze([]),
```

and its exit codes are `1` (preflight refused) or `2` (preflight passed, driver absent). **It
has no path that returns 0.**

### M.3 Can the present CLI execute all six scenarios through the normal ACOS durable outbox / claim / dispatch / recovery path?

**NO.** From `§K.5`: the harness closure contains no `effectGateway.ts`, no `outbox/claim.ts`,
no `outbox/enqueue.ts`, no `integrationClient.ts`, no `dispatchEnvelope.ts` and no
`outcomeTransaction.ts`. It cannot dispatch through the accepted path, and it cannot dispatch
around it either. It can execute **zero** of the six scenarios.

### M.4 Does any scenario currently use the new provider adapter directly?

**NO — and no scenario uses it indirectly either, because no scenario exists.**

`validation/sendgrid/integration/adapter.ts` is not in the harness closure. Its only
importers in the whole tree are `killPointAdapter.ts` (which nothing imports) and one test
assertion that names its path as a string. It is reachable at runtime **only** through
`src/integration/runtime/main.ts`'s dynamic import of a descriptor's `adapterModule`, and no
such descriptor is constructed anywhere.

### M.5 What prevents a real run today, besides credentials/account provisioning

In the order the run would hit them:

1. **`ADAPTER_NOT_IN_SIGNED_CATALOGUE`** — the signed class-3 catalogue names no email action
   class and no `sendgrid_email` adapter (`S1P-C1`, `§C.1`, `§D`). The preflight refuses on it
   even with a fully provisioned account.
2. **`INTEGRATION_CLASS_5_RECORD_ABSENT` / `AUDIT_CLASS_5_RECORD_ABSENT`** — no SendGrid
   credential of either kind exists in the signed class-5 artifact (`§C.5`, `§D.2`).
3. **No owner-signed release, manifest or pin** covering those records (`§L.3`).
4. **No scenario driver** (`§M.2`) — even with 1–3 resolved and credentials present, the CLI
   would reach the `return 2` branch and make no provider call.
5. **No registry construction** — nothing in the tree builds an `AdapterRuntimeDescriptor` or
   an `AuditReaderDescriptor` for SendGrid, so neither child would ever be forked.

### M.6 Bearing on the classification — evidence only

The reviewer flagged that `S1P-C1` and the missing driver may mean repository implementation
is not complete. **The classification is not changed in this step.** The facts a reviewer needs
to decide it are:

- of `§9`'s eleven numbered steps for the six real-provider scenarios, the repository
  implements the **components** (map, adapter, kill-point adapter, reader, observation,
  evidence shape, gate) and **none of the orchestration**;
- `S1P-result.md §12` and the completion report both list "the six-scenario live driver" as a
  **NEW open obligation**, and `S1P-implementation-log.md §6` records the decision not to
  write it and the reasoning (`§6` of the mandate: no fabricated provider behaviour);
- the completion report nonetheless classified repository work as **"IMPLEMENTATION
  COMPLETE — PROVIDER VALIDATION PARTIAL"**, which treats the driver as belonging to the
  provider-validation half rather than the repository half. **That judgement is the reviewer's
  to accept or reject, and this package does not defend it.**

---

## N. Verification provenance

Exact current outputs, captured while constructing this package. **No SendGrid call occurred.**
The full test suite was **not** re-run in this step; its result from the completion report
(191 files / 2741 tests / 0 failed, exit 0) is unchanged because no source file was modified.

### N.1 `git diff --check`

```text
warning: in the working copy of '.gitignore', CRLF will be replaced by LF the next time Git touches it
warning: in the working copy of 'package.json', CRLF will be replaced by LF the next time Git touches it
warning: in the working copy of 'tools/perimeter/perimeterScan.ts', CRLF will be replaced by LF the next time Git touches it
warning: in the working copy of 'tsconfig.json', CRLF will be replaced by LF the next time Git touches it
exit: 0
```

The four warnings are line-ending normalisation notices from `.gitattributes`, not
whitespace errors. `git diff --check` reports no whitespace error and exits **0**.

### N.2 `npx tsc --noEmit`

```text
(no output)
exit: 0
```

### N.3 `npm run verify:perimeter`

```text
=== npm run verify:perimeter ===

> acos-control-plane@0.0.0-s1a verify:perimeter
> tsx tools/perimeter/cli.ts

ACOS EXTERNAL-WRITE PERIMETER — I24 / 48 §4 item 2

roots:                        src, tests\integration-plane, tests\audit-plane, validation
provider READ sites (48 §2 13): 6
  unannotated:                0
production call sites:        12
  carrying authorisation_ref: 3
  annotated PERIMETER_EXEMPT: 9
  UNANNOTATED:                0
test-only call sites:         6
  UNANNOTATED:                0

TEST_ONLY  PROVIDER_READ_CLIENT EXEMPT(audit_plane_read_only, 48-3-6) tests\audit-plane\readerA\providerReadClient.ts:94
TEST_ONLY  PROVIDER_READ_CLIENT EXEMPT(audit_plane_read_only, 48-3-6) tests\audit-plane\readerA\reader.ts:77
TEST_ONLY  PROVIDER_CLIENT    AUTHORISED                         tests\integration-plane\adapterA\adapter.ts:70
TEST_ONLY  PROVIDER_CLIENT    AUTHORISED                         tests\integration-plane\adapterA\providerClient.ts:73
TEST_ONLY  PROVIDER_CLIENT    AUTHORISED                         tests\integration-plane\adapterB\adapter.ts:46
TEST_ONLY  PROVIDER_CLIENT    AUTHORISED                         tests\integration-plane\adapterB\providerClient.ts:40
PRODUCTION PROVIDER_READ_CLIENT EXEMPT(audit_plane_read_only, 48-3-6) validation\sendgrid\audit\providerReadClient.ts:190
PRODUCTION NETWORK_PRIMITIVE  EXEMPT(audit_plane_read_only, 48-3-6) validation\sendgrid\audit\providerReadClient.ts:208
PRODUCTION PROVIDER_READ_CLIENT EXEMPT(audit_plane_read_only, 48-3-6) validation\sendgrid\audit\providerReadClient.ts:256
PRODUCTION NETWORK_PRIMITIVE  EXEMPT(audit_plane_read_only, 48-3-6) validation\sendgrid\audit\providerReadClient.ts:276
PRODUCTION PROVIDER_READ_CLIENT EXEMPT(audit_plane_read_only, 48-3-6) validation\sendgrid\audit\reader.ts:122
PRODUCTION PROVIDER_READ_CLIENT EXEMPT(audit_plane_read_only, 48-3-6) validation\sendgrid\audit\reader.ts:133
PRODUCTION PROVIDER_CLIENT    EXEMPT(credential_scope_conformance_probe, 36-13) validation\sendgrid\harness\scopeProbes.ts:126
PRODUCTION NETWORK_PRIMITIVE  EXEMPT(credential_scope_conformance_probe, 36-13) validation\sendgrid\harness\scopeProbes.ts:156
PRODUCTION NETWORK_PRIMITIVE  EXEMPT(credential_scope_conformance_probe, 36-13) validation\sendgrid\harness\scopeProbes.ts:232
PRODUCTION PROVIDER_CLIENT    AUTHORISED                         validation\sendgrid\integration\adapter.ts:122
PRODUCTION PROVIDER_CLIENT    AUTHORISED                         validation\sendgrid\integration\providerClient.ts:98
PRODUCTION NETWORK_PRIMITIVE  AUTHORISED                         validation\sendgrid\integration\providerClient.ts:110

RESULT: PASS
exit: 0
```

### N.4 What was executed while building this package

| Command | Purpose | Touched the provider? |
|---|---|---|
| `git rev-parse`, `git status`, `git diff --stat/--name-status/--numstat/--check`, `git show`, `git diff --no-index` | inventory and diff generation | no |
| `npx tsc --noEmit` | verification provenance | no |
| `npm run verify:perimeter` | verification provenance; static source scan | no |
| `npx tsx <scratchpad>/closure.mjs` | `§K` import closures, via the accepted `computeClosure` | no — static file reads only |
| `python` (UTF-8) reading `artifacts/control/*.json` | `§D` tables | no |

**Not executed:** `npm test` / `npx vitest`, `npm run validate:sendgrid`, any release tooling,
any signing, any database migration, any network request.

---

## Appendix — what this step changed

| | |
|---|---|
| implementation files modified | **none** |
| tests modified | **none** |
| architecture artifacts modified | **none** |
| documentation modified | **none** |
| configuration modified | **none** |
| files created | `S1P-review-package.md`, `S1P-review.diff` — review material only |
| commits / stashes / resets | **none** |
| `S1O-review.diff`, `S1O-correction-review.diff` | **untouched** |
| HEAD | `d897833b14253030f75fe113534df34a9827d464`, unchanged |
