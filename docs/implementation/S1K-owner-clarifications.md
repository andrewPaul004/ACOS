# S1K — Owner clarifications

**Ten blocking normative omissions. None is a decision this implementation may make.**

Every item below is stated in the repository's standing form: the **exact wording that
fails**, **why it blocks**, **what was available and was refused**, and **what a closing
declaration would have to say**. Six correspond to tripwires the S1K mandate itself names
and directs `RETURN PARTIAL` on. Four — `S1K-C6`, `S1K-C7`, `S1K-C8`, `S1K-C10` — are new,
were found by reading the v1.3.5 manifest against the accepted implementation, and do not
appear in `phase2-v1.3.5-errata.md §7`'s residual register.

---

## `S1K-C1` — The owner signature's algorithm is undeclared

**The wording that fails.** `50 §3`:

```
manifest.json:
  {class, artifact_id, version, content_hash, signed_at, signature}
```

`signature` is a bare field name. No passage in `22`–`51` declares an algorithm for an
**owner** control-artifact signature.

**The near miss, and why it is a near miss.** Ed25519 appears in v1.3.5 as a normative
signer declaration exactly once, `30 §5.7.1` / `50 §2` class 24:

> "The audit plane, under an Ed25519 key generated on and never leaving the **audit-plane
> host**. The control plane holds **only the public key**, distributed as control artifact
> class 24 and hashed into the **owner-signed manifest**, so a substituted public key is an
> `I19` mismatch."

That is a **different signer**, on a **different host**, with a trust story that works
*because* the owner signature sits above it. Reading the owner's algorithm off the audit
plane's inverts the dependency.

**Why it blocks.** `§30` of the mandate requires the runtime to reject "wrong algorithm
identifier … alternate encoding accepted accidentally", and states "If architecture fixes
Ed25519, only declared Ed25519 representation passes." There is no declared algorithm to
fix, so there is nothing for the algorithm-confusion control to discriminate against.

**What was available and was refused.** Selecting Ed25519 by analogy, or by the fact that
S1B's class-19 verifier already uses it.

**What would close it.** A declaration in `50 §3` naming the owner signature's algorithm
and its wire representation, stated as the owner's and not by reference to class 24.

---

## `S1K-C2` — The signing message is undeclared

**The wording that fails.** `50 §3` prints a **struct**, not a signing input. Nothing
declares:

- that the signature covers `{class, artifact_id, version, content_hash, signed_at}`;
- in what order;
- under what framing or encoding;
- under what domain separator.

**Why it blocks.** `§5` requires a signature that prevents at least: artifact A's signature
reused for artifact B; a class-3 signature reused for class-20; an old version substituted
for a new one; the same hash bound to the wrong identity. **The fields that would prevent
all four are present in `50 §3`'s row** — `class`, `artifact_id`, `version`, `content_hash`
— which is why this is a specification gap rather than a structural impossibility. But
"the fields adjacent to `signature` are presumably what `signature` covers" is an
inference, and `§5` closes with "**Do not guess.**"

`§6` additionally requires domain separation "where architecture requires" the class to be
in the signed message. Architecture requires nothing, so there is no declared separator for
`§29`'s independent oracle to reproduce or for a cross-class substitution test to attack.

**What would close it.** `50 §3` stating the signing message field-by-field in declared
order with its framing and domain separator — the same treatment `30 §5.3a` gives the
journal row kinds.

---

## `S1K-C3` — The owner verification key has no declared provenance. THE ROOT OF TRUST IS CIRCULAR

**This is the mandate's `§41` tripwire and it is dispositive on its own.**

**The wording that fails.** The only two statements about the owner key are:

`49 §3.9`:
> "**Blast radius.** Root of trust. Out of architectural scope, correctly."

`50 §5`:
> "**The signing key.** The owner is the root of trust (`49 §3.9`) and a compromised owner
> credential is out of architectural scope."

Both are statements about **what is not bounded when the owner is compromised**. Neither is
a key-distribution mechanism. Neither says where a running ACOS process obtains the public
half it verifies against.

