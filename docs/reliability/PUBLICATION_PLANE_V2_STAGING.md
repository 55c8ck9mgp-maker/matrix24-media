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
4. Metricool adapter with a single call per owned attempt and provider receipt
   handling. If it lacks an idempotency key, ambiguous network outcomes are
   permanently quarantined until account-bound reconciliation proves outcome.
5. Reconciliation adapter that can archive a matching Instagram media ID but
   cannot initiate a replacement publication.
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
