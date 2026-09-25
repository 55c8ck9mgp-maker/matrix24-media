# MATRIX 24 Architecture

## Design rule

MATRIX 24 is split into independent planes. Each plane has exactly one production responsibility and communicates through durable GitHub state. No component may silently assume ownership of another plane.

## Production flow

```text
Research Plane
Editorial Engine
    |
    v
editorial/verified/<content_id>.json
    |
    v
Promotion Plane
Promotion Controller
    |  validate schema + sources + approval + duplicate/content_id
    |  deterministic build; exactly-once queue admission
    v
GitHub queue (blocked_media)
    |
    v
Media Plane
Cloudflare Worker
    |  claim by current SHA
    +--> Workers AI / Browser Run
    +--> Supabase
    v
GitHub queue (ready_to_publish)
    |
    v
Publication Plane
Auto Publisher
    |  current reads + duplicate preflight
    |  durable publication claim
    +--> Windsor / Instagram (one external write maximum)
    v
GitHub queue (published)

Ambiguous publication:
publishing -> publish_unknown -> Recovery Plane -> published on positive evidence
                                      |
                                      +-> otherwise remain quarantined

Observation Plane watches all planes and never mutates production.
```

## Ownership

### GitHub — source of truth
Owns durable content state, current blob SHA coordination, editorial approval metadata, media/publication claims, external receipts and append-only attempt history.

### Research Plane — Editorial Engine
Discovers and verifies candidate stories and produces non-production drafts under `editorial/verified/`. It never writes `queue/`, generates production media, publishes, reconciles publication, or owns production claims.

### Promotion Plane — Promotion Controller
The only admission boundary from verified editorial content to production. It accepts only an explicitly approved manifest bound to the exact reviewed draft SHA. It validates the draft, approval, deterministic output and duplicate `content_id`, then creates exactly one `blocked_media` queue record through a reviewable queue-only change.

Promotion is idempotent by `content_id` + approved draft SHA. Re-running an already admitted promotion is a no-op/failure-safe condition, never a second queue record.

### Media Plane — Cloudflare Worker
Media-only production component. It owns:
`blocked_media -> processing_media -> ready_to_publish`.
It uses SHA-based claims, creates/renders media, uploads the public asset to Supabase and records media metadata. It never publishes socially.

### Supabase
Public production media storage. It is not the state authority.

### Publication Plane — Auto Publisher
The only component that starts new Instagram publication attempts. It consumes `ready_to_publish`, performs current read-only preflight, reserves a unique durable attempt, invokes at most one Instagram write per attempt and archives positive success.

It does not research stories, approve/promote editorial drafts, generate media, clear media claims, or treat absence from a feed as proof of failed publication.

### Recovery Plane — Reconciliation
Owns resolution of `publishing` / `publish_unknown`. Positive account-bound media evidence may finalize `published`. Ambiguous or incomplete evidence remains quarantined. Reconciliation never starts a replacement POST.

### Observation Plane
Health/watch components read state and alert on invariant violations, stalled transitions and connector failures. They never repair, publish, promote, reset claims or alter production schedules.

### Claude
Engineering/staging and independent review only. No production publishing authority.

## State machine

```text
verified draft
-> approved promotion manifest
-> blocked_media
-> processing_media
-> ready_to_publish
-> publishing
-> published
```

Exceptional states:

```text
publishing -> publish_unknown -> reconciliation -> published
                                      |
                                      +-> remain quarantined
```

A definitive pre-write failure may return a record to `ready_to_publish` only when durable evidence proves the external publication action was not invoked. The failed attempt remains in history and a future attempt receives a new attempt ID.

## Critical invariants

1. Exactly one owner for each state transition.
2. GitHub is authoritative; caches and social feeds are evidence, not state authority.
3. Every consequential write is preceded by a durable claim or deterministic admission boundary.
4. No blind retry after a potentially completed external operation.
5. A real Instagram media ID bound to the correct account is primary success evidence.
6. Missing permalink never causes republishing.
7. Feed absence never proves nonpublication.
8. Stale/truncated/cached reads never authorize retry.
9. Production media generation and social publication remain separate.
10. Editorial research cannot directly reach Instagram.
11. Promotion is deterministic and duplicate-safe.
12. Facebook and Threads remain independent future channels; their failure must not block Instagram.
