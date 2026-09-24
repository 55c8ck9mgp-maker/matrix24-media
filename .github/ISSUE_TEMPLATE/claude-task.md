---
name: Claude engineering task
about: Assign a staging, testing, documentation, or review task to Claude
title: "[Claude] "
---

@claude

## Objective
Describe the engineering or review task.

## Allowed scope
- staging/documentation/tests
- claude/* branch
- no production writes

## Explicitly forbidden
- no merge to main
- no production deploy
- no production queue edits
- no Auto Publisher changes unless the issue explicitly requests review-only analysis
- no secrets

## Acceptance criteria
- [ ] Smallest viable change
- [ ] Tests/fixtures added where appropriate
- [ ] Duplicate-risk review
- [ ] Regression-risk review
- [ ] Rollback notes
- [ ] PR or written review produced
