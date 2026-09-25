# S1M — Contract

**Baseline `910b246` (the accepted S1L checkpoint). Branch `feature/s1m-postmark-sandbox`.
Package issue `v1.3.6`, unmodified.**

**NO POSTMARK API CALL. NO VENDOR CREDENTIAL. NO REAL ADAPTER. NO LIVE SERVER. NO
PRODUCTION OWNER CEREMONY. NO SECOND PROVIDER.**

---

## 1. What S1M was asked to prove, and what it can prove

The mandate asked for the first ACOS slice to cross a real external-provider boundary: a
Postmark **Sandbox Server** adapter, the six kill points of `44 §5.2` run against it, and
`I36`'s verification leg measured by the **provider's own accepted count**.

That leg cannot be run from this repository at this baseline, for three independent reasons.
Each is stated in `§3` below with its citation, and each was reached by reading the frozen
architecture rather than by finding the work inconvenient. The mandate's own instructions for
these cases are explicit:

> `§6`: "If that runtime mechanism is not yet implemented sufficiently for a real provider
> token: **RETURN PARTIAL.** Do not invent a shortcut."
>
> `§46`: "If credentials are not available in the environment: implement all code/tests that
> do not require them. Then return **PARTIAL — EXTERNAL VALIDATION BLOCKED ON POSTMARK
> SANDBOX CREDENTIALS.**"
>
> `§54`: "**PARTIAL** if provider credentials/account are unavailable or provider semantics
> cannot satisfy EM6."

**S1M returns PARTIAL.** What it delivers is everything that does not require crossing the
boundary, and a gate that makes crossing it impossible until the blockers are cleared.

---

## 2. What this slice DOES prove

```
sandbox-only owner keys, generated and held OUTSIDE the repository
  -> a REAL three-operation control-artifact release ceremony
  -> a genuine dual-signed manifest and a genuine deployment pin
  -> control-plane bootstrap  +  audit-plane bootstrap, independently
  -> READY_FOR_PROVIDER_SANDBOX_CONFIGURATION on one active manifest
  -> the S1M provider-sandbox gate
  -> NOT_READY, with every blocking finding named and attributed
  -> STOP
```

and, beside it, a dated **provider capability record** that answers `25 §7`'s EM6 question
about Postmark from the provider's own published documentation, and a set of offline
vulnerable controls for the subset of `§53`'s fourteen whose defect is expressible without a
provider.

---

## 3. The three blockers, each normative

### 3.1 No Postmark sandbox credential exists in this environment — `§46`

