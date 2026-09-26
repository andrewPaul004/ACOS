# ACOS Operating Spine v1.3.6 — Verification

**Phase 2.5f. The gate for the v1.3.6 normative errata pass. Every condition can fail; every condition this pass and the v1.3.2–v1.3.5 passes introduced is demonstrated failing by a seed, and `§1a` states exactly which conditions are not.**

This document gates **only** the v1.3.6 pass. `phase2-v1.3-verification.md` (V1–V16), `phase2-v1.3.1-verification.md` (E1–E7), `phase2-v1.3.2-verification.md` (F1–F3), `phase2-v1.3.3-verification.md` (G1–G10), `phase2-v1.3.4-verification.md` (H1–H13) and `phase2-v1.3.5-verification.md` (J1–J16) remain in force and are re-run by the same script.

---

## 0. What is being gated

**Ten normative omissions and one re-sequencing**, all reported by the S1K pre-live control-artifact integrity re-evaluation as `S1K-C1`..`S1K-C10`. Every one is a case where **v1.3.5 declared the obligation to sign control artifacts and did not declare the mechanism**, which is why S1K could not implement against it and returned PARTIAL.

**The mechanical gate is `analysis/consistency-v1.3.py`, conditions K1–K25.** It exits non-zero on any failure and carries C1–C29, E1–E7, F1–F3, G1–G10, H1–H13, J1–J16 and K1–K25 together — **89 conditions**.

