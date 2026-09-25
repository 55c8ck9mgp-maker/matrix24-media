# Explicit editorial promotion

The Promotion Controller is the only admission boundary from verified editorial research to the production queue.

A promotion manifest binds one approved draft revision to one deterministic future queue record. The builder rejects changed drafts, unapproved manifests, drafts that do not require explicit promotion, and duplicate `content_id` values already in the queue. A successful build produces `blocked_media` only.

## Required manifest fields

- `draft_path`: exact path below `editorial/verified/`
- `draft_sha256`: SHA-256 of the exact reviewed draft bytes
- `approved: true`
- `approved_at`: ISO timestamp
- `approval_note`: editorial decision and scope

## Operating sequence

1. Research Plane creates a non-production draft under `editorial/verified/`.
2. Editorial approval is represented by a separate manifest under `editorial/promotions/`, bound to the exact draft SHA.
3. Promotion guard validates the manifest and deterministic candidate without touching `queue/`.
4. Promotion Controller rebuilds from trusted `main` and prepares exactly one queue-only admission.
5. Intake guard accepts the queue admission only when it adds exactly one JSON record whose bytes match the deterministic builder output.
6. The admitted record begins at `blocked_media`; ownership then transfers to the Media Plane.

## Safety properties

- Research cannot publish.
- Promotion cannot generate media or call Instagram.
- Promotion cannot modify an existing production queue record.
- Repeated or concurrent admission for an existing `content_id` stops safely.
- The queue candidate is rebuilt from trusted `main`, not executable PR code.
- No blind retry or publication side effect exists in this plane.

The implementation remains reviewable through a queue-only PR. Routine orchestration may invoke the controller automatically after an approval exists, but approval itself is never inferred from research output.
