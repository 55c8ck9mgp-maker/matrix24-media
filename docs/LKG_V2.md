# MATRIX 24 LKG v2 — India Core Production Contract

## Baseline

Behavioral reference: `4efa7d2fdd70ab78e8c0aa9e3935e53ad88e5129` (India NSE cycle fully reconciled).

This is a behavioral restoration, not a destructive repository rollback. The current Promotion Controller remains the only production admission boundary.

## Critical path

```text
approved promotion
-> exactly one queue/<content_id>.json (blocked_media)
-> Cloudflare media generation exactly once for the admitted record
-> ready_to_publish
-> publication reservation bound to current blob SHA + unique attempt ID
-> at most one Instagram POST for that attempt
-> valid account-bound Instagram Media ID
-> published archive
-> optional permalink reconciliation
```

## Plane ownership

### Promotion Controller
Owns only admission from an approved editorial manifest to exactly one `blocked_media` queue record. It does not generate media or publish.

### Cloudflare / Media Plane
Owns only `blocked_media -> processing_media -> ready_to_publish` and media storage metadata. It does not publish or repair publication state.

### Auto Publisher
Owns only new Instagram publication attempts from `ready_to_publish`.

The Publisher MUST NOT:
- promote editorial content;
- generate media;
- repair or reconfigure Cloudflare;
- enable, disable, reschedule, delete, or otherwise administer automations;
- block a confirmed publication solely because a permalink is absent;
- retry an Instagram write whose outcome is ambiguous.

A valid Instagram Media ID bound to the configured account is primary publication evidence. A permalink is secondary reconciliation metadata.

### Reconciliation
Owns unresolved `publishing` / `publish_unknown` attempts and missing secondary metadata. It is read/reconcile/archive only and never starts a replacement Instagram POST.

## Reservation ownership invariant

Every publication reservation has one immutable owner: `publish_attempt_id`.

After reservation, any mutation of publication claim fields MUST present the same attempt ID. A different or missing attempt ID is an ownership conflict and the write MUST fail closed.

Only the owner attempt may transition its claim:
- `publishing -> published` after a valid Media ID receipt;
- `publishing -> publish_unknown` after an ambiguous external result;
- `publishing -> ready_to_publish` only when durable evidence proves the external action was never invoked.

No other component may clear, replace, age-out, or overwrite that reservation.

## Ambiguous-call invariant

Once the Instagram create action may have been invoked, that attempt is terminal for external writes.

Timeout, disconnect, missing receipt, missing Media ID, stale feed, empty feed, or no matching feed row MUST NOT authorize another Instagram POST. The record enters/remains `publish_unknown` until positive authoritative evidence resolves it or a human explicitly handles the incident.

## Permalink invariant

A confirmed account-bound Media ID closes the external publication step. Missing permalink:
- does not revert `published`;
- does not block unrelated queue records;
- does not authorize republishing;
- is repaired asynchronously by reconciliation.

## LKG v2 acceptance gate

The isolated validation MUST prove all of the following for one fixture/content ID:

1. one approved admission produces exactly one queue record;
2. repeated admission produces no duplicate queue record;
3. the Media Plane performs exactly one media-generation transition for the admitted record;
4. exactly one publication reservation is created;
5. the reservation owner cannot be overwritten by another attempt;
6. at most one Instagram POST is authorized for the reservation;
7. an ambiguous POST result authorizes zero retries;
8. one valid account-bound Media ID transitions the record to `published`;
9. one archive is produced for that Media ID;
10. missing permalink leaves the record `published` and does not block another eligible record.

Do not merge this contract into production until the isolated acceptance test passes.


## Publisher preflight decision invariant

Every `ready_to_publish` record inspected by the Auto Publisher MUST end the preflight with an explicit durable decision: reserve the current SHA for exactly one owned attempt, or identify the exact blocking gate. A run MUST NOT silently no-op on an otherwise eligible record.

For a never-published `ready_to_publish` record, absence of terminal publication fields is normal. Missing `publish_attempt_id`, `instagram_media_id`, `instagram_permalink`, `published_at`, provider receipt ID/UUID, or publication-provider fields MUST NOT by itself fail preflight.

After a provider write may have occurred, these first-attempt semantics no longer apply: the owned reservation and reconciliation rules remain authoritative, and no blind retry is allowed.