```
cd analysis
PYTHONUTF8=1 python consistency-v1.3.py                                          # 89 PASS / 0 FAIL, exit 0

PYTHONUTF8=1 python consistency-v1.3.py --seed-rsa-artifact-signature            # 88 PASS / 1 FAIL  -> K1
PYTHONUTF8=1 python consistency-v1.3.py --seed-same-key-both-slots               # 88 PASS / 1 FAIL  -> K2
PYTHONUTF8=1 python consistency-v1.3.py --seed-owner-key-from-manifest           # 88 PASS / 1 FAIL  -> K3
PYTHONUTF8=1 python consistency-v1.3.py --seed-tofu-accepted                     # 88 PASS / 1 FAIL  -> K4
PYTHONUTF8=1 python consistency-v1.3.py --seed-envelope-drops-class              # 88 PASS / 1 FAIL  -> K5
PYTHONUTF8=1 python consistency-v1.3.py --seed-envelope-drops-version            # 88 PASS / 1 FAIL  -> K5
PYTHONUTF8=1 python consistency-v1.3.py --seed-envelope-uses-jcs1                # 88 PASS / 1 FAIL  -> K6
PYTHONUTF8=1 python consistency-v1.3.py --seed-semantic-reserialisation          # 88 PASS / 1 FAIL  -> K7
PYTHONUTF8=1 python consistency-v1.3.py --seed-class3-open-membership            # 88 PASS / 1 FAIL  -> K8
PYTHONUTF8=1 python consistency-v1.3.py --seed-mie-units-stay-class17            # 87 PASS / 2 FAIL  -> J2, K9
PYTHONUTF8=1 python consistency-v1.3.py --seed-floor-dual-ownership              # 87 PASS / 2 FAIL  -> G1, K10
PYTHONUTF8=1 python consistency-v1.3.py --seed-window-rows-signed                # 88 PASS / 1 FAIL  -> K11
PYTHONUTF8=1 python consistency-v1.3.py --seed-no-class20-artifact               # 88 PASS / 1 FAIL  -> K12
PYTHONUTF8=1 python consistency-v1.3.py --seed-class20-hash-is-implementation    # 88 PASS / 1 FAIL  -> K13
PYTHONUTF8=1 python consistency-v1.3.py --seed-second-signature-optional         # 88 PASS / 1 FAIL  -> K14
PYTHONUTF8=1 python consistency-v1.3.py --seed-manifest-unsigned                 # 88 PASS / 1 FAIL  -> K15
PYTHONUTF8=1 python consistency-v1.3.py --seed-row-deletion-undetected           # 88 PASS / 1 FAIL  -> K16
PYTHONUTF8=1 python consistency-v1.3.py --seed-old-manifest-accepted             # 87 PASS / 2 FAIL  -> K17, K18
PYTHONUTF8=1 python consistency-v1.3.py --seed-ready-before-verification         # 88 PASS / 1 FAIL  -> K19
PYTHONUTF8=1 python consistency-v1.3.py --seed-partial-publication               # 88 PASS / 1 FAIL  -> K20
PYTHONUTF8=1 python consistency-v1.3.py --seed-raw-catalogue-consumer            # 88 PASS / 1 FAIL  -> K21
PYTHONUTF8=1 python consistency-v1.3.py --seed-cedar-hash-only                   # 88 PASS / 1 FAIL  -> K22
PYTHONUTF8=1 python consistency-v1.3.py --seed-anchor-is-bootstrap-root          # 88 PASS / 1 FAIL  -> K23
PYTHONUTF8=1 python consistency-v1.3.py --seed-vendor-call-before-gate           # 88 PASS / 1 FAIL  -> K24
PYTHONUTF8=1 python consistency-v1.3.py --seed-pull-forward-s4-audit             # 88 PASS / 1 FAIL  -> K25

# v1.3.6 H-COVERAGE CONTROLS — the four v1.3.4 conditions that had never had one.
PYTHONUTF8=1 python consistency-v1.3.py --seed-caller-selects-clock              # 88 PASS / 1 FAIL  -> H4
PYTHONUTF8=1 python consistency-v1.3.py --seed-posture-restores-row1             # 87 PASS / 2 FAIL  -> G6, H8
PYTHONUTF8=1 python consistency-v1.3.py --seed-override-unlocks-row1             # 88 PASS / 1 FAIL  -> H9
PYTHONUTF8=1 python consistency-v1.3.py --seed-adapter-pulled-into-s1            # 88 PASS / 1 FAIL  -> H13

# Retained, and all twenty-nine still fail — this pass did not disarm any previous control.
PYTHONUTF8=1 python consistency-v1.3.py --seed-no-mie-reservation                # 88 PASS / 1 FAIL  -> J1
PYTHONUTF8=1 python consistency-v1.3.py --seed-caller-mie-units                  # 88 PASS / 1 FAIL  -> J2
PYTHONUTF8=1 python consistency-v1.3.py --seed-unknown-to-realised               # 88 PASS / 1 FAIL  -> J3
PYTHONUTF8=1 python consistency-v1.3.py --seed-unknown-releases-mie              # 87 PASS / 2 FAIL  -> J3, J4
PYTHONUTF8=1 python consistency-v1.3.py --seed-returned-awaiting-irrecoverable   # 88 PASS / 1 FAIL  -> J5
PYTHONUTF8=1 python consistency-v1.3.py --seed-i20-current-balance               # 88 PASS / 1 FAIL  -> J6
PYTHONUTF8=1 python consistency-v1.3.py --seed-not-sent-as-never-sent            # 88 PASS / 1 FAIL  -> J7
PYTHONUTF8=1 python consistency-v1.3.py --seed-known-failure-requeues            # 87 PASS / 2 FAIL  -> J8, J9
PYTHONUTF8=1 python consistency-v1.3.py --seed-optional-dispatch-lease           # 87 PASS / 2 FAIL  -> J10, J14
PYTHONUTF8=1 python consistency-v1.3.py --seed-old-one-session                   # 87 PASS / 2 FAIL  -> J10, J11
PYTHONUTF8=1 python consistency-v1.3.py --seed-no-dispatch-revalidation          # 87 PASS / 2 FAIL  -> J12, J13
PYTHONUTF8=1 python consistency-v1.3.py --seed-gap-mutation-dispatches           # 87 PASS / 2 FAIL  -> J13, J15
PYTHONUTF8=1 python consistency-v1.3.py --seed-swap-outcome-fields               # 88 PASS / 1 FAIL  -> J16
PYTHONUTF8=1 python consistency-v1.3.py --seed-model-case-ref                    # 88 PASS / 1 FAIL  -> H1
PYTHONUTF8=1 python consistency-v1.3.py --seed-claim-case-ref                    # 87 PASS / 2 FAIL  -> H1, H2
PYTHONUTF8=1 python consistency-v1.3.py --seed-global-clock-search               # 88 PASS / 1 FAIL  -> H3
PYTHONUTF8=1 python consistency-v1.3.py --seed-irrecoverable-halt                # 88 PASS / 1 FAIL  -> H5
PYTHONUTF8=1 python consistency-v1.3.py --seed-irrecoverable-loose               # 87 PASS / 2 FAIL  -> H6, H7
PYTHONUTF8=1 python consistency-v1.3.py --seed-reclaim-timeout                   # 88 PASS / 1 FAIL  -> H10
PYTHONUTF8=1 python consistency-v1.3.py --seed-outbox-irrecoverable-only         # 88 PASS / 1 FAIL  -> H11
PYTHONUTF8=1 python consistency-v1.3.py --seed-swap-claim-fields                 # 87 PASS / 2 FAIL  -> H12, J16
PYTHONUTF8=1 python consistency-v1.3.py --seed-floor-25                          # 86 PASS / 3 FAIL  -> G1, G2, G3
PYTHONUTF8=1 python consistency-v1.3.py --seed-vendor-amount                     # 87 PASS / 2 FAIL  -> G1, G4
PYTHONUTF8=1 python consistency-v1.3.py --seed-lag-10m                           # 88 PASS / 1 FAIL  -> G5
PYTHONUTF8=1 python consistency-v1.3.py --seed-full-halt-15m                     # 87 PASS / 2 FAIL  -> G6, G7
PYTHONUTF8=1 python consistency-v1.3.py --seed-quota-as-cause                    # 86 PASS / 3 FAIL  -> G8, G9, G10
PYTHONUTF8=1 python consistency-v1.3.py --seed-generic-insert-fail               # 87 PASS / 2 FAIL  -> G9, G10
PYTHONUTF8=1 python consistency-v1.3.py --seed-old-null-bytes                    # 88 PASS / 1 FAIL  -> F3
PYTHONUTF8=1 python consistency-v1.3.py --seed-old-null-sentinel                 # 83 PASS / 6 FAIL  -> F1, F2, F3, H12, J16, K12
```

