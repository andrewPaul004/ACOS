import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { EntityLeaseManager } from '../../src/kernel/enumeration/entityLease.js';
import { EffectEnumerator } from '../../src/kernel/enumeration/enumerateEffects.js';
import { FixedClock } from '../../src/kernel/enumeration/clock.js';
import { ConstructorVersionResolver } from '../../src/kernel/canonicalisation/constructorVersion.js';
import { ACTION_CLASSES } from '../../src/kernel/canonicalisation/actionClasses.js';
import {
  S1P_VALIDATION_EMAIL_ACTION_CLASS,
  S1P_VALIDATION_EMAIL_CONSTRUCTOR_ID,
  S1P_VALIDATION_EMAIL_NON_SEMANTIC_MINOR,
  S1P_VALIDATION_EMAIL_SEMANTIC_MAJOR,
  s1pLiveConstructorRegistry,
  s1pValidationEmailConstructor,
  s1pValidationEmailSemanticOptionDigest,
} from '../../validation/sendgrid/harness/validationEmailConstructor.js';
import {
  ENV_CONSTRUCTOR_RECORDS_LOCATOR,
  ENV_CONTROL_PG_URL,
  ENV_DECISION_KEY_LOCATOR,
  S1P_LIVE_CONSTRUCTOR_REGISTRY,
  describeLiveComposition,
  type CompositionInput,
} from '../../validation/sendgrid/harness/liveComposition.js';
import { SENDGRID_LIVE_VISIBILITY_BOUND } from '../../validation/sendgrid/harness/visibilityBound.js';
import { newTestSigner, signConstructorVersion } from '../support/canonicalisationFixture.js';
import { COMPANY_ID } from '../support/fixture.js';
import { createOutboxHarness, S1I_NOW, type OutboxHarness } from '../support/outboxFixture.js';
import { s1pValidationArtifacts } from '../support/s1pScenarioFixture.js';

/**
 * THIRD REVIEW — **THE S1P VALIDATION `email.send` ENUMERATION CONSTRUCTOR.**
 *
 * =================================================================================
 * WHAT THE REVIEWER REJECTED, AND WHY A SIGNATURE COULD NOT HAVE FIXED IT
 *
 * The second-round live composition built its registry from `refundCreateConstructor` alone.
 * `describeLiveComposition` therefore reported `EFFECT_CONSTRUCTOR_NOT_IMPLEMENTED` on every
 * run, and `S1PValidationAuthority`'s `enumerate` port was an unconditional `throw`.
 *
 * The objection is exact and is not about ceremony: **an owner-signed
 * `ConstructorVersionRecord` cannot implement missing TypeScript code.** Had the owner
 * provisioned and signed every external artifact, the live path would still have been
 * impossible, because a piece of the repository was absent.
 *
 * =================================================================================
 * THE TWO HALVES THIS SUITE KEEPS APART
 *
 *   CANONICALISABLE   a registered constructor makes `26 §7` step C2 pass for the class.
 *                     That is what this correction adds.
 *   AUTHORISED        a Cedar permit makes the class executable. That is what it does NOT
 *                     add, and the last describe block proves the absence by execution.
 *
 * Constructor existence is not authority to execute, and the suite asserts both directions
 * so a future reader cannot take one for the other.
 * =================================================================================
 */

let h: OutboxHarness;

beforeAll(async () => {
  h = await createOutboxHarness();
}, 120_000);

afterAll(async () => {
  await h.close();
});

beforeEach(async () => {
  await h.reset();
});

/** The four values `50 §3i` admission decides membership on. ONE identity, everywhere. */
const TUPLE = Object.freeze({
  constructorId: S1P_VALIDATION_EMAIL_CONSTRUCTOR_ID,
  actionClass: S1P_VALIDATION_EMAIL_ACTION_CLASS,
  semanticMajor: S1P_VALIDATION_EMAIL_SEMANTIC_MAJOR,
  nonSemanticMinor: S1P_VALIDATION_EMAIL_NON_SEMANTIC_MINOR,
});

