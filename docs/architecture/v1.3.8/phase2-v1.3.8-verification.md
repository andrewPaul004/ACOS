# Phase 2 — v1.3.8 verification gate

**The mechanical gate for package issue v1.3.8. Every condition below CAN return FAIL.**

Run from `analysis/`, on a system whose default encoding is not UTF-8 set `PYTHONUTF8=1`:

```
PYTHONUTF8=1 python consistency-v1.3.py                 # 127 PASS / 0 FAIL, exit 0
```

**127 conditions**: C1–C29 (v1.3), E1–E7 (v1.3.1), F1–F3 (v1.3.2), G1–G10 (v1.3.3), H1–H13
(v1.3.4), J1–J16 (v1.3.5), K1–K25 (v1.3.6), L1–L19 (v1.3.7), **M1–M14 (v1.3.8)** and **M15–M19 (the v1.3.8
independent-review correction, `S1P-W2`–`S1P-W5`)**.

**Two prior conditions were RE-POINTED, not weakened, and both are recorded here out loud.**
`K14` reads the pre-live inventory section by heading and asserts the live row count exactly;
v1.3.8 renames that heading and the inventory genuinely grows from five rows to **six**, so
`K14` now reads `## 6. … after v1.3.8` and asserts `len(k14_live) == 6`. A row that quietly
appeared, or one that quietly lost its second signature, still fails it. `L6` reads an exact
sentence in `50 §2f`; v1.3.8 adds its own sentence **beside** that one rather than extending
it, so `L6`'s operand is byte-identical to v1.3.7's.

---

## 1. The nineteen v1.3.8 conditions, and the seeds that fail each

**A condition that has never failed is indistinguishable from one that cannot.** Every seed
below applies its mutation to the IN-MEMORY corpus only; nothing on disk is touched, and a
seeded run prints which edits it applied before it prints its result.