Recorded runs: `analysis/consistency-v1.3.6-output.txt` and the **twenty-nine** `analysis/consistency-v1.3.6-negative-control-*-output.txt` files — twenty-five for `K1`–`K25` and four for the H-coverage repair of `§1a`. **All thirty are reproduced byte for byte by re-running the script against the final tree.**

**EVERY MUTATION MODIFIES THE CORPUS IN MEMORY ONLY. NOTHING ON DISK IS TOUCHED BY A SEEDED RUN**, and every seeded run reports the number of edits it applied so a seed that silently stopped matching cannot be mistaken for a condition that stopped discriminating. **All twenty-nine v1.3.6 seeds apply every one of their edits**, and so do all twenty-nine retained ones.

**`analysis/recompute-v1.3.py` reproduces `analysis/recompute-v1.3-output.txt` line for line after this pass.** No authority quantity moved.

### Two prior conditions were RESTATED, and neither was weakened

**This pass changes two ownership facts, so two conditions that asserted the old ownership now assert the new one.** Both are recorded here rather than left for a reader to discover in a diff.

| Condition | Asserted at v1.3.5 | Asserts at v1.3.6 | Still discriminates? |
|---|---|---|---|
| **G1** | `51 §3.7` records the control-artifact effect as *"Declaring the value moves class 3's `content_hash`"* | `51 §3.7` records the correction to **class 27** | **YES** — `--seed-floor-25` still fails G1, G2 and G3; `--seed-vendor-amount` still fails G1 and G4; and the new `--seed-floor-dual-ownership` fails G1 and K10 |
| **J2** | class 17's manifest row carries `51 §2.3`'s unit table | `50 §2a` field 7 carries it, as **class 3** content | **YES** — `--seed-caller-mie-units` still fails J2 alone, and the new `--seed-mie-units-stay-class17` fails J2 and K9 |

**Neither restatement removes a check. Both gained a seed.** The v1.3.5 seeds that exercised them are unchanged and still fail at the same counts.

### One retained seed now fails one ADDITIONAL condition, and the coupling is real

**`--seed-old-null-sentinel` now fails K12 as well as F1–F3, H12 and J16 — six conditions, where v1.3.5 recorded five.** The seed reverts control-artifact class 20's manifest row to its v1.2 identity statement. **v1.3.6 put the class-20 artifact's content hash into that row**, so reverting the row removes one of the four places the digest is declared, and K12 — which requires the recomputed digest to be declared in `50 §2`'s class-20 row, `50 §2b`, `50 §6` and `30 §5.3a` — fails on the count.

**That is the coupling working as intended rather than incidental breakage.** v1.3.4 recorded the same seed acquiring H12 and v1.3.5 recorded it acquiring J16, both for the same structural reason: **class 20's manifest row is where the specification's identity is recorded, so anything that reverts the row reverts every identity claim the row carries.** v1.3.6 adds a fourth such claim — and the first one that is a real digest over real bytes.

---

## 1. The twenty-five conditions

