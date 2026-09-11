#!/usr/bin/env bash
#
# Realinea los issues tras el cambio de PostgreSQL/Supabase a MySQL 8.
#
#   Uso:  bash scripts/migrate-issues-mysql.sh owner/repo
#
# Corre una sola vez. Los comentarios se duplicarían si se repite.

set -euo pipefail
REPO="${1:?Uso: bash scripts/migrate-issues-mysql.sh owner/repo}"

echo "==> Realineando issues en $REPO"

retitle() { gh issue edit "$1" --repo "$REPO" --title "$2" >/dev/null; echo "    #$1 -> $2"; }
comment() { gh issue comment "$1" --repo "$REPO" --body-file - >/dev/null; echo "    · comentado #$1"; }
rebody()  { gh issue edit "$1" --repo "$REPO" --body-file - >/dev/null; echo "    · reescrito #$1"; }

# ─────────────────────────────────────────────────────────────────────────────
echo ""
echo "-- Titulos --"
retitle 11 "GET /health con latencia de Odoo y MySQL"
retitle 14 "DECISION: Redis desde el dia 1, o cache en MySQL"
retitle 16 "Alta de clientes por invitacion"
retitle 17 "authJwt(): verificacion del JWT propio"
retitle 44 "Defensa en profundidad sin RLS: usuario MySQL de minimo privilegio"

# ─────────────────────────────────────────────────────────────────────────────
echo ""
echo "-- Cuerpos que quedaron incorrectos --"

rebody 12 <<'BODY'
## Contexto

El schema esta escrito en `prisma/schema.prisma`, ya con `provider = "mysql"`.
El mismo esquema esta tambien como SQL en `db/mysql/`, con las decisiones de
traduccion comentadas.

**Requiere MySQL 8.0.13+** (defaults por expresion). MariaDB no sirve tal cual.

## Tareas

- [ ] Crear la base con la colacion correcta:
      `CREATE DATABASE asta CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;`
- [ ] Aplicar `db/mysql/001_schema.sql` y `002_seed.sql`
- [ ] Verificar que `prisma migrate diff --from-url` contra la base real no
      reporta diferencias con el schema
