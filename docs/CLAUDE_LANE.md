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
   in the feed, never by age, and never republished automatically.
5. **Daily cap.** At most 4 Claude Lane posts per UTC day, and none if the
   account's `content_publishing_limit` shows less than 10 remaining.
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
   `run-lane.mjs` and workflow `claude-lane-pipeline.yml` (hourly at :41; drafts task hourly at :20).
   While `CLAUDE_LANE_ENABLED` is not `true` every run is a dry run that
   uploads the draft and card as the `claude-lane-preview` artifact.
3c. Drafts written by Claude (2026-10-06). GitHub Models answered every request
   with a bare "OK", so the bilingual drafts are written by a Claude scheduled
   research task ("MATRIX 24 — Claude Lane drafts") that pushes only
   `claude-lane/drafts/<content_id>.json` to branch `claude/lane-drafts`. The
   pipeline adopts at most one new, valid, < 24 h old draft per run, resets all
   state fields, renders the card and marks it `ready_to_publish`. The LLM
   task never touches `main`, `queue/` or Instagram.
4. Token renewal job — `refresh-token.mjs` + `claude-lane-token-refresh.yml` (Mondays 09:23 UTC). Red run = owner action needed.
5. Justen sets `CLAUDE_LANE_ENABLED=true`; first live post observed.

## Rollback

- Immediate stop: set `CLAUDE_LANE_ENABLED` to `false` or delete it.
- Revoke access: remove the "MATRIX 24 Claude Publisher" app from the
  Instagram account (Apps and websites) or delete the
  `IG_CLAUDE_ACCESS_TOKEN` secret.
- Full removal: revert the PRs that added the lane. Posts already
  published stay up; lane records carry `lane: claude` to identify them.
