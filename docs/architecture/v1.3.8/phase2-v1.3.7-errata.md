# Phase 2 — ACOS Operating Spine v1.3, package issue v1.3.7 — errata record

**Issued 2026-09-26. One normative resolution, `S1N-C1`, plus the OWNER CORRECTION of
2026-09-26 — `CRD-09` and `CRD-10`.**

**v1.3.7 WAS NOT OWNER-ACCEPTED WHEN THE CORRECTION WAS MADE, SO IT IS CORRECTED IN PLACE
RATHER THAN SUPERSEDED.** There is no v1.3.8. `docs/architecture/v1.3.6/` remains untouched
and byte-identical.

**The underlying architecture is `Operating Spine v1.3` and is unchanged.** `v1.3.7` is a
package issue. `docs/architecture/v1.3.6/` is **not modified by this pass** and remains on
disk as the previous issue, byte for byte.

---

## 0. What this pass is, in one paragraph

S1N implemented the integration-plane runtime and the per-adapter credential boundary, and
recorded one open owner question. ADR-024 builds the execution proxy *"at the first
**money-moving credential** or the third adapter, whichever comes first"*, and **v1.3.6 did
not define `money-moving credential` as a mechanised predicate anywhere.** `23 §11`,
`29 §3.2`, `31 §12`, `33 §7` and `37 §5` all use the phrase; none says how a build would
decide it. S1N derived it from `50 §2a` field 4, `carries_vendor_monetary_field`, and flagged
the derivation for a ruling.

**The owner ruled the derivation wrong in kind**, not merely in calibration. v1.3.7 records
the ruling, gives the classification a closed domain and a signed owner, and mechanises
ADR-024's trigger. **Nothing else moves.**

---

## 1. `CRD-08` — `money-moving credential` had no mechanised definition (`S1N-C1`)

### The defect

`50 §2` row 5 read *"Credential scope declarations"* and closed nothing. There was no artifact
declaring what a configured vendor credential can do at its provider, no field carrying a risk
classification, and no rule deciding one. So ADR-024's trigger — the mechanism that decides
whether the execution proxy is required before a real vendor credential is ever held — had an
operand that no deliverable supplied.

An implementation therefore had three choices, and all three were defects:

1. **derive it from the action catalogue**, which is what S1N did under protest, and which
   answers a different question;
2. **read it from deployment configuration**, which puts an unsigned value in charge of
   whether the proxy is required;
3. **decide it by hand at review time**, which is not a mechanism at all.

### The ruling

> **MONEY-MOVING IS A PROPERTY OF THE CREDENTIAL'S CAPABILITY ENVELOPE AT THE PROVIDER. IT IS
> NOT A PROPERTY OF THE ACTION ACOS CURRENTLY INTENDS TO CALL.**

`29 §14` is the standing finding that makes the distinction load-bearing and that v1.3.6
already carried: *"vendor OAuth scopes are coarser than ACOS action classes on every platform
examined"*. A credential provisioned so ACOS can send one email routinely carries provider
permissions ACOS never intends to use. **A classification that read ACOS's intended action
would be classifying the credential by the half of its envelope ACOS chose to look at.**

### The resolution

**`50 §2g` (new)** declares:

* the normative definition, as **nine clauses** over what the credential can do **at the
  provider**, *without requiring a second independently held credential*;
* the closed classification `credential_risk_class` ∈ {`READ_ONLY`, `NON_MONETARY_WRITE`,
  `MONEY_MOVING`} — **exactly three values and no fourth**, with **no `UNKNOWN`**;
* **maximum privilege** for a mixed envelope — *"the highest reachable, never the lowest,
  never the average and never the intended"*;
* **fail-closed** for a missing, unparseable or out-of-set classification;
* the **closed class-5 record**: one per configured vendor credential, exactly seven fields,
  with fields 5–7 consistency-checked against field 4 and against each other;
* the reserved **`audit_plane`** scope for an audit-plane read credential, which is scoped to
  a provider rather than to an adapter;
