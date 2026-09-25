# S1M — Result

**Postmark sandbox adapter and real-provider duplicate-send validation.**
**Baseline `910b246`. Branch `feature/s1m-postmark-sandbox`. Package issue `v1.3.6`,
unmodified.**

---

## 1. Verdict

# PARTIAL

**`PARTIAL — EXTERNAL VALIDATION BLOCKED ON POSTMARK SANDBOX CREDENTIALS AND ON THE ABSENT
INTEGRATION-PLANE CREDENTIAL BOUNDARY.`**

Three independent blockers, each normative, each reached by reading the frozen architecture
rather than by finding the work inconvenient:

| # | Blocker | Mandate branch | Would a credential fix it? |
|---|---|---|---|
| A | no Postmark sandbox credential exists in this environment | `§46` | — |
| B | no integration-plane runtime, so there is no architecture-legal place for a provider token (`I25`, `48 §4` item 4, `23 §7`, `23 §11`; `37 §2` puts `I24`/`I25` at **S2** and the adapters at **S3**) | `§6` | **NO** |
| C | Postmark publishes no read-only API credential, so `36 §13`'s replica-read test is unsatisfiable and `48 §2` row 13's read-only exemption is not earned | `§7` | **NO** |

**B is the one that decided the shape of the slice.** It survives a credential arriving, and
the shortcut `§6` forbids is not the variable name — it is the in-process adapter that would
need one. `effectGateway.ts` invokes `adapter.dispatch(envelope)` as a local call, so any
adapter holding a Postmark token holds it inside the control-plane process, which `48 §4`
item 4 says "fails the build twice".

**No adapter was written. No Postmark API call was made. No provider-side number of any kind
appears in this slice.**

## 2. Baseline

| | |
|---|---|
| required | `910b246` |
| actual | `910b246ce6ef16666024ffd4f78e5379a035b672` |
| branch | `feature/s1m-postmark-sandbox` |
| final commit | the tip of `feature/s1m-postmark-sandbox` — a commit cannot carry its own hash, and no follow-up commit was made merely to record one |
| clean | yes, before and after |
| `git diff 910b246 -- docs/architecture/` | **empty** |

## 3. Provider

| | |
|---|---|
| provider | Postmark |
| environment | Sandbox Server — **required, never configured, never contacted** |
| sandbox proof | **mechanism identified and NOT exercised.** `GET /server` returns `DeliveryType ∈ {Live, Sandbox}` under a server-level token; the type is fixed at server creation and cannot be changed afterwards |
| docs evidence date | **2026-09-25**, published developer documentation only |
| account evidence | **NONE.** Every capability row carries `basis: PUBLISHED_DOCUMENTATION`; not one is `MEASURED_AGAINST_ACCOUNT` |
| live server possible through this adapter? | **NO — there is no adapter.** And the S1M gate refuses `POSTMARK_ALLOW_LIVE`, `POSTMARK_LIVE_SERVER_TOKEN` and `POSTMARK_ACCOUNT_TOKEN` at any value, and refuses any declared delivery type but `Sandbox` |

## 4. Sandbox Release

**`SANDBOX RELEASE CEREMONY: PERFORMED.`**

Performed in full on 2026-09-25 through the real `tools/control-release/` CLI, under **three
freshly generated Ed25519 key pairs held outside the repository** — not the S1K test seeds,
and not committed anywhere.

| | |
|---|---|
| ceremony performed | **YES** — build, review, approve-primary, approve-second, countersign, offline verify |
| sandbox primary root (public) | `25942dc6bc2aa8b89c57eb700e6508401f837783bd78e6da83d358da53c51385` |
| sandbox second-factor root (public) | `284d391dfacd3e8856d635c3615ede93b98d60d6f9cec831ef1471b7f752458b` |
| primary `key_id` | `9554f323a059f5b6ae6481d959910c1a164c021c702dc09eff9d2f55978ca5b8` |
| second-factor `key_id` | `f2a350a85dd94abaf01dc9ab199c390946e14eaa5fb77e081b1f94d004e7e9c4` |
| candidate identity (review only) | `789fc1d7935aed26b5f5909b538675d8a2c33e24175c2bcd8465108b02bf4d3e` |
| **active manifest** | `f13e2d773d906ff49f26c32ade432f7efa551b62cedab4fb29e1cacc33657f45` |
| entries | 6 — classes 2, 3, 19, 20, 24, 27 |
| offline verify | **VERIFIED**, fourteen signatures against externally supplied public keys |
| control READY | **YES**, on `f13e2d77…`, through its own trust boundary |
| audit READY | **YES**, on `f13e2d77…`, through its own separately authored verifier |
| pre-live gate | `READY_FOR_PROVIDER_SANDBOX_CONFIGURATION` |
| release channel | **`TEST_ONLY`** — see the note below |
| production ceremony performed? | **NO** |

