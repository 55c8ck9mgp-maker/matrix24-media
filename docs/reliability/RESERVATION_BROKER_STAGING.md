# Reservation Broker — staging contract

## Status

This is a pure policy model only. It creates no endpoint, deploys nothing,
contains no credential, and has no GitHub, scheduler, Metricool, Instagram or
queue transport. It does not make Auto Publisher operational. Production use
requires a separate reviewed change and explicit approval.

## Why

The scheduler's connected GitHub capability may deny conditional queue writes.
The publication scheduler must therefore not hold a general GitHub write
capability. A future broker may own only the pre-send reservation boundary.
It may never publish, reconcile a social provider, reset a claim, modify a
scheduler, promote content, or generate media.

## Contract

The caller submits exactly:

```json
{
  "content_id":"matrix24-fixture-story",
  "queue_path":"queue/matrix24-fixture-story.json",
  "expected_sha":"40 lowercase hex characters",
  "attempt_id":"uuid",
  "requested_at":"UTC RFC3339 timestamp"
}
```

The trusted server-side adapter supplies a verified short-lived identity:
`matrix24-auto-publisher`, scope exactly `queue:reserve`. JSON from the caller
cannot establish this identity. The policy rejects every extra request field,
bad binding, stale SHA, non-`ready_to_publish` record, prior claim, existing
publication evidence, unverified identity, broad scope and every capability
other than `queue:reserve`.

For a valid request it returns a *proposed* replacement and the expected SHA.
The future adapter must re-read GitHub and perform one conditional replacement
against that exact SHA. Conflict, timeout or uncertain acknowledgement means
`no external send` and reconciliation only. The broker must not retry a social
write because it never has social credentials.

## Required future review gates

1. Choose a dedicated server-side runtime distinct from the current media-only
   Worker, with no production deployment in this PR.
2. Configure short-lived identity authentication and repository-scoped GitHub
   content-write access limited to the queue path; do not use a personal token.
3. Bind request path/content/SHA before the conditional update; log a sanitized
   correlation ID without raw provider responses or credentials.
4. Exercise a disposable staging fixture for success, conflict, replay and
   ambiguous acknowledgement. Do not use Kohli or production queue records.
5. Independently review rollback and observability before enabling any scheduler
   caller. The only response that may enable a publish attempt is a durably
   confirmed reservation.

## Verification

`node --test tests/reservation-broker-policy.test.mjs`

The fixtures prove policy decisions only. They do not prove GitHub atomicity,
identity validation or production exactly-once delivery; those require the
future adapter's dedicated staging test.
