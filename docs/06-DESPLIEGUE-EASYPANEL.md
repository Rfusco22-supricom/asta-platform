# Despliegue en EasyPanel

> **Estado: desplegado.** Los dos servicios están en línea en EasyPanel y el
> panel se usa. La sección de problemas al final recoge lo que ya ha fallado de
> verdad, no lo que podría fallar.
>
> **Lo primero que falló fue desplegar solo uno de los dos.** El panel enseñaba
> «No existe la ruta GET /api/v1/admin/agentes» porque la web era del 15-sep y
> el middleware del 11-sep. Desde entonces `/health` dice qué build corre: ver
> «Saber qué build está corriendo» más abajo.

---

## Antes de desplegar nada

Tres cosas que no son opcionales y que llevan semanas pendientes.

### 1. Rotar las dos credenciales

La API key de Odoo y la contraseña de MySQL se compartieron por chat. Hay que
rotarlas **antes** de que existan en un servidor con acceso desde internet, no
después.

- **Odoo**: Ajustes → Usuarios → `webmaster02@supricom.com.ve` → Cuenta →
  Claves de API. Revocar la actual y crear otra.
- **MySQL**: `ALTER USER ... IDENTIFIED BY '<clave nueva>';`

### 2. Crear los usuarios de MySQL

Hoy la aplicación se conecta como **root**, también en producción. Eso significa
que un fallo de inyección o un contenedor comprometido puede borrar la base
entera, leer `mysql.user` y escribir en el disco del servidor.

```bash
# Sustituir cada <CAMBIA_ESTA_*> por una contraseña aleatoria ANTES de aplicar.
mysql -u root -p < db/mysql/004_usuarios.sql
pnpm check:grants
```

`004_usuarios.sql` dice `@'localhost'` en todas las líneas. **En EasyPanel eso no
sirve**: los contenedores no son localhost. Hay que sustituirlo por la red de
Docker o el nombre del servicio antes de aplicarlo.

Y correr `pnpm check:grants` **aunque nunca se haya aplicado el fichero**: detecta
si alguna versión anterior dejó usuarios con las contraseñas de ejemplo, que están
publicadas en este repositorio.

### 3. Confirmar el motor de la base

