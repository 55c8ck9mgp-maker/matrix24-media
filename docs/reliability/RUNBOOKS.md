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

## R5 — Lecturas/health

Retries solo transitorios, máximo dos adicionales por ciclo (base 5/20 s, jitter, respetar Retry-After); diferir al scheduler si espera larga. 401/403: escalar permisos, sin reconectar automáticamente. Circuit breaker por dependencia; health agregado debe mostrar qué carril está degradado y qué comprobaciones son desconocidas. Lectura `200` sin freshness no da estado saludable. Editorial puede trabajar con dedupe pendiente; promoción exige verificación actual. Mantener un monitor único y alertar solo cambios significativos.

## R6 — Staging / despliegue / rollback

Phase 2 permanece pausada. No secretos/bindings/cron productivos, no fixtures bajo queue, no auto-merge ni deploy. Antes de integrar: diff permitido, tests, revisión por SHA, export real y rollback ensayado; aprobación explícita por componente. Revertir código nunca revierte efectos externos. Un rollback conserva claims, recibos e IDs; no reintroducir retry por feed vacío aunque figurara en LKG.
