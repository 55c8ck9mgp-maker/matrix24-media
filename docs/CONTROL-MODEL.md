# MATRIX 24 Control Model

**Effective:** 2026-09-29
**Companion:** `docs/GOVERNANCE.md` (who decides). This document defines
how decisions are enforced: the publishing workflow, reconciliation,
fail-closed safety gates, and incident response.

Status legend: **[live]** exists in the repository today; **[phase 2]** is
specified here and must be built, tested and enabled before it is relied
on.

## 1. Principles

1. **One owner per transition.** `scripts/queue-transition-ownership.mjs`
   (`TRANSITION_OWNERS`) is the single source of truth. **[live]**
2. **Deterministic code performs side effects; LLMs propose.** No LLM
   task performs a reservation, publication, or claim write (INC-017,
   INC-018).
3. **SHA-conditional writes.** Every `queue/` write is conditional on the
   blob SHA just read. On 409/422: re-read, recompute, never paste a new
   SHA onto an old snapshot (INC-005). **[live]**
4. **Fail closed.** Missing, stale, contradictory, or unparseable
   evidence blocks the record. It never unblocks it.
5. **Age is not evidence.** A timer can raise an alert; it cannot clear a
   claim, retry, or republish (INC-003, INC-004, INC-010).
6. **One external write maximum per attempt.** After a potentially
   completed publish call, the only allowed action is to archive or
   reconcile the result.

## 2. Publishing workflow (two-layer approval)

```text
editorial/verified/<id>.json      <- ChatGPT PR, Claude merges        (G1)
        |
editorial/promotions/<id>.json    <- Claude approves                  (G2)
        |  Promotion Controller [live]
queue/<id>.json  blocked_media
        |  Cloudflare Worker [live]
ready_to_publish                                                      (G3)
        |
Batch proposal                    <- Claude [phase 2]
        |
Batch approval                    <- Justen [phase 2]                 (G4)
        |  Publication Reservation, only for approved IDs [phase 2 gate]
publishing  (publish_attempt_id)
        |  Publisher: one external write
published   (real media ID)                                           (G5)
   or
publish_unknown  -> Reconciliation (section 3)
```

### Layer 1: Claude
- Reviews each draft (sources, claims, caption, duplicate `content_id`)
  and approves the promotion manifest bound to the draft's SHA-256.
- When records reach `ready_to_publish`, prepares a batch proposal:
  content IDs, queue blob SHAs, captions, media URLs, and the duplicate
  check against `published` records and the live account.

### Layer 2: Justen [phase 2]
- Approves the batch by merging a batch-approval record (proposed path:
  `editorial/publish-approvals/<batch_id>.json`) listing the exact
  `content_id` and queue blob SHA of each item.
- The reservation step reserves only records listed in a merged,
  Justen-approved batch whose SHA still matches. A changed record needs a
  new approval.
- Approval is per batch, not standing. It expires if unused (default
  24 h, to be fixed in the Phase 2 PR).

The exact file format, the check that the approving merge was Justen's,
and the tests belong to the Phase 2 PR, reviewed against `docs/LKG.md`.
Until then this layer is procedural: no publication path is enabled
without Justen's explicit approval.

## 3. Reconciliation

Purpose: make internal state match external reality without creating a
second publication.

**Inputs allowed:** a real Instagram media ID bound to the configured
account; a provider receipt tied to the same `publish_attempt_id`; an
exact Graph API lookup by media ID (`instagram-reconciliation.yml`,
**[live]**, manual).

**Inputs not sufficient on their own:** absence from a feed, a missing
permalink, elapsed time, a Metricool list that could be stale.

| Current state | Positive evidence | Proof of no send | Neither |
| --- | --- | --- | --- |
| `publishing` | `-> published` | `-> ready_to_publish` (same attempt, history entry) | stay; alert at 60 min |
| `publish_unknown` | `-> published` | `-> ready_to_publish` | stay quarantined; escalate to Justen |
| `published` without permalink | add permalink | — | stay `published`; never republish |
| `processing_media` | adopt existing JPEG via reconciliation PR | release claim with evidence | stay; never clear by age |

Reconciliation is read-first: each run records what it read, when, and
from where, before proposing any write. Writes happen through a
reviewable PR or the owning deterministic workflow, never by hand edit.

`metricool-recovery.yml` currently fails closed and performs no external
write (commit `50d0c3c`), but its design is age-triggered publication.
It is removed in Phase 2 and replaced by the read-only reconciliation
above; see `docs/reliability/PHASE2B_RECONCILIATION_AND_DEPRECATIONS.md`
(PR #139).

## 4. Safety gates (fail-closed patterns)

| Gate | Check | Fails closed to |
| --- | --- | --- |
| Schema | Record matches the queue contract | Record untouched, alert |
| Freshness | Read is from this run, SHA known | No write |
| Ownership | Transition owned by the acting plane | Workflow fails, commit flagged |
| Duplicate preflight | No `published` record or live post with the same `content_id`/media | Record held, escalate |
| Batch approval | Record is in a Justen-approved batch with matching SHA [phase 2] | Not reserved |
| Single attempt | No prior `publish_attempt_id` or provider evidence | Not reserved |
| Concurrency | One reservation per cycle; workflow `concurrency` group | Second run waits or no-ops |
| Credentials | 401/403 | Stop that channel, escalate; no auto-reconnect |
| Transient read | 429/5xx on GET | At most 2 retries with backoff, GET only |
| Ambiguous publish | Timeout, no ID, unparseable response after the call | `publish_unknown`, never retry |

A gate that cannot run (missing secret, API down) counts as failed.

## 5. Incident response protocol

1. **Detect.** `production-state-audit.yml`, CI, a stalled transition, or
   a report from anyone.
2. **Contain.** Stop the smallest thing that stops the harm (one record,
   one channel, one workflow). Do not stop the whole pipeline unless
   duplicate risk requires it. Preserve every claim and all evidence.
3. **Assess.** Fresh reads only. Separate confirmed facts from
   hypotheses. Answer first: could a duplicate post exist or occur?
4. **Escalate** per `GOVERNANCE.md` section 5. A suspected duplicate, a
   disabled task, or a credential error goes to Justen immediately.
5. **Repair** with the least invasive change that has a rollback, via PR,
   compared against `docs/LKG.md`. No blind retry, no age-based clearing,
   no manual `queue/` edit.
6. **Verify** with positive evidence and at least one subsequent clean
   cycle.
7. **Record** a postmortem at
   `docs/reliability/postmortems/YYYY-MM-DD-INC-NNN.md` and a row in
   `docs/reliability/INCIDENTS.md`.

Rollback follows `docs/ROLLBACK.md`: restore only the changed component,
re-read queue state, confirm no ambiguous external side effect remains.
