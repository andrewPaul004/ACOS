import {
  MAILGUN_CAPABILITY_RECORD,
  POSTMARK_DISPOSITION,
  PROVIDER_CAPABILITY_RECORDS,
  REQUIRED_CAPABILITIES,
  RETRIEVED_ON,
  blockingFindings,
  evidencePathIncompatibility,
  selectProvider,
  SENDGRID_CAPABILITY_RECORD,
  type ProviderCapabilityRecord,
} from './capabilityRecord.js';
import { credentialScopesNormativelyCompatible, s1mReadiness } from './s1mReadiness.js';

/**
 * `npm run report:provider-selection` — `§25`'s DATED EVIDENCE RECORD, RENDERED.
 *
 * =================================================================================
 * IT READS AND PRINTS. IT REACHES NOTHING.
 *
 * `§27`: "Do not make any provider send call. [...] No real provider secret should be
 * required." This command constructs no URL, opens no socket, imports no HTTP primitive and
 * reads no environment variable. Every line it prints comes from `capabilityRecord.ts`,
 * which is a frozen transcription of what each provider's OFFICIAL documentation said on
 * `RETRIEVED_ON`.
 *
 * It exists because `§25` asks for a record a human reviews, and a record that can only be
 * read as TypeScript is a record only a developer reviews.
 * =================================================================================
 */

function pad(value: string, width: number): string {
  return value.length >= width ? value : value + ' '.repeat(width - value.length);
}

function renderProvider(record: ProviderCapabilityRecord): readonly string[] {
  const lines: string[] = [];
  const blocking = blockingFindings(record);
  lines.push('');
  lines.push(`PROVIDER: ${record.provider}`);
  lines.push(`  retrieved on              ${record.retrievedOn}`);
  lines.push(`  send scope                [${record.sendCredentialScope.scope.join(', ')}]`);
  lines.push(
    `  audit read scope          [${record.auditReadCredentialScope.scope.join(', ')}]`,
  );
  lines.push(
    `  audit scope send-capable  ${
      record.auditReadCredentialScope.sendCapable === null
        ? 'UNRESOLVED from official documentation'
        : String(record.auditReadCredentialScope.sendCapable)
    }`,
  );
  lines.push(`  attempted-write expected  ${record.attemptedWriteExpectation.expected}`);
  lines.push(
    `  attempted-write TESTED    ${String(record.attemptedWriteExpectation.empiricallyTested)}` +
      '   <- 36 §13 is EMPIRICAL and is NOT discharged by this record',
  );
  lines.push(`  activity query            ${record.activityQuery.endpoints.join(', ')}`);
  lines.push(
    `  correlation               send "${record.correlation.sendField}" / query ` +
      `"${record.correlation.queryField}"`,
  );
  lines.push(`  sandbox mechanism         ${record.sandbox.mechanism.split('.')[0] ?? ''}`);
  lines.push(
    `  sandbox leaves evidence?  ${
      record.sandbox.producesQueryableActivity === null
        ? 'UNRESOLVED from official documentation'
        : String(record.sandbox.producesQueryableActivity)
    }` +
      (record.sandbox.producesQueryableActivity === false
        ? '   <- DOCUMENTED NEGATIVE: this mode CANNOT be the I36 oracle'
        : ''),
  );
  for (const item of record.sandbox.notSuitableFor) {
    lines.push(`      NOT suitable for      ${item}`);
  }
  lines.push(`  I36 validation path       ${record.nonProductionValidationPath.mechanism}`);
  lines.push(
    `    sandbox_mode            ${String(record.nonProductionValidationPath.sandboxModeEnabled)}`,
  );
  lines.push(
    `    controlled recipient    ${String(
      record.nonProductionValidationPath.requiresControlledRecipient,
    )}`,
  );
  const incompatibility = evidencePathIncompatibility(record);
  lines.push(
    `    evidence-compatible?    ${incompatibility === null ? 'YES' : `NO - ${incompatibility}`}`,
  );
  lines.push(
    `  add-on required           ${String(record.retentionAndEntitlement.addOnRequired)}`,
  );
  lines.push('');
  lines.push('  §19 required capabilities:');
  const byCapability = new Map(record.findings.map((f) => [f.capability, f] as const));
  for (const capability of REQUIRED_CAPABILITIES) {
    const finding = byCapability.get(capability);
    lines.push(
      `    ${pad(capability, 30)} ${pad(finding?.status ?? 'NO ROW RECORDED', 12)} ` +
        `${finding?.reference ?? ''}`,
    );
  }
  lines.push('');
  lines.push(
    blocking.length === 0
      ? incompatibility === null
        ? '  RESULT: all five capabilities DOCUMENTED and the test path carries the evidence'
        : '  RESULT: five capabilities DOCUMENTED but the TEST PATH AND EVIDENCE PATH are ' +
          'INCOMPATIBLE'
      : `  RESULT: BLOCKED on ${blocking.map((f) => `${f.capability} (${f.status})`).join(', ')}`,
  );
  if (record.resolvedDocumentedNegatives.length > 0) {
    lines.push('');
    lines.push('  SETTLED BY OFFICIAL DOCUMENTATION - NOT an account-validation question:');
    for (const item of record.resolvedDocumentedNegatives) lines.push(`    - ${item}`);
  }
  if (record.unresolvedAccountItems.length > 0) {
    lines.push('');
    lines.push('  ACCOUNT-LEVEL ITEMS STILL PENDING:');
    for (const item of record.unresolvedAccountItems) lines.push(`    - ${item}`);
  }
  return lines;
}