**The circularity, stated plainly.** `§41` asks:

> What is the ultimate trust root that tells the runtime which artifact hashes/versions/
> signers are trusted?

In v1.3.5 the answer resolves to: *the manifest*. The manifest is trusted *because it is
owner-signed*. The owner signature is trusted *because the verifying key is the owner's*.
Nothing states how the runtime knows which key that is. `§41` names each admissible
answer — a compiled/pinned owner public key, separately provisioned trusted configuration,
or a signed root manifest under a pinned key — and v1.3.5 declares none of them.

**Class 24 is the proof that the gap is real rather than an oversight of reading.** The
architecture *did* close this question for the audit plane's key: it made the public half a
control-artifact class hashed into the owner-signed manifest, so substitution is an `I19`
mismatch. That construction terminates only because a trusted owner key exists above it.
**There is no class 24 for the owner's own key, and there cannot be one — a class-24-shaped
answer for the owner key would be exactly the circle.**

**The repository already hit this and recorded it.** S1B's class-19 verifier,
`src/kernel/canonicalisation/constructorVersion.ts`:

> "**Test keys. NO production key management: the resolver takes the verifying public key
> as an argument and holds no keystore, no rotation and no revocation list.**"

`ConstructorVersionResolver`'s constructor takes `publicKey: KeyObject | Buffer`. That is a
**caller-supplied trust root**, which S1B was entitled to because class 19 was not its
subject and it said so. **`§7` of the S1K mandate forbids precisely that shape**: "trusted
public key is not supplied by the model; not supplied per request; not read from the signed
artifact itself without an independently trusted key binding; no trust-on-first-use; no
'accept any valid Ed25519 key.'"

So S1K cannot reuse the one precedent the repository has, and cannot construct a new one
without inventing the chain of trust `§41` prohibits inventing.

**What would close it.** One sentence in `50 §3` or `49 §3.9` naming the provisioning
mechanism for the trusted owner verification key — pinned at build, provisioned as trusted
configuration outside the artifact set, or rooted in a signed root manifest under a pinned
key — and stating that a signature under an unresolvable key identity fails closed.

---

## `S1K-C4` — `I19 (continuous)` has no enforceable runtime semantics

**The wording that fails.** `50 §3`:

```
I19 (continuous):
  for each deployed control artifact:
      recompute content_hash over canonicalised content
      compare to manifest
      on mismatch → halt the class's halt scope
                  → raise CRITICAL incident
                  → the mismatch itself is journaled
```

and the invariant registry's enforcement column: `CI + RUNTIME + SCHED`.

**Why it blocks.** The loop declares the **action** completely and the **occasion** not at
all. `§16` of the mandate enumerates the candidates — at artifact load, at process startup,
on every authority use, before local authorisation, before the dispatch claim, periodically,
or through a verified immutable artifact object — and directs:

> If v1.3.5 says "continuous" but gives no enforceable runtime semantics/cadence:
> **RETURN PARTIAL.** Do not invent a polling interval.

The word `continuous` in a code fence over a `for` loop is a shape, not a cadence, and
`SCHED` names a leg without a period.

**This matters more than it looks**, because `§18` and `§19` of the mandate both turn on
it: whether the gate sits before the irreversible `CLAIM`, and whether an artifact is
verified no later than first authoritative use, are questions the architecture must answer
before an implementation places the check.

**What would close it.** `50 §3` stating which of the occasions above `I19` runs at, and,
for any scheduled leg, its cadence and its relationship to the dispatch boundary — the same
treatment `30 §5.7.1` gives `MirrorInputStallSignal`'s five-minute re-issuance and
`max_age`.

---

## `S1K-C5` — "canonicalised content" names no canonicalisation, and is circular for class 20

**The wording that fails.** `50 §3` property 1:

> "**The hash is over canonicalised content**, not the file bytes, so a whitespace change
> does not halt the company and a semantic change cannot hide behind formatting."

