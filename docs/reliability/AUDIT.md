# MATRIX 24: auditoría de fiabilidad — 24 septiembre 2026

## Alcance y veredicto

Base inspeccionada: `d86e41b3b059678e49a7a7a3a84953495ad993fb`. Auditoría de código, 12 registros de cola, historial disponible, conectores de lectura y configuración visible de tareas. Cambios propuestos exclusivamente en documentación, modelo offline de staging y tests. No se ha desplegado, publicado, reintentado, liberado un claim ni modificado una tarea productiva.

**No se puede certificar producción extremo a extremo con estas evidencias.** La recuperación está registrada, pero hay una regla activa que permite duplicar y falta comprobar el runtime desplegado. Los tests de fixtures no prueban ejecución real en Cloudflare ni el cumplimiento de prompts por un publicador autónomo.

## Hallazgos ordenados por impacto

1. **P0: reintento tras ausencia en feeds.** El prompt activo de Auto Publisher, apartados 6 y 12, permite un reintento después de 15 minutos y dos lecturas sin coincidencias. Contradice su propia prohibición de reintentar cuando hay incertidumbre. Ausencia, antigüedad y conectividad no prueban que no hubo publicación. La cola conserva dos recuperaciones con este criterio (AI/UN y Saudi-Houthi). No se ha demostrado un duplicado; tampoco se ha demostrado que el criterio fuese seguro.
2. **P1: verificación usa snapshots anteriores al intento.** Lectura realizada durante esta auditoría: `instagram.data_fetched_at=2026-09-24T20:32:13`; `instagram_public.data_fetched_at=2026-09-24T20:41:00`. Windsor define este campo como UTC. Ambos son anteriores al éxito Saudi-Houthi de `21:06:30Z`. Seis filas en cada lectura; ninguna con `17901642846667497`. Estas lecturas no permiten inferir ausencia del post nuevo.
3. **P1: bloqueo global y acoplamiento.** Auto Publisher exige ambos feeds accesibles y bloquea toda promoción si cualquier registro está pendiente. Editorial dice continuar, pero su primer paso exige también leer Instagram sin especificar degradación. Son puntos de acoplamiento, no independencia garantizada.
4. **P1: observabilidad pausada.** UI de tareas: Auto Publisher y Editorial Engine activos, frecuencia horaria; Phase 2 pausada; Health Watch pausado; recuperaciones puntuales completadas. Tener un chequeo puntual completado no equivale a monitoreo recurrente. No se cambió esta configuración.
5. **P1: recuperabilidad incompleta.** MANIFEST declara explícitamente que el backup no es exportación byte a byte de Cloudflare. Hash local verificado: `972baa91a39ac8959a74ccaf37899b516ef6b544522cf29675536d64583ed0f5`, 30160 bytes. Eso prueba integridad del archivo reconstruido, no identidad con el despliegue ni rollback funcional.
6. **P1: garantías en texto, no controles de acceso.** Nombres de staging, ausencia de cron en JSON y prompts restrictivos son evidencia de diseño. No demuestran permisos mínimos de credenciales remotas ni aislamiento de bindings reales. Phase 2 debe seguir pausada.
7. **P2: timestamps y evidencia editorial.** Varios `success` comparten exactamente timestamp con `started`, aunque timestamps de Instagram son posteriores. No sirven para calcular latencia precisa. Saudi-Houthi tiene una fuente guardada; no demuestra cumplimiento del nuevo requisito de dos fuentes. No se infiere falsedad de la noticia ni se reescribe lo publicado: auditar fuentes por separado y registrar cuándo entró en vigor cada política.

## Cuánto tarda la verificación secundaria

No existe en la evidencia consultada un máximo garantizado para esta combinación de Meta + Windsor + scheduler. No prometer 1–2 minutos. Distinguir confirmación de la acción, visibilidad de lectura y archivo del permalink.

El historial del repo permite medir **tiempo hasta archivado del permalink**, no el instante en que el feed comenzó a mostrarlo:

| Registro | Éxito registrado → permalink archivado |
| --- | --- |
| AI/UN | 8 min 51 s |
| Nueva Zelanda | 54 min 37 s |
| India NSE | 1 h 59 min 19 s |
| Kyiv | 2 h 33 min 34 s |
| Sudáfrica | 2 h 58 min 26 s |

Muestra pequeña (n=5), sesgada por frecuencia de consultas y marcas registradas por el agente. No calcular p95 ni SLA con ella. Saudi-Houthi seguía sin lectura secundaria en esta consulta alrededor de 17:34 ET, ~28 minutos después del éxito registrado; el usuario reportó verlo en su cuenta. La confirmación visual es evidencia humana útil, no mapeo automático de ID ni prueba de unicidad.

Windsor documenta una caché de consultas de seis horas; aplica a consultas repetidas según configuración, no es un SLA de Instagram ni demostración del TTL exacto de este MCP. Ver [documentación de caché](https://windsor.ai/documentation/understanding-cache-data-store-and-query-cache/) y [refresh programado](https://windsor.ai/documentation/how-to-schedule-automated-reporting-and-data-refreshing/). Un scheduler horario puede añadir hasta un ciclo nominal de demora cuando la lectura ya está disponible, más retrasos de ejecución/fallos.

## Evidencia reproducible

- [Base auditada / recuperación](https://github.com/55c8ck9mgp-maker/matrix24-media/commit/d86e41b3b059678e49a7a7a3a84953495ad993fb).
- [Corrección de esquema](https://github.com/55c8ck9mgp-maker/matrix24-media/commit/3d2554633077d1911396fb2ea0c54510c62ab019): diff comprueba `timestamp`, `verified_source_urls`, `image_generation_prompt` y campos nulos añadidos.
- [Media recuperada](https://github.com/55c8ck9mgp-maker/matrix24-media/commit/5f27961a9a6833b179ea100d394edf36f87c6a67).
- [Reserva huérfana](https://github.com/55c8ck9mgp-maker/matrix24-media/commit/5ba8935463908a8776c85d5beee3b351d4a677a3).
- [Staging PR #8](https://github.com/55c8ck9mgp-maker/matrix24-media/pull/8) y [CI previo exitoso](https://github.com/55c8ck9mgp-maker/matrix24-media/actions/runs/36038041222).
- Snapshot de cola: 12/12 `published` con IDs; cero estados activos en esa revisión. Es estado del repositorio, no garantía de unicidad en Instagram.
- UI de tareas y prompt activo inspeccionados en esta sesión. No se publican capturas con contenido ajeno a MATRIX 24.
- API de acciones Windsor: `create_image_post` disponible; parámetros `image_url`, `caption`; no expone idempotency key, consulta de intento, container lookup ni media lookup dedicado. Opciones de ambas lecturas vacías. Un filtro `media_id` puede filtrar una caché; no equivale a lectura directa de Meta.

## Límites de la auditoría

- `/health` no fue accesible mediante web; navegador devolvió `ERR_BLOCKED_BY_CLIENT`. No se eludió el bloqueo. No se comprobó salud del runtime en vivo ni versión/bindings/logs actuales.
- Documentación directa Meta devolvió 429. La colección oficial [Meta en Postman](https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api?entity=request-23987686-9b7c72f8-379e-4d8c-a3e8-49dc03d8489a) distingue container listo de publicación; integrar lookup directo exige validar API/permisos vigentes.
- No hay adaptador de publicación implementado en el repo: gran parte de la lógica vive en el prompt de una tarea. Modelo offline ≠ publicador instalado.
- No hay snapshot duradero completo de todos los resultados de herramientas históricas. Los incidentes referidos solo por conversación se etiquetan como reportados, no causas comprobadas.

## Entregables y siguiente gate

Leer [runbooks](RUNBOOKS.md), [catálogo](INCIDENTS.md), [arquitectura propuesta](DESIGN.md), [cambio mínimo del publicador](PUBLISHER_PATCH.md) y [validación/rollback](VALIDATION.md). Primero revisar y aprobar el cambio mínimo de política. No habilitar Phase 2 ni fusionar/desplegar cambios productivos por el solo hecho de que CI esté verde.