* **ADR-024's trigger, mechanised**: option A is permitted only while fewer than three
  adapter runtimes are configured **and** every configured credential is other than
  `MONEY_MOVING`.

**`50 §2` row 5** now points at `§2g` and owes a fresh owner signature. **`50 §2f`** gains
three field-first rows, all owned by class 5 and by no second class. **`50 §6`** gains exactly
one inventory entry.

**`34` ADR-024** records the ruling, the mechanised trigger, and the reason the operand is
signed rather than configured. **`48 §3.6`** gains a signed operand for row 13's read-only
exemption **and separates three obligations that were previously one sentence**. **`37 §2`**
adds the class-5 gate item and `SEQ-04`.

### What did NOT change

* **No authority quantity moved.** MAL is unchanged, every grant, cap, floor and threshold is
  unchanged, and `analysis/recompute-v1.3.py` reproduces its recorded output.
* **No mechanism entered the authority path.** `26`'s authority model is untouched, and
  `50 §2g` says so explicitly: *"a `MONEY_MOVING` credential does not grant ACOS any
  authority"*.
* **Class 3 was not widened.** It stays at exactly ten per-class fields plus four
  catalogue-level records. Putting a credential's permissions there would have re-opened the
  action-versus-credential conflation the ruling closes, and would have broken `50 §2f`'s
  one-field-one-class rule.
* **Option B was not built.** v1.3.7 makes its trigger objectively executable and adds no
  execution proxy. A deployment that crosses either half under option A is refused at
  configuration.
* **No control-artifact signature is discharged.** Class 5's is newly owed and is not
  discharged; classes 2, 3, 19, 20, 24 and 27 remain owed as they were.

---

## 2. `SEQ-04` — why class 5 joins the pre-live subset and nothing else does

`37 §2`'s S1K gate lists nine items a deployment must have **before the first real external
vendor call**. v1.3.7 adds a tenth, and the argument is the one the other nine were pulled
forward on: **the mechanism is a precondition for safely enabling any real external
dispatch.**

The first real vendor credential is the first moment ADR-024's trigger must be decided, and it
is decided **at configuration, before any dispatch**. An operand read from an environment
variable, a caller parameter, an adapter's own self-description, a model output or a provider
response would be **unsigned authority over whether the execution proxy is required** — which
is the one question ADR-024 exists to answer.

**Classes 1, 4, 6–16, 18, 21–23 and 25–26 stay where `50 §6` leaves them.** `I17b`, class
19's key migration, the later owner briefing, the unrelated S4 audit mechanisms and provider
reconciliation all stay at S4 or later, exactly as v1.3.6 left them.

---

## 3. `48 §3.6` — three obligations, separated by their evidence

v1.3.6's row 13 exemption rested on one sentence: *"Row 13's credentials are read-only,
separately provisioned, and attempted-write-tested (`36 §13`)."* Three obligations, one
clause, and **no artifact declared any of them**.

v1.3.7 separates them because they have different evidence and different status:

| Obligation | Evidence | Status at v1.3.7 |
|---|---|---|
| *separately provisioned* | the audit credential resolves from its own source, in its own runtime | **mechanised** |
| *read-only* | `50 §2g` fields 6 and 7 over signed bytes | **mechanised** |
| *attempted-write-tested* | a write attempted with the audit credential **fails at the PROVIDER** | **NOT DISCHARGED BY ANY SIGNED DECLARATION** |

**`I8` AND `36 §13` ARE NOT WEAKENED.** A signed `READ_ONLY` declaration says what the
deployment believes it provisioned; `36 §13` asks the vendor. A provider whose only credential
able to read the required evidence is also able to send **cannot earn the exemption by
declaring `READ_ONLY`**, because the declaration would be false and the vendor would prove it
false — and `50 §2g`'s consistency check is deliberately unable to rescue it. That is a
**provider-selection** finding, and the correct response is to not select the provider.

---

## 4. The sections this pass edits

