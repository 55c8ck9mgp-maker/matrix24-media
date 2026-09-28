# Stale branch cleanup list (2026-09-28)

Claude cannot delete git branches from its current environment — both the
GitHub REST API and the git protocol reject ref-deletion for this
session (infrastructure-level restriction, not a permissions issue).
This list is for a human, or any actor with unrestricted git access, to
clean up manually.

Every branch below has a **merged** pull request (confirmed via the
GitHub API's `merged: true` field, not just closed) whose content is
already in `main`. Deleting the branch loses nothing.

```
claude/director-authority-update-20260928
codex/publisher-v2-private-runtime
codex/publication-v2-adapter-hardening
codex/publication-v2-github-staging-adapter
codex/publication-plane-v2-main
codex/reservation-broker-contract
codex/publisher-lifecycle-audit
hardening/system-stability-20260927
promotion/matrix24-20260926-virat-kohli-2027-world-cup-final
fix/kohli-source-role-reconciliation
recovery/kohli-trigger-proof-20260927
fix/promotion-controller-trigger-contract-20260927
recovery/promotion-controller-kohli-20260927
hardening/promotion-manifest-content-id-20260927
editorial-intake/matrix24-20260927-uttar-pradesh-floods-landslides
promotion/matrix24-20260927-raf-fairford-explosives-arrests
promotion-approval/matrix24-20260927-raf-fairford-explosives-arrests
editorial-intake/matrix24-20260927-raf-fairford-explosives-arrests
hardening/promotion-guard-regression-20260927
fix/promotion-guard-head-materialize-20260927
fix/promotion-guard-quote-20260927
fix/promotion-guard-pr-trigger-20260927
fix/phase1-structural-invariants-20260927
promotion/matrix24-20260926-england-new-zealand-wxv-rugby-36288467660
hardening/promotion-controller-auto-pr-20260926
hardening/bangkok-publisher-preflight-20260926
promotion/matrix24-20260926-bangkok-heavy-rain-flooding-36255473567
feat/metricool-lkg-v2-offline-adapter
ci/lkg-health-contract-guard
fix/health-observer-invariant-precedence
editorial/bangkok-flooding-consensus
feat/read-only-health-observer
fix/shin-provenance-reconciliation
fix/shin-claim-consensus
fix/claim-consensus-gate
promotion/matrix24-20260924-shin-ohashi-200m-breaststroke-world-record-36223885573
fix/promotion-controller-branch-only
fix/promotion-pr-token
post-merge-main-validation-trigger
lkg-v2-india-core
promotion/shin-ohashi-first-cycle
architecture/promotion-controller-v1
fix/editorial-queue-promotion-preflight
promotion/matrix24-20260924-anthropic-akamai-cloud-deal-36094921174
feature/deterministic-editorial-queue-promotion-v2
feature/explicit-editorial-promotion-clean
staging/instagram-oauth-callback-clean
fix/editorial-intake-guard
staging/durable-receipts
feature/stable-editorial-intake
docs/inc-017-editorial-intake-safety
editorial/shin-ohashi-verified-draft
fix/staging-preserve-existing-media-claim
docs/production-runtime-audit
docs/close-inc-016-github-reconciliation
staging/github-actions-reconciliation
staging/reconciliation-redirect-diagnostic
staging/reconciliation-network-diagnostic
staging/reconciliation-worker-20260924
staging/reliability-audit-20260924
staging/phase2-worker-staging-harness
staging/worker-v3.2.0-backup-20260924
staging/claude-max-turns-30
staging/claude-max-turns-20
staging/claude-workflow-hardening
staging/claude-oidc-permission-fix
staging/claude-collaboration
```

**Not included** (closed but never merged — confirm intentional
abandonment before deleting, since a closed-without-merge branch could
also mean "rejected in favor of a different approach" rather than
"superseded"):

```
codex/publication-plane-v2-staging
recovery/exclude-invalid-kohli-20260927
hardening/system-invariant-guards-20260927
fix/promotion-trigger-v2
claude/auto-publisher-staging-contract
```

Suggested command once confirmed, run locally with normal git credentials:

```sh
while read -r b; do git push origin --delete "$b"; done < merged-branches.txt
```

This file can be deleted once cleanup is done.
