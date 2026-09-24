# Aplicación de la política de reconciliación — 24 septiembre 2026

## Cambio aplicado

Con autorización explícita del usuario, se actualizó la tarea existente **MATRIX 24 Auto Publisher** (ID `6ab1c5df4d288191af04ec56ef43a33d`) mediante su editor de tareas. No se creó otra tarea, no se cambió la frecuencia horaria, no se modificó el repositorio de producción, no se desplegó Cloudflare y no se reactivó Phase 2.

La verificación visual posterior a guardar y recargar mostró el prompt persistido con estas reglas:

- un `publishing`, `publish_unknown` o claim huérfano nunca crea automáticamente un nuevo intento por tiempo transcurrido, feeds vacíos, caption sin coincidencia o conectores accesibles;
- los feeds vacíos, incluso si parecen frescos, son evidencia inconclusa;
- un ID de media válido ligado a la cuenta destino es evidencia positiva preferida;
- caption, hora o imagen sin ID son candidatos de revisión, no identidad automática;
- un fallo al archivar después de un ID confirmado puede reintentar solo el archivo mediante SHA/ownership fresco;
- la respuesta ambigua conserva `publish_unknown`, claim e identidad del intento;
- se exige registrar `data_fetched_at` cuando esté disponible y no sobrescribir datos concurrentes con un SHA nuevo aplicado a un snapshot viejo.

El prompt conserva el máximo de una publicación por ciclo, preflight, SHA/ownership antes de publicar, no blind retry, Cloudflare media-only, separación editorial y prohibición Facebook/Threads.

## Verificación realizada

- El editor mostró el texto cambiado antes de guardar.
- Tras guardar y recargar, el editor mostró los apartados 6, 10 y 12 persistidos como reconciliación sin retry automático.
- La tarea sigue marcada como horaria.
- Phase 2 continuaba marcada como **Paused** en la misma pantalla.
- No se ejecutó una publicación de prueba: publicar para validar esta regla sería un side effect innecesario.

## Límite

Este cambio endurece el comportamiento de la tarea programada, pero no convierte la integración en una transacción distribuida ni valida el Worker desplegado. El modelo de staging y los tests del PR siguen siendo evidencia de política, no prueba del runtime social real.

## Seguimiento

PR #9 permanece en borrador. No se hizo merge ni deploy. El siguiente trabajo seguro es revisar health/observabilidad solo lectura y preparar un adaptador de recibos/lookup autoritativo en staging antes de desacoplar más la promoción editorial.
