# 50 — The Control-Artifact Manifest

**ACOS Operating Spine v1.3. Version 1.3. Issued 2026-09-03. New in v1.1.**
Created in response to R11. Governed by ADR-025. Enforced by I19 and I38.

## v1.3.6 change record

**The control-artifact trust architecture, declared.** v1.3.5 declared the obligation to sign control artifacts and did not declare the mechanism, which is why `S1K` returned PARTIAL against it with ten blocking omissions `S1K-C1`..`S1K-C10`. v1.3.6 declares the mechanism: two externally provisioned Ed25519 trust roots (`§3a`), the `ACOS-CAS-SIG-V1` signature envelope (`§3b`), exact-byte content hashing (`§3c`), the dual-signed manifest core with a deployment-pinned identity (`§3d`, `§3e`), `I19`'s three verification occasions (`§3f`), and the bootstrap dependency graph that terminates the recursion (`§3g`). Class 3 and class 27 receive **closed** schemas (`§2a`, `§2c`); class 20 receives a **concrete artifact** whose exact bytes are hashed (`§2b`); **class 17 is RETIRED from the deploy-time signed manifest** (`§2d`). Full disposition in `phase2-v1.3.6-errata.md`. **No production signing code exists and none is implemented by this pass.**

## v1.3.3 change record

Class 3's **approval floor** field gains a declared value — `$20.00`, `51 §3.7` — which moves class 3's `content_hash` (S1H-C1). **Class 27 added**: the degraded-mode threshold set, `51 §3.8` (S1H-C10). Both signatures are owed and neither is discharged; **the class-20 signature residual carried from v1.3.2 is unaffected and remains owed.** No production owner-signing mechanism and no runtime `I19` verification exist. Full disposition in `phase2-v1.3.3-errata.md`.

## v1.3 change record

Classes 24, 25 and 26 added — the audit-plane signing key, the override limit set, and the `I8` sweep specification (TA-06, TA-05, TA-02/TA-03). Full disposition in `phase2-v1.3-remediation-ledger.md`.

---

## 1. The test for membership

**Does modifying this artifact change what ACOS may say, believe, calculate, or authorise?**

Not "is it code or data". Not "is it in version control". The question is whether an edit changes the system's behaviour in a way that defeats a stated invariant.

**Twenty-five artifact classes pass that test (sixteen at v1.1, when this sentence was written). B9 in v1.0 protected six.** **v1.3.6: class 17 no longer passes it as a DEPLOY-TIME artifact** — per-company `window_registry` rows are runtime state, and modifying one changes what ACOS may authorise through the runtime-state mechanisms of `§3h` rather than through a deploy-time hash (`§2d`). **Twenty-four remain.** The ten it omitted include the one whose omission mattered most: the prohibited-commitment grammar was applied to T-U1 *generations at runtime* and never to the *template corpus at authoring time*, so **the entire T-U0 commitment surface — the only autonomous utterance tier at MVP — was an unversioned file outside B9's enumeration, outside every invariant, and editable by anyone with the deploy path** (UTT-02, REC-05).

Three other omissions defeat specific invariants directly:

- **A tolerance rule** silently disables the terminal financial control (`28 §4`).
- **A metric computation spec** changes a gating OBSERVATION with no invariant noticing (`30 §4`).
- **The adverse-facts threshold set** changes what counts as bad news, which is a subtler and more durable capability than spinning a fact the CEO was forced to reference (`27 §5`, CEO-05).

---

## 2. The sixteen classes

`v1.0 B9` marks the six v1.0 protected. **Signer** is who must sign a change; **halt scope** is what stops on an I19 hash mismatch, because halting the whole system for a template mismatch is disproportionate and halting nothing is useless.