| # | Condition | Kind |
|---|---|---|
| **K1** | **Ed25519 is THE declared owner control-artifact signature algorithm** — RFC 8032 PureEdDSA over Curve25519, covering the primary artifact signature, the second-factor signature, the manifest envelope and the Cedar/O4 signatures — with no custom curve, no RSA alternative, no negotiation in S1, any other algorithm identifier REFUSED, and **no competing algorithm declared anywhere in `50`** | required statements + a denylist |
| **K2** | **The two verification keys MUST be distinct** — distinct raw public-key bytes and therefore distinct key ids; a deployment configuring one key in both slots fails closed at bootstrap; a second signature under the primary key does not satisfy the requirement; `key_id = SHA-256(raw public key)`; **and the key id is not itself the trust anchor** | 5 required statements + 2 rules |
| **K3** | **The root public keys are EXTERNALLY PROVISIONED** — never control artifacts, never manifest rows, never discovered from a database, manifest, network, model, caller or API; the manifest may carry key ids for checking but **cannot define trust**, and a different key FAILS CLOSED; *a signature does not establish its own verifier*; and rotation is a **ceremony**, not a runtime key search | 7 statements in `50 §3a` + 2 in `49 §3.9` + the 4-part rotation |
| **K4** | **TRUST-ON-FIRST-USE IS FORBIDDEN**, in `50 §3a` and again in `49 §3.9`, with **all three routes named and denied** — remembering the first verifying key, accepting any valid Ed25519 key, a per-request key parameter — and **no passage permitting it** | required positives + a denylist |
| **K5** | **The artifact signature envelope BINDS domain, signer role, class, artifact id, version and content hash**, checked as a **PRINTED ORDER** rather than as membership, signed by Ed25519 **directly**; and each binding's substitution attack is named — cross-class, cross-artifact, version, content, role | the 6 framed fields **in printed order** + 7 statements |
| **K6** | **The framing is INDEPENDENT of `ACOS-JCS-1` and of the artifact being signed** — no rule referenced, no JSON, no reserialization, a NULL that is **not representable at all**, and a class-20 bootstrap using only `SHA-256`, the fixed CAS framing and Ed25519 | 5 statements + 2 bootstrap rules |
| **K7** | **`content_hash` is `SHA-256` over EXACT ARTIFACT BYTES** — never a parsed object, a reserialised JSON document, a pretty-printed object, a TypeScript literal or a row set; v1.3.5's property 1 is **explicitly SUPERSEDED**; and a signed artifact may not co-exist with a hard-coded literal as a second authority source | 5 statements + the 3-part single-source rule |
| **K8** | **Class 3's content is CLOSED** — `50 §2a` enumerates **ten** per-class fields and **four** catalogue-level records, numbered **1..14 without gaps**, states the boundary's other side, and **`50 §2`'s class-3 row carries no `incl.`, `including` or `etc.`** | parsed numbering + required statements + a per-row denylist |
| **K9** | **`irrecoverable_units` belongs to CLASS 3** — field 7 of the closed schema, restated in `50 §2d`'s split table, corrected in `51 §2.3`; the change is **ownership and not one numeric value**; the figures are unmoved; and **v1.3.5's class-17 assignment survives nowhere as a live claim** | required positives + a denylist |
| **K10** | **Degraded-mode ownership is UNAMBIGUOUS** — class 27 closed at exactly **four** quantities numbered 1..4, the `$20.00` floor moved from class 3 as an **OWNERSHIP correction with no value change**, class 3 no longer claims it in `50 §2` **or** `50 §2a`, `51 §3.7` records the correction, and **no runtime state is class-27 content** | parsed numbering + required statements in two artifacts + the MAL basis |
| **K11** | **Per-company `window_registry` rows are RUNTIME STATE** — class 17 retired from the manifest, **no empty artifact retained**, the number reserved and deprecated, the inventory recording it as a non-member, the **four** runtime-integrity controls that govern it named, and **`I19` not extended into a database-row-signing system** | 7 statements + the 4 named controls + the inventory row |
| **K12** | **Class 20 has a CONCRETE artifact** — `artifacts/acos-jcs-1.spec.v1.txt` exists, is **13479 bytes**, contains **no CR byte**, and its **RECOMPUTED `SHA-256`** equals the digest declared in `50 §2`'s class-20 row, `50 §2b`, `50 §6` **and** `30 §5.3a` | **the gate hashes the file** + a declaration count |
| **K13** | **The four implementations stay SEPARATE from the specification bytes** — each may hold a byte-identical **copy**, **no implementation's source is ever hashed as class 20**, and a valid class-20 signature proves the specification is owner-approved and **proves no implementation conforms**; VC-A3 remains the conformance mechanism in all three artifacts that mention it | 5 + 3 + 1 statements across `50`, `30` and `36` |
| **K14** | **EVERY in-scope pre-live artifact carries TWO signatures**, with a single valid signature **REFUSED** and never reported as verified, and **all four live inventory rows** demanding both plus manifest membership | 5 statements + a parsed inventory table |
| **K15** | **The MANIFEST CORE itself is DUAL-SIGNED** — under a **separate** domain, over a message binding format version, epoch, both expected key ids and the core digest **in printed order**, with the manifest's own two signatures **outside** the signed bytes | the 7 framed fields **in printed order** + 4 statements |
| **K16** | **The manifest entry SET and ORDER are deterministic** — an exact `entry_count` and the exact ordered entries, sorted ascending by `(artifact_class, artifact_id, artifact_version)` with **each key's comparison declared**, the order a property of **the bytes** rather than of map iteration, an exact tie a **defect**, and the core's twelve framed fields checked **in printed order** | the 12 framed fields **in printed order** + 9 statements |
| **K17** | **The deployment PINS the active manifest identity** — `manifest_id = SHA-256(exact CORE bytes)` under the fixed framing and **not `ACOS-JCS-1`**, the trusted configuration pinning both root keys **and** `EXPECTED_ACTIVE_MANIFEST_ID`, **the pin checked BEFORE the signatures**, and no mutable runtime trust state | 7 required statements |
| **K18** | **A valid OLD signed manifest cannot satisfy the active pin** — the rejection table naming the old manifest, the deleted entry, the inserted entry and the reordering, each rejected **on the pin** — and **"the highest epoch found on disk" is explicitly NOT rollback protection and is used nowhere** | 6 statements + a denylist |
| **K19** | **BOOTSTRAP verifies BEFORE READY** — **eight steps in printed order**, from loading the provisioned keys through both signatures on every artifact, any failure failing closed **before any authority execution** with no degraded subset and no admitted effect, and the declared incident semantics retained with **no silent fallback, no network fetch and no fabricated journal chain** | the 8 steps **in printed order** + 6 failure rules |
| **K20** | **RELOAD verifies BEFORE PUBLICATION** — the full bootstrap ceremony against the candidate, **atomic** publication, a failed candidate **never** replacing the active bundle, and **no partial swap and no per-artifact hot reload** | 3 statements, scoped to occasion 2 |
| **K21** | **Authority consumers accept ONLY the verified capability** — raw loaders not exposed, no caller or model able to manufacture it, the bundle **immutable** so a disk change has no authority effect until an explicit reload, per-request re-verification **not required**, external dispatch blocked without it, **no polling cadence at any interval**, and **`SCHED` withdrawn from the registry** | 10 statements + the registry's enforcement column |
| **K22** | **Cedar is INSIDE the signed framework** — class 2 has a concrete bundle, admission requires the verified manifest, the content hash **AND both signatures**, a hash-only bundle is **REFUSED**, the accepted `policy_version` digest is **retained unchanged** and declared **not** to be the class-2 content hash, and no semantic claim is conflated with it | 6 statements + the retained digest |
| **K23** | **`I17b` is NOT required for bootstrap** — it stays an **S3** deliverable, the deployment pin is what rejects a rollback, the anchor adds only later historical and non-repudiation protection, and **S1K is declared not to depend on it** | 3 statements in `37 §2` |
| **K24** | **The pre-live gate is SEQUENCED BEFORE the first real vendor call** — `37 §2` printing the **nine** required items in order inside S1's block, **ahead of the vendor slice, checked by string POSITION rather than membership**, S4's own entry agreeing, and the entry stating that **no production signing code exists at v1.3.6** | the 9 items **in printed order** + a **position** check |
| **K25** | **Unrelated S4 work REMAINS LATER** — the remaining signed classes, the later owner briefing, the unrelated S4 audit mechanisms and provider reconciliation each staying at S4, S4 keeping its own manifest entry, and **class 19's migration declared future work rather than silently claimed to satisfy the owner root model** | 5 statements in `37` + 4 in `50 §3i` |

