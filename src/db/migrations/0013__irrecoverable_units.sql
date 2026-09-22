-- 0013 — the irrecoverable-unit lifecycle, the v1.3.5 outcome taxonomy, and the
--        dispatch-revalidation identity.
--
-- =================================================================================
-- WHAT THIS MIGRATION IS, AND WHICH DECLARATION EACH PART IMPLEMENTS
--
-- `phase2-v1.3.5-errata.md` resolves two architecture defects and makes three
-- declarations. Four of the six land in the schema:
--
--   MIE-01   `25 §10.1` and `24 §3` K5 declare the irrecoverable-unit lifecycle —
--            RESERVE at step R, PRESUME at `PRESUMED_EXECUTED`, REALISE at `VERIFIED`,
--            RELEASE at `DISPATCH_NOT_SENT_CONFIRMED` and at a proven `NEVER_SENT` —
--            and `51 §2.3` declares the per-class unit counts. PART 1 adds the
--            IMMUTABLE RESERVATION EVIDENCE those transitions move against, and
--            `I20`'s historical denominator is reconstructed from it.
--
--   OBX-04   `25 §7.1` closes the adapter outcome taxonomy and corrects `24 §3` K4's
--            retry. PART 3 widens `outcome_kind`, widens `effect_status`, and REPLACES
--            `0012`'s three fail-closed CHECKs with the declared C4 matrix.
--
--   OBX-05   `25 §7.2` declares `NOT_SENT_CONFIRMED` and the terminal
--            `DISPATCH_NOT_SENT_CONFIRMED`. PART 3 admits both, and PART 4 widens the
--            journal row's domains to match.
--
--   SER-01   `25 §14.1` makes dispatch-time revalidation mandatory before the claim.
--            PART 2 persists the ORIGINAL enumeration/option identity the revalidation
--            compares against, and the kernel-owned task scope the live re-enumeration
--            must run under.
--
-- WHAT IT DOES NOT DO. It enables no real external call. `VERIFIED` and `NEVER_SENT`
-- are NOT added to any domain: `25 §10.1`'s REALISE and never-sent RELEASE rows are
-- reached only from independent provider evidence, and there is no provider. `I20`
-- remains OPEN and `I36`'s verification leg remains OPEN.
-- =================================================================================


-- =================================================================================
-- PART 1 — THE IMMUTABLE IRRECOVERABLE RESERVATION EVIDENCE
--
-- `25 §10.1`, verbatim:
--
--   "**EVERY AUTHORISED IRRECOVERABLE EXTERNAL EFFECT RESERVES ITS IRRECOVERABLE UNITS
--    BEFORE EXECUTION.** The reservation is created at **local authorisation**, in
--    `26 §7` step R's transaction, against **every** applicable MIE window instance the
--    matching grants reference — not the first, not a primary, not the most permissive."
--
-- `reservation_window_instance` is ALREADY that table: `0004` created it precisely to
-- record "which window instances a reservation reserved against", one row per
-- (reservation, window instance), written inside step R's transaction. So the units go
-- on it as a column rather than into a new ledger of their own.
--
-- `phase2-v1.3.5-errata.md §1` is explicit that this is where `I20`'s denominator comes
-- from and why it may NOT come from the live balance column:
--
--   "The **immutable historical authorisation basis** — the set of legitimately committed
--    irrecoverable reservation units evidenced by the committed reservation, effect and
--    window rows — and **not** the current value of `reserved_irrecoverable`. The reason
--    is mechanical: PRESUME and REALISE move units out of that column while leaving the
--    commitment unchanged, so a bound written against the live column tightens as
--    presumptions accumulate and **inverts the invariant's own direction**."
--
-- A DETACHED HISTORICAL LEDGER IS DELIBERATELY NOT CREATED. `§6` of the S1J continuation
-- mandate: "Do not invent a detached historical ledger if the existing immutable
-- reservation records already supply I20's denominator." They do.
-- =================================================================================

ALTER TABLE reservation_window_instance
  ADD COLUMN irrecoverable_units BIGINT NOT NULL DEFAULT 0;

ALTER TABLE reservation_window_instance
  ADD CONSTRAINT rwi_irrecoverable_units_non_negative
    CHECK (irrecoverable_units >= 0);