- [ ] Crear el usuario de aplicacion con minimo privilegio (ver #44)
- [ ] Verificar el indice unico sobre `api_keys.prefix` — es el hot path de la API
- [ ] Documentar como se aplican migraciones en produccion

## Cuidado con la colacion

`app_users.email` necesita `utf8mb4_0900_as_ci`: insensible a mayusculas pero
**sensible a acentos**. Con la colacion por defecto (`_ai_ci`), `jose@x.com` y
`jose@x.com` con acento serian el mismo usuario.

**Prisma no gestiona colaciones**, asi que eso solo lo aplica el SQL. Si alguien
regenera las tablas desde Prisma sin pasar por `001_schema.sql`, se pierde.

## Ya resuelto en este issue

El `prisma generate` fallaba en el workspace. Causa: Prisma busca el CLI y
`@prisma/client` en el directorio del schema (la raiz), no los encontraba
declarados, e intentaba auto-instalarlos con `pnpm add` **sin el flag `-w`**, que
pnpm rechaza en la raiz de un workspace.

Solucion: ambos paquetes declarados en la raiz + `postinstall` que corre el
generate. Verificado desde `node_modules` borrado.

## Pendiente

El DDL **no se ha ejecutado todavia contra un MySQL real**. Solo validacion
estatica y comparacion contra lo que genera Prisma (15 tablas, 131 columnas,
sin diferencias). Quien lo aplique primero, que reporte aqui.
BODY

rebody 16 <<'BODY'
## Contexto

Los clientes ya existen en Odoo. El alta no es un registro abierto: es una
invitacion a alguien que ya es cliente.

**Este issue cambio de alcance.** Antes lo resolvia Supabase Auth; al pasar a
MySQL, el flujo completo lo construye el middleware. Ver los issues nuevos de
autenticacion en esta misma fase.

## Tareas

- [ ] El SuperAdmin invita desde el panel: se crea `app_users` y un registro en
      `auth_tokens` con `purpose = 'INVITE'`
- [ ] Email con el enlace de invitacion (requiere SMTP configurado)
- [ ] Pantalla de aceptacion: el invitado define su contrasena -> se crea
      `user_credentials` con el hash Argon2id
- [ ] Caducidad del enlace (sugerido: 7 dias) y reenvio
- [ ] Manejar email ya registrado sin filtrar si existe o no
- [ ] **No** permitir auto-registro publico

## Detalle que importa

En `auth_tokens` se guarda el **hash** del token, nunca el token que viaja por
email. Si alguien lee esa tabla, no puede aceptar invitaciones ajenas.
BODY

rebody 17 <<'BODY'
## Contexto

Es el gemelo de `authApiKey()`, que ya existe. Ambos deben producir **el mismo**
objeto `req.identity` (tipo `Identity` de `@asta/shared-types`), para que los
controladores no tengan que saber por que puerta entro el request.

**Este issue cambio de alcance.** Antes era "verificar un JWT que emitia
Supabase". Ahora el middleware **emite sus propios tokens**, asi que hay que
hacer las dos mitades.

## Tareas

- [ ] Verificar firma del JWT con `JWT_SECRET` (libreria `jose`)
- [ ] Cargar `AppUser` y poblar `req.identity`
- [ ] Rechazar tokens expirados o de usuarios inactivos
- [ ] Cachear el lookup de `AppUser` unos segundos para no golpear MySQL en
      cada request
- [ ] Invalidar la sesion cuando cambia la contrasena
      (`user_sessions.revoked_reason = 'password_changed'`)

## Criterio de aceptacion

Un mismo controlador funciona igual invocado con JWT o con API key, y un test lo
demuestra.
BODY

rebody 44 <<'BODY'
## Este issue cambio por completo

Era "Row Level Security en Supabase". **MySQL no tiene RLS.**

Con PostgreSQL, el RLS era la segunda linea de defensa: aunque el middleware
tuviera un bug de scoping, la base se negaba a devolver filas de otro cliente.
Esa red **ya no existe**.

**Consecuencia directa: el aislamiento entre clientes depende ahora UNICAMENTE
del scoping del middleware.** Eso convierte a #25 y #36 de importantes a
criticos: son lo unico que hay entre un bug y una fuga de datos.

## Lo que sustituye al RLS

No hay equivalente. Lo que si se puede hacer es reducir el dano y detectar antes.

### 1. Usuario de MySQL con minimo privilegio

- [ ] Usuario de aplicacion con `SELECT, INSERT, UPDATE, DELETE` **solo** sobre
      las tablas de `asta`. Nada de `GRANT ALL`, nada de root
- [ ] **Sin permisos de DDL en produccion.** Las migraciones las aplica un
      usuario distinto, en una ventana controlada
- [ ] Usuario separado de **solo lectura** para reportes y depuracion
- [ ] Revocar `FILE`, `PROCESS`, `SUPER`

### 2. El scoping como invariante verificable

- [ ] Ningun servicio acepta `partner_id` como parametro libre: sale de
      `req.identity`. Ya se cumple, pero ahora hay que **probarlo con tests**
- [ ] Revision cruzada obligatoria de #25 y #36 (ya acordada en docs/03-REPARTO.md)
- [ ] Considerar un test de propiedad: para N pares de clientes al azar,
      ninguna respuesta contiene datos del otro

### 3. Deteccion

- [ ] Registrar en `audit_logs` **todo** intento de acceso cruzado
- [ ] Alerta cuando aparece mas de uno en una ventana corta: o hay un bug, o
      alguien esta probando

## Por que importa

Perder el RLS no rompe nada hoy, porque el scoping funciona. Lo que cambia es que
**deja de haber margen de error**. Un `where` olvidado que antes era un bug
contenido, ahora es una fuga.
BODY

# ─────────────────────────────────────────────────────────────────────────────
echo ""
echo "-- Comentarios de contexto --"

for n in 6 22 24 29 48 49; do
  comment "$n" <<'BODY'
## Nota: el stack cambio a MySQL

Este issue menciona PostgreSQL o Supabase. **El proyecto usa MySQL 8**; el
esquema esta en `db/mysql/` y `prisma/schema.prisma`.

Lo que cambia en la practica:

- Ya no hay Supabase Auth: el middleware emite sus propios JWT y guarda las
  contrasenas con Argon2id (`user_credentials`)
- Ya no hay RLS — ver #44
- Los backups y la restauracion son responsabilidad propia, no gestionada
- `PARTITION BY RANGE` existe en MySQL pero exige que la clave primaria incluya
  la columna de particion. Ver `db/mysql/003_partitioning.sql`

El detalle de cada traduccion esta en `db/mysql/README.md`.
BODY
done

echo ""
echo "==> Listo."