| Condition | What it asserts | Seeds that must fail it |
|---|---|---|
| **M1** | Signature verification is the trust boundary and its **order** is normative: verification over the exact raw bytes **before** any parse; a parsed-first body and a re-serialised-then-verified body are each declared never evidence; both headers required before parsing | `--seed-w-no-signature-check`, `--seed-w-reserialize-then-verify`, `--seed-w-parse-before-verify` |
| **M2** | The trust root is owner-controlled: **no** runtime fetch from the provider, **no** unsigned environment variable as authority, **no** key-discovery fallback on rotation, and an uncoordinated mismatch is **UNAVAILABLE rather than clean or zero** | `--seed-w-runtime-key-fetch`, `--seed-w-env-key-is-authority`, `--seed-w-rotation-without-release` |
| **M3** | The provider **event** identity is the ingest-deduplication operand; a redelivery creates no evidence and increments no count | `--seed-w-no-event-dedup`, `--seed-w-retry-increments-count` |
| **M4** | `I36`'s push-mode accepted count is **distinct provider MESSAGE identities** — never the event count, the callback count or the pre-deduplication count — and two distinct message identities under one correlation **FAIL immediately** | `--seed-w-count-is-event-count`, `--seed-w-two-messages-not-duplicate` |
| **M5** | A malformed event inside an authenticated batch makes the observation **INCOMPLETE/UNRESOLVED** and never lets the readable sibling become a trusted count of one | `--seed-w-malformed-silently-dropped` |
| **M6** | **Durable commit precedes acknowledgement**, in ADR-027's order and in `48 §8`'s enforcement list | `--seed-w-ack-before-durable-commit` |
| **M7** | The ingress receiver holds **no** provider send credential, **no** provider read credential and **no** vendor mutation capability of any kind | `--seed-w-receiver-holds-send-credential`, `--seed-w-receiver-has-send-client` |
| **M8** | A provider callback supplies **observations, never authority**: it cannot create an authorisation, enqueue, dispatch or re-dispatch an effect | `--seed-w-event-authorises-effect` |
| **M9** | `I8` under push evidence: an unaccounted authenticated event is a **positive finding immediately**, and a period with no such finding is **INCOMPLETE rather than clean** | `--seed-w-i8-ignores-unaccounted`, `--seed-w-clean-period-is-complete` |
| **M10** | **Absence is not zero** and the **retry horizon is not a visibility guarantee** | `--seed-w-zero-events-is-not-sent`, `--seed-w-retry-horizon-is-visibility` |
| **M11** | The SendGrid S1P prerequisite set **drops** the `email_activity.read` credential under the selected `SIGNED_PROVIDER_PUSH` mode, while the generic `PROVIDER_READ` mechanism is **retained as inactive** | `--seed-w-push-still-needs-activity-read` |
| **M12** | The webhook verification key is **not** class-5 credential material: class 28 owns it, `credential_risk_class` is undefined over it, and class 5 stays closed at seven fields | `--seed-w-key-is-class5-credential` |
| **M13** | Provider evidence is **data-minimised** and the correlation metadata carries **no personal data** | `--seed-w-persist-recipient-email`, `--seed-w-correlation-carries-pii` |
| **M14** | A synthetic provider **test** event is configuration evidence and **never** live provider-send evidence | `--seed-w-test-event-is-live-evidence` |
| **M15** | Class 28 is a **closed discriminated union over `evidence_mode`**: `PROVIDER_READ` exactly three fields, `SIGNED_PROVIDER_PUSH` exactly eight; the parser rejects missing, extra, push-on-read and missing-push fields; **no universal eight-field shape** is stated in `50` or ADR-027 (`S1P-W2`) | `--seed-w-read-accepts-push-field`, `--seed-w-push-omits-field`, `--seed-w-universal-eight-field-shape` |
| **M16** | The verification profile is **closed**: `SENDGRID_EVENT_WEBHOOK_V1` fixes both header names, `timestamp_octets ‖ raw_body_octets`, SHA-256, strict standard Base64, one DER `ECDSA-Sig-Value`, and forbids negotiation, request selection and fallback; ADR-027 step 5 agrees; **no generic `verification_algorithm` field survives** in `34`, `48` or `50` (`S1P-W3`) | `--seed-w-generic-ecdsa-algorithm`, `--seed-w-sha256-step-removed`, `--seed-w-concat-order-reversed`, `--seed-w-signature-base64-replaced`, `--seed-w-der-interpretation-removed`, `--seed-w-request-selects-algorithm` |
| **M17** | **One** canonical stored key representation — the exact provider-returned `public_key` string, strict standard Base64 of one DER P-256 `SubjectPublicKeyInfo` — and **no alternate encoding is ever tried** (`S1P-W3`) | `--seed-w-try-multiple-key-encodings` |
| **M18** | `key_identity` is **material-bound**: `lowercase_hex(SHA-256(verification_key_der_octets))` over exactly the octets the verifier consumes, recomputed with refusal on disagreement, never typed, re-derived on every key change (`S1P-W4`) | `--seed-w-key-identity-free-label`, `--seed-w-key-change-identity-unchanged`, `--seed-w-key-identity-wrong-representation` |
| **M19** | `ingress_identity` is a **canonical HTTPS URL mechanically compared** by the running receiver — refusal to start on a launch-echo mismatch, refusal of every request whose target differs — and `48 §8` G12 enforces it (`S1P-W5`) | `--seed-w-ingress-identity-friendly-label`, `--seed-w-receiver-serves-other-ingress` |

**Thirty-nine seeds, nineteen conditions, and every condition is failed by at least one seed** — the twenty-four webhook seeds of the first candidate, unweakened, plus fifteen for the independent-review correction.

**The fifteen correction seeds, mapped to the reviewer's required defects:**

