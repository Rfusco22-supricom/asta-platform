#!/usr/bin/env bash
#
# ASTA — Restauración desde un respaldo · issue #48
#
#   ./db/backup/restaurar.sh <fichero.sql.gz> <base_destino>
#
# Se usa dos veces en la vida de un sistema: en el simulacro y el día malo. En
# el día malo nadie está sereno, así que el script se niega a hacer nada
# ambiguo y dice en voz alta lo que le falta.

set -euo pipefail

DEFAULTS_FILE="${MYSQL_DEFAULTS_FILE:-$HOME/.asta-backup.cnf}"
MYSQL_BIN="${MYSQL_BIN:-mysql}"

ARCHIVO="${1:-}"
BASE="${2:-}"

if [[ -z "$ARCHIVO" || -z "$BASE" ]]; then
  echo "Uso: $0 <fichero.sql.gz> <base_destino>" >&2
  exit 1
fi

[[ -f "$ARCHIVO" ]] || { echo "No existe: $ARCHIVO" >&2; exit 1; }

# ── Antes de tocar nada: ¿el fichero sirve? ──────────────────────────────────
#
# Comprobar la integridad ANTES de vaciar el destino. Al revés —vaciar y luego
# descubrir que el respaldo está corrupto— se pierden las dos copias a la vez.
echo "Comprobando el respaldo..."
gzip -t "$ARCHIVO" || { echo "El gzip está corrupto." >&2; exit 1; }

if ! gzip -dc "$ARCHIVO" | tail -5 | grep -q "Dump completed"; then
  echo "El volcado está INCOMPLETO: le falta la marca de cierre de mysqldump." >&2
  echo "No se restaura. Busca otro respaldo." >&2
  exit 1
fi

if [[ -f "$ARCHIVO.sha256" ]] && command -v sha256sum >/dev/null 2>&1; then
  (cd "$(dirname "$ARCHIVO")" && sha256sum -c "$(basename "$ARCHIVO").sha256") \
    || { echo "La suma de control NO coincide. El fichero cambió." >&2; exit 1; }
fi

# ── Guardia contra restaurar encima de algo vivo ─────────────────────────────
#
# El error que más caro sale aquí no es técnico: es teclear el nombre de la base
# de producción en lugar del de la de prueba. Si el destino tiene tablas, hay que
# decirlo a propósito.
EXISTENTES=$("$MYSQL_BIN" --defaults-extra-file="$DEFAULTS_FILE" -N -e \
  "SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA='$BASE'" 2>/dev/null || echo 0)

if [[ "$EXISTENTES" -gt 0 && "${ASTA_RESTAURAR_ENCIMA:-}" != "si" ]]; then
  echo >&2
  echo "  La base '$BASE' ya tiene $EXISTENTES tablas." >&2
  echo "  Restaurar encima las sobrescribe." >&2
  echo >&2
  echo "  Si es lo que quieres:  ASTA_RESTAURAR_ENCIMA=si $0 $ARCHIVO $BASE" >&2
  echo >&2
  exit 1
fi

"$MYSQL_BIN" --defaults-extra-file="$DEFAULTS_FILE" -e \
  "CREATE DATABASE IF NOT EXISTS \`$BASE\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"

echo "Restaurando en '$BASE'..."
INICIO=$(date +%s)

gzip -dc "$ARCHIVO" | "$MYSQL_BIN" \
  --defaults-extra-file="$DEFAULTS_FILE" \
  --default-character-set=utf8mb4 \
  "$BASE"

FIN=$(date +%s)
echo "Restaurado en $((FIN - INICIO)) s."
echo
echo "FALTA por hacer a mano:"
echo "  1. Reaplicar db/mysql/004_usuarios.sql — el respaldo no lleva los usuarios."
echo "  2. pnpm check:grants   (comprobar los permisos)"
echo "  3. pnpm migrate:status (comprobar que el esquema está al día)"
