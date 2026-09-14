# Esquema MySQL — ASTA

```bash
mysql -u USUARIO -p -e "CREATE DATABASE asta CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
mysql -u USUARIO -p asta < db/mysql/001_schema.sql
mysql -u USUARIO -p asta < db/mysql/002_seed.sql
# 003_partitioning.sql es opcional: aplicar cuando api_request_logs crezca
```

**Requiere MySQL 8.0.13+ o MariaDB 10.4+.** Comprobar con `SELECT VERSION();`.
Desarrollo va sobre MariaDB 10.4 (XAMPP); **falta confirmar qué motor da EasyPanel
antes del primer despliegue.**

> **Corrección.** Una versión anterior de este README decía que
> `utf8mb4_general_ci` daba el comportamiento correcto para el email y que estaba
> "verificado". Era falso: lo que se estaba viendo era la consola de Windows
> (cp850) manglando la `é`, no el motor. Repetida la prueba con literales hex,
> **ninguna colación `_ci` distingue acentos ni mayúsculas.** Por eso la columna
> `app_users.email` lleva `COLLATE utf8mb4_bin` explícito y la normalización la
> hace la aplicación en `normalizarEmail()`. Ver la nota de migraciones abajo.

| Archivo | Qué hace |
|---|---|
| `001_schema.sql` | 16 tablas, índices y claves foráneas. **Es el diseño**: aquí están los comentarios |
| `002_seed.sql` | Mapeo tarifa→nivel y SuperAdmin inicial. Idempotente |
| `003_partitioning.sql` | Particionado mensual de logs, rotación con agregados y limpieza. Opcional (issue #47) |
| `004_usuarios.sql` | Usuarios de MySQL con privilegio mínimo. **Obligatorio en producción** (issue #44) |

---

## Particionado y purga de `api_request_logs` (issue #47)

Opcional. Se aplica cuando la API pública empiece a generar volumen de verdad,
no el día 1: particionar una tabla vacía solo añade complejidad.

```bash
mysql -u USUARIO -p asta < db/mysql/003_partitioning.sql
mysql -u USUARIO -p asta -e "CALL sp_rotate_api_log_partitions();"   # mensual
mysql -u USUARIO -p asta -e "CALL sp_cleanup_expired();"             # diario
```

Los dos procedimientos los llama `asta_migrador`, no la aplicación: hacen DDL y
`DELETE`, y `asta_app` no tiene ninguno de los dos (ver #44).

### Se purga con DROP PARTITION, no con DELETE

Un `DELETE` de millones de filas bloquea, infla el log de transacciones y no
devuelve el espacio al sistema operativo. Tirar la partición es instantáneo y
libera el archivo.

### Y por eso hace falta `api_usage_monthly`

Tirar la partición se lleva el detalle por delante. Perder *qué petición hizo
este cliente el 3 de marzo* es aceptable; perder *cuánto consumió este cliente en
marzo* no lo es, porque eso es lo que se factura.

`sp_rotate_api_log_partitions()` calcula el agregado **antes** de tirar cada
partición, en el mismo procedimiento. Separarlo en dos trabajos distintos sería
garantizar que algún día se ejecute solo el segundo.

### Dos cosas que solo se vieron ejecutándolo

**La primaria tenía que ser compuesta desde el principio.** MySQL exige la
columna de partición en toda clave única. Antes `003` cambiaba la primaria a
`(id, created_at)` con un `ALTER`, y eso dejaba una bomba: en cuanto se aplicaba
el particionado, `prisma migrate diff` veía deriva y quería **deshacerlo** — la
siguiente migración habría intentado devolver la primaria a `(id)`, imposible
sobre una tabla particionada, o desparticionado la tabla en producción. Ahora la
primaria compuesta viene de `001_schema.sql` y de `schema.prisma`, y tras aplicar
`003` el diff sale vacío.

**El procedimiento dejaba huecos entre particiones.** Creaba solo la de dentro de
dos meses; si el trabajo se saltaba un mes, el mes intermedio se quedaba sin
partición. Y un hueco no da error: las filas de ese mes caen en la siguiente
partición, que se llama como **otro** mes. Al purgarla, el agregado se calcula
para el mes de su nombre y las del mes sin partición se borran sin haberse
agregado nunca — pérdida de datos silenciosa. Ahora crea en bucle todas las que
falten, y se comprobó partiendo de una tabla a la que le faltaban julio y agosto.

---

## Usuarios de MySQL (issue #44)

**En producción la aplicación no debe conectarse como `root`.** Hoy lo hace, y eso
significa que un fallo de inyección o un servidor comprometido puede borrar la
base entera, leer `mysql.user` y escribir ficheros en el disco del servidor.

El esquema original vivía en PostgreSQL con Row Level Security, que era la
segunda línea de defensa: aunque el middleware tuviera un fallo de scoping, la
base se negaba a devolver filas de otro cliente. **MySQL no tiene RLS y no hay
equivalente.** Lo único que queda es acotar el daño.

```bash
# Genera el SQL ya adaptado, con contraseñas al azar.
pnpm usuarios:sql --host '%' --base Asta > /tmp/usuarios.sql

# Las contraseñas salen por pantalla (no van al fichero). Cópialas.
# Luego se aplica y se comprueba:
mysql -u root -p < /tmp/usuarios.sql
pnpm check:grants
```

`004_usuarios.sql` **no se aplica tal cual**: hay que tocarle los diez
marcadores de contraseña, las cuarenta apariciones de `@'localhost'` —que en
Docker no valen— y el nombre de la base, que en Linux distingue mayúsculas. El
generador hace las tres cosas de una vez sustituyendo sobre el fichero, sin
reimplementar ningún `GRANT`: el fichero versionado sigue siendo la única
descripción de qué puede hacer cada usuario.

Las contraseñas salen por la salida de error a propósito, para que una
redirección deje en el fichero solo el SQL y no una copia de las credenciales en
el disco. Y son `base64url`, que entra en un DSN sin codificar — el `@` de una
contraseña normal es justo el carácter que rompe la `DATABASE_URL`.

| Usuario | Para qué | Lo que NO puede |
|---|---|---|
| `asta_app` | El middleware en marcha. Va en `DATABASE_URL` | Borrar filas, tocar el esquema, reescribir las bitácoras |
| `asta_migrador` | `migrate:deploy` y `003_partitioning.sql`, a mano | Su clave **no** va en el `.env` del despliegue |
| `asta_lectura` | Informes y depuración | Leer `user_credentials`, `auth_tokens` ni `api_keys` |

### Las tres decisiones que hacen que esto valga de algo

**`asta_app` no tiene `DELETE`.** Se revisó el código: la aplicación nunca borra
una fila. Las notas se borran en suave, las sesiones y las API keys se revocan.
Comprobado además a la brava — la batería completa corriendo como `asta_app` da
**209 tests pasando y 0 fallando**, y las únicas operaciones denegadas en todo el
recorrido son los dos `DELETE` con los que los propios tests limpian sus fixtures
(`app_users` y `api_request_logs`). Si algo del producto necesitara borrar,
habría salido ahí.

**`asta_app` no puede reescribir las bitácoras** (`audit_logs`,
`api_request_logs`, `recommendation_events`): solo `SELECT` e `INSERT`. Un
registro de auditoría que la aplicación puede modificar no es un registro de
auditoría — si el middleware queda comprometido, lo primero que hace quien entra
es borrar su rastro.

**Los permisos se conceden tabla a tabla, no con `asta.*`.** Es lo que permite lo
anterior. El precio es que una tabla nueva no queda cubierta hasta que alguien la
añada, y por eso existe `pnpm check:grants`: compara las tablas que existen
contra las concedidas y falla si alguna no tiene decisión. Sin esa comprobación,
el primer síntoma sería un informe roto y el "arreglo" sería un `GRANT ALL`.

### Los tests necesitan `DELETE`

No es una excepción escondida: limpian sus fixtures en los `afterAll`. Corren
contra una base de **desarrollo** con un usuario que puede borrar — en local,
`root`. No se crea un cuarto usuario para eso mientras no haya CI (issue #13).

---

## Migraciones de Prisma (issue #12)

Hay **dos** rutas para montar la base y conviene no confundirlas:

```bash
pnpm db:setup          # desarrollo: aplica los .sql de arriba a pelo
pnpm migrate:deploy    # cualquier entorno: aplica prisma/migrations
```

`prisma/migrations/0_init/` es una **línea base**, no una migración escrita a
mano: se generó desde la base de desarrollo ya montada por `001_schema.sql` y se
marcó como aplicada con `prisma migrate resolve --applied 0_init`. Existe para
que EasyPanel y cualquier entorno nuevo se levanten con `migrate deploy` y para
que los cambios futuros tengan de dónde partir.

El **diseño** sigue viviendo en `001_schema.sql`. La migración es su reflejo
mecánico, sin los comentarios.

### `prisma migrate diff` se come las colaciones de columna

Comprobado, no supuesto. La base real tiene `app_users.email COLLATE utf8mb4_bin`
y el fichero generado salía con `VARCHAR(255)` a secas, que habría heredado el
`utf8mb4_unicode_ci` de la base.

No es cosmético. Probado sobre una base recién creada:

| columna | `jose@x.com` + `JOSE@x.com` + `josé@x.com` |
|---|---|
| con `COLLATE utf8mb4_bin` | las tres conviven |
| sin él (default `_unicode_ci`) | `ERROR 1062 Duplicate entry` en la segunda y en la tercera |

Es decir: sin el `COLLATE`, dos personas distintas no pueden tener cuenta. Por eso
en `0_init/migration.sql` ese `COLLATE` está puesto **a mano**, con su comentario.
**Si alguien regenera el fichero con `migrate diff`, hay que volver a ponerlo.**

### Comprobar que no hay deriva

```bash
npx prisma migrate diff   --from-url "$DATABASE_URL"   --to-schema-datamodel prisma/schema.prisma --script
```

Si imprime `-- This is an empty migration.` la base y el modelo coinciden.

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
