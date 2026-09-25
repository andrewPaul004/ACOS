# S1M — Test matrix

**Branch `feature/s1m-postmark-sandbox`. Baseline `910b246`. Package issue `v1.3.6`,
unmodified.**

Every row names the mandate section it discharges and the file that discharges it. Rows marked
**VC** are members of `§53`'s fourteen vulnerable controls; each is a real branch that ACCEPTS
what production REFUSES, run against the same input.

> **§4 of this matrix is the important part.** It lists what S1M could NOT test, and why. A
> test matrix that lists only what passed is the shape `§51` forbids: "No skipped test may
> silently represent an unmet acceptance requirement."

---

## 1. The provider capability record — `tests/postmark/capability-record.test.ts`

| § | Property |
|---|---|
| §14 | the record's EM6 primitives are exactly `25 §7`'s three, in `adapterPort.ts`'s own order — two independent transcriptions asserted to agree |
| §14 | the record answers every primitive and none outside the closed set |
| §14 | it nominates a qualifying primitive that it also declares PRESENT, and `em6Qualifies` accepts it |
| §14 | the nominated primitive is `QUERYABLE_MESSAGE_LOG`, and `IDEMPOTENCY_HEADER` is **false** |
| §14 **VC** | a record claiming native idempotency still "qualifies" — the discrimination is on the FIELD, because `25 §7`'s downgrade rule keys on the field and not on the verdict |
| §14 | a record nominating a primitive it declares ABSENT does not qualify |
| §36, §47 | **no row claims `MEASURED_AGAINST_ACCOUNT`**, because no account existed; the other basis exists so a later slice has somewhere to put a measurement |
| §47 | every row names a published reference and the record carries a retrieval date |
| §36, §40 | the record contains no server id, no account id, no token-shaped value, no UUID and no `@` |
| §36 | the record and its nested objects are frozen |
| §10 | the declared metadata key is within the provider's documented 20-character name limit, and is the closed `acos_correlation_tag` |
| §10 | **a REAL minted ACOS correlation tag is 46 characters and fits the documented 80-character value limit** — asserted against `mintCorrelationTag()`, not against a description |
| §10 | the provider field is searchable and returned in webhooks, which is what makes it the EM6 query primitive |
| §7 | the record states that **no read-only API credential exists** |
| §7 **VC** | the unsafe record calls a second send-capable token read-only; production does not |

## 2. The S1M readiness gate — `tests/postmark/postmark-gate.test.ts`

| § | Property |
|---|---|
| §52 | an empty environment is `NOT_READY`, and never a skip |
| §52 | the status union has exactly two members; `SKIPPED`, `INAPPLICABLE`, `NOT_APPLICABLE` and `PRODUCTION_READY` appear nowhere in the report |
| §52 | **the CLI exits non-zero**, so a CI job cannot mistake a refusal for a pass |
| §46 | the report names the slots an operator must provide, and names no value |
| §3 **VC 1** | an UNDECLARED delivery type is a refusal, not a default |
| §3 **VC 1** | a delivery type declared `Live` is refused |
| §3, §35 | only the exact value clears the row — `sandbox`, `SANDBOX`, `Sandbox `, `Sandbox,Live` and `LiveSandbox` are each refused |
| §30 **VC 3** | each refused configuration key is a finding on its own |
| §30 **VC 3** | a caller-supplied API origin is REFUSED rather than honoured, and does not appear in the report |
| §45 | a live toggle enables nothing — `POSTMARK_ALLOW_LIVE=false` fails exactly as `true` does |
| §7 | both credential slots absent is two findings, not one |
| §7, §27 **VC 9** | the SAME credential in both slots is refused as non-independent |
| §7 | two DISTINCT values clear that row |
| §7 | **distinctness is not sufficient** — `AUDIT_PROVIDER_READ_CREDENTIAL_NOT_LEAST_PRIVILEGE` stands regardless |
| §7 **VC** | the rule is not vacuous — an unsafe record calling the token read-only clears the row |
| §29 **VC 11** | neither credential value appears in the rendered report; presence is reported as a word |
| §29 | neither value nor any digest appears in the returned result object |
| §29 **VC 11** | the unsafe renderer DOES print the token; production does not |
| §8 | production's adapter registry is EMPTY, so no external write can leave by any path |
| §6 | every open architecture precondition is reported, with its owning slice |
| §6 | **a FULLY configured environment is still `NOT_READY`, and the remaining findings are exactly the preconditions plus the provider limitation** |
| §6 | the preconditions are attributed to `S2` and `S3`, which is where `37 §2` puts them |
| §37 | both planes on the same verified release clear every `PRELIVE_` row |
| §53 **VC 13** | an old signed release under the wrong pin does not clear them |
| §53 **VC 14** | a partial control/audit rollout is NOT treated as READY |
| §43, §44 | the report never names `I36`, `I20` or `I8` as closed, and never claims exactly-once |

## 3. The confinement — `tests/postmark/postmark-tooling-boundary.test.ts`

