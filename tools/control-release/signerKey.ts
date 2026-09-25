import {
  createPrivateKey,
  createPublicKey,
  sign as ed25519Sign,
  type KeyObject,
} from 'node:crypto';
import { readFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';

import { ed25519FromSeed, oracleKeyId } from '../control-artifacts/framing.js';
import { refuse } from './inventory.js';

/**
 * PRIVATE-KEY INPUT FOR THE OFFLINE CEREMONY — `§35`, `§36` AND `§37` OF THE S1L MANDATE.
 *
 * =================================================================================
 * THE RULES THIS MODULE IS WRITTEN TO, VERBATIM
 *
 * `§35`: "**explicit path supplied by operator; never auto-search home directory; never
 * copy the key into release output; never echo key bytes; never log key bytes; never
 * persist an imported private key.**"
 *
 * `§36`: "Avoid recommending long-lived production private keys in ordinary environment
 * variables. If the tool supports environment input for tests, **label it test-only**."
 *
 * `§37` forbids adding any cloud or network key-management integration or remote signing
 * endpoint unless the architecture already names one, and v1.3.6 names none. `50 §3a`: "**No
 * HSM or vendor is specified here**; production private-key technology remains an operational
 * deployment concern rather than an architecture claim." **No such product is named anywhere
 * in this directory**, and `tests/release/release-boundaries.test.ts` asserts that by
 * scanning for the names rather than by taking this sentence's word for it.
 *
 * =================================================================================
 * WHAT THIS MODULE DOES AND DOES NOT DO
 *
 * It does exactly one thing: turn an OPERATOR-SUPPLIED, EXPLICITLY NAMED private-key file
 * into a signing closure held for the life of one process invocation.
 *
 *   * NO default path. NO search path. NO home-directory lookup. NO private-key environment
 *     variable. An absent `--key-file` is a refusal, never a fallback.
 *   * NO network of any kind. There is no `fetch`, no socket, no vendor SDK and no remote
 *     signing endpoint in this directory, and `tests/release/release-boundaries.test.ts`
 *     asserts that over the whole of `tools/`.
 *   * NO persistence. Nothing writes a private key, a seed, a passphrase or a key
 *     fingerprint anywhere. `tests/release/release-boundaries.test.ts` scans every byte of a
 *     completed release directory for the test keys' own material and requires absence.
 *   * NO secure-deletion claim. `§35`: "Do not invent secure deletion guarantees that normal
 *     filesystems cannot provide." The key is an ordinary object and this module says
 *     nothing about what the operating system does with its pages afterwards.
 *
 * `SignerIdentity` carries the PUBLIC key and the derived `key_id` and never exposes the
 * private half beyond the `sign` closure, so a caller cannot serialise one by accident.
 * =================================================================================
 */

export interface SignerIdentity {
  /** `50 §3a`: `key_id = SHA-256(raw_ed25519_public_key_bytes)`, lowercase hex. */
  readonly keyId: string;
  /** The 32 RAW public-key bytes. Public by definition; safe to print. */
  readonly rawPublicKey: Buffer;
  /** Sign a framed message. The private half never leaves this closure. */
  sign(message: Buffer): Buffer;
}

/** The DER SPKI encoding of an Ed25519 public key: a 12-byte prefix plus 32 raw bytes. */
const ED25519_SPKI_LENGTH = 44;

function identityFrom(privateKey: KeyObject): SignerIdentity {
  const spki = createPublicKey(privateKey).export({ format: 'der', type: 'spki' });
  if (spki.length !== ED25519_SPKI_LENGTH) {
    refuse(
      'RELEASE_SIGNER_KEY_NOT_ED25519',
      'the supplied private key is not an Ed25519 key; 50 §3a declares RFC 8032 PureEdDSA ' +
        'over Curve25519 and there is NO ALGORITHM NEGOTIATION IN S1',
    );
  }
  const rawPublicKey = Buffer.from(spki.subarray(spki.length - 32));
  return Object.freeze({
    keyId: oracleKeyId(rawPublicKey),
    rawPublicKey,
    sign(message: Buffer): Buffer {
      // Ed25519 signs the message DIRECTLY — no pre-hash, no context string (`50 §3a`).
      return ed25519Sign(null, message, privateKey);
    },
  });
}

/**
 * Load a signer from an EXPLICIT operator-supplied file path.
 *
 * The file must be a PKCS#8 Ed25519 private key, PEM or DER. Nothing else is accepted and
 * nothing else is searched for.
 */
export function signerFromKeyFile(keyFilePath: string): SignerIdentity {
  if (keyFilePath === '') {
    refuse(
      'RELEASE_SIGNER_KEY_PATH_REQUIRED',
      'no private-key file was supplied; this tool has no default key path, no search path ' +
        'and no home-directory lookup (§35)',
    );
  }
  if (!isAbsolute(keyFilePath) && !keyFilePath.startsWith('.')) {
    // A bare name resolves against the process working directory, which is the implicit
    // lookup `§35` forbids. An operator names the file explicitly.
    refuse(
      'RELEASE_SIGNER_KEY_PATH_REQUIRED',
      `"${keyFilePath}" is neither absolute nor explicitly relative; supply the private-key ` +
        'path explicitly so the file that signs is the file the operator named (§35)',
    );
  }
  let material: Buffer;
  try {
    material = readFileSync(keyFilePath);
  } catch {
    // The underlying error is not forwarded, because it quotes the path and can be made to
    // carry content in a crafted filename. The operator knows which file they named.
    refuse(
      'RELEASE_SIGNER_KEY_UNREADABLE',
      'the private-key file named on the command line could not be read',
    );
  }
  let privateKey: KeyObject;
  try {
    privateKey = material.toString('utf8').includes('-----BEGIN')
      ? createPrivateKey({ key: material, format: 'pem' })
      : createPrivateKey({ key: material, format: 'der', type: 'pkcs8' });
  } catch {
    // The parser's own message is deliberately not reproduced: it can quote key material.
    refuse(
      'RELEASE_SIGNER_KEY_MALFORMED',
      'the private-key file is not a PKCS#8 Ed25519 private key (PEM or DER)',
    );
  }
  return identityFrom(privateKey);
}

/**
 * A signer from a 32-byte seed. **TEST ONLY**, and named so at every call site.
 *
 * `§36`: "If the tool supports environment input for tests, **label it test-only unless
 * architecture/operations explicitly permits production use.**" The CLI does NOT expose this
 * path — it accepts `--key-file` and nothing else — so a seed reaches a signature only from
 * inside a file that imported a function with `testOnly` in its name.
 */
export function testOnlySignerFromSeed(seed: Buffer): SignerIdentity {
  const { privateKey } = ed25519FromSeed(seed);
  return identityFrom(privateKey);
}

/**
 * `§19` — reject obviously invalid key input, WITHOUT storing a private-key fingerprint.
 *
 * `§19`: "do not store private-key fingerprints as authority if architecture only trusts
 * public-key IDs. The completed package should identify the public key IDs expected by the
 * manifest."
 *
 * So the check is: does this signer's PUBLIC key id equal the one the reviewed candidate
 * declares for this role? `50 §3a` makes that a consistency check and never a trust
 * decision — "The key ID is not the trust anchor by itself; the actual public-key bytes
 * are" — and the runtime still verifies against the externally provisioned public keys.
 */
export function assertSignerMatchesExpectedKeyId(
  signer: SignerIdentity,
  expectedKeyId: string,
  role: string,
): void {
  if (signer.keyId !== expectedKeyId) {
    refuse(
      'RELEASE_SIGNER_KEY_ID_UNEXPECTED',
      `the supplied ${role} key has key_id ${signer.keyId}; the reviewed candidate expects ` +
        `${expectedKeyId}. Signing the wrong candidate produces a DIFFERENT release, not a ` +
        'repaired one',
    );
  }
}
