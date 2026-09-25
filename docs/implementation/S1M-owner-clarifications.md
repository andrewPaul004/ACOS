# S1M — Owner clarifications

**Branch `feature/s1m-postmark-sandbox`. Baseline `910b246`. Package issue `v1.3.6`,
unmodified.**

Seven places where the mandate's phrasing assumed something this repository or this provider
does not have. None was smoothed over; each is recorded here and in the slice's own files.

---

## 1. `§6` told S1M to USE a credential boundary that does not exist

> `§6`: "Use the current credential-broker/adapter credential boundary. If that runtime
> mechanism is not yet implemented sufficiently for a real provider token: RETURN PARTIAL."

There is no such mechanism. `23 §11` states the architecture's own MVP arrangement — "**No
credential broker** (R5). Per-adapter secrets in the platform secret manager, per-adapter
runtime isolation" — and neither the secret manager nor the per-adapter runtime exists here.
`37 §2` puts `I24` and `I25` at **S2** and the four integration-plane adapters at **S3**; this
repository is at S1.

**The consequence the mandate did not anticipate.** The forbidden shortcut is not the variable
name `process.env.POSTMARK_TOKEN`. It is the **in-process adapter that would need one**:
`effectGateway.ts` invokes `adapter.dispatch(envelope)` as a local call, so any adapter holding
a token holds it inside the control-plane process, and `48 §4` item 4 says a control-plane
component that acquires a vendor call site "fails the build twice".

So S1M wrote no adapter at all. That is a larger refusal than `§6` literally asked for, and it
is the only one that does not weaken `I25`.

## 2. `§7` and `§27` assumed Postmark can supply a read-only audit credential

It cannot. A Postmark server token grants sending, sent-message inspection and the bounce API
as one undivided capability; a server may hold up to three, each with the same power; and the
only read-only access is a web-interface user role that carries **no API token**. `§15` forbids
provider UI scraping, so that role is not a query path.

`36 §13`'s replica-read test — "attempt a write against each and assert vendor-side failure" —
is therefore **unsatisfiable** for Postmark, and `48 §2` row 13's exemption ("Reads only") is
not earned by any Postmark credential.

`48 §3.6`'s Google Ads precedent does not transfer: a viewer-level Google Ads login still
yields an API credential that fails a write. `§7` says "never pretend independence that
Postmark cannot provide", so the limitation is recorded as data in
`tools/postmark-sandbox/capabilityRecord.ts` and produces a standing gate finding.

**This is a vendor-selection finding under `25 §7`'s own logic**, not an engineering gap, and
it is the one S1M finding an owner may want to act on before any further Postmark work.

## 3. `§4` asked for a SANDBOX release channel; the accepted tooling has two

`tools/control-release/candidate.ts` refuses any `release_channel` other than `PRODUCTION` or
`TEST_ONLY`, with `RELEASE_CHANNEL_UNDECLARED` and the reason: "an unlabelled release is how a
test-signed package comes to sit in a production path".

S1M did not add a third member. `§0` forbids modifying architecture for Postmark's
convenience and the same restraint applies to accepted tooling; `§4`'s actual requirement is
that the keys "must not be labeled production", and `TEST_ONLY` is the enum's truthful
non-production member. The ceremony was performed for real under **fresh keys generated
outside the repository** — not the S1K test seeds — and the release is labelled `TEST_ONLY`.

## 4. `§16` asked for the acceptance oracle to be DEFINED; documentation cannot define it

> `§16`: "Define exactly which Postmark state/event constitutes `provider accepted` [...] If
> the current architecture does not define this sufficiently, report the interpretation and
> STOP if it affects I36 correctness."

The published status vocabulary is `Queued`, `Sent`, `Processed`. Which of these a sandbox
message reaches, and how quickly, is behaviour rather than documentation, and `36 §7` requires
behaviour to be measured. The interpretation a future slice must validate is recorded in
`docs/implementation/evidence/S1M-postmark-provider-evidence.md` §3: *a message present in the
outbound log under the run's unique correlation metadata, in any of the three statuses, counts
as accepted* — because all three mean the provider took custody, and an oracle counting only
the terminal status would **under-count an escaped message**, which is the wrong direction for
a duplicate-prevention invariant.

It affects `I36` correctness. **S1M stops**, as `§16` instructs.

## 5. `§48` asked for a confinement transition; S1M performs none

> `§48`: "Update those source-boundary tests narrowly: ALLOW one Postmark adapter
> external-write path [...] This is a confinement transition, not deletion of the security
> test."

Nothing was built that needs the width, so nothing was widened.
`tests/integration/gateway/no-real-transport-boundary.test.ts` is byte-unchanged: `/postmark/i`
is still refused over the whole of `src/`, and `tests/postmark/postmark-tooling-boundary.test.ts`
re-asserts that absence so the claim is checkable rather than asserted.

`48 §7` question 4 — "Has the CI check been disabled, weakened, or worked around for any
build?" — is answerable **NO** for this commit. Widening a perimeter test in a commit that
does not need the width is precisely how a perimeter stops being one.

## 6. `§53` listed fourteen controls; seven of them need a provider

Rows 1, 2, 3, 9, 11, 12, 13 and 14 are implemented and discriminate offline. Rows 4, 5, 6, 7,
8, 10 and 17 need a real transport or a real provider, and `S1M-test-matrix.md` §4.2 carries
each as **NOT IMPLEMENTED** with what it needs.

Row 17 — `§41`'s real duplicate-send control producing a provider delta of 2 — is the one the
mandate calls "the strongest discrimination for I36", and it is the one furthest out of reach.
No local substitute was invented for it. The mock-level ancestors
(`unsafe-reclaimable-outbox.ts`, `unsafe-not-sent-mapping.ts`, `unsafe-dispatch-claimed.ts`)
are the ACCEPTED S1I/S1J controls and S1M adds nothing to them, because a mock-level control
is not a provider-level control — which is exactly why `I36`'s two legs are on two slices.

## 7. `§37` asked for a readiness gate that is additive to the authority gates; it is, and it
never passes

The gate composes `evaluatePreliveReadiness` rather than re-deciding it, and adds S1M's rows on
top. In this repository it reports `NOT_READY` and **an operator cannot clear it with
configuration**: three of its findings are mechanisms attributable to S2 and S3, and one is a
property of Postmark's token model. `tests/postmark/postmark-gate.test.ts` asserts exactly
that — a fully configured environment is still `NOT_READY`, and the residue is exactly the
preconditions plus the provider limitation.

That is the intended behaviour, not a defect in the gate. A gate that could be satisfied by
setting variables would be a gate that never stopped anything.
