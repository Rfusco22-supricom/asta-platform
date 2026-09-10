# ASTA — Roadmap Técnico

Ordenado por dependencias reales, no por vistosidad. Cada fase cierra con algo
demostrable; nada se construye sobre cimientos sin verificar.

---

## Fase 0 — Descubrimiento en Odoo (2–3 días) · BLOQUEANTE

Todo lo demás asume cosas sobre Odoo que hoy no están confirmadas. Se resuelve
primero, con un script desechable, no con reuniones.

- [ ] Crear el usuario de servicio `api-middleware@asta` con su API key.
- [ ] Script de reconocimiento (`scripts/odoo-probe.ts`) que imprima:
      `fields_get` de `res.partner`, `product.template` y `account.move`.
- [ ] **Confirmar `x_client_tier`**: ¿selection o many2one? ¿valores exactos?
      ¿cuántos partners lo tienen vacío hoy? (los huecos definen el default).
- [ ] **Confirmar `asta.printer.model`** y `printer_compatibilities_ids`.
      Si no existen: son un módulo de Odoo a desarrollar, y eso cambia el plan.
- [ ] Mapa tier -> `product.pricelist.id`. Verificar que las 3 tarifas existen y
      que un producto de prueba devuelve 3 precios distintos.
- [ ] Contar volumen: partners, productos, facturas/año. Define si hace falta
      Redis desde el día 1 o basta con cache en Postgres.

> **Riesgo #1 del proyecto:** que la data de compatibilidad impresora–tóner esté
> incompleta. Un recomendador con 40 % de cobertura es peor que no tener
> recomendador: le dice al cliente "no tenemos" cuando sí hay producto. Hay que
> medir la cobertura ANTES de construir la UI del kiosco.

---

## Fase 1 — Middleware, cimientos (1 semana)

- [ ] Monorepo (pnpm workspaces): `apps/middleware`, `apps/web`, `apps/mobile`, `packages/shared-types`.
- [ ] `config/env.ts` con validación zod al arranque.
- [ ] Cliente XML-RPC con uid cacheado, timeout, retry y logging estructurado.
- [ ] `GET /health` que verifique Odoo + Postgres y devuelva latencia de cada uno.
- [ ] Prisma: migración inicial del esquema, `prisma migrate dev`.
- [ ] **Test de integración contra una copia de staging de Odoo.** Sin esto,
      cada refactor posterior es a ciegas.

**Entregable:** `curl /health` devuelve verde con Odoo real conectado.

---

## Fase 2 — Identidad y sincronización (1 semana)

- [ ] Job de sync `res.partner` -> `app_users` (incremental por `write_date`,
      no full scan). Cada 15 min + endpoint manual para el SuperAdmin.
- [ ] Alta en Supabase Auth: invitación por email al cliente ya existente en Odoo.
- [ ] `authJwt()`: verifica el JWT de Supabase y carga la identidad.
- [ ] Matriz de roles y permisos en un solo archivo (`permissions.ts`), no
      dispersa en `if`s por los controladores.
- [ ] Reconciliación: reporte de partners en Odoo sin `app_user` y viceversa
      (`sync_status = ORPHANED`).

**Entregable:** un cliente real puede iniciar sesión y ver su nombre y su tier.

---

## Fase 3 — Módulo de Vendedores (1–1,5 semanas) · PRIMER VALOR VISIBLE

Va antes que el kiosco a propósito: es el módulo con menos incógnitas (usa solo
modelos estándar de Odoo) y el que da retroalimentación de usuarios reales más
rápido.

- [ ] `invoicing.service.ts` + `partners.service.ts` (ya escritos).
- [ ] `GET /salesperson/portfolio` y `.../clients/:id/invoicing`.
- [ ] Panel Next.js: login, tabla de cartera ordenable, ficha de cliente con
      histórico de facturación y serie mensual.
- [ ] Perfilado del cliente: notas del vendedor (viven en Postgres, no en Odoo),
      última compra, días sin comprar, top 5 productos.
- [ ] **Pruebas de autorización:** el vendedor A pide un cliente del vendedor B
      y recibe 403. Este test es obligatorio y no negociable.

