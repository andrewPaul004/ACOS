# S1L — Owner clarifications

**Decisions this slice had to make because the mandate and `v1.3.6` did not line up exactly,
or because the mandate left an operational choice open. Each one is recorded with what was
decided, what it rests on, and what it deliberately does NOT claim.**

Nothing here changes `docs/architecture/v1.3.6/`, and nothing here is a new normative rule.

---

## S1L-C1 — `manifest_id` cannot exist before both approvals, so a review identity was added

**The conflict.** `§5`, `§17` and `§18` of the mandate ask for a release candidate carrying a
manifest identity that both custodians review before either signs. `50 §3d`'s CORE carries
both per-entry signatures and `50 §3e` defines `manifest_id = SHA-256(exact CORE bytes)`, so
the manifest identity is a function of both signatures and cannot precede them.

**Decided.** A separate review identity, `candidate_id`, framed under its own domain separator
`ACOS-CONTROL-RELEASE-CANDIDATE-V1` over the header, the declared entry order and every
artifact's identity and content digest.

**What it is not, stated in the code and in the tests.** Not `manifest_id`. Not
`EXPECTED_ACTIVE_MANIFEST_ID`. Not signed by itself. Not read by any runtime. The distinct
domain separator makes it unpresentable where a manifest core is expected, and the deployment
pin remains `50 §3e`'s `manifest_id`.

**Owner decision available.** If the owner would rather the ceremony carry no review identity
at all, the cost is that the two custodians have no single value to compare before signing and
must diff the whole candidate document by hand. The review report would still be
deterministic; the comparison would just be longer.

---

## S1L-C2 — the ceremony is three operations, and the count is forced

**Decided.** primary-artifacts → second-factor-artifacts-and-manifest → primary-manifest.

**Why not two.** Neither custodian can sign the manifest before both artifact signature sets
exist, so exactly one of them must act twice. The primary was chosen to act twice because its
second act is a CONFIRMATION of a core it can independently rebuild from its own earlier
signatures plus the second custodian's — which is what catches a second custodian who changed
anything.

**What is preserved.** No function in `tools/` takes two signers; the tests assert that over
the exported arities and over a source scan. `§14`'s prohibition on a one-process `sign-both`
is structural rather than procedural.

---

## S1L-C3 — class 19: the safety property was implemented, the key migration was not

**The constraint.** `§13` permits implementing `50 §3i`'s migration only if `50 §3i` uniquely
specifies it, and forbids inventing it otherwise. `50 §3i` says the verification keys "should
become the same externally provisioned roots" and immediately calls that "DECLARED FUTURE
WORK". It specifies no mechanics. `37 §2` lists it as a follow-on and NOT a pre-live blocker.

**Decided.** The key migration was NOT invented. `§13`'s stated preferred safety property WAS
implemented: constructor MEMBERSHIP is decided by the verified class-19 artifact bytes carried
by a `VerifiedControlArtifactBundle`. The legacy key argument survives, renamed
`legacyRecordVerifyingKey`.

**What this closes.** A caller-supplied verification key can no longer ADMIT a constructor
record outside the verified artifact. `§12`'s attacks A and C are refused by the production
path and accepted by the unwrapped S1B arrangement, which is what makes the control
discriminating.

**What remains open, and is reported as open.** `50 §3i`'s key migration. The
`ConstructorVersionRecord` signature is still checked against a key the caller supplies, which
can now cause only a REFUSAL.

**A related fact worth the owner's attention.** The verified class-19 artifact declares
`acos.constructor.refund.create`; the S1B canonicaliser registry declares
`ctor.refund.create`. The two identifiers differ, which is consistent with class 19 having no
production authority consumer at v1.3.6 and is why a boundary test now pins
`ConstructorVersionResolver`'s construction sites in `src/` to exactly one — the admission
gate — so a later slice cannot wire the raw constructor in by accident.

---

## S1L-C4 — cross-plane coherence is reported against DECLARED obligations

**The question `§26` asks.** Whether a partial rollout can masquerade as joint readiness, and
whether v1.3.6 defines cross-plane release coherence.

**What v1.3.6 declares.** Cross-plane obligations in terms of CONTENT — `50 §2b`'s
byte-identical class-20 copy, and `50 §2c` / `50 §2f`'s `corroboration_signal_max_age`
equality, "a cross-plane obligation" — plus `50 §3` property 2's requirement that the audit
plane recompute from its own copy against the manifest IT holds.

**Decided.** The readiness gate checks both declared content obligations from each plane's own
verified bytes, and reports `PLANES_ON_DIFFERENT_RELEASES` when the two independently obtained
manifest identities differ, on the ground that an audit plane holding an older manifest is not
recomputing against the control plane's active release.

**No PARTIAL was returned on this point**, because the obligation the architecture declares is
checkable locally and is checked. **No distributed deployment protocol was invented**: the gate
is local, read-only, and never lets one plane's verification stand in for the other's.

---

## S1L-C5 — the release layout is flat where the runtime reads it

`§21` sketches `manifest.core` / `manifest.signatures` / `artifacts/`. The accepted S1K runtime
reads a FLAT package directory containing `manifest.json` plus the class files
(`filesystemArtifactPackage`, `MANIFEST_FILE_NAME`), and `§21` also says to use repository
conventions.

**Decided.** `package/` is exactly the deployable flat directory the runtime consumes; the
ceremony's own scaffolding — candidate, approvals, review, deployment, metadata — sits BESIDE
it and is never deployed. One file name selects exactly one artifact, a path in a package file
name is refused, and there is no first-match rule.

---

## S1L-C6 — the release channel label, and what actually separates a test release

`§47` requires test fixtures to identify themselves as `TEST ONLY`. The label is carried in
`release-metadata.json`, in the review report's banner and in `deployment.json`.

**Stated honestly in the code and the tests:** the label is LEGIBILITY. The decisive separation
is that test keys derive different `key_id`s, which move `50 §3d`'s core and therefore
`manifest_id`, so a test-signed package can never satisfy a deployment pinned to a production
manifest. The label is outside both identities, and the tests prove that changing it moves
neither.

---

## S1L-C7 — three reason codes were added to a CLOSED union

`src/kernel/controlArtifacts/errors.ts` gained `CONSTRUCTOR_RECORD_NOT_MANIFESTED`,
`MANIFESTED_CONSTRUCTOR_MISSING` and `CONSTRUCTOR_RECORD_DUPLICATED`. The union is closed and
an existing boundary test requires every thrown failure's code to be a member, so extending it
was the only way for the admission gate to raise a typed integrity failure. No existing code's
meaning changed and none was removed.

---

## S1L-C8 — what the repository does NOT claim about the ceremony

Stated here because `§46` and `§55 §16` require it to be unambiguous:

* **no production owner keys were created** by or for this slice;
* **no real primary owner approval** was performed;
* **no real second-factor approval** was performed;
* **no production manifest was deployed**;
* **no human custody separation is proved.** The repository proves two independent signing
  operations under two distinct keys over one candidate identity, with neither able to
  substitute for the other. Whether two people held the two keys is operational evidence that
  exists outside this repository.
