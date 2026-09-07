import { denyAuthority } from './errors.js';

/**
 * Step P — "Channel set?"
 *
 * `26 §7`'s flowchart, verbatim:
 *
 *   N -->|yes| P{Channel set?}
 *   P -->|yes| Q[Utterance policy evaluation §9]
 *   Q -->|fail| D12[DENY or ESCALATE]
 *   Q -->|pass| R
 *   P -->|no| RV{Resume of a held approval?}
 *
 * ---------------------------------------------------------------------------------
 * S1E FAILS THIS BRANCH CLOSED RATHER THAN SKIPPING IT
 *
 * `26 §9` is the utterance model: tiers, the prohibited-commitment grammar, T-U1's twelve
 * conditions, rendering, abstention, communication exposure as a budget and the outbox.
 * `37 §2` places it in S4 and S1E implements none of it.
 *
 * The dangerous shape would be to notice that `refund.create` sets `channel = null` and
 * therefore not write this gate at all. That is a gate whose correctness rests on a fixture:
 * the day a channel-bearing class is registered, the sequence would run straight past `§9` to
 * step R with nothing having evaluated the utterance, and no test would fail.
 *
 * So the gate exists, it is evaluated on every proposal, and a non-null channel DENIES —
 * `26 §7`'s D12 terminal — because "the utterance policy has not been deployed" is not a
 * reason to send. The alternative reading, "no utterance policy therefore no utterance
 * restrictions", is `26 §7`'s fail-closed rule read backwards.
 *
 * ---------------------------------------------------------------------------------
 * STEP RV IS STRUCTURALLY "NO" IN S1E
 *
 * `RV{Resume of a held approval?}` is answered by whether an `Approval` in `RESUMING` exists
 * for this proposal. S1E has no approval object, no approval table and no resume entry point,
 * so the answer is "no" by construction rather than by a check — and the R′ path, its
 * `RESERVATION_ABSENT`, `EXPOSURE_EXCEEDS_RESERVATION` and `CONSTRUCTOR_SEMANTIC_CHANGE`
 * denials, and `I51`/`I58`/`I60` remain entirely open. VC-C4 is untouched by S1E.
 * ---------------------------------------------------------------------------------
 */
export function evaluateChannel(channel: string | null): void {
  if (channel !== null) {
    denyAuthority(
      'P',
      'UTTERANCE',
      'UTTERANCE_POLICY_NOT_IMPLEMENTED',
      `the request carries channel ${channel} and 26 §9's utterance policy is not deployed`,
    );
  }
}
