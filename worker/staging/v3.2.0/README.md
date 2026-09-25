# MATRIX 24 Worker Staging v3.2.0

This is an isolated, fixture-only staging harness for Phase 2.

## Safety boundary

This harness intentionally has no production GitHub token, no Supabase secret, no social integration, no Workers AI binding, no Browser Run binding, no cron trigger, no reference to the production queue path, and no external side effects.

Worker name: matrix24-publisher-staging

This name is intentionally different from production matrix24-publisher.

## Endpoints

GET /health confirms fixture-only staging mode.

POST /fixture/process evaluates one synthetic queue scenario entirely in memory.

## Local checks

From the repository root:

    node --check worker/staging/v3.2.0/src/core.js
    node --check worker/staging/v3.2.0/src/index.js
    node --test tests/worker-staging-v3.2.0.test.mjs
    node scripts/verify-worker-backup.mjs

## Cloudflare deployment policy

Do not deploy this staging Worker until the PR is reviewed and merged.

If deployed later, it must remain named matrix24-publisher-staging and must not receive production secrets or production queue access.

A later Phase 2 step may add isolated staging bindings/resources one at a time after fixture regression tests pass.

`reliability/direct-media-client.mjs` is an un-wired, read-only adapter for a future
staging-only `GET /<media-id>` check. It cannot publish, retry, change a claim, or
configure a webhook. Its runtime secret and HTTP route require a separate reviewed change.
