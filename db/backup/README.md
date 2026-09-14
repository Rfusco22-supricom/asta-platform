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
| filas por tabla | lo obvio, con `COUNT(*)` y no con la estimación de `information_schema` |

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

Medido el 2026-09-14 sobre la base de desarrollo (18 tablas, 3.142 filas,
0,8 MB de volcado):

| | |
|---|---|
| volcado | 0,2 s |
| restauración | 0,6 s |
| **RTO de base de datos** | **~1 s** |

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

**Sin decidir. Es una decisión de negocio, no técnica.**

Lo que hay hoy implica un RPO igual a la frecuencia del cron: con un respaldo
diario a las 3:00, un desastre a las 2:00 pierde casi un día de trabajo.

Qué se perdería, en concreto:

- Las **notas de los vendedores** escritas desde el último respaldo. Se pierden
  de verdad: solo existen aquí.
- Las **sesiones** abiertas. Molesto, no grave: la gente vuelve a entrar.
- La **facturación no se pierde**: vive en Odoo, no aquí. El panel la lee en
  vivo. Esto es lo que hace que el RPO de ASTA sea mucho menos crítico de lo que
  parece — lo que guardamos es lo operativo del panel, no la contabilidad.

Si un día de notas perdidas es aceptable, un respaldo diario basta. Si no, hay
que hablar de binlogs y recuperación a un punto en el tiempo, que es bastante
más caro de operar.

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
# Respaldo diario a las 3:00
0 3 * * *  /ruta/asta/db/backup/respaldar.sh >> /var/log/asta-backup.log 2>&1

# Mantenimiento de la base (issue #47)
0 4 * * *  mysql --defaults-extra-file=$HOME/.asta-backup.cnf asta -e "CALL sp_cleanup_expired()"
0 4 1 * *  mysql --defaults-extra-file=$HOME/.asta-backup.cnf asta -e "CALL sp_rotate_api_log_partitions()"

# Configuración de Odoo, semanal: cambia poco y son ~1 MB comprimidos
0 5 * * 0  cd /ruta/asta && pnpm backup:odoo
```

Variables que reconoce `respaldar.sh`: `ASTA_DB`, `ASTA_BACKUP_DIR`,
`ASTA_BACKUP_RETENCION` (días, 14 por defecto), `MYSQL_DEFAULTS_FILE`.

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
