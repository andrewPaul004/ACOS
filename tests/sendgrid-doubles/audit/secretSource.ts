/**
 * TEST-ONLY. THE PRODUCTION AUDIT SECRET SOURCE, RE-EXPORTED INSIDE THE DOUBLES ROOT.
 *
 * See `../integration/secretSource.ts`: the factory is the production one and only its
 * location is local, so the audit plane's offline run resolves its credential through the same
 * mechanism-assigned-provenance rule the live one would.
 */
export { createAuditReadSecretSource } from '../../../validation/sendgrid/audit/secretSource.js';
