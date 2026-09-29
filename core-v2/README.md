# Core v2 test boundary

This directory is reconstruction-only.

The CI workflow has `contents: read` permission and the simulation uses no secrets, no Metricool/Instagram API, and no production queue mutation.

Acceptance for this stage:
- state contract regression tests pass;
- three simulated end-to-end cycles pass;
- each simulated content_id performs exactly one fake external publish;
- a published content_id cannot re-enter publishing.

Passing this stage does NOT authorize a live publication.
