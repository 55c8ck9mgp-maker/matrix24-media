# ChatGPT + Claude Collaboration Protocol

> **Superseded in part on 2026-09-29.** Roles are now Claude
> (Orchestrator), ChatGPT (Task Executor), and Justen (Authority, final
> approval on publication). See `docs/GOVERNANCE.md` and
> `docs/CONTROL-MODEL.md`; where they conflict with this file, they win.
> The section below is kept as the record of the 2026-09-27 decision.

## Authority model (updated 2026-09-27)

**Claude:** project director, integration owner, production decision-maker.

**ChatGPT:** contributor. May still run its own editorial-intake task and
propose changes via GitHub issues/PRs, exactly like any other
contributor, but no longer holds exclusive production decision
authority.

### Why this changed
Originally, ChatGPT held production authority and Claude was a staging
engineer who could prepare changes but not approve their own promotion —
a deliberate separation of duties so no single AI could both write and
approve a change to a system that publishes to a real, public account.

On 2026-09-27 the project owner explicitly reassigned project direction
to Claude, including removing that separation of duties, after being
told directly what it meant: editorial-approval decisions (which
verified draft becomes a real, published post) and production-integration
decisions would no longer get an independent check from a second party
before taking effect. The owner chose full Claude authority over keeping
that check. This document records that decision so it isn't lost or
silently reversed; if the owner wants the separation restored, update
this section and `CLAUDE.md` together.

### What did not change
- ChatGPT's own scheduled task lives on its own platform; Claude has no
  access to pause, edit, or reassign it there. If the owner wants it
  stopped, that has to happen in ChatGPT directly.
- Claude currently has no deploy access to the production Cloudflare
  Worker (its Cloudflare connector is read-only for Workers) and no
  write access to Windsor.ai/Instagram publishing. Claude can prepare
  and merge code, but an actual production deploy or a live post still
  depends on tooling Claude does not yet hold.
- The Production invariants in `CLAUDE.md` are unchanged and apply
  regardless of who approves a change.

## Communication channel
GitHub remains the shared engineering workspace. The owner may also work
directly with Claude in a chat session; Claude's GitHub identity and its
chat session share the same underlying Claude GitHub App/token, so work
started in either place is visible in the same repository.

## Standard cycle (current)

```text
Owner or Claude defines task
-> GitHub issue / PR instruction (or direct chat-driven repo work)
-> Claude (or a contributor, e.g. ChatGPT/Codex) prepares or reviews
-> branch / PR
-> Claude reviews adversarially (own or others' work)
-> tests + staging evidence
-> Claude decides integration and merges
-> owner is informed of what merged/promoted
```

## Required handoff in every PR
- Summary
- Files changed
- Tests added/run
- Duplicate-risk assessment
- Regression-risk assessment
- Rollback notes
- Known uncertainties
- Explicit confirmation of what production-relevant state was or was not touched
