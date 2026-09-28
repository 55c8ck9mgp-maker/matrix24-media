# matrix24-publisher v3.2.2

Base: `worker/releases/v3.2.1/worker.js`. Only `generateBackground()`'s prompt and `VERSION` change.

## What changes

- **Story image briefs are used.** v3.2.1 read `image_generation_prompt` into `visualBrief` and never sent it to the model. v3.2.2 sends a cleaned copy of the brief.
- **No more forced Arctic look.** v3.2.1 told the model to use "Arctic landscapes, ice, ocean" on every image. v3.2.2 uses that only as a fallback for security/geopolitics stories that have no usable brief.
- **Briefs are cleaned before use.** Many briefs were written for an infographic and ask for maps, headlines, subheads, sources and "AI-GENERATED" labels. SDXL Lightning renders those as garbled lettering, so clauses asking for text, maps, charts, logos, signs or scoreboards are dropped, "MATRIX 24" and "4:5" are removed, and "infographic" becomes "illustration". The brief is capped at 320 characters on a clause boundary.
- **"No text or lettering" now leads the prompt**, ahead of the brief. SDXL's text encoders only read roughly the first 77 tokens, so the rules at the end of the prompt are likely truncated (inferred from the model family, not measured on Workers AI). The `negative_prompt` is unchanged and still excludes text.

The card HTML, headline overlay, JPEG size (1080×1350), queue handling and media-claim behaviour are identical to v3.2.1.

Source of truth for the builder: `worker/staging/v3.2.0/src/background-prompt.js`. The release inlines a copy between `BEGIN/END background-prompt` markers because the Worker is deployed as a single file. `tests/worker-release-v3.2.2.test.mjs` fails if the two drift.

## Deploy

Same path as v3.2.1: paste `worker/releases/v3.2.2/worker.js` into the Cloudflare dashboard editor for `matrix24-publisher` and deploy, keeping existing vars and secrets.

Do not use the `Deploy Worker to production` workflow for this release yet: `worker/releases/*/` holds only `worker.js` and no Wrangler config, so `wrangler deploy` there has nothing to deploy.

## Verify

1. The Cloudflare dashboard (or `workers_get_worker_code`) shows `const VERSION = "3.2.2"`. The Worker has no `/health` route (see `docs/API.md`).
2. Let the next queued story render and open its JPEG: it should match the story's own brief (e.g. floods for a flood story), carry no garbled text in the background, and not show ice or Arctic scenery unless the story is about the Arctic.
3. The hourly audit shows no new `processing_media` stalls.

## Rollback

Paste `worker/releases/v3.2.1/worker.js` back into the dashboard and deploy. No queue record or schema changes, so nothing else needs undoing.
