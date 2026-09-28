# Publication Plane v2 — staging only

## Boundary

Publisher v2 is a future independent Publication Plane. This staging scaffold
is a separate Worker project named `matrix24-publication-v2-staging`; it has no
cron, bindings, credentials, network transport or production deployment. Its
only POST route is `/fixture/cycle`, which accepts synthetic inputs and uses an
in-memory fixture adapter. It cannot read or write GitHub, call Metricool,
publish social content, alter queue records, run the Auto Publisher scheduler,
or process a production story.

It depends on the PR #69 reservation policy. Merge #69 before this stacked PR.

## Cycle contract

```text
ready_to_publish + current SHA
  -> server-verified queue:reserve identity
  -> GitHub conditional reservation (future adapter)
  -> publishing + attempt_id
  -> one Metricool call maximum (future adapter)
  -> published + instagram_media_id
     or publish_unknown / reconciliation only
```

The engine receives adapters rather than importing GitHub or Metricool. It
cannot send unless the adapter returns a record that is already durably owned
by the requested attempt ID. It never calls `send` on rejected, stale or
conflicted reservations. It handles a timeout/exception as ambiguous. A
positive provider result followed by archive failure also becomes reconciliation
only; no second provider call is authorized. The sole return to ready requires
explicit proof `transport_not_called`.

## Required production adapter, not in this PR

1. Dedicated runtime distinct from the media-only Worker, protected by a
   private scheduler and authenticated service identity.
2. GitHub App installation token minted server-side, repository-scoped, with
   the smallest contents-write permission required. A GitHub App cannot natively
   restrict individual paths; enforce `queue/<content_id>.json` in code and
   validate it in review. Never use a personal token.
3. Read current blob, validate it through the broker policy, then conditionally
   replace exactly that SHA. A conflict or uncertain acknowledgement prevents
   the social call.
4. Provider adapter with a single call per owned attempt and provider receipt
   handling. If it lacks an idempotency key, ambiguous network outcomes are
   permanently quarantined until account-bound reconciliation proves outcome.
   Two candidate providers are staged, same contract, same safety posture:
   `publisher-v2/staging/src/metricool-schedule-transport.mjs` (current
   provider, free plan capped at 20 posts/month) and
   `publisher-v2/staging/src/postiz-schedule-transport.mjs` (candidate
   replacement, self-hosted and uncapped — see
   `docs/reliability/POSTIZ_TRANSPORT_STAGING.md` for its own gate list;
   requires the owner to self-host Postiz and connect Instagram there
   before any live verification is possible).
5. Reconciliation adapter that can archive a matching Instagram media ID but
   cannot initiate a replacement publication. — Built:
   `publisher-v2/staging/src/reconciliation-archive-adapter.mjs` composes the
   already-deployed read-side lookup (`worker/staging/reliability/
   direct-media-client.mjs` + `policy.mjs`) with the already-fixed
   `github-queue-adapter.archive()`. It takes a candidate media ID as an
   explicit input (same shape as the existing manual
   `instagram-reconciliation.yml` workflow) rather than auto-discovering
   candidates, and refuses to archive any record that is not owned by the
   supplied attempt ID or not in an unresolved (`publishing`/
   `publish_unknown`) state — so it cannot be used to force through a record
   that was never reserved in the first place (see
   `tests/reconciliation-archive-adapter.test.mjs`). Not wired into any
   workflow yet: doing so still needs the same GitHub App identity gate as
   the reservation broker, plus a read-capable Instagram token.
6. Sanitized lifecycle/audit entries correlated by attempt ID. No raw provider
   payloads, headers or secrets in GitHub or public logs.

## Test gates before activation

Use an isolated GitHub repository and a dedicated non-production social account.
Exercise: successful archive, SHA conflict, duplicate delivery, reservation
acknowledgement loss, provider timeout, provider success plus GitHub archive
failure, unknown receipt, recovery with a matching media ID, and recovery with
no match. Assert one provider call at most in every ambiguous case. Do not use
Kohli, any production queue record, or the old Auto Publisher scheduler.

## Commands

```sh
node --test tests/publication-v2-engine.test.mjs
node --check publisher-v2/staging/src/engine.mjs
node --check publisher-v2/staging/src/index.mjs
```

Rollback is a reviewed revert of this scaffold. No runtime rollback is needed
because it is not deployed.
