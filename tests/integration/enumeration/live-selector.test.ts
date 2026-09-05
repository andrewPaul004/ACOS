import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { CanonicalisationDenied } from '../../../src/kernel/canonicalisation/errors.js';
import { parseProposedIntent } from '../../../src/kernel/canonicalisation/intent.js';
import { maxAgeSecondsFor } from '../../../src/kernel/enumeration/enumerationMaxAge.js';
import { projectDenialToWorker } from '../../../src/kernel/enumeration/workerFacingDenial.js';
import { createHarness, type Harness } from '../../support/fixture.js';
import {
  CAN03,
  OTHER_ORDER,
  entityKeyFor,
  kernelContext,
  loadCommerceFixture,
  makeEnumerationHarness,
  makeSpec,
  rawIntent,
  type EnumerationHarness,
} from '../../support/enumerationFixture.js';

/**
 * Step C′'s remaining denials, and the lineage it records.
 *
 * `26 §7`'s C′ row, verbatim: "`SELECTOR_ENUMERATION_STALE` if `enumeration_id.computed_at`
 * exceeds the class's `max_age`".
 *
 * `26 §2.1`: the request records `enumeration_ref` — "the enumeration_id and its
 * `computed_at`, for lineage" — and `constructor_version`, "the ConstructorVersionRecord
 * that produced every computed field (I61)".
 *
 * Every instant below comes from the INJECTED clock. Nothing sleeps.
 */

let harness: Harness;
let kernel: EnumerationHarness;

beforeAll(async () => {
  harness = await createHarness();
});

afterAll(async () => {
  await harness.close();
});

beforeEach(async () => {
  await harness.reset();
  const client = await harness.connect();
  try {
    await loadCommerceFixture(client);
  } finally {
    client.release();
  }
  kernel = makeEnumerationHarness(harness);
});

const KEY = entityKeyFor(CAN03.orderId);

async function enumerateCan03(): Promise<{ enumerationId: string; optionIdA: string }> {
  return kernel.leases.withEntityLease(KEY, async (lease) => {
    const outcome = await kernel.enumerator.enumerate(lease, {
      actionClass: 'refund.create',
      resourceRef: CAN03.resourceRef,
      spec: makeSpec(),
    });
    return {
      enumerationId: outcome.set.enumerationId,
      optionIdA: outcome.set.options[0]!.optionId,
    };
  });
}

describe('6 — enumeration age denies SELECTOR_ENUMERATION_STALE', () => {
  it('one second past the class max_age denies, with the clock injected', async () => {
    const { enumerationId, optionIdA } = await enumerateCan03();
    const intent = parseProposedIntent(rawIntent({ enumerationId, optionId: optionIdA }));

    // S1C-C4: 120 seconds, declared as an implementation fixture, not an architecture claim.
    kernel.clock.advanceSeconds(maxAgeSecondsFor('refund.create') + 1);

    const error = await kernel.leases
      .withEntityLease(KEY, (lease) =>
        kernel.liveSelector.canonicaliseUnderLease(lease, intent, makeSpec(), kernelContext()),
      )
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(CanonicalisationDenied);
    expect((error as CanonicalisationDenied).code).toBe('SELECTOR_ENUMERATION_STALE');
    expect((error as CanonicalisationDenied).detail).toBe('ENUMERATION_PAST_MAX_AGE');
  });

  it('exactly AT the max_age still permits — the boundary is `>`, not `>=`', async () => {
    // The discriminating control. Without it the staleness test would pass against an
    // implementation that denies every enumeration older than zero.
    const { enumerationId, optionIdA } = await enumerateCan03();
    const intent = parseProposedIntent(rawIntent({ enumerationId, optionId: optionIdA }));

    kernel.clock.advanceSeconds(maxAgeSecondsFor('refund.create'));

    const effect = await kernel.leases.withEntityLease(KEY, (lease) =>
      kernel.liveSelector.canonicaliseUnderLease(lease, intent, makeSpec(), kernelContext()),
    );
    expect(effect.request.selectedOption.optionId).toBe(optionIdA);
  });

  it('the enumeration is NOT silently reissued — no new record appears', async () => {
    // The mandate: "Do not silently reissue the enumeration." A kernel that refreshed the
    // timestamp under the model would let it hold one stale reading of the world forever.
    const { enumerationId, optionIdA } = await enumerateCan03();
    const intent = parseProposedIntent(rawIntent({ enumerationId, optionId: optionIdA }));
    kernel.clock.advanceSeconds(maxAgeSecondsFor('refund.create') + 1);

    await kernel.leases
      .withEntityLease(KEY, (lease) =>
        kernel.liveSelector.canonicaliseUnderLease(lease, intent, makeSpec(), kernelContext()),
      )
      .catch(() => undefined);

    const client = await harness.connect();
    try {
      const rows = await client.query<{ count: string }>(
        'SELECT count(*)::text AS count FROM enumeration_record',
      );
      expect(rows.rows[0]!.count).toBe('1');
      const stored = await client.query<{ computed_at: Date }>(
        'SELECT computed_at FROM enumeration_record WHERE enumeration_id = $1',
        [enumerationId],
      );
      // The recorded instant is unchanged: the kernel did not move it forward.
      expect(stored.rows[0]!.computed_at.toISOString()).toBe('2026-09-05T10:00:00.000Z');
    } finally {
      client.release();
    }
  });

  it('a successful C′ does NOT write a second enumeration record either', async () => {
    // `reEnumerate` must not mint a new `enumeration_id`: the selector names the enumeration
    // the model actually read.
    const { enumerationId, optionIdA } = await enumerateCan03();
    const intent = parseProposedIntent(rawIntent({ enumerationId, optionId: optionIdA }));
    await kernel.leases.withEntityLease(KEY, (lease) =>
      kernel.liveSelector.canonicaliseUnderLease(lease, intent, makeSpec(), kernelContext()),
    );
    const client = await harness.connect();
    try {
      const rows = await client.query<{ count: string }>(
        'SELECT count(*)::text AS count FROM enumeration_record',
      );
      expect(rows.rows[0]!.count).toBe('1');
    } finally {
      client.release();
    }
  });
});