| # | Class | v1.0 B9 | Signer | Halt scope on mismatch |
|---|---|---|---|---|
| 1 | **Grants and grant conditions** | ✔ | Owner, second factor | All effects |
| 2 | **Policy set** (Cedar source + compiled artifact) — **v1.3.6: the concrete signed object is the `acos.control.policy_set` BUNDLE, `§2e`: the Cedar schema file and every `.cedar` policy source file, in one immutable byte object. Its `content_hash` is `SHA-256` over those exact bytes (`§3c`) and is NOT `policy_version`** | ✔ | Owner, second factor | All effects |
| 3 | **Action catalogue** — **v1.3.6: the content is CLOSED by `§2a`'s schema and by nothing else. `irrecoverable_units` is class 3 content (v1.3.6, `51 §2.3`), and `degraded_per_action_approval_floor_monetary` LEAVES this class for class 27 (v1.3.6, `§2c`)** | ✔ | Owner, second factor | **All effects.** v1.3.6 closes the membership and moves two fields across class boundaries, which moves this class's `content_hash` and requires a fresh owner signature before any deployment |
| 4 | **Model bindings** | ✔ | Owner | Affected task types |
| 5 | **Credential scope declarations** — **v1.3.7: the content is CLOSED by `§2g`'s schema and by nothing else. One record per configured vendor credential, exactly seven fields, carrying the credential's enumerated PROVIDER permission envelope and the derived `credential_risk_class` ∈ {`READ_ONLY`, `NON_MONETARY_WRITE`, `MONEY_MOVING`}. This class is the SIGNED OWNER of ADR-024's option-B money-moving trigger (`S1N-C1`)** | ✔ | Owner, second factor | **Affected adapter.** v1.3.7 closes the membership, which moves this class's `content_hash` and requires a fresh owner signature before any deployment |
| 6 | **Audit records** (insert-only; alteration prohibited) | ✔ | — | n/a — alteration is prohibited, not signed |
| 7 | **Utterance template corpus** | — | Owner | Affected utterance class |
| 8 | **Approved policy corpus** (the statements templates may assert) | — | Owner | Affected utterance class |
| 9 | **Prohibited-commitment grammar** | — | Owner | All utterance classes |
| 10 | **Escalation detector patterns**, incl. structural and behavioural triggers | — | Owner | All utterance classes; T-U2 remains available |
| 11 | **Locale rendering policy** | — | Owner | Affected locale |
| 12 | **Promoter rules** | — | Owner | Affected fact types' promotion; existing RECORDs unaffected |
| 13 | **`context_spec`s** | — | Owner | Affected task types |
| 14 | **Metric computation specs** | — | Owner | Affected metrics and any policy condition reading them |
| 15 | **Tolerance rules** | — | Owner, second factor | Financial reconciliation resolution; discrepancies remain open |
| 16 | **Adverse-facts threshold set** | — | Owner, second factor | Briefing publication (I38, I45) |
| ~~17~~ | **RETIRED FROM THE DEPLOY-TIME SIGNED MANIFEST (v1.3.6, `§2d`).** Named exposure windows are **per-company runtime rows in `window_registry`**, written at runtime, not deploy-time bytes; `51 §2.3`'s per-action-class `irrecoverable_units` moves to **class 3**. **No static class-17 content remains with a runtime consumer, so no empty artifact is retained to preserve numbering.** The class number is **reserved and deprecated** and is never reassigned | — | — — not a signed deploy-time artifact | n/a — runtime-state integrity is governed by `§3h`'s named controls, not by `I19` |
| 18 | **Observability scrub allowlist** (v1.1 addition) | — | Owner | All third-party exporters |
| **19** | **Effect constructors** (v1.2, SR-C4) — the per-class canonicalisation logic and its `ConstructorVersionRecord`, including the declared semantic-by-definition field list | — | Owner, second factor | **All effects of the affected class.** A constructor computes every dispatched amount, every counterparty and every `value_direction`; an unversioned change to one is an unversioned change to what the system may spend |
| **20** | **Journal canonicalisation specification** (v1.2, SR-A3; NULL framing corrected v1.3.2, JCS-01) — `ACOS-JCS-1`: column order per row kind, decimal scales, timestamp format, **NULL framing under the reserved `0xFFFFFFFF` length word**, Unicode form, JSON canonicalisation, framing. **v1.3.4 (JCS-02): the per-row-kind column orders are declared in `30 §5.3a`, beginning with `acos.journal.outbox_claimed.v1`; declaring an order for a kind that had none moves this class's `content_hash` again. v1.3.5 (JCS-03): `acos.journal.dispatch_outcome.v1`'s order is declared in the same section, moving this class's `content_hash` a THIRD time. The signature is owed and is not discharged. **v1.3.6: THE CLASS HAS A CONCRETE ARTIFACT FOR THE FIRST TIME** — `artifacts/acos-jcs-1.spec.v1.txt`, 13479 bytes, whose exact bytes carry `content_hash` `7af60fc564aef296679ae06a34b188d3454ac7ef69f448f7260a3d5d55a18f33` (`§2b`). **Class 20 signs THE SPECIFICATION, never an implementation of it**** | — | Owner, second factor | **All effects.** A change silently breaks both hash chains and every downstream integrity claim. **v1.3.2's NULL-framing correction changes this class's `content_hash` and requires a fresh owner signature before any deployment** |
| **21** | **Adapter parameter set** (v1.2, SR-S4; operand corrected v1.3) — `daily_overdelivery_multiplier`, `monthly_basis_multiplier`, and the per-adapter **cessation specification** (the scalar `cessation_lag` is retired as the `I54` operand; fields scheduled under TB-07, `UNDECLARED`), each with its provenance grade | — | Owner, second factor | Affected adapter's rate classes |
| **22** | **`cessation_grace`** (v1.2, SR-S3) — the window in which a `StandingRevocationAuthority` outlives its grant | — | Owner, second factor | Standing pause path |
| **23** | **Anchor medium selection** (v1.2) — which media receive the hourly `{head_hash, chain_seq, row_count}` anchor | — | Owner, second factor | Anchoring; I17b |
| **24** | **Audit-plane signing key identity and published public key** (v1.3, TA-06) — the key under which `MirrorInputStallSignal` is signed, and the public half the control plane verifies against | — | Owner, second factor | **Entry into `CORROBORATED_DEGRADED`.** A substituted public key would let a compromised control plane mint its own corroboration, so the key is hashed into the manifest and a mismatch makes the corroborated state unreachable rather than forgeable |
| **25** | **Degraded-mode override limit set** (v1.3, TA-05) — the eight quantities in `51 §3.6` plus the registered OWNER-tier approver set | — | Owner, second factor | **Grant of any new `DegradedModeOverride`.** Active overrides run to their existing caps; no new one may be granted against an unverified limit set |
| **26** | **`I8` sweep specification** (v1.3, TA-02, TA-03) — per-adapter sweep cadence, coverage declaration, and the rule that the vendor query is period-bounded and never tag-bounded | — | Owner, second factor | **`I8` for the affected adapter.** A sweep whose scope was narrowed out of band is worse than no sweep, because its silence would be read as evidence |
| **27** | **Degraded-mode control configuration** (v1.3.3, S1H-C10; **CLOSED and widened v1.3.6, `§2c`**) — `mirror_lag_critical_threshold`, `audit_unreachable_full_halt_threshold`, **`degraded_per_action_approval_floor_monetary` (moved here from class 3, v1.3.6)** and **`corroboration_signal_max_age` (v1.3.6)**, with their units and their boundary semantics. **The content is CLOSED by `§2c`'s schema. No runtime state — no open declaration, no current mirror state, no active override — is class-27 content** | — | Owner, second factor | **All effects.** The 30-minute quantity is the operand of `30 §5.1a`'s FULL-HALT POSTURE, so widening it removes the halt that stops the company when the record cannot be made, and narrowing it halts a healthy company. It is a **new class rather than an extension of class 25**: class 25's subject is the override *limit set* and its halt scope is the grant of a new override, which is the wrong scope for a quantity that governs every effect |

**Twenty-seven rows for twenty-four signed classes at v1.3.6**, because row 6 is a prohibition rather than a signed artifact, **row 17 is RETIRED from the deploy-time signed manifest by `§2d` and is reserved and deprecated rather than renumbered**, and row 3 is one class covering several declared fields. *(v1.3.5 read "twenty-five signed classes"; the retirement is the only reason the figure moves, and no row was removed from this table.)* Rows 17–18 were added during v1.1 drafting once `48` and `51` existed; **rows 19–23 in v1.2**, **rows 24–26 in v1.3** and **row 27 in v1.3.3**, each because a mechanism in that release introduced an artifact that passes §1's test and would otherwise have been deployable without a signature. The manifest itself is the authority, not the count — but the count is now stated correctly, which v1.1's *"eighteen rows for sixteen classes"* was not, since it described eighteen rows of which seventeen were signed classes.

**Rows 19 and 20 are the two that matter most**, and both were invisible in v1.1. A constructor is the component `49` classifies as TCB — it computes every dispatched amount — and it was not a control artifact, so a constructor change was a code deploy governed by code review alone. `ACOS-JCS-1` is the definition of what the integrity machinery hashes; changing it is indistinguishable from breaking the chain, and nothing versioned it.

---

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

## 2b. Class 20's CONCRETE artifact (v1.3.6, `S1K-C8`)

**v1.3.5's class 20 had no artifact to sign.** `ACOS-JCS-1` existed as three conforming implementations plus architecture prose, and an implementation is a conformant instance rather than the specification.

**v1.3.6 declares the artifact.**

| | |
|---|---|
| Artifact | `artifacts/acos-jcs-1.spec.v1.txt`, in this package |
| `artifact_id` | `acos.control.jcs1_specification` |
| `artifact_version` | `ACOS-JCS-1` |
| Size | **13479 bytes** |
| Encoding | US-ASCII, which is valid UTF-8 NFC. **LF (`0x0A`) line terminators exclusively; the file contains no `0x0D` byte.** A CRLF copy is a different artifact and fails verification |
| `content_hash` | **`7af60fc564aef296679ae06a34b188d3454ac7ef69f448f7260a3d5d55a18f33`** — `SHA-256` over those exact bytes (`§3c`) |

