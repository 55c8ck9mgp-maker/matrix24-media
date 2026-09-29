# MATRIX 24 Core v2 — State and Ownership Contract

Status: Phase 1 controlled production validation
Version: 2.0.0-draft
Safety rule: exactly-once publication is invariant.

## Design constraints

1. One transition has exactly one owner.
2. Auditors are read-only. They may fail/stop a transition but never mutate queue state.
3. Recovery never republishes. Positive external evidence is reconciled into the existing content_id.
4. Publication requires an explicit durable reservation before the external side effect.
5. An ambiguous external result is never interpreted as permission to retry.
6. Core v2 is in controlled production validation; continuous autonomy is not declared until the remaining acceptance gates pass.

## Canonical states

- candidate — researched/editorial content not yet approved.
- approved — editorial decision complete and immutable for this revision.
- media_ready — approved content has validated publishable media.
- ready_to_publish — queue admission complete; no publication claim exists.
- publishing — one durable publication claim exists and one external attempt may execute.
- publish_unknown — an attempt exists but its external result cannot yet be proven.
- published — positive external evidence exists and the active claim is closed.
- discarded — terminal state; publication forbidden.

## Allowed transitions and single owner

| From | To | Owner |
|---|---|---|
| candidate | approved | Editorial Approval |
| candidate | discarded | Editorial Approval |
| approved | media_ready | Media Builder |
| approved | discarded | Editorial Approval |
| media_ready | ready_to_publish | Queue Admission |
| ready_to_publish | publishing | Publisher |
| publishing | published | Confirmation/Reconciliation |
| publishing | publish_unknown | Confirmation/Reconciliation |
| publish_unknown | published | Confirmation/Reconciliation |
| publish_unknown | discarded | Human Recovery Decision |

No other state transition is legal.

## Publication invariant

A content_id may have at most one active publication claim.

The Publisher owns only:
ready_to_publish -> publishing -> one external publish attempt.

It does NOT own confirmation, reconciliation, editorial, media, or recovery.

Confirmation/Reconciliation may inspect external evidence and close an existing claim. It MUST NOT call a publishing endpoint.

If publishing or publish_unknown already exists, no component may create a second attempt.

## Auditor contract

Auditors may:
- inspect state;
- verify provenance and invariants;
- emit PASS/WARN/FAIL;
- prevent a proposed transition from proceeding.

Auditors may NOT:
- change status;
- create or close publication claims;
- publish;
- reconcile;
- retry;
- create replacement queue records.

## AI authority

ChatGPT Publisher is the permanently authorized sole owner of ready_to_publish -> publishing and the single external publication attempt. Claude and all legacy publishers are excluded from that transition. Core v2 Reconciler is the separate sole confirmation owner and MUST NOT publish. Cloudflare Media Plane owns media processing only. Other production mutations are performed only by the component assigned to the transition above.

## Migration rule

Legacy records are evidence, not automatically executable v2 work. Migration must classify each content_id and import it once. Published legacy content remains terminal and can never be re-admitted.

## Activation gates

Core v2 Phase 1 acceptance is complete only when all are true:
1. state-contract tests pass;
2. ownership tests pass;
3. legacy migration dry-run has zero duplicate admissions;
4. three simulated end-to-end cycles pass;
5. one explicitly approved controlled live cycle passes (completed 2026-09-29);
6. three subsequent live cycles pass without invariant violations.
