# Publisher v2 GitHub staging adapter

This adapter implements only the durable GitHub queue mutations required by the
fixture Publication Plane v2 engine. It has no scheduler, provider client,
credential minting code, deployment configuration, or public endpoint.

## Credential boundary

The caller supplies `getAccessToken()` from an isolated server runtime after
minting a short-lived GitHub App installation token. The adapter does not accept
a token in HTTP input, store one, log one, or return one. Restrict the App to
this repository; GitHub App permissions cannot restrict a path, so the adapter
enforces the `queue/<content_id>.json` path in code.

## Conditional write

For every mutation, the adapter reads the current `main` blob without cache,
validates its path and SHA, then writes through GitHub Contents API with that
exact SHA. A SHA mismatch, non-ready record, or GitHub 409/422 returns
`conflict`. Any other read/write failure is unconfirmed and throws; it cannot
authorize a provider send.

The adapter archives and quarantines only a record already owned by the exact
attempt ID. It never starts an Instagram/Metricool operation.

## Still required before staging activation

- Run it in a dedicated authenticated runtime; do not add it to the media Worker.
- Install a GitHub App with the minimum repository contents-write permission.
- Use a disposable repository plus a non-production social account.
- Bind the Metricool sender to an owned attempt and add a read-only
  reconciliation adapter.
- Test acknowledgement loss, GitHub conflict, timeout, provider success plus
  archive failure, restart, and duplicate delivery.

No deployment is part of this change.
