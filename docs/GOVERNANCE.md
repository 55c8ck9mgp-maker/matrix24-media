# MATRIX 24 Governance

**Effective:** 2026-09-29 (approved by the project owner, Justen, 10:17 UTC)
**Supersedes:** the authority sections of `docs/CLAUDE_COLLABORATION.md`
dated 2026-09-27 where they conflict with this document.
**Companion:** `docs/CONTROL-MODEL.md` (how the gates below are enforced).

This document answers three questions: who decides, who acts, and who is
told. It does not relax any Production invariant in `CLAUDE.md`; those
apply to every role below, including the owner-approved ones.

## 1. Why this exists

INC-017 and INC-018 showed that an LLM task running on its own schedule is
a fragile owner of a consequential step: its platform can deny a write
and silently disable the whole task, leaving content stuck with nobody
accountable for noticing. INC-003 and INC-004 showed the opposite failure:
an automated "recovery" that retries after negative evidence risks a
duplicate public post. The governance fix is the same for both: every
consequential step has exactly one named owner, deterministic code
performs the side effect, and publication needs a human "yes".

## 2. Roles

### Justen — Authority (project owner)
- Final yes/no on every publication batch (second approval layer).
- Sole authority over the live account, credentials/secrets, platform
  settings (ChatGPT tasks, Cloudflare, Metricool, Meta), and branch
  protection.
- Decides `* -> discarded` and any exception to this document.
- Receives every escalation listed in section 5.

### Claude — Orchestrator
- Directs the work: decides what is done next and by whom.
- First approval layer: reviews editorial drafts and approves promotions
  (`editorial/promotions/*.json`, `approved: true`).
- Reviews and merges code and editorial PRs, its own included, under the
  adversarial self-review in `CLAUDE.md`.
- Owns reconciliation analysis, incident detection/triage and rollback
  proposals.
- Never performs an external publication itself, never handles secrets,
  never edits `queue/` by hand. It acts on production only through the
  deterministic, reviewed pipelines.

### ChatGPT — Task Executor
- Performs discrete, bounded tasks that Claude or Justen assigns:
  editorial research and verification, draft writing, analysis, code
  proposals.
- Delivers every output as a GitHub PR or issue for Claude's review.
- Has no production authority: it does not approve, merge, promote,
  publish, reserve, reconcile, or clear claims. See `CLAUDE.md`
  ("ChatGPT task boundaries") for the full list.

### Deterministic automation (GitHub Actions, Cloudflare Worker)
Not a decision-maker. Performs the state transitions it owns in
`scripts/queue-transition-ownership.mjs` and nothing else, only after the
gates in `docs/CONTROL-MODEL.md` pass.

## 3. Decision matrix

| Decision / action | Proposes | Decides | Executes | Informed |
| --- | --- | --- | --- | --- |
| Research a story, verify sources | ChatGPT | Claude (accept/reject draft) | ChatGPT (PR to `editorial/verified/`) | — |
| Merge editorial intake PR | ChatGPT | Claude | Claude | Justen (daily summary) |
| Promote draft to queue (`approved: true`) | Claude | Claude | Promotion Controller | Justen |
| Media generation | — | Pipeline rules | Cloudflare Worker | Claude spot-checks |
| Publish a batch | Claude (batch proposal) | **Justen** | Publication pipeline | Claude, Justen |
| Publish from the Claude Lane (`claude-lane/queue/`) | Claude | Claude, within `docs/CLAUDE_LANE.md` limits (authorized by Justen 2026-10-06) | Claude Lane workflow | Justen (daily summary) |
| Turn the Claude Lane on/off (`CLAUDE_LANE_ENABLED`) | Claude | **Justen** | Justen | — |
| Resolve `publish_unknown` | Claude (evidence) | Claude on positive evidence only; otherwise Justen | Reconciliation workflow | Justen |
| Discard a record | Claude | **Justen** | Owner-approved PR | — |
| Code change, non-production (docs, tests, staging) | Anyone | Claude | Claude merges | Justen (PR record) |
| Code change touching production path | Anyone | Claude, after LKG comparison | Claude merges | Justen before deploy |
| Production deploy / enable a scheduler | Claude | **Justen** | Justen (Claude has no deploy access) | — |
| Pause the pipeline for safety | Anyone may request | Claude (repo side) / Justen (platforms) | Owner of the component | Justen immediately |
| Secrets, credentials, platform settings | — | **Justen** | Justen | — |
| Change this document or `CLAUDE.md` authority | Claude | **Justen** | Claude via PR | — |