Desarrollo va sobre **MariaDB 10.4**. EasyPanel puede dar MySQL 8. No es un
detalle: las diferencias de colación ya causaron un problema real (#12), y el
particionado de #47 tiene sintaxis que difiere entre los dos.

```sql
SELECT VERSION();
```

Si es MySQL 8, hay que correr el simulacro de restauración (`pnpm
backup:verificar`) contra esa base antes de confiar en los respaldos.

---

## Los dos servicios

El proyecto son **dos aplicaciones separadas** más la base. En EasyPanel, tres
servicios.

| servicio | puerto | Dockerfile | expuesto a internet |
|---|---|---|---|
| `asta-middleware` | 3001 | `apps/middleware/Dockerfile` | **no** |
| `asta-web` | 3000 | `apps/web/Dockerfile` | sí |
| MySQL | 3306 | (servicio de EasyPanel) | **no** |

**El middleware no debe publicarse.** El navegador nunca habla con él: todo pasa
por el servidor de Next, que es lo que mantiene el token de sesión fuera del
cliente y evita CORS. Publicarlo añade una superficie de ataque sin ganar nada.

En los dos servicios:

- **Build context**: la raíz del repositorio, no la carpeta de la app.
- **Dockerfile path**: el de la tabla.

Es un monorepo de pnpm: el build necesita ver el workspace entero.

---

## Variables de entorno

### `asta-middleware`

```bash
NODE_ENV=production
PORT=3001

# Base. En produccion DEBE ser asta_app, no root (#44).
# Ojo con los caracteres especiales: en un DSN la @ separa credenciales de host,
# asi que "Clave2015@" se escribe "Clave2015%40".
DATABASE_URL=mysql://asta_app:<CLAVE>@<host-mysql>:3306/asta

# Odoo. La clave es la API key ROTADA, no la del chat.
ODOO_URL=https://supricom2.odoo.com
ODOO_DB=supricom-prod1-25424683
ODOO_USERNAME=webmaster02@supricom.com.ve
ODOO_PASSWORD=<API KEY NUEVA>

# Secretos propios. Generar con: openssl rand -base64 48
JWT_SECRET=<48 bytes al azar>
API_KEY_PEPPER=<48 bytes al azar>
# API_KEY_PEPPER_ANTERIOR solo durante una rotación: docs/08-ROTACION-PEPPER.md

# De donde acepta peticiones el panel.
WEB_APP_ORIGIN=https://<dominio-del-panel>

# IMPORTANTE, ver abajo.
TRUSTED_PROXIES=<red de Docker o numero de saltos>

LOG_LEVEL=info
```

Y en **Build arguments** del servicio, no entre las variables de entorno:

```bash
VERSION_SHA=<sha corto del commit que se construye>
```

No es obligatorio: sin él `/health` informa igual de la fecha del build. Con él
dice además el commit exacto.

### `asta-web`

```bash
NODE_ENV=production
PORT=3000

# Nombre del servicio en la red interna de EasyPanel, NO un dominio publico.
MIDDLEWARE_URL=http://asta-middleware:3001
```

---

## `TRUSTED_PROXIES`: la que se va a olvidar

Por defecto vale `loopback`, que es la topología de desarrollo. **En Docker eso
es incorrecto** y tiene dos consecuencias:

1. La pantalla de sesiones activas (#52) mostrará la IP del contenedor de Next
   para todas las sesiones, en vez de la de cada persona. La pantalla existe
   justo para reconocer un acceso que no es tuyo, y así no sirve.
2. Los registros de auditoría de accesos cruzados guardarán la IP del proxy.
   Cuando haga falta saber de dónde vino un intento, no estará.

Lo que hay que poner depende de la topología de EasyPanel. Lo más simple y
razonable es el número de saltos hasta el cliente:

```bash
TRUSTED_PROXIES=1   # si solo el proxy de EasyPanel está delante
TRUSTED_PROXIES=2   # si además hay un CDN
```

**No poner `TRUSTED_PROXIES=true`.** Eso hace que el middleware se crea el
`X-Forwarded-For` de cualquiera, y entonces la IP registrada la elige quien
llama. Para un sistema cuyo registro de auditoría es media defensa (#44), eso es
peor que no tener el dato.

Para comprobar que quedó bien: entrar al panel y mirar `/cuenta/sesiones`. Si sale
tu IP real, está bien; si sale una `10.x` o `172.x`, el número de saltos está
corto.

---

## Orden de arranque

### Desde la consola del contenedor del middleware

El directorio de trabajo es `/app/apps/middleware`, así que las rutas son:

```bash
# Aplicar el esquema (con credenciales del MIGRADOR, no las de la app)
DATABASE_URL="mysql://asta_migrador:CLAVE@HOST:3306/asta"   ./node_modules/.bin/prisma migrate deploy --schema ../../prisma/schema.prisma

# Poner la contraseña del SuperAdmin
node dist/cli/set-password.js webmaster02@supricom.com.ve

# Traer los clientes desde Odoo
node dist/cli/sync-partners.js --completo

# Dar de alta a los vendedores (#81). SIN --aplicar no escribe nada: enseña
# la lista de quién tendría acceso y por qué, que es lo que hay que leer antes.
node dist/cli/sync-vendedores.js
node dist/cli/sync-vendedores.js --aplicar

# Propagar las bajas de Odoo (#89). Tambien simulacro por defecto.
node dist/cli/sync-partners.js --bajas
node dist/cli/sync-partners.js --bajas --aplicar
```

**El orden importa**: `sync-vendedores` va DESPUÉS de `sync-partners`. Casi
ningún vendedor se crea de cero —ya está como cliente y lo que hace es subirle el
rol—, así que al revés se crearían fichas sueltas que luego chocan con las del
sync de clientes.

Y las cuentas resultantes **no tienen contraseña**: el propio comando lista al
final quién no puede entrar todavía. Cada una necesita un `set-password` o una
invitación desde el panel.

```
1. MySQL arriba y accesible
2. Aplicar el esquema:
     pnpm migrate:deploy          (como asta_migrador, NO como asta_app)
     mysql ... < db/mysql/002_seed.sql
3. Crear los usuarios:
     mysql ... < db/mysql/004_usuarios.sql
     pnpm check:grants
4. Desplegar asta-middleware  → comprobar /health
5. Desplegar asta-web         → entrar al panel
6. Poner la contraseña del SuperAdmin:
     tsx src/cli/set-password.ts webmaster02@supricom.com.ve
```

**El paso 6 no es opcional.** `002_seed.sql` crea el SuperAdmin **sin
contraseña**, a propósito: un hash de ejemplo en un fichero versionado acaba en
producción porque nadie se acuerda de cambiarlo. Sin este paso no entra nadie.

Las migraciones **no** se aplican al arrancar el contenedor, también a propósito:
eso le daría DDL a la aplicación, que es justo lo que evita `asta_app`.

---

## Comprobar que funciona

```bash
curl https://<dominio>/api/v1/... # el middleware NO está expuesto; se prueba desde dentro
```

Desde dentro del contenedor del middleware, o desde el de Next:

```bash
curl http://asta-middleware:3001/health
```

Tiene que decir `"status":"ok"` con `odoo.ok` y `mysql.ok` en `true`. Si dice
`degraded`, el cuerpo indica cuál de las dos falla y por qué.

Luego, en el navegador: entrar al panel, abrir un cliente, y mirar
`/cuenta/sesiones` para confirmar la IP (ver arriba).

---

## Saber qué build está corriendo

```bash
curl -s http://asta-middleware:3001/health | jq .version
```

```json
{ "sha": "559cb0d", "construido": "2026-09-15T19:15:09.921Z" }
```

`construido` es la fecha del bundle y **sale sin configurar nada**. `sha` solo
aparece si el build recibió `VERSION_SHA`.

**Los dos servicios se despliegan juntos.** El panel y el middleware van al
mismo paso: una pantalla nueva necesita su ruta en el API, así que subir solo la
web deja secciones que contestan «No existe la ruta». Antes de dar por bueno un
despliegue, comparar esta fecha con la del último commit que se quería subir.

---

## Si algo falla

**Una sección del panel dice «No existe la ruta GET /api/v1/...».** El
middleware es de una imagen anterior a esa pantalla. Mirar `/health` (arriba) y
reconstruir `asta-middleware`. No hay que tocar la base: los permisos viven en
el código, no en tablas.

**El contenedor del middleware reinicia en bucle.** Mirar los primeros renglones
del log: si faltan variables de entorno, `exigirEntornoValido()` las lista todas
de una vez y sale con código 1 (#9). No hay que adivinar cuál falta.

**`Can't reach database server`.** El `DATABASE_URL` apunta a `localhost` en vez
de al nombre del servicio de MySQL, o la contraseña lleva un carácter especial
sin codificar.

**El panel carga pero todo da error.** `MIDDLEWARE_URL` mal puesto. Tiene que ser
el nombre del servicio en la red interna, no un dominio público.

**Entra al panel y lo echa al login.** La sesión existe pero el middleware la
rechaza. Lo más probable: `JWT_SECRET` distinto del que firmó, porque se
regeneró el servicio.

**`prisma: Error: Unable to require libquery_engine`.** Falta `openssl` en la
imagen. Los dos Dockerfiles ya lo instalan; si aparece, es que se cambió la
imagen base.

**El build falla con `EPERM: symlink`.** Eso solo pasa en Windows, no en el
contenedor. Si sale en EasyPanel, algo raro hay con el runner.
