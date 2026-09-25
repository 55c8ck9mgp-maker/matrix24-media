# Lookup directo de Media ID

## Hallazgo

Meta documenta `GET /<IG_MEDIA_ID>` para leer un objeto de media de una cuenta profesional. Puede devolver `id`, `owner`, `permalink`, `shortcode` y `timestamp`. Esto es la fuente preferida para reconciliar un Media ID ya recibido; los feeds de Windsor siguen siendo corroboración, no prueba de ausencia.

Fuente oficial: https://developers.facebook.com/documentation/instagram-platform/reference/instagram-media

## Contrato propuesto, no desplegado

1. Sólo iniciar tras una respuesta de publicación con Media ID válido o un recibo durable.
2. Solicitar el objeto por ese ID con token de la cuenta profesional y fields mínimos: `id,owner,permalink,shortcode,timestamp`.
3. Aceptar evidencia positiva sólo si `id` coincide exactamente con el Media ID archivado y `owner.id` coincide con la cuenta destino.
4. Archivar sólo campos ausentes mediante CAS fresco; conservar el receipt original. Nunca sobrescribir evidencia previa con un snapshot antiguo.
5. Token inválido, 403, 404, timeout, respuesta sin owner, ID incompatible o cuenta incompatible significan `unknown` o `identity_conflict`, nunca `not_published`.
6. El lookup no tiene autoridad para publicar, reintentar, limpiar claim, activar Phase 2 ni alterar la programación.

## Criterio de aceptación en staging

- Modelo puro sin transporte, credenciales ni entry point productivo.
- Pruebas para coincidencia exacta; owner equivocado; ID distinto; tipo container; permalink ausente; error de autenticación y timeout.
- Toda salida conserva `publishAllowed: false`, `clearClaim: false` y `continueEditorial: true`.
- Integración real requiere PR separado, token de sólo lectura con permisos mínimos, secret inventory, revisión del alcance y aprobación explícita de despliegue.

## Límite

El endpoint confirma un ID conocido. No resuelve por sí solo una llamada de publicación ambigua que nunca devolvió ID ni recibo durable. Ese caso permanece en cuarentena y se escala; no se reenvía contenido.

## Reemplazo de egress: GitHub Actions

El Worker de staging no pudo completar su subrequest a `graph.instagram.com` aun con redirect manual. El reemplazo es `.github/workflows/instagram-reconciliation.yml`: ejecución manual, una sola lectura, `permissions: contents: read`, timeout de dos minutos y sin cron, cola, claims ni publicación. El secreto `IG_READ_TOKEN` pertenece exclusivamente a GitHub Actions; el resultado solo confirma `media_id` exacto y `username=matrix24global`. Una salida `unknown` conserva el caso y nunca autoriza reintento.
