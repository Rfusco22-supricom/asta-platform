# 12 · Puesta al día de producción — lista paso a paso

Para el día de llevar `main` a EasyPanel. Junta en un solo orden lo que está
repartido entre `docs/06`, `docs/09`, `db/backup` y los issues, porque **el orden
importa**: los permisos van después de las migraciones, los vendedores después
de los clientes, y el usuario de mínimo privilegio al final, cuando ya se sabe
que no le falta nada.

Escrita el 2026-10-02 contra `main` en `08b4c53`. Si `main` ha avanzado, repasar
el paso 3 (migraciones) antes de empezar.

**Cómo usarla:** un paso cada vez. Cada uno dice qué ejecutar, **qué tiene que
salir** y qué hacer si no sale. Ante cualquier salida inesperada, **parar** y
mirarla antes de seguir; nada de lo que hay detrás de un paso fallido es seguro.

| Avanza | Pasos |
|---|---|
| El panel deja de decir «No existe la ruta» | 2, 3, 4, 5 |
| #44 · usuario de mínimo privilegio | 4, 6 |
| #81 · cuentas de vendedor | 8 |
| #56 · compatibilidades en producción | 9 |
| #46 · alertas | 10 |
| #48 · respaldos | 1, 11 |

---

## 0 · Antes de empezar

- [ ] `main` contiene todo lo que se quiere subir. Anotar el SHA corto:
      `git rev-parse --short origin/main`.
- [ ] Hay acceso a la **consola** de los tres servicios en EasyPanel:
      `asta-middleware`, `asta-web` y el de MySQL.
- [ ] Se conoce un usuario de MySQL **con DDL** para las migraciones
      (`asta_migrador`, o el que aplicó el esquema a mano). Su DSN se llama
      `MIGRADOR` en esta lista. Ojo: la base se llama **`Asta`**, con mayúscula.
- [ ] Ventana tranquila: entre los pasos 2 y 5 algunas pantallas del panel
      darán error. Son minutos, pero mejor sin vendedores trabajando.

