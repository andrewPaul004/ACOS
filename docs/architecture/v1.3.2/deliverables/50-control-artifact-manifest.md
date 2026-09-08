# 50 — The Control-Artifact Manifest

**ACOS Operating Spine v1.3. Version 1.3. Issued 2026-09-03. New in v1.1.**
Created in response to R11. Governed by ADR-025. Enforced by I19 and I38.

## v1.3 change record

Classes 24, 25 and 26 added — the audit-plane signing key, the override limit set, and the `I8` sweep specification (TA-06, TA-05, TA-02/TA-03). Full disposition in `phase2-v1.3-remediation-ledger.md`.

---

## 1. The test for membership

**Does modifying this artifact change what ACOS may say, believe, calculate, or authorise?**

Not "is it code or data". Not "is it in version control". The question is whether an edit changes the system's behaviour in a way that defeats a stated invariant.

**Sixteen artifact classes pass that test. B9 in v1.0 protected six.** The ten it omitted include the one whose omission mattered most: the prohibited-commitment grammar was applied to T-U1 *generations at runtime* and never to the *template corpus at authoring time*, so **the entire T-U0 commitment surface — the only autonomous utterance tier at MVP — was an unversioned file outside B9's enumeration, outside every invariant, and editable by anyone with the deploy path** (UTT-02, REC-05).

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
| 2 | **Policy set** (Cedar source + compiled artifact) | ✔ | Owner, second factor | All effects |
| 3 | **Action catalogue**, incl. recoverability class, **`value_direction`** (v1.2 — six values, replacing `settlement_direction`), `semantic_option_digest` field list, enumeration `max_age`, approval floor | ✔ | Owner, second factor | All effects |
| 4 | **Model bindings** | ✔ | Owner | Affected task types |
| 5 | **Credential scope declarations** | ✔ | Owner, second factor | Affected adapter |
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
| 17 | **Named exposure windows** (v1.1 addition) | — | Owner, second factor | All effects |
| 18 | **Observability scrub allowlist** (v1.1 addition) | — | Owner | All third-party exporters |
| **19** | **Effect constructors** (v1.2, SR-C4) — the per-class canonicalisation logic and its `ConstructorVersionRecord`, including the declared semantic-by-definition field list | — | Owner, second factor | **All effects of the affected class.** A constructor computes every dispatched amount, every counterparty and every `value_direction`; an unversioned change to one is an unversioned change to what the system may spend |
| **20** | **Journal canonicalisation specification** (v1.2, SR-A3; NULL framing corrected v1.3.2, JCS-01) — `ACOS-JCS-1`: column order per row kind, decimal scales, timestamp format, **NULL framing under the reserved `0xFFFFFFFF` length word**, Unicode form, JSON canonicalisation, framing | — | Owner, second factor | **All effects.** A change silently breaks both hash chains and every downstream integrity claim. **v1.3.2's NULL-framing correction changes this class's `content_hash` and requires a fresh owner signature before any deployment** |
| **21** | **Adapter parameter set** (v1.2, SR-S4; operand corrected v1.3) — `daily_overdelivery_multiplier`, `monthly_basis_multiplier`, and the per-adapter **cessation specification** (the scalar `cessation_lag` is retired as the `I54` operand; fields scheduled under TB-07, `UNDECLARED`), each with its provenance grade | — | Owner, second factor | Affected adapter's rate classes |
| **22** | **`cessation_grace`** (v1.2, SR-S3) — the window in which a `StandingRevocationAuthority` outlives its grant | — | Owner, second factor | Standing pause path |
| **23** | **Anchor medium selection** (v1.2) — which media receive the hourly `{head_hash, chain_seq, row_count}` anchor | — | Owner, second factor | Anchoring; I17b |
| **24** | **Audit-plane signing key identity and published public key** (v1.3, TA-06) — the key under which `MirrorInputStallSignal` is signed, and the public half the control plane verifies against | — | Owner, second factor | **Entry into `CORROBORATED_DEGRADED`.** A substituted public key would let a compromised control plane mint its own corroboration, so the key is hashed into the manifest and a mismatch makes the corroborated state unreachable rather than forgeable |
| **25** | **Degraded-mode override limit set** (v1.3, TA-05) — the eight quantities in `51 §3.6` plus the registered OWNER-tier approver set | — | Owner, second factor | **Grant of any new `DegradedModeOverride`.** Active overrides run to their existing caps; no new one may be granted against an unverified limit set |
| **26** | **`I8` sweep specification** (v1.3, TA-02, TA-03) — per-adapter sweep cadence, coverage declaration, and the rule that the vendor query is period-bounded and never tag-bounded | — | Owner, second factor | **`I8` for the affected adapter.** A sweep whose scope was narrowed out of band is worse than no sweep, because its silence would be read as evidence |

**Twenty-six rows for twenty-four signed classes**, because row 6 is a prohibition rather than a signed artifact and row 3 is one class covering several declared fields. Rows 17–18 were added during v1.1 drafting once `48` and `51` existed; **rows 19–23 in v1.2** and **rows 24–26 in v1.3**, each because a mechanism in that release introduced an artifact that passes §1's test and would otherwise have been deployable without a signature. The manifest itself is the authority, not the count — but the count is now stated correctly, which v1.1's *"eighteen rows for sixteen classes"* was not, since it described eighteen rows of which seventeen were signed classes.

**Rows 19 and 20 are the two that matter most**, and both were invisible in v1.1. A constructor is the component `49` classifies as TCB — it computes every dispatched amount — and it was not a control artifact, so a constructor change was a code deploy governed by code review alone. `ACOS-JCS-1` is the definition of what the integrity machinery hashes; changing it is indistinguishable from breaking the chain, and nothing versioned it.

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

1. **The hash is over canonicalised content**, not the file bytes, so a whitespace change does not halt the company and a semantic change cannot hide behind formatting.
2. **The audit plane recomputes independently.** A manifest check run only by the control plane is a check the control plane can pass by lying (`30 §5.2`).
3. **The prohibited-commitment grammar runs against classes 7 and 8 at authoring time in CI**, not only against generations at runtime. This is the specific fix for v1.0's largest gap here, and it is a CI rule rather than a hash check — the hash proves the corpus is the signed one, and the grammar proves the signed one is safe.
4. **Halt scope is per class.** A template hash mismatch stops that utterance class; order fulfilment continues.

---

## 4. Who signs what, and why the burden is real

**Classes 1, 2, 3, 5, 15, 16, 17 and 19–26 require a second factor.** Each can move money, redefine truth, or — in v1.3's three additions — decide whether an audit check runs, whether corroboration can be forged, or how much the owner may dispatch outside the mirror.

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
