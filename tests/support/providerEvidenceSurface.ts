import { relative, sep } from 'node:path';

/**
 * THE v1.3.8 PROVIDER-EVIDENCE SURFACE — ONE DEFINITION FOR EVERY ABSENCE TEST.
 *
 * =================================================================================
 * WHY THIS EXISTS
 *
 * Slices S1F–S1P asserted, over the whole of `src/`, the ABSENCE of things nothing then needed: a
 * vendor name, an inbound transport, a provider accepted count, a delivery webhook. v1.3.8 (ADR-027,
 * `48 §8` row I1, `50 §2h`) is the accepted architecture that introduces exactly ONE of each, in
 * the AUDIT plane: the closed profile identifier `SENDGRID_EVENT_WEBHOOK_V1` that signed class 28
 * names, the inbound provider-evidence ingress, and the `I36` / `I20` accepted-count operand.
 *
 * The absences are NOT dropped. Each test still scans every file under `src/`. What this module
 * removes, before a scan, is a CLOSED LIST OF EXACT TOKENS, and only from a CLOSED LIST OF FILES:
 *
 *   * the profile identifier and the profile module's own name;
 *   * the profile's two signature-header literals;
 *   * the ingress grammar's `https://` scheme-prefix constant;
 *   * the ingress listener's inbound `node:http` import line;
 *   * the class-28 / `I36` accepted-count vocabulary the architecture defines.
 *
 * Anything else in those files — a SendGrid client, `api.sendgrid.com`, an outbound `node:http`
 * member, `node:https`, a fetch — is still an offender, and any of those tokens in ANY OTHER file is
 * still an offender. Comments are not surfaces and are stripped in these files only.
 * =================================================================================
 */

export const PROVIDER_EVIDENCE_SURFACE_FILES: readonly string[] = Object.freeze([
  'src/audit/providerEvidence/class28.ts',
  'src/audit/providerEvidence/eventPayload.ts',
  'src/audit/providerEvidence/evidenceReader.ts',
  'src/audit/providerEvidence/evidenceStore.ts',
  'src/audit/providerEvidence/ingressIdentity.ts',
  'src/audit/providerEvidence/ingressMain.ts',
  'src/audit/providerEvidence/receiver.ts',
  'src/audit/providerEvidence/sendgridEventWebhookV1.ts',
  'src/kernel/controlArtifacts/bundle.ts',
  'src/kernel/controlArtifacts/providerEvidenceTrust.ts',
]);

const PERMITTED_TOKENS: readonly RegExp[] = [
  /SENDGRID_EVENT_WEBHOOK_V1|sendgridEventWebhookV1|SendGridEventWebhookV1/g,
  /'x-twilio-email-event-webhook-(?:signature|timestamp)'/g,
  /const SCHEME_PREFIX = 'https:\/\/';/g,
  /import \{ createServer, type IncomingMessage, type Server \} from 'node:http';/g,
  /\b(?:acceptedCountOperand|observedAcceptedCount|acceptedClassEventCount|accepted_count_operand|accepted_class_event_count)\b/g,
];

function normalised(path: string): string {
  const repoRelative = path.startsWith(process.cwd()) ? relative(process.cwd(), path) : path;
  return repoRelative.split(sep).join('/');
}

export function isProviderEvidenceSurface(path: string): boolean {
  return PROVIDER_EVIDENCE_SURFACE_FILES.includes(normalised(path));
}

/** The text with the declared surface removed — only for the declared files, unchanged otherwise. */
export function withoutProviderEvidenceSurface(path: string, text: string): string {
  if (!isProviderEvidenceSurface(path)) return text;
  let out = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  for (const token of PERMITTED_TOKENS) out = out.replace(token, '<V1.3.8-PROVIDER-EVIDENCE>');
  return out;
}
