# Runbooks y árbol de decisión

Propuesta para integración aprobada; el publicador vivo aún contiene reglas antiguas. Nunca ejecutar una publicación como diagnóstico.

## Árbol

1. ¿Existe ID de media publicado o recibo autoritativo vinculado a cuenta/contenido/intento? Sí: conservar confirmación, archivar vía CAS, verificar lectura/permalink aparte. Feed vacío no revoca el recibo.
2. ¿Hubo intento, claim huérfano o posibilidad de envío? Sí: mantener `publish_unknown`/claim; reconciliar; no generar otro intento ni cambiar caption/asset. Nunca deducir no-envío de un historial incompleto.
3. ¿Solo hay fallo preflight sin intento externo? Clasificar error. Corregir automáticamente solo transformaciones deterministas, con mismo content_id, fresh SHA y evidencia. Hechos dudosos requieren revisión editorial.
4. ¿El error es global (auth, permisos, identidad de cuenta) o de una historia? Abrir circuit breaker del canal afectado. Continuar editorial. No promover otro contenido del mismo evento mientras dedupe sea incierto. No retirar gate global existente antes de implementar aislamiento.
5. ¿La evidencia se contradice o hay más de un ID candidato? Cuarentena y revisión humana, preservar todo. No borrar posts ni elegir «el más reciente» automáticamente.

## R1 — Confirmado sin permalink / lectura vieja

Leer ID como string; conservar respuesta y destino. Consultar `instagram` con media_id/media_permalink/timestamp/data_fetched_at y cuenta explícita, ventana de fechas inclusiva alrededor del intento. Fallback `instagram_public`, con perfil explícito. Identidad de cuenta del request pertenece a la evidencia; no confiar en captions aislados. Registrar fetched_at y checked_at separados; normalizar UTC documentado. Un cache timestamp anterior se clasifica stale, no no_match seguro. Guardar permalink solo de fila exacta. No componer shortcode desde ID Graph. Reintentar lecturas con presupuesto; nunca repetir create_image_post. Alertas secundarias no detienen editorial ni convierten published a ready.

## R2 — Resultado ambiguo / reserva huérfana

Recuperar claim, attempt_id, payload hash, historial y recibos. Releer estado autoritativo; no escribir un snapshot previo con SHA nuevo. Buscar recibo positivo o lookup de media/container autorizado cuando esté disponible. Caption/horario/imagen ofrecen candidatos, no certeza automática. Ningún número de lecturas vacías prueba no publicación. Mantener cuarentena sin vencimiento automático. Escalar si no hay ruta autoritativa; no prometer reparación automática universal. Para autorizar un nuevo intento se necesita prueba inequívoca de no-envío con invocador previo impedido de continuar, o mecanismo idempotente verificado del proveedor, en cambio aparte revisado.

## R3 — SHA/concurrencia y fallo de archivo

Si CAS de reserva falla: no llamar proveedor. Si respuesta CAS se pierde: releer; si el intento propio existe, conservarlo sin reenviar por reinicio. Si ya hubo éxito externo y falla archivo: preservar recibo fuera del snapshot fallido, releer, verificar owner/intento/ID; parche mínimo y CAS. Si otro escritor cambió identidad, elevar conflicto. No resetear estado ni borrar claim de otro. En respuesta GitHub sin SHA utilizable no continuar a siguiente side effect.

## R4 — Media

Antes de claim: esquema, fuente válida, URL permitida, límites de asset. Después de claim: inspeccionar objeto determinista y metadatos de revisión; validar bytes JPEG, dimensiones, ratio y tamaño, no solo extensión/HEAD. Objeto válido + ownership permite proponer completar archivo con CAS; objeto inválido/indeterminado no permite regeneración ciega. Render/AI/upload inciertos mantienen claim. NoSuchKey tiene tratamiento explícito de código/body; timeout/403 no se convierten en ausencia. Nunca tocar `/process-queue` o `/upload` productivos durante auditoría.

## R4a — Claim de media atascado (`processing_media_claim_stale_requires_reconciliation`)

La auditoría horaria o el log `matrix24_media_claim_pending_reconciliation` del Worker reportan `content_id`, `claim_id` y `started_at`. El Worker (v3.2.1 en adelante) nunca vuelve a tomar ese registro; lo resuelve una persona con el workflow **Media claim reconciliation** (Actions, "Run workflow" sobre `main`).

