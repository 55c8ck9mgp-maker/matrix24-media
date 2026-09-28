# matrix24-publisher v3.2.3

Base: `worker/releases/v3.2.2/worker.js`. Adds race condition fix between Media Worker and Publication Reservation workflow.

## What changes

- **Race condition fix: preserve publish_attempt_id across concurrent writes.** v3.2.2 could overwrite `publish_attempt_id` created by the Publication Reservation workflow if both wrote to the queue file concurrently. v3.2.3 re-reads the current file state before writing the final "media ready" update and preserves any publication reservation fields set by concurrent workflows.

## The Fix

When Media Worker completes image generation:
1. Before the final `updateQueueFile()` call, re-reads the current state from GitHub
2. If the current record has `publish_attempt_id` set (by Publication Reservation workflow), merges it into our update
3. Preserves `publishing_started_at`, `provider`, and `publish_attempt_history` if present
4. Writes back the merged record, ensuring no loss of publication state

This handles the timing window where:
- Media Worker reads record SHA = "abc123" with no publish_attempt_id
- Publication Reservation workflow runs and writes with publish_attempt_id, changing SHA = "def456"
- Media Worker finishes processing and would write without publish_attempt_id
- v3.2.3 detects the new publish_attempt_id and preserves it in the final write

## Race Condition Addressed

**Scenario (v3.2.2 bug):**
1. Media Worker reads blocked_media record, captures SHA = "abc123"
2. Media Worker processes image (takes 5-10 seconds)
3. Publication Reservation workflow runs (every 5 min), adds publish_attempt_id, writes with SHA = "def456"
4. Media Worker finishes, calls updateQueueFile() with outdated SHA "abc123"
5. GitHub API returns 409 Conflict (SHA mismatch) OR overwrites publish_attempt_id
6. Record left in intermediate state

**Solution (v3.2.3):**
- Re-read current state before final write
- Detect that publish_attempt_id now exists
- Preserve it in the final update
- Merge cleanly with media processing results

## Verification

1. The Cloudflare dashboard shows `const VERSION = "3.2.3"`.
2. Deploy to production and monitor for success when Publication Reservation workflow runs concurrently with Media Worker:
   - Records should transition `blocked_media → ready_to_publish (with media) AND publishing (with publish_attempt_id)`
   - No publish_attempt_ids should be lost
   - No 409 conflicts logged
3. The health audit should show no stalled media or publication attempts.

## Deployment

Same as v3.2.2:
1. Paste `worker/releases/v3.2.3/worker.js` into the Cloudflare dashboard editor for `matrix24-publisher`
2. Deploy, keeping existing vars and secrets
3. Verify VERSION is 3.2.3

## Rollback

Paste `worker/releases/v3.2.2/worker.js` back into the dashboard and deploy.

## References

- **INC-018:** Publication Reservation workflow fix (Publication plane owns ready_to_publish → publishing transition)
- **Race condition:** Media Worker reading stale SHA when Publication Reservation workflow writes concurrently
- **Architecture:** `docs/ARCHITECTURE.md`, `docs/SCHEDULERS.md`
