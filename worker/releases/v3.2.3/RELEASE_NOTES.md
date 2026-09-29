# matrix24-publisher v3.2.3

Base: `worker/releases/v3.2.2/worker.js`. Only the background prompt, the `negative_prompt` and `VERSION` change.

## Why

The first v3.2.2 render (Asian Games javelin, 2026-09-28 21:46Z) still looked icy. Its prompt contained no Arctic or ice wording: the story is Sports and had a brief, so the geopolitical fallback never applied. The cold look came from the prompt's shape:

- Every image got the shared rules "cinematic abstract visual storytelling" and "sophisticated blue and neutral tones".
- The prompt was about 1,200 characters (well over 200 CLIP tokens). SDXL's text encoders read about 77, so the scene competed with boilerplate and the style tail was likely cut (inferred from the model family, not measured on Workers AI).
- The brief kept negations such as "no real team logos or flags" and "with no identifiable facial likeness"; CLIP has no notion of "no", so these add what they forbid.
- Nothing in `negative_prompt` pushed away from ice or snow.

## What changes

- **Scene first, short prompt.** `Editorial background, no text.` + cleaned brief + `Subject: <headline>.` + one style line with "colors true to the scene". Around 350-450 characters for current queue stories.
- **No forced palette.** The "blue and neutral tones" and "cinematic abstract" rules are gone.
- **Cleaner briefs.** Besides v3.2.2's text/map/label filtering, the brief now drops clauses that only negate ("no ...", "without ..."), trailing "with no ..." tails, "AI-generated", "non-documentary" and "editorial illustration of". The brief cap drops from 320 to 200 characters.
- **Neutral geopolitical fallback.** Security/geopolitics stories with no usable brief get "Atmospheric world-affairs scene at dusk, distant city skyline" instead of "Arctic landscapes, ice, ocean".
- **Ice in the negative prompt.** `ice, snow, frozen, glacier, iceberg, arctic landscape, frost` are added to `negative_prompt` unless the headline or brief is itself about cold places (arctic, polar, snow, glacier, winter...).

Card HTML, headline overlay, JPEG size, queue handling and media-claim behaviour are identical to v3.2.2 (`tests/worker-release-v3.2.3.test.mjs` asserts this).

Source of truth for the builder: `worker/staging/v3.2.0/src/background-prompt.js`, inlined between the `BEGIN/END background-prompt` markers.

## Deploy

Paste `worker/releases/v3.2.3/worker.js` into the Cloudflare dashboard editor for `matrix24-publisher` and deploy, keeping existing vars and secrets.

## Verify

1. `workers_get_worker_code` shows `const VERSION = "3.2.3"`.
2. Open the next rendered JPEG: it should show the story's scene in natural colors, no ice or snow (unless the story is about them), no garbled text.

Images already rendered by v3.2.2 are not re-rendered: the Worker reuses an existing JPEG at the same path.

## Rollback

Paste `worker/releases/v3.2.2/worker.js` back. No queue or schema changes.
