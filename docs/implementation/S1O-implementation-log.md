# S1O — implementation log

What was built, in the order it was built, and what went wrong on the way. **The failures are
recorded because a log that only records successes is a log nobody can learn from.**

---

## 1. Baseline

| | |
|---|---|
| required | `e9ec232` |
| actual | `e9ec2326a2debe215e69a582d45046f47c7bf41a` |
| clean worktree before edits | yes |
| architecture gate at baseline | `89 PASS / 0 FAIL` |
| seeds at baseline | **58 / 58 discriminate**, each verified individually |
| branch created | `feature/s1o-provider-selection-audit-boundary` |

**The baseline `npm run verify` cost three attempts and the reason matters.**

1. **The first run was contaminated by me.** It was started before edits and I began editing
   `src/` while it ran. Vitest loads modules lazily, so the run was no longer measuring the
   baseline. It was stopped and discarded rather than reported.
2. **The second run failed on the environment, not the code.** `npm run verify` under the
   Bash tool reported `'"node"' is not recognized` — the shell the tool provides does not put
   this machine's nvm4w node on the PATH that `npm run`'s child sees. Every subsequent `npm`
   invocation in this slice went through PowerShell.
3. **The third run hit real infrastructure failure.** `Connection terminated due to connection
   timeout`, repeatedly, on the Postgres-backed authority tests. Diagnosis: the workstation
   was at **100% CPU with ~0.6 GB free of 31.5 GB**, saturated by the operator's own
   applications. The containers themselves were healthy (4.7% CPU, 68 MB each) and a
   162-test subset passed in 79 s. **This was reported to the owner rather than retried
   silently or worked around**, because a green run obtained by disabling something is not a
   green run.

---

## 2. Order of work

1. **The architecture package.** `docs/architecture/v1.3.7/` copied from v1.3.6, then four
   deliverables edited: `50` (new `§2g`, row 5, `§2f`, `§6`), `34` (ADR-024), `48` (row 13,
   `§3.5/§3.6`), `37` (`§2` gate item, SEQ-04).
2. **The gate.** Twelve L conditions and twelve seeds spliced into `consistency-v1.3.py`.
3. **The credential-risk module, the parser, and class 5 through the trust chain.**
4. **The adapter-runtime registry**, rebased off the action catalogue.
5. **The audit provider-read plane**, from identity through protocol to the forked runtime.
6. **The provider capability record and the selection rule.**
7. **The tests**, including the twelve vulnerable controls.
8. **The perimeter scan extension.**

---

## 3. Five things that did not work the first time

### 3.1 K14 broke, and the fix had to not weaken it

Adding class 5 to `50 §6` made **K14** fail: it asserted the inventory had exactly FOUR live
rows and read the heading *"…after v1.3.6"*.

The tempting fix is to drop the count and assert membership. **That would have weakened the
condition**, because a row that quietly lost its second signature would then pass. The count
is now **five**, still asserted as an equality, and `--seed-second-signature-optional` still
fails it. Recorded in `phase2-v1.3.7-verification.md §3` rather than done quietly.

### 3.2 `50 §2g` field 2 had no value an audit credential could carry

Field 2 was written as *"an adapter identifier the class-3 catalogue names"*, and the
audit-plane read credential has no adapter — it is scoped to a provider. The first artifact
draft could not express it, which would have left `48 §3.6`'s operand outside the signed
boundary again: **the exact defect `S1N-C1` is about**.

Resolved by the reserved `audit_plane` sentinel, on the pattern `50 §2a` field 9 already uses
for `internal_only`. Recorded as `S1O-C2`.

### 3.3 The audit registry read the CONTROL plane's bundle, and an accepted test caught it

`createAuditReaderRegistry` was first written to take a `VerifiedControlArtifactBundle`. It
typechecked, it worked, and **`tests/controlArtifacts/audit-plane.test.ts` failed**:

> *"no module under `src/audit/` imports the control plane's trust chain"*

That assertion is right and the code was wrong. An audit reader admitted on the CONTROL
plane's reading of the record that says its credential is read-only is an audit plane
trusting the plane it audits for its own independence — `30 §5.4`'s argument one level up.

Rebased: `auditPlaneVerifier.ts` now verifies class 5 from the audit plane's own copy through
its own deployment variables and keeps **only `audit_plane`-scoped records**, and the registry
takes that map. The second placement is stronger than the check it replaced: **the audit plane
never learns a send credential's identity at all.** Recorded as `S1O-C3`.

### 3.4 Two accepted release tests used a literal index that encoded the inventory's length

`deployment-dry-run.test.ts` spliced a class-17 entry at `entries[2]` to test `50 §3e`'s
deployment pin — a position that was "between class 3 and class 19" when it was written.
Class 5 moved it, and both cases started failing on `MANIFEST_ENTRY_ORDER_INVALID` instead:
**they stopped testing the pin and nobody would have noticed from the pass/fail line alone.**

The index is now derived from the classes actually present. This is the failure mode a
hard-coded position always has, and it is worth the paragraph.

### 3.5 The leak matrix asserted something meaningless about the platform environment

The sibling-isolation case looped over the audit child's environment keys asserting the send
child did not contain `key.replace('AUDIT','X')` — which is nonsense, and it failed on
`HOMEDRIVE`. Both children legitimately share the Win32 variables libuv injects regardless of
the `env` option.

Replaced with the assertion that actually matters: **the two children share no `ACOS_` key at
all**, in both directions, plus the decisive named pair.

---

## 4. What the deployed class-5 artifact demonstrates

