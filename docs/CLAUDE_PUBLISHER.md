# Claude Publisher (approval-gated publication)

Replaces the ChatGPT Auto Publisher (disabled since INC-018) and the scheduled
Publication Reservation workflow. Nothing is published on a schedule: every post
needs Claude's review and the owner's approval of that specific run.

## Flow

```
ready_to_publish record on main
  │
  ├─ claude-publisher.yml  plan   (every 30 min, read-only)
  │     builds the exact payload, simulates every queue write against the
  │     ownership table, checks the feed for an existing post, and opens a
  │     "Publish request: <content_id>" issue (label publish-request)
  │
  ├─ Layer 1, Claude: reviews the issue, dispatches mode=publish with
  │     content_id, expected_sha (the blob SHA it reviewed), request_issue
  │
  ├─ Layer 2, owner: approves the `instagram-production` deployment in the
  │     Actions run (or rejects it, which cancels)
  │
  └─ publish job
        1. environment really requires a reviewer, or stop
        2. no unresolved attempt of this publisher exists, or stop
        3. fresh read of queue/<id>.json; SHA == expected_sha, or stop
        4. account feed read completely, no post with this caption, or stop
        5. CAS write ready_to_publish -> publishing (new publish_attempt_id,
           provider instagram_graph, approval refs in history); conflict = stop
        6. create private container; failure -> CAS release to
           ready_to_publish with action_not_invoked proof (nothing public)
        7. media_publish, exactly once
             media ID returned -> CAS write published (+ permalink if readable)
             anything else     -> CAS write publish_unknown; no retry
        8. result commented on the request issue; run is red unless published
```

`instagram-reconciliation.yml` (at :20 and :50) is the Recovery plane. It only
lists the account feed. It matches records by full caption, requires exactly one
match from the right account after the media existed, and fills in the media ID
and permalink (`publishing`/`publish_unknown` -> `published`). No match writes
nothing; two matches are reported as a duplicate. Attempts younger than 15
minutes are left to their publish run.

## One-time setup (owner)

1. Settings → Environments → New environment `instagram-production`.
   Add yourself under **Required reviewers**. Restrict deployment branches to
   `main`. The publish job refuses to run if this rule is missing.
2. In that environment (not as repository secrets) add:
   - `IG_PUBLISH_TOKEN`: Instagram token with `instagram_business_content_publish`.
   - `IG_USER_ID`: numeric Instagram user ID of @matrix24global.
3. The existing repository secret `IG_READ_TOKEN` is reused for the plan feed
   check and for reconciliation.
4. Reconciliation writes stay off until you set the repository variable
   `INSTAGRAM_RECONCILIATION_APPLY=true` after reviewing a few read-only runs.
5. The ChatGPT Auto Publisher task must stay disabled on ChatGPT's platform.
   Claude cannot change it; if it is re-enabled, two publishers exist.

## What changed elsewhere

- `publication-reservation.yml`: schedule removed (manual only, deprecated).
  The reservation now happens inside the approved publish job.
- `metricool-recovery.yml`: schedule removed (manual, read-only, deprecated).
- `instagram-reconciliation.yml`: the manual single-media-ID lookup was
  replaced by the scheduled feed reconciliation. The script
  `scripts/reconcile-instagram-media.mjs` still exists for one-off lookups.
- The Cloudflare Worker is media-only and has no publish retry; nothing to disable.

## Rollback

Revert the PR that introduced this file. That restores the 5-minute
reservation schedule, the metricool-recovery schedule (read-only since
50d0c3c) and the manual reconciliation workflow. Records written by this
publisher carry `provider: instagram_graph` and `source:
claude_publisher_workflow` in history, so they are identifiable afterwards;
none of them need to be undone because every write passed the ownership table.
To pause publication without reverting, reject or ignore pending
`instagram-production` deployments. Removing the required reviewer also stops
it, because the publish job then refuses to run.