> **Opcional, pero conviene tenerlo ya:** la cuenta `no-reply@supricom.com.ve`
> con contraseña de aplicación (#53, #46) y el usuario de servicio dedicado de
> Odoo (#1). Sin ellos todo funciona, pero los correos no salen y el
> middleware sigue entrando en Odoo con una cuenta personal.

## 1 · Respaldo antes de tocar nada

En la consola del servicio **MySQL**:

```bash
mysqldump -u root -p --single-transaction --routines --events --triggers \
  Asta > /tmp/asta-antes.sql
tail -1 /tmp/asta-antes.sql
grep -c 'USE `' /tmp/asta-antes.sql
```

- **Tiene que salir:** `-- Dump completed on …` en la última línea, y `0` en
  el `grep`.
- **Si no sale la marca de cierre:** el volcado está cortado (disco lleno,
  corte). No seguir.
- **Sin `--databases`, a propósito:** así el fichero no nombra ninguna base y
  solo se restaura donde se diga explícitamente. Con `--databases` lleva un
  `USE Asta` dentro, y restaurarlo «en otra base» escribiría encima de la de
  verdad.

Ese fichero es la vuelta atrás de todo lo que viene. Si EasyPanel tiene
respaldos del servicio MySQL, lanzar también uno manual ahora.

## 2 · Redesplegar `asta-middleware` desde `main`

En EasyPanel, servicio `asta-middleware`:

- [ ] Build argument `VERSION_SHA=<el SHA del paso 0>`.
- [ ] **Dejar `DATABASE_URL` como está.** El cambio a `asta_app` es el paso 6.
- [ ] Desplegar.

Comprobar desde la consola de `asta-web` (la imagen no trae `curl`):

```bash
node -e "fetch('http://asta-middleware:3001/health').then(r=>r.json()).then(j=>console.log(JSON.stringify({status:j.status,version:j.version,mysql:j.dependencias?.mysql?.ok,odoo:j.dependencias?.odoo?.ok})))"
```

- **Tiene que salir:** `version.sha` = el SHA del paso 0, `construido` de hoy,
  y `mysql: true`, `odoo: true`.
- **Si `version` falta o es de septiembre:** el despliegue no cogió la imagen
  nueva. No seguir.

> Desde aquí y hasta el paso 4, las pantallas que usan tablas nuevas
> (compatibilidades, duplicados, alertas) darán error: el código ya las pide y
> la base todavía no las tiene.

## 3 · Línea base de Prisma y migraciones

**`docs/09-BASELINE-PRISMA.md`, pasos 1 a 4**, desde la consola del contenedor
**nuevo** de `asta-middleware` (directorio `/app/apps/middleware`), con
`export MIGRADOR="mysql://…/Asta"`.

| Paso de docs/09 | Tiene que salir |
|---|---|
| 1 · deriva contra `linea-base.prisma` | `-- This is an empty migration.` |
| 2 · marcar las tres de la línea base | tres «marked as applied» |
| 3 · `migrate status`, luego `migrate deploy` | pendientes solo las posteriores; se aplican las **diez** de la tabla de docs/09 |
| 4 · deriva contra `schema.prisma` | `-- This is an empty migration.` |

- **Si el paso 1 de docs/09 saca algo:** PARAR. Pegar la salida y revisarla
  antes de marcar nada. La guía explica los casos más probables.
- **Si `migrate deploy` falla a mitad:** no repetir a ciegas. Prisma deja la
  migración marcada como fallida; mirar el error y, si hace falta volver atrás,
  el respaldo del paso 1.

## 4 · Permisos de las tablas nuevas

Como root, en la consola de MySQL.

**4.1 · Quién existe:**

```sql
SELECT user, host FROM mysql.user WHERE user LIKE 'asta\_%';
```

- **Si están los tres** (`asta_app`, `asta_migrador`, `asta_lectura`): aplicar
  los GRANT de la sección «Permisos de las tablas nuevas» de docs/09, con el
  host que haya salido aquí. **Incluye el permiso por columna de
  `recommendation_events`**, que no es una tabla nueva pero lo necesita la
  telemetría (#150).
- **Si no existen:** no se aplicó nunca `004_usuarios.sql`. Generarlo con
  contraseñas reales (ver la cabecera de `db/mysql/004_usuarios.sql`), cambiar
  `@'localhost'` por el host de la red de EasyPanel y `asta.` por `Asta.`, y
  aplicarlo entero. Crea los tres usuarios con todos sus permisos.

**4.2 · Que no falte ninguna tabla.** La consulta de docs/09 («Para comprobar
que no ha quedado ninguna tabla sin permisos…»):

- **Tiene que salir:** vacía.

## 5 · Redesplegar `asta-web` desde `main`

- [ ] Desplegar. `MIDDLEWARE_URL=http://asta-middleware:3001`, como siempre.
- [ ] Añadir `SOPORTE_WHATSAPP` con el número de soporte (docs/06): es el
      enlace «¿Problemas para entrar?» del login.
- [ ] Entrar al panel como SuperAdmin y abrir **cada sección del menú**:
      Resumen, Vendedores, Reportes, Marca ASTA, Compatibilidades,
      Recomendador, Usuarios y Duplicados.
- **Tiene que salir:** todas abren. Ninguna dice «No existe la ruta».
- **Si alguna dice «No existe la ruta»:** el middleware desplegado es más viejo
  que el panel. Volver al paso 2.

## 6 · Que el middleware entre como `asta_app` (#44)

Hasta aquí el middleware sigue entrando como root.

- [ ] En `asta-middleware`, `DATABASE_URL=mysql://asta_app:<CLAVE>@<host-mysql>:3306/Asta`.
      La `@` de una contraseña se escribe `%40`.
- [ ] Reiniciar el servicio.
- [ ] Repetir la comprobación de `/health` del paso 2: `mysql: true`.
- [ ] Repetir el recorrido del paso 5 por todas las secciones.
- **Si algo da error de permisos** (`command denied`): volver a poner el
  `DATABASE_URL` anterior, reiniciar, y buscar con la consulta del paso 4.2 qué
  tabla falta. La aplicación nunca debería necesitar DELETE ni DDL: si lo pide,
  es un fallo que hay que mirar, no un permiso que conceder.

## 7 · Cerrar las sesiones de antes del despliegue

Hasta este despliegue, el log del middleware escribía el token de sesión de
cada login (#145). Si esos logs se conservan o se han copiado, esos tokens
siguen valiendo hasta 30 días. Como root:

```sql
UPDATE Asta.user_sessions
   SET revoked_at = UTC_TIMESTAMP(3), revoked_reason = 'logs_con_token'
 WHERE revoked_at IS NULL AND issued_at < '<fecha y hora UTC del paso 2>';
```

Cada persona solo tiene que volver a entrar. Si los logs antiguos del
middleware se pueden borrar en EasyPanel, mejor.

## 8 · Clientes y vendedores (#81)

En la consola de `asta-middleware`. **El orden importa:** casi todos los
vendedores se crean subiendo de rol una ficha de cliente que ya existe.

```bash
node dist/cli/sync-partners.js --completo
node dist/cli/sync-vendedores.js               # SIMULACRO: lista, no escribe
node dist/cli/sync-vendedores.js --aplicar
node dist/cli/sync-partners.js --bajas         # SIMULACRO de las bajas de Odoo (#89)
node dist/cli/sync-partners.js --bajas --aplicar
```

- **Antes del `--aplicar` de vendedores:** leer la lista del simulacro. Es quién
  va a ver la facturación de una cartera. En desarrollo salieron 28 candidatos:
  17 con acceso y 11 descartados con su motivo.
- **Contraseñas:** el personal entra con su contraseña de **Odoo** (#85). Solo
  quien tenga la verificación en dos pasos activada en Odoo necesita una del
  panel: `node dist/cli/set-password.js <correo>`, o una invitación desde
  Usuarios.

## 9 · Compatibilidades para el kiosco (#56)

La sección «Después: cargar las compatibilidades» de docs/09, **en su orden**
y con el simulacro antes de cada `--aplicar`. Son cinco comandos.

- **Tiene que salir:** al repetir cualquiera, «0 creadas». Todo entra como
  pendiente.
- **Después:** validar en el panel (Compatibilidades), empezando por lo más
  vendido. La cobertura del top 20 dice cuándo se pasa el umbral de #7.

## 10 · Alertas (#46)

- [ ] Si ya existe la cuenta de correo: en `asta-middleware`, `SMTP_HOST`,
      `SMTP_PORT`, `SMTP_USER` y `SMTP_PASSWORD` (`.env.example` explica cuáles),
      y `ALERTAS_CORREO=<direcciones>`. Reiniciar.
- [ ] Programar cada 5 minutos, en el contenedor del middleware:
      `node dist/cli/alertas.js`.
- [ ] Lanzarlo una vez a mano. **Tiene que salir** el informe, y el «sync
      atrasado» debería haber desaparecido tras el paso 8.

Sin correo, las alertas salen igual por la salida del comando. El canal se
añade después sin tocar nada más.

## 11 · Respaldos (#48)

El mecanismo de producción **está sin decidir** (`db/backup/README.md`):
respaldos de EasyPanel o un contenedor propio. Lo que sí se puede hacer hoy,
y que nunca se ha hecho, es **un ensayo de restauración en MySQL 9**. En la
consola de MySQL, con el volcado del paso 1:

```sql
CREATE DATABASE asta_simulacro;
```

```bash
# La base de destino, explícita. El volcado del paso 1 no nombra ninguna.
mysql -u root -p asta_simulacro < /tmp/asta-antes.sql
```

```sql
-- Mismo número de tablas, rutinas y restricciones en las dos:
SELECT table_schema, COUNT(*) FROM information_schema.tables
 WHERE table_schema IN ('Asta','asta_simulacro') GROUP BY table_schema;
SELECT routine_schema, COUNT(*) FROM information_schema.routines
 WHERE routine_schema IN ('Asta','asta_simulacro') GROUP BY routine_schema;
SELECT constraint_schema, constraint_type, COUNT(*) FROM information_schema.table_constraints
 WHERE constraint_schema IN ('Asta','asta_simulacro') GROUP BY 1, 2;
DROP DATABASE asta_simulacro;
```

- **Tiene que salir:** las mismas cifras en las dos bases. Si no, el
  respaldo pierde algo y hay que mirarlo antes de confiar en él.
- **Ojo con las rutinas:** una base sin ninguna **no sale** en esa consulta, en
  vez de salir con 0. Si aparece `Asta` y no `asta_simulacro`, faltan rutinas
  en la copia (el `--routines` del volcado).
- Ensayado así en la MariaDB de desarrollo el 2026-10-02: 28 tablas y las mismas
  restricciones en las dos (4 CHECK, 26 foráneas, 28 primarias, 14 únicas).
- El volcado del paso 1 es de **antes** de las migraciones. Para cerrar #48,
  repetir el ensayo con uno de **después**, y anotar cuánto tarda (el RTO).

## 12 · Cierre

- [ ] `/health` con la versión de hoy, `mysql` y `odoo` en `true`.
- [ ] El panel abre todas las secciones, como `asta_app`.
- [ ] Un vendedor entra con su contraseña de Odoo y ve su cartera.
- [ ] La consulta de permisos del paso 4.2 sale vacía.
- [ ] Anotar en cada issue lo hecho: #81 (cuántos vendedores), #44 (`asta_app`
      en uso), #56 (cargas aplicadas), #46 (cron y canal), #48 (ensayo y RTO).

---

## Si hay que volver atrás

| Dónde | Cómo |
|---|---|
| Paso 2 o 5 | Redesplegar el commit anterior en EasyPanel. Las migraciones del paso 3 solo **añaden**, así que el código viejo funciona con la base nueva. |
| Paso 3, a mitad | No improvisar. Respaldo del paso 1 y revisar el error de Prisma antes de volver a intentarlo. |
| Paso 6 | Volver al `DATABASE_URL` anterior y reiniciar. |
| Pasos 8 y 9 | No se deshacen solos, pero todo entra como pendiente o como cuenta sin contraseña. El panel todavía no desactiva usuarios: una cuenta de vendedor que no debía crearse se desactiva como root con `UPDATE Asta.app_users SET is_active = 0 WHERE email = '<correo>';`, y se cierran sus sesiones como en el paso 7. |
