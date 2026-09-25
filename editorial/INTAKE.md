# Intake editorial protegido

Un borrador entra por un PR que añade exactamente un archivo JSON en `editorial/verified/`.

El guard de GitHub valida el contenido propuesto usando el validador de la rama base. No ejecuta scripts ni workflows de la rama del PR. Un cambio a `queue/` durante este tipo de PR falla.

## Requisitos obligatorios

- Dos o más URLs HTTPS verificadas y únicas.
- Un `source_record` por fuente, con los hechos que sustenta.
- `claim_checks` que cite únicamente esas URLs.
- `promotion_eligible: false`.
- `candidate_status` con `requires_editorial_promotion`.

El intake no crea media, claims, publicaciones, secretos ni despliegues. La promoción sigue siendo una acción explícita y revisada en un cambio separado.
