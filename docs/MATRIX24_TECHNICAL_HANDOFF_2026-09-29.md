# MATRIX 24 — Technical Handoff to Claude

**Cutoff:** 2026-09-29  
**Primary operator:** Claude  
**Owner / final publication authority:** Justen  
**Repository:** `55c8ck9mgp-maker/matrix24-media`

> This is a dated operational handoff. Permanent authority and safety rules live in `/CLAUDE.md`, `docs/GOVERNANCE.md`, and `docs/CONTROL-MODEL.md`. If this document conflicts with those files, the current canonical governance documents win.

## 1. Mission

MATRIX 24 is an autonomous news-production and social-publication system.

Canonical lifecycle:

```text
Research → Generate → Verify → Promote → Queue → Media → Reserve → Publish → Confirm/Reconcile → Archive
```

Correctness and exactly-once publication take precedence over throughput and autonomy.

## 2. Core invariants

For one canonical `content_id`:

```text
1 verified story
→ max 1 active promotion admission
→ max 1 canonical queue record
→ max 1 active media claim
→ max 1 publication reservation
→ max 1 external publication
→ 1 confirmed terminal result
```

Mandatory rules:

- No blind retry after a possible external side effect.
- Reconcile ambiguous outcomes before any retry.
- Do not create replacement `content_id` values to recover interrupted work.
- Do not regenerate valid deterministic media because a later stage failed.
- Do not mark `published` from internal workflow success alone.
- Do not manually inject production queue records to bypass Promotion.
- Claims do not become failed merely because they are old.
- Preserve forensic history during recovery.

## 3. Ownership

### GitHub
Canonical state/control plane: editorial metadata, promotion manifests, queue state, claims, attempt IDs, workflows, validation and audit evidence.

### Supabase
Media storage/public media URLs. GitHub remains metadata/state; Supabase remains binary media storage.

Expected Instagram image: JPEG, RGB, 1080×1350, <8 MB, no alpha.

### Cloudflare / Media Plane
Owns media processing only:

```text
blocked_media → processing_media → generate/render/upload → ready_to_publish
```

It does not own editorial approval or social publication.

### Editorial Engine
Owns research and verification. It must not create queue records or publish.

### Promotion Controller
Exclusive bridge from verified editorial material into queue admission. It must remain idempotent and exactly-once.

### Publication Reservation
Deterministically owns:

```text
ready_to_publish → publishing
```

with SHA-conditioned mutation, unique attempt identity, ownership validation and concurrency protection.

### Auto Publisher
Executes an already authorized/reserved publication. It must reuse media, make at most the authorized external side effect, capture evidence, and reconcile uncertainty rather than retry blindly.

### Metricool / Instagram
External publication/reconciliation evidence. Do not assume older Windsor-based documentation represents the current publishing path; inspect current production configuration.

## 4. Queue states

Important lifecycle states include:

```text
blocked_media
processing_media
ready_to_publish
publishing
publish_unknown
published
discarded
```

Terminal records must not be silently reopened.

## 5. Historical baseline vs current status

The 2026-09-24 handoff declared Phase 1 complete after three autonomous cycles. That historical declaration is not sufficient evidence for current health.

Subsequent work exposed defects or uncertainty involving Promotion lifecycle, scheduler/lifecycle control, publication reservation, recovery, confirmation and reconciliation.

Therefore Claude must derive the current phase from live evidence, not from the Sep-24 snapshot.

No Phase 2/3 expansion should occur while the production path has unresolved exactly-once or scheduler/lifecycle defects.

## 6. Important incident lessons

### Bangkok
Production validation case that contributed to publication-path hardening. Treat as historical evidence, not new work.

### WXV
Positive external publication evidence existed while internal state required reconciliation. Lesson: stale internal state after an external success requires reconciliation, not republication.

### RAF Fairford
Used in media/publication hardening. Do not re-admit or republish if current canonical/external evidence confirms completion.