describe('the enumeration_id half of the pair carries information', () => {
  it('an enumeration_id the kernel never computed denies', async () => {
    const { optionIdA } = await enumerateCan03();
    const intent = parseProposedIntent(
      rawIntent({ enumerationId: 'enum:fabricated', optionId: optionIdA }),
    );
    const error = await kernel.leases
      .withEntityLease(KEY, (lease) =>
        kernel.liveSelector.canonicaliseUnderLease(lease, intent, makeSpec(), kernelContext()),
      )
      .catch((caught: unknown) => caught);
    expect((error as CanonicalisationDenied).detail).toBe('ENUMERATION_UNKNOWN');
    // Coarse at the worker, like every other selector failure.
    expect(projectDenialToWorker(error as CanonicalisationDenied)).toEqual({ deny: 'SELECTOR' });
  });

  it('an enumeration taken against ANOTHER resource cannot be paired with this option', async () => {
    // Without the binding checks the `enumeration_id` would carry no information and the
    // pair would be exactly as strong as the `option_id` alone.
    const other = await kernel.leases.withEntityLease(entityKeyFor(OTHER_ORDER.orderId), (lease) =>
      kernel.enumerator.enumerate(lease, {
        actionClass: 'refund.create',
        resourceRef: OTHER_ORDER.resourceRef,
        spec: makeSpec(),
      }),
    );
    const { optionIdA } = await enumerateCan03();

    const intent = parseProposedIntent(
      rawIntent({ enumerationId: other.set.enumerationId, optionId: optionIdA }),
    );
    const error = await kernel.leases
      .withEntityLease(KEY, (lease) =>
        kernel.liveSelector.canonicaliseUnderLease(lease, intent, makeSpec(), kernelContext()),
      )
      .catch((caught: unknown) => caught);
    expect((error as CanonicalisationDenied).detail).toBe('ENUMERATION_BINDING_MISMATCH');
  });

  it('an enumeration taken by ANOTHER task cannot be reused', async () => {
    const otherTaskSpec = makeSpec({ taskId: 'task:T-SOMEONE-ELSE' });
    const other = await kernel.leases.withEntityLease(KEY, (lease) =>
      kernel.enumerator.enumerate(lease, {
        actionClass: 'refund.create',
        resourceRef: CAN03.resourceRef,
        spec: otherTaskSpec,
      }),
    );
    const intent = parseProposedIntent(
      rawIntent({
        enumerationId: other.set.enumerationId,
        optionId: other.set.options[0]!.optionId,
      }),
    );
    const error = await kernel.leases
      .withEntityLease(KEY, (lease) =>
        kernel.liveSelector.canonicaliseUnderLease(lease, intent, makeSpec(), kernelContext()),
      )
      .catch((caught: unknown) => caught);
    expect((error as CanonicalisationDenied).detail).toBe('ENUMERATION_BINDING_MISMATCH');
  });
});