**K5, K12, K15, K16, K19 and K24 are the sharp ones.**

**K5, K15, K16, K19 and K24 check ORDER or POSITION, not membership.** K5 requires the six framed fields of `M_artifact` to appear at strictly increasing offsets inside `§3b`'s message section; K15 does the same for the seven fields of `M_manifest`; K16 for the twelve fields of `CORE`; K19 for the eight bootstrap steps; and K24 additionally asserts by **string offset** that the S1K gate block is printed **before** the vendor slice in `37 §2`. **A message that carried exactly the right fields in the wrong order would pass a membership check and fails all of these.** That matters because a signature envelope is a *concatenation*: a reordering is a different message, and a bootstrap sequence that verified signatures before checking the pin would be checking a signature on a manifest the deployment never intended.

**`--seed-envelope-drops-class` and `--seed-envelope-drops-version` both fail K5, and that is the intended behaviour rather than a weakness.** The two seeds model the two distinct substitution attacks the envelope exists to prevent — cross-class reuse and version rollback — and **the same condition owns both because they are one fact about one message.** A gate that split them would be claiming the two fields could be declared independently, and they cannot: they are adjacent framed fields of a single concatenation.

**K12 is the only condition in the whole gate that reads a file and computes a hash.** It opens `artifacts/acos-jcs-1.spec.v1.txt`, recomputes `SHA-256` over its exact bytes, and compares the result to the digest declared in **four** places across two artifacts. **A specification edited without updating the declaration fails. A declaration edited without the file fails. A CRLF checkout fails**, because the condition also asserts the file contains no `0x0D` byte and is exactly 13479 bytes. **No previous statement about class 20 could have had this property, because class 20 had no artifact to hash** — which is exactly what `S1K-C8` reported.

**The two matched pairs are real coupling, and each proves something the single-condition seeds cannot:**

| Seed | Models | Fails | Proves |
|---|---|---|---|
| `--seed-mie-units-stay-class17` | the v1.3.5 ownership restored | **J2 and K9** | the unit count's **signed class** and its **catalogue ownership** are checked on one fact; reverting the class takes out both, and J2 — which has existed since v1.3.5 — is not satisfied by a class that no longer exists in the manifest |
| `--seed-caller-mie-units` | the unit count handed to a caller | **J2 only** | the **ownership** condition is separable from the **class** condition; K9 does not depend on who may supply the value |
| `--seed-floor-dual-ownership` | the floor owned by class 3 **and** class 27 | **G1 and K10** | ambiguous ownership fails both the quantity's own declaration site and the closure rule; **a value present in two artifacts is not the same as a value with two owners**, and this is what distinguishes them |
| `--seed-floor-25` | the value changed to `$25.00` | **G1, G2, G3** | the **value** conditions are untouched by the ownership correction — v1.3.6 moved the owner and moved no figure |
| `--seed-old-manifest-accepted` | epoch order replacing the pin | **K17 and K18** | the pin's **existence** and its **rollback consequence** are one fact about one rule; a manifest selected by epoch has no pin to check, so removing the pin removes the rollback property with it |

---

## 1a. Seed coverage, stated accurately

**All fifty-eight seeds were re-run against the FINAL v1.3.6 tree, after every edit of this pass.** The clean run is **89 PASS / 0 FAIL, exit 0**; **every one of the fifty-eight exits non-zero and fails at least one condition**, so no seed is inert and **no retained seed was disarmed**.

| Range | Conditions | Seed-covered | Not seed-covered |
|---|---|---|---|
| **K1–K25** (v1.3.6) | 25 | **25** | none |
| **J1–J16** (v1.3.5) | 16 | **16** | none |
| **H1–H13** (v1.3.4) | 13 | **13** | **none — repaired by this pass** |
| **G1–G10** (v1.3.3) | 10 | **10** | none |
| **F1–F3** (v1.3.2) | 3 | **3** | none |
| **E1–E7** (v1.3.1) | 7 | **0** | **all seven** |
| **C1–C29** (v1.3) | 15 | **0** | **all fifteen** |
| **Total** | **89** | **67** | **22** |