-- THE EVIDENCE MAY NOT BE REWRITTEN. `UPDATE` ONLY, AND THE ASYMMETRY IS DELIBERATE.
--
-- `0004` left this table without a trigger because nothing wrote to it twice. It is now
-- `I20`'s ACOS-side denominator, and the two directions are not equally dangerous:
--
--   an UPDATE can RAISE the denominator, and a denominator a later statement can raise is
--   a denominator an attacker can raise — `I20`'s bound would admit provider-accepted
--   messages that no authorisation stands behind. REFUSED.
--
--   a DELETE can only LOWER it, which TIGHTENS `I20`'s bound and therefore fails in the
--   safe direction. It is also already constrained from above: the `effect` and
--   `authorisation` rows this evidence joins to carry `acos_append_only` themselves, so a
--   deletion that left the join intact is not reachable through any production path — and
--   `src/` contains no DELETE against this table at all.
--
-- The stronger rule — refusing DELETE as well — is available and was NOT taken, because
-- the accepted negative-control fixtures reset between attempts by deleting their own
-- reservation rows, and a control that must disable the trigger under test proves less
-- than one that does not need to. Recorded as `S1J-C12` in
-- `docs/implementation/S1J-owner-clarifications.md`.
CREATE TRIGGER reservation_window_instance_append_only
  BEFORE UPDATE ON reservation_window_instance
  FOR EACH ROW EXECUTE FUNCTION acos_append_only();


-- =================================================================================
-- PART 1b — THE COMMITTED-RESERVATION RELEASE (OBX-05, `25 §7.2`)
--
-- Declared BEFORE the `I20` view below, which reads `released_at` to disclose the
-- released units separately from the historical basis.
--
-- `25 §7.2`: "For REVERSIBLE and COMPENSABLE money, the still-held reservation is
-- **released under the existing reservation-release semantics.**"
--
-- THERE WERE NO EXISTING COMMITTED-RESERVATION-RELEASE SEMANTICS IN THE IMPLEMENTATION,
-- AND THAT IS AN IMPLEMENTATION GAP RATHER THAN AN ARCHITECTURE ONE. `26 §7` load-bearing
-- property 8 names a release — "a duplicate proposal returns the prior result AND THE
-- RESERVATION IS RELEASED rather than double-counted" — and the accepted S1F implements it
-- by rolling back to a SAVEPOINT, which releases by never having committed. `0004` gave
-- `exposure_reservation` no lifecycle column because no accepted slice released a COMMITTED
-- reservation. S1J is the first that does.
--
-- WHAT IS ADDED IS THE MINIMUM THAT KEEPS `I3` TERM 1 RECONSTRUCTABLE. Without a stamp, a
-- released reservation is indistinguishable from a held one and `reserved_monetary` can no
-- longer be reconciled against the reservations that produced it. With it, `I3` term 1 is
-- the sum over UNRELEASED reservations and the release is evidenced.
--
-- NO NEW LEDGER, NO NEW TERM, NO STATUS MACHINE. One timestamp and one closed reason. The
-- release itself is a decrement of the SAME two terms step R incremented, on the SAME bound
-- window instances — see `src/kernel/exposure/ledger.ts`'s `releaseMonetaryReservation`.
-- Recorded as an implementation decision in
-- `docs/implementation/S1J-owner-clarifications.md`, not as a reading of the architecture.
-- =================================================================================

ALTER TABLE exposure_reservation
  ADD COLUMN released_at     TIMESTAMPTZ,
  ADD COLUMN released_reason TEXT;

ALTER TABLE exposure_reservation
  -- A closed domain with ONE member. `25 §7.2` is the only declared release of a committed
  -- reservation in the architecture, and "widening it is a migration" is the same
  -- fail-closed discipline `0012` applied to `economic_movement`.
  --
  -- `NEVER_SENT` IS DELIBERATELY ABSENT. `25 §10.1`'s never-sent RELEASE row moves
  -- `presumed_irrecoverable`, requires independent provider evidence, and reaches a
  -- different term entirely. There is no provider.
  ADD CONSTRAINT reservation_release_reason_declared
    CHECK (released_reason IS NULL OR released_reason IN ('DISPATCH_NOT_SENT_CONFIRMED')),

  -- The stamp is one fact in two columns and they cannot disagree.
  ADD CONSTRAINT reservation_release_is_paired
    CHECK ((released_at IS NULL) = (released_reason IS NULL));

