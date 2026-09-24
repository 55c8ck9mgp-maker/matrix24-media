# MATRIX 24 Last Known Good (LKG)

## Baseline
**Name:** MATRIX 24 — LKG-P1-2026.09.24

**GitHub recovery branch:** `stable-phase1-complete-20260924`

**Baseline commit:** `aa5c6150c64bc9a8870c6a2e7037236c370d0c0c`

**Cloudflare Worker source version observed:** `3.2.0`

## Validation
Phase 1 was closed after three consecutive autonomous publication cycles completed without manual intervention after the prior AI/UN incident.

## Known-good behavior
- GitHub SHA reservations are used before consequential writes.
- Cloudflare owns media generation only.
- Supabase serves public JPEG assets.
- Auto Publisher owns Instagram publication.
- A valid Instagram media ID confirms publication.
- Permalink reconciliation is secondary and must never cause republishing.
- Ambiguous social results enter reconciliation rather than blind retry.
- Historical behavior allowed one retry after no-match evidence. The reliability audit identified this as unsafe: feed absence is not proof of nonpublication. Do not reintroduce this behavior through rollback. See `reliability/AUDIT.md`.

## Important limitation
The GitHub LKG branch protects repository state but does **not yet constitute a complete reproducible backup of the deployed Cloudflare Worker and its non-secret configuration**.

That gap is a Phase 2 P0 item.
