import type { DispatchEnvelope } from '../../src/kernel/gateway/adapterPort.js';

/**
 * TEST-ONLY. THREE DEFECTIVE ENVELOPE DESIGNS — `§40` ITEMS 4, 5 AND 6.
 *
 * =================================================================================
 * CONTROL A — THE PAYLOAD REBUILT FROM LIVE STATE (`§10`, `§40` item 4)
 *
 * `§10`: "Do not: reconstruct from current resource state; re-run enumeration; query
 * current order state to rebuild it; [...] run constructor again to produce possibly
 * different dispatch bytes."
 *
 * `unsafeReconstructedEnvelope` replaces the persisted snapshot with bytes the CONSTRUCTOR
 * produced again, at dispatch time, from whatever the commerce projection says now. The
 * test hands it the output of the fixture's own `reconstructRefundPayload`, which re-runs
 * step C′ for real — so the substituted bytes are well-formed, canonical, hash-consistent
 * with themselves and internally correct. They are simply bytes for a DIFFERENT REQUEST
 * than the one the owner's authority covered.
 *
 * WHAT IT COSTS. `26 §1` Corollary 3: "the request must be built by the ceiling's enforcer,
 * not by its subject", and the enforcement instant was authorisation time. `24 §3` K4
 * hashes the `AuthorizationRequest` and the `dispatch_payload` TOGETHER, and `I18a`/`I18b`
 * bind the reservation to the amount in those exact bytes. A payload rebuilt at dispatch
 * time from state that moved is a request whose amount no reservation covers, dispatched
 * under an authorisation that priced something else — with every invariant reading as
 * satisfied, because each was checked against a payload that no longer exists.
 *
 * `35 §12.3`'s crash case makes it worse rather than better: the reconstruction happens on
 * the recovery path, so the divergence appears exactly when nobody is watching.
 *
 * PRODUCTION CANNOT DO THIS. `dispatchEnvelope.ts` imports no constructor, no enumeration
 * port and no commerce reader, and `0010`'s `dispatch_outbox_payload_binds_hash` means the
 * only bytes on the row are bytes that hash to the committed authorised hash.
 * =================================================================================
 *
 * =================================================================================
 * CONTROL B — THE CORRELATION TAG DROPPED (`§11`, `§40` item 5)
 *
 * `25 §7` / ADR-026 item 1: one outbox row per intended message, "carrying a
 * **provider-visible correlation tag** (custom header, metadata or tag)".
 *
 * `unsafeMapperDroppingCorrelationTag` builds an envelope with the tag blanked — the shape
 * of an adapter-side request mapper that forgot to map one field.
 *
 * WHAT IT COSTS. `35 §12.3`: `PRESUMED_EXECUTED` is resolved to `VERIFIED` or `NEVER_SENT`
 * by "the provider's delivery event — **matched on the correlation tag**". Without the tag
 * there is no match, so the effect is stuck in a presumption forever: `I9` fires and cannot
 * be satisfied, `I20` has nothing to join provider-accepted counts to, and `25 §10`'s "the
 * missed message is recovered by **detection rather than by retry**" loses its detector —
 * which leaves retry as the only remaining option and retry is the duplicate.
 * =================================================================================
 *
 * =================================================================================
 * CONTROL C — THE `DISPATCHED_UNMIRRORED` REQUIREMENT DROPPED (`§12`, `§40` item 6)
 *
 * `30 §5.7.2` item 5: "Every dispatch under it is tagged `DISPATCHED_UNMIRRORED` and
 * carries `override_id`." `36 §6`: in `CORROBORATED_DEGRADED`, "every dispatch tagged".
 *
 * `unsafeMapperDroppingUnmirroredTag` clears `requiresUnmirroredTag` and `overrideId` on the
 * way to the adapter.
 *
 * WHAT IT COSTS. `I17f(c)` is an AUDIT-PLANE INVARIANT: "Every effect whose dispatch
 * timestamp falls inside an audit-plane-published `MIRROR_INPUT_STALL` interval carries
 * `DISPATCHED_UNMIRRORED` on its mirrored row", and its consequence column reads "the
 * control plane dispatched under degradation without marking it" — a CRITICAL incident. A
 * mapper that drops the tag makes the control plane's own record say the dispatch happened
 * in `NORMAL`, and `30 §5.5`'s honest note applies: rows describing anything with no vendor
 * counterpart — "and the `DISPATCHED_UNMIRRORED` tags themselves — have no detector at all".
 *
 * PRODUCTION REFUSES AT THE DATABASE. `0012`'s
 * `dispatch_outcome_unmirrored_tag_not_suppressed` CHECK requires the outcome row's
 * `unmirrored_tag_sent` to equal the claim's requirement, and
 * `dispatch_outcome_agrees_with_claim` re-reads the claim to compare. Neither is a code
 * path a mapper can skip.
 * =================================================================================
 */

/** CONTROL A. The persisted snapshot swapped for freshly reconstructed bytes. */
export function unsafeReconstructedEnvelope(
  envelope: DispatchEnvelope,
  reconstructedBytes: Buffer,
): DispatchEnvelope {
  return {
    ...envelope,
    payloadCanonicalBytes: reconstructedBytes,
  } as unknown as DispatchEnvelope;
}

/** CONTROL B. The tag is blanked on the way across the port. */
export function unsafeMapperDroppingCorrelationTag(
  envelope: DispatchEnvelope,
): DispatchEnvelope {
  return {
    ...envelope,
    payloadCanonicalBytes: envelope.payloadCanonicalBytes,
    correlationTag: '',
  } as unknown as DispatchEnvelope;
}

/** CONTROL C. The degraded-state requirement is cleared on the way across the port. */
export function unsafeMapperDroppingUnmirroredTag(
  envelope: DispatchEnvelope,
): DispatchEnvelope {
  return {
    ...envelope,
    payloadCanonicalBytes: envelope.payloadCanonicalBytes,
    requiresUnmirroredTag: false,
    overrideId: null,
  } as unknown as DispatchEnvelope;
}