### The H-coverage defect this pass found, and closed

**`H4`, `H8`, `H9` AND `H13` HAD NO DISCRIMINATING SEED.** They were introduced without one in v1.3.4 and carried unchanged through v1.3.5. **Both `docs/architecture/v1.3.4/README.md` and `docs/architecture/v1.3.5/README.md` state that every one of `H1`–`H13` is failed by at least one seed. THAT STATEMENT WAS FALSE.** Those two packages are prior issues and **are not modified**; the correction and the repair both live here.

**Four new negative controls close it.** Each mutates the semantic property its condition exists to protect — not the syntax that carries it. **Every mutated corpus still parses, no section is deleted, no unrelated quantity moves, and no operative statement is turned into a comment.** Each models a plausible architecture regression: three of the four are a relaxation someone could argue for, and the fourth is the exact defect a prior errata pass corrected.

| Seed | Models | Fails | Why it is the right mutation |
|---|---|---|---|
| `--seed-caller-selects-clock` | `30 §9.2.5`'s evidentiary-clock rule relaxed to *"any qualifying live clock, at the implementation's discretion"*, with the caller allowed to nominate it and the field allowed to survive outside row 3 | **H4** | H4 exists to make the evidentiary clock **determinate** and **the decision's to choose**. The seed leaves `§9.2.4`'s qualifying set, the boolean operand and the whole section intact and changes only *which* clock is recorded and *who* picks it. **A caller-nominated evidentiary clock is the row-3 lever CSB-01 closed**, re-opened one level down |
| `--seed-posture-restores-row1` | `§5.1a`'s FULL-HALT POSTURE widened so an in-scope `DegradedModeOverride` restores **rows 1, 3 and 4** | **G6 and H8** | H8 exists to hold row 1 halted **and unrestorable** under the posture, with `§5.1a`'s rows-3-and-4-only composition unchanged. The seed edits the three sites that state the posture's composition and `22 §3.1`'s transcription of it, and **leaves `§5.7.2`'s ordinary override scope alone** — which is what separates it from the H9 seed below. **The G6 coupling is real and is documented in the next subsection** |
| `--seed-override-unlocks-row1` | an ordinary `DegradedModeOverride` able to unlock IRRECOVERABLE where the owner records a justification, with `51 §3.6`'s grantable set widened to `{IRRECOVERABLE, COMPENSABLE, REVERSIBLE}` | **H9** | H9 exists to keep the **ordinary** override out of row 1 in **every** state. The seed edits `§5.1b`'s override statement, `§5.7.2`'s scope rule, its structural exclusion and `22 §3.1`'s transcription — and **leaves the posture composition and both degraded reachability rows alone**, so it fails H9 and neither H6, H7 nor H8 |
| `--seed-adapter-pulled-into-s1` | SEQ-01's split collapsed: the real adapter and the HTTP/vendor-SDK call pulled into S1, `I36` claimed **whole** at S1, an outbox row count accepted as a stand-in for a provider accepted count, and the registry's slice column collapsed to match | **H13** | H13 exists to keep **PROVIDER TRUTH** out of the slice that cannot produce it. The seed leaves S1's seven-item foundation list completely intact, so it cannot pass by having emptied a section — **it fails on the sequencing claim itself**, which is the property SEQ-01 was raised to establish |

**`--seed-posture-restores-row1` fails G6 as well as H8, and the coupling is real rather than incidental.** `30 §5.1a`'s sentence *"Therefore, in the posture: rows 3 and 4 are restorable by an in-scope override; rows 1, 2 and 5 are not"* is **one sentence that two conditions read for two different reasons**: G6 requires it as the *resolved override composition* of the full-halt threshold it declares, and H8 requires it as the thing v1.3.4 **did not widen**. A seed that moved row 1 into the restorable set and left that sentence alone would fail H8 on its other two statements while leaving the corpus contradicting itself at the exact site H8's second leg guards. **The coherent mutation edits the sentence, and the two conditions that own it both fail.** This is the same shape as `--seed-floor-dual-ownership` (G1 and K10) and `--seed-old-manifest-accepted` (K17 and K18), and it is recorded here for the same reason.

**The other three fail exactly one condition each.** That is the sharper result and is what proves each check is discriminating rather than incidental: `H4` is separable from `H1`–`H3`, `H9` is separable from `H6`, `H7` and `H8`, and `H13` is separable from `K24` and `K25`, which read the same artifact.

### What remains uncovered, stated rather than implied

**`C1`–`C29` (fifteen live conditions) and `E1`–`E7` have no discriminating seed, and have never had one** — not in v1.3, not in v1.3.1, and not in any package since. **No README or verification document has ever claimed otherwise for them**, so this is a disclosure rather than a correction, but it is printed here so the coverage figure is not read as universal.