-- A RELEASE IS ONE-WAY. `0004`'s `reservation_no_increase` trigger already refuses a raised
-- amount, for `I51`; this refuses an UNRELEASE and a rewritten release for the same reason
-- one level up. A reservation that could be un-released is a reservation whose headroom
-- could be consumed twice: release the units, clear the stamp, and the next reader believes
-- the commitment is still held while the balance says it is not.
CREATE FUNCTION reservation_release_is_one_way() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.released_at IS NOT NULL
     AND (NEW.released_at IS DISTINCT FROM OLD.released_at
       OR NEW.released_reason IS DISTINCT FROM OLD.released_reason)
  THEN
    RAISE EXCEPTION 'RESERVATION_RELEASE_IS_ONE_WAY'
      USING ERRCODE = 'ACS52',
            DETAIL  = format('reservation %s was released at %s and may not be un-released '
                             'or re-stamped', OLD.reservation_id, OLD.released_at);
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER reservation_release_is_one_way
  BEFORE UPDATE ON exposure_reservation
  FOR EACH ROW EXECUTE FUNCTION reservation_release_is_one_way();


/*
 * `I20`'s ACOS-SIDE DENOMINATOR, AS A VIEW OVER COMMITTED IMMUTABLE ROWS.
 *
 * `25 §10.1`:
 *
 *     Σ provider-reported accepted irrecoverable effects for a window instance
 *       ≤  Σ legitimately authorised/reserved irrecoverable units for that window instance
 *
 * THIS VIEW IS THE RIGHT-HAND SIDE AND NOTHING ELSE. The left-hand side "requires the
 * audit plane's own independent provider read. **An ACOS-side count is not a
 * provider-reported count**, and no local quantity — including an outbox row count, a
 * claim count or a mock's acceptance count — may be substituted for it." So `I20` remains
 * OPEN after this migration, and what the migration makes true is only that its
 * right-hand side is structurally present and reconstructable.
 *
 * IT READS NO BALANCE COLUMN. Every operand is an immutable committed row —
 * `reservation_window_instance` (append-only as of this migration), `exposure_reservation`
 * and `authorisation` — so the figure is invariant under PRESUME, REALISE and RELEASE.
 * `tests/integration/exposure/mie-reservation.test.ts` asserts exactly that: it reserves a
 * unit, moves it `reserved → presumed`, observes `reserved_irrecoverable = 0`, and reads
 * this view still reporting one authorised unit.
 */
CREATE VIEW i20_authorised_irrecoverable_units AS
  SELECT rwi.company_id,
         rwi.window_id,
         rwi.window_instance_key,
         -- `25 §10.1`'s basis, verbatim: "the immutable set of legitimately committed
         -- irrecoverable reservation units associated with the window instance". EVERY
         -- committed unit, including one later presumed, realised or released.
         SUM(rwi.irrecoverable_units)::BIGINT AS authorised_irrecoverable_units,
         COUNT(*) FILTER (WHERE rwi.irrecoverable_units > 0)::BIGINT AS authorised_reservations,
         -- DISCLOSED SEPARATELY AND DELIBERATELY NOT FOLDED IN.
         --
         -- A unit released at `DISPATCH_NOT_SENT_CONFIRMED` was authorised and provably
         -- never executed, so a reader comparing a provider-reported accepted count against
         -- the historical basis may reasonably want it excluded — a tighter bound detects a
         -- lying adapter, where folding it in would mask one. But `25 §10.1` states the
         -- basis as the immutable committed set and states no exclusion, so the exclusion is
         -- NOT applied here. Both figures are reported; the architecture's own basis is the
         -- column above, and no substitution is made on its behalf.
         COALESCE(SUM(rwi.irrecoverable_units)
                    FILTER (WHERE r.released_at IS NOT NULL), 0)::BIGINT
           AS released_irrecoverable_units
    FROM reservation_window_instance rwi
    JOIN exposure_reservation r ON r.reservation_id = rwi.reservation_id
    JOIN authorisation a ON a.authorisation_id = r.authorisation_id
   WHERE a.recoverability = 'IRRECOVERABLE'
   GROUP BY rwi.company_id, rwi.window_id, rwi.window_instance_key;