| # | Required defect | Seed | Condition |
|---|---|---|---|
| 1 | `PROVIDER_READ` record contains a push-only field and is accepted | `--seed-w-read-accepts-push-field` | M15 |
| 2 | `SIGNED_PROVIDER_PUSH` omits a required push field | `--seed-w-push-omits-field` | M15 |
| 3 | parser treats class 28 as one universal eight-field shape | `--seed-w-universal-eight-field-shape` | M15 |
| 4 | generic `ECDSA` accepted instead of the closed SendGrid profile | `--seed-w-generic-ecdsa-algorithm` | M16 |
| 5 | SHA-256 step removed | `--seed-w-sha256-step-removed` | M16 |
| 6 | timestamp/payload concatenation order reversed | `--seed-w-concat-order-reversed` | M16 |
| 7 | signature Base64 decoding removed/replaced | `--seed-w-signature-base64-replaced` | M16 |
| 8 | ASN.1 DER interpretation removed | `--seed-w-der-interpretation-removed` | M16 |
| 9 | request selects the verification algorithm | `--seed-w-request-selects-algorithm` | M16 |
| 10 | runtime tries multiple key encodings until one works | `--seed-w-try-multiple-key-encodings` | M17 |
| 11 | `key_identity` becomes a free label | `--seed-w-key-identity-free-label` | M18 |
| 12 | changed verification key with unchanged `key_identity` passes | `--seed-w-key-change-identity-unchanged` | M18 |
| 13 | `key_identity` hashed over a representation the verifier does not consume | `--seed-w-key-identity-wrong-representation` | M18 |
| 14 | `ingress_identity` becomes a friendly label with no runtime binding | `--seed-w-ingress-identity-friendly-label` | M19 |
| 15 | receiver can run under an ingress other than the signed identity | `--seed-w-receiver-serves-other-ingress` | M19 |

---

## 2. The recorded seeded runs

Each line below was produced by the command shown. Every seed applies **all** of its edits —
the `(n/n edits applied)` figure is printed by the run itself — and fails exactly the
condition it targets, leaving the other 126 passing.

```
PYTHONUTF8=1 python consistency-v1.3.py                                     # 127 PASS / 0 FAIL

PYTHONUTF8=1 python consistency-v1.3.py --seed-w-no-signature-check             # 126/1 -> M1
PYTHONUTF8=1 python consistency-v1.3.py --seed-w-reserialize-then-verify        # 126/1 -> M1
PYTHONUTF8=1 python consistency-v1.3.py --seed-w-parse-before-verify            # 126/1 -> M1
PYTHONUTF8=1 python consistency-v1.3.py --seed-w-runtime-key-fetch              # 126/1 -> M2
PYTHONUTF8=1 python consistency-v1.3.py --seed-w-env-key-is-authority           # 126/1 -> M2
PYTHONUTF8=1 python consistency-v1.3.py --seed-w-rotation-without-release       # 126/1 -> M2
PYTHONUTF8=1 python consistency-v1.3.py --seed-w-no-event-dedup                 # 126/1 -> M3
PYTHONUTF8=1 python consistency-v1.3.py --seed-w-retry-increments-count         # 126/1 -> M3
PYTHONUTF8=1 python consistency-v1.3.py --seed-w-count-is-event-count           # 126/1 -> M4
PYTHONUTF8=1 python consistency-v1.3.py --seed-w-two-messages-not-duplicate     # 126/1 -> M4
PYTHONUTF8=1 python consistency-v1.3.py --seed-w-malformed-silently-dropped     # 126/1 -> M5
PYTHONUTF8=1 python consistency-v1.3.py --seed-w-ack-before-durable-commit      # 126/1 -> M6
PYTHONUTF8=1 python consistency-v1.3.py --seed-w-receiver-holds-send-credential # 126/1 -> M7
PYTHONUTF8=1 python consistency-v1.3.py --seed-w-receiver-has-send-client       # 126/1 -> M7
PYTHONUTF8=1 python consistency-v1.3.py --seed-w-event-authorises-effect        # 126/1 -> M8
PYTHONUTF8=1 python consistency-v1.3.py --seed-w-i8-ignores-unaccounted         # 126/1 -> M9
PYTHONUTF8=1 python consistency-v1.3.py --seed-w-clean-period-is-complete       # 126/1 -> M9
PYTHONUTF8=1 python consistency-v1.3.py --seed-w-zero-events-is-not-sent        # 126/1 -> M10
PYTHONUTF8=1 python consistency-v1.3.py --seed-w-retry-horizon-is-visibility    # 126/1 -> M10
PYTHONUTF8=1 python consistency-v1.3.py --seed-w-push-still-needs-activity-read # 126/1 -> M11
PYTHONUTF8=1 python consistency-v1.3.py --seed-w-key-is-class5-credential       # 126/1 -> M12
PYTHONUTF8=1 python consistency-v1.3.py --seed-w-persist-recipient-email        # 126/1 -> M13
PYTHONUTF8=1 python consistency-v1.3.py --seed-w-correlation-carries-pii        # 126/1 -> M13
PYTHONUTF8=1 python consistency-v1.3.py --seed-w-test-event-is-live-evidence    # 126/1 -> M14

PYTHONUTF8=1 python consistency-v1.3.py --seed-w-read-accepts-push-field          # 126/1 -> M15
PYTHONUTF8=1 python consistency-v1.3.py --seed-w-push-omits-field                 # 126/1 -> M15
PYTHONUTF8=1 python consistency-v1.3.py --seed-w-universal-eight-field-shape      # 126/1 -> M15
PYTHONUTF8=1 python consistency-v1.3.py --seed-w-generic-ecdsa-algorithm          # 126/1 -> M16
PYTHONUTF8=1 python consistency-v1.3.py --seed-w-sha256-step-removed              # 126/1 -> M16
PYTHONUTF8=1 python consistency-v1.3.py --seed-w-concat-order-reversed            # 126/1 -> M16
PYTHONUTF8=1 python consistency-v1.3.py --seed-w-signature-base64-replaced        # 126/1 -> M16
PYTHONUTF8=1 python consistency-v1.3.py --seed-w-der-interpretation-removed       # 126/1 -> M16
PYTHONUTF8=1 python consistency-v1.3.py --seed-w-request-selects-algorithm        # 126/1 -> M16
PYTHONUTF8=1 python consistency-v1.3.py --seed-w-try-multiple-key-encodings       # 126/1 -> M17
PYTHONUTF8=1 python consistency-v1.3.py --seed-w-key-identity-free-label          # 126/1 -> M18
PYTHONUTF8=1 python consistency-v1.3.py --seed-w-key-change-identity-unchanged    # 126/1 -> M18
PYTHONUTF8=1 python consistency-v1.3.py --seed-w-key-identity-wrong-representation # 126/1 -> M18
PYTHONUTF8=1 python consistency-v1.3.py --seed-w-ingress-identity-friendly-label  # 126/1 -> M19
PYTHONUTF8=1 python consistency-v1.3.py --seed-w-receiver-serves-other-ingress    # 126/1 -> M19
```