**They are not classified `MECHANICALLY ASSERTED — NON-SEEDABLE BY CONSTRUCTION`, and no such classification is claimed anywhere in this package.** Several of them are computed rather than matched — `C27` resolves every invariant identifier used anywhere against the registry, `C28` counts the DB-enforced enumeration, `C29` checks registry arithmetic — and a mutation harness could exercise all of those. **They are uncovered because no pass has authored the controls, not because a control is impossible.** That is a gate-quality gap of the same kind this pass just closed for `H4`, `H8`, `H9` and `H13`, one range older, and it is **carried to a later errata pass**. It blocks nothing in `S1K`: every condition the v1.3.2 through v1.3.6 errata passes introduced — **`F1`–`F3`, `G1`–`G10`, `H1`–`H13`, `J1`–`J16` and `K1`–`K25`, sixty-seven in all** — is fully seed-covered.

### The historical claim, and what was done about it

> **Earlier package READMEs overstated H-condition seed coverage; v1.3.6 discovered and corrected the verification coverage going forward.**

**`docs/architecture/v1.3.4/` and `docs/architecture/v1.3.5/` are NOT edited.** Their README statements are immutable historical package content and stay exactly as issued, wrong. **The correction is recorded in this package, the repair is made in this package, and no history is rewritten.**

---

## 2. What the gate does NOT prove

**The gate is a mechanical consistency pass over the architecture corpus. It reads documents** — and, for K12 alone, hashes one file in this package. It does not execute production code, does not touch a database, and proves nothing whatsoever about an implementation.

Stated here so no reader takes the 89/0 result for more than it is:

1. **It does not prove any signature exists.** **No owner signature exists for any control artifact.** No key has been generated, no ceremony has been performed, and nothing has been signed. The gate proves the architecture now says what a signature must be; it says nothing about one having been made.

2. **It does not prove any content hash except class 20's.** Every other `content_hash` in the inventory is **not computable until the artifacts are assembled**, and the gate does not manufacture one. Class 20's is real and is recomputed, because its artifact is real.

3. **It does not prove the runtime verifies anything.** **Runtime `I19` is not implemented.** There is no manifest, no loader, no verification ceremony, no `VerifiedControlArtifactBundle` and no fail-closed bootstrap path in `src/`. K19, K20 and K21 prove those are **declared**, not that they run.

4. **It does not prove the trust roots are provisioned.** No deployment trust configuration exists. K3 proves the architecture forbids every alternative source; it does not prove a key is sitting anywhere.

5. **It does not prove any implementation conforms to `ACOS-JCS-1`.** That is `36 §2`'s VC-A3, unchanged, and **K13 exists precisely to keep the two claims apart.**

6. **It does not prove the Cedar policy set is semantically correct.** K22 proves the bundle is inside the signature framework. Semantic correctness, symcc, equivalence and rotation are untouched and remain where they were.

7. **It does not prove the class-3 or class-27 artifact bytes match today's production literals.** The migration of those consumers onto the verified bundle is **declared required S1K runtime work** and is not done. **Until it is, the unsigned literal is still what production reads**, and `50 §3f` says so.

8. **It does not prove the pre-live gate is enforced.** `37 §2` sequences it. Nothing enforces a sequence but the people following it.

**The honest summary: v1.3.6 makes the mechanism specifiable and implementable. It implements none of it.**

---

## 3. Repository regression

**`src/` and `tests/` are byte-identical to the accepted baseline `ad8a78e` and to the S1K findings checkpoint `1cf1816`.** No production code, no test and no fixture was added, removed or edited by this pass.

**`npm run verify` REPRODUCES THE ACCEPTED BASELINE ON THE FINAL TREE. IT DID SO ONLY ON A QUIET MACHINE WITH A CLEAN DATABASE, AND THIS SECTION RECORDS EVERY RUN, NOT ONLY THE GREEN ONE.**

**Four runs established this result. The first three exited non-zero; the fourth, run in the conditions the first three lacked, is green.** **Editorial passes over this section after run 4 were each re-verified by a further full run from the edited tree, every one green at the same figures; they are not enumerated, because enumerating a run inside the document the run verified cannot terminate.**

| Run | Typecheck | Lint | Files | Tests | Passed | Failed | Skipped | Duration | Exit |
|---|---|---|---|---|---|---|---|---|---|
| 1 | **PASS** | **PASS** | 147 | 2057 | 1357 | **252** (74 files) | 448 | 2117s | **1** |
| 2 | **PASS** | **PASS** | 147 | 2057 | 1924 | **70** (13 files) | 63 | 5365s | **1** |
| 3 (after a container restart) | **PASS** | **PASS** | 147 | 2057 | 912 | **388** (91 files) | 757 | 295s | **1** |
| **4 — ACCEPTANCE. Quiet machine, database reset to empty, no concurrent run** | **PASS** | **PASS** | **147** | **2057** | **2057** | **0** | **0** | 6831s | **0** |

**The accepted baseline is 147 files / 2057 tests / 2057 passed / 0 failed / 0 skipped. RUN 4 REACHED IT EXACTLY.**

**RUN 4 IS THE ONLY RUN THIS PACKAGE CITES AS ACCEPTANCE EVIDENCE.** Runs 1–3 are retained above because a section that deleted them would be claiming a clean history it does not have, and because the difference between them and run 4 is the whole finding.

