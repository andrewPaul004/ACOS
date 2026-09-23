# 49 — The Trusted Computing Base

**ACOS Operating Spine v1.3. Version 1.3. Issued 2026-09-03. New in v1.1.**
Created in response to R4 and R5. Sourced from `41 §3` and `42 §4`. Referenced by `29 §14`, `33 §11` and `26 §10.4`.

## v1.3 change record

No change in v1.3. Version line bumped so the package carries one version; `phase2-v1.3-changelog.md §7` records which artifacts were materially edited and which were not.

---

## 1. Definition, and why the definition is the point

**A Trusted Computing Base member is any component whose compromise cannot be bounded by the architecture's own controls.**

That is a narrower and more useful test than "a component we rely on". ACOS relies on the reasoning workers; it does not trust them — ADR-010 assumes they are compromised and every control is designed on that assumption. The workers are therefore *not* TCB members, and that is the architecture's central achievement.

The test that matters:

> **`MAL_total` bounds a compromised model. It bounds nothing about a compromised TCB member.**

v1.0's residual analysis (`29 §14`) ranked seven risks and led with competitor poisoning. **It did not contain the concept of a trusted computing base at all**, and four of the fourteen members below appeared nowhere in the package. `41 §3` is the source, and its finding is that *"the architecture's security argument is about the reasoning layer, and the reasoning layer is not where the remaining risk is."*

---

## 2. The membership test, applied

For each candidate, three questions. A **yes** to the third makes it a member.

1. Can it originate or influence an external state change, a RECORD-grade fact, or a control artifact?
2. If it did so maliciously, would a deterministic control detect it?
3. If detected, is the resulting loss bounded by a mechanism ACOS controls?

| Component | (1) Can act | (2) Detected | (3) Bounded | Member? |
|---|---|---|---|---|
| Reasoning worker | Proposes only | Yes — every proposal is authorised | Yes — `MAL_total` | **No** |
| CEO function | Proposes; authors delegated decisions | Partly — drift is weakly detected | Partly | **No, with caveats (§4)** |
| Quarantined ingestion (Z4) | Emits one typed signal | Yes | Yes | **No** |
| **Adapter** | Presents a credential exceeding its action classes; retained-response provenance | Only by disagreement with an independent read | **No** | **Yes** |
| **Control plane** | Everything | Only by the audit plane's independent reads | **No** | **Yes** |
| **Effect Canonicaliser** | Computes every dispatched amount | Only by settlement, weeks later | Partly | **Yes** |
| **Policy engine + policy set** | Decides every authorisation | Only by symcc and property tests | **No** | **Yes** |
| **Exposure ledger** | Is the bound | Only by independent recomputation | **No** | **Yes** |
| **Audit plane** | Verifies everything; now holds read credentials | Its silence is indistinguishable from correctness | **No** | **Yes** |
| **Control artifacts** (16 classes) | Determine what may be said, believed, calculated, authorised | Yes — I19 hash manifest | Partly | **Yes** |
| **CI/CD pipeline** | Builds and tests everything | **No** | **No** | **Yes** |
| **Migration / DDL principal** | Can alter the audit schema | **No** | **No** | **Yes** |
| **Cloud database operator** | Reads and writes both instances below the trigger layer | Only by external anchoring | **No** | **Yes** |
| **Secret manager / IAM** | Holds every vendor credential | No | No | **Yes** |
| **Observability vendors** | Receive payloads from credential-holding processes | No | No | **Yes** |
| **Owner** | Root of trust | n/a | n/a | **Yes, by definition** |

**Fourteen members.** v1.0 named or implied ten. The four it did not name — CI/CD, the migration principal, the cloud database operator, and the observability vendors — are marked in §3.

---

## 3. Each member, its blast radius, and what mitigates it

### 3.1 Adapters (named in v1.0; membership not acknowledged)

**Blast radius.** Its vendor credential's **full scope** — which on three of four platforms substantially exceeds the action classes it serves — **plus the union of every authority whose preconditions its RECORD-grade writes can satisfy.** v1.0's stated bound (`36 §10`) was only the first clause. `35 §12.2` is the concrete second clause: a compromised commerce adapter unlocks the advertising budget authority without touching the advertising credential.