**Why it blocks.** The package contains exactly one canonicalisation specification —
`ACOS-JCS-1`, `30 §5.3` — and it is scoped to **journal rows**: its column-order rule is
"**Fixed, declared per row kind**", and `30 §5.3a` declares orders for
`acos.journal.outbox_claimed.v1` and `acos.journal.dispatch_outcome.v1`. **No control
artifact is a journal row**, and none has a declared row kind.

**And for class 20 the circularity is total.** Class 20's signed content *is* `ACOS-JCS-1`.
Canonicalising it under itself makes the integrity check of the specification depend on the
specification under test — the same defect `30 §5.3`'s own erratum discussion identifies
when it says "changing it is indistinguishable from breaking the chain".

**What was available and was refused.** Extending S1D's `acos.policy_set.v1` framing
(`canonicalHash` over length-framed fields, `canonicalBytes.ts`) to classes 3, 17, 20 and
27. That primitive is sound and already in production for the Cedar digest — but choosing
*which fields of each class* it frames is `S1K-C6`, and declaring it to be what `50 §3`
means by "canonicalised content" is a normative act.

**What would close it.** A named canonicalisation for control-artifact content, per class or
generically, with class 20's own content given a representation that does not depend on
class 20.

---

## `S1K-C6` — The artifacts' content boundaries are undeclared, and two class pairs co-reside in one module — **NEW**

**Not in `phase2-v1.3.5-errata.md §7`. Found by reading `50 §2` against `src/`.**

### (a) Class 3's content is an open prose list

`50 §2` class 3:

> "**Action catalogue**, **incl.** recoverability class, **`value_direction`**,
> `semantic_option_digest` field list, enumeration `max_age`,
> **`degraded_per_action_approval_floor_monetary` — $20.00**"

"**incl.**" is not a closed enumeration. The accepted `ActionCatalogueEntry`
(`src/kernel/canonicalisation/actionCatalogue.ts`) carries six further fields, and **every
one is authority-bearing**:

| Field | Authority it carries |
|---|---|
| `adapter` | `requiresExternalDispatchFor` derives `I66`'s outbox scope predicate from it — changing it to `internal_only` removes an effect from the outbox entirely |
| `method` | the dispatched vendor operation |
| `carriesVendorMonetaryField` | `I18a`'s null branch |
| `costComponentFree` | `I18c`'s equality condition |
| `rateBased` | `26 §2.1.3` — a rate class reserves `0.00` |
| `settlementTolerance` | `51 §5.1`, `I18d` |

Whether these are inside class 3's signed content is not stated. A signature that omits
`adapter` leaves the outbox scope predicate unsigned; a signature that includes it is a
boundary the implementation drew, not the architecture.

### (b) Class 3's and class 17's content co-reside in one frozen literal

`51 §2.3` assigns `irrecoverable_units` to **class 17**:

> "**This table is part of control artifact class 17's signed content** (`50 §2`), because a
> unit count is an authority quantity."

The implementation carries it as `irrecoverableUnits: bigint`, **a field of each class-3
`ActionCatalogueEntry` object**. One `Object.freeze`d literal, two signed classes, no
declared split. Hashing the literal signs class 17 content into class 3's hash and moves
class 3's `content_hash` whenever a unit count changes — which is the cross-class coupling
`§6` of the mandate exists to prevent.

### (c) Class 3's and class 27's content are two exports of one module

`src/kernel/mirror/degradedModeThresholds.ts` exports both:

- `DEGRADED_PER_ACTION_APPROVAL_FLOOR = 2000n` — `51 §3.7`, **class 3** content per
  `50 §2`;
- `DEGRADED_MODE_TIMING = { mirrorLagCriticalMs, auditUnreachableFullHaltMs }` —
  `51 §3.8`, **class 27** content.

`phase2-v1.3.3-errata.md` is explicit that class 27 is "**a new class rather than an
extension of class 25**" because halt scope is per class. The two quantities in one file
have **two different signed classes and the same halt scope of "All effects"**, and nothing
declares the boundary between them.