**Entregable:** los vendedores usan el panel a diario y dejan de pedir reportes.

---

## Fase 4 — API pública y API Keys (1 semana)

- [ ] `apiKey.service.ts` + `authApiKey()` + `requireScope()` (ya escritos).
- [ ] UI en el panel del cliente: crear key, elegir scopes, ver últimos usos,
      revocar. El token en claro se muestra una sola vez, con aviso explícito.
- [ ] Rate limiting por `api_key_id` con `express-rate-limit` + store en Redis.
- [ ] Endpoints v1: `/inventory`, `/pricing`, `/invoices`, `/orders`.
- [ ] Cache de catálogo y precios, con invalidación por webhook desde
      `base.automation` en Odoo.
- [ ] Documentación pública (OpenAPI 3.1 + página con ejemplos en curl y Python).

**Entregable:** un cliente integra su propio sistema sin llamar a soporte.

> Antes de exponer la API: prueba de fuego con dos keys de dos clientes distintos,
> intentando cada una leer los datos de la otra. Debe fallar en todos los casos.

---

## Fase 5 — App móvil y Modo Kiosco (2 semanas)

- [ ] Recomendador: `asta.printer.model` con búsqueda difusa (alias, sin espacios,
      sin guiones — la gente escribe "hl2350", no "HL-L2350DW").
- [ ] `GET /recommender/printers?q=` y `/recommender/compatible?printerId=`.
- [ ] React Native: modo kiosco (pantalla completa, sin barra de navegación,
      `expo-screen-orientation` bloqueado, wake lock).
- [ ] Autologout a los 4 min de inactividad + botón "Terminar" visible siempre.
- [ ] Estado offline: si Odoo no responde, el catálogo cacheado se muestra igual,
      con un aviso de "precios pueden variar". Una tablet en blanco en piso de
      venta es peor que una con datos de hace 10 minutos.
- [ ] Telemetría (`recommendation_events`) desde el primer día.

**Entregable:** tablet operando en tienda; se mide qué buscan los clientes.

---

## Fase 6 — Endurecimiento y operación (continuo)

- [ ] RLS en Supabase para las tablas que toque el cliente Next.js directamente.
- [ ] Rotación de `API_KEY_PEPPER` documentada (con plan de reemisión).
- [ ] Alertas: latencia de Odoo p95, tasa de 401 por key, RPC/request > 5.
- [ ] Particionado y purga a 90 días de `api_request_logs`.
- [ ] Backups y prueba de restauración (probada, no supuesta).
- [ ] Runbook: qué hacer cuando Odoo se cae y el kiosco sigue encendido.

---

## Orden de decisiones que no conviene diferir

| Decisión | Cuándo | Por qué no puede esperar |
|---|---|---|
| Tier como `many2one` a un modelo con su tarifa | Fase 0 | Cambiarlo después obliga a migrar datos en Odoo en producción |
| Criterio de "total facturado" (con o sin notas de crédito) | Fase 3 | Si el panel y el ERP dan números distintos, el vendedor deja de confiar en el panel y el proyecto muere |
| Redis sí o no | Fase 1 | Meterlo después implica reescribir el rate limiter y el cache |
| Versionado de la API pública (`/v1` desde el inicio) | Fase 4 | Una vez que un cliente integra, cambiar la forma de la respuesta es un incidente |

---

## Estimación agregada

| Fase | Duración | Puede paralelizarse |
|---|---|---|
| 0 — Descubrimiento | 2–3 días | No: bloquea todo |
| 1 — Cimientos | 1 sem | No |
| 2 — Identidad | 1 sem | Parcial con Fase 1 |
| 3 — Vendedores | 1–1,5 sem | Front y back en paralelo |
| 4 — API pública | 1 sem | Sí, con Fase 3 |
| 5 — Kiosco | 2 sem | Sí, con Fase 4 |
| 6 — Endurecimiento | continuo | — |

**Camino crítico: ~6–7 semanas** con un backend y un frontend trabajando en
paralelo. Con una sola persona, entre 10 y 12.