Recorded as `analysis/consistency-v1.3.8-output.txt` plus **thirty-nine**
`analysis/consistency-v1.3.8-negative-control-w-*-output.txt` files, one per seed.

**THE FULL v1.3.8 GATE: 116 SEEDS, 116 DISCRIMINATE, 0 NON-DISCRIMINATING** — the **77**
seeds inherited from v1.3–v1.3.7 (including the twenty-five v1.3.6 K seeds, the nineteen
v1.3.7 L seeds and the four H-coverage controls), the **24** webhook seeds, and the **15**
correction seeds. Every seed was run individually; each fails at least its announced target
condition and applies all of its edits. Every one of the 39 webhook and correction seeds fails
**exactly one** condition. The v1.3.7 gate, run against the untouched v1.3.7 package, still
returns **108 PASS / 0 FAIL** with **77/77** seeds discriminating.

---

## 3. What this gate does NOT prove

It is a **mechanical consistency pass over text**. It proves the architecture says the same
thing in every place it says anything, and that a plausible unsafe edit to any of those
places is caught.

**It proves nothing about an implementation**, because v1.3.8 implements nothing. In
particular it does not prove that a receiver verifies signatures correctly, that bytes are
not re-serialised, that commits precede acknowledgements, or that a dependency closure is
free of a send client. **Those are `VC-W1`–`VC-W13`'s obligations and they are undischarged.**
Nor does it prove that a class-28 parser is closed per variant, that a verifier implements
`SENDGRID_EVENT_WEBHOOK_V1` exactly, that `key_identity` is recomputed, or that a receiver
compares itself to `ingress_identity`: M15–M19 prove only that the architecture REQUIRES each,
consistently, and that weakening any of those requirements is caught.

It also proves nothing empirical about the provider: **no completeness or visibility bound is
established by this package**, the webhook has not been created, no key has been captured, no
event has ever been received, and `I36`'s verification leg, `I20` and `I8` all remain OPEN.
