# Diseño de continuidad y reconciliación

Estado: propuesta, no desplegada. Mantener Cloudflare media-only.

## Carriles independientes

| Carril | Propiedad y salida | Fallo y continuidad |
| --- | --- | --- |
| Investigación/editorial | `editorial/verified/`, fuentes exactas, claim checks, fechas de artículo/evento separadas, versión editorial | Si falla Instagram, continuar investigación con `duplicate_check_pending`; no promover aún. Máximo 6 candidatos elegibles, refrescar los antiguos cada 3 h. Limitar también borradores retenidos para evitar crecimiento ilimitado. |
| Promoción | Valida esquema y elegibilidad; crea un único `content_id` estable | Relectura y CAS; si el archivo ya existe, reconciliar promoción, nunca crear otro ID para el mismo evento/ángulo. Registro de promoción y cola pueden divergir: reparar marcación sin duplicar cola. |
| Media | Claim persistente, asset determinista por contenido/revisión, salida JPEG | Recuperar objeto existente validado antes de generar. `processing_media` no vence por reloj. Error de un registro no debe consumir todos los ciclos. |
| Publishing por canal/cuenta | Claim + intento + hash de payload duraderos antes del envío | Una única llamada por intento. Incertidumbre retiene claim y bloquea ese contenido/canal. No resetear estado Instagram para publicar en Threads. |
| Reconciliación | Lecturas y archivo de evidencia; nunca crea posts | IDs exactos, cuenta, intento, versión del contenido, timestamps de origen y consulta. Backoff y presupuesto independientes. |
| Observabilidad | Heartbeats y métricas de cada carril, observaciones inmutables | Puede alertar sin mutar cola. No crear publicaciones de prueba como health check. |

## Garantías y límite real

Sin idempotencia del proveedor ni lookup autoritativo del intento, exactamente una publicación más progreso garantizado tras cualquier fallo no es una garantía alcanzable. Elegir no duplicar: el contenido ambiguo queda en cuarentena. Puede continuar investigación, media y otros contenidos únicamente cuando existe deduplicación duradera y aislamiento por contenido/canal; si la identidad del evento es ambigua, bloquear también candidatos del mismo evento.

La política actual limita toda promoción a cola completamente limpia. Retirar ese gate antes de implementar dedupe y cuarentena por contenido sería imprudente. El cambio mínimo propuesto mantiene ese gate; la futura desacoplación necesita PR separado y pruebas de concurrencia.

## Diario durable

Clave única: `(platform, account_id, content_id, editorial_revision)`; además huella del evento para evitar duplicados con IDs nuevos. Guardar payload hash (caption completo + hashes de asset + destino), attempt_id, claim_owner, fence/version, submitted_at, respuesta sanitizada, receipt_ref, media_id como string y verificación independiente.

Secuencia requerida: validar → CAS claim/intento en una operación → releer propiedad → enviar una vez → persistir recibo durable → actualizar proyección de cola con CAS → reconciliación asíncrona. Una respuesta de escritura GitHub perdida exige releer, no recrear intento. Tras CAS fallido, recalcular sobre el contenido actual y comprobar owner/fence, nunca reemplazar solo el SHA en un snapshot viejo.

Una escritura GitHub y una petición Meta NO son una transacción atómica. La ventana entre enviar y guardar recibo sigue existiendo. Ni un flag `started` ni un proceso reiniciado pueden demostrar `not_sent`. Un fence local solo protege si todos los publicadores lo respetan; no puede cancelar un POST que el proveedor ya recibió. No liberar claims por edad ni robarlos automáticamente.

Estado de publicación y de verificación separados: `published` + `verification_pending` es válido. Guardar `confirmed_by=action_receipt|direct_lookup|manual_review`, `verified_at`, `permalink_status`, `last_checked_at`, `source_fetched_at`, `last_error` sin destruir evidencia anterior. Más de un ID candidato exige revisión; igual caption no garantiza identidad.

## Estrategia de verificación

| Método | Uso | Límite |
| --- | --- | --- |
| Respuesta `create_image_post` | Confirmación primaria cuando retorna ID de media publicada y destino/intent están vinculados | No confundir ID de container con media; esquema actual no ofrece idempotency key; guardar respuesta sanitizada antes de cualquier archivo adicional. |
| Lookup Meta por media ID | Ruta preferida futura para ID, permalink y metadatos del objeto | Requiere credencial autorizada y permisos, API vigente y pruebas; no está expuesto por estas acciones Windsor. No introducirlo en producción en este PR. |
| `instagram` | Evidencia positiva por ID exacto, cuenta y `data_fetched_at` | Consultar fields mínimos sin insights; una consulta exitosa puede ser vieja. |
| `instagram_public` | Corroboración/fallback | Mismo proveedor Windsor: dos conectores no garantizan independencia de fallos/caché. |
| Permalink/shortcode | Archivar el valor retornado; inspección humana del post asociado | No convertir numéricamente un Graph ID a shortcode; no adivinar URL. 404/login wall no prueba ausencia; no usar HTTP 200 de una página genérica como verificación. |
| Health checks | Disponibilidad de lecturas, freshness, backlog, última ejecución exitosa | `/health=ok` no prueba permisos de publicación ni flujo extremo a extremo. |

Cadencia propuesta para un scheduler capaz: tras recibo, lectura a 1, 5, 15, 30, 60 minutos y luego cada hora hasta 24 h; después alerta y revisión diaria con presupuesto. Son umbrales internos de observación, nunca autorización de retry ni garantía del proveedor. Jitter y Retry-After; agrupar varias publicaciones por cuenta en una lectura. Si `data_fetched_at` no avanza, no repetir cada minuto un snapshot igual. La tarea horaria existente solo puede revisar en sus ciclos; no afirmar cadencia de un minuto sin otro scheduler aprobado.

Métricas: receipt-to-first-positive-read, receipt-to-permalink-archive (separadas), cache_age, scheduler_delay, unknown_count/age, oldest_claim_age, editorial_backlog, schema_rejections, CAS_conflicts, media_stage_latency, last_success por carril y errores de autenticación. Conservar observaciones censuradas (aún no visto) para no sesgar percentiles; registrar reloj UTC fiable y mostrar ET.

Alertas propuestas: inmediata por duplicado confirmado, ID incompatible, publicación ambigua o pérdida de evidencia; warning a 60 minutos de verificación secundaria pendiente y escalación a 6 h; 24 h revisión humana. Un recibo válido no se revoca por estos umbrales. Alertas deduplicadas por incidente y cambios de estado, sin ruido cada ciclo.

## Health e independencia operacional

Reconciliador con solo lectura del proveedor y permiso acotado de archivo. Editorial sin permiso social. Staging sin secretos, bindings, cron ni rutas de escritura productiva, y con egress denegado donde sea posible. CI usa fixtures y permisos GitHub de lectura. Registrar dos ciclos de editorial exitosos con publicador bloqueado en simulación antes de integrar desacoplación.

Cambios en componentes por fases: A) quitar retry inseguro y añadir freshness; B) diario/recibos y CAS comprobados con inyección de fallos; C) reconciliador con scheduler aprobado; D) cuarentena por contenido y promoción desacoplada; E) cada plataforma nueva en pruebas con cuenta de staging y su propio estado. No activar Facebook/Threads por una prueba de texto previa.
