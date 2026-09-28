# Postiz schedule transport — staging contract

## Status

`publisher-v2/staging/src/postiz-schedule-transport.mjs` is a second
"one provider call maximum" transport for the schedule step described in
`docs/reliability/PUBLICATION_PLANE_V2_STAGING.md`, alongside the existing
Metricool transport. It is not deployed anywhere, holds no credential, and
is not wired into `publisher-v2/staging/src/index.mjs`. It makes no network
call in any test.

## Why this exists

The project's Metricool account is on the free plan (20 posts/month cap).
Postiz (https://postiz.com, MIT/AGPL-3.0, self-hostable) is a candidate
replacement: self-hosted, it has no per-post cap and ships a documented
public REST API, which is what a deterministic transport needs (an LLM must
not perform the live schedule call, per INC-018's root-cause lesson — see
`docs/reliability/METRICOOL_TRANSPORT_STAGING.md`). This module applies the
exact same safety posture to that different provider, built ahead of any
Postiz account existing, so the integration work is ready the moment the
project owner finishes self-hosting Postiz and provides an API key.

## What is verified vs. assumed

**Verified against this repository's own pattern**
(`worker/staging/reliability/metricool-adapter.mjs`, already reviewed and
merged): the same non-negotiable rule applies — a provider scheduler receipt
is never Instagram publication evidence, only `publication: 'pending_provider'`.
`worker/staging/reliability/postiz-adapter.mjs` is a new, separate module
(not a generic rename of the Metricool one) because the wire shapes
genuinely differ, but it enforces the identical contract and was written
with the identical shape of tests (`tests/postiz-lkg-v2-adapter.test.mjs`
mirrors `tests/metricool-lkg-v2-adapter.test.mjs` line for line in intent).

**Sourced from Postiz's own public API documentation** (not from a live
call against any Postiz instance — none is deployed for this project yet):

- Base URL: `https://api.postiz.com/public/v1` (this is Postiz Cloud's
  documented base; a self-hosted instance will use its own origin — the
  transport's `apiBase` option is exactly for that override)
- Endpoint: `POST /posts`
- Auth header: `Authorization: <api-key>` (no `Bearer` prefix documented)
- Request body fields: `type` (`"schedule"`), `date` (ISO 8601),
  `posts[]` each with `integration.id`, `value[]` (`{content, image[]}`),
  `settings.__type` (`"instagram"` for this project)
- Integration/channel id lookup: `GET /integrations` (not yet wrapped by
  this transport — the caller must resolve and supply `integrationId`)
- Response shape on schedule acceptance: **not fully documented publicly**.
  This module conservatively requires a `posts` array (or a bare array) of
  objects each carrying a non-empty `id` before treating the outcome as
  `pending_provider`; anything else — including a response shape this
  assumption doesn't anticipate — safely falls through to `ambiguous`
  (`postiz_schedule_outcome_ambiguous`), never to a false negative that
  would cause a retry. That fallback is the reason it's safe to build this
  ahead of confirming the real response shape.

None of the above has been exercised against a live Postiz instance. Treat
it as a documented best-effort mapping, not a confirmed contract, until the
gate below is cleared.

## What this module deliberately does NOT do

- It never returns `{kind:'published', ...}`. Same rule as the Metricool
  transport, for the same reason: only a real, account-bound Instagram
  media ID (obtained through separate reconciliation) may complete a
  publish. Every outcome here maps to the engine's existing `'ambiguous'`
  path.
- It never treats a network exception as proof nothing was sent. Only a
  precondition failure caught *before* any `fetch` call is reported as
  `{kind:'not_invoked', proof:'transport_not_called'}`.
- It does not resolve `integrationId` itself (no call to `GET /integrations`
  is made by this module) — that lookup, and deciding which integration id
  maps to the project's Instagram account, is left to the caller/config,
  the same way `accountId`/`blogId` are caller-supplied for Metricool.
- It does not persist the Postiz receipt (`postiz_post_ids`) back onto the
  queue record — same known, unresolved gap as the Metricool transport
  (`engine.mjs`'s `quarantine()` doesn't currently thread `send()`'s return
  value through). Not fixed here for the same reason: avoid a speculative
  change to already-merged, security-relevant code.

## Required gates before any activation

1. The project owner self-hosts Postiz (Docker Compose, Railway template, or
   a VPS) and connects the MATRIX 24 Instagram account inside its UI. This
   is a manual, owner-only step: it involves creating a Postiz account and
   completing Instagram/Meta OAuth, both outside anything Claude can do on
   the owner's behalf.
2. Validate the request/response shape above against one real, non-production
   Postiz call (the owner's own newly self-hosted instance, one throwaway
   test post, never a production queue record).
3. Confirm the exact response shape empirically and correct
   `classifyPostizScheduleResult`'s acceptance check if the real shape
   differs from the documented-but-unconfirmed one assumed here.
4. Decide and implement how the schedule receipt is durably persisted for
   reconciliation before this is wired into any adapter that sees
   production `ready_to_publish` records (same open item as Metricool).
5. Build or extend the reconciliation adapter so it can archive a confirmed
   Instagram media ID regardless of which transport (Metricool or Postiz)
   produced the pending schedule — `reconciliation-archive-adapter.mjs`
   already does not care which provider scheduled the post, only that a
   real Instagram media ID is independently confirmed, so this should need
   no change, but must be re-verified once a live Postiz response is in
   hand.
6. Independent review of rollback and observability, per the same standing
   requirement already stated for the Metricool transport and the
   reservation broker.

## Verification

```sh
node --test tests/postiz-lkg-v2-adapter.test.mjs tests/postiz-schedule-transport.test.mjs
```

The fixtures prove request construction and safe outcome-mapping only. They
do not prove Postiz's real response schema, real error behavior, or
Instagram-side timing — that requires the live-instance gate above.