**The artifact contains the complete machine-verifiable specification**: version identity, the framing word and its reserved NULL encoding, the injectivity argument, the five representations that must never collapse, the absence rule, every type's payload rule, the collected normalization rules, what is hashed on the wire, the chain link, and **both registered row kinds' exact semantic field orders**.

**The control plane and the audit plane each hold a BYTE-IDENTICAL COPY of this artifact.** That is not a loss of implementation independence. **Same specification; independent implementations.** The control-plane PL/pgSQL implementation, the audit-plane PL/pgSQL implementation, the TypeScript implementation and the independent test oracle remain four separately authored artefacts; none is derived from another; **and none of their source code is ever hashed as class 20.**

**What the class-20 signature proves, and what it does not.** A valid pair of owner signatures over this content hash proves exactly one thing: **this is the owner-approved `ACOS-JCS-1` specification.** **IT DOES NOT PROVE THAT ANY IMPLEMENTATION CONFORMS TO IT.** Conformance is proved by cross-implementation byte-identity validation — `36 §2`'s VC-A3 and `36 §2.6`'s fixture — and **`I19` does not replace VC-A3, does not weaken it, and does not discharge any of its obligations.**

---

## 2c. Class 27's CLOSED content schema (v1.3.6, `S1K-C6`)

**Exactly four static quantities. No runtime state. No open tail.**

| # | Quantity | Value | Units | Boundary semantics | Reading mechanism |
|---|---|---|---|---|---|
| 1 | `mirror_lag_critical_threshold` | **15 minutes** (`PT15M`) | duration | **inclusive**: `mirror_lag >= PT15M` is at or over | `30 §5.1` item 5, `30 §5.1a` |
| 2 | `audit_unreachable_full_halt_threshold` | **30 minutes** (`PT30M`) | duration | **inclusive**: `continuous_unreachability >= PT30M` enters the FULL-HALT POSTURE | `30 §5.1a` |
| 3 | `degraded_per_action_approval_floor_monetary` | **USD 20.00** | single ledger currency, scale 2 | **strict**: `total_exposure > 20.00` is ABOVE | `30 §5.1` item 4 row 2 |
| 4 | `corroboration_signal_max_age` | **5 minutes** (`PT5M`) | duration | `now() − observed_at <= max_age`, and `expires_at = observed_at + max_age` exactly | `30 §5.7.1` freshness rule |

**NO VALUE CHANGES IN THIS PASS.** All four are transcriptions of quantities already declared and already deployed. `MAL_monetary(month)` remains **$300.00**, `MAL_total(month)` at the signature basis remains **$756.00**, and `analysis/recompute-v1.3.py` reproduces `analysis/recompute-v1.3-output.txt` line for line.

**Row 3 moved from class 3 to class 27, and that is an OWNERSHIP correction, not a value change.** The floor is a **global degraded-mode threshold**, not a per-action catalogue field: one quantity for the whole company, read only by `30 §5.1` item 4 row 2, evaluated only inside a declared mirror state. It sat in class 3 because `50 §2`'s class-3 row already said *"approval floor"*, and `51 §3.7` recorded the class-3 assignment. **Both are corrected here. Its ownership is now unambiguous and is not duplicated in class 3.**

**Row 4 was previously owned by no signed class at all.** `corroboration_signal_max_age` gates entry to `CORROBORATED_DEGRADED` — degraded-mode authority — so `§6`'s rule that no authority-bearing field may sit outside every signed artifact boundary requires it to be owned. **The audit plane holds its own copy, and the two copies being equal is a cross-plane obligation, not a second owner.**

**What is NOT class 27 content.** The eight override limit quantities of `51 §3.6` and the registered OWNER-tier approver set — **class 25**, whose halt scope is the grant of a new override. **Runtime state is not control configuration**: the open `AUDIT_MIRROR_DEGRADED` declaration and its `opened_at`, the current resolved mirror state, the held corroboration, and any active `DegradedModeOverride` are runtime rows and are **not** class-27 content. `attestation_cadence` and `k` are `30 §5.4` **detection-latency** parameters; they are not operands of policy authority, economic authority, recoverability, adapter selection, external-write scope, canonicalisation, dispatch precedence, degraded-mode authority or effect construction, and `§6`'s rule therefore does not reach them. **Row 1's alignment with `attestation_cadence × k` is a rationale, not a dependency: the artifact declares `PT15M` as a literal.**

---

## 2d. Class 17's disposition: RETIRED (v1.3.6, `S1K-C7`)

**THE CATEGORY ERROR, STATED.** `50 §3`'s manifest is a **deploy-time** artifact set carrying `signed_at` and an owner ceremony ADR-025 describes as *"a signing ceremony the owner must actually perform"*. Class 17's content is `window_registry` rows — `PRIMARY KEY (company_id, window_id)`, `REFERENCES company(company_id)` — **created per company, at runtime, after any ceremony**. There is no coherent answer to *who signs a window created for a company tomorrow*, and inventing one would make an offline owner ceremony a precondition of onboarding.

**PER-COMPANY `window_registry` ROWS ARE NOT DEPLOY-TIME SIGNED CONTROL ARTIFACTS.** They are runtime authoritative database state.

**The split.**

| v1.3.5 class-17 content | v1.3.6 disposition |
|---|---|
| window ids, `boundary_kind`, `period` | **runtime state** — `window_registry` rows |
| `max_monetary`, `max_count` and its per-class sub-ceilings, `max_irrecoverable_units`, and their `UNBOUNDED` flags | **runtime state** — `window_registry` rows |
| `51 §2.3`'s per-action-class `irrecoverable_units` | **class 3**, `§2a` field 7 |

**Nothing static remains with a runtime consumer.** The `51 §2` window table is a Stage-2 **limits fixture** — the figures an owner would provision — and the runtime reads `window_registry`, never the fixture. **No empty or signature-only artifact is retained to preserve numbering.** Class number **17 is reserved and deprecated**; it is never reassigned, and it remains in this section's history so a reader of an older manifest can resolve it.

**Runtime-state integrity is not weakened; it is governed by its own invariants, which are named in `§3h`.** `I19` is not a generic database-row-signing system and is not extended into one.

---

## 2e. Class 2's concrete artifact, and `policy_version` (v1.3.6, `S1K-C6`)

| | |
|---|---|
| Artifact | the `acos.control.policy_set` **bundle**: the Cedar schema file and every `.cedar` policy source file, in one immutable byte object |
| `artifact_id` | `acos.control.policy_set` |
| `content_hash` | `SHA-256` over the bundle's exact bytes (`§3c`) |
| Runtime consumer | the policy loader, before the Cedar engine is constructed |

