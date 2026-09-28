# Promotion Controller

## Purpose

The Promotion Controller is the single controlled bridge between verified editorial research and the production queue.

It removes architectural ambiguity without giving the Editorial Engine or Auto Publisher overlapping authority.

## Input contract

A new promotion is admissible only when:

- the draft exists under `editorial/verified/`;
- the draft passes the trusted editorial validator;
- at least two unique verified HTTPS sources and their claim checks are present;
- the manifest is under `editorial/promotions/`;
- `approved: true`;
- `content_id` is canonical and matches the draft and manifest filename;
- `draft_sha256` matches the exact reviewed draft bytes;
- the draft still declares that explicit editorial promotion is required;
- its `content_id` is not already present in production `queue/`.

Historical approved manifests created before `content_id` became mandatory are not new-admission inputs. They remain inert audit evidence only when the matching queue record already exists.

## Output contract

One deterministic record:

`queue/<content_id>.json`

with initial production state:

`blocked_media`

The controller must not create media, reserve media work, invoke Instagram, reset claims, modify existing production records or generate a second record for the same `content_id`.

## Exactly-once admission

The identity key is:

`content_id + draft_sha256`

Before admission, enumerate the current queue and reject/no-op if the content ID already exists. The candidate bytes must equal the trusted deterministic builder output. Queue admission is performed as a queue-only reviewed change so unrelated files cannot be smuggled into production.

Concurrent/repeated promotion requests are therefore safe: only the first valid admission can introduce the content ID; subsequent runs observe the existing ID and stop.

## Scheduled recovery

The periodic controller is a recovery mechanism, not a second admission path.

It evaluates approved unadmitted manifests in deterministic order. Each candidate must pass the same current builder and validation contract used for a normal promotion. A malformed or stale candidate is quarantined in the selection result and does not prevent a later independent valid candidate from proceeding.

If no valid approved unadmitted manifest exists, the workflow exits successfully with `has_work=false`. Downstream branch and PR steps are gated on `has_work=true`; a no-work cycle can never fall through into an empty `promotion/` branch.

## Failure policy

Validation failure for one scheduled candidate: quarantine that candidate and continue evaluating independent candidates.

Draft SHA mismatch: no production write.

Duplicate content ID: no production write.

PR/workflow permission failure: no production write.

Concurrent queue change: rebuild/revalidate against current main; never overwrite an existing queue record.

Approved legacy manifest without `content_id` and without an admitted queue: report as an invariant failure; never infer a new identity.

No valid pending work: successful no-op.

Unknown repository state or duplicate queue identity: stop promotion globally and require reconciliation. Do not guess.

## Stability status (2026-09-27)

Ten separate `fix/promotion-*` and `hardening/promotion-*` branches landed
against this component in a single day. That is a signal the design was
iterated live under incident pressure, not that the component is
unstable right now — the scheduled promotion workflow has run green for
its last 10+ consecutive cycles as of this note.

**Policy going forward:** treat this component as frozen unless a new
incident is actually observed (not hypothesized). A future change here
needs a postmortem-grade justification (an actual `docs/reliability/
postmortems/*` entry) before another patch branch, not another
speculative hardening pass. This prevents the same churn pattern from
recurring.

## Responsibility boundary

Editorial Engine ends at a verified draft.

Promotion Controller ends at `blocked_media`.

Cloudflare begins at `blocked_media` and ends at `ready_to_publish`.

Auto Publisher begins at `ready_to_publish`.

Reconciliation handles only unresolved publication attempts.

Observation components remain read-only.