function main(): void {
  const lines: string[] = [];
  lines.push('ACOS PROVIDER CAPABILITY RECORD — S1O §25');
  lines.push('');
  lines.push(`documentation retrieval date: ${RETRIEVED_ON}`);
  lines.push('basis on every row:           PUBLISHED_DOCUMENTATION');
  lines.push('provider requests made:       NONE (§27)');
  lines.push('');
  lines.push('='.repeat(78));

  for (const record of [SENDGRID_CAPABILITY_RECORD, MAILGUN_CAPABILITY_RECORD]) {
    lines.push(...renderProvider(record));
    lines.push('');
    lines.push('-'.repeat(78));
  }

  lines.push('');
  lines.push(`PROVIDER: ${POSTMARK_DISPOSITION.provider}  (carried forward from S1M, §26)`);
  lines.push(`  disposition               ${POSTMARK_DISPOSITION.disposition}`);
  lines.push(`  reason                    ${POSTMARK_DISPOSITION.reason}`);
  lines.push(
    `  architecture weakened?    ${String(POSTMARK_DISPOSITION.architectureWeakened)}` +
      '    <- I8 and 36 §13 stand unchanged',
  );
  lines.push(`  S1M evidence retained?    ${String(POSTMARK_DISPOSITION.s1mEvidenceRetained)}`);
  lines.push('');
  lines.push('='.repeat(78));

  const decision = selectProvider(PROVIDER_CAPABILITY_RECORDS);
  lines.push('');
  lines.push('§23 DECISION');
  lines.push(`  selected                  ${decision.selected?.provider ?? 'NONE'}`);
  lines.push(`  reason                    ${decision.reason}`);
  if (decision.selected !== null) {
    const compatibility = credentialScopesNormativelyCompatible(decision.selected);
    lines.push(`  scopes compatible (§28)   ${String(compatibility.compatible)}`);
    lines.push(`                            ${compatibility.reason}`);
    const pathIssue = evidencePathIncompatibility(decision.selected);
    lines.push(`  test path carries I36?    ${pathIssue === null ? 'YES' : `NO - ${pathIssue}`}`);
  }

  /*
   * THE READINESS TOKEN IS PRINTED WITH ITS INPUTS UNKNOWN, AND SAYS SO.
   *
   * `§28`'s conjuncts 2 and 3 are facts about a TEST RUN, and this command does not run
   * tests. `tests/provider-selection/s1m-readiness.test.ts` is where the token is computed
   * against the real suite; what is printed here is the provider half alone.
   */
  const providerHalf = s1mReadiness(
    { integrationBoundaryGreen: true, auditReadBoundaryGreen: true, localArchitectureBlockers: [] },
    PROVIDER_CAPABILITY_RECORDS,
  );
  lines.push('');
  lines.push('§28 READINESS — PROVIDER HALF ONLY');
  lines.push(`  ${providerHalf.status}`);
  lines.push('');
  lines.push('  THE TOKEN MEANS: the repository is LOCALLY ready to provision credentials');
  lines.push('  for a DEDICATED NON-PRODUCTION validation environment at that provider.');
  lines.push('  IT DOES NOT MEAN sandbox mode, provider validation, or production readiness.');
  for (const item of providerHalf.resolvedDocumentedNegatives) {
    lines.push('');
    lines.push(`  SETTLED NEGATIVE: ${item}`);
  }
  for (const blocker of providerHalf.blockers) lines.push(`  BLOCKER: ${blocker}`);
  lines.push(
    '  (the integration-boundary and audit-boundary conjuncts are facts about `npm run ' +
      'verify`, not about this record; s1m-readiness.test.ts computes the full conjunction)',
  );
  lines.push('');
  lines.push('THIS IS NOT A STATEMENT THAT PROVIDER VALIDATION IS COMPLETE (§28).');
  lines.push('');

  process.stdout.write(`${lines.join('\n')}\n`);
}

main();