**`policy_version` is NOT the class-2 content hash, and neither replaces the other.** `policy_version` is the content-derived Cedar-set digest the production loader already computes over a length-framed structure of the schema and the `(id, source)` pairs in sorted id order; **its accepted current value is `47c2849b41bd0bdf433e75d7cf75b45f3133d93183c8fd447606ce1017c30ff6`, and it remains the accepted current digest unless the actual policy bytes change.** It is recorded on every decision and it detects a policy id renamed into another's text. The class-2 `content_hash` is `SHA-256` over the bundle's exact deployed bytes and is what the owner signs. **Both are content-derived, both are required, and the manifest entry carries the second.**

**O4's runtime rule (v1.3.6).** **A Cedar policy bundle is admitted to the engine only after the verified manifest, its `content_hash`, its primary signature and its second-factor signature have all been checked.** A bundle presented with a matching hash and no valid signature pair is **REFUSED**.

**What this does not do.** It says nothing about Cedar **semantic** correctness. It is not the symcc proof gate, not a policy-equivalence check, and not a policy-rotation mechanism. Those obligations are unchanged and remain open where they were.

---

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

## 3. Mechanism

```
manifest.json:
  {class, artifact_id, version, content_hash, signed_at, signature}

I19 (continuous):
  for each deployed control artifact:
      recompute content_hash over canonicalised content
      compare to manifest
      on mismatch → halt the class's halt scope
                  → raise CRITICAL incident
                  → the mismatch itself is journaled

Independent recomputation:
  the AUDIT PLANE recomputes every hash from its own copy
  and compares to the manifest it holds
```

**Four properties are load-bearing.**

1. ~~**The hash is over canonicalised content**, not the file bytes, so a whitespace change does not halt the company and a semantic change cannot hide behind formatting.~~ **SUPERSEDED BY `§3c` (v1.3.6, `S1K-C5`).** *"Canonicalised content"* named no canonicalisation for control artifacts and was circular for class 20, whose signed content **is** the canonicalisation specification. **`content_hash = SHA-256(EXACT_ARTIFACT_BYTES)`.** The cost — that a whitespace change is a different artifact — is accepted deliberately, because the alternative requires a canonicalisation that class 20 cannot have without signing itself under itself.
2. **The audit plane recomputes independently.** A manifest check run only by the control plane is a check the control plane can pass by lying (`30 §5.2`).
3. **The prohibited-commitment grammar runs against classes 7 and 8 at authoring time in CI**, not only against generations at runtime. This is the specific fix for v1.0's largest gap here, and it is a CI rule rather than a hash check — the hash proves the corpus is the signed one, and the grammar proves the signed one is safe.
4. **Halt scope is per class.** A template hash mismatch stops that utterance class; order fulfilment continues.

---

## 3a. The root of trust (v1.3.6, `S1K-C1`, `S1K-C3`, `S1K-C10`)

### The algorithm

**OWNER CONTROL-ARTIFACT SIGNATURES USE Ed25519.** The standard primitive, RFC 8032 PureEdDSA over Curve25519: a 32-byte public key, a 64-byte signature, signing the message directly with no pre-hash step and no context string. **There is no custom elliptic-curve construction, no RSA alternative, and NO ALGORITHM NEGOTIATION IN S1.** A signature presented under any other algorithm identifier, or in any other encoding, is **REFUSED**; there is no fallback path and no "try the other verifier" branch.

The same algorithm is used for the primary owner artifact signature, the second-factor approval signature, the signed manifest envelope, and the Cedar/O4 artifact signatures now brought under this mechanism (`§2e`).

**THE KEYS ARE DISTINCT FROM EVERY OTHER Ed25519 KEY IN THE SYSTEM.** They are not the audit-plane signing key (class 24, generated on and never leaving the audit-plane host). They are not a `ConstructorVersionRecord` signing key (class 19, `§3i`). They are not an OWNER-tier principal's runtime grant-signing key. They are not an adapter or provider credential.

### The two trust roots

**Two separate verification keys are required.**

| Name | Role |
|---|---|
| `OWNER_ARTIFACT_ROOT_KEY` | verifies the **PRIMARY** owner artifact signature and the primary manifest signature |
| `OWNER_ARTIFACT_SECOND_FACTOR_KEY` | verifies the **SECOND_FACTOR** approval signature and the second-factor manifest signature |

**Both public keys are TRUSTED DEPLOYMENT ROOTS. They are not control artifacts. They are not manifest rows. They are not discovered from a database, from the manifest, from the network, from a model, from a caller, from an API, or from the first signature observed.**

**TRUST-ON-FIRST-USE IS FORBIDDEN.** There is no "remember the key that first verified" path, no "accept any valid Ed25519 key" path, and no per-request key parameter.

**The public keys are provisioned OUT OF BAND through the trusted deployment mechanism**, as deployment trust configuration outside the signed artifact set. **Their private halves are never present in the ACOS runtime** — see `§3a`'s custody rule below.

### Non-circularity

> **A SIGNATURE DOES NOT ESTABLISH ITS OWN VERIFIER.**

Runtime trust begins at the two externally provisioned Ed25519 public keys and **terminates outside ACOS's signed artifact graph**. This is what class 24 could not be for the owner's own key: class 24 works *because* a trusted owner key exists above it, and a class-24-shaped answer for the owner key would be exactly the circle `S1K-C3` reported.

**The manifest may carry key IDs for consistency checking, but it CANNOT DEFINE WHICH PUBLIC KEYS ARE TRUSTED.** `§3d`'s manifest core carries `expected_primary_key_id` and `expected_second_factor_key_id`; these are checked **against** the deployment-provisioned keys. **If the manifest names a different key: FAIL CLOSED.** The manifest is never the source of the key.

**There is no owner-key artifact signed by itself, and none may be created.**

### Key identifiers

`key_id = SHA-256(raw_ed25519_public_key_bytes)`, over the exact 32 raw public-key bytes — not a DER or SPKI wrapper, not PEM, not base64 — rendered in this architecture's standard **lowercase hexadecimal**, 64 characters.

Both root key IDs may be recorded in deployment configuration and in signature metadata. **The key ID is not the trust anchor by itself; the actual public-key bytes are.** A key ID that matches proves nothing if the bytes behind it were not the provisioned ones.

### Distinctness

**`primary_public_key != second_factor_public_key`**, compared over the raw 32 public-key bytes, and therefore **`primary_key_id != second_factor_key_id`**. A deployment configuring the same key in both slots **fails closed at bootstrap** and never becomes READY. **A second signature produced under the primary key does not satisfy the second-factor requirement**, whatever its `signer_role` claims.

### Private-key custody

**Neither private key exists in application source, in this repository, in any database, in any environment variable available to the runtime, on the runtime filesystem, in the manifest, or in any CI fixture used by production.** Production signing is an **offline release ceremony**. Tests may use dedicated keys that are unambiguously test-only and are never a production trust root. **No HSM or vendor is specified here**; production private-key technology remains an operational deployment concern rather than an architecture claim.

### Rotation

**There is NO automatic runtime key rotation, and none is invented here.** For the current S1 / pre-live architecture:

