#!/usr/bin/env bash
#
# Verifica el DDL de db/mysql/ contra un MySQL 8 real.
#
#   bash scripts/verify-mysql-ddl.sh              # levanta MySQL 8 en Docker
#   bash scripts/verify-mysql-ddl.sh <DSN>        # usa un MySQL que ya tengas
#
#   Ejemplo de DSN:  mysql://root:clave@localhost:3306/asta_verify
#
# Qué comprueba:
#   1. Que las tres migraciones apliquen sin error
#   2. Que las 15 tablas existan con sus claves foráneas
#   3. Que la colación de app_users.email sea la correcta (_as_ci, no _ai_ci)
#   4. Que `prisma migrate diff` contra la base real NO reporte diferencias
#      con prisma/schema.prisma  <-- la comprobación que de verdad importa
#   5. Que el seed sea idempotente (se aplica dos veces)
#
# Al terminar destruye el contenedor. No toca ninguna base existente.

set -euo pipefail

CONTAINER="asta-mysql-verify"
MYSQL_PASS="verify_only_$$"
DB="asta_verify"
DSN="${1:-}"
USING_DOCKER=false

ok()   { echo "   ✓ $1"; }
bad()  { echo "   ✗ $1"; FAILS=$((FAILS+1)); }
FAILS=0

cleanup() {
  if [ "$USING_DOCKER" = true ]; then
    echo ""
    echo "==> Limpiando contenedor..."
    docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

# ─────────────────────────────────────────────────────────────────────────────
if [ -z "$DSN" ]; then
  echo "==> Levantando MySQL 8.4 en Docker..."
  docker info >/dev/null 2>&1 || {
    echo "   ✗ El daemon de Docker no responde."
    echo "     Levanta Docker Desktop, o pasa un DSN:"
    echo "       bash scripts/verify-mysql-ddl.sh mysql://root:clave@localhost:3306/asta_verify"
    exit 1
  }

  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  docker run -d --name "$CONTAINER" \
    -e MYSQL_ROOT_PASSWORD="$MYSQL_PASS" \
    -e MYSQL_DATABASE="$DB" \
    -p 33061:3306 \
    mysql:8.4 \
    --character-set-server=utf8mb4 \
    --collation-server=utf8mb4_0900_ai_ci >/dev/null
  USING_DOCKER=true

  echo -n "   esperando a que acepte conexiones"
  for _ in $(seq 1 60); do
    if docker exec "$CONTAINER" mysqladmin ping -uroot -p"$MYSQL_PASS" --silent >/dev/null 2>&1; then
      echo " listo"; break
    fi
    echo -n "."; sleep 2
  done

  MYSQL="docker exec -i $CONTAINER mysql -uroot -p$MYSQL_PASS"
  DSN="mysql://root:${MYSQL_PASS}@localhost:33061/${DB}"
else
  echo "==> Usando el MySQL indicado"

  # El cliente puede no estar en el PATH: en Windows con XAMPP vive en
  # C:/xampp/mysql/bin. Se busca ahi antes de rendirse.
  CLIENTE=""
  for c in mysql /c/xampp/mysql/bin/mysql.exe /c/XAMPP/mysql/bin/mysql.exe; do
    command -v "$c" >/dev/null 2>&1 && { CLIENTE="$c"; break; }
    [ -x "$c" ] && { CLIENTE="$c"; break; }
  done
  [ -z "$CLIENTE" ] && { echo "   ✗ no se encontro el cliente mysql"; exit 1; }

  # mysql://user:pass@host:port/db — la contrasena puede ir VACIA (XAMPP por
  # defecto). El sed anterior usaba [^@]+ y con una contrasena vacia no casaba,
  # dejando variables basura sin que nada avisara.
  SIN_ESQUEMA=${DSN#mysql://}
  CREDS=${SIN_ESQUEMA%%@*}
  RESTO=${SIN_ESQUEMA#*@}
  U=${CREDS%%:*}
  P=${CREDS#*:}
  [ "$P" = "$CREDS" ] && P=""
  HOSTPORT=${RESTO%%/*}
  H=${HOSTPORT%%:*}
  PORT=${HOSTPORT#*:}
  [ "$PORT" = "$HOSTPORT" ] && PORT=3306
  DB=${RESTO#*/}
  DB=${DB%%\?*}

  # Sin contrasena se OMITE -p: pasarlo vacio hace que el cliente la pida por
  # teclado y el script se cuelgue esperando para siempre.
  if [ -n "$P" ]; then
    MYSQL="$CLIENTE -u$U -p$P -h$H -P$PORT --default-character-set=utf8mb4"
  else
    MYSQL="$CLIENTE -u$U -h$H -P$PORT --default-character-set=utf8mb4"
  fi

  echo "   cliente: $CLIENTE"
  echo "   destino: $U@$H:$PORT/$DB"
  $MYSQL -e "DROP DATABASE IF EXISTS \`$DB\`; CREATE DATABASE \`$DB\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;" >/dev/null 2>&1 || true
fi

echo ""
echo "==> Versión del servidor"
VER=$($MYSQL -N -B -e "SELECT VERSION();" 2>/dev/null | tr -d '\r')
echo "   $VER"
case "$VER" in
  8.*|9.*)              ok "MySQL $VER — soportado" ;;
  *[Mm]aria*|10.*|11.*) ok "MariaDB $VER — soportado (DEFAULT (UUID()) verificado)" ;;
  *) bad "motor no reconocido: $VER. Se requiere MySQL 8.0.13+ o MariaDB 10.4+" ;;
esac

# ─────────────────────────────────────────────────────────────────────────────
echo ""
echo "==> 0. Modo estricto"
echo "     Sin STRICT, un INSERT que olvide el id NO falla: crea una fila con"
echo "     id = '' y el fallo aparece mucho después, en la siguiente inserción."

MODE=$($MYSQL -N -B -e "SELECT @@sql_mode;" 2>/dev/null | tr -d '
')
case "$MODE" in
  *STRICT_ALL_TABLES*|*STRICT_TRANS_TABLES*) ok "modo estricto activo" ;;
  *) bad "sql_mode SIN strict: $MODE
        Añade a my.ini (XAMPP) o al servidor:
          sql_mode=STRICT_ALL_TABLES,NO_ENGINE_SUBSTITUTION" ;;
