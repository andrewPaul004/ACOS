import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  ConstructorVersionResolver,
  SEMANTIC_BY_DEFINITION_FIELDS,
  replayCompatibility,
  type ConstructorVersionRecord,
} from '../../src/kernel/canonicalisation/constructorVersion.js';
import { CanonicalisationDenied } from '../../src/kernel/canonicalisation/errors.js';
import { parseProposedIntent } from '../../src/kernel/canonicalisation/intent.js';
import { REFUND_CREATE_CONSTRUCTOR_ID } from '../../src/kernel/canonicalisation/constructors/refundCreate.js';
import {
  REFUND_VERSION_1_0,
  makeCanonicaliser,
  makeContext,
  makeRawIntent,
  makeRefundOption,
  newTestSigner,
  signConstructorVersion,
} from '../support/canonicalisationFixture.js';

/**
 * `I61` — the S1B portion. A constructor cannot choose an unsigned arbitrary version.
 *
 * Registry `I61`, verbatim:
 *
 *   "Every AuthorizationRequest, AuthorizationDecision, journal row and approval binding
 *    records a constructor_version resolving to a signed ConstructorVersionRecord, and no
 *    approval resumes under a constructor whose semantic_major differs from the bound one."
 *
 * `26 §2.1.2`, verbatim:
 *
 *   "A bump is semantic by definition — and cannot be declared otherwise — if it changes
 *    any of: exposure computation, cost_components membership, enumeration membership, the
 *    semantic_option_digest, counterparty derivation, value_direction, recoverability, or
 *    the dispatch payload's field set."
 *
 * `50 §2` class 19, verbatim: "a constructor computes every dispatched amount and in v1.1
 * it was not owner-signed."
 *
 * The approval-resume half of `I61` is NOT tested here because it is not implemented:
 * `CONSTRUCTOR_SEMANTIC_CHANGE` needs the approval state machine. See the S1B contract §4.2
 * and S1B-owner-clarifications.md S1B-C2.
 */

const option = makeRefundOption();
const signer = newTestSigner();

function canonicaliseWith(records: Parameters<typeof makeCanonicaliser>[0]): unknown {
  const { canonicaliser } = makeCanonicaliser(records);
  return canonicaliser.canonicalise(
    parseProposedIntent(makeRawIntent(option)),
    makeContext(),
    option,
  );
}

function denialOf(fn: () => unknown): CanonicalisationDenied {
  try {
    fn();
  } catch (error) {
    if (error instanceof CanonicalisationDenied) return error;
    throw error;
  }
  throw new Error('expected a denial');
}