| § | Property |
|---|---|
| §31 | the S1M tooling directory contains no HTTP client, no socket, no vendor SDK and no request construction |
| §30 | **no API origin appears anywhere in it**, and it constructs no `URL` — a documentation link cannot be dialled |
| §29, §31 | no `Authorization`, no `Bearer` and no provider token header name |
| §33 | no retry construct of any kind — zero automatic send retries has nothing to disable |
| §16 | it signs nothing and reaches no release ceremony |
| §8 | its imports are a hand-enumerated closed list of five; a new dependency fails out loud |
| §8 | it reaches no gateway module but the registry — no port, no envelope, no outcome transaction, no claim |
| §48 **VC 12** | **`postmark` appears nowhere under `src/`, in any case** — the ACCEPTED boundary is unamended |
| §48 | nothing under `src/` imports the S1M tooling, or anything under `tools/` |
| §8 **VC 12** | exactly ONE production file calls `.dispatch(`, and it is still the Effect Gateway |
| §8 | `src/` still contains NO adapter implementation at all |

**The closed-import check counts DYNAMIC specifiers too.** `gate.ts` reaches the adapter
registry through `await import(…)` because a static import raises `NO_ACTIVE_VERIFIED_BUNDLE`
at module-evaluation time (`50 §3f`), and a closed-set check that matched only `from '…';`
would have a hole exactly the shape of the one dependency that matters.

## 4. WHAT COULD NOT BE TESTED, AND WHY — the part of this matrix that matters

`§51`: "No skipped test may silently represent an unmet acceptance requirement." Nothing below
is skipped. Each row is **absent**, and each names what it needs.

### 4.1 The six kill points — `§17`, `§18`, `§43`

| Kill point | Status |
|---|---|
| KP1 before claim commit | **NOT RUN against a provider** |
| KP2 after claim, before HTTP leaves | **NOT RUN against a provider** |
| KP3 after HTTP leaves, before response durably known | **NOT RUN against a provider** |
| KP4 after response, before local outcome commit | **NOT RUN against a provider** |
| KP5 after local outcome commit | **NOT RUN against a provider** |
| KP6 workflow recovery / re-entry | **NOT RUN against a provider** |

All six are exercised against the **mock** by the ACCEPTED
`tests/integration/gateway/mock-kill-matrix.test.ts`, and `37 §2` states exactly what that
proves: it "proves the ACOS-side state machine and **proves nothing about a vendor**; the
real-provider six-kill-point validation remains OPEN." S1M does not change that sentence.

**What they need:** a Postmark sandbox account, a sandbox server token, an audit token, an
integration-plane runtime to hold the first two, and a real adapter. `S1M-contract.md` §3.

### 4.2 The `§53` controls that could not be built

| # | Control | Why absent |
|---|---|---|
| 4 | automatic POST retry | needs an HTTP transport; none exists, and `tests/postmark/postmark-tooling-boundary.test.ts` asserts no retry construct exists to disable |
| 5 | correlation metadata dropped | needs a request to drop it from |
| 6 | old `CLAIMED` row redispatched **at a provider** | the local form is the ACCEPTED `unsafe-reclaimable-outbox.ts`; the provider form needs a provider |
| 7 | response-lost mapped `NOT_SENT` instead of `UNKNOWN` | the local form is the ACCEPTED `unsafe-not-sent-mapping.ts`; the transport form needs real bytes |
| 8 | provider count inferred from local journal | needs a provider count to compare against |
| 10 | query delay triggers resend | needs a provider query |
| 17 | **the real duplicate-send control producing provider delta 2** | `§41`'s strongest discrimination for `I36`. Needs a sandbox account. **NOT RUN.** |

Rows 1, 2, 3, 9, 11, 12, 13 and 14 ARE implemented and are in §1 to §3 above.

### 4.3 Reconciliation — `§24`, `§25`

`PRESUMED_EXECUTED → VERIFIED` and `PRESUMED_EXECUTED → NEVER_SENT` are **not implemented**.
`25 §10.1` declares them and defers them by name: "Provider resolution is declared here and
built later. The REALISE and never-sent RELEASE rows above are the lifecycle's terminal
transitions and they require independent provider evidence, so **they belong with the slice
that has a provider**." S1M has no provider, so it built neither, and `§25`'s negative control
— unsafe reconciliation making an old outbox row retryable — has no production counterpart to
discriminate against.

The property `§25` cares about is nonetheless already structural and already tested: `I36`'s
state machine admits **no transition out of `CLAIMED`**, so there is no path for a
reconciliation outcome to return a row to `ENQUEUED`. That is the ACCEPTED S1I enforcement
leg, unchanged by this slice.

### 4.4 The provider-reported accepted count — `§16`

**Not defined from measurement, and therefore not used.** The interpretation a future slice
must validate is in `docs/implementation/evidence/S1M-postmark-provider-evidence.md` §3, and
`§16`'s instruction was followed: "report the interpretation and STOP if it affects I36
correctness."

### 4.5 Webhook ingestion — `§26`

Not implemented, which `§26` permits: the message log meets the architecture's provider-query
primitive, so webhook validation is not specifically required for this provider. It is
recorded as an available EM6 primitive and nothing more.

---

## 5. Regression

| Suite | Result |
|---|---|
| architecture gate | **89 PASS / 0 FAIL** |
| architecture seeds | **58 run, 58 discriminate, 0 fail to discriminate** |
| `npm run verify` | **exit 0** — 167 files, 2421 tests, 2421 passed, 0 failed, 0 skipped |
| offline S1M tests (no credential, no network) | **3 files, 60 tests, all green** |
| credential-requiring provider tests | **NONE EXIST.** Not skipped — never written, because `§46` forbids faking the evidence they would carry |
| `npm run verify:postmark-sandbox` | **exit 1 — `NOT_READY`.** This is the honest result, not a failure of the command |
