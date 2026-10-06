# Respaldos y restauración — ASTA

Un respaldo no probado no es un respaldo, es una suposición. Por eso aquí hay
tres cosas y no una: hacer la copia, **restaurarla**, y lo que la copia no lleva.

```bash
./db/backup/respaldar.sh                       # copia de MySQL
./db/backup/restaurar.sh copia.sql.gz destino  # restaurar una
pnpm backup:verificar                          # SIMULACRO: copia, restaura y compara
pnpm backup:odoo                               # copia de la configuración de tarifas
```

---

## El simulacro es lo que importa

`pnpm backup:verificar` hace el viaje entero contra la base de verdad: vuelca,
restaura en una base desechable, **compara las dos** y la borra.

No compara solo el número de filas. Cada comprobación corresponde a algo que un
volcado mal hecho pierde **en silencio**:

| Se compara | Qué se pierde sin ello |
|---|---|
| rutinas | `mysqldump` no las incluye sin `--routines`. Los procedimientos de mantenimiento de #47 desaparecen |
| colaciones | `app_users.email` es `utf8mb4_bin`. Con una `_ci`, dos personas distintas no pueden tener cuenta |
| particiones | el particionado de `api_request_logs` |
| primarias | la compuesta `(id, created_at)` que exige el particionado |
| filas por tabla | lo obvio, con `COUNT(*)` y no con la estimación de `information_schema`. Incluye `_prisma_migrations`: sin su historial, el siguiente `migrate deploy` sobre lo restaurado intentaría `0_init` |
| columnas | tipo, nulos, valor por defecto y `AUTO_INCREMENT` |
| índices | todos, no solo la primaria, y si son únicos: un token que deja de ser único deja de proteger |
| foráneas | con su `ON DELETE`: un `CASCADE` que se pierde deja filas huérfanas |
| checks | el `json_valid` con que MariaDB implementa `JSON`, y los que vengan |

Las cuatro últimas se añadieron el 2026-10-01, cuando el esquema ya tenía 26
tablas con claves foráneas, tokens únicos y restricciones. Comprobado que
detectan: saboteando lo restaurado antes de comparar (quitar
`fk_auth_tokens_user`, volver no único `uq_auth_tokens_hash`, quitar el `CHECK`
de `sync_state.resumen`) el simulacro saca las tres.

Si el origen no tiene rutinas o particiones —desarrollo no tiene `003`
aplicado—, el simulacro lo dice: esas comparaciones pasan sin comprobar nada, y
un verde así no vale para producción.

Está comprobado que **detecta**, no solo que aprueba. Quitando `--routines` del
volcado, el simulacro saca:

```
2 DIFERENCIAS entre el original y lo restaurado:
  · rutinas: falta PROCEDURE:sp_cleanup_expired
  · rutinas: falta PROCEDURE:sp_rotate_api_log_partitions
```

y cambiando a mano la colación del email en lo restaurado:

```
· colaciones: app_users.email era utf8mb4_bin y quedó utf8mb4_general_ci
```

---

## RTO — cuánto se tarda en volver

Medido sobre la base de desarrollo:

| | 2026-09-14 | 2026-10-01 |
|---|---|---|
| tablas | 18 | 26 |
| filas | 3.142 | 7.652 |
| volcado | 0,8 MB · 0,2 s | 1,5 MB · 0,4 s |
| restauración | 0,6 s | 0,9 s |
| **RTO de base de datos** | **~1 s** | **1,3 s** |

**Ese número es sincero pero incompleto**, y conviene no citarlo suelto. Es solo
la parte de base de datos. El día malo hay que además:

1. Localizar y descargar el fichero de respaldo.
2. Tener un MySQL en pie donde restaurar.
3. **Reaplicar `db/mysql/004_usuarios.sql`** — el respaldo no lleva los usuarios.
4. Apuntar el middleware a la base nueva y levantarlo.

Con 3.142 filas la base tarda un segundo; los cuatro pasos de arriba no. El RTO
real es el de esos pasos, y hasta que no se ensaye el procedimiento completo en
EasyPanel no hay un número honesto que dar.