**Every value above is public.** No private key material is in this repository, in any
document, or in any fixture; the three `.pk8` files exist only in a scratch directory outside
the repository tree.

**The channel note.** `tools/control-release/candidate.ts` declares a closed channel enum of
exactly two members, `PRODUCTION` and `TEST_ONLY`, and refuses anything else. S1M did not add
a third: `§0` forbids modifying architecture for Postmark's convenience and the same restraint
applies to accepted tooling. `§4` requires the keys "must not be labeled production", and
`TEST_ONLY` is the enum's truthful non-production member.

**`PRODUCTION OWNER CEREMONY: NOT PERFORMED.` `PRODUCTION RELEASE CEREMONY: NOT PERFORMED.`
`PRODUCTION RELEASE DEPLOYED: NO.`** No production owner key was created, held or used.

## 5. Adapter

| | |
|---|---|
| sole write entry | **none exists.** `EMPTY_ADAPTER_REGISTRY.registeredIds` is `[]`, so `resolveAdapterFor` refuses every effect; exactly one production file calls `.dispatch(`, and it is `src/kernel/gateway/effectGateway.ts` |
| HTTP/client | **none.** No `fetch`, no `node:http`/`https`, no socket, no vendor SDK, and no new dependency of any kind |
| automatic retries | **none, and nothing exists to disable.** `tests/postmark/postmark-tooling-boundary.test.ts` asserts no retry construct in the S1M tooling; `I36` admits no second dispatch of a `CLAIMED` row by any path |
| timeout | not applicable — no transport |
| API origin | **absent.** `api.postmarkapp.com` appears nowhere in `tools/postmark-sandbox/`, and no `URL` is constructed there. A configuration-supplied origin is a REFUSAL (`§30`) |
| credential source | **none consumed.** The gate reads credential PRESENCE and never a value |
| credential leakage | none — see §16 |

## 6. EM6 Qualification

All rows are **documentation**, not measurement.

| Capability | Evidence | Qualifies? |
|---|---|---|
| provider query | outbound message search filterable on one metadata field per search, plus a message-detail endpoint; up to 10,000 per search, 500 per request | **YES — this is the qualifying primitive** |
| metadata correlation | metadata object, ≤10 fields, names ≤20 chars, values ≤80 chars, returned in API and webhooks, searchable | **YES** |
| provider `MessageID` | returned on send | YES, **as evidence only** |
| event / delivery data | webhooks fire, including on sandbox servers | available, **not implemented** (`§26`) |
| sandbox status | `DeliveryType` on the server record, immutable after creation | **YES** |
| native idempotency | **none documented** | **NO — and not required.** `25 §7`'s disqualifier is a disjunction, and ACOS supplies the fourth layer itself: the outbox claim |
| audit read credential | no read-only API scope exists | **NO** — blocker C |

**The primitive that qualifies Postmark is `QUERYABLE_MESSAGE_LOG`**, declared as a single
field in `tools/postmark-sandbox/capabilityRecord.ts` rather than in prose.

## 7. Correlation

| | |
|---|---|
| ACOS tag | `acos-corr-<uuid4>` — **46 characters**, minted once at enqueue, immutable across the claim by schema |
| Postmark metadata | key `acos_correlation_tag` — **exactly 20 characters**, the documented maximum for a field name; the tag fits the documented 80-character value limit |
| mapping implemented? | **NO.** There is no adapter to place it |
| provider query | **not exercised** |
| webhook | **not used** (`§26`) |

`tests/postmark/capability-record.test.ts` asserts the fit against the **real**
`mintCorrelationTag()`, not against a description of it. The `§10` prohibition is already
structural: the adapter may not mint a tag, and cannot — the enqueue API has no parameter for
one and the schema refuses any UPDATE that moves the value.

## 8. Credential Independence

