/**
 * TEST-ONLY. THE PRODUCTION INTEGRATION SECRET SOURCE, RE-EXPORTED INSIDE THE DOUBLES ROOT.
 *
 * `§11`'s confinement rule requires a descriptor's adapter module AND its secret-source module
 * to resolve inside the declared `runtimeRoot`. Widening the root so it admitted both this
 * directory and `validation/sendgrid/integration/` would weaken the check the rule exists for.
 *
 * So the FACTORY is the production one, unchanged — including correction 3's rule that the
 * provenance is assigned by the MECHANISM and never read from the document — and only its
 * LOCATION is local. An offline run therefore resolves its credential exactly as a live run
 * would, and reports `SYNTHETIC_TEST_IDENTITY`, which is the honest answer for a file.
 */
export { createAdapterSecretSource } from '../../../validation/sendgrid/integration/secretSource.js';