`artifacts/control/class-05.credential-scopes.json` declares six synthetic credentials. Two
exist to answer the mandate directly:

* **`synthetic_esp.mixed_send`** — `§8`'s required attack: `mail.send` beside
  `payment.refund`, on one credential, `MONEY_MOVING`.
* **`mock_ads.pause_only` and `mock_ads.budget_manage`** — one adapter, two credentials, two
  answers.

The second pair is the one worth reading twice. `campaign.budget.set` declares
`carries_vendor_monetary_field: false` in the deployed action catalogue, so **S1N's derivation
called every `mock_ads` credential `NON_MONETARY`**. v1.3.7 asks what the credential reaches
at the provider; `budget_manage` reaches the budget raise, which is `§2g` clause 9. **Same
adapter, same action catalogue, different answer** — on the repository's own bytes, not on a
constructed input.

---

## 5. The perimeter scan gained a kind, and it was not cosmetic

`48 §2` row 13 is `EXEMPT (read-only; §3.6)`, and the first instinct is that an exempt path
needs no enumeration. `48 §3` says the opposite: *"An exemption is not a hole. It is a
**named, annotated, reviewed** hole, and the difference is that a reviewer can find it."*

So `PROVIDER_READ_CLIENT` was added as a separate kind with a separate declaration pattern —
`readFromProvider*`, never widened from `sendToProvider*`, because a scanner that reported a
read as a write would let a send site inherit a read's exemption by being renamed. Both audit
read sites are now enumerated, annotated `PERIMETER_EXEMPT(audit_plane_read_only, 48-3-6)`,
and gated the same way a write site is.

**One detail cost a cycle:** the exemption ticket was first written `48-3.6`, and the
accepted annotation grammar admits no `.` in a ticket. It is `48-3-6`.

---

## 6. What was NOT done, and why each was a choice

| Not done | Why |
|---|---|
| Closing credential scope drift | the binding proves WHICH credential, never WHAT it can still do. Empirical, and owed |
| Any v1.3.8 | v1.3.7 was not owner-accepted, so the correction is made in place |
| Option B, the execution proxy | `§10`: S1O makes the trigger objectively executable and nothing more |
| Any provider request | `§27`, and the record is documentation evidence by type |
| S1M's six-kill-point test | `§0`: explicitly not resumed |
| A cloud secret manager | `§9` of the S1N mandate still forbids selecting one |
| Widening class 3 | `S1O-C1`: `50 §2f`'s one-field-one-class rule, and `§8`'s own attack |
| Discharging class 5's signature | no production signing code exists |
| Reporting a green verify obtained by relaxing anything | the environment blocker was surfaced instead |

---

## 7. The owner correction, and what the slice had not thought to ask

**Two findings came back. The second is the one worth writing down.**

### The sandbox record was wrong, and the shape of the error matters

The Sandbox Mode page was read for what it says about DELIVERY — *"the email will never be
delivered"* — and the same page's sentence about EVENTS was not carried forward. The record
then said `producesQueryableActivity: null` and filed the question as
`CAPABILITY DOCUMENTED — ACCOUNT VALIDATION PENDING`.

**That is worse than recording it wrong.** A pending item is a promise that somebody can close
it; this one could never have been closed, because the answer was already published. And it
propagated: the readiness token named a sandbox environment, and the selection rule had no way
to notice that the mode making the request safe is the mode removing the evidence.

**The fix was not just the row.** Five independent capability checks admitted a provider on
"has a sandbox" plus "has an activity API", so `evidencePathIncompatibility` now requires ONE
declared path to carry the whole chain end to end.

### The binding defect: a check that was never written because the question was never asked

`S1N-C1` was about the DEFINITION of a money-moving credential, and the slice answered it
carefully: a closed domain, a signed owner, a consistency rule, a fail-closed absence, a
registry that refuses. **Every one of those is about a RECORD.**

Nothing in the slice asked which credential the record is about. Field 1 was *"a credential
identifier, unique within the artifact"* — enough to key a map, and a map key is not a binding.
So:

```
signed class-5 record  ->  risk class  ->  admitted
secret locator         ->  material    ->  presented
```

and the two never met. The attack needs no forgery: repoint a locator, and a
`NON_MONETARY_WRITE` declaration governs `MONEY_MOVING` material while every existing check
passes.

**The audit side is worse**, because its declaration is the operand of an exemption: a
genuinely `READ_ONLY`, genuinely `audit_plane`-scoped record, a locator genuinely disjoint from
the send side's — and a send-capable token in the reader's hand.

**What made it invisible to the suite.** The registry tests proved the signed chain. The
perimeter tests proved the material chain. **Neither had a reason to compare them**, and a test
matrix organised by mandate section had no row for a question the mandate did not raise.

### The one that was tempting and wrong

The obvious rebuttal is that the locator check already covers it: the audit reader is refused
if its locator is one the integration plane holds. **It does not cover it**, and stating why
took a section of `50 §2g` rather than a sentence: two locators may resolve one credential, and
one locator may be repointed at another. A locator says where to look; an identity says what
was found. `unsafeLocatorInequalityProvesSeparation` exists so that argument has a control that
fails, rather than a paragraph that asserts.

### And the line that was drawn deliberately

**Identity binding does not close scope drift**, and the correction says so in three
deliverables rather than letting the binding look like more than it is. Proving *"this is
credential A"* says nothing about whether A still holds the permissions the owner signed for
it — a scoped provider key is mutable at the provider, with no ACOS-observable event. `36 §13`
stays owed, and so do the other three probes beside it.
