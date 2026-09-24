# Cambio mínimo propuesto para Auto Publisher

NO APLICADO. Requiere confirmación explícita de producción. Target: tarea existente MATRIX 24 Auto Publisher, ID `6ab1c5df4d288191af04ec56ef43a33d`. No crear otra tarea, alterar horario ni reactivar Phase 2. Este parche textual no implementa todavía un adaptador con enforcement.

## Sustituir íntegramente apartados 6 y 12

An orphaned reservation, publishing record or publish_unknown record is never retried automatically based on elapsed time, reachable connectors, empty feeds or no matching caption. Preserve its durable claim and attempt identity. Reconcile read-only and recover a positive receipt or authoritative published-media evidence. If outcome remains uncertain, keep publish_unknown, notify once per meaningful incident state change, and continue independent editorial work. Do not create a new attempt ID for the ambiguous publication. Missing evidence of invocation is not proof that invocation did not occur. No age-based clearing, claim stealing or reset to ready_to_publish.

## Modificar apartados 3 y 10

Exact media ID plus correct destination account is the preferred positive read evidence. Caption/time/image matches without a known ID are reconciliation candidates requiring authoritative identity resolution or manual review, not automatic proof. Preserve all conflicting candidates. A valid published-media ID returned by create_image_post confirms the action: archive it with its attempt/account/content binding and retain a sanitized receipt. Missing permalink or delayed reads are secondary verification_pending and never authorize republishing. On archive failure, retry only the safe archive after fresh ownership/state checks; never repeat publication. Do not treat container IDs or arbitrary numeric fields as published-media IDs.

## Añadir a apartados 1 y 5

Discover fields/options before connector reads. Include data_fetched_at where available and record query checked_at, account, date range and result. Treat snapshots predating the attempt, missing freshness, truncated results and errors as inconclusive. Even a fresh empty feed is not proof of nonpublication. After a GitHub SHA conflict, recompute the intended patch against the freshly read record and verify claim owner, attempt, status and existing media ID. Never attach a fresh SHA to an old complete record and overwrite concurrent changes.

## Retirar referencias al retry controlado en 10

Replace “do not retry except the single controlled recovery rule below” with “never automatically retry an ambiguous external publication; use read-only reconciliation and retain the claim”. Revisar todo el prompt para no conservar una excepción contradictoria.

## Límites del cambio A

Conserva preflight, gate de promoción global, frecuencia horaria, máximo una publicación por ciclo y prohibición Facebook/Threads. Reduce riesgo de duplicado pero puede retener más tiempo una historia ambigua; editorial sigue investigando. No afirmar que el publicador se vuelve transaccional por cambiar el prompt. Evidencia para aprobación: tests de la política offline, revisión del texto completo resultante y snapshot del prompt anterior. Rollback seguro: si el nuevo texto falla, pausar solo publicación mediante cambio autorizado y conservar reconciliación; no restaurar la excepción de retry insegura.

## Cambios B/C separados, todavía no autorizados

- Editorial: si falla lectura Instagram, guardar investigación con duplicate_check_pending y promotion_eligible=false, continuar fuentes/revalidación; no considerar falla del canal motivo para detener toda investigación.
- Health Watch: revisar prompt actual, dejarlo estrictamente read-only y reactivar la tarea existente con aprobación; no crear duplicado.
- Reconciliación: scheduler independiente y recibos duraderos; pruebas de fallo y permisos antes de cualquier conexión social.
