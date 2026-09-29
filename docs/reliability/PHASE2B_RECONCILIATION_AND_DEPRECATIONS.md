# Phase 2B: Instagram reconciliation and removal of unsafe publishers

Date: 2026-09-29. Decision: governance restructuring approved by the owner on
2026-09-29 10:17 UTC ("Aprobado y procede"), which removes autonomous
publishing and auto-retry paths. `docs/GOVERNANCE.md` (Phase 1) should link here.

## Deprecated and removed

| Item | What it did | Why it is unsafe | Action |
| --- | --- | --- | --- |
| `.github/workflows/metricool-recovery.yml` | Every 5 min, found `publishing` records with no media ID after 30 min and called Metricool to create the post again ("Plan B"). | A stalled claim is ambiguous: the first send may have landed. Re-sending is a blind retry after a possibly completed external operation and can publish twice (invariants 1, 2). It also treated age alone as failure. | Already neutered in `50d0c3c` (entrypoint commented out, `contents: read`). Now deleted, along with `scripts/invoke-metricool-recovery.mjs` (legacy writer) and `scripts/detect-metricool-stalled.mjs` (its only consumer). Stall detection remains in `production-state-audit.yml` via `pendingOwner()`. |
| Cloudflare Worker media auto-retry | v3.2.0 re-selected `processing_media` records, re-claiming stuck renders every cron cycle. | Violates "claims never auto-retry" and lost claim ownership (INC-010, Kyiv claimed 3 times). | Fixed in v3.2.1 (PR #102). Checked 2026-09-29 with the Cloudflare connector: the live `matrix24-publisher` reports `VERSION = "3.2.3"` and `selectQueueRecord` still skips any record with `media_claim` and never selects `processing_media`. No change needed. |
| ChatGPT "MATRIX 24 Auto Publisher" scheduled task | Moved `publishing -> published / publish_unknown` and invoked Metricool. | Disabled by ChatGPT's platform after safety denials (INC-017, INC-018). Under the new model ChatGPT does no autonomous publishing. | Marked DEPRECATED in `docs/SCHEDULERS.md`. Its definition lives on ChatGPT's platform, not in this repo; only the owner can delete it there (Claude has no access). It must not be re-enabled. Prompt patches in `docs/reliability/PUBLISHER_PATCH.md` are historical. |

Other ChatGPT tasks (Editorial Engine, Health Watch) do not publish and stay.

## Instagram queue reconciliation

Workflow `.github/workflows/instagram-queue-reconciliation.yml`, script
`scripts/reconcile-instagram-posts.mjs`, tests
`tests/instagram-queue-reconciliation.test.mjs`.

It reads the account's own media (`GET graph.instagram.com/me/media`) with the
existing read-only `IG_READ_TOKEN` secret and compares it with `queue/`.

| Record | Match rule | Effect |
| --- | --- | --- |
| `published`, permalink, no media ID | Exactly one account post whose permalink shortcode equals the archived one | `apply` only: adds `instagram_media_id` and one `instagram_reconciliation` history entry. SHA-conditional write, checked by `classifyQueueWrite` as `published->published` (Recovery). |
| `published`, no match | none | Reported `unresolved`. Status unchanged. |
| `publishing` | Caption match posted after the reservation | Report only: `candidate_caption_match`, `no_candidate` or `duplicate_suspected`. Never written; the publisher owns these. |
| any, two posts with one caption | | Reported `duplicate_suspected`. |

Deviations from the Phase 2B brief, and why:

- **No `publish_unknown` on "not found".** `published -> publish_unknown` is not
  an owned transition, and `DIRECT_MEDIA_LOOKUP.md` says a missing lookup
  result is `unknown`, never proof of non-publication. The five `published`
  records without a media ID all carry an Instagram permalink, which
  `ARCHITECTURE.md` accepts as positive evidence; demoting them would reopen
  published stories (invariant 7).
- **No caption matching for writes.** Captions are not unique identifiers; only
  the permalink shortcode is exact. `publish_attempt_id` never reaches
  Instagram, so it cannot be matched.
- **Manual, not every 30 minutes.** A merged schedule is a deployment. It
  stays manual until a report run has been reviewed; adding the cron is a
  one-line follow-up.
- **No `git push origin main`.** Writes use the GitHub contents API with the
  file SHA, one record per commit, re-read before every attempt. A lost
  response resolves to `already_reconciled`, not a second write.

Retries: Graph reads retry 3 times on network, 429 and 5xx (1s, 2s, 4s); 401/403
and identity mismatch fail closed at once. GitHub CAS conflicts retry 3 times
with a fresh read each time.

Stories: `/me/media` returns feed posts and reels. The queue publishes feed
posts (`/p/` permalinks); stories would need `/me/stories`, which is not used.

## Rollback

`git revert` the PR commit. That restores the (already inert) Metricool
workflow and scripts and removes the reconciliation workflow. Media IDs
written by an `apply` run are additive evidence; to undo one, revert that
reconciliation commit on `main`.
