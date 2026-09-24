import {
  actionCatalogueEntry,
  isActionClass,
  type ActionClass,
  type Recoverability,
} from '../canonicalisation/actionCatalogue.js';
import type { VerifiedControlArtifactBundle } from '../controlArtifacts/bundle.js';
import type { OutboxRow } from '../outbox/outboxState.js';
import type { DispatchEnvelope } from './adapterPort.js';
import type { DispatchIdentity } from './dispatchCapability.js';

/**
 * BUILDING THE DISPATCH ENVELOPE FROM COMMITTED STATE, AND FROM NOTHING ELSE.
 *
 * =================================================================================
 * `§10` OF THE S1J MANDATE, AND `25 §7`'s REASON FOR IT
 *
 * "The adapter receives the exact payload snapshot persisted by S1I. Do not: reconstruct
 *  from current resource state; re-run enumeration; query current order state to rebuild
 *  it; use model rationale; run constructor again to produce possibly different dispatch
 *  bytes."
 *
 * `25 §7` on why the identity must survive the gap: "The effect key is deterministic, not
 * random. This is the whole point. A crash between journaling and adapter invocation,
 * followed by a restart, must regenerate the *same* key". The payload has the same
 * requirement for the same reason, and S1I solved it by PERSISTING the bytes rather than
 * by promising to recompute them: `0010`'s `dispatch_outbox_payload_binds_hash` makes the
 * database refuse a row whose `payload_canonical_bytes` do not hash to the committed
 * authorised `dispatch_payload_hash`.
 *
 * SO THIS FILE READS ONE ROW AND COPIES. It imports no constructor, no canonicaliser, no
 * enumeration port, no commerce-state reader and no clock. `no-real-transport-boundary.
 * test.ts` asserts the gateway directory's import list against a hand-authored set, and
 * `dispatch-envelope.test.ts` mutates the underlying business state between authorisation
 * and dispatch and asserts the adapter receives the ORIGINAL bytes.
 * =================================================================================
 *
 * =================================================================================
 * THE ONE THING READ FROM THE CATALOGUE RATHER THAN THE ROW, AND WHY
 *
 * `method`. `24 §3` K4's dispatch payload is emitted by the canonicaliser with the vendor
 * method inside it, and `dispatch_outbox` carries no `method` column — deliberately, per
 * `0010`: "There is deliberately NO structured payload field [...] A second representation
 * is a second thing to disagree with the hash."
 *
 * So `method` comes from the VERIFIED class-3 catalogue entry, the same closed source that
 * assigned `adapter` in the first place, and `assertCatalogueAgreement` refuses to build
 * an envelope whose row disagrees with the catalogue about `adapter` or `recoverability`.
 * A disagreement would mean the catalogue changed under a committed effect, which is an
 * `SR7` control-artifact question and not something to paper over at dispatch time.
 * =================================================================================
 */

export const ENVELOPE_REFUSALS = [
  /** The committed row names a class the closed catalogue does not (`SR7`, ADR-006). */
  'ACTION_CLASS_NOT_IN_CATALOGUE',
  /**
   * The committed row and the closed catalogue disagree about the class's execution
   * metadata or its recoverability.
   *
   * FAIL CLOSED, LOUDLY. `26 §5` makes both catalogue-assigned, and `0010`'s composite
   * foreign key makes the row's copies key-bound to the committed effect. A divergence
   * therefore means the CATALOGUE moved after the effect was authorised — a control-artifact
   * event (`50 §2` class 18) — and dispatching either value would be choosing which
   * authority to believe.
   */
  'CATALOGUE_DIVERGED_FROM_COMMITTED_EFFECT',
  /**
   * The row is not `CLAIMED`, or its claim columns are absent.
   *
   * Unreachable through the gateway, which builds an envelope only from the row its own
   * claim just returned. Kept as a refusal rather than an assumption because this function
   * is exported and takes a row.
   */
  'ROW_NOT_CLAIMED',
] as const;

export type EnvelopeRefusal = (typeof ENVELOPE_REFUSALS)[number];

export type EnvelopeBuild =
  | {
      readonly kind: 'BUILT';
      readonly envelope: DispatchEnvelope;
      readonly identity: DispatchIdentity;
    }
  | { readonly kind: 'REFUSED'; readonly reason: EnvelopeRefusal; readonly detail: string };

const RECOVERABILITIES: readonly string[] = ['REVERSIBLE', 'COMPENSABLE', 'IRRECOVERABLE'];