| | |
|---|---|
| control credential | **not configured, not consumed.** Slot `ACOS_POSTMARK_SANDBOX_SERVER_TOKEN` |
| audit credential | **not configured, not consumed.** Slot `ACOS_AUDIT_POSTMARK_SANDBOX_SERVER_TOKEN` |
| same credential? | the gate refuses equality, and `tests/postmark/postmark-gate.test.ts` proves it |
| permissions | **a Postmark server token grants sending, sent-message inspection and the bounce API as ONE UNDIVIDED CAPABILITY.** Up to three tokens per server, each with the same power. Read-only exists only as a web-interface user role carrying no API token |
| architecture status | **NOT SATISFIED.** `48 §2` row 13's exemption rests on "Reads only"; `48 §3.6` requires "read-only, separately provisioned, and attempted-write-tested"; `36 §13` says "attempt a write against each and assert vendor-side failure". A second Postmark token **passes** that write. `48 §3.6`'s Google Ads precedent does not transfer — a viewer-level Ads login still yields an API credential that fails a write, and Postmark's viewer role yields no API credential at all |

**This is a vendor-selection finding under `25 §7`'s own logic**, not an engineering gap, and
it is the one an owner may want to act on before further Postmark work.

## 9. Six Kill Points

| Kill Point | Provider baseline | Provider delta | Local state | Recovery dispatch count |
|---|---:|---:|---|---:|
| KP1 before claim commit | **NOT RUN** | **NOT RUN** | **NOT RUN** | **NOT RUN** |
| KP2 after claim, before HTTP leaves | **NOT RUN** | **NOT RUN** | **NOT RUN** | **NOT RUN** |
| KP3 after HTTP leaves, before response known | **NOT RUN** | **NOT RUN** | **NOT RUN** | **NOT RUN** |
| KP4 after response, before outcome commit | **NOT RUN** | **NOT RUN** | **NOT RUN** | **NOT RUN** |
| KP5 after outcome commit | **NOT RUN** | **NOT RUN** | **NOT RUN** | **NOT RUN** |
| KP6 workflow recovery / re-entry | **NOT RUN** | **NOT RUN** | **NOT RUN** | **NOT RUN** |

**No provider data exists, so no row is filled.** `§46`: "Do not fake the six-point provider
evidence."

All six ARE exercised against the **mock** by the ACCEPTED
`tests/integration/gateway/mock-kill-matrix.test.ts`, unchanged by this slice, and `37 §2`
states exactly what that proves: it "proves the ACOS-side state machine and **proves nothing
about a vendor**".

## 10. Vulnerable Real Duplicate Control

| | |
|---|---|
| unsafe provider delta | **NOT RUN** |
| production provider delta | **NOT RUN** |
| discriminates | **NOT DEMONSTRATED AT A PROVIDER** |

`§41`'s control is the strongest discrimination for `I36` and it is the furthest out of reach.
**No local substitute was invented for it.** The mock-level ancestors
(`unsafe-reclaimable-outbox.ts`, `unsafe-dispatch-claimed.ts`) are the ACCEPTED S1I/S1J
controls and S1M adds nothing to them.

## 11. Outcome Mapping

**Specified from documentation, implemented nowhere.** Recorded in
`docs/implementation/evidence/S1M-postmark-provider-evidence.md` §6 so the next slice does not
have to re-derive it. The governing rule is `25 §7.2`: "**Anything for which the request MAY
have escaped is `OUTCOME_UNKNOWN`.**"

| Provider / transport observation | ACOS adapter outcome |
|---|---|
| failure raised before the request is opened or sent | `NOT_SENT_CONFIRMED` (`PRE_SEND_FAILURE`) |
| DNS failure, connection refused, TLS handshake failure — **before any request byte is written** | `NOT_SENT_CONFIRMED` (`PRE_SEND_FAILURE`) |
| timeout **after any request byte is written** | `OUTCOME_UNKNOWN` (`TIMEOUT`) |
| socket closed after the request was sent | `OUTCOME_UNKNOWN` (`AMBIGUOUS`) |
| `500` / `503` after receipt | `OUTCOME_UNKNOWN` (`AMBIGUOUS`) |
| `429` rate limited | `OUTCOME_UNKNOWN` (`AMBIGUOUS`) — **no documented non-mutation guarantee**, so `§34`'s conservative branch |
| `422` field validation | `OUTCOME_UNKNOWN` until a future slice **measures** a non-mutation guarantee; `NOT_SENT_BASES`' second member requires a *declared* contract and none was found |
| `200` | `ADAPTER_RETURNED` — and still not evidence the world changed (`25 §5`) |

