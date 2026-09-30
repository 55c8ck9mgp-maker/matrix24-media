# Queue discovery index

`queue-index.json` is a derived, non-authoritative discovery artifact.

It exists only to avoid reading every `queue/*.json` blob during Publisher/Reconciler discovery. It may identify candidate paths and the blob SHA observed when the index was built.

Safety contract:
1. The index NEVER authorizes a state transition or external publication.
2. Before acting, an owner MUST fetch the selected `queue/<content_id>.json` from current `main`.
3. The fetched blob SHA MUST equal the index entry `blob_sha`. If it differs, discovery is stale: stop and refresh/reconcile; never publish from stale index data.
4. All normal schema, ownership, duplicate, claim and external-evidence gates still apply to the authoritative queue record.
5. `publishing` and `publish_unknown` take precedence over `ready_to_publish`.
6. The index is generated from repository queue blobs by CI and contains no publication authority.