**Why membership is irreducible.** `42 §4` establishes there is no third design. Removing adapters from the TCB requires the **vendor** to issue per-action credentials, and none does: Shopify scopes are app-level and its offline tokens never expire; Google Ads requires the full `adwords` scope for any GAQL query including a pure read; Meta's `ads_management` covers create/update/pause/delete; ESP server tokens send anything to anyone. **Stripe restricted keys are the one genuine exception in the stack and are worth using for exactly that reason.**

**Mitigations.** Per-adapter runtime, filesystem and dependency-tree isolation. The parser split (I26) — the adapter must produce a well-formed **vendor response**, not a well-formed ACOS fact. I27 — no OBSERVATION used as a policy precondition derives solely from one adapter's writes. The audit plane's own vendor reads (I8), which detect fabrication **by disagreement**. Per-credential revocation that revokes. The continuous prohibited-class probe (I15).

**Residual: open.** Every mitigation above narrows it; none closes it.

### 3.2 The control plane (named in v1.0; blast radius understated)

**Blast radius.** Everything, subject to two limits: the audit store's resistance to **retroactive alteration** by an `INSERT`-only principal, and the limits of the adapters' vendor credentials. It can write false RECORD-grade facts, construct consistent-but-false journal rows going forward, and serve a filtered view to the owner.

**What v1.0 got wrong.** ADR-003's consequences offered *"the audit plane being separately deployed"* as the mitigation for the monolith's single blast radius. That protects the **record**, not the **company** (`41 §3.2`). And `33 §6`'s per-module-role claim implied isolation that does not exist: the `effect_path` role spans four schemas because `33 §1`'s decisive transaction requires it, so a compromised control-plane process holds it.

**Mitigations.** The audit plane's independent vendor reads. Hourly external anchoring (I17b) with `row_count`. The two-sided completeness diff (I17). Hash computation by database functions under roles the writer cannot assume (I17d). The owner's client-side diff of briefing against audit-plane appendix.

**Residual: open, and it is the second-largest in the architecture.**

### 3.3 The Effect Canonicaliser (new component in v1.1)

**Blast radius.** It computes every dispatched amount. A compromised or simply wrong canonicaliser produces authorisations that are internally consistent, pass every policy, satisfy I18a–I18d, and are economically wrong. **v1.2 adds a second surface: the canonicaliser also computes `value_direction`, so a compromised constructor that declares an outbound class `NONE` removes it from P4's scope entirely.** `36 §3.2`'s construction tests assert the computed direction per class against the hand-authored table in `26 §11.2`.

**Why it is nonetheless a large net improvement.** The alternative is the model computing them, which is v1.0. Moving a risk from a component assumed compromised to a component in the TCB is progress **only because the TCB component is deterministic, versioned, unit-testable against an independent oracle, and reviewable** — and that is the whole argument for it.

**Mitigations.** Per-class construction tests against a **hand-computed fixture table**, independent of the production constructor. I18a–I18d, including settlement within the declared class tolerance. **Constructor versioning (SR-C4)**, so a settlement dispute can identify which constructor computed the disputed exposure, and a replay under a differing `semantic_major` is refused rather than silently recomputed (I61). The T3 settled-cost gate at the bank line, which is the only unforgeable test.

### 3.4 Policy engine and policy set (named in v1.0)

**Blast radius.** Decides every authorisation. A wrong policy set is indistinguishable from a correct one without proof.

**Mitigations.** Cedar's symbolic verification of P1–P7 (deferred past S1, recorded as an `11 E6` amendment in `28 §9.2`). The policy set is a control artifact under B9 with a signed hash (I19). Prohibitions evaluated before grants and unappealable at runtime.

**Note the honest limit.** symcc proves properties of the policy set **given a request**, which is why §3.3 is a TCB member and why R1 outranked symcc in the complexity budget.

### 3.5 Exposure ledger (named in v1.0)

**Blast radius.** It *is* the bound. If reservation arithmetic is wrong, every downstream control is decorative.

**Mitigations.** Serialisable isolation asserted at the connection with a **negative control at REPEATABLE READ that must fail**. An exclusion constraint as backstop. Independent recomputation of `MAL_monetary` and `MAL_total` by a second implementation over `51-limits-fixture.md` (I7). Targeted interleaving rather than load testing.

