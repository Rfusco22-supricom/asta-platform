# 09 · Línea base de Prisma en producción

> **Pendiente de ejecutar.** Comprobado el 15-sep-2026 contra la base de
> EasyPanel: `_prisma_migrations` **no existe**. Hasta que esto se haga, no se
> puede aplicar ninguna migración nueva, y el middleware nuevo no se puede
> desplegar bien: sus pantallas usan tablas que solo crean las migraciones.

> **Corregido el 1-oct-2026.** La versión anterior comparaba producción con
> `schema.prisma` en el paso 1 y esperaba que saliera vacío. Era cierto cuando se
> escribió; desde que entraron las tablas de #101, ese diff imprime 18 sentencias
> (`CREATE TABLE printer_brands`, `staff_login_guards`…) aunque la base esté
> perfecta, y la guía decía «si sale cualquier otra cosa, PARAR». Ahora el paso 1
> compara con `prisma/linea-base.prisma`, y el procedimiento entero está
> ensayado de nuevo (ver al final).

---

## El problema, en una frase

Producción se montó aplicando `db/mysql/001_schema.sql` a mano. Las tablas
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

## Cuándo se hace, dentro del despliegue

`prisma/linea-base.prisma` y las migraciones nuevas viajan **dentro de la imagen
del middleware**, así que todo esto se hace desde la consola del contenedor
**nuevo**:

```
1. Redesplegar asta-middleware desde main (con VERSION_SHA)
2. En su consola: pasos 1 a 4 de abajo           ← minutos, no horas
3. Permisos de las tablas nuevas (como root)
4. Redesplegar asta-web
5. Comprobar /health y entrar al panel
```

Entre el 1 y el 3, las pantallas que usan tablas nuevas (compatibilidades, la
alerta de kioscos, el bloqueo de intentos del personal) darán error: el código
ya las pide y la base todavía no las tiene. Por eso los pasos van seguidos.

El directorio de trabajo del contenedor es `/app/apps/middleware`.

