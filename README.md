# ASTA — Plataforma

Panel web (Next.js), app móvil de kiosco (React Native) y middleware Node.js
sobre un ERP **Odoo 17**.

**Odoo es el sistema de registro. El middleware es el único que habla con Odoo.**
Ni el panel ni la app tocan el ERP directamente.

---

## Arranque

```bash
git clone https://github.com/Rfusco22-supricom/asta-platform.git
cd asta-platform
pnpm install          # el postinstall genera el cliente de Prisma
cp .env.example .env  # y rellenar (ver abajo)
pnpm typecheck        # debe salir en 0
```

Requiere **Node 20.11+**, **pnpm 11** y **MySQL 8.0.13+**.
MariaDB no sirve tal cual (no soporta `DEFAULT (UUID())` igual).

`pnpm install` funciona sin `.env`. Lo que necesita credenciales es correr cosas.

### Variables mínimas

| Para qué | Variables | De dónde salen |
|---|---|---|
| Leer Odoo | `ODOO_URL`, `ODOO_DB`, `ODOO_USERNAME`, `ODOO_PASSWORD` | **Pídeselas a Rfusco**, no están en el repo |
| Base de datos | `DATABASE_URL` | Tu MySQL local |
| API keys | `API_KEY_PEPPER` | `openssl rand -base64 48` |
| Sesiones | `JWT_SECRET` | `openssl rand -base64 48` |

### Base de datos

```bash
mysql -u root -p -e "CREATE DATABASE asta CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;"
mysql -u root -p asta < db/mysql/001_schema.sql
mysql -u root -p asta < db/mysql/002_seed.sql
```

> El DDL **todavía no se ha ejecutado contra un MySQL real** — solo validación
> estática y comparación contra lo que genera Prisma. Si eres el primero en
> aplicarlo y algo falla, avisa en el issue #12.

---

## Comandos

| Comando | Qué hace |
|---|---|
| `pnpm typecheck` | scripts + shared-types + middleware |
| `pnpm probe` | Reconocimiento de la instancia de Odoo (solo lectura) |
| `pnpm verify:invoicing` | Contrasta los totales del servicio contra Odoo real |
| `pnpm prisma:generate` | Regenera el cliente tras tocar el schema |

---

## Estructura

```
apps/middleware/     Node.js + Express + TS — lo único que habla con Odoo
apps/web/            Next.js (pendiente)
apps/mobile/         React Native (pendiente)
packages/shared-types/   Contrato de la API — COMPARTIDO, ver reglas abajo
prisma/schema.prisma MySQL, 15 modelos
db/mysql/            El mismo esquema como SQL, con las decisiones comentadas
scripts/             Herramientas: probe, verificación, gestión de issues
docs/                Arquitectura, roadmap, reparto y hallazgos
```

---

## Qué leer, en este orden

1. **[docs/04-HALLAZGOS-FASE-0.md](docs/04-HALLAZGOS-FASE-0.md)** — empieza aquí.
   Tres supuestos de la arquitectura resultaron falsos contra la instancia real.
2. [docs/01-ARQUITECTURA.md](docs/01-ARQUITECTURA.md) — diagrama y flujos
3. [docs/03-REPARTO.md](docs/03-REPARTO.md) — quién hace qué y las dependencias
4. [docs/02-ROADMAP.md](docs/02-ROADMAP.md) — las fases
5. [db/mysql/README.md](db/mysql/README.md) — decisiones del esquema

---

## Reparto

| | Track A — `Rfusco22-supricom` | Track B — `LinoGouveia` |
|---|---|---|
| Dominio | Interno: datos, identidad, vendedores | Externo: API pública, kiosco |
| Issues | 30 | 24 |

```bash
gh issue list --repo Rfusco22-supricom/asta-platform --assignee "@me"
```

### La única superficie compartida

`packages/shared-types` es el contrato de la API y tiene regla propia:

1. Se define en conjunto, no unilateralmente
2. Cambiarlo es un PR con revisión del otro. **Siempre**
3. Añadir un campo opcional no rompe a nadie. Quitar o renombrar uno sí: se
   avisa **antes** de abrir el PR

Fuera de ahí, cada uno manda en sus carpetas. `prisma/schema.prisma` lo migra
Track A para que no haya dos personas generando migraciones en paralelo.

---

## Estado

**Hecho y verificado contra producción:**

- Cliente XML-RPC de Odoo, con uid cacheado y reintento
- Servicios de facturación y cartera — los totales **coinciden al centavo** con
  Odoo en los 5 clientes de mayor volumen
- Contrato `shared-types`
- Esquema MySQL (15 tablas) y Prisma alineados, verificado con `migrate diff`

**Bloqueos conocidos:**

| Qué | Dónde |
|---|---|
| El modelo Bronce/Plata/Gold **no existe** en Odoo | [#3](https://github.com/Rfusco22-supricom/asta-platform/issues/3) |
| Los 2942 clientes usan **la misma tarifa**: precios por nivel al 0% | [#5](https://github.com/Rfusco22-supricom/asta-platform/issues/5) |
| `asta.printer.model` no existe → **Fase 5 pospuesta** | [#4](https://github.com/Rfusco22-supricom/asta-platform/issues/4), [#7](https://github.com/Rfusco22-supricom/asta-platform/issues/7) |
| **61,8% de los clientes están duplicados** en Odoo | [#50](https://github.com/Rfusco22-supricom/asta-platform/issues/50) |

> **Lino:** tu track incluía el kiosco (Fase 5), que está pospuesto hasta que
> exista el modelo de impresoras en Odoo. Lo que sí puedes atacar hoy es la
> **Fase 4 — API pública** (#27 a #37), que solo depende de Fase 1 y 2.
> Ojo con #31 (`/pricing`): devolverá el mismo precio a todos hasta que se
> resuelva #5. No es un bug tuyo.

---

## Seguridad

Al salir de Supabase desapareció el RLS, que era la segunda línea de defensa.
**El aislamiento entre clientes depende ahora solo del scoping del middleware.**

Eso convierte estos dos issues en críticos, y **ninguno se cierra sin la revisión
del otro track**:

- [#25](https://github.com/Rfusco22-supricom/asta-platform/issues/25) — aislamiento entre carteras de vendedores (A, revisa B)
- [#36](https://github.com/Rfusco22-supricom/asta-platform/issues/36) — aislamiento entre clientes de la API (B, revisa A)

Reglas que no se negocian:

- El `partner_id` **nunca** viene del body o la query. Se deriva del token
- Nunca se devuelve `standard_price` (costo) ni `list_price` crudo al cliente
- El `.env` no se sube. Las credenciales se piden, no se pegan en el chat