-- =================================================================================
-- PART 2 — THE DISPATCH-REVALIDATION IDENTITY (SER-01, `25 §14.1`)
--
-- `25 §14.1`, verbatim:
--
--   "Under the dispatch lease and **before** the claim, the **originally authorised
--    effect** is revalidated against **current authoritative resource state**, using the
--    original `action_class`, the original resource identity, the original
--    enumeration/option identity and the original constructor/version identity."
--
-- `authorisation` already carries the action class, `resource_ref`, `resource_id` and the
-- three constructor-version fields. IT DID NOT CARRY THE ENUMERATION/OPTION IDENTITY,
-- even though `26 §2.1` has always required the AuthorizationRequest to record
-- "enumeration_ref — the enumeration_id and its computed_at" and "the enumerated option
-- whose option_id the selector names". That was a conformance gap in the persisted row,
-- not an architecture gap, and closing it is what makes the mandatory revalidation
-- performable at all.
--
-- BOTH ARE NULLABLE, AND THE NULL CASE IS NARROW AND DECLARED. A rate class is entered
-- through `commitLocalAuthorisation` directly and never traverses C′ (the accepted S1F
-- contract records this, and `26 §7` step C2 is the reason: no constructor is registered
-- for `campaign.budget.set`). Such a row has no enumeration and no option, so the columns
-- are NULL — and `dispatchRevalidation.ts` REFUSES to revalidate a row whose identity is
-- absent rather than treating absence as a pass.
-- =================================================================================

ALTER TABLE authorisation
  ADD COLUMN enumeration_id TEXT,
  ADD COLUMN option_id      TEXT;

COMMENT ON COLUMN authorisation.enumeration_id IS
  '26 §2.1 enumeration_ref. The enumeration the selector named at C′. NULL only for a '
  'class that does not traverse C′ (the rate branch). Read at 25 §14.1 dispatch-time '
  'revalidation and never rebuilt.';
COMMENT ON COLUMN authorisation.option_id IS
  '26 §2.1 selected_option.option_id, content-addressed per 26 §2.2. The identity '
  '25 §14.1 revalidates against the CURRENT live enumeration one epoch later.';


/*
 * THE KERNEL-OWNED TASK SCOPE THE LIVE RE-ENUMERATION RUNS UNDER.
 *
 * `25 §14.1`'s revalidation re-enumerates the CURRENT permissible effects and asks whether
 * the original `option_id` is still among them. That enumeration is scoped by the task's
 * `context_spec` — `24 §3` K4, on what AI may not do: "Enumerate outside the resource set
 * its context_spec admits" — and an `option_id` is content-addressed over a
 * `semantic_option_digest` that, for `refund.create`, includes the task's
 * `reason_code_scope` (`26 §2.2`). So the scope is an INPUT to the identity being
 * compared, and revalidating under a different scope would compare two different things.
 *
 * IT IS PERSISTED HERE, ON THE KERNEL'S OWN ENUMERATION RECORD, RATHER THAN PASSED IN.
 * `26 §2.0.1` already makes this row the kernel's authoritative record of one enumeration,
 * and `0005`'s header states its purpose: evidence "re-derivable from the journaled
 * enumeration". A `context_spec` supplied by a dispatch-time caller would let that caller
 * WIDEN the scope one epoch after the gates ran, which is `24 §3` K4's own prohibition
 * arriving through a side door. Persisting it means the revalidation runs under exactly
 * the scope the authorisation ran under, and no dispatch surface accepts one.
 *
 * NULLABLE, because rows written before this migration have none; the revalidation
 * REFUSES a row whose scope is absent (`STALE`, coarse), rather than substituting a
 * default. Fail-closed, per `51 §2.3`'s "no implicit default may widen authority" applied
 * to a scope instead of a quantity.
 */
ALTER TABLE enumeration_record
  ADD COLUMN context_spec JSONB;

COMMENT ON COLUMN enumeration_record.context_spec IS
  'The kernel-owned task context_spec this enumeration was computed under, persisted so '
  '25 §14.1 dispatch revalidation re-enumerates under the SAME scope. Never supplied by '
  'a dispatch-time caller.';


