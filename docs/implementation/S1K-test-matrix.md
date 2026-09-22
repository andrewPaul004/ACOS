# S1K — Test matrix

**No test was added. This matrix records the test set S1K owed, why each member is
unbuildable at v1.3.5, and what was actually run.**

A test matrix for a PARTIAL is not an empty document. Its job is to be the specification the
next attempt is judged against, so each row below names the **precise blocker** rather than
"blocked".

---

## 1. The twelve vulnerable controls the mandate's `§39` requires

`§39` requires every counted control to **discriminate** — the vulnerable implementation must
fail where the production one passes. A control cannot discriminate against a production
implementation that does not exist, so none was written. **Writing a vulnerable control
against an invented production mechanism would have manufactured a discrimination result
that proves nothing.**

| # | Required vulnerable control | Production behaviour it must discriminate against | Blocked by |
|---|---|---|---|
| 1 | hash-only artifact acceptance without signature | signature required | `S1K-C1`, `S1K-C2` |
| 2 | accepts any valid Ed25519 signer | only the trusted owner key passes | `S1K-C3` |
| 3 | signature omits artifact class/domain | class is in the signed message | `S1K-C2` |
| 4 | signature omits version | version is in the signed message | `S1K-C2` |
| 5 | signature omits content hash | hash is in the signed message | `S1K-C2`, `S1K-C5` |
| 6 | startup verifies, runtime reloads mutable unsigned bytes | verified immutable bytes are what authority uses | `S1K-C4` (the occasion of verification is undeclared) |
| 7 | missing signature falls back to hash-only | fails closed | `S1K-C1` |
| 8 | constructor signature accepted as a Cedar/control-artifact owner signature | cross-domain substitution fails | `S1K-C2` — **and note the domain framing already exists**: `canonicalBytes(kind, …)` emits the kind as the first framed field, so `acos.constructor_version_record.v1` could not collide with a control-artifact kind. What is missing is the *declared* control-artifact kind, not the primitive |
| 9 | stale valid signature reused after artifact mutation | binds this identity/hash/version | `S1K-C2`, `S1K-C6` |
| 10 | tampered class-17 MIE units still drive reservation | verified units drive step R | `S1K-C6`(b), `S1K-C7` |
| 11 | tampered class-27 threshold still drives the degraded classifier | verified thresholds drive it | `S1K-C6`(c) |
| 12 | tampered class-20 row order still drives canonicalisation | verified spec drives it | `S1K-C8` — class 20 has no artifact to tamper with |

---

## 2. The signature-vector and oracle tests the mandate's `§28`/`§29` require

| Requirement | Status | Blocked by |
|---|---|---|
| Hand/fixed signed fixture generated independently of the production signer | **not written** | no declared algorithm (`S1K-C1`) |
| Independently derived expected content hash / signing message | **not written** | no declared signing message (`S1K-C2`) or content boundary (`S1K-C5`, `S1K-C6`) |
| Test oracle for the signing message, not importing the production constructor | **not written** | there is no declared framing for an oracle to reproduce. **The repository already has the shape this would take** — `tests/support/jcs1Oracle.ts` and `canonicalisationOracle.ts` are independent oracles for `ACOS-JCS-1` and the canonicaliser — so the pattern is proven and only the specification is missing |
| Two owner keypairs, trusted vs untrusted, both cryptographically valid | **not written** | no trusted-key resolution to discriminate on (`S1K-C3`) |
| `key_id` substitution vectors | **not written** | `50 §3`'s manifest row **has no `key_id` field** (`S1K-C3`) |
| Algorithm-confusion rejection | **not written** | no declared algorithm to fix (`S1K-C1`) |

---

## 3. Runtime tamper tests the mandate's `§20`/`§36`/`§37` require

| Requirement | Status | Blocked by |
|---|---|---|
| Startup tamper — artifact invalid before kernel init, authority subsystem unavailable | **not written** | `S1K-C4` |
| Live backing-store tamper — valid at load, altered later | **not written** | `S1K-C4`, and for class 17 the backing store is a runtime table (`S1K-C7`) |
| TOCTOU: verify → mutate → use | **not written** | `S1K-C4` |
| Eligible ENQUEUED effect + tampered artifact → no claim, no adapter call, reservation held | **not written** | gate placement is the architecture's to declare (`S1K-C4`); `§18` asks whether the gate can run before the claim and `50 §3` does not say |
| Empty trusted owner keyring → authority path unavailable | **not written** | there is no keyring (`S1K-C3`) |

---

## 4. What WAS run — full regression, no exclusions

The mandate's `§31`–`§34` require the S1D/S1E, ACOS-JCS-1, MIE and degraded-mode suites to be
re-run. **Because `src/` and `tests/` are byte-identical to `ad8a78e`, the whole accepted
suite was re-run rather than a selection**, which is a stronger statement than any subset.

| Suite | Requirement | Result |
|---|---|---|
| Architecture gate — `consistency-v1.3.py` | 64 PASS / 0 FAIL | **64 PASS / 0 FAIL, exit 0** |
| All 29 retained seeds | each still fails its intended conditions | **unchanged — no seed disarmed; the corpus and the script are untouched** |
| `npm run typecheck` | green | **green** |
| `npm run lint` | zero warnings | **zero warnings** (`--max-warnings 0`) |
| `npm run test` — full suite | 147 files / 2057 tests / 0 failed / 0 skipped | **147 / 2057 / 2057 passed / 0 failed / 0 skipped**, exit 0, 3455s |
| `§31` Cedar — VC-C1 `$26.03` vs `$25`, `total_exposure` drives Cedar, vendor amount never substitutes, coarse worker denial, exactly one production Cedar path | unchanged | **unchanged — no Cedar code was touched** |
| `§32` ACOS-JCS-1 — VC-A3, NULL/empty/bytea collision, old-sentinel negative, field-order negatives, all row kinds, independent audit rechain | unchanged | **unchanged** |
| `§33` MIE — step-R reservation, final-unit race, reserved→presumed, NOT_SENT release, historical `I20` denominator | unchanged | **unchanged** |
| `§34` degraded mode — `$20` floor boundaries, VC-A2 inversion, PT15M lag, PT30M full halt, owner override bounds | unchanged | **unchanged** |

**No `.only` exists in the tree** — the property is asserted by the accepted suite and the
tree is unmodified.

---

## 5. The one property S1K can assert about itself

**`git diff ad8a78e...HEAD -- src tests` is empty.**

Every negative property `§46`'s diff audit asks about is therefore true by construction
rather than by inspection:

| `§46` item | Status |
|---|---|
| private signing key in repository | **none added** |
| runtime auto-signing | **none added** |
| signature verification bypass | **none added** |
| trust-on-first-use | **none added** |
| any-valid-key acceptance | **none added** |
| shared constructor/Cedar domain | **none added** |
| unsigned fallback | **none added** |
| mutable artifact re-read | **none added** |
| network/vendor code | **none added** |
| fake provider sandbox | **none added** |
| architecture package edits | **none** — `git diff ad8a78e...HEAD -- docs/architecture` is empty |
