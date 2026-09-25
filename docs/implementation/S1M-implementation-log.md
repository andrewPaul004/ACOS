# S1M — Implementation log

**Branch `feature/s1m-postmark-sandbox`. Baseline `910b246`. Package issue `v1.3.6`,
unmodified.**

---

## 1. Baseline verification, before any edit

| Check | Result |
|---|---|
| `git rev-parse HEAD` | `910b246ce6ef16666024ffd4f78e5379a035b672` — exactly the required baseline |
| worktree | clean |
| architecture gate | **89 PASS / 0 FAIL** |
| architecture seeds | **58 run, 58 discriminate, 0 fail to discriminate** |
| `npm run verify` (final tree) | **exit 0** — 167 files, 2421 tests, 2421 passed, 0 failed, 0 skipped |

The gate and the seeds were run with `PYTHONUTF8=1`; without it the script fails on this host
with a `charmap` decode error on the corpus, which is an environment property of the shell's
default code page and not a finding about the corpus.

**A process incident, recorded rather than smoothed over.** The pre-edit full-suite run was
started before any edit, and its result is **not** reported: the harness captured none of its
output, and a second run was then started against the same PostgreSQL instance while the
first was still live. A liveness check used a POSIX `kill -0` against a Windows process id,
which reports success semantics that do not apply, so the first run was believed finished
when it was not. The two runs collided on the migration path — `no schema has been selected
to create in`, then `deadlock detected` — and both were discarded. Both databases were reset
and confirmed clean before anything else ran, and thereafter only one suite ran at a time.

The consequence for the record is in `S1M-result.md` §17: the baseline regression is
evidenced by the **final** run rather than by a separate pre-edit one. Since every S1M change
is additive, the 2361 accepted tests in the final run are the same 2361 tests, so the
detection strength is unchanged and only the attribution order is.

---

## 2. The reading pass, and where it stopped the slice

The mandate's `§1` requires reading the current requirements for the external-write
perimeter, the Effect Gateway, adapter selection, EM6, the outbox, CLAIMED semantics, the
correlation tag, the IRRECOVERABLE outcome policy, `PRESUMED_EXECUTED`, `VERIFIED`,
`NEVER_SENT`, `I20`, `I36`, `I8`, `I17f`, `VC-C3`, audit-plane vendor reads and the pre-live
gate — and then:

> "**If Postmark cannot satisfy a load-bearing current requirement: RETURN PARTIAL. Do not
> weaken the architecture.**"

Three findings came out of that pass. They are in `S1M-contract.md` §3 with citations. In
summary:

1. **no credential is present** in this environment (`§46`);
2. **there is no integration-plane runtime** and therefore no architecture-legal location for
   a provider token — `I25`, `48 §4` item 4, `23 §7`, `23 §11`, and `37 §2`'s assignment of
   `I24`/`I25` to **S2** and the adapters to **S3** (`§6`);
3. **Postmark publishes no read-only API credential**, so `36 §13`'s replica-read test cannot
   pass and `48 §2` row 13's read-only exemption is not satisfiable (`§7`).

The second is the one that would have survived a credential arriving in the environment, so
it is the one that decided the shape of the slice: **no adapter was written.** `§6` names the
shortcut it forbids — `process.env.POSTMARK_TOKEN` inside arbitrary adapter code — and the
honest reading is that the shortcut is not the variable, it is the in-process adapter that
would need one.

---

## 3. Provider documentation evidence — `§2`, `§47`

Read on **2026-09-25** from the provider's own published developer documentation. Recorded in
`tools/postmark-sandbox/capabilityRecord.ts` and, in prose, in
`docs/implementation/evidence/S1M-postmark-provider-evidence.md`. No sandbox account was
available, so every row's `basis` is `PUBLISHED_DOCUMENTATION` and **not one row is marked
`MEASURED_AGAINST_ACCOUNT`** — `36 §7` requires vendor properties to be measured rather than
trusted, and this slice measured nothing.

The findings that changed the design:

* **the sandbox proof exists.** A server carries a delivery type of `Live` or `Sandbox`,
  readable from the server endpoint under a server-level token, fixed at server creation and
  not changeable afterwards. `§35`'s requirement is therefore satisfiable — by a provider
  read, not by a variable named sandbox.
* **the query primitive exists, and it is keyed on metadata.** The outbound message search
  filters by a per-metadata-field parameter, one field per search, alongside a message-detail
  endpoint. This is what qualifies Postmark under `25 §7`.
