# MATRIX 24 reconciliation staging

Standalone staging Worker for a read-only Instagram `GET /<media-id>` reconciliation check.

## Boundary

- Worker name is `matrix24-reconciliation-staging`, never `matrix24-publisher`.
- The GitHub Action `Deploy reconciliation staging` is manually dispatched only.
  It deploys this Worker with `--keep-vars`, so it does not replace dashboard
  bindings or staging secrets.
- No cron, queue, GitHub, Supabase, publishing, media generation, comment, message, webhook, or Phase 2 binding.
- The sole outbound request is one HTTPS `GET` to `graph.instagram.com/<media-id>`.
- `IG_READ_TOKEN` is a Cloudflare staging secret. It is never committed, returned, logged, or copied into a response.
- The configured account ID and exact username must both bind the lookup before it can be reported as confirmed.

## Endpoints

- `GET /health` returns static safety state and performs no provider request.
- `GET /lookup/<numeric-media-id>` performs one bounded lookup. It returns a sanitized confirmation only for the configured account and username.
- `GET /auth/instagram/callback` is a staging-only OAuth return route. It
  discards all query parameters and returns a static completion page; it never
  logs, stores, reflects, or exchanges authorization artifacts.

## Deployment gate

Merge and review are required before deployment. A staging deployment needs `IG_READ_TOKEN` set interactively as a secret. Do not set this secret on `matrix24-publisher` or any production environment.
