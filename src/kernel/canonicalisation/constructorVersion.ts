import { createPublicKey, verify as verifySignature, type KeyObject } from 'node:crypto';

import { canonicalBytes, hex, canonicalHash } from './canonicalBytes.js';
import { isActionClass, type ActionClass } from './actionCatalogue.js';
import { deny } from './errors.js';

/**
 * `ConstructorVersionRecord` — the S1B portion of `I61`.
 *
 * `26 §2.1.2`, verbatim:
 *
 *   ConstructorVersionRecord {
 *     constructor_id, action_class,
 *     semantic_major, non_semantic_minor,
 *     changed_fields[], semantic_change: bool,
 *     signed_at, signature
 *   }
 *
 * and, verbatim:
 *
 *   "The semantic/non-semantic line is declared, not asserted per deploy. A bump is
 *    semantic by definition — and cannot be declared otherwise — if it changes any of:
 *    exposure computation, cost_components membership, enumeration membership, the
 *    semantic_option_digest, counterparty derivation, value_direction, recoverability, or
 *    the dispatch payload's field set."
 *
 * Registry `I61`, verbatim:
 *
 *   "Every AuthorizationRequest, AuthorizationDecision, journal row and approval binding
 *    records a constructor_version resolving to a signed ConstructorVersionRecord, and no
 *    approval resumes under a constructor whose semantic_major differs from the bound one."
 *
 * `50 §2` class 19 makes constructors owner-signed control artifacts, and says why:
 * "a constructor computes every dispatched amount and was governed by code review alone."
 *
 * ---------------------------------------------------------------------------------
 * WHAT S1B IMPLEMENTS
 *
 * Real Ed25519 verification from `node:crypto`, over `ACOS-JCS-1`-shaped canonical bytes of
 * every field except the signature. `30 §5.3` already specifies "Ed25519 over ACOS-JCS-1
 * canonical bytes" for the journal attestation, so the primitive is the package's own.
 *
 * Test keys. NO production key management: the resolver takes the verifying public key as
 * an argument and holds no keystore, no rotation and no revocation list.
 *
 * WHAT S1B DOES NOT IMPLEMENT
 *
 * Approval-resume semantics. `26 §2.1.2`, verbatim: "on resume, a differing semantic_major
 * denies CONSTRUCTOR_SEMANTIC_CHANGE and re-proposes with a RemedyObligation; a differing
 * non_semantic_minor resumes." That needs the approval state machine. The representation
 * below carries the two version numbers separately so the later slice can enforce it, and
 * `replayCompatibility()` computes the verdict — but no S1B decision path calls it.
 * ---------------------------------------------------------------------------------
 */

/**
 * The semantic-by-definition field set, transcribed from `26 §2.1.2`. A bump touching any
 * of these cannot be declared non-semantic.
 */
export const SEMANTIC_BY_DEFINITION_FIELDS = [
  'exposure_computation',
  'cost_components_membership',
  'enumeration_membership',
  'semantic_option_digest',
  'counterparty_derivation',
  'value_direction',
  'recoverability',
  'dispatch_payload_field_set',
] as const;

export type SemanticByDefinitionField = (typeof SEMANTIC_BY_DEFINITION_FIELDS)[number];

/** Non-semantic changes the architecture permits: "logging, refactoring, a description string". */
export const NON_SEMANTIC_FIELDS = ['logging', 'refactoring', 'description_string'] as const;

export type NonSemanticField = (typeof NON_SEMANTIC_FIELDS)[number];

export type ChangedField = SemanticByDefinitionField | NonSemanticField;

const SEMANTIC_SET: ReadonlySet<string> = new Set<string>(SEMANTIC_BY_DEFINITION_FIELDS);
const CHANGED_FIELD_SET: ReadonlySet<string> = new Set<string>([
  ...SEMANTIC_BY_DEFINITION_FIELDS,
  ...NON_SEMANTIC_FIELDS,
]);

/** The record as it is signed and transported. */
export interface ConstructorVersionRecord {
  readonly constructorId: string;
  readonly actionClass: string;
  readonly semanticMajor: number;
  readonly nonSemanticMinor: number;
  readonly changedFields: readonly string[];
  readonly semanticChange: boolean;
  readonly signedAt: Date;
  /** Ed25519 over the canonical bytes of every field above. */
  readonly signature: Buffer;
}

