# Core v2 Live Validation Status

The pre-live cutover gate was completed on 2026-09-29.

## Completed
- Core v2 CI passed before cutover.
- Legacy overlapping publication mutators were disabled.
- Exactly one controlled live publication was authorized and completed.
- The Kyiv Academy Sciences content_id was claimed once, sent once through Metricool, positively confirmed on Instagram, and reconciled into the same queue record.
- No second publication attempt was issued.

## Current authority
- ChatGPT Publisher is permanently authorized as the sole owner of ready_to_publish -> publishing and one external publication attempt.
- Core v2 Reconciler is the sole owner of publication confirmation/reconciliation and cannot publish.
- Claude and legacy publishers are excluded from publication ownership.
- Cloudflare Media Plane is limited to media processing and must not publish.

## Remaining Phase 1 gate
Three subsequent consecutive live end-to-end cycles must complete without invariant violations before Phase 1 may be declared stable. Phase 2 remains blocked until separate analysis and explicit owner authorization.

## Fail-closed rule
Any ambiguous publication result remains the same claim in publishing/publish_unknown and MUST NOT cause a retry or second POST.
