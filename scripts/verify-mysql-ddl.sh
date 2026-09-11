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
  command -v mysql >/dev/null || { echo "   ✗ falta el cliente mysql en el PATH"; exit 1; }
  # mysql://user:pass@host:port/db
  U=$(echo "$DSN" | sed -E 's|mysql://([^:]+):.*|\1|')
  P=$(echo "$DSN" | sed -E 's|mysql://[^:]+:([^@]+)@.*|\1|')
  H=$(echo "$DSN" | sed -E 's|.*@([^:/]+).*|\1|')
  PORT=$(echo "$DSN" | sed -E 's|.*:([0-9]+)/.*|\1|')
  DB=$(echo "$DSN" | sed -E 's|.*/([^?]+).*|\1|')
  MYSQL="mysql -u$U -p$P -h$H -P$PORT"
fi

echo ""
echo "==> Versión del servidor"
VER=$($MYSQL -N -B -e "SELECT VERSION();" 2>/dev/null | tr -d '\r')
echo "   $VER"
case "$VER" in
  8.*|9.*) ok "versión soportada" ;;
  *) bad "se requiere MySQL 8.0.13+ (DEFAULT (UUID()) no existe antes)" ;;
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
[ "$FK" -ge 16 ] && ok "$FK claves foráneas" || bad "esperaba al menos 16 claves foráneas, hay $FK"

# ─────────────────────────────────────────────────────────────────────────────
echo ""
echo "==> 3. Colación del email"
echo "     Debe ser _as_ci (insensible a mayúsculas, SENSIBLE a acentos)."
echo "     Con la colación por defecto _ai_ci, jose@ y josé@ colisionarían."

COLL=$($MYSQL -N -B "$DB" -e "SELECT collation_name FROM information_schema.columns WHERE table_schema='$DB' AND table_name='app_users' AND column_name='email';" | tr -d '\r')
echo "   colación real: $COLL"
case "$COLL" in
  *_as_ci) ok "correcta" ;;
  *) bad "es $COLL — jose@x.com y josé@x.com se tratarían como el mismo usuario" ;;
esac

# Prueba funcional de la colación: las dos inserciones deben convivir.
$MYSQL "$DB" -e "
  INSERT INTO app_users (email, full_name, role, odoo_partner_id) VALUES ('jose@test.com','A','BRONCE',900001);
  INSERT INTO app_users (email, full_name, role, odoo_partner_id) VALUES ('josé@test.com','B','BRONCE',900002);
" >/dev/null 2>&1 \
  && ok "acepta jose@ y josé@ como usuarios distintos" \
  || bad "rechazó josé@ — la colación ignora acentos"

$MYSQL "$DB" -e "
  INSERT INTO app_users (email, full_name, role, odoo_partner_id) VALUES ('JOSE@test.com','C','BRONCE',900003);
" >/dev/null 2>&1 \
  && bad "acepto JOSE@ como distinto de jose@ — la colación distingue mayúsculas" \
  || ok "rechaza JOSE@ como duplicado de jose@ (correcto)"

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
