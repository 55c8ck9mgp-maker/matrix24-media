# MATRIX 24 Rollback Policy

## GitHub baseline
Recovery reference:

`stable-phase1-complete-20260924`

Baseline commit:

`aa5c6150c64bc9a8870c6a2e7037236c370d0c0c`

## Production rule
Do not deploy a Worker change until the exact currently deployed source and non-secret configuration have been captured and a restore procedure has been verified.

## Rollback triggers
Rollback should be preferred over layered hot-fixes when a new deployment introduces:
- duplicate risk,
- queue state regression,
- unexpected claim behavior,
- media generation outage,
- persistent GitHub conflicts,
- social publication regression,
- unplanned coupling between components.

## Rollback procedure
1. Stop further changes, not the autonomous pipeline unless required for safety.
2. Identify the last known-good deployment.
3. Preserve current evidence/logs.
4. Restore only the changed component.
5. Re-read queue state.
6. Verify no ambiguous external side effect remains.
7. Observe subsequent autonomous cycles.
8. Document incident and root cause.

Secrets are never included in rollback documentation.
