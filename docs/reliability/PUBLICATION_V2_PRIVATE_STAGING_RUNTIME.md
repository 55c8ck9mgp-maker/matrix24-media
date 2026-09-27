# Publisher v2 private staging runtime

This Worker is deliberately inert: no public route, no preview URL, no cron and
no provider client. Its only implemented operation is minting a short-lived
GitHub App installation token after validating the exact staging repository and
a disabled feature flag.

## Required secrets

Set these only in the dedicated staging Worker:

- `GITHUB_APP_PRIVATE_KEY`: the downloaded GitHub App PEM.
- `GITHUB_APP_ID`: GitHub App ID.
- `GITHUB_INSTALLATION_ID`: installation limited to the staging repository.

Never commit secrets, configure these values in the media Worker, or point
`STAGING_REPOSITORY` to the production repository.

Activation needs a separate reviewed change that adds a scheduler, Metricool
test account, reconciliation adapter and fault-matrix evidence.