**`§22` answered:** the only Postmark failures that qualify as trusted proof that no request
crossed are those failing **before any request byte is written**.

## 12. Unknown Outcome

| | |
|---|---|
| real injected case | **NONE.** No request was ever made |
| local state | not reached |
| MIE | not moved |
| redispatch | **structurally impossible** — `I36`'s state machine has no transition out of `CLAIMED`, which is the ACCEPTED S1I enforcement leg and is unchanged |
| provider query result | **NOT RUN** |
| reconciliation | **NOT IMPLEMENTED.** `25 §10.1`: "Provider resolution is declared here and built later [...] they belong with the slice that has a provider" |

## 13. I36

| Leg | Status |
|---|---|
| DB enforcement | **CLOSED and unchanged** — the `ENQUEUED → CLAIMED` state-machine constraint, ACCEPTED at S1I |
| mock composition | **CLOSED and unchanged** — the six kill points against the deterministic mock, ACCEPTED at S1J |
| real-provider six-point validation | **OPEN.** Not attempted, not partially attempted, not approximated |
| final exact status | **`I36` — ENFORCEMENT leg S1, CLOSED. VERIFICATION leg S4, OPEN.** Exactly the registry's own wording, unchanged by this slice |

**No claim of "external exactly-once" is made.** `§43`: "At-most-once dispatch plus provider
evidence is narrower than universal distributed exactly-once" — and S1M has neither half of
that narrower claim, because it has no provider evidence.

## 14. I20 / I8

**`I20` — OPEN, exactly as the registry states.** "The ACOS-side denominator is structurally
implemented at S1 (v1.3.5); the provider comparison is OPEN." S1M produces no
provider-reported accepted count and therefore moves nothing. `§28`'s warning is honoured
literally: no leg is claimed, because no leg was proved.

**`I8` — OPEN, and for Postmark now known to be blocked rather than merely unproved.** No
audit read credential exists, no sweep ran, and §8 above shows that the credential
`36 §13` requires **cannot be obtained from Postmark**. `§44`'s caution — "Do not claim full
`I8` merely because an audit Postmark token exists" — is met with more than compliance: no
such token exists, and one would not satisfy `I8`'s stated verification if it did.

## 15. Audit Oracle

| | |
|---|---|
| provider call independent? | **NOT EXERCISED.** The gate performs no provider call from either plane |
| control evidence reused? | **NO.** The gate composes `evaluatePreliveReadiness`, which runs each plane's own bootstrap through that plane's own trust boundary and compares two independently obtained manifest identities |
| accepted-count source | **NONE.** No count was produced from any source, and no local quantity was substituted for one |
| query delay behavior | **NOT EXERCISED.** `§42`'s bounded observation window cannot be chosen without measuring the provider's visibility latency, and `§42` forbids translating observation delay into another send |

## 16. Credential Safety

| | |
|---|---|
| repo secret | **none.** No token, no key, no `.env`. The three sandbox `.pk8` files live outside the repository tree |
| DB secret | none — no provider credential reaches any row |
| journal secret | none |
| logs | the gate reports credential PRESENCE as a word; `tests/postmark/postmark-gate.test.ts` seeds real-looking values and asserts neither the value nor any digest appears in the rendered report or the returned object |
| worker surface | unchanged — no model or worker surface was touched |
| discriminating control | the unsafe renderer DOES print the token; production does not |

## 17. Architecture / Regression

| | |
|---|---|
| `git diff 910b246 -- docs/architecture/` | **empty** — v1.3.6 unchanged |
| architecture gate | **89 PASS / 0 FAIL** |
| architecture seeds | **58 run, 58 discriminate, 0 fail to discriminate** |
| `tsc --noEmit` | **green** |
| `eslint . --max-warnings 0` | **green** |
| focused S1M tests | **3 files, 60 tests, 60 passed, 0 failed, 0 skipped** |
| provider verify command | `npm run verify:postmark-sandbox` — **exit 1, `NOT_READY`.** This is the honest result, not a command failure |
| **`npm run verify`** | **exit 0** |
| test files | **167** (accepted baseline 164; **+3**) |
| tests | **2421** (accepted baseline 2361; **+60**) |
| passed | **2421** |
| failed | **0** |
| skipped | **0** |
| duration | 7292 s, one process, no other suite running |

Run on the final tree, one process only, after both databases were reset and confirmed clean.
The host was heavily loaded by unrelated processes throughout, which accounts for the
duration and for nothing else: **every one of the 164 accepted test files passed, and the
three S1M files added exactly 60 tests, all passing.**

