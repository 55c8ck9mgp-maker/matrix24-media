# Worker v3.2.0 Recovery / Rollback

## Purpose

This backup is a recovery reference. It is not permission to deploy automatically.

## Preconditions before any rollback

1. Confirm the incident requires Worker rollback.
2. Freeze manual `/process-queue` use.
3. Inspect GitHub queue for `processing_media`, `ready_to_publish`, `publishing`, and `publish_unknown` records.
4. Do not clear or overwrite a durable claim by age alone.
5. Reconcile any potentially completed Instagram side effect before retrying publication.
6. Verify Cloudflare bindings and secrets exist without copying their values into GitHub.
7. Validate the candidate source in staging.
8. Require explicit human approval before production deployment.

## Recovery candidate

`recovery/index.reconstructed.js`

This candidate is **not byte-identical** to an exported Cloudflare source. See `README.md` and `MANIFEST.json`.

## Required checks

```bash
node --check worker/backups/v3.2.0/recovery/index.reconstructed.js
wc -c worker/backups/v3.2.0/recovery/index.reconstructed.js
sha256sum worker/backups/v3.2.0/recovery/index.reconstructed.js
```

Expected byte count: `30160`  
Expected SHA-256: `972baa91a39ac8959a74ccaf37899b516ef6b544522cf29675536d64583ed0f5`

Then test in an isolated staging Worker against fixtures, not the production queue.

## Production invariants

A rollback must preserve:

1. no duplicate publication,
2. no blind retry,
3. no lost durable media claim,
4. no production dependency on staging,
5. no regression of the current autonomous cron path.

## Deployment

No deployment is performed by this backup PR.