**Why it blocks.** A content hash cannot be computed over content whose boundary is not
declared. `§5` requires that a signature bind "THIS artifact identity/hash/version"; an
implementation-chosen boundary means the identity is the implementation's, and a later
declaration would move every `content_hash` a further time — class 20's has already moved
three times.

**What would close it.** `50 §2` closing each class's content to a declared field list, and
stating the split where one deployed object carries two classes' content.

---

## `S1K-C7` — Class 17's content is per-company runtime database rows — **NEW**

**The wording.** `50 §2` class 17:

> "**Named exposure windows** — window ids, `boundary_kind`, `max_monetary`, `max_count`
> with its per-class sub-ceilings, `max_irrecoverable_units`, and `51 §2.3`'s
> per-action-class `irrecoverable_units`"

`51 §1`: "Windows are **company-scoped named objects**."

**The implementation.** `src/db/migrations/0001__foundation.sql:32` —

```sql
CREATE TABLE window_registry (
  company_id  TEXT NOT NULL REFERENCES company(company_id),
  window_id   TEXT NOT NULL,
  ...
  max_monetary                NUMERIC(18,2) NOT NULL,
  max_count                   BIGINT        NOT NULL,
  max_irrecoverable_units     BIGINT        NOT NULL,
  PRIMARY KEY (company_id, window_id)
);
```

**Rows, keyed by company, written at runtime.** `50 §3`'s manifest is a deploy-time
artifact set carrying `signed_at` and an owner ceremony (`34` ADR-025: "A signing ceremony
the owner must actually perform").

**Why it blocks.** Nothing declares:

1. how a per-company runtime row participates in a build-time owner-signed manifest;
2. who signs a window created for a company **after** the ceremony, or what happens to
   `I19` in the interval;
3. whether `artifact_id` is per class, per company, or per window.

**A second, independent boundary problem in the same class.** `51 §2.3`'s table declares
**seven** action classes — `refund.create`, `goodwill.credit.issue`, `campaign.pause`,
`campaign.budget.set`, `fulfilment.reship`, `order.address.edit`, `email.send`. The S1
closed catalogue carries **four**. It is not declared whether class 17's signed content is
the architecture's seven-row table or the deployed four-row subset. Signing the subset means
the signature does not cover the declared table; signing the table means the runtime
verifies content it does not deploy, and `§21` of the mandate requires the signature to be
**for this artifact identity**.

**What would close it.** `50 §3` stating whether class 17's manifest entry is per-company
and, if so, when it is signed relative to company creation — and `51 §2.3` stating whether
its signed content is the declared table or the deployed catalogue.

---

## `S1K-C8` — Class 20 has no artifact to sign — **NEW**

**The wording.** `50 §2` class 20's signed content is `ACOS-JCS-1` itself: "column order per
row kind, decimal scales, timestamp format, **NULL framing under the reserved `0xFFFFFFFF`
length word**, Unicode form, JSON canonicalisation, framing."

**The implementation.** That specification exists in this repository as **three conforming
production implementations and no artifact**:

| Implementation | Location |
|---|---|
| Control-plane PL/pgSQL | `acos_jcs1_*` in `src/db/migrations/0005`–`0013` |
| Audit-plane PL/pgSQL | `audit_jcs1_*` in `src/audit/db/migrations/A0001`–`A0005` |
| TypeScript | `src/kernel/canonicalisation/canonicalBytes.ts` — which describes itself as "**a THIRD production implementation of `30 §5.3`**" |

plus the normative prose in `30 §5.3` and `§5.3a`, which lives in the architecture package
and not in the deployed system.

**Why it blocks.** `50 §3` verifies "each **deployed control artifact**" by recomputing its
content hash. Class 20 has no deployed artifact — signing an implementation signs a
**conformant instance**, not the specification, and three instances would require three
signatures for one class with one `content_hash`. `50 §3` property 2 makes this sharper: the
audit plane must **recompute the same hash from its own copy**, and its copy of class 20 is
a *different implementation of the same spec*, which by construction does not hash alike.

**This is why class 20's signature has been owed since v1.3.2 and has been enlarged three
times without ever being dischargeable.** Each erratum correctly recorded that the
`content_hash` moved; none declared what the content is.

**What would close it.** Either a deployed, canonicalisable representation of `ACOS-JCS-1`
that the control and audit planes both hold and both hash identically, or a declaration that
class 20's manifest entry binds the specification **document's** identity and version rather
than deployed bytes — with `50 §3` property 2 restated accordingly.

---

## `S1K-C9` — The manifest's own integrity is undeclared

**The wording that fails.** `50 §3` signs **rows**. `50 §5` concedes the stronger case:

> "**The migration principal.** A principal that can `ALTER` the manifest table's
> constraints operates beneath this mechanism (`49 §3.11`). **External anchoring is the
> control there, not this one.**"

**Why it blocks.** Per-row signatures authenticate the rows that are present. They do not
protect the **row set**: deleting a manifest row removes a requirement, and the list of
*which classes are required* lives in the same unprotected place. An attacker who can drop
class 27's row does not need to forge anything.

External anchoring is `I17b`, an **S3** deliverable (`37 §2`), so the control `50 §5` points
at does not exist at S1.

`§40` of the mandate is explicit:

> Do not let a modified manifest simply declare `signature_required = false` unless the
> manifest itself is independently protected according to architecture. If the manifest is
> itself a control artifact requiring signing and current architecture does not close that
> recursion: **RETURN PARTIAL.**

v1.3.5 does not enumerate the manifest as one of its twenty-seven rows, and does not declare
a signed root manifest. The recursion is open.

**What would close it.** A declared root manifest signed under the pinned key of `S1K-C3`,
binding the required class set — or an explicit statement that the row set's integrity rests
on a named control outside `50` that exists at the slice enabling real transport.

---

## `S1K-C10` — The second factor is required on every artifact in this mandate and has no declared mechanism — **NEW**

**The wording.** `50 §4`:

> "**Classes 1, 2, 3, 5, 15, 16, 17 and 19–27 require a second factor.**"

That is **every artifact S1K was asked to sign** — class 2 (Cedar / `O4`), 3, 17, 20 and 27.
`33 §2.5` repeats it for the act itself: "Owner authority actions (grant changes,
`MAL_monetary` signing, **control-artifact manifest signing**, policy version activation,
audit-schema DDL, any workflow fork) require a second factor and are recorded as decisions."

