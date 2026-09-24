# Validación, revisión y límites

## Ejecutar sin red ni credenciales

```sh
node --check worker/backups/v3.2.0/recovery/index.reconstructed.js
node --check worker/staging/v3.2.0/src/core.js
node --check worker/staging/v3.2.0/src/index.js
node scripts/verify-worker-backup.mjs
node --test tests/*.test.mjs
```

El workflow existente ejecuta ahora todas las suites `tests/*.test.mjs`; conserva permisos de lectura y no despliega. El modelo `worker/staging/reliability/policy.mjs` no tiene transporte, secrets, cron ni entrypoint productivo; siempre devuelve publishAllowed=false. Sirve para validar clasificación conservadora de evidencia, NO para publicar. Su flag continueEditorial expresa política; no demuestra que la tarea externa la cumpla.

## Casos de regresión

Baseline: claim de media, SHA conflict, reuse, fallo tras claim, ready ya preparado, claim viejo, SHA requerido, content_id duplicado.

Nueva suite: orphan viejo y dual-feed no-match; ID sin permalink; cuenta incorrecta; recibo válido tras fallo de archivo; container/attempt/cuenta/contenido/ID numérico inválidos; candidatos de caption ambiguos; estados inválidos; snapshots viejos y nuevos insuficientes; retries transitorios acotados/Retry-After; rechazo de cron/bindings/variables extra en staging; matriz de estados que nunca autoriza publicación ni borrado de claim.

## Revisión adversarial realizada

- No se tocaron queue, source de backup, credenciales, horario ni tareas productivas.
- Se quitaron recomendaciones documentales de retry tras no-match para que los runbooks no las reintroduzcan.
- Se comprobó hash exacto del backup; una diferencia local de newline durante transferencia fue corregida conservando bytes originales, sin cambiar manifest.
- Se revisó semántica del modelo: recibo necesita identidad de cuenta/contenido/intento; ID siempre string; caption no adopta automáticamente; ausencia no libera claim.
- Config validator limita claves conocidas, pero no inspecciona secrets guardados en Cloudflare. No confundir passing CI con aislamiento real.

## Pendiente antes de merge/integración

Revisión humana del diff y CI del commit exacto. Para desplegar requiere además confirmación explícita del usuario. No fusionar automáticamente. Para un futuro adaptador, faltan fault-injection tests reales contra almacenamiento simulado con CAS: dos publicadores concurrentes; timeout de claim ya aplicado; crash antes/después de invocar; respuesta perdida; éxito externo + fallo de archivo; conflicto con otro escritor; restauración del proceso antiguo tras fence; cambio editorial durante envío. No presentar los tests puros actuales como cobertura de esos transportes.

## Rollback

Este PR solo agrega política offline/docs y extiende descubrimiento de tests en CI. Revertirlo afecta esos archivos, sin efectos sociales ni migración. Conservar el catálogo de incidentes y regla no-retry inseguro como documentación de seguridad aunque se revierta implementación. No usar git revert de commits de cola para «despublicar» ni restaurar claims viejos. Cualquier cambio productivo posterior tendrá snapshot del prompt/config y procedimiento separado, probado en staging.