| Deliverable | Section | Change |
|---|---|---|
| `50` | **`§2g` (new)** | the normative definition, the closed classification, the closed class-5 record, and ADR-024's mechanised trigger |
| `50` | `§2` row 5 | points at `§2g`; the content hash moves and a fresh owner signature is owed |
| `50` | `§2f` | three new field-first rows, owner class 5; the preamble records that no row gains a second owner |
| `50` | `§6` | one new inventory entry — class 5, dual-signed, manifest member — and the heading moves to v1.3.7 |
| `34` | ADR-024 | the ruling, the mechanised trigger, the placement rationale, and the restated *Reconsider if* |
| `48` | `§2` row 13, `§3.5/§3.6` | the signed operand, and the three obligations separated by evidence |
| `37` | `§2` S1K gate | the class-5 gate item, `SEQ-04`, and the restated no-code disclaimer |

**No other deliverable is edited. `22`, `23`, `24`, `25`, `26`, `27`, `28`, `29`, `30`, `31`,
`32`, `33`, `35`, `36`, `38`, `49` and `51` are byte-identical to v1.3.6.**

---

## 4a. `CRD-09` — a signed credential declaration that governed no particular credential

### The defect, and why every existing control passed it

`§1` gave `credential_risk_class` a closed domain and a signed owner. It did **not** say which
credential a record is about, in any sense a runtime could check. Field 1 read *"a credential
identifier, unique within the artifact"* — satisfied by a nickname — and the runtime ran two
chains that never met:

```
signed class-5 `credential_id`  ->  credential_risk_class  ->  the registry admits the runtime
`secretLocator`                 ->  resolved material      ->  presented at the provider
```

A locator repointed at another credential produced a deployment whose signed risk declaration
governed a credential it was not holding:

| | integration plane | audit plane |
|---|---|---|
| signed record says | `pause_only` = `NON_MONETARY_WRITE` | `audit_read` = `READ_ONLY`, `audit_plane`-scoped |
| material actually resolved | `budget_manage` = `MONEY_MOVING` | a SEND-CAPABLE token |
| what was wrong | **ADR-024's option-B trigger never fired** on the credential in hand | **`48 §3.6`'s exemption rested on a declaration about a different credential** |

**Nothing in either chain is forged and no signature is broken.** Every check that existed
passed: the descriptor was well formed, the adapter was in the catalogue, the signed record
existed and said what it said, the `audit_plane` sentinel was present, the locator was
genuinely not one the other plane held.

### The resolution

**`50 §2g` field 1 is redefined as the stable non-secret identity of the EXACT CREDENTIAL
MATERIAL the runtime may present** — a provider key ID where the provider exposes one, an
immutable deployment/secret-manager credential identity or version where it does not, and
never the raw secret, a hash of it, or a token prefix. **A provider for which no such identity
can be defined forces PARTIAL rather than a claimed binding.**

**`50 §2g` gains a runtime-use requirement.** Before a credential-holding runtime may reach its
provider boundary it compares the signed expected `credential_id` to the identity its own
secret source returned, and a mismatch refuses — on the integration plane before any adapter
code runs, and on the audit plane before any provider query. The secret source must return a
mandatory non-secret identity; `null` is insufficient for a configured credential.

**The parent may pass the expected identity as a trusted non-secret launch echo, and the echo
is not authority.** The signed artifact remains authority and the parent verified it already;
the echo exists because `I25` forbids the control plane holding a vendor credential, so the
identity of the resolved material is visible only inside the child.

**LOCATOR ISOLATION AND IDENTITY BINDING ARE DIFFERENT CONTROLS AND BOTH ARE KEPT.** Two
locators may resolve one credential; one locator may be repointed at another.

**And the binding is not scope conformance.** It proves *"this is credential A"*; it does not
prove *"credential A still holds the permissions the signed record declares"*. Scope drift
stays an empirical provider-side obligation, and `36 §13`'s attempted-write test stays owed.

---

## 4b. `CRD-10` — a test path that cannot produce the evidence it is selected for