/**
 * Build the frozen envelope for one claimed row.
 *
 * =================================================================================
 * `payloadCanonicalBytes` IS A GETTER THAT COPIES — `§32`.
 *
 * "The mock adapter must receive a read-only/frozen dispatch envelope. Required alias
 *  attack: adapter implementation attempts to mutate payload bytes; correlation tag;
 *  effect identity; recoverability; unmirrored tag; clock evidence; override evidence. It
 *  must not be able to alter persisted authority or the request another adapter would
 *  see. No mutable alias to the outbox row."
 *
 * `Object.freeze` stops assignment to the envelope's own properties, which covers every
 * scalar — tag, identity, recoverability, requirement, override. It does NOT stop element
 * writes into a `Buffer`, because a `Buffer` is a view over an `ArrayBuffer` and freezing
 * the wrapper does not freeze the memory. So the bytes are held as a PRIVATE SNAPSHOT in
 * this function's closure and every read returns a NEW copy: an adapter that writes into
 * what it received has written into garbage, and the next reader sees the snapshot.
 *
 * The snapshot is itself a copy of the row's buffer, so the envelope holds no alias to
 * whatever the caller's `pg` result rows hold either.
 * =================================================================================
 */
export function buildDispatchEnvelope(
  row: OutboxRow,
  bundle: VerifiedControlArtifactBundle,
): EnvelopeBuild {
  if (row.status !== 'CLAIMED' || row.claimId === null) {
    return {
      kind: 'REFUSED',
      reason: 'ROW_NOT_CLAIMED',
      detail:
        `outbox row ${row.outboxId} is ${row.status} and carries claim ` +
        `${String(row.claimId)}; only a committed claim can produce a dispatch envelope ` +
        '(25 §7, 30 §5.1 item 3)',
    };
  }
  if (!isActionClass(row.actionClass)) {
    return {
      kind: 'REFUSED',
      reason: 'ACTION_CLASS_NOT_IN_CATALOGUE',
      detail: `action class "${row.actionClass}" is not a member of the closed catalogue`,
    };
  }
  const actionClass: ActionClass = row.actionClass;
  const entry = actionCatalogueEntry(actionClass, bundle);
  if (entry.adapter !== row.adapter || entry.recoverability !== row.recoverability) {
    return {
      kind: 'REFUSED',
      reason: 'CATALOGUE_DIVERGED_FROM_COMMITTED_EFFECT',
      detail:
        `the committed effect for ${actionClass} carries adapter "${row.adapter}" and ` +
        `recoverability "${row.recoverability}"; the closed catalogue now says ` +
        `"${entry.adapter}" and "${entry.recoverability}" (26 §5, SR7)`,
    };
  }
  if (!RECOVERABILITIES.includes(row.recoverability)) {
    return {
      kind: 'REFUSED',
      reason: 'CATALOGUE_DIVERGED_FROM_COMMITTED_EFFECT',
      detail: `recoverability "${row.recoverability}" is not a declared class (26 §5)`,
    };
  }
  const recoverability = row.recoverability as Recoverability;

  // The private snapshot. Copied out of the row, so no alias survives into the envelope.
  const snapshot = Uint8Array.from(row.payloadCanonicalBytes);

  const envelope: DispatchEnvelope = Object.freeze({
    companyId: row.companyId,
    outboxId: row.outboxId,
    claimId: row.claimId,
    effectId: row.effectId,
    authorisationId: row.authorisationId,
    idempotencyKey: row.idempotencyKey,
    actionClass,
    resourceRef: row.resourceRef,
    recoverability,
    adapter: row.adapter,
    method: entry.method,
    dispatchPayloadHash: row.dispatchPayloadHash,
    // A fresh copy per access. See the block comment above.
    get payloadCanonicalBytes(): Buffer {
      return Buffer.from(snapshot);
    },
    correlationTag: row.correlationTag,
    // `30 §5.7.2` item 5's REQUIREMENT, as the claim recorded it. `claim_requires_
    // unmirrored_tag` is NOT NULL on a CLAIMED row (`0010`), so the `?? false` below is
    // narrowing for the type checker and not a default: a NULL here would be a claimed row
    // that omitted the requirement, which the schema does not admit.
    requiresUnmirroredTag: row.claimRequiresUnmirroredTag ?? false,
    overrideId: row.claimOverrideId,
  });

  return {
    kind: 'BUILT',
    envelope,
    identity: Object.freeze({
      companyId: row.companyId,
      idempotencyKey: row.idempotencyKey,
      outboxId: row.outboxId,
      effectId: row.effectId,
      claimId: row.claimId,
    }),
  };
}