- root-key rotation is an **OWNER / DEPLOYMENT CEREMONY**;
- the deployment trust configuration must be changed **explicitly**, out of band;
- the runtime **restarts and re-bootstraps** against the new trust roots;
- **an old manifest cannot cause its own trust root to remain accepted**, because the trust roots are never read from a manifest.

**Online root rotation is DEFERRED.** There is no "try every key the manifest offers" behaviour, and a verifier that iterated candidate keys would not conform.

---

## 3b. `ACOS-CAS-SIG-V1`: the signature envelope (v1.3.6, `S1K-C2`)

**A cryptographic framing, independent of `ACOS-JCS-1`.** It is used **only** to form signature messages for control artifacts and for the manifest.

**IT DOES NOT DEPEND ON THE ARTIFACT BEING SIGNED.** It never parses, inspects, canonicalises or reserialises artifact content; it consumes only the artifact's identity fields and its content digest.

**IT DOES NOT DEPEND ON `ACOS-JCS-1`.** No rule of `ACOS-JCS-1` is referenced, imported or required. **IT USES NO JSON AND NO JSON RESERIALIZATION.** A change to `ACOS-JCS-1` does not change `ACOS-CAS-SIG-V1`, and the coincidence that both use a four-byte big-endian length prefix is not a dependency: `ACOS-CAS-SIG-V1` is completely specified here.

### The field encoding

```
CAS_FIELD(b) = uint32_be(len(b)) || b
```

| Rule | Declaration |
|---|---|
| Length prefix | **4 bytes, big-endian, unsigned.** Every field carries one |
| Payload | **raw bytes.** Every value is a byte string; there are no typed payloads |
| NULL | **NOT REPRESENTABLE.** There is no reserved word, no sentinel and no absent state. `0xFFFFFFFF` is an ordinary (unreachable) length, not a reserved word — this is a deliberate difference from `ACOS-JCS-1` |
| Separators | **NONE.** Fields are concatenated. No delimiter, no padding, no trailing bytes |
| Text values | **UTF-8, NFC**, then the NFC form's UTF-8 bytes. `U+0000` is excluded |
| Integer values | **decimal ASCII**, no leading zeros, no leading plus, a leading minus only for a negative value; zero is `0`. There is no second integer convention: integers are carried as text, and the only binary integer in the framing is the length prefix |
| Digest values | the **32 raw `SHA-256` bytes**, never hex, never base64 |
| Signature values | the **64 raw Ed25519 signature bytes** |
| Maximum field length | `0xFFFFFFFE`. Additionally: `artifact_id` at most **256 bytes**, `artifact_version` at most **64 bytes**, `signer_role` and both domain separators are from fixed sets. A value exceeding its maximum **fails closed** and is never truncated |

### The artifact signature message

```
M_artifact =
    CAS_FIELD("ACOS-CONTROL-ARTIFACT-SIGNATURE-V1")   # domain separator
 || CAS_FIELD(signer_role)                            # "PRIMARY" | "SECOND_FACTOR"
 || CAS_FIELD(artifact_class)                         # decimal ASCII
 || CAS_FIELD(artifact_id)                            # UTF-8 NFC
 || CAS_FIELD(artifact_version)                       # UTF-8 NFC
 || CAS_FIELD(content_sha256)                         # 32 raw bytes
```

**Ed25519 signs `M_artifact` directly.** There is no pre-hash, no envelope-of-an-envelope and no second digest step.

**The domain separator is `ACOS-CONTROL-ARTIFACT-SIGNATURE-V1`**, as literal ASCII bytes.

**THE SIGNATURE BINDS CLASS, IDENTITY, VERSION AND CONTENT, and that is what each binding buys:**

| Binding | Substitution it prevents |
|---|---|
| `artifact_class` | **cross-class substitution** — a class-3 signature cannot be presented for class 20 |
| `artifact_id` | **cross-artifact substitution** — artifact A's signature cannot be presented for artifact B |
| `artifact_version` | **version substitution** — an old version's signature cannot validate a new version |
| `content_sha256` | **content substitution** — different bytes under the same identity do not verify |
| `signer_role` | **role substitution** — see below |

### Signer-role domain separation

**The signer role is an explicit field INSIDE the framed message**, taking exactly one of `PRIMARY` or `SECOND_FACTOR`. This is the normative choice; a separate per-role domain separator is **not** used, and the two mechanisms are not combined.

**A signature produced as `PRIMARY` therefore cannot be transplanted into the `SECOND_FACTOR` slot, even if the two keys were accidentally identical**, because the signed bytes differ. **The distinct-public-key requirement of `§3a` is still separately and independently required**; role separation does not replace it, and neither one alone is sufficient.

---

## 3c. Content hashing (v1.3.6, `S1K-C5`)

**For every signed control artifact:**

```
content_hash = SHA-256(EXACT_ARTIFACT_BYTES)
```

**The input is the exact immutable bytes deployed to the consumer.** Any byte difference — including a line terminator, a trailing newline or a byte-order mark — changes the digest and therefore changes the artifact's identity.

**WHAT IS NEVER HASHED:** a parsed semantic object; a reserialised JSON document; a pretty-printed object; a TypeScript object literal or its property order; a runtime object graph; a row set read from a database.

**This is what resolves the class-20 circularity.** The digest is taken over bytes, using only `SHA-256`, so **the integrity check of the canonicalisation specification does not depend on the canonicalisation specification.** `§3g`'s dependency graph states the same fact as a graph property.

**A signed control artifact is therefore a concrete immutable byte object**, and every one carries exactly: an artifact class; an artifact ID; an artifact version; the artifact bytes; the `SHA-256` content hash of those bytes; a primary owner signature; a second-factor signature.

**The runtime consumes the signed bytes, or a parsed immutable representation derived EXCLUSIVELY from those verified bytes.** **A signed artifact and a separate hard-coded production literal may not both be authority sources**, with equality asserted only in a test; that arrangement leaves the unsigned literal authoritative, because the test is not in the authority path. See `§3f`'s single-source rule.

---

## 3d. The MANIFEST CORE (v1.3.6, `S1K-C9`)

**Per-artifact signatures authenticate the rows that are present. They do not protect the ROW SET.** A deleted row removes a requirement; an inserted row adds one; a reordering or a substitution of a complete, validly signed older set defeats every per-row signature without forging anything. **v1.3.6 defines a signed MANIFEST CORE.**

### The core's content

| Field | Content |
|---|---|
| `manifest_format_version` | the manifest framing's own version, `ACOS-CONTROL-MANIFEST-CORE-V1` |
| `manifest_epoch` | this manifest's version identity, monotonic within a deployment lineage |
| `expected_primary_key_id` | the `key_id` this manifest expects to be verified under |
| `expected_second_factor_key_id` | the second-factor `key_id` this manifest expects |
| `entry_count` | the **exact** number of artifact entries |
| `entries` | the exact **ordered** artifact entries |

**Each artifact entry carries exactly:** `artifact_class`; `artifact_id`; `artifact_version`; `content_hash`; `primary_signature`; `second_factor_signature`.

### Entry order