### The defect

`36 §5`'s rule was *"vendor sandboxes rather than mocks"*, written against the mock's failure
mode. **It did not anticipate the opposite failure**: a vendor mode that is genuinely real,
genuinely bounded, and deliberately produces no evidence.

Official Twilio SendGrid Sandbox Mode documentation states that a sandbox request is validated
and never delivered, **and that requests made in sandbox mode generate no events in either the
Event Webhook or Email Activity.** The v1.3.7 candidate's capability record carried that row as
`null` — "the documentation is silent" — and carried the question as an account-validation
item. **The documentation is not silent, and the item could never have been closed by an
account.**

The consequence was structural rather than cosmetic. The selection rule checked five
capabilities independently, so a provider passed on two facts that never hold at the same time:

```
NON_PRODUCTION_TEST_PATH     "the provider has a sandbox mode"          true
QUERYABLE_PROVIDER_EVIDENCE  "the provider has an activity query API"   true
conjunction                                                             true
reality                      the sandbox mode suppresses the query API
```

The readiness token then named a sandbox environment in which `I36` can observe nothing.

### The resolution

**`36 §5` states the rule the sandbox wording was missing**: a non-production test path that
suppresses the provider's own evidence surface does not satisfy the `I36` validation path, and
the same bounded design must carry the whole chain — real request, provider acceptance,
provider-side evidence, independent audit observation. **It is not enough that a provider has a
sandbox mechanism and, separately, an activity-query API.**

**The `I36` oracle row and the duplicate-send gate row are both restated** to name a dedicated
non-production environment whose accepted sends are recorded and queryable, rather than a bare
"provider sandbox".

**SendGrid remains the selected provider**, because its other documented capabilities still
satisfy the rule and because its `I36`-compatible path exists: a dedicated non-production
sending identity with **sandbox mode DISABLED** and an owner-controlled sink recipient. The
sandbox flag keeps a narrower use — request-shape and credential-scope validation — and is
recorded as unusable for accepted-count evidence, the six-kill-point oracle, Email Activity
correlation and Event Webhook reconciliation.

---

## 5. Verification

`analysis/consistency-v1.3.py` carries **108 conditions** after this pass — C1–C29, E1–E7,
F1–F3, G1–G10, H1–H13, J1–J16, K1–K25 and the nineteen new **L1–L19** — and exits non-zero on
failure. **L1–L12 were issued with the candidate; L13–L19 are the correction.**

`phase2-v1.3.7-verification.md` maps every L condition to the seeds that fail it. **Every one
of L1–L19 is failed by at least one seed, and all 70 previously retained seeds still
discriminate — 77 seeds in total, every one re-run against the corrected corpus.**

**THREE OF THE SEVEN CORRECTION SEEDS RESTORE WHAT THE CANDIDATE ACTUALLY SAID**, rather than
inventing an unsafe design to argue against: `--seed-credential-id-is-alias` restores field 1's
original definition, `--seed-no-runtime-identity-binding` restores a runtime with no
comparison, and `--seed-sendgrid-sandbox-is-oracle` restores the capability record and both
gate rows.

Two conditions were amended rather than added to:

* **K14** asserted that all FOUR live `§6` inventory rows demand both signatures and manifest
  membership. v1.3.7 adds a fifth, so K14 now asserts FIVE and reads the renamed heading.
* **L12** asserted `48 §2` row 13's restated text, which named two halves. The correction adds
  a third — the resolved material must be bound to field 1 before any provider query — so L12
  asserts the corrected row.

Both amendments are recorded here because a condition edited quietly is a condition weakened
quietly. Both remain exact equalities rather than membership checks, so a row that dropped one
of its halves would still fail.

**NO PRODUCTION SIGNING CODE EXISTS AT v1.3.7, AND NO EXECUTION PROXY EXISTS EITHER. NO
PROVIDER REQUEST OF ANY KIND WAS MADE BY THIS PASS OR BY ITS CORRECTION.**
