#!/usr/bin/env bash
#
# Crea labels, milestones y el backlog completo del proyecto ASTA en GitHub.
#
#   Uso:  bash scripts/seed-issues.sh owner/repo
#
# Idempotente en labels y milestones. NO en issues: si lo corres dos veces,
# creas los issues duplicados. Corre una sola vez por repo.

set -euo pipefail

REPO="${1:?Uso: bash scripts/seed-issues.sh owner/repo}"

echo "==> Repo destino: $REPO"
gh repo view "$REPO" --json nameWithOwner -q .nameWithOwner >/dev/null

# ─────────────────────────────────────────────────────────────────────────────
# Labels
# ─────────────────────────────────────────────────────────────────────────────
echo "==> Creando labels..."
label() {
  gh label create "$1" --repo "$REPO" --color "$2" --description "$3" --force >/dev/null
  echo "    · $1"
}

label "area:odoo"        "875A7B" "Configuracion o desarrollo dentro del ERP Odoo"
label "area:middleware"  "0E8A16" "Node.js / Express / Prisma"
label "area:web"         "1D76DB" "Panel Next.js"
label "area:mobile"      "5319E7" "App React Native / Kiosco"
label "area:infra"       "5319E7" "Despliegue, observabilidad, base de datos"
label "tipo:decision"    "FBCA04" "Requiere una decision de negocio o arquitectura"
label "tipo:seguridad"   "D93F0B" "Aislamiento de datos, autenticacion, secretos"
label "tipo:test"        "C2E0C6" "Pruebas automatizadas"
label "tipo:docs"        "0075CA" "Documentacion"
label "bloqueante"       "B60205" "Bloquea el avance de otras fases"
label "riesgo"           "E99695" "Riesgo identificado del proyecto"

# ─────────────────────────────────────────────────────────────────────────────
# Milestones
# ─────────────────────────────────────────────────────────────────────────────
echo "==> Creando milestones..."
milestone() {
  gh api "repos/$REPO/milestones" -f title="$1" -f description="$2" --silent 2>/dev/null \
    && echo "    · $1" \
    || echo "    · $1 (ya existia)"
}

milestone "Fase 0 - Descubrimiento en Odoo" "BLOQUEANTE. Confirmar los supuestos sobre el ERP antes de construir nada. 2-3 dias."
milestone "Fase 1 - Cimientos del Middleware" "Monorepo, cliente XML-RPC, Prisma, health check. 1 semana."
milestone "Fase 2 - Identidad y sincronizacion" "Sync res.partner, Supabase Auth, matriz de permisos. 1 semana."
milestone "Fase 3 - Modulo de Vendedores" "Primer valor visible. Panel de cartera y facturacion. 1-1.5 semanas."
milestone "Fase 4 - API publica y API Keys" "Emision de tokens, endpoints v1, rate limiting, docs. 1 semana."
milestone "Fase 5 - App movil y Modo Kiosco" "Recomendador de toner en tablet. 2 semanas."
milestone "Fase 6 - Endurecimiento y operacion" "RLS, alertas, backups, runbooks. Continuo."

# ─────────────────────────────────────────────────────────────────────────────
# Issues
# ─────────────────────────────────────────────────────────────────────────────
COUNT=0
mk() {
  local title="$1" milestone="$2" labels="$3"
  local url
  url=$(gh issue create --repo "$REPO" --title "$title" --milestone "$milestone" --label "$labels" --body-file -)
  COUNT=$((COUNT + 1))
  printf '    [%02d] %s\n         %s\n' "$COUNT" "$title" "$url"
}

echo "==> Creando issues..."

# ══════════════════════ FASE 0 — DESCUBRIMIENTO ══════════════════════════════

mk "Crear usuario de servicio en Odoo con API key dedicada" \
   "Fase 0 - Descubrimiento en Odoo" "area:odoo,tipo:seguridad,bloqueante" <<'BODY'
## Contexto

Todo el middleware habla con Odoo a traves de un unico usuario de servicio. Hoy no
existe. Sin el, ninguna otra tarea puede avanzar.

## Tareas

- [ ] Crear el usuario `api-middleware@asta.mx` en Odoo
- [ ] Generar su API key (Preferencias > Seguridad de la cuenta > Claves de API)
- [ ] Asignar permisos de **lectura** sobre: `res.partner`, `product.template`,
      `product.product`, `product.pricelist`, `account.move`
- [ ] Documentar que modelos necesitaran escritura mas adelante (`sale.order`)
- [ ] Guardar la credencial en el gestor de secretos, nunca en el repo

## Criterio de aceptacion

`ODOO_PASSWORD` en `.env` permite autenticar via XML-RPC y devuelve un `uid` valido.

## Por que importa

**No usar `admin` (uid 1).** Una API key es revocable sin cambiar la contrasena del
usuario, y limita el dano si el middleware se ve comprometido.
BODY

mk "Script de reconocimiento: fields_get de los modelos clave" \
   "Fase 0 - Descubrimiento en Odoo" "area:odoo,bloqueante" <<'BODY'
## Contexto

La arquitectura asume campos que todavia nadie ha verificado contra la instancia
real. Esto se resuelve con un script desechable, no con reuniones.

## Tareas

- [ ] Crear `scripts/odoo-probe.ts`
- [ ] Imprimir `fields_get` de `res.partner`, `product.template`, `account.move`
- [ ] Imprimir `fields_get` de `asta.printer.model` (o el error si no existe)
- [ ] Volcar el resultado a `docs/odoo-schema-snapshot.json` para diffear despues