/**
 * A kernel enumerator over the S1P LIVE registry, with a resolver that admits this
 * constructor's signed record.
 *
 * The REGISTRY is the shipped one — `S1P_LIVE_CONSTRUCTOR_REGISTRY`, not a copy — so a
 * registration defect fails here rather than being papered over by a test-local list.
 */
function liveEnumerator(): { enumerator: EffectEnumerator; leases: EntityLeaseManager } {
  const signer = newTestSigner();
  const versions = new ConstructorVersionResolver(signer.publicKey, [
    signConstructorVersion(signer, {
      ...TUPLE,
      changedFields: [],
      semanticChange: false,
      signedAt: new Date('2026-09-29T00:00:00.000Z'),
    }),
  ]);
  return {
    enumerator: new EffectEnumerator({
      registry: S1P_LIVE_CONSTRUCTOR_REGISTRY,
      versions,
      clock: new FixedClock(S1I_NOW),
    }),
    leases: new EntityLeaseManager({ pool: h.control }),
  };
}

const RESOURCE_ID = 'S1P-VALIDATION-RESOURCE-1';
const RESOURCE_REF = `order:${RESOURCE_ID}`;

async function seedValidationResource(grade = 'RECORD'): Promise<void> {
  const client = await h.control.connect();
  try {
    await client.query(
      `INSERT INTO commerce_order
         (company_id, order_id, resource_ref, grade, currency, customer_novelty)
       VALUES ($1, $2, $3, $4, 'USD', 'RETURNING')
       ON CONFLICT (company_id, order_id) DO UPDATE SET grade = EXCLUDED.grade`,
      [COMPANY_ID, RESOURCE_ID, RESOURCE_REF, grade],
    );
  } finally {
    client.release();
  }
}

function spec(): Parameters<EffectEnumerator['enumerate']>[1]['spec'] {
  return {
    companyId: COMPANY_ID,
    taskId: 'task:s1p-validation-1',
    principalId: 'principal:s1p_validation_harness',
    admittedResourceRefs: new Set([RESOURCE_REF]),
    admittedDescriptionFields: {},
    reasonCodeScope: 'GOODS_FAULT',
  };
}

describe('`§8` item 1 — THE CHECKED-IN S1P LIVE REGISTRY CARRIES THE VALIDATION CLASS', () => {
  it('the shipped registry resolves a constructor for `email.send`', () => {
    const registered = S1P_LIVE_CONSTRUCTOR_REGISTRY.get(S1P_VALIDATION_EMAIL_ACTION_CLASS as never);
    expect(registered).toBeDefined();
    expect(registered?.constructorId).toBe(S1P_VALIDATION_EMAIL_CONSTRUCTOR_ID);
    // ...and it still carries the production constructor the kernel needs.
    expect(s1pLiveConstructorRegistry().get('refund.create')).toBeDefined();
  });

  it('**PRODUCTION IS UNTOUCHED** — `src/` still registers exactly one constructor', () => {
    /*
     * THE ASSERTION THAT KEEPS THIS CORRECTION HONEST.
     *
     * `tests/canonicalisation/registry.test.ts` states the same property over the production
     * registry. Restated here from the other side: the validation constructor is reachable
     * ONLY through the S1P composition, and adding it changed nothing about what an ordinary
     * production composition can canonicalise.
     */
    const source = readFileSync(
      join('src', 'kernel', 'canonicalisation', 'registry.ts'),
      'utf8',
    );
    expect(source).not.toContain('s1pValidationEmailConstructor');
    expect(source).not.toContain('validation/');
  });

  it('ONE constructor identity is used by the implementation, the registry and class 19', () => {
    /*
     * `50 §3i` decides admission on the TUPLE. The refund constructor carries a known
     * divergence — `ctor.refund.create` in code, `acos.constructor.refund.create` in the
     * artifact — recorded in `tests/release/class19-admission.test.ts` as a residual of class
     * 19 having had no production authority consumer. S1P is the first slice to run a
     * constructor THROUGH that admission, so it does not inherit the divergence.
     */
    const artifact = JSON.parse(
      readFileSync(join('artifacts', 'control', 'class-19.effect-constructors.json'), 'utf8'),
    ) as {
      readonly records: readonly {
        readonly constructor_id: string;
        readonly action_class: string;
        readonly semantic_major: number;
        readonly non_semantic_minor: number;
      }[];
    };
    const candidate = artifact.records.find(
      (record) => record.action_class === S1P_VALIDATION_EMAIL_ACTION_CLASS,
    );
    expect(candidate).toBeDefined();
    expect(candidate?.constructor_id).toBe(S1P_VALIDATION_EMAIL_CONSTRUCTOR_ID);
    expect(candidate?.semantic_major).toBe(S1P_VALIDATION_EMAIL_SEMANTIC_MAJOR);
    expect(candidate?.non_semantic_minor).toBe(S1P_VALIDATION_EMAIL_NON_SEMANTIC_MINOR);
    // The name must not let a reader of the signed bytes infer a production email capability.
    expect(candidate?.constructor_id).toContain('s1p_validation');
  });
});

