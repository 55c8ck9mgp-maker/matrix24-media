# MATRIX24 — Final Core v2 Architecture and Preventive Audit

Status: Phase 1 stabilization / live validation  
Audit date: 2026-09-29  
Production baseline audited: `7cfb090d9c0b47702e29c7d710f160951f95243c`  
Phase 2: **BLOCKED pending separate design review and explicit owner authorization**

## 1. System objective

MATRIX24 is an automated global-news production pipeline whose primary invariant is:

`Generate → Verify → Promote → Queue → Media → Publish → Confirm`

Every content item must preserve exactly-once publication, zero duplicate admissions/publications, durable evidence, and reconciliation-before-retry.

## 2. Production architecture

```text
ChatGPT Core v2 Editorial
        │ verified draft PR
        ▼
GitHub Editorial Intake Guard
        │ reviewed/merged verified record
        ▼
Promotion manifest
        │
        ▼
GitHub Promotion Controller
        │ exactly one reviewable queue PR
        ▼
queue/<content_id>.json : blocked_media
        │
        ▼
Cloudflare Media Plane
blocked_media → processing_media → ready_to_publish
        │
        ▼
ChatGPT Core v2 Publisher
ready_to_publish → publishing
        │ durable claim first
        │ exactly one Metricool write
        ▼
Metricool → Instagram
        │
        ▼
ChatGPT Core v2 Reconciler
publishing/publish_unknown → published
        │
        ▼
Durable GitHub archive + external publication evidence
```

Observation is independent:
- Production State Audit: read-only GitHub invariant audit.
- Queue Transition Ownership Audit: read-only transition audit.
- MATRIX 24 Production Monitor: read-only operational monitor.
- MATRIX24 Stabilization Supervisor: Phase 1 stabilization supervisor; may perform only safe, owner-compatible corrections and must preserve exactly-once.

## 3. Single-owner authority

| Responsibility | Sole owner | Forbidden behavior |
|---|---|---|
| New editorial candidate | ChatGPT Core v2 Editorial | No queue/media/publication |
| Editorial validation | GitHub Editorial Intake Guard | No production mutation |
| Promotion admission preparation | GitHub Promotion Controller | No auto-merge |
| Media processing | Cloudflare Media Plane | No social publication |
| Publication claim + external send | ChatGPT Core v2 Publisher | No confirmation/retry under ambiguity |
| Publication confirmation | ChatGPT Core v2 Reconciler | No publish/schedule/retry |
| Monitoring/audit | Auditors/Production Monitor | No mutation |
| Ambiguous terminal recovery requiring policy decision | Human owner | No blind retry |

Claude Publisher, legacy Auto Publisher, legacy Publication Reservation and legacy Instagram reconciliation have no production publication authority.

## 4. Publication safety contract

1. A content_id may have at most one active publication claim.
2. The external Metricool write is forbidden until the Publisher owns a durable SHA-conditional claim.
3. A Metricool scheduler ID/UUID is a receipt, not proof of Instagram publication.
4. Positive confirmation requires provider PUBLISHED plus matching Instagram permalink/public URL or actual media evidence.
5. `publishing` and `publish_unknown` never authorize a second POST.
6. Ambiguity is reconciled against the same attempt.
7. Published content is terminal and cannot be re-admitted.
8. Independent content may continue while one content_id is isolated, unless a system-wide invariant is threatened.

## 5. Runtime scheduling

| Component | Runtime/cadence | Function |
|---|---|---|
| Core v2 Editorial | ChatGPT, hourly | at most one candidate |
| Promotion Controller | GitHub Actions, every 15 min + push/dispatch | deterministic queue PR |
| Media Plane | Cloudflare Worker cron, every 15 min | media only |
| Core v2 Publisher | ChatGPT, hourly at :10 | one eligible publication max |
| Core v2 Reconciler | ChatGPT, hourly at :40 | confirmation only |
| Production State Audit | GitHub Actions, hourly at :07 + event triggers | read-only |
| Production Monitor | ChatGPT, hourly condition watch | read-only |
| Stabilization Supervisor | ChatGPT, hourly condition watch | Phase 1 corrective supervision |

## 6. Phase 1 acceptance

Phase 1 is not complete merely because content publishes.

Current closure gate: **three consecutive new live end-to-end cycles after the latest hardening**, each proving:

`Verified → Promotion → Queue → Media → Publishing → Published`

For each qualifying cycle:
- no manual corrective intervention;
- exactly one admission;
- exactly one publication attempt;
- zero duplicate publication evidence;
- durable claim before external write;
- positive external confirmation;
- same content_id archived as published.

Any cycle requiring corrective intervention is documented but does not count toward the clean streak.

## 7. Preventive audit findings

### P1 — Ownership policy drift between legacy queue auditor and Core v2

**Severity:** High, currently contained.

Core v2 actor authority correctly assigns:
- `ready_to_publish → publishing` to ChatGPT Publisher;
- `publishing → published` to Core v2 Reconciler;
- `publishing → publish_unknown` to Core v2 Reconciler;
- `publish_unknown → published` to Core v2 Reconciler.

