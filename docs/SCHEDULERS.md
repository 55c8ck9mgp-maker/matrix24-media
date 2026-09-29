# MATRIX 24 — Registro de schedulers y ownership de transiciones

Este documento es la fuente única de qué scheduler existe, qué transición de
`queue/<content_id>.json` le pertenece y qué hacer cuando uno falla. Un
scheduler que no aparece aquí no tiene permiso para escribir `queue/`.

## Causa del patrón `is_enabled=false`

`is_enabled=false` no lo produce el código de este repositorio. Lo pone la
plataforma de tareas programadas de ChatGPT cuando una tarea choca con su
propio control de seguridad y la plataforma considera el fallo no recuperable
(INC-017 y INC-018). La secuencia observada:

1. Una tarea LLM (Auto Publisher, Editorial Engine) tiene capacidad general de
   escritura en GitHub y ejecuta una escritura condicional por SHA sobre
   `queue/` o `editorial/`.
2. El runtime de ChatGPT deniega esa escritura
   (`github_reservation_write_safety_denial`).
3. El runtime desactiva la tarea recurrente completa: `is_enabled=false`.
4. Nadie lo detecta hasta que un humano mira, porque la única señal es que un
   registro deja de avanzar.

Tres condiciones del diseño lo agravan, y el historial de `queue/` lo confirma
(ver "Evidencia" abajo):

- **Una sola identidad para todos los escritores.** Cloudflare Worker, Auto
  Publisher, reconciliación y reparaciones manuales hacen commit en `queue/`
  con la misma cuenta. Git no puede decir qué plano hizo cada escritura, así
  que nada podía imponer "un dueño por transición".
- **Escrituras cruzadas entre planos.** Hubo reservas de publicación que
  reescribían el caption, reintentos que reservaban de nuevo un
  `publish_unknown`, y dos corridas de media reemplazando el claim una de otra.
- **Tareas que administran otras tareas.** Prompts anteriores permitían a un
  monitor o publicador pausar/activar automatizaciones. Esto está prohibido
  desde LKG v2 y lo reafirma este registro.

### INC-018 fix: Publication Reservation workflow

A partir del 2026-09-28, la escritura SHA-condicional que crea `publish_attempt_id`
se ha movido de la tarea LLM Auto Publisher a un determinístico workflow de GitHub
Actions: `.github/workflows/publication-reservation.yml`. Este cambio elimina la
operación que activaba la denegación de seguridad de ChatGPT de la tarea LLM
completamente.

**Antes (roto):**
- Auto Publisher intenta: `ready_to_publish -> publishing` (crea `publish_attempt_id`)
- ChatGPT deniega: `github_reservation_write_safety_denial`
- Auto Publisher desactivado: `is_enabled=false`
- Contenido queda atascado en `ready_to_publish`

**Después (fijo):**
- Publication Reservation workflow (cada 5 min): `ready_to_publish -> publishing`
- Auto Publisher solo procede: `publishing -> published` (invoca Metricool)
- No escritura LLM arriesgada, sin denegación

