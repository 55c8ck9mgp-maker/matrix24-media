# Revisión aplicada: MATRIX 24 Health Watch

Estado: **aplicada el 24 de septiembre de 2026** a la tarea existente `MATRIX 24 Health Watch` (ID `6ab29fd095b88191aa297f99b8ead7a4`). La frecuencia no se modificó y Phase 2 no fue activada. Tras guardar la política, la interfaz mostró la tarea como `Completed`; no quedó una ejecución programada activa. Este documento describe el contrato guardado y no autoriza reactivar ni cambiar su frecuencia sin revisión separada.

## Defecto de evidencia

El prompt anterior permitía contar una historia como autónoma al interpretar `published_at`, `publish_attempt_history` y lecturas de Instagram. Es insuficiente si el historial omite el origen de una reparación, la consulta está cacheada o se identifica por caption/permalink sin ID exacto. La regla de no reintento exige eliminar el antiguo concepto de recovery controlado como señal de éxito autónomo.

## Criterio de historia calificable

Una historia solo cuenta para una racha autónoma si el mismo archivo de GitHub contiene: media_pipeline success; exactamente un instagram_publish success con el mismo instagram_media_id string; ningún resultado `unknown`, `manual`, `controlled_retry`, `recovered` o nota de intervención; y ningún conflicto de identidad. Si falta cualquiera de esas pruebas, clasificar `insufficient_evidence` y no incrementar ni resetear silenciosamente la racha.

La coincidencia por Media ID exacto y cuenta destino es evidencia positiva preferida. Caption, permalink, hora o imagen sin ID son candidatos de revisión. Una lectura vacía, incluso posterior al intento, es `empty_read_inconclusive`; una con `data_fetched_at` anterior al intento es `snapshot_predates_attempt`. Ninguna prueba ausencia ni autoriza una mutación.

## Contrato de monitor

Cada ciclo solo puede leer cola, feeds y resultados. Debe emitir un snapshot por carril: GitHub, media, publicación, reconciliación y editorial. Reportar `healthy`, `degraded` o `unknown`, nunca `healthy` si no hay `data_fetched_at` reciente o la fuente no expone esa señal. Registrar últimas ejecuciones conocidas, edad del backlog por estado, claims ambiguos, errores de esquema/CAS y candidatos editoriales, pero no editar ningún archivo.

El monitor no tiene autoridad para publicar, reintentar, cambiar claim, actualizar otras tareas, promover candidatos, activar Phase 2, activar/desactivar tareas, llamar endpoints de Worker ni declarar producción cerrada. Tres registros calificables tampoco reactivan Phase 2: requiere revisión y autorización explícita.

Alertar solo cambios significativos: claim ambiguo nuevo, duplicado positivo, lectura degradada persistente, staleness confirmada, backlog sin avance durante dos ciclos o evidencia de identidad conflictiva. No alertar repetidamente por el mismo estado.

## Validación completada

1. El prompt guardado fue revisado frente a este documento: sólo lectura, evidencia exacta por Media ID, feed vacío inconcluso y prohibición de habilitar Phase 2 o escribir en producción.
2. `node --test tests/*.test.mjs` pasó 21 de 21 pruebas, incluyendo fail-closed, feed vacío, snapshots atrasados y ausencia de permisos de escritura.
3. Phase 2 permanece pausada. No se publicó, reintentó, modificó cola ni desplegó Worker.
