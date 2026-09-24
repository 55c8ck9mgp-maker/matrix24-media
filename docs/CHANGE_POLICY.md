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
- Claude prepares/reviews; ChatGPT controls production integration.
- Merge to `main` and production deployment require explicit review.

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
