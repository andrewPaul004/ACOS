# ADR-IMP-003 — the in-process Cedar binding

**Status:** ACCEPTED (implementation-level)
**Slice:** S1D
**Date:** 2026-09-06
**Supersedes:** nothing
**Implements:** ADR-005, DP3, `31 §…`

---

## 1. What this decides, and what it does not

ADR-005 decides that authorisation **is Cedar, evaluated in-process**. `31 §…` names the
evaluated version — *"**Cedar** | **Apache-2.0**, v4.11.0 (2026-05-18), OpenSSF badge […]
**PRIMARY**"* — and `32 §…` fixes the deployment shape: *"Cedar is linked in-process as a
library."*

None of those choose a **binding**, because the architecture is language-agnostic and Cedar's
reference implementation is Rust. ADR-IMP-001 selected TypeScript for the control plane, so a
binding decision exists and belongs here.

**This is an implementation decision. It changes no architecture.** If the binding is
replaced the policy artifacts, the request construction, the denial terminals and every test
in `tests/policy/` are unaffected except for the two modules that import it.

---

## 2. Options considered

| Option | What it is | Verdict |
|---|---|---|
| **`@cedar-policy/cedar-wasm`** | The Cedar project's own WASM build with TypeScript types, published from `cedar-policy/cedar` under Apache-2.0, versioned in lockstep with Cedar itself | **CHOSEN** |
| A Rust sidecar over IPC | `cedar-policy` crate behind a local socket | Rejected — ADR-005 says *in-process*, and `32 §…` prices the in-process choice explicitly: *"policy evaluation costs microseconds, so evaluating on *every* effect — including cheap ones — is free, which keeps the chokepoint honest."* A sidecar reintroduces a boundary, a failure mode and a latency budget the architecture deliberately removed |
| A native Node addon (napi-rs) over `cedar-policy` | Same engine, native ABI | Rejected — no first-party publication, so the binding would be a third-party artifact evaluating the control plane's money bound. `49`'s TCB analysis makes that the wrong place to accept a supply-chain hop |
| A TypeScript reimplementation of the Cedar evaluator | — | Rejected outright. The S1D mandate forbids it, and it would make ADR-005's fallback clause (*"if the policy set proves inexpressible in Cedar, OPA replaces it"*) meaningless: there would be nothing to be inexpressible in |

---

## 3. The decision

**`@cedar-policy/cedar-wasm`, pinned to exactly `4.11.2`.**

Three properties made it the answer:

1. **It is the engine, not a reimplementation of it.** The WASM module is compiled from the
   same Rust crate the Cedar project ships. `cedar.getCedarVersion()` is compiled into the
   module and `tests/policy/cedar-runtime.test.ts` asserts it, so "we are running real Cedar"
   is a checked fact rather than a claim about a package name.
2. **It is versioned with Cedar.** `4.11.2` is the patch head of the `4.11` line `31 §…`
   names. A binding whose version floated free of the engine's would make `26 §11`'s
   reproducibility claim — *"same inputs, same `policy_version`, same `constructor_version`,
   same verdict, forever"* — unverifiable.
3. **It is Apache-2.0**, matching the licence `31 §…` records for Cedar.

**Pinned exactly, not by range.** A range lets the evaluator of a money bound change under a
lockfile refresh with no control-artifact event. The pin is asserted by test.

**It is a `dependencies` entry, not a `devDependencies` entry**, because it is the production
policy engine. Also asserted by test.

---

## 4. Consequences

- A Cedar upgrade is a control-plane deploy, exactly as ADR-005 states: *"In-process linkage
  means a policy-engine upgrade is a control-plane deploy."*
- Exactly two modules import the binding: `cedarEngine.ts` (evaluation) and
  `policyArtifacts.ts` (parse checking at load). `tests/policy/cedar-runtime.test.ts` asserts
  that set exactly, so a third import site is a visible change rather than an incidental one.
- `isAuthorized` is **synchronous**, so `PolicyEngine.evaluate` is synchronous and no policy
  decision can interleave with anything. That is a small, real safety property and it is why
  the method is not `async`.
- The WASM module is loaded once per process by the module system. There is no initialisation
  step to forget and no async ready-state to race.

## 5. What was NOT installed

**`cedar-policy-symcc`.** `22` DP3, verbatim: *"**v1.1: symcc is deferred as an S1 gate** per
`45 §3` […] The deferral is recorded as an **amendment to `11 E6` under `28 §9.2`**, not
applied silently, and the gate returns before the catalogue exceeds ten classes and before
any real money."*

`tests/policy/cedar-runtime.test.ts` asserts that no dependency whose name contains `symcc`
is installed, so the deferral is a checked property of the tree rather than an intention.

## 6. Reconsider if

- ADR-005's own reconsideration trigger fires: *"policy expressiveness requires constructs
  Cedar lacks and the exposure ledger cannot absorb, or […] symcc's supported fragment
  excludes a property in P1–P7."* In that case ADR-005's named fallback is OPA and this ADR
  is superseded rather than amended.
- The symcc gate returns and the WASM binding does not expose it. `cedar-policy-symcc` lives
  in the same repository, so a binding is plausible; if it is not published, the CI gate can
  run the Rust tool against the same `.cedar` artifacts this ADR loads, because the artifacts
  are plain Cedar source files and not a binding-specific format. **That is a reason the
  artifacts are files rather than embedded strings.**