**Why it blocks.** Nothing declares:

1. what the second factor **is**;
2. how its use is **evidenced in the manifest row** — `50 §3`'s row has no field for it;
3. how a **verifier** establishes that a signature was produced under one.

A runtime that accepts a single owner signature on a class-3 entry accepts an artifact the
architecture says is insufficiently authorised, and reports it as verified. That is worse
than no verification, because it converts an open obligation into a false assurance — which
is the failure mode `47 §5` names for the `I8` sweep and `50 §5` names for a signed artifact
that is wrong.

**What would close it.** Either a second-factor field in `50 §3`'s row with a declared
verification rule, or an explicit declaration that the second factor is a property of the
**signing ceremony** and is not verifiable at runtime — in which case `50 §4`'s tier is an
operational control and the runtime check is single-factor by declaration.

---

## Sequencing note — not a clarification, recorded so the owner is not surprised

`37 §2` places the control-artifact manifest at **S4**, not S1:

> **S4 — Utterance gate. Build.** … "**`50-control-artifact-manifest.md` with owner-signed
> hashes across all sixteen classes** (`I19`)."

S1's Build list names neither signing nor `I19`. v1.3.4's `SEQ-01` and v1.3.5's `SEQ-02`
each re-sequenced a **specific, named** item into S1 with a declared precondition argument;
**no erratum has re-sequenced control-artifact signing.**

That is consistent with the omissions above rather than in tension with them: the mechanism
is undeclared because the architecture has not yet been asked to declare it. The S1I/S1J
pre-live gate makes the re-evaluation mandatory **before real transport** — which is this
document — and does not itself move the build into S1.
