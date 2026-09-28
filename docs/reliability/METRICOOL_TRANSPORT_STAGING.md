# Metricool schedule transport — staging contract

## Status

`publisher-v2/staging/src/metricool-schedule-transport.mjs` is the first real
HTTP transport for the "one Metricool call maximum" step described in
`docs/reliability/PUBLICATION_PLANE_V2_STAGING.md`. It is not deployed
anywhere, holds no credential, and is not wired into
`publisher-v2/staging/src/index.mjs` (which still uses only its in-memory
`fixtureAdapter`). It makes no network call in any test.

## Why this exists

INC-018 confirmed the reservation write should not be performed by an LLM.
The same principle applies to the publish call itself: once a reservation is
confirmed, the actual Metricool request must be a deterministic HTTP call
made by tested code, not a live tool call a model improvises per cycle. This
module is that call for the schedule step specifically.

## What is verified vs. assumed

**Verified against this repository's own already-reviewed, already-tested
decision logic** (`worker/staging/reliability/metricool-adapter.mjs`,
merged before this change): a Metricool scheduler `id`+`uuid` receipt is
*never* Instagram publication evidence, only `publication: 'pending_provider'`.
This module reuses that logic unchanged rather than re-deciding anything.

**Sourced from Metricool's own public help-center documentation and a
third-party open-source CLI that targets the same API** (not from a live
call against this project's account, and not from an accessible swagger
file — `app.metricool.com/resources/apidocs/swagger.json` is
robots-disallowed to automated fetches from this session):

- Base URL: `https://app.metricool.com/api`
- Endpoint: `POST /v2/scheduler/posts` with `userId` and `blogId` query
  parameters
- Auth header: `X-Mc-Auth: <userToken>`
- Request body fields: `text`, `publicationDate` (`{dateTime, timezone}`),
  `providers` (`[{network:"instagram"}]`), `autoPublish`, `draft`, media as a
  list of already-hosted URLs
- Response fields on schedule acceptance: `id`, `uuid` (already assumed by
  the pre-existing `classifyMetricoolScheduleResult`, now given a real
  caller)

None of the above has been exercised against a live Metricool account by
this session. Treat it as a documented best-effort mapping, not a confirmed
contract, until the gate below is cleared.

## What this module deliberately does NOT do

- It never returns `{kind:'published', ...}`. A schedule acceptance is not
  proof of Instagram publication; only a real, account-bound Instagram media
  ID (obtained through separate reconciliation, e.g. the read-only
  `matrix24-reconciliation-staging` Worker's `/lookup/:media_id`) may
  complete a publish. Every outcome here — success, ambiguous response,
  non-OK status, or thrown network error — maps to the engine's existing
  `'ambiguous'` path, which is safe-by-design (`reconcile_only`, no retry).
- It never treats a network exception as proof nothing was sent. Only a
  precondition failure caught *before* any `fetch` call (the record wasn't a
  genuinely owned `publishing` attempt) is reported as
  `{kind:'not_invoked', proof:'transport_not_called'}`.
- It does not persist the Metricool receipt (`id`/`uuid`) back onto the
  queue record. `publisher-v2/staging/src/engine.mjs`'s `quarantine()` calls
  `adapter.markUnknown({record, attemptId, reason})` and does not currently
  thread through anything from `send()`'s own return value beyond `kind`.
  **This is a known, unresolved gap**: without persisting which Metricool
  post this attempt scheduled, a future reconciliation adapter has less to
  correlate against than it should. Closing this gap requires either a
  reviewed change to `engine.mjs`'s quarantine path, or a different
  composition strategy — deliberately not decided or built in this change.

## Required gates before any activation

1. Validate the request/response shape above against one real, non-production
   Metricool call (a sandboxed or test account, never `matrix24global`,
   never a production queue record).
2. Decide and implement how the schedule receipt (`id`/`uuid`) is durably
   persisted for reconciliation before this is wired into any adapter that
   sees production `ready_to_publish` records.
3. Build the account-bound reconciliation adapter that can archive a
   confirmed Instagram media ID (item 5 of
   `docs/reliability/PUBLICATION_PLANE_V2_STAGING.md`'s "Required production
   adapter" list) — this module's `send()` alone can never complete a
   publish cycle.
4. Independent review of rollback and observability, per the same standing
   requirement already stated for the reservation broker.

## Verification

`node --test tests/metricool-schedule-transport.test.mjs`

The fixtures prove request construction and safe outcome-mapping only. They
do not prove Metricool's real response schema, real error behavior, or
Instagram-side timing — that requires the live-account gate above.