### Uttar Pradesh
Interrupted editorial intake. Recovery principle: preserve the same identity/branch where possible, revalidate, create one canonical editorial record, then return ownership to the normal pipeline.

### Virat Kohli
Exposed Promotion/queue lifecycle issues. Recovery invariant: one content_id, one canonical admission, one queue, zero duplicates. Verify current terminal state before any action; never create a second admission merely from historical ambiguity.

### Shin Ohashi
Promotion Controller validation case that exposed trigger/guard/queue-admission issues. Verify canonical queue state before action; do not create a second admission.

### False-confirmation incident
Several records were represented as published without sufficient authoritative external confirmation during stabilization work. The lesson is permanent: internal state cannot manufacture an external side effect. Preserve original attempt IDs and reconcile externally before retrying.

## 7. Scheduler/lifecycle risk

Recent work raised concern that automation actors could end up disabled after execution.

Relevant owners include Editorial Engine, Promotion Orchestrator/Controller and Auto Publisher.

Do not solve this by repeatedly re-enabling actors. Establish:

```text
who/what changed enabled state
why it changed
which lifecycle/scheduler rule caused it
whether the behavior is expected or defective
```

Resolve the control-plane cause before restoring unattended execution.

## 8. Phase-1 exit evidence

Before declaring the autonomous Instagram path stable again, require consecutive clean production cycles demonstrating:

```text
verified
→ promotion
→ exactly one queue
→ media claim
→ ready_to_publish
→ one reservation
→ one external publication
→ authoritative confirmation
→ published
```

with zero duplicates, blind retries, orphan claims, false confirmations, unexplained scheduler disablements, and unresolved publication ambiguity.

Historical working criterion: at least three consecutive clean autonomous end-to-end cycles unless the owner explicitly changes it.

## 9. Claude takeover procedure

Claude should begin from a read-only production audit, not a code change.

1. Verify current `main` HEAD, open PRs, recent merges and active workflows.
2. Inventory canonical queue states and detect duplicate identities/attempts/orphan claims.
3. Reconcile every nonterminal publication claim against current external provider and Instagram evidence.
4. Verify actual enabled/disabled state of Editorial, Promotion, Media, Reservation, Publisher, Recovery and monitoring actors.
5. Map exactly one owner to every state transition.
6. Run the current regression/stability suite.
7. Compare live behavior against `CLAUDE.md`, `docs/GOVERNANCE.md`, `docs/CONTROL-MODEL.md`, `docs/SCHEDULERS.md`, `docs/PROMOTION_CONTROLLER.md`, and `docs/PUBLICATION_RESERVATION_WORKFLOW.md`.
8. Report confirmed violations separately from hypotheses.
9. Apply the smallest causal fix only after evidence identifies the responsible component.
10. Add regression coverage for each confirmed defect where feasible.

## 10. Evidence priority

When sources disagree, use this order:

```text
1. authoritative external side-effect evidence
2. current canonical GitHub state
3. current deployed workflow/configuration
4. current CI/audit evidence
5. dated project documentation
6. chat history
```

If evidence conflicts: stop, reconcile, do not guess.

## 11. Change discipline

For production-affecting work:

```text
inspect → isolate invariant → reproduce → test → smallest fix → CI → reviewed merge → observe
```

Do not simultaneously modify multiple pipeline owners to hide one root cause.

Do not expose secrets in documentation, commits, PRs, logs, or chat.

## 12. Takeover success condition

Claude has assumed operational control only when current evidence can answer:

- What is running and what is paused?
- What is queued and what is publishing?
- What has actually been published externally?
- What remains ambiguous?
- Who owns each transition?
- Are duplicates or orphan claims present?
- Are schedulers behaving as designed?
- Is exactly-once preserved?
- What currently prevents stable autonomous operation?

Until those answers are evidence-backed: no broad mutations, blind retries, or phase advancement.