describe('`§8` items 2 and 3 — WHAT THE COMPOSITION NOW MEASURES', () => {
  const { bundle } = s1pValidationArtifacts();

  function input(environment: Record<string, string | undefined>): CompositionInput {
    return {
      environment,
      config: {
        environmentLabel: 'nonprod-validation',
        senderAddress: 'validation@nonprod.example.test',
        sinkAddress: 'owner+acos-validation-sink@example.test',
        integrationCredentialId: 'twilio_sendgrid.validation_send',
        auditCredentialId: 'twilio_sendgrid.validation_audit_read',
      },
      bundle,
      integrationLocator: 'integration.json',
      auditLocator: 'audit.json',
      visibilityBound: SENDGRID_LIVE_VISIBILITY_BOUND,
    };
  }

  it('`EFFECT_CONSTRUCTOR_NOT_IMPLEMENTED` is NO LONGER reported by the checked-in tree', () => {
    /*
     * THE ASSERTION THE SECOND-ROUND TREE FAILS.
     *
     * Every other block may still be present — this run supplies no database and no keys —
     * but the one that was permanent, and that no signature could have cleared, is gone.
     */
    const availability = describeLiveComposition(input({}));
    expect(availability.blocks).not.toContain('EFFECT_CONSTRUCTOR_NOT_IMPLEMENTED');
  });

  it('a MISSING signed constructor-version record STILL blocks the composition', () => {
    /*
     * THE OTHER HALF, AND IT IS THE HALF THAT IS GENUINELY EXTERNAL.
     *
     * Implementing the constructor does not grant it authority: `50 §3i` admits a record only
     * when the VERIFIED class-19 bytes declare its tuple AND the caller supplies the signed
     * record. The candidate bytes exist; the signature does not, and this run says so.
     */
    const availability = describeLiveComposition(input({}));
    expect(availability.blocks).toContain('CONSTRUCTOR_VERSION_RECORDS_NOT_PROVISIONED');
    expect(availability.available).toBe(false);
  });

  it('every remaining block names a signature, a credential or a deployment material', () => {
    /*
     * `§9`'s acceptance test, expressed as an assertion.
     *
     * If the owner provisioned and signed every external artifact tomorrow, this exact source
     * tree must run S1P live without another code edit. That holds only while no remaining
     * block is a missing piece of REPOSITORY IMPLEMENTATION — so the set is enumerated here,
     * and a future block that is code rather than provisioning fails this test.
     */
    const availability = describeLiveComposition(input({}));
    const provisioning = new Set([
      'CONTROL_DATABASE_NOT_CONFIGURED',
      'CONSTRUCTOR_VERSION_RECORDS_NOT_PROVISIONED',
      'DECISION_SIGNING_KEY_NOT_PROVISIONED',
    ]);
    for (const block of availability.blocks) {
      expect(provisioning.has(block), `${block} is not an external prerequisite`).toBe(true);
    }
  });

  it('and supplying those externals clears the composition measurement entirely', () => {
    /*
     * THE ACCEPTANCE TEST, RUN. Three files and an environment variable — no source change —
     * and `describeLiveComposition` reports AVAILABLE.
     *
     * The files here stand in for provisioned materials; what is being proved is that the
     * MEASUREMENT has no remaining repository-implementation term, not that these particular
     * bytes are valid. `openLiveComposition` still verifies every one of them.
     */
    const here = join('artifacts', 'control', 'class-19.effect-constructors.json');
    const availability = describeLiveComposition(
      input({
        [ENV_CONTROL_PG_URL]: 'postgres://example.invalid/acos',
        [ENV_CONSTRUCTOR_RECORDS_LOCATOR]: here,
        [ENV_DECISION_KEY_LOCATOR]: here,
      }),
    );
    expect(availability.blocks).toEqual([]);
    expect(availability.available).toBe(true);
  });
});

