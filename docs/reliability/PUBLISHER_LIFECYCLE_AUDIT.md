# Publisher lifecycle observation journal

## Scope and deployment status

Offline Python 3.9+ CLI with SQLite persistence; no packages to install. Observation
Plane only. No HTTP listener, scheduler adapter, automatic polling, credentials,
publication transport, queue writes, or production integration. Nothing starts
when this module is imported. This change does not fix scheduler deactivation.

An endpoint cannot reveal a provider's hidden audit trail. Start with a local
journal for explicitly collected observations; add a transport only after an
authenticated, supported observation source and private sink are reviewed.
Never give an observer scheduler mutation or publication capabilities.

## Evidence contract

Each input must contain exactly the fields in the example below.

- `observed_at`: UTC time the evidence was read; not the disable timestamp.
- `occurred_at`: actual event timestamp only when exposed; otherwise null.
- `previous_state` / `new_state`: explicit evidence values, including `unknown`.
  A report of a disabled task does not prove a prior enabled state. UI load
  failure and absence from a list never establish a disabled/deleted state.
- `source`: `ui`, `run_report`, or `platform_audit`. A run report is an actor's
  assertion, not a verified scheduler mutation. Only use `platform_audit` for
  an actual provider audit record. The journal cannot authenticate this label.
- `actor`: observed/reported category or `unknown`. Never infer platform actor
  from timing. UI observations cannot attribute actor or reason in this v1.
- `reason_code` / `error_code`: controlled classifications, not raw provider
  reason codes. Unknown reasons stay `unknown`; raw responses are not stored.
- `scheduler_id`: verified task ID or null. Never substitute a conversation ID.
- `event_id`: stable UUID for one observation; persist before first submission
  and reuse it if acknowledgement is lost. New IDs mean new observations.
- `run_correlation_id`: known run UUID, explicitly labeled `platform`, or a
  caller-created UUID labeled `observer`; otherwise null / `unknown`. An
  observer correlation is not proof of a provider run ID.
- `evidence_id`: UUID referencing evidence kept in a separate private case file.
  No raw chat transcript, URLs, captions, credentials or personal identities.
- Journal adds `recorded_at` and a monotonic ingestion `sequence`. Arrival order
  is not event chronology. Out-of-order events remain observations; no current
  scheduler state is derived from them.

Allowed event types: `state_observation`, `run_started`, `run_finished`,
`run_failed`, `observation_failed`. State is `enabled`, `disabled`, or `unknown`.
Actor is `unknown`, `assistant`, `user`, or `platform`. Reasons: `unknown`,
`safety_denial`, `approval_required`, `inactivity`, `chat_deleted`, `manual_pause`.
Errors: `none`, `unknown`, `github_reservation_write_safety_denial`, `ui_load_failed`.

## Manual operation (private local storage only)

Choose a private directory outside this public repository, with permissions 0700.
The database is created exclusively with mode 0600; existing files are never
truncated. Do not use network/shared filesystems, symlinks, or untrusted directories.
Back up with SQLite's backup API under the owner's access controls.

```sh
python3 scripts/publisher_lifecycle_audit.py init --db /private/audit/lifecycle.sqlite3
python3 scripts/publisher_lifecycle_audit.py append --db /private/audit/lifecycle.sqlite3 < observation.json
python3 scripts/publisher_lifecycle_audit.py list --db /private/audit/lifecycle.sqlite3
```

Synthetic observation (all UUIDs are fixture values, not production identities):

```json
{
  "event_id": "11111111-1111-4111-8111-111111111111",
  "observed_at": "2026-09-27T22:00:00Z",
  "occurred_at": null,
  "scheduler_id": null,
  "previous_state": "unknown",
  "new_state": "disabled",
  "event_type": "state_observation",
  "source": "run_report",
  "actor": "assistant",
  "reason_code": "safety_denial",
  "error_code": "github_reservation_write_safety_denial",
  "run_correlation_id": null,
  "correlation_source": "unknown",
  "evidence_id": "22222222-2222-4222-8222-222222222222"
}
```

First append: `{"result":"recorded","sequence":1}`. Identical retry:
`{"result":"duplicate","sequence":1}`. Changed payload with the same ID:
`{"error":"EVENT_ID_CONFLICT"}` and nonzero exit. Storage errors are sanitized
as `AUDIT_STORAGE_ERROR`; they never authorize a scheduler/publication action.

## Guarantees and limits

SQLite transactions serialize concurrent appends. One event ID stores one
payload; conflicting reuse fails. SQL triggers reject update/delete. This is
application append-only storage, not tamper-proof evidence against a database
owner, OS administrator, or direct file replacement. Bounded input and strict
fields/enums prevent raw diagnostic dumping; IDs must still be non-sensitive.

Publication exactly-once is preserved by isolation: no existing production
module, claim, queue record, scheduler, retry policy or transport changes.
Journal idempotency is not proof of exactly-once external publication.
The collector does not verify caller assertions, automatically discover runs,
recover missed events, or reconstruct hidden actor/reason_code values.

## Validation and next gate

```sh
python3 -m unittest discover -s tests -p 'test_publisher_lifecycle_audit.py' -v
node --test tests/publication-plane-policy.test.mjs tests/publication-reliability.test.mjs
```

Fixture coverage includes concurrent duplicate writers, conflicting replay,
lost acknowledgement replay, transaction rollback, out-of-order same-run events,
unknown attribution, schema/input rejection, append-only enforcement, storage
protection, CLI persistence and sanitized errors. Existing publication policy
and reliability fixtures cover durable claims and ambiguous-result quarantine.
CI uses fixtures, read-only repository permissions, and no secrets.

Before any integration: review PR/CI, verify private storage ownership/retention,
select a supported read-only observation source, and validate its evidence
mapping. Resolve a reported safety denial through the platform's supported
review path; do not bypass it with a new transport or broaden permissions.
Keep Auto Publisher disabled and production records untouched until separately
authorized. No endpoint deployment or publisher reactivation is part of this PR.

Rollback: stop using the CLI. Preserve the private journal as incident evidence.
Revert the four added code/test/workflow/documentation files through review if
needed; production rollback is unnecessary because no production integration exists.
