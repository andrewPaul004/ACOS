# S1O — owner clarifications

Questions this slice could not answer from the mandate plus v1.3.6 alone, each with what was
done and what a ruling would change.

---

## S1O-C1 — `§5` prefers class 3; v1.3.6's own ownership rules make class 5 the unique owner

**The gap.** `§5` of the mandate says: *"Prefer placement in the closed class-3
adapter/credential capability definition **unless v1.3.6's ownership rules make another
existing signed artifact the unique correct owner**."*

They do, and the `unless` clause is the reason this is a clarification rather than a
deviation.

**What was done. `credential_risk_class` is class-5 content**, and three of v1.3.6's own rules
force it:

1. **`50 §2a` closes class 3 at exactly ten per-class fields plus four catalogue-level
   records**, and states its boundary in both directions: *"What is NOT class 3 content,
   stated so the boundary has two sides."* Credential scopes are not listed.
2. **`50 §2f` requires EXACTLY ONE canonical signed owner per field** and states the rule as
   its own heading: *"No such field may exist outside all signed artifact boundaries. No
   field may belong ambiguously to two artifacts."* Class 5 already exists, is already
   Owner-plus-second-factor, and is already named **"Credential scope declarations"** with
   halt scope *"Affected adapter"*. A credential's permission envelope is that class's
   subject by name.
3. **`§8` of this mandate is the decisive one.** Class 3 is keyed by ACTION CLASS. Putting a
   credential's permission envelope in a per-action record would re-create the
   action-versus-credential conflation `§8` requires the implementation to discriminate
   against — the defect would be in the schema rather than in the code reading it.

`--seed-risk-owned-by-class3` is the discriminating control: it moves the field into class 3
as a fifteenth per-action field, and **L5 and L6 both fail.**

**What a ruling would change.** If the owner prefers class 3 regardless, `§2a`'s closure moves
from ten-plus-four to a new Part C keyed by credential rather than by action class, `§2f`'s
three new rows change owner, and `50 §6` gains no entry. The implementation change is one
parser and one lookup. **The definition, the trigger and the fail-closed rule would be
unaffected**, which is why this is a placement question rather than a normative one.

---

## S1O-C2 — the audit-plane credential has no adapter, and `§2g` field 2 needed a sentinel

**The gap.** `48 §2` row 13's audit-plane vendor read is scoped to a PROVIDER — its job is to
ask the vendor what happened — and every other credential in the class-5 schema is scoped to
an adapter. A field typed *"an adapter identifier the class-3 catalogue names"* has no value
an audit credential could carry, which would have left `48 §3.6`'s operand outside the signed
boundary again: the exact defect `S1N-C1` is about.

**What was done.** `50 §2g` field 2 admits **the reserved sentinel `audit_plane`**, on the
same pattern `50 §2a` field 9 already uses for `internal_only`, and declares it explicitly:
*"THE `audit_plane` SENTINEL IS RESERVED AND CARRIES NO DISPATCH AUTHORITY. It is not an
adapter identity, it is never added to the class-3 catalogue, and the adapter-runtime registry
refuses a descriptor naming it."*

Both halves are enforced, in opposite directions:

* `adapterRuntimeRegistry` refuses a descriptor naming an `audit_plane`-scoped credential
  (`CREDENTIAL_IS_AUDIT_PLANE_SCOPED`) — an audit read credential is not presentable at a
  dispatch boundary;
* `auditPlaneVerifier` **keeps only `audit_plane` records**, so an adapter's credential never
  enters the audit plane's map at all and a descriptor naming one is refused as UNDECLARED.

**The second placement is the stronger one**, and it is deliberate: the audit plane never
learns a send credential's identity, which makes `§13`'s "no control send credential" a fact
about what that plane can see rather than a check it performs. A check can be removed.

**What a ruling would change.** If the owner prefers the audit-plane credential to live in its
own artifact class rather than in class 5 under a sentinel, `50 §6` gains an eighth entry and
the audit verifier reads that class instead. Nothing about the definition or the exemption
changes.

---

## S1O-C3 — the audit reader is fed by the AUDIT plane's own verification, not the control bundle

**The gap.** The mandate's `§14` says the audit runtime must have *"no reliance on control
adapter result"* and `§13` forbids the audit credential being in the control process. Neither
says where the audit plane should read the SIGNED RECORD that says its credential is
read-only.

The obvious implementation — hand `createAuditReaderRegistry` a
`VerifiedControlArtifactBundle` — was written first and is **wrong**, and
`tests/controlArtifacts/audit-plane.test.ts`'s accepted assertion caught it: *"no module under
`src/audit/` imports the control plane's trust chain."*

**What was done.** `auditPlaneVerifier.ts` — which already verifies the same signed artifacts
from the audit plane's own copy, through the audit plane's own deployment variables, sharing
no module with the control plane's verifier — now verifies class 5 too and exposes the
`audit_plane`-scoped records it read. The reader registry takes that map.

**The argument is `30 §5.4`'s, one level up.** An audit reader admitted on the CONTROL plane's
reading of the record that says it is read-only would be an audit plane trusting the plane it
audits for its own independence. `36 §12`'s self-agreement failure does not stop being one
because the subject is a credential rather than a balance.