/**
 * The verified version identity recorded on canonical output.
 *
 * `26 §2.1.2`, verbatim: "constructor_version is recorded on the AuthorizationRequest, the
 * AuthorizationDecision, the journal row, the approval binding alongside
 * dispatch_payload_hash, and the replay context."
 */
export interface ConstructorVersionIdentity {
  readonly constructorId: string;
  readonly actionClass: ActionClass;
  readonly semanticMajor: number;
  readonly nonSemanticMinor: number;
  readonly semanticChange: boolean;
  readonly changedFields: readonly ChangedField[];
  readonly signedAt: Date;
  /** Hash of the signed bytes. Binds the identity to the exact record that was verified. */
  readonly recordHash: string;
}

/**
 * The bytes that are signed: every field except the signature, in declared order.
 *
 * `30 §5.3`'s "declared per row kind" rule applies — the order is written out here and is
 * not a property of how the record object was built, so a record deserialised with keys in
 * a different order verifies identically.
 */
function signedBytes(record: ConstructorVersionRecord): Buffer {
  return canonicalBytes('acos.constructor_version_record.v1', [
    { kind: 'text', value: record.constructorId },
    { kind: 'text', value: record.actionClass },
    { kind: 'integer', value: BigInt(record.semanticMajor) },
    { kind: 'integer', value: BigInt(record.nonSemanticMinor) },
    // A JSON field, so RFC 8785 applies and the array's ORDER is significant — which is
    // correct: a changed-field list is a sequence the signer committed to.
    { kind: 'json', value: [...record.changedFields] },
    { kind: 'boolean', value: record.semanticChange },
    { kind: 'timestamp', value: record.signedAt },
  ]);
}

/** The bytes a signer must sign. Exported so a signing fixture cannot drift from the verifier. */
export function constructorVersionSigningBytes(record: {
  readonly constructorId: string;
  readonly actionClass: string;
  readonly semanticMajor: number;
  readonly nonSemanticMinor: number;
  readonly changedFields: readonly string[];
  readonly semanticChange: boolean;
  readonly signedAt: Date;
}): Buffer {
  return signedBytes({ ...record, signature: Buffer.alloc(0) });
}

/**
 * Resolve and verify the record for a constructor, or deny.
 *
 * Fails closed on every one of the five conditions the S1B mandate names — missing, wrong
 * action class, invalid signature, structurally malformed — plus the constructor-id
 * mismatch, because a validly signed record for a DIFFERENT constructor is exactly the
 * substitution the signature exists to prevent.
 *
 * The denial is `NOT_CANONICALISABLE`; see S1B-owner-clarifications.md S1B-C2 for why that
 * code and not `CONSTRUCTOR_SEMANTIC_CHANGE`.
 */
export class ConstructorVersionResolver {
  readonly #publicKey: KeyObject;
  readonly #records: ReadonlyMap<string, ConstructorVersionRecord>;

  constructor(publicKey: KeyObject | Buffer, records: readonly ConstructorVersionRecord[]) {
    this.#publicKey = Buffer.isBuffer(publicKey)
      ? createPublicKey({ key: publicKey, format: 'der', type: 'spki' })
      : publicKey;
    const byId = new Map<string, ConstructorVersionRecord>();
    for (const record of records) {
      byId.set(record.constructorId, record);
    }
    this.#records = byId;
  }

