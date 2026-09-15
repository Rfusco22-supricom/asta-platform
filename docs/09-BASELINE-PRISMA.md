# 09 · Línea base de Prisma en producción

> **Pendiente de ejecutar.** Comprobado el 15-sep-2026 contra la base de
> EasyPanel: `_prisma_migrations` **no existe**. Hasta que esto se haga, no se
> puede aplicar ninguna migración nueva.

---

## El problema, en una frase

Producción se montó aplicando `db/mysql/001_schema.sql` a mano. Las 17 tablas
están —verificado—, pero **Prisma no sabe que están**, porque la tabla donde
lleva la cuenta de lo aplicado nunca se creó.

```sql
SELECT COUNT(*) FROM information_schema.tables
 WHERE table_schema = DATABASE() AND table_name = '_prisma_migrations';
-- 0
```

## Qué pasa si se salta este paso

El siguiente `prisma migrate deploy` ve una base sin historial y concluye que
está vacía. Entonces intenta aplicar `0_init` entero, que empieza por

```sql
CREATE TABLE `api_key_allowed_ips` ...
```

y muere en la primera tabla con «table already exists». Lo que queda después no
es un fallo limpio: la migración aborta a medias, `_prisma_migrations` guarda
una entrada marcada como fallida, y a partir de ahí `migrate deploy` se niega a
hacer nada hasta que alguien resuelva el conflicto a mano. En medio de un
despliegue, con el servicio arriba.

## El orden importa: primero comprobar, después marcar

Marcar una migración como aplicada es **decirle a Prisma que confíe**. Si el
esquema real no coincide con lo que esas migraciones describen, la mentira no se
nota hoy: se nota en la siguiente migración, que partirá de un estado que no es
el que hay.

Por eso el paso 1 no es opcional y el paso 2 **solo se hace si el paso 1 sale
vacío**.

---

## Paso 1 · Comprobar que no hay deriva

Desde la consola del contenedor del **middleware** (el directorio de trabajo es
`/app/apps/middleware`):

```bash
./node_modules/.bin/prisma migrate diff \
  --from-url "$DATABASE_URL" \
  --to-schema-datamodel ../../prisma/schema.prisma \
  --script
```

Es de **solo lectura**: compara y escribe en pantalla, no toca la base.

**Lo que tiene que salir:**

```
-- This is an empty migration.
```

Eso significa que el esquema real y el que describe Prisma son el mismo, y que
marcar las migraciones como aplicadas dice la verdad.

**Si sale cualquier otra cosa, PARAR.** Lo que imprima son las diferencias
reales entre producción y el repositorio. No se sigue al paso 2: hay que mirar
qué son antes, porque marcar el historial encima de una deriva la convierte en
permanente e invisible.

## Paso 2 · Marcar las tres migraciones

Solo si el paso 1 salió vacío. **En este orden**, que es el del historial:

```bash
./node_modules/.bin/prisma migrate resolve --applied 0_init                              --schema ../../prisma/schema.prisma
./node_modules/.bin/prisma migrate resolve --applied 20260914120000_api_logs_pk_compuesta --schema ../../prisma/schema.prisma
./node_modules/.bin/prisma migrate resolve --applied 20260914130000_api_usage_monthly     --schema ../../prisma/schema.prisma
```

Ninguno de los tres ejecuta SQL del esquema: solo escriben la fila
correspondiente en `_prisma_migrations`.

**Con qué credenciales.** El primero CREA la tabla `_prisma_migrations`, así que
hace falta DDL: va con `asta_migrador` o con el usuario que aplicó el esquema.
**`asta_app` no puede** —no tiene CREATE, y eso está bien (#44)—. Si el
`DATABASE_URL` del contenedor es el de `asta_app`, hay que pasarlo delante:

```bash
DATABASE_URL="mysql://asta_migrador:CLAVE@HOST:3306/Asta" ./node_modules/.bin/prisma migrate resolve --applied 0_init --schema ../../prisma/schema.prisma
```

Ojo con la mayúscula: la base se llama **`Asta`**, y en Linux eso no es lo mismo
que `asta`.

## Paso 3 · Confirmar

```bash
./node_modules/.bin/prisma migrate status --schema ../../prisma/schema.prisma
```

```
3 migrations found in prisma/migrations

Database schema is up to date!
```

Y `migrate deploy` a partir de aquí debe decir `No pending migrations to apply.`
Si dice que va a aplicar algo, el paso 2 no quedó completo.

---

## Cómo se comprobó este procedimiento

No está escrito de memoria. Se ensayó entero sobre una base creada igual que
producción —`001_schema.sql` aplicado a mano, sin historial—:

| paso | resultado |
|---|---|
| deriva entre el SQL crudo y `schema.prisma` | vacía |
| marcar las tres migraciones | las tres |
| `migrate status` | up to date |
| `migrate deploy` | `No pending migrations to apply.` |
| una migración NUEVA encima | se aplica limpia |

El último es el que importa: es lo que va a pasar cuando entren las tablas de
#101.

**Con una diferencia que hay que tener presente.** El ensayo fue sobre
**MariaDB 10.4**, que es lo que hay en desarrollo. Producción es **MySQL 9.7.2**.
El procedimiento es el mismo, pero el resultado del paso 1 puede no ser idéntico:
si los dos motores describen algún tipo de otra forma, la deriva saldrá ahí. Por
eso el paso 1 se ejecuta contra producción y no se da por supuesto.

---

## Después de esto

Queda `db/mysql/003_partitioning.sql`, que **no** es una migración de Prisma y
se aplica aparte (#47). Si se aplica, la primaria compuesta de
`api_request_logs` ya está puesta desde `0_init`, así que no hay que tocar nada
más: el porqué está en el comentario de
`prisma/migrations/20260914120000_api_logs_pk_compuesta/migration.sql`.
