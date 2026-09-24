# ChatGPT + Claude Collaboration Protocol

## Authority model

**ChatGPT:** project director, integration owner, production decision-maker.

**Claude:** staging engineer and independent reviewer.

## Communication channel
GitHub is the shared engineering workspace.

The user may remain in the ChatGPT conversation. ChatGPT can create/assign engineering tasks in GitHub; Claude responds through branches, comments, and pull requests.

## Standard cycle

```text
User
-> ChatGPT defines task
-> GitHub issue / PR instruction
-> Claude prepares or reviews
-> claude/* branch / PR
-> ChatGPT cross-review
-> tests + staging evidence
-> user/ChatGPT production decision
```

## Separation of duties
Claude may prepare a change but cannot approve its own promotion to production.

ChatGPT must not treat Claude agreement as proof. Evidence is required.

## Required Claude handoff in every PR
- Summary
- Files changed
- Tests added/run
- Duplicate-risk assessment
- Regression-risk assessment
- Rollback notes
- Known uncertainties
- Explicit confirmation that production queue and Auto Publisher were not modified