## Criterio de aceptacion

El JSON existe en el repo y las Issues de esta fase pueden cerrarse citandolo.
BODY

mk "Confirmar x_client_tier: tipo, valores exactos y cobertura" \
   "Fase 0 - Descubrimiento en Odoo" "area:odoo,tipo:decision,bloqueante" <<'BODY'
## Contexto

`x_client_tier` decide que tarifa ve cada cliente. Es el campo del que cuelga todo
el modelo de precios y no sabemos ni su tipo.

## Tareas

- [ ] Determinar si es `selection` o `many2one`
- [ ] Si es `selection`: capturar los valores tecnicos exactos
      (`bronce` vs `Bronce` vs `BRONCE` — importa)
- [ ] Contar cuantos `res.partner` lo tienen vacio: los huecos definen el default
- [ ] Decidir el default para clientes sin tier asignado

## Decision a tomar

**Recomendacion: migrarlo a `many2one` hacia un modelo `asta.client.tier`** que
lleve su `property_product_pricelist` asociado. Asi la relacion tier -> tarifa es un
dato editable por negocio, no un `if` en el codigo que hay que redesplegar.

## Por que no puede esperar

Cambiar el tipo del campo despues obliga a una migracion de datos en Odoo en
produccion.
BODY

mk "Confirmar existencia de asta.printer.model y printer_compatibilities_ids" \
   "Fase 0 - Descubrimiento en Odoo" "area:odoo,bloqueante,riesgo" <<'BODY'
## Contexto

Todo el recomendador del kiosco (Fase 5) depende de estos dos elementos. La
arquitectura los asume existentes; hay que verificarlo.

## Tareas

- [ ] Verificar si `asta.printer.model` existe en la instancia
- [ ] Verificar si `printer_compatibilities_ids` esta en `product.template`
      (y **no** en `product.product`)
- [ ] Si hay variantes de toner (XL vs estandar), confirmar en que nivel vive la
      compatibilidad

## Si NO existen

Deja de ser configuracion y pasa a ser **un modulo de Odoo a desarrollar**. Eso
cambia el plan: hay que abrir un epic aparte y reestimar la Fase 5.

Campos minimos del modelo si hay que crearlo:
`name`, `brand_id`, `aliases`, `active`.
BODY

mk "Mapear tier -> product.pricelist.id y verificar 3 precios distintos" \
   "Fase 0 - Descubrimiento en Odoo" "area:odoo,bloqueante" <<'BODY'
## Contexto

Devolver el precio correcto segun el nivel del cliente es el requisito central de
la API publica. Hay que probar que la mecanica funciona antes de codificarla.

## Tareas

- [ ] Confirmar que existen las 3 `product.pricelist` (Bronce, Plata, Gold)
- [ ] Registrar los IDs de cada una
- [ ] Tomar un producto de prueba y verificar que devuelve **3 precios distintos**
      segun el `context: { pricelist: N }`
- [ ] Confirmar el comportamiento con productos sin regla en alguna tarifa

## Criterio de aceptacion

Un mismo SKU consultado con tres pricelists devuelve tres precios documentados en
el issue.
BODY

mk "Medir volumen de datos: partners, productos y facturas/ano" \
   "Fase 0 - Descubrimiento en Odoo" "area:odoo,area:infra" <<'BODY'
## Contexto

El volumen define decisiones de infraestructura que son caras de revertir.

## Tareas

- [ ] Contar `res.partner` activos (y cuantos son clientes)
- [ ] Contar `product.template` con `sale_ok = true`
- [ ] Contar `account.move` con `move_type = out_invoice` del ultimo ano
- [ ] Medir el cliente con mas facturas (el peor caso del endpoint de facturacion)
- [ ] Medir latencia p50/p95 de un `search_read` tipico contra Odoo

## Decide

Si hace falta Redis desde el dia 1 o basta con cache en Postgres. Ver el issue de
decision sobre Redis en Fase 1.
BODY

mk "RIESGO #1: medir la cobertura real de la data impresora <-> toner" \
   "Fase 0 - Descubrimiento en Odoo" "area:odoo,riesgo,bloqueante" <<'BODY'
## Contexto

**Este es el mayor riesgo del proyecto.**

Un recomendador con 40% de cobertura es *peor* que no tener recomendador: le dice
al cliente "no tenemos" cuando si hay producto en almacen. Y lo dice en piso de
venta, delante del cliente.

## Tareas

- [ ] Contar cuantos `product.template` de toner tienen al menos una compatibilidad
      declarada
- [ ] Calcular el porcentaje sobre el total de toners vendibles
- [ ] Contar cuantos modelos de impresora estan cargados
- [ ] Cruzar con las marcas/modelos que mas se venden: la cobertura de la cola
      larga importa menos que la del top 20

## Criterio de aceptacion

Un numero de cobertura documentado y una decision explicita:

- **> 85%** -> Fase 5 procede como esta planeada
- **60-85%** -> Fase 5 procede, pero con un flujo de respaldo ("no encontramos tu
  modelo, deja tus datos y te contactamos") y un plan de captura de datos
- **< 60%** -> **la Fase 5 se pospone** hasta completar la data. Construir la UI
  primero seria construir sobre arena
BODY

# ══════════════════════ FASE 1 — CIMIENTOS ═══════════════════════════════════

mk "Montar el monorepo con pnpm workspaces" \
   "Fase 1 - Cimientos del Middleware" "area:infra" <<'BODY'
## Tareas

- [ ] `pnpm-workspace.yaml` con `apps/*` y `packages/*`
- [ ] `apps/middleware` (ya esqueletado), `apps/web`, `apps/mobile`
- [ ] `packages/shared-types`: tipos compartidos entre middleware, web y mobile
- [ ] TypeScript base config compartida
- [ ] ESLint + Prettier + `.editorconfig`
- [ ] `.gitignore` que cubra `.env`, `dist/`, `node_modules/`

## Criterio de aceptacion

`pnpm install && pnpm -r typecheck` pasa en limpio desde un clone nuevo.
BODY

mk "Validacion de entorno con zod al arranque" \
   "Fase 1 - Cimientos del Middleware" "area:middleware" <<'BODY'
## Contexto

Ya existe `apps/middleware/src/config/env.ts`. Falta integrarlo y probarlo.

## Tareas

- [ ] Verificar que el proceso muere en el segundo 0 si falta una variable
- [ ] Mensaje de error que diga **cual** variable falta, no un stack trace
- [ ] `.env.example` sincronizado con el schema (ya existe)
- [ ] Test que compruebe que un entorno incompleto no arranca

## Por que importa

Un `undefined` en una credencial de Odoo no debe descubrirse a las 3 a.m. en
produccion, sino al arrancar.
BODY

mk "Cliente XML-RPC de Odoo: uid cacheado, timeout, retry y logging" \
   "Fase 1 - Cimientos del Middleware" "area:middleware" <<'BODY'
## Contexto

Ya existe `apps/middleware/src/odoo/client.ts`. Falta endurecerlo y probarlo contra
Odoo real.

## Tareas

- [ ] Verificar el cacheo del `uid` (se cachea el promise, no el valor: N requests
      concurrentes en arranque en frio comparten un solo login)
- [ ] Verificar el retry ante `AccessDenied` / sesion expirada
- [ ] Anadir metrica: numero de RPC por request HTTP
- [ ] Logging estructurado con pino, incluyendo `model`, `method` y duracion
- [ ] Considerar circuit breaker si Odoo se degrada

## Criterio de aceptacion

Un `executeKw` contra Odoo real devuelve datos, y matar la sesion en Odoo no
produce un 500 sino un reintento transparente.
BODY

mk "GET /health con latencia de Odoo y Postgres" \
   "Fase 1 - Cimientos del Middleware" "area:middleware,area:infra" <<'BODY'
## Tareas

- [ ] `GET /health` que verifique conectividad con Odoo (`version`) y Postgres
- [ ] Devolver latencia de cada dependencia en ms
- [ ] `200` si todo va, `503` si alguna dependencia esta caida
- [ ] Endpoint `/health/ready` separado para el orquestador

## Criterio de aceptacion

`curl /health` devuelve verde con Odoo real conectado. **Este es el entregable que
cierra la Fase 1.**
BODY

mk "Migracion inicial de Prisma" \
   "Fase 1 - Cimientos del Middleware" "area:infra" <<'BODY'
## Contexto

El schema ya esta escrito en `prisma/schema.prisma`.

## Tareas

- [ ] Habilitar las extensiones `pgcrypto` y `citext` en Supabase
- [ ] `prisma migrate dev --name init`
- [ ] Verificar el indice unico sobre `api_keys.prefix` (es el hot path de la API)
- [ ] Seed minimo: un SuperAdmin de desarrollo
- [ ] Documentar como correr migraciones contra produccion (`DIRECT_URL`, no el pooler)
BODY

mk "Tests de integracion contra una copia de staging de Odoo" \
   "Fase 1 - Cimientos del Middleware" "area:middleware,tipo:test" <<'BODY'
## Contexto

Sin esto, cada refactor posterior es a ciegas. Los mocks de XML-RPC no capturan el
comportamiento real de Odoo (el `false` en lugar de `null`, los `many2one` como
tuplas, los grupos vacios en `read_group`).

## Tareas

- [ ] Conseguir o crear una instancia de staging de Odoo con data representativa
- [ ] Configurar vitest con un entorno `.env.test`
- [ ] Tests del cliente XML-RPC contra Odoo real
- [ ] Marcarlos como suite separada (`test:integration`) para no bloquear el CI rapido

## Por que importa

Es la red de seguridad de todo lo que viene despues. Es tentador saltarselo y es el
error mas caro de esta fase.
BODY

mk "DECISION: Redis desde el dia 1, o cache en Postgres" \
   "Fase 1 - Cimientos del Middleware" "tipo:decision,area:infra" <<'BODY'
## La decision

El rate limiter y el cache de catalogo necesitan un store. Dos opciones:

| | Redis | Postgres (`odoo_entity_cache`) |
|---|---|---|
| Latencia | sub-ms | ~5-15 ms |
| Infra extra | si | no |
| Rate limit distribuido | nativo | requiere transacciones |
| Coste | ~10-25 USD/mes | 0 |

## Por que no puede esperar

Meterlo despues implica reescribir el rate limiter y la capa de cache. La tabla
`odoo_entity_cache` ya esta en el schema para la opcion B.

## Insumo

Depende del volumen medido en Fase 0. Con menos de ~50 req/s, Postgres alcanza.
BODY

# ══════════════════════ FASE 2 — IDENTIDAD ═══════════════════════════════════

mk "Job de sincronizacion res.partner -> app_users" \
   "Fase 2 - Identidad y sincronizacion" "area:middleware" <<'BODY'
## Tareas

- [ ] Sync **incremental** por `write_date`, no full scan
- [ ] Programado cada 15 min + endpoint manual para el SuperAdmin
- [ ] Mapear `x_client_tier` -> `role` y -> `odooPricelistId`
- [ ] Mapear `user_id` -> `assignedSalespersonId`
- [ ] Guardar `commercial_partner_id` (necesario para agregar facturacion)
- [ ] Registrar `syncStatus` y `syncError` por fila, sin abortar el lote completo

## Criterio de aceptacion

Un cambio de tier en Odoo se refleja en `app_users` en menos de 15 minutos, y un
partner corrupto no tumba la sincronizacion de los demas.
BODY

mk "Alta de clientes en Supabase Auth por invitacion" \
   "Fase 2 - Identidad y sincronizacion" "area:middleware,area:web" <<'BODY'
## Contexto

Los clientes ya existen en Odoo. El alta no es un registro abierto: es una
invitacion a alguien que ya es cliente.

## Tareas

- [ ] Flujo de invitacion por email desde el panel del SuperAdmin
- [ ] Vincular `auth.users.id` -> `app_users.authUserId` al aceptar
- [ ] Manejar el caso de email duplicado o ya registrado
- [ ] Reenvio de invitacion y expiracion del enlace
- [ ] **No** permitir auto-registro publico
BODY

mk "authJwt(): verificacion del JWT de Supabase" \
   "Fase 2 - Identidad y sincronizacion" "area:middleware,tipo:seguridad" <<'BODY'
## Contexto

Es el gemelo de `authApiKey()`, que ya existe. Ambos deben producir **el mismo**
objeto `req.identity`, para que los controladores no tengan que saber como entro
el request.

## Tareas

- [ ] Verificar firma del JWT con `SUPABASE_JWT_SECRET` (libreria `jose`)
- [ ] Cargar `AppUser` y poblar `req.identity` con la misma forma que `VerifiedIdentity`
- [ ] Rechazar tokens expirados o de usuarios inactivos
- [ ] Cachear el lookup de `AppUser` unos segundos para no golpear la BD por request

## Criterio de aceptacion

Un mismo controlador funciona igual invocado con JWT o con API key.
BODY

mk "Matriz de roles y permisos centralizada" \
   "Fase 2 - Identidad y sincronizacion" "area:middleware,tipo:seguridad" <<'BODY'
## Contexto

Los permisos dispersos en `if`s por los controladores son la via mas corta a un
endpoint que se olvida de una comprobacion.

## Tareas

- [ ] Un solo `permissions.ts` con la matriz rol x accion
- [ ] Helper `isClientRole(role)` — BRONCE/PLATA/GOLD son tiers del mismo rol
      funcional; no enumerarlos a mano en cada comprobacion
- [ ] `can(identity, action, resource)` como unica puerta de autorizacion
- [ ] Tests de la matriz completa: cada rol contra cada accion

## Nota de diseno

Ver la nota en el enum `AppRole` de `prisma/schema.prisma`.
BODY

mk "Reporte de reconciliacion Odoo <-> Middleware" \
   "Fase 2 - Identidad y sincronizacion" "area:middleware,area:web" <<'BODY'
## Tareas

- [ ] Detectar `app_users` cuyo `res.partner` ya no existe -> `syncStatus = ORPHANED`
- [ ] Detectar partners en Odoo sin `app_user` correspondiente
- [ ] Detectar desalineaciones entre `x_client_tier` (Odoo) y `role` (middleware)
- [ ] Vista en el panel del SuperAdmin con las tres listas
- [ ] Accion de resincronizacion individual

## Por que importa

Los dos sistemas van a divergir. La pregunta no es si, sino cuando te enteras.
BODY

# ══════════════════════ FASE 3 — VENDEDORES ══════════════════════════════════

mk "Revisar y probar invoicing.service.ts y partners.service.ts" \
   "Fase 3 - Modulo de Vendedores" "area:middleware,tipo:test" <<'BODY'
## Contexto

Ambos servicios ya estan escritos. Falta validarlos contra Odoo real.

## Tareas

- [ ] Verificar que `child_of` incluye correctamente las sucursales hijas
- [ ] Verificar que `amount_total_signed` sale en moneda de la compania
- [ ] Verificar que `read_group` con `lazy: false` agrupa como se espera
- [ ] Comparar el total calculado contra el reporte nativo de Odoo para 5 clientes
- [ ] Probar el caso de cliente sin ninguna factura (no debe romper)
- [ ] Probar el caso multi-moneda si aplica

## Criterio de aceptacion

Los numeros del middleware coinciden con los de Odoo al centavo para los 5 clientes
de prueba.
BODY

mk "Endpoints /salesperson/portfolio y /clients/:id/invoicing" \
   "Fase 3 - Modulo de Vendedores" "area:middleware" <<'BODY'
## Contexto

Los controladores ya estan escritos en `apps/middleware/src/controllers/salesperson.controller.ts`.

## Tareas

- [ ] Montar el router con `authJwt()` aplicado
- [ ] Verificar que `getInvoicingTotalsByPartner` resuelve la cartera completa en
      **2 RPC**, no 2 por cliente (el N+1 contra el ERP)
- [ ] Paginacion de la cartera si supera ~200 clientes
- [ ] Manejo de errores: `ForbiddenPartnerAccess` -> 403, `PartnerNotFound` -> 404
- [ ] Medir tiempo de respuesta con el vendedor de mayor cartera
BODY

mk "Panel Next.js: login y tabla de cartera" \
   "Fase 3 - Modulo de Vendedores" "area:web" <<'BODY'
## Tareas

- [ ] Next.js 15 con App Router
- [ ] Login contra Supabase Auth, sesion en cookie httpOnly
- [ ] Middleware de proteccion de rutas por rol
- [ ] Tabla de cartera: nombre, tier, total facturado, por cobrar, num. facturas
- [ ] Ordenable por columna, con busqueda
- [ ] Estados de carga y de error (Odoo caido no debe dar pantalla en blanco)
- [ ] Formato de moneda localizado

## Criterio de aceptacion

Un vendedor real inicia sesion y ve su cartera con numeros correctos.
BODY

mk "Ficha de cliente con historico de facturacion y serie mensual" \
   "Fase 3 - Modulo de Vendedores" "area:web" <<'BODY'
## Tareas

- [ ] Vista de detalle por cliente
- [ ] Grafica de la serie mensual (`incluirSerieMensual=true`)
- [ ] Desglose por estado de pago (pagado / por cobrar / parcial)
- [ ] Ultima factura con folio y fecha
- [ ] Filtro por rango de fechas
- [ ] Enlace directo al cliente en Odoo (para el vendedor que quiere el detalle)
BODY

mk "Perfilado de cliente: notas, recencia y top de productos" \
   "Fase 3 - Modulo de Vendedores" "area:web,area:middleware" <<'BODY'
## Contexto

El requisito de "perfilar a sus clientes". Las notas del vendedor viven en Postgres,
**no** en Odoo: son datos operativos del panel, no del ERP.

## Tareas

- [ ] Modelo `ClientNote` en Prisma (autor, texto, fecha)
- [ ] Dias sin comprar (calculado desde `ultimaFactura`)
- [ ] Top 5 productos por cliente (`read_group` sobre `account.move.line`)
- [ ] Alerta visual para clientes inactivos (> N dias sin comprar)
- [ ] UI de notas en la ficha del cliente
BODY

mk "TEST OBLIGATORIO: aislamiento entre carteras de vendedores" \
   "Fase 3 - Modulo de Vendedores" "tipo:seguridad,tipo:test,bloqueante" <<'BODY'
## Contexto

El vendedor A pide un cliente del vendedor B y debe recibir 403. Este test **no es
negociable** y bloquea el cierre de la Fase 3.

## Tareas

- [ ] Test: vendedor A -> cliente de B -> 403 `PARTNER_NOT_IN_PORTFOLIO`
- [ ] Test: vendedor A -> cliente inexistente -> 404
- [ ] Test: vendedor A -> **sucursal hija** de un cliente de B -> 403
      (el caso que se escapa: la comprobacion debe subir por `commercial_partner_id`)
- [ ] Test: SUPERADMIN -> cualquier cliente -> 200
- [ ] Test: rol cliente (BRONCE/PLATA/GOLD) -> endpoint de vendedor -> 403
- [ ] Verificar que cada intento denegado queda en `audit_logs`

## Referencia

`assertSalespersonOwnsPartner()` en `apps/middleware/src/services/partners.service.ts`.
BODY

mk "DECISION: criterio de 'total facturado' con o sin notas de credito" \
   "Fase 3 - Modulo de Vendedores" "tipo:decision,bloqueante" <<'BODY'
## La decision

`getPartnerInvoicingSummary` acepta `incluirNotasDeCredito`, hoy en `false` por
defecto — que es la definicion literal de la especificacion (`move_type = 'out_invoice'`).

Pero con clientes que devuelven mercancia, el neto **real** es con `true`.

## Tareas

- [ ] Definir el criterio con el area comercial / finanzas
- [ ] Aplicar **un solo** criterio en todo el panel
- [ ] Documentarlo en la UI ("Total facturado, neto de devoluciones")

## Por que no puede esperar

Si el panel y Odoo dan numeros distintos, el vendedor deja de confiar en el panel y
el proyecto muere ahi. No importa cual de los dos criterios elijan; importa que sea
uno solo y que este escrito.
BODY

# ══════════════════════ FASE 4 — API PUBLICA ═════════════════════════════════

mk "Revisar y probar apiKey.service.ts, authApiKey y requireScope" \
   "Fase 4 - API publica y API Keys" "area:middleware,tipo:seguridad,tipo:test" <<'BODY'
## Contexto

Ya estan escritos. Falta validarlos.

## Tareas

- [ ] Test: emitir key -> verificarla -> OK
- [ ] Test: key revocada -> 401
- [ ] Test: key expirada -> 401
- [ ] Test: usuario inactivo -> 401
- [ ] Test: scope faltante -> 403 `INSUFFICIENT_SCOPE`
- [ ] Test: token malformado -> 401 (sin filtrar la causa al cliente)
- [ ] Verificar que el hash usa `timingSafeEqual` y que el HMAC se calcula
      **aunque la fila no exista** (para no filtrar por timing si el prefijo es valido)
- [ ] Benchmark: la verificacion debe estar por debajo de 5 ms
BODY

mk "UI del panel del cliente: crear, listar y revocar API keys" \
   "Fase 4 - API publica y API Keys" "area:web,tipo:seguridad" <<'BODY'
## Tareas

- [ ] Vista "Mis API Keys" en el panel del cliente
- [ ] Crear key: nombre, seleccion explicita de scopes, expiracion opcional
- [ ] **El token en claro se muestra UNA sola vez**, con aviso explicito y boton de copiar
- [ ] Listado: nombre, prefijo, ultimos 4, scopes, ultimo uso, fecha de creacion
- [ ] Revocar con confirmacion
- [ ] Ver ultimos usos (desde `api_request_logs`)

## Detalle que importa

Ninguna key debe poder crearse con "todos los scopes" por defecto. Se piden
explicitamente, uno por uno.
BODY

mk "Rate limiting por api_key_id" \
   "Fase 4 - API publica y API Keys" "area:middleware,area:infra" <<'BODY'
## Contexto

Rate limit **por key**, no por IP: varios clientes pueden salir por la misma IP
corporativa, y un solo cliente puede llamar desde varias.

## Tareas

- [ ] `express-rate-limit` con store segun la decision de Redis vs Postgres
- [ ] Limite tomado de `api_keys.rateLimitPerMinute` (configurable por key)
- [ ] Headers `RateLimit-*` estandar en la respuesta
- [ ] `429` con `Retry-After`
- [ ] Alerta cuando una key satura su limite de forma sostenida
BODY

mk "Endpoint publico GET /api/v1/public/inventory" \
   "Fase 4 - API publica y API Keys" "area:middleware" <<'BODY'
## Tareas

- [ ] `search_read` sobre `product.product` con `sale_ok = true`
- [ ] Filtros: `sku`, `q` (nombre), `printerId`, paginacion
- [ ] Devolver `qty_available` — decidir si es stock real o disponible-para-venta
- [ ] **Nunca** exponer `standard_price` (costo) ni `list_price` crudo
- [ ] Scope requerido: `INVENTORY_READ`
- [ ] Cache 60 s

## Seguridad

El scoping ya lo aplica `scopeToOwnPartner()`, pero este endpoint es de catalogo
global: revisar que no filtre productos restringidos a otros clientes.
BODY

mk "Endpoint publico GET /api/v1/public/pricing" \
   "Fase 4 - API publica y API Keys" "area:middleware,tipo:seguridad" <<'BODY'
## Contexto

El requisito central: cada cliente ve **su** precio, el de la tarifa de su nivel.

## Tareas

- [ ] Resolver la pricelist desde `identity.odooPricelistId`, **nunca** desde el request
- [ ] Aplicar `context: { pricelist: N }` en la consulta a Odoo
- [ ] Consulta en lote para multiples SKUs (no uno por RPC)
- [ ] Scope requerido: `PRICING_READ`
- [ ] Cache 5 min, con la pricelist como parte de la clave de cache

## Test critico

Dos clientes de tiers distintos consultando el mismo SKU deben recibir precios
distintos, y ninguno debe poder forzar la tarifa del otro.
BODY

mk "Endpoint publico GET /api/v1/public/invoices" \
   "Fase 4 - API publica y API Keys" "area:middleware,tipo:seguridad" <<'BODY'
## Tareas

- [ ] Reutilizar `invoicing.service.ts` con el `partnerId` **del token**
- [ ] Listado paginado + detalle por factura
- [ ] Filtros por rango de fechas y estado de pago
- [ ] Enlace de descarga del PDF (via `ir.attachment`), con URL firmada y temporal
- [ ] Scope requerido: `INVOICES_READ`

## Seguridad

Es el endpoint con mayor impacto si el scoping falla. El `partner_id` sale de
`identity`, jamas del query string.
BODY

mk "Endpoints de pedidos: GET y POST /api/v1/public/orders" \
   "Fase 4 - API publica y API Keys" "area:middleware" <<'BODY'
## Tareas

- [ ] `GET /orders`: listar `sale.order` del cliente (scope `ORDERS_READ`)
- [ ] `POST /orders`: crear `sale.order` en estado **draft** (scope `ORDERS_WRITE`)
- [ ] Validar disponibilidad y precios en el momento de crear
- [ ] Idempotencia por `Idempotency-Key`: un reintento de red no debe duplicar pedidos
- [ ] El pedido nace en draft y requiere confirmacion interna — la API no confirma ventas

## Nota

Es el unico endpoint que escribe en Odoo. Revisar los permisos del usuario de
servicio.
BODY

mk "Cache de catalogo y precios con invalidacion por webhook" \
   "Fase 4 - API publica y API Keys" "area:middleware,area:odoo" <<'BODY'
## Contexto

Sin cache, la API publica convierte a Odoo en el cuello de botella de todo el
sistema.

## Tareas

- [ ] Implementar la capa de cache sobre `odoo_entity_cache` (o Redis)
- [ ] TTL: catalogo 15 min, precios 5 min, stock 60 s
- [ ] `base.automation` en Odoo que dispare un webhook al middleware al cambiar
      precio, stock o tier
- [ ] Endpoint `POST /internal/cache/invalidate` autenticado por secreto compartido
- [ ] Metrica de hit rate en `api_request_logs.cacheHit`
BODY

mk "Documentacion publica de la API: OpenAPI 3.1 y ejemplos" \
   "Fase 4 - API publica y API Keys" "tipo:docs" <<'BODY'
## Tareas

- [ ] Spec OpenAPI 3.1 generada desde los schemas de zod
- [ ] Pagina de documentacion navegable
- [ ] Guia de autenticacion: como generar la key, como enviarla
- [ ] Ejemplos ejecutables en `curl` y Python para cada endpoint
- [ ] Tabla de codigos de error
- [ ] Politica de rate limits y de versionado

## Criterio de aceptacion

**Un cliente integra su sistema sin llamar a soporte.** Ese es el entregable real
de la Fase 4.
BODY

mk "GATE DE SEGURIDAD: prueba de aislamiento entre dos clientes" \
   "Fase 4 - API publica y API Keys" "tipo:seguridad,tipo:test,bloqueante" <<'BODY'
## Contexto

Antes de exponer la API publica: prueba de fuego con dos keys de dos clientes
distintos, cada una intentando leer los datos de la otra.

**Debe fallar en todos los casos. Este issue bloquea el lanzamiento de la Fase 4.**

## Tareas

- [ ] Key de cliente A pidiendo `?partner_id=<B>` -> devuelve datos de A, no de B
- [ ] Key de A pidiendo la factura de B por ID directo -> 404 o 403, nunca 200
- [ ] Key de A pidiendo el pedido de B por ID directo -> 404 o 403
- [ ] Key de tier BRONCE forzando `pricelist` de GOLD -> devuelve precio BRONCE
- [ ] Key de A creando un pedido a nombre de B -> rechazado
- [ ] Verificar que cada intento queda registrado como acceso cruzado en los logs

## Referencia

`scopeToOwnPartner()` en `apps/middleware/src/middleware/apiKeyAuth.ts`.
BODY

mk "DECISION: politica de versionado de la API publica" \
   "Fase 4 - API publica y API Keys" "tipo:decision,tipo:docs" <<'BODY'
## La decision

`/api/v1` esta desde el inicio, pero falta la politica escrita:

- [ ] Que constituye un cambio incompatible (breaking)
- [ ] Cuanto tiempo se mantiene una version anterior tras publicar la siguiente
- [ ] Como se notifica a los clientes integrados
- [ ] Politica de campos aditivos (anadir un campo no es breaking; quitarlo si)

## Por que no puede esperar

Una vez que un cliente integra, cambiar la forma de la respuesta es un incidente
en el sistema de otra empresa. La politica hay que tenerla **antes** del primer
cliente integrado, no despues.
BODY

# ══════════════════════ FASE 5 — KIOSCO ══════════════════════════════════════

mk "Busqueda difusa de modelos de impresora" \
   "Fase 5 - App movil y Modo Kiosco" "area:middleware,area:odoo" <<'BODY'
## Contexto

La gente escribe "hl2350", no "HL-L2350DW". Si la busqueda es exacta, el
recomendador no sirve.

## Tareas

- [ ] Campo `aliases` en `asta.printer.model`
- [ ] Normalizacion: minusculas, sin espacios, sin guiones, sin acentos
- [ ] Busqueda `ilike` sobre nombre + aliases normalizados
- [ ] Considerar trigram (`pg_trgm`) en el espejo local si Odoo se queda corto
- [ ] Sugerencias "quisiste decir" cuando no hay match exacto
- [ ] Poblar aliases a partir de `recommendation_events` con 0 resultados

## Criterio de aceptacion

10 variantes tipeadas a mano del mismo modelo encuentran la impresora correcta.
BODY

mk "Endpoints del recomendador" \
   "Fase 5 - App movil y Modo Kiosco" "area:middleware" <<'BODY'
## Tareas

- [ ] `GET /recommender/printers?q=` — busqueda difusa
- [ ] `GET /recommender/compatible?printerId=` — `search_read` sobre
      `product.template` con `printer_compatibilities_ids in [id]`
- [ ] Devolver: rendimiento, color, tipo (original/compatible), `qty_available`
- [ ] Precio segun el tier de la sesion, o precio publico si es anonimo
- [ ] Ordenar: en stock primero, luego por relevancia
- [ ] Scope `RECOMMENDER_READ` para el acceso via API
BODY

mk "React Native: modo kiosco en tablet" \
   "Fase 5 - App movil y Modo Kiosco" "area:mobile" <<'BODY'
## Tareas

- [ ] App Expo / React Native
- [ ] Pantalla completa sin barra de navegacion
- [ ] Orientacion bloqueada (`expo-screen-orientation`)
- [ ] Wake lock: la tablet no se apaga durante la jornada
- [ ] Registro del dispositivo con `device_token` (rotado a diario)
- [ ] Pantalla de atraccion cuando esta inactiva
- [ ] UI de tipografia grande: se usa de pie, a distancia de brazo
BODY

mk "Autologout de sesion de kiosco a los 4 minutos" \
   "Fase 5 - App movil y Modo Kiosco" "area:mobile,tipo:seguridad" <<'BODY'
## Contexto

Una tablet en piso de venta es un dispositivo **compartido**. La sesion de un
cliente no puede sobrevivir al siguiente.

## Tareas

- [ ] TTL de 4 min de inactividad -> logout automatico
- [ ] Aviso visual a los 30 s de expirar, con opcion de continuar
- [ ] Boton "Terminar" siempre visible
- [ ] Limpieza total del estado local al cerrar (busquedas, carrito, precios)
- [ ] Job que cierra `kiosk_sessions` vencidas del lado del servidor

## Por que importa

Si el cliente B ve los precios de tier GOLD del cliente A que se fue sin cerrar
sesion, es una fuga de datos comercialmente sensible.
BODY

mk "Modo offline del kiosco con catalogo cacheado" \
   "Fase 5 - App movil y Modo Kiosco" "area:mobile" <<'BODY'
## Contexto

Una tablet en blanco en piso de venta es peor que una con datos de hace 10 minutos.

## Tareas

- [ ] Cache local del catalogo y de las compatibilidades
- [ ] Si Odoo no responde: mostrar el cache con aviso visible
      ("precios y existencias pueden variar")
- [ ] Deshabilitar acciones que requieran datos en vivo
- [ ] Reintento en segundo plano y reconciliacion al recuperar conexion
- [ ] Indicador de estado de conexion siempre visible para el personal
BODY

mk "Telemetria del recomendador desde el dia 1" \
   "Fase 5 - App movil y Modo Kiosco" "area:mobile,area:middleware" <<'BODY'
## Contexto

`recommendation_events` es el activo de datos mas valioso del kiosco: dice que
impresoras tiene el mercado y que toner deberiamos tener en stock.

## Tareas

- [ ] Registrar cada busqueda con el texto **crudo**, sin normalizar (los typos
      ensenan que alias faltan)
- [ ] Registrar el modelo elegido, resultados devueltos y producto clickeado
- [ ] Marcar `wasOutOfStock`: quiebre de venta medible
- [ ] Dashboard en el panel del SuperAdmin: top busquedas sin resultado, top
      impresoras, quiebres de stock

## Por que desde el dia 1

Esta data no se puede reconstruir despues. Cada dia sin instrumentar es un dia
de informacion perdida.
BODY

# ══════════════════════ FASE 6 — ENDURECIMIENTO ══════════════════════════════

mk "Row Level Security en Supabase" \
   "Fase 6 - Endurecimiento y operacion" "area:infra,tipo:seguridad" <<'BODY'
## Tareas

- [ ] RLS habilitado en todas las tablas que toque el cliente Next.js directamente
- [ ] Politicas por `auth.uid()` para `app_users`, `api_keys`
- [ ] Verificar que la `service_role_key` solo se usa desde el middleware, nunca
      desde el navegador
- [ ] Test: un JWT de cliente no puede leer filas de otro via PostgREST

## Nota

RLS es la segunda linea de defensa. La primera sigue siendo el scoping del
middleware.
BODY

mk "Documentar la rotacion de API_KEY_PEPPER" \
   "Fase 6 - Endurecimiento y operacion" "tipo:docs,tipo:seguridad" <<'BODY'
## Contexto

Rotar el pepper **invalida todas las API keys emitidas**. Es una operacion con
impacto en clientes: necesita procedimiento escrito antes de necesitarla.

## Tareas

- [ ] Runbook de rotacion paso a paso
- [ ] Estrategia de doble pepper (verificar contra el viejo y el nuevo durante la
      ventana de transicion)
- [ ] Plantilla de aviso a clientes con plazo de reemision
- [ ] Definir el disparador: solo ante sospecha de compromiso, o rotacion periodica
BODY

mk "Alertas de operacion" \
   "Fase 6 - Endurecimiento y operacion" "area:infra" <<'BODY'
## Tareas

- [ ] Latencia p95 de Odoo por encima del umbral
- [ ] Tasa de 401 por key (posible key filtrada o integracion rota del cliente)
- [ ] `odooCalls` por request > 5 (deteccion de N+1 contra el ERP)
- [ ] Tasa de error 5xx
- [ ] Fallo del job de sincronizacion de partners
- [ ] Kiosco sin reportar `lastSeenAt` en horario laboral

## Criterio de aceptacion

Las alertas llegan a un canal que alguien lee, con un runbook enlazado en cada una.
BODY

mk "Particionado y purga de api_request_logs" \
   "Fase 6 - Endurecimiento y operacion" "area:infra" <<'BODY'
## Contexto

Tabla de alto volumen. Sin plan de retencion, crece hasta ser un problema de coste
y de rendimiento.

## Tareas

- [ ] `PARTITION BY RANGE (created_at)` mensual
- [ ] Job de creacion automatica de la particion del mes siguiente
- [ ] Purga a los 90 dias (drop de particion, no `DELETE`)
- [ ] Antes de purgar: agregados historicos para las metricas de uso por cliente
BODY

mk "Backups y prueba de restauracion" \
   "Fase 6 - Endurecimiento y operacion" "area:infra" <<'BODY'
## Contexto

Un backup no probado no es un backup. Es una suposicion.

## Tareas

- [ ] Verificar la politica de backups de Supabase (frecuencia y retencion)
- [ ] **Ejecutar una restauracion real** a un entorno de prueba
- [ ] Cronometrar el RTO y documentarlo
- [ ] Definir el RPO aceptable con el negocio
- [ ] Backup de la configuracion de Odoo relevante (tarifas, tiers, compatibilidades)
BODY

mk "Runbook: Odoo caido con el kiosco encendido" \
   "Fase 6 - Endurecimiento y operacion" "tipo:docs,area:infra" <<'BODY'
## Contexto

Va a pasar. La pregunta es si el personal de tienda sabe que hacer cuando pase.

## Tareas

- [ ] Documentar el comportamiento esperado del sistema (modo offline, cache)
- [ ] Que ve el personal de tienda y que le dice al cliente
- [ ] A quien se escala y por que canal
- [ ] Como se verifica que el servicio volvio
- [ ] Runbooks equivalentes para: Supabase caido, middleware caido, key filtrada
BODY

echo ""
echo "==> Listo. $COUNT issues creados en $REPO"
echo "    Milestones: gh milestone list --repo $REPO 2>/dev/null || gh api repos/$REPO/milestones -q '.[].title'"
