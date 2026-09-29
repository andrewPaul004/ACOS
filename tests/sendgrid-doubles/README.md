# `tests/sendgrid-doubles/` — the OFFLINE doubles the S1P scenario driver is exercised against

`§11` of the S1P correction mandate: the six-scenario kill-point driver "must compile and be
fully exercised against deterministic offline doubles **without making real provider calls**."

This directory is those doubles. Each module is the SAME SHAPE the live package presents — a
named `integrationAdapter` export the accepted S1N host admits, a named `auditProviderReader`
export the accepted S1O host admits — so the driver constructs the same descriptors, forks the
same accepted runtimes, and exercises the same gateway. **The only thing that differs is the
module specifier the descriptor names.**

## What is REAL here, and what is simulated

REAL, imported from `validation/sendgrid/`:

* the CLOSED dispatch-payload decoder and its refusals (`validationPayload.ts`);
* the v3 Mail Send body construction and its sandbox refusal (`requestMapping.ts`);
* both credential sources, unchanged, resolving `FILE_FIXTURE` material.

SIMULATED, and only this:

* the transport. `simulatedAccount.ts` is a file-backed Email Activity store shared by the
  send side and the read side, and it is reached by a filesystem write rather than by
  `globalThis.fetch`. **There is no `fetch` anywhere in this directory**, which is why these
  modules are not perimeter sites and why `tools/perimeter/` does not scan this root.

## Why the doubles carry the REAL payload binding

A double that accepted any payload would prove that the driver runs; it would not prove that
the driver runs the CORRECTED adapter. So the double parses `invocation.dispatchPayloadBytes`
through the production decoder and refuses exactly what the real adapter refuses — a wrong
action class, a wrong method, an unknown vendor parameter, a sink that is not owner-controlled
— and the offline suite drives those refusals directly.

## The secret sources are one-line re-exports, and that is deliberate

`§11`'s confinement rule requires both module specifiers to resolve inside the descriptor's
declared `runtimeRoot`. Re-exporting the production factory from inside this root satisfies it
without weakening the root to something that would admit an arbitrary module — and it means
the offline run resolves its credential through the SAME source the live run would, including
correction 3's mechanism-assigned provenance.