**What a ruling would change.** Nothing normative. This is an implementation placement the
accepted test forced, and it is recorded because the first attempt was the wrong one and a
reader should know the test caught it rather than a review.

---

## S1O-C4 — SendGrid is selected with FIVE account-level items unresolved

**The gap.** `§24` permits a PASS without live credentials *"if official documentation
unambiguously establishes the capability shape"*, and `§21` requires recording
`CAPABILITY DOCUMENTED — ACCOUNT VALIDATION PENDING` where an account cannot confirm. `§24`
also says: *"If provider docs leave a load-bearing permission ambiguous: S1O returns PARTIAL
rather than guessing."*

**Where the line was drawn.** A permission is *load-bearing and ambiguous* when the
documentation does not settle whether the capability EXISTS. It is *documented and pending*
when the documentation settles the shape and only an account can settle the instance.

**The five SendGrid items are all the second kind**, and they are recorded in
`unresolvedAccountItems` rather than converted into a PARTIAL:

1. whether the intended test account holds the Email Activity history entitlement;
2. **whether a sandbox-mode send produces a queryable Email Activity record** — the
   documentation says the message is never delivered and does not say whether it is recorded;
3. the empirical attempted-write test required by `36 §13`;
4. whether v3 `custom_args` are returned by the Email Activity `unique_args` filter;
5. whether the 6-requests-per-minute Email Activity rate limit admits the six-kill-point
   query volume.

**Item 2 is the one that could change the shape of the resumed slice**, and it is flagged
rather than assumed: if sandbox mode produces no activity record, the validation slice needs a
dedicated non-production sending identity and a controlled sink recipient instead. The record
says so.

**Item 4 has a documented fallback**, which is why it is not a PARTIAL trigger: `categories`
is settable on a v3 send AND is a documented Email Activity filter field, with no
cross-generation naming question. Correlation is available either way; `custom_args` is the
sharper mechanism and its query-side mapping is the pending item.

**What a ruling would change.** If the owner wants `§24` read strictly — any unresolved
account item forces PARTIAL — S1O becomes PARTIAL with the same evidence and the same selected
provider, and the resumed slice is unchanged.

---

## S1O-C5 — Mailgun is UNRESOLVED, and that is not the same as ABSENT

**The gap.** `§22` says: *"Do not infer Events access merely from the word 'Analyst.' If
official endpoint/role mapping cannot establish it: mark Mailgun unresolved."*

**What was found.** Mailgun's published RBAC permissions table gives the Analyst role **Read**
on *Messages*, *Logs* and *Metrics*, and `POST /v1/keys` documents a `basic` role as *"basic
aka analyst-level permissions on an API key"*. So a read-only key is creatable.

**But the mapping ACOS needs is not published.** The RBAC table is a role-to-endpoint-CATEGORY
matrix with **no Events row at all**; `GET /v3/{domain}/events` — the endpoint carrying the
evidence — states **no role requirement**; and `POST /v1/analytics/logs` publishes one filter
example and **no complete attribute list** and **no retention window**.

**What was done.** The record carries `AUDIT_READ_ONLY_CREDENTIAL` as **`UNRESOLVED`**, not
`ABSENT`, and `CAPABILITY_STATUSES` keeps the two apart as a closed three-value set. The
difference is load-bearing: `ABSENT` is a documented negative and would make Mailgun a second
Postmark; `UNRESOLVED` is the absence of documentation either way and leaves Mailgun
selectable by a later slice that obtains an account and measures it.

**What a ruling would change.** If the owner wants Mailgun resolved before selection,
S1O returns PARTIAL and the resumed slice measures both providers. The recorded evidence is
sufficient to do that without re-reading the documentation.

---

## S1O-C6 — the deployed class-5 artifact declares synthetic credentials, and says so

**The gap.** `artifacts/control/` holds the repository's deployed artifact bytes. Production's
adapter and audit-reader registries are both **EMPTY**, so no credential is configured — but
the class-5 artifact must exist for the manifest to be complete, and an empty credential list
would have made every S1O test unable to exercise the trigger it implements.

**What was done.** The artifact declares **six credentials, all synthetic**, for the same
synthetic adapters the S1 action catalogue already names (`mock_ads`, `mock_commerce`,
`mock_processor`) plus a synthetic ESP. The whole S1 catalogue is synthetic; a class-5
artifact declaring synthetic credentials for synthetic adapters is consistent with it.

**Two of the six exist to answer the mandate directly:**

* `synthetic_esp.mixed_send` is **`§8`'s required attack** — `mail.send` beside
  `payment.refund`, on one credential — and is `MONEY_MOVING`;
* `mock_ads.pause_only` and `mock_ads.budget_manage` are **one adapter with two credentials
  that classify differently**, which is the whole content of the owner's ruling and is
  observable on the repository's own action catalogue: `campaign.budget.set` declares
  `carries_vendor_monetary_field: false`, so S1N's derivation called both `NON_MONETARY`.

**Declaring a credential is not configuring one.** `emptyAdapterRuntimeRegistry` and
`emptyAuditReaderRegistry` are what production holds, and neither reads the artifact.

**What a ruling would change.** If the owner wants the deployed artifact to carry an empty
credential list, the tests supply their own through the fixture's `mutate` hook and the
production posture is unchanged. The cost is that the deployed bytes would no longer
demonstrate the ruling.