**Ascending by `(artifact_class, artifact_id, artifact_version)`**, with each key compared as declared:

1. `artifact_class` — as an **unsigned integer**, ascending;
2. `artifact_id` — **byte-wise lexicographic** over its UTF-8 NFC bytes, with a proper prefix sorting before its extensions;
3. `artifact_version` — **byte-wise lexicographic** over its UTF-8 NFC bytes, on the same rule.

**The order is a property of the bytes, not of any implementation's map iteration, locale or collation.** Two entries with all three keys equal are a **defect**, not a tie: the manifest fails closed.

### The core's bytes

```
CORE =
    CAS_FIELD("ACOS-CONTROL-MANIFEST-CORE-V1")
 || CAS_FIELD(manifest_format_version)
 || CAS_FIELD(manifest_epoch)
 || CAS_FIELD(expected_primary_key_id)
 || CAS_FIELD(expected_second_factor_key_id)
 || CAS_FIELD(entry_count)                            # decimal ASCII
 || for each entry, in the declared order:
        CAS_FIELD(artifact_class)                     # decimal ASCII
     || CAS_FIELD(artifact_id)
     || CAS_FIELD(artifact_version)
     || CAS_FIELD(content_sha256)                     # 32 raw bytes
     || CAS_FIELD(primary_signature)                  # 64 raw bytes
     || CAS_FIELD(second_factor_signature)            # 64 raw bytes
```

**The same `ACOS-CAS-SIG-V1` field encoding, and no other. No `ACOS-JCS-1`. No JSON. No parsed-object insertion order.**

`entry_count` is inside the signed bytes **and** the entries follow it, so a deletion is detectable twice over: the count disagrees, and the entry sequence differs.

### The manifest signatures

```
manifest_core_sha256 = SHA-256(CORE)

M_manifest =
    CAS_FIELD("ACOS-CONTROL-MANIFEST-SIGNATURE-V1")   # a SEPARATE domain
 || CAS_FIELD(signer_role)                            # "PRIMARY" | "SECOND_FACTOR"
 || CAS_FIELD(manifest_format_version)
 || CAS_FIELD(manifest_epoch)
 || CAS_FIELD(expected_primary_key_id)
 || CAS_FIELD(expected_second_factor_key_id)
 || CAS_FIELD(manifest_core_sha256)                   # 32 raw bytes
```

**THE MANIFEST CORE ITSELF RECEIVES BOTH SIGNATURES** — a primary Ed25519 signature and a second-factor Ed25519 signature, under the separate domain `ACOS-CONTROL-MANIFEST-SIGNATURE-V1`.

**The manifest's own two signatures are NOT inside the bytes being signed.** They are carried beside the core. (The per-entry artifact signatures **are** inside `CORE`, which is deliberate: they are part of the set whose integrity the manifest signature protects.)

---

## 3e. Manifest identity and the deployment pin (v1.3.6, `S1K-C9`)

```
manifest_id = SHA-256(exact CORE bytes)
```

using `§3d`'s fixed independent framing. **Not `ACOS-JCS-1`. Not a parsed JSON object's insertion order.**

**THE TRUSTED DEPLOYMENT CONFIGURATION PINS THREE THINGS:**

1. `OWNER_ARTIFACT_ROOT_KEY` — the primary public key bytes;
2. `OWNER_ARTIFACT_SECOND_FACTOR_KEY` — the second-factor public key bytes;
3. `EXPECTED_ACTIVE_MANIFEST_ID` — the manifest identity this deployment is intended to run.

**The runtime may verify a manifest only if its computed `manifest_id` equals `EXPECTED_ACTIVE_MANIFEST_ID`.** The pin is checked **before** the signatures, because a signature check on a manifest the deployment did not intend proves only that someone once signed something.

**Consequently:**

| Attack | Outcome |
|---|---|
| a valid **old** signed manifest presented | **REJECTED** — its `manifest_id` differs from the pin |
| a **different** signed artifact set | **REJECTED** — same |
| a **deleted** entry | **REJECTED** — `entry_count` and the entry sequence both move `manifest_id` |
| an **inserted** entry | **REJECTED** — same |
| entries **reordered** | **REJECTED** — the declared order is normative and the bytes differ |
| an artifact's **bytes changed** under an unchanged manifest entry | **REJECTED** — **not by the pin.** `manifest_id` is unmoved, because the core did not change; the recomputed `SHA-256` of the artifact's exact bytes no longer equals its entry's `content_hash`, so `§3f`'s bootstrap step 7 fails and the entry's two artifact signatures are stale for the bytes on disk |
| an artifact's bytes changed **and** its entry updated to match, with the old signatures kept | **REJECTED** — step 7 now passes and **step 8 fails**: `§3b`'s envelope binds `content_sha256`, so a signature over the old digest does not verify over the new one. The core also changed, so `manifest_id` moves and the pin rejects it first |

**THE PIN IS NOT THE ONLY REJECTION, AND IT IS NOT CLAIMED TO BE.** Rows 1–5 are rejected on the **manifest identity**, before any signature is checked. Rows 6–7 are rejected on the **per-artifact content hash and the per-artifact signatures**, at `§3f`'s bootstrap steps 7 and 8. **Both legs are required**: the pin alone authenticates the set and not the bytes, and the per-artifact checks alone authenticate the bytes and not the set. Either leg failing fails the whole bootstrap closed.

**This introduces no mutable runtime trust state.** Nothing is remembered between runs, nothing is learned, and no highest-epoch-wins rule exists.

> **"THE HIGHEST EPOCH FOUND ON DISK" IS NOT ROLLBACK PROTECTION AND IS NOT USED.** `manifest_epoch` is recorded for lineage and for operator legibility; **the pin is what rejects a rollback.**

Where repository deployment conventions carry an equivalent **immutable release identifier**, that identifier may serve as the pin, provided it is immutable, externally provisioned, and equal in force to the digest.

---

## 3f. `I19`'s verification occasions (v1.3.6, `S1K-C4`)

**`I19` IS EVENT- AND USE-GATED. IT IS NOT PERIODIC-TIMER SECURITY.** No polling cadence is introduced — not 30 seconds, not 60 seconds, not 5 minutes, not any interval. **The invariant is "continuous" because NO AUTHORITY CONSUMER CAN OBTAIN OR USE AN UNVERIFIED CONTROL-ARTIFACT BUNDLE**, which is a structural property rather than a schedule.

### Occasion 1 — BOOTSTRAP

**Before the kernel becomes READY**, in this order:

1. load the two root public keys from the deployment trust configuration;
2. check `primary_public_key != second_factor_public_key`;
3. compute `manifest_id` and check it equals `EXPECTED_ACTIVE_MANIFEST_ID`;
4. verify **both** manifest signatures against the two provisioned keys;
5. check `expected_primary_key_id` and `expected_second_factor_key_id` in the core equal the provisioned keys' ids;
6. verify the **complete** manifest set — every required class present, `entry_count` exact, order as declared;
7. for **every** required artifact: recompute `SHA-256` over its exact bytes and compare to its entry's `content_hash`;
8. for **every** required artifact: verify **both** signatures under `§3b`'s envelope.