**NOT ONE FAILURE IS AN ASSERTION FAILURE.** Across all three runs the count of `AssertionError` and expected-versus-actual mismatches is **zero**. Every failure carries one of two PostgreSQL signatures -- `3F000 schema "public" does not exist` and `no schema has been selected to create in` -- or a downstream `42P01`, plus `Cannot read properties of undefined (reading 'close')` where a teardown ran after a failed setup. **The reported "skipped" counts are suites whose setup hook died, not declared skips.**

**THE MECHANISM, STATED EXACTLY.** `tests/support/fixture.ts`'s `reset()` calls `src/db/migrate.ts`'s `down()`:

```
DROP SCHEMA public CASCADE
CREATE SCHEMA public
```

**Neither statement is idempotent, and `DROP SCHEMA` carries no `IF EXISTS`.** If anything interrupts the pair between the drop and a completed re-migration -- in run 1 a `deadlock detected` inside `0008__journal_attestation.sql` -- the database is left with **no `public` schema at all**. **Every subsequent `reset()` then fails on its own `DROP SCHEMA`, because the schema it is dropping is already gone.** The damage is self-perpetuating for the remainder of the run and is not cleared by the next run starting. **One transient lock event converts into hundreds of downstream failures**, which is precisely the observed shape, and it is why run 2 and run 3 each began failing at their first suite.

**WHAT RUNS 1-3 HAD IN COMMON, AND WHAT RUN 4 REMOVED.** Every one of the first three was started while **another `npm run verify` was running on the same machine against the same two containers**, or within the pool's own `idleTimeoutMillis` (**30 s**, `src/db/pool.ts`) of one exiting -- so that run's server-side backends were still alive. Two suites interleaving `DROP SCHEMA public CASCADE` / `CREATE SCHEMA public` against one database is sufficient on its own: a pooled connection that predates the drop holds a **stale cached `search_path`**, which is the exact origin of the `no schema has been selected to create in` that opens each cascade. **Run 4 was started with no other suite running, no surviving backend, and the database reset to an empty `public`, and it passed 2057/2057.** The same `vc-c1-end-to-end.test.ts` that failed 9/10 inside run 3 passes **10/10 in isolation**, which is the same fact from the other side.

**THE SUITE IS THEREFORE GREEN ON THE FINAL TREE, AND THE FRAGILITY IS REAL AND UNFIXED.** Both statements are true together, and neither is allowed to hide the other.

**WHY THIS IS NOT ATTRIBUTABLE TO v1.3.6.** `src/` and `tests/` are **byte-identical to `1cf1816`**, proven by git tree hash rather than by inspection:

| Path | Tree hash at `1cf1816` | Tree hash in the frozen tree |
|---|---|---|
| `src` | `958866a766b9b813d7a68f3da0cd505dd684a487` | **identical** |
| `tests` | `147afe7d9e6c742b049e0f3cc81df561efaa3299` | **identical** |

**This pass changed no code, no test and no fixture, so no test behaviour can have changed.** Environmental factors observed on the freeze machine: 21 concurrent `node.exe` processes, and run 2 taking 2.5x run 1's wall-clock, both consistent with contention. `spikes/durable-execution/spike.test.ts` deliberately `KILL`s child processes mid-transaction and is the most likely source of the initiating lock event.

**WHAT THIS SECTION CLAIMS, AND WHAT IT REFUSES TO CLAIM.** It claims that **typecheck and lint pass on the final tree in all four runs**, that **no failure in any run is an assertion mismatch**, and that **run 4 reproduced the accepted baseline exactly — 147 / 2057 / 2057 / 0 / 0, exit 0 — on the final tree, and is the run this package cites.** **IT DOES NOT CLAIM THE SUITE IS ROBUST.** Three of four runs on this machine failed, none for a reason in this package, and **the figures above were obtained rather than expected**: reporting them without run 4 in hand would have been the precise failure mode `§2` exists to prevent, which is why the earlier issue of this section refused to report them and is retained here rather than quietly replaced.

**THE REQUIRED FOLLOW-UP, WHICH IS RUNTIME WORK AND IS DELIBERATELY NOT DONE HERE.** Make `down()` idempotent -- `DROP SCHEMA IF EXISTS public CASCADE`, with a re-create that cannot leave the database schema-less -- so that one transient deadlock cannot poison a run and every run after it. **That is a change to `src/`, which this architecture pass is forbidden to make.** It is recorded here and carried to the S1K runtime slice. **The green baseline this section previously demanded has since been obtained — run 4 — so the repository regression evidence for v1.3.6 is CLOSED; the idempotency defect it exposed in `down()` remains OPEN and is runtime work.**

**A change in the suite's result cannot be a consequence of this pass**, because this pass changed no code -- and it is the byte-identity proof above that carries that claim, never the suite's own outcome.

---

## 4. Package immutability

**`docs/architecture/v1.3.5/` is byte-identical after this pass**, and so are `v1.3.1` through `v1.3.4`. v1.3.6 is a new directory. Every prior errata and verification document is carried forward into it unmodified as history.

**The one file in `v1.3.6/` that is not carried forward or edited prose is `artifacts/acos-jcs-1.spec.v1.txt`** — a new, concrete, immutable byte artifact, which is the thing `S1K-C8` reported as missing.
