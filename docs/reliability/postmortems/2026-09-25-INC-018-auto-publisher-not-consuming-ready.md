# INC-018 — Auto Publisher no consume `ready_to_publish`

Estado: **contenido**. La publicación automática sigue incompleta hasta observar un ciclo real con recibo de Media ID.

## Detección y evidencia

- La programación de `matrix24-publisher` ejecutó cuatro eventos `Success` entre 03:45 y 04:30 EDT el 25 de septiembre de 2026.
- El registro `matrix24-20260924-anthropic-akamai-cloud-deal` avanzó correctamente de media a `ready_to_publish` y contiene una imagen pública válida.
- No existe `instagram_publish` ni un Media ID en el registro. Por tanto, no se autoriza inferir publicación ni reintentar.

## Causa confirmada

El Worker de Cloudflare es deliberadamente un productor de media: termina en `ready_to_publish`. La publicación corresponde al Auto Publisher externo. La causa de que ese consumidor no haya tomado este elemento aún no está confirmada: puede estar pausado, no leer la ruta/estado actual o tener un fallo de configuración. Ninguna evidencia apunta a un fallo del Worker.

## Reparación segura

1. El Auto Publisher debe seleccionar como máximo un registro `ready_to_publish` por ciclo.
2. Antes de llamar al proveedor, debe guardar por SHA una claim `publishing` ligada a `content_id`, cuenta, `attempt_id` y `payload_hash`.
3. Solo una respuesta con `media_id` numérico en cadena puede marcar `published`; guardar el recibo antes de archivar.
4. Timeout, respuesta sin Media ID o conflicto dejan `publish_unknown` y la claim intacta. Solo reconciliación por Media ID exacto y cuenta exacta puede cerrar el caso.
5. El carril editorial y el de media continúan aunque publicación esté en cuarentena.

El modelo offline `worker/staging/reliability/publisher-projection.mjs` cubre estas proyecciones sin credenciales, red ni efectos externos. No es el Auto Publisher de producción.

## Validación requerida antes de producción

- PR revisado y pruebas de staging verdes.
- Una sola modificación del Auto Publisher, sin cambiar Worker ni esquema de cola en la misma promoción.
- Un ciclo real debe mostrar: claim durable, llamada única, Media ID exacto y archivo `published`; o `publish_unknown` sin reintento.
- Fase 2 permanece aislada.

## Riesgo residual y cierre

No cerrar hasta que un ciclo posterior procese un elemento nuevo con el recibo exacto. El feed, caption, antigüedad o ausencia de una lectura no demuestran ausencia de publicación.