**On any failure the kernel FAILS CLOSED BEFORE ANY AUTHORITY EXECUTION.** It does not become READY, it does not serve a degraded subset, and it does not admit a single effect.

### Occasion 2 — PUBLICATION / RELOAD

**Any artifact or manifest reload is verified COMPLETELY BEFORE BECOMING ACTIVE.** The full ceremony of occasion 1 runs against the candidate bundle.

**Publication of a new verified bundle is ATOMIC**, and **a failed candidate bundle NEVER replaces the current verified bundle.** There is no partial swap and no per-artifact hot reload.

### Occasion 3 — RUNTIME AUTHORITY USE

**Production authority code receives only a `VerifiedControlArtifactBundle`** — an immutable capability whose existence is proof that occasion 1 or occasion 2 completed successfully for the bytes it carries.

**Raw or unverified artifact loaders are NOT EXPOSED TO AUTHORITY CONSUMERS**, and **no caller and no model may manufacture this capability.** The capability boundary is the runtime enforcement. **Re-verifying signatures inside every request is NOT required**, because the immutable capability already proves bootstrap or publication verification; requiring it would buy nothing and would tempt an implementation to cache the result anyway.

### Backing-store changes

**The runtime does NOT dynamically reread arbitrary backing bytes on each authority operation. The active verified bundle is IMMUTABLE.**

**If files change on disk after verification, they have NO AUTHORITY EFFECT until an explicit reload occurs**, and that reload must pass the full ceremony before publication. **There is therefore no security requirement to periodically rehash merely because bytes on disk may have changed.** **That is what "continuous" means in `I19`: continuity of the capability, not frequency of a check.**

### The single source of authority

**For classes 3 and 27 the signed artifact bytes ARE the deployed authority source.** Production code may parse them into frozen typed structures **after** verification. **It may not maintain a signed artifact value and a hard-coded production literal as two authority sources with equality asserted only in tests** — that leaves the unsigned literal authoritative in the path that matters. Migrating today's frozen literals onto the verified bundle is **required S1K runtime work** and is listed as such in `37 §2`.

### The pre-authority / pre-claim gate

Both local authority construction and external-effect dispatch are **structurally dependent on the active verified bundle**:

- action-catalogue authority uses **verified class 3**;
- degraded dispatch authority uses **verified class 27**;
- `ACOS-JCS-1` consumers are bound to the **verified class-20 specification identity**;
- the Cedar loader verifies the **signed Cedar artifact** before the engine is constructed (`§2e`);
- **external claim and dispatch cannot proceed if the verified bundle is unavailable or invalid.**

### Failure

On any integrity or signature failure the declared incident semantics are **unchanged and retained**:

- **fail closed**;
- **do not use the candidate artifact**;
- raise the declared **CRITICAL security incident**;
- **journal it** where the current architecture permits a trusted journal to remain operational;
- **do not silently fall back to an older artifact**;
- **do not fetch a replacement from the network**.

**If bootstrap fails before journalling infrastructure is safely available, local startup-failure evidence and logging may be the only immediate signal, and that is accepted.** **A journal chain must NOT be fabricated using unverified `ACOS-JCS-1` rules** in order to record the failure of the artifact that declares those rules.

---

## 3g. The bootstrap dependency graph (v1.3.6, `S1K-C3`, `S1K-C8`)

**NO EDGE MAY POINT UPWARD.**

```
externally provisioned root public keys
        |
        v
fixed CAS framing + SHA-256 + Ed25519
        |
        v
manifest core
        |
        v
artifact hashes / signatures
        |
        v
verified artifact bundle
        |
        v
kernel authority mechanisms
```

**The class-20 special case.** Because `ACOS-JCS-1` **is** class 20, **its signature envelope and its manifest verification MUST NOT REQUIRE `ACOS-JCS-1`.** They use only `SHA-256`, the fixed `ACOS-CAS-SIG-V1` framing, and Ed25519. **After class-20 artifact verification succeeds, the `ACOS-JCS-1` implementations may be admitted and used for journal canonicalisation.** That is the resolution of the circularity, and it is why `§3b` forbids any `ACOS-JCS-1` dependency in the envelope.

**The manifest special case.** **Manifest verification cannot depend on any artifact inside the manifest.** Every input it needs — the two public keys, the pinned identity, the framing, the hash function and the signature algorithm — sits strictly above the manifest in the graph.

---

## 3h. Runtime state is not artifact-signed (v1.3.6, `S1K-C7`)

**`I19` DOES NOT AUTHENTICATE ORDINARY MUTABLE RUNTIME DATABASE STATE, and does not begin to merely because a row once appeared in the control-artifact inventory.**

`window_registry` rows, `window_balance` rows, reservations, effects, authorisations, outbox rows and journal rows are **runtime state**. Their integrity continues to be governed by their own mechanisms:

- **trusted writer boundaries** — only kernel-owned paths write authority quantities;
- **PostgreSQL constraints** — the ceiling and commitment guards, the state-machine constraints, the uniqueness and foreign-key rules;
- **economic transaction semantics** — the decisive transaction and its four-term guard;
- **journal and audit mechanisms** — the two independent hash chains and the two-sided completeness diff;
- **owner and grant authority** where applicable.

**`I19` IS NOT A GENERIC DATABASE-ROW-SIGNING SYSTEM AND IS NOT EXTENDED INTO ONE.**

---

## 3i. Class 19's relationship to this mechanism (v1.3.6, `S1K-C3`)

**S1B's `ConstructorVersionRecord` verification already performs a real Ed25519 signature check, and it DOES NOT SATISFY THE OWNER ROOT MODEL. This pass does not claim otherwise and changes no S1B production code.**

`ConstructorVersionResolver` takes the verifying public key **as a constructor argument** and holds no keystore, no rotation and no revocation list. S1B was entitled to that because class 19 was not its subject and it recorded the limitation. **A CALLER-SUPPLIED VERIFICATION KEY IS NOT A TRUST ROOT**, and it must not become the general S1K pattern.

**Class 19 is an owner control artifact** — `§2` assigns it Owner plus second factor, and a constructor computes every dispatched amount. **Its verification keys should therefore become the same externally provisioned roots this section declares. THAT MIGRATION IS DECLARED FUTURE WORK** and is listed in `37 §2`'s S1K gate as a follow-on rather than a pre-live blocker, because class 19's records are verified at registry load against a key the kernel supplies from trusted code rather than from a model or a request.

**It is not a separate trust domain by design.** It is the same domain, reached by a mechanism that predates the root declaration.


---

## 4. Who signs what, and why the burden is real