* **there is no documented idempotency key.** `§14`: "Do NOT claim native idempotency if
  Postmark does not provide a documented idempotency key." The record declares
  `IDEMPOTENCY_HEADER: false`, which is the one EM6 row a careless reading would have got
  backwards.
* **the metadata limits are tight and the ACOS tag fits.** Field names at most twenty
  characters, values at most eighty, ten fields per message. `acos_correlation_tag` is
  **exactly twenty** characters and a minted ACOS tag is **forty-six** — asserted in
  `tests/postmark/capability-record.test.ts` against the real minter rather than against a
  description of it.
* **there is no read-only token.** The decisive one, and §2 finding 3 above.

---

## 4. The sandbox control-artifact release ceremony — `§4`

Performed in full, through the real offline tool, on 2026-09-25.

```
generate three Ed25519 key pairs OUTSIDE the repository (owner primary,
  owner second factor, audit signing) — none committed, none in the repo tree
stage the six class artifacts: five from artifacts/control/, class 24 generated
  from the sandbox audit signing key
build            -> candidate_id 789fc1d7935aed26b5f5909b538675d8a2c33e24175c2bcd8465108b02bf4d3e
review           -> the deterministic report, TEST ONLY banner present
approve-primary  -> key_id 9554f323a059f5b6ae6481d959910c1a164c021c702dc09eff9d2f55978ca5b8
approve-second   -> key_id f2a350a85dd94abaf01dc9ab199c390946e14eaa5fb77e081b1f94d004e7e9c4
                    manifest_id f13e2d773d906ff49f26c32ade432f7efa551b62cedab4fb29e1cacc33657f45
countersign      -> RELEASE COMPLETE, release_channel TEST_ONLY
verify           -> VERIFIED, fourteen signatures against externally supplied public keys
deploy           -> two separate package roots, one per plane
prelive gate     -> control verified true, audit verified true, identities equal,
                    READY_FOR_PROVIDER_SANDBOX_CONFIGURATION
```

The three public values are non-secret and are printed in `S1M-result.md`. **No private key
material is in this repository, in any document, or in any test fixture**, and the three
`.pk8` files live only in this session's scratch directory outside the repository tree.

**Why the channel says `TEST_ONLY`.** The accepted release input parser declares a closed
enum of two — `PRODUCTION` and `TEST_ONLY` — and refuses anything else with
`RELEASE_CHANNEL_UNDECLARED`. S1M did not add a third member. `§0` forbids modifying
architecture to make Postmark convenient and the same restraint applies to accepted tooling;
`§4` requires only that the keys "must not be labeled production", and `TEST_ONLY` is the
enum's truthful non-production member.

**`PRODUCTION OWNER CEREMONY: NOT PERFORMED.`**

---

## 5. What was built

### 5.1 `tools/postmark-sandbox/capabilityRecord.ts` — `§36`

A frozen, hand-authored transcription of the documentation evidence, carrying an
`ObservationBasis` per row so that a later slice holding an account changes a **discriminated
value** rather than a comment. It names no server, no account and no token, and the test
asserts the absence of each shape rather than the presence of a policy about them.

The EM6 vocabulary is transcribed **independently** of `src/kernel/gateway/adapterPort.ts`
rather than imported from it, and the agreement of the two transcriptions is asserted in a
test — the discipline `tests/release/release-boundaries.test.ts` already applies to `50 §6`'s
inventory. A record that took its vocabulary from the port it is evidence about would agree
with the port by construction.

### 5.2 `tools/postmark-sandbox/gate.ts` — `§37`, `§52`

Composes `evaluatePreliveReadiness` for `§37` rows 1 to 5 rather than re-deciding them, and
adds S1M's own rows:

| Row | Finding when unmet |
|---|---|
| the sandbox declaration | `PROVIDER_DELIVERY_TYPE_UNDECLARED` / `PROVIDER_DELIVERY_TYPE_NOT_SANDBOX` |
| refused configuration | `REFUSED_CONFIGURATION_PRESENT` |
| the two credential slots | `CONTROL_SEND_CREDENTIAL_ABSENT` / `AUDIT_READ_CREDENTIAL_ABSENT` |
| slot independence | `AUDIT_CREDENTIAL_NOT_INDEPENDENT` |
| EM6 qualification | `PROVIDER_EM6_UNQUALIFIED` |
| provider credential scoping | `AUDIT_PROVIDER_READ_CREDENTIAL_NOT_LEAST_PRIVILEGE` |
| the sole write entry | `COMMUNICATIONS_ADAPTER_ABSENT` |
| the open preconditions | three rows, each carrying its owning slice |