describe('14 — the constructor version on the enumeration matches the one on the request', () => {
  it('I61: the same verified ConstructorVersionRecord governs the READ and the canonicalisation', async () => {
    // `26 §2.1.2`: "constructor_version is recorded on the AuthorizationRequest, the
    // AuthorizationDecision, the journal row, the approval binding […]". If the enumeration
    // and the canonicalisation could resolve different versions, the option the model chose
    // and the effect the kernel built would have been produced by different constructors —
    // which is the exact investigation failure `26 §2.1.2` exists to close.
    const outcome = await kernel.leases.withEntityLease(KEY, (lease) =>
      kernel.enumerator.enumerate(lease, {
        actionClass: 'refund.create',
        resourceRef: CAN03.resourceRef,
        spec: makeSpec(),
      }),
    );
    const intent = parseProposedIntent(
      rawIntent({
        enumerationId: outcome.set.enumerationId,
        optionId: outcome.set.options[0]!.optionId,
      }),
    );
    const effect = await kernel.leases.withEntityLease(KEY, (lease) =>
      kernel.liveSelector.canonicaliseUnderLease(lease, intent, makeSpec(), kernelContext()),
    );

    expect(effect.request.constructorVersion).toEqual(outcome.set.constructorVersion);
    // And the record hash — the binding to the exact signed bytes that verified.
    expect(effect.request.constructorVersion.recordHash).toBe(
      outcome.set.constructorVersion.recordHash,
    );

    // The enumeration_record row agrees too, so the lineage is consistent in kernel state.
    const client = await harness.connect();
    try {
      const row = await client.query<{
        constructor_id: string;
        constructor_record_hash: string;
        constructor_semantic_major: number;
      }>(
        `SELECT constructor_id, constructor_record_hash, constructor_semantic_major
           FROM enumeration_record WHERE enumeration_id = $1`,
        [outcome.set.enumerationId],
      );
      expect(row.rows[0]!.constructor_id).toBe(effect.request.constructorVersion.constructorId);
      expect(row.rows[0]!.constructor_record_hash).toBe(
        effect.request.constructorVersion.recordHash,
      );
      expect(row.rows[0]!.constructor_semantic_major).toBe(
        effect.request.constructorVersion.semanticMajor,
      );
    } finally {
      client.release();
    }
  });

  it('the request records the enumeration_ref the KERNEL holds, not one the model supplied', async () => {
    // `26 §2.1`: "enumeration_ref — the enumeration_id and its computed_at, for lineage".
    // `26 §1` Corollary 3: the enforcer builds it, not the subject.
    const { enumerationId, optionIdA } = await enumerateCan03();
    const intent = parseProposedIntent(rawIntent({ enumerationId, optionId: optionIdA }));
    const effect = await kernel.leases.withEntityLease(KEY, (lease) =>
      kernel.liveSelector.canonicaliseUnderLease(lease, intent, makeSpec(), kernelContext()),
    );
    expect(effect.request.enumerationRef.enumerationId).toBe(enumerationId);
    expect(effect.request.enumerationRef.computedAt.toISOString()).toBe(
      '2026-09-05T10:00:00.000Z',
    );
  });
});

describe('C′ requires a held lease, and reads under it', () => {
  it('a released lease cannot canonicalise', async () => {
    const { enumerationId, optionIdA } = await enumerateCan03();
    const intent = parseProposedIntent(rawIntent({ enumerationId, optionId: optionIdA }));

    let escaped: Parameters<Parameters<typeof kernel.leases.withEntityLease>[1]>[0] | null = null;
    await kernel.leases.withEntityLease(KEY, async (lease) => {
      escaped = lease;
    });

    await expect(
      kernel.liveSelector.canonicaliseUnderLease(escaped!, intent, makeSpec(), kernelContext()),
    ).rejects.toThrow(/has been released/);
  });

  it('a lease for another COMPANY is refused', async () => {
    const { enumerationId, optionIdA } = await enumerateCan03();
    const intent = parseProposedIntent(rawIntent({ enumerationId, optionId: optionIdA }));
    await expect(
      kernel.leases.withEntityLease(
        { companyId: 'co_other', entityType: 'order', entityId: CAN03.orderId },
        (lease) =>
          kernel.liveSelector.canonicaliseUnderLease(lease, intent, makeSpec(), kernelContext()),
      ),
    ).rejects.toThrow(/lease is for company co_other/);
  });

  it('a lease for another ENTITY is refused once the resource resolves', async () => {
    const { enumerationId, optionIdA } = await enumerateCan03();
    const intent = parseProposedIntent(rawIntent({ enumerationId, optionId: optionIdA }));
    await expect(
      kernel.leases.withEntityLease(entityKeyFor(OTHER_ORDER.orderId), (lease) =>
        kernel.liveSelector.canonicaliseUnderLease(lease, intent, makeSpec(), kernelContext()),
      ),
    ).rejects.toThrow(/covers .*ORD-777/);
  });
});