No `.env` file, no `POSTMARK_*` variable and no token of any kind is present. The mandate
forbids faking the six-point provider evidence (`§46`: "Do not fake the six-point provider
evidence"), so none was faked and no provider-side number appears anywhere in this slice.

### 3.2 There is no architecture-legal place to put a provider token — `§6`

`48 §2` row 2 places the communications adapter in the **integration plane (Z2)**. `23 §7`
requires **per-adapter runtime isolation**: "one adapter cannot read another's secret from
its own environment or filesystem". `23 §11` states the MVP arrangement: "**No credential
broker** (R5). Per-adapter secrets in the platform secret manager, per-adapter runtime
isolation."

`I25` — **"No process in the control plane holds a vendor credential"** — is enforced by a CI
check "on the dependency tree and the injected environment", and `48 §4` item 4 states the
consequence: "a control-plane component that acquires a vendor call site **fails the build
twice**."

This repository has **one runtime**. `effectGateway.ts` invokes `adapter.dispatch(envelope)`
as an in-process call. An adapter registered into that registry and holding a Postmark token
would place a vendor credential inside the control-plane process. There is no integration
plane to put it in instead, no secret manager to draw it from, and no inter-plane transport
to reach one across.

`37 §2` assigns **`I24` and `I25` to S2** and the **four integration-plane adapters to S3**.
This repository is at S1. S1M as specified would create the first real vendor call site ahead
of both invariants whose entire purpose is to govern vendor call sites.

### 3.3 Postmark cannot supply the audit plane's read-only credential — `§7`

`48 §2` row 13 exempts audit-plane vendor reads from the perimeter on one ground: **"Reads
only."** `48 §3.6` states the compensating control: those credentials are "read-only,
separately provisioned, and **attempted-write-tested** (`36 §13`)", and `36 §13`'s
replica-read test is explicit — "assert [...] that its vendor credentials are read-only —
**attempt a write against each and assert vendor-side failure**."

Postmark's published token model (retrieved 2026-09-25) offers a server token that grants
"sending messages, checking sent messages, and using the Bounce API" as one undivided
capability, up to three per server, with no read-only scope; read-only access exists only as
a **web-interface user role that carries no API token**, and `§15` forbids provider UI
scraping. `48 §3.6`'s Google Ads precedent — "a separate login with viewer-level account
access rather than API scope separation" — does not transfer, because that precedent still
yields an API credential that fails a write, and Postmark's does not.

So a Postmark "audit" credential can be **separately provisioned** and cannot be
**least-privilege**. `§7`: "never pretend independence that Postmark cannot provide." The
limitation is recorded in `tools/postmark-sandbox/capabilityRecord.ts` and produces a
standing gate finding rather than a footnote.

---

## 4. The security boundary, restated and UNCHANGED

**`§48` asked for a narrow confinement transition. S1M performs none**, because nothing was
built that needs the width.

`tests/integration/gateway/no-real-transport-boundary.test.ts` is **unamended**:

* `/postmark/i` is still refused over the whole of `src/`;
* the gateway directory's import allow-list is unchanged;
* `EMPTY_ADAPTER_REGISTRY.registeredIds` is still `[]`, so `resolveAdapterFor` refuses every
  effect;
* exactly one production file calls `.dispatch(`, and it is the Effect Gateway.

`48 §7`'s question 4 — "Has the CI check been disabled, weakened, or worked around for any
build?" — is answerable **NO** for this commit, and
`tests/postmark/postmark-tooling-boundary.test.ts` re-asserts each absence so that a reviewer
does not have to take the claim on trust.

---

## 5. What was added, and where it may live

| Added | Location | Why it is not a perimeter site |
|---|---|---|
| the provider capability record | `tools/postmark-sandbox/capabilityRecord.ts` | frozen data; no origin, no credential, no request |
| the S1M readiness gate | `tools/postmark-sandbox/gate.ts` | reads local evidence and credential PRESENCE only |
| the operator CLI | `tools/postmark-sandbox/cli.ts` | prints and exits |
| offline vulnerable controls | `tests/negative-controls/unsafe-postmark-sandbox-gate.ts` | test-only; nothing in `src/` imports it |

`tools/` is a leaf: `tests/release/release-boundaries.test.ts` asserts that **nothing under
`src/` imports anything under `tools/`**, and `tests/postmark/postmark-tooling-boundary.test.ts`
pins the new directory's own imports to a hand-enumerated list of five.

---

## 6. The credential discipline this slice actually implements — `§29`

The gate reads **presence**, never a value.

* `credentialPresence` returns a boolean and a SHA-256 digest;
* the digest exists only so two slots can be compared for distinctness;
* **neither the value nor the digest is returned or rendered**, and
  `tests/postmark/postmark-gate.test.ts` asserts both absences against a seeded value;
* the discriminating control — a renderer that prints the token, which is what a line added
  while debugging a 401 looks like — is in the unsafe module and DOES print it.

No variable is read into an API origin. `§30`'s defect is not merely unused here: the
variable's **presence is a refusal**, and `tests/postmark/postmark-tooling-boundary.test.ts`
asserts that `api.postmarkapp.com` appears nowhere in the tooling and that no `new URL(` is
constructed in it.

---

## 7. The sandbox release ceremony — `§4`, and its one honest qualification

A **real** three-operation ceremony was performed, through the real
`tools/control-release/` CLI, under **freshly generated Ed25519 keys held outside the
repository**, and both planes were bootstrapped separately against the resulting pin. Nothing
was fixture-shortcut: the keys are not the S1K test seeds, the package is the repository's own
six artifacts, and the pre-live gate reported `READY_FOR_PROVIDER_SANDBOX_CONFIGURATION`.

**The qualification.** `tools/control-release/candidate.ts` declares a closed channel enum of
exactly two members, `PRODUCTION` and `TEST_ONLY`. There is no `SANDBOX` member, and S1M did
not add one: `§0` forbids modifying accepted work to make Postmark convenient, and a third
channel has no architectural warrant. The release is therefore labelled **`TEST_ONLY`**, which
satisfies `§4`'s requirement that the keys "must not be labeled production" and states the
truth — it is a non-production release under non-production roots.

**`PRODUCTION RELEASE CEREMONY: NOT PERFORMED.`** No production owner key was created, held
or used, and no production root exists.

---

## 8. What S1M does NOT claim

* **no provider-side number of any kind.** No accepted count, no delta, no MessageID, no
  query result. `I20`'s left-hand side requires "provider-reported accepted messages" and
  `I36`'s verification leg requires the same; S1M produces neither and asserts neither.
* **`I36` verification remains OPEN.** The enforcement leg stays exactly where the accepted
  S1I/S1J left it: the DB state machine and the mock six-kill-point composition. An outbox row
  count is not a provider accepted count, and no sentence in this slice implies otherwise.
* **`I20` provider comparison remains OPEN.** `§28`'s warning is honoured literally.
* **`I8` remains OPEN**, and `§44`'s warning is honoured: no audit read credential exists, and
  the Postmark-specific leg is not merely unproven but — per `§3.3` above — not satisfiable in
  the form `36 §13` requires.
* **no "external exactly-once".** `§43`: "At-most-once dispatch plus provider evidence is
  narrower than universal distributed exactly-once", and S1M has neither half.
