# Claude Lane — separate autonomous publication lane

**Approved by:** Justen (project owner), 2026-10-06, in the Claude chat
where he chose "option B" (full autonomy for Claude's own lane) over
per-batch approval. This file and the PR that adds it are the record.

**Status:** governance only. No publishing code exists yet. Nothing runs
until the code below is built, reviewed, tested without publishing, and
Justen sets the repository variable `CLAUDE_LANE_ENABLED=true`.

## What it is

A second lane that researches, writes (Spanish + English), renders and
publishes its own stories to @matrix24global, in parallel with the Core v2
lane (ChatGPT Publisher). The two lanes never share queue records.

| | Core v2 lane | Claude Lane |
| --- | --- | --- |
| Queue | `queue/` | `claude-lane/queue/` |
| Publisher | ChatGPT Publisher (Metricool/Windsor) | GitHub Actions workflow, Instagram Graph API |
| Meta app / token | existing | "MATRIX 24 Claude Publisher" / `IG_CLAUDE_ACCESS_TOKEN` |
| Publication approval | Justen per batch (G4) | none per post; limited by the rules below |

## Rules the lane must enforce in code

1. **Isolation.** Never reads `queue/` for publication and never writes,
   reserves or reconciles anything there. It may read `queue/` and
   `editorial/` only to detect duplicates.
2. **Cross-lane duplicate check.** Before reserving, skip the story if the
   same event (source URLs or normalized headline) is already in `queue/`,
   `editorial/`, or the last 72 h of the live feed.
3. **One durable claim, one attempt.** Commit a `publishing` claim with a
   new `publish_attempt_id` before calling Instagram. Exactly one
   `media_publish` call per attempt.
4. **No blind retry.** A returned media ID means `published`. Anything
   else means `publish_unknown`; it is resolved only by positive evidence
   in the feed, never by age, and never republished automatically. While a
   record is `publishing` or `publish_unknown` the lane publishes nothing
   else; the owner clears a confirmed failure with the Recovery workflow.
5. **Volume and spacing (changed by Justen 2026-10-06).** No daily cap: the
   lane publishes as much relevant news as exists, 24/7. Limits: at least 15
   minutes between lane posts, and none when the account's
   `content_publishing_limit` shows fewer than 10 posts remaining (Instagram
   allows 100 API posts per 24 h, shared with the Core v2 lane).
6. **Kill switch.** Each run exits without side effects unless
   `CLAUDE_LANE_ENABLED` is exactly `true`.
7. **No secrets in logs or records.** The token is used only as a header.
8. **Token renewal.** A scheduled read-only-safe job refreshes the
   long-lived token before expiry and alerts Justen if refresh fails.

All eight Production invariants in `CLAUDE.md` apply unchanged.

## Build order (each step its own PR)

1. Lane queue schema and validator, with tests — `scripts/claude-lane/lane-record.mjs`, `tests/claude-lane-record.test.mjs`, CI `claude-lane-ci.yml`.
2. Publisher workflow in dry-run mode (builds the container payload,
   never calls `media_publish`), with tests for rules 1–7 —
   `scripts/claude-lane/publisher.mjs` (engine, already covers the live
   sequence against fakes), `dedupe.mjs`, `run-publisher.mjs` (refuses live),
   workflow `claude-lane-publisher.yml` (manual, read-only).
   A claim may return to `ready_to_publish` only with a `not_invoked`
   history entry for the same attempt (container failed or never ready, so
   `media_publish` was provably not called).
3. Image rendering for lane stories (free tooling only) —
   `scripts/claude-lane/render_card.py` draws a 1080x1350 text card (no AI
   imagery). The JPEG is committed to `claude-lane/media/` and served from
   raw.githubusercontent.com (`media-url.mjs`); verified 2026-10-06 that the
   URL returns `image/jpeg` and Instagram accepts it for a private container.
3b. Producer and pipeline — `research.mjs` (RSS consensus: the same event
   from >= 2 independent outlets in the last 12 h; bilingual draft written by
   GitHub Models with the job token, free; `guardFacts` rejects any number or
   non-initial capitalized name not present in the sources), `git-store.mjs`
   (CAS on blob hash, only `claude-lane/` paths, a claim counts only once it is
   on `origin/main`), `reconcile.mjs` (exact single caption match only),
   `run-lane.mjs` and workflow `claude-lane-pipeline.yml` (every 15 min at :04/:19/:34/:49; drafts task hourly at :20, up to 3 drafts per run).
   While `CLAUDE_LANE_ENABLED` is not `true` every run is a dry run that
   uploads the draft and card as the `claude-lane-preview` artifact.
3c. Drafts written by Claude (2026-10-06). GitHub Models answered every request
   with a bare "OK", so the bilingual drafts are written by a Claude scheduled
   research task ("MATRIX 24 — Claude Lane drafts") that pushes only
   `claude-lane/drafts/<content_id>.json` to branch `claude/lane-drafts`. The
   pipeline adopts at most one new, valid, < 24 h old draft per run, resets all
   state fields, renders the card and marks it `ready_to_publish`. The LLM
   task never touches `main`, `queue/` or Instagram.
3d. Card v2 (2026-10-06, Justen's request): `claude-lane/render/` builds a
   1080x1350 card from an HTML template (headlines ES/EN with highlights,
   locator map from Natural Earth via world-atlas, summaries, sources) and
   screenshots it with Chromium. The illustration is generated with Cloudflare
   Workers AI (FLUX.1 schnell, free allocation, secret `CF_AI_TOKEN`) from the
   draft's `image_prompt` plus fixed safety rules: generic scenes only, no
   identifiable real people, no text/logos/flags, never presented as a photo of
   the event. Cards with an illustration show "Ilustración IA · AI
   illustration" and the caption adds an AI note (`ai_illustration: true`).
   Any failure falls back to the v1 text card; a story is never blocked.
4. Token renewal job — `refresh-token.mjs` + `claude-lane-token-refresh.yml` (Mondays 09:23 UTC). Red run = owner action needed.
5. Justen sets `CLAUDE_LANE_ENABLED=true`; first live post observed.

## Facebook (approved by Justen 2026-10-07)

Justen asked that the lane's stories also appear on the Matrix24global
Facebook Page, as the Core v2 lane's did through Metricool. Built as a
separate mirror, not inside the Instagram publisher (Phase 3 rule: no single
transaction across platforms):

- Code: `scripts/claude-lane/facebook.mjs` (engine, Graph API client),
  `scripts/claude-lane/run-facebook.mjs`, workflow
  `claude-lane-facebook.yml` (`11,26,41,56 * * * *`, 7 minutes after the
  Instagram pipeline, same `claude-lane` concurrency group).
- Access: Meta app "MATRIX 24 Claude Publisher", use case "Manage everything
  on your Page", permissions `pages_show_list`, `pages_read_engagement`,
  `pages_manage_posts`, granted by Justen for the Matrix24global Page only
  (page id `1300936266441859`). Secret `FB_CLAUDE_USER_TOKEN` (user token,
  about 60 days); the Page token is derived in memory on every run and is
  never stored or logged. Each run reports the days left and turns into a
  warning under 14 days; renewal is a manual owner step for now.
- What it posts: only stories the Instagram side already marked
  `published` (or `reconciled`) in the last hour, oldest first, one per run,
  at least 10 minutes apart. Same caption and image as Instagram. Turning it
  on never back-fills older stories.
- State: only the record's `facebook` sub-object is written
  (`publishing` claim committed before the call, then `published` with the
  post id, `publish_unknown` or `failed`). Status, attempt id and Instagram
  fields are never touched; `checkFacebookTransition` rejects any write that
  would. No state goes back, so there is never a second attempt for a story.
- Switch: live only when `CLAUDE_LANE_ENABLED` **and**
  `CLAUDE_LANE_FB_ENABLED` are exactly `true` (both set by Justen). Otherwise
  scheduled runs are skipped and manual or push runs are read-only dry runs.
- Rollback: set `CLAUDE_LANE_FB_ENABLED` to `false` (Instagram keeps
  running); revoke with `DELETE /me/permissions` from the app or delete the
  `FB_CLAUDE_USER_TOKEN` secret; full removal reverts the PR.

## Breaking news (approved by Justen 2026-10-09)
- Research runs twice per hour (two scheduled drafts tasks, :20 and :50).
- A draft may carry `breaking: true` (exactly `true`; the validator rejects
  any other value). Only major events first reported in the last ~90 min
  qualify. The two-independent-sources rule applies unchanged.
- The pipeline adopts breaking drafts before any other draft (oldest first
  within each group). A story already `ready_to_publish` is not preempted.
- The flag is kept on the queue record and is the only thing that shows the
  "Última hora · Breaking" badge on the card; other cards carry no badge.
- Publisher, dedupe, Facebook mirror and state machine ignore the flag.
- Rollback: revert the PRs; drafts without the flag behave as before.

## Recovery: discarding a `publish_unknown` (owner only, added 2026-10-08)

A `publish_unknown` record blocks the whole lane until it is resolved. The
reconciler resolves it to `published` when the post is in the feed. When the
owner has checked Instagram and the post is not there, the owner runs
**Claude Lane discard (owner only)** (`claude-lane-discard.yml`):

1. Actions → *Claude Lane discard (owner only)* → Run workflow, with
   `content_id`, the same id again in `confirm_content_id`, and a `reason`.
   Leave `apply` off first: it is a dry run that reports what would happen.
2. Run it again with `apply` on. The job runs only for the repository owner.

`scripts/claude-lane/discard.mjs` re-reads the feed and refuses unless the
read succeeds, reaches back past the attempt's `reserved_at`, and shows no post
that matches the caption exactly or loosely; the record must be
`publish_unknown` and at least 15 minutes old. It then writes `discarded`
(terminal) with an `owner_discard` history entry naming who decided, the
attempt id and the feed evidence. It never publishes, retries or re-queues:
the story is not posted again by the lane (it also stays in the lane's
duplicate check). If the post later turns up, it is a published post with a
`discarded` record; nothing is posted twice.

The publisher also records the numeric Meta error code of a failed
`media_publish` in the reason (e.g. `publish_http_400_code_9007`), so the
cause of the next `publish_unknown` can be read from the record.

Settle pause (2026-10-09, watchdog): after the container reports `FINISHED`
the publisher waits `PUBLISH_SETTLE_MS` (20 s) before its single
`media_publish` call, because Meta answered 9007/2207027 ("media not ready")
right after `FINISHED`. Waiting adds no call; any non-success is still
`publish_unknown`. Rollback: revert the PR.

Rollback: revert the PR. If a `discarded` record already exists, the
reverted validator would reject it, so the owner first decides what that
record becomes; the switch `CLAUDE_LANE_ENABLED` still stops the lane at once.

## Rollback

- Immediate stop: set `CLAUDE_LANE_ENABLED` to `false` or delete it.
- Revoke access: remove the "MATRIX 24 Claude Publisher" app from the
  Instagram account (Apps and websites) or delete the
  `IG_CLAUDE_ACCESS_TOKEN` secret.
- Full removal: revert the PRs that added the lane. Posts already
  published stay up; lane records carry `lane: claude` to identify them.