**How the baseline was confirmed, stated exactly.** `910b246` and a clean worktree were
confirmed before any edit, and the architecture gate (89/0) and all 58 seeds were run and
captured at that point. The pre-edit full-suite run was **started** before any edit and its
result is **not** reported here, for two reasons recorded rather than smoothed over: the
harness captured none of its output, and a second run was started against the same PostgreSQL
instance while the first was still live — a liveness check of mine used a POSIX `kill -0`
against a Windows process id, which reported the first run as finished when it was not. The
two runs collided on the migration path and both were discarded; the databases were reset and
verified clean.

**The baseline regression is therefore evidenced by the FINAL run**, which is equivalent in
strength here: every S1M change is additive — new files plus one `package.json` script line —
so the 2361 accepted tests in the final run are the same 2361 tests, and a pre-existing
failure would appear there. It is not equivalent in *attribution*, and that is the part being
disclosed.

**No test is skipped**, and no skipped test stands in for an unmet acceptance requirement
(`§51`). What could not be run is **absent and enumerated** in `S1M-test-matrix.md` §4.

## 17a. Evidence artifacts

| File | What it holds |
|---|---|
| `docs/implementation/evidence/S1M-postmark-provider-evidence.md` | the dated provider documentation record, the outcome-mapping table, the credential-scoping finding, and the nine things a future slice must **measure** rather than read |
| `docs/implementation/evidence/S1M-gate-runs.md` | both runs of `npm run verify:postmark-sandbox` in full, and the sandbox release's public identity |

**Neither contains a secret, a recipient, an account identifier or a server identifier.**
There is no provider response to sanitize, because no request was made.

**One defect was found by running the command rather than by a test.** The first version of
`verify:postmark-sandbox` terminated with an uncaught `NO_ACTIVE_VERIFIED_BUNDLE` stack trace
before printing anything: `adapterRegistry.ts` builds its registry at module evaluation, that
read is bound to the active verified bundle by `50 §3f`, and a static import therefore raises
on a fresh checkout — the exact state a readiness tool exists to report on. Inside vitest a
bundle is always active, so no test saw it. The registry is now read through a deferred
import after the pre-live check, the refusal is a finding rather than an exception, and the
closed-import test counts dynamic specifiers as well as static ones.

## 18. Scope

| | |
|---|---|
| Postmark Live | **NO** — and no adapter exists through which one could be reached |
| customer recipient | **NO** — no recipient value exists anywhere in this slice |
| production owner ceremony | **NO** |
| other provider | **NO** — no dependency added, and the test asserts the dependency set is unchanged |
| reconciliation beyond bounded sandbox need | **NO** — none built |
| architecture modified | **NO** |
| accepted boundary tests weakened | **NO** — `no-real-transport-boundary.test.ts` is byte-unchanged |

## 19. Remaining Obligations

**Introduced or sharpened by S1M:**

1. **the integration-plane runtime and the per-adapter credential boundary** — `I24`, `I25`,
   `23 §7`, `23 §11`. **S2/S3.** The blocker that gates every real-provider slice, not only
   this one;
2. **Postmark's audit-credential limitation** — a vendor-selection decision for the owner:
   accept an audit plane holding a send-capable credential and restate `48 §2` row 13's
   exemption accordingly, or select a communications provider that publishes a read-only
   credential;
3. **the acceptance-oracle definition** — `§16`'s interpretation is recorded and must be
   measured, not read;
4. **the seven `§53` controls** that need a provider, including `§41`'s real duplicate-send
   control.

**Carried forward unchanged from S1L:**

5. production owner ceremony and production key custody;
6. production provider enablement;
7. provider-generic reconciliation — `VERIFIED`, `NEVER_SENT`, the effect reconciler;
8. **`I20`** — provider comparison OPEN;
9. **`I8`** — OPEN, and see item 2;
10. **`I17b`** — external anchoring, S3;
11. **residual 12** — the 22 older C/E conditions without discriminating seeds; S1M worked on
    none of them and touched no condition among the 22;
12. **the remaining S4 signed classes** — the extension of the signed set beyond the pre-live
    six;
13. **class-19 key migration** onto the same externally provisioned roots (`50 §3i`);
14. the control incident table;
15. the AI CEO and the worker surfaces.

## 20. Recommended Next Slice

**S1N — the integration-plane runtime and the per-adapter credential boundary (`I24`, `I25`).**
