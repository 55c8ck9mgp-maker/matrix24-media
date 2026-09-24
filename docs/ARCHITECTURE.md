# MATRIX 24 Architecture

## Production flow

```text
Auto Publisher
    |
    v
GitHub queue (blocked_media)
    |
    v
Cloudflare Worker cron
    |
    +--> Workers AI
    +--> Browser Run
    +--> Supabase
    |
    v
GitHub queue (ready_to_publish)
    |
    v
Auto Publisher
    |
    +--> Windsor / Instagram
    |
    v
GitHub queue (published)
```

## Ownership

### GitHub
Source of state, SHA-based coordination, publication metadata, and attempt history.

### Cloudflare Worker
Media-only production component. Reads eligible queue records, claims media work, generates/render media, uploads to Supabase, and moves records to `ready_to_publish`.

### Supabase
Public media storage.

### Auto Publisher
Hourly orchestration for editorial creation, Instagram reconciliation, publication, and archival. Processes at most one Instagram publication per run.

### Windsor / Instagram
External social publishing and read/reconciliation path.

### Claude
Engineering/staging support only. No production publishing authority.

## Critical state transitions

```text
blocked_media
-> processing_media
-> ready_to_publish
-> publishing
-> published
```

Ambiguous social result:

```text
publishing
-> publish_unknown
-> reconcile
-> published on positive evidence OR remain quarantined
```

No-match feed reads, even from both connectors after a delay, never authorize another publication. Cached or incomplete feeds cannot prove nonpublication. See `docs/reliability/RUNBOOKS.md` for the proposed replacement policy and deployment gates; the live automation must be updated separately after approval.

## Multichannel principle
Future Facebook and Threads states must be independent. A failure on one platform must not stop Instagram.
