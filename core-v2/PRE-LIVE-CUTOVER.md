# Core v2 Pre-Live Cutover Checklist

Status: DRY-RUN ONLY. This document does not authorize live publishing.

Required before first controlled live cycle:
- Core v2 CI fully green.
- Migration classification covers all legacy queue records.
- Import writer remains disabled until cutover.
- No legacy record in publishing or publish_unknown with an unresolved active claim.
- Legacy mutators for overlapping transitions are disabled or otherwise proven unable to run.
- Read-only auditors may remain enabled.
- Claude Publisher is the sole publication transition owner.
- Reconciler is the sole publication-confirmation owner.
- Core v2 external network barrier remains active until explicit owner approval.
- Exactly one selected content_id for the controlled live cycle.
- No prior publication claim or external publication evidence for that content_id.
- Rollback means stop/fail closed; never issue a second POST for an ambiguous attempt.

Live activation requires explicit owner authorization after this checklist passes.