### 3.6 The audit plane (named in v1.0; membership newly acknowledged, and enlarged in v1.1)

**Blast radius.** It verifies everything, and **v1.1 gives it read-only vendor credentials**, so it leaves the "own store only" posture. `41 §3.9` establishes it effectively already had external reach.

**The irreducible problem.** **Its silence is indistinguishable from correctness.** A compromised audit plane reports nothing wrong, which is exactly what a healthy one does. And it cannot audit what never touched a vendor.

**Mitigations.** Separate account, separate operator credentials, separate provider where possible. Read-only credentials, attempted-write-tested. Hourly anchoring delivered **to the owner**, which is the one channel that does not pass through either plane. A separate model binding for the audit reviewer.

**Residual: open.** v1.1 shrinks it substantially and does not close it (`47 §9.2`).

### 3.7 Control artifacts, **twenty-one signed classes** (six named in v1.0, sixteen in v1.1)

**Blast radius.** They determine what ACOS may **say** (templates, corpus, grammar, rendering policy), **believe** (promoter rules, `context_spec`s, detector patterns), **calculate** (metric specs, tolerance rules) and **authorise** (grants, policies, catalogue, model bindings, credential scopes, adverse-facts thresholds).

**What v1.0 got wrong.** B9 covered six classes. The prohibited-commitment grammar policed T-U1 generations at runtime and never policed the template corpus at authoring time, so **the entire T-U0 commitment surface was an unversioned file outside every invariant.**

**Mitigations.** `50-control-artifact-manifest.md` with owner-signed content hashes, I19's halt-the-affected-class on mismatch, independent recomputation by the audit plane, and the grammar run against templates in CI.

### 3.8 Secret manager and IAM (implicit in v1.0)

**Blast radius.** Every vendor credential.

**Mitigations.** Not held by any adapter. Owner-authenticated changes only. This member is unavoidable and is the reason ADR-024 defers the broker rather than adding a second chokepoint behind the first — `41 §3.7` notes that **vendor credentials survive an ACOS rebuild while the control plane does not**, so a broker's compromise would be worse than the control plane's.

### 3.9 The owner (named in v1.0 as out of scope)

**Blast radius.** Root of trust. Out of architectural scope, correctly.

**v1.1 addition: the owner can be *degraded* without being compromised.** `44 §6` establishes approval fatigue as the failure mode this architecture is most likely to actually experience. v1.0 **measured** approval dwell time and approval-without-inspection rate and connected them to no state change. The response is the owner-attention budget (I39) and the two new demotion triggers in `26 §13` — which demote the *capability* rather than asking the owner to try harder. **R16 is DEFERRED, so this mechanism is designed and not built.**

**v1.3.6 addition: *"root of trust"* is now a MECHANISM and not only a blast-radius note (`S1K-C3`).** v1.3.5 said the owner **is** the root of trust and that a compromised owner credential is out of architectural scope, and said nothing about **where a running ACOS process obtains the public half it verifies against**. That made the chain circular: the manifest was trusted because it was owner-signed, and the owner signature was trusted because the key was the owner's, with nothing declaring which key that is.

**`50 §3a` declares it.** Two Ed25519 public keys — `OWNER_ARTIFACT_ROOT_KEY` and `OWNER_ARTIFACT_SECOND_FACTOR_KEY` — **externally provisioned through the trusted deployment mechanism, outside the signed artifact set**. They are not control artifacts, not manifest rows, and not discovered from a database, a manifest, a network, a model, a caller, an API, or a first observed signature. **TRUST-ON-FIRST-USE IS FORBIDDEN.** **The owner verification keys terminate outside ACOS's signed artifact graph**, which is what makes `50 §3g`'s dependency graph acyclic: **a signature does not establish its own verifier.**

**The private halves remain out of architectural scope and out of the runtime.** They are never in application source, in this repository, in any database, in any environment available to the runtime, on the runtime filesystem, in the manifest, or in a CI fixture used by production. **Production signing is an offline release ceremony**, and its key technology is an operational deployment concern rather than an architecture claim.

**What is unchanged.** A compromised owner credential is still out of architectural scope, and still has the blast radius stated above. v1.3.6 bounds *what a running process will accept*; it does not bound *what a compromised owner may sign*, and does not claim to.