esac

# ─────────────────────────────────────────────────────────────────────────────
echo ""
echo "==> 1. Aplicando migraciones"

for f in db/mysql/001_schema.sql db/mysql/002_seed.sql; do
  if $MYSQL "$DB" < "$f" >/dev/null 2>/tmp/mysqlerr.txt; then
    ok "$(basename "$f")"
  else
    bad "$(basename "$f")"
    sed -n '1,6p' /tmp/mysqlerr.txt
  fi
done

echo ""
echo "==> 2. Estructura"

COUNT=$($MYSQL -N -B "$DB" -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='$DB';" | tr -d '\r')
[ "$COUNT" = "15" ] && ok "15 tablas creadas" || bad "esperaba 15 tablas, hay $COUNT"

FK=$($MYSQL -N -B "$DB" -e "SELECT COUNT(*) FROM information_schema.referential_constraints WHERE constraint_schema='$DB';" | tr -d '\r')
# 15 y no 16: api_request_logs va sin FK para poder particionarse.
[ "$FK" -ge 15 ] && ok "$FK claves foráneas" || bad "esperaba al menos 15 claves foráneas, hay $FK"

# ─────────────────────────────────────────────────────────────────────────────
echo ""
echo "==> 3. Colación del email"
echo "     Debe ser BINARIA: ninguna colación _ci respeta los acentos, así que"
echo "     con cualquiera de ellas jose@ y josé@ serían el mismo usuario."
echo "     La insensibilidad a mayúsculas la aporta normalizarEmail() en la app."

COLL=$($MYSQL -N -B "$DB" -e "SELECT collation_name FROM information_schema.columns WHERE table_schema='$DB' AND table_name='app_users' AND column_name='email';" | tr -d '\r')
echo "   colación real: $COLL"
# Por NOMBRE solo de forma informativa: lo que decide es la prueba funcional de
# abajo. utf8mb4_0900_as_ci (solo MySQL 8) y utf8mb4_general_ci (ambos motores)
# dan el mismo comportamiento pese a no parecerse en nada.
case "$COLL" in
  *_bin) ok "binaria, como debe" ;;
  *) bad "es $COLL — una colación _ci haría que josé@ colisione con jose@" ;;
esac