A blank "Decides" cell never defaults to the executor. If a decision is
not in this table, Claude treats it as Justen's until the table is
updated.

## 4. Approval gates

| Gate | Owner | Evidence required | Recorded in |
| --- | --- | --- | --- |
| G1 Editorial acceptance | Claude | Draft passes validator, 2+ independent verified HTTPS sources, claim checks | Merged intake PR |
| G2 Promotion | Claude | `draft_sha256` matches reviewed bytes, no duplicate `content_id` | `editorial/promotions/<content_id>.json` |
| G3 Media ready | Pipeline | Valid JPEG URL, media claim released | Queue record (`ready_to_publish`) |
| G4 Publication batch | **Justen** | Claude's batch proposal: content IDs, captions, media URLs, duplicate check | Batch approval record (Phase 2, see CONTROL-MODEL §2) |
| G5 Publication success | Pipeline | Real Instagram media ID or positive reconciliation | Queue record (`published`) |

Gates are sequential and each is fail-closed: a missing, stale, or
ambiguous input means the gate is closed, not open.

## 5. Escalation paths

| Situation | First responder | Escalate to Justen when | Channel |
| --- | --- | --- | --- |
| CI red, test failure | Claude | Never, unless a fix needs a setting only Justen holds | PR |
| Stalled transition (production-state-audit) | Claude | The owning component is outside the repo (a disabled task, Worker down) | Project chat |
| Publication ambiguity (`publish_unknown`) | Claude | Reconciliation finds no positive evidence | Project chat, same day |
| Suspected duplicate post | Claude | Always, immediately | Project chat |
| Safety denial / disabled task (INC-018 class) | Claude | Always: only Justen can change the platform | Project chat |
| Contributor output violates a boundary | Claude (reject PR) | Repeated, or it reached `main` | PR + project chat |
| Credential or permission error (401/403) | Claude | Always: no automatic reconnection | Project chat |
| Anything Claude is unsure is safe | Claude | Always | Project chat |

Escalations state: what happened, the evidence (run, commit, record SHA),
what was already done, what was deliberately not done, and the one
decision needed.

## 6. Audit trail

Every decision above leaves a GitHub record that someone other than its
author can read later:

- Decisions and approvals are PRs, commits, or manifest files, never only
  chat messages.
- Commits that change governance, promotions, or production code name the
  decider in the message or PR body.
- Merges and promotions Claude makes are reported to Justen in the project
  chat in the same session (`CLAUDE.md`, working method step 8).
- Incidents follow the postmortem template in
  `docs/reliability/INCIDENTS.md`.
- Nothing in the audit trail contains secrets.

## 7. Rollout

| Phase | Due | Scope |
| --- | --- | --- |
| 1 | 2026-09-29 | This document, `CONTROL-MODEL.md`, `CLAUDE.md` update |
| 2 | 2026-09-30 to 10-01 | Batch-approval record and gate (G4), removal of `metricool-recovery.yml`, read-only reconciliation, Instagram Graph API integration design |
| 3 | 2026-10-01 to 10-02 | Dry run with 1 story (no post), batch of 5, reconciliation observed |
| 4 | 2026-10-03 | Full operation with Justen approving each batch |

Phase 2 deprecation and reconciliation decisions (removal of
`metricool-recovery.yml`, deprecation of the ChatGPT Auto Publisher, the
read-only Instagram queue reconciliation) are recorded in
`docs/reliability/PHASE2B_RECONCILIATION_AND_DEPRECATIONS.md` (PR #139).

Until G4 is implemented and enabled by Justen in Phase 2, no new
publication path is turned on. The existing pipeline stays as-is (no
regression of the autonomous path), with the Auto Publisher disabled per
INC-018.

## 7a. Claude Lane (2026-10-06)

Justen approved, on 2026-10-06, a second publication lane owned by
Claude, separate from the Core v2 lane. It publishes without per-batch
approval (gate G4 does not apply to it) because Justen chose full
autonomy for it. It is isolated by design: its own queue
(`claude-lane/queue/`), its own Meta app and token
(`IG_CLAUDE_ACCESS_TOKEN`), deterministic GitHub Actions code for the
side effect, a daily cap, a cross-lane duplicate check against `queue/`
and the live feed, and a kill switch only Justen controls. Details and
rollback: `docs/CLAUDE_LANE.md`.

## 8. Changing this document

Only through a PR that Justen approves. If the authority model changes,
update this file, `CLAUDE.md`, and `docs/CLAUDE_COLLABORATION.md`
together.
