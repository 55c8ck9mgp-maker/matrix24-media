# Decisión: reintento automático de claims `processing_media` (2026-09-28)

## Decisión

Es un bug. El Worker vuelve a tomar un claim una sola vez y nunca lo reintenta automáticamente. Se corrige el Worker (v3.2.1) y se mantiene `docs/ARCHITECTURE.md`, al que se añade la regla explícita de claims de media.

## Evidencia

- **Código desplegado** (`worker/backups/v3.2.0/deployed/worker.js`, capturado de Cloudflare el 2026-09-28): `selectQueueRecord` incluye `status === "processing_media"` con prioridad 0. Cada cron (`*/15 * * * *`) en el que no hay trabajo de mayor prioridad re-toma el registro atascado, sobrescribe `media_claim` con un `request_id` nuevo y vuelve a renderizar.
- **El propio Worker lo contradice**: el comentario sobre `processQueue` dice "Claims never expire automatically: an interrupted run needs reconciliation", y la respuesta sin trabajo reporta `pending_recovery` contando `processing_media`, lo que solo tiene sentido si esos registros no se seleccionan.
- **Ningún documento lo justifica**: `docs/reliability/DESIGN.md` ("`processing_media` no vence por reloj"), INC-010 en `INCIDENTS.md` ("No limpiar por edad"), `docs/reliability/PUBLISHER_PATCH.md` ("No age-based clearing, claim stealing") y el staging (`worker/staging/v3.2.0/src/core.js`, commit `0db9b76` "Preserve durable media claims in staging selection", test "processing_media is never selected by age") exigen lo contrario. No hay commit, PR ni postmortem que pida el reintento.
- **Origen probable (inferido)**: la línea añadida tiene espacios en blanco irregulares y el bundle conserva `[key:string]&#58; any` del markdown escapado de la auditoría, lo que indica que el código se pegó a mano en el editor de Cloudflare y luego se editó ahí, fuera del repositorio. La reconstrucción de v3.2.0 del 2026-09-24 no incluye esa línea.
- **Ocurrió en producción**: `queue/matrix24-20260923-kyiv-drone-strikes.json` recibió tres claims el 2026-09-23 (`661343cc…` 16:30Z, `993de62b…` 17:30Z, `ee3c2ded…` 17:45Z; commits `acde0f6`, `004f743`, `a684e3c`). Los dos primeros fallaron sin dejar entrada en `publish_attempt_history`; el tercero terminó en `ready_to_publish`. Es decir, hubo robo de claim y los fallos no quedaron registrados.
- **Estado actual**: ningún registro de `queue/` está hoy en `processing_media`, así que no hay reintento activo en este momento.

## Coste

- Workers AI: `@cf/bytedance/stable-diffusion-xl-lightning` es un modelo beta con precio unitario de **$0.00 por paso** (página del modelo en developers.cloudflare.com). Hoy el reintento no cuesta dinero en Workers AI; sí consume la cuota diaria de neuronas y límites de tasa, y dejaría de ser gratis cuando el modelo salga de beta.
- Browser Run: cada render hace un `quickAction("screenshot")`, facturado por duración ($0.09/hora por encima de 10 h/mes incluidas en Workers Paid). Un registro atascado genera hasta 96 renders al día. Con unos segundos por captura son del orden de minutos al día: bajo, pero no nulo, y crece con cada registro atascado.
- El coste real es de corrección, no de dinero: claims robados entre ejecuciones concurrentes (cron + `/process-queue`), fallos persistentes sin registro, e imposibilidad de distinguir "render en curso" de "render fallido".

## Cambio

1. `worker/releases/v3.2.1/worker.js`: `selectQueueRecord` ya no selecciona `processing_media` ni ningún registro con `media_claim` (igual que staging). Cada ciclo registra `matrix24_media_claim_pending_reconciliation` con `content_id`, `claim_id` y `started_at` de los claims pendientes. Sin otros cambios.
2. `scripts/audit-production-state.mjs`: nuevo hallazgo `processing_media_claim_stale_requires_reconciliation` (severidad `high`) cuando un claim supera una hora. La auditoría horaria falla y notifica; no modifica nada.
3. Backup v3.2.0 regenerado desde el código desplegado (`deployed/worker.js`), ahora fuente preferida de rollback.

## Recuperar un claim atascado

Tras v3.2.1 un registro atascado queda en `processing_media` hasta que alguien lo reconcilia. El asset es determinista (`matrix24-<sha256(content_id)>-v1.jpg`): si existe en Supabase y es un JPEG válido, la reconciliación lo adjunta y pasa a `ready_to_publish` sin renderizar; si no existe, se limpia el claim y se devuelve a `blocked_media` con una entrada en `publish_attempt_history` que registre el fallo. El reconciliador es `scripts/reconcile-media-claim.mjs`, lanzado a mano con el workflow `media-claim-reconciliation.yml`, que abre un PR de cola revisable; ver el runbook R4a en `RUNBOOKS.md`. El propietario también puede descartar la historia (`discarded`).

## Despliegue

Este PR no despliega nada. Desplegar v3.2.1 a `matrix24-publisher` es un cambio de producción que requiere la aprobación explícita del propietario.

Rollback: volver a `worker/backups/v3.2.0/deployed/worker.js`. Hacerlo reintroduce el reintento automático; antes, confirmar que no hay registros en `processing_media`.