### 3.10 CI/CD pipeline — **not named in v1.0**

**Blast radius.** It builds and tests everything, and **it runs every check that constitutes this architecture's evidence.** A green pipeline is the only artifact anyone sees.

**Why v1.0 missed it.** `29 §7`'s supply-chain rule protected the **runtime**: credential-holding runtimes install nothing, pinned lockfiles, no post-install scripts. **All three incidents it cites — postmark-mcp clean to v1.0.15 and backdoored at v1.0.16, Shai-Hulud 2.0 across ~350 accounts, LiteLLM's 47,000 downloads in a three-hour compromise window — were build-time compromises.** The rule addressed the consequence and not the vector.

**Mitigations.** Pinned toolchain, reproducible builds where achievable, signed artifacts, branch protection with required checks, and — the important one — **a check-disablement audit**: `48 §7`'s fourth review question asks whether the CI check has been weakened or worked around for any build. **A perimeter enforced by a check someone turned off for a release is not a perimeter.**

### 3.11 Migration / DDL principal — **not named in v1.0**

**Blast radius.** Can `ALTER` the audit schema, removing the constraints that make the audit store append-only. **This is EM16 defeated at the layer beneath the grant.**

**Mitigations.** Audit-schema DDL is an owner-authenticated action recorded as a decision. The audit instance is on a separate account with separate operator credentials. Hourly external anchoring is the **only** control that survives this principal's compromise, which is why the cadence is stated rather than left as "periodic".

### 3.12 Cloud database operator — **not named in v1.0**

**Blast radius.** A managed provider can read and write everything in both instances **below the trigger layer**, including the audit chain.

**Why v1.0 missed it.** `31 §2` placed both instances on managed Postgres at commodity pricing with no separation requirement, so **one operator saw both sides of the separation EM16 depends on.**

**Mitigations.** Different providers, or at minimum separate accounts with separate payment methods and separate operator credentials. Hourly external anchoring to a medium the operator cannot rewrite, with a copy to the owner.

**Residual: open, and unavoidable at this scale.** Self-hosting trades this risk for an operational burden a one-person company cannot carry.

### 3.13 Observability vendors — **not named in v1.0**

**Blast radius.** Receive exception payloads from credential-holding processes (Sentry) and prompt/completion pairs that are case-scoped PII (Langfuse).

**Mitigations.** A positive scrub allowlist enforced in code, no support-worker context to any third-party tracing vendor, Langfuse dropped until self-hosted inside the VPC, and the exporter enumerated in `48`.

---

## 4. Why the CEO is not a member, and the caveat

The CEO proposes; it does not act. Its one direct effect class is authorised like any other, it cannot supply an exposure figure (I21), its decisions are `DECISION_DELEGATED` and cannot gate a monetary or irrecoverable class (I28), its objectives expire and require ratification (I37), and it cannot modify the adverse-facts threshold set (I38). Its compromise is bounded by `MAL_total(detection window)`.

**The caveat.** A **coherent** adversarial CEO — consistent, calibrated, patient, moving objective thresholds slowly with each move individually defensible and individually ratified — **is rewarded by the counter-metrics designed to catch it**, because those metrics detect inconsistency (`47 §9.3`). `27 §6`'s drift metric shrinks the window. Nothing closes it. This sits between "bounded" and "TCB member", and honesty requires saying so rather than choosing the more convenient category.

---

## 5. What this artifact changes about the architecture's claims

Three claims are narrowed by the existence of this document.

1. **`26 §10.4` gains a sixth item.** The list of things authorised loss does not bound now includes *the residual under a compromised TCB member*, and it is the largest of the six.
2. **`29 §14`'s residual ranking is reordered** with the TCB residual at rank 1, above competitor poisoning.
3. **`33 §11` adds the TCB residual, the audit plane's irreducible input dependency, and the coherent-CEO problem** as three risks that cannot be engineered away.

**And one claim survives intact, which is worth stating plainly.** No attack in `40` — the adversarial review's own attack log — reached a vendor credential from a model runtime. The reasoning-layer containment argument held. **The finding is not that the containment failed; it is that the remaining risk was never in the reasoning layer, and v1.0's risk analysis was pointed at the part that works.**
