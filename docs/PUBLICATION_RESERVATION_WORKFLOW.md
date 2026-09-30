# SUPERSEDED — HISTORICAL ONLY\n\n> This design is not active. Core v2 owns publication claims; `.github/workflows/publication-reservation.yml` is a disabled read-only tombstone. Do not restore the schedules, writers, or Auto Publisher split described below. Current ownership is defined by `core-v2/actor-authority.mjs` and `scripts/queue-transition-ownership.mjs`.\n\n# Publication Reservation Workflow (INC-018 fix)

## Problem Statement

INC-018: The Auto Publisher (ChatGPT scheduled task) attempts to perform a SHA-conditional write to GitHub to create a `publish_attempt_id` before invoking Metricool/Instagram. ChatGPT's platform safety layer blocks this write as "too risky for an LLM to perform", and disables the entire recurring task rather than retrying. Result: content gets stuck in `ready_to_publish` indefinitely.

**Root cause:** An LLM-driven task should not perform conditional writes to production data structures, even in a deterministic manner. This is a valid platform safety decision.

**Solution:** Move the SHA-conditional write out of the LLM task and into a deterministic GitHub Actions workflow that runs on a schedule. The Auto Publisher then only proceeds with the external publication call AFTER the reservation workflow has created the `publish_attempt_id`.

## Design

### Components

#### 1. `.github/workflows/publication-reservation.yml`

Scheduled GitHub Actions workflow that runs every 5 minutes.

**Inputs:**
- Runs on schedule: `*/5 * * * *` (every 5 minutes)
- Can be manually triggered: `workflow_dispatch`

**Outputs:**
- Creates `publish_attempt_id` for `ready_to_publish` records via GitHub API
- Updates queue records via SHA-conditional writes (prevents races)
- Logs summary to workflow run

**Key features:**
- Serialized via concurrency group: only one reservation cycle runs at a time
- Deterministic: no LLM, no external calls except GitHub API
- Race-safe: uses SHA-conditional writes (CAS) to detect conflicts
- Idempotent: finding the same record twice is safe (second run sees `publishing` status, skips it)

#### 2. `scripts/prepare-publication-reservation.mjs`

Scans the queue and identifies records ready for publication reservation.

**Input:**
- Reads all `queue/*.json` files

**Algorithm:**
1. For each record in `queue/`:
   - Check status is `ready_to_publish`
   - Check no `publish_attempt_id` exists yet
   - Check no other publication evidence present (no `instagram_media_id`, `permalink`, etc.)
   - Validate using `publication-plane-policy.mjs` (same checks the Auto Publisher would run)
   - Validate ownership: Publication plane owns this transition
2. Return list of records that need reservations

**Output:**
```json
{
  "timestamp": "2026-09-28T12:34:56Z",
  "reservations": [
    {
      "content_id": "matrix24-...",
      "queue_path": "queue/matrix24-....json",
      "current_sha": "abc123...",
      "attempt_id": "550e8400-e29b-41d4-a716-446655440000",
      "current_record": {...},
      "reserved_record": {...}
    }
  ],
  "skipped": [...],
  "errors": [...],
  "count": 1
}
```

#### 3. `scripts/apply-publication-reservations.mjs`

Applies the reservation plan via GitHub API.

**Input:**
- Plan JSON from `prepare-publication-reservation.mjs`
- GitHub token (`GH_TOKEN` or `GITHUB_TOKEN` env var)
- Repository name (`GITHUB_REPOSITORY` env var)

**Algorithm:**
1. For each reservation in the plan:
   - Fetch current SHA from GitHub
   - Compare with expected SHA (detects races)
   - If SHAs match: perform GitHub API write with new record
   - If SHAs don't match: log as conflict, skip (another workflow run will handle it)
2. Report summary

**GitHub API call:**
```
PUT /repos/{owner}/{repo}/contents/{queue_path}
{
  "message": "Publication reservation: {content_id} (publish_attempt_id created)",
  "content": "<base64-encoded JSON>",
  "sha": "{expected_sha}"
}
```

GitHub API enforces SHA match: if SHAs don't match, returns `409 Conflict`. This is the mechanism that prevents two concurrent writes to the same record.

### Data Flow

```
ready_to_publish record (no publish_attempt_id)
        ↓
[Workflow: publication-reservation.yml runs every 5 min]
        ↓
prepare-publication-reservation.mjs
  - scan queue/
  - identify ready_to_publish without publish_attempt_id
  - validate record meets publication requirements
  - generate attempt_id (UUID v4)
  - plan reservation update
        ↓
apply-publication-reservations.mjs
  - for each reservation:
    - fetch current SHA
    - perform GitHub API write (SHA-conditional)
    - handles race if SHA changed
        ↓
Queue record now has:
  - status: "publishing"
  - publish_attempt_id: "550e8400-..."
  - publishing_started_at: "2026-09-28T12:34:56Z"
  - added entry to publish_attempt_history
        ↓
Auto Publisher (or future Publication Plane scheduler) can now:
  - read record with publish_attempt_id
  - invoke Metricool/Instagram
  - has a durable claim on the record
```