describe('`§8` items 4, 6 and 7 — ENUMERATION THROUGH THE REAL `EffectEnumerator`', () => {
  it('item 4 — the validation constructor enumerates DETERMINISTICALLY', async () => {
    await seedValidationResource();
    const { enumerator, leases } = liveEnumerator();

    const first = await leases.withEntityLease(
      { companyId: COMPANY_ID, entityType: 'order', entityId: RESOURCE_ID },
      (lease) =>
        enumerator.enumerate(lease, {
          actionClass: S1P_VALIDATION_EMAIL_ACTION_CLASS,
          resourceRef: RESOURCE_REF,
          spec: spec(),
        }),
    );
    const second = await leases.withEntityLease(
      { companyId: COMPANY_ID, entityType: 'order', entityId: RESOURCE_ID },
      (lease) =>
        enumerator.enumerate(lease, {
          actionClass: S1P_VALIDATION_EMAIL_ACTION_CLASS,
          resourceRef: RESOURCE_REF,
          spec: spec(),
        }),
    );

    // EXACTLY ONE option, and the same option identity both times.
    expect(first.set.options.length).toBe(1);
    expect(second.set.options.length).toBe(1);
    expect(second.set.options[0]?.optionId).toBe(first.set.options[0]?.optionId);
    // The version identity the enumeration recorded is the one identity, unchanged.
    expect(first.set.constructorVersion.constructorId).toBe(S1P_VALIDATION_EMAIL_CONSTRUCTOR_ID);
    // The option describes NOTHING: no sink, no subject, no body can ride an empty projection.
    expect(first.set.options[0]?.description).toBe('');
  }, 60_000);

  it('item 6 — re-enumeration at dispatch returns the SAME option identity for unchanged state', async () => {
    /*
     * `25 §14.1`'s revalidation operand. `reEnumerate` is the C′ call — it does NOT mint a
     * new enumeration id — and it is the same function over the same registry and the same
     * resolver as the initial enumeration, because the live composition hands ONE
     * `EffectEnumerator` to both the authority port and the dispatch environment.
     */
    await seedValidationResource();
    const { enumerator, leases } = liveEnumerator();

    const initial = await leases.withEntityLease(
      { companyId: COMPANY_ID, entityType: 'order', entityId: RESOURCE_ID },
      (lease) =>
        enumerator.enumerate(lease, {
          actionClass: S1P_VALIDATION_EMAIL_ACTION_CLASS,
          resourceRef: RESOURCE_REF,
          spec: spec(),
        }),
    );
    const revalidation = await leases.withEntityLease(
      { companyId: COMPANY_ID, entityType: 'order', entityId: RESOURCE_ID },
      (lease) =>
        enumerator.reEnumerate(lease, {
          actionClass: S1P_VALIDATION_EMAIL_ACTION_CLASS,
          resourceRef: RESOURCE_REF,
          spec: spec(),
        }),
    );

    expect(revalidation.set.options[0]?.optionId).toBe(initial.set.options[0]?.optionId);
  }, 60_000);

  it('item 7 — CHANGED authoritative state fails revalidation under the existing kernel rules', async () => {
    /*
     * NON-VACUOUS. The match above must hold because the option is deterministic, not because
     * the option can never disappear. Demoting the resource's GRADE is a real movement of
     * authoritative state — `26 §8`: "resource.grade == 'RECORD'" — and the live set empties.
     *
     * An empty live set is what `liveSelector.ts` denies `OPTION_ABSENT_FROM_LIVE_SET` on, so
     * an authorised validation effect whose resource went stale cannot be dispatched.
     */
    await seedValidationResource();
    const { enumerator, leases } = liveEnumerator();

    const initial = await leases.withEntityLease(
      { companyId: COMPANY_ID, entityType: 'order', entityId: RESOURCE_ID },
      (lease) =>
        enumerator.enumerate(lease, {
          actionClass: S1P_VALIDATION_EMAIL_ACTION_CLASS,
          resourceRef: RESOURCE_REF,
          spec: spec(),
        }),
    );
    expect(initial.set.options.length).toBe(1);

    // 24 §2's evidence grades. OBSERVATION is a legitimate grade and is NOT RECORD, so the
    // demotion is a real movement of authoritative state rather than an invalid row.
    await seedValidationResource('OBSERVATION');

    const revalidation = await leases.withEntityLease(
      { companyId: COMPANY_ID, entityType: 'order', entityId: RESOURCE_ID },
      (lease) =>
        enumerator.reEnumerate(lease, {
          actionClass: S1P_VALIDATION_EMAIL_ACTION_CLASS,
          resourceRef: RESOURCE_REF,
          spec: spec(),
        }),
    );

    expect(revalidation.set.options).toEqual([]);
    expect(revalidation.internalFailure).toBe('RESOURCE_NOT_RECORD_GRADE');
  }, 60_000);

  it('an ABSENT resource enumerates nothing, and leaks no existence', async () => {
    const { enumerator, leases } = liveEnumerator();
    const outcome = await leases.withEntityLease(
      { companyId: COMPANY_ID, entityType: 'order', entityId: RESOURCE_ID },
      (lease) =>
        enumerator.enumerate(lease, {
          actionClass: S1P_VALIDATION_EMAIL_ACTION_CLASS,
          resourceRef: RESOURCE_REF,
          spec: spec(),
        }),
    );
    // `36 §2` VC-C2: an empty set, and the reason stays internal.
    expect(outcome.set.options).toEqual([]);
    expect(outcome.internalFailure).toBe('RESOURCE_ABSENT');
  }, 60_000);
});

