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
  -> persist provider receipt/evidence while status remains publishing
  -> reconciliation decides published / publish_unknown
     or Human Recovery performs an explicitly authorized release
```

The engine receives adapters rather than importing GitHub or Metricool. It
cannot send unless the adapter returns a record that is already durably owned
by the requested attempt ID. It never calls `send` on rejected, stale or
conflicted reservations. It handles a timeout/exception as ambiguous. A
positive provider result followed by archive failure also becomes reconciliation
only; no second provider call is authorized. Publisher v2 never returns a claimed record to ready; any release belongs to Human Recovery.

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
5. Reconciliation remains a separate owner. Publisher v2 does not expose or
   invoke archive, markUnknown, or returnReady operations. After one provider
   attempt it may persist the provider receipt/evidence only while the queue
   remains `publishing`; Reconciliation owns terminal confirmation and Human
   Recovery owns an explicitly authorized release. Any reconciliation runtime
   must use its own reviewed adapter and identity boundary and cannot initiate
   a replacement publication.
6. Sanitized lifecycle/audit entries correlated by attempt ID. No raw provider
   payloads, headers or secrets in GitHub or public logs.

## Test gates before activation

Use an isolated GitHub repository and a dedicated non-production social account.
Exercise: successful archive, SHA conflict, duplicate delivery, reservation
acknowledgement loss, provider timeout, provider success plus GitHub archive
failure, unknown receipt, recovery with a matching media ID, and recovery with
no match. Assert one provider call at most in every ambiguous case. Do not use
Kohli, any production queue record, or the old Auto Publisher scheduler.

## Current private-runtime gate — 2026-09-30

The isolated private runtime is now deployed as `matrix24-publisher-v2-staging` with `workers_dev=false`, preview URLs disabled, no cron, and `PUBLISHER_V2_ENABLED=false`. Its repository boundary is `55c8ck9mgp-maker/matrix24-publication-v2-staging`; production queue records are outside this boundary.

The GitHub App bindings have been configured in the deployed Worker, but activation remains blocked until the deployed runtime proves a real GitHub App installation-token exchange and read access to the isolated staging repository. Unit tests or dashboard binding presence do not substitute for that proof.

This proof MUST NOT be obtained by opening a public HTTP route, adding a cron solely for testing, copying the GitHub App private key into another control plane, enabling a provider transport, or touching a production queue record. If no existing private invocation mechanism can execute the proof, the gate remains fail-closed. A later reviewed private scheduler/service identity may satisfy the gate as part of the intended production architecture.

No Metricool/Instagram call and no production canary is authorized by this document. Phase 2 remains separately gated by explicit owner approval.

## Commands

```sh
node --test tests/publication-v2-engine.test.mjs
node --check publisher-v2/staging/src/engine.mjs
node --check publisher-v2/staging/src/index.mjs
```

Rollback is a reviewed revert of this scaffold. No runtime rollback is needed
because it is not deployed.
