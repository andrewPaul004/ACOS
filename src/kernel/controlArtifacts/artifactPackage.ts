import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { integrityFailure } from './errors.js';

/**
 * The artifact package — where a deployment's signed bytes are read from.
 *
 * =================================================================================
 * THIS IS A LOCATION, NOT A TRUST ANCHOR
 *
 * `50 §3e` pins three things and a directory is not one of them: the two root public keys
 * and `EXPECTED_ACTIVE_MANIFEST_ID`. A package read from the wrong directory produces a
 * manifest whose identity is not the pinned one, or artifact bytes whose digests do not
 * match the pinned manifest's entries, and either way the bootstrap fails closed. So the
 * path carries no authority and nothing here needs to defend it.
 *
 * `50 §3f`'s failure list is why this port has exactly two methods and no third:
 * "**do not silently fall back to an older artifact**; **do not fetch a replacement from
 * the network**." There is no search path, no fallback directory, no "latest" resolution and
 * no fetch. A byte source reads one named file from one named place or it fails.
 * =================================================================================
 */
export interface ControlArtifactByteSource {
  /** For evidence and security logs. Never an authority operand. */
  readonly describe: string;
  /** The manifest document's text, exactly as deployed. */
  readManifestDocument(): string;
  /** One artifact's EXACT bytes. `50 §3c` hashes precisely what this returns. */
  readArtifactBytes(fileName: string): Uint8Array;
}

/** The manifest document's file name inside a package. */
export const MANIFEST_FILE_NAME = 'manifest.json';

/**
 * A package on the local filesystem.
 *
 * `readFileSync` WITHOUT AN ENCODING for artifacts, so what comes back is a `Buffer` of the
 * file's exact bytes. `50 §3c`: "The input is the exact immutable bytes deployed to the
 * consumer. Any byte difference — including a line terminator, a trailing newline or a
 * byte-order mark — changes the digest". Reading as `utf8` and re-encoding would silently
 * normalise a BOM and is the single commonest way an exact-byte rule becomes an
 * approximately-exact-byte rule.
 */
export function filesystemArtifactPackage(root: string): ControlArtifactByteSource {
  return Object.freeze({
    describe: root,
    readManifestDocument(): string {
      try {
        return readFileSync(join(root, MANIFEST_FILE_NAME), 'utf8');
      } catch (error) {
        return integrityFailure(
          'MANIFEST_UNREADABLE',
          `the manifest could not be read from ${root}: ${String(error)}`,
        );
      }
    },
    readArtifactBytes(fileName: string): Uint8Array {
      try {
        return new Uint8Array(readFileSync(join(root, fileName)));
      } catch (error) {
        return integrityFailure(
          'ARTIFACT_BYTES_UNREADABLE',
          `the artifact ${fileName} could not be read from ${root}: ${String(error)}`,
        );
      }
    },
  });
}
