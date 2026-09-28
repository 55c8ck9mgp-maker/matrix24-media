# MATRIX 24 Worker HTTP API

Reference for the HTTP surface of the production Cloudflare Worker
`matrix24-publisher` (Media Plane) and the staging Workers that sit beside it.

## Sources and confidence

| Source | What it proves |
| --- | --- |
| Live production bundle of `matrix24-publisher`, read-only via the Cloudflare API on 2026-09-28 (version deployed 2026-09-23T17:41:53Z) | The routes, auth, status codes and behavior below. |
| `worker/backups/v3.2.0/recovery/index.reconstructed.js` | Recovery copy of v3.2.0. It is **not** identical to the live bundle; see [Drift between the backup and production](#drift-between-the-backup-and-production). |
| `worker/backups/v3.2.0/config.inventory.json` | Cron `*/15 * * * *`, bindings, secret names. The cron expression was not re-read from Cloudflare for this document. |
| `worker/staging/**`, `worker/reconciliation-staging/**`, `publisher-v2/**` | Staging Worker routes. |

Nothing in this document was learned by calling a production endpoint.

## Summary

| Worker | Method | Path | Class | Auth | Side effects |
| --- | --- | --- | --- | --- | --- |
| `matrix24-publisher` | `GET` | `/`, `/health` | Production, read-only | None | None |
| `matrix24-publisher` | `POST` | `/process-queue` | Production, mutating | Bearer | GitHub queue writes, Workers AI, Browser Run, Supabase upload |
| `matrix24-publisher` | `POST` | `/upload` | Production, mutating (legacy) | Bearer | Supabase upload |
| `matrix24-publisher` | `POST` | `/` | Production, mutating (legacy alias of `/upload`) | Bearer | Supabase upload |
| `matrix24-publisher` | any | anything else | Not routed | — | Returns `404` |
| `matrix24-publisher` | cron | `scheduled()` | Production, mutating | n/a | Same as `/process-queue` |
| `matrix24-publisher-staging` | `GET` | `/`, `/health` | Staging diagnostic | None | None |
| `matrix24-publisher-staging` | `POST` | `/fixture/process` | Staging diagnostic | None | None (in-memory fixture) |
| `matrix24-publication-v2-staging` | `GET` | `/`, `/health` | Staging diagnostic | None | None |
| `matrix24-publication-v2-staging` | `POST` | `/fixture/cycle` | Staging diagnostic | None | None (fixture adapter) |
| `matrix24-reconciliation-staging` | `GET` | `/health` | Staging diagnostic | None | None |
| `matrix24-reconciliation-staging` | `GET` | `/lookup/<media-id>` | Staging diagnostic | None (token is server-side) | One read-only Instagram Graph `GET` |
| `matrix24-reconciliation-staging` | `GET` | `/auth/instagram/callback` | Staging diagnostic | None | None (static HTML) |
| `matrix24-publisher-v2-staging` | — | none | Private runtime | — | No public route, no `workers.dev` |

### Diagnostic routes are not in production

`github-test`, `queue-test`, `ai-test`, `image-test` and `browser-test` do
**not** exist in the deployed v3.2.0 bundle. The router contains the comment
"Diagnostic routes are absent in production, including expensive AI/browser
tests", and every path outside `/`, `/health`, `/process-queue` and `/upload`
returns `404 {"error":"Not found"}` before authentication is checked. There
is also no `/legacy` route: the legacy upload is served on `POST /` and
`POST /upload`.

No source for those older diagnostic handlers is kept in this repository, so
their former contracts are not documented here. They must not be re-added to
`matrix24-publisher`. Diagnostics belong in the separate staging Workers
listed above, which hold no production secrets and cannot write the
production queue.

## Who may call what

| Caller | Allowed | Not allowed |
| --- | --- | --- |
| Cloudflare cron (`*/15 * * * *`) | `scheduled()` → `processQueue(env)` directly, no HTTP | — |
| Observation Plane (Health Watch, audits) | `GET /health` | Any `POST` |
| Auto Publisher (Publication Plane) | Nothing on this Worker is required by the current architecture; it reads `ready_to_publish` records from GitHub. | `/process-queue` |
| Humans / Claude / ad-hoc scripts | `GET /health` | `POST /process-queue`, `POST /upload`, `POST /` (see `CLAUDE.md` and `worker/backups/v3.2.0/ROLLBACK.md`, which freezes manual `/process-queue` use during incidents) |
| Staging tests and CI | Staging Workers only | Anything on `matrix24-publisher` |

No workflow or script in this repository calls a production Worker route. The
current caller of `/upload` / `POST /`, if any, is outside the repository;
this is inferred from the route being named "legacy" and was not verified.

## Shared behavior (`matrix24-publisher`)

**Routing order.** For every request:

1. `GET /` or `GET /health` → `200` health body.
2. Path not in `/process-queue`, `/upload`, `/` → `404`.
3. Method not `POST` → `405` with `Allow: POST`.
4. Bearer token fails → `401`.
5. Handler runs.

So `GET /process-queue` returns `405` and `POST /health` returns `404`, both
without checking auth.

**Authentication.** `Authorization: Bearer <MATRIX24_API_TOKEN>`. The Worker
rejects the request when the secret is unset or shorter than 32 characters,
when the header does not start with `Bearer `, or when the header is longer
than 512 characters. Comparison is on SHA-256 digests with a constant-time
loop.

**Response format.** Every JSON response is pretty-printed with
`content-type: application/json; charset=utf-8` and `cache-control: no-store`.

**Error body.** Handler failures return `{"error": "<CODE>", "request_id": "<uuid>"}`.
The same `request_id` is logged as `matrix24_request_failed` so it can be
found in Cloudflare Workers Logs (persisted, 100% sampling per the
2026-09-25 runtime audit). Raw exception text is never returned.

**Outbound timeouts.** Every GitHub, Supabase and public-URL fetch uses a
15 s timeout and `redirect: "manual"` (a 3xx is treated as a failure). Image
body reads are capped at 8 MiB and 15 s.

---

## `GET /health` (also `GET /`)

Liveness only. No auth, no subrequests, no bindings touched.

```bash
curl -sS https://<matrix24-publisher-host>/health
```

```json
{
  "status": "ok",
  "service": "matrix24-publisher"
}
```

| Status | When |
| --- | --- |
| `200` | Always, if the Worker is up. |

A `200` proves the script is deployed and routing. It does **not** prove that
secrets are valid, that GitHub/Supabase/Workers AI/Browser Run are reachable,
or that the cron is firing (see `docs/reliability/DESIGN.md`).

---

## `POST /process-queue`

Runs one Media Plane cycle: picks at most **one** queue record, claims it,
produces its JPEG and marks it `ready_to_publish`. This is the same function
the cron runs every 15 minutes. It is a production mutation and must not be
called by hand (`CLAUDE.md`, "Claude MUST NOT").

**Request.** No body, no query parameters.

```bash
# Shown for completeness only. Do not run against production.
curl -sS -X POST https://<matrix24-publisher-host>/process-queue \
  -H "Authorization: Bearer $MATRIX24_API_TOKEN"
```

**Algorithm.**

1. List `queue/*.json` via the GitHub Contents API and read every file.
   Any unreadable file → `QUEUE_READ_FAILED`.
2. Every record must have a non-empty, unique `content_id`, else
   `QUEUE_ID_INVALID_OR_DUPLICATE`. One bad record halts the whole cycle.
3. Select a candidate: no `instagram_media_id`, status not `published`, and
   status one of `blocked_media`, `processing_media`, or `ready_to_publish`
   without `public_image_url`. Order: breaking `blocked_media` (400), breaking
   `ready_to_publish` (390), `blocked_media` (300), `ready_to_publish` (200),
   then `processing_media` (0); ties go to the newest `timestamp`.
4. No candidate → return `action: "none"`.
5. Candidate must have `headline` and a non-empty `verified_source_urls`, else
   `QUEUE_CONTENT_INVALID`. An existing `public_image_url` must point into the
   configured Supabase public bucket, else `IMAGE_URL_NOT_ALLOWED`.
6. **Claim**: write `status: "processing_media"` and
   `media_claim: {id, started_at}` with the record's current blob SHA. A
   concurrent writer makes GitHub reject the PUT (409/422) and the cycle fails
   before any paid call.
7. `HEAD` the deterministic object
   `matrix24-<sha256(content_id)>-v1.jpg` (or the existing `public_image_url`).
   If it already exists as `image/jpeg`, reuse it. If the record already had a
   `public_image_url` and the object is missing → `EXISTING_MEDIA_MISSING`.
8. Otherwise generate a background with Workers AI
   (`@cf/bytedance/stable-diffusion-xl-lightning`, 1080×1344, 20 steps),
   render the 1080×1350 card with Browser Run (JPEG, quality 92, ≤ 8 MiB),
   upload to Supabase with `x-upsert: false`, and `HEAD` the public URL to
   confirm it serves `image/jpeg`.
9. Write `status: "ready_to_publish"`, `public_image_url`, `image_filename`,
   `media_ready_at`, `image_spec` (when rendered), remove `media_claim`, and
   append a `media_pipeline` entry to `publish_attempt_history` (last 50 kept).

**Success responses (`200`).**

```json
{ "success": true, "action": "none", "pending_recovery": 0 }
```

```json
{
  "success": true,
  "action": "media_created",
  "content_id": "example-story-2026-09-28",
  "public_image_url": "https://<project>.supabase.co/storage/v1/object/public/matrix24/matrix24-<sha256>-v1.jpg"
}
```

`action` is `media_created` when a new JPEG was rendered and `already_ready`
when an existing object was reused. With the live candidate rule (step 3),
`pending_recovery` is effectively always `0`, because any `processing_media`
record is itself selected before the "none" branch is reached.

**Failure response (`503`).** `processQueue` never throws; it logs
`matrix24_media_failed` and returns:

```json
{
  "success": false,
  "action": "media_failed",
  "error": "MEDIA_RECONCILIATION_REQUIRED",
  "request_id": "5d3c…"
}
```

| `error` | Meaning | Claim written? |
| --- | --- | --- |
| `QUEUE_READ_FAILED` | A queue file could not be read or parsed. | No |
| `QUEUE_ID_INVALID_OR_DUPLICATE` | Missing, blank or duplicate `content_id` anywhere in `queue/`. | No |
| `QUEUE_CONTENT_INVALID` | Selected record lacks `headline` or `verified_source_urls`. | No |
| `IMAGE_URL_NOT_ALLOWED` | Existing `public_image_url` is outside the Supabase public bucket. | No |
| `STORAGE_CONFIG_INVALID` | `SUPABASE_URL` is not `https://*.supabase.co` or `SUPABASE_BUCKET` is malformed. | Depends on where it is first hit; usually no |
| `QUEUE_OR_CLAIM_FAILED` | Any other failure before the claim write succeeded (GitHub error, SHA conflict, timeout). | No, or unknown if the PUT response was lost |
| `EXISTING_MEDIA_MISSING` | Record already pointed at an object that no longer exists. | Yes |
| `MEDIA_RECONCILIATION_REQUIRED` | Any failure after the claim (AI, Browser Run, upload, verification, final GitHub write), or an ambiguous storage `HEAD`. | Yes |

Any code raised after the claim leaves the record in `processing_media`
with its `media_claim`. See [Idempotency and retry](#idempotency-and-retry).

The cron path discards this return value; failures are visible only in
Workers Logs and in the queue state.

---

## `POST /upload` (and legacy alias `POST /`)

Stores a JPEG in the public Supabase bucket under a content-addressed name
and returns its public URL. It does not read or write `queue/`.

**Mode A — raw body.**

```bash
curl -sS -X POST https://<matrix24-publisher-host>/upload \
  -H "Authorization: Bearer $MATRIX24_API_TOKEN" \
  -H "Content-Type: image/jpeg" \
  --data-binary @card.jpg
```

- `Content-Type` must be exactly `image/jpeg` (parameters ignored).
- Body must start with the JPEG magic bytes `FF D8 FF`.
- Max 8 MiB; body read must finish within 15 s.

**Mode B — copy from bucket.**

```bash
curl -sS -X POST "https://<matrix24-publisher-host>/upload?image_url=https%3A%2F%2F<project>.supabase.co%2Fstorage%2Fv1%2Fobject%2Fpublic%2Fmatrix24%2F<file>.jpg" \
  -H "Authorization: Bearer $MATRIX24_API_TOKEN"
```

- `image_url` must be on the configured Supabase origin, under
  `/storage/v1/object/public/<SUPABASE_BUCKET>/`, with no credentials, query
  or fragment. Arbitrary URLs are refused (no SSRF).
- The body is ignored when `image_url` is present.

**Success (`200`).**

```json
{
  "success": true,
  "filename": "upload-<sha256-of-bytes>.jpg",
  "public_url": "https://<project>.supabase.co/storage/v1/object/public/matrix24/upload-<sha256>.jpg",
  "bytes": 245118,
  "content_type": "image/jpeg",
  "verified_public": true
}
```

**Errors.**

| Status | `error` | When |
| --- | --- | --- |
| `400` | `IMAGE_URL_NOT_ALLOWED` | `image_url` fails the allow-list. |
| `400` | `IMAGE_DOWNLOAD_FAILED` | Fetching `image_url` returned non-2xx. |
| `400` | `EMPTY_IMAGE` | Zero-byte body. |
| `408` | `IMAGE_READ_TIMEOUT` | Body not read within 15 s. |
| `413` | `IMAGE_TOO_LARGE` | Declared or streamed size over 8 MiB. |
| `415` | `JPEG_REQUIRED` | Wrong `Content-Type` or bytes are not JPEG. |
| `500` | `STORAGE_CONFIG_INVALID` | Supabase config invalid. |
| `500` | `MEDIA_RECONCILIATION_REQUIRED` | Storage `HEAD` was ambiguous, or upload returned OK but the object is not publicly served as JPEG. |
| `500` | `REQUEST_FAILED` | Any other error, including `STORAGE_UPLOAD_FAILED_<status>` from Supabase. |

---

## Common status codes (`matrix24-publisher`)

| Status | Route(s) | Meaning |
| --- | --- | --- |
| `200` | all | Success (including `action: "none"`). |
| `400` | `/upload`, `/` | Bad input (see table above). |
| `401` | `POST` routes | Missing, malformed or wrong bearer token; or the Worker secret is missing/too short. |
| `404` | any other path | Route does not exist, including every former diagnostic route. |
| `405` | `/process-queue`, `/upload`, `/` with non-`POST` (except `GET /`) | Method not allowed. |
| `408` | `/upload`, `/` | Body read timeout. |
| `413` | `/upload`, `/` | Image over 8 MiB. |
| `415` | `/upload`, `/` | Not a JPEG. |
| `500` | `/upload`, `/` | Server-side failure; body carries `error` + `request_id`. |
| `503` | `/process-queue` | Media cycle failed; body carries `error` + `request_id`. Do not retry blindly. |

---

## Internal dependencies

| Dependency | Binding / secret | Used by | Calls per cycle |
| --- | --- | --- | --- |
| GitHub Contents API (`55c8ck9mgp-maker/matrix24-media`, `queue/`) | `GITHUB_TOKEN` | `/process-queue`, cron | 1 list + 1 read per queue file + up to 2 SHA-guarded PUTs |
| Workers AI `@cf/bytedance/stable-diffusion-xl-lightning` | `AI` | `/process-queue`, cron | 0 or 1 |
| Browser Run (screenshot quick action) | `BROWSER` | `/process-queue`, cron | 0 or 1 |
| Supabase Storage, bucket `matrix24` | `SUPABASE_URL`, `SUPABASE_BUCKET`, `SUPABASE_SECRET_KEY` | all `POST` routes | `HEAD` (+`GET` on 400), 0–1 `POST` upload, confirm `HEAD` |
| Inbound auth | `MATRIX24_API_TOKEN` | all `POST` routes | — |
| Metricool / Instagram | none | **not used** | 0 — the Worker is media-only (production invariant 8). Publication belongs to the Auto Publisher. |

## Rate limits and quotas

The Worker applies **no rate limiting of its own**. Limits come from the
schedule and from upstream services:

| Limit | Value | Effect |
| --- | --- | --- |
| Cron | `*/15 * * * *` | At most 96 cron cycles/day, each handling at most one record → ≤ 96 media renders/day from cron. |
| Records per cycle | 1 | Backlog drains one record per cycle. |
| GitHub REST | 5,000 req/h per token (standard) | Each cycle costs roughly `queue files + 3` requests; a large `queue/` directory scales this linearly. Contents listing returns at most 1,000 entries. |
| Workers AI | Account neuron allowance | One SDXL-Lightning generation per rendered record. |
| Browser Run | Account concurrency/usage limits | One screenshot per rendered record. |
| Supabase | Project plan limits | 8 MiB per object enforced by the Worker. |
| Metricool | 50 posts / 24 h | Applies to the Auto Publisher, not this Worker. |

Manual `POST /process-queue` calls add cycles beyond the cron and are not
counted against any Worker-side budget, which is another reason they are not
allowed.

## Idempotency and retry

**`POST /process-queue` / cron.**

- The GitHub SHA claim is written **before** any paid or storage call, so two
  concurrent cycles cannot both claim the same record: the loser's PUT is
  rejected on the stale SHA.
- The media filename is deterministic per `content_id`, and uploads use
  `x-upsert: false`. A repeat cycle for the same record reuses an existing
  object (`already_ready`) instead of rendering again.
- A `503` does **not** mean nothing happened. After a claim, an object may
  have been uploaded even though the final queue write failed. Resolve by
  inspecting the queue record and the deterministic object, per
  `docs/reliability/RUNBOOKS.md`; never by clearing the claim on age alone.
- Callers must not retry a `503` or a timeout. The next cron cycle is the only
  sanctioned re-entry.
- **Live v3.2.0 differs from the documented intent here**: the deployed
  candidate rule makes the cron re-enter any `processing_media` record
  automatically. This is a known bug, fixed in PR #102 (v3.2.1, not yet
  deployed); see the drift section below.

**`POST /upload`, `POST /`.**

- Content-addressed: identical bytes always map to
  `upload-<sha256>.jpg`. If the object already exists, nothing is uploaded.
- If the upload fails but the object is then found to exist (for example a
  lost response on a successful upload, or a concurrent identical upload),
  the call still returns `200`.
- Safe to retry with the same bytes.

**`GET /health`.** Pure and safe to call at any rate.

## Staging Workers

None of these hold production secrets, write `queue/`, or run on a cron.

### `matrix24-publisher-staging` (`worker/staging/v3.2.0`)

- `GET /`, `GET /health` → `200 {"status":"ok","service":"matrix24-publisher-staging","mode":"staging-fixtures-only","external_side_effects":false,"cron_enabled":false}`
- `POST /fixture/process` with a JSON fixture scenario → `200 {"success":true,"result":…}` or `400 {"success":false,"error":…}`. Runs `runFixtureScenario` in memory.
- Anything else → `404`.

### `matrix24-publication-v2-staging` (`publisher-v2/staging`)

- `GET /`, `GET /health` → `200` with `external_side_effects:false`, `cron_enabled:false`.
- `POST /fixture/cycle` with `{…payload, outcome}` → runs one publication cycle against an in-memory fixture adapter; `400 STAGING_FIXTURE_FAILED` on bad input.
- Anything else → `404`.

### `matrix24-reconciliation-staging` (`worker/reconciliation-staging`)

- `GET /health` → `200 {"status":"ok","mode":…,"publication_allowed":false,"claims_writable":false,"cron_enabled":false}`. No provider call.
- `GET /lookup/<numeric-media-id>` → one bounded `GET graph.instagram.com/<id>`, bound to the configured account id and username. `200` confirmed, `404` not found, `502` other lookup failure, `503 staging_not_configured` when secrets/vars are missing. Staging egress to Meta has failed before (INC-016); the replacement path is `.github/workflows/instagram-reconciliation.yml`.
- `GET /auth/instagram/callback` → static HTML confirmation page.
- Anything else → `404 {"error":"not_found"}`.

### `matrix24-publisher-v2-staging` (`publisher-v2/private-runtime`)

No public route, no `workers.dev`, no preview URLs, `PUBLISHER_V2_ENABLED=false`.
See `docs/reliability/PUBLICATION_V2_PRIVATE_STAGING_RUNTIME.md`.

## Drift between the backup and production

Comparing the live bundle with `recovery/index.reconstructed.js`:

| Area | Backup | Live |
| --- | --- | --- |
| Queue candidate statuses | `blocked_media`, `ready_to_publish` | `blocked_media`, `ready_to_publish`, **`processing_media`** |
| Outbound `fetch` redirect mode | `redirect: "error"` | `redirect: "manual"` |

The first difference is a bug (decided 2026-09-28). The source comment on
`processQueue` says "Claims never expire automatically: an interrupted run
needs reconciliation", and `docs/ARCHITECTURE.md` says the same. The live
bundle instead re-selects any `processing_media` record (lowest priority) on
the next cycle and writes a new `media_claim` over the old one. The
deterministic filename and `x-upsert: false` keep this from creating a second
object for the same `content_id`, but a persistent render failure re-runs
Workers AI and Browser Run every 15 minutes, and `pending_recovery` never
reports stuck records.

The fix (Worker v3.2.1, skip any record carrying a `media_claim`) and a
backup captured from the live bundle are in PR #102. Until v3.2.1 is
deployed, this document describes the live v3.2.0 behavior above; update the
candidate rule in step 3 of `POST /process-queue` when it ships.
