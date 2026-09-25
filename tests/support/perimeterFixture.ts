import { createHash, randomUUID } from 'node:crypto';

import type { DispatchEnvelope } from '../../src/kernel/gateway/adapterPort.js';
import type { Recoverability } from '../../src/kernel/canonicalisation/actionClasses.js';

/**
 * A HAND-BUILT `DispatchEnvelope`, FOR THE PERIMETER TESTS THAT NEED NO DATABASE.
 *
 * =================================================================================
 * WHY A HAND-BUILT ENVELOPE IS LEGITIMATE HERE AND NOWHERE ELSE
 *
 * `buildDispatchEnvelope` is the production producer and it reads every field from ONE
 * committed outbox row; that is the property `dispatch-envelope.test.ts` proves and this
 * fixture does not touch it.
 *
 * What the perimeter tests measure is a DIFFERENT boundary: given an envelope, what crosses
 * the process boundary, what the runtime does with it, and what comes back. Those questions
 * are independent of where the envelope came from, and driving them through a full
 * authorise/enqueue/claim cycle would make every one of them depend on the whole S1F–S1I
 * stack for no added assurance.
 *
 * THE END-TO-END PROPERTIES ARE PROVED SEPARATELY AND WITH THE REAL PRODUCER.
 * `gateway-integration.test.ts` runs the real Effect Gateway against real PostgreSQL with a
 * real claim, and every assertion about the claim, the lease, the journal and the ledger
 * lives there rather than here.
 * =================================================================================
 */

export interface SyntheticEnvelopeOverrides {
  readonly adapter?: string;
  readonly method?: string;
  readonly actionClass?: string;
  readonly recoverability?: Recoverability;
  readonly authorisationId?: string;
  readonly effectId?: string;
  readonly payload?: Buffer;
  readonly requiresUnmirroredTag?: boolean;
  readonly overrideId?: string | null;
}

/** One frozen envelope whose payload hash is the real `sha256` `enqueue.ts` computes. */
export function syntheticEnvelope(overrides: SyntheticEnvelopeOverrides = {}): DispatchEnvelope {
  const suffix = randomUUID();
  const payload = overrides.payload ?? Buffer.from(`{"synthetic":"${suffix}"}`, 'utf8');
  const snapshot = Uint8Array.from(payload);
  return Object.freeze({
    companyId: 'company:s1n',
    outboxId: `outbox:${suffix}`,
    claimId: `claim:${suffix}`,
    effectId: overrides.effectId ?? `effect:${suffix}`,
    authorisationId: overrides.authorisationId ?? `authorisation:${suffix}`,
    idempotencyKey: `idem:${suffix}`,
    actionClass: overrides.actionClass ?? 'campaign.pause',
    resourceRef: 'campaign:CMP-S1N',
    recoverability: overrides.recoverability ?? 'REVERSIBLE',
    adapter: overrides.adapter ?? 'mock_ads',
    method: overrides.method ?? 'campaignPause',
    dispatchPayloadHash: createHash('sha256').update(payload).digest('hex'),
    get payloadCanonicalBytes(): Buffer {
      return Buffer.from(snapshot);
    },
    correlationTag: `tag:${suffix}`,
    requiresUnmirroredTag: overrides.requiresUnmirroredTag ?? false,
    overrideId: overrides.overrideId ?? null,
  }) as DispatchEnvelope;
}

/**
 * `§29`'s leak-scan serialiser. TOTAL over every value the surfaces actually carry.
 *
 * `JSON.stringify` throws on a `bigint`, and the control plane's rows are full of them —
 * `journal_seq`, `chain_seq`, the MIE unit counts. A leak scan that threw on the first
 * such row would be a scan that never reached the columns it was written to inspect, and
 * a scan that skipped them would be a scan with a blind spot exactly where the outcome
 * evidence lives.
 *
 * So bigints are rendered as their decimal text and everything else is left to
 * `JSON.stringify`. A sentinel is an ASCII string, so nothing about this rendering could
 * hide one.
 */
export function stringifyForLeakScan(value: unknown): string {
  return JSON.stringify(value, (_key, member: unknown) =>
    typeof member === 'bigint' ? member.toString() : member,
  );
}