La reactivación de Auto Publisher ahora es segura (ver "Reconciliación cuando un
scheduler falla" abajo); la denegación de seguridad no se repetirá porque ya no
realiza esa escritura.

## Registro de schedulers

| Scheduler | Runtime | Cadencia | Plano | Puede escribir en `queue/` |
| --- | --- | --- | --- | --- |
| Promotion Controller | GitHub Actions `editorial-queue-promotion.yml` | `*/15`, push, dispatch | Promotion | Sólo crea el registro (`null -> blocked_media`) vía PR revisable |
| Media Worker `matrix24-publisher` | Cloudflare cron | `*/15 * * * *` | Media | `blocked_media -> processing_media -> ready_to_publish` |
| Claude Publisher | GitHub Actions `claude-publisher.yml` | plan `*/30`; publish sólo por dispatch de Claude + aprobación del owner en el environment `instagram-production` | Publication | `ready_to_publish -> publishing -> published / publish_unknown`, liberación a `ready_to_publish` sólo si el contenedor falló (ver `docs/CLAUDE_PUBLISHER.md`) |
| Publication Reservation | GitHub Actions `publication-reservation.yml` | **deprecado 2026-09-29**, sólo manual | Publication | No usar: su reserva Metricool ya no tiene consumidor |
| Auto Publisher | Tarea ChatGPT | **debe permanecer desactivada** (reemplazada por Claude Publisher) | Publication | Ninguna |
| Reconciliación de claims de media | GitHub Actions `media-claim-reconciliation.yml` (manual) | manual | Media | Vía PR de cola: `processing_media -> ready_to_publish` (adopta JPEG existente), `-> blocked_media` (libera claim sin media) o `-> discarded` (owner) |
| Reconciliación Instagram | GitHub Actions `instagram-reconciliation.yml` | `20,50 * * * *` | Recovery | Sólo lectura hacia Instagram. Con `INSTAGRAM_RECONCILIATION_APPLY=true`: `publishing`/`publish_unknown -> published` y enriquece `published` con coincidencia única de caption |
| Metricool recovery | GitHub Actions `metricool-recovery.yml` | **deprecado 2026-09-29**, sólo manual | Recovery | Ninguna (sólo informe) |
| Production state audit | GitHub Actions `production-state-audit.yml` | `7 * * * *` | Observation | Ninguna |
| Queue transition ownership | GitHub Actions `queue-transition-ownership.yml` | push/PR sobre `queue/` | Observation | Ninguna |
| Health Watch / Production Monitor | Tareas ChatGPT/Claude | definida por el owner | Observation | Ninguna |
| Editorial Engine | Tarea ChatGPT | definida por el owner | Research | Ninguna (sólo `editorial/verified/` vía PR) |

## Tabla de ownership de transiciones

Codificada en `scripts/queue-transition-ownership.mjs` (`TRANSITION_OWNERS`).

| Transición | Único dueño | Condición |
| --- | --- | --- |
| `null -> blocked_media` | Promotion | Sin estado de media ni de publicación |
| `blocked_media -> processing_media` | Media | Crea `media_claim` |
| `processing_media -> ready_to_publish` | Media | Libera `media_claim`, deja URL HTTPS |
| `processing_media -> blocked_media` | Media (reconciliador manual) | Libera `media_claim` sin URL, con entrada `media_reconciliation`/`released_no_media` del mismo claim |
| `ready_to_publish -> publishing` | Publication | `publish_attempt_id` nuevo, sin claim ni evidencia previa |
| `publishing -> publishing` | Publication | Mismo `publish_attempt_id` (recibos del proveedor) |
| `publishing -> published` | Publication | Evidencia positiva ligada a Instagram |
| `publishing -> publish_unknown` | Publication | Mismo intento |
| `publishing -> ready_to_publish` | Publication | Entrada de historial del mismo intento y ningún recibo del proveedor |
| `publish_unknown -> published` | Recovery | Evidencia positiva |
| `publish_unknown -> ready_to_publish` | Recovery | Igual que la liberación anterior |
| `published -> published` | Recovery | Sólo añade permalink/Media ID ausente o quita campos de claim residuales |
| `* -> discarded`, corrección editorial pre-claim | Owner (manual) | Se reporta como advertencia, nunca silenciosa |

Cualquier otra transición no tiene dueño y es una violación, en particular:
`publish_unknown -> publishing` (reintento ciego), `ready_to_publish -> published`
(saltarse la reserva), `processing_media -> processing_media` con otro claim
(carrera de media) y borrar un registro.

Reglas adicionales por escritura:

- Un plano sólo cambia sus propios campos. Media no toca claims de
  publicación; Publication no toca caption, headline ni media.
- `publish_attempt_history` es append-only (el Worker puede recortar al
  máximo de 50 entradas por el frente).
- Un commit es una corrida de scheduler: no puede actuar como dos planos.

## Garantía de "no dos schedulers escribiendo a la vez"

1. **Por registro:** toda escritura a `queue/` es condicional al SHA leído
   (GitHub Contents API). Dos escritores simultáneos sobre el mismo archivo:
   uno gana y el otro recibe 409 y debe releer, nunca pegar el SHA nuevo a un
   snapshot viejo (INC-005).
2. **Por transición:** aun si el CAS pasa, sólo el dueño de la transición la
   puede hacer. Media sólo ve `blocked_media`, Publication sólo ve
   `ready_to_publish` y su propio intento, Recovery sólo ve
   `publishing`/`publish_unknown`. Los conjuntos de estados de entrada no se
   solapan, así que dos planos nunca compiten por el mismo registro.
3. **Detección:** `queue-transition-ownership.yml` reproduce cada commit de un
   push o PR contra la tabla y falla con el commit, archivo y regla violada.
   Es observación: no revierte ni reintenta. Para convertirlo en bloqueo,
   el owner puede marcarlo como check requerido en la protección de `main`
   (los PRs quedan bloqueados; los escritores directos por API siguen
   detectados después del hecho).

## Reconciliación cuando un scheduler falla

`production-state-audit.yml` (cada hora) reporta `stalled_transition` con el
plano dueño. Umbrales por defecto (`DEFAULT_STALL_MINUTES`):

| Estado | Dueño que debe actuar | Umbral | Lectura típica |
| --- | --- | --- | --- |
| `blocked_media` | Media | 45 min (3 ciclos cron) | Worker caído o cron desactivado |
| `processing_media` | Media | 45 min | Claim de media huérfano |
| `ready_to_publish` | Publication | 180 min | Firma de INC-018: Auto Publisher con `is_enabled=false` |
| `publishing` | Recovery | 60 min | Resultado de envío sin archivar |
| `publish_unknown` | Recovery | 60 min | Requiere evidencia positiva |

Reglas:

1. Sólo el plano dueño actúa sobre un registro estancado. Ningún otro
   scheduler "ayuda" tomándolo: eso es exactamente la escritura cruzada que
   este registro prohíbe.
2. La edad nunca prueba que un efecto externo falló. Un `publishing` viejo va
   a Recovery; no se libera por antigüedad.
3. Un scheduler nunca activa, desactiva ni reprograma otro scheduler. Si el
   dueño está caído (por ejemplo `is_enabled=false`), el aviso va al owner,
   que es el único que puede reactivar la tarea en su plataforma.
4. Antes de reactivar el Auto Publisher después de una denegación de
   seguridad, confirmar que la escritura de reserva ya no la hace la tarea
   LLM; si no, se repetirá la desactivación.

## Evidencia (historial de `queue/` hasta `d6b58a8`)

`node scripts/audit-queue-transitions.mjs "" HEAD` sobre 136 commits de
`queue/` encuentra 20 escrituras que la tabla rechaza. Todas son históricas;
el workflow sólo evalúa commits nuevos. Ejemplos:

| Commit | Registro | Violación |
| --- | --- | --- |
| `004f743`, `a684e3c` | Kyiv | `media_claim_owner_overwritten`: dos corridas de media reemplazaron el claim |
| `614c7aa` | UN AI | `publish_unknown -> publishing`: reserva nueva sobre resultado ambiguo |
| `d369786` | Saudi-Houthi | `claim_owner_overwritten`: "reconcile orphan and reserve controlled retry" |
| `dc08b25` | Bangkok | La reserva de publicación reescribió `caption` |
| `0ef11b5` | UN AI | La reserva de publicación reescribió `editorial_category` |
| `8bd8bb8`, `1deae4d`, `fe916f5`, `b6a1208` | Arctic, US-Iran, Ethiopia, Kohli | `ready_to_publish -> published` sin reserva |
| `4ac5f44` | Arctic | `ready_to_publish -> blocked_media`: media reiniciada a mano |