### State Transitions

**Old flow (broken):**
```
ready_to_publish → [Auto Publisher: SHA-conditional write blocked by platform] → STUCK
```

**New flow (fixed):**
```
ready_to_publish 
  → [publication-reservation workflow: SHA-conditional write succeeds]
  → publishing (with publish_attempt_id created)
  → [Auto Publisher reads publish_attempt_id, invokes Metricool]
  → published (with instagram_media_id and permalink)
```

### Ownership and Invariants

From `docs/SCHEDULERS.md`, the transition `ready_to_publish → publishing` is owned by the Publication plane.

This workflow implements that ownership:
- **Only the Publication plane writes during this transition**
- The write includes creating `publish_attempt_id`, setting status to `publishing`, and recording `publishing_started_at`
- The write is validated by `queue-transition-ownership.mjs` (GitHub Actions checks it on every push)

### Concurrency and Race Handling

**Concurrency group:** `publication-reservation`

Only one reservation cycle runs at a time across the entire repository. This prevents two workflows from racing to reserve the same record.

**SHA-conditional writes:** If a race somehow occurs:
1. Workflow A reads record SHA = `abc123`
2. Workflow A checks GitHub - SHA is still `abc123`
3. Workflow B (race) also reads, writes successfully with its attempt_id
4. GitHub now has SHA = `def456` (the new write)
5. Workflow A tries to write with SHA `abc123` → GitHub returns `409 Conflict`
6. Workflow A logs the conflict and moves on
7. Next cycle (5 min later), record is already in `publishing` state → skipped

**Idempotency:** Because the script checks record status before attempting write, a record that's already in `publishing` status is automatically skipped.

### Time Window Analysis

**Timing:**
- Workflow runs every 5 minutes
- Ready-to-publish record could wait 0-5 minutes before first reservation attempt
- SHA-conditional write is atomic: either succeeds or fails with conflict
- No window exists where two concurrent writes could create duplicate publish_attempt_ids

### Visibility and Observability

The workflow:
1. Logs each reservation to the workflow run
2. Reports summary to GitHub Actions job summary
3. Appends entries to `publish_attempt_history` in the queue record
4. Each history entry has `source: 'publication_reservation_workflow'`

The health audit (`production-state-audit.yml`) can distinguish:
- Records stuck in `ready_to_publish` (indicates workflow not running)
- Records in `publishing` (indicates workflow ran successfully)
- Records with stale `publishing_started_at` (indicates Auto Publisher didn't complete)

## Integration with Auto Publisher

The Auto Publisher (ChatGPT task, or future replacement):

1. Reads queue records with status `ready_to_publish` and `publish_attempt_id` set
2. Does NOT attempt to create `publish_attempt_id` itself
3. Does NOT perform SHA-conditional writes
4. Invokes Metricool/Instagram with the durable claim (`publish_attempt_id`)
5. Writes back the result (platform evidence) directly to the queue

This keeps the Auto Publisher a pure publication executor, not a reservation manager.

## Rollback and Recovery

**If the workflow fails:**

- Records remain in `ready_to_publish`
- Next run (5 min later) retries automatically
- No data corruption risk (failed API writes are idempotent)

**If you need to manually revert a reservation:**

1. Open the queue record
2. Delete `publish_attempt_id`, `publishing_started_at`, and `provider`
3. Change status back to `ready_to_publish`
4. Remove the history entry added by the workflow
5. Commit via queue reconciliation PR

(This is an owner decision, not automatic.)

## Testing

The scripts can be tested locally:

```bash
# Plan reservations (dry run)
node scripts/prepare-publication-reservation.mjs > plan.json

# See what it would do
cat plan.json | jq '.reservations'

# Apply reservations (requires GitHub token)
GH_TOKEN="ghp_..." GITHUB_REPOSITORY="55c8ck9mgp-maker/matrix24-media" \
  node scripts/apply-publication-reservations.mjs plan.json
```

Unit tests are in `tests/` (see `queue-transition-ownership.test.mjs` for the pattern).

## References

- **Incident:** `docs/reliability/postmortems/2026-09-27-INC-018.md`
- **Ownership model:** `docs/SCHEDULERS.md`
- **Publication plane policy:** `scripts/publication-plane-policy.mjs`
- **Queue transition validation:** `scripts/queue-transition-ownership.mjs`
- **Production invariants:** `CLAUDE.md`