describe('a validly signed record verifies and is recorded in full', () => {
  it('canonicalisation succeeds and stamps the complete version identity', () => {
    const { canonicaliser } = makeCanonicaliser({ signer });
    const { request } = canonicaliser.canonicalise(
      parseProposedIntent(makeRawIntent(option)),
      makeContext(),
      option,
    );
    const version = request.constructorVersion;
    expect(version.constructorId).toBe(REFUND_CREATE_CONSTRUCTOR_ID);
    expect(version.actionClass).toBe('refund.create');
    expect(version.semanticMajor).toBe(1);
    expect(version.nonSemanticMinor).toBe(0);
    expect(version.semanticChange).toBe(false);
    expect(version.changedFields).toEqual([]);
    expect(version.signedAt.toISOString()).toBe('2026-09-05T00:00:00.000Z');
    // `26 §2.1.2` requires the recorded version to identify the exact record that computed
    // the figures, so the identity carries a hash of the signed bytes.
    expect(version.recordHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('the record hash moves when the record does', () => {
    const resolver = new ConstructorVersionResolver(signer.publicKey, [
      signConstructorVersion(signer, REFUND_VERSION_1_0),
    ]);
    const bumped = new ConstructorVersionResolver(signer.publicKey, [
      signConstructorVersion(signer, {
        ...REFUND_VERSION_1_0,
        nonSemanticMinor: 1,
        changedFields: ['logging'],
      }),
    ]);
    expect(
      resolver.resolve(REFUND_CREATE_CONSTRUCTOR_ID, 'refund.create').recordHash,
    ).not.toBe(bumped.resolve(REFUND_CREATE_CONSTRUCTOR_ID, 'refund.create').recordHash);
  });
});

describe('every unverifiable record fails closed', () => {
  it('missing', () => {
    const denial = denialOf(() => canonicaliseWith({ signer, records: [] }));
    expect(denial.code).toBe('NOT_CANONICALISABLE');
    expect(denial.detail).toBe('CONSTRUCTOR_VERSION_UNVERIFIABLE');
  });

  it('wrong action class', () => {
    const denial = denialOf(() =>
      canonicaliseWith({
        signer,
        records: [
          signConstructorVersion(signer, { ...REFUND_VERSION_1_0, actionClass: 'campaign.pause' }),
        ],
      }),
    );
    expect(denial.code).toBe('NOT_CANONICALISABLE');
    expect(denial.auditNote).toContain('action_class');
  });

  it('invalid signature — a record signed by another key', () => {
    const attacker = newTestSigner();
    const denial = denialOf(() =>
      canonicaliseWith({
        signer,
        records: [signConstructorVersion(attacker, REFUND_VERSION_1_0)],
      }),
    );
    expect(denial.code).toBe('NOT_CANONICALISABLE');
    expect(denial.auditNote).toContain('signature does not verify');
  });

  it('invalid signature — a field tampered with after signing', () => {
    const signed = signConstructorVersion(signer, REFUND_VERSION_1_0);
    const denial = denialOf(() =>
      canonicaliseWith({
        signer,
        // The version the record claims is now 9, and the signature covers 1.
        records: [{ ...signed, semanticMajor: 9 }],
      }),
    );
    expect(denial.auditNote).toContain('signature does not verify');
  });

  it('a record signed for a DIFFERENT constructor cannot be substituted', () => {
    const denial = denialOf(() =>
      canonicaliseWith({
        signer,
        records: [
          signConstructorVersion(signer, {
            ...REFUND_VERSION_1_0,
            constructorId: 'ctor.something.else',
          }),
        ],
      }),
    );
    expect(denial.code).toBe('NOT_CANONICALISABLE');
  });

  describe('structurally malformed', () => {
    /**
     * The patch is applied AFTER signing, deliberately. Two reasons: a value like `1.5` is
     * not signable at all (the canonical integer encoding refuses it), and the resolver
     * runs its structural checks BEFORE it verifies the signature — so these cases assert
     * the structural branch rather than falling through to "signature does not verify".
     * Each assertion names the structural reason to prove which branch fired.
     */
    const cases: readonly [string, Record<string, unknown>, string][] = [
      ['a negative semantic_major', { semanticMajor: -1 }, 'semantic_major'],
      ['a non-integer non_semantic_minor', { nonSemanticMinor: 1.5 }, 'non_semantic_minor'],
      ['a non-Date signed_at', { signedAt: '2026-09-05' }, 'signed_at'],
      ['an undeclared changed_fields member', { changedFields: ['whatever'] }, 'undeclared member'],
      [
        'a duplicated changed_fields member',
        { changedFields: ['logging', 'logging'] },
        'carries logging twice',
      ],
    ];
    for (const [name, patch, expectedNote] of cases) {
      it(name, () => {
        const signed = signConstructorVersion(signer, REFUND_VERSION_1_0);
        const denial = denialOf(() =>
          canonicaliseWith({
            signer,
            records: [{ ...signed, ...patch } as unknown as ConstructorVersionRecord],
          }),
        );
        expect(denial.code).toBe('NOT_CANONICALISABLE');
        expect(denial.detail).toBe('CONSTRUCTOR_VERSION_UNVERIFIABLE');
        expect(denial.auditNote).toContain(expectedNote);
      });
    }
  });
});

describe('the semantic/non-semantic line is declared, not asserted per deploy', () => {
  /**
   * `26 §2.1.2`: a bump touching any of the eight fields "cannot be declared otherwise".
   * A validly signed record claiming otherwise is still refused — the signature proves who
   * said it, not that it is admissible.
   */
  for (const field of SEMANTIC_BY_DEFINITION_FIELDS) {
    it(`${field} cannot be declared non-semantic`, () => {
      const denial = denialOf(() =>
        canonicaliseWith({
          signer,
          records: [
            signConstructorVersion(signer, {
              ...REFUND_VERSION_1_0,
              semanticMajor: 2,
              changedFields: [field],
              semanticChange: false,
            }),
          ],
        }),
      );
      expect(denial.auditNote).toContain('semantic-by-definition');
    });
  }

  it('the same bump declared semantic verifies', () => {
    expect(() =>
      canonicaliseWith({
        signer,
        records: [
          signConstructorVersion(signer, {
            ...REFUND_VERSION_1_0,
            semanticMajor: 2,
            changedFields: ['exposure_computation'],
            semanticChange: true,
          }),
        ],
      }),
    ).not.toThrow();
  });

  it('a purely non-semantic bump verifies', () => {
    expect(() =>
      canonicaliseWith({
        signer,
        records: [
          signConstructorVersion(signer, {
            ...REFUND_VERSION_1_0,
            nonSemanticMinor: 3,
            changedFields: ['logging', 'refactoring', 'description_string'],
            semanticChange: false,
          }),
        ],
      }),
    ).not.toThrow();
  });
});

describe('one resolver input identifies one constructor id exactly once (S1B.2, finding 8)', () => {
  /**
   * Small hardening while this boundary is open.
   *
   * `ConstructorVersionResolver` loaded records into a Map keyed by constructor id, so two
   * records for one id meant REGISTRATION ORDER decided which signed record won. Both may be
   * individually valid — the signature check cannot separate them, because both signatures
   * verify — so nothing downstream could detect the substitution either.
   *
   * `26 §2.1.2` makes the record the thing an approval binds to, and `50 §2` class 19 makes
   * it an owner-signed control artifact. "Whichever was loaded last" is not a resolution rule
   * either can rest on, and `36 §0`'s discipline says an ambiguity that resolves silently is
   * indistinguishable from one that resolves correctly.
   *
   * WHAT THIS IS NOT: version history, or storage. Those need the approval state machine and
   * are out of S1B scope. This is only the narrow property that the current selection is
   * deterministic, and it is a build/configuration failure rather than a runtime condition —
   * so it fails at resolver CONSTRUCTION, not per request.
   */
  const first = signConstructorVersion(signer, REFUND_VERSION_1_0);
  const second = signConstructorVersion(signer, {
    ...REFUND_VERSION_1_0,
    nonSemanticMinor: 1,
    changedFields: ['logging'],
  });

  it('both records are individually valid, so the ambiguity is real', () => {
    // The positive control. Each alone resolves and verifies.
    for (const record of [first, second]) {
      const resolver = new ConstructorVersionResolver(signer.publicKey, [record]);
      const identity = resolver.resolve(REFUND_CREATE_CONSTRUCTOR_ID, 'refund.create');
      expect(identity.constructorId).toBe(REFUND_CREATE_CONSTRUCTOR_ID);
    }
    // And they are genuinely different records, so order would have decided something.
    expect(
      new ConstructorVersionResolver(signer.publicKey, [first])
        .resolve(REFUND_CREATE_CONSTRUCTOR_ID, 'refund.create')
        .recordHash,
    ).not.toBe(
      new ConstructorVersionResolver(signer.publicKey, [second])
        .resolve(REFUND_CREATE_CONSTRUCTOR_ID, 'refund.create')
        .recordHash,
    );
  });

  it('two records for one constructor id fail resolver INITIALISATION', () => {
    expect(() => new ConstructorVersionResolver(signer.publicKey, [first, second])).toThrow(
      /duplicate ConstructorVersionRecord for constructor ctor\.refund\.create/,
    );
  });

  it('in either order — it is not a last-writer-wins that happens to throw one way', () => {
    expect(() => new ConstructorVersionResolver(signer.publicKey, [second, first])).toThrow(
      /duplicate ConstructorVersionRecord/,
    );
  });

  it('two IDENTICAL records fail too — the rule is about the id, not about disagreement', () => {
    expect(() => new ConstructorVersionResolver(signer.publicKey, [first, first])).toThrow(
      /duplicate ConstructorVersionRecord/,
    );
  });

  it('records for DIFFERENT constructor ids coexist, so the rule is not over-broad', () => {
    const other = signConstructorVersion(signer, {
      ...REFUND_VERSION_1_0,
      constructorId: 'ctor.refund.create.v2',
    });
    const resolver = new ConstructorVersionResolver(signer.publicKey, [first, other]);
    expect(resolver.resolve(REFUND_CREATE_CONSTRUCTOR_ID, 'refund.create').constructorId).toBe(
      REFUND_CREATE_CONSTRUCTOR_ID,
    );
    expect(resolver.resolve('ctor.refund.create.v2', 'refund.create').constructorId).toBe(
      'ctor.refund.create.v2',
    );
  });

  it('it throws rather than denying — a build defect is not a model-visible category', () => {
    let error: unknown = null;
    try {
      new ConstructorVersionResolver(signer.publicKey, [first, second]);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(CanonicalisationDenied);
  });

  it('and no version history or storage was implemented alongside it', () => {
    const code = readFileSync(
      'src/kernel/canonicalisation/constructorVersion.ts',
      'utf8',
    )
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    for (const needle of ['history', 'previousVersions', 'versionsFor', 'allVersions']) {
      expect(code, `constructorVersion.ts carries ${needle}`).not.toContain(needle);
    }
  });
});

describe('the representation a later slice will enforce against', () => {
  /**
   * `26 §2.1.2`, verbatim: "on resume, a differing semantic_major denies
   * CONSTRUCTOR_SEMANTIC_CHANGE and re-proposes with a RemedyObligation; a differing
   * non_semantic_minor resumes."
   *
   * S1B implements NO approval-resume behaviour. It implements the representation, and
   * this test pins the verdict function so the approval slice inherits it rather than
   * inventing a second reading. `replayCompatibility` is called by no production path.
   */
  it('a differing semantic_major is refusable; a differing non_semantic_minor is not', () => {
    expect(replayCompatibility({ semanticMajor: 1 }, { semanticMajor: 2 })).toBe(
      'REFUSE_SEMANTIC_MAJOR_CHANGE',
    );
    expect(replayCompatibility({ semanticMajor: 1 }, { semanticMajor: 1 })).toBe(
      'REPLAY_COMPATIBLE',
    );
  });

  it('no S1B code path emits CONSTRUCTOR_SEMANTIC_CHANGE', async () => {
    const { readdirSync, readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
        entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)],
      );
    for (const file of walk('src')) {
      const code = readFileSync(file, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
      expect(code, file).not.toContain('CONSTRUCTOR_SEMANTIC_CHANGE');
    }
  });
});