  resolve(constructorId: string, actionClass: ActionClass): ConstructorVersionIdentity {
    const record = this.#records.get(constructorId);
    if (record === undefined) {
      deny(
        'NOT_CANONICALISABLE',
        'CONSTRUCTOR_VERSION_UNVERIFIABLE',
        `no ConstructorVersionRecord for ${constructorId}`,
      );
    }

    // --- structural conformance, before any cryptography -------------------------------
    if (record.constructorId !== constructorId) {
      deny(
        'NOT_CANONICALISABLE',
        'CONSTRUCTOR_VERSION_UNVERIFIABLE',
        'record constructor_id does not match the registered constructor',
      );
    }
    if (record.actionClass !== actionClass) {
      deny(
        'NOT_CANONICALISABLE',
        'CONSTRUCTOR_VERSION_UNVERIFIABLE',
        `record action_class ${record.actionClass} does not match ${actionClass}`,
      );
    }
    if (!isActionClass(record.actionClass)) {
      deny(
        'NOT_CANONICALISABLE',
        'CONSTRUCTOR_VERSION_UNVERIFIABLE',
        'record action_class is not in the closed catalogue',
      );
    }
    for (const [name, value] of [
      ['semantic_major', record.semanticMajor],
      ['non_semantic_minor', record.nonSemanticMinor],
    ] as const) {
      if (!Number.isSafeInteger(value) || value < 0) {
        deny(
          'NOT_CANONICALISABLE',
          'CONSTRUCTOR_VERSION_UNVERIFIABLE',
          `${name} is not a non-negative integer`,
        );
      }
    }
    if (!(record.signedAt instanceof Date) || Number.isNaN(record.signedAt.getTime())) {
      deny('NOT_CANONICALISABLE', 'CONSTRUCTOR_VERSION_UNVERIFIABLE', 'signed_at is not a Date');
    }
    const seen = new Set<string>();
    for (const field of record.changedFields) {
      if (!CHANGED_FIELD_SET.has(field)) {
        deny(
          'NOT_CANONICALISABLE',
          'CONSTRUCTOR_VERSION_UNVERIFIABLE',
          `changed_fields carries an undeclared member ${field}`,
        );
      }
      if (seen.has(field)) {
        deny(
          'NOT_CANONICALISABLE',
          'CONSTRUCTOR_VERSION_UNVERIFIABLE',
          `changed_fields carries ${field} twice`,
        );
      }
      seen.add(field);
    }
    // `26 §2.1.2`: semantic BY DEFINITION, "and cannot be declared otherwise".
    const touchesSemantic = record.changedFields.some((field) => SEMANTIC_SET.has(field));
    if (touchesSemantic && !record.semanticChange) {
      deny(
        'NOT_CANONICALISABLE',
        'CONSTRUCTOR_VERSION_UNVERIFIABLE',
        'changed_fields intersects the semantic-by-definition set while semantic_change is false',
      );
    }

    // --- signature ---------------------------------------------------------------------
    const bytes = signedBytes(record);
    let valid = false;
    try {
      // Ed25519: the algorithm argument is null, per node:crypto.
      valid = verifySignature(null, bytes, this.#publicKey, record.signature);
    } catch {
      valid = false;
    }
    if (!valid) {
      deny(
        'NOT_CANONICALISABLE',
        'CONSTRUCTOR_VERSION_UNVERIFIABLE',
        'ConstructorVersionRecord signature does not verify',
      );
    }

    return {
      constructorId: record.constructorId,
      actionClass,
      semanticMajor: record.semanticMajor,
      nonSemanticMinor: record.nonSemanticMinor,
      semanticChange: record.semanticChange,
      changedFields: record.changedFields as readonly ChangedField[],
      signedAt: record.signedAt,
      recordHash: hex(
        canonicalHash('acos.constructor_version_record_hash.v1', [{ kind: 'bytes', value: bytes }]),
      ),
    };
  }
}

/**
 * The replay/resume verdict `26 §2.1.2` declares. Provided so the later slice enforces a
 * representation that already exists rather than inventing one.
 *
 * NOT CALLED BY ANY S1B DECISION PATH. The approval state machine is out of S1B scope, and
 * calling this here would be implementing approval-resume semantics by another name.
 */
export type ReplayCompatibility = 'REPLAY_COMPATIBLE' | 'REFUSE_SEMANTIC_MAJOR_CHANGE';

export function replayCompatibility(
  bound: Pick<ConstructorVersionIdentity, 'semanticMajor'>,
  current: Pick<ConstructorVersionIdentity, 'semanticMajor'>,
): ReplayCompatibility {
  return bound.semanticMajor === current.semanticMajor
    ? 'REPLAY_COMPATIBLE'
    : 'REFUSE_SEMANTIC_MAJOR_CHANGE';
}