**Con qué credenciales.** El paso 2 crea la tabla `_prisma_migrations` y el
paso 3 crea tablas: los dos necesitan DDL. Van con `asta_migrador` o con el
usuario que aplicó el esquema. **`asta_app` no puede** —no tiene CREATE, y eso
está bien (#44)—. Si el `DATABASE_URL` del contenedor es el de `asta_app`, hay
que pasar el del migrador delante de cada orden:

```bash
export MIGRADOR="mysql://asta_migrador:CLAVE@HOST:3306/Asta"
```

Ojo con la mayúscula: la base se llama **`Asta`**, y en Linux eso no es lo mismo
que `asta`.

---

## Paso 1 · Comprobar que no hay deriva

```bash
./node_modules/.bin/prisma migrate diff \
  --from-url "$MIGRADOR" \
  --to-schema-datamodel ../../prisma/linea-base.prisma \
  --script
```

Es de **solo lectura**: compara y escribe en pantalla, no toca la base.

**Contra `linea-base.prisma`, no contra `schema.prisma`.** `linea-base.prisma`
describe la base tal como se montó a mano: lo que dicen las tres migraciones de
la línea base más `compatibilidad_productos`, la tabla creada desde phpMyAdmin.
`schema.prisma` ya incluye todo lo que las migraciones posteriores van a crear, y
compararlo con producción lo enseñaría como si fuera deriva.

**Lo que tiene que salir:**

```
-- This is an empty migration.
```

Eso significa que producción es exactamente la base que describen las tres
migraciones, y que marcarlas como aplicadas dice la verdad.

**Si sale cualquier otra cosa, PARAR.** Lo que imprima son diferencias reales
entre producción y lo que se aplicó a mano. No se sigue al paso 2: hay que mirar
qué son antes, porque marcar el historial encima de una deriva la convierte en
permanente e invisible.

Lo más probable, si sale algo:

- **`ALTER TABLE compatibilidad_productos MODIFY ...`**: los tipos del modelo se
  dedujeron del contenido, no del `SHOW CREATE TABLE` (salió cortado). No borra
  datos, pero hay que ajustar el modelo en `schema.prisma` y en
  `linea-base.prisma` a lo que hay, y repetir.
- **`DROP TABLE compatibilidad_productos`**: se está comparando con un
  `linea-base.prisma` que no tiene el modelo. **No aplicar nada.**
- **Algo de tipos (`JSON`, `DATETIME`…)**: producción es MySQL 9 y el ensayo fue
  sobre MariaDB. Si los dos motores describen un tipo de forma distinta, sale
  aquí. Hay que entenderlo antes de seguir.

## Paso 2 · Marcar las tres migraciones de la línea base

Solo si el paso 1 salió vacío. **En este orden**, que es el del historial:

> **Exactamente estas tres, aunque `prisma/migrations/` tenga más.** Son las que
> el esquema aplicado a mano ya contiene. Las posteriores **no están en la
> base**, así que marcarlas sería mentir y dejaría a Prisma creyendo que existen
> unas tablas que nadie creó. Esas se aplican solas en el paso 3.

```bash
DATABASE_URL="$MIGRADOR" ./node_modules/.bin/prisma migrate resolve --applied 0_init                              --schema ../../prisma/schema.prisma
DATABASE_URL="$MIGRADOR" ./node_modules/.bin/prisma migrate resolve --applied 20260914120000_api_logs_pk_compuesta --schema ../../prisma/schema.prisma
DATABASE_URL="$MIGRADOR" ./node_modules/.bin/prisma migrate resolve --applied 20260914130000_api_usage_monthly     --schema ../../prisma/schema.prisma
```

Ninguno de los tres ejecuta SQL del esquema: solo escriben la fila
correspondiente en `_prisma_migrations`.

## Paso 3 · Aplicar lo posterior

```bash
DATABASE_URL="$MIGRADOR" ./node_modules/.bin/prisma migrate status --schema ../../prisma/schema.prisma
```

Tiene que listar como pendientes **solo migraciones posteriores a las tres**. Si
aparece `0_init` como pendiente, el paso 2 no quedó completo: **no seguir**.

```bash
DATABASE_URL="$MIGRADOR" ./node_modules/.bin/prisma migrate deploy --schema ../../prisma/schema.prisma
```

Aplica lo que haya en la imagen después de la línea base. Al 1-oct-2026, en
`main`:

| Migración | Qué hace |
|---|---|
| `20260915195135_compatibilidad_impresora_toner` | Las seis tablas de #101 y la FK de `recommendation_events` |
| `20260916143723_compatibilidad_creada_por` | Quién añadió cada compatibilidad |
| `20260916150000_compatibilidad_productos_fuente` | `compatibilidad_productos` con `IF NOT EXISTS`: **en producción no hace nada**, la tabla ya está |
| `20260916190000_staff_login_guards` | Bloqueo por intentos del personal (#85) |
| `20261001140000_alert_states` | Memoria de las alertas de operación (#46) |

Y las de los PR abiertos cuando se fusionen: `kiosk_devices` con almacén y
rotación de token (#120) y las columnas `Json` como `JSON` (#101), que **en
producción no ejecuta ningún ALTER** porque allí ya lo son.

## Paso 4 · Confirmar que no queda deriva

```bash
./node_modules/.bin/prisma migrate diff \
  --from-url "$MIGRADOR" \
  --to-schema-datamodel ../../prisma/schema.prisma \
  --script
```

Ahora **sí** contra `schema.prisma`: la base tiene que ser ya el modelo de la
aplicación.

```
-- This is an empty migration.
```

Y `migrate deploy` repetido tiene que decir `No pending migrations to apply.`

---

## Permisos de las tablas nuevas

`asta_app` y `asta_lectura` tienen permisos **tabla a tabla** (#44), y MySQL no
deja dar permisos sobre una tabla que no existe. Así que las tablas que acaba de
crear el paso 3 nacen **sin permisos para la aplicación**: el panel daría
«acceso denegado» aunque las tablas estén.

**No reaplicar `004_usuarios.sql` entero**: cambia las contraseñas de los tres
usuarios. Basta con los GRANT de las tablas nuevas.

Antes, mirar cómo están creados los usuarios en producción, porque el fichero
usa `asta.` y `@'localhost'`, y en producción la base es `Asta` y en Docker las
conexiones no llegan desde `localhost`:

```sql
SELECT user, host FROM mysql.user WHERE user LIKE 'asta\_%';
SHOW GRANTS FOR 'asta_app'@'<host>';
```

Con el host y el nombre de base que salgan ahí, como root:

```sql
GRANT SELECT, INSERT, UPDATE ON Asta.printer_brands           TO 'asta_app'@'<host>';
GRANT SELECT, INSERT, UPDATE ON Asta.printer_models           TO 'asta_app'@'<host>';
GRANT SELECT, INSERT, UPDATE ON Asta.printer_model_aliases    TO 'asta_app'@'<host>';
GRANT SELECT, INSERT, UPDATE ON Asta.cartridges               TO 'asta_app'@'<host>';
GRANT SELECT, INSERT, UPDATE ON Asta.cartridge_printer_models TO 'asta_app'@'<host>';
GRANT SELECT, INSERT, UPDATE ON Asta.product_cartridges       TO 'asta_app'@'<host>';
GRANT SELECT                 ON Asta.compatibilidad_productos TO 'asta_app'@'<host>';
GRANT SELECT, INSERT, UPDATE ON Asta.staff_login_guards       TO 'asta_app'@'<host>';
GRANT SELECT, INSERT, UPDATE ON Asta.alert_states             TO 'asta_app'@'<host>';

GRANT SELECT ON Asta.printer_brands           TO 'asta_lectura'@'<host>';
GRANT SELECT ON Asta.printer_models           TO 'asta_lectura'@'<host>';
GRANT SELECT ON Asta.printer_model_aliases    TO 'asta_lectura'@'<host>';
GRANT SELECT ON Asta.cartridges               TO 'asta_lectura'@'<host>';
GRANT SELECT ON Asta.cartridge_printer_models TO 'asta_lectura'@'<host>';
GRANT SELECT ON Asta.product_cartridges       TO 'asta_lectura'@'<host>';
GRANT SELECT ON Asta.compatibilidad_productos TO 'asta_lectura'@'<host>';
GRANT SELECT ON Asta.staff_login_guards       TO 'asta_lectura'@'<host>';
GRANT SELECT ON Asta.alert_states             TO 'asta_lectura'@'<host>';
```

Son las mismas líneas que `004_usuarios.sql` (líneas 148-162 y 292-301), sin
DELETE en ninguna (#105). `kiosk_devices` no necesita nada: sus columnas nuevas
heredan el permiso de la tabla.

Para comprobar que no ha quedado ninguna tabla sin permisos para la aplicación
(`pnpm check:grants` no sirve aquí: vive en `scripts/`, que no viaja en la
imagen), como root:

```sql
SELECT t.TABLE_NAME
  FROM information_schema.TABLES t
 WHERE t.TABLE_SCHEMA = 'Asta'
   AND t.TABLE_NAME <> '_prisma_migrations'
   AND NOT EXISTS (
         SELECT 1 FROM information_schema.TABLE_PRIVILEGES p
          WHERE p.TABLE_SCHEMA = t.TABLE_SCHEMA
            AND p.TABLE_NAME   = t.TABLE_NAME
            AND p.GRANTEE LIKE '''asta\_app''@%');
```

Tiene que salir vacía. Si sale alguna, mirar qué le concede `004_usuarios.sql`.

---

## Después: cargar las compatibilidades

Desde la consola del contenedor del middleware:

```bash
node dist/cli/importar-propuestas.js                 # producto → cartucho, desde Odoo
node dist/cli/importar-compatibilidades.js           # SIMULACRO: impresora → cartucho
node dist/cli/importar-compatibilidades.js --aplicar
node dist/cli/importar-impresoras.js                 # SIMULACRO: impresoras del nombre
node dist/cli/importar-impresoras.js --aplicar
node dist/cli/importar-listas-fabricante.js          # SIMULACRO: listas del fabricante (#56)
node dist/cli/importar-listas-fabricante.js --aplicar
node dist/cli/importar-impresoras-catalogo.js        # SIMULACRO: impresoras que vendemos (#40)
node dist/cli/importar-impresoras-catalogo.js --aplicar
```

En ese orden, y el orden importa:

1. **`importar-propuestas`** saca los cartuchos de los nombres de Odoo. Sin él no
   hay con qué cruzar.
2. **`importar-compatibilidades`** lee `compatibilidad_productos`, la tabla que
   se mantiene a mano, así que sus códigos cruzan con los cartuchos del paso 1 en
   vez de duplicarlos.
3. **`importar-impresoras`** (#129) lee las impresoras que los propios nombres de
   Odoo mencionan —"LaserJet P3010/3015d", "ML-1916/1915"— y las ata a los
   cartuchos del paso 1.
4. **`importar-listas-fabricante`** carga las impresoras de los cartuchos del top
   20, copiadas de la web de cada fabricante. Solo enlaza cartuchos que ya
   existen. *(Cuando se fusione su PR.)*

5. **`importar-impresoras-catalogo`** carga las impresoras que Supricom vende,
   de la categoría IMPRESORA de Odoo, y las marca como del catálogo. No crea
   compatibilidades ni depende de los otros cuatro: va al final solo para que
   reconozca las impresoras que ellos ya crearon y las marque en vez de
   duplicarlas. Con la marca, el kiosco las encuentra aunque todavía no tengan
   tóner validado, y manda al cliente al mostrador.

Todos se pueden repetir sin pisar lo revisado, y todos tienen simulacro. Todo
entra como pendiente y se revisa en el panel, Compatibilidades.

---

## Cómo se comprobó este procedimiento

No está escrito de memoria. Se ensayó entero el **1-oct-2026** sobre una base
creada igual que producción —`001_schema.sql` aplicado a mano,
`compatibilidad_productos` creada aparte, sin `_prisma_migrations`—, con el
`main` de ese día:

| Paso | Resultado |
|---|---|
| paso 1 tal como estaba antes (contra `schema.prisma`) | **18 sentencias**: la guía habría dicho «PARAR» |
| paso 1 corregido (contra `linea-base.prisma`) | vacío |
| paso 2 · marcar las tres | las tres |
| paso 3 · `migrate status` | pendientes solo las posteriores |
| paso 3 · `migrate deploy` | aplica las cuatro; `compatibilidad_productos` no choca |
| paso 4 · deriva contra `schema.prisma` | vacía |
| `migrate deploy` repetido | `No pending migrations to apply.` |
| las migraciones de los PR de #120 y #101 encima | se aplican limpias, deriva vacía |

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
