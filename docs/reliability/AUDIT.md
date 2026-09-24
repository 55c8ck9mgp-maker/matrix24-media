# MATRIX 24: auditoría de fiabilidad — 24 septiembre 2026

## Alcance y veredicto

Base inspeccionada: `d86e41b3b059678e49a7a7a3a84953495ad993fb`. Auditoría de código, 12 registros de cola, historial disponible, conectores de lectura y configuración visible de tareas. Cambios propuestos exclusivamente en documentación, modelo offline de staging y tests. No se ha desplegado, publicado, reintentado, liberado un claim ni modificado una tarea productiva.

**No se puede certificar producción extremo a extremo con estas evidencias.** La recuperación está registrada, pero hay una regla activa que permite duplicar y falta comprobar el runtime desplegado. Los tests de fixtures no prueban ejecución real en Cloudflare ni el cumplimiento de prompts por un publicador autónomo.

## Hallazgos ordenados por impacto

1. **P0: reintento tras ausencia en feeds.** El prompt activo de Auto Publisher, apartados 6 y 12, permite un reintento después de 15 minutos y dos lecturas sin coincidencias. Contradice su propia prohibición de reintentar cuando hay incertidumbre. Ausencia, antigüedad y conectividad no prueban que no hubo publicación. La cola conserva dos recuperaciones con este criterio (AI/UN y Saudi-Houthi). No se ha demostrado un duplicado; tampoco se ha demostrado que el criterio fuese seguro.
2. **P1: verificación usa snapshots anteriores al intento.** Lectura realizada durante esta auditoría: `instagram.data_fetched_at=2026-09-24T20:32:13`; `instagram_public.data_fetched_at=2026-09-24T20:41:00`. Windsor define este campo como UTC. Ambos son anteriores al éxito Saudi-Houthi de `21:06:30Z`. Seis filas en cada lectura; ninguna con `17901642846667497`. Estas lecturas no permiten inferir ausencia del post nuevo.
3. **P1: bloqueo global y acoplamiento.** Auto Publisher exige ambos feeds accesibles y bloquea toda promoción si cualquier registro está pendiente. Editorial dice continuar, pero su primer paso exige también leer Instagram sin especificar degradación. Son puntos de acoplamiento, no independencia garantizada.
4. **P1: observabilidad y evidencia de runtime.** Durante la auditoría inicial, Health Watch estaba completado y no ofrecía monitoreo recurrente. El 24 de septiembre se creó un reemplazo activo, horario y de solo lectura; no publica, reintenta, escribe, habilita Phase 2 ni interpreta snapshots ausentes como ausencia. Cloudflare confirma que el servicio real se llama `matrix24-publisher` y muestra actividad con cero errores en las últimas 24 horas, pero el detalle de versión, cron y bindings no cargó en esta sesión: siguen sin verificar.
5. **P1: recuperabilidad incompleta.** MANIFEST declara explícitamente que el backup no es exportación byte a byte de Cloudflare. Hash local verificado: `972baa91a39ac8959a74ccaf37899b516ef6b544522cf29675536d64583ed0f5`, 30160 bytes. Eso prueba integridad del archivo reconstruido, no identidad con el despliegue ni rollback funcional.
6. **P1: garantías en texto, no controles de acceso.** Nombres de staging, ausencia de cron en JSON y prompts restrictivos son evidencia de diseño. No demuestran permisos mínimos de credenciales remotas ni aislamiento de bindings reales. Phase 2 debe seguir pausada.
7. **P2: timestamps y evidencia editorial.** Varios `success` comparten exactamente timestamp con `started`, aunque timestamps de Instagram son posteriores. No sirven para calcular latencia precisa. Saudi-Houthi tiene una fuente guardada; no demuestra cumplimiento del nuevo requisito de dos fuentes. No se infiere falsedad de la noticia ni se reescribe lo publicado: auditar fuentes por separado y registrar cuándo entró en vigor cada política.

## Cuánto tarda la verificación secundaria

No existe en la evidencia consultada un máximo garantizado para esta combinación de Meta + Windsor + scheduler. No prometer 1–2 minutos. Distinguir confirmación de la acción, visibilidad de lectura y archivo del permalink.