However, `scripts/queue-transition-ownership.mjs` still uses legacy planes and attributes `publishing → published` and `publishing → publish_unknown` to the generic `publication` plane. This means the legacy ownership audit is less strict than the Core v2 authority contract.

**Safe remediation:** after the current live clean-cycle validation, align the queue-transition policy/tests with `core-v2/actor-authority.mjs` so Publisher cannot be considered authorized to confirm publication.

**Do not patch during the current clean-cycle streak** unless a live invariant violation makes immediate correction necessary.

### P1 — Scheduler documentation drift

**Severity:** Medium.

`docs/SCHEDULERS.md` still contains legacy transition ownership language assigning confirmation to Publication/Recovery, while `core-v2/STATE-CONTRACT.md` correctly separates Publisher and Reconciler.

**Remediation:** make Core v2 actor authority the normative source and update SCHEDULERS after Phase 1 validation.

### P2 — Deprecated Metricool recovery comments describe obsolete unsafe behavior

**Severity:** Medium documentation risk; runtime currently fail-closed.

`.github/workflows/metricool-recovery.yml` is manual/read-only, but comments still describe the historical Plan B that created another Metricool post for stalled `publishing`. That behavior contradicts current reconciliation-before-retry.

**Remediation:** replace obsolete comments with a tombstone explanation or remove the deprecated workflow after the retention window.

### P2 — Legacy artifacts remain in repository

**Severity:** Low while triggers/permissions remain neutralized.

Legacy/tombstoned workflows and scripts remain useful as audit history but increase cognitive load. They must never regain production triggers or write permissions.

**Remediation:** after Phase 1 closure, inventory each artifact as KEEP-AUDIT, ARCHIVE, or DELETE. No bulk deletion during stabilization.

### P2 — Core v2 CI action pinning differs from hardened workflows

**Severity:** Low.

Most hardened workflows pin Actions to commit SHAs. `core-v2-ci.yml` currently uses version tags such as `actions/checkout@v4` and `actions/upload-artifact@v4`.

**Remediation:** pin Core v2 CI actions to reviewed immutable SHAs during post-Phase-1 hardening.

### P2 — Active promotion branch refresh uses force-with-lease

**Severity:** Medium operational risk.

Promotion Controller safely serializes admissions and uses deterministic branches, but refreshing an existing promotion PR performs `git switch -C ... origin/main` followed by `git push --force-with-lease`. This previously exposed a branch/PR lifecycle edge case in editorial work.

**Remediation:** retain deterministic branch identity but migrate refresh to atomic commit/ref replacement with explicit expected-head validation. Regression-test that an existing PR cannot transiently become zero-diff/closed.

## 8. Components verified as correctly bounded

- Publication Reservation workflow is a disabled tombstone with read-only permission.
- Claude Publisher has no production publish job or write permission.
- Legacy Instagram reconciliation is disabled.
- Metricool recovery has no schedule and no production write permission.
- Media claim reconciliation is owner-triggered/manual and opens a reviewable PR.
- Promotion Controller serializes admissions repository-wide and does not auto-merge.
- Editorial Intake Guard validates trusted base code rather than executing PR code.
- Production State Audit is read-only.
- Cloudflare production deployment is manual and defaults to dry-run.

## 9. Incident recovery decision tree

```text
Failure detected
   │
   ├─ No external write could have occurred
   │      └─ isolate exact gate → minimal owner-safe correction → reread → continue
   │
   └─ External write may have occurred
          └─ preserve same attempt
             → inspect provider/external evidence
             ├─ positive unique evidence → reconcile same record to published
             ├─ pending → preserve publishing
             └─ ambiguous → preserve/enter publish_unknown
                    └─ NEVER automatic retry
```

A content-specific incident must not stop unrelated safe work.

## 10. Phase 2 boundary

Phase 2 is explicitly outside this architecture's current execution authority. Facebook, Threads, expanded growth automation, multi-channel distribution and architecture changes require:
1. separate design;
2. risk and rollback analysis;
3. exactly-once impact analysis;
4. staged validation plan;
5. explicit owner authorization.

Phase 1 completion is not Phase 2 authorization.

## 11. Post-Phase-1 hardening backlog

Recommended order after 3/3 clean cycles:
1. Align queue-transition ownership code/tests with Core v2 Publisher/Reconciler separation.
2. Correct `docs/SCHEDULERS.md` ownership terminology.
3. Remove obsolete unsafe Metricool recovery commentary and decide archive/delete.
4. Harden deterministic PR branch refresh with atomic expected-head semantics.
5. Pin Core v2 CI GitHub Actions to immutable reviewed SHAs.
6. Classify and archive/remove remaining legacy publication scripts/workflows.
7. Re-run Core v2 contract, authority, failure, migration and three-cycle simulations.
8. Freeze the resulting Phase 1 LKG baseline before any Phase 2 work.

## 12. Architecture invariants that must not change silently

- Exactly-once is the maximum rule.
- Reconciliation precedes retry.
- One transition has one owner.
- Auditors do not mutate.
- Publisher sends; Reconciler confirms.
- Media never publishes.
- Legacy publishers remain excluded.
- Phase 2 stays blocked until explicitly authorized.
