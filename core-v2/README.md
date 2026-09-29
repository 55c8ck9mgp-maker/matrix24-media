# MATRIX24 Core v2

Core v2 is in Phase 1 controlled production validation.

## Authority boundary
- ChatGPT Publisher is the sole owner of `ready_to_publish -> publishing` and at most one external publication attempt per durable claim.
- Core v2 Reconciler independently confirms positive external evidence and never publishes or retries.
- Cloudflare Media Plane owns media processing only.
- Claude and legacy publication workflows have no publication authority.

## Exactly-once invariant
A content_id may have at most one active publication claim. Ambiguous external outcomes remain `publishing` / `publish_unknown` and are reconciled; ambiguity never authorizes another POST.

## Phase 1 acceptance
The first controlled live cycle passed on 2026-09-29. Phase 1 remains open until three subsequent consecutive real end-to-end cycles complete without invariant violations. Phase 2 remains blocked pending separate analysis and explicit owner authorization.

CI and simulations remain read-only and must not use production secrets or mutate production queue state.