Two design choices are worth stating because they are not obvious:

**The refused-configuration list is a refusal, not a toggle.** `§45`: "Do not make
`allowLive=true` a casual configuration toggle." The toggle is not casual here because it
enables nothing — its **presence, at any value, is a finding**, and the test asserts that
`POSTMARK_ALLOW_LIVE=false` fails exactly as `true` does. The same treatment is applied to
`POSTMARK_API_BASE_URL`, which `§30` forbids reaching production at all.

**The open preconditions are DATA with slice attributions.** Holding them as a frozen list
means a later slice cannot become ready by accident: it has to delete a row, in a commit
somebody reads. The test asserts the gate is `NOT_READY` while any row stands and that the
attributions are exactly `S2` and `S3`, which is where `37 §2` puts them.

### 5.3 `tools/postmark-sandbox/cli.ts` — `§52`

`npm run verify:postmark-sandbox`. **There is no skip path.** No conditional branch, no
`it.skipIf`, no exit code meaning "inapplicable". A non-zero exit means the validation may not
run and the printed findings say why.

### 5.4 One defect the first real run of the command found

The first version printed nothing at all: it terminated with an uncaught
`NO_ACTIVE_VERIFIED_BUNDLE` stack trace before reaching any of its own code.

`adapterRegistry.ts` builds `EMPTY_ADAPTER_REGISTRY` at module evaluation; building one reads
the action catalogue; and `50 §3f` binds the catalogue to the **active verified bundle**. So
a *static* import of the registry raises at import time whenever nothing is active — which is
the default state of a fresh checkout, and precisely the state a readiness tool exists to
report on.

**That is the architecture behaving correctly**, so the tool accommodates it rather than
working around it: the registry is read through a deferred import placed after the pre-live
check, and the refusal becomes a finding with its own detail rather than an exception. The
closed-import test was widened in the same commit to capture **dynamic** specifiers as well
as static ones, because a closed-set check that counted only `from '…';` would have had a
hole exactly the shape of the one dependency that matters.

The tests did not catch this, and the reason is worth recording: inside vitest a verified
bundle is always active, so the static import resolved. **It was found by running the command
the mandate asked for**, which is the argument for `§52` requiring a real command rather than
only a test.

---

## 6. The tests

`tests/postmark/` — three files, all offline, none requiring a credential or a network.

* `capability-record.test.ts` — the EM6 vocabulary agreement, the nominated primitive, the
  observation-basis discipline, the absence of account-shaped material, and the **real minted
  ACOS correlation tag fitting the provider's documented metadata value limit**.
* `postmark-gate.test.ts` — every finding asserted individually, including the decisive one:
  **a fully configured environment is still `NOT_READY`, and the remaining findings are
  exactly the preconditions plus the provider's credential limitation.**
* `postmark-tooling-boundary.test.ts` — the new directory holds no transport, no origin, no
  authorization header and no retry construct; its imports are a closed list of five; and the
  ACCEPTED `src/` boundary is re-asserted unchanged.

`tests/negative-controls/unsafe-postmark-sandbox-gate.ts` holds the offline members of
`§53`'s fourteen. `S1M-test-matrix.md` §4 carries the seven that could not be built and says
what each one needs.

---

## 7. What was deliberately not done

* **no Postmark adapter**, for the reason in §2 finding 2.
* **no HTTP transport** (`§31`). A narrow production transport is the right design and it has
  nowhere to live until the integration plane does.
* **no widening of `no-real-transport-boundary.test.ts`** (`§48`). Nothing was built that
  needs the width, and widening a security test in a commit that does not need it is how a
  perimeter stops being one.
* **no webhook ingestion** (`§26`). The architecture's provider-query primitive is met by the
  message log, so the webhook stays documented-available and unbuilt.
* **no reconciliation code** (`§24`). `PRESUMED_EXECUTED → VERIFIED` and `→ NEVER_SENT` both
  require provider evidence by declaration (`25 §10.1`: "Provider resolution is declared here
  and built later [...] they belong with the slice that has a provider"). There is no provider.
* **no second provider** (`§49`).
* **no `allowLive` anywhere** (`§45`). The string appears only as a refused key name.