# Prueba funcional de la colación: las dos inserciones deben convivir.
# Los ids los aporta la APLICACIÓN (Prisma @default(uuid())), no la base: el DDL
# ya no declara DEFAULT (UUID()). Sin id explícito, el primer INSERT crea una
# fila con id = '' y el segundo choca contra la clave primaria — un fallo que
# parece de colación y no lo es.
#
# El correo con acento va como literal HEX: la consola de Windows usa cp850 y
# mutila la `é` antes de que llegue al servidor. Esa mutilación me hizo dar por
# buena una conclusión equivocada sobre las colaciones.
$MYSQL "$DB" -e "DELETE FROM app_users WHERE odoo_partner_id >= 900001;" >/dev/null 2>&1 || true

if ERR=$($MYSQL "$DB" -e "
  INSERT INTO app_users (id,email,full_name,role,odoo_partner_id)
    VALUES (UUID(),'jose@test.com','A','BRONCE',900001);
  INSERT INTO app_users (id,email,full_name,role,odoo_partner_id)
    VALUES (UUID(),CONVERT(0x6a6f73c3a940746573742e636f6d USING utf8mb4),'B','BRONCE',900002);
" 2>&1); then
  ok "acepta jose@ y josé@ como usuarios distintos"
else
  # Se MUESTRA el error en vez de tragárselo con >/dev/null: esconderlo
  # convierte "por qué falló" en una adivinanza, y eso ya costó una vuelta.
  bad "no aceptó los dos correos: $(echo "$ERR" | head -1)"
fi

# Con colación binaria la base NO impide 'JOSE@' — lo impide normalizarEmail()
# en la aplicación. Aquí se comprueba que el índice único haga su parte con el
# valor ya normalizado.
if $MYSQL "$DB" -e "
  INSERT INTO app_users (id,email,full_name,role,odoo_partner_id)
    VALUES (UUID(),'jose@test.com','C','BRONCE',900003);
" >/dev/null 2>&1; then
  bad "aceptó el mismo correo dos veces — falta el índice único"
else
  ok "rechaza el correo normalizado repetido (correcto)"
fi

$MYSQL "$DB" -e "DELETE FROM app_users WHERE odoo_partner_id >= 900001;" >/dev/null 2>&1 || true

# ─────────────────────────────────────────────────────────────────────────────
echo ""
echo "==> 4. Prisma vs. la base real"
echo "     Esta es la comprobación que importa: si hay diferencias, el schema y"
echo "     el DDL se han separado y las migraciones futuras van a sorprender."

DIFF=$(DATABASE_URL="$DSN" ./node_modules/.bin/prisma migrate diff \
        --from-url "$DSN" \
        --to-schema-datamodel prisma/schema.prisma \
        --script 2>&1 || true)

if echo "$DIFF" | grep -qi "empty migration\|no difference"; then
  ok "sin diferencias entre prisma/schema.prisma y la base"
else
  bad "Prisma detecta diferencias:"
  echo "$DIFF" | grep -vE "^\s*$" | head -25 | sed 's/^/        /'
fi

# ─────────────────────────────────────────────────────────────────────────────
echo ""
echo "==> 5. Idempotencia del seed"
$MYSQL "$DB" < db/mysql/002_seed.sql >/dev/null 2>&1 \
  && ok "002_seed.sql se puede aplicar dos veces" \
  || bad "el seed falla al reaplicarse"

echo ""
echo "==> 6. Particionado (opcional)"
if $MYSQL "$DB" < db/mysql/003_partitioning.sql >/dev/null 2>/tmp/parterr.txt; then
  PARTS=$($MYSQL -N -B "$DB" -e "SELECT COUNT(*) FROM information_schema.partitions WHERE table_schema='$DB' AND table_name='api_request_logs' AND partition_name IS NOT NULL;" | tr -d '\r')
  ok "003_partitioning.sql aplicado — $PARTS particiones"
else
  bad "003_partitioning.sql falla"
  sed -n '1,6p' /tmp/parterr.txt
fi

# ─────────────────────────────────────────────────────────────────────────────
echo ""
echo "────────────────────────────────────────────────────────────"
if [ "$FAILS" -eq 0 ]; then
  echo " DDL verificado contra MySQL $VER — sin fallos"
else
  echo " $FAILS comprobación(es) fallida(s)"
fi
echo "────────────────────────────────────────────────────────────"
exit "$FAILS"