**Classes 1, 2, 3, 5, 15, 16 and 19–27 require a second factor.** *(Class 17 is struck from this list by v1.3.6's `§2d` retirement.)*

**v1.3.6 — THE SECOND FACTOR IS A SECOND INDEPENDENT Ed25519 APPROVAL SIGNATURE (`S1K-C10`).** v1.3.5 required a second factor on every artifact in the pre-live set and declared no mechanism, so a runtime accepting one owner signature would have reported an insufficiently authorised artifact as verified — an open obligation converted into a false assurance.

**EVERY pre-live signed artifact requires TWO valid signatures**: a **PRIMARY** owner artifact signature under `OWNER_ARTIFACT_ROOT_KEY`, and a **SECOND_FACTOR** approval signature under `OWNER_ARTIFACT_SECOND_FACTOR_KEY`. Both are externally provisioned trust roots (`§3a`); the public keys and their key IDs **must be distinct**; the role is bound inside the signed message (`§3b`); and **a second signature from the same key DOES NOT satisfy the requirement.** The evidence is the entry's own `primary_signature` and `second_factor_signature` fields, both inside the signed manifest core (`§3d`). **The manifest core itself is dual-signed on the same rule.** An artifact or a manifest presenting one valid signature is **REFUSED**, and is never reported as verified. Each can move money, redefine truth, or — in v1.3's three additions — decide whether an audit check runs, whether corroboration can be forged, or how much the owner may dispatch outside the mirror.

**Classes 7 through 14 require an owner signature without a second factor.** They shape what ACOS says and believes but cannot directly move value.

**v1.3's three additions are all in the second-factor tier, and one deserves a note.** Class 26 is the first control artifact whose subject is *an audit check's own coverage*. `47 §5` observed that an audit whose scope the audited party can narrow is worse than no audit, because its silence is read as evidence; making the sweep specification signed is the mechanical answer, and `30 §5.10`'s CI rule that the vendor query must be period-bounded is the review answer.

**The cost, stated plainly.** Editing a customer-service template becomes an owner-signed act. That slows communication iteration — and it is the cost EM4 already accepted for templates in v1.0 and then failed to enforce, so v1.1 is not adding a burden so much as making an accepted one real.

**The honest risk.** A signing ceremony the owner must actually perform is one more demand on the scarcest resource in the company (`44 §6`), and eighteen classes is a lot of ceremonies. ADR-025's reconsideration trigger is the right response: **if the signing burden exceeds the owner's attention budget, reduce the number of artifacts requiring signature by making some of them derived — do not relax the invariant.** A derived artifact (a compiled grammar, a generated rendering table) inherits its parent's signature and needs none of its own.

---

## 5. What this does not protect against

- **A signed artifact that is wrong.** The manifest proves the deployed artifact is the one the owner signed. It says nothing about whether signing it was a good idea. Class 9's grammar is the clearest case: `44 §2.1` produced six prohibited commitments that pass a correctly-deployed, correctly-signed grammar.
- **The signing key.** The owner is the root of trust (`49 §3.9`) and a compromised owner credential is out of architectural scope.
- **The migration principal.** A principal that can `ALTER` the manifest table's constraints operates beneath this mechanism (`49 §3.11`). External anchoring is the control there, not this one.
- **Promoter error on already-promoted facts.** Correcting a promoter rule does not retract the RECORDs it created. Those need explicit supersession (`24 §8`), and `24 §10` case 3 concedes that a promoted false fact reaches a customer with full confidence.

---

## 6. The control-artifact inventory after v1.3.7

**The pre-live signed set. No `etc.` No `including`.** Every entry's content boundary is closed by the section named in its row. **v1.3.7 adds exactly one entry — class 5 — because `§2g` gives ADR-024's option-B money-moving trigger a signed operand and a trigger operand read from anywhere else would be unsigned authority.** **Every entry requires both signatures. Every entry is a manifest member.** Content hashes other than class 20's are **not computable until the artifacts are assembled by the S1K runtime slice**, and no hash is manufactured here.

| Class | `artifact_id` | Version | Concrete bytes / source | Schema / content boundary | Runtime consumer | Primary sig | Second-factor sig | Manifest member |
|---|---|---|---|---|---|---|---|---|
| **2** | `acos.control.policy_set` | the bundle's declared version | the Cedar schema file plus every `.cedar` policy source file, as one immutable byte object | `§2e` | the policy loader, before the Cedar engine is constructed | **YES** | **YES** | **YES** |
| **3** | `acos.control.action_catalogue` | the catalogue's declared version | the assembled closed-catalogue artifact bytes | `§2a` — ten per-class fields plus four catalogue-level records | local authorisation, step R's MIE reservation, dispatch precedence, the refund constructor, effect enumeration | **YES** | **YES** | **YES** |
| **5** | `acos.control.credential_scopes` | the declaration's declared version | the assembled credential-scope declaration artifact bytes | `§2g` — one record per configured vendor credential, exactly seven fields | **v1.3.7:** the adapter-runtime registry's option-B trigger, and `48 §3.6`'s audit read-only exemption | **YES** | **YES** | **YES** |
| **20** | `acos.control.jcs1_specification` | `ACOS-JCS-1` | **`artifacts/acos-jcs-1.spec.v1.txt`, 13479 bytes, `7af60fc564aef296679ae06a34b188d3454ac7ef69f448f7260a3d5d55a18f33`** | `§2b` — the artifact file is the boundary | both journal chain implementations and the TypeScript canonicaliser, bound to the verified specification identity | **YES** | **YES** | **YES** |
| **27** | `acos.control.degraded_mode_config` | the configuration's declared version | the assembled degraded-mode configuration artifact bytes | `§2c` — exactly four static quantities | the mirror state machine and dispatch precedence | **YES** | **YES** | **YES** |
| ~~**17**~~ | — | — | **RETIRED — `§2d`.** Per-company `window_registry` rows are runtime state; `irrecoverable_units` moved to class 3 | n/a | n/a | **n/a** | **n/a** | **NO — retired** |

**Also in the manifest at the pre-live gate, unchanged in content by this pass and carried here so the set is complete rather than partial:** **class 19** (effect constructors and their `ConstructorVersionRecord`s — `§3i` declares the key migration as follow-on work) and **class 24** (the audit-plane signing key's published public half, whose entire trust story is that it is hashed into an owner-signed manifest — which `§3a` now terminates non-circularly for the first time). **Both require both signatures and both are manifest members.**

**Classes 1, 4–16, 18 and 21–23 and 25–26 remain declared in `§2` and are not part of the S1K PRE-LIVE subset**, because no S1 runtime consumer reads them. They enter the manifest when their consumers do. **That is a sequencing statement, not a weakening: `§6`'s rule below still applies to every one of them.**

**The closure rule, stated once for the whole inventory.** **Any field capable of affecting policy authority, economic authority, recoverability, adapter selection, external-write scope, canonicalisation, dispatch precedence, degraded-mode authority or effect construction MUST have exactly ONE declared artifact owner.** No such field may exist outside all signed artifact boundaries. **No field may belong ambiguously to two artifacts** unless duplication and equality are explicitly declared normative — and the only such case in this package is `corroboration_signal_max_age`'s audit-plane copy, declared in `§2c`.
