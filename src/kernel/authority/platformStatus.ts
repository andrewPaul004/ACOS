import type { Client } from '../../db/pool.js';
import { denyAuthority } from './errors.js';

/**
 * Step F — "Agent profile / platform status OK? kill switch not set".
 *
 * `26 §7`'s flowchart edge, verbatim: `F -->|no| D5[DENY: PLATFORM_SUSPENDED]`.
 *
 * ---------------------------------------------------------------------------------
 * THE ABSENT ROW IS THE CASE THIS GATE EXISTS FOR
 *
 * `26 §7`'s opening sentence: "Deterministic, ordered, **fail-closed**."
 *
 * Three ways this can go wrong and all three deny:
 *
 *   the company has NO platform-status row      -> PLATFORM_SUSPENDED
 *   the status is not OPERATING                 -> PLATFORM_SUSPENDED
 *   the kill switch is engaged                  -> PLATFORM_SUSPENDED
 *
 * The first is the one worth stating plainly. A gate that treats "I could not find the
 * status" as "the status is fine" is not a kill switch; it is a kill switch with a
 * documented bypass, and deleting one row is a cheaper attack than engaging with any other
 * control in this document.
 *
 * ---------------------------------------------------------------------------------
 * THE KILL SWITCH IS ITS OWN COLUMN
 *
 * `26 §7` names "platform status OK" and "kill switch not set" as two conditions. They are
 * two columns here for the same reason: folded into one enum, clearing the kill switch and
 * setting the status to OPERATING become the same write, and an operator restoring service
 * after an incident would silently clear the switch as a side effect.
 *
 * ---------------------------------------------------------------------------------
 * NOTHING HERE READS A CALLER-SUPPLIED STATUS
 *
 * `evaluatePlatformStatus` takes a connection, a company and a principal/class pair. It has
 * no status parameter, no override, no cache and no default, so the attack in which a
 * proposer supplies a permissive platform status has no argument position. There is also no
 * caching at all: `24 §7`'s staleness machinery exists for facts with declared `max_age`,
 * and the architecture declares none for platform status, so S1E reads it fresh on every
 * evaluation rather than inventing a permissive cache lifetime.
 * ---------------------------------------------------------------------------------
 */

export interface PlatformStatusRow {
  readonly status: string;
  readonly killSwitch: boolean;
}

export async function evaluatePlatformStatus(
  client: Client,
  companyId: string,
  principalId: string,
  actionClass: string,
): Promise<PlatformStatusRow> {
  const rows = await client.query<{ status: string; kill_switch: boolean }>(
    `SELECT status, kill_switch FROM company_platform_status WHERE company_id = $1`,
    [companyId],
  );
  const row = rows.rows[0];
  if (row === undefined) {
    denyAuthority(
      'F',
      'PLATFORM_SUSPENDED',
      'PLATFORM_STATUS_ABSENT',
      'no authoritative platform status exists for this company',
    );
  }
  if (row.kill_switch) {
    denyAuthority(
      'F',
      'PLATFORM_SUSPENDED',
      'KILL_SWITCH_ENGAGED',
      'the company kill switch is engaged',
    );
  }
  if (row.status !== 'OPERATING') {
    denyAuthority(
      'F',
      'PLATFORM_SUSPENDED',
      'PLATFORM_STATUS_NOT_OPERATING',
      `the company platform status is ${row.status}`,
    );
  }

  // --- the agent profile half ------------------------------------------------------------
  //
  // `24 §3` K14 is the Agent Profile Registry and `I14` requires its capability declarations
  // to match the action catalogue. A class the profile does not declare for this principal
  // is a class this principal has no profile to act under, and the closed default applies.
  const profile = await client.query<{ status: string }>(
    `SELECT status
       FROM agent_profile_capability
      WHERE company_id = $1 AND principal_id = $2 AND action_class = $3`,
    [companyId, principalId, actionClass],
  );
  const capability = profile.rows[0];
  if (capability === undefined) {
    denyAuthority(
      'F',
      'PLATFORM_SUSPENDED',
      'AGENT_PROFILE_CAPABILITY_ABSENT',
      'the agent profile declares no capability for this principal and action class',
    );
  }
  if (capability.status !== 'ENABLED') {
    denyAuthority(
      'F',
      'PLATFORM_SUSPENDED',
      'AGENT_PROFILE_CAPABILITY_SUSPENDED',
      'the agent profile capability is suspended',
    );
  }

  return Object.freeze({ status: row.status, killSwitch: row.kill_switch });
}
