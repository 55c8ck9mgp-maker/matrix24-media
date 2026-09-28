# MATRIX 24 Change Policy

## Core rule
Production is not a laboratory.

## Required sequence

```text
analysis
-> risk assessment
-> staging
-> tests
-> compare against LKG
-> rollback prepared
-> one production change
-> observation
```

## Rules
- One significant component change at a time.
- Do not change Worker + Auto Publisher + queue schema in one deployment.
- Every production change must have a rollback path before deployment.
- Every external side effect must be idempotent or safely reconcilable.
- Claims are not cleared simply because they are old.
- Never republish solely because a permalink is missing.
- Never regenerate media after a publication ambiguity unless reconciliation proves it is safe.
- Staging must use fixtures, never production `queue/` records.
- Claude prepares, reviews, and controls production integration and
  editorial approval (updated 2026-09-27 — see
  `docs/CLAUDE_COLLABORATION.md` for the authority change and its
  acknowledged trade-off).
- Merge to `main` and production deployment require explicit review,
  applied adversarially by Claude even to its own changes, since no
  independent second approver is required under the current model.

## Required PR evidence
Every production-bound PR must state:
- what changes,
- what does not change,
- affected component,
- duplicate risk,
- rollback method,
- tests executed,
- staging result,
- residual risk.