1. **Dry run.** Lanzar con `content_id`, `claim_id` (exacto, copiado de la auditoría), `mode: auto` y `apply` sin marcar. El resultado indica qué haría:
   - `adopted`: el JPEG determinista (o la `public_image_url` ya registrada) existe, es un JPEG completo de 1080x1350 con 3 componentes y como mucho 8 MB. El registro pasaría a `ready_to_publish` con `public_image_url`, `image_filename`, `media_ready_at` e `image_spec`, sin renderizar.
   - `released`: Supabase confirma que el objeto no existe (404 o `NoSuchKey`). El claim se libera y el registro vuelve a `blocked_media`; el Worker lo renderiza en un ciclo posterior.
   - Rechazos (no cambia nada): `CLAIM_NOT_STALE` (menos de 1 h), `CLAIM_ID_MISMATCH` (el claim cambió desde la auditoría), `ASSET_STATE_AMBIGUOUS` (403, 5xx, timeout: nunca se interpreta como ausencia), `ASSET_INVALID_REQUIRES_STORAGE_REVIEW` (hay un objeto pero no es un JPEG válido de 1080x1350; como el Worker sube con `x-upsert: false`, un re-render tampoco podría reemplazarlo), `EXISTING_MEDIA_MISSING` (la `public_image_url` ya registrada desapareció).
2. **Aplicar.** Repetir con `apply` marcado. El workflow reproduce la auditoría de ownership y abre un único PR `Reconcile media claim: <content_id> (<acción>)` que solo cambia ese registro de `queue/`. **Fusionar el PR es la decisión**; cerrarlo la anula. Si `main` cambió el registro mientras tanto, el PR entra en conflicto: cerrarlo, borrar la rama `media-reconciliation/<content_id>` y repetir desde el dry run.
3. **Descartar.** Si la historia ya no debe publicarse (o el objeto es inválido y nadie va a revisar el almacenamiento), lanzar con `mode: discard` y un `reason`. El registro pasa a `discarded` sin claim y el motivo queda en `publish_attempt_history`. Es una decisión del propietario y se reporta como `owner_manual_discard`.

Cada resultado añade una entrada `stage: media_reconciliation` (`adopted_existing_media`, `released_no_media` o `discarded_by_owner`) con el `claim_id` y su `started_at`. La tabla de ownership exige esa entrada para `processing_media -> blocked_media`, así que un reset manual sin evidencia falla en CI.

Carrera con un render en curso: si el Worker siguiera trabajando con ese claim, su escritura final usa el SHA anterior y GitHub la rechaza tras el merge; si llegara antes, el PR de reconciliación entra en conflicto. En ningún caso hay dos escrituras válidas.

Rollback: no revertir un PR de reconciliación ya fusionado. Tras `adopted` el publicador puede haber reservado el registro, y tras `released` el Worker puede haber tomado un claim nuevo; la reversión sería una transición sin dueño y la auditoría la rechaza. Si la decisión fue errónea, se corrige con el siguiente paso normal del estado actual (por ejemplo `discard`). Para retirar la herramienta, revertir el PR que la introdujo: el reconciliador nunca escribe en Supabase, así que no deja nada que limpiar.

## R5 — Lecturas/health

Retries solo transitorios, máximo dos adicionales por ciclo (base 5/20 s, jitter, respetar Retry-After); diferir al scheduler si espera larga. 401/403: escalar permisos, sin reconectar automáticamente. Circuit breaker por dependencia; health agregado debe mostrar qué carril está degradado y qué comprobaciones son desconocidas. Lectura `200` sin freshness no da estado saludable. Editorial puede trabajar con dedupe pendiente; promoción exige verificación actual. Mantener un monitor único y alertar solo cambios significativos.

## R6 — Staging / despliegue / rollback

Phase 2 permanece pausada. No secretos/bindings/cron productivos, no fixtures bajo queue, no auto-merge ni deploy. Antes de integrar: diff permitido, tests, revisión por SHA, export real y rollback ensayado; aprobación explícita por componente. Revertir código nunca revierte efectos externos. Un rollback conserva claims, recibos e IDs; no reintroducir retry por feed vacío aunque figurara en LKG.
