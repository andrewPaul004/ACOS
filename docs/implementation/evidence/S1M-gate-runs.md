# S1M — Provider-sandbox gate runs

**Recorded 2026-09-25. Branch `feature/s1m-postmark-sandbox`. Baseline `910b246`.**

`§39` asks for an S1M test evidence artifact. **There is no provider evidence to record** —
no Postmark account, no token, no request, no `MessageID`, no query output, no accepted
count. What exists is the readiness gate's own output, and it is recorded here in full
because it is the artifact that states, mechanically, why the provider evidence does not
exist.

**No secret appears below.** No credential was configured for either run, and the gate reads
credential PRESENCE rather than value in any case. The three public deployment values are
the sandbox release's own and are non-secret by construction (`50 §3e`).

---

## Run 1 — `npm run verify:postmark-sandbox`, nothing configured

Exit code **1**.

```
ACOS S1M — POSTMARK SANDBOX VALIDATION READINESS

LOCAL EVIDENCE ONLY. No network call, no vendor call, no credential test.
This gate says nothing about I36, I20 or I8, and closes none of them.

provider                 : postmark
environment required     : Sandbox
sandbox proof mechanism  : GET /server -> DeliveryType == Sandbox
capability evidence date : 2026-09-25
EM6 qualifying primitive : QUERYABLE_MESSAGE_LOG
EM6 qualifies            : true

control plane verified   : false
audit plane verified     : false
manifest identities equal: false
active manifest          : (none)

declared delivery type   : (undeclared)
control send credential  : absent
audit read credential    : absent
credential slots distinct: not comparable — a slot is empty
registered adapters      : (unreadable — no active verified bundle)

RESULT: NOT_READY

BLOCKING FINDINGS
  - PRELIVE_CONTROL_PLANE_NOT_VERIFIED
  - PRELIVE_AUDIT_PLANE_NOT_VERIFIED
  - PROVIDER_DELIVERY_TYPE_UNDECLARED
  - CONTROL_SEND_CREDENTIAL_ABSENT
  - AUDIT_READ_CREDENTIAL_ABSENT
  - AUDIT_PROVIDER_READ_CREDENTIAL_NOT_LEAST_PRIVILEGE
  - COMMUNICATIONS_ADAPTER_ABSENT
  - EXTERNAL_WRITE_PERIMETER_UNENFORCED               [owning slice S2]
  - CONTROL_PLANE_VENDOR_CREDENTIAL_RULE_UNENFORCED   [owning slice S2]
  - INTEGRATION_PLANE_RUNTIME_ABSENT                  [owning slice S3]
```

**One thing this run found, which is worth keeping.** The first version of the tool did not
print any of the above: it terminated with an uncaught `NO_ACTIVE_VERIFIED_BUNDLE` stack
trace before reaching its own code. `adapterRegistry.ts` builds `EMPTY_ADAPTER_REGISTRY` at
module evaluation, building one reads the action catalogue, and `50 §3f` binds the catalogue
to the **active verified bundle** — so a *static* import of the registry raises at import
time when nothing is active.

That is the architecture behaving correctly. The gate now reads the registry through a
deferred import placed after the pre-live check, and the refusal becomes a finding rather
than an exception. A readiness tool that crashes on the deployment most in need of a report
is a readiness tool nobody can act on.

---

## Run 2 — the same command, with the real S1M sandbox release deployed

The three public trust values from `deployment.json`, plus
`POSTMARK_EXPECTED_DELIVERY_TYPE=Sandbox`. No credential.

Exit code **1**.

```
control plane verified   : true
audit plane verified     : true
manifest identities equal: true
active manifest          : f13e2d773d906ff49f26c32ade432f7efa551b62cedab4fb29e1cacc33657f45

declared delivery type   : Sandbox
control send credential  : absent
audit read credential    : absent
credential slots distinct: not comparable — a slot is empty
registered adapters      : (none)

RESULT: NOT_READY

BLOCKING FINDINGS
  - CONTROL_SEND_CREDENTIAL_ABSENT
  - AUDIT_READ_CREDENTIAL_ABSENT
  - AUDIT_PROVIDER_READ_CREDENTIAL_NOT_LEAST_PRIVILEGE
  - COMMUNICATIONS_ADAPTER_ABSENT
  - EXTERNAL_WRITE_PERIMETER_UNENFORCED               [owning slice S2]
  - CONTROL_PLANE_VENDOR_CREDENTIAL_RULE_UNENFORCED   [owning slice S2]
  - INTEGRATION_PLANE_RUNTIME_ABSENT                  [owning slice S3]
```

**What the difference between the two runs shows.** Every control-artifact row cleared: both
planes verified independently, through their own trust boundaries, onto one manifest
identity, and `registered adapters` became readable and **empty** rather than unreadable. The
sandbox release ceremony is real and it works end to end.

**What remains is not configuration.** Two rows are absent credentials; one is a property of
Postmark's token model; three are mechanisms this repository has not built. `§46`'s operator
list clears the first two and nothing else, which is the property
`tests/postmark/postmark-gate.test.ts` asserts directly: a fully configured environment is
still `NOT_READY`.

---

## The release this gate verified

All values public (`50 §3e`: the deployment pins exactly three things and they are all
public).

| | |
|---|---|
| `manifest_id` | `f13e2d773d906ff49f26c32ade432f7efa551b62cedab4fb29e1cacc33657f45` |
| primary root (public key) | `25942dc6bc2aa8b89c57eb700e6508401f837783bd78e6da83d358da53c51385` |
| second-factor root (public key) | `284d391dfacd3e8856d635c3615ede93b98d60d6f9cec831ef1471b7f752458b` |
| primary `key_id` | `9554f323a059f5b6ae6481d959910c1a164c021c702dc09eff9d2f55978ca5b8` |
| second-factor `key_id` | `f2a350a85dd94abaf01dc9ab199c390946e14eaa5fb77e081b1f94d004e7e9c4` |
| candidate identity (review only) | `789fc1d7935aed26b5f5909b538675d8a2c33e24175c2bcd8465108b02bf4d3e` |
| `manifest_epoch` | `1` |
| `release_channel` | `TEST_ONLY` |
| entries | classes 2, 3, 19, 20, 24, 27 |

| Class | `content_hash` | Bytes |
|---|---|---:|
| 2 policy set | `eb74f97b4632212b445eb8d972a458280e58c81abd43ccbdbb218092d7d216fe` | 12956 |
| 3 action catalogue | `a6436f0c5b75d9ce6bc553bd7ecceea9126e33c7f3093dbc4ae491aca004a28a` | 2520 |
| 19 effect constructors | `0036669e7f781590dbb8acc6f8bcf1405a0c163e23cae34390d1757244146436` | 303 |
| 20 ACOS-JCS-1 specification | `7af60fc564aef296679ae06a34b188d3454ac7ef69f448f7260a3d5d55a18f33` | 13479 |
| 24 audit signing key | `94efa91241d7fd7898fd87fe824ca667381c91c2f9d64a058b964866d5e6d80c` | 197 |
| 27 degraded-mode config | `90012c4a081921fca02e3c539a3d42a75fe7e916acd435b8a9a319239bcae3cf` | 315 |

**The three private keys are not in this repository.** They were generated for this exercise
and live only outside the repository tree. **No production owner key was created, held or
used.**