describe('`§3` — THE EMPTY SEMANTIC OPTION DIGEST AGREES WITH THE REAL CONTRACT', () => {
  it('the constructor covers exactly the fields the verified class-3 artifact declares', () => {
    const { bundle } = s1pValidationArtifacts();
    // No throw means the agreement check passed against the VERIFIED bytes.
    expect(s1pValidationEmailSemanticOptionDigest(bundle).length).toBe(32);
  });

  it('two DIFFERENT validation resources still receive DISTINCT option identities', async () => {
    /*
     * WHY `semantic_option_digest_fields: []` IS NOT A COLLISION.
     *
     * `option_id = H(action_class ‖ resource_id ‖ semantic_option_digest)`. The digest is only
     * one of three preimage components, so an empty field list collapses nothing across
     * resources — and within one resource there is exactly one option, so there is nothing to
     * separate. This is the arithmetic behind record 13, driven rather than asserted.
     */
    await seedValidationResource();
    const client = await h.control.connect();
    try {
      await client.query(
        `INSERT INTO commerce_order
           (company_id, order_id, resource_ref, grade, currency, customer_novelty)
         VALUES ($1, 'S1P-VALIDATION-RESOURCE-2', 'order:S1P-VALIDATION-RESOURCE-2',
                 'RECORD', 'USD', 'RETURNING')
         ON CONFLICT (company_id, order_id) DO NOTHING`,
        [COMPANY_ID],
      );
    } finally {
      client.release();
    }

    const { enumerator, leases } = liveEnumerator();
    const one = await leases.withEntityLease(
      { companyId: COMPANY_ID, entityType: 'order', entityId: RESOURCE_ID },
      (lease) =>
        enumerator.enumerate(lease, {
          actionClass: S1P_VALIDATION_EMAIL_ACTION_CLASS,
          resourceRef: RESOURCE_REF,
          spec: spec(),
        }),
    );
    const two = await leases.withEntityLease(
      { companyId: COMPANY_ID, entityType: 'order', entityId: 'S1P-VALIDATION-RESOURCE-2' },
      (lease) =>
        enumerator.enumerate(lease, {
          actionClass: S1P_VALIDATION_EMAIL_ACTION_CLASS,
          resourceRef: 'order:S1P-VALIDATION-RESOURCE-2',
          spec: {
            ...spec(),
            admittedResourceRefs: new Set(['order:S1P-VALIDATION-RESOURCE-2']),
          },
        }),
    );

    expect(one.set.options[0]?.optionId).not.toBe(two.set.options[0]?.optionId);
  }, 60_000);

  it('`construct` THROWS — the validation authority owns the payload, and revalidation builds none', () => {
    /*
     * `25 §14.1`: revalidation "constructs no payload" and "the persisted payload remains the
     * exact authorised payload". A constructor that returned something plausible would leave a
     * reviewer unable to tell which of two payloads a dispatch used.
     */
    expect(() =>
      s1pValidationEmailConstructor.construct({} as never),
    ).toThrow(/builds no payload/);
  });
});

