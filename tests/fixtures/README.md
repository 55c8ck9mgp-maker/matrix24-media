# MATRIX 24 Test Fixtures

This directory is reserved for synthetic staging/test records.

Rules:
- Never copy fixtures into production `queue/`.
- Use fake/non-publishable identifiers.
- Do not include secrets, real access tokens, or production credentials.
- Fixtures may model production states such as `blocked_media`, `processing_media`, `ready_to_publish`, `publishing`, `publish_unknown`, and `published`.
- Tests must mock or stub external publication side effects unless an explicitly isolated staging integration exists.
