# Revisión propuesta: MATRIX 24 Health Watch

Estado: **no aplicada**. La tarea existente `MATRIX 24 Health Watch` (ID `6ab29fd095b88191aa297f99b8ead7a4`) fue inspeccionada el 24 de septiembre y estaba pausada. Es de solo lectura, lo cual es correcto. No reactivarla ni alterar su frecuencia sin autorización separada.

## Defecto de evidencia

El prompt actual permite contar una historia como autónoma al interpretar `published_at`, `publish_attempt_history` y lecturas de Instagram. Es insuficiente si el historial omite el origen de una reparación, la consulta está cacheada o se identifica por caption/permalink sin ID exacto. La regla de no reintento acaba de endurecerse; el monitor no debe conservar el antiguo concepto de recovery controlado como señal de éxito autónomo.

## Sustituir el criterio de historia calificable

Una historia solo cuenta para una racha autónoma si el mismo archivo de GitHub contiene: media_pipeline success; exactamente un instagram_publish success con el mismo instagram_media_id string; ningún resultado `unknown`, `manual`, `controlled_retry`, `recovered` o nota de intervención; y ningún conflicto de identidad. Si falta cualquiera de esas pruebas, clasificar `insufficient_evidence` y no incrementar ni resetear silenciosamente la racha. Reportar la incertidumbre y preservar el registro.

La coincidencia por media ID exacto y cuenta destino es evidencia positiva preferida. Caption, permalink, hora o imagen sin ID son candidatos de revisión. Una lectura vacía, incluso posterior al intento, es `empty_read_inconclusive`; una con data_fetched_at anterior al intento es `snapshot_predates_attempt`. Ninguna prueba ausencia ni autoriza una mutación.

## Contrato de monitor

Cada ciclo solo puede leer cola, feeds y resultados. Debe emitir un snapshot por carril: GitHub, media, publicación, reconciliación y editorial. Reportar `healthy`, `degraded` o `unknown`, nunca “healthy” si no hay `data_fetched_at` reciente o la fuente no expone esa señal. Registrar últimas ejecuciones conocidas, edad del backlog por estado, claims ambiguos, errores de esquema/CAS y candidatos editoriales, pero no editar ningún archivo.

El monitor no tiene autoridad para: publicar, reintentar, cambiar claim, actualizar prompt de otras tareas, promover candidatos, activar Phase 2, activar/desactivar tareas, llamar endpoints de Worker ni declarar la producción cerrada. Que tres registros parezcan calificar no reactiva Phase 2: eso sigue requiriendo revisión y autorización explícita.

Alertar solo cambios significativos: claim ambiguo nuevo, duplicado positivo, lectura degradada persistente, staleness confirmada, backlog sin avance durante dos ciclos o evidencia de identidad conflictiva. No alertar repetidamente por el mismo estado.

## Validación antes de activar

1. Revisar el prompt resultante frente a este documento.
2. Ejecutar `node --test tests/*.test.mjs`; la suite `health-policy.test.mjs` prueba fail-closed, feed vacío y ausencia de permisos de escritura.
3. Confirmar que Phase 2 continúa pausada y que Health Watch solo lee.
4. Activar la tarea existente únicamente con autorización explícita. Observar dos ciclos sin efectos de escritura.
5. Conservar la tarea pausada ante cualquier resultado inesperado; no crear otra.
