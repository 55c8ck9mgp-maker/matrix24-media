# MATRIX 24 Testing Strategy

## Goal
Prove that a change does not break the autonomous path or create duplicate side effects.

## Fixtures
All synthetic stories belong under:

`tests/fixtures/`

Never place test stories in production `queue/`.

## Minimum regression cases
1. Normal media claim and completion.
2. SHA conflict during media claim.
3. Existing deterministic media reuse.
4. Media generation failure after claim.
5. Ready-to-publish record with valid media URL.
6. Instagram confirmed success with media ID.
7. Instagram ambiguous result -> `publish_unknown`.
8. Positive reconciliation without republishing.
9. Strict no-match (including cached dual feeds) -> retain claim, reconcile only, no retry.
10. Second ambiguous result -> stop.
11. Missing permalink with valid media ID.
12. Duplicate `content_id` detection.

## Acceptance criteria
A change is not production-ready merely because code review passes.

Required:
- tests pass,
- staging behavior matches expected transitions,
- no production queue is touched,
- rollback is documented,
- LKG comparison shows no unintended behavior change.