-- =================================================================================
-- PART 3 — THE v1.3.5 OUTCOME TAXONOMY AND THE C4 MATRIX
--
-- `25 §7.1`'s declared table, verbatim, which is the specification PART 3 encodes:
--
--   | Adapter outcome      | Recoverability | Local effect state                 |
--   | `ADAPTER_RETURNED`   | REVERSIBLE     | `DISPATCHED_AWAITING_VERIFICATION`  |
--   | `ADAPTER_RETURNED`   | COMPENSABLE    | `DISPATCHED_AWAITING_VERIFICATION`  |
--   | `ADAPTER_RETURNED`   | IRRECOVERABLE  | **`PRESUMED_EXECUTED`**             |
--   | `OUTCOME_UNKNOWN`    | REVERSIBLE     | `DISPATCHED_OUTCOME_UNKNOWN`        |
--   | `OUTCOME_UNKNOWN`    | COMPENSABLE    | `DISPATCHED_OUTCOME_UNKNOWN`        |
--   | `OUTCOME_UNKNOWN`    | IRRECOVERABLE  | **`PRESUMED_EXECUTED`**             |
--   | `NOT_SENT_CONFIRMED` | any            | **`DISPATCH_NOT_SENT_CONFIRMED`**   |
--
-- `ADAPTER_FAILED` IS STILL ABSENT FROM THE COLUMN DOMAIN, AND FOR A STRONGER REASON
-- THAN AT `0012`. `0012` excluded it because v1.3.4 declared no state. v1.3.5 declares
-- that it HAS no state: "**Retained for diagnostics only. It carries no local outcome
-- policy and reaches no local state**, because a failure the adapter cannot classify as
-- confirmed-not-sent is a failure whose request may have escaped." So a row carrying it
-- remains unwritable, by declaration rather than by omission.
--
-- `VERIFIED` AND `NEVER_SENT` ARE ABSENT. Both require independent provider evidence
-- (`25 §10.1`'s REALISE and never-sent RELEASE rows), and there is no provider.
-- =================================================================================

ALTER TABLE effect_dispatch_outcome
  DROP CONSTRAINT dispatch_outcome_kind_declared,
  DROP CONSTRAINT dispatch_outcome_effect_status_declared,
  DROP CONSTRAINT dispatch_outcome_returned_is_awaiting_verification,
  DROP CONSTRAINT dispatch_outcome_unknown_is_outcome_unknown,
  -- `0012`'s fail-closed encoding of `S1J-C1`. MIE-01 declares the transition, so the
  -- constraint that made the pair unwritable is retired BY THE DECLARATION and replaced
  -- below by one that requires the declared state instead of forbidding every state.
  DROP CONSTRAINT dispatch_outcome_irrecoverable_unknown_undeclared,
  DROP CONSTRAINT dispatch_outcome_economic_movement_declared;

ALTER TABLE effect_dispatch_outcome
  ADD CONSTRAINT dispatch_outcome_kind_declared
    CHECK (outcome_kind IN ('ADAPTER_RETURNED', 'OUTCOME_UNKNOWN', 'NOT_SENT_CONFIRMED')),

  ADD CONSTRAINT dispatch_outcome_effect_status_declared
    CHECK (effect_status IN ('DISPATCHED_AWAITING_VERIFICATION',
                             'DISPATCHED_OUTCOME_UNKNOWN',
                             'PRESUMED_EXECUTED',
                             'DISPATCH_NOT_SENT_CONFIRMED')),

  -- THE C4 MATRIX, AS THREE BICONDITIONALS OVER `(outcome_kind, recoverability)`.
  --
  -- Written as biconditionals rather than as implications, deliberately: an implication
  -- pins the state a pair reaches and leaves the state reachable from OTHER pairs. `25
  -- §7.1`'s table is a function, and a function encoded one way round is a table with
  -- rows nobody wrote — which is `30 §5.1`'s AUD-05 defect in a CHECK.
  ADD CONSTRAINT dispatch_outcome_c4_awaiting_verification
    CHECK ((effect_status = 'DISPATCHED_AWAITING_VERIFICATION')
           = (outcome_kind = 'ADAPTER_RETURNED' AND recoverability <> 'IRRECOVERABLE')),

  ADD CONSTRAINT dispatch_outcome_c4_outcome_unknown
    CHECK ((effect_status = 'DISPATCHED_OUTCOME_UNKNOWN')
           = (outcome_kind = 'OUTCOME_UNKNOWN' AND recoverability <> 'IRRECOVERABLE')),

  -- `25 §7.1`: "**`ADAPTER_RETURNED` FOR AN IRRECOVERABLE EFFECT REACHES
  -- `PRESUMED_EXECUTED`, NOT AN AWAITING-VERIFICATION STATE.** [...] The unit moves
  -- `reserved → presumed` **exactly once**, on whichever of the two outcomes arrives."
  ADD CONSTRAINT dispatch_outcome_c4_presumed_executed
    CHECK ((effect_status = 'PRESUMED_EXECUTED')
           = (recoverability = 'IRRECOVERABLE'
              AND outcome_kind IN ('ADAPTER_RETURNED', 'OUTCOME_UNKNOWN'))),

  ADD CONSTRAINT dispatch_outcome_c4_not_sent_confirmed
    CHECK ((effect_status = 'DISPATCH_NOT_SENT_CONFIRMED')
           = (outcome_kind = 'NOT_SENT_CONFIRMED')),

  -- `§20` of the S1J mandate, widened by `25 §10.1` and `25 §7.2`. The economic
  -- consequence of THIS outcome, recorded as a value so it is an assertion in the row
  -- rather than an absence a reader has to infer.
  --
  --   NONE                      the money branches. `35 §4`: "The exposure reservation
  --                             **remains held**. It is not released on timeout."
  --   MIE_RESERVED_TO_PRESUMED  `25 §10.1`'s PRESUME row. The three-term sum is UNCHANGED,
  --                             so no headroom is created.
  --   MIE_RESERVED_RELEASED     `25 §10.1`'s confirmed-not-sent RELEASE row, irrecoverable
  --                             ledger. The sum FALLS.
  --   RESERVATION_RELEASED      `25 §7.2`'s money release at `NOT_SENT_CONFIRMED`.
  --
  -- `VERIFIED`/`NEVER_SENT` movements are absent for the reason the header gives.
  ADD CONSTRAINT dispatch_outcome_economic_movement_declared
    CHECK (economic_movement IN ('NONE',
                                 'MIE_RESERVED_TO_PRESUMED',
                                 'MIE_RESERVED_RELEASED',
                                 'RESERVATION_RELEASED')),

  -- THE MOVEMENT AND THE STATE CANNOT DISAGREE. A biconditional per movement, so an
  -- outcome row that recorded `PRESUMED_EXECUTED` while claiming nothing moved — or that
  -- claimed a release on a state that releases nothing — is refused by the database
  -- rather than caught by a reviewer.
  ADD CONSTRAINT dispatch_outcome_movement_matches_status
    CHECK (
      CASE effect_status
        WHEN 'PRESUMED_EXECUTED'            THEN economic_movement = 'MIE_RESERVED_TO_PRESUMED'
        -- `25 §7.2`: the irrecoverable release, or the money release, per class.
        WHEN 'DISPATCH_NOT_SENT_CONFIRMED'  THEN
          economic_movement = CASE WHEN recoverability = 'IRRECOVERABLE'
                                   THEN 'MIE_RESERVED_RELEASED'
                                   ELSE 'RESERVATION_RELEASED' END
        ELSE economic_movement = 'NONE'
      END
    );


-- =================================================================================
-- PART 4 — THE JOURNAL ROW'S DOMAINS
--
-- `30 §5.3a`'s twenty-field order for `acos.journal.dispatch_outcome.v1` is UNCHANGED by
-- v1.3.5 — `0012` branch 7 already transcribes it and `phase2-v1.3.5-errata.md §5` names
-- fields 15/16 as the adjacent same-typed pair, which is exactly the pair `0012` placed
-- there. NO CANONICAL-BYTES FUNCTION IS REDEFINED HERE, so every row already chained
-- recomputes to the `row_hash` it holds.
--
-- What moves is only the two DOMAIN checks, which must admit the states PART 3 admits.
-- The two planes' domains cannot disagree about which kinds and which statuses exist.
--
-- `phase2-v1.3.5-errata.md §5`, on why no unit count is a field of this row:
--
--   "**No MIE quantity is a field of this row.** `25 §10.1`'s movement is evidenced by the
--    committed `window_balance` and reservation rows under the guard; a movement recorded
--    a second time in the chain would be a second place the accounting could disagree with
--    itself. **The outcome row records the state that implies the movement; the ledger
--    records the movement.**"
--
-- So no column is added to `effect_journal` by this migration, and none may be.
-- =================================================================================

ALTER TABLE effect_journal
  DROP CONSTRAINT journal_dispatch_outcome_kind_declared,
  DROP CONSTRAINT journal_dispatch_effect_status_declared;

ALTER TABLE effect_journal
  ADD CONSTRAINT journal_dispatch_outcome_kind_declared
    CHECK (dispatch_outcome_kind IS NULL
           OR dispatch_outcome_kind IN ('ADAPTER_RETURNED', 'OUTCOME_UNKNOWN',
                                        'NOT_SENT_CONFIRMED')),
  ADD CONSTRAINT journal_dispatch_effect_status_declared
    CHECK (dispatch_effect_status IS NULL
           OR dispatch_effect_status IN ('DISPATCHED_AWAITING_VERIFICATION',
                                         'DISPATCHED_OUTCOME_UNKNOWN',
                                         'PRESUMED_EXECUTED',
                                         'DISPATCH_NOT_SENT_CONFIRMED'));

