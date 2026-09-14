#!/usr/bin/env bash
#
# ASTA — Respaldo de la base MySQL · issue #48
#
#   ./db/backup/respaldar.sh
#
# Pensado para correr desde un cron en el servidor. No pide nada por teclado y
# devuelve 0 solo si el respaldo quedó completo y verificado.
#
# ─────────────────────────────────────────────────────────────────────────────
# Un respaldo no probado no es un respaldo, es una suposición.
#
# Este script hace la mitad fácil. La otra mitad —restaurarlo y comprobar que lo
# restaurado sirve— es `pnpm backup:verificar`, y hay que ejecutarla de verdad
# cada cierto tiempo. Ver db/backup/README.md.
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

# ── Configuración ────────────────────────────────────────────────────────────
#
# La contraseña NO se pasa por línea de comandos: cualquiera con acceso a la
# máquina la ve en `ps`. Se usa un fichero de credenciales con permisos 0600:
#
#   [client]
#   user=asta_migrador
#   password=...
#   host=...
#
# y se apunta aquí con MYSQL_DEFAULTS_FILE.
DEFAULTS_FILE="${MYSQL_DEFAULTS_FILE:-$HOME/.asta-backup.cnf}"
BASE="${ASTA_DB:-asta}"
DESTINO="${ASTA_BACKUP_DIR:-/var/backups/asta}"
RETENCION_DIAS="${ASTA_BACKUP_RETENCION:-14}"
MYSQLDUMP="${MYSQLDUMP_BIN:-mysqldump}"

if [[ ! -f "$DEFAULTS_FILE" ]]; then
  echo "No existe el fichero de credenciales: $DEFAULTS_FILE" >&2
  echo "Créalo con permisos 0600. Ver db/backup/README.md." >&2
  exit 1
fi

mkdir -p "$DESTINO"

# UTC en el nombre. La hora local cambia dos veces al año y ordenar respaldos por
# un nombre que retrocede una hora en octubre es una forma tonta de perder uno.
SELLO="$(date -u +%Y%m%dT%H%M%SZ)"
ARCHIVO="$DESTINO/asta-$SELLO.sql.gz"
TMP="$ARCHIVO.parcial"

echo "Respaldando $BASE → $ARCHIVO"
INICIO=$(date +%s)

# ── Las banderas que importan ────────────────────────────────────────────────
#
# --routines y --events NO son el comportamiento por defecto, y su ausencia es
#   silenciosa. Comprobado: sin ellas, los procedimientos de mantenimiento de
#   003_partitioning.sql (rotación de particiones y limpieza) NO salen en el
#   fichero. La restauración parecería correcta y el mantenimiento habría
#   desaparecido, cosa que nadie nota hasta que la tabla de logs no para de
#   crecer meses después.
#
# --single-transaction toma una instantánea coherente sin bloquear escrituras.
#   Solo sirve con InnoDB, que es lo que usa todo el esquema.
#
# --default-character-set=utf8mb4 evita que el volcado pase por latin1 y
#   destroce las tildes de los nombres de cliente.
#
# --hex-blob escribe los binarios en hexadecimal, a salvo de cualquier
#   reinterpretación de juego de caracteres al restaurar.
#
# NO lleva --databases ni --add-drop-database: el fichero contiene las tablas,
#   no un `DROP DATABASE`. Restaurar apunta explícitamente a una base, y así un
#   fichero de respaldo nunca puede borrar una base entera por sí solo.
"$MYSQLDUMP" \
  --defaults-extra-file="$DEFAULTS_FILE" \
  --single-transaction \
  --routines \
  --events \
  --triggers \
  --hex-blob \
  --default-character-set=utf8mb4 \
  "$BASE" | gzip -9 > "$TMP"

# ── Comprobar que el volcado está COMPLETO ───────────────────────────────────
#
# `mysqldump` termina el fichero con "-- Dump completed on ...". Si el disco se
# llena, la red se corta o alguien mata el proceso, queda un fichero que existe,
# pesa y no sirve. Sin esta comprobación el fallo se descubre el día de la
# restauración, que es el único día en que no se puede permitir.
#
# Se mira el fichero YA COMPRIMIDO, para comprobar de paso que el gzip también
# quedó entero.
if ! gzip -dc "$TMP" | tail -5 | grep -q "Dump completed"; then
  echo "El volcado quedó INCOMPLETO. No se conserva." >&2
  rm -f "$TMP"
  exit 1
fi

mv "$TMP" "$ARCHIVO"

# Suma de control, para detectar corrupción en reposo o en el traslado.
if command -v sha256sum >/dev/null 2>&1; then
  (cd "$DESTINO" && sha256sum "$(basename "$ARCHIVO")" > "$(basename "$ARCHIVO").sha256")
fi

FIN=$(date +%s)
TAMANO=$(du -h "$ARCHIVO" | cut -f1)
echo "Listo: $TAMANO en $((FIN - INICIO)) s"

# ── Retención ────────────────────────────────────────────────────────────────
#
# Se borra DESPUÉS de que el nuevo esté verificado, nunca antes. Purgar primero
# para hacer sitio y que luego falle el respaldo deja menos copias de las que
# había al empezar.
BORRADOS=$(find "$DESTINO" -name 'asta-*.sql.gz*' -type f -mtime "+$RETENCION_DIAS" -print -delete | wc -l)
[[ "$BORRADOS" -gt 0 ]] && echo "Retirados $BORRADOS respaldos de más de $RETENCION_DIAS días."

# ── Lo que este fichero NO contiene ──────────────────────────────────────────
#
# Los USUARIOS y sus permisos. Viven en la base `mysql`, no en `asta`, así que
# un volcado de esquema no los lleva. Restaurar en un servidor nuevo deja las
# tablas y los datos en su sitio y la aplicación sin poder conectarse.
#
# No se vuelcan aquí a propósito: el volcado de `mysql.user` lleva los hashes de
# todas las contraseñas del servidor, y eso convertiría cada respaldo en un
# objetivo mucho más goloso. Se resuelve reaplicando db/mysql/004_usuarios.sql,
# que es rápido y está versionado.
echo
echo "Recuerda: este fichero NO lleva los usuarios de MySQL."
echo "Al restaurar en un servidor nuevo hay que reaplicar db/mysql/004_usuarios.sql."