Cuando la base crezca, volver a medir: el tiempo de restauración crece con los
datos, y un número de hace un año no sirve para planificar.

## RPO — cuántos datos se acepta perder

**Decidido el 2026-10-01: hasta 1 hora.** Un respaldo cada hora.

Lo que se perdería en el peor caso, la hora anterior al desastre:

- Las **notas de los vendedores** escritas en esa hora. Se pierden de verdad:
  solo existen aquí.
- Las **revisiones de compatibilidades** de esa hora: validar o rechazar
  propuestas (#56). Hay que repetirlas.
- Las **sesiones** abiertas. Molesto, no grave: la gente vuelve a entrar.
- La **facturación no se pierde**: vive en Odoo, no aquí. El panel la lee en
  vivo. Esto es lo que hace que el RPO de ASTA sea mucho menos crítico de lo que
  parece: lo que guardamos es lo operativo del panel, no la contabilidad.

Por debajo de una hora habría que hablar de binlogs y recuperación a un punto en
el tiempo, que es bastante más caro de operar. No compensa con lo que hay en
juego.

---

## Lo que el respaldo NO lleva

**Los usuarios de MySQL y sus permisos.** Viven en la base `mysql`, no en
`asta`, así que un volcado de esquema no los incluye. Restaurar en un servidor
nuevo deja las tablas y los datos en su sitio, y la aplicación sin poder
conectarse.

No se vuelcan a propósito: un volcado de `mysql.user` lleva los hashes de todas
las contraseñas del servidor, y eso convertiría cada respaldo en un objetivo
mucho más goloso. Se resuelve reaplicando `db/mysql/004_usuarios.sql`, que está
versionado y tarda un segundo.

`restaurar.sh` lo recuerda al terminar, porque es justo lo que se olvida con
prisa.

---

## Montarlo en el servidor

### 1. Fichero de credenciales

La contraseña **no** se pasa por línea de comandos: cualquiera con acceso a la
máquina la ve en `ps`.

```bash
cat > ~/.asta-backup.cnf <<'EOF'
[client]
user=asta_migrador
password=LA_CLAVE
host=localhost
EOF
chmod 600 ~/.asta-backup.cnf
```

Se usa `asta_migrador` y no `asta_app`: `asta_app` no puede leerlo todo, es
justo el punto de #44.

### 2. Cron

```cron
# Respaldo cada hora: el RPO decidido es 1 hora
0 * * * *  ASTA_BACKUP_RETENCION=14 /ruta/asta/db/backup/respaldar.sh >> /var/log/asta-backup.log 2>&1

# Mantenimiento de la base (issue #47)
0 4 * * *  mysql --defaults-extra-file=$HOME/.asta-backup.cnf asta -e "CALL sp_cleanup_expired()"
0 4 1 * *  mysql --defaults-extra-file=$HOME/.asta-backup.cnf asta -e "CALL sp_rotate_api_log_partitions()"

# Configuración de Odoo, semanal: cambia poco y son ~1 MB comprimidos
0 5 * * 0  cd /ruta/asta && pnpm backup:odoo
```

Variables que reconoce `respaldar.sh`: `ASTA_DB`, `ASTA_BACKUP_DIR`,
`ASTA_BACKUP_RETENCION` (días, 14 por defecto), `MYSQL_DEFAULTS_FILE`.

Con una copia por hora y 14 días son 336 ficheros. A los tamaños de hoy, unos
70 MB comprimidos: asumible, pero hay que vigilarlo cuando crezcan los logs. El
nombre lleva fecha y hora al segundo, así que dos copias no se pisan.

### En producción: los respaldos de EasyPanel, fuera del servidor

**Decidido el 2026-10-06:** los respaldos programados del propio EasyPanel, con
destino fuera del servidor. Ya existen, ya saben volcar MySQL y desde la v2.36
llevan de serie Backblaze B2, Cloudflare R2, S3, Google Drive, Dropbox y SFTP
(Ajustes → Proveedores de almacenamiento). Un contenedor con `respaldar.sh`
sería un servicio más que mantener para hacer lo mismo.

Lo que no sabemos de ellos —con qué banderas vuelcan— lo contesta el ensayo de
restauración de abajo, no una suposición.

#### Lo que había el 2026-10-06

En `dashboard` → `database` → Copias de seguridad, la copia de la base `Asta`
estaba **habilitada pero sin programación** («Ejecución manual»), hacia «Local
Disk». Había **una sola copia**: la manual del 1 de octubre, 218 kB. Es decir:
cinco días sin respaldo, y el único que había vivía en el mismo disco que la
base. Si se pierde el servidor, se pierden los dos.

#### Montarlo (lo hace una persona: lleva claves)

1. **Crear el almacenamiento.** Backblaze B2 es lo más directo: los primeros
   10 GB son gratis y no pide tarjeta para empezar. (Cloudflare R2 también vale,
   pero exige dar de alta un medio de pago aunque no se pase del gratuito.)
   - Crear un *bucket* **privado**, por ejemplo `supricom-asta-copias`.
   - Crear una *Application Key* **solo para ese bucket**, con lectura y
     escritura. Guardar el `keyID` y la `applicationKey`: la segunda solo se ve
     una vez.
2. **Darlo de alta en EasyPanel.** Ajustes → Proveedores de almacenamiento →
   Crear → Backblaze B2, con el bucket y la clave. Nombre: `B2 copias`.
3. **Programar las copias de `Asta`.** `dashboard` → `database` → Copias de
   seguridad:
   - Editar la que hay: programación **Cada hora**, proveedor **B2 copias**,
     ruta `asta/horaria`, retención **48** (dos días de copias horarias). Es el
     RPO de 1 hora decidido arriba.
   - Crear otra: programación **Todos los días a las 2:00**, proveedor
     **B2 copias**, ruta `asta/diaria`, retención **30**. Las horarias cubren
     el error de hace un rato; las diarias, el que se descubre a las tres
     semanas.
4. **Comprobarlo al día siguiente.** En «Registros de copias de seguridad» tiene
   que haber una copia por hora con *Success*, y en el bucket de B2, los
   ficheros `.sql.gz` en las dos rutas.

A los tamaños de hoy (cientos de kB por copia) son unos pocos MB en total: muy
lejos de los 10 GB gratuitos. Vigilar cuando crezca `api_request_logs`.

#### El ensayo de restauración (sin tocar `Asta`)

Nunca se restaura encima de `Asta` para probar. El ensayo va a una base aparte,
en el mismo MySQL, y se borra al acabar. Desde **Bash** del servicio
`dashboard/database` (el prompt es `bash-5.1#`):

```bash
# 1. Base desechable
mysql -uroot -p"$MYSQL_ROOT_PASSWORD" -e "CREATE DATABASE asta_ensayo"

# 2. Traer la copia de B2 y restaurarla en la base de ensayo. El enlace es el de
#    descarga temporal que da la web de B2 (Browse Files → el fichero).
wget -O /tmp/copia.sql.gz 'ENLACE_DE_DESCARGA_DE_B2'
time (gunzip -c /tmp/copia.sql.gz | mysql -uroot -p"$MYSQL_ROOT_PASSWORD" asta_ensayo)

# 3. Comparar con Asta: tablas, rutinas, migraciones y filas de lo que solo vive aquí
for db in Asta asta_ensayo; do
  echo "== $db"
  mysql -uroot -p"$MYSQL_ROOT_PASSWORD" -N -e "
    SELECT 'tablas', COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA='$db';
    SELECT 'rutinas', COUNT(*) FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA='$db';
    SELECT 'migraciones', COUNT(*) FROM $db._prisma_migrations;
    SELECT 'usuarios', COUNT(*) FROM $db.app_users;
    SELECT 'notas', COUNT(*) FROM $db.client_notes;
    SELECT 'compatibilidades', COUNT(*) FROM $db.cartridge_printer_models;"
done

# 4. Borrar la base de ensayo y la copia descargada
mysql -uroot -p"$MYSQL_ROOT_PASSWORD" -e "DROP DATABASE asta_ensayo"
rm /tmp/copia.sql.gz
```

Las cifras de las dos bases tienen que coincidir, salvo lo escrito después de
la hora de la copia. Si `rutinas` da menos en el ensayo, la copia de EasyPanel
no lleva `--routines` y hay que saberlo **antes** del día malo. El `time` del
paso 2 es la parte de base de datos del RTO: se apunta en la tabla de arriba.
Si `wget` no está en la imagen de MySQL, el primer ensayo se hace acompañado y
se anota aquí cómo se trajo el fichero.

Repetirlo cada tres meses, y siempre después de cambiar algo de las copias.

### 3. El simulacro, de verdad y cada cierto tiempo

Un respaldo que nadie ha restaurado nunca es una suposición, por muy verde que
salga el cron. `pnpm backup:verificar` está para ejecutarse, no para existir.

---

## Configuración de Odoo

`pnpm backup:odoo` guarda las tarifas, sus ~35.000 reglas de precio y cuántos
clientes cuelga de cada una.

**No sustituye a los respaldos de Odoo**, que los hace Odoo porque es SaaS.
Resuelve otra cosa, más probable y peor de detectar: que alguien cambie una
tarifa y nadie sepa cuál era antes. El nivel de un cliente se deriva de su
tarifa (#3), así que una tarifa tocada cambia los precios que ve un cliente por
la API sin tocar una línea de nuestro código. Restaurar Odoo entero por eso no
es realista; tener una copia fechada y comparar, sí.

### Ver qué cambió

```bash
pnpm backup:odoo --diff                        # las dos copias más recientes
pnpm backup:odoo --diff vieja.json.gz nueva.json.gz
```

Antes aquí ponía `diff <(gzip -dc ... | jq -S .)`. **No servía**, por dos
razones. `jq` no está instalado en la máquina de desarrollo, así que la
instrucción no funcionaba donde se iba a usar. Y aunque lo estuviera, son 35.000
reglas de precio: un `diff` textual de eso escupe miles de líneas por un solo
precio cambiado y entierra lo que se busca. Un respaldo que solo se puede
comparar a ojo es un respaldo que nadie compara.

La comparación ordena por lo que cuesta dinero:

```
  ── CLIENTES QUE CAMBIARON DE TARIFA ───────────────────────────────

    [15866 ] Lista de Precios                      2949 →  1200  (-1749)
    [15869 ] Lista de Precios Vendedores              0 →  1749  (+1749)

  ── TARIFAS MODIFICADAS ────────────────────────────────────────────

    [15836] Supricom S.A - Lista USD
        active: sí → no

  ── REGLAS DE PRECIO ───────────────────────────────────────────────

    1 nuevas · 3 retiradas · 2 modificadas

    [42614] Lista de precios VEF (VEF) · 4534C001AA
        fixed_price: 0 → 999.99
```

**Los clientes que cambian de tarifa van primero** porque es lo único de aquí
que altera lo que un cliente paga, y nadie avisa cuando pasa: se mueven clientes
en Odoo y la API pública empieza a devolver otros precios.

De las reglas solo se detallan las **modificadas**. Una regla nueva o retirada se
entiende con el recuento; una modificada es la que esconde el cambio de precio.

Sale con código 0 aunque haya cambios: cambiar tarifas es una operación normal
del negocio, no un fallo. Si devolviera error, el cron mandaría un aviso cada vez
que alguien toca un precio y en dos semanas no lo leería nadie. Avisar de lo que
merece la pena es trabajo de `pnpm alertas` (#46).

Incluye las tarifas **archivadas** a propósito: archivar una tarifa es
precisamente uno de los cambios que se querría poder deshacer. Y archivar se
distingue de borrar — en Odoo lo normal es archivar, así que una tarifa que
DESAPARECE significa que alguien la borró de verdad.

Los ficheros van a la carpeta de respaldos, nunca al repositorio: llevan precios
reales.
