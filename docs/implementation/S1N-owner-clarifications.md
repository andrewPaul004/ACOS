# S1N — owner clarifications

Questions this slice could not answer from v1.3.6 alone, each with what was done and what a
ruling would change.

---

## S1N-C1 — `money-moving credential` has no mechanised definition

**The gap.** ADR-024 makes the option-B trigger *"the first money-moving credential or the
third adapter, whichever comes first."* `23 §11`, `29 §3.2`, `31 §12`, `33 §7` and `37 §5`
repeat the phrase. **No deliverable in v1.3.6 says how a build would decide it.**

**What was done.** `§36` of the mandate forbids inferring it from a name and directs the
derivation to the closed signed action catalogue. Two signed `50 §2a` fields are candidates:

| field | what `50 §2a`/`I18a`/`26 §11` say it means |
|---|---|
| 4 — `carries_vendor_monetary_field` | *"where the dispatched vendor request carries a monetary field"* — a statement about what the CREDENTIAL presents to the vendor |
| 3 — `value_direction` | where VALUE ends up — `OUTBOUND_GOODS_TO_ADDRESS` moves goods, `OUTBOUND_TO_COUNTERPARTY` covers a budget instruction that transfers nothing |

**`MONEY_MOVING` is bound to field 4**, because its own definition is a statement about the
vendor request the credential signs.

**Why not the broader reading.** Applied to the verified S1 catalogue, "field 4 OR
`value_direction ≠ NONE`" makes all three adapter identities money-moving, so option A would
admit **no adapter at all**. That contradicts ADR-024's own *"with two adapters and no
money, a broker adds a TCB member and delivers nothing"* and `23 §11`'s four-adapter MVP. A
reading of a trigger under which its own decision is unreachable is not the intended reading.

`movesValueUnderBroadReading()` computes the alternative and is asserted in the negative-
control suite; **nothing refuses on its basis.**

**What a ruling would change.** If the owner rules that value movement rather than a vendor
monetary field is the criterion, one function changes and option A admits nothing until
option B exists. If the owner rules that field 4 is correct, this clarification closes and
the derivation becomes a transcription.

**Not a PARTIAL trigger.** `§36` says to return PARTIAL *"only if S1N must exercise it"*.
S1N does exercise the trigger, and both halves refuse: the third-adapter half is exactly
stated and needs no derivation, and the money-moving half refuses `mock_processor` today
under either reading.

---

## S1N-C2 — v1.3.6 declares no IPC authentication for the Z1→Z2 edge

**The gap.** `23 §7`'s zone diagram draws `Z1 -->|authorised effects| Z2` and says nothing
about how Z2 knows the sender. `48` governs what reaches Z5. `29 §3` governs credentials. No
deliverable specifies a mechanism for the edge itself.

**What was done.** `§39` anticipates exactly this: *"If architecture has no explicit IPC
authentication because same-host process spawning + private pipe is the trust mechanism,
document and test that boundary. Do not invent network JWT infrastructure."*

So the trust mechanism is the OS's: an anonymous pipe the parent creates at `fork`, inherited
by exactly one child, addressable by no name. There is no token to steal because there is no
token, and no endpoint to reach because there is no endpoint. The runtime opens **no** TCP
port, **no** HTTP listener and **no** named socket, and `process.on('message')` on the
inherited descriptor is its entire inbound surface.

**What a ruling would change.** If the architecture later places the integration plane on a
separate host, the pipe is gone and a real authentication mechanism has to be declared. That
is a change to `23 §7`, not to this code.

---

## S1N-C3 — `37 §2` sequences `I24`/`I25` at S2 and the adapters at S3

**The gap.** This repository is at S1. `37 §2`'s S2 Build list carries *"the external-write
perimeter artifact (`48`) and its CI check (I24)"*, and the four adapters are S3 or the later
adapter slice. S1M cited this in its own PARTIAL (`§6`).

**What was done.** S1N pulls the **mechanism** forward and no provider at all, because S1M's
PARTIAL identified the mechanism's absence as the blocker for the provider work. This is the
same shape as `37 §2`'s own SEQ-01, SEQ-02 and SEQ-03 arguments: *"the mechanism is a
precondition for safely enabling any real external dispatch."*

**Nothing is claimed to be complete.** `I24`'s CI leg now exists and finds zero production
sites, because there are none. `I25` now has a process it can be true of. Neither invariant
is reported as satisfied for a real adapter, because there is no real adapter.

**What a ruling would change.** If the owner prefers the mechanism to wait for S2, S1N should
be held rather than reworked: the code is additive and the registries are empty.

---

## S1N-C4 — one accepted assertion was amended, deliberately

`no-real-transport-boundary.test.ts`'s *"`src/` contains NO `ExternalEffectAdapter`
implementation at all"* is now *"the ONLY `ExternalEffectAdapter` in `src/` is the
credential-free transport proxy"*, with a one-file allowlist, a fifth detection pattern and
twenty narrowing assertions on the permitted file.

The accepted test's own sibling comment anticipated this: *"a future slice that adds one has
to change this assertion out loud."* `S1N-implementation-log.md §2` records that the proxy
initially slipped past all four of the original patterns and that this was not accepted as a
pass.

**Flagged for the owner** because amending an accepted boundary assertion is exactly the kind
of change `45 §3` warns about when it is done quietly. It is not quiet.
