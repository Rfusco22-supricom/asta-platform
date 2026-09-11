# Esquema MySQL — ASTA

```bash
mysql -u USUARIO -p -e "CREATE DATABASE asta CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
mysql -u USUARIO -p asta < db/mysql/001_schema.sql
mysql -u USUARIO -p asta < db/mysql/002_seed.sql
# 003_partitioning.sql es opcional: aplicar cuando api_request_logs crezca
```

**Requiere MySQL 8.0.13+ o MariaDB 10.4+** (defaults por expresión como `DEFAULT (UUID())`).
Comprobar con `SELECT VERSION();`. MariaDB 10.4 sirve: se verifico que soporta `DEFAULT (UUID())` y que
`utf8mb4_general_ci` da el comportamiento correcto para el email.

| Archivo | Qué hace |
|---|---|
| `001_schema.sql` | 15 tablas, índices y claves foráneas |
| `002_seed.sql` | Mapeo tarifa→nivel y SuperAdmin inicial. Idempotente |
| `003_partitioning.sql` | Particionado mensual de logs + rutinas de limpieza. Opcional |

---

## Lo que cambió al salir de PostgreSQL/Supabase

El esquema original usaba 41 construcciones exclusivas de PostgreSQL. Estas son
las traducciones que no son obvias y por qué se resolvieron así.

### Arrays → tablas puente

PostgreSQL tenía `scopes ApiScope[]` y `allowed_ips String[]` como columnas.
**MySQL no tiene tipo array.** Hay dos salidas: una columna JSON, o tablas puente.

Se eligieron tablas puente (`api_key_scopes`, `api_key_allowed_ips`).

No es un downgrade. Con JSON no se puede poner una clave foránea ni un índice
útil, así que nada impide guardar el scope `INVENTROY_READ` con una errata y
descubrirlo en producción. Con tabla puente el motor lo rechaza, y además se
puede responder "qué keys pueden escribir pedidos" con un índice.

El coste es un JOIN al verificar cada token. A 60 req/min por key es
intrascendente.

### `citext` → colación de columna

El email en PostgreSQL usaba la extensión `citext` para comparar sin distinguir
mayúsculas. **En MySQL eso es el comportamiento por defecto**, así que se resuelve
solo.

Pero la colación por defecto de MySQL 8 (`utf8mb4_unicode_ci`) también ignora los
**acentos**, y eso haría que `jose@x.com` y `josé@x.com` fueran el mismo usuario.
Para direcciones de correo es incorrecto. Por eso esa columna concreta declara
`utf8mb4_general_ci`: insensible a mayúsculas, sensible a acentos.

### `timestamptz` → `DATETIME(3)` en UTC

MySQL no tiene un tipo con zona horaria.

Se usa `DATETIME(3)` y **no** `TIMESTAMP`. `TIMESTAMP` convierte según la zona de
la sesión, así que el mismo instante se lee distinto según quién pregunte —y en
un sistema con tablets en tienda, un panel web y una API pública, eso es una
fuente garantizada de bugs difíciles.

**Convención: la aplicación escribe siempre UTC y convierte al mostrar.**

### `uuid` → `CHAR(36)`

MySQL no tiene tipo UUID. `BINARY(16)` ocupa menos y ordena mejor, pero vuelve
ilegible cualquier consulta manual. A esta escala (miles de filas) la diferencia
no se nota, y poder leer un id en un log vale más que el ahorro.

### `jsonb` → `JSON`

MySQL 8 guarda JSON en formato binario internamente, igual que `jsonb`. Se pueden
indexar campos concretos con columnas generadas si hiciera falta.

### `inet` → `VARCHAR(45)`

45 caracteres es la longitud máxima de una IPv6 en texto. Se pierde la validación
que daba el tipo `inet`, así que **la aplicación tiene que validar el formato**
antes de guardar.

### Índices parciales → índices compuestos

PostgreSQL permitía `WHERE revoked_at IS NULL` en un índice. MySQL no. Un índice
compuesto `(user_id, revoked_at)` cumple la misma función aquí.

---

## Lo que Supabase daba gratis y ahora hay que construir

Esto es lo más importante de este cambio, y no es una cuestión de tipos de datos:
**Supabase Auth se encargaba de la autenticación.** Al salir de Supabase, esa
responsabilidad pasa al middleware.

Tres tablas nuevas que no existían en el diseño original:

| Tabla | Para qué |
|---|---|
| `user_credentials` | Hash de contraseña, bloqueo por intentos fallidos |
| `user_sessions` | Refresh tokens (se guarda el hash, no el token) |
| `auth_tokens` | Invitación, reseteo de contraseña, verificación de email |

Y trabajo de aplicación que antes no estaba en el plan:

- Hash **Argon2id** de contraseñas. Aquí sí hace falta un KDF lento: una
  contraseña humana tiene poca entropía y existen diccionarios. Es el caso
  opuesto al de las API keys, donde el secreto son 32 bytes aleatorios y basta
  un HMAC.
- Emisión y rotación de JWT, más el ciclo de vida del refresh token.
- Flujo de "olvidé mi contraseña" con envío de correo.
- Bloqueo por fuerza bruta (ya contemplado en `user_credentials`).
- Verificación de email en el alta por invitación.

**Estimación: entre 1 y 1,5 semanas** que antes no estaban en la Fase 2. También
desaparece el RLS de Supabase, que era la segunda línea de defensa del issue #44:
ahora el aislamiento por cliente depende **solo** del scoping del middleware. Eso
hace que los dos gates de seguridad (#25 y #36) pasen de importantes a críticos.

---

## Las 15 tablas

| Tabla | Qué guarda |
|---|---|
| `app_users` | Espejo de `res.partner` / `res.users` de Odoo |
| `user_credentials` | Contraseñas (Argon2id) |
| `user_sessions` | Refresh tokens activos |
| `auth_tokens` | Invitación / reseteo / verificación |
| `tier_pricelist_map` | De qué tarifa de Odoo sale cada nivel |
| `api_keys` | Tokens de integración de los clientes |
| `api_key_scopes` | Permisos de cada token |
| `api_key_allowed_ips` | Lista blanca de origen (opcional) |
| `api_request_logs` | Bitácora de la API pública |
| `kiosk_devices` | Tablets registradas |
| `kiosk_sessions` | Sesiones efímeras en tienda |
| `recommendation_events` | Telemetría del recomendador |
| `client_notes` | Notas del vendedor sobre el cliente |
| `odoo_entity_cache` | Cache de lectura del ERP |
| `audit_logs` | Rastro de acciones sensibles |

---

## Lo que NO vive aquí

Precios, existencias, productos, facturas y clientes **siguen viviendo en Odoo**
y se leen en vivo. Esta base guarda solo lo que Odoo no debe guardar —tokens,
sesiones, telemetría— más un espejo mínimo de `res.partner` para que el login no
dependa del uptime del ERP.

Si algún día una cifra de facturación se guarda aquí, se habrá roto el principio
que sostiene toda la arquitectura.
