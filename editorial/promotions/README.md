# Explicit editorial promotion

A promotion manifest is the only input accepted by the promotion builder. It is a separate, reviewable JSON file under this directory and binds one approved draft revision to one future queue record.

Required fields:

- `draft_path`: exact path below `editorial/verified/`
- `draft_sha256`: SHA-256 of the exact draft bytes reviewed
- `approved: true`
- `approved_at`: ISO timestamp
- `approval_note`: the editorial decision and scope

The builder rejects changed drafts, unapproved manifests, drafts that do not require explicit promotion, and duplicate `content_id` values already in the queue. A successful build produces `blocked_media` only. It never creates media, a claim, an Instagram call, or a publication attempt.

No production manifest is included in this change.

## Operating sequence

1. The intake creates a non-promotable draft under `editorial/verified/`.
2. An editor adds a separate manifest under `editorial/promotions/` after reviewing the exact draft revision.
3. `Editorial promotion guard` validates the manifest and builds the prospective `blocked_media` record in memory. It cannot alter `queue/`.
4. A later, separately reviewed queue-change PR may copy that exact generated record. The Auto Publisher is the only component allowed to perform media generation and social publication.

This intentionally does not create a path from research directly to Instagram. It provides an auditable promotion boundary that can be exercised in staging before any queue-write automation is proposed.