describe('`§7` — ORDINARY PRODUCTION `email.send` IS STILL FAIL-CLOSED', () => {
  it('item 8 — the class is in the catalogue and has NO Cedar permit', () => {
    /*
     * CONSTRUCTOR EXISTENCE IS NOT AUTHORITY TO EXECUTE.
     *
     * A registered constructor makes the class canonicalisable at `26 §7` step C2. It says
     * nothing about step M, and `tests/policy/policy-set-gap-analysis.test.ts` proves the
     * absence of a permit by EXECUTING the policy set against the class rather than by
     * reading it. This assertion is the pointer, so a reader of this suite cannot conclude
     * that adding the constructor granted anything.
     */
    expect(ACTION_CLASSES).toContain(S1P_VALIDATION_EMAIL_ACTION_CLASS);
    const policySet = readFileSync(
      join('artifacts', 'control', 'class-02.policy-set.json'),
      'utf8',
    );
    expect(policySet).not.toContain('email.send');
  });

  it('item 9 — NO file under `src/` reaches the S1P validation constructor', () => {
    /*
     * The `I25` direction, restated for this module. `src/` must not import `validation/` at
     * all — `tests/sendgrid/prerequisites-and-separation.test.ts` computes the control
     * plane's whole import closure and asserts it holds nothing from `validation/`. Here the
     * specific module is named, so a future import of THIS file is caught by name as well as
     * by closure.
     */
    const offenders: string[] = [];
    const walk = (directory: string): void => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (path.endsWith('.ts')) {
          const source = readFileSync(path, 'utf8');
          if (
            source.includes('validationEmailConstructor') ||
            source.includes('s1pLiveConstructorRegistry')
          ) {
            offenders.push(path);
          }
        }
      }
    };
    walk('src');
    expect(offenders).toEqual([]);

    // NON-VACUOUS: the walk really does read files, and the names really do appear where
    // they should — in the S1P composition, which is not under `src/`.
    expect(
      readFileSync(join('validation', 'sendgrid', 'harness', 'liveComposition.ts'), 'utf8'),
    ).toContain('s1pLiveConstructorRegistry');
  });
});
